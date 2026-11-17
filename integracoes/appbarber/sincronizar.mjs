// Gestão Barber IA — sincronização com a AppBarber.
// Roda no computador da barbearia (o IP dele é o liberado na AppBarber).
// Busca os atendimentos REALIZADOS dos últimos 31 dias (1 chamada à AppBarber)
// e envia o total de cada profissional por dia para o Gestão Barber IA.
// Uso:  node sincronizar.mjs          (envia)
//       node sincronizar.mjs --teste  (só mostra os números, não envia)
// Precisa do Node.js 18 ou mais novo. Configuração em config.json (veja config.exemplo.json).
import { readFileSync, appendFileSync, writeFileSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSAO = "3.3";
const DIR = dirname(fileURLToPath(import.meta.url));
const TESTE = process.argv.includes("--teste");
const CARGA = process.argv.includes("--carga"); // carga inicial: lê todas as comandas no ritmo máximo permitido
const log = (msg) => {
  const line = `[${new Date().toLocaleString("pt-BR")}] ${msg}`;
  console.log(line);
  try { appendFileSync(join(DIR, "sincronizacao.log"), line + "\n"); } catch { /* sem log em arquivo */ }
};

// Instalação guiada: pergunta as chaves e grava o config.json (node sincronizar.mjs --configurar).
if (process.argv.includes("--configurar")) {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin });
  const fila = [], esperando = [];
  rl.on("line", (l) => (esperando.length ? esperando.shift()(l) : fila.push(l)));
  rl.on("close", () => { while (esperando.length) esperando.shift()(""); });
  rl.question = (q) => { process.stdout.write(q); return fila.length ? Promise.resolve(fila.shift()) : new Promise((r) => esperando.push(r)); };
  let old = {}; try { old = JSON.parse(readFileSync(join(DIR, "config.json"), "utf8")); } catch { /* primeira vez */ }
  const ask = async (q, k) => { const v = (await rl.question(q + (old[k] ? " (Enter mantém a atual)" : "") + ":\n> ")).trim(); return v || old[k] || ""; };
  console.log("\n=== Configuração da sincronização AppBarber → Gestão Barber IA ===\n");
  const c = { ...old };
  c.appbarber_api_key = await ask("1) Cole a CHAVE DA API da AppBarber (enviada pela AppBarber)", "appbarber_api_key");
  c.codigo_estabelecimento = await ask("2) Digite o CÓDIGO DO ESTABELECIMENTO na AppBarber", "codigo_estabelecimento");
  c.gestao_api_key = await ask("3) Cole a CHAVE gbia_ do Gestão Barber IA (menu Configurações › Integração & API)", "gestao_api_key");
  rl.close();
  if (!c.appbarber_api_key || !c.codigo_estabelecimento || !/^gbia_/.test(c.gestao_api_key)) { console.log("\nFaltou alguma informação (a chave do Gestão começa com gbia_). Rode o instalar.bat de novo."); process.exit(1); }
  c.nomes = c.nomes || {};
  writeFileSync(join(DIR, "config.json"), JSON.stringify(c, null, 2));
  console.log("\nConfiguração salva.\n");
  process.exit(0);
}

