// Gestão Barber IA — recebe resultados diários de outro sistema.
// POST /functions/v1/lancamentos
// Authorization: Bearer <chave da API da barbearia>
// Corpo: um lançamento ou uma lista, no formato mostrado em Integração & API.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const FIELDS: Record<string, string> = {
  faturamento: "fat", servicos: "serv", clientes: "cli", checklist_pop: "check",
  horas_disponiveis: "hDisp", horas_ocupadas: "hOcup", planos_mensais: "planos",
  clientes_retorno: "ret", venda_produtos: "prod", maior_comanda: "comanda",
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST" && req.method !== "GET") return json({ erro: "Use POST." }, 405);

  const key = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!key.startsWith("gbia_")) return json({ erro: "Envie a chave da API no cabeçalho Authorization: Bearer <chave>." }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: k } = await db.from("api_keys").select("company_id").eq("key", key).maybeSingle();
  if (!k) return json({ erro: "Chave da API inválida." }, 401);

  // GET: horário de funcionamento definido no app (Configurações › Regra da taxa de ocupação),
  // usado pelos sincronizadores para só buscar dados com a barbearia aberta.
  if (req.method === "GET") {
    const { data: c } = await db.from("companies").select("settings").eq("id", k.company_id).single();
    const o = (c?.settings as any)?.ocup || {};
    const hm = (v: unknown, d: string) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : d);
    // Janela de busca: a abertura mais cedo e o fechamento mais tarde entre a empresa e os profissionais com horário próprio.
    let ab = hm(o.open, "09:00"), fe = hm(o.close, "20:00");
    for (const h of Object.values((o.by || {}) as Record<string, any>)) {
      if (h && typeof h.open === "string" && /^\d{2}:\d{2}$/.test(h.open) && h.open < ab) ab = h.open;
      if (h && typeof h.close === "string" && /^\d{2}:\d{2}$/.test(h.close) && h.close > fe) fe = h.close;
    }
    return json({ abertura: ab, fechamento: fe });
  }
  // A integração por API só vale nos planos pagos e com a assinatura em dia.
  const { data: co } = await db.from("companies").select("sub_status, paid_until, plan_id").eq("id", k.company_id).single();
  const { data: plan } = co?.plan_id ? await db.from("plans").select("api").eq("id", co.plan_id).maybeSingle() : { data: null };
  const paidUntil = co?.paid_until ? new Date(co.paid_until + "T23:59:59Z").getTime() + 86400000 : 0;
  const paid = !!co && ["active", "courtesy", "canceled"].includes(co.sub_status) && paidUntil >= Date.now();
  if (!paid || !(plan?.api || co.sub_status === "courtesy")) return json({ erro: "A integração por API está disponível nos planos pagos, com a assinatura em dia." }, 402);

  let body: unknown;
  try { body = await req.json(); } catch { return json({ erro: "O corpo precisa ser JSON." }, 400); }
  const list = Array.isArray(body) ? body : [body];
  if (list.length > 1000) return json({ erro: "Envie no máximo 1000 lançamentos por vez." }, 413);

  const { data: barbers } = await db.from("barbers").select("id, name").eq("company_id", k.company_id);
  const byId = new Map((barbers || []).map((b) => [b.id, b]));
  const byName = new Map((barbers || []).map((b) => [String(b.name).toLowerCase().trim(), b]));

  const rows: Record<string, unknown>[] = [];
  const erros: string[] = [];
  list.forEach((item: any, i: number) => {
    const n = i + 1;
    if (!item || typeof item !== "object") { erros.push(`Item ${n}: formato inválido.`); return; }
    const date = String(item.data || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { erros.push(`Item ${n}: "data" deve estar no formato AAAA-MM-DD.`); return; }
    const ref = item.barbeiro_id ?? item.barbeiro;
    const b = byId.get(ref) || byName.get(String(ref ?? "").toLowerCase().trim());
    if (!b) { erros.push(`Item ${n}: barbeiro "${ref ?? ""}" não encontrado.`); return; }
    const data: Record<string, number> = {};
    for (const [api, key] of Object.entries(FIELDS)) {
      const v = item[api];
      if (v === undefined || v === null || v === "") continue;
      const num = Number(v);
      if (Number.isNaN(num) || num < 0) { erros.push(`Item ${n}: "${api}" precisa ser um número positivo.`); return; }
      data[key] = num;
    }
    rows.push({ id: `api_${b.id}_${date}`, company_id: k.company_id, barber_id: b.id, date, data, source: "api", updated_at: new Date().toISOString() });
  });

  if (rows.length) {
    const { error } = await db.from("entries").upsert(rows, { onConflict: "barber_id,date,source" });
    if (error) return json({ erro: "Não foi possível gravar: " + error.message, recebidos: 0, problemas: erros }, 500);
  }
  return json({ recebidos: rows.length, problemas: erros }, erros.length && !rows.length ? 400 : 200);
});
