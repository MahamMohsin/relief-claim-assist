
let playbackVersion = 0;
let scheduled = Promise.resolve("Ready");
let cancelPlayback: (() => void) | undefined;

export function stopSpeaking() {
  playbackVersion += 1;
  cancelPlayback?.();
  cancelPlayback = undefined;
  scheduled = Promise.resolve("Ready");
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

export function sanitizeSpeechText(text: string): string {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "")
    .replace(/\bID:?\s*/gi, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function queueSpeakSegment(text: string, locale: "en" | "ur", localOnly: boolean): Promise<string> {
  const clean = sanitizeSpeechText(text).slice(0, 1400);
  if (clean.length < 2) return Promise.resolve("Ready");
  const version = playbackVersion;
  scheduled = scheduled.then(async () => {
    if (version !== playbackVersion) return "Playback stopped";
    if (!localOnly) {
      try {
        const response = await fetch("/api/voice/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: clean, locale }),
          signal: AbortSignal.timeout(14000),
        });
        if (response.ok && response.headers.get("content-type")?.startsWith("audio/")) {
          const audio = await response.blob();
          if (version !== playbackVersion) return "Playback stopped";
          const url = URL.createObjectURL(audio);
          const player = new Audio(url);
          const played = await new Promise<boolean>(resolve => {
            const finish = (ok: boolean) => {
              player.pause();
              URL.revokeObjectURL(url);
              cancelPlayback = undefined;
              resolve(ok);
            };
            cancelPlayback = () => finish(false);
            player.onended = () => finish(true);
            player.onerror = () => finish(false);
            void player.play().catch(() => finish(false));
          });
          if (played) return "Spoken with Cartesia";
        }
      } catch { /* Browser speech handles unavailable upstream audio. */ }
    }
    if (version !== playbackVersion) return "Playback stopped";
    if (!("speechSynthesis" in window)) return "Speech playback is unavailable";
    const voice = window.speechSynthesis.getVoices().find(item => item.lang.toLowerCase().startsWith(locale));
    if (!voice && locale === "ur") return "Urdu speech is unavailable on this device";
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = voice?.lang ?? "en";
    if (voice) utterance.voice = voice;
    const spoken = await new Promise<boolean>(resolve => {
      const finish = (ok: boolean) => {
        if (version === playbackVersion) cancelPlayback = undefined;
        resolve(ok);
      };
      cancelPlayback = () => finish(false);
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);
      window.speechSynthesis.speak(utterance);
    });
    return version !== playbackVersion ? "Playback stopped" : spoken ? "Spoken with browser voice" : "Speech playback is unavailable";
  }).catch(() => "Speech playback is unavailable");
  return scheduled;
}

export function speakText(text: string, locale: "en" | "ur", localOnly: boolean) {
  stopSpeaking();
  return queueSpeakSegment(text, locale, localOnly);
}
