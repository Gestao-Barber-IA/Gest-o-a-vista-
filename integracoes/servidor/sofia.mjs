// Gestão Barber IA — Sofia, a atendente de IA no WhatsApp dos clientes.
// Roda dentro do whatsapp.mjs (papel "clientes"). Nos dias e horários escolhidos no app (Integração › Atendente IA),
// responde quem mandar mensagem no WhatsApp da barbearia e marca, remarca ou cancela horários direto na AppBarber.
//  • Usa o Claude (Anthropic) com ferramentas que consultam a AppBarber: nunca inventa preço nem horário.
//  • Só marca, remarca ou cancela depois que o cliente confirma os detalhes.
//  • Se alguém da recepção responder a conversa pelo celular, a Sofia para naquela conversa (1 hora, por padrão).
//    Ela guarda o que a recepção e o cliente escreveram nesse meio-tempo e, quando volta, continua de onde pararam.
//  • Reclamação, assunto delicado ou dúvida que ela não sabe: chama a recepção e deixa a conversa como não lida.
// Chave da Anthropic: ANTHROPIC_API_KEY em /etc/gbia-sync.env (no servidor: gbia-sofia-chave). Nunca vai para o app.
// As conversas ficam só na memória do servidor e são esquecidas depois de algumas horas.
// Relatório semanal (domingo à noite): o servidor guarda por 30 dias um registro curto das conversas (telefone só com os
// 4 últimos dígitos); a IA lê as que deram problema e sugere regras novas, que o dono aprova no app.

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const SOFIA_VERSAO = "7.4";
export const MODELO_PADRAO = "claude-sonnet-5-5";
const MODELOS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"];
// Preço por milhão de tokens (US$): entrada, saída, leitura do cache, gravação do cache (1,25× a entrada).
const PRECO = { "claude-opus-5-5": [4, 20, 0.2, 5], "claude-sonnet-5-5": [2, 10, 0.1, 2.5], "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125] };
const SDK_VERSAO = "1.4.0";
const AB = "https://api.appbarber.com";
const UA = "GestaoBarberIA-Sync/2.8";
const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

const so = (t) => String(t || "").replace(/\D/g, "");
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
// Telefone para comparar: DDD + 8 últimos dígitos (ignora o 55 e o 9 extra).
export const chaveFone = (f) => { let d = so(f); if (d.length > 11 && d.startsWith("55")) d = d.slice(2); d = d.replace(/^0+/, ""); if (d.length === 11) d = d.slice(0, 2) + d.slice(3); return d.slice(-10); };
// Celular com DDI 55 (aceita "55 019 9…", "(19) 9…", "019…").
export const normFone = (t) => { let d = so(t); if (d.startsWith("55") && d.length >= 12) d = d.slice(2); d = d.replace(/^0+/, ""); return d.length >= 10 && d.length <= 11 ? "55" + d : so(t); };
const agoraSP = () => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()); const [h, m] = p.split(":").map(Number); return h * 60 + m; };
const diaSemanaSP = () => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(new Date()));
const hojeSP = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const mins = (t) => { const [h, m] = String(t || "0:0").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const somaDias = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Janelas padrão: segunda o dia todo (folga da recepção); nos outros dias 7h–9h, almoço da recepção
// (terça e quarta 12h–14h; quinta a sábado 13h–15h20) e 20h–22h; domingo 7h–9h e 20h–22h.
const CEDO = ["07:00", "09:00"], NOITE = ["20:00", "22:00"];
export const JANELAS_PADRAO = { 0: [CEDO, NOITE], 1: [["00:00", "23:59"]], 2: [CEDO, ["12:00", "14:00"], NOITE], 3: [CEDO, ["12:00", "14:00"], NOITE], 4: [CEDO, ["13:00", "15:20"], NOITE], 5: [CEDO, ["13:00", "15:20"], NOITE], 6: [CEDO, ["13:00", "15:20"], NOITE] };
// Resposta curta de confirmação/agradecimento (ex.: 👍, "ok", "obrigado", "confirmado"), que não pede resposta.
export function soConfirmacao(t) {
  const s = String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[!.,;:~\s]+/g, " ").trim();
  if (!s) return false;
  if (/^[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0f\s]+$/u.test(s)) return true; // só emoji (👍 🙏 😊)
  return /^(ok+|okay|oks|blz|beleza|obrigad[oa]s?( (viu|mesmo|demais))?|obg|brigad[oa]|valeu|vlw|show|top|perfeito|combinado|confirmad[oa]|certo|ta bom|ta otimo|fechado|joia|jo?ia|ciente|entendi|tudo certo|pode deixar|beleza obrigad[oa]|ok obrigad[oa]|ok valeu|estarei ai|to indo|ja estou indo|ate (mais|logo|ja))( [\p{Extended_Pictographic}\ufe0f]+)*$/u.test(s);
}
// Várias mensagens que, juntas, são só cumprimento + confirmação (ex.: "Boa tarde" e "Confirmado"; "oi, ok obrigado").
const SAUDACAO = /^(oi+|ola+|opa|salve|e ai|bom dia|boa tarde|boa noite|tudo bem|tudo bom|td bem|blz|boa)( [\p{Extended_Pictographic}\ufe0f]+)*$/u;
export function soCumprimentoEConfirmacao(lista) {
  const partes = lista.join("\n").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[\n,.!;?]+/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!partes.length) return false;
  let conf = false;
  for (const p of partes) { if (soConfirmacao(p)) conf = true; else if (!SAUDACAO.test(p)) return false; }
  return conf;
}
// Silêncio da noite: das 22h às 7h a Sofia não manda mensagem (as que chegarem ficam para as 7h).
export const SILENCIO = { de: 22 * 60, ate: 7 * 60 };
export const noSilencio = (agora = agoraSP(), folga = 0) => agora >= SILENCIO.de + folga || agora < SILENCIO.ate;
// Barbearia fechada agora (antes de abrir, depois de fechar ou dia fechado): ninguém da recepção está atendendo.
export function barbeariaFechada(h, dia = diaSemanaSP(), agora = agoraSP()) {
  if (!h || !h.abertura || !h.fechamento) return noSilencio(agora);
  return (h.fechados || []).map(Number).includes(dia) || agora < mins(h.abertura) || agora >= mins(h.fechamento);
}
export function dentroDaJanela(janelas, dia = diaSemanaSP(), agora = agoraSP()) {
  const lista = (janelas && janelas[dia]) || [];
  return lista.some(([a, b]) => agora >= mins(a) && agora <= mins(b));
}

// Requisição à AppBarber com os cabeçalhos exatos e sempre pelo IPv4 (o IP liberado).
async function abReq(metodo, url, chave, corpo) {
  const u = new URL(url), mod = await import("node:https");
  const dados = corpo ? JSON.stringify(corpo) : null;
  const headers = { "X-API-Key": chave, Accept: "application/json", "User-Agent": UA };
  if (dados) { headers["Content-Type"] = "application/json"; headers["Content-Length"] = Buffer.byteLength(dados); }
  return new Promise((ok, fail) => {
    const req = mod.request(u, { method: metodo, headers, family: 4 }, (res) => {
      let b = ""; res.setEncoding("utf8"); res.on("data", (c) => (b += c));
      res.on("end", () => ok({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: b }));
    });
    req.on("error", fail); req.setTimeout(45000, () => req.destroy(new Error("a AppBarber não respondeu em 45 segundos.")));
    if (dados) req.write(dados);
    req.end();
  });
}
const msgErro = (t) => { try { const j = JSON.parse(t); const d = j.data || {}; return String(d.result || j.message || j.erro || j.error || "").slice(0, 200); } catch { return String(t || "").replace(/\s+/g, " ").slice(0, 160); } };

// ---------- ferramentas da AppBarber ----------
export function ferramentasAppBarber({ cfg, creditos = () => {}, req = abReq }) {
  const est = String(cfg.codigo_estabelecimento), chave = cfg.appbarber_api_key, filial = cfg.codigo_filial ? String(cfg.codigo_filial) : "";
  const cache = new Map();
  const memo = async (k, ms, fn) => { const c = cache.get(k); if (c && Date.now() - c.em < ms) return c.v; const v = await fn(); cache.set(k, { em: Date.now(), v }); return v; };
  async function chamar(metodo, caminho, corpo) {
    const url = `${AB}${caminho}${metodo === "GET" ? `${caminho.includes("?") ? "&" : "?"}establishment_code=${encodeURIComponent(est)}` : ""}`;
    const r = await req(metodo, url, chave, corpo);
    if (r.ok) creditos(1, false); else if (/saldo insuficiente/i.test(r.text)) creditos(0, true);
    if (!r.ok) throw new Error(`AppBarber respondeu ${r.status}${msgErro(r.text) ? ": " + msgErro(r.text) : ""}`);
    try { return JSON.parse(r.text); } catch { return {}; }
  }
  const servicos = () => memo("servicos", 6 * 3600000, async () => ((await chamar("GET", "/v1/services")).data || [])
    .map((s) => ({ codigo: s.service_code, combo: s.combo_code || null, nome: String(s.service_description || "").trim(), minutos: Number(s.service_interval) || 30, preco: s.service_value, cobranca: s.service_charge_type || "Igual a", obs: s.service_observation || "", tipo: Number(s.item_type) || 1 }))
    .filter((s) => s.nome));
  const profissionais = (servico) => memo("prof:" + servico, 6 * 3600000, async () => ((await chamar("GET", `/v1/professionals?service_code=${encodeURIComponent(servico)}`)).data || [])
    .map((p) => ({ codigo: p.employee_code, nome: String(p.employee_nickname || p.employee_name || "").trim() })));
  const horarios = (data, servico) => memo(`disp:${data}:${servico}`, 90000, async () => ((await chamar("GET", `/v1/availability?start_date=${data}&service_code=${encodeURIComponent(servico)}`)).data || [])
    .map((p) => { const lista = (p.available || p.avaliable || []).filter((h) => h.scheduling_time);
      // Valor de cada horário (a AppBarber já aplica as promoções do dia, ex.: desconto de segunda a quarta).
      const precos = {}; for (const h of lista) precos[String(h.scheduling_time).slice(0, 5)] = [h.scheduling_value, h.scheduling_discount];
      return { codigo: p.employee_code, nome: String(p.employee_nickname || p.employee_name || "").trim(), completo: String(p.employee_name || p.employee_nickname || "").trim(), horarios: Object.keys(precos), precos }; }));
  // Assinantes (planos mensais) da barbearia, guardado por 6 horas (1 crédito).
  const assinantes = () => memo("assinantes", 6 * 3600000, async () => ((await chamar("GET", "/v1/establishment/subscribers")).data || [])
    .map((x) => ({ k: chaveFone(x.person_cellphone), plano: String(x.subscription_name || "").trim(), situacao: String(x.subscription_status || "").trim(), contratacao: String(x.contracting_date || ""), vencimento: String(x.due_date || "") }))
    .filter((x) => x.k));
  const assinantesTodos = () => assinantes();
  async function assinaturaDe(fone) {
    const k = chaveFone(fone); if (!k) return null;
    return (await assinantes()).find((x) => x.k === k && !/cancel|encerr|inativ/i.test(x.situacao)) || null;
  }
  // Agendamentos futuros deste telefone (de hoje até 30 dias).
  async function agendamentosDe(fone) {
    const hoje = hojeSP(), k = chaveFone(fone);
    const q = new URLSearchParams({ start_date: hoje, end_date: somaDias(hoje, 30), status_type: "1" }); if (filial) q.set("branch_code", filial);
    const lista = (await chamar("GET", "/v1/appointments/history?" + q)).data || [];
    return lista.filter((a) => chaveFone(a.client_phone) === k && (!a.scheduling_status || /agendad|confirmad/i.test(a.scheduling_status))).map((a) => {
      const m = String(a.scheduling_start || "").match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
      return { codigo: Number(a.appointment_code || a.scheduling_code), comanda: Number(a.invoice_code) || null, quando: m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}` : a.scheduling_start, profissional: String(a.employee_name || "").trim(), servico: String(a.service_description || "").trim(), nome: String(a.client_name || "").trim(), plano: !!a.subscription_association, confirmado: /confirmad/i.test(String(a.scheduling_status || "")) };
    }).sort((a, b) => String(a.quando).localeCompare(String(b.quando)));
  }
  // Último atendimento realizado deste telefone (procura nos últimos 3 meses, de 31 em 31 dias; 1 crédito por busca).
  async function ultimoDe(fone) {
    const k = chaveFone(fone); let fim = hojeSP();
    for (let i = 0; i < 3; i++) {
      const ini = somaDias(fim, -30), q = new URLSearchParams({ start_date: ini, end_date: fim, status_type: "2" }); if (filial) q.set("branch_code", filial);
      const lista = ((await chamar("GET", "/v1/appointments/history?" + q)).data || []).filter((a) => chaveFone(a.client_phone) === k).map((a) => {
        const m = String(a.scheduling_start || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        return { quando: m ? `${m[3]}-${m[2]}-${m[1]}` : "", profissional: String(a.employee_name || "").trim(), servico: String(a.service_description || "").trim() };
      }).filter((a) => a.quando && a.profissional).sort((a, b) => b.quando.localeCompare(a.quando));
      if (lista.length) return lista[0];
      fim = somaDias(ini, -1);
    }
    return null;
  }
  // Cadastro do cliente pelo celular: { codigo, nome, nascimento } ou null.
  const cliOut = (c) => ({ codigo: Number(c.person_code) || null, nome: String(c.person_name || "").trim(), nascimento: String(c.person_birth_date || "").trim(), celular: so(c.person_cellphone || c.person_phone) });
  const listaCli = (d) => (Array.isArray(d) ? d : (d && (d.items || d.clients)) || []);
  // Procura pelo celular; se não achar, tenta sem o 9 (cadastros antigos com 8 dígitos).
  async function clienteDe(fone) {
    const cel = so(fone).replace(/^55(?=\d{10,11}$)/, ""), tentativas = [cel];
    if (cel.length === 11 && cel[2] === "9") tentativas.push(cel.slice(0, 2) + cel.slice(3));
    for (const t of tentativas) {
      const c = listaCli((await chamar("GET", `/v1/establishment/clients?cellphone=${t}`)).data).find((x) => chaveFone(x.person_cellphone || x.person_phone) === chaveFone(fone));
      if (c) return cliOut(c);
    }
    return null;
  }
  // Busca de cadastro por outro celular ou pelo nome (cliente diz que já tem cadastro).
  async function buscarClientes({ celular, nome }) {
    if (celular) { const c = await clienteDe(celular); return c ? [c] : []; }
    if (!nome) return [];
    return listaCli((await chamar("GET", `/v1/establishment/clients?name=${encodeURIComponent(nome)}`)).data).slice(0, 5).map(cliOut);
  }
  const nomeDe = async (fone) => ((await clienteDe(fone)) || {}).nome || "";
  // Cadastro novo (nome, celular do WhatsApp e, se o cliente quiser, data de nascimento) ou só a data num cadastro que não tinha.
  async function salvarCliente({ codigo, fone, nome, nascimento, origem = "WhatsApp (Sofia, atendente IA)" }) {
    const cel = so(fone).replace(/^55(?=\d{10,11}$)/, "");
    const corpo = codigo ? { establishment: Number(est), ...(nascimento ? { person_birth_date: nascimento } : {}), ...(nome ? { person_name: nome } : {}), ...(arguments[0].novoCelular ? { person_cellphone: cel } : {}) }
      : { establishment: Number(est), person_name: nome, person_cellphone: cel, person_dial_code: "+55", person_signup_origin: origem, ...(nascimento ? { person_birth_date: nascimento } : {}) };
    const envia = async (c) => (await chamar(codigo ? "PUT" : "POST", codigo ? `/v1/establishment/clients/${encodeURIComponent(codigo)}` : "/v1/establishment/clients", c)).data || {};
    let r;
    // A documentação pede a data como AAAA-MM-DD, mas a AppBarber devolve datas como DD/MM/AAAA: se recusar, tenta o outro formato.
    const outra = nascimento && /^\d{4}-\d{2}-\d{2}$/.test(nascimento) ? nascimento.split("-").reverse().join("/") : null;
    try { r = await envia(corpo); if (Number(r.error) > 0 && outra) throw new Error(r.result || "recusado"); }
    catch (e) { if (!outra) throw e; r = await envia({ ...corpo, person_birth_date: outra }); }
    if (Number(r.error) > 0) throw new Error(r.result || "a AppBarber não aceitou o cadastro");
    return { codigo: codigo || Number(r.person_code) || null };
  }
  // Um serviço por vez, em sequência (ex.: Navalhado 17h, Detox 17h40), com o mesmo profissional. Mandar os serviços
  // juntos faz a AppBarber tentar todos no mesmo horário e dar "Choque de Horário". Se um falhar, desfaz os anteriores.
  async function criar({ fone, nome, servicos: lista, profissional, quando, obs }) {
    const [dia, hora] = String(quando).split(" "), feitos = [];
    let ini = mins(hora);
    try {
      for (const s of lista) {
        const hhmm = `${String(Math.floor(ini / 60)).padStart(2, "0")}:${String(ini % 60).padStart(2, "0")}`;
        const corpo = { customer_phone: Number(so(fone).length <= 11 ? "55" + so(fone) : so(fone)), customer_name: nome, establishment_code: Number(est), start_date: `${dia} ${hhmm}`,
          professionals: [{ professional_code: Number(profissional) }], services: [{ service_code: Number(s.codigo), item_type: s.tipo === 2 ? 2 : 1, duration: Number(s.minutos) || 30 }], observation: obs || "Agendado pela Sofia (atendente IA) no WhatsApp" };
        let r;
        try { r = (await chamar("POST", "/v1/appointments", corpo)).data || {}; }
        catch (e) { throw new Error(/choque|jornada|conflito|indispon/i.test(e.message) ? `CHOQUE: ${s.nome} às ${hhmm} não cabe (choque com outro agendamento ou fim do expediente do profissional)` : e.message); }
        if (Number(r.error) > 0) throw new Error(/choque|jornada|conflito|indispon/i.test(String(r.result)) ? `CHOQUE: ${s.nome} às ${hhmm} não cabe (choque com outro agendamento ou fim do expediente do profissional)` : (r.result || "a AppBarber não aceitou o agendamento"));
        feitos.push({ codigos: r.appointment_codes || [r.appointment_code].filter(Boolean), comanda: r.invoice_code || null });
        ini += Number(s.minutos) || 30;
      }
    } catch (e) {
      // Desfaz o que já tinha sido marcado, para não deixar meio agendamento.
      for (const f of feitos) if (f.comanda) await cancelarComanda(f.comanda, fone).catch(() => {});
      throw e;
    } finally { cache.forEach((_, k) => { if (k.startsWith("disp:")) cache.delete(k); }); }
    return { codigos: feitos.flatMap((f) => f.codigos), comanda: (feitos[0] || {}).comanda || null, comandas: feitos.map((f) => f.comanda).filter(Boolean) };
  }
  async function cancelarComanda(comanda, fone) {
    const r = (await chamar("DELETE", `/v1/invoice/${encodeURIComponent(comanda)}`, { customer_phone: so(fone).replace(/^55(?=\d{10,11}$)/, ""), establishment_code: Number(est), reason: "Cancelado pelo cliente no WhatsApp (Sofia, atendente IA)" })).data || {};
    if (Number(r.error) > 0) throw new Error(r.result || "a AppBarber não aceitou o cancelamento");
    cache.forEach((_, k) => { if (k.startsWith("disp:")) cache.delete(k); });
    return true;
  }
  // Linhas da agenda num período (até 31 dias; 1 crédito). status "1" = agendado, "2" = realizado.
  async function agenda(ini, fim, st) { const q = new URLSearchParams({ start_date: ini, end_date: fim, status_type: st }); if (filial) q.set("branch_code", filial); return (await chamar("GET", "/v1/appointments/history?" + q)).data || []; }
  // Marca o cliente como "No local" (chegou na barbearia) no agendamento.
  async function noLocal(codigo) {
    const r = (await chamar("PUT", `/v1/appointments/${encodeURIComponent(codigo)}/status`, { establishment_code: Number(est), status_type: 3 })).data || {};
    if (Number(r.error) > 0) throw new Error(r.result || "a AppBarber não aceitou o check-in");
    return true;
  }
  // Marca o agendamento como "Confirmado" (a AppBarber alterna: só chame para quem ainda não está confirmado).
  async function confirmar(codigo) {
    const r = (await chamar("PUT", `/v1/appointments/${encodeURIComponent(codigo)}/status`, { establishment_code: Number(est), status_type: 1 })).data || {};
    if (Number(r.error) > 0) throw new Error(r.result || "a AppBarber não aceitou a confirmação");
    return true;
  }
  return { servicos, profissionais, horarios, assinaturaDe, assinantesTodos, agendamentosDe, ultimoDe, buscarClientes, nomeDe, clienteDe, salvarCliente, criar, cancelarComanda, agenda, noLocal, confirmar };
}

// ---------- o que a Sofia pode fazer (ferramentas para o Claude) ----------
const obj = (props, req) => ({ type: "object", properties: props, required: req, additionalProperties: false });
export const TOOLS = [
  { name: "ver_servicos", description: "Lista os serviços da barbearia com código, nome, duração em minutos e preço de TABELA (cobranca 'A partir de' = preço mínimo). Em alguns dias pode haver promoção: o valor de um dia específico vem em ver_horarios.", strict: true, input_schema: obj({}, []) },
  { name: "ver_horarios", description: "Horários livres de um dia para um serviço, por profissional, com o VALOR DAQUELE DIA (já com promoções/descontos do dia). Use o código do serviço de ver_servicos. Para mais de um serviço juntos (ex.: corte + barba), consulte pelo primeiro serviço e confira que há tempo seguido para os dois.", strict: true,
    input_schema: obj({ data: { type: "string", description: "Dia no formato AAAA-MM-DD" }, servico: { type: "integer", description: "Código do serviço" }, profissional: { type: ["string", "null"], description: "Nome do profissional que o cliente pediu, ou null para todos" } }, ["data", "servico", "profissional"]) },
  { name: "salvar_cadastro", description: "Cadastra o cliente na barbearia (quando a linha [Cadastro…] diz que não tem cadastro) ou acrescenta a data de nascimento num cadastro que não tem. Use depois que o cliente informou nome e sobrenome; a data de nascimento é opcional (só se ele quiser informar).", strict: true,
    input_schema: obj({ nome_completo: { type: ["string", "null"], description: "Nome e sobrenome (obrigatório para cadastro novo; null se o cliente já tem cadastro)" }, nascimento: { type: ["string", "null"], description: "Data de nascimento AAAA-MM-DD, ou null se o cliente não quis informar" }, celular: { type: ["string", "null"], description: "Celular com DDD, só se o WhatsApp do cliente estiver desconhecido; senão null" } }, ["nome_completo", "nascimento", "celular"]) },
  { name: "ultimo_atendimento", description: "Último atendimento realizado do cliente nos últimos 3 meses (dia, barbeiro e serviço), pelo WhatsApp dele. Use quando um cliente cadastrado quer agendar e não disse com quem: assim você oferece o mesmo barbeiro(a) da última vez.", strict: true, input_schema: obj({}, []) },
  { name: "buscar_cadastro", description: "Procura o cadastro de um cliente que diz que JÁ TEM cadastro mas não foi encontrado pelo WhatsApp: pelo celular que ele usou no cadastro (com DDD) ou pelo nome completo. Devolve as opções com o final do telefone, para o cliente confirmar qual é o dele.", strict: true,
    input_schema: obj({ celular: { type: ["string", "null"], description: "Celular informado pelo cliente, com DDD, ou null" }, nome: { type: ["string", "null"], description: "Nome completo, ou null" } }, ["celular", "nome"]) },
  { name: "vincular_cadastro", description: "Usa o cadastro encontrado em buscar_cadastro, depois que o cliente confirmou que é o dele (pelo final do telefone). Se o cliente permitir, atualiza o celular do cadastro para este WhatsApp (assim ele é reconhecido nas próximas vezes).", strict: true,
    input_schema: obj({ opcao: { type: "integer", description: "Número da opção de buscar_cadastro (1, 2…)" }, atualizar_celular: { type: "boolean", description: "true se o cliente permitiu trocar o celular do cadastro para este WhatsApp" } }, ["opcao", "atualizar_celular"]) },
  { name: "consultar_cliente", description: "Nome do cliente cadastrado na barbearia (pelo telefone do WhatsApp) e os horários que ele já tem marcados nos próximos 30 dias, com o código de cada um. Use antes de remarcar ou cancelar, e para chamar o cliente pelo nome.", strict: true, input_schema: obj({}, []) },
  { name: "agendar", description: "Marca o horário na AppBarber. Use quando o cliente confirmou com clareza o serviço, o profissional, o dia e a hora: um 'sim'/'pode marcar' ao resumo, ou a escolha de um dos horários que você ofereceu (com serviço e profissional já definidos). Também serve para marcar só o adicional aceito depois, no fim do serviço já marcado.", strict: true,
    input_schema: obj({ servicos: { type: "array", items: { type: "integer" }, description: "Códigos dos serviços, na ordem" }, profissional: { type: "integer", description: "Código do profissional (de ver_horarios)" }, data_hora: { type: "string", description: "AAAA-MM-DD HH:MM" }, nome_cliente: { type: "string", description: "Nome completo do cliente" }, observacao: { type: ["string", "null"], description: "Recado curto para o barbeiro(a), ex.: Primeira vez na barbearia; ou null" } }, ["servicos", "profissional", "data_hora", "nome_cliente", "observacao"]) },
  { name: "remarcar", description: "Troca um horário já marcado por outro: marca o novo e depois cancela o antigo. SÓ use depois que o cliente confirmou o novo horário.", strict: true,
    input_schema: obj({ codigo_agendamento: { type: "integer", description: "Código do horário atual (de consultar_cliente)" }, servicos: { type: "array", items: { type: "integer" } }, profissional: { type: "integer" }, data_hora: { type: "string", description: "AAAA-MM-DD HH:MM" } }, ["codigo_agendamento", "servicos", "profissional", "data_hora"]) },
  { name: "lembrar", description: "Guarda na memória do cliente uma preferência ou informação útil para os PRÓXIMOS atendimentos, que ele contou (ex.: prefere horários depois das 18h; leva o filho junto; gosta do degradê mais baixo; vai viajar em dezembro). Uma frase curta por vez. NUNCA guarde saúde, religião, política, dinheiro, documentos ou senhas, nem o que já está no de sempre.", strict: true,
    input_schema: obj({ nota: { type: "string", description: "Frase curta (até 120 caracteres), em terceira pessoa" } }, ["nota"]) },
  { name: "esquecer", description: "Apaga TODA a memória guardada deste cliente. Use quando ele pedir para esquecer ou apagar os dados dele.", strict: true, input_schema: obj({}, []) },
  { name: "confirmar_presenca", description: "Marca como CONFIRMADO na agenda o(s) horário(s) do cliente, quando ele responde a confirmação de presença dizendo que vem (sim, confirmo, 👍, estarei aí). Use os códigos da mensagem de confirmação ou de consultar_cliente.", strict: true,
    input_schema: obj({ codigos: { type: "array", items: { type: "integer" }, description: "Códigos dos horários a confirmar" } }, ["codigos"]) },
  { name: "cancelar", description: "Cancela um horário marcado do cliente. SÓ use depois que o cliente confirmou que quer cancelar aquele horário.", strict: true,
    input_schema: obj({ codigo_agendamento: { type: "integer", description: "Código do horário (de consultar_cliente)" } }, ["codigo_agendamento"]) },
  { name: "enviar_arte", description: "Envia ao cliente, no WhatsApp, uma das artes (imagens) da barbearia listadas nas instruções, como a tabela de planos. Use quando a situação da arte acontecer (ex.: cliente perguntou de planos). Depois de enviar, termine sua resposta com a pergunta indicada no resultado.", strict: true,
    input_schema: obj({ arte: { type: "string", description: "Nome exato da arte, como aparece na lista de artes" } }, ["arte"]) },
  { name: "parabenizar_profissional", description: "Manda para o WhatsApp do profissional os parabéns pelo elogio que o cliente fez ao atendimento dele (resposta a um pedido de feedback). Use uma vez, só quando o cliente elogiar.", strict: true,
    input_schema: obj({ profissional: { type: "string", description: "Nome do profissional que atendeu" }, elogio: { type: "string", description: "As palavras do cliente sobre o atendimento, como ele escreveu" } }, ["profissional", "elogio"]) },
  { name: "avisar_equipe", description: "Manda um recado para a equipe (WhatsApp de avisos) SEM sair da conversa. Use para avisos que a equipe precisa saber na hora, principalmente atraso de cliente com horário hoje (ex.: 'Francis vai atrasar uns 15 min por causa da chuva (horário 15h com o Well)').", strict: true,
    input_schema: obj({ recado: { type: "string", description: "Recado curto e completo: quem, o quê e o horário" }, profissional: { type: ["string", "null"], description: "Nome do barbeiro(a) do horário (de consultar_cliente) para avisá-lo também, ex. no atraso; ou null" } }, ["recado", "profissional"]) },
  { name: "lista_de_espera", description: "Coloca o cliente na lista de espera para um dia e uma faixa de horário (ou tira dela). Use quando ele quer um dia/horário específico que está cheio e NÃO pode em outro dia ou horário, depois de oferecer e ele aceitar. Se abrir uma vaga nessa faixa, ele recebe uma mensagem no WhatsApp perguntando se quer agendar.", strict: true,
    input_schema: obj({ acao: { type: "string", enum: ["entrar", "sair"] }, data: { type: "string", description: "AAAA-MM-DD" }, servicos: { type: "array", items: { type: "integer" }, description: "Códigos dos serviços (de ver_servicos)" }, profissional: { type: ["string", "null"], description: "Nome do barbeiro(a) se o cliente só quer com ele, ou null para qualquer um" }, de: { type: "string", description: "Início da faixa de horário que serve, HH:MM" }, ate: { type: "string", description: "Fim da faixa de horário que serve, HH:MM" } }, ["acao", "data", "servicos", "profissional", "de", "ate"]) },
  { name: "chamar_recepcao", description: "Passa a conversa para a recepção (uma pessoa). Use para reclamação, cliente irritado, pedido de desconto, pagamento, assunto pessoal ou delicado, pedido que as outras ferramentas não resolvem, erro da AppBarber, ou quando o cliente pedir para falar com alguém. Depois disso a Sofia não responde mais esta conversa.", strict: true,
    input_schema: obj({ motivo: { type: "string", description: "Resumo curto do que o cliente precisa" } }, ["motivo"]) },
];

// "de segunda a sábado, das 09:00 às 20:00 (fechado: domingo)", a partir de Configurações › Ocupação do app.
export function textoHorario(h) {
  if (!h || !h.abertura || !h.fechamento) return "";
  const nomes = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"], fech = (h.fechados || []).map(Number);
  const abertos = [1, 2, 3, 4, 5, 6, 0].filter((d) => !fech.includes(d));
  const seguidos = abertos.length > 1 && abertos.every((d, i) => i === 0 || d === (abertos[i - 1] + 1) % 7);
  const dias = abertos.length === 7 ? "todos os dias" : seguidos ? `de ${nomes[abertos[0]]} a ${nomes[abertos.at(-1)]}` : abertos.map((d) => nomes[d]).join(", ");
  return `${dias}, das ${h.abertura} às ${h.fechamento}${fech.length ? ` (fechado: ${fech.map((d) => nomes[d]).join(", ")})` : ""}`;
}

export function promptSistema({ nome, barbearia, notas, brand, artes = [], horario = null, upsell = [], equipe = [], aniversario = "" }) {
  const casa = brand === "salao" ? "salão" : "barbearia", hor = textoHorario(horario);
  return `Você é ${nome}, atendente da ${barbearia} (${casa}) no WhatsApp. Você conversa com clientes para tirar dúvidas e marcar, remarcar ou cancelar horários direto no sistema de agenda (AppBarber), usando as ferramentas.

Jeito de falar:
- Simpática, carismática e acolhedora, como a melhor recepcionista da casa. Português do Brasil, natural e leve.
- Mensagens curtas, como no WhatsApp: 1 a 3 frases. Pode usar emoji com moderação (1 ou 2 por mensagem) 😊 Não liste todos os barbeiros nem todos os horários: escolha os 2 ou 3 mais próximos do que o cliente pediu.
- Se o cliente falar de algo que não está no histórico desta conversa (ex.: "deu certo?", "e aí, marcou?"), não diga que não sabe do que se trata: use consultar_cliente e responda com base nos horários dele (ex.: se não houver horário marcado, peça desculpas e retome o agendamento).
- Nunca fale das suas limitações ("não consigo ver", "não tenho acesso", "por aqui não aparece"). Se precisar de uma informação, simplesmente pergunte ao cliente com naturalidade (ex.: "Lembra com qual barbeiro ele cortou da última vez? 😊").
- Cumprimento: se o cliente perguntar como você está ("tudo bem?", "como vai?"), responda e pergunte de volta antes de seguir, como uma pessoa faria (ex.: "Bom dia, Pedro! Tudo bem sim, e com você? 😊"). Se ele só disser "bom dia", responda o bom dia. Faça isso na mesma mensagem em que já ajuda com o pedido, sem esperar a resposta dele.
- Nomes de barbeiro podem estar escritos diferente no histórico e na agenda de hoje (cadastro antigo, apelido, nome completo). Mesmo sobrenome e primeiro nome parecido é a mesma pessoa (ex.: Izaque Macedo e Izaquias Macedo). Não diga ao cliente que pode ser outro barbeiro por causa disso.
- Erros de digitação: clientes escrevem rápido e o corretor do celular troca palavras. Entenda pelo contexto, como uma recepcionista experiente: "Caleb e barba", "cabeli e barba", "cabelo barba" = corte e barba; "cabelo" = corte; "barva" = barba; "sombrancelha" = sobrancelha; "pesinho"/"pezim" = pezinho; "navalado" = navalhado; "amanha"/"amnh" = amanhã; "sabado" = sábado. Antes de tratar uma palavra como nome de barbeiro, confira se ele existe${equipe.length ? ` (barbeiros da equipe: ${equipe.join(", ")}; na agenda pode aparecer apelido)` : " (ver_horarios mostra quem atende)"}; se não existir e a palavra parecer um serviço escrito errado, entenda como o serviço. Se ficar em dúvida de verdade, confirme de leve, sem corrigir o cliente: "Corte e barba, certo? 😊". Nunca repita o erro dele como se fosse um nome.
- Chame o cliente pelo primeiro nome quando souber. Não se apresente como robô nem fale de "sistema", "ferramenta" ou "IA", a não ser que perguntem; se perguntarem, diga com naturalidade que é a assistente virtual da ${barbearia}.
- Sem listas longas nem markdown (nada de **negrito** ou #). Ao oferecer horários, sugira 2 ou 3 opções próximas do que o cliente pediu.
- Memória: quando a mensagem trouxer "O de sempre deste cliente" ou "Memória do cliente", use para atender como quem já conhece o cliente (proponha o de sempre, lembre das preferências), sem soar invasiva e sem listar o que você sabe. Quando o cliente contar algo útil para os próximos atendimentos, use lembrar (sem avisar). Se ele pedir para apagar os dados dele, use esquecer.
- Ofertas depois de marcar: o adicional (Oferta no final) vem SEMPRE na mensagem que confirma o horário, mesmo para quem pediu "o de sempre" (só não ofereça o que ele já vai fazer). Se também houver dica de Venda de plano, ofereça o plano só depois, numa próxima mensagem (quando o cliente responder sobre o adicional), nunca as duas ofertas juntas.
- Brincadeira: se o cliente brincar (risadas, 🤣, "me passa o pix que é presente de aniversário", "aniversariante não tem desconto?"), entre na brincadeira com leveza, numa frase curta, e volte ao agendamento na mesma mensagem. Brincadeira não é pedido sério: nunca chame a recepção por causa dela.
- Pagamento (Pix, cartão, dinheiro): é feito na barbearia, no dia do atendimento, a não ser que as Informações da casa digam outra coisa. Pergunta de pagamento no meio de um agendamento não é motivo para chamar a recepção: responda isso e continue. Nunca deixe um agendamento pela metade para chamar a recepção quando o assunto não impede marcar; termine o agendamento primeiro.
- Nome para o cadastro: peça só depois que o cliente escolher o horário, numa mensagem só para isso (nunca junto com outra pergunta).
- UMA pergunta por mensagem (nunca "você tem preferência de barbeiro E qual horário?", nem "qual dia E qual serviço?"). Mande UMA mensagem por vez de resposta: não mande duas respostas seguidas para o mesmo pedido. Para agendar, siga esta ordem e pule o que o cliente já disse: 1) qual serviço; 2) preferência de barbeiro(a); 3) dia e período (manhã, tarde ou noite); 4) ofereça 2 ou 3 horários; 5) quando ele escolher, marque na hora e confirme${upsell.length ? ", já oferecendo o adicional na mesma mensagem (veja Oferta no final)" : ""}. Se o cliente responder só parte, siga com o que já sabe e pergunte só o que falta, sem repetir a pergunta inteira.
- Antes de consultar ver_horarios, não diga que tem horário ("tem sim"): diga que vai verificar.
- Barbeiro sem horário livre no dia pedido: diga que a agenda dele está completa nesse dia (ex.: "A agenda do Lucas está completa hoje, todos os horários já foram reservados 😊"); nunca diga que ele não está disponível, não está na agenda ou não trabalha. Ofereça, nessa ordem: o próximo dia com horário dele (proximo_dia_com_horario), outro barbeiro no mesmo dia, ou a lista de espera.
- Ao falar de horário, diga sempre com quem: ex. "17h com o Igor ou 17h20 com o Izaquias". Nunca solte um horário sem o barbeiro(a).

