import { NextResponse } from "next/server";
import { authClient, gateway } from "@/src/lib/server";
import type { Profile } from "@/src/lib/contracts";
import {
  ensureAgentPollers,
  getAgentKeyInfo,
  refreshStoredAgentOwnerContext,
  removeAgentApiKey,
  runAgentTestMessage,
  saveAgentApiKey,
  testAgentApiKey,
  type SaveAgentKeyProfile,
} from "@/src/lib/whatsapp/official-agent";

async function requireAuthenticatedOwner(): Promise<SaveAgentKeyProfile> {
  const profile = await gateway<Profile>("profile");
  const client = await authClient();
  const [{ data: userData }, { data: sessionData }] = await Promise.all([
    client.auth.getUser(),
    client.auth.getSession(),
  ]);

  return {
    userId: profile.id,
    userName: profile.full_name,
    userRole: profile.role,
    citizenId: profile.citizen_id,
    email: userData.user?.email ?? null,
    accessToken: sessionData.session?.access_token ?? null,
    refreshToken: sessionData.session?.refresh_token ?? null,
  };
}

export async function GET() {
  try {
    ensureAgentPollers();
    const owner = await requireAuthenticatedOwner();

    // Keep owner's stored context & refresh token synced if they already have a key
    refreshStoredAgentOwnerContext(owner);

    const info = getAgentKeyInfo(owner.userId);
    return NextResponse.json({
      ...info,
      personaId: owner.userId,
      ownerName: owner.userName,
      ownerRole: owner.userRole,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Authentication required." },
      { status: 401 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const owner = await requireAuthenticatedOwner();

    const body = (await request.json().catch(() => ({}))) as {
      action?: "connect" | "disconnect" | "test" | "test_chat";
      apiKey?: string;
      agentName?: string;
      text?: string;
    };

    const action = body.action || "connect";

    if (action === "disconnect") {
      removeAgentApiKey(owner.userId);
      return NextResponse.json({
        success: true,
        personaId: owner.userId,
        isConfigured: false,
        message: `WhatsApp Agent API key removed for ${owner.userName}.`,
      });
    }

    if (action === "test") {
      const apiKey = body.apiKey?.trim();
      if (!apiKey) {
        return NextResponse.json({ error: "API key is required." }, { status: 400 });
      }
      const test = await testAgentApiKey(apiKey);
      return NextResponse.json(test);
    }

    if (action === "test_chat") {
      const text = body.text?.trim();
      if (!text) {
        return NextResponse.json({ error: "Message text is required." }, { status: 400 });
      }
      const isVoice = Boolean((body as { isVoice?: boolean }).isVoice);
      const preferredLocale = (body as { locale?: "en" | "ur" }).locale;
      const result = await runAgentTestMessage(owner, text, { isVoice, preferredLocale });
      return NextResponse.json({
        success: true,
        ...result,
      });
    }

    // Default: connect strictly for this authenticated user
    const apiKey = body.apiKey?.trim();
    if (!apiKey) {
      return NextResponse.json({ error: "Please enter your WhatsApp Agent API key." }, { status: 400 });
    }

    const result = await saveAgentApiKey(owner, apiKey, body.agentName || "Ali");
    if (!result.success) {
      return NextResponse.json({ error: result.error || "Invalid API key" }, { status: 400 });
    }

    const updated = getAgentKeyInfo(owner.userId);
    return NextResponse.json({
      ...updated,
      success: true,
      personaId: owner.userId,
      ownerName: owner.userName,
      ownerRole: owner.userRole,
      message: `WhatsApp Agent connected strictly to ${owner.userName} (${owner.userRole}).`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save agent key." },
      { status: 500 }
    );
  }
}
