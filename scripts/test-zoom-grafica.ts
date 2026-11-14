/**
 * Zoom y mover de la gráfica "Cómo vamos" en pantalla completa.
 *   npx tsx scripts/test-zoom-grafica.ts
 */
import { clampView, panView, visibleRange, zoomView } from "@/lib/chart-view";

let ok = 0;
let bad = 0;
const check = (name: string, cond: boolean) => {
  if (cond) ok++;
  else bad++;
  console.log(`${cond ? "OK   " : "FALLA"} ${name}`);
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

const month = { start: 0, end: 29 };
const z = zoomView(month, 0.5, 0.5, 30);
check("acercar a la mitad deja ~14.5 días", near(z.end - z.start, 14.5));
check("acercar en el centro queda centrado", near((z.start + z.end) / 2, 14.5));
const zl = zoomView(month, 0.5, 0, 30);
check("acercar en la orilla izquierda empieza en el día 1", near(zl.start, 0));
check("nunca menos de 2 días de distancia", near(zoomView(month, 0.001, 0.5, 30).end - zoomView(month, 0.001, 0.5, 30).start, 2));
check("alejar no pasa del periodo completo", near(zoomView(z, 10, 0.5, 30).start, 0) && near(zoomView(z, 10, 0.5, 30).end, 29));
const p = panView({ start: 5, end: 10 }, -20, 30);
check("mover hacia atrás se detiene en el día 1", near(p.start, 0) && near(p.end, 5));
const p2 = panView({ start: 5, end: 10 }, 50, 30);
check("mover hacia adelante se detiene en el último día", near(p2.end, 29) && near(p2.start, 24));
check("semana: acercar al máximo deja 3 días", near(zoomView({ start: 0, end: 6 }, 0.1, 1, 7).end - zoomView({ start: 0, end: 6 }, 0.1, 1, 7).start, 2));
check("un solo día no se rompe", near(clampView({ start: 0, end: 0 }, 1).end, 0));
check("dos días: se ve todo", near(clampView({ start: 0, end: 1 }, 2).end, 1));
const r = visibleRange({ start: 2.4, end: 7.6 }, 30);
check("días visibles enteros dentro de la ventana", r[0] === 3 && r[1] === 7);
check("ventana inválida se corrige", near(clampView({ start: NaN, end: NaN }, 7).start, 0));

console.log(`\n${ok} bien, ${bad} mal`);
process.exit(bad ? 1 : 0);
