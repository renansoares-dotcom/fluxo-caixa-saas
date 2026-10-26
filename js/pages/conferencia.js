// Conferência do dia: mapa do mês com uma linha por conta e uma coluna por dia. Cada quadradinho diz se o dia
// bate (sistema × extrato do banco), se tem problema (diferença, extrato pendente,
// possível duplicidade, classificação suspeita, transferência sem a outra ponta) ou se ainda precisa ser conferido
// à mão (conta sem extrato). Clicando, abre o dia com os lançamentos e o extrato lado a lado e o botão de visto.
// Nada aqui altera lançamentos: só grava o visto (conferencias_dia); as correções são feitas no formulário de sempre.
import { sb, state, q, fetchAll, podeEditar, loadCadastros, pontas } from '../lib/data.js';
import { $, $$, esc, money, money0, cls, dateBR, fail, toast, modal, parseNum, MESES } from '../lib/ui.js';
import { abrirLancamento } from '../lib/lanc-form.js';
import { normTxt } from '../lib/nf-titulos.js';

export const title = 'Conferência do dia';

const LS = 'fc-conf-mes';
const mesAnt = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const ui = { mes: (() => { try { return localStorage.getItem(LS) || mesAnt(); } catch { return mesAnt(); } })(), soProb: false, todas: false, visao: 'mapa', conta: '', saldos: false };
let D = null;      // dados do mês carregado
let rootEl = null;

const TOL = 0.05;
// Única regra de saldo: dinheiro em espécie (tipo Caixa — Caixa Carteira) nunca pode terminar o dia negativo.
// As demais contas (bancos, FIDC, escrow) podem fechar o dia com qualquer saldo; elas batem pelo extrato ou pelo visto.
const SEM_NEGATIVO = /^caixa$/i;
const TITULO_VENDA = /^\s*\d-\d{3,7}\/\d{1,3}\s*$/;  // "1-34912/1": parcela de NF de venda vinda do Iniflex
const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const cent = (v) => Math.round(+v * 100);
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const difDias = (a, b) => Math.round((Date.parse(a + 'T12:00:00') - Date.parse(b + 'T12:00:00')) / 864e5);
const fimMes = (m) => { const [a, mm] = m.split('-').map(Number); return new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10); };
const chunks = (arr, k = 150) => { const o = []; for (let i = 0; i < arr.length; i += k) o.push(arr.slice(i, i + k)); return o; };
const nomeMes = (m) => { const [a, mm] = m.split('-'); const n = MESES[+mm - 1]; return `${n.charAt(0)}${n.slice(1).toLowerCase()}/${a}`; };
const kval = (v) => { const a = Math.abs(v); const s = a >= 1e6 ? (a / 1e6).toFixed(1).replace('.', ',') + 'mi' : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace('.', ',') + 'k' : Math.round(a) + ''; return (v < -0.005 ? '−' : '') + s; };
const kfmt = (v) => { const a = Math.abs(v); const s = a >= 1e6 ? (a / 1e6).toFixed(1).replace('.', ',') + 'mi' : a >= 1e3 ? Math.round(a / 1e3) + 'k' : Math.round(a) + ''; return (v < 0 ? '−' : '+') + s; };

// ---------------------------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------------------------
export async function render(root) {
  rootEl = root;
  root.innerHTML = `
    <div class="card"><div class="card-head" style="margin-bottom:0">
      <div><h2 style="margin:0">Conferência do dia</h2>
        <p class="muted small" style="margin:4px 0 0">Cada quadradinho é uma conta num dia. Verde = saldo e movimento batem com o extrato; vermelho = diverge (mostra a diferença; “…” = diferença que vem de um dia anterior); amarelo = algo para olhar; amarelo tracejado = falta extrato. Clique para abrir o dia, conferir e dar o visto.</p></div>
      <div class="toolbar noprint" style="margin:0" id="cflt">
        <label>Mês<input type="month" name="mes" value="${ui.mes}"></label>
        <span class="chips" style="margin:0"><button type="button" class="chip ${ui.visao === 'mapa' ? 'on' : ''}" data-visao="mapa">Mapa do mês</button><button type="button" class="chip ${ui.visao === 'conta' ? 'on' : ''}" data-visao="conta">Saldos da conta</button></span>
        <label id="cf-lconta" ${ui.visao === 'conta' ? '' : 'hidden'}>Conta<select name="conta"></select></label>
        <span id="cf-opmapa" style="display:${ui.visao === 'mapa' ? 'contents' : 'none'}">
        <label class="chk"><input type="checkbox" name="saldos" ${ui.saldos ? 'checked' : ''}> mostrar saldos</label>
        <label class="chk"><input type="checkbox" name="soProb" ${ui.soProb ? 'checked' : ''}> só com problema</label>
        <label class="chk"><input type="checkbox" name="todas" ${ui.todas ? 'checked' : ''}> todas as contas</label></span>
        <button class="btn" id="cimp" type="button">Imprimir / PDF</button>
      </div></div></div>
    <div id="ccorpo"><div class="loading">Conferindo o mês…</div></div>`;
  $('#cflt', root).addEventListener('change', (e) => {
    const t = e.target; if (!t.name) return;
    if (t.name === 'mes') { if (!t.value) return; ui.mes = t.value; try { localStorage.setItem(LS, ui.mes); } catch {} carregar(); }
    else if (t.name === 'conta') { ui.conta = t.value; pintar(); }
    else { ui[t.name] = t.checked; pintar(); }
  });
  $('#cflt', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-visao]'); if (!b) return;
    ui.visao = b.dataset.visao;
    $$('[data-visao]', root).forEach(x => x.classList.toggle('on', x.dataset.visao === ui.visao));
    $('#cf-lconta', root).hidden = ui.visao !== 'conta'; $('#cf-opmapa', root).style.display = ui.visao === 'mapa' ? 'contents' : 'none';
    pintar();
  });
  $('#cimp', root).onclick = imprimir;
  await carregar();
}

// impressão em paisagem (A4 deitado) só para esta tela: o mapa do mês tem 31 colunas.
// Vale pelo botão e também pelo Ctrl+P (beforeprint). A arrumação só é desfeita no afterprint — desfazer antes
// (com o diálogo de impressão ainda aberto) fazia a prévia voltar para retrato.
function prepararImpressao() {
  if (!rootEl || !rootEl.querySelector('.cf-grid') || !location.hash.startsWith('#/conferencia') || document.getElementById('cf-print')) return;
  const st = document.createElement('style');
  st.id = 'cf-print';
  st.textContent = '@page{size:A4 landscape;margin:7mm}';
  document.head.appendChild(st);
  document.body.classList.add('cf-imprimindo');
  // mede o conteúdo na largura útil da folha (A4 deitado, margem 7 mm ≈ 1066 × 740 px) e reduz até caber numa página
  const W = 1066, H = 735;
  rootEl.style.width = W + 'px'; rootEl.style.zoom = '';
  const z = Math.min(1, H / rootEl.scrollHeight, W / rootEl.scrollWidth);
  rootEl.style.zoom = String(Math.floor(z * 100) / 100);
}
function desfazerImpressao() {
  document.getElementById('cf-print')?.remove();
  document.body.classList.remove('cf-imprimindo');
  if (rootEl) { rootEl.style.width = ''; rootEl.style.zoom = ''; }
}
function imprimir() { prepararImpressao(); window.print(); }
window.addEventListener('beforeprint', prepararImpressao);
window.addEventListener('afterprint', desfazerImpressao);


