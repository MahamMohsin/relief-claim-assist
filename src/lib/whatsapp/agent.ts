import { askMimo } from "@/src/lib/ai/mimo";
import {
  authenticatePhoneWithToken,
  getUserForPhone,
  unlinkPhone,
  updateUserSessionTokens,
  type UserSessionInfo,
} from "./session";
import { getToolsForRole, type WhatsAppToolDefinition } from "./tools";
import type { ScopedUserIdentity } from "./scoped-gateway";

export type DirectChannel = "sms" | "whatsapp";

export type DirectMessageResult = {
  shouldReply: boolean;
  reply: string;
  user: UserSessionInfo | null;
  toolsUsed: string[];
  isAuthenticated: boolean;
};

export type WhatsAppMessageResult = Omit<DirectMessageResult, "shouldReply">;

function formatRoleTitle(role: string): string {
  if (role === "officer") return "Reviewer";
  if (role === "admin") return "Scheme Administrator";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/**
 * Runs a single AI + role-scoped tool turn strictly isolated to `user`.
 * Used by:
 *   1. Official Meta WhatsApp Agent pollers (per-user API key)
 *   2. Direct SMS via paired Google Messages (per-phone `/login <key>` session)
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
  const toolsUsed: string[] = [];

  let toolToRun: { tool: WhatsAppToolDefinition; args: Record<string, unknown> } | null = null;

  // Match role-permitted tools strictly for this user's role
  if (
    /family|families|household list|assigned|consent/i.test(lower) &&
    allowedTools.some(x => x.name === "get_families")
  ) {
    const t = allowedTools.find(x => x.name === "get_families");
    if (t) toolToRun = { tool: t, args: {} };
  } else if (
    /my profile|cnic|utility bill|documents|my info|who am i/i.test(lower) &&
    allowedTools.some(x => x.name === "get_my_profile")
  ) {
    const t = allowedTools.find(x => x.name === "get_my_profile");
    if (t) toolToRun = { tool: t, args: {} };
  } else if (
    /missing payment|report payment|dispute|didn't receive|not received/i.test(lower) &&
    allowedTools.some(x => x.name === "report_missing_payment")
  ) {
    const t = allowedTools.find(x => x.name === "report_missing_payment");
    if (t) {
      const refMatch = text.match(/\b(RAAST[-A-Z0-9]+|TXN[-A-Z0-9]+|REF[-A-Z0-9]+|[A-Z]{2,6}-\d{3,})\b/i);
      if (refMatch) {
        toolToRun = { tool: t, args: { reference: refMatch[1], message: text } };
      }
    }
  } else if (
    /apply|new claim|start claim|draft|need aid|need relief|file a claim/i.test(lower) &&
    allowedTools.some(x => x.name === "create_claim_draft")
  ) {
    const t = allowedTools.find(x => x.name === "create_claim_draft");
    if (t) {
      const incomeMatch = text.match(/(\d+[\d,]*)\s*(?:pkr|rupees|income|\/mo)/i);
      const householdMatch = text.match(/(\d+)\s*(?:people|persons|members|family)/i);
      toolToRun = {
        tool: t,
        args: {
          monthly_income: incomeMatch ? Number(incomeMatch[1].replace(/,/g, "")) : 15000,
          household_size: householdMatch ? Number(householdMatch[1]) : 4,
          notes: text,
        },
      };
    }
  } else if (
    /claim|status|payout|payment|application|grant/i.test(lower) &&
    !/review|queue|approve|reject/i.test(lower) &&
    allowedTools.some(x => x.name === "get_my_claims")
  ) {
    const t = allowedTools.find(x => x.name === "get_my_claims");
    if (t) toolToRun = { tool: t, args: {} };
  } else if (/scam|fraud|fake|suspicious|phishing|lottery|raast|sms|link|otp|verify/i.test(lower)) {
    const t = allowedTools.find(x => x.name === "check_scam");
    if (t) toolToRun = { tool: t, args: { message: text } };
  } else if (/policy|rule|criteria|eligible|eligibility|cap|allowed|section/i.test(lower)) {
    const t = allowedTools.find(x => x.name === "ask_policy");
    if (t) toolToRun = { tool: t, args: { question: text } };
  } else if (
    /approve|reject|more proof/i.test(lower) &&
    allowedTools.some(x => x.name === "review_claim")
  ) {
    const t = allowedTools.find(x => x.name === "review_claim");
    const idMatch = text.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    if (t && idMatch) {
      const decision = /approve/i.test(lower) ? "approve" : /reject/i.test(lower) ? "reject" : "more_proof";
      toolToRun = {
        tool: t,
        args: { claim_id: idMatch[1], decision, reason: text },
      };
    }
  } else if (
    /queue|pending|in review|desk/i.test(lower) &&
    allowedTools.some(x => x.name === "get_review_queue")
  ) {
    const t = allowedTools.find(x => x.name === "get_review_queue");
    if (t) toolToRun = { tool: t, args: {} };
  } else if (
    /allocate|set budget|update budget/i.test(lower) &&
    allowedTools.some(x => x.name === "update_scheme_budget")
  ) {
    const t = allowedTools.find(x => x.name === "update_scheme_budget");
    const amtMatch = text.match(/(\d[\d,]{4,})/);
    if (t && amtMatch) {
      toolToRun = {
        tool: t,
        args: { total_pkr: Number(amtMatch[1].replace(/,/g, "")), reason: text },
      };
    }
  } else if (
    /budget|reserve|funds|allocation/i.test(lower) &&
    allowedTools.some(x => x.name === "get_scheme_budget")
  ) {
    const t = allowedTools.find(x => x.name === "get_scheme_budget");
    if (t) toolToRun = { tool: t, args: {} };
  }

  let toolResultJson = "";
  let toolError = "";
  if (toolToRun) {
    try {
      toolsUsed.push(toolToRun.tool.name);
      const res = await toolToRun.tool.execute(user, toolToRun.args);
      toolResultJson = JSON.stringify(res);
    } catch (err) {
      toolError = err instanceof Error ? err.message : "Tool execution failed.";
      toolResultJson = JSON.stringify({ error: toolError });
    }
  }

  const roleTitle = formatRoleTitle(user.role);
  const allowedList = allowedTools.map(t => `- ${t.name}: ${t.description}`).join("\n");
  const channelGuidance =
    channel === "sms"
      ? "The user is texting via direct SMS (Google Messages). Keep replies clear, concise (under 600 chars when possible), plain text without markdown asterisks or heavy formatting."
      : "The user is chatting on WhatsApp. Use concise paragraphs, *bold* for emphasis, and bullet points (•).";

  try {
    const systemPrompt = `You are the Relief Claim Assist AI Assistant for Pakistan's emergency cash relief system.
STRICT DATA ISOLATION RULE:
You are ONLY authorized to assist this specific authenticated user:
- Name: ${user.name}
- Role: ${user.role} (${roleTitle})
- User ID: ${user.userId}
- Citizen ID: ${user.citizenId || "None (non-citizen role)"}

Permitted tools for ${user.name} (${roleTitle}):
${allowedList}

CRITICAL RULES:
- NEVER discuss, reveal, or invent claims/data belonging to any other user.
- If the user asks for something outside their role (${roleTitle}), politely explain what ${roleTitle} accounts can do instead.
- If tool results are provided below, report ONLY the exact facts from the tool results. Never fabricate claims, amounts, or IDs.
- ${channelGuidance}
- Reply in English (or Urdu if the user writes in Urdu).`;

    const mimoInput = `User (${user.name}, ${roleTitle}) message: "${text}"
${toolResultJson ? `Tool Executed: ${toolToRun?.tool.name}\nTool Output: ${toolResultJson}` : "No database tool was triggered for this message."}

Provide the direct reply to ${user.name}.`;

    const mimoResponse = await askMimo(systemPrompt, mimoInput);
    if (mimoResponse && mimoResponse.trim().length > 0) {
      return { reply: mimoResponse.trim(), toolsUsed };
    }
  } catch {
    // Graceful deterministic fallback below
  }

  // Deterministic fallback if LLM is temporarily unreachable
  if (toolToRun && toolResultJson) {
    const data = JSON.parse(toolResultJson) as Record<string, unknown>;
    if (data.error) {
      return {
        reply: `Could not complete ${toolToRun.tool.name}: ${String(data.error)}`,
        toolsUsed,
      };
    }
    if (toolToRun.tool.name === "get_my_claims") {
      const list = (data.claims as Array<Record<string, unknown>>) || [];
      if (list.length === 0) {
        return {
          reply: `No relief claims found for ${String(data.owner || user.name)}.`,
          toolsUsed,
        };
      }
      const lines = list.map(
        (c, i) =>
          `${i + 1}. ${String(c.notes || "Relief Grant")} - ${String(c.status).toUpperCase()} - PKR ${new Intl.NumberFormat("en-PK").format(Number(c.amount_pkr || 0))} (Ref #${String(c.id).slice(0, 8)})`,
      );
      return {
        reply: `Relief Claims for ${String(data.owner || user.name)} (${list.length}):\n${lines.join("\n")}`,
        toolsUsed,
      };
    }
    if (toolToRun.tool.name === "get_my_profile") {
      return {
        reply: `Profile for ${String(data.full_name)}: Area ${String(data.village_area)}, Household ${String(data.household_size)}, Monthly income PKR ${new Intl.NumberFormat("en-PK").format(Number(data.monthly_income_mock || 0))}, Docs uploaded: ${String(data.documents_count)}.`,
        toolsUsed,
      };
    }
    if (toolToRun.tool.name === "get_families") {
      const fams = (data.families as Array<Record<string, unknown>>) || [];
      return {
        reply: fams.length
          ? `Assigned families for ${user.name} (${fams.length}):\n` +
            fams.map(f => `- ${String(f.full_name)} (${String(f.village_area)}) · Consent: ${String(f.consent)}`).join("\n")
          : `No families are currently assigned to ${user.name}.`,
        toolsUsed,
      };
    }
    if (toolToRun.tool.name === "ask_policy") {
      return { reply: `Policy (${String(data.version || "current")}): ${String(data.answer)}`, toolsUsed };
    }
    if (toolToRun.tool.name === "check_scam") {
      return {
        reply: `Scam Shield verdict: ${String(data.classification).toUpperCase()} (${String(data.confidence)}% confidence). ${String(data.explanation || "")}`,
        toolsUsed,
      };
    }
    if (toolToRun.tool.name === "get_review_queue") {
      const claims = (data.claims as Array<Record<string, unknown>>) || [];
      return {
        reply: `Review Queue (${String(data.count)}):\n` +
          claims.map(c => `- ${String(c.applicant)} · PKR ${new Intl.NumberFormat("en-PK").format(Number(c.amount_pkr || 0))} · ${String(c.status)} (#${String(c.id).slice(0, 8)})`).join("\n"),
        toolsUsed,
      };
    }
    if (toolToRun.tool.name === "get_scheme_budget") {
      return {
        reply: `Scheme Budget: Total PKR ${new Intl.NumberFormat("en-PK").format(Number(data.total_budget_pkr || 0))}, Available PKR ${new Intl.NumberFormat("en-PK").format(Number(data.available_pkr || 0))}, Reserved PKR ${new Intl.NumberFormat("en-PK").format(Number(data.reserved_pkr || 0))}, Paid PKR ${new Intl.NumberFormat("en-PK").format(Number(data.paid_pkr || 0))}.`,
        toolsUsed,
      };
    }
    return { reply: String(data.message || JSON.stringify(data)), toolsUsed };
  }

  return {
    reply: `Hello ${user.name} (${roleTitle})! I am your Relief Assist assistant. Ask me a question or send /help to see what your ${roleTitle} account can do.`,
    toolsUsed,
  };
}

/**
 * Processes an inbound direct message (Google Messages SMS or WhatsApp gateway)
 * with `/login <key>`, `/logout`, `/whoami`, `/help`, and per-user isolated tools.
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

    const roleName = formatRoleTitle(auth.user.role);
    const roleHints =
      auth.user.role === "citizen"
        ? "Check your claims, check your profile, draft a new claim, ask policy rules, or verify suspicious SMS."
        : auth.user.role === "helper"
          ? "View assigned families, check family claims, draft aid applications, ask policy rules, or check scams."
          : auth.user.role === "shopkeeper"
            ? "Verify suspicious SMS/Raast alerts, report missing payments, or ask official relief policy rules."
            : auth.user.role === "officer"
              ? "Inspect review queue, check scheme budget, review claims, or ask policy rules."
              : auth.user.role === "admin"
                ? "Check or update scheme budget, inspect review queue, view families, or ask policy rules."
                : "Inspect review queue, check scheme budget, or ask policy rules.";

    return {
      shouldReply: true,
      reply: `Relief Assist ${channelLabel}: Logged in as ${auth.user.name} (${roleName}).\nYour chat is privately scoped to your account.\nYou can: ${roleHints}\nSend your question anytime, or /logout to disconnect.`,
      user: auth.user,
      toolsUsed: ["authenticate_session"],
      isAuthenticated: true,
    };
  }

  // 2. Handle /logout
  if (lower === "/logout" || lower === "logout") {
    const wasLinked = unlinkPhone(fromSender);
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

  // 3. Check if this sender is authenticated
  const user = getUserForPhone(fromSender);
  if (!user) {
    // Safety guard for real paired Google Messages phone: don't auto-reply to unrelated personal/OTP SMS!
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

  // 4. Handle /whoami
  if (lower === "/whoami" || lower === "whoami") {
    return {
      shouldReply: true,
      reply: `Connected as ${user.name} (${formatRoleTitle(user.role)}). Send /logout to switch accounts.`,
      user,
      toolsUsed: [],
      isAuthenticated: true,
    };
  }

  // 5. Handle /help
  if (lower === "/help" || lower === "help") {
    const roleTitle = formatRoleTitle(user.role);
    const tools = getToolsForRole(user.role).map(t => `- ${t.name.replaceAll("_", " ")}`).join("\n");
    return {
      shouldReply: true,
      reply: `Relief Assist ${channelLabel} (${user.name} · ${roleTitle}):\nAvailable actions:\n${tools}\nCommands: /whoami, /logout`,
      user,
      toolsUsed: [],
      isAuthenticated: true,
    };
  }

  // 6. Execute strictly scoped AI + tool turn for this authenticated user
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
