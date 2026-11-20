let current: HTMLAudioElement | undefined;
let playbackVersion = 0;

export function stopSpeaking() {
  playbackVersion += 1;
  if (current) {
    current.pause();
    URL.revokeObjectURL(current.src);
    current = undefined;
  }
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

export async function speakText(text: string, locale: "en" | "ur", localOnly: boolean) {
  stopSpeaking();
  const version = playbackVersion;
  if (!localOnly) {
    try {
      const response = await fetch("/api/voice/tts", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, locale }),
      });
      if (version !== playbackVersion) return "Playback stopped";
      if (response.ok) {
        const audio = await response.blob();
        if (version !== playbackVersion) return "Playback stopped";
        const url = URL.createObjectURL(audio);
        current = new Audio(url);
        current.onended = () => URL.revokeObjectURL(url);
        await current.play();
        return "Speaking · Cartesia";
      }
    } catch { /* Browser speech can take over when the provider cannot play. */ }
  }
  if (version !== playbackVersion) return "Playback stopped";
  if ("speechSynthesis" in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = locale === "ur" ? "ur-PK" : "en-PK";
    const voices = window.speechSynthesis.getVoices();
    const matching = voices.find(voice => voice.lang.startsWith(locale));
    if (matching) utterance.voice = matching;
    if (locale === "ur" && voices.length && !matching) return "Urdu speech is unavailable on this device.";
    window.speechSynthesis.speak(utterance);
    return "Speaking · browser fallback";
  }
  return "Speech playback is unavailable on this device.";
}
