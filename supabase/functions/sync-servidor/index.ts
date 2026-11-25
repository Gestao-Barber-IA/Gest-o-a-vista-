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
  .map((o: any) => ({ texto: String(o.texto).slice(0, 60), valor: Math.max(0, Math.min(9999, Number(o.valor) || 0)), servicos: String(o.servicos).slice(0, 160), quando: String(o.quando || "").slice(0, 120), semTempo: o.semTempo === true }));
// Configuração da Sofia (atendente IA) que vai para o servidor.
const sofiaCfg = (i: any) => ({ nome: String(i.ia_name || "Sofia").slice(0, 40), modelo: i.ia_model || "claude-sonnet-5-5", janelas: i.ia_hours || null, pausa: Number(i.ia_pause) || 60,
  notas: String(i.ia_notes || "").slice(0, 8000), avisar: String(i.ia_report_phone || "").replace(/\D/g, "").slice(0, 15), alerta: String(i.ia_alert_phone || "").replace(/\D/g, "").slice(0, 15), nomes: i.names || {},
  // Artes (imagens) que a Sofia pode enviar, com a pergunta depois e o retorno de 15 minutos.
  upsell: upsellCfg(i),
  artes: (Array.isArray(i.ia_arts) ? i.ia_arts : []).filter((a: any) => a && a.url && a.nome).slice(0, 6)
    .map((a: any) => ({ nome: String(a.nome).slice(0, 60), url: String(a.url), quando: String(a.quando || "").slice(0, 200), pergunta: String(a.pergunta || "").slice(0, 300), retorno: String(a.retorno || "").slice(0, 300) })) });

