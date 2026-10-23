import "server-only";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function refreshSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({request});
  if (process.env.DATA_MODE !== "supabase") return response;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;
  const client = createServerClient(url, key, {cookieOptions: {httpOnly: true, secure: process.env.APP_ORIGIN?.startsWith("https://") === true, sameSite: "lax", path: "/"}, cookies: {
    getAll() {return request.cookies.getAll();},
    setAll(values) {
      for (const {name, value} of values) request.cookies.set(name, value);
      response = NextResponse.next({request});
      for (const {name, value, options} of values) response.cookies.set(name, value, options);
    },
  }});
  // getClaims verifies the token; private routes additionally use getUser + the server owner allowlist.
  try {await client.auth.getClaims();} catch { /* API/page authorization handles unavailable authentication. */ }
  return response;
}
