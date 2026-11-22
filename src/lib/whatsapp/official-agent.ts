import fs from "node:fs";
import path from "node:path";
import { askMimo } from "@/src/lib/ai/mimo";
import { recordWhatsAppMessage } from "./server";
import { getToolsForRole } from "./tools";

const AGENT_KEYS_FILE = path.resolve(process.cwd(), ".whatsapp-agent-keys.json");
const WHATSAPP_AGENT_BASE_URL = "https://api.whatsapp.com/agent/v1";

export type StoredAgentKey = {
  personaId: string;
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

// In-memory active pollers map
const activePollers = new Map<string, { abortController: AbortController; isRunning: boolean }>();

function readAgentKeyStore(): AgentKeyStore {
  try {
    if (fs.existsSync(AGENT_KEYS_FILE)) {
      const data = fs.readFileSync(AGENT_KEYS_FILE, "utf-8");
      return JSON.parse(data);
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
 * Send an outbound message from your agent to a WhatsApp user
 */
export async function sendAgentMessage(apiKey: string, toRecipient: string, bodyText: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
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

/**
 * Save an API key for a persona and start its polling worker
 */
export async function saveAgentApiKey(
  personaId: string,
  apiKey: string,
  agentName = "Ali",
): Promise<{ success: boolean; maskedKey: string; error?: string }> {
  const cleanKey = apiKey.trim();
  const test = await testAgentApiKey(cleanKey);

  if (!test.valid) {
    return {
      success: false,
      maskedKey: "",
      error: test.error || "Invalid WhatsApp Agent API key.",
    };
  }

  const store = readAgentKeyStore();
  const existing = store.keys[personaId];

  const entry: StoredAgentKey = {
    personaId,
    apiKey: cleanKey,
    agentName: agentName || existing?.agentName || "Ali",
    connectedAt: existing?.connectedAt || new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    agentNumericId: test.agentId || existing?.agentNumericId || null,
    lastOffset: existing?.lastOffset ?? null,
  };

  store.keys[personaId] = entry;
  writeAgentKeyStore(store);

  // Restart poller
  startAgentPoller(entry);

  return {
    success: true,
    maskedKey: maskApiKey(cleanKey),
  };
}

/**
 * Remove an API key for a persona
 */
export function removeAgentApiKey(personaId: string): boolean {
  stopAgentPoller(personaId);
  const store = readAgentKeyStore();
  if (store.keys[personaId]) {
    delete store.keys[personaId];
    writeAgentKeyStore(store);
    return true;
  }
  return false;
}

/**
 * Get stored key info for a persona
 */
export function getAgentKeyInfo(personaId: string): {
  isConfigured: boolean;
  maskedKey: string | null;
  agentName: string | null;
  connectedAt: string | null;
  lastActiveAt: string | null;
} {
  const store = readAgentKeyStore();
  const item = store.keys[personaId];
  if (!item) {
    return {
      isConfigured: false,
      maskedKey: null,
      agentName: null,
      connectedAt: null,
      lastActiveAt: null,
    };
  }
  return {
    isConfigured: true,
    maskedKey: maskApiKey(item.apiKey),
    agentName: item.agentName,
    connectedAt: item.connectedAt,
    lastActiveAt: item.lastActiveAt,
  };
}

/**
 * Stop active poller
 */
export function stopAgentPoller(personaId: string) {
  const existing = activePollers.get(personaId);
  if (existing) {
    existing.abortController.abort();
    existing.isRunning = false;
    activePollers.delete(personaId);
    console.log(`[wa-agent] Stopped poller for persona: ${personaId}`);
  }
}

/**
 * Start long-poll loop for a WhatsApp Agent
 */
export function startAgentPoller(entry: StoredAgentKey) {
  stopAgentPoller(entry.personaId);

  const abortController = new AbortController();
  activePollers.set(entry.personaId, { abortController, isRunning: true });

  const roleForPersona: "citizen" | "helper" | "officer" | "auditor" | "admin" =
    entry.personaId === "kamran"
      ? "admin"
      : entry.personaId === "tariq"
        ? "officer"
        : entry.personaId === "zainab"
          ? "helper"
          : entry.personaId === "auditor"
            ? "auditor"
            : "citizen";

  (async () => {
    let offset: number | null = entry.lastOffset ?? null;
    console.log(`[wa-agent] Started official WhatsApp Agent poller for ${entry.personaId} (role: ${roleForPersona}, agent: ${entry.agentName})`);

    while (!abortController.signal.aborted) {
      try {
        let url = `${WHATSAPP_AGENT_BASE_URL}/updates?limit=50&timeout=15`;
        if (offset !== null) {
          url += `&offset=${offset}`;
        }

        const res = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${entry.apiKey}`,
          },
          signal: abortController.signal,
        });

        if (abortController.signal.aborted) break;

        // HTTP 204: timeout with nothing to deliver
        if (res.status === 204) {
          continue;
        }

        if (res.status === 200) {
          const data = await res.json();
          if (data?.next_offset !== undefined) {
            offset = data.next_offset;
            // update in store occasionally
            entry.lastOffset = offset;
            entry.lastActiveAt = new Date().toISOString();
          }

          const entries = data?.entry || [];
          for (const ent of entries) {
            const changes = ent?.changes || [];
            for (const ch of changes) {
              const messages = ch?.value?.messages || [];
              const contacts = ch?.value?.contacts || [];

              for (const msg of messages) {
                if (msg.type !== "text" && !msg.text?.body) continue;
                const senderId = msg.from; // e.g. "user:50972923564215"
                const textBody = msg.text.body.trim();
                const wamid = msg.id;

                console.log(`[wa-agent] 💬 Inbound message on ${entry.agentName} from ${senderId}: "${textBody}"`);

                // Record inbound message
                recordWhatsAppMessage({
                  direction: "inbound",
                  from: senderId,
                  to: entry.agentName,
                  text: textBody,
                });

                // Show typing indicator & mark read
                if (wamid) {
                  void sendAgentTypingStatus(entry.apiKey, wamid);
                }

                // Process through MiMo AI with role-scoped tools
                const tools = getToolsForRole(roleForPersona);
                const toolsPrompt = tools.map(t => `- **${t.name}**: ${t.description}`).join("\n");

                const systemPrompt = `You are the official Relief Claim Assist WhatsApp Agent for Pakistan Flood Relief.
User persona context: Role: ${roleForPersona}, ID: ${entry.personaId}.
Available capabilities for this user role:
${toolsPrompt}

Answer the user directly and informatively in clear, professional English (or Urdu if they ask in Urdu).
Keep answers formatted nicely for WhatsApp using asterisks for bold (*text*), bullet points (•), and emojis where helpful.`;

                try {
                  const mimoInput = `User Message: "${textBody}"\n\nPlease provide the direct WhatsApp response to the user.`;
                  const replyText = await askMimo(systemPrompt, mimoInput);

                  // Send reply to WhatsApp
                  const sendRes = await sendAgentMessage(entry.apiKey, senderId, replyText);

                  // Record outbound message
                  recordWhatsAppMessage({
                    direction: "outbound",
                    from: entry.agentName,
                    to: senderId,
                    text: replyText,
                    toolsUsed: ["official_agent_mimo"],
                  });

                  console.log(`[wa-agent] ✅ Bot reply sent to WhatsApp user ${senderId} (messageId: ${sendRes.messageId || "ok"})`);
                } catch (aiErr) {
                  console.error("[wa-agent] Error generating/sending AI reply:", aiErr);
                  await sendAgentMessage(
                    entry.apiKey,
                    senderId,
                    "⚠️ We encountered a temporary delay processing your request. Please try again in a moment.",
                  );
                }
              }
            }
          }
          continue;
        }

        // Rate limit 429
        if (res.status === 429) {
          console.warn("[wa-agent] Rate limit reached. Backing off for 10 seconds...");
          await new Promise(r => setTimeout(r, 10000));
          continue;
        }

        // Token invalid 401
        if (res.status === 401) {
          console.error(`[wa-agent] WhatsApp API token rejected for ${entry.personaId}. Halting poller.`);
          break;
        }

        // Other HTTP errors (500, 503)
        await new Promise(r => setTimeout(r, 5000));
      } catch (err: unknown) {
        if (abortController.signal.aborted) break;
        // Network timeout / connection reset
        console.warn(`[wa-agent] Polling loop notice: ${err instanceof Error ? err.message : String(err)}. Re-polling in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  })();
}

declare global {
  // eslint-disable-next-line no-var
  var __rca_whatsapp_pollers_inited: boolean | undefined;
}

/**
 * Initializes pollers for all saved agent keys upon server boot
 */
export function initAllAgentPollers() {
  const store = readAgentKeyStore();
  const keys = Object.values(store.keys);
  console.log(`[wa-agent] Initializing ${keys.length} stored WhatsApp Agent pollers...`);
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

