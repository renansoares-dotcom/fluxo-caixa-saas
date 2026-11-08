// Qualidade › Não Conformidades e Bloqueios (PRD014): RNC com disposição no estoque, 5 porquês e eficácia;
// lotes e bobinas bloqueados, bloqueio e liberação com histórico.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, exportXLSX, dateBR, money, debounce } from '../lib/ui.js';
import * as Q from '../lib/qualidade.js';
import { carregarQualidade, fichaRnc, novaRnc, nomeProd, nomeFav, opTxt, selo, clsRnc, clsGrav, CSS, podeRegistrar, podeDecidir, nf } from '../lib/qualidade-ui.js';

export const title = 'Não Conformidades e Bloqueios';
const ui = { aba: 'rnc', f: 'abertas', busca: '' };
let D = null;

export async function render(root) {
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">Não Conformidades e Bloqueios</h2><div class="muted small">Tratamento do que deu errado — do material (disposição) à causa (5 porquês e ação corretiva) — e o que está bloqueado.</div></div>
      <div class="ql-acoes"><button class="btn ghost" id="qr-xls">Excel</button><span id="qr-acao"></span></div></div>
    <div class="card toolbar"><div class="chips" id="qr-abas">${[['rnc', 'Não conformidades (RNC)'], ['bloq', 'Bloqueios']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
      <span class="spacer"></span><select id="qr-f" style="max-width:170px">${[['abertas', 'Em aberto'], ['vencidas', 'Ação vencida'], ['portal', 'Reclamações do Portal'], ['encerrada', 'Encerradas'], ['todas', 'Todas']].map(([k, t]) => `<option value="${k}" ${ui.f === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input id="qr-b" placeholder="Procurar" value="${esc(ui.busca)}" style="width:170px"></div>
    <div id="qr-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#qr-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; $$('#qr-abas .chip', root).forEach(c => c.classList.toggle('on', c.dataset.a === a)); pintar(root); } };
  $('#qr-f', root).onchange = (e) => { ui.f = e.target.value; pintar(root); };
  $('#qr-b', root).oninput = debounce((e) => { ui.busca = e.target.value; pintar(root); }, 200);
  $('#qr-xls', root).onclick = () => exportXLSX($('#qr-corpo table', root), ui.aba === 'rnc' ? 'nao_conformidades' : 'bloqueios');
  const ab = state.abrir?.tipo === 'rnc' ? state.abrir : null; if (ab) { delete state.abrir; ui.aba = 'rnc'; }
  try { D = await carregarQualidade(); } catch (err) { fail(err); $('#qr-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; return; }
  pintar(root);
  if (ab) { const r = D.R.find(x => x.id === ab.id); if (r) fichaRnc(D, r, { onMudou: () => render(root) }); }
}

async function pintar(root) {
  const c = $('#qr-corpo', root), b = ui.busca.trim().toLowerCase(), acao = $('#qr-acao', root), re = () => render(root);
  $('#qr-f', root).hidden = ui.aba !== 'rnc';
  if (ui.aba === 'rnc') {
    acao.innerHTML = podeRegistrar() ? '<button class="btn primary" id="qr-nova">Nova RNC</button>' : '';
    $('#qr-nova', root) && ($('#qr-nova', root).onclick = () => novaRnc(D, { onSalvo: re }));
    const L = D.R.filter(r => (ui.f === 'abertas' ? Q.RNC_ABERTAS.includes(r.situacao) : ui.f === 'vencidas' ? Q.rncVencida(r) : ui.f === 'portal' ? r.portal_visivel : ui.f === 'encerrada' ? r.situacao === 'encerrada' : true)
      && (!b || `${r.numero} ${r.descricao} ${nomeProd(D, r.produto_id)} ${nomeFav(D, r.favorecido_id)} ${r.responsavel || ''}`.toLowerCase().includes(b)));
    c.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>RNC</th><th>O que aconteceu</th><th>Disposição</th><th>Ação corretiva</th><th>Situação</th></tr></thead><tbody>
      ${L.map(r => `<tr class="clickable" data-r="${r.id}"><td><b>${r.numero}</b><div class="small muted">${dateBR(r.aberta_em.slice(0, 10))} · ${esc(Q.ORIGENS_RNC[r.origem])}</div><div>${selo(Q.GRAVIDADES[r.gravidade], clsGrav(r.gravidade))}${r.portal_visivel ? ' ' + selo('Portal', 'info') : ''}</div></td>
        <td class="wrap">${esc(r.descricao)}<div class="small muted">${esc([nomeProd(D, r.produto_id) !== '—' ? nomeProd(D, r.produto_id) : '', nomeFav(D, r.favorecido_id), r.quantidade != null ? `${nf(r.quantidade)} ${r.unidade || ''}` : ''].filter(Boolean).join(' · '))}</div></td>
        <td class="small">${esc(Q.DISPOSICOES[r.disposicao])}${r.disposicao_executada_em ? '<div class="muted">✔ executada</div>' : r.disposicao !== 'pendente' ? '<div class="muted">a executar</div>' : ''}</td>
        <td class="small wrap">${esc(r.acao_corretiva || '—')}<div class="muted">${esc(r.responsavel || '')}${r.prazo ? ' · até ' + dateBR(r.prazo) : ''}</div></td>
        <td>${selo(Q.SIT_RNC[r.situacao], clsRnc(r.situacao))}${Q.rncVencida(r) ? `<div>${selo('Vencida', 'neg')}</div>` : ''}${Q.respostaAtrasada(r) ? `<div>${selo('Resposta ao cliente atrasada', 'neg')}</div>` : r.cliente_aceite === 'nao_aceita' ? `<div>${selo('Cliente não aceitou', 'neg')}</div>` : r.portal_visivel && !r.respondida_em && Q.RNC_ABERTAS.includes(r.situacao) ? `<div>${selo('Aguardando resposta', 'warn')}</div>` : ''}${+r.custo ? `<div class="small muted">custo ${money(r.custo)}</div>` : ''}</td></tr>`).join('')
        || '<tr><td colspan="5" class="empty">Nenhuma não conformidade neste filtro.</td></tr>'}</tbody></table></div></div>`;
    c.onclick = (e) => { const r = e.target.closest('[data-r]'); if (r) fichaRnc(D, D.R.find(x => x.id === r.dataset.r), { onMudou: re }); };
    return;
  }
  acao.innerHTML = podeRegistrar() ? '<button class="btn primary" id="qr-bloq">Bloquear lote ou bobina</button>' : '';
  $('#qr-bloq', root) && ($('#qr-bloq', root).onclick = () => bloquear(re));
  const H = await q(sb.from('qual_bloqueios').select('*').eq('empresa_id', state.empresa.id).order('criado_em', { ascending: false }).limit(60)).catch(() => []);
  const lb = D.lotesBloq.filter(l => !b || `${l.codigo} ${nomeProd(D, l.produto_id)}`.toLowerCase().includes(b));
  const bb = D.bobinasBloq.filter(x => !b || `${x.codigo} ${opTxt(D, x.ordem_id)}`.toLowerCase().includes(b));
  const lib = podeDecidir(D);
  c.innerHTML = `<div class="grid2">
    <div class="card flush"><div style="padding:14px 16px 0"><h2>Lotes do estoque bloqueados (${lb.length})</h2></div><div class="table-wrap"><table><thead><tr><th>Lote</th><th>Motivo</th><th></th></tr></thead><tbody>
      ${lb.map(l => `<tr><td><b>${esc(l.codigo)}</b><div class="small muted">${esc(nomeProd(D, l.produto_id))}</div></td><td class="wrap small">${esc(l.bloqueio_motivo || '')}</td>
        <td>${lib ? `<button class="btn small" data-lib-lote="${l.id}">Liberar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Nenhum lote bloqueado.</td></tr>'}</tbody></table></div></div>
    <div class="card flush"><div style="padding:14px 16px 0"><h2>Bobinas bloqueadas ou reprovadas (${bb.length})</h2></div><div class="table-wrap"><table><thead><tr><th>Bobina</th><th class="num">Peso</th><th>Qualidade</th><th></th></tr></thead><tbody>
      ${bb.map(x => `<tr><td><b>${esc(x.codigo)}</b><div class="small muted">${esc(opTxt(D, x.ordem_id))}${x.qual_inspecao_id ? ' · aguardando a inspeção ' + (D.I.find(i => i.id === x.qual_inspecao_id)?.numero ?? '') : ''}</div></td>
        <td class="num">${nf(x.peso_kg, 1)} kg</td><td>${selo(x.qualidade === 'reprovada' ? 'Reprovada' : 'Bloqueada', x.qualidade === 'reprovada' ? 'neg' : 'warn')}</td>
        <td>${lib && x.qualidade === 'bloqueada' && !x.qual_inspecao_id ? `<button class="btn small" data-lib-bob="${x.id}">Liberar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nenhuma bobina bloqueada.</td></tr>'}</tbody></table></div></div></div>
    <div class="card flush" style="margin-top:16px"><div style="padding:14px 16px 0"><h2>Histórico</h2></div><div class="table-wrap"><table><thead><tr><th>Quando</th><th>O quê</th><th>Ação</th><th>Motivo</th><th>Quem</th></tr></thead><tbody>
      ${H.map(h => `<tr><td class="small">${new Date(h.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td>${h.tipo === 'lote' ? 'Lote' : 'Bobina'}</td>
        <td>${selo({ bloqueio: 'Bloqueio', liberacao: 'Liberação', reprovacao: 'Reprovação' }[h.acao], h.acao === 'liberacao' ? 'pos' : h.acao === 'bloqueio' ? 'warn' : 'neg')}</td><td class="wrap small">${esc(h.motivo || '')}</td><td class="small">${esc(h.usuario || '')}</td></tr>`).join('')
        || '<tr><td colspan="5" class="empty">Sem histórico.</td></tr>'}</tbody></table></div></div>
    <p class="muted small">Lote bloqueado não sai do estoque (venda, requisição, transferência); bobina bloqueada não é expedida nem consumida. A bobina presa por uma inspeção de liberação solta na decisão da inspeção.</p>`;
  const lib2 = async (tipo, id) => { try { await q(sb.rpc('qual_bloquear', { p_empresa: state.empresa.id, p_tipo: tipo, p_id: id, p_bloquear: false, p_motivo: null })); toast('Liberado'); re(); } catch (e) { fail(e); } };
  $$('[data-lib-lote]', c).forEach(x => x.onclick = () => lib2('lote', x.dataset.libLote));
  $$('[data-lib-bob]', c).forEach(x => x.onclick = () => lib2('bobina', x.dataset.libBob));
  c.onclick = null;
}

function bloquear(onFeito) {
  const md = modal({ title: 'Bloquear lote ou bobina', narrow: true, body: `<form id="bq"><div class="grid-form">
    <label class="xs">Tipo<select name="tipo"><option value="lote">Lote do estoque</option><option value="bobina">Bobina</option></select></label>
    <label class="span2">Código *<input name="cod" required placeholder="nº do lote ou da bobina"></label>
    <label class="full">Motivo *<textarea name="mot" rows="2" required placeholder="Ex.: reclamação de cliente — gel no filme (RNC 12)"></textarea></label></div></form>`,
    foot: `<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn danger" id="bq-ok">Bloquear</button>` });
  $('#bq-ok', md.el).onclick = async () => {
    const f = $('#bq', md.el); if (!f.reportValidity()) return;
    try {
      const tab = f.tipo.value === 'lote' ? 'est_lotes' : 'prod_bobinas';
      const L = await q(sb.from(tab).select('id,codigo').eq('empresa_id', state.empresa.id).eq('codigo', f.cod.value.trim()));
      if (!L.length) return toast(`${f.tipo.value === 'lote' ? 'Lote' : 'Bobina'} ${f.cod.value.trim()} não encontrado`, true);
      for (const x of L) await q(sb.rpc('qual_bloquear', { p_empresa: state.empresa.id, p_tipo: f.tipo.value, p_id: x.id, p_bloquear: true, p_motivo: f.mot.value.trim() }));
      md.close(); toast(`${L.length} bloqueado(s)`); onFeito?.();
    } catch (e) { fail(e); }
  };
}
