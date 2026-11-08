// Fechamento do mês: checklist com status automático de cada etapa (extratos conciliados, lançamentos sem conta,
// em aberto vencidos, notas sem financeiro, borderôs pendentes, desvios do orçamento) e resumo do mês para a direção.
// Só lê dados — nada aqui altera lançamentos.
import { sb, state, q, fetchAll, loadCadastros, montarMatriz, comRecompras, montarDRE, isAdmin, pontas } from '../lib/data.js';
import { $, $$, esc, money, money0, pct, dateBR, fail, toast, modal, parseNum, MESES } from '../lib/ui.js';
import { revisarSemConta } from '../lib/sem-conta.js';
import { usosPorNota } from '../lib/creditos.js';
import * as F from '../lib/fechamento-calc.js';

export const title = 'Fechamento do Mês';

const mesAnt = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const ui = { mes: mesAnt() };
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const gestor = () => ['admin', 'diretor', 'financeiro'].includes(state.papel);
const fimMes = (m) => { const [a, mm] = m.split('-').map(Number); return new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10); };
const TOL_PCT = 10, TOL_VAL = 5000; // mesma tolerância padrão do Controle orçamentário

export async function render(root) {
  const qm = new URLSearchParams(location.hash.split('?')[1] || '').get('mes'); if (/^\d{4}-\d{2}$/.test(qm || '')) ui.mes = qm;
  root.innerHTML = `
    <div class="card"><div class="card-head" style="margin-bottom:0">
      <div><h2 style="margin:0">Fechamento do Mês</h2><p class="muted small" style="margin:4px 0 0">Cada etapa é conferida automaticamente com os dados do sistema. Verde = pronto; vermelho = falta resolver (o link leva à tela certa).</p></div>
      <div class="toolbar" style="margin:0"><label>Mês<input type="month" id="mes" value="${ui.mes}"></label><button class="btn" id="imp">Imprimir / PDF</button></div>
    </div></div>
    <div id="corpo"><div class="loading">Conferindo o mês…</div></div>`;
  $('#mes', root).onchange = (e) => { if (e.target.value) { ui.mes = e.target.value; carregar(root); } };
  $('#imp', root).onclick = () => window.print();
  await carregar(root);
}

async function carregar(root) {
  const c = $('#corpo', root); c.innerHTML = '<div class="loading">Conferindo o mês…</div>';
  let R;
  try { R = await conferir(ui.mes); } catch (e) { fail(e); c.innerHTML = '<div class="card"><div class="empty">Não foi possível conferir o mês.</div></div>'; return; }
  pintar(c, R);
  try { await checklist(c, R, root); } catch (e) { console.error(e); }
  const rv = $('[data-rev]', c); if (rv) rv.onclick = () => revisarSemConta(() => carregar(root));
  $$('[data-travar]', c).forEach(b => b.onclick = () => fecharConta(R, b.dataset.travar, root));
  $$('[data-destravar]', c).forEach(b => b.onclick = () => destravar(R, b.dataset.destravar, root));
  $$('[data-fechar]', c).forEach(b => b.onclick = () => fecharConta(R, b.dataset.fechar, root));
}

