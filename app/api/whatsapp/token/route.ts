import { NextResponse } from "next/server";
import { gateway } from "@/src/lib/server";
import type { Profile } from "@/src/lib/contracts";
import { getLinkedPhoneForUser, getUserSessionToken, resetUserSessionToken } from "@/src/lib/whatsapp/session";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const queryPersona = url.searchParams.get("persona");

    let profile: Profile | null = null;
    try {
      profile = await gateway<Profile>("profile");
    } catch {
      // Offline or mock
    }

    const userId = profile?.id || queryPersona || "fatima";
    const token = getUserSessionToken(userId, profile ?? undefined);
    const linkedPhone = getLinkedPhoneForUser(userId);

    return NextResponse.json({
      userId,
      token,
      linkedPhone,
      isLinked: Boolean(linkedPhone),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get WhatsApp token." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { persona?: string };
    let profile: Profile | null = null;
    try {
      profile = await gateway<Profile>("profile");
    } catch {
      // Offline or mock
    }

    const userId = profile?.id || body.persona || "fatima";
    const newToken = resetUserSessionToken(userId, profile ?? undefined);

    return NextResponse.json({
      userId,
      token: newToken,
      linkedPhone: null,
      isLinked: false,
      message: "Session token reset successfully. Previous session disconnected.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to reset WhatsApp token." },
      { status: 500 }
    );
  }
}
