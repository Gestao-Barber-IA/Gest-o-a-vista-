// Gestão Barber IA — lembretes no WhatsApp (roda no servidor de sincronização, IP fixo liberado na AppBarber).
// Conecta um número de WhatsApp (como o WhatsApp Web, pelo motor Baileys, sem Docker e sem banco de dados) e manda:
//  • Equipe: no horário escolhido (ex.: 13h), lembrete a quem está trabalhando hoje e fez pouco do Checklist Agenda Cheia.
//  • Clientes: lembrete do horário marcado na AppBarber, com a antecedência escolhida (ex.: 1 hora antes).
// Uma mensagem por pessoa/agendamento, com intervalo entre os envios. Nome e telefone dos clientes não são guardados.
//
// Uso:
//   node whatsapp.mjs --conectar            mostra o QR code para ligar o número (WhatsApp › Aparelhos conectados)
//   node whatsapp.mjs --codigo 5511999998888  liga pelo código de 8 letras (Conectar com número de telefone)
//   node whatsapp.mjs --teste 5511999998888   envia uma mensagem de teste para esse número
//   + --clientes (ou WA_PAPEL=clientes): usa o segundo número, só para o lembrete de agendamento dos clientes
//   node whatsapp.mjs --clientes --sofia     conversa com a Sofia (atendente IA) no terminal, sem marcar nada de verdade
//   node whatsapp.mjs --clientes --sofia-relatorio   gera agora o relatório semanal da Sofia
//   node whatsapp.mjs                        serviço (systemd gbia-whatsapp)
// Variáveis (em /etc/gbia-sync.env): SYNC_TOKEN (obrigatória), SYNC_URL, SITE_URL, ANTHROPIC_API_KEY (Sofia, atendente IA).
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const VERSAO = "6.1";
const DIR = dirname(fileURLToPath(import.meta.url));
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? (process.argv[i + 1] || "") : null; };
// Papel do número: "equipe" (lembrete do checklist, chip 1) ou "clientes" (lembrete de agendamento, chip 2).
// Cada papel roda como um serviço separado, com a sua própria sessão (QR code).
const PAPEL = (process.argv.includes("--clientes") || process.env.WA_PAPEL === "clientes") ? "clientes" : "equipe";
const CLI = PAPEL === "clientes";
// Lembrete dos clientes: sai pelo 2º chip ("chip") ou pelo WhatsApp principal da barbearia ("principal").
// As duas sessões ficam guardadas; o dono escolhe no app qual usar (o 2º chip fica de reserva).
const pasta = (n) => join(DIR, !CLI ? "sessao" : n === "principal" ? "sessao-principal" : "sessao-clientes");
const cmdDe = (n) => (!CLI ? "gbia-whatsapp-conectar" : n === "principal" ? "gbia-whatsapp-conectar-principal" : "gbia-whatsapp-conectar-clientes");
let NUMERO = CLI ? (arg("--sessao") || process.env.WA_SESSAO || "") : "";
let AUTH = pasta(NUMERO), CMD = cmdDe(NUMERO);
const ENVIADOS = join(DIR, "enviados.json");
const ENV_CLI = join(DIR, "enviados-clientes.json");
const TOKEN = process.env.SYNC_TOKEN || "";
const SYNC_URL = process.env.SYNC_URL || "https://sekkmnkajnaqubyhpxvd.supabase.co/functions/v1/sync-servidor";
const SITE = (process.env.SITE_URL || "https://gestaoperformance.vercel.app").replace(/\/$/, "");
const log = (m) => console.log(`[${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}] ${m}`);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const so = (t) => String(t || "").replace(/\D/g, "");

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers, downloadMediaMessage } = await import("baileys");
const pino = (await import("pino")).default;

// Sofia, a atendente IA (sofia.mjs, ao lado deste arquivo). Se ainda não estiver no servidor, baixa do site.
async function carregarSofiaMod() {
  const f = join(DIR, "sofia.mjs");
  if (!existsSync(f)) { try { const r = await fetch(`${SITE}/integracoes/servidor/sofia.mjs`, { cache: "no-store" }); if (r.ok) writeFileSync(f, await r.text()); } catch { /* sem internet: tenta depois */ } }
  try { return await import("./sofia.mjs"); } catch (e) { console.log("Sofia indisponível: " + e.message); return null; }
}
const SOFIA = CLI ? await carregarSofiaMod() : null;
let sofia = null, retorno = null, totem = null;

// ---------- conexão ----------
let sock = null, aberto = false, saiu = false, geracao = 0;
async function conectar({ qr = false, codigo = "" } = {}) {
  const minha = ++geracao; // ao trocar de número, as conexões antigas param de reagir
  // Fecha a conexão anterior (se ainda estiver aberta ou conectando): duas conexões ao mesmo tempo
  // recebem a mesma mensagem duas vezes, e a Sofia respondia em dobro.
  if (sock) { const velho = sock; try { velho.end(undefined); } catch { /* já fechado */ } }
  mkdirSync(AUTH, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  sock = makeWASocket({ auth: state, version, logger: pino({ level: "silent" }), browser: Browsers.ubuntu("Gestão Barber IA"), markOnlineOnConnect: false, syncFullHistory: false });
  sock.ev.on("creds.update", saveCreds);
  // Guarda os ids do que este programa manda: assim a Sofia sabe quando foi a recepção que respondeu pelo celular.
  const envia = sock.sendMessage.bind(sock);
  sock.sendMessage = async (...a) => { const r = await envia(...a); if (sofia) sofia.marcarMinha(r && r.key && r.key.id); return r; };
  sock.ev.on("messages.upsert", (m) => { if (minha !== geracao) return; responder(m).catch(() => {}); if (sofia) sofia.aoReceber(m).catch(() => {}); });
  let pediuCodigo = false;
  return new Promise((ok) => {
    sock.ev.on("connection.update", async (u) => {
      if (minha !== geracao) return;
      if (u.qr && qr) { const qrt = (await import("qrcode-terminal")).default; console.log("\nAbra o WhatsApp do número que vai enviar › Aparelhos conectados › Conectar um aparelho e leia o QR code:\n"); qrt.generate(u.qr, { small: true }); }
      if (u.qr && codigo && !pediuCodigo) { pediuCodigo = true; const c = await sock.requestPairingCode(so(codigo)); console.log(`\nNo WhatsApp do chip: Aparelhos conectados › Conectar um aparelho › Conectar com número de telefone e digite: ${c}\n`); }
      if (u.qr && !qr && !codigo) { aberto = false; await status(`desconectado: o número precisa ser conectado de novo (no servidor: ${CMD}).`); log(`Sem sessão: rode ${CMD} no servidor.`); }
      // Ao conectar (ou reconectar sozinho), o app volta a mostrar "conectado" e uma nova queda é avisada na hora.
      if (u.connection === "open") { aberto = true; avisarConectado = true; avisouOff = 0; log(`WhatsApp conectado (${PAPEL}).`); ok(true); }
      if (u.connection === "close") {
        aberto = false;
        const code = u.lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) { saiu = true; log("O número foi desconectado no celular."); await status(`desconectado: o número foi removido em Aparelhos conectados (ou bloqueado). Os envios pararam. Conecte de novo no servidor: ${CMD}.`); rmSync(AUTH, { recursive: true, force: true }); ok(false); return; }
        if (code === DisconnectReason.restartRequired || qr || codigo) { conectar({ qr, codigo }).then(ok); return; }
        log(`Conexão caiu (${code || "?"}); tentando de novo em 30 s.`); await espera(30000); conectar().then(ok);
      }
    });
  });
}

