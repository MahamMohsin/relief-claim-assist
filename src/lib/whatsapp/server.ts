import fs from "node:fs";
import path from "node:path";
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

function readLiveGatewayState(): Partial<WhatsAppAdminState> | null {
  try {
    const statePath = path.resolve(process.cwd(), ".whatsapp-state.json");
    if (fs.existsSync(statePath)) {
      const content = fs.readFileSync(statePath, "utf-8");
      return JSON.parse(content);
    }
  } catch {}
  return null;
}

function sendGatewayCommand(cmd: Record<string, unknown>) {
  try {
    const cmdPath = path.resolve(process.cwd(), ".whatsapp-command.json");
    fs.writeFileSync(cmdPath, JSON.stringify(cmd), "utf-8");
  } catch {}
}

function loadPersistedMessages(): WhatsAppChatMessage[] {
  try {
    const msgPath = path.resolve(process.cwd(), ".whatsapp-messages.json");
    if (fs.existsSync(msgPath)) {
      return JSON.parse(fs.readFileSync(msgPath, "utf-8"));
    }
  } catch {}
  return [];
}

function savePersistedMessages(msgs: WhatsAppChatMessage[]) {
  try {
    const msgPath = path.resolve(process.cwd(), ".whatsapp-messages.json");
    fs.writeFileSync(msgPath, JSON.stringify(msgs.slice(0, 200), null, 2), "utf-8");
  } catch {}
}

function getStore(): WhatsAppServerStore {
  if (!globalThis.__rca_whatsapp_server_store) {
    globalThis.__rca_whatsapp_server_store = {
      status: "qr_ready",
      adminPhone: null,
      botName: "Relief Assist WhatsApp Official Bot",
      qrData: "",
      qrDataUrl: "",
      connectedAt: null,
      lastActiveAt: new Date().toISOString(),
      messages: loadPersistedMessages(),
    };
  }
  return globalThis.__rca_whatsapp_server_store;
}

export async function getWhatsAppAdminState(): Promise<WhatsAppAdminState> {
  const store = getStore();
  const live = readLiveGatewayState();

  if (live?.status) {
    store.status = live.status;
    if (live.adminPhone !== undefined) store.adminPhone = live.adminPhone;
    if (live.qrData) store.qrData = live.qrData;
    if (live.qrDataUrl) store.qrDataUrl = live.qrDataUrl;
    if (live.connectedAt !== undefined) store.connectedAt = live.connectedAt;
  }

  return {
    status: store.status,
    adminPhone: store.adminPhone,
    botName: store.botName,
    qrData: store.qrData || null,
    qrDataUrl: store.qrDataUrl || null,
    connectedAt: store.connectedAt,
    lastActiveAt: store.lastActiveAt,
    activeUsersCount: getAllActiveSessionsCount(),
    mode: "baileys_mcp",
  };
}

export async function refreshAdminPairingQr(): Promise<WhatsAppAdminState> {
  sendGatewayCommand({ action: "refresh_qr" });
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
  sendGatewayCommand({ action: "disconnect" });
  const store = getStore();
  store.status = "qr_ready";
  store.adminPhone = null;
  store.connectedAt = null;
  store.lastActiveAt = new Date().toISOString();
  return getWhatsAppAdminState();
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
  savePersistedMessages(store.messages);
  return entry;
}

export function getRecentWhatsAppMessages(limit = 20): WhatsAppChatMessage[] {
  const store = getStore();
  return store.messages.slice(0, limit);
}
