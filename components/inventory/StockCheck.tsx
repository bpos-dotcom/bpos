"use client";
/**
 * Revisar insumos (Inventario real, Ingredientes y Packaging): lo que está
 * bajo de su mínimo o agotado, y lo que entró o salió en los últimos días.
 */
import Link from "next/link";
import type { Ingredient } from "@/data/inventory";
import { movementLabel, type InventoryMovement } from "@/lib/inventory";

export type StockCheck = "" | "bajo" | "agotado" | "entradas" | "salidas";

export const STOCK_CHECKS: [StockCheck, string][] = [
  ["", "Todo"],
  ["bajo", "⚠️ Bajo"],
  ["agotado", "⛔ Agotado"],
  ["entradas", "⬆️ Entradas"],
  ["salidas", "⬇️ Salidas"],
];

export const isOut = (i: Ingredient) => i.stock <= 0;
export const isLow = (i: Ingredient) => i.stock > 0 && i.stock <= i.minimum;
export const isMovesCheck = (c: StockCheck) => c === "entradas" || c === "salidas";

/** Entradas y salidas: de cuántos días atrás */
export const MOVES_DAYS = 30;

/** 4.959999999999 → "4.96" (hasta 3 decimales, sin ceros de más) */
export const qty = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : String(n));

/** Los insumos que pasan el filtro de bajo o agotado (Todo, Entradas y Salidas: todos) */
export function checkItems(items: Ingredient[], check: StockCheck) {
  return check === "bajo" ? items.filter(isLow) : check === "agotado" ? items.filter(isOut) : items;
}

/**
 * Entradas (compras, devoluciones, ajustes +) o salidas (ventas, mermas,
 * ajustes −) de esos insumos en los últimos MOVES_DAYS días, lo más nuevo primero.
 */
export function stockMoves(kardex: InventoryMovement[], items: Ingredient[], check: StockCheck) {
  if (!isMovesCheck(check)) return [];
  const ids = new Set(items.map((i) => i.id));
  const since = Date.now() - MOVES_DAYS * 24 * 3600_000;
  return kardex
    .filter((m) => ids.has(m.ingredientId) && Date.parse(m.createdAt) >= since && (check === "entradas" ? m.finalStock > m.previousStock : m.finalStock < m.previousStock))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/** Botones Todo · Bajo · Agotado · Entradas · Salidas (bajo y agotado con cuántos hay) */
export function CheckChips({ items, check, onChange }: { items: Ingredient[]; check: StockCheck; onChange: (c: StockCheck) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Revisar">
      {STOCK_CHECKS.map(([k, text]) => {
        const n = k === "bajo" ? items.filter(isLow).length : k === "agotado" ? items.filter(isOut).length : null;
        const on = check === k;
        const alarm = n ? (k === "agotado" ? "border-red-500/60 text-red-300" : "border-amber-500/60 text-amber-300") : "border-zinc-800 text-zinc-400";
        return (
          <button
            key={k || "todo"}
            type="button"
            onClick={() => onChange(k)}
            aria-pressed={on}
            className={`rounded-xl border px-3 py-1.5 text-xs font-black ${on ? "border-orange-500 bg-orange-500/15 text-orange-200" : `${alarm} bg-black hover:border-zinc-600`}`}
          >
            {text}
            {n !== null && <span className="ml-1 opacity-80">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Etiqueta de Bajo o Agotado junto al nombre */
export function StockBadge({ item }: { item: Ingredient }) {
  if (isOut(item)) return <span className="shrink-0 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-black text-red-300">⛔ Agotado</span>;
  if (isLow(item)) return <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-black text-amber-300">⚠️ Bajo</span>;
  return null;
}

/** Un movimiento de entrada o salida; al tocarlo abre el insumo (href) o lo selecciona (onClick) */
export function MoveCard({ move: m, name, selected, href, onClick }: { move: InventoryMovement; name?: string; selected?: boolean; href?: string; onClick?: () => void }) {
  const up = m.finalStock > m.previousStock;
  const className = `flex w-full items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition ${selected ? "border-orange-500 bg-orange-500/10" : "border-zinc-800 bg-black hover:border-orange-500"}`;
  const body = (
    <>
      <div className="min-w-0">
        <p className="font-black">{name || m.ingredientName}</p>
        <p className="text-xs text-zinc-400">
          {movementLabel(m)}
          {m.orderId ? ` · pedido #${String(m.orderId).padStart(6, "0")}` : ""}
          {m.userName ? ` · ${m.userName}` : ""}
        </p>
        {m.reason && <p className="truncate text-xs text-zinc-500">{m.reason}</p>}
        <p className="text-[11px] text-zinc-600">
          {new Date(m.createdAt).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {qty(m.previousStock)} → {qty(m.finalStock)} {m.unit}
        </p>
      </div>
      <p className={`shrink-0 text-lg font-black ${up ? "text-green-400" : "text-red-400"}`}>
        {up ? "+" : "-"}
        {qty(Math.abs(m.finalStock - m.previousStock))} {m.unit}
      </p>
    </>
  );
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}

/** Lista de entradas o salidas con su encabezado y el aviso cuando no hay */
export function MovesList({ moves, check, scope, renderMove }: { moves: InventoryMovement[]; check: StockCheck; scope?: string; renderMove: (m: InventoryMovement) => React.ReactNode }) {
  const LIMIT = 300;
  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500">
        {check === "entradas" ? "Lo que entró" : "Lo que salió"} en los últimos {MOVES_DAYS} días{scope ? ` · ${scope}` : ""}: {moves.length} movimiento{moves.length === 1 ? "" : "s"}
      </p>
      {moves.slice(0, LIMIT).map((m, index) => (
        <div key={`${m.id}-${index}`}>{renderMove(m)}</div>
      ))}
      {moves.length > LIMIT && <p className="text-xs text-zinc-500">Se ven los {LIMIT} más nuevos; el kardex completo está en Inventario.</p>}
      {moves.length === 0 && <p className="text-sm text-zinc-500">{check === "entradas" ? "Nada entró" : "Nada salió"} en los últimos {MOVES_DAYS} días.</p>}
    </div>
  );
}
