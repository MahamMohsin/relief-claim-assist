import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/utils/supabase/env";
import { apiError, ApiError } from "@/src/lib/server";

export async function GET(request: Request) {
  try {
    const supplied_key = request.headers.get("x-api-key");
    if (!supplied_key || supplied_key.length > 200) throw new ApiError(401, "A valid x-api-key is required.");
    const { url, key } = getSupabaseEnv();
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.rpc("relief_partner", { action: "scheme:read", supplied_key });
    if (error) throw new ApiError(502, "Scheme registry unavailable.");
    if (data?.error) throw new ApiError(data.status, data.error);
    return Response.json(data);
  } catch (error) {
    return apiError(error);
  }
}
