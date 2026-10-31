import type { NextRequest } from "next/server";
import { z } from "zod";
import { aiPreflight, aiReply, aiSession, chargeAi } from "@/lib/ai/cloud";
import { AiFailure, generateJson } from "@/lib/ai/engine";

/**
 * Compras → Foto de ticket con IA (solo plan Max).
 *   POST { image: { mediaType, data(base64) }, supplier?, ingredients: [{ id, name, unit }],
 *          aliases: [{ ticketName, ingredientId, quantity }] }
 * Claude lee el ticket de compra y relaciona cada renglón con un insumo del
 * inventario. No guarda nada: la pantalla lo muestra para revisarlo y luego
 * llena la compra. Mismo control de plan y presupuesto que el menú con IA.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_BASE64 = 4 * 1024 * 1024;

const TicketSchema = z.object({
  supplier: z.string(),
  invoice: z.string(),
  date: z.string(),
  total: z.number(),
  lines: z.array(
    z.object({
      ticketName: z.string(),
      presentations: z.number(),
      lineTotal: z.number(),
      ingredientId: z.number().nullable(),
      inventoryQuantity: z.number(),
    })
  ),
  warnings: z.array(z.string()),
});

export type AiPurchaseTicket = z.infer<typeof TicketSchema>;

const SYSTEM = `Eres el asistente de B-POS, el punto de venta de un restaurante en México.
Vas a leer la foto de un ticket o factura de COMPRA (lo que el restaurante le compró a un proveedor: supermercado, carnicería, distribuidor) y convertirlo en una compra para el inventario.

Datos del ticket:
- supplier: nombre del proveedor o tienda como aparece arriba del ticket ("" si no se ve).
- invoice: folio, número de ticket o factura ("" si no hay).
- date: fecha del ticket en formato AAAA-MM-DD ("" si no se ve).
- total: el total pagado del ticket como número.

Renglones (lines), uno por cada artículo comprado. Ignora subtotales, IVA, descuentos generales, formas de pago, cambio y publicidad.
- ticketName: el nombre del artículo como aparece en el ticket.
- presentations: cuántas piezas o paquetes de ese artículo se compraron (si dice 3 x 25.50, son 3). Si es a granel por peso (1.250 kg), pon 1.
- lineTotal: lo que se pagó por ese renglón en pesos, como número.
- ingredientId: el id del insumo del inventario que corresponde (te doy la lista con id, nombre y unidad). Usa también las equivalencias aprendidas. Si ninguno corresponde con seguridad, pon null.
- inventoryQuantity: cuánto entra al inventario EN LA UNIDAD DEL INSUMO (g, ml o pza) sumando todas las presentaciones. Ejemplos: 2 paquetes de pan de 8 piezas en un insumo en pza = 16; 1.250 kg de carne en un insumo en g = 1250; 3 refrescos de 600 ml en un insumo en ml = 1800. Si hay una equivalencia aprendida para ese artículo, multiplica su cantidad por presentations. Si ingredientId es null o no se puede saber, pon 0.
- warnings: avisos cortos en español de lo que esté borroso, dudoso o no sea un ticket de compra.
No inventes artículos ni precios que no se lean.`;

export function OPTIONS(request: NextRequest) {
  return aiPreflight(request);
}

export async function POST(request: NextRequest) {
  const session = await aiSession(request);
  if ("error" in session) return session.error;

  let image: { mediaType: string; data: string } | null = null;
  let supplier = "";
  let ingredients: { id: number; name: string; unit: string }[] = [];
  let aliases: { ticketName: string; ingredientId: number; quantity: number }[] = [];
  try {
    const body = await request.json();
    image = body?.image ?? null;
    supplier = typeof body?.supplier === "string" ? body.supplier.slice(0, 80) : "";
    ingredients = (Array.isArray(body?.ingredients) ? body.ingredients : []).slice(0, 600);
    aliases = (Array.isArray(body?.aliases) ? body.aliases : []).slice(0, 400);
  } catch {
    return aiReply(request, { success: false, error: "La foto pesa demasiado. Tómala de nuevo un poco más lejos." }, 400);
  }
  if (!image || !IMAGE_TYPES.has(image.mediaType)) return aiReply(request, { success: false, error: "Sube una foto del ticket (JPG, PNG o WEBP)." }, 400);
  if (String(image.data || "").length > MAX_BASE64) return aiReply(request, { success: false, error: "La foto pesa demasiado." }, 413);

  const catalog = ingredients.map((i) => `${Number(i.id)} | ${String(i.name).slice(0, 60)} | ${String(i.unit)}`).join("\n");
  const learned = aliases
    .map((a) => `"${String(a.ticketName).slice(0, 60)}" → insumo ${Number(a.ingredientId)}, ${Number(a.quantity)} por presentación`)
    .join("\n");

  try {
    const response = await generateJson(session.ai!, {
      system: SYSTEM,
      schema: TicketSchema,
      maxTokens: 16000,
      effort: "medium",
      parts: [
        { type: "image", mediaType: image.mediaType, data: image.data },
        {
          type: "text",
          text: `Insumos del inventario (id | nombre | unidad):\n${catalog || "(no hay insumos)"}\n\nEquivalencias aprendidas:\n${learned || "(ninguna)"}\n\n${supplier ? `El proveedor es: ${supplier}.\n` : ""}Lee este ticket de compra.`,
        },
      ],
    });
    await chargeAi(session, response.usage);

    if (response.refusal) return aiReply(request, { success: false, error: "No se pudo leer esta foto. Prueba con otra." }, 422);
    const parsed = response.data;
    if (!parsed) return aiReply(request, { success: false, error: "No se pudo leer el ticket. Intenta de nuevo." }, 502);

    const ids = new Set(ingredients.map((i) => Number(i.id)));
    const ticket: AiPurchaseTicket = {
      ...parsed,
      lines: parsed.lines
        .filter((l) => l.ticketName.trim())
        .map((l) => ({
          ...l,
          ticketName: l.ticketName.trim(),
          presentations: l.presentations > 0 ? l.presentations : 1,
          lineTotal: Math.round(Math.max(0, l.lineTotal) * 100) / 100,
          ingredientId: l.ingredientId !== null && ids.has(l.ingredientId) ? l.ingredientId : null,
          inventoryQuantity: Math.max(0, l.inventoryQuantity),
        })),
    };
    return aiReply(request, { success: true, ticket });
  } catch (error) {
    return aiReply(request, { success: false, error: error instanceof AiFailure ? error.message : "Error con la IA." }, error instanceof AiFailure ? error.status : 502);
  }
}
