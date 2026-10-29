"use client";
/** Configuración → Punto de venta: ajustes de esta caja (no se sincronizan). */
import { useEffect, useState } from "react";
import RequireRole from "@/components/auth/RequireRole";
import { AppShell } from "@/components/layout/AppShell";
import { setTouchKeypad, touchKeypadEnabled } from "@/lib/device-settings";

export default function PosSettingsPage() {
  const [touch, setTouch] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ajuste del navegador: solo después de montar
    setTouch(touchKeypadEnabled());
  }, []);

  return (
    <RequireRole allow={["Admin"]}>
      <AppShell title="Punto de venta" subtitle="Ajustes de esta computadora o tablet. Cada caja tiene los suyos.">
        <section className="max-w-2xl rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
          <label className="flex cursor-pointer items-start gap-4">
            <input
              type="checkbox"
              checked={touch}
              onChange={(event) => {
                setTouch(event.target.checked);
                setTouchKeypad(event.target.checked);
              }}
              className="mt-1 h-6 w-6 accent-orange-500"
            />
            <span>
              <span className="block text-lg font-black">🖐️ Pantalla táctil</span>
              <span className="mt-1 block text-sm text-zinc-400">
                Al tocar cualquier campo aparece un teclado grande en pantalla: numérico en cantidades (efectivo recibido, descuento, precios...) con botones rápidos de
                billetes al cobrar, y con letras en textos (nombre del cliente, comentarios, búsquedas). Apágalo si en esta caja usas teclado y mouse.
              </span>
            </span>
          </label>
        </section>
      </AppShell>
    </RequireRole>
  );
}
