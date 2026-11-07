// Contabilidade › Patrimônio › Parâmetros do Imobilizado (SQL 084): regras de depreciação, contas contábeis e créditos
// por classe, valor mínimo, NCMs e classificações que indicam compra de bens. Tudo aqui, nada fixo no código.
import { sb, state, q, fetchAll, loadCadastros, podeEditar } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, money, parseNum, erroTela } from '../lib/ui.js';
import * as I from '../lib/imobilizado.js';

export const title = 'Parâmetros do Imobilizado';
let D = null;
const nf = (v, c = 2) => v == null || v === '' ? '' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

async function carregar() {
  const e = state.empresa.id; await loadCadastros();
  const [P, K, Ct, B] = await Promise.all([
    q(sb.from('af_parametros').select('*').eq('empresa_id', e)),
    q(sb.from('af_classes').select('*').eq('empresa_id', e).order('codigo')),
    fetchAll(() => sb.from('contab_contas').select('id,classificacao,descricao,tipo,natureza').eq('empresa_id', e).eq('tipo', 'A').order('classificacao')),
    fetchAll(() => sb.from('af_bens').select('id,classe_id,situacao').eq('empresa_id', e).order('id')),
  ]);
  D = { P: P[0] || null, K, Ct, ctById: Object.fromEntries(Ct.map(c => [c.id, c])), nBens: B.reduce((m, b) => (m[b.classe_id] = (m[b.classe_id] || 0) + 1, m), {}) };
}
const conta = (id) => { const c = D.ctById[id]; return c ? `${c.classificacao} ${c.descricao}` : ''; };
const selConta = (name, sel) => `<select name="${name}"><option value="">— sem conta —</option>${D.Ct.map(c => `<option value="${c.id}" ${sel === c.id ? 'selected' : ''}>${esc(c.classificacao)} ${esc(c.descricao)}</option>`).join('')}</select>`;

// palavras de cada classe para sugerir as contas do plano da contabilidade
const PALAVRAS = { TER: ['TERRENO'], EDI: ['EDIFIC', 'PREDIO', 'CONSTRU', 'IMOVE'], INS: ['INSTALAC'], MAQ: ['MAQUINA', 'EQUIPAMENTO'], EMP: ['EMPILHAD', 'MAQUINA'], VCG: ['VEICUL', 'CAMINH'],
  VPS: ['VEICUL', 'AUTOMOV'], INF: ['COMPUTAD', 'INFORMAT', 'PROCESSAMENTO'], MOV: ['MOVEIS', 'UTENSIL'], FER: ['FERRAMENT'], SOF: ['SOFTWARE', 'PROGRAMA', 'INTANG'] };
