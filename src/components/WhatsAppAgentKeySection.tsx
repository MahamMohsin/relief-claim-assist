"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  LoaderCircle,
  MessageSquare,
  Mic,
  Power,
  Send,
  Sparkles,
  Volume2,
} from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { HStack } from "@astryxdesign/core/HStack";
import { VStack } from "@astryxdesign/core/VStack";

type AgentKeyInfo = {
  personaId: string;
  isConfigured: boolean;
  maskedKey: string | null;
  agentName: string | null;
  connectedAt: string | null;
  lastActiveAt: string | null;
};

export type WhatsAppKeyBridge = {
  getInfo: () => { configured: boolean; agentName: string | null; maskedKey: string | null };
  setApiKey: (key: string, agentName?: string) => Promise<void>;
  disconnect: () => Promise<void>;
  sendTestMessage: (text: string) => Promise<void>;
};

export function WhatsAppAgentKeySection({
  personaId,
  userName,
  roleTitle,
  bridgeRef,
}: {
  personaId: string;
  userName?: string;
  roleTitle: string;
  bridgeRef?: React.MutableRefObject<WhatsAppKeyBridge | null>;
}) {
  const [info, setInfo] = useState<AgentKeyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [agentNameInput, setAgentNameInput] = useState("Ali");
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  // Test Simulator
  const [testText, setTestText] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testReplies, setTestReplies] = useState<
    Array<{ sender: "user" | "agent"; text: string; time: string; isVoice?: boolean; audioUrl?: string }>
  >([]);

  useEffect(() => {
    // Immediately reset state on persona change so switching Fatima -> Tariq -> Zainab never flashes stale keys or chat
    let active = true;
    setInfo(null);
    setApiKeyInput("");
    setAgentNameInput("Ali");
    setTestReplies([]);
    setNotice("");
    setError("");
    setLoading(true);

    async function loadKeyInfo() {
      try {
        const res = await fetch("/api/whatsapp/agent-key", { cache: "no-store" });
        if (res.ok && active) {
          const json = (await res.json()) as AgentKeyInfo;
          setInfo(json);
          if (json.agentName) setAgentNameInput(json.agentName);
        }
      } catch {
        // Ignored
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadKeyInfo();
    return () => {
      active = false;
    };
  }, [personaId]);

  async function handleConnect(overrideKey?: string, overrideAgentName?: string) {
    const key = (overrideKey ?? apiKeyInput).trim();
    const chosenName = (overrideAgentName ?? agentNameInput).trim() || "Ali";
    if (!key) {
      setError("Please paste your WhatsApp Agent API key.");
      return;
    }
    if (overrideKey !== undefined) setApiKeyInput(key);
    if (overrideAgentName !== undefined) setAgentNameInput(chosenName);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/whatsapp/agent-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "connect",
          apiKey: key,
          agentName: chosenName,
          persona: personaId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to connect WhatsApp Agent API key.");
      }

      setInfo({
        personaId,
        isConfigured: true,
        maskedKey: data.maskedKey,
        agentName: data.agentName || chosenName,
        connectedAt: data.connectedAt || new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
      });
      setApiKeyInput("");
      setNotice("WhatsApp Agent successfully connected! Open WhatsApp on your phone and start chatting with your agent.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect API key.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/whatsapp/agent-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "disconnect",
          persona: personaId,
        }),
      });
      if (!res.ok) throw new Error("Failed to disconnect API key.");
      setInfo({
        personaId,
        isConfigured: false,
        maskedKey: null,
        agentName: null,
        connectedAt: null,
        lastActiveAt: null,
      });
      setNotice("WhatsApp Agent disconnected. API key removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSendTestMessage(overrideText?: string, isVoice = false) {
    const text = (overrideText ?? testText).trim();
    if (!text || testBusy) return;
    setTestBusy(true);
    setTestText("");

    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    setTestReplies(prev => [...prev, { sender: "user", text, time: now, isVoice }]);

    try {
      const res = await fetch("/api/whatsapp/agent-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test_chat",
          text,
          isVoice,
        }),
      });
      const data = await res.json();
      const audioUrl = data.audioBase64 ? `data:audio/mp3;base64,${data.audioBase64}` : undefined;
      setTestReplies(prev => [
        ...prev,
        {
          sender: "agent",
          text: data.reply || data.error || "Agent responded successfully.",
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          isVoice: Boolean(audioUrl),
          audioUrl,
        },
      ]);
    } catch {
      setTestReplies(prev => [
        ...prev,
        {
          sender: "agent",
          text: "⚠️ Test connection error.",
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
      ]);
    } finally {
      setTestBusy(false);
    }
  }

  const isConnected = Boolean(info?.isConfigured);

  const infoRef = useRef(info);
  infoRef.current = info;
  const connectRef = useRef(handleConnect);
  connectRef.current = handleConnect;
  const disconnectRef = useRef(handleDisconnect);
  disconnectRef.current = handleDisconnect;
  const testRef = useRef(handleSendTestMessage);
  testRef.current = handleSendTestMessage;

  useEffect(() => {
    if (!bridgeRef) return;
    bridgeRef.current = {
      getInfo: () => ({
        configured: Boolean(infoRef.current?.isConfigured),
        agentName: infoRef.current?.agentName ?? null,
        maskedKey: infoRef.current?.maskedKey ?? null,
      }),
      setApiKey: async (key, agentName) => {
        await connectRef.current(key, agentName);
      },
      disconnect: async () => {
        await disconnectRef.current();
      },
      sendTestMessage: async text => {
        await testRef.current(text);
      },
    };
    return () => {
      bridgeRef.current = null;
    };
  }, [bridgeRef]);

  return (
    <div style={{
      background: isConnected ? "rgba(37, 211, 102, 0.06)" : "#f8fafc",
      border: `1px solid ${isConnected ? "rgba(37, 211, 102, 0.35)" : "#e2e8f0"}`,
      borderRadius: "16px",
      padding: "1.25rem",
      width: "100%",
    }}>
      <VStack gap={3}>
        {notice && <Banner status="success" title={notice} />}
        {error && <Banner status="error" title={error} />}

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <div style={{
              width: "34px",
              height: "34px",
              borderRadius: "10px",
              background: isConnected ? "#25D366" : "#0284c7",
              color: "#fff",
              display: "grid",
              placeItems: "center",
            }}>
              <Bot size={20} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <strong style={{ fontSize: "0.98rem", color: "#0f172a" }}>
                  Official WhatsApp Agent Platform
                </strong>
                <span style={{ fontSize: "0.68rem", background: "#e0e7ff", color: "#3730a3", padding: "1px 6px", borderRadius: "9999px", fontWeight: 600 }}>
                  Meta 3P Agent
                </span>
              </div>
              <small style={{ color: "#64748b", fontSize: "0.76rem" }}>
                Dedicated private agent for <strong>{userName || "your account"}</strong> ({roleTitle}) — completely separate from other users.
              </small>
            </div>
          </div>

          <Badge
            label={isConnected ? "Agent Active" : "Key Not Set"}
            variant={isConnected ? "success" : "neutral"}
          />
        </div>

        {/* Connected Card */}
        {isConnected ? (
          <div style={{
            background: "#ffffff",
            border: "1px solid #bbf7d0",
            borderRadius: "12px",
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
                <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "#dcfce7", color: "#15803d", display: "grid", placeItems: "center" }}>
                  <CheckCircle2 size={20} />
                </div>
                <div>
                  <div style={{ fontSize: "0.72rem", color: "#64748b", textTransform: "uppercase", fontWeight: 600 }}>
                    Linked WhatsApp Agent
                  </div>
                  <strong style={{ fontSize: "1.05rem", color: "#0f172a" }}>
                    {info?.agentName || "Ali"} (Agent)
                  </strong>
                  <div style={{ fontSize: "0.75rem", color: "#059669" }}>
                    API Key: <code>{info?.maskedKey}</code>
                  </div>
                </div>
              </div>

              <button
                type="button"
                data-cua="whatsapp-disconnect-btn"
                disabled={busy}
                onClick={() => void handleDisconnect()}
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
                <Power size={13} />
                <span>Disconnect Key</span>
              </button>
            </div>

            <div style={{
              background: "#f0fdf4",
              border: "1px solid #dcfce7",
              borderRadius: "8px",
              padding: "0.65rem 0.85rem",
              fontSize: "0.8rem",
              color: "#166534",
            }}>
              ✅ <strong>Active &amp; Ready in WhatsApp:</strong> Open WhatsApp on your phone and start chatting with <strong>{info?.agentName || "Ali"}</strong>.
              Your messages are answered automatically by MiMo using your <strong>{roleTitle}</strong> tools.
              <div style={{ marginTop: "0.3rem", display: "flex", alignItems: "center", gap: "6px", fontSize: "0.76rem", color: "#047857" }}>
                <span>🎙️ <strong>Bidirectional Voice Notes:</strong> Send voice messages in English or Urdu — {info?.agentName || "Ali"} listens via Deepgram Nova-3 and replies with Cartesia voice notes.</span>
              </div>
            </div>
          </div>
        ) : (
          /* Setup Form When Key Not Connected */
          <div style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "12px",
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.85rem",
          }}>
            {/* 3 Simple Steps */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.65rem" }}>
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "0.65rem" }}>
                <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#25D366" }}>STEP 1</span>
                <div style={{ fontWeight: 600, fontSize: "0.82rem", color: "#1e293b", marginTop: "2px" }}>
                  Create Agent in WhatsApp
                </div>
                <small style={{ color: "#64748b", fontSize: "0.72rem", display: "block" }}>
                  WhatsApp &gt; Settings &gt; Agents &gt; Create an agent (e.g. name it <em>Ali</em>).
                </small>
              </div>

              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "0.65rem" }}>
                <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#25D366" }}>STEP 2</span>
                <div style={{ fontWeight: 600, fontSize: "0.82rem", color: "#1e293b", marginTop: "2px" }}>
                  Copy Agent API Key
                </div>
                <small style={{ color: "#64748b", fontSize: "0.72rem", display: "block" }}>
                  Open agent chat &gt; Chat info &gt; API key &gt; <strong>Copy key</strong>.
                </small>
              </div>

              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "0.65rem" }}>
                <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#25D366" }}>STEP 3</span>
                <div style={{ fontWeight: 600, fontSize: "0.82rem", color: "#1e293b", marginTop: "2px" }}>
                  Connect Below
                </div>
                <small style={{ color: "#64748b", fontSize: "0.72rem", display: "block" }}>
                  Paste key below to bind your WhatsApp agent to Relief Assist.
                </small>
              </div>
            </div>

            {/* Input Row */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.25rem" }}>
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <div style={{ flex: "0 0 140px" }}>
                  <label style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: "3px" }}>
                    Agent Name:
                  </label>
                  <input
                    type="text"
                    value={agentNameInput}
                    onChange={e => setAgentNameInput(e.target.value)}
                    placeholder="Ali"
                    style={{
                      width: "100%",
                      padding: "0.45rem 0.65rem",
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      fontSize: "0.84rem",
                      outline: "none",
                    }}
                  />
                </div>

                <div style={{ flex: 1, minWidth: "220px" }}>
                  <label style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 600, display: "block", marginBottom: "3px" }}>
                    WhatsApp Agent API Key (Bearer Token):
                  </label>
                  <div style={{ display: "flex", alignItems: "center", position: "relative" }}>
                    <input
                      data-cua="whatsapp-key-input"
                      type={revealed ? "text" : "password"}
                      value={apiKeyInput}
                      onChange={e => setApiKeyInput(e.target.value)}
                      placeholder="Paste your copied API key from WhatsApp..."
                      style={{
                        width: "100%",
                        padding: "0.45rem 2rem 0.45rem 0.65rem",
                        borderRadius: "8px",
                        border: "1px solid #cbd5e1",
                        fontSize: "0.84rem",
                        outline: "none",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setRevealed(v => !v)}
                      style={{
                        position: "absolute",
                        right: "6px",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "#94a3b8",
                        padding: "2px",
                      }}
                      title={revealed ? "Hide key" : "Show key"}
                    >
                      {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.25rem" }}>
                <a
                  href="https://faq.whatsapp.com/cxt/?entrypointid=3p-agent-learn-more"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: "0.74rem", color: "#0284c7", display: "inline-flex", alignItems: "center", gap: "3px", textDecoration: "none" }}
                >
                  <HelpCircle size={13} />
                  <span>Learn more about WhatsApp Agents FAQ</span>
                  <ExternalLink size={11} />
                </a>

                <button
                  type="button"
                  disabled={busy || !apiKeyInput.trim()}
                  onClick={() => void handleConnect()}
                  style={{
                    background: "#25D366",
                    color: "#ffffff",
                    border: "none",
                    padding: "0.5rem 1rem",
                    borderRadius: "8px",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    cursor: busy || !apiKeyInput.trim() ? "not-allowed" : "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    boxShadow: "0 2px 8px rgba(37, 211, 102, 0.25)",
                  }}
                >
                  {busy ? <LoaderCircle size={15} className="animate-spin" /> : <KeyRound size={15} />}
                  <span>{busy ? "Validating & Connecting…" : "Connect WhatsApp Agent"}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Live Test Console (Available in card) */}
        {isConnected && (
          <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "0.85rem" }}>
            <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "#334155", marginBottom: "0.4rem", display: "flex", alignItems: "center", gap: "5px" }}>
              <Sparkles size={14} style={{ color: "#25D366" }} />
              <span>Test Chat With {info?.agentName || "Ali"}</span>
            </div>

            {testReplies.length > 0 && (
              <div style={{ maxHeight: "170px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.35rem", marginBottom: "0.5rem", padding: "0.4rem", background: "#f8fafc", borderRadius: "8px" }}>
                {testReplies.map((r, i) => (
                  <div
                    key={i}
                    style={{
                      alignSelf: r.sender === "user" ? "flex-end" : "flex-start",
                      background: r.sender === "user" ? "#dcfce7" : "#ffffff",
                      border: `1px solid ${r.sender === "user" ? "#bbf7d0" : "#e2e8f0"}`,
                      borderRadius: "8px",
                      padding: "0.35rem 0.65rem",
                      fontSize: "0.78rem",
                      maxWidth: "85%",
                    }}
                  >
                    <strong>
                      {r.sender === "user" ? (r.isVoice ? "🎤 You (Voice)" : "You") : (r.isVoice ? `🎙️ ${info?.agentName || "Ali"} (Voice)` : (info?.agentName || "Ali"))}:{" "}
                    </strong>
                    <span>{r.text}</span>
                    {r.audioUrl && (
                      <div style={{ marginTop: "0.3rem" }}>
                        <audio controls src={r.audioUrl} style={{ height: "26px", maxWidth: "230px", display: "block" }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
              <input
                data-cua="whatsapp-test-input"
                type="text"
                value={testText}
                onChange={e => setTestText(e.target.value)}
                placeholder={`Ask ${info?.agentName || "Ali"} about claims, policy, or budget...`}
                onKeyDown={e => { if (e.key === "Enter") void handleSendTestMessage(); }}
                style={{
                  flex: 1,
                  minWidth: "180px",
                  padding: "0.35rem 0.65rem",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "0.8rem",
                  outline: "none",
                }}
              />
              <button
                type="button"
                disabled={testBusy || !testText.trim()}
                onClick={() => void handleSendTestMessage()}
                style={{
                  background: "#25D366",
                  color: "#fff",
                  border: "none",
                  padding: "0.35rem 0.75rem",
                  borderRadius: "6px",
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  cursor: testBusy || !testText.trim() ? "not-allowed" : "pointer",
                }}
              >
                {testBusy ? "Thinking…" : "Test"}
              </button>
              <button
                type="button"
                disabled={testBusy || !testText.trim()}
                onClick={() => void handleSendTestMessage(undefined, true)}
                style={{
                  background: "#0284c7",
                  color: "#fff",
                  border: "none",
                  padding: "0.35rem 0.65rem",
                  borderRadius: "6px",
                  fontSize: "0.78rem",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  cursor: testBusy || !testText.trim() ? "not-allowed" : "pointer",
                }}
                title="Simulate Voice Note (generates Cartesia audio speech reply)"
              >
                <Mic size={13} />
                <span>Voice Test</span>
              </button>
            </div>
          </div>
        )}
      </VStack>
    </div>
  );
}
