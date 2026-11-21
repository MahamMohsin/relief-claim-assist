import { z } from "zod";
import { authClient, apiError, readJson, ApiError } from "@/src/lib/server";
import { type Role } from "@/src/lib/contracts";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, "Password must be at least 6 characters"),
  fullName: z.string().trim().min(2, "Full name is required"),
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

    const { email, password, fullName, role, phone, locale } = parsed.data;
    const client = await authClient();

    // 1. Sign up user in Supabase Auth (trigger automatically inserts into public.profiles & public.citizens)
    const { data: authData, error: authError } = await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role,
          phone: phone || null,
          locale,
        },
      },
    });

    if (authError || !authData.user) {
      console.error("Sign-up auth error:", authError?.message);
      throw new ApiError(400, authError?.message || "Could not register user.");
    }

    // 2. Automatically sign in the user immediately so session cookie is created
    const { error: signInError } = await client.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      console.warn("Auto sign-in notice:", signInError.message);
    }

    const userId = authData.user.id;
    const isStaffRole = ["helper", "officer", "auditor"].includes(role);
    const initialStatus = isStaffRole ? "pending_approval" : "active";

    return Response.json({
      ok: true,
      user: {
        id: userId,
        email,
        full_name: fullName,
        role,
        status: initialStatus,
      },
      message: isStaffRole
        ? "Account submitted for administrator verification. You will be able to access the staff workspace once approved."
        : "Account created successfully.",
    });
  } catch (error) {
    return apiError(error);
  }
}
