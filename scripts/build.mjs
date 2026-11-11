// Gera a pasta dist para publicar (Vercel): copia o site e embaralha o JavaScript do app
// (sem comentários, sem espaços e com nomes internos trocados). O código original fica só no repositório.
import { cp, mkdir, readFile, rm, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { minify } from 'terser';

const OUT = 'dist';
const SKIP = new Set(['.git', '.github', 'node_modules', 'dist', 'tests', 'scripts', 'supabase', 'integracoes', 'docs', 'package.json', 'package-lock.json', 'vercel.json', 'README.md']);
const JS = ['js/app.js', 'js/data.js', 'js/cloud.js', 'js/icons.js', 'js/updates.js', 'js/config.js', 'sw.js'];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT);
for (const name of await readdir('.')) if (!SKIP.has(name)) await cp(name, join(OUT, name), { recursive: true });
// Sincronizador AppBarber: publicado para o instalador baixar (sem chaves; o config.json fica só no computador da barbearia).
await mkdir(join(OUT, 'integracoes/appbarber'), { recursive: true });
for (const f of ['sincronizar.mjs', 'instalar.bat', 'sincronizar.bat', 'testar.bat']) await cp(join('integracoes/appbarber', f), join(OUT, 'integracoes/appbarber', f));

for (const f of JS) {
  const src = await readFile(f, 'utf8');
  const r = await minify(src, { ecma: 2020, compress: { passes: 2 }, mangle: true, format: { comments: false } });
  if (!r.code) throw new Error('Falha ao embaralhar ' + f);
  await writeFile(join(OUT, f), r.code);
  console.log(`${f}: ${src.length} → ${r.code.length} bytes`);
}
// CSS sem comentários nem espaços extras.
const css = await readFile('css/styles.css', 'utf8');
await writeFile(join(OUT, 'css/styles.css'), css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '\n').replace(/\n+/g, '\n'));
console.log('Pronto: pasta dist gerada.');
