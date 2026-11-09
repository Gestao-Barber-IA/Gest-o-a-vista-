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
