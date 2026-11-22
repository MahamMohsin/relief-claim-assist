import { timingSafeEqual } from "node:crypto";
import { runJobs } from "@/src/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Background worker endpoint. Not callable by users: it requires the server gateway secret
// (x-worker-secret header) or, for a hosted cron, `Authorization: Bearer <CRON_SECRET>`.
function authorized(request: Request) {
  const same = (a: string | null | undefined, b: string | undefined) => {
    if (!a || !b) return false;
    const left = Buffer.from(a), right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  };
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return same(request.headers.get("x-worker-secret"), process.env.RELIEF_GATEWAY_SECRET)
    || same(bearer, process.env.CRON_SECRET);
}

async function handle(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Not found." }, { status: 404 });
  try {
    return Response.json(await runJobs(10, 5));
  } catch (error) {
    console.error("Job worker failed", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "The job worker could not run." }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle; // hosted crons (e.g. Vercel Cron) send GET
