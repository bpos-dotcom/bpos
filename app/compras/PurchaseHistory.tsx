"use client";

import { useEffect, useState } from "react";

type Purchase = {
  id: number;
  createdAt: string;
  supplier: string;
  ingredientName: string;
  quantity: number;
  unit: string;
  note: string;
};

const PURCHASES_KEY = "bpos_purchases";

export default function PurchaseHistory() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);

  useEffect(() => {
    refresh();
  }, []);

  function refresh() {
    const saved = localStorage.getItem(PURCHASES_KEY);
    setPurchases(saved ? JSON.parse(saved) : []);
  }

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-orange-500">
            Historial de compras
          </h2>

          <p className="mt-2 text-sm text-zinc-400">
            Todas las compras registradas se muestran aquí.
          </p>
        </div>

        <div className="rounded-2xl bg-orange-500 px-4 py-2 font-black text-black">
          {purchases.length} compras
        </div>
      </div>

      <div className="mt-6 space-y-3">
        {purchases.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 p-8 text-center text-zinc-500">
            Todavía no existen compras registradas.
          </div>
        ) : (
          [...purchases].reverse().map((purchase) => (
            <div
              key={purchase.id}
              className="rounded-2xl border border-zinc-800 bg-black p-5"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-lg font-black">
                    {purchase.ingredientName}
                  </p>

                  <p className="text-sm text-zinc-400">
                    Proveedor: {purchase.supplier}
                  </p>

                  {purchase.note && (
                    <p className="mt-1 text-sm text-zinc-500">
                      {purchase.note}
                    </p>
                  )}

                  <p className="mt-2 text-xs text-zinc-600">
                    {new Date(purchase.createdAt).toLocaleString()}
                  </p>
                </div>

                <div className="text-right">
                  <p className="text-2xl font-black text-green-400">
                    +{purchase.quantity} {purchase.unit}
                  </p>

                  <span className="mt-2 inline-block rounded-xl bg-zinc-900 px-3 py-1 text-xs text-zinc-300">
                    Compra registrada
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}