/** Tipos y error de las funciones RPC (aparte para no crear ciclos entre archivos) */
import type { Db, Row } from "./db";
import type { Auth } from "./access";
import type { AuthEnv } from "./auth";
import type { NubeCtx } from "./rest";
import { RestError } from "./postgrest";

export type RpcCtx = {
  db: Db;
  auth: Auth;
  authEnv: AuthEnv;
  onSyncHead?: NubeCtx["onSyncHead"];
  broadcast?: (messages: { topic: string; event: string; payload: unknown }[]) => Promise<void>;
  /** De dónde llama (Cloudflare: IP y ubicación aproximada); no hay en las pruebas ni dentro del servidor */
  geo?: Geo;
};

export type Geo = { ip?: string | null; city?: string | null; region?: string | null; country?: string | null };

export type RpcFn = (ctx: RpcCtx, args: Row) => Promise<unknown>;

/** Error de una función (raise exception): B-POS muestra el mensaje tal cual */
export class RpcError extends RestError {
  constructor(message: string, status = 400, code = "P0001") {
    super(status, code, message);
  }
}
