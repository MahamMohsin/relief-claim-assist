import { api, isOwnerMismatch, isRetryable, QUEUE_OWNER_HEADER, REQUEST_TIMEOUT_MS, transcribe } from "@/src/lib/client";
import { complete, markRetry, queued, queuedForOwner, resolveDraft } from "./queue";

type SyncOptions = {
  owner: string;
  citizen: string;
  manual: boolean;
  /** Retry now, ignoring backoff (reconnect / app focus), but skip items that failed permanently. */
  flush?: boolean;
  /** Helper "Sync now": send this user's items for every family (each keeps its own family id). */
  allFamilies?: boolean;
  signal: AbortSignal;
  onTranscript: (transcript: string) => void;
};

export async function syncQueue({ owner, citizen, manual, flush = false, allFamilies = false, signal, onTranscript }: SyncOptions) {
  let synced = 0;
  let ownerMismatch = false;
  const blocked = new Set<string>();
  for (const item of await (allFamilies ? queuedForOwner(owner) : queued(owner, citizen))) {
    if (signal.aborted) break;
    if (item.owner !== owner) continue;
    // A voice note belongs to the session it was recorded in; only replay it into that family's session.
    if (item.action === "transcribe" && item.citizen !== citizen) continue;
    if (!manual && (item.failure || (!flush && item.nextAttempt > Date.now()))) continue;
    let claimId: string | undefined;
    if (item.dependsOn) {
      if (blocked.has(item.dependsOn)) continue;
      claimId = await resolveDraft(owner, item.dependsOn);
      if (!claimId) continue;
    }
    try {
      if (item.action === "transcribe" && item.audio) {
        const text = await transcribe(item.audio, item.body.locale === "en" ? "en" : "ur", signal, REQUEST_TIMEOUT_MS);
        if (text) onTranscript(text);
        await complete(item);
      } else if (item.action !== "transcribe") {
        const response = await api<{ id?: string }>(item.action, { ...item.body, ...(claimId ? { claimId } : {}), key: item.id }, signal,
          { [QUEUE_OWNER_HEADER]: item.owner });
        await complete(item, response.id);
      }
      synced += 1;
    } catch (error) {
      if (signal.aborted) break;
      // A different account is signed in now: keep the item untouched for its owner and stop sending.
      if (isOwnerMismatch(error)) { ownerMismatch = true; break; }
      blocked.add(item.id);
      const permanent = !isRetryable(error);
      await markRetry(item, permanent && error instanceof Error ? error.message : undefined);
      if (!permanent) break;
    }
  }
  return { synced, ownerMismatch };
}
