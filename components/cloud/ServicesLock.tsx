"use client";
/**
 * Cuenta de solo servicios (bpos.com.mx/servicios): abre solo las pantallas
 * de lo que tiene vigente (lib/services.ts). Una pantalla de un servicio no
 * contratado o vencido muestra cómo contratarlo; el resto de B-POS (POS,
 * caja, cocina...) regresa al panel de servicios. Las cuentas de B-POS
 * completo no ven nada de esto.
 */
import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { canOpenAsServices, openServices, serviceAccess, serviceForPath, serviceInfo } from "@/lib/services";
import { useServicesState } from "@/lib/services-client";

export function ServicesLock() {
  const pathname = usePathname() || "/";
  const state = useServicesState();
  const isServices = state?.kind === "servicios";
  const open = isServices ? openServices(state!.services) : [];
  const allowed = !isServices || canOpenAsServices(pathname, open);
  const owner = allowed ? null : serviceForPath(pathname);

  // Pantalla del B-POS completo: de regreso al panel de servicios
  useEffect(() => {
    if (!allowed && !owner) window.location.replace("/servicios");
  }, [allowed, owner]);

  if (allowed) return null;
  if (!owner) return <div className="fixed inset-0 z-[80] bg-black" />;

  const info = serviceInfo(owner)!;
  const row = state!.services.find((s) => s.service === owner);
  const access = serviceAccess(row);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-6 text-white backdrop-blur">
      <section className="w-full max-w-lg rounded-3xl border border-orange-500/40 bg-zinc-950 p-8 text-center">
        <p className="text-5xl">{info.emoji}</p>
        <h2 className="mt-4 text-3xl font-black">{info.name}</h2>
        <p className="mt-3 text-zinc-300">{row ? `Tu servicio está ${access.label.toLowerCase()}. Tus datos están guardados: actívalo para seguir.` : "Este servicio no está contratado en tu cuenta."}</p>
        <Link href="/servicios" className="mt-6 block w-full rounded-2xl bg-orange-500 py-4 font-black text-black hover:bg-orange-400">
          Ir a mis servicios
        </Link>
      </section>
    </div>
  );
}
