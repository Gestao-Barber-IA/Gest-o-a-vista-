/* Gestão Barber IA — dados, períodos e regras de pontuação.
   Nesta versão tudo fica salvo no navegador (localStorage). A camada `DB`
   foi isolada para ser trocada por um servidor (ex.: Supabase) sem mexer na tela. */
(function () {
  'use strict';

  const KEY = 'gbia.v1';
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
    { key: 'check', label: 'Checklist POP', weight: 15, fmt: 'int',
      calc: s => s.n.check ? s.check : null },
    { key: 'ocup', label: 'Taxa de ocupação', weight: 10, fmt: 'pct',
      calc: s => s.n.hDisp && s.hDisp > 0 ? (s.hOcup / s.hDisp) * 100 : null },
    { key: 'ticket', label: 'Ticket médio', weight: 10, fmt: 'money2',
      calc: s => s.n.fat && s.cli > 0 ? s.fat / s.cli : null },
    { key: 'serv', label: 'Serviços realizados', weight: 9, fmt: 'int',
      calc: s => s.n.serv ? s.serv : null },
    { key: 'cli', label: 'Clientes atendidos', weight: 6, fmt: 'int',
      calc: s => s.n.cli ? s.cli : null },
    { key: 'planos', label: 'Planos mensais', weight: 10, fmt: 'int',
      calc: s => s.n.planos ? s.planos : null },
    { key: 'fid', label: 'Taxa de fidelização', weight: 10, fmt: 'pct',
      calc: s => s.n.ret && s.cli > 0 ? (s.ret / s.cli) * 100 : null },
    { key: 'prod', label: 'Venda de produtos', weight: 8, fmt: 'money',
      calc: s => s.n.prod ? s.prod : null },
  ];

  // Campos que o gestor (ou a API) lança por barbeiro e por dia.
  const FIELDS = [
    { key: 'fat', label: 'Faturamento (R$)', api: 'faturamento', step: '0.01' },
    { key: 'serv', label: 'Serviços realizados', api: 'servicos', step: '1' },
    { key: 'cli', label: 'Clientes atendidos', api: 'clientes', step: '1' },
    { key: 'check', label: 'Checklist POP (pontos)', api: 'checklist_pop', step: '1' },
    { key: 'hDisp', label: 'Horas disponíveis', api: 'horas_disponiveis', step: '0.5' },
    { key: 'hOcup', label: 'Horas ocupadas', api: 'horas_ocupadas', step: '0.5' },
    { key: 'planos', label: 'Planos mensais vendidos', api: 'planos_mensais', step: '1' },
    { key: 'ret', label: 'Clientes que voltaram', api: 'clientes_retorno', step: '1' },
    { key: 'prod', label: 'Venda de produtos (R$)', api: 'venda_produtos', step: '0.01' },
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
  function aggregate(entries, barberId, range) {
    const s = { fat: 0, serv: 0, cli: 0, check: 0, hDisp: 0, hOcup: 0, planos: 0, ret: 0, prod: 0, n: {} };
    for (const e of entries) {
      if (e.barberId !== barberId || e.date < range.start || e.date > range.end) continue;
      for (const f of FIELDS) {
        const v = e[f.key];
        if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) continue;
        s[f.key] += Number(v);
        s.n[f.key] = (s.n[f.key] || 0) + 1;
      }
    }
    return s;
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
    const barbers = state.barbers.filter(b => b.active !== false);
    const weights = state.weights || {};
    const rows = barbers.map(b => ({ barber: b, sums: aggregate(state.entries, b.id, range), values: {}, ranks: {}, scores: {}, leads: [], overall: 0 }));

    const active = [], inactive = [];
    for (const ind of INDICATORS) {
      const w = weights[ind.key] ?? ind.weight;
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

    const totalW = active.reduce((a, i) => a + i.weight, 0);
    for (const r of rows) {
      r.overall = totalW ? active.reduce((a, i) => a + i.weight * r.scores[i.key], 0) / totalW : 0;
    }

    const N = active.length;
    const half = Math.ceil(N / 2);
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

    return { rows, active, inactive, N, half, mvpNeed, title, range };
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
    if (has('ocup') && v.ocup != null) search('ocup', 0, Math.max(0.1, 100 - v.ocup), 0.1, d => ({ ocup: v.ocup + d }));
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

  function demoState() {
    const r = rng(20261105);
    const people = [
      ['Rafael Lima', 1.25, 1.05, 0.9], ['Diego Moura', 1.0, 1.2, 0.95], ['Thiago Alves', 1.05, 0.95, 1.0],
      ['Bruno Rocha', 0.85, 1.15, 0.7], ['Caio Ferreira', 0.95, 0.9, 0.8], ['Mateus Pinto', 0.8, 1.0, 0.75],
      ['Júlia Ramos', 0.65, 1.1, 0.6],
    ];
    const barbers = people.map(([name]) => ({ id: uid('b_'), name, photo: null, active: true }));
    const entries = [];
    const today = new Date();
    for (let d = 100; d >= 0; d--) {
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - d);
      if (day.getDay() === 0) continue; // domingo fechado
      people.forEach(([, vol, price, disc], i) => {
        if (r() < 0.12) return; // folga
        const cli = Math.max(1, Math.round((3 + r() * 4) * vol));
        const serv = cli + Math.round(r() * 2 * vol);
        const fat = Math.round(serv * (34 + r() * 18) * price * 100) / 100;
        const hDisp = 8;
        const hOcup = Math.min(hDisp, Math.round(serv * (0.45 + r() * 0.2) * 2) / 2);
        entries.push({
          id: uid('e_'), barberId: barbers[i].id, date: iso(day),
          fat, serv, cli, hDisp, hOcup,
          check: r() < 0.55 + disc * 0.35 ? 1 : 0,
          planos: r() < 0.06 * vol ? 1 : 0,
          prod: r() < 0.3 ? Math.round((20 + r() * 60) * 100) / 100 : 0,
          ret: null,
        });
      });
    }
    const gestorId = uid('u_');
    return {
      version: 1,
      demo: true,
      company: { name: 'Barbearia Demonstração', cnpj: '00.000.000/0001-00', phone: '(11) 90000-0000', email: 'gestor@demo.com', logo: null },
      users: [
        { id: gestorId, name: 'Gestor Demo', email: 'gestor@demo.com', pass: passHash('gestor@demo.com', 'demo123'), role: 'gestor', status: 'ativo', barberId: null },
        { id: uid('u_'), name: 'Diego Moura', email: 'barbeiro@demo.com', pass: passHash('barbeiro@demo.com', 'demo123'), role: 'barbeiro', status: 'ativo', barberId: barbers[1].id },
        { id: uid('u_'), name: 'Caio Ferreira', email: 'caio@demo.com', pass: passHash('caio@demo.com', 'demo123'), role: 'barbeiro', status: 'pendente', barberId: barbers[4].id },
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
      version: 1, demo: false, company, users: [gestor], invites: [], barbers: [], entries: [],
      weights: Object.fromEntries(INDICATORS.map(i => [i.key, i.weight])),
      apiKey: 'gbia_' + hash(String(Date.now())) + hash('k' + Math.random()),
    };
  }

  // ---------- persistência ----------
  const DB = {
    load() {
      const raw = safeGet('localStorage', KEY);
      if (raw) { try { return JSON.parse(raw); } catch (e) { /* recria abaixo */ } }
      const s = demoState();
      DB.save(s);
      return s;
    },
    save(s) { safeSet('localStorage', KEY, JSON.stringify(s)); },
    reset() { const s = demoState(); DB.save(s); return s; },
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
      const entry = { barberId: b.id, date };
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
    const i = state.entries.findIndex(e => e.barberId === entry.barberId && e.date === entry.date);
    if (i >= 0) state.entries[i] = { ...state.entries[i], ...entry };
    else state.entries.push({ id: uid('e_'), ...entry });
  }

  window.GB = Object.assign(window.GB || {}, { DB, INDICATORS, FIELDS, PERIOD_NAMES, periodRange, computeRanking, aggregate, importEntries, upsertEntry, gapTo, simulate, emptyState, passHash, uid, iso, fromIso, hash });
})();
