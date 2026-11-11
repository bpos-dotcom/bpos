"use client";
/**
 * Insumos del inventario: Tu negocio → Ingredientes (lo que lleva la receta)
 * y Tu negocio → Packaging (empaques: contenedores, bolsas, vasos...). Es la
 * misma lista de insumos; cada pantalla muestra solo los suyos.
 */
import { useEffect, useMemo, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { Ingredient, SUGGESTED_CATEGORIES, SUGGESTED_PACKAGING_CATEGORIES, isPackaging } from "@/data/inventory";
import { getAdminIngredients, saveAdminIngredients } from "@/lib/admin";
import { stationLabel } from "@/lib/kds-config";
import { TicketEquivalences } from "@/components/inventory/TicketEquivalences";
import { ManualCost } from "@/components/inventory/ManualCost";
import { ask, askText, notify } from "@/components/layout/Dialogs";
import { getKardex, recordStockEdit, type InventoryMovement } from "@/lib/inventory";
import { CheckChips, MoveCard, MovesList, StockBadge, checkItems, isLow, isMovesCheck, isOut, qty, stockMoves, type StockCheck } from "@/components/inventory/StockCheck";
import { addAuditEvent } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { UNITS, changeIngredientUnit, unitChangeImpact, unitFactor } from "@/lib/units";
import { brandInventoryCategories } from "@/lib/brands";

const NO_CATEGORY = "Sin categoría";
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

type DraftIngredient = Ingredient;

export type SupplyKind = "ingrediente" | "packaging";

const TEXT: Record<SupplyKind, { title: string; subtitle: string; list: string; one: string; nuevo: string; ficha: string; buscar: string }> = {
  ingrediente: { title: "Administración de Ingredientes", subtitle: "Edita ingredientes, unidades, stock y mínimos del inventario.", list: "Ingredientes", one: "ingrediente", nuevo: "Nuevo ingrediente", ficha: "Ficha de ingrediente", buscar: "🔍 Buscar ingrediente" },
  packaging: { title: "Packaging", subtitle: "Tus empaques: contenedores, bolsas, vasos, aderezos para llevar... Cada producto dice cuánto lleva en su recuadro Packaging.", list: "Packaging", one: "empaque", nuevo: "Nuevo empaque", ficha: "Ficha de empaque", buscar: "🔍 Buscar empaque" },
};

const mineOf = (kind: SupplyKind) => (i: Ingredient) => (kind === "packaging" ? isPackaging(i) : !isPackaging(i));

export function SuppliesManager({ kind }: { kind: SupplyKind }) {
  const t = TEXT[kind];
  const SUGGESTED = kind === "packaging" ? SUGGESTED_PACKAGING_CATEGORIES : SUGGESTED_CATEGORIES;
  const mine = mineOf(kind);
  // Todos los insumos (se guardan juntos); la pantalla solo muestra los de su tipo
  const [all, setIngredients] = useState<Ingredient[]>([]);
  const ingredients = useMemo(() => all.filter(mineOf(kind)), [all, kind]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftIngredient | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(""); // "" = todas
  const [newCategory, setNewCategory] = useState(false);
  const [check, setCheck] = useState<StockCheck>("");
  const [kardex, setKardex] = useState<InventoryMovement[]>([]);

  /**
   * Cambiar la unidad: entre g y kg (o ml y L) se convierte todo lo que usa el
   * ingrediente (existencia, mínimo, recetas, opciones, compras y costos) y se
   * guarda en ese momento; entre tipos distintos (g → pza) solo cambia la unidad.
   */
  async function changeUnit(to: Ingredient["unit"]) {
    if (!draft) return;
    const saved = ingredients.find((i) => i.id === draft.id);
    if (!saved || saved.unit === to) {
      setDraft({ ...draft, unit: to });
      return;
    }
    const factor = unitFactor(saved.unit, to);
    const impact = unitChangeImpact(saved.id);
    const uses = [impact.recipes ? `${impact.recipes} receta(s)` : "", impact.options ? `${impact.options} opción(es) de productos` : ""].filter(Boolean).join(" y ");
    if (factor === null) {
      if ((uses || saved.stock) && !(await ask(`De ${saved.unit} a ${to} son medidas distintas: las cantidades NO se convierten${uses ? ` y tendrás que revisar ${uses}` : ""}. ¿Cambiar de todos modos?`, { ok: "Cambiar" }))) return;
      setDraft({ ...draft, unit: to });
      return;
    }
    const r = (n: number) => Math.round(n * factor * 1e6) / 1e6;
    if ((saved.stock || saved.minimum || uses) && !(await ask(`Cambiar ${saved.name} de ${saved.unit} a ${to}: existencia ${saved.stock} ${saved.unit} → ${r(saved.stock)} ${to}, mínimo ${saved.minimum} → ${r(saved.minimum)}${uses ? `; se ajustan ${uses}` : ""}, y también sus compras y costos. ¿Continuar?`, { ok: "Convertir" }))) return;
    const next = changeIngredientUnit(saved.id, to);
    if (!next) return;
    setIngredients(getAdminIngredients());
    setDraft({ ...draft, unit: next.unit, stock: next.stock, minimum: next.minimum });
  }

  // Categorías con cuántos ingredientes tiene cada una (las que existen, en orden alfabético; "Sin categoría" al final)
  const categories = useMemo(() => {
    const map = new Map<string, number>();
    ingredients.forEach((i) => map.set(i.category?.trim() || NO_CATEGORY, (map.get(i.category?.trim() || NO_CATEGORY) || 0) + 1));
    return [...map.entries()].sort((a, b) => (a[0] === NO_CATEGORY ? 1 : b[0] === NO_CATEGORY ? -1 : a[0].localeCompare(b[0], "es")));
  }, [ingredients]);
  const grouped = useMemo(() => {
    const q = plain(query.trim());
    const checked = checkItems(ingredients, check);
    return categories
      .map(([c]) => [c, checked.filter((i) => (i.category?.trim() || NO_CATEGORY) === c && (!q || plain(i.name).includes(q))).sort((a, b) => a.name.localeCompare(b.name, "es"))] as const)
      .filter(([c, list]) => list.length > 0 && (!category || c === category));
  }, [categories, ingredients, query, category, check]);
  // Entradas o salidas de los de la categoría (y la búsqueda) elegida
  const moves = useMemo(() => stockMoves(kardex, grouped.flatMap(([, list]) => list), check), [kardex, grouped, check]);

  useEffect(() => {
    const savedIngredients = getAdminIngredients();
    setIngredients(savedIngredients);
    setKardex(getKardex());
    // Desde Inventario real (?insumo=ID): abre la ficha de ese insumo
    const wanted = Number(new URLSearchParams(window.location.search).get("insumo"));
    const target = (wanted && savedIngredients.find((i) => i.id === wanted && mineOf(kind)(i))) || savedIngredients.find(mineOf(kind));
    setSelectedId(target?.id ?? null);
    setDraft(target ?? null);
    if (wanted && target?.id === wanted) window.setTimeout(() => document.getElementById("ficha-insumo")?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }, [kind]);

  function selectIngredient(ingredient: Ingredient) {
    setNewCategory(false);
    setSelectedId(ingredient.id);
    setDraft({ ...ingredient });
  }

  async function saveDraft() {
    if (!draft) return;

    if (!draft.name.trim()) {
      alert(`El ${t.one} necesita nombre.`);
      return;
    }

    if (draft.minimum < 0 || draft.stock < 0) {
      alert("Stock y mínimo no pueden ser negativos.");
      return;
    }

    // Cambiar la existencia a mano queda en el Kardex y en la bitácora (y le llega al dueño): pide el motivo
    const previousStock = all.find((i) => i.id === draft.id)?.stock ?? 0;
    let stockReason = "";
    if (Number(draft.stock) !== Number(previousStock)) {
      const why = await askText(`Cambias la existencia de ${draft.name.trim()} de ${previousStock} a ${draft.stock} ${draft.unit}. ¿Por qué? (le llega al dueño)`, { placeholder: "Ej. conteo físico, llegó mercancía sin compra..." });
      if (!why?.trim()) {
        notify("No se guardó: escribe el motivo del cambio de existencia.", "error");
        return;
      }
      stockReason = why.trim();
    }

    const saved: Ingredient = { ...draft, name: draft.name.trim() };
    if (saved.category?.trim()) saved.category = saved.category.trim().replace(/\s+/g, " ").slice(0, 40);
    else delete saved.category;
    if (!saved.kind) delete saved.kind;
    const nextIngredients = all.map((ingredient) =>
      ingredient.id === draft.id ? saved : ingredient
    );

    setIngredients(nextIngredients);
    saveAdminIngredients(nextIngredients);
    if (stockReason) {
      const movement = recordStockEdit(saved, previousStock, stockReason);
      setKardex(getKardex());
      if (movement) {
        const user = getCurrentUser();
        const sign = movement.type === "Ajuste positivo" ? "+" : "-";
        addAuditEvent({
          category: "Inventario",
          action: "inventory.manual_edit",
          description: `${user.name} cambió a mano ${saved.name} de ${previousStock} a ${saved.stock} ${saved.unit} (${sign}${movement.quantity}) en la ficha. Motivo: ${stockReason}`,
          userId: user.id ? String(user.id) : undefined,
          userName: user.name,
          entityId: movement.id,
          metadata: { ingredientId: saved.id, previousStock, stock: saved.stock, reason: stockReason, from: "ficha" },
        });
      }
    }
    alert(mine(saved) ? `${t.one[0].toUpperCase()}${t.one.slice(1)} guardado correctamente.` : `Guardado. Ahora está en ${isPackaging(saved) ? "Packaging" : "Ingredientes"}.`);
    if (!mine(saved)) {
      const first = nextIngredients.find(mine);
      setSelectedId(first?.id ?? null);
      setDraft(first ?? null);
    }
  }

  function cancelChanges() {
    const original = ingredients.find(
      (ingredient) => ingredient.id === selectedId
    );
    if (original) setDraft({ ...original });
  }

  function addIngredient() {
    const newIngredient: Ingredient = {
      id: Date.now(),
      name: t.nuevo,
      unit: "pza",
      stock: 0,
      minimum: 0,
      ...(category && category !== NO_CATEGORY ? { category } : {}),
      ...(kind === "packaging" ? { kind: "packaging" as const } : {}),
    };

    const nextIngredients = [...all, newIngredient];
    setIngredients(nextIngredients);
    saveAdminIngredients(nextIngredients);
    setSelectedId(newIngredient.id);
    setDraft(newIngredient);
  }

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell
        title={t.title}
        subtitle={t.subtitle}
      >
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_1fr]">
          <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-orange-500">
                  {t.list}
                </h2>
                <p className="mt-1 text-sm text-zinc-400">
                  Selecciona un {t.one} para editarlo.
                </p>
              </div>

              <button
                onClick={addIngredient}
                className="rounded-2xl bg-orange-500 px-4 py-3 font-black text-black"
              >
                +
              </button>
            </div>

            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.buscar} className="mt-4 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-sm" />
            {categories.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {[["", ingredients.length] as const, ...categories].map(([c, n]) => (
                  <button
                    key={c || "todas"}
                    onClick={() => setCategory(c)}
                    className={`rounded-full border px-3 py-1 text-xs font-black ${category === c ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 bg-black text-zinc-300 hover:border-orange-500"}`}
                  >
                    {c || "Todas"} · {n}
                  </button>
                ))}
              </div>
            )}

            {ingredients.length > 0 && (
              <div className="mt-3">
                <CheckChips items={category ? ingredients.filter((i) => (i.category?.trim() || NO_CATEGORY) === category) : ingredients} check={check} onChange={setCheck} />
              </div>
            )}

            {isMovesCheck(check) ? (
              <div className="bpos-scroll -mr-2 mt-4 max-h-[65vh] overflow-y-auto pr-2">
                <MovesList
                  moves={moves}
                  check={check}
                  scope={category || undefined}
                  renderMove={(m) => {
                    const item = ingredients.find((i) => i.id === m.ingredientId);
                    return <MoveCard move={m} name={item?.name} selected={selectedId === m.ingredientId} onClick={() => item && selectIngredient(item)} />;
                  }}
                />
              </div>
            ) : (
            <div className="bpos-scroll -mr-2 mt-4 max-h-[65vh] space-y-4 overflow-y-auto pr-2">
              {grouped.map(([c, list]) => (
                <div key={c}>
                  {(categories.length > 1 || c !== NO_CATEGORY) && <p className="mb-2 text-xs font-black uppercase tracking-wider text-zinc-500">{c} · {list.length}</p>}
                  <div className="space-y-2">
              {list.map((ingredient) => (
                <button
                  key={ingredient.id}
                  onClick={() => selectIngredient(ingredient)}
                  className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                    selectedId === ingredient.id
                      ? "border-orange-500 bg-orange-500/10"
                      : isOut(ingredient)
                        ? "border-red-500/50 bg-black hover:border-orange-500"
                        : isLow(ingredient)
                          ? "border-amber-500/50 bg-black hover:border-orange-500"
                          : "border-zinc-800 bg-black hover:border-orange-500"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-black">{ingredient.name}</p>
                    <StockBadge item={ingredient} />
                  </div>
                  <p className="text-sm text-zinc-400">
                    Stock: {qty(ingredient.stock)} {ingredient.unit} · Mínimo:{" "}
                    {qty(ingredient.minimum)} {ingredient.unit}
                  </p>
                </button>
              ))}
                  </div>
                </div>
              ))}
              {grouped.length === 0 && <p className="text-sm text-zinc-500">{ingredients.length ? (check === "bajo" ? "Nada bajo de su mínimo." : check === "agotado" ? "Nada agotado." : "Nada con esa búsqueda.") : kind === "packaging" ? "Sin empaques todavía. Agrégalos con + o desde una compra con foto del ticket." : "Sin ingredientes todavía."}</p>}
            </div>
            )}
          </section>

          <section id="ficha-insumo" className="scroll-mt-6 rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
            {!draft ? (
              <div className="rounded-2xl border border-dashed border-zinc-800 p-10 text-center text-zinc-500">
                Selecciona un {t.one}.
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-4 border-b border-zinc-800 pb-6 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-bold text-orange-500">
                      {t.ficha}
                    </p>
                    <h2 className="text-3xl font-black">{draft.name}</h2>
                    <p className="text-zinc-400">
                      {draft.stock} {draft.unit} disponibles
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={cancelChanges}
                      className="rounded-2xl border border-zinc-800 bg-black px-5 py-3 font-black text-white"
                    >
                      Cancelar
                    </button>

                    <button
                      onClick={saveDraft}
                      className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-black"
                    >
                      Guardar cambios
                    </button>
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <Field label="Nombre">
                    <input
                      value={draft.name}
                      onChange={(event) =>
                        setDraft({ ...draft, name: event.target.value })
                      }
                      className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
                    />
                  </Field>

                  <Field label="Unidad">
                    <select
                      value={draft.unit}
                      onChange={(event) => void changeUnit(event.target.value as Ingredient["unit"])}
                      className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
                    >
                      {UNITS.map((u) => (
                        <option key={u.value} value={u.value}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <TicketEquivalences key={`${draft.id}-${draft.unit}`} ingredient={draft} />

                  <ManualCost key={`cost-${draft.id}-${draft.unit}`} ingredient={draft} />

                  <Field label="Categoría">
                    {newCategory ? (
                      <div className="flex gap-2">
                        <input
                          autoFocus
                          value={draft.category || ""}
                          onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                          maxLength={40}
                          placeholder="Nombre de la nueva categoría"
                          className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
                        />
                        <button type="button" onClick={() => setNewCategory(false)} className="shrink-0 rounded-2xl border border-zinc-800 px-4 font-black text-zinc-300">
                          Listo
                        </button>
                      </div>
                    ) : (
                      <select
                        value={draft.category?.trim() || ""}
                        onChange={(event) => {
                          if (event.target.value === "__nueva") {
                            setDraft({ ...draft, category: "" });
                            setNewCategory(true);
                          } else setDraft({ ...draft, category: event.target.value });
                        }}
                        className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
                      >
                        <option value="">Sin categoría</option>
                        {[...new Set([...categories.map(([c]) => c).filter((c) => c !== NO_CATEGORY), ...(draft.category?.trim() ? [draft.category.trim()] : []), ...brandInventoryCategories(), ...SUGGESTED])].map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                        <option value="__nueva">➕ Nueva categoría…</option>
                      </select>
                    )}
                  </Field>

                  <Field label="Stock actual">
                    <input
                      type="number"
                      value={draft.stock}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          stock: Number(event.target.value),
                        })
                      }
                      className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
                    />
                  </Field>

                  <Field label="Stock mínimo">
                    <input
                      type="number"
                      value={draft.minimum}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          minimum: Number(event.target.value),
                        })
                      }
                      className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
                    />
                  </Field>

                  <Field label="Tipo">
                    <select
                      value={draft.kind || ""}
                      onChange={(event) => {
                        const next = { ...draft, kind: (event.target.value || undefined) as Ingredient["kind"] };
                        if (!next.kind) delete next.kind;
                        setDraft(next);
                      }}
                      className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
                    >
                      <option value="">🧂 Ingrediente (va en la receta)</option>
                      <option value="packaging">📦 Packaging (empaque del producto)</option>
                    </select>
                  </Field>

                  {kind === "ingrediente" && (
                  <Field label="Estación que lo prepara (opcional)">
                    <select
                      value={draft.station || ""}
                      onChange={(event) => {
                        const next = { ...draft, station: (event.target.value || undefined) as Ingredient["station"] };
                        if (!next.station) delete next.station;
                        setDraft(next);
                      }}
                      className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
                    >
                      <option value="">Ninguna (se usa tal cual)</option>
                      {(["Parrilla", "Freidora", "Barra", "Cocina"] as const).map((station) => (
                        <option key={station} value={station}>
                          {stationLabel(station)}
                        </option>
                      ))}
                    </select>
                    <span className="mt-2 block text-xs text-zinc-500">
                      Ej. el boneless se fríe en Freidora. Si un producto de otra estación lo lleva en su receta (Boneless Burger en Parrilla), B-POS te sugiere mandarle también una comanda a esta estación.
                    </span>
                  </Field>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </AppShell>
    </RequireRole>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label>
      <span className="mb-2 block text-sm font-bold text-zinc-400">
        {label}
      </span>
      {children}
    </label>
  );
}