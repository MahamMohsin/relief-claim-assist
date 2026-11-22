import { NextResponse } from "next/server";
import { gateway } from "@/src/lib/server";
import type { Profile } from "@/src/lib/contracts";
import { processIncomingWhatsAppMessage } from "@/src/lib/whatsapp/agent";
import { getRecentWhatsAppMessages, getWhatsAppAdminState, recordWhatsAppMessage } from "@/src/lib/whatsapp/server";

export async function GET(request: Request) {
  let profile: Profile | null = null;
  try {
    profile = await gateway<Profile>("profile");
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (profile?.role !== "admin") {
    return NextResponse.json(
      { error: "Only administrators can view the Live WhatsApp Messages Feed." },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 30)));
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

    const adminState = await getWhatsAppAdminState();
    const botPhone = adminState.adminPhone || "whatsapp-official-bot";

    // 1. Record inbound message
    recordWhatsAppMessage({
      direction: "inbound",
      from,
      to: botPhone,
      text,
    });

    // 2. Process message through WhatsApp agent & role tools
    const result = await processIncomingWhatsAppMessage(from, text);

    // 3. Record outbound bot response
    recordWhatsAppMessage({
      direction: "outbound",
      from: botPhone,
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