// ---------- estado no app (Integração › Lembretes no WhatsApp) ----------
let empresasConhecidas = [], avisouOff = 0;
async function api(method, body, q = "") {
  const r = await fetch(SYNC_URL + q, { method, headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`);
  return j;
}
async function status(msg, ids = empresasConhecidas) {
  for (const id of ids) await api("POST", { company_id: id, acao: CLI ? "cl_status" : "wa_status", status: msg }).catch(() => {});
}
let avisarConectado = false;

// ---------- regras do checklist: as mesmas do app (js/data.js do site) ----------
let GB = null, gbEm = 0;
async function regras() {
  if (GB && Date.now() - gbEm < 6 * 3600000) return GB;
  const src = await (await fetch(`${SITE}/js/data.js`, { cache: "no-store" })).text();
  const store = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };
  const window = { localStorage: store(), sessionStorage: store(), location: { search: "", pathname: "/", hash: "" }, history: { replaceState() {} } };
  vm.runInContext(src, vm.createContext({ window, console, Date, Math, JSON, Intl }));
  GB = window.GB; gbEm = Date.now();
  return GB;
}
const TEXTO = "Oi, {nome}! 👋 Já são {hora} e o seu Checklist Agenda Cheia de hoje está com {pontos} de {maximo} pts.\n\nCada story, convite, avaliação e retorno agendado é o que enche a sua agenda nos próximos dias. É o nosso plano estratégico para você crescer e faturar mais.\n\nAinda dá tempo! Abra o checklist e bora: {link} 💪\n\n{barbearia}";
const fmt = (n) => String(Math.round(n * 10) / 10).replace(".", ",");
async function quemRecebe(e) {
  const G = await regras();
  const cfg = e.popCfg && Array.isArray(e.popCfg.items) ? e.popCfg : G.popCfgOf({ brand: e.brand });
  const max = G.popDayMax(cfg, e.hoje), out = [];
  for (const b of e.barbers) {
    if (so(b.phone).length < 10) continue;
    const rec = e.pop.find((r) => r.barberId === b.id);
    if (rec && rec.folga) continue; // dia de folga marcado no checklist: não recebe lembrete
    const temEv = rec && rec.ev && Object.values(rec.ev).some((l) => Array.isArray(l) && l.length);
    const atendeu = e.entries.some((x) => x.barberId === b.id && (Number(x.cli) > 0 || Number(x.fat) > 0));
    if (!temEv && !atendeu) continue; // sem sinal de que está trabalhando hoje (folga): não manda
    const pts = rec ? G.popDayPts(cfg, rec) + G.popDayPts(cfg, rec, true) : 0;
    if (pts >= Number(e.cfg.minimo || 0)) continue;
    const texto = (e.cfg.texto || TEXTO).replace(/\{nome\}/g, b.name.split(" ")[0]).replace(/\{pontos\}/g, fmt(pts)).replace(/\{maximo\}/g, fmt(max))
      .replace(/\{hora\}/g, e.cfg.hora.replace(":00", "h").replace(":", "h")).replace(/\{link\}/g, `${SITE}/#checklist`).replace(/\{barbearia\}/g, e.nome);
    out.push({ b, pts, texto });
  }
  return out;
}

// ---------- envio ----------
const lerEnviados = () => { try { return JSON.parse(readFileSync(ENVIADOS, "utf8")); } catch { return {}; } };
async function enviar(numero, texto) {
  const n = so(numero), cand = n.length <= 11 ? "55" + n : n;
  const [r] = await sock.onWhatsApp(cand).catch(() => []);
  if (!r || !r.exists) throw new Error("número sem WhatsApp");
  await sock.presenceSubscribe(r.jid).catch(() => {});
  await sock.sendPresenceUpdate("composing", r.jid).catch(() => {});
  await espera(2500 + Math.random() * 2500);
  await sock.sendPresenceUpdate("paused", r.jid).catch(() => {});
  await sock.sendMessage(r.jid, { text: texto });
}
const agoraSP = () => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()); const [h, m] = p.split(":").map(Number); return h * 60 + m; };
const min = (t) => { const [h, m] = String(t || "13:00").split(":").map(Number); return (h || 0) * 60 + (m || 0); };

