// Gestão Barber IA — a agenda própria falando "a língua" da AppBarber, para a atendente IA (Sofia) e as automações do
// servidor do WhatsApp funcionarem sem API externa conectada. Só o servidor usa: X-API-Key = "<empresa>.<assinatura>",
// assinatura = HMAC-SHA256(SYNC_TOKEN, empresa) (o sync-servidor entrega a chave na configuração de cada empresa).
// Rotas (as mesmas da AppBarber que o servidor usa): GET /v1/services · /v1/professionals · /v1/availability ·
// /v1/appointments/history · /v1/establishment/clients · /v1/establishment/birthday · /v1/establishment/subscribers ·
// GET /v1/feedback (fila do pedido de feedback) · POST /v1/appointments · POST/PUT /v1/establishment/clients · PUT /v1/appointments/{código}/status · DELETE /v1/invoice/{código}
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ok = (data: unknown) => json({ data });
const falha = (result: string) => json({ data: { error: 1, result } });
const so = (t: unknown) => String(t ?? "").replace(/\D/g, "");
const fone10 = (t: unknown) => { let d = so(t); if (d.length > 11 && d.startsWith("55")) d = d.slice(2); return d; };
const chave = (t: unknown) => { const d = fone10(t); return d.length === 11 && d[2] === "9" ? d.slice(0, 2) + d.slice(3) : d; }; // compara com ou sem o 9
const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const agoraMin = () => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).split(":").map(Number); return p[0] * 60 + p[1]; };
const mins = (h: string) => { const [a, b] = String(h || "0:0").split(":").map(Number); return (a || 0) * 60 + (b || 0); };
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const minDe = (iso: string) => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso)).split(":").map(Number); return p[0] * 60 + p[1]; };
const diaDe = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
const quando = (data: string, m: number) => `${data}T${hhmm(m)}:00-03:00`;
const br = (iso: string) => iso ? `${diaDe(iso).split("-").reverse().join("/")} ${hhmm(minDe(iso))}` : ""; // DD/MM/AAAA HH:MM
const brData = (d: string | null) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "");
const STATUS: Record<string, string[]> = { "1": ["agendado", "confirmado", "chegou"], "2": ["finalizado"], "3": ["cancelado"], "4": [], "5": ["faltou"] };
const NOME_ST: Record<string, string> = { agendado: "Agendado", confirmado: "Confirmado", chegou: "No local", finalizado: "Realizado", cancelado: "Cancelado", faltou: "Ausente" };
async function hmac(chaveSecreta: string, texto: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(chaveSecreta), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(texto)))].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 40);
}
const igual = (a: string, b: string) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };

