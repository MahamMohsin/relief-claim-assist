"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, LockKeyhole, RefreshCw, Search, ShieldCheck } from "lucide-react";
import type { Audit } from "@/src/lib/contracts";
import type { ViewContext } from "./MiniApps";

export type SafetyMetric = {
  threshold: number;
  smsCount: number;
  docCount: number;
  [key: string]: number;
};

type AuditStage = "flagged" | "ai" | "consent" | "verified";
type ScopeFilter = "recent" | "ai" | "all";
type HeatFilter = "all" | "ai" | "consent";

const STAGE_META: Record<
  AuditStage,
  {
    label: string;
    laneIndex: number;
    fill: string;
    soft: string;
    gradId: string;
  }
> = {
  flagged: {
    label: "Flagged",
    laneIndex: 0,
    fill: "#ff7854",
    soft: "#ff7854",
    gradId: "lg-audit-grad-flagged",
  },
  ai: {
    label: "AI Tool",
    laneIndex: 1,
    fill: "#a88bff",
    soft: "#a88bff",
    gradId: "lg-audit-grad-ai",
  },
  consent: {
    label: "Consent",
    laneIndex: 2,
    fill: "#64c4ff",
    soft: "#64c4ff",
    gradId: "lg-audit-grad-consent",
  },
  verified: {
    label: "Verified",
    laneIndex: 3,
    fill: "#9ca3af",
    soft: "#9ca3af",
    gradId: "lg-audit-grad-verified",
  },
};

const STAGE_ORDER: AuditStage[] = ["verified", "ai", "consent", "flagged"];
const LANE_LABELS: AuditStage[] = ["flagged", "ai", "consent", "verified"];

const ROLE_ROWS = [
  { key: "citizen", label: "Citizen" },
  { key: "helper", label: "Helper" },
  { key: "shopkeeper", label: "Shop" },
  { key: "officer", label: "Officer" },
  { key: "admin", label: "Admin" },
  { key: "auditor", label: "Auditor" },
  { key: "partner", label: "Partner" },
] as const;

const HEAT_FILLS = [
  "rgba(255, 255, 255, 0.08)",
  "rgba(134, 239, 172, 0.34)",
  "rgba(74, 222, 128, 0.58)",
  "rgba(34, 197, 94, 0.82)",
  "#16a34a",
] as const;

const SAFETY_ROWS: [string, string][] = [
  ["bad_approvals", "Bad automatic approvals"],
  ["genuine_reviewed", "Genuine cases below threshold"],
  ["officer_review_rate", "Officer review rate"],
  ["below_threshold_rate", "Cases below threshold"],
  ["scam_false_alarms", "Scam false alarms"],
  ["scam_misses", "Scam misses"],
  ["forgery_false_alarms", "Forgery false alarms"],
  ["forgery_misses", "Forgery misses"],
];

const formatLabel = (value: string) =>
  value.replaceAll("_", " ").replace(/^./, first => first.toUpperCase());

const pct = (value: number) => `${Math.round(value * 100)}%`;

const shortTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

export function classifyAuditStage(row: Audit): AuditStage {
  const outcome = row.outcome.toLowerCase();
  const ev = row.event_type.toLowerCase();
  if (
    ["denied", "blocked", "scam", "rejected", "failed", "suspect", "unreadable", "revoked"].includes(
      outcome,
    ) ||
    ["access_denied", "tool_blocked", "officer_reject", "mock_payment_failed"].includes(ev)
  ) {
    return "flagged";
  }
  if (
    ["consent_granted", "consent_revoked", "switch_family", "evidence_viewed"].includes(ev) ||
    row.entity_type === "consent"
  ) {
    return "consent";
  }
  if (
    row.confidence !== null ||
    [
      "policy_rag",
      "jev_route",
      "check",
      "agent_settled",
      "tool_call",
      "tool_result",
      "evidence_checked",
    ].includes(ev) ||
    (row.model_version && row.model_version !== "deterministic-v1")
  ) {
    return "ai";
  }
  return "verified";
}

function isConsentEvent(row: Audit): boolean {
  const ev = row.event_type.toLowerCase();
  return (
    ["consent_granted", "consent_revoked", "switch_family", "access_denied", "evidence_viewed"].includes(
      ev,
    ) || row.entity_type === "consent"
  );
}

function isAiEvent(row: Audit): boolean {
  return classifyAuditStage(row) === "ai" || row.confidence !== null;
}

type StageBlock = {
  index: number;
  stage: AuditStage;
  events: Audit[];
  startIso: string;
  endIso: string;
  weight: number;
};

