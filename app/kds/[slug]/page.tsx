"use client";
/**
 * App de cocina para tablets: bpos.com.mx/kds/<liga>.
 *
 *  1. Vincular: la primera vez pide el código de Configuración → Tablets de
 *     cocina y la tablet queda como dispositivo del negocio (sin correo ni
 *     contraseña del restaurante).
 *  2. Entrar: nombre y PIN (usuarios con el permiso "Ver Cocina KDS").
 *  3. La cocina a pantalla completa (components/kitchen/KitchenScreen.tsx),
 *     sin menú lateral: no revisa el Bridge ni muestra avisos de equivalencias
 *     (eso lo hace el equipo principal de la caja).
 */
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { usePlanState } from "@/components/cloud/PlanGate";
import { KitchenScreen } from "@/components/kitchen/KitchenScreen";
import { notify } from "@/components/layout/Dialogs";
import { clearCurrentUser, getSessionUser, setCurrentUser, type CurrentUser } from "@/lib/auth";
import { loadCloudAccount, signIn } from "@/lib/cloud/account";
import { detectInitialSituation, initialSync, setPrimaryDevice, startSync } from "@/lib/cloud/sync";
import { kitchenUsers, readKdsDevice, saveKdsDevice } from "@/lib/kds-device";
import { verifyPin } from "@/lib/pin-hash";
import { planIncludes } from "@/lib/plans";
import { getUsers, type SystemUser } from "@/lib/users";
import { linkWaiterDevice, waiterDeviceSeen } from "@/lib/waiter";

type Step = { kind: "loading"; text: string } | { kind: "pair" } | { kind: "login" } | { kind: "app"; user: CurrentUser };

export default function KdsTabletPage() {
  const params = useParams<{ slug: string }>();
  const slug = String(params?.slug || "").toLowerCase();
  const [step, setStep] = useState<Step>({ kind: "loading", text: "Abriendo…" });

  const boot = useCallback(async () => {
    try {
      const device = readKdsDevice();
      const account = await loadCloudAccount();
      if (account.status !== "ready" || !device) {
        setStep({ kind: "pair" });
        return;
      }
      if (device.branchId && localStorage.getItem("bpos_branch_id") !== device.branchId) localStorage.setItem("bpos_branch_id", device.branchId);
      // La tablet nunca es la caja principal: no descuenta inventario ni procesa el Bridge
      setPrimaryDevice(false);
      const situation = await detectInitialSituation(account);
      if (situation !== "ready") {
        setStep({ kind: "loading", text: "Descargando los pedidos y el menú…" });
        await initialSync(account, "download-cloud", (text) => setStep({ kind: "loading", text }));
      }
      startSync(account);
      const user = getSessionUser();
      setStep(user ? { kind: "app", user } : { kind: "login" });
    } catch (e) {
      notify(e instanceof Error ? e.message : "No se pudo conectar.", "error");
      setStep({ kind: "pair" });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- arranque: vincular, sincronizar y entrar
    void boot();
  }, [boot]);

  if (step.kind === "loading") return <Shell><p className="py-24 text-center text-zinc-400">{step.text}</p></Shell>;
  if (step.kind === "pair") return <Shell><PairScreen slug={slug} /></Shell>;
  if (step.kind === "login") return <Shell><LoginScreen onEnter={(user) => setStep({ kind: "app", user })} /></Shell>;
  return (
    <KitchenApp
      user={step.user}
      onLogout={() => {
        clearCurrentUser();
        setStep({ kind: "login" });
      }}
    />
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="mx-auto max-w-lg px-4 pb-24 pt-4">{children}</div>
    </main>
  );
}

// ------------------------------------------------------------ 1. vincular

function PairScreen({ slug }: { slug: string }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const r = await linkWaiterDevice(slug, code, name, "kds");
      await signIn(r.email, r.password);
      localStorage.setItem("bpos_branch_id", r.branchId);
      saveKdsDevice({ deviceId: r.deviceId, branchId: r.branchId, name: r.name, slug, linkedAt: new Date().toISOString() });
      setPrimaryDevice(false);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo vincular.");
      setBusy(false);
    }
  }

  return (
    <div className="pt-10">
      <p className="text-center text-sm font-black uppercase tracking-widest text-orange-500">B-POS · Cocina</p>
      <h1 className="mt-2 text-center text-3xl font-black">Vincular esta tablet</h1>
      <p className="mt-3 text-center text-sm text-zinc-400">Pide en caja el código de Configuración → Tablets de cocina. Solo se hace una vez.</p>
      <label className="mt-8 block text-sm font-bold text-zinc-400">¿Qué tablet es?</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Tablet parrilla" className="mt-2 w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-4 text-lg" />
      <label className="mt-5 block text-sm font-bold text-zinc-400">Código de 6 dígitos</label>
      <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="000000" className="mt-2 w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-4 text-center font-mono text-3xl tracking-[0.4em]" />
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <button onClick={() => void submit()} disabled={busy || code.length !== 6} className="mt-6 w-full rounded-2xl bg-orange-500 py-4 text-lg font-black text-black disabled:opacity-50">
        {busy ? "Vinculando…" : "Vincular"}
      </button>
    </div>
  );
}

