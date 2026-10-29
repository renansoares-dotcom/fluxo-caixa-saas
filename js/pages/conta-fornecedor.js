// Conta-corrente de fornecedor ou cliente: dinheiro × notas fiscais, com extrato, saldo e relatório em PDF.
// FORNECEDOR: pagamentos (natureza D) × notas de entrada que ele emite para a empresa. Saldo = pago − notas
//   (positivo = adiantado, produto/serviço a receber). Pagamentos podem virar adiantamento (creditos) e as notas
//   abatem os adiantamentos (creditos_usos); pagamentos já ligados à nota (nfe_vinculos) contam como pagos.
//   Pensada para a industrialização em Manaus, serve para qualquer fornecedor.
// CLIENTE: notas de venda (saídas, menos devoluções) × recebimentos (natureza C). Saldo = notas − recebido − créditos
//   usados − antecipado no FIDC (positivo = a receber do cliente; negativo = adiantamento do cliente).
import { sb, state, q, fetchAll, loadCadastros, podeEditar } from '../lib/data.js';
import { $, esc, money, dateBR, fail, toast, modal, exportXLSX, today, logoPNG } from '../lib/ui.js';
import { creditosComSaldo, mesmoGrupo, desfazerUso } from '../lib/creditos.js';
import { semPagamento } from '../lib/nfe-pag.js';
import { padronizarPDF, pdfCabecalho, pdfRodapes, PRETO } from '../lib/relatorio.js';

export const title = 'Conta-corrente de fornecedor / cliente';
const LS = 'contaForn.fav';
const ui = { aba: 'extrato', aberta: null, de: `${new Date().getFullYear()}-01-01`, ate: today(), visao: null };
let D = null;   // dados carregados

const dig = (s) => String(s || '').replace(/\D/g, '');
const normN = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const chunks = (a, k = 150) => { const o = []; for (let i = 0; i < a.length; i += k) o.push(a.slice(i, i + k)); return o; };
const r2 = (v) => Math.round(v * 100) / 100;
const KG = new Set(['KG', 'KGS', 'KILO', 'KILOS', 'QUILO', 'QUILOS', 'K G']);
const ehKg = (u) => KG.has(normN(u));
const kgFmt = (v) => v == null ? '–' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(v) + ' kg';
const histDesc = (d) => { if (!d || d === '-') return ''; if (/adiantamento/i.test(d)) { const n = d.match(/FORNECEDORES (\d+)/i); return ` · adiantamento${n ? ' nº ' + n[1] : ''}`; } return ' · ' + d.slice(0, 60); };
const dias = (a, b = today()) => Math.round((new Date(b) - new Date(a)) / 864e5);
const fmtDoc = (d) => { d = dig(d); return d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : d; };
const lsGet = () => { try { return localStorage.getItem(LS); } catch { return null; } };
const lsSet = (v) => { try { localStorage.setItem(LS, v); } catch { /* sem storage */ } };
const ehCliente = (f) => /CLIENTE/i.test(f?.tipo || '');
const CLI = () => D?.visao === 'cliente';
const noPeriodo = (d) => d >= ui.de && d <= ui.ate;

export async function render(root) {
  await loadCadastros();
  root.innerHTML = `
    <div class="card"><div class="card-head" style="margin-bottom:0">
      <div><h2 style="margin:0">Conta-corrente de fornecedor / cliente</h2><p class="muted small" style="margin:4px 0 0">Dinheiro × notas fiscais de um fornecedor ou cliente: extrato com saldo, notas em aberto e relatório em PDF. Fornecedor: pagamentos × notas que ele emite (saldo positivo = adiantado). Cliente: notas de venda × recebimentos (saldo positivo = a receber).</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn" href="#/notas">Importar notas (XML)</a><button class="btn" id="exp">Exportar Excel</button><button class="btn primary" id="pdf">Relatório (PDF)</button></div></div>
      <div class="toolbar" style="margin-top:10px">
        <label class="grow">Fornecedor ou cliente<input id="fav" list="cf-favs" placeholder="digite o nome ou CNPJ"><datalist id="cf-favs"></datalist></label>
        <label>Visão<select id="visao"><option value="fornecedor">Como fornecedor</option><option value="cliente">Como cliente</option></select></label>
        <label>Período<span style="display:flex;gap:4px"><input type="date" id="de" value="${ui.de}"><input type="date" id="ate" value="${ui.ate}"></span></label>
      </div></div>
    <div id="cf-corpo"><div class="loading">Carregando…</div></div>`;
  const prio = await candidatos();
  const todos = state.cad.favorecidos.filter(f => f.ativo !== false);
  const ord = [...todos].sort((a, b) => (prio.get(b.id) || 0) - (prio.get(a.id) || 0) || a.nome.localeCompare(b.nome));
  const rotulo = (f) => `${f.nome}${f.documento ? ' · ' + fmtDoc(f.documento) : ''}`;
  $('#cf-favs', root).innerHTML = ord.map(f => `<option value="${esc(rotulo(f))}" label="${esc(f.tipo || '')}"></option>`).join('');
  const acha = (v) => { const doc = dig(String(v).split('·')[1]); const nome = String(v).split(' · ')[0].trim(); return todos.find(f => (doc && dig(f.documento) === doc) || f.nome === nome) || null; };
  const ini = state.cad.favById[lsGet()] || ord.find(f => prio.has(f.id));
  const abrir = (f, visao) => { lsSet(f.id); ui.aberta = null; ui.visao = visao || (ehCliente(f) ? 'cliente' : 'fornecedor'); $('#visao', root).value = ui.visao; carregar(root, f.id); };
  if (ini) $('#fav', root).value = rotulo(ini);
  $('#fav', root).onchange = () => { const f = acha($('#fav', root).value); if (f) abrir(f); };
  $('#visao', root).onchange = () => { const f = acha($('#fav', root).value); if (f) abrir(f, $('#visao', root).value); };
  for (const id of ['de', 'ate']) $('#' + id, root).onchange = (e) => { ui[id] = e.target.value || (id === 'de' ? '2000-01-01' : today()); if (D) { calcular(); pintar(root); } };
  $('#exp', root).onclick = () => D && exportXLSX(linhasExcel(), `conta_corrente_${normN(D.fav?.nome).replace(/ /g, '_').slice(0, 30)}`);
  $('#pdf', root).onclick = () => D ? gerarPDF().catch(fail) : toast('Escolha o fornecedor ou cliente', true);
  if (ini) abrir(ini, ui.visao && lsGet() === ini.id ? ui.visao : null);
  else $('#cf-corpo', root).innerHTML = '<div class="card"><div class="empty">Escolha o fornecedor ou cliente.</div></div>';
}

