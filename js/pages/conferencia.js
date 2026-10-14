// Conferência do dia: mapa do mês com uma linha por conta e uma coluna por dia. Cada quadradinho diz se o dia
// bate (sistema × extrato do banco, ou conta de passagem zerada), se tem problema (diferença, extrato pendente,
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
const ui = { mes: (() => { try { return localStorage.getItem(LS) || mesAnt(); } catch { return mesAnt(); } })(), soProb: false, todas: false };
let D = null;      // dados do mês carregado
let rootEl = null;

const TOL = 0.05;
const PASSAGEM = /^(fidc|conta escrow)$/i;          // contas que precisam terminar o dia zeradas
const SEM_NEGATIVO = /^caixa$/i;                    // dinheiro em espécie (caixinha / fundo de caixa): nunca pode ficar negativo
const TITULO_VENDA = /^\s*\d-\d{3,7}\/\d{1,3}\s*$/;  // "1-34912/1": parcela de NF de venda vinda do Iniflex
const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const cent = (v) => Math.round(+v * 100);
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const difDias = (a, b) => Math.round((Date.parse(a + 'T12:00:00') - Date.parse(b + 'T12:00:00')) / 864e5);
const fimMes = (m) => { const [a, mm] = m.split('-').map(Number); return new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10); };
const chunks = (arr, k = 150) => { const o = []; for (let i = 0; i < arr.length; i += k) o.push(arr.slice(i, i + k)); return o; };
const nomeMes = (m) => { const [a, mm] = m.split('-'); const n = MESES[+mm - 1]; return `${n.charAt(0)}${n.slice(1).toLowerCase()}/${a}`; };
const kfmt = (v) => { const a = Math.abs(v); const s = a >= 1e6 ? (a / 1e6).toFixed(1).replace('.', ',') + 'mi' : a >= 1e3 ? Math.round(a / 1e3) + 'k' : Math.round(a) + ''; return (v < 0 ? '−' : '+') + s; };

