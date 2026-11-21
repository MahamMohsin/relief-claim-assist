"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceStatus = "idle" | "connecting" | "listening" | "error";

export interface VoiceStreamState {
  status: VoiceStatus;
  error: string | null;
  partial: string;
  utterance: string;
  lastUtterance: string;
  utteranceId: number;
  finalText: string;
  listening: boolean;
}

interface DeepgramResultsMsg {
  type: string;
  start: number;
  end: number;
  is_final: boolean;
  speech_final: boolean;
  channel?: { alternatives?: Array<{ transcript?: string; confidence?: number }> };
}

const IDLE: VoiceStreamState = {
  status: "idle",
  error: null,
  partial: "",
  utterance: "",
  lastUtterance: "",
  utteranceId: 0,
  finalText: "",
  listening: false,
};

export function useVoiceStream(locale: "en" | "ur" = "en") {
  const [state, setState] = useState<VoiceStreamState>(IDLE);

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const teardown = useCallback(() => {
    const ws = wsRef.current;
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "CloseStream" }));
        }
        ws.close();
      } catch {}
    }
    wsRef.current = null;
    nodeRef.current?.disconnect();
    nodeRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    micRef.current?.getTracks().forEach(t => t.stop());
    micRef.current = null;
  }, []);

  stopRef.current = teardown;

  const stop = useCallback(() => {
    teardown();
    setState(IDLE);
  }, [teardown]);

  const start = useCallback(async () => {
    if (wsRef.current) return;
    const key = process.env.NEXT_PUBLIC_DEEPGRAM_KEY?.trim();
    if (!key) {
      setState({ ...IDLE, status: "error", error: "Missing NEXT_PUBLIC_DEEPGRAM_KEY" });
      return;
    }
    setState({ ...IDLE, status: "connecting", listening: true });

    let media: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      ctx = new AudioContext({ sampleRate: 16000 });
      await ctx.audioWorklet.addModule("/pcm-worklet.js");

      const langCode = locale === "ur" ? "ur" : "en-US";
      const dgUrl = `wss://api.deepgram.com/v1/listen?model=nova-3&language=${langCode}&encoding=linear16&channels=1&interim_results=true&endpointing=300&smart_format=true&sample_rate=${ctx.sampleRate}`;
      const ws = new WebSocket(dgUrl, ["token", key]);
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Deepgram connection timeout")), 10000);
        ws.onopen = () => {
          clearTimeout(timer);
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error("Deepgram WebSocket error"));
        };
      });

      ws.onmessage = ev => {
        let msg: DeepgramResultsMsg;
        try {
          msg = JSON.parse(ev.data as string) as DeepgramResultsMsg;
        } catch {
          return;
        }
        if (msg.type !== "Results") return;

        const text = msg.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
        if (!text) return;

        if (msg.is_final) {
          if (msg.speech_final) {
            setState(s => {
              const full = s.utterance ? `${s.utterance} ${text}` : text;
              return {
                ...s,
                status: "listening",
                partial: "",
                utterance: "",
                lastUtterance: full,
                utteranceId: s.utteranceId + 1,
                finalText: s.finalText ? `${s.finalText} ${full}` : full,
              };
            });
          } else {
            setState(s => ({
              ...s,
              status: "listening",
              partial: "",
              utterance: s.utterance ? `${s.utterance} ${text}` : text,
            }));
          }
        } else {
          setState(s => ({
            ...s,
            status: "listening",
            partial: text,
          }));
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
          setState(s => s.status === "listening" || s.status === "connecting"
            ? { ...s, status: "error", error: "Connection closed", listening: false }
            : s
          );
        }
      };

      const source = ctx.createMediaStreamSource(media);
      const node = new AudioWorkletNode(ctx, "pcm-capture");
      nodeRef.current = node;
      micRef.current = media;
      ctxRef.current = ctx;

      node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        const wsNow = wsRef.current;
        if (!wsNow || wsNow.readyState !== WebSocket.OPEN) return;
        wsNow.send(e.data);
      };
      source.connect(node);

      setState(s => ({ ...s, status: "listening", error: null }));
    } catch (err) {
      media?.getTracks().forEach(t => t.stop());
      ctx?.close().catch(() => {});
      wsRef.current?.close();
      wsRef.current = null;
      const message = err instanceof Error ? err.message : "Failed to start microphone";
      setState({ ...IDLE, status: "error", error: message });
    }
  }, [locale]);

  const toggle = useCallback(() => {
    if (state.status === "listening" || state.status === "connecting") {
      stop();
    } else {
      void start();
    }
  }, [state.status, start, stop]);

  useEffect(() => {
    return () => stopRef.current?.();
  }, []);

  return { ...state, toggle, start, stop };
}
