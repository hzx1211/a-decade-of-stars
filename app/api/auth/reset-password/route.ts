import { z } from "zod";
import { api, AppError, json } from "@/lib/server/errors";
import { dataMode } from "@/lib/server/config";
import { requireApiOwner } from "@/lib/server/auth";
import { assertSameOrigin, rateLimitAuth, readJson } from "@/lib/server/security";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const resetSchema = z.discriminatedUnion("action", [z.object({action: z.literal("request"), email: z.email().max(254)}).strict(), z.object({action: z.literal("update"), password: z.string().min(12).max(256)}).strict()]);
export async function POST(request: Request) {return api(async () => {
  assertSameOrigin(request); if (dataMode() !== "supabase") throw new AppError(400, "本地账号请在本机运行 npm run owner:reset，内容与媒体会保留");
  const input = resetSchema.parse(await readJson(request, 4096)); const client = await createSupabaseServerClient();
  if (input.action === "request") {
    rateLimitAuth("password-reset"); const origin = process.env.APP_ORIGIN || new URL(request.url).origin;
    const {error} = await client.auth.resetPasswordForEmail(input.email, {redirectTo: `${origin}/auth/callback?next=/auth/reset-password`});
    if (error) throw new AppError(502, "重置邮件无法发送，请核实 Supabase SMTP 与回调地址配置");
    return json({ok: true, message: "如果该账号存在，将收到密码重置邮件。"});
  }
  await requireApiOwner(); const {error} = await client.auth.updateUser({password: input.password});
  if (error) throw new AppError(400, "密码更新失败，请检查恢复链接是否过期");
  await client.auth.signOut({scope: "global"}); return json({ok: true});
});}
