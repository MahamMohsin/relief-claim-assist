"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, CheckCircle2, MessageSquare, Power, QrCode, RefreshCw, Smartphone } from "lucide-react";
import { api } from "@/src/lib/client";
import type { MiniApp, Overview, RuleConfig, SchemeBudget } from "@/src/lib/contracts";
import { cuaEngine } from "./os/cuaEngine";

type Scheme = { version: number; name: string; config: RuleConfig };
type Summary = { claims: Overview | null; scheme: Scheme | null; staffCount: number | null; budget: SchemeBudget | null };
const emptySummary: Summary = { claims: null, scheme: null, staffCount: null, budget: null };
const formatCount = new Intl.NumberFormat("en-PK");

export function AdminDashboard({ offline, version, onOpen }: {
  offline: boolean;
  version: number;
  onOpen: (app: MiniApp) => void;
}) {
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(!offline);
  const [refresh, setRefresh] = useState(0);
  const summaryRef = useRef(summary);
  summaryRef.current = summary;

  useEffect(() => {
    cuaEngine.admin = {
      getSnapshot: () => {
        const s = summaryRef.current;
        return {
          overview: s.claims ? {
            active: s.claims.active,
            review: s.claims.review,
            proof: s.claims.proof,
            approved: s.claims.approved,
            rejected: s.claims.rejected,
            closed: s.claims.closed,
            paid: s.claims.paid,
            newThisMonth: s.claims.new_this_month,
            priority: s.claims.priority,
          } : undefined,
          budget: s.budget ? {
            totalPkr: s.budget.total_pkr,
            availablePkr: s.budget.available_pkr,
            reservedPkr: s.budget.reserved_pkr,
            paidPkr: s.budget.paid_pkr,
            awaitingClaims: s.budget.awaiting_claims,
          } : undefined,
          rules: s.scheme ? {
            activeVersion: s.scheme.version,
            activeName: s.scheme.name,
            config: { ...s.scheme.config },
            pendingStaffCount: s.staffCount ?? undefined,
          } : undefined,
        };
      },
      updateBudget: async (totalPkr, reason) => {
        const current = summaryRef.current.budget ?? await api<SchemeBudget>("scheme_budget");
        const updated = await api<SchemeBudget>("set_scheme_budget", {
          totalPkr,
          expectedTotalPkr: current.total_pkr,
          reason,
        }, AbortSignal.timeout(15000));
        setSummary(previous => ({ ...previous, budget: updated }));
      },
    };
    return () => {
      if (cuaEngine.admin) cuaEngine.admin = null;
    };
  }, []);

  useEffect(() => {
    if (offline) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]);
    setLoading(true);

    void Promise.allSettled([
      api<Overview>("overview", {}, signal),
      api<Scheme>("scheme", {}, signal),
      api<unknown>("staff_queue", {}, signal),
      api<SchemeBudget>("scheme_budget", {}, signal),
    ]).then(([claims, scheme, staff, budget]) => {
      if (controller.signal.aborted) return;
      const currentClaims = claims.status === "fulfilled" ? claims.value : null;
      const currentScheme = scheme.status === "fulfilled" ? scheme.value : null;
      const currentStaff = staff.status === "fulfilled" && Array.isArray(staff.value) ? staff.value.length : null;
      setSummary(previous => ({
        claims: currentClaims ?? previous.claims,
        scheme: currentScheme ?? previous.scheme,
        staffCount: currentStaff ?? previous.staffCount,
        budget: budget.status === "fulfilled" ? budget.value : previous.budget,
      }));
      setFailed(!currentClaims || !currentScheme || currentStaff === null);
      setLoading(false);
    });

    return () => controller.abort();
  }, [offline, version, refresh]);

  const { claims, scheme, staffCount } = summary;
  const breakdown = claims ? [
    { label: "In review queue", count: claims.review },
    { label: "Awaiting evidence", count: claims.proof },
    { label: "Approved", count: claims.approved },
    { label: "Rejected", count: claims.rejected },
    { label: "Closed", count: claims.closed },
  ] : [];
  const largestStatus = Math.max(1, ...breakdown.map(status => status.count));

  return (
    <section className="audit-glass-suite is-compact admin-dashboard" aria-label="Admin dashboard">
      <article className="audit-glass-card" aria-labelledby="admin-claims-heading" aria-busy={!offline && loading}>
        <header className="audit-glass-head">
          <h2 className="audit-glass-title-group audit-glass-title" id="admin-claims-heading">
            <i className="audit-glass-dot violet" aria-hidden="true" /> Claims overview
          </h2>
          <button type="button" className="audit-glass-open-btn" onClick={() => onOpen("audit")}>
            Audit Vault <ArrowUpRight size={13} aria-hidden="true" />
          </button>
        </header>

        {claims ? <>
          <dl className="admin-claim-kpis">
            <dt>Active cases</dt><dd className="audit-score-num">{formatCount.format(claims.active)}</dd>
            <dt>Priority review</dt><dd>{formatCount.format(claims.priority)}</dd>
            <dt>New this month</dt><dd>{formatCount.format(claims.new_this_month)}</dd>
            <dt>Simulated payments</dt><dd>{formatCount.format(claims.paid)}</dd>
          </dl>
          <ul className="admin-claim-breakdown" aria-label="Claims by status">
            {breakdown.map(({ label, count }) => <li key={label}>
              <span>{label}</span>
              <meter aria-label={label} min={0} max={largestStatus} value={count} />
              <strong>{formatCount.format(count)}</strong>
            </li>)}
          </ul>
        </> : <p className="audit-glass-empty admin-dashboard-empty">
          {offline ? "Reconnect to load claim counts." : loading ? "Loading claim counts…" : "Claim counts are unavailable."}
        </p>}
      </article>

      <article className="audit-glass-card" aria-labelledby="admin-operations-heading" aria-busy={!offline && loading}>
        <header className="audit-glass-head">
          <h2 className="audit-glass-title-group audit-glass-title" id="admin-operations-heading">
            <i className="audit-glass-dot green" aria-hidden="true" /> Scheme operations
          </h2>
          <section className="audit-glass-controls" aria-label="Dashboard actions">
            <button type="button" className="audit-glass-open-btn" onClick={() => onOpen("rules")}>
              Rule Studio <ArrowUpRight size={13} aria-hidden="true" />
            </button>
            <button type="button" className="audit-glass-open-btn" aria-label="Refresh admin dashboard"
              title="Refresh admin dashboard" disabled={offline || loading} onClick={() => setRefresh(value => value + 1)}>
              <RefreshCw size={14} aria-hidden="true" />
            </button>
          </section>
        </header>

        {scheme && <header className="admin-active-rule">
          <small>Active rule</small>
          <strong>v{scheme.version}</strong>
          <span>{scheme.name}</span>
        </header>}
        <dl className="admin-scheme-metrics">
          {scheme && <>
            <dt>Monthly income cap</dt><dd>PKR {formatCount.format(scheme.config.income_cap)}</dd>
            <dt>Minimum household size</dt><dd>{formatCount.format(scheme.config.minimum_household)}</dd>
            <dt>Simulated payout per claim</dt><dd>PKR {formatCount.format(scheme.config.amount_pkr)}</dd>
          </>}
          <dt>Pending staff access requests</dt><dd>{staffCount === null ? "—" : formatCount.format(staffCount)}</dd>
        </dl>
        {(offline || failed || (loading && !scheme)) && <p className="admin-dashboard-notice" role="status">
          {offline ? (scheme || claims || staffCount !== null ? "Offline · showing last loaded data." : "Reconnect to load the dashboard.")
            : failed ? "Some figures could not be refreshed. Use Refresh to try again." : "Loading scheme details…"}
        </p>}
      </article>
      <BudgetCard budget={summary.budget} offline={offline} loading={loading}
        onSaved={budget => setSummary(previous => ({ ...previous, budget }))} />
      <WhatsAppGatewayCard offline={offline} onOpen={onOpen} />
    </section>
  );
}