// ---------- clientes: lembrete do horário marcado na AppBarber ----------
// GET com os cabeçalhos exatamente como escritos e sempre pelo IPv4 (o IP liberado na AppBarber).
async function getExato(url, headers) {
  const u = new URL(url), mod = await import("node:https");
  return new Promise((ok, fail) => {
    const req = mod.request(u, { method: "GET", headers, family: 4 }, (res) => {
      let b = ""; res.setEncoding("utf8"); res.on("data", (c) => (b += c));
      res.on("end", () => ok({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: b }));
    });
    req.on("error", fail); req.setTimeout(60000, () => req.destroy(new Error("a AppBarber não respondeu em 60 segundos.")));
    req.end();
  });
}
// Motivo legível de um erro da AppBarber (sem dados de clientes): mensagem do JSON ou o título da página de bloqueio.
function motivo(t) {
  try { const j = JSON.parse(t); const m = j.message || j.erro || j.error || j.mensagem || (j.errors && JSON.stringify(j.errors)); if (m) return ": " + String(m).slice(0, 160); } catch { /* não é JSON */ }
  const tit = (String(t).match(/<title>([^<]*)<\/title>/i) || [])[1];
  if (tit || /cloudflare|attention required|blocked/i.test(t)) return `: bloqueio no firewall da AppBarber (${(tit || "acesso negado").trim().slice(0, 80)})`;
  return t ? ": " + String(t).replace(/\s+/g, " ").slice(0, 120) : "";
}
// "21/12/2026 14:30" → minutos desde 00:00 do dia, e o dia em ISO
const hm = (s) => { const m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/); return m ? { dia: `${m[3]}-${m[2]}-${m[1]}`, min: +m[4] * 60 + +m[5] } : null; };
const hhmm = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}h${String(n % 60).padStart(2, "0")}`.replace(/h00$/, "h");
const primeiro = (n) => { const w = String(n || "").trim().split(/\s+/)[0] || ""; return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""; };
const TEXTO_CLI = "Olá, {cliente}! 👋 Passando para lembrar do seu horário hoje às {hora} com {profissional} ({servico}) na {barbearia}.\n\nTe esperamos! 💈 Se não puder vir, avise a barbearia para liberarmos o horário.";
// Versões do texto padrão, sorteadas a cada envio (mensagens idênticas em série parecem spam).
const VERSOES_CLI = [TEXTO_CLI,
  "Oi, {cliente}! Tudo certo? 😊 Seu horário na {barbearia} é hoje às {hora}, com {profissional} ({servico}).\n\nEstamos te esperando! Se surgir algum imprevisto, é só avisar por aqui.",
  "{cliente}, bom te ver por aqui! ✂️ Lembrete: hoje às {hora} você tem {servico} com {profissional} na {barbearia}.\n\nAté já! Se precisar remarcar, responda esta mensagem.",
  "Fala, {cliente}! 💈 Só confirmando: seu atendimento com {profissional} é hoje às {hora} ({servico}).\n\nTe aguardamos na {barbearia}. Qualquer coisa, chama a gente aqui."];
// Proteções no WhatsApp principal: ritmo mais lento, limite por hora e por dia, sem links e freio automático.
const LIMITE = { principal: { hora: 20, dia: 150, de: 40000, ate: 90000 }, chip: { hora: 40, dia: 300, de: 20000, ate: 40000 } };
let ritmo = { dia: "", envios: [] }, erroSeguido = 0, pausadoDia = "";
const agendaCache = {};
async function agendaHoje(e, hoje) {
  const c = e.clientes, k = e.company_id, cache = agendaCache[k];
  if (cache && cache.dia === hoje && Date.now() - cache.em < 15 * 60000) return cache.lista; // AppBarber: no máximo 1 consulta a cada 15 min (cada consulta gasta crédito)
  const q = new URLSearchParams({ establishment_code: String(c.codigo_estabelecimento), start_date: hoje, end_date: hoje, status_type: "1" });
  if (c.codigo_filial) q.set("branch_code", String(c.codigo_filial));
  // Mesmo cabeçalho da sincronização (que a AppBarber já aceita neste IP).
  const r = await getExato("https://api.appbarber.com/v1/appointments/history?" + q, { "X-API-Key": c.appbarber_api_key, Accept: "application/json", "User-Agent": "GestaoBarberIA-Sync/2.8" });
  // Créditos: cada consulta bem-sucedida gasta 1; o total vai para o contador do app.
  if (r.ok) api("POST", { company_id: k, acao: "ab_uso", creditos: 1 }).catch(() => {});
  else if (/saldo insuficiente/i.test(r.text)) api("POST", { company_id: k, acao: "ab_uso", creditos: 0, sem_saldo: true }).catch(() => {});
  if (!r.ok) throw new Error(`AppBarber respondeu ${r.status}${motivo(r.text)}`);
  const lista = ((JSON.parse(r.text).data) || []).filter((a) => !a.scheduling_status || /agendad|confirmad/i.test(a.scheduling_status));
  agendaCache[k] = { dia: hoje, em: Date.now(), lista };
  return lista;
}
// Um lembrete por cliente para cada bloco de horários seguidos (ex.: corte 14h + barba 14h30 = uma mensagem às 13h).
function blocos(lista, hoje) {
  const porCli = new Map();
  for (const a of lista) {
    const t = hm(a.scheduling_start), fone = so(a.client_phone);
    if (!t || t.dia !== hoje || fone.length < 10) continue;
    const reg = hm(a.scheduling_registration_date);
    const x = { cod: String(a.appointment_code || a.scheduling_code), min: t.min, prof: primeiro(a.employee_name), serv: String(a.service_description || "").trim(), nome: primeiro(a.client_name), fone, reg: reg && reg.dia === hoje ? reg.min : -1 };
    (porCli.get(fone) || porCli.set(fone, []).get(fone)).push(x);
  }
  const out = [];
  for (const arr of porCli.values()) {
    arr.sort((a, b) => a.min - b.min);
    let cur = null;
    for (const x of arr) {
      if (cur && x.min - cur.fim <= 60) { cur.cods.push(x.cod); cur.fim = x.min; if (x.serv && !cur.servs.includes(x.serv)) cur.servs.push(x.serv); if (x.prof && !cur.profs.includes(x.prof)) cur.profs.push(x.prof); continue; }
      cur = { cods: [x.cod], min: x.min, fim: x.min, reg: x.reg, nome: x.nome, fone: x.fone, servs: x.serv ? [x.serv] : [], profs: x.prof ? [x.prof] : [] };
      out.push(cur);
    }
  }
  return out;
}
const junta = (l) => (l.length <= 1 ? l.join("") : l.slice(0, -1).join(", ") + " e " + l[l.length - 1]);
const lerCli = () => { try { return JSON.parse(readFileSync(ENV_CLI, "utf8")); } catch { return {}; } };
// Dia fechado (ex.: domingo) ou fora do horário: não consulta a AppBarber.
const diaSemanaSP = () => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(new Date()));
const fechadoHoje = (e) => !!(e.horario && Array.isArray(e.horario.fechados) && e.horario.fechados.includes(diaSemanaSP()));
async function lembretesClientes(e, hoje) {
  const c = e.clientes, lead = Math.max(15, Math.min(240, Number(c.antecedencia) || 60)), agora = agoraSP();
  if (fechadoHoje(e)) return;
  // Janela: da abertura menos a antecedência (lembrete do primeiro horário) até o fechamento.
  if (e.horario && (agora < min(e.horario.abertura) - lead - 15 || agora > min(e.horario.fechamento))) return;
  const env = lerCli(); for (const d of Object.keys(env)) if (d < hoje) delete env[d];
  const feitos = new Set((env[hoje] = env[hoje] || {})[e.company_id] || []);
  const lista = blocos(await agendaHoje(e, hoje), hoje);
  // Hora de mandar: faltam no máximo `lead` minutos (e ainda falta pelo menos 10).
  // Quem agendou em cima da hora (depois desse momento) recebe 20 minutos antes, se agendou com pelo menos 20 minutos.
  const hora = (b) => { const falta = b.min - agora, cedo = b.reg < 0 || b.min - b.reg >= lead;
    return cedo ? falta <= lead && falta >= 10 : b.min - b.reg >= 20 && falta <= 20 && falta >= 5; };
  const fila = lista.filter((b) => !b.cods.some((k) => feitos.has(k)) && hora(b));
  const principal = NUMERO === "principal", L = LIMITE[principal ? "principal" : "chip"];
  if (ritmo.dia !== hoje) { ritmo = { dia: hoje, envios: [] }; erroSeguido = 0; }
  const versoes = (c.texto ? c.texto.split(/\n\s*-{3,}\s*\n/) : VERSOES_CLI).map((t) => t.trim()).filter(Boolean);
  let n = 0;
  for (const [i, b] of fila.entries()) {
    if (pausadoDia === hoje) break;
    const ultHora = ritmo.envios.filter((t) => Date.now() - t < 3600000).length;
    if (ultHora >= L.hora || ritmo.envios.length >= L.dia) { log(`${e.nome}: limite de envios atingido (${ultHora}/h, ${ritmo.envios.length}/dia); o resto fica para o próximo ciclo.`); break; }
    let texto = versoes[Math.floor(Math.random() * versoes.length)].replace(/\{cliente\}/g, b.nome || "tudo bem").replace(/\{hora\}/g, hhmm(b.min)).replace(/\{profissional\}/g, junta(b.profs) || "a nossa equipe")
      .replace(/\{servico\}/g, junta(b.servs) || "seu atendimento").replace(/\{barbearia\}/g, e.nome).replace(/ \(\)/g, "");
    if (principal) texto = texto.replace(/https?:\/\/\S+/gi, "").replace(/[ \t]+\n/g, "\n").replace(/:\s*$/gm, ".").trim(); // sem links no número principal
    try { await enviar(b.fone, texto); n++; erroSeguido = 0; ritmo.envios.push(Date.now()); }
    catch (err) {
      log(`${e.nome}: lembrete de cliente não enviado (${err.message}).`);
      // "número sem WhatsApp" é do cliente; outros erros seguidos podem ser o WhatsApp barrando: freio automático.
      if (!/sem WhatsApp/.test(err.message) && ++erroSeguido >= 3) { pausadoDia = hoje; await status(`erro: pausado até amanhã por segurança — 3 envios seguidos falharam (${err.message}). Confira o WhatsApp no celular.`, [e.company_id]); break; }
    }
    b.cods.forEach((k) => feitos.add(k)); env[hoje][e.company_id] = [...feitos]; writeFileSync(ENV_CLI, JSON.stringify(env));
    if (i < fila.length - 1) await espera(L.de + Math.random() * (L.ate - L.de));
  }
  if (pausadoDia === hoje) return;
  if (n || !cliStatusEm[e.company_id] || Date.now() - cliStatusEm[e.company_id] > 3600000) {
    cliStatusEm[e.company_id] = Date.now();
    const total = (env[hoje][e.company_id] || []).length, prox = lista.filter((b) => !b.cods.some((k) => feitos.has(k)) && b.min > agora).sort((a, b) => a.min - b.min)[0];
    const quando = new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    await api("POST", { company_id: e.company_id, acao: "cl_status", status: `ok: ${quando} · ${principal ? "WhatsApp principal" : "2º chip"} · ${total ? `${total} agendamento(s) lembrado(s) hoje` : "nenhum lembrete enviado hoje ainda"}${prox ? ` · próximo horário às ${hhmm(prox.min)}` : ""}.` }).catch(() => {});
  }
}
const cliStatusEm = {};
// ---------- pedido de feedback: cliente novo com comanda paga (fila gravada pela sincronização) ----------
const TEXTO_FB = "Olá {cliente}, {saudacao}!\nVenho através dessa mensagem lhe pedir a gentileza de nos enviar um feedback🙏🏾\n\nO que achou do atendimento do barbeiro {profissional}?";
const ENV_FB = join(DIR, "enviados-feedback.json");
const saudacao = () => { const h = Math.floor(agoraSP() / 60); return h < 12 ? "bom dia" : h < 18 ? "boa tarde" : "boa noite"; };
const fbStatusEm = {};
async function feedbacks(e, hoje) {
  const agora = agoraSP();
  if (agora < 8 * 60 || agora > 21 * 60) return; // só entre 8h e 21h (o que ficar para depois sai na manhã seguinte)
  let fila = { itens: [] }; try { fila = JSON.parse(readFileSync(join(DIR, "..", "dados", e.company_id.replace(/[^a-zA-Z0-9-]/g, ""), "feedback-fila.json"), "utf8")); } catch { return; }
  let env = {}; try { env = JSON.parse(readFileSync(ENV_FB, "utf8")); } catch { /* primeira vez */ }
  const feitos = new Set(env[e.company_id] || []);
  const principal = NUMERO === "principal", L = LIMITE[principal ? "principal" : "chip"];
  if (ritmo.dia !== hoje) { ritmo = { dia: hoje, envios: [] }; erroSeguido = 0; }
  const fila2 = (fila.itens || []).filter((x) => !feitos.has(x.cod) && Date.now() - x.em < 20 * 3600000);
  const versoes = (e.feedback.texto ? e.feedback.texto.split(/\n\s*-{3,}\s*\n/) : [TEXTO_FB]).map((t) => t.trim()).filter(Boolean);
  let n = 0;
  for (const [i, x] of fila2.entries()) {
    if (pausadoDia === hoje) break;
    const ultHora = ritmo.envios.filter((t) => Date.now() - t < 3600000).length;
    if (ultHora >= L.hora || ritmo.envios.length >= L.dia) break;
    let texto = versoes[Math.floor(Math.random() * versoes.length)].replace(/\{cliente\}/g, x.nome || "tudo bem").replace(/\{saudacao\}/g, saudacao())
      .replace(/\{profissional\}/g, x.prof || "da nossa equipe").replace(/\{barbearia\}/g, e.nome);
    if (principal) texto = texto.replace(/https?:\/\/\S+/gi, "").trim();
    feitos.add(x.cod); env[e.company_id] = [...feitos].slice(-3000); writeFileSync(ENV_FB, JSON.stringify(env));
    try { await enviar(x.fone, texto); n++; erroSeguido = 0; ritmo.envios.push(Date.now()); }
    catch (err) { log(`${e.nome}: feedback não enviado (${err.message}).`); if (!/sem WhatsApp/.test(err.message) && ++erroSeguido >= 3) { pausadoDia = hoje; break; } }
    if (i < fila2.length - 1) await espera(L.de + Math.random() * (L.ate - L.de));
  }
  if (n || !fbStatusEm[e.company_id] || Date.now() - fbStatusEm[e.company_id] > 3600000) {
    fbStatusEm[e.company_id] = Date.now();
    const hojeN = (fila.itens || []).filter((x) => x.dia === hoje && feitos.has(x.cod)).length;
    const quando = new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    await api("POST", { company_id: e.company_id, acao: "fb_status", status: `ok: ${quando} · ${hojeN ? `${hojeN} pedido(s) de feedback enviado(s) hoje` : "nenhum cliente novo com comanda paga hoje ainda"}.` }).catch(() => {});
  }
}

// ---------- reconquista de clientes sumidos (3 a 12 meses sem vir) ----------
// Lista de clientes da AppBarber (com a data do último agendamento) baixada 1 vez por mês (1 crédito por página).
// Cada dia, até N mensagens entre 10h e 18h, começando por quem sumiu há menos tempo. Antes de cada envio,
// confere o cliente na AppBarber (1 crédito) para não mandar a quem já marcou. Cada cliente: no máximo 1 vez a cada 6 meses.
const TEXTOS_WB = [
  "{Saudacao}, {cliente}! Tudo bem? 😊\nAqui é da {barbearia}. Sentimos sua falta por aqui! Faz um tempinho que você não aparece…\nPosso te enviar um presente de retorno? 🎁",
  "{Saudacao}, {cliente}! Como você está? 😊\nAqui é da {barbearia}. Faz um tempo que a gente não te vê por aqui e sentimos sua falta!\nTenho um presente de retorno separado pra você. Posso te enviar? 🎁",
  "{Saudacao}, {cliente}! Tudo certo por aí? 😊\nPassando pra dizer que a {barbearia} sentiu sua falta!\nPreparamos um presente especial para o seu retorno. Quer que eu te mande? 🎁"];
const WB_CLI = join(DIR, "reconquista-clientes.json"), WB_ENV = join(DIR, "reconquista-enviados.json"), WB_SAIR = join(DIR, "reconquista-sair.json"), WB_REC = join(DIR, "reconquista-recentes.json");
const chaveFone = (f) => { let d = so(f); if (d.length > 11 && d.startsWith("55")) d = d.slice(2); if (d.length === 11) d = d.slice(0, 2) + d.slice(3); return d.slice(-10); }; // DDD + 8 dígitos
const lerJ = (f, pad) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return pad; } };
// A AppBarber manda a data como "10/03/2026" (dia/mês/ano) — a documentação dizia "2026-03-10". Aceita os dois.
const isoData = (t) => { const v = String(t || "").trim(), m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : v.slice(0, 10); };
const diasDesde = (isoD, hoje) => Math.round((new Date(hoje + "T12:00:00") - new Date(String(isoD).slice(0, 10) + "T12:00:00")) / 86400000);
async function abGet(e, caminho) {
  const c = e.appbarber || e.reconquista;
  const r = await getExato(`https://api.appbarber.com${caminho}${caminho.includes("?") ? "&" : "?"}establishment_code=${encodeURIComponent(c.codigo_estabelecimento)}`, { "X-API-Key": c.appbarber_api_key, Accept: "application/json", "User-Agent": "GestaoBarberIA-Sync/2.8" });
  if (r.ok) api("POST", { company_id: e.company_id, acao: "ab_uso", creditos: 1 }).catch(() => {});
  else if (/saldo insuficiente/i.test(r.text)) api("POST", { company_id: e.company_id, acao: "ab_uso", creditos: 0, sem_saldo: true }).catch(() => {});
  if (!r.ok) throw new Error(`AppBarber respondeu ${r.status}${motivo(r.text)}`);
  return (JSON.parse(r.text).data) || [];
}
async function baixarClientes(e, hoje) {
  const lista = [];
  for (let pg = 0, total = 1; pg < total && pg < 400; pg++) {
    const d = await abGet(e, `/v1/establishment/clients?pages=${pg}`);
    if (!d.length) break;
    total = Number(d[0].total_pages) || total;
    for (const x of d) { const f = so(x.person_cellphone || x.person_phone); if (f.length >= 10 && x.last_scheduling) lista.push([f, primeiro(x.person_name), isoData(x.last_scheduling)]); }
    await espera(2500);
  }
  // O mesmo telefone pode ter mais de um cadastro (ex.: um antigo e um novo): vale a data mais recente.
  const porFone = new Map();
  for (const x of lista) { const k = chaveFone(x[0]), y = porFone.get(k); if (!y || x[2] > y[2]) porFone.set(k, x); }
  lista.length = 0; lista.push(...porFone.values());
  const env = lerJ(WB_ENV, {});
  // Quem recebeu a mensagem e marcou horário depois dela: "voltou".
  for (const [f, , last] of lista) { const k = chaveFone(f); if (env[k] && !env[k].voltou && last >= env[k].em) env[k].voltou = last; }
  writeFileSync(WB_ENV, JSON.stringify(env));
  writeFileSync(WB_CLI, JSON.stringify({ em: hoje, lista }), { mode: 0o600 });
  log(`${e.nome}: reconquista — ${lista.length} clientes baixados da AppBarber.`);
}
let wbUltimo = 0;
const wbStatusEm = {};
// Telefones com atendimento realizado nos últimos N dias ou horário marcado nos próximos 30 (agenda da AppBarber).
// Baixado 1 vez por dia (1 crédito a cada 31 dias de agenda): é a trava que garante que quem veio há pouco não recebe.
async function recentes(e, hoje, dias) {
  const cache = lerJ(WB_REC, null);
  if (cache && cache.dia === hoje && cache.dias === dias) return new Set(cache.fones);
  const fones = new Set(), c = e.appbarber || e.reconquista;
  const pega = async (ini, fim, st) => {
    const q = new URLSearchParams({ start_date: ini, end_date: fim, status_type: st }); if (c.codigo_filial) q.set("branch_code", String(c.codigo_filial));
    for (const a of await abGet(e, "/v1/appointments/history?" + q)) { const f = so(a.client_phone); if (f.length >= 10) fones.add(chaveFone(f)); }
  };
  const mais = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  for (let fim = hoje, falta = dias; falta > 0; falta -= 31) { const ini = mais(fim, -Math.min(30, falta - 1)); await pega(ini, fim, "2"); fim = mais(ini, -1); }
  await pega(hoje, mais(hoje, 30), "1");
  writeFileSync(WB_REC, JSON.stringify({ dia: hoje, dias, fones: [...fones] }), { mode: 0o600 });
  return fones;
}
async function reconquista(e, hoje) {
  const c = e.reconquista, agora = agoraSP();
  if (fechadoHoje(e) || agora < 10 * 60 || agora > 18 * 60) return;
  let base = lerJ(WB_CLI, null);
  if (!base || diasDesde(base.em, hoje) >= 30) { await baixarClientes(e, hoje); base = lerJ(WB_CLI, { lista: [] }); }
  for (const x of base.lista) x[2] = isoData(x[2]); // lista baixada antes da correção da data
  const env = lerJ(WB_ENV, {}), sair = new Set(lerJ(WB_SAIR, []));
  let rec; try { rec = await recentes(e, hoje, c.minDias); } catch (err) { log(`${e.nome}: reconquista — não consegui conferir a agenda (${err.message}); envio pausado.`); return; }
  const hojeEnv = Object.values(env).filter((x) => x.em === hoje).length;
  const fila = base.lista.filter(([f, , last]) => { const k = chaveFone(f), d = diasDesde(last, hoje);
    return d >= c.minDias && d <= c.maxDias && !sair.has(k) && !rec.has(k) && !(env[k] && diasDesde(env[k].em, hoje) < 180); })
    .sort((a, b) => (a[2] < b[2] ? 1 : a[2] > b[2] ? -1 : 0)); // quem sumiu há menos tempo primeiro
  const intervalo = (8 * 60 / c.porDia) * 60000; // espalha as N mensagens entre 10h e 18h
  if (hojeEnv < c.porDia && fila.length && Date.now() - wbUltimo >= intervalo && pausadoDia !== hoje) {
    for (const [f, nome] of fila.slice(0, 5)) {
      // Confere na hora: se o cliente já marcou horário, não manda.
      const atual = await abGet(e, `/v1/establishment/clients?cellphone=${so(f).replace(/^55(?=\d{10,11}$)/, "")}`).catch(() => null);
      const k = chaveFone(f);
      // Todos os cadastros com esse telefone: vale o atendimento mais recente.
      const last = (atual || []).filter((x) => chaveFone(x.person_cellphone || x.person_phone) === k && x.last_scheduling).map((x) => isoData(x.last_scheduling)).sort().pop() || null;
      if (last && diasDesde(last, hoje) < c.minDias) { env[k] = { em: hoje, pulado: true }; writeFileSync(WB_ENV, JSON.stringify(env)); continue; }
      const h = Math.floor(agora / 60), sd = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
      const versoes = (c.texto ? c.texto.split(/\n\s*-{3,}\s*\n/) : TEXTOS_WB).map((t) => t.trim()).filter(Boolean);
      let texto = versoes[Math.floor(Math.random() * versoes.length)].replace(/\{Saudacao\}/g, sd).replace(/\{saudacao\}/g, sd.toLowerCase())
        .replace(/\{cliente\}/g, nome || "tudo bem").replace(/\{barbearia\}/g, e.nome).replace(/https?:\/\/\S+/gi, "").trim();
      env[k] = { em: hoje }; writeFileSync(WB_ENV, JSON.stringify(env)); wbUltimo = Date.now();
      try { await enviar(f, texto); erroSeguido = 0; log(`${e.nome}: reconquista enviada (${nome || "cliente"}).`); }
      catch (err) { log(`${e.nome}: reconquista não enviada (${err.message}).`); if (!/sem WhatsApp/.test(err.message) && ++erroSeguido >= 3) pausadoDia = hoje; }
      break; // uma por vez; a próxima no próximo intervalo
    }
  }
  if (!wbStatusEm[e.company_id] || Date.now() - wbStatusEm[e.company_id] > 1800000) {
    wbStatusEm[e.company_id] = Date.now();
    const env2 = lerJ(WB_ENV, {}), vals = Object.values(env2).filter((x) => !x.pulado);
    const quando = new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    await api("POST", { company_id: e.company_id, acao: "wb_status", status: `ok: ${quando} · ${vals.filter((x) => x.em === hoje).length} de ${c.porDia} enviadas hoje · ${fila.length} na fila · ${vals.length} enviadas no total · ${vals.filter((x) => x.voltou).length} voltaram a agendar.` }).catch(() => {});
  }
}
// ---------- parabéns aos aniversariantes do dia ----------
// 1 consulta por dia à lista de aniversariantes da AppBarber (próximos 7 dias); manda para quem faz aniversário hoje,
// a partir das 9h, com o ritmo e as proteções de sempre. Cada cliente recebe no máximo 1 vez por ano.
const TEXTO_BD = "🎉💈 Feliz Aniversário {cliente}! 💈🎉\nHoje é um dia especial, e nós, da {barbearia}, queremos desejar a você um novo ciclo repleto de saúde, felicidade, sucesso e muitas conquistas! 🙏🏻🎂\nQue Deus abençoe sua vida, ilumine seus caminhos e que não faltem motivos para sorrir e comemorar! 🥳✨\n\nCaso você venha realizar um serviço de corte ou barba hoje, daremos um serviço extra de cortesia pra você! Gostaria de saber as opções de serviços extras?";
// Quem faz aniversário num dia em que a barbearia fecha (ex.: domingo) recebe o parabéns antecipado no último dia aberto antes.
const TEXTO_BD_VESPERA = "🎉💈 Feliz Aniversário antecipado, {cliente}! 💈🎉\nAmanhã é o seu dia especial, e nós, da {barbearia}, queremos desejar a você um novo ciclo repleto de saúde, felicidade, sucesso e muitas conquistas! 🙏🏻🎂\nQue Deus abençoe sua vida, ilumine seus caminhos e que não faltem motivos para sorrir e comemorar! 🥳✨\n\nComo amanhã a barbearia não abre, caso você venha realizar um serviço de corte ou barba hoje, daremos um serviço extra de cortesia pra você! Gostaria de saber as opções de serviços extras?";
const BD_HOJE = join(DIR, "aniversario-hoje.json"), BD_ENV = join(DIR, "aniversario-enviados.json");
const bdStatusEm = {};
async function aniversarios(e, hoje) {
  const agora = agoraSP();
  if (fechadoHoje(e) || agora < 9 * 60 || agora > 19 * 60) return; // a mensagem convida para vir hoje: só em dia aberto
  let base = lerJ(BD_HOJE, null);
  if (!base || base.dia !== hoje || base.cid !== e.company_id) {
    const d = await abGet(e, "/v1/establishment/birthday");
    // Dias cobertos hoje: o próprio dia e os dias fechados logo em seguida (ex.: sábado cobre o domingo).
    const fech = (e.horario && e.horario.fechados) || [], dias = { [hoje.slice(5)]: "hoje" };
    for (let k = 1; k <= 6; k++) { const x = new Date(hoje + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + k); if (!fech.includes(x.getUTCDay())) break; dias[x.toISOString().slice(5, 10)] = "vespera"; }
    const lista = d.map((x) => { const m = String(x.birth_date || "").match(/^(\d{2})\/(\d{2})/); return [so(x.person_cell_phone || x.person_cellphone || x.person_phone), primeiro(x.person_name), m ? dias[`${m[2]}-${m[1]}`] : null]; })
      .filter(([f, , tipo]) => tipo && f.length >= 10);
    base = { dia: hoje, cid: e.company_id, lista };
    writeFileSync(BD_HOJE, JSON.stringify(base), { mode: 0o600 });
    log(`${e.nome}: ${lista.length} aniversariante(s) hoje.`);
  }
  const env = lerJ(BD_ENV, {}), ano = hoje.slice(0, 4);
  const fila = base.lista.filter(([f]) => env[chaveFone(f)] !== ano);
  const principal = NUMERO === "principal", L = LIMITE[principal ? "principal" : "chip"];
  if (ritmo.dia !== hoje) { ritmo = { dia: hoje, envios: [] }; erroSeguido = 0; }
  const versoes = (e.aniversario.texto ? e.aniversario.texto.split(/\n\s*-{3,}\s*\n/) : [TEXTO_BD]).map((t) => t.trim()).filter(Boolean);
  for (const [i, [f, nome, tipo]] of fila.entries()) {
    if (pausadoDia === hoje) break;
    const ultHora = ritmo.envios.filter((t) => Date.now() - t < 3600000).length;
    if (ultHora >= L.hora || ritmo.envios.length >= L.dia) break;
    let texto = (tipo === "vespera" ? TEXTO_BD_VESPERA : versoes[Math.floor(Math.random() * versoes.length)]).replace(/\{cliente\}/g, nome || "").replace(/\{barbearia\}/g, e.nome).replace(/ !/g, "!");
    if (principal) texto = texto.replace(/https?:\/\/\S+/gi, "").trim();
    env[chaveFone(f)] = ano; writeFileSync(BD_ENV, JSON.stringify(env));
    try { await enviar(f, texto); erroSeguido = 0; ritmo.envios.push(Date.now()); log(`${e.nome}: parabéns enviado (${nome || "cliente"}).`); }
    catch (err) { log(`${e.nome}: parabéns não enviado (${err.message}).`); if (!/sem WhatsApp/.test(err.message) && ++erroSeguido >= 3) { pausadoDia = hoje; break; } }
    if (i < fila.length - 1) await espera(L.de + Math.random() * (L.ate - L.de));
  }
  if (!bdStatusEm[e.company_id] || Date.now() - bdStatusEm[e.company_id] > 1800000) {
    bdStatusEm[e.company_id] = Date.now();
    const env2 = lerJ(BD_ENV, {}), feitos = base.lista.filter(([f]) => env2[chaveFone(f)] === ano).length;
    const quando = new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    await api("POST", { company_id: e.company_id, acao: "bd_status", status: `ok: ${quando} · ${base.lista.length ? `${feitos} de ${base.lista.length} aniversariante(s) de hoje parabenizado(s)` : "nenhum aniversariante hoje"}.` }).catch(() => {});
  }
}

