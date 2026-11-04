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
 * cobro se canceló sin venta. Si se cobró (con la forma que sea) o se mandó
 * a cuenta en espera, es normal y no se avisa: el cajón se abre solo. Queda en la bitácora
 * (nube, no se puede borrar), como alerta en el Centro de operaciones y le
 * llega al dueño por push (preferencia "seguridad").
 */
export async function reportDrawerWithoutCashSale(input: { paymentMethod: string; total: number; orderType?: string }): Promise<string | undefined> {
  if (typeof window === "undefined") return;
  const [{ addAuditEvent }, { getCurrentUser }, { upsertOperationsAlert }] = await Promise.all([import("@/lib/audit"), import("@/lib/auth"), import("@/lib/notifications/operationsCenter")]);
  const user = getCurrentUser();
  const money = `$${input.total.toFixed(2)}`;
  const why = `se abrió el cajón y el cobro de ${money} se canceló sin venta`;
  const description = `${user.name}: ${why}${input.orderType ? ` (${input.orderType})` : ""}.`;
  const event = addAuditEvent({
    category: "Seguridad",
    action: "drawer.unjustified",
    description,
    userId: user.id > 0 ? String(user.id) : undefined,
    userName: user.name,
    metadata: { reason: "cancelado", paymentMethod: input.paymentMethod, total: input.total, orderType: input.orderType },
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
  return `drawer:${event.id}`;
}

// ------------------------------------------------------------ espera antes de avisar

/**
 * El cobro se cerró sin vender, pero a veces la cuenta se manda a espera
 * o se cobra un momento después (ej. cerraron el cobro y tocaron "Cuenta en
 * espera"). Por eso el aviso espera unos minutos: si en ese tiempo esa
 * cuenta (mismo total) se guarda en espera o se cobra, no se avisa. Si ya se
 * avisó y luego se cobra, la alerta se resuelve sola.
 */
const SUSPECTS_KEY = "bpos_drawer_suspects"; // solo de este equipo
const WAIT_MS = 3 * 60_000;
const MATCH_MS = 60 * 60_000;

type Suspect = { id: string; at: number; paymentMethod: string; total: number; orderType?: string; alertId?: string };

function readSuspects(): Suspect[] {
  try {
    const list = JSON.parse(localStorage.getItem(SUSPECTS_KEY) || "[]");
    return Array.isArray(list) ? list.filter((s) => s && Date.now() - Number(s.at) < MATCH_MS) : [];
  } catch {
    return [];
  }
}
function writeSuspects(list: Suspect[]) {
  try {
    localStorage.setItem(SUSPECTS_KEY, JSON.stringify(list.slice(-30)));
  } catch {
    // sin almacenamiento: se avisa en el momento (abajo)
  }
}

/** Cajón abierto y cobro cerrado sin venta: se anota y se avisa en 3 minutos si nadie la cobra */
export function suspectDrawerWithoutSale(input: { paymentMethod: string; total: number; orderType?: string }) {
  if (typeof window === "undefined") return;
  writeSuspects([...readSuspects(), { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, at: Date.now(), ...input }]);
  setTimeout(() => void flushDrawerSuspects(), WAIT_MS + 1000);
}

/** Avisa los que ya esperaron sin que se cobrara su cuenta (también al abrir B-POS otra vez) */
export async function flushDrawerSuspects() {
  if (typeof window === "undefined") return;
  const list = readSuspects();
  const due = list.filter((s) => !s.alertId && Date.now() - s.at >= WAIT_MS);
  if (!due.length) {
    writeSuspects(list);
    return;
  }
  for (const s of due) {
    const alertId = await reportDrawerWithoutCashSale(s);
    s.alertId = alertId || "sin-alerta";
  }
  writeSuspects(list);
}

/**
 * Se guardó en espera o se cobró una cuenta: si coincide con un cobro que
 * se cerró sin vender (mismo total, en la última hora), no era sospechoso.
 */
export async function clearDrawerSuspect(total: number, how: "espera" | "cobro") {
  if (typeof window === "undefined" || !(total > 0)) return;
  const list = readSuspects();
  const match = [...list].reverse().find((s) => Math.abs(s.total - total) < 1);
  if (!match) return;
  writeSuspects(list.filter((s) => s.id !== match.id));
  if (!match.alertId || match.alertId === "sin-alerta") return; // todavía no se avisaba: ya no se avisa
  const [{ resolveOperationsAlert }, { addAuditEvent }, { getCurrentUser }] = await Promise.all([import("@/lib/notifications/operationsCenter"), import("@/lib/audit"), import("@/lib/auth")]);
  const note = how === "espera" ? "Se mandó a cuenta en espera" : "La cuenta se cobró después";
  resolveOperationsAlert(match.alertId, "Sistema", `${note} ($${total.toFixed(2)}).`);
  const user = getCurrentUser();
  addAuditEvent({ category: "Seguridad", action: "drawer.justified", description: `Cajón abierto sin venta de $${match.total.toFixed(2)}: ${note.toLowerCase()}.`, userName: user.name, metadata: { total, how } });
}
