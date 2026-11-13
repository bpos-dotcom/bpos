/**
 * Dominios propios de los negocios que llevan a su página en B-POS (menú,
 * club…). Se configuran en Vercel con la variable DOMAIN_REDIRECTS:
 *   "burger.com.mx=/m/burger,otro.mx=/fidelidad/otro"
 * El dominio (con o sin www) y cualquier ruta suya (ej. el /Landing-Page/ de
 * un QR ya impreso) caen en esa página de www.bpos.com.mx.
 * Sin imports de la app: lo usa next.config.
 */
export const BPOS_ORIGIN = "https://www.bpos.com.mx";

export function parseDomainRedirects(raw: string | undefined) {
  const out: { host: string; path: string }[] = [];
  for (const pair of String(raw || "").split(/[,;\n]/)) {
    const [h, p] = pair.split("=").map((s) => s?.trim() || "");
    const host = h.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
    if (!host || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || !p) continue;
    const path = `/${p.replace(/^https?:\/\/[^/]+/, "").replace(/^\/+/, "")}`;
    out.push({ host, path });
  }
  return out;
}

export function domainRedirects(raw: string | undefined) {
  return parseDomainRedirects(raw).flatMap(({ host, path }) =>
    [host, `www.${host}`].flatMap((value) => {
      const has = [{ type: "host" as const, value }];
      const destination = `${BPOS_ORIGIN}${path}`;
      return [
        { source: "/", has, destination, permanent: false },
        { source: "/:path*", has, destination, permanent: false },
      ];
    })
  );
}