function buildHypnogramBlocks(events: Audit[], maxBuckets: number): StageBlock[] {
  if (!events.length) return [];
  const chronological = [...events].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const bucketCount = Math.min(maxBuckets, chronological.length);
  const perBucket = chronological.length / bucketCount;
  const rawBuckets: { stage: AuditStage; events: Audit[] }[] = [];

  for (let i = 0; i < bucketCount; i++) {
    const start = Math.floor(i * perBucket);
    const end = Math.max(start + 1, Math.floor((i + 1) * perBucket));
    const slice = chronological.slice(start, end);
    if (!slice.length) continue;

    const counts: Record<AuditStage, number> = { flagged: 0, ai: 0, consent: 0, verified: 0 };
    for (const item of slice) counts[classifyAuditStage(item)]++;

    const priority: AuditStage[] = ["flagged", "consent", "ai", "verified"];
    let dominant: AuditStage = "verified";
    let best = -1;
    for (const stage of priority) {
      if (counts[stage] > best) {
        best = counts[stage];
        dominant = stage;
      }
    }
    rawBuckets.push({ stage: dominant, events: slice });
  }

  const merged: StageBlock[] = [];
  for (const bucket of rawBuckets) {
    const prev = merged[merged.length - 1];
    if (prev && prev.stage === bucket.stage) {
      prev.events.push(...bucket.events);
      prev.endIso = bucket.events[bucket.events.length - 1].created_at;
      prev.weight += 1;
    } else {
      merged.push({
        index: merged.length,
        stage: bucket.stage,
        events: [...bucket.events],
        startIso: bucket.events[0].created_at,
        endIso: bucket.events[bucket.events.length - 1].created_at,
        weight: 1,
      });
    }
  }
  return merged;
}

type HeatCell = {
  roleKey: string;
  roleLabel: string;
  col: number;
  count: number;
  level: 0 | 1 | 2 | 3 | 4;
  topEvent: string;
  windowLabel: string;
  isLatestActive: boolean;
};

