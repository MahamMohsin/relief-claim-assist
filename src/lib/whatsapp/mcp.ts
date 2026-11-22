import { getRecentWhatsAppMessages, getWhatsAppAdminState, recordWhatsAppMessage } from "./server";
import { normalizePhone } from "./session";

/**
 * Standard MCP Tools specification matching `@muhammadmustafa18/whatsapp-mcp-server`
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

export const WHATSAPP_MCP_TOOLS: McpTool[] = [
  {
    name: "list_chats",
    description: "Recent WhatsApp conversations, newest first. Optional JID-prefix filter (e.g. 120363 for groups or country code).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum number of chats to return (default 20, max 100)" },
        prefix: { type: "string", description: "Optional JID prefix filter (e.g. '92' or '120363')" },
      },
    },
  },
  {
    name: "read_messages",
    description: "Last N messages from a specific WhatsApp chat or phone number.",
    inputSchema: {
      type: "object",
      properties: {
        chatJid: { type: "string", description: "WhatsApp JID or phone number (e.g. '+923001234567')" },
        limit: { type: "number", description: "Number of messages to retrieve (default 20)" },
      },
      required: ["chatJid"],
    },
  },
  {
    name: "search_messages",
    description: "Full-text search over message history with relevance ranking.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query string (e.g. 'claim', 'flood', 'approved')" },
        limit: { type: "number", description: "Maximum matching messages to return" },
      },
      required: ["query"],
    },
  },
  {
    name: "send_message",
    description: "Send a text message via WhatsApp to a phone number or JID.",
    inputSchema: {
      type: "object",
      properties: {
        recipient: { type: "string", description: "Recipient phone number or JID (e.g. '+923015551234')" },
        message: { type: "string", description: "Text content of the message to send" },
      },
      required: ["recipient", "message"],
    },
  },
];

export async function executeMcpTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const messages = getRecentWhatsAppMessages(100);

  switch (name) {
    case "list_chats": {
      const limit = Number(args.limit || 20);
      const prefix = String(args.prefix || "");
      const chatMap = new Map<string, { jid: string; lastMessage: string; timestamp: string }>();

      for (const m of messages) {
        const otherParty = m.direction === "inbound" ? m.from : m.to;
        if (prefix && !otherParty.includes(prefix)) continue;
        if (!chatMap.has(otherParty)) {
          chatMap.set(otherParty, { jid: otherParty, lastMessage: m.text, timestamp: m.timestamp });
        }
      }

      return Array.from(chatMap.values()).slice(0, limit);
    }

    case "read_messages": {
      const chatJid = normalizePhone(String(args.chatJid || ""));
      const limit = Number(args.limit || 20);
      return messages
        .filter(m => normalizePhone(m.from) === chatJid || normalizePhone(m.to) === chatJid)
        .slice(0, limit);
    }

    case "search_messages": {
      const query = String(args.query || "").toLowerCase();
      const limit = Number(args.limit || 20);
      return messages
        .filter(m => m.text.toLowerCase().includes(query))
        .slice(0, limit);
    }

    case "send_message": {
      const recipient = normalizePhone(String(args.recipient || ""));
      const message = String(args.message || "");
      const adminState = await getWhatsAppAdminState();
      const recorded = recordWhatsAppMessage({
        direction: "outbound",
        from: adminState.adminPhone || "whatsapp-official-bot",
        to: recipient,
        text: message,
      });
      return { success: true, messageId: recorded.id, timestamp: recorded.timestamp };
    }

    default:
      throw new Error(`Unknown WhatsApp MCP tool: ${name}`);
  }
}
