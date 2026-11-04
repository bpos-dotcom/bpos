// Service worker de B-POS.
//  1. Avisos de la App del dueño (push) y abrir B-POS al tocarlos.
//  2. Modo sin internet: guarda las pantallas de B-POS y sus archivos para
//     que abran aunque se vaya el internet. Siempre se pide primero a
//     internet; lo guardado solo se usa si no hay conexión.
//     Nunca guarda /api ni nada de otros sitios (la nube de datos va aparte).

const PAGES = "bpos-pages-v1";
const STATIC = "bpos-static-v1";
// Pantallas que se dejan listas para abrir sin internet
const CORE_ROUTES = ["/inicio", "/pos", "/caja", "/historial", "/cocina", "/login", "/impresiones", "/pedidos-en-linea", "/caja/historial", "/checador"];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PAGES, STATIC]);
      for (const name of await caches.keys()) if (name.startsWith("bpos-") && !keep.has(name)) await caches.delete(name);
      await self.clients.claim();
    })()
  );
});

// ------------------------------------------------------------ avisos (push)

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "B-POS", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag,
      data: { url: data.url || "/dueno" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/dueno";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).pathname === url);
      if (open) return open.focus();
      return self.clients.openWindow(url);
    })
  );
});

// ------------------------------------------------------------ sin internet

const isStatic = (url) => url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/sounds/") || /\.(png|svg|ico|woff2?)$/.test(url.pathname);
const isRsc = (request, url) => request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
const pageKey = (url) => new URL(url.pathname, url.origin).toString(); // la pantalla sin parámetros

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;

  // Archivos de la app (cambian de nombre en cada versión): lo guardado primero
  if (isStatic(url)) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
    );
    return;
  }

  // Cambios de pantalla dentro de B-POS: sin internet falla y B-POS abre la pantalla completa (abajo)
  if (isRsc(request, url)) return;

  // Pantallas: internet primero; si no hay, la última copia guardada
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PAGES);
        try {
          const response = await fetch(request);
          if (response.ok && response.type === "basic") cache.put(pageKey(url), response.clone());
          return response;
        } catch {
          const hit = (await cache.match(pageKey(url))) || (await cache.match(new URL("/inicio", url.origin).toString())) || (await cache.match(new URL("/pos", url.origin).toString()));
          if (hit) return hit;
          return new Response(
            '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="background:#000;color:#fff;font-family:sans-serif;display:grid;place-items:center;height:100vh;text-align:center"><div><h1>Sin internet</h1><p>Esta pantalla todavía no se había abierto en este equipo.<br>Abre la caja (POS) o vuelve cuando regrese el internet.</p><p><a style="color:#f97316" href="/pos">Ir a la caja</a></p></div>',
            { status: 503, headers: { "content-type": "text/html; charset=utf-8" } }
          );
        }
      })()
    );
  }
});

// Deja listas las pantallas principales y sus archivos (lo pide B-POS al abrir, con internet)
async function warm() {
  const pages = await caches.open(PAGES);
  const statics = await caches.open(STATIC);
  const referenced = new Set();
  for (const route of CORE_ROUTES) {
    try {
      const url = new URL(route, self.location.origin);
      const response = await fetch(url, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) continue;
      const html = await response.clone().text();
      await pages.put(url.toString(), response);
      for (const match of html.matchAll(/\/_next\/static\/[^"'\s)\\]+/g)) referenced.add(new URL(match[0], self.location.origin).toString());
    } catch {
      // sin internet o la pantalla falló: se intenta la próxima vez
    }
  }
  for (const file of referenced) {
    if (await statics.match(file)) continue;
    try {
      const response = await fetch(file);
      if (response.ok) await statics.put(file, response);
    } catch {
      // se guarda cuando se use
    }
  }
  // Archivos de versiones anteriores que ya nadie usa
  if (referenced.size > 20) {
    for (const request of await statics.keys()) {
      const u = new URL(request.url);
      if (u.pathname.startsWith("/_next/static/chunks/") && !referenced.has(request.url)) {
        const response = await statics.match(request);
        const date = response && Date.parse(response.headers.get("date") || "");
        // Se deja una semana por si alguna pantalla abierta todavía los pide
        if (date && Date.now() - date > 7 * 24 * 3600 * 1000) await statics.delete(request);
      }
    }
  }
}

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "bpos:warm") event.waitUntil(warm());
});
