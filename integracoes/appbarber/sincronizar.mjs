// Gestão Barber IA — sincronização com a AppBarber.
// Roda no computador da barbearia (o IP dele é o liberado na AppBarber).
// Busca os atendimentos REALIZADOS dos últimos 31 dias (1 chamada à AppBarber)
// e envia o total de cada profissional por dia para o Gestão Barber IA.
// Uso:  node sincronizar.mjs          (envia)
//       node sincronizar.mjs --teste  (só mostra os números, não envia)
// Precisa do Node.js 18 ou mais novo. Configuração em config.json (veja config.exemplo.json).
import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const TESTE = process.argv.includes("--teste");
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
// "21/12/2026 11:40" → "2026-12-21"
const dia = (s) => { const m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

// Sai sempre pelo IPv4 (o IP fixo cadastrado na AppBarber); se a internet tiver IPv6, a AppBarber veria outro endereço.
// GET com os cabeçalhos exatamente como escritos (ex.: "X-API-Key"); o fetch do Node os envia em minúsculas.
async function getExato(url, headers) {
  const u = new URL(url);
  const mod = await import(u.protocol === "http:" ? "node:http" : "node:https");
  return new Promise((ok, fail) => {
    const req = mod.request(u, { method: "GET", headers, family: 4 }, (res) => {
      let b = ""; res.setEncoding("utf8"); res.on("data", (c) => (b += c));
      res.on("end", () => ok({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: b }));
    });
    req.on("error", fail); req.setTimeout(60000, () => req.destroy(new Error("a AppBarber não respondeu em 60 segundos.")));
    req.end();
  });
}

// Horário de funcionamento: vem do app (Configurações › Indicadores e metas › Regra da taxa de ocupação).
// Fora dele não chama a AppBarber (cada chamada é cobrada). Inclui 10 min depois do fechamento para pegar o fim do dia.
async function dentroDoHorario() {
  let h = null;
  try {
    const r = await fetch(GESTAO_URL, { headers: { Authorization: "Bearer " + cfg.gestao_api_key } });
    if (r.ok) { const j = await r.json(); if (j.abertura && j.fechamento) h = j; }
  } catch { /* sem internet ou servidor fora: usa o padrão */ }
  h = h || { abertura: cfg.abertura || "08:00", fechamento: cfg.fechamento || "22:00" };
  const min = (t) => { const [a, b] = String(t).split(":").map(Number); return (a || 0) * 60 + (b || 0); };
  const agora = new Date(), m = agora.getHours() * 60 + agora.getMinutes();
  return { ok: m >= min(h.abertura) && m <= min(h.fechamento) + 10, ...h };
}

async function main() {
  if (!TESTE && !process.argv.includes("--agora")) {
    const h = await dentroDoHorario();
    if (!h.ok) { console.log(`Fora do horário de funcionamento (${h.abertura} às ${h.fechamento}, definido no app). Nada foi buscado.`); return; }
  }
  const q = new URLSearchParams({ establishment_code: String(cfg.codigo_estabelecimento), start_date: iso(ini), end_date: iso(hoje), status_type: "2" });
  if (cfg.codigo_filial) q.set("branch_code", String(cfg.codigo_filial));
  const url = BASE + "/v1/appointments/history?" + q;
  const HDR = { "X-API-Key": cfg.appbarber_api_key, Accept: "application/json", "User-Agent": "GestaoBarberIA-Sync/1.4" };
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

  // Comandas: cada uma é lida UMA vez (1 chamada) e guardada em comandas.json. Elas têm os itens com o profissional,
  // o valor final (preço ajustado no caixa), serviços extras e produtos — o mesmo "Total realizado/vendido" da AppBarber.
  const cache = lerCache();
  const codigos = [...new Set(lista.map((a) => a.invoice_code).filter((c) => c && Number(c) > 0).map(String))];
  // Comanda ainda não paga é relida no máximo 1 vez por hora (e depois que o dia vira, uma última vez).
  const faltam = codigos.filter((c) => !cache[c] || (!cache[c].final && (Date.now() - (cache[c].lida || 0) > 3600000 || (cache[c].d && cache[c].d < iso(hoje)))));
  const MAX = TESTE ? 0 : Math.max(0, Number(cfg.max_comandas_por_vez ?? 120));
  let lidas = 0, parou = "";
  for (const c of faltam.slice(0, MAX)) {
    const rr = await getExato(`${BASE}/v1/invoice/${encodeURIComponent(c)}?establishment_code=${encodeURIComponent(cfg.codigo_estabelecimento)}`, HDR).catch((e) => ({ ok: false, status: 0, text: e.message }));
    if (rr.status === 429) { parou = "limite de chamadas da AppBarber"; break; }
    if (rr.status === 404) { cache[c] = { final: true, itens: [], d: null }; continue; }
    if (!rr.ok) { parou = `AppBarber respondeu ${rr.status} ao ler a comanda ${c}`; break; }
    const inv = (JSON.parse(rr.text).data) || {};
    const d = dia(inv.invoice_date) || null;
    const pago = num(inv.invoice_payed_value) > 0 || !!inv.payment_type_code;
    const antiga = d && d < iso(hoje);
    cache[c] = {
      d, cli: String(inv.person_code || inv.person_name || c), final: pago || !!antiga, lida: Date.now(),
      itens: (inv.items || []).filter((it) => Number(it.product_is_tip) !== 1 && Number(it.product_is_cashback) !== 1).map((it) => ({
        p: String(it.employee_name || "").trim(), v: num(it.item_value), q: Number(it.item_quantity) || 1, prod: !!it.product_code && !it.service_code,
      })),
    };
    lidas++;
    await new Promise((ok) => setTimeout(ok, 2100)); // ~28 por minuto: abaixo do limite de 30/min da AppBarber
  }
  if (lidas) salvarCache(cache);
  const pend = faltam.length - lidas;
  if (lidas || pend) log(`Comandas: ${lidas} lidas agora${pend > 0 ? `, ${pend} ficam para as próximas sincronizações` : ""}${parou ? ` (parou: ${parou})` : ""}.`);

  // Soma por profissional e dia. Comanda já lida: itens da comanda. Ainda não lida: valor do agendamento (provisório).
  const acc = new Map();
  const add = (nome, d) => { const k = nome + "|" + d; if (!acc.has(k)) acc.set(k, { nome, d, fat: 0, serv: 0, prod: 0, cli: new Set(), com: new Map() }); return acc.get(k); };
  const usadas = new Set();
  for (const c of codigos) {
    const inv = cache[c]; if (!inv || !inv.itens) continue;
    usadas.add(c);
    const d = inv.d || dia((lista.find((a) => String(a.invoice_code) === c) || {}).scheduling_start);
    if (!d || d < iso(ini)) continue;
    for (const it of inv.itens) {
      if (!it.p) continue;
      const x = add(it.p, d);
      x.fat += it.v; if (it.prod) x.prod += it.q; else x.serv += it.q;
      x.cli.add(inv.cli); x.com.set(c, (x.com.get(c) || 0) + it.v);
    }
  }
  for (const a of lista) {
    if (a.invoice_code && usadas.has(String(a.invoice_code))) continue;
    const d = dia(a.scheduling_start); const nome = String(a.employee_name || "").trim();
    if (!d || !nome) continue;
    const x = add(nome, d), v = num(a.service_value);
    x.fat += v; x.serv += 1;
    x.cli.add(String(a.client_phone || a.client_name || a.appointment_code).replace(/\D/g, "") || String(a.client_name));
    const c = a.invoice_code || a.appointment_code; x.com.set(c, (x.com.get(c) || 0) + v);
  }
  const itens = [...acc.values()].map((x) => ({
    data: x.d, barbeiro: NOMES[x.nome] || x.nome,
    faturamento: Math.round(x.fat * 100) / 100, servicos: x.serv, clientes: x.cli.size, venda_produtos: x.prod,
    maior_comanda: Math.round(Math.max(0, ...x.com.values()) * 100) / 100,
  }));
  log(`AppBarber: ${lista.length} atendimentos realizados de ${iso(ini)} a ${iso(hoje)} → ${itens.length} dias de profissionais.`);
  if (TESTE) {
    const tot = new Map();
    for (const i of itens) { const t = tot.get(i.barbeiro) || { fat: 0, serv: 0, prod: 0, dias: 0 }; t.fat += i.faturamento; t.serv += i.servicos; t.prod += i.venda_produtos; t.dias++; tot.set(i.barbeiro, t); }
    for (const [n, t] of tot) console.log(`  ${n}: R$ ${t.fat.toFixed(2)} · ${t.serv} serviços · ${t.prod} produtos · ${t.dias} dias`);
    if (faltam.length) console.log(`  (${faltam.length} comandas ainda não lidas: nelas vale o valor do agendamento até a sincronização ler.)`);
    log("Modo teste: nada foi enviado.");
    return;
  }
  if (!itens.length) return log("Nada para enviar.");
  const g = await fetch(GESTAO_URL, { method: "POST", headers: { Authorization: "Bearer " + cfg.gestao_api_key, "Content-Type": "application/json" }, body: JSON.stringify(itens) });
  const res = await g.json().catch(() => ({}));
  if (!g.ok && !res.recebidos) throw new Error(`Gestão Barber IA respondeu ${g.status}: ${res.erro || JSON.stringify(res).slice(0, 200)}`);
  log(`Gestão Barber IA: ${res.recebidos} lançamentos gravados.`);
  if (res.problemas?.length) {
    const nomes = [...new Set(res.problemas.map((p) => (p.match(/barbeiro "([^"]*)"/) || [])[1]).filter(Boolean))];
    if (nomes.length) log(`ATENÇÃO: profissionais da AppBarber sem cadastro igual no Gestão: ${nomes.join(", ")}. Ajuste em "nomes" no config.json.`);
    else log("Problemas: " + res.problemas.slice(0, 5).join(" | "));
  }
}
main().catch((e) => { log("ERRO: " + e.message); process.exit(1); });
