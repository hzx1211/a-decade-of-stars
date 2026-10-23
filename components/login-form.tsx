"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Eye, EyeOff, LockKeyhole, LoaderCircle } from "lucide-react";
import { request, errorMessage } from "./client-utils";
import { MotionPresence, MotionSwap } from "./motion";

export function LoginForm({ setupRequired }: { setupRequired: boolean; mode: string }) {
  const router = useRouter();
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false); const [pending, setPending] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending) return; setPending(true); setError("");
    try { await request(setupRequired ? "/api/auth/setup" : "/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }); router.push("/app/dashboard"); router.refresh(); }
    catch (failure) { setError(errorMessage(failure)); setPending(false); }
  }
  return <form onSubmit={submit} className="ws-login-form">
    <div className="ws-login-lock"><LockKeyhole size={22} /></div>
    <h2>{setupRequired ? "建立你的私人纪念馆" : "欢迎回来"}</h2>
    <p className="ws-muted">{setupRequired ? "第一次进入，创建你的登录账号。" : "接着听歌，继续记录。"}</p>
    <label className="ws-field">邮箱<input type="email" name="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required placeholder="your@email.com" disabled={pending} /></label>
    <label className="ws-field">密码<div className="ws-password"><input type={visible ? "text" : "password"} name="password" autoComplete={setupRequired ? "new-password" : "current-password"} minLength={setupRequired ? 12 : 1} value={password} onChange={event => setPassword(event.target.value)} required placeholder={setupRequired ? "至少 12 位，建议使用完整句子" : "输入你的私人密码"} disabled={pending} /><button type="button" className="ws-icon-button" aria-label={visible ? "隐藏密码" : "显示密码"} aria-pressed={visible} onClick={() => setVisible(value => !value)} disabled={pending}><MotionSwap motionKey={visible ? "visible" : "hidden"} as="span" className="control-icon-swap">{visible ? <EyeOff size={18} /> : <Eye size={18} />}</MotionSwap></button></div></label>
    <MotionPresence show={!!error}><p className="ws-error" role="alert">{error}</p></MotionPresence>
    <button type="submit" className="ws-button ws-login-submit" disabled={pending} aria-busy={pending}><MotionSwap motionKey={pending ? "pending" : "ready"} as="span" className="login-submit-content">{pending ? <LoaderCircle size={18} className="ws-spin" /> : <ArrowRight size={18} />}{pending ? "正在验证…" : setupRequired ? "创建我的私人纪念馆" : "进入纪念馆"}</MotionSwap></button>
    <div className="ws-login-links">
      <Link href="/app/dashboard" className="ws-guest-entry">
        <Eye size={18} aria-hidden="true" />
        <span><strong>以访客身份浏览</strong><small>仅查看已公开的精选内容</small></span>
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
      {!setupRequired && <p className="ws-tiny"><Link href="/auth/reset-password">忘记密码</Link></p>}
    </div>
  </form>;
}
