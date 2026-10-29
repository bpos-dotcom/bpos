"use client";
/**
 * Respaldos del negocio (bloque 11).
 *
 * Todo lo de B-POS vive en la nube como registros de sync_records. Un
 * respaldo es una copia completa de esos registros en un archivo JSON:
 * - Automático: una vez al día la caja guarda una copia en la computadora
 *   (carpeta de datos de B-POS, se conservan 30 días).
 * - Manual: "Descargar respaldo" y "Restaurar" en Configuración → Respaldos.
 */
import { loadCloudAccount } from "@/lib/cloud/account";
import { bridgeFetch } from "@/lib/bridge/bridge-fetch";
import { getSupabase, isCloudConfigured } from "@/lib/supabase/client";

export type BackupRecord = { scope: string; collection: string; record_id: string; data: unknown };
export type BackupFile = {
  app: "B-POS";
  version: 1;
  createdAt: string;
  businessId: string;
  businessName?: string;
  records: BackupRecord[];
};

const LAST_AUTO_KEY = "bpos_last_backup"; // solo de este dispositivo (ver DEVICE_LOCAL_KEYS)
const PAGE = 1000;

/** Copia completa del negocio desde la nube. */
export async function createBackup(): Promise<BackupFile> {
  if (!isCloudConfigured) throw new Error("B-POS no está conectado a la nube.");
  const account = await loadCloudAccount();
  if (account.status !== "ready") throw new Error("Inicia sesión con la cuenta del negocio para respaldar.");

  const records: BackupRecord[] = [];
  for (let page = 0; page < 500; page += 1) {
    const { data, error } = await getSupabase()
      .from("sync_records")
      .select("scope, collection, record_id, data")
      .eq("business_id", account.businessId)
      .eq("deleted", false)
      .order("seq")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    records.push(...((data ?? []) as BackupRecord[]));
    if (!data || data.length < PAGE) break;
  }
  return { app: "B-POS", version: 1, createdAt: new Date().toISOString(), businessId: account.businessId, businessName: account.businessName, records };
}

/** Descarga el respaldo como archivo en este dispositivo. */
export function downloadBackup(backup: BackupFile) {
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `respaldo-bpos-${backup.createdAt.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Lee y revisa un archivo de respaldo antes de restaurarlo. */
export async function readBackupFile(file: File): Promise<BackupFile> {
  const parsed = JSON.parse(await file.text()) as BackupFile;
  if (parsed?.app !== "B-POS" || parsed.version !== 1 || !Array.isArray(parsed.records)) {
    throw new Error("Ese archivo no es un respaldo de B-POS.");
  }
  return parsed;
}

/**
 * Restaura un respaldo: vuelve a escribir sus registros en la nube y todos
 * los dispositivos los descargan solos. Solo del mismo negocio.
 */
export async function restoreBackup(backup: BackupFile, onProgress?: (done: number, total: number) => void) {
  const account = await loadCloudAccount();
  if (account.status !== "ready") throw new Error("Inicia sesión con la cuenta del negocio para restaurar.");
  if (backup.businessId !== account.businessId) throw new Error("Ese respaldo es de otro negocio.");

  const rows = backup.records.map((r) => ({ business_id: account.businessId, scope: r.scope, collection: r.collection, record_id: r.record_id, data: r.data, deleted: false, updated_by: "restauracion" }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await getSupabase().from("sync_records").upsert(rows.slice(i, i + 200), { onConflict: "business_id,scope,collection,record_id" });
    if (error) throw new Error(error.message);
    onProgress?.(Math.min(i + 200, rows.length), rows.length);
  }
}

/**
 * Respaldo automático diario: si este dispositivo es la caja (tiene B-POS
 * instalado), guarda la copia en la computadora una vez al día.
 */
export async function runDailyBackup() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(LAST_AUTO_KEY) === today) return;
    const backup = await createBackup();
    const response = await bridgeFetch("/api/backup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(backup),
    });
    if (response.ok) localStorage.setItem(LAST_AUTO_KEY, today);
  } catch {
    // sin nube o sin B-POS instalado en este dispositivo: se intenta otro día
  }
}
