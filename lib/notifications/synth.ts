"use client";
/**
 * Sonidos de aviso que B-POS genera en el momento con el audio del
 * navegador (no son archivos): suenan igual en cualquier caja y no hay que
 * descargarlos. Se eligen en Configuración → Notificaciones.
 */

type Out = { ctx: AudioContext; out: AudioNode };

/** Un tono que sube rápido y se apaga */
function tone({ ctx, out }: Out, f: number, t: number, d: number, v: number, a = 0.004) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + d + 0.05);
}

/** Campana: varios armónicos que se apagan a distinto ritmo */
function bell(o: Out, t: number, f: number, d: number, v: number) {
  for (const [r, k] of [[1, 1], [2, 0.35], [2.76, 0.25], [5.4, 0.12]]) tone(o, f * r, t, d / Math.sqrt(r), v * k);
}

/** Marimba o xilófono: golpe corto y redondo */
function marimba(o: Out, t: number, f: number) {
  tone(o, f, t, 0.45, 0.4);
  tone(o, f * 4, t, 0.08, 0.12, 0.002);
}

/** Piano aproximado: nota con armónicos */
function piano(o: Out, t: number, f: number) {
  tone(o, f, t, 1.6, 0.35);
  tone(o, f * 2, t, 1.0, 0.12);
  tone(o, f * 3, t, 0.6, 0.05);
}

/** Lo que se toque en `out` del resultado se repite en eco */
function echo({ ctx, out }: Out, delay: number, feedback: number): Out {
  const input = ctx.createGain();
  const dl = ctx.createDelay(2);
  const fb = ctx.createGain();
  dl.delayTime.value = delay;
  fb.gain.value = feedback;
  input.connect(out);
  input.connect(dl);
  dl.connect(fb).connect(dl);
  dl.connect(out);
  return { ctx, out: input };
}

/** Cada sonido toca sus notas desde `t` y regresa cuánto dura (segundos) */
const SYNTHS: Record<string, { name: string; play: (o: Out, t: number) => number }> = {
  "synth:xilofono": { name: "Escala de xilófono", play: (o, t) => { [523, 587, 659, 784, 880, 1046].forEach((f, i) => marimba(o, t + i * 0.09, f)); marimba(o, t + 0.7, 1046); return 1.3; } },
  "synth:xilofono-remate": { name: "Xilófono tres y remate", play: (o, t) => { for (let r = 0; r < 2; r++) { [784, 988, 1175].forEach((f, i) => marimba(o, t + r * 0.8 + i * 0.1, f)); marimba(o, t + r * 0.8 + 0.42, 1568); } return 1.8; } },
  "synth:celesta": { name: "Celesta", play: (o, t) => { [1046, 1319, 1568, 2093].forEach((f, i) => bell(o, t + i * 0.1, f, 0.9, 0.18)); return 1.3; } },
  "synth:vibrafono": { name: "Vibráfono", play: (o, t) => { [523, 659, 784, 988].forEach((f, i) => bell(o, t + i * 0.18, f, 2.2, 0.28)); return 2.6; } },
  "synth:piano": { name: "Piano", play: (o, t) => { [523, 659, 784].forEach((f, i) => piano(o, t + i * 0.2, f)); return 2.0; } },
  "synth:sonar": { name: "Sonar", play: (o, t) => { [1, 0.45, 0.2, 0.09].forEach((k, i) => tone(o, 1200, t + i * 0.32, 0.6, 0.35 * k, 0.005)); return 1.7; } },
  "synth:sonar-doble": { name: "Sonar doble", play: (o, t) => { const e = echo(o, 0.32, 0.45); tone(e, 1200, t, 0.5, 0.32, 0.005); tone(e, 1500, t + 0.16, 0.5, 0.3, 0.005); return 2.0; } },
  "synth:cristal-eco": { name: "Cristal con eco", play: (o, t) => { bell(echo(o, 0.3, 0.45), t, 2093, 1.0, 0.3); return 2.0; } },
};

export const SYNTH_SOUNDS = Object.entries(SYNTHS).map(([src, s]) => ({ src, name: s.name }));

export const isSynthSound = (src: string) => src in SYNTHS;

/** Toca el sonido una vez; regresa cuánto dura (ms), 0 si el navegador no tiene audio */
export function playSynth(src: string) {
  const sound = SYNTHS[src];
  try {
    const Ctx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!sound || !Ctx) return 0;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);
    const secs = sound.play({ ctx, out: master }, ctx.currentTime + 0.05);
    // El eco se queda sonando un poco después
    window.setTimeout(() => void ctx.close(), secs * 1000 + 1500);
    return secs * 1000;
  } catch {
    return 0;
  }
}
