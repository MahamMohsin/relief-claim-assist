import * as Type from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { actions, canOpen, personas, type Claim, type Payload, type Persona, type Profile, type RuleConfig, type UIAction } from "@/src/lib/contracts";
import { ApiError, gateway } from "@/src/lib/server";
import { classifyScam } from "@/src/lib/ai/jev";
import { answerPolicy } from "@/src/lib/ai/rag";

export const names = [
  "ui_control",
  "claim_start_new",
  "claim_inspect_or_edit",
  "jev_classify_and_route",
  "scam_report_missing_payment",
  "chat_reset",
  "claim_draft_upsert",
  "claim_step_navigate",
  "privacy_request_correction",
  "privacy_manage_helper",
  "mock_dpi_verify",
  "policy_rag_search",
  "profile_upload_sample_document",
  "profile_view_document",
  "escalate_to_officer",
  "persona_switch",
  "family_switch_select",
  "review_claim_action",
  "review_disburse_payment",
  "review_set_filter",
  "rules_configure_and_simulate",
  "rules_publish_version",
  "rules_staff_approval",
  "scheme_budget_adjust",
  "audit_vault_control",
  "whatsapp_configure_agent",
  "window_manage",
];
const appKeys = ["claim", "profile", "scam", "policy", "privacy", "family", "review", "rules", "users", "audit", "whatsapp"] as const;
export const miniApp = z.enum(appKeys);

