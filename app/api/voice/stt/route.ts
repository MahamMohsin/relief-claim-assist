import { apiError, ApiError, gateway } from "@/src/lib/server";

export const runtime = "nodejs";
const maxAudio = 4_000_000;

export async function POST(request: Request) {
  try {
    await gateway("profile");
    const key = process.env.DEEPGRAM_API_KEY;
    if (!key) throw new ApiError(503, "Voice transcription is unavailable. You can type your request.");
    const media = request.headers.get("content-type") ?? "";
    if (!/^audio\/(?:webm|ogg|wav|mp4|mpeg)(?:;.*)?$/i.test(media)) {
      throw new ApiError(415, "Send a supported audio recording.");
    }
    const reader = request.body?.getReader();
    if (!reader || Number(request.headers.get("content-length")) > maxAudio) throw new ApiError(413, "Record a shorter clip.");
    const chunks: ArrayBuffer[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxAudio) {
        await reader.cancel();
        throw new ApiError(413, "Record a shorter clip.");
      }
      chunks.push(Uint8Array.from(value).buffer);
    }
    if (!total) throw new ApiError(400, "No audio was recorded.");
    const locale = new URL(request.url).searchParams.get("lang") === "en" ? "en" : "ur";
    const upstream = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&language=" + locale + "&smart_format=true", {
      method: "POST", body: new Blob(chunks, { type: media }),
      headers: { Authorization: "Token " + key, "Content-Type": media }, signal: AbortSignal.timeout(20000),
    });
    if (!upstream.ok) {
      console.error("Deepgram HTTP", upstream.status);
      throw new ApiError(502, "Transcription is unavailable. You can type your request.");
    }
    const json = await upstream.json();
    return Response.json({ transcript: json.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "", model: "deepgram/nova-3", locale });
  } catch (error) {
    return apiError(error);
  }
}