/** cadastros com adiantamento (sobem na lista) */
async function candidatos() {
  const m = new Map(); const e = state.empresa.id;
  try {
    for (const l of await fetchAll(() => sb.from('lancamentos').select('favorecido_id,valor').eq('empresa_id', e).ilike('descricao', '%adiantamento%').not('favorecido_id', 'is', null)))
      m.set(l.favorecido_id, (m.get(l.favorecido_id) || 0) + +l.valor);
    for (const c of await q(sb.from('creditos').select('favorecido_id,valor').eq('empresa_id', e).eq('cancelado', false)))
      m.set(c.favorecido_id, (m.get(c.favorecido_id) || 0) + +c.valor);
  } catch { /* lista sem prioridade */ }
  return m;
}

// ---------------------------------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------------------------------
async function carregar(root, favId) {
  const box = $('#cf-corpo', root); box.innerHTML = '<div class="loading">Carregando…</div>';
  const e = state.empresa.id, cad = state.cad, fav = cad.favById[favId], grupo = mesmoGrupo(favId), raiz = dig(fav?.documento).slice(0, 8);
  const visao = ui.visao || (ehCliente(fav) ? 'cliente' : 'fornecedor'), cli = visao === 'cliente';
  try {
    const lancs = (await fetchAll(() => sb.from('lancamentos').select('id,data,valor,descricao,documento,conta_id,plano_id,status').eq('empresa_id', e).in('favorecido_id', grupo).eq('status', 'Pago').order('data').order('id')))
      .filter(l => cad.planoById[l.plano_id]?.natureza === (cli ? 'C' : 'D') && cad.planoById[l.plano_id]?.tipo !== 'T');
    let creds = [];
    try { creds = await creditosComSaldo({ favorecidos: grupo, natureza: cli ? 'cliente' : 'fornecedor', todos: true }); } catch { creds = null; }
    // notas
    const COLS = 'id,chave,numero,serie,emissao,tipo,emissao_propria,finalidade,cfops,natureza,emit_doc,emit_nome,dest_doc,dest_nome,favorecido_id,v_prod,v_nf,v_icms,v_ipi,situacao,eventos,inf_cpl';
    const docCol = cli ? 'dest_doc' : 'emit_doc', porId = new Map();
    const base = () => { let x = sb.from('nfe_notas').select(COLS).eq('empresa_id', e); return cli ? x : x.eq('tipo', 'entrada').eq('emissao_propria', false); };
    for (const n of await fetchAll(() => base().in('favorecido_id', grupo))) porId.set(n.id, n);
    if (raiz.length === 8) for (const n of await fetchAll(() => base().like(docCol, raiz + '%'))) porId.set(n.id, n);
    // notas de entrada com nome parecido mas sem cadastro (só fornecedor)
    const pal = normN(fav?.nome).split(' ').filter(w => w.length > 2 && !['IND', 'COM', 'LTDA', 'INDUSTRIA', 'COMERCIO', 'BRASIL'].includes(w)).slice(0, 2);
    let soltas = [];
    if (!cli && pal.length) soltas = (await q(sb.from('nfe_notas').select(COLS).eq('empresa_id', e).eq('tipo', 'entrada').eq('emissao_propria', false).is('favorecido_id', null).ilike('emit_nome', `%${pal.join('%')}%`))).filter(n => !porId.has(n.id));
    let todas = [...porId.values()].filter(n => n.situacao === 'autorizada');
    // cliente: vendas (saídas próprias normais) e devoluções dele (entrada própria finalidade 4 ou NF de devolução emitida por ele)
    let devol = [];
    if (cli) {
      const CF_DEV = /^[1256]20[12]$|^[56]41[01]$/;
      devol = todas.filter(n => n.finalidade === '4' || (n.tipo === 'entrada' && !n.emissao_propria && (n.cfops || []).some(c => CF_DEV.test(c))));
      todas = todas.filter(n => n.tipo === 'saida' && n.emissao_propria && n.finalidade === '1');
    } else todas = todas.filter(n => !semPagamento(n));
    const notas = todas.sort((a, b) => a.emissao.localeCompare(b.emissao) || a.numero - b.numero);
    const ids = [...notas, ...devol].map(n => n.id), itens = [], parcelas = [], vinc = [], fidc = [], usos = [];
    for (const c of chunks(ids)) {
      const [it, pa, vi, fi] = await Promise.all([q(sb.from('nfe_itens').select('nota_id,n_item,cprod,xprod,ncm,cfop,ucom,qcom,vprod').in('nota_id', c)),
        q(sb.from('nfe_parcelas').select('id,nota_id,numero,vencimento,valor').in('nota_id', c)),
        q(sb.from('nfe_vinculos').select('id,nota_id,parcela_id,lancamento_id,l:lancamentos(valor,data)').in('nota_id', c)),
        cli ? q(sb.from('nfe_fidc_vinculos').select('nota_id,parcela_id,t:fidc_titulos(fundo,bordero,valor,data_operacao)').in('nota_id', c)) : Promise.resolve([])]);
      itens.push(...it); parcelas.push(...pa); vinc.push(...vi); fidc.push(...fi);
    }
    if (creds?.length) for (const c of chunks(creds.map(x => x.id))) { let u; try { u = await q(sb.from('creditos_usos').select('id,credito_id,nota_id,parcela_id,lancamento_id,valor,data,observacao').in('credito_id', c)); } catch { u = await q(sb.from('creditos_usos').select('id,credito_id,nota_id,parcela_id,valor,data,observacao').in('credito_id', c)); } usos.push(...u); }
    // pagamentos/recebimentos ligados a alguma nota (de qualquer cadastro)
    const lancNota = new Set();
    for (const c of chunks(lancs.map(l => l.id))) for (const v of await q(sb.from('nfe_vinculos').select('lancamento_id').in('lancamento_id', c))) lancNota.add(v.lancamento_id);
    D = { favId, fav, visao, lancs, creds, usos, notas, devol, soltas, itens, parcelas, vinc, fidc, lancNota };
    calcular(); pintar(root);
  } catch (err) { box.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; fail(err); }
}

