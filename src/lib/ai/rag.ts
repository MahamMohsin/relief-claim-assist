import type { Policy, PolicyAnswer } from "@/src/lib/contracts";
import { gateway } from "@/src/lib/server";

export async function answerPolicy(question: string): Promise<PolicyAnswer> {
  const corpus = await gateway<Policy[]>("policy");
  const tokens = new Set(question.toLowerCase().match(/[\p{L}\p{M}]+/gu) ?? []);
  if (tokens.has("بیواؤں") || tokens.has("بیوائیں")) tokens.add("بیوہ");

  // Expand natural language synonyms to official policy keywords
  const hasAny = (...words: string[]) => words.some(w => tokens.has(w));
  if (hasAny("money", "cash", "funds", "aid", "assistance", "payout", "payment", "financial", "paisa", "paise", "رقم", "پیسے", "امداد", "مالی")) {
    tokens.add("apply");
    tokens.add("claim");
    tokens.add("claims");
    tokens.add("payment");
    tokens.add("payout");
    tokens.add("household");
    tokens.add("eligible");
  }
  if (hasAny("want", "need", "get", "receive", "qualify", "criteria", "rules", "rule", "اہلیت", "چاہیے", "حاصل")) {
    tokens.add("eligible");
    tokens.add("eligibility");
    tokens.add("qualify");
    tokens.add("apply");
  }
  if (hasAny("helper", "helpers", "permission", "permissions", "access", "revoke", "grant", "رضامندی")) {
    tokens.add("consent");
    tokens.add("helper");
    tokens.add("privacy");
    tokens.add("revoke");
  }
  if (hasAny("document", "documents", "paper", "papers", "id", "card", "cnic", "slip", "ثبوت", "شناخت")) {
    tokens.add("proof");
    tokens.add("document");
    tokens.add("documents");
    tokens.add("evidence");
  }
  if (hasAny("scam", "fraud", "fake", "otp", "fee", "cheat", "دھوکہ")) {
    tokens.add("fraud");
    tokens.add("scam");
    tokens.add("otp");
    tokens.add("fee");
  }

  const citations = corpus.map(section => ({
    section, score: section.keywords.filter(word => tokens.has(word)).length,
  })).filter(item => item.score > 0).sort((left, right) => right.score - left.score).slice(0, 2)
    .map(item => item.section);
  const response = {
    answer: citations.length ? citations.map(section => section.content).join(" ")
      : /\p{Script=Arabic}/u.test(question) ? "سرکاری پالیسی میں اس سوال کا جواب موجود نہیں ہے۔" : "The official policy does not cover this.",
    citations,
    policy_version: corpus[0]?.policy_version ?? "Unavailable",
    effective_date: corpus[0]?.effective_date ?? null,
  };
  await gateway("policy_trace", {
    version: response.policy_version, outcome: citations.length ? "cited" : "abstained", citations: citations.map(section => section.section_code),
  });
  return response;
}