async function carregar() {
  const c = $('#ccorpo', rootEl); if (!c) return;
  c.innerHTML = '<div class="loading">Conferindo o mês…</div>';
  try { D = await montar(ui.mes); } catch (e) { fail(e); c.innerHTML = '<div class="card"><div class="empty">Não foi possível conferir o mês.</div></div>'; return; }
  pintar();
}

// ---------------------------------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------------------------------
async function montar(mes) {
  await loadCadastros();
  const cad = state.cad, e = state.empresa.id, ini = `${mes}-01`, fim = fimMes(mes);
  const iniW = addDias(ini, -5), fimW = addDias(fim, 5);   // folga para duplicidade e transferências na virada do mês
  const [saldos, lancsRaw, semConta, ext, imps, travas, vistos] = await Promise.all([
    q(sb.rpc('saldos_contas', { p_empresa: e, p_ate: addDias(ini, -1) })),
    fetchAll(() => sb.from('lancamentos').select('id,data,valor,plano_id,favorecido_id,descricao,documento,conta_id,conta_destino_id,centro_custo_id,status')
      .eq('empresa_id', e).eq('status', 'Pago').not('conta_id', 'is', null).gte('data', iniW).lte('data', fimW).order('data').order('id')),
    fetchAll(() => sb.from('lancamentos').select('id,data,valor').eq('empresa_id', e).eq('status', 'Pago').is('conta_id', null).gte('data', ini).lte('data', fim).order('id')),
    fetchAll(() => sb.from('extrato_itens').select('id,conta_id,data,valor,status,descricao,documento').eq('empresa_id', e).gte('data', ini).lte('data', fim).order('data').order('id')),
    q(sb.from('extrato_importacoes').select('conta_id,dt_inicio,dt_fim,saldo_final,saldo_data,created_at,banco').eq('empresa_id', e)),
    q(sb.from('contas_travas').select('conta_id,ate,saldo_banco').eq('empresa_id', e).eq('ativo', true)).catch(() => []),
    q(sb.from('conferencias_dia').select('*').eq('empresa_id', e).gte('data', ini).lte('data', fim)).catch(() => null), // null = tabela ainda não instalada
  ]);
  // saldo do banco no fim de cada dia: parte do saldo final de uma importação (OFX: LEDGERBAL; ERP: saldo no fim do
  // período) e desconta o movimento do extrato depois do dia. Âncora = importação que cobre o dia, com saldo, mais próxima depois dele.
  // O saldo do OFX do Bradesco (237) não serve de referência: vem zerado ou com valor que não é o saldo da conta
  // (diferença constante desde o 1º dia do arquivo). Nessa conta vale só a comparação do movimento do dia.
  // Havendo outra importação da mesma conta e data com saldo, vale a mais recente com saldo.
  const SALDO_OFX_NAO_CONFIAVEL = /^0*237$/;
  const porAnc = new Map();
  for (const i of (imps || []).filter(i => i.saldo_final != null && i.saldo_data && i.dt_inicio && i.saldo_data >= ini && i.dt_inicio <= fim && !SALDO_OFX_NAO_CONFIAVEL.test(String(i.banco || '').trim()))) {
    const k = `${i.conta_id}|${i.saldo_data}`, o = porAnc.get(k);
    const melhor = !o || (Math.abs(+o.saldo_final) < 0.005 && Math.abs(+i.saldo_final) >= 0.005) || ((Math.abs(+i.saldo_final) >= 0.005) === (Math.abs(+o.saldo_final) >= 0.005) && i.created_at > o.created_at);
    if (melhor) porAnc.set(k, { ...i, dt_inicio: o && o.dt_inicio < i.dt_inicio ? o.dt_inicio : i.dt_inicio });
    else if (i.dt_inicio < o.dt_inicio) o.dt_inicio = i.dt_inicio;
  }
  const ancoras = [...porAnc.values()];
  const fimAnc = ancoras.reduce((m, i) => (i.saldo_data > m ? i.saldo_data : m), fim);
  const extDepois = fimAnc > fim ? await fetchAll(() => sb.from('extrato_itens').select('id,conta_id,data,valor').eq('empresa_id', e).gt('data', fim).lte('data', fimAnc).order('data').order('id')) : [];
  // transferência única vira duas pontas (origem e destino); daqui em diante tudo é por ponta
  const lancs = pontas(lancsRaw);
  // conciliações dos itens do extrato do mês e notas ligadas aos lançamentos do mês
  const lMes = lancs.filter(l => l.data >= ini && l.data <= fim);
  const conc = [], vinc = [];
  await Promise.all([
    ...chunks(ext.map(x => x.id)).map(ch => q(sb.from('conciliacoes').select('extrato_id,lancamento_id,conta_id').in('extrato_id', ch)).then(r => conc.push(...r))),
    ...chunks(lMes.map(l => l.id)).map(ch => q(sb.from('nfe_vinculos').select('lancamento_id,n:nfe_notas(numero,tipo)').in('lancamento_id', ch)).then(r => vinc.push(...r)).catch(() => {})),
  ]);
  const ck = (id, conta) => `${id}|${conta}`;   // a mesma transferência é conciliada uma vez em cada conta
  const concL = new Map(); for (const k of conc) concL.set(ck(k.lancamento_id, k.conta_id), k.extrato_id);
  const concX = new Map(); for (const k of conc) { if (!concX.has(k.extrato_id)) concX.set(k.extrato_id, []); concX.get(k.extrato_id).push(k.lancamento_id); }
  const lancPorPonta = new Map(lancs.map(l => [ck(l.id, l.conta_id), l]));
  const extById = new Map([...ext, ...extDepois].map(x => [x.id, x]));
  const notaL = new Map(); for (const v of vinc) if (v.n) notaL.set(v.lancamento_id, v.n);
  const sinal = (l) => l.sinal;

  // ----- alertas por lançamento -----
  const alertas = new Map();   // lancamento_id -> [{t, msg}]
  const add = (id, t, msg) => { if (!alertas.has(id)) alertas.set(id, []); const a = alertas.get(id); if (!a.some(x => x.msg === msg)) a.push({ t, msg }); };
  // 1) possível duplicidade: mesma conta, mesmo valor e sinal, mesmo favorecido E mesma descrição, até 3 dias de distância
  //    (lançamentos em sequência formam um grupo). Não acusa o grupo quando cada um está provado diferente: conciliado com
  //    uma linha própria do extrato ou ligado a uma nota diferente.
  const chave = (l) => `${l.conta_id}|${cent(sinal(l))}|${l.favorecido_id || '-'}|${normTxt(l.descricao).replace(/\s+/g, ' ')}`;
  const grp = new Map();
  for (const l of lancs) { if (!l.favorecido_id && !normTxt(l.descricao)) continue; const k = chave(l); if (!grp.has(k)) grp.set(k, []); grp.get(k).push(l); }
  for (const g of grp.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => a.data.localeCompare(b.data));
    const clusters = []; let cur = [g[0]];
    for (let i = 1; i < g.length; i++) { if (difDias(g[i].data, cur[cur.length - 1].data) <= 3) cur.push(g[i]); else { clusters.push(cur); cur = [g[i]]; } }
    clusters.push(cur);
    for (const cl of clusters) {
      if (cl.length < 2) continue;
      const provas = cl.map(l => concL.get(ck(l.id, l.conta_id)) ? 'x' + concL.get(ck(l.id, l.conta_id)) : notaL.get(l.id) ? 'n' + notaL.get(l.id).numero : null);
      if (provas.every(Boolean) && new Set(provas).size === cl.length) continue;
      const d1 = cl[0].data, d2 = cl[cl.length - 1].data;
      const msg = `Possível duplicidade: ${cl.length} lançamentos iguais (${money(cl[0].valor)}, ${cl[0].favorecido_id ? 'mesmo favorecido e ' : ''}mesma descrição) ${d1 === d2 ? `no dia ${dateBR(d1)}` : `entre ${dateBR(d1)} e ${dateBR(d2)}`}`;
      for (const l of cl) add(l.id, 'dup', msg);
    }
  }
  // 1b) o mesmo título do Iniflex ("1-34914/1") lançado duas vezes, em qualquer conta
  const tit = new Map();
  for (const l of lancs) if (TITULO_VENDA.test(l.descricao || '')) { const k = `${l.descricao.trim()}|${cent(l.valor)}`; if (!tit.has(k)) tit.set(k, []); tit.get(k).push(l); }
  for (const g of tit.values()) if (g.length > 1) for (const l of g) add(l.id, 'dup', `Título ${l.descricao.trim()} aparece ${g.length} vezes (${g.map(o => `${cad.contaById[o.conta_id]?.nome || '?'} ${dateBR(o.data)}`).join(', ')})`);
  for (const l of lMes) {
    const p = cad.planoById[l.plano_id]; if (!p) continue;
    // 2) classificação suspeita
    if (TITULO_VENDA.test(l.descricao || '') && p.natureza === 'D') add(l.id, 'clas', `Título de venda (${l.descricao.trim()}) lançado como saída em ${p.codigo} ${p.nome}: o certo costuma ser receita (entrada).`);
    const n = notaL.get(l.id);
    if (n?.tipo === 'saida' && p.natureza === 'D') add(l.id, 'clas', `Ligado à NF de venda ${n.numero}, mas lançado como saída (${p.codigo}).`);
    if (n?.tipo === 'entrada' && p.natureza === 'C') add(l.id, 'clas', `Ligado à NF de compra ${n.numero}, mas lançado como entrada (${p.codigo}).`);
    // 3) transferência sem a outra ponta (mesmo valor, sinal contrário, outra conta, até 1 dia)
    if (p.tipo === 'T' && !l.conta_destino_id) {   // transferência única já tem as duas pontas
      const par = lancs.some(o => o.id !== l.id && o.conta_id !== l.conta_id && cad.planoById[o.plano_id]?.tipo === 'T' && cent(o.valor) === cent(l.valor)
        && cad.planoById[o.plano_id]?.natureza !== p.natureza && Math.abs(difDias(o.data, l.data)) <= 1);
      if (!par) add(l.id, 'transf', `Transferência ${p.natureza === 'D' ? 'de saída' : 'de entrada'} de ${money(l.valor)} sem a outra ponta em outra conta (mesmo valor, até 1 dia).`);
    }
    // 4) adiantamento sem favorecido (não entra em Créditos nem no conta-corrente do fornecedor)
    if (!l.favorecido_id && /ADIANTAMENTO/i.test(l.descricao || '')) add(l.id, 'fav', 'Adiantamento sem favorecido: não aparece no conta-corrente do fornecedor.');
  }

  // ----- células conta × dia -----
  const dias = []; for (let d = ini; d <= fim; d = addDias(d, 1)) dias.push(d);
  const saldoAnt = new Map(saldos.map(s => [s.conta_id, +s.saldo_pago]));
  const trv = new Map((travas || []).map(t => [t.conta_id, t]));
  const vis = new Map((vistos || []).map(v => [`${v.conta_id}|${v.data}`, v]));
  const cobre = (cid, d) => imps.some(i => i.conta_id === cid && i.dt_inicio <= d && d <= i.dt_fim);
  const porConta = new Map();
  for (const l of lMes) { if (!porConta.has(l.conta_id)) porConta.set(l.conta_id, []); porConta.get(l.conta_id).push(l); }
  const extConta = new Map();
  for (const x of ext) { if (!extConta.has(x.conta_id)) extConta.set(x.conta_id, []); extConta.get(x.conta_id).push(x); }
  // movimento do extrato por conta e dia (todas as linhas, inclusive ignoradas: o banco as tem no saldo)
  const movExt = new Map();
  for (const x of [...ext, ...extDepois]) { const k = `${x.conta_id}|${x.data}`; movExt.set(k, (movExt.get(k) || 0) + +x.valor); }
  const saldoBanco = (cid, d) => {
    const a = ancoras.filter(i => i.conta_id === cid && i.dt_inicio <= d && d <= i.saldo_data).sort((p, q2) => p.saldo_data.localeCompare(q2.saldo_data))[0];
    if (!a) return null;
    let s = +a.saldo_final; for (let k = addDias(d, 1); k <= a.saldo_data; k = addDias(k, 1)) s -= movExt.get(`${cid}|${k}`) || 0;
    return Math.round(s * 100) / 100;
  };
  const ativas = cad.contas.filter(ct => ct.ativo !== false);
  const linhas = [];
  for (const ct of ativas) {
    const ls = porConta.get(ct.id) || [], xs = extConta.get(ct.id) || [];
    const s0 = saldoAnt.get(ct.id) ?? +ct.saldo_inicial ?? 0;
    const semNeg = SEM_NEGATIVO.test(ct.tipo || ''), trava = trv.get(ct.id) || null;
    let saldo = s0; const cel = []; let difAnt = 0, difDesde = null;
    for (const d of dias) {
      const dl = ls.filter(l => l.data === d), dx = xs.filter(x => x.data === d);
      const ent = dl.reduce((s, l) => s + Math.max(0, sinal(l)), 0), sai = dl.reduce((s, l) => s + Math.min(0, sinal(l)), 0);
      const ini_ = saldo; saldo = +(saldo + ent + sai).toFixed(2);
      const temExt = dx.length > 0 || cobre(ct.id, d);
      const extMov = dx.filter(x => x.status !== 'ignorado').reduce((s, x) => s + +x.valor, 0);
      const pend = dx.filter(x => x.status === 'pendente');
      const naoConc = temExt ? dl.filter(l => !concL.has(ck(l.id, l.conta_id))) : [];
      const al = dl.flatMap(l => (alertas.get(l.id) || []).map(a => ({ ...a, l })));
      const v = vis.get(`${ct.id}|${d}`) || null;
      const travado = !!(trava && d <= trava.ate);
      const ativo = dl.length || dx.length;
      const probs = [];
      if (semNeg && saldo < -TOL) probs.push({ t: 'neg', msg: `Caixa em espécie terminou o dia NEGATIVO (${money(saldo)}): falta lançar entrada (saque/suprimento) ou há saída a mais.` });
      // diferença de data: item do extrato conciliado com lançamento de outro dia (ex.: PIX de sábado que o banco lança na segunda)
      const datas = [];
      let desloc = 0;
      for (const x of dx) {
        if (x.status !== 'conciliado') continue;
        const outros = (concX.get(x.id) || []).map(id => lancPorPonta.get(ck(id, ct.id))).filter(l => l && l.data !== d);
        if (outros.length && outros.length === (concX.get(x.id) || []).length) { desloc -= +x.valor; datas.push(`Extrato de ${money(x.valor)} conciliado com lançamento de ${[...new Set(outros.map(l => dateBR(l.data)))].join(', ')}.`); }
      }
      for (const l of dl) {
        const x = extById.get(concL.get(ck(l.id, l.conta_id)));
        if (x && x.data !== d) { desloc += sinal(l); datas.push(`Lançamento de ${money(sinal(l))} conciliado com o extrato de ${dateBR(x.data)}.`); }
      }
      const difMov = (ent + sai) - extMov;
      if (temExt && Math.abs(difMov) > TOL) {
        if (Math.abs(difMov - desloc) <= TOL) datas.unshift(`Diferença de ${money(difMov)} só de data (conciliado em outro dia).`);
        else probs.push({ t: 'dif', msg: `Movimento do sistema (${money(ent + sai)}) diferente do extrato (${money(extMov)}): diferença ${money(difMov)}.` });
      } else if (Math.abs(desloc) <= TOL) datas.length = 0;
      if (pend.length) probs.push({ t: 'pend', msg: `${pend.length} linha(s) do extrato sem lançamento conciliado (${money(pend.reduce((s, x) => s + +x.valor, 0))}).` });
      // saldo do sistema × saldo do banco no fim do dia (extrato importado ou saldo informado no visto)
      const banco = temExt ? saldoBanco(ct.id, d) : null;
      const ref = banco ?? (v?.saldo_informado != null ? +v.saldo_informado : null);
      let difSaldo = null, arrasta = false;
      if (ref != null) {
        difSaldo = Math.round((saldo - ref) * 100) / 100;
        if (Math.abs(difSaldo) > TOL) {
          arrasta = Math.abs(difSaldo - difAnt) <= TOL && difDesde;
          if (!arrasta) difDesde = d;
          if (banco != null && (ativo || !arrasta)) probs.push({ t: 'saldo', msg: arrasta
            ? `Saldo do sistema ${money(saldo)} × banco ${money(banco)}: diferença de ${money(difSaldo)} que vem de ${dateBR(difDesde)} (o dia em si bate).`
            : `Saldo do sistema ${money(saldo)} × banco ${money(banco)}: diferença de ${money(difSaldo)} começa neste dia.` });
        } else difDesde = null;
        difAnt = Math.abs(difSaldo) > TOL ? difSaldo : 0;
      }
      if (v?.saldo_informado != null && Math.abs(+v.saldo_informado - saldo) > TOL) probs.push({ t: 'inf', msg: `Saldo informado no visto (${money(v.saldo_informado)}) diferente do sistema (${money(saldo)}).` });
      let st;
      if (!ativo && !probs.length) st = 'vazio';
      else if (probs.length) st = 'erro';
      else if (al.length || naoConc.length || datas.length) st = 'alerta';
      else if (temExt) st = 'ok';
      else st = 'semext';
      const conferido = !!v || (travado && (st === 'ok' || st === 'semext'));
      cel.push({ d, ct, dl, dx, ent, sai, ini: ini_, fim: saldo, temExt, extMov, pend, naoConc, al, datas, probs, st, v, travado, conferido, banco, difSaldo, arrasta });
    }
    const usada = ls.length || xs.length || Math.abs(s0) > TOL || Math.abs(saldo) > TOL;
    linhas.push({ ct, cel, s0, sFim: saldo, trava, usada });
  }
  linhas.sort((a, b) => (b.usada - a.usada) || String(a.ct.codigo || '').localeCompare(String(b.ct.codigo || ''), 'pt', { numeric: true }) || a.ct.nome.localeCompare(b.ct.nome));
  return { mes, ini, fim, dias, linhas, semConta, vistosOk: vistos !== null };
}

