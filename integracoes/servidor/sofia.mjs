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

export const SOFIA_VERSAO = "1.9";
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
      return { codigo: p.employee_code, nome: String(p.employee_nickname || p.employee_name || "").trim(), horarios: Object.keys(precos), precos }; }));
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
  // Cadastro do cliente pelo celular: { codigo, nome, nascimento } ou null.
  async function clienteDe(fone) {
    const d = (await chamar("GET", `/v1/establishment/clients?cellphone=${so(fone).replace(/^55(?=\d{10,11}$)/, "")}`)).data || [];
    const lista = Array.isArray(d) ? d : (d.items || d.clients || []);
    const c = lista.find((x) => chaveFone(x.person_cellphone || x.person_phone) === chaveFone(fone)) || null;
    return c ? { codigo: Number(c.person_code) || null, nome: String(c.person_name || "").trim(), nascimento: String(c.person_birth_date || "").trim() } : null;
  }
  const nomeDe = async (fone) => ((await clienteDe(fone)) || {}).nome || "";
  // Cadastro novo (nome, celular do WhatsApp e, se o cliente quiser, data de nascimento) ou só a data num cadastro que não tinha.
  async function salvarCliente({ codigo, fone, nome, nascimento }) {
    const cel = so(fone).replace(/^55(?=\d{10,11}$)/, "");
    const corpo = codigo ? { establishment: Number(est), ...(nascimento ? { person_birth_date: nascimento } : {}), ...(nome ? { person_name: nome } : {}) }
      : { establishment: Number(est), person_name: nome, person_cellphone: cel, person_dial_code: "+55", person_signup_origin: "WhatsApp (Sofia, atendente IA)", ...(nascimento ? { person_birth_date: nascimento } : {}) };
    const r = (await chamar(codigo ? "PUT" : "POST", codigo ? `/v1/establishment/clients/${encodeURIComponent(codigo)}` : "/v1/establishment/clients", corpo)).data || {};
    if (Number(r.error) > 0) throw new Error(r.result || "a AppBarber não aceitou o cadastro");
    return { codigo: codigo || Number(r.person_code) || null };
  }
  async function criar({ fone, nome, servicos: lista, profissional, quando, obs }) {
    const corpo = { customer_phone: Number(so(fone).length <= 11 ? "55" + so(fone) : so(fone)), customer_name: nome, establishment_code: Number(est), start_date: quando,
      professionals: [{ professional_code: Number(profissional) }], services: lista.map((s) => ({ service_code: Number(s.codigo), item_type: s.tipo === 2 ? 2 : 1, duration: Number(s.minutos) || 30 })), observation: obs || "Agendado pela Sofia (atendente IA) no WhatsApp" };
    const r = (await chamar("POST", "/v1/appointments", corpo)).data || {};
    if (Number(r.error) > 0) throw new Error(r.result || "a AppBarber não aceitou o agendamento");
    cache.forEach((_, k) => { if (k.startsWith("disp:")) cache.delete(k); });
    return { codigos: r.appointment_codes || [r.appointment_code].filter(Boolean), comanda: r.invoice_code || null };
  }
  async function cancelarComanda(comanda, fone) {
    const r = (await chamar("DELETE", `/v1/invoice/${encodeURIComponent(comanda)}`, { customer_phone: so(fone).replace(/^55(?=\d{10,11}$)/, ""), establishment_code: Number(est), reason: "Cancelado pelo cliente no WhatsApp (Sofia, atendente IA)" })).data || {};
    if (Number(r.error) > 0) throw new Error(r.result || "a AppBarber não aceitou o cancelamento");
    cache.forEach((_, k) => { if (k.startsWith("disp:")) cache.delete(k); });
    return true;
  }
  return { servicos, profissionais, horarios, agendamentosDe, nomeDe, clienteDe, salvarCliente, criar, cancelarComanda };
}

