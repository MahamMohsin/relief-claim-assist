import { Workspace } from "@/src/components/Workspace";
import { getProfile } from "@/src/lib/profile";
import { LanguageProvider } from "@/src/lib/i18n";

export default async function Page() {
  return <LanguageProvider><Workspace initialProfile={await getProfile()} demoRegistrationEnabled={process.env.RELIEF_DEMO_REGISTRATION === "true"} /></LanguageProvider>;
}
