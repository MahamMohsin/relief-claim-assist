import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium, request } from "playwright";

const contexts = [];
let server;
let browser;
let base = process.env.RELIEF_TEST_BASE_URL;
const synthetic = "10000000-0000-4000-a000-000000000001";
const testLabel = "Synthetic workflow " + randomUUID().slice(0, 7);
const contents = { monthly_income: 14500, household_size: 3, notes: testLabel };

async function startServer() {
  if (base) return;
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "0"], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    const limit = setTimeout(() => reject(new Error("Next.js ready timeout")), 25000);
    let output = "";
    server.once("error", reject);
    server.once("exit", code => { clearTimeout(limit); reject(new Error("Next.js exited: " + code)); });
    server.stdout.on("data", data => {
      output += data.toString();
      const address = output.match(/http:\/\/(?:localhost|127\.0\.0\.1):\d+/)?.[0];
      if (address && output.includes("Ready in")) {
        base = address;
        clearTimeout(limit);
        resolve();
      }
    });
  });
}

async function actor(persona) {
  const context = await request.newContext({ baseURL: base });
  contexts.push(context);
  const response = await context.post("/api/auth/demo", { data: { persona } });
  assert.equal(response.status(), 200, persona + ": " + await response.text());
  return context;
}

async function call(context, action, data = {}, status = 200) {
  const response = await context.post("/api/relief/" + action, { data });
  const body = await response.json();
  assert.equal(response.status(), status, action + ": " + (body?.error ?? "unexpected status"));
  return body;
}

async function draft(citizen, note = testLabel) {
  return call(citizen, "draft", { key: randomUUID(), payload: { ...contents, notes: note } });
}

async function evidence(citizen, item, fixture = "clear") {
  return call(citizen, "evidence", { claimId: item.id, key: randomUUID(), docType: "identity", fixture });
}

async function directSupabase(context, path, options) {
  return context.fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + path, {
    ...options, timeout: 20000, maxRetries: 2,
  });
}

