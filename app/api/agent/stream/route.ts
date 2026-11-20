import { z } from "zod";
import type { FileEntry } from "@earendil-works/pi-coding-agent";
import { appRoles, canOpen, uuid, type MiniApp, type Profile, type UIAction } from "@/src/lib/contracts";
import { apiError, ApiError, gateway, readJson } from "@/src/lib/server";
import { routeIntent } from "@/src/lib/ai/jev";
import { answerPolicy } from "@/src/lib/ai/rag";
import { mimoModel } from "@/src/lib/ai/mimo";
import { makeSession } from "@/src/lib/pi/runtime";
import type { AgentEvent } from "@/src/components/os/UIActionBus";

export const runtime = "nodejs";
const streamSchema = z.object({ prompt: z.string().trim().min(1).max(1000), runId: uuid, citizenId: uuid.nullish(), locale: z.enum(["en", "ur"]) });
const controlSchema = streamSchema.omit({ locale: true }).extend({ prompt: z.string().trim().min(1).max(1000).optional() });
const active = new Map<string, { id: string; citizen: string | null; abort: () => void; steer?: (text: string) => Promise<void> }>();

export async function POST(request: Request) {
  try {
    const input = streamSchema.safeParse(await readJson(request));
    if (!input.success) throw new ApiError(400, "Provide a short assistant command.");
    const profile = await gateway<Profile>("profile");
    const citizenId = profile.role === "helper" ? input.data.citizenId ?? null : profile.citizen_id;
    const { runId, prompt, locale } = input.data;
    await gateway("agent_guard", { citizenId });
    if (active.has(profile.id)) throw new ApiError(409, "Finish or stop the active assistant request first.");

    let cancelled = false;
    let session: Awaited<ReturnType<typeof makeSession>>["session"] | undefined;
    let hardTimeout: ReturnType<typeof setTimeout> | undefined;
    const run = {
      id: runId, citizen: citizenId,
      abort() {
        cancelled = true;
        void session?.abort().catch(() => {});
      },
      steer: undefined as undefined | ((text: string) => Promise<void>),
    };
    active.set(profile.id, run);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (event: AgentEvent) => {
          if (!cancelled) controller.enqueue(encoder.encode("data: " + JSON.stringify(event) + "\n\n"));
        };
        const emitAction = (action: UIAction) => emit({ type: "ui_action", action });
        let fallback = false;
        let confidence = 0;
        let target: MiniApp | null = null;
        const interrupted = () => run.abort();
        hardTimeout = setTimeout(interrupted, 50000);
        request.signal.addEventListener("abort", interrupted, { once: true });
        try {
          emit({ type: "phase", message: "Routing · Jev" });
          const [decision, scheme, entries] = await Promise.all([
            routeIntent(prompt),
            gateway<{ version: number; config: { confidence_threshold: number } }>("scheme"),
            gateway<FileEntry[]>("agent_load", { citizenId }),
          ]);
          if (cancelled) return;
          confidence = decision.confidence;
          const threshold = scheme.config.confidence_threshold;
          target = decision.app && canOpen(profile.role, decision.app) ? decision.app : null;
          emitAction({ type: "show_jev_badge", label: decision.label, confidence, route: target ?? "clarification", model: decision.model });
          await gateway("agent_trace", { citizenId, event: "jev_route", model: decision.model, confidence,
            outcome: target ?? "clarification", detail: { route: decision.label } });
          if (confidence < threshold) {
            const options = (Object.keys(appRoles) as MiniApp[]).filter(app => canOpen(profile.role, app)).slice(0, 3);
            emitAction({ type: "ask_clarification", question: locale === "ur" ? "آپ کون سی خدمت کھولنا چاہتے ہیں؟" : "Which mini-app would you like to open?", options });
            emit({ type: "agent_settled", model: decision.model });
            return;
          }
          if (target) emitAction({ type: "open_mini_app", app: target });
          emit({ type: "phase", message: "Pi · MiMo Flash" });
          const restored = JSON.stringify(entries).length < 90000 ? entries : [];
          const runtime = await makeSession({ profile, citizenId, confidence, threshold, ruleVersion: scheme.version, emit: emitAction }, locale, restored);
          session = runtime.session;
          if (cancelled) return;
          run.steer = async text => {
            // A changed request must re-enter the decision gate before it can steer the model.
            const next = await routeIntent(text);
            if (next.confidence < threshold || (next.app && !canOpen(profile.role, next.app))) {
              throw new ApiError(409, "Stop the current request before asking for a different operation.");
            }
            await session?.steer(text);
          };
          let answer = "";
          let error = "";
          const unsubscribe = session.subscribe(event => {
            if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
              answer += event.assistantMessageEvent.delta;
              emit({ type: "message_update", text: event.assistantMessageEvent.delta });
            }
            if (event.type === "message_end" && event.message.role === "assistant" && event.message.stopReason === "error") error = "MiMo response unavailable.";
            if (event.type === "tool_execution_start") emit({ type: "tool_execution_start", tool: event.toolName });
            if (event.type === "tool_execution_end") emit({ type: "tool_execution_end", tool: event.toolName });
          });
          try {
            await session.prompt(prompt, { expandPromptTemplates: false });
            if (cancelled) return;
            if (error || !answer.trim()) throw new Error(error || "MiMo did not return readable text");
            const header = runtime.sessionManager.getHeader();
            await gateway("agent_save", { citizenId, entries: header ? [header, ...runtime.sessionManager.getEntries()] : [] });
            await gateway("agent_trace", { citizenId, event: "agent_settled", model: mimoModel, confidence, outcome: "ok" });
          } finally { unsubscribe(); }
        } catch (error) {
          if (cancelled) return;
          if (error instanceof ApiError && [401, 403].includes(error.status)) {
            emit({ type: "error", message: error.message });
            return;
          }
          console.error("Assistant degraded", error instanceof Error ? error.message : "unknown");
          fallback = true;
          const guidance = target === "policy"
            ? await answerPolicy(prompt).then(result => result.answer + (result.citations.length ? " [" + result.citations.map(section => section.section_code).join(", ") + "]" : "")).catch(() => "The registry is currently unavailable.")
            : locale === "ur" ? "اپنی درخواست دیکھنے کے لیے متعلقہ ایپ کھولیں۔ ادائیگی سے پہلے افسر کا فیصلہ ضروری ہے۔"
            : "Use the selected mini-app to continue. Every payment requires a separate officer decision.";
          emit({ type: "message_update", text: guidance });
        } finally {
          clearTimeout(hardTimeout);
          request.signal.removeEventListener("abort", interrupted);
          if (active.get(profile.id) === run) active.delete(profile.id);
          session?.dispose();
          if (!cancelled) {
            // Clarification already emits its own terminal event.
            if (session || fallback) emit({ type: "agent_settled", model: fallback ? "local-guidance" : mimoModel });
            controller.close();
          } else {
            try { controller.close(); } catch { /* The stream consumer already disconnected. */ }
          }
        }
      },
      cancel: run.abort,
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" } });
  } catch (error) { return apiError(error); }
}

async function control(request: Request, method: "abort" | "steer") {
  try {
    const parsed = controlSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new ApiError(400, "The active request ID is required.");
    const profile = await gateway<Profile>("profile");
    const run = active.get(profile.id);
    const citizenId = profile.role === "helper" ? parsed.data.citizenId ?? null : profile.citizen_id;
    if (!run || run.id !== parsed.data.runId || citizenId !== run.citizen) throw new ApiError(404, "This assistant request has finished.");
    if (method === "abort") run.abort();
    else {
      await gateway("agent_guard", { citizenId });
      if (!run.steer || !parsed.data.prompt) throw new ApiError(409, "The assistant is still routing the first request.");
      await run.steer(parsed.data.prompt);
    }
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}

export const PATCH = (request: Request) => control(request, "steer");
export const DELETE = (request: Request) => control(request, "abort");