// ---------------------------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------------------------
export async function render(root) {
  rootEl = root;
  root.innerHTML = `
    <div class="card"><div class="card-head" style="margin-bottom:0">
      <div><h2 style="margin:0">Conferência do dia</h2>
        <p class="muted small" style="margin:4px 0 0">Cada quadradinho é uma conta num dia. Verde = bate; vermelho = diferença; amarelo = algo para olhar; cinza = sem extrato, confira à mão. Clique para abrir o dia, conferir e dar o visto.</p></div>
      <div class="toolbar noprint" style="margin:0" id="cflt">
        <label>Mês<input type="month" name="mes" value="${ui.mes}"></label>
        <label class="chk"><input type="checkbox" name="soProb" ${ui.soProb ? 'checked' : ''}> só com problema</label>
        <label class="chk"><input type="checkbox" name="todas" ${ui.todas ? 'checked' : ''}> todas as contas</label>
        <button class="btn" id="cimp" type="button">Imprimir / PDF</button>
      </div></div></div>
    <div id="ccorpo"><div class="loading">Conferindo o mês…</div></div>`;
  $('#cflt', root).addEventListener('change', (e) => {
    const t = e.target; if (!t.name) return;
    if (t.name === 'mes') { if (!t.value) return; ui.mes = t.value; try { localStorage.setItem(LS, ui.mes); } catch {} carregar(); }
    else { ui[t.name] = t.checked; pintar(); }
  });
  $('#cimp', root).onclick = () => window.print();
  await carregar();
}

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
    q(sb.from('extrato_importacoes').select('conta_id,dt_inicio,dt_fim').eq('empresa_id', e)),
    q(sb.from('contas_travas').select('conta_id,ate,saldo_banco').eq('empresa_id', e).eq('ativo', true)).catch(() => []),
    q(sb.from('conferencias_dia').select('*').eq('empresa_id', e).gte('data', ini).lte('data', fim)).catch(() => null), // null = tabela ainda não instalada
  ]);
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
  const ativas = cad.contas.filter(ct => ct.ativo !== false);
  const linhas = [];
  for (const ct of ativas) {
    const ls = porConta.get(ct.id) || [], xs = extConta.get(ct.id) || [];
    const s0 = saldoAnt.get(ct.id) ?? +ct.saldo_inicial ?? 0;
    const passagem = PASSAGEM.test(ct.tipo || ''), semNeg = SEM_NEGATIVO.test(ct.tipo || ''), trava = trv.get(ct.id) || null;
    let saldo = s0; const cel = [];
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
      if (passagem && ativo && Math.abs(saldo) > TOL) probs.push({ t: 'pass', msg: `Conta de passagem terminou o dia com saldo ${money(saldo)} (deveria zerar).` });
      if (temExt && Math.abs((ent + sai) - extMov) > TOL) probs.push({ t: 'dif', msg: `Movimento do sistema (${money(ent + sai)}) diferente do extrato (${money(extMov)}): diferença ${money(ent + sai - extMov)}.` });
      if (pend.length) probs.push({ t: 'pend', msg: `${pend.length} linha(s) do extrato sem lançamento conciliado (${money(pend.reduce((s, x) => s + +x.valor, 0))}).` });
      if (v?.saldo_informado != null && Math.abs(+v.saldo_informado - saldo) > TOL) probs.push({ t: 'inf', msg: `Saldo informado no visto (${money(v.saldo_informado)}) diferente do sistema (${money(saldo)}).` });
      let st;
      if (!ativo && !probs.length) st = 'vazio';
      else if (probs.length) st = 'erro';
      else if (al.length || naoConc.length) st = 'alerta';
      else if (passagem || temExt) st = 'ok';
      else st = 'semext';
      const conferido = !!v || (travado && (st === 'ok' || st === 'semext'));
      cel.push({ d, ct, dl, dx, ent, sai, ini: ini_, fim: saldo, temExt, extMov, pend, naoConc, al, probs, st, v, travado, conferido, passagem });
    }
    const usada = ls.length || xs.length || Math.abs(s0) > TOL || Math.abs(saldo) > TOL;
    linhas.push({ ct, cel, s0, sFim: saldo, passagem, trava, usada });
  }
  linhas.sort((a, b) => (b.usada - a.usada) || String(a.ct.codigo || '').localeCompare(String(b.ct.codigo || ''), 'pt', { numeric: true }) || a.ct.nome.localeCompare(b.ct.nome));
  return { mes, ini, fim, dias, linhas, semConta, vistosOk: vistos !== null };
}

// ---------------------------------------------------------------------------------------------
// Mapa do mês
// ---------------------------------------------------------------------------------------------
const ICONE = { erro: '✕', alerta: '!', ok: '✓', semext: '?', vazio: '' };
const DESC = { erro: 'diferença / pendência', alerta: 'algo para olhar', ok: 'bate', semext: 'sem extrato: conferir à mão', vazio: 'sem movimento' };