// ---------------------------------------------------------------------------------------------
// Mapa do mês
// ---------------------------------------------------------------------------------------------
const ICONE = { erro: '✕', alerta: '!', ok: '✓', semext: '?', vazio: '' };
const DESC = { erro: 'diverge (saldo ou movimento)', alerta: 'algo para olhar', ok: 'bate com o extrato', semext: 'falta extrato', vazio: 'sem movimento' };

function pintar() {
  const c = $('#ccorpo', rootEl); if (!c || !D) return;
  // lista de contas do seletor (as usadas no mês primeiro)
  const sel = $('#cflt select[name=conta]', rootEl);
  if (sel) {
    const us = D.linhas.filter(r => r.usada);
    if (!ui.conta || !D.linhas.some(r => r.ct.id === ui.conta)) ui.conta = us[0]?.ct.id || D.linhas[0]?.ct.id || '';
    sel.innerHTML = D.linhas.filter(r => r.usada || r.ct.id === ui.conta).map(r => `<option value="${r.ct.id}" ${r.ct.id === ui.conta ? 'selected' : ''}>${esc(r.ct.nome)}</option>`).join('');
  }
  if (ui.visao === 'conta') return pintarConta(c);
  const linhas = D.linhas.filter(r => ui.todas || r.usada).filter(r => !ui.soProb || r.cel.some(x => x.st === 'erro' || x.st === 'alerta'));
  const cels = D.linhas.flatMap(r => r.cel).filter(x => x.st !== 'vazio');
  const conf = cels.filter(x => x.conferido).length, erro = cels.filter(x => x.st === 'erro' && !x.v).length, alerta = cels.filter(x => x.st === 'alerta' && !x.v).length;
  const falta = cels.filter(x => x.st === 'semext' && !x.conferido).length;
  const prontos = cels.filter(x => x.st === 'ok' && !x.conferido);
  const pct = cels.length ? Math.round(conf / cels.length * 100) : 100;
  c.innerHTML = `
    ${D.vistosOk ? '' : '<div class="card" style="border-color:var(--warn)"><strong>Falta instalar o visto no banco de dados.</strong> <span class="small">A conferência funciona, mas o botão “Dia conferido” só grava depois de rodar o SQL <code>20261013000028_conferencia_dia.sql</code>.</span></div>'}
    <div class="kpis">
      <div class="kpi"><div class="k-label">Conferência de ${esc(nomeMes(D.mes))}</div><div class="k-value ${pct === 100 ? 'pos' : ''}">${pct}%</div>
        <div class="k-sub">${conf} de ${cels.length} dias-conta conferidos</div><div class="cf-prog"><span style="width:${pct}%"></span></div></div>
      <div class="kpi"><div class="k-label">Divergem</div><div class="k-value ${erro ? 'neg' : ''}">${erro}</div><div class="k-sub">saldo ou movimento ≠ extrato, ou caixa negativo</div></div>
      <div class="kpi"><div class="k-label">Falta extrato</div><div class="k-value ${falta ? 'warn' : ''}">${falta}</div><div class="k-sub">dias com movimento sem extrato nem saldo informado</div></div>
      <div class="kpi"><div class="k-label">Para olhar</div><div class="k-value ${alerta ? 'warn' : ''}">${alerta}</div><div class="k-sub">duplicidade, classificação, transferência</div></div>
      <div class="kpi"><div class="k-label">Pagos sem conta no mês</div><div class="k-value ${D.semConta.length ? 'neg' : ''}">${D.semConta.length}</div><div class="k-sub">${D.semConta.length ? `${money0(D.semConta.reduce((s, l) => s + +l.valor, 0))} fora do saldo das contas` : 'nenhum'}</div></div>
    </div>
    <div class="card flush">
      <div class="cf-head noprint"><div class="cf-leg">${['ok', 'erro', 'alerta', 'semext'].map(s => `<span><i class="cf-c ${s}">${ICONE[s]}</i>${DESC[s]}</span>`).join('')}<span><i class="cf-c ok conf">✔</i>conferido</span><span title="Visto dado num dia que tinha aviso ou diferença, com a explicação na observação"><i class="cf-c ok conf just">✔</i>conferido com justificativa</span><span><i class="cf-c ok trav">✔</i>travado</span><span title="Visto dado com o saldo do banco diferente da plataforma: mostra a diferença (banco − plataforma) até corrigir"><i class="cf-c alerta conf">±</i>conferido com diferença de saldo</span></div>
        ${podeEditar() && D.vistosOk && prontos.length ? `<button class="btn small primary" id="cflote">Dar visto nos ${prontos.length} dia(s) que batem</button>` : ''}</div>
      <div class="table-wrap cf-wrap"><table class="cf-grid"><thead><tr><th class="cf-conta">Conta</th>
        ${D.dias.map(d => { const w = new Date(d + 'T12:00:00').getDay(); return `<th class="${w === 0 || w === 6 ? 'fds' : ''}">${+d.slice(8)}<div>${SEM[w].charAt(0).toUpperCase()}</div></th>`; }).join('')}
        <th class="num">Saldo ${dateBR(D.fim).slice(0, 5)}</th></tr></thead><tbody>
      ${linhas.map((r, ri) => `<tr><td class="cf-conta"><strong>${esc(r.ct.nome)}</strong><div class="small muted">${esc(r.ct.tipo || '')}${SEM_NEGATIVO.test(r.ct.tipo || '') ? ' · não pode ficar negativo' : ''}${r.trava ? ` · 🔒 ${dateBR(r.trava.ate)}` : ''}</div></td>
        ${r.cel.map((x, di) => celula(x, ri, di)).join('')}
        <td class="num ${(SEM_NEGATIVO.test(r.ct.tipo || '') && r.sFim < -TOL) ? 'neg' : cls(r.sFim)}">${money(r.sFim)}</td></tr>`).join('') || `<tr><td colspan="${D.dias.length + 2}" class="muted">${ui.soProb ? 'Nenhuma conta com problema no mês. 🎉' : 'Nenhuma conta com movimento no mês.'}</td></tr>`}
      </tbody></table></div>
      <p class="small muted" style="padding:0 12px 10px">Bate = movimento do dia e saldo no fim do dia iguais aos do extrato importado (OFX do banco ou relatório do ERP), sem linha pendente. O saldo do banco vem do saldo final do extrato importado, descontado o movimento dos dias seguintes. Diverge = o saldo ou o movimento não batem: o primeiro dia mostra a diferença e os seguintes, “…”, enquanto a mesma diferença continuar. Falta extrato = dia com movimento sem extrato importado: importe o extrato ou dê o visto informando o saldo real do dia. Caixa em espécie (tipo Caixa) também fica vermelho em todo dia em que terminar negativo.</p>
    </div>
    <p class="muted small">Conferido em ${new Date().toLocaleString('pt-BR')} · ${esc(state.empresa.nome || '')}</p>`;
  // abre o dia: clique ou Enter no quadradinho
  const abrirDe = (el) => { const td = el.closest('td[data-r]'); if (td) abrirDia(D.linhas.indexOf(linhas[+td.dataset.r]), +td.dataset.d); };
  $('.cf-grid tbody', c).onclick = (e) => abrirDe(e.target);
  $('.cf-grid tbody', c).onkeydown = (e) => {
    const td = e.target.closest('td[data-r]'); if (!td) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); abrirDe(td); return; }
    const mv = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key]; if (!mv) return;
    e.preventDefault(); const n = $(`td[data-r="${+td.dataset.r + mv[0]}"][data-d="${+td.dataset.d + mv[1]}"]`, c); n && n.focus();
  };
  $('#cflote', c) && ($('#cflote', c).onclick = () => vistoLote(prontos));
}

