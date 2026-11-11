"use client";
/**
 * Configuración → Marcas: las marcas con que vende el negocio (ej. una marca
 * que solo existe en DiDi y Uber). Mismos productos, inventario y caja; cada
 * producto dice de qué marca es y Finanzas y Reportes separan las ventas,
 * los canales y el food cost de cada una.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { ask, notify } from "@/components/layout/Dialogs";
import type { Product } from "@/data/products";
import { getAdminProducts, saveAdminProducts } from "@/lib/admin";
import { ALL_BRANDS, BRANDS_EVENT, MAIN_BRAND, addBrand, getBrands, productBrandId, productsWithoutBrand, removeBrand, updateBrand, type Brand } from "@/lib/brands";

const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white";
const card = "rounded-3xl border border-zinc-800 bg-zinc-950 p-6";

export default function MarcasPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [name, setName] = useState("");
  const [appsOnly, setAppsOnly] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const sync = () => {
      setBrands(getBrands());
      setProducts(getAdminProducts());
    };
    sync();
    window.addEventListener(BRANDS_EVENT, sync);
    window.addEventListener("bpos:business-settings-updated", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(BRANDS_EVENT, sync);
      window.removeEventListener("bpos:business-settings-updated", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const countOf = (id: string) => products.filter((p) => productBrandId(p, brands) === id).length;

  async function create() {
    setError("");
    const clean = name.trim();
    if (!clean) return setError("Escribe el nombre de la marca.");
    if (brands.some((b) => b.name.trim().toLowerCase() === clean.toLowerCase())) return setError("Ya hay una marca con ese nombre.");
    const own = await ask(
      `¿${clean} va a tener su propia categoría de inventario?\n\nSí: sus insumos propios (los que solo usa ${clean}) los das de alta en Inventario, en la categoría "${clean}".\n\nNo: usa el mismo inventario que ya tienes y no se crea nada.`,
      { ok: "Sí, su propia categoría", cancel: "No, el mismo inventario" }
    );
    try {
      const brand = addBrand({ name: clean, appsOnly, ownInventory: own });
      setName("");
      notify(
        own
          ? `${brand.name} quedó dada de alta. Añade sus insumos en Configuración → Ingredientes, categoría "${brand.name}", y luego elige ${brand.name} en sus productos.`
          : `${brand.name} quedó dada de alta y usa el mismo inventario. Ahora elige ${brand.name} en sus productos.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo dar de alta la marca.");
    }
  }

  function change(id: string, patch: Parameters<typeof updateBrand>[1]) {
    try {
      updateBrand(id, patch);
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo guardar.", "error");
    }
  }

  async function remove(brand: Brand) {
    const count = countOf(brand.id);
    const ok = await ask(`¿Quitar la marca ${brand.name}?${count ? `\n\nSus ${count} producto(s) pasan a ${brands[0]?.name}. Sus ventas pasadas se verán como de ${brands[0]?.name}.` : ""}`, { ok: "Quitar" });
    if (!ok) return;
    saveAdminProducts(productsWithoutBrand(getAdminProducts(), brand.id));
    removeBrand(brand.id);
  }

  /** Cambia la marca de un producto (parte de la lista guardada, no de la copia en memoria) */
  function setProductBrand(productId: number, brandId: string) {
    const next = getAdminProducts().map((p) => {
      if (Number(p.id) !== productId) return p;
      const copy = { ...p };
      if (brandId === MAIN_BRAND) delete copy.brandId;
      else copy.brandId = brandId;
      return copy;
    });
    saveAdminProducts(next);
    setProducts(next);
  }

  const extra = brands.slice(1);
  const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const grouped = useMemo(() => {
    const q = plain(query.trim());
    const map = new Map<string, Product[]>();
    products
      .filter((p) => !q || plain(`${p.name} ${p.category}`).includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, "es"))
      .forEach((p) => map.set(p.category || "Sin categoría", [...(map.get(p.category || "Sin categoría") || []), p]));
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"));
  }, [products, query]);

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell title="Marcas" subtitle="Vende con varias marcas desde el mismo negocio: mismos productos, inventario y caja; Finanzas y Reportes separan lo de cada marca.">
        <div className="max-w-4xl space-y-5">
          <section className={card}>
            <h2 className="text-lg font-black">🏷️ Tus marcas</h2>
            <div className="mt-4 space-y-3">
              {brands[0] && (
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-700 bg-black p-4">
                  <span className="h-5 w-5 rounded-full" style={{ background: brands[0].color }} />
                  <div className="min-w-0 flex-1">
                    <p className="font-black">{brands[0].name}</p>
                    <p className="text-xs text-zinc-500">
                      Marca principal (el nombre del negocio) · {countOf(MAIN_BRAND)} producto(s). El nombre y el color se cambian en{" "}
                      <Link href="/configuracion/empresa" className="text-orange-400 underline">
                        Empresa
                      </Link>
                      .
                    </p>
                  </div>
                </div>
              )}
              {extra.map((b) => (
                <div key={b.id} className="space-y-3 rounded-2xl border border-zinc-700 bg-black p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <input type="color" value={b.color} onChange={(e) => change(b.id, { color: e.target.value })} className="h-10 w-12 cursor-pointer rounded-xl border border-zinc-700 bg-black" aria-label={`Color de ${b.name}`} />
                    <input
                      defaultValue={b.name}
                      maxLength={40}
                      onBlur={(e) => e.target.value.trim() !== b.name && change(b.id, { name: e.target.value })}
                      className="min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 font-black"
                      aria-label="Nombre de la marca"
                    />
                    <span className="text-sm text-zinc-400">{countOf(b.id)} producto(s)</span>
                    <button onClick={() => remove(b)} className="rounded-xl border border-zinc-800 px-3 py-2 text-sm text-zinc-400 hover:border-red-500" aria-label={`Quitar ${b.name}`}>
                      🗑
                    </button>
                  </div>
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
                    <input type="checkbox" checked={b.appsOnly} onChange={(e) => change(b.id, { appsOnly: e.target.checked })} className="mt-0.5 h-5 w-5 accent-orange-500" />
                    <span>
                      🛵 Solo vende en apps (DiDi, Uber, Rappi)
                      <span className="block text-xs text-zinc-500">Sus productos no salen en el punto de venta, el menú digital ni el kiosco; sí llegan por el Bridge y descuentan inventario.</span>
                    </span>
                  </label>
                  <label className="flex cursor-pointer items-start gap-2 text-sm text-zinc-300">
                    <input type="checkbox" checked={b.ownInventory} onChange={(e) => change(b.id, { ownInventory: e.target.checked })} className="mt-0.5 h-5 w-5 accent-orange-500" />
                    <span>
                      📦 Su propia categoría de inventario
                      <span className="block text-xs text-zinc-500">
                        Al dar de alta un insumo te aparece la categoría &quot;{b.name}&quot; para sus insumos propios. Sin marcar, usa el mismo inventario del negocio.
                      </span>
                    </span>
                  </label>
                </div>
              ))}
              {extra.length === 0 && <p className="text-sm text-zinc-500">Solo tienes la marca principal. Da de alta otra marca abajo.</p>}
            </div>
          </section>

          <section className={card}>
            <h2 className="text-lg font-black">➕ Nueva marca</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
              <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && create()} placeholder="Ej. Supremos" maxLength={40} className={input} />
              <button onClick={create} className="rounded-2xl bg-orange-500 px-6 py-3 font-black text-black">
                Dar de alta
              </button>
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
              <input type="checkbox" checked={appsOnly} onChange={(e) => setAppsOnly(e.target.checked)} className="h-5 w-5 accent-orange-500" />
              🛵 Solo vende en apps (DiDi, Uber, Rappi)
            </label>
            {error && <p className="mt-2 text-sm font-bold text-red-300">{error}</p>}
          </section>

          {extra.length > 0 && (
            <section className={card}>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black">🍔 Productos de cada marca</h2>
                  <p className="mt-1 text-sm text-zinc-400">
                    Cada pedido queda en la marca de sus productos (también los de DiDi, Uber y Rappi, por su equivalencia). &quot;Todas las marcas&quot; es para lo que venden las dos, como un refresco: toma la marca del pedido.
                  </p>
                </div>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 Buscar producto" className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-2 text-white md:w-64" />
              </div>
              <div className="mt-4 space-y-4">
                {grouped.map(([category, list]) => (
                  <div key={category}>
                    <p className="text-xs font-black uppercase tracking-wide text-zinc-500">{category}</p>
                    <div className="mt-2 space-y-2">
                      {list.map((p) => {
                        const current = productBrandId(p, brands);
                        const color = brands.find((b) => b.id === current)?.color;
                        return (
                          <div key={p.id} className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-black px-4 py-2">
                            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color || "#71717a" }} />
                            <span className="min-w-0 flex-1 truncate text-sm font-bold">
                              {p.emoji} {p.name}
                            </span>
                            <select value={current} onChange={(e) => setProductBrand(Number(p.id), e.target.value)} className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm" aria-label={`Marca de ${p.name}`}>
                              {brands.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.name}
                                </option>
                              ))}
                              <option value={ALL_BRANDS}>Todas las marcas</option>
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </AppShell>
    </RequireRole>
  );
}
