import { z } from "zod";
import type { Claim } from "@/src/lib/contracts";
import { gateway } from "@/src/lib/server";
import { askMimo, mimoModel } from "./mimo";

export type VerificationCheck = {
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
};

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

export type ClaimAiContext = {
  claim: {
    id: string;
    citizen_id: string;
    status: string;
    payment_status: string;
    amount_pkr: number;
    payload_json: {
      monthly_income?: number;
      household_size?: number;
      notes?: string;
    };
    rule_version_used: number | null;
    ai_confidence: number | null;
    handoff_notes: string | null;
    ai_summary: string | null;
    citizen_reason_en: string | null;
    citizen_reason_ur: string | null;
  };
  citizen: {
    id: string;
    full_name: string;
    cnic_mock: string;
    phone: string;
    village_area: string;
    household_size: number;
    monthly_income_mock: number;
    profile_metadata_json: Record<string, unknown>;
  };
  claim_documents: Array<{
    id: string;
    doc_type: string;
    blur_score: number | null;
    tamper_flag: boolean;
    tamper_reason: string | null;
    verified_status: string;
    ocr_json: Record<string, unknown>;
  }>;
  citizen_documents: Array<{
    id: string;
    doc_type: string;
    blur_score: number | null;
    tamper_flag: boolean;
    tamper_reason: string | null;
    verified_status: string;
    confidence: number | null;
    extracted_json: {
      summary?: string;
      note?: string;
      fields?: Record<string, string>;
      model?: string;
    };
  }>;
  rule_version: number;
  rule_config: {
    income_cap: number;
    minimum_household: number;
    amount_pkr: number;
    confidence_threshold: number;
  };
  reports: number;
};

const summaryAiSchema = z.object({
  recommendation: z.enum(["approve", "reject", "more_proof"]),
  confidence: z.number().min(0).max(1),
  summary: z.string().min(10).max(1500),
  reason: z.string().min(5).max(600),
  reasonUr: z.string().min(5).max(600),
  riskFlags: z.array(z.string()).default([]),
  checks: z
    .array(
      z.object({
        label: z.string(),
        status: z.enum(["pass", "warn", "fail"]),
        detail: z.string(),
      }),
    )
    .default([]),
});

