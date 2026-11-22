"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { Claim, Overview, SchemeBudget } from "@/src/lib/contracts";

const formatCompactPkr = (amount: number) => {
  if (amount >= 1_000_000) return `PKR ${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `PKR ${Math.round(amount / 1_000)}k`;
  return `PKR ${amount.toLocaleString("en-PK")}`;
};

export function OfficerDashboard({
  overview,
  queue,
  budget,
  offline,
  onOpenReview,
}: {
  overview: Overview | null;
  queue: Claim[];
  budget: SchemeBudget | null;
  offline: boolean;
  onOpenReview: () => void;
}) {
  const [pickedApplicant, setPickedApplicant] = useState<string | null>(null);

  const analytics = useMemo(() => {
    const paidPkr = queue
      .filter(c => c.payment_status === "paid")
      .reduce((acc, c) => acc + (c.payment?.amount_pkr ?? c.amount_pkr ?? 0), 0);
    const pendingPkr = queue
      .filter(c => ["submitted", "in_review", "needs_proof", "approved"].includes(c.status) && c.payment_status !== "paid")
      .reduce((acc, c) => acc + (c.amount_pkr || 0), 0);

    // Group real claims by applicant to find people with the most claims
    const byApplicant = new Map<string, { id: string; name: string; count: number; latestStatus: string }>();
    for (const c of queue) {
      const key = c.citizen_id || c.citizen_name || c.id;
      const name = c.citizen_name?.trim() || `Applicant ${key.slice(0, 6)}`;
      const existing = byApplicant.get(key);
      if (existing) {
        existing.count++;
      } else {
        byApplicant.set(key, { id: key, name, count: 1, latestStatus: c.status });
      }
    }
    const rankedApplicants = [...byApplicant.values()].sort((a, b) => b.count - a.count);
    const maxApplicantClaims = Math.max(1, rankedApplicants[0]?.count ?? 1);
    const minApplicantClaims = rankedApplicants.length > 0 ? rankedApplicants[rankedApplicants.length - 1].count : 0;

    // 7-day claim intake sparkline from real created_at/updated_at timestamps
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const days = Array.from({ length: 7 }, (_, i) => {
      const start = todayStart - (6 - i) * 86_400_000;
      const d = new Date(start);
      return {
        start,
        end: start + 86_400_000,
        label: d.toLocaleDateString(undefined, { weekday: "narrow" }),
        count: 0,
      };
    });
    for (const c of queue) {
      const ts = new Date(c.created_at ?? c.updated_at).getTime();
      for (const bucket of days) {
        if (ts >= bucket.start && ts < bucket.end) {
          bucket.count++;
          break;
        }
      }
    }
    const maxDay = Math.max(1, ...days.map(d => d.count));

    return {
      paidPkr,
      pendingPkr,
      rankedApplicants,
      maxApplicantClaims,
      minApplicantClaims,
      days,
      maxDay,
    };
  }, [queue]);

  if (!overview) {
    return (
      <section className="audit-glass-suite is-compact officer-glass-suite" aria-label="Officer dashboard">
        <article className="audit-glass-card">
          <p className="audit-glass-empty">
            {offline ? "Overview reconnects when you are online." : "Loading live review metrics…"}
          </p>
        </article>
      </section>
    );
  }

  // Multi-segment SVG donut geometry
  const R = 40;
  const C = 2 * Math.PI * R;
  const segments = [
    { key: "approved", label: "Approved", count: overview.approved, color: "#34d399" },
    { key: "review", label: "In review", count: overview.review, color: "#818cf8" },
    { key: "proof", label: "Needs proof", count: overview.proof, color: "#fbbf24" },
    { key: "rejected", label: "Rejected", count: overview.rejected, color: "#f43f5e" },
  ];
  const segTotal = Math.max(1, segments.reduce((s, item) => s + item.count, 0));

  // Sparkline SVG path
  const SP_W = 240;
  const SP_H = 44;
  const spPoints = analytics.days.map((d, i) => {
    const x = 6 + (i / 6) * (SP_W - 12);
    const y = SP_H - 8 - (d.count / analytics.maxDay) * (SP_H - 16);
    return { x, y, ...d };
  });
  const linePath = spPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${spPoints[spPoints.length - 1].x.toFixed(1)},${SP_H} L${spPoints[0].x.toFixed(1)},${SP_H} Z`;
  const lastPt = spPoints[spPoints.length - 1];

  return (
    <section className="audit-glass-suite is-compact officer-glass-suite" aria-label="Reviewer analytics dashboard">
      {/* CARD 1: Case Pipeline Donut + Payout Volume + 7-Day Intake Sparkline */}
      <article className="audit-glass-card officer-glass-card" onClick={onOpenReview} role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onOpenReview(); }}>
        <header className="audit-glass-head">
          <div className="audit-glass-title-group">
            <span className="audit-glass-dot green" />
            <span className="audit-glass-kicker">Review pipeline</span>
            <strong className="audit-glass-title">{overview.active} active</strong>
          </div>
          <button
            type="button"
            className="audit-glass-open-btn"
            onClick={e => { e.stopPropagation(); onOpenReview(); }}
          >
            Review Desk <ArrowUpRight size={13} aria-hidden="true" />
          </button>
        </header>

        <div className="officer-donut-row">
          <div className="officer-donut-wrap">
            <svg viewBox="0 0 104 104" className="officer-donut-svg" role="img" aria-label="Claims breakdown by status">
              <circle cx="52" cy="52" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
              {(() => {
                let offset = 0;
                return segments.map(seg => {
                  if (seg.count <= 0) return null;
                  const len = (seg.count / segTotal) * C;
                  const dash = `${Math.max(2, len - 2)} ${C}`;
                  const el = (
                    <circle
                      key={seg.key}
                      cx="52"
                      cy="52"
                      r={R}
                      fill="none"
                      stroke={seg.color}
                      strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={dash}
                      strokeDashoffset={-offset}
                      transform="rotate(-90 52 52)"
                    >
                      <title>{`${seg.label}: ${seg.count}`}</title>
                    </circle>
                  );
                  offset += len;
                  return el;
                });
              })()}
            </svg>
            <div className="officer-donut-center">
              <strong>{overview.active}</strong>
              <small>ACTIVE</small>
            </div>
          </div>

          <div className="officer-kpi-grid">
            <div className="officer-kpi-cell">
              <span className="officer-kpi-label"><i style={{ background: "#818cf8" }} />In review</span>
              <strong>{overview.review}</strong>
            </div>
            <div className="officer-kpi-cell">
              <span className="officer-kpi-label"><i style={{ background: "#fbbf24" }} />Needs proof</span>
              <strong>{overview.proof}</strong>
            </div>
            <div className="officer-kpi-cell">
              <span className="officer-kpi-label"><i style={{ background: "#34d399" }} />Approved</span>
              <strong>{overview.approved}</strong>
            </div>
            <div className="officer-kpi-cell">
              <span className="officer-kpi-label"><i style={{ background: "#f43f5e" }} />Rejected</span>
              <strong>{overview.rejected}</strong>
            </div>
          </div>
        </div>

        {/* 7-Day Intake Sparkline + Payout Strip */}
        <div className="officer-spark-block">
          <div className="officer-spark-head">
            <span className="audit-metric-label">7-day intake · {overview.new_this_month} this mo</span>
            <span className="officer-payout-pill">
              {overview.paid} paid · {formatCompactPkr(analytics.paidPkr)}
            </span>
          </div>
          <svg viewBox={`0 0 ${SP_W} ${SP_H}`} className="officer-spark-svg" role="img" aria-label="7-day claim intake trend">
            <defs>
              <linearGradient id="officer-spark-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34d399" stopOpacity={0.38} />
                <stop offset="100%" stopColor="#34d399" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <path d={areaPath} fill="url(#officer-spark-grad)" />
            <path d={linePath} fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={lastPt.x} cy={lastPt.y} r="3.2" fill="#ffffff" stroke="#34d399" strokeWidth="2" />
          </svg>
        </div>
      </article>

      {/* CARD 2: Top Claimants Histogram Card (Airbnb-style rounded bars + range pills) */}
      {(() => {
        const list = analytics.rankedApplicants;
        const barCount = Math.min(18, Math.max(list.length, 12));
        // Arrange real applicants in a smooth bell-like distribution centered on the highest claimants
        const bars = Array.from({ length: barCount }, (_, idx) => {
          const item = list[idx] ?? null;
          const heightRatio = item
            ? Math.max(0.18, item.count / analytics.maxApplicantClaims)
            : Math.max(0.08, 0.24 - ((idx - list.length) * 0.02));
          const isHighlighted = item ? idx < Math.max(1, Math.min(5, Math.ceil(list.length * 0.6))) : false;
          return { idx, item, heightRatio, isHighlighted };
        });

        const topPerson = list[0] ?? null;
        const secondPerson = list[1] ?? null;
        const focused = (pickedApplicant ? list.find(p => p.id === pickedApplicant) : null) ?? topPerson;

        const W = 280;
        const H = 76;
        const BASE_Y = 64;
        const MAX_H = 52;
        const step = W / barCount;
        const barW = Math.max(7, Math.min(14, step * 0.68));
        const activeStartIdx = 0;
        const activeEndIdx = Math.max(0, Math.min(barCount - 1, Math.min(list.length - 1, 4)));
        const thumb1X = activeStartIdx * step + step / 2;
        const thumb2X = activeEndIdx * step + step / 2;

        return (
          <article
            className="audit-glass-card officer-glass-card"
            onClick={onOpenReview}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onOpenReview(); }}
          >
            <header className="audit-glass-head">
              <div className="audit-glass-title-group">
                <span className="audit-glass-dot violet" />
                <span className="audit-glass-kicker">Most claims</span>
                <strong className="audit-glass-title">{list.length} applicants</strong>
              </div>
              <span className="officer-meta-chip">
                {overview.priority} priority
              </span>
            </header>

            {/* Rounded vertical histogram bars + range slider baseline */}
            <div className="officer-hist-wrap">
              <svg viewBox={`0 0 ${W} ${H}`} className="audit-svg" role="img" aria-label="Applicants ranked by number of claims">
                {bars.map(b => {
                  const x = b.idx * step + (step - barW) / 2;
                  const h = Math.max(6, b.heightRatio * MAX_H);
                  const y = BASE_Y - h;
                  const isPicked = Boolean(b.item && focused?.id === b.item.id);
                  return (
                    <rect
                      key={b.idx}
                      x={x}
                      y={y}
                      width={barW}
                      height={h}
                      rx={3.5}
                      fill={
                        isPicked
                          ? "#3b82f6"
                          : b.isHighlighted
                            ? "rgba(59, 130, 246, 0.72)"
                            : "rgba(255, 255, 255, 0.18)"
                      }
                      className={b.item ? "audit-svg-interactive" : undefined}
                      onMouseEnter={() => { if (b.item) setPickedApplicant(b.item.id); }}
                      onClick={e => {
                        if (b.item) {
                          e.stopPropagation();
                          setPickedApplicant(b.item.id);
                        }
                      }}
                    >
                      <title>
                        {b.item ? `${b.item.name}: ${b.item.count} claim(s)` : "No additional applicants"}
                      </title>
                    </rect>
                  );
                })}

                {/* Baseline track + highlighted span + circular white range thumbs */}
                <line x1={4} y1={BASE_Y + 4} x2={W - 4} y2={BASE_Y + 4} stroke="rgba(255, 255, 255, 0.16)" strokeWidth={2} strokeLinecap="round" />
                {list.length > 0 && (
                  <>
                    <line x1={thumb1X} y1={BASE_Y + 4} x2={Math.max(thumb1X + 8, thumb2X)} y2={BASE_Y + 4} stroke="#3b82f6" strokeWidth={2.5} strokeLinecap="round" />
                    <circle cx={thumb1X} cy={BASE_Y + 4} r={5.5} fill="#ffffff" stroke="rgba(59, 130, 246, 0.85)" strokeWidth={1.8} />
                    <circle cx={Math.max(thumb1X + 14, thumb2X)} cy={BASE_Y + 4} r={5.5} fill="#ffffff" stroke="rgba(59, 130, 246, 0.85)" strokeWidth={1.8} />
                  </>
                )}
              </svg>
            </div>

            {/* Dual Rounded Pills (Top Applicant vs Runner-Up / Range) */}
            <div className="officer-range-pills">
              <div className="officer-range-col">
                <span className="officer-range-label">Top claimant</span>
                <div className="officer-range-pill is-primary">
                  <strong>{focused ? focused.name.split(" ")[0] : "—"}</strong>
                  <span>{focused ? `${focused.count} claims` : "0"}</span>
                </div>
              </div>
              <div className="officer-range-col">
                <span className="officer-range-label">{secondPerson ? "Next highest" : "Range"}</span>
                <div className="officer-range-pill">
                  <strong>{secondPerson ? secondPerson.name.split(" ")[0] : `${analytics.minApplicantClaims}–${analytics.maxApplicantClaims}`}</strong>
                  <span>{secondPerson ? `${secondPerson.count} claims` : "claims"}</span>
                </div>
              </div>
            </div>

            <p className="officer-hist-foot">
              {focused
                ? <>{focused.name} · <strong>{focused.count} claims</strong> on queue</>
                : "No claims in queue yet"}
            </p>
          </article>
        );
      })()}

      {/* CARD 3: Compact Overall Scheme Budget Strip (shared across Admin & Reviewer) */}
      {(() => {
        const reservedFallback = queue
          .filter(c => c.status === "approved" && c.payment_status !== "paid" && c.funding_status !== "awaiting_funds")
          .reduce((acc, c) => acc + (c.amount_pkr || 0), 0);
        const awaitingFallback = queue.filter(c => c.status === "approved" && c.funding_status === "awaiting_funds").length;
        const paidTotal = budget?.paid_pkr ?? analytics.paidPkr;
        const reservedTotal = budget?.reserved_pkr ?? reservedFallback;
        const totalPool = budget?.total_pkr ?? Math.max(paidTotal + reservedTotal + analytics.pendingPkr, 1);
        const availableTotal = budget?.available_pkr ?? Math.max(0, totalPool - paidTotal - reservedTotal);
        const awaitingCount = budget?.awaiting_claims ?? awaitingFallback;
        const usedPct = totalPool > 0 ? Math.min(100, Math.round(((paidTotal + reservedTotal) / totalPool) * 100)) : 0;

        return (
          <article
            className="audit-glass-card officer-glass-card officer-budget-card"
            onClick={onOpenReview}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onOpenReview(); }}
          >
            <header className="audit-glass-head">
              <div className="audit-glass-title-group">
                <span className="audit-glass-dot green" />
                <span className="audit-glass-kicker">Scheme budget</span>
                <strong className="audit-glass-title">{budget ? formatCompactPkr(totalPool) : "Live payouts"}</strong>
              </div>
              <span className="officer-meta-chip">
                {awaitingCount > 0 ? `${awaitingCount} awaiting funds` : `${usedPct}% allocated`}
              </span>
            </header>

            <div className="officer-budget-kpis">
              <div className="officer-kpi-cell">
                <span className="officer-kpi-label"><i style={{ background: "#34d399" }} />Available</span>
                <strong>{formatCompactPkr(availableTotal)}</strong>
              </div>
              <div className="officer-kpi-cell">
                <span className="officer-kpi-label"><i style={{ background: "#fbbf24" }} />Reserved</span>
                <strong>{formatCompactPkr(reservedTotal)}</strong>
              </div>
              <div className="officer-kpi-cell">
                <span className="officer-kpi-label"><i style={{ background: "#64c4ff" }} />Paid</span>
                <strong>{formatCompactPkr(paidTotal)}</strong>
              </div>
            </div>

            <div className="audit-prop-bar" role="img" aria-label="Scheme budget utilization">
              {paidTotal > 0 && <span className="audit-prop-seg" style={{ flexGrow: paidTotal, background: "#64c4ff" }} />}
              {reservedTotal > 0 && <span className="audit-prop-seg" style={{ flexGrow: reservedTotal, background: "#fbbf24" }} />}
              {availableTotal > 0 && <span className="audit-prop-seg" style={{ flexGrow: availableTotal, background: "#34d399" }} />}
            </div>
          </article>
        );
      })()}
    </section>
  );
}
