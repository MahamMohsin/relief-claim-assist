import {
  askMimo,
  askMimoWithTools,
  type MimoContentBlock,
  type MimoMessage,
  type MimoToolSpec,
} from "@/src/lib/ai/mimo";
import {
  authenticatePhoneWithToken,
  getUserForPhone,
  unlinkPhone,
  updateUserSessionTokens,
  type UserSessionInfo,
} from "./session";
import { getToolsForRole, type WhatsAppToolDefinition } from "./tools";
import type { ScopedUserIdentity } from "./scoped-gateway";
import { convertMarkdownTablesToMobileText } from "./audio";

export { convertMarkdownTablesToMobileText };

export type DirectChannel = "sms" | "whatsapp";

export type DirectMessageResult = {
  shouldReply: boolean;
  reply: string;
  user: UserSessionInfo | null;
  toolsUsed: string[];
  isAuthenticated: boolean;
};

export type WhatsAppMessageResult = Omit<DirectMessageResult, "shouldReply">;

// Strictly per-(channel, userId) rolling conversation memory so follow-ups work
// without EVER crossing data between Fatima, Tariq, Zainab, Bilal, Sana, or Kamran.
type HistoryEntry = { role: "user" | "assistant"; text: string };

declare global {
  // eslint-disable-next-line no-var
  var __rca_messaging_histories: Map<string, HistoryEntry[]> | undefined;
}

function getHistories() {
  if (!globalThis.__rca_messaging_histories) {
    globalThis.__rca_messaging_histories = new Map();
  }
  return globalThis.__rca_messaging_histories;
}

function historyKey(channel: DirectChannel, userId: string) {
  return `${channel}:${userId}`;
}

export function clearUserConversationHistory(channel: DirectChannel, userId: string) {
  getHistories().delete(historyKey(channel, userId));
}

function appendHistory(channel: DirectChannel, userId: string, entry: HistoryEntry) {
  const map = getHistories();
  const key = historyKey(channel, userId);
  const list = map.get(key) || [];
  list.push(entry);
  if (list.length > 14) {
    list.splice(0, list.length - 14);
  }
  map.set(key, list);
}

function getHistoryMessages(channel: DirectChannel, userId: string): MimoMessage[] {
  const list = getHistories().get(historyKey(channel, userId)) || [];
  return list.slice(-10).map(item => ({ role: item.role, content: item.text }));
}

function formatRoleTitle(role: string): string {
  if (role === "officer") return "Reviewer";
  if (role === "admin") return "Scheme Administrator";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function toMimoToolSpecs(tools: WhatsAppToolDefinition[]): MimoToolSpec[] {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object",
      properties: t.parameters.properties,
      required: t.parameters.required,
    },
  }));
}

/**
 * Full multi-step autonomous tool-calling turn strictly isolated to `user`.
 * Shared identically by:
 *   1. Official Meta WhatsApp Agent pollers (per-user API key)
 *   2. Direct SMS via paired Google Messages (`/login <key>` session)
 *   3. In-app Test Chat Console
 */
