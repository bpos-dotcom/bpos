/**
 * Menú lateral de B-POS. Algunas secciones agrupan varias pantallas que se
 * ven como subpestañas arriba de la página (ej. Historial de pedidos →
 * Pedidos · Impresiones). Cada pantalla conserva su dirección y su permiso:
 * el grupo se ve si el usuario puede abrir al menos una, y lleva a la
 * primera que puede abrir.
 */
import { hasPermission, permissionForPath } from "@/lib/permissions";
import type { CurrentUser } from "@/lib/auth";
import type { ServiceId } from "@/lib/services";

/**
 * aiBadge: la pestaña agrega [AI🟢] si el plan incluye IA (Max o prueba) o [AI🔴] si no.
 * sub: las pestañas con el mismo sub se ven arriba como una sola (con el nombre
 * del sub) y, al entrar, abajo sale una segunda fila con todas ellas.
 */
export type NavTab = { label: string; href: string; icon: string; aiBadge?: boolean; sub?: string };
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
      { label: "Inventario", href: "/inventario", icon: "📦", sub: "Inventario" },
      { label: "Packaging", href: "/configuracion/packaging", icon: "🥡", sub: "Inventario" },
      { label: "Compras", href: "/compras", icon: "🛍️", sub: "Inventario" },
      { label: "Ingredientes", href: "/configuracion/ingredientes", icon: "🧂", sub: "Inventario" },
      { label: "Productos", href: "/configuracion/productos", icon: "🍔" },
      { label: "Estudio Fotográfico", href: "/configuracion/estudio-ia", icon: "📸", aiBadge: true },
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

/** Menú de una cuenta de solo servicios: el panel y una sección por servicio vigente */
const SERVICE_NAV: Record<ServiceId, NavGroup> = {
  lealtad: {
    label: "Tarjetas de lealtad",
    icon: "💳",
    tabs: [
      { label: "Capturar compra", href: "/servicios/lealtad", icon: "💳" },
      { label: "Configurar club", href: "/configuracion/club", icon: "⚙️" },
      { label: "Clientes", href: "/clientes", icon: "👥" },
    ],
  },
  menu: {
    label: "Menú digital",
    icon: "📱",
    tabs: [
      { label: "Pedidos en línea", href: "/pedidos-en-linea", icon: "🌐" },
      { label: "Diseño del menú", href: "/configuracion/menu-digital", icon: "🎨" },
      { label: "Productos", href: "/configuracion/productos", icon: "🍔" },
      { label: "Importar menú", href: "/servicios/menu/importar", icon: "📥" },
      { label: "Opiniones", href: "/opiniones", icon: "⭐" },
    ],
  },
  kiosco: { label: "Kiosco", icon: "🖥️", tabs: [{ label: "Kiosco", href: "/configuracion/menu-digital", icon: "🖥️" }] },
  asesor: { label: "Asesor con IA", icon: "🤖", tabs: [{ label: "Asesor con IA", href: "/servicios/asesor", icon: "🤖" }] },
  foodcost: { label: "Food cost", icon: "🧮", tabs: [{ label: "Food cost", href: "/servicios/food-cost", icon: "🧮" }] },
  checador: {
    label: "Reloj checador",
    icon: "⏱️",
    tabs: [
      { label: "Checador", href: "/checador", icon: "⏱️" },
      { label: "Asistencia", href: "/configuracion/asistencia", icon: "📅" },
      { label: "Empleados", href: "/configuracion/usuarios", icon: "👤" },
    ],
  },
};

/**
 * Grupos que el usuario puede ver, solo con las pestañas que puede abrir.
 * `services`: la cuenta es de solo servicios y estos son los vigentes.
 */
export function visibleNav(user: CurrentUser | null, services?: ServiceId[] | null): NavGroup[] {
  const groups = services
    ? [
        { label: "Mis servicios", icon: "🧩", tabs: [{ label: "Mis servicios", href: "/servicios", icon: "🧩" }] },
        // El kiosco se configura en el diseño del menú: no lleva sección aparte si ya está el menú
        ...services.filter((id) => !(id === "kiosco" && services.includes("menu"))).map((id) => SERVICE_NAV[id]),
        { label: "Ayuda", icon: "❓", tabs: [{ label: "Ayuda", href: "/ayuda", icon: "❓" }] },
      ]
    : NAV;
  return groups.map((g) => ({ ...g, tabs: g.tabs.filter((t) => canOpen(user, t.href)) })).filter((g) => g.tabs.length > 0);
}

const matches = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** Pestaña de esta pantalla: la de dirección más larga que coincida ("/caja/historial" antes que "/caja") */
export function currentTab(pathname: string, groups: NavGroup[] = NAV): { group: NavGroup; tab: NavTab } | null {
  let best: { group: NavGroup; tab: NavTab } | null = null;
  for (const group of groups)
    for (const tab of group.tabs) if (matches(pathname, tab.href) && (!best || tab.href.length > best.tab.href.length)) best = { group, tab };
  return best;
}
