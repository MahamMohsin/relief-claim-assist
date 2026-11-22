"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AlertCircle, ArrowLeft, AudioLines, CalendarDays, Check, ChevronRight, CircleDollarSign, Flag, LoaderCircle, LockKeyhole, MessageSquare, Paperclip, Plus, Search, UsersRound } from "lucide-react";
import { api, HttpError, isRetryable } from "@/src/lib/client";
import { compressImage } from "@/src/lib/offline/compressImage";
import { getDraft, resolveDraft, saveDraft, wipeDraft, type Mutation } from "@/src/lib/offline/queue";
import type { Action, Audit, Claim, Family, MiniApp, Payload, Privacy, Profile, Rule, RuleConfig, UIAction } from "@/src/lib/contracts";
import { speakText } from "./os/speech";
import { cuaEngine } from "./os/cuaEngine";
import { PolicyChatView } from "./PolicyChatView";
import { ScamChatView } from "./ScamChatView";
import { AuditVaultView, type SafetyMetric } from "./AuditVaultView";
import { CitizenProfileView } from "./CitizenProfileView";
import { ApplicantProfilePanel } from "./ApplicantProfilePanel";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { NumberInput } from "@astryxdesign/core/NumberInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Selector } from "@astryxdesign/core/Selector";
import { FileInput } from "@astryxdesign/core/FileInput";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import { claimStepHelp, dirFor, evidenceText, pick, stageText, statusText, strings, toneText, useLang, type ClaimTone, type EvidenceLabel, type Lang } from "@/src/lib/i18n";

export type ViewContext = {
  profile: Profile;
  citizen: string | null;
  offline: boolean;
  version: number;
  enqueue: (action: Mutation["action"], body: Record<string, unknown>, options?: { key?: string; dependsOn?: string; audio?: Blob }) => Promise<string>;
  selectFamily: (family: Family) => Promise<void>;
  prefill: Extract<UIAction, { type: "prefill_fields" }> | null;
  stepNav: "evidence" | "review" | "submit" | null;
  go: (app: MiniApp | null) => void;
  refresh: () => void;
  lite: boolean;
};

export function MiniApps({ app, ctx }: { app: MiniApp; ctx: ViewContext }) {
  switch (app) {
    case "claim": return <ClaimView ctx={ctx} />;
    case "profile": return <CitizenProfileView ctx={ctx} />;
    case "scam": return <ScamChatView ctx={ctx} />;
    case "policy": return <PolicyChatView ctx={ctx} />;
    case "privacy": return <PrivacyView ctx={ctx} />;
    case "family": return <FamilyView ctx={ctx} />;
    case "review": return <ReviewView ctx={ctx} />;
    case "rules": return <RuleView ctx={ctx} />;
    case "users": return <UsersView />;
    case "audit": return <AuditView ctx={ctx} />;
  }
}

