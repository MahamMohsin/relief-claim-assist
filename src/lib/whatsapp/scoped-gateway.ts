import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/utils/supabase/env";
import { personas, type Persona, type Role } from "@/src/lib/contracts";

export type ScopedUserIdentity = {
  userId: string;
  name: string;
  role: Role;
  citizenId: string | null;
  persona?: Persona | "custom";
  email?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  onTokensRefreshed?: (tokens: { accessToken: string; refreshToken: string }) => void;
};

const DEMO_EMAIL_BY_PERSONA: Record<Persona, string> = {
  fatima: "fatima@relief-demo.example",
  zainab: "zainab@relief-demo.example",
  tariq: "tariq@relief-demo.example",
  bilal: "bilal@relief-demo.example",
  sana: "sana@relief-demo.example",
  kamran: "kamran@relief-demo.example",
};

export function inferDemoPersona(identity: {
  email?: string | null;
  name?: string | null;
  role?: Role;
  persona?: string | null;
}): Persona | null {
  if (identity.persona && identity.persona in personas) {
    return identity.persona as Persona;
  }
  const email = (identity.email || "").toLowerCase().trim();
  for (const [slug, demoEmail] of Object.entries(DEMO_EMAIL_BY_PERSONA) as [Persona, string][]) {
    if (email === demoEmail) return slug;
  }
  const lowerName = (identity.name || "").toLowerCase();
  if (lowerName.includes("fatima")) return "fatima";
  if (lowerName.includes("zainab")) return "zainab";
  if (lowerName.includes("tariq")) return "tariq";
  if (lowerName.includes("bilal")) return "bilal";
  if (lowerName.includes("sana")) return "sana";
  if (lowerName.includes("kamran")) return "kamran";
  return null;
}

/**
 * Executes a `relief_gateway` RPC call using a completely isolated, non-persisted
 * Supabase client authenticated STRICTLY as `user`.
 *
 * This guarantees background WhatsApp Agent pollers and Google Messages SMS sessions
 * NEVER share sessions or cross-contaminate data between personas (e.g. Fatima vs Tariq vs Zainab).
 */
export async function scopedGateway<T>(
  user: ScopedUserIdentity,
  action: string,
  args: object = {},
): Promise<T> {
  const { url, key } = getSupabaseEnv();
  const proof = process.env.RELIEF_GATEWAY_SECRET;
  if (!proof) {
    throw new Error("The relief database gateway secret is not configured.");
  }

  // Dedicated per-call client with zero shared storage/session state
  const client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  let authenticated = false;

  // 1. Try stored refresh token first (works for both custom registered users & demo users)
  if (user.refreshToken) {
    const { data, error } = await client.auth.refreshSession({
      refresh_token: user.refreshToken,
    });
    if (!error && data.session) {
      authenticated = true;
      if (user.onTokensRefreshed && data.session.refresh_token && data.session.access_token) {
        user.onTokensRefreshed({
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
        });
      }
    }
  }

  // 2. Try stored access + refresh session directly
  if (!authenticated && user.accessToken && user.refreshToken) {
    const { data, error } = await client.auth.setSession({
      access_token: user.accessToken,
      refresh_token: user.refreshToken,
    });
    if (!error && data.session) {
      authenticated = true;
    }
  }

  // 3. Fallback for demo persona accounts using RELIEF_DEMO_PASSWORD on isolated client
  if (!authenticated) {
    const demoPersona = inferDemoPersona(user);
    const demoPassword = process.env.RELIEF_DEMO_PASSWORD;
    const demoEmail =
      user.email && user.email.endsWith("@relief-demo.example")
        ? user.email
        : demoPersona
          ? DEMO_EMAIL_BY_PERSONA[demoPersona]
          : null;

    if (demoEmail && demoPassword) {
      const { data, error } = await client.auth.signInWithPassword({
        email: demoEmail,
        password: demoPassword,
      });
      if (!error && data.session) {
        authenticated = true;
        if (user.onTokensRefreshed && data.session.refresh_token && data.session.access_token) {
          user.onTokensRefreshed({
            accessToken: data.session.access_token,
            refreshToken: data.session.refresh_token,
          });
        }
      }
    }
  }

  if (!authenticated) {
    throw new Error(
      `Your authenticated session for ${user.name} has expired. Please open Relief Assist and reconnect your key.`,
    );
  }

  const { data, error } = await client.rpc("relief_gateway", { action, args, proof });
  if (error) {
    throw new Error(error.message || `Gateway action '${action}' failed.`);
  }
  if (data && typeof data === "object" && "status" in data && "error" in data && typeof (data as { error: unknown }).error === "string") {
    throw new Error((data as { error: string }).error);
  }
  return data as T;
}