Regras (muito importantes):
- Nunca invente preço, serviço, profissional ou horário: tudo vem das ferramentas.
- Para explicar como é um serviço, use só o que está nas Informações da casa ou na observação do serviço (ver_servicos). Se não tiver, diga que o barbeiro(a) explica certinho no atendimento ou pergunte à recepção; não descreva por conta própria.
- Preço: o valor que ver_horarios traz para o profissional naquele dia é o CERTO e vale sobre qualquer tabela: ele já tem a promoção do dia e o preço próprio de cada profissional (ex.: o dono ou um barbeiro sênior pode cobrar mais). Sempre que for falar o preço de um horário, use esse valor. As tabelas das Informações da casa servem para responder preço antes de consultar a agenda e para explicar a promoção dos dias; se o valor de ver_horarios for diferente da tabela para um profissional, vale o de ver_horarios. Promoção: destaque 🎉 só na primeira vez que falar de preço e de novo ao confirmar o horário marcado; nas outras mensagens, não repita. Só fale da promoção/economia de outros dias para um profissional se ele atender nesses dias com o valor menor (confira em ver_horarios); se o profissional tem preço próprio ou não atende nos dias da promoção, não fale da promoção para ele (pode oferecer outro profissional nos dias promocionais, se o cliente quiser economizar). Se perguntarem o preço sem dizer o dia nem o profissional, informe o valor de hoje pela tabela (se for dia promocional, diga que hoje está em promoção). Se não souber o valor, diga que vai verificar com a recepção (chamar_recepcao).
- Agendar: quando o cliente ESCOLHE um dos horários que você ofereceu (ex.: "pode ser às 19h"), com o serviço e o profissional já definidos, isso já é a confirmação: marque NA HORA com agendar, sem resumo nem nova pergunta antes. Se ainda faltar algo (serviço, profissional, dia ou hora) ou houver dúvida, mande um resumo e espere o "sim". Nunca deixe um horário escolhido sem marcar esperando outra resposta.
- Remarcar ou cancelar: mande um resumo (qual horário, e o novo, se for remarcar) e espere o cliente confirmar antes de usar a ferramenta.
- Confirmação uma vez só: se a sua pergunta já tinha serviço, profissional, dia e hora (ex.: "Corte + Barba com o Izaquias hoje às 11h40, por R$ 95. Posso marcar?") e o cliente disse sim, marque direto; não peça para confirmar de novo.
- Não repita na mensagem seguinte uma pergunta ou pedido que você acabou de fazer (ex.: pedir a data de nascimento duas vezes).
- Na primeira mensagem de cada conversa vem a linha [Cadastro: …] dizendo se o cliente já é cadastrado (pelo WhatsApp dele).
  • Cadastrado: chame pelo primeiro nome e não peça dados de novo.
  • Não comece a conversa pedindo nome ou dados: cumprimente e pergunte como pode ajudar. Os dados só são pedidos quando for agendar.
  • Se a linha disser que não tem cadastro, mas o cliente disser que JÁ TEM ("já tenho", "já sou cliente", "já cortei aí"), nunca faça cadastro novo antes de procurar: pergunte o celular que ele usou no cadastro (ou o nome completo) e use buscar_cadastro. Achando, confirme pelo final do telefone, pergunte se pode atualizar o cadastro para este WhatsApp e use vincular_cadastro. Só se não achar mesmo, faça o cadastro novo.
  • Sem cadastro (cliente novo): dê boas-vindas e, antes de marcar, faça o cadastro, uma pergunta por vez: 1) nome e sobrenome; 2) data de nascimento, explicando que é para ele receber promoções exclusivas no aniversário 🎉 (se não quiser informar, tudo bem, siga sem). O celular é o próprio WhatsApp: não pergunte, a não ser que a linha diga que é desconhecido. Depois use salvar_cadastro.
  • Cadastrado sem data de nascimento: depois de resolver o que ele pediu, pergunte uma vez a data de nascimento, para as promoções de aniversário, e salve com salvar_cadastro.
