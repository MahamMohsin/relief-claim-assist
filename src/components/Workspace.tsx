"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, ArrowUpRight, Award, CheckCircle2, ChevronDown, Clock, Cloud, CloudOff, Fingerprint, HandHeart, House,
  LoaderCircle, LogOut, Maximize2, Minimize2, Minus, Radio, Trophy, UserPlus, UserRound, Users, Wifi, X } from "lucide-react";
import { canOpen, personas, type Claim, type Family, type MiniApp, type Overview, type Persona, type Profile } from "@/src/lib/contracts";
import { api, jsonRequest } from "@/src/lib/client";
import { queued, pushMutation, wipeDraft, type Mutation } from "@/src/lib/offline/queue";
import { syncQueue } from "@/src/lib/offline/syncEngine";
import { apps } from "./launcher";
import { MiniApps, type ViewContext } from "./MiniApps";
import { VoiceDock } from "./os/VoiceDock";
import type { UIAction } from "@/src/lib/contracts";

import { PipLoginModal } from "./pip/PipLoginModal";

const roleEntries = Object.entries(personas) as [Persona, (typeof personas)[Persona]][];
type WindowPreset = "compact" | "default" | "wide";
const tools = Object.keys(apps) as MiniApp[];

export function Workspace({ initialProfile, showLogin = false, demoRegistrationEnabled = false }: {
  initialProfile: Profile | null;
  showLogin?: boolean;
  demoRegistrationEnabled?: boolean;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [showAuthModal, setShowAuthModal] = useState(showLogin || !initialProfile);
  // When not logged in, the login screen is the only gateway: background is blurred and clicking out is impossible
  const isLocked = !profile;
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [openApps, setOpenApps] = useState<MiniApp[]>([]);
  const [activeApp, setActiveApp] = useState<MiniApp | null>(null);
  const [minimizedApps, setMinimizedApps] = useState<MiniApp[]>([]);
  // After a window is minimized (and becomes inert), move keyboard focus to its app tile.
  const tileFocusRef = useRef<MiniApp | null>(null);
  useEffect(() => {
    const appId = tileFocusRef.current;
    if (!appId || !minimizedApps.includes(appId)) return;
    tileFocusRef.current = null;
    document.querySelector<HTMLElement>(`[data-app-tile="${appId}"]`)?.focus();
  }, [minimizedApps]);
  const [windowState, setWindowState] = useState<Partial<Record<MiniApp, { sizePreset?: WindowPreset; restorePreset?: WindowPreset }>>>({});
  const [chooser, setChooser] = useState(showLogin);
  const [family, setFamily] = useState<Family | null>(null);
  const [fixtureOnline, setFixtureOnline] = useState(true);
  const [browserOnline, setBrowserOnline] = useState(true);
  const [lite, setLite] = useState(false);
  const [pending, setPending] = useState<Mutation[]>([]);
  const [busy, setBusy] = useState<Persona | "signout" | null>(null);
  const [headMessage, setHeadMessage] = useState("");
  const [version, setVersion] = useState(0);
  const [reset, setReset] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [prefill, setPrefill] = useState<Extract<UIAction, { type: "prefill_fields" }> | null>(null);
  const [stepNav, setStepNav] = useState<"evidence" | "review" | "submit" | null>(null);
  const [alert, setAlert] = useState("");
  const [pastClaims, setPastClaims] = useState<Claim[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [officerQueue, setOfficerQueue] = useState<Claim[]>([]);
  const [clock, setClock] = useState("");
  const activeCall = useRef<AbortController | null>(null);
  const desktopBoundsRef = useRef<HTMLDivElement>(null);
  const motionDisabled = useReducedMotion() || lite;
  const offline = !browserOnline || !fixtureOnline;
  const citizen = profile?.role === "helper" ? family?.id ?? null : profile?.citizen_id ?? null;
  const scope = citizen ?? "self";
  const owner = profile?.id;
  const available = profile ? tools.filter(tool => canOpen(profile.role, tool)) : [];

  useEffect(() => {
    const status = () => setBrowserOnline(navigator.onLine);
    status();
    window.addEventListener("online", status);
    window.addEventListener("offline", status);
    return () => {
      window.removeEventListener("online", status);
      window.removeEventListener("offline", status);
    };
  }, []);

  const reloadQueue = useCallback(async () => {
    if (!owner) return;
    try { setPending(await queued(owner, scope)); } catch { setHeadMessage("Offline storage is unavailable in this browser."); }
  }, [owner, scope]);

  const synchronize = useCallback(async (manual = false) => {
    if (!owner || offline || activeCall.current) return;
    const controller = new AbortController();
    activeCall.current = controller;
    setSyncing(true);
    try {
      const count = await syncQueue({ owner, citizen: scope, manual, signal: controller.signal, onTranscript: setTranscript });
      if (count && !controller.signal.aborted) {
        setVersion(value => value + 1);
        setHeadMessage(count + (count === 1 ? " queued item synced." : " queued items synced."));
      }
      if (!controller.signal.aborted) await reloadQueue();
    } catch {
      if (manual) setHeadMessage("Sync could not finish. Your queue is still saved.");
    } finally {
      if (activeCall.current === controller) {
        activeCall.current = null;
        setSyncing(false);
      }
    }
  }, [owner, scope, offline, reloadQueue]);

  useEffect(() => {
    void reloadQueue();
    if (!offline) void synchronize();
    const interval = window.setInterval(() => { if (!offline) void synchronize(); }, 4500);
    return () => {
      window.clearInterval(interval);
      activeCall.current?.abort();
      activeCall.current = null;
      setSyncing(false);
    };
  }, [reloadQueue, synchronize, offline]);

  useEffect(() => {
    if (!profile || offline || !canOpen(profile.role, "claim")) return;
    const controller = new AbortController();
    setClaimsLoading(true);
    api<Claim[]>("claims", citizen ? { citizenId: citizen } : {}, controller.signal)
      .then(res => { if (!controller.signal.aborted && Array.isArray(res)) setPastClaims(res); })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setClaimsLoading(false); });
    return () => controller.abort();
  }, [profile, citizen, offline, version]);

  useEffect(() => {
    if (!profile || offline || !["officer", "admin", "auditor"].includes(profile.role)) return;
    const controller = new AbortController();
    api<Overview>("overview", {}, controller.signal)
      .then(res => { if (!controller.signal.aborted) setOverview(res); })
      .catch(() => {});
    if (profile.role === "officer") {
      api<Claim[]>("queue", {}, controller.signal)
        .then(cases => { if (!controller.signal.aborted) setOfficerQueue(cases); })
        .catch(() => {});
    }
    return () => controller.abort();
  }, [profile, offline, version]);

  useEffect(() => {
    const update = () => setClock(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    update();
    const timer = window.setInterval(update, 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator && window.isSecureContext) {
      void navigator.serviceWorker.register("/relief-offline-worker.js").catch(() => {});
    }
  }, []);

  const enqueue: ViewContext["enqueue"] = async (action, body, opts = {}) => {
    if (!owner) throw new Error("Sign in before queuing changes.");
    const id = opts.key ?? crypto.randomUUID();
    await pushMutation({ id, owner, citizen: scope, action, body, dependsOn: opts.dependsOn, audio: opts.audio });
    await reloadQueue();
    return id;
  };

  function openAppWindow(appId: MiniApp) {
    if (!profile || !canOpen(profile.role, appId)) return;
    setAlert("");
    setOpenApps(prev => prev.includes(appId) ? prev : [...prev, appId]);
    setMinimizedApps(prev => prev.filter(id => id !== appId));
    setActiveApp(appId);
  }

  // Focus the most recent window that is still visible (open and not minimized).
  function focusNextVisible(leaving: MiniApp) {
    const visible = openApps.filter(id => id !== leaving && !minimizedApps.includes(id));
    setActiveApp(visible.length > 0 ? visible[visible.length - 1] : null);
  }

  function closeAppWindow(appId: MiniApp) {
    setOpenApps(prev => prev.filter(id => id !== appId));
    setMinimizedApps(prev => prev.filter(id => id !== appId));
    if (activeApp === appId) focusNextVisible(appId);
  }

  // Yellow traffic light: hide the window to its app tile. It stays mounted so unsaved
  // input survives; clicking the tile (or opening the app any other way) restores it.
  function minimizeAppWindow(appId: MiniApp) {
    setMinimizedApps(prev => prev.includes(appId) ? prev : [...prev, appId]);
    if (activeApp === appId) focusNextVisible(appId);
    tileFocusRef.current = appId;
  }

  function setAppSizePreset(appId: MiniApp, preset: WindowPreset) {
    setWindowState(prev => ({
      ...prev,
      [appId]: { sizePreset: preset }
    }));
  }

  // Green traffic light: expand to the largest preset (L) and restore the size used before.
  function toggleExpand(appId: MiniApp) {
    setWindowState(prev => {
      const current = prev[appId]?.sizePreset ?? "default";
      return {
        ...prev,
        [appId]: current === "wide"
          ? { sizePreset: prev[appId]?.restorePreset ?? "default" }
          : { sizePreset: "wide", restorePreset: current },
      };
    });
  }

  function changeApp(next: MiniApp | null) {
    if (next) {
      openAppWindow(next);
    } else {
      setActiveApp(null);
    }
  }

  async function clearContext() {
    activeCall.current?.abort();
    if (owner) await wipeDraft(owner, scope).catch(() => {});
    setReset(value => value + 1);
    setFamily(null);
    setTranscript("");
    setAlert("");
    setPrefill(null);
    setStepNav(null);
    setPastClaims([]);
    setOverview(null);
    setOfficerQueue([]);
    setPending([]);
    setOpenApps([]);
    setMinimizedApps([]);
    setActiveApp(null);
  }

  async function signIn(persona: Persona) {
    if (offline || busy) return;
    setBusy(persona);
    setHeadMessage("");
    try {
      const timeout = AbortSignal.timeout(18000);
      await jsonRequest("/api/auth/demo", { persona }, timeout);
      const next = await api<Profile>("profile", {}, timeout);
      await clearContext();
      setProfile(next);
      setOpenApps([]);
      setActiveApp(null);
      setChooser(false);
      setShowAuthModal(false);
    } catch (error) {
      setHeadMessage(error instanceof Error && error.name === "TimeoutError"
        ? "Demo sign-in took too long. Please try again."
        : error instanceof Error ? error.message : "Could not sign in.");
    } finally { setBusy(null); }
  }

  async function signOut() {
    if (offline || busy) return;
    setBusy("signout");
    try {
      const response = await fetch("/api/auth/demo", { method: "DELETE" });
      if (!response.ok) throw new Error("Could not sign out. Try again.");
      await clearContext();
      setProfile(null);
      setOpenApps([]);
      setActiveApp(null);
      setChooser(false);
      setShowAuthModal(true);
      setHeadMessage("");
    } catch (error) {
      setHeadMessage(error instanceof Error ? error.message : "Could not sign out.");
    } finally { setBusy(null); }
  }

  async function selectFamily(next: Family) {
    if (offline) throw new Error("Reconnect to verify this family’s consent.");
    await api("switch_family", { citizenId: next.id });
    await clearContext();
    setFamily(next);
    setHeadMessage("Previous session cleared. Active family: " + next.full_name + ".");
    openAppWindow("claim");
  }

  function dispatch(action: UIAction) {
    switch (action.type) {
      case "open_mini_app":
        changeApp(action.app);
        break;
      case "prefill_fields":
        setPrefill(action);
        setVersion(value => value + 1);
        break;
      case "advance_claim_step":
        setStepNav(action.step);
        break;
      case "highlight_alert":
        setAlert(action.message);
        break;
    }
  }

  const monthStart = (() => { const start = new Date(); start.setDate(1); start.setHours(0, 0, 0, 0); return start; })();
  const queueDocs = officerQueue.flatMap(claim => claim.documents ?? []);
  const verifiedDocs = queueDocs.filter(doc => ["genuine", "readable", "verified"].includes(doc.verified_status)).length;
  const newThisMonth = officerQueue.filter(claim => claim.created_at ? new Date(claim.created_at) >= monthStart : false);
  const verifiedPct = queueDocs.length ? Math.round((verifiedDocs / queueDocs.length) * 100) : 0;
  const uniqueCitizens = (claims: Claim[]) => {
    const seen = new Set<string>();
    return claims.filter(claim => seen.has(claim.citizen_id) ? false : (seen.add(claim.citizen_id), true));
  };
  const initialsFor = (claims: Claim[], limit = 6) => claims.slice(0, limit).map(claim =>
    (claim.citizen_name ?? "?").split(" ").filter(Boolean).map(word => word[0]).slice(0, 2).join(""));
  const queueCitizens = uniqueCitizens(officerQueue.filter(claim => ["submitted", "in_review", "needs_proof"].includes(claim.status)));
  const newCitizens = uniqueCitizens(newThisMonth);
  const clusterPeople = queueCitizens.slice(0, 6).map(claim => ({ initials: initialsFor([claim])[0], name: claim.citizen_name ?? "Open case" }));

  const status = offline ? "Offline" : "Online";
  const failed = pending.find(item => item.failure);
  const context: ViewContext | null = profile ? {
    profile, citizen, offline, version, enqueue, selectFamily, prefill, stepNav, voiceLang: profile.locale,
    go: changeApp, refresh: () => setVersion(current => current + 1), lite,
  } : null;

  return (
    <div
      className={
        (lite ? "workspace lite" : "workspace") +
        (isLocked ? " locked-workspace" : "")
      }
    >
      {/* Apple macOS Full-Width Top Menu Bar */}
      <header className="macos-menubar">
        <div className="macos-menu-left">
          <span className="macos-apple-logo" title="Relief System">
            <HandHeart size={14} />
          </span>
          <span className="macos-app-name">Relief Assist</span>
        </div>

        <nav className="macos-menu-center">
          <button className="macos-menu-item" onClick={() => changeApp(null)}>Dashboard</button>
          {available.includes("claim") && <button className="macos-menu-item" onClick={() => changeApp("claim")}>Claims</button>}
          {available.includes("review") && <button className="macos-menu-item" onClick={() => changeApp("review")}>Review</button>}
          {available.includes("policy") && <button className="macos-menu-item" onClick={() => changeApp("policy")}>Policy</button>}
          {available.includes("privacy") && <button className="macos-menu-item" onClick={() => changeApp("privacy")}>Privacy</button>}
          {available.includes("audit") && <button className="macos-menu-item" onClick={() => changeApp("audit")}>Audit</button>}
        </nav>

        <div className="macos-menu-right">
          <span className="macos-status-pill">{offline ? "Offline" : "Online"}</span>
          {profile ? (
            <button className="macos-user-btn" onClick={() => setChooser(true)}>
              {profile.full_name.split(" ")[0]}
            </button>
          ) : (
            <button className="macos-user-btn" onClick={() => setShowAuthModal(true)}>
              Log in
            </button>
          )}
          <span className="macos-clock">
            {clock}
          </span>
        </div>
      </header>

      <div className="relief-status-controls">
        <span className="status-spacer" aria-hidden="true" />
        {profile && <>
          <button className="control" aria-pressed={!fixtureOnline} onClick={() => setFixtureOnline(value => !value)}><Radio size={15} /> Simulate network drop</button>
          <button className="control" aria-pressed={lite} onClick={() => setLite(value => !value)}>2G Lite mode</button>
          <span className="net" role="status">{offline ? "Offline" : "Online"}{pending.length > 0 ? " · " + pending.length + " queued" : ""}</span>
          <button className="control" disabled={offline || syncing || !pending.length} onClick={() => void synchronize(true)}><Cloud size={15} /> {syncing ? "Syncing…" : "Sync now"}</button>
        </>}
      </div>

      {(headMessage || failed) && <div className="top-notice"><p role="status">{headMessage || failed?.failure}</p><button onClick={() => setHeadMessage("")} aria-label="Dismiss update"><X size={17} /></button></div>}

      <main className="content">
        <AnimatePresence mode="wait" initial={false}>
          {!profile ? (
            <motion.div key="welcome" initial={{ opacity: motionDisabled ? 1 : 0 }} animate={{ opacity: 1 }} className="welcome">
              <section className="hero">
                <div className="hero-art" aria-hidden="true"><i /><i /><i /><span /><span /></div>
                <div className="hero-content">
                  <div className="hero-label"><span /> EMERGENCY CASH ASSISTANCE</div>
                  <h1>Relief within<br />reach.</h1>
                  <p>Apply for aid, check a payment, or help a family take the next step. Explore the full journey using a synthetic demo persona.</p>
                  <button className="hero-button" onClick={() => setShowAuthModal(true)}>Log in to continue <ArrowRight size={18} /></button>
                </div>
              </section>
              <section id="personas" aria-labelledby="persona-heading">
                <div className="section-heading"><div><h2 id="persona-heading">Enter the demo</h2><p>Choose a role or log in to open its workspace.</p></div></div>
                <PersonaList onSelect={signIn} busy={busy} offline={offline} />
              </section>
            </motion.div>
          ) : (
            <div className="dashboard-canvas">
              {/* Top Row: Fatima Bibi + Compact Preview Tile side-by-side */}
              <div className="ios-top-hero-row">
                <div className="ios-hero-name">
                  <div className={"liquid-user-pill" + (userDropdownOpen ? " expanded" : "")}>
                    <div className="liquid-user-header">
                      <div>
                        <h1>{profile ? profile.full_name : "Fatima Bibi"}</h1>
                        <p>{profile?.role === "helper" ? "Community Health Worker" : profile?.role === "officer" ? "Department Review Officer" : "Emergency Cash Assistance"}</p>
                      </div>
                      <button type="button" className={"liquid-chevron" + (userDropdownOpen ? " rotated" : "")}
                        aria-label="Account menu" aria-expanded={userDropdownOpen} aria-controls="account-menu"
                        onClick={() => setUserDropdownOpen(open => !open)}>
                        <ChevronDown size={22} strokeWidth={2.4} />
                      </button>
                    </div>

                    {/* Liquid Glass Dropdown Menu */}
                    <AnimatePresence>
                      {userDropdownOpen && (
                        <motion.div
                          id="account-menu"
                          className="liquid-glass-menu"
                          initial={{ opacity: 0, height: 0, scale: 0.96 }}
                          animate={{ opacity: 1, height: "auto", scale: 1 }}
                          exit={{ opacity: 0, height: 0, scale: 0.96 }}
                          transition={{ type: "spring", stiffness: 380, damping: 28 }}
                        >
                          <div className="liquid-menu-divider" />
                          <div className="liquid-menu-body">
                            <div className="liquid-user-meta">
                              <span className="liquid-role-badge">{profile.role}</span>
                            </div>

                            <div className="liquid-action-buttons">
                              <button
                                type="button"
                                className="liquid-action-btn primary"
                                onClick={() => {
                                  setUserDropdownOpen(false);
                                  setShowAuthModal(true);
                                }}
                              >
                                <UserPlus size={16} />
                                <span>Register / Switch Account</span>
                              </button>

                              <button
                                type="button"
                                className="liquid-action-btn secondary"
                                onClick={() => {
                                  setUserDropdownOpen(false);
                                  setChooser(true);
                                }}
                              >
                                <Users size={16} />
                                <span>Switch Demo Persona</span>
                              </button>

                              <button
                                type="button"
                                className="liquid-action-btn danger"
                                onClick={() => {
                                  setUserDropdownOpen(false);
                                  void signOut();
                                }}
                              >
                                <LogOut size={16} />
                                <span>Sign Out</span>
                              </button>
                            </div>
                            <p className="liquid-prototype-note">Prototype · simulated data</p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>


                {["officer", "admin", "auditor"].includes(profile.role) && (
                  overview ? <div className="overview-stats-suite">
                    <button type="button" className="overview-card active-cases-card"
                      onClick={() => openAppWindow(profile.role === "officer" ? "review" : "audit")}>
                      <div className="overview-card-header">
                        <span className="overview-card-title">Active cases</span>
                        <span className="overview-live-badge"><span className="live-dot" />{overview.review} in review</span>
                      </div>
                      {clusterPeople.length > 0 && <div className="overview-cluster-wrap"><div className="bubble-cluster">
                        {clusterPeople.map((person, index) =>
                          <div className={`cluster-avatar a${index + 1}`} key={person.name + index} title={person.name}>{person.initials}</div>)}
                        {queueCitizens.length > 6 && <div className="cluster-counter" title="More applicants">+{queueCitizens.length - 6}</div>}
                      </div></div>}
                      <div className="overview-card-footer">
                        <strong className="overview-big-num">{overview.active.toLocaleString()}</strong>
                        <span className="overview-sub-meta">{overview.proof} awaiting evidence{queueDocs.length > 0 && ` · ${verifiedPct}% docs verified`}</span>
                      </div>
                    </button>
                    <button type="button" className="overview-card bubbles-breakdown-card"
                      onClick={() => openAppWindow(profile.role === "officer" ? "review" : "audit")}>
                      <span className="overview-card-title">Claims by status</span>
                      <div className="proportional-bubbles-stage">
                        {([["Approved", overview.approved, "big"], ["In review", overview.review, "medium"],
                          ["Needs proof", overview.proof, "small"], ["Rejected", overview.rejected, "mini"]] as const).map(([label, count, size]) => (
                          <div className={"prop-bubble " + size} key={label}><strong>{count}</strong><small>{label}</small></div>
                        ))}
                      </div>
                      <div className="bubbles-legend-footer">{overview.paid} paid · {overview.closed} closed</div>
                    </button>
                    <div className="overview-stack-col">
                      <div className="overview-card stack-metric-card">
                        <span className="overview-card-title">New this month</span>
                        <div className="stack-metric-row">
                          <strong className="stack-metric-num">{overview.new_this_month}</strong>
                          {newCitizens.length > 0 && <div className="stack-mini-avatars" aria-hidden="true">
                            {initialsFor(newCitizens, 3).map((initials, index) =>
                              <span className={`mini-av av-${index + 1}`} key={initials + index}>{initials}</span>)}
                            {newCitizens.length > 3 && <span className="mini-av av-4">+{newCitizens.length - 3}</span>}
                          </div>}
                        </div>
                      </div>
                      <div className="overview-card stack-metric-card">
                        <span className="overview-card-title">Priority review</span>
                        <strong className="stack-metric-num">{overview.priority}</strong>
                      </div>
                    </div>
                  </div> : <p role="status">{offline ? "Overview reconnects when you are online." : "Loading claim overview…"}</p>
                )}

                {/* Right Side Widgets: Status Progress Card + Recent Claim Preview Card (for Citizens and Helpers) */}
                {canOpen(profile.role, "claim") && (
                  <div className="ios-top-widgets-group">
                    {/* Relief Claims Status Progress Pill Widget */}
                    <div
                      className="relief-stats-widget"
                      onClick={() => openAppWindow("claim")}
                      role="button"
                      tabIndex={0}
                      title="View Relief Claims Details"
                    >
                      {(() => {
                        const total = pastClaims.length || 1;
                        const approvedCount = pastClaims.filter(c => c.status === "approved" || c.payment_status === "paid").length;
                        const inReviewCount = pastClaims.filter(c => ["submitted", "in_review", "needs_proof"].includes(c.status)).length;
                        const paidTotal = pastClaims.filter(c => c.payment_status === "paid").reduce((acc, c) => acc + (c.amount_pkr || 0), 0);

                        const approvedPct = Math.min(100, Math.round((approvedCount / total) * 100));
                        const reviewPct = Math.min(100, Math.round((inReviewCount / total) * 100));
                        const fundsPct = Math.min(100, Math.round((paidTotal / 50000) * 100));

                        return (
                          <>
                            <div className="relief-stat-row">
                              <span className="relief-stat-icon">
                                <Award size={18} strokeWidth={2.2} />
                              </span>
                              <span className="relief-stat-value">
                                {approvedCount}/{total}
                              </span>
                              <div className="relief-stat-meta">
                                <span className="relief-stat-label">APPROVED</span>
                                <div className="relief-progress-track">
                                  <div
                                    className="relief-progress-bar"
                                    style={{ width: `${Math.max(approvedCount > 0 ? 12 : 0, approvedPct)}%` }}
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="relief-stat-row">
                              <span className="relief-stat-icon">
                                <Trophy size={18} strokeWidth={2.2} />
                              </span>
                              <span className="relief-stat-value">
                                {inReviewCount}/{total}
                              </span>
                              <div className="relief-stat-meta">
                                <span className="relief-stat-label">IN REVIEW</span>
                                <div className="relief-progress-track">
                                  <div
                                    className="relief-progress-bar"
                                    style={{ width: `${Math.max(inReviewCount > 0 ? 12 : 0, reviewPct)}%` }}
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="relief-stat-row">
                              <span className="relief-stat-icon relief-pin-icon">
                                <span className="pin-shape" />
                              </span>
                              <span className="relief-stat-value">
                                {paidTotal > 0 ? Math.round(paidTotal / 1000) + "k" : "100"}
                              </span>
                              <div className="relief-stat-meta">
                                <span className="relief-stat-label">CLAIMED</span>
                                <div className="relief-progress-track">
                                  <div
                                    className="relief-progress-bar"
                                    style={{ width: `${paidTotal > 0 ? fundsPct : 38}%` }}
                                  />
                                </div>
                              </div>
                            </div>
                          </>
                        );
                      })()}
                    </div>

                    {/* Apple-Style Compact Past Requests Widget (Recent Claim Details) */}
                    <div className="ios-history-widget compact glass-card" onClick={() => openAppWindow("claim")} role="button" tabIndex={0}>
                      <div className="ios-history-header">
                        <div>
                          <h3>Recent Claim</h3>
                          <small>{pastClaims.length} on file</small>
                        </div>
                        <span className="ios-badge">History</span>
                      </div>

                      <div className="ios-history-list">
                        {claimsLoading ? (
                          <div className="ios-history-empty">
                            <LoaderCircle size={16} className="spin" /> Loading…
                          </div>
                        ) : pastClaims.length === 0 ? (
                          <div className="ios-history-empty">
                            No applications yet.
                          </div>
                        ) : (
                          (() => {
                            const item = pastClaims[0];
                            const stateColor = ["approved", "paid"].includes(item.status) ? "green"
                              : ["needs_proof", "rejected"].includes(item.status) ? "amber" : "neutral";
                            const title = item.status.replaceAll("_", " ").toUpperCase();
                            return (
                              <div className="ios-compact-preview">
                                <div className="ios-compact-top">
                                  <span className={"ios-status-badge " + stateColor}>{title}</span>
                                  <strong>{item.amount_pkr ? "PKR " + new Intl.NumberFormat("en-PK").format(item.amount_pkr) : "Pending"}</strong>
                                </div>
                                <p className="ios-compact-id">
                                  ID: {item.id.slice(0, 8)}…{item.id.slice(-4)}
                                </p>
                                {item.citizen_reason_en && (
                                  <p className="ios-compact-reason">
                                    {item.citizen_reason_en}
                                  </p>
                                )}
                                <div className="ios-compact-footer">
                                  <span>Tap to view all claims</span>
                                  <ArrowRight size={13} />
                                </div>
                              </div>
                            );
                          })()
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Apple iPad / Desktop App Grid (Icons with names below) */}
              <div className="ios-desktop-grid">
                {available.map(id => {
                  const item = apps[id];
                  const Icon = item.icon;
                  const isRunning = openApps.includes(id);
                  const isMinimized = isRunning && minimizedApps.includes(id);
                  return (
                    <motion.button
                      className={"ios-desktop-app" + (isRunning ? " running" : "") + (isMinimized ? " minimized" : "")}
                      key={id}
                      data-app-tile={id}
                      aria-label={isMinimized ? item.title + " (minimized, click to restore)" : undefined}
                      onClick={() => openAppWindow(id)}
                      whileHover={motionDisabled ? undefined : { y: -6, scale: 1.05 }}
                      whileTap={motionDisabled ? undefined : { scale: 0.94 }}
                      transition={{ type: "spring", stiffness: 260, damping: 20, mass: 0.8 }}
                    >
                      <motion.div layoutId={motionDisabled ? undefined : "launch-icon-" + id} className={"ios-desktop-icon " + item.color}>
                        <Icon size={34} strokeWidth={2.1} />
                      </motion.div>
                      <span className="ios-desktop-label">{item.title}</span>
                      {isRunning && <span className="ios-app-running-dot" />}
                    </motion.button>
                  );
                })}
              </div>

              {/* Window Manager: Floating Desktop Windows with White BG, Header Controls & Independent Scroll */}
              <div className="desktop-window-layer" ref={desktopBoundsRef}>
                {openApps.map((appId, index) => {
                  const appMeta = apps[appId];
                  const isMinimized = minimizedApps.includes(appId);
                  const isFocused = activeApp === appId && !isMinimized;
                  const state = windowState[appId] || {};
                  const preset = state.sizePreset || "default";
                  const isExpanded = preset === "wide";
                  const Icon = appMeta.icon;

                  // Stagger initial positions for overlapping feel
                  const offset = (index % 5) * 28;

                  return (
                    <motion.div
                      key={appId}
                      drag
                      dragConstraints={desktopBoundsRef}
                      dragElastic={0.05}
                      dragMomentum={false}
                      // Only scale/opacity animate: x/y belong to drag, so a restored window keeps its position.
                      initial={motionDisabled ? false : { scale: 0.92, opacity: 0 }}
                      animate={isMinimized ? { scale: 0.6, opacity: 0 } : { scale: 1, opacity: 1 }}
                      transition={motionDisabled ? { duration: 0 } : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                      exit={{ scale: 0.88, opacity: 0 }}
                      style={{
                        zIndex: isFocused ? 20 : 10 + index,
                        top: `calc(20px + ${offset}px)`,
                        left: `calc(max(20px, 50% - 440px) + ${offset}px)`,
                        transformOrigin: "50% 100%",
                      }}
                      className={"desktop-window preset-" + preset + " " + (isFocused ? "focused " : "") + (isMinimized ? "minimized" : "")}
                      aria-hidden={isMinimized || undefined}
                      inert={isMinimized}
                      onPointerDown={() => setActiveApp(appId)}
                    >
                      {/* Window Title Bar */}
                      <div className="desktop-window-titlebar">
                        <div className="window-traffic-lights">
                          <button
                            type="button"
                            className="traffic-light close"
                            onClick={e => { e.stopPropagation(); closeAppWindow(appId); }}
                            title="Close window"
                            aria-label="Close window"
                          >
                            <X size={8} strokeWidth={3} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="traffic-light minimize"
                            onClick={e => { e.stopPropagation(); minimizeAppWindow(appId); }}
                            title="Minimize window"
                            aria-label="Minimize window"
                          >
                            <Minus size={8} strokeWidth={3} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="traffic-light maximize"
                            onClick={e => { e.stopPropagation(); toggleExpand(appId); }}
                            title={isExpanded ? "Restore window" : "Expand window"}
                            aria-label={isExpanded ? "Restore window" : "Expand window"}
                            aria-pressed={isExpanded}
                          >
                            {isExpanded ? <Minimize2 size={8} strokeWidth={3} aria-hidden="true" /> : <Maximize2 size={8} strokeWidth={3} aria-hidden="true" />}
                          </button>
                        </div>

                        <div className="window-title-group">
                          <motion.span layoutId={motionDisabled ? undefined : "launch-icon-" + appId} className={"window-mini-icon " + appMeta.color}>
                            <Icon size={14} />
                          </motion.span>
                          <span className="window-title-text">{appMeta.title}</span>
                        </div>

                        {/* Window Quick Size & Close Options */}
                        <div className="window-controls-right">
                          <div className="window-size-selector" title="Window size preset">
                            <button
                              type="button"
                              className={"size-btn" + (preset === "compact" ? " active" : "")}
                              onClick={e => { e.stopPropagation(); setAppSizePreset(appId, "compact"); }}
                              title="Compact view (480px)"
                            >
                              S
                            </button>
                            <button
                              type="button"
                              className={"size-btn" + (preset === "default" ? " active" : "")}
                              onClick={e => { e.stopPropagation(); setAppSizePreset(appId, "default"); }}
                              title="Standard view (780px)"
                            >
                              M
                            </button>
                            <button
                              type="button"
                              className={"size-btn" + (preset === "wide" ? " active" : "")}
                              onClick={e => { e.stopPropagation(); setAppSizePreset(appId, "wide"); }}
                              title="Wide split view (1020px)"
                            >
                              L
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Window Body with isolated white background & its own scrollbar */}
                      <div className="desktop-window-body">
                        {alert && activeApp === appId && (
                          <div className="notice warning" role="alert">{alert}</div>
                        )}
                        {context && <MiniApps app={appId} ctx={context} />}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          )}
        </AnimatePresence>
      </main>

      {!profile && <footer className="site-footer"><span><HandHeart size={17} /> Relief Claim Assist</span><Link href="/docs">API documentation <ArrowUpRight size={15} /></Link></footer>}
      {/* Minimized windows tray: one chip per minimized window; clicking restores it. */}
      {profile && minimizedApps.some(id => openApps.includes(id)) && (
        <nav className="minimized-tray" aria-label="Minimized windows">
          {openApps.filter(id => minimizedApps.includes(id)).map(appId => {
            const meta = apps[appId];
            const TrayIcon = meta.icon;
            return (
              <button key={appId} type="button" className="minimized-chip" aria-label={"Restore " + meta.title + " window"}
                onClick={() => openAppWindow(appId)}>
                <span className={"window-mini-icon " + meta.color} aria-hidden="true"><TrayIcon size={14} /></span>
                <span className="minimized-chip-label">{meta.title}</span>
              </button>
            );
          })}
        </nav>
      )}

      {profile && <div className="bottom-shell">
        <VoiceDock key={profile.id + reset} profile={profile} citizenId={citizen} offline={offline} lite={lite} transcript={transcript} onAction={dispatch}
          onQueueAudio={(audio, locale) => enqueue("transcribe", { locale }, { audio })} />
      </div>}

      {chooser && profile && <div className="modal-scrim" onClick={() => setChooser(false)}>
        <section role="dialog" aria-modal="true" aria-label="Switch demo persona" className="modal" onClick={event => event.stopPropagation()}>
          <div className="modal-head"><div><h2>Switch persona</h2><p>All accounts use synthetic records.</p></div><button className="icon-button" onClick={() => setChooser(false)} aria-label="Close persona chooser"><X size={22} /></button></div>
          {headMessage && <p role="status" className="notice">{headMessage}</p>}
          <PersonaList onSelect={signIn} busy={busy} offline={offline} />
          <div className="modal-foot"><button className="secondary" disabled={Boolean(busy) || offline} onClick={signOut}>Sign out</button></div>
        </section>
      </div>}

      {/* Pip Login Screen (Companion Robot & LED Matrix Interactive Loop) */}
      <PipLoginModal
        isOpen={showAuthModal || isLocked}
        onClose={() => {
          if (!isLocked) setShowAuthModal(false);
        }}
        onSelectPersona={signIn}
        onUserAuthenticated={async () => {
          try {
            const next = await api<Profile>("profile");
            await clearContext();
            setProfile(next);
            setOpenApps([]);
            setActiveApp(null);
            setShowAuthModal(false);
          } catch {
            window.location.reload();
          }
        }}
        busy={busy}
        offline={offline}
        demoFeedback={headMessage}
        demoRegistrationEnabled={demoRegistrationEnabled}
        canDismiss={!isLocked}
      />
    </div>
  );
}

function PersonaList({ onSelect, busy, offline }: { onSelect: (id: Persona) => void; busy: Persona | "signout" | null; offline: boolean }) {
  const colors = ["teal", "blue", "orange", "plum", "teal", "blue"];
  return <div className="persona-grid">{roleEntries.map(([id, details], index) => {
    const initials = details.name.split(" ").map(word => word[0]).slice(0, 2).join("");
    return <button key={id} className="persona-card" onClick={() => onSelect(id)} disabled={Boolean(busy) || offline}>
      <span className={"avatar " + colors[index]}>{initials}</span>
      <span className="persona-copy"><span>{details.role}</span><strong>{details.name}</strong><small>{details.description}</small></span>
      {busy === id ? <LoaderCircle className="spin" size={19} /> : <ArrowUpRight size={18} />}
    </button>;
  })}</div>;
}
