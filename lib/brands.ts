/**
 * Multimarca: un mismo negocio (mismos productos, inventario y caja) vende
 * con varias marcas, por ejemplo una marca que solo existe en DiDi, Uber y
 * Rappi. Cada producto dice de qué marca es y así cada venta queda en su
 * marca sola (también los pedidos de delivery, por la equivalencia del
 * producto). Finanzas y Reportes separan ventas, canales y food cost por marca.
 *
 * La marca principal es el negocio (su nombre y color de Empresa); aquí solo
 * se guardan las demás. Un producto sin marca es de la principal, y uno con
 * "Todas las marcas" (refresco, papas) toma la marca del pedido en que va.
 */
import { getAdminProducts } from "@/lib/admin";
import { getBusinessSettings } from "@/lib/business-settings";

export const MAIN_BRAND = "main";
export const ALL_BRANDS = "all";
export const BRANDS_KEY = "bpos_brands";
export const BRANDS_EVENT = "bpos:brands-updated";

export type Brand = {
  id: string;
  name: string;
  color: string;
  /** Solo vende en apps de delivery: sus productos no salen en el POS, el menú digital ni el kiosco */
  appsOnly: boolean;
  /** Sus insumos propios van en su propia categoría de inventario (con el nombre de la marca) */
  ownInventory: boolean;
  createdAt: string;
};

const COLORS = ["#22c55e", "#3b82f6", "#a855f7", "#ec4899", "#eab308", "#14b8a6"];

function normalize(raw: Partial<Brand>, index: number): Brand | null {
  const name = String(raw.name || "").trim().replace(/\s+/g, " ").slice(0, 40);
  const id = String(raw.id || "");
  if (!name || !id || id === MAIN_BRAND || id === ALL_BRANDS) return null;
  return {
    id,
    name,
    color: /^#[0-9a-f]{6}$/i.test(String(raw.color || "")) ? String(raw.color) : COLORS[index % COLORS.length],
    appsOnly: raw.appsOnly === true,
    ownInventory: raw.ownInventory === true,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date(0).toISOString(),
  };
}

/** Las marcas que se dieron de alta además de la principal */
export function getExtraBrands(): Brand[] {
  if (typeof window === "undefined") return [];
  try {
    const list = JSON.parse(localStorage.getItem(BRANDS_KEY) || "[]");
    return Array.isArray(list) ? list.map(normalize).filter((b): b is Brand => Boolean(b)) : [];
  } catch {
    return [];
  }
}

/** La principal (el negocio) primero y luego las demás */
export function getBrands(): Brand[] {
  const s = getBusinessSettings();
  return [{ id: MAIN_BRAND, name: s.businessName, color: s.brandColor, appsOnly: false, ownInventory: false, createdAt: "" }, ...getExtraBrands()];
}

/** ¿El negocio tiene más de una marca? Sin otras marcas todo se ve como siempre */
export const brandsEnabled = () => getExtraBrands().length > 0;

function write(list: Brand[]) {
  localStorage.setItem(BRANDS_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(BRANDS_EVENT));
}

export function addBrand(input: { name: string; color?: string; appsOnly?: boolean; ownInventory?: boolean }) {
  const list = getExtraBrands();
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Escribe el nombre de la marca.");
  const taken = [getBusinessSettings().businessName, ...list.map((b) => b.name)].some((n) => n.trim().toLowerCase() === name.toLowerCase());
  if (taken) throw new Error("Ya hay una marca con ese nombre.");
  const brand = normalize(
    { id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, color: input.color, appsOnly: input.appsOnly, ownInventory: input.ownInventory, createdAt: new Date().toISOString() },
    list.length
  );
  if (!brand) throw new Error("Escribe el nombre de la marca.");
  write([...list, brand]);
  return brand;
}

export function updateBrand(id: string, patch: Partial<Pick<Brand, "name" | "color" | "appsOnly" | "ownInventory">>) {
  const list = getExtraBrands();
  if (patch.name !== undefined) {
    const name = patch.name.trim().toLowerCase();
    if (!name) throw new Error("Escribe el nombre de la marca.");
    if ([getBusinessSettings().businessName, ...list.filter((b) => b.id !== id).map((b) => b.name)].some((n) => n.trim().toLowerCase() === name)) throw new Error("Ya hay una marca con ese nombre.");
  }
  write(list.map((b, i) => (b.id === id ? normalize({ ...b, ...patch }, i) || b : b)));
}