// A mensagem não oferece o SAIR, mas se alguém responder SAIR, a reconquista não manda mais para ele.
async function sairDaLista(msg) {
  if (!msg || !msg.key || msg.key.fromMe) return;
  const t = String((msg.message && (msg.message.conversation || (msg.message.extendedTextMessage && msg.message.extendedTextMessage.text))) || "").trim();
  if (!/^sair\b/i.test(t) || t.length > 30) return;
  const jid = [msg.key.remoteJid, msg.key.remoteJidAlt, msg.key.senderPn, msg.key.participantPn].find((j) => j && /@s\.whatsapp\.net$/.test(j));
  if (!jid) return;
  const lista = new Set(lerJ(WB_SAIR, [])); const k = chaveFone(jid.split("@")[0]);
  if (lista.has(k)) return;
  lista.add(k); writeFileSync(WB_SAIR, JSON.stringify([...lista]));
  await espera(4000 + Math.random() * 4000);
  await sock.sendMessage(msg.key.remoteJid, { text: "Pronto! Você não vai mais receber essas mensagens. Se precisar, é só chamar a gente por aqui. 😊" }).catch(() => {});
}

// Resposta automática: este número só envia lembretes. Quem responder recebe, uma vez por dia, o recado do dono.
let respostas = [], respondidos = {};
async function responder(m) {
  if (m.type === "notify") for (const msg of m.messages || []) await sairDaLista(msg).catch(() => {});
  if (m.type !== "notify" || !respostas.length || NUMERO === "principal") return; // no principal, quem responde é a recepção
  if (sofia && sofia.ativaAgora()) return; // no horário da Sofia, quem responde é ela
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  if (respondidos.dia !== hoje) respondidos = { dia: hoje };
  for (const msg of m.messages || []) {
    const jid = msg.key && msg.key.remoteJid;
    if (!jid || msg.key.fromMe || !/@(s\.whatsapp\.net|lid)$/.test(jid) || respondidos[jid]) continue;
    respondidos[jid] = 1;
    await espera(3000 + Math.random() * 4000);
    await sock.sendMessage(jid, { text: respostas[0] }).catch(() => {});
  }
}

