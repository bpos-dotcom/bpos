"use client";
/**
 * Caja → Fiado: quién debe y cuánto, abonos, límite de crédito y
 * recordatorio por WhatsApp (lib/customer-credit.ts).
 */
import { useEffect, useMemo, useState } from "react";
import RequirePermission from "@/components/auth/RequirePermission";
import { AppShell } from "@/components/layout/AppShell";
import { getCurrentUser } from "@/lib/auth";
import { getBusinessSettings } from "@/lib/business-settings";
import { addCashMovement, getActiveShift } from "@/lib/cash-register";
import { requirePermissionOrAdmin } from "@/lib/permissions";
import { openWhatsapp } from "@/lib/whatsapp";
import { notify } from "@/components/layout/Toasts";
import {
  CREDIT_EVENT,
  accountKey,
  chargeCredit,
  creditAccounts,
  creditReminderLink,
  getCreditSettings,
  payCredit,
  saveCreditSettings,
  type CreditAccount,
} from "@/lib/customer-credit";

const money = (n: number) => `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const date = (iso: string) => new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "2-digit" });
const daysSince = (iso?: string) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86_400_000) : 0);
const input = "w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white placeholder:text-zinc-600";

export default function FiadoPage() {
  return (
    <RequirePermission permission="cash.view">
      <AppShell title="Fiado" subtitle="Lo que deben tus clientes: abonos, límites y recordatorios por WhatsApp.">
        <Fiado />
      </AppShell>
    </RequirePermission>
  );
}

function Fiado() {
  const [accounts, setAccounts] = useState<CreditAccount[]>([]);
  const [defaultLimit, setDefaultLimit] = useState(0);
  const [query, setQuery] = useState("");
  const [showPaid, setShowPaid] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const load = () => {
      setAccounts(creditAccounts());
      setDefaultLimit(getCreditSettings().defaultLimit);
    };
    load();
    window.addEventListener(CREDIT_EVENT, load);
    window.addEventListener("storage", load);
    return () => {
      window.removeEventListener(CREDIT_EVENT, load);
      window.removeEventListener("storage", load);
    };
  }, []);

  const owing = accounts.filter((a) => a.balance > 0.009);
  const total = owing.reduce((s, a) => s + a.balance, 0);
  const visible = useMemo(() => {
    const q = plain(query.trim());
    return accounts.filter((a) => (showPaid || a.balance > 0.009) && (!q || plain(`${a.name} ${a.phone || ""}`).includes(q)));
  }, [accounts, query, showPaid]);

  async function changeDefaultLimit() {
    const text = prompt("Límite de crédito para todos los clientes (0 = sin límite):", String(defaultLimit || 0));
    if (text === null) return;
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0) return alert("Escribe un número.");
    if (!(await requirePermissionOrAdmin(getCurrentUser(), "pos.discount", "cambiar el límite de fiado"))) return;
    saveCreditSettings({ defaultLimit: Math.round(value) });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-3xl border border-sky-500/40 bg-sky-500/5 p-5">
          <p className="text-sm font-bold text-sky-300">Te deben</p>
          <p className="mt-1 text-4xl font-black">{money(total)}</p>
          <p className="text-sm text-zinc-400">{owing.length} cliente(s)</p>
        </div>
        <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5">
          <p className="text-sm font-bold text-zinc-400">Límite general</p>
          <p className="mt-1 text-3xl font-black">{defaultLimit > 0 ? money(defaultLimit) : "Sin límite"}</p>
          <button onClick={changeDefaultLimit} className="mt-2 text-sm font-black text-orange-400">
            Cambiar
          </button>
        </div>
        <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-400">
          <p className="font-black text-white">¿Cómo se fía?</p>
          <p className="mt-1">En la caja escribe el nombre (y WhatsApp) del cliente o búscalo en el Club; al cobrar elige <b>Fiado</b>. Cuando pague, regístralo aquí.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="🔍 Buscar cliente" className={`${input} max-w-sm`} />
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={showPaid} onChange={(e) => setShowPaid(e.target.checked)} /> Ver también los que ya pagaron
        </label>
        <button onClick={() => setAdding(true)} className="ml-auto rounded-2xl border border-zinc-700 px-4 py-3 text-sm font-black">
          + Deuda anterior
        </button>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-3xl border border-zinc-800 bg-zinc-950 p-10 text-center text-zinc-500">{accounts.length ? "Nadie debe con esa búsqueda." : "Todavía no hay ventas fiadas."}</p>
      ) : (
        <div className="space-y-3">
          {visible.map((a) => (
            <AccountRow key={a.account} acc={a} open={open === a.account} onToggle={() => setOpen(open === a.account ? null : a.account)} />
          ))}
        </div>
      )}

      {adding && <PreviousDebt onClose={() => setAdding(false)} />}
    </div>
  );
}

function AccountRow({ acc, open, onToggle }: { acc: CreditAccount; open: boolean; onToggle: () => void }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Efectivo");
  const days = daysSince(acc.owingSince);
  const over = acc.limit > 0 && acc.balance > acc.limit;

  async function pay() {
    const value = Number(amount);
    try {
      const m = payCredit({ account: acc.account, amount: value, method });
      // En efectivo con la caja abierta, entra al cajón (el corte cuadra)
      if (method === "Efectivo") {
        if (getActiveShift()) addCashMovement("Ingreso extra", m.amount, `Abono de fiado: ${acc.name}`);
        else notify("Abono guardado. La caja está cerrada: ese efectivo no se sumó a ningún turno.", "error");
      }
      notify(`Abono de ${money(m.amount)} de ${acc.name}. Debe ${money(Math.max(0, acc.balance - m.amount))}.`);
      setAmount("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "No se pudo registrar el abono.");
    }
  }

  async function changeLimit() {
    const settings = getCreditSettings();
    const text = prompt(`Límite de crédito de ${acc.name} (vacío = el general, 0 = sin límite):`, settings.limits[acc.account] !== undefined ? String(settings.limits[acc.account]) : "");
    if (text === null) return;
    if (!(await requirePermissionOrAdmin(getCurrentUser(), "pos.discount", `cambiar el límite de fiado de ${acc.name}`))) return;
    const limits = { ...settings.limits };
    if (text.trim() === "") delete limits[acc.account];
    else {
      const v = Number(text);
      if (!Number.isFinite(v) || v < 0) return alert("Escribe un número.");
      limits[acc.account] = Math.round(v);
    }
    saveCreditSettings({ limits });
  }

  function remind() {
    const link = creditReminderLink(acc, getBusinessSettings().businessName);
    if (!link) return alert("Este cliente no tiene WhatsApp guardado. Fíale con su WhatsApp para poder mandarle recordatorios.");
    openWhatsapp(link);
  }

  return (
    <div className={`rounded-3xl border bg-zinc-950 ${over ? "border-red-500/60" : "border-zinc-800"}`}>
      <button onClick={onToggle} className="flex w-full flex-wrap items-center gap-3 p-5 text-left">
        <span className="text-3xl">📒</span>
        <span className="min-w-0 flex-1">
          <span className="block text-lg font-black">{acc.name}</span>
          <span className="block text-sm text-zinc-500">
            {acc.phone ? `📱 ${acc.phone} · ` : ""}
            {acc.balance > 0.009 ? `debe desde hace ${days} día(s)` : "al corriente"}
            {acc.limit > 0 ? ` · límite ${money(acc.limit)}` : ""}
          </span>
        </span>
        <span className={`text-2xl font-black ${acc.balance > 0.009 ? (over ? "text-red-400" : "text-sky-300") : "text-green-400"}`}>{money(acc.balance)}</span>
      </button>
      {open && (
        <div className="border-t border-zinc-800 p-5">
          {acc.balance > 0.009 && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-40 flex-1">
                <span className="mb-1 block text-sm font-bold text-zinc-400">Abono</span>
                <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="0.00" className={`${input} text-xl font-black`} />
              </label>
              <select value={method} onChange={(e) => setMethod(e.target.value)} className={`${input} w-auto`}>
                <option>Efectivo</option>
                <option>Tarjeta</option>
                <option>Transferencia</option>
              </select>
              <button onClick={() => setAmount(String(acc.balance))} className="rounded-2xl border border-zinc-700 px-4 py-3 font-black">
                Todo
              </button>
              <button onClick={pay} disabled={!(Number(amount) > 0)} className="rounded-2xl bg-sky-400 px-5 py-3 font-black text-black disabled:opacity-40">
                Registrar abono
              </button>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {acc.balance > 0.009 && (
              <button onClick={remind} className="rounded-2xl border border-green-500/60 px-4 py-2 text-sm font-black text-green-300">
                WhatsApp: recordar saldo
              </button>
            )}
            <button onClick={changeLimit} className="rounded-2xl border border-zinc-700 px-4 py-2 text-sm font-black">
              Límite de crédito
            </button>
          </div>
          <div className="mt-4 space-y-1">
            {[...acc.movements].reverse().map((m) => (
              <p key={m.id} className="flex justify-between gap-3 rounded-xl bg-black px-3 py-2 text-sm">
                <span className="text-zinc-400">
                  {date(m.createdAt)} · {m.type === "cargo" ? `Fiado${m.folio ? ` · Pedido #${m.folio}` : ""}` : m.type === "abono" ? `Abono (${m.method})` : m.note || "Ajuste"}
                  {m.note && m.type !== "ajuste" ? ` · ${m.note}` : ""}
                  {m.by ? ` · ${m.by}` : ""}
                </span>
                <span className={`font-black ${m.type === "cargo" || (m.delta || 0) > 0 ? "text-sky-300" : "text-green-400"}`}>
                  {m.type === "cargo" || (m.delta || 0) > 0 ? "+" : "−"}
                  {money(m.amount)}
                </span>
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Lo que ya debían antes de usar B-POS (la libreta) */
function PreviousDebt({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");

  async function save() {
    if (!accountKey(name, phone)) return alert("Escribe el nombre del cliente.");
    if (!(Number(amount) > 0)) return alert("Escribe cuánto debe.");
    if (!(await requirePermissionOrAdmin(getCurrentUser(), "pos.discount", `agregar deuda anterior de ${name}`))) return;
    try {
      chargeCredit({ name, phone, amount: Number(amount), note: "Deuda anterior (libreta)" });
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "No se pudo guardar.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-3xl border border-zinc-800 bg-zinc-950 p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-2xl font-black text-orange-500">Deuda anterior</h2>
        <p className="text-sm text-zinc-400">Lo que ya te debía de la libreta, para que quede en su cuenta.</p>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" maxLength={60} className={input} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="WhatsApp (10 dígitos, opcional)" inputMode="tel" className={input} />
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Cuánto debe" inputMode="decimal" className={`${input} text-xl font-black`} />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-2xl border border-zinc-800 py-3 font-black">
            Cancelar
          </button>
          <button onClick={save} className="flex-1 rounded-2xl bg-orange-500 py-3 font-black text-black">
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
