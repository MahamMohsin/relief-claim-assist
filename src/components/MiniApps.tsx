"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AlertCircle, ArrowLeft, AudioLines, BookOpen, CalendarDays, Check, ChevronRight, CircleDollarSign, FileUp, Flag, LoaderCircle, LockKeyhole, MessageSquare, Paperclip, Plus, Search, ShieldCheck, UsersRound } from "lucide-react";
import { api, HttpError } from "@/src/lib/client";
import { getDraft, resolveDraft, saveDraft, wipeDraft, type Mutation } from "@/src/lib/offline/queue";
import type { Action, Audit, Claim, Family, MiniApp, Payload, PolicyAnswer, Privacy, Profile, Rule, RuleConfig, ScamResult, UIAction } from "@/src/lib/contracts";
import { speakText } from "./os/speech";

export type ViewContext = {
  profile: Profile;
  citizen: string | null;
  offline: boolean;
  version: number;
  enqueue: (action: Mutation["action"], body: Record<string, unknown>, options?: { key?: string; dependsOn?: string; audio?: Blob }) => Promise<string>;
  selectFamily: (family: Family) => Promise<void>;
  prefill: Extract<UIAction, { type: "prefill_fields" }> | null;
  stepNav: "evidence" | "review" | "submit" | null;
  voiceLang: "en" | "ur";
  go: (app: MiniApp | null) => void;
  refresh: () => void;
  lite: boolean;
};

