"use client";
/**
 * Inventario → Pedido sugerido (tienda y ferretería): qué comprar según lo
 * que se vendió, para tener los días que elijas más el mínimo de cada
 * artículo, agrupado por proveedor y listo para mandar por WhatsApp.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import RequirePermission from "@/components/auth/RequirePermission";
import { AppShell } from "@/components/layout/AppShell";
import { getAdminProducts } from "@/lib/admin";
import { getBusinessSettings } from "@/lib/business-settings";
import { getSuppliers } from "@/lib/purchases";
import { formatQty, suggestedOrder, suggestedOrderText, unitOf } from "@/lib/retail";
import { openWhatsapp, whatsappLink } from "@/lib/whatsapp";
import type { Product } from "@/data/products";

const money = (n: number) => `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

export default function PedidoSugeridoPage() {
  return (
    <RequirePermission permission="inventory.view">
      <AppShell title="Pedido sugerido" subtitle="Lo que conviene comprar según lo que vendiste, por proveedor.">
        <Pedido />
      </AppShell>
    </RequirePermission>
  );
}

function Pedido() {
  const [products, setProducts] = useState<Product[]>([]);
  const [days, setDays] = useState(14);
  const [cover, setCover] = useState(7);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const load = () => {
      setProducts(getAdminProducts());
      setVersion((v) => v + 1);
    };
    load();
    window.addEventListener("bpos:inventory-updated", load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener("bpos:inventory-updated", load);
      window.removeEventListener("storage", load);
    };
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- version: se recalcula cuando cambia el inventario
  const groups = useMemo(() => suggestedOrder(products, { days, coverDays: cover }), [products, days, cover, version]);
  const suppliers = useMemo(() => (typeof window === "undefined" ? [] : getSuppliers()), [version]);

  function send(supplier: string, lines: Parameters<typeof suggestedOrderText>[2]) {
    const text = suggestedOrderText(getBusinessSettings().businessName, supplier, lines);
    const known = suppliers.find((s) => norm(s.name) === norm(supplier));
    const digits = String(known?.whatsapp || known?.phone || "").replace(/\D/g, "");
    const phone = digits.length === 10 ? `52${digits}` : digits;
    openWhatsapp(phone ? whatsappLink(phone, text) : `https://api.whatsapp.com/send/?text=${encodeURIComponent(text)}`);
  }

  function copy(supplier: string, lines: Parameters<typeof suggestedOrderText>[2]) {
    void navigator.clipboard?.writeText(suggestedOrderText(getBusinessSettings().businessName, supplier, lines)).then(() => alert("Pedido copiado."));
  }

  const select = "rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white";
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-4 rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
        <label>
          <span className="mb-1 block text-sm font-bold text-zinc-400">Según lo vendido en</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={select}>
            {[7, 14, 30, 60].map((d) => (
              <option key={d} value={d}>
                los últimos {d} días
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-sm font-bold text-zinc-400">Para tener</span>
          <select value={cover} onChange={(e) => setCover(Number(e.target.value))} className={select}>
            {[3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {d} días de venta
              </option>
            ))}
          </select>
        </label>
        <p className="max-w-md text-sm text-zinc-500">
          Más el mínimo de cada artículo. Los artículos sin proveedor salen al final: ponle su proveedor en Artículos.
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-3xl border border-zinc-800 bg-zinc-950 p-10 text-center text-zinc-500">
          No hace falta comprar nada por ahora. Si acabas de empezar, B-POS necesita unos días de ventas para sugerir.
        </p>
      ) : (
        groups.map(([supplier, lines]) => {
          const cost = lines.reduce((s, l) => s + (l.cost || 0), 0);
          return (
            <section key={supplier} className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-black text-orange-500">🚚 {supplier}</h2>
                  <p className="text-sm text-zinc-500">
                    {lines.length} artículo(s){cost > 0 ? ` · aprox. ${money(cost)}` : ""}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => copy(supplier, lines)} className="rounded-2xl border border-zinc-700 px-4 py-2 text-sm font-black">
                    Copiar
                  </button>
                  <button onClick={() => send(supplier, lines)} className="rounded-2xl bg-green-500 px-4 py-2 text-sm font-black text-black">
                    Mandar por WhatsApp
                  </button>
                </div>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="text-left text-zinc-500">
                    <tr>
                      <th className="py-2">Artículo</th>
                      <th>Hay</th>
                      <th>Mínimo</th>
                      <th>Vende al día</th>
                      <th className="text-right">Pedir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.product.id} className="border-t border-zinc-800">
                        <td className="py-2 font-bold">{l.product.name}</td>
                        <td className={l.stock <= l.minimum ? "font-black text-red-400" : ""}>{formatQty(l.stock, unitOf(l.product))}</td>
                        <td>{formatQty(l.minimum, unitOf(l.product))}</td>
                        <td>{formatQty(l.soldPerDay, unitOf(l.product))}</td>
                        <td className="text-right text-lg font-black text-orange-400">{formatQty(l.quantity, unitOf(l.product))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })
      )}

      <Link href="/compras" className="block rounded-3xl border border-zinc-800 bg-zinc-950 p-5 text-center font-black text-orange-400 hover:border-orange-500">
        🛍️ Cuando llegue la mercancía, regístrala en Compras (con foto del ticket o factura) →
      </Link>
    </div>
  );
}
