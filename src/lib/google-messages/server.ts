import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { getAllActiveSessionsCount, getAllActiveSessionsSummary } from "@/src/lib/whatsapp/session";

const STATE_FILE = path.resolve(process.cwd(), ".google-messages-state.json");
const COMMAND_FILE = path.resolve(process.cwd(), ".google-messages-command.json");
const MESSAGES_FILE = path.resolve(process.cwd(), ".google-messages-messages.json");
const PROFILE_DIR = path.resolve(process.cwd(), ".google-messages-profile");
const GATEWAY_SCRIPT = path.resolve(process.cwd(), "scripts", "google-messages-gateway.mjs");

export type GoogleMessagesStatus =
  | "disconnected"
  | "starting"
  | "waiting_auth"
  | "qr_ready"
  | "connected"
  | "error";

export type GoogleMessagesState = {
  status: GoogleMessagesStatus;
  adminPhone: string | null;
  qrDataUrl: string | null;
  pairedAt: string | null;
  updatedAt: string;
  gatewayPid: number | null;
  gatewayRunning: boolean;
  visibleMode?: boolean;
  autoPromptUnknown: boolean;
  lastError: string | null;
  activeSmsSessions: number;
  activeUsers: Array<{
    userId: string;
    name: string;
    role: string;
    linkedPhone: string | null;
  }>;
};

export type PublicSmsGatewayInfo = {
  paired: boolean;
  status: GoogleMessagesStatus;
  adminPhone: string | null;
  gatewayRunning: boolean;
};

export type SmsChatMessage = {
  id: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string;
  text: string;
  timestamp: string;
  authenticatedUser?: string | null;
  authenticatedRole?: string | null;
  toolsUsed?: string[];
  source?: "google_messages_live" | "simulator";
};

declare global {
  // eslint-disable-next-line no-var
  var __rca_gm_child: ChildProcess | undefined;
}

function isPidAlive(pid: number | null | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPersistedState(): Partial<GoogleMessagesState> {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as Partial<GoogleMessagesState>;
    }
  } catch {}
  return {};
}

function writePersistedState(patch: Partial<GoogleMessagesState>) {
  try {
    const existing = readPersistedState();
    const merged = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(merged, null, 2), "utf-8");
  } catch (err) {
    console.error("[gm-server] Failed to write state:", err);
  }
}

function writeGatewayCommand(cmd: Record<string, unknown>) {
  try {
    fs.writeFileSync(COMMAND_FILE, JSON.stringify(cmd), "utf-8");
  } catch (err) {
    console.error("[gm-server] Failed to write command:", err);
  }
}

export function getAdminGoogleMessagesState(): GoogleMessagesState {
  const raw = readPersistedState();
  const pid = raw.gatewayPid ?? globalThis.__rca_gm_child?.pid ?? null;
  const gatewayRunning = isPidAlive(pid);

  let status: GoogleMessagesStatus = raw.status || "disconnected";
  // If state says active/starting/qr_ready/connected but the browser process died, reflect disconnected
  if (!gatewayRunning && (status === "starting" || status === "qr_ready" || status === "waiting_auth")) {
    status = "disconnected";
  }

  return {
    status,
    adminPhone: raw.adminPhone ?? null,
    qrDataUrl: status === "qr_ready" ? (raw.qrDataUrl ?? null) : null,
    pairedAt: raw.pairedAt ?? null,
    updatedAt: raw.updatedAt || new Date().toISOString(),
    gatewayPid: gatewayRunning ? pid : null,
    gatewayRunning,
    visibleMode: raw.visibleMode ?? false,
    autoPromptUnknown: raw.autoPromptUnknown ?? false,
    lastError: raw.lastError ?? null,
    activeSmsSessions: getAllActiveSessionsCount(),
    activeUsers: getAllActiveSessionsSummary(),
  };
}

/**
 * Safe public status for non-admin users: NEVER exposes QR code, errors, or other users' sessions!
 */
export function getPublicSmsGatewayInfo(): PublicSmsGatewayInfo {
  const state = getAdminGoogleMessagesState();
  return {
    paired: state.status === "connected",
    status: state.status,
    adminPhone: state.adminPhone,
    gatewayRunning: state.gatewayRunning,
  };
}

