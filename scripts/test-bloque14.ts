/**
 * Prueba del bloque 14: nombre genérico del cliente oculto, espacio para
 * cortar, texto del QR y (si hay llave en esta computadora) sugerencias de
 * equivalencias con IA. La prueba de IA hace UNA consulta real (centavos).
 *   npx tsx scripts/test-bloque14.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDeliveryTicket, realCustomerName } from "@/lib/bridge/delivery-ticket";
import { saleTicket } from "@/lib/bridge/sale-tickets";
import { bagTicketHtml, stationTicketHtml } from "@/lib/bridge/ticket-html";
import { getBusinessSettings } from "@/lib/business-settings";
import { matchLines } from "@/lib/ai/match";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

// Nombres genéricos
check("'Usuario' no se imprime", realCustomerName("Usuario") === null);
check("'  cliente ' no se imprime", realCustomerName("  cliente ") === null);
check("'Cliente de plataforma' no se imprime", realCustomerName("Cliente de plataforma") === null);
check("'Ana López' sí", realCustomerName("Ana  López") === "Ana López");
const dt = buildDeliveryTicket({ platform: "didi", orderId: "9", rawText: "1x Hamburguesa $100", customer: { name: "Usuario" } }, new Map());
check("ticket DiDi sin 'Usuario'", dt.customer === null);
const settings = { ...getBusinessSettings(), ticketLogo: "", ticketShowCustomer: true };
check("comanda sin 'Usuario'", !stationTicketHtml(dt, "Cocina", settings, 58).includes("Usuario"));
const venta = saleTicket({ id: 1, createdAt: new Date().toISOString(), items: [{ name: "Hamburguesa", price: 100, quantity: 1 }], total: 100, details: { customerName: "Usuario" }, externalPlatform: "didi", deliveryTicket: { ...dt, customer: "Usuario" } });
check("reimpresión de venta guardada sin 'Usuario'", venta.customer === null);

// Espacio para cortar: 8 px por mm al final del ticket
const sin = stationTicketHtml(dt, "Cocina", { ...settings, ticketCutSpace: 0 }, 58);
const con = stationTicketHtml(dt, "Cocina", { ...settings, ticketCutSpace: 20 }, 58);
check("sin espacio: 14px al final", sin.includes("padding: 6px 4px 14px"));
check("20 mm: 174px al final", con.includes("padding: 6px 4px 174px"));
check("por defecto: 15 mm", getBusinessSettings().ticketCutSpace === 15);

// QR con su texto
const bolsa = bagTicketHtml(dt, { ...settings, ticketQrText: "https://wa.me/528711234567", ticketQrCaption: "Escanea para pedir directo" }, "<svg></svg>", 58);
check("QR con su texto debajo", bolsa.includes('class="qr"') && bolsa.includes("Escanea para pedir directo"));
check("sin QR no sale el texto", !bagTicketHtml(dt, { ...settings, ticketQrCaption: "Escanea" }, "", 58).includes("Escanea"));

// IA (solo si hay llave guardada en esta computadora)
async function main() {
const keyFile = path.join(os.homedir(), ".bpos", "anthropic-key");
const key = process.env.ANTHROPIC_API_KEY || (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, "utf8").trim() : "");
if (key) {
  const products = [
    { id: 1, name: "Boneless Orden Individual", category: "Boneless", price: 89 },
    { id: 2, name: "Boneless Orden Doble", category: "Boneless", price: 129 },
    { id: 3, name: "Refresco", category: "Bebidas", price: 35 },
    { id: 4, name: "Hamburguesa Sriracha", category: "Burgers", price: 139 },
  ];
  const matches = await matchLines(key, ["BONELESS INDIVIDUALES (8 pzs)", "Sin cubiertos", "Coca Cola 600ml", "Pizza hawaiana"], "Rappi", products);
  if (Array.isArray(matches)) {
    console.log("     IA:", matches.map((m) => `${m.line} → ${m.action}${m.productId ? ` #${m.productId}` : ""} (${m.confidence})`).join(" | "));
    check("IA: boneless 8 pzs → orden individual", matches[0]?.action === "product" && matches[0].productId === 1, matches[0]);
    check("IA: 'Sin cubiertos' se ignora", matches[1]?.action === "ignore", matches[1]);
    check("IA: pizza no existe → desconocido", matches[3]?.action === "unknown", matches[3]);
  } else check("IA respondió", false, matches);
} else console.log("     (sin llave de Anthropic en esta computadora: se salta la prueba de IA)");

console.log(`\n${ok} bien, ${bad} mal`);
process.exit(bad ? 1 : 0);
}
void main();
