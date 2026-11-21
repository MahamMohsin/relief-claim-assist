"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Sparkles } from "lucide-react";
import { cuaEngine, type CursorState } from "./cuaEngine";

export function AgentCursor() {
  const [state, setState] = useState<CursorState>({
    visible: false,
    x: 0,
    y: 0,
    clicking: false,
    ripple: null,
    label: "",
    tone: "active",
    spotlight: null,
  });

  useEffect(() => cuaEngine.subscribe(setState), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") cuaEngine.cancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="cua-overlay" aria-hidden="true">
      {/* Target Element Spotlight Ring */}
      <AnimatePresence>
        {state.visible && state.spotlight && (
          <motion.div
            key="cua-spotlight"
            className={"cua-spotlight tone-" + state.tone}
            initial={{
              opacity: 0,
              left: state.spotlight.left,
              top: state.spotlight.top,
              width: state.spotlight.width,
              height: state.spotlight.height,
              borderRadius: state.spotlight.radius,
              scale: 0.96,
            }}
            animate={{
              opacity: 1,
              left: state.spotlight.left,
              top: state.spotlight.top,
              width: state.spotlight.width,
              height: state.spotlight.height,
              borderRadius: state.spotlight.radius,
              scale: 1,
            }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 360, damping: 32, mass: 0.6 }}
          />
        )}
      </AnimatePresence>

      {/* Expanding Click Ripple */}
      <AnimatePresence>
        {state.ripple && (
          <motion.div
            key={state.ripple.id}
            className="cua-ripple"
            style={{ left: state.ripple.x, top: state.ripple.y }}
            initial={{ scale: 0.2, opacity: 0.9 }}
            animate={{ scale: 2.35, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.58, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
      </AnimatePresence>

      {/* Animated CUA Pointer + Floating Action Pill */}
      <AnimatePresence>
        {state.visible && (
          <motion.div
            key="cua-pointer"
            className="cua-pointer-wrap"
            initial={{ opacity: 0, scale: 0.65, x: state.x, y: state.y }}
            animate={{
              opacity: 1,
              scale: state.clicking ? 0.86 : 1,
              x: state.x,
              y: state.y,
            }}
            exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.22 } }}
            transition={{
              x: { type: "spring", stiffness: 210, damping: 26, mass: 0.55 },
              y: { type: "spring", stiffness: 210, damping: 26, mass: 0.55 },
              scale: { type: "spring", stiffness: 520, damping: 28 },
              opacity: { duration: 0.18 },
            }}
          >
            {/* Luminous Aura behind pointer tip */}
            <span className={"cua-aura tone-" + state.tone} />

            {/* Crisp Apple-style Pointer SVG */}
            <svg
              className="cua-arrow-svg"
              width="28"
              height="32"
              viewBox="0 0 28 32"
              fill="none"
            >
              <defs>
                <linearGradient id="cuaCursorFill" x1="2" y1="2" x2="22" y2="26" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#14b8a6" />
                  <stop offset="55%" stopColor="#0f766e" />
                  <stop offset="100%" stopColor="#065f46" />
                </linearGradient>
                <filter id="cuaCursorShadow" x="-20%" y="-15%" width="150%" height="150%">
                  <feDropShadow dx="0" dy="3" stdDeviation="2.5" floodColor="#000000" floodOpacity="0.34" />
                </filter>
              </defs>
              <path
                d="M3.2 2.4L23.4 15.2C24.4 15.8 24.1 17.3 22.9 17.6L14.4 19.6L10.3 27.5C9.7 28.6 8.1 28.2 8 27L3 3.6C2.9 2.9 2.6 2 3.2 2.4Z"
                fill="url(#cuaCursorFill)"
                stroke="#ffffff"
                strokeWidth="2.1"
                strokeLinejoin="round"
                filter="url(#cuaCursorShadow)"
              />
            </svg>

            {/* Floating Liquid Glass Action Tag */}
            {state.label && (
              <motion.div
                layout
                className={"cua-label-pill tone-" + state.tone}
                initial={{ opacity: 0, y: 6, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              >
                <span className="cua-label-icon">
                  {state.tone === "done" ? <Check size={12} strokeWidth={2.8} /> : <Sparkles size={12} strokeWidth={2.4} />}
                </span>
                <span className="cua-label-text">{state.label}</span>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
