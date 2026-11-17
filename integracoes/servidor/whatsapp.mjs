// Gestão Barber IA — lembretes do checklist no WhatsApp (roda no servidor de sincronização).
// Conecta um número de WhatsApp (como o WhatsApp Web, pelo motor Baileys, sem Docker e sem banco de dados)
// e, no horário escolhido pelo dono (ex.: 13h), manda um lembrete a quem está trabalhando hoje e fez
// pouco do Checklist Agenda Cheia. Uma mensagem por pessoa por dia, com intervalo entre os envios.
//
// Uso:
//   node whatsapp.mjs --conectar            mostra o QR code para ligar o número (WhatsApp › Aparelhos conectados)
//   node whatsapp.mjs --codigo 5511999998888  liga pelo código de 8 letras (Conectar com número de telefone)
//   node whatsapp.mjs --teste 5511999998888   envia uma mensagem de teste para esse número
//   node whatsapp.mjs                        serviço (systemd gbia-whatsapp)
// Variáveis (em /etc/gbia-sync.env): SYNC_TOKEN (obrigatória), SYNC_URL, SITE_URL.
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const VERSAO = "1.0";
const DIR = dirname(fileURLToPath(import.meta.url));
const AUTH = join(DIR, "sessao");
const ENVIADOS = join(DIR, "enviados.json");
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

async function ciclo() {
  const { empresas = [], hoje } = await api("GET", null, "?acao=lembretes");
  empresasConhecidas = empresas.map((e) => e.company_id);
  if (!aberto) { if (Date.now() - avisouOff > 3600000) { avisouOff = Date.now(); await status("desconectado: conecte o número no servidor (gbia-whatsapp-conectar)."); } return; }
  const env = lerEnviados(); for (const d of Object.keys(env)) if (d < hoje) delete env[d];
  env[hoje] = env[hoje] || {};
  for (const e of empresas) {
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
