/**
 * Ayudantes de las funciones (is_member, is_platform_admin, branch_business…)
 * y las funciones RPC más simples.
 */
import type { Db } from "../db";
import type { RpcCtx, RpcFn } from "../rpc-types";
import { RpcError } from "../rpc-types";

export async function isMember(ctx: Pick<RpcCtx, "db" | "auth">, businessId: unknown) {
  if (ctx.auth.role === "service") return true;
  if (!ctx.auth.uid || typeof businessId !== "string") return false;
  return Boolean(await ctx.db.first("SELECT 1 AS ok FROM business_members WHERE business_id = ? AND user_id = ?", [businessId, ctx.auth.uid]));
}

export async function isPlatformAdmin(ctx: Pick<RpcCtx, "db" | "auth">) {
  if (!ctx.auth.uid) return false;
  return Boolean(await ctx.db.first("SELECT 1 AS ok FROM platform_admins WHERE user_id = ?", [ctx.auth.uid]));
}

export async function branchBusiness(db: Db, branchId: unknown): Promise<string | null> {
  if (typeof branchId !== "string") return null;
  return (await db.first<{ business_id: string }>("SELECT business_id FROM branches WHERE id = ?", [branchId]))?.business_id ?? null;
}

/** La sucursal es de un negocio de quien llama (assert_branch_access) */
export async function assertBranchAccess(ctx: Pick<RpcCtx, "db" | "auth">, branchId: unknown) {
  const business = await branchBusiness(ctx.db, branchId);
  if (!business || !(await isMember(ctx, business))) throw new RpcError("No tienes acceso a esa sucursal.", 403, "42501");
  return business;
}

export function requireUser(ctx: RpcCtx) {
  if (ctx.auth.role !== "authenticated" || !ctx.auth.uid) throw new RpcError("Inicia sesión.", 401, "42501");
  return ctx.auth.uid;
}

/** SHA-256 en hexadecimal (encode(digest(x, 'sha256'), 'hex')) */
export async function sha256Hex(text: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Texto al azar de un alfabeto (como los folios y códigos de Supabase) */
export function randomFrom(alphabet: string, length: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

export const randomHex = (bytes: number) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

export const COMMON_RPC: Record<string, RpcFn> = {
  is_platform_admin: async (ctx) => isPlatformAdmin(ctx),
  is_member: async (ctx, args) => isMember(ctx, args.p_business_id ?? args.business_id),
};
