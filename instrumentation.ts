// Fallback job poller: every 60s, run any due background jobs (retries, missed kicks).
// Works for `next dev` / `next start` on a long-running Node server. On serverless hosts,
// call GET/POST /api/jobs/run from a cron instead (Bearer CRON_SECRET). Disable with RELIEF_JOB_POLLER=off.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.RELIEF_JOB_POLLER === "off") return;
  const state = globalThis as typeof globalThis & { __reliefJobPoller?: ReturnType<typeof setInterval> };
  if (state.__reliefJobPoller) return;
  const { jobsAvailable, runJobs } = await import("./src/lib/jobs");
  state.__reliefJobPoller = setInterval(() => {
    void jobsAvailable().then(ok => (ok ? runJobs(10, 5) : null)).catch(() => {});
  }, 60_000);
}