function celula(x, ri, di) {
  const w = new Date(x.d + 'T12:00:00').getDay(), fds = w === 0 || w === 6;
  if (x.st === 'vazio') return `<td class="cf-td ${fds ? 'fds' : ''}" data-r="${ri}" data-d="${di}" tabindex="-1"><i class="cf-c vazio"></i></td>`;
  const ressalva = x.v?.situacao === 'ressalva' || (x.v && (x.st === 'erro' || x.st === 'alerta'));
  // visto dado com saldo diferente do banco: não fica verde — fica amarelo com a diferença até corrigir
  const difConf = x.conferido && x.difSaldo != null && Math.abs(x.difSaldo) > TOL;
  const k = difConf ? 'alerta conf' : x.conferido ? `ok ${x.v ? 'conf' : 'trav'}${ressalva ? ' just' : ''}` : x.st;   // ressalva com visto = justificada (verde)
  const pd = x.probs.find(p => p.t === 'dif'), pn = x.probs.find(p => p.t === 'neg'), ps = x.probs.find(p => p.t === 'saldo');
  const txt = ui.saldos ? kval(x.fim) : difConf ? (x.arrasta ? '…' : kfmt(-x.difSaldo)) : x.conferido ? '✔' : x.st === 'erro' ? (pn ? kfmt(x.fim) : pd ? kfmt(x.ent + x.sai - x.extMov) : ps ? (x.arrasta ? '…' : kfmt(x.difSaldo)) : '✕') : ICONE[x.st];
  const tip = [`${x.ct.nome} · ${SEM[w]} ${dateBR(x.d)}`, `${x.dl.length} lançamento(s): entradas ${money(x.ent)} · saídas ${money(x.sai)} · saldo ${money(x.fim)}`,
    x.temExt ? `extrato: ${x.dx.length} linha(s), movimento ${money(x.extMov)}${x.banco != null ? ` · saldo no banco ${money(x.banco)}` : ''}` : 'falta extrato (importe o OFX/relatório do ERP ou informe o saldo real no visto)',
    ...x.probs.map(p => '✕ ' + p.msg), ...(x.datas || []).slice(0, 2).map(t => '! ' + t), ...[...new Set(x.al.map(a => '! ' + a.msg))].slice(0, 3), x.naoConc.length ? `! ${x.naoConc.length} lançamento(s) não conciliados com o extrato` : '',
    x.v ? `✔ visto de ${x.v.conferido_email || 'usuário'} em ${new Date(x.v.conferido_em).toLocaleString('pt-BR')}` : x.travado ? '🔒 conta travada até ' + dateBR(x.ct && D.linhas.find(r => r.ct.id === x.ct.id)?.trava?.ate) : ''].filter(Boolean).join('\n');
  return `<td class="cf-td ${fds ? 'fds' : ''}" data-r="${ri}" data-d="${di}" tabindex="0" title="${esc(tip)}"><i class="cf-c ${k}${ui.saldos ? ' sld' : ''}">${txt}</i></td>`;
}

