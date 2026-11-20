"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AudioLines, ChevronDown, Mic, Send, Square, StopCircle, Volume2 } from "lucide-react";
import type { MiniApp, Profile, UIAction } from "@/src/lib/contracts";
import { transcribe } from "@/src/lib/client";
import { apps } from "../launcher";
import { receiveActions } from "./UIActionBus";
import { speakText, stopSpeaking } from "./speech";

type VoiceProps = {
  profile: Profile;
  citizenId: string | null;
  offline: boolean;
  lite: boolean;
  transcript: string;
  onAction: (action: UIAction) => void;
  onQueueAudio: (audio: Blob, locale: "en" | "ur") => Promise<string>;
};

export function VoiceDock({ profile, citizenId, offline, lite, transcript, onAction, onQueueAudio }: VoiceProps) {
  const [lang, setLang] = useState(profile.locale);
  const [input, setInput] = useState("");
  const [recording, setRecording] = useState(false);
  const [working, setWorking] = useState(false);
  const [stage, setStage] = useState("Relief assistant");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [clarify, setClarify] = useState<Extract<UIAction, { type: "ask_clarification" }> | null>(null);
  const [decision, setDecision] = useState<Extract<UIAction, { type: "show_jev_badge" }> | null>(null);
  const active = useRef<{ id: string; controller: AbortController } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const stopAt = useRef<number | undefined>(undefined);
  const mounted = useRef(false);
  const connectivity = useRef(offline);
  connectivity.current = offline;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.controller.abort();
      stream.current?.getTracks().forEach(track => track.stop());
      window.clearTimeout(stopAt.current);
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    if (transcript) { setInput(transcript); setStage("Offline recording transcribed"); }
  }, [transcript]);

  async function command(raw: string) {
    const prompt = raw.trim();
    if (!prompt) return;
    setExpanded(true);
    setInput("");
    setError("");
    if (offline) {
      setInput(prompt);
      setStage("Offline · type or record for later");
      setError("Reconnect to run the assistant. You can still save claim changes.");
      return;
    }

    if (active.current) {
      await fetch("/api/agent/stream", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: active.current.id, citizenId, prompt }),
      }).then(response => {
        if (!response.ok) throw new Error("The assistant finished before it could accept the new request.");
        setStage("Steering the current request");
      }).catch(error => setError(error.message));
      return;
    }
    stopSpeaking();
    setAnswer("");
    setClarify(null);
    setDecision(null);
    setWorking(true);
    setStage("Routing your request");
    const run = { id: crypto.randomUUID(), controller: new AbortController() };
    active.current = run;
    try {
      const response = await fetch("/api/agent/stream", {
        method: "POST", signal: run.controller.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, citizenId, runId: run.id, locale: lang }),
      });
      if (!response.ok) {
        const failure = await response.json();
        throw new Error(failure.error || "Assistant unavailable.");
      }
      await receiveActions(response, event => {
        switch (event.type) {
          case "phase": setStage(event.message); break;
          case "tool_execution_start": setStage("Pi · " + event.tool.replaceAll("_", " ")); break;
          case "tool_execution_end": setStage("Pi · preparing reply"); break;
          case "message_update": setAnswer(previous => previous + event.text); break;
          case "error": setError(event.message); break;
          case "agent_settled": setStage(event.model === "local-guidance" ? "Local guidance fallback" : "Ready · " + event.model); break;
          case "ui_action": {
            if (event.action.type === "show_jev_badge") setDecision(event.action);
            if (event.action.type === "ask_clarification") {
              setClarify(event.action);
              void speakText(event.action.question, lang, lite).then(setStage);
            }
            onAction(event.action);
            break;
          }
        }
      });
    } catch (problem) {
      if (!run.controller.signal.aborted) setError(problem instanceof Error ? problem.message : "Assistant unavailable.");
    } finally {
      if (active.current === run) {
        active.current = null;
        setWorking(false);
      }
    }
  }

  async function toggleRecord() {
    if (recorder.current?.state === "recording") {
      recorder.current.stop();
      return;
    }
    setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Microphone recording is unavailable. Type your request instead.");
      }
      const source = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) { source.getTracks().forEach(track => track.stop()); return; }
      stream.current = source;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
      const recording = new MediaRecorder(source, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined);
      recorder.current = recording;
      const parts: Blob[] = [];
      recording.ondataavailable = event => { if (event.data.size) parts.push(event.data); };
      recording.onerror = () => {
        setRecording(false);
        source.getTracks().forEach(track => track.stop());
        setError("Microphone recording failed. You can type your request.");
      };
      recording.onstop = async () => {
        window.clearTimeout(stopAt.current);
        source.getTracks().forEach(track => track.stop());
        if (!mounted.current) return;
        setRecording(false);
        const audio = new Blob(parts, { type: recording.mimeType || "audio/webm" });
        try {
          if (connectivity.current) {
            await onQueueAudio(audio, lang);
            setStage("Recording saved to offline queue");
          } else {
            setStage("Transcribing · Deepgram Nova-3");
            const text = await transcribe(audio, lang);
            if (!text) throw new Error("No clear speech detected. Try again or type.");
            setInput(text);
            setStage("Transcript ready");
          }
        } catch (error) {
          if (connectivity.current) {
            await onQueueAudio(audio, lang).catch(() => {});
            setStage("Offline recording queued");
          } else {
            setError(error instanceof Error ? error.message : "Could not transcribe this recording.");
            setStage("Relief assistant");
          }
        }
      };
      recording.start();
      setRecording(true);
      setStage("Listening · tap to stop");
      stopAt.current = window.setTimeout(() => { if (recording.state === "recording") recording.stop(); }, 20000);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Microphone unavailable. You can type instead.");
      setExpanded(true);
    }
  }

  function stop() {
    const run = active.current;
    active.current = null;
    run?.controller.abort();
    stopSpeaking();
    setWorking(false);
    setStage("Assistant stopped");
    if (run) void fetch("/api/agent/stream", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: run.id, citizenId }),
    }).catch(() => {});
  }

  function choose(app: MiniApp) {
    onAction({ type: "open_mini_app", app });
    setClarify(null);
    stopSpeaking();
  }

  function submit(event: FormEvent) { event.preventDefault(); void command(input); }

  return <section className={"voice-dock" + (clarify ? " clarifying" : "")} aria-label="Relief voice assistant">
    {expanded && (answer || error || clarify) && <div className="voice-reply">
      {clarify && <div><p>{clarify.question}</p><div className="voice-options">{clarify.options.map(app => <button type="button" key={app} onClick={() => choose(app)}>{apps[app].title}</button>)}</div></div>}
      {answer && <div className="voice-answer"><p>{answer}</p><button className="dock-icon" onClick={() => void speakText(answer.slice(0, 1400), lang, lite || offline).then(setStage)} aria-label="Play assistant response"><Volume2 size={19} /></button></div>}
      {error && <p className="voice-error" role="alert">{error}</p>}
    </div>}
    <div className="voice-status"><span>{recording ? <span className="wave" aria-hidden="true"><i /><i /><i /><i /></span> : <AudioLines size={15} />} <span aria-live="polite">{stage}</span></span>
      {decision && <span className="decision-chip" title={decision.model}>{decision.model.startsWith("jev-simulated") ? "Simulated Jev" : "Jev"} · {Math.round(decision.confidence * 100)}%</span>}
      {(answer || error || clarify) && <button className="dock-icon" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-label="Toggle assistant response"><ChevronDown size={16} /></button>}
    </div>
    <form className="voice-form" onSubmit={submit}>
      <button type="button" className={"mic-button" + (recording ? " recording" : "")} onClick={() => void toggleRecord()} aria-label={recording ? "Stop microphone recording" : "Start microphone recording"}>{recording ? <Square size={17} /> : <Mic size={20} />}</button>
      <input aria-label="Type a relief assistant command" placeholder={lang === "ur" ? "اپنا سوال لکھیں · Type a command" : "Type a command…"} value={input} maxLength={1000} onChange={event => setInput(event.target.value)} />
      <button type="button" className="lang-button" aria-label="Switch voice language" onClick={() => setLang(value => value === "en" ? "ur" : "en")}>{lang === "ur" ? "اردو" : "EN"}</button>
      {working && <button type="button" className="dock-icon" aria-label="Stop assistant" onClick={stop}><StopCircle size={20} /></button>}
      <button type="submit" className="send-button" disabled={!input.trim()} aria-label="Send command"><Send size={18} /></button>
    </form>
  </section>;
}
