"use client";

import { useMemo, useState } from "react";
import type { Claim } from "@/src/lib/contracts";

type MapHotspot = {
  key: string;
  label: string;
  region: string;
  lat: number;
  lon: number;
};

// Equirectangular projection tuned to Pakistan's real lat/lon bounds (60.8°E–77.9°E, 23.5°N–37.3°N)
const project = (lat: number, lon: number): [number, number] => {
  const x = 10 + ((lon - 60.8) / 17.2) * 200;
  const y = 198 - ((lat - 23.5) / 13.9) * 186;
  return [Number(x.toFixed(1)), Number(y.toFixed(1))];
};

// Geographically projected Pakistan national outline (clockwise from Makran/Iran border)
const PAKISTAN_BORDER_COORDS: [number, number][] = [
  // Southwest Balochistan (Iran border north to tri-point)
  [25.15, 61.6], [25.8, 61.85], [26.8, 63.2], [27.35, 62.8], [28.3, 62.0], [29.4, 61.1], [29.85, 60.9],
  // North Balochistan (Afghanistan border east to Chaman & Zhob)
  [29.55, 62.6], [29.45, 64.2], [29.6, 65.8], [30.2, 66.3], [30.9, 66.5], [31.2, 67.6], [31.9, 69.3],
  // Waziristan, Kurram, Khyber, Mohmand, Bajaur, Chitral
  [32.4, 69.3], [33.0, 69.6], [33.9, 69.9], [34.1, 71.1], [34.8, 71.2], [35.4, 71.4], [36.1, 71.3],
  [36.85, 72.1], [36.9, 72.9], [36.75, 73.7], [37.05, 74.7],
  // Gilgit-Baltistan / Karakoram / Khunjerab / Siachen / AJK
  [36.85, 75.5], [36.2, 76.2], [35.6, 77.2], [35.1, 77.6], [34.5, 76.7], [34.2, 75.3],
  [33.8, 74.1], [33.1, 74.2], [32.6, 74.5],
  // Punjab eastern border (Sialkot -> Lahore -> Kasur -> Bahawalnagar -> Rahim Yar Khan)
  [32.1, 75.2], [31.6, 74.6], [31.0, 74.5], [30.1, 73.9], [29.3, 73.2], [28.3, 72.0], [27.7, 70.8],
  // Sindh eastern border (Umerkot -> Tharparkar -> Sir Creek)
  [26.9, 69.9], [26.0, 70.3], [24.8, 70.9], [24.25, 70.9], [24.1, 69.5], [23.75, 68.2],
  // Indus Delta -> Karachi -> Lasbela -> Ormara -> Pasni -> Gwadar -> Jiwani
  [24.2, 67.4], [24.85, 66.95], [25.2, 66.6], [25.4, 65.8], [25.25, 64.6], [25.2, 63.4], [25.12, 62.3],
];