// ---------------------------------------------------------------------------------------------
// Saldos da conta: uma linha por dia, com o saldo do banco digitável na própria linha
// ---------------------------------------------------------------------------------------------
function pintarConta(c) {
  const ri = D.linhas.findIndex(r => r.ct.id === ui.conta); const r = D.linhas[ri];
  if (!r) { c.innerHTML = '<div class="card"><div class="empty">Escolha a conta.</div></div>'; return; }
  const ed = podeEditar() && D.vistosOk;
  // dias úteis + qualquer dia com movimento, extrato ou visto
  const dias = r.cel.map((x, di) => ({ x, di })).filter(({ x }) => { const w = new Date(x.d + 'T12:00:00').getDay(); return (w !== 0 && w !== 6) || x.st !== 'vazio' || x.v; });
  let difAnt = null, desde = null;
  const linhas = dias.map(({ x, di }) => {
    const w = new Date(x.d + 'T12:00:00').getDay();
    const ref = x.banco ?? (x.v?.saldo_informado != null ? +x.v.saldo_informado : null);
    const dif = ref == null ? null : Math.round((ref - x.fim) * 100) / 100;
    let sit = '';
    if (dif == null) { sit = x.st === 'vazio' && !x.dl.length ? '<span class="muted">sem movimento</span>' : '<span class="warn">falta o saldo do banco</span>'; }
    else if (Math.abs(dif) <= TOL) { sit = '<span class="pos">✓ bate</span>'; difAnt = null; desde = null; }
    else if (difAnt != null && Math.abs(dif - difAnt) <= TOL) sit = `<span class="warn">… vem de ${dateBR(desde).slice(0, 5)}</span>`;
    else { sit = '<strong class="neg">começa aqui</strong>'; desde = x.d; }
    if (dif != null && Math.abs(dif) > TOL) difAnt = dif;
    const outros = x.probs.filter(p => p.t !== 'saldo' && p.t !== 'inf').length + x.al.length + x.naoConc.length;
    const banco = x.banco != null ? `<span title="pelo extrato importado">${money(x.banco)}</span>`
      : ed ? `<input class="cf-sal-in" data-di="${di}" inputmode="decimal" value="${x.v?.saldo_informado != null ? money(x.v.saldo_informado) : ''}" placeholder="digite" style="width:120px;text-align:right">`
      : (x.v?.saldo_informado != null ? money(x.v.saldo_informado) : '—');
    return `<tr class="${dif != null && Math.abs(dif) > TOL ? 'cf-row-al' : ''}"><td class="nowrap">${dateBR(x.d).slice(0, 5)} <span class="muted small">${SEM[w]}</span></td>
      <td class="num">${money(x.ini)}</td><td class="num pos">${x.ent ? money(x.ent) : ''}</td><td class="num neg">${x.sai ? money(x.sai) : ''}</td>
      <td class="num"><strong>${money(x.fim)}</strong></td><td class="num">${banco}</td>
      <td class="num ${dif != null && Math.abs(dif) > TOL ? 'neg' : ''}">${dif == null ? '' : money(dif)}</td>
      <td class="small">${sit}${x.conferido ? ' <span class="badge pago" title="dia conferido">✔</span>' : ''}${outros ? ` <span class="badge aberto" title="avisos no dia (lançamentos, conciliação, duplicidade)">! ${outros}</span>` : ''}</td>
      <td class="noprint"><button class="btn ghost icon small" data-dia="${di}" title="Abrir o dia">›</button></td></tr>`;
  });
  const ent = r.cel.reduce((s, x) => s + x.ent, 0), sai = r.cel.reduce((s, x) => s + x.sai, 0);
  const ult = [...r.cel].reverse().find(x => x.banco != null || x.v?.saldo_informado != null);
  const refUlt = ult ? (ult.banco ?? +ult.v.saldo_informado) : null;
  const prontos = r.cel.filter(x => x.st === 'ok' && !x.conferido);
  c.innerHTML = `<div class="card flush"><div class="card-head" style="padding:12px 12px 0"><div><h2 style="margin:0">${esc(r.ct.nome)} — ${esc(nomeMes(D.mes))}</h2>
      <p class="muted small" style="margin:4px 0 0">Uma linha por dia. ${ed ? 'Digite o saldo do extrato do banco na coluna “Saldo no banco” e tecle Enter: o dia fica conferido e o cursor vai para o próximo. ' : ''}Diferença = banco − plataforma; o primeiro dia de uma diferença aparece como “começa aqui” e os seguintes, enquanto for a mesma, como “…”.</p></div>
      ${ed && prontos.length ? `<button class="btn small primary" id="cflote2">Dar visto nos ${prontos.length} dia(s) que batem com o extrato</button>` : ''}</div>
    <div class="table-wrap"><table class="cf-saldos"><thead><tr><th>Dia</th><th class="num">Saldo inicial</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Saldo final (plataforma)</th><th class="num">Saldo no banco</th><th class="num">Diferença</th><th>Situação</th><th></th></tr></thead>
      <tbody>${linhas.join('')}</tbody>
      <tfoot><tr><th>Mês</th><th class="num">${money(r.s0)}</th><th class="num pos">${money(ent)}</th><th class="num neg">${money(sai)}</th><th class="num">${money(r.sFim)}</th>
        <th class="num">${refUlt != null ? money(refUlt) : '—'}</th><th class="num ${refUlt != null && Math.abs(refUlt - (ult?.fim ?? 0)) > TOL ? 'neg' : ''}">${refUlt != null ? money(refUlt - ult.fim) : ''}</th><th class="small muted">${ult ? `último saldo do banco: ${dateBR(ult.d)}` : 'nenhum saldo do banco no mês'}</th><th></th></tr></tfoot></table></div></div>`;
  $$('[data-dia]', c).forEach(b => b.onclick = () => abrirDia(ri, +b.dataset.di));
  $('#cflote2', c) && ($('#cflote2', c).onclick = () => vistoLote(prontos));
  const ins = $$('.cf-sal-in', c);
  ins.forEach((inp, i) => {
    const salvar = async (ir) => {
      const x = r.cel[+inp.dataset.di]; const t = inp.value.trim();
      const atual = x.v?.saldo_informado != null ? +x.v.saldo_informado : null;
      if (!t) { if (ir) ins[i + 1]?.focus(); return; }
      const sal = parseNum(t); if (sal == null || isNaN(sal)) { toast('Saldo inválido', true); return; }
      if (atual != null && Math.abs(atual - sal) < 0.005) { if (ir) ins[i + 1]?.focus(); return; }
      const problema = x.probs.some(p => p.t !== 'saldo' && p.t !== 'inf') || x.al.length || x.naoConc.length;
      const reg = { empresa_id: state.empresa.id, conta_id: x.ct.id, data: x.d, situacao: problema || Math.abs(sal - x.fim) > TOL ? 'ressalva' : 'ok', saldo_sistema: x.fim, saldo_informado: sal,
        observacao: x.v?.observacao || null };
      try {
        await q(sb.from('conferencias_dia').upsert(reg, { onConflict: 'conta_id,data' }));
        const proxDi = ins[i + 1]?.dataset.di;
        D = await montar(D.mes); pintar();
        if (ir && proxDi != null) $(`.cf-sal-in[data-di="${proxDi}"]`, c)?.focus();
      } catch (e) { fail(e); }
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.dataset.ok = '1'; salvar(true); } });
    inp.addEventListener('change', () => { if (!inp.dataset.ok && inp.isConnected) salvar(false); });
  });
}

