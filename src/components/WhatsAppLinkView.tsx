"use client";

import { useEffect, useState } from "react";
import {
  Bot,
  Inbox,
  MessageSquare,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { Card } from "@astryxdesign/core/Card";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { VStack } from "@astryxdesign/core/VStack";
import type { ViewContext } from "./MiniApps";
import { WhatsAppAgentKeySection } from "./WhatsAppAgentKeySection";

type LiveWhatsAppMessage = {
  id: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string;
  text: string;
  timestamp: string;
  toolsUsed?: string[];
};

export function WhatsAppLinkView({ ctx }: { ctx: ViewContext }) {
  const [messages, setMessages] = useState<LiveWhatsAppMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const roleDisplay =
    ctx.profile.role === "officer"
      ? "Reviewer"
      : ctx.profile.role === "admin"
        ? "Scheme Administrator"
        : ctx.profile.role.charAt(0).toUpperCase() + ctx.profile.role.slice(1);

  async function loadMessages() {
    try {
      const res = await fetch("/api/whatsapp/webhook?limit=50");
      if (res.ok) {
        const json = (await res.json()) as { messages: LiveWhatsAppMessage[] };
        setMessages(json.messages || []);
      }
    } catch {
      // Ignored
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadMessages();
    const interval = setInterval(() => {
      void loadMessages();
    }, 4000);
    return () => clearInterval(interval);
  }, []);

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
                    WhatsApp AI Agent
                  </h2>
                  <p style={{ margin: "2px 0 0", fontSize: "0.82rem", color: "#4b5563" }}>
                    Official Meta WhatsApp Agent Platform · Connect your agent with your API key to chat directly in WhatsApp.
                  </p>
                </div>
              </div>
            </VStack>
            <Badge label={`Role: ${roleDisplay}`} variant="info" />
          </div>

          {/* Official WhatsApp Agent Platform Connection Section */}
          <WhatsAppAgentKeySection personaId={ctx.profile.id} roleTitle={roleDisplay} />

          {/* Live Messages Feed Section */}
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
                      setRefreshing(true);
                      void loadMessages();
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
                    <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
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
                {loading && messages.length === 0 ? (
                  <div style={{ padding: "2rem", textAlign: "center", color: "#94a3b8", fontSize: "0.85rem" }}>
                    Loading message history…
                  </div>
                ) : filteredMessages.length === 0 ? (
                  <div style={{ padding: "2rem", textAlign: "center", color: "#94a3b8", fontSize: "0.85rem" }}>
                    No messages recorded yet. Any message sent to your agent in WhatsApp will appear here in real-time.
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
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.74rem" }}>
                          <span style={{ fontWeight: 600, color: isInbound ? "#0284c7" : "#059669" }}>
                            {isInbound ? `Inbound from ${m.from}` : `Outbound response from ${m.from}`}
                          </span>
                          <span style={{ color: "#94a3b8" }}>
                            {new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </span>
                        </div>
                        <p style={{ margin: "2px 0 0", fontSize: "0.84rem", color: "#1e293b", whiteSpace: "pre-wrap" }}>
                          {m.text}
                        </p>
                        {m.toolsUsed && m.toolsUsed.length > 0 && (
                          <div style={{ display: "flex", gap: "0.3rem", marginTop: "2px", flexWrap: "wrap" }}>
                            {m.toolsUsed.map(t => (
                              <span key={t} style={{ fontSize: "0.68rem", background: "#dcfce7", color: "#166534", padding: "1px 6px", borderRadius: "4px" }}>
                                🛠️ {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </VStack>
          </div>
        </VStack>
      </Card>
    </div>
  );
}
