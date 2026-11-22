"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowUpRight, CheckCircle2, MessageSquare, Power, QrCode, RefreshCw, Smartphone } from "lucide-react";
import { api } from "@/src/lib/client";
import type { MiniApp, Overview, RuleConfig, SchemeBudget } from "@/src/lib/contracts";

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
      {budget && !editing && <button type="button" className="audit-glass-open-btn" disabled={offline || loading} onClick={() => {
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
  const [state, setState] = useState<WhatsAppState | null>(null);
  const [loading, setLoading] = useState(!offline);
  const [busy, setBusy] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      if (offline) return;
      try {
        setLoading(true);
        const res = await fetch("/api/whatsapp/admin");
        if (!res.ok) throw new Error("Could not load WhatsApp admin status");
        const json = (await res.json()) as WhatsAppState;
        if (active) {
          setState(json);
          if (json.adminPhone) setPhoneInput(json.adminPhone);
        }
      } catch {
        if (active) {
          setState({
            status: "qr_ready",
            adminPhone: null,
            botName: "Relief Assist WhatsApp Official Bot",
            qrDataUrl: null,
            activeUsersCount: 0,
          });
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [offline]);

  async function triggerAction(action: "connect" | "disconnect" | "refresh_qr", phoneToUse?: string) {
    if (busy || offline) return;
    try {
      setBusy(true);
      setErrorMsg("");
      const payload: { action: string; phone?: string } = { action };
      if (action === "connect") {
        const p = (phoneToUse ?? phoneInput).trim();
        if (!p) {
          setErrorMsg("Please enter your admin WhatsApp number to pair.");
          setBusy(false);
          return;
        }
        payload.phone = p;
      }
      const res = await fetch("/api/whatsapp/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errJson.error || "Action failed");
      }
      const updated = (await res.json()) as WhatsAppState;
      setState(updated);
      if (action === "refresh_qr") setShowQr(true);
      if (action === "disconnect") setPhoneInput("");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to execute WhatsApp action.");
    } finally {
      setBusy(false);
    }
  }

  const isConnected = state?.status === "connected" && Boolean(state?.adminPhone);

  return (
    <article className="audit-glass-card admin-whatsapp-card" aria-labelledby="admin-wa-heading">
      <header className="audit-glass-head">
        <h2 className="audit-glass-title-group audit-glass-title" id="admin-wa-heading">
          <i className={"audit-glass-dot " + (isConnected ? "green" : "amber")} aria-hidden="true" />
          <span>WhatsApp MCP Gateway</span>
        </h2>
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          <button
            type="button"
            className="audit-glass-open-btn"
            onClick={() => onOpen("whatsapp")}
            title="Open WhatsApp Link mini-app"
          >
            Launch Link App <ArrowUpRight size={13} aria-hidden="true" />
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
                {isConnected ? "WhatsApp Web Paired & Active" : "Admin Pairing Required"}
              </strong>
              <small style={{ color: "rgba(255, 255, 255, 0.75)", fontSize: "0.74rem" }}>
                {isConnected ? `Bot Line: ${state?.adminPhone}` : "Scan QR code or enter your WhatsApp phone number below"}
              </small>
            </div>
          </div>
          <span style={{ fontSize: "0.75rem", background: "rgba(255, 255, 255, 0.15)", padding: "2px 8px", borderRadius: "9999px" }}>
            Baileys MCP v0.4.1
          </span>
        </div>

        {errorMsg && (
          <p style={{ color: "#f87171", fontSize: "0.75rem", margin: 0 }}>
            {errorMsg}
          </p>
        )}

        {/* Active Paired Device Card when Connected */}
        {isConnected && !showQr && (
          <div style={{
            background: "rgba(0, 0, 0, 0.3)",
            border: "1px solid rgba(37, 211, 102, 0.4)",
            borderRadius: "12px",
            padding: "0.85rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
            flexWrap: "wrap",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
              <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#25D366", color: "#fff", display: "grid", placeItems: "center" }}>
                <CheckCircle2 size={18} />
              </div>
              <div>
                <span style={{ fontSize: "0.7rem", color: "rgba(255, 255, 255, 0.65)", textTransform: "uppercase", letterSpacing: "0.04em", display: "block" }}>
                  Active Bot Number (Multi-Device)
                </span>
                <strong style={{ fontSize: "1.05rem", color: "#ffffff", letterSpacing: "0.02em" }}>
                  {state?.adminPhone || "+92 349 2587419"}
                </strong>
                <small style={{ display: "block", fontSize: "0.68rem", color: "rgba(37, 211, 102, 0.9)" }}>
                  Connected · Ready for citizen /login commands &amp; relief queries
                </small>
              </div>
            </div>
            <button
              type="button"
              className="audit-glass-open-btn"
              onClick={() => onOpen("whatsapp")}
              style={{ padding: "0.35rem 0.65rem", fontSize: "0.74rem" }}
            >
              View Messages Stream <ArrowUpRight size={12} />
            </button>
          </div>
        )}

        {/* WhatsApp QR Code Section (Only when not connected or explicitly toggled to re-pair) */}
        {(!isConnected || showQr) && state?.qrDataUrl && (
          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "0.5rem",
            background: "#ffffff",
            borderRadius: "14px",
            padding: "0.85rem",
            color: "#111827",
            textAlign: "center",
          }}>
            <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "#065f46" }}>
              {isConnected ? "Re-pair Secondary WhatsApp Session" : "Scan with WhatsApp on Admin Phone"}
            </span>
            <img
              key={state.qrDataUrl.slice(-24)}
              src={state.qrDataUrl}
              alt="WhatsApp Web Pairing QR Code"
              style={{ width: "160px", height: "160px", borderRadius: "8px", border: "1px solid #e5e7eb" }}
            />
            <small style={{ fontSize: "0.7rem", color: "#4b5563", maxWidth: "260px" }}>
              Open <strong>WhatsApp &gt; Linked Devices &gt; Link a Device</strong> and point your camera at this QR code.
            </small>
          </div>
        )}

        {/* Dynamic Admin Phone Pairing Input (When not yet connected) */}
        {!isConnected && (
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.4rem",
            background: "rgba(0, 0, 0, 0.25)",
            padding: "0.75rem",
            borderRadius: "10px",
            border: "1px solid rgba(255, 255, 255, 0.12)",
          }}>
            <label style={{ fontSize: "0.74rem", color: "rgba(255, 255, 255, 0.85)", fontWeight: 500 }}>
              Your WhatsApp Phone Number:
            </label>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              <input
                type="tel"
                value={phoneInput}
                onChange={e => setPhoneInput(e.target.value)}
                placeholder="+92 300 1234567"
                style={{
                  flex: 1,
                  background: "rgba(0, 0, 0, 0.5)",
                  border: "1px solid rgba(255, 255, 255, 0.25)",
                  borderRadius: "8px",
                  padding: "0.4rem 0.65rem",
                  color: "#ffffff",
                  fontSize: "0.82rem",
                  outline: "none",
                }}
              />
              <button
                type="button"
                className="audit-glass-open-btn"
                disabled={busy || offline || !phoneInput.trim()}
                onClick={() => void triggerAction("connect")}
                style={{
                  background: "#25D366",
                  color: "#ffffff",
                  border: "none",
                  fontWeight: 600,
                  padding: "0.4rem 0.85rem",
                }}
              >
                Pair Phone
              </button>
            </div>
            <small style={{ fontSize: "0.68rem", color: "rgba(255, 255, 255, 0.6)" }}>
              Entering your number completes pairing with this instance. Users will message this line to log in.
            </small>
          </div>
        )}

        {/* KPIs */}
        <dl className="admin-claim-kpis" style={{ margin: "0.25rem 0" }}>
          <dt>Admin WhatsApp</dt>
          <dd>{state?.adminPhone || "Not paired yet"}</dd>
          <dt>Linked Citizens</dt>
          <dd>{state?.activeUsersCount || 0} active</dd>
          <dt>Supported Commands</dt>
          <dd>/login, /help, claims, policy, scam</dd>
          <dt>LLM Engine</dt>
          <dd>MiMo Flash + Scoped Tools</dd>
        </dl>

        {/* Control Buttons */}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
          {isConnected ? (
            <>
              <button
                type="button"
                className="audit-glass-open-btn"
                disabled={busy || offline}
                onClick={() => setShowQr(prev => !prev)}
              >
                <QrCode size={13} aria-hidden="true" />
                <span>{showQr ? "Hide QR" : "Show Pairing QR"}</span>
              </button>
              <button
                type="button"
                className="audit-glass-open-btn"
                disabled={busy || offline}
                onClick={() => void triggerAction("disconnect")}
              >
                <Power size={13} aria-hidden="true" />
                <span>Disconnect / Re-pair Number</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              className="audit-glass-open-btn"
              disabled={busy || offline}
              onClick={() => void triggerAction("refresh_qr")}
            >
              <RefreshCw size={13} aria-hidden="true" className={busy ? "spin" : ""} />
              <span>Generate Fresh QR Code</span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
