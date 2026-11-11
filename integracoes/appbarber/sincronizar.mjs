// Gestão Barber IA — sincronização com a AppBarber.
// Roda no computador da barbearia (o IP dele é o liberado na AppBarber).
// Busca os atendimentos REALIZADOS dos últimos 31 dias (1 chamada à AppBarber)
// e envia o total de cada profissional por dia para o Gestão Barber IA.
// Uso:  node sincronizar.mjs          (envia)
//       node sincronizar.mjs --teste  (só mostra os números, não envia)
// Precisa do Node.js 18 ou mais novo. Configuração em config.json (veja config.exemplo.json).
import { readFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const TESTE = process.argv.includes("--teste");
const log = (msg) => {
  const line = `[${new Date().toLocaleString("pt-BR")}] ${msg}`;
  console.log(line);
  try { appendFileSync(join(DIR, "sincronizacao.log"), line + "\n"); } catch { /* sem log em arquivo */ }
};

let cfg;
try { cfg = JSON.parse(readFileSync(join(DIR, "config.json"), "utf8")); }
catch { log("ERRO: não encontrei o config.json. Copie o config.exemplo.json para config.json e preencha."); process.exit(1); }
for (const k of ["appbarber_api_key", "codigo_estabelecimento", "gestao_api_key"]) {
  if (!cfg[k] || String(cfg[k]).includes("COLE")) { log(`ERRO: preencha "${k}" no config.json.`); process.exit(1); }
}
const DIAS = Math.min(31, Math.max(1, Number(cfg.dias) || 31));
const GESTAO_URL = cfg.gestao_url || "https://sekkmnkajnaqubyhpxvd.supabase.co/functions/v1/lancamentos";
const NOMES = cfg.nomes || {}; // "Nome na AppBarber": "Nome no Gestão Barber IA"

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

async function main() {
  const q = new URLSearchParams({ establishment_code: String(cfg.codigo_estabelecimento), start_date: iso(ini), end_date: iso(hoje), status_type: "2" });
  if (cfg.codigo_filial) q.set("branch_code", String(cfg.codigo_filial));
  const r = await fetch((cfg.appbarber_url || "https://api.appbarber.com") + "/v1/appointments/history?" + q, { headers: { "X-API-Key": cfg.appbarber_api_key, Accept: "application/json" } });
  const txt = await r.text();
  if (!r.ok) {
    const dica = r.status === 401 || r.status === 403 ? " Confira a chave da AppBarber e se o IP deste computador é o liberado por eles." : r.status === 429 ? " Limite de chamadas atingido; tente mais tarde." : "";
    throw new Error(`AppBarber respondeu ${r.status}.${dica} ${txt.slice(0, 200)}`);
  }
  const lista = (JSON.parse(txt).data) || [];

  // Soma por profissional e dia: faturamento, serviços, clientes (sem repetir) e maior comanda.
  const acc = new Map();
  for (const a of lista) {
    if (a.scheduling_status && !/realizad/i.test(a.scheduling_status)) continue;
    const d = dia(a.scheduling_start); const nome = String(a.employee_name || "").trim();
    if (!d || !nome) continue;
    const k = nome + "|" + d;
    if (!acc.has(k)) acc.set(k, { nome, d, fat: 0, serv: 0, cli: new Set(), com: new Map() });
    const x = acc.get(k), v = num(a.service_value);
    x.fat += v; x.serv += 1;
    x.cli.add(String(a.client_phone || a.client_name || a.appointment_code).replace(/\D/g, "") || String(a.client_name));
    const c = a.invoice_code || a.appointment_code; x.com.set(c, (x.com.get(c) || 0) + v);
  }
  const itens = [...acc.values()].map((x) => ({
    data: x.d, barbeiro: NOMES[x.nome] || x.nome,
    faturamento: Math.round(x.fat * 100) / 100, servicos: x.serv, clientes: x.cli.size,
    maior_comanda: Math.round(Math.max(0, ...x.com.values()) * 100) / 100,
  }));
  log(`AppBarber: ${lista.length} atendimentos realizados de ${iso(ini)} a ${iso(hoje)} → ${itens.length} dias de profissionais.`);
  if (TESTE) {
    const tot = new Map();
    for (const i of itens) { const t = tot.get(i.barbeiro) || { fat: 0, serv: 0, dias: 0 }; t.fat += i.faturamento; t.serv += i.servicos; t.dias++; tot.set(i.barbeiro, t); }
    for (const [n, t] of tot) console.log(`  ${n}: R$ ${t.fat.toFixed(2)} · ${t.serv} serviços · ${t.dias} dias`);
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