async function testApi() {
  const [citizen, officer, admin, auditor, helper, shop] = await Promise.all(
    ["fatima", "bilal", "sana", "kamran", "zainab", "tariq"].map(actor),
  );
  const guest = await request.newContext({ baseURL: base });
  contexts.push(guest);
  const noVerifier = await guest.get("/auth/callback?code=" + randomUUID(), { maxRedirects: 0 });
  assert.equal(noVerifier.status(), 307);
  assert.equal(noVerifier.headers().location, new URL("/login?confirmation=signin", base).href);
  await call(guest, "profile", {}, 401);
  const profile = await call(citizen, "profile");
  assert.equal(profile.role, "citizen");
  assert.equal(profile.citizen_id, synthetic);

  const originalRule = (await call(admin, "rules")).find(rule => rule.is_active);
  const claim = await draft(citizen);
  await evidence(citizen, claim);
  const submission = { claimId: claim.id, key: randomUUID(), payload: contents };
  const concurrent = await Promise.all(Array.from({ length: 3 }, () => call(citizen, "submit", submission)));
  assert(concurrent.every(item => item.id === claim.id && item.status === "submitted"));
  await call(citizen, "submit", { ...submission, payload: { ...contents, notes: "Changed replay" } }, 409);
  const duplicates = (await call(citizen, "claims")).filter(item => item.id === claim.id);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].rule_version_used, originalRule.version);
  await call(citizen, "review", { claimId: claim.id, decision: "approve", reason: "This role is unauthorized." }, 403);
  await call(auditor, "disburse", { claimId: claim.id }, 403);
  await call(officer, "disburse", { claimId: claim.id }, 409);

  assert((await call(officer, "queue")).some(item => item.id === claim.id));
  const approved = await call(officer, "review", { claimId: claim.id, decision: "approve", reason: "Verified synthetic evidence against the active rules." });
  assert.equal(approved.status, "approved");
  assert.equal(approved.payment_status, "pending");
  const failedPayment = await call(officer, "disburse", { claimId: claim.id, outcome: "failed" });
  assert.equal(failedPayment.payment_status, "failed");
  await call(citizen, "disburse", { claimId: claim.id }, 403);
  const paid = await call(officer, "disburse", { claimId: claim.id });
  assert.equal(paid.payment_status, "paid");
  await call(officer, "disburse", { claimId: claim.id }, 409);
  const receipt = (await call(citizen, "claims")).find(item => item.id === claim.id).payment;
  assert(receipt.raast_ref.startsWith("SIM-"));
  await call(citizen, "overview", {}, 403);
  for (const staff of [officer, admin, auditor]) {
    const overview = await call(staff, "overview");
    assert(overview.paid > 0 && Number.isInteger(overview.active));
  }
  await call(admin, "staff_queue");
  await call(auditor, "staff_queue", {}, 403);

  const verdict = await call(shop, "check", { message: "Raast credited the simulated payment.", reference: receipt.raast_ref });
  assert.equal(verdict.rail_match_status, "paid");
  const phishing = await call(shop, "check", { message: "Send your OTP to claim aid at https://fake-aid.example.", reference: "" });
  assert.equal(phishing.jev_label, "scam");
  assert.equal(phishing.payment, null);
  const report = await call(shop, "report", { key: randomUUID(), reference: receipt.raast_ref });
  assert.equal(report.claim_id, claim.id);
  assert.equal(report.missing_payment_reported, true);
  console.log("PASS claim draft, concurrent retries, restricted review, approval, mock disbursement, and scam report");

  const blurry = await draft(citizen, testLabel + " blurry");
  await evidence(citizen, blurry, "blurred");
  const proof = await call(citizen, "submit", { key: randomUUID(), claimId: blurry.id, payload: contents });
  assert.equal(proof.status, "needs_proof");
  assert(proof.ai_confidence < 0.7 && proof.handoff_notes.length);
  await call(officer, "review", { claimId: blurry.id, decision: "approve", reason: "Approval should require clearer proof." }, 409);
  await evidence(citizen, blurry);
  const proofReplaced = await call(citizen, "submit", { key: randomUUID(), claimId: blurry.id, payload: contents });
  assert.equal(proofReplaced.status, "submitted");

  const tampered = await draft(citizen, testLabel + " altered");
  await evidence(citizen, tampered, "altered");
  const flagged = await call(citizen, "submit", { key: randomUUID(), claimId: tampered.id, payload: contents });
  assert.equal(flagged.status, "in_review");
  assert.equal(flagged.payment_status, "pending");
  assert(flagged.ai_confidence < 0.7 && /altered/i.test(flagged.handoff_notes));
  await call(officer, "review", { claimId: tampered.id, decision: "reject", reason: "Mock alteration confirmed by the demo officer." });
  console.log("PASS blurry proof replacement and alteration handoff without automatic payout");

  const uploadedDraft = await draft(citizen, testLabel + " vision attachment");
  const image = await readFile(new URL("./fixtures/synthetic-income.png", import.meta.url));
  const uploaded = await call(citizen, "evidence", { claimId: uploadedDraft.id, key: randomUUID(),
    docType: "income", image: "data:image/png;base64," + image.toString("base64") });
  assert(uploaded.file_url?.startsWith("/api/relief/evidence-file/"));
  const privateFile = await citizen.get(uploaded.file_url);
  assert.equal(privateFile.status(), 200);
  assert.deepEqual(await privateFile.body(), image);
  assert.equal((await officer.get(uploaded.file_url)).status(), 403);
  assert.equal((await auditor.get(uploaded.file_url)).status(), 403);
  await call(citizen, "submit", { key: randomUUID(), claimId: uploadedDraft.id, payload: contents });
  assert.equal((await officer.get(uploaded.file_url)).status(), 200);
  assert.equal(uploaded.ocr_json.model, process.env.ANTHROPIC_MODEL, JSON.stringify(uploaded.ocr_json));
  console.log("PASS live MiMo vision and private evidence reads for authorized roles");

  const directory = await call(helper, "families");
  assert.equal(directory.length, 40);
  const aliasFamily = directory.find(item => item.full_name === "Muhammad Ali");
  assert(aliasFamily);
  const aliasDraft = await call(helper, "draft", { key: randomUUID(), citizenId: aliasFamily.id, payload: contents });
  await call(helper, "evidence", { key: randomUUID(), citizenId: aliasFamily.id, claimId: aliasDraft.id, docType: "identity", fixture: "clear" });
  const duplicateIdentity = await call(helper, "submit", { key: randomUUID(), citizenId: aliasFamily.id, claimId: aliasDraft.id, payload: contents });
  assert.equal(duplicateIdentity.status, "in_review");
  assert.match(duplicateIdentity.handoff_notes, /another family/i);
  const helperId = (await call(helper, "profile")).id;
  const grant = (consent) => call(citizen, "consent", { key: randomUUID(), citizenId: synthetic, helperId, consent });
  const initiallyGranted = directory.find(item => item.id === synthetic).consent === "granted";
  try {
    if (!initiallyGranted) await grant("granted");
    await call(helper, "switch_family", { citizenId: synthetic });
    const replay = { key: randomUUID(), citizenId: synthetic, payload: contents };
    await call(helper, "draft", replay);
    await grant("revoked");
    await call(helper, "claims", { citizenId: synthetic }, 403);
    await call(helper, "draft", replay, 403);
    const events = await call(auditor, "audit");
    assert(events.some(row => row.event_type === "consent_revoked" && row.entity_id === synthetic));
    assert(events.some(row => row.event_type === "access_denied" && row.actor_role === "helper"));
  } finally { await grant(initiallyGranted ? "granted" : "revoked"); }

  const cited = await call(citizen, "policy", { question: "What is the household income cap?" });
  assert(cited.citations.some(section => section.section_code === "A2"));
  assert.equal(cited.policy_version, "2026.1");
  const urduPolicy = await call(citizen, "policy", { question: "بیواؤں کے لیے امداد کی پالیسی کیا ہے؟" });
  assert(urduPolicy.citations.some(section => section.section_code === "A3"));
  const blank = await call(citizen, "policy", { question: "Can I finance a telescope on Jupiter?" });
  assert.equal(blank.answer, "The official policy does not cover this.");
  assert.equal(blank.citations.length, 0);
  const metrics = await call(auditor, "safety");
  assert.deepEqual(metrics.map(row => row.threshold), [0.9, 0.7]);
  assert(metrics.every(row => row.bad_approvals === 0 && row.smsCount >= 15));
  await call(auditor, "publish", { name: "Forbidden publish", config: originalRule.config_json }, 403);

  const auditProfile = await call(auditor, "profile");
  const signIn = await directSupabase(guest, "/auth/v1/token?grant_type=password", {
    method: "POST", headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" },
    data: { email: "kamran@relief-demo.example", password: process.env.RELIEF_DEMO_PASSWORD },
  });
  const token = (await signIn.json()).access_token;
  assert(token && auditProfile.role === "auditor");
  const auditMutation = await directSupabase(guest, "/rest/v1/audit_logs?id=eq.1", {
    method: "PATCH", headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + token,
      "Content-Type": "application/json" }, data: { outcome: "attempted test mutation" },
  });
  assert([401, 403, 404].includes(auditMutation.status()));
  console.log("PASS family isolation, live consent revocation and audit, cited policy and abstention, read-only audit");

  const proposed = { ...originalRule.config_json, income_cap: 1000 };
  const impact = await call(admin, "simulate", { config: proposed });
  assert(impact.some(item => item.claim_id === claim.id && item.before && !item.after));
  const next = await call(admin, "publish", { name: originalRule.name + " test", config: proposed });
  try {
    assert(next.version > originalRule.version);
    const after = await draft(citizen, testLabel + " after rule");
    await evidence(citizen, after);
    const revised = await call(citizen, "submit", { key: randomUUID(), claimId: after.id, payload: contents });
    assert.equal(revised.rule_version_used, next.version);
    assert.match(revised.handoff_notes, /outside/);
    const records = await call(citizen, "claims");
    assert.equal(records.find(item => item.id === claim.id).rule_version_used, originalRule.version);
  } finally {
    await call(admin, "publish", { name: originalRule.name, config: originalRule.config_json });
  }
  const publicScheme = await guest.get("/api/v1/scheme");
  assert.equal(publicScheme.status(), 401);
  const keyed = await guest.get("/api/v1/scheme", { headers: { "x-api-key": process.env.RELIEF_PARTNER_KEY } });
  assert.equal(keyed.status(), 200, await keyed.text());
  assert.equal((await keyed.json()).simulated, true);
  console.log("PASS rule simulation, version publishing and restoration, historical trace, scoped API");

  const stream = await citizen.post("/api/agent/stream", { data: {
    prompt: "What is the policy for widows? Look up the policy section and cite it.", locale: "en", runId: randomUUID(),
  }, timeout: 65000 });
  assert.equal(stream.status(), 200);
  const events = (await stream.text()).split("\n\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
  assert(events.some(event => event.type === "tool_execution_end" && event.tool === "policy_rag_search"), JSON.stringify(events));
  assert(events.some(event => event.type === "agent_settled" && event.model === process.env.ANTHROPIC_MODEL), JSON.stringify(events));
  assert.match(events.filter(event => event.type === "message_update").map(event => event.text).join(""), /A3|widow/i);
  const clarification = await citizen.post("/api/agent/stream", { data: { prompt: "Hmm perhaps", locale: "en", runId: randomUUID() } });
  const clarificationText = await clarification.text();
  assert.match(clarificationText, /ask_clarification/);
  assert.doesNotMatch(clarificationText, /tool_execution_start/);
  console.log("PASS live Pi/MiMo tool execution, SSE, policy navigation, and low-confidence clarification");

  const audio = await readFile(process.env.RELIEF_TEST_AUDIO ?? new URL("./fixtures/synthetic-english.wav", import.meta.url));
  const voice = await citizen.post("/api/voice/stt?lang=en", { headers: { "Content-Type": "audio/wav" }, data: audio, timeout: 30000 });
  assert.equal(voice.status(), 200, await voice.text());
  const answer = await voice.json();
  assert.match(answer.transcript, /relief|claim|payment/i);
  console.log("PASS live Deepgram Nova-3 transcription of synthetic English voice");

  const speech = await citizen.post("/api/voice/tts", { data: { text: "This is a simulated relief payment.", locale: "en" } });
  if (!process.env.CARTESIA_API_KEY || !process.env.CARTESIA_VOICE_EN) {
    assert.equal((await speech.json()).fallback, "browser");
    console.log("PASS Cartesia-unconfigured browser speech fallback");
  } else {
    assert.equal(speech.status(), 200);
    assert.match(speech.headers()["content-type"], /audio\/mpeg/);
    console.log("PASS live Cartesia speech response");
  }
}

