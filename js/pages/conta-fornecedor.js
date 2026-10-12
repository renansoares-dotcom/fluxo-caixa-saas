// Conta-corrente de fornecedor: pagamentos antecipados × notas fiscais recebidas.
// Pensada para a industrialização em Manaus (a IPLAMM adianta o dinheiro, o parceiro compra a resina, produz e
// fatura bobina/composto com o serviço embutido), mas serve para qualquer fornecedor pago antes da nota.
// - "Pago ao parceiro" = lançamentos pagos ao fornecedor (natureza D)
// - cada pagamento pode ser registrado como adiantamento (tabela creditos, natureza fornecedor)
// - cada nota de entrada consome adiantamentos (creditos_usos) — conciliação sugerida por ordem de data
import { sb, state, q, fetchAll, loadCadastros, podeEditar } from '../lib/data.js';
import { $, esc, money, dateBR, fail, toast, modal, exportXLSX, today } from '../lib/ui.js';
import { creditosComSaldo, mesmoGrupo, desfazerUso } from '../lib/creditos.js';

export const title = 'Conta-corrente de fornecedor';
const LS = 'contaForn.fav';
const ui = { aba: 'extrato', aberta: null };
let D = null;   // dados carregados do fornecedor

const dig = (s) => String(s || '').replace(/\D/g, '');
const normN = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const chunks = (a, k = 150) => { const o = []; for (let i = 0; i < a.length; i += k) o.push(a.slice(i, i + k)); return o; };
const r2 = (v) => Math.round(v * 100) / 100;
const KG = new Set(['KG', 'KGS', 'KILO', 'KILOS', 'QUILO', 'QUILOS', 'K G']);
const ehKg = (u) => KG.has(normN(u));
const kg = (v) => v == null ? '–' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(v) + ' kg';
const histDesc = (d) => { if (!d || d === '-') return ''; if (/adiantamento/i.test(d)) { const n = d.match(/FORNECEDORES (\d+)/i); return ` · adiantamento${n ? ' nº ' + n[1] : ''}`; } return ' · ' + d.slice(0, 60); };
const dias = (a, b = today()) => Math.round((new Date(b) - new Date(a)) / 864e5);
const lsGet = () => { try { return localStorage.getItem(LS); } catch { return null; } };
const lsSet = (v) => { try { localStorage.setItem(LS, v); } catch { /* sem storage */ } };

export async function render(root) {
  await loadCadastros();
  root.innerHTML = `
    <div class="card"><div class="card-head" style="margin-bottom:0">
      <div><h2 style="margin:0">Conta-corrente de fornecedor</h2><p class="muted small" style="margin:4px 0 0">Pagamentos antecipados ao fornecedor × notas fiscais que ele emite para a IPLAMM. O saldo mostra quanto do dinheiro adiantado ainda não voltou em nota (produto a receber).</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn" href="#/notas">Importar notas (XML)</a><button class="btn" id="exp">Exportar Excel</button></div></div>
      <div class="toolbar" style="margin-top:10px">
        <label class="grow">Fornecedor<input id="fav" list="cf-favs" placeholder="digite o nome ou CNPJ"><datalist id="cf-favs"></datalist></label>
      </div></div>
    <div id="cf-corpo"><div class="loading">Carregando…</div></div>`;
  const favs = await candidatos();
  const fornecedores = state.cad.favorecidos.filter(f => f.tipo === 'FORNECEDORES' || favs.has(f.id));
  const ord = [...fornecedores].sort((a, b) => (favs.get(b.id) || 0) - (favs.get(a.id) || 0) || a.nome.localeCompare(b.nome));
  $('#cf-favs', root).innerHTML = ord.map(f => `<option value="${esc(f.nome)}${f.documento ? ' · ' + esc(f.documento) : ''}"></option>`).join('');
  const rotulo = (f) => `${f.nome}${f.documento ? ' · ' + f.documento : ''}`;
  const acha = (v) => { const doc = dig(String(v).split('·')[1]); const nome = String(v).split(' · ')[0].trim(); return fornecedores.find(f => (doc && dig(f.documento) === doc) || f.nome === nome) || null; };
  const ini = state.cad.favById[lsGet()] || ord.find(f => favs.has(f.id));
  if (ini) $('#fav', root).value = rotulo(ini);
  $('#fav', root).onchange = () => { const f = acha($('#fav', root).value); if (f) { lsSet(f.id); ui.aberta = null; carregar(root, f.id); } };
  $('#exp', root).onclick = () => D && exportXLSX(linhasExcel(), `conta_corrente_${normN(state.cad.favById[D.favId]?.nome).replace(/ /g, '_').slice(0, 30)}`);
  if (ini) await carregar(root, ini.id);
  else $('#cf-corpo', root).innerHTML = '<div class="card"><div class="empty">Escolha o fornecedor.</div></div>';
}

