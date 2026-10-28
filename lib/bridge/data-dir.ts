import path from "node:path";

/**
 * Carpeta donde el Bridge guarda sus archivos (equivalencias, etc.).
 * Instalado, la app de escritorio la manda en BPOS_DATA_DIR (carpeta del
 * usuario, con permiso de escritura); en desarrollo es ./data del proyecto.
 */
export const BRIDGE_DATA_DIR = process.env.BPOS_DATA_DIR || path.join(process.cwd(), "data");
