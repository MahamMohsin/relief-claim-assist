import { BookOpen, ClipboardCheck, FileText, Fingerprint, Scale, ShieldCheck, SlidersHorizontal, UsersRound } from "lucide-react";
import type { MiniApp } from "@/src/lib/contracts";

export const apps = {
  claim: { title: "Relief Claim", note: "Apply for aid or follow an existing claim", icon: FileText, color: "teal" },
  scam: { title: "Scam Shield", note: "Check an SMS or verify a payout", icon: ShieldCheck, color: "orange" },
  policy: { title: "Policy Ask", note: "Find answers in the scheme rules", icon: BookOpen, color: "blue" },
  privacy: { title: "My Privacy", note: "Manage consent and correct your data", icon: Fingerprint, color: "plum" },
  family: { title: "Family Switch", note: "Choose a family on a shared phone", icon: UsersRound, color: "blue" },
  review: { title: "Review Desk", note: "Review evidence, decisions, and payments", icon: ClipboardCheck, color: "teal" },
  rules: { title: "Rule Studio", note: "Simulate and publish eligibility rules", icon: SlidersHorizontal, color: "orange" },
  audit: { title: "Audit Vault", note: "Inspect activity and safety metrics", icon: Scale, color: "plum" },
} satisfies Record<MiniApp, { title: string; note: string; icon: typeof FileText; color: string }>;
