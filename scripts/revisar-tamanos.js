/**
 * Revisión de tamaños (celular, tablet, PC): pega este archivo en la consola
 * del navegador con B-POS abierto (sesión iniciada) o córrelo con el
 * navegador de pruebas. Carga cada página en un recuadro del tamaño indicado
 * y regresa lo que se sale de la pantalla (scroll horizontal o elementos
 * cortados a la derecha que no están dentro de un recuadro con su propio scroll).
 *
 *   await window.revisarTamanos(["/pos", "/caja"], [[375, 812], [768, 1024], [1366, 900]])
 */
(function () {
  function describe(el) {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" ? `.${el.className.trim().split(/\s+/).slice(0, 4).join(".")}` : "";
    const text = (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 50);
    return `${el.tagName.toLowerCase()}${id}${cls} "${text}"`;
  }

  /** ¿Algún antepasado lo recorta o le da su propio scroll horizontal? */
  function clipped(el, win) {
    for (let p = el.parentElement; p && p !== win.document.body; p = p.parentElement) {
      // El contenedor general de la pantalla recorta (overflow-x-hidden): lo que pasa de él SÍ se ve cortado
      if (p.classList.contains("bpos-main") || p.tagName === "MAIN") continue;
      const ox = win.getComputedStyle(p).overflowX;
      if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") {
        const r = p.getBoundingClientRect();
        if (r.right <= win.innerWidth + 1) return true;
      }
    }
    return false;
  }

  function check(win) {
    const doc = win.document;
    const W = win.innerWidth;
    const problems = [];
    if (doc.documentElement.scrollWidth > doc.documentElement.clientWidth + 1) problems.push(`página con scroll horizontal (${doc.documentElement.scrollWidth}px de ${doc.documentElement.clientWidth}px)`);
    const seen = new Set();
    for (const el of doc.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const st = win.getComputedStyle(el);
      if (st.visibility === "hidden" || st.position === "fixed" && r.left >= W) continue;
      if (r.right <= W + 1 && r.left >= -1) continue;
      if (clipped(el, win)) continue;
      // Solo el más externo de cada rama
      let parentBad = false;
      for (let p = el.parentElement; p; p = p.parentElement) if (seen.has(p)) { parentBad = true; break; }
      if (parentBad) continue;
      seen.add(el);
      problems.push(`${describe(el)} → ${Math.round(r.left)}..${Math.round(r.right)} (pantalla ${W})`);
    }
    return problems.slice(0, 12);
  }

  async function load(frame, url) {
    await new Promise((resolve) => {
      frame.onload = () => resolve();
      frame.src = url;
    });
    // Esperar a que la app pinte (cliente) y se calme
    await new Promise((r) => setTimeout(r, 2500));
  }

  window.revisarTamanos = async function (routes, sizes) {
    const out = {};
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;left:0;top:0;border:0;z-index:2147483647;background:#000";
    document.body.appendChild(frame);
    try {
      for (const [w, h] of sizes) {
        frame.style.width = `${w}px`;
        frame.style.height = `${h}px`;
        for (const route of routes) {
          await load(frame, route);
          const problems = check(frame.contentWindow);
          if (problems.length) out[`${w} ${route}`] = problems;
        }
      }
    } finally {
      frame.remove();
    }
    return out;
  };
})();
