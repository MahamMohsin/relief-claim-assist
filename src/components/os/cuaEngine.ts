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
  minimizedApps?: MiniApp[];
  availableApps?: MiniApp[];
  offline?: boolean;
  lite?: boolean;
  pendingSyncCount?: number;
  persona?: {
    id: string;
    role: string;
    name: string;
  };
  activeFamily?: {
    id: string;
    name: string;
    villageArea: string;
  } | null;
  overview?: {
    active: number;
    review: number;
    proof: number;
    approved: number;
    rejected: number;
    closed: number;
    paid: number;
    newThisMonth: number;
    priority: number;
    unreadAlertsCount?: number;
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
    openedClaimId?: string | null;
    claims?: {
      id: string;
      status: string;
      amountPkr?: number;
      monthlyIncome?: number;
      householdSize?: number;
      notes?: string;
      paymentStatus?: string;
      fundingStatus?: string | null;
      raastRef?: string;
      reasonEn?: string | null;
    }[];
  };
  policy?: {
    turnsCount: number;
    latestQuestion?: string;
    latestAnswer?: string;
    latestCitations?: string[];
    policyVersion?: string;
  };
  scam?: {
    turnsCount: number;
    latestVerdict?: string;
    latestReference?: string;
    latestPaymentStatus?: string;
    canReportMissing?: boolean;
    latestReported?: boolean;
  };
  privacy?: {
    field: string;
    value: string;
    helpers?: { id: string; name: string; status: string }[];
    officers?: string[];
    correctionsCount?: number;
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
    claims?: {
      id: string;
      citizenName: string;
      status: string;
      monthlyIncome?: number;
      householdSize?: number;
      aiConfidence?: number | null;
      hasSuspectDoc?: boolean;
      paymentStatus?: string;
      fundingStatus?: string | null;
    }[];
  };
  family?: {
    activeFamilyId: string | null;
    activeFamilyName?: string;
    activeVillageArea?: string;
    totalFamilies?: number;
    families?: {
      id: string;
      name: string;
      villageArea: string;
      consent: string;
    }[];
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
    pendingStaff?: { id: string; name: string; role: string }[];
    historyCount?: number;
    lastSimulation?: { changedCount: number; totalCount: number };
  };
  profile?: {
    citizenName?: string;
    cnicMock?: string;
    monthlyIncome?: number;
    householdSize?: number;
    phone?: string;
    villageArea?: string;
    uploadedDocKinds?: string[];
    photoDocKinds?: string[];
    documentsCount?: number;
  };
  users?: {
    totalUsers: number;
    filteredCount: number;
    query: string;
    visibleUsers: { id: string; name: string; role: string }[];
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
    activeTab?: "events" | "eval";
    category?: string;
    filterText?: string;
    filteredCount?: number;
    safetyScoreAverage?: number;
    recentEvents?: { eventType: string; actorRole: string; outcome: string }[];
    safetySummary?: {
      strictBadApprovals: number;
      strictOfficerReviewPct: number;
      relaxedBadApprovals: number;
    };
  };
  whatsapp?: {
    configured: boolean;
    agentName?: string | null;
    maskedKey?: string | null;
    searchQuery?: string;
    recentMessagesCount?: number;
    recentMessages?: { direction: string; from: string; text: string }[];
  };
};

export type ClaimCuaHandler = {
  isEditing: () => boolean;
  getStep: () => number;
  getSnapshot: () => NonNullable<ScreenContextSnapshot["claim"]>;
  startNew: () => void;
  backToList: () => void;
  inspectOrEdit: (mode: "details" | "edit", claimId?: string) => void;
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
  getSnapshot: () => NonNullable<ScreenContextSnapshot["policy"]>;
  setDraft: (value: string) => void;
  ask: (question: string) => void;
  reset: () => void;
};

export type ScamCuaHandler = {
  getSnapshot: () => NonNullable<ScreenContextSnapshot["scam"]>;
  setDraft: (value: string) => void;
  check: (text: string) => void;
  reportMissing: (reference?: string) => Promise<void>;
  reset: () => void;
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
  selectClaim: (claimIdOrName: string) => Promise<string | null>;
  backToBoard: () => void;
  produceSummary: (claimIdOrName?: string) => Promise<void>;
  decide: (decision: "approve" | "reject" | "more_proof", reason?: string, reasonUr?: string, claimIdOrName?: string) => Promise<void>;
  quickDecide: (claimId: string, decision: "approve" | "reject" | "more_proof") => Promise<void>;
  disburse: (outcome?: "paid" | "failed", claimIdOrName?: string) => Promise<void>;
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
  simulate: (patch?: Partial<RuleConfig>) => Promise<void>;
  publish: (name?: string, patch?: Partial<RuleConfig>) => Promise<void>;
  decideStaff: (userIdOrName: string, decision: "active" | "rejected") => Promise<void>;
};