// ---------------------------------------------------------------------------------------------
// Detalhe do dia
// ---------------------------------------------------------------------------------------------
let M = null; // modal aberto { el, close, r, d }

function abrirDia(r, d) {
  if (!M || !document.body.contains(M.el)) {
    const m = modal({ title: 'Conferência do dia', body: '<div id="cfd"></div>', wide: true });
    M = { ...m, r, d };
    const onKey = (e) => {
      if (!M || !document.body.contains(M.el)) { document.removeEventListener('keydown', onKey); return; }
      const topo = [...document.querySelectorAll('#modal-root .modal-back')].pop();
      if (topo !== M.el) return;                       // outro modal por cima (ex.: editando o lançamento)
      const tag = e.target.tagName, emCampo = /^(INPUT|TEXTAREA|SELECT)$/.test(tag);
      if (e.key === 'Enter' && !e.shiftKey && !/^(BUTTON|A)$/.test(tag)) { const b = $('#cfvis', M.el); if (b && !b.disabled) { e.preventDefault(); b.click(); } return; }
      if (emCampo) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); passo(0, -1); } else if (e.key === 'ArrowRight') { e.preventDefault(); passo(0, 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); passo(-1, 0); } else if (e.key === 'ArrowDown') { e.preventDefault(); passo(1, 0); }
    };
    document.addEventListener('keydown', onKey);
  }
  M.r = r; M.d = d; pintarDia();
}

