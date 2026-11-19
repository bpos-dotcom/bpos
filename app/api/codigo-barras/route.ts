import { NextResponse, type NextRequest } from "next/server";

/**
 * Buscar un producto por su código de barras en Open Food Facts.
 *   GET ?code=7501055300075 → { found, name?, brand?, image?, category? }
 * Nunca falla con 500: si no está o no hubo respuesta, { found: false }.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OffProduct = {
  product_name?: string;
  product_name_es?: string;
  brands?: string;
  quantity?: string;
  image_front_small_url?: string;
  image_front_url?: string;
  categories_tags?: string[];
};

const FIELDS = "product_name,product_name_es,brands,quantity,image_front_small_url,image_front_url,categories_tags";
const DAY = 60 * 60 * 24;

const reply = (body: Record<string, unknown>, maxAge = DAY) =>
  NextResponse.json(body, { headers: { "Cache-Control": `public, max-age=${maxAge}, s-maxage=${maxAge}` } });

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");

/** "Coca-Cola" + "Coca-Cola" + "600 ml" → "Coca-Cola 600 ml" */
function productName(name: string, brand: string, quantity: string): string {
  let out = name.trim();
  if (brand && !squash(out).includes(squash(brand))) out = out ? `${brand} ${out}` : brand;
  if (quantity && !squash(out).includes(squash(quantity))) out = `${out} ${quantity}`.trim();
  return out.replace(/\s+/g, " ");
}

function category(tags: string[] | undefined): string | undefined {
  if (!tags?.length) return undefined;
  const tag = [...tags].reverse().find((t) => t.startsWith("es:")) ?? tags[tags.length - 1];
  const text = tag.replace(/^[a-z]{2}:/, "").replace(/-/g, " ").trim();
  return text ? text[0].toUpperCase() + text.slice(1) : undefined;
}

export async function GET(request: NextRequest) {
  const code = (request.nextUrl.searchParams.get("code") || "").replace(/\s+/g, "");
  if (!/^\d{8,14}$/.test(code)) return reply({ found: false, error: "Código no válido." });

  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${FIELDS}`, {
      headers: { "User-Agent": "B-POS/1.0 (punto de venta)", Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    // 404 = no está en el catálogo (se guarda un día); otros errores, poco tiempo
    if (!res.ok) return reply({ found: false }, res.status === 404 ? DAY : 300);
    const data = (await res.json()) as { status?: number; product?: OffProduct };
    const p = data.product;
    if (data.status !== 1 || !p) return reply({ found: false });

    const brand = (p.brands || "").split(",")[0].trim();
    const name = productName(p.product_name_es || p.product_name || "", brand, (p.quantity || "").trim());
    if (!name) return reply({ found: false });
    return reply({
      found: true,
      name,
      brand: brand || undefined,
      image: p.image_front_small_url || p.image_front_url || undefined,
      category: category(p.categories_tags),
    });
  } catch {
    // Sin internet o tardó demasiado: no se guarda mucho tiempo
    return reply({ found: false }, 60);
  }
}
