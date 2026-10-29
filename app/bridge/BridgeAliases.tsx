"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Product } from "@/data/products";
import type { Ingredient } from "@/data/inventory";
import { getAdminIngredients, getAdminProducts } from "@/lib/admin";
import { bridgeFetch } from "@/lib/bridge/bridge-fetch";

type AliasActionType = "product" | "ingredient" | "bundle" | "ignore";

type AliasTarget = {
  id: string;
  name: string;
  quantity?: number;
  unit?: string;
};

type BridgeAlias = {
  id: string;
  normalizedExternalName: string;
  externalName: string;
  platform?: string | null;
  actionType: AliasActionType;
  targets: AliasTarget[];
  createdAt: string;
  updatedAt: string;
};

type AliasApiResponse = {
  success: boolean;
  count?: number;
  aliases?: BridgeAlias[];
  alias?: BridgeAlias;
  deleted?: boolean;
  error?: string;
};

type DraftTarget = {
  localId: string;
  ingredientId: string;
  quantity: string;
};

const ACTION_LABELS: Record<AliasActionType, string> = {
  product: "Producto del POS",
  ingredient: "Insumo / ingrediente",
  bundle: "Grupo de insumos",
  ignore: "Ignorar",
};

function createDraftTarget(): DraftTarget {
  const localId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return {
    localId,
    ingredientId: "",
    quantity: "",
  };
}

function normalizePlatform(value: string) {
  return value === "all" ? null : value;
}

type BridgeAliasesProps = {
  selectedExternalName?: string;
  selectedPlatform?: string;
  selectionToken?: number;
  onSaved?: () => void;
  showSavedAliases?: boolean;
};