- Agendamento para outra pessoa (ex.: filho, irmão): marque no nome do cliente que está falando (o titular do WhatsApp/cadastro) e escreva na observação para quem é, com idade se souber (ex.: "Corte do Brian, 3 anos (filho)").
- Use a observação do agendamento para o que ajuda o barbeiro(a): se for a primeira vez do cliente na barbearia, escreva "Primeira vez na barbearia"; inclua também pedidos importantes do cliente (ex.: "quer manter o comprimento em cima").
- Quando o cliente quiser um serviço e NÃO disser com quem: se ele é cadastrado, use ultimo_atendimento; se houver, ofereça o mesmo barbeiro(a) (ex.: "Quer marcar com o Well de novo, como da última vez? 😊"). Se não houver, ou se for cliente novo, pergunte se tem preferência de barbeiro(a) (ex.: "Você tem preferência de barbeiro(a)? 😊"). Se ele já disse o nome, não pergunte. Se ele não tiver preferência ("tanto faz", "qualquer um", "quem tiver"), consulte ver_horarios sem profissional: a lista já vem na ordem de preferência da barbearia (campo ordem). Ofereça os horários do 1º da lista que sirvam para o dia e período que o cliente pediu; só passe para o 2º, 3º… se o anterior não tiver horário que sirva. Não explique ao cliente o motivo da escolha.
- Lista de espera: se o cliente quer um dia e horário específicos que estão cheios e diz que não pode em outro dia ou horário, ofereça colocar na lista de espera daquele dia/faixa (com o barbeiro dele, se ele fizer questão). Se ele aceitar, use lista_de_espera. Quando a lista avisa de uma vaga, a mensagem aparece no contexto: se o cliente quiser, confira o horário (ver_horarios) e siga o resumo normal para agendar.
- Depois de cancelar um horário, nunca termine com uma afirmação ("quando quiser, é só chamar"): termine sempre perguntando "Para quando você gostaria de reagendar, [primeiro nome]?".
- Remarcar ou cancelar: só horários do próprio cliente (consultar_cliente). Confirme qual horário antes.
- Planos mensais (assinantes): o cliente do plano é atendido pelo profissional fixo do plano. Horário do plano (do_plano em consultar_cliente) só pode ser remarcado para a MESMA semana (segunda a domingo), nos dias que o plano permite e com o MESMO profissional; nunca troque o profissional do plano nem diga que trocar "não tem problema". Se o cliente pedir outro profissional, ou se não houver horário com o dele na semana, explique a regra com gentileza e use chamar_recepcao. Se ele contar que o horário do plano já foi trocado para outro profissional ou para outra semana, não confirme como certo: explique a regra e use chamar_recepcao para a equipe conferir.
- Adiantar ou atrasar: se o cliente já tem horário e quer adiantar/atrasar (mesmo profissional, mesmo dia), use consultar_cliente e depois ver_horarios: o horário dele ocupa a agenda, então confira também livres_trocando_o_horario_do_cliente (horários que só ficam livres trocando o dele). Ofereça esses e, se ele aceitar, use remarcar.
- Nunca diga que o cliente tem ou não tem horário marcado sem antes usar consultar_cliente nesta conversa. Se o cliente falar do horário dele, de chegada, de atraso ou de "vou mais tarde", use consultar_cliente antes de responder.
- Atraso: se o cliente avisar que vai atrasar para um horário de hoje, confirme o horário dele (consultar_cliente), tranquilize-o e use avisar_equipe na hora com nome, quanto vai atrasar e o horário, passando o barbeiro(a) em profissional (ele recebe o aviso no WhatsApp dele). Se o atraso for grande ou ele quiser outro horário, ofereça remarcar.
- Depois de marcar, confirme de forma calorosa com dia, hora e profissional.
- Áudio: chega para você já transcrito, marcado como [áudio do cliente, transcrito]; responda normalmente, como se ele tivesse escrito (não comente que era áudio). Se vier só "[o cliente mandou um(a) áudio]" sem texto, ou se a transcrição não fizer sentido, peça com carinho para ele escrever ou mandar de novo.
- Foto ou figurinha: você não consegue ver; peça com carinho para o cliente escrever.
- Reclamação, cliente irritado, desconto, pagamento, assunto delicado, algo fora de agenda/serviços/preços, ou se o cliente pedir uma pessoa: use chamar_recepcao e avise que a equipe já vai responder.
- Se uma ferramenta der erro, não tente adivinhar: peça desculpas e use chamar_recepcao. Exceção: se o erro for de horário (não cabe, choque, não está livre), explique com naturalidade e ofereça outros horários ou outro profissional, sem chamar a recepção.
- Não fale de outros clientes nem mostre códigos internos.
- Cada mensagem do cliente começa com [Agora: …], com o dia e a hora atuais e o WhatsApp do cliente. Use para saber "hoje", "amanhã" e que horários já passaram; não comente essa linha com o cliente.
${hor ? `- Horário de funcionamento da ${casa}: ${hor}. Você responde o WhatsApp também fora desse horário (ex.: cedo e à noite), mas só existem atendimentos dentro dele. Mensagens que chegam de madrugada você responde a partir das 7h. Se o cliente pedir um horário antes da abertura ou depois do fechamento, ou num dia fechado, explique com simpatia o horário de atendimento e ofereça os primeiros horários livres depois da abertura (ou no próximo dia aberto). Se ele quiser "agora" com a ${casa} fechada, diga a que horas abrimos.
` : ""}- Às vezes a mensagem do cliente vem junto com o que foi conversado sem você (com a recepção ou mensagens automáticas da barbearia, como lembretes). Leia com atenção e continue de onde pararam: respeite o que a recepção combinou, não repita o que ela já disse e não se reapresente.
${upsell.length ? `\nOferta no final (upsell): primeiro MARQUE o horário que o cliente escolheu (agendar); a oferta nunca segura o agendamento. Na mensagem que confirma o horário marcado, ofereça UMA vez, numa frase leve e animada, o adicional que mais combina com o que ele vai fazer (só um), por exemplo: "Prontinho, Pedro! Quarta às 19h com o Igor está marcado ✅ Aproveita e adiciona uma hidratação no cabelo e na barba por apenas R$ 50? 😉". Opções:\n${upsell.map((o) => `- ${o.texto}${o.valor ? ` por apenas R$ ${String(o.valor).replace(".", ",")}` : ""} (${o.semTempo ? "vai na comanda, sem tempo extra na agenda" : `na agenda: ${o.servicos}`})${regraTexto(o.quando) ? `: ${regraTexto(o.quando)}` : ""}`).join("\n")}\nAdicionais marcados "vai na comanda": NÃO marque nada na agenda (não ocupam tempo); se ele aceitar, use avisar_equipe com o profissional do horário, ex.: "Incluir na comanda de <cliente> (<dia> <hora>): <adicional> por R$ <valor>", e confirme ao cliente que já está incluído, no mesmo horário. Não ofereça o que ele já vai fazer. Nos outros adicionais, se ele aceitar, use agendar de novo só com o(s) serviço(s) do adicional, com o mesmo profissional, começando no horário em que termina o serviço já marcado (horário marcado + duração do serviço, de ver_servicos), e coloque na observação "Adicional: <oferta> por R$ <valor>". Se ele recusar ou não comentar, siga sem insistir (o horário dele já está garantido). Se o adicional não couber logo depois ou o profissional não fizer esse serviço (o agendar dá erro), avise com naturalidade que o horário principal continua marcado e que o adicional pode ser combinado na barbearia.\n` : ""}${aniversario ? `\nAniversário: no dia do aniversário do cliente a barbearia manda esta mensagem; o que ela promete vale (use se o cliente falar de aniversário, sem prometer mais nada): «${String(aniversario).replace(/\{[^}]+\}/g, "").replace(/\s+/g, " ").trim().slice(0, 600)}»\n` : ""}${notas ? `\nInformações da ${casa} (passadas pelo dono, use quando ajudar):\n${notas}\n` : ""}${artes.length ? `\nArtes que você pode enviar com enviar_arte (envie a arte em vez de digitar a tabela inteira; depois explique só o que o cliente perguntar):\n${artes.map((a) => `- "${a.nome}": enviar quando ${a.quando || "o assunto da arte aparecer"}`).join("\n")}\n` : ""}`;
}

// ---------- a conversa ----------
const custo = (modelo, u) => { const p = PRECO[modelo] || PRECO[MODELO_PADRAO]; return ((u.input_tokens || 0) * p[0] + (u.output_tokens || 0) * p[1] + (u.cache_read_input_tokens || 0) * p[2] + (u.cache_creation_input_tokens || 0) * p[3]) / 1e6; };

const primeiroNome = (n) => { const w = String(n || "").trim().split(/\s+/)[0] || ""; return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""; };
// Tira o ", " sobrando quando o nome do cliente não é conhecido (ex.: "…plano, ? 😊" → "…plano? 😊").
const limpaNome = (t) => String(t).replace(/,\s*(?=[?!.])/g, "").replace(/\s{2,}/g, " ").replace(/\s+([?!.,])/g, "$1").trim();
const reais = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : "R$ " + Number(v).toFixed(2).replace(".", ","));
// Horários livres com o valor do dia, agrupados por preço (ex.: { "R$ 40,00": ["09:00", …] }).
function precosDoDia(p) {
  const grupos = {};
  for (const h of p.horarios.slice(0, 40)) {
    const [v, desc] = (p.precos || {})[h] || [], k = (reais(v) || "valor de tabela") + (Number(desc) > 0 ? ` (a agenda informa desconto de ${reais(desc)})` : "");
    (grupos[k] = grupos[k] || []).push(h);
  }
  const ks = Object.keys(grupos);
  return ks.length === 1 ? { valor_no_dia: ks[0], livres: grupos[ks[0]] } : { livres_por_valor: grupos };
}

// Executa uma ferramenta pedida pelo Claude. `simular` = não grava nada na AppBarber (teste no terminal).
// ---------- adiantar/atrasar o próprio horário ----------
// O horário do próprio cliente ocupa a agenda: para o mesmo profissional, no mesmo dia, a AppBarber não mostra os
// horários que "encostam" nele (ex.: tem 10h40; barba e pezinho de 1 h às 10h20 bateria no dele). Aqui calcula os
// horários que ficam livres se o horário dele for trocado.
const primeiroDe = (n) => semAcentoP(n).split(" ")[0];
function semAcentoP(t) { return String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim(); }
// Mesmo profissional com nome escrito diferente (cadastro antigo × atual, apelido): igual, mesmo primeiro nome,
// ou mesmo sobrenome com o primeiro nome começando igual (ex.: "Izaque Macedo" e "Izaquias Macedo").
const ultimoDe_ = (n) => { const p = semAcentoP(n).replace(/\(.*?\)/g, "").trim().split(" "); return p.length > 1 ? p[p.length - 1] : ""; };
const mesmoNome = (a, b) => { if (!a || !b) return false; const A = semAcentoP(a), B = semAcentoP(b); if (A === B || primeiroDe(a) === primeiroDe(b)) return true;
  const sa = ultimoDe_(a), sb = ultimoDe_(b), pa = primeiroDe(a), pb = primeiroDe(b);
  return !!sa && sa === sb && pa.slice(0, 4) === pb.slice(0, 4) && Math.min(pa.length, pb.length) >= 4; };
// Nome do profissional como está na agenda hoje (procura nos profissionais dos serviços mais comuns).
async function nomeNaAgendaAtual(ab, nome) {
  const servs = (await ab.servicos()).filter((x) => x.tipo === 1).slice(0, 6);
  for (const sv of servs) { const p = (await ab.profissionais(sv.codigo).catch(() => [])).find((x) => mesmoNome(x.nome, nome)); if (p) return p.nome; }
  return null;
}
const hhmmM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
// Blocos do cliente no dia: horários seguidos com o mesmo profissional viram um bloco [ini, fim).
async function blocosDoCliente(ab, agenda, data) {
  const todos = await ab.servicos(), dur = (nome) => (todos.find((x) => semAcentoP(x.nome) === semAcentoP(nome)) || {}).minutos || 30;
  const meus = (agenda || []).filter((a) => String(a.quando).startsWith(data)).map((a) => ({ ...a, ini: mins(String(a.quando).slice(11, 16)), min: dur(a.servico) })).sort((x, y) => x.ini - y.ini);
  const blocos = [];
  for (const a of meus) { const b = blocos.find((x) => mesmoNome(x.profissional, a.profissional) && Math.abs(x.fim - a.ini) <= 5); if (b) { b.fim = Math.max(b.fim, a.ini + a.min); b.itens.push(a); } else blocos.push({ profissional: a.profissional, ini: a.ini, fim: a.ini + a.min, itens: [a] }); }
  return blocos;
}
// Horários em que cabe um serviço de `duracao` minutos com o profissional, contando o bloco do cliente como livre.
async function livresSemOBloco(ab, data, bloco, duracao) {
  const todos = (await ab.servicos()).filter((x) => x.tipo === 1).sort((a, b) => a.minutos - b.minutos);
  for (const curto of todos.slice(0, 3)) {
    const p = (await ab.horarios(data, curto.codigo).catch(() => [])).find((x) => mesmoNome(x.completo || x.nome, bloco.profissional) || mesmoNome(x.nome, bloco.profissional));
    if (!p) continue;
    const livre = (t0, t1) => { for (let t = t0; t < t1; t += 5) { if (t >= bloco.ini && t < bloco.fim) continue; if (!p.horarios.some((h) => t >= mins(h) && t < mins(h) + curto.minutos)) return false; } return true; };
    const cands = [...new Set([...p.horarios.map(mins), bloco.ini, ...[1, 2, 3].map((k) => bloco.ini - k * 20)])].filter((t) => t >= 0).sort((a, b) => a - b);
    return { profissional: p, horarios: cands.filter((t) => t !== bloco.ini && livre(t, t + duracao)).map(hhmmM) };
  }
  return null;
}
export async function executar(nomeTool, input, ctx) {
  const { ab, conv, simular } = ctx, fone = ctx.fone || (conv && conv.fone) || "";
  const servicosPorCodigo = async (cods) => { const todos = await ab.servicos(); return cods.map((c) => todos.find((s) => Number(s.codigo) === Number(c))).filter(Boolean); };
  // Confere o horário na AppBarber antes de marcar (mais seguro que confiar no que foi dito na conversa).
  const confere = async (servs, profissional, dataHora) => {
    const [dia, hora] = String(dataHora).split(" ");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia || "") || !/^\d{2}:\d{2}$/.test(hora || "")) return "data_hora precisa ser AAAA-MM-DD HH:MM";
    if (dia < hojeSP() || (dia === hojeSP() && mins(hora) < agoraSP() + 10)) return "esse horário já passou ou está em cima da hora";
    const lista = await ab.horarios(dia, servs[0].codigo), p = lista.find((x) => Number(x.codigo) === Number(profissional));
    if (!p) return "esse profissional não atende esse serviço nesse dia";
    if (!p.horarios.includes(hora)) return `esse horário não está mais livre; livres com ${p.nome}: ${p.horarios.slice(0, 12).join(", ") || "nenhum"}`;
    return "";
  };
  switch (nomeTool) {
    case "ver_servicos": {
      const s = await ab.servicos();
      return s.map((x) => ({ codigo: x.codigo, nome: x.nome, minutos: x.minutos, preco: `${x.cobranca === "A partir de" ? "a partir de " : ""}R$ ${String(x.preco).replace(".", ",")}`, ...(x.obs ? { obs: x.obs } : {}) }));
    }
    case "ver_horarios": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.data || "")) return { erro: "data precisa ser AAAA-MM-DD" };
      if (input.data < hojeSP()) return { erro: "essa data já passou" };
      let lista = await ab.horarios(input.data, input.servico);
      if (input.data === hojeSP()) lista = lista.map((p) => ({ ...p, horarios: p.horarios.filter((h) => mins(h) >= agoraSP() + 15) }));
      // O nome pedido pode ser o do cadastro no sistema ("Izaque Macedo") e a agenda ter outro ("Izaquias Macedo"):
      // compara também pelo nome completo da equipe com o mesmo primeiro nome.
      const pedido = String(input.profissional || "").trim(), daEquipe = (ctx.equipe || []).filter((e) => primeiroDe(e) === primeiroDe(pedido));
      const bate = (nome, completo) => { const q = pedido.toLowerCase(), n = String(nome || "").toLowerCase(); if (!q) return false;
        return n.includes(q) || q.includes(n.split(" ")[0]) || [nome, completo].some((x) => x && (mesmoNome(x, pedido) || daEquipe.some((e) => mesmoNome(x, e)))); };
      if (input.profissional) {
        const f = lista.filter((p) => bate(p.nome, p.completo) && p.horarios.length);
        if (f.length) lista = f;
        else {
          // Ele faz esse serviço? Então está com a agenda completa nesse dia: procura o próximo dia com horário dele (até 6 dias).
          const faz = (await ab.profissionais(input.servico).catch(() => [])).some((p) => bate(p.nome, p.completo)) || lista.some((p) => bate(p.nome, p.completo));
          if (!faz) return { aviso: `${input.profissional} não faz esse serviço (ou não foi encontrado)`, outros_com_horario: lista.filter((p) => p.horarios.length).map((p) => p.nome) };
          let proximo = null;
          for (let i = 1; i <= 6 && !proximo; i++) {
            const dd = new Date(input.data + "T12:00:00Z"); dd.setUTCDate(dd.getUTCDate() + i); const iso = dd.toISOString().slice(0, 10);
            const p = (await ab.horarios(iso, input.servico).catch(() => [])).find((x) => bate(x.nome, x.completo) && x.horarios.length);
            if (p) proximo = { dia: `${DIAS[dd.getUTCDay()]}, ${iso.split("-").reverse().join("/")}`, data: iso, primeiros: p.horarios.slice(0, 4), valor_com_ele_nesse_dia: reais(((p.precos || {})[p.horarios[0]] || [])[0]) || "confira com ver_horarios" };
          }
          // Nenhum horário nos próximos dias e fora da equipe cadastrada no sistema: saiu da equipe (a AppBarber pode
          // continuar listando). Não é "agenda completa".
          const equipe = ctx.equipe || [];
          if (!proximo && equipe.length && !equipe.some((n) => mesmoNome(n, input.profissional) || semAcentoP(n).includes(semAcentoP(input.profissional)))) {
            return { nao_atende_mais: true, profissional: input.profissional, nota: `${input.profissional} não está atendendo na barbearia no momento (não está na equipe atual nem tem horários nos próximos dias). Diga isso com naturalidade e gentileza, sem falar em agenda completa nem lista de espera com ele, e ofereça outro barbeiro.`, outros_com_horario_nesse_dia: lista.filter((p) => p.horarios.length).map((p) => p.nome) };
          }
          return { agenda_completa: true, profissional: input.profissional, nota: `A agenda de ${input.profissional} está completa nesse dia (todos os horários já foram reservados). Diga isso com essas palavras, de forma profissional; nunca diga que ele não está disponível, não está na agenda ou não trabalha.`, proximo_dia_com_horario: proximo, outros_com_horario_nesse_dia: lista.filter((p) => p.horarios.length).map((p) => p.nome) };
        }
      }
      // Sem preferência de profissional: primeiro quem tem menos atendimentos marcados no dia; empate → maior fidelização.
      let ordenado = false;
      if (!input.profissional && ctx.carga && lista.filter((p) => p.horarios.length).length > 1) {
        try {
          const carga = await ctx.carga(input.data), fid = (n) => { const v = ctx.fidelizacao ? ctx.fidelizacao(n) : null; return Number.isFinite(v) ? v : -1; };
          const qtd = (n) => { let t = 0; for (const [k, v] of carga) if (mesmoNome(k, n)) t += v; return t; };
          lista = lista.map((p) => ({ p, q: qtd(p.nome), f: fid(p.nome) })).sort((a, b) => (!a.p.horarios.length - !b.p.horarios.length) || (a.q - b.q) || (b.f - a.f)).map((x) => x.p);
          ordenado = true;
        } catch (e) { if (ctx.registro) ctx.registro("não consegui ver a carga do dia: " + e.message); }
      }
      const d = new Date(input.data + "T12:00:00Z");
      const out = { dia: `${DIAS[d.getUTCDay()]}, ${input.data.split("-").reverse().join("/")}`, profissionais: lista.map((p, i) => ({ ...(ordenado && p.horarios.length ? { ordem: i + 1 } : {}), codigo: p.codigo, nome: p.nome, ...precosDoDia(p) })) };
      if (ordenado) out.nota_ordem = "Lista na ordem de preferência da barbearia para cliente sem preferência de profissional: ofereça primeiro os horários do ordem 1 que sirvam para o que o cliente pediu; só vá para o próximo se não houver. Não comente o motivo da ordem.";
      // O cliente já tem horário nesse dia (consultar_cliente): mostra também o que fica livre trocando o horário dele.
      if (conv.agenda && conv.agenda.some((a) => String(a.quando).startsWith(input.data))) {
        const serv = (await ab.servicos()).find((x) => Number(x.codigo) === Number(input.servico)), extra = [];
        for (const b of await blocosDoCliente(ab, conv.agenda, input.data)) {
          if (input.profissional && !mesmoNome(b.profissional, input.profissional)) continue;
          const l = await livresSemOBloco(ab, input.data, b, (serv && serv.minutos) || 30).catch(() => null);
          const ja = new Set(((lista.find((p) => l && p.codigo === l.profissional.codigo) || {}).horarios) || []);
          const novos = l ? l.horarios.filter((h) => !ja.has(h) && (input.data > hojeSP() || mins(h) >= agoraSP() + 15)) : [];
          if (novos.length) extra.push({ profissional: l.profissional.nome, codigo: l.profissional.codigo, horario_atual_do_cliente: hhmmM(b.ini), horarios: novos });
        }
        if (extra.length) { out.livres_trocando_o_horario_do_cliente = extra; out.nota_troca = "Estes horários só ficam livres se o horário atual do cliente for trocado (use remarcar com o código do horário dele). Se ele quer adiantar ou atrasar o próprio horário, ofereça estes."; }
      }
      return out;
    }
    case "buscar_cadastro": {
      const lista = await ab.buscarClientes({ celular: input.celular ? normFone(input.celular) : null, nome: input.nome ? String(input.nome).trim() : null });
      conv.candidatos = lista;
      if (!lista.length) return { encontrados: 0, nota: "não encontrado: confira o número/nome com o cliente; se mesmo assim não achar, faça o cadastro novo" };
      return { encontrados: lista.length, opcoes: lista.map((c, i) => ({ opcao: i + 1, nome: c.nome, telefone_final: c.celular ? c.celular.slice(-4) : "sem celular" })), nota: "confirme com o cliente pelo final do telefone (não mostre o número inteiro)" };
    }
    case "vincular_cadastro": {
      const c = (conv.candidatos || [])[Number(input.opcao) - 1];
      if (!c) return { erro: "opção inválida; use buscar_cadastro" };
      if (input.atualizar_celular && fone && c.codigo && !simular) await ab.salvarCliente({ codigo: c.codigo, fone, novoCelular: true });
      conv.cadastro = c; conv.nome = c.nome; ctx.registro(`usou o cadastro de ${c.nome.split(" ")[0]}${input.atualizar_celular ? " e atualizou o celular" : ""}`);
      return { ok: true, nome: c.nome, aniversario_cadastrado: !!c.nascimento, celular_atualizado: !!input.atualizar_celular };
    }
    case "salvar_cadastro": {
      let cel = fone;
      if (!cel && input.celular) { cel = normFone(input.celular); if (chaveFone(cel).length < 10) return { erro: "celular inválido; peça com DDD" }; conv.fone = cel; }
      if (!cel) return { erro: "preciso do celular com DDD do cliente" };
      let nasc = input.nascimento ? String(input.nascimento).trim() : "";
      const m = nasc.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (m) nasc = `${m[3]}-${m[2]}-${m[1]}`;
      if (nasc && (!/^\d{4}-\d{2}-\d{2}$/.test(nasc) || isNaN(new Date(nasc + "T12:00:00Z")) || nasc > hojeSP() || nasc < "1910-01-01")) return { erro: "data de nascimento inválida; confirme dia, mês e ano" };
      const cad = conv.cadastro || null;
      if (cad && cad.codigo) {
        if (!nasc) return { ok: true, nota: "o cliente já tem cadastro; nada para mudar" };
        if (!simular) await ab.salvarCliente({ codigo: cad.codigo, fone: cel, nascimento: nasc });
        cad.nascimento = nasc; ctx.registro("acrescentou a data de nascimento no cadastro");
        return { ok: true, nota: "data de nascimento salva no cadastro" };
      }
      const nome = String(input.nome_completo || "").replace(/\s+/g, " ").trim();
      if (nome.split(" ").length < 2) return { erro: "preciso do nome e sobrenome do cliente" };
      const r = simular ? { codigo: null } : await ab.salvarCliente({ fone: cel, nome, nascimento: nasc });
      conv.cadastro = { codigo: r.codigo, nome, nascimento: nasc }; conv.nome = nome; ctx.registro(`cadastrou ${nome.split(" ")[0]}${nasc ? " com aniversário" : ""}`);
      return { ok: true, nota: simular ? "cadastro simulado (teste)" : "cliente cadastrado na barbearia" };
    }
    case "ultimo_atendimento": {
      if (!fone) return { aviso: "telefone do cliente desconhecido" };
      if (conv.ultimo === undefined) conv.ultimo = await ab.ultimoDe(fone);
      const u = conv.ultimo;
      if (!u) return { ultimo: null, nota: "sem atendimento nos últimos 3 meses: pergunte a preferência de barbeiro(a)" };
      // O histórico pode ter o nome antigo do cadastro (ex.: "Izaque Macedo") e a agenda de hoje outro ("Izaquias Macedo").
      if (u.atual === undefined) u.atual = await nomeNaAgendaAtual(ab, u.profissional).catch(() => null);
      return { ultimo: { dia: u.quando.split("-").reverse().join("/"), barbeiro: u.profissional, ...(u.atual && semAcentoP(u.atual) !== semAcentoP(u.profissional) ? { mesmo_barbeiro_na_agenda_de_hoje: u.atual, nota: `é a mesma pessoa: na agenda de hoje o nome está como ${u.atual}; use esse nome com o cliente` } : {}), servico: u.servico } };
    }
    case "consultar_cliente": {
      if (!fone) return { aviso: "telefone do cliente desconhecido: peça o número de celular com DDD" };
      const [nome, ag] = await Promise.all([conv.cadastro ? conv.cadastro.nome : ab.nomeDe(fone).catch(() => ""), ab.agendamentosDe(fone)]);
      conv.agenda = ag; if (nome) conv.nome = nome;
      return { nome: nome || (ag[0] && ag[0].nome) || null, cadastrado: !!nome, horarios_marcados: ag.map((a) => ({ codigo: a.codigo, quando: a.quando, servico: a.servico, profissional: a.profissional, ...(a.plano ? { do_plano: true } : {}) })),
        ...(ag.some((a) => a.plano) ? { nota_plano: "Horários com do_plano são do plano mensal: só podem ser remarcados com o MESMO profissional, na MESMA semana (segunda a domingo) e nos dias que o plano permite (veja as Informações da casa)." } : {}) };
    }
    case "agendar": {
      if (!fone) return { erro: "telefone do cliente desconhecido" };
      const servs = await servicosPorCodigo(input.servicos || []);
      if (!servs.length) return { erro: "serviço não encontrado; use ver_servicos" };
      const prob = await confere(servs, input.profissional, input.data_hora); if (prob) return { erro: prob };
      // Marcou em cima da hora (até 20 min antes): avisa o profissional.
      const [diaA, horaA] = String(input.data_hora).split(" "), emCima = diaA === hojeSP() && mins(horaA) - agoraSP() <= 20;
      const nomeProf = emCima ? (((await ab.horarios(diaA, servs[0].codigo)).find((x) => Number(x.codigo) === Number(input.profissional))) || {}).completo || "" : "";
      if (simular) { ctx.stats.agendados++; if (emCima) ctx.registro(`avisaria ${nomeProf} do novo cliente às ${horaA}`); return { ok: true, simulado: true }; }
      const obs = [String(input.observacao || "").trim().slice(0, 300), "Agendado pela Sofia (atendente IA) no WhatsApp"].filter(Boolean).join(" · ");
      const valor = await valorAgendamento(ab, servs, input.profissional, diaA, horaA);
      let r;
      try { r = await ab.criar({ fone, nome: input.nome_cliente, servicos: servs, profissional: input.profissional, quando: input.data_hora, obs }); }
      catch (e) { if (/^CHOQUE:/.test(e.message)) return { erro: e.message.replace(/^CHOQUE: /, "") + ". Não chame a recepção: ofereça outro horário com tempo seguido para todos os serviços, ou outro profissional." }; throw e; }
      ctx.stats.agendados++; ctx.registro(`agendou ${servs.map((s) => s.nome).join(" + ")} em ${input.data_hora}`);
      if (ctx.evento) { const prof = ((await ab.horarios(diaA, servs[0].codigo).catch(() => [])).find((x) => Number(x.codigo) === Number(input.profissional)) || {}).nome || "";
        const adicional = /adicional/i.test(String(input.observacao || ""));
        ctx.evento({ tipo: adicional && conv.jaAgendou ? "adicional" : "agendamento", valor, ref: `ag:${[...(r.codigos || [])].map(Number).sort((x, y) => x - y).join(",")}`, dados: { data: diaA, hora: horaA, profissional: prof, servicos: servs.map((s) => s.nome).join(" + "), codigos: r.codigos || [] } });
        conv.jaAgendou = true; }
      if (ctx.listaEspera) ctx.listaEspera({ sair: true, data: diaA });
      if (emCima && ctx.avisarProfissional) await ctx.avisarProfissional(nomeProf, `✂️ Novo cliente hoje às ${horaA.replace(":", "h")}: ${input.nome_cliente} (${servs.map((s) => s.nome).join(" + ")})${input.observacao ? ` · ${String(input.observacao).slice(0, 150)}` : ""}`);
      return { ok: true, codigos: r.codigos };
    }
    case "remarcar": {
      if (!fone) return { erro: "telefone do cliente desconhecido" };
      const ag = conv.agenda || await ab.agendamentosDe(fone), velho = ag.find((a) => a.codigo === Number(input.codigo_agendamento));
      if (!velho) return { erro: "esse horário não é deste cliente; use consultar_cliente" };
      const servs = await servicosPorCodigo(input.servicos || []);
      if (!servs.length) return { erro: "serviço não encontrado; use ver_servicos" };
      // Horário do plano mensal: só com o mesmo profissional e na mesma semana (segunda a domingo).
      if (velho.plano) {
        const diaV = String(velho.quando).slice(0, 10), diaNv = String(input.data_hora).slice(0, 10);
        const seg = (d) => somaDias(d, -((diaDaSemana(d) + 6) % 7));
        const prof = ((await ab.horarios(diaNv, servs[0].codigo).catch(() => [])).find((p) => Number(p.codigo) === Number(input.profissional)) || {});
        if (prof.nome && !mesmoNome(prof.nome, velho.profissional)) return { erro: `este é um horário do plano mensal do cliente: só pode ser remarcado com o mesmo profissional do plano (${velho.profissional}). Explique a regra do plano com gentileza e ofereça horários com ${velho.profissional} na mesma semana; se não houver, use chamar_recepcao.` };
        if (seg(diaNv) !== seg(diaV)) return { erro: `este é um horário do plano mensal do cliente: só pode ser remarcado dentro da mesma semana (de ${seg(diaV).split("-").reverse().join("/")} a ${somaDias(seg(diaV), 6).split("-").reverse().join("/")}), nos dias que o plano permite, com ${velho.profissional}. Se não houver horário, use chamar_recepcao.` };
      }
      // Novo horário encosta no próprio horário do cliente (mesmo dia e profissional)? Então ele só fica livre liberando o antigo.
      const [diaN, horaN] = String(input.data_hora).split(" "), durN = servs.reduce((t, x) => t + (Number(x.minutos) || 30), 0);
      const bloco = String(velho.quando).startsWith(diaN) ? (await blocosDoCliente(ab, ag, diaN)).find((b) => b.itens.some((i) => i.codigo === velho.codigo)) : null;
      const sobrepoe = bloco && mins(horaN) < bloco.fim && mins(horaN) + durN > bloco.ini;
      if (sobrepoe) {
        const l = await livresSemOBloco(ab, diaN, bloco, durN).catch(() => null);
        if (!l || Number(l.profissional.codigo) !== Number(input.profissional) || !l.horarios.includes(horaN)) return { erro: `esse horário não está livre nem trocando o horário atual; livres trocando: ${(l && l.horarios.join(", ")) || "nenhum"}` };
        if (simular) { ctx.stats.remarcados++; return { ok: true, simulado: true }; }
        const comandas = [...new Set(bloco.itens.map((i) => i.comanda).filter(Boolean))];
        if (comandas.length !== bloco.itens.length && comandas.length < 1) return { erro: "não consegui liberar o horário atual; peça para a recepção trocar" };
        for (const c of comandas) await ab.cancelarComanda(c, fone);
        let novoR; try { novoR = await ab.criar({ fone, nome: velho.nome || conv.nome || "Cliente", servicos: servs, profissional: input.profissional, quando: input.data_hora }); }
        catch (e) {
          // Não deu: volta o horário antigo.
          const todos = await ab.servicos(), antigos = bloco.itens.map((i) => todos.find((x) => semAcentoP(x.nome) === semAcentoP(i.servico))).filter(Boolean);
          try { await ab.criar({ fone, nome: velho.nome || conv.nome || "Cliente", servicos: antigos, profissional: input.profissional, quando: `${diaN} ${hhmmM(bloco.ini)}` }); }
          catch { ctx.pendencia(`ao adiantar o horário de ${velho.quando}, o novo não foi marcado e o antigo não voltou: confira na agenda`); }
          return { erro: `não consegui trocar (${e.message}); o horário antigo foi mantido` };
        }
        conv.agenda = null; ctx.stats.remarcados++; ctx.registro(`remarcou de ${velho.quando} para ${input.data_hora}`);
        if (ctx.evento) ctx.evento({ tipo: "remarcacao", dados: { de: velho.quando, para: input.data_hora, antigos: bloco.itens.map((i) => i.codigo), codigos: (novoR && novoR.codigos) || [] } });
        return { ok: true };
      }
      const prob = await confere(servs, input.profissional, input.data_hora); if (prob) return { erro: prob };
      if (simular) { ctx.stats.remarcados++; return { ok: true, simulado: true }; }
      const novoR = await ab.criar({ fone, nome: velho.nome || conv.nome || "Cliente", servicos: servs, profissional: input.profissional, quando: input.data_hora });
      // Marca o novo primeiro (para não perder a vaga) e só depois cancela o antigo.
      try { if (!velho.comanda) throw new Error("sem comanda"); await ab.cancelarComanda(velho.comanda, fone); }
      catch (e) { ctx.stats.remarcados++; ctx.pendencia(`remarcou para ${input.data_hora}, mas o horário antigo (${velho.quando}) não foi cancelado (${e.message}): cancele na agenda`); return { ok: true, aviso: "o novo horário foi marcado; o antigo a recepção vai liberar" }; }
      conv.agenda = null; ctx.stats.remarcados++; ctx.registro(`remarcou de ${velho.quando} para ${input.data_hora}`);
      if (ctx.evento) ctx.evento({ tipo: "remarcacao", dados: { de: velho.quando, para: input.data_hora, antigos: [velho.codigo], codigos: (novoR && novoR.codigos) || [] } });
      return { ok: true };
    }
    case "lembrar": {
      const t = String(input.nota || "").replace(/\s+/g, " ").trim().slice(0, 120);
      if (!t) return { erro: "nota vazia" };
      if (SENSIVEL.test(t)) return { erro: "isso é dado sensível: não guarde" };
      if (simular || !ctx.lembrar) return { ok: true, simulado: true };
      ctx.lembrar(t); return { ok: true, nota: "Guardado. Não precisa avisar o cliente." };
    }
    case "esquecer": {
      if (simular || !ctx.esquecer) return { ok: true, simulado: true };
      ctx.esquecer(); return { ok: true, nota: "Memória apagada. Confirme ao cliente em uma frase." };
    }
    case "confirmar_presenca": {
      if (!fone) return { erro: "telefone do cliente desconhecido" };
      const ag = await ab.agendamentosDe(fone), pedidos = (input.codigos || []).map(Number);
      const meus = ag.filter((a) => pedidos.includes(a.codigo));
      if (!meus.length) return { erro: "esses horários não são deste cliente (ou já passaram/foram cancelados); use consultar_cliente" };
      if (simular) return { ok: true, simulado: true };
      const feitos = [];
      for (const a of meus) { if (!a.confirmado) await ab.confirmar(a.codigo); feitos.push(a.quando); }
      conv.agenda = null; ctx.registro(`confirmou presença em ${feitos.join(", ")}`);
      if (ctx.evento) ctx.evento({ tipo: "confirmado", ref: `cfok:${meus.map((a) => a.codigo).sort((x, y) => x - y).join(",")}`, dados: { quando: meus[0].quando, profissional: meus[0].profissional } });
      return { ok: true, confirmados: feitos, nota: "Agradeça em uma frase curta e simpática (ex.: \"Perfeito, te esperamos! 😊\"). Não faça outra pergunta." };
    }
    case "cancelar": {
      if (!fone) return { erro: "telefone do cliente desconhecido" };
      const ag = conv.agenda || await ab.agendamentosDe(fone), a = ag.find((x) => x.codigo === Number(input.codigo_agendamento));
      if (!a) return { erro: "esse horário não é deste cliente; use consultar_cliente" };
      const juntos = ag.filter((x) => a.comanda && x.comanda === a.comanda && x.codigo !== a.codigo);
      if (simular) { ctx.stats.cancelados++; return { ok: true, simulado: true }; }
      if (!a.comanda) { ctx.pendencia(`cliente pediu para cancelar o horário de ${a.quando}: cancele na agenda`); return { ok: true, aviso: "a recepção vai concluir o cancelamento" }; }
      await ab.cancelarComanda(a.comanda, fone);
      conv.agenda = null; ctx.stats.cancelados++; ctx.registro(`cancelou ${a.quando}`);
      if (ctx.evento) ctx.evento({ tipo: "cancelamento", dados: { quando: a.quando, profissional: a.profissional } });
      if (String(a.quando).slice(0, 10) === hojeSP() && ctx.avisarProfissional) await ctx.avisarProfissional(a.profissional, `❌ ${a.nome || conv.nome || "O cliente"} cancelou o horário de hoje às ${String(a.quando).slice(11, 16).replace(":", "h")} (${[a.servico, ...juntos.map((x) => x.servico)].filter(Boolean).join(" + ")}). Seu horário ficou livre.`);
      const pn = primeiroNome(conv.nome || a.nome || conv.pushName);
      return { ok: true, ...(juntos.length ? { tambem_cancelados: juntos.map((x) => `${x.servico} ${x.quando}`) } : {}), nota: `Confirme o cancelamento em uma frase e TERMINE a mensagem com esta pergunta: "Para quando você gostaria de reagendar${pn ? ", " + pn : ""}?"` };
    }
    case "enviar_arte": {
      const lista = ctx.artes || [], q = String(input.arte || "").toLowerCase().trim();
      const a = lista.find((x) => x.nome.toLowerCase() === q) || lista.find((x) => x.nome.toLowerCase().includes(q) || q.includes(x.nome.toLowerCase()));
      if (!a) return { erro: `arte não encontrada; as disponíveis são: ${lista.map((x) => x.nome).join(", ") || "nenhuma"}` };
      if (conv.artesEnviadas && conv.artesEnviadas.includes(a.nome)) return { aviso: "essa arte já foi enviada nesta conversa; não envie de novo, só responda as dúvidas" };
      if (simular) ctx.registro(`enviaria a arte "${a.nome}"`); else await ctx.enviarArte(a);
      (conv.artesEnviadas = conv.artesEnviadas || []).push(a.nome);
      if (a.retorno) conv.retornoPendente = a;
      const pergunta = (a.pergunta || "").replace(/\{cliente\}/g, primeiroNome(conv.nome || conv.pushName)).trim();
      return { ok: true, nota: pergunta ? `A arte foi enviada. Termine sua resposta com esta pergunta, com estas palavras: "${limpaNome(pergunta)}"` : "A arte foi enviada. Termine com uma pergunta curta para continuar a conversa." };
    }
    case "parabenizar_profissional": {
      if (conv.parabenizou) return { ok: true, nota: "o profissional já recebeu os parabéns nesta conversa" };
      const prof = String(input.profissional || "").trim(), elogio = String(input.elogio || "").replace(/\s+/g, " ").trim().slice(0, 300);
      if (!prof || !elogio) return { erro: "falta o profissional ou o elogio" };
      const cli = String(conv.nome || conv.pushName || "").trim().split(" ")[0] || "um cliente";
      const modelo = ctx.parabens || "Parabéns, {profissional}! 👏 O cliente {cliente} elogiou seu atendimento: \"{elogio}\". Continue fazendo esse excelente trabalho! 💈";
      const t = modelo.replace(/\{profissional\}/g, prof.split(" ")[0]).replace(/\{cliente\}/g, cli).replace(/\{elogio\}/g, elogio);
      conv.parabenizou = true;
      if (simular) { ctx.registro(`parabenizaria ${prof}: ${t}`); return { ok: true, simulado: true }; }
      if (ctx.avisarProfissional) await ctx.avisarProfissional(prof, t);
      ctx.registro(`parabenizou ${prof.split(" ")[0]} pelo elogio de um cliente`);
      return { ok: true, nota: "o profissional recebeu os parabéns. Não precisa contar isso ao cliente." };
    }
    case "avisar_equipe": {
      const t = String(input.recado || "").trim().slice(0, 300); if (!t) return { erro: "recado vazio" };
      if (ctx.evento && !simular && /incluir na comanda/i.test(t)) { const m = t.match(/R\$\s*([\d.,]+)/); ctx.evento({ tipo: "adicional", valor: m ? Number(m[1].replace(/\./g, "").replace(",", ".")) || null : null, dados: { recado: t.slice(0, 160) } }); }
      ctx.pendencia(`recado: ${t}`); if (ctx.alertar && !simular) await ctx.alertar(`📣 ${t}`); else if (simular) ctx.registro(`avisaria a equipe: ${t}`);
      if (input.profissional) { if (ctx.avisarProfissional && !simular) await ctx.avisarProfissional(input.profissional, `📣 ${t}`); else if (simular) ctx.registro(`avisaria ${input.profissional}: ${t}`); }
      return { ok: true, nota: "A equipe foi avisada. Continue atendendo o cliente normalmente." };
    }
    case "lista_de_espera": {
      if (!ctx.listaEspera) return { erro: "lista de espera indisponível" };
      if (input.acao === "sair") { const n = ctx.listaEspera({ sair: true, data: input.data }); return { ok: true, removidos: n }; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.data || "") || input.data < hojeSP()) return { erro: "data inválida ou que já passou" };
      if (!/^\d{2}:\d{2}$/.test(input.de || "") || !/^\d{2}:\d{2}$/.test(input.ate || "") || input.ate < input.de) return { erro: "faixa de horário inválida (HH:MM a HH:MM)" };
      const servs = await servicosPorCodigo(input.servicos || []); if (!servs.length) return { erro: "serviço não encontrado; use ver_servicos" };
      if (simular) { ctx.registro(`colocaria na lista de espera: ${input.data} ${input.de}–${input.ate}`); return { ok: true, simulado: true }; }
      ctx.listaEspera({ data: input.data, servicos: servs.map((s) => ({ codigo: s.codigo, nome: s.nome, minutos: s.minutos, tipo: s.tipo })), profissional: input.profissional || null, de: input.de, ate: input.ate });
      return { ok: true, nota: "Cliente na lista de espera. Diga que, se abrir um horário nessa faixa, você manda mensagem na hora; quem responder primeiro fica com a vaga." };
    }
    case "chamar_recepcao": {
      conv.recepcao = true; ctx.stats.recepcao++; ctx.pendencia(`precisa da recepção: ${String(input.motivo || "").slice(0, 160)}`);
      if (ctx.evento) ctx.evento({ tipo: "recepcao", dados: { motivo: String(input.motivo || "").slice(0, 120) } });
      if (ctx.alertar && !simular) await ctx.alertar(`⚠️ Precisa de atendimento: ${String(input.motivo || "").slice(0, 200)}. A conversa ficou como não lida no WhatsApp.`); else if (simular) ctx.registro(`avisaria a equipe no WhatsApp: ${input.motivo}`);
      return { ok: true, nota: "A recepção foi avisada. Diga ao cliente, com simpatia, que a equipe já vai responder." };
    }
  }
  return { erro: "ferramenta desconhecida" };
}

// No começo de cada conversa: o cliente tem cadastro? (1 consulta à AppBarber, pelo celular do WhatsApp)
// ---------- memória do cliente ----------
// O "de sempre" vem do histórico da AppBarber (serviço, barbeiro, dia e horário de costume). O que o cliente conta
// (preferências úteis para o atendimento) a atendente guarda com a ferramenta lembrar: arquivo no servidor e cópia no
// Supabase (tabela ia_memorias, pela chave do telefone, sem o número), para a equipe ver, corrigir ou apagar no app.
const MEM = "memoria-clientes.json";
export const chaveMemoria = (fone) => hashCurto("mem:" + chaveFone(fone));
export function lerMemorias(dir) { try { return JSON.parse(readFileSync(join(dir, MEM), "utf8")); } catch { return {}; } }
export function gravarMemorias(dir, m) { try { writeFileSync(join(dir, MEM), JSON.stringify(m), { mode: 0o600 }); } catch { /* tenta na próxima */ } }
// Dado sensível não entra (saúde, religião, política, dinheiro, documentos, senhas).
const SENSIVEL = /\b(doen[cç]a|diabet|c[aâ]ncer|hiv|depress|ansiedade|rem[eé]dio|gr[aá]vid|religi|igreja|evang[eé]l|cat[oó]lic|pol[ií]tic|partido|vot[oa]|sal[aá]rio|d[ií]vida|empr[eé]stimo|cpf|rg\b|senha|cart[aã]o de cr[eé]dito|conta banc)/i;
export function costumeLinha(dir, fone, hoje = hojeSP()) {
  let h; try { h = JSON.parse(readFileSync(join(dir, "retorno-historico.json"), "utf8")); } catch { return ""; }
  const cl = h && h.cli && h.cli[chaveFone(fone)]; if (!cl) return "";
  const a = analisarCliente(cl.v, hoje);
  const v = (cl.v || []).slice().sort((x, y) => String(x[0]).localeCompare(String(y[0]))), ult = v[v.length - 1];
  if (!a) {
    if (!ult) return "";
    return `[Histórico do cliente: última visita em ${ult[0].split("-").reverse().join("/")} (há ${diasEntre(ult[0], hoje)} dias)${ult[3] ? `, fez ${ult[3]}` : ""}${ult[2] ? ` com ${ult[2]}` : ""}. ${v.length} visita(s) no último ano.]\n`;
  }
  const hora = a.hora != null ? `${String(Math.floor(a.hora / 60)).padStart(2, "0")}h${String(a.hora % 60).padStart(2, "0")}`.replace(/h00$/, "h") : "";
  const periodo = a.hora == null ? "" : a.hora < 12 * 60 ? "de manhã" : a.hora < 18 * 60 ? "à tarde" : "no fim da tarde/noite";
  const atraso = a.dias - a.media;
  return `[O de sempre deste cliente (histórico da agenda): ${a.serv} com ${a.prof}, costuma vir ${DIAS[a.dia]}${hora ? ` por volta das ${hora} (${periodo})` : ""}, a cada ~${a.media} dias; última visita há ${a.dias} dias${atraso > 5 ? ` (já passou uns ${atraso} dias do ritmo dele: pode comentar com leveza, ex.: "Faz um tempinho, hein! 😄")` : ""}. Se ele quiser agendar sem dar detalhes, proponha o de sempre numa pergunta só (ex.: "O de sempre, ${a.serv.split(" + ")[0].replace(/^\d+(\.\d+)?\s*/, "")} com o ${primeiroNome(a.prof)} na ${DIAS[a.dia].replace("-feira", "")} ${periodo || ""}?"); se ele disser sim, siga direto para ver_horarios. Se ele pedir outra coisa, siga o que ele pedir.]\n`;
}
export function memoriaLinha(dir, fone) {
  const m = lerMemorias(dir)[chaveMemoria(fone)];
  if (!m || !Array.isArray(m.notas) || !m.notas.length) return "";
  return `[Memória do cliente (o que ele já contou em outras conversas; use com naturalidade quando ajudar, sem repetir tudo):\n${m.notas.map((n) => `- ${n.t}${n.em ? ` (${n.em.split("-").reverse().slice(0, 2).join("/")})` : ""}`).join("\n")}]\n`;
}
export async function verificarCadastro(ab, fone, conv) {
  if (!fone) return "[Cadastro: WhatsApp do cliente desconhecido; se for agendar, peça o celular com DDD]";
  try {
    const c = await ab.clienteDe(fone);
    if (!c) { conv.cadastro = null; return "[Cadastro: cliente SEM cadastro na barbearia (cliente novo)]"; }
    conv.cadastro = c; if (c.nome) conv.nome = c.nome;
    const pl = ab.assinaturaDe ? await ab.assinaturaDe(fone).catch(() => null) : null;
    conv.plano = pl ? pl.plano || "plano mensal" : null;
    return `[Cadastro: cliente cadastrado como ${c.nome || "(sem nome)"}; data de nascimento ${c.nascimento ? "cadastrada" : "NÃO cadastrada"}${pl ? `; ASSINANTE do ${pl.plano || "plano mensal"}${pl.situacao ? ` (situação: ${pl.situacao})` : ""}: os horários do plano são com o profissional fixo dele (veja regras dos planos)` : ""}]`;
  } catch { return "[Cadastro: não consegui verificar agora]"; }
}

// Primeira linha de cada mensagem do cliente: dia, hora e WhatsApp (fica no histórico, que nunca é reescrito).
export const agoraTexto = (fone) => `[Agora: ${DIAS[diaSemanaSP()]}, ${hojeSP().split("-").reverse().join("/")}, ${String(Math.floor(agoraSP() / 60)).padStart(2, "0")}:${String(agoraSP() % 60).padStart(2, "0")} (horário de Brasília) · WhatsApp do cliente: ${fone ? "+" + fone : "desconhecido"}]`;

// Uma rodada: manda a conversa ao Claude, executa as ferramentas e devolve o texto para o cliente.
export async function rodada({ client, modelo, sistema, conv, ctx, maxPassos = 8 }) {
  const fallback = modelo !== "claude-haiku-5-5"; // o Haiku não tem plano B no servidor
  let gasto = 0;
  for (let passo = 0; passo < maxPassos; passo++) {
    const params = {
      model: modelo, max_tokens: 16000,
      output_config: { effort: "medium" },
      // Cache da conversa: o que ela já leu fica guardado e sai bem mais barato na próxima mensagem.
      cache_control: { type: "ephemeral" },
      // O system não muda durante a conversa (a data e a hora vão na mensagem do cliente): o histórico só cresce,
      // como o raciocínio guardado da IA exige.
      system: [{ type: "text", text: sistema, cache_control: { type: "ephemeral" } }],
      tools: TOOLS, tool_choice: { type: "auto" },
      messages: conv.mensagens,
      // Rede de segurança: se algum dia o começo da conversa não bater, a API descarta o raciocínio antigo em vez de dar erro.
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01"], fallbacks: "default", thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } } } : {}),
    };
    const r = fallback ? await client.beta.messages.create(params) : await client.messages.create(params);
    gasto += custo(modelo, r.usage || {});
    conv.mensagens.push({ role: "assistant", content: r.content }); // conversa só cresce (o histórico nunca é editado)
    if (r.stop_reason === "refusal") { conv.recepcao = true; ctx.stats.recepcao++; ctx.pendencia("a IA não conseguiu responder esta conversa"); return { texto: "Vou pedir para alguém da nossa equipe te responder por aqui, tá bom? 😊", gasto }; }
    const usos = r.content.filter((b) => b.type === "tool_use");
    if (r.stop_reason !== "tool_use" || !usos.length) {
      const texto = r.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").replace(/\*\*([^*]+)\*\*/g, "$1").trim();
      return { texto, gasto };
    }
    const resultados = [];
    for (const u of usos) {
      let out, erro = false;
      try { out = await executar(u.name, u.input || {}, { ...ctx, conv }); }
      catch (e) { out = { erro: e.message }; erro = true; if (ctx.registro) ctx.registro(`a ferramenta ${u.name} deu erro: ${String(e.message).slice(0, 160)}`); }
      // Falha ao gravar na AppBarber: fica no log do servidor e no recado para a recepção (no card).
      if (out && out.erro && /^(agendar|remarcar|cancelar|salvar_cadastro)$/.test(u.name) && !/não cabe|não está mais livre|já passou|não atende esse serviço|CHOQUE/.test(String(out.erro)) && ctx.falha) ctx.falha(`${u.name} não deu certo: ${String(out.erro).slice(0, 200)}`);
      resultados.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out), ...(erro ? { is_error: true } : {}) });
    }
    conv.mensagens.push({ role: "user", content: resultados });
  }
  conv.recepcao = true; ctx.pendencia("a conversa ficou longa demais para a IA");
  return { texto: "Deixa eu chamar alguém da equipe pra te ajudar melhor, só um instante 😊", gasto };
}

// ---------- relatório semanal ----------
const RELATORIO_SCHEMA = { type: "object", additionalProperties: false, required: ["resumo", "motivos", "sugestoes"], properties: {
  resumo: { type: "string", description: "2 a 4 frases sobre como foi a semana da atendente, para o dono da barbearia" },
  motivos: { type: "array", description: "Principais motivos de a atendente travar, chamar a recepção ou perder o cliente (até 5)", items: { type: "object", additionalProperties: false, required: ["motivo", "quantas", "exemplo"],
    properties: { motivo: { type: "string" }, quantas: { type: "integer" }, exemplo: { type: "string", description: "Trecho curto e sem dados pessoais" } } } },
  sugestoes: { type: "array", description: "Até 5 regras novas para a atendente, prontas para colar nas instruções", items: { type: "object", additionalProperties: false, required: ["regra", "porque"],
    properties: { regra: { type: "string", description: "Uma frase, no imperativo, ex.: Quando pedirem corte infantil, ofereça só o Igor." }, porque: { type: "string" } } } } } };

// Texto curto da conversa para o relatório (sem telefones).
export function transcricao(mensagens, max = 3500) {
  const linhas = [];
  for (const m of mensagens) {
    if (typeof m.content === "string") { linhas.push((m.role === "user" ? "Cliente: " : "Atendente: ") + m.content); continue; }
    for (const b of m.content || []) {
      if (b.type === "text" && b.text) linhas.push("Atendente: " + b.text);
      else if (b.type === "tool_use") linhas.push(`(consultou ${b.name}${b.input && Object.keys(b.input).length ? " " + JSON.stringify(b.input) : ""})`);
      else if (b.type === "tool_result" && /"erro"/.test(String(b.content))) linhas.push("(resultado: " + String(b.content).slice(0, 200) + ")");
    }
  }
  const t = linhas.join("\n").replace(/\+?\d[\d\s-]{8,}\d/g, "[telefone]");
  return t.length > max ? t.slice(0, max / 2) + "\n[…]\n" + t.slice(-max / 2) : t;
}

// Gera o relatório da semana a partir do registro das conversas (lista de { em, fone4, resultado, motivo, feitos, semVaga, custo, texto }).
export async function gerarRelatorio({ client, modelo, registros, notas = "", nome = "Sofia", barbearia = "", ate = hojeSP() }) {
  const de = somaDias(ate, -6), sem = registros.filter((r) => r.em.slice(0, 10) >= de && r.em.slice(0, 10) <= ate);
  const soma = (k) => sem.reduce((a, r) => a + ((r.feitos || {})[k] || 0), 0);
  const numeros = { conversas: sem.length, agendamentos: soma("agendou"), remarcacoes: soma("remarcou"), cancelamentos: soma("cancelou"),
    recepcao: sem.filter((r) => r.resultado === "recepcao").length, recepcao_assumiu: sem.filter((r) => r.resultado === "recepcao_assumiu").length,
    sem_resultado: sem.filter((r) => r.resultado === "sem_resultado").length, sem_vaga: sem.reduce((a, r) => a + (r.semVaga || 0), 0),
    custo_usd: Math.round(sem.reduce((a, r) => a + (r.custo || 0), 0) * 100) / 100 };
  const base = { semana: `${de} a ${ate}`, gerado_em: new Date().toISOString(), numeros };
  const problemas = sem.filter((r) => r.resultado !== "resolvida" || r.semVaga);
  if (!problemas.length) return { ...base, resumo: sem.length ? `Semana tranquila: ${sem.length} conversa(s), todas resolvidas pela ${nome}.` : `A ${nome} não teve conversas nesta semana.`, motivos: [], sugestoes: [], custo_relatorio: 0 };
  let corpo = "", n = 0;
  for (const r of problemas) { const bloco = `\n### Conversa ${++n} (${r.resultado}${r.motivo ? ": " + r.motivo : ""})\n${r.texto}\n`; if (corpo.length + bloco.length > 60000) break; corpo += bloco; }
  const r = await client.messages.create({
    model: modelo, max_tokens: 16000, output_config: { effort: "medium", format: { type: "json_schema", schema: RELATORIO_SCHEMA } },
    system: `Você ajuda o dono da ${barbearia} a melhorar a ${nome}, a atendente de IA que responde o WhatsApp dos clientes e marca horários. Analise as conversas da semana que não terminaram bem e escreva em português do Brasil, simples e direto, para o dono (que não é técnico).
- Motivos: agrupe o que se repete; diga quantas conversas tiveram cada motivo e um exemplo curto, sem nomes nem telefones.
- Sugestões: regras práticas que a ${nome} pode seguir (uma frase cada), só quando a conversa mostra uma necessidade real. Não repita o que já está nas instruções atuais. Não sugira inventar preço, horário ou desconto. Se o problema é de configuração da agenda (ex.: falta de horários), diga isso no resumo em vez de criar regra. Se não houver boa sugestão, devolva a lista vazia.
Resultados possíveis: recepcao (a atendente chamou a recepção), recepcao_assumiu (a recepção entrou na conversa), sem_resultado (o cliente sumiu sem marcar), resolvida (com horário sem vaga no meio do caminho).`,
    messages: [{ role: "user", content: `Instruções atuais da ${nome} (Informações da casa):\n${notas || "(vazio)"}\n\nNúmeros da semana: ${JSON.stringify(numeros)}\n\nConversas para analisar:${corpo}` }],
  });
  if (r.stop_reason === "refusal") throw new Error("a IA recusou gerar o relatório");
  const txt = r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const j = JSON.parse(txt);
  return { ...base, resumo: j.resumo, motivos: (j.motivos || []).slice(0, 5), sugestoes: (j.sugestoes || []).slice(0, 5).map((x) => ({ ...x, estado: null })), custo_relatorio: Math.round(custo(modelo, r.usage || {}) * 1000) / 1000 };
}
export const lerRegistros = (dir) => { try { return JSON.parse(readFileSync(join(dir, "sofia-registro.json"), "utf8")); } catch { return []; } };
// "2026-11-22 14:05" no horário de Brasília.
const carimbo = (ts) => new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));

