import { ImageResponse } from "next/og";

/** Ícono de B-POS (cuadro naranja con "BP") en PNG del tamaño pedido. */
export function appIcon(size: number, { rounded = true } = {}) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f97316",
          borderRadius: rounded ? size * 0.22 : 0,
          color: "#000",
          fontSize: size * 0.42,
          fontWeight: 900,
          letterSpacing: -size * 0.02,
        }}
      >
        BP
      </div>
    ),
    { width: size, height: size }
  );
}