function pintar() {
  const c = $('#ccorpo', rootEl); if (!c || !D) return;
  const linhas = D.linhas.filter(r => ui.todas || r.usada).filter(r => !ui.soProb || r.cel.some(x => x.st === 'erro' || x.st === 'alerta'));
  const cels = D.linhas.flatMap(r => r.cel).filter(x => x.st !== 'vazio');
  const conf = cels.filter(x => x.conferido).length, erro = cels.filter(x => x.st === 'erro' && !x.v).length, alerta = cels.filter(x => x.st === 'alerta' && !x.v).length;
  const prontos = cels.filter(x => x.st === 'ok' && !x.conferido);
  const pct = cels.length ? Math.round(conf / cels.length * 100) : 100;
  c.innerHTML = `
    ${D.vistosOk ? '' : '<div class="card" style="border-color:var(--warn)"><strong>Falta instalar o visto no banco de dados.</strong> <span class="small">A conferência funciona, mas o botão “Dia conferido” só grava depois de rodar o SQL <code>20261013000028_conferencia_dia.sql</code>.</span></div>'}
    <div class="kpis">
      <div class="kpi"><div class="k-label">Conferência de ${esc(nomeMes(D.mes))}</div><div class="k-value ${pct === 100 ? 'pos' : ''}">${pct}%</div>
        <div class="k-sub">${conf} de ${cels.length} dias-conta conferidos</div><div class="cf-prog"><span style="width:${pct}%"></span></div></div>
      <div class="kpi"><div class="k-label">Com diferença</div><div class="k-value ${erro ? 'neg' : ''}">${erro}</div><div class="k-sub">extrato, passagem ou saldo não batem</div></div>
      <div class="kpi"><div class="k-label">Para olhar</div><div class="k-value ${alerta ? 'warn' : ''}">${alerta}</div><div class="k-sub">duplicidade, classificação, transferência</div></div>
      <div class="kpi"><div class="k-label">Pagos sem conta no mês</div><div class="k-value ${D.semConta.length ? 'neg' : ''}">${D.semConta.length}</div><div class="k-sub">${D.semConta.length ? `${money0(D.semConta.reduce((s, l) => s + +l.valor, 0))} fora do saldo das contas` : 'nenhum'}</div></div>
    </div>
    <div class="card flush">
      <div class="cf-head noprint"><div class="cf-leg">${['ok', 'erro', 'alerta', 'semext'].map(s => `<span><i class="cf-c ${s}">${ICONE[s]}</i>${DESC[s]}</span>`).join('')}<span><i class="cf-c ok conf">✔</i>conferido</span><span><i class="cf-c ok trav">✔</i>travado</span></div>
        ${podeEditar() && D.vistosOk && prontos.length ? `<button class="btn small primary" id="cflote">Dar visto nos ${prontos.length} dia(s) que batem</button>` : ''}</div>
      <div class="table-wrap cf-wrap"><table class="cf-grid"><thead><tr><th class="cf-conta">Conta</th>
        ${D.dias.map(d => { const w = new Date(d + 'T12:00:00').getDay(); return `<th class="${w === 0 || w === 6 ? 'fds' : ''}">${+d.slice(8)}<div>${SEM[w].charAt(0).toUpperCase()}</div></th>`; }).join('')}
        <th class="num">Saldo ${dateBR(D.fim).slice(0, 5)}</th></tr></thead><tbody>
      ${linhas.map((r, ri) => `<tr><td class="cf-conta"><strong>${esc(r.ct.nome)}</strong><div class="small muted">${esc(r.ct.tipo || '')}${r.passagem ? ' · passagem' : ''}${SEM_NEGATIVO.test(r.ct.tipo || '') ? ' · não pode ficar negativo' : ''}${r.trava ? ` · 🔒 ${dateBR(r.trava.ate)}` : ''}</div></td>
        ${r.cel.map((x, di) => celula(x, ri, di)).join('')}
        <td class="num ${(r.passagem && Math.abs(r.sFim) > TOL) || (SEM_NEGATIVO.test(r.ct.tipo || '') && r.sFim < -TOL) ? 'neg' : cls(r.sFim)}">${money(r.sFim)}</td></tr>`).join('') || `<tr><td colspan="${D.dias.length + 2}" class="muted">${ui.soProb ? 'Nenhuma conta com problema no mês. 🎉' : 'Nenhuma conta com movimento no mês.'}</td></tr>`}
      </tbody></table></div>
      <p class="small muted" style="padding:0 12px 10px">Bate = movimento do dia no sistema igual ao extrato importado, sem linha pendente (contas com OFX), ou saldo zerado no fim do dia (contas de passagem: FIDC e escrow). Contas sem extrato ficam cinza até você conferir e dar o visto, de preferência informando o saldo real do dia. Dias até a data da trava já contam como conferidos quando batem. Caixa em espécie (tipo Caixa) fica vermelho em todo dia em que terminar negativo.</p>
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
  const k = x.conferido ? (ressalva ? 'alerta conf' : `ok ${x.v ? 'conf' : 'trav'}`) : x.st;
  const txt = x.conferido ? '✔' : x.st === 'erro' ? (x.probs.find(p => p.t === 'dif' || p.t === 'pass' || p.t === 'neg') ? kfmt(x.probs.find(p => p.t === 'pass' || p.t === 'neg') ? x.fim : (x.ent + x.sai - x.extMov)) : '✕') : ICONE[x.st];
  const tip = [`${x.ct.nome} · ${SEM[w]} ${dateBR(x.d)}`, `${x.dl.length} lançamento(s): entradas ${money(x.ent)} · saídas ${money(x.sai)} · saldo ${money(x.fim)}`,
    x.temExt ? `extrato: ${x.dx.length} linha(s), movimento ${money(x.extMov)}` : x.passagem ? 'conta de passagem: deve zerar' : 'sem extrato importado',
    ...x.probs.map(p => '✕ ' + p.msg), ...[...new Set(x.al.map(a => '! ' + a.msg))].slice(0, 3), x.naoConc.length ? `! ${x.naoConc.length} lançamento(s) não conciliados com o extrato` : '',
    x.v ? `✔ visto de ${x.v.conferido_email || 'usuário'} em ${new Date(x.v.conferido_em).toLocaleString('pt-BR')}` : x.travado ? '🔒 conta travada até ' + dateBR(x.ct && D.linhas.find(r => r.ct.id === x.ct.id)?.trava?.ate) : ''].filter(Boolean).join('\n');
  return `<td class="cf-td ${fds ? 'fds' : ''}" data-r="${ri}" data-d="${di}" tabindex="0" title="${esc(tip)}"><i class="cf-c ${k}">${txt}</i></td>`;
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
  const mov = x.ent + x.sai, semExt = !x.temExt && !x.passagem;
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
      <div class="kpi"><div class="k-label">Saldo final (sistema)</div><div class="k-value ${x.passagem && Math.abs(x.fim) > TOL ? 'neg' : ''}">${money(x.fim)}</div>${x.passagem ? '<div class="k-sub">conta de passagem: deve ser 0,00</div>' : ''}</div>
      ${x.temExt ? `<div class="kpi"><div class="k-label">Extrato do dia</div><div class="k-value">${money(x.extMov)}</div><div class="k-sub">diferença <strong class="${Math.abs(mov - x.extMov) > TOL ? 'neg' : 'pos'}">${money(mov - x.extMov)}</strong></div></div>` : ''}
    </div>
    <div class="cf-sit">${x.probs.map(p => `<div class="cf-msg erro">✕ ${esc(p.msg)}</div>`).join('')}
      ${x.naoConc.length ? `<div class="cf-msg alerta">! ${x.naoConc.length} lançamento(s) sem conciliação com o extrato (${money(x.naoConc.reduce((s, l) => s + l.sinal, 0))}).</div>` : ''}
      ${x.al.length ? `<div class="cf-msg alerta">! ${x.al.length} aviso(s) nos lançamentos abaixo (marcados em amarelo).</div>` : ''}
      ${!x.probs.length && !x.al.length && !x.naoConc.length ? `<div class="cf-msg ok">${x.passagem ? '✓ Conta de passagem zerada no fim do dia.' : x.temExt ? '✓ Movimento igual ao extrato e tudo conciliado.' : 'Conta sem extrato importado: confira com o extrato do banco (ou a contagem do caixa) e informe o saldo real abaixo.'}</div>` : ''}
      ${v ? `<div class="cf-msg conf">✔ Visto de ${esc(v.conferido_email || 'usuário')} em ${new Date(v.conferido_em).toLocaleString('pt-BR')}${v.saldo_informado != null ? ` · saldo informado ${money(v.saldo_informado)}` : ''}${v.observacao ? ` · “${esc(v.observacao)}”` : ''}</div>` : x.travado ? `<div class="cf-msg conf">🔒 Conta travada até ${dateBR(D.linhas[M.r].trava?.ate)}: data, valor, conta e situação destes lançamentos não mudam mais.</div>` : ''}
    </div>
    <div class="conc-grid">
      <div class="card flush"><div class="card-head" style="padding:10px 12px 0"><h2>Lançamentos no sistema (${x.dl.length})</h2></div>
        <div class="table-wrap" style="max-height:46vh"><table><tbody>${x.dl.map(linhaL).join('') || '<tr><td class="muted">Nenhum lançamento pago nesta conta neste dia.</td></tr>'}</tbody></table></div></div>
      <div class="card flush"><div class="card-head" style="padding:10px 12px 0"><h2>${x.temExt ? `Extrato do banco (${x.dx.length})` : x.passagem ? 'Resumo do dia por classificação' : 'Extrato do banco'}</h2>${x.temExt ? `<a class="btn small noprint" href="#/conciliacao?conta=${ct.id}&mes=${D.mes}" data-close>Abrir na Conciliação</a>` : ''}</div>
        <div class="table-wrap" style="max-height:46vh"><table><tbody>${x.temExt ? (x.dx.map(linhaX).join('') || '<tr><td class="muted">Extrato importado, sem movimento neste dia.</td></tr>')
          : x.passagem ? resumoPassagem(x) : '<tr><td class="muted">Nenhum extrato OFX importado para esta conta neste dia.</td></tr>'}</tbody></table></div></div>
    </div>
    <div class="cf-foot noprint">
      <div class="cf-nav"><button class="btn small" data-p="0,-1" title="Dia anterior (←)">‹ dia</button><button class="btn small" data-p="0,1" title="Próximo dia (→)">dia ›</button>
        <button class="btn small" data-p="-1,0" title="Conta de cima (↑)">↑ conta</button><button class="btn small" data-p="1,0" title="Conta de baixo (↓)">↓ conta</button></div>
      ${podeEditar() && D.vistosOk ? `<div class="cf-visto">
        ${semExt ? `<label>Saldo real do dia<input id="cfsal" inputmode="decimal" placeholder="${money(x.fim)}" value="${v?.saldo_informado != null ? money(v.saldo_informado) : ''}"></label>` : ''}
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

// conta de passagem: o que entrou e o que saiu, por classificação — mostra de onde vem a sobra
function resumoPassagem(x) {
  const cad = state.cad, g = new Map();
  for (const l of x.dl) { const p = cad.planoById[l.plano_id]; const k = p ? `${p.codigo} ${p.nome}` : 'sem plano'; const v = l.sinal; const o = g.get(k) || { n: 0, v: 0 }; o.n++; o.v += v; g.set(k, o); }
  const rows = [...g.entries()].sort((a, b) => b[1].v - a[1].v);
  return `<tr><td colspan="3" class="small muted wrap">Conta de passagem (FIDC / escrow): tudo o que entra no dia precisa sair no mesmo dia (repasse, juros, tarifas, recompra). A soma abaixo é o que sobrou.</td></tr>
    ${rows.map(([k, o]) => `<tr><td class="wrap">${esc(k)}</td><td class="small muted">${o.n}×</td><td class="num ${cls(o.v)}">${money(o.v)}</td></tr>`).join('')}
    <tr class="row-total"><td>Sobra no fim do dia</td><td></td><td class="num ${Math.abs(x.fim - x.ini) > TOL ? 'neg' : 'pos'}">${money(x.ent + x.sai)}</td></tr>
    ${Math.abs(x.ini) > TOL ? `<tr><td colspan="3" class="small neg wrap">O dia já começou com ${money(x.ini)} parado na conta, vindo de dia anterior.</td></tr>` : ''}`;
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
  const problema = x.probs.length || x.al.length || x.naoConc.length;
  if (problema && !obs) { toast('Este dia tem pendência: explique na observação antes de dar o visto (ou corrija primeiro).', true); $('#cfobs', M.el)?.focus(); return; }
  const tSal = $('#cfsal', M.el)?.value.trim();
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
  if (!confirm(`Dar visto em ${cels.length} dia(s)-conta que batem com o extrato ou com a conta de passagem zerada?\n\nSó entram os dias sem nenhuma diferença nem aviso. Fica registrado quem conferiu e quando; cada visto pode ser desfeito no detalhe do dia.`)) return;
  const rows = cels.map(x => ({ empresa_id: state.empresa.id, conta_id: x.ct.id, data: x.d, situacao: 'ok', saldo_sistema: x.fim, observacao: 'visto em lote: bate com o extrato / passagem zerada' }));
  try { for (const ch of chunks(rows, 300)) await q(sb.from('conferencias_dia').upsert(ch, { onConflict: 'conta_id,data' })); toast(`${rows.length} dia(s) conferido(s)`); D = await montar(D.mes); pintar(); }
  catch (e) { fail(e); }
}