export function sugerirContas(k, contas) {
  const pal = PALAVRAS[k.codigo] || [norm(k.nome).split(' ')[0]];
  const tem = (c) => pal.some(p => norm(c.descricao).includes(p));
  const ehDep = (c) => /DEPREC|AMORTIZ/.test(norm(c.descricao));
  const ativo = contas.find(c => c.classificacao.startsWith('1.2') && c.natureza === 'D' && !ehDep(c) && tem(c));
  const deprec = contas.find(c => c.classificacao.startsWith('1.2') && ehDep(c) && tem(c)) || contas.find(c => c.classificacao.startsWith('1.2') && ehDep(c) && k.codigo === 'SOF' && /AMORTIZ/.test(norm(c.descricao)));
  const desp = contas.find(c => /^[34]/.test(c.classificacao) && c.natureza === 'D' && (k.codigo === 'SOF' ? /AMORTIZ/ : /DEPRECIA/).test(norm(c.descricao)));
  return { conta_ativo_id: ativo?.id || null, conta_deprec_id: k.deprecia ? deprec?.id || null : null, conta_despesa_id: k.deprecia ? desp?.id || null : null };
}

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try { await carregar(); } catch (e) { console.error(e); root.innerHTML = erroTela('os parâmetros do imobilizado (rode o SQL 084 se ainda não rodou)'); return; }
  const P = D.P || { prefixo: 'PAT', regra_inicio: 'mes_seguinte', gerar_contabil: true, valor_minimo: 1200, ncm_imobilizado: [], planos_imobilizado: [], pis_cofins_ate: '2026-12-31' };
  const ed = podeEditar(), dis = ed ? '' : 'disabled';
  const semConta = D.K.filter(k => k.deprecia && D.nBens[k.id] && (!k.conta_ativo_id || !k.conta_deprec_id || !k.conta_despesa_id));
  root.innerHTML = `<style>#pf label.chk{flex-direction:row;align-items:center;gap:8px;font-weight:400;align-self:end;padding-bottom:10px}#pf label.chk input{width:auto;min-height:0}</style>
    <div class="mm-topo"><div><h2 style="margin:0">Parâmetros do Imobilizado</h2><div class="muted small">Regras da depreciação, contas contábeis e créditos de cada classe. Vale para os próximos cálculos.</div></div>
      <a class="btn ghost" href="#/contab/imobilizado">Voltar ao Ativo Imobilizado</a></div>
    ${!D.Ct.length ? '<div class="card" style="border-color:var(--warn)">O plano de contas da contabilidade ainda não foi importado (Contabilidade › De-para). Sem ele, a depreciação é calculada mas não vira lançamento contábil.</div>' : ''}
    <div class="card"><h3 style="margin-top:0">Regras gerais</h3><form id="pf"><div class="grid-form">
      <label class="xs">Prefixo da plaqueta<input name="prefixo" value="${esc(P.prefixo)}" maxlength="6" ${dis}></label>
      <label class="span2">Início da depreciação<select name="regra_inicio" ${dis}>${Object.entries(I.REGRAS_INICIO).map(([k, t]) => `<option value="${k}" ${P.regra_inicio === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="xs">Valor mínimo (R$)<input name="valor_minimo" inputmode="decimal" value="${nf(P.valor_minimo)}" ${dis} title="RIR/2018, art. 313: bem de valor unitário até R$ 1.200 pode ir direto para despesa"></label>
      <label class="xs">PIS/COFINS até<input type="date" name="pis_cofins_ate" value="${P.pis_cofins_ate || '2026-12-31'}" ${dis} title="LC 214/2025: CBS a partir de 2027"></label>
      <label class="span2">Custo do bem baixado (conta contábil)${selConta('conta_custo_baixa_id', P.conta_custo_baixa_id).replace('<select', `<select ${dis}`)}</label>
      <label class="chk span2"><input type="checkbox" name="gerar_contabil" ${P.gerar_contabil ? 'checked' : ''} ${dis}> Gerar o lançamento contábil ao calcular o mês</label>
      <label class="full">Classificações do nosso plano usadas na compra de bens (aparecem em "A imobilizar")
        <select name="planos" multiple size="8" data-nobusca ${dis}>${state.cad.plano.filter(p => p.nivel >= 2 && p.natureza !== 'C').map(p => `<option value="${p.id}" ${(P.planos_imobilizado || []).includes(p.id) ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>
        <span class="muted small">Ctrl/⌘ + clique para escolher várias.</span></label>
      <label class="full">NCMs de bens duráveis (4 dígitos, separados por vírgula)<textarea name="ncm" rows="3" ${dis}>${esc((P.ncm_imobilizado || []).join(', '))}</textarea>
        <span class="muted small">Item de NF-e de entrada com um destes NCMs e valor unitário a partir do mínimo vira candidato. Produto do tipo 08 (ativo imobilizado) no cadastro sempre vira.</span></label>
    </div>${ed ? '<div class="toolbar" style="margin-top:8px"><span class="spacer"></span><button class="btn primary" type="button" id="pf-ok">Salvar regras</button></div>' : ''}</form></div>
    <div class="card" style="margin-top:16px"><div class="toolbar"><h3 style="margin:0">Classes de bens</h3><span class="spacer"></span>
      ${ed ? `${D.K.length ? '' : '<button class="btn" id="kl-padrao">Criar as classes de partida</button>'}${D.Ct.length && D.K.length ? '<button class="btn" id="kl-sug">Sugerir contas pelo plano da contabilidade</button>' : ''}<button class="btn primary" id="kl-novo">+ Nova classe</button>` : ''}</div>
      ${semConta.length ? `<div class="muted small" style="color:var(--warn)">⚠️ ${semConta.length} classe(s) com bens e sem as três contas: ${semConta.map(k => k.codigo).join(', ')}. A depreciação delas não vira lançamento contábil.</div>` : ''}
      <div class="table-wrap"><table><tr><th>Classe<div class="small">Observação</div></th><th class="num">Taxa fiscal<div class="small">% a.a.</div></th><th class="num">Vida útil<div class="small">meses</div></th>
        <th>Contas contábeis<div class="small">bem · depr. acumulada · despesa</div></th><th>Créditos</th><th class="num">Bens</th></tr>
      ${D.K.map(k => `<tr class="clickable" data-k="${k.id}"><td class="wrap"><b>${esc(k.codigo)}</b> ${esc(k.nome)}${k.ativo ? '' : ' <span class="muted">(inativa)</span>'}<div class="small muted">${esc(k.observacao || '')}</div></td>
        <td class="num">${k.deprecia ? nf(k.taxa_fiscal) : 'não deprecia'}</td><td class="num">${k.deprecia ? k.vida_util_meses : '–'}${+k.residual_pct ? `<div class="small muted">residual ${nf(k.residual_pct)}%</div>` : ''}</td>
        <td class="wrap small">${[k.conta_ativo_id, k.conta_deprec_id, k.conta_despesa_id].map((id, i) => `<div>${['Bem', 'Depr.', 'Desp.'][i]}: ${id ? esc(conta(id)) : '<span style="color:var(--warn)">—</span>'}</div>`).join('')}</td>
        <td class="small">${k.ciap ? 'CIAP · ' : ''}${I.CREDITOS[k.credito_pis_cofins]}</td><td class="num">${D.nBens[k.id] || 0}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhuma classe.</td></tr>'}</table></div>
      <p class="muted small">Taxa fiscal: Anexo III da IN RFB 1.700/2017 (vai para a depreciação fiscal e o LALUR). Vida útil: estimativa da empresa (CPC 27), revista ao menos no fim de cada exercício.
        Crédito imediato de PIS/COFINS só para máquinas e equipamentos da produção adquiridos desde 07/2012 (Lei 11.774/2008, art. 1º, XII); veículos não (SC Cosit 215/2017). Confirme cada classe com a contabilidade.</p></div>`;
  const pf = $('#pf-ok', root); if (pf) pf.onclick = async () => {
    const f = $('#pf', root);
    const ncm = f.ncm.value.split(/[\s,;]+/).map(x => x.replace(/\D/g, '').slice(0, 4)).filter(x => x.length === 4);
    try { await q(sb.from('af_parametros').upsert({ empresa_id: state.empresa.id, prefixo: f.prefixo.value.trim().toUpperCase() || 'PAT', regra_inicio: f.regra_inicio.value, valor_minimo: parseNum(f.valor_minimo.value),
      conta_custo_baixa_id: f.conta_custo_baixa_id.value || null, pis_cofins_ate: f.pis_cofins_ate.value || '2026-12-31', gerar_contabil: f.gerar_contabil.checked,
      planos_imobilizado: [...f.planos.selectedOptions].map(o => o.value), ncm_imobilizado: [...new Set(ncm)] }));
      toast('Regras salvas'); render(root); } catch (e) { fail(e); }
  };
  const pd = $('#kl-padrao', root); if (pd) pd.onclick = async () => { try { const n = await q(sb.rpc('af_classes_padrao', { p_empresa: state.empresa.id })); toast(`${n} classes criadas`); render(root); } catch (e) { fail(e); } };
  const sg = $('#kl-sug', root); if (sg) sg.onclick = () => {
    const sug = D.K.map(k => ({ k, s: sugerirContas(k, D.Ct) })).map(({ k, s }) => ({ k, s: Object.fromEntries(Object.entries(s).filter(([c, v]) => v && !k[c])) })).filter(x => Object.keys(x.s).length);
    if (!sug.length) return toast('Nenhuma conta nova para sugerir (as classes já têm conta ou o plano não tem nomes parecidos).');
    const md = modal({ title: 'Contas sugeridas', wide: true, body: `<p class="muted">Pelo nome das contas do plano da contabilidade. Só preenche o que está vazio. Desmarque o que não servir.</p>
      <div class="table-wrap"><table><tr><th></th><th>Classe</th><th>Campo</th><th>Conta sugerida</th></tr>${sug.flatMap(({ k, s }) => Object.entries(s).map(([c, v]) => `<tr><td><input type="checkbox" checked data-k="${k.id}" data-c="${c}" data-v="${v}"></td>
        <td>${esc(k.codigo)} ${esc(k.nome)}</td><td>${{ conta_ativo_id: 'Bem', conta_deprec_id: 'Depreciação acumulada', conta_despesa_id: 'Despesa' }[c]}</td><td>${esc(conta(v))}</td></tr>`)).join('')}</table></div>`,
      foot: '<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="sg-ok">Aplicar</button>' });
    $('#sg-ok', md.el).onclick = async () => {
      const por = {}; $$('input[data-k]:checked', md.el).forEach(x => { (por[x.dataset.k] ||= {})[x.dataset.c] = x.dataset.v; });
      try { for (const [id, upd] of Object.entries(por)) await q(sb.from('af_classes').update(upd).eq('id', id)); md.close(); toast('Contas aplicadas'); render(root); } catch (e) { fail(e); }
    };
  };
  const nv = $('#kl-novo', root); if (nv) nv.onclick = () => formClasse(null, root);
  if (ed) $$('[data-k]', root).forEach(tr => tr.onclick = () => formClasse(D.K.find(k => k.id === tr.dataset.k), root));
}

function formClasse(k, root) {
  const novo = !k; k = k || { deprecia: true, taxa_fiscal: 10, vida_util_meses: 120, residual_pct: 0, credito_pis_cofins: 'nenhum', ciap: false, ativo: true };
  const md = modal({ title: novo ? 'Nova classe' : `Classe ${k.codigo}`, wide: true, body: `<form id="kf">
    <fieldset><legend>Classe</legend><div class="grid-form">
      <label class="xs">Código *<input name="codigo" required maxlength="8" value="${esc(k.codigo || '')}"></label><label class="span2">Nome *<input name="nome" required value="${esc(k.nome || '')}"></label>
      <label class="chk"><input type="checkbox" name="deprecia" ${k.deprecia ? 'checked' : ''}> Deprecia</label><label class="chk"><input type="checkbox" name="ativo" ${k.ativo ? 'checked' : ''}> Ativa</label>
      <label class="xs">Taxa fiscal % a.a.<input name="taxa_fiscal" inputmode="decimal" value="${nf(k.taxa_fiscal)}"></label>
      <label class="xs">Vida útil (meses)<input name="vida_util_meses" type="number" min="1" value="${k.vida_util_meses}"></label>
      <label class="xs">Residual %<input name="residual_pct" inputmode="decimal" value="${nf(k.residual_pct)}"></label>
      <div class="xs muted small" id="kf-dica" style="align-self:end;padding-bottom:8px"></div></div></fieldset>
    <fieldset><legend>Contas contábeis</legend><div class="grid-form">
      <label class="c4">Bem (custo)${selConta('conta_ativo_id', k.conta_ativo_id)}</label><label class="c4">Depreciação acumulada${selConta('conta_deprec_id', k.conta_deprec_id)}</label>
      <label class="c4">Despesa / custo de depreciação${selConta('conta_despesa_id', k.conta_despesa_id)}</label></div></fieldset>
    <fieldset><legend>Créditos fiscais</legend><div class="grid-form">
      <label class="span2">PIS/COFINS<select name="credito_pis_cofins">${Object.entries(I.CREDITOS).map(([c, t]) => `<option value="${c}" ${k.credito_pis_cofins === c ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="chk span2"><input type="checkbox" name="ciap" ${k.ciap ? 'checked' : ''}> ICMS pelo CIAP (1/48 por mês)</label>
      <label class="full">Observação<textarea name="observacao" rows="2">${esc(k.observacao || '')}</textarea></label></div></fieldset></form>`,
    foot: `${!novo && !D.nBens[k.id] ? '<button class="btn danger" id="kf-del">Excluir</button>' : ''}<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="kf-ok">Salvar</button>` });
  const f = $('#kf', md.el);
  const dica = () => { const t = parseNum(f.taxa_fiscal.value); $('#kf-dica', md.el).textContent = t > 0 ? `fiscal = ${Math.round(1200 / t)} meses` : ''; };
  f.taxa_fiscal.oninput = dica; dica();
  $('#kf-ok', md.el).onclick = async () => {
    if (!f.reportValidity()) return;
    const reg = { codigo: f.codigo.value.trim().toUpperCase(), nome: f.nome.value.trim(), deprecia: f.deprecia.checked, ativo: f.ativo.checked, taxa_fiscal: parseNum(f.taxa_fiscal.value), vida_util_meses: +f.vida_util_meses.value || 1,
      residual_pct: parseNum(f.residual_pct.value), conta_ativo_id: f.conta_ativo_id.value || null, conta_deprec_id: f.conta_deprec_id.value || null, conta_despesa_id: f.conta_despesa_id.value || null,
      credito_pis_cofins: f.credito_pis_cofins.value, ciap: f.ciap.checked, observacao: f.observacao.value.trim() || null };
    try { if (novo) await q(sb.from('af_classes').insert({ ...reg, empresa_id: state.empresa.id })); else await q(sb.from('af_classes').update(reg).eq('id', k.id));
      md.close(); toast('Classe salva. Bens já cadastrados mantêm a vida útil e a taxa próprias.'); render(root); } catch (e) { fail(e); }
  };
  const dl = $('#kf-del', md.el); if (dl) dl.onclick = async () => { try { await q(sb.from('af_classes').delete().eq('id', k.id)); md.close(); toast('Classe excluída'); render(root); } catch (e) { fail(e); } };
}
