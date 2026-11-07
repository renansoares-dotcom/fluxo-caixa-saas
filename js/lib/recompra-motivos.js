// Motivos da recompra (SQL 094): cadastro configurável. Cada motivo decide o que acontece com o título, o que é exigido,
// a linha na DRE Gerencial e a contrapartida contábil. Usado pela tela Recompras (FIN021).
import { sb, q, fetchAll } from './data.js';
import { $, $$, esc, toast, fail, modal, confirmDialog } from './ui.js';

export const ACOES = {
  reabrir: 'Volta para a carteira, em aberto',
  baixar: 'Não volta (devolução); parcial: volta o saldo',
  substituir: 'Trocado por outro título cedido',
  recebido: 'Já recebido pela empresa (vincula o recebimento)',
  nenhum: 'Não volta (ajuste com o fundo)',
};
export const SECOES = {
  receita_bruta: 'Deduções da receita bruta',
  despesas_financeiras: 'Despesas financeiras',
  nao_operacionais: 'Movimentos não operacionais',
  fora: 'Fora da DRE (ajuste com o fundo)',
};
export const CONTAB = {
  plano: 'De-para da 2.07.11 (padrão)',
  cliente: 'Conta do cliente (duplicatas a receber)',
  conta: 'Conta contábil escolhida',
};
// cor de cada motivo nos gráficos e etiquetas (pela ordem)
export const corMotivo = (i) => ['#c2410c', '#7c3aed', '#0e7490', '#ca8a04', '#15803d', '#1d4ed8', '#64748b', '#be185d'][i % 8];

export const carregarMotivos = (e) => q(sb.from('fidc_recompra_motivos').select('*').eq('empresa_id', e).order('ordem').order('nome'));

const exige = (m) => [m.exige_nota && 'nota de devolução', (m.exige_substituto || m.titulo_acao === 'substituir') && 'título substituto',
  m.titulo_acao === 'recebido' && 'recebimento', m.exige_obs && 'observação', m.permite_parcial && 'aceita valor parcial'].filter(Boolean).join(' · ');