export default function BridgeAliases({
  selectedExternalName,
  selectedPlatform,
  selectionToken,
  onSaved,
  showSavedAliases = false,
}: BridgeAliasesProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [aliases, setAliases] = useState<BridgeAlias[]>([]);
  const [externalName, setExternalName] = useState("");
  const [platform, setPlatform] = useState("all");
  const [actionType, setActionType] = useState<AliasActionType>("product");
  const [productId, setProductId] = useState("");
  const [targets, setTargets] = useState<DraftTarget[]>([createDraftTarget()]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  // Equivalencia que se está editando (se guarda encima en lugar de borrarla)
  const [editing, setEditing] = useState<BridgeAlias | null>(null);
  const formRef = useRef<HTMLElement | null>(null);
  const [aiNote, setAiNote] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadCatalogs = useCallback(() => {
    setProducts(getAdminProducts());
    setIngredients(getAdminIngredients());
  }, []);

  const refreshAliases = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await bridgeFetch("/api/bridge/aliases", {
        method: "GET",
        cache: "no-store",
      });

      const result = (await response.json()) as AliasApiResponse;

      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudieron cargar las equivalencias.");
      }

      setAliases(Array.isArray(result.aliases) ? result.aliases : []);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No se pudieron cargar las equivalencias."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    loadCatalogs();
    await refreshAliases();
  }, [loadCatalogs, refreshAliases]);

  useEffect(() => {
    loadCatalogs();
    void refreshAliases();
  }, [loadCatalogs, refreshAliases]);

  useEffect(() => {
    if (!selectedExternalName) {
      return;
    }

    setExternalName(selectedExternalName);
    setPlatform(selectedPlatform || "all");
    setAiNote("");
    setMessage("");
    setError("");
  }, [selectedExternalName, selectedPlatform, selectionToken]);

  useEffect(() => {
    setMessage("");
    setError("");

    if (actionType === "product") {
      setTargets([createDraftTarget()]);
      return;
    }

    if (actionType === "ignore") {
      setProductId("");
      setTargets([]);
      return;
    }

    setProductId("");

    if (actionType === "ingredient") {
      setTargets((currentTargets) => [currentTargets[0] || createDraftTarget()]);
      return;
    }

    if (actionType === "bundle") {
      setTargets((currentTargets) =>
        currentTargets.length > 0 ? currentTargets : [createDraftTarget()]
      );
    }
  }, [actionType]);

  const sortedProducts = useMemo(
    () =>
      [...products].sort((left, right) =>
        left.name.localeCompare(right.name, "es", { sensitivity: "base" })
      ),
    [products]
  );

  const sortedIngredients = useMemo(
    () =>
      [...ingredients].sort((left, right) =>
        left.name.localeCompare(right.name, "es", { sensitivity: "base" })
      ),
    [ingredients]
  );

  const sortedAliases = useMemo(
    () =>
      [...aliases].sort((left, right) =>
        left.externalName.localeCompare(right.externalName, "es", {
          sensitivity: "base",
        })
      ),
    [aliases]
  );

  function resetForm() {
    setEditing(null);
    setExternalName("");
    setPlatform("all");
    setActionType("product");
    setProductId("");
    setTargets([createDraftTarget()]);
  }

  function updateTarget(
    localId: string,
    field: keyof Pick<DraftTarget, "ingredientId" | "quantity">,
    value: string
  ) {
    setTargets((currentTargets) =>
      currentTargets.map((target) =>
        target.localId === localId ? { ...target, [field]: value } : target
      )
    );
  }

  function addTarget() {
    setTargets((currentTargets) => {
      const nextTarget = createDraftTarget();
      return [...currentTargets, nextTarget];
    });
  }

  function removeTarget(localId: string) {
    setTargets((currentTargets) =>
      currentTargets.filter((target) => target.localId !== localId)
    );
  }

  function buildTargets(): AliasTarget[] {
    if (actionType === "ignore") {
      return [];
    }

    if (actionType === "product") {
      const product = products.find((item) => String(item.id) === productId);

      if (!product) {
        throw new Error("Selecciona el producto real del POS.");
      }

      return [
        {
          id: String(product.id),
          name: product.name,
        },
      ];
    }

    const cleanedTargets = targets.map((target, index) => {
      const ingredient = ingredients.find(
        (item) => String(item.id) === target.ingredientId
      );

      if (!ingredient) {
        throw new Error(`Selecciona el ingrediente ${index + 1}.`);
      }

      const quantity = Number(target.quantity);

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(
          `Escribe una cantidad válida para “${ingredient.name}”.`
        );
      }

      return {
        id: String(ingredient.id),
        name: ingredient.name,
        quantity,
        unit: ingredient.unit,
      };
    });

    if (cleanedTargets.length === 0) {
      throw new Error("Agrega al menos un ingrediente a la equivalencia.");
    }

    return cleanedTargets;
  }

  // Claude propone el producto (o ignorar); la persona revisa y guarda
  async function suggestWithAi() {
    setAiBusy(true);
    setAiNote("");
    setError("");
    try {
      const response = await bridgeFetch("/api/ai/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lines: [externalName.trim()],
          platform,
          products: products.map((p) => ({ id: p.id, name: p.name, category: p.category, price: p.price })),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "No se pudo consultar a la IA.");
      const match = result.matches?.[0];
      if (!match || match.action === "unknown") {
        setAiNote("🤖 No encontré un producto que corresponda con seguridad. Elígelo tú.");
        return;
      }
      if (match.action === "ignore") {
        setActionType("ignore");
        setAiNote(`🤖 Sugiero ignorarlo: ${match.reason} Revisa y toca Guardar.`);
        return;
      }
      setActionType("product");
      setProductId(String(match.productId));
      const name = products.find((p) => p.id === match.productId)?.name || "";
      setAiNote(`🤖 ${name} (confianza ${match.confidence}): ${match.reason} Revisa y toca Guardar.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo consultar a la IA.");
    } finally {
      setAiBusy(false);
    }
  }

  /** Carga una equivalencia guardada en el formulario para cambiarla. */
  function editAlias(alias: BridgeAlias) {
    setEditing(alias);
    setExternalName(alias.externalName);
    setPlatform(alias.platform || "all");
    setActionType(alias.actionType);
    setAiNote("");
    setError("");
    setMessage("");
    if (alias.actionType === "product") {
      setProductId(String(alias.targets[0]?.id || ""));
      setTargets([createDraftTarget()]);
    } else if (alias.actionType === "ignore") {
      setProductId("");
      setTargets([]);
    } else {
      setProductId("");
      setTargets(
        alias.targets.map((t) => ({ ...createDraftTarget(), ingredientId: String(t.id), quantity: String(t.quantity ?? "") }))
      );
    }
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function saveAlias() {
    setMessage("");
    setError("");

    if (!externalName.trim()) {
      setError("Escribe la línea tal como llega desde la plataforma.");
      return;
    }

    setSaving(true);

    try {
      const response = await bridgeFetch("/api/bridge/aliases", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          externalName: externalName.trim(),
          platform: normalizePlatform(platform),
          actionType,
          targets: buildTargets(),
        }),
      });

      const result = (await response.json()) as AliasApiResponse;

      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudo guardar la equivalencia.");
      }

      // Si al editar se cambió el texto o la plataforma, la equivalencia vieja sobra
      const old = editing;
      if (old && (old.normalizedExternalName !== result.alias?.normalizedExternalName || (old.platform || null) !== (result.alias?.platform ?? null)) && old.id !== result.alias?.id) {
        await bridgeFetch("/api/bridge/aliases", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: old.id }) });
      }
      setMessage(old ? "Equivalencia actualizada." : "Equivalencia guardada correctamente.");
      await refreshAliases();
      onSaved?.();
      resetForm();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No se pudo guardar la equivalencia."
      );
    } finally {
      setSaving(false);
    }
  }

  async function deleteAlias(alias: BridgeAlias) {
    const confirmed = window.confirm(
      `¿Eliminar la equivalencia “${alias.externalName}”?`
    );

    if (!confirmed) {
      return;
    }

    setMessage("");
    setError("");

    try {
      const response = await bridgeFetch("/api/bridge/aliases", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id: alias.id }),
      });

      const result = (await response.json()) as AliasApiResponse;

      if (!response.ok || !result.success) {
        throw new Error(result.error || "No se pudo eliminar la equivalencia.");
      }

      setMessage("Equivalencia eliminada.");
      await refreshAliases();
      onSaved?.();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "No se pudo eliminar la equivalencia."
      );
    }
  }

  return (
    <section ref={formRef} className="scroll-mt-28 rounded-3xl border border-zinc-800 bg-zinc-950 p-6 text-white">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-orange-500">
            Equivalencias Bridge
          </h2>

          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Relaciona cada línea cuantificada con productos e ingredientes reales
            de B-POS. Los productos usarán su receta cuando se cree la venta.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void refreshAll()}
          disabled={loading}
          className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-bold text-zinc-200 transition hover:border-orange-500 hover:text-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Actualizando..." : "Actualizar catálogos"}
        </button>
      </div>

      <div className="mt-6 grid gap-4">
        <label className="grid gap-2 text-sm font-bold text-zinc-300">
          Línea recibida
          <input
            value={externalName}
            onChange={(event) => setExternalName(event.target.value)}
            placeholder="Nombre tal como llega en el ticket"
            className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 font-normal text-white outline-none transition focus:border-orange-500"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void suggestWithAi()}
            disabled={!externalName.trim() || aiBusy}
            className="rounded-2xl border border-sky-500/60 bg-sky-500/10 px-4 py-2 text-sm font-black text-sky-200 disabled:opacity-40"
          >
            {aiBusy ? "🤖 Revisando..." : "🤖 Sugerir con IA"}
          </button>
          {aiNote && <p className="text-sm text-sky-200">{aiNote}</p>}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-bold text-zinc-300">
            Plataforma
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value)}
              className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 font-normal text-white outline-none transition focus:border-orange-500"
            >
              <option value="all">Todas las plataformas</option>
              <option value="didi">DiDi Food</option>
              <option value="uber">Uber Eats</option>
              <option value="rappi">Rappi</option>
            </select>
          </label>

          <label className="grid gap-2 text-sm font-bold text-zinc-300">
            Acción
            <select
              value={actionType}
              onChange={(event) =>
                setActionType(event.target.value as AliasActionType)
              }
              className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 font-normal text-white outline-none transition focus:border-orange-500"
            >
              <option value="product">Producto del POS</option>
              <option value="ingredient">Insumo / ingrediente</option>
              <option value="bundle">Grupo de insumos</option>
              <option value="ignore">Ignorar</option>
            </select>
          </label>
        </div>

        {actionType === "product" && (
          <label className="grid gap-2 text-sm font-bold text-zinc-300">
            Producto real en B-POS
            <select
              value={productId}
              onChange={(event) => setProductId(event.target.value)}
              className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 font-normal text-white outline-none transition focus:border-orange-500"
            >
              <option value="">Selecciona un producto</option>
              {sortedProducts.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>

            <span className="text-xs font-normal text-zinc-500">
              Al crear la venta, B-POS aplicará la receta configurada para este
              producto.
            </span>
          </label>
        )}

        {(actionType === "ingredient" || actionType === "bundle") && (
          <div className="rounded-2xl border border-zinc-800 bg-black/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-black text-zinc-100">
                  {actionType === "ingredient"
                    ? "Ingrediente de inventario"
                    : "Ingredientes del grupo"}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  La cantidad se aplicará por cada unidad recibida en el ticket.
                </p>
              </div>

              {actionType === "bundle" && (
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-bold text-zinc-400">
                    {targets.length} {targets.length === 1 ? "ingrediente" : "ingredientes"}
                  </span>

                  <button
                    type="button"
                    onClick={addTarget}
                    className="rounded-xl border border-orange-500 px-3 py-2 text-xs font-black text-orange-400 transition hover:bg-orange-500 hover:text-black"
                  >
                    + Agregar ingrediente
                  </button>
                </div>
              )}
            </div>

            <div className="mt-4 space-y-3">
              {targets.map((target, index) => {
                const selectedIngredient = ingredients.find(
                  (item) => String(item.id) === target.ingredientId
                );

                return (
                  <div
                    key={target.localId}
                    className="grid gap-3 rounded-2xl border border-zinc-800 p-4 md:grid-cols-[1fr_150px_90px_auto]"
                  >
                    <label className="grid gap-2 text-xs font-bold text-zinc-400">
                      Ingrediente {index + 1}
                      <select
                        value={target.ingredientId}
                        onChange={(event) =>
                          updateTarget(
                            target.localId,
                            "ingredientId",
                            event.target.value
                          )
                        }
                        className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-normal text-white outline-none focus:border-orange-500"
                      >
                        <option value="">Selecciona un ingrediente</option>
                        {sortedIngredients.map((ingredient) => (
                          <option key={ingredient.id} value={ingredient.id}>
                            {ingredient.name} · {ingredient.unit}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="grid gap-2 text-xs font-bold text-zinc-400">
                      Cantidad
                      <input
                        value={target.quantity}
                        onChange={(event) =>
                          updateTarget(
                            target.localId,
                            "quantity",
                            event.target.value
                          )
                        }
                        type="number"
                        min="0.0001"
                        step="any"
                        placeholder="0"
                        className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm font-normal text-white outline-none focus:border-orange-500"
                      />
                    </label>

                    <div className="grid gap-2 text-xs font-bold text-zinc-400">
                      Unidad
                      <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-center text-sm font-black text-zinc-200">
                        {selectedIngredient?.unit || "—"}
                      </div>
                    </div>

                    {actionType === "bundle" ? (
                      <button
                        type="button"
                        onClick={() => removeTarget(target.localId)}
                        disabled={targets.length === 1}
                        className="mt-6 h-fit rounded-xl border border-red-900 px-3 py-2 text-sm font-bold text-red-400 transition hover:bg-red-950 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        Quitar
                      </button>
                    ) : (
                      <div />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {actionType === "ignore" && (
          <div className="rounded-2xl border border-zinc-800 bg-black/50 p-4 text-sm text-zinc-400">
            Cuando llegue esta línea, el Bridge la reconocerá y no ejecutará
            ninguna acción.
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-red-900 bg-red-950/40 px-4 py-3 text-sm font-bold text-red-300">
            {error}
          </div>
        )}

        {message && (
          <div className="rounded-2xl border border-emerald-900 bg-emerald-950/40 px-4 py-3 text-sm font-bold text-emerald-300">
            {message}
          </div>
        )}

        <button
          type="button"
          onClick={() => void saveAlias()}
          disabled={saving}
          className="w-full rounded-2xl bg-orange-500 py-3 font-black text-black transition hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Guardando..." : editing ? "Guardar cambios de la equivalencia" : "Guardar equivalencia"}
        </button>
        {editing && (
          <button type="button" onClick={resetForm} className="w-full rounded-2xl border border-zinc-700 py-3 text-sm font-black text-zinc-300">
            Cancelar edición
          </button>
        )}
      </div>

      {showSavedAliases && (
      <div className="mt-8">
        <div className="flex items-center justify-between gap-4">
          <h3 className="font-black text-zinc-100">Equivalencias guardadas</h3>
          <span className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-bold text-zinc-400">
            {aliases.length}
          </span>
        </div>

        <div className="mt-4 space-y-3">
          {loading ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 p-5 text-center text-sm text-zinc-500">
              Cargando equivalencias...
            </div>
          ) : sortedAliases.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-800 p-5 text-center text-sm text-zinc-500">
              Todavía no hay equivalencias Bridge.
            </div>
          ) : (
            sortedAliases.map((alias) => (
              <article
                key={alias.id}
                className="rounded-2xl border border-zinc-800 bg-black p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="break-words font-black text-white">
                        {alias.externalName}
                      </p>

                      <span className="rounded-full bg-orange-500/15 px-2 py-1 text-[11px] font-black uppercase text-orange-400">
                        {ACTION_LABELS[alias.actionType]}
                      </span>

                      <span className="rounded-full bg-zinc-900 px-2 py-1 text-[11px] font-bold uppercase text-zinc-500">
                        {alias.platform || "Todas"}
                      </span>
                    </div>

                    {alias.actionType === "ignore" ? (
                      <p className="mt-2 text-sm text-zinc-500">→ Sin acción</p>
                    ) : (
                      <div className="mt-2 space-y-1">
                        {alias.targets.map((target) => (
                          <p
                            key={`${alias.id}-${target.id}`}
                            className="text-sm text-zinc-400"
                          >
                            {/* Nombre actual del producto: la equivalencia va por su número interno, no por el nombre */}
                            → {(alias.actionType === "product" ? products.find((p) => String(p.id) === String(target.id))?.name : ingredients.find((i) => String(i.id) === String(target.id))?.name) || target.name}
                            {target.quantity !== undefined
                              ? ` · ${target.quantity}${
                                  target.unit ? ` ${target.unit}` : ""
                                }`
                              : ""}
                            {/* El producto se borró o cambió de id (ej. al subir el menú): hay que volver a enlazar */}
                            {alias.actionType === "product" && !products.some((p) => String(p.id) === String(target.id)) && (
                              <button
                                type="button"
                                onClick={() => {
                                  setExternalName(alias.externalName);
                                  setPlatform(alias.platform || "all");
                                  setActionType("product");
                                  setProductId("");
                                  setAiNote("");
                                }}
                                className="ml-2 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-black text-red-300"
                              >
                                ⚠️ Ese producto ya no existe · volver a enlazar
                              </button>
                            )}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => editAlias(alias)}
                      className="rounded-xl border border-zinc-700 px-3 py-2 text-xs font-black text-zinc-200 transition hover:border-orange-500 hover:text-orange-400"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteAlias(alias)}
                      className="rounded-xl border border-red-900 px-3 py-2 text-xs font-black text-red-400 transition hover:bg-red-950"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
      )}
    </section>
  );
}
