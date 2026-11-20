import type { Policy, PolicyAnswer } from "@/src/lib/contracts";
import { gateway } from "@/src/lib/server";

export async function answerPolicy(question: string): Promise<PolicyAnswer> {
  const corpus = await gateway<Policy[]>("policy");
  const tokens = new Set(question.toLowerCase().match(/[\p{L}\p{M}]+/gu) ?? []);
  const citations = corpus.map(section => ({
    section, score: section.keywords.filter(word => tokens.has(word)).length,
  })).filter(item => item.score > 0).sort((left, right) => right.score - left.score).slice(0, 2)
    .map(item => item.section);
  const response = {
    answer: citations.length ? citations.map(section => section.content).join(" ") : "The official policy does not cover this.",
    citations,
    policy_version: corpus[0]?.policy_version ?? "Unavailable",
    effective_date: corpus[0]?.effective_date ?? null,
  };
  await gateway("policy_trace", {
    version: response.policy_version, outcome: citations.length ? "cited" : "abstained", citations: citations.map(section => section.section_code),
  });
  return response;
}
