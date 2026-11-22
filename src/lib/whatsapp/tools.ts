import { answerPolicy } from "@/src/lib/ai/rag";
import { analyzeScamCheck } from "@/src/lib/ai/scamCheck";
import type { CitizenProfileData, Claim, Family, PolicyAnswer, Role, SchemeBudget } from "@/src/lib/contracts";
import { scopedGateway, type ScopedUserIdentity } from "./scoped-gateway";

export type WhatsAppToolDefinition = {
  name: string;
  description: string;
  allowedRoles: Role[];
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
  execute: (user: ScopedUserIdentity, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

export const whatsAppTools: WhatsAppToolDefinition[] = [
  {
    name: "get_my_claims",
    description: "Get list of relief claims, status, requested amounts, and payment status strictly for the current citizen or helper's consented family.",
    allowedRoles: ["citizen", "helper"],
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async user => {
      let targetCitizenId = user.citizenId;
      let familyLabel: string | undefined;

      // Helpers act on behalf of their consented families
      if (user.role === "helper" && !targetCitizenId) {
        const families = await scopedGateway<Family[]>(user, "families", {});
        const consented = families.find(f => f.consent === "granted") || families[0];
        if (!consented) {
          return {
            count: 0,
            claims: [],
            note: `No consented family is currently assigned to ${user.name}.`,
          };
        }
        targetCitizenId = consented.id;
        familyLabel = consented.full_name;
      }

      const claims = await scopedGateway<Claim[]>(
        user,
        "claims",
        targetCitizenId ? { citizenId: targetCitizenId } : {},
      );

      return {
        owner: familyLabel || user.name,
        count: claims.length,
        claims: claims.slice(0, 6).map(c => ({
          id: c.id,
          status: c.status,
          funding_status: c.funding_status,
          amount_pkr: c.amount_pkr,
          notes: c.payload_json?.notes || "Emergency Relief Aid",
          household_size: c.payload_json?.household_size,
          monthly_income: c.payload_json?.monthly_income,
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
    name: "get_my_profile",
    description: "Get the current citizen's verified profile details (name, household size, monthly income, village area, CNIC mock, and uploaded documents).",
    allowedRoles: ["citizen", "helper"],
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async user => {
      const data = await scopedGateway<CitizenProfileData>(
        user,
        "citizen_profile",
        user.citizenId ? { citizenId: user.citizenId } : {},
      );
      return {
        full_name: data.citizen.full_name,
        cnic_mock: data.citizen.cnic_mock,
        household_size: data.citizen.household_size,
        monthly_income_mock: data.citizen.monthly_income_mock,
        village_area: data.citizen.village_area,
        phone: data.citizen.phone,
        documents_count: data.documents.length,
        documents: data.documents.map(d => ({
          doc_type: d.doc_type,
          verified_status: d.verified_status,
          confidence: d.confidence,
        })),
      };
    },
  },

  {
    name: "get_families",
    description: "List families assigned to this helper/officer/admin along with their consent status and village area.",
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
        families: families.slice(0, 10).map(f => ({
          id: f.id,
          full_name: f.full_name,
          village_area: f.village_area,
          consent: f.consent,
        })),
      };
    },
  },

  {
    name: "create_claim_draft",
    description: "Start a new relief cash assistance claim draft with monthly household income and family size.",
    allowedRoles: ["citizen", "helper"],
    parameters: {
      type: "object",
      properties: {
        monthly_income: { type: "number", description: "Total monthly household income in PKR (e.g. 15000)" },
        household_size: { type: "number", description: "Number of people in household (e.g. 5)" },
        notes: { type: "string", description: "Reason for aid or disaster details (e.g. flood damage, medical expense)" },
      },
      required: ["monthly_income", "household_size"],
    },
    execute: async (user, args) => {
      const income = Number(args.monthly_income ?? 0);
      const household = Number(args.household_size ?? 1);
      const notes = String(args.notes ?? "Emergency aid request submitted via messaging");
      const claimId = crypto.randomUUID();
      const key = crypto.randomUUID();

      let targetCitizenId = user.citizenId;
      if (user.role === "helper" && !targetCitizenId) {
        const families = await scopedGateway<Family[]>(user, "families", {});
        targetCitizenId = families.find(f => f.consent === "granted")?.id ?? null;
      }

      const saved = await scopedGateway<Claim>(user, "draft", {
        citizenId: targetCitizenId,
        claimId,
        key,
        payload: { monthly_income: income, household_size: household, notes },
      });
      return {
        success: true,
        claim_id: saved.id,
        status: saved.status,
        amount_pkr: saved.amount_pkr,
        message: `Relief claim draft created for ${user.name} (ID: ${saved.id.slice(0, 8)}). You can review it or attach evidence in Relief Assist.`,
      };
    },
  },

  {
    name: "ask_policy",
    description: "Ask any question about official disaster relief policy, income caps, eligible criteria, and receive cited sections.",
    allowedRoles: ["citizen", "helper", "shopkeeper", "officer", "admin", "auditor"],
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "Policy question, e.g. 'What is the maximum income cap for cash assistance?'" },
      },
      required: ["question"],
    },
    execute: async (_user, args) => {
      const q = String(args.question ?? "");
      const result: PolicyAnswer = await answerPolicy(q);
      return {
        answer: result.answer,
        version: result.policy_version,
        citations: result.citations.map(c => ({ code: c.section_code, title: c.title })),
      };
    },
  },

  {
    name: "check_scam",
    description: "Check an SMS, payment message, or Raast reference to detect fraud, spoofing, or fake disbursement claims.",
    allowedRoles: ["citizen", "helper", "shopkeeper", "officer", "admin", "auditor"],
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "The text of the suspicious message or SMS received" },
        reference: { type: "string", description: "Optional Raast transfer or transaction reference" },
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
      };
    },
  },

  {
    name: "report_missing_payment",
    description: "Report a missing or disputed Raast payment reference (used by shopkeepers, citizens, and helpers).",
    allowedRoles: ["shopkeeper", "citizen", "helper"],
    parameters: {
      type: "object",
      properties: {
        reference: { type: "string", description: "The Raast or payout reference code" },
        message: { type: "string", description: "Details of the missing payment report" },
      },
      required: ["reference"],
    },
    execute: async (user, args) => {
      const reference = String(args.reference || "").trim();
      const message = String(args.message || "Missing payment reported via messaging");
      const key = crypto.randomUUID();
      const res = await scopedGateway<Record<string, unknown>>(user, "report", {
        reference,
        message,
        key,
      });
      return {
        success: true,
        reference,
        reported_by: user.name,
        result: res,
      };
    },
  },

  {
    name: "get_review_queue",
    description: "Fetch pending relief claims awaiting officer review and decision.",
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
        claims: queue.slice(0, 6).map(c => ({
          id: c.id,
          applicant: c.citizen_name || "Applicant",
          amount_pkr: c.amount_pkr,
          status: c.status,
          ai_confidence: c.ai_confidence ? Math.round(c.ai_confidence * 100) : null,
          documents_count: c.documents?.length || 0,
          notes: c.payload_json?.notes,
        })),
      };
    },
  },

  {
    name: "review_claim",
    description: "Approve, reject, or request more proof on a specific relief claim in the review queue.",
    allowedRoles: ["officer", "admin"],
    parameters: {
      type: "object",
      properties: {
        claim_id: { type: "string", description: "The UUID of the claim being reviewed" },
        decision: { type: "string", enum: ["approve", "more_proof", "reject"], description: "Review decision" },
        reason: { type: "string", description: "Official justification reason for the decision" },
      },
      required: ["claim_id", "decision", "reason"],
    },
    execute: async (user, args) => {
      const claimId = String(args.claim_id ?? "").trim();
      const decision = String(args.decision ?? "approve") as "approve" | "more_proof" | "reject";
      const reason = String(args.reason ?? "Reviewed via messaging assistant");

      await scopedGateway(user, "review", { claimId, decision, reason });
      return {
        success: true,
        claim_id: claimId,
        decision,
        reviewed_by: user.name,
        message: `Claim ${claimId.slice(0, 8)} successfully updated to ${decision.toUpperCase()}. Reason: "${reason}".`,
      };
    },
  },

  {
    name: "get_scheme_budget",
    description: "Check the total relief scheme budget, remaining available funds, reserved payout amounts, and awaiting claims count.",
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
        total_pkr: { type: "number", description: "New total budget in PKR (e.g. 7500000)" },
        reason: { type: "string", description: "Justification for budget change (minimum 5 chars)" },
      },
      required: ["total_pkr", "reason"],
    },
    execute: async (user, args) => {
      const totalPkr = Number(args.total_pkr);
      const reason = String(args.reason || "Emergency fund injection via messaging");
      const budget = await scopedGateway<SchemeBudget>(user, "scheme_budget", {});
      const updated = await scopedGateway<SchemeBudget>(user, "set_scheme_budget", {
        totalPkr,
        expectedTotalPkr: budget.total_pkr,
        reason,
      });
      return {
        success: true,
        new_total_pkr: updated.total_pkr,
        available_pkr: updated.available_pkr,
        funded_claims: updated.funded_claims,
        message: `Relief scheme budget successfully updated to PKR ${new Intl.NumberFormat("en-PK").format(updated.total_pkr)}.`,
      };
    },
  },
];

export function getToolsForRole(role: Role): WhatsAppToolDefinition[] {
  return whatsAppTools.filter(t => t.allowedRoles.includes(role));
}