// Carrega o SDK da Anthropic; se faltar, instala na pasta do programa (uma vez).
export async function carregarSDK(dir, log = () => {}) {
  const tenta = async () => (await import("@anthropic-ai/sdk")).default;
  try { return await tenta(); } catch { /* instala abaixo */ }
  const { spawnSync } = await import("node:child_process");
  log("Instalando o SDK da Anthropic para a Sofia…");
  spawnSync("npm", ["install", `@anthropic-ai/sdk@${SDK_VERSAO}`, "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: dir, stdio: "ignore" });
  return tenta();
}

// ---------- a Sofia ligada ao WhatsApp ----------
// Transcrição de áudio (OpenAI, gpt-4o-mini-transcribe). Chave: OPENAI_API_KEY em /etc/gbia-sync.env (gbia-sofia-chave-audio).
const PRECO_AUDIO_MIN = 0.003; // US$ por minuto
export async function transcreverAudio(buf, { key = process.env.OPENAI_API_KEY, base = process.env.OPENAI_BASE_URL || "https://api.openai.com" } = {}) {
  if (!key) return null;
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "audio/ogg" }), "audio.ogg");
  fd.append("model", "gpt-4o-mini-transcribe"); fd.append("language", "pt");
  const r = await fetch(base.replace(/\/$/, "") + "/v1/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer " + key }, body: fd, signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`transcrição: HTTP ${r.status}${j.error && j.error.message ? " " + String(j.error.message).slice(0, 120) : ""}`);
  return String(j.text || "").trim();
}