export function setAdminSmsNumber(phone: string): GoogleMessagesState {
  const clean = phone.trim();
  writePersistedState({ adminPhone: clean || null });
  return getAdminGoogleMessagesState();
}

export function setAutoPromptUnknown(enabled: boolean): GoogleMessagesState {
  writePersistedState({ autoPromptUnknown: enabled });
  return getAdminGoogleMessagesState();
}

export function startGoogleMessagesGateway(options: { visible?: boolean; adminPhone?: string } = {}): GoogleMessagesState {
  const visible = Boolean(options.visible);
  if (options.adminPhone?.trim()) {
    writePersistedState({ adminPhone: options.adminPhone.trim() });
  }

  const current = getAdminGoogleMessagesState();
  if (current.gatewayRunning && current.gatewayPid) {
    // If user explicitly requested switching between visible and background mode, restart cleanly
    if (Boolean(current.visibleMode) === visible) {
      return current;
    }
    stopGoogleMessagesGateway(false);
  }

  writePersistedState({
    status: "starting",
    qrDataUrl: null,
    lastError: null,
    visibleMode: visible,
  });

  const args = [GATEWAY_SCRIPT];
  if (visible) args.push("--visible");

  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      GM_VISIBLE: visible ? "1" : "0",
    },
  });

  child.unref();
  globalThis.__rca_gm_child = child;

  writePersistedState({
    status: "starting",
    gatewayPid: child.pid ?? null,
    visibleMode: visible,
    lastError: null,
  });

  return getAdminGoogleMessagesState();
}

export function stopGoogleMessagesGateway(wipeProfile = false): GoogleMessagesState {
  const current = readPersistedState();
  if (isPidAlive(current.gatewayPid)) {
    writeGatewayCommand({ action: wipeProfile ? "disconnect" : "stop" });
    setTimeout(() => {
      if (isPidAlive(current.gatewayPid)) {
        try {
          process.kill(current.gatewayPid!, "SIGTERM");
        } catch {}
      }
    }, 1500);
  } else if (wipeProfile) {
    try {
      fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
    } catch {}
  }

  globalThis.__rca_gm_child = undefined;

  writePersistedState({
    status: "disconnected",
    qrDataUrl: null,
    pairedAt: wipeProfile ? null : (current.pairedAt ?? null),
    gatewayPid: null,
    lastError: null,
  });

  return getAdminGoogleMessagesState();
}

export function refreshGoogleMessagesQr(): GoogleMessagesState {
  const current = getAdminGoogleMessagesState();
  if (current.gatewayRunning) {
    writeGatewayCommand({ action: "refresh_qr" });
    writePersistedState({ status: "starting", qrDataUrl: null, lastError: null });
    return getAdminGoogleMessagesState();
  }
  return startGoogleMessagesGateway({ visible: false });
}

export function sendOutboundSmsViaGateway(to: string, text: string): { queued: boolean; error?: string } {
  const state = getAdminGoogleMessagesState();
  if (state.status !== "connected" || !state.gatewayRunning) {
    return { queued: false, error: "Google Messages is not currently paired and running." };
  }
  writeGatewayCommand({ action: "send_sms", to: to.trim(), text: text.trim() });
  return { queued: true };
}

export function loadSmsMessages(): SmsChatMessage[] {
  try {
    if (fs.existsSync(MESSAGES_FILE)) {
      return JSON.parse(fs.readFileSync(MESSAGES_FILE, "utf-8")) as SmsChatMessage[];
    }
  } catch {}
  return [];
}

export function recordSmsMessage(msg: Omit<SmsChatMessage, "id" | "timestamp">): SmsChatMessage {
  const all = loadSmsMessages();
  const entry: SmsChatMessage = {
    ...msg,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
  all.unshift(entry);
  const trimmed = all.slice(0, 200);
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(trimmed, null, 2), "utf-8");
  } catch (err) {
    console.error("[gm-server] Failed to save SMS log:", err);
  }
  return entry;
}

export function getRecentSmsMessages(limit = 40): SmsChatMessage[] {
  return loadSmsMessages().slice(0, limit);
}
