import "server-only";
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authSchema } from "@/lib/validation/schemas";
import { defaultSettings } from "@/lib/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dataMode } from "./config";
import { getDatabase, transaction } from "./db";
import { AppError } from "./errors";
import { assertLoopback, assertSameOrigin, clearAuthAttempts, rateLimitAuth, readJson } from "./security";

const deriveKey = promisify(scrypt);
const cookieName = "stars_owner_session";
const sessionSeconds = 7 * 24 * 3600;
export type Owner = {id: string; email: string};
export async function hashPassword(password: string) {
  const salt = randomBytes(32).toString("hex"); const key = await deriveKey(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${key.toString("hex")}`;
}
async function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, encoded] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !encoded) return false;
  const actual = await deriveKey(password, salt, 64) as Buffer; const expected = Buffer.from(encoded, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function tokenHash(token: string) {return createHash("sha256").update(token).digest("hex");}
async function createSession(ownerId: string) {
  const token = randomBytes(32).toString("base64url");
  const db = getDatabase(); db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
  db.prepare("INSERT INTO sessions(token_hash,owner_id,expires_at) VALUES(?,?,?)").run(tokenHash(token), ownerId, Date.now() + sessionSeconds * 1000);
  (await cookies()).set(cookieName, token, {httpOnly: true, secure: process.env.APP_ORIGIN?.startsWith("https://") === true, sameSite: "strict", path: "/", maxAge: sessionSeconds});
}
export async function currentOwner(): Promise<Owner | null> {
  if (dataMode() === "supabase") {
    const client = await createSupabaseServerClient(); const {data, error} = await client.auth.getUser();
    if (error || !data.user || data.user.id !== process.env.SUPABASE_OWNER_ID) return null;
    const {data: profile} = await client.from("profiles").select("id").eq("id", data.user.id).maybeSingle();
    if (!profile) return null;
    return {id: data.user.id, email: data.user.email || ""};
  }
  const token = (await cookies()).get(cookieName)?.value;
  if (!token || token.length > 100) return null;
  const owner = getDatabase().prepare("SELECT owners.id,owners.email FROM sessions JOIN owners ON owners.id=sessions.owner_id WHERE token_hash=? AND expires_at>?").get(tokenHash(token), Date.now()) as Owner | undefined;
  return owner || null;
}
export async function getAuthStatus() {
  const mode = dataMode();
  let authenticated = false;
  try {authenticated = Boolean(await currentOwner());} catch (error) {if (!(error instanceof AppError) || error.code !== "SUPABASE_NOT_CONFIGURED") throw error;}
  const setupRequired = mode === "local" && !getDatabase().prepare("SELECT id FROM owners LIMIT 1").get();
  return {authenticated, setupRequired, mode};
}
export async function requireOwner(): Promise<Owner> {
  let owner: Owner | null = null;
  try {owner = await currentOwner();} catch (error) {if (!(error instanceof AppError) || error.code !== "SUPABASE_NOT_CONFIGURED") throw error;}
  if (!owner) redirect("/login"); return owner;
}
export async function requireApiOwner(): Promise<Owner> {const owner = await currentOwner(); if (!owner) throw new AppError(401, "请先登录所有者账号", "UNAUTHENTICATED"); return owner;}
export async function setupOwner(request: Request) {
  assertSameOrigin(request); assertLoopback(request);
  if (dataMode() !== "local") throw new AppError(403, "Supabase 模式请在服务控制台受控创建所有者账号");
  const input = authSchema.parse(await readJson(request, 4096)); rateLimitAuth("setup");
  const hash = await hashPassword(input.password); const ownerId = randomUUID(); const now = new Date().toISOString();
  transaction(() => {
    const db = getDatabase();
    if (db.prepare("SELECT id FROM owners LIMIT 1").get()) throw new AppError(409, "所有者账号已经创建，本站不开放注册", "SETUP_COMPLETE");
    db.prepare("INSERT INTO owners(id,email,password_hash,created_at) VALUES(?,?,?,?)").run(ownerId, input.email, hash, now);
    db.prepare("INSERT INTO site_settings(owner_id,settings,updated_at) VALUES(?,?,?)").run(ownerId, JSON.stringify(defaultSettings), now);
  });
  await createSession(ownerId);
}
export async function loginOwner(request: Request) {
  assertSameOrigin(request);
  const input = authSchema.parse(await readJson(request, 4096)); rateLimitAuth("login");
  if (dataMode() === "supabase") {
    const client = await createSupabaseServerClient(); const {data, error} = await client.auth.signInWithPassword(input);
    if (error || data.user?.id !== process.env.SUPABASE_OWNER_ID) {await client.auth.signOut(); throw new AppError(401, "账号或密码不正确，或不是网站所有者", "INVALID_CREDENTIALS");}
    const {data: profile} = await client.from("profiles").select("id").eq("id", data.user.id).maybeSingle();
    if (!profile) {await client.auth.signOut(); throw new AppError(403, "此账号尚未列入网站所有者白名单");}
    clearAuthAttempts("login"); return;
  }
  const owner = getDatabase().prepare("SELECT id,password_hash FROM owners WHERE email=?").get(input.email) as {id: string; password_hash: string} | undefined;
  if (!owner) {await hashPassword(input.password); throw new AppError(401, "账号或密码不正确", "INVALID_CREDENTIALS");}
  if (!await verifyPassword(input.password, owner.password_hash)) throw new AppError(401, "账号或密码不正确", "INVALID_CREDENTIALS");
  await createSession(owner.id); clearAuthAttempts("login");
}
export async function logoutOwner(request: Request) {
  assertSameOrigin(request);
  if (dataMode() === "supabase") {const client = await createSupabaseServerClient(); await client.auth.signOut(); return;}
  const store = await cookies(); const token = store.get(cookieName)?.value;
  if (token) getDatabase().prepare("DELETE FROM sessions WHERE token_hash=?").run(tokenHash(token));
  store.set(cookieName, "", {httpOnly: true, secure: process.env.APP_ORIGIN?.startsWith("https://") === true, sameSite: "strict", path: "/", maxAge: 0});
}
