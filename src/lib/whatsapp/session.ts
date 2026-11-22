import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { personas, type Persona, type Role } from "@/src/lib/contracts";
import { inferDemoPersona } from "./scoped-gateway";

const SESSIONS_FILE = path.resolve(process.cwd(), ".sms-sessions.json");

export type UserSessionInfo = {
  userId: string;
  persona: Persona | "custom";
  role: Role;
  name: string;
  citizenId: string | null;
  email?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  linkedPhone?: string | null;
  linkedThread?: string | null;
  token: string;
  createdAt: string;
  updatedAt?: string;
};

interface PersistedSessionStore {
  /** userId -> UserSessionInfo */
  users: Record<string, UserSessionInfo>;
  /** normalizedPhoneOrSender -> userId */
  phoneToUserId: Record<string, string>;
}

function readStore(): PersistedSessionStore {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8")) as Partial<PersistedSessionStore>;
      return {
        users: parsed.users || {},
        phoneToUserId: parsed.phoneToUserId || {},
      };
    }
  } catch (err) {
    console.error("[sms-session] Failed to read session store:", err);
  }
  return { users: {}, phoneToUserId: {} };
}

function writeStore(store: PersistedSessionStore) {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("[sms-session] Failed to write session store:", err);
  }
}

export function generateSessionToken(role: Role = "citizen"): string {
  const shortRole = role.slice(0, 3);
  return `rca_${shortRole}_${randomBytes(6).toString("hex")}`;
}

export type SessionProfileInput = {
  full_name?: string;
  role?: Role;
  citizen_id?: string | null;
  email?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
};

