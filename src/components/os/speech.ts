let playbackVersion = 0;
const audioQueue: HTMLAudioElement[] = [];

export function stopSpeaking() {
  playbackVersion += 1;
  while (audioQueue.length > 0) {
    const item = audioQueue.shift();
    if (item) {
      item.pause();
      URL.revokeObjectURL(item.src);
    }
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

/**
 * Queue a speech segment to play sequentially as sentences stream in.
 */
export async function queueSpeakSegment(text: string, locale: "en" | "ur", localOnly: boolean): Promise<void> {
  const clean = text.trim();
  if (!clean || clean.length < 2) return;

  const version = playbackVersion;
  if (!localOnly) {
    try {
      const response = await fetch("/api/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clean, locale }),
      });
      if (version !== playbackVersion) return;
      if (response.ok) {
        const audio = await response.blob();
        if (version !== playbackVersion) return;
        const url = URL.createObjectURL(audio);
        const player = new Audio(url);

        await new Promise<void>(resolve => {
          player.onended = () => {
            URL.revokeObjectURL(url);
            resolve();
          };
          player.onerror = () => {
            URL.revokeObjectURL(url);
            resolve();
          };

          if (audioQueue.length === 0) {
            audioQueue.push(player);
            player.play().catch(resolve);
          } else {
            audioQueue.push(player);
            const check = setInterval(() => {
              if (version !== playbackVersion) {
                clearInterval(check);
                resolve();
                return;
              }
              if (audioQueue[0] === player) {
                clearInterval(check);
                player.play().catch(resolve);
              }
            }, 50);
          }
        });

        const idx = audioQueue.indexOf(player);
        if (idx !== -1) audioQueue.splice(idx, 1);
        return;
      }
    } catch {
      /* Fallback to browser below if needed */
    }
  }

  if (version !== playbackVersion) return;
  if ("speechSynthesis" in window) {
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = locale === "ur" ? "ur-PK" : "en-US";
    const voices = window.speechSynthesis.getVoices();
    const matching = voices.find(voice => voice.lang.startsWith(locale));
    if (matching) utterance.voice = matching;
    window.speechSynthesis.speak(utterance);
  }
}

export async function speakText(text: string, locale: "en" | "ur", localOnly: boolean) {
  stopSpeaking();
  await queueSpeakSegment(text, locale, localOnly);
  return "Speaking · Cartesia";
}