const currency = (value: number) => "PKR " + new Intl.NumberFormat("en-PK").format(value);
const title = (value: string) => value.replaceAll("_", " ").replace(/^./, first => first.toUpperCase());
const short = (value: string) => value.slice(0, 8) + "…" + value.slice(-4);
const pc = (value: number) => Math.round(value * 100) + "%";
const getMessage = (error: unknown) => error instanceof Error ? error.message : "The request failed. Try again.";

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={"panel " + className}>{children}</section>;
}
function Notice({ text, warning = false }: { text: string; warning?: boolean }) {
  if (!text) return null;
  return <div className={"notice" + (warning ? " warning" : "")} role={warning ? "alert" : "status"}>{warning ? <AlertCircle size={18} /> : <Check size={18} />}{text}</div>;
}
function StateTag({ value }: { value: string }) {
  const color = ["approved", "paid", "granted", "genuine", "readable"].includes(value) ? "green"
    : ["rejected", "scam", "suspect", "failed", "dead"].includes(value) ? "red"
    : ["needs_proof", "revoked", "unreadable", "pending"].includes(value) ? "amber" : "neutral";
  return <span className={"pill " + color}>{title(value)}</span>;
}
function Spinner() {
  return <div className="loading"><LoaderCircle className="spin" size={20} /> Loading workspace…</div>;
}
function FamilyRequired({ ctx }: { ctx: ViewContext }) {
  return <Panel><UsersRound size={28} /><h2>Choose a family first</h2><p>Family Switch verifies consent before opening a claim.</p><button className="primary" onClick={() => ctx.go("family")}>Open Family Switch</button></Panel>;
}
function useActionList<T>(action: Action, ctx: ViewContext, withFamily = false) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!ctx.offline);

  useEffect(() => {
    if (ctx.offline || (withFamily && !ctx.citizen)) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<T>(action, withFamily ? { citizenId: ctx.citizen } : {}, controller.signal).then(setData).catch(error => {
      if (controller.signal.aborted) return;
      if (error instanceof HttpError && error.status === 403) setData(null);
      setError(getMessage(error));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [action, ctx.citizen, ctx.offline, ctx.version, withFamily]);
  return { data, error, loading };
}

const clean: Payload = { monthly_income: 14500, household_size: 3, notes: "" };
const claimIsChecking = (claim: Claim) => claim.ai_route === "checking" || Boolean(claim.documents?.some(doc => doc.verified_status === "processing"));
// Citizen-facing stage: Received → Checking documents → Checked / Needs proof / With officer.
const statusLabel = (status: string, lang: Lang) => statusText[status] ? pick(statusText[status], lang) : title(status);
function claimStage(claim: Claim, lang: Lang) {
  if (claim.status === "draft") return null;
  if (claimIsChecking(claim)) return pick(stageText.checking, lang);
  if (claim.ai_route === "human_review") return pick(stageText.failedToOfficer, lang);
  if (claim.status === "needs_proof") return pick(stageText.needsProof, lang);
  if (claim.status === "submitted" || claim.status === "in_review") return pick(stageText.withOfficer, lang);
  return statusLabel(claim.status, lang);
}
// Status banner after submit / evidence upload, driven by the live (polled) claim.
function claimTone(claim: Claim): ClaimTone | null {
  if (claimIsChecking(claim)) return "processing";
  if (claim.status === "needs_proof") return "needs_proof";
  if (claim.status === "submitted" || claim.status === "in_review") return "in_review";
  if (claim.status === "approved") return "approved";
  if (claim.status === "rejected") return "rejected";
  if (claim.status === "draft" && ["unreadable", "incomplete", "unverified"].includes(claim.documents?.at(-1)?.verified_status ?? "")) return "needs_proof";
  return null;
}
const evidenceTone = (status: string): ClaimTone | null =>
  status === "processing" ? "processing" : ["unreadable", "incomplete", "unverified"].includes(status) ? "needs_proof" : null;
// "Latest evidence" label from the live document (same polled data as the banner and claim card).
function evidenceLabel(doc: { verified_status: string; tamper_flag?: boolean }): EvidenceLabel | null {
  if (doc.verified_status === "processing") return "checking";
  if (doc.tamper_flag || ["flagged", "tampered"].includes(doc.verified_status)) return "flagged";
  if (["readable", "verified"].includes(doc.verified_status)) return "verified";
  if (["unreadable", "incomplete", "blurry", "blurred", "needs_proof"].includes(doc.verified_status)) return "clearer";
  if (["check_failed", "unverified", "failed"].includes(doc.verified_status)) return "failed";
  return null;
}
const toneStatus: Record<ClaimTone, "success" | "warning" | "info" | "error"> = {
  processing: "success", needs_proof: "warning", in_review: "info", approved: "success", rejected: "error",
};
const progressSteps = ["Household", "Evidence", "Review & submit"];
// Decision reason: the selected language first, the other one small underneath.
function DecisionReason({ en, ur, lang }: { en: string | null; ur: string | null; lang: Lang }) {
  const other: Lang = lang === "ur" ? "en" : "ur";
  const text = { en, ur };
  const firstLang = text[lang] ? lang : other;
  const first = text[firstLang];
  const second = text[lang] ? text[other] : null;
  return <>
    {first && <p lang={firstLang} dir={dirFor(firstLang)}>{first}</p>}
    {second && <small className="muted" lang={other} dir={dirFor(other)}>{second}</small>}
  </>;
}

function ClaimView({ ctx }: { ctx: ViewContext }) {
  const { lang } = useLang();
  const { data: claims, error, loading } = useActionList<Claim[]>("claims", ctx, true);
  // While background checks run, refresh the claim status (every 10s, or 30s in 2G Lite).
  const checking = Boolean(claims?.some(claimIsChecking));
  const refreshRef = useRef(ctx.refresh);
  refreshRef.current = ctx.refresh;
  useEffect(() => {
    if (!checking || ctx.offline) return;
    const timer = window.setInterval(() => refreshRef.current(), ctx.lite ? 30_000 : 10_000);
    return () => window.clearInterval(timer);
  }, [checking, ctx.offline, ctx.lite]);
  const [editing, setEditing] = useState(false);
  const [step, setStep] = useState(0);
  const [details, setDetails] = useState<Payload>(clean);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<string>();
  const [docType, setDocType] = useState<"identity" | "income">("identity");
  const [fixture, setFixture] = useState("clear");
  const [image, setImage] = useState<string | null>(null);
  const [attached, setAttached] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fault, setFault] = useState("");
  const [opened, setOpened] = useState<string>();
  // Claim whose status the banner follows. `live` turns on once the polled list has shown a status for it,
  // after which only the live status is used (the one-time response is just the first frame).
  const [tracked, setTracked] = useState<{ id: string; fallback: ClaimTone | null; live: boolean } | null>(null);
  const trackedLive = tracked ? claims?.find(item => item.id === tracked.id) : undefined;
  const liveTone = trackedLive ? claimTone(trackedLive) : null;
  const tone = tracked ? (tracked.live ? liveTone : liveTone ?? tracked.fallback) : null;
  useEffect(() => {
    if (tracked && !tracked.live && liveTone) setTracked({ ...tracked, live: true });
  }, [tracked, liveTone]);
  useEffect(() => {
    if (!tracked) return;
    if (tracked.live && !tone) { setTracked(null); return; }
    // Only in_review / approved auto-hide (6s). needs_proof and rejected stay until the status changes or × is tapped.
    if (tone !== "in_review" && tone !== "approved") return;
    const timer = window.setTimeout(() => setTracked(null), 6000);
    return () => window.clearTimeout(timer);
  }, [tracked, tone]);
  const previousPrefill = useRef<ViewContext["prefill"]>(null);
  const scope = ctx.citizen ?? "self";
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const stepRef = useRef(step);
  stepRef.current = step;
  const snapshotRef = useRef({
    editing,
    step: (["household", "evidence", "review"] as const)[step] ?? "household",
    monthly_income: details.monthly_income,
    household_size: details.household_size,
    notes: details.notes,
    claimId,
    docType,
    fixture,
    attached,
  });
  snapshotRef.current = {
    editing,
    step: (["household", "evidence", "review"] as const)[step] ?? "household",
    monthly_income: details.monthly_income,
    household_size: details.household_size,
    notes: details.notes,
    claimId,
    docType,
    fixture,
    attached,
  };
  const startRef = useRef<(item?: Claim) => void>(() => {});
  const runRef = useRef<(action: "draft" | "submit" | "evidence") => Promise<void>>(async () => {});

  useEffect(() => {
    cuaEngine.claim = {
      isEditing: () => editingRef.current,
      getStep: () => stepRef.current,
      getSnapshot: () => ({ ...snapshotRef.current }),
      startNew: () => startRef.current(),
      setField: (field, value) => {
        setDetails(current => ({ ...current, [field]: value }));
      },
      setClaimId: id => {
        setClaimId(id);
        setPendingDraft(undefined);
      },
      setStep: next => {
        setEditing(true);
        setStep(next);
      },
      setDocType: next => setDocType(next),
      setFixture: next => {
        setImage(null);
        setFile(null);
        setFixture(next);
      },
      attachEvidence: async () => {
        await runRef.current("evidence");
      },
      saveDraft: async () => {
        await runRef.current("draft");
      },
      setMessage: msg => setMessage(msg),
    };
    return () => {
      if (cuaEngine.claim) cuaEngine.claim = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    getDraft(ctx.profile.id, scope).then(saved => {
      if (!saved || cancelled) return;
      setDetails({ ...clean, ...saved.payload });
      setClaimId(saved.claimId);
      setPendingDraft(saved.pendingDraftId);
      setEditing(true);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [ctx.profile.id, scope]);

  useEffect(() => {
    if (!ctx.prefill || previousPrefill.current === ctx.prefill) return;
    previousPrefill.current = ctx.prefill;
    setEditing(true);
    if (ctx.prefill.claimId) {
      setClaimId(ctx.prefill.claimId);
      setPendingDraft(undefined);
    }
    setDetails(current => ({ ...current, ...ctx.prefill?.fields }));
    setMessage("Assistant filled the fields. Review them before saving.");
  }, [ctx.prefill]);

  useEffect(() => {
    if (!ctx.stepNav) return;
    if (ctx.stepNav === "evidence") {
      setEditing(true);
      setStep(1);
    } else if (ctx.stepNav === "review") {
      setEditing(true);
      setStep(2);
    } else if (ctx.stepNav === "submit") {
      setEditing(true);
      setStep(2);
      setMessage("Review the claim and select Submit claim when you are ready.");
    }
  }, [ctx.stepNav]);

  useEffect(() => {
    if (pendingDraft && !ctx.offline) {
      resolveDraft(ctx.profile.id, pendingDraft).then(id => {
        if (!id) return;
        setClaimId(id);
        setPendingDraft(undefined);
      }).catch(() => {});
    }
  }, [pendingDraft, ctx.profile.id, ctx.offline, ctx.version]);

  useEffect(() => {
    if (editing && ctx.citizen) {
      saveDraft(ctx.profile.id, scope, { payload: details, claimId, pendingDraftId: pendingDraft }).catch(() => {});
    }
  }, [details, editing, claimId, pendingDraft, ctx.profile.id, scope, ctx.citizen]);

  if (!ctx.citizen) return <FamilyRequired ctx={ctx} />;
  const draft = claims?.find(item => item.id === claimId);
  // Latest evidence from the live polled claim (agrees with the banner and the claim card).
  // While it is still processing, the polling effect above keeps refreshing (10s, 30s in 2G Lite).
  const liveDoc = draft?.documents?.at(-1);
  const liveLabel = liveDoc ? evidenceLabel(liveDoc) : null;
  const evidenceShown = attached === "Queued evidence" ? pick(strings.queuedEvidence, lang)
    : liveDoc ? (liveLabel ? pick(evidenceText[liveLabel], lang) : title(liveDoc.verified_status))
    : attached;

  function start(item?: Claim) {
    setClaimId(item?.id ?? null);
    setDetails({ ...clean, ...item?.payload_json });
    setStep(0);
    setAttached(item?.documents?.map(doc => title(doc.verified_status)).join(", ") ?? "");
    setPendingDraft(undefined);
    setImage(null);
    setFile(null);
    setEditing(true);
    setFault("");
    setMessage("");
    setTracked(null);
  }

  async function run(action: "draft" | "submit" | "evidence") {
    setBusy(true);
    setFault("");
    setMessage("");
    setTracked(null);
    const key = crypto.randomUUID();
    try {
      const currentId = claimId ?? (pendingDraft && !ctx.offline ? await resolveDraft(ctx.profile.id, pendingDraft) : null);
      const base = { citizenId: ctx.citizen, claimId: currentId ?? null };
      const body = action === "evidence"
        ? { ...base, docType, ...(image ? { image } : { fixture }) }
        : { ...base, payload: details };
      if (action === "evidence" && !currentId && !pendingDraft) throw new Error("Save the draft before attaching evidence.");
      // Queue in the outbox (same idempotency key) when offline, or when the request cannot get through.
      const queueInOutbox = async () => {
        await ctx.enqueue(action, body, { key, dependsOn: !currentId ? pendingDraft : undefined });
        if (action === "draft" && !currentId && !pendingDraft) setPendingDraft(key);
        if (action === "evidence") setAttached("Queued evidence");
        if (action === "submit") {
          setEditing(false);
          await wipeDraft(ctx.profile.id, scope).catch(() => {});
        }
        setMessage(pick(strings.savedOnPhone, lang));
      };
      if (ctx.offline || (!currentId && pendingDraft)) {
        await queueInOutbox();
        return;
      }
      const send = async <T,>() => {
        try { return await api<T>(action, { ...body, key }); }
        catch (error) { if (isRetryable(error)) { await queueInOutbox(); return null; } throw error; }
      };

      if (action === "evidence") {
        const evidence = await send<{ verified_status: string }>();
        if (!evidence) return;
        setAttached(title(evidence.verified_status));
        const first = evidenceTone(evidence.verified_status);
        if (first && currentId) setTracked({ id: currentId, fallback: first, live: false });
        else setMessage("Evidence attached · " + title(evidence.verified_status));
      } else {
        const saved = await send<Claim>();
        if (!saved) return;
        setClaimId(saved.id);
        if (action === "submit") {
          setEditing(false);
          await wipeDraft(ctx.profile.id, scope).catch(() => {});
          setOpened(saved.id);
          setTracked({ id: saved.id, fallback: claimTone(saved), live: false });
        } else setMessage(pick(strings.draftSaved, lang));
      }
      ctx.refresh();
    } catch (error) {
      setFault(getMessage(error));
    } finally { setBusy(false); }
  }

  startRef.current = start;
  runRef.current = run;

  async function readImage(file: File | undefined) {
    if (!file) return;
    if (file.size > 8_000_000) { setFault("Choose a synthetic image under 8 MB."); return; }
    setFault("");
    try {
      // Compress before upload (smaller in 2G Lite) so weak connections can finish the upload.
      setImage(await compressImage(file, ctx.lite));
    } catch {
      setFault("The file could not be opened.");
    }
  }

  const badge = (status: string) => ["approved", "paid", "granted", "genuine", "readable"].includes(status)
    ? "success" as const
    : ["rejected", "scam", "suspect", "failed"].includes(status) ? "error" as const
    : ["needs_proof", "revoked", "unreadable"].includes(status) ? "warning" as const
    : ["submitted", "in_review"].includes(status) ? "info" as const : "neutral" as const;

  return <div className="view-stack" data-app-lang={lang}>
    {(error || fault) && <Banner status="error" title="Something went wrong" description={error || fault} />}
    {tracked && tone
      ? <section key={tracked.id + tone} className="claim-status" data-tone={tone} lang={lang} dir={dirFor(lang)}>
          <Banner status={toneStatus[tone]} title={pick(toneText[tone], lang)} isDismissable dismissLabel={lang === "ur" ? "بند کریں" : "Dismiss"} onDismiss={() => setTracked(null)} />
        </section>
      : message && <Banner status="success" title={message} />}
    {editing ? <Card padding={6}>
      <HStack justify="between" hAlign="start" gap={4} wrap="wrap">
        <VStack gap={0.5}>
          <h2>{draft?.status === "needs_proof" ? "Replace evidence" : "Prepare a claim"}</h2>
          <p>Use synthetic details and pretend documents only.</p>
        </VStack>
        <Button variant="secondary" label={pick(strings.backToClaims, lang)} onClick={() => setEditing(false)} />
      </HStack>
      <HStack gap={1} wrap="wrap" paddingBlockStart={3}>
        {progressSteps.map((label, index) => (
          <Badge key={label} label={index + 1 + ". " + label} variant={step === index ? "info" : "neutral"} />
        ))}
      </HStack>
      <VStack gap={2} paddingBlockStart={3}>
        <p lang={lang} dir={dirFor(lang)}>{claimStepHelp[lang][step]}</p>
        <Button variant="secondary" label="Listen to this step" icon={<AudioLines size={16} />} onClick={() =>
          void speakText(claimStepHelp[lang][step], lang, ctx.lite || ctx.offline).then(setMessage)} />
      </VStack>
      {step === 0 && <form onSubmit={event => { event.preventDefault(); setStep(1); }}>
        <VStack gap={3} paddingBlockStart={3}>
          <HStack gap={3} wrap="wrap">
            <div data-cua="claim-income-input" style={{ flex: 1, minWidth: 180 }}>
              <NumberInput label="Monthly household income (PKR)" value={details.monthly_income} onChange={value => setDetails({ ...details, monthly_income: value ?? 0 })} min={0} isRequired width="100%" />
            </div>
            <div data-cua="claim-household-input" style={{ flex: 1, minWidth: 180 }}>
              <NumberInput label="People in household" value={details.household_size} onChange={value => setDetails({ ...details, household_size: value ?? 1 })} min={1} isRequired width="100%" />
            </div>
          </HStack>
          <div data-cua="claim-notes-input" style={{ width: "100%" }}>
            <TextArea label="Additional details" value={details.notes} onChange={value => setDetails({ ...details, notes: value })} placeholder="Optional information for the officer" isOptional />
          </div>
          <HStack gap={2} wrap="wrap">
            <span data-cua="claim-continue-evidence" style={{ display: "inline-flex" }}>
              <Button type="submit" variant="primary" label={pick(strings.continueToEvidence, lang)} endContent={<ChevronRight size={16} />} />
            </span>
            <span data-cua="claim-save-draft" style={{ display: "inline-flex" }}>
              <Button variant="secondary" label={pick(strings.saveDraft, lang)} isDisabled={busy} onClick={() => void run("draft")} />
            </span>
          </HStack>
        </VStack>
      </form>}
      {step === 1 && <VStack gap={3} paddingBlockStart={3}>
        <HStack gap={3} wrap="wrap">
          <div data-cua="claim-doc-type" style={{ flex: 1, minWidth: 180 }}>
            <Selector label="Document type" value={docType} onChange={value => setDocType((value ?? "identity") as typeof docType)} options={[{ value: "identity", label: "Mock identity card" }, { value: "income", label: "Mock income slip" }]} />
          </div>
          <div data-cua="claim-fixture" style={{ flex: 1, minWidth: 180 }}>
            <Selector label="Sample document" value={fixture} onChange={value => { setImage(null); setFile(null); setFixture(value ?? "clear"); }} options={[{ value: "clear", label: "Readable sample" }, { value: "blurred", label: "Blurry sample" }, { value: "altered", label: "Altered sample" }, { value: "incomplete", label: "Incomplete sample" }]} />
          </div>
        </HStack>
        <FileInput label="Upload or take a picture of a synthetic document" value={file} onChange={next => { const picked = Array.isArray(next) ? next[0] ?? null : next; setFile(picked); void readImage(picked ?? undefined); }} accept="image/png,image/jpeg,image/webp" mode="dropzone" isOptional />
        {evidenceShown && <p className="muted" lang={lang} dir={dirFor(lang)}>{pick(strings.latestEvidence, lang)}: {evidenceShown}</p>}
        <HStack gap={2} wrap="wrap">
          <span data-cua="claim-attach-btn" style={{ display: "inline-flex" }}>
            {claimId || pendingDraft
              ? <Button variant="secondary" label={pick(busy ? strings.processing : liveDoc ? strings.updateEvidence : strings.attachEvidence, lang)} isDisabled={busy} onClick={() => void run("evidence")} />
              : <Button variant="secondary" label={pick(strings.saveDraftToAttach, lang)} isDisabled={busy} onClick={() => void run("draft")} />}
          </span>
          <span data-cua="claim-review-btn" style={{ display: "inline-flex" }}>
            <Button variant="primary" label={pick(strings.reviewClaim, lang)} isDisabled={busy} onClick={() => setStep(2)} />
          </span>
          <Button variant="ghost" label={pick(strings.back, lang)} onClick={() => setStep(0)} />
        </HStack>
      </VStack>}
      {step === 2 && <VStack gap={3} paddingBlockStart={3}>
        <HStack gap={2} wrap="wrap">
          <Card variant="muted" padding={3}><VStack gap={0.5}><small>Monthly income</small><strong>{currency(details.monthly_income)}</strong></VStack></Card>
          <Card variant="muted" padding={3}><VStack gap={0.5}><small>Household size</small><strong>{details.household_size} people</strong></VStack></Card>
          <Card variant="muted" padding={3}><VStack gap={0.5}><small>Evidence</small><strong lang={evidenceShown ? lang : undefined}>{evidenceShown || "Awaiting proof"}</strong></VStack></Card>
        </HStack>
        <p className="muted">An officer reviews every claim before any simulated payment can be issued.</p>
        <HStack gap={2}>
          <span data-cua="claim-submit-btn" style={{ display: "inline-flex" }}>
            <Button variant="primary" label={pick(busy ? strings.submitting : ctx.offline ? strings.queueClaim : strings.submitClaim, lang)} isDisabled={busy} onClick={() => void run("submit")} />
          </span>
          <Button variant="ghost" label={pick(strings.back, lang)} onClick={() => setStep(1)} />
        </HStack>
      </VStack>}
    </Card> : <Card padding={6}>
      <HStack justify="between" hAlign="start" gap={4} wrap="wrap">
        <VStack gap={0.5}>
          <h2>Your claims</h2>
          <p>Follow applications, officer requests, and payment receipts.</p>
        </VStack>
        <span data-cua="claim-new-btn" style={{ display: "inline-flex" }}>
          <Button variant="primary" label={pick(strings.newClaim, lang)} icon={<Plus size={16} />} onClick={() => start()} />
        </span>
      </HStack>
      {loading && !claims ? <Spinner /> : !claims?.length ? <p className="empty">{ctx.offline ? "Saved drafts are available offline. Reconnect to see submitted claims." : "This family has no claims yet."}</p> :
        <VStack gap={2} paddingBlockStart={3}>
          {claims.map(item => <Card key={item.id} variant="muted" padding={3}>
            <VStack gap={2}>
              <HStack gap={2} justify="between" wrap="wrap">
                <HStack gap={2} wrap="wrap"><strong>Claim {short(item.id)}</strong><Badge label={<span lang={lang}>{statusLabel(item.status, lang)}</span>} variant={badge(item.status)} /></HStack>
                <Button variant="ghost" size="sm" label={opened === item.id ? "Hide details" : "View details"} onClick={() => { if (tracked && tracked.id !== item.id) setTracked(null); setOpened(opened === item.id ? undefined : item.id); }} />
              </HStack>
              <small>{new Date(item.updated_at).toLocaleDateString()} · {item.amount_pkr ? currency(item.amount_pkr) : "Draft amount pending"}</small>
              {claimStage(item, lang) && <small className="muted" lang={lang} dir={dirFor(lang)}>{pick(strings.received, lang)} → {claimStage(item, lang)}</small>}
              {opened === item.id && <VStack gap={2}>
                <ol className="timeline"><li>Draft created</li>{item.status !== "draft" && <li>Submitted to the relief scheme</li>}<li>{title(item.status)}{item.rule_version_used ? " · Rule v" + item.rule_version_used : ""}</li>{item.payment && <li>Payment {item.payment.status}</li>}</ol>
                <DecisionReason en={item.citizen_reason_en} ur={item.citizen_reason_ur} lang={lang} />
                <p className="muted breakable">Claim ID: {item.id}</p>
                {item.payment && <p className="receipt"><CircleDollarSign size={21} /> {currency(item.payment.amount_pkr)} · <strong>{item.payment.raast_ref}</strong> · {title(item.payment.status)}</p>}
                <HStack gap={2} wrap="wrap">
                  {["draft", "needs_proof"].includes(item.status) && <Button variant="primary" label={item.status === "draft" ? "Edit draft" : pick(strings.updateEvidence, lang)} onClick={() => start(item)} />}
                  {(item.citizen_reason_en || item.citizen_reason_ur) && <Button variant="secondary" label={pick(strings.playDecision, lang)} icon={<AudioLines size={16} />} onClick={() => {
                    // Speak the decision in the selected language, falling back to the other one.
                    const own = lang === "ur" ? item.citizen_reason_ur : item.citizen_reason_en;
                    const spoken: Lang = own ? lang : lang === "ur" ? "en" : "ur";
                    void speakText((own ?? item.citizen_reason_en ?? item.citizen_reason_ur)!, spoken, ctx.lite || ctx.offline).then(setMessage);
                  }} />}
                </HStack>
              </VStack>}
            </VStack>
          </Card>)}
        </VStack>}
    </Card>}
  </div>;
}

function FamilyView({ ctx }: { ctx: ViewContext }) {
  const { data, error, loading } = useActionList<Family[]>("families", ctx);
  const [search, setSearch] = useState("");
  const [problem, setProblem] = useState("");
  const [switching, setSwitching] = useState<string>();
  useEffect(() => {
    cuaEngine.search.family = setSearch;
    return () => { delete cuaEngine.search.family; };
  }, []);
  return <Card padding={6}>
    <HStack justify="between" hAlign="start" gap={4} wrap="wrap">
      <VStack gap={0.5}><h2>Synthetic family directory</h2><p>Switching clears the previous family’s form and voice session.</p></VStack>
      <Badge label={(data?.length ?? 0) + " families"} />
    </HStack>
    <VStack gap={2} paddingBlockStart={3}>
      <div data-cua="family-search" style={{ width: "100%" }}>
        <TextInput label="Find a family" value={search} onChange={setSearch} placeholder="Name or demo area" />
      </div>
      {(error || problem) && <Banner status="error" title={error || problem} />}
      {loading && !data ? <Spinner /> : <VStack gap={1}>
        {data?.filter(family => (family.full_name + " " + family.village_area).toLowerCase().includes(search.toLowerCase())).map(family =>
          <Card key={family.id} variant="muted" padding={3}>
            <HStack justify="between" gap={2} wrap="wrap">
              <VStack gap={0.5}><strong>{family.full_name}</strong><small>{family.village_area}</small></VStack>
              <HStack gap={2}>
                <Badge label={title(family.consent)} variant={family.consent === "granted" ? "success" : "warning"} />
                <Button variant="secondary" size="sm" label="Switch" isDisabled={ctx.offline || Boolean(switching)} isLoading={switching === family.id} onClick={async () => {
                  setSwitching(family.id); setProblem("");
                  try { await ctx.selectFamily(family); } catch (error) { setProblem(getMessage(error)); }
                  finally { setSwitching(undefined); }
                }} />
              </HStack>
            </HStack>
          </Card>)}
      </VStack>}
    </VStack>
  </Card>;
}

function PrivacyView({ ctx }: { ctx: ViewContext }) {
  const { lang } = useLang();
  const { data, error, loading } = useActionList<Privacy>("privacy", ctx, true);
  const [field, setField] = useState("full_name");
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const changeRef = useRef<(action: "consent" | "correction", body: object) => Promise<void>>(async () => {});
  const privacySnapshotRef = useRef({ field, value });
  privacySnapshotRef.current = { field, value };
  useEffect(() => {
    cuaEngine.privacy = {
      getSnapshot: () => ({ ...privacySnapshotRef.current }),
      setField: next => setField(next),
      setValue: next => setValue(next),
      submit: async (nextField, nextValue) => {
        await changeRef.current("correction", { field: nextField, value: nextValue });
      },
    };
    return () => {
      if (cuaEngine.privacy) cuaEngine.privacy = null;
    };
  }, []);
  if (!ctx.citizen) return <FamilyRequired ctx={ctx} />;

  async function change(action: "consent" | "correction", body: object) {
    setBusy(true); setProblem(""); setMessage("");
    try {
      const args = { ...body, citizenId: ctx.citizen };
      const key = crypto.randomUUID();
      const queued = async () => { await ctx.enqueue(action, args, { key }); setMessage(pick(strings.savedOnPhone, lang)); };
      if (ctx.offline) await queued();
      else {
        try {
          await api(action, { ...args, key });
          setMessage(action === "correction" ? "Correction request recorded." : "Helper access updated.");
          ctx.refresh();
        } catch (error) { if (isRetryable(error)) await queued(); else throw error; }
      }
    } catch (error) { setProblem(getMessage(error)); }
    finally { setBusy(false); }
  }
  changeRef.current = change;
  return <div className="view-stack">
    {(problem || error) && <Banner status="error" title={problem || error} />}
    {message && <Banner status="success" title={message} />}
    <Card padding={6}>
      <VStack gap={1}><h2>Who has access</h2><p>Helper changes apply to this family’s next server request.</p></VStack>
      {loading && !data ? <Spinner /> : <VStack gap={1} paddingBlockStart={3}>
        {data?.helpers.map(helper => <Card key={helper.id} variant="muted" padding={3}>
          <HStack justify="between" gap={2} wrap="wrap">
            <VStack gap={0.5}><strong>{helper.name}</strong><small>Community helper</small></VStack>
            <HStack gap={2}>
              <Badge label={title(helper.status)} variant={helper.status === "granted" ? "success" : "warning"} />
              {ctx.profile.role === "citizen" && <Button variant="secondary" size="sm" label={helper.status === "granted" ? "Revoke" : "Grant"} isDisabled={busy} onClick={() => void change("consent", { helperId: helper.id, consent: helper.status === "granted" ? "revoked" : "granted" })} />}
            </HStack>
          </HStack>
        </Card>)}
        {data?.officers.map(name => <Card key={name} variant="muted" padding={3}><VStack gap={0.5}><strong>{name}</strong><small>Assigned relief officer</small></VStack></Card>)}
        <Card variant="muted" padding={3}>
          <HStack justify="between" gap={2}><VStack gap={0.5}><strong>Simulated public rails</strong><small>Identity, scheme registry, and mock payment services</small></VStack><LockKeyhole size={18} /></HStack>
        </Card>
      </VStack>}
    </Card>
    <Card padding={6}>
      <h2>Request a correction</h2>
      <form onSubmit={event => { event.preventDefault(); void change("correction", { field, value }); }}>
        <VStack gap={3} paddingBlockStart={3}>
          <HStack gap={3} wrap="wrap">
            <div data-cua="privacy-field" style={{ flex: 1, minWidth: 180 }}>
              <Selector label="Field" value={field} onChange={selected => setField(selected ?? "full_name")} options={[
                { value: "full_name", label: "Name" }, { value: "phone", label: "Mock phone" }, { value: "village_area", label: "Demo area" },
                { value: "household_size", label: "Household size" }, { value: "monthly_income_mock", label: "Monthly income" },
              ]} />
            </div>
            <div data-cua="privacy-value" style={{ flex: 1, minWidth: 180 }}>
              <TextInput label="Proposed synthetic value" value={value} onChange={setValue} isRequired />
            </div>
          </HStack>
          <HStack><span data-cua="privacy-submit" style={{ display: "inline-flex" }}><Button type="submit" variant="primary" label="Request correction" isDisabled={busy || !value.trim()} /></span></HStack>
        </VStack>
      </form>
      {data?.corrections.map(request => <Card key={request.id} variant="muted" padding={3}>
        <HStack justify="between" gap={2}><VStack gap={0.5}><strong>{title(request.field_name)}</strong><small>{request.proposed_value}</small></VStack><Badge label={title(request.status)} /></HStack>
      </Card>)}
    </Card>
  </div>;
}

const reviewOptions = { assign: "Assign to me", more_proof: "Request more proof", escalate: "Escalate", approve: "Approve", reject: "Reject", close: "Close case" } as const;

const kanbanColumns: { key: string; label: string; dot: string; statuses: Claim["status"][] }[] = [
  { key: "todo", label: "To do", dot: "#a3a3a3", statuses: ["submitted"] },
  { key: "proof", label: "Needs proof", dot: "#525252", statuses: ["needs_proof"] },
  { key: "review", label: "In review", dot: "#262626", statuses: ["in_review"] },
  { key: "decided", label: "Decided", dot: "#0a0a0a", statuses: ["approved", "rejected", "closed"] },
];

function ConfidenceRing({ value }: { value: number | null }) {
  const size = 34, stroke = 4, radius = (size - stroke) / 2, circumference = 2 * Math.PI * radius;
  const ratio = Math.min(Math.max(value ?? 0, 0), 1);
  const color = value === null ? "#d4d4d4" : value < 0.5 ? "#525252" : "#111111";
  return <svg className="kanban-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
    <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(0,0,0,0.1)" strokeWidth={stroke} />
    <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
      strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
  </svg>;
}

function kanbanSummary(claim: Claim) {
  const people = claim.payload_json.household_size;
  const income = claim.payload_json.monthly_income;
  const parts = [people ? people + " people" : "", income ? currency(income) + "/mo" : ""].filter(Boolean);
  return parts.join(" · ") || claim.handoff_notes || "Relief claim awaiting review";
}

function ReviewView({ ctx }: { ctx: ViewContext }) {
  const { data, error, loading } = useActionList<Claim[]>("queue", ctx);
  const [selected, setSelected] = useState("");
  const [decision, setDecision] = useState<keyof typeof reviewOptions>("assign");
  const [reason, setReason] = useState("");
  const [reasonUr, setReasonUr] = useState("");
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "accepted" | "rejected">("all");
  useEffect(() => {
    cuaEngine.search.review = setQuery;
    return () => { delete cuaEngine.search.review; };
  }, []);
  const claim = data?.find(item => item.id === selected);

  async function update(action: "review" | "disburse", outcome: "paid" | "failed" = "paid") {
    if (!claim) return;
    setBusy(true); setProblem(""); setNotice("");
    try {
      const updated = await api<Claim>(action, action === "review" ? { claimId: claim.id, decision, reason, reasonUr } : { claimId: claim.id, outcome });
      setDecision(["approved", "rejected"].includes(updated.status) ? "close" : "assign");
      setNotice(action === "review" ? "Officer decision recorded." : outcome === "paid" ? "Simulated payment issued." : "Simulated payment failed. The officer can retry it.");
      setReason(""); setReasonUr(""); ctx.refresh();
    } catch (error) { setProblem(getMessage(error)); }
    finally { setBusy(false); }
  }

  function pick(item: Claim) {
    setSelected(item.id);
    setDecision(["approved", "rejected"].includes(item.status) ? "close" : "assign");
    setNotice(""); setProblem("");
  }

  if (claim) return <div className="view-stack">
    <Panel>
      <div className="panel-head">
        <div><h2>{claim.citizen_name}</h2><p className="breakable">{claim.id}</p></div>
        <div className="detail-head-actions"><StateTag value={claim.status} />
          <button className="secondary" onClick={() => { setSelected(""); setNotice(""); setProblem(""); }}><ArrowLeft size={16} /> Board</button></div>
      </div>
      <div className="facts two"><div><small>Rule version</small><strong>v{claim.rule_version_used ?? "–"}</strong></div><div><small>Payment</small><strong>{title(claim.payment_status)}</strong></div></div>
      <p>{claim.handoff_notes}</p>
      {Boolean(claim.reports) && <Notice text={String(claim.reports) + " missing payment report(s) on this case."} warning />}
      <ApplicantProfilePanel
        citizenId={claim.citizen_id}
        claimIncome={claim.payload_json.monthly_income}
        claimHousehold={claim.payload_json.household_size}
        offline={ctx.offline}
        version={ctx.version}
      />
      <div className="rows">{claim.documents?.map(doc => <div className="list-row static" key={doc.id}><div><strong>{title(doc.doc_type)}</strong>
        <small>{doc.tamper_reason ?? doc.ocr_json.summary ?? "No model report"}</small>
        {doc.blur_score !== null && <small>Blur score {pc(doc.blur_score)}</small>}
        {doc.ocr_json.fields && <small>{Object.entries(doc.ocr_json.fields).map(([field, value]) => title(field) + ": " + value).join(" · ")}</small>}
        {doc.file_url && <a className="text-link" href={doc.file_url} target="_blank" rel="noreferrer">Open synthetic image</a>}
      </div><StateTag value={doc.verified_status} /></div>)}</div>
      <JobHistory claimId={claim.id} ctx={ctx} />
      <Notice text={problem} warning /><Notice text={notice} />
      {claim.status !== "closed" && <form onSubmit={event => { event.preventDefault(); void update("review"); }}>
        <label>Officer action<select value={decision} onChange={event => setDecision(event.target.value as keyof typeof reviewOptions)}>
          {(Object.entries(reviewOptions) as [keyof typeof reviewOptions, string][]).filter(([key]) => ["approved", "rejected"].includes(claim.status) ? key === "close" : key !== "close" && !(key === "approve" && claim.status === "needs_proof")).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </select></label>
        <label>Plain-language reason<textarea required minLength={5} maxLength={600} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <label>Urdu reason <small>(optional)</small><textarea lang="ur" dir="rtl" maxLength={600} value={reasonUr} onChange={event => setReasonUr(event.target.value)} /></label>
        <div className="actions"><button className="primary" disabled={busy || ctx.offline}>Record decision</button>
          {claim.status === "approved" && claim.payment_status !== "paid" && <>
            <button className="secondary" type="button" disabled={busy || ctx.offline} onClick={() => void update("disburse")}>
              {claim.payment_status === "failed" ? "Retry simulated payment" : "Issue simulated payment"}
            </button>
            {claim.payment_status === "pending" && <button className="secondary" type="button" disabled={busy || ctx.offline}
              onClick={() => void update("disburse", "failed")}>Simulate payment failure</button>}
          </>}</div>
      </form>}
      {claim.payment && <p className="receipt">{claim.payment.raast_ref} · {currency(claim.payment.amount_pkr)} · {title(claim.payment.status)}</p>}
    </Panel>
  </div>;

  const needle = query.trim().toLowerCase();
  const statusMatches = (status: Claim["status"]) => {
    if (statusFilter === "pending") return ["submitted", "needs_proof", "in_review"].includes(status);
    if (statusFilter === "accepted") return ["approved", "closed"].includes(status);
    if (statusFilter === "rejected") return status === "rejected";
    return true;
  };
  const filtered = (data ?? []).filter(item =>
    statusMatches(item.status) &&
    (!needle || (item.citizen_name ?? "").toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle)));

  return <div className="view-stack">
    <Panel className="kanban-panel">
      <div className="panel-head"><div><h2>Review queue</h2><p>Board view · lower confidence cases appear first.</p></div><span className="pill neutral">{filtered.length} cases</span></div>
      <div className="kanban-toolbar">
        <span className="kanban-search" data-cua="review-search"><Search size={15} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search citizen or claim ID" aria-label="Search claims" /></span>
        <div className="kanban-filters" role="tablist" aria-label="Filter by status">
          {([
            ["all", "All"],
            ["pending", "Pending"],
            ["accepted", "Accepted"],
            ["rejected", "Rejected"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={statusFilter === key}
              className={"kanban-filter-btn" + (statusFilter === key ? " active" : "")}
              onClick={() => setStatusFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <Notice text={error} warning />
      {loading && !data ? <Spinner /> : !data ?
        <p className="empty">{ctx.offline ? "Reconnect to load the officer queue." : "The queue is unavailable right now."}</p> :
        filtered.length === 0 ?
          <p className="empty">{query ? `No claims match “${query}”.` : "No cases match this filter."}</p> :
        <div className="kanban-board">
          {kanbanColumns.map(column => {
            const items = filtered.filter(item => column.statuses.includes(item.status));
            return <section className="kanban-col" key={column.key} aria-label={column.label}>
              <header className="kanban-col-head">
                <span className="kanban-dot" style={{ background: column.dot }} />
                <h3>{column.label}</h3>
                <span className="kanban-count">{items.length}</span>
              </header>
              {items.length === 0 ? <p className="kanban-empty">No cases here</p> :
                items.map(item => {
                  const docs = item.documents ?? [];
                  const verified = docs.filter(doc => ["genuine", "readable"].includes(doc.verified_status)).length;
                  const urgent = ["submitted", "in_review", "needs_proof"].includes(item.status)
                    && (item.status === "needs_proof" || (item.ai_confidence ?? 1) <= 0.55);
                  const initials = (item.citizen_name ?? "?").split(" ").map(word => word[0]).slice(0, 2).join("");
                  const confColor = item.ai_confidence === null ? "#737373" : item.ai_confidence < 0.5 ? "#525252" : "#111111";
                  return <button type="button" key={item.id} className="kanban-card" onClick={() => pick(item)}>
                    <div className="kanban-card-top">
                      <span className="kanban-tag">{item.rule_version_used ? "Rule v" + item.rule_version_used : "No rule"}</span>
                      {urgent && <span className="kanban-tag urgent"><Flag size={10} /> Urgent</span>}
                    </div>
                    <div className="kanban-card-body">
                      <div className="kanban-card-title">{item.citizen_name ?? "Unnamed citizen"}</div>
                      <div className="kanban-card-desc">{kanbanSummary(item)}</div>
                    </div>
                    <div className="kanban-progress">
                      <ConfidenceRing value={item.ai_confidence} />
                      <span className="kanban-progress-label">{docs.length ? `${verified}/${docs.length} docs verified` : "No evidence attached"}</span>
                      <span className="kanban-progress-pct" style={{ color: confColor }}>{item.ai_confidence !== null ? pc(item.ai_confidence) : "—"}</span>
                    </div>
                    <div className="kanban-card-foot">
                      <span className="kanban-avatar" aria-hidden="true">{initials}</span>
                      {Boolean(item.reports) && <span className="kanban-meta"><MessageSquare size={12} /> {item.reports}</span>}
                      <span className="kanban-meta"><Paperclip size={12} /> {docs.length}</span>
                      <span className="kanban-meta kanban-date"><CalendarDays size={12} /> {new Date(item.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                    </div>
                  </button>;
                })}
            </section>;
          })}
        </div>}
    </Panel>
  </div>;
}

type Impact = { claim_id: string; rule_version: number; before: boolean; after: boolean };
const ruleLabels: [keyof RuleConfig, string, number, number, number][] = [
  ["income_cap", "Monthly income cap (PKR)", 0, 10000000, 1], ["minimum_household", "Minimum household size", 1, 100, 1],
  ["amount_pkr", "Payout amount (PKR)", 1, 1000000, 1], ["confidence_threshold", "Confidence threshold", 0.5, 1, 0.01],
];
function RuleView({ ctx }: { ctx: ViewContext }) {
  const { data, error, loading } = useActionList<Rule[]>("rules", ctx);
  const active = data?.find(rule => rule.is_active);
  const [draft, setDraft] = useState<RuleConfig | null>(null);
  const [name, setName] = useState("");
  const [impact, setImpact] = useState<Impact[]>();
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const config = draft ?? active?.config_json;
  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config) return;
    const element = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const dryRun = element?.value === "simulate";
    setBusy(true); setProblem(""); setNotice("");
    try {
      if (dryRun) {
        setImpact(await api<Impact[]>("simulate", { config }));
      } else {
        const next = await api<Rule>("publish", { name: name || active?.name, config });
        setNotice("Rule version " + next.version + " is live.");
        setDraft(null); setImpact(undefined); ctx.refresh();
      }
    } catch (error) { setProblem(getMessage(error)); }
    finally { setBusy(false); }
  }
  return <div className="view-stack">
    <Notice text={problem || error} warning /><Notice text={notice} />
    <Panel><div className="panel-head"><div><h2>Eligibility rules</h2><p>Publish a new version while keeping prior decisions tied to their rules.</p></div>{active && <span className="pill green">Active · v{active.version}</span>}</div>
      {config ? <form onSubmit={apply}><label>Rule name<input value={name || active?.name || ""} onChange={event => setName(event.target.value)} minLength={3} maxLength={100} required /></label>
        <div className="form-grid">{ruleLabels.map(([key, label, min, max, step]) => <label key={key}>{label}<input type="number" min={min} max={max} step={step} required
          value={config[key]} onChange={event => { setDraft({ ...config, [key]: +event.target.value }); setImpact(undefined); }} /></label>)}</div>
        <div className="actions"><button className="secondary" value="simulate" disabled={busy || ctx.offline}>Simulate impact on historical cases</button>
          <button className="primary" value="publish" disabled={busy || ctx.offline}>Publish version</button></div>
      </form> : loading && <Spinner />}
    </Panel>
    {impact && <Panel><div className="panel-head"><div><h2>Digital Twin results</h2><p>{impact.filter(row => row.before !== row.after).length} of {impact.length} historical cases would change eligibility.</p></div></div>
      <div className="table-scroll"><table><thead><tr><th>Claim</th><th>Original rule</th><th>Before</th><th>With draft</th></tr></thead><tbody>
        {impact.map(row => <tr key={row.claim_id}><td>{short(row.claim_id)}</td><td>v{row.rule_version}</td><td>{row.before ? "Eligible" : "Ineligible"}</td><td>{row.after ? "Eligible" : "Ineligible"}</td></tr>)}
      </tbody></table></div>
    </Panel>}
    <Panel><h2>Version history</h2><div className="rows">{data?.map(rule => <div className="list-row static" key={rule.id}>
      <div><strong>v{rule.version} · {rule.name}</strong><small>{currency(rule.config_json.income_cap)} income cap</small></div><StateTag value={rule.is_active ? "active" : "historical"} />
    </div>)}</div></Panel>
    <StaffApprovals ctx={ctx} />
  </div>;
}

function StaffApprovals({ ctx }: { ctx: ViewContext }) {
  const { data, error, loading } = useActionList<Array<Pick<Profile, "id" | "full_name" | "role">>>("staff_queue", ctx);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  async function decide(userId: string, decision: "active" | "rejected") {
    setBusy(true);
    setNotice("");
    setProblem("");
    try {
      await api("decide_staff", { userId, decision });
      setNotice(decision === "active" ? "Staff access approved." : "Staff access rejected.");
      ctx.refresh();
    } catch (error) { setProblem(getMessage(error)); }
    finally { setBusy(false); }
  }
  return <Panel>
    <h2>Staff access requests</h2>
    <Notice text={error || problem} warning />
    <Notice text={notice} />
    {loading && !data ? <Spinner /> : data?.length === 0 ? <p>No staff requests are pending.</p> : null}
    {data?.map(item => <div className="list-row static" key={item.id}>
      <div><strong>{item.full_name}</strong><small>{title(item.role)}</small></div>
      <button className="secondary" disabled={busy || ctx.offline} onClick={() => void decide(item.id, "active")}>Approve staff access</button>
      <button className="quiet" disabled={busy || ctx.offline} onClick={() => void decide(item.id, "rejected")}>Reject</button>
    </div>)}
  </Panel>;
}
function AuditView({ ctx }: { ctx: ViewContext }) {
  const logs = useActionList<Audit[]>("audit", ctx);
  const safety = useActionList<SafetyMetric[]>("safety", ctx);
  const jobs = useActionList<JobStats | null>("job_stats", ctx);
  return <>
    {jobs.data && <p className="muted">Background jobs · {(["queued", "running", "done", "failed", "dead"] as const).map(key => title(key) + " " + jobs.data![key]).join(" · ")}</p>}
    <AuditVaultView ctx={ctx} logs={logs} safety={safety} />
  </>;
}

type JobStats = Record<"queued" | "running" | "done" | "failed" | "dead", number>;
type JobRow = { id: string; type: string; status: string; attempts: number; max_attempts: number; last_error: string | null; updated_at: string };

// Officer case detail: background job history for this claim (shown only when jobs exist).
function JobHistory({ claimId, ctx }: { claimId: string; ctx: ViewContext }) {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  useEffect(() => {
    if (ctx.offline) return;
    const controller = new AbortController();
    api<JobRow[]>("job_history", { claimId }, controller.signal).then(rows => setJobs(Array.isArray(rows) ? rows : [])).catch(() => setJobs([]));
    return () => controller.abort();
  }, [claimId, ctx.offline, ctx.version]);
  if (!jobs.length) return null;
  return <div className="rows">
    <small className="muted">Background checks</small>
    {jobs.map(job => <div className="list-row static" key={job.id}><div><strong>{title(job.type)}</strong>
      <small>Attempts {job.attempts}/{job.max_attempts} · {new Date(job.updated_at).toLocaleString()}</small>
      {job.last_error && <small>Last error: {job.last_error}</small>}
    </div><StateTag value={job.status} /></div>)}
  </div>;
}

const REGISTERED_USERS = [
  { id: "USR-048920", name: "Fatima Bibi", role: "Citizen", avatar: "/avatars/fatima.jpg", code: "CNIC · 31303-***-4212", linkedTitle: "Household · 4 members", linkedSub: "Rahim Yar Khan · CLM-2026-01" },
  { id: "USR-048783", name: "Zainab Health Worker", role: "Helper", avatar: "/avatars/zainab.jpg", code: "BHU · LHW-1142", linkedTitle: "Basic Health Unit 12", linkedSub: "32 assisted claims" },
  { id: "USR-048646", name: "Tariq Karyana Store", role: "Shopkeeper", avatar: "/avatars/tariq.jpg", code: "RAAST · M-8821", linkedTitle: "Karyana Store #18", linkedSub: "Multan · Verified Merchant" },
  { id: "USR-048509", name: "Officer Bilal", role: "Officer", avatar: "/avatars/bilal.jpg", code: "DESK · OFF-309", linkedTitle: "District Review Desk", linkedSub: "148 claims reviewed" },
  { id: "USR-048372", name: "Admin Sana", role: "Admin", avatar: "/avatars/sana.jpg", code: "HQ · ADM-004", linkedTitle: "Scheme Rule Studio", linkedSub: "Policy v2026.1" },
  { id: "USR-048235", name: "Auditor Kamran", role: "Auditor", avatar: "/avatars/kamran.jpg", code: "COMP · AUD-019", linkedTitle: "Audit Vault & Safety", linkedSub: "Read-only · All regions" },
];

function UsersView() {
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  useEffect(() => {
    cuaEngine.search.users = setQuery;
    return () => { delete cuaEngine.search.users; };
  }, []);
  const filtered = REGISTERED_USERS.filter(u =>
    [u.name, u.role, u.id, u.code, u.linkedTitle, u.linkedSub].join(" ").toLowerCase().includes(query.toLowerCase())
  );
  const allChecked = filtered.length > 0 && filtered.every(u => selected.includes(u.id));

  return <Panel>
    <div className="panel-head">
      <div><h2>Registered users</h2><p>{filtered.length} synthetic accounts across all roles.</p></div>
      <input
        data-cua="users-search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search name, role, or ID…"
        style={{ maxWidth: 220 }}
      />
    </div>
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th style={{ width: 32 }}>
              <input
                type="checkbox"
                aria-label="Select all users"
                checked={allChecked}
                onChange={() => setSelected(allChecked ? [] : filtered.map(u => u.id))}
              />
            </th>
            <th>USER</th>
            <th>TYPE</th>
            <th>LINKED TO</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(user => {
            const isChecked = selected.includes(user.id);
            return <tr
              key={user.id}
              onClick={() => setSelected(prev => isChecked ? prev.filter(id => id !== user.id) : [...prev, user.id])}
              style={{ cursor: "pointer" }}
            >
              <td onClick={e => e.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`Select ${user.name}`}
                  checked={isChecked}
                  onChange={() => setSelected(prev => isChecked ? prev.filter(id => id !== user.id) : [...prev, user.id])}
                />
              </td>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <img
                    src={user.avatar}
                    alt={user.name}
                    style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover", flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontWeight: 600 }}>{user.name}</div>
                    <div style={{ fontSize: "0.75rem", opacity: 0.65 }}>{user.code} · {user.id}</div>
                  </div>
                </div>
              </td>
              <td>
                <span style={{
                  display: "inline-block",
                  padding: "0.2rem 0.65rem",
                  borderRadius: 999,
                  border: "1px solid currentColor",
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  opacity: 0.85,
                }}>
                  {user.role}
                </span>
              </td>
              <td>
                <div style={{ fontWeight: 500 }}>{user.linkedTitle}</div>
                <div style={{ fontSize: "0.75rem", opacity: 0.65 }}>{user.linkedSub}</div>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </Panel>;
}
