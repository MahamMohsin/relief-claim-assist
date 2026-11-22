export const WHATSAPP_AGENT_BASE_URL = "https://api.whatsapp.com/agent/v1";

export interface TranscribeResult {
  transcript: string;
  locale: "en" | "ur";
}

export interface VoiceSynthesisResult {
  audioBuffer: Buffer;
  locale: "en" | "ur";
}

/**
 * Automatically converts raw Markdown tables into clean, readable mobile cards for WhatsApp & SMS.
 * Prevents garbled multi-column pipe (|---|---|) text from rendering on mobile screens.
 */
export function convertMarkdownTablesToMobileText(text: string, channel: "whatsapp" | "sms" = "whatsapp"): string {
  if (!text || !text.includes("|")) return text;

  // Regex matching a markdown table: header line, separator line (|---|---|), and row lines
  const tableRegex = /((?:\|[^\n\r]+\|[\r\n]+)(?:\|[-:\s|]+\|[\r\n]+)(?:\|[^\n\r]+\|(?:[\r\n]+|$))+)/g;

  return text.replace(tableRegex, (fullTable) => {
    const lines = fullTable.trim().split(/\r?\n/).filter(l => l.trim().startsWith("|"));
    if (lines.length < 3) return fullTable;

    const rawHeaders = lines[0]
      .split("|")
      .map(s => s.trim().replace(/^[*_`]+|[*_`]+$/g, ""))
      .filter(Boolean);

    const cards: string[] = [];
    for (let i = 2; i < lines.length; i++) {
      const rowCells = lines[i].split("|").map(s => s.trim());
      if (rowCells[0] === "") rowCells.shift();
      if (rowCells[rowCells.length - 1] === "") rowCells.pop();

      const item: Record<string, string> = {};
      rawHeaders.forEach((h, idx) => {
        item[h.toLowerCase()] = rowCells[idx] || "";
      });

      const num = item["#"] || item["no"] || item["num"] || `${i - 1}`;
      const status = item["status"] || item["state"] || "";
      const amount = item["amount"] || item["pkr"] || "";
      const date = item["date"] || item["created"] || item["updated"] || "";
      const notes = item["notes"] || item["description"] || item["reason"] || "";

      const secondary: string[] = [];
      for (const [k, v] of Object.entries(item)) {
        if (!v || ["#", "no", "num", "status", "state", "amount", "pkr", "date", "created", "updated", "notes", "description"].includes(k)) {
          continue;
        }
        const capKey = k.charAt(0).toUpperCase() + k.slice(1);
        secondary.push(`${capKey}: ${v}`);
      }

      let card = `${num}. `;
      if (status) card += `${status} `;
      if (amount) card += `— *${amount.replace(/\*/g, "")}* `;
      if (date) card += `(${date.replace(/\*/g, "")})`;
      card = card.trim();

      if (notes) {
        card += `\n   • ${notes}`;
      }
      if (secondary.length > 0) {
        card += `\n   • ${secondary.join(" · ")}`;
      }

      cards.push(card);
    }

    let result = "\n" + cards.join("\n\n") + "\n";
    if (channel === "sms") {
      result = result.replace(/\*/g, ""); // Strip bold asterisks for SMS
    }
    return result;
  });
}

/**
 * Strips markdown markup, table borders, and URLs to ensure clean, natural speech synthesis via Cartesia.
 */
