"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TegakiRenderer } from "tegaki/react";
import script from "tegaki/fonts/parisienne";
import s from "./WelcomeOverlay.module.css";

interface WelcomeOverlayProps {
  name: string;
  onDismiss: () => void;
}

/** How long the finished greeting stays on screen before the overlay closes. */
const HOLD_MS = 1600;
/** Backstop so a font that never loads can never strand the user here. */
const MAX_MS = 8000;
/** Matches the fade-out in the stylesheet. */
const FADE_MS = 420;

export function WelcomeOverlay({ name, onDismiss }: WelcomeOverlayProps) {
  const [leaving, setLeaving] = useState(false);
  const closed = useRef(false);
  const timers = useRef<number[]>([]);

  const later = useCallback((fn: () => void, delay: number) => {
    const id = window.setTimeout(fn, delay);
    timers.current.push(id);
    return id;
  }, []);

  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    setLeaving(true);
    later(onDismiss, FADE_MS);
  }, [later, onDismiss]);

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

  return (
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
          reducedMotion="user"
        >
          {`Welcome ${name}`}
        </TegakiRenderer>
        <p className={s.hint}>Click anywhere to continue</p>
      </div>
    </div>
  );
}
