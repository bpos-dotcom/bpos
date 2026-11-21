/**
 * Promociones del menú digital: tipos (%, pesos, 2x1, envío gratis), para
 * quién (todos, nuevos, club), vigencia, compra mínima, que se elija la que
 * más ahorra y que se guarden con el menú.
 *   npx tsx scripts/test-promociones.ts
 */
import { normalizeDigitalMenu } from "../lib/digital-menu";
import { bestPromotion, evaluatePromotion, newPromotion, normalizePromotions, onlineDiscount, promoLabel, promoState, promotionError, visiblePromotions, type PromoContext, type Promotion } from "../lib/promotions";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

const promo = (p: Partial<Promotion>): Promotion => ({ ...newPromotion(), audience: "all", ...p });
const now = new Date(2026, 10, 21, 12);
const ctx = (p: Partial<PromoContext> = {}): PromoContext => ({
  lines: [
    { productId: 1, category: "Burgers", unitPrice: 120, quantity: 1 },
    { productId: 2, category: "Burgers", unitPrice: 100, quantity: 1 },
    { productId: 3, category: "Bebidas", unitPrice: 30, quantity: 2 },
  ],
  subtotal: 280,
  delivery: false,
  deliveryFee: 0,
  isNew: false,
  isClub: false,
  now,
  ...p,
});

// 10% en la primera compra (lo del ejemplo)
const primera = promo({ kind: "percent", value: 10, audience: "new" });
check("10% primera compra: cliente nuevo → $28", evaluatePromotion(primera, ctx({ isNew: true }))?.discount === 28, evaluatePromotion(primera, ctx({ isNew: true })));
check("10% primera compra: cliente que ya pidió → no aplica", evaluatePromotion(primera, ctx({ isNew: false })) === null);
check("etiqueta: '10% de descuento en tu primera compra'", promoLabel(primera) === "10% de descuento en tu primera compra", promoLabel(primera));
check("con nombre propio se usa ese", promoLabel({ ...primera, name: "Bienvenido: 10%" }) === "Bienvenido: 10%");

// Tope y compra mínima
check("% con tope: 50% hasta $60", evaluatePromotion(promo({ kind: "percent", value: 50, maxDiscount: 60 }), ctx())?.discount === 60);
check("compra mínima no alcanzada → no aplica", evaluatePromotion(promo({ kind: "amount", value: 50, minPurchase: 300 }), ctx()) === null);
check("compra mínima alcanzada → $50", evaluatePromotion(promo({ kind: "amount", value: 50, minPurchase: 250 }), ctx())?.discount === 50);
check("descuento en pesos no pasa del subtotal", evaluatePromotion(promo({ kind: "amount", value: 999 }), ctx())?.discount === 280);

// Club
const club = promo({ kind: "percent", value: 15, audience: "club" });
check("club: socio → aplica", evaluatePromotion(club, ctx({ isClub: true }))?.discount === 42);
check("club: no socio → no aplica", evaluatePromotion(club, ctx()) === null);

// 2x1
const burgers = promo({ kind: "2x1", categories: ["Burgers"] });
check("2x1 en Burgers: la más barata ($100) gratis", evaluatePromotion(burgers, ctx())?.discount === 100, evaluatePromotion(burgers, ctx()));
const refrescos = promo({ kind: "2x1", productIds: [3] });
check("2x1 en un producto: 2 refrescos → 1 gratis ($30)", evaluatePromotion(refrescos, ctx())?.discount === 30);
check("2x1 con una sola pieza → no aplica", evaluatePromotion(refrescos, ctx({ lines: [{ productId: 3, category: "Bebidas", unitPrice: 30, quantity: 1 }], subtotal: 30 })) === null);
check("2x1 sin elegir productos → todo el menú (120,100,30,30 → 100+30)", evaluatePromotion(promo({ kind: "2x1" }), ctx())?.discount === 130);
check("2x1 con 3 piezas → solo 1 gratis", evaluatePromotion(refrescos, ctx({ lines: [{ productId: 3, category: "Bebidas", unitPrice: 30, quantity: 3 }], subtotal: 90 }))?.discount === 30);

check("etiqueta del 2x1 dice en qué", promoLabel(burgers) === "2x1 en Burgers" && promoLabel(refrescos) === "2x1 en productos seleccionados", [promoLabel(burgers), promoLabel(refrescos)]);

// Envío gratis
const envio = promo({ kind: "freeShipping", minPurchase: 200 });
check("envío gratis: a domicilio → sí", evaluatePromotion(envio, ctx({ delivery: true, deliveryFee: 35 }))?.freeShipping === true);
check("envío gratis: para recoger → no aplica", evaluatePromotion(envio, ctx({ delivery: false })) === null);
check("envío gratis con envío por cotizar también aplica", evaluatePromotion(envio, ctx({ delivery: true, deliveryFee: 0 }))?.freeShipping === true);
check("envío gratis no descuenta productos", evaluatePromotion(envio, ctx({ delivery: true, deliveryFee: 35 }))?.discount === 0);

// Vigencia y pausa
check("pausada → no aplica", evaluatePromotion(promo({ kind: "amount", value: 20, active: false }), ctx()) === null);
check("vencida → no aplica", evaluatePromotion(promo({ kind: "amount", value: 20, until: "2026-11-20" }), ctx()) === null);
check("por empezar → no aplica", evaluatePromotion(promo({ kind: "amount", value: 20, from: "2026-11-22" }), ctx()) === null);
check("el último día sí aplica", evaluatePromotion(promo({ kind: "amount", value: 20, until: "2026-11-21" }), ctx())?.discount === 20);
check("estado 'por empezar'", promoState(promo({ from: "2026-12-01" }), now) === "por empezar");

// La mejor
const best = bestPromotion([primera, burgers, envio], ctx({ isNew: true, delivery: true, deliveryFee: 35 }));
check("se elige la que más ahorra (2x1 $100 > 10% $28 > envío $35)", best?.promo.id === burgers.id, best);
check("ninguna aplica → null", bestPromotion([club], ctx()) === null);
check("visibles: solo las activas", visiblePromotions([primera, promo({ active: false })], now).length === 1);

// Revisión al guardar
check("sin descuento → error", promotionError(promo({ kind: "percent", value: 0 })) !== "");
check("más de 100% → error", promotionError(promo({ kind: "percent", value: 150 })) !== "");
check("fechas al revés → error", promotionError(promo({ kind: "amount", value: 10, from: "2026-12-10", until: "2026-12-01" })) !== "");
check("2x1 sin valor → bien", promotionError(promo({ kind: "2x1", value: 0 })) === "");

// Guardado y datos viejos
const saved = normalizeDigitalMenu({ promotions: [primera, { id: "x", kind: "raro", audience: "nadie", value: "10" }, { kind: "percent" }] } as never);
check("se guardan con el menú", saved.promotions.length === 2 && saved.promotions[0].id === primera.id, saved.promotions);
check("tipo y público desconocidos → % y todos", saved.promotions[1].kind === "percent" && saved.promotions[1].audience === "all");
check("menú viejo sin promociones → lista vacía", normalizeDigitalMenu({}).promotions.length === 0);
check("normalizar recorta % a 100", normalizePromotions([{ id: "a", kind: "percent", value: 300 }])[0].value === 100);

// Descuento total del pedido en línea
check("cupón + promoción se suman en el total del pedido", onlineDiscount({ coupon: { discount: 10 }, promo: { discount: 5.5 } }) === 15.5);
check("sin descuentos → 0", onlineDiscount({}) === 0);

console.log(`\n${ok} bien, ${bad} mal`);
if (bad) process.exit(1);
