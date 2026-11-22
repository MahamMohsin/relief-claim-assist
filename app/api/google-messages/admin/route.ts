import { NextResponse } from "next/server";
import { gateway } from "@/src/lib/server";
import type { Profile } from "@/src/lib/contracts";
import {
  getAdminGoogleMessagesState,
  recordSmsMessage,
  refreshGoogleMessagesQr,
  sendOutboundSmsViaGateway,
  setAdminSmsNumber,
  setAutoPromptUnknown,
  startGoogleMessagesGateway,
  stopGoogleMessagesGateway,
} from "@/src/lib/google-messages/server";

async function requireAdmin(): Promise<Profile | NextResponse> {
  try {
    const profile = await gateway<Profile>("profile");
    if (profile.role !== "admin") {
      return NextResponse.json(
        { error: "Only administrators can manage Google Messages pairing." },
        { status: 403 }
      );
    }
    return profile;
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
}

export async function GET() {
  const adminOrErr = await requireAdmin();
  if (adminOrErr instanceof NextResponse) return adminOrErr;

  return NextResponse.json(getAdminGoogleMessagesState());
}

export async function POST(request: Request) {
  const adminOrErr = await requireAdmin();
  if (adminOrErr instanceof NextResponse) return adminOrErr;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?:
        | "pair"
        | "open_window"
        | "refresh_qr"
        | "set_phone"
        | "toggle_auto_prompt"
        | "stop"
        | "disconnect"
        | "send_sms";
      phone?: string;
      autoPromptUnknown?: boolean;
      to?: string;
      text?: string;
    };

    const action = body.action || "pair";

    switch (action) {
      case "pair": {
        const state = startGoogleMessagesGateway({
          visible: false,
          adminPhone: body.phone,
        });
        return NextResponse.json({ success: true, ...state });
      }

      case "open_window": {
        const state = startGoogleMessagesGateway({
          visible: true,
          adminPhone: body.phone,
        });
        return NextResponse.json({ success: true, ...state });
      }

      case "refresh_qr": {
        const state = refreshGoogleMessagesQr();
        return NextResponse.json({ success: true, ...state });
      }

      case "set_phone": {
        const state = setAdminSmsNumber(body.phone || "");
        return NextResponse.json({ success: true, ...state });
      }

      case "toggle_auto_prompt": {
        const state = setAutoPromptUnknown(Boolean(body.autoPromptUnknown));
        return NextResponse.json({ success: true, ...state });
      }

      case "stop": {
        const state = stopGoogleMessagesGateway(false);
        return NextResponse.json({ success: true, ...state });
      }

      case "disconnect": {
        const state = stopGoogleMessagesGateway(true);
        return NextResponse.json({ success: true, ...state });
      }

      case "send_sms": {
        const to = body.to?.trim() || "";
        const text = body.text?.trim() || "";
        if (!to || !text) {
          return NextResponse.json({ error: "Recipient and message text are required." }, { status: 400 });
        }
        const res = sendOutboundSmsViaGateway(to, text);
        if (!res.queued) {
          return NextResponse.json({ error: res.error || "Could not send SMS." }, { status: 400 });
        }
        const state = getAdminGoogleMessagesState();
        recordSmsMessage({
          direction: "outbound",
          from: state.adminPhone || "Admin Google Messages",
          to,
          text,
          source: "google_messages_live",
        });
        return NextResponse.json({ success: true, queued: true });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to manage Google Messages gateway." },
      { status: 500 }
    );
  }
}
