/**
 * OCR de tickets: cuenta los renglones de producto y, si la primera lectura
 * no trae ninguno, vuelve a leer con otros modos sin romperse.
 *   node scripts/test-ocr-reintento.js
 */
const { createCanvas } = require("@napi-rs/canvas");
const { countProductLines, ocrPages, terminateOcrWorker } = require("../lib/pdf-ocr-reader");

let ok = 0;
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ""}`);
};

const didi4 = "#4\nCO DiDiFood\nBurger Planet\nAlondra\nDto. de producto -MX$35.10\nTarifa de entrega MX$18.00\nTotal a pagar MX$119.54\nPago en efectivo";
const didi3 = "#3\nOJ DiDiFood\n1x Papas Fritas Dobles(200GR) MX$88.59\nDeseas agregar algun extra?\n[2x] Aderezo especial MX$0.00\n1x Catsup MX$0.00\n1X Hamburguesa Polaca. MX$129.99\n1X No, Gracias MX$0.00\nSubtotal MX$218.58";
check("DiDi #4 (sin productos): 0 renglones", countProductLines(didi4) === 0);
check("DiDi #3: 5 renglones de producto", countProductLines(didi3) === 5, countProductLines(didi3));
check("'66 Notas del pedido' no es producto", countProductLines("66 Notas del pedido") === 0);
check("'Pago de DiDi Food MX$0.00' no es producto", countProductLines("Pago de DiDi Food MX$0.00") === 0);

function ticket(lines) {
  const canvas = createCanvas(700, 60 + lines.length * 44);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.font = "30px sans-serif";
  lines.forEach((l, i) => ctx.fillText(l, 20, 50 + i * 44));
  return canvas;
}

(async () => {
  const withProducts = await ocrPages([async () => ticket(["#7", "DiDiFood", "1x Combo Especial MX$189.00", "1x Hamburguesa Polaca MX$0.00", "Total a pagar MX$189.00"])]);
  check("OCR real: lee los productos", countProductLines(withProducts.text) >= 1, withProducts.text);
  const without = await ocrPages([async () => ticket(["#8", "DiDiFood", "Total a pagar MX$119.54", "Pago en efectivo"])]);
  check("OCR real sin productos: reintenta y regresa el texto sin romperse", /119/.test(without.text), without.text);
  await terminateOcrWorker();
  console.log(`\n${ok} bien, ${bad} con falla`);
  if (bad) process.exit(1);
})();
