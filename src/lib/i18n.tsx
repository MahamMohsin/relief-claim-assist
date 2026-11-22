"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

// App-wide language (toggled by the voice dock pill). Only citizen-facing essentials are translated;
// staff screens stay English. All en/ur strings live here.

export type Lang = "en" | "ur";
type Text = { en: string; ur: string };
const STORAGE_KEY = "relief.lang";

export const strings = {
  savedOnPhone: { en: "Saved on this phone. Will send when signal returns.", ur: "یہ اس فون پر محفوظ ہے۔ سگنل واپس آنے پر بھیج دیا جائے گا۔" },
  draftSaved: { en: "Draft saved.", ur: "مسودہ محفوظ ہو گیا۔" },
  newClaim: { en: "New claim", ur: "نئی درخواست" },
  continueToEvidence: { en: "Continue to evidence", ur: "ثبوت کی طرف جاری رکھیں" },
  saveDraft: { en: "Save draft", ur: "مسودہ محفوظ کریں" },
  saveDraftToAttach: { en: "Save draft to attach evidence", ur: "ثبوت لگانے کے لیے مسودہ محفوظ کریں" },
  submitClaim: { en: "Submit claim", ur: "درخواست جمع کریں" },
  queueClaim: { en: "Queue claim", ur: "درخواست محفوظ کریں" },
  submitting: { en: "Submitting…", ur: "جمع ہو رہی ہے…" },
  attachEvidence: { en: "Attach evidence", ur: "ثبوت منسلک کریں" },
  updateEvidence: { en: "Update evidence", ur: "ثبوت اپ ڈیٹ کریں" },
  processing: { en: "Processing…", ur: "کارروائی جاری ہے…" },
  reviewClaim: { en: "Review claim", ur: "درخواست کا جائزہ لیں" },
  back: { en: "Back", ur: "واپس" },
  backToClaims: { en: "Back to claims", ur: "درخواستوں پر واپس" },
  syncNow: { en: "Sync now", ur: "ابھی بھیجیں" },
  syncing: { en: "Syncing…", ur: "بھیجا جا رہا ہے…" },
  playDecision: { en: "Play decision", ur: "فیصلہ سنیں" },
  latestEvidence: { en: "Latest evidence", ur: "تازہ ترین ثبوت" },
  queuedEvidence: { en: "Queued evidence", ur: "ثبوت محفوظ ہے، بعد میں بھیجا جائے گا" },
  received: { en: "Received", ur: "موصول" },
} satisfies Record<string, Text>;

export const waitingToSend: Record<Lang, (count: number) => string> = {
  en: count => count + " waiting to send",
  ur: count => count + " بھیجنے کے منتظر",
};

export const claimStepHelp: Record<Lang, string[]> = {
  en: [
    "Enter your total monthly household income and the number of people in your household. Then continue to evidence.",
    "Pick a sample or upload a readable synthetic image. To attach both an identity card and an income slip, add them one at a time before selecting Review claim.",
    "Check the details and evidence. Select Submit claim when you are ready. An officer will review it.",
  ],
  ur: [
    "گھر کی کل ماہانہ آمدنی اور گھر کے افراد کی تعداد درج کریں۔ پھر ثبوت کے مرحلے پر جائیں۔",
    "نمونہ منتخب کریں یا واضح فرضی تصویر اپ لوڈ کریں۔ شناختی کارڈ اور آمدنی کی پرچی دونوں منسلک کرنے کے لیے انہیں ایک ایک کر کے شامل کریں، پھر درخواست کا جائزہ لیں۔",
    "تفصیلات اور ثبوت دیکھ لیں، پھر درخواست جمع کریں۔ ایک افسر اس کا جائزہ لے گا۔",
  ],
};

