import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AppError } from "@/lib/server/errors";

export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !process.env.SUPABASE_OWNER_ID) throw new AppError(503, "Supabase 尚未配置，请填写 URL、publishable key 与服务端所有者 ID", "SUPABASE_NOT_CONFIGURED");
  const cookieStore = await cookies();
  return createServerClient(url, key, {cookies: {
    getAll() {return cookieStore.getAll();},
    setAll(values) {try {for (const {name, value, options} of values) cookieStore.set(name, value, options);} catch { /* Server Components cannot write cookies; route handlers refresh them. */ }},
  }});
}
