import { NextResponse } from "next/server";
import { gateway } from "@/src/lib/server";
import type { Profile } from "@/src/lib/contracts";
import {
  ensureAgentPollers,
  getAgentKeyInfo,
  removeAgentApiKey,
  saveAgentApiKey,
  testAgentApiKey,
} from "@/src/lib/whatsapp/official-agent";

export async function GET(request: Request) {
  try {
    ensureAgentPollers();
    const url = new URL(request.url);
    const queryPersona = url.searchParams.get("persona");

    let profile: Profile | null = null;
    try {
      profile = await gateway<Profile>("profile");
    } catch {}

    const personaId = profile?.id || queryPersona || "fatima";
    const info = getAgentKeyInfo(personaId);

    return NextResponse.json({
      personaId,
      ...info,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load agent key info." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: "connect" | "disconnect" | "test";
      apiKey?: string;
      agentName?: string;
      persona?: string;
    };

    let profile: Profile | null = null;
    try {
      profile = await gateway<Profile>("profile");
    } catch {}

    const personaId = profile?.id || body.persona || "fatima";
    const action = body.action || "connect";

    if (action === "disconnect") {
      removeAgentApiKey(personaId);
      return NextResponse.json({
        success: true,
        isConfigured: false,
        message: "WhatsApp Agent API key removed.",
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

    // Default: connect
    const apiKey = body.apiKey?.trim();
    if (!apiKey) {
      return NextResponse.json({ error: "Please enter your WhatsApp Agent API key." }, { status: 400 });
    }

    const result = await saveAgentApiKey(personaId, apiKey, body.agentName || "Ali");
    if (!result.success) {
      return NextResponse.json({ error: result.error || "Invalid API key" }, { status: 400 });
    }

    const updated = getAgentKeyInfo(personaId);
    return NextResponse.json({
      success: true,
      personaId,
      ...updated,
      message: "WhatsApp Agent successfully connected! You can now chat directly with your agent in WhatsApp.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save agent key." },
      { status: 500 }
    );
  }
}
