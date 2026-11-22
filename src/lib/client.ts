import type { Action } from "@/src/lib/contracts";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const REQUEST_TIMEOUT_MS = 8000;

// Network errors, timeouts and 5xx/408/429 are worth retrying from the outbox; other 4xx are not.
export function isRetryable(error: unknown) {
  if (error instanceof HttpError) return error.status >= 500 || error.status === 408 || error.status === 429;
  return error instanceof TypeError || (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError"));
}

export async function jsonRequest<T>(path: string, body: object, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
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
  jsonRequest<T>("/api/relief/" + action, body, signal);

export async function transcribe(audio: Blob, locale: "en" | "ur", signal?: AbortSignal) {
  const response = await fetch("/api/voice/stt?lang=" + locale, {
    method: "POST", headers: { "Content-Type": audio.type }, body: audio, signal,
  });
  const value = await response.json();
  if (!response.ok) throw new HttpError(response.status, value.error ?? "The recording could not be transcribed.");
  return String(value.transcript ?? "");
}
