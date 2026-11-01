"use client";
/**
 * Teclado en pantalla para el kiosco (pantalla táctil sin teclado físico).
 * Aparece abajo cuando se toca un campo de texto y escribe en ese campo
 * (como si fuera el teclado real: React se entera por el evento "input").
 * Campos numéricos (inputMode="numeric") muestran solo números.
 */
import { useCallback, useEffect, useRef, useState } from "react";

type Field = HTMLInputElement | HTMLTextAreaElement;

const ROWS_TEXT = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", "ñ"],
  ["z", "x", "c", "v", "b", "n", "m", ",", ".", "-"],
];
const ROWS_NUMERIC = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["", "0", ""],
];
const ACCENTS: Record<string, string> = { a: "á", e: "é", i: "í", o: "ó", u: "ú" };

function isTextField(el: Element | null): el is Field {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (!(el instanceof HTMLInputElement)) return false;
  return !el.readOnly && !el.disabled && ["text", "email", "search", "tel", "number", "url", "password"].includes(el.type);
}

/** Escribe como lo haría el teclado: cambia el valor y avisa a React */
function setValue(field: Field, next: string) {
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(field, next);
  else field.value = next;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

export function TouchKeyboard() {
  const [field, setField] = useState<Field | null>(null);
  const [shift, setShift] = useState(false);
  const [accent, setAccent] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const el = e.target as Element | null;
      if (isTextField(el)) {
        setField(el);
        setShift(false);
        setAccent(false);
        // Que el campo no quede tapado por el teclado
        window.setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
      }
    };
    const onBlur = (e: FocusEvent) => {
      // Tocar el teclado no cuenta como salir del campo (sus botones no toman el foco)
      const to = e.relatedTarget as Node | null;
      if (to && boxRef.current?.contains(to)) return;
      window.setTimeout(() => {
        if (!isTextField(document.activeElement)) setField(null);
      }, 80);
    };
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onBlur);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onBlur);
    };
  }, []);

  // Espacio abajo para que el contenido se pueda desplazar por encima del teclado
  useEffect(() => {
    if (!field) return;
    const previous = document.body.style.paddingBottom;
    document.body.style.paddingBottom = "320px";
    return () => {
      document.body.style.paddingBottom = previous;
    };
  }, [field]);

  const press = useCallback(
    (key: string) => {
      if (!field || !field.isConnected) return setField(null);
      const value = field.value;
      const max = "maxLength" in field && field.maxLength > 0 ? field.maxLength : Infinity;
      let next = value;
      if (key === "⌫") next = value.slice(0, -1);
      else if (key === "espacio") next = value + " ";
      else {
        let ch = key;
        if (accent && ACCENTS[ch]) ch = ACCENTS[ch];
        if (shift) ch = ch.toUpperCase();
        next = value + ch;
        if (shift) setShift(false);
        if (accent) setAccent(false);
      }
      if (next.length > max) next = next.slice(0, max);
      setValue(field, next);
      field.focus();
    },
    [field, shift, accent]
  );

  if (!field) return null;
  const numeric = field instanceof HTMLInputElement && (field.inputMode === "numeric" || field.inputMode === "decimal" || field.type === "number" || field.type === "tel");
  const email = field instanceof HTMLInputElement && (field.type === "email" || field.inputMode === "email");
  const rows = numeric ? ROWS_NUMERIC : ROWS_TEXT;
  const keep = (e: React.MouseEvent | React.TouchEvent) => e.preventDefault();
  const keyCls = "flex h-14 flex-1 items-center justify-center rounded-xl bg-white text-2xl font-black text-zinc-900 shadow active:bg-orange-200";
  const wideCls = "flex h-14 items-center justify-center rounded-xl bg-zinc-300 px-4 text-lg font-black text-zinc-900 shadow active:bg-orange-200";

  return (
    <div ref={boxRef} onMouseDown={keep} onTouchStart={keep} className="fixed inset-x-0 bottom-0 z-[60] select-none border-t border-zinc-300 bg-zinc-200 p-2 pb-3" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
      <div className={`mx-auto space-y-2 ${numeric ? "max-w-sm" : "max-w-4xl"}`}>
        {rows.map((row, i) => (
          <div key={i} className="flex gap-2">
            {row.map((k, j) =>
              k ? (
                <button key={k} type="button" onClick={() => press(k)} className={keyCls}>
                  {shift ? k.toUpperCase() : accent && ACCENTS[k] ? ACCENTS[k] : k}
                </button>
              ) : (
                <span key={`gap-${j}`} className="flex-1" />
              )
            )}
          </div>
        ))}
        {!numeric && (
          <div className="flex gap-2">
            <button type="button" onClick={() => setShift((v) => !v)} className={`${wideCls} ${shift ? "bg-orange-400" : ""}`}>
              ⇧
            </button>
            <button type="button" onClick={() => setAccent((v) => !v)} className={`${wideCls} ${accent ? "bg-orange-400" : ""}`} aria-label="Acento">
              ´
            </button>
            {email && (
              <>
                <button type="button" onClick={() => press("@")} className={wideCls}>@</button>
                <button type="button" onClick={() => press(".com")} className={wideCls}>.com</button>
              </>
            )}
            <button type="button" onClick={() => press("espacio")} className={`${keyCls} text-base`}>
              espacio
            </button>
            <button type="button" onClick={() => press("⌫")} className={`${wideCls} w-20`} aria-label="Borrar">
              ⌫
            </button>
            <button type="button" onClick={() => { field.blur(); setField(null); }} className={`${wideCls} bg-orange-500 text-white`}>
              Listo
            </button>
          </div>
        )}
        {numeric && (
          <div className="flex gap-2">
            <button type="button" onClick={() => press("⌫")} className={`${wideCls} flex-1`} aria-label="Borrar">
              ⌫ Borrar
            </button>
            <button type="button" onClick={() => { field.blur(); setField(null); }} className={`${wideCls} flex-1 bg-orange-500 text-white`}>
              Listo
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
