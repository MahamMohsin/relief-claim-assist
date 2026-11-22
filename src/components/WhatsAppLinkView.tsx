"use client";

import { useEffect, useState } from "react";
import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Inbox,
  LoaderCircle,
  MessageSquare,
  Phone,
  Power,
  QrCode,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import type { ViewContext } from "./MiniApps";
import { WhatsAppAgentKeySection } from "./WhatsAppAgentKeySection";

type TokenData = {
  userId: string;
  token: string;
  linkedPhone: string | null;
  isLinked: boolean;
};

type ChatMessage = {
  id: string;
  sender: "user" | "bot";
  text: string;
  time: string;
  toolsUsed?: string[];
};

type LiveWhatsAppMessage = {
  id: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string;
  text: string;
  timestamp: string;
  toolsUsed?: string[];
};

type AdminGatewayState = {
  status: "connected" | "qr_ready" | "disconnected";
  adminPhone: string | null;
  botName: string;
  qrDataUrl: string | null;
  activeUsersCount: number;
  connectedAt?: string | null;
};

export function WhatsAppLinkView({ ctx }: { ctx: ViewContext }) {
  const isAdmin = ctx.profile.role === "admin";

  if (isAdmin) {
    return <AdminWhatsAppManagementView ctx={ctx} />;
  }

  return <CitizenWhatsAppLinkView ctx={ctx} />;
}

/**
 * Dedicated Admin View: Device setup, QR pairing, show which number is added, remove device, and messages feed ONLY.
 * No login tokens!
 */
