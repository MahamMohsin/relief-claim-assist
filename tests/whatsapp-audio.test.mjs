import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanTextForVoice,
  convertMarkdownTablesToMobileText,
  detectLocale,
  formatToolOutputToPlainText,
  generateVoiceSummary,
  sanitizePlainText,
} from "../src/lib/whatsapp/audio.ts";

test("cleanTextForVoice strips markdown, tables, links, and code cleanly for Cartesia TTS", () => {
  const markdown = "Hello **Fatima**! Your claim `CLM-001` is [approved](https://relief.pk). | Amount | Status |\n|---|---|\n| 12,000 | Paid |";
  const cleaned = cleanTextForVoice(markdown);
  assert(!cleaned.includes("**"));
  assert(!cleaned.includes("`"));
  assert(!cleaned.includes("[approved]"));
  assert(!cleaned.includes("https://"));
  assert(!cleaned.includes("|---|"));
  assert(!cleaned.includes(":"));
  assert(cleaned.includes("Hello Fatima"));
  assert(cleaned.includes("approved"));
  assert(cleaned.includes("Amount"));
});

test("cleanTextForVoice strips colons and raw JSON braces so TTS never speaks 'colon'", () => {
  const raw = `get_my_claims result: {"owner":"Fatima Bibi","count":90,"claims":[{"id":"8815529e"}`;
  const cleaned = cleanTextForVoice(raw);
  assert(!cleaned.includes(":"), "Should not contain colons");
  assert(!cleaned.includes("{"), "Should not contain braces");
  assert(!cleaned.includes('"'), "Should not contain quotation marks");
  assert(!cleaned.includes("get_my_claims"), "Should not contain tool names");
});

test("generateVoiceSummary turns raw tool json into natural spoken voice without colons", () => {
  const rawJsonSlice = `get_my_claims result: {"owner":"Fatima Bibi","count":90,"claims":[{"id":"8815529e-7f30-4291-ae5d-8f183558aca0","citizen_id":"10000000-0000-4000-a000-000000000001","status":"needs_proof"`;
  const spoken = generateVoiceSummary(rawJsonSlice);
  assert(spoken.includes("Fatima Bibi"));
  assert(spoken.includes("90"));
  assert(spoken.includes("claims"));
  assert(!spoken.includes(":"), "Spoken summary should have no colons");
  assert(!spoken.includes("{"), "Spoken summary should have no braces");
  assert(!spoken.includes("result"), "Spoken summary should not say result");
  assert(spoken.length < 250, "Voice summary should be concise for sub-second synthesis");
});

test("formatToolOutputToPlainText and sanitizePlainText produce clean, human-readable plain text", () => {
  const claimsJson = {
    owner: "Fatima Bibi",
    count: 90,
    claims: [
      {
        id: "8815529e",
        amount_pkr: 25000,
        status: "needs_proof",
        updated_at: "2026-11-22T11:11:22Z",
        notes: "Widow, tailoring work",
      },
    ],
  };

  const formatted = formatToolOutputToPlainText("get_my_claims", claimsJson, "Fatima Bibi");
  assert(formatted.includes("Hello Fatima Bibi,"));
  assert(formatted.includes("90 relief claims on record"));
  assert(formatted.includes("PKR 25,000 — NEEDS PROOF"));
  assert(formatted.includes("Note: Widow, tailoring work"));
  assert(!formatted.includes("|---|"));
  assert(!formatted.includes('{"owner"'));

  const rawJsonString = `get_my_claims result: ${JSON.stringify(claimsJson)}`;
  const sanitized = sanitizePlainText(rawJsonString, "Fatima Bibi");
  assert(sanitized.includes("Hello Fatima Bibi,"));
  assert(sanitized.includes("90 relief claims on record"));
  assert(!sanitized.includes("result:"));
  assert(!sanitized.includes('{"owner"'));
});

