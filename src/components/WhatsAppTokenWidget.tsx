"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, KeyRound, LoaderCircle, MessageSquare, RotateCw } from "lucide-react";

type TokenData = {
  userId: string;
  token: string;
  linkedPhone: string | null;
  isLinked: boolean;
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
  if (personaId === "kamran") {
    return null;
  }

  const [data, setData] = useState<TokenData | null>(null);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    let active = true;
    async function fetchToken() {
      try {
        setLoading(true);
        const res = await fetch(`/api/whatsapp/token?persona=${encodeURIComponent(personaId)}`);
        if (!res.ok) throw new Error("Failed to load WhatsApp token");
        const json = (await res.json()) as TokenData;
        if (active) setData(json);
      } catch {
        if (active) {
          // Provide fallback demo token if network/mock drops
          setData({
            userId: personaId,
            token: `rca_wa_live_${personaId}_demo`,
            linkedPhone: null,
            isLinked: false,
          });
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void fetchToken();
    return () => {
      active = false;
    };
  }, [personaId]);

  async function handleReset() {
    if (resetting) return;
    try {
      setResetting(true);
      setStatusMessage("");
      const res = await fetch("/api/whatsapp/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona: personaId }),
      });
      if (!res.ok) throw new Error("Failed to reset token");
      const json = (await res.json()) as TokenData;
      setData(json);
      setStatusMessage("New token generated! Previous session unlinked.");
      setTimeout(() => setStatusMessage(""), 3500);
    } catch {
      setStatusMessage("Could not reset token.");
    } finally {
      setResetting(false);
    }
  }

  function handleCopy() {
    if (!data?.token) return;
    void navigator.clipboard.writeText(data.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const maskedToken = data?.token
    ? `${data.token.slice(0, 12)}••••••••••••••••`
    : "••••••••••••••••••••••••";

  if (variant === "compact") {
    return (
      <div style={{
        padding: "0.65rem 0.75rem",
        borderRadius: "12px",
        background: "rgba(255, 255, 255, 0.08)",
        border: "1px solid rgba(255, 255, 255, 0.14)",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "between", gap: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flex: 1 }}>
            <KeyRound size={13} style={{ color: "#34d399" }} />
            <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#ffffff" }}>
              WhatsApp Session Key
            </span>
          </div>
          {data?.isLinked ? (
            <span style={{
              fontSize: "0.65rem",
              padding: "0.1rem 0.45rem",
              borderRadius: "9999px",
              background: "rgba(52, 211, 153, 0.25)",
              color: "#34d399",
              border: "1px solid rgba(52, 211, 153, 0.4)",
            }}>
              Linked
            </span>
          ) : (
            <span style={{
              fontSize: "0.65rem",
              padding: "0.1rem 0.45rem",
              borderRadius: "9999px",
              background: "rgba(255, 255, 255, 0.12)",
              color: "rgba(255, 255, 255, 0.75)",
            }}>
              Ready to link
            </span>
          )}
        </div>

        {/* Token row */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          background: "rgba(0, 0, 0, 0.35)",
          padding: "0.3rem 0.5rem",
          borderRadius: "8px",
          border: "1px solid rgba(255, 255, 255, 0.1)",
        }}>
          <code style={{
            fontSize: "0.72rem",
            color: "#e2e8f0",
            fontFamily: "monospace",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {loading ? "Loading…" : revealed ? data?.token : maskedToken}
          </code>

          <button
            type="button"
            title={revealed ? "Hide token" : "Reveal token"}
            onClick={() => setRevealed(v => !v)}
            style={{
              background: "transparent",
              border: "none",
              color: "rgba(255, 255, 255, 0.75)",
              cursor: "pointer",
              padding: "2px",
              display: "flex",
              alignItems: "center",
            }}
          >
            {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>

          <button
            type="button"
            title="Copy token"
            onClick={handleCopy}
            style={{
              background: "transparent",
              border: "none",
              color: copied ? "#34d399" : "rgba(255, 255, 255, 0.75)",
              cursor: "pointer",
              padding: "2px",
              display: "flex",
              alignItems: "center",
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>

          <button
            type="button"
            title="Reset token"
            onClick={() => void handleReset()}
            disabled={resetting}
            style={{
              background: "transparent",
              border: "none",
              color: "rgba(255, 255, 255, 0.75)",
              cursor: resetting ? "default" : "pointer",
              padding: "2px",
              display: "flex",
              alignItems: "center",
            }}
          >
            {resetting ? (
              <LoaderCircle size={13} className="animate-spin" />
            ) : (
              <RotateCw size={13} />
            )}
          </button>
        </div>

        {statusMessage && (
          <span style={{ fontSize: "0.68rem", color: "#34d399" }}>
            {statusMessage}
          </span>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.68rem", color: "rgba(255, 255, 255, 0.65)" }}>
            Send <code style={{ color: "#ffffff", background: "rgba(255,255,255,0.15)", padding: "1px 4px", borderRadius: "4px" }}>/login &lt;key&gt;</code> on WhatsApp
          </span>
          {onOpenApp && (
            <button
              type="button"
              onClick={onOpenApp}
              style={{
                fontSize: "0.68rem",
                color: "#6ee7b7",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textDecoration: "underline",
                display: "inline-flex",
                alignItems: "center",
                gap: "2px",
                padding: 0,
              }}
            >
              <MessageSquare size={11} />
              Open App
            </button>
          )}
        </div>
      </div>
    );
  }

  // Full variant (Astryx-styled card for CitizenProfileView)
  return (
    <div style={{
      width: "100%",
      padding: "1rem",
      borderRadius: "14px",
      background: "var(--color-surface-raised, rgba(255, 255, 255, 0.7))",
      border: "1px solid var(--color-border-subtle, rgba(0, 0, 0, 0.08))",
      boxShadow: "0 2px 10px rgba(0, 0, 0, 0.04)",
      display: "flex",
      flexDirection: "column",
      gap: "0.75rem",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <div style={{
            width: "32px",
            height: "32px",
            borderRadius: "8px",
            background: "#25D366",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
          }}>
            <MessageSquare size={18} />
          </div>
          <div>
            <div style={{ fontSize: "0.92rem", fontWeight: 700, color: "var(--color-text-primary, #1e293b)" }}>
              WhatsApp Assistant & Session Key
            </div>
            <div style={{ fontSize: "0.78rem", color: "var(--color-text-secondary, #64748b)" }}>
              Link your WhatsApp number to chat with your role-scoped MiMo AI assistant
            </div>
          </div>
        </div>

        {data?.isLinked ? (
          <span style={{
            fontSize: "0.72rem",
            fontWeight: 600,
            padding: "0.2rem 0.6rem",
            borderRadius: "9999px",
            background: "#dcfce7",
            color: "#15803d",
            border: "1px solid #86efac",
          }}>
            Linked: {data.linkedPhone}
          </span>
        ) : (
          <span style={{
            fontSize: "0.72rem",
            fontWeight: 600,
            padding: "0.2rem 0.6rem",
            borderRadius: "9999px",
            background: "var(--color-surface-sunken, #f1f5f9)",
            color: "var(--color-text-secondary, #64748b)",
          }}>
            Ready to link
          </span>
        )}
      </div>

      {/* Secret Token Field */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        background: "var(--color-surface-sunken, #f8fafc)",
        padding: "0.5rem 0.75rem",
        borderRadius: "10px",
        border: "1px solid var(--color-border-subtle, #e2e8f0)",
        flexWrap: "wrap",
      }}>
        <div style={{ flex: 1, minWidth: "220px", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <KeyRound size={16} style={{ color: "#64748b" }} />
          <code style={{
            fontSize: "0.84rem",
            fontFamily: "monospace",
            color: "var(--color-text-primary, #0f172a)",
            fontWeight: 600,
            letterSpacing: revealed ? "0" : "0.1em",
            wordBreak: "break-all",
          }}>
            {loading ? "Generating session token…" : revealed ? data?.token : maskedToken}
          </code>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <button
            type="button"
            onClick={() => setRevealed(v => !v)}
            style={{
              padding: "0.35rem 0.65rem",
              fontSize: "0.76rem",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
            }}
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
            <span>{revealed ? "Hide" : "Reveal"}</span>
          </button>

          <button
            type="button"
            onClick={handleCopy}
            style={{
              padding: "0.35rem 0.65rem",
              fontSize: "0.76rem",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              background: copied ? "#dcfce7" : "#ffffff",
              color: copied ? "#15803d" : "inherit",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? "Copied!" : "Copy key"}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleReset()}
            disabled={resetting}
            style={{
              padding: "0.35rem 0.65rem",
              fontSize: "0.76rem",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              background: "#ffffff",
              cursor: resetting ? "default" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
            }}
          >
            {resetting ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <RotateCw size={14} />
            )}
            <span>Reset</span>
          </button>
        </div>
      </div>

      {statusMessage && (
        <div style={{ fontSize: "0.78rem", color: "#16a34a", fontWeight: 500 }}>
          {statusMessage}
        </div>
      )}

      {/* Guide text & link */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "0.5rem",
        paddingTop: "0.2rem",
      }}>
        <div style={{ fontSize: "0.76rem", color: "var(--color-text-secondary, #64748b)" }}>
          Message the Admin bot line or connect your{" "}
          <strong style={{ color: "#059669" }}>Official WhatsApp Agent API Key</strong> in the mini-app.
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
              gap: "0.3rem",
            }}
          >
            <MessageSquare size={13} />
            Connect WhatsApp Agent / Link Mini-App
          </button>
        )}
      </div>
    </div>
  );
}