// anda para o próximo dia (ou conta) com movimento; dias vazios são pulados
function passo(dr, dd) {
  let r = M.r, d = M.d;
  for (let n = 0; n < 400; n++) {
    if (dd) { d += dd; if (d < 0 || d >= D.dias.length) { r += dd; if (r < 0 || r >= D.linhas.length) return; d = dd > 0 ? 0 : D.dias.length - 1; } }
    else { r += dr; if (r < 0 || r >= D.linhas.length) return; }
    if (D.linhas[r].cel[d].st !== 'vazio' && (ui.todas || D.linhas[r].usada)) { M.r = r; M.d = d; pintarDia(); return; }
  }
}
// próximo dia que ainda precisa de conferência (para seguir depois do visto)
function proximoPendente() {
  for (let r = M.r; r < D.linhas.length; r++) for (let d = r === M.r ? M.d + 1 : 0; d < D.dias.length; d++) { const x = D.linhas[r].cel[d]; if (x.st !== 'vazio' && !x.conferido) return [r, d]; }
  return null;
}

function pintarDia() {
  const x = D.linhas[M.r].cel[M.d], ct = x.ct, cad = state.cad, w = new Date(x.d + 'T12:00:00').getDay();
  $('.modal-head h2', M.el).textContent = `${ct.nome} · ${SEM[w]} ${dateBR(x.d)}`;
  const mov = x.ent + x.sai, semExt = !x.temExt;
  const linhaL = (l) => {
    const p = cad.planoById[l.plano_id], f = cad.favById[l.favorecido_id], v = l.sinal;
    const al = x.al.filter(a => a.l.id === l.id), nc = x.temExt && x.naoConc.includes(l);
    return `<tr class="${al.length ? 'cf-row-al' : ''}"><td style="width:22px;text-align:center">${x.temExt ? (nc ? '<span class="warn" title="Não conciliado com o extrato">○</span>' : '<span class="pos" title="Conciliado com o extrato">✓</span>') : ''}</td>
      <td class="wrap">${esc(f?.nome || l.descricao || '—')}<div class="small muted">${esc(p ? `${p.codigo} ${p.nome}` : 'sem plano')}${f && l.descricao ? ` · ${esc(l.descricao)}` : ''}${l.documento ? ` · NF ${esc(l.documento)}` : ''}${l.conta_destino_id ? (l.destino ? ` · ⇄ vindo de ${esc(cad.contaById[l.conta_origem_id]?.nome || '')}` : ` · ⇄ para ${esc(cad.contaById[l.conta_destino_id]?.nome || '')}`) : ''}</div>
        ${al.map(a => `<div class="small cf-al-${a.t === 'dup' ? 'dup' : 'warn'}">${a.t === 'dup' ? '⧉' : '!'} ${esc(a.msg)}</div>`).join('')}</td>
      <td class="num ${cls(v)}">${money(v)}</td><td class="noprint" style="width:34px"><button class="btn ghost icon small" data-edit="${l.id}" title="Abrir o lançamento">✎</button></td></tr>`;
  };
  const linhaX = (i) => `<tr><td class="wrap">${esc(i.descricao || '—')}${i.documento ? `<div class="small muted">doc ${esc(i.documento)}</div>` : ''}</td>
    <td><span class="badge ${i.status === 'conciliado' ? 'pago' : i.status === 'ignorado' ? '' : 'vencido'}">${esc(i.status)}</span></td><td class="num ${cls(i.valor)}">${money(i.valor)}</td></tr>`;
  const v = x.v;
  $('#cfd', M.el).innerHTML = `
    <div class="kpis cf-dia-kpis">
      <div class="kpi"><div class="k-label">Saldo inicial</div><div class="k-value">${money(x.ini)}</div></div>
      <div class="kpi"><div class="k-label">Entradas</div><div class="k-value pos">${money(x.ent)}</div></div>
      <div class="kpi"><div class="k-label">Saídas</div><div class="k-value neg">${money(x.sai)}</div></div>
      <div class="kpi"><div class="k-label">Saldo final (sistema)</div><div class="k-value ${SEM_NEGATIVO.test(ct.tipo || '') && x.fim < -TOL ? 'neg' : ''}">${money(x.fim)}</div>${SEM_NEGATIVO.test(ct.tipo || '') ? '<div class="k-sub">caixa em espécie: não pode ficar negativo</div>' : ''}</div>
      ${x.banco != null || x.v?.saldo_informado != null ? `<div class="kpi"><div class="k-label">Saldo no banco</div><div class="k-value">${money(x.banco ?? +x.v.saldo_informado)}</div><div class="k-sub">${x.banco != null ? 'pelo extrato importado' : 'informado no visto'} · diferença <strong class="${Math.abs(x.difSaldo || 0) > TOL ? 'neg' : 'pos'}">${money(x.difSaldo || 0)}</strong></div></div>` : ''}
      ${x.temExt ? `<div class="kpi"><div class="k-label">Extrato do dia</div><div class="k-value">${money(x.extMov)}</div><div class="k-sub">diferença <strong class="${Math.abs(mov - x.extMov) > TOL ? 'neg' : 'pos'}">${money(mov - x.extMov)}</strong></div></div>` : ''}
    </div>
    <div class="cf-sit">${x.probs.map(p => `<div class="cf-msg ${v ? 'ok' : 'erro'}">${v ? '✔' : '✕'} ${esc(p.msg)}</div>`).join('')}
      ${x.naoConc.length ? `<div class="cf-msg ${v ? 'ok' : 'alerta'}">${v ? '✔' : '!'} ${x.naoConc.length} lançamento(s) sem conciliação com o extrato (${money(x.naoConc.reduce((s, l) => s + l.sinal, 0))}).</div>` : ''}
      ${(x.datas || []).map(t => `<div class="cf-msg ${v ? 'ok' : 'alerta'}">${v ? '✔' : '!'} ${esc(t)}</div>`).join('')}
      ${x.al.length ? `<div class="cf-msg ${v ? 'ok' : 'alerta'}">${v ? '✔' : '!'} ${x.al.length} aviso(s) nos lançamentos abaixo (marcados em amarelo).</div>` : ''}
      ${!x.probs.length && !x.al.length && !x.naoConc.length && !(x.datas || []).length ? `<div class="cf-msg ok">${x.temExt ? '✓ Movimento igual ao extrato e tudo conciliado.' : 'Falta extrato: importe o extrato (OFX ou relatório do ERP) ou confira com o extrato do banco / a contagem do caixa e informe o saldo real abaixo.'}</div>` : ''}
      ${v ? `<div class="cf-msg conf">✔ Visto de ${esc(v.conferido_email || 'usuário')} em ${new Date(v.conferido_em).toLocaleString('pt-BR')}${v.saldo_informado != null ? ` · saldo informado ${money(v.saldo_informado)}` : ''}${v.observacao ? ` · “${esc(v.observacao)}”` : ''}</div>` : x.travado ? `<div class="cf-msg conf">🔒 Conta travada até ${dateBR(D.linhas[M.r].trava?.ate)}: data, valor, conta e situação destes lançamentos não mudam mais.</div>` : ''}
    </div>
    <div class="conc-grid">
      <div class="card flush"><div class="card-head" style="padding:10px 12px 0"><h2>Lançamentos no sistema (${x.dl.length})</h2></div>
        <div class="table-wrap" style="max-height:46vh"><table><tbody>${x.dl.map(linhaL).join('') || '<tr><td class="muted">Nenhum lançamento pago nesta conta neste dia.</td></tr>'}</tbody></table></div></div>
      <div class="card flush"><div class="card-head" style="padding:10px 12px 0"><h2>${x.temExt ? `Extrato do banco (${x.dx.length})` : 'Resumo do dia por classificação'}</h2>${x.temExt ? `<a class="btn small noprint" href="#/conciliacao?conta=${ct.id}&mes=${D.mes}" data-close>Abrir na Conciliação</a>` : ''}</div>
        <div class="table-wrap" style="max-height:46vh"><table><tbody>${x.temExt ? (x.dx.map(linhaX).join('') || '<tr><td class="muted">Extrato importado, sem movimento neste dia.</td></tr>')
          : x.dl.length ? resumoDia(x) : '<tr><td class="muted">Nenhum extrato OFX importado para esta conta neste dia.</td></tr>'}</tbody></table></div></div>
    </div>
    <div class="cf-foot noprint">
      <div class="cf-nav"><button class="btn small" data-p="0,-1" title="Dia anterior (←)">‹ dia</button><button class="btn small" data-p="0,1" title="Próximo dia (→)">dia ›</button>
        <button class="btn small" data-p="-1,0" title="Conta de cima (↑)">↑ conta</button><button class="btn small" data-p="1,0" title="Conta de baixo (↓)">↓ conta</button></div>
      ${podeEditar() && D.vistosOk ? `<div class="cf-visto">
        ${semExt ? `<label>Saldo real do dia *<input id="cfsal" inputmode="decimal" placeholder="${money(x.fim)}" value="${v?.saldo_informado != null ? money(v.saldo_informado) : ''}"></label>` : ''}
        <label class="grow">Observação${x.probs.length || x.al.length || x.naoConc.length ? ' (obrigatória: explique a ressalva)' : ''}<input id="cfobs" value="${esc(v?.observacao || '')}" placeholder="${x.probs.length || x.al.length ? 'ex.: duplicidade verificada, são dois pedidos' : 'opcional'}"></label>
        ${v ? '<button class="btn small ghost" id="cfdes">Desfazer visto</button>' : ''}
        <button class="btn primary" id="cfvis">${v ? 'Atualizar visto' : 'Dia conferido ✔'}</button></div>`
        : !D.vistosOk ? '<span class="small muted">Rode o SQL da conferência para poder dar visto.</span>' : ''}
    </div>
    <p class="small muted noprint" style="margin:6px 0 0">Atalhos: ← → dias · ↑ ↓ contas · Enter dá o visto e vai para o próximo dia pendente.</p>`;
  $$('[data-p]', M.el).forEach(b => b.onclick = () => { const [a, c] = b.dataset.p.split(',').map(Number); passo(a, c); });
  $$('[data-edit]', M.el).forEach(b => b.onclick = () => editar(b.dataset.edit));
  $('#cfvis', M.el) && ($('#cfvis', M.el).onclick = () => darVisto(x));
  $('#cfdes', M.el) && ($('#cfdes', M.el).onclick = () => desfazer(x));
}

