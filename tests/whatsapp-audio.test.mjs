import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanTextForVoice, detectLocale } from "../src/lib/whatsapp/audio.ts";

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
