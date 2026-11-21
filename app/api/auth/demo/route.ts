import { z } from "zod";
import { authClient, apiError, readJson, ApiError } from "@/src/lib/server";
import { personas } from "@/src/lib/contracts";

export async function POST(request: Request) {
  try {
    const body = z.object({ persona: z.enum(Object.keys(personas) as [keyof typeof personas, ...(keyof typeof personas)[]]) })
      .safeParse(await readJson(request));
    if (!body.success) throw new ApiError(400, "Choose a demo persona.");
    const password = process.env.RELIEF_DEMO_PASSWORD;
    if (!password) throw new ApiError(503, "Demo sign-in has not been configured.");
    const timeout = AbortSignal.timeout(10000);
    const client = await authClient(AbortSignal.any([request.signal, timeout]));
    const { error } = await client.auth.signInWithPassword({
      email: body.data.persona + "@relief-demo.example",
      password,
    });
    if (error) {
      console.error("Demo sign-in", error.code, error.status);
      if (timeout.aborted) throw new ApiError(504, "Demo sign-in took too long. Please try again.");
      throw new ApiError(503, "Demo sign-in is temporarily unavailable.");
    }
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE() {
  try {
    const { error } = await (await authClient()).auth.signOut({ scope: "local" });
    if (error) throw new ApiError(502, "Could not sign out. Try again.");
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