// Atualização automática: a cada 6 horas baixa a versão nova do site; se mudar, sai e o systemd reinicia.
let atualizouEm = 0;
async function atualizar() {
  if (Date.now() - atualizouEm < 6 * 3600000) return; atualizouEm = Date.now();
  try {
    const r = await fetch(`${SITE}/integracoes/servidor/whatsapp.mjs`, { cache: "no-store" }); if (!r.ok) return;
    const novo = await r.text(), v = (novo.match(/const VERSAO = "([^"]+)"/) || [])[1];
    if (!v || v === VERSAO || novo.length < 1000) return;
    const eu = fileURLToPath(import.meta.url), tmp = eu.replace(/\.mjs$/, ".novo.mjs");
    writeFileSync(tmp, novo); if (spawnSync(process.execPath, ["--check", tmp]).status !== 0) return;
    // A Sofia (sofia.mjs) atualiza junto.
    const rs = await fetch(`${SITE}/integracoes/servidor/sofia.mjs`, { cache: "no-store" });
    if (rs.ok) { const ns = await rs.text(), ts = join(DIR, "sofia.novo.mjs"); writeFileSync(ts, ns); if (ns.length > 1000 && spawnSync(process.execPath, ["--check", ts]).status === 0) renameSync(ts, join(DIR, "sofia.mjs")); else rmSync(ts, { force: true }); }
    renameSync(tmp, eu); log(`Atualizado para a versão ${v}. Reiniciando…`); if (sofia && sofia.salvar) sofia.salvar(); process.exit(0);
  } catch { /* sem internet: tenta depois */ }
}