// ------------------------------------------------------------ 2. entrar

function LoginScreen({ onEnter }: { onEnter: (user: CurrentUser) => void }) {
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [selected, setSelected] = useState<SystemUser | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () => setUsers(kitchenUsers());
    load();
    window.addEventListener("bpos:users-updated", load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener("bpos:users-updated", load);
      window.removeEventListener("storage", load);
    };
  }, []);

  async function confirm() {
    if (!selected) return;
    const user = getUsers().find((u) => u.id === selected.id) || selected;
    if (!(await verifyPin(pin, user))) {
      setError("PIN incorrecto.");
      setPin("");
      return;
    }
    const current = { id: user.id, name: user.name, role: user.role };
    setCurrentUser(current);
    onEnter(current);
  }

  if (!selected) {
    return (
      <div className="pt-8">
        <p className="text-center text-sm font-black uppercase tracking-widest text-orange-500">B-POS · Cocina</p>
        <h1 className="mt-2 text-center text-3xl font-black">¿Quién eres?</h1>
        {users.length === 0 && <p className="mt-6 text-center text-sm text-zinc-400">Todavía no hay usuarios de cocina. En la caja: Configuración → Usuarios, rol Cocina (o el permiso &quot;Ver Cocina KDS&quot;).</p>}
        <div className="mt-6 grid grid-cols-2 gap-3">
          {users.map((u) => (
            <button key={u.id} onClick={() => setSelected(u)} className="rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-6 text-lg font-black">
              {u.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="pt-8">
      <button
        onClick={() => {
          setSelected(null);
          setPin("");
          setError("");
        }}
        className="text-sm font-black text-zinc-400"
      >
        ← Otra persona
      </button>
      <h1 className="mt-4 text-center text-2xl font-black">{selected.name}</h1>
      <p className="mt-6 text-center font-mono text-4xl tracking-[0.5em]">{"•".repeat(pin.length) || " "}</p>
      {error && <p className="mt-2 text-center text-sm text-red-400">{error}</p>}
      <div className="mt-6 grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"].map((k) => (
          <button
            key={k}
            onClick={() => {
              if (k === "⌫") setPin((p) => p.slice(0, -1));
              else if (k === "OK") void confirm();
              else if (pin.length < 8) setPin((p) => p + k);
              setError("");
            }}
            className={`h-16 rounded-2xl text-2xl font-black ${k === "OK" ? "bg-orange-500 text-black" : "border border-zinc-800 bg-zinc-950"}`}
          >
            {k}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ 3. cocina

function KitchenApp({ user, onLogout }: { user: CurrentUser; onLogout: () => void }) {
  const plan = usePlanState();

  useEffect(() => {
    // Configuración → Tablets de cocina muestra "última vez"
    void waiterDeviceSeen();
    const seen = setInterval(() => void waiterDeviceSeen(), 5 * 60_000);
    return () => clearInterval(seen);
  }, []);

  if (!planIncludes(plan, "kds")) {
    return (
      <Shell>
        <div className="pt-16 text-center">
          <p className="text-4xl">👨‍🍳</p>
          <h1 className="mt-3 text-2xl font-black">La pantalla de cocina viene en Pro y Max</h1>
          <p className="mt-2 text-sm text-zinc-400">El dueño puede cambiar de plan en B-POS → Configuración → Mi plan.</p>
          <button onClick={onLogout} className="mt-6 rounded-2xl border border-zinc-700 px-5 py-3 text-sm font-black">
            Salir
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <KitchenScreen
      bare
      extra={
        <button onClick={onLogout} className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-black text-zinc-200" title="Cambiar de usuario">
          👤 {user.name} · Salir
        </button>
      }
    />
  );
}
