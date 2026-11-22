import QRCode from "qrcode";
import { getAllActiveSessionsCount } from "./session";

export type WhatsAppConnectionStatus = "connected" | "qr_ready" | "disconnected";

export type WhatsAppAdminState = {
  status: WhatsAppConnectionStatus;
  adminPhone: string | null;
  botName: string;
  qrData: string | null;
  qrDataUrl: string | null;
  connectedAt: string | null;
  lastActiveAt: string;
  activeUsersCount: number;
  mode: "baileys_mcp" | "simulated_gateway";
};

export type WhatsAppChatMessage = {
  id: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string;
  text: string;
  timestamp: string;
  toolsUsed?: string[];
};

interface WhatsAppServerStore {
  status: WhatsAppConnectionStatus;
  adminPhone: string | null;
  botName: string;
  qrData: string;
  qrDataUrl: string;
  connectedAt: string | null;
  lastActiveAt: string;
  messages: WhatsAppChatMessage[];
}

declare global {
  // eslint-disable-next-line no-var
  var __rca_whatsapp_server_store: WhatsAppServerStore | undefined;
}

function getStore(): WhatsAppServerStore {
  if (!globalThis.__rca_whatsapp_server_store) {
    const defaultQrData = `2@${Buffer.from(crypto.randomUUID()).toString("base64")},${Buffer.from("relief-assist-admin-pubkey").toString("base64")},${Buffer.from("token-" + Date.now()).toString("base64")}`;
    globalThis.__rca_whatsapp_server_store = {
      status: "qr_ready", // Starts ready for admin to scan QR code
      adminPhone: null, // Dynamic: configured by admin scanning QR code
      botName: "Relief Assist WhatsApp Official Bot",
      qrData: defaultQrData,
      qrDataUrl: "",
      connectedAt: null,
      lastActiveAt: new Date().toISOString(),
      messages: [],
    };
    // Initialize QR Code data URL asynchronously
    void QRCode.toDataURL(defaultQrData, {
      margin: 1,
      width: 256,
      color: { dark: "#064e3b", light: "#ffffff" },
    }).then(url => {
      if (globalThis.__rca_whatsapp_server_store) {
        globalThis.__rca_whatsapp_server_store.qrDataUrl = url;
      }
    });
  }
  return globalThis.__rca_whatsapp_server_store;
}

export async function getWhatsAppAdminState(): Promise<WhatsAppAdminState> {
  const store = getStore();
  if (!store.qrDataUrl && store.qrData) {
    store.qrDataUrl = await QRCode.toDataURL(store.qrData, {
      margin: 1,
      width: 256,
      color: { dark: "#064e3b", light: "#ffffff" },
    }).catch(() => "");
  }

  return {
    status: store.status,
    adminPhone: store.adminPhone,
    botName: store.botName,
    qrData: store.qrData,
    qrDataUrl: store.qrDataUrl,
    connectedAt: store.connectedAt,
    lastActiveAt: store.lastActiveAt,
    activeUsersCount: getAllActiveSessionsCount(),
    mode: "baileys_mcp",
  };
}

export async function refreshAdminPairingQr(): Promise<WhatsAppAdminState> {
  const store = getStore();
  const rawQr = `2@${Buffer.from(crypto.randomUUID()).toString("base64")},${Buffer.from("relief-assist-admin-pubkey").toString("base64")},${Buffer.from("token-" + Date.now()).toString("base64")}`;
  store.qrData = rawQr;
  store.qrDataUrl = await QRCode.toDataURL(rawQr, {
    margin: 1,
    width: 256,
    color: { dark: "#064e3b", light: "#ffffff" },
  });
  store.status = "qr_ready";
  store.lastActiveAt = new Date().toISOString();
  return getWhatsAppAdminState();
}

export async function connectAdminWhatsApp(phone: string): Promise<WhatsAppAdminState> {
  const store = getStore();
  const cleanPhone = phone.trim();
  if (!cleanPhone) {
    throw new Error("A valid phone number is required to link the WhatsApp bot.");
  }
  store.status = "connected";
  store.adminPhone = cleanPhone;
  store.connectedAt = new Date().toISOString();
  store.lastActiveAt = new Date().toISOString();
  return getWhatsAppAdminState();
}

export async function disconnectAdminWhatsApp(): Promise<WhatsAppAdminState> {
  const store = getStore();
  store.status = "qr_ready";
  store.adminPhone = null;
  store.connectedAt = null;
  store.lastActiveAt = new Date().toISOString();
  return refreshAdminPairingQr();
}

export function recordWhatsAppMessage(message: Omit<WhatsAppChatMessage, "id" | "timestamp">) {
  const store = getStore();
  const entry: WhatsAppChatMessage = {
    ...message,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
  store.messages.unshift(entry);
  if (store.messages.length > 100) store.messages.length = 100;
  store.lastActiveAt = entry.timestamp;
  return entry;
}

export function getRecentWhatsAppMessages(limit = 20): WhatsAppChatMessage[] {
  const store = getStore();
  return store.messages.slice(0, limit);
}
