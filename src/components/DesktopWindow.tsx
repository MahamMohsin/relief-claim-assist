"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";

type WindowSize = { width: number; height: number };
type WindowPos = { x: number; y: number };
export type LaunchOrigin = { x: number; y: number } | null;

interface DesktopWindowProps {
  appId: string;
  isFocused: boolean;
  isMaximized: boolean;
  preset: "compact" | "default" | "wide" | "max";
  zIndex: number;
  initialOffset: number;
  launchOrigin?: LaunchOrigin;
  motionDisabled?: boolean;
  onFocus: () => void;
  titlebar: React.ReactNode;
  children: React.ReactNode;
}

const PRESET_SIZES: Record<"compact" | "default" | "wide" | "max", WindowSize> = {
  compact: { width: 520, height: 420 },
  default: { width: 760, height: 540 },
  wide: { width: 980, height: 640 },
  max: { width: 980, height: 640 },
};

const MIN_WIDTH = 340;
const MIN_HEIGHT = 240;

export function DesktopWindow({
  isFocused,
  isMaximized,
  preset,
  zIndex,
  initialOffset,
  launchOrigin,
  motionDisabled = false,
  onFocus,
  titlebar,
  children,
}: DesktopWindowProps) {
  const winRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<WindowPos>(() => ({
    x: Math.max(20, (typeof window !== "undefined" ? window.innerWidth / 2 - 380 : 120) + initialOffset),
    y: 20 + initialOffset,
  }));
  const [customSize, setCustomSize] = useState<WindowSize | null>(null);
  const [interacting, setInteracting] = useState(false);

  // Reset custom size when user picks a preset
  useEffect(() => {
    setCustomSize(null);
  }, [preset]);

  const activeSize = customSize ?? PRESET_SIZES[preset];

  // Compute Apple macOS / iPadOS spring-from-icon vector relative to the window center
  const originDelta = useMemo(() => {
    if (!launchOrigin || typeof window === "undefined") {
      return { dx: 0, dy: 44 };
    }
    const finalCenterX = (isMaximized ? window.innerWidth / 2 : pos.x + activeSize.width / 2);
    const finalCenterY = 32 + (isMaximized ? (window.innerHeight - 32) / 2 : pos.y + activeSize.height / 2);
    return {
      dx: launchOrigin.x - finalCenterX,
      dy: launchOrigin.y - finalCenterY,
    };
  }, [launchOrigin, isMaximized, pos.x, pos.y, activeSize.width, activeSize.height]);

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isMaximized) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    onFocus();

    const startX = e.clientX;
    const startY = e.clientY;
    const startPos = { ...pos };
    setInteracting(true);

    const onMove = (ev: PointerEvent) => {
      const maxX = Math.max(20, window.innerWidth - 120);
      const maxY = Math.max(20, window.innerHeight - 100);
      setPos({
        x: Math.min(maxX, Math.max(-activeSize.width + 120, startPos.x + (ev.clientX - startX))),
        y: Math.min(maxY, Math.max(0, startPos.y + (ev.clientY - startY))),
      });
    };

    const onUp = () => {
      setInteracting(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const startResize = (dir: "e" | "s" | "se") => (e: React.PointerEvent<HTMLDivElement>) => {
    if (isMaximized) return;
    e.preventDefault();
    e.stopPropagation();
    onFocus();

    const rect = winRef.current?.getBoundingClientRect();
    const startW = rect ? rect.width : activeSize.width;
    const startH = rect ? rect.height : activeSize.height;
    const startX = e.clientX;
    const startY = e.clientY;
    setInteracting(true);

    const onMove = (ev: PointerEvent) => {
      const nextW = dir === "e" || dir === "se"
        ? Math.max(MIN_WIDTH, Math.min(window.innerWidth - 24, startW + (ev.clientX - startX)))
        : startW;
      const nextH = dir === "s" || dir === "se"
        ? Math.max(MIN_HEIGHT, Math.min(window.innerHeight - 90, startH + (ev.clientY - startY)))
        : startH;
      setCustomSize({ width: nextW, height: nextH });
    };

    const onUp = () => {
      setInteracting(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <motion.div
      ref={winRef}
      initial={
        motionDisabled
          ? { opacity: 0 }
          : {
              x: originDelta.dx,
              y: originDelta.dy,
              scale: 0.16,
              opacity: 0,
              filter: "blur(10px)",
              borderRadius: 46,
            }
      }
      animate={
        motionDisabled
          ? { opacity: 1 }
          : {
              x: 0,
              y: 0,
              scale: 1,
              opacity: 1,
              filter: "blur(0px)",
              borderRadius: isMaximized ? 14 : 20,
            }
      }
      exit={
        motionDisabled
          ? { opacity: 0 }
          : {
              x: originDelta.dx * 0.85,
              y: originDelta.dy * 0.85,
              scale: 0.16,
              opacity: 0,
              filter: "blur(8px)",
              borderRadius: 44,
              transition: { duration: 0.24, ease: [0.32, 0.72, 0, 1] },
            }
      }
      transition={
        motionDisabled
          ? { duration: 0.12 }
          : {
              type: "spring",
              stiffness: 300,
              damping: 27,
              mass: 0.84,
              opacity: { duration: 0.2, ease: [0.16, 1, 0.3, 1] },
              filter: { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
            }
      }
      style={{
        zIndex,
        top: isMaximized ? "8px" : `${pos.y}px`,
        left: isMaximized ? "8px" : `${pos.x}px`,
        width: isMaximized ? undefined : `${activeSize.width}px`,
        height: isMaximized ? undefined : `${activeSize.height}px`,
        transition: interacting ? "none" : undefined,
        willChange: "transform, opacity, filter",
      }}
      className={
        "desktop-window preset-" +
        preset +
        (isMaximized ? " maximized " : " ") +
        (isFocused ? "focused " : "") +
        (interacting ? "interacting " : "")
      }
      onPointerDown={onFocus}
    >
      <div className="desktop-window-titlebar" onPointerDown={startDrag}>
        {titlebar}
      </div>

      {children}

      {!isMaximized && (
        <>
          <div className="win-resize-e" onPointerDown={startResize("e")} aria-hidden="true" />
          <div className="win-resize-s" onPointerDown={startResize("s")} aria-hidden="true" />
          <div className="win-resize-se" onPointerDown={startResize("se")} aria-hidden="true" />
        </>
      )}
    </motion.div>
  );
}
