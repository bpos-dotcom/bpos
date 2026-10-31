"use client";
/**
 * Popup para eliminar un producto. Avisa qué lo usa (equivalencias de
 * delivery y opciones enlazadas de otros productos) y permite elegir otro
 * producto para reemplazarlo ahí antes de borrarlo. Sin reemplazo, esas
 * equivalencias y opciones se quitan.
 */
import { useEffect, useMemo, useState } from "react";
import type { Product } from "@/data/products";
import { ProductPicker } from "@/components/products/ProductPicker";
import { bridgeFetch } from "@/lib/bridge/bridge-fetch";

type AliasTarget = { id: string; name: string; quantity?: number; unit?: string };
export type DeliveryAlias = {
  id: string;
  externalName: string;
  platform?: string | null;
  actionType: "product" | "ingredient" | "bundle" | "ignore";
  targets: AliasTarget[];
  compound?: boolean;
};

type Props = {
  product: Product;
  products: Product[];
  onClose: () => void;
  /** replacement = producto elegido para reemplazarlo (o nada) */
  onConfirm: (replacement: Product | null, aliases: DeliveryAlias[]) => Promise<void> | void;
};

/** Productos cuyas opciones enlazan al producto dado */
export function productsLinkingTo(products: Product[], productId: number) {
  return products.filter((p) => p.id !== productId && p.modifierGroups?.some((g) => g.options.some((o) => o.productId === productId)));
}

/** Equivalencias de delivery (DiDi/Uber/Rappi) que apuntan al producto */
export function aliasesPointingTo(aliases: DeliveryAlias[], productId: number) {
  return aliases.filter((a) => a.actionType === "product" && a.targets.some((t) => String(t.id) === String(productId)));
}

export function DeleteProductModal({ product, products, onClose, onConfirm }: Props) {
  const [aliases, setAliases] = useState<DeliveryAlias[] | null>(null);
  const [aliasError, setAliasError] = useState(false);
  const [replacement, setReplacement] = useState<Product | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  // Las equivalencias viven en la nube: se consultan al abrir
  useEffect(() => {
    let alive = true;
    bridgeFetch("/api/bridge/aliases", { cache: "no-store" })
      .then(async (r) => {
        const data = (await r.json()) as { success?: boolean; aliases?: DeliveryAlias[] };
        if (!r.ok || !data.success) throw new Error("x");
        if (alive) setAliases(aliasesPointingTo(data.aliases || [], product.id));
      })
      .catch(() => {
        if (alive) {
          setAliases([]);
          setAliasError(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [product.id]);

  const linked = useMemo(() => productsLinkingTo(products, product.id), [products, product.id]);
  const hasUses = linked.length > 0 || (aliases?.length ?? 0) > 0;
  const linkable = products.filter((p) => p.id !== product.id);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm(replacement, aliases || []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-3xl border border-red-500/40 bg-zinc-950 p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-xl font-black text-red-400">🗑️ ¿Seguro deseas eliminar este producto?</h3>
        <p className="mt-2 text-sm text-zinc-300">
          <span className="text-xl">{product.emoji}</span> <span className="font-black text-white">{product.name}</span> · {product.category} · ${product.price.toFixed(2)}
        </p>
        <p className="mt-1 text-xs text-zinc-500">Se borra junto con su receta. Las ventas ya hechas no cambian.</p>

        {aliases === null ? (
          <p className="mt-4 text-sm text-zinc-400">Revisando equivalencias…</p>
        ) : hasUses ? (
          <div className="mt-4 rounded-2xl border border-yellow-500/40 bg-yellow-500/5 p-3 text-sm">
            <p className="font-black text-yellow-300">⚠️ Este producto se usa en:</p>
            <ul className="mt-2 space-y-1 text-zinc-300">
              {aliases.map((a) => (
                <li key={a.id}>
                  🛵 Equivalencia “{a.externalName}”{a.platform ? ` (${a.platform})` : ""}
                </li>
              ))}
              {linked.map((p) => (
                <li key={p.id}>
                  🔗 Opción de {p.emoji} {p.name}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-zinc-400">
              {replacement
                ? `Se reemplazará por ${replacement.name} en todo eso y luego se borra.`
                : "Si no eliges reemplazo, esas equivalencias y opciones se quitan."}
            </p>
          </div>
        ) : (
          <p className="mt-4 text-sm text-zinc-400">No tiene equivalencias de delivery ni está enlazado como opción de otro producto.</p>
        )}
        {aliasError && <p className="mt-2 text-xs text-yellow-500">No se pudieron revisar las equivalencias de delivery (sin conexión). Revísalas después en Delivery → Equivalencias.</p>}

        {hasUses && (
          <div className="mt-4">
            <p className="text-xs font-bold text-zinc-400">Reemplazar por otro producto (opcional)</p>
            {replacement ? (
              <div className="mt-1 flex items-center gap-2 rounded-2xl border border-orange-500/50 bg-orange-500/10 p-3">
                <span className="text-2xl">{replacement.emoji}</span>
                <span className="min-w-0 flex-1 truncate font-black">{replacement.name}</span>
                <button onClick={() => setReplacement(null)} className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300">
                  Quitar
                </button>
              </div>
            ) : (
              <button onClick={() => setPicking(true)} className="mt-1 w-full rounded-2xl border border-zinc-700 bg-black px-4 py-3 text-left text-sm font-bold text-zinc-300 hover:border-orange-500">
                🔍 Buscar producto para reemplazarlo
              </button>
            )}
          </div>
        )}

        <div className="mt-5 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-2xl border border-zinc-800 py-3 font-black">
            Cancelar
          </button>
          <button
            onClick={confirm}
            disabled={aliases === null || busy}
            className="flex-1 rounded-2xl bg-red-500 py-3 font-black text-black disabled:opacity-50"
          >
            {busy ? "Eliminando…" : replacement ? "Reemplazar y eliminar" : "Sí, eliminar"}
          </button>
        </div>
      </div>

      {picking && (
        <ProductPicker
          title="Reemplazar por..."
          products={linkable}
          onClose={() => setPicking(false)}
          onPick={(p) => {
            setReplacement(p);
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}
