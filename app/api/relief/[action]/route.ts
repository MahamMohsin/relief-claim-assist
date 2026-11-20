import { actions, type Action } from "@/src/lib/contracts";
import { apiError, ApiError, gateway, readJson } from "@/src/lib/server";
import { answerPolicy } from "@/src/lib/ai/rag";
import { inspectEvidence } from "@/src/lib/ai/ocr";
import { classifyScam } from "@/src/lib/ai/jev";
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
    const body = await readJson(request, operation === "evidence" ? 3000000 : 20000);
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
        const analysis = await inspectEvidence(evidence);
        const { image, ...fields } = evidence;
        result = await gateway(operation, { ...fields, image, imageDigest: image ? await hashImage(image) : null, analysis });
        break;
      }
      case "check": {
        await gateway("raast", { reference: actions.check.parse(body).reference });
        const args = actions.check.parse(body);
        result = await gateway(operation, { ...args, classification: await classifyScam(args.message, args.reference) });
        break;
      }
      case "review": {
        const args = actions.review.parse(body);
        result = await gateway(operation, { ...args, reasonUr: args.reasonUr || reviewUrdu[args.decision] });
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
