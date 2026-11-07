// Casa de Tintas › Cores e Receitas (PRD018): cores (Pantone, cliente, L*a*b*), receitas com versões (rascunho → teste →
// aprovada; a aprovada não muda), composição e custo teórico, comparação entre versões; sistemas e parâmetros.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, confirmDialog, options, parseNum, money, dateBR, exportXLSX } from '../lib/ui.js';
import * as T from '../lib/tintas.js';
import { carregarTintas, corTxt, nomeProd, selo, clsVersao, amostra, CSS, podeGerir, podeTintas, podeAprovar, nf } from '../lib/tintas-ui.js';

export const title = 'Cores e Receitas';
const ui = { aba: 're', busca: '' };
let D = null;
const fx = (v, c = 4) => (v == null || v === '' ? '' : nf(v, c));
const PAPEIS = [['admin', 'Administrador'], ['diretor', 'Diretor'], ['financeiro', 'Financeiro'], ['producao', 'Produção']];

export async function render(root) {
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">Cores e Receitas</h2><div class="muted small">Cada cor tem receitas; cada receita tem versões. Só a versão aprovada vai para a bancada, e ela não muda: corrige-se criando outra versão.</div></div>
      <div class="tn-acoes">${podeGerir() ? '<button class="btn" id="tr-conf">Configurar a casa de tintas</button>' : ''}<button class="btn ghost" id="tr-xls">Excel</button><span id="tr-acao"></span></div></div>
    <div class="card toolbar"><div class="chips" id="tr-abas">${[['re', 'Receitas'], ['co', 'Cores'], ['si', 'Sistemas'], ['pa', 'Parâmetros']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
      <span class="spacer"></span><input id="tr-b" placeholder="Procurar" value="${esc(ui.busca)}" style="width:180px"></div>
    <div id="tr-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#tr-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; $$('#tr-abas .chip', root).forEach(c => c.classList.toggle('on', c.dataset.a === a)); pintar(root); } };
  $('#tr-b', root).oninput = (e) => { ui.busca = e.target.value; pintar(root); };
  $('#tr-xls', root).onclick = () => exportXLSX($('#tr-corpo table', root), 'tintas_' + ui.aba);
  $('#tr-conf', root) && ($('#tr-conf', root).onclick = async () => {
    try { const r = await q(sb.rpc('tin_configurar', { p_empresa: state.empresa.id })); toast(`Casa de tintas configurada: local de tinta pronta${r?.local_maquina ? ', local da impressão' : ''}${+r?.sistemas ? ` e ${r.sistemas} sistemas` : ''}`); render(root); } catch (e) { fail(e); }
  });
  try { D = await carregarTintas({ meses: 1 }); } catch (err) { fail(err); $('#tr-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 088 (casa de tintas) já foi executado.</div></div>'; return; }
  pintar(root);
}

function pintar(root) {
  const c = $('#tr-corpo', root), acao = $('#tr-acao', root), b = ui.busca.trim().toLowerCase(), re = () => render(root), pode = podeTintas();
  acao.innerHTML = !pode ? '' : ui.aba === 're' ? '<button class="btn primary" id="tr-novo">Nova receita</button>' : ui.aba === 'co' ? '<button class="btn primary" id="tr-novo">Nova cor</button>' : ui.aba === 'si' && podeGerir() ? '<button class="btn primary" id="tr-novo">Novo sistema</button>' : '';
  const novo = $('#tr-novo', root);
  if (ui.aba === 're') {
    if (novo) novo.onclick = () => formReceita(null, re);
    const L = D.Re.filter(r => !b || `${r.codigo} ${r.nome} ${corTxt(D, r.cor_id)}`.toLowerCase().includes(b));
    c.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Receita</th><th>Cor</th><th>Versão em uso</th><th class="num">Custo teórico/kg</th><th>Em desenvolvimento</th></tr></thead><tbody>
      ${L.map(r => { const v = D.aprovada(r.id), ct = v ? T.custoTeorico(D.itensDe(v.id), D.custos) : null, dev = D.Ve.find(x => x.receita_id === r.id && ['rascunho', 'em_teste'].includes(x.situacao));
        return `<tr class="clickable" data-r="${r.id}" style="${r.ativo ? '' : 'opacity:.55'}"><td><b>${esc(r.codigo)}</b> · ${esc(r.nome)}<div class="small muted">${esc(T.APLICACOES[r.aplicacao])}${r.substrato ? ' · ' + esc(r.substrato) : ''}</div></td>
          <td>${amostra(D.coById[r.cor_id]?.hex)}${esc(corTxt(D, r.cor_id))}</td><td>${v ? `${selo('v' + v.numero + ' aprovada', 'pos')}<div class="small muted">${dateBR((v.aprovada_em || '').slice(0, 10))}</div>` : selo('Sem versão aprovada', 'warn')}</td>
          <td class="num">${ct?.custoKg != null ? money(ct.custoKg) : '–'}${ct?.faltam ? `<div class="small muted">${ct.faltam} sem custo</div>` : ''}</td><td>${dev ? selo(`v${dev.numero} ${T.SIT_VERSAO[dev.situacao].toLowerCase()}`, clsVersao(dev.situacao)) : '—'}</td></tr>`; }).join('')
        || '<tr><td colspan="5" class="empty">Nenhuma receita. Cadastre a cor e depois a receita, com as versões.</td></tr>'}</tbody></table></div></div>`;
    c.onclick = (e) => { const r = e.target.closest('[data-r]'); if (r) fichaReceita(D.reById[r.dataset.r], re); };
  } else if (ui.aba === 'co') {
    if (novo) novo.onclick = () => formCor(null, re);
    const L = D.Co.filter(x => !b || `${x.codigo} ${x.nome} ${x.referencia || ''}`.toLowerCase().includes(b));
    c.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Cor</th><th>Padrão</th><th>Cliente</th><th class="num">Receitas</th><th class="num">Sobra (kg)</th></tr></thead><tbody>
      ${L.map(x => { const sob = D.sobras.filter(s => x.produto_id && s.produto_id === x.produto_id).reduce((s, y) => s + +y.quantidade, 0);
        return `<tr class="clickable" data-c="${x.id}" style="${x.ativo ? '' : 'opacity:.55'}"><td>${amostra(x.hex)}<b>${esc(x.codigo)}</b> · ${esc(x.nome)}<div class="small muted">${esc(D.siById[x.sistema_id]?.nome || '')}</div></td>
          <td class="small">${esc(T.PADROES[x.padrao])}${x.referencia ? ' · ' + esc(x.referencia) : ''}${x.lab_l != null ? `<div class="muted">L* ${nf(x.lab_l, 2)} a* ${nf(x.lab_a, 2)} b* ${nf(x.lab_b, 2)}</div>` : ''}</td>
          <td class="small">${esc(state.cad.favById?.[x.favorecido_id]?.nome || '—')}</td>
          <td class="num">${D.Re.filter(r => r.cor_id === x.id).length}</td><td class="num">${sob ? nf(sob, 1) : '–'}</td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">Nenhuma cor.</td></tr>'}</tbody></table></div></div>`;
    c.onclick = (e) => { const r = e.target.closest('[data-c]'); if (r && pode) formCor(D.coById[r.dataset.c], re); };
  } else if (ui.aba === 'si') {
    if (novo) novo.onclick = () => formSistema(null, re);
    c.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Sistema</th><th>Descrição</th><th class="num">Cores</th></tr></thead><tbody>
      ${D.Si.map(s => `<tr class="clickable" data-s="${s.id}"><td><b>${esc(s.nome)}</b></td><td class="small">${esc(s.descricao || '')}</td><td class="num">${D.Co.filter(x => x.sistema_id === s.id).length}</td></tr>`).join('')
        || '<tr><td colspan="3" class="empty">Nenhum sistema. "Configurar a casa de tintas" cria os de partida.</td></tr>'}</tbody></table></div></div>`;
    c.onclick = (e) => { const r = e.target.closest('[data-s]'); if (r && podeGerir()) formSistema(D.Si.find(s => s.id === r.dataset.s), re); };
  } else {
    const p = D.P, dis = podeGerir() ? '' : 'disabled', locs = D.Lc.filter(l => l.ativo).map(l => ({ id: l.id, nome: `${l.codigo} · ${l.nome}` }));
    c.innerHTML = `<div class="card"><form id="tpa"><div class="grid-form">
      <label>Local da tinta pronta e das sobras<select name="tin" ${dis}>${options(locs, { selected: p.local_tinta_id, empty: '—' })}</select></label>
      <label>Local de onde saem os insumos<select name="ins" ${dis}>${options(locs, { selected: p.local_insumos_id, empty: 'o local padrão de cada produto' })}</select></label>
      <label>Local da máquina (em processo da impressão)<select name="maq" ${dis}>${options(locs, { selected: p.local_maquina_id, empty: '—' })}</select></label>
      <label class="xs">Tolerância de pesagem (%)<input name="tol" inputmode="decimal" value="${nf(p.tolerancia_pct, 2)}" ${dis}></label>
      <label class="xs">Validade da tinta pronta (dias)<input name="val" type="number" min="1" value="${p.validade_dias}" ${dis}></label>
      <label class="xs">Balança: velocidade (baud)<select name="baud" ${dis}>${[2400, 4800, 9600, 19200, 38400].map(x => `<option ${+p.balanca_baud === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
    </div>
    <label class="chk" style="margin-top:12px;display:flex;gap:8px;align-items:center"><input type="checkbox" name="prod" ${p.criar_produto ? 'checked' : ''} ${dis}> Criar o produto "tinta pronta" da cor (TP-código) na primeira aprovação, para controlar o lote no estoque</label>
    <h4 style="margin:14px 0 6px">Quem aprova receitas e concessões</h4>
    <div style="display:flex;gap:16px;flex-wrap:wrap">${PAPEIS.map(([k, t]) => `<label class="chk"><input type="checkbox" name="pap" value="${k}" ${k === 'admin' ? 'checked disabled' : (p.papeis_aprovacao || []).includes(k) ? 'checked' : ''} ${dis}> ${t}</label>`).join('')}</div>
    <ul class="small muted" style="margin-top:12px"><li><b>Tolerância</b>: desvio aceito em cada pesagem sem justificativa (o item pode ter a dele na receita).</li>
      <li><b>Balança</b>: no Chrome ou Edge do computador, o botão ⚖ lê o peso da balança ligada no USB/serial; nos outros aparelhos, o peso é digitado.</li>
      <li><b>Sem estoque implantado</b>: nada movimenta; o custo da pesagem vem do custo médio ou do último preço de compra.</li></ul>
    ${podeGerir() ? '<div style="text-align:right"><button class="btn primary" id="tpa-ok" type="button">Salvar parâmetros</button></div>' : ''}</form></div>`;
    $('#tpa-ok', c) && ($('#tpa-ok', c).onclick = async () => {
      const f = $('#tpa', c);
      try { await q(sb.from('tin_parametros').upsert({ empresa_id: state.empresa.id, local_tinta_id: f.tin.value || null, local_insumos_id: f.ins.value || null, local_maquina_id: f.maq.value || null,
        tolerancia_pct: parseNum(f.tol.value) || 2, validade_dias: +f.val.value || 30, balanca_baud: +f.baud.value || 9600, criar_produto: f.prod.checked,
        papeis_aprovacao: [...new Set(['admin', ...$$('input[name=pap]:checked:not([disabled])', c).map(x => x.value)])], atualizado_em: new Date().toISOString() })); toast('Parâmetros salvos'); render(root); } catch (e) { fail(e); }
    });
    c.onclick = null;
  }
}

function formCor(x, onFeito) {
  x = x || { padrao: 'pantone', ativo: true };
  const md = modal({ title: x.id ? `${x.codigo} · ${x.nome}` : 'Nova cor', body: `<form id="fc"><div class="grid-form">
    <label class="xs">Código *<input name="cod" required value="${esc(x.codigo || '')}" placeholder="AZ286"></label><label class="span2">Nome *<input name="nome" required value="${esc(x.nome || '')}" placeholder="AZUL 286"></label>
    <label>Padrão<select name="pad">${Object.entries(T.PADROES).map(([k, t]) => `<option value="${k}" ${x.padrao === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label class="span2">Referência<input name="ref" value="${esc(x.referencia || '')}" placeholder="Pantone 286 C / padrão aprovado pelo cliente em 12/10"></label>
    <label class="xs">L*<input name="l" inputmode="decimal" value="${fx(x.lab_l, 3)}"></label><label class="xs">a*<input name="a" inputmode="decimal" value="${fx(x.lab_a, 3)}"></label><label class="xs">b*<input name="b" inputmode="decimal" value="${fx(x.lab_b, 3)}"></label>
    <label class="xs">Cor na tela<input name="hex" type="color" value="${esc(x.hex || '#1f4e9c')}"></label>
    <label>Sistema<select name="sis">${options(D.Si, { selected: x.sistema_id, empty: '—' })}</select></label>
    <label>Cliente (cor exclusiva)<select name="fav">${options(state.cad.favorecidos, { label: 'label', selected: x.favorecido_id, empty: '—' })}</select></label>
    <label class="chk xs"><input type="checkbox" name="at" ${x.ativo ? 'checked' : ''}> Ativa</label>
    <label class="full">Observação<input name="obs" value="${esc(x.observacao || '')}"></label></div>
    <p class="muted small">Com o L* a* b* do padrão, a ficha da ordem calcula o ΔE (CIEDE2000) a partir do L* a* b* medido no espectrofotômetro.</p></form>`,
    foot: `<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="fc-ok">Salvar</button>` });
  $('#fc-ok', md.el).onclick = async () => {
    const f = $('#fc', md.el); if (!f.reportValidity()) return;
    const num = (v) => (v.trim() ? parseNum(v) : null);
    const reg = { empresa_id: state.empresa.id, codigo: f.cod.value.trim(), nome: f.nome.value.trim(), padrao: f.pad.value, referencia: f.ref.value.trim() || null, lab_l: num(f.l.value), lab_a: num(f.a.value), lab_b: num(f.b.value),
      hex: f.hex.value, sistema_id: f.sis.value || null, favorecido_id: f.fav.value || null, ativo: f.at.checked, observacao: f.obs.value.trim() || null };
    if ([reg.lab_l, reg.lab_a, reg.lab_b].some(v => v != null) && [reg.lab_l, reg.lab_a, reg.lab_b].some(v => v == null)) return toast('Informe L*, a* e b* juntos', true);
    try { x.id ? await q(sb.from('tin_cores').update(reg).eq('id', x.id)) : await q(sb.from('tin_cores').insert(reg)); md.close(); toast('Cor salva'); onFeito?.(); } catch (e) { fail(e); }
  };
}
function formSistema(s, onFeito) {
  s = s || { ativo: true };
  const md = modal({ title: s.id ? s.nome : 'Novo sistema', narrow: true, body: `<form id="fs"><div class="grid-form"><label class="full">Nome *<input name="nome" required value="${esc(s.nome || '')}"></label><label class="full">Descrição<input name="desc" value="${esc(s.descricao || '')}"></label></div></form>`,
    foot: `<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="fs-ok">Salvar</button>` });
  $('#fs-ok', md.el).onclick = async () => { const f = $('#fs', md.el); if (!f.reportValidity()) return;
    const reg = { empresa_id: state.empresa.id, nome: f.nome.value.trim(), descricao: f.desc.value.trim() || null };
    try { s.id ? await q(sb.from('tin_sistemas').update(reg).eq('id', s.id)) : await q(sb.from('tin_sistemas').insert(reg)); md.close(); toast('Sistema salvo'); onFeito?.(); } catch (e) { fail(e); } };
}
function formReceita(r, onFeito) {
  r = r || { aplicacao: 'superficie', ativo: true };
  const md = modal({ title: r.id ? 'Receita' : 'Nova receita', body: `<form id="fr"><div class="grid-form">
    <label class="xs">Código *<input name="cod" required value="${esc(r.codigo || '')}" placeholder="R-AZ286"></label><label class="span2">Nome *<input name="nome" required value="${esc(r.nome || '')}" placeholder="Azul 286 — superfície PE"></label>
    <label class="span2">Cor *<select name="cor" required>${options(D.Co.filter(c => c.ativo || c.id === r.cor_id).map(c => ({ id: c.id, nome: `${c.codigo} · ${c.nome}` })), { selected: r.cor_id, empty: '— escolha —' })}</select></label>
    <label>Aplicação<select name="apl">${Object.entries(T.APLICACOES).map(([k, t]) => `<option value="${k}" ${r.aplicacao === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <label>Substrato<input name="sub" value="${esc(r.substrato || '')}" placeholder="PE, BOPP, PET"></label><label class="chk xs"><input type="checkbox" name="at" ${r.ativo ? 'checked' : ''}> Ativa</label></div></form>`,
    foot: `<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="fr-ok">${r.id ? 'Salvar' : 'Criar e abrir a versão 1'}</button>` });
  $('#fr-ok', md.el).onclick = async () => {
    const f = $('#fr', md.el); if (!f.reportValidity()) return;
    const reg = { empresa_id: state.empresa.id, codigo: f.cod.value.trim(), nome: f.nome.value.trim(), cor_id: f.cor.value, aplicacao: f.apl.value, substrato: f.sub.value.trim() || null, ativo: f.at.checked };
    try {
      if (r.id) { await q(sb.from('tin_receitas').update(reg).eq('id', r.id)); md.close(); toast('Receita salva'); onFeito?.(); return; }
      const [nr] = await q(sb.from('tin_receitas').insert(reg).select());
      const [v] = await q(sb.from('tin_versoes').insert({ empresa_id: state.empresa.id, receita_id: nr.id, motivo: 'Primeira versão' }).select());
      D.Re.push(nr); D.reById[nr.id] = nr; D.Ve.push(v); D.veById[v.id] = v; md.close(); toast('Receita criada'); fichaReceita(nr, onFeito, v.id);
    } catch (e) { fail(e); }
  };
}

/** ficha da receita: versões, editor da versão, composição e custo, comparação com a aprovada */
function fichaReceita(r, onFeito, versaoSel) {
  const vs = D.Ve.filter(v => v.receita_id === r.id).sort((a, b) => b.numero - a.numero);
  let v = vs.find(x => x.id === versaoSel) || vs.find(x => ['rascunho', 'em_teste'].includes(x.situacao)) || D.aprovada(r.id) || vs[0];
  const edit = v && ['rascunho', 'em_teste'].includes(v.situacao) && podeTintas(), apr = D.aprovada(r.id);
  let itens = v ? D.itensDe(v.id).map(i => ({ ...i })) : [];
  const insumos = D.Pr.filter(p => p.ativo && ['tinta_solvente', 'aditivo', 'outro'].includes(p.tipo));
  const md = modal({ title: `${r.codigo} · ${r.nome}`, wide: true, body: `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${amostra(D.coById[r.cor_id]?.hex)}<b>${esc(corTxt(D, r.cor_id))}</b><span class="muted small">${esc(T.APLICACOES[r.aplicacao])}${r.substrato ? ' · ' + esc(r.substrato) : ''}</span>
      <span class="spacer"></span>${vs.map(x => `<span class="chip ${x.id === v?.id ? 'on' : ''}" data-v="${x.id}">v${x.numero} · ${esc(T.SIT_VERSAO[x.situacao])}</span>`).join('')}</div>
    ${v ? `<div class="small muted" style="margin:6px 0">${v.motivo ? 'Motivo: ' + esc(v.motivo) + ' · ' : ''}${v.aprovada_em ? `aprovada por ${esc(v.aprovada_por || '')} em ${dateBR(v.aprovada_em.slice(0, 10))}` : `criada em ${dateBR(v.criado_em.slice(0, 10))}`}</div>
    <form id="fv"><div class="grid-form">
      <label class="xs">Base (kg)<input name="base" inputmode="decimal" value="${nf(v.base_kg)}" ${edit ? '' : 'disabled'}></label>
      <label class="xs">Viscosidade alvo (s)<input name="va" inputmode="decimal" value="${fx(v.viscosidade_alvo, 2)}" ${edit ? '' : 'disabled'}></label><label class="xs">± tolerância<input name="vt" inputmode="decimal" value="${fx(v.viscosidade_tol, 2)}" ${edit ? '' : 'disabled'}></label>
      <label>Método<input name="vm" value="${esc(v.viscosidade_metodo || '')}" ${edit ? '' : 'disabled'}></label>
      <label class="xs">Densidade alvo<input name="da" inputmode="decimal" value="${fx(v.densidade_alvo)}" ${edit ? '' : 'disabled'}></label><label class="xs">± tolerância<input name="dt" inputmode="decimal" value="${fx(v.densidade_tol)}" ${edit ? '' : 'disabled'}></label>
      <label class="xs">ΔE máximo<input name="de" inputmode="decimal" value="${fx(v.delta_e_max, 2)}" ${edit ? '' : 'disabled'}></label>
      <label class="span2">Observação<input name="obs" value="${esc(v.observacao || '')}" ${edit ? '' : 'disabled'}></label></div></form>
    <h4 style="margin:12px 0 4px">Composição (para a base de ${nf(v.base_kg)} kg)</h4>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>Insumo</th><th>Função</th><th class="num">kg na base</th><th class="num">%</th><th class="num">R$/kg</th><th>Tol. %</th>${edit ? '<th></th>' : ''}</tr></thead><tbody id="fv-it"></tbody></table></div>
    ${edit ? `<div style="display:flex;gap:6px;margin-top:6px"><select id="fv-np" style="flex:1">${options(insumos.map(p => ({ id: p.id, nome: `${p.codigo} · ${p.descricao}` })), { empty: '— insumo —' })}</select><input id="fv-nq" inputmode="decimal" placeholder="kg" style="width:90px"><button class="btn small" id="fv-add" type="button">Adicionar</button></div>` : ''}
    <div id="fv-res" class="small" style="margin-top:8px"></div>
    ${apr && apr.id !== v.id ? `<details style="margin-top:10px"><summary class="small">Comparar com a versão aprovada (v${apr.numero})</summary><div id="fv-cmp" class="small" style="margin-top:6px"></div></details>` : ''}` : '<p class="muted">Sem versões.</p>'}`,
    foot: `${podeTintas() ? '<button class="btn" id="fr-ed">Editar receita</button>' : ''}<span class="spacer"></span>
      ${v && !edit && podeTintas() && v.situacao !== 'obsoleta' ? '<button class="btn" id="fv-nova">Nova versão</button>' : ''}
      ${v?.situacao === 'aprovada' && podeAprovar(D) ? '<button class="btn danger" id="fv-blq">Bloquear</button>' : ''}
      ${edit ? `${v.situacao === 'rascunho' ? '<button class="btn" id="fv-teste">Enviar para teste</button>' : ''}<button class="btn" id="fv-sal">Salvar versão</button>${podeAprovar(D) ? '<button class="btn primary" id="fv-apr">✔ Aprovar versão</button>' : ''}` : ''}` });
  const el = md.el;
  const pinta = () => {
    const comp = T.composicao(itens, +v.base_kg), ct = T.custoTeorico(itens, D.custos);
    $('#fv-it', el).innerHTML = comp.linhas.map((i, k) => `<tr><td>${k + 1}</td><td>${esc(nomeProd(D, i.produto_id))}${edit ? `<input data-i="${k}" value="${esc(i.instrucao || '')}" placeholder="instrução (ex.: agitar 5 min)" style="display:block;width:100%;box-sizing:border-box;margin-top:4px;font-size:12px">` : i.instrucao ? `<div class="small muted">${esc(i.instrucao)}</div>` : ''}</td>
      <td>${edit ? `<select data-f="${k}" style="max-width:170px">${Object.entries(T.FUNCOES).map(([a, t]) => `<option value="${a}" ${i.funcao === a ? 'selected' : ''}>${t}</option>`).join('')}</select>` : esc(T.FUNCOES[i.funcao])}</td>
      <td class="num">${edit ? `<input data-q="${k}" inputmode="decimal" value="${nf(i.quantidade, 4)}" style="width:90px;text-align:right">` : nf(i.quantidade, 4)}</td><td class="num">${nf(i.pct, 2)}</td>
      <td class="num">${D.custos[i.produto_id] != null ? money(D.custos[i.produto_id]) : '<span class="muted">–</span>'}</td>
      <td>${edit ? `<input data-t="${k}" inputmode="decimal" value="${fx(i.tolerancia_pct, 2)}" placeholder="${nf(D.P.tolerancia_pct, 2)}" style="width:60px">` : fx(i.tolerancia_pct, 2) || '<span class="muted">padrão</span>'}</td>
      ${edit ? `<td style="white-space:nowrap"><button class="btn ghost small" data-up="${k}" type="button">↑</button><button class="btn ghost small" data-rm="${k}" type="button">✕</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="8" class="empty">Sem itens.</td></tr>';
    $('#fv-res', el).innerHTML = `${comp.fecha ? selo('Fecha a base', 'pos') : selo(`Soma ${nf(comp.total, 3)} kg ≠ base ${nf(v.base_kg)} kg`, 'warn')} · custo teórico <b>${ct?.custoKg != null ? money(ct.custoKg) + '/kg' : '–'}</b>${ct?.faltam ? ` (${ct.faltam} insumo(s) sem custo)` : ''}`;
    if ($('#fv-cmp', el)) {
      const A = Object.fromEntries(D.itensDe(apr.id).map(i => [i.produto_id, i])), B = Object.fromEntries(itens.map(i => [i.produto_id, i])), ids = [...new Set([...Object.keys(A), ...Object.keys(B)])];
      $('#fv-cmp', el).innerHTML = ids.map(id => { const a = A[id] ? +A[id].quantidade / +apr.base_kg * 100 : 0, b2 = B[id] ? +B[id].quantidade / +v.base_kg * 100 : 0, d = b2 - a;
        return `<div>${esc(nomeProd(D, id))}: ${nf(a, 2)}% → ${nf(b2, 2)}% ${Math.abs(d) > 0.005 ? selo(`${d > 0 ? '+' : ''}${nf(d, 2)} p.p.`, d > 0 ? 'warn' : 'info') : selo('igual', 'muted')}</div>`; }).join('');
    }
  };
  if (!v) return;
  pinta();
  const lerIt = () => { $$('[data-q]', el).forEach(x => { itens[+x.dataset.q].quantidade = parseNum(x.value) || 0; }); $$('[data-f]', el).forEach(x => { itens[+x.dataset.f].funcao = x.value; });
    $$('[data-t]', el).forEach(x => { itens[+x.dataset.t].tolerancia_pct = x.value.trim() ? parseNum(x.value) : null; }); $$('[data-i]', el).forEach(x => { itens[+x.dataset.i].instrucao = x.value.trim() || null; }); };
  if (edit) {
    $('#fv-it', el).addEventListener('change', () => { lerIt(); pinta(); });
    $('#fv-it', el).onclick = (e) => { const up = e.target.closest('[data-up]')?.dataset.up, rm = e.target.closest('[data-rm]')?.dataset.rm; lerIt();
      if (rm != null) itens.splice(+rm, 1); if (up != null && +up > 0) [itens[+up - 1], itens[+up]] = [itens[+up], itens[+up - 1]]; if (rm != null || up != null) pinta(); };
    $('#fv-add', el).onclick = () => { lerIt(); const p = $('#fv-np', el).value, qt = parseNum($('#fv-nq', el).value); if (!p || !(qt > 0)) return toast('Escolha o insumo e a quantidade', true);
      const pr = D.prById[p]; itens.push({ produto_id: p, quantidade: qt, funcao: /SOLV|ACET|ALCO|THIN/i.test(pr?.descricao || '') ? 'solvente' : /PIGM|CONC/i.test(pr?.descricao || '') ? 'pigmento' : /VERN/i.test(pr?.descricao || '') ? 'verniz' : 'base' }); $('#fv-nq', el).value = ''; pinta(); };
  }
  $$('[data-v]', el).forEach(x => x.onclick = () => { md.close(); fichaReceita(r, onFeito, x.dataset.v); });
  const salvar = async (extra = {}) => {
    lerIt(); const f = $('#fv', el), num = (s) => (s.trim() ? parseNum(s) : null);
    await q(sb.from('tin_versoes').update({ base_kg: parseNum(f.base.value) || 100, viscosidade_alvo: num(f.va.value), viscosidade_tol: num(f.vt.value), viscosidade_metodo: f.vm.value.trim() || null,
      densidade_alvo: num(f.da.value), densidade_tol: num(f.dt.value), delta_e_max: num(f.de.value), observacao: f.obs.value.trim() || null, ...extra }).eq('id', v.id));
    await q(sb.from('tin_itens').delete().eq('versao_id', v.id));
    if (itens.length) await q(sb.from('tin_itens').insert(itens.map((i, k) => ({ empresa_id: state.empresa.id, versao_id: v.id, seq: k + 1, produto_id: i.produto_id, quantidade: i.quantidade, funcao: i.funcao, tolerancia_pct: i.tolerancia_pct ?? null, instrucao: i.instrucao || null }))));
  };
  const b = (sel, fn) => { const x = $(sel, el); if (x) x.onclick = async () => { try { await fn(); } catch (e) { fail(e); } }; };
  b('#fv-sal', async () => { await salvar(); toast('Versão salva'); md.close(); onFeito?.(); });
  b('#fv-teste', async () => { await salvar({ situacao: 'em_teste' }); toast(`v${v.numero} em teste: prepare uma ordem piloto pela versão aprovada ou aprove quando validar`); md.close(); onFeito?.(); });
  b('#fv-apr', async () => {
    lerIt(); const comp = T.composicao(itens, +v.base_kg);
    if (!itens.length) return toast('A versão não tem itens', true);
    if (!comp.fecha && !await confirmDialog(`A soma (${nf(comp.total, 3)} kg) não fecha a base (${nf(v.base_kg)} kg). Aprovar mesmo assim?`)) return;
    if (!await confirmDialog(`Aprovar a v${v.numero}?${apr ? ` A v${apr.numero} fica obsoleta.` : ''} Depois de aprovada, a versão não muda.`)) return;
    await salvar(); await q(sb.rpc('tin_aprovar_versao', { p_versao: v.id })); toast(`v${v.numero} aprovada`); md.close(); onFeito?.();
  });
  b('#fv-nova', async () => { const m = prompt('Por que uma nova versão? (ex.: troca de fornecedor do pigmento, ajuste de tom pedido pelo cliente)'); if (m == null) return;
    const id = await q(sb.rpc('tin_nova_versao', { p_versao: v.id, p_motivo: m.trim() || null })); toast('Nova versão em rascunho'); md.close(); onFeito?.(); });
  b('#fv-blq', async () => { if (!await confirmDialog('Bloquear a versão aprovada? Nenhuma ordem nova pode usar esta receita até aprovar outra versão.')) return;
    await q(sb.from('tin_versoes').update({ situacao: 'bloqueada' }).eq('id', v.id)); toast('Versão bloqueada'); md.close(); onFeito?.(); });
  b('#fr-ed', async () => { md.close(); formReceita(r, onFeito); });
}