Deno.serve(async (req) => {
  const url = new URL(req.url), rota = url.pathname.replace(/^.*\/agenda-api/, "") || "/";
  const k = String(req.headers.get("x-api-key") || ""), [empresa, assin] = k.split(".");
  const segredo = Deno.env.get("SYNC_TOKEN") || "";
  if (segredo.length < 32 || !/^[0-9a-f-]{36}$/i.test(empresa || "") || !assin || !igual(assin, await hmac(segredo, empresa))) return json({ message: "Não autorizado." }, 401);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let body: any = {}; if (req.method !== "GET") { try { body = await req.json(); } catch { body = {}; } }
  const q = url.searchParams;

  const [{ data: co }, { data: cfg0 }] = await Promise.all([db.from("companies").select("name, settings").eq("id", empresa).maybeSingle(), db.from("ag_config").select("*").eq("company_id", empresa).maybeSingle()]);
  if (!co) return json({ message: "Empresa não encontrada." }, 404);
  const cfg = cfg0 || { passo: 20 }, o = (co.settings || {}).ocup || {}, padrao = { open: typeof o.open === "string" ? o.open : "09:00", close: typeof o.close === "string" ? o.close : "20:00" };
  const fech = Array.isArray(o.closed) ? o.closed.map(Number) : [0];
  const servicos = async () => (await db.from("ag_servicos").select("id, codigo, nome, duracao, preco, descricao, ativo").eq("company_id", empresa).eq("ativo", true).order("ordem")).data || [];
  const profs = async () => {
    const [{ data: ps }, { data: bs }] = await Promise.all([db.from("ag_profissionais").select("*").eq("company_id", empresa), db.from("barbers").select("id, name, active, role, ag_codigo").eq("company_id", empresa)]);
    const by = new Map((ps || []).map((p: any) => [p.barber_id, p]));
    return (bs || []).filter((b: any) => b.active !== false).map((b: any) => ({ ...(by.get(b.id) || { barber_id: b.id, ativo: !/recep/i.test(b.role || ""), servicos: [], horarios: {} }), nome: b.name, codigo: Number(b.ag_codigo) }))
      .filter((p: any) => p.ativo);
  };
  const faixasDe = (p: any, dia: string): [string, string][] => { const dow = new Date(dia + "T12:00:00Z").getUTCDay(), h = (p.horarios || {})[dow]; return Array.isArray(h) ? h : fech.includes(dow) ? [] : [[padrao.open, padrao.close]]; };
  async function ocupacao(dia: string) {
    const ini = quando(dia, 0), fim = quando(dia, 24 * 60 - 1);
    const [{ data: ags }, { data: bls }] = await Promise.all([
      db.from("ag_agendamentos").select("id, barber_id, inicio, fim").eq("company_id", empresa).lt("inicio", fim).gt("fim", ini).not("status", "in", "(cancelado,faltou)"),
      db.from("ag_bloqueios").select("barber_id, inicio, fim").eq("company_id", empresa).lt("inicio", fim).gt("fim", ini)]);
    const faixa = (x: any): [number, number] => [diaDe(x.inicio) < dia ? 0 : minDe(x.inicio), diaDe(x.fim) > dia ? 24 * 60 : minDe(x.fim)];
    return (barber: string) => [...(ags || []).filter((a: any) => a.barber_id === barber), ...(bls || []).filter((b: any) => !b.barber_id || b.barber_id === barber)].map(faixa);
  }
  const fazServico = (p: any, sid: string) => !(p.servicos || []).length || p.servicos.includes(sid);

  // ---------- leitura ----------
  if (req.method === "GET" && rota === "/v1/services") {
    return ok((await servicos()).map((s: any) => ({ service_code: Number(s.codigo), combo_code: null, service_description: s.nome, service_interval: s.duracao, service_value: Number(s.preco) || 0, service_charge_type: "Igual a", service_observation: s.descricao || "", item_type: 1 })));
  }
  if (req.method === "GET" && rota === "/v1/professionals") {
    const s = (await servicos()).find((x: any) => String(x.codigo) === q.get("service_code"));
    return ok((await profs()).filter((p: any) => !s || fazServico(p, s.id)).map((p: any) => ({ employee_code: p.codigo, employee_nickname: p.nome, employee_name: p.nome })));
  }
  if (req.method === "GET" && rota === "/v1/availability") {
    const dia = String(q.get("start_date") || "").slice(0, 10), s = (await servicos()).find((x: any) => String(x.codigo) === q.get("service_code"));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !s) return ok([]);
    const ocup = await ocupacao(dia), passo = Math.max(5, Number(cfg.passo) || 20), dur = Number(s.duracao) || 30, desde = dia === hojeSP() ? agoraMin() : dia < hojeSP() ? 24 * 60 : 0;
    return ok((await profs()).filter((p: any) => fazServico(p, s.id)).map((p: any) => {
      const oc = ocup(p.barber_id), livres: string[] = [];
      for (const [a, b] of faixasDe(p, dia)) for (let t = Math.ceil(mins(a) / passo) * passo; t + dur <= mins(b); t += passo) if (t >= desde && !oc.some(([x, y]) => t < y && t + dur > x)) livres.push(hhmm(t));
      return { employee_code: p.codigo, employee_nickname: p.nome, employee_name: p.nome, available: livres.map((h) => ({ scheduling_time: h + ":00", scheduling_value: Number(s.preco) || 0, scheduling_discount: 0 })) };
    }));
  }
  // Assinantes: os "Planos mensais vendidos" registrados nos Lançamentos (valem 30 dias a partir da venda).
  async function assinantes() {
    const desde = new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10), nomes = new Map(((co.settings || {}).planos || []).map((p: any) => [p.id, p.n]));
    const { data } = await db.from("plan_sales").select("barber_id, date, data").eq("company_id", empresa).gte("date", desde).order("date", { ascending: false }).limit(5000);
    const vistos = new Set<string>(), out: any[] = [];
    for (const r of data || []) { const f = fone10((r.data || {}).fone); if (f.length < 10 || vistos.has(chave(f))) continue; vistos.add(chave(f));
      const venc = new Date(r.date + "T12:00:00Z"); venc.setUTCDate(venc.getUTCDate() + 30);
      out.push({ fone: f, barber_id: r.barber_id, nome: String((r.data || {}).nome || ""), plano: nomes.get((r.data || {}).plano) || String((r.data || {}).plano || "Plano"), desde: r.date, ate: venc.toISOString().slice(0, 10) }); }
    return out;
  }
  if (req.method === "GET" && rota === "/v1/establishment/subscribers") {
    return ok((await assinantes()).map((x) => ({ person_cellphone: "55" + x.fone, person_name: x.nome, subscription_name: x.plano, subscription_status: "Ativo", contracting_date: brData(x.desde), due_date: brData(x.ate) })));
  }
  // Fila do pedido de feedback: comandas fechadas no dia de cliente novo na casa (sem visita finalizada nos 180 dias
  // anteriores) ou de cliente da casa atendido pela 1ª vez por esse profissional. Assinantes de plano ficam de fora.
  if (req.method === "GET" && rota === "/v1/feedback") {
    const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(q.get("date") || "")) ? String(q.get("date")) : hojeSP();
    const { data: hoje } = await db.from("ag_agendamentos").select("codigo, barber_id, cliente_id, cliente_nome, cliente_fone, pago_em, atualizado_em").eq("company_id", empresa).eq("status", "finalizado")
      .gte("inicio", quando(dia, 0)).lte("inicio", quando(dia, 24 * 60 - 1)).limit(1000);
    if (!(hoje || []).length) return ok([]);
    const ini = new Date(new Date(quando(dia, 0)).getTime() - 180 * 86400000).toISOString();
    const { data: antes } = await db.from("ag_agendamentos").select("barber_id, cliente_id, cliente_fone").eq("company_id", empresa).eq("status", "finalizado").gte("inicio", ini).lt("inicio", quando(dia, 0)).limit(20000);
    const { data: bs } = await db.from("barbers").select("id, name").eq("company_id", empresa);
    const nomeB = new Map((bs || []).map((b: any) => [b.id, String(b.name || "").split(" ")[0]])), plano = new Set((await assinantes()).map((x) => chave(x.fone)));
    const quem = (a: any) => a.cliente_id || chave(a.cliente_fone), prim = (n: string) => { const w = String(n || "").trim().split(/\s+/)[0] || ""; return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""; };
    const out: any[] = [], ja = new Set<string>();
    for (const a of hoje || []) {
      const f = fone10(a.cliente_fone), k = quem(a); if (f.length < 10 || !k || ja.has(k) || plano.has(chave(f))) continue;
      const veio = (antes || []).filter((x: any) => quem(x) === k); if (veio.some((x: any) => x.barber_id === a.barber_id)) continue;
      ja.add(k); out.push({ cod: "ag" + a.codigo, fone: f, nome: prim(a.cliente_nome), prof: nomeB.get(a.barber_id) || "", em: new Date(a.pago_em || a.atualizado_em || Date.now()).getTime(), dia, tipo: veio.length ? "novo_profissional" : "novo" });
    }
    return ok(out);
  }
  if (req.method === "GET" && rota === "/v1/appointments/history") {
    const de = String(q.get("start_date") || hojeSP()).slice(0, 10), ate = String(q.get("end_date") || de).slice(0, 10), st = STATUS[String(q.get("status_type") || "1")] || STATUS["1"];
    if (!st.length) return ok([]);
    const [{ data: ags }, ps, assin] = await Promise.all([db.from("ag_agendamentos").select("*").eq("company_id", empresa).gte("inicio", quando(de, 0)).lte("inicio", quando(ate, 24 * 60 - 1)).in("status", st).order("inicio").limit(5000), profs(), assinantes()]);
    const doPlano = new Map(assin.map((x) => [chave(x.fone), x.barber_id]));
    const servs = await servicos(), cod = new Map(servs.map((s: any) => [s.id, Number(s.codigo)])), pBy = new Map(ps.map((p: any) => [p.barber_id, p]));
    const { data: bs } = await db.from("barbers").select("id, name, ag_codigo").eq("company_id", empresa);
    const bBy = new Map((bs || []).map((b: any) => [b.id, b]));
    const linhas: any[] = [];
    for (const a of ags || []) {
      let t = new Date(a.inicio).getTime(); const b: any = pBy.get(a.barber_id) || bBy.get(a.barber_id) || {}, lista = (a.servicos || []).length ? a.servicos : [{ nome: "Atendimento", duracao: Math.round((new Date(a.fim).getTime() - t) / 60000), preco: a.valor }];
      for (const s of lista) {
        linhas.push({ appointment_code: Number(a.codigo), scheduling_code: Number(a.codigo), invoice_code: Number(a.codigo), scheduling_start: br(new Date(t).toISOString()), scheduling_end: br(new Date(t + (Number(s.duracao) || 0) * 60000).toISOString()),
          scheduling_registration_date: br(a.criado_em), scheduling_status: NOME_ST[a.status] || a.status, scheduling_observation: a.obs || (a.origem === "app" ? "Agendado pelo web app" : ""),
          client_phone: a.cliente_fone ? "55" + fone10(a.cliente_fone) : "", client_name: a.cliente_nome, employee_code: Number(b.codigo || b.ag_codigo) || null, employee_name: b.nome || b.name || "", employee_nickname: b.nome || b.name || "",
          service_code: cod.get(s.id) || null, service_description: s.nome, service_value: Number(s.preco) || 0, subscription_association: !!a.cliente_fone && doPlano.get(chave(a.cliente_fone)) === a.barber_id });
        t += (Number(s.duracao) || 0) * 60000;
      }
    }
    return ok(linhas);
  }
  const cliOut = (c: any, ult?: string) => ({ person_code: Number(c.codigo), person_name: `${c.nome} ${c.sobrenome}`.trim(), person_cellphone: c.fone ? "55" + c.fone : "", person_phone: "", person_birth_date: brData(c.nascimento), birth_date: brData(c.nascimento), last_scheduling: ult ? brData(ult) : "" });
  if (req.method === "GET" && rota === "/v1/establishment/clients") {
    const cel = so(q.get("cellphone")), nome = String(q.get("name") || "").trim(), pg = Math.max(0, Number(q.get("pages")) || 0);
    let lista: any[] = [];
    if (cel) lista = ((await db.from("ag_clientes").select("*").eq("company_id", empresa).ilike("fone", `%${fone10(cel).slice(-8)}%`).limit(20)).data || []).filter((c: any) => chave(c.fone) === chave(cel));
    else if (nome) { const w = nome.replace(/[%_,()]/g, " ").trim().split(/\s+/)[0] || ""; lista = ((await db.from("ag_clientes").select("*").eq("company_id", empresa).or(`nome.ilike.%${w}%,sobrenome.ilike.%${w}%`).limit(50)).data || []).filter((c: any) => `${c.nome} ${c.sobrenome}`.toLowerCase().includes(nome.toLowerCase().split(/\s+/).slice(-1)[0])).slice(0, 10); }
    else {
      const { count } = await db.from("ag_clientes").select("id", { count: "exact", head: true }).eq("company_id", empresa);
      lista = (await db.from("ag_clientes").select("*").eq("company_id", empresa).order("criado_em").range(pg * 200, pg * 200 + 199)).data || [];
      const ids = lista.map((c: any) => c.id), ult: Record<string, string> = {};
      for (let i = 0; i < ids.length; i += 100) { const { data } = await db.from("ag_agendamentos").select("cliente_id, inicio").in("cliente_id", ids.slice(i, i + 100)).eq("status", "finalizado").order("inicio", { ascending: false }).limit(5000);
        for (const a of data || []) if (!ult[a.cliente_id]) ult[a.cliente_id] = diaDe(a.inicio); }
      const tot = Math.max(1, Math.ceil((count || 0) / 200));
      return ok(lista.map((c: any) => ({ ...cliOut(c, ult[c.id]), total_pages: tot })));
    }
    return ok(lista.map((c: any) => cliOut(c)));
  }
  if (req.method === "GET" && rota === "/v1/establishment/birthday") {
    const hoje = hojeSP(), mes = hoje.slice(5, 7), prox = String(Number(mes) % 12 + 1).padStart(2, "0");
    const { data } = await db.from("ag_clientes").select("*").eq("company_id", empresa).not("nascimento", "is", null).limit(20000);
    return ok((data || []).filter((c: any) => [mes, prox].includes(String(c.nascimento).slice(5, 7))).map((c: any) => cliOut(c)));
  }

  // ---------- escrita ----------
  if (req.method === "POST" && rota === "/v1/establishment/clients") {
    const fone = fone10(body.person_cellphone), [nome, ...resto] = String(body.person_name || "").trim().split(/\s+/);
    if (fone.length < 10 || !nome) return falha("Informe o nome e o celular com DDD.");
    const nasc = /^\d{2}\/\d{2}\/\d{4}$/.test(String(body.person_birth_date || "")) ? String(body.person_birth_date).split("/").reverse().join("-") : /^\d{4}-\d{2}-\d{2}$/.test(String(body.person_birth_date || "")) ? body.person_birth_date : null;
    const { data: ja } = await db.from("ag_clientes").select("codigo").eq("company_id", empresa).eq("fone", fone).maybeSingle();
    if (ja) return ok({ error: 0, person_code: Number(ja.codigo) });
    const { data, error } = await db.from("ag_clientes").insert({ company_id: empresa, fone, nome: nome.slice(0, 40), sobrenome: resto.join(" ").slice(0, 60), nascimento: nasc }).select("codigo").single();
    return error ? falha("Não consegui cadastrar o cliente.") : ok({ error: 0, person_code: Number(data.codigo) });
  }
  let m = rota.match(/^\/v1\/establishment\/clients\/(\d+)$/);
  if (req.method === "PUT" && m) {
    const up: any = {}; if (body.person_name) { const [n, ...r] = String(body.person_name).trim().split(/\s+/); up.nome = n.slice(0, 40); up.sobrenome = r.join(" ").slice(0, 60); }
    if (body.person_cellphone) up.fone = fone10(body.person_cellphone);
    const nb = String(body.person_birth_date || ""); if (nb) up.nascimento = /^\d{2}\/\d{2}\/\d{4}$/.test(nb) ? nb.split("/").reverse().join("-") : /^\d{4}-\d{2}-\d{2}$/.test(nb) ? nb : null;
    const { error } = await db.from("ag_clientes").update(up).eq("company_id", empresa).eq("codigo", Number(m[1]));
    return error ? falha("Não consegui atualizar o cadastro.") : ok({ error: 0 });
  }
  if (req.method === "POST" && rota === "/v1/appointments") {
    const [dia, hora] = String(body.start_date || "").split(" "), pc = Number(((body.professionals || [])[0] || {}).professional_code), sc = (body.services || []).map((x: any) => Number(x.service_code));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia || "") || !/^\d{2}:\d{2}/.test(hora || "")) return falha("Data inválida.");
    const [ps, servs] = await Promise.all([profs(), servicos()]), p = ps.find((x: any) => x.codigo === pc), lista = sc.map((c: number) => servs.find((s: any) => Number(s.codigo) === c)).filter(Boolean);
    if (!p) return falha("Profissional não encontrado."); if (!lista.length) return falha("Serviço não encontrado.");
    const t = mins(hora), dur = (body.services || []).reduce((s: number, x: any, i: number) => s + (Number(x.duration) || Number((lista[i] || {}).duracao) || 30), 0);
    if (!faixasDe(p, dia).some(([a, b]) => t >= mins(a) && t + dur <= mins(b))) return falha("Fora da jornada do profissional.");
    if ((await ocupacao(dia))(p.barber_id).some(([x, y]) => t < y && t + dur > x)) return falha("Choque de horário com outro agendamento.");
    const fone = fone10(body.customer_phone), obs = String(body.observation || "").slice(0, 300), nome = String(body.customer_name || "").trim().slice(0, 80);
    let cli: any = null;
    if (fone.length >= 10) { cli = (await db.from("ag_clientes").select("id, nome, sobrenome").eq("company_id", empresa).eq("fone", fone).maybeSingle()).data;
      if (!cli) { const [n, ...r] = nome.split(/\s+/); cli = (await db.from("ag_clientes").insert({ company_id: empresa, fone, nome: (n || "Cliente").slice(0, 40), sobrenome: r.join(" ").slice(0, 60) }).select("id, nome, sobrenome").single()).data; } }
    const linhas = lista.map((s: any) => ({ id: s.id, nome: s.nome, duracao: s.duracao, preco: Number(s.preco) || 0 })), valor = linhas.reduce((v: number, s: any) => v + s.preco, 0);
    const { data: ag, error } = await db.from("ag_agendamentos").insert({ company_id: empresa, barber_id: p.barber_id, cliente_id: cli ? cli.id : null, cliente_nome: nome || (cli ? `${cli.nome} ${cli.sobrenome}`.trim() : "Cliente"), cliente_fone: fone,
      inicio: quando(dia, t), fim: quando(dia, t + dur), servicos: linhas, subtotal: valor, valor, origem: /totem/i.test(obs) ? "totem" : "atendente", obs }).select("codigo").single();
    if (error) return falha(/ag_sem_conflito|exclusion/i.test(error.message) ? "Choque de horário com outro agendamento." : "Não consegui marcar.");
    return ok({ error: 0, appointment_code: Number(ag.codigo), appointment_codes: [Number(ag.codigo)], invoice_code: Number(ag.codigo) });
  }
  m = rota.match(/^\/v1\/invoice\/(\d+)$/);
  if (req.method === "DELETE" && m) {
    const { data: a } = await db.from("ag_agendamentos").select("id, status, obs").eq("company_id", empresa).eq("codigo", Number(m[1])).maybeSingle();
    if (!a) return falha("Agendamento não encontrado.");
    if (!["agendado", "confirmado"].includes(a.status)) return falha("Esse horário não pode mais ser cancelado.");
    await db.from("ag_agendamentos").update({ status: "cancelado", obs: [a.obs, String(body.reason || "Cancelado pela atendente IA")].filter(Boolean).join(" · ").slice(0, 300), atualizado_em: new Date().toISOString() }).eq("id", a.id);
    return ok({ error: 0 });
  }
  m = rota.match(/^\/v1\/appointments\/(\d+)\/status$/);
  if (req.method === "PUT" && m) {
    const st = Number(body.status_type) === 3 ? "chegou" : Number(body.status_type) === 1 ? "confirmado" : null;
    if (!st) return falha("Status não aceito.");
    const { data: a } = await db.from("ag_agendamentos").select("id, status").eq("company_id", empresa).eq("codigo", Number(m[1])).maybeSingle();
    if (!a) return falha("Agendamento não encontrado.");
    if (["finalizado", "cancelado", "faltou"].includes(a.status)) return ok({ error: 0 });
    if (!(st === "confirmado" && a.status === "chegou")) await db.from("ag_agendamentos").update({ status: st, atualizado_em: new Date().toISOString() }).eq("id", a.id);
    return ok({ error: 0 });
  }
  return json({ message: "Rota não encontrada." }, 404);
});
