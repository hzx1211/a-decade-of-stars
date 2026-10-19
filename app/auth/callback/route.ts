import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { currentOwner } from "@/lib/server/auth";
import { api } from "@/lib/server/errors";
import { dataMode } from "@/lib/server/config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {return api(async () => {
  const url = new URL(request.url); const origin = process.env.APP_ORIGIN || url.origin;
  if (dataMode() !== "supabase") return NextResponse.redirect(new URL("/login", origin));
  const code = url.searchParams.get("code");
  if (code) {const client = await createSupabaseServerClient(); const {error} = await client.auth.exchangeCodeForSession(code);
    if (!error && await currentOwner()) {const next = url.searchParams.get("next"); return NextResponse.redirect(new URL(next === "/auth/reset-password" ? next : "/app/dashboard", origin));}
    await client.auth.signOut();
  }
  return NextResponse.redirect(new URL("/login?error=callback", origin));
});}
