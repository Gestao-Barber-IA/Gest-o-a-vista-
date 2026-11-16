// Testes das regras de pontuação, Destaque, MVP e níveis (js/data.js), sem navegador.
// Rodar: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGB() {
  const store = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; };
  const window = { localStorage: store(), sessionStorage: store(), location: { search: '', pathname: '/', hash: '' }, history: { replaceState() {} } };
  const ctx = vm.createContext({ window, console, Date, Math, JSON, Intl });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'data.js'), 'utf8'), ctx, { filename: 'data.js' });
  return window.GB;
}
const GB = loadGB();
const YM = '2026-10';
const R = GB.monthRange(YM);

// Equipe com totais do mês (fechamento mensal). Cada linha: [id, {campo: valor}].
function team(rows, extra = {}) {
  return {
    barbers: rows.map(([id]) => ({ id, name: id.toUpperCase(), active: true })),
    entries: [],
    monthly: rows.map(([id, d]) => ({ barberId: id, month: YM, ...d })),
    weights: Object.fromEntries(GB.INDICATORS.map(i => [i.key, i.weight])),
    hidden: [],
    ...extra,
  };
}
const byId = (res, id) => res.rows.find(r => r.barber.id === id);
const keysOf = list => Array.from(list, i => i.key).sort(); // listas vêm de outro contexto (vm)

test('nota por indicador: 1º = 100, último = 0, proporcional no meio', () => {
  const res = GB.computeRanking(team([['a', { fat: 10000 }], ['b', { fat: 5000 }], ['c', { fat: 7500 }]]), R);
  assert.equal(byId(res, 'a').scores.fat, 100);
  assert.equal(byId(res, 'b').scores.fat, 0);
  assert.equal(byId(res, 'c').scores.fat, 50);
});

test('só contam indicadores com dados no período', () => {
  const res = GB.computeRanking(team([['a', { fat: 100, serv: 10 }], ['b', { fat: 50, serv: 20 }]]), R);
  assert.deepEqual(keysOf(res.active), ['fat', 'serv']);
  assert.ok(res.inactive.some(i => i.key === 'planos' && i.reason === 'sem dados'));
});

test('pontuação geral é a média ponderada pelos pesos', () => {
  const st = team([['a', { fat: 100, serv: 10 }], ['b', { fat: 50, serv: 20 }]]);
  st.weights.fat = 3; st.weights.serv = 1;
  const res = GB.computeRanking(st, R);
  assert.equal(byId(res, 'a').overall, 75); // (3*100 + 1*0) / 4
  assert.equal(byId(res, 'b').overall, 25);
});

test('indicador oculto ou com peso zero não pontua', () => {
  const st = team([['a', { fat: 100, serv: 10 }], ['b', { fat: 50, serv: 20 }]]);
  st.hidden = ['serv'];
  let res = GB.computeRanking(st, R);
  assert.deepEqual(keysOf(res.active), ['fat']);
  st.hidden = []; st.weights.fat = 0;
  res = GB.computeRanking(st, R);
  assert.deepEqual(keysOf(res.active), ['serv']);
});

test('MVP: lidera metade + 1 dos indicadores', () => {
  // 4 indicadores ativos (fat, cli, serv, ticket): metade = 2, MVP = 3.
  const res = GB.computeRanking(team([['a', { fat: 900, cli: 30, serv: 40 }], ['b', { fat: 800, cli: 10, serv: 20 }]]), R);
  assert.equal(res.N, 4);
  assert.equal(res.title.type, 'mvp');
  assert.equal(res.title.barberId, 'a');
});

test('Destaque: lidera metade (arredondada para cima), sem chegar ao MVP', () => {
  // 5 indicadores ativos (fat, cli, serv, ticket, planos): metade = 3, MVP = 4. a lidera fat, cli e serv.
  const res = GB.computeRanking(team([['a', { fat: 1000, cli: 20, serv: 50 }], ['b', { fat: 900, cli: 10, serv: 30, planos: 5 }]]), R);
  assert.equal(res.N, 5);
  assert.equal(byId(res, 'a').leads.length, 3);
  assert.equal(res.title.type, 'destaque');
  assert.equal(res.title.barberId, 'a');
});

