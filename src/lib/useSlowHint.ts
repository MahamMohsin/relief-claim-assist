"use client";

import { useEffect, useState } from "react";
import { SLOW_HINT_MS } from "@/src/lib/client";

export const SLOW_HINT_TEXT = "Taking longer than usual…";

/** True once `busy` has stayed on for SLOW_HINT_MS (8s). Resets when busy turns off. */
export function useSlowHint(busy: boolean) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) { setSlow(false); return; }
    const timer = window.setTimeout(() => setSlow(true), SLOW_HINT_MS);
    return () => window.clearTimeout(timer);
  }, [busy]);
  return slow;
}