// conta sem extrato: o que entrou e o que saiu no dia, por classificação (ajuda a conferir com o extrato em papel)
function resumoDia(x) {
  const cad = state.cad, g = new Map();
  for (const l of x.dl) { const p = cad.planoById[l.plano_id]; const k = p ? `${p.codigo} ${p.nome}` : 'sem plano'; const v = l.sinal; const o = g.get(k) || { n: 0, v: 0 }; o.n++; o.v += v; g.set(k, o); }
  const rows = [...g.entries()].sort((a, b) => b[1].v - a[1].v);
  return `<tr><td colspan="3" class="small muted wrap">Sem extrato importado: resumo do dia por classificação para conferir com o extrato do banco. A soma abaixo é o movimento líquido do dia.</td></tr>
    ${rows.map(([k, o]) => `<tr><td class="wrap">${esc(k)}</td><td class="small muted">${o.n}×</td><td class="num ${cls(o.v)}">${money(o.v)}</td></tr>`).join('')}
    <tr class="row-total"><td>Movimento líquido do dia</td><td></td><td class="num ${cls(x.ent + x.sai)}">${money(x.ent + x.sai)}</td></tr>
    <tr><td colspan="3" class="small muted wrap">Saldo inicial ${money(x.ini)} → saldo final ${money(x.fim)}.</td></tr>`;
}

async function editar(id) {
  try {
    const l = await q(sb.from('lancamentos').select('*').eq('id', id).single());
    abrirLancamento(l, () => recarregarMantendo());
  } catch (e) { fail(e); }
}

// recarrega o mês e reabre o mesmo dia
async function recarregarMantendo() {
  const r = M?.r, d = M?.d;
  try { D = await montar(D.mes); } catch (e) { fail(e); return; }
  pintar();
  if (M && document.body.contains(M.el) && r != null) { M.r = Math.min(r, D.linhas.length - 1); M.d = d; pintarDia(); }
}

async function darVisto(x) {
  const obs = $('#cfobs', M.el)?.value.trim() || '';
  const problema = x.probs.length || x.al.length || x.naoConc.length || (x.datas || []).length;
  if (problema && !obs) { toast('Este dia tem pendência: explique na observação antes de dar o visto (ou corrija primeiro).', true); $('#cfobs', M.el)?.focus(); return; }
  const tSal = $('#cfsal', M.el)?.value.trim();
  if (!x.temExt && !tSal) { toast('Dia sem extrato: informe o saldo real do dia (extrato do banco ou contagem do caixa) para dar o visto.', true); $('#cfsal', M.el)?.focus(); return; }
  const sal = tSal ? parseNum(tSal) : null;
  if (tSal && (sal == null || isNaN(sal))) return toast('Saldo informado inválido', true);
  if (sal != null && Math.abs(sal - x.fim) > TOL && !confirm(`O saldo informado (${money(sal)}) é diferente do sistema (${money(x.fim)}): diferença de ${money(sal - x.fim)}.\n\nO ideal é lançar o que falta antes. Registrar o visto com essa diferença (fica vermelho até corrigir)?`)) return;
  const reg = { empresa_id: state.empresa.id, conta_id: x.ct.id, data: x.d, situacao: problema || (sal != null && Math.abs(sal - x.fim) > TOL) ? 'ressalva' : 'ok', saldo_sistema: x.fim, saldo_informado: sal, observacao: obs || null };
  try {
    await q(sb.from('conferencias_dia').upsert(reg, { onConflict: 'conta_id,data' }));
    toast(`${x.ct.nome} · ${dateBR(x.d)} conferido`);
    const prox = (() => { const p = proximoPendente(); return p; })();
    await recarregarMantendo();
    if (prox && M && document.body.contains(M.el)) { M.r = prox[0]; M.d = prox[1]; pintarDia(); }
  } catch (e) { fail(e); }
}

async function desfazer(x) {
  if (!x.v || !confirm(`Desfazer o visto de ${x.ct.nome} em ${dateBR(x.d)}?`)) return;
  try { await q(sb.from('conferencias_dia').delete().eq('id', x.v.id)); toast('Visto desfeito'); await recarregarMantendo(); } catch (e) { fail(e); }
}

async function vistoLote(cels) {
  if (!cels.length) return;
  if (!confirm(`Dar visto em ${cels.length} dia(s)-conta que batem com o extrato?\n\nSó entram os dias sem nenhuma diferença nem aviso. Fica registrado quem conferiu e quando; cada visto pode ser desfeito no detalhe do dia.`)) return;
  const rows = cels.map(x => ({ empresa_id: state.empresa.id, conta_id: x.ct.id, data: x.d, situacao: 'ok', saldo_sistema: x.fim, observacao: 'visto em lote: bate com o extrato' }));
  try { for (const ch of chunks(rows, 300)) await q(sb.from('conferencias_dia').upsert(ch, { onConflict: 'conta_id,data' })); toast(`${rows.length} dia(s) conferido(s)`); D = await montar(D.mes); pintar(); }
  catch (e) { fail(e); }
}
