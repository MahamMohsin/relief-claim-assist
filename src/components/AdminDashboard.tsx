"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { api } from "@/src/lib/client";
import type { MiniApp, Overview, RuleConfig } from "@/src/lib/contracts";

type Scheme = { version: number; name: string; config: RuleConfig };
type Summary = { claims: Overview | null; scheme: Scheme | null; staffCount: number | null };
const emptySummary: Summary = { claims: null, scheme: null, staffCount: null };
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
    ]).then(([claims, scheme, staff]) => {
      if (controller.signal.aborted) return;
      const currentClaims = claims.status === "fulfilled" ? claims.value : null;
      const currentScheme = scheme.status === "fulfilled" ? scheme.value : null;
      const currentStaff = staff.status === "fulfilled" && Array.isArray(staff.value) ? staff.value.length : null;
      setSummary(previous => ({
        claims: currentClaims ?? previous.claims,
        scheme: currentScheme ?? previous.scheme,
        staffCount: currentStaff ?? previous.staffCount,
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
    </section>
  );
}
