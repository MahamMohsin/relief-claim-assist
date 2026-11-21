"use client";

import { useEffect, useRef } from "react";
import { mountAvatar } from "open-bot-avatar/dom";

const BOT_DEFINITION = {
  version: 1,
  id: "cute-bot",
  name: "Pi Bot",
  body: {
    path: "M26 28C26 18 34 12 46 12L54 12C66 12 74 18 74 28L74 62C74 72 66 78 54 78L46 78C34 78 26 72 26 62ZM47 8L53 8L53 14L47 14ZM16 38L26 38L26 54L16 54ZM74 38L84 38L84 54L74 54Z",
  },
  eyes: { x: 50, y: 44, spacing: 18, scale: 1.25 },
} as const;

export interface BotAvatarProps {
  state?: "idle" | "thinking" | "working" | "waiting" | "blocked" | "done";
  mood?: "neutral" | "happy";
  size?: number;
  color?: string;
  eyeColor?: string;
  onClick?: () => void;
  className?: string;
}

export function BotAvatar({
  state = "idle",
  mood = "neutral",
  size = 38,
  color = "#2dd4bf", // vibrant friendly mint-teal
  eyeColor = "#0f172a",
  onClick,
  className = "",
}: BotAvatarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<ReturnType<typeof mountAvatar> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    try {
      avatarRef.current = mountAvatar(containerRef.current, {
        definition: BOT_DEFINITION,
        color,
        eyeColor,
        state,
        mood,
        followPointer: true,
        label: "Pi Assistant Avatar",
      });
    } catch (err) {
      console.error("BotAvatar mount error:", err);
    }

    return () => {
      avatarRef.current?.destroy();
      avatarRef.current = null;
    };
  }, [color, eyeColor]);

  useEffect(() => {
    if (avatarRef.current) {
      avatarRef.current.update({ state, mood });
    }
  }, [state, mood]);

  return (
    <div
      ref={containerRef}
      className={`bot-avatar-host ${className}`}
      onClick={onClick}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        cursor: onClick ? "pointer" : "default",
      }}
      title="Pi Bot · Looking at your pointer"
    />
  );
}
