"use client";
/**
 * El Chrome de una caja que ya se pasó al programa B-POS (caja local) deja de
 * trabajar como caja: tiene el mismo número de dispositivo y, si siguiera,
 * habría dos cajas peleándose. Las páginas públicas (menú digital, kiosco…)
 * siguen funcionando.
 */
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ask } from "@/components/layout/Dialogs";
import { MOVED_KEY, movedToCajaLocal, openCajaLocal } from "@/lib/caja-local";
import { resetDeviceSync, setPrimaryDevice } from "@/lib/cloud/sync";
import { isPublicPath } from "@/components/cloud/CloudGate";

export function CajaLocalMoved({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  // null = aún no se revisa: la caja no arranca (ni sincroniza) hasta saberlo
  const [moved, setMoved] = useState<boolean | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const check = () => setMoved(movedToCajaLocal());
    check();
  }, [pathname]);

  if (isPublicPath(pathname) || moved === false) return <>{children}</>;
  if (moved === null) return null;

  const open = async () => {
    setMessage((await openCajaLocal()) ? "Listo, ya se abrió el programa B-POS." : "No se pudo abrir. Ábrelo con el ícono de B-POS del escritorio.");
  };

  const backToBrowser = async () => {
    if (
      !(await ask(
        "Este navegador volverá a ser un equipo de B-POS (como una computadora nueva: baja todo de la nube y NO será la caja principal). El programa B-POS sigue igual. ¿Continuar?",
        { ok: "Usar este navegador", cancel: "Cancelar" }
      ))
    )
      return;
    try {
      window.localStorage.removeItem(MOVED_KEY);
      window.localStorage.removeItem("bpos_device_id");
      setPrimaryDevice(false);
      resetDeviceSync();
    } catch {
      /* si falla se queda como está */
    }
    window.location.reload();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-black p-6 text-white">
      <div className="w-full max-w-lg rounded-3xl border border-zinc-800 bg-zinc-950 p-8 text-center">
        <p className="text-5xl">💾</p>
        <h1 className="mt-4 text-2xl font-black">Esta caja ya se usa en el programa B-POS</h1>
        <p className="mt-3 text-sm text-zinc-400">
          Todo lo de esta caja se pasó al programa B-POS de esta computadora. Úsalo desde ahí (ícono de B-POS en el escritorio o junto al reloj). Este navegador ya no trabaja como caja.
        </p>
        <button onClick={() => void open()} className="mt-6 w-full rounded-2xl bg-orange-500 py-4 font-black text-black">
          Abrir el programa B-POS
        </button>
        {message && <p className="mt-3 text-sm text-zinc-300">{message}</p>}
        <button onClick={() => void backToBrowser()} className="mt-4 w-full rounded-2xl border border-zinc-700 py-3 text-sm font-bold text-zinc-300">
          Volver a usar este navegador
        </button>
      </div>
    </div>
  );
}
