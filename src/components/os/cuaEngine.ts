"use client";

import type { MiniApp, Payload, Persona, RuleConfig, UIAction } from "@/src/lib/contracts";
import { apps } from "../launcher";

export type SpotlightRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
};

export type CursorState = {
  visible: boolean;
  x: number;
  y: number;
  clicking: boolean;
  ripple: { id: number; x: number; y: number } | null;
  label: string;
  tone: "active" | "typing" | "done";
  spotlight: SpotlightRect | null;
};

export type ScreenContextSnapshot = {
  activeApp: MiniApp | null;
  openApps: MiniApp[];
  persona?: {
    id: string;
    role: string;
    name: string;
  };
  claim?: {
    editing: boolean;
    step: "household" | "evidence" | "review";
    monthly_income: number;
    household_size: number;
    notes: string;
    claimId: string | null;
    docType: "identity" | "income";
    fixture: string;
    attached: string;
  };
  privacy?: {
    field: string;
    value: string;
    helpers?: { id: string; name: string; status: string }[];
  };
  review?: {
    queueCount: number;
    selectedClaimId: string | null;
    selectedClaim?: {
      id: string;
      citizenName: string;
      status: string;
      monthlyIncome?: number;
      householdSize?: number;
      aiConfidence?: number | null;
      hasSuspectDoc?: boolean;
      verifiedDocs?: string;
      paymentStatus?: string;
      fundingStatus?: string | null;
      reports?: number;
      aiSummary?: string | null;
    };
    activeFilter?: "all" | "accepted" | "rejected";
    activeSort?: "asc" | "desc";
    topClaimId?: string;
  };
  family?: {
    activeFamilyId: string | null;
    activeFamilyName?: string;
    activeVillageArea?: string;
    totalFamilies?: number;
  };
  rules?: {
    activeVersion?: number;
    activeName?: string;
    config?: {
      income_cap: number;
      minimum_household: number;
      amount_pkr: number;
      confidence_threshold: number;
    };
    pendingStaffCount?: number;
  };
  profile?: {
    citizenName?: string;
    cnicMock?: string;
    monthlyIncome?: number;
    householdSize?: number;
    phone?: string;
    villageArea?: string;
    uploadedDocKinds?: string[];
  };
  budget?: {
    totalPkr: number;
    availablePkr: number;
    reservedPkr: number;
    paidPkr: number;
    awaitingClaims: number;
  };
  audit?: {
    totalLogs: number;
    safetyScoreAverage?: number;
  };
  whatsapp?: {
    configured: boolean;
    recentMessagesCount?: number;
  };
};

export type ClaimCuaHandler = {
  isEditing: () => boolean;
  getStep: () => number;
  getSnapshot: () => NonNullable<ScreenContextSnapshot["claim"]>;
  startNew: () => void;
  backToList: () => void;
  setField: (field: "monthly_income" | "household_size" | "notes", value: number | string) => void;
  setClaimId: (id: string | null) => void;
  setStep: (step: number) => void;
  setDocType: (docType: "identity" | "income") => void;
  setFixture: (fixture: "clear" | "blurred" | "altered" | "incomplete") => void;
  attachEvidence: () => Promise<void>;
  saveDraft: () => Promise<void>;
  setMessage: (msg: string) => void;
};

export type PolicyCuaHandler = {
  setDraft: (value: string) => void;
  ask: (question: string) => void;
};

export type ScamCuaHandler = {
  setDraft: (value: string) => void;
  check: (text: string) => void;
};

export type PrivacyCuaHandler = {
  getSnapshot: () => NonNullable<ScreenContextSnapshot["privacy"]>;
  setField: (field: string) => void;
  setValue: (value: string) => void;
  submit: (field: string, value: string) => Promise<void>;
  setHelperConsent: (consent: "revoked" | "granted", helperNameOrId?: string) => Promise<void>;
};

export type ReviewCuaHandler = {
  getSnapshot: () => NonNullable<ScreenContextSnapshot["review"]>;
  selectClaim: (claimId: string) => void;
  backToBoard: () => void;
  produceSummary: () => Promise<void>;
  decide: (decision: "approve" | "reject" | "more_proof", reason?: string, reasonUr?: string) => Promise<void>;
  quickDecide: (claimId: string, decision: "approve" | "reject" | "more_proof") => Promise<void>;
  disburse: (outcome?: "paid" | "failed") => Promise<void>;
  setFilter: (filter: "all" | "accepted" | "rejected") => void;
  setSort: (order: "asc" | "desc") => void;
};

