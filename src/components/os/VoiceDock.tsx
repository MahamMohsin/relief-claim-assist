"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AudioLines, ChevronDown, Mic, Send, Square, StopCircle, Volume2 } from "lucide-react";
import type { MiniApp, Profile, UIAction } from "@/src/lib/contracts";
import { transcribe } from "@/src/lib/client";
import { useVoiceStream } from "@/src/lib/useVoiceStream";
import { apps } from "../launcher";
import { receiveActions } from "./UIActionBus";
import { queueSpeakSegment, speakText, stopSpeaking } from "./speech";

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
  const [working, setWorking] = useState(false);
  const [stage, setStage] = useState("Relief assistant");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [clarify, setClarify] = useState<Extract<UIAction, { type: "ask_clarification" }> | null>(null);
  const [decision, setDecision] = useState<Extract<UIAction, { type: "show_jev_badge" }> | null>(null);

  // Deepgram Live WebSocket Stream Hook from coffeebrew
  const dgVoice = useVoiceStream(lang);
  const recording = dgVoice.listening;

  // Stream live words into input box in real time as user speaks
  useEffect(() => {
    if (dgVoice.listening) {
      const live = dgVoice.partial || dgVoice.utterance;
      if (live) {
        setInput(live);
      }
    }
  }, [dgVoice.partial, dgVoice.utterance, dgVoice.listening]);

  // When Deepgram detects speech_final (end of speech), auto-populate final text
  useEffect(() => {
    if (dgVoice.lastUtterance) {
      setInput(dgVoice.lastUtterance);
    }
  }, [dgVoice.utteranceId, dgVoice.lastUtterance]);

  const active = useRef<{ id: string; controller: AbortController } | null>(null);
  const mounted = useRef(false);
  const connectivity = useRef(offline);
  connectivity.current = offline;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.controller.abort();
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
    let accumulatedAnswer = "";
    let spokenLength = 0;
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
          case "message_update": {
            accumulatedAnswer += event.text;
            setAnswer(accumulatedAnswer);

            // Stream TTS immediately: As soon as a complete sentence or clause arrives, start speaking!
            const unhandled = accumulatedAnswer.slice(spokenLength);
            const sentenceMatch = unhandled.match(/^(.*?[.!?۔\n]+)\s*/);
            if (sentenceMatch && sentenceMatch[1].trim().length > 3) {
              const sentence = sentenceMatch[1].trim();
              spokenLength += sentenceMatch[0].length;
              void queueSpeakSegment(sentence, lang, lite || offline).then(() => setStage("Speaking · Cartesia"));
            }
            break;
          }
          case "error": setError(event.message); break;
          case "agent_settled": {
            setStage(event.model === "local-guidance" ? "Local guidance fallback" : "Ready · " + event.model);
            // Speak any trailing text that didn't end in punctuation
            const remaining = accumulatedAnswer.slice(spokenLength).trim();
            if (remaining.length > 0) {
              void queueSpeakSegment(remaining, lang, lite || offline).then(() => setStage("Speaking · Cartesia"));
            }
            break;
          }
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

  function toggleRecord() {
    if (dgVoice.listening) {
      dgVoice.stop();
    } else {
      stopSpeaking();
      dgVoice.toggle();
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

  return <section className={"voice-dock-glass" + (clarify ? " clarifying" : "")} aria-label="Relief voice assistant">
    {expanded && (answer || error || clarify) && <div className="voice-reply-glass">
      {clarify && <div><p className="clarify-title">{clarify.question}</p><div className="voice-options">{clarify.options.map(app => <button type="button" key={app} onClick={() => choose(app)}>{apps[app].title}</button>)}</div></div>}
      {answer && <div className="voice-answer"><p>{answer}</p><button className="glass-icon-btn" onClick={() => void speakText(answer.slice(0, 1400), lang, lite || offline).then(setStage)} aria-label="Play assistant response"><Volume2 size={18} /></button></div>}
      {error && <p className="voice-error" role="alert">{error}</p>}
    </div>}
    <div className="voice-glass-main">
      {/* Status indicator only shown when recording, active, clarifying, or error */}
      {(recording || working || clarify || error || decision) && (
        <div className="voice-status-pill">
          <span className="voice-pulse-indicator">{recording ? <span className="wave" aria-hidden="true"><i /><i /><i /><i /></span> : <AudioLines size={15} />}</span>
          <span className="voice-stage-label" aria-live="polite">{stage}</span>
          {decision && <span className="decision-chip-glass" title={decision.model}>{decision.model.startsWith("jev-simulated") ? "Simulated Jev" : "Jev"} · {Math.round(decision.confidence * 100)}%</span>}
          {(answer || error || clarify) && <button className="glass-icon-btn" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-label="Toggle assistant response"><ChevronDown size={14} /></button>}
        </div>
      )}

      <form className="voice-glass-form" onSubmit={submit}>
        <button type="button" className={"glass-mic-btn" + (recording ? " recording" : "")} onClick={() => void toggleRecord()} aria-label={recording ? "Stop microphone recording" : "Start microphone recording"}>
          {recording ? <Square size={15} /> : <Mic size={18} />}
        </button>
        <input
          className="glass-voice-input"
          aria-label="Type a relief assistant command"
          placeholder={lang === "ur" ? "اپنا سوال لکھیں یا مائیک دبائیں…" : "Ask anything or tap mic to speak…"}
          value={input}
          maxLength={1000}
          onChange={event => setInput(event.target.value)}
        />
        <button type="button" className="glass-lang-pill" aria-label="Switch voice language" onClick={() => setLang(value => value === "en" ? "ur" : "en")}>
          {lang === "ur" ? "اردو" : "EN"}
        </button>
        {working && <button type="button" className="glass-icon-btn stop" aria-label="Stop assistant" onClick={stop}><StopCircle size={18} /></button>}
        <button type="submit" className="glass-send-btn" disabled={!input.trim()} aria-label="Send command">
          <Send size={15} />
        </button>
      </form>
    </div>
  </section>;
}
