"use client";
/**
 * Ayuda: primeros pasos (se palomean solos según lo que el negocio ya
 * configuró) y preguntas frecuentes. Para negocios nuevos y para
 * capacitar a quien entra a trabajar.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { getAdminProducts } from "@/lib/admin";
import { listAgents } from "@/lib/agent/client";
import { getBusinessSettings } from "@/lib/business-settings";
import { getDigitalMenu } from "@/lib/digital-menu";
import { isCloudConfigured } from "@/lib/supabase/client";
import { getTables } from "@/lib/tables";
import { getUsers } from "@/lib/users";

type Step = { key: string; title: string; detail: string; href: string; done: boolean; optional?: boolean };

function readSteps(agentOnline: boolean | null): Step[] {
  const s = getBusinessSettings();
  const printers = (() => {
    try {
      return JSON.parse(localStorage.getItem("bpos_station_printers") || "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  const users = getUsers().filter((u) => u.active);
  return [
    { key: "empresa", title: "Datos del negocio", detail: "Nombre, dirección, teléfono y logo para tickets y menú digital.", href: "/configuracion/empresa", done: Boolean(s.businessName && s.address) },
    { key: "productos", title: "Tus productos", detail: "Da de alta tu menú con precios y estación de cocina. Puedes subir la foto de tu menú y la IA los registra (plan Max).", href: "/configuracion/productos", done: getAdminProducts().length > 0 },
    { key: "usuarios", title: "Tu equipo", detail: "Un usuario con PIN para cada cajero, cocinero o mesero. Así todo queda a nombre de quien lo hizo.", href: "/configuracion/usuarios", done: users.length > 1 },
    { key: "agent", title: "B-POS Agent en la computadora de las impresoras", detail: "Se descarga en Configuración → Sistema. Imprime comandas y tickets, abre el cajón y lee los pedidos de delivery.", href: "/configuracion/sistema", done: agentOnline === true },
    { key: "impresoras", title: "Impresoras por estación", detail: "Elige qué impresora es Caja, Cocina, Barra… y cuándo se abre el cajón.", href: "/configuracion/impresoras", done: typeof printers.Caja === "string" && printers.Caja !== "" },
    { key: "caja", title: "Abre la caja y cobra tu primera venta", detail: "Fondo inicial en Caja, luego cobra en el POS. Al final del día haces el corte.", href: "/caja", done: Boolean(localStorage.getItem("bpos_active_shift")) || (localStorage.getItem("bpos_orders") || "[]") !== "[]" },
    { key: "menu", title: "Menú digital", detail: "Tu liga para que los clientes pidan sin comisión, con QR para las mesas.", href: "/configuracion/menu-digital", done: Boolean(getDigitalMenu().slug), optional: true },
    { key: "mesas", title: "Mesas y meseros", detail: "Si das servicio en mesa: da de alta tus mesas y vincula los celulares de los meseros.", href: "/configuracion/mesas", done: getTables().length > 0, optional: true },
  ];
}

const FAQ: { q: string; a: string; href?: string }[] = [
  { q: "No sale la comanda o el ticket", a: "Revisa que la computadora de las impresoras esté prendida con B-POS Agent abierto (Configuración → Sistema debe decir conectado) y que cada estación tenga impresora en Configuración → Impresoras. Puedes reimprimir desde Historial de pedidos (botón Imprimir).", href: "/configuracion/impresoras" },
  { q: "El cajón no abre", a: "El cajón va conectado con cable a la impresora de Caja. En Configuración → Impresoras → Cajón de dinero eliges cuándo abre (al abrir el cobro o al confirmar), con qué formas de pago y para qué tipos de pedido. En el cobro en efectivo también hay botón “Abrir cajón”.", href: "/configuracion/impresoras" },
  { q: "¿Cómo cancelo una venta?", a: "En Historial de pedidos, en la venta, “Cancelar”. Pide el motivo y, según tus permisos, el PIN de un administrador. Queda en la bitácora y le avisa al dueño.", href: "/historial" },
  { q: "¿Cómo hago el corte de caja?", a: "En Caja cuenta el efectivo, escribe lo contado y “Cerrar turno”. El corte llega al correo y/o WhatsApp del dueño, con ventas por método y canal, movimientos y horas del personal.", href: "/caja" },
  { q: "Llegó un pedido de Uber, DiDi o Rappi y no aparece", a: "El Bridge lo lee de la impresora virtual de B-POS Agent. Si una línea no tiene equivalencia, el menú te avisa y la relacionas en B-POS Bridge con su producto; desde ahí se vuelve venta sola.", href: "/bridge" },
  { q: "¿Cómo registro algo que se tiró?", a: "En Inventario, ajuste con tipo “Merma” y el motivo (caducó, se cayó…). Abajo ves cuánto costó lo tirado en los últimos 30 días.", href: "/inventario" },
  { q: "¿Cómo veo mis ventas desde el celular?", a: "Instala la App del dueño: abre bpos.com.mx/dueno en Chrome y toca “Instalar app”. Te avisa de ventas grandes, cancelaciones, cortes y alertas.", href: "/dueno" },
  { q: "Un empleado se fue, ¿cómo le quito el acceso?", a: "En Configuración → Usuarios márcalo como Inactivo. Si era mesero con celular vinculado, desvincula el celular en Configuración → Meseros.", href: "/configuracion/usuarios" },
  { q: "¿Y si se va el internet?", a: "B-POS trabaja en la nube: sin internet no se puede cobrar en el sistema. Anota las ventas a mano y captúralas al regresar. Estamos trabajando en un modo sin internet.", },
  { q: "¿Mis datos están respaldados?", a: "Sí. Todo vive en la nube y además B-POS guarda un respaldo diario (se conservan 7 días) y uno semanal (8 semanas). En Configuración → Respaldos puedes descargarlos.", href: "/configuracion/respaldos" },
];

export default function AyudaPage() {
  const [steps, setSteps] = useState<Step[]>([]);
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isCloudConfigured) return;
    listAgents()
      .then((list) => setAgentOnline(list.some((a) => a.online && !a.kiosk_id)))
      .catch(() => setAgentOnline(false));
  }, []);
  useEffect(() => {
    setSteps(readSteps(agentOnline));
  }, [agentOnline]);

  const required = steps.filter((s) => !s.optional);
  const done = required.filter((s) => s.done).length;

  return (
    <AppShell title="Ayuda" subtitle="Primeros pasos y respuestas rápidas.">
      <div className="max-w-3xl space-y-6">
        <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-black text-orange-500">Primeros pasos</h2>
            <span className="rounded-xl bg-black px-3 py-1 text-sm font-black">
              {done} de {required.length}
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full bg-orange-500 transition-all" style={{ width: `${required.length ? (done / required.length) * 100 : 0}%` }} />
          </div>
          <ol className="mt-5 space-y-3">
            {steps.map((s, i) => (
              <li key={s.key}>
                <Link href={s.href} className={`flex items-start gap-4 rounded-2xl border p-4 ${s.done ? "border-green-500/30 bg-green-500/5" : "border-zinc-800 bg-black hover:border-orange-500"}`}>
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black ${s.done ? "bg-green-500 text-black" : "bg-zinc-800 text-zinc-300"}`}>{s.done ? "✓" : i + 1}</span>
                  <span>
                    <span className="font-black">
                      {s.title}
                      {s.optional && <span className="ml-2 text-xs font-bold text-zinc-500">(si aplica)</span>}
                    </span>
                    <span className="mt-1 block text-sm text-zinc-400">{s.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>

        <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
          <h2 className="text-xl font-black text-orange-500">Preguntas frecuentes</h2>
          <div className="mt-4 space-y-2">
            {FAQ.map((f) => (
              <details key={f.q} className="rounded-2xl border border-zinc-800 bg-black p-4">
                <summary className="cursor-pointer font-black">{f.q}</summary>
                <p className="mt-2 text-sm text-zinc-300">{f.a}</p>
                {f.href && (
                  <Link href={f.href} className="mt-2 inline-block text-sm font-black text-orange-400">
                    Ir ahí →
                  </Link>
                )}
              </details>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-400">
          <h2 className="text-xl font-black text-orange-500">¿Necesitas ayuda?</h2>
          <p className="mt-2">
            Escríbenos a{" "}
            <a href="mailto:soporte@bpos.com.mx" className="font-black text-orange-400">
              soporte@bpos.com.mx
            </a>
            . Cuéntanos qué pasó y, si puedes, manda una foto de la pantalla.
          </p>
          <p className="mt-3 text-xs text-zinc-600">
            <Link href="/terminos" className="underline">Términos y condiciones</Link> · <Link href="/privacidad" className="underline">Aviso de privacidad</Link>
          </p>
        </section>
      </div>
    </AppShell>
  );
}

