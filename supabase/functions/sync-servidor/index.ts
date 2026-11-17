// Gestão Barber IA — usada só pelo servidor de sincronização (IP fixo).
// Authorization: Bearer <SYNC_TOKEN>  (segredo da função no Supabase; nunca vai para o app)
// GET  → lista as barbearias com sincronização automática ligada e assinatura em dia.
// GET ?acao=lembretes → dados do dia para os lembretes no WhatsApp.
// POST { company_id, acao: 'wa_status' | 'cl_status', status } → grava o estado dos lembretes (equipe | clientes).
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

  const url = new URL(req.url);
  // Lembretes no WhatsApp: dados do dia de quem ligou os lembretes (checklist, agenda e telefones).
  if (req.method === "GET" && url.searchParams.get("acao") === "lembretes") {
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const { data: ints, error } = await db.from("integrations")
      .select("company_id, est_code, api_key, branch_code, wa_on, wa_hour, wa_min, wa_text, cl_on, cl_lead, cl_text, cl_reply, cl_numero").or("wa_on.eq.true,cl_on.eq.true");
    if (error) return json({ erro: error.message }, 500);
    const empresas = [];
    for (const i of ints || []) {
      const { data: co } = await db.from("companies").select("id, name, settings, sub_status, paid_until").eq("id", i.company_id).maybeSingle();
      if (!co) continue;
      const paidUntil = co.paid_until ? new Date(co.paid_until + "T23:59:59Z").getTime() + 86400000 : 0;
      if (!(["active", "courtesy", "canceled"].includes(co.sub_status) && paidUntil >= Date.now())) continue;
      const [{ data: barbers }, { data: profs }, { data: pop }, { data: entries }] = await Promise.all([
        db.from("barbers").select("id, name, active").eq("company_id", co.id),
        db.from("profiles").select("barber_id, phone, status").eq("company_id", co.id),
        db.from("pop_records").select("barber_id, day, data").eq("company_id", co.id).eq("day", hoje),
        db.from("entries").select("barber_id, date, source, data").eq("company_id", co.id).eq("date", hoje),
      ]);
      const fone = new Map((profs || []).filter((p) => p.barber_id && p.phone && p.status !== "bloqueado").map((p) => [String(p.barber_id), p.phone]));
      empresas.push({
        company_id: co.id, nome: co.name, hoje,
        cfg: { ligado: !!i.wa_on, hora: i.wa_hour || "13:00", minimo: Number(i.wa_min) || 0, texto: i.wa_text || "" },
        // Lembrete de agendamento para os clientes (o servidor consulta a agenda da AppBarber).
        clientes: i.cl_on && i.est_code && i.api_key ? { numero: i.cl_numero === "principal" ? "principal" : "chip", antecedencia: Number(i.cl_lead) || 60, texto: i.cl_text || "", resposta: i.cl_reply || "", codigo_estabelecimento: i.est_code, codigo_filial: i.branch_code || "", appbarber_api_key: i.api_key } : null,
        brand: co.settings?.brand || "barber", popCfg: co.settings?.pop || null,
        // Horário de funcionamento (Configurações): fora dele e nos dias fechados não consulta a AppBarber nem manda lembrete.
        horario: (() => { const o = co.settings?.ocup || {}, ok = (v: unknown, d: string) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : d);
          return { abertura: ok(o.open, "09:00"), fechamento: ok(o.close, "20:00"), fechados: Array.isArray(o.closed) ? o.closed.map(Number) : [] }; })(),
        barbers: (barbers || []).filter((b) => b.active !== false).map((b) => ({ id: b.id, name: b.name, phone: fone.get(String(b.id)) || "" })),
        pop: (pop || []).map((r) => ({ barberId: r.barber_id, day: r.day, ...(r.data || {}) })),
        entries: (entries || []).map((e) => ({ barberId: e.barber_id, date: e.date, source: e.source, ...(e.data || {}) })),
      });
    }
    return json({ hoje, empresas });
  }

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
    if (b.acao === "wa_status" || b.acao === "cl_status") {
      const k = b.acao === "cl_status" ? "cl" : "wa";
      const { error } = await db.from("integrations").update({ [k + "_status"]: String(b.status || "").slice(0, 500), [k + "_status_at"]: new Date().toISOString() }).eq("company_id", b.company_id);
      return error ? json({ erro: error.message }, 500) : json({ ok: true });
    }
    const msg = String(b.mensagem || "").slice(0, 500);
    const { error } = await db.from("integrations")
      .update({ last_sync_at: new Date().toISOString(), last_status: (b.ok ? "ok: " : "erro: ") + msg })
      .eq("company_id", b.company_id);
    return error ? json({ erro: error.message }, 500) : json({ ok: true });
  }
  return json({ erro: "Use GET ou POST." }, 405);
});
