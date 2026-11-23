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

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SOFIA_VERSAO = "4.8";
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
  // Agendamentos futuros deste telefone (de hoje até 30 dias).
  async function agendamentosDe(fone) {
    const hoje = hojeSP(), k = chaveFone(fone);
    const q = new URLSearchParams({ start_date: hoje, end_date: somaDias(hoje, 30), status_type: "1" }); if (filial) q.set("branch_code", filial);
    const lista = (await chamar("GET", "/v1/appointments/history?" + q)).data || [];
    return lista.filter((a) => chaveFone(a.client_phone) === k && (!a.scheduling_status || /agendad|confirmad/i.test(a.scheduling_status))).map((a) => {
      const m = String(a.scheduling_start || "").match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
      return { codigo: Number(a.appointment_code || a.scheduling_code), comanda: Number(a.invoice_code) || null, quando: m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}` : a.scheduling_start, profissional: String(a.employee_name || "").trim(), servico: String(a.service_description || "").trim(), nome: String(a.client_name || "").trim() };
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
    const r = (await chamar(codigo ? "PUT" : "POST", codigo ? `/v1/establishment/clients/${encodeURIComponent(codigo)}` : "/v1/establishment/clients", corpo)).data || {};
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
  return { servicos, profissionais, horarios, agendamentosDe, ultimoDe, buscarClientes, nomeDe, clienteDe, salvarCliente, criar, cancelarComanda, agenda, noLocal };
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
  { name: "agendar", description: "Marca o horário na AppBarber. SÓ use depois que o cliente confirmou com clareza (ex.: 'sim', 'pode marcar') o resumo com serviço(s), profissional, dia e hora.", strict: true,
    input_schema: obj({ servicos: { type: "array", items: { type: "integer" }, description: "Códigos dos serviços, na ordem" }, profissional: { type: "integer", description: "Código do profissional (de ver_horarios)" }, data_hora: { type: "string", description: "AAAA-MM-DD HH:MM" }, nome_cliente: { type: "string", description: "Nome completo do cliente" }, observacao: { type: ["string", "null"], description: "Recado curto para o barbeiro(a), ex.: Primeira vez na barbearia; ou null" } }, ["servicos", "profissional", "data_hora", "nome_cliente", "observacao"]) },
  { name: "remarcar", description: "Troca um horário já marcado por outro: marca o novo e depois cancela o antigo. SÓ use depois que o cliente confirmou o novo horário.", strict: true,
    input_schema: obj({ codigo_agendamento: { type: "integer", description: "Código do horário atual (de consultar_cliente)" }, servicos: { type: "array", items: { type: "integer" } }, profissional: { type: "integer" }, data_hora: { type: "string", description: "AAAA-MM-DD HH:MM" } }, ["codigo_agendamento", "servicos", "profissional", "data_hora"]) },
  { name: "cancelar", description: "Cancela um horário marcado do cliente. SÓ use depois que o cliente confirmou que quer cancelar aquele horário.", strict: true,
    input_schema: obj({ codigo_agendamento: { type: "integer", description: "Código do horário (de consultar_cliente)" } }, ["codigo_agendamento"]) },
  { name: "enviar_arte", description: "Envia ao cliente, no WhatsApp, uma das artes (imagens) da barbearia listadas nas instruções, como a tabela de planos. Use quando a situação da arte acontecer (ex.: cliente perguntou de planos). Depois de enviar, termine sua resposta com a pergunta indicada no resultado.", strict: true,
    input_schema: obj({ arte: { type: "string", description: "Nome exato da arte, como aparece na lista de artes" } }, ["arte"]) },
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

export function promptSistema({ nome, barbearia, notas, brand, artes = [], horario = null, upsell = [] }) {
  const casa = brand === "salao" ? "salão" : "barbearia", hor = textoHorario(horario);
  return `Você é ${nome}, atendente da ${barbearia} (${casa}) no WhatsApp. Você conversa com clientes para tirar dúvidas e marcar, remarcar ou cancelar horários direto no sistema de agenda (AppBarber), usando as ferramentas.

Jeito de falar:
- Simpática, carismática e acolhedora, como a melhor recepcionista da casa. Português do Brasil, natural e leve.
- Mensagens curtas, como no WhatsApp: 1 a 3 frases. Pode usar emoji com moderação (1 ou 2 por mensagem) 😊 Não liste todos os barbeiros nem todos os horários: escolha os 2 ou 3 mais próximos do que o cliente pediu.
- Se o cliente falar de algo que não está no histórico desta conversa (ex.: "deu certo?", "e aí, marcou?"), não diga que não sabe do que se trata: use consultar_cliente e responda com base nos horários dele (ex.: se não houver horário marcado, peça desculpas e retome o agendamento).
- Nunca fale das suas limitações ("não consigo ver", "não tenho acesso", "por aqui não aparece"). Se precisar de uma informação, simplesmente pergunte ao cliente com naturalidade (ex.: "Lembra com qual barbeiro ele cortou da última vez? 😊").
- Chame o cliente pelo primeiro nome quando souber. Não se apresente como robô nem fale de "sistema", "ferramenta" ou "IA", a não ser que perguntem; se perguntarem, diga com naturalidade que é a assistente virtual da ${barbearia}.
- Sem listas longas nem markdown (nada de **negrito** ou #). Ao oferecer horários, sugira 2 ou 3 opções próximas do que o cliente pediu.
- UMA pergunta por mensagem (nunca "você tem preferência de barbeiro E qual horário?", nem "qual dia E qual serviço?"). Mande UMA mensagem por vez de resposta: não mande duas respostas seguidas para o mesmo pedido. Para agendar, siga esta ordem e pule o que o cliente já disse: 1) qual serviço; 2) preferência de barbeiro(a); 3) dia e período (manhã, tarde ou noite); 4) ofereça 2 ou 3 horários;${upsell.length ? " 5) ofereça o adicional (veja Oferta no final); 6) resumo para confirmar." : " 5) resumo para confirmar."} Se o cliente responder só parte, siga com o que já sabe e pergunte só o que falta, sem repetir a pergunta inteira.
- Antes de consultar ver_horarios, não diga que tem horário ("tem sim"): diga que vai verificar.
- Barbeiro sem horário livre no dia pedido: diga que a agenda dele está completa nesse dia (ex.: "A agenda do Lucas está completa hoje, todos os horários já foram reservados 😊"); nunca diga que ele não está disponível, não está na agenda ou não trabalha. Ofereça, nessa ordem: o próximo dia com horário dele (proximo_dia_com_horario), outro barbeiro no mesmo dia, ou a lista de espera.
- Ao falar de horário, diga sempre com quem: ex. "17h com o Igor ou 17h20 com o Izaquias". Nunca solte um horário sem o barbeiro(a).

