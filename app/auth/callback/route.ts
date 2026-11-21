import { NextResponse } from "next/server";
import { authClient } from "@/src/lib/server";
import { authOrigin } from "@/src/lib/auth-origin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = authOrigin(request);
  const redirect = (path: string) => {
    const response = NextResponse.redirect(new URL(path, origin));
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  };
  const code = url.searchParams.get("code");
  const flowId = url.searchParams.get("sb_flow_id");
  const tokenHash = url.searchParams.get("token_hash");

  try {
    if (tokenHash && url.searchParams.get("type") === "email") {
      const client = await authClient(AbortSignal.timeout(12000));
      const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
      return redirect(error ? "/login?confirmation=failed" : "/");
    }
    if (code) {
      const client = await authClient(AbortSignal.timeout(12000));
      const { error } = await client.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
      if (!error) return redirect("/");
      if (error.name === "AuthPKCECodeVerifierMissingError") return redirect("/login?confirmation=signin");
      console.warn("Signup confirmation exchange", error.code ?? error.name);
    }
  } catch {
    console.warn("Signup confirmation could not reach Supabase Auth");
  }
  return redirect("/login?confirmation=failed");
}
