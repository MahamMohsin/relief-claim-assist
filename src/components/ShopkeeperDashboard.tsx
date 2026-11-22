"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { api } from "@/src/lib/client";
import { BUSINESS_SCHEMES } from "@/src/lib/businessSchemes";
import type { MiniApp, RuleConfig } from "@/src/lib/contracts";

type SchemeInfo = { version: number; name: string; config: RuleConfig };

const compactPkr = (amount: number) => {
  if (amount >= 1_000_000) return `PKR ${(amount / 1_000_000).toFixed(0)}M`;
  if (amount >= 1_000) return `PKR ${Math.round(amount / 1_000)}k`;
  return `PKR ${amount.toLocaleString("en-PK")}`;
};

export function ShopkeeperDashboard({
  offline,
  version,
  onOpen,
}: {
  offline: boolean;
  version: number;
  onOpen: (app: MiniApp) => void;
}) {
  const [scheme, setScheme] = useState<SchemeInfo | null>(null);

  useEffect(() => {
    if (offline) return;
    const controller = new AbortController();
    api<SchemeInfo>("scheme", {}, controller.signal)
      .then(res => {
        if (!controller.signal.aborted && res?.config) setScheme(res);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [offline, version]);

  const stats = useMemo(() => {
    const small = BUSINESS_SCHEMES.filter(s => s.size === "small");
    const large = BUSINESS_SCHEMES.filter(s => s.size === "large");
    const maxSmall = Math.max(0, ...small.map(s => s.maxAmountPkr));
    const maxLarge = Math.max(0, ...large.map(s => s.maxAmountPkr));
    const grantCount = BUSINESS_SCHEMES.filter(s => s.fundingType === "Grant (0%)" || s.fundingType === "Merchant Incentive").length;
    return { smallCount: small.length, largeCount: large.length, maxSmall, maxLarge, grantCount };
  }, []);

  return (
    <section className="audit-glass-suite is-compact" aria-label="Shopkeeper dashboard">
      {/* CARD 1: Scam Protection & Official Payout Reference */}
      <article
        className="audit-glass-card officer-glass-card"
        onClick={() => onOpen("scam")}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onOpen("scam"); }}
      >
        <header className="audit-glass-head">
          <div className="audit-glass-title-group">
            <span className="audit-glass-dot violet" />
            <span className="audit-glass-kicker">Scam Shield</span>
            <strong className="audit-glass-title">{scheme ? `Rule v${scheme.version}` : "Live guard"}</strong>
          </div>
          <button
            type="button"
            className="audit-glass-open-btn"
            onClick={e => { e.stopPropagation(); onOpen("scam"); }}
          >
            Verify <ArrowUpRight size={13} aria-hidden="true" />
          </button>
        </header>

        <div className="officer-budget-kpis">
          <div className="officer-kpi-cell">
            <span className="officer-kpi-label"><i style={{ background: "#34d399" }} />Official aid</span>
            <strong>{scheme ? compactPkr(scheme.config.amount_pkr) : "PKR 25k"}</strong>
          </div>
          <div className="officer-kpi-cell">
            <span className="officer-kpi-label"><i style={{ background: "#ff7854" }} />Official fee</span>
            <strong>PKR 0</strong>
          </div>
          <div className="officer-kpi-cell">
            <span className="officer-kpi-label"><i style={{ background: "#64c4ff" }} />Raast rail</span>
            <strong>Active</strong>
          </div>
        </div>

        <p className="officer-hist-foot">
          Paste any SMS, upload a receipt screenshot, or cross-check a <strong>Raast reference</strong> before handing out cash.
        </p>
      </article>

      {/* CARD 2: Small & Large Business Schemes */}
      <article
        className="audit-glass-card officer-glass-card"
        onClick={() => onOpen("schemes")}
        role="button"
        tabIndex={0}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onOpen("schemes"); }}
      >
        <header className="audit-glass-head">
          <div className="audit-glass-title-group">
            <span className="audit-glass-dot green" />
            <span className="audit-glass-kicker">Business schemes</span>
            <strong className="audit-glass-title">{BUSINESS_SCHEMES.length} programs</strong>
          </div>
          <button
            type="button"
            className="audit-glass-open-btn"
            onClick={e => { e.stopPropagation(); onOpen("schemes"); }}
          >
            Match <ArrowUpRight size={13} aria-hidden="true" />
          </button>
        </header>

        <div className="officer-kpi-grid">
          <div className="officer-kpi-cell">
            <span className="officer-kpi-label"><i style={{ background: "#34d399" }} />Small business</span>
            <strong>{stats.smallCount} · {compactPkr(stats.maxSmall)}</strong>
          </div>
          <div className="officer-kpi-cell">
            <span className="officer-kpi-label"><i style={{ background: "#64c4ff" }} />Large business</span>
            <strong>{stats.largeCount} · {compactPkr(stats.maxLarge)}</strong>
          </div>
        </div>

        <div className="audit-prop-bar" role="img" aria-label="Small vs large business scheme distribution">
          <span className="audit-prop-seg" style={{ flexGrow: stats.smallCount, background: "#34d399" }} />
          <span className="audit-prop-seg" style={{ flexGrow: stats.largeCount, background: "#64c4ff" }} />
        </div>

        <p className="officer-hist-foot">
          <strong>{stats.grantCount} zero-markup grants</strong> · Tell the voice assistant your monthly sales &amp; staff to find your best match.
        </p>
      </article>
    </section>
  );
}
