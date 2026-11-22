import { NextResponse } from "next/server";
import { gateway } from "@/src/lib/server";
import type { Profile } from "@/src/lib/contracts";
import { processDirectChannelMessage } from "@/src/lib/whatsapp/agent";
import {
  getAdminGoogleMessagesState,
  getRecentSmsMessages,
  recordSmsMessage,
} from "@/src/lib/google-messages/server";

/**
 * Admin-only Live SMS Messages Feed
 */
export async function GET(request: Request) {
  let profile: Profile | null = null;
  try {
    profile = await gateway<Profile>("profile");
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (profile.role !== "admin") {
    return NextResponse.json(
      { error: "Only administrators can view the Live SMS Messages Feed." },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 40)));
  return NextResponse.json({ messages: getRecentSmsMessages(limit) });
}

/**
 * Inbound SMS receiver from:
 *   1. Local Playwright Google Messages gateway daemon (source: "google_messages_live")
 *   2. Admin SMS simulator in dashboard (source: "simulator")
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      from?: string;
      threadId?: string;
      text?: string;
      source?: "google_messages_live" | "simulator";
    };

    const from = (body.from || "").trim();
    const text = (body.text || "").trim();
    const source = body.source === "simulator" ? "simulator" : "google_messages_live";

    if (!from || !text) {
      return NextResponse.json({ error: "Sender and SMS text are required." }, { status: 400 });
    }

    const gmState = getAdminGoogleMessagesState();
    const gatewayNumber = gmState.adminPhone || "Google Messages Gateway";

    // For live real-phone SMS: only auto-reply to unauthenticated senders if they send /login, /start, /help, /relief
    // (unless admin explicitly toggled autoPromptUnknown ON) so personal texts & OTPs aren't spammed.
    const requireCommandWhenUnauth =
      source === "google_messages_live" && !gmState.autoPromptUnknown;

    const result = await processDirectChannelMessage(from, text, {
      channel: "sms",
      requireCommandWhenUnauth,
    });

    // Only log SMS messages that actually interact with Relief Assist (authenticated users or explicit commands / simulator)
    if (result.shouldReply || result.isAuthenticated || source === "simulator") {
      recordSmsMessage({
        direction: "inbound",
        from,
        to: gatewayNumber,
        text,
        authenticatedUser: result.user?.name ?? null,
        authenticatedRole: result.user?.role ?? null,
        source,
      });

      if (result.shouldReply && result.reply) {
        recordSmsMessage({
          direction: "outbound",
          from: gatewayNumber,
          to: from,
          text: result.reply,
          authenticatedUser: result.user?.name ?? null,
          authenticatedRole: result.user?.role ?? null,
          toolsUsed: result.toolsUsed,
          source,
        });
      }
    }

    return NextResponse.json({
      success: true,
      shouldReply: result.shouldReply,
      reply: result.reply,
      isAuthenticated: result.isAuthenticated,
      toolsUsed: result.toolsUsed,
      user: result.user
        ? {
            userId: result.user.userId,
            name: result.user.name,
            role: result.user.role,
          }
        : null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process inbound SMS." },
      { status: 500 }
    );
  }
}
