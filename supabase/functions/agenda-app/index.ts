// Gestão Barber IA — web app do cliente (agendar.html). Pública: { empresa, acao, dados, token }.
// Funil: mapa { de, ate, servicos } · cotar/agendar { …, extras, produtos, cupom, usar_credito } · oferta/aceitar_oferta/remover_oferta { id }
// Ações: info · codigo { … } · favorito { profissional } · avaliar { id, nota, comentario, publico } ·  { nome, sobrenome, fone } · verificar { fone, codigo } → token · eu · horarios { data, servicos, profissional }
//        · agendar { data, hora, servicos, profissional } · cancelar { id } · perfil { nome, sobrenome, email, nascimento } · sair
// O código de 4 dígitos sai pelo WhatsApp da barbearia (fila wa_saida, enviada pelo servidor). A sessão é um token
// aleatório (só o hash fica salvo), válido por 180 dias.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const erro = (m: string, status = 400) => json({ erro: m }, status);
async function sha256(t: string) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
const so = (t: unknown) => String(t ?? "").replace(/\D/g, "");
const foneBR = (t: unknown) => { let d = so(t); if (d.length > 11 && d.startsWith("55")) d = d.slice(2); d = d.replace(/^0+/, ""); return d.length === 10 || d.length === 11 ? d : ""; };
// Texto livre do cliente (comentário): guarda como foi escrito; as telas sempre mostram escapado.
const texto = (t: unknown, n: number) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const limpo = (t: unknown, n: number) => String(t ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const agoraMin = () => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).split(":").map(Number); return p[0] * 60 + p[1]; };
const somaDias = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mins = (h: string) => { const [a, b] = String(h || "0:0").split(":").map(Number); return (a || 0) * 60 + (b || 0); };
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const minDe = (iso: string) => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)).split(":").map(Number); return p[0] * 60 + p[1]; };
const diaDe = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
const quando = (data: string, m: number) => `${data}T${hhmm(m)}:00-03:00`;
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