export type ProfileCuaHandler = {
  getSnapshot: () => NonNullable<ScreenContextSnapshot["profile"]>;
  addSampleDoc: (kind: "cnic" | "utility_bill" | "job_proof") => Promise<void>;
  viewDocument: (kind?: "cnic" | "utility_bill" | "job_proof") => void;
};

export type UsersCuaHandler = {
  getSnapshot: () => NonNullable<ScreenContextSnapshot["users"]>;
};

export type AuditCuaHandler = {
  getSnapshot: () => NonNullable<ScreenContextSnapshot["audit"]>;
  setTab: (tab: "events" | "eval") => void;
  setCategory: (category: "all" | "claims" | "ai" | "consent" | "blocked") => void;
  setFilterText: (query: string) => void;
  selectEvent: (index: number) => void;
  refresh: () => void;
};

export type WhatsAppCuaHandler = {
  getSnapshot: () => NonNullable<ScreenContextSnapshot["whatsapp"]>;
  setApiKey: (key: string, agentName?: string) => Promise<void>;
  disconnect: () => Promise<void>;
  sendTestMessage: (text: string) => Promise<void>;
  setSearch: (query: string) => void;
};

export type AdminCuaHandler = {
  getSnapshot: () => {
    overview?: ScreenContextSnapshot["overview"];
    budget?: ScreenContextSnapshot["budget"];
    rules?: ScreenContextSnapshot["rules"];
  };
  updateBudget: (totalPkr: number, reason: string) => Promise<void>;
};

