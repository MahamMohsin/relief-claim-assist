"use client";

import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { ChevronDown, ChevronUp, Mic, Send, Volume2, X } from "lucide-react";
import type { MiniApp, Profile, UIAction } from "@/src/lib/contracts";
import { transcribe } from "@/src/lib/client";
import { useVoiceStream } from "@/src/lib/useVoiceStream";
import { apps } from "../launcher";
import { receiveActions } from "./UIActionBus";
import { queueSpeakSegment, speakText, stopSpeaking } from "./speech";
import { cuaEngine } from "./cuaEngine";
import { BotAvatar } from "./BotAvatar";

type VoiceProps = {
  profile: Profile;
  citizenId: string | null;
  offline: boolean;
  lite: boolean;
  transcript: string;
  onAction: (action: UIAction) => void;
  onQueueAudio: (audio: Blob, locale: "en" | "ur") => Promise<string>;
};

/** One line of the conversation: what the person said, or what the assistant said back. */
type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

/** How many bubbles the reply shows before "view more" is needed. */
const VISIBLE_TURNS = 2;

export function VoiceDock({ profile, citizenId, offline, lite, transcript, onAction, onQueueAudio }: VoiceProps) {
  const [lang, setLang] = useState(profile.locale);
  const [input, setInput] = useState("");
  const [working, setWorking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [justFinished, setJustFinished] = useState(false);
  const finishedTimerRef = useRef<number | null>(null);
  const [stage, setStage] = useState("Relief assistant");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [clarify, setClarify] = useState<Extract<UIAction, { type: "ask_clarification" }> | null>(null);
  // The whole conversation, so the reply can read as a chat rather than one
  // answer that replaces the last.
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [chatHidden, setChatHidden] = useState(false);

  const storageKey = `relief_chat_history_${citizenId || profile.id || profile.role || "citizen"}`;

  // Load chat history from localStorage for each persona/citizen interaction
  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setTurns(parsed);
            setExpanded(true);
            setHasEngagedVoice(true);
          } else {
            setTurns([]);
          }
        } else {
          setTurns([]);
        }
      }
    } catch (e) {
      console.warn("Failed to load chat history from localStorage", e);
    }
  }, [storageKey]);

  // Persist chat history to localStorage on changes
  useEffect(() => {
    try {
      if (typeof window !== "undefined") {
        if (turns.length > 0) {
          localStorage.setItem(storageKey, JSON.stringify(turns));
        }
      }
    } catch (e) {
      console.warn("Failed to persist chat history to localStorage", e);
    }
  }, [turns, storageKey]);

  const [hasEngagedVoice, setHasEngagedVoice] = useState(false);
  const [clipRecording, setClipRecording] = useState(false);
  const [startingMic, setStartingMic] = useState(false);
  const [isMultiline, setIsMultiline] = useState(false);
  const micStart = useRef<AbortController | null>(null);
  const clip = useRef<{ recorder: MediaRecorder; source: MediaStream; timer: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const autoSendClipRef = useRef(true);
  const inputRef = useRef("");
  const liveSpeechRef = useRef("");
  // The assistant turn this run streams into.
  const assistantTurnId = useRef<string | null>(null);
  // How many spoken segments are still playing.
  const speechPending = useRef(0);
  // Whether the mic should reopen by itself once the assistant has finished
  // speaking, so a spoken conversation can carry on hands-free.
  const autoMicArmed = useRef(false);
  // The prompt this run was given, so a transcript left in the box can be told
  // apart from something the person typed afterwards.
  const sentPromptRef = useRef("");
  // Whether the draft in the box came from speech. The mic reopens after a
  // spoken exchange however the message was sent — by the mic button, by
  // pressing T, or by submitting the transcript that was left in the box.
  const draftFromVoice = useRef(false);

  const dgVoice = useVoiceStream(lang);
  const recording = dgVoice.listening || clipRecording;
  // Mirrors of the live state, so the mic can be reopened from a callback that
  // runs long after the render that scheduled it.
  const recordingRef = useRef(false);
  recordingRef.current = recording;
  const startingMicRef = useRef(false);
  startingMicRef.current = startingMic;

  useEffect(() => {
    inputRef.current = input;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const style = window.getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight) || 21.5;
    const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const maxHeight = Math.round(lineHeight * 5 + padY);
    const nextHeight = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${Math.max(40, nextHeight)}px`;
    setIsMultiline(nextHeight > 46);
  }, [input]);

  // Mark voice engaged as soon as user starts speaking or recording
  useEffect(() => {
    if (recording || dgVoice.partial || dgVoice.utterance || input.trim()) {
      setHasEngagedVoice(true);
    }
  }, [recording, dgVoice.partial, dgVoice.utterance, input]);

  // Stream live words into input box in real time as user speaks
  useEffect(() => {
    if (dgVoice.listening) {
      const live = [dgVoice.utterance, dgVoice.partial].filter(Boolean).join(" ").trim();
      if (live) {
        liveSpeechRef.current = live;
        draftFromVoice.current = true;
        setInput(live);
      }
    }
  }, [dgVoice.partial, dgVoice.utterance, dgVoice.listening]);

  // When Deepgram detects speech_final, keep latest text synced
  useEffect(() => {
    if (dgVoice.lastUtterance) {
      liveSpeechRef.current = dgVoice.lastUtterance;
      draftFromVoice.current = true;
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

  async function command(raw: string, viaVoice = false) {
    const prompt = raw.trim();
    if (!prompt) return;
    setExpanded(true);
    setChatHidden(false);
    setInput("");
    inputRef.current = "";
    liveSpeechRef.current = "";
    setError("");
    if (offline) {
      setInput(prompt);
      setStage("Offline · type or record for later");
      setError("Reconnect to run the assistant. You can still save claim changes.");
      return;
    }

    setTurns(current => [...current, { id: crypto.randomUUID(), role: "user", text: prompt }]);
    sentPromptRef.current = prompt;

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
    speechPending.current = 0;
    autoMicArmed.current = viaVoice || draftFromVoice.current;
    draftFromVoice.current = false;
    assistantTurnId.current = crypto.randomUUID();
    cuaEngine.cancel();
    setClarify(null);
    setWorking(true);
    setStage("Routing your request");
    let accumulatedAnswer = "";
    let spokenLength = 0;
    const run = { id: crypto.randomUUID(), controller: new AbortController() };
    active.current = run;
    try {
      const screenContext = cuaEngine.getScreenSnapshot();
      const response = await fetch("/api/agent/stream", {
        method: "POST", signal: run.controller.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, citizenId, runId: run.id, locale: lang, screenContext }),
      });
      if (!response.ok) {
        const failure = await response.json();
        throw new Error(failure.error || "Assistant unavailable.");
      }
      await receiveActions(response, event => {
        switch (event.type) {
          case "phase": break;
          case "tool_execution_start": break;
          case "tool_execution_end": break;
          case "message_update": {
            accumulatedAnswer += event.text;
            setChatHidden(false);

            // The answer streams into its own bubble as it arrives.
            const turnId = assistantTurnId.current;
            if (turnId) {
              setTurns(current => current.some(turn => turn.id === turnId)
                ? current.map(turn => turn.id === turnId ? { ...turn, text: accumulatedAnswer } : turn)
                : [...current, { id: turnId, role: "assistant", text: accumulatedAnswer }]);
            }

            // Stream TTS immediately: As soon as a complete sentence or clause arrives, start speaking!
            const unhandled = accumulatedAnswer.slice(spokenLength);
            const sentenceMatch = unhandled.match(/^(.*?[.!?۔\n]+)\s*/);
            if (sentenceMatch && sentenceMatch[1].trim().length > 3) {
              const sentence = sentenceMatch[1].trim();
              spokenLength += sentenceMatch[0].length;
              speak(sentence);
            }
            break;
          }
          case "error": setError(event.message); break;
          case "agent_settled": {
            setStage("Relief assistant");
            // Speak any trailing text that didn't end in punctuation
            const remaining = accumulatedAnswer.slice(spokenLength).trim();
            if (remaining.length > 0) speak(remaining);
            resumeMic();
            setJustFinished(true);
            if (finishedTimerRef.current) window.clearTimeout(finishedTimerRef.current);
            finishedTimerRef.current = window.setTimeout(() => setJustFinished(false), 2600);
            break;
          }
          case "ui_action": {
            if (event.action.type === "ask_clarification") {
              setClarify(event.action);
              // Counted like any other spoken segment, so the mic waits for the
              // question to finish being read out.
              speechPending.current += 1;
              setSpeaking(true);
              void speakText(event.action.question, lang, lite).then(() => {
                speechPending.current = Math.max(0, speechPending.current - 1);
                if (speechPending.current === 0) setSpeaking(false);
                resumeMic();
              });
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

  // Speak a chunk of the answer, keeping count of what is still playing so the
  // mic only reopens once the assistant has finished talking.
  function speak(text: string) {
    speechPending.current += 1;
    setSpeaking(true);
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      speechPending.current = Math.max(0, speechPending.current - 1);
      if (speechPending.current === 0) setSpeaking(false);
      resumeMic();
    };
    void queueSpeakSegment(text, lang, lite || offline).then(done);
    // A speech engine that never reports back must not hold the mic shut.
    window.setTimeout(() => done(), Math.max(10000, text.length * 250));
  }

  // The mic reopens by itself once the assistant has finished speaking, so a
  // spoken conversation carries on without another tap.
  function resumeMic() {
    if (!autoMicArmed.current) return;
    if (speechPending.current > 0) return;
    if (recordingRef.current || startingMicRef.current || micStart.current) return;
    // The transcript can linger in the box after it was sent. That is not the
    // person typing something new, so clear it and carry on; a genuinely new
    // draft means they are writing and the mic should stay shut.
    const typed = inputRef.current.trim();
    if (typed && typed !== sentPromptRef.current) return;
    if (typed) {
      setInput("");
      inputRef.current = "";
    }
    autoMicArmed.current = false;
    setStage("Relief assistant");
    void startRecording();
  }

  async function stopRecording(autoSend = true) {
    micStart.current?.abort();
    if (clip.current?.recorder.state === "recording") {
      autoSendClipRef.current = autoSend;
      clip.current.recorder.stop();
      return;
    }
    const flushed = await dgVoice.stopAndFlush();
    const textToSend = (flushed || liveSpeechRef.current || inputRef.current).trim();
    if (autoSend && textToSend && mounted.current) {
      void command(textToSend, true);
    }
  }

  async function startRecording() {
    if (recording || micStart.current) return;
    liveSpeechRef.current = "";
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
        const shouldSend = autoSendClipRef.current;
        autoSendClipRef.current = true;
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
            if (shouldSend) {
              void command(text, true);
            } else {
              setStage("Transcript ready");
            }
          }
        } catch (error) {
          setExpanded(true);
          setError(error instanceof Error ? error.message : "Recording could not be transcribed.");
        }
      };
      recorder.start();
      setError("");
      clip.current = { recorder, source, timer: window.setTimeout(() => {
        if (recorder.state === "recording") {
          autoSendClipRef.current = true;
          recorder.stop();
        }
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
  const endPushToTalk = useEffectEvent(() => {
    void stopRecording(true);
  });

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
    speechPending.current = 0;
    setSpeaking(false);
    setJustFinished(false);
    cuaEngine.cancel();
    // An explicit stop ends the exchange: the mic stays where the person left it.
    autoMicArmed.current = false;
    setWorking(false);
    setStage("Relief assistant");
    if (run) void fetch("/api/agent/stream", {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId: run.id, citizenId }),
    }).catch(() => {});
  }

  function choose(app: MiniApp) {
    onAction({ type: "open_mini_app", app });
    setClarify(null);
    stopSpeaking();
    speechPending.current = 0;
    setSpeaking(false);
  }

  /** Cancel whatever is in flight: the recording, the running request, or the
   *  draft in the box. */
  function cancel() {
    if (recording) void stopRecording(false);
    if (working) stop();
    stopSpeaking();
    speechPending.current = 0;
    setSpeaking(false);
    setJustFinished(false);
    autoMicArmed.current = false;
    setInput("");
    inputRef.current = "";
    liveSpeechRef.current = "";
    setError("");
    setClarify(null);
    setStage("Relief assistant");
  }

  function submit(event: FormEvent) { event.preventDefault(); void command(input); }

  // The conversation, newest last. Only the last couple of bubbles show until
  // "view more" opens the rest.
  const filledTurns = turns.filter(turn => turn.text.trim());
  const visibleTurns = historyOpen ? filledTurns : filledTurns.slice(-VISIBLE_TURNS);
  const hiddenCount = Math.max(0, filledTurns.length - VISIBLE_TURNS);
  const lastAssistantId = [...filledTurns].reverse().find(turn => turn.role === "assistant")?.id;

  return <section className={"voice-dock-glass" + (hasEngagedVoice ? " voice-revealed" : "") + (recording ? " is-recording" : "") + (working ? " is-working" : "") + (clarify ? " clarifying" : "")} aria-label="Relief voice assistant">
    {/* If chat has messages and is hidden by the user, show simple up button with white circle bg */}
    {chatHidden && filledTurns.length > 0 && (
      <div className="voice-bring-back-bar">
        <button
          type="button"
          className="voice-chat-restore-btn"
          onClick={() => setChatHidden(false)}
          aria-label="Show conversation"
          title="Show conversation"
        >
          <ChevronUp size={16} strokeWidth={2.6} />
        </button>
      </div>
    )}

    {expanded && (filledTurns.length > 0 || error || clarify) && !chatHidden && <div className="voice-reply-glass">
      <div className="voice-reply-header">
        {hiddenCount > 0 ? (
          <button type="button" className="voice-history-toggle" onClick={() => setHistoryOpen(open => !open)}>
            {historyOpen ? "Hide earlier messages" : `View ${hiddenCount} earlier message${hiddenCount === 1 ? "" : "s"}`}
          </button>
        ) : <span />}
        <button
          type="button"
          className="voice-hide-chat-btn"
          onClick={() => setChatHidden(true)}
          aria-label="Hide chat"
          title="Hide chat"
        >
          <ChevronDown size={14} />
          <span>Hide chat</span>
        </button>
      </div>
      <div className="voice-chat">
        {visibleTurns.map(turn => (
          <div key={turn.id} className={"voice-chat-turn " + turn.role}>
            <div className="voice-chat-body">
              <span className="voice-chat-role">{turn.role === "user" ? "You" : "Assistant"}</span>
              <p>{turn.text}</p>
            </div>
            {turn.role === "assistant" && turn.id === lastAssistantId && (
              <button
                type="button"
                className="glass-icon-btn"
                onClick={() => {
                  setSpeaking(true);
                  void speakText(turn.text.slice(0, 1400), lang, lite || offline).then(() => setSpeaking(false));
                }}
                aria-label="Play assistant response"
              >
                <Volume2 size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
      {clarify && <div><p className="clarify-title">{clarify.question}</p><div className="voice-options">{clarify.options.map(app => <button type="button" key={app} onClick={() => choose(app)}>{apps[app].title}</button>)}</div></div>}
      {error && <p className="voice-error" role="alert">{error}</p>}
    </div>}
    <div className="voice-glass-main">
      <form className={"voice-glass-form" + (isMultiline ? " multiline" : "")} onSubmit={submit}>
        <BotAvatar
          size={46}
          isWorking={working}
          isSpeaking={speaking}
          isListening={recording || startingMic}
          isDone={justFinished}
          className="voice-dock-bot-avatar"
          onClick={() => {
            textareaRef.current?.focus();
          }}
        />
        <textarea
          ref={textareaRef}
          rows={1}
          className="glass-voice-input"
          aria-label="Type a relief assistant command"
          placeholder={
            recording
              ? lang === "ur"
                ? "سن رہا ہے…"
                : "Listening…"
              : lang === "ur"
                ? "اپنے بوٹ سے کچھ بھی کہیں، یا بولنے کے لیے T دبائیں..."
                : "Ask your bot anything to do, or hold T to talk..."
          }
          value={input}
          maxLength={1000}
          onChange={event => {
            draftFromVoice.current = false;
            setInput(event.target.value);
          }}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void command(input);
            }
          }}
        />
        <button type="button" className="glass-lang-pill" aria-label="Switch voice language" onClick={() => setLang(value => value === "en" ? "ur" : "en")}>
          {lang === "ur" ? "اردو" : "EN"}
        </button>
        {(working || recording || input.trim()) && (
          <button type="button" className="glass-icon-btn" aria-label="Cancel" title="Cancel" onClick={cancel}>
            <X size={18} />
          </button>
        )}
        {/* Unified Record / Stop-and-Send / Send Action Button */}
        <button
          type={!recording && input.trim() ? "submit" : "button"}
          className={
            "glass-action-btn" +
            (recording ? " recording" : "") +
            (!recording && input.trim() ? " has-text" : "")
          }
          onClick={e => {
            if (!recording && input.trim()) {
              return;
            }
            e.preventDefault();
            if (recording) void stopRecording(true);
            else void startRecording();
          }}
          aria-label={
            recording
              ? "Stop recording and send"
              : input.trim()
                ? "Send message"
                : "Record voice (or hold T to talk)"
          }
          title={
            recording
              ? "Stop & send"
              : input.trim()
                ? "Send message"
                : "Record voice (or hold T to talk)"
          }
        >
          {recording ? (
            <Send size={20} />
          ) : input.trim() ? (
            <Send size={20} />
          ) : (
            <Mic size={24} />
          )}
        </button>
      </form>
    </div>
  </section>;
}
