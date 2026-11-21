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

    // 1. Sign up user in Supabase Auth
    const { data: authData, error: authError } = await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          role,
        },
      },
    });

    if (authError || !authData.user) {
      console.error("Sign-up auth error:", authError?.message);
      throw new ApiError(400, authError?.message || "Could not register user.");
    }

    // Automatically sign in the user immediately so no confirmation email or waiting is required
    const { error: signInError } = await client.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      console.warn("Auto sign-in notice:", signInError.message);
    }

    const userId = authData.user.id;

    // 2. Staff roles require admin verification; citizens and shopkeepers become active immediately
    const isStaffRole = ["helper", "officer", "auditor"].includes(role);
    const initialStatus = isStaffRole ? "pending_approval" : "active";

    // 3. Upsert profile in public.profiles
    const { error: profileError } = await client
      .from("profiles")
      .upsert({
        id: userId,
        email,
        full_name: fullName,
        role: role as Role,
        phone: phone || null,
        locale,
        status: initialStatus,
      });

    if (profileError) {
      console.error("Profile insert error:", profileError.message);
      throw new ApiError(500, "Could not initialize user profile.");
    }

    // 4. If citizen, create default synthetic citizen record if none exists
    if (role === "citizen") {
      const cnicTail = Math.floor(100 + Math.random() * 900);
      await client.from("citizens").insert({
        owner_id: userId,
        cnic_mock: `35201-MOCK-${cnicTail}`,
        full_name: fullName,
        name_phonetic: fullName.toLowerCase().replace(/[^a-z0-9]/g, "-"),
        household_size: 4,
        monthly_income_mock: 22000,
        phone: phone || `0300-${cnicTail}000`,
        village_area: "Darya Colony",
      });
    }

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
