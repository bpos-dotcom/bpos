"use client";
/**
 * Pantallas animadas de cada servicio de B-POS por separado (página
 * /servicios). Igual que la demo guiada: escenas cortas en bucle con datos
 * de un restaurante de ejemplo ("Taquería La Esquina"); nada real.
 */
import { Finger, Phone, Window, pop, slide, useScene } from "@/components/demo/DemoScreens";
import type { ServiceId } from "@/lib/services";

function Line({ l, r, strong, tone }: { l: string; r: string; strong?: boolean; tone?: "green" | "orange" | "red" }) {
  const color = tone === "green" ? "text-green-300" : tone === "orange" ? "text-orange-300" : tone === "red" ? "text-red-300" : "";
  return (
    <div className={`flex justify-between gap-2 ${strong ? "font-black" : ""} ${color}`}>
      <span>{l}</span>
      <span className="font-bold">{r}</span>
    </div>
  );
}

// ------------------------------------------------------------ lealtad

function LoyaltyScreen() {
  // 0: busca · 1: cliente encontrado · 2: monto · 3: toca sumar · 4: sello · 5: aviso
  const phase = useScene(6);
  const stamps = phase >= 4 ? 5 : 4;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Window title="Lealtad · Caja" badge={phase >= 4 ? "+1 sello ✓" : undefined} badgeTone="green">
        <div className="space-y-2 text-xs">
          <div className="rounded-xl border border-zinc-800 bg-black px-3 py-2 text-zinc-300">📞 55 1234 {phase >= 1 ? "5678" : "56"}</div>
          {phase >= 1 && (
            <div className={`rounded-xl border border-orange-500/50 bg-orange-500/10 px-3 py-2 ${slide}`}>
              <p className="font-black">Ana López</p>
              <p className="text-zinc-400">{stamps} de 6 sellos · socia desde marzo</p>
            </div>
          )}
          {phase >= 2 && (
            <div className={`rounded-xl border border-zinc-800 bg-black px-3 py-2 ${slide}`}>
              <Line l="Pagó" r="$154" strong />
            </div>
          )}
          <div className={`relative rounded-xl py-2 text-center font-black text-black transition-all duration-300 ${phase >= 4 ? "bg-green-500" : phase === 3 ? "scale-95 bg-orange-400" : "bg-orange-500"}`}>
            {phase >= 4 ? "Compra sumada ✓" : "Sumar compra"}
            {phase === 3 && <Finger />}
          </div>
        </div>
      </Window>
      <Phone title="Google Wallet">
        <div className="rounded-2xl bg-orange-500 p-3 text-[11px] text-black">
          <p className="font-black">Club La Esquina</p>
          <p className="mt-1 text-[9px] font-bold uppercase opacity-70">Sellos</p>
          <p key={stamps} className={`font-black ${phase === 4 ? pop : ""}`}>{stamps} de 6</p>
          <div className="mt-2 flex gap-1">
            {Array.from({ length: 6 }, (_, i) => (
              <span key={i} className={`h-3 flex-1 rounded-full transition-colors duration-500 ${i < stamps ? "bg-black" : "bg-black/20"}`} />
            ))}
          </div>
          <div className="mt-2 flex h-12 items-center justify-center rounded-lg bg-white">
            <span className="flex h-8 w-8 items-center justify-center rounded bg-black text-[8px] text-white">QR</span>
          </div>
        </div>
        <div className="mt-2 min-h-[2.6rem]">
          {phase >= 5 && <p className={`rounded-lg border border-orange-500/60 bg-black px-2 py-1.5 text-[10px] text-zinc-200 ${slide}`}>🔔 ¡Sumaste 1 sello! Te falta 1 para tus tacos gratis.</p>}
        </div>
      </Phone>
    </div>
  );
}

// ------------------------------------------------------------ menú digital

const MENU = [
  ["🌮", "Orden de pastor", 85],
  ["🌯", "Gringa", 55],
  ["🥤", "Horchata", 25],
] as const;

