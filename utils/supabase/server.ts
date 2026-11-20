import { createServerClient } from "@supabase/ssr";
import type { cookies } from "next/headers";
import { getSupabaseEnv } from "./env";

export function createClient(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  const { url, key } = getSupabaseEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components have read-only cookies. The proxy persists refreshes.
        }
      },
    },
  });
}
