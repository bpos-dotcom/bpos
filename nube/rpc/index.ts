/**
 * Registro de las funciones RPC de la nube (nombre igual al de Supabase).
 */
import type { RpcFn } from "../rpc-types";
import { COMMON_RPC } from "./common";

export const RPC_FUNCTIONS: Record<string, RpcFn> = {
  ...COMMON_RPC,
};