function MenuScreen() {
  // 0: menú · 1-2: agrega · 3: toca pedir · 4: pagado · 5: llega al negocio · 6: pausa
  const phase = useScene(7);
  const added = phase >= 2 ? 2 : phase >= 1 ? 1 : 0;
  const total = MENU.slice(0, added).reduce((s, [, , p]) => s + p, 0);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Phone title="Menú digital · QR">
        <div className="rounded-2xl bg-white p-2.5 text-[11px] text-zinc-900">
          <p className="font-black">Taquería La Esquina</p>
          <p className="text-[10px] text-zinc-500">Abierto · recoger o domicilio</p>
          <div className="mt-2 space-y-1.5">
            {MENU.map(([icon, name, price], i) => (
              <div key={name} className={`relative flex items-center justify-between rounded-lg border px-2 py-1 transition-colors ${i < added ? "border-orange-400 bg-orange-50" : "border-zinc-200"}`}>
                <span>
                  {icon} {name}
                </span>
                <span className="font-black">${price}</span>
                {phase === i + 1 && i < 2 && <Finger />}
              </div>
            ))}
          </div>
          <div className={`relative mt-2 rounded-lg py-1.5 text-center font-black text-white transition-all duration-300 ${phase >= 4 ? "bg-green-600" : phase === 3 ? "scale-95 bg-orange-400" : "bg-orange-500"}`}>
            {phase >= 4 ? "Pagado con Mercado Pago ✓" : `Pedir y pagar · $${total}`}
            {phase === 3 && <Finger />}
          </div>
        </div>
      </Phone>
      <Window title="Pedidos en línea" badge={phase >= 5 ? "Nuevo pedido" : undefined}>
        <div className="space-y-2 text-xs">
          {phase >= 5 ? (
            <div className={`rounded-xl border border-orange-500/60 bg-orange-500/10 p-3 ${slide}`}>
              <Line l="#W-218 · Para recoger" r="$140" strong />
              <p className="mt-1 text-zinc-400">1 Orden de pastor · 1 Gringa</p>
              <p className="mt-1 font-bold text-green-300">Pagado en línea · sin comisión</p>
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-zinc-800 p-3 text-center text-zinc-500">Esperando pedidos...</p>
          )}
          <div className="rounded-xl border border-zinc-800 bg-black p-3 text-zinc-400">
            <Line l="Pedidos de hoy" r={phase >= 5 ? "13" : "12"} />
            <Line l="Comisión pagada" r="$0" tone="green" />
          </div>
        </div>
      </Window>
    </div>
  );
}

// ------------------------------------------------------------ kiosco

function KioskScreen() {
  // 0: menú · 1: toca combo · 2: toca pagar · 3: acerca tarjeta · 4: aprobado · 5: ticket
  const phase = useScene(6);
  return (
    <Window title="Kiosco · Mostrador" badge={phase >= 4 ? "Aprobado ✓" : "Toca para pedir"} badgeTone={phase >= 4 ? "green" : "orange"}>
      <div className="grid grid-cols-[1.3fr_1fr] gap-3 text-xs">
        <div className="grid grid-cols-2 gap-2">
          {[
            ["🌮", "Combo pastor", 119],
            ["🌯", "Gringa", 55],
            ["🧀", "Queso fundido", 70],
            ["🥤", "Horchata", 25],
          ].map(([icon, name, price], i) => (
            <div key={name} className={`relative rounded-2xl border bg-black p-3 transition-all duration-300 ${phase === 1 && i === 0 ? "scale-95 border-orange-500 bg-orange-500/10" : phase >= 1 && i === 0 ? "border-orange-500" : "border-zinc-800"}`}>
              <p className="text-3xl">{icon}</p>
              <p className="mt-1 font-black">{name}</p>
              <p className="font-bold text-orange-400">${price}</p>
              {phase === 1 && i === 0 && <Finger />}
            </div>
          ))}
        </div>
        <div className="flex flex-col rounded-2xl border border-zinc-800 bg-black p-3">
          <p className="font-black text-zinc-400">Tu pedido</p>
          <div className="mt-2 flex-1">{phase >= 1 && <div className={slide}><Line l="1 × Combo pastor" r="$119" /></div>}</div>
          {phase <= 2 && (
            <div className={`relative rounded-xl py-2 text-center font-black text-black transition-all duration-300 ${phase === 2 ? "scale-95 bg-orange-400" : "bg-orange-500"}`}>
              Pagar {phase >= 1 ? "$119" : ""}
              {phase === 2 && <Finger />}
            </div>
          )}
          {phase === 3 && <p className={`rounded-xl border border-sky-500/60 bg-sky-500/10 py-2 text-center font-black text-sky-200 ${pop}`}>💳 Acerca tu tarjeta a la terminal</p>}
          {phase >= 4 && (
            <div className={`rounded-xl bg-green-500 py-2 text-center font-black text-black ${pop}`}>
              ¡Listo! Ticket #58
              {phase >= 5 && <p className="text-[10px] font-bold">🧾 Toma tu ticket</p>}
            </div>
          )}
        </div>
      </div>
    </Window>
  );
}