// Boletim do dono: texto do resumo do dia (faturamento lançado, atendente IA, confirmações, vagas, agenda cheia, planos).
const brl = (v: number) => "R$ " + Math.round(v || 0).toLocaleString("pt-BR");
async function boletimTexto(db: any, i: any, co: any, hoje: string, barbers: any[], entries: any[]) {
  const nomeB = new Map((barbers || []).map((b: any) => [String(b.id), String(b.name || "").split(" ")[0]]));
  const porB = new Map<string, number>(); let fat = 0, cli = 0;
  for (const e of entries || []) { const d = e.data || {}; const f = Number(d.fat) || 0; fat += f; cli += Number(d.cli) || 0; if (f) porB.set(String(e.barber_id), (porB.get(String(e.barber_id)) || 0) + f); }
  const { data: ev } = await db.from("ia_eventos").select("tipo, origem, valor, dados").eq("company_id", i.company_id).gte("em", hoje + "T00:00:00-03:00").lt("em", hoje + "T23:59:59.999-03:00").limit(5000);
  const n = (f: (x: any) => boolean) => (ev || []).filter(f).length, soma = (f: (x: any) => boolean) => (ev || []).filter(f).reduce((t: number, x: any) => t + (Number(x.valor) || 0), 0);
  const ag = (o?: string) => (x: any) => x.tipo === "agendamento" && (!o || x.origem === o);
  const dt = new Date(hoje + "T12:00:00Z"), dia = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][dt.getUTCDay()] + ", " + hoje.slice(8, 10) + "/" + hoje.slice(5, 7);
  const L: string[] = [`📊 *Boletim de hoje* (${dia}) · ${co.name}`];
  if (fat || cli) L.push(`💰 Faturamento: *${brl(fat)}*${cli ? ` · ${cli} cliente${cli > 1 ? "s" : ""} · ticket ${brl(fat / cli)}` : ""}`);
  const top = [...porB.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([b, v]) => `${nomeB.get(b) || "?"} ${brl(v)}`);
  if (top.length) L.push(`🏆 ${top.join(" · ")}`);
  const conv = n((x) => x.tipo === "conversa"), nAg = n(ag()), custo = soma((x) => x.tipo === "uso") * 5.4;
  if (conv || nAg) L.push(`🤖 *Atendente IA*: ${conv} conversa${conv === 1 ? "" : "s"} · ${nAg} agendamento${nAg === 1 ? "" : "s"} (${brl(soma(ag()))})${n((x) => x.tipo === "adicional") ? ` · ${n((x) => x.tipo === "adicional")} adicional(is) (${brl(soma((x) => x.tipo === "adicional"))})` : ""}${n((x) => x.tipo === "recepcao") ? ` · ${n((x) => x.tipo === "recepcao")} para a recepção` : ""}${custo >= 0.01 ? ` · custo ≈ R$ ${custo.toFixed(2).replace(".", ",")}` : ""}`);
  const cfE = n((x) => x.tipo === "confirmacao"), cfOk = n((x) => x.tipo === "confirmado"), cfR = n((x) => x.tipo === "remarcacao" && x.origem === "confirmacao"), cfC = n((x) => x.tipo === "cancelamento" && x.origem === "confirmacao");
  if (cfE || cfOk) L.push(`✅ *Confirmação de presença*: ${cfE} pedido${cfE === 1 ? "" : "s"} · ${cfOk} confirmaram${cfR ? ` · ${cfR} remarcaram` : ""}${cfC ? ` · ${cfC} cancelaram (vaga liberada)` : ""}`);
  const extra: string[] = [];
  for (const [o, nome] of [["vaga", "⚡ Vagas preenchidas"], ["agenda", "📅 Agenda cheia"], ["retorno", "🔁 Retorno"], ["reconquista", "🎁 Reconquista"], ["totem", "🖥️ Totem"]]) {
    const c = n((x) => x.tipo === "convite" && x.origem === o), a = n(ag(o));
    if (c || a) extra.push(`${nome}: ${c ? `${c} convite${c === 1 ? "" : "s"}, ` : ""}${a} agendado${a === 1 ? "" : "s"}${a ? ` (${brl(soma(ag(o)))})` : ""}`);
  }
  L.push(...extra);
  const plC = n((x) => x.tipo === "convite" && x.origem === "plano"), plF = n((x) => x.tipo === "plano_fechado");
  if (plC || plF) L.push(`💎 *Planos*: ${plC} convite${plC === 1 ? "" : "s"}${plF ? ` · ${plF} fechado${plF === 1 ? "" : "s"} (${brl(soma((x) => x.tipo === "plano_fechado"))}/mês)` : ""}`);
  const oc = (String(i.ac_status || "").match(/ocupação (.*?) · \d+ convite/) || [])[1];
  const am = oc ? oc.split(" · ").find((b) => !b.startsWith("hoje")) : "";
  if (am) L.push(`🔮 *Ocupação ${am.split(": ")[0]}*: ${am.split(": ")[1] || ""}`);
  if (L.length === 1) L.push("Sem movimento registrado hoje.");
  L.push("", "Detalhes no app: Resultado da atendente IA.");
  return L.join("\n");
}
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
      .select("company_id, est_code, api_key, branch_code, srv_update_req, srv_update_done, bo_on, bo_hour, bo_phone, bo_sent_on, bo_force, ia_report_phone, ac_status, cf_status, ac_on, ac_limit, ac_daily, ac_days, ac_text, pl_on, pl_chat, pl_daily, pl_days, pl_plans, pl_text, cf_on, cf_hour, cf_second, cf_before, cf_text, cf_text2, fv_on, fv_per, fv_daily, fv_lead, fv_days, fv_text, wa_on, wa_hour, wa_min, wa_text, cl_on, cl_lead, cl_text, cl_reply, cl_numero, fb_on, fb_text, fb_reply, fb_pro_text, wb_on, wb_daily, wb_min_days, wb_max_days, wb_text, wb_gift, wb_gift_done, cl_status, cl_status_at, rt_on, rt_daily, rt_lead, rt_text, tt_on, tt_notify, tt_days, upsell, bd_on, bd_text, ia_on, ia_name, ia_model, ia_hours, ia_pause, ia_notes, ia_report_phone, ia_alert_phone, ia_arts, names").or("wa_on.eq.true,cl_on.eq.true,fb_on.eq.true,wb_on.eq.true,rt_on.eq.true,tt_on.eq.true,bd_on.eq.true,ia_on.eq.true");
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
      // Taxa de fidelização de cada profissional (clientes novos que voltaram com ele em até 45 dias, últimos 180 dias):
      // a atendente IA usa como desempate quando o cliente não tem preferência de profissional.
      const fid = new Map<string, number>();
      if (i.ia_on) {
        const desde = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
        const { data: hist } = await db.from("entries").select("barber_id, data").eq("company_id", co.id).gte("date", desde).limit(20000);
        const soma = new Map<string, { b: number; v: number; c: number; r: number }>();
        for (const e of hist || []) {
          const d: any = e.data || {}, x = soma.get(String(e.barber_id)) || { b: 0, v: 0, c: 0, r: 0 };
          x.b += Number(d.fnB) || 0; x.v += Number(d.fnV) || 0; x.c += Number(d.cli) || 0; x.r += Number(d.ret) || 0; soma.set(String(e.barber_id), x);
        }
        for (const [k, x] of soma) { const t = x.b >= 5 ? x.v / x.b : x.c >= 20 && x.r > 0 ? x.r / x.c : null; if (t != null) fid.set(k, Math.round(t * 1000) / 10); }
      }
      // Correções de memória feitas no app nos últimos 7 dias (o servidor aplica sobre o arquivo dele).
      let memorias: unknown[] = [];
      if (i.ia_on) {
        const { data: mem } = await db.from("ia_memorias").select("chave, notas, app_em").eq("company_id", co.id).gte("app_em", new Date(Date.now() - 7 * 86400000).toISOString()).limit(500);
        memorias = (mem || []).map((m: any) => ({ chave: m.chave, em: m.app_em, notas: m.notas || [] }));
      }
      const fone = new Map((profs || []).filter((p) => p.barber_id && p.phone && p.status !== "bloqueado").map((p) => [String(p.barber_id), p.phone]));
      empresas.push({
        company_id: co.id, nome: co.name, hoje,
        numero: i.cl_numero === "principal" ? "principal" : "chip", // número que fala com os clientes
        feedback: i.fb_on ? { texto: i.fb_text || "", resposta: String(i.fb_reply || "").slice(0, 1200), parabens: String(i.fb_pro_text || "").slice(0, 800) } : null,
        // Parabéns aos aniversariantes do dia (lista de aniversariantes da AppBarber, 1 crédito por dia).
        aniversario: i.bd_on && i.est_code && i.api_key ? { texto: i.bd_text || "" } : null,
        // Sofia, a atendente IA: dias e horários em que ela responde o WhatsApp dos clientes.
        sofia: i.ia_on && i.est_code && i.api_key ? sofiaCfg(i) : null,
        // Mesma configuração, mesmo com a Sofia desligada: só para a conversa de teste no terminal (gbia-sofia-teste).
        sofia_teste: i.est_code && i.api_key ? sofiaCfg(i) : null,
        appbarber: i.est_code && i.api_key ? { codigo_estabelecimento: i.est_code, codigo_filial: i.branch_code || "", appbarber_api_key: i.api_key } : null,
        // Reconquista de clientes sumidos (lista de clientes da AppBarber, 1 crédito por página).
        reconquista: i.wb_on && i.est_code && i.api_key ? { porDia: Math.max(1, Math.min(40, Number(i.wb_daily) || 15)), minDias: Math.max(30, Number(i.wb_min_days) || 90), maxDias: Math.max(60, Number(i.wb_max_days) || 365), texto: i.wb_text || "", presente: String(i.wb_gift || "").slice(0, 1500), presenteFinal: String(i.wb_gift_done || "").slice(0, 1000), codigo_estabelecimento: i.est_code, codigo_filial: i.branch_code || "", appbarber_api_key: i.api_key } : null,
        // Retorno no tempo certo: convite N dias antes do prazo de costume de cada cliente (agenda da AppBarber).
        // Agenda cheia automática: convites para os clientes do profissional com pouca ocupação.
        agendaCheia: i.ac_on && i.est_code && i.api_key ? { limite: Math.max(20, Math.min(95, Number(i.ac_limit) || 60)), porDia: Math.max(1, Math.min(40, Number(i.ac_daily) || 10)), dias: Number(i.ac_days) === 2 ? 2 : 1,
          texto: String(i.ac_text || "").slice(0, 2000), codigo_estabelecimento: i.est_code, codigo_filial: i.branch_code || "", appbarber_api_key: i.api_key } : null,
        // Venda de planos: oferta para clientes frequentes (na conversa e/ou convite por dia).
        planos: i.pl_on && i.est_code && i.api_key && Array.isArray(i.pl_plans) && i.pl_plans.length ? { chat: i.pl_chat !== false, porDia: Math.max(0, Math.min(10, Number(i.pl_daily) || 0)),
          dias: (Array.isArray(i.pl_days) ? i.pl_days : [1, 2, 3, 4]).map(Number).filter((d: number) => d >= 0 && d <= 6),
          planos: i.pl_plans.slice(0, 6).map((p: any) => ({ nome: String(p.nome || "").slice(0, 40), preco: Number(p.preco) || 0, avulso: Number(p.avulso) || 0, visitas: Math.max(1, Math.min(8, Number(p.visitas) || 4)), quando: String(p.quando || "").slice(0, 80) })).filter((p: any) => p.nome && p.preco && p.avulso > p.preco),
          texto: String(i.pl_text || "").slice(0, 2000), codigo_estabelecimento: i.est_code, codigo_filial: i.branch_code || "", appbarber_api_key: i.api_key } : null,
        // Confirmação de presença: pedido na véspera e 2º aviso no dia (a atendente IA confirma, remarca ou cancela).
        confirmacao: i.cf_on && i.est_code && i.api_key ? { hora: /^\d{2}:\d{2}$/.test(String(i.cf_hour || "")) ? i.cf_hour : "17:00", segundo: i.cf_second !== false,
          antes: Math.max(60, Math.min(360, Number(i.cf_before) || 180)), texto: String(i.cf_text || "").slice(0, 2000), texto2: String(i.cf_text2 || "").slice(0, 1000),
          codigo_estabelecimento: i.est_code, codigo_filial: i.branch_code || "", appbarber_api_key: i.api_key } : null,
        // Preencher vagas: cancelamento de hoje/amanhã vira convite para clientes do mesmo profissional no prazo de voltar.
        vagas: i.fv_on && i.est_code && i.api_key ? { porVaga: Math.max(1, Math.min(3, Number(i.fv_per) || 2)), porDia: Math.max(1, Math.min(30, Number(i.fv_daily) || 8)),
          antecedencia: Math.max(30, Math.min(240, Number(i.fv_lead) || 90)), dias: Number(i.fv_days) === 1 ? 1 : 2, texto: String(i.fv_text || "").slice(0, 2000),
          codigo_estabelecimento: i.est_code, codigo_filial: i.branch_code || "", appbarber_api_key: i.api_key } : null,
        retorno: i.rt_on && i.est_code && i.api_key ? { porDia: Math.max(1, Math.min(30, Number(i.rt_daily) || 10)), antes: i.rt_lead == null || !Number.isFinite(Number(i.rt_lead)) ? 2 : Math.max(-3, Math.min(7, Math.round(Number(i.rt_lead)))), texto: i.rt_text || "", codigo_estabelecimento: i.est_code, codigo_filial: i.branch_code || "", appbarber_api_key: i.api_key } : null,
        // Totem de autoatendimento na recepção (check-in e agendamento na hora).
        totem: i.tt_on && i.est_code && i.api_key ? { avisar: i.tt_notify !== false, dias: Math.max(1, Math.min(30, Number(i.tt_days) || 7)), upsell: upsellCfg(i) } : null,
        // Estado do número dos clientes: o programa da equipe (outro número) avisa quando ele desconecta.
        wa_clientes: i.cl_on || i.ia_on || i.wb_on || i.bd_on || i.fb_on || i.rt_on || i.fv_on || i.cf_on || i.pl_on || i.ac_on ? { status: i.cl_status || "", em: i.cl_status_at, numero: i.cl_numero === "principal" ? "principal" : "chip", sofia: !!i.ia_on, alerta: String(i.ia_alert_phone || i.ia_report_phone || "").replace(/\D/g, "") } : null,
        cfg: { ligado: !!i.wa_on, hora: i.wa_hour || "13:00", minimo: Number(i.wa_min) || 0, texto: i.wa_text || "" },
        // Lembrete de agendamento para os clientes (o servidor consulta a agenda da AppBarber).
        clientes: i.cl_on && i.est_code && i.api_key ? { numero: i.cl_numero === "principal" ? "principal" : "chip", antecedencia: Number(i.cl_lead) || 60, texto: i.cl_text || "", resposta: i.cl_reply || "", codigo_estabelecimento: i.est_code, codigo_filial: i.branch_code || "", appbarber_api_key: i.api_key } : null,
        brand: co.settings?.brand || "barber", popCfg: co.settings?.pop || null,
        // Horário de funcionamento (Configurações): fora dele e nos dias fechados não consulta a AppBarber nem manda lembrete.
        horario: (() => { const o = co.settings?.ocup || {}, ok = (v: unknown, d: string) => (typeof v === "string" && /^\d{2}:\d{2}$/.test(v) ? v : d);
          return { abertura: ok(o.open, "09:00"), fechamento: ok(o.close, "20:00"), fechados: Array.isArray(o.closed) ? o.closed.map(Number) : [] }; })(),
        barbers: (barbers || []).filter((b) => b.active !== false).map((b) => ({ id: b.id, name: b.name, phone: fone.get(String(b.id)) || "", ...(fid.has(String(b.id)) ? { fid: fid.get(String(b.id)) } : {}) })),
        pop: (pop || []).map((r) => ({ barberId: r.barber_id, day: r.day, ...(r.data || {}) })),
        entries: (entries || []).map((e) => ({ barberId: e.barber_id, date: e.date, source: e.source, ...(e.data || {}) })),
        memorias,
        // Botão "Atualizar servidor agora" do app (até o servidor responder com a versão).
        atualizar: !!(i.srv_update_req && (!i.srv_update_done || i.srv_update_done < i.srv_update_req) && Date.now() - new Date(i.srv_update_req).getTime() < 30 * 60000),
        // Boletim do dono: pronto a partir do horário escolhido, uma vez por dia (o servidor manda e avisa bo_enviado).
        boletim: await (async () => {
          if (!i.bo_on || (i.bo_sent_on === hoje && !i.bo_force)) return null;
          const agora = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
          if (!i.bo_force && agora < (/^\d{2}:\d{2}$/.test(String(i.bo_hour || "")) ? i.bo_hour : "20:30")) return null;
          const fone = String(i.bo_phone || i.ia_report_phone || "").replace(/\D/g, "").slice(0, 15); if (fone.length < 10) return null;
          return { fone, texto: await boletimTexto(db, i, co, hoje, barbers || [], entries || []) };
        })(),
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
      const lista = (Array.isArray(b.lista) ? b.lista : []).slice(0, 400).map((x: any) => ({ codigo: Number(x.codigo) || 0, nome: String(x.nome || "").slice(0, 80), preco: Number(x.preco) || null, minutos: Number(x.minutos) || null })).filter((x: any) => x.nome);
      const { error } = await db.from("integrations").update({ ab_services: lista }).eq("company_id", b.company_id);
      return error ? json({ erro: error.message }, 500) : json({ ok: true });
    }
    // Resultado da atendente IA e do totem: eventos (agendamentos, custo…) e o comparecimento conferido depois.
    if (b.acao === "ia_eventos") {
      const lista = (Array.isArray(b.eventos) ? b.eventos : []).slice(0, 200).map((x: any) => ({
        company_id: b.company_id, em: typeof x.em === "string" ? x.em : new Date().toISOString(), tipo: String(x.tipo || "").slice(0, 20),
        origem: x.origem ? String(x.origem).slice(0, 20) : null, valor: Number.isFinite(Number(x.valor)) ? Number(x.valor) : null,
        ref: x.ref ? String(x.ref).slice(0, 80) : null, dados: x.dados && typeof x.dados === "object" ? x.dados : {} })).filter((x: any) => x.tipo);
      if (!lista.length) return json({ ok: true });
      const { error } = await db.from("ia_eventos").upsert(lista, { onConflict: "company_id,ref", ignoreDuplicates: true });
      return error ? json({ erro: error.message }, 500) : json({ ok: true, n: lista.length });
    }
    // Memória do cliente (atendente IA): a cópia do servidor, para a equipe ver no app. Não mexe em app_em.
    if (b.acao === "ia_memoria") {
      const chave = String(b.chave || "").replace(/[^a-f0-9]/g, "").slice(0, 32);
      if (!chave) return json({ erro: "Chave inválida." }, 400);
      const notas = (Array.isArray(b.notas) ? b.notas : []).slice(-10).map((n: any) => ({ t: String(n && n.t || "").slice(0, 120), em: String(n && n.em || "").slice(0, 10) })).filter((n: any) => n.t);
      const { error } = await db.from("ia_memorias").upsert({ company_id: b.company_id, chave, nome: String(b.nome || "").slice(0, 60), fone4: String(b.fone4 || "").replace(/\D/g, "").slice(-4), notas, atualizado: new Date().toISOString() }, { onConflict: "company_id,chave" });
      return error ? json({ erro: error.message }, 500) : json({ ok: true });
    }
    if (b.acao === "srv_versao") {
      const v = `${String(b.versao || "").slice(0, 10)}${b.sofia ? ` · atendente ${String(b.sofia).slice(0, 10)}` : ""}`;
      const { data: at } = await db.from("integrations").select("srv_update_req").eq("company_id", b.company_id).maybeSingle();
      const upd: any = { srv_version: v, srv_version_at: new Date().toISOString(), srv_msg: String(b.msg || "").slice(0, 200) || null };
      if (at && at.srv_update_req) upd.srv_update_done = new Date().toISOString();
      const { error } = await db.from("integrations").update(upd).eq("company_id", b.company_id);
      return error ? json({ erro: error.message }, 500) : json({ ok: true });
    }
    if (b.acao === "bo_enviado") {
      const hojeSP = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
      const { error } = await db.from("integrations").update(b.ok ? { bo_sent_on: hojeSP, bo_force: false, bo_status: "ok: enviado às " + new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date()), bo_status_at: new Date().toISOString() }
        : { bo_sent_on: hojeSP, bo_force: false, bo_status: "erro: " + String(b.erro || "não enviado").slice(0, 200), bo_status_at: new Date().toISOString() }).eq("company_id", b.company_id);
      return error ? json({ erro: error.message }, 500) : json({ ok: true });
    }
    if (b.acao === "ia_compareceu") {
      for (const x of (Array.isArray(b.itens) ? b.itens : []).slice(0, 300)) {
        if (!x || !x.ref) continue;
        await db.from("ia_eventos").update({ compareceu: !!x.ok }).eq("company_id", b.company_id).eq("ref", String(x.ref).slice(0, 80));
      }
      return json({ ok: true });
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
    if (["wa_status", "cl_status", "fb_status", "wb_status", "rt_status", "tt_status", "bd_status", "ia_status", "fv_status", "cf_status", "pl_status", "ac_status"].includes(b.acao)) {
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
