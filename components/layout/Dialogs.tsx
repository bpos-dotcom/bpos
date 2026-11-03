"use client";
/**
 * Avisos y preguntas DENTRO de B-POS, en vez de los diálogos del navegador
 * (alert / confirm / prompt), que congelan la página: con un alert abierto la
 * comanda, el ticket y el cajón se quedaban esperando a que dieran Aceptar.
 *
 *   notify("Pedido #12 cobrado.")                      aviso que se va solo
 *   notify("No salió el ticket", "error")              rojo, dura más
 *   if (!(await ask("¿Cerrar turno?"))) return;        pregunta Sí / No
 *   const pin = await askText("PIN", { password: true }); null si cancela
 *
 * <Dialogs/> va una sola vez en app/layout.tsx. Además reemplaza window.alert
 * por un aviso dentro de la página, para que ningún alert viejo congele nada.
 */
import { useEffect, useRef, useState } from "react";

type Kind = "ok" | "error" | "info";
type Toast = { id: number; message: string; kind: Kind };
type TextOptions = { placeholder?: string; defaultValue?: string; password?: boolean; numeric?: boolean; ok?: string; cancel?: string };
type Question =
  | { id: number; type: "confirm"; message: string; ok: string; cancel: string; resolve: (v: boolean) => void }
  | { id: number; type: "text"; message: string; options: TextOptions; resolve: (v: string | null) => void };

const TOAST_EVENT = "bpos:toast";
const ASK_EVENT = "bpos:ask";

export function notify(message: string, kind: Kind = "ok") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { message, kind } }));
}

/** Pregunta Sí / No dentro de la página. Sin <Dialogs/> montado (ej. pruebas) usa confirm. */
export function ask(message: string, options: { ok?: string; cancel?: string } = {}): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (!mounted) return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { type: "confirm", message, ok: options.ok || "Sí", cancel: options.cancel || "Cancelar", resolve } }));
  });
}

/** Pide un texto (o un PIN con password: true). null si cancela. */
export function askText(message: string, options: TextOptions = {}): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (!mounted) return Promise.resolve(window.prompt(message, options.defaultValue || ""));
  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { type: "text", message, options, resolve } }));
  });
}

let mounted = false;

export function Dialogs() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [queue, setQueue] = useState<Question[]>([]);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const current = queue[0];

  useEffect(() => {
    mounted = true;
    let seq = 0;
    const onToast = (e: Event) => {
      const { message, kind } = (e as CustomEvent<{ message: string; kind: Kind }>).detail;
      const id = ++seq;
      setToasts((list) => [...list, { id, message, kind }].slice(-4));
      setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), kind === "ok" ? 4500 : 8000);
    };
    const onAsk = (e: Event) => {
      const detail = (e as CustomEvent<Omit<Question, "id">>).detail;
      setQueue((q) => [...q, { ...detail, id: ++seq } as Question]);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    window.addEventListener(ASK_EVENT, onAsk);
    // Los alert() que queden en el sistema ya no congelan la página
    const nativeAlert = window.alert;
    window.alert = (message?: unknown) => notify(String(message ?? ""), "info");
    return () => {
      mounted = false;
      window.alert = nativeAlert;
      window.removeEventListener(TOAST_EVENT, onToast);
      window.removeEventListener(ASK_EVENT, onAsk);
    };
  }, []);

  // Cada pregunta nueva arranca con su valor inicial y el foco en el campo
  useEffect(() => {
    if (!current) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- valor inicial de la pregunta recién llegada
    setText(current.type === "text" ? current.options.defaultValue || "" : "");
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [current]);

  function answer(value: boolean | string | null) {
    if (!current) return;
    if (current.type === "confirm") current.resolve(Boolean(value));
    else current.resolve(typeof value === "string" ? value : null);
    setQueue((q) => q.slice(1));
  }

  return (
    <>
      {toasts.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 top-20 z-[100] flex flex-col items-center gap-2 px-4">
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}
              className={`pointer-events-auto max-w-xl whitespace-pre-line rounded-2xl border px-5 py-3 text-sm font-bold shadow-2xl ${
                t.kind === "error" ? "border-red-500/50 bg-red-950 text-red-100" : t.kind === "info" ? "border-orange-500/50 bg-zinc-900 text-zinc-100" : "border-green-500/50 bg-green-950 text-green-100"
              }`}
            >
              {t.message}
            </div>
          ))}
        </div>
      )}
      {current && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4" onClick={() => answer(current.type === "confirm" ? false : null)}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              answer(current.type === "confirm" ? true : text);
            }}
            className="w-full max-w-md rounded-3xl border border-zinc-700 bg-zinc-950 p-6 text-white shadow-2xl"
          >
            <p className="whitespace-pre-line text-base font-bold">{current.message}</p>
            {current.type === "text" && (
              <input
                ref={inputRef}
                type={current.options.password ? "password" : "text"}
                inputMode={current.options.numeric || current.options.password ? "numeric" : undefined}
                autoComplete="off"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={current.options.placeholder}
                className="mt-4 w-full rounded-2xl border border-zinc-700 bg-black px-4 py-3 text-lg text-white outline-none focus:border-orange-500"
              />
            )}
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => answer(current.type === "confirm" ? false : null)} className="flex-1 rounded-2xl border border-zinc-700 px-4 py-3 font-black text-zinc-200">
                {current.type === "confirm" ? current.cancel : current.options.cancel || "Cancelar"}
              </button>
              <button ref={current.type === "confirm" ? (inputRef as unknown as React.RefObject<HTMLButtonElement>) : undefined} type="submit" className="flex-1 rounded-2xl bg-orange-500 px-4 py-3 font-black text-black">
                {current.type === "confirm" ? current.ok : current.options.ok || "Aceptar"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
