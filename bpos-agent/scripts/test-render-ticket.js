// Prueba del ticket sin archivos: npx electron scripts/test-render-ticket.js
// Bloquea el acceso a archivos (como cuando el antivirus no deja leer Temp)
// y revisa que el ticket se dibuje igual, con su alto y sus imágenes.
const { app } = require("electron");
const fs = require("fs");
const { renderHtmlTicket } = require("../lib/station-printer");

let ok = 0;
let bad = 0;
const check = (name, cond, extra) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}${!cond && extra !== undefined ? ` → ${JSON.stringify(extra)}` : ""}`);
};

app.on("window-all-closed", () => {});
app.whenReady().then(async () => {
  const realWrite = fs.writeFileSync;
  fs.writeFileSync = () => {
    throw new Error("ERR_FAILED (-2) simulado: no se puede escribir el ticket");
  };
  try {
    const dot = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const lines = Array.from({ length: 40 }, (_, i) => `<p>1 x Producto ${i}</p>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;font:16px monospace"><img src="${dot}" style="width:100px;height:100px">${lines}</body></html>`;
    const shot = await renderHtmlTicket(html);
    check("se dibuja sin poder escribir archivos", shot.dataUrl.startsWith("data:image/png"));
    check("con el alto de todo el ticket", shot.height > 600, shot.height);
    const big = html.replace("</body>", `<p>${"x".repeat(2 * 1024 * 1024)}</p></body>`);
    const shotBig = await renderHtmlTicket(big);
    check("ticket muy grande (más de 2 MB) también", shotBig.height > 600, shotBig.height);
  } catch (e) {
    check("sin error", false, String(e && e.message));
  } finally {
    fs.writeFileSync = realWrite;
  }
  console.log(`\n${ok} bien, ${bad} mal`);
  app.exit(bad ? 1 : 0);
});
