"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, ArrowUpRight, Award, CheckCircle2, Clock, Cloud, CloudOff, Fingerprint, HandHeart, House,
  LoaderCircle, Maximize2, Minimize2, Minus, Radio, ShieldCheck, Trophy, UserRound, Wifi, X } from "lucide-react";
import { canOpen, personas, type Claim, type Family, type MiniApp, type Persona, type Profile } from "@/src/lib/contracts";
import { api, jsonRequest } from "@/src/lib/client";
import { queued, pushMutation, wipeDraft, type Mutation } from "@/src/lib/offline/queue";
import { syncQueue } from "@/src/lib/offline/syncEngine";
import { apps } from "./launcher";
import { MiniApps, type ViewContext } from "./MiniApps";
import { VoiceDock } from "./os/VoiceDock";
import type { UIAction } from "@/src/lib/contracts";

import { AuthModal } from "./auth/AuthModal";

const roleEntries = Object.entries(personas) as [Persona, (typeof personas)[Persona]][];
const tools = Object.keys(apps) as MiniApp[];

export function Workspace({ initialProfile, showLogin = false }: { initialProfile: Profile | null; showLogin?: boolean }) {
  const [showAuthModal, setShowAuthModal] = useState(showLogin || !initialProfile);
  const [profile, setProfile] = useState(initialProfile);
  const [openApps, setOpenApps] = useState<MiniApp[]>([]);
  const [activeApp, setActiveApp] = useState<MiniApp | null>(null);
  const [windowState, setWindowState] = useState<Record<MiniApp, { sizePreset?: "compact" | "default" | "wide" | "max"; maximized?: boolean }>>({} as any);
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
    setActiveApp(appId);
  }

  function closeAppWindow(appId: MiniApp) {
    setOpenApps(prev => prev.filter(id => id !== appId));
    if (activeApp === appId) {
      const remaining = openApps.filter(id => id !== appId);
      setActiveApp(remaining.length > 0 ? remaining[remaining.length - 1] : null);
    }
  }

  function setAppSizePreset(appId: MiniApp, preset: "compact" | "default" | "wide" | "max") {
    setWindowState(prev => ({
      ...prev,
      [appId]: {
        ...prev[appId],
        sizePreset: preset,
        maximized: preset === "max"
      }
    }));
  }

  function toggleMaximize(appId: MiniApp) {
    setWindowState(prev => {
      const currentlyMax = prev[appId]?.maximized || prev[appId]?.sizePreset === "max";
      return {
        ...prev,
        [appId]: {
          ...prev[appId],
          maximized: !currentlyMax,
          sizePreset: currentlyMax ? "default" : "max"
        }
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
    setPending([]);
    setOpenApps([]);
    setActiveApp(null);
  }

  async function signIn(persona: Persona) {
    if (offline || busy) return;
    setBusy(persona);
    setHeadMessage("");
    try {
      await jsonRequest("/api/auth/demo", { persona });
      const next = await api<Profile>("profile");
      await clearContext();
      setProfile(next);
      setOpenApps([]);
      setActiveApp(null);
      setChooser(false);
      setShowAuthModal(false);
    } catch (error) {
      setHeadMessage(error instanceof Error ? error.message : "Could not sign in.");
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

  const status = offline ? "Offline" : "Online";
  const failed = pending.find(item => item.failure);
  const context: ViewContext | null = profile ? {
    profile, citizen, offline, version, enqueue, selectFamily, prefill, stepNav, voiceLang: profile.locale,
    go: changeApp, refresh: () => setVersion(current => current + 1), lite,
  } : null;

  return (
    <div className={lite ? "workspace lite" : "workspace"}>
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
          <button className="macos-menu-item" onClick={() => changeApp("claim")}>Claims</button>
          <button className="macos-menu-item" onClick={() => changeApp("policy")}>Rules</button>
          <button className="macos-menu-item" onClick={() => changeApp("privacy")}>Privacy</button>
          <button className="macos-menu-item" onClick={() => changeApp("audit")}>Audit</button>
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
            {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </header>

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
                  <h1>Fatima Bibi</h1>
                  <p>Emergency Cash Assistance</p>
                </div>

                {/* Right Side Widgets: Status Progress Card + Recent Claim Preview Card */}
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
                  return (
                    <motion.button
                      className={"ios-desktop-app" + (isRunning ? " running" : "")}
                      key={id}
                      onClick={() => openAppWindow(id)}
                      whileHover={motionDisabled ? undefined : { y: -6, scale: 1.05 }}
                      whileTap={motionDisabled ? undefined : { scale: 0.94 }}
                      transition={{ type: "spring", stiffness: 260, damping: 20, mass: 0.8 }}
                    >
                      <div className={"ios-desktop-icon " + item.color}>
                        <Icon size={34} strokeWidth={2.1} />
                      </div>
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
                  const isFocused = activeApp === appId;
                  const state = windowState[appId] || {};
                  const preset = state.sizePreset || "default";
                  const isMaximized = Boolean(state.maximized || preset === "max");
                  const Icon = appMeta.icon;

                  // Stagger initial positions for overlapping feel
                  const offset = (index % 5) * 28;

                  return (
                    <motion.div
                      key={appId}
                      drag={!isMaximized}
                      dragConstraints={desktopBoundsRef}
                      dragElastic={0.05}
                      dragMomentum={false}
                      initial={{ scale: 0.92, opacity: 0, y: 20 }}
                      animate={{ scale: 1, opacity: 1, y: 0 }}
                      exit={{ scale: 0.88, opacity: 0 }}
                      style={{
                        zIndex: isFocused ? 20 : 10 + index,
                        top: isMaximized ? "8px" : `calc(20px + ${offset}px)`,
                        left: isMaximized ? "8px" : `calc(max(20px, 50% - 440px) + ${offset}px)`,
                      }}
                      className={"desktop-window preset-" + preset + (isMaximized ? " maximized " : " ") + (isFocused ? "focused " : "")}
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
                          >
                            <X size={8} strokeWidth={3} />
                          </button>
                          <button
                            type="button"
                            className="traffic-light minimize"
                            onClick={e => { e.stopPropagation(); setActiveApp(null); }}
                            title="Minimize"
                          >
                            <Minus size={8} strokeWidth={3} />
                          </button>
                          <button
                            type="button"
                            className="traffic-light maximize"
                            onClick={e => { e.stopPropagation(); toggleMaximize(appId); }}
                            title={isMaximized ? "Restore window" : "Maximize window"}
                          >
                            {isMaximized ? <Minimize2 size={8} strokeWidth={3} /> : <Maximize2 size={8} strokeWidth={3} />}
                          </button>
                        </div>

                        <div className="window-title-group">
                          <span className={"window-mini-icon " + appMeta.color}>
                            <Icon size={14} />
                          </span>
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

                          <button
                            type="button"
                            className="window-close-action-btn"
                            onClick={e => { e.stopPropagation(); closeAppWindow(appId); }}
                            title="Close app"
                            aria-label="Close app"
                          >
                            <X size={14} />
                          </button>
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

      {/* Spotify-Style Signup/Login Screen */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onSelectPersona={signIn}
        busy={busy}
        offline={offline}
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