async function conferir(mes) {
  await loadCadastros();
  const e = state.empresa.id, ini = `${mes}-01`, fim = fimMes(mes), ano = +mes.slice(0, 4), m = +mes.slice(5, 7);
  const cad = state.cad;
  const [ext, imps, semConta, abertos, notas, props, mov, orc, just, saldos, matriz, movMes, travas] = await Promise.all([
    fetchAll(() => sb.from('extrato_itens').select('id,conta_id,status,valor').eq('empresa_id', e).gte('data', ini).lte('data', fim).order('id')),
    q(sb.from('extrato_importacoes').select('conta_id,dt_fim').eq('empresa_id', e)),
    fetchAll(() => sb.from('lancamentos').select('id,data,valor').eq('empresa_id', e).eq('status', 'Pago').is('conta_id', null).lte('data', fim).order('id')),
    fetchAll(() => sb.from('v_lancamentos').select('id,data,valor_sinal,tipo').eq('empresa_id', e).eq('status', 'Em aberto').lte('data', fim).order('id')),
    fetchAll(() => sb.from('nfe_notas').select('id,numero,situacao,finalidade,v_nf,eventos,p:nfe_parcelas(id),v:nfe_vinculos(id),f:nfe_fidc_vinculos(id)').eq('empresa_id', e).eq('tipo', 'saida').gte('emissao', ini).lte('emissao', fim).order('numero')).catch(() => null),
    q(sb.from('fidc_propostas').select('id,numero,status,data_operacao,valor_face').eq('empresa_id', e).eq('status', 'Pendente').gte('data_operacao', ini).lte('data_operacao', fim)).catch(() => []),
    q(sb.rpc('orcamento_movimento', { p_empresa: e, p_ano: ano })).catch(() => null),
    fetchAll(() => sb.from('orcamentos').select('plano_id,mes,valor,cenario').eq('empresa_id', e).eq('ano', ano).in('cenario', ['budget', 'forecast']).eq('mes', m).order('plano_id')).catch(() => []),
    q(sb.from('orcamento_justificativas').select('plano_id,mes,origem').eq('empresa_id', e).eq('ano', ano).eq('mes', m)).catch(() => []),
    q(sb.rpc('saldos_contas', { p_empresa: e, p_ate: fim })),
    // sem os filtros globais da barra (conta, grupo…): o fechamento é sempre da empresa toda
    q(sb.rpc('resumo_mensal', { p_empresa: e, p_ano: ano, p_status: ['Pago'], p_conta: null, p_grupo: null, p_cc: null, p_favorecido: null, p_disp: null })).then(rows => comRecompras(montarMatriz(rows.map(r => ({ plano_id: r.plano_id, mes: r.mes, total: +r.total }))), ano, null, { p_status: ['Pago'], p_conta: null, p_grupo: null, p_cc: null, p_favorecido: null, p_disp: null })),
    fetchAll(() => sb.from('lancamentos').select('id,conta_id,conta_destino_id,valor,plano_id').eq('empresa_id', e).eq('status', 'Pago').not('conta_id', 'is', null).gte('data', ini).lte('data', fim).order('id')),
    q(sb.from('contas_travas').select('*').eq('empresa_id', e).eq('ativo', true)).catch(() => null), // null = trava ainda não instalada no banco
  ]);
  // tolerância dos desvios: Parâmetros do orçamento (SQL 108); sem eles, o padrão 10% ou R$ 5.000
  const ocfg = await q(sb.from('orcamento_config').select('tol_pct,tol_valor,base_comparacao,exigir_justificativa').eq('empresa_id', e).maybeSingle()).catch(() => null);
  const tolPct = ocfg ? +ocfg.tol_pct : TOL_PCT, tolVal = ocfg ? +ocfg.tol_valor : TOL_VAL, baseOrc = ocfg?.base_comparacao || 'budget';

  const etapas = [];
  // 1) Extratos: contas com OFX (as que têm extrato importado) — todos os movimentos do mês conciliados ou ignorados
  const ultOfx = new Map(); for (const i of imps) if (!ultOfx.has(i.conta_id) || i.dt_fim > ultOfx.get(i.conta_id)) ultOfx.set(i.conta_id, i.dt_fim);
  const contasOfx = [...ultOfx.keys()].map(id => cad.contaById[id]).filter(Boolean);
  const linhasExt = contasOfx.map(ct => {
    const it = ext.filter(x => x.conta_id === ct.id), pend = it.filter(x => x.status === 'pendente');
    const cobre = (ultOfx.get(ct.id) || '') >= fim;
    return { ct, total: it.length, pend: pend.length, vPend: pend.reduce((s, x) => s + Math.abs(+x.valor), 0), cobre, ok: cobre && !pend.length };
  });
  etapas.push({ k: 'ext', titulo: 'Extratos bancários conciliados', ok: linhasExt.length > 0 && linhasExt.every(l => l.ok), link: '#/conciliacao', acao: 'Abrir Conciliação',
    resumo: !linhasExt.length ? 'Nenhuma conta com extrato importado.' : linhasExt.map(l => `${esc(l.ct.nome)}: ${!l.cobre ? `extrato só até ${dateBR(ultOfx.get(l.ct.id))}` : l.pend ? `<strong>${l.pend} de ${l.total} movimentos pendentes</strong> (${money0(l.vPend)})` : `${l.total} movimentos, todos conciliados`}`).join('<br>') });

  // 2) Lançamentos pagos sem conta bancária (ficam fora dos relatórios)
  const scMes = semConta.filter(l => l.data >= ini), scAnt = semConta.filter(l => l.data < ini);
  const sV = (a) => a.reduce((s, l) => s + +l.valor, 0);
  etapas.push({ k: 'semconta', titulo: 'Lançamentos pagos com conta bancária', ok: !semConta.length, link: '#/lancamentos', acao: 'Abrir Lançamentos (filtro Conta: sem conta)',
    resumo: !semConta.length ? 'Todos os lançamentos pagos têm conta.' : `${scMes.length ? `<strong>${scMes.length} no mês</strong> (${money0(sV(scMes))})` : 'Nenhum no mês'}${scAnt.length ? ` · ${scAnt.length} de meses anteriores (${money0(sV(scAnt))})` : ''} — sem conta, ficam fora do fluxo de caixa e da DRE.` });

  // 3) Em aberto com data até o fim do mês (a receber / a pagar que deveriam ter sido baixados ou reprogramados)
  const rec = abertos.filter(a => a.tipo === 'E'), pag = abertos.filter(a => a.tipo === 'S');
  const aV = (a) => a.reduce((s, x) => s + Math.abs(+x.valor_sinal), 0);
  etapas.push({ k: 'abertos', titulo: `Nada em aberto vencido até ${dateBR(fim)}`, ok: !abertos.length, link: '#/abertos', acao: 'Abrir Contas a pagar / receber',
    resumo: !abertos.length ? 'Nenhum título vencido em aberto.' : `A receber: <strong>${rec.length}</strong> (${money0(aV(rec))}) · A pagar: <strong>${pag.length}</strong> (${money0(aV(pag))}). Baixe o que foi pago/recebido ou mude a data do que ficou para depois.` });

  // 4) Notas de venda do mês com financeiro (recebimento, título ou borderô ligado)
  if (notas) {
    const vendas = notas.filter(n => n.situacao === 'autorizada' && n.finalidade === '1' && n.p?.length && !(n.eventos || []).some(x => x.tipo === 'devolucao_total'));
    const usos = await usosPorNota(vendas.map(n => n.id));
    const sem = vendas.filter(n => !n.v?.length && !n.f?.length && !usos.has(n.id));
    const canc = notas.filter(n => n.situacao === 'cancelada').length;
    etapas.push({ k: 'notas', titulo: 'Notas de venda do mês ligadas ao financeiro', ok: !sem.length, link: '#/notas', acao: 'Abrir Notas Fiscais',
      resumo: `${vendas.length} notas de venda (${money0(vendas.reduce((s, n) => s + +n.v_nf, 0))})${sem.length ? ` · <strong>${sem.length} sem recebimento nem título</strong>: ${sem.slice(0, 12).map(n => n.numero).join(', ')}${sem.length > 12 ? '…' : ''}` : ', todas ligadas'}${canc ? ` · ${canc} cancelada(s)` : ''}.` });
  }

  // 5) Borderôs do mês decididos
  etapas.push({ k: 'bord', titulo: 'Borderôs FIDC do mês aprovados', ok: !props.length, link: '#/fidc-propostas', acao: 'Abrir Propostas de borderô',
    resumo: !props.length ? 'Nenhuma proposta pendente com operação no mês.' : `<strong>${props.length} proposta(s) pendente(s)</strong>: ${props.map(p => `nº ${p.numero} (${dateBR(p.data_operacao)}, ${money0(p.valor_face)})`).join(', ')}.` });

  // 6) Desvios do orçamento no mês justificados (mesma regra padrão do Controle orçamentário: 10% ou R$ 5.000)
  if (mov) {
    const real = new Map(); for (const r of mov) if (r.status === 'Pago' && r.mes === m) real.set(r.plano_id, (real.get(r.plano_id) || 0) + +r.total);
    const orcM = new Map(); for (const o of orc.filter(o => (o.cenario || 'budget') === baseOrc)) orcM.set(o.plano_id, (orcM.get(o.plano_id) || 0) + +o.valor);
    const justif = new Set(just.map(j => j.plano_id));
    const desv = [];
    for (const pid of new Set([...real.keys(), ...orcM.keys()])) {
      const p = cad.planoById[pid]; if (!p || p.nivel !== 2 || !'ES'.includes(p.tipo)) continue;
      const r = real.get(pid) || 0, o = orcM.get(pid) || 0, dv = p.tipo === 'S' ? r - o : o - r;
      if (dv > Math.max(tolVal, tolPct / 100 * Math.abs(o))) desv.push({ p, dv, j: justif.has(pid) });
    }
    const falta = desv.filter(d => !d.j).sort((a, b) => b.dv - a.dv);
    etapas.push({ k: 'orc', titulo: 'Desvios do orçamento justificados', ok: !falta.length || ocfg?.exigir_justificativa === false, link: '#/controle-orcamento', acao: 'Abrir Controle orçamentário',
      resumo: !desv.length ? `Nenhuma conta fora da tolerância (${tolPct}% ou ${money0(tolVal)}, comparado com o ${baseOrc}) no mês.` : `${desv.length} conta(s) fora da tolerância${falta.length ? `, <strong>${falta.length} sem justificativa</strong>: ${falta.slice(0, 6).map(d => `${esc(d.p.codigo)} ${esc(d.p.nome)} (${money0(d.dv)})`).join('; ')}${falta.length > 6 ? '…' : ''}` : ', todas justificadas'}.`,
      obs: 'Usa os lançamentos pagos do mês: o resultado muda conforme a conciliação avança.' });
  }

  // Resumo do mês (realizado)
  const { val } = montarDRE(matriz);
  const i = m - 1, recB = val.receita_bruta[i];
  const disp = saldos.filter(s => s.disponibilidade === 'Conta com recursos disponíveis');
  const resumo = { recB, ebitda: val.ebitda[i], resultado: val.resultado[i], ent: matriz.tipo.E[i], sai: matriz.tipo.S[i], saldo: disp.reduce((s, x) => s + +x.saldo_pago, 0), saldos: disp.filter(x => Math.abs(+x.saldo_pago) > 0.005) };
  // Contas: movimento do mês no extrato × no sistema, pendências, saldo e trava
  const movSis = new Map();
  for (const l of pontas(movMes)) movSis.set(l.conta_id, (movSis.get(l.conta_id) || 0) + l.sinal);   // transferência única: origem e destino
  const movExt = new Map(), pendExt = new Map(), qtdExt = new Map();
  for (const x of ext) { movExt.set(x.conta_id, (movExt.get(x.conta_id) || 0) + +x.valor); qtdExt.set(x.conta_id, (qtdExt.get(x.conta_id) || 0) + 1); if (x.status === 'pendente') pendExt.set(x.conta_id, (pendExt.get(x.conta_id) || 0) + 1); }
  const trv = new Map((travas || []).map(t => [t.conta_id, t]));
  const ids = new Set([...movSis.keys(), ...ultOfx.keys(), ...trv.keys(), ...saldos.filter(x => Math.abs(+x.saldo_pago) > 0.005).map(x => x.conta_id)]);
  const contas = [...ids].map(id => {
    const ct = cad.contaById[id]; if (!ct) return null;
    const temExt = ultOfx.has(id), cobre = (ultOfx.get(id) || '') >= fim, pend = pendExt.get(id) || 0;
    const mS = movSis.get(id) || 0, mE = movExt.get(id) || 0, dif = mS - mE;
    const bate = temExt && cobre && !pend && Math.abs(dif) <= 0.05;
    const sal = saldos.find(x => x.conta_id === id);
    return { ct, temExt, cobre, ultExt: ultOfx.get(id), pend, qtd: qtdExt.get(id) || 0, mS, mE, dif, bate, saldo: sal ? +sal.saldo_pago : null, trava: trv.get(id) || null };
  }).filter(Boolean).sort((a, b) => (b.temExt - a.temExt) || a.ct.nome.localeCompare(b.ct.nome));
  if (travas !== null) {
    const comExt = contas.filter(x => x.temExt), falta = comExt.filter(x => !x.trava || x.trava.ate < fim);
    etapas.push({ k: 'contas', titulo: `Contas com extrato travadas até ${dateBR(fim)}`, ok: comExt.length > 0 && !falta.length, link: '#/fechamento', acao: 'Ver as contas abaixo',
      resumo: !comExt.length ? 'Nenhuma conta com extrato importado.' : !falta.length ? `As ${comExt.length} conta(s) com extrato estão travadas até o fim do mês.` : `<strong>${falta.length} de ${comExt.length} sem trava até o fim do mês</strong>: ${falta.map(x => esc(x.ct.nome)).join(', ')}.` });
  }
  return { mes, ini, fim, etapas, resumo, contas, travaInstalada: travas !== null };
}

