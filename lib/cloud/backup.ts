"use client";
/**
 * Respaldos del negocio (bloque 11).
 *
 * Todo lo de B-POS vive en la nube como registros de sync_records. Un
 * respaldo es una copia completa de esos registros en un archivo JSON:
 * - Automático: una vez al día se guarda una copia en la nube (tabla
 *   bpos_backups). Se conservan los de los últimos 7 días y, además, el
 *   primero de cada semana durante 8 semanas (respaldo semanal).
 * - Manual: "Descargar respaldo" y "Restaurar" en Configuración → Respaldos.
 */
import { loadCloudAccount } from "@/lib/cloud/account";
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
const KEEP_DAYS = 7;
const KEEP_WEEKS = 8;

/** Lunes de la semana de ese día (YYYY-MM-DD), para agrupar los respaldos semanales */
export function weekOf(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7; // lunes = 0
  d.setUTCDate(d.getUTCDate() - back);
  return d.toISOString().slice(0, 10);
}

/** Qué respaldos se borran: más viejos de 7 días, salvo el primero de cada semana de las últimas 8 semanas */
export function backupsToDelete(days: string[], todayDay: string): string[] {
  const now = Date.parse(`${todayDay}T12:00:00Z`);
  const oldestDaily = new Date(now - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const oldestWeekly = new Date(now - KEEP_WEEKS * 7 * 86_400_000).toISOString().slice(0, 10);
  const firstOfWeek = new Map<string, string>();
  for (const day of [...days].sort()) if (!firstOfWeek.has(weekOf(day))) firstOfWeek.set(weekOf(day), day);
  const weekly = new Set(firstOfWeek.values());
  return days.filter((day) => day < oldestDaily && !(weekly.has(day) && day >= oldestWeekly));
}

async function readyAccount() {
  if (!isCloudConfigured) throw new Error("B-POS no está conectado a la nube.");
  const account = await loadCloudAccount();
  if (account.status !== "ready") throw new Error("Inicia sesión con la cuenta del negocio para respaldar.");
  return account;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Guarda el respaldo como el del día en la nube y borra los que ya no se conservan (ver backupsToDelete). */
export async function saveDailyBackup(backup: BackupFile) {
  const day = today();
  const { error } = await getSupabase()
    .from("bpos_backups")
    .upsert({ business_id: backup.businessId, day, data: backup, size: JSON.stringify(backup).length }, { onConflict: "business_id,day" });
  if (error) throw new Error(error.message);
  const { data: rows } = await getSupabase().from("bpos_backups").select("day").eq("business_id", backup.businessId);
  const remove = backupsToDelete((rows ?? []).map((r) => String(r.day)), day);
  if (remove.length) await getSupabase().from("bpos_backups").delete().eq("business_id", backup.businessId).in("day", remove);
}

/** Respaldos diarios guardados en la nube, el más nuevo primero. */
export async function listSavedBackups(): Promise<{ day: string; size: number }[]> {
  const account = await readyAccount();
  const { data, error } = await getSupabase()
    .from("bpos_backups")
    .select("day, size")
    .eq("business_id", account.businessId)
    .order("day", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as { day: string; size: number }[];
}

/** Descarga en este dispositivo el respaldo guardado de ese día. */
export async function downloadSavedBackup(day: string) {
  const account = await readyAccount();
  const { data, error } = await getSupabase().from("bpos_backups").select("data").eq("business_id", account.businessId).eq("day", day).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Respaldo no encontrado.");
  downloadBackup(data.data as BackupFile);
}

/** Copia completa del negocio desde la nube. */
export async function createBackup(): Promise<BackupFile> {
  const account = await readyAccount();

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
 * Respaldo automático diario: el primer dispositivo del negocio que abre
 * B-POS en el día guarda la copia en la nube.
 */
export async function runDailyBackup() {
  try {
    const day = today();
    if (localStorage.getItem(LAST_AUTO_KEY) === day) return;
    const saved = await listSavedBackups();
    if (!saved.some((b) => b.day === day)) await saveDailyBackup(await createBackup());
    localStorage.setItem(LAST_AUTO_KEY, day);
  } catch {
    // sin nube o sin sesión: se intenta más tarde
  }
}
