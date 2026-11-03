/**
 * Cajón de dinero: cuándo se abre solo. Se configura en Configuración →
 * Impresoras → Caja y vive dentro de bpos_station_printers (la misma
 * configuración que lee el Agent; `openDrawer` es el apagador general que
 * el Agent también respeta).
 */
export const DRAWER_ORDER_TYPES = ["Mostrador", "Para llevar", "Mesa", "Domicilio", "WhatsApp", "Didi Food", "Uber Eats"] as const;
export const DRAWER_MIXED = "Mixto";

export type DrawerWhen = "al-abrir" | "al-cobrar";
export type DrawerSettings = {
  /** Apagador general (false: nunca se abre solo; queda el botón Abrir cajón) */
  enabled: boolean;
  /** al-abrir: en cuanto se abre la ventana de cobro · al-cobrar: al confirmar el cobro, antes del ticket */
  when: DrawerWhen;
  /** Formas de pago con las que abre (nombres como en Configuración → Formas de pago, más "Mixto") */
  methods: string[];
  /** Tipos de pedido con los que abre; [] = todos */
  orderTypes: string[];
};

const STORAGE_KEY = "bpos_station_printers";
export const DEFAULT_DRAWER_METHODS = ["Efectivo", DRAWER_MIXED];

type Raw = { openDrawer?: unknown; drawerWhen?: unknown; drawerMethods?: unknown; drawerOrderTypes?: unknown };

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null);

/** Lee la configuración guardada (o la de siempre: efectivo y mixto, al abrir el cobro, todos los pedidos). */
export function drawerSettingsFrom(raw: Raw | null | undefined): DrawerSettings {
  return {
    enabled: raw?.openDrawer !== false,
    when: raw?.drawerWhen === "al-cobrar" ? "al-cobrar" : "al-abrir",
    methods: strings(raw?.drawerMethods) ?? DEFAULT_DRAWER_METHODS,
    orderTypes: strings(raw?.drawerOrderTypes) ?? [],
  };
}

export function getDrawerSettings(): DrawerSettings {
  if (typeof window === "undefined") return drawerSettingsFrom(null);
  try {
    return drawerSettingsFrom(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
  } catch {
    return drawerSettingsFrom(null);
  }
}

/** ¿Este cobro abre el cajón solo? (forma de pago y tipo de pedido permitidos) */
export function drawerShouldOpen(paymentMethod: string, orderType: string | undefined, settings: DrawerSettings = getDrawerSettings()): boolean {
  if (!settings.enabled) return false;
  if (!settings.methods.includes(paymentMethod)) return false;
  if (settings.orderTypes.length > 0 && !settings.orderTypes.includes(orderType || "Mostrador")) return false;
  return true;
}

/**
 * Robo hormiga: el cajón se abrió (al abrir el cobro o con el botón) y la
 * venta no se concretó (cobro cancelado o mandado a cocina sin cobrar). Si
 * se cobró, con la forma que sea, no se avisa: el cajón se abre solo. Queda en la bitácora
 * (nube, no se puede borrar), como alerta en el Centro de operaciones y le
 * llega al dueño por push (preferencia "seguridad").
 */
export async function reportDrawerWithoutCashSale(input: { reason: "cancelado" | "pendiente"; paymentMethod: string; total: number; orderType?: string }) {
  if (typeof window === "undefined") return;
  const [{ addAuditEvent }, { getCurrentUser }, { upsertOperationsAlert }] = await Promise.all([import("@/lib/audit"), import("@/lib/auth"), import("@/lib/notifications/operationsCenter")]);
  const user = getCurrentUser();
  const money = `$${input.total.toFixed(2)}`;
  const why = input.reason === "cancelado" ? `se abrió el cajón y el cobro de ${money} se canceló sin venta` : `se abrió el cajón y el pedido de ${money} se mandó a cocina sin cobrar`;
  const description = `${user.name}: ${why}${input.orderType ? ` (${input.orderType})` : ""}.`;
  const event = addAuditEvent({
    category: "Seguridad",
    action: "drawer.unjustified",
    description,
    userId: user.id > 0 ? String(user.id) : undefined,
    userName: user.name,
    metadata: { reason: input.reason, paymentMethod: input.paymentMethod, total: input.total, orderType: input.orderType },
  });
  upsertOperationsAlert({
    id: `drawer:${event.id}`,
    priority: "warning",
    title: "Cajón abierto sin venta en efectivo",
    message: description,
    source: "Punto de venta",
    moduleHref: "/configuracion/auditoria",
    metadata: event.metadata,
  });
}
