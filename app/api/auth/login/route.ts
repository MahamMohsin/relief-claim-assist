import { z } from "zod";
import { authClient, apiError, readJson, ApiError } from "@/src/lib/server";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password is required"),
});

export async function POST(request: Request) {
  try {
    const parsed = loginSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      throw new ApiError(400, "Please provide an email and password.");
    }

    const { email, password } = parsed.data;
    const client = await authClient();

    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.user) {
      console.error("Login auth error:", error?.message);
      throw new ApiError(401, error?.message || "Invalid email or password.");
    }

    return Response.json({
      ok: true,
      user: data.user,
    });
  } catch (error) {
    return apiError(error);
  }
}
