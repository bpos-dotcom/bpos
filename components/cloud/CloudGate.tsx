"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  createBusiness,
  loadCloudAccount,
  selectBranch,
  signIn,
  signOutDevice,
  signUp,
  type CloudAccount,
  type ReadyAccount,
} from "@/lib/cloud/account";
import {
  detectInitialSituation,
  flush,
  initialSync,
  isPrimaryDevice,
  onSyncStatus,
  pull,
  resetDeviceSync,
  setPrimaryDevice,
  startSync,
  type InitialSituation,
  type SyncStatus,
} from "@/lib/cloud/sync";
import { getSupabase, isCloudConfigured } from "@/lib/supabase/client";
import { planAccess, type PlanState } from "@/lib/plans";
import { saveBusinessSettings } from "@/lib/business-settings";

const ACCOUNT_CACHE_KEY = "bpos_sync_account";

const input =
  "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white placeholder:text-zinc-600";
const primary =
  "w-full rounded-2xl bg-orange-500 py-4 font-black text-black transition hover:bg-orange-400 disabled:opacity-50";
const secondary =
  "w-full rounded-2xl border border-zinc-700 bg-black py-4 font-black text-white hover:border-orange-500 disabled:opacity-50";

type GateState =
  | { step: "loading"; text: string }
  | { step: "account" }
  | { step: "business"; email: string }
  | { step: "first-sync"; account: ReadyAccount; situation: InitialSituation }
  | { step: "working"; text: string }
  | { step: "error"; message: string; canWorkOffline: boolean }
  | { step: "ready"; account: ReadyAccount };

/**
 * Conecta este dispositivo a la nube antes de mostrar B-POS.
 * Si no hay Supabase configurado, muestra B-POS directo (modo local).
 */
