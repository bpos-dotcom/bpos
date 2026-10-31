"use client";
/**
 * POS · Club de clientes: el cajero busca al socio por teléfono o escanea
 * el QR de su tarjeta (el lector escribe el código). Con el socio elegido
 * la venta le suma al cobrar; aquí mismo canjea premios o sellos, y el
 * saldo de cashback se usa al cobrar.
 */
import { useEffect, useState } from "react";
import { getCurrentUser } from "@/lib/auth";
import { LOYALTY_EVENT, balanceLabel, clubName, getLoyalty, type LoyaltyConfig } from "@/lib/loyalty";
import { findMembers, redeemLoyalty, type ClubMember } from "@/lib/loyalty-pos";
import { getBusinessSettings } from "@/lib/business-settings";

export function ClubPanel({ member, onChange }: { member: ClubMember | null; onChange: (m: ClubMember | null) => void }) {
  const [config, setConfig] = useState<LoyaltyConfig | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClubMember[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const load = () => setConfig(getLoyalty());
    load();
    window.addEventListener(LOYALTY_EVENT, load);
    return () => window.removeEventListener(LOYALTY_EVENT, load);
  }, []);

  if (!config?.enabled) return null;
  const name = clubName(config, getBusinessSettings().businessName || "");

  async function search() {
    setBusy(true);
    setMessage("");
    try {
      const found = await findMembers(query);
      setResults(found);
      if (found.length === 1) pick(found[0]);
      if (!found.length) setMessage("No hay un cliente con ese teléfono o código.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo buscar.");
    } finally {
      setBusy(false);
    }
  }

  function pick(m: ClubMember) {
    onChange(m);
    setResults(null);
    setQuery("");
    setMessage(m.member ? "" : `${m.name} tiene cuenta pero no se ha unido al club: que entre a su tarjeta para unirse.`);
  }

  async function redeem(use: { points?: number; stamps?: number }, note: string) {
    if (!member || !confirm(`¿Canjear "${note}" para ${member.name}?`)) return;
    setBusy(true);
    try {
      const b = await redeemLoyalty(member.account_id, use, note, `pos:${Date.now()}`, getCurrentUser()?.name || "");
      onChange({ ...member, points: Number(b.points), stamps: Number(b.stamps), cashback: Number(b.cashback) });
      setMessage(`✅ Canjeado: ${note}. Entrégalo al cliente.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "No se pudo canjear.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-sm font-black text-orange-400">⭐ {name}</p>
      {member ? (
        <div className="mt-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-black">{member.name}</p>
              <p className="text-xs text-zinc-500">
                {member.phone}
                {member.code ? ` · ${member.code}` : ""}
              </p>
            </div>
            <button onClick={() => onChange(null)} className="text-xs font-black text-zinc-400 underline">
              Quitar
            </button>
          </div>
          {member.member && <p className="mt-2 text-lg font-black text-orange-300">{balanceLabel(config, member)}</p>}
          {member.member && <p className="text-xs text-zinc-500">Al cobrar se le suma esta venta.</p>}
          {member.member && config.kind === "puntos" && config.rewards.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {config.rewards.map((r) => (
                <button
                  key={r.id}
                  disabled={busy || member.points < r.points}
                  onClick={() => void redeem({ points: r.points }, r.name)}
                  className="rounded-xl border border-orange-500/60 px-3 py-1.5 text-xs font-black text-orange-300 disabled:opacity-30"
                >
                  🎁 {r.name} · {r.points} pts
                </button>
              ))}
            </div>
          )}
          {member.member && config.kind === "sellos" && member.stamps >= config.stampsGoal && (
            <button
              disabled={busy}
              onClick={() => void redeem({ stamps: config.stampsGoal }, config.stampReward || "Premio de sellos")}
              className="mt-2 w-full rounded-xl bg-emerald-500 py-2 text-sm font-black text-black"
            >
              🎉 Canjear premio: {config.stampReward || "premio"}
            </button>
          )}
          {member.member && config.kind === "cashback" && member.cashback > 0 && <p className="mt-1 text-xs text-emerald-400">Puede usar su saldo al cobrar.</p>}
        </div>
      ) : (
        <>
          <div className="mt-2 flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && void search()}
              placeholder="Teléfono o código de tarjeta"
              className="min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-black px-3 py-2.5 text-sm text-white"
            />
            <button disabled={busy || !query.trim()} onClick={() => void search()} className="rounded-2xl border border-orange-500 px-3 text-sm font-black text-orange-300 disabled:opacity-40">
              {busy ? "..." : "Buscar"}
            </button>
          </div>
          {results && results.length > 1 && (
            <div className="mt-2 space-y-1">
              {results.map((r) => (
                <button key={r.account_id} onClick={() => pick(r)} className="block w-full rounded-xl bg-black px-3 py-2 text-left text-sm">
                  {r.name} · {r.phone}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {message && <p className="mt-2 text-xs font-bold text-yellow-200">{message}</p>}
    </section>
  );
}