export async function runScopedAssistantTurn(
  user: ScopedUserIdentity,
  rawText: string,
  channel: DirectChannel = "whatsapp",
): Promise<{ reply: string; toolsUsed: string[] }> {
  const text = rawText.trim();
  const lower = text.toLowerCase();
  const allowedTools = getToolsForRole(user.role);
  const roleTitle = formatRoleTitle(user.role);

  if (lower === "/reset" || lower === "/clear") {
    clearUserConversationHistory(channel, user.userId);
    return {
      reply: `Conversation memory cleared for ${user.name} (${roleTitle}).`,
      toolsUsed: [],
    };
  }
  if (lower === "/whoami" || lower === "whoami") {
    return {
      reply: `Connected strictly as ${user.name} (${roleTitle}) with ${allowedTools.length} scoped tools active.`,
      toolsUsed: [],
    };
  }
  if (lower === "/tools" || lower === "tools" || lower === "/help" || lower === "help") {
    const list = allowedTools.map(t => `• ${t.name.replaceAll("_", " ")}`).join("\n");
    return {
      reply: `Relief Assist (${user.name} · ${roleTitle}) — All ${allowedTools.length} active tools:\n${list}\n\nJust ask naturally in English or Urdu to run any action!`,
      toolsUsed: [],
    };
  }

  const toolByName = new Map(allowedTools.map(t => [t.name, t]));
  const toolsUsed: string[] = [];

  const channelGuidance =
    channel === "sms"
      ? `The user is texting via Direct SMS (Google Messages).
CRITICAL SMS FORMATTING RULES:
- NEVER use markdown tables or pipe characters (|). They break on SMS screens.
- Format lists cleanly as numbered cards:
  1. Status — Amount (Date)
     Details/Notes
- Keep text concise, plain, and easy to read.`
      : `The user is chatting on WhatsApp.
CRITICAL WHATSAPP FORMATTING RULES:
- NEVER output markdown tables (| col | col | or |---|---|). WhatsApp does NOT support markdown tables and displays them as ugly garbled raw pipes on phone screens.
- Instead of tables, format listings as clean numbered or bulleted mobile cards:
  1. *[Status Emoji]* *Amount or Title* — Date
     • Note or detail
- Use WhatsApp formatting: *bold* for key numbers, amounts, dates, and statuses. Use bullet points (•) for summaries.
- Keep the tone friendly, helpful, and formatted like a natural WhatsApp mobile chat message.`;

  const systemPrompt = `You are the full-capability Relief Claim Assist AI Agent for Pakistan's emergency cash relief system.

STRICT PER-USER DATA ISOLATION:
- Authenticated User: ${user.name}
- Role: ${user.role} (${roleTitle})
- User ID: ${user.userId}
- Citizen ID: ${user.citizenId || "None (non-citizen role)"}

OPERATING RULES:
1. You have full access to ALL ${allowedTools.length} tools authorized for ${roleTitle} accounts. ALWAYS call the appropriate real tool(s) to read live data or perform actions — NEVER guess, fabricate, or pretend you ran an action.
2. You may chain multiple tools in one turn when needed (for example: fetch claims or review queue first to get exact UUIDs, then attach evidence / submit / review / disburse / update consent / simulate / publish / adjust budget).
3. NEVER access, invent, or reveal data belonging to any other user. Only report exact facts returned by tool outputs.
4. If the user asks for an action outside their role (${roleTitle}), clearly explain what their role is permitted to do instead.
5. ${channelGuidance}
6. Reply in English, or in Urdu if the user writes in Urdu. Format PKR amounts with commas (e.g., PKR 25,000).`;

  const toolSpecs = toMimoToolSpecs(allowedTools);
  const history = getHistoryMessages(channel, user.userId);
  const conversation: MimoMessage[] = [...history, { role: "user", content: text }];

  const MAX_TOOL_ROUNDS = 6;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await askMimoWithTools({
        system: systemPrompt,
        messages: conversation,
        tools: toolSpecs,
        maxTokens: channel === "sms" ? 750 : 1100,
      });

      const toolUses = response.content.filter(
        (b): b is Extract<MimoContentBlock, { type: "tool_use" }> => b.type === "tool_use",
      );
      const textParts = response.content
        .filter((b): b is Extract<MimoContentBlock, { type: "text" }> => b.type === "text")
        .map(b => b.text.trim())
        .filter(Boolean);

      if (toolUses.length === 0) {
        const rawReply =
          textParts.join("\n\n").trim() ||
          `Completed your request for ${user.name} (${roleTitle}).`;
        const finalReply = convertMarkdownTablesToMobileText(rawReply, channel);
        appendHistory(channel, user.userId, { role: "user", text });
        appendHistory(channel, user.userId, { role: "assistant", text: finalReply });
        return { reply: finalReply, toolsUsed };
      }

      // Append assistant's tool_use turn
      conversation.push({ role: "assistant", content: response.content });

      // Execute every requested tool strictly within this user's isolated role & Supabase JWT
      const toolResults: MimoContentBlock[] = [];
      for (const call of toolUses) {
        const toolDef = toolByName.get(call.name);
        if (!toolDef) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content: JSON.stringify({
              error: `Tool '${call.name}' is not permitted for role '${user.role}'.`,
            }),
          });
          continue;
        }

        if (!toolsUsed.includes(call.name)) {
          toolsUsed.push(call.name);
        }

        try {
          const output = await toolDef.execute(user, call.input || {});
          const serialized = JSON.stringify(output);
          toolResults.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: serialized.length > 12000 ? serialized.slice(0, 12000) + "...(truncated)" : serialized,
          });
        } catch (toolErr) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: call.id,
            is_error: true,
            content: JSON.stringify({
              error: toolErr instanceof Error ? toolErr.message : "Tool execution failed.",
            }),
          });
        }
      }

      conversation.push({ role: "user", content: toolResults });
    }

    // Safety final synthesis if MAX_TOOL_ROUNDS hit
    const wrapUp = await askMimoWithTools({
      system: systemPrompt,
      messages: [
        ...conversation,
        { role: "user", content: "Summarize all tool results above clearly for the user now." },
      ],
      tools: [],
      maxTokens: channel === "sms" ? 600 : 900,
    });
    const finalText = wrapUp.content
      .filter((b): b is Extract<MimoContentBlock, { type: "text" }> => b.type === "text")
      .map(b => b.text.trim())
      .filter(Boolean)
      .join("\n\n");

    const rawReply = finalText || `Done! Executed: ${toolsUsed.join(", ")}.`;
    const reply = convertMarkdownTablesToMobileText(rawReply, channel);
    appendHistory(channel, user.userId, { role: "user", text });
    appendHistory(channel, user.userId, { role: "assistant", text: reply });
    return { reply, toolsUsed };
  } catch (err) {
    console.warn(
      `[messaging-agent] Multi-tool loop fallback for ${user.name}:`,
      err instanceof Error ? err.message : String(err),
    );
    return runFallbackTurn(user, text, channel, allowedTools);
  }
}

