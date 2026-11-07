"use client";
/**
 * Subpestañas de una sección que junta varias pantallas (ej. Historial de
 * pedidos → Pedidos · Impresiones). Solo salen las que el usuario puede
 * abrir; con una sola no se muestra nada. Las pestañas con el mismo `sub`
 * (ej. Tu negocio → Inventario · Packaging · Compras · Ingredientes) salen
 * arriba como una sola y, al entrar, abajo como una segunda fila.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { getSessionUser } from "@/lib/auth";
import { currentTab, visibleNav, type NavTab } from "@/lib/nav";
import { planIncludes } from "@/lib/plans";
import { usePlanState } from "@/components/cloud/PlanGate";
import { openServices } from "@/lib/services";
import { useServicesState } from "@/lib/services-client";

/** "Estudio Fotográfico [AI🟢]" con IA en el plan, "[AI🔴]" sin ella */
export function aiTabLabel(label: string, hasAi: boolean) {
  return `${label} [AI${hasAi ? "🟢" : "🔴"}]`;
}

/** Primera fila: cada `sub` cuenta como una pestaña (la primera que puede abrir, con el nombre del sub) */
function topTabs(tabs: NavTab[]) {
  const seen = new Set<string>();
  return tabs.flatMap((t) => {
    if (!t.sub) return [t];
    if (seen.has(t.sub)) return [];
    seen.add(t.sub);
    return [{ ...t, label: t.sub }];
  });
}

const tabClass = (on: boolean, small = false) =>
  `shrink-0 rounded-2xl border font-black ${small ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"} ${on ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-orange-500 hover:text-orange-400"}`;

export function SectionTabs() {
  const pathname = usePathname() || "";
  const services = useServicesState();
  const serviceIds = services?.kind === "servicios" ? openServices(services.services).join(",") : null;
  const here = useMemo(() => currentTab(pathname, visibleNav(getSessionUser(), serviceIds === null ? null : (serviceIds.split(",").filter(Boolean) as Parameters<typeof visibleNav>[1]))), [pathname, serviceIds]);
  const plan = usePlanState();
  if (!here || here.group.tabs.length < 2) return null;
  const top = topTabs(here.group.tabs);
  const subTabs = here.tab.sub ? here.group.tabs.filter((t) => t.sub === here.tab.sub) : [];
  const label = (tab: NavTab) => (tab.aiBadge ? aiTabLabel(tab.label, planIncludes(plan, "ai")) : tab.label);
  return (
    <div className="mb-4 border-b border-zinc-800 pb-3 sm:mb-6">
      {top.length > 1 && (
        <nav aria-label={here.group.label} className="bpos-scroll flex gap-2 overflow-x-auto">
          {top.map((tab) => {
            const on = tab.sub ? tab.sub === here.tab.sub : tab.href === here.tab.href;
            return (
              <Link key={tab.href} href={tab.href} aria-current={on ? "page" : undefined} className={tabClass(on)}>
                <span className="mr-1.5">{tab.icon}</span>
                {label(tab)}
              </Link>
            );
          })}
        </nav>
      )}
      {subTabs.length > 1 && (
        <nav aria-label={here.tab.sub} className="bpos-scroll mt-2 flex gap-2 overflow-x-auto pl-2">
          {subTabs.map((tab) => (
            <Link key={tab.href} href={tab.href} aria-current={tab.href === here.tab.href ? "page" : undefined} className={tabClass(tab.href === here.tab.href, true)}>
              <span className="mr-1">{tab.icon}</span>
              {label(tab)}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}
