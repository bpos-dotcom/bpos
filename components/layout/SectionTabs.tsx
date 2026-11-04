"use client";
/**
 * Subpestañas de una sección que junta varias pantallas (ej. Historial de
 * pedidos → Pedidos · Impresiones). Solo salen las que el usuario puede
 * abrir; con una sola no se muestra nada.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { getSessionUser } from "@/lib/auth";
import { currentTab, visibleNav } from "@/lib/nav";

export function SectionTabs() {
  const pathname = usePathname() || "";
  const here = useMemo(() => currentTab(pathname, visibleNav(getSessionUser())), [pathname]);
  if (!here || here.group.tabs.length < 2) return null;
  return (
    <nav aria-label={here.group.label} className="bpos-scroll mb-4 flex gap-2 overflow-x-auto border-b border-zinc-800 pb-3 sm:mb-6">
      {here.group.tabs.map((tab) => {
        const on = tab.href === here.tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={on ? "page" : undefined}
            className={`shrink-0 rounded-2xl border px-4 py-2 text-sm font-black ${on ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:border-orange-500 hover:text-orange-400"}`}
          >
            <span className="mr-1.5">{tab.icon}</span>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
