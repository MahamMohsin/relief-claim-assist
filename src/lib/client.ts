import type { Action } from "@/src/lib/contracts";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function jsonRequest<T>(path: string, body: object, signal?: AbortSignal): Promise<T> {
  const result = await fetch(path, {
    method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
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