// Claim status banner (driven by the live claim status).
export type ClaimTone = "processing" | "needs_proof" | "in_review" | "approved" | "rejected";
export const toneText: Record<ClaimTone, Text> = {
  processing: { en: "Received. Checking your documents…", ur: "درخواست موصول ہو گئی۔ آپ کے کاغذات کی جانچ ہو رہی ہے۔" },
  needs_proof: { en: "Your documents need attention. Please update your evidence.", ur: "آپ کے کاغذات پر توجہ درکار ہے۔ براہ کرم اپنا ثبوت اپ ڈیٹ کریں۔" },
  in_review: { en: "Checks done. An officer is reviewing your claim.", ur: "جانچ مکمل ہو گئی۔ ایک افسر آپ کی درخواست کا جائزہ لے رہا ہے۔" },
  approved: { en: "Approved.", ur: "منظور ہو گئی۔" },
  rejected: { en: "Your claim was not approved.", ur: "آپ کی درخواست منظور نہیں ہوئی۔" },
};

// Claim statuses (citizen claim cards).
export const statusText: Record<string, Text> = {
  draft: { en: "Draft", ur: "مسودہ" },
  submitted: { en: "Submitted", ur: "جمع شدہ" },
  checking: { en: "Checking", ur: "جانچ جاری ہے" },
  needs_proof: { en: "Needs proof", ur: "ثبوت درکار" },
  in_review: { en: "In review", ur: "زیرِ جائزہ" },
  approved: { en: "Approved", ur: "منظور شدہ" },
  rejected: { en: "Rejected", ur: "مسترد" },
  paid: { en: "Paid", ur: "ادائیگی ہو گئی" },
};

// Citizen stage line: "Received → …".
export const stageText = {
  checking: { en: "Checking documents", ur: "کاغذات کی جانچ جاری ہے" },
  failedToOfficer: { en: "With officer (automatic check failed)", ur: "افسر کے پاس (خودکار جانچ ناکام)" },
  needsProof: { en: "Needs proof", ur: "ثبوت درکار" },
  withOfficer: { en: "Checked · With officer", ur: "جانچ مکمل · افسر کے پاس" },
} satisfies Record<string, Text>;

// Latest evidence label (claim form), from the live document status.
export type EvidenceLabel = "checking" | "verified" | "clearer" | "flagged" | "failed";
export const evidenceText: Record<EvidenceLabel, Text> = {
  checking: { en: "Checking…", ur: "جانچ جاری ہے…" },
  verified: { en: "Verified", ur: "تصدیق شدہ" },
  clearer: { en: "Needs a clearer photo", ur: "زیادہ واضح تصویر درکار ہے" },
  flagged: { en: "Sent to officer for review", ur: "جائزے کے لیے افسر کو بھیج دیا گیا" },
  failed: { en: "Check failed — sent to officer", ur: "جانچ ناکام — افسر کو بھیج دیا گیا" },
};

// Citizen-facing app tile names. Staff tiles stay English.
export const appText: Record<string, Text> = {
  claim: { en: "Relief Claim", ur: "امدادی درخواست" },
  scam: { en: "Scam Shield", ur: "فراڈ سے بچاؤ" },
  policy: { en: "Policy Ask", ur: "پالیسی سوال" },
  privacy: { en: "My Privacy", ur: "میرا ڈیٹا" },
  profile: { en: "My Profile", ur: "میرا پروفائل" },
  familyProfile: { en: "Family Profile", ur: "خاندان کا پروفائل" },
  family: { en: "Family Switch", ur: "خاندان منتخب کریں" },
};

export const pick = (text: Text, lang: Lang) => text[lang] ?? text.en;
export const dirFor = (lang: Lang) => (lang === "ur" ? "rtl" : "ltr");

type LanguageValue = { lang: Lang; setLang: (lang: Lang) => void };
const LanguageContext = createContext<LanguageValue>({ lang: "en", setLang: () => {} });

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Default English; a previous choice on this device wins. Read after mount to keep server and client HTML equal.
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "en" || saved === "ur") setLangState(saved);
    } catch { /* storage blocked: stay English */ }
  }, []);
  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* storage blocked */ }
    // Also save it on the signed-in user's profile (server checks the session). Best effort.
    void fetch("/api/relief/set_locale", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ locale: next }),
    }).catch(() => {});
  }, []);
  return <LanguageContext.Provider value={{ lang, setLang }}>{children}</LanguageContext.Provider>;
}

export const useLang = () => useContext(LanguageContext);
