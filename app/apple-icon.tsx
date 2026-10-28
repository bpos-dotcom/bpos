import { appIcon } from "@/lib/app-icon";

// Ícono para "Agregar a pantalla de inicio" en iPhone/iPad (iOS pone las esquinas)
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return appIcon(180, { rounded: false });
}
