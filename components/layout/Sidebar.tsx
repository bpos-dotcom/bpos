import Link from "next/link";

const navItems = [
  { label: "Dashboard", href: "/", icon: "📊" },
  { label: "POS", href: "/pos", icon: "🛒" },
  { label: "B-POS Bridge", href: "/bridge", icon: "🌉" },
  { label: "Caja", href: "/caja", icon: "💵" },
  { label: "Cocina KDS", href: "/cocina", icon: "👨‍🍳" },
  { label: "Inventario", href: "/inventario", icon: "📦" },
  { label: "Compras", href: "/compras", icon: "🛒" },
  { label: "Clientes", href: "/clientes", icon: "👥" },
  { label: "Reportes", href: "/reportes", icon: "📈" },
  { label: "Configuración", href: "/configuracion", icon: "⚙️" },
];

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 hidden h-screen w-64 border-r border-zinc-800 bg-zinc-950 p-4 lg:block">
      <div className="mb-8 rounded-2xl border border-zinc-800 bg-black p-4">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-orange-500 font-black text-black">
          BP
        </div>
        <p className="text-sm font-bold text-orange-500">Burger Planet</p>
        <h1 className="text-2xl font-black text-white">BPOS</h1>
      </div>

      <nav className="space-y-2">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="block rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm font-bold text-zinc-200 hover:border-orange-500 hover:text-orange-500"
          >
            <span className="mr-2">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}