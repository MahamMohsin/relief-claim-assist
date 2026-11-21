import * as Type from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { actions, canOpen, type Claim, type Payload, type Profile, type UIAction } from "@/src/lib/contracts";
import { ApiError, gateway } from "@/src/lib/server";
import { classifyScam } from "@/src/lib/ai/jev";
import { answerPolicy } from "@/src/lib/ai/rag";

export const names = [
  "ui_control",
  "claim_start_new",
  "jev_classify_and_route",
  "claim_draft_upsert",
  "claim_step_navigate",
  "privacy_request_correction",
  "mock_dpi_verify",
  "policy_rag_search",
  "escalate_to_officer",
];
const appKeys = ["claim", "profile", "scam", "policy", "privacy", "family", "review", "rules", "users", "audit"] as const;
export const miniApp = z.enum(appKeys);

// Map whatever the model sends ("Scam Shield", "scam_shield", "open the scam app") to a canonical key.
const appAliases: Record<string, (typeof appKeys)[number]> = {};
for (const key of appKeys) appAliases[key] = key;
Object.assign(appAliases, {
  reliefclaim: "claim", claims: "claim", newclaim: "claim",
  myprofile: "profile", familyprofile: "profile", citizenprofile: "profile", cnic: "profile", jobproof: "profile", utilitybill: "profile",
  scamshield: "scam", scamapp: "scam", fraud: "scam",
  policyask: "policy", ask: "policy",
  myprivacy: "privacy",
  familyswitch: "family", switchfamily: "family",
  reviewdesk: "review", queue: "review",
  rulestudio: "rules",
  registeredusers: "users", userdirectory: "users",
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

export function resolveStep(value: unknown): "household" | "evidence" | "review" | "submit" | "list" | null {
  const norm = String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (norm.includes("back") || norm.includes("list") || norm.includes("claim") || norm.includes("cancel") || norm.includes("exit")) return "list";
  if (norm.includes("household") || norm.includes("income") || norm.includes("step1")) return "household";
  if (norm.includes("evidence") || norm.includes("attach") || norm.includes("document") || norm.includes("proof")) return "evidence";
  if (norm.includes("submit")) return "submit";
  if (norm.includes("review") || norm.includes("finish")) return "review";
  return null;
}

export type ScreenContext = {
  activeApp?: string | null;
  openApps?: string[];
  claim?: {
    editing: boolean;
    step: string;
    monthly_income: number;
    household_size: number;
    notes: string;
    claimId?: string | null;
    docType?: string;
    fixture?: string;
    attached?: string;
  };
  privacy?: {
    field: string;
    value: string;
  };
};

export type PiContext = {
  profile: Profile;
  citizenId: string | null;
  confidence: number;
  threshold: number;
  ruleVersion: number;
  screenContext?: ScreenContext;
  emit: (action: UIAction) => void;
};

const textResult = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], details: undefined });

