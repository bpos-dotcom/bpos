"use client";
/**
 * Cobro con la terminal Point desde el POS: manda el monto a la terminal de
 * la sucursal y espera a que el cliente pague. La venta se guarda solo
 * cuando Mercado Pago dice que se aprobó (o si la cajera elige cobrar sin
 * terminal, por ejemplo si se quedó sin batería).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { cancelTerminalCharge, startTerminalCharge, terminalChargeStatus } from "@/lib/mp/client";

export type TerminalResult = "paid" | "manual" | "cancelled";

type State =
  | { step: "sending" }
  | { step: "waiting"; id: string; status: string }
  | { step: "failed"; message: string; id?: string }
  | { step: "cancelling"; id: string };

const POLL_MS = 2000;

const FAIL_TEXT: Record<string, string> = {
  failed: "El pago fue rechazado en la terminal.",
  expired: "Se acabó el tiempo y la terminal canceló el cobro.",
  canceled: "El cobro se canceló en la terminal.",
  refunded: "El pago se devolvió.",
};

export function useTerminalCharge() {
  const [job, setJob] = useState<{ amount: number; description: string } | null>(null);
  const [state, setState] = useState<State>({ step: "sending" });
  const resolver = useRef<((r: TerminalResult) => void) | null>(null);

  const finish = useCallback((result: TerminalResult) => {
    resolver.current?.(result);
    resolver.current = null;
    setJob(null);
  }, []);

  const send = useCallback(async (amount: number, description: string) => {
    setState({ step: "sending" });
    try {
      const { id, status } = await startTerminalCharge(amount, description);
      setState({ step: "waiting", id, status });
    } catch (e) {
      setState({ step: "failed", message: e instanceof Error ? e.message : "No se pudo mandar el cobro a la terminal." });
    }
  }, []);

  /** Cobra en la terminal; regresa cómo terminó. */
  const charge = useCallback(
    (amount: number, description: string) =>
      new Promise<TerminalResult>((resolve) => {
        resolver.current = resolve;
        setJob({ amount, description });
        void send(amount, description);
      }),
    [send]
  );

  // Pregunta a Mercado Pago cómo va mientras la terminal espera la tarjeta
  useEffect(() => {
    if (state.step !== "waiting") return;
    let alive = true;
    const timer = window.setInterval(async () => {
      try {
        const s = await terminalChargeStatus(state.id);
        if (!alive) return;
        if (s.status === "processed") finish("paid");
        else if (FAIL_TEXT[s.status]) setState({ step: "failed", message: FAIL_TEXT[s.status], id: state.id });
        else setState({ step: "waiting", id: state.id, status: s.status });
      } catch {
        // sin internet un momento: se vuelve a preguntar
      }
    }, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [state, finish]);

  async function cancel() {
    if (state.step === "waiting") {
      const id = state.id;
      setState({ step: "cancelling", id });
      try {
        await cancelTerminalCharge(id);
      } catch {
        // si ya no se puede cancelar, se revisa abajo
      }
      // Por si el cliente alcanzó a pagar mientras se cancelaba
      const s = await terminalChargeStatus(id).catch(() => null);
      if (s?.status === "processed") return finish("paid");
    }
    finish("cancelled");
  }

  const modal = job ? (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-md rounded-3xl border border-sky-500/50 bg-zinc-950 p-6 text-center">
        <p className="text-5xl">📟</p>
        <p className="mt-3 text-sm font-bold text-zinc-400">Cobro con terminal Mercado Pago</p>
        <p className="mt-1 text-4xl font-black text-sky-300">${job.amount.toFixed(2)}</p>

        {state.step === "sending" && <p className="mt-4 font-bold">Mandando el monto a la terminal...</p>}
        {state.step === "waiting" && (
          <>
            <p className="mt-4 font-bold">{state.status === "at_terminal" ? "La terminal ya muestra el monto: el cliente puede pagar." : "Esperando a la terminal..."}</p>
            <p className="mt-1 animate-pulse text-sm text-zinc-500">La venta se guarda sola al aprobarse el pago.</p>
          </>
        )}
        {state.step === "cancelling" && <p className="mt-4 font-bold">Cancelando el cobro en la terminal...</p>}
        {state.step === "failed" && <p className="mt-4 font-bold text-red-300">{state.message}</p>}

        <div className="mt-6 grid gap-2">
          {state.step === "failed" && (
            <button onClick={() => void send(job.amount, job.description)} className="rounded-2xl bg-sky-500 py-3 font-black text-black">
              Intentar de nuevo
            </button>
          )}
          {(state.step === "failed" || state.step === "waiting") && (
            <button
              onClick={() => {
                if (confirm("¿Ya cobraste con tarjeta de otra forma? La venta se guarda como pagada con tarjeta.")) finish("manual");
              }}
              className="rounded-2xl border border-zinc-700 py-3 font-black text-zinc-200"
            >
              Ya cobré sin la terminal
            </button>
          )}
          {state.step !== "cancelling" && (
            <button onClick={() => void cancel()} className="rounded-2xl border border-red-500/50 py-3 font-black text-red-300">
              Cancelar cobro
            </button>
          )}
        </div>
      </div>
    </div>
  ) : null;

  return { charge, modal };
}