export type FamilyCuaHandler = {
  getSnapshot: () => NonNullable<ScreenContextSnapshot["family"]>;
  switchFamily: (familyIdOrName: string) => Promise<void>;
};

export type RuleCuaHandler = {
  getSnapshot: () => NonNullable<ScreenContextSnapshot["rules"]>;
  updateConfig: (patch: Partial<RuleConfig>, name?: string) => void;
  simulate: () => Promise<void>;
  publish: (name?: string, config?: RuleConfig) => Promise<void>;
  decideStaff: (userId: string, decision: "active" | "rejected") => Promise<void>;
};

export type ProfileCuaHandler = {
  getSnapshot: () => NonNullable<ScreenContextSnapshot["profile"]>;
  addSampleDoc: (kind: "cnic" | "utility" | "job") => Promise<void>;
};

export type WhatsAppCuaHandler = {
  getSnapshot: () => NonNullable<ScreenContextSnapshot["whatsapp"]>;
  setApiKey: (key: string) => Promise<void>;
};

export type WorkspaceCuaBridge = {
  isAppOpen: (app: MiniApp) => boolean;
  getOpenApps: () => MiniApp[];
  getActiveApp: () => MiniApp | null;
  openApp: (app: MiniApp) => void;
  focusApp: (app: MiniApp) => void;
  closeApp?: (app: MiniApp) => void;
  minimizeApp?: (app: MiniApp) => void;
  switchPersona?: (persona: Persona) => Promise<void>;
  toggleLite?: () => void;
  toggleNetworkDrop?: () => void;
  refresh: () => void;
  getDesktopSnapshot?: () => {
    persona?: ScreenContextSnapshot["persona"];
    budget?: ScreenContextSnapshot["budget"];
    audit?: ScreenContextSnapshot["audit"];
  };
};

type Listener = (state: CursorState) => void;

const INITIAL_STATE: CursorState = {
  visible: false,
  x: 0,
  y: 0,
  clicking: false,
  ripple: null,
  label: "",
  tone: "active",
  spotlight: null,
};

class CuaEngine {
  private state: CursorState = INITIAL_STATE;
  private listeners = new Set<Listener>();
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private pendingCount = 0;
  private hideTimer: number | null = null;
  private rippleCounter = 0;

  public bridge: WorkspaceCuaBridge | null = null;
  public claim: ClaimCuaHandler | null = null;
  public policy: PolicyCuaHandler | null = null;
  public scam: ScamCuaHandler | null = null;
  public privacy: PrivacyCuaHandler | null = null;
  public review: ReviewCuaHandler | null = null;
  public family: FamilyCuaHandler | null = null;
  public rules: RuleCuaHandler | null = null;
  public profile: ProfileCuaHandler | null = null;
  public whatsapp: WhatsAppCuaHandler | null = null;
  public search: Partial<Record<"family" | "review" | "users", (query: string) => void>> = {};

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getScreenSnapshot(): ScreenContextSnapshot {
    const activeApp = this.bridge?.getActiveApp() ?? null;
    const openApps = this.bridge?.getOpenApps() ?? [];
    const desktop = this.bridge?.getDesktopSnapshot?.() ?? {};
    return {
      activeApp,
      openApps,
      ...(desktop.persona ? { persona: desktop.persona } : {}),
      ...(desktop.budget ? { budget: desktop.budget } : {}),
      ...(desktop.audit ? { audit: desktop.audit } : {}),
      ...(this.claim ? { claim: this.claim.getSnapshot() } : {}),
      ...(this.privacy ? { privacy: this.privacy.getSnapshot() } : {}),
      ...(this.review ? { review: this.review.getSnapshot() } : {}),
      ...(this.family ? { family: this.family.getSnapshot() } : {}),
      ...(this.rules ? { rules: this.rules.getSnapshot() } : {}),
      ...(this.profile ? { profile: this.profile.getSnapshot() } : {}),
      ...(this.whatsapp ? { whatsapp: this.whatsapp.getSnapshot() } : {}),
    };
  }

