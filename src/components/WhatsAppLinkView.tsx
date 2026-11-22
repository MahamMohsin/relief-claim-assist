"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, LoaderCircle, MessageSquare, Phone, RefreshCw, Send, ShieldCheck, Smartphone, Sparkles, ExternalLink } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";
import type { ViewContext } from "./MiniApps";

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

export function WhatsAppLinkView({ ctx }: { ctx: ViewContext }) {
  const [data, setData] = useState<TokenData | null>(null);
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
        const res = await fetch(`/api/whatsapp/token?persona=${ctx.profile.id}`);
        if (!res.ok) throw new Error("Could not load WhatsApp token");
        const json = (await res.json()) as TokenData;
        if (active) setData(json);
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
  const adminBotNumber = "+92 300 8765432";
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
                  <span>Open WhatsApp Web / App</span>
                </a>
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
                  Save or open chat with <code>{adminBotNumber}</code>.
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
