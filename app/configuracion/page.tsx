import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import RequireRole from "@/components/auth/RequireRole";
import { PlatformAdminCard } from "@/components/admin/PlatformAdminCard";

const adminModules = [
  {
    title: "Centro de Operaciones",
    href: "/centro-operaciones",
    icon: "🚨",
    description: "Alertas críticas, delivery, inventario e historial de incidencias.",
  },
  {
    title: "Empresa y propietario",
    href: "/configuracion/empresa",
    icon: "🏢",
    description: "Nombre del negocio y WhatsApp del dueño para cortes y listas de compras.",
  },
  {
    title: "Delivery: equivalencias guardadas",
    href: "/configuracion/delivery-equivalencias",
    icon: "🔗",
    description: "Productos, ingredientes, grupos e instrucciones ignoradas de plataformas delivery.",
  },
  {
    title: "Productos",
    href: "/configuracion/productos",
    icon: "🍔",
    description: "Alta, edición, precios, categorías y estaciones.",
  },
  {
    title: "Menú digital",
    href: "/configuracion/menu-digital",
    icon: "🌐",
    description: "Tu menú en internet y pedidos sin comisión: liga, QR de mesas, horario, agotados y ocultos.",
  },
  {
    title: "Club de clientes",
    href: "/configuracion/club",
    icon: "⭐",
    description: "Fidelidad: puntos, sellos o cashback, regalo de bienvenida, comunidad y redes, y el QR para tu restaurante.",
  },
  {
    title: "Notificaciones",
    href: "/configuracion/notificaciones",
    icon: "🔔",
    description: "Sonido, veces, color y parpadeo de cada aviso: pedidos en línea, equivalencias, inventario y errores.",
  },
  {
    title: "Reparto",
    href: "/configuracion/reparto",
    icon: "🛵",
    description: "Tus repartidores y su WhatsApp: al salir un pedido a domicilio eliges quién lo lleva y le llega todo por WhatsApp.",
  },
  {
    title: "Sistema",
    href: "/configuracion/sistema",
    icon: "⚙️",
    description: "Modo oscuro/claro, moneda, idioma, pantalla táctil, respaldos y descargar B-POS.",
  },
  {
    title: "Mi plan",
    href: "/configuracion/plan",
    icon: "💳",
    description: "Tu suscripción a B-POS: Basic, Pro o Max, prueba gratis y sucursales.",
  },
  {
    title: "Subir menú con IA",
    href: "/configuracion/menu-ia",
    icon: "🤖",
    description: "Fotos o PDF de tu menú: Claude registra tus productos y tú los revisas.",
  },
  {
    title: "Ingredientes",
    href: "/configuracion/ingredientes",
    icon: "🥩",
    description: "Catálogo maestro de inventario.",
  },
  {
    title: "Recetas",
    href: "/configuracion/recetas",
    icon: "📖",
    description: "Consumo de ingredientes por producto.",
  },
  {
    title: "Usuarios y seguridad",
    href: "/configuracion/usuarios",
    icon: "👥",
    description: "Empleados, PIN, roles y permisos.",
  },
  {
    title: "Proveedores",
    href: "/compras",
    icon: "🏪",
    description: "Administración de proveedores.",
  },
  {
    title: "Estaciones de cocina",
    href: "/configuracion/pos",
    icon: "👨‍🍳",
    description: "Nombre de cada estación, cuáles existen y a dónde va lo que no tiene estación.",
  },
  {
    title: "Impresoras",
    href: "/configuracion/impresoras",
    icon: "🖨️",
    description: "Asignación de impresoras por estación.",
  },
  {
    title: "Métodos de pago",
    href: "/configuracion/pagos",
    icon: "💳",
    description: "Efectivo, Tarjeta, Uber, Didi, etc.",
  },
  {
    title: "Bitácora general",
    href: "/configuracion/auditoria",
    icon: "📒",
    description: "Auditoría de caja, ventas y acciones sensibles.",
  },
];

export default function ConfiguracionPage() {
  return (
    <RequireRole allow={["Admin"]}>
      <AppShell
        title="Centro de Administración"
        subtitle="Administra completamente tu negocio en B-POS."
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          <PlatformAdminCard />
          {adminModules.map((module) => (
            <Link
              key={module.title}
              href={module.href}
              className="group rounded-3xl border border-zinc-800 bg-zinc-950 p-6 transition-all duration-200 hover:border-orange-500 hover:bg-zinc-900"
            >
              <div className="flex items-center justify-between">
                <div className="text-5xl">{module.icon}</div>

                <div className="rounded-xl bg-orange-500 px-3 py-1 text-xs font-black text-black opacity-0 transition group-hover:opacity-100">
                  Abrir
                </div>
              </div>

              <h2 className="mt-5 text-2xl font-black text-orange-500">
                {module.title}
              </h2>

              <p className="mt-2 text-sm leading-6 text-zinc-400">
                {module.description}
              </p>
            </Link>
          ))}
        </div>
      </AppShell>
    </RequireRole>
  );
}