const toSvgPath = (coords: [number, number][], close = false) =>
  coords
    .map(([lat, lon], idx) => {
      const [x, y] = project(lat, lon);
      return `${idx === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ") + (close ? " Z" : "");

const PAKISTAN_PATH = toSvgPath(PAKISTAN_BORDER_COORDS, true);

// Subtle internal province dividers for instant geographic recognition
const PROVINCE_LINES: string[] = [
  // Balochistan – Sindh border (Hub / Kirthar Range north to Kashmore)
  toSvgPath([[25.0, 66.7], [26.2, 67.3], [27.5, 67.6], [28.4, 68.3], [28.5, 69.6]]),
  // Balochistan – Punjab / KP border (Sulaiman Range)
  toSvgPath([[28.5, 69.6], [29.8, 69.8], [31.0, 70.1], [31.9, 69.3]]),
  // Sindh – Punjab border
  toSvgPath([[28.5, 69.6], [27.7, 70.8]]),
  // KP – Punjab border (Indus / Attock / Mianwali)
  toSvgPath([[31.9, 70.4], [32.8, 71.2], [33.8, 72.2], [34.2, 73.4]]),
  // GB / AJK line
  toSvgPath([[35.1, 73.2], [34.8, 74.2], [33.9, 73.7], [33.1, 73.9]]),
];

// Indus River curve
const INDUS_RIVER_PATH = toSvgPath([
  [35.4, 75.6], [35.6, 74.5], [34.7, 73.0], [33.8, 72.2], [32.5, 71.5],
  [30.2, 70.9], [28.8, 70.2], [27.7, 68.8], [26.2, 68.1], [24.7, 67.9], [24.0, 67.6],
]);

const SEEDED_AREAS = ["Darya Colony", "Mehrabad", "Nawab Kot", "Safa Village"] as const;

const KNOWN_HOTSPOTS: Record<string, MapHotspot> = {
  "darya colony": { key: "darya colony", label: "Darya Colony", region: "Karachi · Sindh", lat: 24.9, lon: 67.1 },
  "nawab kot": { key: "nawab kot", label: "Nawab Kot", region: "Interior Sindh", lat: 27.6, lon: 68.8 },
  "mehrabad": { key: "mehrabad", label: "Mehrabad", region: "South Punjab", lat: 30.2, lon: 71.5 },
  "safa village": { key: "safa village", label: "Safa Village", region: "KP · North", lat: 34.4, lon: 72.1 },
  "karachi": { key: "karachi", label: "Karachi", region: "Sindh", lat: 24.86, lon: 67.01 },
  "lahore": { key: "lahore", label: "Lahore", region: "Punjab", lat: 31.52, lon: 74.35 },
  "multan": { key: "multan", label: "Multan", region: "Punjab", lat: 30.16, lon: 71.52 },
  "peshawar": { key: "peshawar", label: "Peshawar", region: "KP", lat: 34.01, lon: 71.52 },
  "quetta": { key: "quetta", label: "Quetta", region: "Balochistan", lat: 30.18, lon: 66.97 },
  "islamabad": { key: "islamabad", label: "Islamabad", region: "ICT", lat: 33.68, lon: 73.05 },
  "sukkur": { key: "sukkur", label: "Sukkur", region: "Sindh", lat: 27.71, lon: 68.86 },
};

function resolveClaimArea(claim: Claim): MapHotspot {
  const noteText = (claim.payload_json?.notes ?? "").toLowerCase();
  for (const [k, spot] of Object.entries(KNOWN_HOTSPOTS)) {
    if (noteText.includes(k)) return spot;
  }

  const seededMatch = /^10000000-0000-4000-a000-0*(\d+)$/i.exec(claim.citizen_id ?? "");
  if (seededMatch) {
    const idx = Number(seededMatch[1]);
    const areaName = idx === 1 ? "Darya Colony" : SEEDED_AREAS[idx % 4];
    return KNOWN_HOTSPOTS[areaName.toLowerCase()];
  }

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
        <svg viewBox="0 0 220 208" className="pk-map-svg" role="img" aria-label="Geographically projected map of Pakistan showing relief claim hotspots">
          <defs>
            <linearGradient id="pk-land-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="rgba(52, 211, 153, 0.24)" />
              <stop offset="60%" stopColor="rgba(16, 185, 129, 0.14)" />
              <stop offset="100%" stopColor="rgba(59, 130, 246, 0.16)" />
            </linearGradient>
          </defs>

          {/* National outline of Pakistan */}
          <path
            d={PAKISTAN_PATH}
            fill="url(#pk-land-grad)"
            stroke="rgba(255, 255, 255, 0.36)"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />

          {/* Province borders */}
          {PROVINCE_LINES.map((d, i) => (
            <path
              key={i}
              d={d}
              fill="none"
              stroke="rgba(255, 255, 255, 0.14)"
              strokeWidth="0.9"
              strokeLinejoin="round"
            />
          ))}

          {/* Indus River */}
          <path
            d={INDUS_RIVER_PATH}
            fill="none"
            stroke="rgba(100, 196, 255, 0.32)"
            strokeWidth="1.1"
            strokeDasharray="2.5 2.5"
          />

          {/* Projected live hotspot pins */}
          {hotspots.ranked.map((item, idx) => {
            const [cx, cy] = project(item.spot.lat, item.spot.lon);
            const isTop = idx === 0 && item.total > 0;
            const isPicked = active?.spot.key === item.spot.key;
            const ratio = item.total / hotspots.maxCount;
            const dotR = item.total > 0 ? 4 + ratio * 4.8 : 2.8;
            const haloR = dotR + 5.5;
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
                  <circle cx={cx} cy={cy} r={haloR} fill={color} fillOpacity={isPicked ? 0.38 : 0.22} />
                )}
                <circle
                  cx={cx}
                  cy={cy}
                  r={dotR}
                  fill={item.total > 0 ? color : "rgba(255,255,255,0.28)"}
                  stroke={isPicked ? "#ffffff" : "rgba(255,255,255,0.6)"}
                  strokeWidth={isPicked ? 1.8 : 0.9}
                />
              </g>
            );
          })}
        </svg>

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