function calcular() {
  const { lancs, creds, usos, notas, devol, itens, parcelas, vinc, fidc } = D, cli = CLI();
  const regPorLanc = new Map((creds || []).filter(c => c.lancamento_id).map(c => [c.lancamento_id, c]));
  D.regPorLanc = regPorLanc;
  // fornecedor: pagamentos que ainda podem virar adiantamento = sem crédito registrado e não ligados a uma nota
  D.naoReg = cli ? [] : lancs.filter(l => !regPorLanc.has(l.id) && !D.lancNota.has(l.id));
  const grupoPor = (arr) => { const m = new Map(); for (const x of arr) (m.get(x.nota_id) || m.set(x.nota_id, []).get(x.nota_id)).push(x); return m; };
  const usoNota = grupoPor(usos), itNota = grupoPor(itens), pNota = grupoPor(parcelas), vNota = grupoPor(vinc), fNota = grupoPor(fidc);
  const devolvida = (n) => (n.eventos || []).some(ev => ev.tipo === 'devolucao_total');
  for (const n of [...notas, ...devol]) {
    n.usos = usoNota.get(n.id) || []; n.vincs = vNota.get(n.id) || []; n.fidcs = fNota.get(n.id) || [];
    n.itens = (itNota.get(n.id) || []).sort((a, b) => a.n_item - b.n_item);
    n.parcelas = (pNota.get(n.id) || []).sort((a, b) => a.numero - b.numero);
    n.abatido = r2(n.usos.reduce((s, u) => s + +u.valor, 0));
    n.pagoDireto = r2(n.vincs.reduce((s, v) => s + +(v.l?.valor || 0), 0));
    n.antecipado = r2(n.fidcs.reduce((s, f) => s + +(f.t?.valor || 0), 0));
    n.devolvida = devolvida(n);
    n.falta = r2(Math.max(+n.v_nf - n.abatido - n.pagoDireto - n.antecipado, 0));
    const ik = n.itens.filter(i => ehKg(i.ucom)); n.kg = ik.length ? ik.reduce((s, i) => s + +i.qcom, 0) : null;
    n.rkg = n.kg ? ik.reduce((s, i) => s + +i.vprod, 0) / n.kg : null;
  }
  const validas = notas.filter(n => !n.devolvida);
  // extrato (todas as datas, para saldo anterior correto)
  const sinal = cli ? -1 : 1;   // fornecedor: pago soma; cliente: nota soma
  const ext = [
    ...lancs.map(l => ({ data: l.data, ord: cli ? 1 : 0, tipo: 'din', hist: `${cli ? 'Recebimento' : 'Pagamento'} · ${state.cad.contaById[l.conta_id]?.nome || '—'}${histDesc(l.descricao)}`, dinheiro: +l.valor, nota: 0, reg: regPorLanc.has(l.id), l })),
    ...validas.map(n => ({ data: n.emissao, ord: cli ? 0 : 1, tipo: 'nf', hist: `NF ${n.numero}${n.kg ? ' · ' + kgFmt(n.kg) : ''}${n.natureza ? ' · ' + n.natureza : ''}`, dinheiro: 0, nota: +n.v_nf, n })),
    ...(cli ? devol.map(n => ({ data: n.emissao, ord: 2, tipo: 'dev', hist: `Devolução NF ${n.numero}${n.natureza ? ' · ' + n.natureza : ''}`, dinheiro: 0, nota: -+n.v_nf, n })) : []),
    ...(cli ? validas.flatMap(n => n.fidcs.map(f => ({ data: f.t?.data_operacao || n.emissao, ord: 3, tipo: 'fidc', hist: `Antecipado no FIDC · ${f.t?.fundo || ''} borderô ${f.t?.bordero || ''} · NF ${n.numero}`, dinheiro: +(f.t?.valor || 0), nota: 0 }))) : []),
    ...(cli ? usos.filter(u => !u.lancamento_id).map(u => ({ data: u.data, ord: 4, tipo: 'cred', hist: `Crédito usado · NF ${(notas.find(n => n.id === u.nota_id) || {}).numero || ''}${u.observacao ? ' · ' + u.observacao : ''}`, dinheiro: +u.valor, nota: 0 })) : []),
    // crédito devolvido em dinheiro (pagamento a maior que o fornecedor devolveu; crédito do cliente pago a ele)
    ...usos.filter(u => u.lancamento_id).map(u => ({ data: u.data, ord: 5, tipo: 'din', hist: `${cli ? 'Crédito devolvido ao cliente' : 'Devolução do fornecedor (crédito)'}${u.observacao && u.observacao !== 'Devolução em dinheiro' ? ' · ' + u.observacao : ''}`, dinheiro: -u.valor, nota: 0, reg: true, l: { id: u.lancamento_id } })),
  ].sort((a, b) => a.data.localeCompare(b.data) || a.ord - b.ord);
  let s = 0; for (const x of ext) { s = r2(s + sinal * (x.dinheiro - x.nota)); x.saldo = s; }
  D.extrato = ext;
  const antes = ext.filter(x => x.data < ui.de), dentro = ext.filter(x => noPeriodo(x.data));
  const T = D.tot = {
    anterior: antes.length ? antes.at(-1).saldo : 0,
    final: (ext.filter(x => x.data <= ui.ate).at(-1) || { saldo: 0 }).saldo,
    dinheiro: r2(dentro.filter(x => x.tipo === 'din').reduce((a, x) => a + x.dinheiro, 0)),
    notas: r2(dentro.filter(x => x.tipo === 'nf').reduce((a, x) => a + x.nota, 0)),
    devol: r2(-dentro.filter(x => x.tipo === 'dev').reduce((a, x) => a + x.nota, 0)),
    fidc: r2(dentro.filter(x => x.tipo === 'fidc').reduce((a, x) => a + x.dinheiro, 0)),
    cred: r2(dentro.filter(x => x.tipo === 'cred').reduce((a, x) => a + x.dinheiro, 0)),
    qn: dentro.filter(x => x.tipo === 'nf').length, ql: dentro.filter(x => x.tipo === 'din').length,
    kg: validas.filter(n => noPeriodo(n.emissao)).reduce((a, n) => a + (n.kg || 0), 0),
    reg: r2((creds || []).reduce((a, c) => a + +c.valor, 0)), abatido: r2(usos.reduce((a, u) => a + +u.valor, 0)),
    aberto: r2(validas.filter(n => n.emissao <= ui.ate).reduce((a, n) => a + n.falta, 0)),
  };
  T.credSaldo = r2(T.reg - T.abatido);
  // fornecedor: exposição (pagamentos mais antigos cobertos primeiro pelas notas)
  D.descobertos = [];
  if (!cli) { let cobre = validas.filter(n => n.emissao <= ui.ate).reduce((a, n) => a + +n.v_nf, 0); for (const l of lancs.filter(l => l.data <= ui.ate)) { const v = +l.valor; if (cobre >= v - 0.005) { cobre -= v; continue; } D.descobertos.push({ ...l, aberto: r2(v - Math.max(cobre, 0)) }); cobre = 0; } }
  D.maisAntigo = D.descobertos[0]?.data || null;
  // cliente: notas vencidas em aberto
  D.vencidas = cli ? validas.filter(n => n.falta > 0.05 && (n.parcelas.map(p => p.vencimento).filter(Boolean).sort().pop() || n.emissao) < today()) : [];
}

