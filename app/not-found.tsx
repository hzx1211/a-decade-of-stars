import Link from "next/link";
import { Starfield, StarMark } from "@/components/starfield";
export default function NotFound(){return <main className="not-found"><Starfield/><div><StarMark size={40}/><p className="eyebrow">404 · A STAR YET TO BE FOUND</p><h1>这颗星，暂时不在这里。</h1><p>页面可能已移动，或这段记忆还没有被写下。</p><Link href="/" className="button button-light">回到我的星海</Link></div></main>}
