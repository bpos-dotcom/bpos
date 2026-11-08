"use client";
/**
 * Corre el procesador del Bridge (lib/bridge/processor.ts) en segundo plano:
 * en el equipo principal estando en cualquier pantalla de B-POS, y en la
 * página del Bridge en cualquier equipo (respaldo si la caja está apagada).
 * Nunca en la pantalla de cocina. Cada 2 s revisa la huella del Bridge y
 * solo baja los pedidos en proceso cuando algo cambió.
 */
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { usePlanState } from "@/components/cloud/PlanGate";
import { getAdminIngredients, getAdminProducts } from "@/lib/admin";
import { bridgeFetch, bridgeVersion } from "@/lib/bridge/bridge-fetch";
import { processBridgeOrders, type ProcessorOrder } from "@/lib/bridge/processor";
import { isPrimaryDevice } from "@/lib/cloud/sync";
import { planIncludes } from "@/lib/plans";

const TICK_MS = 2000;
/** Sin huella (falló la consulta), o con pedidos en proceso (reintentos de impresión): una vuelta completa cada tanto */
const FALLBACK_MS = 30_000;
const RETRY_MS = 60_000;

/** ¿Debe procesar este equipo en esta pantalla? */
export function bridgeProcessorActive(pathname: string) {
  if (pathname === "/cocina" || pathname.startsWith("/cocina/")) return false;
  return pathname === "/bridge" || isPrimaryDevice();
}

export function BridgeProcessor() {
  const pathname = usePathname() || "";
  const plan = usePlanState();
  const allowed = planIncludes(plan, "delivery");

  useEffect(() => {
    if (!allowed || !bridgeProcessorActive(pathname)) return;
    let stopped = false;
    let running = false;
    let version = "";
    let aliases: unknown[] = [];
    let aliasPart: string | null = null;
    let lastPass = 0;
    let hadWork = false;
    let catalogSig = "";

    const tick = async () => {
      if (running || stopped) return;
      running = true;
      try {
        const next = await bridgeVersion();
        const products = getAdminProducts();
        const ingredients = getAdminIngredients();
        const sig = `${products.length}:${products.map((p) => p.name).join("|").length}:${ingredients.length}`;
        const since = Date.now() - lastPass;
        const due = (next && next !== version) || (!next && since > FALLBACK_MS) || (hadWork && since > RETRY_MS) || sig !== catalogSig;
        if (!due) return;

        // La huella de la nube es "pedidos|equivalencias"; sin esa forma (sin huella, o pruebas sin nube) se vuelven a bajar
        const nextAliasPart = next.includes("|") ? next.split("|")[1] : null;
        if (aliasPart === null || nextAliasPart === null || nextAliasPart !== aliasPart) {
          const response = await bridgeFetch("/api/bridge/aliases", { cache: "no-store" });
          const payload = (await response.json().catch(() => ({}))) as { success?: boolean; aliases?: unknown[] };
          if (!response.ok || !payload.success) return;
          aliases = Array.isArray(payload.aliases) ? payload.aliases : [];
          aliasPart = nextAliasPart ?? "";
        }
        const response = await bridgeFetch("/api/bridge/orders?trabajo=1", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as { success?: boolean; orders?: ProcessorOrder[] };
        if (!response.ok || !payload.success) return;
        const orders = Array.isArray(payload.orders) ? payload.orders : [];
        version = next;
        catalogSig = sig;
        lastPass = Date.now();
        hadWork = orders.length > 0;
        if (!stopped && orders.length) await processBridgeOrders(orders, aliases, `${aliasPart}:${aliases.length}:${JSON.stringify(aliases).length}`);
      } catch (error) {
        console.error("Bridge en segundo plano:", error);
      } finally {
        running = false;
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), TICK_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [allowed, pathname]);

  return null;
}
