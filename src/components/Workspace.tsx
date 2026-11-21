"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, ArrowUpRight, Cloud, CloudOff, Fingerprint, HandHeart, House,
  LoaderCircle, Radio, ShieldCheck, UserRound, Wifi, X } from "lucide-react";
import { canOpen, personas, type Claim, type Family, type MiniApp, type Persona, type Profile } from "@/src/lib/contracts";
import { api, jsonRequest } from "@/src/lib/client";
import { queued, pushMutation, wipeDraft, type Mutation } from "@/src/lib/offline/queue";
import { syncQueue } from "@/src/lib/offline/syncEngine";
import { apps } from "./launcher";
import { MiniApps, type ViewContext } from "./MiniApps";
import { VoiceDock } from "./os/VoiceDock";
import type { UIAction } from "@/src/lib/contracts";

const roleEntries = Object.entries(personas) as [Persona, (typeof personas)[Persona]][];
const tools = Object.keys(apps) as MiniApp[];

export function Workspace({ initialProfile, showLogin = false }: { initialProfile: Profile | null; showLogin?: boolean }) {
  const [profile, setProfile] = useState(initialProfile);
  const [selection, setSelection] = useState<MiniApp | null>(null);
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
  const motionDisabled = useReducedMotion() || lite;
  const offline = !browserOnline || !fixtureOnline;
  const citizen = profile?.role === "helper" ? family?.id ?? null : profile?.citizen_id ?? null;
  const scope = citizen ?? "self";
  const owner = profile?.id;
  const current = selection ? apps[selection] : null;
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

  function changeApp(next: MiniApp | null) {
    if (next && (!profile || !canOpen(profile.role, next))) return;
    setAlert("");
    setSelection(next);
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
      setSelection(null);
      setChooser(false);
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
      setSelection(null);
      setChooser(false);
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
    setSelection("claim");
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
          <button className="macos-menu-item" onClick={() => changeApp(null)}>Dashboard</button>
          <button className="macos-menu-item" onClick={() => changeApp("claim")}>Claims</button>
          <button className="macos-menu-item" onClick={() => changeApp("policy")}>Rules</button>
          <button className="macos-menu-item" onClick={() => changeApp("privacy")}>Privacy</button>
          <button className="macos-menu-item" onClick={() => changeApp("audit")}>Audit</button>
        </div>

        <div className="macos-menu-right">
          <span className="macos-status-pill">{offline ? "Offline" : "Online"}</span>
          {profile && (
            <button className="macos-user-btn" onClick={() => setChooser(true)}>
              {profile.full_name.split(" ")[0]}
            </button>
          )}
          <span className="macos-clock">
            {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </header>

      {(headMessage || failed) && <div className="top-notice"><p role="status">{headMessage || failed?.failure}</p><button onClick={() => setHeadMessage("")} aria-label="Dismiss update"><X size={17} /></button></div>}

      <main className="content">
        <LayoutGroup>
          <AnimatePresence mode="wait" initial={false}>
            {!profile ? (
              <motion.div key="welcome" initial={{ opacity: motionDisabled ? 1 : 0 }} animate={{ opacity: 1 }} className="welcome">
                <section className="hero">
                  <div className="hero-art" aria-hidden="true"><i /><i /><i /><span /><span /></div>
                  <div className="hero-content">
                    <div className="hero-label"><span /> EMERGENCY CASH ASSISTANCE</div>
                    <h1>Relief within<br />reach.</h1>
                    <p>Apply for aid, check a payment, or help a family take the next step. Explore the full journey using a synthetic demo persona.</p>
                    <a className="hero-button" href="#personas">Choose a persona <ArrowRight size={18} /></a>
                  </div>
                </section>
                <section id="personas" aria-labelledby="persona-heading">
                  <div className="section-heading"><div><h2 id="persona-heading">Enter the demo</h2><p>Choose a role to open its workspace.</p></div></div>
                  <PersonaList onSelect={signIn} busy={busy} offline={offline} />
                </section>
              </motion.div>
            ) : !selection || !current ? (
              <motion.div key="home" initial={{ opacity: motionDisabled ? 1 : 0 }} animate={{ opacity: 1 }} className="dashboard-canvas">
                {/* Top Row: Fatima Bibi + Compact Preview Tile side-by-side */}
                <div className="ios-top-hero-row">
                  <div className="ios-hero-name">
                    <h1>Fatima Bibi</h1>
                    <p>Emergency Cash Assistance</p>
                  </div>

                  {/* Apple-Style Compact Past Requests Widget (1/3 width preview) */}
                  {canOpen(profile.role, "claim") && (
                    <div className="ios-history-widget compact glass-card" onClick={() => changeApp("claim")} role="button" tabIndex={0}>
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
                  )}
                </div>

                {/* Apple iPad / Desktop App Grid (Icons with names below) */}
                <div className="ios-desktop-grid">
                  {available.map(id => {
                    const item = apps[id];
                    const Icon = item.icon;
                    return (
                      <motion.button
                        layoutId={motionDisabled ? undefined : "app-" + id}
                        className="ios-desktop-app"
                        key={id}
                        onClick={() => changeApp(id)}
                        whileHover={motionDisabled ? undefined : { y: -4, scale: 1.05 }}
                        whileTap={motionDisabled ? undefined : { scale: 0.95 }}
                        transition={{ type: "spring", stiffness: 450, damping: 25 }}
                      >
                        <div className={"ios-desktop-icon " + item.color}>
                          <Icon size={34} strokeWidth={2.1} />
                        </div>
                        <span className="ios-desktop-label">{item.title}</span>
                      </motion.button>
                    );
                  })}
                </div>
              </motion.div>
            ) : (
              <motion.div key={selection + scope} initial={{ opacity: motionDisabled ? 1 : 0, y: motionDisabled ? 0 : 8 }} animate={{ opacity: 1, y: 0 }}>
                <div className="breadcrumbs"><button onClick={() => changeApp(null)}><ArrowLeft size={17} /> All mini-apps</button></div>
                <motion.section layoutId={motionDisabled ? undefined : "app-" + selection} className="mini-top">
                  <span className={"app-icon " + current.color}><current.icon size={29} /></span>
                  <div><h1>{current.title}</h1><p>{current.note}</p></div>
                </motion.section>
                {alert && <div className="notice warning" role="alert">{alert}</div>}
                {context && <MiniApps app={selection} ctx={context} />}
              </motion.div>
            )}
          </AnimatePresence>
        </LayoutGroup>
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
