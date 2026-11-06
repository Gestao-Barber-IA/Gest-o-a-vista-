// Gestão Barber IA — apaga as fotos das provas do checklist 7 dias depois do envio.
// A prova continua registrada (status, descrição, pontos); só o arquivo da foto sai.
// Provas ainda aguardando conferência mantêm a foto até a gestão aprovar ou recusar.
// Chamada todo dia pelo agendamento do banco (supabase/cron.sql). Pode ser chamada
// a qualquer momento: só apaga o que já deveria ter sido apagado.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const DAYS = Number(Deno.env.get("PROOF_DAYS") || 7);
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") return json({ erro: "Use POST." }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const limit = Date.now() - DAYS * 86400000;
  let removed = 0, records = 0;
  for (let from = 0; ; from += 500) {
    const { data, error } = await db.from("pop_records").select("id, data").range(from, from + 499);
    if (error) return json({ erro: error.message }, 500);
    for (const row of data || []) {
      const ev = row.data?.ev;
      if (!ev || typeof ev !== "object") continue;
      const paths: string[] = [];
      for (const list of Object.values(ev) as any[]) {
        if (!Array.isArray(list)) continue;
        for (const e of list) {
          if (e && e.path && !e.photoGone && e.status !== "pendente" && Number(e.at || 0) < limit) paths.push(e.path);
        }
      }
      if (!paths.length) continue;
      for (let i = 0; i < paths.length; i += 100) {
        const { error: rmErr } = await db.storage.from("provas").remove(paths.slice(i, i + 100));
        if (rmErr) return json({ erro: rmErr.message, removidas: removed }, 500);
      }
      const gone = new Set(paths);
      for (const list of Object.values(ev) as any[]) {
        if (!Array.isArray(list)) continue;
        for (const e of list) if (e && gone.has(e.path)) { e.path = null; e.photoGone = true; e.photoGoneAt = Date.now(); }
      }
      const { error: upErr } = await db.from("pop_records").update({ data: { ...row.data, ev } }).eq("id", row.id);
      if (upErr) return json({ erro: upErr.message, removidas: removed }, 500);
      removed += paths.length; records++;
    }
    if (!data || data.length < 500) break;
  }
  return json({ removidas: removed, registros: records, dias: DAYS });
});
