"use client";
/**
 * Opiniones (Entrega 3): lo que califican tus clientes al recibir su pedido
 * del menú digital. Promedio, estrellas, las de 4-5 que se invitaron a
 * Google y las de 1-3 que llegaron solo a ti para atenderlas.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { getCurrentUser } from "@/lib/auth";
import { DIGITAL_MENU_EVENT, getDigitalMenu, saveDigitalMenu } from "@/lib/digital-menu";
import { REVIEWS_EVENT, attendReview, listReviews, needsAttention, reopenReview, reviewWhatsappLink, type Review } from "@/lib/reviews";

const card = "rounded-3xl border border-zinc-800 bg-zinc-950 p-5";
type Filter = "atender" | "todas" | "buenas" | "malas";

const Stars = ({ n, className = "" }: { n: number; className?: string }) => (
  <span className={`tracking-tight ${className}`}>
    <span className="text-amber-400">{"★".repeat(n)}</span>
    <span className="text-zinc-700">{"★".repeat(5 - n)}</span>
  </span>
);

const when = (iso: string) => new Date(iso).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function ReviewCard({ review, onChanged }: { review: Review; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const wa = reviewWhatsappLink(review);
  const pending = needsAttention(review);

  async function attend() {
    const answer = prompt("¿Cómo se atendió? (ej. le repusimos su pedido, le dimos un cupón)", "");
    if (answer === null) return;
    setBusy(true);
    try {
      await attendReview(review.id, answer, getCurrentUser()?.name || "");
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    setBusy(true);
    try {
      await reopenReview(review.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`${card} ${pending ? "border-red-500/60 bg-red-500/5" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Stars n={review.stars} className="text-2xl" />
          <p className="text-sm text-zinc-400">
            {review.customer_name || "Cliente"} · Pedido {review.folio} · {when(review.updated_at)}
          </p>
        </div>
        {review.stars >= 4 ? (
          <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-black text-emerald-300">Invitado a Google</span>
        ) : pending ? (
          <span className="rounded-full bg-red-500/20 px-3 py-1 text-xs font-black text-red-300">Por atender</span>
        ) : (
          <span className="rounded-full bg-zinc-800 px-3 py-1 text-xs font-black text-zinc-300">Atendida ✅</span>
        )}
      </div>
      {review.comment ? <p className="mt-3 rounded-2xl bg-black p-3 text-sm">“{review.comment}”</p> : <p className="mt-3 text-sm text-zinc-500">Sin comentario.</p>}
      {review.status === "atendida" && review.stars <= 3 && (
        <p className="mt-2 text-xs text-zinc-400">
          Atendida por {review.attended_by || "B-POS"}
          {review.attended_at ? ` el ${when(review.attended_at)}` : ""}
          {review.answer ? `: ${review.answer}` : ""}
        </p>
      )}
      {review.stars <= 3 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {wa && (
            <a href={wa} target="_blank" rel="noreferrer" className="rounded-2xl bg-[#25d366] px-4 py-2 text-sm font-black text-white">
              📲 Escribirle por WhatsApp
            </a>
          )}
          {pending ? (
            <button disabled={busy} onClick={() => void attend()} className="rounded-2xl border border-emerald-500 px-4 py-2 text-sm font-black text-emerald-300 disabled:opacity-50">
              ✅ Marcar atendida
            </button>
          ) : (
            <button disabled={busy} onClick={() => void reopen()} className="rounded-2xl border border-zinc-700 px-4 py-2 text-sm font-black text-zinc-400 disabled:opacity-50">
              Volver a abrir
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function GoogleLink() {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => {
    const read = () => {
      const url = getDigitalMenu().googleReviewUrl;
      setSaved(url);
      setValue(url);
    };
    read();
    window.addEventListener(DIGITAL_MENU_EVENT, read);
    return () => window.removeEventListener(DIGITAL_MENU_EVENT, read);
  }, []);
  const valid = /^https:\/\/\S+$/i.test(value.trim());

  return (
    <section className={card}>
      <h2 className="text-lg font-black">⭐ Tu liga de reseñas de Google</h2>
      <p className="mt-1 text-sm text-zinc-400">
        A quien te califica con 4 o 5 estrellas le sale un botón para dejarte su reseña en Google. Para sacar tu liga: en Google Maps busca tu negocio (con la
        cuenta del dueño) → <b>Pedir reseñas</b> → copia la liga y pégala aquí.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value.trim())}
          placeholder="https://g.page/r/..."
          className="min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
        />
        <button
          disabled={!valid && value !== ""}
          onClick={() => {
            saveDigitalMenu({ googleReviewUrl: value });
            setSaved(value);
          }}
          className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-black disabled:opacity-40"
        >
          Guardar
        </button>
      </div>
      {value && !valid && <p className="mt-1 text-xs text-red-300">La liga debe empezar con https://</p>}
      {saved && value === saved && <p className="mt-1 text-xs text-emerald-400">✅ Guardada. {saved ? <a href={saved} target="_blank" rel="noreferrer" className="underline">Probar liga</a> : null}</p>}
      {!saved && <p className="mt-1 text-xs font-bold text-yellow-300">Sin liga, las buenas calificaciones se guardan pero no se invita a Google.</p>}
    </section>
  );
}

export default function OpinionesPage() {
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("atender");

  const load = useCallback(async () => {
    try {
      setReviews(await listReviews());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las opiniones.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial desde la nube
    void load();
    const timer = setInterval(() => void load(), 30_000);
    const refresh = () => void load();
    window.addEventListener(REVIEWS_EVENT, refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener(REVIEWS_EVENT, refresh);
    };
  }, [load]);

  const stats = useMemo(() => {
    const list = reviews || [];
    const count = list.length;
    const avg = count ? list.reduce((s, r) => s + r.stars, 0) / count : 0;
    const by = [5, 4, 3, 2, 1].map((n) => ({ n, count: list.filter((r) => r.stars === n).length }));
    return {
      count,
      avg,
      by,
      google: list.filter((r) => r.stars >= 4).length,
      pending: list.filter(needsAttention).length,
      attended: list.filter((r) => r.stars <= 3 && r.status === "atendida").length,
      bad: list.filter((r) => r.stars <= 3).length,
    };
  }, [reviews]);

  const shown = (reviews || []).filter((r) =>
    filter === "atender" ? needsAttention(r) : filter === "buenas" ? r.stars >= 4 : filter === "malas" ? r.stars <= 3 : true
  );

  return (
    <AppShell title="Opiniones" subtitle="Lo que califican tus clientes al recibir su pedido del menú digital (últimos 90 días).">
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          <div className={card}>
            <p className="text-sm text-zinc-400">Promedio</p>
            <p className="text-4xl font-black">{stats.count ? stats.avg.toFixed(1) : "—"}</p>
            <Stars n={Math.round(stats.avg)} className="text-xl" />
          </div>
          <div className={card}>
            <p className="text-sm text-zinc-400">Calificaciones</p>
            <p className="text-4xl font-black">{stats.count}</p>
            <p className="text-xs text-zinc-500">{stats.google} invitadas a Google (4-5 ★)</p>
          </div>
          <div className={`${card} ${stats.pending ? "border-red-500/60" : ""}`}>
            <p className="text-sm text-zinc-400">Por atender</p>
            <p className={`text-4xl font-black ${stats.pending ? "text-red-400" : ""}`}>{stats.pending}</p>
            <p className="text-xs text-zinc-500">de {stats.bad} opiniones de 1 a 3 ★</p>
          </div>
          <div className={card}>
            {stats.by.map(({ n, count }) => (
              <div key={n} className="flex items-center gap-2 text-xs">
                <span className="w-6 font-black">{n}★</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                  <span className="block h-full rounded-full bg-amber-400" style={{ width: `${stats.count ? (count / stats.count) * 100 : 0}%` }} />
                </span>
                <span className="w-6 text-right text-zinc-400">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <GoogleLink />

        <div className="flex flex-wrap gap-2">
          {(
            [
              ["atender", `🔴 Por atender (${stats.pending})`],
              ["malas", `1 a 3 ★ (${stats.bad})`],
              ["buenas", `4 y 5 ★ (${stats.google})`],
              ["todas", `Todas (${stats.count})`],
            ] as [Filter, string][]
          ).map(([key, text]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-2xl border px-4 py-2 text-sm font-black ${filter === key ? "border-orange-500 bg-orange-500 text-black" : "border-zinc-800 text-zinc-300"}`}
            >
              {text}
            </button>
          ))}
        </div>

        {error && <p className="text-sm text-red-300">{error}</p>}
        {reviews === null && !error && <p className="text-zinc-500">Cargando...</p>}
        <div className="grid gap-4 lg:grid-cols-2">
          {shown.map((r) => <ReviewCard key={r.id} review={r} onChanged={() => void load()} />)}
        </div>
        {reviews && shown.length === 0 && (
          <p className="rounded-3xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
            {filter === "atender" ? "No hay opiniones por atender. 🎉" : "Todavía no hay opiniones aquí. Llegan cuando tus clientes califican su pedido del menú digital."}
          </p>
        )}
      </div>
    </AppShell>
  );
}
