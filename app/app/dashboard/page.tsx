import { requireOwner, getEntries, getSettings } from "@/lib/server";
import { Dashboard } from "@/components/dashboard";
import {hasThemeMedia} from "@/lib/server/theme-media";
export const metadata={title:"星海首页"};
export default async function DashboardPage(){const owner=await requireOwner();const [entries,settings,themeMediaAvailable,beidouMediaAvailable]=await Promise.all([getEntries(owner.id),getSettings(owner.id),hasThemeMedia(),hasThemeMedia("beidou")]);return <Dashboard entries={entries} settings={settings} themeMediaAvailable={themeMediaAvailable} beidouMediaAvailable={beidouMediaAvailable}/>}
