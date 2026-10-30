// Identidade visual da empresa (Cadastros › Empresa — SQL 066): cores, logos e nome nos documentos.
// carregada ao entrar na empresa; aplica as cores na plataforma, o logo no menu e nos relatórios, e o nome no cabeçalho.
import { sb, state } from './data.js';
import { definirLogo } from './ui.js';
import { definirEmpresaRel, EMPRESA_PADRAO } from './relatorio-base.js';

export const BUCKET = 'empresa';
const urls = new Map();   // caminho → blob: URL (arquivo baixado uma vez por sessão)

/** baixa um arquivo do espaço "empresa" e devolve uma URL local (blob:), que serve para <img>, canvas e PDF */
export async function urlArquivo(path) {
  if (!path) return null;
  if (urls.has(path)) return urls.get(path);
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  const u = URL.createObjectURL(data); urls.set(path, u); return u;
}
export const esquecerArquivo = (path) => { const u = urls.get(path); if (u) { URL.revokeObjectURL(u); urls.delete(path); } };

const hex = (c) => /^#[0-9a-f]{6}$/i.test(c || '') ? c : null;
/** mistura a cor com branco (p > 0) ou preto (p < 0): tons claros para fundos */
export function tom(c, p) {
  const n = parseInt(c.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const f = (x) => Math.round(p >= 0 ? x + (255 - x) * p : x * (1 + p));
  return '#' + [f(r), f(g), f(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function carregarIdentidade(empresaId = state.empresa?.id) {
  state.identidade = null;
  try {
    const { data, error } = await sb.from('empresa_identidade').select('*').eq('empresa_id', empresaId).maybeSingle();
    if (!error) state.identidade = data || null;
  } catch { /* SQL 066 ainda não rodou: segue com o padrão */ }
  await aplicarIdentidade();
  return state.identidade;
}

/** aplica a identidade na plataforma (cores, logo do menu) e nos relatórios (logo e nome) */
export async function aplicarIdentidade(i = state.identidade) {
  const p = hex(i?.cor_primaria), s = hex(i?.cor_secundaria), d = hex(i?.cor_destaque);
  // só no tema claro: no escuro a plataforma mantém as cores próprias (contraste)
  const vars = [['--primary', p], ['--brand-blue', p], ['--primary-soft', p && tom(p, 0.88)], ['--brand-navy', s], ['--brand-cyan', d]].filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join(';');
  let st = document.getElementById('identidade-css');
  if (!st) { st = document.createElement('style'); st.id = 'identidade-css'; document.head.appendChild(st); }
  st.textContent = vars ? `@media (prefers-color-scheme: light){:root:not([data-theme="dark"]){${vars}}} :root[data-theme="light"]{${vars}}` : '';
  definirEmpresaRel(i?.razao_documentos || EMPRESA_PADRAO);
  const [claro, escuro] = await Promise.all([urlArquivo(i?.logo_path), urlArquivo(i?.logo_escuro_path)]);
  definirLogo(claro || null);
  document.querySelectorAll('.brand-logo img.logo-light').forEach(img => { img.dataset.padrao ||= img.getAttribute('src'); img.src = claro || img.dataset.padrao; });
  document.querySelectorAll('.brand-logo img.logo-dark').forEach(img => { img.dataset.padrao ||= img.getAttribute('src'); img.src = escuro || claro || img.dataset.padrao; });
}
