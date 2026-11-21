"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TegakiRenderer } from "tegaki/react";
import script from "tegaki/fonts/parisienne";
import s from "./WelcomeOverlay.module.css";

interface WelcomeOverlayProps {
  name: string;
  onDismiss: () => void;
  /** `'always'` draws the greeting finished instead of writing it out. */
  reducedMotion?: "never" | "user" | "always";
}

/** How long the finished greeting stays on screen before the overlay closes. */
const HOLD_MS = 1400;
/** Backstop so a font that never loads can never strand the user here. */
const MAX_MS = 12000;
/** Matches the fade-out in the stylesheet. */
const FADE_MS = 420;

/** Each letter starts before the previous one has finished, so the greeting
 *  flows like real handwriting instead of drawing one letter at a time. */
const TIME = { mode: "uncontrolled", speed: 1.6 } as const;
const TIMING = {
  stagger: { advance: "45%" },
  wordGap: 0.03,
  lineGap: 0.1,
  strokeEasing: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
} as const;

export function WelcomeOverlay({ name, onDismiss, reducedMotion = "user" }: WelcomeOverlayProps) {
  const [leaving, setLeaving] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const closed = useRef(false);
  const timers = useRef<number[]>([]);
  // The parent re-renders often, so the dismiss callback is read through a ref
  // rather than captured: capturing it would restart the timers on every
  // re-render and the greeting would never let go of the screen.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  const later = useCallback((fn: () => void, delay: number) => {
    const id = window.setTimeout(fn, delay);
    timers.current.push(id);
    return id;
  }, []);

  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    setLeaving(true);
    later(() => dismissRef.current(), FADE_MS);
  }, [later]);

  // The greeting holds once the handwriting is finished, then it fades away.
  const handleComplete = useCallback(() => {
    later(close, HOLD_MS);
  }, [close, later]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") close();
    };
    window.addEventListener("keydown", onKeyDown);
    later(close, MAX_MS);
    const pending = timers.current;
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      pending.forEach((id) => window.clearTimeout(id));
    };
  }, [close, later]);

  // The greeting lives outside the blurred workspace, so it is portalled to the
  // body rather than nested inside the app it covers.
  useEffect(() => {
    setHost(document.body);
  }, []);

  const greeting = (
    <div
      className={leaving ? `${s.overlay} ${s.leaving}` : s.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={`Welcome ${name}`}
      onClick={close}
    >
      <div className={s.stage}>
        <TegakiRenderer
          font={script}
          className={s.ink}
          onComplete={handleComplete}
          reducedMotion={reducedMotion}
          time={TIME}
          timing={TIMING}
        >
          {`Welcome ${name}`}
        </TegakiRenderer>
        <p className={s.hint}>Click anywhere to continue</p>
      </div>
    </div>
  );

  return host ? createPortal(greeting, host) : null;
}