// Map whatever the model sends ("Scam Shield", "scam_shield", "open the scam app") to a canonical key.
const appAliases: Record<string, (typeof appKeys)[number]> = {};
for (const key of appKeys) appAliases[key] = key;
Object.assign(appAliases, {
  reliefclaim: "claim", claims: "claim", newclaim: "claim",
  myprofile: "profile", familyprofile: "profile", citizenprofile: "profile", cnic: "profile", jobproof: "profile", utilitybill: "profile",
  scamshield: "scam", scamapp: "scam", fraud: "scam",
  policyask: "policy", ask: "policy",
  myprivacy: "privacy", privacyapp: "privacy", library: "privacy", privacylibrary: "privacy",
  familyswitch: "family", switchfamily: "family",
  reviewdesk: "review", queue: "review",
  rulestudio: "rules",
  registeredusers: "users", userdirectory: "users",
  auditvault: "audit",
  whatsapp: "whatsapp", whatsapplink: "whatsapp", walink: "whatsapp", whatsap: "whatsapp", watsapp: "whatsapp", whatsappsms: "whatsapp", googlemessages: "whatsapp", messaging: "whatsapp", smshub: "whatsapp",
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
  minimizedApps?: string[];
  availableApps?: string[];
  offline?: boolean;
  lite?: boolean;
  pendingSyncCount?: number;
  persona?: {
    id: string;
    role: string;
    name: string;
  };
  activeFamily?: {
    id: string;
    name: string;
    villageArea: string;
  } | null;
  overview?: {
    active: number;
    review: number;
    proof: number;
    approved: number;
    rejected: number;
    closed: number;
    paid: number;
    newThisMonth: number;
    priority: number;
    unreadAlertsCount?: number;
  };
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
    openedClaimId?: string | null;
    claims?: {
      id: string;
      status: string;
      amountPkr?: number;
      monthlyIncome?: number;
      householdSize?: number;
      notes?: string;
      paymentStatus?: string;
      fundingStatus?: string | null;
      raastRef?: string;
      reasonEn?: string | null;
    }[];
  };
  policy?: {
    turnsCount: number;
    latestQuestion?: string;
    latestAnswer?: string;
    latestCitations?: string[];
    policyVersion?: string;
  };
  scam?: {
    turnsCount: number;
    latestVerdict?: string;
    latestReference?: string;
    latestPaymentStatus?: string;
    canReportMissing?: boolean;
    latestReported?: boolean;
  };
  privacy?: {
    field: string;
    value: string;
    helpers?: { id: string; name: string; status: string }[];
    officers?: string[];
    correctionsCount?: number;
  };
  review?: {
    queueCount: number;
    selectedClaimId?: string | null;
    selectedClaim?: {
      id: string;
      citizenName: string;
      status: string;
      monthlyIncome?: number;
      householdSize?: number;
      aiConfidence?: number | null;
      hasSuspectDoc?: boolean;
      verifiedDocs?: string;
      paymentStatus?: string;
      fundingStatus?: string | null;
      reports?: number;
      aiSummary?: string | null;
    };
    activeFilter?: string;
    activeSort?: string;
    topClaimId?: string;
    claims?: {
      id: string;
      citizenName: string;
      status: string;
      monthlyIncome?: number;
      householdSize?: number;
      aiConfidence?: number | null;
      hasSuspectDoc?: boolean;
      paymentStatus?: string;
      fundingStatus?: string | null;
    }[];
  };
  family?: {
    activeFamilyId?: string | null;
    activeFamilyName?: string;
    activeVillageArea?: string;
    totalFamilies?: number;
    families?: {
      id: string;
      name: string;
      villageArea: string;
      consent: string;
    }[];
  };
  rules?: {
    activeVersion?: number;
    activeName?: string;
    config?: {
      income_cap: number;
      minimum_household: number;
      amount_pkr: number;
      confidence_threshold: number;
    };
    pendingStaffCount?: number;
    pendingStaff?: { id: string; name: string; role: string }[];
    historyCount?: number;
    lastSimulation?: { changedCount: number; totalCount: number };
  };
  profile?: {
    citizenName?: string;
    cnicMock?: string;
    monthlyIncome?: number;
    householdSize?: number;
    phone?: string;
    villageArea?: string;
    uploadedDocKinds?: string[];
    photoDocKinds?: string[];
    documentsCount?: number;
  };
  users?: {
    totalUsers: number;
    filteredCount: number;
    query: string;
    visibleUsers: { id: string; name: string; role: string }[];
  };
  budget?: {
    totalPkr: number;
    availablePkr: number;
    reservedPkr: number;
    paidPkr: number;
    awaitingClaims: number;
  };
  audit?: {
    totalLogs: number;
    activeTab?: "events" | "eval";
    category?: string;
    filterText?: string;
    filteredCount?: number;
    safetyScoreAverage?: number;
    recentEvents?: { eventType: string; actorRole: string; outcome: string }[];
    safetySummary?: {
      strictBadApprovals: number;
      strictOfficerReviewPct: number;
      relaxedBadApprovals: number;
    };
  };
  whatsapp?: {
    configured: boolean;
    agentName?: string | null;
    maskedKey?: string | null;
    searchQuery?: string;
    recentMessagesCount?: number;
    recentMessages?: { direction: string; from: string; text: string }[];
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
    description: "Visually click and open a mini-app for the user, and optionally type a search query inside Family Switch, Review Desk, Users, Audit Vault, or WhatsApp Link. App keys: claim, profile, scam, policy, privacy, family, review, rules, users, audit, whatsapp.",
    parameters: Type.Object({
      app: Type.String({ maxLength: 40 }),
      search: Type.Optional(Type.String({ maxLength: 120 })),
    }),
    async execute(_id, input) {
      const app = resolveApp(input.app);
      if (!app) throw new ApiError(400, `Unknown app "${input.app}". Use one of: ${appKeys.join(", ")}.`);
      if (!canOpen(profile.role, app)) throw new ApiError(403, "Your role cannot open this app.");
      emit({ type: "open_mini_app", app });
      if (input.search && input.search.trim() && (app === "family" || app === "review" || app === "users" || app === "audit" || app === "whatsapp")) {
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
    name: "claim_inspect_or_edit",
    label: "Inspect or edit claim",
    description: "Open Relief Claim and either expand details for an existing claim (mode='details') or resume editing a draft / needs_proof claim (mode='edit').",
    parameters: Type.Object({
      mode: Type.Union([Type.Literal("details"), Type.Literal("edit")]),
      claimId: Type.Optional(Type.String({ maxLength: 60 })),
    }),
    async execute(_id, input) {
      if (!canOpen(profile.role, "claim")) throw new ApiError(403, "Your role cannot open Relief Claim.");
      emit({ type: "open_mini_app", app: "claim" });
      emit({ type: "claim_inspect_or_edit", mode: input.mode, claimId: input.claimId });
      return textResult({ mode: input.mode, claimId: input.claimId ?? "latest" });
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
    name: "scam_report_missing_payment",
    label: "Report missing payment",
    description: "In Scam Shield, click 'Report missing payment' for the latest checked reference or a specified Raast reference (e.g. SIM-FATIMA1).",
    parameters: Type.Object({
      reference: Type.Optional(Type.String({ maxLength: 80 })),
    }),
    async execute(_id, input) {
      if (!canOpen(profile.role, "scam")) throw new ApiError(403, "Your role cannot open Scam Shield.");
      emit({ type: "open_mini_app", app: "scam" });
      emit({ type: "scam_report_missing_visual", reference: input.reference?.trim() || undefined });
      return textResult({ reportedMissingPayment: true, reference: input.reference?.trim() || context.screenContext?.scam?.latestReference || "latest" });
    },
  });

  pi.registerTool({
    name: "chat_reset",
    label: "Reset Policy or Scam chat",
    description: "Clear the conversation inside Policy Ask or Scam Shield to start a fresh check or question.",
    parameters: Type.Object({
      app: Type.Union([Type.Literal("policy"), Type.Literal("scam")]),
    }),
    async execute(_id, input) {
      if (!canOpen(profile.role, input.app)) throw new ApiError(403, "Your role cannot open that app.");
      emit({ type: "chat_reset_visual", app: input.app });
      return textResult({ reset: input.app });
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
    description: "Open My Privacy and visually select a field and type the proposed correction value. Set submit=true if the user asked to submit the correction immediately.",
    parameters: Type.Object({
      field: Type.Union([
        Type.Literal("full_name"),
        Type.Literal("phone"),
        Type.Literal("village_area"),
        Type.Literal("household_size"),
        Type.Literal("monthly_income_mock"),
      ]),
      value: Type.String({ minLength: 1, maxLength: 160 }),
      submit: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, input) {
      emit({ type: "open_mini_app", app: "privacy" });
      emit({ type: "privacy_correction_visual", field: input.field, value: input.value.trim(), submit: Boolean(input.submit) });
      return textResult({ openedPrivacy: true, field: input.field, value: input.value.trim(), submitted: Boolean(input.submit) });
    },
  });

  pi.registerTool({
    name: "privacy_manage_helper",
    label: "Manage helper access in Privacy",
    description: "Open My Privacy and visually grant or revoke community helper access (permissions) for this citizen. Action is 'revoke' or 'grant'.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("revoke"), Type.Literal("grant")]),
      helperName: Type.Optional(Type.String({ maxLength: 100 })),
    }),
    async execute(_id, input) {
      const consent = input.action === "revoke" ? "revoked" as const : "granted" as const;
      emit({ type: "open_mini_app", app: "privacy" });
      if (profile.role !== "citizen") {
        return textResult({ openedPrivacy: true, updated: false, message: "Only the citizen can grant or revoke helper permissions." });
      }
      emit({ type: "privacy_helper_consent_visual", consent, helperName: input.helperName });
      return textResult({
        openedPrivacy: true,
        action: input.action,
        helperName: input.helperName ?? "Community helper",
        consent,
        message: `Triggered ${input.action} for helper access in My Privacy.`,
      });
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
    name: "profile_upload_sample_document",
    label: "Add sample document to profile",
    description: "Visually open My Profile, click Add/Sample for CNIC (cnic), utility bill (utility_bill), or job proof (job_proof), and extract synthetic document data into the citizen profile.",
    parameters: Type.Object({
      docType: Type.Optional(Type.Union([
        Type.Literal("cnic"),
        Type.Literal("utility"),
        Type.Literal("job"),
        Type.Literal("utility_bill"),
        Type.Literal("job_proof"),
      ])),
    }),
    async execute(_id, input) {
      if (!canOpen(profile.role, "profile")) throw new ApiError(403, "Your role cannot open My Profile.");
      const docType = input.docType || "cnic";
      emit({ type: "open_mini_app", app: "profile" });
      emit({ type: "profile_add_sample_visual", docType });
      return textResult({ openedProfile: true, uploadingSampleDoc: docType, message: `Opened My Profile and added sample ${docType.replaceAll("_", " ").toUpperCase()} document.` });
    },
  });

  pi.registerTool({
    name: "profile_view_document",
    label: "View profile document photo",
    description: "Open My Profile and zoom/view an uploaded document photo (cnic, utility_bill, or job_proof) in the fullscreen lightbox.",
    parameters: Type.Object({
      docType: Type.Optional(Type.Union([Type.Literal("cnic"), Type.Literal("utility_bill"), Type.Literal("job_proof")])),
    }),
    async execute(_id, input) {
      if (!canOpen(profile.role, "profile")) throw new ApiError(403, "Your role cannot open My Profile.");
      emit({ type: "open_mini_app", app: "profile" });
      emit({ type: "profile_view_document", docType: input.docType });
      return textResult({ viewingDocument: input.docType ?? "latest" });
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

  pi.registerTool({
    name: "persona_switch",
    label: "Switch demo persona",
    description: "Switch the active demo persona to another user/role (fatima: citizen, zainab: health worker/helper, tariq: shopkeeper, bilal: officer/reviewer, sana: admin, kamran: auditor).",
    parameters: Type.Object({
      persona: Type.String({ maxLength: 40 }),
    }),
    async execute(_id, input) {
      const norm = input.persona.toLowerCase().replace(/[^a-z]/g, "");
      const roleAliases: Record<string, Persona> = {
        citizen: "fatima",
        fatima: "fatima",
        helper: "zainab",
        healthworker: "zainab",
        zainab: "zainab",
        shopkeeper: "tariq",
        karyana: "tariq",
        store: "tariq",
        tariq: "tariq",
        officer: "bilal",
        reviewer: "bilal",
        bilal: "bilal",
        admin: "sana",
        administrator: "sana",
        sana: "sana",
        auditor: "kamran",
        compliance: "kamran",
        kamran: "kamran",
      };
      const matched =
        roleAliases[norm] ??
        (Object.entries(roleAliases).find(([alias]) => norm.includes(alias))?.[1]) ??
        (Object.keys(personas) as Persona[]).find(p => norm.includes(p) || p.includes(norm));
      if (!matched) throw new ApiError(400, "Unknown persona. Choose: fatima (citizen), zainab (helper), tariq (shopkeeper), bilal (officer), sana (admin), or kamran (auditor).");
      emit({ type: "switch_persona", persona: matched });
      return textResult({ switchedTo: matched, name: personas[matched].name, role: personas[matched].role });
    },
  });

  pi.registerTool({
    name: "family_switch_select",
    label: "Select family",
    description: "Open Family Switch and switch the active family/household by name or ID.",
    parameters: Type.Object({
      familyName: Type.Optional(Type.String({ maxLength: 100 })),
      familyId: Type.Optional(Type.String({ maxLength: 60 })),
    }),
    async execute(_id, input) {
      if (!canOpen(profile.role, "family")) throw new ApiError(403, "Your role cannot switch families.");
      emit({ type: "open_mini_app", app: "family" });
      emit({ type: "switch_family_action", citizenId: input.familyId, familyName: input.familyName });
      return textResult({ openedFamilySwitch: true, family: input.familyName || input.familyId || "selected" });
    },
  });

  pi.registerTool({
    name: "review_claim_action",
    label: "Review claim",
    description: "Perform Review Desk operations: select a claim to inspect, go back to the board ('back'), produce an AI case assessment summary ('summary'), or record a decision ('approve', 'reject', 'more_proof') with optional reason.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("select"),
        Type.Literal("back"),
        Type.Literal("summary"),
        Type.Literal("approve"),
        Type.Literal("reject"),
        Type.Literal("more_proof"),
      ]),
      claimId: Type.Optional(Type.String({ maxLength: 60 })),
      citizenName: Type.Optional(Type.String({ maxLength: 100 })),
      reason: Type.Optional(Type.String({ maxLength: 600 })),
      reasonUr: Type.Optional(Type.String({ maxLength: 600 })),
    }),
    async execute(_id, input) {
      if (!canOpen(profile.role, "review")) throw new ApiError(403, "Your role cannot review claims.");
      emit({ type: "open_mini_app", app: "review" });
      if (input.action === "back") {
        emit({ type: "review_back_to_board" });
        return textResult({ returnedToBoard: true });
      }
      if (input.action === "select") {
        emit({ type: "review_select_claim", claimId: input.claimId, citizenName: input.citizenName });
        return textResult({ selectedClaim: input.claimId || input.citizenName || "first" });
      }
      if (input.action === "summary") {
        emit({ type: "review_produce_summary", claimId: input.claimId, citizenName: input.citizenName });
        return textResult({ producedAiSummary: true, claimId: input.claimId || input.citizenName || "current" });
      }
      emit({
        type: "review_decide_claim",
        claimId: input.claimId,
        citizenName: input.citizenName,
        decision: input.action,
        reason: input.reason,
        reasonUr: input.reasonUr,
      });
      return textResult({ recordedDecision: input.action, claimId: input.claimId || input.citizenName || "current", reason: input.reason });
    },
  });

  pi.registerTool({
    name: "review_disburse_payment",
    label: "Disburse payment",
    description: "Issue, retry, or simulate a failure for a simulated Raast payment on an approved claim in Review Desk.",
    parameters: Type.Object({
      claimId: Type.Optional(Type.String({ maxLength: 60 })),
      citizenName: Type.Optional(Type.String({ maxLength: 100 })),
      outcome: Type.Optional(Type.Union([Type.Literal("paid"), Type.Literal("failed")])),
    }),
    async execute(_id, input) {
      if (!canOpen(profile.role, "review")) throw new ApiError(403, "Your role cannot disburse payments.");
      emit({ type: "open_mini_app", app: "review" });
      emit({ type: "review_disburse", claimId: input.claimId, citizenName: input.citizenName, outcome: input.outcome || "paid" });
      return textResult({ disbursedPayment: true, outcome: input.outcome || "paid" });
    },
  });

  pi.registerTool({
    name: "review_set_filter",
    label: "Filter review queue",
    description: "Filter the Review Desk queue by status (all, accepted, rejected) and/or sort by reliability score (asc, desc).",
    parameters: Type.Object({
      filter: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("accepted"), Type.Literal("rejected")])),
      sort: Type.Optional(Type.Union([Type.Literal("asc"), Type.Literal("desc")])),
    }),
    async execute(_id, input) {
      if (!canOpen(profile.role, "review")) throw new ApiError(403, "Your role cannot access review desk.");
      emit({ type: "open_mini_app", app: "review" });
      emit({ type: "review_filter", filter: input.filter || "all", sort: input.sort });
      return textResult({ setFilter: input.filter || "all", sort: input.sort });
    },
  });

  pi.registerTool({
    name: "rules_configure_and_simulate",
    label: "Configure or simulate rules",
    description: "Open Rule Studio, update rule parameters (income cap, min household, payout, confidence threshold) and optionally simulate impact on historical cases (Digital Twin).",
    parameters: Type.Object({
      incomeCap: Type.Optional(Type.Number({ minimum: 0, maximum: 10000000 })),
      minimumHousehold: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
      amountPkr: Type.Optional(Type.Number({ minimum: 1, maximum: 1000000 })),
      confidenceThreshold: Type.Optional(Type.Number({ minimum: 0.5, maximum: 1 })),
      name: Type.Optional(Type.String({ maxLength: 100 })),
      simulate: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, input) {
      if (!canOpen(profile.role, "rules")) throw new ApiError(403, "Your role cannot edit scheme rules.");
      const patch: Partial<RuleConfig> = {};
      if (input.incomeCap !== undefined) patch.income_cap = input.incomeCap;
      if (input.minimumHousehold !== undefined) patch.minimum_household = input.minimumHousehold;
      if (input.amountPkr !== undefined) patch.amount_pkr = input.amountPkr;
      if (input.confidenceThreshold !== undefined) patch.confidence_threshold = input.confidenceThreshold;
      emit({ type: "open_mini_app", app: "rules" });
      if (Object.keys(patch).length > 0 || input.name) {
        emit({ type: "rules_update_config", config: patch, name: input.name });
      }
      if (input.simulate) {
        emit({ type: "rules_simulate", config: Object.keys(patch).length > 0 ? patch : undefined });
      }
      return textResult({ updatedRuleConfig: patch, simulated: Boolean(input.simulate) });
    },
  });

  pi.registerTool({
    name: "rules_publish_version",
    label: "Publish rule version",
    description: "Publish a new live eligibility rule version in Rule Studio. Any omitted parameter inherits the current Rule Studio draft/active rule.",
    parameters: Type.Object({
      name: Type.Optional(Type.String({ minLength: 3, maxLength: 100 })),
      incomeCap: Type.Optional(Type.Number({ minimum: 0, maximum: 10000000 })),
      minimumHousehold: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
      amountPkr: Type.Optional(Type.Number({ minimum: 1, maximum: 1000000 })),
      confidenceThreshold: Type.Optional(Type.Number({ minimum: 0.5, maximum: 1 })),
    }),
    async execute(_id, input) {
      if (!canOpen(profile.role, "rules")) throw new ApiError(403, "Your role cannot publish scheme rules.");
      const patch: Partial<RuleConfig> = {};
      if (input.incomeCap !== undefined) patch.income_cap = input.incomeCap;
      if (input.minimumHousehold !== undefined) patch.minimum_household = input.minimumHousehold;
      if (input.amountPkr !== undefined) patch.amount_pkr = input.amountPkr;
      if (input.confidenceThreshold !== undefined) patch.confidence_threshold = input.confidenceThreshold;
      emit({ type: "open_mini_app", app: "rules" });
      emit({ type: "rules_publish", config: Object.keys(patch).length ? patch : undefined, name: input.name });
      return textResult({ publishedRuleName: input.name || context.screenContext?.rules?.activeName || "Updated rule", configPatch: patch });
    },
  });

  pi.registerTool({
    name: "rules_staff_approval",
    label: "Approve or reject staff access",
    description: "Approve or reject a pending staff access request in Rule Studio by userId or staffName.",
    parameters: Type.Object({
      userId: Type.Optional(Type.String({ maxLength: 60 })),
      staffName: Type.Optional(Type.String({ maxLength: 100 })),
      decision: Type.Union([Type.Literal("active"), Type.Literal("rejected")]),
    }),
    async execute(_id, input) {
      if (!canOpen(profile.role, "rules")) throw new ApiError(403, "Your role cannot manage staff access.");
      if (!input.userId && !input.staffName) throw new ApiError(400, "Provide userId or staffName.");
      emit({ type: "open_mini_app", app: "rules" });
      emit({ type: "rules_staff_decision", userId: input.userId, staffName: input.staffName, decision: input.decision });
      return textResult({ target: input.staffName || input.userId, decision: input.decision });
    },
  });

  pi.registerTool({
    name: "scheme_budget_adjust",
    label: "Adjust scheme budget",
    description: "Update the emergency relief scheme budget total PKR (Administrator only) and record a reason (at least 5 characters).",
    parameters: Type.Object({
      totalPkr: Type.Number({ minimum: 0, maximum: 999999999999 }),
      reason: Type.String({ minLength: 5, maxLength: 300 }),
    }),
    async execute(_id, input) {
      if (profile.role !== "admin") throw new ApiError(403, "Only scheme administrators can update the scheme budget.");
      emit({ type: "budget_update", totalPkr: Math.round(input.totalPkr), reason: input.reason.trim() });
      return textResult({ updatedBudgetPkr: Math.round(input.totalPkr), reason: input.reason.trim() });
    },
  });

  pi.registerTool({
    name: "audit_vault_control",
    label: "Control Audit Vault",
    description: "Open Audit Vault and switch tabs ('events' or 'eval' for Decision Safety Eval), filter by category ('all', 'claims', 'ai', 'consent', 'blocked'), search events, inspect an event row by index, or refresh.",
    parameters: Type.Object({
      tab: Type.Optional(Type.Union([Type.Literal("events"), Type.Literal("eval")])),
      category: Type.Optional(Type.Union([
        Type.Literal("all"),
        Type.Literal("claims"),
        Type.Literal("ai"),
        Type.Literal("consent"),
        Type.Literal("blocked"),
      ])),
      query: Type.Optional(Type.String({ maxLength: 120 })),
      selectIndex: Type.Optional(Type.Integer({ minimum: 0, maximum: 50 })),
      refresh: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, input) {
      if (!canOpen(profile.role, "audit")) throw new ApiError(403, "Your role cannot open Audit Vault.");
      emit({ type: "open_mini_app", app: "audit" });
      emit({
        type: "audit_control",
        tab: input.tab,
        category: input.category,
        query: input.query,
        selectIndex: input.selectIndex,
        refresh: input.refresh,
      });
      return textResult({ auditControl: input });
    },
  });

  pi.registerTool({
    name: "whatsapp_configure_agent",
    label: "Control WhatsApp AI Agent",
    description: "Open WhatsApp Link and connect an API key (action='connect'), disconnect the key (action='disconnect'), send a test message in the simulator (action='test_message'), or search live WhatsApp messages (action='search').",
    parameters: Type.Object({
      action: Type.Optional(Type.Union([
        Type.Literal("connect"),
        Type.Literal("disconnect"),
        Type.Literal("test_message"),
        Type.Literal("search"),
      ])),
      apiKey: Type.Optional(Type.String({ maxLength: 200 })),
      agentName: Type.Optional(Type.String({ maxLength: 60 })),
      testText: Type.Optional(Type.String({ maxLength: 500 })),
      searchQuery: Type.Optional(Type.String({ maxLength: 120 })),
    }),
    async execute(_id, input) {
      const action = input.action ?? (input.apiKey ? "connect" : input.testText ? "test_message" : input.searchQuery !== undefined ? "search" : "connect");
      emit({ type: "open_mini_app", app: "whatsapp" });
      if (action === "disconnect") {
        emit({ type: "whatsapp_disconnect" });
        return textResult({ disconnectedWhatsApp: true });
      }
      if (action === "test_message" && input.testText?.trim()) {
        emit({ type: "whatsapp_send_test", text: input.testText.trim() });
        return textResult({ sentTestMessage: input.testText.trim() });
      }
      if (action === "search" && input.searchQuery !== undefined) {
        emit({ type: "search_app_visual", app: "whatsapp", query: input.searchQuery.trim() });
        return textResult({ searchedWhatsApp: input.searchQuery.trim() });
      }
      if (!input.apiKey?.trim()) {
        return textResult({ openedWhatsApp: true, needsApiKey: true });
      }
      emit({ type: "whatsapp_set_key", key: input.apiKey.trim(), agentName: input.agentName?.trim() || undefined });
      return textResult({ configuredWhatsAppKey: true, agentName: input.agentName?.trim() || "Ali" });
    },
  });

  pi.registerTool({
    name: "window_manage",
    label: "Manage workspace window or desktop controls",
    description: "Close, close_all, minimize, restore, or resize ('compact'/'default'/'wide') an open mini-app window, open desktop panels ('open_account_menu', 'open_persona_switcher', 'open_notifications'), sync offline queue ('sync_now'), or toggle 2G Lite mode or simulated network drop.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("close"),
        Type.Literal("close_all"),
        Type.Literal("minimize"),
        Type.Literal("restore"),
        Type.Literal("resize"),
        Type.Literal("toggle_lite"),
        Type.Literal("toggle_network_drop"),
        Type.Literal("open_account_menu"),
        Type.Literal("open_persona_switcher"),
        Type.Literal("open_notifications"),
        Type.Literal("sync_now"),
      ]),
      app: Type.Optional(Type.String({ maxLength: 40 })),
      preset: Type.Optional(Type.Union([Type.Literal("compact"), Type.Literal("default"), Type.Literal("wide")])),
    }),
    async execute(_id, input) {
      if (input.action === "toggle_lite") {
        emit({ type: "toggle_feature", feature: "lite" });
        return textResult({ toggledLiteMode: true });
      }
      if (input.action === "toggle_network_drop") {
        emit({ type: "toggle_feature", feature: "network_drop" });
        return textResult({ toggledNetworkDrop: true });
      }
      if (input.action === "close_all") {
        emit({ type: "close_all_windows" });
        return textResult({ closedAllWindows: true });
      }
      if (input.action === "open_account_menu") {
        emit({ type: "workspace_ui_panel", panel: "account_menu", open: true });
        return textResult({ openedPanel: "account_menu" });
      }
      if (input.action === "open_persona_switcher") {
        emit({ type: "workspace_ui_panel", panel: "persona_switcher", open: true });
        return textResult({ openedPanel: "persona_switcher" });
      }
      if (input.action === "open_notifications") {
        emit({ type: "workspace_ui_panel", panel: "notifications", open: true });
        return textResult({ openedPanel: "notifications" });
      }
      if (input.action === "sync_now") {
        emit({ type: "workspace_sync" });
        return textResult({ triggeredSync: true });
      }
      const targetApp = resolveApp(input.app) || (context.screenContext?.activeApp ? resolveApp(context.screenContext.activeApp) : null);
      if (!targetApp) throw new ApiError(400, "Specify which app window to close, minimize, resize, or restore.");
      if (input.action === "close") {
        emit({ type: "close_window", app: targetApp });
      } else if (input.action === "minimize") {
        emit({ type: "minimize_window", app: targetApp });
      } else if (input.action === "resize") {
        emit({ type: "window_resize", app: targetApp, preset: input.preset ?? "wide" });
      } else if (input.action === "restore") {
        emit({ type: "open_mini_app", app: targetApp });
      }
      return textResult({ action: input.action, app: targetApp, preset: input.preset });
    },
  });
}
