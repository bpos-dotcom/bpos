"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { getAdminIngredients, getAdminProducts, getAdminRecipes } from "@/lib/admin";
import { buildOrderTickets } from "@/lib/bridge/order-tickets";
import { stationsForOrder } from "@/lib/bridge/station-routing";
import { getBusinessSettings } from "@/lib/business-settings";
import { printDeliveryTickets, printOriginalTicket, syncStationPrinters, toStationPrintersConfig } from "@/lib/localService";
import type { OrderInterpretation } from "@/lib/bridge/interpret-order";
import type { FinalOrderValidation } from "@/lib/bridge/validate-order";
import type { SaleReadyPayload } from "@/lib/bridge/prepare-sale";
import { createAutomaticSale } from "@/lib/bridge/create-automatic-sale";
import BridgeAliases from "./BridgeAliases";
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
};

type AgentOrder = {
  id?: number | string;
  platform?: string;
  orderId?: string | null;
  receivedAt?: string;
  bridgeReceivedAt?: string;
  customer?: { name?: string | null; phone?: string | null };
  delivery?: { address?: string | null; type?: string | null };
  rawText?: string;
  total?: number;
  status?: string;
  interpretation?: OrderInterpretation;
  interpretationUpdatedAt?: string;
  validation?: FinalOrderValidation;
  validationUpdatedAt?: string;
  readyForSale?: boolean;
  saleReadyPayload?: SaleReadyPayload | null;
  salePreparedAt?: string;
  createdOrderId?: number;
  stationPrint?: { at: string; stations: string[]; printers: string[] };
};

type QuantifiedItem = {
  id: string;
  qty: number;
  externalName: string;
  rawLine: string;
};

type AliasSelection = {
  externalName: string;
  platform: string;
  token: number;
};

const REFRESH_MS = 2000;
// Pedidos más viejos no se mandan a estaciones (ej. al abrir el Bridge horas después)
const STATION_PRINT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

const ACTION_LABELS: Record<AliasActionType, string> = {
  product: "Producto del POS",
  ingredient: "Ingrediente",
  bundle: "Grupo de insumos",
  ignore: "Ignorar",
};

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cleanExternalName(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(
      /\s+(?:MX\$|\$)\s*-?\d[\d,]*(?:\.\d{1,2})?\s*(?:MXN)?\s*$/i,
      ""
    )
    .trim();
}

function extractQuantifiedItems(rawText: string): QuantifiedItem[] {
  return String(rawText || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(/^\s*(\d{1,4})\s*[xX×]\s*(.+?)\s*$/);
      if (!match) return null;
      const qty = Number(match[1]);
      const externalName = cleanExternalName(match[2]);
      if (!Number.isInteger(qty) || qty <= 0 || !externalName) return null;
      return {
        id: `${index}-${qty}-${externalName}`,
        qty,
        externalName,
        rawLine: line,
      };
    })
    .filter((item): item is QuantifiedItem => Boolean(item));
}

function findAlias(
  aliases: BridgeAlias[],
  externalName: string,
  platform: string
) {
  const normalizedName = normalize(externalName);
  const normalizedPlatform = normalize(platform);

  return (
    aliases.find(
      (alias) =>
        alias.normalizedExternalName === normalizedName &&
        normalize(alias.platform) === normalizedPlatform
    ) ||
    aliases.find(
      (alias) =>
        alias.normalizedExternalName === normalizedName && !alias.platform
    )
  );
}

function platformLabel(value: unknown) {
  const platform = normalize(value);
  if (platform.includes("didi")) return "DiDi Food";
  if (platform.includes("uber")) return "Uber Eats";
  if (platform.includes("rappi")) return "Rappi";
  return "Externa";
}