/** lista dos motivos com editar, novo, ativar/desativar e restaurar padrões */
export async function motivosModal(e, podeEditar, depois) {
  let M = await carregarMotivos(e).catch(err => { fail(err); return null; }); if (!M) return;
  const m = modal({ title: 'Motivos da recompra', wide: true, body: '<div id="rm-l"></div>',
    foot: `${podeEditar ? '<button class="btn ghost" id="rm-pad" title="Cria de novo os motivos padrão que faltarem (não altera os seus)">Restaurar padrões</button><span class="spacer" style="flex:1"></span><button class="btn primary" id="rm-novo">Novo motivo</button>' : ''}<button class="btn" data-close>Fechar</button>` });
  const pintar = () => {
    $('#rm-l', m.el).innerHTML = `<p class="small muted" style="margin-top:0">O motivo decide o que acontece com o título, a linha da recompra na DRE Gerencial e a contrapartida no motor contábil. No fluxo de caixa a recompra continua na 2.07.11.</p>
      <div class="table-wrap"><table><thead><tr><th>Motivo</th><th>O título</th><th>DRE Gerencial</th><th>Contabilidade</th><th>Exige</th><th></th></tr></thead><tbody>
      ${M.map((x, i) => `<tr class="${x.ativo ? '' : 'muted'}"><td class="wrap"><span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${corMotivo(i)};margin-right:6px"></span><b>${esc(x.nome)}</b>${x.ativo ? '' : ' <span class="badge">desativado</span>'}<div class="small muted">${esc(x.descricao || '')}</div></td>
        <td class="small wrap">${esc(ACOES[x.titulo_acao])}</td><td class="small wrap">${esc(SECOES[x.dre_secao])}${x.dre_secao !== 'fora' && x.dre_rotulo ? `<div class="muted">${esc(x.dre_rotulo)}</div>` : ''}</td>
        <td class="small wrap">${esc(CONTAB[x.contab_modo])}</td><td class="small wrap">${esc(exige(x)) || '—'}</td>
        <td>${podeEditar ? `<button class="btn ghost small" data-ed="${x.id}">Editar</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
    $$('[data-ed]', m.el).forEach(b => b.onclick = () => editar(e, M.find(x => x.id === b.dataset.ed), recarregar));
  };
  const recarregar = async () => { M = await carregarMotivos(e); pintar(); depois?.(); };
  pintar();
  $('#rm-novo', m.el) && ($('#rm-novo', m.el).onclick = () => editar(e, null, recarregar));
  $('#rm-pad', m.el) && ($('#rm-pad', m.el).onclick = async () => {
    try { const n = await q(sb.rpc('fidc_recompra_motivos_padrao', { p_empresa: e })); toast(n ? `${n} motivo(s) padrão restaurado(s)` : 'Todos os motivos padrão já existem'); recarregar(); } catch (err) { fail(err); }
  });
}

async function editar(e, x, depois) {
  const novo = !x; x = x || { titulo_acao: 'reabrir', dre_secao: 'receita_bruta', contab_modo: 'plano', ativo: true, ordem: 50 };
  const contas = await fetchAll(() => sb.from('contab_contas').select('id, classificacao, descricao').eq('empresa_id', e).eq('tipo', 'A').order('classificacao')).catch(() => []);
  const rot = (c) => `${c.classificacao} · ${c.descricao}`;
  const sel = (id, obj, v) => `<select id="${id}">${Object.entries(obj).map(([k, t]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  const chk = (id, v, t) => `<label class="chk"><input type="checkbox" id="${id}" ${v ? 'checked' : ''}> ${t}</label>`;
  const m = modal({ title: novo ? 'Novo motivo de recompra' : `Motivo: ${x.nome}`, wide: true, body: `<div class="grid-form">
      <label class="c6">Nome<input id="me-n" maxlength="80" value="${esc(x.nome || '')}"></label>
      <label class="xs">Ordem<input id="me-o" inputmode="numeric" value="${x.ordem ?? 50}"></label>
      <label class="full">Quando usar<input id="me-d" maxlength="300" value="${esc(x.descricao || '')}"></label>
      <label class="c6">O que acontece com o título${sel('me-a', ACOES, x.titulo_acao)}</label>
      <label class="c6">Linha na DRE Gerencial${sel('me-s', SECOES, x.dre_secao)}</label>
      <label class="full" id="me-rl">Nome da linha na DRE<input id="me-r" maxlength="120" value="${esc(x.dre_rotulo || '')}" placeholder="ex.: (−) Recompras por devolução de mercadoria"></label>
      <label class="c6">Contrapartida contábil da recompra${sel('me-c', CONTAB, x.contab_modo)}</label>
      <label class="c6" id="me-ccl">Conta contábil<input id="me-cc" list="me-dl" value="${esc(contas.find(c => c.id === x.contab_conta_id) ? rot(contas.find(c => c.id === x.contab_conta_id)) : '')}" placeholder="${contas.length ? 'procure pela classificação ou nome' : 'importe o plano contábil em Contabilidade › Balancete'}">
        <datalist id="me-dl">${contas.map(c => `<option value="${esc(rot(c))}">`).join('')}</datalist></label></div>
    <div style="display:flex;flex-wrap:wrap;gap:6px 22px;margin-top:10px">
      ${chk('me-p', x.permite_parcial, 'Aceita valor parcial (volta só uma parte para a carteira)')}${chk('me-xn', x.exige_nota, 'Exige a nota de devolução')}
      ${chk('me-xs', x.exige_substituto, 'Exige o título substituto')}${chk('me-xo', x.exige_obs, 'Exige observação')}${chk('me-at', x.ativo, 'Ativo')}</div>
    <p class="small muted" id="me-dica"></p>`,
    foot: `${!novo ? '<button class="btn ghost danger" id="me-del">Excluir</button><span class="spacer" style="flex:1"></span>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="me-ok">Salvar</button>` });
  const dica = () => {
    const a = $('#me-a', m.el).value, s = $('#me-s', m.el).value, c = $('#me-c', m.el).value;
    $('#me-rl', m.el).hidden = s === 'fora'; $('#me-ccl', m.el).hidden = c !== 'conta';
    $('#me-dica', m.el).textContent = [
      { reabrir: 'O título volta como conta a receber em aberto e é baixado quando o cliente pagar, em qualquer conta.', baixar: 'O título não volta. Com valor parcial, volta só o saldo que o cliente ainda deve.',
        substituir: 'O título não volta: fica ligado ao título que foi cedido no lugar.', recebido: 'O recebimento que o cliente já fez fica vinculado à recompra; nada volta em aberto.', nenhum: 'O título não volta: é um acerto com o fundo (o estorno entra quando o fundo devolver).' }[a],
      { receita_bruta: 'Na DRE a recompra reduz a receita bruta numa linha própria (a cessão já tinha entrado como receita).', despesas_financeiras: 'Na DRE a recompra fica nas despesas financeiras.',
        nao_operacionais: 'Na DRE a recompra fica nos movimentos não operacionais.', fora: 'A recompra não entra na DRE (só no fluxo de caixa).' }[s],
    ].join(' ');
  };
  ['me-a', 'me-s', 'me-c'].forEach(i => $('#' + i, m.el).onchange = dica); dica();
  $('#me-ok', m.el).onclick = async (ev) => {
    const nome = $('#me-n', m.el).value.trim(); if (!nome) return toast('Informe o nome do motivo', true);
    const modo = $('#me-c', m.el).value, txt = $('#me-cc', m.el).value.trim(), cc = contas.find(c => rot(c) === txt);
    if (modo === 'conta' && !cc) return toast('Escolha a conta contábil na lista', true);
    const row = { empresa_id: e, nome, descricao: $('#me-d', m.el).value.trim() || null, ordem: parseInt($('#me-o', m.el).value) || 0, titulo_acao: $('#me-a', m.el).value,
      dre_secao: $('#me-s', m.el).value, dre_rotulo: $('#me-r', m.el).value.trim() || null, contab_modo: modo, contab_conta_id: modo === 'conta' ? cc.id : null,
      permite_parcial: $('#me-p', m.el).checked, exige_nota: $('#me-xn', m.el).checked, exige_substituto: $('#me-xs', m.el).checked, exige_obs: $('#me-xo', m.el).checked, ativo: $('#me-at', m.el).checked };
    ev.target.disabled = true;
    try {
      if (novo) await q(sb.from('fidc_recompra_motivos').insert({ ...row, codigo: 'm' + Date.now().toString(36) }));
      else await q(sb.from('fidc_recompra_motivos').update(row).eq('id', x.id));
      m.close(); toast('Motivo salvo'); depois();
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
  $('#me-del', m.el) && ($('#me-del', m.el).onclick = async () => {
    if (!await confirmDialog(`Excluir o motivo "${x.nome}"? Se já houver recompra com ele, desative em vez de excluir.`)) return;
    try { await q(sb.from('fidc_recompra_motivos').delete().eq('id', x.id)); m.close(); toast('Motivo excluído'); depois(); }
    catch (err) { fail(/foreign key|restrict/i.test(err.message || '') ? new Error('Este motivo já foi usado em recompras: desmarque "Ativo" em vez de excluir.') : err); }
  });
}