let cfg;
try { cfg = JSON.parse(readFileSync(join(DIR, "config.json"), "utf8")); }
catch { log("ERRO: não encontrei o config.json. Dê dois cliques em instalar.bat."); process.exit(1); }
for (const k of ["appbarber_api_key", "codigo_estabelecimento", "gestao_api_key"]) {
  if (!cfg[k] || String(cfg[k]).includes("COLE")) { log(`ERRO: preencha "${k}" no config.json.`); process.exit(1); }
}
const DIAS = Math.min(31, Math.max(1, Number(cfg.dias) || 31));
const GESTAO_URL = cfg.gestao_url || "https://sekkmnkajnaqubyhpxvd.supabase.co/functions/v1/lancamentos";
const NOMES = cfg.nomes || {}; // "Nome na AppBarber": "Nome no Gestão Barber IA"
const BASE = cfg.appbarber_url || "https://api.appbarber.com";
const CACHE = join(DIR, "comandas.json");
function lerCache() { try { return JSON.parse(readFileSync(CACHE, "utf8")); } catch { return {}; } }
function salvarCache(c) {
  const lim = Date.now() - 45 * 86400000; // guarda 45 dias
  for (const [k, v] of Object.entries(c)) if (v.lida && v.lida < lim) delete c[k];
  writeFileSync(CACHE, JSON.stringify(c));
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hoje = new Date();
const ini = new Date(hoje); ini.setDate(ini.getDate() - (DIAS - 1));
// "35.00", "35,00" ou "1.234,56" → número
const num = (v) => {
  if (typeof v === "number") return v;
  let s = String(v ?? "").trim(); if (!s) return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s); return Number.isFinite(n) ? n : 0;
};
// "2026-12-21 08:40:00.000000" ou "21/12/2026 08:40" → minutos desde 1970 (hora local, só para diferenças)
const minutos = (s) => {
  let m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000;
  m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]) / 60000 : null;
};
// "21/12/2026 11:40" → "2026-12-21"
const dia = (s) => { const m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

// Sai sempre pelo IPv4 (o IP fixo cadastrado na AppBarber); se a internet tiver IPv6, a AppBarber veria outro endereço.
// GET com os cabeçalhos exatamente como escritos (ex.: "X-API-Key"); o fetch do Node os envia em minúsculas.
const USO = { n: 0, zero: false };
// Ao terminar, informa ao servidor quantas consultas foram feitas (ele soma no contador de créditos do app).
process.on("exit", () => { if (USO.n || USO.zero) console.log(`CREDITOS_USADOS=${USO.n}${USO.zero ? " SEM_SALDO" : ""}`); });
async function getExato(url, headers) {
  const u = new URL(url);
  const mod = await import(u.protocol === "http:" ? "node:http" : "node:https");
  return new Promise((ok, fail) => {
    const req = mod.request(u, { method: "GET", headers, family: 4 }, (res) => {
      let b = ""; res.setEncoding("utf8"); res.on("data", (c) => (b += c));
      res.on("end", () => {
        const r = { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: b };
        // Créditos: cada consulta bem-sucedida à AppBarber gasta 1. "Saldo insuficiente" = créditos acabaram.
        if (url.startsWith(BASE)) { if (r.ok) USO.n++; else if (/saldo insuficiente/i.test(b)) USO.zero = true; }
        ok(r);
      });
    });
    req.on("error", fail); req.setTimeout(60000, () => req.destroy(new Error("a AppBarber não respondeu em 60 segundos.")));
    req.end();
  });
}

// Horário de funcionamento: vem do app (Configurações › Indicadores e metas › Regra da taxa de ocupação).
// Fora dele não chama a AppBarber (cada chamada é cobrada). Depois do fechamento, roda UMA última vez,
// 10 minutos depois (até 40 min depois, conforme o intervalo), para reler as comandas que ficaram abertas.
const FIM_DIA = join(DIR, "fim-do-dia.txt");
let HORARIO = null; // horário de funcionamento lido nesta execução (para a última releitura do dia)
async function dentroDoHorario() {
  let h = null;
  try {
    const r = await fetch(GESTAO_URL, { headers: { Authorization: "Bearer " + cfg.gestao_api_key } });
    if (r.ok) { const j = await r.json(); if (j.abertura && j.fechamento) h = j; }
  } catch { /* sem internet ou servidor fora: usa o padrão */ }
  h = h || { abertura: cfg.abertura || "08:00", fechamento: cfg.fechamento || "22:00" };
  const min = (t) => { const [a, b] = String(t).split(":").map(Number); return (a || 0) * 60 + (b || 0); };
  const agora = new Date(), m = agora.getHours() * 60 + agora.getMinutes();
  // Dia em que a barbearia fecha (ex.: domingo): não consulta a AppBarber, porque cada consulta gasta crédito.
  if (Array.isArray(h.fechados) && h.fechados.includes(agora.getDay())) return { ok: false, fechado: true, ...h };
  const hojeIso = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}`;
  if (m >= min(h.abertura) && m <= min(h.fechamento)) return { ok: true, ...h };
  let feito = ""; try { feito = readFileSync(FIM_DIA, "utf8").trim(); } catch { /* ainda não rodou */ }
  if (m >= min(h.fechamento) + 10 && m <= min(h.fechamento) + 40 && feito !== hojeIso) {
    try { writeFileSync(FIM_DIA, hojeIso); } catch { /* sem disco: roda mesmo assim */ }
    return { ok: true, fimDoDia: true, ...h };
  }
  return { ok: false, ...h };
}

// Atualização automática: no máximo a cada 6 horas, baixa a versão mais nova do site do Gestão Barber IA.
// Só troca o arquivo se a versão for outra e o código novo passar na checagem do Node. Vale a partir da próxima execução.
async function autoAtualizar() {
  if (cfg.auto_atualizar === false || cfg.appbarber_url) return;
  const marca = join(DIR, "atualizacao.txt");
  try { if (Date.now() - Number(readFileSync(marca, "utf8")) < 6 * 3600000) return; } catch { /* primeira vez */ }
  try { writeFileSync(marca, String(Date.now())); } catch { /* opcional */ }
  try {
    const r = await fetch(cfg.atualizar_url || "https://gestaoperformance.vercel.app/integracoes/appbarber/sincronizar.mjs", { cache: "no-store" });
    if (!r.ok) return;
    const novo = await r.text();
    const v = (novo.match(/const VERSAO = "([^"]+)"/) || [])[1];
    if (!v || v === VERSAO || novo.length < 2000) return;
    const tmp = join(DIR, "sincronizar.novo.mjs");
    writeFileSync(tmp, novo);
    if (spawnSync(process.execPath, ["--check", tmp]).status !== 0) return;
    renameSync(tmp, fileURLToPath(import.meta.url));
    log(`Programa atualizado sozinho: versão ${VERSAO} → ${v}.`);
  } catch { /* sem internet: tenta na próxima */ }
}

// Agendamento do Windows: a cada 10 minutos, SEM janela preta, inclusive na bateria e logo que o notebook ligar
// (o padrão do Windows não roda tarefas na bateria). Ajustado sozinho uma vez (chega pela atualização automática).
const TAREFA = "Gestao Barber IA - AppBarber";
function agendar(forcar) {
  if (process.platform !== "win32") return false;
  const ok = join(DIR, "agendamento-v2.ok");
  try { if (!forcar && readFileSync(ok, "utf8")) return true; } catch { /* ainda não ajustado */ }
  const vbs = join(DIR, "oculto.vbs"), bat = join(DIR, "sincronizar.bat"), q = '"';
  writeFileSync(vbs, 'CreateObject("WScript.Shell").Run ' + q + q + q + bat + q + q + q + ', 0, False\r\n');
  const sq = (x) => String(x).replace(/'/g, "''");
  const ps = [
    `$a = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '"${sq(vbs)}"' -WorkingDirectory '${sq(DIR)}'`,
    "$t = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Days 3650)",
    "$l = New-ScheduledTaskTrigger -AtLogOn",
    "$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)",
    `Register-ScheduledTask -TaskName '${TAREFA}' -Action $a -Trigger @($t, $l) -Settings $s -Force | Out-Null`,
  ].join("; ");
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { encoding: "utf8" });
  if (r.status === 0) { try { writeFileSync(ok, new Date().toISOString()); } catch { /* opcional */ } log("Agendamento ajustado: a cada 10 minutos, sem janela e também na bateria."); return true; }
  log("Não consegui ajustar o agendamento do Windows: " + String(r.stderr || r.error || "").trim().slice(0, 200));
  return false;
}

async function main() {
  if (process.argv.includes("--agendar")) { process.exit(agendar(true) ? 0 : 1); }
  agendar(false);
  await autoAtualizar();
  if (!TESTE && !CARGA && !process.argv.includes("--agora")) {
    const h = await dentroDoHorario();
    HORARIO = h;
    if (!h.ok) { console.log(h.fechado ? "Fora do horário de funcionamento: hoje a barbearia fecha (definido no app). Nada foi buscado." : `Fora do horário de funcionamento (${h.abertura} às ${h.fechamento}, definido no app). Nada foi buscado.`); return; }
  }
  const q = new URLSearchParams({ establishment_code: String(cfg.codigo_estabelecimento), start_date: iso(ini), end_date: iso(hoje), status_type: "2" });
  if (cfg.codigo_filial) q.set("branch_code", String(cfg.codigo_filial));
  const url = BASE + "/v1/appointments/history?" + q;
  const HDR = { "X-API-Key": cfg.appbarber_api_key, Accept: "application/json", "User-Agent": "GestaoBarberIA-Sync/" + VERSAO };
  if (process.argv.includes("--diagnostico")) {
    let ip = "?"; try { ip = (await (await fetch("https://api.ipify.org")).text()).trim(); } catch { /* sem IP */ }
    const k = String(cfg.appbarber_api_key);
    console.log(`\n=== Diagnóstico (mande para a AppBarber) ===\nIP público deste computador (IPv4, usado na conexão): ${ip}\nGET ${url}\nX-API-Key: ${k.slice(0, 8)}…${k.slice(-4)}\nAccept: application/json\nUser-Agent: ${HDR["User-Agent"]}\n`);
  }
  const r = await getExato(url, HDR);
  const txt = r.text;
  if (!r.ok && /<html/i.test(txt)) {
    // Página de bloqueio do firewall (Cloudflare) da AppBarber: mostra o motivo e o IP deste computador.
    const tit = (txt.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
    const cod = (txt.match(/Error code:?\s*(\d{3,4})|error code (\d{3,4})|Error (10\d\d)/i) || []).slice(1).find(Boolean) || "";
    const ray = (txt.match(/Ray ID:?\s*(?:<[^>]+>\s*)*([0-9a-f]{12,})/i) || [])[1] || "";
    let ip = "?"; try { ip = (await (await fetch("https://api.ipify.org")).text()).trim(); } catch { /* sem IP */ }
    throw new Error(`a AppBarber bloqueou o acesso no firewall (HTTP ${r.status}${cod ? ", código " + cod : ""}). ${tit.trim()}\n  IP deste computador: ${ip} (precisa ser o IP liberado pela AppBarber).${ray ? "\n  Ray ID: " + ray + " (informe à AppBarber)" : ""}`);
  }
  if (!r.ok) {
    const dica = r.status === 401 || r.status === 403 ? " Confira a chave da AppBarber e se o IP deste computador é o liberado por eles." : r.status === 429 ? " Limite de chamadas atingido; tente mais tarde." : "";
    throw new Error(`AppBarber respondeu ${r.status}.${dica} ${txt.slice(0, 200)}`);
  }
  const lista = ((JSON.parse(txt).data) || []).filter((a) => !a.scheduling_status || /realizad/i.test(a.scheduling_status));

  // ---------- Retenção de clientes antigos e fidelização de clientes novos ----------
  // Histórico de visitas (profissional + código do cliente, sem nome nem telefone) guardado em visitas.json.
  // Cliente antigo: foi à barbearia nos 180 dias antes da visita. Novo: não foi. "Voltou": novo atendimento com o
  // MESMO profissional em até 45 dias. A conta entra no dia em que o prazo fecha (visita + 45 dias).
  const RET_N = Math.min(120, Math.max(15, Number(cfg.retorno_dias) || 45)), RET_LB = 180;
  const somaDias = (d, n) => { const x = new Date(d + "T12:00:00"); x.setDate(x.getDate() + n); return iso(x); };
  const alvoHist = somaDias(iso(hoje), -(RET_LB + RET_N + 35));
  const VIS = join(DIR, "visitas.json");
  let vis = {}; try { vis = JSON.parse(readFileSync(VIS, "utf8")); } catch { /* primeira vez */ }
  vis.v = vis.v || {};
  const { createHash } = await import("node:crypto");
  const idCli = (a) => { const k = String(a.client_phone || "").replace(/\D/g, "") || String(a.person_code || a.client_code || a.client_id || "") || String(a.client_name || "").trim().toLowerCase(); return k ? createHash("sha1").update(k).digest("hex").slice(0, 12) : ""; };
  function guardaVisitas(lst, de, ate) {
    const porDia = {};
    for (const a of lst) { const d = dia(a.scheduling_start), p = String(a.employee_name || "").trim(), c = idCli(a), inv = Number(a.invoice_code) > 0 ? String(a.invoice_code) : ""; if (d && p && c && d >= de && d <= ate) (porDia[d] = porDia[d] || []).push(inv ? [p, c, inv] : [p, c]); }
    for (let d = de; d <= ate; d = somaDias(d, 1)) vis.v[d] = porDia[d] || [];
  }
  guardaVisitas(lista, iso(ini), iso(hoje));
  vis.since = !vis.since || vis.since > iso(ini) ? iso(ini) : vis.since;
  // Carga do histórico antigo: 1 consulta (31 dias) por sincronização, até cobrir ~260 dias. Na --carga, tudo de uma vez.
  for (let volta = 0; !TESTE && vis.since > alvoHist && volta < (CARGA ? 12 : 1); volta++) {
    const ate = somaDias(vis.since, -1), de = somaDias(ate, -30) < alvoHist ? alvoHist : somaDias(ate, -30);
    const qh = new URLSearchParams({ establishment_code: String(cfg.codigo_estabelecimento), start_date: de, end_date: ate, status_type: "2" });
    if (cfg.codigo_filial) qh.set("branch_code", String(cfg.codigo_filial));
    const rh = await getExato(BASE + "/v1/appointments/history?" + qh, HDR).catch(() => null);
    if (!rh || !rh.ok) break;
    let lh = []; try { lh = ((JSON.parse(rh.text).data) || []).filter((a) => !a.scheduling_status || /realizad/i.test(a.scheduling_status)); } catch { break; }
    guardaVisitas(lh, de, ate); vis.since = de;
    if (CARGA) await new Promise((ok) => setTimeout(ok, 2500));
  }
  for (const d of Object.keys(vis.v)) if (d < somaDias(alvoHist, -10)) delete vis.v[d];
  try { writeFileSync(VIS, JSON.stringify(vis)); } catch { /* opcional */ }
  // Por profissional e dia de fechamento: base e quantos voltaram (antigos e novos).
  // Planos mensais: visita cuja comanda é de plano fica marcada (4º campo = 1). Cliente NOVO que fecha plano conta como
  // fidelizado; ASSINANTE que volta todo mês fica fora das duas taxas.
  function retencao(desdeData) {
    for (const l of Object.values(vis.v)) for (const e of l) if (e[2] && !e[3] && cache[e[2]] && cache[e[2]].pl) e[3] = 1;
    try { writeFileSync(VIS, JSON.stringify(vis)); } catch { /* opcional */ }
    const porCli = new Map(), plano = new Map(); // cliente → datas com comanda de plano
    for (const [d, l] of Object.entries(vis.v)) for (const [p, c, , pl] of l) { if (!porCli.has(c)) porCli.set(c, []); porCli.get(c).push([d, p]); if (pl) { if (!plano.has(c)) plano.set(c, []); plano.get(c).push(d); } }
    const out = new Map();
    for (let fecha = desdeData; fecha <= iso(hoje); fecha = somaDias(fecha, 1)) {
      const d0 = somaDias(fecha, -RET_N);
      if (!vis.since || vis.since > somaDias(d0, -RET_LB) || !vis.v[d0]) continue; // sem histórico suficiente
      const vistos = new Set();
      for (const [p, c, , pl] of vis.v[d0]) {
        if (vistos.has(p + "|" + c)) continue; vistos.add(p + "|" + c);
        const hist = porCli.get(c) || [], dPl = plano.get(c) || [];
        const antigo = hist.some(([d]) => d < d0 && d >= somaDias(d0, -RET_LB));
        if (antigo && dPl.some((d) => d >= somaDias(d0, -RET_LB) && d <= fecha)) continue; // assinante: volta por contrato, fica fora
        const voltou = !!pl || hist.some(([d, q]) => q === p && d > d0 && d <= fecha); // novo que fechou plano = fidelizado
        const k = (NOMES[p] || p) + "|" + fecha, o = out.get(k) || { aB: 0, aV: 0, nB: 0, nV: 0 };
        if (antigo) { o.aB++; if (voltou) o.aV++; } else { o.nB++; if (voltou) o.nV++; }
        out.set(k, o);
      }
    }
    return out;
  }
  function comRetencao(itens) {
    const ret = retencao(desde), porChave = new Map(itens.map((i) => [i.barbeiro + "|" + i.data, i]));
    for (const [k, o] of ret) {
      const [b, d] = k.split("|"); let i = porChave.get(k);
      if (!i) { i = { data: d, barbeiro: b }; itens.push(i); porChave.set(k, i); }
      Object.assign(i, { retorno_antigos_base: o.aB, retorno_antigos_voltaram: o.aV, retorno_novos_base: o.nB, retorno_novos_voltaram: o.nV });
    }
    return itens;
  }

  // Horas atendidas no dia: junta os horários que se sobrepõem (não conta duas vezes o mesmo tempo).
  function horasJuntas(lst) {
    const a = lst.slice().sort((p, q) => p[0] - q[0]); let tot = 0, [s0, e0] = a[0];
    for (const [s1, e1] of a.slice(1)) { if (s1 <= e0) e0 = Math.max(e0, e1); else { tot += e0 - s0; s0 = s1; e0 = e1; } }
    return Math.round((tot + e0 - s0) / 60 * 100) / 100;
  }
  // Nome do serviço (para o indicador Serviços extras): da comanda ou, se não vier, do agendamento.
  function nomeDeServico(o) {
    if (!o) return "";
    for (const k of ["service_description", "service_name", "service", "item_description", "description", "name"]) { const v = o[k]; if (typeof v === "string" && v.trim()) return v.trim().slice(0, 80); }
    for (const [k, v] of Object.entries(o)) if (/serv/i.test(k) && /(desc|name|nome)/i.test(k) && typeof v === "string" && v.trim()) return v.trim().slice(0, 80);
    return "";
  }
  function calc() {
    // Soma por profissional e dia SÓ com comandas finalizadas (pagas, ou de um dia que já passou), como na AppBarber.
    // Sem valor provisório: atendimento com comanda aberta ou ainda não lida entra quando a comanda for finalizada e lida.
    const acc = new Map();
    const agNome = new Map(lista.map((a) => [String(a.appointment_code || a.scheduling_code), nomeDeServico(a)]));
    const add = (nome, d) => { const k = nome + "|" + d; if (!acc.has(k)) acc.set(k, { nome, d, fat: 0, serv: 0, prod: 0, sv: 0, pv: 0, svc: {}, cli: new Set(), com: new Map(), int: [] }); return acc.get(k); };
    const usadas = new Set();
    // A AppBarber pode escrever o nome do profissional diferente na agenda e na comanda
    // (ex.: "Izaque Macedo" x "Izaquias Macedo"). Liga os dois pelo agendamento da comanda e usa o nome da agenda.
    const nomeAg = new Map(lista.map((a) => [String(a.appointment_code || a.scheduling_code), String(a.employee_name || "").trim()]));
    const porComanda = new Map();
    for (const a of lista) { const k = String(a.invoice_code || ""); if (!k) continue; if (!porComanda.has(k)) porComanda.set(k, new Set()); porComanda.get(k).add(String(a.employee_name || "").trim()); }
    const alias = new Map();
    for (const c of codigos) {
      const inv = cache[c]; if (!inv || !inv.itens) continue;
      for (const it of inv.itens) if (it.ag && nomeAg.get(it.ag) && it.p) alias.set(it.p, nomeAg.get(it.ag));
      const pa = [...new Set(inv.itens.map((it) => it.p).filter(Boolean))], ag = [...(porComanda.get(c) || [])];
      if (pa.length === 1 && ag.length === 1 && !alias.has(pa[0])) alias.set(pa[0], ag[0]);
    }
    const nomeAgenda = new Set(lista.map((a) => String(a.employee_name || "").trim()));
    const nomeDe = (p) => (nomeAgenda.has(p) ? p : alias.get(p) || p);
    for (const c of codigos) {
      const inv = cache[c]; if (!inv || !inv.itens || !inv.final) continue;
      usadas.add(c);
      const d = inv.d || dia((lista.find((a) => String(a.invoice_code) === c) || {}).scheduling_start);
      if (!d || d < iso(ini)) continue;
      for (const it of inv.itens) {
        if (!it.p) continue;
        if (it.prod && consumo(it)) continue; // geladeira/bar: não é faturamento do profissional
        const x = add(nomeDe(it.p), d);
        x.fat += it.v; if (it.pl) { /* plano mensal: entra no faturamento, mas não como produto nem serviço */ } else if (it.prod) { x.prod += it.q; x.pv += it.v; } else { x.serv += it.q; x.sv += it.v; const n = it.sn || agNome.get(it.ag) || (it.sc ? "Serviço " + it.sc : "Serviço sem nome"); const a = x.svc[n] || (x.svc[n] = [0, 0]); a[0] += it.q; a[1] += it.v; }
        if (!it.prod && it.ini != null && it.fim > it.ini && it.fim - it.ini <= 600) x.int.push([it.ini, it.fim]);
        x.cli.add(inv.cli); if (!inv.pl && inv.pago) x.com.set(c, (x.com.get(c) || 0) + it.v); // maior comanda: só paga e sem plano
      }
    }
    // Profissional com atendimento no dia mas sem comanda finalizada ainda: envia zero, para não ficar um valor antigo.
    for (const a of lista) {
      const d = dia(a.scheduling_start); const nome = String(a.employee_name || "").trim();
      if (d && nome) add(nomeDe(nome), d);
    }
    // Só os dias do mês atual (nos 3 primeiros dias, também o anterior): os meses passados ficam como estão.
    return [...acc.values()].filter((x) => x.d >= desde).map((x) => ({
      data: x.d, barbeiro: NOMES[x.nome] || x.nome,
      faturamento: Math.round(x.fat * 100) / 100, servicos: x.serv, clientes: x.cli.size, venda_produtos: x.prod,
      valor_servicos: Math.round(x.sv * 100) / 100, valor_produtos: Math.round(x.pv * 100) / 100,
      servicos_detalhe: Object.fromEntries(Object.entries(x.svc).map(([n, a]) => [n, [a[0], Math.round(a[1] * 100) / 100]])),
      maior_comanda: Math.round(Math.max(0, ...x.com.values()) * 100) / 100,
      ...(x.int.length ? { horas_ocupadas: horasJuntas(x.int) } : {}),
    }));
  }
  // Diagnóstico (testar.bat): mostra os campos que a AppBarber manda num produto vendido de comanda finalizada e
  // no catálogo de produtos, para saber se ela informa a comissão de cada produto. Não mostra dados de clientes.
  async function camposComissao() {
    const COM = /comis|commission|percent|perc|rate|comm/i;
    const SENS = /client|person|customer|phone|fone|cpf|email|mail|document|doc|birth|nasc|address|endere/i;
    const mostra = (o) => Object.entries(o || {}).map(([k, v]) => {
      const val = SENS.test(k) ? "(oculto)" : v === null || v === undefined ? "vazio" : typeof v === "object" ? "{…}" : String(v).slice(0, 40);
      return `${COM.test(k) ? "  >>> " : "      "}${k}: ${val}`;
    }).join("\n");
    console.log("\n=== Diagnóstico de comissão de produtos (mande um print desta parte) ===");
    const alvo = [...codigos].reverse().find((c) => cache[c] && cache[c].final && cache[c].pago && (cache[c].itens || []).some((it) => it.prod && !consumo(it) && !it.pl));
    if (!alvo) console.log("  Nenhuma comanda finalizada com produto encontrada nos últimos dias.");
    else {
      const rr = await getExato(`${BASE}/v1/invoice/${encodeURIComponent(alvo)}?establishment_code=${encodeURIComponent(cfg.codigo_estabelecimento)}`, HDR).catch((e) => ({ ok: false, status: 0, text: e.message }));
      if (!rr.ok) console.log(`  Não consegui ler a comanda ${alvo} (AppBarber respondeu ${rr.status}).`);
      else {
        const inv = (JSON.parse(rr.text).data) || {};
        const item = (inv.items || []).find((it) => it.product_code && !it.service_code) || (inv.items || [])[0];
        console.log(`  Comanda nº ${alvo} · campos da comanda:\n${mostra(Object.fromEntries(Object.entries(inv).filter(([k]) => k !== "items")))}`);
        console.log(`  Campos do PRODUTO vendido nessa comanda:\n${mostra(item)}`);
      }
    }
    const rp = await getExato(`${BASE}/v1/products?establishment_code=${encodeURIComponent(cfg.codigo_estabelecimento)}`, HDR).catch(() => null);
    if (rp && rp.ok) {
      const lst = (JSON.parse(rp.text).data) || [];
      const p = lst.find((x) => Object.keys(x).some((k) => COM.test(k))) || lst[0];
      console.log(p ? `  Campos de um produto do CATÁLOGO:\n${mostra(p)}` : "  Catálogo de produtos vazio.");
    } else console.log("  Não consegui ler o catálogo de produtos.");
    console.log('  Linhas marcadas com ">>>" parecem ser de comissão.\n');
  }
  async function enviar(silencioso) {
    const itens = comRetencao(calc());
    if (!itens.length) { if (!silencioso) log("Nada para enviar."); return; }
    const g = await fetch(GESTAO_URL, { method: "POST", headers: { Authorization: "Bearer " + cfg.gestao_api_key, "Content-Type": "application/json" }, body: JSON.stringify(itens) });
    const res = await g.json().catch(() => ({}));
    if (!g.ok && !res.recebidos) throw new Error(`Gestão Barber IA respondeu ${g.status}: ${res.erro || JSON.stringify(res).slice(0, 200)}`);
    if (!silencioso) log(`Gestão Barber IA: ${res.recebidos} lançamentos gravados.`);
    if (!silencioso && res.problemas?.length) {
      const nomes = [...new Set(res.problemas.map((p) => (p.match(/barbeiro "([^"]*)"/) || [])[1]).filter(Boolean))];
      if (nomes.length) log(`ATENÇÃO: profissionais da AppBarber sem cadastro igual no Gestão: ${nomes.join(", ")}. Ajuste em "nomes" no config.json.`);
      else log("Problemas: " + res.problemas.slice(0, 5).join(" | "));
    }
  }

  // Comandas: cada uma é lida UMA vez (1 chamada) e guardada em comandas.json. Elas têm os itens com o profissional,
  // o valor final (preço ajustado no caixa), serviços extras e produtos — o mesmo "Total realizado/vendido" da AppBarber.
  const cache = lerCache();

  // Produtos: só contam no faturamento do profissional os produtos de salão/barbearia (pomada, shampoo, óleo…).
  // Consumo de geladeira e bar (bebidas, comidas, doces) finalizado na comanda NÃO conta.
  // A categoria vem do catálogo de produtos da AppBarber (1 chamada por dia, guardada em produtos.json).
  const CAT = join(DIR, "produtos.json");
  let cat = {}; try { cat = JSON.parse(readFileSync(CAT, "utf8")); } catch { /* primeira vez */ }
  if (!TESTE && (!cat.lido || Date.now() - cat.lido > 86400000)) {
    const rp = await getExato(`${BASE}/v1/products?establishment_code=${encodeURIComponent(cfg.codigo_estabelecimento)}`, HDR).catch(() => null);
    if (rp && rp.ok) {
      const itens = (JSON.parse(rp.text).data) || [];
      cat = { lido: Date.now(), p: Object.fromEntries(itens.filter((x) => x.item_code).map((x) => [String(x.item_code), { c: String(x.category_code ?? ""), n: String(x.item_description || "").slice(0, 60) }])) };
      try { writeFileSync(CAT, JSON.stringify(cat)); } catch { /* opcional */ }
    }
  }
  const BAR = /\b(cerveja|chopp?|heineken|brahma|skol|budweiser|stella|corona|amstel|spaten|itaipava|antarctica|devassa|eisenbahn|long ?neck|lata|refri|refrigerante|coca|pepsi|guaran[aá]|fanta|sprite|soda|t[oô]nica|[aá]gua mineral|[aá]gua com g[aá]s|[aá]gua sem g[aá]s|suco|ch[aá] |energ[eé]tico|red ?bull|monster|gatorade|isot[oô]nico|whisk(e)?y|vodka|gin|rum|cacha[cç]a|tequila|dose|drink|caipirinha|vinho|espumante|caf[eé]|capuccino|cappuccino|achocolatado|salgad|salgadinho|chips|amendoim|bala|chiclete|chocolate|bombom|barra de cereal|biscoito|bolacha|lanche|sandu[ií]che|pastel|cigarro|gelo)\b/i;
  const nomeProd = (it) => (it.pc && cat.p && cat.p[it.pc] && cat.p[it.pc].n) || it.nm || "";
  // Categoria é "consumo" quando a maioria dos produtos dela tem nome de bebida/comida.
  const catConsumo = {};
  for (const x of Object.values(cat.p || {})) { const k = x.c; if (!k) continue; const o = catConsumo[k] || (catConsumo[k] = { bar: 0, tot: 0, ex: [] }); o.tot++; if (BAR.test(x.n)) o.bar++; if (o.ex.length < 3) o.ex.push(x.n); }
  const incluir = new Set((cfg.categorias_salao || []).map(String)), excluir = new Set((cfg.categorias_consumo || []).map(String));
  const consumo = (it) => {
    const c = it.pc && cat.p && cat.p[it.pc] ? cat.p[it.pc].c : "";
    if (c && incluir.has(c)) return false;
    if (c && excluir.has(c)) return true;
    if (c && catConsumo[c] && catConsumo[c].bar * 2 >= catConsumo[c].tot) return true;
    return BAR.test(nomeProd(it));
  };
  // Comanda de plano mensal (venda do plano ou atendimento pago pelo plano): NÃO conta como maior comanda.
  // Reconhece pelo nome dos itens, pelo pagamento ou por campos de plano/assinatura da AppBarber.
  // Para um plano com outro nome, use no config.json: "planos_codigos": ["código do produto ou serviço"].
  const PLANO = /\b(planos?|assinatura|assinante|clube|mensalidade|recorr[eê]ncia)\b/i;
  const codPlano = new Set((cfg.planos_codigos || []).map(String));
  const vivo = (v) => v !== null && v !== undefined && v !== "" && v !== 0 && v !== "0" && v !== false;
  // Item que é a venda do plano (ou pago pelo plano): não conta como produto vendido.
  function itemPlano(it) {
    if (codPlano.has(String(it.product_code ?? "")) || codPlano.has(String(it.service_code ?? ""))) return true;
    const nome = [it.product_description, it.service_description, it.item_description, it.description, it.service_name, it.product_name, it.product_code && cat.p && cat.p[String(it.product_code)] && cat.p[String(it.product_code)].n].filter(Boolean).join(" ");
    if (PLANO.test(nome)) return true;
    for (const [k, v] of Object.entries(it)) if (/plan|signature|subscri|assinat/i.test(k) && vivo(v)) return true;
    return false;
  }
  function ehPlano(inv) {
    if ((inv.items || []).some(itemPlano)) return true;
    for (const [k, v] of Object.entries(inv)) {
      if (k === "items") continue;
      if (/plan|signature|subscri|assinat/i.test(k) && vivo(v)) return true;
      if (/payment|pagamento/i.test(k) && typeof v === "string" && PLANO.test(v)) return true;
    }
    return false;
  }
  const codigos = [...new Set(lista.map((a) => a.invoice_code).filter((c) => c && Number(c) > 0).map(String))];
  // Comanda ainda não paga é relida a cada 20 minutos (e depois que o dia vira, uma última vez).
  // Comanda ainda aberta: relida a cada 45 min (cada leitura gasta crédito). Na última execução do dia,
  // 10 min depois do fechamento, todas as abertas são relidas, para o dia terminar com tudo atualizado.
  // Comanda nova entra na primeira execução depois do atendimento.
  const releAberta = HORARIO && HORARIO.fimDoDia ? 0 : 45 * 60000;
  let faltam = codigos.filter((c) => !cache[c] || (cache[c].itens && (cache[c].h || 0) < 3) || (cache[c].final && !cache[c].pago && Date.now() - (cache[c].lida || 0) > 6 * 3600000) || (!cache[c].final && (Date.now() - (cache[c].lida || 0) > releAberta || (cache[c].d && cache[c].d < iso(hoje)))));
  // Só lê as comandas do mês atual (o ranking é por mês). Nos 3 primeiros dias, também as do mês anterior,
  // para o fechamento sair com as comandas finais. Os meses anteriores não são reenviados.
  const diaDe = new Map(lista.map((a) => [String(a.invoice_code), dia(a.scheduling_start) || ""]));
  const desde = iso(new Date(hoje.getFullYear(), hoje.getMonth() - (hoje.getDate() <= 3 ? 1 : 0), 1));
  for (let i = faltam.length - 1; i >= 0; i--) if ((diaDe.get(faltam[i]) || "") < desde) faltam.splice(i, 1);
  // Mais novas primeiro.
  faltam.sort((a, b) => (diaDe.get(b) || "").localeCompare(diaDe.get(a) || ""));
  // Durante a carga inicial, as sincronizações agendadas não leem comandas (para não passar do limite da AppBarber).
  const LOCK = join(DIR, "carga.lock");
  let cargaRodando = false; try { cargaRodando = !CARGA && Date.now() - Number(readFileSync(LOCK, "utf8")) < 5 * 60000; } catch { /* sem carga */ }
  const MAX = TESTE || cargaRodando ? 0 : CARGA ? Infinity : Math.max(0, Number(cfg.max_comandas_por_vez ?? 120));
  // Limites da AppBarber: 30/min por IP e 1.000/hora por chave. Carga: ~16/min (cabe nas 1.000/hora).
  const PAUSA = Number(cfg.pausa_ms) || (CARGA ? 3700 : 2100);
  if (CARGA) log(`Carga inicial: ${faltam.length} comandas para ler (cerca de ${Math.ceil(faltam.length * PAUSA / 60000)} minutos). Pode deixar a janela aberta; os números vão sendo atualizados no app.`);
  let lidas = 0, parou = "";
  for (const c of faltam.slice(0, MAX)) {
    if (CARGA) { try { writeFileSync(LOCK, String(Date.now())); } catch { /* opcional */ } }
    const rr = await getExato(`${BASE}/v1/invoice/${encodeURIComponent(c)}?establishment_code=${encodeURIComponent(cfg.codigo_estabelecimento)}`, HDR).catch((e) => ({ ok: false, status: 0, text: e.message }));
    if (rr.status === 429) { parou = "limite de chamadas da AppBarber"; break; }
    if (rr.status === 404) { cache[c] = { final: true, itens: [], d: null }; continue; }
    if (!rr.ok) { parou = `AppBarber respondeu ${rr.status} ao ler a comanda ${c}`; break; }
    const inv = (JSON.parse(rr.text).data) || {};
    const d = dia(inv.invoice_date) || null;
    const pago = num(inv.invoice_payed_value) > 0 || !!inv.payment_type_code;
    const antiga = d && d < iso(hoje);
    const itensV = (inv.items || []).filter((it) => Number(it.product_is_tip) !== 1 && Number(it.product_is_cashback) !== 1);
    cache[c] = {
      d, cli: String(inv.person_code || inv.person_name || c), final: pago || !!antiga, pago: pago || undefined, lida: Date.now(), h: 3, pl: ehPlano(inv) || undefined,
      itens: itensV.map((it) => ({ pl: itemPlano(it) || undefined,
        p: String(it.employee_name || "").trim(), ag: it.scheduling_code ? String(it.scheduling_code) : undefined, ini: minutos(it.scheduling_start) ?? undefined, fim: minutos(it.scheduling_end) ?? undefined, v: num(it.item_value), q: Number(it.item_quantity) || 1, prod: !!it.product_code && !it.service_code, pc: it.product_code ? String(it.product_code) : undefined, nm: it.product_description ? String(it.product_description).slice(0, 60) : undefined, sc: it.service_code ? String(it.service_code) : undefined, sn: !it.product_code && it.service_code ? nomeDeServico(it) || undefined : undefined,
      })),
    };
    lidas++;
    if (!CARGA && process.stdout.isTTY && lidas % 20 === 0) console.log(`  … ${lidas} comandas lidas`);
    if (CARGA && lidas % 100 === 0) {
      salvarCache(cache); await enviar(true);
      log(`Carga inicial: ${lidas} de ${faltam.length} comandas lidas.`);
    }
    await new Promise((ok) => setTimeout(ok, PAUSA));
  }
  if (CARGA) { try { writeFileSync(LOCK, "0"); } catch { /* opcional */ } }
  if (lidas) salvarCache(cache);
  // Pedido de feedback (WhatsApp): comanda PAGA hoje de cliente NOVO (sem visita nos 180 dias anteriores) entra na fila,
  // que o serviço de WhatsApp lê. Fica só neste servidor, com o primeiro nome e o telefone, e sai em 2 dias.
  if (cfg.feedback && !TESTE) {
    const FILA = join(DIR, "feedback-fila.json"), hj = iso(hoje), desde = somaDias(hj, -RET_LB);
    let fila = { itens: [], vistos: [] }; try { fila = JSON.parse(readFileSync(FILA, "utf8")); } catch { /* primeira vez */ }
    fila.itens = (fila.itens || []).filter((x) => Date.now() - x.em < 2 * 86400000); fila.vistos = (fila.vistos || []).slice(-2000);
    const historico = vis.since && vis.since <= desde; // sem 180 dias de histórico não dá para saber quem é novo
    let novos = 0;
    for (const a of historico ? lista : []) {
      const inv = Number(a.invoice_code) > 0 ? String(a.invoice_code) : "", c = idCli(a), fone = String(a.client_phone || "").replace(/\D/g, "");
      if (!inv || dia(a.scheduling_start) !== hj || !cache[inv] || !cache[inv].pago || cache[inv].pl || fila.vistos.includes(inv) || fone.length < 10 || !c) continue;
      fila.vistos.push(inv);
      const jaVeio = Object.entries(vis.v).some(([d, l]) => d < hj && d >= desde && l.some((e) => e[1] === c));
      if (jaVeio) continue;
      const prim = (n) => { const w = String(n || "").trim().split(/\s+/)[0] || ""; return w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""; };
      fila.itens.push({ cod: inv, fone, nome: prim(a.client_name), prof: prim(NOMES[String(a.employee_name || "").trim()] || a.employee_name), em: Date.now(), dia: hj });
      novos++;
    }
    try { writeFileSync(FILA, JSON.stringify(fila), { mode: 0o600 }); } catch { /* opcional */ }
    if (novos) log(`Feedback: ${novos} cliente(s) novo(s) com comanda paga entraram na fila do WhatsApp.`);
  }
  const pend = faltam.length - lidas;
  if (lidas || pend) log(`Comandas: ${lidas} lidas agora${pend > 0 ? `, ${pend} ficam para as próximas sincronizações` : ""}${parou ? ` (parou: ${parou})` : ""}.`);

  const itens = comRetencao(calc());
  log(`AppBarber: ${lista.length} atendimentos realizados de ${iso(ini)} a ${iso(hoje)} → ${itens.length} dias de profissionais.`);
  if (TESTE) {
    const tot = new Map();
    for (const i of itens) { const t = tot.get(i.barbeiro) || { fat: 0, serv: 0, prod: 0, h: 0, dias: 0 }; t.fat += i.faturamento; t.serv += i.servicos; t.prod += i.venda_produtos; t.h += i.horas_ocupadas || 0; t.dias++; tot.set(i.barbeiro, t); }
    for (const [n, t] of tot) console.log(`  ${n}: R$ ${t.fat.toFixed(2)} · ${t.serv} serviços · ${t.prod} produtos · ${t.h.toFixed(1)} h atendidas · ${t.dias} dias`);
    { const rt = new Map(); for (const i of itens) if (i.retorno_antigos_base != null) { const t = rt.get(i.barbeiro) || [0, 0, 0, 0]; t[0] += i.retorno_antigos_base; t[1] += i.retorno_antigos_voltaram; t[2] += i.retorno_novos_base; t[3] += i.retorno_novos_voltaram; rt.set(i.barbeiro, t); }
      const pc = (v, b) => (b ? Math.round(v / b * 100) + "%" : "—");
      console.log(`  Histórico de visitas desde ${vis.since || "—"} (precisa ir até ${alvoHist}; completa sozinho, 1 consulta por sincronização).`);
      if (rt.size) for (const [n, t] of rt) console.log(`   - ${n}: retenção de antigos ${pc(t[1], t[0])} (${t[1]}/${t[0]}) · fidelização de novos ${pc(t[3], t[2])} (${t[3]}/${t[2]})`);
      else console.log("   Retenção/fidelização: ainda sem histórico suficiente (precisa de ~8 meses de visitas)."); }
    { const ab = codigos.filter((c) => cache[c] && cache[c].itens && !cache[c].final).length;
      if (faltam.length || ab) console.log(`  (Ainda não contam: ${faltam.length} comandas não lidas e ${ab} abertas/não pagas. Entram quando forem finalizadas e lidas.)`); }
    { const pls = codigos.filter((c) => cache[c] && cache[c].pl && cache[c].d && cache[c].d >= desde);
      console.log(pls.length ? `  Comandas de plano mensal (fora da maior comanda): ${pls.length} · ex.: ${pls.slice(0, 5).map((c) => `nº ${c} R$ ${(cache[c].itens || []).reduce((a, it) => a + it.v, 0).toFixed(2)}`).join(", ")}` : "  Nenhuma comanda de plano mensal reconhecida neste mês. Se houver, informe os códigos em \"planos_codigos\" no config.json."); }
    { const nomes = new Map(); for (const i of itens) for (const [n, a] of Object.entries(i.servicos_detalhe || {})) nomes.set(n, (nomes.get(n) || 0) + a[0]);
      console.log(nomes.size ? `  Serviços encontrados (marque os tradicionais no app, em Indicadores e metas › Serviços extras): ${[...nomes].sort((a, b) => b[1] - a[1]).map(([n, q]) => `${n} (${q})`).join(", ")}` : "  Nenhum serviço com nome encontrado."); }
    // Conferência com o "Total realizado/vendido" da AppBarber (só comandas já lidas, do mês atual):
    // se o total deles bater com Serviços + Produtos + Consumo, a AppBarber conta o consumo; se bater com Serviços + Produtos, ela já separa.
    {
      const mes = iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), soma = new Map();
      let lidasMes = 0;
      for (const c of codigos) {
        const inv = cache[c]; if (!inv || !inv.itens || !inv.final || !inv.d || inv.d < mes) continue; lidasMes++;
        for (const it of inv.itens) {
          if (!it.p) continue;
          const nome = NOMES[it.p] || it.p, t = soma.get(nome) || { serv: 0, prod: 0, cons: 0, pl: 0 };
          if (it.pl) t.pl += it.v; else if (!it.prod) t.serv += it.v; else if (consumo(it)) t.cons += it.v; else t.prod += it.v;
          soma.set(nome, t);
        }
      }
      if (soma.size) {
        const R$ = (v) => "R$ " + v.toFixed(2).replace(".", ",");
        console.log(`\n  Conferência do mês (${lidasMes} comandas lidas; compare com o Dashboard Profissional da AppBarber):`);
        for (const [n, t] of [...soma].sort((a, b) => b[1].serv + b[1].prod - (a[1].serv + a[1].prod))) {
          console.log(`   - ${n}: serviços ${R$(t.serv)} + produtos ${R$(t.prod)}${t.pl ? ` + planos ${R$(t.pl)}` : ""} = ${R$(t.serv + t.prod + t.pl)} | consumo geladeira ${R$(t.cons)} | com consumo ${R$(t.serv + t.prod + t.pl + t.cons)}`);
        }
      }
    }
    const cats = Object.entries(catConsumo);
    if (cats.length) {
      console.log("  Categorias de produto (consumo de geladeira/bar NÃO conta no faturamento do profissional):");
      for (const [k, o] of cats) { const sim = excluir.has(k) || (!incluir.has(k) && o.bar * 2 >= o.tot); console.log(`   - categoria ${k}: ${sim ? "CONSUMO (não conta)" : "salão (conta)"} · ex.: ${o.ex.join(", ")}`); }
      console.log('  Para corrigir uma categoria, use no config.json: "categorias_salao": ["código"] ou "categorias_consumo": ["código"].');
    }
    await camposComissao();
    log("Modo teste: nada foi enviado.");
    return;
  }
  await enviar();
}
main().catch((e) => { log("ERRO: " + e.message); process.exit(1); });
