import { NextResponse } from "next/server";
import { processIncomingWhatsAppMessage } from "@/src/lib/whatsapp/agent";
import { getRecentWhatsAppMessages, recordWhatsAppMessage } from "@/src/lib/whatsapp/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 30);
  const messages = getRecentWhatsAppMessages(limit);
  return NextResponse.json({ messages });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      from?: string;
      fromPhone?: string;
      text?: string;
      message?: string;
    };

    const from = body.from || body.fromPhone || "+92 301 5551234";
    const text = (body.text || body.message || "").trim();

    if (!text) {
      return NextResponse.json({ error: "Message text is required." }, { status: 400 });
    }

    // 1. Record inbound message
    recordWhatsAppMessage({
      direction: "inbound",
      from,
      to: "+92 300 8765432",
      text,
    });

    // 2. Process message through WhatsApp agent & role tools
    const result = await processIncomingWhatsAppMessage(from, text);

    // 3. Record outbound bot response
    recordWhatsAppMessage({
      direction: "outbound",
      from: "+92 300 8765432",
      to: from,
      text: result.reply,
      toolsUsed: result.toolsUsed,
    });

    return NextResponse.json({
      success: true,
      from,
      reply: result.reply,
      toolsUsed: result.toolsUsed,
      user: result.user,
      isAuthenticated: result.isAuthenticated,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process WhatsApp webhook." },
      { status: 500 }
    );
  }
}
