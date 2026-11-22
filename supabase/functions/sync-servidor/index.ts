// Gestão Barber IA — usada só pelo servidor de sincronização (IP fixo).
// Authorization: Bearer <SYNC_TOKEN>  (segredo da função no Supabase; nunca vai para o app)
// GET  → lista as barbearias com sincronização automática ligada e assinatura em dia.
// GET ?acao=lembretes → dados do dia para os lembretes no WhatsApp.
// POST { company_id, acao: 'wa_status' | 'cl_status' | 'fb_status' | 'wb_status' | 'rt_status' | 'bd_status' | 'ia_status', status } → grava o estado dos lembretes (equipe | clientes).
// GET ?acao=totem_espera&empresas=id1,id2 → espera até ~25 s por pedidos novos do totem da recepção e os devolve.
// POST { company_id, acao: 'totem_resposta', id, ok, resposta } → grava a resposta de um pedido do totem.
// POST { company_id, acao: 'ab_servicos', lista } → grava os serviços da AppBarber (para o app sugerir nas ofertas).
// POST { company_id, acao: 'ia_report', relatorio } → grava o relatório semanal da Sofia.
// POST { company_id, creditos, sem_saldo } (com qualquer ação, ou acao: 'ab_uso') → soma as consultas gastas na AppBarber.
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

// Ofertas no final do agendamento (upsell): até 6, só com texto e serviço preenchidos.
const upsellCfg = (i: any) => (Array.isArray(i.upsell) ? i.upsell : []).filter((o: any) => o && o.texto && o.servicos).slice(0, 6)
  .map((o: any) => ({ texto: String(o.texto).slice(0, 60), valor: Math.max(0, Math.min(9999, Number(o.valor) || 0)), servicos: String(o.servicos).slice(0, 160), quando: String(o.quando || "").slice(0, 120) }));
// Configuração da Sofia (atendente IA) que vai para o servidor.
const sofiaCfg = (i: any) => ({ nome: String(i.ia_name || "Sofia").slice(0, 40), modelo: i.ia_model || "claude-sonnet-5-5", janelas: i.ia_hours || null, pausa: Number(i.ia_pause) || 60,
  notas: String(i.ia_notes || "").slice(0, 8000), avisar: String(i.ia_report_phone || "").replace(/\D/g, "").slice(0, 15), alerta: String(i.ia_alert_phone || "").replace(/\D/g, "").slice(0, 15), nomes: i.names || {},
  // Artes (imagens) que a Sofia pode enviar, com a pergunta depois e o retorno de 15 minutos.
  upsell: upsellCfg(i),
  artes: (Array.isArray(i.ia_arts) ? i.ia_arts : []).filter((a: any) => a && a.url && a.nome).slice(0, 6)
    .map((a: any) => ({ nome: String(a.nome).slice(0, 60), url: String(a.url), quando: String(a.quando || "").slice(0, 200), pergunta: String(a.pergunta || "").slice(0, 300), retorno: String(a.retorno || "").slice(0, 300) })) });