export function CloudGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>({ step: "loading", text: "Conectando con la nube..." });

  const begin = useCallback(async (account: ReadyAccount) => {
    localStorage.setItem(ACCOUNT_CACHE_KEY, JSON.stringify(account));
    const situation = await detectInitialSituation(account);

    if (situation === "ready") {
      startSync(account);
      setState({ step: "ready", account });
      return;
    }

    if (situation === "download-cloud") {
      setState({ step: "working", text: "Descargando datos de la nube..." });
      await initialSync(account, "download-cloud", (text) => setState({ step: "working", text }));
      startSync(account);
      setState({ step: "ready", account });
      return;
    }

    setState({ step: "first-sync", account, situation });
  }, []);

  const refresh = useCallback(async () => {
    setState({ step: "loading", text: "Conectando con la nube..." });
    let account: CloudAccount;
    try {
      account = await loadCloudAccount();
    } catch (error) {
      const cached = readCachedAccount();
      setState({
        step: "error",
        message: error instanceof Error ? error.message : "No se pudo conectar con la nube.",
        canWorkOffline: Boolean(cached && localStorage.getItem("bpos_sync_meta")),
      });
      return;
    }

    if (account.status === "signed-out") return setState({ step: "account" });
    if (account.status === "no-business") return setState({ step: "business", email: account.email });
    if (account.status === "ready") {
      try {
        await begin(account);
      } catch (error) {
        setState({
          step: "error",
          message: error instanceof Error ? error.message : "No se pudo sincronizar.",
          canWorkOffline: Boolean(localStorage.getItem("bpos_sync_meta")),
        });
      }
    }
  }, [begin]);

  useEffect(() => {
    if (isCloudConfigured) refresh();
  }, [refresh]);

  if (!isCloudConfigured) return <>{children}</>;

  if (state.step === "ready") {
    return (
      <>
        {children}
        <PlanLock account={state.account} />
        <SyncBadge account={state.account} />
      </>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-black p-6 text-white">
      <section className="w-full max-w-xl rounded-3xl border border-zinc-800 bg-zinc-950 p-8">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-500 text-2xl font-black text-black">
          BP
        </div>

        {(state.step === "loading" || state.step === "working") && (
          <p className="text-center text-zinc-300">{state.text}</p>
        )}

        {state.step === "account" && <AccountForm onDone={refresh} />}

        {state.step === "business" && <BusinessForm email={state.email} onDone={refresh} />}

        {state.step === "first-sync" && (
          <FirstSync
            account={state.account}
            situation={state.situation}
            onStart={async (strategy) => {
              setState({ step: "working", text: "Preparando..." });
              try {
                await initialSync(state.account, strategy, (text) => setState({ step: "working", text }));
                startSync(state.account);
                setState({ step: "ready", account: state.account });
              } catch (error) {
                setState({
                  step: "error",
                  message: error instanceof Error ? error.message : "No se pudo sincronizar.",
                  canWorkOffline: false,
                });
              }
            }}
          />
        )}

        {state.step === "error" && (
          <div className="space-y-4 text-center">
            <p className="text-red-400">{state.message}</p>
            <button onClick={refresh} className={primary}>
              Reintentar
            </button>
            {state.canWorkOffline && (
              <button
                onClick={() => {
                  const cached = readCachedAccount();
                  if (!cached) return;
                  startSync(cached);
                  setState({ step: "ready", account: cached });
                }}
                className={secondary}
              >
                Trabajar sin internet
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function readCachedAccount(): ReadyAccount | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_CACHE_KEY);
    return raw ? (JSON.parse(raw) as ReadyAccount) : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ cuenta

function AccountForm({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit() {
    setMessage("");
    if (!email.includes("@")) return setMessage("Escribe un correo válido.");
    if (password.length < 6) return setMessage("La contraseña debe tener al menos 6 caracteres.");
    setBusy(true);
    try {
      if (mode === "login") {
        await signIn(email, password);
        onDone();
      } else if (await signUp(email, password)) {
        onDone();
      } else {
        setMode("login");
        setMessage("Te mandamos un correo para confirmar la cuenta. Ábrelo, confirma y luego entra aquí.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo entrar.");
    }
    setBusy(false);
  }

  return (
    <>
      <h1 className="text-center text-3xl font-black">Conectar a la nube</h1>
      <p className="mt-2 text-center text-zinc-400">
        Entra con la cuenta del negocio. Solo se hace una vez en cada computadora, tablet o celular.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-2 rounded-2xl border border-zinc-800 bg-black p-1">
        {(["login", "signup"] as const).map((value) => (
          <button
            key={value}
            onClick={() => {
              setMode(value);
              setMessage("");
            }}
            className={`rounded-xl py-3 font-black ${mode === value ? "bg-orange-500 text-black" : "text-zinc-400"}`}
          >
            {value === "login" ? "Entrar" : "Crear cuenta"}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-4">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="correo@negocio.com"
          type="email"
          autoComplete="email"
          className={input}
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Contraseña (mínimo 6 caracteres)"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          className={input}
        />
        {message && <p className="text-center text-sm text-orange-300">{message}</p>}
        <button onClick={submit} disabled={busy} className={primary}>
          {busy ? "Un momento..." : mode === "login" ? "Entrar" : "Crear cuenta"}
        </button>
      </div>
    </>
  );
}

// ------------------------------------------------------------ negocio

function BusinessForm({ email, onDone }: { email: string; onDone: () => void }) {
  const [businessName, setBusinessName] = useState("");
  const [branchName, setBranchName] = useState("Matriz");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit() {
    if (!businessName.trim()) return setMessage("Escribe el nombre del negocio.");
    setBusy(true);
    setMessage("");
    try {
      await createBusiness(businessName, branchName);
      // Marca blanca: tickets y pantallas usan el nombre del negocio
      saveBusinessSettings({ businessName: businessName.trim() });
      onDone();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo crear el negocio.");
    }
    setBusy(false);
  }

  return (
    <>
      <h1 className="text-center text-3xl font-black">Da de alta tu negocio</h1>
      <p className="mt-2 text-center text-zinc-400">Cuenta: {email}</p>
      <div className="mt-8 space-y-4">
        <label className="block">
          <span className="mb-2 block text-sm font-bold text-zinc-400">Nombre del negocio</span>
          <input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Ej. Tacos El Güero" className={input} />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-bold text-zinc-400">Sucursal</span>
          <input value={branchName} onChange={(e) => setBranchName(e.target.value)} className={input} />
        </label>
        {message && <p className="text-center text-sm text-red-400">{message}</p>}
        <button onClick={submit} disabled={busy} className={primary}>
          {busy ? "Creando..." : "Crear negocio"}
        </button>
        <button
          onClick={async () => {
            await signOutDevice();
            onDone();
          }}
          className="w-full text-sm text-zinc-500 hover:text-orange-500"
        >
          Usar otra cuenta
        </button>
      </div>
    </>
  );
}

// ------------------------------------------------------------ primera sincronización

function FirstSync({
  account,
  situation,
  onStart,
}: {
  account: ReadyAccount;
  situation: InitialSituation;
  onStart: (strategy: "upload-local" | "download-cloud" | "merge") => void;
}) {
  if (situation === "upload-local") {
    return (
      <>
        <h1 className="text-center text-3xl font-black">Subir tus datos a la nube</h1>
        <p className="mt-3 text-center text-zinc-400">
          {account.businessName} · {account.branchName}
        </p>
        <p className="mt-4 text-center text-zinc-300">
          Es la primera vez que se conecta este negocio. Vamos a subir todo lo que tiene esta computadora
          (productos, ventas, caja, inventario, usuarios y configuración) para que los demás dispositivos lo vean.
        </p>
        <button onClick={() => onStart("upload-local")} className={`${primary} mt-8`}>
          Subir y continuar
        </button>
      </>
    );
  }

  return (
    <>
      <h1 className="text-center text-3xl font-black">Esta computadora también tiene datos</h1>
      <p className="mt-3 text-center text-zinc-400">
        {account.businessName} · {account.branchName}
      </p>
      <p className="mt-4 text-center text-zinc-300">
        La nube ya tiene datos de tu negocio y este navegador también. ¿Qué quieres hacer?
      </p>
      <div className="mt-8 space-y-3">
        <button onClick={() => onStart("download-cloud")} className={primary}>
          Usar los datos de la nube
        </button>
        <p className="text-center text-xs text-zinc-500">
          Recomendado si este es un dispositivo nuevo o de prueba. Lo de este navegador se reemplaza.
        </p>
        <button onClick={() => onStart("merge")} className={secondary}>
          Combinar (subir también lo de esta computadora)
        </button>
        <p className="text-center text-xs text-zinc-500">
          Úsalo si en esta computadora hay ventas que no están en la nube.
        </p>
      </div>
    </>
  );
}

// ------------------------------------------------------------ plan (bloque 15)

/** Pantallas que siguen abiertas con el plan vencido: entrar y pagar. */
const PLAN_FREE_PATHS = ["/login", "/configuracion/plan", "/acceso-denegado"];

/**
 * Bloqueo amable: si la prueba gratis terminó o lo pagado venció, B-POS pide
 * ir a Mi plan. Sin internet no se bloquea (se revisa al volver la conexión).
 */
function PlanLock({ account }: { account: ReadyAccount }) {
  const pathname = usePathname() || "/";
  const [access, setAccess] = useState<{ locked: boolean; warning: string } | null>(null);
  const [hideWarning, setHideWarning] = useState(false);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (!navigator.onLine) return;
      const { data, error } = await getSupabase()
        .from("businesses")
        .select("plan, plan_status, trial_ends_at, paid_until")
        .eq("id", account.businessId)
        .maybeSingle();
      if (alive && !error && data) setAccess(planAccess(data as PlanState));
    };
    void check();
    const timer = setInterval(check, 30 * 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [account.businessId, pathname]);

  if (!access || PLAN_FREE_PATHS.some((p) => pathname.startsWith(p))) return null;

  if (access.locked) {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/90 p-6 text-white backdrop-blur">
        <section className="w-full max-w-lg rounded-3xl border border-orange-500/40 bg-zinc-950 p-8 text-center">
          <p className="text-5xl">⏸️</p>
          <h2 className="mt-4 text-3xl font-black">Tu plan de B-POS está en pausa</h2>
          <p className="mt-3 text-zinc-300">
            La prueba gratis terminó o el último pago no se completó. Tus datos están guardados: activa tu plan para
            seguir vendiendo.
          </p>
          <a href="/configuracion/plan" className="mt-6 block w-full rounded-2xl bg-orange-500 py-4 font-black text-black hover:bg-orange-400">
            Ir a Mi plan
          </a>
          <p className="mt-3 text-xs text-zinc-500">Necesitas entrar con un usuario Admin.</p>
        </section>
      </div>
    );
  }

  if (access.warning && !hideWarning) {
    return (
      <div className="fixed left-1/2 top-3 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-full border border-orange-500/50 bg-black/95 px-5 py-2 text-sm text-orange-200 shadow-xl">
        <span>{access.warning}</span>
        <a href="/configuracion/plan" className="font-black text-orange-400 hover:underline">
          Mi plan
        </a>
        <button onClick={() => setHideWarning(true)} className="text-zinc-500 hover:text-white" aria-label="Cerrar">
          ✕
        </button>
      </div>
    );
  }
  return null;
}

// ------------------------------------------------------------ indicador

function SyncBadge({ account }: { account: ReadyAccount }) {
  const [status, setStatus] = useState<SyncStatus>({ state: "idle", pending: 0 });
  const [open, setOpen] = useState(false);
  const [isPrimary, setIsPrimary] = useState(true);

  useEffect(() => onSyncStatus(setStatus), []);
  useEffect(() => setIsPrimary(isPrimaryDevice()), [open]);

  const label =
    status.state === "offline"
      ? `📴 Sin internet${status.pending ? ` · ${status.pending} pendientes` : ""}`
      : status.state === "error"
        ? "⚠️ Error de sincronización"
        : status.state === "syncing" || status.pending > 0
          ? "⏳ Sincronizando..."
          : "☁️ Sincronizado";

  const color =
    status.state === "error"
      ? "border-red-500/50 text-red-300"
      : status.state === "offline"
        ? "border-yellow-500/50 text-yellow-300"
        : "border-zinc-700 text-zinc-300";

  return (
    <div className="fixed bottom-4 right-4 z-[60] text-sm">
      {open && (
        <div className="mb-2 w-80 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-white shadow-2xl">
          <p className="font-black text-orange-500">{account.businessName}</p>
          <p className="text-zinc-400">Sucursal: {account.branchName}</p>
          <p className="text-xs text-zinc-500">{account.email}</p>
          {status.lastSyncAt && (
            <p className="mt-2 text-xs text-zinc-500">
              Última sincronización: {new Date(status.lastSyncAt).toLocaleTimeString()}
            </p>
          )}
          {status.message && <p className="mt-2 text-xs text-orange-300">{status.message}</p>}

          {account.branches.length > 1 && (
            <select
              value={account.branchId}
              onChange={(e) => {
                if (!confirm("¿Cambiar la sucursal de este dispositivo?")) return;
                selectBranch(e.target.value);
                resetDeviceSync();
                window.location.reload();
              }}
              className="mt-3 w-full rounded-xl border border-zinc-800 bg-black p-2"
            >
              {account.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}

          <label className="mt-3 flex items-start gap-2 text-xs text-zinc-300">
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => {
                setPrimaryDevice(e.target.checked);
                setIsPrimary(e.target.checked);
              }}
            />
            <span>
              <b>Caja principal.</b> Descuenta el inventario de las ventas. Déjalo activo solo en la computadora
              de la caja.
            </span>
          </label>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                void flush();
                void pull();
              }}
              className="rounded-xl bg-orange-500 px-3 py-2 font-black text-black"
            >
              Sincronizar
            </button>
            <button
              onClick={async () => {
                if (!confirm("¿Desconectar este dispositivo de la nube? Tendrás que volver a entrar con la cuenta.")) return;
                await flush().catch(() => undefined);
                await signOutDevice();
                resetDeviceSync();
                window.location.reload();
              }}
              className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 font-black text-red-300"
            >
              Desconectar
            </button>
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`rounded-full border bg-black/90 px-4 py-2 font-bold shadow-lg backdrop-blur ${color}`}
      >
        {label}
      </button>
    </div>
  );
}
