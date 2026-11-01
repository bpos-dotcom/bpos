"use client";
/**
 * Configuración → Sistema: B-POS Agent de la sucursal. Muestra si está
 * conectado, sus impresoras, y da el código para vincular una computadora
 * nueva (o desvincular una).
 */
import { useEffect, useState } from "react";
import { DOWNLOAD_URL } from "@/components/layout/TopCorner";
import { newPairingCode, unlinkAgent, useAgents } from "@/lib/agent/client";
import { isCloudConfigured } from "@/lib/supabase/client";

function ago(iso: string | null) {
  if (!iso) return "nunca";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "hace unos segundos";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `hace ${h} h` : new Date(iso).toLocaleDateString("es-MX");
}

export function AgentCard({ className = "" }: { className?: string }) {
  const { agents, error, reload } = useAgents();
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  // El código vence: se esconde solo
  useEffect(() => {
    if (!code) return;
    const left = Date.parse(code.expires_at) - Date.now();
    const timer = window.setTimeout(() => setCode(null), Math.max(0, left));
    return () => window.clearTimeout(timer);
  }, [code]);

  // Cuando el Agent nuevo se vincula, aparece en la lista y el código ya no hace falta
  const count = agents?.length ?? 0;
  const [countAtCode, setCountAtCode] = useState(0);
  useEffect(() => {
    if (code && count > countAtCode) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- el Agent se acaba de vincular
      setCode(null);
      setMessage("✅ Computadora vinculada.");
    }
  }, [code, count, countAtCode]);

  async function pair() {
    setBusy(true);
    setMessage("");
    try {
      setCountAtCode(count);
      setCode(await newPairingCode());
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo crear el código.");
    } finally {
      setBusy(false);
    }
  }

  async function unlink(id: string, name: string) {
    if (!confirm(`¿Desvincular "${name || "B-POS Agent"}"?\n\nEsa computadora dejará de imprimir y de recibir pedidos de delivery hasta que la vuelvas a vincular.`)) return;
    try {
      await unlinkAgent(id);
      await reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo desvincular.");
    }
  }

  return (
    <section className={`rounded-3xl border border-zinc-800 bg-zinc-950 p-6 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="text-lg font-black">🖨️ B-POS Agent: impresoras y delivery</h2>
          <p className="mt-1 text-sm text-zinc-400">
            B-POS funciona en la web. Instala B-POS Agent solo en la computadora que tiene las impresoras y donde llegan los pedidos de
            Rappi, Uber Eats y DiDi Food: lee esos tickets, los manda a B-POS e imprime las comandas de todos tus dispositivos.
          </p>
        </div>
        <a href={DOWNLOAD_URL} className="rounded-2xl border border-orange-500 px-5 py-3 font-black text-orange-300 hover:bg-orange-500/10">
          ⬇️ Descargar B-POS Agent
        </a>
      </div>

      {!isCloudConfigured ? (
        <p className="mt-4 text-sm text-zinc-500">Modo de prueba sin nube: el Agent de esta computadora se usa directo.</p>
      ) : (
        <>
          {(agents?.filter((a) => a.online && !a.kiosk_id).length ?? 0) > 1 && (
            <div className="mt-5 rounded-2xl border border-red-500/60 bg-red-500/10 p-4 text-sm">
              <p className="font-black text-red-300">⚠️ Hay {agents?.filter((a) => a.online && !a.kiosk_id).length} computadoras con B-POS Agent conectadas en esta sucursal.</p>
              <p className="mt-1 text-red-200/80">
                Los tickets se reparten entre ellas al azar: los que caen en la computadora sin impresoras no salen. Deja vinculada solo la
                computadora de las impresoras y desvincula las demás aquí abajo.
              </p>
            </div>
          )}
          <ul className="mt-5 space-y-2">
            {agents === null && !error && <li className="text-sm text-zinc-500">Revisando...</li>}
            {agents?.length === 0 && <li className="text-sm text-zinc-400">Esta sucursal todavía no tiene una computadora vinculada.</li>}
            {agents?.map((agent) => (
              <li key={agent.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-black px-4 py-3">
                <div>
                  <p className="font-black">
                    <span className={`mr-2 inline-block h-2.5 w-2.5 rounded-full ${agent.online ? "bg-green-500" : "bg-red-500"}`} />
                    {agent.name || "B-POS Agent"}
                    <span className="ml-2 text-sm font-bold text-zinc-500">{agent.online ? "Conectado" : `Desconectado · visto ${ago(agent.last_seen_at)}`}</span>
                    {agent.kiosk_id && <span className="ml-2 rounded-lg bg-sky-500/20 px-2 py-0.5 text-xs font-bold text-sky-300">🖥️ Kiosco: solo imprime el ticket de su pantalla</span>}
                  </p>
                  <p className="mt-1 text-xs text-zinc-500">
                    {agent.version ? `Versión ${agent.version} · ` : ""}
                    {agent.printers.length} impresora{agent.printers.length === 1 ? "" : "s"}
                    {agent.printers.length ? `: ${agent.printers.map((p) => p.displayName || p.name).join(", ")}` : ""}
                  </p>
                </div>
                <button onClick={() => void unlink(agent.id, agent.name)} className="rounded-xl border border-zinc-700 px-3 py-2 text-sm font-black hover:border-red-500 hover:text-red-300">
                  Desvincular
                </button>
              </li>
            ))}
          </ul>
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

          {code ? (
            <div className="mt-5 rounded-2xl border border-orange-500/50 bg-orange-500/10 p-5">
              <p className="text-sm font-bold text-orange-200">Código para vincular (vence en 15 minutos):</p>
              <p className="mt-2 select-all font-mono text-4xl font-black tracking-[0.2em] text-orange-400">
                {code.code.slice(0, 4)}-{code.code.slice(4)}
              </p>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-zinc-300">
                <li>En la computadora de las impresoras descarga e instala B-POS Agent (o ábrelo si ya lo tienes).</li>
                <li>En la ventana de B-POS Agent escribe este código y toca &quot;Vincular&quot;.</li>
              </ol>
              <p className="mt-2 text-xs text-zinc-500">Esta pantalla se actualiza sola cuando la computadora quede vinculada.</p>
            </div>
          ) : (
            <button onClick={() => void pair()} disabled={busy} className="mt-5 rounded-2xl bg-orange-500 px-5 py-3 font-black text-black hover:bg-orange-400 disabled:opacity-50">
              {busy ? "Creando código..." : "＋ Vincular una computadora"}
            </button>
          )}
          {message && <p className="mt-3 text-sm font-bold text-zinc-300">{message}</p>}
        </>
      )}
    </section>
  );
}