Deno.serve(async (req) => {
  const token = Deno.env.get("SYNC_TOKEN") || "";
  const enviado = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (token.length < 32 || !igual(enviado, token)) return json({ erro: "Não autorizado." }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const url = new URL(req.url);
  // Totem: o servidor espera pedidos novos (long polling). Marca que está no ar (o tablet mostra "sem conexão" se não estiver).
  if (req.method === "GET" && url.searchParams.get("acao") === "totem_espera") {
    const ids = String(url.searchParams.get("empresas") || "").split(",").filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 20);
    if (!ids.length) return json({ pedidos: [] });
    await db.from("integrations").update({ tt_seen_at: new Date().toISOString() }).in("company_id", ids);
    // Limpeza: pedidos com mais de 1 hora (normalmente já apagados quando o tablet lê a resposta).
    if (Math.random() < 0.05) await db.from("totem_pedidos").delete().lt("criado_em", new Date(Date.now() - 3600000).toISOString());
    const fim = Date.now() + 25000;
    while (Date.now() < fim) {
      const { data: novos } = await db.from("totem_pedidos").select("id").in("company_id", ids).eq("status", "novo")
        .gte("criado_em", new Date(Date.now() - 25000).toISOString()).order("id").limit(10);
      if (novos && novos.length) {
        const { data: pegos } = await db.from("totem_pedidos").update({ status: "pego", pego_em: new Date().toISOString() })
          .in("id", novos.map((n) => n.id)).eq("status", "novo").select("id, company_id, acao, dados");
        if (pegos && pegos.length) return json({ pedidos: pegos });
      }
      await new Promise((r) => setTimeout(r, 600));
    }
    return json({ pedidos: [] });
  }
  // Lembretes no WhatsApp: dados do dia de quem ligou os lembretes (checklist, agenda e telefones).
  if (req.method === "GET" && url.searchParams.get("acao") === "lembretes") {
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const { data: ints, error } = await db.from("integrations")
      .select("company_id, est_code, api_key, branch_code, wa_on, wa_hour, wa_min, wa_text, cl_on, cl_lead, cl_text, cl_reply, cl_numero, fb_on, fb_text, wb_on, wb_daily, wb_min_days, wb_max_days, wb_text, cl_status, cl_status_at, rt_on, rt_daily, rt_lead, rt_text, tt_on, tt_notify, tt_days, upsell, bd_on, bd_text, ia_on, ia_name, ia_model, ia_hours, ia_pause, ia_notes, ia_report_phone, ia_alert_phone, ia_arts, names").or("wa_on.eq.true,cl_on.eq.true,fb_on.eq.true,wb_on.eq.true,rt_on.eq.true,tt_on.eq.true,bd_on.eq.true,ia_on.eq.true");
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
        numero: i.cl_numero === "principal" ? "principal" : "chip", // número que fala com os clientes
        feedback: i.fb_on ? { texto: i.fb_text || "" } : null,
        // Parabéns aos aniversariantes do dia (lista de aniversariantes da AppBarber, 1 crédito por dia).
        aniversario: i.bd_on && i.est_code && i.api_key ? { texto: i.bd_text || "" } : null,
        // Sofia, a atendente IA: dias e horários em que ela responde o WhatsApp dos clientes.
        sofia: i.ia_on && i.est_code && i.api_key ? sofiaCfg(i) : null,
        // Mesma configuração, mesmo com a Sofia desligada: só para a conversa de teste no terminal (gbia-sofia-teste).
        sofia_teste: i.est_code && i.api_key ? sofiaCfg(i) : null,
        appbarber: i.est_code && i.api_key ? { codigo_estabelecimento: i.est_code, codigo_filial: i.branch_code || "", appbarber_api_key: i.api_key } : null,
        // Reconquista de clientes sumidos (lista de clientes da AppBarber, 1 crédito por página).
        reconquista: i.wb_on && i.est_code && i.api_key ? { porDia: Math.max(1, Math.min(40, Number(i.wb_daily) || 15)), minDias: Math.max(30, Number(i.wb_min_days) || 90), maxDias: Math.max(60, Number(i.wb_max_days) || 365), texto: i.wb_text || "", codigo_estabelecimento: i.est_code, codigo_filial: i.branch_code || "", appbarber_api_key: i.api_key } : null,
        // Retorno no tempo certo: convite N dias antes do prazo de costume de cada cliente (agenda da AppBarber).
        retorno: i.rt_on && i.est_code && i.api_key ? { porDia: Math.max(1, Math.min(30, Number(i.rt_daily) || 10)), antes: i.rt_lead == null || !Number.isFinite(Number(i.rt_lead)) ? 2 : Math.max(-3, Math.min(7, Math.round(Number(i.rt_lead)))), texto: i.rt_text || "", codigo_estabelecimento: i.est_code, codigo_filial: i.branch_code || "", appbarber_api_key: i.api_key } : null,
        // Totem de autoatendimento na recepção (check-in e agendamento na hora).
        totem: i.tt_on && i.est_code && i.api_key ? { avisar: i.tt_notify !== false, dias: Math.max(1, Math.min(30, Number(i.tt_days) || 7)), upsell: upsellCfg(i) } : null,
        // Estado do número dos clientes: o programa da equipe (outro número) avisa quando ele desconecta.
        wa_clientes: i.cl_on || i.ia_on || i.wb_on || i.bd_on || i.fb_on || i.rt_on ? { status: i.cl_status || "", em: i.cl_status_at, numero: i.cl_numero === "principal" ? "principal" : "chip", sofia: !!i.ia_on, alerta: String(i.ia_alert_phone || i.ia_report_phone || "").replace(/\D/g, "") } : null,
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
      .select("company_id, provider, est_code, api_key, branch_code, names, fb_on").eq("active", true);
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
        feedback: !!i.fb_on, // a sincronização separa as comandas pagas de clientes novos para o pedido de feedback
      });
    }
    return json({ empresas });
  }

  if (req.method === "POST") {
    let b: any;
    try { b = await req.json(); } catch { return json({ erro: "JSON inválido." }, 400); }
    if (!b?.company_id) return json({ erro: "Falta company_id." }, 400);
    // Consultas à AppBarber feitas pelo servidor (cada uma gasta 1 crédito) e aviso de saldo esgotado.
    const usoN = Math.max(0, Math.min(5000, Number(b.creditos) || 0)), zero = b.sem_saldo === true;
    if (usoN || zero) await db.rpc("ab_add_uso", { p_company: b.company_id, p_n: usoN, p_zero: zero });
    if (b.acao === "ab_uso") return json({ ok: true });
    // Lista de serviços da AppBarber (código e nome) para o app sugerir os nomes ao montar as ofertas.
    if (b.acao === "ab_servicos") {
      const lista = (Array.isArray(b.lista) ? b.lista : []).slice(0, 400).map((x: any) => ({ codigo: Number(x.codigo) || 0, nome: String(x.nome || "").slice(0, 80) })).filter((x: any) => x.nome);
      const { error } = await db.from("integrations").update({ ab_services: lista }).eq("company_id", b.company_id);
      return error ? json({ erro: error.message }, 500) : json({ ok: true });
    }
    if (b.acao === "totem_resposta") {
      const resp = b.resposta && typeof b.resposta === "object" ? b.resposta : {};
      if (JSON.stringify(resp).length > 60000) return json({ erro: "Resposta grande demais." }, 400);
      const { error } = await db.from("totem_pedidos").update({ status: b.ok ? "feito" : "erro", resposta: resp, feito_em: new Date().toISOString() })
        .eq("id", Number(b.id)).eq("company_id", b.company_id).in("status", ["pego", "expirado"]);
      return error ? json({ erro: error.message }, 500) : json({ ok: true });
    }
    // Relatório semanal da Sofia (atendente IA): números, motivos e sugestões para o dono aprovar no app.
    if (b.acao === "ia_report") {
      const rel = b.relatorio && typeof b.relatorio === "object" ? b.relatorio : null;
      if (!rel || JSON.stringify(rel).length > 30000) return json({ erro: "Relatório inválido." }, 400);
      const { error } = await db.from("integrations").update({ ia_report: rel, ia_report_at: new Date().toISOString() }).eq("company_id", b.company_id);
      return error ? json({ erro: error.message }, 500) : json({ ok: true });
    }
    if (["wa_status", "cl_status", "fb_status", "wb_status", "rt_status", "tt_status", "bd_status", "ia_status"].includes(b.acao)) {
      const k = String(b.acao).slice(0, 2);
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
