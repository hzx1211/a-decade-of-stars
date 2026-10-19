import { requireOwner, getSettings, getEntries, getAssets } from "@/lib/server";
import { Shell } from "@/components/shell";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export default async function PrivateLayout({children}:{children:React.ReactNode}){const owner=await requireOwner();const [settings,entries,assets]=await Promise.all([getSettings(owner.id),getEntries(owner.id),getAssets(owner.id)]);return <Shell settings={settings} initialEntries={entries} initialAssets={assets}>{children}</Shell>}
