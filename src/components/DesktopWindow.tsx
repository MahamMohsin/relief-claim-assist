"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

type WindowSize = { width: number; height: number };
type WindowPos = { x: number; y: number };

interface DesktopWindowProps {
  appId: string;
  isFocused: boolean;
  isMaximized: boolean;
  preset: "compact" | "default" | "wide" | "max";
  zIndex: number;
  initialOffset: number;
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
      initial={{ scale: 0.94, opacity: 0, y: 16 }}
      animate={{ scale: 1, opacity: 1, y: 0 }}
      exit={{ scale: 0.9, opacity: 0 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      style={{
        zIndex,
        top: isMaximized ? "8px" : `${pos.y}px`,
        left: isMaximized ? "8px" : `${pos.x}px`,
        width: isMaximized ? undefined : `${activeSize.width}px`,
        height: isMaximized ? undefined : `${activeSize.height}px`,
        transition: interacting ? "none" : undefined,
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