// ------------------------------------------------------------ asesor

function AdvisorScreen() {
  // 0: vacío · 1-2: suben archivos · 3: analizando · 4: resumen · 5: alerta · 6: consejo · 7: pausa
  const phase = useScene(8, 1200);
  return (
    <Window title="Asesor con IA" badge={phase === 3 ? "Analizando..." : phase >= 4 ? "Listo" : undefined} badgeTone={phase >= 4 ? "green" : "orange"}>
      <div className="space-y-2 text-xs">
        <div className="flex flex-wrap gap-2">
          {phase < 1 && <span className="rounded-xl border border-dashed border-zinc-700 px-3 py-2 text-zinc-500">📥 Arrastra tus reportes aquí</span>}
          {phase >= 1 && <span className={`rounded-xl border border-zinc-700 bg-black px-3 py-2 font-bold ${pop}`}>📊 ventas_didi_octubre.xlsx</span>}
          {phase >= 2 && <span className={`rounded-xl border border-zinc-700 bg-black px-3 py-2 font-bold ${pop}`}>📊 pedidos_uber.csv</span>}
        </div>
        {phase === 3 && <p className={`rounded-xl border border-zinc-800 bg-black p-3 text-zinc-400 ${pop}`}>🤖 Leyendo 2 reportes, 1,284 renglones...</p>}
        {phase >= 4 && (
          <div className={`rounded-xl border border-zinc-800 bg-black p-3 text-zinc-300 ${slide}`}>
            <p className="font-black text-white">Resumen</p>
            <p className="mt-1">En octubre vendiste $86,420 en apps con 642 pedidos (ticket de $135). Lo más vendido: Orden de pastor.</p>
          </div>
        )}
        {phase >= 5 && (
          <div className={`rounded-xl border border-red-500/50 bg-red-500/10 p-3 ${slide}`}>
            <p className="font-black text-red-200">⚠️ Martes flojos</p>
            <p className="mt-1 text-zinc-300">Los martes vendes 40% menos que el promedio.</p>
          </div>
        )}
        {phase >= 6 && (
          <div className={`rounded-xl border border-green-500/50 bg-green-500/10 p-3 ${slide}`}>
            <p className="font-black text-green-200">💡 Promo de martes</p>
            <p className="mt-1 text-zinc-300">Lanza un 2×1 en horchatas solo en Uber los martes de 5 a 8 p.m.</p>
          </div>
        )}
      </div>
    </Window>
  );
}

// ------------------------------------------------------------ food cost

const RECIPE = [
  ["🍞 Pan", "$6.00"],
  ["🥩 Carne · 150 g", "$33.00"],
  ["🧀 Queso", "$4.50"],
  ["📦 Caja", "$2.80"],
] as const;