export default function BridgePage() {
  const [orders, setOrders] = useState<AgentOrder[]>([]);
  const [aliases, setAliases] = useState<BridgeAlias[]>([]);
  const [selection, setSelection] = useState<AliasSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState("");
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [catalogProducts, setCatalogProducts] = useState(() => getAdminProducts());
  const [catalogIngredients, setCatalogIngredients] = useState(() =>
    getAdminIngredients()
  );
  const saleCreationLocks = useRef(new Set<string>());
  const [showFinalized, setShowFinalized] = useState(false);

  const loadData = useCallback(async () => {
    try {
      await bridgeFetch("/api/bridge/pending", { cache: "no-store" });

      const [ordersResponse, aliasesResponse] = await Promise.all([
        bridgeFetch("/api/bridge/orders", { cache: "no-store" }),
        bridgeFetch("/api/bridge/aliases", { cache: "no-store" }),
      ]);

      const ordersPayload = (await ordersResponse.json()) as {
        success?: boolean;
        orders?: AgentOrder[];
        error?: string;
      };
      const aliasesPayload = (await aliasesResponse.json()) as {
        success?: boolean;
        aliases?: BridgeAlias[];
        error?: string;
      };

      if (!ordersResponse.ok || !ordersPayload.success) {
        throw new Error(ordersPayload.error || "No se pudieron cargar pedidos.");
      }
      if (!aliasesResponse.ok || !aliasesPayload.success) {
        throw new Error(
          aliasesPayload.error || "No se pudieron cargar equivalencias."
        );
      }

      setOrders(Array.isArray(ordersPayload.orders) ? ordersPayload.orders : []);
      setAliases(
        Array.isArray(aliasesPayload.aliases) ? aliasesPayload.aliases : []
      );
      setConnectionError("");
      setLastSync(new Date());
    } catch (error) {
      setConnectionError(
        error instanceof Error ? error.message : "No se pudo sincronizar."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    const timer = window.setInterval(() => void loadData(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadData]);

  useEffect(() => {
    const refreshCatalogs = () => {
      setCatalogProducts(getAdminProducts());
      setCatalogIngredients(getAdminIngredients());
    };

    window.addEventListener("storage", refreshCatalogs);
    window.addEventListener("focus", refreshCatalogs);

    return () => {
      window.removeEventListener("storage", refreshCatalogs);
      window.removeEventListener("focus", refreshCatalogs);
    };
  }, []);

  const activeOrders = useMemo(
    () => orders.filter((order) => order.status !== "Finalizado"),
    [orders]
  );

  const finalizedOrders = useMemo(
    () => orders.filter((order) => order.status === "Finalizado"),
    [orders]
  );

  const interpretationInputSignature = useMemo(
    () =>
      JSON.stringify({
        orders: activeOrders.map((order) => ({
          platform: normalize(order.platform),
          orderId: String(order.orderId || ""),
          rawText: order.rawText || "",
        })),
        aliases: aliases.map((alias) => ({
          id: alias.id,
          externalName: alias.externalName,
          normalizedExternalName: alias.normalizedExternalName,
          platform: alias.platform || null,
          actionType: alias.actionType,
          targets: alias.targets,
        })),
        products: catalogProducts.map((product) => ({
          id: product.id,
          name: product.name,
        })),
        ingredients: catalogIngredients.map((ingredient) => ({
          id: ingredient.id,
          name: ingredient.name,
          unit: ingredient.unit,
        })),
      }),
    [activeOrders, aliases, catalogProducts, catalogIngredients]
  );

  useEffect(() => {
    if (!interpretationInputSignature || activeOrders.length === 0) return;

    let cancelled = false;

    const runInterpretation = async () => {
      let updatedAnyOrder = false;

      for (const order of activeOrders) {
        if (cancelled || !order.platform || !order.orderId) break;

        try {
          const response = await bridgeFetch("/api/bridge/interpret", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              platform: order.platform,
              rawText: order.rawText || "",
              aliases,
              products: catalogProducts,
              ingredients: catalogIngredients,
            }),
          });

          const payload = (await response.json()) as {
            success?: boolean;
            interpretation?: OrderInterpretation;
            error?: string;
          };

          if (!response.ok || !payload.success || !payload.interpretation) {
            throw new Error(payload.error || "No se pudo interpretar el pedido.");
          }

          const currentCore = order.interpretation
            ? JSON.stringify({
                ...order.interpretation,
                interpretedAt: undefined,
              })
            : "";
          const nextCore = JSON.stringify({
            ...payload.interpretation,
            interpretedAt: undefined,
          });

          if (currentCore === nextCore) continue;

          const patchResponse = await bridgeFetch("/api/bridge/orders", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              platform: order.platform,
              orderId: order.orderId,
              interpretation: payload.interpretation,
            }),
          });

          if (!patchResponse.ok) {
            const patchPayload = await patchResponse.json();
            throw new Error(
              patchPayload?.error || "No se pudo guardar la interpretación."
            );
          }

          updatedAnyOrder = true;
        } catch (error) {
          if (!cancelled) {
            console.error("Error del Motor de Interpretación 2.2:", error);
          }
        }
      }

      if (!cancelled && updatedAnyOrder) {
        await loadData();
      }
    };

    void runInterpretation();

    return () => {
      cancelled = true;
    };
  }, [interpretationInputSignature, loadData]);

  const validationInputSignature = useMemo(
    () =>
      JSON.stringify({
        orders: activeOrders.map((order) => ({
          platform: normalize(order.platform),
          orderId: String(order.orderId || ""),
          customer: order.customer || null,
          delivery: order.delivery || null,
          total: order.total || 0,
          interpretation: order.interpretation || null,
        })),
        products: catalogProducts.map((product) => ({
          id: product.id,
          name: product.name,
        })),
        ingredients: catalogIngredients.map((ingredient) => ({
          id: ingredient.id,
          name: ingredient.name,
          unit: ingredient.unit,
        })),
      }),
    [activeOrders, catalogProducts, catalogIngredients]
  );

  useEffect(() => {
    if (!validationInputSignature || activeOrders.length === 0) return;

    let cancelled = false;

    const runValidation = async () => {
      let updatedAnyOrder = false;

      for (const order of activeOrders) {
        if (cancelled || !order.platform || !order.orderId || !order.interpretation) {
          continue;
        }

        try {
          const response = await bridgeFetch("/api/bridge/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              platform: order.platform,
              orderId: order.orderId,
              customer: order.customer,
              delivery: order.delivery,
              total: order.total,
              rawText: order.rawText || "",
              interpretation: order.interpretation,
              products: catalogProducts,
              ingredients: catalogIngredients,
            }),
          });

          const payload = (await response.json()) as {
            success?: boolean;
            validation?: FinalOrderValidation;
            saleReadyPayload?: SaleReadyPayload | null;
            error?: string;
          };

          if (!response.ok || !payload.success || !payload.validation) {
            throw new Error(payload.error || "No se pudo validar el pedido.");
          }

          const currentCore = JSON.stringify({
            validation: order.validation
              ? { ...order.validation, checkedAt: undefined }
              : null,
            saleReadyPayload: order.saleReadyPayload
              ? { ...order.saleReadyPayload, preparedAt: undefined }
              : null,
          });
          const nextCore = JSON.stringify({
            validation: { ...payload.validation, checkedAt: undefined },
            saleReadyPayload: payload.saleReadyPayload
              ? { ...payload.saleReadyPayload, preparedAt: undefined }
              : null,
          });

          if (currentCore === nextCore) continue;

          const patchResponse = await bridgeFetch("/api/bridge/orders", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              platform: order.platform,
              orderId: order.orderId,
              validation: payload.validation,
              saleReadyPayload: payload.saleReadyPayload ?? null,
            }),
          });

          if (!patchResponse.ok) {
            const patchPayload = await patchResponse.json();
            throw new Error(
              patchPayload?.error || "No se pudo guardar la validación."
            );
          }

          updatedAnyOrder = true;
        } catch (error) {
          if (!cancelled) {
            console.error("Error de validación 2.4/2.5:", error);
          }
        }
      }

      if (!cancelled && updatedAnyOrder) {
        await loadData();
      }
    };

    void runValidation();

    return () => {
      cancelled = true;
    };
  }, [validationInputSignature, loadData]);

  const automaticSaleSignature = useMemo(
    () =>
      JSON.stringify(
        activeOrders.map((order) => ({
          platform: normalize(order.platform),
          orderId: String(order.orderId || ""),
          status: order.status || "",
          readyForSale: Boolean(order.readyForSale),
          createdOrderId: order.createdOrderId || null,
          externalOrderKey: order.saleReadyPayload?.externalOrderKey || null,
        }))
      ),
    [activeOrders]
  );

  useEffect(() => {
    if (!automaticSaleSignature || activeOrders.length === 0) return;

    let cancelled = false;

    const createReadySales = async () => {
      let changed = false;

      for (const order of activeOrders) {
        if (
          cancelled ||
          !order.platform ||
          !order.orderId ||
          !order.readyForSale ||
          !order.saleReadyPayload ||
          order.createdOrderId ||
          order.status === "Venta creada" ||
          order.status === "Finalizado"
        ) {
          continue;
        }

        const externalKey = order.saleReadyPayload.externalOrderKey;
        if (saleCreationLocks.current.has(externalKey)) continue;

        saleCreationLocks.current.add(externalKey);

        try {
          const result = createAutomaticSale(order.saleReadyPayload, {
            receivedAt: order.bridgeReceivedAt || order.receivedAt,
          });

          if (!result.success) {
            console.error(
              `No se pudo crear la venta automática ${externalKey}:`,
              result.error
            );
            continue;
          }

          const patchResponse = await bridgeFetch("/api/bridge/orders", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              platform: order.platform,
              orderId: order.orderId,
              status: "Finalizado",
              createdOrderId: result.orderId,
            }),
          });

          if (!patchResponse.ok) {
            const patchPayload = await patchResponse.json();
            throw new Error(
              patchPayload?.error || "No se pudo confirmar la venta creada."
            );
          }

          changed = true;
        } catch (error) {
          console.error("Error del Bloque 3 - Venta automática:", error);
        } finally {
          saleCreationLocks.current.delete(externalKey);
        }
      }

      if (!cancelled && changed) {
        await loadData();
      }
    };

    void createReadySales();

    return () => {
      cancelled = true;
    };
  }, [automaticSaleSignature, activeOrders, loadData]);

  // Tickets propios de Burger Planet. El Bridge solo lee el ticket de la
  // plataforma: en cuanto un pedido está interpretado (aunque falten
  // equivalencias, esas van a Cocina) cada estación recibe un ticket con solo
  // lo suyo y Caja el de la bolsa con precios. El original queda guardado.
  const stationPrintLocks = useRef(new Set<string>());

  useEffect(() => {
    // El Agent guarda la asignación estación → impresora para su respaldo
    try {
      const saved = JSON.parse(localStorage.getItem("bpos_station_printers") || "null");
      if (saved) void syncStationPrinters(toStationPrintersConfig(saved)).catch(() => {});
    } catch {
      // sin configuración guardada
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const printTickets = async () => {
      let changed = false;
      for (const order of orders) {
        if (cancelled) break;
        if (!order.platform || !order.orderId || order.stationPrint || !order.interpretation) continue;
        const received = Date.parse(order.bridgeReceivedAt || order.receivedAt || "");
        if (Number.isFinite(received) && Date.now() - received > STATION_PRINT_MAX_AGE_MS) continue;

        const key = `${normalize(order.platform)}:${order.orderId}`;
        if (stationPrintLocks.current.has(key)) continue;
        stationPrintLocks.current.add(key);

        try {
          const { tickets } = await buildOrderTickets(
            order,
            { products: catalogProducts, recipes: getAdminRecipes() },
            getBusinessSettings()
          );
          const result = await printDeliveryTickets({ platform: order.platform, orderId: order.orderId, tickets });
          const printers = (result.results || []).filter((r) => r.ok && r.printer).map((r) => r.printer as string);
          await bridgeFetch("/api/bridge/orders", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              platform: order.platform,
              orderId: order.orderId,
              stationPrint: { at: new Date().toISOString(), stations: tickets.map((t) => t.target), printers },
            }),
          });
          changed = true;
        } catch (error) {
          // Sin Agent en este dispositivo (ej. un celular) o sin PDF: el Agent imprime en Cocina por su cuenta
          console.error(`No se pudo mandar ${key} a las estaciones:`, error);
          stationPrintLocks.current.delete(key);
        }
      }
      if (!cancelled && changed) await loadData();
    };

    void printTickets();
    return () => {
      cancelled = true;
    };
  }, [orders, catalogProducts, loadData]);

  /** Reimpresión a mano: los tickets propios otra vez, o el ticket original de la plataforma. */
  async function reprintOrder(order: AgentOrder, kind: "tickets" | "original") {
    if (!order.platform || !order.orderId) return;
    try {
      if (kind === "original") {
        const stations = stationsForOrder(order.interpretation, catalogProducts, getAdminRecipes());
        await printOriginalTicket({ platform: order.platform, orderId: order.orderId, stations, force: true });
        return;
      }
      const { tickets } = await buildOrderTickets(
        order,
        { products: catalogProducts, recipes: getAdminRecipes() },
        getBusinessSettings()
      );
      const result = await printDeliveryTickets({ platform: order.platform, orderId: order.orderId, tickets, force: true });
      const failed = (result.results || []).filter((r) => !r.ok);
      if (failed.length) alert(`No salió en: ${failed.map((f) => `${f.target} (${f.error})`).join(", ")}`);
    } catch (error) {
      alert(error instanceof Error ? error.message : "No se pudo reimprimir. Revisa que B-POS esté abierto en esta computadora.");
    }
  }

  const pendingCount = useMemo(
    () =>
      activeOrders.reduce((count, order) => {
        const platform = normalize(order.platform);
        return (
          count +
          extractQuantifiedItems(order.rawText || "").filter(
            (item) => !findAlias(aliases, item.externalName, platform)
          ).length
        );
      }, 0),
    [activeOrders, aliases]
  );

  function configureItem(externalName: string, platform: string) {
    setSelection({ externalName, platform, token: Date.now() });
    window.setTimeout(() => {
      document
        .getElementById("bridge-aliases")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  // Desde la ventana de aviso (/bridge?equivaler=...&plataforma=...): abre el formulario con ese producto
  const openedFromPrompt = useRef(false);
  useEffect(() => {
    if (openedFromPrompt.current || loading) return;
    const params = new URLSearchParams(window.location.search);
    const externalName = params.get("equivaler");
    if (!externalName) return;
    openedFromPrompt.current = true;
    window.history.replaceState(null, "", "/bridge");
    window.setTimeout(() => configureItem(externalName, params.get("plataforma") || ""), 0);
  }, [loading]);

  return (
    <AppShell
      title="B-POS Bridge"
      subtitle="Los pedidos avanzan a Interpretado automáticamente cuando todas sus líneas cuantificadas tienen equivalencia."
    >
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.7fr)]">
        <aside className="min-w-0 space-y-6">
          <section
            className={`rounded-3xl border p-6 ${
              pendingCount > 0
                ? "border-emerald-400/70 bg-emerald-500/10"
                : "border-zinc-800 bg-zinc-950"
            }`}
          >
            <p
              className={`text-sm font-bold ${
                connectionError ? "text-red-400" : "text-emerald-400"
              }`}
            >
              {connectionError ? "Bridge sin conexión" : "Bridge conectado"}
            </p>
            <h2 className="mt-1 text-2xl font-black text-white">
              {pendingCount > 0
                ? `${pendingCount} equivalencia(s) pendiente(s)`
                : "Todos los artículos están enlazados"}
            </h2>
            <p className="mt-2 text-sm text-zinc-400">
              {connectionError ||
                "El estado cambia de Recibido a Interpretado sin pulsar botones."}
            </p>
            {lastSync && !connectionError && (
              <p className="mt-3 text-xs text-zinc-500">
                Última actualización: {lastSync.toLocaleTimeString()}
              </p>
            )}
          </section>

          <div id="bridge-aliases" className="scroll-mt-6">
            <BridgeAliases
              selectedExternalName={selection?.externalName}
              selectedPlatform={selection?.platform}
              selectionToken={selection?.token}
              onSaved={() => void loadData()}
            />
          </div>
        </aside>

        <main className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black text-white">Pedidos recibidos</h2>
              <p className="mt-1 text-sm text-zinc-400">
                El Bridge muestra solo líneas con cantidad seguida de x.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowFinalized((value) => !value)}
                className="rounded-2xl border border-zinc-700 bg-zinc-900 px-5 py-3 font-black text-white"
              >
                {showFinalized ? "Ocultar finalizados" : `Finalizados (${finalizedOrders.length})`}
              </button>
              <button
                type="button"
                onClick={() => void loadData()}
                className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-black"
              >
                Actualizar ahora
              </button>
            </div>
          </div>

          {loading ? (
            <div className="rounded-3xl border border-dashed border-zinc-800 p-10 text-center text-zinc-500">
              Cargando pedidos...
            </div>
          ) : activeOrders.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-zinc-800 p-10 text-center text-zinc-500">
              Todavía no hay pedidos activos.
            </div>
          ) : (
            activeOrders.map((order) => {
              const platformKey = normalize(order.platform);
              const items = extractQuantifiedItems(order.rawText || "");
              const resolved = items.map((item) => ({
                ...item,
                alias: findAlias(aliases, item.externalName, platformKey),
              }));
              const unresolved = resolved.filter((item) => !item.alias);
              const saleCreated = Boolean(
                order.status === "Venta creada" && order.createdOrderId
              );
              const interpreted = Boolean(
                order.interpretation?.resolved &&
                  (order.status === "Interpretado" || saleCreated)
              );
              const interpretationPending =
                order.interpretation?.pendingCount ?? unresolved.length;
              const interpretationErrors =
                order.interpretation?.errorCount ?? 0;
              const readyForSale = Boolean(
                order.validation?.readyForSale && order.saleReadyPayload
              );
              const validationIssues = order.validation?.issues ?? [];

              return (
                <article
                  key={`${platformKey}-${order.orderId}-${order.id}`}
                  className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h3 className="text-2xl font-black text-white">
                        {order.createdOrderId
                          ? `Pedido #${String(order.createdOrderId).padStart(6, "0")}`
                          : "Pedido pendiente de folio local"}
                      </h3>
                      <p className="mt-1 text-sm font-black text-orange-400">
                        Plataforma: {platformLabel(order.platform)} · #{String(order.orderId || "SIN-ID")}
                      </p>
                      <p className="mt-1 text-sm text-zinc-400">
                        {order.customer?.name || "Cliente sin nombre"}
                      </p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {order.stationPrint && (
                          <span className="text-xs text-zinc-500">
                            🖨️ Impreso: {order.stationPrint.stations.join(", ")}
                          </span>
                        )}
                        <button
                          onClick={() => void reprintOrder(order, "tickets")}
                          className="rounded-xl border border-zinc-700 px-3 py-1 text-xs font-black text-zinc-300 hover:border-orange-500"
                        >
                          Reimprimir tickets
                        </button>
                        <button
                          onClick={() => void reprintOrder(order, "original")}
                          className="rounded-xl border border-zinc-700 px-3 py-1 text-xs font-black text-zinc-300 hover:border-orange-500"
                        >
                          Imprimir original
                        </button>
                      </div>
                    </div>

                    <span
                      className={`rounded-full border px-4 py-2 text-xs font-black uppercase ${
                        saleCreated
                          ? "border-violet-500/50 bg-violet-500/15 text-violet-300"
                          : interpreted
                            ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                            : "border-orange-500/50 bg-orange-500/15 text-orange-300"
                      }`}
                    >
                      {saleCreated
                        ? `Venta #${order.createdOrderId}`
                        : order.status || (interpreted ? "Interpretado" : "Recibido")}
                    </span>
                  </div>

                  <section className="mt-6">
                    <h4 className="font-black text-orange-500">
                      Productos interpretados
                    </h4>

                    <div className="mt-3 space-y-3">
                      {resolved.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-zinc-800 p-5 text-sm text-zinc-500">
                          No se encontraron líneas con formato cantidad + x.
                        </div>
                      ) : (
                        resolved.map((item) => (
                          <div
                            key={item.id}
                            className="rounded-2xl border border-zinc-800 bg-black p-4"
                          >
                            <div className="flex items-start gap-3">
                              <span className="rounded-xl bg-orange-500 px-3 py-2 font-black text-black">
                                {item.qty}x
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="break-words font-black text-white">
                                  {item.externalName}
                                </p>

                                {item.alias ? (
                                  <div className="mt-2 rounded-xl border border-emerald-900 bg-emerald-950/35 p-3">
                                    <p className="text-xs font-black uppercase text-emerald-400">
                                      Equivalencia aplicada · {ACTION_LABELS[item.alias.actionType]}
                                    </p>
                                    {item.alias.actionType === "ignore" ? (
                                      <p className="mt-1 text-sm text-zinc-400">
                                        Sin acción
                                      </p>
                                    ) : (
                                      item.alias.targets.map((target) => (
                                        <p
                                          key={`${item.alias?.id}-${target.id}`}
                                          className="mt-1 text-sm text-zinc-300"
                                        >
                                          → {target.name}
                                          {target.quantity !== undefined
                                            ? ` · ${target.quantity}${
                                                target.unit ? ` ${target.unit}` : ""
                                              }`
                                            : ""}
                                        </p>
                                      ))
                                    )}
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      configureItem(item.externalName, platformKey)
                                    }
                                    className="mt-2 rounded-xl border border-red-500/50 bg-red-500/10 px-3 py-2 text-left text-sm font-black text-red-300 transition hover:bg-red-500 hover:text-white"
                                  >
                                    Sin equivalencia · Configurar ahora
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>

                  {order.interpretation && (
                    <section className="mt-5 rounded-2xl border border-sky-900 bg-sky-950/25 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h4 className="font-black text-sky-300">
                          Motor de Interpretación 2.2
                        </h4>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-black uppercase ${
                            order.interpretation.resolved
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-orange-500/15 text-orange-300"
                          }`}
                        >
                          {order.interpretation.resolved
                            ? "Resuelto"
                            : "Con pendientes"}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-300 sm:grid-cols-5">
                        <span>Productos: {order.interpretation.products.length}</span>
                        <span>Ingredientes: {order.interpretation.ingredients.length}</span>
                        <span>Grupos: {order.interpretation.bundles.length}</span>
                        <span>Ignorados: {order.interpretation.ignored.length}</span>
                        <span>Pendientes: {order.interpretation.pendingCount}</span>
                      </div>
                    </section>
                  )}

                  {order.validation && (
                    <section
                      className={`mt-5 rounded-2xl border p-4 ${
                        order.validation.readyForSale
                          ? "border-emerald-900 bg-emerald-950/35"
                          : "border-red-900 bg-red-950/25"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h4
                          className={`font-black ${
                            order.validation.readyForSale
                              ? "text-emerald-300"
                              : "text-red-300"
                          }`}
                        >
                          Validación final 2.4
                        </h4>
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-black uppercase ${
                            order.validation.readyForSale
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-red-500/15 text-red-300"
                          }`}
                        >
                          {order.validation.readyForSale
                            ? "Validado"
                            : `${order.validation.issueCount} problema(s)`}
                        </span>
                      </div>

                      {validationIssues.length > 0 && (
                        <ul className="mt-3 space-y-2 text-sm text-red-200">
                          {validationIssues.map((issue, index) => (
                            <li key={`${issue.code}-${index}`}>
                              • {issue.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  )}

                  {order.saleReadyPayload && (
                    <section className="mt-5 rounded-2xl border border-violet-900 bg-violet-950/25 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h4 className="font-black text-violet-300">
                          Objeto listo para venta 2.5
                        </h4>
                        <span className="rounded-full bg-violet-500/15 px-3 py-1 text-xs font-black uppercase text-violet-300">
                          Preparado
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-zinc-300 sm:grid-cols-3">
                        <span>Productos: {order.saleReadyPayload.products.length}</span>
                        <span>Movimientos: {order.saleReadyPayload.inventoryAdjustments.length}</span>
                        <span>Ignorados: {order.saleReadyPayload.ignoredLines.length}</span>
                      </div>
                      <p className="mt-3 break-all text-xs text-zinc-500">
                        Clave externa: {order.saleReadyPayload.externalOrderKey}
                      </p>
                    </section>
                  )}

                  <section className="mt-5 rounded-2xl border border-zinc-800 bg-black p-4">
                    <h4 className="font-black text-zinc-200">Ticket original</h4>
                    <pre className="mt-3 max-h-[360px] overflow-auto whitespace-pre-wrap break-words text-xs leading-6 text-zinc-400">
                      {order.rawText || "Sin texto original"}
                    </pre>
                  </section>

                  <div
                    className={`mt-5 rounded-2xl border p-4 text-sm font-bold ${
                      interpreted
                        ? "border-emerald-900 bg-emerald-950/35 text-emerald-300"
                        : "border-orange-900 bg-orange-950/30 text-orange-300"
                    }`}
                  >
                    {saleCreated
                      ? `Venta automática #${order.createdOrderId} creada correctamente. El inventario todavía no se descuenta hasta el Bloque 4.`
                      : readyForSale
                        ? "Pedido validado y preparado. El Bloque 3 creará la venta automáticamente cuando la caja esté abierta."
                      : interpreted
                        ? "El pedido está interpretado, pero todavía no supera la validación final 2.4."
                        : interpretationErrors > 0
                          ? `La interpretación tiene ${interpretationErrors} error(es) de catálogo o configuración. El pedido permanece en Recibido.`
                          : `Faltan ${interpretationPending} equivalencia(s). El pedido permanecerá en Recibido.`}
                  </div>
                </article>
              );
            })
          )}

          {showFinalized && (
            <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
              <h2 className="text-xl font-black text-emerald-400">Pedidos finalizados</h2>
              <p className="mt-1 text-sm text-zinc-400">
                Ya generaron venta y no forman parte de la cola activa.
              </p>
              <div className="mt-4 space-y-3">
                {finalizedOrders.length === 0 ? (
                  <p className="text-sm text-zinc-500">Todavía no hay pedidos finalizados.</p>
                ) : (
                  finalizedOrders.map((order) => (
                    <div
                      key={`final-${normalize(order.platform)}-${order.orderId}-${order.id}`}
                      className="rounded-2xl border border-emerald-900/70 bg-emerald-950/20 p-4"
                    >
                      <p className="font-black text-white">
                        Pedido #{String(order.createdOrderId || 0).padStart(6, "0")}
                      </p>
                      <p className="mt-1 text-sm font-bold text-orange-300">
                        Plataforma: {platformLabel(order.platform)} · #{String(order.orderId || "SIN-ID")}
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {order.customer?.name || "Cliente de plataforma"} · Venta creada
                      </p>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}
        </main>
      </div>
    </AppShell>
  );
}
