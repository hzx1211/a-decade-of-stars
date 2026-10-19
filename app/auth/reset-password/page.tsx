import Link from "next/link";
import { getAuthStatus } from "@/lib/server/auth";
import ResetForm from "./reset-form";
export const dynamic = "force-dynamic";
export default async function ResetPasswordPage() {
  const status = await getAuthStatus();
  return <main className="policy-page"><p className="eyebrow">PRIVATE ARCHIVE · ACCOUNT RECOVERY</p><h1>找回这片星光</h1>
    {status.mode === "local" ? <><p>本地账号的密码由你自己的电脑保管。为保护这座私人纪念馆，网页不提供无需验证的账号重置。</p><p>请在项目目录打开终端，运行 <code>npm run owner:reset</code>，按提示设置新密码。已有文字、设置和媒体会保留，旧会话会全部失效。</p><p><Link href="/login">返回登录</Link></p></> : <><p>使用所有者邮箱接收恢复链接。打开邮件里的链接后，可以在此设置新密码。</p><ResetForm authenticated={status.authenticated} /></>}
  </main>;
}
