"use client";
/**
 * Bloque 12 · App del dueño.
 * Ventas de todas las sucursales en tiempo real, utilidad, productos top,
 * alertas críticas y notificaciones. Pensada para el celular: se instala
 * como app (ver app/manifest.ts).
 */
import Link from "next/link";
import { ThemeToggle } from "@/components/layout/TopCorner";
import { Advisor } from "@/components/owner/Advisor";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RequirePermission from "@/components/auth/RequirePermission";
import { canViewCosts, getCurrentUser } from "@/lib/auth";
import { getOperationsAlerts, type OperationsAlert } from "@/lib/notifications/operationsCenter";
import {
  canPromptInstall,
  disableNotifications,
  enableNotifications,
  isInstalled,
  isIOS,
  notificationsEnabled,
  notificationsSupported,
  notifyOwner,
  onInstallAvailable,
  promptInstall,
  setupOwnerApp,
} from "@/lib/owner-app";
import { disablePush, enablePush, getPushPrefs, pushEnabled, pushSupported, savePushPrefs, sendTestPush } from "@/lib/push/client";
import { DEFAULT_PUSH_PREFS, type PushPrefs } from "@/lib/push/rules";
import {
  buildReport,
  loadCloudOrders,
  loadReportSources,
  presetRange,
  salesByBranch,
  type ReportOrder,
  type Row,
} from "@/lib/reports";

type Preset = "hoy" | "ayer" | "7d" | "mes";
type BranchOrder = { branchId: string; branchName: string; order: ReportOrder };
type Data = { cloud: boolean; branches: { id: string; name: string }[]; orders: BranchOrder[] };

const PRESETS: [Preset, string][] = [["hoy", "Hoy"], ["ayer", "Ayer"], ["7d", "7 días"], ["mes", "Este mes"]];
const REFRESH_MS = 30_000;
const ALERT_PRIORITIES = new Set(["critical", "warning", "delivery"]);

const money = (n: number) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const orderKey = (o: BranchOrder) => `${o.branchId}:${o.order.id}`;

export default function OwnerPage() {
  return (
    <RequirePermission permission="owner.view">
      <OwnerApp />
    </RequirePermission>
  );
}

