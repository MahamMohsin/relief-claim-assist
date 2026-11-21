import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError } from "@/src/lib/server";

export const mimoModel = process.env.ANTHROPIC_MODEL || "mimo-v2.6-flash";

const MIMO_HOST_RE = /^(?:[a-z0-9-]+\.)?xiaomimimo\.com$/i;
let cachedEnvLocalBaseUrl: string | null | undefined;

function isValidMimoUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const trimmed = raw.trim().replace(/^["']|["']$/g, "");
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" && MIMO_HOST_RE.test(parsed.hostname)) {
      return parsed.href.replace(/\/$/, "");
    }
  } catch {
    return null;
  }
  return null;
}

function readEnvLocalMimoUrl(): string | null {
  if (cachedEnvLocalBaseUrl !== undefined) return cachedEnvLocalBaseUrl;
  cachedEnvLocalBaseUrl = null;
  try {
    const envPath = join(process.cwd(), ".env.local");
    if (!existsSync(envPath)) return null;
    const text = readFileSync(envPath, "utf8");
    for (const key of ["MIMO_BASE_URL", "ANTHROPIC_BASE_URL"]) {
      const match = text.match(new RegExp(`^${key}=(.+)$`, "m"));
      const valid = isValidMimoUrl(match?.[1]);
      if (valid) {
        cachedEnvLocalBaseUrl = valid;
        return valid;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Resolves the Xiaomi MiMo Anthropic-compatible base URL.
 * Prefers MIMO_BASE_URL, then ANTHROPIC_BASE_URL if it points at xiaomimimo.com,
 * and falls back to reading .env.local if a global OS ANTHROPIC_BASE_URL shadowed it.
 */
export function resolveMimoBaseUrl(): string | null {
  return (
    isValidMimoUrl(process.env.MIMO_BASE_URL) ??
    isValidMimoUrl(process.env.ANTHROPIC_BASE_URL) ??
    readEnvLocalMimoUrl()
  );
}

export async function askMimo(system: string, content: unknown, signal?: AbortSignal) {
  const baseUrl = resolveMimoBaseUrl();
  const { ANTHROPIC_AUTH_TOKEN } = process.env;
  if (!baseUrl || !ANTHROPIC_AUTH_TOKEN) throw new ApiError(503, "MiMo is not configured.");
  const endpoint = new URL(baseUrl + "/v1/messages");
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