export function getUserSessionToken(userId: string, profile?: SessionProfileInput): string {
  const store = readStore();
  const existing = store.users[userId];

  const resolvedRole: Role =
    profile?.role ?? existing?.role ?? (userId in personas ? personas[userId as Persona].role : "citizen");
  const resolvedName =
    profile?.full_name ?? existing?.name ?? (userId in personas ? personas[userId as Persona].name : "Relief User");
  const inferred = inferDemoPersona({
    email: profile?.email ?? existing?.email,
    name: resolvedName,
    role: resolvedRole,
    persona: existing?.persona,
  });
  const resolvedPersona: Persona | "custom" = inferred ?? "custom";

  if (existing) {
    // Keep profile metadata & tokens fresh whenever the user opens the dashboard
    let changed = false;
    if (profile?.full_name && existing.name !== profile.full_name) {
      existing.name = profile.full_name;
      changed = true;
    }
    if (profile?.role && existing.role !== profile.role) {
      existing.role = profile.role;
      changed = true;
    }
    if (profile?.citizen_id !== undefined && existing.citizenId !== profile.citizen_id) {
      existing.citizenId = profile.citizen_id;
      changed = true;
    }
    if (profile?.email && existing.email !== profile.email) {
      existing.email = profile.email;
      changed = true;
    }
    if (profile?.accessToken && existing.accessToken !== profile.accessToken) {
      existing.accessToken = profile.accessToken;
      changed = true;
    }
    if (profile?.refreshToken && existing.refreshToken !== profile.refreshToken) {
      existing.refreshToken = profile.refreshToken;
      changed = true;
    }
    if (existing.persona !== resolvedPersona) {
      existing.persona = resolvedPersona;
      changed = true;
    }
    if (changed) {
      existing.updatedAt = new Date().toISOString();
      writeStore(store);
    }
    return existing.token;
  }

  const token = generateSessionToken(resolvedRole);
  const info: UserSessionInfo = {
    userId,
    persona: resolvedPersona,
    role: resolvedRole,
    name: resolvedName,
    citizenId: profile?.citizen_id ?? null,
    email: profile?.email ?? null,
    accessToken: profile?.accessToken ?? null,
    refreshToken: profile?.refreshToken ?? null,
    linkedPhone: null,
    linkedThread: null,
    token,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  store.users[userId] = info;
  writeStore(store);
  return token;
}

export function resetUserSessionToken(userId: string, profile?: SessionProfileInput): string {
  const store = readStore();
  const existing = store.users[userId];

  // Disconnect any phone previously linked to this user
  if (existing?.linkedPhone) {
    delete store.phoneToUserId[normalizePhone(existing.linkedPhone)];
  }
  for (const [phoneKey, mappedId] of Object.entries(store.phoneToUserId)) {
    if (mappedId === userId) {
      delete store.phoneToUserId[phoneKey];
    }
  }

  const resolvedRole: Role =
    profile?.role ?? existing?.role ?? (userId in personas ? personas[userId as Persona].role : "citizen");
  const resolvedName =
    profile?.full_name ?? existing?.name ?? (userId in personas ? personas[userId as Persona].name : "Relief User");
  const inferred = inferDemoPersona({
    email: profile?.email ?? existing?.email,
    name: resolvedName,
    role: resolvedRole,
    persona: existing?.persona,
  });

  const newToken = generateSessionToken(resolvedRole);
  store.users[userId] = {
    userId,
    persona: inferred ?? "custom",
    role: resolvedRole,
    name: resolvedName,
    citizenId: profile?.citizen_id ?? existing?.citizenId ?? null,
    email: profile?.email ?? existing?.email ?? null,
    accessToken: profile?.accessToken ?? existing?.accessToken ?? null,
    refreshToken: profile?.refreshToken ?? existing?.refreshToken ?? null,
    linkedPhone: null,
    linkedThread: null,
    token: newToken,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  writeStore(store);
  return newToken;
}

export function updateUserSessionTokens(userId: string, tokens: { accessToken: string; refreshToken: string }) {
  const store = readStore();
  const user = store.users[userId];
  if (!user) return;
  user.accessToken = tokens.accessToken;
  user.refreshToken = tokens.refreshToken;
  user.updatedAt = new Date().toISOString();
  writeStore(store);
}

/**
 * Normalizes a phone number or Google Messages sender identifier.
 * Keeps phone digits normalized (e.g. +923001234567) and falls back to lowercased contact name
 * when Google Messages displays a saved contact name instead of raw digits.
 */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const digitsOnly = trimmed.replace(/[^0-9+]/g, "");
  // If it looks like a phone number (at least 7 digits), normalize as phone
  if (digitsOnly.replace(/\+/g, "").length >= 7) {
    return digitsOnly.replace(/^00/, "+").replace(/^03/, "+923");
  }
  return trimmed.toLowerCase();
}

export function authenticatePhoneWithToken(
  rawSender: string,
  token: string,
): { success: boolean; user?: UserSessionInfo; error?: string } {
  const store = readStore();
  const cleanSender = normalizePhone(rawSender);
  const cleanToken = token.trim();

  if (!cleanSender) {
    return { success: false, error: "Could not determine sender phone number." };
  }

  const matchedUser = Object.values(store.users).find(u => u.token === cleanToken);
  if (!matchedUser) {
    return {
      success: false,
      error: "Invalid or expired login key. Open Relief Assist -> WhatsApp & SMS to copy your active personal key.",
    };
  }

  // If this sender was previously logged in as another persona, unlink old user cleanly
  const prevUserId = store.phoneToUserId[cleanSender];
  if (prevUserId && prevUserId !== matchedUser.userId && store.users[prevUserId]) {
    store.users[prevUserId].linkedPhone = null;
    store.users[prevUserId].linkedThread = null;
  }

  // If this user was previously linked to another phone, unlink old phone mapping
  if (matchedUser.linkedPhone) {
    const oldNorm = normalizePhone(matchedUser.linkedPhone);
    if (oldNorm !== cleanSender) {
      delete store.phoneToUserId[oldNorm];
    }
  }

  matchedUser.linkedPhone = rawSender.trim();
  matchedUser.linkedThread = cleanSender;
  matchedUser.updatedAt = new Date().toISOString();
  store.phoneToUserId[cleanSender] = matchedUser.userId;
  writeStore(store);

  return { success: true, user: matchedUser };
}

export function unlinkPhone(rawSender: string): boolean {
  const store = readStore();
  const cleanSender = normalizePhone(rawSender);
  const userId = store.phoneToUserId[cleanSender];
  if (!userId) return false;

  delete store.phoneToUserId[cleanSender];
  if (store.users[userId]) {
    store.users[userId].linkedPhone = null;
    store.users[userId].linkedThread = null;
    store.users[userId].updatedAt = new Date().toISOString();
  }
  writeStore(store);
  return true;
}

export function getUserForPhone(rawSender: string): UserSessionInfo | null {
  const store = readStore();
  const cleanSender = normalizePhone(rawSender);
  const userId = store.phoneToUserId[cleanSender];
  if (!userId) return null;
  return store.users[userId] ?? null;
}

export function getLinkedPhoneForUser(userId: string): string | null {
  const store = readStore();
  return store.users[userId]?.linkedPhone ?? null;
}

export function getAllActiveSessionsCount(): number {
  const store = readStore();
  return Object.keys(store.phoneToUserId).length;
}

export function getAllActiveSessionsSummary(): Array<{
  userId: string;
  name: string;
  role: Role;
  linkedPhone: string | null;
}> {
  const store = readStore();
  return Object.values(store.users)
    .filter(u => Boolean(u.linkedPhone))
    .map(u => ({
      userId: u.userId,
      name: u.name,
      role: u.role,
      linkedPhone: u.linkedPhone ?? null,
    }));
}
