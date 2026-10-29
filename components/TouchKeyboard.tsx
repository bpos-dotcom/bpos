"use client";
/**
 * Teclado en pantalla para cajas táctiles (Configuración → Punto de venta →
 * Pantalla táctil). Apagado no hace nada.
 *
 * Encendido, al tocar cualquier campo de texto o de cantidad aparece:
 *  - teclado numérico para cantidades (con botones rápidos si el campo los
 *    trae en data-quick, ej. los billetes al cobrar);
 *  - teclado con letras (ñ y acentos) para texto.
 * Escribe directo en el campo (como si se tecleara), así todo B-POS lo usa
 * sin cambios. Un campo con data-no-touch-keyboard se salta.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { DEVICE_SETTINGS_EVENT, touchKeypadEnabled } from "@/lib/device-settings";

type Field = HTMLInputElement | HTMLTextAreaElement;
type Quick = { label: string; value: number };

const TEXT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", ""]);
const NUMERIC_KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "⌫"];
const ROWS = ["1234567890", "qwertyuiop", "asdfghjklñ", "zxcvbnm"];
const ACCENTS: Record<string, string> = { a: "á", e: "é", i: "í", o: "ó", u: "ú", A: "Á", E: "É", I: "Í", O: "Ó", U: "Ú" };

function eligible(el: EventTarget | null): el is Field {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled && !el.dataset.noTouchKeyboard;
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.readOnly || el.disabled || el.dataset.noTouchKeyboard) return false;
  return el.type === "number" || TEXT_TYPES.has(el.type);
}

const isNumeric = (el: Field) => el instanceof HTMLInputElement && (el.type === "number" || el.inputMode === "decimal" || el.inputMode === "numeric");

/** Escribe en el campo como si se tecleara (React se entera del cambio). */
function setNativeValue(el: Field, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function labelOf(el: Field) {
  const label = el.labels?.[0]?.innerText?.trim();
  return el.dataset.keypadLabel || label || el.getAttribute("aria-label") || el.placeholder || "Escribe";
}

export function TouchKeyboard() {
  const [enabled, setEnabled] = useState(false);
  const [field, setField] = useState<Field | null>(null);
  const [draft, setDraft] = useState("");
  const [shift, setShift] = useState(false);
  const [accent, setAccent] = useState(false);
  const fieldRef = useRef<Field | null>(null);

  useEffect(() => {
    const load = () => setEnabled(touchKeypadEnabled());
    load();
    window.addEventListener(DEVICE_SETTINGS_EVENT, load);
    return () => window.removeEventListener(DEVICE_SETTINGS_EVENT, load);
  }, []);

  // Tocar un campo abre el teclado (sin el teclado del sistema)
  useEffect(() => {
    if (!enabled) return;
    const onPointerDown = (event: PointerEvent) => {
      const el = event.target;
      if (!eligible(el) || (el as HTMLElement).closest("[data-touch-keyboard]")) return;
      event.preventDefault();
      fieldRef.current = el;
      setField(el);
      setDraft(el.value);
      setShift(!el.value && !isNumeric(el) && el.type !== "email" && el.type !== "password");
      setAccent(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [enabled]);

  const apply = useCallback((value: string) => {
    setDraft(value);
    const el = fieldRef.current;
    if (!el) return;
    // En cantidades no se manda un número a medias ("12.")
    if (isNumeric(el) && value.endsWith(".")) return;
    setNativeValue(el, value);
  }, []);

  const close = useCallback(() => {
    const el = fieldRef.current;
    if (el && isNumeric(el)) setNativeValue(el, draft.replace(/\.$/, ""));
    fieldRef.current = null;
    setField(null);
  }, [draft]);

  if (!enabled || !field) return null;
  const numeric = isNumeric(field);
  const password = field instanceof HTMLInputElement && field.type === "password";
  let quick: Quick[] = [];
  try {
    quick = field.dataset.quick ? JSON.parse(field.dataset.quick) : [];
  } catch {
    quick = [];
  }

  const pressNumber = (key: string) => {
    if (key === "⌫") return apply(draft.slice(0, -1));
    if (key === "." && draft.includes(".")) return;
    if (draft.includes(".") && draft.split(".")[1].length >= 2) return; // centavos
    apply(draft === "0" && key !== "." ? key : (draft + key).slice(0, 10));
  };

  const pressLetter = (key: string) => {
    let char = shift ? key.toUpperCase() : key;
    if (accent && ACCENTS[char]) char = ACCENTS[char];
    setAccent(false);
    setShift(false);
    apply(draft + char);
  };

  return (
    <div data-touch-keyboard className="fixed inset-x-0 bottom-0 z-[80] border-t border-zinc-700 bg-zinc-950/98 p-3 shadow-[0_-12px_40px_rgba(0,0,0,0.7)] backdrop-blur" onPointerDown={(e) => e.preventDefault()}>
      <div className={`mx-auto ${numeric ? "max-w-sm" : "max-w-4xl"}`}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-zinc-400">{labelOf(field)}</p>
            <p className="truncate rounded-xl border border-zinc-800 bg-black px-3 py-2 text-right text-2xl font-black text-white">
              {numeric ? `$${draft || "0"}` : password ? "•".repeat(draft.length) || " " : draft || " "}
            </p>
          </div>
          <button onClick={close} className="rounded-2xl bg-orange-500 px-6 py-4 text-lg font-black text-black">
            Listo
          </button>
        </div>

        {numeric ? (
          <>
            {quick.length > 0 && (
              <div className="mt-2 grid grid-cols-4 gap-2">
                {quick.map((q) => (
                  <button key={q.label} onClick={() => apply(String(q.value))} className="rounded-xl border border-orange-500/50 bg-orange-500/10 py-2 text-sm font-black text-orange-300">
                    {q.label}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2 grid grid-cols-3 gap-2">
              {NUMERIC_KEYS.map((key) => (
                <button key={key} onClick={() => pressNumber(key)} className="rounded-2xl border border-zinc-800 bg-black py-4 text-2xl font-black text-white active:bg-zinc-800">
                  {key}
                </button>
              ))}
            </div>
            <button onClick={() => apply("")} className="mt-2 w-full rounded-2xl border border-zinc-800 py-3 font-black text-zinc-300">
              Borrar todo
            </button>
          </>
        ) : (
          <div className="mt-2 space-y-2">
            {ROWS.map((row, i) => (
              <div key={row} className="flex justify-center gap-1.5">
                {i === 3 && (
                  <button onClick={() => setShift((v) => !v)} className={`w-16 rounded-xl border py-3 text-lg font-black ${shift ? "border-orange-500 bg-orange-500/20 text-orange-300" : "border-zinc-800 bg-black text-zinc-300"}`}>
                    ⇧
                  </button>
                )}
                {row.split("").map((key) => (
                  <button key={key} onClick={() => pressLetter(key)} className="w-[9%] max-w-16 rounded-xl border border-zinc-800 bg-black py-3 text-xl font-black text-white active:bg-zinc-800">
                    {shift ? key.toUpperCase() : key}
                  </button>
                ))}
                {i === 3 && (
                  <>
                    <button onClick={() => setAccent((v) => !v)} className={`w-12 rounded-xl border py-3 text-xl font-black ${accent ? "border-orange-500 bg-orange-500/20 text-orange-300" : "border-zinc-800 bg-black text-zinc-300"}`} title="Acento: luego toca la vocal">
                      ´
                    </button>
                    <button onClick={() => apply(draft.slice(0, -1))} className="w-16 rounded-xl border border-zinc-800 bg-black py-3 text-xl font-black text-zinc-300">
                      ⌫
                    </button>
                  </>
                )}
              </div>
            ))}
            <div className="flex justify-center gap-1.5">
              {[",", ".", "@", "-", "#"].map((key) => (
                <button key={key} onClick={() => apply(draft + key)} className="w-12 rounded-xl border border-zinc-800 bg-black py-3 text-xl font-black text-white">
                  {key}
                </button>
              ))}
              <button onClick={() => apply(draft + " ")} className="flex-1 rounded-xl border border-zinc-800 bg-black py-3 font-black text-zinc-400">
                espacio
              </button>
              {field instanceof HTMLTextAreaElement && (
                <button onClick={() => apply(draft + "\n")} className="w-20 rounded-xl border border-zinc-800 bg-black py-3 font-black text-zinc-300">
                  ↵
                </button>
              )}
              <button onClick={() => apply("")} className="w-20 rounded-xl border border-zinc-800 bg-black py-3 text-sm font-black text-zinc-400">
                Borrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
