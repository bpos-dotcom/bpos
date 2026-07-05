"use client";

import { useEffect, useState } from "react";
import { Product } from "@/data/products";
import { getAdminProducts } from "@/lib/admin";
import {
  addBridgeAlias,
  getBridgeAliases,
  BridgeAlias,
} from "@/lib/bridge/aliases";

export default function BridgeAliases() {
  const [products, setProducts] = useState<Product[]>([]);
  const [aliases, setAliases] = useState<BridgeAlias[]>([]);
  const [externalName, setExternalName] = useState("");
  const [productId, setProductId] = useState("");

  useEffect(() => {
    setProducts(getAdminProducts());
    refreshAliases();
  }, []);

  function refreshAliases() {
    setAliases(getBridgeAliases());
  }

  function saveAlias() {
    if (!externalName.trim()) {
      alert("Escribe el nombre como viene en Didi/Uber.");
      return;
    }

    if (!productId) {
      alert("Selecciona el producto real de B-POS.");
      return;
    }

    const product = products.find((item) => item.id === Number(productId));
    if (!product) return;

    addBridgeAlias({
      externalName,
      productId: product.id,
      productName: product.name,
    });

    setExternalName("");
    setProductId("");
    refreshAliases();
  }

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <h2 className="text-xl font-black text-orange-500">
        Equivalencias Bridge
      </h2>

      <p className="mt-2 text-sm text-zinc-400">
        Relaciona cómo viene escrito el producto en Didi/Uber con el producto
        real del POS.
      </p>

      <div className="mt-6 space-y-4">
        <input
          value={externalName}
          onChange={(event) => setExternalName(event.target.value)}
          placeholder="Ej. Classic Burger"
          className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
        />

        <select
          value={productId}
          onChange={(event) => setProductId(event.target.value)}
          className="w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white"
        >
          <option value="">Producto real en B-POS</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>

        <button
          onClick={saveAlias}
          className="w-full rounded-2xl bg-orange-500 py-3 font-black text-black"
        >
          Guardar equivalencia
        </button>
      </div>

      <div className="mt-6 space-y-3">
        {aliases.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-800 p-5 text-center text-sm text-zinc-500">
            Todavía no hay equivalencias Bridge.
          </div>
        ) : (
          aliases.map((alias) => (
            <div
              key={alias.id}
              className="rounded-2xl border border-zinc-800 bg-black p-4"
            >
              <p className="font-black">{alias.externalName}</p>
              <p className="text-sm text-zinc-400">→ {alias.productName}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}