/** fornecedores com adiantamento: Map id → total (para ordenar a lista) */
async function candidatos() {
  const m = new Map(); const e = state.empresa.id;
  try {
    for (const l of await fetchAll(() => sb.from('lancamentos').select('favorecido_id,valor').eq('empresa_id', e).ilike('descricao', '%adiantamento%').not('favorecido_id', 'is', null)))
      m.set(l.favorecido_id, (m.get(l.favorecido_id) || 0) + +l.valor);
    for (const c of await q(sb.from('creditos').select('favorecido_id,valor').eq('empresa_id', e).eq('natureza', 'fornecedor').eq('cancelado', false)))
      m.set(c.favorecido_id, (m.get(c.favorecido_id) || 0) + +c.valor);
  } catch { /* lista sem prioridade */ }
  return m;
}

async function carregar(root, favId) {
  const box = $('#cf-corpo', root); box.innerHTML = '<div class="loading">Carregando…</div>';
  const e = state.empresa.id, cad = state.cad, fav = cad.favById[favId], grupo = mesmoGrupo(favId), raiz = dig(fav?.documento).slice(0, 8);
  try {
    const lancs = (await fetchAll(() => sb.from('lancamentos').select('id,data,valor,descricao,documento,conta_id,plano_id,status').eq('empresa_id', e).in('favorecido_id', grupo).eq('status', 'Pago').order('data').order('id')))
      .filter(l => cad.planoById[l.plano_id]?.natureza !== 'C');
    let creds = [];
    try { creds = await creditosComSaldo({ favorecidos: grupo, natureza: 'fornecedor', todos: true }); } catch { creds = null; }
    const usos = [];
    if (creds?.length) for (const c of chunks(creds.map(x => x.id))) usos.push(...await q(sb.from('creditos_usos').select('id,credito_id,nota_id,parcela_id,valor,data,observacao').in('credito_id', c)));
    const COLS = 'id,chave,numero,serie,emissao,cfops,natureza,emit_doc,emit_nome,favorecido_id,v_prod,v_nf,v_icms,v_ipi,situacao,eventos,inf_cpl';
    const porId = new Map();
    for (const n of await q(sb.from('nfe_notas').select(COLS).eq('empresa_id', e).eq('tipo', 'entrada').eq('emissao_propria', false).in('favorecido_id', grupo))) porId.set(n.id, n);
    if (raiz.length === 8) for (const n of await q(sb.from('nfe_notas').select(COLS).eq('empresa_id', e).eq('tipo', 'entrada').eq('emissao_propria', false).like('emit_doc', raiz + '%'))) porId.set(n.id, n);
    // notas que parecem ser deste fornecedor, mas não estão ligadas ao cadastro (nome parecido)
    const pal = normN(fav?.nome).split(' ').filter(w => w.length > 2 && !['IND', 'COM', 'LTDA', 'INDUSTRIA', 'COMERCIO'].includes(w)).slice(0, 2);
    let soltas = [];
    if (pal.length) soltas = (await q(sb.from('nfe_notas').select(COLS).eq('empresa_id', e).eq('tipo', 'entrada').eq('emissao_propria', false).ilike('emit_nome', `%${pal.join('%')}%`)))
      .filter(n => !porId.has(n.id));
    const notas = [...porId.values()].filter(n => n.situacao !== 'cancelada').sort((a, b) => a.emissao.localeCompare(b.emissao) || a.numero - b.numero);
    const ids = notas.map(n => n.id), itens = [], parcelas = [];
    for (const c of chunks(ids)) {
      itens.push(...await q(sb.from('nfe_itens').select('nota_id,n_item,cprod,xprod,ncm,cfop,ucom,qcom,vprod').in('nota_id', c)));
      parcelas.push(...await q(sb.from('nfe_parcelas').select('id,nota_id,numero,vencimento,valor').in('nota_id', c)));
    }
    D = { favId, fav, lancs, creds, usos, notas, soltas, itens, parcelas };
    calcular(); pintar(root);
  } catch (err) { box.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; fail(err); }
}

