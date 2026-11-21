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
  flushPending?: () => Promise<string>;
};

export function useVoiceStream(locale: "en" | "ur") {
  const [state, setState] = useState<VoiceState>(idle);
  const current = useRef<Recording | null>(null);
  const transcriptRef = useRef({ committed: "", utterance: "", partial: "" });

  const combinedText = () => {
    const { committed, utterance, partial } = transcriptRef.current;
    return [committed, utterance, partial].filter(Boolean).join(" ").trim();
  };

  const release = useCallback((recording: Recording, skipDelete = false) => {
    if (current.current === recording) current.current = null;
    recording.controller.abort();
    window.clearInterval(recording.poll);
    window.clearTimeout(recording.timeout);
    recording.worklet?.disconnect();
    recording.media?.getTracks().forEach(track => track.stop());
    void recording.context?.close().catch(() => {});
    if (!skipDelete && recording.id) {
      void fetch("/api/voice/relay", {
        method: "DELETE", headers: { "x-relief-recording": recording.id },
      }).catch(() => {});
    }
  }, []);

  const stop = useCallback(() => {
    if (current.current) release(current.current);
    setState(previous => ({ ...previous, status: "idle", listening: false }));
  }, [release]);

  const stopAndFlush = useCallback(async (): Promise<string> => {
    const recording = current.current;
    if (!recording) return combinedText();
    // Stop mic capture immediately so user sees recording stop right away
    window.clearInterval(recording.poll);
    window.clearTimeout(recording.timeout);
    recording.worklet?.disconnect();
    recording.media?.getTracks().forEach(track => track.stop());
    void recording.context?.close().catch(() => {});
    setState(previous => ({ ...previous, status: "idle", listening: false }));

    let finalText = combinedText();
    if (recording.flushPending) {
      try {
        const flushed = await recording.flushPending();
        if (flushed) finalText = flushed;
      } catch {
        // Use best text accumulated so far
      }
    }
    release(recording);
    return finalText.trim();
  }, [release]);

  useEffect(() => () => {
    if (current.current) release(current.current);
  }, [release]);

  const start = useCallback(async () => {
    if (current.current) return true;
    transcriptRef.current = { committed: "", utterance: "", partial: "" };
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

      const applyMessages = (messages: Transcript[]) => {
        for (const message of messages) {
          const text = message.channel?.alternatives?.[0]?.transcript?.trim();
          if (!text) continue;
          if (!message.is_final) {
            transcriptRef.current.partial = text;
            const fullUtterance = [transcriptRef.current.committed, transcriptRef.current.utterance].filter(Boolean).join(" ");
            setState(previous => ({ ...previous, utterance: fullUtterance, partial: text }));
          } else {
            const nextUtterance = [transcriptRef.current.utterance, text].filter(Boolean).join(" ");
            transcriptRef.current.partial = "";
            if (message.speech_final) {
              transcriptRef.current.committed = [transcriptRef.current.committed, nextUtterance].filter(Boolean).join(" ");
              transcriptRef.current.utterance = "";
              const full = transcriptRef.current.committed;
              setState(previous => ({
                ...previous,
                partial: "",
                utterance: full,
                lastUtterance: full,
                utteranceId: previous.utteranceId + 1,
              }));
            } else {
              transcriptRef.current.utterance = nextUtterance;
              const full = [transcriptRef.current.committed, nextUtterance].filter(Boolean).join(" ");
              setState(previous => ({ ...previous, partial: "", utterance: full }));
            }
          }
        }
      };

      const sendBatch = async (timeoutMs: number, ignoreAbort = false) => {
        if (!bytes) return;
        const batch = new Blob(chunks, { type: "application/octet-stream" });
        chunks = [];
        bytes = 0;
        const output = await fetch("/api/voice/relay", {
          method: "PATCH",
          headers: { "Content-Type": "application/octet-stream", "x-relief-recording": recordingId },
          body: batch,
          signal: ignoreAbort
            ? AbortSignal.timeout(timeoutMs)
            : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        });
        if (!output.ok) throw new Error("Live transcription disconnected.");
        const { messages } = await output.json() as { messages: Transcript[] };
        if (!ignoreAbort && signal.aborted) return;
        applyMessages(messages);
      };

      recording.flushPending = async () => {
        if (bytes > 0) {
          try {
            await sendBatch(900, true);
          } catch {
            // ignore flush timeout
          }
        }
        return combinedText();
      };

      recording.poll = window.setInterval(async () => {
        if (sending || signal.aborted || !bytes) return;
        sending = true;
        try {
          await sendBatch(5000);
        } catch {
          if (signal.aborted) return;
          release(recording);
          setState(previous => ({ ...previous, listening: false, status: "error", error: "Live transcription disconnected. Use 2G Lite mode for a short recording." }));
        } finally { sending = false; }
      }, 240);
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

  return { ...state, start, stop, stopAndFlush };
}