// Lembrete dos clientes: usa o número escolhido no app (principal ou 2º chip) e troca sozinho quando o dono muda.
async function escolherNumero(minhas) {
  const m0 = minhas[0] || {}, quer = (m0.numero || (m0.clientes && m0.clientes.numero)) === "principal" ? "principal" : "chip";
  if (quer === NUMERO && (aberto || !existsSync(join(AUTH, "creds.json")))) return;
  if (quer !== NUMERO) {
    if (sock) { geracao++; try { sock.end(undefined); } catch { /* já fechado */ } }
    aberto = false; saiu = false; avisouOff = 0; NUMERO = quer; AUTH = pasta(quer); CMD = cmdDe(quer);
    log(`Lembrete dos clientes agora pelo ${quer === "principal" ? "WhatsApp principal" : "2º chip"}.`);
  }
  if (!aberto && existsSync(join(AUTH, "creds.json"))) { await Promise.race([conectar(), espera(30000)]); if (aberto) avisarConectado = true; }
}

async function ciclo() {
  await atualizar();
  const { empresas = [], hoje } = await api("GET", null, "?acao=lembretes");
  // Cada número cuida só das empresas com o seu tipo de lembrete ligado.
  const minhas = empresas.filter((e) => (CLI ? !!(e.clientes || e.feedback || e.reconquista || e.retorno || e.totem || e.aniversario || e.sofia) : e.cfg.ligado !== false));
  empresasConhecidas = minhas.map((e) => e.company_id);
  if (CLI) await escolherNumero(minhas);
  // Sofia: atende o número dos clientes da primeira barbearia com a atendente IA ligada.
  if (CLI && SOFIA) { if (!sofia) sofia = SOFIA.criarSofia({ dir: DIR, log, api, sock: () => sock, conectado: () => aberto, cmdConectar: () => CMD,
    baixarMidia: (msg) => downloadMediaMessage(msg, "buffer", {}, { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage }) }); await sofia.configurar(minhas.find((e) => e.sofia)).catch((err) => log("Sofia: " + err.message)); }
  // Serviços da AppBarber para o app sugerir os nomes nas ofertas (upsell): 1 vez a cada 6 horas.
  if (CLI && SOFIA && SOFIA.publicarServicos) { const eA = minhas.find((e) => e.appbarber && (e.sofia || e.totem)); if (eA) SOFIA.publicarServicos(eA, api).catch((err) => log("Serviços da AppBarber: " + err.message)); }
  // Totem da recepção: funciona mesmo com o WhatsApp desconectado (só o aviso ao profissional usa o WhatsApp).
  if (CLI && SOFIA && SOFIA.criarTotem) { if (!totem) totem = SOFIA.criarTotem({ dir: DIR, log, api, sock: () => (aberto ? sock : null) }); try { totem.configurar(minhas.find((e) => e.totem)); } catch (err) { log("Totem: " + err.message); } }
  if (!aberto) { if (Date.now() - avisouOff > 3600000) { avisouOff = Date.now(); await status(`desconectado: conecte o número no servidor (${CMD}).`); } return; }
  if (avisarConectado) { avisarConectado = false; await status(CLI ? `ok: ${NUMERO === "principal" ? "WhatsApp principal" : "2º chip"} conectado, aguardando os horários.` : "conectado: aguardando o horário dos lembretes."); }
  if (CLI) {
    respostas = minhas.map((e) => e.clientes && e.clientes.resposta).filter(Boolean);
    for (const e of minhas) if (e.clientes) await lembretesClientes(e, hoje).catch((err) => { log(`${e.nome}: lembretes de clientes: ${err.message}`); status("erro: " + err.message, [e.company_id]); });
    for (const e of minhas) if (e.feedback) await feedbacks(e, hoje).catch((err) => log(`${e.nome}: feedback: ${err.message}`));
    for (const e of minhas) if (e.aniversario && e.appbarber) await aniversarios(e, hoje).catch((err) => { log(`${e.nome}: aniversário: ${err.message}`); api("POST", { company_id: e.company_id, acao: "bd_status", status: "erro: " + err.message }).catch(() => {}); });
    for (const e of minhas) if (e.reconquista) await reconquista(e, hoje).catch((err) => { log(`${e.nome}: reconquista: ${err.message}`); api("POST", { company_id: e.company_id, acao: "wb_status", status: "erro: " + err.message }).catch(() => {}); });
    // Retorno no tempo certo: convite alguns dias antes do prazo de costume de cada cliente (aprendido da agenda).
    const eRt = minhas.find((e) => e.retorno);
    if (eRt && SOFIA && SOFIA.criarRetorno) {
      if (!retorno) retorno = SOFIA.criarRetorno({ dir: DIR, log, api, sock: () => (aberto ? sock : null), sofia: () => sofia, pode: () => pausadoDia !== hoje });
      await retorno.rodar(eRt, hoje).catch((err) => { log(`${eRt.nome}: retorno: ${err.message}`); api("POST", { company_id: eRt.company_id, acao: "rt_status", status: "erro: " + err.message }).catch(() => {}); });
    }
    return;
  }
  // O número da equipe (conectado) avisa quando o WhatsApp dos clientes cai.
  await avisarDesconectado(empresas).catch((err) => log("Aviso de desconexão: " + err.message));
  const env = lerEnviados(); for (const d of Object.keys(env)) if (d < hoje) delete env[d];
  env[hoje] = env[hoje] || {};
  for (const e of minhas) {
    if (fechadoHoje(e)) continue; // barbearia fechada hoje: sem lembrete para a equipe
    const ini = min(e.cfg.hora), agora = agoraSP();
    // Só na janela de 3 horas a partir do horário escolhido (se o servidor ficar fora do ar, não manda tarde demais).
    if (agora < ini || agora > ini + 180 || env[hoje][e.company_id]) continue;
    const lista = await quemRecebe(e);
    const ok = [], erros = [];
    for (const [i, x] of lista.entries()) {
      try { await enviar(x.b.phone, x.texto); ok.push(x.b.name.split(" ")[0]); log(`${e.nome}: lembrete para ${x.b.name} (${fmt(x.pts)} pts).`); }
      catch (err) { erros.push(`${x.b.name.split(" ")[0]} (${err.message})`); log(`${e.nome}: não enviei para ${x.b.name}: ${err.message}`); }
      if (i < lista.length - 1) await espera(25000 + Math.random() * 20000); // intervalo entre mensagens: menos risco de bloqueio
    }
    env[hoje][e.company_id] = ok; writeFileSync(ENVIADOS, JSON.stringify(env));
    const quando = new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    await status(`ok: ${quando} · ${ok.length ? `lembrete enviado para ${ok.join(", ")}` : "todos já tinham feito o mínimo, ninguém precisou de lembrete"}${erros.length ? ` · não enviado: ${erros.join(", ")}` : ""}.`, [e.company_id]);
  }
}

