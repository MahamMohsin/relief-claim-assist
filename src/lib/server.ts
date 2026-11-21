import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export async function authClient(signal?: AbortSignal) {
  return createClient(await cookies(), signal);
}

export async function gateway<T>(action: string, args: object = {}): Promise<T> {
  const client = await authClient();
  const proof = process.env.RELIEF_GATEWAY_SECRET;
  if (!proof) throw new ApiError(503, "The relief database gateway is not configured.");
  const { data, error } = await client.rpc("relief_gateway", { action, args, proof });
  if (error) {
    if (error.code === "42501" || error.code === "PGRST301") {
      throw new ApiError(401, "Sign in with a demo persona.");
    }
    console.error("Relief gateway", action, error.code, error.message);
    throw new ApiError(502, "The relief database could not complete the request.");
  }
  if (data && typeof data.status === "number" && typeof data.error === "string") {
    throw new ApiError(data.status, data.error);
  }
  return data as T;
}

export function apiError(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Relief request failed", error instanceof Error ? error.name : "unknown");
  return Response.json({ error: "The request could not be completed. Please try again." }, { status: 500 });
}

export async function readJson(request: Request, limit = 20000): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new ApiError(415, "Send an application/json request.");
  }
  if (Number(request.headers.get("content-length")) > limit) throw new ApiError(413, "The request is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "Send a JSON body.");
  const decoder = new TextDecoder();
  let bytes = 0;
  let raw = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      throw new ApiError(413, "The request is too large.");
    }
    raw += decoder.decode(value, { stream: true });
  }
  try {
    return JSON.parse(raw + decoder.decode());
  } catch {
    throw new ApiError(400, "The request body is invalid JSON.");
  }
}
