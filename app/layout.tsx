import type { Metadata } from "next";
import "./globals.css";
import "./stage.css";
import "@/components/dashboard.css";
import "./motion.css";
import "@/components/secondary-design.css";
import "@/components/starsea-design.css";
import "@/components/liquid-glass.css";
import "@/components/login-glass.css";
import { MotionRoot } from "@/components/motion";
import { LiquidGlassEffects } from "@/components/liquid-glass-effects";
export const metadata: Metadata = { title: { default: "一路星光 · 十余年星途纪念馆", template: "%s · 一路星光" }, description: "张杰勇敢飞，星星永相随。从2009年开始的私人音乐、影像与回忆纪念馆。", robots: { index: false, follow: false } };
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="zh-CN" data-scroll-behavior="smooth"><body><MotionRoot>{children}</MotionRoot><LiquidGlassEffects /></body></html>}