// ---------- aviso: WhatsApp dos clientes desconectado ----------
// Roda no programa da equipe, que usa outro número e continua conectado. Se o número dos clientes (lembretes, Sofia,
// parabéns, reconquista) ficar desconectado por 10 minutos, manda um aviso para o WhatsApp de avisos urgentes
// (Integração › Atendente IA) com o comando para reconectar; quando voltar, avisa que voltou.
const AV_OFF = join(DIR, "aviso-desconectado.json");
async function avisarDesconectado(empresas) {
  const av = lerJ(AV_OFF, {}); let mudou = false;
  for (const e of empresas) {
    const w = e.wa_clientes; if (!w || !w.alerta) continue;
    const off = /^desconectado/.test(w.status || ""), x = av[e.company_id];
    if (off && !x) { av[e.company_id] = { desde: Date.now() }; mudou = true; continue; }
    if (off && !x.avisado && Date.now() - x.desde >= 10 * 60000) {
      const qual = w.numero === "principal" ? "WhatsApp principal" : "2º chip (lembretes dos clientes)";
      const cmd = w.numero === "principal" ? "gbia-whatsapp-conectar-principal" : "gbia-whatsapp-conectar-clientes";
      const parado = ["lembretes de agendamento", ...(w.sofia ? ["a Sofia"] : []), "parabéns", "reconquista", "retorno"].join(", ");
      const t = `⚠️ Gestão Barber IA: o ${qual} da ${e.nome} desconectou do servidor. Estão parados: ${parado}.\n\nPara reconectar: no console da Vultr, rode\n${cmd}\ne leia o QR code no celular desse número (WhatsApp › Aparelhos conectados › Conectar um aparelho).`;
      try { await enviar(w.alerta, t); x.avisado = Date.now(); mudou = true; log(`${e.nome}: avisei que o ${qual} desconectou.`); }
      catch (err) { log(`${e.nome}: não consegui avisar a desconexão (${err.message}).`); }
      continue;
    }
    if (!off && x) {
      if (x.avisado) { try { await enviar(w.alerta, `✅ Gestão Barber IA: o ${w.numero === "principal" ? "WhatsApp principal" : "2º chip"} da ${e.nome} está conectado de novo. Tudo voltou a funcionar.`); } catch { /* tenta só uma vez */ } }
      delete av[e.company_id]; mudou = true;
    }
  }
  if (mudou) writeFileSync(AV_OFF, JSON.stringify(av));
}

