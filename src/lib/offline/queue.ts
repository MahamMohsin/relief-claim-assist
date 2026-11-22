import { openDB, type DBSchema } from "idb";
import type { Payload } from "@/src/lib/contracts";

export type Mutation = {
  id: string;
  owner: string;
  citizen: string;
  action: "draft" | "submit" | "evidence" | "report" | "consent" | "correction" | "transcribe";
  body: Record<string, unknown>;
  audio?: Blob;
  dependsOn?: string;
  created: number;
  retries: number;
  nextAttempt: number;
  failure?: string;
};
export type LocalDraft = { claimId: string | null; pendingDraftId?: string; payload: Partial<Payload> };
interface ReliefDB extends DBSchema {
  mutations: { key: string; value: Mutation };
  drafts: { key: string; value: LocalDraft };
  aliases: { key: string; value: string };
}

let opened: ReturnType<typeof openDB<ReliefDB>> | undefined;
function database() {
  opened ??= openDB<ReliefDB>("relief-assist", 1, {
    upgrade(db) {
      db.createObjectStore("mutations", { keyPath: "id" });
      db.createObjectStore("drafts");
      db.createObjectStore("aliases");
    },
  });
  return opened;
}

const scope = (owner: string, citizen: string) => owner + "/" + citizen;

export async function getDraft(owner: string, citizen: string) {
  return (await database()).get("drafts", scope(owner, citizen));
}

export async function saveDraft(owner: string, citizen: string, draft: LocalDraft) {
  await (await database()).put("drafts", draft, scope(owner, citizen));
}

export async function wipeDraft(owner: string, citizen: string) {
  await (await database()).delete("drafts", scope(owner, citizen));
}

export async function resolveDraft(owner: string, id: string) {
  return (await database()).get("aliases", owner + "/" + id);
}

export async function pushMutation(item: Omit<Mutation, "created" | "retries" | "nextAttempt">) {
  await (await database()).put("mutations", { ...item, created: Date.now(), retries: 0, nextAttempt: 0 });
}

export async function queued(owner: string, citizen: string) {
  return (await (await database()).getAll("mutations"))
    .filter(item => item.owner === owner && item.citizen === citizen)
    .sort((first, second) => first.created - second.created);
}

export async function complete(item: Mutation, claimId?: string) {
  const db = await database();
  const tx = db.transaction(["mutations", "aliases", "drafts"], "readwrite");
  if (claimId && item.action === "draft") {
    await tx.objectStore("aliases").put(claimId, item.owner + "/" + item.id);
    const key = scope(item.owner, item.citizen);
    const draft = await tx.objectStore("drafts").get(key);
    if (draft?.pendingDraftId === item.id) {
      await tx.objectStore("drafts").put({ payload: draft.payload, claimId }, key);
    }
  }
  await tx.objectStore("mutations").delete(item.id);
  await tx.done;
}

// Outbox retry policy: exponential backoff 2s, 4s, 8s, 16s … capped at 60s, at most 8 attempts.
export const MAX_ATTEMPTS = 8;
export const backoffMs = (retries: number) => Math.min(60000, 2000 * 2 ** retries);

export async function markRetry(item: Mutation, message?: string) {
  const retries = item.retries + 1;
  await (await database()).put("mutations", {
    ...item, retries,
    nextAttempt: Date.now() + backoffMs(item.retries),
    failure: message ?? (retries >= MAX_ATTEMPTS ? "Could not send after " + MAX_ATTEMPTS + " attempts. Tap Sync now to try again." : undefined),
  });
}
