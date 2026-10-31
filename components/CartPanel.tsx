"use client";

import { useState } from "react";
import type { ExtraStation, Product } from "@/data/products";
import {
  modifiersText,
  type SoldModifier,
  type SoldPart,
} from "@/lib/compound";

export type CartItem = Product & {
  quantity: number;
  /** Renglón del carrito (el mismo producto con otras elecciones es otro renglón) */
  lineId?: string;
  /** Partes de un combo, con lo que se eligió */
  parts?: SoldPart[];
  /** Opciones elegidas (aderezo, salsas...); su precio ya está sumado en `price` */
  modifiers?: SoldModifier[];
  /** Con opciones enlazadas: el producto también manda su propia comanda (falso en combos) */
  ownTicket?: boolean;
  /** Comentario para la cocina ("sin cebolla") */
  comment?: string;
  /** Multidestino: otras estaciones que preparan una parte */
  extraStations?: ExtraStation[];
};

export const cartLineId = (item: CartItem) => item.lineId || String(item.id);

/** Comentario del renglón: se agrega o cambia desde el carrito. */
function CommentBox({
  comment,
  onSave,
}: {
  comment?: string;
  onSave: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment || "");
  if (!editing) {
    return (
      <button
        onClick={() => {
          setText(comment || "");
          setEditing(true);
        }}
        className="h-9 rounded-xl border border-zinc-700 px-3 text-xs font-black text-zinc-300"
      >
        💬 {comment ? "Editar comentario" : "Comentario"}
      </button>
    );
  }
  return (
    <div className="mt-2 w-full">
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Ej. sin cebolla, bien cocido..."
        aria-label="Comentario"
        rows={2}
        className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm"
      />
      <div className="mt-1 flex gap-2">
        <button
          onClick={() => setEditing(false)}
          className="flex-1 rounded-xl border border-zinc-800 py-2 text-xs font-black"
        >
          Cancelar
        </button>
        <button
          onClick={() => {
            onSave(text);
            setEditing(false);
          }}
          className="flex-1 rounded-xl bg-orange-500 py-2 text-xs font-black text-black"
        >
          Guardar
        </button>
      </div>
    </div>
  );
}

type RowActions = {
  onIncrease: (lineId: string) => void;
  onDecrease: (lineId: string) => void;
  onComment: (lineId: string, comment: string) => void;
};

