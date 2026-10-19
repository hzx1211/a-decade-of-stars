import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { getAuthStatus } from "@/lib/server";
import { VMark } from "@/components/v-mark";
import { SharedArtwork } from "@/components/motion";
export const dynamic="force-dynamic";
export default async function Landing() {
  const status=await getAuthStatus();if(status.authenticated)redirect("/app/dashboard");
  return <main className="stage-landing">
    <Link href="/" className="wordmark stage-wordmark"><SharedArtwork name="archive-logo"><VMark size={48}/></SharedArtwork><span>张杰<small>PERSONAL ARCHIVE · 私人纪念馆</small></span></Link>
    <SharedArtwork name="archive-v"><VMark className="stage-landing-v"/></SharedArtwork>
    <div className="stage-landing-content"><p className="stage-kicker">MY JOURNEY WITH JASON ZHANG</p>
      <h1>张杰<span>JASON ZHANG</span></h1>
      <p className="stage-landing-motto">张杰勇敢飞，星星永相随。</p>
      <p className="stage-landing-description">从 2009 年开始。<br/>把听过的歌、看过的舞台，和自己的故事，留在这里。</p>
      <Link href="/login" className="stage-enter">{status.setupRequired?"建立我的纪念馆":"进入我的纪念馆"}<ArrowUpRight size={19}/></Link>
    </div>
    <footer className="stage-landing-footer"><span>2009 — {new Date().getFullYear()} <i/> PRIVATE COLLECTION</span></footer>
  </main>;
}