function calcular() {
  const { lancs, creds, usos, notas, itens, parcelas } = D;
  const regPorLanc = new Map((creds || []).filter(c => c.lancamento_id).map(c => [c.lancamento_id, c]));
  D.naoReg = lancs.filter(l => !regPorLanc.has(l.id));
  D.regPorLanc = regPorLanc;
  const usoNota = new Map(); for (const u of usos) (usoNota.get(u.nota_id) || usoNota.set(u.nota_id, []).get(u.nota_id)).push(u);
  const itNota = new Map(); for (const i of itens) (itNota.get(i.nota_id) || itNota.set(i.nota_id, []).get(i.nota_id)).push(i);
  const pNota = new Map(); for (const p of parcelas) (pNota.get(p.nota_id) || pNota.set(p.nota_id, []).get(p.nota_id)).push(p);
  const devol = (n) => (n.eventos || []).some(ev => ev.tipo === 'devolucao_total');
  for (const n of notas) {
    n.usos = usoNota.get(n.id) || []; n.itens = (itNota.get(n.id) || []).sort((a, b) => a.n_item - b.n_item);
    n.parcelas = (pNota.get(n.id) || []).sort((a, b) => a.numero - b.numero);
    n.abatido = r2(n.usos.reduce((s, u) => s + +u.valor, 0)); n.falta = r2(+n.v_nf - n.abatido);
    const ik = n.itens.filter(i => ehKg(i.ucom)); n.kg = ik.length ? ik.reduce((s, i) => s + +i.qcom, 0) : null;
    n.rkg = n.kg ? ik.reduce((s, i) => s + +i.vprod, 0) / n.kg : null; n.devolvida = devol(n);
  }
  const validas = notas.filter(n => !n.devolvida);
  const T = D.tot = {
    pago: r2(lancs.reduce((s, l) => s + +l.valor, 0)),
    reg: r2((creds || []).reduce((s, c) => s + +c.valor, 0)),
    notas: r2(validas.reduce((s, n) => s + +n.v_nf, 0)),
    abatido: r2(usos.reduce((s, u) => s + +u.valor, 0)),
    kg: validas.reduce((s, n) => s + (n.kg || 0), 0),
  };
  T.saldo = r2(T.pago - T.notas);
  T.credSaldo = r2(T.reg - T.abatido);
  // exposição: os pagamentos mais antigos são cobertos primeiro pelas notas; o que sobra é o dinheiro ainda sem nota
  let cobre = T.notas; D.descobertos = [];
  for (const l of lancs) { const v = +l.valor; if (cobre >= v - 0.005) { cobre -= v; continue; } D.descobertos.push({ ...l, aberto: r2(v - Math.max(cobre, 0)) }); cobre = 0; }
  D.maisAntigo = D.descobertos[0]?.data || null;
  // extrato
  const ext = [
    ...lancs.map(l => ({ data: l.data, ord: 0, tipo: 'pag', hist: `Pagamento · ${state.cad.contaById[l.conta_id]?.nome || '—'}${histDesc(l.descricao)}`, deb: +l.valor, cred: 0, reg: D.regPorLanc.has(l.id) })),
    ...validas.map(n => ({ data: n.emissao, ord: 1, tipo: 'nf', hist: `NF ${n.numero}${n.kg ? ' · ' + kg(n.kg) : ''}${n.natureza ? ' · ' + n.natureza : ''}`, deb: 0, cred: +n.v_nf, nota: n })),
  ].sort((a, b) => a.data.localeCompare(b.data) || a.ord - b.ord);
  let s = 0; for (const x of ext) { s = r2(s + x.deb - x.cred); x.saldo = s; }
  D.extrato = ext;
}

