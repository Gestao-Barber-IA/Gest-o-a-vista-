/* Gestão Barber IA — dados, períodos e regras de pontuação.
   Nesta versão tudo fica salvo no navegador (localStorage). A camada `DB`
   foi isolada para ser trocada por um servidor (ex.: Supabase) sem mexer na tela. */
(function () {
  'use strict';

  // Modo apresentação: dados fictícios separados (nunca mistura com os dados reais).
  // Link direto para a demonstração (ex.: página de vendas): ?demo=barber ou ?demo=salao
  try {
    const q = new URLSearchParams(window.location.search).get('demo');
    if (q === 'salao' || q === 'barber') { window.sessionStorage.setItem('gbia.demo', q); window.history.replaceState(null, '', window.location.pathname + window.location.hash); }
  } catch (e) { /* opcional */ }
  const DEMO = (() => { try { const v = window.sessionStorage.getItem('gbia.demo'); return v === 'salao' || v === 'barber' ? v : ''; } catch (e) { return ''; } })();
  const KEY = DEMO ? 'gbia.demo.' + DEMO : 'gbia.v1';
  // Na apresentação o mês aparece como fechado: o relógio do app (só nesta aba e só no modo
  // apresentação) vai para o último dia útil do mês atual, mantendo a hora de agora.
  if (DEMO) {
    const Real = Date, now = new Real();
    const end = new Real(now.getFullYear(), now.getMonth() + 1, 0, now.getHours(), now.getMinutes(), now.getSeconds());
    if (end.getDay() === 0) end.setDate(end.getDate() - 1); // domingo fechado
    const OFF = Math.max(0, end.getTime() - now.getTime());
    if (OFF) {
      const DemoDate = class extends Real {
        constructor(...a) { if (a.length) super(...a); else super(Real.now() + OFF); }
        static now() { return Real.now() + OFF; }
      };
      window.Date = DemoDate;
    }
  }
  const memory = {};

  function safeGet(storage, k) {
    try { return window[storage].getItem(k); } catch (e) { return memory[storage + k] ?? null; }
  }
  function safeSet(storage, k, v) {
    try { window[storage].setItem(k, v); } catch (e) { memory[storage + k] = v; }
  }
  function safeDel(storage, k) {
    try { window[storage].removeItem(k); } catch (e) { delete memory[storage + k]; }
  }

  // ---------- utilitários ----------
  const uid = (p = '') => p + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const fromIso = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

  // Hash simples só para a demonstração local. No servidor, senhas usam bcrypt/argon2.
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  const passHash = (email, pass) => hash('gbia:' + email.toLowerCase().trim() + ':' + pass);

  // ---------- indicadores ----------
  // `calc` recebe as somas do período; devolve null quando não há dado.
  const INDICATORS = [
    { key: 'fat', label: 'Faturamento', weight: 22, fmt: 'money',
      calc: s => s.n.fat ? s.fat : null },
    { key: 'check', label: 'Checklist Agenda Cheia', weight: 15, fmt: 'int',
      calc: s => s.n.check ? s.check : null },
    { key: 'ocup', label: 'Taxa de ocupação', weight: 10, fmt: 'pct',
      calc: s => s.n.hDisp && s.hDisp > 0 ? (s.hOcup / s.hDisp) * 100 : null },
    { key: 'ticket', label: 'Ticket médio', weight: 10, fmt: 'money2',
      calc: s => s.n.fat && s.cli > 0 ? s.fat / s.cli : null },
    { key: 'serv', label: 'Serviços realizados', weight: 9, fmt: 'int',
      calc: s => MODES.serv === 'valor' ? (s.n.servV ? s.servV : null) : (s.n.serv ? s.serv : null) },
    { key: 'cli', label: 'Clientes atendidos', weight: 6, fmt: 'int',
      calc: s => s.n.cli ? s.cli : null },
    { key: 'planos', label: 'Planos mensais', weight: 10, fmt: 'int',
      calc: s => s.n.planos ? s.planos : null },
    { key: 'fid', label: 'Taxa de fidelização', weight: 10, fmt: 'pct',
      calc: s => s.n.ret && s.cli > 0 ? (s.ret / s.cli) * 100 : null },
    { key: 'prod', label: 'Venda de produtos', weight: 8, fmt: 'int',
      calc: s => MODES.prod === 'valor' ? (s.n.prodV ? s.prodV : null) : (s.n.prod ? s.prod : null) },
  ];

  // Indicadores de destaque que NÃO entram na pontuação, no MVP nem no Destaque.
  const BONUS_INDS = [
    { key: 'comanda', label: 'Maior comanda do mês', short: 'Maior comanda', fmt: 'money2', noScore: true,
      calc: s => s.n.comanda ? s.comanda : null },
  ];

  // Campos que o gestor (ou a API) lança por barbeiro e por dia.
  const FIELDS = [
    { key: 'fat', label: 'Faturamento (R$)', api: 'faturamento', step: '0.01' },
    { key: 'serv', label: 'Serviços realizados', api: 'servicos', step: '1' },
    { key: 'cli', label: 'Clientes atendidos', api: 'clientes', step: '1' },
    { key: 'check', label: 'Checklist Agenda Cheia (pontos)', api: 'checklist_pop', step: '1' },
    // Antigo: a capacidade agora vem da regra de ocupação (Configurações). Aceito, mas não usado.
    { key: 'hDisp', label: 'Horas disponíveis', api: 'horas_disponiveis', step: '0.5', legacy: true },
    { key: 'hOcup', label: 'Horas em comandas finalizadas', api: 'horas_ocupadas', step: '0.5' },
    { key: 'planos', label: 'Planos mensais vendidos', api: 'planos_mensais', step: '1' },
    { key: 'ret', label: 'Clientes que voltaram', api: 'clientes_retorno', step: '1' },
    { key: 'prod', label: 'Produtos vendidos (quantidade)', api: 'venda_produtos', step: '1' },
    { key: 'comanda', label: 'Maior comanda do dia (R$)', api: 'maior_comanda', step: '0.01' },
    // Usados quando o dono escolhe "valor em R$" em Serviços ou em Venda de produtos (Indicadores e metas).
    { key: 'servV', label: 'Valor em serviços (R$)', api: 'valor_servicos', step: '0.01' },
    { key: 'prodV', label: 'Valor em produtos vendidos (R$)', api: 'valor_produtos', step: '0.01' },
  ];

  // ---------- períodos ----------
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const PERIOD_NAMES = { semana: 'Semana', mes: 'Mês', trimestre: 'Trimestre' };

  function periodRange(type, offset = 0, today = new Date()) {
    const y = today.getFullYear(), m = today.getMonth();
    let start, end, label;
    if (type === 'semana') {
      const dow = (today.getDay() + 6) % 7; // segunda = 0
      start = new Date(y, m, today.getDate() - dow + offset * 7);
      end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      label = `${pad(start.getDate())}/${pad(start.getMonth() + 1)} a ${pad(end.getDate())}/${pad(end.getMonth() + 1)}`;
    } else if (type === 'trimestre') {
      const q = Math.floor(m / 3) + offset;
      start = new Date(y, q * 3, 1);
      end = new Date(y, q * 3 + 3, 0);
      label = `${Math.floor(start.getMonth() / 3) + 1}º trimestre de ${start.getFullYear()}`;
    } else {
      start = new Date(y, m + offset, 1);
      end = new Date(y, m + offset + 1, 0);
      label = `${MONTHS[start.getMonth()]} de ${start.getFullYear()}`;
    }
    return { type, offset, start: iso(start), end: iso(end), label };
  }

  // ---------- agregação e pontuação ----------
  // Campos do fechamento mensal (lançados pelo gestor ou vindos da integração).
  const MONTH_FIELDS = [
    { key: 'fat', label: 'Faturamento (R$)', step: '0.01', daily: 'fat' },
    { key: 'agend', label: 'Agendamentos', step: '1' },
    { key: 'cli', label: 'Clientes atendidos', step: '1', daily: 'cli' },
    { key: 'serv', label: 'Serviços realizados', step: '1', daily: 'serv' },
    { key: 'servV', label: 'Valor em serviços (R$)', step: '0.01', daily: 'servV' },
    { key: 'ticket', label: 'Ticket médio (R$)', calc: true },
    { key: 'ocupPct', label: 'Taxa de ocupação (%)', step: '0.1', daily: 'hOcup' },
    { key: 'aus', label: 'Dias de ausência (férias, atestado)', step: '1', max: 31 },
    { key: 'fidPct', label: 'Taxa de fidelização (%)', step: '0.1', daily: 'ret', max: 100 },
    { key: 'prod', label: 'Produtos vendidos (quantidade)', step: '1', daily: 'prod' },
    { key: 'prodV', label: 'Valor em produtos vendidos (R$)', step: '0.01', daily: 'prodV' },
    { key: 'check', label: 'Pontos Checklist Agenda Cheia', step: '1', daily: 'check' },
    { key: 'planos', label: 'Planos mensais vendidos', step: '1', daily: 'planos' },
    { key: 'comanda', label: 'Maior comanda do mês (R$)', step: '0.01', daily: 'comanda' },
  ];

  const monthKey = d => d.slice(0, 7);

  // ---------- regra da taxa de ocupação ----------
  // Ocupação = horas em comandas finalizadas ÷ capacidade do mês.
  // Capacidade: horas da agenda (abertura a fechamento, menos o almoço) × dias trabalhados no mês
  // (padrão 22, menos as ausências do barbeiro), proporcional aos dias que já passaram.
  // Atendimentos fora do horário compensam o tempo ocioso; acima da capacidade passa de 100%.
  const OCUP_DEFAULT = { open: '09:00', close: '20:00', lunch: 60, days: 22 };
  const ocupCfgOf = state => ({ ...OCUP_DEFAULT, ...((state && state.ocupCfg) || {}) });
  // Horário do profissional: o dele, se o dono cadastrou um diferente; senão, o da empresa.
  const ocupCfgFor = (state, barberId) => { const c = ocupCfgOf(state), o = (c.by || {})[barberId] || {}; const r = { open: c.open, close: c.close, lunch: c.lunch, days: c.days }; for (const k of ['open', 'close', 'lunch', 'days']) if (o[k] !== undefined && o[k] !== '' && o[k] !== null) r[k] = o[k]; return r; };
  const toMin = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  const hoursPerDay = cfg => Math.max(0, (toMin(cfg.close) - toMin(cfg.open) - Number(cfg.lunch || 0)) / 60);
  function ausOf(state, barberId, ym) {
    const rec = (state.monthly || []).find(m => m.barberId === barberId && m.month === ym);
    return rec && isNum(rec.aus) ? Math.max(0, Number(rec.aus)) : 0;
  }
  // Horas de capacidade do barbeiro entre start e end (só dias até hoje).
  function ocupCapacity(state, barberId, start, end, today = iso(new Date())) {
    const cfg = ocupCfgFor(state, barberId), hpd = hoursPerDay(cfg), days = Number(cfg.days) || 0;
    const last = end < today ? end : today;
    let total = 0, ym = monthKey(start);
    while (start <= last && ym <= monthKey(last)) {
      const r = monthRange(ym);
      const a = start > r.start ? start : r.start, b = last < r.end ? last : r.end;
      if (a <= b) {
        const n = Math.round((fromIso(b) - fromIso(a)) / 86400000) + 1;
        const dim = Number(r.end.slice(8, 10));
        total += hpd * Math.max(0, days - ausOf(state, barberId, ym)) * n / dim;
      }
      ym = addMonths(ym, 1);
    }
    return total;
  }
  function monthRange(ym) {
    const [y, m] = ym.split('-').map(Number);
    const start = new Date(y, m - 1, 1), end = new Date(y, m, 0);
    return { type: 'mes', start: iso(start), end: iso(end), label: `${MONTHS[m - 1]} de ${y}`, ym };
  }
  function addMonths(ym, n) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  // Meses inteiros contidos no intervalo (só esses usam o total mensal).
  function fullMonths(range) {
    const out = [];
    let ym = monthKey(range.start);
    while (ym <= monthKey(range.end)) {
      const r = monthRange(ym);
      if (r.start >= range.start && r.end <= range.end) out.push(ym);
      ym = addMonths(ym, 1);
    }
    return out;
  }
  const isNum = v => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v));

  function aggregate(state, barberId, range) {
    applyCustom(state);
    const s = { fat: 0, serv: 0, cli: 0, check: 0, hDisp: 0, hOcup: 0, planos: 0, ret: 0, prod: 0, comanda: 0, n: {} };
    const add = (k, v) => {
      if (k === 'comanda') { s.comanda = Math.max(s.comanda, Number(v)); s.n.comanda = (s.n.comanda || 0) + 1; return; } // maior valor, não soma
      s[k] = (s[k] || 0) + Number(v); s.n[k] = (s.n[k] || 0) + 1;
    };
    const months = fullMonths(range);
    const recs = Object.fromEntries((state.monthly || []).filter(m => m.barberId === barberId && months.includes(m.month)).map(m => [m.month, m]));
    // Somas diárias por mês, para combinar com o total mensal.
    const dailyCli = {};
    for (const e of state.entries) {
      if (e.barberId !== barberId || e.date < range.start || e.date > range.end) continue;
      const rec = recs[monthKey(e.date)];
      if (isNum(e.cli)) dailyCli[monthKey(e.date)] = (dailyCli[monthKey(e.date)] || 0) + Number(e.cli);
      for (const f of FIELDS) {
        if (!isNum(e[f.key])) continue;
        if (rec) {
          const mk = f.key === 'hDisp' || f.key === 'hOcup' ? 'ocupPct' : f.key === 'ret' ? 'fidPct' : f.key;
          if (isNum(rec[mk])) continue; // o total do mês substitui os dias
        }
        if (f.key === 'check' && popDays(state, barberId).some(r => r.day.slice(0, 7) === monthKey(e.date))) continue;
        if (f.key === 'hDisp') continue; // a capacidade vem da regra de ocupação
        add(f.key, e[f.key]);
      }
    }
    // Checklist Agenda Cheia: os pontos diários entram no indicador e substituem o total manual do mês.
    const cfg = popCfgOf(state);
    const popMonths = new Set();
    for (const r of popDays(state, barberId)) {
      if (r.day < range.start || r.day > range.end) continue;
      add('check', Math.round(popDayPts(cfg, r) * 10) / 10);
      if (popHasEv(r)) popMonths.add(r.day.slice(0, 7)); // só o ajuste não substitui um total lançado à mão
    }
    for (const ym of months) {
      const rec = recs[ym];
      if (!rec) continue;
      for (const k of ['fat', 'cli', 'serv', 'prod', 'check', 'planos', 'comanda', 'servV', 'prodV', ...customKeys()]) if (isNum(rec[k]) && !(k === 'check' && popMonths.has(ym))) add(k, rec[k]);
      if (isNum(rec.fidPct)) {
        const cli = isNum(rec.cli) ? Number(rec.cli) : (dailyCli[ym] || 0);
        if (cli > 0) add('ret', (Number(rec.fidPct) / 100) * cli);
      }
    }
    // Ocupação: capacidade de cada mês do período. Conta nos meses em que alguém da equipe tem
    // horas de comandas (quem não atendeu fica com 0%) ou em que há taxa lançada à mão.
    const ocupData = new Set();
    for (const e of state.entries) if (isNum(e.hOcup) && e.date >= range.start && e.date <= range.end) ocupData.add(monthKey(e.date));
    for (let ym = monthKey(range.start); ym <= monthKey(range.end); ym = addMonths(ym, 1)) {
      const r = monthRange(ym);
      const a = range.start > r.start ? range.start : r.start, b = range.end < r.end ? range.end : r.end;
      const rec = recs[ym];
      if (rec && isNum(rec.ocupPct)) {
        const cap = ocupCapacity(state, barberId, a, b) || 1;
        s.hDisp += cap; s.hOcup += (Number(rec.ocupPct) / 100) * cap;
        s.n.hDisp = (s.n.hDisp || 0) + 1; s.n.hOcup = (s.n.hOcup || 0) + 1;
      } else if (ocupData.has(ym)) {
        const cap = ocupCapacity(state, barberId, a, b);
        if (cap > 0) { s.hDisp += cap; s.n.hDisp = (s.n.hDisp || 0) + 1; }
      }
    }
    return s;
  }

  // O que a integração já trouxe para o barbeiro no mês (campos travados no formulário).
  function monthFromIntegration(state, barberId, ym) {
    applyCustom(state);
    const r = monthRange(ym);
    const out = {}; let hO = 0, hasO = false, cli = 0, ret = 0;
    for (const e of state.entries) {
      if (e.source === 'manual' || e.barberId !== barberId || e.date < r.start || e.date > r.end) continue;
      for (const k of ['fat', 'cli', 'serv', 'prod', 'check', 'planos', 'servV', 'prodV', ...customKeys()]) if (isNum(e[k])) out[k] = (out[k] || 0) + Number(e[k]);
      if (isNum(e.comanda)) out.comanda = Math.max(out.comanda || 0, Number(e.comanda));
      if (isNum(e.hOcup)) { hO += Number(e.hOcup); hasO = true; }
      if (isNum(e.cli)) cli += Number(e.cli);
      if (isNum(e.ret)) ret += Number(e.ret);
    }
    if (hasO) { const cap = ocupCapacity(state, barberId, r.start, r.end); if (cap > 0) out.ocupPct = (hO / cap) * 100; }
    const pd = popDays(state, barberId).filter(x => x.day.slice(0, 7) === ym);
    if (pd.length) { const cfg = popCfgOf(state); out.check = Math.round(pd.reduce((a, x) => a + popDayPts(cfg, x), 0) * 10) / 10; out._pop = true; }
    if (ret > 0 && cli > 0) out.fidPct = (ret / cli) * 100;
    return out;
  }


  // ---------- Checklist Agenda Cheia (POP) ----------
  function popDefault() {
    return {
      title: 'POP — Agenda Lotada', subtitle: 'Checklist diário de performance', shop: '',
      phrase: 'A sua atitude de hoje gera o teu resultado de amanhã.', minProfit: 4500,
      items: [
        { id: 'stories', title: '5 Stories', desc: 'Poste no mínimo 5 stories nas redes sociais', type: 'count', target: 5, pts: 2 },
        { id: 'abord', title: '5 Abordagens', desc: 'Abordar 5 clientes em frente à barbearia e captar o telefone', type: 'phones', target: 5, pts: 3 },
        { id: 'convites', title: '10 Convites Instagram', desc: 'Mande mensagem para 10 potenciais clientes e anexe o print', type: 'count', target: 10, pts: 2 },
        { id: 'public', title: '3 Publicações com o cliente', desc: 'Self ou espelho junto com cliente e marcando @', type: 'count', target: 3, pts: 3 },
        { id: 'google', title: '4 Avaliações no Google', desc: 'Peça e conquiste 4 avaliações de clientes no Google', type: 'count', target: 4, pts: 3 },
        { id: 'estrat', title: 'Stories Estratégico', desc: 'postar às 8h30, 12h, 17h30', type: 'count', target: 3, pts: 2 },
        { id: 'extra', title: 'EXTRA', desc: 'Pró atividade', type: 'count', target: 5, pts: 3 },
        { id: 'chegada', title: 'Horário de chegada', desc: 'Pontualidade', type: 'check', target: 1, pts: 3 },
      ],
      levels: [
        { name: 'Elite', min: 390, max: 600, value: 4500, tone: 'gold' },
        { name: 'Ouro', min: 300, max: 389, value: 4250, tone: 'gold' },
        { name: 'Prata', min: 270, max: 299, value: 4000, tone: 'silver' },
        { name: 'Bronze', min: 240, max: 269, value: 3750, tone: 'bronze' },
        { name: 'Em desenvolvimento', min: 210, max: 239, value: 3500, tone: 'plain' },
        { name: 'Não elegível', min: 0, max: 209, value: null, tone: 'none' },
      ],
      rules: 'A garantia de lucro é um benefício concedido aos novos profissionais durante os 3 primeiros meses, condicionado ao cumprimento integral do POP Agenda Lotada, ao alcance da pontuação mínima estabelecida e ao respeito às normas, cultura e padrão de atendimento da barbearia.',
      lose: ['Não cumprir jornada estabelecida', 'Atrasos sem justificativa', 'Mau atendimento ao cliente', 'Quebra das regras e padrões da empresa', 'Falta sem aviso prévio'],
    };
  }
  const popDef = {};
  // Modelo padrão do checklist; no salão, os textos falam de salão.
  function popDefaultFor(brand) {
    const d = popDefault();
    if (brand !== 'salao') return d;
    const sw = t => String(t || '').replace(/em frente à barbearia/g, 'em frente ao salão').replace(/da barbearia/g, 'do salão').replace(/barbearia/g, 'salão');
    d.items.forEach(it => { it.title = sw(it.title); it.desc = sw(it.desc); });
    d.rules = sw(d.rules); d.lose = (d.lose || []).map(sw);
    return d;
  }
  const popCfgOf = state => {
    if (state.popCfg && Array.isArray(state.popCfg.items)) return state.popCfg;
    const b = state.brand === 'salao' ? 'salao' : 'barber';
    return popDef[b] || (popDef[b] = popDefaultFor(b));
  };
  const validPhone = p => String(p || '').replace(/\D/g, '').length >= 10;
  // Cada unidade do checklist é uma prova (foto/print). Só as aprovadas pela gestão contam pontos.
  // Horário de chegada: só "Chegou no horário combinado" (arr = 'ok') vale pontos; depois do horário ou atrasado, sem bônus.
  const evOk = (it, e) => e && e.status === 'aprovado' && (!e.arr || e.arr === 'ok') && (it.type !== 'phones' || validPhone(e.phone));
  const evLive = e => e && e.status !== 'recusado';
  function popItemPts(it, ev, pending) {
    const list = Array.isArray(ev) ? ev : [];
    const n = list.filter(e => pending ? (e.status === 'pendente' && (it.type !== 'phones' || validPhone(e.phone))) : evOk(it, e)).length;
    const t = it.type === 'check' ? 1 : Math.max(1, Number(it.target) || 1);
    return Number(it.pts) * Math.min(n, t) / t;
  }
  const popDayMax = cfg => cfg.items.reduce((a, it) => a + Number(it.pts || 0), 0);
  // rec.adj: pontos acrescentados à mão pela gestão (ex.: pontos trazidos do sistema anterior). Somam aos do dia.
  const popAdj = rec => (rec && Number(rec.adj) > 0 ? Number(rec.adj) : 0);
  function popDayPts(cfg, rec, pending) {
    if (!rec) return 0;
    const adj = pending ? 0 : popAdj(rec);
    if (!rec.ev) return adj;
    return cfg.items.reduce((a, it) => a + popItemPts(it, rec.ev[it.id], pending), 0) + adj;
  }
  const popHasEv = r => !!r.ev && Object.values(r.ev).some(l => Array.isArray(l) && l.length);
  const popDays = (state, barberId) => (state.pop || []).filter(r => r.barberId === barberId && r.day.length === 10 && (popHasEv(r) || popAdj(r) > 0));


  // ---------- Lançamento manual por dia ----------
  // Os campos somáveis do Lançamentos mostram o total do mês; ao mudar o total,
  // a diferença entra no dia escolhido (entrada "manual"), para aparecer na Semana.
  const SUM_KEYS = ['fat', 'cli', 'serv', 'prod', 'check', 'planos', 'servV', 'prodV'];
  const r2 = v => Math.round(v * 100) / 100;
  const manualEntries = (state, bid, ym) => state.entries.filter(e => e.source === 'manual' && e.barberId === bid && e.date.slice(0, 7) === ym);
  function manualTotal(state, bid, ym, key) {
    return r2(manualEntries(state, bid, ym).reduce((a, e) => a + (isNum(e[key]) ? Number(e[key]) : 0), 0));
  }
  function manualEntry(state, bid, date) {
    let e = state.entries.find(x => x.source === 'manual' && x.barberId === bid && x.date === date);
    if (!e) { e = { id: 'm_' + bid + '_' + date, barberId: bid, date, source: 'manual' }; state.entries.push(e); }
    return e;
  }
  function applyManualTotal(state, bid, ym, key, target, date) {
    const rec = (state.monthly || []).find(m => m.barberId === bid && m.month === ym);
    // Total antigo do mês (antes do lançamento por dia) vira o saldo do dia 1.
    if (rec && isNum(rec[key]) && !(rec._adj && rec._adj[key])) {
      const e1 = manualEntry(state, bid, monthRange(ym).start);
      e1[key] = r2((isNum(e1[key]) ? Number(e1[key]) : 0) + Number(rec[key]));
      rec[key] = null;
    }
    let delta = r2((isNum(target) ? Number(target) : 0) - manualTotal(state, bid, ym, key));
    if (delta > 0) { const e = manualEntry(state, bid, date); e[key] = r2((isNum(e[key]) ? Number(e[key]) : 0) + delta); return; }
    if (delta === 0) return;
    // Diminuiu: tira do dia escolhido, depois dos dias anteriores, depois dos seguintes.
    const list = manualEntries(state, bid, ym).filter(e => isNum(e[key]) && Number(e[key]) > 0)
      .sort((a, b) => (a.date === date ? -1 : b.date === date ? 1 : 0) || (a.date <= date && b.date <= date ? b.date.localeCompare(a.date) : a.date <= date ? -1 : b.date <= date ? 1 : a.date.localeCompare(b.date)));
    for (const e of list) {
      if (delta >= 0) break;
      const take = Math.min(Number(e[key]), -delta);
      e[key] = r2(Number(e[key]) - take); delta = r2(delta + take);
    }
  }

  const DEFAULT_GOALS = { fat: 6000, check: 390, ocup: 75, ticket: 60, serv: 130, cli: 110, planos: 4, fid: 50, prod: 20 };
  const goalFor = (state, barberId, key) => {
    const ind = state.goals?.byBarber?.[barberId]?.[key];
    return isNum(ind) ? Number(ind) : Number(state.goals?.team?.[key] ?? DEFAULT_GOALS[key]);
  };

  // Níveis de carreira pela média das pontuações mensais.
  const LEVELS = [
    { name: 'Bronze', min: 0, cls: 'lv-bronze' }, { name: 'Prata', min: 70, cls: 'lv-silver' },
    { name: 'Ouro', min: 85, cls: 'lv-gold' }, { name: 'Diamante', min: 95, cls: 'lv-diamond' },
  ];
  function levelOf(v) {
    let i = 0; LEVELS.forEach((l, k) => { if (v >= l.min) i = k; });
    const next = LEVELS[i + 1];
    return { ...LEVELS[i], next: next ? next.name : null, need: next ? Math.max(0, next.min - v) : 0 };
  }

  /**
   * Regras:
   * - Indicador só conta se algum barbeiro tiver dado no período.
   * - Nota por indicador: 1º = 100, último = 0, proporcional ao valor.
   * - Pontuação geral = média ponderada das notas pelos pesos.
   * - Empate no 1º lugar conta como liderança para todos os empatados.
   * - Destaque: 1º em pelo menos metade dos indicadores (arredonda para cima).
   * - MVP: 1º em metade + 1. Só existe um título por período: ou MVP, ou Destaque.
   * - Desempate do título: mais lideranças e, depois, maior pontuação geral.
   * - Ranking: quem tem o título fica em 1º; os demais seguem pela pontuação.
   */
  function computeRanking(state, range) {
    applyCustom(state);
    const barbers = state.barbers.filter(b => b.active !== false);
    const weights = state.weights || {};
    const rows = barbers.map(b => ({ barber: b, sums: aggregate(state, b.id, range), values: {}, ranks: {}, scores: {}, leads: [], overall: 0 }));

    const active = [], inactive = [];
    const hidden = [...(state.hidden || []), ...RETIRED];
    for (const ind of INDICATORS) {
      const w = weights[ind.key] ?? ind.weight;
      if (hidden.includes(ind.key)) { inactive.push({ ...ind, weight: w, reason: 'oculto' }); continue; }
      const vals = rows.map(r => ind.calc(r.sums));
      if (w <= 0) { inactive.push({ ...ind, weight: w, reason: 'peso zero' }); continue; }
      if (vals.every(v => v === null)) { inactive.push({ ...ind, weight: w, reason: 'sem dados' }); continue; }
      const nums = vals.map(v => v ?? 0);
      const max = Math.max(...nums), min = Math.min(...nums);
      const leaders = [];
      rows.forEach((r, i) => {
        const v = nums[i];
        r.values[ind.key] = vals[i];
        r.ranks[ind.key] = 1 + nums.filter(x => x > v).length;
        r.scores[ind.key] = max === min ? (max > 0 ? 100 : 0) : ((v - min) / (max - min)) * 100;
        if (v === max && max > 0) { leaders.push(r.barber.id); r.leads.push(ind.key); }
      });
      active.push({ ...ind, weight: w, leaders, max });
    }

    // Destaques que não pontuam (ex.: maior comanda do mês).
    const bonus = [];
    for (const ind of BONUS_INDS) {
      if (hidden.includes(ind.key)) continue;
      const vals = rows.map(r => ind.calc(r.sums));
      if (vals.every(v => v === null)) continue;
      const max = Math.max(...vals.map(v => v ?? 0));
      const leaders = [];
      rows.forEach((r, i) => { r.values[ind.key] = vals[i]; if (vals[i] !== null && vals[i] === max && max > 0) leaders.push(r.barber.id); });
      bonus.push({ ...ind, weight: 0, leaders, max });
    }

    const totalW = active.reduce((a, i) => a + i.weight, 0);
    for (const r of rows) {
      r.overall = totalW ? active.reduce((a, i) => a + i.weight * r.scores[i.key], 0) / totalW : 0;
    }

    const N = active.length;
    // Sem dados suficientes no período, a regra usa os indicadores ativos (ex.: 8 → Destaque 4, MVP 5).
    const Nrule = N >= 2 ? N : INDICATORS.filter(i => !hidden.includes(i.key) && (weights[i.key] ?? i.weight) > 0).length;
    const half = Math.ceil(Nrule / 2);
    const mvpNeed = half + 1;
    let title = { type: null, barberId: null };
    if (N >= 2 && rows.length >= 2) {
      const best = [...rows].sort((a, b) => b.leads.length - a.leads.length || b.overall - a.overall)[0];
      if (best.leads.length >= mvpNeed) title = { type: 'mvp', barberId: best.barber.id };
      else if (best.leads.length >= half) title = { type: 'destaque', barberId: best.barber.id };
    }

    rows.sort((a, b) => {
      if (a.barber.id === title.barberId) return -1;
      if (b.barber.id === title.barberId) return 1;
      return b.overall - a.overall || (b.sums.fat - a.sums.fat);
    });
    rows.forEach((r, i) => { r.pos = i + 1; });

    return { rows, active, bonus, inactive, N, Nrule, half, mvpNeed, title, range };
  }


  // ---------- quanto falta para subir ----------
  // Recalcula a pontuação geral trocando alguns valores de um barbeiro.
  function simulate(R, meId, otherId, changes) {
    const vals = R.rows.map(r => ({ id: r.barber.id, v: { ...r.values } }));
    const me = vals.find(x => x.id === meId);
    Object.assign(me.v, changes);
    const totalW = R.active.reduce((a, i) => a + i.weight, 0) || 1;
    const overall = { };
    for (const x of vals) overall[x.id] = 0;
    for (const ind of R.active) {
      const nums = vals.map(x => x.v[ind.key] ?? 0);
      const max = Math.max(...nums), min = Math.min(...nums);
      vals.forEach((x, i) => {
        const sc = max === min ? (max > 0 ? 100 : 0) : ((nums[i] - min) / (max - min)) * 100;
        overall[x.id] += ind.weight * sc / totalW;
      });
    }
    return { me: overall[meId], other: overall[otherId] };
  }

  // Menor aumento, em cada indicador, que faz `me` passar `target` na pontuação.
  function gapTo(R, me, target) {
    const has = k => R.active.some(a => a.key === k);
    const v = me.values, s = me.sums;
    const passes = ch => { const r = simulate(R, me.barber.id, target.barber.id, ch); return r.me > r.other + 0.05; };
    const out = [];
    const search = (kind, lo, hi, step, mk) => {
      if (!passes(mk(hi))) return;
      while (hi - lo > step) { const mid = (lo + hi) / 2; if (passes(mk(mid))) hi = mid; else lo = mid; }
      out.push({ kind, delta: Math.ceil(hi / step) * step });
    };
    if (has('fat')) {
      const maxFat = Math.max(...R.rows.map(r => r.sums.fat), 100);
      search('fat', 0, maxFat * 4, 1, d => {
        const ch = { fat: (v.fat ?? 0) + d };
        if (has('ticket') && s.cli > 0) ch.ticket = (s.fat + d) / s.cli;
        return ch;
      });
    }
    if (has('ocup') && v.ocup != null) search('ocup', 0, 100, 0.1, d => ({ ocup: v.ocup + d }));
    for (const k of ['check', 'planos', 'serv']) {
      if (!has(k)) continue;
      for (let d = 1; d <= 60; d++) { if (passes({ [k]: (v[k] ?? 0) + d })) { out.push({ kind: k, delta: d }); break; } }
    }
    return out;
  }

  // ---------- dados de demonstração ----------
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Imagem de exemplo para os POPs da demonstração (sem depender de arquivos).
  function demoStepImg(n, title, line, c1, c2) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><circle cx="110" cy="110" r="62" fill="rgba(255,255,255,.18)"/><text x="110" y="132" font-family="Arial" font-size="64" font-weight="700" fill="#fff" text-anchor="middle">${n}</text><text x="60" y="330" font-family="Arial" font-size="46" font-weight="700" fill="#fff">${title}</text><text x="60" y="400" font-family="Arial" font-size="30" fill="rgba(255,255,255,.85)">${line}</text><text x="60" y="540" font-family="Arial" font-size="22" fill="rgba(255,255,255,.7)">Foto de exemplo · modo apresentação</text></svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  function demoState(brand = 'barber') {
    const sal = brand === 'salao';
    const r = rng(sal ? 20261108 : 20261105);
    const people = sal ? [
      ['Ana Beatriz', 1.25, 1.0, 0.9, 'Cabeleireira'], ['Camila Souza', 1.0, 1.2, 0.95, 'Manicure'], ['Juliana Prado', 1.05, 0.95, 1.0, 'Cabeleireira'],
      ['Larissa Melo', 0.85, 1.15, 0.7, 'Esteticista'], ['Fernanda Dias', 0.95, 0.9, 0.8, 'Manicure'], ['Patrícia Gomes', 0.8, 1.0, 0.75, 'Maquiadora'],
      ['Bianca Rocha', 0.65, 1.1, 0.6, 'Designer de sobrancelhas'],
    ] : [
      ['Rafael Lima', 1.25, 1.0, 0.9, 'Barbeiro líder'], ['Diego Moura', 1.0, 1.15, 0.95, 'Barbeiro'], ['Thiago Alves', 1.05, 0.95, 1.0, 'Barbeiro'],
      ['Bruno Rocha', 0.85, 1.15, 0.7, 'Barbeiro'], ['Caio Ferreira', 0.95, 0.9, 0.8, 'Barbeiro'], ['Matheus Santos', 0.8, 1.0, 0.75, 'Barbeiro'],
      ['Júlia Ramos', 0.65, 1.25, 0.6, 'Barbeira'],
    ];
    // Fotos de pessoas fictícias (geradas por IA), só para a demonstração.
    const slug = n => n.split(' ')[0].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const barbers = people.map(([name, , , , role]) => ({ id: uid('b_'), name, photo: 'assets/demo/' + slug(name) + '.jpg', active: true, role, instagram: '' }));
    // Sonhos de exemplo (aba Sonhos).
    const DREAMS = [['Viagem para Porto Seguro com a família', 6000, 2400, 20], ['Moto nova', 15000, 4200, 25], ['Curso de barbearia avançada em São Paulo', 3500, 2900, 30], ['Entrada do apartamento', 40000, 9500, 30]];
    barbers.forEach((b, i) => { const d = DREAMS[i]; if (d) b.dream = { t: d[0], v: d[1], saved: d[2], pct: d[3] }; });
    // Mês fechado de cada profissional: faturamento de R$ 11 a 21 mil e ticket médio de R$ 85 a 130.
    // Clientes = faturamento ÷ ticket; serviços e horas em comandas seguem os clientes.
    const vols = people.map(p => p[1]), prices = people.map(p => p[2]);
    const lerp = (v, lo, hi, a, b) => a + (b - a) * (v - lo) / ((hi - lo) || 1);
    const vMin = Math.min(...vols), vMax = Math.max(...vols), pMin = Math.min(...prices), pMax = Math.max(...prices);
    const TARGET = vols.map(v => lerp(v, vMin, vMax, 12200, 20200));
    const TICKET = prices.map(p => lerp(p, pMin, pMax, 88, 127));
    const HPS = sal ? [0.62, 0.82] : [0.6, 0.8]; // horas por serviço
    const entries = [];
    const today = new Date();
    const curYm = iso(today).slice(0, 7);
    const GROW = [0.94, 0.96, 0.98, 1]; // evolução dos últimos meses até o atual
    const cliMonth = {}; // clientes por mês e profissional (para os agendamentos)
    for (let k = 3; k >= 0; k--) {
      const ym = addMonths(curYm, -k), mr = monthRange(ym);
      const last = k === 0 ? iso(today) : mr.end;
      const days = [];
      for (let d = fromIso(mr.start); iso(d) <= last; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) if (d.getDay() !== 0) days.push(new Date(d));
      people.forEach((_, i) => {
        const worked = days.filter(() => r() >= 0.12); // folgas
        if (!worked.length) return;
        const T = TARGET[i] * GROW[3 - k] * (0.97 + r() * 0.06);
        const tk = TICKET[i] * (0.97 + r() * 0.06);
        const total = Math.round(T / tk);
        (cliMonth[ym] = cliMonth[ym] || {})[i] = total;
        const w = worked.map(d => (0.7 + r() * 0.6) * (d.getDay() === 6 ? 1.35 : 1));
        const sw = w.reduce((x, y) => x + y, 0);
        const raw = w.map(x => total * x / sw), cliD = raw.map(Math.floor);
        let rest = total - cliD.reduce((x, y) => x + y, 0);
        raw.map((x, j) => [x - Math.floor(x), j]).sort((x, y) => y[0] - x[0]).forEach(([, j]) => { if (rest > 0) { cliD[j]++; rest--; } });
        worked.forEach((day, j) => {
          const cli = cliD[j];
          if (!cli) return;
          const serv = cli + Math.round(cli * (0.15 + r() * 0.25));
          const fat = Math.round(cli * tk * (0.92 + r() * 0.16) * 100) / 100;
          const hOcup = Math.round(serv * (HPS[0] + r() * (HPS[1] - HPS[0])) * 2) / 2;
          const comanda = Math.round(tk * (1.4 + r() * (r() < 0.08 ? 2.6 : 1.1)) * 100) / 100; // maior comanda do dia
          entries.push({ id: uid('e_'), barberId: barbers[i].id, date: iso(day), fat, serv, cli, hDisp: 8, hOcup, comanda, servV: Math.round(fat * 0.88 * 100) / 100, prodV: Math.round(fat * 0.12 * 100) / 100 });
        });
      });
    }
    // Lançamentos manuais do mês: Pontos POP, planos e venda de produtos.
    const monthly = [];
    for (let k = 3; k >= 0; k--) {
      const ym = addMonths(curYm, -k);
      const r2 = monthRange(ym);
      const days = ym === curYm ? today.getDate() : Number(r2.end.slice(8));
      const frac = days / 30;
      people.forEach(([, vol, , disc], i) => {
        monthly.push({ barberId: barbers[i].id, month: ym,
          check: Math.round((10 + r() * 10 + disc * 8) * frac),
          agend: Math.round(((cliMonth[ym] || {})[i] || 0) * (1.06 + r() * 0.08)),
          planos: Math.round((4 + r() * 2.5) * vol * vol * frac),
          prod: Math.round((14 + r() * 22) * vol * frac) });
      });
    }
    // Checklist Agenda Cheia de exemplo no mês atual.
    const pop = [];
    const pcfg = popDefaultFor(brand);
    for (let d = 1; d < today.getDate(); d++) {
      const day = `${curYm}-${pad(d)}`;
      if (new Date(today.getFullYear(), today.getMonth(), d).getDay() === 0) continue;
      people.forEach(([, vol, , disc], i) => {
        if (r() < 0.15) return;
        const ev = {};
        for (const it of pcfg.items) {
          const k = 0.35 + disc * 0.55 + r() * 0.25;
          const t = it.type === 'check' ? 1 : it.target;
          const n = it.type === 'check' ? (r() < k ? 1 : 0) : Math.min(t, Math.round(t * k * (0.6 + r() * 0.6)));
          ev[it.id] = Array.from({ length: n }, (_, j) => ({ id: uid('e_'), photo: null, demo: true, phone: it.type === 'phones' ? '119' + String(Math.floor(r() * 1e8)).padStart(8, '0') : undefined,
            desc: '', by: 'profissional', at: Date.now(), status: d < today.getDate() - 1 || r() < 0.6 ? 'aprovado' : 'pendente' }));
        }
        pop.push({ barberId: barbers[i].id, day, ev, by: 'profissional', at: Date.now() });
      });
    }
    const gestorId = uid('u_');
    // POPs de exemplo com fotos ilustrativas e link de vídeo.
    const [c1, c2] = sal ? ['#8a2a45', '#d98c8c'] : ['#1d2f6b', '#b08c42'];
    const popsList = (sal ? [
      ['Recepção da cliente', 'Do momento em que ela chega até a cadeira.', ['Receba pelo nome', 'Ofereça água, café ou chá', 'Confirme o serviço e o tempo']],
      ['Esmaltação em gel', 'Passo a passo do preparo à finalização.', ['Higienize as mãos e o material', 'Prepare as unhas e aplique a base', 'Aplique a cor e finalize na cabine']],
      ['Pós-atendimento', 'Como garantir a volta da cliente.', ['Mostre o resultado no espelho', 'Ofereça o próximo horário', 'Peça a avaliação no Google']],
    ] : [
      ['Recepção do cliente', 'Da porta até a cadeira.', ['Cumprimente pelo nome', 'Ofereça água ou café', 'Confirme o corte e o tempo']],
      ['Corte degradê', 'Padrão da casa para o degradê.', ['Defina a altura do degradê', 'Trabalhe as transições', 'Finalize e mostre no espelho']],
      ['Pós-atendimento', 'Como garantir a volta do cliente.', ['Ofereça o plano mensal', 'Agende o próximo horário', 'Peça a avaliação no Google']],
    ]).map(([name, desc, steps], k) => ({ id: 'pop_demo' + k, name, desc, video: 'https://www.youtube.com/', at: Date.now(),
      steps: steps.map((t, i) => ({ src: demoStepImg(i + 1, name, t, c1, c2), cap: t })) }));
    return {
      version: 2,
      demo: true,
      demoV: 10,
      comCfg: { pct: 40, pctBy: {}, plano: 10, prod: 5, pos: { 1: 200, 2: 100, 3: 50 }, mvp: 150, dest: 80, meta: 100 },
      // Bônus de exemplo do mês (roleta de produtos e presentes).
      bonusRecs: [[0, 'dinheiro', 30, 'Roleta – venda de 3 produtos', 2], [1, 'dinheiro', 50, 'Roleta – venda de 3 produtos', 4], [2, 'presente', 80, '2 ingressos VIP no cinema', 5], [0, 'dinheiro', 20, 'Roleta – venda de 3 produtos', 6], [3, 'dinheiro', 10, 'Roleta – venda de 3 produtos', 7]]
        .filter(x => barbers[x[0]] && x[4] <= today.getDate()).map(([i, tipo, valor, desc, d], k) => ({ id: 'bn_demo' + k, barberId: barbers[i].id, date: `${curYm}-${String(d).padStart(2, '0')}`, tipo, valor, desc, by: 'Gestão', at: `${curYm}-${String(d).padStart(2, '0')}T15:00:00Z` })),
      demoYm: curYm,
      presentation: !!DEMO,
      brand,
      pops: popsList,
      // Níveis de acesso de exemplo: um líder com acessos extras e uma gestora/gestor.
      org: { levels: [{ id: 'l1', name: 'Nível 1' }, { id: 'l2', name: 'Nível 2' }, { id: 'l3', name: 'Nível 3' }], nodes: [], grants: [],
        access: { [barbers[0].id]: 'lider', [barbers[2].id]: 'gestor' }, extras: { [barbers[0].id]: { review: true, fields: ['planos', 'prod'] } } },
      monthly,
      pop,
      hidden: ['fid'],
      goals: { team: { ...DEFAULT_GOALS, fat: 16000, ticket: 105, serv: 175, cli: 145, ocup: 65, planos: 7, prod: 28 }, byBarber: {} },
      // Metas fictícias da empresa: umas batidas e outras quase, para mostrar barras, "faltam" e a conquista.
      // Datas de nascimento fictícias: dois aniversariantes no mês atual.
      births: Object.fromEntries(barbers.map((b, i) => { const m = i === 2 || i === 5 ? Number(curYm.slice(5, 7)) : ((Number(curYm.slice(5, 7)) + i * 3) % 12) + 1; return [b.id, `${1990 + i * 2}-${String(m).padStart(2, '0')}-${String(i === 2 ? 12 : i === 5 ? 24 : 5 + i * 3).padStart(2, '0')}`]; })),
      houseGoals: { fat: 115000, agend: 1150, cli: 1050, serv: 1450, prod: 150, planos: 40, ticket: 100, ocup: 65 },
      // O mês seguinte já com a régua mais alta (metas por mês).
      houseGoalsM: { [addMonths(curYm, 1)]: { fat: 125000, agend: 1250, cli: 1120, serv: 1520, prod: 175, planos: 42, ticket: 105, ocup: 66 } },
      company: { name: sal ? 'Studio Bella · Demonstração' : 'Barbearia Demonstração', cnpj: '00.000.000/0001-00', phone: '(11) 90000-0000', email: 'gestor@demo.com', logo: null },
      users: [
        { id: gestorId, name: sal ? 'Dona do Studio' : 'Gestor Demo', email: 'gestor@demo.com', pass: passHash('gestor@demo.com', 'demo123'), role: 'gestor', status: 'ativo', barberId: null },
        { id: uid('u_'), name: barbers[1].name, email: 'barbeiro@demo.com', pass: passHash('barbeiro@demo.com', 'demo123'), role: 'barbeiro', status: 'ativo', barberId: barbers[1].id },
        { id: uid('u_'), name: barbers[4].name, email: 'caio@demo.com', pass: passHash('caio@demo.com', 'demo123'), role: 'barbeiro', status: 'pendente', barberId: barbers[4].id },
      ],
      invites: [{ code: 'mt' + hash('mateus').slice(0, 6), barberId: barbers[5].id, createdAt: iso(today), used: false }],
      barbers,
      entries,
      weights: Object.fromEntries(INDICATORS.map(i => [i.key, i.weight])),
      apiKey: 'gbia_' + hash(String(Date.now())) + hash('k' + Math.random()),
    };
  }

  function emptyState(company, gestor) {
    return {
      version: 2, demo: false, company, users: [gestor], invites: [], barbers: [], entries: [], monthly: [], hidden: ['fid'],
      goals: { team: { ...DEFAULT_GOALS }, byBarber: {} },
      weights: Object.fromEntries(INDICATORS.map(i => [i.key, i.weight])),
      apiKey: 'gbia_' + hash(String(Date.now())) + hash('k' + Math.random()),
    };
  }

  // ---------- persistência ----------
  const DB = {
    load() {
      const raw = safeGet('localStorage', KEY);
      if (raw) {
        try {
          const st = JSON.parse(raw);
          if (st.version !== 2) {
            if (st.demo) { const d = demoState(DEMO || 'barber'); DB.save(d); return d; }
            st.monthly = st.monthly || []; st.goals = st.goals || { team: { ...DEFAULT_GOALS }, byBarber: {} }; st.version = 2;
            st.barbers.forEach(b => { b.role = b.role || 'Barbeiro'; });
            DB.save(st);
          }
          if (!Array.isArray(st.hidden)) { st.hidden = ['fid']; DB.save(st); } // fidelização começa oculta
          // Demonstração antiga (sem fotos dos profissionais): recria com a versão nova.
          if (st.demo && (st.demoV !== 10 || st.demoYm !== iso(new Date()).slice(0, 7))) { const d = demoState(DEMO || 'barber'); DB.save(d); return d; }
          // Na apresentação, a marca é sempre a escolhida (Barber ou Salão).
          if (DEMO && st.brand !== DEMO) { st.brand = DEMO; DB.save(st); }
          return st;
        } catch (e) { /* recria abaixo */ }
      }
      const s = demoState(DEMO || 'barber');
      DB.save(s);
      return s;
    },
    save(s) { safeSet('localStorage', KEY, JSON.stringify(s)); },
    reset() { const s = demoState(DEMO || 'barber'); DB.save(s); return s; },
    demo: DEMO,
    replace(s) { DB.save(s); return s; },
    session: {
      get() { return safeGet('localStorage', KEY + '.session') || safeGet('sessionStorage', KEY + '.session'); },
      set(id, remember) {
        safeDel('localStorage', KEY + '.session'); safeDel('sessionStorage', KEY + '.session');
        safeSet(remember ? 'localStorage' : 'sessionStorage', KEY + '.session', id);
      },
      clear() { safeDel('localStorage', KEY + '.session'); safeDel('sessionStorage', KEY + '.session'); },
    },
    pref: {
      get(k, d) { const v = safeGet('localStorage', KEY + '.pref.' + k); return v === null ? d : v; },
      set(k, v) { safeSet('localStorage', KEY + '.pref.' + k, String(v)); },
    },
  };

  // Recebe lançamentos no formato da API (nomes em português) e grava.
  function importEntries(state, list) {
    if (!Array.isArray(list)) throw new Error('O conteúdo precisa ser uma lista (array) de lançamentos.');
    let ok = 0; const errors = [];
    list.forEach((item, idx) => {
      const n = idx + 1;
      if (!item || typeof item !== 'object') { errors.push(`Item ${n}: formato inválido.`); return; }
      const date = String(item.data || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { errors.push(`Item ${n}: "data" deve estar no formato AAAA-MM-DD.`); return; }
      const ref = item.barbeiro_id || item.barbeiro;
      const b = state.barbers.find(x => x.id === ref) ||
        state.barbers.find(x => x.name.toLowerCase() === String(ref || '').toLowerCase().trim());
      if (!b) { errors.push(`Item ${n}: barbeiro "${ref ?? ''}" não encontrado.`); return; }
      const entry = { barberId: b.id, date, source: 'api' };
      for (const f of FIELDS) {
        const v = item[f.api];
        entry[f.key] = v === undefined || v === null || v === '' ? null : Number(v);
        if (entry[f.key] !== null && Number.isNaN(entry[f.key])) { entry[f.key] = null; }
      }
      upsertEntry(state, entry);
      ok++;
    });
    return { ok, errors };
  }

  function upsertEntry(state, entry) {
    const src = entry.source || 'api';
    const i = state.entries.findIndex(e => e.barberId === entry.barberId && e.date === entry.date && (e.source || 'api') === src);
    if (i >= 0) state.entries[i] = { ...state.entries[i], ...entry };
    else state.entries.push({ id: uid('e_'), ...entry });
  }

  // Indicadores ligados (o gestor pode ocultar um indicador em Configurações).
  // Indicadores retirados por enquanto: não aparecem e não pontuam em nenhuma empresa (voltam tirando daqui).
  const RETIRED = ['fid'];
  const visibleInds = state => INDICATORS.filter(i => !RETIRED.includes(i.key) && !(state.hidden || []).includes(i.key));
  const FIELD_IND = { fidPct: 'fid', ocupPct: 'ocup', aus: 'ocup', servV: 'serv', prodV: 'prod' };

  // ---------- Indicadores personalizados (criados pelo dono em Indicadores e metas) ----------
  // state.customInds = [{ key: 'x_…', label, fmt: 'int' | 'money', goal }]. Somam no mês como Serviços ou Faturamento,
  // entram na nota, nas metas, em Lançamentos e na API (campo com o mesmo código). Ligar/desligar: state.hidden.
  // Serviços e Venda de produtos: por quantidade (padrão) ou por valor em R$ (state.indMode = { serv: 'valor', prod: 'valor' }).
  const MODES = { serv: 'qtd', prod: 'qtd' };
  const MODE_TXT = {
    serv: { qtd: ['Serviços realizados', 'int', 130], valor: ['Valor em serviços', 'money', 5000] },
    prod: { qtd: ['Venda de produtos', 'int', 20], valor: ['Valor em produtos vendidos', 'money', 800] },
  };
  const indMode = k => MODES[k] || 'qtd';
  // Campo de lançamento que não está em uso pelo modo escolhido (ex.: quantidade de serviços quando o indicador é por valor).
  const fieldOff = k => (k === 'serv' && MODES.serv === 'valor') || (k === 'servV' && MODES.serv !== 'valor') || (k === 'prod' && MODES.prod === 'valor') || (k === 'prodV' && MODES.prod !== 'valor');
  let CUSTOM = [];
  const customKeys = () => CUSTOM.map(c => c.key);
  const validCustom = c => c && /^x_[a-z0-9]{3,24}$/.test(c.key) && String(c.label || '').trim();
  let customSig = '';
  function applyCustom(state) {
    const list = (Array.isArray(state && state.customInds) ? state.customInds : []).filter(validCustom).slice(0, 12);
    const m = (state && state.indMode) || {};
    const sig = JSON.stringify([list, m.serv, m.prod]);
    if (sig === customSig) return;
    customSig = sig;
    for (const k of ['serv', 'prod']) {
      MODES[k] = m[k] === 'valor' ? 'valor' : 'qtd';
      const [label, fmt, goal] = MODE_TXT[k][MODES[k]], ind = INDICATORS.find(i => i.key === k);
      if (ind) { ind.label = label; ind.fmt = fmt; }
      DEFAULT_GOALS[k] = goal;
    } CUSTOM = list.map(c => ({ ...c, label: String(c.label).trim().slice(0, 40), fmt: c.fmt === 'money' ? 'money' : 'int' }));
    const drop = arr => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] && (arr[i].custom || (typeof arr[i] === 'string' && arr[i].startsWith('x_')))) arr.splice(i, 1); };
    drop(INDICATORS); drop(FIELDS); drop(MONTH_FIELDS); drop(SUM_KEYS);
    for (const k of Object.keys(DEFAULT_GOALS)) if (k.startsWith('x_')) delete DEFAULT_GOALS[k];
    for (const c of CUSTOM) {
      const money = c.fmt === 'money', k = c.key;
      INDICATORS.push({ key: k, label: c.label, weight: 10, fmt: money ? 'money' : 'int', custom: true, calc: s => s.n[k] ? s[k] : null });
      FIELDS.push({ key: k, label: c.label + (money ? ' (R$)' : ''), api: k, step: money ? '0.01' : '1', custom: true });
      MONTH_FIELDS.push({ key: k, label: c.label + (money ? ' (R$)' : ''), step: money ? '0.01' : '1', daily: k, custom: true });
      SUM_KEYS.push(k);
      DEFAULT_GOALS[k] = Number(c.goal) > 0 ? Number(c.goal) : 10;
    }
  }

  window.GB = Object.assign(window.GB || {}, { applyCustom, customKeys, indMode, fieldOff, MODE_TXT, RETIRED, BONUS_INDS, OCUP_DEFAULT, ocupCfgOf, ocupCfgFor, hoursPerDay, ocupCapacity, SUM_KEYS, manualEntries, manualTotal, applyManualTotal, evOk, evLive, popDefault, popCfgOf, popItemPts, popDayPts, popDayMax, popDays, validPhone, visibleInds, FIELD_IND, DB, INDICATORS, FIELDS, PERIOD_NAMES, periodRange, computeRanking, aggregate, importEntries, upsertEntry, gapTo, simulate, MONTH_FIELDS, monthRange, addMonths, monthFromIntegration, DEFAULT_GOALS, goalFor, LEVELS, levelOf, isNum, emptyState, passHash, uid, iso, fromIso, hash });
})();