export function registerTools(pi: ExtensionAPI, context: PiContext) {
  const { profile, citizenId, emit } = context;

  pi.registerTool({
    name: "ui_control",
    label: "Open app",
    description: "Visually click and open a mini-app for the user, and optionally type a search query inside Family Switch, Review Desk, or Users. App keys: claim, scam, policy, privacy, family, review, rules, users, audit.",
    parameters: Type.Object({
      app: Type.String({ maxLength: 40 }),
      search: Type.Optional(Type.String({ maxLength: 120 })),
    }),
    async execute(_id, input) {
      const app = resolveApp(input.app);
      if (!app) throw new ApiError(400, `Unknown app "${input.app}". Use one of: ${appKeys.join(", ")}.`);
      if (!canOpen(profile.role, app)) throw new ApiError(403, "Your role cannot open this app.");
      emit({ type: "open_mini_app", app });
      if (app === "claim" && context.screenContext?.claim?.editing) {
        emit({ type: "claim_back_to_list" });
      }
      if (input.search && input.search.trim() && (app === "family" || app === "review" || app === "users")) {
        emit({ type: "search_app_visual", app, query: input.search.trim() });
      }
      return textResult({ opened: app, searched: input.search?.trim() || undefined });
    },
  });

  pi.registerTool({
    name: "claim_start_new",
    label: "Start new claim",
    description: "Visually open Relief Claim, click '+ New claim', and optionally type any monthly income, household size, or notes the user mentioned into the form fields.",
    parameters: Type.Object({
      monthlyIncome: Type.Optional(Type.Integer({ minimum: 0, maximum: 10000000 })),
      householdSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      notes: Type.Optional(Type.String({ maxLength: 600 })),
    }),
    async execute(_id, input) {
      const fields: Partial<Payload> = {};
      if (typeof input.monthlyIncome === "number") fields.monthly_income = input.monthlyIncome;
      if (typeof input.householdSize === "number") fields.household_size = input.householdSize;
      if (typeof input.notes === "string" && input.notes.trim()) fields.notes = input.notes.trim();
      emit({ type: "open_mini_app", app: "claim" });
      emit({ type: "start_new_claim", fields: Object.keys(fields).length ? fields : undefined });
      return textResult({ startedNewClaimForm: true, prefilledFields: fields });
    },
  });

  pi.registerTool({
    name: "jev_classify_and_route",
    label: "Check message in Scam Shield",
    description: "Open Scam Shield, visually type and verify a synthetic scam message or payment reference, and cross-check the mock Raast ledger.",
    parameters: Type.Object({
      message: Type.String({ minLength: 1, maxLength: 1200 }),
      reference: Type.Optional(Type.String({ maxLength: 80 })),
    }),
    async execute(_id, input) {
      const args = actions.check.parse({ message: input.message, reference: input.reference ?? "" });
      emit({ type: "open_mini_app", app: "scam" });
      emit({ type: "check_scam_visual", message: args.message, reference: args.reference || undefined });
      await gateway("raast", { reference: args.reference }).catch(() => null);
      const classification = await classifyScam(args.message, args.reference);
      const result = await gateway<{ jev_label: string; rail_match_status: string }>("check", { ...args, classification });
      if (result.jev_label === "scam" || result.jev_label === "suspicious") {
        emit({ type: "highlight_alert", severity: "warning", message: "Suspicious synthetic message. Check the mock receipt before acting." });
      }
      return textResult({ verdict: result.jev_label, rail: result.rail_match_status, model: classification.model, shownInScamShield: true });
    },
  });

  pi.registerTool({
    name: "claim_draft_upsert",
    label: "Fill & save claim draft",
    description: "Visually open the claim form, type the user-supplied household size, monthly income, and optional notes, and save the draft. Never submit or approve.",
    parameters: Type.Object({
      householdSize: Type.Integer({ minimum: 1, maximum: 100 }),
      income: Type.Integer({ minimum: 0, maximum: 10000000 }),
      notes: Type.Optional(Type.String({ maxLength: 600 })),
      claimId: Type.Optional(Type.String({ maxLength: 36 })),
    }),
    async execute(_id, input) {
      const payload = { household_size: input.householdSize, monthly_income: input.income, notes: input.notes?.trim() ?? "" };
      const args = actions.draft.parse({ citizenId, claimId: input.claimId, key: crypto.randomUUID(), payload });
      const result = await gateway<Claim>("draft", args);
      emit({ type: "open_mini_app", app: "claim" });
      emit({ type: "prefill_fields", fields: payload, claimId: result.id, saved: true });
      return textResult({ draftSaved: true, status: result.status, fieldsFilled: payload });
    },
  });

  pi.registerTool({
    name: "claim_step_navigate",
    label: "Advance claim step",
    description: "Visually navigate between steps inside Relief Claim: household, evidence, review, submit, or click 'Back to claims' to return to the claims list (list/back). Optionally pick a sample document (clear, blurred, altered, incomplete) and docType (identity, income), and attach evidence. The user always clicks final Submit.",
    parameters: Type.Object({
      step: Type.String({ maxLength: 30, description: "household, evidence, review, submit, or list/back" }),
      docType: Type.Optional(Type.Union([Type.Literal("identity"), Type.Literal("income")])),
      fixture: Type.Optional(Type.Union([Type.Literal("clear"), Type.Literal("blurred"), Type.Literal("altered"), Type.Literal("incomplete")])),
      attachEvidence: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, input) {
      const step = resolveStep(input.step);
      if (!step) throw new ApiError(400, "Choose household, evidence, review, submit, or list.");
      emit({ type: "open_mini_app", app: "claim" });
      if (step === "list") {
        emit({ type: "claim_back_to_list" });
        return textResult({ returnedToClaimsList: true });
      }
      emit({
        type: "advance_claim_step",
        step,
        docType: input.docType,
        fixture: input.fixture,
        attachEvidence: input.attachEvidence,
      });
      return textResult({ navigatedToStep: step, docType: input.docType, fixture: input.fixture, attachEvidence: input.attachEvidence });
    },
  });

  pi.registerTool({
    name: "privacy_request_correction",
    label: "Fill privacy correction",
    description: "Open My Privacy and visually select a field and type the proposed correction value for the user to review or submit.",
    parameters: Type.Object({
      field: Type.Union([
        Type.Literal("full_name"),
        Type.Literal("phone"),
        Type.Literal("village_area"),
        Type.Literal("household_size"),
        Type.Literal("monthly_income_mock"),
      ]),
      value: Type.String({ minLength: 1, maxLength: 160 }),
    }),
    async execute(_id, input) {
      emit({ type: "open_mini_app", app: "privacy" });
      emit({ type: "privacy_correction_visual", field: input.field, value: input.value.trim() });
      return textResult({ openedPrivacy: true, field: input.field, value: input.value.trim() });
    },
  });

  pi.registerTool({
    name: "mock_dpi_verify",
    label: "Check simulated DPI",
    description: "Look up the current scheme, verify the active mock identity, or check a mock receipt.",
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
    name: "policy_rag_search",
    label: "Ask Policy Ask",
    description: "Open Policy Ask, visually type and submit the user's policy question into the chat, and return dated policy sections for an eligibility, privacy, document, or payment question.",
    parameters: Type.Object({ question: Type.String({ minLength: 3, maxLength: 500 }) }),
    async execute(_id, input) {
      const parsed = actions.policy.parse(input);
      if (canOpen(profile.role, "policy")) {
        emit({ type: "open_mini_app", app: "policy" });
        emit({ type: "ask_policy_visual", question: parsed.question });
      }
      const result = await answerPolicy(parsed.question);
      return textResult({ ...result, citations: result.citations.map(({ section_code, title }) => ({ section_code, title })), shownInPolicyAsk: true });
    },
  });

  pi.registerTool({
    name: "escalate_to_officer",
    label: "Flag for review",
    description: "Record a human handoff on an existing submitted claim. Requires its exact claim ID and a short summary.",
    parameters: Type.Object({ claimId: Type.String({ format: "uuid" }), reason: Type.String({ minLength: 5, maxLength: 300 }) }),
    async execute(_id, input) {
      const args = z.object({ claimId: z.uuid(), reason: z.string().trim().min(5).max(300) }).parse(input);
      const result = await gateway("agent_escalate", { ...args, citizenId });
      emit({ type: "highlight_alert", severity: "info", message: "This claim has been flagged for an officer." });
      return textResult(result);
    },
  });
}
