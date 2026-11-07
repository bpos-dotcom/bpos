/**
 * Servicios de B-POS por separado (bpos.com.mx/servicios): un restaurante
 * puede contratar solo lo que necesita en lugar de un plan completo. Qué es
 * cada servicio, qué pantallas abre y si está vigente. Sin dependencias del
 * navegador ni del servidor: lo usan la caja, el panel y Vercel.
 *
 * Los precios y días de prueba viven en la nube (bpos_service_catalog,
 * 0034) y los cambia el dueño de B-POS; aquí van los de fábrica.
 */
export type ServiceId = "lealtad" | "menu" | "kiosco" | "asesor" | "foodcost" | "checador";
export type ServiceStatus = "trial" | "active" | "past_due" | "cancelled";

export type ServiceInfo = {
  id: ServiceId;
  name: string;
  emoji: string;
  /** Una línea para la tarjeta */
  short: string;
  features: string[];
  /** Pantalla principal del servicio */
  home: string;
  /** Pantallas que abre (prefijos de dirección) */
  paths: string[];
  /** Extra de otro servicio (el kiosco va con el menú digital) */
  addonOf?: ServiceId;
  /** Precio de fábrica al mes (MXN) */
  price: number;
};

export const SERVICES: ServiceInfo[] = [
  {
    id: "lealtad",
    name: "Tarjetas de lealtad",
    emoji: "💳",
    short: "Club de clientes con puntos, sellos o cashback y tarjeta en Google Wallet.",
    features: ["Tarjeta digital en el celular del cliente (Google Wallet)", "Puntos, sellos o cashback", "Captura la compra con el teléfono o el QR del cliente", "Premios, regalo de bienvenida y campañas por WhatsApp"],
    home: "/servicios/lealtad",
    paths: ["/servicios/lealtad", "/configuracion/club", "/clientes"],
    price: 199,
  },
  {
    id: "menu",
    name: "Menú digital",
    emoji: "📱",
    short: "Tu menú con QR, pedidos en línea sin comisión y reservaciones.",
    features: ["Menú con fotos y QR para mesas y redes", "Pedidos para recoger o a domicilio sin comisión", "Pago en línea con Mercado Pago", "Carga masiva desde Excel (Soft Restaurant y otros)"],
    home: "/pedidos-en-linea",
    paths: ["/pedidos-en-linea", "/configuracion/menu-digital", "/configuracion/productos", "/servicios/menu", "/opiniones"],
    price: 249,
  },
  {
    id: "kiosco",
    name: "Kiosco de autoservicio",
    emoji: "🖥️",
    short: "El cliente pide y paga solo en una pantalla (extra del menú digital).",
    features: ["Pantalla táctil para pedir y pagar", "Cobro con terminal Point de Mercado Pago", "Ticket en la impresora del kiosco"],
    home: "/configuracion/menu-digital",
    paths: ["/configuracion/menu-digital"],
    addonOf: "menu",
    price: 199,
  },
  {
    id: "asesor",
    name: "Asesor con IA",
    emoji: "🤖",
    short: "Sube tus reportes en Excel (DiDi, Uber, tu punto de venta) y la IA te asesora.",
    features: ["Lee reportes de DiDi, Uber, Rappi y tu punto de venta", "Resumen, alertas y consejos para vender más", "Chat para preguntarle sobre tus números"],
    home: "/servicios/asesor",
    paths: ["/servicios/asesor"],
    price: 249,
  },
  {
    id: "foodcost",
    name: "Food cost guiado",
    emoji: "🧮",
    short: "Paso a paso: cuánto te cuesta cada platillo y a cuánto venderlo en DiDi, Uber y Rappi.",
    features: ["Asistente paso a paso por platillo", "Costo con ingredientes y empaque", "Precio para cada app de delivery con su comisión", "Estrategia de precio con descuento"],
    home: "/servicios/food-cost",
    paths: ["/servicios/food-cost"],
    price: 149,
  },
  {
    id: "checador",
    name: "Reloj checador",
    emoji: "⏱️",
    short: "Entradas y salidas de tus empleados con PIN y reporte de horas.",
    features: ["Checador con PIN en cualquier tablet o celular", "Alta de empleados", "Horas trabajadas por día y reporte en Excel"],
    home: "/checador",
    paths: ["/checador", "/configuracion/asistencia", "/configuracion/usuarios"],
    price: 99,
  },
];

export const SERVICE_IDS = SERVICES.map((s) => s.id);
export const serviceInfo = (id: string) => SERVICES.find((s) => s.id === id);
export const isServiceId = (v: unknown): v is ServiceId => typeof v === "string" && SERVICE_IDS.includes(v as ServiceId);

