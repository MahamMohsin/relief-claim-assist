// Server-only module (imported from route handlers and instrumentation, never from client components).
import { createClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/utils/supabase/env";
import { ApiError } from "@/src/lib/server";
import { inspectEvidence } from "@/src/lib/ai/ocr";

// Background job queue. Jobs live in public.jobs and are reached only through
// public.relief_jobs(), which requires the server gateway secret (never exposed to browsers).

export type JobType = "evidence_ocr" | "claim_triage" | "notify";
type Job = { id: string; type: JobType; claim_id: string | null; payload: Record<string, unknown>; attempts: number; max_attempts: number };
type Fixture = "clear" | "blurred" | "altered" | "incomplete";

const TEST_FAIL_TOKEN = "#fail-job";
const testFailuresEnabled = () => process.env.RELIEF_JOB_TEST_FAILURES === "true";

function jobsClient() {
  const { url, key } = getSupabaseEnv();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function callJobs<T>(action: string, args: object = {}): Promise<T> {
  const proof = process.env.RELIEF_GATEWAY_SECRET;
  if (!proof) throw new ApiError(503, "The job queue is not configured.");
  const { data, error } = await jobsClient().rpc("relief_jobs", { action, args, proof });
  if (error) throw new ApiError(502, "Job queue error: " + (error.code ?? "") + " " + error.message);
  if (data && typeof data.status === "number" && typeof data.error === "string") throw new ApiError(data.status, data.error);
  return data as T;
}

// The queue is optional until the migration is applied: callers fall back to synchronous work.
let available: { value: boolean; checkedAt: number } | null = null;
export async function jobsAvailable() {
  if (available && Date.now() - available.checkedAt < 60_000) return available.value;
  let value = false;
  try { value = Boolean((await callJobs<{ ok?: boolean }>("ping")).ok); } catch { value = false; }
  available = { value, checkedAt: Date.now() };
  return value;
}

export function enqueueJob(type: JobType, dedupeKey: string, opts: { claimId?: string | null; payload?: object; delaySeconds?: number } = {}) {
  return callJobs<{ queued: boolean; id?: string }>("enqueue", {
    type, dedupeKey, claimId: opts.claimId ?? null, payload: opts.payload ?? {}, delaySeconds: opts.delaySeconds ?? 0,
  });
}

async function runEvidenceOcr(job: Job) {
  const input = await callJobs<{ documentId: string; docType: string; image: string | null; notes: string }>(
    "evidence_input", { documentId: job.payload.documentId });
  if (testFailuresEnabled() && input.notes.includes(TEST_FAIL_TOKEN)) throw new Error("Forced test failure (" + TEST_FAIL_TOKEN + ")");
  const fixture = typeof job.payload.fixture === "string" ? job.payload.fixture as Fixture : undefined;
  const analysis = await inspectEvidence(fixture ? { fixture, docType: input.docType } : { image: input.image ?? undefined, docType: input.docType });
  await callJobs("evidence_result", { documentId: input.documentId, analysis });
  return { waiting: false };
}

async function runClaimTriage(job: Job) {
  if (testFailuresEnabled() && String(job.payload.notes ?? "").includes(TEST_FAIL_TOKEN)) throw new Error("Forced test failure (" + TEST_FAIL_TOKEN + ")");
  const result = await callJobs<{ waiting?: boolean; skipped?: boolean; status?: string }>("triage", { claimId: job.claim_id });
  if (result.waiting) return { waiting: true };
  if (!result.skipped && job.claim_id) await enqueueJob("notify", "triage:" + job.id, { claimId: job.claim_id });
  return { waiting: false };
}

async function runNotify(job: Job) {
  await callJobs("notify", { claimId: job.claim_id });
  return { waiting: false };
}

const handlers: Record<JobType, (job: Job) => Promise<{ waiting: boolean }>> = {
  evidence_ocr: runEvidenceOcr,
  claim_triage: runClaimTriage,
  notify: runNotify,
};

let running: Promise<unknown> | null = null;

/** Claim and run due jobs (FOR UPDATE SKIP LOCKED in the database). Safe to call concurrently. */
export async function runJobs(limit = 5, rounds = 3) {
  if (running) return { ran: 0, skipped: "a run is already in progress in this process" };
  const work = (async () => {
    let ran = 0;
    const outcomes: { id: string; type: string; status: string; error?: string }[] = [];
    for (let round = 0; round < rounds; round++) {
      const jobs = await callJobs<Job[]>("claim", { limit });
      if (!jobs.length) break;
      for (const job of jobs) {
        ran++;
        try {
          const { waiting } = await handlers[job.type](job);
          const finished = await callJobs<{ status: string }>("finish", { jobId: job.id, ok: !waiting, waiting });
          outcomes.push({ id: job.id, type: job.type, status: finished.status });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown error";
          const finished = await callJobs<{ status: string }>("finish", { jobId: job.id, ok: false, error: message }).catch(() => ({ status: "finish_failed" }));
          outcomes.push({ id: job.id, type: job.type, status: finished.status, error: message });
        }
      }
    }
    return { ran, outcomes };
  })();
  running = work;
  try { return await work; } finally { running = null; }
}
