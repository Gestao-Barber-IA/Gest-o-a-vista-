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
//   node whatsapp.mjs                        serviço (systemd gbia-whatsapp)
// Variáveis (em /etc/gbia-sync.env): SYNC_TOKEN (obrigatória), SYNC_URL, SITE_URL.
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const VERSAO = "1.1";
const DIR = dirname(fileURLToPath(import.meta.url));
const AUTH = join(DIR, "sessao");
const ENVIADOS = join(DIR, "enviados.json");
const ENV_CLI = join(DIR, "enviados-clientes.json");
const TOKEN = process.env.SYNC_TOKEN || "";
const SYNC_URL = process.env.SYNC_URL || "https://sekkmnkajnaqubyhpxvd.supabase.co/functions/v1/sync-servidor";
const SITE = (process.env.SITE_URL || "https://gestaoperformance.vercel.app").replace(/\/$/, "");
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? (process.argv[i + 1] || "") : null; };
const log = (m) => console.log(`[${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}] ${m}`);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const so = (t) => String(t || "").replace(/\D/g, "");

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = await import("baileys");
const pino = (await import("pino")).default;

// ---------- conexão ----------
let sock = null, aberto = false, saiu = false;
async function conectar({ qr = false, codigo = "" } = {}) {
  mkdirSync(AUTH, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(AUTH);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  sock = makeWASocket({ auth: state, version, logger: pino({ level: "silent" }), browser: Browsers.ubuntu("Gestão Barber IA"), markOnlineOnConnect: false, syncFullHistory: false });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("messages.upsert", (m) => responder(m).catch(() => {}));
  let pediuCodigo = false;
  return new Promise((ok) => {
    sock.ev.on("connection.update", async (u) => {
      if (u.qr && qr) { const qrt = (await import("qrcode-terminal")).default; console.log("\nAbra o WhatsApp do chip › Aparelhos conectados › Conectar um aparelho e leia o QR code:\n"); qrt.generate(u.qr, { small: true }); }
      if (u.qr && codigo && !pediuCodigo) { pediuCodigo = true; const c = await sock.requestPairingCode(so(codigo)); console.log(`\nNo WhatsApp do chip: Aparelhos conectados › Conectar um aparelho › Conectar com número de telefone e digite: ${c}\n`); }
      if (u.qr && !qr && !codigo) { aberto = false; await status("desconectado: o número precisa ser conectado de novo (no servidor: gbia-whatsapp-conectar)."); log("Sem sessão: rode gbia-whatsapp-conectar no servidor."); }
      if (u.connection === "open") { aberto = true; log("WhatsApp conectado."); ok(true); }
      if (u.connection === "close") {
        aberto = false;
        const code = u.lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) { saiu = true; log("O número foi desconectado no celular."); await status("desconectado: o número foi removido em Aparelhos conectados. Conecte de novo no servidor."); rmSync(AUTH, { recursive: true, force: true }); ok(false); return; }
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
  for (const id of ids) await api("POST", { company_id: id, acao: "wa_status", status: msg }).catch(() => {});
}

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
// "21/12/2026 14:30" → minutos desde 00:00 do dia, e o dia em ISO
const hm = (s) => { const m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/); return m ? { dia: `${m[3]}-${m[2]}-${m[1]}`, min: +m[4] * 60 + +m[5] } : null; };
const hhmm = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}h${String(n % 60).padStart(2, "0")}`.replace(/h00$/, "h");
const primeiro = (n) => { const w = String(n || "").trim().split(/\s+/)[0] || ""; return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""; };
const TEXTO_CLI = "Olá, {cliente}! 👋 Passando para lembrar do seu horário hoje às {hora} com {profissional} ({servico}) na {barbearia}.\n\nTe esperamos! 💈 Se não puder vir, avise a barbearia para liberarmos o horário.";
const agendaCache = {};
async function agendaHoje(e, hoje) {
  const c = e.clientes, k = e.company_id, cache = agendaCache[k];
  if (cache && cache.dia === hoje && Date.now() - cache.em < 5 * 60000) return cache.lista; // AppBarber: no máximo 1 consulta a cada 5 min
  const q = new URLSearchParams({ establishment_code: String(c.codigo_estabelecimento), start_date: hoje, end_date: hoje, status_type: "1" });
  if (c.codigo_filial) q.set("branch_code", String(c.codigo_filial));
  const r = await getExato("https://api.appbarber.com/v1/appointments/history?" + q, { "X-API-Key": c.appbarber_api_key, Accept: "application/json", "User-Agent": "GestaoBarberIA-WhatsApp/" + VERSAO });
  if (!r.ok) throw new Error(`AppBarber respondeu ${r.status}`);
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
async function lembretesClientes(e, hoje) {
  const c = e.clientes, lead = Math.max(15, Math.min(240, Number(c.antecedencia) || 60)), agora = agoraSP();
  const env = lerCli(); for (const d of Object.keys(env)) if (d < hoje) delete env[d];
  const feitos = new Set((env[hoje] = env[hoje] || {})[e.company_id] || []);
  const lista = blocos(await agendaHoje(e, hoje), hoje);
  // Hora de mandar: faltam no máximo `lead` minutos (e ainda falta pelo menos 10). Quem agendou depois disso não recebe.
  const fila = lista.filter((b) => !b.cods.some((k) => feitos.has(k)) && b.min - agora <= lead && b.min - agora >= 10 && (b.reg < 0 || b.min - b.reg >= lead));
  let n = 0;
  for (const [i, b] of fila.entries()) {
    const texto = (c.texto || TEXTO_CLI).replace(/\{cliente\}/g, b.nome || "tudo bem").replace(/\{hora\}/g, hhmm(b.min)).replace(/\{profissional\}/g, junta(b.profs) || "a nossa equipe")
      .replace(/\{servico\}/g, junta(b.servs) || "seu atendimento").replace(/\{barbearia\}/g, e.nome).replace(/ \(\)/g, "");
    try { await enviar(b.fone, texto); n++; } catch (err) { log(`${e.nome}: lembrete de cliente não enviado (${err.message}).`); }
    b.cods.forEach((k) => feitos.add(k)); env[hoje][e.company_id] = [...feitos]; writeFileSync(ENV_CLI, JSON.stringify(env));
    if (i < fila.length - 1) await espera(20000 + Math.random() * 20000);
  }
  if (n || !cliStatusEm[e.company_id] || Date.now() - cliStatusEm[e.company_id] > 3600000) {
    cliStatusEm[e.company_id] = Date.now();
    const total = (env[hoje][e.company_id] || []).length, prox = lista.filter((b) => !b.cods.some((k) => feitos.has(k)) && b.min > agora).sort((a, b) => a.min - b.min)[0];
    const quando = new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
    await api("POST", { company_id: e.company_id, acao: "cl_status", status: `ok: ${quando} · ${total ? `${total} agendamento(s) lembrado(s) hoje` : "nenhum lembrete enviado hoje ainda"}${prox ? ` · próximo horário às ${hhmm(prox.min)}` : ""}.` }).catch(() => {});
  }
}
const cliStatusEm = {};
// Resposta automática: este número só envia lembretes. Quem responder recebe, uma vez por dia, o recado do dono.
let respostas = [], respondidos = {};
async function responder(m) {
  if (m.type !== "notify" || !respostas.length) return;
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
    renameSync(tmp, eu); log(`Atualizado para a versão ${v}. Reiniciando…`); process.exit(0);
  } catch { /* sem internet: tenta depois */ }
}

async function ciclo() {
  await atualizar();
  const { empresas = [], hoje } = await api("GET", null, "?acao=lembretes");
  empresasConhecidas = empresas.map((e) => e.company_id);
  respostas = empresas.map((e) => e.clientes && e.clientes.resposta).filter(Boolean);
  if (aberto) for (const e of empresas) if (e.clientes) await lembretesClientes(e, hoje).catch((err) => { log(`${e.nome}: lembretes de clientes: ${err.message}`); api("POST", { company_id: e.company_id, acao: "cl_status", status: "erro: " + err.message }).catch(() => {}); });
  if (!aberto) { if (Date.now() - avisouOff > 3600000) { avisouOff = Date.now(); await status("desconectado: conecte o número no servidor (gbia-whatsapp-conectar)."); } return; }
  const env = lerEnviados(); for (const d of Object.keys(env)) if (d < hoje) delete env[d];
  env[hoje] = env[hoje] || {};
  for (const e of empresas) {
    if (e.cfg.ligado === false) continue; // só os lembretes de clientes estão ligados
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

// ---------- início ----------
if (TOKEN.length < 32) { log("ERRO: falta o SYNC_TOKEN em /etc/gbia-sync.env."); process.exit(1); }
if (process.argv.includes("--conectar") || arg("--codigo") !== null) {
  rmSync(AUTH, { recursive: true, force: true });
  const ok = await conectar({ qr: process.argv.includes("--conectar"), codigo: arg("--codigo") || "" });
  if (ok) { console.log("\nPronto! Número conectado. Agora rode: systemctl start gbia-whatsapp\n"); await espera(3000); }
  process.exit(ok ? 0 : 1);
}
if (arg("--teste") !== null) {
  if (!existsSync(AUTH)) { console.log("Conecte o número primeiro: gbia-whatsapp-conectar"); process.exit(1); }
  await conectar(); await enviar(arg("--teste"), "Teste do Gestão Barber IA: os lembretes do checklist no WhatsApp estão funcionando. ✅");
  console.log("Mensagem de teste enviada."); await espera(2000); process.exit(0);
}
log(`Lembretes no WhatsApp ${VERSAO} iniciado.`);
if (existsSync(join(AUTH, "creds.json"))) conectar().then((ok) => ok && status("conectado: aguardando o horário dos lembretes."));
else log("Sem número conectado: rode gbia-whatsapp-conectar no servidor.");
for (;;) {
  await ciclo().catch((e) => log("ERRO no ciclo: " + e.message));
  if (saiu) { await espera(600000); continue; }
  await espera(120000);
}
