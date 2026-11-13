// Gestão Barber IA — servidor de sincronização (IP fixo, 24 horas por dia).
// Substitui o computador da barbearia: a cada 10 minutos, busca na AppBarber os dados
// de TODAS as barbearias que ligaram a "Sincronização automática" no app e envia ao Gestão.
// Roda como serviço (systemd), instalado por instalar-servidor.sh. Precisa do Node.js 18+.
// Variáveis (em /etc/gbia-sync.env): SYNC_TOKEN (obrigatória), SYNC_URL, SITE_URL, INTERVALO_MIN.
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, renameSync, existsSync, statSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSAO = "1.0";
const DIR = dirname(fileURLToPath(import.meta.url));
const TOKEN = process.env.SYNC_TOKEN || "";
const SYNC_URL = process.env.SYNC_URL || "https://sekkmnkajnaqubyhpxvd.supabase.co/functions/v1/sync-servidor";
const SITE = (process.env.SITE_URL || "https://gest-o-a-vista.vercel.app").replace(/\/$/, "");
const INTERVALO = Math.max(5, Number(process.env.INTERVALO_MIN) || 10) * 60000;
const BASE = join(DIR, "sincronizar.mjs");
const DADOS = join(DIR, "dados");
const UMA_VEZ = process.argv.includes("--uma-vez");
const log = (m) => console.log(`[${new Date().toLocaleString("pt-BR")}] ${m}`);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

if (TOKEN.length < 32) { log("ERRO: falta o SYNC_TOKEN em /etc/gbia-sync.env."); process.exit(1); }

// Baixa a versão mais nova de um arquivo do site e só troca se passar na checagem do Node.
async function atualizar(caminho, destino, atual) {
  try {
    const r = await fetch(`${SITE}/${caminho}`, { cache: "no-store" });
    if (!r.ok) return false;
    const novo = await r.text();
    const v = (novo.match(/const VERSAO = "([^"]+)"/) || [])[1];
    if (!v || v === atual || novo.length < 1000) return false;
    const tmp = destino.replace(/\.mjs$/, "") + ".novo.mjs";
    writeFileSync(tmp, novo);
    if (spawnSync(process.execPath, ["--check", tmp]).status !== 0) return false;
    renameSync(tmp, destino);
    log(`Atualizado: ${caminho} ${atual || "-"} → ${v}.`);
    return true;
  } catch { return false; }
}
const versaoDe = (f) => { try { return (readFileSync(f, "utf8").match(/const VERSAO = "([^"]+)"/) || [])[1]; } catch { return null; } };

let ultimaAtualizacao = 0;
async function atualizacoes() {
  if (Date.now() - ultimaAtualizacao < 6 * 3600000 && existsSync(BASE)) return;
  ultimaAtualizacao = Date.now();
  await atualizar("integracoes/appbarber/sincronizar.mjs", BASE, versaoDe(BASE));
  // O próprio servidor: se mudar, sai e o systemd reinicia já com o código novo.
  if (await atualizar("integracoes/servidor/sync-servidor.mjs", fileURLToPath(import.meta.url), VERSAO)) {
    log("Reiniciando com a versão nova…"); process.exit(0);
  }
}

async function api(method, body) {
  const r = await fetch(SYNC_URL, {
    method, headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || `HTTP ${r.status}`);
  return j;
}

// Roda o sincronizar.mjs de uma barbearia na pasta dela (config, cache de comandas e log separados).
function rodar(e) {
  const pasta = join(DADOS, e.company_id.replace(/[^a-zA-Z0-9-]/g, ""));
  mkdirSync(pasta, { recursive: true });
  const cfg = {
    appbarber_api_key: e.appbarber_api_key, codigo_estabelecimento: e.codigo_estabelecimento,
    gestao_api_key: e.gestao_api_key, nomes: e.nomes || {}, auto_atualizar: false,
  };
  if (e.codigo_filial) cfg.codigo_filial = e.codigo_filial;
  if (process.env.GESTAO_URL) cfg.gestao_url = process.env.GESTAO_URL;
  if (process.env.APPBARBER_URL) cfg.appbarber_url = process.env.APPBARBER_URL;
  writeFileSync(join(pasta, "config.json"), JSON.stringify(cfg, null, 2), { mode: 0o600 });
  copyFileSync(BASE, join(pasta, "sincronizar.mjs"));
  // O log de cada barbearia fica com no máximo ~1 MB.
  const lg = join(pasta, "sincronizacao.log");
  try { if (statSync(lg).size > 2e6) writeFileSync(lg, readFileSync(lg, "utf8").slice(-1e6)); } catch { /* ainda sem log */ }
  return new Promise((ok) => {
    const p = spawn(process.execPath, [join(pasta, "sincronizar.mjs")], { cwd: pasta, env: { ...process.env, SYNC_TOKEN: "" } });
    let out = "";
    const pega = (d) => { out += d; if (out.length > 20000) out = out.slice(-10000); };
    p.stdout.on("data", pega); p.stderr.on("data", pega);
    const t = setTimeout(() => p.kill("SIGTERM"), 9 * 60000);
    p.on("close", (code) => {
      clearTimeout(t);
      const linhas = out.trim().split("\n").map((l) => l.replace(/^\[[^\]]*\]\s*/, "").trim()).filter(Boolean);
      const imp = linhas.filter((l) => /ERRO|ATENÇÃO|gravados|Fora do horário|Nada para enviar|Problemas|limite/i.test(l));
      ok({ ok: code === 0 && !imp.some((l) => /^ERRO/.test(l)), mensagem: (imp.length ? imp : linhas).slice(-2).join(" | ") || `terminou (código ${code})` });
    });
  });
}

async function ciclo() {
  await atualizacoes();
  if (!existsSync(BASE)) { log("Ainda sem o programa de sincronização (sem internet?)."); return; }
  let lista;
  try { lista = (await api("GET")).empresas || []; } catch (e) { log("Não consegui buscar a lista de barbearias: " + e.message); return; }
  log(`${lista.length} barbearia(s) com sincronização automática.`);
  for (const e of lista) {
    const r = await rodar(e);
    log(`${e.nome}: ${r.ok ? "ok" : "ERRO"} · ${r.mensagem}`);
    await api("POST", { company_id: e.company_id, ok: r.ok, mensagem: r.mensagem }).catch((x) => log("Falha ao gravar o status: " + x.message));
    // Uma barbearia de cada vez: o limite da AppBarber (30 chamadas por minuto) é por IP.
    await espera(3000);
  }
}

log(`Servidor de sincronização ${VERSAO} iniciado (a cada ${INTERVALO / 60000} min).`);
for (;;) {
  const t0 = Date.now();
  await ciclo().catch((e) => log("ERRO no ciclo: " + e.message));
  if (UMA_VEZ) break;
  await espera(Math.max(30000, INTERVALO - (Date.now() - t0)));
}
