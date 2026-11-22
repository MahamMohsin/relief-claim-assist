import { BookOpen, ClipboardCheck, FileText, Fingerprint, IdCard, MessageSquareShare, Scale, ShieldCheck, SlidersHorizontal, Users, UsersRound } from "lucide-react";
import type { MiniApp, Role } from "@/src/lib/contracts";
import { appText, pick, type Lang } from "@/src/lib/i18n";

const staffRoles: Role[] = ["officer", "admin", "auditor"];
export function appTitle(id: MiniApp, role?: Role, lang: Lang = "en"): string {
  // Helpers see the profile tile as "Family Profile".
  const key = id === "profile" && role === "helper" ? "familyProfile" : id;
  // Citizen-facing tile names follow the app language; staff screens stay English.
  if (lang === "ur" && appText[key] && !(role && staffRoles.includes(role))) return pick(appText[key], lang);
  return key === "familyProfile" ? "Family Profile" : apps[id].title;
}

export const apps = {
  claim: {
    title: "Relief Claim",
    note: "Apply for aid & track claims",
    badge: "Disbursement",
    icon: FileText,
    image: "/icons/apps/claim.jpg",
    color: "ios-green",
    gradient: "from-[#1B5C51] to-[#134A41]",
    bg: "#E6F0ED"
  },
  profile: {
    title: "My Profile",
    note: "CNIC, bills & job proofs · VLM",
    badge: "Documents",
    icon: IdCard,
    color: "ios-teal",
    gradient: "from-[#2A7364] to-[#134A41]",
    bg: "#E6F0ED"
  },
  scam: {
    title: "Scam Shield",
    note: "Check alerts & verify receipts",
    badge: "Protection",
    icon: ShieldCheck,
    image: "/icons/apps/scam.jpg",
    color: "ios-orange",
    gradient: "from-[#C2552D] to-[#A8441F]",
    bg: "#FBEDE6"
  },
  policy: {
    title: "Policy Ask",
    note: "Rulebook & instant AI citations",
    badge: "Official Rules",
    icon: BookOpen,
    image: "/icons/apps/policy.jpg",
    color: "ios-blue",
    gradient: "from-[#2A7364] to-[#1B5C51]",
    bg: "#E6F0ED"
  },
  privacy: {
    title: "My Privacy",
    note: "Consent & verified mock identity",
    badge: "Security",
    icon: Fingerprint,
    image: "/icons/apps/privacy.jpg",
    color: "ios-purple",
    gradient: "from-[#4F5FC8] to-[#3F4FB8]",
    bg: "#E7EAFB"
  },
  family: {
    title: "Family Switch",
    note: "Choose a family on shared phone",
    badge: "Household",
    icon: UsersRound,
    image: "/icons/apps/family.jpg",
    color: "ios-teal",
    gradient: "from-[#2A7364] to-[#134A41]",
    bg: "#E6F0ED"
  },
  review: {
    title: "Review Desk",
    note: "Decisions, tamper checks & payouts",
    badge: "Officer Portal",
    icon: ClipboardCheck,
    image: "/icons/apps/review.jpg",
    color: "ios-indigo",
    gradient: "from-[#4F5FC8] to-[#3F4FB8]",
    bg: "#E7EAFB"
  },
  rules: {
    title: "Rule Studio",
    note: "Simulate & publish eligibility rules",
    badge: "Admin Config",
    icon: SlidersHorizontal,
    image: "/icons/apps/rules.jpg",
    color: "ios-amber",
    gradient: "from-[#C2552D] to-[#A8441F]",
    bg: "#FBEDE6"
  },
  users: {
    title: "Users",
    note: "Registered accounts & linked records",
    badge: "Directory",
    icon: Users,
    color: "ios-teal",
    gradient: "from-[#5AC8FA] to-[#00A3D9]",
    bg: "#edf8fd"
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
  whatsapp: {
    title: "WhatsApp & SMS",
    note: "Private AI Agent & Google Messages SMS",
    badge: "Messaging",
    icon: MessageSquareShare,
    color: "ios-green",
    gradient: "from-[#25D366] to-[#128C7E]",
    bg: "#E8F8F0"
  },
} satisfies Record<MiniApp, { title: string; note: string; badge?: string; icon: typeof FileText; image?: string; color: string; gradient: string; bg: string }>;