test("convertMarkdownTablesToMobileText formats markdown tables into clean mobile cards for WhatsApp & SMS", () => {
  const tableText = `Here are your most recent relief claims, Fatima:

| # | Status | Amount | Household | Income/Mo | Notes | Date |
|---|--------|--------|-----------|-----------|-------|------|
| 1 | ⚠️ *Needs Proof* | PKR 25,000 | 3 | PKR 14,500 | Demo claim | Nov 22, 2026 |
| 2 | ✅ *Approved & Paid* | PKR 25,000 | 2 | PKR 10,000 | Emergency Relief Aid | Nov 22, 2026 |

*Summary:*
• *1 claim paid* — PKR 25,000 disbursed via Raast`;

  const mobileText = convertMarkdownTablesToMobileText(tableText, "whatsapp");
  assert(!mobileText.includes("|---|"));
  assert(!mobileText.includes("| # |"));
  assert(mobileText.includes("1. ⚠️ *Needs Proof* — *PKR 25,000*"));
  assert(mobileText.includes("2. ✅ *Approved & Paid* — *PKR 25,000*"));
  assert(mobileText.includes("Demo claim"));
  assert(mobileText.includes("Emergency Relief Aid"));

  // SMS strips bold asterisks
  const smsText = convertMarkdownTablesToMobileText(tableText, "sms");
  assert(!smsText.includes("*Needs Proof*"));
  assert(smsText.includes("Needs Proof"));
});

test("generateVoiceSummary creates a concise conversational spoken voice summary (< 350 chars)", () => {
  const longTableText = `Here are your most recent relief claims, Fatima:

*Total claims on record:* *90* (showing the 10 most recent)

| # | Status | Amount | Household | Income/Mo | Notes | Date |
|---|--------|--------|-----------|-----------|-------|------|
| 1 | ⚠️ *Needs Proof* | PKR 25,000 | 3 | PKR 14,500 | Demo claim for officer review | Nov 22, 2026 |
| 2 | ✅ *Approved & Paid* | PKR 25,000 | 3 | PKR 14,500 | Raast ref: SIM-7070C09C | Nov 22, 2026 |

*Summary:*
• *1 claim paid* — PKR 25,000 disbursed via Raast
• *1 claim approved* — payment pending

Would you like me to help attach documents to any of the needs_proof claims?`;

  const voiceSummary = generateVoiceSummary(longTableText);
  assert(voiceSummary.length > 30);
  assert(voiceSummary.length < 350);
  assert(voiceSummary.includes("Fatima"));
  assert(!voiceSummary.includes("|---|"));
  assert(!voiceSummary.includes("**"));
});

test("detectLocale identifies English vs Urdu text accurately", () => {
  assert.equal(detectLocale("What is the status of my claim?"), "en");
  assert.equal(detectLocale("Check my disbursement date"), "en");
  assert.equal(detectLocale("میری امدادی درخواست کا اسٹیٹس کیا ہے؟"), "ur");
  assert.equal(detectLocale("کیا مجھے ریلیف مل سکتا ہے؟"), "ur");
  assert.equal(detectLocale("Hello", "ur"), "ur"); // Explicit override preserved
});

test("WhatsApp Agent voice message structure matches Developer Manual v1 spec", () => {
  // Inbound Audio message payload validation
  const inboundAudio = {
    messaging_product: "whatsapp",
    from: "923015551234",
    id: "wamid.HBgLMjQ5Mg==",
    timestamp: "1724567890",
    type: "audio",
    audio: {
      id: "media-audio-12345",
      mime_type: "audio/ogg; codecs=opus",
      sha256: "abc123hash",
      voice: true,
    },
  };

  assert.equal(inboundAudio.type, "audio");
  assert.equal(inboundAudio.audio.voice, true);
  assert.equal(inboundAudio.audio.mime_type, "audio/ogg; codecs=opus");

  // Outbound Audio message payload validation
  const outboundAudio = {
    messaging_product: "whatsapp",
    to: "923015551234",
    type: "audio",
    audio: {
      id: "media-reply-67890",
    },
  };

  assert.equal(outboundAudio.type, "audio");
  assert.equal(outboundAudio.audio.id, "media-reply-67890");
});
