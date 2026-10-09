// Fechamento do mês: checklist com status automático de cada etapa (extratos conciliados, lançamentos sem conta,
// em aberto vencidos, notas sem financeiro, borderôs pendentes, desvios do orçamento) e resumo do mês para a direção.
// Só lê dados — nada aqui altera lançamentos.
import { sb, state, q, fetchAll, loadCadastros, montarMatriz, montarDRE } from '../lib/data.js';
import { $, esc, money, money0, pct, dateBR, fail, MESES } from '../lib/ui.js';

export const title = 'Fechamento do mês';

const mesAnt = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const ui = { mes: mesAnt() };
const fimMes = (m) => { const [a, mm] = m.split('-').map(Number); return new Date(Date.UTC(a, mm, 0)).toISOString().slice(0, 10); };
const TOL_PCT = 10, TOL_VAL = 5000; // mesma tolerância padrão do Controle orçamentário

export async function render(root) {
  root.innerHTML = `
    <div class="card"><div class="card-head" style="margin-bottom:0">
      <div><h2 style="margin:0">Fechamento do mês</h2><p class="muted small" style="margin:4px 0 0">Cada etapa é conferida automaticamente com os dados do sistema. Verde = pronto; vermelho = falta resolver (o link leva à tela certa).</p></div>
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
}

async function conferir(mes) {
  await loadCadastros();
  const e = state.empresa.id, ini = `${mes}-01`, fim = fimMes(mes), ano = +mes.slice(0, 4), m = +mes.slice(5, 7);
  const cad = state.cad;
  const [ext, imps, semConta, abertos, notas, props, mov, orc, just, saldos, matriz] = await Promise.all([
    fetchAll(() => sb.from('extrato_itens').select('id,conta_id,status,valor').eq('empresa_id', e).gte('data', ini).lte('data', fim).order('id')),
    q(sb.from('extrato_importacoes').select('conta_id,dt_fim').eq('empresa_id', e)),
    fetchAll(() => sb.from('lancamentos').select('id,data,valor').eq('empresa_id', e).eq('status', 'Pago').is('conta_id', null).lte('data', fim).order('id')),
    fetchAll(() => sb.from('v_lancamentos').select('id,data,valor_sinal,tipo').eq('empresa_id', e).eq('status', 'Em aberto').lte('data', fim).order('id')),
    fetchAll(() => sb.from('nfe_notas').select('id,numero,situacao,finalidade,v_nf,p:nfe_parcelas(id),v:nfe_vinculos(id),f:nfe_fidc_vinculos(id)').eq('empresa_id', e).eq('tipo', 'saida').gte('emissao', ini).lte('emissao', fim).order('numero')).catch(() => null),
    q(sb.from('fidc_propostas').select('id,numero,status,data_operacao,valor_face').eq('empresa_id', e).eq('status', 'Pendente').gte('data_operacao', ini).lte('data_operacao', fim)).catch(() => []),
    q(sb.rpc('orcamento_movimento', { p_empresa: e, p_ano: ano })).catch(() => null),
    fetchAll(() => sb.from('orcamentos').select('plano_id,mes,valor,cenario').eq('empresa_id', e).eq('ano', ano).eq('cenario', 'budget').eq('mes', m).order('plano_id')).catch(() => []),
    q(sb.from('orcamento_justificativas').select('plano_id,mes,origem').eq('empresa_id', e).eq('ano', ano).eq('mes', m)).catch(() => []),
    q(sb.rpc('saldos_contas', { p_empresa: e, p_ate: fim })),
    // sem os filtros globais da barra (conta, grupo…): o fechamento é sempre da empresa toda
    q(sb.rpc('resumo_mensal', { p_empresa: e, p_ano: ano, p_status: ['Pago'], p_conta: null, p_grupo: null, p_cc: null, p_favorecido: null, p_disp: null })).then(rows => montarMatriz(rows.map(r => ({ plano_id: r.plano_id, mes: r.mes, total: +r.total })))),
  ]);

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
    const vendas = notas.filter(n => n.situacao === 'autorizada' && n.finalidade === '1' && n.p?.length);
    const sem = vendas.filter(n => !n.v?.length && !n.f?.length);
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
    const orcM = new Map(); for (const o of orc) orcM.set(o.plano_id, (orcM.get(o.plano_id) || 0) + +o.valor);
    const justif = new Set(just.map(j => j.plano_id));
    const desv = [];
    for (const pid of new Set([...real.keys(), ...orcM.keys()])) {
      const p = cad.planoById[pid]; if (!p || p.nivel !== 2 || !'ES'.includes(p.tipo)) continue;
      const r = real.get(pid) || 0, o = orcM.get(pid) || 0, dv = p.tipo === 'S' ? r - o : o - r;
      if (dv > Math.max(TOL_VAL, TOL_PCT / 100 * Math.abs(o))) desv.push({ p, dv, j: justif.has(pid) });
    }
    const falta = desv.filter(d => !d.j).sort((a, b) => b.dv - a.dv);
    etapas.push({ k: 'orc', titulo: 'Desvios do orçamento justificados', ok: !falta.length, link: '#/controle-orcamento', acao: 'Abrir Controle orçamentário',
      resumo: !desv.length ? 'Nenhuma conta fora da tolerância (10% ou R$ 5.000) no mês.' : `${desv.length} conta(s) fora da tolerância${falta.length ? `, <strong>${falta.length} sem justificativa</strong>: ${falta.slice(0, 6).map(d => `${esc(d.p.codigo)} ${esc(d.p.nome)} (${money0(d.dv)})`).join('; ')}${falta.length > 6 ? '…' : ''}` : ', todas justificadas'}.`,
      obs: 'Usa os lançamentos pagos do mês: o resultado muda conforme a conciliação avança.' });
  }

  // Resumo do mês (realizado)
  const { val } = montarDRE(matriz);
  const i = m - 1, recB = val.receita_bruta[i];
  const disp = saldos.filter(s => s.disponibilidade === 'Conta com recursos disponíveis');
  const resumo = { recB, ebitda: val.ebitda[i], resultado: val.resultado[i], ent: matriz.tipo.E[i], sai: matriz.tipo.S[i], saldo: disp.reduce((s, x) => s + +x.saldo_pago, 0), saldos: disp.filter(x => Math.abs(+x.saldo_pago) > 0.005) };
  return { mes, ini, fim, etapas, resumo };
}

function pintar(c, R) {
  const ok = R.etapas.filter(x => x.ok).length, tot = R.etapas.length, [a, mm] = R.mes.split('-');
  const nomeMes = `${MESES[+mm - 1].charAt(0)}${MESES[+mm - 1].slice(1).toLowerCase()}/${a}`;
  const S = R.resumo;
  c.innerHTML = `
    <div class="kpis">
      <div class="kpi"><div class="k-label">Fechamento de ${esc(nomeMes)}</div><div class="k-value ${ok === tot ? 'pos' : ''}">${ok} de ${tot}</div><div class="k-sub">${ok === tot ? 'mês pronto para fechar' : `${tot - ok} etapa(s) pendente(s)`}</div></div>
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
        <td class="noprint">${x.ok ? '' : `<a class="btn small" href="${x.link}">${esc(x.acao)}</a>`}</td></tr>`).join('')}
    </tbody></table></div></div>
    ${S.saldos.length ? `<div class="card flush"><div style="padding:12px 12px 0"><h2 style="margin:0">Saldos em ${dateBR(R.fim)}</h2><p class="muted small" style="margin:4px 0 0">Saldo pelo sistema em cada conta com recursos disponíveis (lançamentos pagos até o fim do mês).</p></div>
      <div class="table-wrap"><table><thead><tr><th>Conta</th><th class="num">Saldo</th></tr></thead><tbody>
      ${S.saldos.map(s => `<tr><td>${esc(s.nome)}</td><td class="num ${+s.saldo_pago < 0 ? 'neg' : ''}">${money(s.saldo_pago)}</td></tr>`).join('')}
      <tr class="row-total"><td>TOTAL</td><td class="num">${money(S.saldo)}</td></tr></tbody></table></div></div>` : ''}
    <p class="muted small">Conferido em ${new Date().toLocaleString('pt-BR')} · ${esc(state.empresa.nome || '')}</p>`;
}
