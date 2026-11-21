import { apiError, ApiError, gateway, readJson } from "@/src/lib/server";
import type { Profile } from "@/src/lib/contracts";

export const runtime = "nodejs";

type Stream = { socket: WebSocket; owner: string; messages: unknown[]; timer: ReturnType<typeof setTimeout> };
const sessions = new Map<string, Stream>();
const maxChunkBytes = 32000;
const headers = { "Cache-Control": "no-store" };

function close(id: string) {
  const stream = sessions.get(id);
  if (!stream) return;
  sessions.delete(id);
  clearTimeout(stream.timer);
  stream.socket.close();
}

export async function POST(request: Request) {
  let id: string | undefined;
  try {
    const [profile, body] = await Promise.all([gateway<Profile>("profile"), readJson(request)]);
    const locale = (body as { locale?: unknown } | null)?.locale;
    if (locale !== "en" && locale !== "ur") throw new ApiError(400, "Select English or Urdu.");
    if (sessions.size >= 12) throw new ApiError(429, "Live transcription is busy. Try a short recording.");
    for (const [existing, stream] of sessions) if (stream.owner === profile.id) close(existing);

    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) throw new ApiError(503, "Live transcription is unavailable.");
    const endpoint = new URL("wss://api.deepgram.com/v1/listen");
    endpoint.search = new URLSearchParams({ model: "nova-3", language: locale, encoding: "linear16",
      sample_rate: "16000", channels: "1", interim_results: "true", endpointing: "300", smart_format: "true" }).toString();
    const socket = new WebSocket(endpoint, ["token", key]);
    const recordingId = crypto.randomUUID();
    id = recordingId;
    const stream: Stream = { socket, owner: profile.id, messages: [], timer: setTimeout(() => close(recordingId), 26000) };
    sessions.set(id, stream);
    socket.addEventListener("message", event => {
      if (typeof event.data !== "string") return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === "Results") {
          stream.messages.push(message);
          if (stream.messages.length > 25) stream.messages.shift();
        }
      } catch { /* Ignore malformed provider events. */ }
    });
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new ApiError(503, "Live transcription took too long.")), 6000);
      const finish = (error?: ApiError) => {
        clearTimeout(timeout);
        request.signal.removeEventListener("abort", abort);
        if (error) reject(error); else resolve();
      };
      const abort = () => finish(new ApiError(503, "Live transcription was interrupted."));
      request.signal.addEventListener("abort", abort, { once: true });
      socket.addEventListener("open", () => finish(), { once: true });
      socket.addEventListener("error", () => finish(new ApiError(503, "Live transcription could not connect.")), { once: true });
    });
    return Response.json({ recordingId }, { status: 201, headers });
  } catch (error) {
    if (id) close(id);
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const id = request.headers.get("x-relief-recording");
    const stream = id ? sessions.get(id) : undefined;
    if (!stream || stream.socket.readyState !== WebSocket.OPEN) throw new ApiError(410, "Live recording ended.");
    if (request.headers.get("content-type") !== "application/octet-stream") throw new ApiError(415, "Send an audio chunk.");
    if (Number(request.headers.get("content-length")) > maxChunkBytes) throw new ApiError(413, "Send a shorter audio chunk.");
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError(400, "Audio chunk missing.");
    let length = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > maxChunkBytes) { await reader.cancel(); throw new ApiError(413, "Send a shorter audio chunk."); }
      chunks.push(value);
    }
    if (id && sessions.get(id) !== stream) throw new ApiError(410, "Live recording ended.");
    if (length > 0) {
      const audio = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { audio.set(chunk, offset); offset += chunk.length; }
      stream.socket.send(audio);
    }
    return Response.json({ messages: stream.messages.splice(0) }, { headers });
  } catch (error) {
    return apiError(error);
  }
}

export function DELETE(request: Request) {
  const id = request.headers.get("x-relief-recording");
  if (id) close(id);
  return new Response(null, { status: 204, headers });
}
