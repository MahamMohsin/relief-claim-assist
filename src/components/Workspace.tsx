"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, ArrowUpRight, Cloud, CloudOff, Fingerprint, HandHeart, House,
  LoaderCircle, Radio, ShieldCheck, UserRound, Wifi, X } from "lucide-react";
import { canOpen, personas, type Family, type MiniApp, type Persona, type Profile } from "@/src/lib/contracts";
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
  const [alert, setAlert] = useState("");
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
      case "highlight_alert":
        setAlert(action.message);
        break;
    }
  }

  const status = offline ? "Offline" : "Online";
  const failed = pending.find(item => item.failure);
  const context: ViewContext | null = profile ? {
    profile, citizen, offline, version, enqueue, selectFamily, prefill, voiceLang: profile.locale,
    go: changeApp, refresh: () => setVersion(current => current + 1), lite,
  } : null;

  return (
    <div className={lite ? "workspace lite" : "workspace"}>
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
                {/* Clean Top Title */}
                <div style={{ padding: "0.5rem 0.2rem 0" }}>
                  <h1 style={{ fontSize: "clamp(2rem, 4.5vw, 2.75rem)", fontWeight: 800, color: "#ffffff", letterSpacing: "-0.04em", textShadow: "0 2px 14px rgba(0,0,0,0.3)" }}>
                    Fatima Bibi
                  </h1>
                </div>

                {/* Section title */}
                <div className="ios-section-header">
                  <div>
                    <h2>Services & Mini-Apps</h2>
                    <p>Designed for {profile.full_name} ({profile.role})</p>
                  </div>
                  <Link className="ios-docs-link" href="/docs">
                    API Console <ArrowUpRight size={14} />
                  </Link>
                </div>

                {/* Apple iPad-Style App Grid */}
                <div className="ios-app-grid">
                  {available.map(id => {
                    const item = apps[id];
                    const Icon = item.icon;
                    return (
                      <motion.button
                        layoutId={motionDisabled ? undefined : "app-" + id}
                        className="ios-app-card"
                        key={id}
                        onClick={() => changeApp(id)}
                        whileHover={motionDisabled ? undefined : { y: -3, scale: 1.015 }}
                        whileTap={motionDisabled ? undefined : { scale: 0.98 }}
                        transition={{ type: "spring", stiffness: 400, damping: 25 }}
                      >
                        <div className={"ios-icon-squircle " + item.color}>
                          <Icon size={26} strokeWidth={2.1} />
                        </div>
                        <div className="ios-card-body">
                          <div className="ios-card-top">
                            <strong>{item.title}</strong>
                            {item.badge && <span className="ios-badge">{item.badge}</span>}
                          </div>
                          <small>{item.note}</small>
                        </div>
                        <div className="ios-card-arrow">
                          <ArrowRight size={16} />
                        </div>
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
