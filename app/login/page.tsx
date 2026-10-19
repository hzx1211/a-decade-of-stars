import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthStatus } from "@/lib/server";
import { LoginForm } from "@/components/login-form";
import { VMark } from "@/components/v-mark";
import { SharedArtwork } from "@/components/motion";
import { GlassLayers } from "@/components/liquid-glass-effects";

// Public, code-drawn scenery; private photos and background frames stay behind authentication.
const stars = Array.from({ length: 58 }, (_, index) => {
  const fraction = (seed: number) => { const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return value - Math.floor(value); };
  const size = index % 13 === 0 ? 3 : index % 4 === 0 ? 2 : 1;
  return { left: `${fraction(index + 1) * 100}%`, top: `${fraction(index + 81) * 100}%`, width: size, height: size, animationDelay: `${-fraction(index + 161) * 8}s`, animationDuration: `${4 + fraction(index + 241) * 5}s` };
});

export const dynamic="force-dynamic";
export const metadata={title:"进入私人纪念馆"};
export default async function LoginPage(){
  const status=await getAuthStatus();if(status.authenticated)redirect("/app/dashboard");
  return <main className="login-page stage-login glass-login">
    <div className="login-sky" aria-hidden="true" data-motion-managed="">
      <div className="login-sky-glow" />
      <div className="login-sky-orbit" />
      {stars.map((style, index) => <i key={index} className="login-sky-star" style={style} />)}
      <i className="login-meteor login-meteor-one" /><i className="login-meteor login-meteor-two" /><i className="login-meteor login-meteor-three" />
    </div>
    <div className="login-story stage-login-story"><SharedArtwork name="archive-v"><VMark className="stage-login-v"/></SharedArtwork>
      <Link href="/" className="wordmark stage-wordmark"><SharedArtwork name="archive-logo"><VMark size={48}/></SharedArtwork><span>张杰<small>PERSONAL ARCHIVE · 私人纪念馆</small></span></Link>
      <div className="stage-login-copy"><p className="stage-kicker">FOREVER BY YOUR SIDE</p><h1>张杰<span>JASON ZHANG</span></h1><p>张杰勇敢飞，<br/>星星永相随。</p><span>2009 — {new Date().getFullYear()} · MY PRIVATE COLLECTION</span></div>
    </div>
    <div className="login-form-side stage-login-form"><section className="login-glass-card" aria-label="私人纪念馆登录"><GlassLayers /><LoginForm setupRequired={status.setupRequired} mode={status.mode}/></section></div>
  </main>;
}