/**
 * Fallback single-tool + deterministic handler if MiMo tool-calling endpoint is temporarily unavailable
 */
async function runFallbackTurn(
  user: ScopedUserIdentity,
  text: string,
  channel: DirectChannel,
  allowedTools: WhatsAppToolDefinition[],
): Promise<{ reply: string; toolsUsed: string[] }> {
  const lower = text.toLowerCase();
  const toolsUsed: string[] = [];
  let toolToRun: { tool: WhatsAppToolDefinition; args: Record<string, unknown> } | null = null;

  const find = (name: string) => allowedTools.find(x => x.name === name);

  if (/family|families/i.test(lower) && find("get_families")) {
    toolToRun = { tool: find("get_families")!, args: {} };
  } else if (/privacy|consent|correction/i.test(lower) && find("get_privacy_status")) {
    toolToRun = { tool: find("get_privacy_status")!, args: {} };
  } else if (/my profile|cnic|utility bill|job proof/i.test(lower) && find("get_my_profile")) {
    toolToRun = { tool: find("get_my_profile")!, args: {} };
  } else if (/audit/i.test(lower) && find("get_audit_logs")) {
    toolToRun = { tool: find("get_audit_logs")!, args: { limit: 10 } };
  } else if (/safety/i.test(lower) && find("get_safety_metrics")) {
    toolToRun = { tool: find("get_safety_metrics")!, args: {} };
  } else if (/queue|pending|in review/i.test(lower) && find("get_review_queue")) {
    toolToRun = { tool: find("get_review_queue")!, args: {} };
  } else if (/overview|stats|metrics/i.test(lower) && find("get_overview_metrics")) {
    toolToRun = { tool: find("get_overview_metrics")!, args: {} };
  } else if (/budget|reserve|funds/i.test(lower) && find("get_scheme_budget")) {
    toolToRun = { tool: find("get_scheme_budget")!, args: {} };
  } else if (/claim|status|payout/i.test(lower) && find("get_my_claims")) {
    toolToRun = { tool: find("get_my_claims")!, args: {} };
  } else if (/scam|fraud|fake|phishing|otp|raast/i.test(lower) && find("check_scam")) {
    toolToRun = { tool: find("check_scam")!, args: { message: text } };
  } else if (/policy|rule|eligible|cap/i.test(lower) && find("ask_policy")) {
    toolToRun = { tool: find("ask_policy")!, args: { question: text } };
  }

  let outputJson = "";
  if (toolToRun) {
    toolsUsed.push(toolToRun.tool.name);
    try {
      const out = await toolToRun.tool.execute(user, toolToRun.args);
      outputJson = JSON.stringify(out);
    } catch (e) {
      return {
        reply: `Could not run ${toolToRun.tool.name}: ${e instanceof Error ? e.message : "Failed"}`,
        toolsUsed,
      };
    }
  }

  try {
    const simpleReply = await askMimo(
      `You are Relief Assist (${formatRoleTitle(user.role)} assistant for ${user.name}). ${channel === "sms" ? "Reply concisely in plain SMS text." : "Reply concisely for WhatsApp."}`,
      `User asked: "${text}"\n${outputJson ? `Tool ${toolToRun?.tool.name} output: ${outputJson}` : ""}`,
    );
    if (simpleReply) return { reply: simpleReply, toolsUsed };
  } catch {}

  if (outputJson) {
    return {
      reply: `${toolToRun?.tool.name} result: ${outputJson.slice(0, 500)}`,
      toolsUsed,
    };
  }

  return {
    reply: `Hello ${user.name} (${formatRoleTitle(user.role)})! Send /help or /tools to see everything I can do for your account.`,
    toolsUsed,
  };
}