function pintar(c, R) {
  const ok = R.etapas.filter(x => x.ok).length, tot = R.etapas.length, [a, mm] = R.mes.split('-');
  const nomeMes = `${MESES[+mm - 1].charAt(0)}${MESES[+mm - 1].slice(1).toLowerCase()}/${a}`;
  const S = R.resumo;
  c.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="k-label">Conferências automáticas de ${esc(nomeMes)}</div><div class="k-value ${ok === tot ? 'pos' : ''}">${ok} de ${tot}</div><div class="k-sub">${ok === tot ? 'mês pronto para fechar' : `${tot - ok} etapa(s) pendente(s)`}</div></div>
      <div class="kpi"><div class="k-label">Receita bruta (realizado)</div><div class="k-value">${money0(S.recB)}</div><div class="k-sub">entradas ${money0(S.ent)} · saídas ${money0(Math.abs(S.sai))}</div></div>
      <div class="kpi"><div class="k-label">EBITDA gerencial</div><div class="k-value ${S.ebitda < 0 ? 'neg' : ''}">${money0(S.ebitda)}</div><div class="k-sub">margem ${pct(S.recB ? S.ebitda / S.recB : null)}</div></div>
      <div class="kpi"><div class="k-label">Resultado gerencial</div><div class="k-value ${S.resultado < 0 ? 'neg' : ''}">${money0(S.resultado)}</div><div class="k-sub">margem ${pct(S.recB ? S.resultado / S.recB : null)}</div></div>
      <div class="kpi"><div class="k-label">Saldo disponível em ${dateBR(R.fim)}</div><div class="k-value ${S.saldo < 0 ? 'neg' : ''}">${money0(S.saldo)}</div><div class="k-sub">pelo sistema (lançamentos pagos)</div></div>
    </div>
    ${ok < tot ? '<p class="small muted" style="margin:0 0 8px">Enquanto houver etapa pendente, os números acima ainda podem mudar.</p>' : ''}
    <div class="card flush"><div class="table-wrap"><table><thead><tr><th style="width:36px"></th><th>Etapa</th><th>Situação</th><th></th></tr></thead><tbody>
      ${R.etapas.map((x, n) => `<tr><td style="text-align:center;font-size:18px">${x.ok ? '<span class="pos">✔</span>' : '<span class="neg">●</span>'}</td>
        <td><strong>${n + 1}. ${esc(x.titulo)}</strong><div><span class="badge ${x.ok ? 'pago' : 'vencido'}">${x.ok ? 'pronto' : 'pendente'}</span></div></td>
        <td class="wrap small">${x.resumo}${x.obs ? `<div class="muted">${esc(x.obs)}</div>` : ''}</td>
        <td class="noprint">${x.ok ? '' : x.k === 'semconta' ? '<button class="btn small primary" data-rev>Revisar e resolver</button>' : `<a class="btn small" href="${x.link}">${esc(x.acao)}</a>`}</td></tr>`).join('')}
    </tbody></table></div></div>
    ${cardContas(R)}
    ${S.saldos.length ? `<div class="card flush"><div style="padding:12px 12px 0"><h2 style="margin:0">Saldos em ${dateBR(R.fim)}</h2><p class="muted small" style="margin:4px 0 0">Saldo pelo sistema em cada conta com recursos disponíveis (lançamentos pagos até o fim do mês).</p></div>
      <div class="table-wrap"><table><thead><tr><th>Conta</th><th class="num">Saldo</th></tr></thead><tbody>
      ${S.saldos.map(s => `<tr><td>${esc(s.nome)}</td><td class="num ${+s.saldo_pago < 0 ? 'neg' : ''}">${money(s.saldo_pago)}</td></tr>`).join('')}
      <tr class="row-total"><td>TOTAL</td><td class="num">${money(S.saldo)}</td></tr></tbody></table></div></div>` : ''}
    <p class="muted small">Conferido em ${new Date().toLocaleString('pt-BR')} · ${esc(state.empresa.nome || '')}</p>`;
}

function cardContas(R) {
  const adm = isAdmin();
  const st = (x) => x.bate ? '<span class="badge pago">✔ conciliado · batendo</span>'
    : !x.temExt && x.trava?.saldo_banco != null ? (Math.abs(+x.trava.saldo_banco - +x.trava.saldo_sistema) <= 0.05
      ? `<span class="badge pago" title="${esc(x.trava.observacao || '')}">✔ fechada pelo saldo informado</span>`
      : `<span class="badge aberto" title="${esc(x.trava.observacao || '')}">fechada com diferença ${money(+x.trava.saldo_banco - +x.trava.saldo_sistema)}</span>`)
    : !x.temExt ? '<span class="badge">sem extrato</span>'
    : !x.cobre ? `<span class="badge aberto">extrato só até ${dateBR(x.ultExt)}</span>`
    : x.pend ? `<span class="badge aberto">${x.pend} pendente(s)</span>`
    : `<span class="badge vencido">diferença ${money(x.dif)}</span>`;
  const tv = (x) => x.trava ? `<span class="badge conc" title="Travada em ${new Date(x.trava.criado_em).toLocaleString('pt-BR')}">🔒 travada até ${dateBR(x.trava.ate)}</span>
      ${adm ? `<button class="btn small ghost noprint" data-destravar="${x.trava.id}">Destravar</button>` : ''}`
    : !R.travaInstalada ? '<span class="muted small">—</span>'
    : !adm ? '<span class="muted small">aberta</span>'
    : x.temExt ? `<button class="btn small ${x.bate ? 'primary' : ''} noprint" data-travar="${x.ct.id}" title="Escolha a data de fechamento desta conta">Fechar / travar…</button>`
    : `<button class="btn small primary noprint" data-fechar="${x.ct.id}" title="Conta sem extrato OFX: escolha a data, informe o saldo conferido e trave">Fechar com saldo informado…</button>`;
  return `<div class="card flush"><div style="padding:12px 12px 0"><h2 style="margin:0">Contas em ${dateBR(R.fim)}: conciliação e trava</h2>
    <p class="muted small" style="margin:4px 0 0">Batendo = extrato importado até o fim do mês, nenhum movimento pendente e o movimento do mês no extrato igual ao do sistema. Conta sem extrato (caixa, cofre…): use “Fechar com saldo informado” — você informa o saldo conferido e, se bater, a conta é travada. Travar impede mudar data, valor, conta, situação ou excluir lançamentos da conta até a data (classificação, descrição e centro de custo continuam livres).${R.travaInstalada ? '' : ' <strong>A trava ainda não foi instalada no banco de dados.</strong>'}</p></div>
    <div class="table-wrap"><table><thead><tr><th>Conta</th><th>Situação</th><th class="num">Movimento no extrato</th><th class="num">Movimento no sistema</th><th class="num">Saldo no sistema</th><th>Trava</th></tr></thead><tbody>
    ${R.contas.map(x => `<tr><td>${esc(x.ct.nome)}</td><td>${st(x)}</td><td class="num">${x.temExt ? money(x.mE) : x.trava?.saldo_banco != null ? `<span class="small muted">saldo informado</span> ${money(x.trava.saldo_banco)}` : '—'}</td><td class="num">${money(x.mS)}</td><td class="num ${x.saldo < 0 ? 'neg' : ''}">${x.saldo == null ? '—' : money(x.saldo)}</td><td>${tv(x)}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}

async function destravar(R, travaId, root) {
  const x = R.contas.find(c => c.trava?.id === travaId); if (!x) return;
  if (!confirm(`Destravar a conta ${x.ct.nome}? Os lançamentos até ${dateBR(x.trava.ate)} voltam a poder ser alterados. Fica registrado quem destravou e quando.`)) return;
  try { await q(sb.from('contas_travas').update({ ativo: false, desfeito_por: state.user?.id, desfeito_em: new Date().toISOString() }).eq('id', travaId)); toast(`${x.ct.nome} destravada`); carregar(root); } catch (e) { fail(e); }
}

// Fechar / travar uma conta numa data escolhida (cada banco pode fechar numa data diferente).
// Com extrato: confere se há movimento do extrato pendente até a data e se o saldo do banco (último extrato) bate.
// Sem extrato (caixa, cofre, conta sem OFX): o usuário informa o saldo conferido na data.
// Depois de travada, os lançamentos pagos da conta até a data não mudam data, valor, conta nem situação.
function fecharConta(R, contaId, root) {
  const x = R.contas.find(c => c.ct.id === contaId); if (!x) return;
  const hoje = new Date().toISOString().slice(0, 10);
  const sug = x.temExt && x.ultExt ? (x.ultExt < R.fim ? x.ultExt : R.fim) : R.fim;
  const m = modal({ title: `Fechar ${x.ct.nome}`, body: `
    <p class="small muted" style="margin-top:0">Escolha até que dia esta conta está fechada. ${x.temExt ? `Extrato importado até ${dateBR(x.ultExt)}.` : 'Conta sem extrato: informe o saldo conferido (extrato em papel, contagem do caixa) nessa data.'}
      Depois de travada, os lançamentos pagos desta conta até a data não podem ter data, valor, conta ou situação alterados, nem ser excluídos ou incluídos — só classificação, descrição e centro de custo.</p>
    <div class="toolbar" style="padding:0"><label>Fechada até<input type="date" id="fd" value="${sug}" max="${hoje}"></label>
      <label class="grow">Saldo no banco em <span id="fdl">${dateBR(sug)}</span>${x.temExt ? ' (opcional)' : ' *'}<input id="sb" inputmode="decimal" placeholder="0,00"></label></div>
    <div id="fi" class="small" style="margin:8px 0"><span class="muted">Conferindo…</span></div>
    <label>Observação<input id="ob" placeholder="ex.: conferido com o extrato do banco; contagem do caixa por Fulano"></label>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ok">Fechar e travar</button>' });
  let info = null, seq = 0;
  const val = () => { const t = $('#sb', m.el).value.trim(); return t === '' ? null : parseNum(t); };
  const mostra = () => {
    if (!info) return;
    const v = val(), d = v == null ? null : v - info.saldo;
    $('#fi', m.el).innerHTML = `<div class="kpis" style="margin:0"><div class="kpi"><div class="k-label">Saldo no sistema em ${dateBR(info.data)}</div><div class="k-value ${info.saldo < 0 ? 'neg' : ''}">${money(info.saldo)}</div></div>
      ${x.temExt ? `<div class="kpi"><div class="k-label">Extrato pendente até ${dateBR(info.data)}</div><div class="k-value ${info.pend ? 'neg' : 'pos'}">${info.pend}</div><div class="k-sub">${info.pend ? money(info.vPend) + ' sem conciliar' : 'tudo conciliado'}${info.semExt ? ` · <span class="neg">extrato só até ${dateBR(x.ultExt)}</span>` : ''}</div></div>` : ''}
      ${d == null ? '' : `<div class="kpi"><div class="k-label">Banco − sistema</div><div class="k-value ${Math.abs(d) <= 0.05 ? 'pos' : 'neg'}">${money(d)}</div><div class="k-sub">${Math.abs(d) <= 0.05 ? '✔ bate' : 'diferença'}</div></div>`}</div>`;
  };
  const conferirData = async () => {
    const dt = $('#fd', m.el).value; if (!dt) return;
    $('#fdl', m.el).textContent = dateBR(dt);
    const k = ++seq; $('#fi', m.el).innerHTML = '<span class="muted">Conferindo…</span>';
    try {
      const [sal, pend] = await Promise.all([
        q(sb.rpc('saldos_contas', { p_empresa: state.empresa.id, p_ate: dt })),
        x.temExt ? fetchAll(() => sb.from('extrato_itens').select('id,valor').eq('empresa_id', state.empresa.id).eq('conta_id', contaId).eq('status', 'pendente').lte('data', dt).order('id')) : [],
      ]);
      if (k !== seq) return;
      const s0 = sal.find(r => r.conta_id === contaId);
      info = { data: dt, saldo: s0 ? +s0.saldo_pago : 0, pend: pend.length, vPend: pend.reduce((s, i) => s + Math.abs(+i.valor), 0), semExt: x.temExt && (!x.ultExt || x.ultExt < dt) };
      mostra();
    } catch (e) { fail(e); }
  };
  $('#fd', m.el).onchange = conferirData;
  $('#sb', m.el).oninput = mostra;
  conferirData();
  $('#ok', m.el).onclick = async () => {
    if (!info || info.data !== $('#fd', m.el).value) return toast('Aguarde a conferência da data', true);
    const v = val();
    if (!x.temExt && (v == null || isNaN(v))) return toast('Informe o saldo conferido nessa data', true);
    if (v != null && isNaN(v)) return toast('Saldo inválido', true);
    const avisos = [];
    if (info.semExt) avisos.push(`o extrato importado vai só até ${dateBR(x.ultExt)}`);
    if (info.pend) avisos.push(`${info.pend} movimento(s) do extrato sem conciliar até a data`);
    const d = v == null ? null : v - info.saldo;
    if (d != null && Math.abs(d) > 0.05) avisos.push(`o saldo informado difere do sistema em ${money(d)}`);
    if (!confirm(`Fechar e travar ${x.ct.nome} até ${dateBR(info.data)}?${avisos.length ? `\n\nATENÇÃO: ${avisos.join('; ')}. Travar mesmo assim?` : ''}`)) return;
    const obs = [$('#ob', m.el).value.trim(), avisos.length ? `travada com pendência: ${avisos.join('; ')}` : (x.temExt ? 'conciliado e batendo' : 'saldo informado bate com o sistema')].filter(Boolean).join(' · ');
    try {
      if (x.trava) await q(sb.from('contas_travas').update({ ativo: false, desfeito_por: state.user?.id, desfeito_em: new Date().toISOString() }).eq('id', x.trava.id));
      await q(sb.from('contas_travas').insert({ empresa_id: state.empresa.id, conta_id: contaId, ate: info.data, saldo_sistema: +info.saldo.toFixed(2), saldo_banco: v == null ? null : +v.toFixed(2), observacao: obs }));
      toast(`${x.ct.nome} fechada até ${dateBR(info.data)}`); m.close(); carregar(root);
    } catch (e) { fail(e); }
  };
}

// =====================================================================
// Checklist do fechamento (melhoria 3.8): tarefas com responsável e prazo em dia útil, "quanto falta para fechar",
// fechar o mês (trava dos lançamentos pagos) e reabrir com motivo.
// =====================================================================
async function dadosChecklist(mes) {
  const e = state.empresa.id;
  const cfg0 = await q(sb.from('fechamento_config').select('*').eq('empresa_id', e).maybeSingle()).catch(() => undefined);
  if (cfg0 === undefined) return null;   // SQL 107 ainda não rodado
  await q(sb.rpc('fechamento_gerar', { p_empresa: e, p_mes: mes })).catch(() => 0);
  const [modelos, tarefas, mesSit, eventos, membros] = await Promise.all([
    q(sb.from('fechamento_modelos').select('*').eq('empresa_id', e).order('ordem').order('titulo')),
    q(sb.from('fechamento_tarefas').select('*').eq('empresa_id', e).eq('mes', mes).order('ordem').order('prazo')),
    q(sb.from('fechamento_meses').select('*').eq('empresa_id', e).eq('mes', mes).maybeSingle()),
    q(sb.from('fechamento_eventos').select('*').eq('empresa_id', e).eq('mes', mes).order('em', { ascending: false }).limit(50)),
    q(sb.rpc('listar_membros', { p_empresa: e })).catch(() => []),
  ]);
  const cfg = { meta_dia_util: 5, papeis_fechar: ['admin', 'diretor'], exigir_checklist: true, lembrar: true, lembrete_dias_antes: 1, cobrar_atrasadas: true, avisar_reabertura: ['admin', 'diretor', 'financeiro'], ...(cfg0 || {}) };
  return { cfg, modelos, tarefas, mesSit, eventos, membros };
}

const nomeDe = (K, uid) => { const m = K.membros.find(x => x.user_id === uid); return m ? (m.nome || m.email.split('@')[0]) : 'pessoa'; };
const respTxt = (K, t) => t.responsavel ? nomeDe(K, t.responsavel) : `perfil ${F.PAPEIS[t.papel] || t.papel || 'financeiro'}`;
const podeMarcar = (t) => gestor() || t.responsavel === state.user?.id || (!t.responsavel && t.papel === state.papel);

async function checklist(c, R, root) {
  const K = await dadosChecklist(R.mes);
  const box = document.createElement('div'); box.id = 'fc-check'; c.prepend(box);
  if (!K) { box.innerHTML = '<div class="card"><p class="small warn" style="margin:0">O checklist com responsáveis e prazos, a trava do mês e o painel "quanto falta para fechar" precisam do SQL 107. As conferências automáticas abaixo continuam valendo.</p></div>'; return; }
  const hoje = hojeISO(), autoOk = Object.fromEntries(R.etapas.map(x => [x.k, x.ok]));
  const P = F.progresso(K.tarefas, autoOk, hoje, K.cfg.meta_dia_util, R.mes);
  const fechado = K.mesSit?.situacao === 'fechado';
  const podeFechar = K.cfg.papeis_fechar.includes(state.papel);
  const passado = R.mes < hoje.slice(0, 7);
  const meta = `D+${K.cfg.meta_dia_util} (${dateBR(P.dataMeta)})`;
  const pctTxt = Math.round(P.pct * 100);
  const banner = fechado
    ? `<div class="card fc-banner fc-fechado"><div><strong>🔒 Mês fechado</strong> em ${new Date(K.mesSit.fechado_em).toLocaleString('pt-BR')} por ${esc(nomeDe(K, K.mesSit.fechado_por))}.
        Os lançamentos pagos do mês não mudam data, valor, conta, classificação nem situação.${K.mesSit.justificativa ? `<div class="small muted">Fechado com pendência: ${esc(K.mesSit.justificativa)}</div>` : ''}</div>
        ${podeFechar ? '<button class="btn noprint" id="fc-reabrir">Reabrir o mês…</button>' : ''}</div>`
    : `<div class="card fc-banner"><div><strong>${K.mesSit?.situacao === 'reaberto' ? '🔓 Mês reaberto' : 'Mês aberto'}</strong>${K.mesSit?.situacao === 'reaberto' ? ` em ${new Date(K.mesSit.reaberto_em).toLocaleString('pt-BR')} por ${esc(nomeDe(K, K.mesSit.reaberto_por))}: ${esc(K.mesSit.motivo_reabertura || '')}` : ''}
        <div class="small muted">Meta: fechar até ${meta}. ${passado ? `Hoje é D+${P.dHoje}.` : 'O mês ainda está em andamento.'}</div></div>
        ${podeFechar && passado ? `<button class="btn primary noprint" id="fc-fechar">🔒 Fechar o mês…</button>` : ''}</div>`;
  const resp = Object.values(P.porResp).sort((a, b) => b.atras - a.atras || b.pend - a.pend);
  box.innerHTML = `${banner}
    <div class="kpis">
      <div class="kpi"><div class="k-label">Quanto falta para fechar</div><div class="k-value ${P.pendentes ? '' : 'pos'}">${P.pendentes ? `${P.pendentes} de ${P.total}` : 'nada'}</div>
        <div class="fc-barra"><i style="width:${pctTxt}%"></i></div><div class="k-sub">${pctTxt}% do checklist pronto</div></div>
      <div class="kpi"><div class="k-label">Atrasadas</div><div class="k-value ${P.atrasadas ? 'neg' : ''}">${P.atrasadas}</div><div class="k-sub">${P.venceHoje ? `${P.venceHoje} vence(m) hoje` : 'nenhuma vence hoje'}</div></div>
      <div class="kpi"><div class="k-label">Meta de fechamento</div><div class="k-value ${P.foraDaMeta ? 'neg' : ''}">D+${K.cfg.meta_dia_util}</div><div class="k-sub">${dateBR(P.dataMeta)}${P.foraDaMeta ? ' · passou da meta' : ''}</div></div>
      <div class="kpi"><div class="k-label">Previsão pelo checklist</div><div class="k-value">${P.ultimoPrazo ? dateBR(P.ultimoPrazo) : fechado ? 'fechado' : 'pronto'}</div><div class="k-sub">${P.ultimoPrazo ? 'prazo da última tarefa pendente' : '&nbsp;'}</div></div>
    </div>
    <div class="card flush"><div class="card-head" style="padding:12px 12px 0;margin:0"><div><h2 style="margin:0">Checklist do fechamento</h2>
        <p class="muted small" style="margin:4px 0 0">Prazo em dia útil: D+1 é o 1º dia útil do mês seguinte (D+0, o último dia útil do mês). As tarefas ligadas a uma conferência automática ficam prontas sozinhas.</p></div>
      <div class="toolbar noprint" style="margin:0">${gestor() ? '<button class="btn small" id="fc-modelo">Modelo do checklist</button><button class="btn small" id="fc-par">Parâmetros</button>' : ''}<button class="btn small" id="fc-hist">Histórico</button></div></div>
      ${!K.tarefas.length ? `<div class="empty">${K.modelos.length ? 'O modelo não tem tarefas ativas.' : `A empresa ainda não tem um modelo de checklist.${gestor() ? '<div style="margin-top:8px"><button class="btn primary small" id="fc-padrao">Usar o modelo padrão (10 tarefas)</button></div>' : ''}`}</div>`
      : `<div class="table-wrap"><table id="fc-t"><thead><tr><th style="width:30px"></th><th>Tarefa</th><th>Responsável</th><th>Prazo</th><th>Situação</th><th class="noprint"></th></tr></thead><tbody>
        ${P.itens.map(({ t, s }) => `<tr data-id="${t.id}"><td style="text-align:center;font-size:17px">${s.feita ? '<span class="pos">✔</span>' : s.atrasada ? '<span class="neg">●</span>' : '<span class="muted">○</span>'}</td>
          <td class="wrap"><strong>${esc(t.titulo)}</strong>${t.obrigatoria === false ? ' <span class="badge">opcional</span>' : ''}${t.descricao ? `<div class="small muted">${esc(t.descricao)}</div>` : ''}
            ${s.auto ? `<div class="small">${autoOk[t.etapa_auto] ? '<span class="pos">conferência automática ok</span>' : `<span class="neg">conferência automática pendente</span>`}</div>` : ''}${t.observacao ? `<div class="small">📝 ${esc(t.observacao)}</div>` : ''}</td>
          <td class="nowrap small">${esc(respTxt(K, t))}${t.area ? `<div class="muted">${esc(t.area)}</div>` : ''}</td>
          <td class="nowrap"><b>D+${t.dia_util}</b> <span class="small muted">${dateBR(t.prazo)}</span></td>
          <td><span class="badge ${s.feita ? 'pago' : s.atrasada ? 'vencido' : s.hoje ? 'aberto' : ''}">${s.rotulo}</span>${t.feita_em && t.situacao !== 'pendente' ? `<div class="small muted">${esc(nomeDe(K, t.feita_por))}, ${new Date(t.feita_em).toLocaleDateString('pt-BR')}</div>` : ''}</td>
          <td class="nowrap noprint">${fechado ? '' : `${t.link ? `<a class="btn ghost small" href="${esc(t.link)}">Abrir</a>` : ''}${podeMarcar(t) ? (t.situacao === 'pendente'
              ? `${!s.auto || !autoOk[t.etapa_auto] ? `<button class="btn small ${s.auto ? '' : 'primary'}" data-ok>Feita</button>` : ''}<button class="btn ghost small" data-na>Não se aplica</button>`
              : '<button class="btn ghost small" data-desf>Desfazer</button>') : ''}${gestor() ? '<button class="btn ghost small" data-aj title="Responsável e prazo deste mês">⚙</button>' : ''}`}</td></tr>`).join('')}
        </tbody></table></div>`}
      ${resp.length ? `<div class="fc-resp small">${resp.map(r => `<span class="${r.atras ? 'neg' : ''}">${esc(respTxt(K, r.t))}: ${r.pend} pendente(s)${r.atras ? `, ${r.atras} atrasada(s)` : ''}</span>`).join('')}</div>` : ''}
    </div>`;

  const re = () => carregar(root), e = state.empresa.id;
  $('#fc-padrao', box) && ($('#fc-padrao', box).onclick = async () => { try { await q(sb.rpc('fechamento_modelo_padrao', { p_empresa: e })); toast('Modelo padrão criado'); re(); } catch (er) { fail(er); } });
  $('#fc-modelo', box) && ($('#fc-modelo', box).onclick = () => modeloChecklist(K, re));
  $('#fc-par', box) && ($('#fc-par', box).onclick = () => parametrosFech(K, re));
  $('#fc-hist', box).onclick = () => historico(K, R);
  $('#fc-fechar', box) && ($('#fc-fechar', box).onclick = () => fecharMes(K, R, P, re));
  $('#fc-reabrir', box) && ($('#fc-reabrir', box).onclick = () => reabrirMes(R, re));
  $('#fc-t', box) && ($('#fc-t', box).onclick = async (ev) => {
    const id = ev.target.closest('tr')?.dataset.id; if (!id) return; const t = K.tarefas.find(x => x.id === id);
    const marcar = async (sit, obs) => { try { await q(sb.rpc('fechamento_marcar', { p_tarefa: id, p_situacao: sit, p_observacao: obs || null })); re(); } catch (er) { fail(er); } };
    if (ev.target.closest('[data-ok]')) marcar('feita', null);
    if (ev.target.closest('[data-desf]')) marcar('pendente', null);
    if (ev.target.closest('[data-na]')) {
      const m = modal({ title: 'Não se aplica neste mês', narrow: true, body: `<p class="small" style="margin-top:0">${esc(t.titulo)}</p><label>Por quê?<input id="na-m" maxlength="300" placeholder="ex.: não houve borderô no mês"></label>`,
        foot: '<button class="btn" data-close>Voltar</button><button class="btn primary" id="na-ok">Confirmar</button>' });
      $('#na-ok', m.el).onclick = () => { const v = $('#na-m', m.el).value.trim(); if (v.length < 5) return toast('Diga por que não se aplica', true); m.close(); marcar('nao_aplica', v); };
    }
    if (ev.target.closest('[data-aj]')) ajustarTarefa(K, t, re);
  });
}

const opcoesResp = (K, uid, papel) => `<option value="">Pelo perfil</option>${K.membros.map(m => `<option value="${m.user_id}" ${m.user_id === uid ? 'selected' : ''}>${esc(m.nome || m.email)} (${esc(F.PAPEIS[m.papel] || m.papel)})</option>`).join('')}`;
const opcoesPapel = (p) => Object.entries(F.PAPEIS).map(([k, l]) => `<option value="${k}" ${k === (p || 'financeiro') ? 'selected' : ''}>${l}</option>`).join('');

function ajustarTarefa(K, t, depois) {
  const m = modal({ title: 'Responsável e prazo neste mês', narrow: true, body: `<p class="small" style="margin-top:0">${esc(t.titulo)}. Para mudar todos os meses, ajuste o Modelo do checklist.</p>
    <div class="grid-form"><label class="span2">Responsável<select id="aj-r">${opcoesResp(K, t.responsavel)}</select></label>
    <label>Perfil (sem pessoa)<select id="aj-p">${opcoesPapel(t.papel)}</select></label><label>Prazo (D+)<input id="aj-d" type="number" min="0" max="20" value="${t.dia_util}"></label></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="aj-ok">Salvar</button>' });
  $('#aj-ok', m.el).onclick = async () => {
    try { await q(sb.rpc('fechamento_ajustar', { p_tarefa: t.id, p_responsavel: $('#aj-r', m.el).value || null, p_papel: $('#aj-p', m.el).value, p_dia_util: +$('#aj-d', m.el).value })); m.close(); depois(); } catch (e) { fail(e); }
  };
}

function modeloChecklist(K, depois) {
  const L = K.modelos;
  const m = modal({ title: 'Modelo do checklist do fechamento', wide: true, body: `
    <p class="small muted" style="margin-top:0">As tarefas do modelo viram o checklist de cada mês. Mudanças valem para os meses que ainda não tinham a tarefa. Para um mês já gerado, use o ⚙ da tarefa.</p>
    <div class="table-wrap"><table><thead><tr><th>Ordem</th><th>Tarefa</th><th>Responsável</th><th>Prazo</th><th>Conferência automática</th><th></th></tr></thead><tbody>
    ${L.map(x => `<tr data-id="${x.id}" class="${x.ativo ? '' : 'muted'}"><td>${x.ordem}</td><td class="wrap"><b>${esc(x.titulo)}</b>${x.ativo ? '' : ' <span class="badge">inativa</span>'}${x.obrigatoria ? '' : ' <span class="badge">opcional</span>'}</td>
      <td class="small">${esc(respTxt(K, x))}</td><td>D+${x.dia_util}</td><td class="small">${x.etapa_auto ? esc(F.ETAPAS_AUTO[x.etapa_auto]) : '—'}</td>
      <td class="nowrap"><button class="btn ghost small" data-ed>Editar</button><button class="btn ghost small" data-del>Excluir</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhuma tarefa no modelo.</td></tr>'}
    </tbody></table></div>`, foot: '<button class="btn" data-close>Fechar</button><button class="btn primary" id="md-novo">+ Nova tarefa</button>' });
  $('#md-novo', m.el).onclick = () => { m.close(); editarModelo(K, { ordem: (L.reduce((a, x) => Math.max(a, x.ordem), 0) || 0) + 1, dia_util: 3, papel: 'financeiro', obrigatoria: true, ativo: true }, depois); };
  m.el.querySelector('tbody').onclick = async (e) => {
    const id = e.target.closest('tr')?.dataset.id; if (!id) return; const x = L.find(y => y.id === id);
    if (e.target.closest('[data-ed]')) { m.close(); editarModelo(K, x, depois); }
    if (e.target.closest('[data-del]') && await confirmDialog(`Excluir "${x.titulo}" do modelo? As tarefas dos meses já gerados continuam.`)) {
      try { await q(sb.from('fechamento_modelos').delete().eq('id', id)); toast('Tarefa excluída do modelo'); m.close(); depois(); } catch (er) { fail(er); }
    }
  };
}

function editarModelo(K, x, depois) {
  const m = modal({ title: x.id ? 'Editar tarefa do modelo' : 'Nova tarefa do modelo', body: `<div class="grid-form">
      <label class="span2">Tarefa<input id="em-t" maxlength="120" value="${esc(x.titulo || '')}" placeholder="ex.: Conferir a folha com o financeiro"></label>
      <label class="span2">Descrição<input id="em-d" maxlength="300" value="${esc(x.descricao || '')}"></label>
      <label>Área<input id="em-a" maxlength="40" value="${esc(x.area || '')}" placeholder="ex.: Financeiro"></label>
      <label>Prazo (D+)<input id="em-n" type="number" min="0" max="20" value="${x.dia_util}"></label>
      <label>Responsável<select id="em-r">${opcoesResp(K, x.responsavel)}</select></label>
      <label>Perfil (sem pessoa)<select id="em-p">${opcoesPapel(x.papel)}</select></label>
      <label>Conferência automática<select id="em-e"><option value="">Nenhuma (marcar à mão)</option>${Object.entries(F.ETAPAS_AUTO).map(([k, l]) => `<option value="${k}" ${k === x.etapa_auto ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Link da tela<input id="em-l" value="${esc(x.link || '')}" placeholder="#/conciliacao"></label>
      <label>Ordem<input id="em-o" type="number" min="0" max="999" value="${x.ordem}"></label>
      <label class="chk"><input type="checkbox" id="em-ob" ${x.obrigatoria ? 'checked' : ''}> Obrigatória para fechar</label>
      <label class="chk"><input type="checkbox" id="em-at" ${x.ativo ? 'checked' : ''}> Ativa</label></div>
      <p class="small muted">D+1 = 1º dia útil do mês seguinte; D+0 = último dia útil do mês. Feriados nacionais e fins de semana não contam.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="em-ok">Salvar</button>' });
  $('#em-ok', m.el).onclick = async () => {
    const v = (id) => $('#' + id, m.el).value;
    const reg = { titulo: v('em-t').trim(), descricao: v('em-d').trim() || null, area: v('em-a').trim() || null, dia_util: +v('em-n'), responsavel: v('em-r') || null,
      papel: v('em-r') ? null : v('em-p'), etapa_auto: v('em-e') || null, link: v('em-l').trim() || null, ordem: +v('em-o') || 0, obrigatoria: $('#em-ob', m.el).checked, ativo: $('#em-at', m.el).checked };
    if (!reg.titulo) return toast('Escreva a tarefa', true);
    if (!(reg.dia_util >= 0 && reg.dia_util <= 20)) return toast('O prazo vai de D+0 a D+20', true);
    try {
      if (x.id) await q(sb.from('fechamento_modelos').update(reg).eq('id', x.id)); else await q(sb.from('fechamento_modelos').insert({ ...reg, empresa_id: state.empresa.id }));
      toast('Modelo salvo'); m.close(); depois();
    } catch (e) { fail(e); }
  };
}

function parametrosFech(K, depois) {
  const c = K.cfg, chk = (arr, cls) => Object.entries(F.PAPEIS).filter(([k]) => ['admin', 'diretor', 'financeiro', 'leitura'].includes(k)).map(([k, l]) => `<label class="chk"><input type="checkbox" class="${cls}" value="${k}" ${arr.includes(k) ? 'checked' : ''}> ${l}</label>`).join('');
  const m = modal({ title: 'Parâmetros do fechamento', body: `<div class="grid-form">
      <label>Meta: fechar até (D+)<input id="pf-meta" type="number" min="1" max="20" value="${c.meta_dia_util}"></label>
      <label>Lembrete antes do prazo (dias)<input id="pf-lem" type="number" min="0" max="10" value="${c.lembrete_dias_antes}"></label>
      <label class="chk span2"><input type="checkbox" id="pf-l" ${c.lembrar ? 'checked' : ''}> Lembrar o responsável antes do prazo</label>
      <label class="chk span2"><input type="checkbox" id="pf-c" ${c.cobrar_atrasadas ? 'checked' : ''}> Cobrar as tarefas atrasadas (um aviso por dia útil)</label>
      <label class="chk span2"><input type="checkbox" id="pf-x" ${c.exigir_checklist ? 'checked' : ''}> Fechar com pendência exige justificativa</label>
      <div class="span2"><span class="small">Quem fecha e reabre o mês</span><div class="fc-chks">${chk(c.papeis_fechar, 'pf-f')}</div></div>
      <div class="span2"><span class="small">Quem é avisado quando o mês fecha ou reabre</span><div class="fc-chks">${chk(c.avisar_reabertura, 'pf-a')}</div></div></div>
      <p class="small muted">Os avisos de lembrete e cobrança saem todo dia às 8h para o responsável da tarefa (ou para o perfil, quando não há pessoa). Tarefas ligadas a uma conferência automática não são cobradas.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pf-ok">Salvar</button>' });
  $('#pf-ok', m.el).onclick = async () => {
    const reg = { empresa_id: state.empresa.id, meta_dia_util: +$('#pf-meta', m.el).value, lembrete_dias_antes: +$('#pf-lem', m.el).value, lembrar: $('#pf-l', m.el).checked,
      cobrar_atrasadas: $('#pf-c', m.el).checked, exigir_checklist: $('#pf-x', m.el).checked,
      papeis_fechar: $$('.pf-f', m.el).filter(i => i.checked).map(i => i.value), avisar_reabertura: $$('.pf-a', m.el).filter(i => i.checked).map(i => i.value) };
    if (!(reg.meta_dia_util >= 1 && reg.meta_dia_util <= 20)) return toast('A meta vai de D+1 a D+20', true);
    if (!reg.papeis_fechar.length) return toast('Escolha quem fecha o mês', true);
    try { await q(sb.from('fechamento_config').upsert(reg, { onConflict: 'empresa_id' })); toast('Parâmetros salvos'); m.close(); depois(); } catch (e) { fail(e); }
  };
}

function historico(K, R) {
  const ic = { fechou: '🔒', reabriu: '🔓', tarefa: '✔' };
  modal({ title: `Histórico do fechamento de ${R.mes.slice(5)}/${R.mes.slice(0, 4)}`, wide: true, body: K.eventos.length
    ? `<div class="table-wrap"><table><thead><tr><th>Quando</th><th>Quem</th><th>O quê</th></tr></thead><tbody>${K.eventos.map(x => `<tr><td class="nowrap">${new Date(x.em).toLocaleString('pt-BR')}</td><td>${esc((x.por_email || '').split('@')[0])}</td>
      <td class="wrap">${ic[x.acao] || ''} ${esc(x.detalhe || '')}${x.pendencias?.length ? `<div class="small muted">Pendências: ${x.pendencias.map(p => esc(p.titulo)).join(' · ')}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Nada registrado neste mês.</div>' });
}

function fecharMes(K, R, P, depois) {
  const auto = F.pendenciasAuto(R.etapas).filter(a => !K.tarefas.some(t => t.etapa_auto === a.k && t.situacao !== 'pendente'));
  const tar = P.itens.filter(x => !x.s.feita && !x.s.auto && x.t.obrigatoria !== false).map(x => ({ k: 'tarefa', titulo: x.t.titulo }));
  const pend = [...auto, ...tar];
  const precisa = pend.length && K.cfg.exigir_checklist;
  const m = modal({ title: `Fechar ${R.mes.slice(5)}/${R.mes.slice(0, 4)}`, body: `
    <p style="margin-top:0">Depois de fechado, os <b>lançamentos pagos com data no mês</b> não podem mudar data, valor, conta, classificação nem situação, nem ser incluídos ou excluídos. Descrição, documento e centro de custo continuam livres. Para mudar, alguém com permissão reabre o mês com o motivo.</p>
    ${pend.length ? `<div class="card alert-row atencao" style="display:block"><b>${pend.length} pendência(s)</b><ul class="small" style="margin:6px 0 0">${pend.map(p => `<li>${esc(p.titulo)}</li>`).join('')}</ul></div>
      <label>Justificativa para fechar com pendência${precisa ? ' *' : ' (opcional)'}<textarea id="fm-j" rows="3" maxlength="500" placeholder="ex.: borderô 118 aprovado por e-mail; extrato do Banco X chega dia 10 e não muda o saldo"></textarea></label>`
      : '<p class="pos"><b>Checklist completo.</b></p>'}`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="fm-ok">🔒 Fechar o mês</button>' });
  $('#fm-ok', m.el).onclick = async () => {
    const j = $('#fm-j', m.el)?.value.trim() || null;
    if (precisa && (!j || j.length < 15)) return toast('Escreva a justificativa (pelo menos 15 letras)', true);
    try { await q(sb.rpc('fechamento_fechar', { p_empresa: state.empresa.id, p_mes: R.mes, p_pendencias: auto, p_justificativa: j })); toast('Mês fechado'); m.close(); depois(); } catch (e) { fail(e); }
  };
}

function reabrirMes(R, depois) {
  const m = modal({ title: `Reabrir ${R.mes.slice(5)}/${R.mes.slice(0, 4)}`, narrow: true, body: `<p class="small" style="margin-top:0">Os lançamentos pagos do mês voltam a poder ser alterados. O motivo fica no histórico e a equipe é avisada.</p>
    <label>Motivo *<textarea id="rm-m" rows="3" maxlength="500" placeholder="ex.: nota de despesa de outubro chegou depois do fechamento"></textarea></label>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn danger" id="rm-ok">Reabrir</button>' });
  $('#rm-ok', m.el).onclick = async () => {
    const v = $('#rm-m', m.el).value.trim(); if (v.length < 15) return toast('Explique o motivo (pelo menos 15 letras)', true);
    try { await q(sb.rpc('fechamento_reabrir', { p_empresa: state.empresa.id, p_mes: R.mes, p_motivo: v })); toast('Mês reaberto'); m.close(); depois(); } catch (e) { fail(e); }
  };
}

/** Central de Decisões: tarefas do fechamento atrasadas (do mês anterior) */
export async function alertasDecisao() {
  try {
    const e = state.empresa.id, mes = mesAnt(), hoje = hojeISO();
    const [T, M] = await Promise.all([
      q(sb.from('fechamento_tarefas').select('titulo,prazo,situacao,etapa_auto,responsavel,papel,dia_util').eq('empresa_id', e).eq('mes', mes).eq('situacao', 'pendente').lt('prazo', hoje)),
      q(sb.from('fechamento_meses').select('situacao').eq('empresa_id', e).eq('mes', mes).maybeSingle()),
    ]);
    if (M?.situacao === 'fechado') return [];
    const at = T.filter(t => !t.etapa_auto); if (!at.length) return [];
    return [{ k: 'fechamento-atrasado', origem: 'Fechamento', urg: at.length > 2 ? 'alta' : 'media', titulo: `${at.length} tarefa(s) do fechamento de ${mes.slice(5)}/${mes.slice(0, 4)} atrasada(s)`,
      desc: at.slice(0, 4).map(t => `${t.titulo} (D+${t.dia_util}, ${dateBR(t.prazo)})`).join(' · '), regra: 'Tarefas manuais do checklist do fechamento com prazo vencido e o mês ainda aberto.',
      impacto: 0, impactoTxt: null, acao: 'Abrir o fechamento', rota: 'fechamento?mes=' + mes }];
  } catch { return []; }
}
