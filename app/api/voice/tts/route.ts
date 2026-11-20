import { z } from "zod";
import { apiError, ApiError, gateway, readJson } from "@/src/lib/server";

const speak = z.object({ text: z.string().trim().min(1).max(1400), locale: z.enum(["en", "ur"]) });

export async function POST(request: Request) {
  try {
    await gateway("profile");
    const parsed = speak.safeParse(await readJson(request));
    if (!parsed.success) throw new ApiError(400, "Provide text and an English or Urdu locale.");
    const { text, locale } = parsed.data;
    const voice = locale === "ur" ? process.env.CARTESIA_VOICE_UR : process.env.CARTESIA_VOICE_EN;
    const key = process.env.CARTESIA_API_KEY;
    if (!key || !voice) return Response.json({ fallback: "browser", reason: "Cartesia is not configured for this language." }, { status: 503 });
    const upstream = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST", signal: AbortSignal.timeout(12000),
      headers: { Authorization: "Bearer " + key, "Cartesia-Version": "2025-04-16", "Content-Type": "application/json" },
      body: JSON.stringify({
        model_id: "sonic-3.6", transcript: text, language: locale, voice: { mode: "id", id: voice },
        output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
      }),
    });
    if (!upstream.ok || !upstream.body) return Response.json({ fallback: "browser" }, { status: 502 });
    return new Response(upstream.body, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
