"use client";
/** Tarjeta de Configuración que solo ve el administrador de la plataforma B-POS. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { getSupabase, isCloudConfigured } from "@/lib/supabase/client";

export function useIsPlatformAdmin() {
  const [admin, setAdmin] = useState<boolean | null>(null);
  useEffect(() => {
    if (!isCloudConfigured) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sin nube no hay administrador
      setAdmin(false);
      return;
    }
    let alive = true;
    getSupabase()
      .rpc("is_platform_admin")
      .then(({ data, error }) => alive && setAdmin(!error && data === true));
    return () => {
      alive = false;
    };
  }, []);
  return admin;
}

export function PlatformAdminCard() {
  const admin = useIsPlatformAdmin();
  if (!admin) return null;
  return (
    <Link
      href="/configuracion/admin"
      className="group rounded-3xl border border-orange-500/60 bg-orange-500/10 p-6 transition-all duration-200 hover:border-orange-500"
    >
      <div className="text-5xl">🛡️</div>
      <h2 className="mt-5 text-2xl font-black text-orange-500">Administrador de B-POS</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-400">Solo tú: todos los negocios, sus planes, pagos y uso de IA.</p>
    </Link>
  );
}
