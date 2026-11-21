import { z } from "zod";
import { authClient, apiError, readJson, ApiError } from "@/src/lib/server";
import { authOrigin } from "@/src/lib/auth-origin";

const signupSchema = z.object({
  email: z.string().trim().optional(),
  demo: z.boolean().default(false),
  password: z.string().min(6, "Password must be at least 6 characters"),
  fullName: z.string().trim().min(2, "Full name is required").max(80),
  role: z.enum(["citizen", "helper", "shopkeeper", "officer", "auditor"] as const),
  phone: z.string().trim().optional(),
  locale: z.enum(["en", "ur"]).default("en"),
});

export async function POST(request: Request) {
  try {
    const parsed = signupSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      throw new ApiError(400, firstIssue ? firstIssue.message : "Invalid registration input.");
    }

    const { email, password, fullName, role, phone, locale, demo } = parsed.data;
    const origin = new URL(authOrigin(request));
    const demoEnabled = process.env.RELIEF_DEMO_REGISTRATION === "true"
      && ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
    const timeout = AbortSignal.timeout(12000);
    const client = await authClient(AbortSignal.any([request.signal, timeout]));

    if (demo) {
      if (!demoEnabled || role !== "citizen") throw new ApiError(403, "Synthetic registration is available for local citizen accounts only.");
      if (new TextEncoder().encode(password).length > 72) throw new ApiError(400, "The demo password must be at most 72 bytes.");
      const proof = process.env.RELIEF_GATEWAY_SECRET;
      if (!proof) throw new ApiError(503, "Demo registration is temporarily unavailable.");
      const { data, error } = await client.rpc("relief_register_demo", { proof, display_name: fullName, password });
      if (data?.error) throw new ApiError(data.status, data.error);
      if (error || !data?.email) {
        console.error("Demo registration", error?.code);
        throw new ApiError(timeout.aborted ? 504 : 503, "Demo registration is temporarily unavailable. Try again.");
      }
      const signedIn = await client.auth.signInWithPassword({ email: data.email, password });
      const requiresSignIn = Boolean(signedIn.error || !signedIn.data.session);
      return Response.json({
        demoEmail: data.email,
        requiresSignIn,
        message: requiresSignIn
          ? "Demo account created. Sign in with this address and your chosen password."
          : "Demo account created. Save the sign-in address for later.",
      }, { status: 201 });
    }

    if (!email || !z.email().safeParse(email).success) throw new ApiError(400, "Enter a valid email address.");

    // 1. Sign up user in Supabase Auth (trigger automatically inserts into public.profiles & public.citizens)
    const { data: authData, error: authError } = await client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: new URL("/auth/callback", origin).href,
        data: {
          full_name: fullName,
          role,
          phone: phone || null,
          locale,
        },
      },
    });

    if (authError || !authData.user) {
      console.error("Sign-up auth error:", authError?.name, authError?.code, authError?.status);
      if (timeout.aborted) {
        throw new ApiError(504, "Signup timed out. Check your inbox before trying again.");
      }
      if (authError?.name === "AuthRetryableFetchError" || (authError?.status ?? 0) >= 500) {
        throw new ApiError(503, "Signup is temporarily unavailable. Check your inbox before trying again.");
      }
      if (authError?.code === "email_address_not_authorized") {
        throw new ApiError(400, "This Supabase project cannot send confirmation email to that address."
          + (demoEnabled ? " Use the synthetic demo account option to test registration." : ""));
      }
      throw new ApiError(authError?.status === 429 ? 429 : 400, authError?.message || "Could not register user.");
    }

    const userId = authData.user.id;
    const isStaffRole = ["helper", "officer", "auditor"].includes(role);
    const initialStatus = isStaffRole ? "pending_approval" : "active";

    return Response.json({
      ok: true,
      requiresEmailConfirmation: !authData.session,
      user: {
        id: userId,
        email,
        full_name: fullName,
        role,
        status: initialStatus,
      },
      message: !authData.session
        ? isStaffRole
          ? "Check your email for a confirmation link. Staff access also requires administrator approval."
          : "Check your email for a confirmation link to finish creating your account."
        : isStaffRole
        ? "Account submitted for administrator verification. You will be able to access the staff workspace once approved."
        : "Account created successfully.",
    });
  } catch (error) {
    return apiError(error);
  }
}
