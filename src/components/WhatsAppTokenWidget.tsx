"use client";

import { useEffect, useState } from "react";
import { Bot, CheckCircle2, KeyRound, LoaderCircle, MessageSquare } from "lucide-react";

type AgentKeyInfo = {
  personaId: string;
  isConfigured: boolean;
  maskedKey: string | null;
  agentName: string | null;
  connectedAt: string | null;
};

export function WhatsAppTokenWidget({
  personaId,
  variant = "full",
  onOpenApp,
}: {
  personaId: string;
  variant?: "full" | "compact";
  onOpenApp?: () => void;
}) {
  const [data, setData] = useState<AgentKeyInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setData(null);
    async function fetchAgentStatus() {
      try {
        setLoading(true);
        const res = await fetch("/api/whatsapp/agent-key", { cache: "no-store" });
        if (res.ok) {
          const json = (await res.json()) as AgentKeyInfo;
          if (active) setData(json);
        }
      } catch {
        // Ignored
      } finally {
        if (active) setLoading(false);
      }
    }
    void fetchAgentStatus();
    return () => {
      active = false;
    };
  }, [personaId]);

  const isConnected = Boolean(data?.isConfigured);

  if (variant === "compact") {
    return (
      <div style={{
        padding: "0.65rem 0.75rem",
        borderRadius: "12px",
        background: "rgba(255, 255, 255, 0.08)",
        border: `1px solid ${isConnected ? "rgba(52, 211, 153, 0.35)" : "rgba(255, 255, 255, 0.14)"}`,
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flex: 1 }}>
            <Bot size={14} style={{ color: isConnected ? "#34d399" : "#60a5fa" }} />
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#ffffff" }}>
              WhatsApp AI Agent
            </span>
          </div>
          <span style={{
            fontSize: "0.65rem",
            padding: "0.1rem 0.45rem",
            borderRadius: "9999px",
            background: isConnected ? "rgba(52, 211, 153, 0.25)" : "rgba(255, 255, 255, 0.12)",
            color: isConnected ? "#34d399" : "rgba(255, 255, 255, 0.75)",
            border: `1px solid ${isConnected ? "rgba(52, 211, 153, 0.4)" : "rgba(255, 255, 255, 0.18)"}`,
          }}>
            {loading ? "Checking…" : isConnected ? "Active" : "Key Needed"}
          </span>
        </div>

        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.4rem",
          background: "rgba(0, 0, 0, 0.35)",
          padding: "0.4rem 0.6rem",
          borderRadius: "8px",
        }}>
          <div style={{ fontSize: "0.72rem", color: "#e2e8f0" }}>
            {loading ? "Loading…" : isConnected ? (
              <span>Agent: <strong>{data?.agentName || "Ali"}</strong> (Connected)</span>
            ) : (
              <span>No agent API key linked yet</span>
            )}
          </div>
          {onOpenApp && (
            <button
              type="button"
              onClick={onOpenApp}
              style={{
                fontSize: "0.72rem",
                color: "#6ee7b7",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                fontWeight: 600,
                textDecoration: "underline",
                display: "inline-flex",
                alignItems: "center",
                gap: "2px",
                padding: 0,
              }}
            >
              {isConnected ? "Manage" : "Connect"}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Full variant
  return (
    <div style={{
      padding: "1rem",
      borderRadius: "14px",
      background: "var(--color-bg-secondary, #f8fafc)",
      border: `1px solid ${isConnected ? "rgba(37, 211, 102, 0.4)" : "var(--color-border, #e2e8f0)"}`,
      display: "flex",
      flexDirection: "column",
      gap: "0.75rem",
      width: "100%",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div style={{
            width: "28px",
            height: "28px",
            borderRadius: "50%",
            background: isConnected ? "#dcfce7" : "#e0f2fe",
            color: isConnected ? "#15803d" : "#0369a1",
            display: "grid",
            placeItems: "center",
          }}>
            {isConnected ? <CheckCircle2 size={16} /> : <Bot size={16} />}
          </div>
          <div>
            <strong style={{ fontSize: "0.85rem", color: "var(--color-text-primary, #0f172a)" }}>
              WhatsApp AI Agent Platform
            </strong>
            <small style={{ display: "block", fontSize: "0.72rem", color: "var(--color-text-secondary, #64748b)" }}>
              {isConnected
                ? `Connected to ${data?.agentName || "Ali"} · Ready to chat in WhatsApp`
                : "Connect your Agent API key to chat directly from WhatsApp"}
            </small>
          </div>
        </div>

        <span style={{
          fontSize: "0.72rem",
          fontWeight: 600,
          padding: "2px 8px",
          borderRadius: "9999px",
          background: isConnected ? "#dcfce7" : "#f1f5f9",
          color: isConnected ? "#15803d" : "#64748b",
        }}>
          {loading ? "…" : isConnected ? "Online" : "Not Linked"}
        </span>
      </div>

      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "0.5rem",
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: "10px",
        padding: "0.55rem 0.75rem",
      }}>
        <div style={{ fontSize: "0.76rem", color: "#475569" }}>
          {isConnected ? (
            <span>Agent Key: <code>{data?.maskedKey}</code></span>
          ) : (
            <span>WhatsApp &gt; Settings &gt; Agents &gt; API key</span>
          )}
        </div>

        {onOpenApp && (
          <button
            type="button"
            onClick={onOpenApp}
            style={{
              fontSize: "0.78rem",
              color: "#059669",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              textDecoration: "underline",
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: 0,
            }}
          >
            <MessageSquare size={13} />
            <span>{isConnected ? "Open Agent Mini-App" : "Connect Agent API Key"}</span>
          </button>
        )}
      </div>
    </div>
  );
}
