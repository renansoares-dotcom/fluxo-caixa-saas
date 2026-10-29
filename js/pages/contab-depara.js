// Contabilidade › De-para: liga a plataforma ao plano de contas da contabilidade.
//  - Classificações: conta contábil da contrapartida de cada classificação do nosso plano
//  - Contas bancárias: conta contábil de cada conta (e a de saldo negativo, ex.: cheque especial)
//  - Beneficiários: conta própria do cliente/fornecedor/adiantamento na contabilidade
// Pode ser preenchido aqui ou importado da planilha de sugestão revisada.
import { sb, state, q, fetchAll, podeEditar } from '../lib/data.js';
import { $, esc, toast, fail, loading, modal, debounce } from '../lib/ui.js';

export const title = 'De-para contábil';

const TRAT = [['resultado', 'Direto no resultado'], ['fornecedor', 'Baixa de fornecedor'], ['cliente', 'Baixa de cliente'], ['obrigacao', 'Baixa de obrigação'],
  ['ativo', 'Ativo'], ['financiamento', 'Financiamento / FIDC'], ['transferencia', 'Transferência']];
const PAPEIS = [['cliente', 'Cliente', '1.1.20.1'], ['fornecedor', 'Fornecedor', '2.1.30.'], ['adiant_fornecedor', 'Adiant. a fornecedor', '1.1.30.5'],
  ['adiant_cliente', 'Adiant. de cliente', '2.1.60.1'], ['outras_obrig', 'Outras obrigações', '2.1.60.6']];
// o papel sai do grupo da conta: conta de clientes → usa a conta do cliente, etc.
export function papelDaConta(cls) {
  const em = (grupo, pre) => cls === grupo || cls.startsWith(pre);
  if (em('1.1.20.1', '1.1.20.100.')) return 'cliente';
  if (em('2.1.30.1', '2.1.30.100.') || em('2.1.30.2', '2.1.30.200.')) return 'fornecedor';
  if (em('1.1.30.5', '1.1.30.500.')) return 'adiant_fornecedor';
  if (em('2.1.60.1', '2.1.60.100.')) return 'adiant_cliente';
  if (em('2.1.60.6', '2.1.60.600.')) return 'outras_obrig';
  return null;
}

const ui = { aba: 'plano', busca: '', filtro: 'todos' };
let D = null;

export async function render(root) {
  root.innerHTML = `
    <div class="toolbar">
      <div class="chips" id="abas"></div>
      <label>Buscar<input id="bus" value="${esc(ui.busca)}" placeholder="nome ou código"></label>
      <label>Mostrar<select id="flt"><option value="todos">Todos</option><option value="sem">Sem conta contábil</option><option value="com">Com conta contábil</option></select></label>
      <span class="spacer"></span>
      ${podeEditar() ? '<button class="btn" id="imp">Importar planilha revisada</button>' : ''}
    </div>
    <div id="resumo" class="muted small" style="margin-bottom:8px"></div>
    <div class="card flush"><div class="table-wrap" id="tbl"></div></div>
    <datalist id="dl-todas"></datalist>${PAPEIS.map(([k]) => `<datalist id="dl-${k}"></datalist>`).join('')}`;
  $('#flt', root).value = ui.filtro;
  $('#abas', root).onclick = (e) => { const a = e.target.closest('[data-aba]')?.dataset.aba; if (a) { ui.aba = a; pintar(root); } };
  $('#bus', root).oninput = debounce((e) => { ui.busca = e.target.value.trim().toLowerCase(); pintar(root); }, 250);
  $('#flt', root).onchange = (e) => { ui.filtro = e.target.value; pintar(root); };
  if ($('#imp', root)) $('#imp', root).onclick = () => importarPlanilha(root);
  await carregar(root);
}

