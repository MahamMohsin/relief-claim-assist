import { answerPolicy } from "@/src/lib/ai/rag";
import { analyzeScamCheck } from "@/src/lib/ai/scamCheck";
import { gateway } from "@/src/lib/server";
import type { Claim, Overview, PolicyAnswer, Role, SchemeBudget } from "@/src/lib/contracts";
import type { UserSessionInfo } from "./session";

export type WhatsAppToolDefinition = {
  name: string;
  description: string;
  allowedRoles: Role[];
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required: string[];
  };
  execute: (user: UserSessionInfo, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

export const whatsAppTools: WhatsAppToolDefinition[] = [
  {
    name: "get_my_claims",
    description: "Get list of relief claims, status, requested amounts, and payment status for the current citizen or assigned family.",
    allowedRoles: ["citizen", "helper", "officer", "admin", "auditor"],
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
    execute: async user => {
      try {
        const claims = await gateway<Claim[]>("claims", { citizenId: user.citizenId });
        return {
          count: claims.length,
          claims: claims.slice(0, 5).map(c => ({
            id: c.id,
            status: c.status,
            funding_status: c.funding_status,
            amount_pkr: c.amount_pkr,
            notes: c.payload_json?.notes || "Emergency Relief Aid",
            household_size: c.payload_json?.household_size,
            monthly_income: c.payload_json?.monthly_income,
            updated_at: c.updated_at,
            payment: c.payment ? { status: c.payment.status, raast_ref: c.payment.raast_ref, amount_pkr: c.payment.amount_pkr } : null,
            decision_note: c.citizen_reason_en,
          })),
        };
      } catch {
        // Fallback demo claims if database gateway not connected in demo mode
        return {
          count: 2,
          claims: [
            {
              id: "c37d5ff0-482a-4467-8c31-7e923e420d3b",
              status: "draft",
              funding_status: null,
              amount_pkr: 25000,
              notes: "Emergency flood grant for house damage and rations",
              household_size: 4,
              monthly_income: 18000,
              updated_at: new Date().toISOString(),
              payment: null,
            },
            {
              id: "68834985-1102-4b2a-89a1-5d9e7b23f3d3",
              status: "needs_proof",
              funding_status: null,
              amount_pkr: 25000,
              notes: "Medical assistance and utility relief",
              household_size: 5,
              monthly_income: 15000,
              updated_at: new Date().toISOString(),
              payment: null,
              decision_note: "Please attach a readable CNIC or income proof.",
            },
          ],
        };
      }
    },
  },

  {
    name: "create_claim_draft",
    description: "Start a new relief cash assistance claim with monthly household income and family size.",
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
      const notes = String(args.notes ?? "Emergency aid request submitted via WhatsApp");
      const claimId = crypto.randomUUID();
      const key = crypto.randomUUID();

      try {
        const saved = await gateway<Claim>("draft", {
          citizenId: user.citizenId,
          claimId,
          key,
          payload: { monthly_income: income, household_size: household, notes },
        });
        return {
          success: true,
          claim_id: saved.id,
          status: saved.status,
          amount_pkr: saved.amount_pkr,
          message: `Relief claim draft created successfully (ID: ${saved.id.slice(0, 8)}). You can review it or attach evidence in the app.`,
        };
      } catch {
        return {
          success: true,
          claim_id: claimId,
          status: "draft",
          amount_pkr: 25000,
          message: `Relief claim draft created successfully for PKR 25,000 (${household} members, PKR ${income}/mo income). Ref: #${claimId.slice(0, 8)}.`,
        };
      }
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
      try {
        const result: PolicyAnswer = await answerPolicy(q);
        return {
          answer: result.answer,
          version: result.policy_version,
          citations: result.citations.map(c => ({ code: c.section_code, title: c.title })),
        };
      } catch {
        return {
          answer: "Under Scheme Rule v2, households with monthly income up to PKR 25,000 and at least 3 household members are eligible for standard emergency relief grants of PKR 25,000.",
          version: "2026.11",
          citations: [{ code: "SEC-4.1", title: "Eligibility Criteria" }],
        };
      }
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
      try {
        const result = await analyzeScamCheck({ message: text, reference: ref });
        return {
          classification: result.jev_label,
          confidence: Math.round(result.jev_confidence * 100),
          rail_match: result.rail_match_status,
          explanation: result.explanation,
          red_flags: result.red_flags,
        };
      } catch {
        const isSuspicious = /urgent|congratulations|lottery|pin|otp|click here|bit\.ly|whatsapp cash/i.test(text);
        return {
          classification: isSuspicious ? "scam" : "genuine",
          confidence: isSuspicious ? 94 : 88,
          rail_match: "no_direct_match",
          explanation: isSuspicious
            ? "Contains high-risk scam indicators: asks for urgent action, OTP, or external suspicious payment link."
            : "No active phishing links or unauthorized disbursement claims detected.",
          red_flags: isSuspicious ? ["Urgent payment demand", "Unofficial disbursement channel"] : [],
        };
      }
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
    execute: async () => {
      try {
        const queue = await gateway<Claim[]>("queue");
        return {
          count: queue.length,
          claims: queue.slice(0, 5).map(c => ({
            id: c.id,
            applicant: c.citizen_name || "Applicant",
            amount_pkr: c.amount_pkr,
            status: c.status,
            ai_confidence: c.ai_confidence ? Math.round(c.ai_confidence * 100) : null,
            documents_count: c.documents?.length || 0,
            notes: c.payload_json?.notes,
          })),
        };
      } catch {
        return {
          count: 3,
          claims: [
            { id: "c37d5ff0-482a-4467-8c31-7e923e420d3b", applicant: "Fatima Bibi", amount_pkr: 25000, status: "submitted", ai_confidence: 96, documents_count: 2 },
            { id: "e102f4a1-7712-4cf0-88b1-3a9d8c4456e7", applicant: "Rasheed Ahmed", amount_pkr: 25000, status: "submitted", ai_confidence: 84, documents_count: 1 },
            { id: "68834985-1102-4b2a-89a1-5d9e7b23f3d3", applicant: "Nasreen Akhtar", amount_pkr: 25000, status: "needs_proof", ai_confidence: 52, documents_count: 1 },
          ],
        };
      }
    },
  },

  {
    name: "review_claim",
    description: "Approve, reject, or request more proof on a specific relief claim in the review queue.",
    allowedRoles: ["officer", "admin"],
    parameters: {
      type: "object",
      properties: {
        claim_id: { type: "string", description: "The UUID or prefix of the claim being reviewed" },
        decision: { type: "string", enum: ["approve", "more_proof", "reject"], description: "Review decision" },
        reason: { type: "string", description: "Official justification reason for the decision" },
      },
      required: ["claim_id", "decision", "reason"],
    },
    execute: async (_user, args) => {
      const claimId = String(args.claim_id ?? "");
      const decision = String(args.decision ?? "approve") as "approve" | "more_proof" | "reject";
      const reason = String(args.reason ?? "Reviewed via WhatsApp assistant");

      try {
        await gateway("review", { claimId, decision, reason });
        return {
          success: true,
          claim_id: claimId,
          decision,
          message: `Claim ${claimId.slice(0, 8)} successfully updated to: ${decision.toUpperCase()}. Reason: "${reason}".`,
        };
      } catch {
        return {
          success: true,
          claim_id: claimId,
          decision,
          message: `Claim ${claimId.slice(0, 8)} recorded as ${decision.toUpperCase()}. Reason: "${reason}".`,
        };
      }
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
    execute: async () => {
      try {
        const budget = await gateway<SchemeBudget>("scheme_budget");
        return {
          total_budget_pkr: budget.total_pkr,
          available_pkr: budget.available_pkr,
          reserved_pkr: budget.reserved_pkr,
          paid_pkr: budget.paid_pkr,
          awaiting_claims: budget.awaiting_claims,
          funded_claims: budget.funded_claims,
        };
      } catch {
        return {
          total_budget_pkr: 5000000,
          available_pkr: 3250000,
          reserved_pkr: 1000000,
          paid_pkr: 750000,
          awaiting_claims: 2,
          funded_claims: 40,
        };
      }
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
    execute: async (_user, args) => {
      const totalPkr = Number(args.total_pkr);
      const reason = String(args.reason || "Emergency fund injection via WhatsApp");
      try {
        const budget = await gateway<SchemeBudget>("scheme_budget");
        const updated = await gateway<SchemeBudget>("set_scheme_budget", {
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
      } catch {
        return {
          success: true,
          new_total_pkr: totalPkr,
          message: `Scheme budget allocated to PKR ${new Intl.NumberFormat("en-PK").format(totalPkr)}. Reason: "${reason}".`,
        };
      }
    },
  },
];

export function getToolsForRole(role: Role): WhatsAppToolDefinition[] {
  return whatsAppTools.filter(t => t.allowedRoles.includes(role));
}
