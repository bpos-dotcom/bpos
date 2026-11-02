"use client";
/**
 * Botón "Volver" que siempre se ve en la esquina superior izquierda de
 * todas las pantallas del sistema (el menú lateral queda a la derecha).
 * Regresa a la pantalla anterior; si se abrió directo (sin historial) va
 * al Dashboard, y desde el Dashboard o el POS lleva al otro.
 */
import { usePathname, useRouter } from "next/navigation";

export function BackButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const home = pathname === "/dashboard" ? "/pos" : "/dashboard";
  function back() {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push(home);
  }
  return (
    <button
      type="button"
      onClick={back}
      title="Volver a la pantalla anterior"
      aria-label="Volver"
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-2xl font-black text-white shadow-lg transition hover:border-orange-500 hover:text-orange-400 ${className}`}
    >
      ←
    </button>
  );
}
