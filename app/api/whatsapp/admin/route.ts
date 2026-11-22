import { NextResponse } from "next/server";
import { connectAdminWhatsApp, disconnectAdminWhatsApp, getWhatsAppAdminState, refreshAdminPairingQr } from "@/src/lib/whatsapp/server";

export async function GET() {
  const state = await getWhatsAppAdminState();
  return NextResponse.json(state);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { action?: string; phone?: string };
    const action = body.action || "connect";

    let state;
    if (action === "disconnect") {
      state = await disconnectAdminWhatsApp();
    } else if (action === "refresh_qr") {
      state = await refreshAdminPairingQr();
    } else {
      const phone = body.phone?.trim();
      if (!phone) {
        return NextResponse.json(
          { error: "Phone number is required to pair admin WhatsApp." },
          { status: 400 }
        );
      }
      state = await connectAdminWhatsApp(phone);
    }

    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update WhatsApp admin state." },
      { status: 500 }
    );
  }
}
