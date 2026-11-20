import { Workspace } from "@/src/components/Workspace";
import { getProfile } from "@/src/lib/profile";

export default async function Page() {
  return <Workspace initialProfile={await getProfile()} />;
}
