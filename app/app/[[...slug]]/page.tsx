import { notFound, redirect } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { requireOwner, getEntries, getAssets, getSettings } from "@/lib/server";
import { entryKinds, kindLabels, type EntryKind } from "@/lib/types";
import {hasThemeMedia} from "@/lib/server/theme-media";
export async function generateMetadata({params}:{params:Promise<{slug?:string[]}>}) {
  const {slug=[]}=await params;
  const names:Record<string,string>={calendar:"纪念日历",search:"搜索珍藏",archive:"综合典藏馆","star-map":"我的追星星系",admin:"内容管理",settings:"网站设置"};
  return {title:kindLabels[slug[0] as EntryKind]||names[slug[0]]||"我的星海"};
}
export default async function WorkspacePage({params}:{params:Promise<{slug?:string[]}>}) {
  const {slug=[]}=await params;if(!slug.length)redirect("/app/dashboard");const kind=slug[0];
  const allowed=[...entryKinds,"calendar","search","archive","star-map","admin","settings"] as string[];
  if(!allowed.includes(kind)||slug.length>2)notFound();
  if(kind==="admin"&&slug[1]&&!["music","videos","photos","memories"].includes(slug[1]))notFound();
  const owner=await requireOwner();const [entries,assets,settings,themeMediaAvailable]=await Promise.all([getEntries(owner.id),getAssets(owner.id),getSettings(owner.id),hasThemeMedia()]);
  if(slug[1]&&kind!=="admin"&&!entries.some(e=>e.id===slug[1]&&e.kind===kind))notFound();
  return <Workspace kind={kind==="admin"&&slug[1]?`admin/${slug[1]}`:kind} initialEntries={entries} initialAssets={assets} settings={settings} themeMediaAvailable={themeMediaAvailable} detailId={kind!=="admin"?slug[1]:undefined}/>;
}
