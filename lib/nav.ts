/**
 * Menú lateral de B-POS. Algunas secciones agrupan varias pantallas que se
 * ven como subpestañas arriba de la página (ej. Historial de pedidos →
 * Pedidos · Impresiones). Cada pantalla conserva su dirección y su permiso:
 * el grupo se ve si el usuario puede abrir al menos una, y lleva a la
 * primera que puede abrir.
 */
import { hasPermission, permissionForPath } from "@/lib/permissions";
import type { CurrentUser } from "@/lib/auth";

export type NavTab = { label: string; href: string; icon: string };
export type NavGroup = { label: string; icon: string; tabs: NavTab[] };

export const NAV: NavGroup[] = [
  { label: "Dashboard", icon: "📊", tabs: [{ label: "Dashboard", href: "/dashboard", icon: "📊" }] },
  { label: "POS", icon: "🛒", tabs: [{ label: "POS", href: "/pos", icon: "🛒" }] },
  {
    label: "Historial de pedidos",
    icon: "📋",
    tabs: [
      { label: "Pedidos", href: "/historial", icon: "📋" },
      { label: "Impresiones", href: "/impresiones", icon: "🖨️" },
    ],
  },
  {
    label: "Pedidos en línea",
    icon: "🌐",
    tabs: [
      { label: "Menú digital", href: "/pedidos-en-linea", icon: "🌐" },
      { label: "Uber, DiDi y Rappi (Bridge)", href: "/bridge", icon: "🌉" },
    ],
  },
  { label: "Centro de Operaciones", icon: "🚨", tabs: [{ label: "Centro de Operaciones", href: "/centro-operaciones", icon: "🚨" }] },
  {
    label: "Caja",
    icon: "💵",
    tabs: [
      { label: "Caja", href: "/caja", icon: "💵" },
      { label: "Historial de cortes", href: "/caja/historial", icon: "🧾" },
    ],
  },
  { label: "Cocina KDS", icon: "👨‍🍳", tabs: [{ label: "Cocina KDS", href: "/cocina", icon: "👨‍🍳" }] },
  {
    label: "Tu negocio",
    icon: "🏪",
    tabs: [
      { label: "Inventario", href: "/inventario", icon: "📦" },
      { label: "Compras", href: "/compras", icon: "🛍️" },
      { label: "Ingredientes", href: "/configuracion/ingredientes", icon: "🧂" },
      { label: "Packaging", href: "/configuracion/packaging", icon: "🥡" },
      { label: "Productos", href: "/configuracion/productos", icon: "🍔" },
      { label: "Food cost", href: "/configuracion/food-cost", icon: "💲" },
    ],
  },
  {
    label: "Clientes y opiniones",
    icon: "👥",
    tabs: [
      { label: "Clientes", href: "/clientes", icon: "👥" },
      { label: "Opiniones", href: "/opiniones", icon: "⭐" },
    ],
  },
  {
    label: "Finanzas y reportes",
    icon: "💰",
    tabs: [
      { label: "Finanzas", href: "/finanzas", icon: "💰" },
      { label: "Reportes", href: "/reportes", icon: "📈" },
    ],
  },
  { label: "App del dueño", icon: "📱", tabs: [{ label: "App del dueño", href: "/dueno", icon: "📱" }] },
  { label: "Configuración", icon: "⚙️", tabs: [{ label: "Configuración", href: "/configuracion", icon: "⚙️" }] },
  { label: "Ayuda", icon: "❓", tabs: [{ label: "Ayuda", href: "/ayuda", icon: "❓" }] },
];

const canOpen = (user: CurrentUser | null, href: string) => {
  const permission = permissionForPath(href);
  return !permission || hasPermission(user, permission);
};

/** Grupos que el usuario puede ver, solo con las pestañas que puede abrir */
export function visibleNav(user: CurrentUser | null): NavGroup[] {
  return NAV.map((g) => ({ ...g, tabs: g.tabs.filter((t) => canOpen(user, t.href)) })).filter((g) => g.tabs.length > 0);
}

const matches = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** Pestaña de esta pantalla: la de dirección más larga que coincida ("/caja/historial" antes que "/caja") */
export function currentTab(pathname: string, groups: NavGroup[] = NAV): { group: NavGroup; tab: NavTab } | null {
  let best: { group: NavGroup; tab: NavTab } | null = null;
  for (const group of groups)
    for (const tab of group.tabs) if (matches(pathname, tab.href) && (!best || tab.href.length > best.tab.href.length)) best = { group, tab };
  return best;
}
