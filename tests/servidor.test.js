// Servidor (atendente IA): o contexto das ferramentas tem que ter todas as funções que elas usam.
// (Um comentário "//" no meio dessa linha já apagou registro/artes/enviarArte e fez o agendar falhar depois de marcar.)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

test('contexto da atendente IA tem registro, artes e enviarArte', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'integracoes', 'servidor', 'sofia.mjs'), 'utf8');
  const i = src.indexOf('const ctx = { ab, fone: c.fone');
  assert.ok(i > 0, 'linha do ctx não encontrada');
  const fim = src.indexOf('};', i), bloco = src.slice(i, fim);
  for (const linha of bloco.split('\n')) assert.ok(!/(^|[^:])\/\/(?!.*\*\/)/.test(linha.replace(/`[^`]*`/g, '').replace(/"[^"]*"/g, '')), 'comentário de linha dentro do ctx: ' + linha.slice(0, 80));
  for (const k of ['registro:', 'artes:', 'enviarArte:', 'falha:', 'pendencia:', 'carga:', 'fidelizacao:']) assert.ok(bloco.includes(k), 'falta ' + k);
});
