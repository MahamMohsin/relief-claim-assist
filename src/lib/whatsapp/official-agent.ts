import fs from "node:fs";
import path from "node:path";
import type { Persona, Role } from "@/src/lib/contracts";
import { recordWhatsAppMessage } from "./server";
import { runScopedAssistantTurn } from "./agent";
import { inferDemoPersona, type ScopedUserIdentity } from "./scoped-gateway";
import {
  downloadWhatsAppMedia,
  sendAgentAudioMessage,
  synthesizeVoiceReply,
  transcribeWhatsAppAudio,
  uploadWhatsAppMedia,
  WHATSAPP_AGENT_BASE_URL,
} from "./audio";

const AGENT_KEYS_FILE = path.resolve(process.cwd(), ".whatsapp-agent-keys.json");

export type StoredAgentKey = {
  /** Authenticated Supabase profile.id — each user gets their own completely isolated entry */
  personaId: string;
  userName: string;
  userRole: Role;
  citizenId: string | null;
  personaSlug?: Persona | "custom";
  email?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  apiKey: string;
  agentName: string;
  connectedAt: string;
  lastActiveAt: string;
  lastOffset?: number | null;
  agentNumericId?: string | null;
};

interface AgentKeyStore {
  keys: Record<string, StoredAgentKey>;
}

// In-memory active pollers map — strictly one isolated AbortController loop per userId
declare global {
  // eslint-disable-next-line no-var
  var __rca_whatsapp_pollers_map:
    | Map<string, { abortController: AbortController; isRunning: boolean }>
    | undefined;
  // eslint-disable-next-line no-var
  var __rca_whatsapp_pollers_inited: boolean | undefined;
}

function getActivePollers() {
  if (!globalThis.__rca_whatsapp_pollers_map) {
    globalThis.__rca_whatsapp_pollers_map = new Map();
  }
  return globalThis.__rca_whatsapp_pollers_map;
}

function readAgentKeyStore(): AgentKeyStore {
  try {
    if (fs.existsSync(AGENT_KEYS_FILE)) {
      const data = fs.readFileSync(AGENT_KEYS_FILE, "utf-8");
      const parsed = JSON.parse(data) as Partial<AgentKeyStore>;
      return { keys: parsed.keys || {} };
    }
  } catch {}
  return { keys: {} };
}

function writeAgentKeyStore(store: AgentKeyStore) {
  try {
    fs.writeFileSync(AGENT_KEYS_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("[wa-agent] Failed to write agent keys file:", err);
  }
}

export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 4) + "••••••••" + key.slice(-4);
}

/**
 * Validates a WhatsApp Agent API Key by making a lightweight request to the updates endpoint.
 */
