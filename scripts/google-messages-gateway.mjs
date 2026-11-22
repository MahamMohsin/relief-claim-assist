/**
 * Google Messages Direct SMS Gateway (Playwright-driven)
 *
 * Adapted from https://github.com/jaingxyz/google-messages-app
 * Drives https://messages.google.com/web/conversations with a persistent Chromium/Chrome/Edge
 * profile so the Admin pairs their phone ONCE via QR code (or Google Account), and Relief Assist
 * receives & replies to direct SMS messages (e.g. `/login <their-key>` -> AI chat).
 *
 * Cross-platform: Windows (Chrome/Edge/Chromium), macOS, Linux.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const PROFILE_DIR = process.env.GM_PROFILE_DIR || path.join(ROOT_DIR, ".google-messages-profile");
const STATE_FILE = path.join(ROOT_DIR, ".google-messages-state.json");
const COMMAND_FILE = path.join(ROOT_DIR, ".google-messages-command.json");
const WEBHOOK_URL = process.env.GM_WEBHOOK_URL || "http://127.0.0.1:3000/api/google-messages/webhook";
const VISIBLE_MODE = process.argv.includes("--visible") || process.env.GM_VISIBLE === "1";

const CONVERSATIONS_URL = "https://messages.google.com/web/conversations";
const USER_AGENT =
  process.platform === "win32"
    ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Verified Google Messages for Web DOM selectors (from jaingxyz/google-messages-app)
const SEL = {
  qr: "mw-qr-code, [data-e2e-qr-code], canvas[aria-label*='QR' i], img[alt*='QR' i]",
  pairWithQrButton:
    "button:has-text('Pair with QR'), a:has-text('Pair with QR'), button:has-text('QR code'), a:has-text('QR code')",
  rememberToggle:
    "mat-slide-toggle, input[type='checkbox'][aria-label*='Remember' i], button[role='switch']",
  convList: "mws-conversations-list, mws-conversation-list",
  convItem: "mws-conversation-list-item",
  convItemLink: "a.list-item, a[href*='/web/conversations/']",
  convItemName: "[data-e2e-conversation-name], h2.name, .name",
  convItemSnippet: "mws-conversation-snippet, .snippet-text, .snippet",
  convItemUnread: "[data-e2e-is-unread='true']",
  convItemTime: "[data-e2e-conversation-timestamp], mws-relative-timestamp, .timestamp, time",
  messageWrapper: "mws-message-wrapper",
  messagePart: "mws-text-message-part",
  messageTextFallback: ".text-msg",
  composeInput: "textarea[data-e2e-message-input-box], textarea[aria-label*='message' i], textarea[aria-label*='text' i]",
  sendButton: "mws-message-send-button button, button[aria-label*='Send' i]",
  startChatButton:
    "mw-fab-link a, a[href*='conversations/new'], button[aria-label*='Start chat' i]",
  recipientInput:
    "input[aria-label*='recipient' i], input[aria-label*='name, phone' i], input[type='text']",
  recipientFirstResult: "mw-contact-selector-result, [data-e2e-contact-result], .contact-row",
};

function readState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    }
  } catch {}
  return {};
}

function writeState(patch) {
  try {
    const existing = readState();
    const merged = {
      ...existing,
      ...patch,
      gatewayPid: process.pid,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(merged, null, 2), "utf-8");
  } catch (err) {
    console.error("[gm-gateway] Failed to write state:", err);
  }
}

function clearStaleLocks() {
  for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie", "lockfile"]) {
    try {
      fs.rmSync(path.join(PROFILE_DIR, f), { force: true });
    } catch {}
  }
}

async function launchBrowserContext() {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  clearStaleLocks();

  const stealthFlags = [
    "--disable-blink-features=AutomationControlled",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-infobars",
    "--disable-notifications",
  ];

  // Launch visibly in view on the user's desktop (explicitly setting on-screen coordinates
  // overrides any previously persisted off-screen window position in the Chromium profile).
  const windowFlags =
    process.env.GM_OFFSCREEN === "1" && !VISIBLE_MODE
      ? ["--window-position=-32000,-32000", "--window-size=1020,760"]
      : ["--window-position=80,60", "--window-size=1020,760"];

  const commonOptions = {
    headless: false,
    viewport: { width: 1000, height: 720 },
    userAgent: USER_AGENT,
    args: [...stealthFlags, ...windowFlags],
    locale: "en-US",
  };

  // Try bundled Playwright Chromium -> installed Google Chrome -> installed Microsoft Edge
  const candidates = [
    { label: "Playwright Chromium", opts: commonOptions },
    { label: "Google Chrome", opts: { ...commonOptions, channel: "chrome" } },
    { label: "Microsoft Edge", opts: { ...commonOptions, channel: "msedge" } },
  ];

  let lastErr = null;
  for (const candidate of candidates) {
    try {
      console.log(`[gm-gateway] Launching ${candidate.label} (visible=${VISIBLE_MODE})...`);
      const ctx = await chromium.launchPersistentContext(PROFILE_DIR, candidate.opts);
      console.log(`[gm-gateway] Launched ${candidate.label} successfully.`);
      return ctx;
    } catch (err) {
      lastErr = err;
      console.warn(`[gm-gateway] ${candidate.label} unavailable: ${err?.message || err}`);
    }
  }

  throw lastErr || new Error("No Chromium, Chrome, or Edge browser available for Playwright.");
}

async function snapshotConversations(page) {
  return page
    .$$eval(
      SEL.convItem,
      (items, sels) =>
        items.slice(0, 25).map(it => {
          const link = it.querySelector(sels.link);
          const name = (it.querySelector(sels.name)?.textContent || "").trim();
          const snippet = (it.querySelector(sels.snip)?.textContent || "").trim();
          const unread = Boolean(it.querySelector(sels.unread));
          const timeEl = it.querySelector(sels.time);
          const time = (
            timeEl?.getAttribute("title") ||
            timeEl?.getAttribute("aria-label") ||
            timeEl?.textContent ||
            ""
          ).trim();
          return {
            id: link?.getAttribute("href") || name,
            name,
            snippet,
            unread,
            time,
          };
        }),
      {
        link: SEL.convItemLink,
        name: SEL.convItemName,
        snip: SEL.convItemSnippet,
        unread: SEL.convItemUnread,
        time: SEL.convItemTime,
      },
    )
    .catch(() => []);
}

async function captureQrDataUrl(page) {
  try {
    // If Google Messages shows "Pair with QR code" option first, click it automatically
    const qrLoc = page.locator(SEL.qr).first();
    const hasQr = await qrLoc.isVisible().catch(() => false);
    if (!hasQr) {
      const switchBtn = page.locator(SEL.pairWithQrButton).first();
      if (await switchBtn.isVisible().catch(() => false)) {
        console.log("[gm-gateway] Clicking 'Pair with QR code' button...");
        await switchBtn.click().catch(() => {});
        await page.waitForTimeout(1500);
      }
    }

    // Try to enable "Remember this computer" toggle if visible and unchecked
    try {
      const toggle = page.locator(SEL.rememberToggle).first();
      if (await toggle.isVisible().catch(() => false)) {
        const checked = await toggle.getAttribute("aria-checked").catch(() => null);
        if (checked === "false") {
          await toggle.click().catch(() => {});
        }
      }
    } catch {}

    const qrVisible = await page.locator(SEL.qr).first().isVisible().catch(() => false);
    if (!qrVisible) return null;

    const buf = await page.locator(SEL.qr).first().screenshot({ type: "png" });
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

async function readLatestInboundMessage(page) {
  const msgs = page.locator(SEL.messageWrapper);
  const total = await msgs.count().catch(() => 0);
  if (total === 0) return null;

  const start = Math.max(0, total - 10);
  let lastMsg = null;

  for (let i = start; i < total; i++) {
    const m = msgs.nth(i);
    let parts = await m
      .locator(SEL.messagePart)
      .allTextContents()
      .catch(() => []);
    if (!parts.length) {
      parts = await m
        .locator(SEL.messageTextFallback)
        .allTextContents()
        .catch(() => []);
    }
    parts = parts.map(s => s.trim()).filter(Boolean);
    if (!parts.length) continue;

    const isOutgoing = (await m.getAttribute("is-outgoing").catch(() => null)) === "true";
    lastMsg = {
      index: i,
      isOutgoing,
      text: parts.join("\n"),
    };
  }

  return lastMsg;
}

async function sendTextInActiveThread(page, replyText) {
  const input = page.locator(SEL.composeInput).first();
  await input.waitFor({ state: "visible", timeout: 8000 });
  await input.click();
  await input.fill(replyText);

  const sendButtons = page.locator(SEL.sendButton);
  const count = await sendButtons.count();
  let clicked = false;
  for (let i = 0; i < count; i++) {
    const btn = sendButtons.nth(i);
    if ((await btn.isVisible().catch(() => false)) && (await btn.isEnabled().catch(() => false))) {
      await btn.click();
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    await input.press("Enter");
  }
  await page.waitForTimeout(1000);
}

async function sendSmsToRecipient(page, recipient, messageText) {
  const convs = await snapshotConversations(page);
  const targetLower = recipient.trim().toLowerCase();
  const normalizedTarget = recipient.replace(/[^0-9+]/g, "");

  const existing = convs.find(c => {
    if (c.name.toLowerCase() === targetLower) return true;
    const cDigits = c.name.replace(/[^0-9+]/g, "");
    return normalizedTarget.length >= 7 && cDigits.endsWith(normalizedTarget.slice(-10));
  });

  if (existing && existing.id.startsWith("/")) {
    await page.locator(`${SEL.convItem}:has(a[href="${existing.id}"])`).first().click();
    await page.waitForTimeout(1000);
  } else {
    await page.locator(SEL.startChatButton).first().click();
    await page.waitForTimeout(1000);
    const recipInput = page.locator(SEL.recipientInput).first();
    await recipInput.fill(recipient);
    await page.waitForTimeout(1500);
    const firstResult = page.locator(SEL.recipientFirstResult).first();
    if (await firstResult.count()) {
      await firstResult.click();
    } else {
      await recipInput.press("Enter");
    }
    await page.waitForTimeout(1200);
  }

  await sendTextInActiveThread(page, messageText);
}

async function main() {
  writeState({
    status: "starting",
    lastError: null,
    qrDataUrl: null,
    visibleMode: VISIBLE_MODE,
  });

  let context = null;
  let page = null;

  const cleanupAndExit = async (code = 0) => {
    try {
      if (context) await context.close().catch(() => {});
    } catch {}
    const current = readState();
    if (current.status !== "disconnected") {
      writeState({ status: "disconnected", gatewayPid: null, qrDataUrl: null });
    }
    process.exit(code);
  };

  process.on("SIGINT", () => void cleanupAndExit(0));
  process.on("SIGTERM", () => void cleanupAndExit(0));

  try {
    context = await launchBrowserContext();
    page = context.pages()[0] || (await context.newPage());
    await page.goto(CONVERSATIONS_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[gm-gateway] Failed to start browser:", msg);
    writeState({
      status: "error",
      lastError: msg,
      gatewayPid: null,
    });
    process.exit(1);
  }

  // Wait for either conversation list (paired) or QR screen (unpaired)
  await Promise.race([
    page.waitForSelector(SEL.convItem, { timeout: 20000 }).catch(() => {}),
    page.waitForSelector(SEL.qr, { timeout: 20000 }).catch(() => {}),
    page.waitForSelector(SEL.pairWithQrButton, { timeout: 20000 }).catch(() => {}),
  ]);

  let baselineInitialized = false;
  // Map of conversationId -> last seen snippet (so we NEVER reply to old messages on startup)
  const seenSnippets = new Map();
  // Set of already processed message fingerprints
  const processedMessages = new Set();

  let running = true;

  while (running) {
    try {
      if (page.isClosed()) {
        console.log("[gm-gateway] Browser page closed. Exiting.");
        break;
      }

      // 1. Check commands from Next.js API (.google-messages-command.json)
      if (fs.existsSync(COMMAND_FILE)) {
        try {
          const cmd = JSON.parse(fs.readFileSync(COMMAND_FILE, "utf-8"));
          fs.unlinkSync(COMMAND_FILE);

          if (cmd.action === "stop" || cmd.action === "disconnect") {
            console.log(`[gm-gateway] Received ${cmd.action} command.`);
            if (cmd.action === "disconnect") {
              try {
                await context.close().catch(() => {});
                context = null;
                fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
              } catch {}
            }
            writeState({
              status: "disconnected",
              qrDataUrl: null,
              pairedAt: null,
              gatewayPid: null,
              lastError: null,
            });
            running = false;
            break;
          } else if (cmd.action === "refresh_qr") {
            console.log("[gm-gateway] Refreshing Google Messages QR page...");
            await page.goto(CONVERSATIONS_URL, { waitUntil: "domcontentloaded" }).catch(() => {});
            await page.waitForTimeout(2000);
          } else if (cmd.action === "send_sms" && cmd.to && cmd.text) {
            console.log(`[gm-gateway] Executing outbound send_sms to ${cmd.to}...`);
            await sendSmsToRecipient(page, cmd.to, cmd.text);
          }
        } catch (cmdErr) {
          console.error("[gm-gateway] Command error:", cmdErr);
        }
      }

      // 2. Check if paired (conversation list items present)
      const convCount = await page.locator(SEL.convItem).count().catch(() => 0);

      if (convCount === 0) {
        baselineInitialized = false;
        const qrDataUrl = await captureQrDataUrl(page);
        if (qrDataUrl) {
          writeState({
            status: "qr_ready",
            qrDataUrl,
            lastError: null,
          });
        } else {
          writeState({
            status: "waiting_auth",
            lastError: null,
          });
        }
        await page.waitForTimeout(2500);
        continue;
      }

      // 3. PAIRED! Update state if transitioning
      const currentState = readState();
      if (currentState.status !== "connected") {
        console.log("[gm-gateway] Google Messages is PAIRED & active!");
        writeState({
          status: "connected",
          qrDataUrl: null,
          pairedAt: currentState.pairedAt || new Date().toISOString(),
          lastError: null,
        });
      }

      // 4. Snapshot recent conversations
      const convs = await snapshotConversations(page);

      if (!baselineInitialized) {
        for (const c of convs) {
          seenSnippets.set(c.id, c.snippet);
        }
        baselineInitialized = true;
        console.log(`[gm-gateway] Baseline captured for ${convs.length} existing conversations. Watching for new incoming SMS...`);
        await page.waitForTimeout(3000);
        continue;
      }

      // 5. Find conversations with new incoming activity
      for (const conv of convs.slice(0, 10)) {
        const prevSnippet = seenSnippets.get(conv.id);
        const snippetChanged = prevSnippet !== undefined && conv.snippet !== prevSnippet;
        const isBrandNewThread = prevSnippet === undefined && Boolean(conv.snippet);

        // Skip our own "You: ..." outgoing snippets
        const looksOutgoing = /^you:/i.test(conv.snippet);

        if ((conv.unread || snippetChanged || isBrandNewThread) && !looksOutgoing) {
          seenSnippets.set(conv.id, conv.snippet);

          // Open conversation to inspect exact latest bubble & verify it's incoming
          try {
            if (conv.id.startsWith("/")) {
              await page.locator(`${SEL.convItem}:has(a[href="${conv.id}"])`).first().click();
            } else {
              await page.locator(SEL.convItem, { hasText: conv.name }).first().click();
            }
            await page.waitForTimeout(1100);

            const latest = await readLatestInboundMessage(page);
            if (!latest || latest.isOutgoing || !latest.text) {
              continue;
            }

            const fingerprint = `${conv.id}::${latest.index}::${latest.text}`;
            if (processedMessages.has(fingerprint)) {
              continue;
            }
            processedMessages.add(fingerprint);
            if (processedMessages.size > 500) {
              const first = processedMessages.values().next().value;
              if (first) processedMessages.delete(first);
            }

            console.log(`[gm-gateway] Inbound SMS from "${conv.name}": "${latest.text}"`);

            // Route to Relief Assist Google Messages SMS webhook
            const res = await fetch(WEBHOOK_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                from: conv.name,
                threadId: conv.id,
                text: latest.text,
                source: "google_messages_live",
              }),
            });

            if (res.ok) {
              const data = await res.json();
              if (data.shouldReply && data.reply) {
                console.log(`[gm-gateway] Replying via SMS to "${conv.name}"...`);
                await sendTextInActiveThread(page, data.reply);
                seenSnippets.set(conv.id, `You: ${data.reply.slice(0, 40)}`);
              }
            }
          } catch (convErr) {
            console.error(`[gm-gateway] Error processing SMS thread "${conv.name}":`, convErr);
          }
        } else if (prevSnippet !== conv.snippet) {
          seenSnippets.set(conv.id, conv.snippet);
        }
      }

      await page.waitForTimeout(3500);
    } catch (loopErr) {
      console.error("[gm-gateway] Poll loop notice:", loopErr?.message || loopErr);
      await page.waitForTimeout(4000);
    }
  }

  await cleanupAndExit(0);
}

main().catch(err => {
  console.error("[gm-gateway] Fatal error:", err);
  writeState({
    status: "error",
    lastError: err instanceof Error ? err.message : String(err),
    gatewayPid: null,
  });
  process.exit(1);
});