async function testBrowser() {
  browser = await chromium.launch({
    channel: process.env.RELIEF_BROWSER_CHANNEL || "chrome", headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-file-for-fake-audio-capture=" + fileURLToPath(new URL("./fixtures/synthetic-english.wav", import.meta.url))],
  });
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", permissions: ["microphone"] });
  const runtimeErrors = [];
  for (const tab of [desktop, page]) {
    tab.on("pageerror", error => runtimeErrors.push(error.message));
    await tab.goto(base);
    await tab.getByRole("heading", { name: "Enter the demo" }).waitFor();
    assert(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Unexpected horizontal page overflow");
  }
  await desktop.goto(base + "/docs");
  await desktop.getByRole("button", { name: "Authorize" }).first().waitFor();
  await page.keyboard.press("Tab");
  assert(await page.evaluate(() => Boolean(document.activeElement?.matches(":focus-visible"))));
  const fatima = page.getByTitle("Log in instantly as Fatima Bibi (citizen)", { exact: true });
  await fatima.click();
  await fatima.waitFor({ state: "hidden" });
  const accountMenu = page.getByRole("button", { name: "Account menu" });
  await accountMenu.focus();
  await page.keyboard.press("Enter");
  assert.equal(await accountMenu.getAttribute("aria-expanded"), "true");
  await page.keyboard.press("Enter");
  const mainNav = page.locator(".macos-menu-center");
  assert.equal(await mainNav.getByRole("button", { name: "Audit", includeHidden: true }).count(), 0);
  const language = page.getByRole("button", { name: "Switch voice language" });
  if ((await language.textContent())?.trim() !== "EN") await language.click();
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  const started = page.waitForResponse(response => response.url().endsWith("/api/voice/relay") && response.request().method() === "POST");
  await page.keyboard.down("t");
  const live = await started;
  assert.equal(live.status(), 201, "The live Deepgram relay did not start");
  await page.getByText("Listening · Deepgram", { exact: true }).waitFor();
  await page.waitForFunction(() => /relief|claim|payment/i.test(document.querySelector(".glass-voice-input")?.value ?? ""),
    undefined, { timeout: 20000 });
  await page.keyboard.up("t");
  await page.getByRole("button", { name: "Stop recording" }).waitFor({ state: "hidden" });
  await page.getByRole("textbox", { name: "Type a relief assistant command" }).fill("");
  await page.getByRole("button", { name: "2G Lite mode" }).click();
  await page.getByRole("button", { name: "Record voice (or press T to talk)", exact: true }).click();
  const stopMic = page.getByRole("button", { name: "Stop recording", exact: true });
  await stopMic.waitFor();
  await new Promise(resolve => setTimeout(resolve, 3200));
  await stopMic.click();
  await page.waitForFunction(() => /relief|claim|payment/i.test(document.querySelector(".glass-voice-input")?.value ?? ""),
    undefined, { timeout: 30000 });
  await page.getByRole("button", { name: "Relief Claim", exact: true }).click();
  await page.getByRole("button", { name: "New claim" }).click();
  await page.getByRole("button", { name: /Simulate network drop/ }).click();
  await page.getByLabel("Additional details").fill(testLabel + " offline");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByText("Saved to the offline queue.").waitFor();
  await page.getByRole("button", { name: "Continue to evidence" }).click();
  await page.getByRole("button", { name: "Attach evidence" }).click();
  await page.getByText("Latest evidence: Queued evidence").waitFor();
  await page.getByRole("button", { name: "Review claim" }).click();
  await page.getByRole("button", { name: "Queue claim" }).click();
  await page.getByText("Claim queued. It will be sent when you reconnect.").waitFor();
  await page.getByRole("button", { name: /Simulate network drop/ }).click();
  await page.waitForFunction(() => document.querySelector(".relief-status-controls .net")?.textContent === "Online", undefined, { timeout: 30000 });
  const records = await page.request.post(base + "/api/relief/claims", { data: {} });
  const offlineClaim = (await records.json()).find(item => item.payload_json.notes === testLabel + " offline");
  assert.equal(offlineClaim?.status, "submitted");
  assert.equal(offlineClaim.documents.length, 1);

  await page.getByRole("button", { name: "Fatima", exact: true }).click();
  await page.getByRole("button", { name: /Auditor Kamran/ }).click();
  await page.getByRole("heading", { name: "Auditor Kamran", exact: true }).waitFor();
  await page.getByRole("button", { name: "Audit Vault", exact: true }).click();
  await page.getByRole("button", { name: "Decision Safety Eval" }).click();
  await page.getByText("Forgery misses", { exact: true }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Audit page overflow");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.context().setOffline(true);
  await page.reload();
  await page.getByRole("heading", { name: "You are offline" }).waitFor();
  assert.equal(await page.getByText("Auditor Kamran", { exact: true }).count(), 0);
  await page.context().setOffline(false);
  await page.getByRole("link", { name: "Reconnect to your workspace" }).click();
  await page.getByRole("heading", { name: "Auditor Kamran", exact: true }).waitFor();
  assert.deepEqual(runtimeErrors, []);
  console.log("PASS browser layout, keyboard focus, live and 2G microphone capture, offline queue and cold start, persona switching, and audit UI");
}

try {
  await startServer();
  if (process.env.RELIEF_TEST_BROWSER_ONLY !== "1") await testApi();
  await testBrowser();
} finally {
  await browser?.close();
  await Promise.all(contexts.map(context => context.dispose()));
  server?.kill();
}
