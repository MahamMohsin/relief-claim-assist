import { api, HttpError, transcribe } from "@/src/lib/client";
import { complete, markRetry, queued, resolveDraft } from "./queue";

type SyncOptions = {
  owner: string;
  citizen: string;
  manual: boolean;
  signal: AbortSignal;
  onTranscript: (transcript: string) => void;
};

export async function syncQueue({ owner, citizen, manual, signal, onTranscript }: SyncOptions) {
  let synced = 0;
  const blocked = new Set<string>();
  for (const item of await queued(owner, citizen)) {
    if (signal.aborted) break;
    if (!manual && (item.failure || item.nextAttempt > Date.now())) continue;
    let claimId: string | undefined;
    if (item.dependsOn) {
      if (blocked.has(item.dependsOn)) continue;
      claimId = await resolveDraft(owner, item.dependsOn);
      if (!claimId) continue;
    }
    try {
      if (item.action === "transcribe" && item.audio) {
        const text = await transcribe(item.audio, item.body.locale === "en" ? "en" : "ur", signal);
        if (text) onTranscript(text);
        await complete(item);
      } else if (item.action !== "transcribe") {
        const response = await api<{ id?: string }>(item.action, { ...item.body, ...(claimId ? { claimId } : {}), key: item.id }, signal);
        await complete(item, response.id);
      }
      synced += 1;
    } catch (error) {
      if (signal.aborted) break;
      blocked.add(item.id);
      const permanent = error instanceof HttpError && error.status < 500 && ![408, 429].includes(error.status);
      await markRetry(item, permanent && error instanceof Error ? error.message : undefined);
      if (!permanent) break;
    }
  }
  return synced;
}