function AdminWhatsAppManagementView({ ctx }: { ctx: ViewContext }) {
  const [adminState, setAdminState] = useState<AdminGatewayState | null>(null);
  const [messages, setMessages] = useState<LiveWhatsAppMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingMsgs, setRefreshingMsgs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Test Simulator inside Admin View
  const [simPhone, setSimPhone] = useState("+92 301 5551234");
  const [simText, setSimText] = useState("");
  const [simBusy, setSimBusy] = useState(false);

  // Fetch admin gateway state and live messages
  async function loadData() {
    try {
      const [adminRes, msgRes] = await Promise.all([
        fetch("/api/whatsapp/admin"),
        fetch("/api/whatsapp/webhook?limit=50"),
      ]);

      if (adminRes.ok) {
        const aJson = (await adminRes.json()) as AdminGatewayState;
        setAdminState(aJson);
        if (aJson.adminPhone && !phoneInput) {
          setPhoneInput(aJson.adminPhone);
        }
      }

      if (msgRes.ok) {
        const mJson = (await msgRes.json()) as { messages: LiveWhatsAppMessage[] };
        setMessages(mJson.messages || []);
      }
    } catch {
      // Ignored
    } finally {
      setLoading(false);
      setRefreshingMsgs(false);
    }
  }

  useEffect(() => {
    void loadData();
    // Auto-poll messages every 3.5 seconds
    const interval = setInterval(() => {
      void loadData();
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  async function handleLinkPhone() {
    const clean = phoneInput.trim();
    if (!clean) {
      setError("Please enter a valid mobile number to pair.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/whatsapp/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "connect", phone: clean }),
      });
      if (!res.ok) throw new Error("Could not pair phone number");
      const updated = (await res.json()) as AdminGatewayState;
      setAdminState(updated);
      setNotice(`Device successfully paired! Active bot line is now ${updated.adminPhone}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link phone");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveDevice() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/whatsapp/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "disconnect" }),
      });
      if (!res.ok) throw new Error("Could not remove device");
      const updated = (await res.json()) as AdminGatewayState;
      setAdminState(updated);
      setPhoneInput("");
      setNotice("Device removed. WhatsApp bot gateway unlinked and reset to pairing mode.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove device");
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshQr() {
    setBusy(true);
    try {
      const res = await fetch("/api/whatsapp/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh_qr" }),
      });
      if (res.ok) {
        const updated = (await res.json()) as AdminGatewayState;
        setAdminState(updated);
        setShowQr(true);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSendSimMessage(text?: string) {
    const msg = (text ?? simText).trim();
    if (!msg || simBusy) return;
    setSimBusy(true);
    setSimText("");
    try {
      await fetch("/api/whatsapp/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: simPhone,
          text: msg,
        }),
      });
      await loadData();
    } finally {
      setSimBusy(false);
    }
  }

  const isConnected = Boolean(adminState?.status === "connected" && adminState?.adminPhone);

  const filteredMessages = messages.filter(m => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.from.toLowerCase().includes(q) ||
      m.to.toLowerCase().includes(q) ||
      m.text.toLowerCase().includes(q)
    );
  });

  return (
    <div className="view-stack" style={{ padding: "0.5rem" }}>
      {notice && <Banner status="success" title={notice} />}
      {error && <Banner status="error" title={error} />}

      <Card padding={6}>
        <VStack gap={4}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%", flexWrap: "wrap", gap: "1rem" }}>
            <VStack gap={1}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <div style={{ background: "#25D366", color: "#fff", padding: "0.45rem", borderRadius: "10px", display: "grid", placeItems: "center" }}>
                  <MessageSquare size={22} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: "1.25rem", color: "#111827" }}>
                    WhatsApp Gateway Admin Center
                  </h2>
                  <p style={{ margin: "2px 0 0", fontSize: "0.82rem", color: "#4b5563" }}>
                    Manage the official WhatsApp bot line, linked devices, and live incoming messages.
                  </p>
                </div>
              </div>
            </VStack>
            <Badge
              label={isConnected ? "Bot Online" : "Pairing Required"}
              variant={isConnected ? "success" : "warning"}
            />
          </div>

          {/* Official WhatsApp Agent Platform (Direct Meta 3P Agent API Key) */}
          <WhatsAppAgentKeySection personaId="kamran" roleTitle="Scheme Administrator" />

          {/* Section 1: Device Setup & Paired Device Management */}
          <div style={{
            background: isConnected ? "rgba(37, 211, 102, 0.08)" : "#f8fafc",
            border: `1px solid ${isConnected ? "rgba(37, 211, 102, 0.35)" : "#e2e8f0"}`,
            borderRadius: "16px",
            padding: "1.25rem",
            width: "100%",
          }}>
            <VStack gap={3}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Smartphone size={18} style={{ color: isConnected ? "#059669" : "#64748b" }} />
                  <strong style={{ fontSize: "0.95rem", color: "#0f172a" }}>
                    {isConnected ? "Linked WhatsApp Device" : "Pair & Add WhatsApp Device"}
                  </strong>
                </div>
                {isConnected && (
                  <span style={{ fontSize: "0.75rem", background: "#dcfce7", color: "#15803d", padding: "2px 8px", borderRadius: "9999px", fontWeight: 600 }}>
                    Multi-Device Baileys Active
                  </span>
                )}
              </div>

              {isConnected ? (
                /* Show which number has it added + Remove Button */
                <VStack gap={2}>
                  <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: "1rem",
                    background: "#ffffff",
                    padding: "0.85rem 1rem",
                    borderRadius: "12px",
                    border: "1px solid #bbf7d0",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                      <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "#25D366", display: "grid", placeItems: "center", color: "#fff" }}>
                        <CheckCircle2 size={20} />
                      </div>
                      <div>
                        <div style={{ fontSize: "0.76rem", color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>
                          Currently Added Number
                        </div>
                        <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "#0f172a" }}>
                          {adminState?.adminPhone}
                        </div>
                        {adminState?.connectedAt && (
                          <div style={{ fontSize: "0.72rem", color: "#059669" }}>
                            Active since {new Date(adminState.connectedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <button
                        type="button"
                        onClick={() => setShowQr(prev => !prev)}
                        style={{
                          background: "#f1f5f9",
                          border: "1px solid #cbd5e1",
                          color: "#334155",
                          padding: "0.45rem 0.75rem",
                          borderRadius: "8px",
                          fontSize: "0.82rem",
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <QrCode size={14} />
                        <span>{showQr ? "Hide QR" : "Show QR Code"}</span>
                      </button>

                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRemoveDevice()}
                        style={{
                          background: "#fee2e2",
                          border: "1px solid #fca5a5",
                          color: "#b91c1c",
                          padding: "0.45rem 0.85rem",
                          borderRadius: "8px",
                          fontSize: "0.82rem",
                          fontWeight: 600,
                          cursor: busy ? "not-allowed" : "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "5px",
                        }}
                      >
                        <Power size={14} />
                        <span>Remove Device</span>
                      </button>
                    </div>
                  </div>

                  {showQr && adminState?.qrDataUrl && (
                    <div style={{ background: "#ffffff", padding: "1rem", borderRadius: "12px", textAlign: "center", border: "1px solid #e2e8f0" }}>
                      <img src={adminState.qrDataUrl} alt="Pairing QR" style={{ width: "160px", height: "160px", margin: "0 auto" }} />
                      <div style={{ fontSize: "0.75rem", color: "#64748b", marginTop: "4px" }}>
                        Linked to {adminState.adminPhone}
                      </div>
                    </div>
                  )}
                </VStack>
              ) : (
                /* Setup to add device: QR Code + Number input */
                <VStack gap={3}>
                  <p style={{ margin: 0, fontSize: "0.84rem", color: "#475569" }}>
                    No device added yet. Connect your WhatsApp phone so citizens can message your relief bot line.
                  </p>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1rem", alignItems: "center" }}>
                    {/* Method 1: Scan QR Code */}
                    <div style={{ background: "#ffffff", padding: "1rem", borderRadius: "12px", border: "1px solid #e2e8f0", textAlign: "center" }}>
                      <strong style={{ fontSize: "0.85rem", color: "#0f172a", display: "block", marginBottom: "0.4rem" }}>
                        Method 1: Scan QR Code
                      </strong>
                      {adminState?.qrDataUrl ? (
                        <img
                          key={adminState.qrDataUrl.slice(-24)}
                          src={adminState.qrDataUrl}
                          alt="Pairing QR Code"
                          style={{ width: "160px", height: "160px", margin: "0 auto", borderRadius: "8px" }}
                        />
                      ) : (
                        <div style={{ height: "160px", display: "grid", placeItems: "center", color: "#94a3b8" }}>
                          <LoaderCircle size={24} className="animate-spin" />
                        </div>
                      )}
                      <small style={{ display: "block", fontSize: "0.72rem", color: "#64748b", marginTop: "0.4rem" }}>
                        WhatsApp &gt; Linked Devices &gt; Link a Device
                      </small>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRefreshQr()}
                        style={{
                          marginTop: "0.4rem",
                          background: "#f1f5f9",
                          border: "1px solid #cbd5e1",
                          color: "#059669",
                          padding: "0.3rem 0.65rem",
                          borderRadius: "6px",
                          fontSize: "0.76rem",
                          fontWeight: 600,
                          cursor: busy ? "not-allowed" : "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "4px",
                        }}
                      >
                        <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
                        <span>{busy ? "Generating…" : "Generate New QR Code"}</span>
                      </button>
                    </div>

                    {/* Method 2: Link Phone Directly */}
                    <div style={{ background: "#ffffff", padding: "1rem", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
                      <strong style={{ fontSize: "0.85rem", color: "#0f172a", display: "block", marginBottom: "0.4rem" }}>
                        Method 2: Link Phone Directly
                      </strong>
                      <p style={{ fontSize: "0.76rem", color: "#64748b", margin: "0 0 0.6rem" }}>
                        If WhatsApp mobile is temporarily rate-limiting QR scans, link your number directly:
                      </p>
                      <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.5rem" }}>
                        <input
                          type="tel"
                          value={phoneInput}
                          onChange={e => setPhoneInput(e.target.value)}
                          placeholder="+92 300 1234567"
                          style={{
                            flex: 1,
                            padding: "0.45rem 0.65rem",
                            borderRadius: "8px",
                            border: "1px solid #cbd5e1",
                            fontSize: "0.84rem",
                            outline: "none",
                          }}
                        />
                        <button
                          type="button"
                          disabled={busy || !phoneInput.trim()}
                          onClick={() => void handleLinkPhone()}
                          style={{
                            background: "#25D366",
                            color: "#ffffff",
                            border: "none",
                            padding: "0.45rem 0.85rem",
                            borderRadius: "8px",
                            fontWeight: 600,
                            fontSize: "0.82rem",
                            cursor: busy || !phoneInput.trim() ? "not-allowed" : "pointer",
                          }}
                        >
                          {busy ? "Linking…" : "Link Device"}
                        </button>
                      </div>
                      <small style={{ fontSize: "0.7rem", color: "#94a3b8" }}>
                        Saves your phone as the active bot number.
                      </small>
                    </div>
                  </div>
                </VStack>
              )}
            </VStack>
          </div>

          {/* Section 2: Messages Only Feed ("msgs only") */}
          <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "16px", padding: "1.25rem", width: "100%" }}>
            <VStack gap={3}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <Inbox size={18} style={{ color: "#0f172a" }} />
                  <strong style={{ fontSize: "0.95rem", color: "#0f172a" }}>
                    Live WhatsApp Messages Feed ({filteredMessages.length})
                  </strong>
                </div>

                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <div style={{ position: "relative" }}>
                    <Search size={14} style={{ position: "absolute", left: "8px", top: "8px", color: "#94a3b8" }} />
                    <input
                      type="text"
                      placeholder="Search messages..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      style={{
                        padding: "0.35rem 0.65rem 0.35rem 1.8rem",
                        borderRadius: "8px",
                        border: "1px solid #cbd5e1",
                        fontSize: "0.78rem",
                        width: "160px",
                        outline: "none",
                      }}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setRefreshingMsgs(true);
                      void loadData();
                    }}
                    style={{
                      background: "#f1f5f9",
                      border: "1px solid #cbd5e1",
                      padding: "0.35rem 0.65rem",
                      borderRadius: "8px",
                      fontSize: "0.78rem",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <RefreshCw size={13} className={refreshingMsgs ? "animate-spin" : ""} />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>

              {/* Message Feed List */}
              <div style={{
                maxHeight: "360px",
                overflowY: "auto",
                border: "1px solid #e2e8f0",
                borderRadius: "12px",
                padding: "0.5rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                background: "#f8fafc",
              }}>
                {filteredMessages.length === 0 ? (
                  <div style={{ padding: "2rem", textAlign: "center", color: "#94a3b8", fontSize: "0.85rem" }}>
                    No messages recorded yet. Messages sent to the bot will appear here in real-time.
                  </div>
                ) : (
                  filteredMessages.map(m => {
                    const isInbound = m.direction === "inbound";
                    return (
                      <div
                        key={m.id}
                        style={{
                          background: isInbound ? "#ffffff" : "#f0fdf4",
                          border: `1px solid ${isInbound ? "#e2e8f0" : "#bbf7d0"}`,
                          borderRadius: "10px",
                          padding: "0.65rem 0.85rem",
                          display: "flex",
                          flexDirection: "column",
                          gap: "0.25rem",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.72rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                            <span style={{
                              fontWeight: 700,
                              fontSize: "0.65rem",
                              padding: "1px 6px",
                              borderRadius: "9999px",
                              background: isInbound ? "#e0f2fe" : "#dcfce7",
                              color: isInbound ? "#0369a1" : "#15803d",
                            }}>
                              {isInbound ? "INBOUND" : "BOT REPLY"}
                            </span>
                            <span style={{ fontWeight: 600, color: "#0f172a" }}>
                              {isInbound ? `From: ${m.from}` : `To: ${m.to}`}
                            </span>
                          </div>
                          <span style={{ color: "#94a3b8" }}>
                            {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </span>
                        </div>

                        <div style={{ fontSize: "0.84rem", color: "#1e293b", whiteSpace: "pre-wrap" }}>
                          {m.text}
                        </div>

                        {m.toolsUsed && m.toolsUsed.length > 0 && (
                          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", marginTop: "2px" }}>
                            {m.toolsUsed.map(t => (
                              <span key={t} style={{ background: "#e0f2fe", color: "#0369a1", fontSize: "0.68rem", padding: "1px 6px", borderRadius: "4px", fontWeight: 600 }}>
                                ⚡ Tool: {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {/* Admin Test Simulator Console */}
              <div style={{ background: "#f1f5f9", padding: "0.75rem", borderRadius: "10px", border: "1px solid #e2e8f0" }}>
                <div style={{ fontSize: "0.76rem", fontWeight: 600, color: "#475569", marginBottom: "0.3rem" }}>
                  Test Send Message to Bot Line:
                </div>
                <div style={{ display: "flex", gap: "0.4rem" }}>
                  <input
                    type="text"
                    value={simText}
                    onChange={e => setSimText(e.target.value)}
                    placeholder="Type a test prompt (e.g. /help, check budget, what is income cap)..."
                    style={{
                      flex: 1,
                      padding: "0.4rem 0.65rem",
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      fontSize: "0.82rem",
                      outline: "none",
                    }}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleSendSimMessage();
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={simBusy || !simText.trim()}
                    onClick={() => void handleSendSimMessage()}
                    style={{
                      background: "#25D366",
                      color: "#fff",
                      border: "none",
                      padding: "0.4rem 0.85rem",
                      borderRadius: "8px",
                      fontSize: "0.82rem",
                      fontWeight: 600,
                      cursor: simBusy || !simText.trim() ? "not-allowed" : "pointer",
                    }}
                  >
                    Send Test
                  </button>
                </div>
              </div>
            </VStack>
          </div>
        </VStack>
      </Card>
    </div>
  );
}

/**
 * Standard Citizen / Worker View: Secret session token, copy button, reset token, and chat simulator.
 */
function CitizenWhatsAppLinkView({ ctx }: { ctx: ViewContext }) {
  const [data, setData] = useState<TokenData | null>(null);
  const [adminBotNumber, setAdminBotNumber] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokenRevealed, setTokenRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Live Simulator State
  const [simPhone, setSimPhone] = useState("+92 301 5551234");
  const [inputMsg, setInputMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      sender: "bot",
      text: "🔒 *Relief Assist WhatsApp Bot*\n\nWelcome! To link your WhatsApp number to your account, please send:\n`/login <your-session-token>`",
      time: "Just now",
    },
  ]);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        setLoading(true);
        const [tokenRes, adminRes] = await Promise.all([
          fetch(`/api/whatsapp/token?persona=${ctx.profile.id}`),
          fetch("/api/whatsapp/admin"),
        ]);
        if (tokenRes.ok) {
          const json = (await tokenRes.json()) as TokenData;
          if (active) setData(json);
        }
        if (adminRes.ok) {
          const adminJson = (await adminRes.json()) as { adminPhone?: string | null };
          if (active && adminJson.adminPhone) setAdminBotNumber(adminJson.adminPhone);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Failed to load session token");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [ctx.profile.id]);

  async function handleResetToken() {
    if (resetting) return;
    try {
      setResetting(true);
      setError("");
      const res = await fetch("/api/whatsapp/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona: ctx.profile.id }),
      });
      if (!res.ok) throw new Error("Failed to reset session token");
      const json = (await res.json()) as TokenData;
      setData(json);
      setNotice("New WhatsApp session token generated. Any previous WhatsApp session has been disconnected.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset token");
    } finally {
      setResetting(false);
    }
  }

  function copyToClipboard(text: string) {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  }

  async function sendSimulatorMessage(textToSend?: string) {
    const text = (textToSend ?? inputMsg).trim();
    if (!text || sending) return;

    const userEntry: ChatMessage = {
      id: crypto.randomUUID(),
      sender: "user",
      text,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };

    setMessages(prev => [...prev, userEntry]);
    setInputMsg("");
    setSending(true);

    try {
      const res = await fetch("/api/whatsapp/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from: simPhone,
          text,
        }),
      });

      if (!res.ok) throw new Error("Simulator webhook error");
      const replyData = (await res.json()) as { reply: string; toolsUsed: string[]; isAuthenticated: boolean };

      const botEntry: ChatMessage = {
        id: crypto.randomUUID(),
        sender: "bot",
        text: replyData.reply,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        toolsUsed: replyData.toolsUsed,
      };

      setMessages(prev => [...prev, botEntry]);
      if (replyData.isAuthenticated && data && !data.isLinked) {
        setData({ ...data, isLinked: true, linkedPhone: simPhone });
      }
    } catch {
      setMessages(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          sender: "bot",
          text: "⚠️ Could not connect to WhatsApp assistant. Please check server logs.",
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  const token = data?.token || "rca_wa_live_demo_token";
  const maskedToken = token.slice(0, 8) + "••••••••••••••••••••••••" + token.slice(-4);
  const roleDisplay = ctx.profile.role === "officer" ? "Reviewer" : ctx.profile.role.charAt(0).toUpperCase() + ctx.profile.role.slice(1);
  const loginCommand = `/login ${token}`;

  return (
    <div className="view-stack" style={{ padding: "0.5rem" }}>
      {notice && <Banner status="success" title={notice} />}
      {error && <Banner status="error" title={error} />}

      <Card padding={6}>
        <VStack gap={4}>
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%", flexWrap: "wrap", gap: "1rem" }}>
            <VStack gap={1}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <div style={{ background: "#25D366", color: "#fff", padding: "0.45rem", borderRadius: "10px", display: "grid", placeItems: "center" }}>
                  <MessageSquare size={20} />
                </div>
                <h2>WhatsApp Assistant Link</h2>
                <Badge label={data?.isLinked ? "Connected" : "Ready to Link"} variant={data?.isLinked ? "success" : "info"} />
              </div>
              <p>Connect your WhatsApp to apply for aid, query policy, or review claims directly from chat.</p>
            </VStack>
          </div>

          {/* Official WhatsApp Agent Platform (Direct Meta 3P Agent API Key) */}
          <WhatsAppAgentKeySection personaId={ctx.profile.id} roleTitle={roleDisplay} />

          {/* Session Token Card */}
          <div style={{ background: "rgba(37, 211, 102, 0.08)", border: "1px solid rgba(37, 211, 102, 0.35)", borderRadius: "16px", padding: "1.25rem", width: "100%" }}>
            <VStack gap={2}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.86rem", fontWeight: 600, color: "#065f46" }}>
                  Your Secret WhatsApp Session Token
                </span>
                <span style={{ fontSize: "0.75rem", color: "#047857" }}>
                  Role Access: <strong>{roleDisplay}</strong>
                </span>
              </div>

              {/* Token Display Box */}
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "#ffffff", border: "1px solid #d1d5db", borderRadius: "10px", padding: "0.55rem 0.85rem", width: "100%" }}>
                <code style={{ flex: 1, fontFamily: "monospace", fontSize: "0.9rem", color: "#111827", letterSpacing: "0.03em" }}>
                  {loading ? "Loading session token…" : tokenRevealed ? token : maskedToken}
                </code>

                <button
                  type="button"
                  onClick={() => setTokenRevealed(v => !v)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#6b7280", padding: "4px" }}
                  title={tokenRevealed ? "Hide token" : "Reveal token"}
                  aria-label={tokenRevealed ? "Hide token" : "Reveal token"}
                >
                  {tokenRevealed ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>

                <button
                  type="button"
                  onClick={() => copyToClipboard(token)}
                  style={{ background: copied ? "#059669" : "#f3f4f6", border: "1px solid #d1d5db", borderRadius: "6px", cursor: "pointer", color: copied ? "#fff" : "#374151", padding: "4px 8px", fontSize: "0.78rem", display: "flex", alignItems: "center", gap: "4px", transition: "all 0.15s" }}
                  title="Copy token"
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copied ? "Copied" : "Copy"}</span>
                </button>
              </div>

              {/* Action Buttons */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem", marginTop: "0.25rem" }}>
                <Button
                  variant="secondary"
                  size="sm"
                  label={resetting ? "Resetting…" : "Reset Session Token"}
                  icon={<RefreshCw size={14} className={resetting ? "spin" : ""} />}
                  isDisabled={resetting || loading}
                  onClick={() => void handleResetToken()}
                />

                {adminBotNumber ? (
                  <a
                    href={`https://wa.me/${adminBotNumber.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(loginCommand)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      background: "#25D366",
                      color: "#ffffff",
                      padding: "0.45rem 0.95rem",
                      borderRadius: "8px",
                      fontWeight: 600,
                      fontSize: "0.85rem",
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      boxShadow: "0 2px 8px rgba(37, 211, 102, 0.35)",
                    }}
                  >
                    <ExternalLink size={15} />
                    <span>Open in WhatsApp ({adminBotNumber})</span>
                  </a>
                ) : (
                  <span style={{ fontSize: "0.78rem", color: "#b45309", background: "#fef3c7", padding: "0.35rem 0.75rem", borderRadius: "8px", border: "1px solid #fde68a" }}>
                    Admin has not yet paired a bot phone via QR code in Admin Dashboard
                  </span>
                )}
              </div>
            </VStack>
          </div>

          {/* Instructions Stepper */}
          <VStack gap={2}>
            <h3 style={{ fontSize: "1rem", color: "#111827", margin: 0 }}>How to link your WhatsApp:</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem" }}>
              <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "0.85rem" }}>
                <div style={{ fontWeight: 700, color: "#25D366", fontSize: "1.1rem", marginBottom: "0.25rem" }}>1</div>
                <strong>Message Official Bot</strong>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.82rem", color: "#4b5563" }}>
                  {adminBotNumber ? (
                    <>Chat with <code>{adminBotNumber}</code></>
                  ) : (
                    <em>Pending Admin QR code pairing</em>
                  )}
                </p>
              </div>

              <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "0.85rem" }}>
                <div style={{ fontWeight: 700, color: "#25D366", fontSize: "1.1rem", marginBottom: "0.25rem" }}>2</div>
                <strong>Send Login Command</strong>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.82rem", color: "#4b5563" }}>
                  Send: <code>/login {"<session-token>"}</code>.
                </p>
              </div>

              <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: "12px", padding: "0.85rem" }}>
                <div style={{ fontWeight: 700, color: "#25D366", fontSize: "1.1rem", marginBottom: "0.25rem" }}>3</div>
                <strong>Instant AI Assistant</strong>
                <p style={{ margin: "0.25rem 0 0", fontSize: "0.82rem", color: "#4b5563" }}>
                  Check claims, submit aid, or review cases directly.
                </p>
              </div>
            </div>
          </VStack>

          {/* Interactive In-App WhatsApp Simulator */}
          <div style={{ background: "#f0f2f5", borderRadius: "18px", border: "1px solid #d1d5db", overflow: "hidden", width: "100%", boxShadow: "0 4px 16px rgba(0,0,0,0.06)" }}>
            {/* Phone Top Header */}
            <div style={{ background: "#075e54", color: "#ffffff", padding: "0.75rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "#25D366", display: "grid", placeItems: "center" }}>
                  <Smartphone size={20} color="#fff" />
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>Relief Assist Bot</div>
                  <div style={{ fontSize: "0.72rem", color: "#c1f0d3" }}>Official WhatsApp Gateway · Online</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "0.75rem", color: "#c1f0d3" }}>Simulated Phone:</span>
                <input
                  type="text"
                  value={simPhone}
                  onChange={e => setSimPhone(e.target.value)}
                  style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", padding: "2px 6px", borderRadius: "4px", fontSize: "0.75rem", width: "125px" }}
                />
              </div>
            </div>

            {/* Quick Action Suggestion Chips */}
            <div style={{ background: "#e1e5ea", padding: "0.4rem 0.75rem", display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
              <small style={{ color: "#4b5563", fontSize: "0.72rem", fontWeight: 600 }}>Quick test:</small>
              <button
                type="button"
                onClick={() => void sendSimulatorMessage(loginCommand)}
                style={{ background: "#fff", border: "1px solid #cbd5e1", borderRadius: "9999px", padding: "2px 8px", fontSize: "0.72rem", cursor: "pointer" }}
              >
                /login {"<my-token>"}
              </button>
              <button
                type="button"
                onClick={() => void sendSimulatorMessage("What is the status of my relief claims?")}
                style={{ background: "#fff", border: "1px solid #cbd5e1", borderRadius: "9999px", padding: "2px 8px", fontSize: "0.72rem", cursor: "pointer" }}
              >
                Check claims
              </button>
              <button
                type="button"
                onClick={() => void sendSimulatorMessage("What is the maximum income cap for emergency cash aid?")}
                style={{ background: "#fff", border: "1px solid #cbd5e1", borderRadius: "9999px", padding: "2px 8px", fontSize: "0.72rem", cursor: "pointer" }}
              >
                Ask policy
              </button>
              <button
                type="button"
                onClick={() => void sendSimulatorMessage("Is this SMS real? You have won 50,000 lottery click http://bit.ly/cash")}
                style={{ background: "#fff", border: "1px solid #cbd5e1", borderRadius: "9999px", padding: "2px 8px", fontSize: "0.72rem", cursor: "pointer" }}
              >
                Check scam
              </button>
            </div>

            {/* Chat Messages Stage */}
            <div style={{ minHeight: "260px", maxHeight: "380px", overflowY: "auto", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.65rem", background: "#efeae2" }}>
              {messages.map(m => (
                <div
                  key={m.id}
                  style={{
                    alignSelf: m.sender === "user" ? "flex-end" : "flex-start",
                    maxWidth: "85%",
                    background: m.sender === "user" ? "#d9fdd3" : "#ffffff",
                    padding: "0.65rem 0.85rem",
                    borderRadius: "12px",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                    fontSize: "0.85rem",
                    lineHeight: 1.45,
                    whiteSpace: "pre-wrap",
                    color: "#111827",
                  }}
                >
                  <div>{m.text}</div>
                  {m.toolsUsed && m.toolsUsed.length > 0 && (
                    <div style={{ marginTop: "0.35rem", display: "flex", gap: "4px", flexWrap: "wrap" }}>
                      {m.toolsUsed.map(t => (
                        <span key={t} style={{ background: "rgba(6, 78, 59, 0.1)", color: "#065f46", fontSize: "0.68rem", padding: "1px 5px", borderRadius: "4px", fontWeight: 600 }}>
                          ⚡ Tool: {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ textAlign: "right", fontSize: "0.65rem", color: "#6b7280", marginTop: "2px" }}>
                    {m.time}
                  </div>
                </div>
              ))}
              {sending && (
                <div style={{ alignSelf: "flex-start", background: "#ffffff", padding: "0.5rem 0.75rem", borderRadius: "12px", fontSize: "0.8rem", color: "#6b7280", display: "flex", alignItems: "center", gap: "6px" }}>
                  <LoaderCircle size={14} className="spin" />
                  <span>Relief assistant is typing…</span>
                </div>
              )}
            </div>

            {/* Chat Input Bar */}
            <form
              onSubmit={e => { e.preventDefault(); void sendSimulatorMessage(); }}
              style={{ background: "#f0f2f5", padding: "0.65rem", display: "flex", gap: "0.5rem", alignItems: "center", borderTop: "1px solid #d1d5db" }}
            >
              <input
                type="text"
                placeholder="Type a message or /login <token>..."
                value={inputMsg}
                onChange={e => setInputMsg(e.target.value)}
                style={{ flex: 1, padding: "0.55rem 0.85rem", borderRadius: "24px", border: "1px solid #d1d5db", fontSize: "0.85rem", outline: "none" }}
              />
              <button
                type="submit"
                disabled={sending || !inputMsg.trim()}
                style={{
                  background: "#25D366",
                  color: "#fff",
                  border: "none",
                  borderRadius: "50%",
                  width: "38px",
                  height: "38px",
                  display: "grid",
                  placeItems: "center",
                  cursor: sending || !inputMsg.trim() ? "not-allowed" : "pointer",
                  opacity: sending || !inputMsg.trim() ? 0.6 : 1,
                  flexShrink: 0,
                }}
                aria-label="Send WhatsApp message"
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        </VStack>
      </Card>
    </div>
  );
}
