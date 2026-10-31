/**
 * Bridge → "🤖 Sugerir con IA": a qué producto de B-POS corresponde un
 * renglón nuevo de un ticket de delivery ("Boneless Individuales (8 pzs)"
 * → "Boneless Orden Individual"). Solo sugiere: la persona revisa y guarda.
 */
import { z } from "zod";
import { generateJson, type AiUsage } from "@/lib/ai/engine";
import type { AiConfig } from "@/lib/ai/settings";

const MatchSchema = z.object({
  matches: z.array(
    z.object({
      line: z.string(),
      action: z.enum(["product", "ignore", "unknown"]),
      productId: z.number(), // 0 si no es un producto
      confidence: z.enum(["alta", "media", "baja"]),
      reason: z.string(),
    })
  ),
});

export type LineMatch = z.infer<typeof MatchSchema>["matches"][number];
export type CatalogProduct = { id: number; name: string; category?: string; price?: number };

const SYSTEM = `Eres el asistente del Bridge de B-POS, el punto de venta de un restaurante en México.
Llegan renglones de tickets de Rappi, Uber Eats y DiDi Food con el nombre que usa la plataforma. Tu trabajo es decir a qué producto del catálogo de B-POS corresponde cada renglón.

Reglas:
- action "product": el renglón es un producto que se vende; productId es el id EXACTO de la lista del catálogo. Las plataformas cambian mayúsculas, agregan piezas o tamaños entre paréntesis, emojis o palabras como "Orden", "Combo"; fíjate en el tamaño o número de piezas para elegir la variante correcta (Individual, Doble, 1 Kg...).
- action "ignore": no es un producto para cocina (cubiertos, popote, bolsa, propina, envío, servicio, "sin cubiertos", notas). productId 0.
- action "unknown": no hay un producto del catálogo que corresponda con seguridad. productId 0. No inventes ids.
- confidence: "alta" si el nombre y el tamaño coinciden claramente, "media" si coincide el producto pero el tamaño es dudoso, "baja" si es una suposición.
- reason: en español, una frase corta que explique la elección (ej. "8 piezas = orden individual").
- Regresa un elemento por cada renglón, en el mismo orden y con el texto del renglón tal cual en line.`;

/** Sugerencias para los renglones y lo que gastó; lanza AiFailure si la IA falla. */
export async function matchLines(
  ai: AiConfig,
  lines: string[],
  platform: string,
  products: CatalogProduct[]
): Promise<{ matches: LineMatch[] | "refusal" | null; usage?: AiUsage }> {
  const catalog = products.map((p) => `${p.id} | ${p.name} | ${p.category || ""} | $${p.price || 0}`).join("\n");
  const response = await generateJson(ai, {
    system: SYSTEM,
    schema: MatchSchema,
    maxTokens: 8000,
    effort: "low",
    parts: [
      {
        type: "text",
        text: `Catálogo de B-POS (id | nombre | categoría | precio):\n${catalog}\n\nPlataforma: ${platform || "desconocida"}\nRenglones del ticket:\n${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`,
      },
    ],
  });
  const usage = response.usage;
  if (response.refusal) return { matches: "refusal", usage };
  const parsed = response.data;
  if (!parsed) return { matches: null, usage };
  // Solo ids que existen de verdad
  const ids = new Set(products.map((p) => p.id));
  return { matches: parsed.matches.map((m) => (m.action === "product" && !ids.has(m.productId) ? { ...m, action: "unknown" as const, productId: 0 } : m)), usage };
}