export type WorkspaceCuaBridge = {
  isAppOpen: (app: MiniApp) => boolean;
  getOpenApps: () => MiniApp[];
  getActiveApp: () => MiniApp | null;
  openApp: (app: MiniApp) => void;
  focusApp: (app: MiniApp) => void;
  closeApp?: (app: MiniApp) => void;
  closeAllApps?: () => void;
  minimizeApp?: (app: MiniApp) => void;
  resizeApp?: (app: MiniApp, preset: "compact" | "default" | "wide") => void;
  switchPersona?: (persona: Persona) => Promise<void>;
  toggleLite?: () => void;
  toggleNetworkDrop?: () => void;
  setPanel?: (panel: "account_menu" | "persona_switcher" | "notifications", open?: boolean) => void;
  syncNow?: () => Promise<void>;
  refresh: () => void;
  getDesktopSnapshot?: () => {
    persona?: ScreenContextSnapshot["persona"];
    availableApps?: MiniApp[];
    minimizedApps?: MiniApp[];
    offline?: boolean;
    lite?: boolean;
    pendingSyncCount?: number;
    activeFamily?: ScreenContextSnapshot["activeFamily"];
    overview?: ScreenContextSnapshot["overview"];
    budget?: ScreenContextSnapshot["budget"];
    audit?: ScreenContextSnapshot["audit"];
    claimSummaryList?: NonNullable<ScreenContextSnapshot["claim"]>["claims"];
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

function normalizeProfileDocKind(raw?: string): "cnic" | "utility_bill" | "job_proof" {
  const norm = (raw ?? "cnic").toLowerCase();
  if (norm.includes("utility") || norm.includes("bill")) return "utility_bill";
  if (norm.includes("job") || norm.includes("salary") || norm.includes("income")) return "job_proof";
  return "cnic";
}

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
  public users: UsersCuaHandler | null = null;
  public audit: AuditCuaHandler | null = null;
  public whatsapp: WhatsAppCuaHandler | null = null;
  public admin: AdminCuaHandler | null = null;
  public search: Partial<Record<"family" | "review" | "users" | "audit" | "whatsapp", (query: string) => void>> = {};

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
    const adminSnap = this.admin?.getSnapshot() ?? {};
    const auditSnap = this.audit ? this.audit.getSnapshot() : desktop.audit;
    const claimSnap = this.claim
      ? this.claim.getSnapshot()
      : desktop.claimSummaryList
        ? {
            editing: false,
            step: "household" as const,
            monthly_income: 0,
            household_size: 1,
            notes: "",
            claimId: null,
            docType: "identity" as const,
            fixture: "clear",
            attached: "",
            claims: desktop.claimSummaryList,
          }
        : undefined;
    const rulesSnap = this.rules ? this.rules.getSnapshot() : adminSnap.rules;
    const budgetSnap = adminSnap.budget ?? desktop.budget;
    const overviewSnap = adminSnap.overview ?? desktop.overview;

    return {
      activeApp,
      openApps,
      ...(desktop.minimizedApps?.length ? { minimizedApps: desktop.minimizedApps } : {}),
      ...(desktop.availableApps?.length ? { availableApps: desktop.availableApps } : {}),
      ...(desktop.offline !== undefined ? { offline: desktop.offline } : {}),
      ...(desktop.lite !== undefined ? { lite: desktop.lite } : {}),
      ...(desktop.pendingSyncCount ? { pendingSyncCount: desktop.pendingSyncCount } : {}),
      ...(desktop.persona ? { persona: desktop.persona } : {}),
      ...(desktop.activeFamily !== undefined ? { activeFamily: desktop.activeFamily } : {}),
      ...(overviewSnap ? { overview: overviewSnap } : {}),
      ...(budgetSnap ? { budget: budgetSnap } : {}),
      ...(auditSnap ? { audit: auditSnap } : {}),
      ...(claimSnap ? { claim: claimSnap } : {}),
      ...(this.policy ? { policy: this.policy.getSnapshot() } : {}),
      ...(this.scam ? { scam: this.scam.getSnapshot() } : {}),
      ...(this.privacy ? { privacy: this.privacy.getSnapshot() } : {}),
      ...(this.review ? { review: this.review.getSnapshot() } : {}),
      ...(this.family ? { family: this.family.getSnapshot() } : {}),
      ...(rulesSnap ? { rules: rulesSnap } : {}),
      ...(this.profile ? { profile: this.profile.getSnapshot() } : {}),
      ...(this.users ? { users: this.users.getSnapshot() } : {}),
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

      case "claim_inspect_or_edit": {
        if (!(await this.ensureAppOpen("claim", gen, true))) return;
        const handler = await this.waitForHandler(() => this.claim, gen);
        if (!handler) return;
        if (handler.isEditing()) {
          handler.backToList();
          await this.sleep(200, gen);
        }
        const targetId = action.claimId;
        const detailsBtn = targetId
          ? await this.waitForElement(`[data-cua="claim-details-${targetId}"]`, gen, 900)
          : await this.waitForElement('[data-cua^="claim-details-"]', gen, 900);
        if (detailsBtn) {
          await this.clickElement(
            detailsBtn,
            action.mode === "edit" ? "Opening claim for editing" : "Inspecting claim details",
            gen,
            () => this.claim?.inspectOrEdit(action.mode, targetId),
          );
        } else {
          this.claim?.inspectOrEdit(action.mode, targetId);
        }
        await this.sleep(200, gen);
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

      case "scam_report_missing_visual": {
        if (!(await this.ensureAppOpen("scam", gen, true))) return;
        const handler = await this.waitForHandler(() => this.scam, gen);
        if (!handler) return;
        const reportBtn = await this.waitForElement('[data-cua="scam-report-btn"]', gen, 1200);
        if (reportBtn) {
          await this.clickElement(reportBtn, "Reporting missing payment", gen, async () => {
            await this.scam?.reportMissing(action.reference);
          });
        } else {
          await handler.reportMissing(action.reference);
        }
        return;
      }

      case "chat_reset_visual": {
        if (!(await this.ensureAppOpen(action.app, gen, true))) return;
        if (action.app === "policy") {
          const handler = await this.waitForHandler(() => this.policy, gen);
          handler?.reset();
        } else {
          const handler = await this.waitForHandler(() => this.scam, gen);
          handler?.reset();
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
        if (action.submit) {
          if (submitBtn) {
            await this.clickElement(submitBtn, "Submitting correction request", gen, async () => {
              await this.privacy?.submit(action.field, action.value);
            });
          } else {
            await this.privacy?.submit(action.field, action.value);
          }
        } else if (submitBtn) {
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
            await this.privacy?.setHelperConsent(targetConsent, action.helperId ?? action.helperName);
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
        const kind = normalizeProfileDocKind(action.docType);
        const kindLabel = kind.replaceAll("_", " ").toUpperCase();
        const directSampleBtn = await this.waitForElement(`[data-cua="profile-sample-${kind}"]`, gen, 700);
        if (directSampleBtn) {
          await this.clickElement(directSampleBtn, `Adding sample ${kindLabel} proof`, gen, async () => {
            if (this.profile) await this.profile.addSampleDoc(kind);
            else directSampleBtn.querySelector<HTMLElement>("button")?.click();
          });
          await this.sleep(300, gen);
          return;
        }
        const addBtn = await this.waitForElement(`[data-cua="profile-add-${kind}"]`, gen, 1000)
          || await this.waitForElement('[data-cua^="profile-add-"]', gen, 600);
        if (addBtn) {
          await this.clickElement(addBtn, `Opening upload for ${kindLabel}`, gen, () => {
            addBtn.querySelector<HTMLElement>("button")?.click();
          });
          await this.sleep(220, gen);
        }
        const modalSampleBtn = await this.waitForElement('[data-cua="profile-use-sample"]', gen, 1000);
        if (modalSampleBtn) {
          await this.clickElement(modalSampleBtn, `Extracting sample ${kindLabel} proof`, gen, async () => {
            if (this.profile) await this.profile.addSampleDoc(kind);
            else modalSampleBtn.querySelector<HTMLElement>("button")?.click();
          });
        } else if (this.profile) {
          await this.profile.addSampleDoc(kind);
        }
        await this.sleep(300, gen);
        return;
      }

      case "profile_view_document": {
        if (!(await this.ensureAppOpen("profile", gen, true))) return;
        const handler = await this.waitForHandler(() => this.profile, gen);
        if (!handler) return;
        const kind = action.docType ? normalizeProfileDocKind(action.docType) : undefined;
        const zoomBtn = kind
          ? await this.waitForElement(`[data-cua="profile-zoom-${kind}"]`, gen, 800)
          : await this.waitForElement('[data-cua^="profile-zoom-"]', gen, 800);
        if (zoomBtn) {
          await this.clickElement(zoomBtn, "Viewing document proof", gen, () => {
            this.profile?.viewDocument(kind);
          });
        } else {
          handler.viewDocument(kind);
        }
        return;
      }

      case "switch_persona": {
        if (this.bridge?.switchPersona) {
          const dockItem = await this.waitForElement(`.persona-macos-dock-item:has(img[src*="${action.persona}"])`, gen, 500);
          if (dockItem) {
            await this.clickElement(dockItem, `Switching persona to ${action.persona}`, gen, async () => {
              await this.bridge?.switchPersona?.(action.persona);
            });
          } else {
            await this.bridge.switchPersona(action.persona);
          }
        }
        return;
      }

      case "switch_family_action": {
        if (!(await this.ensureAppOpen("family", gen, true))) return;
        const handler = await this.waitForHandler(() => this.family, gen);
        const query = action.citizenId || action.familyName;
        if (handler && query) {
          const snap = handler.getSnapshot();
          const matched = snap.families?.find(
            f => f.id === query || f.name.toLowerCase().includes(query.toLowerCase()),
          );
          const switchBtn = matched
            ? await this.waitForElement(`[data-cua="family-switch-${matched.id}"]`, gen, 900)
            : null;
          if (switchBtn) {
            await this.clickElement(switchBtn, `Switching to ${matched!.name}`, gen, async () => {
              await this.family?.switchFamily(matched!.id);
            });
          } else {
            await handler.switchFamily(query);
          }
        }
        return;
      }

      case "review_select_claim": {
        if (!(await this.ensureAppOpen("review", gen, true))) return;
        const handler = await this.waitForHandler(() => this.review, gen);
        if (handler) {
          const target = action.claimId || action.citizenName || handler.getSnapshot().topClaimId;
          if (target) {
            const snap = handler.getSnapshot();
            const matched = snap.claims?.find(
              c => c.id === target || c.citizenName.toLowerCase().includes(target.toLowerCase()),
            );
            const cardEl = matched
              ? await this.waitForElement(`[data-cua="review-card-${matched.id}"]`, gen, 800)
              : null;
            if (cardEl) {
              await this.clickElement(cardEl, `Opening ${matched!.citizenName}'s case`, gen, async () => {
                await this.review?.selectClaim(matched!.id);
              });
            } else {
              await handler.selectClaim(target);
            }
          }
        }
        return;
      }

      case "review_back_to_board": {
        if (!(await this.ensureAppOpen("review", gen, true))) return;
        const handler = await this.waitForHandler(() => this.review, gen);
        if (!handler) return;
        const backBtn = await this.waitForElement('[data-cua="review-back-btn"]', gen, 900);
        if (backBtn) {
          await this.clickElement(backBtn, "Returning to Review Board", gen, () => {
            this.review?.backToBoard();
          });
        } else {
          handler.backToBoard();
        }
        return;
      }

      case "review_produce_summary": {
        if (!(await this.ensureAppOpen("review", gen, true))) return;
        const handler = await this.waitForHandler(() => this.review, gen);
        if (handler) {
          const target = action.claimId || action.citizenName;
          if (target) {
            await handler.selectClaim(target);
            await this.sleep(240, gen);
          }
          const produceBtn = await this.waitForElement(".ai-summary-produce-btn", gen, 1200);
          if (produceBtn) {
            await this.clickElement(produceBtn, "Producing AI Summary", gen, async () => {
              await this.review?.produceSummary(target);
            });
          } else {
            await this.review?.produceSummary(target);
          }
        }
        return;
      }

      case "review_decide_claim": {
        if (!(await this.ensureAppOpen("review", gen, true))) return;
        const handler = await this.waitForHandler(() => this.review, gen);
        if (handler) {
          const target = action.claimId || action.citizenName;
          if (target) {
            await handler.selectClaim(target);
            await this.sleep(240, gen);
          }
          const btnSelector = action.decision === "approve" ? ".btn-quick-accept" : action.decision === "reject" ? ".btn-quick-reject" : ".btn-quick-proof";
          const decideBtn = await this.waitForElement(btnSelector, gen, 1200);
          if (decideBtn) {
            await this.clickElement(decideBtn, `Recording ${action.decision.replace("_", " ")} decision`, gen, async () => {
              await this.review?.decide(action.decision, action.reason, action.reasonUr, target);
            });
          } else {
            await this.review?.decide(action.decision, action.reason, action.reasonUr, target);
          }
        }
        return;
      }

      case "review_disburse": {
        if (!(await this.ensureAppOpen("review", gen, true))) return;
        const handler = await this.waitForHandler(() => this.review, gen);
        if (handler) {
          const target = action.claimId || action.citizenName;
          if (target) {
            await handler.selectClaim(target);
            await this.sleep(240, gen);
          }
          const btnSelector = action.outcome === "failed"
            ? '[data-cua="review-disburse-fail-btn"]'
            : '[data-cua="review-disburse-btn"]';
          const disburseBtn = await this.waitForElement(btnSelector, gen, 1000);
          if (disburseBtn) {
            await this.clickElement(
              disburseBtn,
              action.outcome === "failed" ? "Simulating payment failure" : "Issuing simulated payment",
              gen,
              async () => {
                await this.review?.disburse(action.outcome, target);
              },
            );
          } else {
            await this.review?.disburse(action.outcome, target);
          }
        }
        return;
      }

      case "review_filter": {
        if (!(await this.ensureAppOpen("review", gen, true))) return;
        const handler = await this.waitForHandler(() => this.review, gen);
        if (handler) {
          if (handler.getSnapshot().selectedClaimId) {
            handler.backToBoard();
            await this.sleep(160, gen);
          }
          const filterBtn = await this.waitForElement(`[data-cua="review-filter-${action.filter}"]`, gen, 900);
          if (filterBtn) {
            await this.clickElement(filterBtn, `Filtering queue: ${action.filter}`, gen, () => {
              this.review?.setFilter(action.filter);
            });
          } else {
            handler.setFilter(action.filter);
          }
          if (action.sort) {
            const sortBtn = await this.waitForElement('[data-cua="review-sort-btn"]', gen, 700);
            if (sortBtn) {
              await this.clickElement(sortBtn, `Sorting reliability (${action.sort})`, gen, () => {
                this.review?.setSort(action.sort!);
              });
            } else {
              this.review?.setSort(action.sort);
            }
          }
        }
        return;
      }

      case "rules_update_config": {
        if (!(await this.ensureAppOpen("rules", gen, true))) return;
        const handler = await this.waitForHandler(() => this.rules, gen);
        if (handler) {
          handler.updateConfig(action.config, action.name);
          const firstKey = Object.keys(action.config)[0];
          const inputEl = firstKey
            ? await this.waitForElement(`[data-cua="rule-input-${firstKey}"]`, gen, 700)
            : await this.waitForElement('[data-cua="rule-name-input"]', gen, 700);
          if (inputEl) {
            await this.moveTo(inputEl, "Updated eligibility rule draft", gen, "done");
          }
        }
        return;
      }

      case "rules_simulate": {
        if (!(await this.ensureAppOpen("rules", gen, true))) return;
        const handler = await this.waitForHandler(() => this.rules, gen);
        if (handler) {
          if (action.config) handler.updateConfig(action.config);
          await this.sleep(150, gen);
          const simBtn = await this.waitForElement('button[value="simulate"]', gen, 1200);
          if (simBtn) {
            await this.clickElement(simBtn, "Simulating rule on Digital Twin", gen, async () => {
              await this.rules?.simulate(action.config);
            });
          } else {
            await this.rules?.simulate(action.config);
          }
        }
        return;
      }

      case "rules_publish": {
        if (!(await this.ensureAppOpen("rules", gen, true))) return;
        const handler = await this.waitForHandler(() => this.rules, gen);
        if (handler) {
          if (action.config || action.name) {
            handler.updateConfig(action.config ?? {}, action.name);
            await this.sleep(150, gen);
          }
          const pubBtn = await this.waitForElement('button[value="publish"]', gen, 1200);
          if (pubBtn) {
            await this.clickElement(pubBtn, "Publishing new rule version", gen, async () => {
              await this.rules?.publish(action.name, action.config);
            });
          } else {
            await this.rules?.publish(action.name, action.config);
          }
        }
        return;
      }

      case "rules_staff_decision": {
        if (!(await this.ensureAppOpen("rules", gen, true))) return;
        const handler = await this.waitForHandler(() => this.rules, gen);
        const target = action.userId || action.staffName;
        if (handler && target) {
          const btn = await this.waitForElement(`[data-cua="staff-${action.decision}-${target}"]`, gen, 700);
          if (btn) {
            await this.clickElement(btn, action.decision === "active" ? "Approving staff access" : "Rejecting staff access", gen, async () => {
              await this.rules?.decideStaff(target, action.decision);
            });
          } else {
            await handler.decideStaff(target, action.decision);
          }
        }
        return;
      }

      case "budget_update": {
        if (this.admin) {
          const editBtn = await this.waitForElement('[data-cua="admin-budget-edit"]', gen, 700);
          if (editBtn) {
            await this.moveTo(editBtn, `Updating scheme budget to PKR ${new Intl.NumberFormat("en-PK").format(action.totalPkr)}`, gen, "active");
          }
          await this.admin.updateBudget(action.totalPkr, action.reason);
          this.bridge?.refresh();
          return;
        }
        try {
          const { api } = await import("@/src/lib/client");
          const current = await api<{ total_pkr: number }>("scheme_budget").catch(() => ({ total_pkr: 0 }));
          await api("set_scheme_budget", {
            totalPkr: action.totalPkr,
            expectedTotalPkr: current.total_pkr,
            reason: action.reason,
          });
          this.bridge?.refresh();
        } catch (err) {
          console.warn("Failed to set scheme budget via CUA", err);
        }
        return;
      }

      case "audit_control": {
        if (!(await this.ensureAppOpen("audit", gen, true))) return;
        const handler = await this.waitForHandler(() => this.audit, gen);
        if (!handler) return;
        if (action.tab) {
          const tabBtn = await this.waitForElement(`[data-cua="audit-tab-${action.tab}"]`, gen, 900);
          if (tabBtn) {
            await this.clickElement(tabBtn, action.tab === "eval" ? "Opening Safety Eval tab" : "Opening Audit Events tab", gen, () => {
              this.audit?.setTab(action.tab!);
            });
          } else {
            handler.setTab(action.tab);
          }
          await this.sleep(160, gen);
        }
        if (action.category) {
          const catBtn = await this.waitForElement(`[data-cua="audit-cat-${action.category}"]`, gen, 900);
          if (catBtn) {
            await this.clickElement(catBtn, `Filtering audit: ${action.category}`, gen, () => {
              this.audit?.setCategory(action.category!);
            });
          } else {
            this.audit?.setCategory(action.category);
          }
        }
        if (action.query !== undefined) {
          const searchEl = await this.waitForElement('[data-cua="audit-search"]', gen, 900);
          if (searchEl) {
            await this.typeText(searchEl, action.query, "Searching audit trail…", gen, partial => {
              this.audit?.setFilterText(partial);
            });
          } else {
            this.audit?.setFilterText(action.query);
          }
        }
        if (typeof action.selectIndex === "number") {
          this.audit?.selectEvent(action.selectIndex);
        }
        if (action.refresh) {
          const refreshBtn = await this.waitForElement('[data-cua="audit-refresh"]', gen, 700);
          if (refreshBtn) {
            await this.clickElement(refreshBtn, "Refreshing audit vault", gen, () => {
              this.audit?.refresh();
            });
          } else {
            this.audit?.refresh();
          }
        }
        return;
      }

      case "whatsapp_set_key": {
        if (!(await this.ensureAppOpen("whatsapp", gen, true))) return;
        const handler = await this.waitForHandler(() => this.whatsapp, gen);
        if (!handler) return;
        const keyInput = await this.waitForElement('[data-cua="whatsapp-key-input"]', gen, 900);
        if (keyInput) {
          await this.moveTo(keyInput, "Configuring WhatsApp Agent key", gen, "typing");
        }
        await handler.setApiKey(action.key, action.agentName);
        return;
      }

      case "whatsapp_disconnect": {
        if (!(await this.ensureAppOpen("whatsapp", gen, true))) return;
        const handler = await this.waitForHandler(() => this.whatsapp, gen);
        if (!handler) return;
        const discBtn = await this.waitForElement('[data-cua="whatsapp-disconnect-btn"]', gen, 900);
        if (discBtn) {
          await this.clickElement(discBtn, "Disconnecting WhatsApp Agent", gen, async () => {
            await this.whatsapp?.disconnect();
          });
        } else {
          await handler.disconnect();
        }
        return;
      }

      case "whatsapp_send_test": {
        if (!(await this.ensureAppOpen("whatsapp", gen, true))) return;
        const handler = await this.waitForHandler(() => this.whatsapp, gen);
        if (!handler) return;
        const testInput = await this.waitForElement('[data-cua="whatsapp-test-input"]', gen, 900);
        if (testInput) {
          await this.moveTo(testInput, "Sending WhatsApp test message", gen, "typing");
        }
        await handler.sendTestMessage(action.text);
        return;
      }

      case "close_window": {
        const closeBtn = await this.waitForElement(`[data-cua="window-close-${action.app}"]`, gen, 600);
        if (closeBtn) {
          await this.clickElement(closeBtn, `Closing ${apps[action.app]?.title ?? action.app}`, gen, () => {
            this.bridge?.closeApp?.(action.app);
          });
        } else {
          this.bridge?.closeApp?.(action.app);
        }
        return;
      }

      case "close_all_windows": {
        this.bridge?.closeAllApps?.();
        return;
      }

      case "minimize_window": {
        const minBtn = await this.waitForElement(`[data-cua="window-minimize-${action.app}"]`, gen, 600);
        if (minBtn) {
          await this.clickElement(minBtn, `Minimizing ${apps[action.app]?.title ?? action.app}`, gen, () => {
            this.bridge?.minimizeApp?.(action.app);
          });
        } else {
          this.bridge?.minimizeApp?.(action.app);
        }
        return;
      }

      case "window_resize": {
        if (!(await this.ensureAppOpen(action.app, gen, true))) return;
        this.bridge?.resizeApp?.(action.app, action.preset);
        return;
      }

      case "workspace_ui_panel": {
        this.bridge?.setPanel?.(action.panel, action.open);
        return;
      }

      case "workspace_sync": {
        await this.bridge?.syncNow?.();
        return;
      }

      case "toggle_feature": {
        if (action.feature === "lite") {
          this.bridge?.toggleLite?.();
        } else if (action.feature === "network_drop") {
          this.bridge?.toggleNetworkDrop?.();
        }
        return;
      }
    }
  }
}

export const cuaEngine = new CuaEngine();