// ---------- resultado da atendente IA e do totem (painel no app) ----------
// Eventos ficam numa fila no disco e vão para o banco a cada minuto. Os agendamentos ficam guardados para, no dia
// seguinte, conferir na agenda se o cliente veio (atendimento "realizado").
const resultadosPorDir = new Map();
export function resultadosDe(dir, api, log = () => {}, req = null) {
  if (resultadosPorDir.has(dir)) return resultadosPorDir.get(dir);
  const FILA = join(dir, "resultados-fila.json"), AGS = join(dir, "resultados-agendados.json");
  const ler = (f, pad) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return pad; } };
  const gravar = (f, v) => { try { writeFileSync(f, JSON.stringify(v), { mode: 0o600 }); } catch (e) { log("Resultados: não gravei: " + e.message); } };
  let enviando = false, conferidoEm = "", e0 = null, ab = null, abChave = "";
  function evento(cid, ev) {
    if (!cid || !ev || !ev.tipo) return;
    const fila = ler(FILA, []); fila.push({ cid, em: new Date().toISOString(), ...ev }); gravar(FILA, fila.slice(-2000));
    // Remarcou: o comparecimento passa a ser conferido no horário novo (o antigo foi cancelado, não é falta).
    if (ev.tipo === "remarcacao" && ev.dados && Array.isArray(ev.dados.antigos) && ev.dados.codigos && ev.dados.codigos.length) {
      const ant = new Set(ev.dados.antigos.map(Number)), l = ler(AGS, []); let mudou = false;
      for (const x of l) if (x.cid === cid && x.codigos.some((c) => ant.has(Number(c)))) { x.codigos = [...x.codigos.filter((c) => !ant.has(Number(c))), ...ev.dados.codigos]; x.data = String(ev.dados.para || "").slice(0, 10) || x.data; mudou = true; }
      if (mudou) gravar(AGS, l);
    }
    if (ev.tipo === "agendamento" && ev.ref && ev.dados && ev.dados.data) { const l = ler(AGS, []); l.push({ cid, ref: ev.ref, data: ev.dados.data, codigos: ev.dados.codigos || [] }); gravar(AGS, l.slice(-1000)); }
  }
  async function enviar() {
    if (enviando) return; const fila = ler(FILA, []); if (!fila.length) return; enviando = true;
    try {
      const porCid = new Map(); for (const x of fila) (porCid.get(x.cid) || porCid.set(x.cid, []).get(x.cid)).push(x);
      for (const [cid, l] of porCid) await api("POST", { company_id: cid, acao: "ia_eventos", eventos: l.map(({ cid: _c, ...x }) => x) });
      const agora = ler(FILA, []); gravar(FILA, agora.slice(fila.length)); // o que chegou enquanto enviava fica
    } catch (e) { log("Resultados: envio adiado (" + e.message + ")"); } finally { enviando = false; }
  }
  // Uma vez por dia (a partir das 8h): confere na agenda quem veio nos agendamentos dos dias anteriores.
  async function conferir() {
    const hoje = hojeSP(); if (!ab || conferidoEm === hoje || agoraSP() < 8 * 60) return; conferidoEm = hoje;
    let l = ler(AGS, []); const pend = l.filter((x) => x.cid === e0.company_id && x.data < hoje);
    if (!pend.length) return;
    const datas = [...new Set(pend.map((x) => x.data))].filter((d) => d >= somaDias(hoje, -10)), itens = [];
    for (const d of datas) {
      try { const feitos = new Set((await ab.agenda(d, d, "2")).map((a) => Number(a.appointment_code || a.scheduling_code)));
        for (const x of pend.filter((y) => y.data === d)) itens.push({ ref: x.ref, ok: x.codigos.some((c) => feitos.has(Number(c))) }); }
      catch (err) { log("Resultados: não conferi " + d + ": " + err.message); }
    }
    if (itens.length) { try { await api("POST", { company_id: e0.company_id, acao: "ia_compareceu", itens }); } catch { return; } }
    const feitosRef = new Set(itens.map((x) => x.ref));
    l = l.filter((x) => !feitosRef.has(x.ref) && x.data >= somaDias(hoje, -10)); gravar(AGS, l);
  }
  function configurar(e) {
    if (!e || !e.appbarber) return; e0 = e;
    const k = `${e.appbarber.codigo_estabelecimento}|${e.appbarber.appbarber_api_key}`;
    if (!ab || abChave !== k) { abChave = k; ab = ferramentasAppBarber({ cfg: e.appbarber, ...(req ? { req } : {}), creditos: (n, zero) => api("POST", { company_id: e.company_id, acao: "ab_uso", creditos: n, ...(zero ? { sem_saldo: true } : {}) }).catch(() => {}) }); }
  }
  // Início da contagem ao vivo: o que veio antes disso é importado uma vez do histórico (importarHistorico).
  const INI = join(dir, "resultados-inicio.json"), HISTF = join(dir, "resultados-historico.json");
  const inicio = (() => {
    const v = ler(INI, null); if (v && v.em) return v.em;
    // A primeira versão com resultados (6.2) não gravava o início: vale a criação dos arquivos de eventos, se já existem.
    const ts = [Date.now()]; for (const f of [FILA, AGS]) { try { const st = statSync(f); ts.push(Math.min(st.birthtimeMs || st.mtimeMs, st.mtimeMs)); } catch { /* não existe */ } }
    const em = new Date(Math.min(...ts)).toISOString(); gravar(INI, { em }); return em;
  })();
  let historicoEm = 0;
  async function importarHistorico() {
    if (!ab || !e0 || Date.now() - historicoEm < 3600000) return; const h = ler(HISTF, {}); if (h[e0.company_id] && h[e0.company_id].v >= 2) return; // v2: remarcações
    historicoEm = Date.now();
    const evs = await historicoEventos({ ab, dir, inicio, hoje: hojeSP(), log });
    const cid = e0.company_id;
    for (let i = 0; i < evs.eventos.length; i += 200) await api("POST", { company_id: cid, acao: "ia_eventos", eventos: evs.eventos.slice(i, i + 200) });
    for (let i = 0; i < evs.compareceu.length; i += 300) await api("POST", { company_id: cid, acao: "ia_compareceu", itens: evs.compareceu.slice(i, i + 300) });
    if (evs.pendentes.length) { const l = ler(AGS, []); gravar(AGS, l.concat(evs.pendentes.map((x) => ({ cid, ...x }))).slice(-1000)); }
    h[cid] = { v: 2, em: new Date().toISOString(), eventos: evs.eventos.length }; gravar(HISTF, h);
    log(`Resultados: histórico importado (${evs.resumo}).`);
  }
  setInterval(() => { enviar().catch(() => {}); conferir().catch(() => {}); importarHistorico().catch((e) => log("Resultados: histórico adiado (" + e.message + ")")); }, 60000).unref();
  const r = { evento, configurar, enviar, conferir, importarHistorico, inicio };
  resultadosPorDir.set(dir, r); return r;
}
// Histórico de antes da contagem ao vivo: agendamentos da Sofia e do totem (pela observação na AppBarber, com valor,
// profissional e se o cliente veio), conversas e custo (registro dos últimos 30 dias) e convites de retorno e reconquista.
const dataBR = (t) => { const m = String(t || "").match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/); return m ? { dia: `${m[3]}-${m[2]}-${m[1]}`, hora: m[4] ? `${m[4]}:${m[5]}` : "12:00" } : null; };
const numBR = (v) => { const t = String(v ?? "").trim(); if (!t) return 0; const n = Number(/,\d{1,2}$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t); return Number.isFinite(n) ? n : 0; };
const hashCurto = (t) => createHash("sha256").update(String(t)).digest("hex").slice(0, 12);
export async function historicoEventos({ ab, dir, inicio, hoje, log = () => {}, diasAtras = 92 }) {
  const ler = (f, pad) => { try { return JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { return pad; } };
  const eventos = [], compareceu = [], pendentes = [], cont = { ag: 0, ad: 0, conv: 0, convites: 0, rem: 0 };
  const ini = somaDias(hoje, -diasAtras);
  // Convites (só a data; telefone vira chave curta para achar a origem do agendamento)
  const convites = []; // { k, dia, origem }
  for (const [k, x] of Object.entries(ler("reconquista-enviados.json", {}))) if (x && x.em && !x.pulado) convites.push({ k, dia: x.em, origem: "reconquista" });
  for (const [k, x] of Object.entries(ler("retorno-enviados.json", {}))) if (x && x.em && x.enviado) convites.push({ k: chaveFone(k), dia: x.em, origem: "retorno" });
  const diaIni = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(inicio));
  for (const c of convites) if (c.dia < diaIni) { eventos.push({ em: `${c.dia}T12:00:00-03:00`, tipo: "convite", origem: c.origem, ref: `h:cv:${c.origem.slice(0, 3)}:${hashCurto(c.k + c.dia)}` }); cont.convites++; }
  const origemDe = (fone, dia) => { const k = chaveFone(fone); let o = null, melhor = ""; for (const c of convites) if (c.k === k && c.dia <= dia && c.dia >= somaDias(dia, -10) && c.dia > melhor) { melhor = c.dia; o = c.origem; } return o; };
  // Agendamentos na AppBarber (períodos de até 31 dias)
  const linhas = [], janelas = (de, ate) => { const l = []; for (let a = de; a <= ate; a = somaDias(a, 31)) l.push([a, somaDias(a, 30) > ate ? ate : somaDias(a, 30)]); return l; };
  for (const [st, de, ate] of [["2", ini, hoje], ["3", ini, somaDias(hoje, 45)], ["5", ini, hoje], ["1", ini, somaDias(hoje, 45)]])
    for (const [a, b] of janelas(de, ate)) { try { for (const x of await ab.agenda(a, b, st)) linhas.push({ ...x, _st: st }); } catch (e) { log(`Resultados: histórico ${a}…${b} (${st}): ${e.message}`); } }
  const grupos = new Map();
  for (const x of linhas) {
    const obs = String(x.scheduling_observation || ""), sofia = /Agendado pela So(f|ph)ia/i.test(obs), totem = /totem da recep/i.test(obs);
    if (!sofia && !totem) continue;
    const reg = dataBR(x.scheduling_registration_date), quando = dataBR(x.scheduling_start); if (!reg || !quando) continue;
    const em = new Date(`${reg.dia}T${reg.hora}:00-03:00`).toISOString(); if (em >= inicio) continue; // daqui em diante conta ao vivo
    const cod = Number(x.appointment_code || x.scheduling_code); if (!cod) continue;
    const g = `${so(x.client_phone)}|${reg.dia} ${reg.hora}|${totem ? "t" : "s"}|${/adicional/i.test(obs) && sofia ? "a" : ""}`;
    const o = grupos.get(g) || { em, quando, sofia, totem, adicional: sofia && /adicional/i.test(obs), fone: x.client_phone, prof: x.employee_name || "", servs: [], cods: new Set(), valor: 0, st: new Set(), extra: 0 };
    if (o.cods.has(cod)) continue; o.cods.add(cod); o.valor += numBR(x.service_value); o.servs.push(x.service_description || ""); o.st.add(x._st);
    if (totem && !o.extra) { const m = obs.match(/R\$\s*([\d.,]+)[^·]*comanda/i); if (m) o.extra = numBR(m[1]); }
    grupos.set(g, o);
  }
  // Cancelado e marcado de novo pela Sofia (remarcação: ela marca o novo e cancela o antigo) não conta duas vezes nem como falta.
  const todos = [...grupos.values()];
  for (const o of todos) o.remarcado = o.st.size === 1 && o.st.has("3") && todos.some((x) => x !== o && x.sofia && chaveFone(x.fone) === chaveFone(o.fone) && x.em > o.em && x.em <= new Date(Date.parse(o.em) + 45 * 86400000).toISOString());
  for (const o of todos) {
    if (o.remarcado) { cont.rem++; eventos.push({ em: o.em, tipo: "remarcacao", origem: o.totem ? "totem" : "whatsapp", ref: `h:rm:${[...o.cods].sort((a, b) => a - b).join(",")}`, dados: { historico: true } }); continue; }
    const cods = [...o.cods].sort((a, b) => a - b), ref = `ag:${cods.join(",")}`;
    const origem = o.totem ? "totem" : origemDe(o.fone, o.em.slice(0, 10)) || "whatsapp";
    if (o.adicional) { eventos.push({ em: o.em, tipo: "adicional", origem, valor: o.valor, ref: "h:" + ref, dados: { profissional: o.prof, servicos: o.servs.join(" + "), historico: true } }); cont.ad++; continue; }
    eventos.push({ em: o.em, tipo: "agendamento", origem, valor: Math.round((o.valor + o.extra) * 100) / 100, ref, dados: { data: o.quando.dia, hora: o.quando.hora, profissional: o.prof, servicos: o.servs.join(" + "), codigos: cods, historico: true } });
    cont.ag++;
    if (o.st.has("2")) compareceu.push({ ref, ok: true });
    else if (o.st.has("5") || o.st.has("3") || o.quando.dia < hoje) compareceu.push({ ref, ok: false });
    else pendentes.push({ ref, data: o.quando.dia, codigos: cods });
  }
  // Conversas e custo (registro do relatório semanal: últimos 30 dias)
  for (const r of ler("sofia-registro.json", [])) {
    if (!r || !r.em || !r.id || new Date(r.em).toISOString() >= inicio) continue;
    const em = new Date(r.em).toISOString(); cont.conv++;
    eventos.push({ em, tipo: "conversa", origem: "whatsapp", ref: `h:c:${r.id}` });
    if (r.custo > 0) eventos.push({ em, tipo: "uso", origem: "whatsapp", valor: r.custo, ref: `h:u:${r.id}` });
    if (r.resultado === "recepcao") eventos.push({ em, tipo: "recepcao", origem: "whatsapp", ref: `h:r:${r.id}` });
  }
  return { eventos, compareceu, pendentes, resumo: `${cont.ag} agendamento(s), ${cont.rem} remarcado(s), ${cont.ad} adicional(is), ${cont.conv} conversa(s), ${cont.convites} convite(s)` };
}
// Valor de um agendamento: preço do horário do 1º serviço na agenda (já com promoção e preço do profissional) + tabela dos outros.
async function valorAgendamento(ab, servs, profissional, data, hora) {
  try {
    const p = (await ab.horarios(data, servs[0].codigo)).find((x) => Number(x.codigo) === Number(profissional));
    const v1 = Number(((p && p.precos && p.precos[hora]) || [])[0]) || Number(servs[0].preco) || 0;
    return v1 + servs.slice(1).reduce((t, s) => t + (Number(s.preco) || 0), 0);
  } catch { return servs.reduce((t, s) => t + (Number(s.preco) || 0), 0); }
}
export function criarSofia({ dir, log, api, sock, resultados = null, conectado = () => true, cmdConectar = () => "gbia-whatsapp-conectar-principal", baixarMidia = null, transcrever = transcreverAudio, abReq = null }) {
  let Anthropic = null, client = null, cfg = null, ab = null, abKey = "";
  const conversas = new Map(); // jid → { mensagens, ultima, ultimaSofia, humanoEm, contexto, nome, agenda, recepcao, fone, fila, ocupado }
  // As conversas sobrevivem a reinícios (atualização, instalador): ficam num arquivo do servidor por até 6 horas.
  const CONV = join(dir, "sofia-conversas.json");
  const CAMPOS = ["recepcaoEm", "parabenizou", "origem", "jaAgendou", "mensagens", "inicio", "ultima", "ultimaSofia", "humanoEm", "contexto", "contada", "nome", "recepcao", "fone", "cadastro", "verificado", "sistema", "artes", "feitos", "gasto", "motivo", "pushName", "esperaAte", "esperaDe", "registrada", "regId", "fila", "noturna", "pendTipo", "ultimaCliente"];
  // Mensagens esperando resposta (fila) também ficam salvas: um reinício não faz ninguém ficar sem resposta.
  // Áudio não dá para guardar (o arquivo fica no WhatsApp): vira um aviso para a Sofia pedir de novo.
  const AUDIO_PERDIDO = "[o cliente mandou um áudio que não deu para ouvir; peça, com gentileza, para ele mandar de novo ou escrever]";
  const guardavel = (c, j) => Date.now() - (c.ultima || 0) < 6 * 3600000 || (c.noturna && c.fila && c.fila.length && Date.now() - c.noturna < 36 * 3600000);
  try {
    for (const [j, x] of Object.entries(JSON.parse(readFileSync(CONV, "utf8")))) {
      if (!guardavel(x)) continue;
      const c = { agenda: null, ocupado: false, ...x, fila: Array.isArray(x.fila) ? x.fila : [] };
      // Estava esperando os 7 segundos (ou sendo respondida) quando o programa reiniciou: entra na fila de pendentes.
      if (c.fila.length && !c.noturna) { c.noturna = c.ultimaCliente || c.ultima || Date.now(); c.pendTipo = "recente"; }
      conversas.set(j, c);
    }
    const n = [...conversas.values()].filter((c) => c.fila.length).length;
    if (n) log(`Sofia: ${n} conversa(s) com mensagens esperando resposta recuperadas depois do reinício.`);
  } catch { /* primeira vez ou arquivo vazio */ }
  let salvarEm = 0, salvarDepois = null;
  function salvarConversas(forcar = false) {
    if (!forcar && Date.now() - salvarEm < 5000) { if (!salvarDepois) salvarDepois = setTimeout(() => { salvarDepois = null; salvarConversas(true); }, 5000); return; }
    salvarEm = Date.now();
    const out = {};
    for (const [j, c] of conversas) if (guardavel(c)) {
      const x = {}; for (const k of CAMPOS) if (c[k] !== undefined) x[k] = c[k];
      if (c.fila) x.fila = c.fila.map((f) => (typeof f === "string" ? f : AUDIO_PERDIDO));
      out[j] = x;
    }
    try { writeFileSync(CONV, JSON.stringify(out), { mode: 0o600 }); } catch (e) { log("Sofia: conversas não gravadas: " + e.message); }
  }
  const pausas = new Map();    // jid → até quando a Sofia fica quieta (a recepção respondeu pelo celular)
  // A pausa sobrevive a reinícios (instalador, atualização): volta a partir da hora em que a recepção respondeu.
  for (const [j, c] of conversas) if (c.humanoEm && c.humanoEm + 60 * 60000 > Date.now()) pausas.set(j, c.humanoEm + 60 * 60000);
  const minhas = new Set();    // ids das mensagens que este programa mandou (lembretes, feedback, parabéns…)
  const daSofia = new Set();   // ids das respostas da própria Sofia
  const pendencias = [];       // recados para a recepção (vão para o app)
  let stats = { dia: "", conversas: 0, agendados: 0, remarcados: 0, cancelados: 0, recepcao: 0, gasto: 0 }, statusEm = 0;

  const zera = () => { const d = hojeSP(); if (stats.dia !== d) { stats = { dia: d, conversas: 0, agendados: 0, remarcados: 0, cancelados: 0, recepcao: 0, gasto: 0 }; pendencias.length = 0; } };
  const texto = (msg) => { const m = msg.message || {}; return String(m.conversation || (m.extendedTextMessage && m.extendedTextMessage.text) || (m.ephemeralMessage && m.ephemeralMessage.message && (m.ephemeralMessage.message.conversation || (m.ephemeralMessage.message.extendedTextMessage || {}).text)) || "").trim(); };
  const midia = (msg) => { const m = msg.message || {}; return m.audioMessage ? "áudio" : m.imageMessage ? "foto" : m.videoMessage ? "vídeo" : m.stickerMessage ? "figurinha" : m.documentMessage ? "documento" : m.locationMessage ? "localização" : ""; };
  const foneDe = (msg) => { const j = [msg.key.remoteJid, msg.key.remoteJidAlt, msg.key.senderPn, msg.key.participantPn].find((x) => x && /@s\.whatsapp\.net$/.test(x)); return j ? so(j.split("@")[0]) : ""; };

  async function status(extra = "") {
    if (!cfg) return;
    zera(); statusEm = Date.now();
    const quando = new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    const ativa = dentroDaJanela(cfg.janelas);
    const partes = [`${quando} · versão ${SOFIA_VERSAO} · ${ativa ? "atendendo agora" : "fora do horário dela (a recepção atende)"}`,
      `hoje: ${stats.conversas} conversa(s), ${stats.agendados} agendamento(s), ${stats.remarcados} remarcação(ões), ${stats.cancelados} cancelamento(s), ${stats.recepcao} passada(s) para a recepção`,
      `custo da IA hoje ≈ US$ ${stats.gasto.toFixed(2).replace(".", ",")}`];
    const esperando = [...conversas.values()].filter((c) => c.noturna && c.pendTipo === "noite" && c.fila.length).length;
    try { const nEsp = JSON.parse(readFileSync(join(dir, "sofia-espera.json"), "utf8")).length; if (nEsp) partes.push(`${nEsp} cliente(s) na lista de espera`); } catch { /* sem lista */ }
    if (esperando) partes.push(`${esperando} conversa(s) da noite esperando para ela responder às 7h`);
    if (pendencias.length) partes.push("para a recepção: " + pendencias.slice(-5).join(" | "));
    // WhatsApp desconectado do servidor: ela não recebe nem responde nada; o app mostra o erro em vez de "ok".
    const st = extra ? extra : !conectado() ? `erro: ${quando} · o WhatsApp está desconectado do servidor: a ${cfg.nome} não recebe nem responde mensagens. No servidor, rode: ${cmdConectar()}` : "ok: " + partes.join(" · ") + ".";
    await api("POST", { company_id: cfg.company_id, acao: "ia_status", status: st }).catch(() => {});
  }

  async function configurar(e) {
    if (!e || !e.sofia || !e.appbarber) { cfg = null; return; }
    const novo = { company_id: e.company_id, barbearia: e.nome, brand: e.brand, nome: e.sofia.nome || "Sofia", modelo: MODELOS.includes(e.sofia.modelo) ? e.sofia.modelo : MODELO_PADRAO,
      janelas: e.sofia.janelas || JANELAS_PADRAO, horario: e.horario || null, artes: Array.isArray(e.sofia.artes) ? e.sofia.artes.filter((a) => a && a.url && a.nome) : [], avisar: so(e.sofia.avisar || ""), alerta: so(e.sofia.alerta || ""), equipe: Array.isArray(e.barbers) ? e.barbers : [], nomesAB: (e.sofia && e.sofia.nomes) || {}, pausaMin: Math.max(15, Math.min(1440, Number(e.sofia.pausa) || 60)), parabens: (e.feedback && e.feedback.parabens) || "", aniversario: (e.aniversario && e.aniversario.texto) || "", planos: e.planos || null, notas: e.sofia.notas || "", upsell: Array.isArray(e.sofia.upsell) ? e.sofia.upsell : [], ab: e.appbarber };
    cfg = novo;
    aplicarMemoriasDoApp(e.memorias);
    if (abKey !== e.appbarber.appbarber_api_key + e.appbarber.codigo_estabelecimento) {
      abKey = e.appbarber.appbarber_api_key + e.appbarber.codigo_estabelecimento;
      ab = ferramentasAppBarber({ cfg: e.appbarber, ...(abReq ? { req: abReq } : {}), creditos: (n, zero) => api("POST", { company_id: e.company_id, acao: "ab_uso", creditos: n, ...(zero ? { sem_saldo: true } : {}) }).catch(() => {}) });
    }
    if (!process.env.ANTHROPIC_API_KEY) { if (Date.now() - statusEm > 3600000) await status("erro: falta a chave da Anthropic no servidor. No servidor, rode: gbia-sofia-chave"); return; }
    if (!client) {
      try { Anthropic = Anthropic || await carregarSDK(dir, log); client = new Anthropic({ maxRetries: 3, timeout: 90000 }); log(`Sofia ${SOFIA_VERSAO} pronta (${cfg.modelo}).`); }
      catch (err) { log("Sofia: não consegui carregar o SDK da Anthropic: " + err.message); if (Date.now() - statusEm > 3600000) await status("erro: não consegui instalar o SDK da Anthropic no servidor. Rode o instalador do WhatsApp de novo."); return; }
    }
    // Conversa parada há 1 hora entra no registro do relatório semanal; parada há 6 horas é esquecida.
    for (const [j, c] of conversas) {
      if (!c.ocupado && c.contada && !c.registrada && Date.now() - c.ultima > 3600000) registrar(c);
      if (Date.now() - c.ultima > 6 * 3600000 && !c.ocupado && !c.noturna) conversas.delete(j);
    }
    await relatorioDaSemana().catch((err) => log("Sofia: relatório semanal: " + err.message));
    for (const [j, t] of pausas) if (t < Date.now()) pausas.delete(j);
    // Conexão caiu ou voltou: atualiza o status na hora; senão, a cada 30 minutos.
    const con = !!conectado(); if (con !== ultimaCon) { ultimaCon = con; statusEm = 0; }
    if (Date.now() - statusEm > 30 * 60000) await status();
  }
  let ultimaCon = true;
  const ligada = () => !!(cfg && client);

  // ---- registro das conversas (30 dias) e relatório de domingo à noite ----
  const REG = join(dir, "sofia-registro.json"), REL = join(dir, "sofia-relatorio.json"), APRES = join(dir, "sofia-apresentados.json");
  // Clientes a quem a Sofia já se apresentou (só o telefone resumido, para sempre).
  let apresentados = null;
  const jaApresentou = (fone) => { if (!apresentados) apresentados = new Set(lerJ(APRES, [])); return !!fone && apresentados.has(chaveFone(fone)); };
  const marcarApresentou = (fone) => { if (!fone || jaApresentou(fone)) return; apresentados.add(chaveFone(fone)); try { writeFileSync(APRES, JSON.stringify([...apresentados])); } catch { /* tenta de novo na próxima */ } };
  const lerJ = (f, pad) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return pad; } };
  function registrar(c) {
    c.registrada = true; c.regId = c.regId || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const feitos = c.feitos || {}, fez = Object.values(feitos).some((v) => v > 0);
    const texto = transcricao(c.mensagens), semVaga = (texto.match(/não está mais livre/g) || []).length;
    const resultado = c.recepcao ? "recepcao" : c.humanoEm ? "recepcao_assumiu" : fez ? "resolvida" : "sem_resultado";
    const lim = new Date(Date.now() - 30 * 86400000).toISOString();
    const lista = lerJ(REG, []).filter((r) => r.em >= lim && r.id !== c.regId);
    lista.push({ id: c.regId, em: carimbo(c.inicio || c.ultima), fone4: c.fone ? c.fone.slice(-4) : "", resultado, motivo: c.motivo || "", feitos, semVaga, custo: Math.round((c.gasto || 0) * 10000) / 10000, texto: resultado === "resolvida" && !semVaga ? "" : texto });
    try { writeFileSync(REG, JSON.stringify(lista)); } catch (e) { log("Sofia: não gravei o registro: " + e.message); }
  }
  async function relatorioDaSemana(forcar = false) {
    const hoje = hojeSP(), est = lerJ(REL, {});
    if (!forcar && (diaSemanaSP() !== 0 || agoraSP() < 20 * 60 || est.ultimo === hoje)) return null;
    for (const c of conversas.values()) if (c.contada && !c.ocupado) registrar(c); // inclui as conversas de hoje
    est.ultimo = hoje; writeFileSync(REL, JSON.stringify(est));
    const rel = await gerarRelatorio({ client, modelo: cfg.modelo, registros: lerJ(REG, []), notas: cfg.notas, nome: cfg.nome, barbearia: cfg.barbearia, ate: hoje });
    await api("POST", { company_id: cfg.company_id, acao: "ia_report", relatorio: rel });
    log(`Sofia: relatório da semana gerado (${rel.sugestoes.length} sugestão(ões)).`);
    if (cfg.avisar && sock()) {
      const n = rel.numeros, sug = rel.sugestoes.length;
      const msg = `📊 Relatório semanal da ${cfg.nome} (${rel.semana.split(" a ").map((d) => d.split("-").reverse().slice(0, 2).join("/")).join(" a ")})\n\n${n.conversas} conversa(s) · ${n.agendamentos} agendamento(s) · ${n.remarcacoes} remarcação(ões) · ${n.cancelamentos} cancelamento(s) · ${n.recepcao} passada(s) para a recepção\n\n${rel.resumo}\n\n${sug ? `💡 ${sug} sugestão(ões) para aprovar no app: Integração › Atendente IA.` : "Nenhuma sugestão nova esta semana."}`;
      const d = so(cfg.avisar), cand = d.length <= 11 ? "55" + d : d;
      try { const [w] = await sock().onWhatsApp(cand); if (!w || !w.exists) throw new Error("número sem WhatsApp"); const r = await sock().sendMessage(w.jid, { text: msg }); marcarMinha(r && r.key && r.key.id); }
      catch (e) { log("Sofia: não avisei o relatório no WhatsApp: " + e.message); }
    }
    return rel;
  }

  // Mensagens enviadas por este programa (lembretes, respostas): não contam como "a recepção respondeu".
  function marcarMinha(id) { if (id) { minhas.add(id); if (minhas.size > 2000) minhas.delete(minhas.values().next().value); } }

  async function enviar(jid, t) {
    const s = sock(); if (!s) return;
    await s.presenceSubscribe(jid).catch(() => {});
    await s.sendPresenceUpdate("composing", jid).catch(() => {});
    await espera(Math.min(9000, 1500 + t.length * 35) + Math.random() * 1500); // "digitando…" proporcional ao tamanho
    await s.sendPresenceUpdate("paused", jid).catch(() => {});
    const r = await s.sendMessage(jid, { text: t });
    const id = r && r.key && r.key.id;
    marcarMinha(id); if (id) { daSofia.add(id); if (daSofia.size > 2000) daSofia.delete(daSofia.values().next().value); }
  }
  // Aviso no WhatsApp de alguém da equipe (Integração › Atendente IA › WhatsApp para avisos urgentes).
  async function alertaEquipe(c, t) {
    const s = sock(); if (!s || !cfg || !cfg.alerta) return;
    const d = cfg.alerta, cand = d.length <= 11 ? "55" + d : d, f = String(c.fone || "");
    const quem = `${c.nome || c.pushName || "Cliente"}${f ? ` (+${f.slice(0, 2)} ${f.slice(2, 4)} ${f.slice(4, -4)}-${f.slice(-4)})` : ""}`;
    try {
      const [w] = await s.onWhatsApp(cand); if (!w || !w.exists) throw new Error("número de avisos sem WhatsApp");
      const r = await s.sendMessage(w.jid, { text: `${cfg.nome} · ${quem}\n${t}` }); marcarMinha(r && r.key && r.key.id);
    } catch (e) { log("Sofia: aviso para a equipe não enviado: " + e.message); }
  }
  // WhatsApp do profissional (cadastro do Gestão), pelo nome que vem da AppBarber.
  const normN = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  // Memória do cliente: grava no servidor e manda uma cópia para o app (sem o telefone).
  function enviarMemoria(k, m) { if (!cfg || !api) return; api("POST", { company_id: cfg.company_id, acao: "ia_memoria", chave: k, nome: m.nome || "", fone4: m.fone4 || "", notas: m.notas || [] }).catch((e) => log("Memória: não enviei ao app (" + e.message + ")")); }
  function guardarMemoria(c, t) {
    if (!c.fone) return; const k = chaveMemoria(c.fone), todas = lerMemorias(dir), m = todas[k] || { notas: [] };
    if (m.notas.some((n) => semAcentoP(n.t) === semAcentoP(t))) return;
    m.notas.push({ t, em: hojeSP() }); m.notas = m.notas.slice(-10); m.nome = c.nome || m.nome || c.pushName || ""; m.fone4 = String(c.fone).slice(-4);
    todas[k] = m; gravarMemorias(dir, todas); enviarMemoria(k, m); log(`Sofia: (…${m.fone4}) memória: ${t}`);
  }
  function apagarMemoria(c) {
    if (!c.fone) return; const k = chaveMemoria(c.fone), todas = lerMemorias(dir);
    todas[k] = { notas: [], nome: "", fone4: String(c.fone).slice(-4) }; gravarMemorias(dir, todas); enviarMemoria(k, todas[k]);
  }
  // Correções feitas no app (editar ou apagar) chegam pela configuração e valem sobre o arquivo do servidor.
  function aplicarMemoriasDoApp(lista) {
    if (!Array.isArray(lista) || !lista.length) return;
    const todas = lerMemorias(dir); let mudou = false;
    for (const x of lista) {
      if (!x || !x.chave) continue; const m = todas[x.chave] || { notas: [] };
      if (m.appEm && m.appEm >= x.em) continue;
      todas[x.chave] = { ...m, notas: Array.isArray(x.notas) ? x.notas.filter((n) => n && n.t && !SENSIVEL.test(n.t)).slice(-10) : [], appEm: x.em }; mudou = true;
    }
    if (mudou) gravarMemorias(dir, todas);
  }
  function barbeiroDoAB(nomeAB) {
    const eq = (cfg && cfg.equipe) || [], alvo = normN((cfg && cfg.nomesAB && cfg.nomesAB[nomeAB]) || nomeAB);
    if (!alvo) return null;
    let b = eq.find((x) => normN(x.name) === alvo);
    if (!b) { const pn = alvo.split(" ")[0], achados = eq.filter((x) => normN(x.name).split(" ")[0] === pn); if (achados.length === 1) b = achados[0]; }
    if (!b && alvo.includes(" ")) { const sn = alvo.split(" ").at(-1), achados = eq.filter((x) => normN(x.name).split(" ").at(-1) === sn); if (achados.length === 1) b = achados[0]; }
    return b || null;
  }
  // Atendimentos marcados por profissional num dia (agendados + realizados), guardado por 5 minutos.
  const cargaCache = new Map();
  async function cargaDoDia(data) {
    const c = cargaCache.get(data); if (c && Date.now() - c.em < 300000) return c.m;
    const m = new Map();
    for (const st of ["1", "2"]) for (const a of await ab.agenda(data, data, st)) { const n = a.employee_name || ""; if (n) m.set(n, (m.get(n) || 0) + 1); }
    cargaCache.set(data, { em: Date.now(), m }); if (cargaCache.size > 20) cargaCache.delete(cargaCache.keys().next().value);
    return m;
  }
  function foneProfissional(nomeAB) {
    const eq = (cfg && cfg.equipe) || [], alvo = normN((cfg && cfg.nomesAB && cfg.nomesAB[nomeAB]) || nomeAB);
    if (!alvo) return null;
    let b = eq.find((x) => normN(x.name) === alvo);
    if (!b) { const pn = alvo.split(" ")[0], achados = eq.filter((x) => normN(x.name).split(" ")[0] === pn); if (achados.length === 1) b = achados[0]; }
    // Ex.: "Izaquias Macedo" na AppBarber e "Izaque Macedo" no Gestão: o sobrenome resolve quando só um bate.
    if (!b && alvo.includes(" ")) { const sn = alvo.split(" ").at(-1), achados = eq.filter((x) => normN(x.name).split(" ").at(-1) === sn); if (achados.length === 1) b = achados[0]; }
    return b && b.phone ? { nome: b.name, fone: so(b.phone) } : (b ? { nome: b.name, fone: "" } : null);
  }
  async function avisarProfissional(c, nomeAB, t) {
    const s = sock(); if (!s || !cfg) return;
    const p = foneProfissional(nomeAB);
    if (!p || !p.fone) { await alertaEquipe(c, `${t}\n(não achei o WhatsApp de ${nomeAB || "o profissional"} no Gestão para avisar direto)`); return; }
    try {
      const cand = p.fone.length <= 11 ? "55" + p.fone : p.fone, [w] = await s.onWhatsApp(cand); if (!w || !w.exists) throw new Error("profissional sem WhatsApp");
      const r = await s.sendMessage(w.jid, { text: `${cfg.nome} · ${cfg.barbearia}\n${t}` }); marcarMinha(r && r.key && r.key.id);
      log(`Sofia: avisou ${p.nome.split(" ")[0]}.`);
    } catch (e) { log("Sofia: aviso ao profissional não enviado: " + e.message); await alertaEquipe(c, t); }
  }
  async function enviarArte(jid, a) {
    const s = sock(); if (!s) throw new Error("WhatsApp desconectado");
    await s.presenceSubscribe(jid).catch(() => {});
    await s.sendPresenceUpdate("composing", jid).catch(() => {});
    await espera(2000 + Math.random() * 1500);
    const r = await s.sendMessage(jid, { image: { url: a.url } });
    const id = r && r.key && r.key.id;
    marcarMinha(id); if (id) daSofia.add(id);
    log(`Sofia: enviou a arte "${a.nome}".`);
  }
  // Retorno de 15 minutos (ex.: depois da arte dos planos): só se o cliente não respondeu, ninguém da recepção entrou
  // e ainda é um horário razoável (7h às 22h30).
  async function retornos() {
    if (!ligada()) return;
    for (const [jid, c] of conversas) {
      const rt = c.retorno; if (!rt) continue;
      if ((c.ultimaCliente || 0) > rt.em || c.humanoEm > rt.em || c.recepcao || c.ocupado || (pausas.get(jid) || 0) > Date.now()) { c.retorno = null; continue; }
      if (Date.now() - rt.em < 15 * 60000) continue;
      c.retorno = null;
      if (agoraSP() < 7 * 60 || agoraSP() > 22 * 60 + 30) continue;
      const t = limpaNome(String(rt.arte.retorno).replace(/\{cliente\}/g, primeiroNome(c.nome || c.pushName)));
      try { await enviar(jid, t); c.ultimaSofia = Date.now(); anotar(c, `Você (${cfg.nome}) mandou, porque o cliente não respondeu em 15 minutos`, t); }
      catch (e) { log("Sofia: retorno não enviado: " + e.message); }
    }
  }
  // Às 7h (ou no próximo horário dela), responde em ordem quem escreveu com a barbearia fechada.
  let respondendoFila = false;
  // Mensagens "recentes" sem resposta há mais de 30 minutos ficam para a recepção (viram só contexto).
  function limparPendentes() {
    for (const [j, c] of conversas) {
      if (!c.noturna && !c.ocupado && Date.now() - c.ultima > 6 * 3600000) { conversas.delete(j); continue; } // memória: esquece conversas paradas
      if (c.noturna && c.pendTipo === "recente" && !c.ocupado && Date.now() - (c.ultimaCliente || c.noturna) > PEND_MIN * 60000) {
        for (const f of c.fila.splice(0)) anotar(c, "Cliente", f); c.noturna = 0; c.pendTipo = null;
      }
    }
  }
  async function filaDaNoite() {
    limparPendentes();
    if (!ligada() || respondendoFila || noSilencio() || !dentroDaJanela(cfg.janelas)) return;
    const fila = [...conversas.entries()].filter(([, c]) => c.noturna && c.fila.length).sort((a, b) => a[1].noturna - b[1].noturna);
    if (!fila.length) return;
    respondendoFila = true;
    try {
      log(`Sofia: respondendo ${fila.length} conversa(s) que estavam esperando resposta.`);
      for (const [i, [jid, c]] of fila.entries()) {
        if (Date.now() - c.noturna > 36 * 3600000) { for (const f of c.fila.splice(0)) anotar(c, "Cliente", f); c.noturna = 0; continue; } // muito antiga: fica para a recepção
        await processar(jid).catch(() => {});
        if (i < fila.length - 1) await espera(20000 + Math.random() * 20000); // uma de cada vez, com intervalo
      }
    } finally { respondendoFila = false; }
  }
  // ---- Lista de espera: guardada no servidor; a cada 30 min (8h–20h) confere se abriu vaga e avisa o cliente ----
  const ESPERA = join(dir, "sofia-espera.json");
  const lerEspera = () => { try { return JSON.parse(readFileSync(ESPERA, "utf8")); } catch { return []; } };
  const gravarEspera = (l) => { try { writeFileSync(ESPERA, JSON.stringify(l), { mode: 0o600 }); } catch (e) { log("Sofia: lista de espera não gravada: " + e.message); } };
  function listaEspera(jid, c, x) {
    let l = lerEspera(); const k = chaveFone(c.fone || jid);
    if (x.sair) { const antes = l.length; l = l.filter((e) => !(e.chave === k && (!x.data || e.data === x.data))); gravarEspera(l); return antes - l.length; }
    l = l.filter((e) => !(e.chave === k && e.data === x.data));
    l.push({ id: `${Date.now()}${Math.random().toString(36).slice(2, 6)}`, jid, fone: c.fone || "", chave: k, nome: c.nome || c.pushName || "", data: x.data, servicos: x.servicos, profissional: x.profissional, de: x.de, ate: x.ate, criado: Date.now(), avisos: [] });
    gravarEspera(l); log(`Sofia: lista de espera (${x.data} ${x.de}–${x.ate}).`);
    return 1;
  }
  let esperaEm = 0;
  async function verificarEspera() {
    if (!ligada() || Date.now() - esperaEm < 30 * 60000) return;
    const agora = agoraSP(); if (agora < 8 * 60 || agora > 20 * 60) return;
    esperaEm = Date.now();
    const hoje = hojeSP();
    let l = lerEspera().filter((e) => e.data > hoje || (e.data === hoje && mins(e.ate) > agora + 15)); // vencidas saem
    const grupos = new Map(); for (const e of l) { const g = `${e.data}|${e.servicos[0].codigo}`; (grupos.get(g) || grupos.set(g, []).get(g)).push(e); }
    for (const [g, lista] of grupos) {
      const [data, serv] = g.split("|");
      let prof; try { prof = await ab.horarios(data, serv); } catch (e) { log("Sofia: lista de espera, não consegui ver a agenda: " + e.message); continue; }
      for (const e of lista.sort((a, b) => a.criado - b.criado)) { // por ordem de chegada
        if (e.avisos.length >= 3 || (pausas.get(e.jid) || 0) > Date.now()) continue; // no máximo 3 avisos; recepção na conversa: espera
        const ok = [];
        for (const p of prof) {
          if (e.profissional) { const q = String(e.profissional).toLowerCase(); if (!p.nome.toLowerCase().includes(q.split(" ")[0]) && !q.includes(p.nome.toLowerCase().split(" ")[0])) continue; }
          for (const h of p.horarios) if (h >= e.de && h <= e.ate && (data > hoje || mins(h) > agora + 30)) ok.push({ h, p });
        }
        ok.sort((a, b) => a.h.localeCompare(b.h));
        const vaga = ok.find((v) => !e.avisos.includes(`${v.h}|${v.p.codigo}`)); if (!vaga) continue;
        const d = new Date(data + "T12:00:00Z"), dia = data === hoje ? "hoje" : `${DIAS[d.getUTCDay()]}, ${data.split("-").reverse().slice(0, 2).join("/")}`;
        const nome = primeiroNome(e.nome);
        const texto = `Oi${nome ? ", " + nome : ""}! 😊 Boa notícia: abriu um horário ${dia} às ${vaga.h.replace(":", "h")} com ${vaga.p.nome} para ${e.servicos.map((s) => s.nome).join(" + ")}, que você estava esperando. Quer que eu marque pra você? É por ordem de resposta, tá?`;
        try {
          await enviar(e.jid, texto);
          const c = obter(e.jid, null); if (!c.fone) c.fone = e.fone; if (!c.nome && e.nome) c.nome = e.nome;
          anotar(c, `Você (${cfg.nome}) mandou, pela lista de espera`, `${texto} [vaga: ${data} ${vaga.h}, profissional código ${vaga.p.codigo} (${vaga.p.nome}), serviços ${e.servicos.map((s) => s.codigo).join(", ")}]`);
          c.ultimaSofia = Date.now(); c.esperaAte = Date.now() + 3600000; c.recepcao = false;
          e.avisos.push(`${vaga.h}|${vaga.p.codigo}`); log(`Sofia: avisou vaga da lista de espera (${data} ${vaga.h}).`);
        } catch (err) { log("Sofia: aviso da lista de espera não enviado: " + err.message); }
      }
    }
    gravarEspera(l);
  }
  setInterval(() => { retornos().catch(() => {}); filaDaNoite().catch(() => {}); verificarEspera().catch(() => {}); salvarConversas(true); }, 60000).unref();
  // Conversa deste contato (cria se não houver ou se estiver parada há mais de 6 horas).
  function obter(jid, msg) {
    let c = conversas.get(jid);
    // O WhatsApp às vezes identifica o mesmo cliente por dois endereços (o número ou um código interno "@lid").
    // Ex.: o convite do retorno sai pelo número e a resposta chega pelo código. Se já há conversa recente com
    // esse telefone em outro endereço, ela passa a ser esta (com o contexto, o horário sugerido e a espera).
    if (!c && msg && msg.key) {
      const f = foneDe(msg), k = f && chaveFone(f);
      if (k) for (const [j2, c2] of conversas) if (j2 !== jid && c2.fone && chaveFone(c2.fone) === k && (Date.now() - c2.ultima < 6 * 3600000 || c2.noturna)) {
        conversas.delete(j2); conversas.set(jid, c2); c = c2;
        if (pausas.has(j2)) { pausas.set(jid, pausas.get(j2)); pausas.delete(j2); }
        break;
      }
    }
    if (!c || (Date.now() - c.ultima > 6 * 3600000 && !c.noturna)) {
      c = { mensagens: [], inicio: Date.now(), ultima: Date.now(), ultimaSofia: 0, humanoEm: 0, contexto: [], contada: false, nome: "", agenda: null, recepcao: false, fone: "", fila: [], ocupado: false };
      conversas.set(jid, c);
    }
    if (!c.fone && msg && !msg.key.fromMe) c.fone = foneDe(msg);
    return c;
  }
  // O que foi conversado sem a Sofia (cliente com a recepção, lembretes automáticos): ela lê quando voltar.
  function anotar(c, quem, t) { if (t && typeof t === "object") t = "[mandou um áudio]"; if (!t) return; c.contexto.push({ ts: Date.now(), linha: `${quem}: ${t.slice(0, 600)}` }); if (c.contexto.length > 40) c.contexto.splice(0, c.contexto.length - 40); }

  // Créditos da Anthropic acabaram: ela para (sem mandar erro para o cliente), a conversa fica para a recepção como
  // não lida, e o dono recebe UM aviso para recarregar. Tenta de novo a cada 30 minutos.
  let semCreditoAte = 0, avisoCreditoEm = 0;
  const ehSemCredito = (m) => /credit balance is too low|plans? & billing|purchase credits|insufficient (credit|fund|balance)/i.test(String(m || ""));
  async function paraRecepcao(jid, c) {
    for (const f of c.fila.splice(0)) anotar(c, "Cliente", f);
    c.recepcao = true; c.recepcaoEm = Date.now(); c.motivo = "sem créditos da IA"; c.noturna = 0; c.pendTipo = null;
    try { await sock().chatModify({ markRead: false, lastMessages: [c.ultimaMsg].filter(Boolean) }, jid); } catch { /* não deu para marcar como não lida */ }
  }
  async function avisarSemCredito() {
    if (Date.now() - avisoCreditoEm < 6 * 3600000) return; avisoCreditoEm = Date.now();
    const t = `⚠️ Os créditos da IA da ${cfg.nome} (Anthropic) acabaram.\n\nEla parou de responder: as conversas dos clientes ficam com a recepção, marcadas como não lidas.\n\nPara ela voltar: console.anthropic.com › Plans & Billing › Buy credits (dica: ligue o Auto-reload). Depois da recarga, ela volta sozinha em até 30 minutos.`;
    const s = sock(); if (!s) return;
    for (const n of [...new Set([cfg.avisar, cfg.alerta].filter(Boolean))]) {
      try { const cand = n.length <= 11 ? "55" + n : n, [w] = await s.onWhatsApp(cand); if (!w || !w.exists) continue; const r = await s.sendMessage(w.jid, { text: t }); marcarMinha(r && r.key && r.key.id); }
      catch (e) { log("Sofia: aviso de créditos não enviado: " + e.message); }
    }
    log("Sofia: créditos da Anthropic acabaram; avisei o dono.");
  }
  async function processar(jid) {
    const c = conversas.get(jid);
    if (!c || c.ocupado || !c.fila.length) return;
    c.ocupado = true;
    if (semCreditoAte > Date.now()) { try { await paraRecepcao(jid, c); } finally { c.ocupado = false; salvarConversas(); } return; }
    try {
      while (c.fila.length) {
        // Áudios da fila viram texto aqui (só os que a Sofia vai responder; os que ficam com a recepção não gastam).
        const novas = await Promise.all(c.fila.splice(0).map(async (f) => {
          if (typeof f === "string") return f;
          const seg = Number((f.audio.message.audioMessage || {}).seconds) || 0;
          if (!process.env.OPENAI_API_KEY || !baixarMidia) return "[o cliente mandou um(a) áudio]";
          if (seg > 300) return "[o cliente mandou um áudio longo (mais de 5 min), que não foi transcrito: peça um resumo por escrito]";
          try {
            const tx = await transcrever(await baixarMidia(f.audio));
            stats.gasto += (Math.max(seg, 1) / 60) * PRECO_AUDIO_MIN; c.gasto = (c.gasto || 0) + (Math.max(seg, 1) / 60) * PRECO_AUDIO_MIN;
            return tx ? `[áudio do cliente, transcrito] ${tx}` : "[o cliente mandou um(a) áudio]";
          } catch (e) { log("Sofia: áudio não transcrito: " + e.message); return "[o cliente mandou um(a) áudio]"; }
        }));
        // Resposta a lembrete do tipo "Boa tarde" + "Confirmado": não é conversa, ninguém responde.
        const emConversa = c.ultimaSofia && Date.now() - c.ultimaSofia < 20 * 60000;
        if (!emConversa && soCumprimentoEConfirmacao(novas)) { for (const f of novas) anotar(c, "Cliente", f); c.noturna = 0; c.pendTipo = null; continue; }
        if (c.recepcao || (pausas.get(jid) || 0) > Date.now()) return;
        // Mensagens que chegaram com a barbearia fechada (ex.: de madrugada): ela responde agora, avisando que viu.
        if (c.noturna) {
          const ontem = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(c.noturna)) !== hojeSP();
          const hora = new Date(c.noturna).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
          novas.unshift(c.pendTipo === "recente"
            ? `[O cliente escreveu a partir das ${hora} e ainda não tinha sido respondido. Peça desculpas pela demora de forma leve e simpática e responda tudo o que ele pediu nessas mensagens.]`
            : `[O cliente escreveu ${ontem ? "ontem" : "hoje"} a partir das ${hora}, com a barbearia fechada, e só agora você está respondendo. Cumprimente de acordo com a hora atual (ex.: "Bom dia!"), diga com simpatia que viu a mensagem dele e responda tudo o que ele pediu.]`);
          c.noturna = 0; c.pendTipo = null;
        }
        const antes = c.contexto.splice(0).sort((a, b) => a.ts - b.ts).map((x) => x.linha);
        const cadLinha = c.verificado ? "" : (c.verificado = true, (await verificarCadastro(ab, c.fone, c)) + "\n" + (c.fone ? costumeLinha(dir, c.fone) + memoriaLinha(dir, c.fone) : "") + (c.plano ? "" : dicaPlano({ dir, fone: c.fone, planosCfg: cfg.planos })) + (jaApresentou(c.fone)
          ? "[Apresentação: você já se apresentou a este cliente em outra conversa; não se apresente de novo]\n"
          : `[Apresentação: é a primeira vez que você fala com este cliente; na sua resposta, apresente-se em uma frase curta e simpática (ex.: "Eu sou a ${cfg.nome}, atendente da ${cfg.barbearia} 😊")]\n`));
        const naoEnviada = c.naoEnviada ? "[Sua resposta anterior NÃO foi enviada, porque o cliente mandou mais mensagens enquanto você respondia. Responda agora considerando tudo.]\n" : ""; c.naoEnviada = false;
        c.mensagens.push({ role: "user", content: agoraTexto(c.fone) + "\n" + cadLinha + naoEnviada + (antes.length
          ? `[Para contexto: mensagens desta conversa enquanto você não estava atendendo]\n${antes.join("\n")}\n\n[Mensagem nova do cliente]\n${novas.join("\n")}`
          : novas.join("\n")) });
        if (!c.contada) { c.contada = true; zera(); stats.conversas++; if (resultados) resultados.evento(cfg.company_id, { tipo: "conversa", origem: c.origem || "whatsapp" }); }
        if (!c.artes) c.artes = cfg.artes; // congeladas junto com as instruções
        const ctx = { ab, fone: c.fone, stats, simular: false, evento: (ev) => ev && resultados && cfg && resultados.evento(cfg.company_id, { origem: c.origem || "whatsapp", ...ev }), lembrar: (t) => guardarMemoria(c, t), esquecer: () => apagarMemoria(c), carga: cargaDoDia, fidelizacao: (n) => { const b = barbeiroDoAB(n); return b && Number.isFinite(b.fid) ? b.fid : null; }, parabens: cfg.parabens || "", equipe: [...(cfg.equipe || []).map((b) => b.name), cfg.barbearia].filter(Boolean), /* o dono costuma ter o nome da barbearia */ artes: c.artes, enviarArte: (a) => enviarArte(jid, a), registro: (t) => log(`Sofia: ${t}.`),
          falha: (t) => { log(`Sofia: (…${String(c.fone).slice(-4)}) ${t}`); pendencias.push(`(${c.fone ? "…" + c.fone.slice(-4) : "sem fone"}) ${t}`); status().catch(() => {}); },
          listaEspera: (x) => listaEspera(jid, c, x), alertar: (t) => alertaEquipe(c, t), avisarProfissional: (nome, t) => avisarProfissional(c, nome, t), pendencia: (t) => { c.motivo = t; pendencias.push(`${c.nome ? c.nome.split(" ")[0] + " " : ""}(${c.fone ? "…" + c.fone.slice(-4) : "sem fone"}) ${t}`); } };
        const antesStats = { agendou: stats.agendados, remarcou: stats.remarcados, cancelou: stats.cancelados };
        const artesAntes = (c.artesEnviadas || []).length;
        // Instruções congeladas no começo da conversa (mudanças no app valem para as próximas conversas).
        // Instruções fixas durante a conversa (cache), mas atualizadas se mudarem (nova versão, preços, ofertas, nome):
        // uma conversa que começou antes de uma atualização passa a seguir as regras novas na próxima resposta.
        const atual = promptSistema({ nome: cfg.nome, barbearia: cfg.barbearia, notas: cfg.notas, brand: cfg.brand, artes: c.artes, horario: cfg.horario, upsell: cfg.upsell, equipe: (cfg.equipe || []).map((b) => b.name).filter(Boolean), aniversario: cfg.aniversario || "" });
        if (c.sistema !== atual) c.sistema = atual;
        const sistema = c.sistema;
        const r = await rodada({ client, modelo: cfg.modelo, sistema, conv: c, ctx });
        stats.gasto += r.gasto; c.gasto = (c.gasto || 0) + r.gasto; c.registrada = false;
        if (resultados && r.gasto > 0) resultados.evento(cfg.company_id, { tipo: "uso", valor: Math.round(r.gasto * 10000) / 10000, origem: c.origem || "whatsapp" });
        c.feitos = c.feitos || {}; for (const [k, v] of Object.entries({ agendou: stats.agendados, remarcou: stats.remarcados, cancelou: stats.cancelados })) c.feitos[k] = (c.feitos[k] || 0) + Math.max(0, v - antesStats[k]);
        if ((pausas.get(jid) || 0) > Date.now()) return; // a recepção entrou enquanto a IA pensava
        // O cliente mandou mais mensagens enquanto ela pensava e nada foi feito na agenda: não manda esta resposta
        // (a próxima já considera tudo), para não sair duas respostas seguidas.
        const agiu = stats.agendados + stats.remarcados + stats.cancelados > antesStats.agendou + antesStats.remarcou + antesStats.cancelou || (c.artesEnviadas || []).length > artesAntes;
        if (r.texto && c.fila.length && !agiu && !c.recepcao) { c.naoEnviada = true; continue; }
        if (r.texto) { await enviar(jid, r.texto); c.ultimaSofia = Date.now(); marcarApresentou(c.fone); }
        // Arte com retorno: se o cliente não responder em 15 minutos, ela pergunta de novo (uma vez).
        if (c.retornoPendente) { c.retorno = { em: Date.now(), arte: c.retornoPendente }; c.retornoPendente = null; }
        if (c.recepcao) { try { await sock().chatModify({ markRead: false, lastMessages: [c.ultimaMsg].filter(Boolean) }, jid); } catch { /* não deu para marcar como não lida */ } await status(); }
        c.ultima = Date.now();
      }
    } catch (err) {
      if (ehSemCredito(err.message)) {
        semCreditoAte = Date.now() + 30 * 60000;
        log("Sofia: sem créditos da Anthropic; conversa fica para a recepção.");
        await paraRecepcao(jid, c); stats.recepcao++;
        await status(`erro: ${new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })} · os créditos da IA (Anthropic) acabaram: recarregue em console.anthropic.com › Plans & Billing. Enquanto isso, as conversas ficam com a recepção.`);
        await avisarSemCredito();
        return;
      }
      log("Sofia: erro na conversa: " + err.message);
      c.recepcao = true; c.motivo = "erro: " + String(err.message).slice(0, 120); stats.recepcao++; pendencias.push(`(${c.fone ? "…" + c.fone.slice(-4) : "sem fone"}) a Sofia teve um erro e parou nesta conversa`);
      await status(`erro: ${new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })} · ${String(err.message).slice(0, 200)}. A conversa ficou para a recepção.`);
      // O cliente não pode ficar sem resposta: avisa que a equipe continua e chama a equipe.
      try { await enviar(jid, "Desculpa, tive um probleminha aqui agora 😕 Já chamei a nossa equipe, que vai continuar com você por aqui em instantes."); } catch { /* sem conexão */ }
      alertaEquipe(c, `⚠️ A ${cfg ? cfg.nome : "Sofia"} teve um erro e parou nesta conversa: responda o cliente. (${String(err.message).slice(0, 120)})`).catch(() => {});
    } finally { c.ocupado = false; if (c.recepcao && !c.recepcaoEm) c.recepcaoEm = Date.now(); salvarConversas(); }
  }

  // Chamado a cada messages.upsert do WhatsApp dos clientes.
  // Guarda as mensagens mesmo com a Sofia desligada ou fora do horário dela: ao ligar (ou quando começa o horário),
  // ela responde quem escreveu nos últimos 30 minutos e ainda está sem resposta.
  const PEND_MIN = 30;
  const vistas = new Set(); // ids já tratados: a mesma mensagem nunca é processada duas vezes
  async function aoReceber(m) {
    try { await aoReceber2(m); } finally { salvarConversas(); }
  }
  async function aoReceber2(m) {
    for (const msg of m.messages || []) {
      const jid = msg.key && msg.key.remoteJid;
      const idv = msg.key && msg.key.id && `${jid}|${msg.key.id}`;
      if (idv) { if (vistas.has(idv)) continue; vistas.add(idv); if (vistas.size > 5000) vistas.delete(vistas.values().next().value); }
      if (!jid || !/@(s\.whatsapp\.net|lid)$/.test(jid)) continue; // ignora grupos, status e canais
      const ts = Number(msg.messageTimestamp && msg.messageTimestamp.low !== undefined ? msg.messageTimestamp.low : msg.messageTimestamp) || 0;
      if (ts && Date.now() / 1000 - ts > 600) continue; // mensagens antigas (reconexão, histórico) não contam
      const t = texto(msg), md = midia(msg), conteudo = t || (md ? `[mandou um(a) ${md}]` : "");
      if (msg.key.fromMe) {
        // Mensagem do próprio número. Respostas da Sofia já estão na conversa; lembretes automáticos viram contexto;
        // qualquer outra foi a recepção pelo celular → a Sofia sai da conversa por um tempo e guarda o que foi dito.
        const id = msg.key.id;
        setTimeout(() => {
          if (daSofia.has(id) || !conteudo) return;
          const c = obter(jid, msg); c.ultima = Date.now();
          if (minhas.has(id)) { anotar(c, "Mensagem automática da barbearia", conteudo); return; }
          pausas.set(jid, Date.now() + (cfg ? cfg.pausaMin : 60) * 60000); c.humanoEm = Date.now();
          for (const f of c.fila.splice(0)) anotar(c, "Cliente", f); // o que estava esperando, a recepção já está respondendo
          c.noturna = 0; c.pendTipo = null;
          anotar(c, "Recepção", conteudo);
        }, 2500);
        continue;
      }
      if (m.type !== "notify" || !conteudo) continue;
      const c = obter(jid, msg); c.ultima = Date.now(); c.ultimaMsg = msg; c.ultimaCliente = Date.now();
      if (msg.pushName && !c.pushName) c.pushName = msg.pushName;
      // Sem atender agora (desligada, recepção na conversa ou fora do horário): guarda para contexto.
      // Conversa nova só começa dentro do horário; a que a Sofia está atendendo continua até ficar 20 min parada.
      const continua = (c.ultimaSofia && Date.now() - c.ultimaSofia < 20 * 60000 && c.humanoEm < c.ultimaSofia) || (c.esperaAte && c.esperaAte > Date.now() && c.humanoEm < (c.esperaDe || c.esperaAte - 3600000));
      const msgCli = t || (md === "áudio" ? { audio: msg } : `[o cliente mandou um(a) ${md}]`);
      // "👍", "ok", "obrigado" ou figurinha em resposta a um lembrete/mensagem automática: não é conversa, ninguém responde.
      if (!continua && !c.fila.length && ((t && soConfirmacao(t)) || (!t && /figurinha/.test(md)))) { anotar(c, "Cliente", conteudo); continue; }
      // Conversa que ficou com a recepção: se a equipe não fala nela há 2 horas (ou há 30 minutos, quando foi um erro da
      // IA e ninguém da equipe respondeu) e o cliente escreve de novo, ela volta a atender (a conversa não fica sem resposta).
      if (c.recepcao && !((pausas.get(jid) || 0) > Date.now())) {
        const desde = Math.max(c.humanoEm || 0, c.recepcaoEm || 0), erro = /^erro/.test(String(c.motivo || "")) && !(c.humanoEm > (c.recepcaoEm || 0));
        if (desde && Date.now() - desde > (erro ? 30 : 120) * 60000) { c.recepcao = false; c.recepcaoEm = 0; c.motivo = ""; log(`Sofia: (…${String(c.fone || "").slice(-4)}) voltou a atender: a conversa estava com a recepção sem resposta da equipe.`); }
      }
      if (c.recepcao || (pausas.get(jid) || 0) > Date.now()) { anotar(c, "Cliente", conteudo); continue; }
      // Desligada: guarda; se ela for ligada em até 30 minutos (e ninguém tiver respondido), ela responde.
      if (!ligada()) { c.fila.push(msgCli); if (!c.noturna) { c.noturna = Date.now(); c.pendTipo = "recente"; } clearTimeout(c.timer); continue; }
      // Noite (22h–7h): ninguém responde; a mensagem fica para a Sofia responder às 7h.
      // Fora do horário dela com a barbearia fechada (ex.: domingo à tarde): fica para o próximo horário dela.
      // Uma conversa em andamento pode seguir até 22h30.
      const guardar = noSilencio(agoraSP(), continua ? 30 : 0) || (!dentroDaJanela(cfg.janelas) && !continua && barbeariaFechada(cfg.horario));
      if (guardar) { c.fila.push(msgCli); if (!c.noturna) c.noturna = Date.now(); c.pendTipo = "noite"; clearTimeout(c.timer); continue; }
      // Fora do horário dela com a barbearia aberta: é da recepção; se ninguém responder, quando começar o horário
      // dela (em até 30 minutos da última mensagem) ela responde.
      if (!dentroDaJanela(cfg.janelas) && !continua) { c.fila.push(msgCli); if (!c.noturna) { c.noturna = Date.now(); c.pendTipo = "recente"; } clearTimeout(c.timer); continue; }
      c.fila.push(msgCli);
      // Espera o cliente terminar de escrever (várias mensagens seguidas viram uma só).
      // "Pode sim", "sim", "claro"… sozinho costuma vir antes do dado pedido (ex.: a data de nascimento na mensagem seguinte):
      // espera um pouco mais para responder tudo junto, sem perguntar o que ele já está mandando.
      const soSim = typeof msgCli === "string" && /^(pode(\s+sim)?|sim|claro|ok|okay|beleza|blz|pode ser|bora|com certeza|isso)[\s!.,😊🙂👍]*$/i.test(msgCli.trim());
      clearTimeout(c.timer); c.timer = setTimeout(() => processar(jid).catch(() => {}), soSim && c.fila.length === 1 ? 16000 : 7000);
    }
  }

  // Convite do "retorno no tempo certo" enviado: a Sofia fica sabendo do horário sugerido e, se a Sofia estiver ligada,
  // responde o cliente nas próximas 3 horas (se a recepção entrar na conversa, ela sai como sempre).
  // Convite automático enviado (retorno no tempo certo, reconquista): a Sophia fica sabendo do convite e, ligada,
  // responde o cliente nas próximas horas, mesmo fora do horário dela (se a recepção entrar na conversa, ela sai).
  function conviteEnviado(jid, id, { fone = "", nome = "", texto = "", detalhe = "", tipo = "convite de retorno: o cliente costuma voltar nesse prazo", horas = 3, origem = "retorno" } = {}) {
    if (id) daSofia.add(id);
    const c = obter(jid, null); c.origem = origem;
    if (resultados && cfg) resultados.evento(cfg.company_id, { tipo: "convite", origem }); if (!c.fone && fone) c.fone = fone; if (!c.pushName && nome) c.pushName = nome;
    anotar(c, `Mensagem automática da barbearia (${tipo})`, `${texto} ${detalhe}`.trim());
    c.ultima = Date.now();
    if (ligada()) { c.esperaDe = Date.now(); c.esperaAte = Date.now() + horas * 3600000; c.recepcao = false; }
  }
  const retornoEnviado = (jid, id, x) => conviteEnviado(jid, id, x);
  // O cliente escreveu nesta conversa depois de `desde` (ms)?
  const respondeu = (jid, desde) => ((conversas.get(jid) || {}).ultimaCliente || 0) > desde;

  return { configurar, aoReceber, marcarMinha, ligada, relatorioDaSemana, retornoEnviado, conviteEnviado, respondeu, salvar: () => salvarConversas(true), ativaAgora: () => !!(cfg && client && dentroDaJanela(cfg.janelas)), status };
}

