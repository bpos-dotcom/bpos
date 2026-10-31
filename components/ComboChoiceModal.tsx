"use client";
/**
 * POS: elegir las opciones de un producto antes de agregarlo (salsas,
 * aderezo, el refresco del combo...). Las opciones enlazadas a un producto
 * que tiene sus propias opciones (los boneless del combo) muestran también
 * esas opciones. Los grupos de una sola opción obligatoria ya vienen elegidos.
 */
import { useMemo, useState } from "react";
import type { ExtraStation, ModifierGroup, Product } from "@/data/products";
import {
  OWN_OPTIONS,
  autoPicks,
  buildSelection,
  extraCount,
  extrasPrice,
  isAutoGroup,
  linkedOwner,
  linkedWithOptions,
  modifierProblem,
  optionName,
  type SoldModifier,
  type SoldPart,
} from "@/lib/compound";
import { describeGroup } from "@/components/products/ModifierEditor";

type Props = {
  product: Product;
  products: Product[];
  onConfirm: (result: { parts?: SoldPart[]; modifiers?: SoldModifier[]; ownTicket: boolean; comment?: string; extraStations?: ExtraStation[] }) => void;
  onClose: () => void;
};

type Picks = Record<string, string[]>;

export function ComboChoiceModal({ product, products, onConfirm, onClose }: Props) {
  const [picks, setPicks] = useState<Record<string, Picks>>({});
  const [withComment, setWithComment] = useState(false);
  const [comment, setComment] = useState("");
  // Instrucción para una parte del combo (producto enlazado → texto)
  const [partComments, setPartComments] = useState<Record<number, string>>({});
  const [openPartComment, setOpenPartComment] = useState<number | null>(null);
  const pickedOf = (owner: string, groups: ModifierGroup[] | undefined) => ({ ...autoPicks(groups), ...(picks[owner] || {}) });

  const ownPicks = pickedOf(OWN_OPTIONS, product.modifierGroups);
  const linked = useMemo(() => linkedWithOptions(product, products, ownPicks), [product, products, ownPicks]);
  const owners = [
    { key: OWN_OPTIONS, title: product.name, groups: product.modifierGroups || [] },
    ...linked.map((p) => ({ key: linkedOwner(p.id), title: p.name, groups: p.modifierGroups || [] })),
  ];

  // Grupo de una sola opción a la vez (máximo 1): tocar cambia la elección.
  // Si no: cada toque suma una (se puede repetir, doble BBQ) hasta el máximo.
  const single = (group: ModifierGroup) => group.max === 1;
  const setGroup = (owner: string, groups: ModifierGroup[], group: ModifierGroup, next: string[]) =>
    setPicks((prev) => ({ ...prev, [owner]: { ...pickedOf(owner, groups), ...(prev[owner] || {}), [group.key]: next } }));
  const add = (owner: string, groups: ModifierGroup[], group: ModifierGroup, optionKey: string) => {
    const current = pickedOf(owner, groups)[group.key] || [];
    if (single(group)) return setGroup(owner, groups, group, current[0] === optionKey ? [] : [optionKey]);
    if (group.max > 0 && current.length >= group.max) return; // ya eligió el máximo
    setGroup(owner, groups, group, [...current, optionKey]);
  };
  const remove = (owner: string, groups: ModifierGroup[], group: ModifierGroup, optionKey: string) => {
    const current = pickedOf(owner, groups)[group.key] || [];
    const i = current.lastIndexOf(optionKey);
    if (i >= 0) setGroup(owner, groups, group, [...current.slice(0, i), ...current.slice(i + 1)]);
  };

  const problem = owners.map((o) => modifierProblem(o.groups, pickedOf(o.key, o.groups), owners.length > 1 ? o.title : "")).find(Boolean) || "";
  const result = buildSelection(product, products, picks);
  const total = product.price + extrasPrice(result.modifiers, result.parts);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-zinc-800 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-bold text-orange-500">Elige las opciones</p>
        <h2 className="text-2xl font-black">
          {product.emoji} {product.name}
        </h2>

        <div className="mt-5 space-y-5">
          {owners.map((owner) => {
            const ownerPicks = pickedOf(owner.key, owner.groups);
            return (
              <div key={owner.key} className="space-y-4">
                {owner.key !== OWN_OPTIONS && <p className="border-t border-zinc-800 pt-4 text-sm font-black text-orange-400">Opciones de {owner.title}</p>}
                {owner.groups.map((group) => {
                  const selected = ownerPicks[group.key] || [];
                  const extras = extraCount(group, selected.length);
                  // Lo fijo (una sola opción obligatoria) se muestra como ya incluido
                  if (isAutoGroup(group) && selected.length === group.min && group.max === group.min) {
                    return (
                      <p key={group.key} className="text-sm text-zinc-400">
                        ✔ {group.name}: {group.min > 1 ? `${group.min}x ` : ""}
                        {optionName(group.options[0], products)}
                      </p>
                    );
                  }
                  return (
                    <div key={group.key}>
                      <p className="font-black">{group.name}</p>
                      <p className="mb-2 text-xs font-bold text-zinc-500">
                        {describeGroup(group)} · elegidas {selected.length}
                        {extras > 0 && (
                          <span className="text-orange-400">
                            {" "}
                            · {extras} extra{group.extraPrice > 0 ? ` +$${(extras * group.extraPrice).toFixed(2)}` : ""}
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
                              <button onClick={() => add(owner.key, owner.groups, group, option.key)} className="flex-1 p-3 text-left">
                                {option.productId ? "🔗 " : ""}
                                {optionName(option, products)}
                                {Number(option.extraPrice) > 0 && <span className="ml-1 text-orange-400">+${Number(option.extraPrice)}</span>}
                                {count > 1 && <span className="ml-1 text-orange-400">×{count}</span>}
                              </button>
                              {count > 0 && !single(group) && (
                                <button onClick={() => remove(owner.key, owner.groups, group, option.key)} className="px-3 py-3 text-lg font-black text-zinc-400" aria-label={`Quitar ${option.name}`}>
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
            );
          })}
        </div>

        {/* Producto compuesto: instrucción para cada producto que lleva (le llega solo a su estación) */}
        {(result.parts?.length ?? 0) > 0 && (
          <div className="mt-5 border-t border-zinc-800 pt-4">
            <p className="text-sm font-black text-zinc-300">Instrucciones por producto</p>
            <div className="mt-2 space-y-2">
              {result.parts!.map((part) => (
                <div key={part.productId} className="rounded-2xl border border-zinc-800 bg-black p-3">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="font-bold">
                      {part.quantity > 1 ? `${part.quantity}x ` : ""}
                      {part.name} <span className="text-xs text-orange-400">· {part.station}</span>
                    </span>
                    <button
                      onClick={() => setOpenPartComment(openPartComment === part.productId ? null : part.productId)}
                      className="rounded-xl border border-zinc-700 px-2 py-1 text-xs font-black text-zinc-300"
                    >
                      💬 {partComments[part.productId] ? "Editar" : "Instrucción"}
                    </button>
                  </div>
                  {partComments[part.productId] && openPartComment !== part.productId && <p className="mt-1 text-xs font-bold text-yellow-200">💬 {partComments[part.productId]}</p>}
                  {openPartComment === part.productId && (
                    <input
                      autoFocus
                      value={partComments[part.productId] || ""}
                      onChange={(e) => setPartComments((prev) => ({ ...prev, [part.productId]: e.target.value }))}
                      placeholder={`Ej. ${part.station === "Parrilla" ? "sin cebolla, término medio" : "bien dorado, sin sal"}`}
                      aria-label={`Instrucción para ${part.name}`}
                      className="mt-2 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Comentario para la cocina (opcional) */}
        <label className="mt-5 flex cursor-pointer items-center gap-3 border-t border-zinc-800 pt-4 font-black">
          <input type="checkbox" checked={withComment} onChange={(e) => setWithComment(e.target.checked)} className="h-5 w-5 accent-orange-500" />
          💬 Comentarios
        </label>
        {withComment && (
          <textarea
            autoFocus
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Ej. sin cebolla, bien cocido, para llevar..."
            aria-label="Comentario"
            rows={2}
            className="mt-2 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-sm"
          />
        )}

        {problem && <p className="mt-4 text-sm text-zinc-400">{problem}</p>}
        <div className="mt-6 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-2xl border border-zinc-800 py-3 font-black">
            Cancelar
          </button>
          <button
            onClick={() =>
              onConfirm({
                ...result,
                parts: result.parts?.map((p) => (partComments[p.productId]?.trim() ? { ...p, comment: partComments[p.productId].trim() } : p)),
                comment: withComment && comment.trim() ? comment.trim() : undefined,
              })
            } disabled={Boolean(problem)} className="flex-1 rounded-2xl bg-orange-500 py-3 font-black text-black disabled:opacity-40">
            Agregar ${total.toFixed(2)}
          </button>
        </div>
      </div>
    </div>
  );
}