  private emit(patch: Partial<CursorState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  cancel() {
    this.generation += 1;
    this.pendingCount = 0;
    if (this.hideTimer) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    this.emit({ visible: false, clicking: false, spotlight: null, label: "", ripple: null });
  }

  private isStale(gen: number) {
    return gen !== this.generation;
  }

  private sleep(ms: number, gen: number) {
    return new Promise<boolean>(resolve => {
      window.setTimeout(() => resolve(!this.isStale(gen)), ms);
    });
  }

  private getStartPos() {
    if (this.state.visible) return { x: this.state.x, y: this.state.y };
    if (typeof window === "undefined") return { x: 400, y: 500 };
    const dock = document.querySelector(".voice-dock-glass");
    if (dock) {
      const rect = dock.getBoundingClientRect();
      return { x: rect.left + rect.width * 0.5, y: rect.top - 14 };
    }
    return { x: window.innerWidth * 0.5, y: window.innerHeight - 100 };
  }

  private async waitForElement(selector: string, gen: number, timeoutMs = 2400): Promise<HTMLElement | null> {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      if (this.isStale(gen)) return null;
      const el = document.querySelector<HTMLElement>(selector);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 4 && rect.height > 4) return el;
      }
      await new Promise(resolve => window.setTimeout(resolve, 45));
    }
    return null;
  }

  private async waitForHandler<T>(getter: () => T | null, gen: number, timeoutMs = 2400): Promise<T | null> {
    const start = performance.now();
    while (performance.now() - start < timeoutMs) {
      if (this.isStale(gen)) return null;
      const value = getter();
      if (value) return value;
      await new Promise(resolve => window.setTimeout(resolve, 45));
    }
    return null;
  }

  private spotlightFor(el: HTMLElement): SpotlightRect {
    const rect = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    const parsedRadius = parseFloat(cs.borderRadius);
    const radius = Number.isFinite(parsedRadius) && parsedRadius > 0 ? Math.min(parsedRadius + 4, 24) : 12;
    return {
      left: rect.left - 4,
      top: rect.top - 4,
      width: rect.width + 8,
      height: rect.height + 8,
      radius,
    };
  }

  private async moveTo(el: HTMLElement, label: string, gen: number, tone: CursorState["tone"] = "active") {
    if (this.isStale(gen)) return false;
    el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    await this.sleep(90, gen);
    if (this.isStale(gen)) return false;

    const start = this.getStartPos();
    if (!this.state.visible) {
      this.emit({ visible: true, x: start.x, y: start.y, label, tone });
      await this.sleep(30, gen);
    }
    if (this.isStale(gen)) return false;

    const rect = el.getBoundingClientRect();
    const targetX = rect.left + Math.min(rect.width * 0.5, Math.max(24, rect.width - 24));
    const targetY = rect.top + rect.height * 0.5;
    const dist = Math.hypot(targetX - start.x, targetY - start.y);
    const travelMs = Math.min(620, Math.max(260, Math.round(dist * 0.65)));

    this.emit({
      visible: true,
      x: targetX,
      y: targetY,
      label,
      tone,
      spotlight: this.spotlightFor(el),
    });

    const ok = await this.sleep(travelMs, gen);
    if (!ok) return false;
    // Refresh spotlight in case smooth scroll shifted element slightly
    this.emit({ spotlight: this.spotlightFor(el) });
    return true;
  }

  private async clickElement(el: HTMLElement, label: string, gen: number, action?: () => void | Promise<void>) {
    if (!(await this.moveTo(el, label, gen, "active"))) return false;
    if (!(await this.sleep(90, gen))) return false;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width * 0.5;
    const cy = rect.top + rect.height * 0.5;
    this.rippleCounter += 1;
    this.emit({
      clicking: true,
      ripple: { id: this.rippleCounter, x: cx, y: cy },
      spotlight: this.spotlightFor(el),
    });
    if (action) {
      // The click has landed, so the highlight has done its job — drop it
      // instead of holding it over a control the agent has already used.
      this.emit({ spotlight: null });
      await action();
    } else {
      el.click();
      this.emit({ spotlight: null });
    }
    if (!(await this.sleep(160, gen))) return false;
    this.emit({ clicking: false });
    return await this.sleep(180, gen);
  }

  private async typeText(
    el: HTMLElement,
    text: string,
    label: string,
    gen: number,
    onUpdate: (partial: string) => void,
  ) {
    if (!(await this.moveTo(el, label, gen, "typing"))) return false;
    const focusable = el.matches("input, textarea")
      ? el
      : el.querySelector<HTMLElement>("input, textarea, [contenteditable='true']");
    focusable?.focus();
    const total = text.length;
    if (total === 0) {
      onUpdate("");
      return true;
    }
    const stepSize = total > 60 ? Math.ceil(total / 34) : total > 24 ? 2 : 1;
    const charDelay = total > 40 ? 22 : total > 14 ? 28 : 42;
    for (let i = stepSize; i <= total; i += stepSize) {
      if (this.isStale(gen)) return false;
      onUpdate(text.slice(0, i));
      if (!(await this.sleep(charDelay, gen))) return false;
    }
    if (this.isStale(gen)) return false;
    onUpdate(text);
    // The field has been filled — the highlight has done its job.
    this.emit({ spotlight: null });
    return await this.sleep(180, gen);
  }

  private async ensureAppOpen(app: MiniApp, gen: number, skipIfOpen = true): Promise<boolean> {
    if (this.isStale(gen) || !this.bridge) return false;
    if (skipIfOpen && this.bridge.isAppOpen(app) && this.bridge.getActiveApp() === app) {
      this.bridge.focusApp(app);
      return await this.sleep(160, gen);
    }
    const icon = await this.waitForElement(`[data-cua="app-icon-${app}"]`, gen, 900);
    const title = apps[app]?.title ?? app;
    if (icon) {
      await this.clickElement(icon, `Opening ${title}`, gen, () => {
        this.bridge?.openApp(app);
      });
    }
    this.bridge?.openApp(app);
    // Wait for Apple spring window launch animation to settle
    return await this.sleep(420, gen);
  }

  private async fillClaimFields(
    fields: Partial<Payload>,
    gen: number,
    opts: { claimId?: string; saved?: boolean } = {},
  ) {
    const handler = await this.waitForHandler(() => this.claim, gen);
    if (!handler) return;
    if (opts.claimId) handler.setClaimId(opts.claimId);

    if (fields.monthly_income !== undefined) {
      const incomeEl = await this.waitForElement('[data-cua="claim-income-input"]', gen);
      const formatted = new Intl.NumberFormat("en-PK").format(fields.monthly_income);
      if (incomeEl) {
        await this.typeText(
          incomeEl,
          String(fields.monthly_income),
          `Entering income: PKR ${formatted}`,
          gen,
          partial => {
            const num = parseInt(partial.replace(/\D/g, ""), 10);
            handler.setField("monthly_income", Number.isFinite(num) ? num : 0);
          },
        );
      } else {
        handler.setField("monthly_income", fields.monthly_income);
      }
    }

    if (fields.household_size !== undefined) {
      const hhEl = await this.waitForElement('[data-cua="claim-household-input"]', gen);
      if (hhEl) {
        await this.typeText(
          hhEl,
          String(fields.household_size),
          `Setting household size: ${fields.household_size}`,
          gen,
          partial => {
            const num = parseInt(partial.replace(/\D/g, ""), 10);
            handler.setField("household_size", Number.isFinite(num) && num >= 1 ? num : 1);
          },
        );
      } else {
        handler.setField("household_size", fields.household_size);
      }
    }

    if (fields.notes && fields.notes.trim()) {
      const notesEl = await this.waitForElement('[data-cua="claim-notes-input"]', gen);
      if (notesEl) {
        await this.typeText(notesEl, fields.notes, "Adding claim details…", gen, partial => {
          handler.setField("notes", partial);
        });
      } else {
        handler.setField("notes", fields.notes);
      }
    }

    if (opts.saved) {
      const saveBtn = await this.waitForElement('[data-cua="claim-save-draft"]', gen, 800);
      if (saveBtn) {
        await this.moveTo(saveBtn, "Draft saved — ready for evidence", gen, "done");
      }
      this.bridge?.refresh();
    } else {
      const nextEl = await this.waitForElement('[data-cua="claim-continue-evidence"]', gen, 800);
      if (nextEl) {
        await this.moveTo(nextEl, "Review fields & continue", gen, "done");
      }
    }
  }

  dispatch(action: UIAction) {
    if (action.type === "show_jev_badge" || action.type === "ask_clarification" || action.type === "highlight_alert") {
      return;
    }

    if (this.hideTimer) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }

    const gen = this.generation;
    this.pendingCount += 1;

    this.queue = this.queue
      .then(async () => {
        if (this.isStale(gen)) return;
        await this.runAction(action, gen);
      })
      .catch(err => {
        console.error("CUA step error", err);
      })
      .finally(() => {
        this.pendingCount = Math.max(0, this.pendingCount - 1);
        if (this.pendingCount === 0 && !this.isStale(gen)) {
          this.emit({ tone: "done", label: this.state.label || "Done — ready for you" });
          this.hideTimer = window.setTimeout(() => {
            if (this.pendingCount === 0 && !this.isStale(gen)) {
              this.emit({ visible: false, spotlight: null, clicking: false });
            }
          }, 1500);
        }
      });
  }

  private async runAction(action: UIAction, gen: number) {
    switch (action.type) {
      case "open_mini_app": {
        await this.ensureAppOpen(action.app, gen, true);
        return;
      }

      case "claim_back_to_list": {
        if (!(await this.ensureAppOpen("claim", gen, true))) return;
        const handler = await this.waitForHandler(() => this.claim, gen);
        if (!handler) return;
        if (handler.isEditing()) {
          const backBtn = await this.waitForElement('[data-cua="claim-back-btn"]', gen, 1000);
          if (backBtn) {
            await this.clickElement(backBtn, "Clicking Back to claims", gen, () => handler.backToList());
          } else {
            handler.backToList();
          }
          await this.sleep(200, gen);
        }
        return;
      }

      case "start_new_claim": {
        if (!(await this.ensureAppOpen("claim", gen, true))) return;
        const handler = await this.waitForHandler(() => this.claim, gen);
        if (!handler) return;

        if (!handler.isEditing()) {
          const newBtn = await this.waitForElement('[data-cua="claim-new-btn"]', gen);
          if (newBtn) {
            await this.clickElement(newBtn, "Clicking + New claim", gen, () => handler.startNew());
          } else {
            handler.startNew();
          }
          await this.sleep(240, gen);
        } else if (handler.getStep() !== 0) {
          handler.setStep(0);
          await this.sleep(180, gen);
        }

        if (action.fields && Object.keys(action.fields).length > 0) {
          await this.fillClaimFields(action.fields, gen);
        } else {
          const incomeEl = await this.waitForElement('[data-cua="claim-income-input"]', gen);
          if (incomeEl) {
            await this.moveTo(incomeEl, "Enter monthly income here", gen, "done");
            incomeEl.querySelector<HTMLInputElement>("input")?.focus();
          }
        }
        return;
      }

      case "prefill_fields": {
        if (!(await this.ensureAppOpen("claim", gen, true))) return;
        const handler = await this.waitForHandler(() => this.claim, gen);
        if (!handler) return;

        if (!handler.isEditing()) {
          const newBtn = await this.waitForElement('[data-cua="claim-new-btn"]', gen, 1000);
          if (newBtn) {
            await this.clickElement(newBtn, "Opening claim form", gen, () => handler.startNew());
          } else {
            handler.startNew();
          }
          await this.sleep(220, gen);
        } else if (handler.getStep() !== 0) {
          handler.setStep(0);
          await this.sleep(160, gen);
        }

        await this.fillClaimFields(action.fields, gen, { claimId: action.claimId, saved: action.saved });
        return;
      }

      case "advance_claim_step": {
        if (!(await this.ensureAppOpen("claim", gen, true))) return;
        const handler = await this.waitForHandler(() => this.claim, gen);
        if (!handler) return;

        if (action.step === "list") {
          if (handler.isEditing()) {
            const backBtn = await this.waitForElement('[data-cua="claim-back-btn"]', gen, 1000);
            if (backBtn) {
              await this.clickElement(backBtn, "Clicking Back to claims", gen, () => handler.backToList());
            } else {
              handler.backToList();
            }
            await this.sleep(200, gen);
          }
          return;
        }

        if (!handler.isEditing()) {
          const newBtn = await this.waitForElement('[data-cua="claim-new-btn"]', gen, 900);
          if (newBtn) {
            await this.clickElement(newBtn, "Opening claim wizard", gen, () => handler.startNew());
          } else {
            handler.startNew();
          }
          await this.sleep(200, gen);
        }

        if (action.step === "household") {
          handler.setStep(0);
          const incomeEl = await this.waitForElement('[data-cua="claim-income-input"]', gen);
          if (incomeEl) await this.moveTo(incomeEl, "Step 1 · Household details", gen, "done");
          return;
        }

        if (action.step === "evidence") {
          const continueBtn = await this.waitForElement('[data-cua="claim-continue-evidence"]', gen, 600);
          if (continueBtn) {
            await this.clickElement(continueBtn, "Moving to Evidence step", gen, () => handler.setStep(1));
          } else {
            handler.setStep(1);
          }
          await this.sleep(240, gen);

          if (action.docType) {
            const docEl = await this.waitForElement('[data-cua="claim-doc-type"]', gen, 900);
            if (docEl) {
              await this.clickElement(docEl, `Selecting ${action.docType} document`, gen, () => {
                handler.setDocType(action.docType!);
              });
            } else {
              handler.setDocType(action.docType);
            }
          }

          if (action.fixture) {
            const fixEl = await this.waitForElement('[data-cua="claim-fixture"]', gen, 900);
            if (fixEl) {
              await this.clickElement(fixEl, `Picking ${action.fixture} sample`, gen, () => {
                handler.setFixture(action.fixture!);
              });
            } else {
              handler.setFixture(action.fixture);
            }
          }

          if (action.attachEvidence) {
            const attachBtn = await this.waitForElement('[data-cua="claim-attach-btn"]', gen, 1000);
            if (attachBtn) {
              await this.clickElement(attachBtn, "Attaching synthetic evidence", gen, async () => {
                await handler.attachEvidence();
              });
            } else {
              await handler.attachEvidence();
            }
          } else {
            const attachBtn = await this.waitForElement('[data-cua="claim-attach-btn"]', gen, 800);
            if (attachBtn) await this.moveTo(attachBtn, "Attach your evidence here", gen, "done");
          }
          return;
        }

        // review or submit
        const reviewBtn = await this.waitForElement('[data-cua="claim-review-btn"]', gen, 600);
        if (reviewBtn) {
          await this.clickElement(reviewBtn, "Opening Review & submit", gen, () => handler.setStep(2));
        } else {
          handler.setStep(2);
        }
        await this.sleep(250, gen);
        const submitBtn = await this.waitForElement('[data-cua="claim-submit-btn"]', gen, 1000);
        if (submitBtn) {
          await this.moveTo(submitBtn, "Check details & click Submit claim", gen, "done");
        }
        handler.setMessage("Review your claim details and click Submit claim when you are ready.");
        return;
      }

      case "ask_policy_visual": {
        if (!(await this.ensureAppOpen("policy", gen, true))) return;
        const handler = await this.waitForHandler(() => this.policy, gen);
        if (!handler) return;

        const composerEl = await this.waitForElement('[data-cua="policy-composer"]', gen);
        const inputEl =
          composerEl?.querySelector<HTMLElement>("textarea, input, [contenteditable='true']") ?? composerEl;
        if (inputEl) {
          await this.typeText(inputEl, action.question, "Typing in Policy Ask…", gen, partial => {
            handler.setDraft(partial);
          });
        } else {
          handler.setDraft(action.question);
        }

        const sendBtn =
          composerEl?.querySelector<HTMLElement>('button[type="submit"], button[aria-label*="Send" i], button:last-of-type') ??
          composerEl;
        if (sendBtn) {
          await this.clickElement(sendBtn, "Asking official policy registry", gen, () => {
            handler.ask(action.question);
          });
        } else {
          handler.ask(action.question);
        }
        return;
      }

      case "check_scam_visual": {
        if (!(await this.ensureAppOpen("scam", gen, true))) return;
        const handler = await this.waitForHandler(() => this.scam, gen);
        if (!handler) return;

        const fullText = [action.message, action.reference ? `Reference: ${action.reference}` : ""]
          .filter(Boolean)
          .join("\n");

        const composerEl = await this.waitForElement('[data-cua="scam-composer"]', gen);
        const inputEl =
          composerEl?.querySelector<HTMLElement>("textarea, input, [contenteditable='true']") ?? composerEl;
        if (inputEl) {
          await this.typeText(inputEl, fullText, "Entering message in Scam Shield…", gen, partial => {
            handler.setDraft(partial);
          });
        } else {
          handler.setDraft(fullText);
        }

        const sendBtn =
          composerEl?.querySelector<HTMLElement>('button[type="submit"], button[aria-label*="Send" i], button:last-of-type') ??
          composerEl;
        if (sendBtn) {
          await this.clickElement(sendBtn, "Running Scam Shield verification", gen, () => {
            handler.check(fullText);
          });
        } else {
          handler.check(fullText);
        }
        return;
      }

      case "privacy_correction_visual": {
        if (!(await this.ensureAppOpen("privacy", gen, true))) return;
        const handler = await this.waitForHandler(() => this.privacy, gen);
        if (!handler) return;

        const fieldEl = await this.waitForElement('[data-cua="privacy-field"]', gen);
        if (fieldEl) {
          await this.clickElement(fieldEl, `Selecting field: ${action.field.replaceAll("_", " ")}`, gen, () => {
            handler.setField(action.field);
          });
        } else {
          handler.setField(action.field);
        }

        const valEl = await this.waitForElement('[data-cua="privacy-value"]', gen);
        if (valEl) {
          await this.typeText(valEl, action.value, "Typing proposed correction…", gen, partial => {
            handler.setValue(partial);
          });
        } else {
          handler.setValue(action.value);
        }

        const submitBtn = await this.waitForElement('[data-cua="privacy-submit"]', gen, 900);
        if (submitBtn) {
          await this.moveTo(submitBtn, "Review & click Request correction", gen, "done");
        }
        return;
      }

      case "privacy_helper_consent_visual": {
        if (!(await this.ensureAppOpen("privacy", gen, true))) return;
        const handler = await this.waitForHandler(() => this.privacy, gen);
        if (!handler) return;

        const targetConsent = action.consent;
        const helperBtn = await this.waitForElement('[data-cua="privacy-helper-btn"]', gen, 1200);
        if (helperBtn) {
          const actionWord = targetConsent === "revoked" ? "Revoking" : "Granting";
          await this.clickElement(helperBtn, `${actionWord} helper access`, gen, async () => {
            await handler.setHelperConsent(targetConsent, action.helperId ?? action.helperName);
          });
        } else {
          await handler.setHelperConsent(targetConsent, action.helperId ?? action.helperName);
        }
        await this.sleep(200, gen);
        this.bridge?.refresh();
        return;
      }

      case "search_app_visual": {
        if (!(await this.ensureAppOpen(action.app, gen, true))) return;
        const setSearch = await this.waitForHandler(() => this.search[action.app] ?? null, gen, 1600);
        const searchEl = await this.waitForElement(`[data-cua="${action.app}-search"]`, gen, 1600);
        if (searchEl && setSearch) {
          await this.typeText(searchEl, action.query, `Searching ${apps[action.app].title}…`, gen, partial => {
            setSearch(partial);
          });
        } else if (setSearch) {
          setSearch(action.query);
        }
        return;
      }

      case "profile_add_sample_visual": {
        if (!(await this.ensureAppOpen("profile", gen, true))) return;
        const kind = action.docType ?? "cnic";
        const directSampleBtn = await this.waitForElement(`[data-cua="profile-sample-${kind}"]`, gen, 600);
        if (directSampleBtn) {
          await this.clickElement(directSampleBtn, `Adding sample ${kind.toUpperCase()} proof`, gen);
          await this.sleep(400, gen);
          return;
        }
        const addBtn = await this.waitForElement(`[data-cua="profile-add-${kind}"]`, gen, 1000)
          || await this.waitForElement('[data-cua^="profile-add-"]', gen, 600);
        if (addBtn) {
          await this.clickElement(addBtn, `Opening upload for ${kind.toUpperCase()}`, gen);
        }
        const modalSampleBtn = await this.waitForElement('[data-cua="profile-use-sample"]', gen, 1200);
        if (modalSampleBtn) {
          await this.clickElement(modalSampleBtn, `Extracting sample ${kind.toUpperCase()} proof`, gen);
        }
        await this.sleep(400, gen);
        return;
      }
    }
  }
}

export const cuaEngine = new CuaEngine();
