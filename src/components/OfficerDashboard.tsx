"use client";

import { useMemo } from "react";
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
  const analytics = useMemo(() => {
    const docs = queue.flatMap(c => c.documents ?? []);
    const verifiedDocs = docs.filter(d => ["genuine", "readable", "verified"].includes(d.verified_status)).length;
    const suspectDocs = docs.filter(d => d.tamper_flag || ["suspect", "tampered"].includes(d.verified_status)).length;
    const pendingDocs = Math.max(0, docs.length - verifiedDocs - suspectDocs);
    const verifiedPct = docs.length > 0 ? Math.round((verifiedDocs / docs.length) * 100) : 0;

    const confValues = queue
      .map(c => c.ai_confidence)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const avgReliability = confValues.length
      ? Math.round((confValues.reduce((a, b) => a + b, 0) / confValues.length) * 100)
      : null;

    // 4-band confidence distribution from live queue
    const bands = [
      { key: "low", label: "<50%", fill: "#ff7854", soft: "#ef4444", count: 0 },
      { key: "mid", label: "50–70%", fill: "#fbbf24", soft: "#d97706", count: 0 },
      { key: "good", label: "70–90%", fill: "#64c4ff", soft: "#38bdf8", count: 0 },
      { key: "high", label: "90%+", fill: "#34d399", soft: "#10b981", count: 0 },
    ];
    for (const v of confValues) {
      if (v < 0.5) bands[0].count++;
      else if (v < 0.7) bands[1].count++;
      else if (v < 0.9) bands[2].count++;
      else bands[3].count++;
    }
    const maxBand = Math.max(1, ...bands.map(b => b.count));

    const paidPkr = queue
      .filter(c => c.payment_status === "paid")
      .reduce((acc, c) => acc + (c.payment?.amount_pkr ?? c.amount_pkr ?? 0), 0);
    const pendingPkr = queue
      .filter(c => ["submitted", "in_review", "needs_proof", "approved"].includes(c.status) && c.payment_status !== "paid")
      .reduce((acc, c) => acc + (c.amount_pkr || 0), 0);
    const totalReports = queue.reduce((acc, c) => acc + (c.reports ?? 0), 0);

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
      docsCount: docs.length,
      verifiedDocs,
      suspectDocs,
      pendingDocs,
      verifiedPct,
      avgReliability,
      bands,
      maxBand,
      paidPkr,
      pendingPkr,
      totalReports,
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

      {/* CARD 2: AI Triage Reliability & Document Integrity */}
      <article className="audit-glass-card officer-glass-card" onClick={onOpenReview} role="button" tabIndex={0} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onOpenReview(); }}>
        <header className="audit-glass-head">
          <div className="audit-glass-title-group">
            <span className="audit-glass-dot violet" />
            <span className="audit-glass-kicker">AI triage</span>
            <strong className="audit-glass-title">{overview.priority} priority</strong>
          </div>
          <span className="officer-meta-chip">
            {analytics.totalReports > 0 ? `${analytics.totalReports} alerts` : `${overview.closed} closed`}
          </span>
        </header>

        <div className="officer-triage-metrics">
          <div className="officer-triage-stat">
            <span className="audit-metric-label">Avg reliability</span>
            <div className="audit-score-num-wrap">
              <strong className="officer-big-stat">{analytics.avgReliability ?? "—"}</strong>
              <span className="audit-score-denom">%</span>
            </div>
          </div>
          <div className="officer-triage-stat">
            <span className="audit-metric-label">Docs verified</span>
            <strong className="officer-mid-stat">{analytics.verifiedPct}%</strong>
            <small className="officer-sub-stat">{analytics.verifiedDocs}/{analytics.docsCount}</small>
          </div>
          <div className="officer-triage-stat">
            <span className="audit-metric-label">Tamper flags</span>
            <strong className={"officer-mid-stat" + (analytics.suspectDocs > 0 ? " is-warn" : " is-ok")}>
              {analytics.suspectDocs}
            </strong>
            <small className="officer-sub-stat">{analytics.suspectDocs > 0 ? "Inspect" : "All clean"}</small>
          </div>
        </div>

        {/* 4-Band AI Reliability Distribution Bar Chart */}
        <div className="officer-bars-wrap">
          <svg viewBox="0 0 280 78" className="audit-svg" role="img" aria-label="AI confidence distribution across queued claims">
            <defs>
              {analytics.bands.map(b => (
                <linearGradient key={b.key} id={`off-bar-${b.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={b.fill} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={b.soft} stopOpacity={0.28} />
                </linearGradient>
              ))}
            </defs>
            {analytics.bands.map((band, idx) => {
              const slotW = 280 / 4;
              const colW = 40;
              const cx = idx * slotW + slotW / 2;
              const x = cx - colW / 2;
              const plotTop = 16;
              const plotBottom = 60;
              const plotH = plotBottom - plotTop;
              const barH = band.count > 0 ? Math.max(6, (band.count / analytics.maxBand) * plotH) : 0;
              const y = plotBottom - barH;
              return (
                <g key={band.key}>
                  <title>{`${band.label} reliability: ${band.count} case(s)`}</title>
                  <rect x={x} y={plotTop} width={colW} height={plotH} rx={7} fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)" strokeWidth={0.7} />
                  {barH > 0 && (
                    <rect x={x} y={y} width={colW} height={barH} rx={7} fill={`url(#off-bar-${band.key})`} stroke="rgba(255,255,255,0.28)" strokeWidth={0.8} />
                  )}
                  <text x={cx} y={Math.max(11, y - 4)} textAnchor="middle" fontSize={10} fontWeight={700} fontFamily="Geist Mono, ui-monospace, monospace" fill="#ffffff">
                    {band.count}
                  </text>
                  <text x={cx} y={74} textAnchor="middle" fontSize={9.5} fontFamily="Geist Mono, ui-monospace, monospace" fill="rgba(255,255,255,0.62)">
                    {band.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Document Integrity Proportion Bar */}
        {analytics.docsCount > 0 && (
          <div className="audit-prop-bar" role="img" aria-label="Document verification proportions">
            {analytics.verifiedDocs > 0 && <span className="audit-prop-seg" style={{ flexGrow: analytics.verifiedDocs, background: "#34d399" }} />}
            {analytics.pendingDocs > 0 && <span className="audit-prop-seg" style={{ flexGrow: analytics.pendingDocs, background: "#fbbf24" }} />}
            {analytics.suspectDocs > 0 && <span className="audit-prop-seg" style={{ flexGrow: analytics.suspectDocs, background: "#ff7854" }} />}
          </div>
        )}
      </article>

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