test('sem título quando ninguém lidera metade dos indicadores', () => {
  // 4 indicadores (fat, cli, serv, ticket), metade = 2: cada profissional lidera só 1.
  const res = GB.computeRanking(team([
    ['a', { fat: 1000, cli: 10, serv: 10 }],
    ['b', { fat: 500, cli: 40, serv: 10 }],
    ['c', { fat: 600, cli: 30, serv: 30 }],
    ['d', { fat: 900, cli: 5, serv: 5 }],
  ]), R);
  assert.equal(res.N, 4);
  assert.deepEqual(res.rows.map(r => r.leads.length).sort().join(), '1,1,1,1');
  assert.equal(res.title.type, null);
});

test('empate no 1º lugar conta como liderança para todos os empatados', () => {
  const res = GB.computeRanking(team([['a', { fat: 500, serv: 10 }], ['b', { fat: 500, serv: 5 }]]), R);
  const fat = res.active.find(i => i.key === 'fat');
  assert.deepEqual(Array.from(fat.leaders).sort(), ['a', 'b']);
});

test('quem tem o título fica em 1º no ranking, mesmo com pontuação menor', () => {
  // a lidera 3 de 5 (fat, cli, serv) por pouco; b vence ticket e planos com folga.
  const st = team([['a', { fat: 1010, cli: 21, serv: 21, planos: 0 }], ['b', { fat: 1000, cli: 20, serv: 20, planos: 9 }]]);
  st.weights.planos = 200;
  const res = GB.computeRanking(st, R);
  assert.equal(res.title.barberId, 'a');
  assert.ok(byId(res, 'b').overall > byId(res, 'a').overall);
  assert.equal(res.rows[0].barber.id, 'a');
  assert.equal(byId(res, 'a').pos, 1);
});

test('profissional desligado não entra no ranking', () => {
  const st = team([['a', { fat: 100 }], ['b', { fat: 50 }]]);
  st.barbers[1].active = false;
  const res = GB.computeRanking(st, R);
  assert.deepEqual(res.rows.map(r => r.barber.id), ['a']);
});

test('total do mês substitui os lançamentos diários do mesmo campo', () => {
  const st = team([['a', { fat: 3000 }], ['b', { fat: 1000 }]]);
  st.entries = [{ id: 'e1', barberId: 'a', date: '2026-10-05', fat: 999999 }];
  const res = GB.computeRanking(st, R);
  assert.equal(byId(res, 'a').values.fat, 3000);
});

test('níveis de carreira: Bronze < 70 ≤ Prata < 85 ≤ Ouro < 95 ≤ Diamante', () => {
  assert.equal(GB.levelOf(69.9).name, 'Bronze');
  assert.equal(GB.levelOf(70).name, 'Prata');
  assert.equal(GB.levelOf(85).name, 'Ouro');
  assert.equal(GB.levelOf(95).name, 'Diamante');
  assert.equal(GB.levelOf(80).next, 'Ouro');
  assert.equal(GB.levelOf(80).need, 5);
});

test('horário de chegada: só "no horário combinado" vale pontos', () => {
  const it = { id: 'chegada', type: 'check', target: 1, pts: 3 };
  const ok = { status: 'aprovado', noPhoto: true };
  assert.equal(GB.popItemPts(it, [{ ...ok, arr: 'ok' }]), 3);
  assert.equal(GB.popItemPts(it, [ok]), 3);
  assert.equal(GB.popItemPts(it, [{ ...ok, arr: 'apos' }]), 0);
  assert.equal(GB.popItemPts(it, [{ ...ok, arr: 'atraso' }]), 0);
});

test('indicador personalizado entra na nota e some ao ser desativado', () => {
  const custom = [{ key: 'x_google1', label: 'Avaliações no Google', fmt: 'int', goal: 20 }];
  const st = team([['a', { fat: 100 }], ['b', { fat: 100 }]], { customInds: custom });
  st.entries = [{ id: 'm1', barberId: 'a', date: '2026-10-05', source: 'manual', x_google1: 12 }, { id: 'm2', barberId: 'b', date: '2026-10-06', source: 'manual', x_google1: 3 }];
  st.weights = { fat: 50, x_google1: 50 }; st.hidden = GB.INDICATORS.filter(i => !['fat', 'x_google1'].includes(i.key)).map(i => i.key);
  let res = GB.computeRanking(st, R);
  assert.equal(byId(res, 'a').values.x_google1, 12);
  assert.ok(byId(res, 'a').overall > byId(res, 'b').overall);
  st.hidden.push('x_google1');
  res = GB.computeRanking(st, R);
  assert.equal(byId(res, 'a').overall, byId(res, 'b').overall);
  // Sem personalizados, as listas voltam ao padrão.
  GB.computeRanking(team([['a', { fat: 1 }], ['b', { fat: 2 }]]), R);
  assert.ok(!GB.INDICATORS.some(i => i.custom) && !GB.FIELDS.some(f => f.custom) && !GB.SUM_KEYS.includes('x_google1'));
});

