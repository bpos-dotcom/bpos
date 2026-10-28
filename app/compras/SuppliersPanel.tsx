"use client";
import { useEffect, useMemo, useState } from "react";
import { getPurchases, getSuppliers, PURCHASES_EVENT, saveSupplier, type Supplier } from "@/lib/purchases";

const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3";
const empty = { id: "", name: "", whatsapp: "", rfc: "", notes: "" };

/** Alta y edición de proveedores, con lo que se les ha comprado */
export default function SuppliersPanel() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [draft, setDraft] = useState(empty);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const load = () => {
      setSuppliers(getSuppliers());
      setVersion((v) => v + 1);
    };
    load();
    window.addEventListener(PURCHASES_EVENT, load);
    return () => window.removeEventListener(PURCHASES_EVENT, load);
  }, []);

  const stats = useMemo(() => {
    const map = new Map<string, { count: number; total: number; last?: string }>();
    getPurchases()
      .filter((p) => p.status !== "cancelled")
      .forEach((p) => {
        const key = p.supplier.trim().toLowerCase();
        const entry = map.get(key) ?? { count: 0, total: 0 };
        entry.count += 1;
        entry.total += p.total;
        if (!entry.last || p.createdAt > entry.last) entry.last = p.createdAt;
        map.set(key, entry);
      });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  function save() {
    if (!draft.name.trim()) {
      alert("Escribe el nombre del proveedor.");
      return;
    }
    saveSupplier({
      id: draft.id || undefined,
      name: draft.name.trim(),
      whatsapp: draft.whatsapp.trim() || undefined,
      rfc: draft.rfc.trim() || undefined,
      notes: draft.notes.trim() || undefined,
    });
    setDraft(empty);
  }

  function edit(s: Supplier) {
    setDraft({ id: s.id, name: s.name, whatsapp: s.whatsapp || s.phone || "", rfc: s.rfc || "", notes: s.notes || "" });
  }

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <h2 className="text-xl font-black text-orange-500">🏪 Proveedores</h2>
      <p className="mt-2 text-sm text-zinc-400">
        Con su WhatsApp puedes mandarles el pedido desde Sugerencias. Los proveedores nuevos de una compra se dan de alta solos.
      </p>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Nombre *" className={input} />
        <input value={draft.whatsapp} onChange={(e) => setDraft({ ...draft, whatsapp: e.target.value })} placeholder="WhatsApp (10 dígitos)" inputMode="tel" className={input} />
        <input value={draft.rfc} onChange={(e) => setDraft({ ...draft, rfc: e.target.value })} placeholder="RFC (opcional)" className={input} />
        <input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Notas: días de entrega, contacto..." className={input} />
      </div>
      <div className="mt-3 flex gap-3">
        <button onClick={save} className="flex-1 rounded-2xl bg-orange-500 py-3 font-black text-black">
          {draft.id ? "Guardar cambios" : "Agregar proveedor"}
        </button>
        {draft.id && (
          <button onClick={() => setDraft(empty)} className="rounded-2xl border border-zinc-700 px-5 py-3 font-black">
            Cancelar
          </button>
        )}
      </div>

      <div className="mt-6 space-y-2">
        {suppliers.length === 0 && (
          <div className="rounded-2xl border border-dashed border-zinc-800 p-6 text-center text-zinc-500">Todavía no hay proveedores.</div>
        )}
        {suppliers.map((s) => {
          const stat = stats.get(s.name.trim().toLowerCase());
          return (
            <div key={s.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-black p-4 ${s.active === false ? "opacity-50" : ""}`}>
              <div>
                <p className="font-black">{s.name}</p>
                <p className="text-xs text-zinc-500">
                  {s.whatsapp || s.phone ? `📲 ${s.whatsapp || s.phone}` : "Sin WhatsApp"}
                  {stat ? ` · ${stat.count} compra(s) · $${stat.total.toFixed(2)}` : ""}
                  {stat?.last ? ` · última ${new Date(stat.last).toLocaleDateString()}` : ""}
                </p>
                {s.notes && <p className="mt-1 text-xs text-zinc-400">{s.notes}</p>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => edit(s)} className="rounded-xl border border-zinc-700 px-3 py-2 text-xs font-black">
                  Editar
                </button>
                <button
                  onClick={() => {
                    const { createdAt: _created, ...rest } = s;
                    void _created;
                    saveSupplier({ ...rest, active: s.active === false });
                  }}
                  className="rounded-xl border border-zinc-700 px-3 py-2 text-xs font-black"
                >
                  {s.active === false ? "Activar" : "Desactivar"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
