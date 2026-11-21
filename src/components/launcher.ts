import { BookOpen, ClipboardCheck, FileText, Fingerprint, Scale, ShieldCheck, SlidersHorizontal, UsersRound } from "lucide-react";
import type { MiniApp } from "@/src/lib/contracts";

export const apps = {
  claim: {
    title: "Relief Claim",
    note: "Apply for aid & track claims",
    badge: "Disbursement",
    icon: FileText,
    color: "ios-green",
    gradient: "from-[#34C759] to-[#28A745]",
    bg: "#eafaf1"
  },
  scam: {
    title: "Scam Shield",
    note: "Check alerts & verify receipts",
    badge: "Protection",
    icon: ShieldCheck,
    color: "ios-orange",
    gradient: "from-[#FF9500] to-[#E08500]",
    bg: "#fff6eb"
  },
  policy: {
    title: "Policy Ask",
    note: "Rulebook & instant AI citations",
    badge: "Official Rules",
    icon: BookOpen,
    color: "ios-blue",
    gradient: "from-[#007AFF] to-[#0056B3]",
    bg: "#ebf5ff"
  },
  privacy: {
    title: "My Privacy",
    note: "Consent & verified mock identity",
    badge: "Security",
    icon: Fingerprint,
    color: "ios-purple",
    gradient: "from-[#AF52DE] to-[#8E44AD]",
    bg: "#f7effc"
  },
  family: {
    title: "Family Switch",
    note: "Choose a family on shared phone",
    badge: "Household",
    icon: UsersRound,
    color: "ios-teal",
    gradient: "from-[#5AC8FA] to-[#00A3D9]",
    bg: "#edf8fd"
  },
  review: {
    title: "Review Desk",
    note: "Decisions, tamper checks & payouts",
    badge: "Officer Portal",
    icon: ClipboardCheck,
    color: "ios-indigo",
    gradient: "from-[#5856D6] to-[#3B38B0]",
    bg: "#f0f0fd"
  },
  rules: {
    title: "Rule Studio",
    note: "Simulate & publish eligibility rules",
    badge: "Admin Config",
    icon: SlidersHorizontal,
    color: "ios-amber",
    gradient: "from-[#FFCC00] to-[#D4A600]",
    bg: "#fef9e8"
  },
  audit: {
    title: "Audit Vault",
    note: "Safety metrics & forensic trail",
    badge: "Compliance",
    icon: Scale,
    color: "ios-rose",
    gradient: "from-[#FF2D55] to-[#D81B43]",
    bg: "#fdeef1"
  },
} satisfies Record<MiniApp, { title: string; note: string; badge?: string; icon: typeof FileText; color: string; gradient: string; bg: string }>;
