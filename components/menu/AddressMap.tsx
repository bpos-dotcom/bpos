"use client";
/**
 * Dirección de entrega con mapa (menú digital, pedido a domicilio). El
 * cliente busca su calle o mueve el pin a su casa; se guarda la dirección y
 * el punto exacto, que se manda al repartidor como liga de Google Maps.
 * Mapa y buscador de OpenStreetMap (gratis, sin cuentas).
 */
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";

type Place = { lat: number; lng: number };
type Result = { display_name: string; lat: string; lon: string };

const NOMINATIM = "https://nominatim.openstreetmap.org";
/** Centro de México si todavía no hay nada */
const START: Place = { lat: 23.6345, lng: -102.5528 };

async function search(q: string): Promise<Result[]> {
  const url = `${NOMINATIM}/search?format=jsonv2&countrycodes=mx&limit=5&accept-language=es&q=${encodeURIComponent(q)}`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  return r.ok ? ((await r.json()) as Result[]) : [];
}

async function reverse(p: Place): Promise<string> {
  const url = `${NOMINATIM}/reverse?format=jsonv2&accept-language=es&lat=${p.lat}&lon=${p.lng}`;
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) return "";
  const b = (await r.json()) as { display_name?: string };
  return b.display_name || "";
}

/** "Calle 5, Colonia, Lerdo, Durango, 35150, México" → sin el país */
const short = (name: string) => name.replace(/,\s*México$/, "");

export function AddressMap({
  location,
  color,
  onChange,
}: {
  location: Place | null;
  color: string;
  /** Punto elegido y, si se pudo, la dirección que corresponde */
  onChange: (place: Place, address: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const pin = useRef<Marker | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Mapa (Leaflet solo funciona en el navegador)
  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !box.current || map.current) return;
      const start = location || START;
      const m = L.map(box.current, { zoomControl: true, attributionControl: true }).setView([start.lat, start.lng], location ? 17 : 5);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(m);
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:28px;height:28px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
      });
      const marker = L.marker([start.lat, start.lng], { draggable: true, icon }).addTo(m);
      const place = async (p: Place) => {
        marker.setLatLng([p.lat, p.lng]);
        setNote("Buscando la dirección del punto...");
        const name = await reverse(p).catch(() => "");
        setNote(name ? "" : "Escribe tu dirección con número abajo.");
        onChangeRef.current(p, name ? short(name) : "");
      };
      marker.on("dragend", () => {
        const ll = marker.getLatLng();
        void place({ lat: ll.lat, lng: ll.lng });
      });
      m.on("click", (e) => void place({ lat: e.latlng.lat, lng: e.latlng.lng }));
      map.current = m;
      pin.current = marker;
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- el mapa se crea una vez
  }, []);

  // Buscador (espera a que deje de escribir)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 4) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- limpiar resultados al borrar
      setResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setBusy(true);
      setResults(await search(q).catch(() => []));
      setBusy(false);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [query]);

  function choose(r: Result) {
    const p = { lat: Number(r.lat), lng: Number(r.lon) };
    map.current?.setView([p.lat, p.lng], 17);
    pin.current?.setLatLng([p.lat, p.lng]);
    setResults([]);
    setQuery("");
    setNote("Mueve el pin justo a tu casa si hace falta.");
    onChange(p, short(r.display_name));
  }

  function useMine() {
    if (!navigator.geolocation) return setNote("Tu celular no permite compartir la ubicación.");
    setNote("Buscando tu ubicación...");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        map.current?.setView([p.lat, p.lng], 18);
        pin.current?.setLatLng([p.lat, p.lng]);
        const name = await reverse(p).catch(() => "");
        setNote("✅ Ubicación agregada. Revisa que el pin esté en tu casa.");
        onChange(p, name ? short(name) : "");
      },
      () => setNote("No se pudo obtener tu ubicación. Busca tu calle arriba."),
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  return (
    <div className="mt-3">
      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔎 Busca tu calle y número, colonia, ciudad"
          className="w-full rounded-xl border border-zinc-200 px-4 py-3"
          autoComplete="off"
        />
        {(results.length > 0 || busy) && (
          <div className="absolute inset-x-0 top-full z-[1100] mt-1 max-h-56 overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-lg">
            {busy && <p className="px-4 py-2 text-xs text-zinc-500">Buscando...</p>}
            {results.map((r) => (
              <button key={`${r.lat},${r.lon}`} type="button" onClick={() => choose(r)} className="block w-full border-b border-zinc-100 px-4 py-2 text-left text-sm hover:bg-zinc-50">
                📍 {short(r.display_name)}
              </button>
            ))}
          </div>
        )}
      </div>
      <div ref={box} className="mt-2 h-56 w-full overflow-hidden rounded-xl border border-zinc-200" />
      <button type="button" onClick={useMine} className="mt-2 w-full rounded-xl border border-zinc-200 py-2.5 text-sm font-black">
        📍 Usar mi ubicación actual
      </button>
      {note && <p className="mt-1 text-xs text-zinc-500">{note}</p>}
    </div>
  );
}
