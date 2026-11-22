import { NextResponse } from "next/server";
import { authClient, gateway } from "@/src/lib/server";
import type { Profile } from "@/src/lib/contracts";
import { getLinkedPhoneForUser, getUserSessionToken, resetUserSessionToken } from "@/src/lib/whatsapp/session";

async function loadAuthenticatedUser() {
  const profile = await gateway<Profile>("profile");
  const client = await authClient();
  const [{ data: userData }, { data: sessionData }] = await Promise.all([
    client.auth.getUser(),
    client.auth.getSession(),
  ]);
  return {
    profile,
    email: userData.user?.email ?? null,
    accessToken: sessionData.session?.access_token ?? null,
    refreshToken: sessionData.session?.refresh_token ?? null,
  };
}

export async function GET() {
  try {
    const auth = await loadAuthenticatedUser();
    const { profile } = auth;

    const token = getUserSessionToken(profile.id, {
      full_name: profile.full_name,
      role: profile.role,
      citizen_id: profile.citizen_id,
      email: auth.email,
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
    });
    const linkedPhone = getLinkedPhoneForUser(profile.id);

    return NextResponse.json({
      userId: profile.id,
      name: profile.full_name,
      role: profile.role,
      token,
      linkedPhone,
      isLinked: Boolean(linkedPhone),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Authentication required to load your login key." },
      { status: 401 }
    );
  }
}

export async function POST() {
  try {
    const auth = await loadAuthenticatedUser();
    const { profile } = auth;

    const newToken = resetUserSessionToken(profile.id, {
      full_name: profile.full_name,
      role: profile.role,
      citizen_id: profile.citizen_id,
      email: auth.email,
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
    });

    return NextResponse.json({
      userId: profile.id,
      name: profile.full_name,
      role: profile.role,
      token: newToken,
      linkedPhone: null,
      isLinked: false,
      message: "Personal login key regenerated. Any previously linked SMS phone has been disconnected.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Authentication required to reset your login key." },
      { status: 401 }
    );
  }
}
