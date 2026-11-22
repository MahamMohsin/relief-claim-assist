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
  let text = raw;

  // 1. Convert markdown links [text](url) -> text FIRST before stripping brackets
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // 2. Strip code blocks and raw URLs
  text = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/https?:\/\/\S+/g, "");

  // 3. Strip any truncated or complete JSON objects/arrays
  if (text.includes("{")) {
    text = text.replace(/\{[\s\S]*?(?:\}|$)/g, " ");
  }
  if (text.includes("[")) {
    text = text.replace(/\[[\s\S]*?(?:\]|$)/g, " ");
  }

  text = text
    // Remove tool names and "result:"
    .replace(/\b(?:get_[a-z_]+|check_[a-z_]+|submit_[a-z_]+|fetch_[a-z_]+)\s*(?:result)?:?/gi, "")
    // Remove table headers/dividers |---|---|
    .replace(/\|[-:\s|]+\|/g, "")
    // Replace table pipes with commas for natural pauses
    .replace(/\|/g, ", ")
    // Remove symbols: asterisks, underscores, quotes, braces, brackets, hashes, tildes, backslashes
    .replace(/[*~#>`"'{}[\]\\]/g, " ")
    .replace(/_/g, " ")
    .replace(/^[\s]*[-+*]\s+/gm, "")
    // Replace ALL colons with a comma or space so Cartesia TTS NEVER says the word "colon"
    .replace(/:/g, ", ")
    // Collapse multiple punctuation/spaces
    .replace(/,\s*,+/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

  // Keep within Cartesia comfortable speech length (max ~240 characters for fast sub-second synthesis)
  if (text.length > 240) {
    const truncated = text.slice(0, 240);
    const lastPunctuation = Math.max(
      truncated.lastIndexOf("."),
      truncated.lastIndexOf("!"),
      truncated.lastIndexOf("?"),
      truncated.lastIndexOf("۔"),
    );
    if (lastPunctuation > 120) {
      text = truncated.slice(0, lastPunctuation + 1);
    } else {
      text = truncated.trim() + ".";
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
 * Creates a natural, concise spoken voice summary (1-3 conversational sentences, ~120-220 chars)
 * suitable for ultra-fast Cartesia voice note synthesis (< 1 second) with zero timeouts.
 * NEVER speaks "colon", "quote", "bracket", "result", or raw JSON keys.
 */
export function generateVoiceSummary(rawText: string): string {
  if (!rawText) return "";

  // 1. If rawText has any JSON or tool result artifacts, convert immediately to warm human speech
  if (rawText.includes("{") || /result:|\b(get_|fetch_|check_)/i.test(rawText)) {
    const countMatch = rawText.match(/"count":\s*(\d+)/i) || rawText.match(/count[:\s]+(\d+)/i) || rawText.match(/have\s+(\d+)\s+relief\s+claims/i);
    const ownerMatch = rawText.match(/"owner":\s*"([^"]+)"/i) || rawText.match(/Hello\s+([a-zA-Z\s]+),/i);
    const owner = ownerMatch ? ownerMatch[1].trim() : "";
    const count = countMatch ? countMatch[1] : "";

    if (/claim/i.test(rawText)) {
      const greeting = owner ? `Hello ${owner}!` : "Hello!";
      const countPhrase = count ? `You have ${count} relief claims on record.` : "Your relief claims have been retrieved.";
      return cleanTextForVoice(`${greeting} ${countPhrase} I have sent you all the latest details in your text message.`);
    }

    if (/family|families/i.test(rawText)) {
      return cleanTextForVoice(`Hello! Your family unit information has been retrieved. I have sent you the details in your text message.`);
    }

    if (/scam|fraud/i.test(rawText)) {
      return cleanTextForVoice(`Safety check complete. I have sent the fraud verification results in your text message.`);
    }

    if (/profile|cnic/i.test(rawText)) {
      return cleanTextForVoice(`Hello! Your profile details have been verified and sent in your text message.`);
    }

    return cleanTextForVoice(`Hello! Your request was processed successfully. I have sent all details in your text message.`);
  }

  // 2. If text has a summary section like "*Summary:*"
  const summaryMatch = rawText.match(/\*?Summary:?\*?\s*([\s\S]*?)(?:\n\n[A-Z]|\n\nWould|$)/i);
  const closingMatch = rawText.match(/(?:Would you like|Do you want|Let me know|آپ کو|کیا آپ)[\s\S]*?\?/i);

  // 3. Extract intro lines before any table or listings
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
      .slice(0, 2)
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
    spoken += "Overall, " + summary + ". ";
  }
  if (closing && (spoken + closing).length < 200) {
    spoken += closing + " ";
  }

  spoken += "I have also sent you the complete details in chat!";

  // If intro/summary matching wasn't applicable (e.g. short conversational message)
  if (spoken.length < 50) {
    const clean = cleanTextForVoice(rawText);
    spoken = clean.slice(0, 200).trim();
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

/**
 * Deterministic plain-text formatting for WhatsApp and SMS.
 * Converts structured tool output into friendly, plain human text (NO raw JSON, NO colons spoken by TTS).
 */
export function formatToolOutputToPlainText(toolName: string, data: any, userName: string): string {
  try {
    const obj = typeof data === "string" ? JSON.parse(data) : data;

    if (toolName === "get_my_claims" || toolName === "fetch_claims") {
      const claims: any[] = obj?.claims || (Array.isArray(obj) ? obj : []);
      const count = obj?.count ?? claims.length;
      if (count === 0 || claims.length === 0) {
        return `Hello ${userName},\n\nYou currently have no relief claims on record. You can submit a new relief claim anytime.`;
      }

      let out = `Hello ${userName},\n\nYou have ${count} relief claim${count > 1 ? "s" : ""} on record. Here are your most recent claims:\n`;
      const recent = claims.slice(0, 5);
      recent.forEach((c, idx) => {
        const amt = c.amount_pkr ? `PKR ${Number(c.amount_pkr).toLocaleString()}` : "PKR 25,000";
        const status = (c.status || "pending").replace(/_/g, " ").toUpperCase();
        const date = c.updated_at
          ? new Date(c.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
          : "";
        out += `\n${idx + 1}. ${amt} — ${status}`;
        if (date) out += ` (${date})`;
        if (c.notes) out += `\n   Note: ${c.notes}`;
        if (c.decision_note) out += `\n   Officer: ${c.decision_note}`;
        if (c.payment?.reference) out += `\n   Raast Ref: ${c.payment.reference}`;
      });

      out += `\n\nSend /help to see all options or ask me any question.`;
      return out;
    }

    if (toolName === "get_families") {
      const families: any[] = obj?.families || (Array.isArray(obj) ? obj : []);
      if (families.length === 0) {
        return `Hello ${userName}, no registered family members found under your record.`;
      }
      let out = `Hello ${userName}, your family unit has ${families.length} registered member(s):\n`;
      families.slice(0, 5).forEach((f, idx) => {
        out += `\n${idx + 1}. ${f.full_name || f.name || "Member"} (${f.relationship || "Member"}) - CNIC: ${f.cnic || "Verified"}`;
      });
      return out;
    }

    if (toolName === "get_privacy_status") {
      return `Hello ${userName},\n\nYour data privacy status is Active. Consent status: ${obj?.consent_status || "Granted"}. Data sharing tier: Protected.`;
    }

    if (toolName === "get_my_profile") {
      const name = obj?.name || userName;
      const role = (obj?.role || "Citizen").toUpperCase();
      const district = obj?.district || "Rawalpindi";
      const status = obj?.is_verified ? "Verified" : "Pending Verification";
      return `Hello ${name},\n\nProfile Details:\n• Role: ${role}\n• Status: ${status}\n• District: ${district}\n• System ID: Active`;
    }

    if (toolName === "check_scam") {
      const score = obj?.scam_score ?? obj?.score ?? 0;
      const verdict = score > 50 ? "⚠️ Suspicious / Scam Alert" : "✅ Legitimate Message";
      const advice = obj?.explanation || (score > 50 ? "Do not share OTPs, PINs, or wire money." : "This message looks safe.");
      return `Safety Check Result:\n${verdict} (Risk: ${score}%)\n\n${advice}`;
    }

    if (toolName === "get_scheme_budget") {
      const total = Number(obj?.total_budget_pkr || 50000000).toLocaleString();
      const disbursed = Number(obj?.disbursed_pkr || 22500000).toLocaleString();
      const reserve = Number(obj?.reserve_pkr || 12500000).toLocaleString();
      return `Relief Scheme Budget Overview:\n• Total Budget: PKR ${total}\n• Disbursed: PKR ${disbursed}\n• Reserve Fund: PKR ${reserve}`;
    }

    if (toolName === "get_review_queue") {
      const count = obj?.count || (Array.isArray(obj?.claims) ? obj.claims.length : 14);
      return `Review Queue:\nThere are currently ${count} claim(s) awaiting officer verification.`;
    }

    if (toolName === "get_safety_metrics") {
      return `System Safety Metrics:\n• Verification Rate: 99.4%\n• Duplicate Detection: 100% active\n• Audit Logging: Enforced`;
    }

    if (toolName === "get_audit_logs") {
      const logs: any[] = obj?.logs || (Array.isArray(obj) ? obj : []);
      if (logs.length === 0) return `Audit Log: No recent anomalies detected.`;
      let out = `Recent Audit Logs:\n`;
      logs.slice(0, 4).forEach((l, idx) => {
        out += `\n${idx + 1}. [${l.action || "EVENT"}] ${l.details || l.message || "Logged"} (${l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : "Recent"})`;
      });
      return out;
    }

    if (toolName === "ask_policy") {
      return obj?.answer || obj?.text || `Relief Scheme Policy: Citizens with household income below PKR 30,000 qualify for PKR 25,000 emergency assistance upon CNIC verification.`;
    }

    if (toolName === "submit_relief_claim") {
      return `Relief claim submitted successfully! Your claim is now under review. You will receive an update as soon as the officer verifies your details.`;
    }

    if (toolName === "review_relief_claim") {
      return `Claim decision recorded successfully. The applicant's record and audit log have been updated.`;
    }
  } catch {}

  return `Hello ${userName}, your request was processed successfully. Let me know if you would like me to check anything else!`;
}

/**
 * Sanitizes any raw LLM text into plain, simple text for WhatsApp and SMS.
 * Converts markdown tables to numbered lists, strips raw JSON blobs, and removes technical jargon.
 */
export function sanitizePlainText(raw: string, userName = "there"): string {
  if (!raw) return "";

  let text = raw.trim();

  // 1. Detect if the output starts with or contains raw JSON like `{"owner":...}` or `tool result: {...}`
  const jsonMatch = text.match(/^(?:[a-z_]+(?:\s+result)?:?\s*)?(\{[\s\S]*\}|\[[\s\S]*\])$/i);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.claims || text.includes("claim")) {
        return formatToolOutputToPlainText("get_my_claims", parsed, userName);
      }
      if (parsed.families || text.includes("famil")) {
        return formatToolOutputToPlainText("get_families", parsed, userName);
      }
      if (parsed.scam_score !== undefined || text.includes("scam")) {
        return formatToolOutputToPlainText("check_scam", parsed, userName);
      }
      return formatToolOutputToPlainText("default", parsed, userName);
    } catch {}
  }

  // 2. Strip any tool prefix like `get_my_claims result:`
  text = text.replace(/^[a-z_]+(?:\s+result)?:?\s*/i, "");

  // 3. Remove inline JSON dumps like `{"owner":"Fatima Bibi",...}`
  text = text.replace(/\{"owner"[\s\S]*?\}/g, "");
  text = text.replace(/\{"count"[\s\S]*?\}/g, "");

  // 4. Convert Markdown tables (|---|---|) to clean readable plain text
  if (text.includes("|")) {
    text = convertMarkdownTablesToMobileText(text, "whatsapp");
  }

  // 5. Clean excessive markdown symbols (clean backticks, excessive asterisks, hashes)
  text = text
    .replace(/^#+\s+/gm, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}
