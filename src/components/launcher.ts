import { BookOpen, ClipboardCheck, FileText, Fingerprint, Scale, ShieldCheck, SlidersHorizontal, UsersRound } from "lucide-react";
import type { MiniApp } from "@/src/lib/contracts";

export const apps = {
  claim: {
    title: "Relief Claim",
    note: "Apply for aid & track claims",
    badge: "Disbursement",
    icon: FileText,
    color: "ios-green",
    gradient: "from-[#1B5C51] to-[#134A41]",
    bg: "#E6F0ED"
  },
  scam: {
    title: "Scam Shield",
    note: "Check alerts & verify receipts",
    badge: "Protection",
    icon: ShieldCheck,
    color: "ios-orange",
    gradient: "from-[#C2552D] to-[#A8441F]",
    bg: "#FBEDE6"
  },
  policy: {
    title: "Policy Ask",
    note: "Rulebook & instant AI citations",
    badge: "Official Rules",
    icon: BookOpen,
    color: "ios-blue",
    gradient: "from-[#2A7364] to-[#1B5C51]",
    bg: "#E6F0ED"
  },
  privacy: {
    title: "My Privacy",
    note: "Consent & verified mock identity",
    badge: "Security",
    icon: Fingerprint,
    color: "ios-purple",
    gradient: "from-[#4F5FC8] to-[#3F4FB8]",
    bg: "#E7EAFB"
  },
  family: {
    title: "Family Switch",
    note: "Choose a family on shared phone",
    badge: "Household",
    icon: UsersRound,
    color: "ios-teal",
    gradient: "from-[#2A7364] to-[#134A41]",
    bg: "#E6F0ED"
  },
  review: {
    title: "Review Desk",
    note: "Decisions, tamper checks & payouts",
    badge: "Officer Portal",
    icon: ClipboardCheck,
    color: "ios-indigo",
    gradient: "from-[#4F5FC8] to-[#3F4FB8]",
    bg: "#E7EAFB"
  },
  rules: {
    title: "Rule Studio",
    note: "Simulate & publish eligibility rules",
    badge: "Admin Config",
    icon: SlidersHorizontal,
    color: "ios-amber",
    gradient: "from-[#C2552D] to-[#A8441F]",
    bg: "#FBEDE6"
  },
  audit: {
    title: "Audit Vault",
    note: "Safety metrics & forensic trail",
    badge: "Compliance",
    icon: Scale,
    color: "ios-rose",
    gradient: "from-[#134A41] to-[#0E3A33]",
    bg: "#E6F0ED"
  },
} satisfies Record<MiniApp, { title: string; note: string; badge?: string; icon: typeof FileText; color: string; gradient: string; bg: string }>;