// textos de situação usados na tela e no PDF
function alertasTexto() {
  const T = D.tot, fav = D.fav, cli = CLI(), out = [];
  if (!dig(fav?.documento)) out.push({ tag: 'Cadastro', cls: 'atencao', txt: `O cadastro de ${fav?.nome} está sem CNPJ. Sem ele, as notas só aparecem aqui se o nome no XML bater com o cadastro.`, act: 'cnpj' });
  if (D.soltas.length) out.push({ tag: 'Notas', cls: 'atencao', txt: `${D.soltas.length} nota(s) de entrada com nome parecido (${D.soltas[0].emit_nome}, ${money(D.soltas.reduce((s, n) => s + +n.v_nf, 0))}) não estão ligadas a este cadastro.`, act: 'ligar' });
  if (!D.notas.length && !D.soltas.length) out.push({ tag: 'Notas', cls: '', txt: `Nenhuma nota ${cli ? 'de venda para este cliente' : 'deste fornecedor'} foi importada.` });
  if (!cli && D.creds === null) out.push({ tag: 'Banco', cls: 'atencao', txt: 'A estrutura de créditos não foi encontrada no banco.' });
  else if (!cli && D.naoReg.length) out.push({ tag: 'Adiantamentos', cls: '', txt: `${D.naoReg.length} pagamento(s) (${money(D.naoReg.reduce((s, l) => s + +l.valor, 0))}) não estão ligados a uma nota nem registrados como adiantamento.`, act: 'reg' });
  const pend = D.notas.filter(n => !n.devolvida && n.falta > 0.05).length;
  if (!cli && D.creds && pend && D.creds.some(c => c.saldo > 0.005)) out.push({ tag: 'Conciliação', cls: '', txt: `${pend} nota(s) com valor ainda não abatido dos adiantamentos.`, act: 'auto' });
  if (!cli) {
    const idade = D.maisAntigo ? dias(D.maisAntigo, ui.ate) : 0;
    if (T.final > 0.005 && idade > 60) out.push({ tag: 'Exposição', cls: 'atencao', txt: `${money(D.descobertos.reduce((s, l) => s + l.aberto, 0))} pagos sem nota correspondente; o pagamento mais antigo ainda descoberto é de ${dateBR(D.maisAntigo)} (${idade} dias).` });
    if (T.final < -0.005) out.push({ tag: 'Saldo', cls: 'atencao', txt: `As notas passam os pagamentos em ${money(-T.final)}: há valor a pagar ao fornecedor ou pagamento lançado em outro cadastro.` });
  } else {
    if (D.vencidas.length) out.push({ tag: 'Vencidas', cls: 'atencao', txt: `${D.vencidas.length} nota(s) com vencimento passado e saldo em aberto: ${money(D.vencidas.reduce((s, n) => s + n.falta, 0))}.` });
    if (T.final < -0.005) out.push({ tag: 'Adiantamento', cls: '', txt: `O cliente pagou ${money(-T.final)} a mais que as notas: adiantamento do cliente ou recebimento de outra empresa lançado neste cadastro.` });
  }
  return out;
}