async function carregar(root) {
  const tbl = $('#tbl', root); loading(tbl);
  try {
    const e = state.empresa.id;
    const [contas, dp, dc, df, uso] = await Promise.all([
      fetchAll(() => sb.from('contab_contas').select('id, codigo, classificacao, descricao, tipo, nivel').eq('empresa_id', e).order('classificacao')),
      fetchAll(() => sb.from('contab_depara_plano').select('*').eq('empresa_id', e)),
      fetchAll(() => sb.from('contab_depara_conta').select('*').eq('empresa_id', e)),
      fetchAll(() => sb.from('contab_depara_favorecido').select('*').eq('empresa_id', e)),
      fetchAll(() => sb.from('lancamentos').select('plano_id, favorecido_id').eq('empresa_id', e).eq('status', 'Pago')),
    ]);
    const nPlano = {}, nFav = {};
    for (const u of uso) { nPlano[u.plano_id] = (nPlano[u.plano_id] || 0) + 1; if (u.favorecido_id) nFav[u.favorecido_id] = (nFav[u.favorecido_id] || 0) + 1; }
    D = { contas, byId: new Map(contas.map(c => [c.id, c])), byCls: new Map(contas.map(c => [c.classificacao, c])),
      dp: new Map(dp.map(x => [x.plano_id, x])), dc: new Map(dc.map(x => [x.conta_bancaria_id, x])),
      df: new Map(df.map(x => [x.favorecido_id + '|' + x.papel, x])), nPlano, nFav };
    if (!contas.length) { tbl.innerHTML = '<div class="empty">Importe primeiro o balancete da contabilidade (Contabilidade › Balancete): o plano de contas contábil vem dele.</div>'; return; }
    const opt = (c) => `<option value="${esc(rotulo(c))}">`;
    $('#dl-todas', root).innerHTML = contas.map(opt).join('');
    for (const [k, , pre] of PAPEIS) $(`#dl-${k}`, root).innerHTML = contas.filter(c => c.tipo === 'A' && c.classificacao.startsWith(pre)).map(opt).join('');
    pintar(root);
  } catch (err) {
    fail(err);
    tbl.innerHTML = /contab_/.test(err.message || '') ? '<div class="empty">Não foi possível carregar a contabilidade. Recarregue a página.</div>' : '';
  }
}

const rotulo = (c) => `${c.classificacao} — ${c.descricao}`;
const contaDoTexto = (t) => { const cls = String(t || '').split('—')[0].trim().split(/\s/)[0]; return D.byCls.get(cls) || null; };
const inp = (lista, conta, attrs) => `<input class="dp-in" list="${lista}" value="${conta ? esc(rotulo(conta)) : ''}" placeholder="classificação…" ${attrs} ${podeEditar() ? '' : 'disabled'}>`;
const passa = (txt, tem) => (!ui.busca || txt.toLowerCase().includes(ui.busca)) && (ui.filtro === 'todos' || (ui.filtro === 'com') === tem);

