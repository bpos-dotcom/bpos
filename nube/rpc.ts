/**
 * /rest/v1/rpc/<función>: las funciones de Supabase (plpgsql) reescritas en
 * TypeScript sobre D1. Cada una revisa lo mismo que la original (quién llama
 * y a qué negocio pertenece) y regresa lo mismo.
 */
import type { Row } from "./db";
import type { Reply } from "./rest";
import type { RpcCtx } from "./rpc-types";
import { errorReply } from "./rest";
import { RestError } from "./postgrest";
import { RPC_FUNCTIONS } from "./rpc/index";

export { RpcError, type RpcCtx, type RpcFn } from "./rpc-types";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export async function handleRpc(ctx: RpcCtx, fn: string, args: Row, headers: Headers): Promise<Reply> {
  const run = RPC_FUNCTIONS[fn];
  if (!run) return errorReply(new RestError(404, "PGRST202", `Could not find the function public.${fn} in the schema cache`));
  try {
    const result = await run(ctx, args || {});
    if (result === undefined) return { status: 204, headers: {}, body: null };
    if ((headers.get("accept") || "").includes("application/vnd.pgrst.object+json") && Array.isArray(result)) {
      if (result.length !== 1) throw new RestError(406, "PGRST116", "JSON object requested, multiple (or no) rows returned");
      return { status: 200, headers: JSON_HEADERS, body: JSON.stringify(result[0]) };
    }
    return { status: 200, headers: JSON_HEADERS, body: JSON.stringify(result) };
  } catch (e) {
    return errorReply(e);
  }
}
