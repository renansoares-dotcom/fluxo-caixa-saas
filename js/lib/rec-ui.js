// Recuperadora: dados comuns das telas (parâmetros, materiais, classes, preços, fornecedores) e pedaços de interface.
import { sb, state, q } from './data.js';
import { esc } from './ui.js';
import { SIT_TICKET, SIT_LOTE } from './recuperadora.js';

export const podeOperar = () => ['admin', 'financeiro', 'diretor', 'producao'].includes(state.papel);
export const podeConfig = () => ['admin', 'financeiro', 'diretor'].includes(state.papel);
export const kpi = (rot, val, sub = '', cl = '') => `<div class="kpi"><div class="k-label">${rot}</div><div class="k-value ${cl}">${val}</div>${sub ? `<div class="k-sub">${sub}</div>` : ''}</div>`;
export const kg = (v, d = 0) => (+v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: Math.max(d, 3) }) + ' kg';
export const kg0 = (v) => Math.round(+v || 0).toLocaleString('pt-BR') + ' kg';
export const rkg = (v) => v == null ? '–' : 'R$ ' + (+v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
export const badgeTicket = (s) => { const [t, c] = SIT_TICKET[s] || [s, '']; return `<span class="badge ${c}">${t}</span>`; };
export const badgeLote = (s) => { const [t, c] = SIT_LOTE[s] || [s, '']; return `<span class="badge ${c}">${t}</span>`; };
export const semSQL = (err) => /rec_|recuperadora|schema cache|does not exist/i.test(err?.message || '');
export const avisoSQL = '<div class="card"><div class="empty">A Recuperadora precisa do SQL 151. Avise o administrador da plataforma.</div></div>';

let cache = null;
export const limparCacheRec = () => { cache = null; };
/** parâmetros e cadastros da recuperadora (cache até salvar algo nos parâmetros) */
export async function carregarRec(force = false) {
  if (cache && !force && cache.empresa === state.empresa.id) return cache;
  const e = state.empresa.id;
  const [cfg, mats, clas, precos, forn] = await Promise.all([
    q(sb.from('rec_config').select('*').eq('empresa_id', e).maybeSingle()),
    q(sb.from('rec_materiais').select('*').eq('empresa_id', e).order('codigo')),
    q(sb.from('rec_classes').select('*').eq('empresa_id', e).order('ordem').order('codigo')),
    q(sb.from('rec_precos').select('*').eq('empresa_id', e).order('vigencia', { ascending: false })),
    q(sb.from('favorecidos').select('id, nome, documento, tipo, rec_tipo, rec_coletor_incentivado, pix, ativo').eq('empresa_id', e).order('nome'))]);
  const matById = Object.fromEntries(mats.map(m => [m.id, m])), claById = Object.fromEntries(clas.map(c => [c.id, c])), fornById = Object.fromEntries(forn.map(f => [f.id, f]));
  cache = { empresa: e, cfg: cfg || { modo: 'desligado' }, mats, clas, precos, forn, matById, claById, fornById };
  return cache;
}
export const nomeMat = (R, id) => { const m = R.matById[id]; return m ? `${m.codigo} — ${m.nome}` : '—'; };
export const desligada = (R) => !R.cfg || R.cfg.modo === 'desligado';
export const avisoDesligada = () => `<div class="card"><div class="empty">A Recuperadora está desligada nesta empresa.${podeConfig() ? ' Ligue em <a href="#/recuperadora/parametros">Parâmetros da Recuperadora</a> e escolha o modo (aparas internas, compra de terceiros ou os dois).' : ' Peça a quem configura a produção para ligar o módulo.'}</div></div>`;
export const optMats = (R, sel, so = null) => R.mats.filter(m => m.ativo || m.id === sel).filter(m => !so || so(m)).map(m => `<option value="${m.id}" ${m.id === sel ? 'selected' : ''}>${esc(m.codigo)} — ${esc(m.nome)}</option>`).join('');
export const optClas = (R, sel) => `<option value="">—</option>${R.clas.filter(c => c.ativo || c.id === sel).map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.codigo)} — ${esc(c.nome)} (${String(c.desconto_padrao_pct).replace('.', ',')}%)</option>`).join('')}`;