function pintar(root) {
  if (!D) return;
  const cad = state.cad;
  const planos = cad.plano.filter(p => p.nivel === 2 && (D.nPlano[p.id] || D.dp.has(p.id)));
  const totP = planos.length, okP = planos.filter(p => D.dp.has(p.id)).length;
  const okC = cad.contas.filter(c => D.dc.has(c.id)).length;
  const favs = cad.favorecidos.filter(f => D.nFav[f.id]);
  const okF = favs.filter(f => PAPEIS.some(([k]) => D.df.has(f.id + '|' + k))).length;
  $('#abas', root).innerHTML = [['plano', `Classificações ${okP}/${totP}`], ['contas', `Contas bancárias ${okC}/${cad.contas.length}`], ['fav', `Beneficiários ${okF}/${favs.length}`]]
    .map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-aba="${k}">${t}</span>`).join('');
  const tbl = $('#tbl', root);
  if (ui.aba === 'plano') {
    $('#resumo', root).textContent = 'Classificações com lançamento pago. A conta contábil recebe a contrapartida do banco. Contas de clientes/fornecedores/adiantamentos usam a conta própria do beneficiário (aba Beneficiários) quando houver.';
    const rows = planos.filter(p => passa(p.label, D.dp.has(p.id)));
    tbl.innerHTML = `<table><thead><tr><th>Classificação</th><th class="num">Lanç. pagos</th><th>Conta contábil</th><th>Tratamento</th><th>Usa conta do beneficiário</th></tr></thead><tbody>
      ${rows.map(p => { const d = D.dp.get(p.id), c = d?.conta_id && D.byId.get(d.conta_id);
        return `<tr data-p="${p.id}" class="${d ? '' : 'dp-falta'}"><td>${esc(p.label)}</td><td class="num">${D.nPlano[p.id] || 0}</td>
          <td style="min-width:340px">${p.tipo === 'T' ? '<span class="muted small">banco ↔ banco (contas bancárias)</span>' : inp('dl-todas', c, 'data-k="conta"')}</td>
          <td><select class="dp-tr" ${podeEditar() ? '' : 'disabled'}><option value=""></option>${TRAT.map(([k, n]) => `<option value="${k}" ${d?.tratamento === k || (!d && p.tipo === 'T' && k === 'transferencia') ? 'selected' : ''}>${n}</option>`).join('')}</select></td>
          <td class="small">${d?.papel ? esc(PAPEIS.find(x => x[0] === d.papel)?.[1] || '') : '<span class="muted">—</span>'}</td></tr>`; }).join('')}</tbody></table>`;
  } else if (ui.aba === 'contas') {
    $('#resumo', root).textContent = 'Conta contábil de cada conta da plataforma. "Se negativo" é a conta para onde vai o saldo devedor no fim do mês (ex.: cheque especial), como faz a contabilidade.';
    const rows = cad.contas.filter(c => passa(c.nome, D.dc.has(c.id)));
    tbl.innerHTML = `<table><thead><tr><th>Conta (plataforma)</th><th>Tipo</th><th>Conta contábil</th><th>Se negativo</th></tr></thead><tbody>
      ${rows.map(c => { const d = D.dc.get(c.id);
        return `<tr data-c="${c.id}" class="${d ? '' : 'dp-falta'}"><td>${esc(c.nome)}</td><td class="small muted">${esc(c.tipo || '')}</td>
          <td style="min-width:340px">${inp('dl-todas', d && D.byId.get(d.conta_id), 'data-k="conta"')}</td>
          <td style="min-width:300px">${inp('dl-todas', d?.conta_negativa_id && D.byId.get(d.conta_negativa_id), 'data-k="neg"')}</td></tr>`; }).join('')}</tbody></table>`;
  } else {
    $('#resumo', root).textContent = 'Beneficiários com lançamento pago e a conta de cada um na contabilidade. Sem conta, o lançamento usa a conta-mãe da classificação (ex.: Fornecedores).';
    const rows = favs.filter(f => passa(f.nome + ' ' + (f.documento || ''), PAPEIS.some(([k]) => D.df.has(f.id + '|' + k)))).sort((a, b) => (D.nFav[b.id] || 0) - (D.nFav[a.id] || 0));
    tbl.innerHTML = `<table><thead><tr><th>Beneficiário</th><th class="num">Lanç.</th>${PAPEIS.map(([, n]) => `<th>${n}</th>`).join('')}</tr></thead><tbody>
      ${rows.slice(0, 400).map(f => `<tr data-f="${f.id}"><td>${esc(f.nome)}<div class="small muted">${esc(f.documento || '')}</div></td><td class="num">${D.nFav[f.id] || 0}</td>
        ${PAPEIS.map(([k]) => { const d = D.df.get(f.id + '|' + k); return `<td style="min-width:230px">${inp('dl-' + k, d && D.byId.get(d.conta_id), `data-k="${k}"`)}</td>`; }).join('')}</tr>`).join('')}</tbody></table>
      ${rows.length > 400 ? `<div class="muted small" style="padding:8px">Mostrando 400 de ${rows.length}. Use a busca.</div>` : ''}`;
  }
  tbl.onchange = (e) => salvarCampo(e, root);
}

async function salvarCampo(e, root) {
  const el = e.target, tr = el.closest('tr'), emp = state.empresa.id;
  try {
    if (el.matches('.dp-in')) {
      const c = el.value.trim() ? contaDoTexto(el.value) : null;
      if (el.value.trim() && !c) { toast('Conta contábil não encontrada: escolha da lista', true); el.classList.add('neg'); return; }
      el.classList.remove('neg');
      if (tr.dataset.p) {
        const ant = D.dp.get(tr.dataset.p);
        const trat = $('.dp-tr', tr).value || ant?.tratamento || 'resultado';
        if (!c && !ant) return;
        const row = { plano_id: tr.dataset.p, empresa_id: emp, conta_id: c?.id || null, tratamento: trat, papel: c ? papelDaConta(c.classificacao) : null };
        const [r] = await q(sb.from('contab_depara_plano').upsert(row).select()); D.dp.set(r.plano_id, r);
      } else if (tr.dataset.c) {
        const ant = D.dc.get(tr.dataset.c);
        if (el.dataset.k === 'conta' && !c) { if (ant) { await q(sb.from('contab_depara_conta').delete().eq('conta_bancaria_id', tr.dataset.c)); D.dc.delete(tr.dataset.c); } }
        else {
          if (!ant && el.dataset.k === 'neg') { toast('Informe primeiro a conta contábil principal', true); el.value = ''; return; }
          const row = { conta_bancaria_id: tr.dataset.c, empresa_id: emp, conta_id: el.dataset.k === 'conta' ? c.id : ant.conta_id, conta_negativa_id: el.dataset.k === 'neg' ? (c?.id || null) : (ant?.conta_negativa_id || null) };
          const [r] = await q(sb.from('contab_depara_conta').upsert(row).select()); D.dc.set(r.conta_bancaria_id, r);
        }
      } else if (tr.dataset.f) {
        const k = el.dataset.k, key = tr.dataset.f + '|' + k;
        if (!c) { await q(sb.from('contab_depara_favorecido').delete().eq('favorecido_id', tr.dataset.f).eq('papel', k)); D.df.delete(key); }
        else { const [r] = await q(sb.from('contab_depara_favorecido').upsert({ favorecido_id: tr.dataset.f, papel: k, empresa_id: emp, conta_id: c.id }).select()); D.df.set(key, r); }
      }
      toast('Salvo');
    } else if (el.matches('.dp-tr') && tr.dataset.p) {
      const ant = D.dp.get(tr.dataset.p);
      const row = { plano_id: tr.dataset.p, empresa_id: emp, conta_id: ant?.conta_id || null, tratamento: el.value || 'resultado', papel: ant?.papel || null };
      const [r] = await q(sb.from('contab_depara_plano').upsert(row).select()); D.dp.set(r.plano_id, r); toast('Salvo');
    }
    pintar(root);
  } catch (err) { fail(err); }
}

// ------------------------------------------------------------------ planilha de sugestão revisada
const TRAT_TXT = Object.fromEntries(TRAT.map(([k, n]) => [n.toLowerCase(), k]));
async function importarPlanilha(root) {
  const m = modal({ title: 'Importar planilha de de-para revisada', wide: true,
    body: `<p class="small muted" style="margin-top:0">Use a planilha <strong>depara_contabil_sugestao.xlsx</strong> depois de revisada. Em cada linha vale a coluna <strong>“Sua correção”</strong> quando preenchida; senão, a sugestão.
      Na aba de clientes e fornecedores, <strong>apague as sugestões erradas</strong> antes de importar: toda célula preenchida é gravada.</p>
      <input type="file" id="arq" accept=".xlsx"><div id="res" style="margin-top:12px"></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="grv" disabled>Gravar de-para</button>' });
  let plano = [], contas = [], favs = [];
  const res = $('#res', m.el), grv = $('#grv', m.el);
  $('#arq', m.el).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return; loading(res, 'Lendo…');
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const aoa = (n) => wb.Sheets[n] ? XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' }).slice(1) : [];
      const cad = state.cad, erros = [];
      const planoPorCod = new Map(cad.plano.map(p => [p.codigo, p])), contaPorNome = new Map(cad.contas.map(c => [c.nome.trim().toUpperCase(), c]));
      const favPorNome = new Map(cad.favorecidos.map(x => [x.nome.trim().toUpperCase(), x]));
      const conta = (txt, onde) => { const t = String(txt || '').trim(); if (!t) return null; const c = contaDoTexto(t); if (!c) erros.push(`${onde}: conta "${t}" não existe no plano contábil`); return c; };
      plano = aoa('Classificações').filter(r => r[0]).map(r => {
        const p = planoPorCod.get(String(r[0]).trim()); if (!p) { erros.push(`Classificação ${r[0]} não existe na plataforma`); return null; }
        const c = conta(r[8] || r[4], `Classificação ${r[0]}`); const trat = TRAT_TXT[String(r[6]).trim().toLowerCase()] || (p.tipo === 'T' ? 'transferencia' : 'resultado');
        if (!c && trat !== 'transferencia') return null;
        return { plano_id: p.id, empresa_id: state.empresa.id, conta_id: c?.id || null, tratamento: trat, papel: c ? papelDaConta(c.classificacao) : null };
      }).filter(Boolean);
      contas = aoa('Contas bancárias').filter(r => r[0]).map(r => {
        const cb = contaPorNome.get(String(r[0]).trim().toUpperCase()); if (!cb) { erros.push(`Conta "${r[0]}" não existe na plataforma`); return null; }
        const c = conta(r[8] || r[3], `Conta ${r[0]}`); if (!c) return null;
        let neg = null;
        if (cb.nome === 'BRADESCO') neg = D.byCls.get('2.1.10.100.0022'); else if (cb.nome === 'ITAÚ - MOVIMENTO') neg = D.byCls.get('2.1.10.100.0026');
        return { conta_bancaria_id: cb.id, empresa_id: state.empresa.id, conta_id: c.id, conta_negativa_id: neg?.id || null };
      }).filter(Boolean);
      favs = [];
      for (const r of aoa('Clientes e fornecedores')) {
        if (!r[0]) continue; const fv = favPorNome.get(String(r[0]).trim().toUpperCase()); if (!fv) continue;
        PAPEIS.forEach(([k], i) => { const c = conta(r[4 + 2 * i], `${r[0]} (${k})`); if (c) favs.push({ favorecido_id: fv.id, papel: k, empresa_id: state.empresa.id, conta_id: c.id }); });
      }
      res.innerHTML = `<ul class="bal-check"><li>${plano.length} classificações</li><li>${contas.length} contas bancárias</li><li>${favs.length} contas de beneficiários</li></ul>
        ${erros.length ? `<div class="card"><strong class="neg">${erros.length} linha(s) com problema (não serão gravadas):</strong><ul class="small">${erros.slice(0, 30).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
        <p class="small muted">Gravar substitui o de-para destas linhas (o que não está na planilha não é apagado).</p>`;
      grv.disabled = !(plano.length || contas.length || favs.length);
    } catch (err) { console.error(err); res.innerHTML = `<div class="card neg">Não foi possível ler a planilha: ${esc(err.message || err)}</div>`; }
  };
  grv.onclick = async () => {
    grv.disabled = true; grv.textContent = 'Gravando…';
    try {
      // a mesma chave pode aparecer duas vezes na planilha (ex.: beneficiário com nome repetido): vale a última
      const unico = (rows, on) => [...new Map(rows.map(r => [on.split(',').map(k => r[k]).join('|'), r])).values()];
      const lote = async (t, rows, on) => { rows = unico(rows, on); for (let i = 0; i < rows.length; i += 500) await q(sb.from(t).upsert(rows.slice(i, i + 500), { onConflict: on })); };
      await lote('contab_depara_plano', plano, 'plano_id');
      await lote('contab_depara_conta', contas, 'conta_bancaria_id');
      await lote('contab_depara_favorecido', favs, 'favorecido_id,papel');
      toast('De-para gravado'); m.close(); carregar(root);
    } catch (err) { fail(err); grv.disabled = false; grv.textContent = 'Gravar de-para'; }
  };
}
