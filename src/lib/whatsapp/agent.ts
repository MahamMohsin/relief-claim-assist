import { askMimo } from "@/src/lib/ai/mimo";
import { authenticatePhoneWithToken, getUserForPhone, unlinkPhone, type UserSessionInfo } from "./session";
import { getToolsForRole, type WhatsAppToolDefinition } from "./tools";

export type WhatsAppMessageResult = {
  reply: string;
  user: UserSessionInfo | null;
  toolsUsed: string[];
  isAuthenticated: boolean;
};

export async function processIncomingWhatsAppMessage(
  fromPhone: string,
  rawText: string,
): Promise<WhatsAppMessageResult> {
  const text = rawText.trim();
  const lower = text.toLowerCase();

  // 1. Handle /login <sessionkey>
  if (lower.startsWith("/login") || lower.startsWith("login ")) {
    const parts = text.split(/\s+/);
    const token = parts[1]?.trim() || "";

    if (!token) {
      return {
        reply: "⚠️ *Missing Session Token*\n\nPlease provide your token:\n`/login <your-session-token>`\n\nYou can find or copy your session token from your *Relief Assist Profile* or the *WhatsApp Link* mini-app in the web dashboard.",
        user: null,
        toolsUsed: [],
        isAuthenticated: false,
      };
    }

    const auth = authenticatePhoneWithToken(fromPhone, token);
    if (!auth.success || !auth.user) {
      return {
        reply: `❌ *Authentication Failed*\n\n${auth.error || "The session token is invalid or expired."}\n\n👉 Go to your Relief Assist dashboard, copy your active session key, and reply:\n\`/login <sessionkey>\``,
        user: null,
        toolsUsed: [],
        isAuthenticated: false,
      };
    }

    const roleName = auth.user.role === "officer" ? "Reviewer" : auth.user.role.charAt(0).toUpperCase() + auth.user.role.slice(1);
    const welcome = `🏛️ *Relief Assist WhatsApp Gateway*\n\n✅ *Login Successful!*\nWelcome back, *${auth.user.name}*.\nAuthenticated Role: *${roleName}*\n\nYour WhatsApp number is now securely linked to your account. You can interact with all services:\n\n• *Claims*: Check your active applications & payouts\n• *New Aid*: Apply for emergency cash assistance\n• *Policy Ask*: Inquire about eligibility criteria & income caps\n• *Scam Shield*: Forward suspicious SMS/receipts to verify fraud\n${auth.user.role === "officer" || auth.user.role === "admin" ? "• *Review Queue*: Inspect and approve pending claims\n• *Scheme Budget*: Check reserves & available payouts\n" : ""}\n_Type your question or request naturally to begin, or type /help for commands._`;

    return {
      reply: welcome,
      user: auth.user,
      toolsUsed: ["authenticate_session"],
      isAuthenticated: true,
    };
  }

  // 2. Handle /logout
  if (lower === "/logout" || lower === "logout") {
    const wasLinked = unlinkPhone(fromPhone);
    return {
      reply: wasLinked
        ? "👋 *Logged Out Successfully*\n\nYour WhatsApp session has been disconnected from Relief Assist. To log in again anytime, send:\n`/login <your-session-key>`"
        : "ℹ️ Your phone was not currently connected to an active session. Send `/login <your-session-key>` to connect.",
      user: null,
      toolsUsed: ["logout"],
      isAuthenticated: false,
    };
  }

  // 3. Verify user authentication
  const user = getUserForPhone(fromPhone);
  if (!user) {
    return {
      reply: "🔒 *Authentication Required*\n\nWelcome to *Relief Claim Assist*.\nTo chat with the relief assistant, please link your WhatsApp account.\n\n*How to get started:*\n1. Open your Relief Assist Web Dashboard.\n2. In your *Profile* or the *WhatsApp Link* mini-app, copy your secret *Session Token*.\n3. Reply to this chat with:\n\n`/login <your-session-token>`",
      user: null,
      toolsUsed: [],
      isAuthenticated: false,
    };
  }

  // 4. Handle /help
  if (lower === "/help" || lower === "help") {
    const roleTitle = user.role === "officer" ? "Reviewer" : user.role.charAt(0).toUpperCase() + user.role.slice(1);
    const helpMsg = `📖 *Relief Assist WhatsApp Guide* (${roleTitle})\n\nHere are some things you can ask right here in chat:\n\n${
      user.role === "citizen" || user.role === "helper"
        ? "• *Check my claims*: 'What is the status of my relief claim?'\n• *Apply for aid*: 'I need flood relief aid for 4 family members and 15000 income'\n• *Policy query*: 'What is the maximum income cap to qualify for cash assistance?'\n• *Verify SMS*: 'Is this message a scam: Raast payment received click here...'\n"
        : user.role === "officer"
          ? "• *Review Queue*: 'Show me pending claims in review queue'\n• *Review claim*: 'Approve claim c37d5ff0 with reason: Valid documents verified'\n• *Scheme Budget*: 'What is the remaining available budget?'\n• *Policy search*: 'What are the documentation rules for flood claims?'\n"
          : user.role === "admin"
            ? "• *Scheme Budget*: 'Show total scheme budget and payout reserves'\n• *Update Budget*: 'Allocate 8000000 to relief scheme budget'\n• *Review Queue*: 'Show active claims in queue'\n• *Policy Ask*: 'Search policy section on income verification'\n"
            : "• *Audit Vault*: 'Show platform safety metrics and confidence trends'\n• *Review Queue*: 'Show pending claims in review'\n"
    }\n• */logout*: Disconnect your WhatsApp session`;

    return {
      reply: helpMsg,
      user,
      toolsUsed: [],
      isAuthenticated: true,
    };
  }

  // 5. Intelligent Tool Routing & Execution via MiMo LLM
  const allowedTools = getToolsForRole(user.role);
  const toolsUsed: string[] = [];

  // Direct tool invocation mapping for fast natural language matching
  let toolToRun: { tool: WhatsAppToolDefinition; args: Record<string, unknown> } | null = null;

  if (/claim|status|payout|payment|application|grant/i.test(lower) && !/new|apply|start|create|draft|review|queue/i.test(lower)) {
    const t = allowedTools.find(x => x.name === "get_my_claims");
    if (t) toolToRun = { tool: t, args: {} };
  } else if (/apply|new claim|start claim|draft|need aid|need relief|file/i.test(lower)) {
    const t = allowedTools.find(x => x.name === "create_claim_draft");
    if (t) {
      const incomeMatch = text.match(/(\d+[\d,]*)\s*(?:pkr|rupees|income|\/mo)?/i);
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
  } else if (/policy|rule|criteria|eligible|eligibility|cap|allowed|section/i.test(lower)) {
    const t = allowedTools.find(x => x.name === "ask_policy");
    if (t) toolToRun = { tool: t, args: { question: text } };
  } else if (/scam|fraud|fake|suspicious|phishing|lottery|raast|sms|link/i.test(lower)) {
    const t = allowedTools.find(x => x.name === "check_scam");
    if (t) toolToRun = { tool: t, args: { message: text } };
  } else if (/queue|pending|in review|desk/i.test(lower) && (user.role === "officer" || user.role === "admin" || user.role === "auditor")) {
    const t = allowedTools.find(x => x.name === "get_review_queue");
    if (t) toolToRun = { tool: t, args: {} };
  } else if (/budget|reserve|funds|allocation/i.test(lower) && (user.role === "officer" || user.role === "admin" || user.role === "auditor")) {
    const t = allowedTools.find(x => x.name === "get_scheme_budget");
    if (t) toolToRun = { tool: t, args: {} };
  } else if (/approve|reject|more proof/i.test(lower) && (user.role === "officer" || user.role === "admin")) {
    const t = allowedTools.find(x => x.name === "review_claim");
    if (t) {
      const decision = /approve/i.test(lower) ? "approve" : /reject/i.test(lower) ? "reject" : "more_proof";
      const idMatch = text.match(/([a-f0-9]{8}(?:-[a-f0-9]{4}){0,4})/i);
      toolToRun = {
        tool: t,
        args: {
          claim_id: idMatch ? idMatch[1] : "c37d5ff0-482a-4467-8c31-7e923e420d3b",
          decision,
          reason: text,
        },
      };
    }
  }

  let toolResultJson = "";
  if (toolToRun) {
    try {
      toolsUsed.push(toolToRun.tool.name);
      const res = await toolToRun.tool.execute(user, toolToRun.args);
      toolResultJson = JSON.stringify(res);
    } catch (err) {
      toolResultJson = JSON.stringify({ error: err instanceof Error ? err.message : "Tool failed" });
    }
  }

  // 6. Synthesize final answer via MiMo
  try {
    const systemPrompt = `You are the Relief Assist WhatsApp Assistant for Pakistan's emergency cash relief system.
The user is talking to you on WhatsApp.
User details:
- Name: ${user.name}
- Role: ${user.role} (${user.role === "officer" ? "Reviewer" : user.role})
- Citizen ID: ${user.citizenId || "None"}

Formatting rules:
- Format specifically for WhatsApp: use *bold* for emphasis, bullet points with •, and clean concise paragraphs.
- Keep responses friendly, empathetic, clear, and reassuring.
- Include numbers formatted nicely (PKR with commas).
- If tool results are provided below, use the facts from the tool results accurately. Do not invent fake claims or figures.
- Conclude with a helpful next action if applicable.`;

    const mimoInput = `User Message: "${text}"
${toolResultJson ? `Tool Executed: ${toolToRun?.tool.name}\nTool Output: ${toolResultJson}` : `No tool was triggered directly.`}

Please provide the direct WhatsApp response to the user.`;

    const mimoResponse = await askMimo(systemPrompt, mimoInput);
    if (mimoResponse && mimoResponse.trim().length > 0) {
      return {
        reply: mimoResponse.trim(),
        user,
        toolsUsed,
        isAuthenticated: true,
      };
    }
  } catch {
    // If MiMo is offline, formulate graceful deterministic response
  }

  // Graceful formatted fallback if MiMo is offline
  let fallbackReply = "";
  if (toolToRun && toolResultJson) {
    const data = JSON.parse(toolResultJson);
    if (toolToRun.tool.name === "get_my_claims") {
      const list = data.claims as Array<Record<string, unknown>>;
      fallbackReply = `📋 *Your Relief Claims*\n\nFound *${data.count}* active claim(s):\n\n` +
        list.map((c, i) =>
          `*${i + 1}. ${c.notes || "Emergency Relief Grant"}*\n• Status: *${String(c.status).toUpperCase()}* ${c.funding_status === "awaiting_funds" ? "(Awaiting Funds)" : ""}\n• Aid Amount: *PKR ${new Intl.NumberFormat("en-PK").format(Number(c.amount_pkr || 0))}*\n• Household: ${c.household_size || 1} people\n• Ref: #${String(c.id).slice(0, 8)}`
        ).join("\n\n");
    } else if (toolToRun.tool.name === "create_claim_draft") {
      fallbackReply = `✅ *Claim Draft Created*\n\n${data.message}\n\nYou can review details or attach documents in your Relief Assist web dashboard anytime.`;
    } else if (toolToRun.tool.name === "ask_policy") {
      fallbackReply = `📖 *Policy Information*\n\n${data.answer}\n\n*Official Citations:* ${data.citations?.map((c: { code: string; title: string }) => `[${c.code}: ${c.title}]`).join(", ") || "Rule v2"}`;
    } else if (toolToRun.tool.name === "check_scam") {
      fallbackReply = `🛡️ *Scam Shield Analysis*\n\nVerdict: *${String(data.classification).toUpperCase()}* (${data.confidence}% confidence)\n\n• Analysis: ${data.explanation}\n${data.red_flags?.length ? `• Red Flags: ${data.red_flags.join(", ")}` : "• No phishing indicators found."}`;
    } else if (toolToRun.tool.name === "get_review_queue") {
      const claims = data.claims as Array<Record<string, unknown>>;
      fallbackReply = `📋 *Officer Review Queue*\n\nFound *${data.count}* claims awaiting review:\n\n` +
        claims.map(c => `• *${c.applicant}* · PKR ${new Intl.NumberFormat("en-PK").format(Number(c.amount_pkr))} (AI Confidence: ${c.ai_confidence}%)\n  ID: #${String(c.id).slice(0, 8)} · Status: ${c.status}`).join("\n");
    } else if (toolToRun.tool.name === "get_scheme_budget") {
      fallbackReply = `💰 *Scheme Budget Overview*\n\n• Total Budget: *PKR ${new Intl.NumberFormat("en-PK").format(data.total_budget_pkr)}*\n• Available Funds: *PKR ${new Intl.NumberFormat("en-PK").format(data.available_pkr)}*\n• Reserved: *PKR ${new Intl.NumberFormat("en-PK").format(data.reserved_pkr)}*\n• Paid Out: *PKR ${new Intl.NumberFormat("en-PK").format(data.paid_pkr)}*\n• Awaiting Claims: *${data.awaiting_claims}*`;
    } else {
      fallbackReply = `✅ *Action Processed*\n\n${data.message || JSON.stringify(data)}`;
    }
  } else {
    fallbackReply = `🤖 *Relief Assist WhatsApp Bot*\n\nHello *${user.name}*! I am your AI relief assistant.\n\nYou can ask me to:\n• Check your claims and payout status\n• File a new relief application\n• Ask about disaster relief policies & criteria\n• Check an SMS for fraud or scam\n\nType your request or type */help* for more options.`;
  }

  return {
    reply: fallbackReply,
    user,
    toolsUsed,
    isAuthenticated: true,
  };
}
