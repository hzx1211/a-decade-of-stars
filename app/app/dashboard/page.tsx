import { currentOwner } from "@/lib/server/auth";
import { getEntries, getSettings, getPublicState } from "@/lib/server/store";
import { Dashboard } from "@/components/dashboard";
import {hasThemeMedia} from "@/lib/server/theme-media";
export const metadata={title:"星海首页"};
export default async function DashboardPage(){
  const owner=await currentOwner();
  if(owner){
    const [entries,settings,themeMediaAvailable,beidouMediaAvailable]=await Promise.all([getEntries(owner.id),getSettings(owner.id),hasThemeMedia(),hasThemeMedia("beidou")]);
    return <Dashboard entries={entries} settings={settings} themeMediaAvailable={themeMediaAvailable} beidouMediaAvailable={beidouMediaAvailable}/>;
  }
  const {entries,settings}=await getPublicState();
  return <Dashboard entries={entries} settings={settings} readOnly/>;
}
