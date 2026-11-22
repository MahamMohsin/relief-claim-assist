"use client";

import { useMemo, useState } from "react";
import type { Claim } from "@/src/lib/contracts";

type MapHotspot = {
  key: string;
  label: string;
  region: string;
  x: number;
  y: number;
};

const SEEDED_AREAS = ["Darya Colony", "Mehrabad", "Nawab Kot", "Safa Village"] as const;

const KNOWN_HOTSPOTS: Record<string, MapHotspot> = {
  "darya colony": { key: "darya colony", label: "Darya Colony", region: "Lower Sindh", x: 74, y: 158 },
  "nawab kot": { key: "nawab kot", label: "Nawab Kot", region: "Interior Sindh", x: 92, y: 132 },
  "mehrabad": { key: "mehrabad", label: "Mehrabad", region: "South Punjab", x: 118, y: 98 },
  "safa village": { key: "safa village", label: "Safa Village", region: "KP / North", x: 116, y: 48 },
  "karachi": { key: "karachi", label: "Karachi", region: "Sindh", x: 66, y: 164 },
  "lahore": { key: "lahore", label: "Lahore", region: "Punjab", x: 146, y: 78 },
  "multan": { key: "multan", label: "Multan", region: "South Punjab", x: 114, y: 104 },
  "peshawar": { key: "peshawar", label: "Peshawar", region: "KP", x: 108, y: 50 },
  "quetta": { key: "quetta", label: "Quetta", region: "Balochistan", x: 56, y: 110 },
  "islamabad": { key: "islamabad", label: "Islamabad", region: "ICT / North", x: 130, y: 54 },
  "sukkur": { key: "sukkur", label: "Sukkur", region: "Upper Sindh", x: 94, y: 124 },
};

function resolveClaimArea(claim: Claim): MapHotspot {
  const noteText = (claim.payload_json?.notes ?? "").toLowerCase();
  for (const [k, spot] of Object.entries(KNOWN_HOTSPOTS)) {
    if (noteText.includes(k)) return spot;
  }

  // Deterministic mapping for seeded synthetic citizens (matches supabase/seed.sql line 47)
  const seededMatch = /^10000000-0000-4000-a000-0*(\d+)$/i.exec(claim.citizen_id ?? "");
  if (seededMatch) {
    const idx = Number(seededMatch[1]);
    // Fatima Bibi's synthetic CNIC updates her to Darya Colony; others match seed.sql (i % 4)
    const areaName = idx === 1 ? "Darya Colony" : SEEDED_AREAS[idx % 4];
    return KNOWN_HOTSPOTS[areaName.toLowerCase()];
  }

  // Fallback hash across the 4 primary relief zones
  const hash = (claim.citizen_id || claim.id).split("").reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return KNOWN_HOTSPOTS[SEEDED_AREAS[hash % SEEDED_AREAS.length].toLowerCase()];
}