/**
 * Processes an inbound direct message (Google Messages SMS or WhatsApp gateway)
 * with `/login <key>`, `/logout`, `/whoami`, `/reset`, `/tools`, `/help`, and full multi-tool execution.
 */
export async function processDirectChannelMessage(
  fromSender: string,
  rawText: string,
  options: {
    channel?: DirectChannel;
    requireCommandWhenUnauth?: boolean;
  } = {},
): Promise<DirectMessageResult> {
  const channel = options.channel ?? "whatsapp";
  const requireCommandWhenUnauth = options.requireCommandWhenUnauth ?? false;
  const text = rawText.trim();
  const lower = text.toLowerCase();
  const channelLabel = channel === "sms" ? "Direct SMS" : "WhatsApp";

  // 1. Handle /login <key>
  if (lower.startsWith("/login") || lower.startsWith("login ")) {
    const parts = text.split(/\s+/);
    const token = parts[1]?.trim() || "";

    if (!token) {
      return {
        shouldReply: true,
        reply: `Missing login key. Send:\n/login <your-key>\n\nFind your personal key inside Relief Assist -> WhatsApp & SMS.`,
        user: null,
        toolsUsed: [],
        isAuthenticated: false,
      };
    }

    const auth = authenticatePhoneWithToken(fromSender, token);
    if (!auth.success || !auth.user) {
      return {
        shouldReply: true,
        reply: `Login failed: ${auth.error || "Invalid key."}\nCopy your personal key from Relief Assist and text: /login <your-key>`,
        user: null,
        toolsUsed: [],
        isAuthenticated: false,
      };
    }

    clearUserConversationHistory(channel, auth.user.userId);
    const roleName = formatRoleTitle(auth.user.role);
    const toolsCount = getToolsForRole(auth.user.role).length;

    return {
      shouldReply: true,
      reply: `Relief Assist ${channelLabel}: Logged in as ${auth.user.name} (${roleName}).\nYour session is privately scoped to your account with all ${toolsCount} ${roleName} tools active.\nAsk anything or tell me what to do (send /tools to see every action, /logout to disconnect).`,
      user: auth.user,
      toolsUsed: ["authenticate_session"],
      isAuthenticated: true,
    };
  }

  // 2. Handle /logout
  if (lower === "/logout" || lower === "logout") {
    const prevUser = getUserForPhone(fromSender);
    const wasLinked = unlinkPhone(fromSender);
    if (prevUser) {
      clearUserConversationHistory(channel, prevUser.userId);
    }
    return {
      shouldReply: true,
      reply: wasLinked
        ? `Logged out of Relief Assist ${channelLabel}. Send /login <your-key> anytime to reconnect.`
        : `You are not currently logged in. Send /login <your-key> to connect.`,
      user: null,
      toolsUsed: ["logout"],
      isAuthenticated: false,
    };
  }

  // 3. Check authentication
  const user = getUserForPhone(fromSender);
  if (!user) {
    const isExplicitPrompt =
      lower === "/start" ||
      lower === "/help" ||
      lower === "/relief" ||
      lower.startsWith("/relief ");

    if (requireCommandWhenUnauth && !isExplicitPrompt) {
      return {
        shouldReply: false,
        reply: "",
        user: null,
        toolsUsed: [],
        isAuthenticated: false,
      };
    }

    return {
      shouldReply: true,
      reply: `Relief Assist ${channelLabel}: Please log in first.\nOpen Relief Assist -> WhatsApp & SMS, copy your personal key, and send:\n/login <your-key>`,
      user: null,
      toolsUsed: [],
      isAuthenticated: false,
    };
  }

  // 4. Handle /reset
  if (lower === "/reset" || lower === "/clear") {
    clearUserConversationHistory(channel, user.userId);
    return {
      shouldReply: true,
      reply: `Conversation memory cleared for ${user.name}. Start a fresh request anytime!`,
      user,
      toolsUsed: [],
      isAuthenticated: true,
    };
  }

  // 5. Handle /whoami
  if (lower === "/whoami" || lower === "whoami") {
    const toolsCount = getToolsForRole(user.role).length;
    return {
      shouldReply: true,
      reply: `Connected as ${user.name} (${formatRoleTitle(user.role)}) with ${toolsCount} scoped tools. Send /tools, /reset, or /logout.`,
      user,
      toolsUsed: [],
      isAuthenticated: true,
    };
  }

  // 6. Handle /help or /tools
  if (lower === "/help" || lower === "help" || lower === "/tools" || lower === "tools") {
    const roleTitle = formatRoleTitle(user.role);
    const tools = getToolsForRole(user.role);
    const list = tools.map(t => `- ${t.name.replaceAll("_", " ")}`).join("\n");
    return {
      shouldReply: true,
      reply: `Relief Assist ${channelLabel} (${user.name} · ${roleTitle})\nAll ${tools.length} active tools:\n${list}\nCommands: /whoami, /reset, /logout`,
      user,
      toolsUsed: [],
      isAuthenticated: true,
    };
  }

  // 7. Execute full multi-tool scoped assistant turn
  const scopedIdentity: ScopedUserIdentity = {
    userId: user.userId,
    name: user.name,
    role: user.role,
    citizenId: user.citizenId,
    persona: user.persona,
    email: user.email,
    accessToken: user.accessToken,
    refreshToken: user.refreshToken,
    onTokensRefreshed: tokens => updateUserSessionTokens(user.userId, tokens),
  };

  const turn = await runScopedAssistantTurn(scopedIdentity, text, channel);
  return {
    shouldReply: true,
    reply: turn.reply,
    user,
    toolsUsed: turn.toolsUsed,
    isAuthenticated: true,
  };
}

export async function processIncomingWhatsAppMessage(
  fromPhone: string,
  rawText: string,
): Promise<WhatsAppMessageResult> {
  const result = await processDirectChannelMessage(fromPhone, rawText, {
    channel: "whatsapp",
    requireCommandWhenUnauth: false,
  });
  return {
    reply: result.reply,
    user: result.user,
    toolsUsed: result.toolsUsed,
    isAuthenticated: result.isAuthenticated,
  };
}