export function cleanTextForVoice(raw: string): string {
  if (!raw) return "";
  let text = raw
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, "")
    // Inline code
    .replace(/`([^`]+)`/g, "$1")
    // Markdown links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Remove raw URLs
    .replace(/https?:\/\/\S+/g, "")
    // Remove table headers/dividers |---|---|
    .replace(/\|[-:\s|]+\|/g, "")
    // Replace table pipes with commas for natural pauses
    .replace(/\|/g, ", ")
    // Remove asterisks, underscores, tildes, hashes, blockquotes, bullet dashes
    .replace(/[*_~#>]/g, "")
    .replace(/^[\s]*[-+*]\s+/gm, "")
    // Collapse excess whitespace
    .replace(/\s+/g, " ")
    .trim();

  // Keep within Cartesia comfortable speech length (max ~1200 characters)
  if (text.length > 1200) {
    const truncated = text.slice(0, 1200);
    const lastPunctuation = Math.max(
      truncated.lastIndexOf("."),
      truncated.lastIndexOf("!"),
      truncated.lastIndexOf("?"),
      truncated.lastIndexOf("۔"),
    );
    if (lastPunctuation > 400) {
      text = truncated.slice(0, lastPunctuation + 1);
    } else {
      text = truncated.trim() + "...";
    }
  }

  return text;
}

/**
 * Detects whether the text is predominantly Urdu or English.
 */
export function detectLocale(text: string, override?: "en" | "ur"): "en" | "ur" {
  if (override) return override;
  // Urdu Unicode ranges: \u0600-\u06FF, \u0750-\u077F, \uFB50-\uFDFF, \uFE70-\uFEFF
  const hasUrdu = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
  return hasUrdu ? "ur" : "en";
}

/**
 * Step 1 & 2: Download incoming media file from WhatsApp Agent Platform.
 * Reference: WhatsApp Agent Platform Developer Manual v1 (August 25, 2026), Section 4 "Media Handling".
 */
export async function downloadWhatsAppMedia(
  apiKey: string,
  mediaId: string,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const cleanKey = apiKey.trim();
    if (!cleanKey || !mediaId) return null;

    // 1. GET /agent/v1/media/<mediaId> to obtain direct retrieval URL
    const metaRes = await fetch(`${WHATSAPP_AGENT_BASE_URL}/media/${encodeURIComponent(mediaId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cleanKey}`,
      },
    });

    if (!metaRes.ok) {
      console.error(`[wa-audio] Failed to get media metadata for ${mediaId}: HTTP ${metaRes.status}`);
      return null;
    }

    const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!meta.url) {
      console.error(`[wa-audio] No download URL returned for mediaId ${mediaId}`);
      return null;
    }

    const mimeType = meta.mime_type || "audio/ogg";

    // 2. Fetch binary audio bytes from download URL
    const audioRes = await fetch(meta.url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cleanKey}`,
        "User-Agent": "ReliefClaimAssist/1.0",
      },
    });

    if (!audioRes.ok) {
      console.error(`[wa-audio] Failed to download media bytes: HTTP ${audioRes.status}`);
      return null;
    }

    const arrayBuffer = await audioRes.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      mimeType,
    };
  } catch (err) {
    console.error("[wa-audio] Error downloading WhatsApp media:", err);
    return null;
  }
}

/**
 * Transcribe binary audio buffer using Deepgram Nova-3 with retry on transient network errors.
 */
export async function transcribeWhatsAppAudio(
  audioBuffer: Buffer,
  mimeType = "audio/ogg",
  preferredLocale?: "en" | "ur",
): Promise<TranscribeResult> {
  const deepgramKey = process.env.DEEPGRAM_API_KEY || process.env.NEXT_PUBLIC_DEEPGRAM_KEY;
  if (!deepgramKey) {
    throw new Error("DEEPGRAM_API_KEY is not configured.");
  }

  // Clean mime-type for Deepgram
  const cleanMime = mimeType.split(";")[0].trim() || "audio/ogg";
  const langParam = preferredLocale ? `&language=${preferredLocale}` : "&detect_language=true";
  const url = `https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true${langParam}`;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Token ${deepgramKey}`,
          "Content-Type": cleanMime,
        },
        body: new Uint8Array(audioBuffer),
        signal: AbortSignal.timeout(25000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(`Deepgram STT failed with HTTP ${res.status}: ${errText}`);
      }

      const json = await res.json();
      const alternative = json?.results?.channels?.[0]?.alternatives?.[0];
      const transcript = (alternative?.transcript || "").trim();
      const detected = alternative?.detected_language || json?.results?.channels?.[0]?.detected_language;
      const locale: "en" | "ur" =
        detected === "ur" || detectLocale(transcript) === "ur" ? "ur" : "en";

      return { transcript, locale };
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Creates a natural, concise spoken voice summary (1-3 conversational sentences, ~150-320 chars)
 * suitable for ultra-fast Cartesia voice note synthesis (< 1.5 seconds) with zero timeouts.
 */
export function generateVoiceSummary(rawText: string): string {
  if (!rawText) return "";

  // 1. If text has a summary section like "*Summary:*"
  const summaryMatch = rawText.match(/\*?Summary:?\*?\s*([\s\S]*?)(?:\n\n[A-Z]|\n\nWould|$)/i);
  const closingMatch = rawText.match(/(?:Would you like|Do you want|Let me know|آپ کو|کیا آپ)[\s\S]*?\?/i);

  // 2. Extract intro lines before any table or listings
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let intro = "";
  for (const l of lines) {
    if (l.startsWith("|") || l.startsWith("1.") || l.startsWith("•") || /^\*?Summary/i.test(l)) break;
    intro += " " + l.replace(/[*_~`]/g, "");
  }
  intro = intro.trim();

  let summary = "";
  if (summaryMatch) {
    summary = summaryMatch[1]
      .split(/\r?\n/)
      .map(l => l.replace(/^[•*\-\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(", ")
      .replace(/[*_~`]/g, "");
  }

  let closing = "";
  if (closingMatch) {
    closing = closingMatch[0].replace(/[*_~`]/g, "").trim();
  }

  let spoken = "";
  if (intro) {
    spoken += intro + ". ";
  }
  if (summary) {
    spoken += "Summary: " + summary + ". ";
  }
  if (closing && (spoken + closing).length < 280) {
    spoken += closing + " ";
  }

  spoken += "I have also sent you the complete details in chat!";

  // If intro/summary matching wasn't applicable (e.g. short conversational message)
  if (spoken.length < 60) {
    const clean = cleanTextForVoice(rawText);
    spoken = clean.slice(0, 260).trim();
    if (!spoken.endsWith(".") && !spoken.endsWith("!")) spoken += ".";
  }

  return cleanTextForVoice(spoken);
}

/**
 * Synthesize voice audio reply using Cartesia Sonic-3.6 (outputs MP3 binary).
 */
export async function synthesizeVoiceReply(
  text: string,
  preferredLocale?: "en" | "ur",
): Promise<VoiceSynthesisResult | null> {
  const cartesiaKey = process.env.CARTESIA_API_KEY;
  if (!cartesiaKey) {
    console.warn("[wa-audio] CARTESIA_API_KEY is not configured. Voice reply will be skipped.");
    return null;
  }

  const locale = detectLocale(text, preferredLocale);
  const voiceId =
    locale === "ur"
      ? process.env.CARTESIA_VOICE_UR || "a86bc28d-c3a1-405b-ad29-6a07417250f3"
      : process.env.CARTESIA_VOICE_EN || "55f006ff-520f-4413-8c01-b37d4555b194";

  const spokenText = generateVoiceSummary(text);
  if (!spokenText) return null;

  try {
    const t0 = Date.now();
    const res = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cartesiaKey}`,
        "Cartesia-Version": "2025-04-16",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: "sonic-3.6",
        transcript: spokenText,
        language: locale,
        voice: { mode: "id", id: voiceId },
        output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[wa-audio] Cartesia TTS failed with HTTP ${res.status}: ${errText}`);
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    console.log(`[wa-audio] Synthesized spoken voice in ${Date.now() - t0}ms (${arrayBuffer.byteLength} bytes)`);
    return {
      audioBuffer: Buffer.from(arrayBuffer),
      locale,
    };
  } catch (err) {
    console.error("[wa-audio] Error synthesizing voice reply via Cartesia:", err);
    return null;
  }
}

