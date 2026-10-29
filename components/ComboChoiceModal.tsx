"use client";
/**
 * POS: elegir antes de agregar un producto:
 *  - en combos, la parte a elegir (ej. qué refresco);
 *  - las opciones del producto o de cada parte (aderezo, salsas...), con su precio extra.
 */
import { useMemo, useState } from "react";
import type { ModifierGroup, Product } from "@/data/products";
import { extraCount, extrasPrice, modifierProblem, resolveParts, soldModifiers, type SoldModifier, type SoldPart } from "@/lib/compound";
import { describeGroup } from "@/components/products/ModifierEditor";

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

  // Grupo de una sola opción (ej. ranch Sí/No): tocar cambia la elección.
  // Si no: cada toque suma una (se puede repetir, doble BBQ) hasta el máximo.
  const single = (group: ModifierGroup) => group.max === 1;
  const setGroup = (owner: string, group: ModifierGroup, next: string[]) =>
    setPicks((prev) => ({ ...prev, [owner]: { ...(prev[owner] || {}), [group.key]: next } }));
  const add = (owner: string, group: ModifierGroup, optionKey: string) => {
    const current = picks[owner]?.[group.key] || [];
    if (single(group)) return setGroup(owner, group, current[0] === optionKey ? [] : [optionKey]);
    if (group.max > 0 && current.length >= group.max) return; // ya eligió el máximo
    setGroup(owner, group, [...current, optionKey]);
  };
  const remove = (owner: string, group: ModifierGroup, optionKey: string) => {
    const current = picks[owner]?.[group.key] || [];
    const i = current.lastIndexOf(optionKey);
    if (i >= 0) setGroup(owner, group, [...current.slice(0, i), ...current.slice(i + 1)]);
  };

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
                const extras = extraCount(group, selected.length);
                return (
                  <div key={group.key}>
                    <p className="font-black">{group.name}</p>
                    <p className="mb-2 text-xs font-bold text-zinc-500">
                      {describeGroup(group)} · elegidas {selected.length}
                      {extras > 0 && (
                        <span className="text-orange-400">
                          {" "}
                          · {extras} extra{group.extraPrice > 0 ? ` +${(extras * group.extraPrice).toFixed(2)}` : ""}
                        </span>
                      )}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {group.options.map((option) => {
                        const count = selected.filter((k) => k === option.key).length;
                        return (
                          <div
                            key={option.key}
                            className={`flex items-center rounded-2xl border text-sm font-bold ${count ? "border-orange-500 bg-orange-500/15 text-white" : "border-zinc-800 bg-black text-zinc-300"}`}
                          >
                            <button onClick={() => add(owner.key, group, option.key)} className="flex-1 p-3 text-left">
                              {option.name}
                              {count > 1 && <span className="ml-1 text-orange-400">×{count}</span>}
                            </button>
                            {count > 0 && !single(group) && (
                              <button onClick={() => remove(owner.key, group, option.key)} className="px-3 py-3 text-lg font-black text-zinc-400" aria-label={`Quitar ${option.name}`}>
                                −
                              </button>
                            )}
                          </div>
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