// ---------- retorno no tempo certo ----------
// O sistema aprende, pela agenda da AppBarber, de quantos em quantos dias cada cliente volta (mediana dos últimos
// intervalos), o dia da semana, o horário e o profissional de costume. Um dia depois do prazo dele, se ainda não marcou,
// recebe um convite com um horário livre no dia e horário de costume, com o profissional de sempre.
// Padrão: o convite sai 2 dias ANTES do prazo e sugere um horário no próprio dia do prazo (no dia da semana de costume),
// para o ciclo dele não atrasar uma semana e ainda haver vaga com o profissional dele.
const mediana = (l) => { const s = [...l].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// Mais frequente; no empate, o mais recente (a lista vem em ordem de data).
const moda = (l) => { const n = new Map(); for (const x of l) n.set(x, (n.get(x) || 0) + 1); let best = null, c = 0; for (let i = l.length - 1; i >= 0; i--) if (n.get(l[i]) > c) { best = l[i]; c = n.get(l[i]); } return [best, c]; };
const diasEntre = (a, b) => Math.round((new Date(b + "T12:00:00Z") - new Date(a + "T12:00:00Z")) / 86400000);
const diaDaSemana = (iso) => new Date(iso + "T12:00:00Z").getUTCDay();
const semAcento = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
export const RT_MIN_VISITAS = 3, RT_MIN_DIAS = 7, RT_MAX_DIAS = 60;
// visitas: [[AAAA-MM-DD, minutos do horário, profissional, serviços], …]
export function analisarCliente(visitas, hoje = hojeSP()) {
  const v = (visitas || []).filter((x) => x && x[0] && x[0] <= hoje).sort((a, b) => a[0].localeCompare(b[0]));
  if (v.length < RT_MIN_VISITAS) return null;
  const ult = v.slice(-7), inter = [];
  for (let i = 1; i < ult.length; i++) inter.push(diasEntre(ult[i - 1][0], ult[i][0]));
  const media = Math.round(mediana(inter));
  if (media < RT_MIN_DIAS || media > RT_MAX_DIAS) return null; // muito irregular ou raro: fica com a reconquista
  const rec = v.slice(-8), [dia, vezesDia] = moda(rec.map((x) => diaDaSemana(x[0])));
  const doDia = rec.filter((x) => diaDaSemana(x[0]) === dia && x[1] > 0).map((x) => x[1]);
  const hora = doDia.length ? Math.round(mediana(doDia) / 10) * 10 : null;
  const [prof] = moda(v.slice(-5).map((x) => x[2]).filter(Boolean));
  const [serv] = moda(v.slice(-5).map((x) => x[3]).filter(Boolean));
  const ultima = v[v.length - 1][0];
  return { media, dia, vezesDia, hora, prof, serv, ultima, dias: diasEntre(ultima, hoje), visitas: v.length };
}
// Junta as linhas da agenda (um serviço por linha) em visitas: uma por cliente por dia.
export function juntarVisitas(cli, linhas) {
  const porDia = new Map();
  for (const a of linhas || []) {
    const m = String(a.scheduling_start || "").match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/); if (!m) continue;
    const f = so(a.client_phone); if (f.length < 10) continue;
    const k = chaveFone(f), dia = `${m[3]}-${m[2]}-${m[1]}`, g = `${k}|${dia}`;
    const x = porDia.get(g) || { k, f, nome: String(a.client_name || "").trim(), dia, itens: [] };
    x.itens.push([+m[4] * 60 + +m[5], String(a.employee_name || "").trim(), String(a.service_description || "").trim()]); porDia.set(g, x);
  }
  for (const x of porDia.values()) {
    x.itens.sort((a, b) => a[0] - b[0]);
    const c = cli[x.k] || (cli[x.k] = { f: x.f, n: x.nome, v: [] });
    c.f = x.f; if (x.nome) c.n = x.nome;
    const nova = [x.dia, x.itens[0][0], x.itens[0][1], [...new Set(x.itens.map((i) => i[2]).filter(Boolean))].join(" + ")];
    const i = c.v.findIndex((y) => y[0] === x.dia); if (i >= 0) c.v[i] = nova; else c.v.push(nova);
    c.v.sort((a, b) => a[0].localeCompare(b[0])); if (c.v.length > 15) c.v.splice(0, c.v.length - 15);
  }
  return cli;
}
export const TEXTOS_RT = [
  "{Saudacao}, {cliente}! 😊 Sua próxima visita está chegando. Separei *{dia} às {hora}* com {profissional}, do jeito que você costuma vir.\nQuer que eu reserve pra você?",
  "{Saudacao}, {cliente}! Tudo bem? 😊 Já está chegando a hora de dar aquele trato no visual ✂️\n{profissional} tem horário *{dia} às {hora}*, como você costuma vir. Posso reservar pra você?",
  "{Saudacao}, {cliente}! 💈 Pensando na sua próxima visita, separei um horário com {profissional}: *{dia} às {hora}*, como de costume.\nQuer que eu deixe reservado pra você?"];
const horaTexto = (h) => String(h).slice(0, 5).replace(":", "h").replace(/h00$/, "h");
export function textoRetorno(modelo, { nome, dias, profissional, data, hora, servico, barbearia }, hoje = hojeSP(), agora = agoraSP()) {
  const versoes = (modelo ? modelo.split(/\n\s*-{3,}\s*\n/) : TEXTOS_RT).map((t) => t.trim()).filter(Boolean);
  const sd = agora < 12 * 60 ? "Bom dia" : agora < 18 * 60 ? "Boa tarde" : "Boa noite";
  const dm = data.split("-").reverse().slice(0, 2).join("/"), ds = DIAS[diaDaSemana(data)];
  const dia = data === hoje ? "hoje" : data === somaDias(hoje, 1) ? `amanhã (${ds.replace("-feira", "")}, ${dm})` : `${ds} (${dm})`;
  let t = versoes[Math.floor(Math.random() * versoes.length)];
  if (!nome) t = t.replace(/,\s*\{cliente\}/g, "").replace(/\{cliente\},?\s*/g, "");
  return t.replace(/\{Saudacao\}/g, sd).replace(/\{saudacao\}/g, sd.toLowerCase()).replace(/\{cliente\}/g, nome).replace(/\{dias\}/g, String(dias))
    .replace(/\{profissional\}/g, profissional).replace(/\{dia\}/g, dia).replace(/\{hora\}/g, horaTexto(hora)).replace(/\{servico\}/g, servico || "")
    .replace(/\{barbearia\}/g, barbearia || "").replace(/https?:\/\/\S+/gi, "").replace(/ !/g, "!").trim();
}
// Histórico de visitas de cada cliente (agenda da AppBarber), usado pelo retorno e pelo preenchimento de vagas.
// Na 1ª vez, 12 meses de atendimentos realizados (12 créditos); depois, 1 vez por dia, os últimos dias (1 crédito).
// Quem já tem horário marcado (de hoje a 30 dias) é conferido a cada 1h30 (2 créditos).
export async function historicoClientes({ ab, dir, cid, hoje, log = () => {}, aoAtualizar = null, marcadosMin = 90 }) {
  const HIST = join(dir, "retorno-historico.json");
  const ler = (f, pad) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return pad; } };
  const gravar = (v) => { try { writeFileSync(HIST, JSON.stringify(v), { mode: 0o600 }); } catch (e) { log("Histórico de clientes: não gravei: " + e.message); } };
  let h = ler(HIST, null);
  if (!h || h.cid !== cid) h = { cid, ate: null, cli: {} };
  if (h.ate !== hoje) {
    const ini = h.ate ? somaDias(h.ate, -3) : somaDias(hoje, -365), linhas = [];
    for (let fim = somaDias(hoje, -1), i = 0; fim >= ini && i < 13; i++) { const de = somaDias(fim, -30) < ini ? ini : somaDias(fim, -30); linhas.push(...await ab.agenda(de, fim, "2")); fim = somaDias(de, -1); }
    juntarVisitas(h.cli, linhas);
    h.ate = hoje; h.marcadosEm = 0; gravar(h);
    if (aoAtualizar) aoAtualizar(h);
    log(`Histórico de clientes atualizado (${Object.keys(h.cli).length} clientes).`);
  }
  if (!h.marcadosEm || Date.now() - h.marcadosEm > marcadosMin * 60000) {
    // Inclui quem já foi atendido hoje (ainda não está no histórico, que vai até ontem).
    const ag = [...await ab.agenda(hoje, somaDias(hoje, 30), "1"), ...await ab.agenda(hoje, hoje, "2")];
    h.marcados = [...new Set(ag.map((x) => so(x.client_phone)).filter((f) => f.length >= 10).map(chaveFone))];
    h.marcadosEm = Date.now(); gravar(h);
  }
  return h;
}
export function criarRetorno({ dir, log = () => {}, api = async () => ({}), sock = () => null, sofia = () => null, req = null, pode = () => true, esperaDigitando = 3000, relogio = agoraSP }) {
  const HIST = join(dir, "retorno-historico.json"), ENV = join(dir, "retorno-enviados.json");
  const ler = (f, pad) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return pad; } };
  const gravar = (f, v) => { try { writeFileSync(f, JSON.stringify(v), { mode: 0o600 }); } catch (e) { log("Retorno: não gravei o arquivo: " + e.message); } };
  let ab = null, abChave = "", ultimoEnvio = 0, statusEm = 0, ocupado = false;
  const mesmoProf = (p, nome) => { const a = semAcento(nome), b = semAcento(p.completo || p.nome), c = semAcento(p.nome); return !!a && (a === b || a === c || a.split(" ")[0] === c.split(" ")[0] || a.split(" ")[0] === b.split(" ")[0]); };

  // Horário livre com o profissional de costume no dia d, o mais perto do horário de costume (até tol minutos).
  async function vagaEm(d, s, a, tol, hoje) {
    const lista = await ab.horarios(d, s.codigo), p = lista.find((x) => mesmoProf(x, a.prof)); if (!p) return null;
    let best = null;
    for (const h of p.horarios) { const dif = Math.abs(mins(h) - a.hora); if (dif <= tol && (d > hoje || mins(h) > relogio() + 120) && (!best || dif < best.dif)) best = { h, dif }; }
    return best ? { data: d, hora: best.h, prof: p, serv: s } : null;
  }
  async function acharVaga(a, hoje, fechados) {
    const servs = await ab.servicos(), primeiro = String(a.serv || "").split(" + ")[0];
    const s = servs.find((x) => semAcento(x.nome) === semAcento(primeiro)); if (!s) return null;
    const prazo = somaDias(a.ultima, a.media), ini = diasEntre(hoje, prazo) - 3 > 0 ? somaDias(prazo, -3) : hoje;
    // 1º: o dia da semana de costume mais perto do dia do prazo (a partir de 3 dias antes dele; as 2 primeiras vezes).
    const datas = []; for (let i = 0; i <= 14 && datas.length < 2; i++) { const d = somaDias(ini, i); if (diaDaSemana(d) === a.dia && !fechados.includes(a.dia)) datas.push(d); }
    for (const d of datas) { const v = await vagaEm(d, s, a, 90, hoje); if (v) return v; }
    // 2º: outro dia perto do prazo (até 3 tentativas, do mais perto para o mais longe), perto do horário de costume.
    const outros = []; for (let i = -2; i <= 4; i++) { const d = somaDias(prazo, i); if (d >= hoje && !datas.includes(d) && !fechados.includes(diaDaSemana(d))) outros.push(d); }
    outros.sort((x, y) => Math.abs(diasEntre(prazo, x)) - Math.abs(diasEntre(prazo, y)));
    for (const d of outros.slice(0, 3)) { const v = await vagaEm(d, s, a, 60, hoje); if (v) return v; }
    return null;
  }

  async function passo(e, hoje) {
    const c = e.retorno, agora = relogio(), fechados = ((e.horario && e.horario.fechados) || []).map(Number);
    if (fechados.includes(diaDaSemana(hoje)) || agora < 10 * 60 || agora > 19 * 60) return; // envia entre 10h e 19h, em dia aberto
    const k = `${c.codigo_estabelecimento}|${c.appbarber_api_key}`;
    if (!ab || abChave !== k) { abChave = k; ab = ferramentasAppBarber({ cfg: c, ...(req ? { req } : {}), creditos: (n, zero) => api("POST", { company_id: e.company_id, acao: "ab_uso", creditos: n, ...(zero ? { sem_saldo: true } : {}) }).catch(() => {}) }); }
    const env = ler(ENV, {});
    const h = await historicoClientes({ ab, dir, cid: e.company_id, hoje, log, aoAtualizar: (h2) => {
      // Quem recebeu o convite e veio depois: "voltou".
      for (const [kf, x] of Object.entries(env)) if (x.enviado && !x.voltou && h2.cli[kf]) { const v = h2.cli[kf].v.find((y) => y[0] >= x.em); if (v) x.voltou = v[0]; }
      gravar(ENV, env);
    } });
    const marc = new Set(h.marcados || []), sair = new Set(ler(join(dir, "reconquista-sair.json"), [])), wb = ler(join(dir, "reconquista-enviados.json"), {});
    const fila = [];
    for (const [kf, cl] of Object.entries(h.cli)) {
      const a = analisarCliente(cl.v, hoje); if (!a || a.hora == null || !a.prof || !a.serv) continue;
      const atraso = a.dias - a.media, x = env[kf] || {};
      // A partir de N dias antes do prazo de costume (padrão 2; negativo = depois), até 1 semana depois do prazo.
      if (atraso < -(Number.isFinite(c.antes) ? c.antes : 2) || atraso > 7) continue;
      if (marc.has(kf) || sair.has(kf) || (x.em && (x.ult === a.ultima || diasEntre(x.em, hoje) < 7)) || x.semVaga === hoje) continue;
      if (wb[kf] && wb[kf].em && diasEntre(wb[kf].em, hoje) < 30) continue;
      fila.push({ kf, cl, a, atraso });
    }
    fila.sort((p, q) => p.atraso - q.atraso || q.a.visitas - p.a.visitas);
    const hojeEnv = Object.values(env).filter((x) => x.em === hoje && x.enviado).length;
    const intervalo = Math.max(5, Math.floor(9 * 60 / c.porDia)) * 60000; // espalha as mensagens entre 10h e 19h
    const s = sock();
    if (s && pode() && hojeEnv < c.porDia && fila.length && Date.now() - ultimoEnvio >= intervalo) {
      for (const { kf, cl, a } of fila.slice(0, 3)) {
        const vaga = await acharVaga(a, hoje, fechados);
        if (!vaga) { env[kf] = { ...(env[kf] || {}), semVaga: hoje }; gravar(ENV, env); continue; }
        const d = so(cl.f), cand = d.length <= 11 ? "55" + d : d;
        const [w] = await s.onWhatsApp(cand).catch(() => []);
        if (!w || !w.exists) { env[kf] = { ult: a.ultima, em: hoje, semZap: true }; gravar(ENV, env); continue; }
        const nome = primeiroNome(cl.n), profissional = primeiroNome(vaga.prof.nome);
        const texto = textoRetorno(c.texto, { nome, dias: a.dias, profissional, data: vaga.data, hora: vaga.hora, servico: a.serv, barbearia: e.nome }, hoje, relogio());
        env[kf] = { ult: a.ultima, em: hoje, enviado: true, vaga: `${vaga.data} ${vaga.hora}` }; gravar(ENV, env); ultimoEnvio = Date.now();
        try {
          await s.presenceSubscribe(w.jid).catch(() => {}); await s.sendPresenceUpdate("composing", w.jid).catch(() => {});
          await espera(esperaDigitando + Math.random() * esperaDigitando); await s.sendPresenceUpdate("paused", w.jid).catch(() => {});
          const r = await s.sendMessage(w.jid, { text: texto });
          const so2 = sofia(); if (so2 && so2.retornoEnviado) so2.retornoEnviado(w.jid, r && r.key && r.key.id, { fone: normFone(d), nome, texto,
            detalhe: `[horário sugerido: ${vaga.data} ${vaga.hora}, profissional código ${vaga.prof.codigo} (${vaga.prof.nome}), serviço código ${vaga.serv.codigo} (${vaga.serv.nome}); de costume o cliente faz: ${a.serv}; vem a cada ~${a.media} dias. Se ele aceitar, confira com ver_horarios e agende; se não der, ofereça outro horário.]` });
          log(`Retorno: convite enviado (${nome || "cliente"}, volta a cada ~${a.media} dias → ${vaga.data} ${vaga.hora}).`);
        } catch (err) { env[kf].enviado = false; env[kf].erro = String(err.message).slice(0, 80); gravar(ENV, env); log("Retorno: convite não enviado: " + err.message); }
        break; // um por vez; o próximo no próximo intervalo
      }
    }
    if (Date.now() - statusEm > 1800000) {
      statusEm = Date.now();
      const vals = Object.values(ler(ENV, {})).filter((x) => x.enviado);
      const quando = new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
      const conhecidos = Object.values(h.cli).filter((cl) => analisarCliente(cl.v, hoje)).length;
      await api("POST", { company_id: e.company_id, acao: "rt_status", status: `ok: ${quando} · ${vals.filter((x) => x.em === hoje).length} de ${c.porDia} enviados hoje · ${fila.length} na fila · ${conhecidos} clientes com frequência conhecida · ${vals.length} enviados no total · ${vals.filter((x) => x.voltou).length} voltaram.` }).catch(() => {});
    }
  }
  async function rodar(e, hoje = hojeSP()) {
    if (ocupado || !e || !e.retorno) return; ocupado = true;
    try { await passo(e, hoje); } finally { ocupado = false; }
  }
  return { rodar };
}

