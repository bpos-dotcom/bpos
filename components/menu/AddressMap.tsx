"use client";
/**
 * Dirección de entrega con mapa (menú digital, pedido a domicilio). El
 * cliente busca su calle o usa su ubicación y pone el pin en su casa; se
 * guarda la dirección y el punto exacto, que se manda al repartidor como
 * liga de Google Maps.
 *
 * Servicios gratis y sin llave, hechos con datos de OpenStreetMap:
 *   - mapa: OpenFreeMap (permite uso comercial);
 *   - buscador: Photon (hecho para buscar mientras se escribe).
 * El buscador encuentra la calle, no siempre el número: por eso se pide
 * acomodar el pin en la casa.
 */
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";

type Place = { lat: number; lng: number };
type Result = { name: string; place: Place };
type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: { name?: string; street?: string; housenumber?: string; locality?: string; district?: string; city?: string; state?: string; postcode?: string; countrycode?: string };
};

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const PHOTON = "https://photon.komoot.io";
/** Centro de México si todavía no hay nada */
const START: Place = { lat: 23.6345, lng: -102.5528 };

/** "Avenida Madero 364, Centro Lerdo, Ciudad Lerdo, Durango" */
function label(p: PhotonFeature["properties"]) {
  const street = [p.street || p.name, p.housenumber].filter(Boolean).join(" ");
  const parts = [street, p.street && p.name && p.name !== p.street ? p.name : "", p.locality || p.district, p.city, p.state];
  return [...new Set(parts.filter(Boolean))].join(", ");
}

async function search(q: string, near: Place | null): Promise<Result[]> {
  const bias = near ? `&lat=${near.lat}&lon=${near.lng}` : "";
  const r = await fetch(`${PHOTON}/api/?q=${encodeURIComponent(q)}&limit=8${bias}`);
  if (!r.ok) return [];
  const b = (await r.json()) as { features?: PhotonFeature[] };
  return (b.features || [])
    .filter((f) => f.properties.countrycode === "MX")
    .slice(0, 5)
    .map((f) => ({ name: label(f.properties), place: { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] } }));
}

async function reverse(p: Place): Promise<string> {
  const r = await fetch(`${PHOTON}/reverse?lat=${p.lat}&lon=${p.lng}&limit=1`);
  if (!r.ok) return "";
  const b = (await r.json()) as { features?: PhotonFeature[] };
  return b.features?.[0] ? label(b.features[0].properties) : "";
}

export function AddressMap({
  location,
  color,
  onChange,
}: {
  location: Place | null;
  color: string;
  /**
   * Punto elegido, la dirección que corresponde (si se encontró) y si el
   * punto es exacto: GPS, pin movido o confirmado por el cliente.
   */
  onChange: (place: Place, address: string, precise: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const pin = useRef<Marker | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  /** Después de buscar: falta que el cliente ponga el pin en su casa */
  const [needsPin, setNeedsPin] = useState(false);
  const current = useRef<Place | null>(location);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Mapa (MapLibre solo funciona en el navegador)
  useEffect(() => {
    let cancelled = false;
    let resize: ResizeObserver | null = null;
    void import("maplibre-gl").then(({ default: maplibregl }) => {
      if (cancelled || !box.current || map.current) return;
      const start = location || START;
      const m = new maplibregl.Map({ container: box.current, style: MAP_STYLE, center: [start.lng, start.lat], zoom: location ? 17 : 4, attributionControl: { compact: true } });
      m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-left");
      const marker = new maplibregl.Marker({ color, draggable: true }).setLngLat([start.lng, start.lat]).addTo(m);
      const place = async (p: Place) => {
        marker.setLngLat([p.lng, p.lat]);
        current.current = p;
        setNeedsPin(false);
        setNote("Buscando la dirección del punto...");
        const name = await reverse(p).catch(() => "");
        setNote("✅ Pin en tu casa. Revisa abajo calle y número.");
        onChangeRef.current(p, name, true);
      };
      marker.on("dragend", () => {
        const ll = marker.getLngLat();
        void place({ lat: ll.lat, lng: ll.lng });
      });
      m.on("click", (e) => void place({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
      map.current = m;
      pin.current = marker;
      // Si el recuadro cambia de tamaño (aviso del pin, teclado del celular), el mapa se acomoda
      resize = new ResizeObserver(() => m.resize());
      resize.observe(box.current);
    });
    return () => {
      cancelled = true;
      resize?.disconnect();
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
      setResults(await search(q, current.current).catch(() => []));
      setBusy(false);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [query]);

  function show(p: Place, zoom: number) {
    map.current?.jumpTo({ center: [p.lng, p.lat], zoom });
    pin.current?.setLngLat([p.lng, p.lat]);
    current.current = p;
  }

  function choose(r: Result) {
    show(r.place, 18);
    setResults([]);
    setQuery("");
    setNote("");
    setNeedsPin(true);
    onChange(r.place, r.name, false);
  }

  function useMine() {
    if (!navigator.geolocation) return setNote("Tu celular no permite compartir la ubicación.");
    setNote("Buscando tu ubicación...");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        show(p, 18);
        const name = await reverse(p).catch(() => "");
        setNeedsPin(false);
        setNote("✅ Ubicación agregada. Revisa que el pin esté en tu casa.");
        onChange(p, name, true);
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
              <button key={`${r.place.lat},${r.place.lng},${r.name}`} type="button" onClick={() => choose(r)} className="block w-full border-b border-zinc-100 px-4 py-2 text-left text-sm hover:bg-zinc-50">
                📍 {r.name}
              </button>
            ))}
          </div>
        )}
      </div>
      {needsPin && (
        <div className="mt-2 rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
          <b>📍 Pon el pin justo en tu casa:</b> el buscador te deja en tu calle. Arrastra el pin o toca el mapa en tu puerta.
          <button
            type="button"
            onClick={() => {
              setNeedsPin(false);
              setNote("✅ Pin confirmado.");
              if (current.current) onChange(current.current, "", true);
            }}
            className="mt-2 block w-full rounded-lg bg-amber-400 py-2 font-black text-amber-950"
          >
            Ya está en mi casa
          </button>
        </div>
      )}
      {/* El borde cambia de color afuera: las clases del recuadro del mapa no se tocan (MapLibre pone las suyas) */}
      <div className={`mt-2 overflow-hidden rounded-xl border ${needsPin ? "border-amber-400" : "border-zinc-200"}`}>
        <div ref={box} className="relative h-64 w-full" />
      </div>
      <button type="button" onClick={useMine} className="mt-2 w-full rounded-xl border border-zinc-200 py-2.5 text-sm font-black">
        📍 Usar mi ubicación actual (lo más exacto)
      </button>
      {note && <p className="mt-1 text-xs text-zinc-500">{note}</p>}
    </div>
  );
}