/** Lo que cualquier cuenta de servicios puede abrir (panel, entrar con PIN, datos del negocio, ayuda) */
export const SERVICES_ALWAYS = ["/servicios", "/login", "/acceso-denegado", "/configuracion/empresa", "/ayuda", "/terminos", "/privacidad"];

export type CatalogEntry = { service: ServiceId; price: number; trial_days: number; ai_budget_usd: number; active: boolean };
export type ServiceRow = { service: ServiceId; status: ServiceStatus; trial_ends_at: string | null; paid_until: string | null };

/** Catálogo de la nube con los de fábrica para lo que falte */
export function mergeCatalog(rows: Partial<CatalogEntry>[] | null | undefined): CatalogEntry[] {
  return SERVICES.map((s) => {
    const r = (rows || []).find((x) => x.service === s.id);
    return {
      service: s.id,
      price: Number(r?.price ?? s.price),
      trial_days: Number(r?.trial_days ?? 14),
      ai_budget_usd: Number(r?.ai_budget_usd ?? 2),
      active: r?.active ?? true,
    };
  });
}

const DAY = 86_400_000;

/**
 * ¿Está vigente el servicio? Prueba hasta trial_ends_at; activo o con pago
 * pendiente/cancelado hasta lo ya pagado (paid_until; activo sin fecha = activación manual).
 */
export function serviceAccess(row: ServiceRow | null | undefined, now = Date.now()) {
  if (!row) return { open: false, label: "No contratado", daysLeft: null as number | null, end: null as number | null };
  const t = (d: string | null) => (d ? Date.parse(d) : null);
  const end = row.status === "trial" ? t(row.trial_ends_at) : t(row.paid_until);
  const daysLeft = end === null ? null : Math.ceil((end - now) / DAY);
  if (row.status === "active" && end === null) return { open: true, label: "Activo", daysLeft, end };
  const open = end !== null && end > now;
  const label =
    row.status === "trial"
      ? open
        ? `Prueba gratis · ${daysLeft} día${daysLeft === 1 ? "" : "s"}`
        : "Prueba terminada"
      : row.status === "active"
        ? open
          ? "Activo"
          : "Vencido"
        : row.status === "past_due"
          ? open
            ? `Pago pendiente · ${daysLeft} día${daysLeft === 1 ? "" : "s"}`
            : "En pausa"
          : open
            ? `Cancelado · sigue ${daysLeft} día${daysLeft === 1 ? "" : "s"}`
            : "Cancelado";
  return { open, label, daysLeft, end };
}

/** Servicios vigentes de una lista */
export const openServices = (rows: ServiceRow[], now = Date.now()) => rows.filter((r) => serviceAccess(r, now).open).map((r) => r.service);

/** ¿Qué servicio es dueño de esta pantalla? (el de prefijo más largo) */
export function serviceForPath(pathname: string): ServiceId | null {
  let best: { id: ServiceId; len: number } | null = null;
  for (const s of SERVICES) for (const p of s.paths) if ((pathname === p || pathname.startsWith(`${p}/`)) && (!best || p.length > best.len)) best = { id: s.id, len: p.length };
  return best?.id ?? null;
}

/** ¿Una cuenta de servicios con estos servicios vigentes puede abrir esta pantalla? */
export function canOpenAsServices(pathname: string, open: ServiceId[]) {
  if (SERVICES_ALWAYS.some((p) => (p === "/servicios" ? pathname === p || pathname.startsWith("/servicios/login") : pathname === p || pathname.startsWith(`${p}/`)))) return true;
  return open.some((id) => serviceInfo(id)!.paths.some((p) => pathname === p || pathname.startsWith(`${p}/`)));
}

/**
 * Permiso de uso de una cuenta de servicios: abierto mientras algún servicio
 * esté vigente, hasta el que venza al último (null = alguno sin fecha).
 */
export function servicesLicense(rows: ServiceRow[], now = Date.now()) {
  const access = rows.map((r) => serviceAccess(r, now)).filter((a) => a.open);
  if (!access.length) return { locked: true, end: now };
  return { locked: false, end: access.some((a) => a.end === null) ? null : Math.max(...access.map((a) => a.end as number)) };
}

/** external_reference de la suscripción de Mercado Pago de un servicio: "svc|negocio|servicio" */
export const serviceReference = (businessId: string, service: ServiceId) => `svc|${businessId}|${service}`;
export function parseServiceReference(ref?: string | null) {
  const [tag, businessId, service] = String(ref || "").split("|");
  return tag === "svc" && businessId && isServiceId(service) ? { businessId, service } : null;
}

export const money = (n: number) => `$${Math.round(n).toLocaleString("es-MX")}`;
