"use client";
import Link from "next/link";
export default function ErrorPage({reset}:{error:Error&{digest?:string};reset:()=>void}){return <div className="error-page"><p className="eyebrow">A MOMENT OF PAUSE</p><h1>星光稍作停留。</h1><p>读取内容时遇到了问题，请重试。若使用云端模式，请检查服务配置。</p><button className="button button-light" onClick={reset}>重新读取</button><Link href="/">返回首页</Link></div>}