export function MiniApps({ app, ctx }: { app: MiniApp; ctx: ViewContext }) {
  switch (app) {
    case "claim": return <ClaimView ctx={ctx} />;
    case "scam": return <ScamView ctx={ctx} />;
    case "policy": return <PolicyView ctx={ctx} />;
    case "privacy": return <PrivacyView ctx={ctx} />;
    case "family": return <FamilyView ctx={ctx} />;
    case "review": return <ReviewView ctx={ctx} />;
    case "rules": return <RuleView ctx={ctx} />;
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
    : ["needs_proof", "revoked", "scam", "suspect", "unreadable", "rejected"].includes(value) ? "amber" : "neutral";
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
const progressSteps = ["Household", "Evidence", "Review & submit"];

function ClaimView({ ctx }: { ctx: ViewContext }) {
  const { data: claims, error, loading } = useActionList<Claim[]>("claims", ctx, true);
  const [editing, setEditing] = useState(false);
  const [step, setStep] = useState(0);
  const [details, setDetails] = useState<Payload>(clean);
  const [claimId, setClaimId] = useState<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<string>();
  const [docType, setDocType] = useState<"identity" | "income">("identity");
  const [fixture, setFixture] = useState("clear");
  const [image, setImage] = useState<string | null>(null);
  const [attached, setAttached] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fault, setFault] = useState("");
  const [opened, setOpened] = useState<string>();
  const previousPrefill = useRef<ViewContext["prefill"]>(null);
  const scope = ctx.citizen ?? "self";

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
      void run("submit");
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

  function start(item?: Claim) {
    setClaimId(item?.id ?? null);
    setDetails({ ...clean, ...item?.payload_json });
    setStep(0);
    setAttached(item?.documents?.map(doc => title(doc.verified_status)).join(", ") ?? "");
    setPendingDraft(undefined);
    setImage(null);
    setEditing(true);
    setFault("");
    setMessage("");
  }

  async function run(action: "draft" | "submit" | "evidence") {
    setBusy(true);
    setFault("");
    setMessage("");
    const key = crypto.randomUUID();
    try {
      const currentId = claimId ?? (pendingDraft && !ctx.offline ? await resolveDraft(ctx.profile.id, pendingDraft) : null);
      const base = { citizenId: ctx.citizen, claimId: currentId ?? null };
      const body = action === "evidence"
        ? { ...base, docType, ...(image ? { image } : { fixture }) }
        : { ...base, payload: details };
      if (action === "evidence" && !currentId && !pendingDraft) throw new Error("Save the draft before attaching evidence.");
      if (ctx.offline || (!currentId && pendingDraft)) {
        await ctx.enqueue(action, body, { key, dependsOn: !currentId ? pendingDraft : undefined });
        if (action === "draft" && !currentId && !pendingDraft) setPendingDraft(key);
        if (action === "evidence") setAttached("Queued evidence");
        if (action === "submit") {
          setEditing(false);
          await wipeDraft(ctx.profile.id, scope).catch(() => {});
          setMessage("Claim queued. It will be sent when you reconnect.");
        } else setMessage("Saved to the offline queue.");
        return;
      }

      if (action === "evidence") {
        const evidence = await api<{ verified_status: string }>(action, { ...body, key });
        setAttached(title(evidence.verified_status));
        setMessage("Evidence attached · " + title(evidence.verified_status));
      } else {
        const saved = await api<Claim>(action, { ...body, key });
        setClaimId(saved.id);
        if (action === "submit") {
          setEditing(false);
          await wipeDraft(ctx.profile.id, scope).catch(() => {});
          setOpened(saved.id);
          setMessage(saved.status === "needs_proof" ? "Evidence needs attention. Open the claim to continue." : "Your claim is now with an officer.");
        } else setMessage("Draft saved.");
      }
      ctx.refresh();
    } catch (error) {
      setFault(getMessage(error));
    } finally { setBusy(false); }
  }

  async function readImage(file: File | undefined) {
    if (!file) return;
    if (file.size > 2_000_000) { setFault("Choose a synthetic image under 2 MB."); return; }
    setFault("");
    const reader = new FileReader();
    reader.onload = () => setImage(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => setFault("The file could not be opened.");
    reader.readAsDataURL(file);
  }

  return <div className="view-stack">
    <Notice text={error || fault} warning />
    <Notice text={message} />
    {editing ? <Panel>
      <div className="panel-head"><div><h2>{draft?.status === "needs_proof" ? "Replace evidence" : "Prepare a claim"}</h2><p>Use synthetic details and pretend documents only.</p></div><button className="secondary" onClick={() => setEditing(false)}>Back to claims</button></div>
      <ol className="steps" aria-label="Claim steps">{progressSteps.map((label, index) => (
        <li key={label} aria-current={step === index ? "step" : undefined}><span>{index < step ? <Check size={14} /> : index + 1}</span>{label}</li>
      ))}</ol>
      {step === 0 && <form onSubmit={event => { event.preventDefault(); setStep(1); }}>
        <div className="form-grid">
          <label>Monthly household income (PKR)<input type="number" min="0" required value={details.monthly_income} onChange={event => setDetails({ ...details, monthly_income: +event.target.value })} /></label>
          <label>People in household<input type="number" min="1" required value={details.household_size} onChange={event => setDetails({ ...details, household_size: +event.target.value })} /></label>
        </div>
        <label>Additional details<textarea maxLength={600} value={details.notes} onChange={event => setDetails({ ...details, notes: event.target.value })} placeholder="Optional information for the officer" /></label>
        <div className="actions"><button className="primary" type="submit">Continue to evidence <ChevronRight size={17} /></button><button type="button" className="secondary" disabled={busy} onClick={() => void run("draft")}>Save draft</button></div>
      </form>}
      {step === 1 && <div className="view-stack">
        <div className="form-grid">
          <label>Document type<select value={docType} onChange={event => setDocType(event.target.value as typeof docType)}><option value="identity">Mock identity card</option><option value="income">Mock income slip</option></select></label>
          <label>Sample document<select value={fixture} onChange={event => { setImage(null); setFixture(event.target.value); }}>
            <option value="clear">Readable sample</option><option value="blurred">Blurry sample</option><option value="altered">Altered sample</option><option value="incomplete">Incomplete sample</option>
          </select></label>
        </div>
        <label className="file-field"><FileUp size={19} /> Upload or take a picture of a synthetic document<input type="file" accept="image/png,image/jpeg,image/webp" capture="environment" onChange={event => void readImage(event.target.files?.[0])} /></label>
        {attached && <p className="muted">Latest evidence: {attached}</p>}
        <div className="actions">
          {claimId || pendingDraft ? <button className="secondary" disabled={busy} onClick={() => void run("evidence")}>{busy ? "Processing…" : "Attach evidence"}</button>
            : <button className="secondary" disabled={busy} onClick={() => void run("draft")}>Save draft to attach evidence</button>}
          <button className="primary" onClick={() => setStep(2)} disabled={busy}>Review claim</button>
          <button className="quiet" onClick={() => setStep(0)}>Back</button>
        </div>
      </div>}
      {step === 2 && <div className="view-stack">
        <div className="facts"><div><small>Monthly income</small><strong>{currency(details.monthly_income)}</strong></div>
          <div><small>Household size</small><strong>{details.household_size} people</strong></div>
          <div><small>Evidence</small><strong>{attached || "Awaiting proof"}</strong></div></div>
        <p className="muted">An officer reviews every claim before any simulated payment can be issued.</p>
        <div className="actions"><button className="primary" disabled={busy} onClick={() => void run("submit")}>{busy ? "Submitting…" : ctx.offline ? "Queue claim" : "Submit claim"}</button><button className="quiet" onClick={() => setStep(1)}>Back</button></div>
      </div>}
    </Panel> : <Panel>
      <div className="panel-head"><div><h2>Your claims</h2><p>Follow applications, officer requests, and payment receipts.</p></div><button className="primary" onClick={() => start()}><Plus size={18} /> New claim</button></div>
      {loading && !claims ? <Spinner /> : !claims?.length ? <p className="empty">{ctx.offline ? "Saved drafts are available offline. Reconnect to see submitted claims." : "This family has no claims yet."}</p> :
        <div className="rows">{claims.map(item => <div className="row-group" key={item.id}>
          <button className="list-row" onClick={() => setOpened(opened === item.id ? undefined : item.id)} aria-expanded={opened === item.id}>
            <div><strong>Claim {short(item.id)}</strong><small>{new Date(item.updated_at).toLocaleDateString()} · {item.amount_pkr ? currency(item.amount_pkr) : "Draft amount pending"}</small></div><StateTag value={item.status} /><ChevronRight size={17} />
          </button>
          {opened === item.id && <div className="row-detail">
            <ol className="timeline"><li>Draft created</li>{item.status !== "draft" && <li>Submitted to the relief scheme</li>}<li>{title(item.status)}{item.rule_version_used ? " · Rule v" + item.rule_version_used : ""}</li>{item.payment && <li>Payment {item.payment.status}</li>}</ol>
            {item.citizen_reason_en && <p>{item.citizen_reason_en}</p>}
            {item.citizen_reason_ur && <p lang="ur" dir="rtl">{item.citizen_reason_ur}</p>}
            <p className="muted breakable">Claim ID: {item.id}</p>
            {item.payment && <p className="receipt"><CircleDollarSign size={21} /> {currency(item.payment.amount_pkr)} · <strong>{item.payment.raast_ref}</strong> · {title(item.payment.status)}</p>}
            <div className="actions">
              {["draft", "needs_proof"].includes(item.status) && <button className="primary" onClick={() => start(item)}>{item.status === "draft" ? "Edit draft" : "Update evidence"}</button>}
              {item.citizen_reason_en && <button className="secondary" onClick={() => void speakText(item.citizen_reason_ur || item.citizen_reason_en!, item.citizen_reason_ur ? "ur" : "en", ctx.lite || ctx.offline).then(setMessage)}><AudioLines size={17} /> Play decision</button>}
            </div>
          </div>}
        </div>)}</div>}
    </Panel>}
  </div>;
}

function ScamView({ ctx }: { ctx: ViewContext }) {
  const [message, setMessage] = useState("");
  const [reference, setReference] = useState("");
  const [result, setResult] = useState<ScamResult>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function check(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setNotice(""); setResult(undefined);
    try { setResult(await api<ScamResult>("check", { message, reference })); }
    catch (error) { setError(getMessage(error)); }
    finally { setBusy(false); }
  }
  async function report() {
    setBusy(true); setError(""); setNotice("");
    try {
      if (ctx.offline) {
        await ctx.enqueue("report", { reference, message });
        setNotice("Report queued for the officer desk.");
      } else {
        await api("report", { reference, message, key: crypto.randomUUID() });
        setNotice("Missing payment report filed.");
      }
    } catch (error) { setError(getMessage(error)); }
    finally { setBusy(false); }
  }
  return <div className="view-stack"><Panel>
    <h2>Verify a relief message</h2>
    <p>Use a synthetic message or payment reference. Never share real credentials.</p>
    <form onSubmit={check}>
      <label>SMS or WhatsApp message<textarea value={message} onChange={event => setMessage(event.target.value)} maxLength={1500} placeholder="Paste the synthetic message here" /></label>
      <label>Claim ID or mock payout reference<input value={reference} onChange={event => setReference(event.target.value)} maxLength={80} placeholder="Example: SIM-FATIMA1" /></label>
      <div className="actions"><button className="primary" disabled={busy || ctx.offline || !(message.trim() || reference.trim())}><ShieldCheck size={18} /> Check message</button>
        <button type="button" className="secondary" onClick={() => { setMessage("Raast credited your simulated relief payment."); setReference("SIM-FATIMA1"); }}>Use sample alert</button>
        <button type="button" className="quiet" disabled={busy || !reference.trim()} onClick={() => void report()}>Report missing payment</button></div>
    </form>
    <Notice text={error} warning /><Notice text={notice} />
  </Panel>
  {result && <Panel><div className="panel-head"><h2>Verification result</h2><StateTag value={result.jev_label} /></div>
    <div className="facts two"><div><small>Message assessment</small><strong>{title(result.jev_label)} · {pc(result.jev_confidence)}</strong><small>{result.model}</small></div>
      <div><small>Simulated payment rail</small><strong>{result.payment ? title(result.payment.status) + " · " + currency(result.payment.amount_pkr) : "No matching receipt"}</strong><small>{result.payment?.raast_ref || "Check the reference independently"}</small></div></div>
  </Panel>}</div>;
}

function PolicyView({ ctx }: { ctx: ViewContext }) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<PolicyAnswer>();
  const [error, setError] = useState("");
  async function ask(event: FormEvent) {
    event.preventDefault(); setError(""); setBusy(true); setAnswer(undefined);
    try { setAnswer(await api<PolicyAnswer>("policy", { question })); }
    catch (error) { setError(getMessage(error)); }
    finally { setBusy(false); }
  }
  return <div className="view-stack">
    <Panel><h2>Ask the scheme registry</h2><p>Answers quote the current fictional policy and include the section used.</p>
      <form onSubmit={ask}><label>Policy question<input required minLength={3} maxLength={500} value={question} onChange={event => setQuestion(event.target.value)} placeholder="How do I report a missing payment?" /></label>
        <div className="actions"><button className="primary" disabled={busy || ctx.offline}><BookOpen size={17} />{busy ? "Searching…" : "Find answer"}</button></div>
      </form><Notice text={error} warning />
    </Panel>
    {answer && <Panel><div className="panel-head"><h2>Registry answer</h2><span className="pill neutral">Policy v{answer.policy_version}{answer.effective_date ? " · " + answer.effective_date : ""}</span></div>
      <p className="large-copy">{answer.answer}</p>
      {answer.citations.map(section => <details className="citation" key={section.id}><summary>§ {section.section_code} · {section.title}</summary><p>{section.content}</p></details>)}
    </Panel>}
  </div>;
}

function FamilyView({ ctx }: { ctx: ViewContext }) {
  const { data, error, loading } = useActionList<Family[]>("families", ctx);
  const [search, setSearch] = useState("");
  const [problem, setProblem] = useState("");
  const [switching, setSwitching] = useState<string>();
  return <Panel>
    <div className="panel-head"><div><h2>Synthetic family directory</h2><p>Switching clears the previous family’s form and voice session.</p></div><span className="pill neutral">{data?.length ?? 0} families</span></div>
    <label>Find a family<input placeholder="Name or demo area" value={search} onChange={event => setSearch(event.target.value)} /></label>
    <Notice text={error || problem} warning />
    {loading && !data ? <Spinner /> : <div className="rows family-list">{data?.filter(family => (family.full_name + " " + family.village_area).toLowerCase().includes(search.toLowerCase())).map(family =>
      <button className="list-row" key={family.id} disabled={ctx.offline || Boolean(switching)} onClick={async () => {
        setSwitching(family.id); setProblem("");
        try { await ctx.selectFamily(family); } catch (error) { setProblem(getMessage(error)); }
        finally { setSwitching(undefined); }
      }}>
        <div><strong>{family.full_name}</strong><small>{family.village_area}</small></div>
        <StateTag value={family.consent} />{switching === family.id ? <LoaderCircle className="spin" size={17} /> : <ChevronRight size={17} />}
      </button>)}</div>}
  </Panel>;
}

function PrivacyView({ ctx }: { ctx: ViewContext }) {
  const { data, error, loading } = useActionList<Privacy>("privacy", ctx, true);
  const [field, setField] = useState("full_name");
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  if (!ctx.citizen) return <FamilyRequired ctx={ctx} />;

  async function change(action: "consent" | "correction", body: object) {
    setBusy(true); setProblem(""); setMessage("");
    try {
      const args = { ...body, citizenId: ctx.citizen };
      if (ctx.offline) {
        await ctx.enqueue(action, args);
        setMessage("Change queued. Permissions update on the server when you reconnect.");
      } else {
        await api(action, { ...args, key: crypto.randomUUID() });
        setMessage(action === "correction" ? "Correction request recorded." : "Helper access updated.");
        ctx.refresh();
      }
    } catch (error) { setProblem(getMessage(error)); }
    finally { setBusy(false); }
  }
  return <div className="view-stack">
    <Notice text={problem || error} warning /><Notice text={message} />
    <Panel><h2>Who has access</h2><p>Helper changes apply to this family’s next server request.</p>
      {loading && !data ? <Spinner /> : <div className="rows">
        {data?.helpers.map(helper => <div className="list-row static" key={helper.id}><div><strong>{helper.name}</strong><small>Community helper</small></div><StateTag value={helper.status} />
          {ctx.profile.role === "citizen" && <button className="secondary" disabled={busy} onClick={() => void change("consent", { helperId: helper.id, consent: helper.status === "granted" ? "revoked" : "granted" })}>{helper.status === "granted" ? "Revoke" : "Grant"}</button>}
        </div>)}
        {data?.officers.map(name => <div className="list-row static" key={name}><div><strong>{name}</strong><small>Assigned relief officer</small></div></div>)}
        <div className="list-row static"><div><strong>Simulated public rails</strong><small>Identity, scheme registry, and mock payment services</small></div><LockKeyhole size={18} /></div>
      </div>}
    </Panel>
    <Panel><h2>Request a correction</h2><form onSubmit={event => { event.preventDefault(); void change("correction", { field, value }); }}>
      <div className="form-grid"><label>Field<select value={field} onChange={event => setField(event.target.value)}>
        <option value="full_name">Name</option><option value="phone">Mock phone</option><option value="village_area">Demo area</option>
        <option value="household_size">Household size</option><option value="monthly_income_mock">Monthly income</option>
      </select></label><label>Proposed synthetic value<input required maxLength={160} value={value} onChange={event => setValue(event.target.value)} /></label></div>
      <div className="actions"><button className="primary" disabled={busy}>Request correction</button></div>
    </form>
    {data?.corrections.map(request => <div className="list-row static" key={request.id}><div><strong>{title(request.field_name)}</strong><small>{request.proposed_value}</small></div><StateTag value={request.status} /></div>)}
    </Panel>
  </div>;
}

const reviewOptions = { assign: "Assign to me", more_proof: "Request more proof", escalate: "Escalate", approve: "Approve", reject: "Reject", close: "Close case" } as const;

const kanbanColumns: { key: string; label: string; dot: string; statuses: Claim["status"][] }[] = [
  { key: "todo", label: "To do", dot: "#0A84FF", statuses: ["submitted"] },
  { key: "proof", label: "Needs proof", dot: "#FF9F0A", statuses: ["needs_proof"] },
  { key: "review", label: "In review", dot: "#5856D6", statuses: ["in_review"] },
  { key: "decided", label: "Decided", dot: "#34C759", statuses: ["approved", "rejected", "closed"] },
];

function ConfidenceRing({ value }: { value: number | null }) {
  const size = 34, stroke = 4, radius = (size - stroke) / 2, circumference = 2 * Math.PI * radius;
  const ratio = Math.min(Math.max(value ?? 0, 0), 1);
  const color = value === null ? "#C7C7CC" : value >= 0.8 ? "#34C759" : value >= 0.5 ? "#FF9F0A" : "#FF3B30";
  return <svg className="kanban-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
    <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(120,120,128,0.16)" strokeWidth={stroke} />
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
  const claim = data?.find(item => item.id === selected);

  async function update(action: "review" | "disburse") {
    if (!claim) return;
    setBusy(true); setProblem(""); setNotice("");
    try {
      const updated = await api<Claim>(action, action === "review" ? { claimId: claim.id, decision, reason, reasonUr } : { claimId: claim.id });
      setDecision(["approved", "rejected"].includes(updated.status) ? "close" : "assign");
      setNotice(action === "review" ? "Officer decision recorded." : "Simulated payment issued.");
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
      <div className="rows">{claim.documents?.map(doc => <div className="list-row static" key={doc.id}><div><strong>{title(doc.doc_type)}</strong>
        <small>{doc.tamper_reason ?? doc.ocr_json.summary ?? "No model report"}</small>
        {doc.blur_score !== null && <small>Blur score {pc(doc.blur_score)}</small>}
        {doc.ocr_json.fields && <small>{Object.entries(doc.ocr_json.fields).map(([field, value]) => title(field) + ": " + value).join(" · ")}</small>}
        {doc.file_url && <a className="text-link" href={doc.file_url} target="_blank" rel="noreferrer">Open synthetic image</a>}
      </div><StateTag value={doc.verified_status} /></div>)}</div>
      <Notice text={problem} warning /><Notice text={notice} />
      {claim.status !== "closed" && <form onSubmit={event => { event.preventDefault(); void update("review"); }}>
        <label>Officer action<select value={decision} onChange={event => setDecision(event.target.value as keyof typeof reviewOptions)}>
          {(Object.entries(reviewOptions) as [keyof typeof reviewOptions, string][]).filter(([key]) => ["approved", "rejected"].includes(claim.status) ? key === "close" : key !== "close" && !(key === "approve" && claim.status === "needs_proof")).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </select></label>
        <label>Plain-language reason<textarea required minLength={5} maxLength={600} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <label>Urdu reason <small>(optional)</small><textarea lang="ur" dir="rtl" maxLength={600} value={reasonUr} onChange={event => setReasonUr(event.target.value)} /></label>
        <div className="actions"><button className="primary" disabled={busy || ctx.offline}>Record decision</button>
          {claim.status === "approved" && claim.payment_status === "pending" && <button className="secondary" type="button" disabled={busy || ctx.offline} onClick={() => void update("disburse")}>Issue simulated payment</button>}</div>
      </form>}
      {claim.payment && <p className="receipt">{claim.payment.raast_ref} · {currency(claim.payment.amount_pkr)} · {title(claim.payment.status)}</p>}
    </Panel>
  </div>;

  const needle = query.trim().toLowerCase();
  const filtered = (data ?? []).filter(item =>
    !needle || (item.citizen_name ?? "").toLowerCase().includes(needle) || item.id.toLowerCase().includes(needle));

  return <div className="view-stack">
    <Panel className="kanban-panel">
      <div className="panel-head"><div><h2>Review queue</h2><p>Board view · lower confidence cases appear first.</p></div><span className="pill neutral">{data?.length ?? 0} cases</span></div>
      <div className="kanban-toolbar">
        <span className="kanban-search"><Search size={15} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search citizen or claim ID" aria-label="Search claims" /></span>
      </div>
      <Notice text={error} warning />
      {loading && !data ? <Spinner /> : !data ?
        <p className="empty">{ctx.offline ? "Reconnect to load the officer queue." : "The queue is unavailable right now."}</p> :
        filtered.length === 0 ?
          <p className="empty">No claims match “{query}”.</p> :
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
                  const urgent = item.status === "needs_proof" || (item.ai_confidence !== null && item.ai_confidence < 0.5);
                  const initials = (item.citizen_name ?? "?").split(" ").map(word => word[0]).slice(0, 2).join("");
                  const confColor = item.ai_confidence === null ? "var(--soft-ink)" : item.ai_confidence >= 0.8 ? "#1d8f43" : item.ai_confidence >= 0.5 ? "#b26a00" : "#d70015";
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
  </div>;
}

type Metric = { threshold: number; smsCount: number; docCount: number; [key: string]: number };
const metrics = {
  bad_approvals: "Bad automatic approvals", genuine_reviewed: "Genuine cases below threshold", officer_review_rate: "Officer review rate",
  below_threshold_rate: "Cases below threshold", scam_false_alarms: "Scam false alarms", scam_misses: "Scam misses",
  forgery_false_alarms: "Forgery false alarms", forgery_misses: "Forgery misses",
};
function AuditView({ ctx }: { ctx: ViewContext }) {
  const [tab, setTab] = useState<"events" | "eval">("events");
  const [filter, setFilter] = useState("");
  const [selection, setSelection] = useState<Audit>();
  const logs = useActionList<Audit[]>("audit", ctx);
  const safety = useActionList<Metric[]>("safety", ctx);
  return <div className="view-stack">
    <div className="tabs"><button aria-pressed={tab === "events"} onClick={() => setTab("events")}>Audit events</button><button aria-pressed={tab === "eval"} onClick={() => setTab("eval")}>Decision Safety Eval</button></div>
    {tab === "events" ? <Panel><div className="panel-head"><div><h2>Append-only audit trail</h2><p>Read-only view of the most recent events.</p></div><LockKeyhole size={22} /></div>
      <label>Filter events<input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Role, event, outcome, or entity" /></label>
      <Notice text={logs.error} warning />
      {logs.loading && !logs.data ? <Spinner /> : <div className="table-scroll"><table><thead><tr><th>Event</th><th>Actor</th><th>Outcome</th><th>Rule · Model</th><th>Time</th></tr></thead>
        <tbody>{logs.data?.filter(row => [row.actor_role, row.event_type, row.outcome, row.entity_id].join(" ").toLowerCase().includes(filter.toLowerCase())).map(row =>
          <tr key={row.id}><td><button className="text-link" onClick={() => setSelection(row)}>{title(row.event_type)}</button></td><td>{title(row.actor_role)}</td><td>{title(row.outcome)}</td>
            <td>{row.rule_version ? "v" + row.rule_version + " · " : ""}{row.model_version}</td><td>{new Date(row.created_at).toLocaleString()}</td></tr>)}</tbody>
      </table></div>}
      {selection && <details className="citation" open><summary>Event {selection.id} · {title(selection.event_type)}</summary>
        <p className="breakable">{selection.entity_type} {selection.entity_id}{selection.confidence !== null ? " · " + pc(selection.confidence) : ""}</p>
        <pre>{JSON.stringify(selection.metadata_json, null, 2)}</pre>
      </details>}
    </Panel> : <Panel><div className="panel-head"><div><h2>Threshold comparison</h2><p>Synthetic evaluation of {safety.data?.[0]?.smsCount ?? 0} messages and {safety.data?.[0]?.docCount ?? 0} document cases.</p></div></div>
      <Notice text={safety.error} warning />
      {safety.loading && !safety.data ? <Spinner /> : <div className="table-scroll"><table><thead><tr><th>Outcome</th>{safety.data?.map(row => <th key={row.threshold}>{row.threshold === 0.9 ? "Strict" : "Relaxed"} · {row.threshold.toFixed(2)}</th>)}</tr></thead>
        <tbody>{Object.entries(metrics).map(([key, label]) => <tr key={key}><td>{label}</td>{safety.data?.map(row => <td key={row.threshold}>{key.endsWith("_rate") ? pc(row[key]) : row[key]}</td>)}</tr>)}</tbody>
      </table></div>}
    </Panel>}
  </div>;
}