test('serviços e produtos: por valor em R$ quando o dono escolhe', () => {
  const st = team([['a', { serv: 10, servV: 300, prod: 5, prodV: 50 }], ['b', { serv: 20, servV: 200, prod: 1, prodV: 90 }]], { indMode: { serv: 'valor', prod: 'valor' } });
  let res = GB.computeRanking(st, R);
  assert.equal(byId(res, 'a').values.serv, 300);
  assert.equal(byId(res, 'b').values.prod, 90);
  assert.equal(GB.INDICATORS.find(i => i.key === 'serv').fmt, 'money');
  st.indMode = {};
  res = GB.computeRanking(st, R);
  assert.equal(byId(res, 'a').values.serv, 10);
  assert.equal(GB.INDICATORS.find(i => i.key === 'serv').label, 'Serviços realizados');
});

test('checklist: pontos acrescentados (adj) somam aos do dia, sem apagar os atuais', () => {
  const st = team([['a', {}], ['b', {}]]);
  st.pop = [
    { barberId: 'a', day: '2026-10-01', ev: {}, adj: 35 },
    { barberId: 'a', day: '2026-10-13', ev: { stories: [{ status: 'aprovado' }] } },
    { barberId: 'b', day: '2026-10-01', ev: {}, adj: 8 },
  ];
  const sA = GB.aggregate(st, 'a', R), sB = GB.aggregate(st, 'b', R);
  const one = GB.popItemPts(GB.popCfgOf(st).items.find(i => i.id === 'stories'), [{ status: 'aprovado' }]);
  assert.equal(Math.round(sA.check * 10) / 10, Math.round((35 + one) * 10) / 10);
  assert.equal(sB.check, 8);
});

test('serviços extras: conta só o que não foi marcado como tradicional', () => {
  const st = team([['a', {}], ['b', {}]], { extraInit: true, extraTrad: ['Corte Tradicional', 'barba'] });
  st.hidden = [];
  st.entries = [
    { id: 'a1', barberId: 'a', date: '2026-10-05', source: 'api', svc: { 'Corte Tradicional': [3, 150], 'Barba': [2, 70], 'Sobrancelha (No Combo)': [2, 30], 'Pigmentação na Barba': [1, 60] } },
    { id: 'b1', barberId: 'b', date: '2026-10-05', source: 'api', svc: { 'Corte Tradicional': [5, 250] } },
  ];
  const a = GB.aggregate(st, 'a', R), b = GB.aggregate(st, 'b', R);
  assert.equal(a.extra, 3); assert.equal(a.extraV, 90);
  assert.equal(b.extra, 0);
  st.indMode = { extra: 'valor' };
  assert.equal(byId(GB.computeRanking(st, R), 'a').values.extra, 90);
  // Empresa que ainda não viu o indicador: começa desligado.
  const novo = team([['a', {}], ['b', {}]]); GB.computeRanking(novo, R);
  assert.ok(novo.hidden.includes('extra') && novo.extraInit);
});

test('serviços extras: combo com extra conta 1 e, no valor, só a diferença para o serviço de base', () => {
  const st = team([['a', {}], ['b', {}]], { extraInit: true, extraTrad: ['1.1 Corte Tradicional'], extraCombo: { '1.2 Corte Tradicional & Sobrancelha': '' } });
  st.hidden = [];
  st.entries = [
    { id: 'a1', barberId: 'a', date: '2026-10-05', source: 'api', svc: { '1.1 Corte Tradicional': [4, 200], '1.2 Corte Tradicional & Sobrancelha': [2, 130] } },
    { id: 'b1', barberId: 'b', date: '2026-10-05', source: 'api', svc: { '1.1 Corte Tradicional': [1, 50] } },
  ];
  assert.equal(GB.comboBase(st, '1.2 Corte Tradicional & Sobrancelha'), '1.1 Corte Tradicional');
  const a = GB.aggregate(st, 'a', R);
  assert.equal(a.extra, 2);       // 2 combos = 2 extras
  assert.equal(a.extraV, 30);     // 130 - 2 × 50 (preço médio do corte)
});