Regras (muito importantes):
- Nunca invente preço, serviço, profissional ou horário: tudo vem das ferramentas.
- Para explicar como é um serviço, use só o que está nas Informações da casa ou na observação do serviço (ver_servicos). Se não tiver, diga que o barbeiro(a) explica certinho no atendimento ou pergunte à recepção; não descreva por conta própria.
- Preço: o valor que ver_horarios traz para o profissional naquele dia é o CERTO e vale sobre qualquer tabela: ele já tem a promoção do dia e o preço próprio de cada profissional (ex.: o dono ou um barbeiro sênior pode cobrar mais). Sempre que for falar o preço de um horário, use esse valor. As tabelas das Informações da casa servem para responder preço antes de consultar a agenda e para explicar a promoção dos dias; se o valor de ver_horarios for diferente da tabela para um profissional, vale o de ver_horarios. Promoção: destaque 🎉 só na primeira vez que falar de preço e de novo no resumo para confirmar; nas outras mensagens, não repita. Só fale da promoção/economia de outros dias para um profissional se ele atender nesses dias com o valor menor (confira em ver_horarios); se o profissional tem preço próprio ou não atende nos dias da promoção, não fale da promoção para ele (pode oferecer outro profissional nos dias promocionais, se o cliente quiser economizar). Se perguntarem o preço sem dizer o dia nem o profissional, informe o valor de hoje pela tabela (se for dia promocional, diga que hoje está em promoção). Se não souber o valor, diga que vai verificar com a recepção (chamar_recepcao).
- Antes de agendar, remarcar ou cancelar, mande um resumo (serviço, profissional, dia da semana, data e hora) e espere o cliente confirmar. Só então use a ferramenta. Nunca marque sem confirmação.
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
- Quando o cliente quiser um serviço e NÃO disser com quem: se ele é cadastrado, use ultimo_atendimento; se houver, ofereça o mesmo barbeiro(a) (ex.: "Quer marcar com o Well de novo, como da última vez? 😊"). Se não houver, ou se for cliente novo, pergunte se tem preferência de barbeiro(a) (ex.: "Você tem preferência de barbeiro(a)? 😊"). Se ele já disse o nome, não pergunte. Se ele não tiver preferência, ofereça quem tem horário mais perto do que ele pediu.
- Lista de espera: se o cliente quer um dia e horário específicos que estão cheios e diz que não pode em outro dia ou horário, ofereça colocar na lista de espera daquele dia/faixa (com o barbeiro dele, se ele fizer questão). Se ele aceitar, use lista_de_espera. Quando a lista avisa de uma vaga, a mensagem aparece no contexto: se o cliente quiser, confira o horário (ver_horarios) e siga o resumo normal para agendar.
- Depois de cancelar um horário, nunca termine com uma afirmação ("quando quiser, é só chamar"): termine sempre perguntando "Para quando você gostaria de reagendar, [primeiro nome]?".
- Remarcar ou cancelar: só horários do próprio cliente (consultar_cliente). Confirme qual horário antes.
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
${upsell.length ? `\nOferta no final (upsell): depois que o cliente escolher o serviço, o profissional e o horário, e ANTES do resumo para confirmar, ofereça UMA vez, numa frase leve e animada, o adicional que mais combina com o que ele vai fazer (só um), por exemplo: "Aproveita e adiciona uma sobrancelha por apenas R$ 15? 😉". Opções:\n${upsell.map((o) => `- ${o.texto}${o.valor ? ` por apenas R$ ${String(o.valor).replace(".", ",")}` : ""} (na agenda: ${o.servicos})${regraTexto(o.quando) ? `: ${regraTexto(o.quando)}` : ""}`).join("\n")}\nNão ofereça o que ele já vai fazer. Se ele aceitar, inclua esse(s) serviço(s) no agendar, depois dos outros e com o mesmo profissional, e coloque na observação "Adicional: <oferta> por R$ <valor>". Se ele recusar ou não comentar, siga sem insistir. Se o adicional não couber no horário ou o profissional não fizer esse serviço (o agendar dá erro por causa dele), marque sem o adicional e avise com naturalidade, ou ofereça outro horário.\n` : ""}${notas ? `\nInformações da ${casa} (passadas pelo dono, use quando ajudar):\n${notas}\n` : ""}${artes.length ? `\nArtes que você pode enviar com enviar_arte (envie a arte em vez de digitar a tabela inteira; depois explique só o que o cliente perguntar):\n${artes.map((a) => `- "${a.nome}": enviar quando ${a.quando || "o assunto da arte aparecer"}`).join("\n")}\n` : ""}`;
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
      const bate = (nome) => { const q = String(input.profissional).toLowerCase().trim(), n = String(nome || "").toLowerCase(); return n.includes(q) || q.includes(n.split(" ")[0]); };
      if (input.profissional) {
        const f = lista.filter((p) => bate(p.nome) && p.horarios.length);
        if (f.length) lista = f;
        else {
          // Ele faz esse serviço? Então está com a agenda completa nesse dia: procura o próximo dia com horário dele (até 6 dias).
          const faz = (await ab.profissionais(input.servico).catch(() => [])).some((p) => bate(p.nome)) || lista.some((p) => bate(p.nome));
          if (!faz) return { aviso: `${input.profissional} não faz esse serviço (ou não foi encontrado)`, outros_com_horario: lista.filter((p) => p.horarios.length).map((p) => p.nome) };
          let proximo = null;
          for (let i = 1; i <= 6 && !proximo; i++) {
            const dd = new Date(input.data + "T12:00:00Z"); dd.setUTCDate(dd.getUTCDate() + i); const iso = dd.toISOString().slice(0, 10);
            const p = (await ab.horarios(iso, input.servico).catch(() => [])).find((x) => bate(x.nome) && x.horarios.length);
            if (p) proximo = { dia: `${DIAS[dd.getUTCDay()]}, ${iso.split("-").reverse().join("/")}`, data: iso, primeiros: p.horarios.slice(0, 4), valor_com_ele_nesse_dia: reais(((p.precos || {})[p.horarios[0]] || [])[0]) || "confira com ver_horarios" };
          }
          return { agenda_completa: true, profissional: input.profissional, nota: `A agenda de ${input.profissional} está completa nesse dia (todos os horários já foram reservados). Diga isso com essas palavras, de forma profissional; nunca diga que ele não está disponível, não está na agenda ou não trabalha.`, proximo_dia_com_horario: proximo, outros_com_horario_nesse_dia: lista.filter((p) => p.horarios.length).map((p) => p.nome) };
        }
      }
      const d = new Date(input.data + "T12:00:00Z");
      return { dia: `${DIAS[d.getUTCDay()]}, ${input.data.split("-").reverse().join("/")}`, profissionais: lista.map((p) => ({ codigo: p.codigo, nome: p.nome, ...precosDoDia(p) })) };
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
      return u ? { ultimo: { dia: u.quando.split("-").reverse().join("/"), barbeiro: u.profissional, servico: u.servico } } : { ultimo: null, nota: "sem atendimento nos últimos 3 meses: pergunte a preferência de barbeiro(a)" };
    }
    case "consultar_cliente": {
      if (!fone) return { aviso: "telefone do cliente desconhecido: peça o número de celular com DDD" };
      const [nome, ag] = await Promise.all([conv.cadastro ? conv.cadastro.nome : ab.nomeDe(fone).catch(() => ""), ab.agendamentosDe(fone)]);
      conv.agenda = ag; if (nome) conv.nome = nome;
      return { nome: nome || (ag[0] && ag[0].nome) || null, cadastrado: !!nome, horarios_marcados: ag.map((a) => ({ codigo: a.codigo, quando: a.quando, servico: a.servico, profissional: a.profissional })) };
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
      let r;
      try { r = await ab.criar({ fone, nome: input.nome_cliente, servicos: servs, profissional: input.profissional, quando: input.data_hora, obs }); }
      catch (e) { if (/^CHOQUE:/.test(e.message)) return { erro: e.message.replace(/^CHOQUE: /, "") + ". Não chame a recepção: ofereça outro horário com tempo seguido para todos os serviços, ou outro profissional." }; throw e; }
      ctx.stats.agendados++; ctx.registro(`agendou ${servs.map((s) => s.nome).join(" + ")} em ${input.data_hora}`);
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
      const prob = await confere(servs, input.profissional, input.data_hora); if (prob) return { erro: prob };
      if (simular) { ctx.stats.remarcados++; return { ok: true, simulado: true }; }
      await ab.criar({ fone, nome: velho.nome || conv.nome || "Cliente", servicos: servs, profissional: input.profissional, quando: input.data_hora });
      // Marca o novo primeiro (para não perder a vaga) e só depois cancela o antigo.
      try { if (!velho.comanda) throw new Error("sem comanda"); await ab.cancelarComanda(velho.comanda, fone); }
      catch (e) { ctx.stats.remarcados++; ctx.pendencia(`remarcou para ${input.data_hora}, mas o horário antigo (${velho.quando}) não foi cancelado (${e.message}): cancele na agenda`); return { ok: true, aviso: "o novo horário foi marcado; o antigo a recepção vai liberar" }; }
      conv.agenda = null; ctx.stats.remarcados++; ctx.registro(`remarcou de ${velho.quando} para ${input.data_hora}`);
      return { ok: true };
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
    case "avisar_equipe": {
      const t = String(input.recado || "").trim().slice(0, 300); if (!t) return { erro: "recado vazio" };
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
      if (ctx.alertar && !simular) await ctx.alertar(`⚠️ Precisa de atendimento: ${String(input.motivo || "").slice(0, 200)}. A conversa ficou como não lida no WhatsApp.`); else if (simular) ctx.registro(`avisaria a equipe no WhatsApp: ${input.motivo}`);
      return { ok: true, nota: "A recepção foi avisada. Diga ao cliente, com simpatia, que a equipe já vai responder." };
    }
  }
  return { erro: "ferramenta desconhecida" };
}

// No começo de cada conversa: o cliente tem cadastro? (1 consulta à AppBarber, pelo celular do WhatsApp)
export async function verificarCadastro(ab, fone, conv) {
  if (!fone) return "[Cadastro: WhatsApp do cliente desconhecido; se for agendar, peça o celular com DDD]";
  try {
    const c = await ab.clienteDe(fone);
    if (!c) { conv.cadastro = null; return "[Cadastro: cliente SEM cadastro na barbearia (cliente novo)]"; }
    conv.cadastro = c; if (c.nome) conv.nome = c.nome;
    return `[Cadastro: cliente cadastrado como ${c.nome || "(sem nome)"}; data de nascimento ${c.nascimento ? "cadastrada" : "NÃO cadastrada"}]`;
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
      catch (e) { out = { erro: e.message }; erro = true; }
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

export function criarSofia({ dir, log, api, sock, conectado = () => true, cmdConectar = () => "gbia-whatsapp-conectar-principal", baixarMidia = null, transcrever = transcreverAudio, abReq = null }) {
  let Anthropic = null, client = null, cfg = null, ab = null, abKey = "";
  const conversas = new Map(); // jid → { mensagens, ultima, ultimaSofia, humanoEm, contexto, nome, agenda, recepcao, fone, fila, ocupado }
  // As conversas sobrevivem a reinícios (atualização, instalador): ficam num arquivo do servidor por até 6 horas.
  const CONV = join(dir, "sofia-conversas.json");
  const CAMPOS = ["mensagens", "inicio", "ultima", "ultimaSofia", "humanoEm", "contexto", "contada", "nome", "recepcao", "fone", "cadastro", "verificado", "sistema", "artes", "feitos", "gasto", "motivo", "pushName", "esperaAte", "esperaDe", "registrada", "regId", "fila", "noturna", "pendTipo", "ultimaCliente"];
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
    const partes = [`${quando} · ${ativa ? "atendendo agora" : "fora do horário dela (a recepção atende)"}`,
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
      janelas: e.sofia.janelas || JANELAS_PADRAO, horario: e.horario || null, artes: Array.isArray(e.sofia.artes) ? e.sofia.artes.filter((a) => a && a.url && a.nome) : [], avisar: so(e.sofia.avisar || ""), alerta: so(e.sofia.alerta || ""), equipe: Array.isArray(e.barbers) ? e.barbers : [], nomesAB: (e.sofia && e.sofia.nomes) || {}, pausaMin: Math.max(15, Math.min(1440, Number(e.sofia.pausa) || 60)), notas: e.sofia.notas || "", upsell: Array.isArray(e.sofia.upsell) ? e.sofia.upsell : [], ab: e.appbarber };
    cfg = novo;
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

  async function processar(jid) {
    const c = conversas.get(jid);
    if (!c || c.ocupado || !c.fila.length) return;
    c.ocupado = true;
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
        const cadLinha = c.verificado ? "" : (c.verificado = true, (await verificarCadastro(ab, c.fone, c)) + "\n" + (jaApresentou(c.fone)
          ? "[Apresentação: você já se apresentou a este cliente em outra conversa; não se apresente de novo]\n"
          : `[Apresentação: é a primeira vez que você fala com este cliente; na sua resposta, apresente-se em uma frase curta e simpática (ex.: "Eu sou a ${cfg.nome}, da ${cfg.barbearia} 😊")]\n`));
        const naoEnviada = c.naoEnviada ? "[Sua resposta anterior NÃO foi enviada, porque o cliente mandou mais mensagens enquanto você respondia. Responda agora considerando tudo.]\n" : ""; c.naoEnviada = false;
        c.mensagens.push({ role: "user", content: agoraTexto(c.fone) + "\n" + cadLinha + naoEnviada + (antes.length
          ? `[Para contexto: mensagens desta conversa enquanto você não estava atendendo]\n${antes.join("\n")}\n\n[Mensagem nova do cliente]\n${novas.join("\n")}`
          : novas.join("\n")) });
        if (!c.contada) { c.contada = true; zera(); stats.conversas++; }
        if (!c.artes) c.artes = cfg.artes; // congeladas junto com as instruções
        const ctx = { ab, fone: c.fone, stats, simular: false, artes: c.artes, enviarArte: (a) => enviarArte(jid, a), registro: (t) => log(`Sofia: ${t}.`),
          falha: (t) => { log(`Sofia: (…${String(c.fone).slice(-4)}) ${t}`); pendencias.push(`(${c.fone ? "…" + c.fone.slice(-4) : "sem fone"}) ${t}`); status().catch(() => {}); },
          listaEspera: (x) => listaEspera(jid, c, x), alertar: (t) => alertaEquipe(c, t), avisarProfissional: (nome, t) => avisarProfissional(c, nome, t), pendencia: (t) => { c.motivo = t; pendencias.push(`${c.nome ? c.nome.split(" ")[0] + " " : ""}(${c.fone ? "…" + c.fone.slice(-4) : "sem fone"}) ${t}`); } };
        const antesStats = { agendou: stats.agendados, remarcou: stats.remarcados, cancelou: stats.cancelados };
        const artesAntes = (c.artesEnviadas || []).length;
        // Instruções congeladas no começo da conversa (mudanças no app valem para as próximas conversas).
        const sistema = c.sistema || (c.sistema = promptSistema({ nome: cfg.nome, barbearia: cfg.barbearia, notas: cfg.notas, brand: cfg.brand, artes: c.artes, horario: cfg.horario, upsell: cfg.upsell }));
        const r = await rodada({ client, modelo: cfg.modelo, sistema, conv: c, ctx });
        stats.gasto += r.gasto; c.gasto = (c.gasto || 0) + r.gasto; c.registrada = false;
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
      log("Sofia: erro na conversa: " + err.message);
      c.recepcao = true; c.motivo = "erro: " + String(err.message).slice(0, 120); stats.recepcao++; pendencias.push(`(${c.fone ? "…" + c.fone.slice(-4) : "sem fone"}) a Sofia teve um erro e parou nesta conversa`);
      await status(`erro: ${new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })} · ${String(err.message).slice(0, 200)}. A conversa ficou para a recepção.`);
      // O cliente não pode ficar sem resposta: avisa que a equipe continua e chama a equipe.
      try { await enviar(jid, "Desculpa, tive um probleminha aqui agora 😕 Já chamei a nossa equipe, que vai continuar com você por aqui em instantes."); } catch { /* sem conexão */ }
      alertaEquipe(c, `⚠️ A ${cfg ? cfg.nome : "Sofia"} teve um erro e parou nesta conversa: responda o cliente. (${String(err.message).slice(0, 120)})`).catch(() => {});
    } finally { c.ocupado = false; salvarConversas(); }
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
      clearTimeout(c.timer); c.timer = setTimeout(() => processar(jid).catch(() => {}), 7000);
    }
  }

  // Convite do "retorno no tempo certo" enviado: a Sofia fica sabendo do horário sugerido e, se a Sofia estiver ligada,
  // responde o cliente nas próximas 3 horas (se a recepção entrar na conversa, ela sai como sempre).
  function retornoEnviado(jid, id, { fone = "", nome = "", texto = "", detalhe = "" } = {}) {
    if (id) daSofia.add(id);
    const c = obter(jid, null); if (!c.fone && fone) c.fone = fone; if (!c.pushName && nome) c.pushName = nome;
    anotar(c, "Mensagem automática da barbearia (convite de retorno: o cliente costuma voltar nesse prazo)", `${texto} ${detalhe}`.trim());
    c.ultima = Date.now();
    if (ligada()) { c.esperaDe = Date.now(); c.esperaAte = Date.now() + 3 * 3600000; c.recepcao = false; }
  }

  return { configurar, aoReceber, marcarMinha, ligada, relatorioDaSemana, retornoEnviado, salvar: () => salvarConversas(true), ativaAgora: () => !!(cfg && client && dentroDaJanela(cfg.janelas)), status };
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
    let h = ler(HIST, null);
    if (!h || h.cid !== e.company_id) h = { cid: e.company_id, ate: null, cli: {} };
    const env = ler(ENV, {});
    // Histórico: na 1ª vez, 12 meses de atendimentos realizados (12 créditos); depois, 1 vez por dia, os últimos dias (1 crédito).
    if (h.ate !== hoje) {
      const ini = h.ate ? somaDias(h.ate, -3) : somaDias(hoje, -365), linhas = [];
      for (let fim = somaDias(hoje, -1), i = 0; fim >= ini && i < 13; i++) { const de = somaDias(fim, -30) < ini ? ini : somaDias(fim, -30); linhas.push(...await ab.agenda(de, fim, "2")); fim = somaDias(de, -1); }
      juntarVisitas(h.cli, linhas);
      // Quem recebeu o convite e veio depois: "voltou".
      for (const [kf, x] of Object.entries(env)) if (x.enviado && !x.voltou && h.cli[kf]) { const v = h.cli[kf].v.find((y) => y[0] >= x.em); if (v) x.voltou = v[0]; }
      h.ate = hoje; h.marcadosEm = 0; gravar(HIST, h); gravar(ENV, env);
      log(`Retorno: histórico atualizado (${Object.keys(h.cli).length} clientes).`);
    }
    // Quem já tem horário marcado (de hoje a 30 dias) não recebe. Conferido a cada 1h30 (2 créditos).
    if (!h.marcadosEm || Date.now() - h.marcadosEm > 90 * 60000) {
      // Inclui quem já foi atendido hoje (ainda não está no histórico, que vai até ontem).
      const ag = [...await ab.agenda(hoje, somaDias(hoje, 30), "1"), ...await ab.agenda(hoje, hoje, "2")];
      h.marcados = [...new Set(ag.map((x) => so(x.client_phone)).filter((f) => f.length >= 10).map(chaveFone))];
      h.marcadosEm = Date.now(); gravar(HIST, h);
    }
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
    out.push({ id: i, texto: o.texto, valor: Number(o.valor) || 0, codigos: achados.map((x) => x.codigo), regra: regraQuando(o.quando) });
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
export function criarTotem({ dir, log = () => {}, api = async () => ({}), sock = () => null, req = null, relogio = agoraSP }) {
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
      const todos = await ab.servicos(), servs = d.servicos.map((c) => todos.find((x) => x.codigo === c)).filter(Boolean);
      if (servs.length !== d.servicos.length) throw new Error("serviço não encontrado");
      const livre = (await ab.horarios(d.data, servs[0].codigo)).find((p) => p.codigo === d.profissional);
      if (!livre || !livre.horarios.includes(d.hora)) throw new Error("CHOQUE: horário não está mais livre");
      let cad = await cadastro(d.fone);
      if (!cad) {
        if (!d.nome || d.nome.split(" ").length < 2) throw new Error("falta nome e sobrenome");
        await ab.salvarCliente({ fone: d.fone, nome: d.nome, origem: "Totem da recepção" });
        cad = { nome: d.nome }; cads.set(chaveFone(d.fone), { em: Date.now(), v: cad });
      }
      const r = await ab.criar({ fone: d.fone, nome: cad.nome, servicos: servs, profissional: d.profissional, quando: `${d.data} ${d.hora}`, obs: ["Agendado pelo cliente no totem da recepção", ...(d.adicionais || []).map((a) => "Adicional: " + a)].join(" · ").slice(0, 250) });
      conta.agendados++; cache.em = 0;
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
