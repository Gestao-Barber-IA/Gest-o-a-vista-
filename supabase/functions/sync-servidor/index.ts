// Gestão Barber IA — usada só pelo servidor de sincronização (IP fixo).
// Authorization: Bearer <SYNC_TOKEN>  (segredo da função no Supabase; nunca vai para o app)
// GET  → lista as barbearias com sincronização automática ligada e assinatura em dia.
// POST → { company_id, ok, mensagem } grava o resultado da última sincronização.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function igual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  const token = Deno.env.get("SYNC_TOKEN") || "";
  const enviado = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (token.length < 32 || !igual(enviado, token)) return json({ erro: "Não autorizado." }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  if (req.method === "GET") {
    const { data: ints, error } = await db.from("integrations")
      .select("company_id, provider, est_code, api_key, branch_code, names").eq("active", true);
    if (error) return json({ erro: error.message }, 500);
    const ids = (ints || []).filter((i) => i.est_code && i.api_key).map((i) => i.company_id);
    if (!ids.length) return json({ empresas: [] });
    const [{ data: cos }, { data: keys }, { data: plans }] = await Promise.all([
      db.from("companies").select("id, name, sub_status, paid_until, plan_id").in("id", ids),
      db.from("api_keys").select("company_id, key").in("company_id", ids),
      db.from("plans").select("id, api"),
    ]);
    const keyOf = new Map((keys || []).map((k) => [k.company_id, k.key]));
    const apiPlan = new Map((plans || []).map((p) => [p.id, !!p.api]));
    const empresas = [];
    for (const i of ints || []) {
      const co = (cos || []).find((c) => c.id === i.company_id);
      if (!co || !keyOf.get(i.company_id)) continue;
      // Mesma regra da função lancamentos: plano pago com API (ou cortesia) e assinatura em dia.
      const paidUntil = co.paid_until ? new Date(co.paid_until + "T23:59:59Z").getTime() + 86400000 : 0;
      const pago = ["active", "courtesy", "canceled"].includes(co.sub_status) && paidUntil >= Date.now();
      if (!pago || !(apiPlan.get(co.plan_id) || co.sub_status === "courtesy")) continue;
      empresas.push({
        company_id: i.company_id, nome: co.name, provider: i.provider,
        codigo_estabelecimento: i.est_code, appbarber_api_key: i.api_key,
        codigo_filial: i.branch_code || undefined, nomes: i.names || {},
        gestao_api_key: keyOf.get(i.company_id),
      });
    }
    return json({ empresas });
  }

  if (req.method === "POST") {
    let b: any;
    try { b = await req.json(); } catch { return json({ erro: "JSON inválido." }, 400); }
    if (!b?.company_id) return json({ erro: "Falta company_id." }, 400);
    const msg = String(b.mensagem || "").slice(0, 500);
    const { error } = await db.from("integrations")
      .update({ last_sync_at: new Date().toISOString(), last_status: (b.ok ? "ok: " : "erro: ") + msg })
      .eq("company_id", b.company_id);
    return error ? json({ erro: error.message }, 500) : json({ ok: true });
  }
  return json({ erro: "Use GET ou POST." }, 405);
});
