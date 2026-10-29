import { NextResponse, type NextRequest } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { guardBridgeRequest } from "@/lib/bridge/api-guard";
import { AI_MODEL, anthropicClient, friendlyAiError, readAnthropicKey } from "@/lib/ai/key-store";

/**
 * Configuración → Subir menú con IA.
 *   POST { files: [{ name, mediaType, data(base64) }], categories: [...] }
 * Claude lee las fotos o PDF del menú y regresa los productos. No guarda
 * nada: la pantalla los muestra para revisarlos antes de agregarlos.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_FILES = 20;
const MAX_BASE64 = 30 * 1024 * 1024; // el límite de Claude por solicitud es 32 MB

const MenuSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      category: z.string(),
      price: z.number(),
      emoji: z.string(),
      station: z.enum(["Parrilla", "Freidora", "Barra", "Cocina"]),
      description: z.string(),
    })
  ),
  warnings: z.array(z.string()),
});

export type MenuItem = z.infer<typeof MenuSchema>["items"][number];

const SYSTEM = `Eres el asistente de B-POS, el punto de venta de un restaurante en México.
Vas a leer fotos, capturas o PDF del menú del restaurante y a convertirlo en la lista de productos que se venden en caja.

Reglas:
- Un producto por cada cosa que se cobra con su propio precio. Si un platillo tiene tamaños o piezas con precios distintos, crea un producto por cada uno, con el tamaño en el nombre (por ejemplo "Alitas 6 pzas" y "Alitas 12 pzas").
- Los extras o complementos que tienen precio propio (queso extra, tocino, salsa extra) también son productos, en la categoría "Extras".
- Escribe los nombres como aparecen en el menú, con mayúsculas normales (no todo en mayúsculas), sin el precio ni la descripción en el nombre.
- price es el precio en pesos mexicanos como número (149, no "$149.00"). Si un producto no tiene precio visible, no lo inventes: déjalo fuera y explícalo en warnings.
- category: usa la sección del menú (Burgers, Alitas, Boneless, Combos, Bebidas, Postres, Extras...). Si ya existe una categoría parecida en la lista que te doy, usa exactamente ese nombre.
- emoji: uno solo que represente el producto.
- station, la estación de cocina que lo prepara:
  - Parrilla: hamburguesas, hot dogs, carnes y todo lo que se hace a la plancha o parrilla.
  - Freidora: alitas, boneless, papas, aros de cebolla, nuggets y todo lo frito.
  - Barra: bebidas, malteadas, café, postres fríos y lo que se sirve sin cocinar.
  - Cocina: ensaladas, combos y lo demás.
- description: lo que dice el menú del producto (ingredientes), o "" si no dice nada.
- Si algo es ilegible o dudoso (precio borroso, producto repetido con precios distintos en dos fotos), inclúyelo con tu mejor lectura y avisa en warnings, en español y en pocas palabras.
- Si una foto no es un menú, dilo en warnings.`;

export async function POST(request: NextRequest) {
  const denied = await guardBridgeRequest(request);
  if (denied) return denied;

  const key = readAnthropicKey();
  if (!key) return NextResponse.json({ success: false, error: "Primero guarda tu llave de Anthropic." }, { status: 400 });

  let files: { name: string; mediaType: string; data: string }[] = [];
  let categories: string[] = [];
  try {
    const body = await request.json();
    files = Array.isArray(body?.files) ? body.files : [];
    categories = (Array.isArray(body?.categories) ? body.categories : []).filter((c: unknown) => typeof c === "string").slice(0, 100);
  } catch {
    return NextResponse.json({ success: false, error: "Petición inválida." }, { status: 400 });
  }
  if (!files.length) return NextResponse.json({ success: false, error: "Sube al menos una foto o PDF del menú." }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ success: false, error: `Máximo ${MAX_FILES} archivos por vez.` }, { status: 400 });
  if (files.reduce((n, f) => n + String(f.data || "").length, 0) > MAX_BASE64) {
    return NextResponse.json({ success: false, error: "Los archivos pesan demasiado. Súbelos en dos tandas." }, { status: 400 });
  }

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const file of files) {
    const data = String(file.data || "");
    if (file.mediaType === "application/pdf") {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data } });
    } else if (IMAGE_TYPES.has(file.mediaType)) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: file.mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data },
      });
    } else {
      return NextResponse.json({ success: false, error: `${file.name}: solo se aceptan fotos (JPG, PNG, WEBP) o PDF.` }, { status: 400 });
    }
  }
  content.push({
    type: "text",
    text: `Categorías que ya existen en B-POS: ${categories.length ? categories.join(", ") : "(ninguna)"}.\nLee el menú de ${files.length === 1 ? "este archivo" : `estos ${files.length} archivos`} y dame todos los productos.`,
  });

  try {
    const response = await anthropicClient(key).beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(MenuSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content }],
    });

    if (response.stop_reason === "refusal") {
      return NextResponse.json({ success: false, error: "Claude no pudo procesar estos archivos. Prueba con otras fotos." }, { status: 422 });
    }
    if (response.stop_reason === "max_tokens") {
      return NextResponse.json({ success: false, error: "El menú es muy largo para una sola vez. Súbelo en dos tandas." }, { status: 422 });
    }
    const parsed = response.parsed_output;
    if (!parsed) return NextResponse.json({ success: false, error: "Claude no regresó la lista de productos. Intenta de nuevo." }, { status: 502 });

    const items = parsed.items
      .map((item) => ({ ...item, name: item.name.trim(), category: item.category.trim() || "Sin categoría", price: Math.round(item.price * 100) / 100 }))
      .filter((item) => item.name && item.price > 0);
    return NextResponse.json({
      success: true,
      items,
      warnings: parsed.warnings,
      usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
    });
  } catch (error) {
    return NextResponse.json({ success: false, error: friendlyAiError(error) }, { status: 502 });
  }
}
