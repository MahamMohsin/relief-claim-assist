import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyScam, routeIntent } from "../src/lib/ai/jev.ts";

test("Jev mock preserves decisions and abstains on conflicting intents", async () => {
  delete process.env.OPENROUTER_API_KEY;
  process.env.JEV_MOCK_MODE = "true";
  assert.deepEqual(await routeIntent("Show the policy for my claim"), {
    app: "policy", label: "policy", confidence: 0.94, model: "jev-simulated-v1",
  });
  assert.equal((await routeIntent("میری درخواست")).app, "claim");
  assert.equal((await routeIntent("بیواؤں کے لیے امداد کی پالیسی کیا ہے؟")).app, "policy");
  assert.equal((await routeIntent("Check that SMS and revoke consent")).app, null);
  assert((await routeIntent("Hmm perhaps")).confidence < 0.7);
  assert.equal((await classifyScam("Send your OTP now", "")).label, "scam");
});

test("Jev live adapter uses typed responses and fails closed on a provider error", async (context) => {
  process.env.OPENROUTER_API_KEY = "fixture-key";
  context.mock.method(globalThis, "fetch", async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.model, "typesafe/jev-1.14");
    assert.equal(request.questions.classification.type, "choice");
    assert.equal(request.questions.clarity.type, "score");
    assert.equal(request.questions.ambiguity.type, "noul");
    return Response.json({ model: "typesafe/jev-1.14-20261014", answers: {
      classification: { type: "choice", choice: "policy", confidence: 0.98, probabilities: { policy: 0.98 } },
      clarity: { type: "score", score: 2, probabilities: { "0": 0.02, "1": 0.13, "2": 0.85 } },
      ambiguity: { type: "noul", noul: 0.3 },
    } });
  });
  const result = await routeIntent("Policy question");
  assert.equal(result.app, "policy");
  assert.equal(result.confidence, 0.7);
  assert.equal(result.model, "typesafe/jev-1.14-20261014");

  globalThis.fetch.mock.mockImplementation(async () => new Response(null, { status: 503 }));
  const unavailable = await routeIntent("Policy question");
  assert.equal(unavailable.app, null);
  assert.equal(unavailable.confidence, 0);
  assert.match(unavailable.model, /unavailable$/);
  delete process.env.OPENROUTER_API_KEY;
});
