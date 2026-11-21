// Padrão de relatórios, fase 1 (SQL 174): variantes — conjuntos de filtros salvos com nome, em qualquer tela.
// Botão "Filtros salvos" no alto da tela: aplica uma variante ou salva os filtros atuais. A variante aplicada sai impressa no relatório.
import { sb, state, q } from './data.js';
import { $, $$, esc, toast, fail, modal, confirmDialog } from './ui.js';
import { codigoDa } from './telas.js';
import { capturarFiltros, aplicarFiltros, marcarVariante } from './relatorio-filtros.js';
import { rotaAtual } from './relatorio-emissao.js';
import { parametros } from './relatorio-padrao.js';

const gerencia = () => ['admin', 'diretor'].includes(state.papel);
/** lista "Rótulo: valor" dos parâmetros, em uma linha */
export const resumoParametros = (P, max = 99) => { const L = parametros(P); return L.slice(0, max).map(([r, v]) => `${r}: ${v}`).join(' · ') + (L.length > max ? ` · +${L.length - max}` : ''); };

export async function abrirVariantes() {
  const rota = rotaAtual(), cap = capturarFiltros();
  const filtrosTela = cap.parametros.filter(([r]) => r !== 'Ano de trabalho');
  let L = [], cfg = null;
  try {
    [L, cfg] = await Promise.all([q(sb.from('relp_variantes').select('*').eq('empresa_id', state.empresa.id).eq('rota', rota).order('nome')),
      q(sb.from('relp_config').select('*').eq('empresa_id', state.empresa.id).maybeSingle())]);
  } catch (err) { return toast(/relp_/.test(err?.message || '') ? 'Os filtros salvos precisam do SQL 174.' : 'Não foi possível carregar os filtros salvos', true); }
  const podePublicar = gerencia() || cfg?.variante_publica === 'todos';
  const m = modal({ title: 'Filtros salvos desta tela', body: `
    <p class="small muted" style="margin-top:0">Uma variante guarda os filtros da tela com um nome. Ao aplicar, a tela volta para esses filtros e o nome da variante sai impresso no relatório.</p>
    <div class="table-wrap"><table><thead><tr><th>Variante</th><th>Filtros</th><th>De quem</th><th></th></tr></thead><tbody>
    ${L.map(v => `<tr><td><b>${esc(v.nome)}</b>${v.publica ? ' <span class="badge">da empresa</span>' : ''}</td><td class="small wrap">${esc(resumoParametros(v.parametros, 6))}</td><td class="small">${esc(v.usuario_nome || '')}</td>
      <td style="white-space:nowrap"><button class="btn small primary" data-ap="${v.id}">Aplicar</button>${v.usuario_id === state.user.id || gerencia() ? ` <button class="btn small ghost" data-del="${v.id}" title="Excluir">✕</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="4" class="empty">Nenhuma variante nesta tela ainda.</td></tr>'}</tbody></table></div>
    <h3 style="margin:16px 0 6px">Salvar os filtros atuais</h3>
    ${filtrosTela.length ? `<p class="small" style="margin:0 0 8px">${esc(resumoParametros(filtrosTela))}</p>
      <div class="grid2"><label>Nome da variante<input id="vr-nome" maxlength="60" placeholder="ex.: Mensal – todos os locais"></label>
      ${podePublicar ? '<label style="display:flex;flex-direction:row;align-items:center;gap:8px;align-self:end;padding-bottom:10px"><input type="checkbox" id="vr-pub" style="width:auto;margin:0"> Disponível para toda a empresa</label>' : '<div class="small muted" style="align-self:end;padding-bottom:10px">Só você vê esta variante.</div>'}</div>`
      : '<p class="small muted">Esta tela não tem filtros para salvar.</p>'}`,
    foot: `<a class="btn ghost" href="#/relatorios/emitidos" data-close>Relatórios emitidos</a><span class="spacer"></span><button class="btn" data-close>Fechar</button>${filtrosTela.length ? '<button class="btn primary" id="vr-ok">Salvar variante</button>' : ''}` });
  $$('[data-ap]', m.el).forEach(b => b.onclick = async () => {
    const v = L.find(x => x.id === b.dataset.ap); m.close();
    const r = await aplicarFiltros(v.filtros); marcarVariante(rota, v.nome, capturarFiltros().estado);
    toast(r.faltaram.length ? `Variante "${v.nome}": ${r.faltaram.length} filtro(s) não existe(m) mais nesta tela. Confira.` : `Variante "${v.nome}" aplicada`, !!r.faltaram.length);
  });
  $$('[data-del]', m.el).forEach(b => b.onclick = async () => {
    if (!await confirmDialog('Excluir esta variante?')) return;
    try { await q(sb.rpc('relp_variante_excluir', { p_id: b.dataset.del })); toast('Variante excluída'); m.close(); abrirVariantes(); } catch (err) { fail(err); }
  });
  $('#vr-ok', m.el) && ($('#vr-ok', m.el).onclick = async (ev) => {
    const nome = $('#vr-nome', m.el).value.trim(); if (nome.length < 2) return toast('Dê um nome à variante', true);
    ev.target.disabled = true;
    try {
      await q(sb.rpc('relp_variante_salvar', { p_empresa: state.empresa.id, p_id: null, p_tela: codigoDa(rota) || '', p_rota: rota, p_nome: nome, p_filtros: cap.estado, p_parametros: filtrosTela, p_publica: !!$('#vr-pub', m.el)?.checked }));
      marcarVariante(rota, nome, cap.estado); toast('Variante salva'); m.close();
    } catch (err) { fail(err); ev.target.disabled = false; }
  });
}
