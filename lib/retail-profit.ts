/**
 * Tienda y ferretería → Utilidad (lo que en el restaurante es Food cost):
 * cuánto deja cada artículo. Por artículo: lo vendido en el periodo (con el
 * precio real de cada venta: mayoreo, granel), lo que costó y la ganancia;
 * arriba, la ganancia de todo menos los gastos fijos del periodo.
 * Costo: el que tiene el artículo; si no, el de su última compra.
 */
import type { Product } from "@/data/products";

export type ProfitOrder = { items: { id: number; price: number; quantity: number }[]; details?: { discount?: number }; subtotal?: number };

export type ProfitRow = {
  product: Product;
  /** Lo que cuesta y lo que deja cada unidad al precio de lista */
  cost: number | null;
  unitProfit: number | null;
  margin: number | null;
  /** En el periodo */
  sold: number;
  sales: number;
  costOfSales: number | null;
  profit: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function retailProfit(products: Product[], orders: ProfitOrder[], costOf: (p: Product) => number | null) {
  const sold = new Map<number, { qty: number; sales: number }>();
  let discounts = 0;
  for (const o of orders) {
    for (const i of o.items || []) {
      const qty = Number(i.quantity) || 0;
      const s = sold.get(Number(i.id)) || { qty: 0, sales: 0 };
      s.qty += qty;
      s.sales += round2((Number(i.price) || 0) * qty);
      sold.set(Number(i.id), s);
    }
    discounts += Math.max(0, Number(o.details?.discount) || 0);
  }
  const rows: ProfitRow[] = products
    .filter((p) => !p.notSoldAlone)
    .map((product) => {
      const c = costOf(product);
      const cost = c !== null && c > 0 ? c : null;
      const s = sold.get(Number(product.id)) || { qty: 0, sales: 0 };
      const price = Number(product.price) || 0;
      // Precio libre ("Varios"): no se sabe su costo
      const known = cost !== null && !product.openPrice;
      const costOfSales = known ? round2(cost! * s.qty) : null;
      return {
        product,
        cost: known ? cost : null,
        unitProfit: known && price ? round2(price - cost!) : null,
        margin: known && price ? Math.round(((price - cost!) / price) * 1000) / 10 : null,
        sold: round3(s.qty),
        sales: round2(s.sales),
        costOfSales,
        profit: costOfSales !== null ? round2(s.sales - costOfSales) : null,
      };
    });
  const withCost = rows.filter((r) => r.profit !== null && r.sold > 0);
  const totals = {
    sales: round2(rows.reduce((s, r) => s + r.sales, 0)),
    discounts: round2(discounts),
    profit: round2(withCost.reduce((s, r) => s + (r.profit || 0), 0) - discounts),
    /** Vendido sin costo capturado: su ganancia no se sabe */
    salesWithoutCost: round2(rows.filter((r) => r.profit === null && r.sold > 0).reduce((s, r) => s + r.sales, 0)),
    missingCost: rows.filter((r) => r.cost === null && !r.product.openPrice).length,
  };
  return { rows, totals };
}
