import Link from "next/link";
import { AppShell } from "@/components/layout/AppShell";
import RequireRole from "@/components/auth/RequireRole";

const adminModules = [
  {
    title: "Productos",
    href: "/configuracion/productos",
    icon: "🍔",
    description: "Alta, edición, precios, categorías y estaciones.",
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
    title: "Usuarios",
    href: "/configuracion/usuarios",
    icon: "👥",
    description: "Empleados, roles y permisos.",
  },
  {
    title: "Proveedores",
    href: "/configuracion/proveedores",
    icon: "🏪",
    description: "Administración de proveedores.",
  },
  {
    title: "Estaciones",
    href: "/configuracion/estaciones",
    icon: "👨‍🍳",
    description: "Parrilla, Freidora, Barra y Cocina.",
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
    title: "Promociones",
    href: "/configuracion/promociones",
    icon: "🏷️",
    description: "Combos, descuentos y promociones.",
  },
  {
    title: "Sucursales",
    href: "/configuracion/sucursales",
    icon: "🏬",
    description: "Configuración multi sucursal.",
  },
  {
    title: "Seguridad",
    href: "/configuracion/seguridad",
    icon: "🔐",
    description: "Permisos y auditoría.",
  },
  {
    title: "Sistema",
    href: "/configuracion/sistema",
    icon: "⚙️",
    description: "Configuración general del sistema.",
  },
];

export default function ConfiguracionPage() {
  return (
    <RequireRole allow={["Admin"]}>
      <AppShell
        title="Centro de Administración"
        subtitle="Administra completamente Burger Planet OS."
      >
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
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