import { Sidebar } from "@/components/layout/Sidebar";

type AppShellProps = {
  title: string;
  subtitle: string;
  children: React.ReactNode;
};

export function AppShell({ title, subtitle, children }: AppShellProps) {
  return (
    <main className="min-h-screen bg-black text-white">
      <Sidebar />

      <section className="lg:ml-64">
        <header className="sticky top-0 z-20 border-b border-zinc-800 bg-black/90 px-6 py-4 backdrop-blur">
          <p className="font-bold text-orange-500">Burger Planet OS</p>
          <h2 className="mt-1 text-3xl font-black">{title}</h2>
          <p className="mt-2 text-zinc-400">{subtitle}</p>
        </header>

        <div className="p-6">{children}</div>
      </section>
    </main>
  );
}