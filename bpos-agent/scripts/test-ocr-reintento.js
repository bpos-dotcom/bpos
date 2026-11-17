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
  await punteadas();
})();

// Ticket como el de DiDi: el producto y el Subtotal entre líneas punteadas pegadas
async function punteadas() {
  const { withoutRuleLines } = require("../lib/pdf-ocr-reader");
  const W = 1700;
  const rows = [["#4", 0], ["Alondra", 0], ["Notas del pedido", 0], ["dots"], ["1x  Hamburguesa Kansas City.", 1], ["dots"], ["Subtotal", 1], ["dots"], ["Total a pagar          MX$119.54", 0], ["solid"]];
  const canvas = createCanvas(W, 120 + rows.length * 70);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, canvas.height);
  ctx.fillStyle = "#000";
  ctx.font = "44px sans-serif";
  let y = 70;
  for (const [text] of rows) {
    if (text === "dots") { for (let x = 30; x < W - 30; x += 12) ctx.fillRect(x, y - 20, 7, 5); y += 25; continue; }
    if (text === "solid") { ctx.fillRect(30, y - 20, W - 60, 5); y += 25; continue; }
    ctx.fillText(text, 40, y + 20);
    y += 70;
  }
  const { canvas: clean, removed } = withoutRuleLines(canvas);
  check("borra las líneas punteadas y la sólida", removed >= 4 * 5, removed);
  const c = clean.getContext("2d").getImageData(0, 0, W, clean.height).data;
  let darkRows = 0;
  for (let yy = 0; yy < clean.height; yy++) { let d = 0; for (let x = 0; x < W; x++) { const i = (yy * W + x) * 4; if (c[i] < 128) d++; } if (d / W > 0.35) darkRows++; }
  check("ya no queda ninguna línea", darkRows === 0, darkRows);
  const r = await ocrPages([async () => canvas]);
  check("lee el producto del ticket con líneas punteadas", /Hamburguesa Kansas City/i.test(r.text) && countProductLines(r.text) >= 1, r.text);
  await terminateOcrWorker();
  console.log(`\n${ok} bien, ${bad} con falla`);
  if (bad) process.exit(1);
}
