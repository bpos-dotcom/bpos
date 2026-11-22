/**
 * Báscula (peso por cable y etiquetas que empiezan con 2) y granel con
 * fracciones en el menú digital (¼ kg, 1.5 m).
 *   npx tsx scripts/test-bascula-granel.ts
 */
import type { Product } from "@/data/products";

const store = new Map<string, string>();
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
};
g.window = { dispatchEvent: () => true, addEventListener: () => undefined, removeEventListener: () => undefined };

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

/** EAN-13 con su dígito de control */
function ean13(first12: string) {
  const sum = first12
    .split("")
    .map(Number)
    .reverse()
    .reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return first12 + ((10 - (sum % 10)) % 10);
}

async function main() {
  const sc = await import("@/lib/scale");
  const bo = await import("@/lib/bulk-online");

  // ---------------------------------------------- lo que manda la báscula por cable
  check("Torrey '  0.250kg'", sc.parseScaleWeight("  0.250kg\r\n") === 0.25);
  check("con encabezado 'ST,GS,+  1.235 kg'", sc.parseScaleWeight("ST,GS,+  1.235 kg\r\n") === 1.235);
  check("en gramos '750 g'", sc.parseScaleWeight("750 g") === 0.75);
  check("en libras '1.00 lb'", sc.parseScaleWeight("1.00 lb") === 0.454);
  check("solo número = kg", sc.parseScaleWeight("2.5") === 2.5);
  check("varias lecturas: la última", sc.parseScaleWeight("0.100kg\r\n0.480kg\r\n") === 0.48);
  check("coma decimal", sc.parseScaleWeight("0,350 kg") === 0.35);
  check("sin número → null", sc.parseScaleWeight("ERR") === null);
  check("peso a kg del artículo", sc.weightToUnit(0.4567, "kg") === 0.457);
  check("peso a gramos del artículo", sc.weightToUnit(0.4567, "g") === 457);
  check("metro no se pesa", sc.weightToUnit(1, "m") === null);

  // ---------------------------------------------- etiquetas de la báscula
  const peso = ean13("20" + "00012" + "00750"); // PLU 00012, 750 g
  const l1 = sc.parseScaleLabel(peso, { labelValue: "peso", pluDigits: 5 });
  check("etiqueta con peso: PLU y kg", l1?.plu === "00012" && l1?.value === 0.75 && l1?.kind === "peso", l1);
  const importe = ean13("20" + "00012" + "04500"); // $45.00
  const l2 = sc.parseScaleLabel(importe, { labelValue: "importe", pluDigits: 5 });
  check("etiqueta con importe: $45", l2?.value === 45 && l2?.kind === "importe", l2);
  check("dígito de control malo no es etiqueta", sc.parseScaleLabel(peso.slice(0, 12) + ((Number(peso[12]) + 1) % 10), { labelValue: "peso", pluDigits: 5 }) === null);
  check("código normal (750...) no es etiqueta", sc.parseScaleLabel("7501055300075", { labelValue: "peso", pluDigits: 5 }) === null);
  const l4 = sc.parseScaleLabel(ean13("20" + "0012" + "001250"), { labelValue: "peso", pluDigits: 4 });
  check("PLU de 4 dígitos", l4?.plu === "0012" && l4?.value === 1.25, l4);

  const items = [
    { id: 1, name: "Jamón", price: 180, unit: "kg", sellBy: "granel", barcode: "12" },
    { id: 2, name: "Queso", price: 0.2, unit: "g", sellBy: "granel", extraBarcodes: ["000045"] },
    { id: 3, name: "Coca", price: 20, barcode: "7501055300075" },
  ] as unknown as Product[];
  check("busca el artículo por PLU (con ceros)", sc.findByPlu(items, "00012")?.id === 1);
  check("PLU en código extra", sc.findByPlu(items, "45")?.id === 2);
  check("PLU que no existe", sc.findByPlu(items, "00099") === undefined);
  const line = sc.labelLine(items[0], l1!);
  check("renglón por peso: 0.75 kg a $180", line?.quantity === 0.75 && line?.price === 180, line);
  const lineG = sc.labelLine(items[1], l1!);
  check("artículo en gramos: 750 g", lineG?.quantity === 750, lineG);
  const lineImp = sc.labelLine(items[0], l2!);
  check("renglón por importe: $45 de jamón = 0.25 kg", lineImp?.quantity === 0.25, lineImp);

  store.delete(sc.SCALE_KEY);
  check("báscula apagada de fábrica", !sc.getScaleSettings().serialEnabled && !sc.getScaleSettings().labelsEnabled);
  sc.saveScaleSettings({ serialEnabled: true, baudRate: 4800, command: "W" });
  check("se guarda la configuración", sc.getScaleSettings().baudRate === 4800 && sc.getScaleSettings().command === "W");
  sc.saveScaleSettings({ baudRate: 1234 as never });
  check("velocidad inválida vuelve a 9600", sc.getScaleSettings().baudRate === 9600);

  // ---------------------------------------------- granel en el menú digital
  check("unidad a granel", bo.bulkUnitOf({ sellBy: "granel", unit: "kg" }) === "kg" && bo.bulkUnitOf({ sellBy: "pieza", unit: "kg" }) === null);
  check("¼ kg se respeta", bo.cleanOnlineQty(0.25, "kg") === 0.25);
  check("por pieza se redondea", bo.cleanOnlineQty(1.6, null) === 2);
  check("por pieza mínimo 1", bo.cleanOnlineQty(0.25, null) === 1);
  check("granel con tope", bo.cleanOnlineQty(9999, "kg") === 100);
  check("texto: 250 g", bo.qtyText(0.25, "kg") === "250 g");
  check("texto: 1.5 kg", bo.qtyText(1.5, "kg") === "1.5 kg");
  check("texto: 500 ml", bo.qtyText(0.5, "L") === "500 ml");
  check("texto: 3 m", bo.qtyText(3, "m") === "3 m");
  check("renglón: '250 g de Jitomate'", bo.lineLabel({ quantity: 0.25, unit: "kg", name: "Jitomate" }) === "250 g de Jitomate");
  check("renglón por pieza: '2 × Coca'", bo.lineLabel({ quantity: 2, name: "Coca" }) === "2 × Coca");
  check("+ a granel suma ¼", bo.stepQty({ quantity: 0.5, unit: "kg" }, 1) === 0.75);
  check("− a granel resta ¼", bo.stepQty({ quantity: 0.5, unit: "kg" }, -1) === 0.25);
  check("− abajo de ¼ quita el renglón", bo.stepQty({ quantity: 0.25, unit: "kg" }, -1) === 0);
  check("metro de a ½", bo.stepQty({ quantity: 1, unit: "m" }, 1) === 1.5);
  check("carrito: granel cuenta 1", bo.cartCount([{ quantity: 0.25, unit: "kg" }, { quantity: 2 }]) === 3);

  // La caja respeta la fracción al aceptar el pedido (y no deja colar decimales en piezas)
  const { buildOnlineCart } = await import("@/lib/online-orders");
  store.set("bpos_products", JSON.stringify([{ id: 10, name: "Jitomate", category: "Verdura", price: 32, emoji: "🍅", sellBy: "granel", unit: "kg" }, { id: 11, name: "Coca", category: "Bebidas", price: 20, emoji: "🥤" }]));
  store.set("bpos_digital_menu", JSON.stringify({ soldOut: {}, hidden: [] }));
  const built = buildOnlineCart({
    type: "Recoger",
    customer: { name: "Ana", phone: "", address: "", reference: "" },
    payment: "Efectivo",
    note: "",
    lines: [
      { productId: 10, name: "Jitomate", quantity: 0.25, unit: "kg", unitPrice: 32, picks: {}, summary: "" },
      { productId: 11, name: "Coca", quantity: 1.5, unitPrice: 20, picks: {}, summary: "" },
    ],
    subtotal: 0,
    deliveryFee: 0,
    total: 0,
  });
  const jit = built.cart.find((i) => i.id === 10);
  const coca = built.cart.find((i) => i.id === 11);
  check("venta: ¼ kg de jitomate", jit?.quantity === 0.25, jit?.quantity);
  check("venta: la Coca va entera", coca?.quantity === 2, coca?.quantity);
  check("subtotal con fracción ($8 + $40)", built.subtotal === 48, built.subtotal);

  console.log(`\n${ok} bien, ${bad} mal`);
  if (bad) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
