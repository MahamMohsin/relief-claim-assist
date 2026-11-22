import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as baileysPkg from "@whiskeysockets/baileys";
import QRCode from "qrcode";

const makeWASocket = baileysPkg.default?.makeWASocket || baileysPkg.makeWASocket;
const useMultiFileAuthState = baileysPkg.default?.useMultiFileAuthState || baileysPkg.useMultiFileAuthState;
const fetchLatestWaWebVersion = baileysPkg.default?.fetchLatestWaWebVersion || baileysPkg.fetchLatestWaWebVersion;
const DisconnectReason = baileysPkg.default?.DisconnectReason || baileysPkg.DisconnectReason;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const AUTH_DIR = path.join(ROOT_DIR, ".whatsapp-auth");
const STATE_FILE = path.join(ROOT_DIR, ".whatsapp-state.json");
const COMMAND_FILE = path.join(ROOT_DIR, ".whatsapp-command.json");

function makeSilentLogger() {
  const noop = () => {};
  return {
    level: "silent",
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    child: () => makeSilentLogger(),
  };
}

function writeState(data) {
  try {
    const existing = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) : {};
    const merged = { ...existing, ...data, updatedAt: new Date().toISOString() };
    fs.writeFileSync(STATE_FILE, JSON.stringify(merged, null, 2), "utf-8");
  } catch (err) {
    console.error("[wa-gateway] Error writing state:", err);
  }
}

function cleanPhone(rawJid) {
  if (!rawJid) return null;
  const num = rawJid.split("@")[0].split(":")[0];
  if (num.startsWith("92") && num.length >= 12) {
    return `+92 ${num.slice(2, 5)} ${num.slice(5)}`;
  }
  return `+${num}`;
}

async function startGateway() {
  console.log("[wa-gateway] Starting live WhatsApp Web gateway via Baileys...");

  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  writeState({
    status: "initializing",
    adminPhone: null,
    qrData: null,
    qrDataUrl: null,
    botName: "Relief Assist WhatsApp Official Bot",
  });

  const { version, isLatest } = await fetchLatestWaWebVersion({}).catch(() => ({
    version: [2, 3000, 1055762171],
    isLatest: true,
  }));
  console.log(`[wa-gateway] Protocol version: ${version.join(".")}, isLatest: ${isLatest}`);

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const sock = makeWASocket({
    auth: state,
    version,
    logger: makeSilentLogger(),
    printQRInTerminal: false,
    browser: ["Mac OS", "Desktop", "14.4.1"],
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log("[wa-gateway] REAL Live QR Code received from WhatsApp servers!");
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, {
          margin: 1,
          width: 256,
          color: { dark: "#064e3b", light: "#ffffff" },
        });

        writeState({
          status: "qr_ready",
          adminPhone: null,
          qrData: qr,
          qrDataUrl,
          message: "Scan with WhatsApp > Linked Devices > Link a Device",
        });
        console.log("[wa-gateway] QR code data URL successfully written to state file.");
      } catch (err) {
        console.error("[wa-gateway] Error converting QR to data URL:", err);
      }
    }

    if (connection === "open") {
      const userJid = sock.user?.id || "";
      const formattedPhone = cleanPhone(userJid) || "+92 300 0000000";
      console.log(`[wa-gateway] 🚀 WhatsApp Web successfully connected! Admin Phone: ${formattedPhone}`);

      writeState({
        status: "connected",
        adminPhone: formattedPhone,
        adminJid: userJid,
        qrData: null,
        qrDataUrl: null,
        connectedAt: new Date().toISOString(),
      });
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log(`[wa-gateway] Connection closed with statusCode=${statusCode}, shouldReconnect=${shouldReconnect}`);

      if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
        console.log("[wa-gateway] Logged out from WhatsApp. Wiping auth credentials and resetting...");
        try {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        } catch {}
        writeState({
          status: "disconnected",
          adminPhone: null,
          qrData: null,
          qrDataUrl: null,
        });
        setTimeout(startGateway, 2000);
      } else if (shouldReconnect) {
        console.log("[wa-gateway] Reconnecting in 3s...");
        setTimeout(startGateway, 3000);
      }
    }
  });

  // Handle incoming WhatsApp messages
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || remoteJid.endsWith("@g.us")) continue; // Focus on direct 1:1 chats

      const senderPhone = cleanPhone(remoteJid);
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        "";

      if (!text.trim()) continue;

      console.log(`[wa-gateway] Inbound message from ${senderPhone}: "${text}"`);

      try {
        // Send to local webhook
        const res = await fetch("http://127.0.0.1:3000/api/whatsapp/webhook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from: senderPhone,
            text,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data.reply) {
            console.log(`[wa-gateway] Sending bot response to ${senderPhone}...`);
            await sock.sendMessage(remoteJid, { text: data.reply });
          }
        }
      } catch (err) {
        console.error("[wa-gateway] Failed to route message to webhook:", err);
      }
    }
  });

  // Check for external commands (e.g. disconnect from admin dashboard)
  const commandChecker = setInterval(() => {
    if (fs.existsSync(COMMAND_FILE)) {
      try {
        const cmd = JSON.parse(fs.readFileSync(COMMAND_FILE, "utf-8"));
        fs.unlinkSync(COMMAND_FILE);
        if (cmd.action === "disconnect") {
          console.log("[wa-gateway] Received disconnect command from UI. Closing session...");
          clearInterval(commandChecker);
          sock.logout().catch(() => {});
          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          } catch {}
          setTimeout(startGateway, 1000);
        } else if (cmd.action === "refresh_qr") {
          console.log("[wa-gateway] Received refresh QR command from UI.");
          clearInterval(commandChecker);
          sock.end(undefined);
          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          } catch {}
          setTimeout(startGateway, 800);
        }
      } catch (err) {
        console.error("[wa-gateway] Command processing error:", err);
      }
    }
  }, 1000);
}

startGateway().catch(err => {
  console.error("[wa-gateway] Fatal error starting WhatsApp gateway:", err);
});