function OwnerApp() {
  const [preset, setPreset] = useState<Preset>("hoy");
  const [tab, setTab] = useState<"resumen" | "asesor">("resumen");
  const [branch, setBranch] = useState("all");
  const [data, setData] = useState<Data | null>(null);
  const [alerts, setAlerts] = useState<OperationsAlert[]>([]);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [showCosts, setShowCosts] = useState(false);
  const [notify, setNotify] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [prefs, setPrefs] = useState<PushPrefs>(DEFAULT_PUSH_PREFS);
  const [pushError, setPushError] = useState("");
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState("");
  const [canInstall, setCanInstall] = useState(false);
  const [installed, setInstalled] = useState(true);
  const [ios, setIos] = useState(false);
  const seenOrders = useRef<Set<string> | null>(null);
  const seenAlerts = useRef<Set<string> | null>(null);

  // Siempre se piden los pedidos del mes (o desde ayer, si el mes acaba de empezar):
  // así cambiar de periodo es instantáneo y se detectan ventas nuevas de hoy.
  const since = useMemo(() => {
    const month = presetRange("mes").from;
    const yesterday = presetRange("ayer").from;
    const week = presetRange("7d").from;
    return new Date(Math.min(month.getTime(), yesterday.getTime(), week.getTime()));
  }, []);

  const load = useCallback(async () => {
    try {
      const cloud = await loadCloudOrders(since);
      const next: Data = cloud
        ? { cloud: true, ...cloud }
        : {
            cloud: false,
            branches: [{ id: "local", name: "Esta sucursal" }],
            orders: loadReportSources().orders.map((order) => ({ branchId: "local", branchName: "Esta sucursal", order })),
          };
      setData(next);
      setError("");
      setUpdatedAt(new Date());
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo consultar la nube.");
      return null;
    }
  }, [since]);

  const loadAlerts = useCallback(() => {
    const list = getOperationsAlerts().filter((a) => a.status !== "resolved" && ALERT_PRIORITIES.has(a.priority));
    setAlerts(list);
    return list;
  }, []);

  // Avisa de ventas y alertas nuevas desde la última revisión
  const checkNews = useCallback((next: Data | null, list: OperationsAlert[]) => {
    if (next) {
      const today = presetRange("hoy");
      const todays = next.orders.filter(({ order }) => new Date(order.createdAt) >= today.from);
      const ids = new Set(todays.map(orderKey));
      // Con avisos push, las ventas ya llegan desde la nube (no repetir aquí)
      if (seenOrders.current && notificationsEnabled() && !pushEnabled()) {
        const fresh = todays.filter((o) => !seenOrders.current!.has(orderKey(o)));
        if (fresh.length > 0) {
          const total = fresh.reduce((s, o) => s + (Number(o.order.total) || 0), 0);
          const where = [...new Set(fresh.map((o) => o.branchName))].join(", ");
          notifyOwner({
            title: fresh.length === 1 ? `Venta nueva · ${money(total)}` : `${fresh.length} ventas nuevas · ${money(total)}`,
            body: where,
            tag: "bpos-ventas",
          });
        }
      }
      seenOrders.current = ids;
    }
    const alertIds = new Set(list.map((a) => a.id));
    if (seenAlerts.current && notificationsEnabled()) {
      list
        .filter((a) => a.priority === "critical" && !seenAlerts.current!.has(a.id))
        .forEach((a) => notifyOwner({ title: `🚨 ${a.title}`, body: a.message, tag: a.id, url: a.moduleHref || "/centro-operaciones" }));
    }
    seenAlerts.current = alertIds;
  }, []);

  useEffect(() => {
    setupOwnerApp();
    // Datos del navegador: solo existen después de montar (en el servidor no hay window)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowCosts(canViewCosts(getCurrentUser().role));
    setNotify(notificationsEnabled());
    setPushOn(pushEnabled());
    setPrefs(getPushPrefs());
    setInstalled(isInstalled());
    setIos(isIOS());
    setCanInstall(canPromptInstall());
    const offInstall = onInstallAvailable(() => {
      setCanInstall(canPromptInstall());
      setInstalled(isInstalled());
    });

    let alive = true;
    const refresh = async () => {
      const next = await load();
      const list = loadAlerts();
      if (alive) checkNews(next, list);
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    const clock = setInterval(() => setNow(Date.now()), 5_000);
    const onLocal = () => refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    window.addEventListener("bpos:orders-updated", onLocal);
    window.addEventListener("bpos:operations-alerts-updated", onLocal);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      offInstall();
      clearInterval(timer);
      clearInterval(clock);
      window.removeEventListener("bpos:orders-updated", onLocal);
      window.removeEventListener("bpos:operations-alerts-updated", onLocal);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, loadAlerts, checkNews]);

  const range = useMemo(() => presetRange(preset), [preset]);

  const view = useMemo(() => {
    if (!data) return null;
    const selected = branch === "all" ? data.orders : data.orders.filter((o) => o.branchId === branch);
    const report = buildReport({ ...loadReportSources(), orders: selected.map((o) => o.order) }, range);
    const branches = salesByBranch(data.branches, data.orders, range);
    const byTime = preset === "hoy" || preset === "ayer" ? trimHours(report.byHour) : report.byDay;
    return { report, branches, byTime };
  }, [data, branch, range, preset]);

  async function toggleNotifications() {
    if (busy) return;
    setBusy(true);
    try {
      if (notify) {
        disableNotifications();
        await disablePush();
        setNotify(false);
        setPushOn(false);
        return;
      }
      const ok = await enableNotifications();
      setNotify(ok);
      if (!ok) {
        alert("No se activaron. Revisa que el navegador tenga permiso de notificaciones para B-POS.");
        return;
      }
      await activatePush();
    } finally {
      setBusy(false);
    }
  }

  // Avisos aunque la app esté cerrada (registra este celular en la nube)
  const activatePush = useCallback(async () => {
    const error = pushSupported()
      ? await enablePush(getPushPrefs()).catch((e: Error) => e.message || "No se pudo activar.")
      : "Este navegador no permite avisos con la app cerrada.";
    setPushError(error);
    setPushOn(!error);
    return error;
  }, []);

  // Con las notificaciones ya permitidas, vuelve a registrar este celular en la nube
  // (por si no quedó la primera vez o el navegador cambió la suscripción)
  useEffect(() => {
    if (!notificationsEnabled() || !pushSupported()) return;
    const timer = window.setTimeout(() => void activatePush(), 1500);
    return () => window.clearTimeout(timer);
  }, [activatePush]);

  async function testPush() {
    setTestResult("Mandando...");
    const error = await sendTestPush();
    setTestResult(error ? `❌ ${error}` : "✅ Enviado. Debe llegarte en unos segundos.");
  }

  function changePrefs(patch: Partial<PushPrefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    void savePushPrefs(next).catch(() => {});
  }

  const seconds = updatedAt ? Math.max(0, Math.round((now - updatedAt.getTime()) / 1000)) : null;
  const kpis = view?.report.kpis;

  return (
    <main className="min-h-screen bg-black pb-10 text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-black/90 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- logo fijo */}
<img src="/bpos-logo.png" alt="B-POS" className="h-10 w-10 shrink-0 object-contain" />
            <div>
              <p className="text-xs font-bold text-orange-500">App del dueño</p>
              <p className="text-xs text-zinc-500">
                <span className={`mr-1 inline-block h-2 w-2 rounded-full ${error ? "bg-red-500" : "bg-green-500"}`} />
                {error ? "Sin conexión" : seconds === null ? "Cargando..." : seconds < 10 ? "En vivo" : `Actualizado hace ${seconds} s`}
                {data && !data.cloud && " · solo esta caja"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle className="px-2 py-2 text-xs" />
            <Link href="/" className="rounded-xl border border-zinc-800 px-3 py-2 text-xs font-black text-zinc-300">
              B-POS completo
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
        {!installed && (canInstall || ios) && (
          <section className="rounded-3xl border border-orange-500/50 bg-orange-500/10 p-4">
            <p className="font-black">📲 Instala la App del dueño</p>
            {canInstall ? (
              <>
                <p className="mt-1 text-xs text-zinc-400">Ábrela como app desde tu pantalla de inicio y recibe avisos.</p>
                <button onClick={() => promptInstall().then(() => setInstalled(isInstalled()))} className="mt-3 w-full rounded-2xl bg-orange-500 px-4 py-3 text-sm font-black text-black">
                  Instalar en este dispositivo
                </button>
              </>
            ) : (
              <p className="mt-1 text-xs text-zinc-300">
                En iPhone: abre esta página en <b>Safari</b>, toca <b>Compartir</b> (el cuadrito con la flecha ⬆️) y luego <b>Agregar a pantalla de inicio</b>.
              </p>
            )}
          </section>
        )}
        <Chips items={[["resumen", "📊 Resumen"], ["asesor", "✨ Asesor IA"]] as ["resumen" | "asesor", string][]} value={tab} onChange={setTab} />
        {tab === "resumen" && <Chips items={PRESETS} value={preset} onChange={setPreset} />}
        {data && data.branches.length > 1 && (
          <Chips items={[["all", "Todas"], ...data.branches.map((b) => [b.id, b.name] as [string, string])]} value={branch} onChange={setBranch} />
        )}

        {error && <p className="rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}

        {tab === "asesor" ? (
          data ? (
            <Advisor
              orders={(branch === "all" ? data.orders : data.orders.filter((o) => o.branchId === branch)).map((o) => o.order)}
              branchLabel={branch === "all" ? (data.branches.length > 1 ? "Todas las sucursales" : data.branches[0]?.name || "Tu negocio") : data.branches.find((b) => b.id === branch)?.name || "Sucursal"}
            />
          ) : (
            <p className="py-16 text-center text-zinc-500">Cargando tus números...</p>
          )
        ) : !view || !kpis ? (
          <p className="py-16 text-center text-zinc-500">Cargando ventas...</p>
        ) : (
          <>
            <section className="rounded-3xl border border-orange-500/40 bg-gradient-to-br from-orange-500/15 to-zinc-950 p-5">
              <p className="text-sm text-zinc-400">Ventas · {PRESETS.find(([p]) => p === preset)?.[1]}</p>
              <p className="mt-1 text-4xl font-black text-orange-500">{money(kpis.sales)}</p>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <Mini label="Pedidos" value={String(kpis.orders)} />
                <Mini label="Ticket prom." value={money(kpis.averageTicket)} />
                <Mini label="Descuentos" value={money(kpis.discounts)} />
              </div>
            </section>

            {showCosts && kpis.sales > 0 && kpis.costCoverage < 50 && (
              <p className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-400">
                💡 Para ver utilidad y margen, registra recetas y costos de insumos (Configuración → Recetas, y Compras).
              </p>
            )}
            {showCosts && (kpis.sales === 0 || kpis.costCoverage >= 50) && (
              <section className="grid grid-cols-2 gap-3">
                <Card label="Utilidad bruta" value={money(kpis.profit)} tone={kpis.profit >= 0 ? "green" : "red"} />
                <Card
                  label="Margen"
                  value={`${kpis.margin.toFixed(1)}%`}
                  tone={kpis.margin >= 50 ? "green" : kpis.margin >= 30 ? "orange" : "red"}
                  note={kpis.costCoverage < 95 && kpis.sales > 0 ? `Costo conocido en ${kpis.costCoverage.toFixed(0)}% de la venta` : undefined}
                />
              </section>
            )}

            <Panel title={preset === "hoy" || preset === "ayer" ? "Ventas por hora" : "Ventas por día"}>
              <BarChart rows={view.byTime} format={(r) => `${money(r.sales)} · ${r.count} pedidos`} labelOf={(r) => shortLabel(r.label, preset)} />
            </Panel>

            {branch === "all" && view.branches.length > 1 && (
              <Panel title="Ventas por sucursal">
                <HBars rows={view.branches} value={(r) => r.sales} right={(r) => `${money(r.sales)} · ${r.count}`} onPick={(label) => {
                  const b = data?.branches.find((x) => x.name === label);
                  if (b) setBranch(b.id);
                }} />
              </Panel>
            )}

            <Panel title="Productos top">
              {view.report.byProduct.length === 0 ? (
                <Empty text="Sin ventas en este periodo." />
              ) : (
                <HBars
                  rows={view.report.byProduct.slice(0, 5)}
                  value={(r) => r.sales}
                  right={(r) => `${r.quantity} · ${money(r.sales)}${showCosts && r.cost > 0 ? ` · ${r.margin.toFixed(0)}%` : ""}`}
                />
              )}
            </Panel>

            <Panel title={`Alertas${alerts.length ? ` (${alerts.length})` : ""}`} action={<Link href="/centro-operaciones" className="text-xs font-black text-orange-500">Ver todas →</Link>}>
              {alerts.length === 0 ? (
                <Empty text="Todo en orden ✅" />
              ) : (
                <ul className="space-y-2">
                  {alerts.slice(0, 5).map((a) => (
                    <li key={a.id}>
                      <Link href={a.moduleHref || "/centro-operaciones"} className={`block rounded-2xl border p-3 ${a.priority === "critical" ? "border-red-500/50 bg-red-500/10" : "border-zinc-800 bg-black"}`}>
                        <p className="text-sm font-black">{a.priority === "critical" ? "🚨" : a.priority === "delivery" ? "🛵" : "⚠️"} {a.title}</p>
                        <p className="mt-1 text-xs text-zinc-400">{a.message}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {data?.cloud && <p className="mt-3 text-xs text-zinc-600">Las alertas son las de la sucursal seleccionada en este dispositivo.</p>}
            </Panel>

            <Panel title="Esta app">
              <div className="space-y-3">
                {notificationsSupported() ? (
                  <button onClick={toggleNotifications} className={`w-full rounded-2xl px-4 py-3 text-sm font-black ${notify ? "border border-zinc-700 text-zinc-300" : "bg-orange-500 text-black"}`}>
                    {notify ? "🔕 Apagar notificaciones" : "🔔 Activar notificaciones"}
                  </button>
                ) : (
                  <p className="text-xs text-zinc-500">
                    {ios ? "En iPhone las notificaciones funcionan con la app instalada en la pantalla de inicio." : "Este navegador no permite notificaciones."}
                  </p>
                )}
                {!installed && canInstall && (
                  <button onClick={() => promptInstall().then(() => setInstalled(isInstalled()))} className="w-full rounded-2xl border border-orange-500 px-4 py-3 text-sm font-black text-orange-500">
                    📲 Instalar B-POS en este dispositivo
                  </button>
                )}
                {!installed && !canInstall && ios && (
                  <p className="rounded-2xl border border-zinc-800 p-3 text-xs text-zinc-400">
                    Para instalarla en iPhone: abre esta página en Safari, toca <b>Compartir</b> y luego <b>Agregar a pantalla de inicio</b>.
                  </p>
                )}
                {notify && pushOn && (
                  <div className="space-y-2 rounded-2xl border border-zinc-800 p-3">
                    <p className="text-xs font-black text-emerald-400">✅ Te llegan avisos aunque la app esté cerrada</p>
                    {(
                      [
                        ["delivery", "🛵 Pedidos de delivery (Rappi, Uber Eats, DiDi)"],
                        ["todasVentas", "Cada venta de mostrador"],
                        ["cancelaciones", "❌ Ventas canceladas"],
                        ["caja", "🔒 Cortes de caja"],
                        ["seguridad", "🔐 Respaldos, usuarios y permisos"],
                        ["opiniones", "⭐ Opiniones malas (1 a 3 estrellas)"],
                      ] as [keyof PushPrefs, string][]
                    ).map(([key, label]) => (
                      <label key={key} className="flex items-center justify-between gap-3 text-sm text-zinc-300">
                        {label}
                        <input type="checkbox" checked={Boolean(prefs[key])} onChange={(e) => changePrefs({ [key]: e.target.checked })} className="h-5 w-5 accent-orange-500" />
                      </label>
                    ))}
                    <label className="flex items-center justify-between gap-3 text-sm text-zinc-300">
                      💰 Venta grande desde
                      <input
                        type="number"
                        min={0}
                        step={50}
                        value={prefs.ventaGrande}
                        onChange={(e) => changePrefs({ ventaGrande: Math.max(0, Number(e.target.value) || 0) })}
                        className="w-24 rounded-xl border border-zinc-800 bg-black px-2 py-1 text-right"
                      />
                    </label>
                    <p className="text-xs text-zinc-600">Pon 0 para no avisar de ventas grandes.</p>
                  </div>
                )}
                {notify && pushOn && (
                  <>
                    <button onClick={testPush} className="w-full rounded-2xl border border-orange-500 px-4 py-3 text-sm font-black text-orange-500">
                      📨 Mandar aviso de prueba
                    </button>
                    {testResult && <p className="text-xs text-zinc-400">{testResult}</p>}
                  </>
                )}
                {notify && !pushOn && (
                  <>
                    <button
                      onClick={() => {
                        setBusy(true);
                        void activatePush().finally(() => setBusy(false));
                      }}
                      disabled={busy}
                      className="w-full rounded-2xl bg-orange-500 px-4 py-3 text-sm font-black text-black disabled:opacity-50"
                    >
                      {busy ? "Activando..." : "📲 Activar avisos con la app cerrada"}
                    </button>
                    {pushError && (
                      <p className="rounded-2xl border border-orange-500/40 bg-orange-500/10 p-3 text-xs text-orange-200">
                        Solo te avisaremos con la app abierta: {pushError}
                      </p>
                    )}
                  </>
                )}
                <p className="text-xs text-zinc-600">
                  {pushOn
                    ? "Los avisos salen de la nube en cuanto la caja registra el evento. Las alertas críticas llegan con la app abierta."
                    : "Te avisamos de ventas nuevas y alertas críticas mientras la app esté abierta o en segundo plano."}
                </p>
              </div>
            </Panel>
          </>
        )}
      </div>
    </main>
  );
}

/** En el día solo se muestran las horas con movimiento (mínimo de 8 a 23 h) */
function trimHours(rows: Row[]) {
  const withSales = rows.map((r, i) => (r.count > 0 ? i : -1)).filter((i) => i >= 0);
  const first = Math.min(8, ...withSales);
  const last = Math.max(23, ...withSales);
  return rows.slice(first, last + 1);
}

function shortLabel(label: string, preset: Preset) {
  if (preset === "hoy" || preset === "ayer") return `${Number(label)}h`;
  const parts = label.split("-");
  return parts.length === 3 ? String(Number(parts[2])) : label;
}

function Chips<T extends string>({ items, value, onChange }: { items: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {items.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`shrink-0 rounded-full px-4 py-2 text-sm font-black ${value === key ? "bg-orange-500 text-black" : "border border-zinc-800 bg-zinc-950 text-zinc-300"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-black/40 p-2">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="truncate text-base font-black">{value}</p>
    </div>
  );
}

function Card({ label, value, tone, note }: { label: string; value: string; tone: "green" | "orange" | "red"; note?: string }) {
  const color = tone === "green" ? "text-green-400" : tone === "orange" ? "text-orange-400" : "text-red-400";
  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className={`mt-1 text-2xl font-black ${color}`}>{value}</p>
      {note && <p className="mt-1 text-[11px] text-zinc-600">{note}</p>}
    </div>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-black">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-4 text-center text-sm text-zinc-500">{text}</p>;
}

/** Gráfica de barras: toca una barra para ver su valor */
function BarChart({ rows, format, labelOf }: { rows: Row[]; format: (r: Row) => string; labelOf: (r: Row) => string }) {
  const [picked, setPicked] = useState<number | null>(null);
  const max = Math.max(1, ...rows.map((r) => r.sales));
  const best = rows.reduce((b, r, i) => (r.sales > (rows[b]?.sales ?? 0) ? i : b), 0);
  const shown = picked ?? best;
  const every = Math.ceil(rows.length / 8);
  if (rows.every((r) => r.sales === 0)) return <Empty text="Sin ventas en este periodo." />;
  return (
    <div>
      <p className="mb-3 text-sm">
        <span className="font-black text-orange-500">{labelOf(rows[shown])}</span>
        <span className="text-zinc-400"> · {format(rows[shown])}</span>
        {picked === null && <span className="text-xs text-zinc-600"> (mejor momento)</span>}
      </p>
      <div className="flex h-36 items-end gap-[3px]">
        {rows.map((r, i) => (
          <button
            key={r.label}
            onClick={() => setPicked(i === picked ? null : i)}
            onMouseEnter={() => setPicked(i)}
            aria-label={`${labelOf(r)}: ${format(r)}`}
            className="flex h-full flex-1 items-end"
          >
            <span
              className={`w-full rounded-t ${i === shown ? "bg-orange-500" : "bg-orange-500/35"}`}
              style={{ height: `${Math.max(r.sales > 0 ? 4 : 1, (r.sales / max) * 100)}%` }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1 flex gap-[3px] text-[10px] text-zinc-600">
        {rows.map((r, i) => (
          <span key={r.label} className="flex-1 text-center">{i % every === 0 ? labelOf(r) : ""}</span>
        ))}
      </div>
    </div>
  );
}

function HBars({ rows, value, right, onPick }: { rows: Row[]; value: (r: Row) => number; right: (r: Row) => string; onPick?: (label: string) => void }) {
  const max = Math.max(1, ...rows.map(value));
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label}>
          <button onClick={() => onPick?.(r.label)} disabled={!onPick} className="block w-full text-left">
            <div className="flex justify-between gap-3 text-sm">
              <span className="truncate font-bold">{r.label}</span>
              <span className="shrink-0 text-zinc-400">{right(r)}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-zinc-900">
              <div className="h-2 rounded-full bg-orange-500" style={{ width: `${(value(r) / max) * 100}%` }} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
