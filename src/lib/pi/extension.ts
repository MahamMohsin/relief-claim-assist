import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { canOpen, type MiniApp } from "@/src/lib/contracts";
import { mimoModel } from "@/src/lib/ai/mimo";
import { gateway } from "@/src/lib/server";
import { names, registerTools, type PiContext } from "./tools";

export function createReliefExtension(context: PiContext, locale: "en" | "ur"): ExtensionFactory {
  return pi => {
    const started = new Map<string, number>();
    const trace = (event: string, outcome: string, detail: object) => gateway("agent_trace", {
      citizenId: context.citizenId, event, outcome, detail, model: mimoModel, confidence: context.confidence,
    });

    pi.on("before_provider_request", event => {
      if (event.payload && typeof event.payload === "object") {
        return { ...event.payload, thinking: { type: "disabled" } };
      }
    });

    pi.on("before_agent_start", async () => ({
      systemPrompt: "You are Relief Claim Assist for Fatima Bibi's relief claim workspace. You have FULL CONTROL to do anything the user asks. "
        + "Rules: "
        + "1. NEVER output or recite UUIDs, internal IDs, or strings like 'ID: 3a97da52-...'. Omit claim IDs completely from your text. "
        + "2. Never say 'I can't click review or finish for you', 'I never approve or submit claims', or 'Officers make the decision'. You CAN take action on their behalf. "
        + "3. When the user supplies household size and income, call claim_draft_upsert to fill the form. "
        + "4. When the user says they have attached evidence, want to proceed, review, or submit/finish, call claim_step_navigate with step 'evidence', 'review', or 'submit' to execute it for them. "
        + "5. You can navigate apps with ui_control. Guide and execute for the user smoothly. "
        + "Keep replies under 40 words, warm, confident, natural and concise. Reply in " + (locale === "ur" ? "Urdu, unless the request is clearly English." : "English."),
    }));

    pi.on("tool_call", async event => {
      try {
        await gateway("agent_guard", { citizenId: context.citizenId });
        const familyTool = ["claim_draft_upsert", "escalate_to_officer"].includes(event.toolName);
        const navigationDenied = event.toolName === "ui_control" && !canOpen(context.profile.role, event.input.app as MiniApp);
        const scamDenied = event.toolName === "jev_classify_and_route" && !canOpen(context.profile.role, "scam");
        if (!names.includes(event.toolName) || navigationDenied || scamDenied
            || (familyTool && (!context.citizenId || !canOpen(context.profile.role, "claim")))
            || (event.toolName === "claim_draft_upsert" && context.confidence < context.threshold)) {
          await trace("tool_blocked", "denied", { tool: event.toolName, toolCallId: event.toolCallId });
          return { block: true, reason: "This assistant action is outside the permitted role, consent, or confidence." };
        }
        started.set(event.toolCallId, Date.now());
        await trace("tool_call", "started", { tool: event.toolName, toolCallId: event.toolCallId, inputs: Object.keys(event.input) });
      } catch {
        return { block: true, reason: "The server could not verify access or audit the tool call." };
      }
    });

    pi.on("tool_result", async event => {
      const start = started.get(event.toolCallId);
      started.delete(event.toolCallId);
      if (!start) return;
      await trace("tool_result", event.isError ? "error" : "ok", {
        tool: event.toolName, toolCallId: event.toolCallId, latencyMs: Date.now() - start,
        outputs: event.content.map(item => item.type),
      });
    });

    registerTools(pi, context);
  };
}
