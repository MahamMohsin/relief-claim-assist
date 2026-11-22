import { after } from "next/server";
import { actions, type Action, type Profile } from "@/src/lib/contracts";
import { callJobs, enqueueJob, jobsAvailable, runJobs } from "@/src/lib/jobs";
import { apiError, ApiError, gateway, readJson } from "@/src/lib/server";
import { answerPolicy } from "@/src/lib/ai/rag";
import { inspectEvidence } from "@/src/lib/ai/ocr";
import { extractProfileDocument } from "@/src/lib/ai/profileVlm";
import { analyzeScamCheck } from "@/src/lib/ai/scamCheck";
import { runSafetyEval } from "@/src/lib/fixtures/safety";

const reviewUrdu = {
  assign: "ایک افسر نے آپ کی درخواست جائزے کے لیے لے لی ہے۔",
  more_proof: "افسر نے مزید ثبوت مانگے ہیں۔ تفصیلات انگریزی میں درج ہیں۔",
  escalate: "آپ کی درخواست مزید جانچ کے لیے بھیجی گئی ہے۔",
  approve: "افسر نے درخواست منظور کی ہے۔ فرضی ادائیگی کی صورت حال درخواست میں دیکھیں۔",
  reject: "افسر نے درخواست مسترد کی ہے۔ تفصیلی وجہ انگریزی میں درج ہے۔",
  close: "افسر نے درخواست کا جائزہ مکمل کر کے کیس بند کر دیا ہے۔",
};

export async function POST(request: Request, context: RouteContext<"/api/relief/[action]">) {
  try {
    const { action } = await context.params;
    if (!Object.hasOwn(actions, action)) throw new ApiError(404, "Unknown relief operation.");
    const operation = action as Action;
    const raw = await readJson(request, ["evidence", "check", "citizen_doc_upload"].includes(operation) ? 3000000 : 20000);
    // Writes accept the idempotency key as an Idempotency-Key header or as body.key (the database replays repeats).
    const headerKey = request.headers.get("idempotency-key");
    const body = headerKey && raw && typeof raw === "object" && !("key" in raw) ? { ...raw, key: headerKey } : raw;
    const checked = actions[operation].safeParse(body);
    if (!checked.success) throw new ApiError(400, checked.error.issues[0]?.message ?? "Invalid fields.");

    let result;
    switch (operation) {
      case "policy":
        result = await answerPolicy(actions.policy.parse(body).question);
        break;
      case "evidence": {
        const evidence = actions.evidence.parse(body);
        // Verify the current family grant before sending an image to a provider.
        await gateway("nadra", { citizenId: evidence.citizenId });
        if (evidence.image) validateImage(evidence.image);
        const { image, ...fields } = evidence;
        const imageDigest = image ? await hashImage(image) : null;
        if (await jobsAvailable()) {
          // Fast path: store the document as "processing" and run OCR / blur / tamper checks in the background.
          const queued = { status: "processing", summary: "Checking document…", model: "queued", fields: {} };
          const doc = await gateway<{ id: string; claim_id: string }>(operation, { ...fields, image, imageDigest, analysis: queued });
          await enqueueJob("evidence_ocr", doc.id, { claimId: doc.claim_id, payload: { documentId: doc.id, fixture: evidence.fixture ?? null } });
          after(() => runJobs().catch(() => {}));
          result = doc;
        } else {
          const analysis = await inspectEvidence(evidence);
          result = await gateway(operation, { ...fields, image, imageDigest, analysis });
        }
        break;
      }
      case "citizen_doc_upload": {
        const upload = actions.citizen_doc_upload.parse(body);
        await gateway("nadra", { citizenId: upload.citizenId });
        if (upload.image) validateImage(upload.image);
        const analysis = await extractProfileDocument({
          docType: upload.docType,
          image: upload.image,
          useSample: upload.useSample,
        });
        result = await gateway("citizen_doc_upload", {
          citizenId: upload.citizenId,
          docType: upload.docType,
          applyToCore: upload.applyToCore,
          image: upload.image ?? null,
          analysis,
        });
        break;
      }
      case "check": {
        const args = actions.check.parse(body);
        if (args.image) validateImage(args.image);
        result = await analyzeScamCheck(args);
        break;
      }
      case "review": {
        const args = actions.review.parse(body);
        result = await gateway(operation, { ...args, reasonUr: args.reasonUr || reviewUrdu[args.decision] });
        break;
      }
      case "submit": {
        const args = actions.submit.parse(body);
        const claim = await gateway<{ id: string; status: string; ai_route: string | null; citizen_reason_en: string | null; citizen_reason_ur: string | null }>(operation, args);
        if (await jobsAvailable() && ["submitted", "in_review", "needs_proof"].includes(claim.status)) {
          // Triage re-runs eligibility / registry / evidence routing once background document checks finish.
          await callJobs("mark_checking", { claimId: claim.id });
          await enqueueJob("claim_triage", "submit:" + args.key, { claimId: claim.id, payload: { notes: args.payload.notes } });
          after(() => runJobs().catch(() => {}));
          claim.ai_route = "checking";
          claim.citizen_reason_en = "Received. Checking your documents…";
          claim.citizen_reason_ur = "درخواست موصول ہو گئی۔ آپ کے کاغذات کی جانچ ہو رہی ہے۔";
        }
        result = claim;
        break;
      }
      case "job_history":
      case "job_stats": {
        const profile = await gateway<Profile>("profile");
        const allowed = operation === "job_history" ? ["officer", "admin", "auditor"] : ["admin", "auditor"];
        if (!allowed.includes(profile.role)) throw new ApiError(403, "Your role does not have access to this operation.");
        if (!(await jobsAvailable())) { result = operation === "job_history" ? [] : null; break; }
        result = operation === "job_history"
          ? await callJobs("history", { claimId: actions.job_history.parse(body).claimId })
          : await callJobs("stats");
        break;
      }
      case "safety":
        await gateway("audit");
        result = runSafetyEval();
        break;
      default:
        result = await gateway(operation, checked.data);
    }
    return Response.json(result);
  } catch (error) {
    return apiError(error);
  }
}

async function hashImage(image: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(image));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function validateImage(image: string) {
  const [header, encoded] = image.split(",");
  const prefix = Buffer.from(encoded.slice(0, 20), "base64");
  const looksValid = (header.includes("image/png") && prefix.subarray(0, 8).toString("hex") === "89504e470d0a1a0a")
    || (header.includes("image/jpeg") && prefix.subarray(0, 3).toString("hex") === "ffd8ff")
    || (header.includes("image/webp") && prefix.toString("ascii", 0, 4) === "RIFF" && prefix.toString("ascii", 8, 12) === "WEBP");
  if (!looksValid) throw new ApiError(400, "Choose a valid PNG, JPEG, or WebP image.");
}