function BudgetCard({ budget, offline, loading, onSaved }: {
  budget: SchemeBudget | null;
  offline: boolean;
  loading: boolean;
  onSaved: (budget: SchemeBudget) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [total, setTotal] = useState("");
  const [expectedTotal, setExpectedTotal] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!budget || expectedTotal === null || offline || saving || loading) return;
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const updated = await api<SchemeBudget>("set_scheme_budget", {
        totalPkr: Number(total), expectedTotalPkr: expectedTotal, reason,
      }, AbortSignal.timeout(15000));
      onSaved(updated);
      setEditing(false);
      setMessage(updated.funded_claims > 0
        ? `Budget saved · funds reserved for ${updated.funded_claims} ${updated.funded_claims === 1 ? "claim" : "claims"}.`
        : "Budget saved.");
    } catch (error) {
      setError(error instanceof Error && error.name !== "TimeoutError" ? error.message : "The request timed out. Refresh before trying again.");
    } finally {
      setSaving(false);
    }
  }

  return <article className="audit-glass-card admin-budget-card" aria-labelledby="admin-budget-heading">
    <header className="audit-glass-head">
      <h2 className="audit-glass-title-group audit-glass-title" id="admin-budget-heading">
        <i className="audit-glass-dot green" aria-hidden="true" /> Scheme budget
      </h2>
      {budget && !editing && <button type="button" data-cua="admin-budget-edit" className="audit-glass-open-btn" disabled={offline || loading} onClick={() => {
        setTotal(String(budget.total_pkr)); setExpectedTotal(budget.total_pkr); setReason("");
        setMessage(""); setError(""); setEditing(true);
      }}>Edit budget</button>}
    </header>
    {budget ? <>
      <dl className="admin-claim-kpis">
        <dt>Total budget</dt><dd>PKR {formatCount.format(budget.total_pkr)}</dd>
        <dt>Available</dt><dd>PKR {formatCount.format(budget.available_pkr)}</dd>
        <dt>Reserved</dt><dd>PKR {formatCount.format(budget.reserved_pkr)}</dd>
        <dt>Paid</dt><dd>PKR {formatCount.format(budget.paid_pkr)}</dd>
      </dl>
      <p className="admin-dashboard-notice">{formatCount.format(budget.awaiting_claims)} {budget.awaiting_claims === 1 ? "claim" : "claims"} awaiting funds</p>
    </> : <p className="admin-dashboard-notice">
      {offline ? "Reconnect to load the scheme budget." : loading ? "Loading scheme budget…" : "Budget is unavailable. Use Refresh to try again."}
    </p>}
    {editing && budget && <form className="admin-budget-form" onSubmit={event => void save(event)}>
      <label>Total budget (PKR)<input required type="number" min={budget.reserved_pkr + budget.paid_pkr} max={999999999999} step={1}
        value={total} onChange={event => setTotal(event.target.value)} /></label>
      <label>Reason for change<input required minLength={5} maxLength={300} value={reason}
        onChange={event => setReason(event.target.value)} /></label>
      <button className="audit-glass-open-btn" type="submit" disabled={offline || saving || loading}>{saving ? "Saving…" : "Save budget"}</button>
      <button className="audit-glass-open-btn" type="button" disabled={saving} onClick={() => { setEditing(false); setError(""); }}>Cancel</button>
    </form>}
    {message && <p className="admin-dashboard-notice" role="status">{message}</p>}
    {error && <p className="admin-dashboard-notice" role="alert">{error}</p>}
  </article>;
}

