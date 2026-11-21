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
 * Remove UUIDs and ugly identifiers from speech before sending to Cartesia/TTS
 */
export function sanitizeSpeechText(text: string): string {
  return text
    // Remove UUID patterns (e.g., 3a97da52-0cf7-4645-b3df-22e990785f36)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "")
    // Remove "ID:" or "ID" prefixes left behind
    .replace(/\bID:?\s*/gi, "")
    // Clean up empty parentheses or awkward leftover punctuation
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Queue a speech segment to play sequentially as sentences stream in.
 * Cartesia is exclusively used for speech. Fallback to browser SpeechSynthesis is disabled
 * so no random robot voices speak over Cartesia.
 */
export async function queueSpeakSegment(text: string, locale: "en" | "ur", localOnly: boolean): Promise<void> {
  const clean = sanitizeSpeechText(text);
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
      /* Do not fall back to browser robot voice */
    }
  }
}

export async function speakText(text: string, locale: "en" | "ur", localOnly: boolean) {
  stopSpeaking();
  await queueSpeakSegment(text, locale, localOnly);
  return "Speaking · Cartesia";
}
