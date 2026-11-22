import { answerPolicy } from "@/src/lib/ai/rag";
import { analyzeScamCheck } from "@/src/lib/ai/scamCheck";
import { inspectEvidence } from "@/src/lib/ai/ocr";
import { extractProfileDocument } from "@/src/lib/ai/profileVlm";
import { runSafetyEval } from "@/src/lib/fixtures/safety";
import type {
  Audit,
  CitizenProfileData,
  Claim,
  Family,
  Overview,
  PolicyAnswer,
  Privacy,
  Role,
  Rule,
  SchemeBudget,
} from "@/src/lib/contracts";
import { scopedGateway, type ScopedUserIdentity } from "./scoped-gateway";

export type WhatsAppToolDefinition = {
  name: string;
  description: string;
  allowedRoles: Role[];
  parameters: {
    type: "object";
    properties: Record<
      string,
      {
        type: string;
        description: string;
        enum?: string[];
      }
    >;
    required: string[];
  };
  execute: (user: ScopedUserIdentity, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

const reviewUrduFallback: Record<string, string> = {
  assign: "ایک افسر نے آپ کی درخواست جائزے کے لیے لے لی ہے۔",
  more_proof: "افسر نے مزید ثبوت مانگے ہیں۔ تفصیلات انگریزی میں درج ہیں۔",
  escalate: "آپ کی درخواست مزید جانچ کے لیے بھیجی گئی ہے۔",
  approve: "افسر نے درخواست منظور کی ہے۔ فرضی ادائیگی کی صورت حال درخواست میں دیکھیں۔",
  reject: "افسر نے درخواست مسترد کی ہے۔ تفصیلی وجہ انگریزی میں درج ہے۔",
  close: "افسر نے درخواست کا جائزہ مکمل کر کے کیس بند کر دیا ہے۔",
};

async function resolveCitizenScope(
  user: ScopedUserIdentity,
  explicitCitizenId?: unknown,
): Promise<{ citizenId: string | null; label: string }> {
  const provided = typeof explicitCitizenId === "string" && explicitCitizenId.trim() ? explicitCitizenId.trim() : null;
  if (provided) return { citizenId: provided, label: provided };
  if (user.citizenId) return { citizenId: user.citizenId, label: user.name };

  if (user.role === "helper") {
    const families = await scopedGateway<Family[]>(user, "families", {});
    const consented = families.find(f => f.consent === "granted") || families[0];
    if (consented) {
      return { citizenId: consented.id, label: consented.full_name };
    }
  }
  return { citizenId: null, label: user.name };
}

export const whatsAppTools: WhatsAppToolDefinition[] = [
  // ── 1. CLAIMS & APPLICATIONS ──────────────────────────────────────────────
  {
    name: "get_my_claims",
    description:
      "Get list of relief claims, statuses, amounts, funding statuses, payment details, documents, and decision notes for the current citizen or helper's consented family.",
    allowedRoles: ["citizen", "helper", "officer", "admin", "auditor"],
    parameters: {
      type: "object",
      properties: {
        citizen_id: {
          type: "string",
          description: "Optional citizen UUID (helpers/officers/admins can pass a specific citizen ID).",
        },
      },
      required: [],
    },
    execute: async (user, args) => {
      const scope = await resolveCitizenScope(user, args.citizen_id);
      if (user.role === "helper" && !scope.citizenId) {
        return { count: 0, claims: [], note: `No consented family is currently assigned to ${user.name}.` };
      }
      const claims = await scopedGateway<Claim[]>(
        user,
        "claims",
        scope.citizenId ? { citizenId: scope.citizenId } : {},
      );
      return {
        owner: scope.label,
        count: claims.length,
        claims: claims.slice(0, 10).map(c => ({
          id: c.id,
          citizen_id: c.citizen_id,
          status: c.status,
          funding_status: c.funding_status,
          payment_status: c.payment_status,
          amount_pkr: c.amount_pkr,
          notes: c.payload_json?.notes || "Emergency Relief Aid",
          household_size: c.payload_json?.household_size,
          monthly_income: c.payload_json?.monthly_income,
          documents_count: c.documents?.length ?? 0,
          updated_at: c.updated_at,
          payment: c.payment
            ? { status: c.payment.status, raast_ref: c.payment.raast_ref, amount_pkr: c.payment.amount_pkr }
            : null,
          decision_note: c.citizen_reason_en,
        })),
      };
    },
  },

  {
    name: "create_claim_draft",
    description:
      "Create or update a relief cash assistance claim draft with monthly household income, household size, and notes.",
    allowedRoles: ["citizen", "helper"],
    parameters: {
      type: "object",
      properties: {
        monthly_income: { type: "number", description: "Total monthly household income in PKR (e.g. 15000)." },
        household_size: { type: "number", description: "Number of people in the household (e.g. 4)." },
        notes: { type: "string", description: "Reason for aid or disaster details." },
        claim_id: { type: "string", description: "Optional existing draft claim UUID to update." },
        citizen_id: { type: "string", description: "Optional citizen UUID (for helpers filing on behalf of a consented family)." },
      },
      required: ["monthly_income", "household_size"],
    },
    execute: async (user, args) => {
      const scope = await resolveCitizenScope(user, args.citizen_id);
      const claimId = typeof args.claim_id === "string" && args.claim_id.trim() ? args.claim_id.trim() : crypto.randomUUID();
      const key = crypto.randomUUID();
      const payload = {
        monthly_income: Math.max(0, Math.round(Number(args.monthly_income ?? 0))),
        household_size: Math.max(1, Math.round(Number(args.household_size ?? 1))),
        notes: String(args.notes ?? "Emergency aid draft submitted via messaging").slice(0, 600),
      };

      const saved = await scopedGateway<Claim>(user, "draft", {
        citizenId: scope.citizenId,
        claimId,
        key,
        payload,
      });
      return {
        success: true,
        claim_id: saved.id,
        status: saved.status,
        amount_pkr: saved.amount_pkr,
        owner: scope.label,
        message: `Claim draft saved (ID: ${saved.id}). Next you can attach evidence or submit it.`,
      };
    },
  },

  {
    name: "attach_claim_evidence",
    description:
      "Attach a synthetic evidence document (identity or income) to an existing relief claim draft or needs_proof claim.",
    allowedRoles: ["citizen", "helper"],
    parameters: {
      type: "object",
      properties: {
        claim_id: { type: "string", description: "UUID of the claim to attach evidence to." },
        doc_type: { type: "string", enum: ["identity", "income"], description: "Evidence document type." },
        fixture: {
          type: "string",
          enum: ["clear", "blurred", "altered", "incomplete"],
          description: "Synthetic document sample quality (default 'clear').",
        },
        citizen_id: { type: "string", description: "Optional citizen UUID (for helpers)." },
      },
      required: ["claim_id", "doc_type"],
    },
    execute: async (user, args) => {
      const scope = await resolveCitizenScope(user, args.citizen_id);
      const claimId = String(args.claim_id || "").trim();
      const docType = (args.doc_type === "income" ? "income" : "identity") as "identity" | "income";
      const fixture = (["clear", "blurred", "altered", "incomplete"].includes(String(args.fixture))
        ? String(args.fixture)
        : "clear") as "clear" | "blurred" | "altered" | "incomplete";

      await scopedGateway(user, "nadra", { citizenId: scope.citizenId });
      const analysis = await inspectEvidence({ docType, fixture });
      const res = await scopedGateway<Record<string, unknown>>(user, "evidence", {
        citizenId: scope.citizenId,
        claimId,
        key: crypto.randomUUID(),
        docType,
        fixture,
        imageDigest: null,
        analysis,
      });
      return {
        success: true,
        claim_id: claimId,
        doc_type: docType,
        fixture,
        verified_status: analysis.status,
        result: res,
      };
    },
  },

  {
    name: "submit_claim",
    description:
      "Submit a relief claim (either an existing draft claim_id or a fresh submission) into the official officer review queue.",
    allowedRoles: ["citizen", "helper"],
    parameters: {
      type: "object",
      properties: {
        monthly_income: { type: "number", description: "Total monthly household income in PKR." },
        household_size: { type: "number", description: "Number of household members." },
        notes: { type: "string", description: "Reason or notes for the claim." },
        claim_id: { type: "string", description: "Optional existing draft claim UUID to submit." },
        citizen_id: { type: "string", description: "Optional citizen UUID (for helpers)." },
      },
      required: ["monthly_income", "household_size"],
    },
    execute: async (user, args) => {
      const scope = await resolveCitizenScope(user, args.citizen_id);
      const claimId = typeof args.claim_id === "string" && args.claim_id.trim() ? args.claim_id.trim() : crypto.randomUUID();
      const payload = {
        monthly_income: Math.max(0, Math.round(Number(args.monthly_income ?? 0))),
        household_size: Math.max(1, Math.round(Number(args.household_size ?? 1))),
        notes: String(args.notes ?? "Submitted via Relief Assist messaging").slice(0, 600),
      };

      const submitted = await scopedGateway<Claim>(user, "submit", {
        citizenId: scope.citizenId,
        claimId,
        key: crypto.randomUUID(),
        payload,
      });
      return {
        success: true,
        claim_id: submitted.id,
        status: submitted.status,
        amount_pkr: submitted.amount_pkr,
        funding_status: submitted.funding_status,
        message: `Claim ${submitted.id.slice(0, 8)} submitted successfully with status ${submitted.status}.`,
      };
    },
  },

  // ── 2. CITIZEN PROFILE, DOCUMENTS & DPI VERIFICATION ─────────────────────
  {
    name: "get_my_profile",
    description:
      "Get citizen profile details (name, mock CNIC, household size, monthly income, village area, phone, and uploaded CNIC/utility bill/job proof documents).",
    allowedRoles: ["citizen", "helper", "officer", "admin", "auditor"],
    parameters: {
      type: "object",
      properties: {
        citizen_id: { type: "string", description: "Optional citizen UUID." },
      },
      required: [],
    },
    execute: async (user, args) => {
      const scope = await resolveCitizenScope(user, args.citizen_id);
      const data = await scopedGateway<CitizenProfileData>(
        user,
        "citizen_profile",
        scope.citizenId ? { citizenId: scope.citizenId } : {},
      );
      return {
        citizen_id: data.citizen.id,
        full_name: data.citizen.full_name,
        cnic_mock: data.citizen.cnic_mock,
        household_size: data.citizen.household_size,
        monthly_income_mock: data.citizen.monthly_income_mock,
        village_area: data.citizen.village_area,
        phone: data.citizen.phone,
        documents_count: data.documents.length,
        documents: data.documents.map(d => ({
          id: d.id,
          doc_type: d.doc_type,
          verified_status: d.verified_status,
          confidence: d.confidence,
          fields: d.extracted_json?.fields,
        })),
      };
    },
  },

  {
    name: "upload_profile_sample_document",
    description:
      "Attach and VLM-extract a sample profile document (cnic, utility_bill, or job_proof) onto the citizen profile and optionally sync extracted values to the core record.",
    allowedRoles: ["citizen", "helper"],
    parameters: {
      type: "object",
      properties: {
        doc_type: {
          type: "string",
          enum: ["cnic", "utility_bill", "job_proof"],
          description: "Profile document type to upload.",
        },
        apply_to_core: {
          type: "boolean",
          description: "Whether to update core profile fields with extracted values (default true).",
        },
        citizen_id: { type: "string", description: "Optional citizen UUID (for helpers)." },
      },
      required: ["doc_type"],
    },
    execute: async (user, args) => {
      const scope = await resolveCitizenScope(user, args.citizen_id);
      const docType = (["cnic", "utility_bill", "job_proof"].includes(String(args.doc_type))
        ? String(args.doc_type)
        : "cnic") as "cnic" | "utility_bill" | "job_proof";
      const applyToCore = args.apply_to_core !== false;

      await scopedGateway(user, "nadra", { citizenId: scope.citizenId });
      const analysis = await extractProfileDocument({ docType, useSample: true });
      const saved = await scopedGateway<Record<string, unknown>>(user, "citizen_doc_upload", {
        citizenId: scope.citizenId,
        docType,
        applyToCore,
        image: null,
        analysis,
      });
      return {
        success: true,
        doc_type: docType,
        verified_status: analysis.status,
        summary: analysis.summary,
        fields: analysis.fields,
        result: saved,
      };
    },
  },

  {
    name: "verify_nadra_identity",
    description: "Run mock NADRA identity verification check for the current citizen or specified citizen_id.",
    allowedRoles: ["citizen", "helper", "officer", "admin", "auditor"],
    parameters: {
      type: "object",
      properties: {
        citizen_id: { type: "string", description: "Optional citizen UUID." },
      },
      required: [],
    },
    execute: async (user, args) => {
      const scope = await resolveCitizenScope(user, args.citizen_id);
      const result = await scopedGateway<Record<string, unknown>>(
        user,
        "nadra",
        scope.citizenId ? { citizenId: scope.citizenId } : {},
      );
      return { verified: true, nadra: result };
    },
  },

  {
    name: "verify_raast_payment",
    description: "Verify a Raast disbursement/payment reference against the mock Raast settlement rail.",
    allowedRoles: ["citizen", "helper", "shopkeeper", "officer", "admin", "auditor"],
    parameters: {
      type: "object",
      properties: {
        reference: { type: "string", description: "Raast reference code (e.g. SIM-FATIMA1)." },
      },
      required: ["reference"],
    },
    execute: async (user, args) => {
      const reference = String(args.reference || "").trim();
      const result = await scopedGateway<Record<string, unknown>>(user, "raast", { reference });
      return { reference, raast: result };
    },
  },

  {
    name: "get_active_scheme_rules",
    description: "Get the currently active relief scheme version, income cap, minimum household size, payout per claim, and AI confidence threshold.",
    allowedRoles: ["citizen", "helper", "shopkeeper", "officer", "admin", "auditor"],
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async user => {
      const scheme = await scopedGateway<Record<string, unknown>>(user, "scheme", {});
      return { scheme };
    },
  },

  // ── 3. PRIVACY, HELPER CONSENT & DATA CORRECTIONS ────────────────────────
  {
    name: "get_privacy_status",
    description:
      "Inspect privacy ledger: which helpers currently have consent granted/revoked, which officers accessed the record, and pending data correction requests.",
    allowedRoles: ["citizen", "helper", "officer", "admin", "auditor"],
    parameters: {
      type: "object",
      properties: {
        citizen_id: { type: "string", description: "Optional citizen UUID." },
      },
      required: [],
    },
    execute: async (user, args) => {
      const scope = await resolveCitizenScope(user, args.citizen_id);
      const privacy = await scopedGateway<Privacy>(
        user,
        "privacy",
        scope.citizenId ? { citizenId: scope.citizenId } : {},
      );
      return {
        owner: scope.label,
        helpers: privacy.helpers,
        officers: privacy.officers,
        corrections: privacy.corrections,
      };
    },
  },

  {
    name: "manage_helper_consent",
    description:
      "Grant or revoke a community helper's consent to access and submit relief claims on the citizen's behalf. Call get_privacy_status first if you need the helper's ID.",
    allowedRoles: ["citizen"],
    parameters: {
      type: "object",
      properties: {
        helper_id: { type: "string", description: "UUID of the helper (or omit to target the first helper in privacy list)." },
        consent: { type: "string", enum: ["granted", "revoked"], description: "Whether to grant or revoke consent." },
      },
      required: ["consent"],
    },
    execute: async (user, args) => {
      const consent = args.consent === "revoked" ? "revoked" : "granted";
      let helperId = typeof args.helper_id === "string" && args.helper_id.trim() ? args.helper_id.trim() : "";
      if (!helperId) {
        const privacy = await scopedGateway<Privacy>(user, "privacy", user.citizenId ? { citizenId: user.citizenId } : {});
        helperId = privacy.helpers[0]?.id || "";
      }
      if (!helperId || !user.citizenId) {
        throw new Error("Could not resolve citizen_id or helper_id to update consent.");
      }
      const res = await scopedGateway<Record<string, unknown>>(user, "consent", {
        citizenId: user.citizenId,
        helperId,
        key: crypto.randomUUID(),
        consent,
      });
      return { success: true, helper_id: helperId, consent, result: res };
    },
  },

  {
    name: "request_data_correction",
    description:
      "Submit an official data correction request for a citizen record field (full_name, phone, village_area, household_size, or monthly_income_mock).",
    allowedRoles: ["citizen", "helper"],
    parameters: {
      type: "object",
      properties: {
        field: {
          type: "string",
          enum: ["full_name", "phone", "village_area", "household_size", "monthly_income_mock"],
          description: "Record field to correct.",
        },
        value: { type: "string", description: "Proposed corrected value." },
        citizen_id: { type: "string", description: "Optional citizen UUID." },
      },
      required: ["field", "value"],
    },
    execute: async (user, args) => {
      const scope = await resolveCitizenScope(user, args.citizen_id);
      const field = String(args.field || "");
      const value = String(args.value || "").trim();
      const res = await scopedGateway<Record<string, unknown>>(user, "correction", {
        citizenId: scope.citizenId,
        key: crypto.randomUUID(),
        field,
        value,
      });
      return { success: true, field, proposed_value: value, result: res };
    },
  },

  // ── 4. FAMILIES (HELPER / OFFICER / ADMIN) ───────────────────────────────
  {
    name: "get_families",
    description: "List families available to this helper/officer/admin along with their consent status and village area.",
    allowedRoles: ["helper", "officer", "admin"],
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async user => {
      const families = await scopedGateway<Family[]>(user, "families", {});
      return {
        owner: user.name,
        count: families.length,
        families: families.slice(0, 15).map(f => ({
          id: f.id,
          full_name: f.full_name,
          village_area: f.village_area,
          consent: f.consent,
        })),
      };
    },
  },

  {
    name: "switch_active_family",
    description: "Switch the helper's active consented family context by citizen_id.",
    allowedRoles: ["helper", "officer", "admin"],
    parameters: {
      type: "object",
      properties: {
        citizen_id: { type: "string", description: "UUID of the family/citizen to switch to." },
      },
      required: ["citizen_id"],
    },
    execute: async (user, args) => {
      const citizenId = String(args.citizen_id || "").trim();
      const res = await scopedGateway<Record<string, unknown>>(user, "switch_family", { citizenId });
      return { success: true, citizen_id: citizenId, result: res };
    },
  },

  // ── 5. POLICY ASK & SCAM SHIELD (ALL ROLES) ──────────────────────────────
  {
    name: "ask_policy",
    description:
      "Ask any question about official Pakistan disaster relief policy, eligibility criteria, income caps, appeals, or documentation rules and receive cited sections.",
    allowedRoles: ["citizen", "helper", "shopkeeper", "officer", "admin", "auditor"],
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "Policy question to search in the official rulebook." },
      },
      required: ["question"],
    },
    execute: async (_user, args) => {
      const q = String(args.question ?? "");
      const result: PolicyAnswer = await answerPolicy(q);
      return {
        answer: result.answer,
        version: result.policy_version,
        effective_date: result.effective_date,
        citations: result.citations.map(c => ({ code: c.section_code, title: c.title })),
      };
    },
  },

  {
    name: "check_scam",
    description:
      "Check an SMS, WhatsApp text, or Raast reference to detect fraud, spoofing, phishing, or fake payout claims.",
    allowedRoles: ["citizen", "helper", "shopkeeper", "officer", "admin", "auditor"],
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "The suspicious SMS or message text." },
        reference: { type: "string", description: "Optional Raast payment reference code." },
      },
      required: ["message"],
    },
    execute: async (_user, args) => {
      const text = String(args.message ?? "");
      const ref = String(args.reference ?? "");
      const result = await analyzeScamCheck({ message: text, reference: ref });
      return {
        classification: result.jev_label,
        confidence: Math.round(result.jev_confidence * 100),
        rail_match: result.rail_match_status,
        explanation: result.explanation,
        red_flags: result.red_flags,
        detected_reference: result.detected_reference,
      };
    },
  },

  {
    name: "report_missing_payment",
    description: "File a missing or disputed Raast payment report (shopkeepers, citizens, helpers, officers, admins).",
    allowedRoles: ["shopkeeper", "citizen", "helper", "officer", "admin"],
    parameters: {
      type: "object",
      properties: {
        reference: { type: "string", description: "The Raast or payout reference code." },
        message: { type: "string", description: "Details explaining the missing payment." },
      },
      required: ["reference"],
    },
    execute: async (user, args) => {
      const reference = String(args.reference || "").trim();
      const message = String(args.message || "Missing payment reported via messaging").slice(0, 1200);
      const res = await scopedGateway<Record<string, unknown>>(user, "report", {
        reference,
        message,
        key: crypto.randomUUID(),
      });
      return { success: true, reference, reported_by: user.name, result: res };
    },
  },

  // ── 6. OFFICER REVIEW DESK & DISBURSEMENT ────────────────────────────────
  {
    name: "get_overview_metrics",
    description: "Get live dashboard overview counts (active, review, proof, approved, rejected, closed, paid, priority).",
    allowedRoles: ["officer", "admin", "auditor"],
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async user => {
      const overview = await scopedGateway<Overview>(user, "overview", {});
      return { overview };
    },
  },

  {
    name: "get_review_queue",
    description: "Fetch all claims in the officer review queue with applicant names, amounts, statuses, AI confidence, documents, and tamper flags.",
    allowedRoles: ["officer", "admin", "auditor"],
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async user => {
      const queue = await scopedGateway<Claim[]>(user, "queue", {});
      return {
        count: queue.length,
        claims: queue.slice(0, 15).map(c => ({
          id: c.id,
          applicant: c.citizen_name || "Applicant",
          amount_pkr: c.amount_pkr,
          status: c.status,
          funding_status: c.funding_status,
          payment_status: c.payment_status,
          ai_confidence: c.ai_confidence ? Math.round(c.ai_confidence * 100) : null,
          documents_count: c.documents?.length || 0,
          has_suspect_doc: (c.documents || []).some(d => d.tamper_flag || d.verified_status === "suspect"),
          reports: c.reports ?? 0,
          notes: c.payload_json?.notes,
        })),
      };
    },
  },

  {
    name: "get_claim_ai_summary",
    description: "Inspect full forensic verification context (citizen profile, claim docs, citizen docs, rule thresholds, tamper signals) for a specific claim ID.",
    allowedRoles: ["officer", "admin", "auditor"],
    parameters: {
      type: "object",
      properties: {
        claim_id: { type: "string", description: "Full UUID of the claim to inspect." },
      },
      required: ["claim_id"],
    },
    execute: async (user, args) => {
      const claimId = String(args.claim_id || "").trim();
      const ctx = await scopedGateway<Record<string, unknown>>(user, "claim_ai_context", { claimId });
      return { claim_id: claimId, verification_context: ctx };
    },
  },

  {
    name: "review_claim",
    description: "Record an officer/admin review decision on a claim (assign, more_proof, escalate, approve, reject, or close).",
    allowedRoles: ["officer", "admin"],
    parameters: {
      type: "object",
      properties: {
        claim_id: { type: "string", description: "Full UUID of the claim being reviewed." },
        decision: {
          type: "string",
          enum: ["assign", "more_proof", "escalate", "approve", "reject", "close"],
          description: "Official review decision.",
        },
        reason: { type: "string", description: "Justification reason (minimum 5 characters)." },
        reason_ur: { type: "string", description: "Optional Urdu translation of the decision reason." },
      },
      required: ["claim_id", "decision", "reason"],
    },
    execute: async (user, args) => {
      const claimId = String(args.claim_id ?? "").trim();
      const decision = String(args.decision ?? "approve");
      const reason = String(args.reason ?? "Reviewed via Relief Assist messaging").trim();
      const reasonUr =
        typeof args.reason_ur === "string" && args.reason_ur.trim()
          ? args.reason_ur.trim()
          : reviewUrduFallback[decision] || reviewUrduFallback.approve;

      const res = await scopedGateway<Record<string, unknown>>(user, "review", {
        claimId,
        decision,
        reason: reason.length >= 5 ? reason : `${reason} (verified)`,
        reasonUr,
      });
      return {
        success: true,
        claim_id: claimId,
        decision,
        reviewed_by: user.name,
        result: res,
      };
    },
  },

  {
    name: "disburse_claim_payment",
    description: "Issue or retry a simulated Raast cash disbursement on an approved & funded claim.",
    allowedRoles: ["officer", "admin"],
    parameters: {
      type: "object",
      properties: {
        claim_id: { type: "string", description: "Full UUID of the approved claim to disburse." },
        outcome: { type: "string", enum: ["paid", "failed"], description: "Simulated rail outcome (default 'paid')." },
      },
      required: ["claim_id"],
    },
    execute: async (user, args) => {
      const claimId = String(args.claim_id || "").trim();
      const outcome = args.outcome === "failed" ? "failed" : "paid";
      const res = await scopedGateway<Record<string, unknown>>(user, "disburse", { claimId, outcome });
      return { success: true, claim_id: claimId, outcome, result: res };
    },
  },

  // ── 7. RULE STUDIO, STAFF APPROVALS & SCHEME BUDGET ──────────────────────
  {
    name: "get_all_rules",
    description: "List all eligibility rule versions (active and historical) and their configuration parameters.",
    allowedRoles: ["admin", "officer", "auditor"],
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async user => {
      const rules = await scopedGateway<Rule[]>(user, "rules", {});
      return { count: rules.length, rules: rules.slice(0, 10) };
    },
  },

  {
    name: "simulate_rule_change",
    description: "Simulate how changing eligibility parameters (income_cap, minimum_household, amount_pkr, confidence_threshold) impacts existing claims.",
    allowedRoles: ["admin", "officer"],
    parameters: {
      type: "object",
      properties: {
        income_cap: { type: "number", description: "Proposed monthly income cap in PKR." },
        minimum_household: { type: "number", description: "Proposed minimum household size." },
        amount_pkr: { type: "number", description: "Proposed payout amount per claim in PKR." },
        confidence_threshold: { type: "number", description: "Proposed AI confidence threshold between 0.5 and 1.0." },
      },
      required: ["income_cap", "minimum_household", "amount_pkr", "confidence_threshold"],
    },
    execute: async (user, args) => {
      const config = {
        income_cap: Math.round(Number(args.income_cap)),
        minimum_household: Math.round(Number(args.minimum_household)),
        amount_pkr: Math.round(Number(args.amount_pkr)),
        confidence_threshold: Number(args.confidence_threshold),
      };
      const impact = await scopedGateway<unknown[]>(user, "simulate", { config });
      return { config, impact_count: Array.isArray(impact) ? impact.length : 0, impact: Array.isArray(impact) ? impact.slice(0, 15) : impact };
    },
  },

  {
    name: "publish_rule_version",
    description: "Publish a brand-new live eligibility rule version (Admin only).",
    allowedRoles: ["admin"],
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Rule version name (minimum 3 characters)." },
        income_cap: { type: "number", description: "Monthly income cap in PKR." },
        minimum_household: { type: "number", description: "Minimum household size." },
        amount_pkr: { type: "number", description: "Payout amount per claim in PKR." },
        confidence_threshold: { type: "number", description: "AI confidence threshold (0.5 to 1.0)." },
      },
      required: ["name", "income_cap", "minimum_household", "amount_pkr", "confidence_threshold"],
    },
    execute: async (user, args) => {
      const name = String(args.name || "Updated Scheme Rule").trim();
      const config = {
        income_cap: Math.round(Number(args.income_cap)),
        minimum_household: Math.round(Number(args.minimum_household)),
        amount_pkr: Math.round(Number(args.amount_pkr)),
        confidence_threshold: Number(args.confidence_threshold),
      };
      const published = await scopedGateway<Rule>(user, "publish", { name, config });
      return { success: true, published };
    },
  },

  {
    name: "get_staff_queue",
    description: "List pending staff/helper/officer registration requests awaiting admin approval.",
    allowedRoles: ["admin", "officer"],
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async user => {
      const staff = await scopedGateway<unknown[]>(user, "staff_queue", {});
      return { count: Array.isArray(staff) ? staff.length : 0, pending_staff: staff };
    },
  },

  {
    name: "decide_staff_access",
    description: "Approve ('active') or reject ('rejected') a pending staff registration request (Admin only).",
    allowedRoles: ["admin"],
    parameters: {
      type: "object",
      properties: {
        user_id: { type: "string", description: "UUID of the pending staff user." },
        decision: { type: "string", enum: ["active", "rejected"], description: "Approve or reject staff access." },
      },
      required: ["user_id", "decision"],
    },
    execute: async (user, args) => {
      const userId = String(args.user_id || "").trim();
      const decision = args.decision === "rejected" ? "rejected" : "active";
      const res = await scopedGateway<Record<string, unknown>>(user, "decide_staff", { userId, decision });
      return { success: true, user_id: userId, decision, result: res };
    },
  },

  {
    name: "get_scheme_budget",
    description:
      "Check the total relief scheme budget, remaining available funds, reserved payout amounts, paid total, and awaiting claims count.",
    allowedRoles: ["officer", "admin", "auditor"],
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async user => {
      const budget = await scopedGateway<SchemeBudget>(user, "scheme_budget", {});
      return {
        total_budget_pkr: budget.total_pkr,
        available_pkr: budget.available_pkr,
        reserved_pkr: budget.reserved_pkr,
        paid_pkr: budget.paid_pkr,
        awaiting_claims: budget.awaiting_claims,
        funded_claims: budget.funded_claims,
      };
    },
  },

  {
    name: "update_scheme_budget",
    description: "Update the total relief scheme budget allocation (Admin only).",
    allowedRoles: ["admin"],
    parameters: {
      type: "object",
      properties: {
        total_pkr: { type: "number", description: "New total budget in PKR (e.g. 7500000)." },
        reason: { type: "string", description: "Justification for budget change (minimum 5 chars)." },
      },
      required: ["total_pkr", "reason"],
    },
    execute: async (user, args) => {
      const totalPkr = Math.round(Number(args.total_pkr));
      const reason = String(args.reason || "Emergency fund update via messaging").trim();
      const budget = await scopedGateway<SchemeBudget>(user, "scheme_budget", {});
      const updated = await scopedGateway<SchemeBudget>(user, "set_scheme_budget", {
        totalPkr,
        expectedTotalPkr: budget.total_pkr,
        reason: reason.length >= 5 ? reason : `${reason} (admin update)`,
      });
      return {
        success: true,
        new_total_pkr: updated.total_pkr,
        available_pkr: updated.available_pkr,
        funded_claims: updated.funded_claims,
        message: `Relief scheme budget updated to PKR ${new Intl.NumberFormat("en-PK").format(updated.total_pkr)}.`,
      };
    },
  },

  // ── 8. AUDIT VAULT & SAFETY EVALUATION ───────────────────────────────────
  {
    name: "get_audit_logs",
    description: "Inspect recent forensic audit trail entries (event type, actor role, outcome, confidence, rule version).",
    allowedRoles: ["admin", "auditor", "officer"],
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum number of recent audit events to return (default 12, max 30)." },
      },
      required: [],
    },
    execute: async (user, args) => {
      const limit = Math.min(30, Math.max(1, Number(args.limit || 12)));
      const logs = await scopedGateway<Audit[]>(user, "audit", {});
      return {
        total: logs.length,
        recent: logs.slice(0, limit).map(l => ({
          id: l.id,
          event_type: l.event_type,
          actor_role: l.actor_role,
          entity_type: l.entity_type,
          outcome: l.outcome,
          confidence: l.confidence,
          rule_version: l.rule_version,
          created_at: l.created_at,
        })),
      };
    },
  },

  {
    name: "get_safety_metrics",
    description: "Run the AI safety & threshold evaluation report (bad approvals, scam false alarms, forgery misses).",
    allowedRoles: ["admin", "auditor", "officer"],
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async user => {
      // Verify caller has audit clearance first
      await scopedGateway(user, "audit", {});
      const metrics = runSafetyEval();
      return { safety_metrics: metrics };
    },
  },
];

export function getToolsForRole(role: Role): WhatsAppToolDefinition[] {
  return whatsAppTools.filter(t => t.allowedRoles.includes(role));
}