// ---------- início ----------
if (TOKEN.length < 32) { log("ERRO: falta o SYNC_TOKEN em /etc/gbia-sync.env."); process.exit(1); }
if (process.argv.includes("--conectar") || arg("--codigo") !== null) {
  rmSync(AUTH, { recursive: true, force: true });
  const ok = await conectar({ qr: process.argv.includes("--conectar"), codigo: arg("--codigo") || "" });
  if (ok) { console.log("\nPronto! Número conectado.\n"); await espera(3000); }
  process.exit(ok ? 0 : 1);
}
// Diagnóstico da agenda: mostra quantos agendamentos de hoje a AppBarber devolve (sem nomes nem telefones).
if (process.argv.includes("--agenda")) {
  const { empresas = [], hoje } = await api("GET", null, "?acao=lembretes");
  let ip = "?"; try { ip = (await (await fetch("https://api.ipify.org")).text()).trim(); } catch { /* sem IP */ }
  console.log(`IP deste servidor: ${ip} · hoje: ${hoje}`);
  for (const e of empresas.filter((x) => x.clientes)) {
    try { const l = await agendaHoje(e, hoje); console.log(`${e.nome}: ${l.length} agendamento(s) com status Agendado hoje; ${blocos(l, hoje).length} lembrete(s) a enviar no dia.`); }
    catch (err) { console.log(`${e.nome}: ERRO ${err.message}`); }
  }
  process.exit(0);
}
// Relatório semanal da Sofia agora (sem esperar o domingo): gera, manda para o app e mostra aqui.
if (process.argv.includes("--sofia-relatorio")) {
  if (!SOFIA || !process.env.ANTHROPIC_API_KEY) { console.log("Falta a Sofia ou a chave da Anthropic (gbia-sofia-chave)."); process.exit(1); }
  const { empresas = [] } = await api("GET", null, "?acao=lembretes");
  const e = empresas.find((x) => x.sofia); if (!e) { console.log("A atendente IA não está ligada no app."); process.exit(1); }
  const Anthropic = await SOFIA.carregarSDK(DIR, log), client = new Anthropic();
  const rel = await SOFIA.gerarRelatorio({ client, modelo: e.sofia.modelo || SOFIA.MODELO_PADRAO, registros: SOFIA.lerRegistros(DIR), notas: e.sofia.notas || "", nome: e.sofia.nome || "Sofia", barbearia: e.nome });
  await api("POST", { company_id: e.company_id, acao: "ia_report", relatorio: rel });
  console.log(JSON.stringify(rel, null, 2)); console.log("\nRelatório enviado para o app (Integração › Atendente IA).");
  process.exit(0);
}
// Conversa com a Sofia no terminal: usa a AppBarber de verdade para serviços e horários, mas não marca nem cancela nada.
if (process.argv.includes("--sofia")) {
  if (!SOFIA) process.exit(1);
  if (!process.env.ANTHROPIC_API_KEY) { console.log("Falta a chave da Anthropic. Rode: gbia-sofia-chave"); process.exit(1); }
  const { empresas = [] } = await api("GET", null, "?acao=lembretes");
  const e = empresas.find((x) => x.sofia && x.appbarber) || empresas.find((x) => x.sofia_teste && x.appbarber) || empresas.find((x) => x.appbarber);
  if (!e) { console.log("Nenhuma barbearia com a AppBarber ligada."); process.exit(1); }
  e.sofia = e.sofia || e.sofia_teste; // o teste usa o nome, o modelo e as informações do app mesmo com a Sofia desligada
  const Anthropic = await SOFIA.carregarSDK(DIR, log), client = new Anthropic();
  const s = e.sofia || {}, modelo = s.modelo || SOFIA.MODELO_PADRAO;
  const ab = SOFIA.ferramentasAppBarber({ cfg: e.appbarber, creditos: (n, z) => api("POST", { company_id: e.company_id, acao: "ab_uso", creditos: n, ...(z ? { sem_saldo: true } : {}) }).catch(() => {}) });
  const artes = Array.isArray(s.artes) ? s.artes.filter((a) => a && a.url && a.nome) : [];
  const sistema = SOFIA.promptSistema({ nome: s.nome || "Sofia", barbearia: e.nome, notas: s.notas || "", brand: e.brand, artes, horario: e.horario, upsell: s.upsell || [] });
  const conv = { mensagens: [] }, stats = { agendados: 0, remarcados: 0, cancelados: 0, recepcao: 0 };
  const fone = arg("--fone") ? SOFIA.normFone(arg("--fone")) : "";
  const ctx = { ab, fone, stats, simular: true, artes, falha: (t) => console.log("  [falha: " + t + "]"), registro: (t) => console.log("  [" + t + "]"), pendencia: (t) => console.log("  [recepção: " + t + "]") };
  console.log(`Teste da ${s.nome || "Sofia"} (${modelo}) — ${e.nome}. Nada é marcado de verdade. Escreva como cliente; "sair" para terminar.\n`);
  const rl = (await import("node:readline")).createInterface({ input: process.stdin });
  let total = 0; process.stdout.write("Você: ");
  for await (const linha of rl) {
    if (/^sair$/i.test(linha.trim())) break;
    if (!linha.trim()) { process.stdout.write("Você: "); continue; }
    const cad = conv.mensagens.length ? "" : (await SOFIA.verificarCadastro(ab, fone, conv)) + "\n";
    if (cad) console.log("  " + cad.trim());
    conv.mensagens.push({ role: "user", content: SOFIA.agoraTexto(fone) + "\n" + cad + linha });
    const r = await SOFIA.rodada({ client, modelo, sistema, conv, ctx }).catch((err) => ({ texto: "[erro: " + err.message + "]", gasto: 0 }));
    total += r.gasto; console.log(`${s.nome || "Sofia"}: ${r.texto}\n  (custo até agora ≈ US$ ${total.toFixed(3)})\n`); process.stdout.write("Você: ");
  }
  process.exit(0);
}
if (arg("--teste") !== null) {
  if (!existsSync(AUTH)) { console.log(`Conecte o número primeiro: ${CMD}`); process.exit(1); }
  await conectar(); await enviar(arg("--teste"), CLI ? "Teste do Gestão Barber IA: o lembrete de agendamento dos clientes está funcionando. ✅" : "Teste do Gestão Barber IA: os lembretes do checklist no WhatsApp estão funcionando. ✅");
  console.log("Mensagem de teste enviada."); await espera(2000); process.exit(0);
}
log(`Lembretes no WhatsApp ${VERSAO} iniciado (número da ${CLI ? "agenda dos clientes" : "equipe"}).`);
if (!CLI) {
  if (existsSync(join(AUTH, "creds.json"))) conectar().then((ok) => { if (ok) avisarConectado = true; });
  else log(`Sem número conectado: rode ${CMD} no servidor.`);
}
// Parada do serviço (reinício, instalador, atualização): grava as conversas da Sofia antes de sair.
for (const sinal of ["SIGTERM", "SIGINT"]) process.on(sinal, () => { try { if (sofia && sofia.salvar) sofia.salvar(); } catch { /* sai assim mesmo */ } process.exit(0); });
for (;;) {
  await ciclo().catch((e) => log("ERRO no ciclo: " + e.message));
  if (saiu) { await espera(600000); continue; }
  await espera(120000);
}
