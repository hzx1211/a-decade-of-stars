"use client";
import { useState } from "react";
import Link from "next/link";

export default function ResetForm({authenticated}: {authenticated: boolean}) {
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  return <form onSubmit={async event => {
    event.preventDefault(); setBusy(true); setMessage(""); const form = new FormData(event.currentTarget);
    try {const response = await fetch("/api/auth/reset-password", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(authenticated ? {action: "update", password: form.get("password")} : {action: "request", email: form.get("email")})});
      const result = await response.json(); if (!response.ok) throw new Error(result.error); setMessage(authenticated ? "密码已更新，所有会话已退出。请重新登录。" : result.message);
    } catch (error) {setMessage(error instanceof Error ? error.message : "操作失败，请重试");} finally {setBusy(false);}
  }}>
    {authenticated ? <label>新密码（至少 12 个字符）<input type="password" name="password" required minLength={12} maxLength={256} autoComplete="new-password" /></label> : <label>所有者邮箱<input type="email" name="email" required maxLength={254} autoComplete="email" /></label>}
    <button type="submit" disabled={busy}>{busy ? "正在处理…" : authenticated ? "更新密码并退出" : "发送恢复邮件"}</button>
    {message && <p role="status">{message}</p>}<p><Link href="/login">返回登录</Link></p>
  </form>;
}
