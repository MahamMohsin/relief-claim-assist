import type { Action } from "@/src/lib/contracts";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Outbox writes fail fast (8s) so they can be queued and retried; everything else, including the AI
// actions (Scam Shield check, Policy Ask, profile document extraction, model/Jev calls), gets 30s.
export const REQUEST_TIMEOUT_MS = 8000;
export const LONG_TIMEOUT_MS = 30000;
/** After this long the UI shows "Taking longer than usual…" for AI actions. */
export const SLOW_HINT_MS = 8000;
const outboxActions = new Set<string>(["draft", "submit", "evidence", "consent", "correction", "report"]);
export const timeoutFor = (action: string) => (outboxActions.has(action) ? REQUEST_TIMEOUT_MS : LONG_TIMEOUT_MS);

// Network errors, timeouts and 5xx/408/429 are worth retrying from the outbox; other 4xx are not.
export function isRetryable(error: unknown) {
  if (error instanceof HttpError) return error.status >= 500 || error.status === 408 || error.status === 429;
  return error instanceof TypeError || (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError"));
}

export async function jsonRequest<T>(path: string, body: object, signal?: AbortSignal, timeoutMs = LONG_TIMEOUT_MS): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const key = (body as { key?: unknown }).key;
  const result = await fetch(path, {
    method: "POST", signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    headers: { "Content-Type": "application/json", ...(typeof key === "string" ? { "Idempotency-Key": key } : {}) },
    body: JSON.stringify(body),
  });
  const value = await result.json().catch(() => null);
  if (!result.ok) throw new HttpError(result.status, value?.error ?? "The server could not complete the request.");
  return value as T;
}

export const api = <T>(action: Action, body: object = {}, signal?: AbortSignal) =>
  jsonRequest<T>("/api/relief/" + action, body, signal, timeoutFor(action));

/** `timeoutMs` is set by the outbox (8s); live voice input keeps no client timeout. */
export async function transcribe(audio: Blob, locale: "en" | "ur", signal?: AbortSignal, timeoutMs?: number) {
  const limit = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;
  const response = await fetch("/api/voice/stt?lang=" + locale, {
    method: "POST", headers: { "Content-Type": audio.type }, body: audio,
    signal: signal && limit ? AbortSignal.any([signal, limit]) : signal ?? limit,
  });
  const value = await response.json();
  if (!response.ok) throw new HttpError(response.status, value.error ?? "The recording could not be transcribed.");
  return String(value.transcript ?? "");
}