function pintar(root) {
  const T = D.tot, box = $('#cf-corpo', root), ed = podeEditar(), cli = CLI();
  const al = alertasTexto();
  const btn = { cnpj: 'Informar CNPJ', ligar: 'Ligar a este fornecedor', reg: 'Registrar como adiantamento', auto: 'Conciliar automaticamente' };
  const kpis = cli ? [
    ['Saldo anterior', money(T.anterior), `até ${dateBR(ui.de)}`],
    ['Notas de venda no período', money(T.notas - T.devol), `${T.qn} nota(s)${T.devol ? ` · devoluções ${money(T.devol)}` : ''}`],
    ['Recebido no período', money(T.dinheiro + T.fidc + T.cred), `recebimentos ${money(T.dinheiro)}${T.fidc ? ` · FIDC ${money(T.fidc)}` : ''}${T.cred ? ` · créditos ${money(T.cred)}` : ''}`],
    [T.final >= 0 ? 'Saldo a receber' : 'Adiantamento do cliente', money(Math.abs(T.final)), `em ${dateBR(ui.ate)} · notas em aberto ${money(T.aberto)}`],
  ] : [
    ['Saldo anterior', money(T.anterior), `até ${dateBR(ui.de)}`],
    ['Pago no período', money(T.dinheiro), `${T.ql} pagamento(s)`],
    ['Notas recebidas no período', money(T.notas), `${T.qn} nota(s)${T.kg ? ' · ' + kgFmt(T.kg) : ''}`],
    [T.final >= 0 ? 'Saldo a receber em produto' : 'Notas acima dos pagamentos', money(Math.abs(T.final)), `em ${dateBR(ui.ate)} · adiantamentos registrados ${money(T.reg)}`],
  ];
  D.kpis = kpis; D.alertas = al;
  const abas = [['extrato', 'Extrato'], ['pag', `${cli ? 'Recebimentos' : 'Pagamentos'} (${D.lancs.filter(l => noPeriodo(l.data)).length})`], ['notas', `Notas (${D.notas.filter(n => noPeriodo(n.emissao)).length})`], ['prod', 'Produtos']];
  box.innerHTML = `
    <div class="kpis">${kpis.map(([l, v, s], i) => `<div class="kpi"><div class="k-label">${l}</div><div class="k-value ${i === 3 && (cli ? T.final > 0.005 && D.vencidas.length : T.final < -0.005) ? 'neg' : ''}">${v}</div><div class="k-sub">${s}</div></div>`).join('')}</div>
    ${al.length ? `<div class="card"><div class="alert-list">${al.map(a => `<div class="alert-row ${a.cls}"><span class="alert-tag">${a.tag}</span><div class="small">${esc(a.txt)} ${a.act && ed ? `<button class="btn small" id="act-${a.act}">${btn[a.act]}</button>` : ''}</div></div>`).join('')}</div></div>` : ''}
    <div class="card" style="padding-bottom:8px"><div class="chips" id="abas">${abas.map(([k, t]) => `<button class="chip ${ui.aba === k ? 'on' : ''}" data-aba="${k}">${t}</button>`).join('')}</div></div>
    <div class="card flush"><div class="table-wrap" id="cf-tab">${tabela()}</div></div>`;
  $('#abas', box).onclick = (e) => { const a = e.target.closest('[data-aba]')?.dataset.aba; if (a) { ui.aba = a; pintar(root); } };
  $('#cf-tab', box).onclick = (e) => {
    const n = e.target.closest('[data-nota]')?.dataset.nota; const du = e.target.closest('[data-du]')?.dataset.du;
    if (du) { const u = D.usos.find(x => x.id === du); return u && desfazerUso(u, () => carregar(root, D.favId)); }
    if (n && ui.aba === 'extrato') { ui.aba = 'notas'; ui.aberta = n; return pintar(root); }
    if (n) { ui.aberta = ui.aberta === n ? null : n; $('#cf-tab', box).innerHTML = tabela(); }
  };
  $('#act-reg', box) && ($('#act-reg', box).onclick = () => registrar(root));
  $('#act-auto', box) && ($('#act-auto', box).onclick = () => conciliar(root));
  $('#act-ligar', box) && ($('#act-ligar', box).onclick = () => ligar(root));
  $('#act-cnpj', box) && ($('#act-cnpj', box).onclick = () => informarCnpj(root));
}

// linhas das tabelas (tela, Excel e PDF usam as mesmas)
function linhasExtrato() {
  const cli = CLI(), T = D.tot;
  const rows = [{ data: ui.de, hist: 'Saldo anterior', a: null, b: null, saldo: T.anterior, anterior: true }];
  for (const x of D.extrato.filter(x => noPeriodo(x.data))) rows.push({ data: x.data, hist: x.hist, a: cli ? (x.nota > 0 ? x.nota : null) : (x.dinheiro || null), b: cli ? (x.dinheiro || (x.nota < 0 ? -x.nota : null)) : (x.nota || null), saldo: x.saldo, x });
  return rows;
}
const cabExtrato = () => CLI() ? ['Data', 'Histórico', 'Nota de venda', 'Recebido / devolução', 'Saldo a receber'] : ['Data', 'Histórico', 'Pago (adiantado)', 'Nota recebida', 'Saldo com o fornecedor'];
const notasPeriodo = () => D.notas.filter(n => noPeriodo(n.emissao));