/** Un renglón del pedido (chico en el panel, grande en la ventana completa) */
function CartRow({
  item,
  big,
  onIncrease,
  onDecrease,
  onComment,
}: RowActions & { item: CartItem; big?: boolean }) {
  return (
    <div
      className={`rounded-2xl border border-zinc-800 bg-black ${big ? "p-4" : "p-3"}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className={big ? "text-lg font-bold" : "font-bold"}>
            {item.quantity} × {item.name}
          </p>
          <p className="text-sm text-zinc-400">${item.price.toFixed(2)} c/u</p>
          {item.modifiers?.length ? (
            <p className="mt-1 text-xs text-zinc-300">
              {modifiersText(item.modifiers)}
            </p>
          ) : null}
          {item.parts?.length ? (
            <ul className="mt-1 space-y-0.5 text-xs text-zinc-400">
              {item.parts.map((part, i) => (
                <li key={i}>
                  » {part.quantity > 1 ? `${part.quantity}x ` : ""}
                  {part.name}{" "}
                  <span className="text-orange-400">· {part.station}</span>
                  {part.modifiers?.length ? (
                    <span className="block pl-3 text-zinc-300">
                      {modifiersText(part.modifiers)}
                    </span>
                  ) : null}
                  {part.comment ? (
                    <span className="block pl-3 font-bold text-yellow-200">
                      💬 {part.comment}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-orange-400">
              👨‍🍳{" "}
              {[
                item.station || "Cocina",
                ...(item.extraStations || []).map((e) => e.station),
              ].join(" + ")}
            </p>
          )}
          {item.comment && (
            <p className="mt-1 text-xs font-bold text-yellow-200">
              💬 {item.comment}
            </p>
          )}
        </div>

        <p className="font-black text-orange-500">
          ${(item.price * item.quantity).toFixed(2)}
        </p>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          onClick={() => onDecrease(cartLineId(item))}
          className="h-9 w-9 rounded-xl bg-zinc-800 font-black"
        >
          -
        </button>

        <button
          onClick={() => onIncrease(cartLineId(item))}
          className="h-9 w-9 rounded-xl bg-orange-500 font-black text-black"
        >
          +
        </button>

        <CommentBox
          comment={item.comment}
          onSave={(text) => onComment(cartLineId(item), text)}
        />
      </div>
    </div>
  );
}

type CartPanelProps = {
  items: CartItem[];
  discount: number;
  canCheckout: boolean;
  validationMessage: string;
  onIncrease: (lineId: string) => void;
  onDecrease: (lineId: string) => void;
  onComment: (lineId: string, comment: string) => void;
  onClear: () => void;
  onCheckout: () => void;
};

export function CartPanel({
  items,
  discount,
  canCheckout,
  validationMessage,
  onIncrease,
  onDecrease,
  onComment,
  onClear,
  onCheckout,
}: CartPanelProps) {
  const subtotal = items.reduce(
    (total, item) => total + item.price * item.quantity,
    0,
  );

  const total = Math.max(subtotal - discount, 0);
  const [expanded, setExpanded] = useState(false);
  const count = items.reduce((n, item) => n + item.quantity, 0);

  return (
    <aside className="rounded-3xl border border-zinc-800 bg-zinc-950 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-black text-orange-500">🛒 Pedido actual</h2>
        {items.length > 0 && (
          <button
            onClick={() => setExpanded(true)}
            className="rounded-xl border border-zinc-700 px-3 py-1.5 text-xs font-black text-zinc-200 hover:border-orange-500"
            title="Ver el pedido completo en grande"
          >
            🔍 Ver todo ({count})
          </button>
        )}
      </div>

      {/* Lista chica con su propio scroll: así caben abajo los detalles y el Club */}
      <div className="mt-3 max-h-[30dvh] space-y-2 overflow-y-auto bpos-scroll pr-1 md:max-h-[28dvh]">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">
            Agrega productos al pedido
          </div>
        ) : (
          items.map((item) => (
            <CartRow
              key={cartLineId(item)}
              item={item}
              onIncrease={onIncrease}
              onDecrease={onDecrease}
              onComment={onComment}
            />
          ))
        )}
      </div>

      <div className="mt-4 space-y-2 border-t border-zinc-800 pt-4">
        <div className="flex justify-between">
          <span className="text-zinc-400">Subtotal</span>
          <span className="font-black">${subtotal.toFixed(2)}</span>
        </div>

        {discount > 0 && (
          <div className="flex justify-between">
            <span className="text-zinc-400">Descuento autorizado</span>
            <span className="font-black text-red-400">
              -${discount.toFixed(2)}
            </span>
          </div>
        )}

        <div className="flex justify-between border-t border-zinc-800 pt-4">
          <span className="text-zinc-400">Total</span>
          <span className="text-3xl font-black text-orange-500">
            ${total.toFixed(2)}
          </span>
        </div>

        <button
          onClick={onCheckout}
          disabled={!canCheckout}
          className="mt-3 w-full rounded-2xl bg-orange-500 py-3 font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
        >
          Abrir cobro
        </button>

        {!canCheckout && (
          <p className="text-center text-xs text-zinc-500">
            {validationMessage}
          </p>
        )}

        <button
          onClick={onClear}
          disabled={items.length === 0}
          className="w-full rounded-2xl border border-red-500/40 bg-red-500/10 py-2.5 font-black text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Limpiar pedido
        </button>

        <p className="text-center text-xs text-zinc-600">
          Limpiar pedido requiere autorización Admin.
        </p>
      </div>

      {/* Ventana grande para revisar con calma todo lo que lleva el cliente */}
      {expanded && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setExpanded(false)}
        >
          <div
            className="flex max-h-[90dvh] w-full max-w-4xl flex-col rounded-3xl border border-zinc-800 bg-zinc-950 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-2xl font-black text-orange-500">
                🛒 Pedido actual · {count}{" "}
                {count === 1 ? "producto" : "productos"}
              </h3>
              <button
                onClick={() => setExpanded(false)}
                className="rounded-xl border border-zinc-700 px-4 py-2 font-black"
              >
                ✕ Cerrar
              </button>
            </div>
            <div className="mt-4 grid min-h-0 flex-1 gap-3 overflow-y-auto bpos-scroll pr-1 md:grid-cols-2">
              {items.map((item) => (
                <CartRow
                  key={cartLineId(item)}
                  item={item}
                  big
                  onIncrease={onIncrease}
                  onDecrease={onDecrease}
                  onComment={onComment}
                />
              ))}
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-zinc-800 pt-4">
              <span className="text-zinc-400">Total</span>
              <span className="text-3xl font-black text-orange-500">
                ${total.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
