/**
 * Registro de las funciones RPC de la nube (nombre igual al de Supabase).
 */
import type { RpcFn } from "../rpc-types";
import { COMMON_RPC } from "./common";
import { MENU_RPC } from "./menu";
import { CLUB_RPC } from "./club";
import { AGENT_RPC } from "./agent";
import { AI_RPC } from "./ai";
import { ADMIN_RPC } from "./admin";

export const RPC_FUNCTIONS: Record<string, RpcFn> = {
  ...COMMON_RPC,
  ...MENU_RPC,
  ...CLUB_RPC,
  ...AGENT_RPC,
  ...AI_RPC,
  ...ADMIN_RPC,
};
