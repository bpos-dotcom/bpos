"use client";
/**
 * Configuración → Sistema: pasar la caja de Chrome al programa B-POS (caja
 * local, lib/caja-local.ts). En la caja local solo dice que ya está.
 */
import { useEffect, useState } from "react";
import { ask, notify } from "@/components/layout/Dialogs";
import { getCurrentUser } from "@/lib/auth";
import { flush } from "@/lib/cloud/sync";
import { requirePermissionOrAdmin } from "@/lib/permissions";
import { agentCajaInfo, isCajaLocal, moveToCajaLocal, type AgentCajaInfo } from "@/lib/caja-local";

export function CajaLocalCard({ className = "" }: { className?: string }) {
  const [local, setLocal] = useState<boolean | null>(null);
  const [agent, setAgent] = useState<AgentCajaInfo | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const check = () => {
      const here = isCajaLocal();
      setLocal(here);
      if (!here) void agentCajaInfo().then(setAgent);
    };
    check();
  }, []);

  if (local === null) return null;
  if (local) {
    return (
      <section className={`rounded-3xl border border-emerald-500/50 bg-emerald-500/10 p-6 ${className}`}>
        <h2 className="text-lg font-black">💾 Caja local activada</h2>
        <p className="mt-2 text-sm text-zinc-300">
          Esta caja funciona en el programa B-POS: lo guardado vive en el disco de la computadora (ya no se llena la memoria del navegador) y no se traba al guardar. Se sigue sincronizando con la nube como siempre.
        </p>
      </section>
    );
  }

  const move = async () => {
    if (!(await requirePermissionOrAdmin(getCurrentUser(), "settings.view", "pasar esta caja al programa B-POS"))) return;
    if (
      !(await ask(
        "Se copia todo lo de esta caja al programa B-POS y se abre ahí. Después este navegador ya no se usa como caja. ¿Continuar?",
        { ok: "Pasar al programa", cancel: "Cancelar" }
      ))
    )
      return;
    setBusy(true);
    try {
      // Primero se sube lo pendiente, para que el programa empiece al día
      await Promise.race([flush().catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))]);
      let result = await moveToCajaLocal();
      if (!result.ok && result.conflict) {
        if (!(await ask("El programa B-POS ya tiene datos de una caja. ¿Reemplazarlos con los de este navegador?", { ok: "Reemplazar", cancel: "Cancelar" }))) return;
        result = await moveToCajaLocal({ replace: true });
      }
      if (!result.ok) {
        notify(result.error, "error");
        return;
      }
      notify("Listo: la caja ya se abrió en el programa B-POS.");
      window.location.reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`rounded-3xl border border-zinc-800 bg-zinc-950 p-6 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-black">💾 Caja local (programa B-POS)</h2>
          <p className="mt-2 text-sm text-zinc-300">
            Usa la caja en el programa B-POS en vez de Chrome: lo guardado vive en el disco (la memoria del navegador se llena y lo traba). Es la misma pantalla, se actualiza sola, funciona sin internet y se sigue sincronizando con la nube.
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            {agent === undefined
              ? "Buscando B-POS Agent en esta computadora…"
              : agent === null
                ? "Necesitas B-POS Agent 2.0.24 o más nuevo abierto en esta computadora (se actualiza solo; o búscalo junto al reloj → Buscar actualizaciones)."
                : agent.enabled && agent.hasData
                  ? "El programa B-POS ya tiene una caja local en esta computadora."
                  : "B-POS Agent listo. Hazlo solo en la computadora de la caja."}
          </p>
        </div>
        <button
          disabled={!agent || busy}
          onClick={() => void move()}
          className="shrink-0 rounded-2xl bg-orange-500 px-5 py-3 font-black text-black disabled:opacity-40"
        >
          {busy ? "Pasando…" : "Pasar esta caja al programa"}
        </button>
      </div>
    </section>
  );
}