type WhatsAppState = {
  status: "connected" | "qr_ready" | "disconnected";
  adminPhone: string | null;
  botName: string;
  qrDataUrl: string | null;
  activeUsersCount: number;
};

function WhatsAppGatewayCard({ offline, onOpen }: {
  offline: boolean;
  onOpen: (app: MiniApp) => void;
}) {
  const [agentInfo, setAgentInfo] = useState<{ isConfigured: boolean; agentName: string | null; maskedKey: string | null } | null>(null);
  const [loading, setLoading] = useState(!offline);

  useEffect(() => {
    let active = true;
    async function load() {
      if (offline) return;
      try {
        setLoading(true);
        const res = await fetch("/api/whatsapp/agent-key?persona=kamran");
        if (res.ok) {
          const json = await res.json();
          if (active) setAgentInfo(json);
        }
      } catch {
        // Ignored
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [offline]);

  const isConnected = Boolean(agentInfo?.isConfigured);

  return (
    <article className="audit-glass-card admin-whatsapp-card" aria-labelledby="admin-wa-heading">
      <header className="audit-glass-head">
        <h2 className="audit-glass-title-group audit-glass-title" id="admin-wa-heading">
          <i className={"audit-glass-dot " + (isConnected ? "green" : "amber")} aria-hidden="true" />
          <span>Official WhatsApp AI Agent</span>
        </h2>
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <button
            type="button"
            className="audit-glass-open-btn"
            onClick={() => onOpen("whatsapp")}
            title="Open WhatsApp Agent mini-app"
          >
            Launch Agent App <ArrowUpRight size={13} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.5rem" }}>
        {/* Connection Status Banner */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.5rem",
          background: isConnected ? "rgba(37, 211, 102, 0.12)" : "rgba(245, 158, 11, 0.12)",
          border: `1px solid ${isConnected ? "rgba(37, 211, 102, 0.35)" : "rgba(245, 158, 11, 0.35)"}`,
          borderRadius: "12px",
          padding: "0.65rem 0.85rem",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div style={{ background: isConnected ? "#25D366" : "#f59e0b", color: "#fff", borderRadius: "50%", width: "24px", height: "24px", display: "grid", placeItems: "center" }}>
              {isConnected ? <CheckCircle2 size={15} /> : <Smartphone size={15} />}
            </div>
            <div>
              <strong style={{ fontSize: "0.88rem", display: "block" }}>
                {isConnected ? `Agent Active: ${agentInfo?.agentName || "Ali"}` : "Agent API Key Required"}
              </strong>
              <small style={{ color: "rgba(255, 255, 255, 0.75)", fontSize: "0.74rem" }}>
                {isConnected ? "Direct Meta WhatsApp Agent API · Listening for messages" : "Connect your WhatsApp Agent API key in the mini-app to activate chat"}
              </small>
            </div>
          </div>
          <span style={{ fontSize: "0.75rem", background: "rgba(255, 255, 255, 0.15)", padding: "2px 8px", borderRadius: "9999px" }}>
            Meta 3P Agent API
          </span>
        </div>

        {/* KPIs */}
        <dl className="admin-claim-kpis" style={{ margin: "0.25rem 0" }}>
          <dt>WhatsApp Agent</dt>
          <dd style={{ color: isConnected ? "#34d399" : "rgba(255, 255, 255, 0.7)" }}>
            {isConnected ? `${agentInfo?.agentName || "Ali"} (Online)` : "Not configured"}
          </dd>
          <dt>API Key Status</dt>
          <dd>{isConnected ? `Connected (${agentInfo?.maskedKey})` : "Pending Key"}</dd>
          <dt>Admin Role</dt>
          <dd>Scheme Administrator</dd>
          <dt>LLM Engine</dt>
          <dd>MiMo Flash + Scoped Tools</dd>
        </dl>

        {/* Control Button */}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
          <button
            type="button"
            className="audit-glass-open-btn"
            onClick={() => onOpen("whatsapp")}
          >
            <ArrowUpRight size={13} aria-hidden="true" />
            <span>{isConnected ? "Manage Agent & Live Messages" : "Connect WhatsApp Agent API Key"}</span>
          </button>
        </div>
      </div>
    </article>
  );
}