/**
 * Step 3: Upload MP3 voice note to WhatsApp Agent Platform Media endpoint.
 * Reference: Developer Manual v1, Section "Uploading Media", POST /agent/v1/media.
 */
export async function uploadWhatsAppMedia(
  apiKey: string,
  buffer: Buffer,
  mimeType = "audio/mpeg",
  filename = "voice_reply.mp3",
): Promise<{ mediaId: string } | null> {
  try {
    const cleanKey = apiKey.trim();
    if (!cleanKey) return null;

    const formData = new FormData();
    formData.append("messaging_product", "whatsapp");
    formData.append("type", mimeType);
    const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
    formData.append("file", blob, filename);

    const res = await fetch(`${WHATSAPP_AGENT_BASE_URL}/media`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cleanKey}`,
      },
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[wa-audio] Failed to upload media to WhatsApp: HTTP ${res.status} - ${errText}`);
      return null;
    }

    const json = (await res.json()) as { id?: string };
    if (!json?.id) {
      console.error("[wa-audio] WhatsApp media upload did not return a media ID:", json);
      return null;
    }

    return { mediaId: json.id };
  } catch (err) {
    console.error("[wa-audio] Error uploading WhatsApp media:", err);
    return null;
  }
}

/**
 * Step 4: Send outbound Voice/Audio Message to recipient on WhatsApp.
 * Reference: Developer Manual v1, Section "Audio Messages", POST /agent/v1/messages.
 */
export async function sendAgentAudioMessage(
  apiKey: string,
  toRecipient: string,
  mediaId: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const cleanKey = apiKey.trim();
    const res = await fetch(`${WHATSAPP_AGENT_BASE_URL}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cleanKey}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toRecipient,
        type: "audio",
        audio: {
          id: mediaId,
        },
      }),
    });

    if (res.ok) {
      const json = await res.json();
      const messageId = json?.messages?.[0]?.id;
      return { success: true, messageId };
    }

    const errJson = await res.json().catch(() => ({}));
    return {
      success: false,
      error: errJson?.error?.message || `Send audio failed with HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Network error sending audio message",
    };
  }
}