/** Quita la marca; sus productos regresan a la principal (eso lo hace quien llama, con `productsWithoutBrand`) */
export function removeBrand(id: string) {
  write(getExtraBrands().filter((b) => b.id !== id));
}

/** Los productos de una marca que se quita pasan a la marca principal */
export function productsWithoutBrand<T extends { brandId?: string }>(products: T[], id: string): T[] {
  return products.map((p) => {
    if (p.brandId !== id) return p;
    const next = { ...p };
    delete next.brandId;
    return next;
  });
}

// ------------------------------------------------------------ productos y ventas

type BrandedProduct = { id: number | string; brandId?: string; notSoldAlone?: boolean };

/** Marca del producto: la suya si existe, "Todas" o la principal (sin marca o con una que ya se quitó) */
export function productBrandId(product: BrandedProduct | undefined, brands: Brand[] = getBrands()) {
  const id = product?.brandId;
  if (id === ALL_BRANDS) return ALL_BRANDS;
  return id && brands.some((b) => b.id === id) ? id : MAIN_BRAND;
}

/** Productos de una marca que solo vende en apps: no salen en el POS ni en el menú */
export function isAppsOnly(product: BrandedProduct, brands: Brand[] = getBrands()) {
  const id = productBrandId(product, brands);
  return brands.some((b) => b.id === id && b.appsOnly);
}

type BrandedItem = { id?: number | string; price?: number; quantity?: number };

/**
 * Marca de un pedido, por sus productos: la de los productos que tienen
 * marca (los de "Todas las marcas" no cuentan). Sin ninguno, la principal.
 * `mixed`: trae productos de dos marcas (no debería pasar, cada marca tiene
 * su tienda en las apps); se queda con la que más vendió y se avisa.
 */
export function orderBrandId(items: BrandedItem[] | undefined, productById: Map<number, BrandedProduct>, brands: Brand[] = getBrands()) {
  const sales = new Map<string, number>();
  for (const item of Array.isArray(items) ? items : []) {
    // Lo que ya no está en el catálogo, o un extra que no se vende solo ("Ranch aparte")
    // sin marca propia, no decide la marca: sigue la del producto principal
    const product = productById.get(Number(item.id));
    if (!product) continue;
    const id = productBrandId(product, brands);
    if (id === ALL_BRANDS || (product.notSoldAlone && id === MAIN_BRAND)) continue;
    sales.set(id, (sales.get(id) || 0) + (Number(item.price) || 0) * (Number(item.quantity) || 1) + 0.0001);
  }
  if (!sales.size) return { brandId: MAIN_BRAND, mixed: false, brandIds: [MAIN_BRAND] };
  const brandIds = [...sales.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  return { brandId: brandIds[0], mixed: brandIds.length > 1, brandIds };
}

export function brandName(id: string, brands: Brand[] = getBrands()) {
  return brands.find((b) => b.id === id)?.name || brands[0]?.name || "Marca principal";
}

/** Nombre de la marca de un pedido, solo si el negocio tiene varias marcas ("" si no) */
export function orderBrandLabel(items: BrandedItem[] | undefined, products: BrandedProduct[], brands: Brand[] = getBrands()) {
  if (brands.length < 2) return "";
  const byId = new Map(products.map((p) => [Number(p.id), p]));
  return brandName(orderBrandId(items, byId, brands).brandId, brands);
}

/**
 * Marca que va en los tickets (cocina y bolsa) en lugar del logo del negocio:
 * solo si el pedido es de otra marca que no es la principal ("" si no).
 */
export function ticketBrandName(items: BrandedItem[] | undefined) {
  const brands = getBrands();
  if (brands.length < 2) return "";
  const byId = new Map(getAdminProducts().map((p) => [Number(p.id), p]));
  const { brandId } = orderBrandId(items, byId, brands);
  return brandId === MAIN_BRAND ? "" : brandName(brandId, brands);
}

/** Categorías de inventario de las marcas con inventario propio (se ofrecen al dar de alta un insumo) */
export const brandInventoryCategories = () => getExtraBrands().filter((b) => b.ownInventory).map((b) => b.name);
