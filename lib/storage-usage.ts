/**
 * Cuánto ocupa B-POS en la memoria del navegador (localStorage). El navegador
 * da ~5 millones de letras por página; el 27 nov se llenó y la caja dejó de
 * guardar pedidos. Se avisa antes de llegar al tope.
 */
export const STORAGE_LIMIT = 5_000_000;
/** Desde aquí se avisa en pantalla */
export const STORAGE_WARN = 0.7;

type StorageLike = { length: number; key(i: number): string | null; getItem(k: string): string | null };

export type StorageUsage = { total: number; ratio: number; top: [string, number][] };

export function storageUsage(storage: StorageLike): StorageUsage {
  const sizes: [string, number][] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k) sizes.push([k, (storage.getItem(k) || "").length + k.length]);
  }
  const total = sizes.reduce((s, [, n]) => s + n, 0);
  sizes.sort((a, b) => b[1] - a[1]);
  return { total, ratio: total / STORAGE_LIMIT, top: sizes.slice(0, 6) };
}

/** "Total 3.10 M · orders 1.20 · inventory_kardex 0.40 …" (para mandar a soporte) */
export function usageReport(u: StorageUsage) {
  return `Total ${(u.total / 1e6).toFixed(2)} M · ${u.top.map(([k, n]) => `${k.replace(/^bpos_/, "")} ${(n / 1e6).toFixed(2)}`).join(" · ")}`;
}