// ---------- o que a Sofia pode fazer (ferramentas para o Claude) ----------
const obj = (props, req) => ({ type: "object", properties: props, required: req, additionalProperties: false });
export const TOOLS = [
  { name: "ver_servicos", description: "Lista os serviços da barbearia com código, nome, duração em minutos e preço de TABELA (cobranca 'A partir de' = preço mínimo). Em alguns dias pode haver promoção: o valor de um dia específico vem em ver_horarios.", strict: true, input_schema: obj({}, []) },
  { name: "ver_horarios", description: "Horários livres de um dia para um serviço, por profissional, com o VALOR DAQUELE DIA (já com promoções/descontos do dia). Use o código do serviço de ver_servicos. Para mais de um serviço juntos (ex.: corte + barba), consulte pelo primeiro serviço e confira que há tempo seguido para os dois.", strict: true,
    input_schema: obj({ data: { type: "string", description: "Dia no formato AAAA-MM-DD" }, servico: { type: "integer", description: "Código do serviço" }, profissional: { type: ["string", "null"], description: "Nome do profissional que o cliente pediu, ou null para todos" } }, ["data", "servico", "profissional"]) },
  { name: "salvar_cadastro", description: "Cadastra o cliente na barbearia (quando a linha [Cadastro…] diz que não tem cadastro) ou acrescenta a data de nascimento num cadastro que não tem. Use depois que o cliente informou nome e sobrenome; a data de nascimento é opcional (só se ele quiser informar).", strict: true,
    input_schema: obj({ nome_completo: { type: ["string", "null"], description: "Nome e sobrenome (obrigatório para cadastro novo; null se o cliente já tem cadastro)" }, nascimento: { type: ["string", "null"], description: "Data de nascimento AAAA-MM-DD, ou null se o cliente não quis informar" }, celular: { type: ["string", "null"], description: "Celular com DDD, só se o WhatsApp do cliente estiver desconhecido; senão null" } }, ["nome_completo", "nascimento", "celular"]) },
  { name: "consultar_cliente", description: "Nome do cliente cadastrado na barbearia (pelo telefone do WhatsApp) e os horários que ele já tem marcados nos próximos 30 dias, com o código de cada um. Use antes de remarcar ou cancelar, e para chamar o cliente pelo nome.", strict: true, input_schema: obj({}, []) },
  { name: "agendar", description: "Marca o horário na AppBarber. SÓ use depois que o cliente confirmou com clareza (ex.: 'sim', 'pode marcar') o resumo com serviço(s), profissional, dia e hora.", strict: true,
    input_schema: obj({ servicos: { type: "array", items: { type: "integer" }, description: "Códigos dos serviços, na ordem" }, profissional: { type: "integer", description: "Código do profissional (de ver_horarios)" }, data_hora: { type: "string", description: "AAAA-MM-DD HH:MM" }, nome_cliente: { type: "string", description: "Nome completo do cliente" }, observacao: { type: ["string", "null"], description: "Recado curto para o barbeiro(a), ex.: Primeira vez na barbearia; ou null" } }, ["servicos", "profissional", "data_hora", "nome_cliente", "observacao"]) },
  { name: "remarcar", description: "Troca um horário já marcado por outro: marca o novo e depois cancela o antigo. SÓ use depois que o cliente confirmou o novo horário.", strict: true,
    input_schema: obj({ codigo_agendamento: { type: "integer", description: "Código do horário atual (de consultar_cliente)" }, servicos: { type: "array", items: { type: "integer" } }, profissional: { type: "integer" }, data_hora: { type: "string", description: "AAAA-MM-DD HH:MM" } }, ["codigo_agendamento", "servicos", "profissional", "data_hora"]) },
  { name: "cancelar", description: "Cancela um horário marcado do cliente. SÓ use depois que o cliente confirmou que quer cancelar aquele horário.", strict: true,
    input_schema: obj({ codigo_agendamento: { type: "integer", description: "Código do horário (de consultar_cliente)" } }, ["codigo_agendamento"]) },
  { name: "enviar_arte", description: "Envia ao cliente, no WhatsApp, uma das artes (imagens) da barbearia listadas nas instruções, como a tabela de planos. Use quando a situação da arte acontecer (ex.: cliente perguntou de planos). Depois de enviar, termine sua resposta com a pergunta indicada no resultado.", strict: true,
    input_schema: obj({ arte: { type: "string", description: "Nome exato da arte, como aparece na lista de artes" } }, ["arte"]) },
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

export function promptSistema({ nome, barbearia, notas, brand, artes = [], horario = null }) {
  const casa = brand === "salao" ? "salão" : "barbearia", hor = textoHorario(horario);
  return `Você é ${nome}, atendente da ${barbearia} (${casa}) no WhatsApp. Você conversa com clientes para tirar dúvidas e marcar, remarcar ou cancelar horários direto no sistema de agenda (AppBarber), usando as ferramentas.

Jeito de falar:
- Simpática, carismática e acolhedora, como a melhor recepcionista da casa. Português do Brasil, natural e leve.
- Mensagens curtas, como no WhatsApp: 1 a 3 frases. Pode usar emoji com moderação (1 ou 2 por mensagem) 😊
- Chame o cliente pelo primeiro nome quando souber. Não se apresente como robô nem fale de "sistema", "ferramenta" ou "IA", a não ser que perguntem; se perguntarem, diga com naturalidade que é a assistente virtual da ${barbearia}.
- Sem listas longas nem markdown (nada de **negrito** ou #). Ao oferecer horários, sugira 2 ou 3 opções próximas do que o cliente pediu.
- UMA pergunta por mensagem. Para agendar, siga esta ordem e pule o que o cliente já disse: 1) qual serviço; 2) preferência de barbeiro(a); 3) dia e período (manhã, tarde ou noite); 4) ofereça 2 ou 3 horários; 5) resumo para confirmar. Se o cliente responder só parte, siga com o que já sabe e pergunte só o que falta, sem repetir a pergunta inteira.
- Ao falar de horário, diga sempre com quem: ex. "17h com o Igor ou 17h20 com o Izaquias". Nunca solte um horário sem o barbeiro(a).

Regras (muito importantes):
- Nunca invente preço, serviço, profissional ou horário: tudo vem das ferramentas.
- Para explicar como é um serviço, use só o que está nas Informações da casa ou na observação do serviço (ver_servicos). Se não tiver, diga que o barbeiro(a) explica certinho no atendimento ou pergunte à recepção; não descreva por conta própria.
- Preço: se as Informações da casa trouxerem preços por dia da semana (promoções), ELAS VALEM sobre o preço de tabela de ver_servicos. Quando o cliente fala de um dia, informe o valor daquele dia. Destaque a promoção 🎉 só na primeira vez que falar de preço e de novo no resumo para confirmar; nas outras mensagens, não repita. Se perguntarem o preço sem dizer o dia, informe o valor de hoje (se for dia promocional, diga que hoje está em promoção) e mencione rapidamente a diferença nos outros dias, convidando para os dias promocionais. Se a ferramenta não trouxer, diga que vai verificar com a recepção (chamar_recepcao).
- Antes de agendar, remarcar ou cancelar, mande um resumo (serviço, profissional, dia da semana, data e hora) e espere o cliente confirmar. Só então use a ferramenta. Nunca marque sem confirmação.
- Na primeira mensagem de cada conversa vem a linha [Cadastro: …] dizendo se o cliente já é cadastrado (pelo WhatsApp dele).
  • Cadastrado: chame pelo primeiro nome e não peça dados de novo.
  • Sem cadastro (cliente novo): dê boas-vindas e, antes de marcar, faça o cadastro, uma pergunta por vez: 1) nome e sobrenome; 2) data de nascimento, explicando que é para ele receber promoções exclusivas no aniversário 🎉 (se não quiser informar, tudo bem, siga sem). O celular é o próprio WhatsApp: não pergunte, a não ser que a linha diga que é desconhecido. Depois use salvar_cadastro.
  • Cadastrado sem data de nascimento: depois de resolver o que ele pediu, pergunte uma vez a data de nascimento, para as promoções de aniversário, e salve com salvar_cadastro.
- Use a observação do agendamento para o que ajuda o barbeiro(a): se for a primeira vez do cliente na barbearia, escreva "Primeira vez na barbearia"; inclua também pedidos importantes do cliente (ex.: "quer manter o comprimento em cima").
- Quando o cliente quiser um serviço e NÃO disser com quem, antes de oferecer horários pergunte se ele tem preferência de barbeiro(a) (ex.: "Você tem preferência de barbeiro(a)? 😊"). Se ele já disse o nome, não pergunte. Se ele não tiver preferência, ofereça quem tem horário mais perto do que ele pediu.
- Remarcar ou cancelar: só horários do próprio cliente (consultar_cliente). Confirme qual horário antes.
- Depois de marcar, confirme de forma calorosa com dia, hora e profissional.
- Áudio, foto ou figurinha: você não consegue ouvir/ver; peça com carinho para o cliente escrever.
- Reclamação, cliente irritado, desconto, pagamento, assunto delicado, algo fora de agenda/serviços/preços, ou se o cliente pedir uma pessoa: use chamar_recepcao e avise que a equipe já vai responder.
- Se uma ferramenta der erro, não tente adivinhar: peça desculpas e use chamar_recepcao.
- Não fale de outros clientes nem mostre códigos internos.
- Cada mensagem do cliente começa com [Agora: …], com o dia e a hora atuais e o WhatsApp do cliente. Use para saber "hoje", "amanhã" e que horários já passaram; não comente essa linha com o cliente.
${hor ? `- Horário de funcionamento da ${casa}: ${hor}. Você responde o WhatsApp também fora desse horário (ex.: cedo e à noite), mas só existem atendimentos dentro dele. Se o cliente pedir um horário antes da abertura ou depois do fechamento, ou num dia fechado, explique com simpatia o horário de atendimento e ofereça os primeiros horários livres depois da abertura (ou no próximo dia aberto). Se ele quiser "agora" com a ${casa} fechada, diga a que horas abrimos.
` : ""}- Às vezes a mensagem do cliente vem junto com o que foi conversado sem você (com a recepção ou mensagens automáticas da barbearia, como lembretes). Leia com atenção e continue de onde pararam: respeite o que a recepção combinou, não repita o que ela já disse e não se reapresente.
${notas ? `\nInformações da ${casa} (passadas pelo dono, use quando ajudar):\n${notas}\n` : ""}${artes.length ? `\nArtes que você pode enviar com enviar_arte (envie a arte em vez de digitar a tabela inteira; depois explique só o que o cliente perguntar):\n${artes.map((a) => `- "${a.nome}": enviar quando ${a.quando || "o assunto da arte aparecer"}`).join("\n")}\n` : ""}`;
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
      if (input.profissional) { const q = String(input.profissional).toLowerCase().trim(), f = lista.filter((p) => p.nome.toLowerCase().includes(q) || q.includes(p.nome.toLowerCase().split(" ")[0])); if (f.length) lista = f; else return { aviso: `não encontrei "${input.profissional}" para esse serviço nesse dia`, profissionais: lista.map((p) => p.nome) }; }
      const d = new Date(input.data + "T12:00:00Z");
      return { dia: `${DIAS[d.getUTCDay()]}, ${input.data.split("-").reverse().join("/")}`, profissionais: lista.map((p) => ({ codigo: p.codigo, nome: p.nome, ...precosDoDia(p) })) };
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
      if (simular) { ctx.stats.agendados++; return { ok: true, simulado: true }; }
      const obs = [String(input.observacao || "").trim().slice(0, 300), "Agendado pela Sofia (atendente IA) no WhatsApp"].filter(Boolean).join(" · ");
      const r = await ab.criar({ fone, nome: input.nome_cliente, servicos: servs, profissional: input.profissional, quando: input.data_hora, obs });
      ctx.stats.agendados++; ctx.registro(`agendou ${servs.map((s) => s.nome).join(" + ")} em ${input.data_hora}`);
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
      return { ok: true, ...(juntos.length ? { tambem_cancelados: juntos.map((x) => `${x.servico} ${x.quando}`) } : {}) };
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
    case "chamar_recepcao": {
      conv.recepcao = true; ctx.stats.recepcao++; ctx.pendencia(`precisa da recepção: ${String(input.motivo || "").slice(0, 160)}`);
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
export function criarSofia({ dir, log, api, sock }) {
  let Anthropic = null, client = null, cfg = null, ab = null, abKey = "";
  const conversas = new Map(); // jid → { mensagens, ultima, ultimaSofia, humanoEm, contexto, nome, agenda, recepcao, fone, fila, ocupado }
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
    if (pendencias.length) partes.push("para a recepção: " + pendencias.slice(-5).join(" | "));
    const st = extra ? extra : "ok: " + partes.join(" · ") + ".";
    await api("POST", { company_id: cfg.company_id, acao: "ia_status", status: st }).catch(() => {});
  }

  async function configurar(e) {
    if (!e || !e.sofia || !e.appbarber) { cfg = null; return; }
    const novo = { company_id: e.company_id, barbearia: e.nome, brand: e.brand, nome: e.sofia.nome || "Sofia", modelo: MODELOS.includes(e.sofia.modelo) ? e.sofia.modelo : MODELO_PADRAO,
      janelas: e.sofia.janelas || JANELAS_PADRAO, horario: e.horario || null, artes: Array.isArray(e.sofia.artes) ? e.sofia.artes.filter((a) => a && a.url && a.nome) : [], avisar: so(e.sofia.avisar || ""), pausaMin: Math.max(15, Math.min(1440, Number(e.sofia.pausa) || 60)), notas: e.sofia.notas || "", ab: e.appbarber };
    cfg = novo;
    if (abKey !== e.appbarber.appbarber_api_key + e.appbarber.codigo_estabelecimento) {
      abKey = e.appbarber.appbarber_api_key + e.appbarber.codigo_estabelecimento;
      ab = ferramentasAppBarber({ cfg: e.appbarber, creditos: (n, zero) => api("POST", { company_id: e.company_id, acao: "ab_uso", creditos: n, ...(zero ? { sem_saldo: true } : {}) }).catch(() => {}) });
    }
    if (!process.env.ANTHROPIC_API_KEY) { if (Date.now() - statusEm > 3600000) await status("erro: falta a chave da Anthropic no servidor. No servidor, rode: gbia-sofia-chave"); return; }
    if (!client) {
      try { Anthropic = Anthropic || await carregarSDK(dir, log); client = new Anthropic({ maxRetries: 3, timeout: 90000 }); log(`Sofia ${SOFIA_VERSAO} pronta (${cfg.modelo}).`); }
      catch (err) { log("Sofia: não consegui carregar o SDK da Anthropic: " + err.message); if (Date.now() - statusEm > 3600000) await status("erro: não consegui instalar o SDK da Anthropic no servidor. Rode o instalador do WhatsApp de novo."); return; }
    }
    // Conversa parada há 1 hora entra no registro do relatório semanal; parada há 6 horas é esquecida.
    for (const [j, c] of conversas) {
      if (!c.ocupado && c.contada && !c.registrada && Date.now() - c.ultima > 3600000) registrar(c);
      if (Date.now() - c.ultima > 6 * 3600000 && !c.ocupado) conversas.delete(j);
    }
    await relatorioDaSemana().catch((err) => log("Sofia: relatório semanal: " + err.message));
    for (const [j, t] of pausas) if (t < Date.now()) pausas.delete(j);
    if (Date.now() - statusEm > 30 * 60000) await status();
  }
  const ligada = () => !!(cfg && client);

  // ---- registro das conversas (30 dias) e relatório de domingo à noite ----
  const REG = join(dir, "sofia-registro.json"), REL = join(dir, "sofia-relatorio.json");
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
  setInterval(() => retornos().catch(() => {}), 60000).unref();
  // Conversa deste contato (cria se não houver ou se estiver parada há mais de 6 horas).
  function obter(jid, msg) {
    let c = conversas.get(jid);
    if (!c || Date.now() - c.ultima > 6 * 3600000) {
      c = { mensagens: [], inicio: Date.now(), ultima: Date.now(), ultimaSofia: 0, humanoEm: 0, contexto: [], contada: false, nome: "", agenda: null, recepcao: false, fone: "", fila: [], ocupado: false };
      conversas.set(jid, c);
    }
    if (!c.fone && msg && !msg.key.fromMe) c.fone = foneDe(msg);
    return c;
  }
  // O que foi conversado sem a Sofia (cliente com a recepção, lembretes automáticos): ela lê quando voltar.
  function anotar(c, quem, t) { if (!t) return; c.contexto.push({ ts: Date.now(), linha: `${quem}: ${t.slice(0, 600)}` }); if (c.contexto.length > 40) c.contexto.splice(0, c.contexto.length - 40); }

  async function processar(jid) {
    const c = conversas.get(jid);
    if (!c || c.ocupado || !c.fila.length) return;
    c.ocupado = true;
    try {
      while (c.fila.length) {
        const novas = c.fila.splice(0);
        if (c.recepcao || (pausas.get(jid) || 0) > Date.now()) return;
        const antes = c.contexto.splice(0).sort((a, b) => a.ts - b.ts).map((x) => x.linha);
        const cadLinha = c.verificado ? "" : (c.verificado = true, (await verificarCadastro(ab, c.fone, c)) + "\n");
        c.mensagens.push({ role: "user", content: agoraTexto(c.fone) + "\n" + cadLinha + (antes.length
          ? `[Para contexto: mensagens desta conversa enquanto você não estava atendendo]\n${antes.join("\n")}\n\n[Mensagem nova do cliente]\n${novas.join("\n")}`
          : novas.join("\n")) });
        if (!c.contada) { c.contada = true; zera(); stats.conversas++; }
        if (!c.artes) c.artes = cfg.artes; // congeladas junto com as instruções
        const ctx = { ab, fone: c.fone, stats, simular: false, artes: c.artes, enviarArte: (a) => enviarArte(jid, a), registro: (t) => log(`Sofia: ${t}.`), pendencia: (t) => { c.motivo = t; pendencias.push(`${c.nome ? c.nome.split(" ")[0] + " " : ""}(${c.fone ? "…" + c.fone.slice(-4) : "sem fone"}) ${t}`); } };
        const antesStats = { agendou: stats.agendados, remarcou: stats.remarcados, cancelou: stats.cancelados };
        // Instruções congeladas no começo da conversa (mudanças no app valem para as próximas conversas).
        const sistema = c.sistema || (c.sistema = promptSistema({ nome: cfg.nome, barbearia: cfg.barbearia, notas: cfg.notas, brand: cfg.brand, artes: c.artes, horario: cfg.horario }));
        const r = await rodada({ client, modelo: cfg.modelo, sistema, conv: c, ctx });
        stats.gasto += r.gasto; c.gasto = (c.gasto || 0) + r.gasto; c.registrada = false;
        c.feitos = c.feitos || {}; for (const [k, v] of Object.entries({ agendou: stats.agendados, remarcou: stats.remarcados, cancelou: stats.cancelados })) c.feitos[k] = (c.feitos[k] || 0) + Math.max(0, v - antesStats[k]);
        if ((pausas.get(jid) || 0) > Date.now()) return; // a recepção entrou enquanto a IA pensava
        if (r.texto) { await enviar(jid, r.texto); c.ultimaSofia = Date.now(); }
        // Arte com retorno: se o cliente não responder em 15 minutos, ela pergunta de novo (uma vez).
        if (c.retornoPendente) { c.retorno = { em: Date.now(), arte: c.retornoPendente }; c.retornoPendente = null; }
        if (c.recepcao) { try { await sock().chatModify({ markRead: false, lastMessages: [c.ultimaMsg].filter(Boolean) }, jid); } catch { /* não deu para marcar como não lida */ } await status(); }
        c.ultima = Date.now();
      }
    } catch (err) {
      log("Sofia: erro na conversa: " + err.message);
      c.recepcao = true; c.motivo = "erro: " + String(err.message).slice(0, 120); stats.recepcao++; pendencias.push(`(${c.fone ? "…" + c.fone.slice(-4) : "sem fone"}) a Sofia teve um erro e parou nesta conversa`);
      await status(`erro: ${new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })} · ${String(err.message).slice(0, 200)}. A conversa ficou para a recepção.`);
    } finally { c.ocupado = false; }
  }

  // Chamado a cada messages.upsert do WhatsApp dos clientes.
  async function aoReceber(m) {
    if (!cfg) return;
    for (const msg of m.messages || []) {
      const jid = msg.key && msg.key.remoteJid;
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
          pausas.set(jid, Date.now() + cfg.pausaMin * 60000); c.humanoEm = Date.now();
          for (const f of c.fila.splice(0)) anotar(c, "Cliente", f); // o que estava esperando, a recepção já está respondendo
          anotar(c, "Recepção", conteudo);
        }, 2500);
        continue;
      }
      if (m.type !== "notify" || !conteudo) continue;
      const c = obter(jid, msg); c.ultima = Date.now(); c.ultimaMsg = msg; c.ultimaCliente = Date.now();
      if (msg.pushName && !c.pushName) c.pushName = msg.pushName;
      // Sem atender agora (desligada, recepção na conversa ou fora do horário): guarda para contexto.
      // Conversa nova só começa dentro do horário; a que a Sofia está atendendo continua até ficar 20 min parada.
      const continua = c.ultimaSofia && Date.now() - c.ultimaSofia < 20 * 60000 && c.humanoEm < c.ultimaSofia;
      if (!ligada() || c.recepcao || (pausas.get(jid) || 0) > Date.now() || (!dentroDaJanela(cfg.janelas) && !continua)) { anotar(c, "Cliente", conteudo); continue; }
      c.fila.push(t || `[o cliente mandou um(a) ${md}]`);
      // Espera o cliente terminar de escrever (várias mensagens seguidas viram uma só).
      clearTimeout(c.timer); c.timer = setTimeout(() => processar(jid).catch(() => {}), 7000);
    }
  }

  return { configurar, aoReceber, marcarMinha, ligada, relatorioDaSemana, ativaAgora: () => !!(cfg && client && dentroDaJanela(cfg.janelas)), status };
}
