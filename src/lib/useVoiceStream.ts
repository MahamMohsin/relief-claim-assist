
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type VoiceState = {
  status: "idle" | "connecting" | "listening" | "error";
  error: string | null;
  partial: string;
  utterance: string;
  lastUtterance: string;
  utteranceId: number;
  listening: boolean;
};
const idle: VoiceState = { status: "idle", error: null, partial: "", utterance: "", lastUtterance: "", utteranceId: 0, listening: false };
type Transcript = { is_final?: boolean; speech_final?: boolean; channel?: { alternatives?: { transcript?: string }[] } };
type Recording = {
  controller: AbortController;
  id?: string;
  media?: MediaStream;
  context?: AudioContext;
  worklet?: AudioWorkletNode;
  poll?: number;
  timeout?: number;
};

export function useVoiceStream(locale: "en" | "ur") {
  const [state, setState] = useState<VoiceState>(idle);
  const current = useRef<Recording | null>(null);

  const release = useCallback((recording: Recording) => {
    if (current.current === recording) current.current = null;
    recording.controller.abort();
    window.clearInterval(recording.poll);
    window.clearTimeout(recording.timeout);
    recording.worklet?.disconnect();
    recording.media?.getTracks().forEach(track => track.stop());
    void recording.context?.close().catch(() => {});
    if (recording.id) void fetch("/api/voice/relay", {
      method: "DELETE", headers: { "x-relief-recording": recording.id },
    }).catch(() => {});
  }, []);

  const stop = useCallback(() => {
    if (current.current) release(current.current);
    setState(previous => ({ ...previous, status: "idle", listening: false }));
  }, [release]);

  useEffect(() => () => {
    if (current.current) release(current.current);
  }, [release]);

  const start = useCallback(async () => {
    if (current.current) return true;
    const recording: Recording = { controller: new AbortController() };
    const signal = recording.controller.signal;
    current.current = recording;
    setState({ ...idle, status: "connecting", listening: true });
    try {
      const response = await fetch("/api/voice/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
      });
      if (!response.ok) throw new Error("Live transcription is unavailable.");
      const { recordingId } = await response.json();
      if (typeof recordingId !== "string") throw new Error("Live transcription is unavailable.");
      recording.id = recordingId;
      if (signal.aborted) { release(recording); return false; }
      recording.media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (signal.aborted) { release(recording); return false; }
      const context = new AudioContext({ sampleRate: 16000 });
      recording.context = context;
      await context.audioWorklet.addModule("/pcm-worklet.js");
      if (signal.aborted) return false;
      const node = new AudioWorkletNode(context, "pcm-capture");
      recording.worklet = node;
      context.createMediaStreamSource(recording.media).connect(node);

      let chunks: ArrayBuffer[] = [];
      let bytes = 0;
      let sending = false;
      node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (bytes + event.data.byteLength > 32000) return;
        chunks.push(event.data);
        bytes += event.data.byteLength;
      };
      recording.poll = window.setInterval(async () => {
        if (sending || signal.aborted || !bytes) return;
        sending = true;
        const batch = new Blob(chunks, { type: "application/octet-stream" });
        chunks = [];
        bytes = 0;
        try {
          const output = await fetch("/api/voice/relay", {
            method: "PATCH",
            headers: { "Content-Type": "application/octet-stream", "x-relief-recording": recordingId },
            body: batch,
            signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
          });
          if (!output.ok) throw new Error("Live transcription disconnected.");
          const { messages } = await output.json() as { messages: Transcript[] };
          if (signal.aborted) return;
          for (const message of messages) {
            const text = message.channel?.alternatives?.[0]?.transcript?.trim();
            if (!text) continue;
            setState(previous => {
              if (!message.is_final) return { ...previous, partial: text };
              const utterance = [previous.utterance, text].filter(Boolean).join(" ");
              return message.speech_final
                ? { ...previous, partial: "", utterance: "", lastUtterance: utterance, utteranceId: previous.utteranceId + 1 }
                : { ...previous, partial: "", utterance };
            });
          }
        } catch {
          if (signal.aborted) return;
          release(recording);
          setState(previous => ({ ...previous, listening: false, status: "error", error: "Live transcription disconnected. Use 2G Lite mode for a short recording." }));
        } finally { sending = false; }
      }, 280);
      recording.timeout = window.setTimeout(stop, 20000);
      setState({ ...idle, status: "listening", listening: true });
      return true;
    } catch (error) {
      const aborted = signal.aborted;
      release(recording);
      if (!aborted) setState({ ...idle, status: "error", error: error instanceof Error ? error.message : "Live transcription is unavailable." });
      return false;
    }
  }, [locale, release, stop]);

  return { ...state, start, stop };
}
