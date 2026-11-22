import { z } from "zod";

export const personas = {
  fatima: { name: "Fatima Bibi", role: "citizen", description: "Apply for aid and manage consent" },
  zainab: { name: "Zainab Health Worker", role: "helper", description: "Help families file and track claims" },
  tariq: { name: "Tariq Karyana Store", role: "shopkeeper", description: "Check alerts and report missing payments" },
  bilal: { name: "Reviewer Bilal", role: "officer", description: "Review claims and issue mock payments" },
  sana: { name: "Admin Sana", role: "admin", description: "Publish scheme rules and compare impact" },
  kamran: { name: "Auditor Kamran", role: "auditor", description: "Inspect decisions and safety metrics" },
} as const;

export type Persona = keyof typeof personas;
export type Role = (typeof personas)[Persona]["role"];
export type Profile = { id: string; full_name: string; role: Role; locale: "en" | "ur"; citizen_id: string | null };
export const uuid = z.uuid();
const person = uuid.nullish();
const testKey = uuid;

export const payloadSchema = z.object({
  monthly_income: z.number().int().min(0).max(10000000),
  household_size: z.number().int().min(1).max(100),
  notes: z.string().trim().max(600).default(""),
});

export const ruleSchema = z.object({
  income_cap: z.number().int().min(0).max(10000000),
  minimum_household: z.number().int().min(1).max(100),
  amount_pkr: z.number().int().min(1).max(1000000),
  confidence_threshold: z.number().min(0.5).max(1),
});

const budgetAmount = z.number().int().min(0).max(999999999999);

export const actions = {
  profile: z.object({}),
  claims: z.object({ citizenId: person }),
  draft: z.object({ citizenId: person, claimId: person, key: testKey, payload: payloadSchema }),
  submit: z.object({ citizenId: person, claimId: person, key: testKey, payload: payloadSchema }),
  evidence: z.object({
    citizenId: person, claimId: uuid, key: testKey, docType: z.enum(["identity", "income"]),
    fixture: z.enum(["clear", "blurred", "altered", "incomplete"]).optional(),
    image: z.string().max(2800000).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).optional(),
  }).refine(data => Boolean(data.fixture) !== Boolean(data.image), "Choose one synthetic document source."),
  queue: z.object({}),
  overview: z.object({}),
  scheme_budget: z.object({}),
  set_scheme_budget: z.object({ totalPkr: budgetAmount, expectedTotalPkr: budgetAmount, reason: z.string().trim().min(5).max(300) }),
  staff_queue: z.object({}),
  decide_staff: z.object({ userId: uuid, decision: z.enum(["active", "rejected"]) }),
  review: z.object({ claimId: uuid, decision: z.enum(["assign", "more_proof", "escalate", "approve", "reject", "close"]),
    reason: z.string().trim().min(5).max(600), reasonUr: z.string().trim().max(600).optional(),
    aiSummary: z.string().trim().max(3000).optional() }),
  claim_summary: z.object({ claimId: uuid }),
  quick_review: z.object({
    claimId: uuid,
    decision: z.enum(["approve", "reject", "more_proof"]),
    reason: z.string().trim().max(600).optional(),
    reasonUr: z.string().trim().max(600).optional(),
  }),
  disburse: z.object({ claimId: uuid, outcome: z.enum(["paid", "failed"]).default("paid") }),
  families: z.object({}),
  switch_family: z.object({ citizenId: uuid }),
  privacy: z.object({ citizenId: person }),
  consent: z.object({ citizenId: uuid, helperId: uuid, key: testKey, consent: z.enum(["granted", "revoked"]) }),
  correction: z.object({ citizenId: person, key: testKey, field: z.enum(["full_name", "phone", "village_area", "household_size", "monthly_income_mock"]),
    value: z.string().trim().min(1).max(160) }),
  check: z.object({
    message: z.string().trim().max(1500).default(""),
    reference: z.string().trim().max(80).default(""),
    image: z.string().max(2800000).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).optional(),
  }).refine(data => data.message.length > 0 || data.reference.length > 0 || Boolean(data.image), "Enter a message, payment reference, or attach a screenshot."),
  report: z.object({ reference: z.string().trim().min(1).max(80), message: z.string().trim().max(1200).default(""), key: testKey }),
  policy: z.object({ question: z.string().trim().min(3).max(500) }),
  rules: z.object({}),
  publish: z.object({ name: z.string().trim().min(3).max(100), config: ruleSchema }),
  simulate: z.object({ config: ruleSchema }),
  audit: z.object({}),
  safety: z.object({}),
  nadra: z.object({ citizenId: person }),
  citizen_profile: z.object({ citizenId: person }),
  citizen_doc_upload: z.object({
    citizenId: person,
    docType: z.enum(["cnic", "utility_bill", "job_proof"]),
    applyToCore: z.boolean().default(true),
    useSample: z.boolean().default(false),
    image: z.string().max(2800000).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/).optional(),
  }).refine(data => Boolean(data.image) || data.useSample, "Upload a synthetic document image or choose a sample."),
  scheme: z.object({}),
  raast: z.object({ reference: z.string().trim().min(1).max(80) }),
};
export type Action = keyof typeof actions;
export type Payload = z.infer<typeof payloadSchema>;
export type RuleConfig = z.infer<typeof ruleSchema>;
export type Rule = { id: string; version: number; name: string; config_json: RuleConfig; is_active: boolean; created_at: string };
export type ClaimStatus = "draft" | "submitted" | "needs_proof" | "in_review" | "approved" | "rejected" | "closed";
export type Payment = { id: string; raast_ref: string; amount_pkr: number; status: "pending" | "paid" | "failed"; disbursed_at: string | null };
export type Overview = { active: number; review: number; proof: number; approved: number; rejected: number;
  closed: number; paid: number; new_this_month: number; priority: number };
