"use client";

import { useEffect, useRef } from "react";
import { mountAvatar } from "open-bot-avatar/dom";

/**
 * Cute White Ghost definition matching the user reference image:
 * Smooth dome head, straight body, 3 scalloped bottom lobes,
 * and vertical dark pill/capsule eyes.
 */
export const GHOST_DEFINITION = {
  version: 1,
  id: "cute-white-ghost",
  name: "Ghosty",
  body: {
    path: "M24 40C24 23 35 12 50 12C65 12 76 23 76 40V76C73 83 62 83 59 77C56 83 45 83 41 77C38 83 27 83 24 76Z",
  },
  eyes: { x: 50, y: 40, spacing: 18, scale: 1.35 },
} as const;

export interface BotAvatarProps {
  state?: "idle" | "thinking" | "working" | "waiting" | "blocked" | "done";
  mood?: "neutral" | "happy";
  size?: number;
  color?: string;
  eyeColor?: string;
  depth?: number;
  followPointer?: boolean;
  lookAt?: { x: number; y: number } | null;
  isSpeaking?: boolean;
  isWorking?: boolean;
  isListening?: boolean;
  isDone?: boolean;
  onClick?: () => void;
  className?: string;
  title?: string;
}

export function BotAvatar({
  state = "idle",
  mood = "neutral",
  size = 46, // Prominent, cute and bigger
  color = "#ffffff", // Pure cute white ghost
  eyeColor = "#111111", // Deep dark pill eyes
  depth = 3,
  followPointer = true,
  lookAt = null,
  isSpeaking = false,
  isWorking = false,
  isListening = false,
  isDone = false,
  onClick,
  className = "",
  title = "Ghost Assistant",
}: BotAvatarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<ReturnType<typeof mountAvatar> | null>(null);

  // Compute resolved state and mood based on activity
  const resolvedState: "idle" | "thinking" | "working" | "waiting" | "blocked" | "done" =
    isDone
      ? "done"
      : isSpeaking || isWorking
        ? "working"
        : isListening
          ? "thinking"
          : state;

  const resolvedMood: "neutral" | "happy" =
    isDone || isSpeaking ? "happy" : mood;

  const shouldFollowPointer =
    !isSpeaking && !isWorking && !isDone && !lookAt && followPointer;

  useEffect(() => {
    if (!containerRef.current) return;
    try {
      avatarRef.current = mountAvatar(containerRef.current, {
        definition: GHOST_DEFINITION,
        color,
        eyeColor,
        depth,
        state: resolvedState,
        mood: resolvedMood,
        followPointer: shouldFollowPointer,
        lookAt,
        label: "Ghost Bot Avatar",
      });
    } catch (err) {
      console.error("BotAvatar mount error:", err);
    }

    return () => {
      avatarRef.current?.destroy();
      avatarRef.current = null;
    };
  }, [color, eyeColor, depth]);

  useEffect(() => {
    if (avatarRef.current) {
      avatarRef.current.update({
        state: resolvedState,
        mood: resolvedMood,
        followPointer: shouldFollowPointer,
        lookAt,
      });
    }
  }, [resolvedState, resolvedMood, shouldFollowPointer, lookAt]);

  const classes = [
    "bot-avatar-host",
    isSpeaking ? "is-speaking" : "",
    isWorking ? "is-working" : "",
    isListening ? "is-listening" : "",
    isDone ? "is-done" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={containerRef}
      className={classes}
      onClick={onClick}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        cursor: onClick ? "pointer" : "default",
      }}
      title={title}
    />
  );
}
