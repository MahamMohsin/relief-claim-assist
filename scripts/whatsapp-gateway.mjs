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

function readState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    }
  } catch {}
  return {};
}

function writeState(data) {
  try {
    const existing = readState();
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

// Initialize persistent state from disk
const initialState = readState();
const defaultSavedPhone = initialState.adminPhone || "+92 349 2587419";
let isConnected = initialState.status === "connected" || Boolean(initialState.adminPhone);
let currentPhone = isConnected ? defaultSavedPhone : null;
let activeSocket = null;
let reconnectTimer = null;
let isConnecting = false;

if (isConnected) {
  console.log(`[wa-gateway] Restoring persistent connected session for: ${currentPhone}`);
  writeState({
    status: "connected",
    adminPhone: currentPhone,
    qrData: null,
    qrDataUrl: null,
    isPersisted: true,
  });
}

async function connectSocket() {
  if (isConnecting) return;
  isConnecting = true;

  if (activeSocket) {
    try {
      activeSocket.ev.removeAllListeners();
      activeSocket.ws?.close();
    } catch {}
    activeSocket = null;
  }

  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  const { version, isLatest } = await fetchLatestWaWebVersion({}).catch(() => ({
    version: [2, 3000, 1055762171],
    isLatest: true,
  }));
  console.log(`[wa-gateway] Protocol version: ${version.join(".")}, isLatest: ${isLatest}`);

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  // If we already have saved credentials from previous pairing, recover phone
  if (state.creds?.me?.id) {
    const savedPhone = cleanPhone(state.creds.me.id);
    if (savedPhone) {
      currentPhone = savedPhone;
      isConnected = true;
      console.log(`[wa-gateway] Found saved credentials for: ${savedPhone}`);
      writeState({
        status: "connected",
        adminPhone: savedPhone,
        qrData: null,
        qrDataUrl: null,
      });
    }
  }

  const sock = makeWASocket({
    auth: state,
    version,
    logger: makeSilentLogger(),
    printQRInTerminal: false,
    browser: ["Mac OS", "Desktop", "14.4.1"],
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
  });

  activeSocket = sock;
  isConnecting = false;

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Handle QR code
    if (qr) {
      const persisted = readState();
      // Never overwrite connected state or show QR if phone session is active/persisted
      if (isConnected || currentPhone || persisted.status === "connected") {
        console.log(`[wa-gateway] Suppressing QR update because device session is active (${currentPhone || persisted.adminPhone}).`);
        return;
      }

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
      } catch (err) {
        console.error("[wa-gateway] Error converting QR to data URL:", err);
      }
    }

    // Connection opened
    if (connection === "open") {
      isConnected = true;
      const userJid = sock.user?.id || state.creds?.me?.id || "";
      const formattedPhone = cleanPhone(userJid) || currentPhone || defaultSavedPhone;
      currentPhone = formattedPhone;
      console.log(`[wa-gateway] 🚀 WhatsApp Web successfully connected! Admin Phone: ${formattedPhone}`);

      writeState({
        status: "connected",
        adminPhone: formattedPhone,
        adminJid: userJid,
        qrData: null,
        qrDataUrl: null,
        connectedAt: new Date().toISOString(),
        isPersisted: true,
      });
    }

    // Connection closed
    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log(`[wa-gateway] Connection closed with statusCode=${statusCode}`);

      // If user unlinked device explicitly from UI or hard 401 loggedOut
      if (statusCode === DisconnectReason.loggedOut) {
        console.log("[wa-gateway] Logged out from WhatsApp.");
        // Only clear if not explicitly persisted
        const persisted = readState();
        if (!persisted.isPersisted) {
          isConnected = false;
          currentPhone = null;
          try {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          } catch {}
          writeState({
            status: "qr_ready",
            adminPhone: null,
            qrData: null,
            qrDataUrl: null,
          });
        }
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectSocket, 3000);
      } else {
        // Transient network drop or 515 (restart required)
        console.log(`[wa-gateway] Transient drop (status ${statusCode}). Preserving session for ${currentPhone} and reconnecting in 2.5s...`);
        // Always maintain connected status in state file
        if (currentPhone) {
          writeState({
            status: "connected",
            adminPhone: currentPhone,
            qrData: null,
            qrDataUrl: null,
            isPersisted: true,
          });
        }
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectSocket, 2500);
      }
    }
  });

  // Handle incoming WhatsApp messages
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const remoteJid = msg.key.remoteJid;
      if (!remoteJid || remoteJid.endsWith("@g.us")) continue; // direct chats

      const senderPhone = cleanPhone(remoteJid);
      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        "";

      if (!text.trim()) continue;

      console.log(`[wa-gateway] Inbound message from ${senderPhone}: "${text}"`);

      try {
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
}

// Single persistent command checker interval
setInterval(() => {
  if (fs.existsSync(COMMAND_FILE)) {
    try {
      const cmd = JSON.parse(fs.readFileSync(COMMAND_FILE, "utf-8"));
      fs.unlinkSync(COMMAND_FILE);

      if (cmd.action === "disconnect") {
        console.log("[wa-gateway] Received disconnect command from UI. Closing session...");
        isConnected = false;
        currentPhone = null;
        if (activeSocket) {
          try {
            activeSocket.logout().catch(() => {});
          } catch {}
        }
        try {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        } catch {}
        writeState({
          status: "qr_ready",
          adminPhone: null,
          qrData: null,
          qrDataUrl: null,
        });
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectSocket, 1500);
      } else if (cmd.action === "refresh_qr") {
        console.log("[wa-gateway] Received refresh QR command from UI.");
        isConnected = false;
        if (activeSocket) {
          try {
            activeSocket.ev.removeAllListeners();
            activeSocket.ws?.close();
          } catch {}
          activeSocket = null;
        }
        try {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        } catch {}
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connectSocket, 800);
      }
    } catch (err) {
      console.error("[wa-gateway] Command processing error:", err);
    }
  }
}, 1000);

console.log("[wa-gateway] Starting live WhatsApp Web gateway daemon...");
connectSocket().catch(err => {
  console.error("[wa-gateway] Fatal error starting WhatsApp gateway:", err);
});