function pintar(root) {
  const T = D.tot, box = $('#cf-corpo', root), fav = D.fav, ed = podeEditar();
  const idade = D.maisAntigo ? dias(D.maisAntigo) : 0;
  const alertas = [];
  if (!dig(fav?.documento)) alertas.push(['atencao', 'Cadastro', `O cadastro de <strong>${esc(fav?.nome)}</strong> está sem CNPJ. Sem ele, as notas só aparecem aqui se o nome no XML for igual ao do cadastro. ${ed ? '<button class="btn small" id="cnpj">Informar CNPJ</button>' : ''}`]);
  if (D.soltas.length) alertas.push(['atencao', 'Notas', `${D.soltas.length} nota(s) de entrada com nome parecido (<em>${esc(D.soltas[0].emit_nome)}</em>, ${money(D.soltas.reduce((s, n) => s + +n.v_nf, 0))}) não estão ligadas a este cadastro. ${ed ? '<button class="btn small" id="ligar">Ligar a este fornecedor</button>' : ''}`]);
  if (!D.notas.length && !D.soltas.length) alertas.push(['', 'Notas', 'Nenhuma nota deste fornecedor foi importada ainda. Importe os XML em <a href="#/notas">Notas Fiscais › Importar XML</a>; entradas são reconhecidas pelo próprio arquivo.']);
  if (D.creds === null) alertas.push(['atencao', 'Banco', 'A estrutura de créditos não foi encontrada no banco (SQL de créditos e adiantamentos).']);
  else if (D.naoReg.length) alertas.push(['', 'Adiantamentos', `${D.naoReg.length} pagamento(s) (${money(D.naoReg.reduce((s, l) => s + +l.valor, 0))}) ainda não estão registrados como adiantamento — registrar permite abater nas notas e aparece em Créditos e Adiantamentos. ${ed ? '<button class="btn small" id="reg">Registrar como adiantamento</button>' : ''}`]);
  const pend = D.notas.filter(n => !n.devolvida && n.falta > 0.005).length;
  if (D.creds && pend && D.creds.some(c => c.saldo > 0.005)) alertas.push(['', 'Conciliação', `${pend} nota(s) com valor ainda não abatido dos adiantamentos. ${ed ? '<button class="btn small" id="auto">Conciliar automaticamente</button>' : ''}`]);
  if (T.saldo > 0.005 && idade > 60) alertas.push(['atencao', 'Exposição', `Há ${money(D.descobertos.reduce((s, l) => s + l.aberto, 0))} adiantados sem nota; o pagamento mais antigo ainda descoberto é de ${dateBR(D.maisAntigo)} (${idade} dias).`]);
  if (T.saldo < -0.005) alertas.push(['atencao', 'Saldo', `As notas recebidas passam os pagamentos em ${money(-T.saldo)}: a IPLAMM deve ao fornecedor ou há pagamento lançado para outro cadastro.`]);

  box.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="k-label">Pago ao fornecedor</div><div class="k-value">${money(T.pago)}</div><div class="k-sub">${D.lancs.length} pagamento(s)${D.lancs.length ? ` · ${dateBR(D.lancs[0].data)} a ${dateBR(D.lancs.at(-1).data)}` : ''}</div></div>
      <div class="kpi"><div class="k-label">Notas recebidas</div><div class="k-value">${money(T.notas)}</div><div class="k-sub">${D.notas.filter(n => !n.devolvida).length} nota(s)${T.kg ? ' · ' + kg(T.kg) : ''}</div></div>
      <div class="kpi"><div class="k-label">${T.saldo >= 0 ? 'Saldo a receber em produto' : 'Notas acima dos pagamentos'}</div><div class="k-value ${T.saldo < -0.005 ? 'neg' : ''}">${money(Math.abs(T.saldo))}</div><div class="k-sub">pago − notas${T.pago ? ` · ${Math.round(Math.min(T.notas / T.pago, 9.99) * 100)}% já faturado` : ''}</div></div>
      <div class="kpi"><div class="k-label">Adiantamentos registrados</div><div class="k-value">${money(T.reg)}</div><div class="k-sub">abatido em notas ${money(T.abatido)} · saldo ${money(T.credSaldo)}</div></div>
    </div>
    ${alertas.length ? `<div class="card"><div class="alert-list">${alertas.map(([c, t, m]) => `<div class="alert-row ${c}"><span class="alert-tag">${t}</span><div class="small">${m}</div></div>`).join('')}</div></div>` : ''}
    <div class="card" style="padding-bottom:8px"><div class="chips" id="abas">${[['extrato', 'Extrato'], ['pag', `Pagamentos (${D.lancs.length})`], ['notas', `Notas (${D.notas.length})`], ['prod', 'Produtos']].map(([k, t]) => `<button class="chip ${ui.aba === k ? 'on' : ''}" data-aba="${k}">${t}</button>`).join('')}</div></div>
    <div class="card flush"><div class="table-wrap" id="cf-tab">${tabela()}</div></div>`;

  $('#abas', box).onclick = (e) => { const a = e.target.closest('[data-aba]')?.dataset.aba; if (a) { ui.aba = a; pintar(root); } };
  $('#cf-tab', box).onclick = (e) => {
    const n = e.target.closest('[data-nota]')?.dataset.nota; const du = e.target.closest('[data-du]')?.dataset.du;
    if (du) { const u = D.usos.find(x => x.id === du); return u && desfazerUso(u, () => carregar(root, D.favId)); }
    if (n && ui.aba === 'extrato') { ui.aba = 'notas'; ui.aberta = n; return pintar(root); }
    if (n) { ui.aberta = ui.aberta === n ? null : n; $('#cf-tab', box).innerHTML = tabela(); }
  };
  $('#reg', box) && ($('#reg', box).onclick = () => registrar(root));
  $('#auto', box) && ($('#auto', box).onclick = () => conciliar(root));
  $('#ligar', box) && ($('#ligar', box).onclick = () => ligar(root));
  $('#cnpj', box) && ($('#cnpj', box).onclick = () => informarCnpj(root));
}

function tabela() {
  if (ui.aba === 'pag') return !D.lancs.length ? '<div class="empty">Nenhum pagamento a este fornecedor.</div>' : `<table><thead><tr><th>Data</th><th>Conta</th><th>Plano</th><th>Descrição</th><th class="num">Valor</th><th>Adiantamento</th></tr></thead><tbody>
    ${D.lancs.map(l => { const c = D.regPorLanc.get(l.id); return `<tr><td>${dateBR(l.data)}</td><td>${esc(state.cad.contaById[l.conta_id]?.nome || '—')}</td><td class="small">${esc(state.cad.planoById[l.plano_id]?.codigo || '')}</td><td class="wrap small">${esc(l.descricao || l.documento || '')}</td><td class="num">${money(l.valor)}</td>
      <td>${c ? `<span class="badge pago">registrado</span>${c.usado > 0.005 ? `<div class="small muted">usado ${money(c.usado)}</div>` : ''}` : '<span class="badge aberto">não registrado</span>'}</td></tr>`; }).join('')}
    </tbody><tfoot><tr><th colspan="4">Total</th><th class="num">${money(D.tot.pago)}</th><th></th></tr></tfoot></table>`;
  if (ui.aba === 'notas') return !D.notas.length ? '<div class="empty">Nenhuma nota deste fornecedor importada.</div>' : `<table><thead><tr><th>NF</th><th>Emissão</th><th>CFOP</th><th class="num">Quantidade</th><th class="num">R$/kg</th><th class="num">Valor da nota</th><th class="num">Abatido do adiantamento</th><th class="num">Falta abater</th></tr></thead><tbody>
    ${D.notas.map(n => `<tr class="clickable" data-nota="${n.id}"><td><strong>${n.numero}</strong>${n.devolvida ? ' <span class="badge vencido">devolvida</span>' : ''}</td><td>${dateBR(n.emissao)}</td><td class="small">${esc((n.cfops || []).join(', '))}</td><td class="num">${kg(n.kg)}</td><td class="num">${n.rkg ? money(n.rkg) : '–'}</td>
      <td class="num">${money(n.v_nf)}</td><td class="num">${money(n.abatido)}</td><td class="num">${n.falta > 0.005 && !n.devolvida ? `<strong>${money(n.falta)}</strong>` : '<span class="badge pago">ok</span>'}</td></tr>
      ${ui.aberta === n.id ? `<tr class="sub"><td colspan="8"><div style="padding:6px 4px">
        <table><thead><tr><th>#</th><th>Produto</th><th>NCM</th><th>CFOP</th><th class="num">Qtd</th><th>Un</th><th class="num">Valor</th><th class="num">Unitário</th></tr></thead><tbody>
        ${n.itens.map(i => `<tr><td>${i.n_item}</td><td class="wrap">${esc(i.xprod)}</td><td>${esc(i.ncm || '')}</td><td>${esc(i.cfop || '')}</td><td class="num">${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(+i.qcom)}</td><td>${esc(i.ucom || '')}</td><td class="num">${money(i.vprod)}</td><td class="num">${+i.qcom ? money(+i.vprod / +i.qcom) : '–'}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Sem itens gravados.</td></tr>'}
        </tbody></table>
        ${n.usos.length ? `<p class="small" style="margin:8px 0 4px"><strong>Abatido dos adiantamentos</strong></p>${n.usos.map(u => { const c = (D.creds || []).find(x => x.id === u.credito_id); return `<div class="small">${dateBR(u.data)} · ${money(u.valor)} do adiantamento de ${dateBR(c?.data)} (${money(c?.valor)})${u.observacao ? ' · ' + esc(u.observacao) : ''} ${podeEditar() ? `<button class="btn ghost small" data-du="${u.id}" title="Desfazer">✕</button>` : ''}</div>`; }).join('')}` : ''}
        ${n.inf_cpl ? `<p class="small muted" style="margin:8px 0 0">${esc(n.inf_cpl.slice(0, 500))}</p>` : ''}
      </div></td></tr>` : ''}`).join('')}
    </tbody><tfoot><tr><th colspan="3">Total</th><th class="num">${kg(D.tot.kg)}</th><th class="num">${D.tot.kg ? money(D.notas.filter(n => !n.devolvida && n.kg).reduce((s, n) => s + n.rkg * n.kg, 0) / D.tot.kg) : '–'}</th><th class="num">${money(D.tot.notas)}</th><th class="num">${money(D.tot.abatido)}</th><th class="num">${money(D.notas.filter(n => !n.devolvida).reduce((s, n) => s + Math.max(n.falta, 0), 0))}</th></tr></tfoot></table>`;
  if (ui.aba === 'prod') {
    const g = new Map();
    for (const n of D.notas.filter(x => !x.devolvida)) for (const i of n.itens) {
      const k = normN(i.xprod); const x = g.get(k) || g.set(k, { nome: i.xprod, ncm: i.ncm, un: i.ucom, qtd: 0, valor: 0, notas: new Set(), ult: '' }).get(k);
      x.qtd += +i.qcom; x.valor += +i.vprod; x.notas.add(n.numero); if (n.emissao > x.ult) x.ult = n.emissao;
    }
    const L = [...g.values()].sort((a, b) => b.valor - a.valor);
    return !L.length ? '<div class="empty">Sem itens de notas importadas.</div>' : `<table><thead><tr><th>Produto</th><th>NCM</th><th class="num">Quantidade</th><th>Un</th><th class="num">Valor</th><th class="num">Preço médio</th><th class="num">Notas</th><th>Última</th></tr></thead><tbody>
      ${L.map(x => `<tr><td class="wrap">${esc(x.nome)}</td><td>${esc(x.ncm || '')}</td><td class="num">${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(x.qtd)}</td><td>${esc(x.un || '')}</td><td class="num">${money(x.valor)}</td><td class="num">${x.qtd ? money(x.valor / x.qtd) : '–'}</td><td class="num">${x.notas.size}</td><td>${dateBR(x.ult)}</td></tr>`).join('')}
      </tbody></table>`;
  }
  return !D.extrato.length ? '<div class="empty">Sem movimento.</div>' : `<table><thead><tr><th>Data</th><th>Histórico</th><th class="num">Pago (adiantado)</th><th class="num">Nota recebida</th><th class="num">Saldo com o fornecedor</th></tr></thead><tbody>
    ${D.extrato.map(x => `<tr${x.nota ? ` class="clickable" data-nota="${x.nota.id}"` : ''}><td>${dateBR(x.data)}</td><td class="wrap small">${esc(x.hist)}${x.tipo === 'pag' && !x.reg && D.creds ? ' <span class="badge aberto">não registrado</span>' : ''}</td><td class="num">${x.deb ? money(x.deb) : ''}</td><td class="num">${x.cred ? money(x.cred) : ''}</td><td class="num ${x.saldo < -0.005 ? 'neg' : ''}"><strong>${money(x.saldo)}</strong></td></tr>`).join('')}
    </tbody><tfoot><tr><th colspan="2">Total</th><th class="num">${money(D.tot.pago)}</th><th class="num">${money(D.tot.notas)}</th><th class="num">${money(D.tot.saldo)}</th></tr></tfoot></table>`;
}

function linhasExcel() {
  const f = D.fav;
  const rows = [[`Conta-corrente — ${f?.nome || ''}${f?.documento ? ' · ' + f.documento : ''}`], [`Gerado em ${dateBR(today())}`], [],
    ['Data', 'Histórico', 'Pago (adiantado)', 'Nota recebida', 'Saldo']];
  for (const x of D.extrato) rows.push([dateBR(x.data), x.hist, x.deb || null, x.cred || null, x.saldo]);
  rows.push([], ['Total', '', D.tot.pago, D.tot.notas, D.tot.saldo]);
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------------------------
function registrar(root) {
  const L = D.naoReg;
  const m = modal({ title: 'Registrar pagamentos como adiantamento', wide: true, body: `
    <p class="small muted" style="margin-top:0">Cada pagamento marcado vira um adiantamento ao fornecedor (Créditos e Adiantamentos), ligado ao lançamento. O lançamento não muda — conta, plano e valor continuam iguais.</p>
    <div class="table-wrap" style="max-height:380px"><table><thead><tr><th><input type="checkbox" id="all" checked></th><th>Data</th><th>Conta</th><th>Descrição</th><th class="num">Valor</th></tr></thead><tbody>
    ${L.map(l => `<tr><td><input type="checkbox" data-l="${l.id}" checked></td><td>${dateBR(l.data)}</td><td>${esc(state.cad.contaById[l.conta_id]?.nome || '—')}</td><td class="wrap small">${esc(l.descricao || '')}</td><td class="num">${money(l.valor)}</td></tr>`).join('')}
    </tbody></table></div><p class="small" id="tot"></p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Registrar</button>' });
  const sel = () => [...m.el.querySelectorAll('[data-l]:checked')].map(i => L.find(l => l.id === i.dataset.l));
  const tot = () => { const s = sel(); $('#tot', m.el).innerHTML = `${s.length} pagamento(s) · <strong>${money(s.reduce((a, l) => a + +l.valor, 0))}</strong>`; };
  $('#all', m.el).onchange = (e) => { m.el.querySelectorAll('[data-l]').forEach(i => { i.checked = e.target.checked; }); tot(); };
  m.el.addEventListener('change', tot); tot();
  $('#ok', m.el).onclick = async () => {
    const s = sel(); if (!s.length) return toast('Marque pelo menos um pagamento', true);
    const btn = $('#ok', m.el); btn.disabled = true;
    try {
      for (const c of chunks(s, 100)) await q(sb.from('creditos').insert(c.map(l => ({ empresa_id: state.empresa.id, favorecido_id: D.favId, natureza: 'fornecedor', tipo: 'adiantamento', data: l.data, valor: +(+l.valor).toFixed(2),
        descricao: (l.descricao && l.descricao !== '-' ? l.descricao : 'Pagamento antecipado').slice(0, 200), lancamento_id: l.id }))));
      toast(`${s.length} adiantamento(s) registrado(s)`); m.close(); carregar(root, D.favId);
    } catch (e) { btn.disabled = false; fail(e); }
  };
}

/** Plano de conciliação: adiantamentos mais antigos abatem as notas mais antigas. */
function planoFIFO() {
  const creds = (D.creds || []).filter(c => c.saldo > 0.005).sort((a, b) => a.data.localeCompare(b.data)).map(c => ({ ...c, resta: c.saldo }));
  const usadoParc = new Map(); for (const u of D.usos) if (u.parcela_id) usadoParc.set(u.parcela_id, (usadoParc.get(u.parcela_id) || 0) + +u.valor);
  const out = [];
  for (const n of D.notas.filter(x => !x.devolvida && x.falta > 0.005)) {
    // o que falta por parcela (sem parcelas: a nota inteira)
    let partes = n.parcelas.map(p => ({ parcela_id: p.id, falta: r2(+p.valor - (usadoParc.get(p.id) || 0)) })).filter(p => p.falta > 0.005);
    if (!partes.length) partes = [{ parcela_id: null, falta: n.falta }];
    let faltaNota = n.falta;
    for (const p of partes) {
      let falta = Math.min(p.falta, faltaNota);
      for (const c of creds) {
        if (falta <= 0.005) break; if (c.resta <= 0.005) continue;
        const v = r2(Math.min(falta, c.resta)); c.resta = r2(c.resta - v); falta = r2(falta - v); faltaNota = r2(faltaNota - v);
        out.push({ nota: n, parcela_id: p.parcela_id, cred: c, valor: v });
      }
    }
  }
  return out;
}

function conciliar(root) {
  const P = planoFIFO();
  if (!P.length) return toast('Nada a conciliar: sem adiantamento com saldo ou sem nota pendente.', true);
  const tot = P.reduce((s, x) => s + x.valor, 0);
  const m = modal({ title: 'Conciliar adiantamentos × notas', wide: true, body: `
    <p class="small muted" style="margin-top:0">Sugestão por ordem de data: o adiantamento mais antigo abate a nota mais antiga. Nada muda no caixa — a nota passa a constar como paga pelo adiantamento. Cada abatimento pode ser desfeito depois na própria nota.</p>
    <label>Data do abatimento<select id="dtm"><option value="nota">Data de emissão de cada nota</option><option value="hoje">Hoje (${dateBR(today())})</option></select></label>
    <div class="table-wrap" style="max-height:380px;margin-top:8px"><table><thead><tr><th>NF</th><th>Emissão</th><th class="num">Valor da nota</th><th>Adiantamento</th><th class="num">Abater</th></tr></thead><tbody>
    ${P.map(x => `<tr><td>${x.nota.numero}</td><td>${dateBR(x.nota.emissao)}</td><td class="num">${money(x.nota.v_nf)}</td><td class="small">${dateBR(x.cred.data)} · ${money(x.cred.valor)}</td><td class="num">${money(x.valor)}</td></tr>`).join('')}
    </tbody></table></div><p class="small">${P.length} abatimento(s) em ${new Set(P.map(x => x.nota.id)).size} nota(s) · total <strong>${money(tot)}</strong></p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Confirmar conciliação</button>' });
  $('#ok', m.el).onclick = async () => {
    const btn = $('#ok', m.el); btn.disabled = true; const hoje = $('#dtm', m.el).value === 'hoje';
    try {
      for (const x of P) await q(sb.from('creditos_usos').insert({ empresa_id: state.empresa.id, credito_id: x.cred.id, nota_id: x.nota.id, parcela_id: x.parcela_id, valor: x.valor,
        data: hoje ? today() : x.nota.emissao, observacao: 'Conciliação adiantamento × nota (conta-corrente do fornecedor)' }));
      toast(`Conciliado: ${money(tot)}`); m.close(); carregar(root, D.favId);
    } catch (e) { btn.disabled = false; fail(e); carregar(root, D.favId); }
  };
}

async function ligar(root) {
  const S = D.soltas, docs = [...new Set(S.map(n => dig(n.emit_doc)).filter(Boolean))];
  const semDoc = !dig(D.fav?.documento) && docs.length === 1;
  const msg = `Ligar ${S.length} nota(s) de "${S[0].emit_nome}" (${money(S.reduce((s, n) => s + +n.v_nf, 0))}) ao cadastro "${D.fav.nome}"?` + (semDoc ? `\n\nO CNPJ ${docs[0]} também será gravado no cadastro, para as próximas notas entrarem sozinhas.` : '');
  if (!confirm(msg)) return;
  try {
    for (const c of chunks(S.map(n => n.id), 200)) await q(sb.from('nfe_notas').update({ favorecido_id: D.favId }).in('id', c));
    if (semDoc) { await q(sb.from('favorecidos').update({ documento: docs[0] }).eq('id', D.favId)); await loadCadastros(true); }
    toast('Notas ligadas ao fornecedor'); carregar(root, D.favId);
  } catch (e) { fail(e); }
}

function informarCnpj(root) {
  const m = modal({ title: `CNPJ de ${D.fav.nome}`, body: `<label>CNPJ<input id="doc" placeholder="00.000.000/0000-00"></label><p class="small muted">Gravado no cadastro (Beneficiários). As notas com esse CNPJ — ou com a mesma raiz — passam a aparecer aqui.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Salvar</button>' });
  $('#ok', m.el).onclick = async () => {
    const d = dig($('#doc', m.el).value); if (d.length !== 14) return toast('Informe os 14 dígitos do CNPJ', true);
    try { await q(sb.from('favorecidos').update({ documento: d }).eq('id', D.favId)); await loadCadastros(true); toast('CNPJ gravado'); m.close(); carregar(root, D.favId); } catch (e) { fail(e); }
  };
}
