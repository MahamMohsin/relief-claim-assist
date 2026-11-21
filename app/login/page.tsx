import { Workspace } from "@/src/components/Workspace";
import { getProfile } from "@/src/lib/profile";

export default async function Login() {
  return <Workspace initialProfile={await getProfile()} demoRegistrationEnabled={process.env.RELIEF_DEMO_REGISTRATION === "true"} showLogin />;
}