// Horários livres de um profissional num dia (mesma regra do app da equipe).
function livres(p: any, data: string, dur: number, ocupados: [number, number][], cfg: any, fech: number[], padrao: any, desde: number) {
  const dow = new Date(data + "T12:00:00Z").getUTCDay();
  let faixas: [string, string][] = Array.isArray((p.horarios || {})[dow]) ? p.horarios[dow] : null as any;
  if (!faixas) faixas = fech.includes(dow) ? [] : [[padrao.open, padrao.close]];
  const passo = Math.max(5, Number(cfg.passo) || 20), out: number[] = [];
  for (const [a, b] of faixas) {
    const ini = mins(a), fim = mins(b);
    for (let t = Math.ceil(ini / passo) * passo; t + dur <= fim; t += passo) {
      if (t < desde) continue;
      if (ocupados.some(([x, y]) => t < y && t + dur > x)) continue;
      out.push(t);
    }
  }
  // Sem buraco: dentro de cada faixa livre, prefere horários que encostam ou deixam espaço para outro serviço.
  const min = Number(cfg.buraco_min) || 0; if (!min || !out.length) return out;
  const livre = (t: number) => faixas.some(([a, b]) => t >= mins(a) && t < mins(b)) && !ocupados.some(([x, y]) => t >= x && t < y) && t >= desde;
  const bons = out.filter((t) => { let antes = 0; for (let x = t - 5; livre(x) && antes < 600; x -= 5) antes += 5; let depois = 0; for (let x = t + dur; livre(x) && depois < 600; x += 5) depois += 5;
    return (antes === 0 || antes >= min) && (depois === 0 || depois >= min); });
  return bons.length ? bons : out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return erro("Use POST.", 405);
  let b: any; try { b = await req.json(); } catch { return erro("Pedido inválido."); }
  let empresa = String(b?.empresa || "");
  const acao = String(b?.acao || ""), d = (b && typeof b.dados === "object" && b.dados) || {};
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  // Link personalizado (/agendar/<nome>): descobre a empresa pelo nome escolhido por ela.
  if (!empresa && /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(String(b?.slug || "").toLowerCase())) {
    const { data: sl } = await db.from("ag_config").select("company_id").eq("slug", String(b.slug).toLowerCase()).maybeSingle();
    if (sl) empresa = sl.company_id;
  }
  if (!/^[0-9a-f-]{36}$/i.test(empresa)) return erro("Link inválido. Peça o link certo para a barbearia.", 404);
  const [{ data: co }, { data: cfg0 }] = await Promise.all([
    db.from("companies").select("name, logo, settings, sub_status, paid_until").eq("id", empresa).maybeSingle(),
    db.from("ag_config").select("*").eq("company_id", empresa).maybeSingle(),
  ]);
  const pago = co && ["active", "courtesy", "canceled"].includes(co.sub_status) && (co.paid_until ? new Date(co.paid_until + "T23:59:59Z").getTime() + 86400000 : 0) >= Date.now();
  if (!co || !cfg0 || !cfg0.ativo || !pago) return erro("O agendamento online desta barbearia não está ligado.", 403);
  const cfg = cfg0, o = (co.settings || {}).ocup || {}, padrao = { open: typeof o.open === "string" ? o.open : "09:00", close: typeof o.close === "string" ? o.close : "20:00" };
  const fech = Array.isArray(o.closed) ? o.closed.map(Number) : [0];

  // Sessão do cliente
  let cli: any = null;
  if (b.token && /^[0-9a-f]{64}$/.test(String(b.token))) {
    const { data: c } = await db.from("ag_clientes").select("*").eq("company_id", empresa).eq("sessao_hash", await sha256(String(b.token))).maybeSingle();
    if (c && c.sessao_expira && new Date(c.sessao_expira).getTime() > Date.now()) cli = c;
  }
  const precisaLogin = () => erro("Entre de novo com o seu WhatsApp, por favor.", 401);
  const servicosAtivos = async () => ((await db.from("ag_servicos").select("id, nome, duracao, preco, online, ativo, ordem, icone, descricao, extra_sem_tempo, recomenda, recomenda_produtos").eq("company_id", empresa).eq("ativo", true).order("ordem")).data || []).filter((s: any) => s.online);
  const profsAtivos = async () => {
    // Sem cadastro na agenda: entra com o horário da empresa (menos quem é da recepção), como no app da equipe.
    const [{ data: ps }, { data: bs }] = await Promise.all([db.from("ag_profissionais").select("*").eq("company_id", empresa), db.from("barbers").select("id, name, photo, active, role, unit").eq("company_id", empresa)]);
    const by = new Map((ps || []).map((p: any) => [p.barber_id, p]));
    return (bs || []).filter((b: any) => b.active !== false).map((b: any) => ({ ...(by.get(b.id) || { barber_id: b.id, ativo: !/recep/i.test(b.role || ""), online: true, servicos: [], horarios: {} }), nome: b.name, foto: b.photo || "", unidade: b.unit || "" }))
      .filter((p: any) => p.ativo && p.online).sort((a: any, b: any) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
  };

  if (acao === "info") {
    // Regra da fonte da agenda: com um sistema externo conectado (ex.: AppBarber), o sistema usa só os dados dele e
    // esta agenda fica em modo teste; ela só vale como agenda da barbearia quando não há API conectada.
    const [servs, profs, { data: ext }, { count: nCupons }, { data: avs }] = await Promise.all([servicosAtivos(), profsAtivos(), db.from("integrations").select("est_code, active").eq("company_id", empresa).maybeSingle(),
      db.from("ag_cupons").select("id", { count: "exact", head: true }).eq("company_id", empresa).eq("ativo", true),
      cfg.avaliacoes_on ? db.from("ag_avaliacoes").select("nota, comentario, publico, oculto, nome_publico, barber_id, criado_em").eq("company_id", empresa).order("criado_em", { ascending: false }).limit(500) : Promise.resolve({ data: [] })]);
    // Vitrine: só endereços https (imagens no armazenamento), textos limpos.
    const url = (u: unknown) => (/^https:\/\/[^\s"'<>]+$/.test(String(u || "")) ? String(u) : "");
    const st = co.settings || {}, units: string[] = Array.isArray(st.units) ? st.units.filter((x: any) => typeof x === "string" && x.trim()) : [];
    const uInfo = cfg.unidades || {}, pInfo = cfg.planos_info || {};
    const nomeP = new Map(profs.map((p: any) => [p.barber_id, p.nome]));
    const notas = (avs || []), media = notas.length ? Math.round(notas.reduce((t: number, a: any) => t + a.nota, 0) / notas.length * 10) / 10 : 0;
    return json({ ok: true, empresa, slug: cfg.slug || "", teste: !!(ext && ext.est_code && ext.active !== false), nome: co.name, logo: url(co.logo), marca: st.brand || "barber", aviso: cfg.aviso || "", dias_max: cfg.dias_max, cancelar_horas: cfg.cancelar_horas, hoje: hojeSP(), fechados: fech,
      abre: padrao.open, fecha: padrao.close, chegar_antes: Number(cfg.chegar_antes) || 0, tem_cupom: (nCupons || 0) > 0,
      cashback: (cfg.cashback || {}).ativo && Number((cfg.cashback || {}).pct) > 0 ? { pct: Number(cfg.cashback.pct), minimo: Number(cfg.cashback.minimo) || 0, validade: Number(cfg.cashback.validade) || 0 } : null, capa: url(cfg.capa), banners: (Array.isArray(cfg.banners) ? cfg.banners : []).map((x: any) => url(x && x.url)).filter(Boolean).slice(0, 8),
      endereco: limpo(cfg.endereco, 200), mapa: url(cfg.mapa), whatsapp: so(cfg.whatsapp).slice(0, 13), instagram: limpo(cfg.instagram, 60).replace(/^@/, "").replace(/[^\w.]/g, ""),
      faq: (Array.isArray(cfg.faq) ? cfg.faq : []).filter((x: any) => x && x.p && x.r).slice(0, 30).map((x: any) => ({ p: limpo(x.p, 200), r: String(x.r).replace(/[<>]/g, "").slice(0, 1500) })),
      termos: String(cfg.termos || "").replace(/[<>]/g, "").slice(0, 20000),
      planos: (Array.isArray(st.planos) ? st.planos : []).filter((p: any) => p && p.n && !(pInfo[p.id] || {}).ocultar).map((p: any) => ({ id: p.id, nome: limpo(p.n, 60), valor: Number(p.v) || 0, desc: String((pInfo[p.id] || {}).desc || "").replace(/[<>]/g, "").slice(0, 600) })),
      unidades: units.length > 1 ? units.map((n) => ({ nome: limpo(n, 60), endereco: limpo((uInfo[n] || {}).endereco, 200), mapa: url((uInfo[n] || {}).mapa), capa: url((uInfo[n] || {}).capa), whatsapp: so((uInfo[n] || {}).whatsapp).slice(0, 13) })) : [],
      avaliacoes: cfg.avaliacoes_on ? { media, total: notas.length, lista: notas.filter((a: any) => a.publico && !a.oculto && a.comentario).slice(0, 20).map((a: any) => ({ nota: a.nota, comentario: texto(a.comentario, 400), nome: limpo(a.nome_publico, 40), profissional: String(nomeP.get(a.barber_id) || "").split(" ")[0], em: String(a.criado_em).slice(0, 10) })) } : null,
      servicos: servs.map((s: any) => ({ id: s.id, nome: s.nome, duracao: s.duracao, preco: Number(s.preco) || 0, icone: /^[a-z]{2,20}$/.test(s.icone || "") ? s.icone : url(s.icone), descricao: limpo(s.descricao, 80), sem_tempo: !!s.extra_sem_tempo })),
      profissionais: profs.map((p: any) => ({ id: p.barber_id, nome: p.nome, foto: url(p.foto), servicos: p.servicos || [], unidade: units.length > 1 ? p.unidade : "" })),
      cliente: cli ? { nome: cli.nome, sobrenome: cli.sobrenome, fone: cli.fone, email: cli.email, nascimento: cli.nascimento, favorito: cli.favorito || null } : null });
  }

  if (acao === "codigo") {
    const fone = foneBR(d.fone), nome = limpo(d.nome, 40), sobrenome = limpo(d.sobrenome, 60);
    if (!fone) return erro("Confira o número de WhatsApp com DDD.");
    if (!nome || !sobrenome) return erro("Informe o nome e o sobrenome.");
    const { data: ult } = await db.from("ag_codigos").select("criado_em").eq("company_id", empresa).eq("fone", fone).order("criado_em", { ascending: false }).limit(5);
    if (ult && ult[0] && Date.now() - new Date(ult[0].criado_em).getTime() < 60000) return erro("Aguarde 1 minuto para pedir outro código.", 429);
    if (ult && ult.filter((x: any) => Date.now() - new Date(x.criado_em).getTime() < 3600000).length >= 5) return erro("Muitos códigos pedidos. Tente de novo mais tarde.", 429);
    const { count } = await db.from("ag_codigos").select("id", { count: "exact", head: true }).eq("company_id", empresa).gte("criado_em", new Date(Date.now() - 3600000).toISOString());
    if ((count || 0) > 60) return erro("Muitos pedidos agora. Tente em alguns minutos.", 429);
    const { data: it } = await db.from("integrations").select("ws_seen_at").eq("company_id", empresa).maybeSingle();
    if (!it || !it.ws_seen_at || Date.now() - new Date(it.ws_seen_at).getTime() > 120000) return erro("Não conseguimos enviar o código pelo WhatsApp agora. Tente em alguns minutos ou fale com a barbearia.", 503);
    const codigo = String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, "0");
    await db.from("ag_codigos").insert({ company_id: empresa, fone, codigo_hash: await sha256(empresa + fone + codigo), nome, sobrenome, expira: new Date(Date.now() + 10 * 60000).toISOString() });
    await db.from("wa_saida").insert({ company_id: empresa, fone, texto: `Seu código para agendar na ${co.name}: *${codigo}*\nEle vale por 10 minutos. Se não foi você, ignore esta mensagem.` });
    return json({ ok: true });
  }

  if (acao === "verificar") {
    const fone = foneBR(d.fone), codigo = so(d.codigo).slice(0, 4);
    if (!fone || codigo.length !== 4) return erro("Digite o código de 4 números.");
    const { data: c } = await db.from("ag_codigos").select("*").eq("company_id", empresa).eq("fone", fone).eq("usado", false).order("criado_em", { ascending: false }).limit(1).maybeSingle();
    if (!c || new Date(c.expira).getTime() < Date.now()) return erro("O código venceu. Peça outro.");
    if (c.tentativas >= 5) return erro("Muitas tentativas. Peça outro código.");
    if (c.codigo_hash !== await sha256(empresa + fone + codigo)) { await db.from("ag_codigos").update({ tentativas: c.tentativas + 1 }).eq("id", c.id); return erro("Código errado. Confira e tente de novo."); }
    await db.from("ag_codigos").update({ usado: true }).eq("id", c.id);
    const token = [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("");
    const { data: ja } = await db.from("ag_clientes").select("id, nome, sobrenome").eq("company_id", empresa).eq("fone", fone).maybeSingle();
    const dados = { sessao_hash: await sha256(token), sessao_expira: new Date(Date.now() + 180 * 86400000).toISOString(), verificado_em: new Date().toISOString() };
    if (ja) await db.from("ag_clientes").update({ ...dados, ...(ja.nome ? {} : { nome: c.nome }), ...(ja.sobrenome ? {} : { sobrenome: c.sobrenome }) }).eq("id", ja.id);
    else await db.from("ag_clientes").insert({ company_id: empresa, fone, nome: c.nome, sobrenome: c.sobrenome, ...dados });
    return json({ ok: true, token });
  }

  if (!cli) return precisaLogin();

  if (acao === "sair") { await db.from("ag_clientes").update({ sessao_hash: null, sessao_expira: null }).eq("id", cli.id); return json({ ok: true }); }

  if (acao === "eu") {
    const { data: ags } = await db.from("ag_agendamentos").select("id, barber_id, inicio, fim, servicos, produtos, valor, status, cashback, desconto, credito_usado").eq("company_id", empresa).eq("cliente_id", cli.id).gte("inicio", new Date(Date.now() - 365 * 86400000).toISOString()).order("inicio").limit(80);
    const [{ data: bs }, { data: avd }, { data: saldo }, { data: ext }] = await Promise.all([db.from("barbers").select("id, name").eq("company_id", empresa), db.from("ag_avaliacoes").select("agendamento_id").eq("cliente_id", cli.id),
      db.rpc("ag_saldo", { p_cliente: cli.id }), db.from("ag_cashback").select("tipo, valor, status, expira, criado_em").eq("cliente_id", cli.id).neq("status", "cancelado").order("criado_em", { ascending: false }).limit(30)]);
    const avaliado = new Set((avd || []).map((x: any) => x.agendamento_id));
    const nm = new Map((bs || []).map((x: any) => [x.id, x.name]));
    const lim = (Number(cfg.cancelar_horas) || 0) * 3600000;
    return json({ ok: true, cliente: { nome: cli.nome, sobrenome: cli.sobrenome, fone: cli.fone, email: cli.email, nascimento: cli.nascimento, favorito: cli.favorito || null },
      cashback: { saldo: Number(saldo) || 0, extrato: (ext || []).map((x: any) => ({ tipo: x.tipo, valor: Number(x.valor), status: x.status, expira: x.expira, em: String(x.criado_em).slice(0, 10) })) },
      agendamentos: (ags || []).map((a: any) => ({ id: a.id, inicio: a.inicio, profissional: nm.get(a.barber_id) || "", servicos: (a.servicos || []).map((s: any) => s.nome), produtos: (a.produtos || []).map((p: any) => (p.qtd > 1 ? p.qtd + "x " : "") + p.nome), valor: Number(a.valor) || 0, cashback: Number(a.cashback) || 0, status: a.status, profissional_id: a.barber_id, servico_ids: (a.servicos || []).filter((s: any) => !s.extra).map((s: any) => s.id).filter(Boolean),
        avaliado: avaliado.has(a.id), pode_avaliar: !!cfg.avaliacoes_on && a.status === "finalizado" && !avaliado.has(a.id),
        pode_cancelar: ["agendado", "confirmado"].includes(a.status) && new Date(a.inicio).getTime() - Date.now() > lim })) });
  }

  if (acao === "favorito") {
    const id = d.profissional ? String(d.profissional).slice(0, 60) : null;
    if (id && !(await profsAtivos()).some((p: any) => p.barber_id === id)) return erro("Profissional não encontrado.");
    await db.from("ag_clientes").update({ favorito: id }).eq("id", cli.id);
    return json({ ok: true });
  }

  if (acao === "avaliar") {
    if (!cfg.avaliacoes_on) return erro("As avaliações estão desligadas.");
    const nota = Math.round(Number(d.nota)); if (!(nota >= 1 && nota <= 5)) return erro("Escolha de 1 a 5 estrelas.");
    const { data: a } = await db.from("ag_agendamentos").select("id, cliente_id, barber_id, status, inicio").eq("id", String(d.id || "")).eq("company_id", empresa).maybeSingle();
    if (!a || a.cliente_id !== cli.id) return erro("Atendimento não encontrado.", 404);
    if (a.status !== "finalizado" && !(a.status === "chegou" && new Date(a.inicio).getTime() < Date.now())) return erro("Dá para avaliar depois do atendimento.");
    const { error } = await db.from("ag_avaliacoes").insert({ company_id: empresa, agendamento_id: a.id, cliente_id: cli.id, barber_id: a.barber_id, nota, comentario: texto(d.comentario, 400), publico: !!d.publico,
      nome_publico: `${String(cli.nome || "").split(" ")[0]} ${String(cli.sobrenome || "").charAt(0)}${cli.sobrenome ? "." : ""}`.trim() });
    if (error) return erro(/duplicate|unique/i.test(error.message) ? "Esse atendimento já foi avaliado. Obrigado!" : "Não consegui salvar agora. Tente de novo.");
    return json({ ok: true });
  }

  if (acao === "perfil") {
    const up: any = {};
    if (d.nome !== undefined) up.nome = limpo(d.nome, 40);
    if (d.sobrenome !== undefined) up.sobrenome = limpo(d.sobrenome, 60);
    if (d.email !== undefined) { const e = String(d.email || "").trim().slice(0, 120); if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return erro("Confira o e-mail."); up.email = e; }
    if (d.nascimento !== undefined) { const n = String(d.nascimento || ""); if (n && (!/^\d{4}-\d{2}-\d{2}$/.test(n) || n > hojeSP() || n < "1910-01-01")) return erro("Confira a data de nascimento."); up.nascimento = n || null; }
    if (up.nome === "" || up.sobrenome === "") return erro("Nome e sobrenome não podem ficar vazios.");
    await db.from("ag_clientes").update(up).eq("id", cli.id);
    return json({ ok: true });
  }

  // ---------- Agendamento e funil de venda ----------
  const servs = await servicosAtivos(), porId = (id: string) => servs.find((s: any) => s.id === id);
  const escolhidos = (Array.isArray(d.servicos) ? d.servicos : []).slice(0, 6).map((id: string) => porId(id)).filter(Boolean);
  const durDe = (l: any[]) => l.reduce((t: number, s: any) => t + (Number(s.duracao) || 30), 0);
  const dur = durDe(escolhidos), data = String(d.data || "");
  const hoje = hojeSP(), limiteDia = somaDias(hoje, Math.max(1, Number(cfg.dias_max) || 30));
  const dataOk = /^\d{4}-\d{2}-\d{2}$/.test(data) && data >= hoje && data <= limiteDia;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const un = d.unidade ? String(d.unidade) : "";
  // Ocupação (horários e bloqueios) de um período, carregada uma vez.
  async function ocupacao(de: string, ate: string) {
    const ini = quando(de, 0), fim = quando(ate, 24 * 60 - 1);
    const [{ data: ags }, { data: bls }] = await Promise.all([
      db.from("ag_agendamentos").select("id, barber_id, inicio, fim, status").eq("company_id", empresa).lt("inicio", fim).gt("fim", ini).not("status", "in", "(cancelado,faltou)").limit(5000),
      db.from("ag_bloqueios").select("barber_id, inicio, fim").eq("company_id", empresa).lt("inicio", fim).gt("fim", ini).limit(2000),
    ]);
    return { ags: ags || [], bls: bls || [] };
  }
  let profsCache: any[] | null = null;
  const profsDe = async (prefer: string | null, lista: any[]) => (profsCache = profsCache || await profsAtivos())
    .filter((p: any) => (!prefer || p.barber_id === prefer) && (!un || prefer || p.unidade === un) && (!(p.servicos || []).length || lista.every((s: any) => p.servicos.includes(s.id))));
  // Horários livres de cada profissional num dia. bruto = sem a preferência de "sem buraco" (para conferir um horário escolhido).
  async function disponiveis(dia: string, prefer: string | null, duracao = dur, lista = escolhidos, oc?: any, bruto = false, ignorar = "") {
    const profs = await profsDe(prefer, lista); if (!profs.length) return [];
    const { ags, bls } = oc || await ocupacao(dia, dia);
    const desde = dia === hoje ? agoraMin() + (Number(cfg.antecedencia) || 0) : 0;
    const noDia = (x: any) => diaDe(x.inicio) <= dia && diaDe(x.fim) >= dia;
    const faixa = (x: any): [number, number] => [diaDe(x.inicio) < dia ? 0 : minDe(x.inicio), diaDe(x.fim) > dia ? 24 * 60 : minDe(x.fim)];
    return profs.map((p: any) => {
      const deles = ags.filter((a: any) => a.barber_id === p.barber_id && a.id !== ignorar && noDia(a));
      const ocup = [...deles, ...bls.filter((x: any) => (!x.barber_id || x.barber_id === p.barber_id) && noDia(x))].map(faixa);
      const cfgX = bruto ? { ...cfg, buraco_min: 0 } : cfg;
      return { id: p.barber_id, nome: p.nome, foto: /^https:\/\//.test(p.foto) ? p.foto : "", carga: deles.length, horarios: livres(p, dia, duracao, ocup, cfgX, fech, padrao, desde).map(hhmm) };
    });
  }
  // Orçamento: serviços + extras + produtos, cupom, crédito de cashback e o cashback que ele vai ganhar.
  async function orcamento() {
    const recS = new Set<string>(), recP = new Set<string>();
    for (const s of escolhidos) { (s.recomenda || []).forEach((x: string) => recS.add(x)); (s.recomenda_produtos || []).forEach((x: string) => recP.add(x)); }
    const { data: prods } = await db.from("ag_produtos").select("id, nome, descricao, preco, foto").eq("company_id", empresa).eq("ativo", true).eq("online", true).order("ordem").limit(100);
    const extras = (Array.isArray(d.extras) ? d.extras : []).slice(0, 6).map((id: string) => porId(id)).filter((s: any) => s && !escolhidos.some((e: any) => e.id === s.id));
    const produtos = (Array.isArray(d.produtos) ? d.produtos : []).slice(0, 10).map((x: any) => { const p = (prods || []).find((y: any) => y.id === (x && x.id)); return p ? { id: p.id, nome: p.nome, preco: Number(p.preco) || 0, qtd: Math.max(1, Math.min(5, Math.round(Number(x.qtd) || 1))) } : null; }).filter(Boolean);
    const durTotal = dur + extras.reduce((t: number, s: any) => t + (s.extra_sem_tempo ? 0 : Number(s.duracao) || 30), 0);
    const vServ = escolhidos.reduce((t: number, s: any) => t + (Number(s.preco) || 0), 0), vExtra = extras.reduce((t: number, s: any) => t + (Number(s.preco) || 0), 0);
    const vProd = produtos.reduce((t: number, p: any) => t + p.preco * p.qtd, 0), subtotal = r2(vServ + vExtra + vProd);
    // Cupom
    let desconto = 0, cupom: any = null, cupomMsg = "";
    const codigo = String(d.cupom || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 30);
    if (codigo) {
      const { data: c } = await db.from("ag_cupons").select("*").eq("company_id", empresa).eq("codigo", codigo).maybeSingle();
      if (!c || !c.ativo) cupomMsg = "Cupom não encontrado.";
      else if (c.validade && c.validade < hoje) cupomMsg = "Esse cupom venceu.";
      else if (subtotal < Number(c.minimo || 0)) cupomMsg = `Esse cupom vale a partir de R$ ${Number(c.minimo).toFixed(2).replace(".", ",")}.`;
      else {
        const [{ count: usos }, { count: meus }] = await Promise.all([
          db.from("ag_cupom_usos").select("id", { count: "exact", head: true }).eq("cupom_id", c.id),
          db.from("ag_cupom_usos").select("id", { count: "exact", head: true }).eq("cupom_id", c.id).eq("cliente_id", cli.id)]);
        if (c.limite && (usos || 0) >= c.limite) cupomMsg = "Esse cupom já esgotou.";
        else if (c.por_cliente && (meus || 0) > 0) cupomMsg = "Você já usou esse cupom.";
        else { cupom = c; desconto = r2(Math.min(subtotal, c.tipo === "pct" ? subtotal * Math.min(100, Number(c.valor) || 0) / 100 : Number(c.valor) || 0)); }
      }
    }
    // Crédito de cashback
    const cb = cfg.cashback || {}, { data: saldo0 } = await db.rpc("ag_saldo", { p_cliente: cli.id }), saldo = Number(saldo0) || 0;
    const teto = r2((subtotal - desconto) * Math.min(100, Math.max(0, Number(cb.max_uso ?? 100))) / 100);
    const credito = d.usar_credito ? r2(Math.min(saldo, teto)) : 0;
    const total = r2(Math.max(0, subtotal - desconto - credito));
    const pct = Math.max(0, Math.min(50, Number(cb.pct) || 0)), minimo = Math.max(0, Number(cb.minimo) || 0), ativo = !!cb.ativo && pct > 0;
    const ganho = ativo && total >= minimo ? r2(total * pct / 100) : 0;
    // Recomendados ("Aproveite também"): os escolhidos pela barbearia; sem escolha, extras que não ocupam tempo e os produtos.
    let rs = [...recS].map(porId).filter((s: any) => s && !escolhidos.some((e: any) => e.id === s.id));
    let rp = [...recP].map((id) => (prods || []).find((p: any) => p.id === id)).filter(Boolean);
    if (!recS.size && !recP.size) { rs = servs.filter((s: any) => s.extra_sem_tempo && !escolhidos.some((e: any) => e.id === s.id)).slice(0, 3); rp = (prods || []).slice(0, 3); }
    return { extras, produtos, durTotal, subtotal, vServ, vExtra, vProd, desconto, cupom, cupomMsg, codigo, saldo, credito, total, ganho, rs, rp, prods: prods || [],
      cashback: ativo ? { pct, minimo, ganho, falta: total < minimo ? r2(minimo - total) : 0, a_partir: r2(minimo * pct / 100), validade: Number(cb.validade) || 0 } : null };
  }
  const urlOk = (u: unknown) => (/^https:\/\/[^\s"'<>]+$/.test(String(u || "")) ? String(u) : "");

  if (acao === "horarios") {
    if (!escolhidos.length) return erro("Escolha pelo menos um serviço.");
    if (!dataOk) return erro("Escolha um dia dentro do período de agendamento.");
    const lista = await disponiveis(data, d.profissional ? String(d.profissional) : null);
    return json({ ok: true, data, duracao: dur, profissionais: lista.map(({ carga, ...x }: any) => x) });
  }

  // Calendário do mês: quantos horários livres em cada dia (verde = tem, vermelho = cheio/fechado).
  if (acao === "mapa") {
    if (!escolhidos.length) return erro("Escolha pelo menos um serviço.");
    const de = /^\d{4}-\d{2}-\d{2}$/.test(String(d.de || "")) && d.de > hoje ? String(d.de) : hoje;
    const ate0 = /^\d{4}-\d{2}-\d{2}$/.test(String(d.ate || "")) ? String(d.ate) : limiteDia, ate = ate0 < limiteDia ? ate0 : limiteDia;
    if (ate < de) return json({ ok: true, dias: {} });
    const oc = await ocupacao(de, ate), dias: Record<string, number> = {}, prefer = d.profissional ? String(d.profissional) : null;
    for (let dia = de, n = 0; dia <= ate && n < 62; dia = somaDias(dia, 1), n++) dias[dia] = (await disponiveis(dia, prefer, dur, escolhidos, oc)).reduce((t: number, p: any) => t + p.horarios.length, 0);
    return json({ ok: true, dias });
  }

  // Tela de confirmar: recomendados (com "cabe" para extras que ocupam tempo), totais, cupom, crédito e cashback.
  if (acao === "cotar" || acao === "agendar") {
    if (!escolhidos.length || !dataOk || !/^\d{2}:\d{2}$/.test(String(d.hora || ""))) return erro("Confira o serviço, o dia e o horário.");
    const o = await orcamento(), prefer = d.profissional ? String(d.profissional) : null, oc = await ocupacao(data, data);
    const candidatos = async (duracao: number) => (await disponiveis(data, prefer, duracao, [...escolhidos, ...o.extras], oc, true)).filter((p: any) => p.horarios.includes(d.hora)).sort((a: any, b: any) => a.carga - b.carga);
    if (acao === "cotar") {
      const cabe: Record<string, boolean> = {};
      for (const s of o.rs) cabe[s.id] = s.extra_sem_tempo ? true : (await candidatos(o.durTotal + (Number(s.duracao) || 30))).length > 0;
      return json({ ok: true, subtotal: o.subtotal, servicos: r2(o.vServ), extras: o.extras.map((s: any) => ({ id: s.id, nome: s.nome, preco: Number(s.preco) || 0 })), produtos: o.produtos, desconto: o.desconto,
        cupom: o.codigo ? { ok: !!o.cupom, codigo: o.codigo, msg: o.cupom ? `Cupom ${o.codigo} aplicado.` : o.cupomMsg } : null, saldo: o.saldo, credito: o.credito, total: o.total, duracao: o.durTotal, cashback: o.cashback,
        recomendados: [...o.rs.filter((s: any) => cabe[s.id]).map((s: any) => ({ tipo: "servico", id: s.id, nome: s.nome, descricao: limpo(s.descricao, 80), preco: Number(s.preco) || 0, icone: /^[a-z]{2,20}$/.test(s.icone || "") ? s.icone : urlOk(s.icone), sem_tempo: !!s.extra_sem_tempo, duracao: s.duracao })),
          ...o.rp.map((p: any) => ({ tipo: "produto", id: p.id, nome: p.nome, descricao: limpo(p.descricao, 80), preco: Number(p.preco) || 0, foto: urlOk(p.foto) }))] });
    }
    if (o.codigo && !o.cupom) return erro(o.cupomMsg || "Cupom inválido.");
    const { count: futuros } = await db.from("ag_agendamentos").select("id", { count: "exact", head: true }).eq("company_id", empresa).eq("cliente_id", cli.id).gte("inicio", new Date().toISOString()).in("status", ["agendado", "confirmado"]);
    if ((futuros || 0) >= 4) return erro("Você já tem 4 horários marcados. Para marcar mais, fale com a barbearia.");
    const cands = await candidatos(o.durTotal);
    if (!cands.length) return erro(o.extras.some((s: any) => !s.extra_sem_tempo) ? "Com o extra escolhido, o horário não cabe mais. Tire o extra ou escolha outro horário." : "Esse horário acabou de ser ocupado. Escolha outro, por favor.", 409);
    const p = cands[0], t = mins(d.hora);
    const linhas = [...escolhidos.map((s: any) => ({ id: s.id, nome: s.nome, duracao: s.duracao, preco: Number(s.preco) || 0 })),
      ...o.extras.map((s: any) => ({ id: s.id, nome: s.nome, duracao: s.extra_sem_tempo ? 0 : s.duracao, preco: Number(s.preco) || 0, extra: true }))];
    const { data: ag, error } = await db.from("ag_agendamentos").insert({ company_id: empresa, barber_id: p.id, cliente_id: cli.id, cliente_nome: `${cli.nome} ${cli.sobrenome}`.trim(), cliente_fone: cli.fone,
      inicio: quando(data, t), fim: quando(data, t + o.durTotal), servicos: linhas, produtos: o.produtos, subtotal: o.subtotal, desconto: o.desconto, cupom: o.cupom ? o.codigo : "", credito_usado: o.credito, cashback: o.ganho, valor: o.total, origem: "app" }).select("id").single();
    if (error) return erro(/ag_sem_conflito|exclusion/i.test(error.message) ? "Esse horário acabou de ser ocupado. Escolha outro, por favor." : "Não consegui marcar agora. Tente de novo.", 409);
    if (o.cupom) await db.from("ag_cupom_usos").insert({ cupom_id: o.cupom.id, company_id: empresa, cliente_id: cli.id, agendamento_id: ag.id });
    if (o.credito > 0) await db.from("ag_cashback").insert({ company_id: empresa, cliente_id: cli.id, agendamento_id: ag.id, tipo: "uso", valor: -o.credito, status: "liberado" });
    if (o.ganho > 0) await db.from("ag_cashback").insert({ company_id: empresa, cliente_id: cli.id, agendamento_id: ag.id, tipo: "ganho", valor: o.ganho, status: "pendente", expira: o.cashback && o.cashback.validade ? somaDias(data, o.cashback.validade) : null });
    const dia = data === hoje ? "hoje" : data === somaDias(hoje, 1) ? "amanhã" : `${DIAS[new Date(data + "T12:00:00Z").getUTCDay()]}, ${data.split("-").reverse().slice(0, 2).join("/")}`;
    const brl = (v: number) => "R$ " + v.toFixed(2).replace(".", ",");
    await db.from("wa_saida").insert({ company_id: empresa, fone: cli.fone, texto: `✅ Horário marcado na ${co.name}!\n${dia} às ${d.hora.replace(":", "h")} com ${String(p.nome).split(" ")[0]} (${linhas.map((s: any) => s.nome).join(" + ")}).` +
      (o.produtos.length ? `\n🛍️ Reservado para você: ${o.produtos.map((x: any) => (x.qtd > 1 ? x.qtd + "x " : "") + x.nome).join(", ")}.` : "") + `\nTotal: ${brl(o.total)}${o.desconto || o.credito ? ` (já com ${[o.desconto ? "cupom" : "", o.credito ? "crédito" : ""].filter(Boolean).join(" e ")})` : ""}.` +
      (o.ganho ? `\n💰 Você ganha ${brl(o.ganho)} de cashback depois do atendimento.` : "") + `\nChegue com ${Number(cfg.chegar_antes) || 10} minutos de antecedência. Te esperamos! 😊` });
    return json({ ok: true, id: ag.id, profissional: p.nome, data, hora: d.hora, total: o.total, cashback: o.ganho, duracao: o.durTotal });
  }

  // ---------- Oferta especial depois de confirmar ----------
  async function ofertaDe(id: string) {
    const { data: a } = await db.from("ag_agendamentos").select("*").eq("id", id).eq("company_id", empresa).maybeSingle();
    if (!a || a.cliente_id !== cli.id || !["agendado", "confirmado"].includes(a.status) || new Date(a.inicio).getTime() < Date.now()) return { a, oferta: null };
    const ja = new Set((a.servicos || []).map((s: any) => s.id)), regras = Array.isArray(cfg.ofertas) ? cfg.ofertas : [];
    for (const r of regras) {
      if (!r || !r.oferece || (r.apos && !ja.has(r.apos)) || ja.has(r.oferece)) continue;
      const s = porId(r.oferece); if (!s) continue;
      const extra = s.extra_sem_tempo ? 0 : Number(s.duracao) || 30;
      if (extra) { // cabe logo depois do horário, com o mesmo profissional?
        const dia = diaDe(a.inicio), lista = await disponiveis(dia, a.barber_id, Math.round((new Date(a.fim).getTime() - new Date(a.inicio).getTime()) / 60000) + extra, [], undefined, true, a.id);
        if (!lista.length || !lista[0].horarios.includes(hhmm(minDe(a.inicio)))) continue;
      }
      const de = Number(s.preco) || 0, por = r2(de * (1 - Math.max(0, Math.min(90, Number(r.desconto) || 0)) / 100));
      return { a, oferta: { id: s.id, nome: s.nome, descricao: limpo(s.descricao, 80), de, por, duracao: extra, icone: /^[a-z]{2,20}$/.test(s.icone || "") ? s.icone : urlOk(s.icone) } };
    }
    return { a, oferta: null };
  }
  async function recalcular(a: any, servicos: any[], fimMs: number) {
    const vServ = servicos.reduce((t: number, s: any) => t + (Number(s.preco) || 0), 0), vProd = (a.produtos || []).reduce((t: number, p: any) => t + (Number(p.preco) || 0) * (Number(p.qtd) || 1), 0);
    const subtotal = r2(vServ + vProd), total = r2(Math.max(0, subtotal - (Number(a.desconto) || 0) - (Number(a.credito_usado) || 0)));
    const cb = cfg.cashback || {}, pct = Math.max(0, Math.min(50, Number(cb.pct) || 0)), ganho = cb.ativo && pct > 0 && total >= (Number(cb.minimo) || 0) ? r2(total * pct / 100) : 0;
    const { error } = await db.from("ag_agendamentos").update({ servicos, fim: new Date(fimMs).toISOString(), subtotal, valor: total, cashback: ganho, atualizado_em: new Date().toISOString() }).eq("id", a.id);
    if (error) return error;
    const { data: g } = await db.from("ag_cashback").select("id").eq("agendamento_id", a.id).eq("tipo", "ganho").maybeSingle();
    if (g) await db.from("ag_cashback").update({ valor: ganho }).eq("id", g.id);
    else if (ganho > 0) await db.from("ag_cashback").insert({ company_id: empresa, cliente_id: cli.id, agendamento_id: a.id, tipo: "ganho", valor: ganho, status: "pendente", expira: Number(cb.validade) ? somaDias(diaDe(a.inicio), Number(cb.validade)) : null });
    return { total, ganho };
  }
  if (acao === "oferta") {
    const { oferta } = await ofertaDe(String(d.id || ""));
    return json({ ok: true, oferta });
  }
  if (acao === "aceitar_oferta") {
    const { a, oferta } = await ofertaDe(String(d.id || ""));
    if (!oferta || oferta.id !== d.servico) return erro("Essa oferta não está mais disponível.", 409);
    const servicos = [...(a.servicos || []), { id: oferta.id, nome: oferta.nome, duracao: oferta.duracao, preco: oferta.por, extra: true, oferta: true }];
    const r: any = await recalcular(a, servicos, new Date(a.fim).getTime() + oferta.duracao * 60000);
    if (r && r.message) return erro(/ag_sem_conflito|exclusion/i.test(r.message) ? "Não cabe mais no seu horário. Seu agendamento continua como estava." : "Não consegui adicionar agora.", 409);
    return json({ ok: true, ...r });
  }
  if (acao === "remover_oferta") {
    const { data: a } = await db.from("ag_agendamentos").select("*").eq("id", String(d.id || "")).eq("company_id", empresa).maybeSingle();
    if (!a || a.cliente_id !== cli.id || !["agendado", "confirmado"].includes(a.status)) return erro("Horário não encontrado.", 404);
    const tirar = (a.servicos || []).filter((s: any) => s.oferta), servicos = (a.servicos || []).filter((s: any) => !s.oferta);
    if (!tirar.length) return json({ ok: true });
    const r: any = await recalcular(a, servicos, new Date(a.fim).getTime() - tirar.reduce((t: number, s: any) => t + (Number(s.duracao) || 0), 0) * 60000);
    if (r && r.message) return erro("Não consegui remover agora.");
    return json({ ok: true, ...r });
  }

  if (acao === "cancelar") {
    const { data: a } = await db.from("ag_agendamentos").select("id, inicio, status, cliente_id").eq("id", String(d.id || "")).eq("company_id", empresa).maybeSingle();
    if (!a || a.cliente_id !== cli.id) return erro("Horário não encontrado.", 404);
    if (!["agendado", "confirmado"].includes(a.status)) return erro("Esse horário não pode mais ser cancelado.");
    if (new Date(a.inicio).getTime() - Date.now() < (Number(cfg.cancelar_horas) || 0) * 3600000) return erro(`Pelo app, só dá para cancelar até ${cfg.cancelar_horas} hora(s) antes. Fale com a barbearia, por favor.`);
    await db.from("ag_agendamentos").update({ status: "cancelado", atualizado_em: new Date().toISOString(), obs: "Cancelado pelo cliente no app" }).eq("id", a.id);
    return json({ ok: true });
  }

  return erro("Ação desconhecida.");
});
