"use client";

import { useState } from "react";
import { Eye, EyeOff, HandHeart, Mail, Lock, Check } from "lucide-react";
import { personas, type Persona } from "@/src/lib/contracts";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPersona: (persona: Persona) => void;
  busy: Persona | "signout" | null;
  offline: boolean;
}

export function AuthModal({
  isOpen,
  onClose,
  onSelectPersona,
  busy,
  offline,
}: AuthModalProps) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [identifier, setIdentifier] = useState("fatima@relief-demo.example");
  const [password, setPassword] = useState("••••••••••••");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [showQuickPersonas, setShowQuickPersonas] = useState(false);

  if (!isOpen) return null;

  const handlePrimarySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Default demo persona mapped from input or fallback to Fatima
    const personaMatch = (Object.keys(personas) as Persona[]).find(p =>
      identifier.toLowerCase().includes(p)
    ) || "fatima";
    onSelectPersona(personaMatch);
  };

  return (
    <div className="auth-overlay-backdrop" onClick={onClose}>
      <div className="spotify-auth-modal" onClick={e => e.stopPropagation()}>
        {/* Logo & Brand Header */}
        <div className="auth-brand-header">
          <div className="auth-brand-logo">
            <HandHeart size={28} strokeWidth={2.4} />
          </div>
          <span className="auth-brand-name">Relief Assist</span>
        </div>

        {/* Headline */}
        <h2 className="auth-heading">
          {mode === "login" ? "Log in to continue." : "Sign up to start aid."}
        </h2>

        {/* Login / Sign Up Form */}
        <form onSubmit={handlePrimarySubmit} className="auth-form-body">
          <div className="auth-input-group">
            <input
              type="text"
              className="auth-text-input"
              placeholder="Email, CNIC or username"
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              required
            />
            <span className="auth-input-icon">
              <Mail size={18} />
            </span>
          </div>

          <div className="auth-input-group">
            <input
              type={showPassword ? "text" : "password"}
              className="auth-text-input"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="auth-input-icon-btn"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <div className="auth-links-row">
            <button
              type="button"
              className="auth-inline-link"
              onClick={() => setIdentifier("fatima@relief-demo.example")}
            >
              Reset Password
            </button>
          </div>

          {/* Remember me toggle switch */}
          <div className="auth-remember-row">
            <span className="auth-remember-label">Remember me</span>
            <button
              type="button"
              role="switch"
              aria-checked={rememberMe}
              className={"auth-switch-toggle" + (rememberMe ? " on" : "")}
              onClick={() => setRememberMe(!rememberMe)}
            >
              <span className="auth-switch-knob" />
            </button>
          </div>

          {/* Primary Action Button (White Pill) */}
          <button
            type="submit"
            className="auth-primary-btn"
            disabled={Boolean(busy) || offline}
          >
            {busy ? "LOGGING IN..." : mode === "login" ? "LOG IN" : "SIGN UP"}
          </button>
        </form>

        {/* Divider */}
        <div className="auth-divider">
          <span className="auth-divider-line" />
          <span className="auth-divider-text">OR</span>
          <span className="auth-divider-line" />
        </div>

        {/* Social / SSO Buttons */}
        <div className="auth-social-list">
          <button
            type="button"
            className="auth-social-btn"
            onClick={() => onSelectPersona("zainab")}
          >
            <span className="social-icon facebook">f</span>
            <span className="social-text">Continue with Facebook</span>
          </button>

          <button
            type="button"
            className="auth-social-btn"
            onClick={() => onSelectPersona("fatima")}
          >
            <span className="social-icon google">G</span>
            <span className="social-text">Continue with Google</span>
          </button>

          <button
            type="button"
            className="auth-social-btn"
            onClick={() => onSelectPersona("bilal")}
          >
            <span className="social-icon apple"></span>
            <span className="social-text">Continue with Apple</span>
          </button>
        </div>

        {/* Demo Fast Persona Switcher Expandable */}
        <div className="auth-persona-drawer">
          <button
            type="button"
            className="auth-drawer-toggle"
            onClick={() => setShowQuickPersonas(!showQuickPersonas)}
          >
            {showQuickPersonas ? "Hide Demo Personas ▲" : "Switch Instant Demo Persona ▼"}
          </button>

          {showQuickPersonas && (
            <div className="auth-persona-chips">
              {(Object.entries(personas) as [Persona, (typeof personas)[Persona]][]).map(([id, p]) => (
                <button
                  type="button"
                  key={id}
                  className="auth-persona-chip"
                  onClick={() => onSelectPersona(id)}
                  disabled={Boolean(busy) || offline}
                >
                  <strong>{p.name.split(" ")[0]}</strong>
                  <span>({p.role})</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer switch between Login and Signup */}
        <div className="auth-bottom-switch">
          <span>
            {mode === "login" ? "Don't have an account? " : "Already have an account? "}
          </span>
          <button
            type="button"
            className="auth-mode-link"
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
          >
            {mode === "login" ? "SIGNUP" : "LOG IN"}
          </button>
        </div>

        {/* Settings button */}
        <button type="button" className="auth-settings-btn" onClick={onClose}>
          SETTINGS
        </button>
      </div>
    </div>
  );
}
