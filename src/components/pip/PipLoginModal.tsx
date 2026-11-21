"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { TEXT } from "./content";
import { createEngine } from "./engine";
import { SCREEN } from "./led";
import { personas, type Persona, type Role } from "@/src/lib/contracts";
import s from "./PipLogin.module.css";

const ARROW =
  "M220.49,207.8,207.8,220.49a12,12,0,0,1-17,0l-56.57-56.57L115,214.08l-.13.33A15.84,15.84,0,0,1,100.26,224l-.78,0a15.82,15.82,0,0,1-14.41-11L32.8,52.92A15.95,15.95,0,0,1,52.92,32.8L213,85.07a16,16,0,0,1,1.41,29.8l-.33.13-50.16,19.27,56.57,56.56A12,12,0,0,1,220.49,207.8Z";

interface PipLoginModalProps {
  isOpen: boolean;
  onClose?: () => void;
  onSelectPersona: (persona: Persona) => void;
  onUserAuthenticated?: () => Promise<void>;
  busy: Persona | "signout" | null;
  offline: boolean;
  canDismiss?: boolean;
}

export function PipLoginModal({
  isOpen,
  onClose,
  onSelectPersona,
  onUserAuthenticated,
  busy,
  offline,
  canDismiss = false,
}: PipLoginModalProps) {
  const stage = useRef<HTMLDivElement>(null);
  const [isSigningUp, setIsSigningUp] = useState(false);
  const [signupFullName, setSignupFullName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupRole, setSignupRole] = useState<Role>("citizen");
  const [signupSubmitting, setSignupSubmitting] = useState(false);
  const [signupFeedback, setSignupFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const root = stage.current;
    if (!root) return;

    const part = <T extends Element = HTMLElement>(name: string) =>
      root.querySelector<T>(`[data-part="${name}"]`)!;
    const parts = (name: string) => [
      ...root.querySelectorAll<HTMLElement>(`[data-part="${name}"]`),
    ];
    const led = part<HTMLCanvasElement>("led").getContext("2d");
    const ledGlow = part<HTMLCanvasElement>("ledGlow").getContext("2d");
    if (!led || !ledGlow) return;

    const [handL, handR] = parts("hand");
    const [b1, b2, b3] = parts("label");
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const e = createEngine(
      root,
      part("scene"),
      {
        cursor: part("cursor"),
        cursorArrow: part<SVGSVGElement>("arrow"),
        pip: part("pip"),
        antenna: part("antenna"),
        glow: part("glow"),
        halo: part("halo"),
        earLights: parts("earLight"),
        led,
        ledGlow,
        hands: [handL, handR],
        emailField: part("emailField"),
        passwordField: part("passwordField"),
        emailValue: part("emailValue"),
        passwordValue: part("passwordValue"),
        emailCaret: part("emailCaret"),
        passwordCaret: part("passwordCaret"),
        error: part("error"),
        button: part("button"),
        labels: [b1, b2, b3],
        spinner: part("spinner"),
        focused: s.focused,
      },
      {
        rec: false,
        reduced: Boolean(reduced),
        onLogin: async (email: string) => {
          // If a registered user or email is entered, sign in via real auth or refresh profile
          try {
            const res = await fetch("/api/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email, password: "demo123456" }),
            });
            if (res.ok && onUserAuthenticated) {
              await onUserAuthenticated();
              return;
            }
          } catch {}

          // Fallback to synthetic personas matching the email or default
          const match = (Object.keys(personas) as Persona[]).find((p) =>
            email.toLowerCase().includes(p)
          ) || "fatima";
          onSelectPersona(match);
        },
      }
    );

    return () => e.dispose();
  }, [isOpen, onSelectPersona, onUserAuthenticated]);

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (signupSubmitting) return;
    setSignupFeedback(null);
    setSignupSubmitting(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: signupFullName,
          email: signupEmail,
          password: signupPassword,
          role: signupRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create account.");

      setSignupFeedback({
        type: "success",
        text: data.message || "Account created successfully!",
      });

      // If approved citizen, sign in or refresh authenticated profile directly
      if (data.user?.status === "active") {
        setTimeout(async () => {
          if (onUserAuthenticated) {
            await onUserAuthenticated();
          } else {
            onSelectPersona("fatima");
          }
        }, 1200);
      }
    } catch (err) {
      setSignupFeedback({
        type: "error",
        text: err instanceof Error ? err.message : "Error creating account",
      });
    } finally {
      setSignupSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const hand = (
    <div className={s.hand} data-part="hand">
      <div className={s.palm} />
      <div className={s.finger} style={{ left: 16 }} />
      <div className={s.finger} style={{ left: 24 }} />
      <div className={s.finger} style={{ left: 32 }} />
    </div>
  );

  return (
    <div
      className={s.pipModalOverlay}
      onClick={(e) => {
        if (canDismiss && onClose) onClose();
      }}
    >
      {canDismiss && onClose && (
        <button
          type="button"
          className={s.closeButton}
          onClick={onClose}
          aria-label="Close login dialog"
        >
          <X size={20} />
        </button>
      )}

      <div
        className={s.stage}
        ref={stage}
        role="dialog"
        aria-modal="true"
        aria-label={TEXT.scene}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.scene} data-part="scene">
          <div className={s.pip} data-part="pip">
            <div className={`${s.ear} ${s.earLeft}`}>
              <i className={s.earSlot} />
              <b className={s.earLight} data-part="earLight" />
            </div>
            <div className={`${s.ear} ${s.earRight}`}>
              <i className={s.earSlot} />
              <b className={s.earLight} data-part="earLight" />
            </div>
            <div className={s.antenna} data-part="antenna">
              <div className={s.stem} />
              <div className={s.halo} data-part="halo" />
              <div className={s.ball} />
              <div className={s.glow} data-part="glow" />
            </div>
            <div className={s.head}>
              <div className={s.spec} />
              <div className={s.bezel} />
              <div className={s.screen}>
                <canvas
                  className={s.ledGlow}
                  data-part="ledGlow"
                  width={SCREEN.w * SCREEN.dpr}
                  height={SCREEN.h * SCREEN.dpr}
                />
                <canvas
                  className={s.led}
                  data-part="led"
                  width={SCREEN.w * SCREEN.dpr}
                  height={SCREEN.h * SCREEN.dpr}
                />
                <div className={s.glass} />
                <div className={s.arc} />
              </div>
            </div>
          </div>

          <div className={s.card}>
            <div className={s.cap}>{TEXT.cap}</div>
            <h1 className={s.title}>{TEXT.title}</h1>
            <div className={`${s.field} ${s.fieldEmail}`} data-part="emailField">
              <span className={s.label}>{TEXT.email}</span>
              <span className={s.value} data-part="emailValue" />
              <span className={s.caret} data-part="emailCaret" />
              <span className={s.error} data-part="error">
                {TEXT.error}
              </span>
            </div>
            <div
              className={`${s.field} ${s.fieldPassword}`}
              data-part="passwordField"
            >
              <span className={s.label}>{TEXT.password}</span>
              <span className={s.dots} data-part="passwordValue" />
              <span className={s.caret} data-part="passwordCaret" />
            </div>
            <div className={s.button} data-part="button">
              <span className={s.buttonLabel} data-part="label">
                {TEXT.signIn}
              </span>
              <span className={s.buttonLabel} data-part="label">
                <i className={s.spinner} data-part="spinner" />
                {TEXT.checking}
              </span>
              <span className={s.buttonLabel} data-part="label">
                {TEXT.welcome}
              </span>
            </div>

            <div className={s.cardModeSwitch}>
              <span>New to Relief Assist?</span>
              <button
                type="button"
                className={s.switchAction}
                onClick={() => {
                  setSignupFeedback(null);
                  setIsSigningUp(true);
                }}
              >
                Sign up
              </button>
            </div>

            {/* Signup Overlay Form */}
            {isSigningUp && (
              <div
                className={s.signupOverlay}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <div className={s.signupHeader}>
                  <h3 className={s.signupTitle}>Create Account</h3>
                  <button
                    type="button"
                    className={s.signupBack}
                    onClick={() => setIsSigningUp(false)}
                  >
                    Back to Sign In
                  </button>
                </div>

                <form onSubmit={handleSignupSubmit} className={s.signupForm}>
                  <input
                    type="text"
                    required
                    className={s.signupInput}
                    placeholder="Full Name"
                    value={signupFullName}
                    onChange={(e) => setSignupFullName(e.target.value)}
                  />
                  <div className={s.signupRow}>
                    <input
                      type="email"
                      required
                      className={s.signupInput}
                      placeholder="Email address"
                      value={signupEmail}
                      onChange={(e) => setSignupEmail(e.target.value)}
                    />
                    <input
                      type="password"
                      required
                      minLength={6}
                      className={s.signupInput}
                      placeholder="Password (min 6)"
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                    />
                  </div>
                  <select
                    className={s.signupSelect}
                    value={signupRole}
                    onChange={(e) => setSignupRole(e.target.value as Role)}
                  >
                    <option value="citizen">Applicant / Citizen</option>
                    <option value="helper">Community Health Worker (Helper)</option>
                    <option value="shopkeeper">Shopkeeper / Merchant</option>
                    <option value="officer">Department Review Officer (Requires Admin Approval)</option>
                    <option value="auditor">Independent Safety Auditor (Requires Admin Approval)</option>
                  </select>

                  <button
                    type="submit"
                    className={s.signupSubmit}
                    disabled={signupSubmitting}
                  >
                    {signupSubmitting ? (
                      <>
                        <LoaderCircle className="spin" size={17} />
                        Creating Account...
                      </>
                    ) : (
                      "Register Account"
                    )}
                  </button>

                  {signupFeedback && (
                    <div
                      className={`${s.signupNotice} ${
                        signupFeedback.type === "error" ? s.error : s.success
                      }`}
                    >
                      {signupFeedback.text.replace(/check your email|confirmation email|email has been sent/gi, "logging you in...")}
                    </div>
                  )}
                </form>
              </div>
            )}
          </div>

          {hand}
          {hand}

          <div className={s.cursor} data-part="cursor">
            <svg
              data-part="arrow"
              width="30"
              height="30"
              viewBox="0 0 256 256"
              fill="currentColor"
            >
              <path
                fill="#151515"
                stroke="#fff"
                strokeWidth="14"
                paintOrder="stroke"
                d={ARROW}
              />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
