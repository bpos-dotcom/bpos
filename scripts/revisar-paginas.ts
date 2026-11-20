/**
 * Revisión en navegador real: abre las páginas en Chrome sin ventana y falla
 * si alguna truena (error de JavaScript o la pantalla "This page couldn't load").
 * Las pruebas de lógica no ven esto: el 19-20 nov 2026 el menú digital estuvo
 * caído con todas las pruebas en verde.
 *
 *   npx tsx scripts/revisar-paginas.ts                         (producción)
 *   npx tsx scripts/revisar-paginas.ts http://localhost:3000   (local)
 *
 * Chrome: CHROME_PATH o la ruta normal de Windows / Linux.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = (process.argv[2] || process.env.BPOS_URL || "https://www.bpos.com.mx").replace(/\/$/, "");
const MENU = process.env.BPOS_MENU_SLUG || "burger-planet";

/** Lo público primero: es lo que ven los clientes */
const PAGES = process.env.BPOS_PAGES ? process.env.BPOS_PAGES.split(",") : [`/m/${MENU}`, "/", "/login", "/pos", "/kiosco", "/demo", "/ayuda", "/terminos", "/privacidad"];

/** Textos que solo salen cuando la página tronó */
const CRASH_TEXT = ["This page couldn't load", "This page couldn’t load", "Application error", "client-side exception", "Maximum call stack"];

function chromePath() {
  const list = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  const found = list.find((p) => p && existsSync(p));
  if (!found) throw new Error("No encontré Chrome (pon CHROME_PATH)");
  return found;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const port = 9300 + Math.floor(Math.random() * 500);
  const chrome = spawn(chromePath(), ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "bpos-revisar-"))}`, "--no-first-run", "--no-sandbox", "--disable-gpu", "about:blank"], { stdio: "ignore" });
  let fails = 0;
  try {
    let wsUrl = "";
    for (let i = 0; i < 50 && !wsUrl; i++) {
      await sleep(200);
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
        wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl || "";
      } catch {}
    }
    if (!wsUrl) throw new Error("Chrome no arrancó");

    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
    let id = 0;
    const waiting = new Map<number, (v: unknown) => void>();
    let errors: string[] = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id && waiting.has(m.id)) {
        waiting.get(m.id)!(m.result);
        waiting.delete(m.id);
      } else if (m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails;
        errors.push(d.exception?.description?.split("\n")[0] || d.text);
      }
    };
    const send = (method: string, params: object = {}) =>
      new Promise<any>((r) => {
        const n = ++id;
        waiting.set(n, r);
        ws.send(JSON.stringify({ id: n, method, params }));
      });
    await send("Runtime.enable");
    await send("Page.enable");
    // Sin trabajador de servicio: que no salga una versión vieja guardada
    await send("Network.enable");
    await send("Network.setBypassServiceWorker", { bypass: true });

    for (const path of PAGES) {
      errors = [];
      const url = `${BASE}${path}`;
      await send("Page.navigate", { url });
      // Que cargue y que corran los efectos (el menú baja sus datos después)
      await sleep(7000);
      const r = await send("Runtime.evaluate", { expression: "document.body ? document.body.innerText : ''", returnByValue: true });
      const text = String(r?.result?.value || "");
      const crash = CRASH_TEXT.find((t) => text.includes(t));
      const bad = crash || errors.length > 0 || text.trim().length < 20;
      if (bad) fails++;
      console.log(`${bad ? "FALLA" : "OK   "} ${path}${crash ? ` → pantalla de error: "${crash}"` : ""}${errors.length ? ` → ${[...new Set(errors)].slice(0, 3).join(" | ")}` : ""}${!crash && text.trim().length < 20 ? " → página en blanco" : ""}`);
    }
    ws.close();
  } finally {
    chrome.kill();
  }
  console.log(fails ? `\n${fails} página(s) con error en ${BASE}` : `\nTodas las páginas cargan bien en ${BASE}`);
  if (fails) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