export type SchemeBudget = { total_pkr: number; available_pkr: number; reserved_pkr: number; paid_pkr: number;
  awaiting_claims: number; funded_claims: number };
export type Evidence = { id: string; doc_type: string; file_url: string | null; tamper_flag: boolean; tamper_reason: string | null;
  blur_score: number | null; verified_status: string; ocr_json: { summary?: string; fields?: Record<string, string>; fixture?: string };
  fixture?: string | null };
export type Claim = { id: string; citizen_id: string; citizen_name?: string; status: ClaimStatus; payment_status: Payment["status"];
  funding_status?: "awaiting_funds" | "reserved" | "paid" | null;
  amount_pkr: number; payload_json: Partial<Payload>; citizen_reason_en: string | null; citizen_reason_ur: string | null;
  rule_version_used: number | null; ai_confidence: number | null; ai_route: string | null; handoff_notes: string | null;
  assigned_officer_id: string | null; updated_at: string; created_at?: string; reports?: number; payment?: Payment | null; documents?: Evidence[];
  ai_summary?: string | null };
export type VerificationCheck = { label: string; status: "pass" | "warn" | "fail"; detail: string };
export type ClaimSummaryResult = {
  claimId: string;
  citizenName: string;
  recommendation: "approve" | "reject" | "more_proof";
  confidence: number;
  summary: string;
  reason: string;
  reasonUr: string;
  riskFlags: string[];
  checks: VerificationCheck[];
  model: string;
};
export type Policy = { id: string; policy_version: string; section_code: string; title: string; effective_date: string; content: string; keywords: string[] };
export type PolicyAnswer = { answer: string; citations: Policy[]; policy_version: string; effective_date: string | null };
export type Audit = { id: number; actor_role: string; event_type: string; entity_type: string; entity_id: string | null;
  rule_version: number | null; model_version: string; confidence: number | null; outcome: string; metadata_json: Record<string, unknown>; created_at: string };
