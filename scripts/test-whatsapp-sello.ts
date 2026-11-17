/**
 * Mensaje de WhatsApp al sumar en el club (sellos, puntos, cashback).
 *   npx tsx scripts/test-whatsapp-sello.ts
 */
import { DEFAULT_LOYALTY, earnedWhatsappText } from "@/lib/loyalty";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` -> ${JSON.stringify(extra)}` : ""}`);
};

const sellos = { ...DEFAULT_LOYALTY, enabled: true, kind: "sellos" as const, name: "Club BP", stampsGoal: 8, stampReward: "una hamburguesa gratis" };
const t = earnedWhatsappText(sellos, { points: 0, stamps: 1, cashback: 0 }, { points: 0, stamps: 4, cashback: 0 }, { name: "Ana López", business: "Burger Planet", clubLink: "https://www.bpos.com.mx/fidelidad/burger-planet" });
console.log(t);
check("dice que juntó un nuevo sello", t.includes("Juntaste un nuevo sello en *Club BP* de Burger Planet"));
check("saluda por su nombre", t.startsWith("¡Hola Ana!"));
check("cuánto lleva y cuánto falta", t.includes("Llevas 4 de 8") && t.includes("faltan 4 sellos para una hamburguesa gratis"));
check("verificar en su cuenta o Google Wallet con la liga", t.includes("verificar tus sellos en tu cuenta o en tu tarjeta de Google Wallet: https://www.bpos.com.mx/fidelidad/burger-planet"));
const full = earnedWhatsappText(sellos, { points: 0, stamps: 1, cashback: 0 }, { points: 0, stamps: 8, cashback: 0 }, { name: "", business: "Burger Planet" });
check("completó la tarjeta", full.includes("Completaste tus 8 sellos") && full.startsWith("¡Hola! 🧡"));
check("sin sello (compra bajo el mínimo): no hay mensaje", earnedWhatsappText(sellos, { points: 0, stamps: 0, cashback: 0 }, { points: 0, stamps: 4, cashback: 0 }, { business: "BP" }) === "");
const puntos = earnedWhatsappText({ ...sellos, kind: "puntos" }, { points: 12, stamps: 0, cashback: 0 }, { points: 40, stamps: 0, cashback: 0 }, { business: "BP" });
check("puntos", puntos.includes("Juntaste 12 puntos") && puntos.includes("verificar tus puntos"));
console.log(`\n${ok} bien, ${bad} con falla`);
if (bad) process.exit(1);
