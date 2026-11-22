import { randomBytes } from "node:crypto";
import { personas, type Persona, type Role } from "@/src/lib/contracts";

export type UserSessionInfo = {
  userId: string;
  persona: Persona | "custom";
  role: Role;
  name: string;
  citizenId: string | null;
  linkedPhone?: string | null;
  token: string;
  createdAt: string;
};

// Global in-memory storage for WhatsApp session tokens and phone mappings
// Preserved across hot reloads in development via globalThis
interface WhatsAppSessionStore {
  userTokens: Map<string, string>; // userId/persona -> token
  tokenToUser: Map<string, UserSessionInfo>; // token -> UserSessionInfo
  phoneToUser: Map<string, UserSessionInfo>; // phone -> UserSessionInfo
}

declare global {
  // eslint-disable-next-line no-var
  var __rca_whatsapp_store: WhatsAppSessionStore | undefined;
}

function getStore(): WhatsAppSessionStore {
  if (!globalThis.__rca_whatsapp_store) {
    globalThis.__rca_whatsapp_store = {
      userTokens: new Map(),
      tokenToUser: new Map(),
      phoneToUser: new Map(),
    };
    initDefaultSessions(globalThis.__rca_whatsapp_store);
  }
  return globalThis.__rca_whatsapp_store;
}

function initDefaultSessions(store: WhatsAppSessionStore) {
  const defaults: Record<Persona, { token: string; citizenId: string | null }> = {
    fatima: { token: "rca_wa_live_fatima_c82e3f19", citizenId: "c37d5ff0-482a-4467-8c31-7e923e420d3b" },
    zainab: { token: "rca_wa_live_zainab_49d107a6", citizenId: null },
    tariq: { token: "rca_wa_live_tariq_17b35e82", citizenId: null },
    bilal: { token: "rca_wa_live_bilal_9f0a44dc", citizenId: null },
    sana: { token: "rca_wa_live_sana_e25c7710", citizenId: null },
    kamran: { token: "rca_wa_live_kamran_3a8b9015", citizenId: null },
  };

  for (const [key, details] of Object.entries(personas) as [Persona, (typeof personas)[Persona]][]) {
    const def = defaults[key];
    const info: UserSessionInfo = {
      userId: key,
      persona: key,
      role: details.role,
      name: details.name,
      citizenId: def.citizenId,
      token: def.token,
      createdAt: new Date().toISOString(),
    };
    store.userTokens.set(key, def.token);
    store.tokenToUser.set(def.token, info);
  }
}

export function generateSessionToken(prefix = "rca_wa_live"): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

export function getUserSessionToken(userIdOrPersona: string, fallbackProfile?: { full_name?: string; role?: Role; citizen_id?: string | null }): string {
  const store = getStore();
  const existing = store.userTokens.get(userIdOrPersona);
  if (existing) return existing;

  const token = generateSessionToken();
  const role: Role = fallbackProfile?.role ?? (userIdOrPersona in personas ? personas[userIdOrPersona as Persona].role : "citizen");
  const name = fallbackProfile?.full_name ?? (userIdOrPersona in personas ? personas[userIdOrPersona as Persona].name : "Citizen User");
  const persona: Persona | "custom" = userIdOrPersona in personas ? (userIdOrPersona as Persona) : "custom";

  const info: UserSessionInfo = {
    userId: userIdOrPersona,
    persona,
    role,
    name,
    citizenId: fallbackProfile?.citizen_id ?? null,
    token,
    createdAt: new Date().toISOString(),
  };

  store.userTokens.set(userIdOrPersona, token);
  store.tokenToUser.set(token, info);
  return token;
}

export function resetUserSessionToken(userIdOrPersona: string, fallbackProfile?: { full_name?: string; role?: Role; citizen_id?: string | null }): string {
  const store = getStore();
  const oldToken = store.userTokens.get(userIdOrPersona);
  if (oldToken) {
    const oldInfo = store.tokenToUser.get(oldToken);
    store.tokenToUser.delete(oldToken);
    if (oldInfo?.linkedPhone) {
      store.phoneToUser.delete(oldInfo.linkedPhone);
    }
  }

  const newToken = generateSessionToken();
  const role: Role = fallbackProfile?.role ?? (userIdOrPersona in personas ? personas[userIdOrPersona as Persona].role : "citizen");
  const name = fallbackProfile?.full_name ?? (userIdOrPersona in personas ? personas[userIdOrPersona as Persona].name : "Citizen User");
  const persona: Persona | "custom" = userIdOrPersona in personas ? (userIdOrPersona as Persona) : "custom";

  const info: UserSessionInfo = {
    userId: userIdOrPersona,
    persona,
    role,
    name,
    citizenId: fallbackProfile?.citizen_id ?? null,
    token: newToken,
    createdAt: new Date().toISOString(),
  };

  store.userTokens.set(userIdOrPersona, newToken);
  store.tokenToUser.set(newToken, info);
  return newToken;
}

export function normalizePhone(raw: string): string {
  return raw.replace(/[^0-9+]/g, "").replace(/^00/, "+").replace(/^03/, "+923");
}

export function authenticatePhoneWithToken(rawPhone: string, token: string): { success: boolean; user?: UserSessionInfo; error?: string } {
  const store = getStore();
  const cleanPhone = normalizePhone(rawPhone);
  const cleanToken = token.trim();

  const user = store.tokenToUser.get(cleanToken);
  if (!user) {
    return { success: false, error: "Invalid or expired session token. Please verify your token in the app." };
  }

  // Link phone to user
  user.linkedPhone = cleanPhone;
  store.phoneToUser.set(cleanPhone, user);
  return { success: true, user };
}

export function unlinkPhone(rawPhone: string): boolean {
  const store = getStore();
  const cleanPhone = normalizePhone(rawPhone);
  const user = store.phoneToUser.get(cleanPhone);
  if (user) {
    user.linkedPhone = null;
    store.phoneToUser.delete(cleanPhone);
    return true;
  }
  return false;
}

export function getUserForPhone(rawPhone: string): UserSessionInfo | null {
  const store = getStore();
  const cleanPhone = normalizePhone(rawPhone);
  return store.phoneToUser.get(cleanPhone) ?? null;
}

export function getLinkedPhoneForUser(userIdOrPersona: string): string | null {
  const store = getStore();
  const token = store.userTokens.get(userIdOrPersona);
  if (!token) return null;
  const user = store.tokenToUser.get(token);
  return user?.linkedPhone ?? null;
}

export function getAllActiveSessionsCount(): number {
  const store = getStore();
  return store.phoneToUser.size;
}
