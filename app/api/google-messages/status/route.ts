import { NextResponse } from "next/server";
import { gateway } from "@/src/lib/server";
import type { Profile } from "@/src/lib/contracts";
import {
  getAdminGoogleMessagesState,
  getPublicSmsGatewayInfo,
} from "@/src/lib/google-messages/server";

export async function GET() {
  let profile: Profile | null = null;
  try {
    profile = await gateway<Profile>("profile");
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  if (profile.role === "admin") {
    return NextResponse.json({
      isAdmin: true,
      ...getAdminGoogleMessagesState(),
    });
  }

  // Non-admins ONLY receive safe gateway availability & admin's SMS number — NEVER QR code or other users' sessions
  return NextResponse.json({
    isAdmin: false,
    ...getPublicSmsGatewayInfo(),
  });
}
