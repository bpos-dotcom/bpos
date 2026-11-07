"use client";
/**
 * Liga pública del negocio (bpos.com.mx/fidelidad/<liga>) para quien todavía
 * no tiene una: es la misma liga del menú digital, pero se puede reservar
 * desde el club sin publicar el menú (B-POS Servicios → solo lealtad).
 */
import { useState } from "react";
import { agentScope } from "@/lib/agent/client";
import { getBusinessSettings } from "@/lib/business-settings";
import { SLUG_RE, saveDigitalMenu, suggestSlug } from "@/lib/digital-menu";
import { getSupabase } from "@/lib/supabase/client";

export function ClubSlugPicker({ onSaved }: { onSaved: (slug: string) => void }) {
  const [draft, setDraft] = useState(() => suggestSlug(getBusinessSettings().businessName || ""));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    const slug = draft.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) return setMsg("Usa solo letras minúsculas, números y guiones (3 a 40). Ej. tacos-el-guero");
    setBusy(true);
    setMsg("");
    try {
      const { branchId } = await agentScope();
      const { data, error } = await getSupabase().rpc("bpos_menu_set_slug", { p_branch_id: branchId, p_slug: slug });
      if (error) throw new Error(error.message);
      saveDigitalMenu({ slug: String(data) });
      onSaved(String(data));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "No se pudo guardar la liga.");
    }
    setBusy(false);
  }

  return (
    <div className="mt-3">
      <p className="text-sm text-zinc-300">Elige la liga de tu club: tus clientes se unen en bpos.com.mx/fidelidad/<b>{draft || "tu-liga"}</b>.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} maxLength={40} className="min-w-0 flex-1 rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-white" aria-label="Liga del club" />
        <button disabled={busy} onClick={() => void save()} className="rounded-2xl bg-orange-500 px-5 py-3 font-black text-black disabled:opacity-50">
          {busy ? "Guardando..." : "Guardar liga"}
        </button>
      </div>
      {msg && <p className="mt-2 text-sm text-orange-300">{msg}</p>}
    </div>
  );
}
