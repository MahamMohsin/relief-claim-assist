import { ApiError } from "@/src/lib/server";

export const mimoModel = process.env.ANTHROPIC_MODEL || "mimo-v2.6-flash";

export async function askMimo(system: string, content: unknown, signal?: AbortSignal) {
  const { ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN } = process.env;
  if (!ANTHROPIC_BASE_URL || !ANTHROPIC_AUTH_TOKEN) throw new ApiError(503, "MiMo is not configured.");
  const endpoint = new URL(ANTHROPIC_BASE_URL.replace(/\/$/, "") + "/v1/messages");
  if (endpoint.protocol !== "https:" || !/^(?:[a-z0-9-]+\.)?xiaomimimo\.com$/i.test(endpoint.hostname)) {
    throw new ApiError(503, "The MiMo endpoint is invalid.");
  }
  const timeout = AbortSignal.timeout(20000);
  const response = await fetch(endpoint, {
    method: "POST", redirect: "error",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_AUTH_TOKEN, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: mimoModel, max_tokens: 850, thinking: { type: "disabled" }, system, messages: [{ role: "user", content }] }),
  });
  if (!response.ok) {
    console.error("MiMo HTTP", response.status);
    throw new ApiError(502, "MiMo is temporarily unavailable.");
  }
  const body: { content?: { type: string; text?: string }[] } = await response.json();
  return body.content?.filter(block => block.type === "text").map(block => block.text).join("").trim() ?? "";
}
