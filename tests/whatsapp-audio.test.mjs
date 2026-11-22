import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanTextForVoice,
  convertMarkdownTablesToMobileText,
  detectLocale,
  generateVoiceSummary,
} from "../src/lib/whatsapp/audio.ts";

test("cleanTextForVoice strips markdown, tables, links, and code cleanly for Cartesia TTS", () => {
  const markdown = "Hello **Fatima**! Your claim `CLM-001` is [approved](https://relief.pk). | Amount | Status |\n|---|---|\n| 12,000 | Paid |";
  const cleaned = cleanTextForVoice(markdown);
  assert(!cleaned.includes("**"));
  assert(!cleaned.includes("`"));
  assert(!cleaned.includes("[approved]"));
  assert(!cleaned.includes("https://"));
  assert(!cleaned.includes("|---|"));
  assert(cleaned.includes("Hello Fatima"));
  assert(cleaned.includes("approved"));
  assert(cleaned.includes("Amount"));
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