export type Family = { id: string; full_name: string; village_area: string; consent: string };
export type Correction = { id: string; field_name: string; proposed_value: string; status: string };
export type Privacy = { helpers: { id: string; name: string; status: string }[]; officers: string[]; corrections: Correction[] };
export type ScamToolTrace = { name: string; target: string; status: "complete" | "error"; detail?: string };
export type ScamResult = { id: string; claim_id: string | null; jev_label: string; jev_confidence: number; jev_route: string;
  rail_match_status: string; payment: Payment | null; model: string;
  explanation?: string; red_flags?: string[]; extracted_text?: string; detected_reference?: string;
  citations?: Policy[]; tools_used?: ScamToolTrace[] };

export type CitizenDocument = {
  id: string;
  citizen_id: string;
  doc_type: "cnic" | "utility_bill" | "job_proof" | "income" | "other";
  file_url: string | null;
  extracted_json: { summary?: string; note?: string; fields?: Record<string, string>; model?: string };
  blur_score: number | null;
  tamper_flag: boolean;
  tamper_reason: string | null;
  verified_status: string;
  model_version: string;
  confidence: number | null;
  created_at: string;
};
export type CitizenRecord = {
  id: string;
  cnic_mock: string;
  full_name: string;
  name_phonetic: string;
  household_size: number;
  monthly_income_mock: number;
  phone: string;
  village_area: string;
  profile_metadata_json?: Record<string, unknown>;
  updated_at?: string;
};
export type CitizenProfileData = { citizen: CitizenRecord; documents: CitizenDocument[] };

export const appRoles = {
  claim: ["citizen", "helper", "officer", "admin", "auditor"],
  profile: ["citizen", "helper", "officer", "admin", "auditor"],
  scam: ["citizen", "helper", "shopkeeper", "officer", "admin", "auditor"],
  policy: ["citizen", "helper", "shopkeeper", "officer", "admin", "auditor"],
  privacy: ["citizen", "helper", "officer", "admin", "auditor"],
  family: ["helper", "officer", "admin"],
  review: ["officer", "admin", "auditor"],
  rules: ["admin", "officer"],
  users: ["admin", "officer", "auditor"],
  audit: ["admin", "auditor", "officer"],
  whatsapp: ["citizen", "helper", "shopkeeper", "officer", "admin", "auditor"],
} satisfies Record<string, Role[]>;
export type MiniApp = keyof typeof appRoles;
export function canOpen(role: Role, app: MiniApp) {
  if (!Object.hasOwn(appRoles, app)) return false;
  const allowed: Role[] = appRoles[app];
  return allowed.includes(role);
}

export type UIAction = { type: "open_mini_app"; app: MiniApp }
  | { type: "start_new_claim"; fields?: Partial<Payload> }
  | { type: "claim_back_to_list" }
  | { type: "prefill_fields"; fields: Partial<Payload>; claimId?: string; saved?: boolean }
  | { type: "advance_claim_step"; step: "household" | "evidence" | "review" | "submit" | "list"; docType?: "identity" | "income"; fixture?: "clear" | "blurred" | "altered" | "incomplete"; attachEvidence?: boolean }
  | { type: "ask_policy_visual"; question: string }
  | { type: "check_scam_visual"; message: string; reference?: string }
  | { type: "privacy_correction_visual"; field: "full_name" | "phone" | "village_area" | "household_size" | "monthly_income_mock"; value: string }
  | { type: "privacy_helper_consent_visual"; consent: "revoked" | "granted"; helperId?: string; helperName?: string }
  | { type: "search_app_visual"; app: "family" | "review" | "users"; query: string }
  | { type: "profile_add_sample_visual"; docType?: "cnic" | "utility" | "job" }
  | { type: "show_jev_badge"; label: string; confidence: number; route: MiniApp | "clarification"; model: string }
  | { type: "ask_clarification"; question: string; options: MiniApp[] }
  | { type: "highlight_alert"; severity: "warning" | "info"; message: string };
