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
const screenContextSchema = z.object({
  activeApp: z.string().max(30).nullish(),
  openApps: z.array(z.string().max(30)).max(12).optional(),
  persona: z.object({
    id: z.string().max(30),
    role: z.string().max(30),
    name: z.string().max(100),
  }).optional(),
  claim: z.object({
    editing: z.boolean(),
    step: z.string().max(30),
    monthly_income: z.number(),
    household_size: z.number(),
    notes: z.string().max(600),
    claimId: z.string().max(60).nullish(),
    docType: z.string().max(30).optional(),
    fixture: z.string().max(30).optional(),
    attached: z.string().max(120).optional(),
  }).optional(),
  privacy: z.object({
    field: z.string().max(40),
    value: z.string().max(160),
    helpers: z.array(z.object({
      id: z.string().max(40),
      name: z.string().max(80),
      status: z.string().max(20),
    })).optional(),
  }).optional(),
  review: z.object({
    queueCount: z.number(),
    selectedClaimId: z.string().max(60).nullish(),
    selectedClaim: z.object({
      id: z.string().max(60),
      citizenName: z.string().max(100),
      status: z.string().max(30),
      monthlyIncome: z.number().optional(),
      householdSize: z.number().optional(),
      aiConfidence: z.number().nullable().optional(),
      hasSuspectDoc: z.boolean().optional(),
      verifiedDocs: z.string().max(100).optional(),
      paymentStatus: z.string().max(30).optional(),
      fundingStatus: z.string().max(30).nullable().optional(),
      reports: z.number().optional(),
      aiSummary: z.string().max(3000).nullable().optional(),
    }).optional(),
    activeFilter: z.string().max(20).optional(),
    activeSort: z.string().max(10).optional(),
    topClaimId: z.string().max(60).optional(),
  }).optional(),
  family: z.object({
    activeFamilyId: z.string().max(60).nullish(),
    activeFamilyName: z.string().max(100).optional(),
    activeVillageArea: z.string().max(100).optional(),
    totalFamilies: z.number().optional(),
  }).optional(),
  rules: z.object({
    activeVersion: z.number().optional(),
    activeName: z.string().max(100).optional(),
    config: z.object({
      income_cap: z.number(),
      minimum_household: z.number(),
      amount_pkr: z.number(),
      confidence_threshold: z.number(),
    }).optional(),
    pendingStaffCount: z.number().optional(),
  }).optional(),
  profile: z.object({
    citizenName: z.string().max(100).optional(),
    cnicMock: z.string().max(40).optional(),
    monthlyIncome: z.number().optional(),
    householdSize: z.number().optional(),
    phone: z.string().max(40).optional(),
    villageArea: z.string().max(100).optional(),
    uploadedDocKinds: z.array(z.string().max(40)).optional(),
  }).optional(),
  budget: z.object({
    totalPkr: z.number(),
    availablePkr: z.number(),
    reservedPkr: z.number(),
    paidPkr: z.number(),
    awaitingClaims: z.number(),
  }).optional(),
  audit: z.object({
    totalLogs: z.number(),
    safetyScoreAverage: z.number().optional(),
  }).optional(),
  whatsapp: z.object({
    configured: z.boolean(),
    recentMessagesCount: z.number().optional(),
  }).optional(),
}).passthrough().optional();

const streamSchema = z.object({
  prompt: z.string().trim().min(1).max(1000),
  runId: uuid,
  citizenId: uuid.nullish(),
  locale: z.enum(["en", "ur"]),
  screenContext: screenContextSchema,
});
const controlSchema = streamSchema.omit({ locale: true, screenContext: true }).extend({ prompt: z.string().trim().min(1).max(1000).optional() });
const active = new Map<string, { id: string; citizen: string | null; abort: () => void; steer?: (text: string) => Promise<void> }>();

