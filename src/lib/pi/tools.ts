import * as Type from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { actions, canOpen, type Claim, type MiniApp, type Profile, type UIAction } from "@/src/lib/contracts";
import { ApiError, gateway } from "@/src/lib/server";
import { classifyScam } from "@/src/lib/ai/jev";
import { answerPolicy } from "@/src/lib/ai/rag";

export const names = ["ui_control", "jev_classify_and_route", "claim_draft_upsert", "claim_step_navigate", "mock_dpi_verify", "policy_rag_search", "escalate_to_officer"];
const appKeys = ["claim", "profile", "scam", "policy", "privacy", "family", "review", "rules", "audit"] as const;
export const miniApp = z.enum(appKeys);

// Map whatever the model sends ("Scam Shield", "scam_shield", "open the scam app") to a canonical key.
const appAliases: Record<string, (typeof appKeys)[number]> = {};
for (const key of appKeys) appAliases[key] = key;
Object.assign(appAliases, {
  reliefclaim: "claim", claims: "claim", newclaim: "claim",
  myprofile: "profile", citizenprofile: "profile", cnic: "profile", jobproof: "profile", utilitybill: "profile",
  scamshield: "scam", scamapp: "scam", fraud: "scam",
  policyask: "policy", ask: "policy",
  myprivacy: "privacy",
  familyswitch: "family", switchfamily: "family",
  reviewdesk: "review", queue: "review",
  rulestudio: "rules",
  auditvault: "audit",
} satisfies Record<string, (typeof appKeys)[number]>);

export function resolveApp(value: unknown): (typeof appKeys)[number] | null {
  const norm = String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!norm) return null;
  const exact = appAliases[norm];
  if (exact) return exact;
  // Loose contains-match for phrases, longest alias first so "scamshield" wins over "scam".
  const alias = Object.keys(appAliases).sort((left, right) => right.length - left.length).find(key => norm.includes(key));
  return alias ? appAliases[alias] : null;
}

export function resolveStep(value: unknown): "evidence" | "review" | null {
  const norm = String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (norm.includes("evidence") || norm.includes("attach") || norm.includes("document")) return "evidence";
  if (norm.includes("review") || norm.includes("submit") || norm.includes("finish")) return "review";
  return null;
}

export type PiContext = {
  profile: Profile;
  citizenId: string | null;
  confidence: number;
  threshold: number;
  ruleVersion: number;
  emit: (action: UIAction) => void;
};

const textResult = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], details: undefined });

export function registerTools(pi: ExtensionAPI, context: PiContext) {
  const { profile, citizenId, emit } = context;
  pi.registerTool({
    name: "ui_control", label: "Navigate", description: "Open one mini-app for the user. Use the app key: claim, scam (Scam Shield), policy, privacy, family, review, rules, audit — display names like \"Scam Shield\" also work.",
    parameters: Type.Object({ app: Type.String({ maxLength: 40 }) }),
    async execute(_id, input) {
      const app = resolveApp(input.app);
      if (!app) throw new ApiError(400, `Unknown app "${input.app}". Use one of: ${appKeys.join(", ")}.`);
      if (!canOpen(profile.role, app)) throw new ApiError(403, "Your role cannot open this app.");
      emit({ type: "open_mini_app", app });
      return textResult({ opened: app });
    },
  });
  pi.registerTool({
    name: "jev_classify_and_route", label: "Check message", description: "Classify a synthetic scam message and cross-check a mock payment reference.",
    parameters: Type.Object({ message: Type.String({ minLength: 1, maxLength: 1200 }), reference: Type.Optional(Type.String({ maxLength: 80 })) }),
    async execute(_id, input) {
      const args = actions.check.parse({ message: input.message, reference: input.reference ?? "" });
      await gateway("raast", { reference: args.reference });
      const classification = await classifyScam(args.message, args.reference);
      const result = await gateway<{ jev_label: string; rail_match_status: string }>("check", { ...args, classification });
      if (result.jev_label === "scam" || result.jev_label === "suspicious") {
        emit({ type: "highlight_alert", severity: "warning", message: "Suspicious synthetic message. Check the mock receipt before acting." });
      }
      return textResult({ verdict: result.jev_label, rail: result.rail_match_status, model: classification.model });
    },
  });
  pi.registerTool({
    name: "claim_draft_upsert", label: "Save a draft", description: "Save a draft using household size and income explicitly supplied by the user. Never submit or approve.",
    parameters: Type.Object({ householdSize: Type.Integer({ minimum: 1, maximum: 100 }), income: Type.Integer({ minimum: 0, maximum: 10000000 }),
      claimId: Type.Optional(Type.String({ maxLength: 36 })) }),
    async execute(_id, input) {
      const payload = { household_size: input.householdSize, monthly_income: input.income, notes: "" };
      const args = actions.draft.parse({ citizenId, claimId: input.claimId, key: crypto.randomUUID(), payload });
      const result = await gateway<Claim>("draft", args);
      emit({ type: "open_mini_app", app: "claim" });
      emit({ type: "prefill_fields", fields: payload, claimId: result.id });
      return textResult({ draftSaved: true, status: result.status });
    },
  });
  pi.registerTool({
    name: "claim_step_navigate", label: "Advance claim step", description: "Open evidence or the review screen. The user confirms submission.",
    parameters: Type.Object({ step: Type.String({ maxLength: 30, description: "evidence or review" }) }),
    async execute(_id, input) {
      const step = resolveStep(input.step);
      if (!step) throw new ApiError(400, "Choose evidence or review.");
      emit({ type: "open_mini_app", app: "claim" });
      emit({ type: "advance_claim_step", step });
      return textResult({ navigatedToStep: step });
    },
  });
  pi.registerTool({
    name: "mock_dpi_verify", label: "Check simulated DPI", description: "Look up the current scheme, verify the active mock identity, or check a mock receipt.",
    parameters: Type.Object({ rail: Type.Union([Type.Literal("nadra"), Type.Literal("scheme"), Type.Literal("raast")]), reference: Type.Optional(Type.String({ maxLength: 80 })) }),
    async execute(_id, input) {
      if (input.rail === "nadra") {
        const { id, village_area } = await gateway<{ id: string; village_area: string }>("nadra", { citizenId });
        return textResult({ verified: Boolean(id), area: village_area, simulated: true });
      }
      if (input.rail === "scheme") return textResult(await gateway("scheme"));
      return textResult(await gateway("raast", actions.raast.parse({ reference: input.reference })));
    },
  });
  pi.registerTool({
    name: "policy_rag_search", label: "Search policy", description: "Find dated policy sections for an eligibility, privacy, or payment question.",
    parameters: Type.Object({ question: Type.String({ minLength: 3, maxLength: 500 }) }),
    async execute(_id, input) {
      const result = await answerPolicy(actions.policy.parse(input).question);
      return textResult({ ...result, citations: result.citations.map(({ section_code, title }) => ({ section_code, title })) });
    },
  });
  pi.registerTool({
    name: "escalate_to_officer", label: "Flag for review", description: "Record a human handoff on an existing submitted claim. Requires its exact claim ID and a short summary.",
    parameters: Type.Object({ claimId: Type.String({ format: "uuid" }), reason: Type.String({ minLength: 5, maxLength: 300 }) }),
    async execute(_id, input) {
      const args = z.object({ claimId: z.uuid(), reason: z.string().trim().min(5).max(300) }).parse(input);
      const result = await gateway("agent_escalate", { ...args, citizenId });
      emit({ type: "highlight_alert", severity: "info", message: "This claim has been flagged for an officer." });
      return textResult(result);
    },
  });
}