export async function testAgentApiKey(apiKey: string): Promise<{
  valid: boolean;
  agentId?: string;
  error?: string;
}> {
  try {
    const cleanKey = apiKey.trim();
    if (!cleanKey) {
      return { valid: false, error: "API key cannot be empty" };
    }

    const res = await fetch(`${WHATSAPP_AGENT_BASE_URL}/updates?limit=1&timeout=0`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cleanKey}`,
      },
    });

    if (res.status === 200 || res.status === 204) {
      let agentId: string | undefined;
      if (res.status === 200) {
        const json = await res.json().catch(() => null);
        if (json?.entry?.[0]?.id) {
          agentId = json.entry[0].id;
        }
      }
      return { valid: true, agentId };
    }

    if (res.status === 401) {
      return {
        valid: false,
        error: "Invalid or expired WhatsApp Agent API key. Please check and copy the key again from WhatsApp > Chat info > API key.",
      };
    }

    if (res.status === 400) {
      const errJson = await res.json().catch(() => ({}));
      return {
        valid: false,
        error: errJson?.error?.message || "Malformed WhatsApp Agent API key.",
      };
    }

    return {
      valid: false,
      error: `WhatsApp API returned status ${res.status}.`,
    };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Failed to connect to WhatsApp API servers.",
    };
  }
}

/**
 * Send an outbound message from this user's own WhatsApp agent
 */
export async function sendAgentMessage(
  apiKey: string,
  toRecipient: string,
  bodyText: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const res = await fetch(`${WHATSAPP_AGENT_BASE_URL}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: toRecipient,
        type: "text",
        text: { body: bodyText },
      }),
    });

    if (res.ok) {
      const json = await res.json();
      const messageId = json?.messages?.[0]?.id;
      return { success: true, messageId };
    }

    const errJson = await res.json().catch(() => ({}));
    return {
      success: false,
      error: errJson?.error?.message || `Send failed with HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Network error sending message to WhatsApp",
    };
  }
}

/**
 * Mark a message as read and show typing indicator
 */
export async function sendAgentTypingStatus(apiKey: string, messageId: string): Promise<boolean> {
  try {
    const res = await fetch(`${WHATSAPP_AGENT_BASE_URL}/statuses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
        typing_indicator: { type: "text" },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export type SaveAgentKeyProfile = {
  userId: string;
  userName: string;
  userRole: Role;
  citizenId: string | null;
  email?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
};

/**
 * Save an isolated API key strictly for one authenticated user and start its dedicated polling worker.
 * Prevents two different users from binding the exact same WhatsApp Agent API key so their data stays 100% separate.
 */
export async function saveAgentApiKey(
  owner: SaveAgentKeyProfile,
  apiKey: string,
  agentName = "Ali",
): Promise<{ success: boolean; maskedKey: string; error?: string }> {
  const cleanKey = apiKey.trim();

  // Enforce 1-to-1 isolation: do not allow reusing another user's active WhatsApp Agent API key
  const store = readAgentKeyStore();
  const conflict = Object.values(store.keys).find(
    k => k.personaId !== owner.userId && k.apiKey.trim() === cleanKey,
  );
  if (conflict) {
    return {
      success: false,
      maskedKey: "",
      error: `This WhatsApp Agent API key is already linked to another account (${conflict.userName || "another user"}). Each user must create and connect their own separate WhatsApp Agent key so data stays private.`,
    };
  }

  const test = await testAgentApiKey(cleanKey);
  if (!test.valid) {
    return {
      success: false,
      maskedKey: "",
      error: test.error || "Invalid WhatsApp Agent API key.",
    };
  }

  const existing = store.keys[owner.userId];
  const inferredPersona = inferDemoPersona({
    email: owner.email,
    name: owner.userName,
    role: owner.userRole,
    persona: existing?.personaSlug,
  });

  const entry: StoredAgentKey = {
    personaId: owner.userId,
    userName: owner.userName,
    userRole: owner.userRole,
    citizenId: owner.citizenId,
    personaSlug: inferredPersona ?? "custom",
    email: owner.email ?? existing?.email ?? null,
    accessToken: owner.accessToken ?? existing?.accessToken ?? null,
    refreshToken: owner.refreshToken ?? existing?.refreshToken ?? null,
    apiKey: cleanKey,
    agentName: agentName.trim() || existing?.agentName || "Ali",
    connectedAt: existing?.connectedAt || new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    agentNumericId: test.agentId || existing?.agentNumericId || null,
    // Reset offset when switching to a brand new API key
    lastOffset: existing?.apiKey === cleanKey ? (existing?.lastOffset ?? null) : null,
  };

  store.keys[owner.userId] = entry;
  writeAgentKeyStore(store);

  // Start isolated poller strictly for this user
  startAgentPoller(entry);

  return {
    success: true,
    maskedKey: maskApiKey(cleanKey),
  };
}

/**
 * Syncs fresh profile/session metadata onto an existing stored agent key without exposing anything
 */
export function refreshStoredAgentOwnerContext(owner: SaveAgentKeyProfile) {
  const store = readAgentKeyStore();
  const existing = store.keys[owner.userId];
  if (!existing) return;

  let changed = false;
  if (owner.userName && existing.userName !== owner.userName) {
    existing.userName = owner.userName;
    changed = true;
  }
  if (owner.userRole && existing.userRole !== owner.userRole) {
    existing.userRole = owner.userRole;
    changed = true;
  }
  if (owner.citizenId !== undefined && existing.citizenId !== owner.citizenId) {
    existing.citizenId = owner.citizenId;
    changed = true;
  }
  if (owner.email && existing.email !== owner.email) {
    existing.email = owner.email;
    changed = true;
  }
  if (owner.accessToken && existing.accessToken !== owner.accessToken) {
    existing.accessToken = owner.accessToken;
    changed = true;
  }
  if (owner.refreshToken && existing.refreshToken !== owner.refreshToken) {
    existing.refreshToken = owner.refreshToken;
    changed = true;
  }
  const inferred = inferDemoPersona({
    email: existing.email,
    name: existing.userName,
    role: existing.userRole,
    persona: existing.personaSlug,
  });
  if (inferred && existing.personaSlug !== inferred) {
    existing.personaSlug = inferred;
    changed = true;
  }

  if (changed) {
    writeAgentKeyStore(store);
  }
}

/**
 * Remove an API key strictly for one user
 */
export function removeAgentApiKey(userId: string): boolean {
  stopAgentPoller(userId);
  const store = readAgentKeyStore();
  if (store.keys[userId]) {
    delete store.keys[userId];
    writeAgentKeyStore(store);
    return true;
  }
  return false;
}

/**
 * Get stored key info strictly for one userId (never falls back to another user!)
 */
export function getAgentKeyInfo(userId: string): {
  isConfigured: boolean;
  maskedKey: string | null;
  agentName: string | null;
  ownerName: string | null;
  ownerRole: Role | null;
  connectedAt: string | null;
  lastActiveAt: string | null;
} {
  const store = readAgentKeyStore();
  const item = store.keys[userId];
  if (!item) {
    return {
      isConfigured: false,
      maskedKey: null,
      agentName: null,
      ownerName: null,
      ownerRole: null,
      connectedAt: null,
      lastActiveAt: null,
    };
  }
  return {
    isConfigured: true,
    maskedKey: maskApiKey(item.apiKey),
    agentName: item.agentName,
    ownerName: item.userName || null,
    ownerRole: item.userRole || null,
    connectedAt: item.connectedAt,
    lastActiveAt: item.lastActiveAt,
  };
}

function buildScopedIdentityFromEntry(entry: StoredAgentKey): ScopedUserIdentity {
  const role: Role = entry.userRole || "citizen";
  const name = entry.userName || "Relief User";
  const persona = entry.personaSlug || inferDemoPersona({ email: entry.email, name, role }) || "custom";

  return {
    userId: entry.personaId,
    name,
    role,
    citizenId: entry.citizenId ?? null,
    persona,
    email: entry.email ?? null,
    accessToken: entry.accessToken ?? null,
    refreshToken: entry.refreshToken ?? null,
    onTokensRefreshed: tokens => {
      const store = readAgentKeyStore();
      if (store.keys[entry.personaId]) {
        store.keys[entry.personaId].accessToken = tokens.accessToken;
        store.keys[entry.personaId].refreshToken = tokens.refreshToken;
        writeAgentKeyStore(store);
      }
    },
  };
}

/**
 * Run an isolated in-app test message through this user's own scoped WhatsApp Agent.
 * Optionally simulates a voice note by synthesizing Cartesia TTS audio.
 */
export async function runAgentTestMessage(
  owner: SaveAgentKeyProfile,
  text: string,
  options?: { isVoice?: boolean; preferredLocale?: "en" | "ur" },
): Promise<{
  reply: string;
  toolsUsed: string[];
  agentName: string;
  audioBase64?: string;
  locale?: "en" | "ur";
}> {
  refreshStoredAgentOwnerContext(owner);
  const store = readAgentKeyStore();
  const entry = store.keys[owner.userId];
  const agentName = entry?.agentName || "Ali";

  const scopedUser: ScopedUserIdentity = entry
    ? buildScopedIdentityFromEntry(entry)
    : {
        userId: owner.userId,
        name: owner.userName,
        role: owner.userRole,
        citizenId: owner.citizenId,
        persona: inferDemoPersona({ email: owner.email, name: owner.userName, role: owner.userRole }) ?? "custom",
        email: owner.email ?? null,
        accessToken: owner.accessToken ?? null,
        refreshToken: owner.refreshToken ?? null,
      };

  const isVoice = Boolean(options?.isVoice);

  recordWhatsAppMessage({
    direction: "inbound",
    from: `${owner.userName} (Test Console)`,
    to: `${agentName} [${owner.userName}]`,
    text: isVoice ? `🎤 [Voice Note]: "${text}"` : text,
  });

  const turn = await runScopedAssistantTurn(scopedUser, text, "whatsapp");

  let audioBase64: string | undefined;
  let synthesizedLocale: "en" | "ur" | undefined;

  if (isVoice) {
    try {
      const voiceRes = await synthesizeVoiceReply(turn.reply, options?.preferredLocale);
      if (voiceRes?.audioBuffer) {
        audioBase64 = voiceRes.audioBuffer.toString("base64");
        synthesizedLocale = voiceRes.locale;
      }
    } catch (voiceErr) {
      console.warn("[wa-agent] Test console voice synthesis error:", voiceErr);
    }
  }

  const toolsWithAudio = isVoice && audioBase64
    ? ["cartesia_voice_reply", ...(turn.toolsUsed.length ? turn.toolsUsed : ["official_agent_mimo"])]
    : (turn.toolsUsed.length ? turn.toolsUsed : ["official_agent_mimo"]);

  recordWhatsAppMessage({
    direction: "outbound",
    from: `${agentName} [${owner.userName}]`,
    to: `${owner.userName} (Test Console)`,
    text: isVoice && audioBase64 ? `🎙️ [Voice Note Reply]: "${turn.reply}"` : turn.reply,
    toolsUsed: toolsWithAudio,
  });

  return {
    reply: turn.reply,
    toolsUsed: toolsWithAudio,
    agentName,
    audioBase64,
    locale: synthesizedLocale,
  };
}

/**
 * Stop active poller for one user
 */
export function stopAgentPoller(userId: string) {
  const activePollers = getActivePollers();
  const existing = activePollers.get(userId);
  if (existing) {
    existing.abortController.abort();
    existing.isRunning = false;
    activePollers.delete(userId);
    console.log(`[wa-agent] Stopped isolated poller for user: ${userId}`);
  }
}

/**
 * Start dedicated long-poll loop for a single user's WhatsApp Agent.
 * Strictly scoped to THIS user's data, role, and API key.
 */
export function startAgentPoller(entry: StoredAgentKey) {
  stopAgentPoller(entry.personaId);

  const activePollers = getActivePollers();
  const abortController = new AbortController();
  activePollers.set(entry.personaId, { abortController, isRunning: true });

  (async () => {
    let offset: number | null = entry.lastOffset ?? null;
    console.log(
      `[wa-agent] Started isolated WhatsApp Agent poller for ${entry.userName || entry.personaId} (role: ${entry.userRole || "citizen"}, agent: ${entry.agentName})`,
    );

    while (!abortController.signal.aborted) {
      try {
        // Reload freshest stored user metadata on each loop iteration
        const freshStore = readAgentKeyStore();
        const currentEntry = freshStore.keys[entry.personaId];
        if (!currentEntry || !currentEntry.apiKey) {
          console.log(`[wa-agent] Key removed for ${entry.personaId}, halting poller.`);
          break;
        }

        let url = `${WHATSAPP_AGENT_BASE_URL}/updates?limit=50&timeout=15`;
        if (offset !== null) {
          url += `&offset=${offset}`;
        }

        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${currentEntry.apiKey}`,
          },
          signal: abortController.signal,
        });

        if (abortController.signal.aborted) break;

        if (res.status === 204) {
          continue;
        }

        if (res.status === 200) {
          const data = await res.json();
          if (data?.next_offset !== undefined) {
            offset = data.next_offset;
            const persistStore = readAgentKeyStore();
            if (persistStore.keys[entry.personaId]) {
              persistStore.keys[entry.personaId].lastOffset = offset;
              persistStore.keys[entry.personaId].lastActiveAt = new Date().toISOString();
              writeAgentKeyStore(persistStore);
            }
          }

          const entries = data?.entry || [];
          for (const ent of entries) {
            const changes = ent?.changes || [];
            for (const ch of changes) {
              const messages = ch?.value?.messages || [];

              for (const msg of messages) {
                const isAudio = msg.type === "audio" && Boolean(msg.audio?.id);
                const isText = msg.type === "text" && Boolean(msg.text?.body);
                if (!isAudio && !isText) continue;

                const senderId = msg.from;
                const wamid = msg.id;
                const ownerLabel = currentEntry.userName || currentEntry.personaId;

                let textBody = "";
                let isVoiceNote = false;
                let detectedAudioLocale: "en" | "ur" = "en";

                if (isAudio) {
                  isVoiceNote = true;
                  const mediaId = msg.audio.id;
                  console.log(
                    `[wa-agent] Inbound Voice Note from ${senderId} on ${currentEntry.agentName} [${ownerLabel}] (mediaId: ${mediaId})`,
                  );

                  const downloaded = await downloadWhatsAppMedia(currentEntry.apiKey, mediaId);
                  if (!downloaded) {
                    console.error(`[wa-agent] Failed to download voice note ${mediaId} from WhatsApp.`);
                    await sendAgentMessage(
                      currentEntry.apiKey,
                      senderId,
                      "⚠️ We received your voice message but were unable to download it. Please try sending it again or send a text message.",
                    );
                    continue;
                  }

                  try {
                    const stt = await transcribeWhatsAppAudio(downloaded.buffer, downloaded.mimeType);
                    textBody = stt.transcript;
                    detectedAudioLocale = stt.locale;
                    console.log(`[wa-agent] Transcribed voice note from ${senderId}: "${textBody}" (${detectedAudioLocale})`);
                  } catch (sttErr) {
                    console.error("[wa-agent] Voice transcription failed:", sttErr);
                    await sendAgentMessage(
                      currentEntry.apiKey,
                      senderId,
                      "⚠️ We could not transcribe your voice note clearly. Please speak closer to the microphone or send a text message.",
                    );
                    continue;
                  }

                  if (!textBody) {
                    await sendAgentMessage(
                      currentEntry.apiKey,
                      senderId,
                      "⚠️ The voice message appeared to be empty or silent. Please try recording again.",
                    );
                    continue;
                  }
                } else {
                  textBody = msg.text.body.trim();
                }

                console.log(
                  `[wa-agent] Inbound ${isVoiceNote ? "[Voice Note]" : ""} on ${currentEntry.agentName} [${ownerLabel}] from ${senderId}: "${textBody}"`,
                );

                recordWhatsAppMessage({
                  direction: "inbound",
                  from: senderId,
                  to: `${currentEntry.agentName} [${ownerLabel}]`,
                  text: isVoiceNote ? `🎤 [Voice Note]: "${textBody}"` : textBody,
                });

                if (wamid) {
                  void sendAgentTypingStatus(currentEntry.apiKey, wamid);
                }

                try {
                  // Execute strictly scoped assistant turn for THIS key's owner ONLY
                  const scopedUser = buildScopedIdentityFromEntry(currentEntry);
                  const turn = await runScopedAssistantTurn(scopedUser, textBody, "whatsapp");

                  let sentAudio = false;
                  if (isVoiceNote) {
                    try {
                      // Synthesize voice reply via Cartesia TTS
                      const voiceRes = await synthesizeVoiceReply(turn.reply, detectedAudioLocale);
                      if (voiceRes) {
                        // Upload MP3 voice note to WhatsApp
                        const uploaded = await uploadWhatsAppMedia(
                          currentEntry.apiKey,
                          voiceRes.audioBuffer,
                          "audio/mpeg",
                          "voice_reply.mp3",
                        );
                        if (uploaded?.mediaId) {
                          // Send voice note message back to user!
                          const audioSend = await sendAgentAudioMessage(
                            currentEntry.apiKey,
                            senderId,
                            uploaded.mediaId,
                          );
                          if (audioSend.success) {
                            sentAudio = true;
                            console.log(
                              `[wa-agent] Sent Voice Note reply to ${senderId} (mediaId: ${uploaded.mediaId})`,
                            );
                          }
                        }
                      }
                    } catch (voiceErr) {
                      console.warn("[wa-agent] Error synthesizing/uploading voice reply:", voiceErr);
                    }
                  }

                  // Send text reply as well so user has written reference for numbers, IDs, and details
                  const sendRes = await sendAgentMessage(currentEntry.apiKey, senderId, turn.reply);

                  const toolsUsed = isVoiceNote && sentAudio
                    ? ["cartesia_voice_reply", ...(turn.toolsUsed.length ? turn.toolsUsed : ["official_agent_mimo"])]
                    : (turn.toolsUsed.length ? turn.toolsUsed : ["official_agent_mimo"]);

                  recordWhatsAppMessage({
                    direction: "outbound",
                    from: `${currentEntry.agentName} [${ownerLabel}]`,
                    to: senderId,
                    text: sentAudio ? `🎙️ [Voice Note Reply]: "${turn.reply}"` : turn.reply,
                    toolsUsed,
                  });

                  console.log(
                    `[wa-agent] Reply sent via ${currentEntry.agentName} [${ownerLabel}] to ${senderId} (audio: ${sentAudio}, messageId: ${sendRes.messageId || "ok"})`,
                  );
                } catch (aiErr) {
                  console.error("[wa-agent] Error generating/sending scoped AI reply:", aiErr);
                  await sendAgentMessage(
                    currentEntry.apiKey,
                    senderId,
                    "⚠️ We encountered a temporary delay processing your request. Please try again in a moment.",
                  );
                }
              }
            }
          }
          continue;
        }

        if (res.status === 429) {
          console.warn(`[wa-agent] Rate limit for ${entry.personaId}. Backing off 10s...`);
          await new Promise(r => setTimeout(r, 10000));
          continue;
        }

        if (res.status === 401) {
          console.error(`[wa-agent] WhatsApp API token rejected for ${entry.personaId}. Halting poller.`);
          break;
        }

        await new Promise(r => setTimeout(r, 5000));
      } catch (err: unknown) {
        if (abortController.signal.aborted) break;
        console.warn(
          `[wa-agent] Polling loop notice (${entry.personaId}): ${err instanceof Error ? err.message : String(err)}. Re-polling in 3s...`,
        );
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  })();
}

/**
 * Initializes isolated pollers for all saved per-user agent keys upon server boot
 */
export function initAllAgentPollers() {
  const store = readAgentKeyStore();
  const keys = Object.values(store.keys);
  console.log(`[wa-agent] Initializing ${keys.length} isolated WhatsApp Agent pollers...`);
  for (const k of keys) {
    if (k.apiKey) {
      startAgentPoller(k);
    }
  }
}

export function ensureAgentPollers() {
  if (!globalThis.__rca_whatsapp_pollers_inited) {
    globalThis.__rca_whatsapp_pollers_inited = true;
    initAllAgentPollers();
  }
}
