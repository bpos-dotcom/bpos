"use client";

import { useRef, useState } from "react";

type Props = {
  onLinesDetected?: (lines: string[]) => void;
};

export default function PurchasePhoto({ onLinesDetected }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [ticketText, setTicketText] = useState("");

  function handleFile(file: File) {
    const url = URL.createObjectURL(file);
    setPreview(url);
  }

  function processTicket() {
    const lines = ticketText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      alert("Escribe al menos una línea del ticket.");
      return;
    }

    if (onLinesDetected) {
      onLinesDetected(lines);
    }

    alert("Ticket procesado. Revisa los productos detectados.");
  }

  return (
    <section className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
      <h2 className="text-xl font-black text-orange-500">Ticket de compra</h2>

      <p className="mt-2 text-sm text-zinc-400">
        Sube la foto del ticket y escribe las líneas principales. Después lo
        conectaremos con OCR automático.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleFile(file);
        }}
      />

      <div
        className="mt-6 flex h-72 cursor-pointer items-center justify-center rounded-3xl border-2 border-dashed border-zinc-700 bg-black transition hover:border-orange-500"
        onClick={() => inputRef.current?.click()}
      >
        {preview ? (
          <img
            src={preview}
            alt="Ticket"
            className="h-full w-full rounded-3xl object-contain"
          />
        ) : (
          <div className="text-center">
            <div className="text-6xl">📷</div>
            <p className="mt-4 font-black">Tocar para tomar foto</p>
            <p className="mt-2 text-sm text-zinc-500">
              También puedes seleccionar una imagen.
            </p>
          </div>
        )}
      </div>

      <textarea
        value={ticketText}
        onChange={(event) => setTicketText(event.target.value)}
        placeholder={`Escribe productos del ticket, uno por línea:\nBBQ ABAL\nPAPAS 15 KG\nPAN BRIOCHE`}
        className="mt-5 min-h-40 w-full rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white placeholder:text-zinc-600"
      />

      <button
        onClick={processTicket}
        className="mt-4 w-full rounded-2xl bg-orange-500 py-3 font-black text-black"
      >
        Procesar ticket
      </button>
    </section>
  );
}