function FoodCostScreen() {
  // 0-3: ingredientes · 4: costo y food cost · 5: precio en DiDi · 6-7: pausa
  const phase = useScene(8, 1100);
  const shown = Math.min(phase + 1, 4);
  return (
    <Window title="Food cost · Hamburguesa sencilla" badge={phase >= 4 ? "Food cost 30.9%" : `Paso ${Math.min(phase + 2, 4)} de 5`} badgeTone={phase >= 4 ? "green" : "orange"}>
      <div className="grid gap-3 text-xs sm:grid-cols-2">
        <div className="space-y-1.5 rounded-2xl border border-zinc-800 bg-black p-3">
          <p className="font-black text-zinc-400">¿Qué lleva?</p>
          {RECIPE.slice(0, shown).map(([l, r]) => (
            <div key={l} className={slide}>
              <Line l={l} r={r} />
            </div>
          ))}
          {phase >= 4 && (
            <div className={`border-t border-zinc-800 pt-1.5 ${slide}`}>
              <Line l="Te cuesta" r="$46.30" strong />
            </div>
          )}
        </div>
        <div className="space-y-2">
          {phase >= 4 ? (
            <div className={`rounded-2xl border border-green-500/50 bg-green-500/10 p-3 ${slide}`}>
              <Line l="Precio en tu local" r="$150" strong />
              <Line l="Ganas por platillo" r="$103.70" tone="green" />
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-zinc-800 p-3 text-center text-zinc-500">Calculando...</p>
          )}
          {phase >= 5 && (
            <div className={`rounded-2xl border border-orange-500/60 bg-orange-500/10 p-3 ${slide}`}>
              <p className="font-black text-orange-200">🛵 DiDi Food</p>
              <p className="mt-1 text-zinc-300">Comisión 30% + impuestos 18%</p>
              <Line l="Publícalo en" r="$262" strong />
              <p className="text-zinc-400">y recibes ≈ $150, igual que en tu local.</p>
            </div>
          )}
        </div>
      </div>
    </Window>
  );
}

// ------------------------------------------------------------ checador

const TEAM = [
  ["Luis", "8:58 a.m.", "6 h 12 min"],
  ["María", "9:04 a.m.", "6 h 05 min"],
  ["Jorge", "—", "Descanso"],
] as const;

function ClockScreen() {
  // 0-3: PIN · 4: entrada registrada · 5-6: pausa
  const phase = useScene(7, 1000);
  const digits = Math.min(phase + 1, 4);
  const done = phase >= 4;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Phone title="Checador · tablet del negocio">
        <div className="rounded-2xl bg-black p-3 text-center text-xs">
          <p className="font-black">{done ? "¡Buenos días, Ana!" : "Escribe tu PIN"}</p>
          <div className="my-3 flex justify-center gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <span key={i} className={`h-3 w-3 rounded-full transition-colors ${done ? "bg-green-500" : i < digits ? "bg-orange-500" : "bg-zinc-700"}`} />
            ))}
          </div>
          {done ? (
            <p className={`rounded-xl bg-green-500 py-2 font-black text-black ${pop}`}>✓ Entrada · 9:12 a.m.</p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <span key={n} className={`rounded-lg border py-1.5 font-black transition-colors ${n === [3, 7, 1, 9][phase] ? "border-orange-500 bg-orange-500/20" : "border-zinc-800"}`}>
                  {n}
                </span>
              ))}
            </div>
          )}
        </div>
      </Phone>
      <Window title="Asistencia · Hoy" badge={done ? "Ana entró" : undefined} badgeTone="green">
        <div className="space-y-1.5 text-xs">
          {done && (
            <div className={`rounded-xl border border-green-500/50 bg-green-500/10 px-3 py-2 ${slide}`}>
              <Line l="Ana · 9:12 a.m." r="Trabajando" tone="green" />
            </div>
          )}
          {TEAM.map(([name, at, hours]) => (
            <div key={name} className="rounded-xl border border-zinc-800 bg-black px-3 py-2">
              <Line l={`${name} · ${at}`} r={hours} />
            </div>
          ))}
          <p className="pt-1 text-center text-zinc-500">📊 Exportar horas a Excel</p>
        </div>
      </Window>
    </div>
  );
}

export const SERVICE_SCREENS: Record<ServiceId, () => React.ReactNode> = {
  lealtad: LoyaltyScreen,
  menu: MenuScreen,
  kiosco: KioskScreen,
  asesor: AdvisorScreen,
  foodcost: FoodCostScreen,
  checador: ClockScreen,
};