test('maior comanda: dia com disponibilidade alterada/compromisso não atendido não vale para o destaque', () => {
  const st = team([['a', {}], ['b', {}]]);
  st.entries = [
    { id: 'a1', barberId: 'a', date: '2026-10-05', source: 'api', comanda: 400 },
    { id: 'a2', barberId: 'a', date: '2026-10-06', source: 'api', comanda: 150 },
    { id: 'b1', barberId: 'b', date: '2026-10-05', source: 'api', comanda: 200 },
  ];
  st.pop = [{ barberId: 'a', day: '2026-10-05', ev: { chegada: [{ status: 'aprovado', arr: 'atraso' }] } }];
  const a = GB.aggregate(st, 'a', R);
  assert.equal(a.comanda, 150); assert.equal(a.comandaOff, 400);
  const res = GB.computeRanking(st, R), top = res.bonus.find(i => i.key === 'comanda');
  assert.equal(top.leaders.join(','), 'b');
});

test('retenção de antigos e fidelização de novos: % que voltou, com amostra mínima', () => {
  const st = team([['a', {}], ['b', {}]], { retInit: true });
  st.hidden = [];
  st.entries = [
    { id: 'a1', barberId: 'a', date: '2026-10-10', source: 'api', raB: 12, raV: 9, fnB: 6, fnV: 3 },
    { id: 'b1', barberId: 'b', date: '2026-10-10', source: 'api', raB: 8, raV: 8, fnB: 2, fnV: 2 },
  ];
  const res = GB.computeRanking(st, R), a = byId(res, 'a'), b = byId(res, 'b');
  assert.equal(a.values.retAnt, 75); assert.equal(a.values.fidNov, 50);
  assert.equal(b.values.retAnt ?? null, null); // menos de 10 antigos: sem dados
  const novo = team([['a', {}], ['b', {}]]); GB.computeRanking(novo, R);
  assert.ok(novo.hidden.includes('retAnt') && novo.hidden.includes('fidNov'));
});

test('checklist: nível e ranking pela média de pontos por dia trabalhado', () => {
  const st = team([['a', {}], ['b', {}]]);
  st.weights = { check: 100 }; st.hidden = GB.INDICATORS.filter(i => i.key !== 'check').map(i => i.key);
  const full = { status: 'aprovado' };
  // a: 2 dias com 3 pts cada; b: 1 dia com 3 pts + 10 pts trazidos cobrindo 4 dias.
  st.pop = [
    { barberId: 'a', day: '2026-10-05', ev: { google: [full, full, full] } },
    { barberId: 'a', day: '2026-10-06', ev: { google: [full, full, full] } },
    { barberId: 'b', day: '2026-10-01', ev: {}, adj: 10, adjDays: 4 },
    { barberId: 'b', day: '2026-10-07', ev: { google: [full, full, full] } },
  ];
  const res = GB.computeRanking(st, R);
  assert.equal(byId(res, 'a').values.check, 3);
  assert.equal(byId(res, 'b').values.check, 13 / 5);
  assert.equal(GB.INDICATORS.find(i => i.key === 'check').fmt, 'dec1');
  // Meta antiga em total do mês vira pontos por dia.
  st.goals = { team: { check: 390 } };
  assert.equal(GB.goalFor(st, 'a', 'check'), 20.5);
});

test('checklist: item retirado vale só antes da data; item novo só a partir dela', () => {
  const cfg = GB.popCfgOf({});
  const ids = d => Array.from(GB.popItemsFor(cfg, d), i => i.id).join(',');
  assert.ok(ids('2026-11-15').includes('estrat') && !ids('2026-11-15').includes('retorno'));
  assert.ok(!ids('2026-11-16').includes('estrat') && ids('2026-11-16').includes('retorno'));
  assert.equal(GB.popDayMax(cfg, '2026-11-16'), 24);
  const rec = { day: '2026-11-13', ev: { estrat: [{ status: 'aprovado' }, { status: 'aprovado' }, { status: 'aprovado' }] } };
  assert.equal(GB.popDayPts(cfg, rec), 2);
});