// ---------- preencher vagas ----------
// Quando um horário de hoje (ou amanhã) é cancelado e continua livre, convida na hora clientes do mesmo profissional que
// já estão no prazo de voltar e costumam vir perto desse horário. O primeiro que confirmar fica com ele (a atendente IA
// confere a agenda e marca). Cancelamentos conferidos a cada 15 minutos, no horário de funcionamento.
export const TEXTOS_FV = [
  "{Saudacao}, {cliente}! Tudo bem? 😊\nAcabou de abrir um horário *{dia} às {hora}* com {profissional} aqui na {barbearia}, e lembrei de você.\nQuer que eu reserve pra você?",
  "{Saudacao}, {cliente}! 😊\nVagou um horário *{dia} às {hora}* com {profissional}. Como já está chegando a hora do seu próximo atendimento, separei pra você primeiro.\nPosso reservar?",
];
export function criarVagas({ dir, log = () => {}, api = async () => ({}), sock = () => null, sofia = () => null, req = null, pode = () => true, esperaDigitando = 3000, relogio = agoraSP, intervaloMin = 15 }) {
  const EST = join(dir, "vagas-estado.json");
  const ler = (f, pad) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return pad; } };
  const gravar = (v) => { try { writeFileSync(EST, JSON.stringify(v), { mode: 0o600 }); } catch (e) { log("Vagas: não gravei o arquivo: " + e.message); } };
  let ab = null, abChave = "", ocupado = false, conferidoEm = 0, statusEm = 0;
  const mesmoProf = (p, nome) => { const a = semAcento(nome), b = semAcento(p.completo || p.nome), c = semAcento(p.nome); return !!a && (a === b || a === c || a.split(" ")[0] === c.split(" ")[0] || a.split(" ")[0] === b.split(" ")[0]); };

  async function passo(e, hoje) {
    const c = e.vagas, agora = relogio(), fechados = ((e.horario && e.horario.fechados) || []).map(Number);
    const abre = mins((e.horario && e.horario.abertura) || "09:00"), fecha = mins((e.horario && e.horario.fechamento) || "20:00");
    if (fechados.includes(diaDaSemana(hoje)) || agora < abre || agora > fecha - 30) return;
    if (Date.now() - conferidoEm < intervaloMin * 60000) return; conferidoEm = Date.now();
    const k = `${c.codigo_estabelecimento}|${c.appbarber_api_key}`;
    if (!ab || abChave !== k) { abChave = k; ab = ferramentasAppBarber({ cfg: c, ...(req ? { req } : {}), creditos: (n, zero) => api("POST", { company_id: e.company_id, acao: "ab_uso", creditos: n, ...(zero ? { sem_saldo: true } : {}) }).catch(() => {}) }); }
    const st = ler(EST, {}); if (st.cid !== e.company_id) { st.cid = e.company_id; st.vistos = {}; st.env = {}; }
    st.vistos = st.vistos || {}; st.env = st.env || {};
    if (st.dia !== hoje) { st.dia = hoje; st.hoje = { vagas: 0, convites: 0, semCandidato: 0 }; for (const [x, d] of Object.entries(st.vistos)) if (d < somaDias(hoje, -2)) delete st.vistos[x]; }
    const ate = c.dias >= 2 ? somaDias(hoje, 1) : hoje;
    // Cancelados → vagas (um horário por profissional e início)
    const vagas = new Map();
    for (const a of await ab.agenda(hoje, ate, "3")) {
      const cod = String(a.appointment_code || a.scheduling_code || ""); if (!cod || st.vistos[cod]) continue;
      st.vistos[cod] = hoje;
      const m = String(a.scheduling_start || "").match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/); if (!m) continue;
      const data = `${m[3]}-${m[2]}-${m[1]}`, hora = `${m[4]}:${m[5]}`, prof = String(a.employee_name || "").trim();
      if (!prof || data < hoje || data > ate || (data === hoje && mins(hora) < agora + c.antecedencia)) continue;
      const g = `${semAcento(prof)}|${data}|${hora}`;
      if (!vagas.has(g)) vagas.set(g, { data, hora, prof, servico: String(a.service_description || "").trim(), fone: chaveFone(a.client_phone) });
    }
    gravar(st);
    if (!vagas.size) return status(e, st);
    const servs = await ab.servicos(), porNome = (n) => servs.find((x) => semAcento(x.nome) === semAcento(String(n || "").split(" + ")[0]));
    const h = await historicoClientes({ ab, dir, cid: e.company_id, hoje, log, marcadosMin: 30 });
    const marc = new Set(h.marcados || []), sair = new Set(ler(join(dir, "reconquista-sair.json"), [])), wb = ler(join(dir, "reconquista-enviados.json"), {}), rt = ler(join(dir, "retorno-enviados.json"), {});
    const livres = new Map(); // data|servico → lista de horários por profissional
    const livresDe = async (data, s) => { const k2 = `${data}|${s.codigo}`; if (!livres.has(k2)) livres.set(k2, await ab.horarios(data, s.codigo).catch(() => [])); return livres.get(k2); };
    for (const v of vagas.values()) {
      if (st.hoje.convites >= c.porDia) break;
      const sV = porNome(v.servico) || servs[0]; if (!sV) continue;
      const pV = (await livresDe(v.data, sV)).find((p) => mesmoProf(p, v.prof));
      if (!pV || !pV.horarios.includes(v.hora)) continue; // já foi preenchida (ou o profissional saiu da agenda)
      st.hoje.vagas++;
      const slot = mins(v.hora), cand = [];
      for (const [kf, cl] of Object.entries(h.cli)) {
        if (kf === v.fone || marc.has(kf) || sair.has(kf)) continue;
        const a = analisarCliente(cl.v, hoje); if (!a || !a.prof || !a.serv || !mesmoProf(pV, a.prof)) continue;
        const atraso = a.dias - a.media; if (atraso < -7 || atraso > 45) continue; // perto do prazo de voltar (até 1 semana antes)
        const x = st.env[kf]; if (x && diasEntre(x, hoje) < 7) continue;
        if (rt[kf] && rt[kf].em && rt[kf].enviado && diasEntre(rt[kf].em, hoje) < 3) continue;
        if (wb[kf] && wb[kf].em && diasEntre(wb[kf].em, hoje) < 30) continue;
        const dif = a.hora == null ? 120 : Math.abs(a.hora - slot); if (dif > 150) continue;
        cand.push({ kf, cl, a, dif, atraso });
      }
      cand.sort((p, q) => Math.floor(p.dif / 30) - Math.floor(q.dif / 30) || q.atraso - p.atraso || q.a.visitas - p.a.visitas);
      const s = sock(); let enviados = 0;
      for (const x of cand) {
        if (!s || !pode() || enviados >= c.porVaga || st.hoje.convites >= c.porDia) break;
        // O serviço de costume dele cabe nesse horário?
        const sC = porNome(x.a.serv) || sV;
        if (sC.codigo !== sV.codigo) { const pC = (await livresDe(v.data, sC)).find((p) => mesmoProf(p, v.prof)); if (!pC || !pC.horarios.includes(v.hora)) continue; }
        const d = so(x.cl.f), numero = d.length <= 11 ? "55" + d : d;
        const [w] = await s.onWhatsApp(numero).catch(() => []); if (!w || !w.exists) continue;
        const nome = primeiroNome(x.cl.n), profissional = primeiroNome(pV.nome);
        const texto = textoRetorno(c.texto || TEXTOS_FV.join("\n---\n"), { nome, dias: x.a.dias, profissional, data: v.data, hora: v.hora, servico: x.a.serv, barbearia: e.nome }, hoje, relogio());
        st.env[x.kf] = hoje; st.hoje.convites++; enviados++; gravar(st);
        try {
          await s.presenceSubscribe(w.jid).catch(() => {}); await s.sendPresenceUpdate("composing", w.jid).catch(() => {});
          await espera(esperaDigitando + Math.random() * esperaDigitando); await s.sendPresenceUpdate("paused", w.jid).catch(() => {});
          const r = await s.sendMessage(w.jid, { text: texto });
          const so2 = sofia(); if (so2 && so2.conviteEnviado) so2.conviteEnviado(w.jid, r && r.key && r.key.id, { fone: normFone(d), nome, texto, horas: 6, origem: "vaga",
            tipo: "vaga: horário que acabou de abrir (cancelamento)",
            detalhe: `[horário oferecido: ${v.data} ${v.hora}, profissional código ${pV.codigo} (${pV.nome}), serviço código ${sC.codigo} (${sC.nome}); de costume o cliente faz: ${x.a.serv}. Esta vaga foi oferecida a até ${c.porVaga} cliente(s) ao mesmo tempo: o primeiro que confirmar fica com ela. Se ele aceitar, confira com ver_horarios e agende na hora; se já tiver sido preenchida, peça desculpas e ofereça o horário livre mais perto com o mesmo profissional.]` });
          log(`Vagas: convite enviado (${nome || "cliente"} → ${v.data} ${v.hora} com ${profissional}).`);
        } catch (err) { log("Vagas: convite não enviado: " + err.message); }
      }
      if (!enviados) st.hoje.semCandidato++;
      gravar(st);
    }
    return status(e, st, true);
  }
  async function status(e, st, forcar = false) {
    if (!forcar && Date.now() - statusEm < 1800000) return; statusEm = Date.now();
    const quando = new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }), x = st.hoje || {};
    await api("POST", { company_id: e.company_id, acao: "fv_status", status: `ok: ${quando} · hoje: ${x.vagas || 0} vaga(s) aberta(s) por cancelamento, ${x.convites || 0} convite(s) enviado(s)${x.semCandidato ? `, ${x.semCandidato} sem cliente no perfil` : ""}` }).catch(() => {});
  }
  async function rodar(e, hoje = hojeSP()) {
    if (ocupado || !e || !e.vagas) return; ocupado = true;
    try { await passo(e, hoje); } finally { ocupado = false; }
  }
  return { rodar };
}

// ---------- confirmação de presença (evitar faltas) ----------
// Na véspera (a partir do horário escolhido), pede ao cliente que confirme o horário de amanhã. A atendente IA lê a
// resposta: confirma na agenda (status "Confirmado"), remarca ou cancela; o horário cancelado entra no Preencher vagas.
// Quem não respondeu recebe um 2º aviso no dia, algumas horas antes; quem não responde nenhum fica como "risco de falta".
export const TEXTOS_CF = [
  "{Saudacao}, {cliente}! 😊\nPassando para confirmar seu horário de *{dia} às {hora}* com {profissional} ({servico}) aqui na {barbearia}.\nVocê confirma sua presença? Se não puder vir, me avise que eu remarco pra você.",
  "{Saudacao}, {cliente}! Tudo bem? 😊\nSeu horário está marcado para *{dia} às {hora}* com {profissional}. Posso confirmar sua presença?\nSe tiver algum imprevisto, me fala que a gente encontra outro horário.",
];
export const TEXTO_CF2 = "{cliente}, seu horário é *hoje às {hora}* com {profissional}. Consegue confirmar pra mim? 😊";
export function criarConfirmacao({ dir, log = () => {}, api = async () => ({}), sock = () => null, sofia = () => null, resultados = null, req = null, pode = () => true, esperaEntre = [20000, 45000], relogio = agoraSP }) {
  const EST = join(dir, "confirmacao-estado.json");
  const ler = (f, pad) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return pad; } };
  const gravar = (v) => { try { writeFileSync(EST, JSON.stringify(v), { mode: 0o600 }); } catch (e) { log("Confirmação: não gravei o arquivo: " + e.message); } };
  let ab = null, abChave = "", ocupado = false, statusEm = 0;
  const cache = new Map(); // dia → { em, lista }
  async function doDia(d, st) { const k = d + st, c = cache.get(k); if (c && Date.now() - c.em < 20 * 60000) return c.lista; const lista = await ab.agenda(d, d, st); cache.set(k, { em: Date.now(), lista }); return lista; }
  // Um pedido por cliente para cada bloco de horários seguidos no dia (ex.: corte 14h + barba 14h40).
  function blocos(lista, dia) {
    const porCli = new Map();
    for (const a of lista) {
      const m = String(a.scheduling_start || "").match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/); if (!m || `${m[3]}-${m[2]}-${m[1]}` !== dia) continue;
      const f = so(a.client_phone); if (f.length < 10) continue;
      const r = String(a.scheduling_registration_date || "").match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
      const x = { cod: Number(a.appointment_code || a.scheduling_code), min: +m[4] * 60 + +m[5], prof: String(a.employee_name || "").trim(), serv: String(a.service_description || "").trim(), nome: String(a.client_name || "").trim(), f,
        reg: r ? new Date(`${r[3]}-${r[2]}-${r[1]}T${r[4]}:${r[5]}:00-03:00`).getTime() : 0, conf: /confirmad/i.test(String(a.scheduling_status || "")) };
      (porCli.get(chaveFone(f)) || porCli.set(chaveFone(f), []).get(chaveFone(f))).push(x);
    }
    const out = [];
    for (const arr of porCli.values()) {
      arr.sort((p, q) => p.min - q.min); let cur = null;
      for (const x of arr) {
        if (cur && x.min - cur.fim <= 60) { cur.cods.push(x.cod); cur.fim = x.min; if (x.serv && !cur.servs.includes(x.serv)) cur.servs.push(x.serv); cur.conf = cur.conf && x.conf; cur.reg = Math.max(cur.reg, x.reg); continue; }
        cur = { cods: [x.cod], min: x.min, fim: x.min, prof: x.prof, servs: x.serv ? [x.serv] : [], nome: x.nome, f: x.f, reg: x.reg, conf: x.conf }; out.push(cur);
      }
    }
    return out.sort((p, q) => p.min - q.min);
  }
  const juntos = (l) => (l.length <= 1 ? l.join("") : l.slice(0, -1).join(", ") + " e " + l[l.length - 1]);
  function texto(modelo, b, dia, hoje, agora, e) {
    const versoes = String(modelo).split(/\n\s*-{3,}\s*\n/).map((t) => t.trim()).filter(Boolean);
    const sd = agora < 12 * 60 ? "Bom dia" : agora < 18 * 60 ? "Boa tarde" : "Boa noite", ds = DIAS[diaDaSemana(dia)].replace("-feira", ""), dm = dia.split("-").reverse().slice(0, 2).join("/");
    const diaTxt = dia === hoje ? "hoje" : dia === somaDias(hoje, 1) ? `amanhã (${ds}, ${dm})` : `${ds} (${dm})`, nome = primeiroNome(b.nome);
    let t = versoes[Math.floor(Math.random() * versoes.length)];
    if (!nome) t = t.replace(/,\s*\{cliente\}/g, "").replace(/\{cliente\},?\s*/g, "");
    return t.replace(/\{Saudacao\}/g, sd).replace(/\{saudacao\}/g, sd.toLowerCase()).replace(/\{cliente\}/g, nome).replace(/\{dia\}/g, diaTxt).replace(/\{hora\}/g, horaTexto(`${String(Math.floor(b.min / 60)).padStart(2, "0")}:${String(b.min % 60).padStart(2, "0")}`))
      .replace(/\{profissional\}/g, primeiroNome(b.prof) || "a nossa equipe").replace(/\{servico\}/g, juntos(b.servs) || "seu atendimento").replace(/\{barbearia\}/g, e.nome || "")
      .replace(/ \(\)/g, "").replace(/https?:\/\/\S+/gi, "").trim();
  }
  async function mandar(s, b, txt, detalhe, horas, e) {
    const d = so(b.f), numero = d.length <= 11 ? "55" + d : d;
    const [w] = await s.onWhatsApp(numero).catch(() => []); if (!w || !w.exists) return null;
    await s.presenceSubscribe(w.jid).catch(() => {}); await s.sendPresenceUpdate("composing", w.jid).catch(() => {});
    await espera(1500 + Math.random() * 2000); await s.sendPresenceUpdate("paused", w.jid).catch(() => {});
    const r = await s.sendMessage(w.jid, { text: txt });
    const so2 = sofia(); if (so2 && so2.conviteEnviado) so2.conviteEnviado(w.jid, r && r.key && r.key.id, { fone: normFone(d), nome: primeiroNome(b.nome), texto: txt, horas, origem: "confirmacao", tipo: "confirmação de presença do horário marcado", detalhe });
    return w.jid;
  }
  const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  async function passo(e, hoje) {
    const c = e.confirmacao, agora = relogio(), fechados = ((e.horario && e.horario.fechados) || []).map(Number);
    if (agora < 8 * 60 || agora > 21 * 60) return;
    const k = `${c.codigo_estabelecimento}|${c.appbarber_api_key}`;
    if (!ab || abChave !== k) { abChave = k; ab = ferramentasAppBarber({ cfg: c, ...(req ? { req } : {}), creditos: (n, zero) => api("POST", { company_id: e.company_id, acao: "ab_uso", creditos: n, ...(zero ? { sem_saldo: true } : {}) }).catch(() => {}) }); }
    const st = ler(EST, {}); if (st.cid !== e.company_id) { st.cid = e.company_id; st.env = {}; }
    st.env = st.env || {}; for (const [x, v] of Object.entries(st.env)) if (v.dia < somaDias(hoje, -2)) delete st.env[x];
    const s = sock(), amanha = somaDias(hoje, 1);
    // Próximo dia aberto (ex.: no sábado, com domingo fechado, pede os horários de segunda).
    let alvo = amanha; for (let i = 0; i < 3 && fechados.includes(diaDaSemana(alvo)); i++) alvo = somaDias(alvo, 1);
    const detalhe = (b, dia) => `[confirmação de presença: ${dia} ${hhmm(b.min)} com ${b.prof} (${juntos(b.servs)}), códigos ${b.cods.join(", ")}. Se o cliente confirmar (sim, confirmo, 👍, estarei aí), use confirmar_presenca com esses códigos e agradeça curto. Se não puder vir, seja gentil e ofereça remarcar (ver_horarios + remarcar) ou cancelar; nunca insista. Se ele só agradecer, não precisa responder de novo.]`;
    // 1) Véspera: a partir do horário escolhido até 20h30, em dia aberto, para os horários de amanhã.
    if (s && pode() && !fechados.includes(diaDaSemana(hoje)) && !fechados.includes(diaDaSemana(alvo)) && agora >= mins(c.hora || "17:00") && agora <= 20 * 60 + 30) {
      let n = 0;
      for (const b of blocos(await doDia(alvo, "1"), alvo)) {
        const kb = b.cods.join(","); if (st.env[kb] || b.conf) continue;
        if (b.reg && Date.now() - b.reg < 3 * 3600000) { st.env[kb] = { dia: alvo, pulado: "marcou há pouco" }; continue; } // acabou de marcar: já sabe
        if (n >= 8) break; // no máximo 8 por rodada (a próxima continua)
        const txt = texto(c.texto || TEXTOS_CF.join("\n---\n"), b, alvo, hoje, agora, e);
        st.env[kb] = { dia: alvo, min: b.min, f4: b.f.slice(-4), em1: Date.now() }; gravar(st);
        try { const jid = await mandar(s, b, txt, detalhe(b, alvo), 30, e); if (!jid) { st.env[kb].semZap = true; } else { st.env[kb].jid = jid; n++;
          if (resultados) resultados.evento(e.company_id, { tipo: "confirmacao", origem: "confirmacao", ref: `cf:${kb}` }); log(`Confirmação: pedido enviado (${primeiroNome(b.nome) || "cliente"} → ${alvo} ${hhmm(b.min)}).`); } }
        catch (err) { st.env[kb].erro = String(err.message).slice(0, 80); log("Confirmação: não enviada: " + err.message); }
        gravar(st); await espera(esperaEntre[0] + Math.random() * (esperaEntre[1] - esperaEntre[0]));
      }
    }
    // 2) No dia: 2º aviso para quem não respondeu, `antes` minutos antes do horário (no mínimo 30 minutos antes).
    const doHoje = Object.entries(st.env).filter(([, v]) => v.dia === hoje && v.jid && !v.em2 && !v.ok);
    if (doHoje.length) {
      const atuais = new Map(blocos(await doDia(hoje, "1"), hoje).map((b) => [b.cods.join(","), b]));
      const so2 = sofia();
      for (const [kb, v] of doHoje) {
        const b = atuais.get(kb);
        if (!b) { v.ok = "remarcado ou cancelado"; continue; }
        if (b.conf) { v.ok = "confirmado"; continue; }
        if (so2 && so2.respondeu && so2.respondeu(v.jid, v.em1)) { v.ok = "respondeu"; continue; }
        if (!c.segundo || !s || !pode()) continue;
        const falta = b.min - agora; if (falta > (c.antes || 180) || falta < 30) continue;
        try { await mandar(s, b, texto(c.texto2 || TEXTO_CF2, b, hoje, hoje, agora, e), detalhe(b, hoje), 6, e); v.em2 = Date.now(); log(`Confirmação: 2º aviso (${hhmm(b.min)}).`); } catch (err) { log("Confirmação: 2º aviso não enviado: " + err.message); }
        gravar(st);
      }
      gravar(st);
    }
    // Situação: pedidos de hoje e de amanhã, confirmados e quem ainda não respondeu (risco de falta).
    if (Date.now() - statusEm > 15 * 60000) {
      statusEm = Date.now();
      const so2 = sofia(), vals = Object.values(st.env).filter((v) => v.jid);
      for (const v of vals) if (!v.ok && v.dia === hoje && so2 && so2.respondeu && so2.respondeu(v.jid, v.em1)) v.ok = "respondeu";
      const amanhaN = vals.filter((v) => v.dia === alvo).length;
      const risco = vals.filter((v) => v.dia === hoje && !v.ok && v.min > agora).sort((p, q) => p.min - q.min);
      const quando = new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
      await api("POST", { company_id: e.company_id, acao: "cf_status", status: `ok: ${quando} · ${amanhaN} pedido(s) de confirmação para ${alvo === amanha ? "amanhã" : alvo.split("-").reverse().slice(0, 2).join("/")} · hoje: ${vals.filter((v) => v.dia === hoje && v.ok).length} responderam${risco.length ? ` · sem resposta (risco de falta): ${risco.slice(0, 12).map((v) => `${horaTexto(hhmm(v.min))} (…${v.f4})`).join(", ")}` : ""}` }).catch(() => {});
      gravar(st);
    }
  }
  async function rodar(e, hoje = hojeSP()) {
    if (ocupado || !e || !e.confirmacao) return; ocupado = true;
    try { await passo(e, hoje); } finally { ocupado = false; }
  }
  return { rodar };
}

