import { NextResponse, type NextRequest } from "next/server";
import { notifyOnlineOrder } from "@/lib/push/online-order";

/**
 * Aviso al celular del negocio cuando un cliente manda un pedido desde el
 * menú digital (aunque la caja esté apagada).
 *
 * Lo llama la página del cliente (sin sesión) al mandar su pedido:
 *   POST { id, token }  (la misma llave con la que ve su pedido)
 * El texto sale del pedido guardado y se manda una sola vez por pedido.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reply = (body: object, status = 200) => NextResponse.json(body, { status });

export async function POST(request: NextRequest) {
  let id = "";
  let token = "";
  try {
    const body = await request.json();
    id = typeof body?.id === "string" ? body.id : "";
    token = typeof body?.token === "string" ? body.token : "";
  } catch {
    return reply({ success: false, error: "Petición inválida." }, 400);
  }
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f]{32}$/i.test(token)) return reply({ success: false, error: "Petición inválida." }, 400);
  const sent = await notifyOnlineOrder(id, token).catch(() => 0);
  return reply({ success: true, sent });
}
