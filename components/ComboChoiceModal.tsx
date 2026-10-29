"use client";
/**
 * POS: elegir antes de agregar un producto:
 *  - en combos, la parte a elegir (ej. qué refresco);
 *  - las opciones del producto o de cada parte (aderezo, salsas...), con su precio extra.
 */
import { useMemo, useState } from "react";
import type { ModifierGroup, Product } from "@/data/products";
import { extrasPrice, modifierProblem, resolveParts, soldModifiers, type SoldModifier, type SoldPart } from "@/lib/compound";

type Props = {
  product: Product;
  products: Product[];
  onConfirm: (result: { parts?: SoldPart[]; modifiers?: SoldModifier[] }) => void;
  onClose: () => void;
};

type Picks = Record<string, string[]>; // grupo → opciones elegidas

const OWN = "__producto"; // opciones del producto mismo (no de una parte)

export function ComboChoiceModal({ product, products, onConfirm, onClose }: Props) {
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const components = product.components || [];
  const [chosen, setChosen] = useState<Record<string, number>>({}); // parte → producto
  const [picks, setPicks] = useState<Record<string, Picks>>({}); // dueño (OWN o parte) → grupo → opciones

  const partProduct = (key: string) => {
    const component = components.find((c) => c.key === key)!;
    const id = chosen[key] ?? (component.options.length === 1 ? component.options[0] : undefined);
    return id !== undefined ? byId.get(id) : undefined;
  };

  // Quién tiene opciones para elegir: el producto y cada parte ya decidida
  const owners: { key: string; title: string; groups: ModifierGroup[] }[] = [
    ...(product.modifierGroups?.length ? [{ key: OWN, title: product.name, groups: product.modifierGroups }] : []),
    ...components.flatMap((c) => {
      const p = partProduct(c.key);
      return p?.modifierGroups?.length ? [{ key: c.key, title: p.name, groups: p.modifierGroups }] : [];
    }),
  ];

  const toggle = (owner: string, group: ModifierGroup, optionKey: string) =>
    setPicks((prev) => {
      const current = prev[owner]?.[group.key] || [];
      let next: string[];
      if (current.includes(optionKey)) next = current.filter((k) => k !== optionKey);
      else if (group.max === 1) next = [optionKey];
      else if (current.length >= group.max) return prev; // ya eligió el máximo
      else next = [...current, optionKey];
      return { ...prev, [owner]: { ...(prev[owner] || {}), [group.key]: next } };
    });

  const missingPart = components.find((c) => c.options.length > 1 && chosen[c.key] === undefined);
  const problem = missingPart
    ? `Elige ${missingPart.label || "una opción"}.`
    : owners.map((o) => modifierProblem(o.groups, picks[o.key] || {}, owners.length > 1 ? o.title : "")).find(Boolean) || "";

  const result = () => {
    const partModifiers = Object.fromEntries(
      owners.filter((o) => o.key !== OWN).map((o) => [o.key, soldModifiers(o.groups, picks[o.key] || {})])
    );
    const parts = components.length ? resolveParts(product, products, chosen, partModifiers) : undefined;
    const own = owners.find((o) => o.key === OWN);
    const modifiers = own ? soldModifiers(own.groups, picks[OWN] || {}) : [];
    return { parts, modifiers: modifiers.length ? modifiers : undefined };
  };
  const preview = result();
  const total = product.price + extrasPrice(preview.modifiers, preview.parts);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-zinc-800 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-bold text-orange-500">{components.length ? "Producto compuesto" : "Elige las opciones"}</p>
        <h2 className="text-2xl font-black">
          {product.emoji} {product.name}
        </h2>

        <div className="mt-5 space-y-5">
          {components
            .filter((c) => c.options.length > 1)
            .map((component) => (
              <div key={component.key}>
                <p className="mb-2 font-black">
                  Elige {component.label || "una opción"}
                  {component.quantity > 1 ? ` (${component.quantity})` : ""}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {component.options.map((id) => {
                    const option = byId.get(id);
                    if (!option) return null;
                    const active = chosen[component.key] === id;
                    return (
                      <button
                        key={id}
                        onClick={() => {
                          setChosen((prev) => ({ ...prev, [component.key]: id }));
                          setPicks((prev) => ({ ...prev, [component.key]: {} })); // otra parte, otras opciones
                        }}
                        className={`rounded-2xl border p-3 text-left text-sm font-bold ${active ? "border-orange-500 bg-orange-500/15 text-white" : "border-zinc-800 bg-black text-zinc-300"}`}
                      >
                        {option.emoji} {option.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

          {owners.map((owner) => (
            <div key={owner.key} className="space-y-4">
              {owner.key !== OWN && <p className="text-sm font-black text-orange-400">Opciones de {owner.title}</p>}
              {owner.groups.map((group) => {
                const selected = picks[owner.key]?.[group.key] || [];
                return (
                  <div key={group.key}>
                    <p className="mb-2 font-black">
                      {group.name}{" "}
                      <span className="text-xs font-bold text-zinc-500">
                        {group.min > 0 ? "obligatorio" : "opcional"}
                        {group.max > 1 ? ` · hasta ${group.max}` : ""}
                      </span>
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {group.options.map((option) => {
                        const active = selected.includes(option.key);
                        return (
                          <button
                            key={option.key}
                            onClick={() => toggle(owner.key, group, option.key)}
                            className={`rounded-2xl border p-3 text-left text-sm font-bold ${active ? "border-orange-500 bg-orange-500/15 text-white" : "border-zinc-800 bg-black text-zinc-300"}`}
                          >
                            {option.name}
                            {option.price > 0 && <span className="ml-1 text-orange-400">+${option.price.toFixed(2)}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {problem && <p className="mt-4 text-sm text-zinc-400">{problem}</p>}
        <div className="mt-6 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-2xl border border-zinc-800 py-3 font-black">
            Cancelar
          </button>
          <button onClick={() => onConfirm(result())} disabled={Boolean(problem)} className="flex-1 rounded-2xl bg-orange-500 py-3 font-black text-black disabled:opacity-40">
            Agregar ${total.toFixed(2)}
          </button>
        </div>
      </div>
    </div>
  );
}