export function AuditorGlassSuite({
  logs,
  safety,
  loading = false,
  compact = false,
  stageFilter = null,
  roleFilter = null,
  onSelectStage,
  onSelectRole,
  onOpenVault,
}: {
  logs: Audit[];
  safety: SafetyMetric[];
  loading?: boolean;
  compact?: boolean;
  stageFilter?: AuditStage | null;
  roleFilter?: string | null;
  onSelectStage?: (stage: AuditStage | null) => void;
  onSelectRole?: (role: string | null) => void;
  onOpenVault?: () => void;
}) {
  const [streamScope, setStreamScope] = useState<ScopeFilter>("all");
  const [heatFilter, setHeatFilter] = useState<HeatFilter>("all");
  const [selectedBlock, setSelectedBlock] = useState<number | null>(null);
  const [hoveredCell, setHoveredCell] = useState<HeatCell | null>(null);

  const scopedLogs = useMemo(() => {
    if (streamScope === "ai") return logs.filter(isAiEvent);
    if (streamScope === "recent") return logs.slice(0, 48);
    return logs;
  }, [logs, streamScope]);

  const stats = useMemo(() => {
    const total = scopedLogs.length;
    const stageCounts: Record<AuditStage, number> = {
      verified: 0,
      ai: 0,
      consent: 0,
      flagged: 0,
    };

    let consentGranted = 0;
    let consentRevoked = 0;
    let accessDenied = 0;
    let confSum = 0;
    let confCount = 0;
    let lowConfCount = 0;

    for (const row of scopedLogs) {
      stageCounts[classifyAuditStage(row)]++;
      if (row.event_type === "consent_granted" || row.outcome === "granted") consentGranted++;
      if (row.event_type === "consent_revoked" || row.outcome === "revoked") consentRevoked++;
      if (row.event_type === "access_denied" || row.event_type === "tool_blocked") accessDenied++;
      if (row.confidence !== null) {
        confSum += row.confidence;
        confCount++;
        if (row.confidence < 0.7) lowConfCount++;
      }
    }

    const avgConf = confCount > 0 ? confSum / confCount : null;
    const strictEval = safety.find(item => item.threshold === 0.9) ?? safety[0];
    const confidenceScore = avgConf !== null ? Math.round(avgConf * 100) : null;

    const latestRule = logs.find(item => item.rule_version !== null)?.rule_version ?? 1;
    const newestDate = scopedLogs[0]?.created_at
      ? new Date(scopedLogs[0].created_at).toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        })
      : "Live";

    return {
      total,
      stageCounts,
      consentGranted,
      consentRevoked,
      accessDenied,
      avgConf,
      confCount,
      lowConfCount,
      confidenceScore,
      strictEval,
      latestRule,
      newestDate,
    };
  }, [scopedLogs, safety, logs]);

  const hypnoBlocks = useMemo(() => buildHypnogramBlocks(scopedLogs, 20), [scopedLogs]);

  const heatmap = useMemo(() => {
    const COLS = 16;
    const source =
      heatFilter === "ai"
        ? logs.filter(isAiEvent)
        : heatFilter === "consent"
          ? logs.filter(isConsentEvent)
          : logs;

    const chronological = [...source].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    const roleTotals = new Map<string, number>();
    const modelTotals = new Map<string, number>();
    let aiScored = 0;
    let lowConf = 0;

    for (const row of source) {
      roleTotals.set(row.actor_role, (roleTotals.get(row.actor_role) ?? 0) + 1);
      if (row.model_version) {
        modelTotals.set(row.model_version, (modelTotals.get(row.model_version) ?? 0) + 1);
      }
      if (row.confidence !== null) {
        aiScored++;
        if (row.confidence < 0.7) lowConf++;
      }
    }

    const colBuckets: Audit[][] = Array.from({ length: COLS }, () => []);
    if (chronological.length > 0) {
      for (let i = 0; i < chronological.length; i++) {
        const col = Math.min(COLS - 1, Math.floor((i / chronological.length) * COLS));
        colBuckets[col].push(chronological[i]);
      }
    }

    const rawCounts: number[][] = ROLE_ROWS.map(() => Array.from({ length: COLS }, () => 0));
    const cellTopEvents: string[][] = ROLE_ROWS.map(() => Array.from({ length: COLS }, () => ""));
    let maxCount = 0;
    let latestRoleIdx = -1;
    let latestColIdx = -1;

    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROLE_ROWS.length; r++) {
        const roleKey = ROLE_ROWS[r].key;
        const hits = colBuckets[c].filter(ev => ev.actor_role === roleKey);
        rawCounts[r][c] = hits.length;
        if (hits.length > maxCount) maxCount = hits.length;
        if (hits.length > 0) {
          const evFreq = new Map<string, number>();
          for (const h of hits) evFreq.set(h.event_type, (evFreq.get(h.event_type) ?? 0) + 1);
          const topEv = [...evFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
          cellTopEvents[r][c] = topEv;
          if (c >= latestColIdx) {
            latestColIdx = c;
            latestRoleIdx = r;
          }
        }
      }
    }

    const colHeaders: { col: number; label: string }[] = [];
    for (const c of [0, 5, 10, 15]) {
      const first = colBuckets[c][0];
      if (first) colHeaders.push({ col: c, label: shortTime(first.created_at) });
    }

    const cells: HeatCell[] = [];
    for (let r = 0; r < ROLE_ROWS.length; r++) {
      for (let c = 0; c < COLS; c++) {
        const count = rawCounts[r][c];
        const ratio = maxCount > 0 ? count / maxCount : 0;
        const level: 0 | 1 | 2 | 3 | 4 =
          count === 0 ? 0 : ratio <= 0.25 ? 1 : ratio <= 0.5 ? 2 : ratio <= 0.78 ? 3 : 4;
        const bucketStart = colBuckets[c][0]?.created_at;
        cells.push({
          roleKey: ROLE_ROWS[r].key,
          roleLabel: ROLE_ROWS[r].label,
          col: c,
          count,
          level,
          topEvent: cellTopEvents[r][c],
          windowLabel: bucketStart ? shortTime(bucketStart) : `W${c + 1}`,
          isLatestActive: r === latestRoleIdx && c === latestColIdx && count > 0,
        });
      }
    }

    const topRoleEntry = [...roleTotals.entries()].sort((a, b) => b[1] - a[1])[0];
    const topModelEntry = [...modelTotals.entries()].sort((a, b) => b[1] - a[1])[0];

    return {
      cols: COLS,
      cells,
      colHeaders,
      totalEvents: source.length,
      aiScored,
      lowConf,
      topRole: topRoleEntry ? formatLabel(topRoleEntry[0]) : "—",
      topModel: topModelEntry ? topModelEntry[0] : "—",
      modelsCount: modelTotals.size,
      rulesCount: new Set(source.map(s => s.rule_version).filter(Boolean)).size,
    };
  }, [logs, heatFilter]);

  const HYPNO_W = 680;
  const HYPNO_H = compact ? 124 : 168;
  const PAD_LEFT = 56;
  const PAD_RIGHT = 6;
  const PAD_TOP = 6;
  const CHART_BOTTOM = compact ? 102 : 140;
  const LANE_H = compact ? 23.5 : 32;
  const PILL_H = compact ? 18 : 24;
  const CHART_W = HYPNO_W - PAD_LEFT - PAD_RIGHT;
  const totalWeight = hypnoBlocks.reduce((acc, b) => acc + b.weight, 0) || 1;
  const activeBlock = selectedBlock !== null ? hypnoBlocks[selectedBlock] ?? null : null;

  const timeTicks = useMemo(() => {
    if (!hypnoBlocks.length) return [];
    const indices =
      hypnoBlocks.length <= 4
        ? hypnoBlocks.map((_, i) => i)
        : [
            0,
            Math.floor(hypnoBlocks.length * 0.33),
            Math.floor(hypnoBlocks.length * 0.66),
            hypnoBlocks.length - 1,
          ];
    return [...new Set(indices)].map(idx => {
      const priorWeight = hypnoBlocks.slice(0, idx).reduce((s, b) => s + b.weight, 0);
      const x = PAD_LEFT + (priorWeight / totalWeight) * CHART_W;
      return { x, label: shortTime(hypnoBlocks[idx].startIso), key: `${idx}-${hypnoBlocks[idx].startIso}` };
    });
  }, [hypnoBlocks, totalWeight, CHART_W]);

  const HEAT_W = 540;
  const HEAT_H = compact ? 156 : 198;
  const HEAT_LEFT = 52;
  const HEAT_TOP = 18;
  const COL_STEP = (HEAT_W - HEAT_LEFT - 6) / heatmap.cols;
  const ROW_STEP = (HEAT_H - HEAT_TOP - 6) / ROLE_ROWS.length;
  const DOT_R = Math.min(compact ? 8.2 : 10.5, Math.min(COL_STEP, ROW_STEP) * 0.4);

  return (
    <div className={"audit-glass-suite" + (compact ? " is-compact" : "")}>
      {/* CARD 1: Liquid Glass Sleep-Score / Hypnogram Style */}
      <section className="audit-glass-card">
        <div className="audit-glass-head">
          <div className="audit-glass-title-group">
            <span className="audit-glass-dot violet" />
            <span className="audit-glass-kicker">Audit stream</span>
            <strong className="audit-glass-title">
              {stats.newestDate} · Rule v{stats.latestRule}
            </strong>
          </div>

          <div className="audit-glass-controls">
            <div className="audit-glass-seg" role="tablist" aria-label="Audit stream scope">
              {(
                [
                  ["all", "All"],
                  ["recent", "Recent"],
                  ["ai", "AI"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={streamScope === key}
                  className={"audit-glass-seg-btn" + (streamScope === key ? " active" : "")}
                  onClick={() => {
                    setStreamScope(key);
                    setSelectedBlock(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            {onOpenVault && (
              <button
                type="button"
                className="audit-glass-open-btn"
                onClick={onOpenVault}
                title="Open full Audit Vault"
              >
                Vault <ArrowUpRight size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Hero score + 3 KPI columns */}
        <div className="audit-score-row">
          <div className="audit-hero-score">
            <span className="audit-metric-label">AI confidence</span>
            <div className="audit-score-num-wrap">
              <strong className="audit-score-num">
                {loading && !logs.length ? "—" : (stats.confidenceScore ?? "—")}
              </strong>
              <span className="audit-score-denom">/100</span>
            </div>
          </div>

          <div className="audit-score-divider" aria-hidden="true" />

          <div className="audit-kpi-triplet">
            <div className="audit-kpi">
              <span className="audit-metric-label">AI decisions</span>
              <div className="audit-kpi-val-row">
                <strong>{stats.confCount}</strong>
                <span className="audit-kpi-delta green">
                  {stats.lowConfCount} &lt;70%
                </span>
              </div>
            </div>

            <div className="audit-kpi">
              <span className="audit-metric-label">Consent &amp; access</span>
              <div className="audit-kpi-val-row">
                <strong>{stats.consentGranted} granted</strong>
                <span className="audit-kpi-delta muted">
                  {stats.consentRevoked} rev · {stats.accessDenied} blk
                </span>
              </div>
            </div>

            <div className="audit-kpi">
              <span className="audit-metric-label">Officer review</span>
              <div className="audit-kpi-val-row">
                <strong>{stats.strictEval ? pct(stats.strictEval.officer_review_rate) : "100%"}</strong>
                <span className="audit-kpi-delta green">
                  {stats.strictEval?.bad_approvals ?? 0} bad auto
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* 4-lane Hypnogram SVG */}
        <div className="audit-hypno-wrap">
          {hypnoBlocks.length > 0 ? (
            <svg
              viewBox={`0 0 ${HYPNO_W} ${HYPNO_H}`}
              className="audit-svg"
              role="img"
              aria-label="Chronological audit stage timeline"
            >
              <defs>
                {LANE_LABELS.map(stage => {
                  const meta = STAGE_META[stage];
                  return (
                    <linearGradient
                      key={meta.gradId}
                      id={meta.gradId + (compact ? "-c" : "")}
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor={meta.fill} stopOpacity={0.34} />
                      <stop offset="100%" stopColor={meta.soft} stopOpacity={0.03} />
                    </linearGradient>
                  );
                })}
              </defs>

              {LANE_LABELS.map(stage => {
                const meta = STAGE_META[stage];
                const y = PAD_TOP + meta.laneIndex * LANE_H + PILL_H * 0.65;
                return (
                  <text key={stage} x={0} y={y} fontSize={11.5} fill="rgba(255, 255, 255, 0.56)">
                    {meta.label}
                  </text>
                );
              })}

              <line
                x1={PAD_LEFT}
                y1={CHART_BOTTOM}
                x2={HYPNO_W - PAD_RIGHT}
                y2={CHART_BOTTOM}
                stroke="rgba(255, 255, 255, 0.14)"
                strokeWidth={1}
              />

              {(() => {
                let cursor = 0;
                return hypnoBlocks.map(block => {
                  const meta = STAGE_META[block.stage];
                  const x = PAD_LEFT + (cursor / totalWeight) * CHART_W;
                  const rawW = (block.weight / totalWeight) * CHART_W;
                  cursor += block.weight;
                  const gap = Math.min(3.5, rawW * 0.12);
                  const w = Math.max(8, rawW - gap);
                  const pillY = PAD_TOP + meta.laneIndex * LANE_H;
                  const colH = Math.max(0, CHART_BOTTOM - (pillY + PILL_H * 0.5));
                  const isPicked = selectedBlock === block.index;

                  return (
                    <g
                      key={block.index}
                      className="audit-svg-interactive"
                      onClick={() =>
                        setSelectedBlock(prev => (prev === block.index ? null : block.index))
                      }
                    >
                      <title>
                        {`${meta.label} · ${block.events.length} event(s) (${shortTime(block.startIso)}–${shortTime(block.endIso)})`}
                      </title>
                      <rect
                        x={x}
                        y={pillY + PILL_H * 0.5}
                        width={w}
                        height={colH}
                        fill={`url(#${meta.gradId}${compact ? "-c" : ""})`}
                      />
                      <rect
                        x={x}
                        y={pillY}
                        width={w}
                        height={PILL_H}
                        rx={7}
                        fill={meta.fill}
                        stroke={isPicked ? "#ffffff" : "rgba(255, 255, 255, 0.2)"}
                        strokeWidth={isPicked ? 2 : 0.75}
                      />
                    </g>
                  );
                });
              })()}

              {timeTicks.map(tick => (
                <text
                  key={tick.key}
                  x={Math.min(HYPNO_W - PAD_RIGHT - 32, tick.x)}
                  y={HYPNO_H - 6}
                  fontSize={11}
                  fontFamily="Geist Mono, ui-monospace, monospace"
                  fill="rgba(255, 255, 255, 0.48)"
                >
                  {tick.label}
                </text>
              ))}
            </svg>
          ) : (
            <p className="audit-glass-empty">
              {loading ? "Loading audit stream…" : "No audit events in this view yet."}
            </p>
          )}
        </div>

        {activeBlock && (
          <div className="audit-glass-callout">
            <span className="audit-glass-callout-text">
              <strong>{STAGE_META[activeBlock.stage].label}</strong> · {activeBlock.events.length} event(s) ·{" "}
              {shortTime(activeBlock.startIso)}–{shortTime(activeBlock.endIso)} ·{" "}
              {[...new Set(activeBlock.events.map(e => formatLabel(e.event_type)))].slice(0, 3).join(", ")}
            </span>
            {onSelectStage && (
              <button
                type="button"
                className="audit-glass-mini-btn"
                onClick={() => onSelectStage(activeBlock.stage)}
              >
                Filter log
              </button>
            )}
          </div>
        )}

        {/* Horizontal segmented proportion bar */}
        {stats.total > 0 && (
          <div className="audit-prop-bar" role="img" aria-label="Audit stage proportions">
            {STAGE_ORDER.map(stage => {
              const count = stats.stageCounts[stage];
              if (!count) return null;
              return (
                <span
                  key={stage}
                  className="audit-prop-seg"
                  style={{
                    flexGrow: count,
                    background: STAGE_META[stage].fill,
                  }}
                />
              );
            })}
          </div>
        )}

        {/* 4-column stage breakdown footer */}
        <div className="audit-stage-legend">
          {STAGE_ORDER.map(stage => {
            const meta = STAGE_META[stage];
            const count = stats.stageCounts[stage];
            const share = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0;
            const active = stageFilter === stage;
            return (
              <button
                key={stage}
                type="button"
                className={"audit-stage-item" + (active ? " active" : "")}
                onClick={() => {
                  if (onSelectStage) onSelectStage(active ? null : stage);
                  else if (onOpenVault) onOpenVault();
                }}
              >
                <span className="audit-stage-label">
                  <i style={{ background: meta.fill }} />
                  {meta.label}
                </span>
                <span className="audit-stage-vals">
                  <strong>{count}</strong>
                  <small>{share}%</small>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* CARD 2: Liquid Glass Workout-Consistency / Circular Dot Heatmap Style */}
      <section className="audit-glass-card">
        <div className="audit-glass-head">
          <div className="audit-glass-title-group">
            <span className="audit-glass-dot green" />
            <strong className="audit-glass-title">Audit activity</strong>
            <span className="audit-glass-kicker">
              {heatmap.modelsCount} models · {heatmap.rulesCount} rules
            </span>
          </div>

          <div className="audit-glass-seg" role="tablist" aria-label="Role heatmap filter">
            {(
              [
                ["all", "All"],
                ["ai", "AI"],
                ["consent", "Consent"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={heatFilter === key}
                className={"audit-glass-seg-btn" + (heatFilter === key ? " active" : "")}
                onClick={() => setHeatFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="audit-heat-legend" aria-hidden="true">
            <span>Less</span>
            {HEAT_FILLS.map((fill, idx) => (
              <i key={idx} style={{ background: fill }} />
            ))}
            <span>More</span>
          </div>
        </div>

        <div className="audit-heat-body">
          <div className="audit-heat-grid-wrap">
            <svg
              viewBox={`0 0 ${HEAT_W} ${HEAT_H}`}
              className="audit-svg"
              role="img"
              aria-label="Actor role activity heatmap across audit windows"
            >
              {heatmap.colHeaders.map(header => (
                <text
                  key={header.col}
                  x={HEAT_LEFT + header.col * COL_STEP + COL_STEP * 0.5}
                  y={14}
                  textAnchor="middle"
                  fontSize={10.5}
                  fontFamily="Geist Mono, ui-monospace, monospace"
                  fill="rgba(255, 255, 255, 0.48)"
                >
                  {header.label}
                </text>
              ))}

              {ROLE_ROWS.map((role, r) => (
                <text
                  key={role.key}
                  x={0}
                  y={HEAT_TOP + r * ROW_STEP + ROW_STEP * 0.5 + 4}
                  fontSize={11}
                  fontWeight={roleFilter === role.key ? 700 : 500}
                  fill={
                    roleFilter === role.key ? "#ffffff" : "rgba(255, 255, 255, 0.56)"
                  }
                  className="audit-svg-interactive"
                  onClick={() => {
                    if (onSelectRole) onSelectRole(roleFilter === role.key ? null : role.key);
                    else if (onOpenVault) onOpenVault();
                  }}
                >
                  {role.label}
                </text>
              ))}

              {heatmap.cells.map(cell => {
                const rowIdx = ROLE_ROWS.findIndex(r => r.key === cell.roleKey);
                const cx = HEAT_LEFT + cell.col * COL_STEP + COL_STEP * 0.5;
                const cy = HEAT_TOP + rowIdx * ROW_STEP + ROW_STEP * 0.5;
                const isRoleActive = roleFilter === cell.roleKey;
                const isDimmed = roleFilter !== null && !isRoleActive;
                const isTrailingEmpty =
                  !cell.isLatestActive && cell.count === 0 && cell.col === heatmap.cols - 1;

                return (
                  <circle
                    key={`${cell.roleKey}-${cell.col}`}
                    cx={cx}
                    cy={cy}
                    r={DOT_R}
                    fill={isTrailingEmpty ? "transparent" : HEAT_FILLS[cell.level]}
                    opacity={isDimmed ? 0.28 : 1}
                    stroke={
                      cell.isLatestActive
                        ? "#ffffff"
                        : isTrailingEmpty
                          ? "rgba(255, 255, 255, 0.24)"
                          : "none"
                    }
                    strokeWidth={cell.isLatestActive ? 2 : 1}
                    strokeDasharray={isTrailingEmpty ? "2.5 2.5" : undefined}
                    className="audit-svg-interactive"
                    onMouseEnter={() => setHoveredCell(cell)}
                    onMouseLeave={() => setHoveredCell(null)}
                    onClick={() => {
                      if (onSelectRole) onSelectRole(roleFilter === cell.roleKey ? null : cell.roleKey);
                      else if (onOpenVault) onOpenVault();
                    }}
                  >
                    <title>
                      {`${cell.roleLabel} · ${cell.windowLabel} · ${cell.count} event(s)${cell.topEvent ? " (" + formatLabel(cell.topEvent) + ")" : ""}`}
                    </title>
                  </circle>
                );
              })}
            </svg>

            {(!compact || hoveredCell) && (
              <p className="audit-heat-caption">
                {hoveredCell
                  ? `${hoveredCell.roleLabel} · ${hoveredCell.windowLabel} · ${hoveredCell.count} event(s)${hoveredCell.topEvent ? " · Top: " + formatLabel(hoveredCell.topEvent) : ""}`
                  : "Click a role row or dot to filter the audit trail."}
              </p>
            )}
          </div>

          <div className="audit-heat-divider" aria-hidden="true" />

          <div className="audit-heat-summary">
            <div className="audit-heat-stat">
              <span className="audit-metric-label">Logged events</span>
              <div className="audit-heat-big-row">
                <strong>{loading && !logs.length ? "—" : heatmap.totalEvents}</strong>
                <span>events</span>
              </div>
            </div>

            <div className="audit-heat-stat">
              <span className="audit-metric-label">AI decisions</span>
              <div className="audit-heat-mid-row">
                <strong>{heatmap.aiScored}</strong>
                <span>
                  scored{heatmap.lowConf > 0 ? ` · ${heatmap.lowConf} low` : ""}
                </span>
              </div>
            </div>

            <div className="audit-heat-stat">
              <span className="audit-metric-label">Most active</span>
              <strong className="audit-heat-role">{heatmap.topRole}</strong>
              <small className="audit-heat-model">{heatmap.topModel}</small>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

type VaultCategory = "all" | "claims" | "ai" | "consent" | "blocked";

const shortId = (id: string) => (id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);

function matchesVaultCategory(row: Audit, category: VaultCategory): boolean {
  if (category === "all") return true;
  const ev = row.event_type.toLowerCase();
  if (category === "claims") {
    return (
      row.entity_type === "claim" ||
      row.entity_type === "claim_document" ||
      [
        "draft",
        "draft_saved",
        "submit",
        "submit_claim",
        "evidence_checked",
        "tamper_detected",
        "officer_approve",
        "officer_reject",
        "mock_payment_paid",
        "mock_payment_failed",
        "report",
      ].includes(ev)
    );
  }
  if (category === "ai") return isAiEvent(row);
  if (category === "consent") return isConsentEvent(row);
  return ev === "access_denied" || ev === "tool_blocked" || classifyAuditStage(row) === "flagged";
}

export function AuditVaultView({
  ctx,
  logs,
  safety,
}: {
  ctx: ViewContext;
  logs: { data: Audit[] | null; error: string; loading: boolean };
  safety: { data: SafetyMetric[] | null; error: string; loading: boolean };
}) {
  const [tab, setTab] = useState<"events" | "eval">("events");
  const [category, setCategory] = useState<VaultCategory>("all");
  const [filterText, setFilterText] = useState("");
  const [selection, setSelection] = useState<Audit | null>(null);

  const refreshRef = useRef(ctx.refresh);
  refreshRef.current = ctx.refresh;

  // Live refresh every 10s while online so new claims/events appear automatically
  useEffect(() => {
    if (ctx.offline) return;
    const timer = window.setInterval(() => {
      refreshRef.current();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [ctx.offline]);

  const allLogs = useMemo(() => logs.data ?? [], [logs.data]);
  const safetyList = useMemo(() => safety.data ?? [], [safety.data]);

  const categoryCounts = useMemo(
    () => ({
      all: allLogs.length,
      claims: allLogs.filter(r => matchesVaultCategory(r, "claims")).length,
      ai: allLogs.filter(r => matchesVaultCategory(r, "ai")).length,
      consent: allLogs.filter(r => matchesVaultCategory(r, "consent")).length,
      blocked: allLogs.filter(r => matchesVaultCategory(r, "blocked")).length,
    }),
    [allLogs],
  );

  const modelCoverage = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of allLogs) {
      if (row.model_version) map.set(row.model_version, (map.get(row.model_version) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [allLogs]);

  const filteredRows = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    return allLogs.filter(row => {
      if (!matchesVaultCategory(row, category)) return false;
      if (!q) return true;
      return [
        row.actor_role,
        row.event_type,
        row.outcome,
        row.entity_type,
        row.entity_id ?? "",
        row.model_version,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [allLogs, filterText, category]);

  return (
    <div className="audit-vault-shell">
      {(logs.error || safety.error) && (
        <div className="notice warning" role="alert">
          {logs.error || safety.error}
        </div>
      )}

      {/* Tabs + Model coverage pills + Live refresh */}
      <div className="audit-vault-bar">
        <div className="tabs">
          <button
            type="button"
            aria-pressed={tab === "events"}
            onClick={() => setTab("events")}
          >
            Audit events
          </button>
          <button
            type="button"
            aria-pressed={tab === "eval"}
            onClick={() => setTab("eval")}
          >
            Decision Safety Eval
          </button>
        </div>

        <div className="audit-model-chips">
          {modelCoverage.map(([model, count]) => (
            <span key={model} className="audit-model-chip">
              {model} · {count}
            </span>
          ))}
          <button
            type="button"
            className="secondary"
            disabled={ctx.offline || logs.loading}
            onClick={() => ctx.refresh()}
            title="Refresh audit log"
          >
            <RefreshCw size={14} className={logs.loading ? "spin" : ""} /> Refresh
          </button>
        </div>
      </div>

      {tab === "events" ? (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Append-only audit trail</h2>
              <p>
                Latest read-only events across claims, consent changes, and AI decisions ({filteredRows.length} shown · auto-refreshes every 10s).
              </p>
            </div>
            <LockKeyhole size={20} />
          </div>

          <div className="audit-search-row">
            <span className="kanban-search">
              <Search size={15} />
              <input
                type="search"
                value={filterText}
                onChange={event => setFilterText(event.target.value)}
                placeholder="Search claim ID, role, event, outcome, or model"
                aria-label="Filter events"
              />
            </span>

            <div className="audit-active-filters" role="group" aria-label="Filter by event category">
              {(
                [
                  ["all", "All"],
                  ["claims", "Claims"],
                  ["ai", "AI"],
                  ["consent", "Consent"],
                  ["blocked", "Flagged"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={"audit-filter-pill" + (category === key ? " is-active" : "")}
                  aria-pressed={category === key}
                  onClick={() => setCategory(key)}
                >
                  {label} · {categoryCounts[key]}
                </button>
              ))}
            </div>
          </div>

          {logs.loading && !logs.data ? (
            <p className="empty">Loading audit events…</p>
          ) : filteredRows.length === 0 ? (
            <p className="empty">
              {ctx.offline
                ? "Reconnect to load the read-only audit vault."
                : "No events match your current filter."}
            </p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Event · Entity</th>
                    <th>Actor</th>
                    <th>Outcome</th>
                    <th>Rule · Model</th>
                    <th>Conf.</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(row => {
                    const st = classifyAuditStage(row);
                    const tone =
                      st === "flagged" ? "amber" : st === "verified" ? "green" : "neutral";
                    return (
                      <tr key={row.id}>
                        <td>
                          <button
                            type="button"
                            className="text-link"
                            onClick={() => setSelection(row)}
                          >
                            {formatLabel(row.event_type)}
                          </button>
                          {row.entity_id && (
                            <small className="muted" style={{ display: "block", fontSize: "0.72rem" }}>
                              {row.entity_type} · {shortId(row.entity_id)}
                            </small>
                          )}
                        </td>
                        <td>{formatLabel(row.actor_role)}</td>
                        <td>
                          <span className={"pill " + tone}>{formatLabel(row.outcome)}</span>
                        </td>
                        <td>
                          {row.rule_version ? `v${row.rule_version} · ` : ""}
                          {row.model_version}
                        </td>
                        <td>{row.confidence !== null ? pct(row.confidence) : "—"}</td>
                        <td>{new Date(row.created_at).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {selection && (
            <details className="citation" open>
              <summary>
                Event {selection.id} · {formatLabel(selection.event_type)}
              </summary>
              <p className="breakable">
                {selection.entity_type} {selection.entity_id}
                {selection.confidence !== null ? " · " + pct(selection.confidence) : ""}
              </p>
              <pre>{JSON.stringify(selection.metadata_json, null, 2)}</pre>
            </details>
          )}
        </section>
      ) : (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Threshold comparison</h2>
              <p>
                Synthetic evaluation of {safetyList[0]?.smsCount ?? 0} messages and{" "}
                {safetyList[0]?.docCount ?? 0} document cases.
              </p>
            </div>
            <ShieldCheck size={20} />
          </div>

          {safety.loading && !safety.data ? (
            <p className="empty">Running safety evaluation…</p>
          ) : (
            <>
              <div className="audit-eval-cards">
                {safetyList.map(row => (
                  <div key={row.threshold} className="audit-eval-card">
                    <div className="audit-eval-card-head">
                      <strong>
                        {row.threshold === 0.9 ? "Strict threshold" : "Relaxed threshold"}
                      </strong>
                      <span className={"pill " + (row.threshold === 0.9 ? "neutral" : "amber")}>
                        {row.threshold.toFixed(2)}
                      </span>
                    </div>
                    <div className="audit-eval-card-stats">
                      <div>
                        <small>Bad auto</small>
                        <strong>{row.bad_approvals}</strong>
                      </div>
                      <div>
                        <small>Below threshold</small>
                        <strong>{pct(row.below_threshold_rate)}</strong>
                      </div>
                      <div>
                        <small>Misses (SMS/Doc)</small>
                        <strong>
                          {row.scam_misses} / {row.forgery_misses}
                        </strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Outcome</th>
                      {safetyList.map(row => (
                        <th key={row.threshold}>
                          {row.threshold === 0.9 ? "Strict" : "Relaxed"} · {row.threshold.toFixed(2)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SAFETY_ROWS.map(([key, label]) => (
                      <tr key={key}>
                        <td>{label}</td>
                        {safetyList.map(row => (
                          <td key={row.threshold}>
                            {key.endsWith("_rate") ? pct(row[key] ?? 0) : row[key]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
