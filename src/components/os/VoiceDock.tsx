"use client";

import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
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

  const [hasEngagedVoice, setHasEngagedVoice] = useState(false);
  const [clipRecording, setClipRecording] = useState(false);
  const [startingMic, setStartingMic] = useState(false);
  const micStart = useRef<AbortController | null>(null);
  const clip = useRef<{ recorder: MediaRecorder; source: MediaStream; timer: number } | null>(null);

  const dgVoice = useVoiceStream(lang);
  const recording = dgVoice.listening || clipRecording;
  const recordingStage = clipRecording ? "Recording a short clip" : dgVoice.status === "listening" ? "Listening · Deepgram" : null;
  const displayedStage = recordingStage ?? (startingMic ? "Starting microphone" : stage);

  // Mark voice engaged as soon as user starts speaking or recording
  useEffect(() => {
    if (recording || dgVoice.partial || dgVoice.utterance || input.trim()) {
      setHasEngagedVoice(true);
    }
  }, [recording, dgVoice.partial, dgVoice.utterance, input]);

  // Stream live words into input box in real time as user speaks
  useEffect(() => {
    if (dgVoice.listening) {
      const live = [dgVoice.utterance, dgVoice.partial].filter(Boolean).join(" ");
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
      micStart.current?.abort();
      if (clip.current) {
        window.clearTimeout(clip.current.timer);
        clip.current.source.getTracks().forEach(track => track.stop());
      }
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    if (transcript) { setInput(transcript); setStage("Offline recording transcribed"); }
  }, [transcript]);

  useEffect(() => {
    if (dgVoice.error && !startingMic && !clipRecording) {
      setExpanded(true);
      setError(dgVoice.error);
    }
  }, [dgVoice.error, startingMic, clipRecording]);

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
              void queueSpeakSegment(sentence, lang, lite || offline).then(status => {
                if (status !== "Playback stopped") setStage(status);
              });
            }
            break;
          }
          case "error": setError(event.message); break;
          case "agent_settled": {
            setStage(event.model === "local-guidance" ? "Local guidance fallback" : "Ready · " + event.model);
            // Speak any trailing text that didn't end in punctuation
            const remaining = accumulatedAnswer.slice(spokenLength).trim();
            if (remaining.length > 0) {
              void queueSpeakSegment(remaining, lang, lite || offline).then(status => {
                if (status !== "Playback stopped") setStage(status);
              });
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

  function stopRecording() {
    micStart.current?.abort();
    if (clip.current?.recorder.state === "recording") {
      clip.current.recorder.stop();
    } else {
      dgVoice.stop();
    }
  }

  async function startRecording() {
    if (recording || micStart.current) return;
    const starting = new AbortController();
    micStart.current = starting;
    stopSpeaking();
    setError("");
    setStartingMic(true);
    let source: MediaStream | undefined;
    try {
      if (!offline && !lite && await dgVoice.start()) return;
      if (starting.signal.aborted || !mounted.current) return;
      source = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (starting.signal.aborted || !mounted.current) { source.getTracks().forEach(track => track.stop()); return; }
      const audioSource = source;
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(value => MediaRecorder.isTypeSupported(value));
      const recorder = new MediaRecorder(source, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        window.clearTimeout(clip.current?.timer);
        clip.current = null;
        audioSource.getTracks().forEach(track => track.stop());
        if (!mounted.current) return;
        setClipRecording(false);
        const audio = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        try {
          if (connectivity.current) {
            await onQueueAudio(audio, lang);
            setStage("Recording queued for sync");
          } else {
            setStage("Transcribing short recording");
            const text = await transcribe(audio, lang);
            if (!text) throw new Error("No speech detected. Try a short recording or type instead.");
            setInput(text);
            setStage("Transcript ready");
          }
        } catch (error) {
          setExpanded(true);
          setError(error instanceof Error ? error.message : "Recording could not be transcribed.");
        }
      };
      recorder.start();
      setError("");
      clip.current = { recorder, source, timer: window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 20000) };
      setClipRecording(true);
      setStage("Recording a short clip");
    } catch {
      source?.getTracks().forEach(track => track.stop());
      if (!starting.signal.aborted && mounted.current) {
        setExpanded(true);
        setError("Microphone unavailable. You can type your request.");
      }
    } finally {
      if (micStart.current === starting) micStart.current = null;
      if (mounted.current) setStartingMic(false);
    }
  }

  const beginPushToTalk = useEffectEvent(() => {
    if (recording || micStart.current) return false;
    void startRecording();
    return true;
  });
  const endPushToTalk = useEffectEvent(stopRecording);

  useEffect(() => {
    let held = false;
    const releaseKey = () => {
      if (!held) return;
      held = false;
      endPushToTalk();
    };
    const keyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "t" || event.repeat || held || event.defaultPrevented
          || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.target instanceof HTMLElement && (event.target.isContentEditable
          || event.target.closest("input, textarea, select, button, [role='textbox']"))) return;
      held = beginPushToTalk();
      if (held) event.preventDefault();
    };
    const keyUp = (event: KeyboardEvent) => { if (event.key.toLowerCase() === "t") releaseKey(); };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", releaseKey);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", releaseKey);
    };
  }, []);

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

  return <section className={"voice-dock-glass" + (hasEngagedVoice ? " voice-revealed" : "") + (recording ? " is-recording" : "") + (working ? " is-working" : "") + (clarify ? " clarifying" : "")} aria-label="Relief voice assistant">
    {expanded && (answer || error || clarify || (working && decision)) && <div className="voice-reply-glass">
      {clarify && <div><p className="clarify-title">{clarify.question}</p><div className="voice-options">{clarify.options.map(app => <button type="button" key={app} onClick={() => choose(app)}>{apps[app].title}</button>)}</div></div>}
      {answer && <div className="voice-answer"><p>{answer}</p><button className="glass-icon-btn" onClick={() => void speakText(answer.slice(0, 1400), lang, lite || offline).then(setStage)} aria-label="Play assistant response"><Volume2 size={18} /></button></div>}
      {error && <p className="voice-error" role="alert">{error}</p>}
      {decision && <small className="voice-decision" title={decision.model}>
        {decision.model.startsWith("jev-simulated") ? "Simulated Jev" : "Jev"} · {Math.round(decision.confidence * 100)}% confidence · {decision.route === "clarification" ? "Clarification" : apps[decision.route].title}
      </small>}
    </div>}
    <div className="voice-glass-main">
      <form className="voice-glass-form" onSubmit={submit}>
        <input
          className="glass-voice-input"
          aria-label="Type a relief assistant command"
          placeholder={
            recording
              ? lang === "ur"
                ? "سن رہا ہے… (T چھوڑ کر بند کریں)"
                : "Listening… (Release T to stop)"
              : lang === "ur"
                ? "اپنا سوال لکھیں یا مائیک دبائیں (T دبا کر بولیں)…"
                : "Ask anything, press T to talk, or record…"
          }
          value={input}
          maxLength={1000}
          onChange={event => setInput(event.target.value)}
        />
        {(working || clarify || startingMic || recording || stage !== "Relief assistant") && (
          <span className="glass-inline-status" title={displayedStage} role="status">
            {recordingStage ? <AudioLines className="recording-wave" size={13} aria-hidden="true" /> : <span className="inline-spin-dot" aria-hidden="true" />}
            <span className="inline-stage-text">{displayedStage}</span>
          </span>
        )}
        <button type="button" className="glass-lang-pill" aria-label="Switch voice language" onClick={() => setLang(value => value === "en" ? "ur" : "en")}>
          {lang === "ur" ? "اردو" : "EN"}
        </button>
        {working && <button type="button" className="glass-icon-btn stop" aria-label="Stop assistant" onClick={stop}><StopCircle size={18} /></button>}
        {/* Unified Record / Send Action Button */}
        <button
          type={!recording && input.trim() ? "submit" : "button"}
          className={
            "glass-action-btn" +
            (recording ? " recording" : "") +
            (!recording && input.trim() ? " has-text" : "")
          }
          onClick={e => {
            if (!recording && input.trim()) {
              // let submit handler handle form submission
              return;
            }
            e.preventDefault();
            if (recording) stopRecording();
            else void startRecording();
          }}
          aria-label={
            recording
              ? "Stop recording"
              : input.trim()
                ? "Send message"
                : "Record voice (or press T to talk)"
          }
          title={
            recording
              ? "Stop recording"
              : input.trim()
                ? "Send message"
                : "Record voice (or press T to talk)"
          }
        >
          {recording ? (
            <Square size={15} />
          ) : input.trim() ? (
            <Send size={15} />
          ) : (
            <Mic size={17} />
          )}
        </button>
      </form>
    </div>
  </section>;
}
