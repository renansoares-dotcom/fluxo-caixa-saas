// Recuperadora › Parâmetros (REC009): liga o módulo e escolhe o modo; aparas internas, balança, pagamento e Kardex;
// materiais, classes de qualidade, tabela de preços por vigência e regras da apara (setor / máquina / motivo → material).
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, parseNum, dateBR, today, confirmDialog } from '../lib/ui.js';
import { carregarRec, limparCacheRec, podeConfig, semSQL, avisoSQL, nomeMat, optMats, rkg } from '../lib/rec-ui.js';
import { MODOS, POLIMEROS, CONDICOES } from '../lib/recuperadora.js';
import { cadProducao } from '../lib/producao.js';

export const title = 'Parâmetros da Recuperadora';
const ui = { aba: 'geral' };
const num = (v, d = 2) => v == null || v === '' ? '' : String(+v).replace('.', ',');

export async function render(root) {
  root.innerHTML = `<div class="card toolbar"><div class="chips" id="rp-abas">${[['geral', 'Geral'], ['materiais', 'Materiais'], ['classes', 'Classes e preços'], ['aparas', 'Regras da apara interna'], ['processo', 'Processo e custos']]
      .map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div><span class="spacer"></span><span id="rp-acoes"></span></div>
    <div id="rp-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#rp-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  const c = $('#rp-corpo', root);
  try {
    const R = await carregarRec(true);
    if (ui.aba === 'geral') await geral(c, R, root); else if (ui.aba === 'materiais') materiais(c, R, root); else if (ui.aba === 'classes') classes(c, R, root); else if (ui.aba === 'aparas') await aparas(c, R, root); else await processo(c, R, root);
  } catch (err) { c.innerHTML = semSQL(err) ? avisoSQL : `<div class="card"><div class="empty">${esc(err.message)}</div></div>`; }
}
const recarregar = (root) => { limparCacheRec(); document.dispatchEvent(new CustomEvent('rec-config')); render(root); };

async function geral(c, R, root) {
  const pode = podeConfig(), dis = pode ? '' : 'disabled', e = state.empresa.id;
  const [PL, LOC] = await Promise.all([
    q(sb.from('plano_contas').select('id,codigo,nome').eq('empresa_id', e).eq('tipo', 'S').eq('nivel', 2).order('codigo')).catch(() => []),
    q(sb.from('est_locais').select('id,codigo,nome').eq('empresa_id', e).order('codigo')).catch(() => [])]);
  const p = { modo: 'desligado', aparas_auto: true, apara_custo_kg: 0, tolerancia_kg: 1, desconto_max_pct: 30, exigir_foto: false, prazo_pagamento_dias: 0, abater_adiantamento: true,
    integrar_estoque: false, balanca_baud: 9600, prefixo_entrada: 'LE', prefixo_apara: 'AP', ...(R.cfg || {}) };
  const optPl = (sel) => `<option value="">— não gerar —</option>${PL.map(x => `<option value="${x.id}" ${sel === x.id ? 'selected' : ''}>${esc(x.codigo)} · ${esc(x.nome)}</option>`).join('')}`;
  c.innerHTML = `<form id="rp-f" class="card"><h2 style="margin-top:0">Módulo</h2>
    <div class="grid2"><label>Modo da recuperadora<select name="modo" ${dis}>${Object.entries(MODOS).map(([k, t]) => `<option value="${k}" ${p.modo === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <span class="small muted">Desligada: o menu da Recuperadora some para quem não configura. Só aparas: sem compra, balança só para transferências.</span></label>
      <div class="small muted" style="align-self:end">${R.mats.length} material(is), ${R.clas.length} classe(s) e ${R.precos.length} preço(s) cadastrados.${!R.clas.length && pode ? ' <a href="#" id="rp-pad">Criar as classes padrão (A, B e C)</a>' : ''}</div></div>
    <h3 style="margin:20px 0 8px">Aparas internas</h3>
    <div class="grid2"><label class="chk"><input type="checkbox" name="aa" ${p.aparas_auto ? 'checked' : ''} ${dis}> A apara apontada no encerramento da OP vira lote de apara sozinha</label>
      <label>Material padrão da apara<select name="amp" ${dis}><option value="">— só pelas regras —</option>${optMats(R, p.apara_material_padrao_id)}</select><span class="small muted">quando nenhuma regra da aba "Regras da apara interna" se aplica</span></label>
      <label>Valor do kg da apara interna (R$)<input name="ack" inputmode="decimal" value="${num(p.apara_custo_kg)}" ${dis}><span class="small muted">custo de entrada do lote de apara; 0 = sem custo (a apara já está no custo da OP)</span></label>
      <label>Prefixo dos lotes de apara<input name="pa" maxlength="6" value="${esc(p.prefixo_apara)}" ${dis}></label></div>
    <h3 style="margin:20px 0 8px">Balança e ticket</h3>
    <div class="grid2"><label>Tolerância entre a soma dos materiais e o peso líquido (kg)<input name="tol" inputmode="decimal" value="${num(p.tolerancia_kg)}" ${dis}></label>
      <label>Desconto máximo sem aprovação (%)<input name="dmax" inputmode="decimal" value="${num(p.desconto_max_pct)}" ${dis}><span class="small muted">acima disso, só admin, financeiro ou diretor fecha o ticket</span></label>
      <label class="chk"><input type="checkbox" name="foto" ${p.exigir_foto ? 'checked' : ''} ${dis}> Exigir foto da carga para fechar o ticket</label>
      <label>Balança: velocidade (baud)<select name="baud" ${dis}>${[2400, 4800, 9600, 19200, 38400].map(x => `<option ${+p.balanca_baud === x ? 'selected' : ''}>${x}</option>`).join('')}</select><span class="small muted">leitura pelo Chrome ou Edge no computador ligado à balança</span></label>
      <label>Prefixo dos lotes de entrada<input name="pe" maxlength="6" value="${esc(p.prefixo_entrada)}" ${dis}></label></div>
    <h3 style="margin:20px 0 8px">Pagamento ao fornecedor</h3>
    <div class="grid2"><label>Conta da compra de reciclável (título a pagar)<select name="plc" ${dis}>${optPl(p.plano_compra_id)}</select></label>
      <label>Prazo de pagamento (dias depois da pesagem)<input type="number" name="prz" min="0" max="120" value="${p.prazo_pagamento_dias}" ${dis}></label>
      <label>Conta do adiantamento a fornecedor<select name="pla" ${dis}>${optPl(p.plano_adiantamento_id)}</select></label>
      <label class="chk"><input type="checkbox" name="abt" ${p.abater_adiantamento ? 'checked' : ''} ${dis}> Abater o adiantamento em aberto do fornecedor ao fechar o ticket</label></div>
    <h3 style="margin:20px 0 8px">Alertas e ambiental</h3>
    <div class="grid2"><label>Tolerância da perda não explicada no balanço (% da entrada)<input name="btol" inputmode="decimal" value="${num(p.balanco_tolerancia_pct ?? 2)}" ${dis}></label>
      <label>Avisar as licenças com (dias de antecedência)<input type="number" name="lant" min="1" max="365" value="${p.licenca_antecedencia_dias ?? 60}" ${dis}></label>
      <label>Lote de grão sem ensaio vira alerta depois de (dias)<input type="number" name="eal" min="0" max="60" value="${p.ensaio_alerta_dias ?? 2}" ${dis}></label>
      <label>Adiantamento em aberto vira alerta depois de (dias)<input type="number" name="aal" min="1" max="365" value="${p.adiant_alerta_dias ?? 30}" ${dis}></label>
      <label>Conta do custo de destinação de resíduos (título a pagar)<select name="plr" ${dis}>${optPl(p.plano_residuos_id)}</select></label>
      <label class="chk"><input type="checkbox" name="alic" ${p.avisar_licencas !== false ? 'checked' : ''} ${dis}> Avisar o administrador e o diretor das licenças a vencer e vencidas</label></div>
    <h3 style="margin:20px 0 8px">Estoque</h3>
    <div class="grid2"><label class="chk"><input type="checkbox" name="est" ${p.integrar_estoque ? 'checked' : ''} ${dis}> Lançar a compra no Kardex (material ligado a um produto)</label>
      <label>Local do estoque<select name="loc" ${dis}><option value="">— local de aparas (APA) —</option>${LOC.map(l => `<option value="${l.id}" ${p.est_local_id === l.id ? 'selected' : ''}>${esc(l.codigo)} · ${esc(l.nome)}</option>`).join('')}</select></label></div>
    ${pode ? '<button class="btn primary" style="margin-top:12px">Salvar parâmetros</button>' : '<p class="small muted">Só admin, financeiro ou diretor altera os parâmetros.</p>'}</form>`;
  $('#rp-pad', c) && ($('#rp-pad', c).onclick = async (ev) => { ev.preventDefault(); try { await q(sb.rpc('rec_configurar_padrao', { p_empresa: e })); toast('Classes A, B e C criadas'); recarregar(root); } catch (err) { fail(err); } });
  $('#rp-f', c).onsubmit = async (ev) => {
    ev.preventDefault(); if (!pode) return; const f = ev.target;
    try {
      if (!R.cfg?.empresa_id) await q(sb.rpc('rec_configurar_padrao', { p_empresa: e }));
      await q(sb.from('rec_config').update({ modo: f.modo.value, aparas_auto: f.aa.checked, apara_material_padrao_id: f.amp.value || null, apara_custo_kg: parseNum(f.ack.value) || 0,
        prefixo_apara: f.pa.value.trim() || 'AP', tolerancia_kg: parseNum(f.tol.value) || 0, desconto_max_pct: Math.min(100, parseNum(f.dmax.value) || 0), exigir_foto: f.foto.checked,
        balanca_baud: +f.baud.value || 9600, prefixo_entrada: f.pe.value.trim() || 'LE', plano_compra_id: f.plc.value || null, prazo_pagamento_dias: Math.max(0, Math.min(120, +f.prz.value || 0)),
        plano_adiantamento_id: f.pla.value || null, abater_adiantamento: f.abt.checked, integrar_estoque: f.est.checked, est_local_id: f.loc.value || null,
        balanco_tolerancia_pct: Math.min(50, parseNum(f.btol.value) || 0), licenca_antecedencia_dias: Math.max(1, Math.min(365, +f.lant.value || 60)), ensaio_alerta_dias: Math.max(0, Math.min(60, +f.eal.value || 0)),
        adiant_alerta_dias: Math.max(1, Math.min(365, +f.aal.value || 30)), plano_residuos_id: f.plr.value || null, avisar_licencas: f.alic.checked, atualizado_em: new Date().toISOString() }).eq('empresa_id', e));
      toast('Parâmetros salvos'); recarregar(root);
    } catch (err) { fail(err); }
  };
}

function materiais(c, R, root) {
  const pode = podeConfig();
  $('#rp-acoes', root).innerHTML = pode ? '<button class="btn primary" id="rp-novo">+ Material</button>' : '';
  c.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Código</th><th>Material</th><th>Polímero</th><th>Cor</th><th>Condição</th><th>NCM</th><th>Produto no Kardex</th><th></th></tr></thead><tbody>
    ${R.mats.map(m => `<tr class="${pode ? 'clickable' : ''}" data-id="${m.id}"><td><b>${esc(m.codigo)}</b></td><td>${esc(m.nome)}${m.ativo ? '' : ' <span class="badge">inativo</span>'}</td><td>${esc(m.polimero)}</td><td>${esc(m.cor || '')}</td>
      <td>${CONDICOES[m.condicao] || m.condicao}</td><td>${esc(m.ncm || '')}</td><td class="small">${m.produto_id ? 'ligado' : '<span class="muted">—</span>'}</td><td></td></tr>`).join('')
      || '<tr><td colspan="8" class="empty">Nenhum material. Cadastre os tipos que entram na recuperadora (ex.: filme PEBD transparente, PP colorido, apara interna de PEBD).</td></tr>'}</tbody></table></div></div>
    <p class="small muted">O NCM sai na relação para a nota de entrada. Ligue o material a um produto do cadastro para a compra entrar no Kardex (com a opção ligada na aba Geral).</p>`;
  const abrir = async (m = {}) => {
    const prods = await q(sb.from('produtos').select('id,codigo,descricao').eq('empresa_id', state.empresa.id).order('descricao').limit(3000)).catch(() => []);
    const md = modal({ title: m.id ? 'Editar material' : 'Novo material', body: `<form id="mf" class="grid2">
        <label>Código *<input name="cod" required maxlength="20" value="${esc(m.codigo || '')}"></label><label>Nome *<input name="nome" required value="${esc(m.nome || '')}"></label>
        <label>Polímero<select name="pol">${POLIMEROS.map(x => `<option ${m.polimero === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Condição<select name="cond">${Object.entries(CONDICOES).map(([k, t]) => `<option value="${k}" ${m.condicao === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Cor<input name="cor" value="${esc(m.cor || '')}" placeholder="transparente, colorido, preto…"></label><label>NCM<input name="ncm" maxlength="8" inputmode="numeric" value="${esc(m.ncm || '')}" placeholder="8 dígitos, ex.: 39151000"></label>
        <label class="span2">Produto no Kardex<select name="prod"><option value="">—</option>${prods.map(p => `<option value="${p.id}" ${m.produto_id === p.id ? 'selected' : ''}>${esc(p.codigo || '')} ${esc(p.descricao || '')}</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" name="at" ${m.ativo !== false ? 'checked' : ''}> Ativo</label></form>`,
      foot: `${m.id ? '<button class="btn danger" id="m-del">Excluir</button>' : ''}<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="m-ok">Salvar</button>` });
    $('#m-ok', md.el).onclick = async () => {
      const f = $('#mf', md.el); if (!f.reportValidity()) return;
      const ncm = f.ncm.value.replace(/\D/g, ''); if (ncm && ncm.length !== 8) return toast('O NCM tem 8 dígitos', true);
      const v = { empresa_id: state.empresa.id, codigo: f.cod.value.trim().toUpperCase(), nome: f.nome.value.trim(), polimero: f.pol.value, condicao: f.cond.value, cor: f.cor.value.trim() || null, ncm: ncm || null, produto_id: f.prod.value || null, ativo: f.at.checked };
      try { await q(m.id ? sb.from('rec_materiais').update(v).eq('id', m.id) : sb.from('rec_materiais').insert(v)); md.close(); toast('Material salvo'); recarregar(root); } catch (err) { fail(err); }
    };
    $('#m-del', md.el) && ($('#m-del', md.el).onclick = async () => { if (!await confirmDialog('Excluir este material? Se já tiver tickets ou lotes, marque como inativo.')) return;
      try { await q(sb.from('rec_materiais').delete().eq('id', m.id)); md.close(); toast('Material excluído'); recarregar(root); } catch (err) { toast('Material em uso: marque como inativo', true); } });
  };
  $('#rp-novo', root) && ($('#rp-novo', root).onclick = () => abrir());
  c.querySelector('tbody').onclick = (e) => { const id = e.target.closest('tr[data-id]')?.dataset.id; if (id && pode) abrir(R.mats.find(m => m.id === id)); };
}

function classes(c, R, root) {
  const pode = podeConfig(), hoje = today();
  $('#rp-acoes', root).innerHTML = pode ? '<button class="btn" id="rp-ncl">+ Classe</button> <button class="btn primary" id="rp-npr">+ Preço</button>' : '';
  const vig = (m, cl) => R.precos.filter(p => p.material_id === m && (p.classe_id || null) === cl && p.vigencia <= hoje)[0];
  c.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Classe</th><th>Descrição</th><th class="num">Desconto padrão</th><th>Ativa</th></tr></thead><tbody>
      ${R.clas.map(x => `<tr class="${pode ? 'clickable' : ''}" data-cl="${x.id}"><td><b>${esc(x.codigo)}</b></td><td>${esc(x.nome)}</td><td class="num">${num(x.desconto_padrao_pct)}%</td><td>${x.ativo ? 'sim' : 'não'}</td></tr>`).join('')
        || '<tr><td colspan="4" class="empty">Nenhuma classe. Use "Criar as classes padrão" na aba Geral ou cadastre as suas.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">O desconto padrão (umidade e impureza) é sugerido no ticket e pode ser mudado item a item; acima do máximo da aba Geral, só quem configura fecha o ticket.</p>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap" style="max-height:55vh"><table><thead><tr><th>Material</th><th>Classe</th><th>Vigência</th><th class="num">R$/kg</th><th>Situação</th><th></th></tr></thead><tbody>
      ${R.precos.map(p => { const atual = vig(p.material_id, p.classe_id || null)?.id === p.id; return `<tr><td>${esc(nomeMat(R, p.material_id))}</td><td>${p.classe_id ? esc(R.claById[p.classe_id]?.codigo || '') : '<span class="muted">todas</span>'}</td>
        <td>${dateBR(p.vigencia)}</td><td class="num">${rkg(p.preco_kg)}</td><td>${p.vigencia > hoje ? '<span class="badge aberto">futuro</span>' : atual ? '<span class="badge pago">vigente</span>' : '<span class="muted small">histórico</span>'}</td>
        <td>${pode ? `<button class="btn ghost sm" data-dp="${p.id}">Excluir</button>` : ''}</td></tr>`; }).join('')
        || '<tr><td colspan="6" class="empty">Sem preços. Sem preço, o ticket fecha com valor zero e avisa.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">O preço da classe vence o preço geral do material ("todas"). Para mudar o preço, lance uma nova vigência: o histórico fica guardado e os tickets antigos não mudam.</p>`;
  const abrirCl = (x = {}) => {
    const md = modal({ title: x.id ? 'Editar classe' : 'Nova classe', narrow: true, body: `<form id="cf" class="grid2"><label>Código *<input name="cod" required maxlength="4" value="${esc(x.codigo || '')}"></label>
        <label>Ordem<input type="number" name="ord" value="${x.ordem ?? R.clas.length + 1}"></label><label class="span2">Descrição *<input name="nome" required value="${esc(x.nome || '')}"></label>
        <label>Desconto padrão (%)<input name="d" inputmode="decimal" value="${num(x.desconto_padrao_pct ?? 0)}"></label><label class="chk"><input type="checkbox" name="at" ${x.ativo !== false ? 'checked' : ''}> Ativa</label></form>`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="c-ok">Salvar</button>' });
    $('#c-ok', md.el).onclick = async () => { const f = $('#cf', md.el); if (!f.reportValidity()) return;
      const v = { empresa_id: state.empresa.id, codigo: f.cod.value.trim().toUpperCase(), nome: f.nome.value.trim(), ordem: +f.ord.value || 0, desconto_padrao_pct: Math.min(100, parseNum(f.d.value) || 0), ativo: f.at.checked };
      try { await q(x.id ? sb.from('rec_classes').update(v).eq('id', x.id) : sb.from('rec_classes').insert(v)); md.close(); toast('Classe salva'); recarregar(root); } catch (err) { fail(err); } };
  };
  $('#rp-ncl', root) && ($('#rp-ncl', root).onclick = () => abrirCl());
  c.querySelector('tbody').onclick = (e) => { const id = e.target.closest('tr[data-cl]')?.dataset.cl; if (id && pode) abrirCl(R.clas.find(x => x.id === id)); };
  $('#rp-npr', root) && ($('#rp-npr', root).onclick = () => {
    if (!R.mats.length) return toast('Cadastre os materiais primeiro', true);
    const md = modal({ title: 'Novo preço', body: `<form id="pf" class="grid2"><label class="span2">Material *<select name="m">${optMats(R, null)}</select></label>
        <label>Classe<select name="c"><option value="">Todas as classes</option>${R.clas.map(x => `<option value="${x.id}">${esc(x.codigo)} — ${esc(x.nome)}</option>`).join('')}</select></label>
        <label>Vale a partir de *<input type="date" name="v" value="${hoje}" required></label><label>Preço do kg (R$) *<input name="p" inputmode="decimal" required></label></form>`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="p-ok">Salvar</button>' });
    $('#p-ok', md.el).onclick = async () => { const f = $('#pf', md.el); if (!f.reportValidity()) return; const p = parseNum(f.p.value); if (!(p >= 0)) return toast('Informe o preço', true);
      try { await q(sb.from('rec_precos').insert({ empresa_id: state.empresa.id, material_id: f.m.value, classe_id: f.c.value || null, vigencia: f.v.value, preco_kg: p })); md.close(); toast('Preço salvo'); recarregar(root); }
      catch (err) { fail(/rec_precos_unq|duplicate/.test(err.message) ? new Error('Já existe preço deste material e classe nesta data.') : err); } };
  });
  $$('[data-dp]', c).forEach(b => b.onclick = async () => { if (!await confirmDialog('Excluir este preço? Tickets já fechados não mudam.')) return;
    try { await q(sb.from('rec_precos').delete().eq('id', b.dataset.dp)); toast('Preço excluído'); recarregar(root); } catch (err) { fail(err); } });
}

async function aparas(c, R, root) {
  const pode = podeConfig(), P = await cadProducao(), e = state.empresa.id;
  const regras = await q(sb.from('rec_apara_regras').select('*').eq('empresa_id', e));
  $('#rp-acoes', root).innerHTML = pode ? '<button class="btn" id="rp-rep">Refazer as aparas desde…</button> <button class="btn primary" id="rp-nr">+ Regra</button>' : '';
  const espec = (r) => (r.maquina_id ? 4 : 0) + (r.motivo_id ? 2 : 0) + (r.setor_id ? 1 : 0);
  c.innerHTML = `${['interno', 'ambos'].includes(R.cfg.modo) ? '' : '<div class="card" style="border-left:4px solid var(--warn,#c80)"><p class="small" style="margin:0">O modo atual não usa aparas internas: as regras só valem nos modos "Só aparas internas" e "Aparas internas e compra de terceiros".</p></div>'}
    <div class="card flush" style="margin-top:12px"><div class="table-wrap"><table><thead><tr><th>Setor</th><th>Máquina</th><th>Motivo do refugo</th><th>Vai para</th><th>Ativa</th><th></th></tr></thead><tbody>
    ${[...regras].sort((a, b) => espec(b) - espec(a)).map(r => `<tr><td>${esc(P.setorById[r.setor_id]?.nome || 'qualquer')}</td><td>${esc(P.maqById[r.maquina_id] ? P.maqById[r.maquina_id].codigo + ' ' + P.maqById[r.maquina_id].nome : 'qualquer')}</td>
      <td>${esc(P.motById[r.motivo_id]?.nome || 'qualquer')}</td><td>${r.ignorar ? '<span class="badge negoc">não vai para a recuperadora</span>' : esc(nomeMat(R, r.material_id))}</td><td>${r.ativo ? 'sim' : 'não'}</td>
      <td>${pode ? `<button class="btn ghost sm" data-del="${r.id}">Excluir</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="6" class="empty">Sem regras: toda apara apontada vai para o material padrão da aba Geral.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Vale a regra mais específica: máquina vence motivo, que vence setor. Use "não vai para a recuperadora" para o refugo que não volta (ex.: o próprio aglutinador ou a borra). Material padrão: <b>${esc(R.cfg.apara_material_padrao_id ? nomeMat(R, R.cfg.apara_material_padrao_id) : 'nenhum')}</b>.</p>`;
  $('#rp-nr', root) && ($('#rp-nr', root).onclick = () => {
    const md = modal({ title: 'Regra da apara', body: `<form id="rf" class="grid2">
        <label>Setor<select name="s"><option value="">qualquer</option>${P.setores.map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('')}</select></label>
        <label>Máquina<select name="m"><option value="">qualquer</option>${P.maquinas.map(x => `<option value="${x.id}">${esc(x.codigo)} ${esc(x.nome)}</option>`).join('')}</select></label>
        <label>Motivo do refugo<select name="mo"><option value="">qualquer</option>${P.motivos.filter(x => x.tipo === 'refugo').map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('')}</select></label>
        <label>Vai para<select name="mat"><option value="__ign">— não vai para a recuperadora —</option>${optMats(R, R.cfg.apara_material_padrao_id)}</select></label></form>`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="r-ok">Salvar</button>' });
    $('#r-ok', md.el).onclick = async () => { const f = $('#rf', md.el), ign = f.mat.value === '__ign';
      if (!f.s.value && !f.m.value && !f.mo.value) return toast('Escolha ao menos o setor, a máquina ou o motivo (a regra geral é o material padrão da aba Geral)', true);
      try { await q(sb.from('rec_apara_regras').insert({ empresa_id: e, setor_id: f.s.value || null, maquina_id: f.m.value || null, motivo_id: f.mo.value || null, material_id: ign ? null : f.mat.value, ignorar: ign }));
        md.close(); toast('Regra salva. Use "Refazer as aparas" para aplicar aos apontamentos já feitos.'); render(root); } catch (err) { fail(err); } };
  });
  $$('[data-del]', c).forEach(b => b.onclick = async () => { try { await q(sb.from('rec_apara_regras').delete().eq('id', b.dataset.del)); toast('Regra excluída'); render(root); } catch (err) { fail(err); } });
  $('#rp-rep', root) && ($('#rp-rep', root).onclick = () => {
    const d0 = new Date(); d0.setDate(1);
    const md = modal({ title: 'Refazer as aparas', narrow: true, body: `<p class="small">Aplica de novo o material e as regras a todos os apontamentos encerrados desde a data. Os lotes de apara de cada dia são refeitos; um lote já usado no processamento não perde o que foi consumido.</p>
        <label>Desde<input type="date" id="rr-d" value="${d0.toISOString().slice(0, 10)}"></label>`, foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rr-ok">Refazer</button>' });
    $('#rr-ok', md.el).onclick = async (ev) => { ev.target.disabled = true;
      try { const r = await q(sb.rpc('rec_aparas_reprocessar', { p_empresa: e, p_de: $('#rr-d', md.el).value })); md.close(); toast(`${r.apontamentos} apontamento(s) revisto(s): ${String(r.kg).replace('.', ',')} kg de apara em lotes`); }
      catch (err) { ev.target.disabled = false; fail(err); } };
  });
}

async function processo(c, R, root) {
  const pode = podeConfig(), dis = pode ? '' : 'disabled', e = state.empresa.id;
  const [ET, RV] = await Promise.all([q(sb.from('rec_etapas').select('*').eq('empresa_id', e).order('ordem')), q(sb.from('rec_resina_virgem').select('*').eq('empresa_id', e).order('vigencia', { ascending: false }))]);
  const p = { custo_kwh: 0, custo_m3_agua: 0, custo_hora_mo: 0, custo_hora_maquina: 0, meta_rendimento_pct: 85, exigir_ensaio: true, prefixo_grao: 'GR', ...(R.cfg || {}) };
  $('#rp-acoes', root).innerHTML = pode ? '<button class="btn" id="rp-net">+ Etapa</button> <button class="btn" id="rp-nrv">+ Preço da resina virgem</button>' : '';
  c.innerHTML = `<form id="pc-f" class="card"><h3 style="margin:0 0 8px">Custos do processamento</h3><div class="grid2">
      <label>Energia (R$ por kWh)<input name="kwh" inputmode="decimal" value="${num(p.custo_kwh)}" ${dis}></label><label>Água (R$ por m³)<input name="agua" inputmode="decimal" value="${num(p.custo_m3_agua)}" ${dis}></label>
      <label>Mão de obra (R$ por hora)<input name="mo" inputmode="decimal" value="${num(p.custo_hora_mo)}" ${dis}><span class="small muted">salário + encargos ÷ horas trabalhadas</span></label>
      <label>Máquina sem custo-hora (R$ por hora)<input name="maq" inputmode="decimal" value="${num(p.custo_hora_maquina)}" ${dis}><span class="small muted">vale quando a máquina, o setor e o Custo das OPs não têm custo-hora</span></label></div>
    <h3 style="margin:20px 0 8px">Rendimento e qualidade</h3><div class="grid2">
      <label>Meta de rendimento (%)<input name="meta" inputmode="decimal" value="${num(p.meta_rendimento_pct)}" ${dis}><span class="small muted">grão ÷ material que entrou na ordem</span></label>
      <label>Prefixo dos lotes de grão<input name="pg" maxlength="6" value="${esc(p.prefixo_grao)}" ${dis}></label>
      <label class="chk"><input type="checkbox" name="ens" ${p.exigir_ensaio ? 'checked' : ''} ${dis}> O lote de grão nasce bloqueado até o ensaio aprovado (Qualidade do Grão)</label></div>
    ${pode ? '<button class="btn primary" style="margin-top:12px">Salvar</button>' : ''}</form>
    <div class="grid2" style="margin-top:12px;align-items:start">
      <div class="card flush"><div style="padding:12px 12px 0"><h3 style="margin:0">Etapas do processo</h3></div><div class="table-wrap"><table><thead><tr><th>Ordem</th><th>Código</th><th>Etapa</th><th>Ativa</th></tr></thead><tbody>
        ${ET.map(x => `<tr class="${pode ? 'clickable' : ''}" data-et="${x.id}"><td>${x.ordem}</td><td><b>${esc(x.codigo)}</b></td><td>${esc(x.nome)}</td><td>${x.ativo ? 'sim' : 'não'}</td></tr>`).join('')
          || '<tr><td colspan="4" class="empty">Sem etapas. Salve esta aba para criar as padrão (triagem, moagem, lavagem, secagem, aglutinação, extrusão).</td></tr>'}</tbody></table></div></div>
      <div class="card flush"><div style="padding:12px 12px 0"><h3 style="margin:0">Preço da resina virgem</h3></div><div class="table-wrap"><table><thead><tr><th>Polímero</th><th>Vigência</th><th class="num">R$/kg</th><th>Fonte</th><th></th></tr></thead><tbody>
        ${RV.map(x => `<tr><td><b>${esc(x.polimero)}</b></td><td>${dateBR(x.vigencia)}</td><td class="num">${rkg(x.preco_kg)}</td><td class="small">${esc(x.fonte || '')}</td><td>${pode ? `<button class="btn ghost sm" data-drv="${x.id}">Excluir</button>` : ''}</td></tr>`).join('')
          || '<tr><td colspan="5" class="empty">Sem preço: a economia contra a resina virgem não é calculada.</td></tr>'}</tbody></table></div></div></div>
    <p class="small muted">O custo do kg de grão = custo do material que entrou (pelo custo de cada lote) + energia + água + químicos + mão de obra + horas de máquina de cada etapa × custo-hora (máquina → setor → Custo das OPs → este padrão) + outros.</p>`;
  $('#pc-f', c).onsubmit = async (ev) => { ev.preventDefault(); if (!pode) return; const f = ev.target;
    try { if (!R.cfg?.empresa_id || !ET.length) await q(sb.rpc('rec_configurar_padrao', { p_empresa: e }));
      await q(sb.from('rec_config').update({ custo_kwh: parseNum(f.kwh.value) || 0, custo_m3_agua: parseNum(f.agua.value) || 0, custo_hora_mo: parseNum(f.mo.value) || 0, custo_hora_maquina: parseNum(f.maq.value) || 0,
        meta_rendimento_pct: Math.min(100, parseNum(f.meta.value) || 85), prefixo_grao: f.pg.value.trim() || 'GR', exigir_ensaio: f.ens.checked, atualizado_em: new Date().toISOString() }).eq('empresa_id', e));
      toast('Salvo'); recarregar(root); } catch (err) { fail(err); } };
  const abrirEt = (x = {}) => {
    const md = modal({ title: x.id ? 'Editar etapa' : 'Nova etapa', narrow: true, body: `<form id="tf" class="grid2"><label>Código *<input name="c" required maxlength="6" value="${esc(x.codigo || '')}"></label><label>Ordem<input type="number" name="o" value="${x.ordem ?? ET.length + 1}"></label>
        <label class="span2">Nome *<input name="n" required value="${esc(x.nome || '')}"></label><label class="chk"><input type="checkbox" name="a" ${x.ativo !== false ? 'checked' : ''}> Ativa</label></form>`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="tf-ok">Salvar</button>' });
    $('#tf-ok', md.el).onclick = async () => { const f = $('#tf', md.el); if (!f.reportValidity()) return; const v = { empresa_id: e, codigo: f.c.value.trim().toUpperCase(), nome: f.n.value.trim(), ordem: +f.o.value || 0, ativo: f.a.checked };
      try { await q(x.id ? sb.from('rec_etapas').update(v).eq('id', x.id) : sb.from('rec_etapas').insert(v)); md.close(); render(root); } catch (err) { fail(err); } };
  };
  $('#rp-net', root) && ($('#rp-net', root).onclick = () => abrirEt());
  c.querySelectorAll('tr[data-et]').forEach(tr => tr.onclick = () => pode && abrirEt(ET.find(x => x.id === tr.dataset.et)));
  $('#rp-nrv', root) && ($('#rp-nrv', root).onclick = () => {
    const md = modal({ title: 'Preço da resina virgem', body: `<form id="vf" class="grid2"><label>Polímero<select name="p">${POLIMEROS.map(x => `<option>${x}</option>`).join('')}</select></label><label>Vale a partir de<input type="date" name="v" value="${today()}"></label>
        <label>R$/kg *<input name="k" inputmode="decimal"></label><label>Fonte<input name="f" placeholder="cotação do fornecedor, índice…"></label></form>`, foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="vf-ok">Salvar</button>' });
    $('#vf-ok', md.el).onclick = async () => { const f = $('#vf', md.el), k = parseNum(f.k.value); if (!(k >= 0)) return toast('Informe o preço', true);
      try { await q(sb.from('rec_resina_virgem').insert({ empresa_id: e, polimero: f.p.value, vigencia: f.v.value || today(), preco_kg: k, fonte: f.f.value.trim() || null })); md.close(); render(root); }
      catch (err) { fail(/duplicate|unique/.test(err.message) ? new Error('Já existe preço deste polímero nesta data.') : err); } };
  });
  $$('[data-drv]', c).forEach(b => b.onclick = async () => { try { await q(sb.from('rec_resina_virgem').delete().eq('id', b.dataset.drv)); render(root); } catch (err) { fail(err); } });
}