// ---------- venda de planos ----------
// Cliente que vem com frequência e não é assinante: compara o que ele gasta por mês pagando avulso com o plano que
// combina com o serviço de costume dele. A atendente IA oferece depois de agendar (na conversa) e, se ligado, um convite
// por dia para os melhores candidatos. Quem se interessa vai para a recepção (pagamento e contrato são com a equipe).
export const TEXTOS_PL = [
  "{Saudacao}, {cliente}! Tudo bem? 😊\nVi que você vem bem certinho aqui na {barbearia}, a cada {dias} dias mais ou menos. No *Plano {plano}* você paga R$ {preco} por mês{economia_txt} e já fica com seu horário garantido com {profissional}.\nQuer que eu te conte como funciona?",
];
const reais0 = (v) => Math.round(Number(v) || 0).toLocaleString("pt-BR");
// Melhor plano para o cliente (a = analisarCliente). planos: [{ nome, preco, avulso, visitas, quando }], dias: dias da semana permitidos.
export function candidatoPlano(a, planos = [], dias = [1, 2, 3, 4]) {
  if (!a || !a.media || !a.serv || a.media > 12) return null; // vem pelo menos ~3 vezes no mês
  if (Array.isArray(dias) && dias.length && !dias.includes(a.dia)) return null; // o dia de costume dele não é aceito no plano
  const nomes = String(a.serv).split(" + ").map((x) => semAcento(x)), visitasMes = Math.min(8, 30 / a.media);
  let melhor = null;
  for (const p of planos) {
    const preco = Number(p.preco) || 0, avulso = Number(p.avulso) || 0, vis = Math.max(1, Number(p.visitas) || 4);
    if (!preco || !avulso || avulso <= preco) continue;
    const regra = regraQuando(p.quando); if (!regraVale(regra, nomes)) continue;
    const espec = Math.max(0, ...regra.ou.filter((todas) => todas.every((w) => nomes.some((n) => n.includes(w)))).map((t) => t.length));
    const usa = Math.min(visitasMes, vis), gasto = usa * (avulso / vis), economia = Math.round(gasto - preco), maisVisitas = Math.max(0, Math.round(vis - visitasMes));
    if (economia < 0 && -economia > preco * 0.15) continue; // sai bem mais caro para ele: não oferece
    const x = { plano: p.nome, preco, visitas: vis, visitasMes: Math.round(visitasMes * 10) / 10, gasto: Math.round(gasto), economia, maisVisitas, espec };
    if (!melhor || x.espec > melhor.espec || (x.espec === melhor.espec && x.economia > melhor.economia)) melhor = x;
  }
  return melhor;
}
export function textoPlano(modelo, x, { nome, profissional, barbearia, dias }, agora = agoraSP()) {
  const versoes = String(modelo || TEXTOS_PL.join("\n---\n")).split(/\n\s*-{3,}\s*\n/).map((t) => t.trim()).filter(Boolean);
  const sd = agora < 12 * 60 ? "Bom dia" : agora < 18 * 60 ? "Boa tarde" : "Boa noite";
  const ec = x.economia > 0 ? `, uma economia de uns R$ ${reais0(x.economia)} por mês` : x.maisVisitas > 0 ? ` e pode vir ${x.visitas} vezes no mês` : "";
  let t = versoes[Math.floor(Math.random() * versoes.length)];
  if (!nome) t = t.replace(/,\s*\{cliente\}/g, "").replace(/\{cliente\},?\s*/g, "");
  return t.replace(/\{Saudacao\}/g, sd).replace(/\{saudacao\}/g, sd.toLowerCase()).replace(/\{cliente\}/g, nome).replace(/\{plano\}/g, x.plano).replace(/\{preco\}/g, reais0(x.preco))
    .replace(/\{economia_txt\}/g, ec).replace(/\{economia\}/g, reais0(Math.max(0, x.economia))).replace(/\{visitas\}/g, String(x.visitas)).replace(/\{dias\}/g, String(dias))
    .replace(/\{profissional\}/g, profissional || "o seu barbeiro").replace(/\{barbearia\}/g, barbearia || "").replace(/https?:\/\/\S+/gi, "").trim();
}
// Linha de contexto para a conversa da atendente (uma vez a cada 30 dias por cliente).
export function dicaPlano({ dir, fone, planosCfg, hoje = hojeSP() }) {
  if (!planosCfg || !planosCfg.chat || !fone) return "";
  const ler = (f, pad) => { try { return JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { return pad; } };
  const k = chaveFone(fone), h = ler("retorno-historico.json", null), of = ler("planos-ofertas.json", {});
  if (!h || !h.cli || !h.cli[k] || (of[k] && diasEntre(of[k].em, hoje) < 30)) return "";
  const a = analisarCliente(h.cli[k].v, hoje), x = candidatoPlano(a, planosCfg.planos, planosCfg.dias); if (!x) return "";
  of[k] = { em: hoje, plano: x.plano, como: "conversa" }; try { writeFileSync(join(dir, "planos-ofertas.json"), JSON.stringify(of), { mode: 0o600 }); } catch { /* tenta na próxima */ }
  return `[Venda de plano: este cliente NÃO é assinante, vem a cada ~${a.media} dias (~${x.visitasMes} vezes no mês) e costuma fazer ${a.serv} com ${a.prof}. O Plano ${x.plano} (R$ ${reais0(x.preco)}/mês, ${x.visitas} visitas) ${x.economia > 0 ? `sai uns R$ ${reais0(x.economia)} por mês mais barato do que ele paga avulso (~R$ ${reais0(x.gasto)})` : `custa quase o mesmo que ele já gasta (~R$ ${reais0(x.gasto)}) e dá ${x.visitas} visitas`}. DEPOIS de concluir o que ele pediu (ex.: confirmar o agendamento), ofereça esse plano UMA vez, numa frase leve, com a economia. Se ele se interessar, envie a arte dos planos (se houver) e tire as dúvidas pelas Informações da casa; se quiser assinar, use chamar_recepcao com o plano escolhido. Se ele não quiser, siga sem insistir. Não ofereça se a conversa for reclamação, cancelamento ou assunto delicado.]\n`;
}
export function criarPlanos({ dir, log = () => {}, api = async () => ({}), sock = () => null, sofia = () => null, resultados = null, req = null, pode = () => true, relogio = agoraSP }) {
  const OF = join(dir, "planos-ofertas.json");
  const ler = (f, pad) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return pad; } };
  const gravar = (v) => { try { writeFileSync(OF, JSON.stringify(v), { mode: 0o600 }); } catch (e) { log("Planos: não gravei o arquivo: " + e.message); } };
  let ab = null, abChave = "", ocupado = false, ultimoEnvio = 0, statusEm = 0, conferidoEm = "";
  async function passo(e, hoje) {
    const c = e.planos, agora = relogio(), fechados = ((e.horario && e.horario.fechados) || []).map(Number);
    if (fechados.includes(diaDaSemana(hoje)) || agora < 10 * 60 || agora > 19 * 60) return;
    const k = `${c.codigo_estabelecimento}|${c.appbarber_api_key}`;
    if (!ab || abChave !== k) { abChave = k; ab = ferramentasAppBarber({ cfg: c, ...(req ? { req } : {}), creditos: (n, zero) => api("POST", { company_id: e.company_id, acao: "ab_uso", creditos: n, ...(zero ? { sem_saldo: true } : {}) }).catch(() => {}) }); }
    const of = ler(OF, {});
    // Fechamentos: quem recebeu a oferta (até 45 dias) e virou assinante depois dela. Conferido 1 vez por dia.
    if (conferidoEm !== hoje && Object.keys(of).length) {
      conferidoEm = hoje;
      try {
        const lista = await ab.assinantesTodos();
        for (const [kf, x] of Object.entries(of)) {
          if (x.fechou || diasEntre(x.em, hoje) > 45) continue;
          const s = lista.find((y) => y.k === kf); if (!s) continue;
          const m = String(s.contratacao).match(/^(\d{2})\/(\d{2})\/(\d{4})/), d = m ? `${m[3]}-${m[2]}-${m[1]}` : "";
          if (d && d >= x.em) { x.fechou = d; const p = (c.planos || []).find((y) => semAcento(s.plano).includes(semAcento(y.nome))) || {};
            if (resultados) resultados.evento(e.company_id, { tipo: "plano_fechado", origem: "plano", valor: Number(p.preco) || null, ref: `plf:${hashCurto(kf + d)}`, dados: { plano: s.plano, como: x.como } });
            log(`Planos: assinatura fechada depois da oferta (${s.plano}).`); }
        }
        gravar(of);
      } catch (err) { log("Planos: não conferi os assinantes: " + err.message); }
    }
    // Convites (se ligado): os melhores candidatos, espalhados entre 10h e 19h.
    const hojeN = Object.values(of).filter((x) => x.em === hoje && x.como === "convite").length;
    const s = sock();
    if (c.porDia > 0 && s && pode() && hojeN < c.porDia && Date.now() - ultimoEnvio >= Math.max(20, Math.floor(9 * 60 / c.porDia)) * 60000) {
      const h = await historicoClientes({ ab, dir, cid: e.company_id, hoje, log });
      const marc = new Set(h.marcados || []), sair = new Set(ler(join(dir, "reconquista-sair.json"), [])), rt = ler(join(dir, "retorno-enviados.json"), {}), wb = ler(join(dir, "reconquista-enviados.json"), {});
      const assin = new Set((await ab.assinantesTodos().catch(() => [])).map((x) => x.k));
      const cand = [];
      for (const [kf, cl] of Object.entries(h.cli)) {
        if (assin.has(kf) || sair.has(kf) || (of[kf] && diasEntre(of[kf].em, hoje) < 60)) continue;
        if (rt[kf] && rt[kf].em && diasEntre(rt[kf].em, hoje) < 3) continue;
        if (wb[kf] && wb[kf].em && diasEntre(wb[kf].em, hoje) < 30) continue;
        const a = analisarCliente(cl.v, hoje); if (!a || a.dias > 21) continue; // ainda vem (atendido nas últimas 3 semanas)
        const x = candidatoPlano(a, c.planos, c.dias); if (!x) continue;
        cand.push({ kf, cl, a, x, marcado: marc.has(kf) });
      }
      // Primeiro quem já tem horário marcado (está ativo) e quem mais economiza.
      cand.sort((p, q) => (q.marcado - p.marcado) || (q.x.economia - p.x.economia) || (q.a.visitas - p.a.visitas));
      for (const y of cand.slice(0, 3)) {
        const d = so(y.cl.f), numero = d.length <= 11 ? "55" + d : d;
        const [w] = await s.onWhatsApp(numero).catch(() => []);
        if (!w || !w.exists) { of[y.kf] = { em: hoje, plano: y.x.plano, como: "sem whatsapp" }; gravar(of); continue; }
        const nome = primeiroNome(y.cl.n), prof = primeiroNome(y.a.prof);
        const txt = textoPlano(c.texto, y.x, { nome, profissional: prof, barbearia: e.nome, dias: y.a.media }, agora);
        of[y.kf] = { em: hoje, plano: y.x.plano, como: "convite" }; gravar(of); ultimoEnvio = Date.now();
        try {
          await s.presenceSubscribe(w.jid).catch(() => {}); await s.sendPresenceUpdate("composing", w.jid).catch(() => {});
          await espera(2000 + Math.random() * 2000); await s.sendPresenceUpdate("paused", w.jid).catch(() => {});
          const r = await s.sendMessage(w.jid, { text: txt });
          const so2 = sofia(); if (so2 && so2.conviteEnviado) so2.conviteEnviado(w.jid, r && r.key && r.key.id, { fone: normFone(d), nome, texto: txt, horas: 24, origem: "plano", tipo: "oferta de plano mensal para cliente frequente",
            detalhe: `[oferta do Plano ${y.x.plano}: R$ ${reais0(y.x.preco)}/mês, ${y.x.visitas} visitas; o cliente vem a cada ~${y.a.media} dias e faz ${y.a.serv} com ${y.a.prof} (avulso ~R$ ${reais0(y.x.gasto)}/mês). Se ele tiver interesse, envie a arte dos planos (se houver), explique pelas Informações da casa e, se quiser assinar, use chamar_recepcao com o plano escolhido. Se não quiser, agradeça e não insista.]` });
          log(`Planos: oferta enviada (${nome || "cliente"} → ${y.x.plano}).`);
        } catch (err) { of[y.kf].erro = String(err.message).slice(0, 80); gravar(of); log("Planos: oferta não enviada: " + err.message); }
        break; // uma por vez
      }
    }
    if (Date.now() - statusEm > 1800000) {
      statusEm = Date.now();
      const v = Object.values(of), mes = somaDias(hoje, -30), quando = new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
      await api("POST", { company_id: e.company_id, acao: "pl_status", status: `ok: ${quando} · últimos 30 dias: ${v.filter((x) => x.em >= mes && x.como === "convite").length} convite(s) e ${v.filter((x) => x.em >= mes && x.como === "conversa").length} oferta(s) na conversa · ${v.filter((x) => x.fechou && x.fechou >= mes).length} plano(s) fechado(s) depois da oferta` }).catch(() => {});
    }
  }
  async function rodar(e, hoje = hojeSP()) {
    if (ocupado || !e || !e.planos) return; ocupado = true;
    try { await passo(e, hoje); } finally { ocupado = false; }
  }
  return { rodar };
}

// ---------- ofertas no final do agendamento (upsell) ----------
// "Oferecer quando": condições separadas por vírgula. "corte" = tem corte; "corte + barba" = tem os dois;
// "sem barba" = não tem barba. Ex.: "corte, sem barba" = tem corte e não tem barba. Vazio = sempre.
export function regraQuando(q) {
  const ou = [], sem = [];
  for (const parte of String(q || "").split(/[,;]/).map((x) => semAcento(x)).filter(Boolean)) {
    const m = parte.match(/^(sem|nao|exceto)\s+(.+)$/);
    if (m) sem.push(...m[2].split(/\s*\+\s*|\s+e\s+/).filter(Boolean));
    else ou.push(parte.split(/\s*\+\s*|\s+e\s+/).filter(Boolean));
  }
  return { ou, sem };
}
// A oferta vale para os serviços escolhidos? (nomes já sem acento)
export function regraVale(regra, nomes) {
  const tem = (w) => nomes.some((n) => n.includes(w));
  if ((regra.sem || []).some(tem)) return false;
  return !(regra.ou || []).length || regra.ou.some((todas) => todas.every(tem));
}
// Texto da regra para a Sofia ("tiver corte e barba" / "tiver corte e não tiver barba").
export function regraTexto(q) {
  const { ou, sem } = regraQuando(q);
  const a = ou.map((t) => t.join(" e ")).join(" ou "), b = sem.join(" nem ");
  return a || b ? `ofereça só quando o cliente ${a ? `for fazer ${a}` : ""}${a && b ? " e " : ""}${b ? `não for fazer ${b}` : ""}` : "";
}
// Liga cada oferta do app aos serviços da AppBarber pelo nome (sem acento/maiúsculas). Oferta com serviço que não
// existe na agenda fica de fora (e vai para o log). "quando": palavras do serviço escolhido para mostrar a oferta.
export function ofertasDe(upsell, servicos, log = () => {}) {
  const out = [];
  for (const [i, o] of (upsell || []).entries()) {
    const nomes = String(o.servicos || "").split(/\s+\+\s+/).map((x) => x.trim()).filter(Boolean);
    const achados = nomes.map((n) => servicos.find((x) => semAcento(x.nome) === semAcento(n)));
    if (!nomes.length || achados.some((x) => !x)) { log(`Ofertas: "${o.texto}" ficou de fora (serviço não encontrado na agenda: ${nomes.filter((n, k) => !achados[k]).join(", ")}).`); continue; }
    out.push({ id: i, texto: o.texto, valor: Number(o.valor) || 0, codigos: achados.map((x) => x.codigo), regra: regraQuando(o.quando), semTempo: !!o.semTempo });
  }
  return out;
}
// Publica a lista de serviços da AppBarber no app (Integração › Ofertas), para sugerir os nomes certos. 1 vez a cada 6 h.
let servicosPublicadosEm = 0;
export async function publicarServicos(e, api, req = null) {
  if (!e || !e.appbarber || Date.now() - servicosPublicadosEm < 6 * 3600000) return;
  servicosPublicadosEm = Date.now();
  const ab = ferramentasAppBarber({ cfg: e.appbarber, ...(req ? { req } : {}), creditos: (n, zero) => api("POST", { company_id: e.company_id, acao: "ab_uso", creditos: n, ...(zero ? { sem_saldo: true } : {}) }).catch(() => {}) });
  const lista = (await ab.servicos()).map((x) => ({ codigo: x.codigo, nome: x.nome, preco: Number(x.preco) || null, minutos: x.minutos }));
  await api("POST", { company_id: e.company_id, acao: "ab_servicos", lista });
}

// ---------- totem de autoatendimento (tablet na recepção) ----------
// O tablet manda pedidos pela função "totem"; aqui o servidor (IP liberado na AppBarber) busca os pedidos pela
// sync-servidor (espera longa), executa na AppBarber e devolve a resposta. Check-in = status "No local" na AppBarber.
export function criarTotem({ dir, log = () => {}, api = async () => ({}), sock = () => null, req = null, relogio = agoraSP, resultados = null }) {
  const CHEG = join(dir, "totem-chegadas.json");
  const ler = (f, pad) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return pad; } };
  let e = null, ab = null, abChave = "", rodando = false, cache = { em: 0, dia: "", lista: [] }, statusEm = 0;
  let conta = { dia: "", checkins: 0, agendados: 0 };
  const zera = () => { const d = hojeSP(); if (conta.dia !== d) conta = { dia: d, checkins: 0, agendados: 0 }; };
  const hr = (h) => String(h).replace(/:00$/, "h").replace(":", "h");
  // Cadastro por celular, guardado 5 min (busca e agendamento seguidos gastam 1 consulta só).
  const cads = new Map();
  async function cadastro(fone) { const k = chaveFone(fone), c = cads.get(k); if (c && Date.now() - c.em < 300000) return c.v; const v = await ab.clienteDe(fone); cads.set(k, { em: Date.now(), v }); return v; }
  const hhmmDe = (t) => { const m = String(t || "").match(/(\d{2}):(\d{2})/); return m ? `${m[1]}:${m[2]}` : ""; };
  const amigavel = (err) => /CHOQUE|não está mais livre/i.test(err.message) ? "Esse horário acabou de ser ocupado. Escolha outro, por favor."
    : /saldo insuficiente/i.test(err.message) ? "A agenda está indisponível agora. Fale com a recepção, por favor." : "Não consegui concluir agora. Fale com a recepção, por favor.";

  // Agenda de hoje (status agendado), guardada por 40 s: várias buscas seguidas gastam 1 crédito só.
  async function hoje(forcar = false) {
    const d = hojeSP();
    if (!forcar && cache.dia === d && Date.now() - cache.em < 40000) return cache.lista;
    const linhas = await ab.agenda(d, d, "1");
    cache = { em: Date.now(), dia: d, lista: linhas.map((a) => ({ codigo: Number(a.appointment_code || a.scheduling_code), hora: hhmmDe(a.scheduling_start), fone: chaveFone(a.client_phone), nome: String(a.client_name || "").trim(),
      profissional: String(a.employee_name || "").trim(), servico: String(a.service_description || "").trim() })).filter((x) => x.codigo && x.hora) };
    return cache.lista;
  }
  const chegadas = () => { const c = ler(CHEG, {}); return c.dia === hojeSP() ? c : { dia: hojeSP(), codigos: [] }; };
  const gravarChegada = (cods) => { const c = chegadas(); c.codigos = [...new Set([...c.codigos, ...cods])]; try { writeFileSync(CHEG, JSON.stringify(c), { mode: 0o600 }); } catch { /* segue */ } };
  // Horários de hoje deste celular, juntando os serviços seguidos com o mesmo profissional.
  async function meusHoje(fone) {
    const k = chaveFone(fone), feitos = new Set(chegadas().codigos);
    const lista = (await hoje()).filter((x) => x.fone === k).sort((a, b) => a.hora.localeCompare(b.hora));
    const grupos = [];
    for (const x of lista) {
      const g = grupos.find((y) => y.profissional === x.profissional);
      if (g) { g.codigos.push(x.codigo); if (x.servico && !g.servicos.includes(x.servico)) g.servicos.push(x.servico); }
      else grupos.push({ codigos: [x.codigo], hora: x.hora, profissional: x.profissional, servicos: x.servico ? [x.servico] : [], nome: x.nome });
    }
    return grupos.map((g) => ({ ...g, chegou: g.codigos.every((c) => feitos.has(c)) }));
  }
  async function avisarProf(profissional, texto) {
    const s = sock(); if (!s || !e.totem.avisar) return false;
    const p = semAcento(profissional).split(" ")[0];
    const b = (e.barbers || []).find((x) => x.phone && semAcento(x.name).split(" ")[0] === p);
    if (!b) return false;
    const d = so(b.phone), cand = d.length <= 11 ? "55" + d : d;
    try { const [w] = await s.onWhatsApp(cand); if (!w || !w.exists) return false; await s.sendMessage(w.jid, { text: texto }); return true; } catch { return false; }
  }

  async function executar(acao, d) {
    zera();
    if (acao === "buscar") {
      const grupos = await meusHoje(d.fone);
      if (grupos.length) return { agendado: true, nome: primeiroNome(grupos[0].nome), horarios: grupos.map((g) => ({ codigos: g.codigos, hora: g.hora, profissional: primeiroNome(g.profissional), servicos: g.servicos.join(" + "), chegou: g.chegou })) };
      const cad = await cadastro(d.fone);
      return { agendado: false, cadastrado: !!cad, nome: cad ? primeiroNome(cad.nome) : "" };
    }
    if (acao === "chegou") {
      const grupos = await meusHoje(d.fone), meus = new Set(grupos.flatMap((g) => g.codigos));
      const cods = d.codigos.filter((c) => meus.has(c)); if (!cods.length) throw new Error("agendamento não é deste celular");
      const ja = new Set(chegadas().codigos), g = grupos.find((x) => x.codigos.some((c) => cods.includes(c)));
      if (cods.every((c) => ja.has(c))) return { profissional: primeiroNome(g.profissional), hora: g.hora, avisado: false, ja: true }; // já tinha feito
      for (const c of cods) if (!ja.has(c)) await ab.noLocal(c); // "No local" pode alternar: nunca manda duas vezes
      gravarChegada(cods); conta.checkins++;
      const avisado = await avisarProf(g.profissional, `✅ ${primeiroNome(g.nome) || "Seu cliente"} chegou para o horário das ${hr(g.hora)} (${g.servicos.join(" + ")}). Check-in feito no totem da recepção.`);
      log(`Totem: check-in (${primeiroNome(g.nome) || "cliente"}, ${g.hora}).`);
      return { profissional: primeiroNome(g.profissional), hora: g.hora, avisado };
    }
    if (acao === "servicos") {
      const todos = await ab.servicos(), lista = todos.filter((x) => x.tipo === 1 && x.nome);
      // Cada oferta leva os profissionais que fazem todos os serviços dela: o totem só oferece o que o escolhido faz.
      const ofertas = ofertasDe(e.totem.upsell, todos, log);
      for (const o of ofertas) {
        try { const listas = await Promise.all(o.codigos.map((c) => ab.profissionais(c))); o.profs = listas.reduce((acc, l) => acc.filter((x) => l.some((p) => p.codigo === x)), listas[0].map((p) => p.codigo)); }
        catch { o.profs = null; } // sem a lista: não filtra
      }
      return { servicos: lista.map((x) => ({ codigo: x.codigo, nome: x.nome, minutos: x.minutos, preco: Number(x.preco) || null })), ofertas };
    }
    if (acao === "horarios") {
      const agora = relogio(), ehHoje = d.data === hojeSP();
      // "Sem preferência" (e parecidos) que a AppBarber devolve como profissional fica de fora; horários em ordem.
      const falso = (n) => /sem prefer|qualquer|ordem de chegada|indiferente/i.test(n);
      const lista = (await ab.horarios(d.data, d.servico)).filter((p) => !falso(p.nome)).map((p) => ({ codigo: p.codigo, nome: p.nome,
        horarios: p.horarios.filter((h) => !ehHoje || mins(h) >= agora + 5).sort().map((h) => ({ hora: h, preco: Number((p.precos[h] || [])[0]) || null })) })).filter((p) => p.horarios.length);
      // Todos os profissionais que fazem o serviço (para escolher antes do dia), mesmo quem não tem horário nesse dia.
      const todos = (await ab.profissionais(d.servico).catch(() => [])).filter((p) => p.nome && !falso(p.nome)).map((p) => ({ codigo: p.codigo, nome: p.nome }));
      return { profissionais: lista, todos };
    }
    if (acao === "agendar") {
      const todos = await ab.servicos();
      let servs = d.servicos.map((c) => todos.find((x) => x.codigo === c)).filter(Boolean);
      if (servs.length !== d.servicos.length) throw new Error("serviço não encontrado");
      // Ofertas "sem tempo extra" (ex.: sobrancelha): não ocupam a agenda. Se houver um combo do serviço principal com o
      // adicional (ex.: "1.1 Corte Tradicional" + sobrancelha → "1.2 Corte Tradicional & Sobrancelha") com o mesmo tempo,
      // troca pelo combo; senão, o adicional vai só na observação, para entrar na comanda.
      const semTempo = ofertasDe(e.totem.upsell, todos).filter((o) => o.semTempo), naComanda = [];
      for (const o of semTempo) {
        if (!o.codigos.every((c) => servs.some((x) => x.codigo === c))) continue;
        servs = servs.filter((x) => !o.codigos.includes(x.codigo));
        const extra = todos.find((x) => x.codigo === o.codigos[0]), palavra = semAcento(extra.nome).replace(/^[\d.]+\s*/, "").split(/\s+/)[0];
        const nucleo = (n) => semAcento(n).replace(/^[\d.]+\s*/, "").replace(/\(.*?\)/g, "").trim();
        let trocou = false;
        servs = servs.map((x) => { if (trocou) return x; const combo = todos.find((y) => y.tipo === 1 && y.codigo !== x.codigo && nucleo(y.nome).includes(nucleo(x.nome)) && nucleo(y.nome).includes(palavra) && Number(y.minutos) === Number(x.minutos));
          if (combo) { trocou = true; return combo; } return x; });
        if (!trocou) naComanda.push(`${o.texto}${o.valor ? ` por R$ ${o.valor}` : ""}`);
        else d.adicionais = (d.adicionais || []).filter((x) => !x.startsWith(o.texto)); // o combo já tem o adicional
      }
      if (naComanda.length) d.adicionais = (d.adicionais || []).filter((a) => !naComanda.some((n) => a.startsWith(n.split(" por ")[0]))).concat(naComanda.map((n) => `${n} (incluir na comanda, sem tempo extra)`));
      const livre = (await ab.horarios(d.data, servs[0].codigo)).find((p) => p.codigo === d.profissional);
      if (!livre || !livre.horarios.includes(d.hora)) throw new Error("CHOQUE: horário não está mais livre");
      let cad = await cadastro(d.fone);
      if (!cad) {
        if (!d.nome || d.nome.split(" ").length < 2) throw new Error("falta nome e sobrenome");
        await ab.salvarCliente({ fone: d.fone, nome: d.nome, origem: "Totem da recepção" });
        cad = { nome: d.nome }; cads.set(chaveFone(d.fone), { em: Date.now(), v: cad });
      }
      const valorT = await valorAgendamento(ab, servs, d.profissional, d.data, d.hora);
      const r = await ab.criar({ fone: d.fone, nome: cad.nome, servicos: servs, profissional: d.profissional, quando: `${d.data} ${d.hora}`, obs: ["Agendado pelo cliente no totem da recepção", ...(d.adicionais || []).map((a) => "Adicional: " + a)].join(" · ").slice(0, 250) });
      conta.agendados++; cache.em = 0;
      if (resultados) resultados.evento(e.company_id, { tipo: "agendamento", origem: "totem", valor: valorT + (d.adicionais || []).reduce((t, a) => { const m = String(a).match(/R\$\s*([\d.,]+)/); return t + (m && /comanda/i.test(a) ? Number(m[1].replace(",", ".")) || 0 : 0); }, 0), ref: `ag:${(r.codigos || []).join(",")}`, dados: { data: d.data, hora: d.hora, profissional: livre.nome, servicos: servs.map((x) => x.nome).join(" + "), codigos: r.codigos || [], adicionais: d.adicionais || [] } });
      // Marcou para agora (até 1h30): ele já está aqui, então o check-in vai junto.
      let chegou = false;
      if (d.data === hojeSP() && mins(d.hora) - relogio() <= 90 && r.codigos.length) {
        try { for (const c of r.codigos) await ab.noLocal(c); gravarChegada(r.codigos); chegou = true; conta.checkins++; } catch (err) { log("Totem: check-in do agendamento novo falhou: " + err.message); }
      }
      const pn = primeiroNome(livre.nome);
      if (d.data === hojeSP()) await avisarProf(livre.nome, `🆕 ${primeiroNome(cad.nome)} agendou pelo totem da recepção: hoje às ${hr(d.hora)} (${servs.map((x) => x.nome).join(" + ")})${chegou ? " e já está na barbearia" : ""}.`);
      log(`Totem: agendamento (${primeiroNome(cad.nome)}, ${d.data} ${d.hora}).`);
      return { nome: primeiroNome(cad.nome), data: d.data, hora: d.hora, profissional: pn, servicos: servs.map((x) => x.nome).join(" + "), chegou };
    }
    throw new Error("ação desconhecida");
  }

  async function tratar(p) {
    let ok = true, resposta;
    try { resposta = await executar(p.acao, p.dados || {}); }
    catch (err) { ok = false; resposta = { erro: amigavel(err) }; log(`Totem: ${p.acao} não deu certo (${err.message}).`); }
    await api("POST", { company_id: p.company_id, acao: "totem_resposta", id: p.id, ok, resposta }).catch((err) => log("Totem: resposta não enviada: " + err.message));
  }
  async function laco() {
    rodando = true;
    while (e) {
      try {
        const r = await api("GET", null, `?acao=totem_espera&empresas=${encodeURIComponent(e.company_id)}`);
        for (const p of r.pedidos || []) tratar(p); // em paralelo: o próximo pedido não espera este terminar
      } catch (err) { log("Totem: " + err.message); await espera(15000); }
    }
    rodando = false;
  }
  async function status() {
    if (!e || Date.now() - statusEm < 30 * 60000) return; statusEm = Date.now(); zera();
    const quando = new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    await api("POST", { company_id: e.company_id, acao: "tt_status", status: `ok: ${quando} · hoje: ${conta.checkins} check-in(s) e ${conta.agendados} agendamento(s) pelo totem.` }).catch(() => {});
  }
  function configurar(emp) {
    e = emp && emp.totem && emp.appbarber ? emp : null;
    if (!e) return;
    const k = `${e.appbarber.codigo_estabelecimento}|${e.appbarber.appbarber_api_key}`;
    if (!ab || abChave !== k) { abChave = k; ab = ferramentasAppBarber({ cfg: e.appbarber, ...(req ? { req } : {}), creditos: (n, zero) => api("POST", { company_id: e.company_id, acao: "ab_uso", creditos: n, ...(zero ? { sem_saldo: true } : {}) }).catch(() => {}) }); }
    if (!rodando) { laco(); log("Totem da recepção ligado."); }
    status();
  }
  return { configurar, executar };
}
