import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class AppError extends Error { constructor(public status: number, message: string, public code = "REQUEST_FAILED") { super(message); } }
export async function api<T>(run: () => Promise<T>): Promise<T | NextResponse> {
  try { return await run(); } catch (error) {
    if (error instanceof AppError) return json({error: error.message, code: error.code}, {status: error.status});
    if (error instanceof ZodError) return json({error: error.issues[0]?.message || "数据格式不正确", issues: error.issues.map(i => ({path: i.path, message: i.message}))}, {status: 400});
    console.error("[private-museum] Request failed", error instanceof Error ? error.message : "Unknown error");
    return json({error: "服务暂时无法完成操作，请重试。", code: "INTERNAL_ERROR"}, {status: 500});
  }
}
export function json(value: unknown, init?: ResponseInit) { return NextResponse.json(value, {...init, headers: {...init?.headers, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"}}); }
