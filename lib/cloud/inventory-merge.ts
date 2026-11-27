/**
 * Inventario entre varios equipos. Cada artículo guarda su existencia como un
 * total; antes ganaba el último equipo que subía y, si ese equipo estaba
 * atrasado, borraba lo que había hecho otro (el 24 nov una compra de 300
 * tapas hecha en el celular se perdió porque la caja subió su total sin ella;
 * el 26 el celular le regresó a la caja un día de ventas sin descontar).
 *
 * Ahora, si la nube cambió desde la última vez que este equipo la vio, se
 * junta: a lo que hay en la nube se le suma lo que este equipo movió
 * (su existencia ahora menos la que tenía la última vez que sincronizó). En
 * los demás datos (nombre, mínimo, categoría…) gana lo que este equipo
 * cambió; lo que no tocó se queda como está en la nube.
 */
type Item = Record<string, unknown>;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const round = (n: number) => Math.round(n * 10000) / 10000;

/**
 * base: el artículo como estaba la última vez que este equipo sincronizó
 * local: como lo tiene este equipo ahora
 * cloud: como está en la nube (otro equipo lo cambió)
 * Sin base (no se sabe qué movió este equipo) se sube lo de este equipo, como antes.
 */
export function mergeInventoryItem(base: Item | undefined, local: Item, cloud: Item): Item {
  if (!base) return local;
  const merged: Item = { ...cloud };
  const keys = new Set([...Object.keys(local), ...Object.keys(base)]);
  keys.forEach((key) => {
    if (key === "stock" || same(local[key], base[key])) return;
    if (key in local) merged[key] = local[key];
    else delete merged[key];
  });
  merged.stock = round(num(cloud.stock) + (num(local.stock) - num(base.stock)));
  return merged;
}