function tabela() {
  const cli = CLI();
  if (ui.aba === 'pag') {
    const L = D.lancs.filter(l => noPeriodo(l.data));
    return !L.length ? `<div class="empty">Nenhum ${cli ? 'recebimento' : 'pagamento'} no período.</div>` : `<table><thead><tr><th>Data</th><th>Conta</th><th>Plano</th><th>Descrição</th><th class="num">Valor</th><th>Situação</th></tr></thead><tbody>
    ${L.map(l => { const c = D.regPorLanc.get(l.id); return `<tr><td>${dateBR(l.data)}</td><td>${esc(state.cad.contaById[l.conta_id]?.nome || '—')}</td><td class="small">${esc(state.cad.planoById[l.plano_id]?.codigo || '')}</td><td class="wrap small">${esc(l.descricao || l.documento || '')}</td><td class="num">${money(l.valor)}</td>
      <td>${D.lancNota.has(l.id) ? '<span class="badge pago">ligado à nota</span>' : c ? `<span class="badge pago">adiantamento</span>${c.usado > 0.005 ? `<div class="small muted">usado ${money(c.usado)}</div>` : ''}` : cli ? '<span class="badge aberto">sem nota</span>' : '<span class="badge aberto">não registrado</span>'}</td></tr>`; }).join('')}
    </tbody><tfoot><tr><th colspan="4">Total</th><th class="num">${money(L.reduce((s, l) => s + +l.valor, 0))}</th><th></th></tr></tfoot></table>`;
  }
  if (ui.aba === 'notas') {
    const N = notasPeriodo();
    return !N.length ? '<div class="empty">Nenhuma nota no período.</div>' : `<table><thead><tr><th>NF</th><th>Emissão</th><th>CFOP</th>${cli ? '<th>Vencimento</th>' : '<th class="num">Quantidade</th><th class="num">R$/kg</th>'}<th class="num">Valor da nota</th><th class="num">${cli ? 'Recebido / FIDC / crédito' : 'Pago / abatido'}</th><th class="num">Em aberto</th></tr></thead><tbody>
    ${N.map(n => `<tr class="clickable" data-nota="${n.id}"><td><strong>${n.numero}</strong>${n.devolvida ? ' <span class="badge vencido">devolvida</span>' : ''}</td><td>${dateBR(n.emissao)}</td><td class="small">${esc((n.cfops || []).join(', '))}</td>
      ${cli ? `<td class="small">${n.parcelas.map(p => dateBR(p.vencimento)).join(', ') || '—'}</td>` : `<td class="num">${kgFmt(n.kg)}</td><td class="num">${n.rkg ? money(n.rkg) : '–'}</td>`}
      <td class="num">${money(n.v_nf)}</td><td class="num">${money(n.pagoDireto + n.abatido + n.antecipado)}</td><td class="num">${n.falta > 0.05 && !n.devolvida ? `<strong>${money(n.falta)}</strong>` : '<span class="badge pago">ok</span>'}</td></tr>
      ${ui.aberta === n.id ? `<tr class="sub"><td colspan="8"><div style="padding:6px 4px">
        <table><thead><tr><th>#</th><th>Produto</th><th>NCM</th><th>CFOP</th><th class="num">Qtd</th><th>Un</th><th class="num">Valor</th><th class="num">Unitário</th></tr></thead><tbody>
        ${n.itens.map(i => `<tr><td>${i.n_item}</td><td class="wrap">${esc(i.xprod)}</td><td>${esc(i.ncm || '')}</td><td>${esc(i.cfop || '')}</td><td class="num">${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 }).format(+i.qcom)}</td><td>${esc(i.ucom || '')}</td><td class="num">${money(i.vprod)}</td><td class="num">${+i.qcom ? money(+i.vprod / +i.qcom) : '–'}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Sem itens gravados.</td></tr>'}
        </tbody></table>
        ${n.vincs.length ? `<p class="small" style="margin:8px 0 4px"><strong>${cli ? 'Recebimentos' : 'Pagamentos'} ligados</strong></p>${n.vincs.map(v => `<div class="small">${dateBR(v.l?.data)} · ${money(v.l?.valor)}</div>`).join('')}` : ''}
        ${n.fidcs.length ? `<p class="small" style="margin:8px 0 4px"><strong>Antecipado no FIDC</strong></p>${n.fidcs.map(f => `<div class="small">${esc(f.t?.fundo || '')} · borderô ${esc(f.t?.bordero || '')} · ${money(f.t?.valor)}</div>`).join('')}` : ''}
        ${n.usos.length ? `<p class="small" style="margin:8px 0 4px"><strong>${cli ? 'Créditos usados' : 'Abatido dos adiantamentos'}</strong></p>${n.usos.map(u => { const c = (D.creds || []).find(x => x.id === u.credito_id); return `<div class="small">${dateBR(u.data)} · ${money(u.valor)} do crédito de ${dateBR(c?.data)} (${money(c?.valor)})${u.observacao ? ' · ' + esc(u.observacao) : ''} ${podeEditar() ? `<button class="btn ghost small" data-du="${u.id}" title="Desfazer">✕</button>` : ''}</div>`; }).join('')}` : ''}
        ${n.inf_cpl ? `<p class="small muted" style="margin:8px 0 0">${esc(n.inf_cpl.slice(0, 500))}</p>` : ''}
      </div></td></tr>` : ''}`).join('')}
    </tbody><tfoot><tr><th colspan="3">Total</th>${cli ? '<th></th>' : `<th class="num">${kgFmt(N.filter(n => !n.devolvida).reduce((s, n) => s + (n.kg || 0), 0))}</th><th></th>`}<th class="num">${money(N.reduce((s, n) => s + +n.v_nf, 0))}</th><th class="num">${money(N.reduce((s, n) => s + n.pagoDireto + n.abatido + n.antecipado, 0))}</th><th class="num">${money(N.filter(n => !n.devolvida).reduce((s, n) => s + n.falta, 0))}</th></tr></tfoot></table>`;
  }
  if (ui.aba === 'prod') {
    const L = produtos();
    return !L.length ? '<div class="empty">Sem itens de notas no período.</div>' : `<table><thead><tr><th>Produto</th><th>NCM</th><th class="num">Quantidade</th><th>Un</th><th class="num">Valor</th><th class="num">Preço médio</th><th class="num">Notas</th><th>Última</th></tr></thead><tbody>
      ${L.map(x => `<tr><td class="wrap">${esc(x.nome)}</td><td>${esc(x.ncm || '')}</td><td class="num">${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(x.qtd)}</td><td>${esc(x.un || '')}</td><td class="num">${money(x.valor)}</td><td class="num">${x.qtd ? money(x.valor / x.qtd) : '–'}</td><td class="num">${x.notas.size}</td><td>${dateBR(x.ult)}</td></tr>`).join('')}
      </tbody></table>`;
  }
  const R = linhasExtrato(), [c1, c2, c3, c4, c5] = cabExtrato();
  return `<table><thead><tr><th>${c1}</th><th>${c2}</th><th class="num">${c3}</th><th class="num">${c4}</th><th class="num">${c5}</th></tr></thead><tbody>
    ${R.map(r => `<tr${r.x?.n ? ` class="clickable" data-nota="${r.x.n.id}"` : ''}${r.anterior ? ' style="font-weight:600"' : ''}><td>${dateBR(r.data)}</td><td class="wrap small">${esc(r.hist)}${r.x?.tipo === 'din' && !cli && !r.x.reg && !D.lancNota.has(r.x.l.id) && D.creds ? ' <span class="badge aberto">não registrado</span>' : ''}</td><td class="num">${r.a ? money(r.a) : ''}</td><td class="num">${r.b ? money(r.b) : ''}</td><td class="num ${r.saldo < -0.005 ? 'neg' : ''}"><strong>${money(r.saldo)}</strong></td></tr>`).join('')}
    </tbody><tfoot><tr><th colspan="2">Movimento do período</th><th class="num">${money(R.reduce((s, r) => s + (r.a || 0), 0))}</th><th class="num">${money(R.reduce((s, r) => s + (r.b || 0), 0))}</th><th class="num">${money(D.tot.final)}</th></tr></tfoot></table>`;
}

function produtos() {
  const g = new Map();
  for (const n of notasPeriodo().filter(x => !x.devolvida)) for (const i of n.itens) {
    const k = normN(i.xprod); const x = g.get(k) || g.set(k, { nome: i.xprod, ncm: i.ncm, un: i.ucom, qtd: 0, valor: 0, notas: new Set(), ult: '' }).get(k);
    x.qtd += +i.qcom; x.valor += +i.vprod; x.notas.add(n.numero); if (n.emissao > x.ult) x.ult = n.emissao;
  }
  return [...g.values()].sort((a, b) => b.valor - a.valor);
}

function linhasExcel() {
  const f = D.fav, cab = cabExtrato();
  const rows = [[`Conta-corrente (${CLI() ? 'cliente' : 'fornecedor'}) — ${f?.nome || ''}${f?.documento ? ' · ' + fmtDoc(f.documento) : ''}`], [`Período ${dateBR(ui.de)} a ${dateBR(ui.ate)} · gerado em ${dateBR(today())}`], [], cab];
  for (const r of linhasExtrato()) rows.push([dateBR(r.data), r.hist, r.a, r.b, r.saldo]);
  rows.push([], ['Notas do período'], ['NF', 'Emissão', 'CFOP', 'Valor', 'Pago / recebido', 'Em aberto']);
  for (const n of notasPeriodo()) rows.push([n.numero, dateBR(n.emissao), (n.cfops || []).join(', '), +n.v_nf, r2(n.pagoDireto + n.abatido + n.antecipado), n.devolvida ? 0 : n.falta]);
  return rows;
}

// ---------------------------------------------------------------------------------------------
// Relatório em PDF
// ---------------------------------------------------------------------------------------------
const pdfTxt = (t) => String(t ?? '').replace(/[−–]/g, '-').replace(/×/g, 'x').replace(/ /g, ' ').replace(/[✓✕]/g, '');
async function gerarPDF() {
  if (!window.jspdf) return toast('Biblioteca de PDF ainda carregando, tente de novo em instantes', true);
  const { jsPDF } = window.jspdf; const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  if (!doc.autoTable) return toast('Biblioteca de tabelas do PDF ainda carregando', true);
  padronizarPDF(doc);
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 12;
  const azul = PRETO, marinho = PRETO, cli = CLI(), f = D.fav, T = D.tot;
  const logo = await logoPNG().catch(() => null);
  const titulo = `Conta-corrente de ${cli ? 'cliente' : 'fornecedor'}`;
  const cabecalho = () => pdfCabecalho(doc, titulo, logo, { M, sub: pdfTxt(`período ${dateBR(ui.de)} a ${dateBR(ui.ate)}`) });
  const secao = (t) => { let y = (doc.lastAutoTable?.finalY ?? 40) + 8; if (y > H - 30) { doc.addPage(); cabecalho(); y = 30; } doc.setFontSize(10.5); doc.setFont(undefined, 'bold'); doc.setTextColor(...marinho); doc.text(pdfTxt(t), M, y); doc.setTextColor(20); doc.setFont(undefined, 'normal'); return y + 2; };
  const grade = { theme: 'grid', styles: { fontSize: 7.4, cellPadding: 1.2, lineColor: [226, 231, 239] }, headStyles: { fillColor: azul, textColor: 255 }, margin: { left: M, right: M, top: 28 }, didDrawPage: (d) => { if (d.pageNumber > 1) cabecalho(); } };
  cabecalho();
  // identificação
  doc.setFontSize(12); doc.setFont(undefined, 'bold'); doc.text(pdfTxt(f?.nome || ''), M, 29);
  doc.setFontSize(8.5); doc.setFont(undefined, 'normal'); doc.setTextColor(90);
  doc.text(pdfTxt([f?.documento ? `CNPJ/CPF ${fmtDoc(f.documento)}` : 'sem CNPJ no cadastro', f?.tipo, f?.dados_bancarios].filter(Boolean).join(' · ')), M, 34); doc.setTextColor(20);
  // indicadores
  doc.autoTable({ startY: 37, theme: 'plain', body: [D.kpis.map(k => k[0]), D.kpis.map(k => k[1]), D.kpis.map(k => k[2])].map(r => r.map(pdfTxt)), margin: { left: M, right: M },
    styles: { fontSize: 8, cellPadding: { top: .6, bottom: .6, left: 1.5, right: 1.5 } }, columnStyles: Object.fromEntries([0, 1, 2, 3].map(i => [i, { cellWidth: (W - 2 * M) / 4 }])),
    didParseCell: (d) => { const r = d.row.index; if (r === 0 || r === 2) { d.cell.styles.textColor = 110; d.cell.styles.fontSize = 7.2; } if (r === 1) { d.cell.styles.fontSize = 12; d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = marinho; } } });
  // situação
  if (D.alertas.length) { const y = secao('Pontos de atenção'); doc.autoTable({ ...grade, startY: y, head: [['Item', 'Situação']], body: D.alertas.map(a => [a.tag, pdfTxt(a.txt)]), columnStyles: { 0: { cellWidth: 26, fontStyle: 'bold' } } }); }
  // extrato
  const cab = cabExtrato(), ext = linhasExtrato();
  let y = secao('Extrato do período');
  doc.autoTable({ ...grade, startY: y, head: [cab], body: ext.map(r => [dateBR(r.data), pdfTxt(r.hist), r.a ? money(r.a) : '', r.b ? money(r.b) : '', money(r.saldo)]),
    foot: [['', 'Movimento do período / saldo final', money(ext.reduce((s, r) => s + (r.a || 0), 0)), money(ext.reduce((s, r) => s + (r.b || 0), 0)), money(T.final)]],
    footStyles: { fillColor: [242, 242, 242], textColor: 20, fontStyle: 'bold' }, columnStyles: { 0: { cellWidth: 18 }, 2: { halign: 'right', cellWidth: 26 }, 3: { halign: 'right', cellWidth: 26 }, 4: { halign: 'right', cellWidth: 28 } },
    didParseCell: (d) => { if (d.section === 'body' && d.row.index === 0) d.cell.styles.fontStyle = 'bold'; if (d.section === 'foot' && d.column.index > 1) d.cell.styles.halign = 'right'; } });
  // notas
  const N = notasPeriodo();
  if (N.length) {
    y = secao(`Notas fiscais do período (${N.length})`);
    const head = cli ? ['NF', 'Emissão', 'Vencimento', 'Valor', 'Recebido/FIDC/crédito', 'Em aberto'] : ['NF', 'Emissão', 'CFOP', 'Quantidade', 'R$/kg', 'Valor', 'Pago/abatido', 'Em aberto'];
    const body = N.map(n => cli ? [n.numero, dateBR(n.emissao), n.parcelas.map(p => dateBR(p.vencimento)).join(', ') || '-', money(n.v_nf), money(n.pagoDireto + n.abatido + n.antecipado), n.devolvida ? 'devolvida' : money(n.falta)]
      : [n.numero, dateBR(n.emissao), (n.cfops || []).join(', '), kgFmt(n.kg), n.rkg ? money(n.rkg) : '-', money(n.v_nf), money(n.pagoDireto + n.abatido), n.devolvida ? 'devolvida' : money(n.falta)]);
    const tot = (fn) => money(N.reduce((s, n) => s + fn(n), 0));
    const foot = cli ? ['Total', '', '', tot(n => +n.v_nf), tot(n => n.pagoDireto + n.abatido + n.antecipado), tot(n => n.devolvida ? 0 : n.falta)]
      : ['Total', '', '', kgFmt(N.filter(n => !n.devolvida).reduce((s, n) => s + (n.kg || 0), 0)), '', tot(n => +n.v_nf), tot(n => n.pagoDireto + n.abatido), tot(n => n.devolvida ? 0 : n.falta)];
    doc.autoTable({ ...grade, startY: y, head: [head], body, foot: [foot], footStyles: { fillColor: [242, 242, 242], textColor: 20, fontStyle: 'bold' },
      didParseCell: (d) => { if (d.column.index >= (cli ? 3 : 3)) d.cell.styles.halign = 'right'; } });
  }
  // produtos (fornecedor)
  const P = produtos();
  if (!cli && P.length) {
    y = secao('Produtos recebidos no período');
    doc.autoTable({ ...grade, startY: y, head: [['Produto', 'NCM', 'Quantidade', 'Un', 'Valor', 'Preço médio', 'Notas']],
      body: P.map(x => [pdfTxt(x.nome), x.ncm || '', new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(x.qtd), x.un || '', money(x.valor), x.qtd ? money(x.valor / x.qtd) : '-', x.notas.size]),
      didParseCell: (d) => { if ([2, 4, 5, 6].includes(d.column.index)) d.cell.styles.halign = 'right'; } });
  }
  // rodapé
  pdfRodapes(doc, pdfTxt(cli ? 'Fonte: notas fiscais de venda (XML), recebimentos lançados, borderôs FIDC e créditos registrados na plataforma.' : 'Fonte: notas fiscais de entrada (XML), pagamentos lançados e adiantamentos registrados na plataforma.'), { M });
  doc.save(`conta_corrente_${normN(f?.nome).replace(/ /g, '_').slice(0, 40)}_${ui.de}_${ui.ate}.pdf`);
}

// ---------------------------------------------------------------------------------------------
// Ações (fornecedor)
// ---------------------------------------------------------------------------------------------
function registrar(root) {
  const L = D.naoReg;
  const m = modal({ title: 'Registrar pagamentos como adiantamento', wide: true, body: `
    <p class="small muted" style="margin-top:0">Cada pagamento marcado vira um adiantamento ao fornecedor (Créditos e Adiantamentos), ligado ao lançamento. O lançamento não muda — conta, plano e valor continuam iguais. Pagamentos já ligados a uma nota (Pagamentos × Notas) não aparecem aqui.</p>
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

/** Plano de conciliação: adiantamentos mais antigos abatem as notas mais antigas (no que falta de cada nota). */
function planoFIFO() {
  const creds = (D.creds || []).filter(c => c.saldo > 0.005).sort((a, b) => a.data.localeCompare(b.data)).map(c => ({ ...c, resta: c.saldo }));
  const usadoParc = new Map(); for (const u of D.usos) if (u.parcela_id) usadoParc.set(u.parcela_id, (usadoParc.get(u.parcela_id) || 0) + +u.valor);
  const out = [];
  for (const n of D.notas.filter(x => !x.devolvida && x.falta > 0.005)) {
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
