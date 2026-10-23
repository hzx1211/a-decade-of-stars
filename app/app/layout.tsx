import { currentOwner } from "@/lib/server/auth";
import { getSettings, getEntries, getAssets } from "@/lib/server/store";
import { Shell } from "@/components/shell";
import { getPublicState } from "@/lib/server/store";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export default async function ArchiveLayout({children}:{children:React.ReactNode}){
  const owner=await currentOwner();
  const state=owner
    ? await Promise.all([getSettings(owner.id),getEntries(owner.id),getAssets(owner.id)]).then(([settings,entries,assets])=>({settings,entries,assets}))
    : await getPublicState();
  return <Shell settings={state.settings} initialEntries={state.entries} initialAssets={state.assets} readOnly={!owner}>{children}</Shell>;
}
