// Confere a sintaxe de todos os módulos JS (sem executar) e se todo import relativo aponta para um arquivo que existe.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const arquivos = [];
const andar = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? andar(p) : p.endsWith('.js') && arquivos.push(p); } };
andar('js');
let erros = 0;
for (const f of arquivos) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { erros++; console.error(`✗ sintaxe: ${f}\n${String(e.stderr)}`); }
  const src = readFileSync(f, 'utf8');
  for (const [, rel] of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"?]+)['"]/g)) {
    if (!existsSync(resolve(dirname(f), rel))) { erros++; console.error(`✗ import inexistente: ${f} → ${rel}`); }
  }
}
console.log(`${arquivos.length} módulos conferidos, ${erros} erro(s)`);
process.exit(erros ? 1 : 0);