export async function POST(request: Request) {
  try {
    const input = streamSchema.safeParse(await readJson(request));
    if (!input.success) throw new ApiError(400, "Provide a short assistant command.");
    const profile = await gateway<Profile>("profile");
    const citizenId = profile.role === "helper" ? input.data.citizenId ?? null : profile.citizen_id;
    const { runId, prompt, locale, screenContext } = input.data;
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
          const [decision, scheme, entries] = await Promise.all([
            routeIntent(prompt),
            gateway<{ version: number; config: { confidence_threshold: number } }>("scheme"),
            gateway<FileEntry[]>("agent_load", { citizenId }),
          ]);
          if (cancelled) return;
          confidence = decision.confidence;
          const threshold = scheme.config.confidence_threshold;
          const isGreeting = decision.label === "greeting";
          const explicitTarget = decision.app && canOpen(profile.role, decision.app) ? decision.app : null;
          const explicitAccepted = (Boolean(explicitTarget) && confidence >= threshold) || isGreeting;

          // If the user is already inside an open mini-app and sends a follow-up (e.g., "15000 and 4 people",
          // "next step", "attach readable sample", "yes save it"), stay in the active app instead of asking
          // "Which mini-app would you like to open?" unless the prompt explicitly has conflicting intents.
          const candidateActive = (screenContext?.activeApp ?? (screenContext?.openApps?.length === 1 ? screenContext.openApps[0] : null)) as MiniApp | null;
          const validActiveApp = candidateActive && Object.hasOwn(appRoles, candidateActive) && canOpen(profile.role, candidateActive)
            ? candidateActive
            : null;
          const continuedInActive = !explicitAccepted && decision.label !== "ambiguous" && Boolean(validActiveApp);

          target = explicitTarget ?? (continuedInActive ? validActiveApp : null);
          if (continuedInActive || isGreeting) {
            confidence = Math.max(confidence, threshold, 0.92);
          }
          const accepted = isGreeting || (Boolean(target) && confidence >= threshold);
          emitAction({
            type: "show_jev_badge",
            label: continuedInActive ? `${target} (active context)` : decision.label,
            confidence,
            route: accepted && target ? target : isGreeting ? "general" as MiniApp : "clarification",
            model: decision.model,
          });
          await gateway("agent_trace", { citizenId, event: "jev_route", model: decision.model, confidence,
            outcome: accepted ? (target ?? "greeting") : "clarification", detail: { route: decision.label, continuedInActive, threshold, runId } });
          if (!accepted) {
            const options = (Object.keys(appRoles) as MiniApp[]).filter(app => canOpen(profile.role, app));
            emitAction({ type: "ask_clarification", question: locale === "ur"
              ? "مجھے یقین نہیں کہ آپ کون سی خدمت چاہتے ہیں۔ براہ کرم ایک سروس منتخب کریں۔"
              : "I’m not sure which service you mean. Which mini-app would you like to open?", options });
            emit({ type: "agent_settled", model: decision.model });
            return;
          }
          if (target && !continuedInActive) emitAction({ type: "open_mini_app", app: target });
          emit({ type: "phase", message: "Pi · MiMo Flash" });
          const restored = JSON.stringify(entries).length < 90000 ? entries : [];
          const runtime = await makeSession({ profile, citizenId, confidence, threshold, ruleVersion: scheme.version, screenContext, emit: emitAction }, locale, restored);
          session = runtime.session;
          if (cancelled) return;
          run.steer = async text => {
            const next = await routeIntent(text);
            if (!next.app || !canOpen(profile.role, next.app) || next.confidence < threshold) {
              await gateway("agent_trace", { citizenId, event: "jev_steer", model: next.model, confidence: next.confidence, outcome: "blocked" });
              throw new ApiError(409, "Please clarify the new request before continuing.");
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
          let guidance: string;
          if (target === "policy") {
            emitAction({ type: "ask_policy_visual", question: prompt });
            guidance = await answerPolicy(prompt)
              .then(result => result.answer + (result.citations.length ? " [" + result.citations.map(section => section.section_code).join(", ") + "]" : ""))
              .catch(() => "Opened Policy Ask and submitted your question.");
          } else if (target === "scam") {
            emitAction({ type: "check_scam_visual", message: prompt });
            guidance = locale === "ur"
              ? "اسکیم شیلڈ کھول کر آپ کا پیغام چیک کیا جا رہا ہے۔"
              : "Opened Scam Shield and started checking your message.";
          } else if (target === "claim") {
            if (screenContext?.claim?.editing && /back|list|exit|cancel/i.test(prompt)) {
              emitAction({ type: "claim_back_to_list" });
              guidance = locale === "ur"
                ? "کلیمز کی فہرست پر واپس چلے گئے۔ آپ کا ڈرافٹ محفوظ ہے۔"
                : "Back on the Relief Claim list now. Your draft is still saved.";
            } else {
              emitAction({ type: "start_new_claim" });
              guidance = locale === "ur"
                ? "نئی ریلیف درخواست کا فارم کھول دیا گیا ہے۔ اپنی آمدنی اور افراد کی تعداد درج کریں۔"
                : "Opened Relief Claim and started a new claim form for you. Enter your monthly income and household size to continue.";
            }
          } else if (target === "privacy") {
            if (/revoke|remove|access|permission|consent|helper|grant/i.test(prompt)) {
              const consent = /grant|allow|restore/i.test(prompt) ? "granted" as const : "revoked" as const;
              emitAction({ type: "privacy_helper_consent_visual", consent });
              guidance = locale === "ur"
                ? (consent === "revoked" ? "مائی پرائیویسی کھول کر ہیلپر کی رسائی منسوخ کر دی گئی ہے۔" : "مائی پرائیویسی کھول کر ہیلپر کی رسائی بحال کر دی گئی ہے۔")
                : (consent === "revoked" ? "Opened My Privacy and revoked your helper's access." : "Opened My Privacy and granted your helper access.");
            } else {
              emitAction({ type: "open_mini_app", app: "privacy" });
              guidance = locale === "ur"
                ? "مائی پرائیویسی کھول دی گئی ہے۔ آپ رضامندی کا انتظام کر سکتے ہیں یا ڈیٹا کی درستگی کی درخواست کر سکتے ہیں۔"
                : "Opened My Privacy for you. You can manage consent or request a record correction.";
            }
          } else {
            guidance = locale === "ur"
              ? "متعلقہ ایپ کھول دی گئی ہے۔ ادائیگی سے پہلے افسر کا فیصلہ ضروری ہے۔"
              : "Opened the mini-app for you. Every payment requires a separate officer decision.";
          }
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