export function PakistanClaimsMapCard({
  queue,
  onOpenReview,
}: {
  queue: Claim[];
  onOpenReview: () => void;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const hotspots = useMemo(() => {
    const counts = new Map<string, { spot: MapHotspot; total: number; pending: number }>();
    // Always seed the 4 core demo regions so the map never looks empty
    for (const name of SEEDED_AREAS) {
      const spot = KNOWN_HOTSPOTS[name.toLowerCase()];
      counts.set(spot.key, { spot, total: 0, pending: 0 });
    }
    for (const c of queue) {
      const spot = resolveClaimArea(c);
      const entry = counts.get(spot.key) ?? { spot, total: 0, pending: 0 };
      entry.total++;
      if (["submitted", "in_review", "needs_proof"].includes(c.status)) entry.pending++;
      counts.set(spot.key, entry);
    }
    const ranked = [...counts.values()].sort((a, b) => b.total - a.total);
    const maxCount = Math.max(1, ranked[0]?.total ?? 1);
    const totalClaims = Math.max(1, queue.length);
    return { ranked, maxCount, totalClaims };
  }, [queue]);

  const active =
    (selectedKey ? hotspots.ranked.find(h => h.spot.key === selectedKey) : null) ??
    hotspots.ranked[0];

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
          <span className="audit-glass-dot green" />
          <span className="audit-glass-kicker">Claims map</span>
          <strong className="audit-glass-title">Pakistan</strong>
        </div>
        {active && (
          <span className="officer-meta-chip">
            Top: {active.spot.label}
          </span>
        )}
      </header>

      <div className="pk-map-layout">
        {/* Stylized Dark Liquid Glass Silhouette of Pakistan */}
        <svg viewBox="0 0 185 190" className="pk-map-svg" role="img" aria-label="Pakistan relief claims hotspot map">
          <defs>
            <linearGradient id="pk-land-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(52, 211, 153, 0.22)" />
              <stop offset="100%" stopColor="rgba(59, 130, 246, 0.14)" />
            </linearGradient>
          </defs>

          {/* Stylized Pakistan border polygon */}
          <path
            d="M112,14 L132,10 L152,22 L164,38 L150,52 L162,68 L156,88 L138,104 L126,122 L114,138 L104,162 L84,174 L64,168 L44,158 L20,152 L14,132 L26,112 L42,96 L64,86 L78,72 L86,52 L98,34 Z"
            fill="url(#pk-land-grad)"
            stroke="rgba(255, 255, 255, 0.28)"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />

          {/* Subtle Indus river line */}
          <path
            d="M132,26 Q116,66 106,100 T74,164"
            fill="none"
            stroke="rgba(100, 196, 255, 0.26)"
            strokeWidth="1.2"
            strokeDasharray="3 3"
          />

          {/* Hotspot pins */}
          {hotspots.ranked.map((item, idx) => {
            const isTop = idx === 0 && item.total > 0;
            const isPicked = active?.spot.key === item.spot.key;
            const ratio = item.total / hotspots.maxCount;
            const dotR = item.total > 0 ? 4 + ratio * 5 : 3;
            const haloR = dotR + 5;
            const color = isTop ? "#ff7854" : "#34d399";

            return (
              <g
                key={item.spot.key}
                className="audit-svg-interactive"
                onMouseEnter={() => setSelectedKey(item.spot.key)}
                onClick={e => {
                  e.stopPropagation();
                  setSelectedKey(item.spot.key);
                }}
              >
                <title>{`${item.spot.label} (${item.spot.region}): ${item.total} claims (${item.pending} pending)`}</title>
                {item.total > 0 && (
                  <circle cx={item.spot.x} cy={item.spot.y} r={haloR} fill={color} fillOpacity={isPicked ? 0.36 : 0.2} />
                )}
                <circle
                  cx={item.spot.x}
                  cy={item.spot.y}
                  r={dotR}
                  fill={item.total > 0 ? color : "rgba(255,255,255,0.28)"}
                  stroke={isPicked ? "#ffffff" : "rgba(255,255,255,0.5)"}
                  strokeWidth={isPicked ? 1.8 : 0.9}
                />
              </g>
            );
          })}
        </svg>

        {/* Compact Regional Breakdown */}
        <div className="pk-map-legend">
          {hotspots.ranked.slice(0, 4).map((item, idx) => {
            const isTop = idx === 0 && item.total > 0;
            const isPicked = active?.spot.key === item.spot.key;
            const share = queue.length > 0 ? Math.round((item.total / hotspots.totalClaims) * 100) : 0;
            return (
              <button
                key={item.spot.key}
                type="button"
                className={"pk-map-row" + (isPicked ? " is-active" : "")}
                onMouseEnter={() => setSelectedKey(item.spot.key)}
                onClick={e => {
                  e.stopPropagation();
                  setSelectedKey(item.spot.key);
                }}
              >
                <span className="pk-map-name">
                  <i style={{ background: isTop ? "#ff7854" : "#34d399" }} />
                  {item.spot.label}
                </span>
                <strong>{item.total}</strong>
                <small>{share}%</small>
              </button>
            );
          })}
        </div>
      </div>
    </article>
  );
}