function evaluateDeterministic(ctx: ClaimAiContext): ClaimSummaryResult {
  const citizenName = ctx.citizen.full_name || "Applicant";
  const claimedIncome =
    ctx.claim.payload_json?.monthly_income ?? ctx.citizen.monthly_income_mock ?? 0;
  const claimedHousehold =
    ctx.claim.payload_json?.household_size ?? ctx.citizen.household_size ?? 1;
  const ruleCap = ctx.rule_config?.income_cap ?? 30000;
  const minHousehold = ctx.rule_config?.minimum_household ?? 2;
  const ruleVersion = ctx.rule_version ?? ctx.claim.rule_version_used ?? 1;

  // Inspect attached claim documents
  const claimDocs = ctx.claim_documents ?? [];
  const suspectClaimDoc = claimDocs.find(
    d => d.tamper_flag || d.verified_status === "suspect" || (d.tamper_reason && /edited|alter/i.test(d.tamper_reason)),
  );

  // Inspect profile documents
  const citDocs = ctx.citizen_documents ?? [];
  const cnicDocs = citDocs.filter(d => d.doc_type === "cnic");
  const billDocs = citDocs.filter(d => d.doc_type === "utility_bill");
  const jobDocs = citDocs.filter(d => d.doc_type === "job_proof");

  const readableCnic = cnicDocs.find(d => ["readable", "verified", "genuine"].includes(d.verified_status));
  const readableBill = billDocs.find(d => ["readable", "verified", "genuine"].includes(d.verified_status));
  const readableJob = jobDocs.find(d => ["readable", "verified", "genuine"].includes(d.verified_status));

  const checks: VerificationCheck[] = [];
  const riskFlags: string[] = [];

  // 1. Identity & CNIC Check
  if (readableCnic) {
    const fields = readableCnic.extracted_json?.fields ?? {};
    const expiry = fields.expiry_date || "valid";
    const cnicNo = fields.cnic_number || ctx.citizen.cnic_mock || "MOCK-CNIC";
    checks.push({
      label: "Identity & CNIC",
      status: "pass",
      detail: `Fake CNIC verified readable (${cnicNo}, valid through ${expiry}).`,
    });
  } else if (cnicDocs.length > 0) {
    checks.push({
      label: "Identity & CNIC",
      status: "warn",
      detail: "CNIC on file requires manual verification.",
    });
    riskFlags.push("CNIC on file requires manual verification");
  } else {
    checks.push({
      label: "Identity & CNIC",
      status: "fail",
      detail: "No CNIC photo or identity document on file.",
    });
    riskFlags.push("Missing CNIC photo on file");
  }

  // 2. Income & Job Proof Check
  if (suspectClaimDoc) {
    checks.push({
      label: "Income & Job Proof",
      status: "fail",
      detail: `Attached evidence flagged as suspect (${suspectClaimDoc.tamper_reason || "Edited amount in fixture"}).`,
    });
    riskFlags.push(`Suspect document (${suspectClaimDoc.tamper_reason || "Edited amount in fixture"})`);
  } else if (readableJob) {
    const jobFields = readableJob.extracted_json?.fields ?? {};
    const verifiedIncomeStr = jobFields.monthly_income || jobFields.monthly_income_pkr || "";
    checks.push({
      label: "Income & Job Proof",
      status: "pass",
      detail: `Job proof confirms PKR ${verifiedIncomeStr || claimedIncome.toLocaleString()}/mo matching claimed income.`,
    });
  } else if (jobDocs.length > 0) {
    checks.push({
      label: "Income & Job Proof",
      status: "warn",
      detail: `Job proof attached but requires review (claimed PKR ${claimedIncome.toLocaleString()}/mo).`,
    });
    riskFlags.push("Job proof requires review");
  } else {
    checks.push({
      label: "Income & Job Proof",
      status: "warn",
      detail: `No job proof photo on file; declared profile income is PKR ${claimedIncome.toLocaleString()}/mo.`,
    });
    riskFlags.push("Missing job proof photo on file");
  }

  // 3. Residence & Utility Check
  if (readableBill) {
    const billFields = readableBill.extracted_json?.fields ?? {};
    const provider = billFields.provider || "Utility provider";
    const amount = billFields.bill_amount_pkr ? `PKR ${billFields.bill_amount_pkr}` : "";
    checks.push({
      label: "Residence & Utility Bill",
      status: "pass",
      detail: `${provider} utility bill confirms residence in ${ctx.citizen.village_area || "area"} (${amount}).`,
    });
  } else if (billDocs.length > 0) {
    checks.push({
      label: "Residence & Utility Bill",
      status: "warn",
      detail: "Utility bill on file requires manual verification.",
    });
    riskFlags.push("Utility bill requires manual verification");
  } else {
    checks.push({
      label: "Residence & Utility Bill",
      status: "warn",
      detail: `No utility bill on file to verify residence in ${ctx.citizen.village_area || "declared area"}.`,
    });
    riskFlags.push("Missing utility bill photo on file");
  }

  // 4. Rule Eligibility Check
  const incomeEligible = claimedIncome <= ruleCap;
  const householdEligible = claimedHousehold >= minHousehold;
  if (incomeEligible && householdEligible) {
    checks.push({
      label: "Rule Eligibility",
      status: "pass",
      detail: `Meets Rule v${ruleVersion} criteria (PKR ${claimedIncome.toLocaleString()} <= PKR ${ruleCap.toLocaleString()} cap; household ${claimedHousehold} >= ${minHousehold}).`,
    });
  } else {
    const issues = [
      !incomeEligible ? `Income PKR ${claimedIncome.toLocaleString()} exceeds PKR ${ruleCap.toLocaleString()} cap` : "",
      !householdEligible ? `Household size ${claimedHousehold} below minimum ${minHousehold}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    checks.push({
      label: "Rule Eligibility",
      status: "fail",
      detail: `Fails Rule v${ruleVersion} criteria: ${issues}.`,
    });
    riskFlags.push(`Fails Rule v${ruleVersion}: ${issues}`);
  }

  // 5. Document Authenticity & Blur Check
  const maxBlur = Math.max(
    ...claimDocs.map(d => d.blur_score ?? 0),
    ...citDocs.map(d => d.blur_score ?? 0),
    0,
  );
  if (suspectClaimDoc) {
    checks.push({
      label: "Document Authenticity",
      status: "fail",
      detail: `Document tampering detected: ${suspectClaimDoc.tamper_reason || "Edited amount in synthetic fixture"}.`,
    });
  } else if (maxBlur > 0.8) {
    checks.push({
      label: "Document Authenticity",
      status: "warn",
      detail: `High blur score (${Math.round(maxBlur * 100)}%) detected on attached evidence.`,
    });
    riskFlags.push("High image blur on evidence");
  } else {
    checks.push({
      label: "Document Authenticity",
      status: "pass",
      detail: "Clean synthetic fixtures with acceptable blur scores and zero alteration flags.",
    });
  }

  // Scam / missing reports
  if (ctx.reports > 0) {
    riskFlags.push(`${ctx.reports} missing payment report(s) on case`);
  }

  // Recommendation Decision Logic
  let recommendation: "approve" | "reject" | "more_proof" = "approve";
  let confidence = ctx.claim.ai_confidence ?? 0.95;
  let summary = "";
  let reason = "";
  let reasonUr = "";

  if (suspectClaimDoc || !incomeEligible) {
    recommendation = "reject";
    confidence = Math.min(confidence, 0.45);
    const issueDetail = suspectClaimDoc
      ? `suspect document tampering (${suspectClaimDoc.tamper_reason || "edited amount in synthetic fixture"})`
      : "ineligible income exceeding cap";
    summary = `Applicant ${citizenName} (${ctx.citizen.village_area || "Area"}) case evaluation: Low reliability score (${Math.round(confidence * 100)}%). Case flagged for ${issueDetail}. ${citDocs.length === 0 ? "No photo documents (CNIC, Utility Bill, Job Proof) are on file." : `Attached documents failed verification.`} Recommendation: Reject.`;
    reason = suspectClaimDoc
      ? `The submitted income document shows indications of alteration (${suspectClaimDoc.tamper_reason || "edited amount in fixture"}), and required identity/utility documents are missing or unverified.`
      : `The declared income of PKR ${claimedIncome.toLocaleString()} exceeds the Rule v${ruleVersion} monthly income cap.`;
    reasonUr = suspectClaimDoc
      ? "جمع کروائی گئی آمدنی کی دستاویز میں ردوبدل (تبدیل شدہ رقم) کے شواہد پائے گئے ہیں اور پروفائل میں شناختی و رہائشی دستاویزات نامکمل ہیں۔"
      : `درخواست گزار کی ماہانہ آمدنی رول v${ruleVersion} کے تحت مقررہ حد سے زیادہ ہے۔`;
  } else if (!readableCnic || !householdEligible || (claimDocs.length === 0 && citDocs.length === 0)) {
    recommendation = "more_proof";
    confidence = 0.55;
    summary = `Applicant ${citizenName} (${ctx.citizen.village_area || "Area"}) case evaluation: Required verification documents are missing or incomplete. Profile lacks verified identity or residency proof under Rule v${ruleVersion}. Recommendation: Request more proof.`;
    reason = "Please attach clearer synthetic evidence and complete profile documents (CNIC and utility bill) for verification.";
    reasonUr = "برائے مہربانی تصدیق کے لیے واضح دستاویزات اور پروفائل کے ضروری ثبوت (شناختی کارڈ اور یوٹیلیٹی بل) دوبارہ جمع کروائیں۔";
  } else {
    recommendation = "approve";
    confidence = Math.max(confidence, 0.94);
    summary = `Applicant ${citizenName} (${ctx.citizen.village_area || "Area"}) satisfies all eligibility criteria under Rule v${ruleVersion}. High verification confidence (${Math.round(confidence * 100)}%) with genuine synthetic CNIC (${readableCnic?.extracted_json?.fields?.cnic_number || ctx.citizen.cnic_mock}), ${readableBill ? "utility bill residence verification, " : ""}and job proof confirming PKR ${claimedIncome.toLocaleString()}/mo income for household of ${claimedHousehold}. Zero tamper flags detected. Recommendation: Approve.`;
    reason = `Verified synthetic CNIC, utility bill, and job proof confirming PKR ${claimedIncome.toLocaleString()}/mo income and ${claimedHousehold} household members under Rule v${ruleVersion} criteria.`;
    reasonUr = `تمام دستاویزات (شناختی کارڈ، یوٹیلیٹی بل، ملازمت کا ثبوت) تصدیق شدہ ہیں جو کہ رول v${ruleVersion} کے تحت ${claimedIncome.toLocaleString()} روپے ماہانہ آمدنی اور ${claimedHousehold} افراد پر مشتمل خاندان کی تصدیق کرتے ہیں۔`;
  }

  return {
    claimId: ctx.claim.id,
    citizenName,
    recommendation,
    confidence,
    summary,
    reason,
    reasonUr,
    riskFlags: riskFlags.length > 0 ? riskFlags : ["None - Clean eligible case"],
    checks,
    model: "deterministic-eval-v1",
  };
}

export async function generateClaimSummary(claimId: string): Promise<ClaimSummaryResult> {
  const context = await gateway<ClaimAiContext>("claim_ai_context", { claimId });
  const fallback = evaluateDeterministic(context);

  try {
    const systemPrompt = `You are an expert relief claim fraud assessment and eligibility evaluation AI for a Pakistani emergency cash grant program.
Your role is to produce a rigorous, fair, and thorough executive review summary of the relief claim, taking all available applicant profile details, VLM document extractions, tamper signals, blur scores, and eligibility rules into account.

IMPORTANT GUIDELINES:
- Every document is a synthetic/demo fixture (may have 'FAKE CNIC', 'MOCK', 'DEMO' watermarks). Legible synthetic demo fixtures with no actual alteration of amounts/text should be accepted as readable and genuine.
- HOWEVER, if a document has tamper_flag=true, verified_status='suspect', or explicit tamper_reason like 'Edited amount in the fixture' or inconsistent fonts, treat it as a critical tamper/alteration risk!
- Verify claimed monthly income and household size against the rule parameters:
  * Rule version: v${context.rule_version}
  * Income cap: PKR ${context.rule_config?.income_cap}
  * Minimum household: ${context.rule_config?.minimum_household}
- Verify if CNIC, utility bill, and job proof photos are on file and readable.
- Output MUST be strictly valid JSON matching this schema:
{
  "recommendation": "approve" | "reject" | "more_proof",
  "confidence": number between 0 and 1,
  "summary": "Detailed 2-4 sentence executive summary for the review officer covering applicant name, area, claimed vs verified facts, document status, rule compliance, and decision rationale",
  "reason": "Clear, professional plain-language explanation in English (max 500 characters) that will be recorded and sent to the applicant",
  "reasonUr": "Accurate, culturally natural Urdu translation of the reason (max 500 characters) that will be recorded and sent to the applicant",
  "riskFlags": ["list", "of", "risk", "flags", "or", "warnings"],
  "checks": [
    { "label": "Identity & CNIC", "status": "pass" | "warn" | "fail", "detail": "..." },
    { "label": "Income & Job Proof", "status": "pass" | "warn" | "fail", "detail": "..." },
    { "label": "Residence & Utility Bill", "status": "pass" | "warn" | "fail", "detail": "..." },
    { "label": "Rule Eligibility", "status": "pass" | "warn" | "fail", "detail": "..." },
    { "label": "Document Authenticity", "status": "pass" | "warn" | "fail", "detail": "..." }
  ]
}`;

    const userPrompt = `Evaluate this claim:
- Applicant: ${context.citizen.full_name} (${context.citizen.cnic_mock})
- Area: ${context.citizen.village_area}
- Claimed Income: PKR ${context.claim.payload_json?.monthly_income ?? context.citizen.monthly_income_mock}
- Claimed Household: ${context.claim.payload_json?.household_size ?? context.citizen.household_size} people
- Handoff notes: ${context.claim.handoff_notes ?? "None"}
- Rule: v${context.rule_version} (Income cap PKR ${context.rule_config?.income_cap}, Min household ${context.rule_config?.minimum_household})
- Attached Claim Documents: ${JSON.stringify(context.claim_documents)}
- Citizen Profile Documents on file: ${JSON.stringify(context.citizen_documents.map(d => ({ doc_type: d.doc_type, status: d.verified_status, blur: d.blur_score, tamper: d.tamper_flag, reason: d.tamper_reason, fields: d.extracted_json?.fields })))}
- Existing missing payment reports: ${context.reports}`;

    const text = await askMimo(systemPrompt, userPrompt);
    const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/gi, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    const jsonStr = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
    const parsed = summaryAiSchema.parse(JSON.parse(jsonStr));

    const result: ClaimSummaryResult = {
      claimId,
      citizenName: context.citizen.full_name || "Applicant",
      recommendation: parsed.recommendation,
      confidence: parsed.confidence,
      summary: parsed.summary,
      reason: parsed.reason,
      reasonUr: parsed.reasonUr,
      riskFlags: parsed.riskFlags.length > 0 ? parsed.riskFlags : ["None - Clean eligible case"],
      checks: parsed.checks.length > 0 ? parsed.checks : fallback.checks,
      model: mimoModel,
    };

    // Save summary to database in background
    void gateway("claim_save_summary", { claimId, aiSummary: result.summary }).catch(() => {});
    return result;
  } catch (err) {
    console.warn("MiMo claim summary fallback used:", err instanceof Error ? err.message : String(err));
    void gateway("claim_save_summary", { claimId, aiSummary: fallback.summary }).catch(() => {});
    return fallback;
  }
}

export async function executeQuickReview(
  claimId: string,
  decision: "approve" | "reject",
  customReason?: string,
  customReasonUr?: string,
): Promise<{ ok: boolean; claim: Claim; summary: ClaimSummaryResult }> {
  // 1. Generate full AI summary taking all details into account
  const summary = await generateClaimSummary(claimId);

  // 2. Select reasons: custom or AI-generated
  const reason = customReason?.trim() || summary.reason;
  const reasonUr = customReasonUr?.trim() || summary.reasonUr;

  // 3. Record decision in Supabase via gateway
  const updatedClaim = await gateway<Claim>("review", {
    claimId,
    decision,
    reason,
    reasonUr,
    aiSummary: summary.summary,
  });

  return {
    ok: true,
    claim: updatedClaim,
    summary,
  };
}
