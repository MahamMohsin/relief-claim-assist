import { ApiError, gateway } from "@/src/lib/server";
import type { Profile } from "@/src/lib/contracts";

export async function getProfile() {
  try { return await gateway<Profile>("profile"); }
  catch (error) {
    if (error instanceof ApiError && [401, 403, 503].includes(error.status)) return null;
    throw error;
  }
}
