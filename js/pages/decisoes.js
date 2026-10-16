// Decision Center: recomendações da semana calculadas com regras explícitas sobre os dados da plataforma (sem IA).
// Cada recomendação mostra o motivo, o impacto estimado, a urgência, a regra usada e a ação.
import { sb, state, q, fetchAll, temArea } from '../lib/data.js';
import { $, $$, esc, money0, pct, dateBR, fail, today } from '../lib/ui.js';

export const title = 'Decision Center';

const addDias = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const ls = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
             set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const URG = { alta: 0, media: 1, baixa: 2 }, URG_TXT = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

async function carregar() {
  const e = state.empresa.id, hoje = today(), ano = +hoje.slice(0, 4), d90 = addDias(hoje, -90);
  const receitas = state.cad.plano.filter(p => p.nivel === 2 && p.codigo.startsWith('1.01')).map(p => p.id);
  const seguro = (p, v) => p.catch(() => v);
  const [rec90, abertosRec, props, fundos, resumo, budget, extratos, semConta, nec] = await Promise.all([
    receitas.length ? fetchAll(() => sb.from('lancamentos').select('favorecido_id,valor').eq('empresa_id', e).eq('status', 'Pago').in('plano_id', receitas).gte('data', d90).not('conta_id', 'is', null).order('id')) : [],
    receitas.length ? fetchAll(() => sb.from('lancamentos').select('id,data,valor,favorecido_id,documento,fidc_proposta_id').eq('empresa_id', e).eq('status', 'Em aberto').in('plano_id', receitas).lt('data', addDias(hoje, -7)).order('id')) : [],
    seguro(fetchAll(() => sb.from('fidc_operacoes').select('fundo,valor_face,custo_total,prazo_medio,data').eq('empresa_id', e).gte('data', d90).order('id')), []),
    Promise.resolve([]),
    q(sb.rpc('resumo_mensal', { p_empresa: e, p_ano: ano, p_status: ['Pago'], p_conta: null, p_grupo: null, p_cc: null, p_favorecido: null, p_disp: null })),
    fetchAll(() => sb.from('orcamentos').select('plano_id,mes,valor').eq('empresa_id', e).eq('cenario', 'budget').eq('ano', ano).order('id')),
    seguro(q(sb.from('extrato_importacoes').select('conta_id,dt_fim').eq('empresa_id', e)), []),
    seguro(fetchAll(() => sb.from('lancamentos').select('valor').eq('empresa_id', e).eq('status', 'Pago').is('conta_id', null).order('id')), []),
    import(`./necessidade-caixa.js?v=${Date.now()}`).then(m => m.resumoNecessidade()).catch(() => null),
  ]);
  // estoque: último espelho do Iniflex × ponto de pedido dos produtos
  const estq = await (async () => {
    const [esp] = await q(sb.from('estoque_espelhos').select('id,data_ref').eq('empresa_id', e).order('data_ref', { ascending: false }).limit(1));
    if (!esp) return null;
    const [prods, itens] = await Promise.all([q(sb.from('produtos').select('id,codigo,descricao,unidade,ponto_pedido').eq('empresa_id', e).eq('ativo', true).not('ponto_pedido', 'is', null)),
      fetchAll(() => sb.from('estoque_espelho_itens').select('codigo,quantidade').eq('espelho_id', esp.id).order('id'))]);
    const sal = {}; for (const i of itens) sal[i.codigo] = (sal[i.codigo] || 0) + +i.quantidade;
    return { data: esp.data_ref, abaixo: prods.filter(p => (sal[p.codigo] || 0) <= +p.ponto_pedido).map(p => ({ ...p, saldo: sal[p.codigo] || 0 })) };
  })().catch(() => null);
  const com = await import('../lib/comercial.js').then(m => m.baseComercial()).catch(() => null);
  return { hoje, ano, rec90, abertosRec, props, fundos, resumo, budget, extratos, semConta, nec, estq, com };
}

// ---------------------------------------------------------------- regras
function regras(D) {
  const c = state.cad, out = [];
  const nomeFav = (id) => c.favById[id]?.nome || '(sem beneficiário)';

  // 1. caixa abaixo do mínimo nas próximas semanas
  if (D.nec?.primeira) out.push({ k: 'caixa-minimo', origem: 'Caixa', urg: 'alta', titulo: 'Cobrir a falta de caixa prevista',
    desc: `A projeção fica abaixo do mínimo de ${money0(D.nec.minimo)} a partir da semana de ${dateBR(D.nec.primeira.ini)}; o menor saldo previsto é ${money0(D.nec.pior.saldo)}.`,
    impacto: D.nec.primeira.falta, impactoTxt: `${money0(D.nec.primeira.falta)} na 1ª semana`, regra: 'Necessidade de caixa (13 semanas) com as contas e o mínimo escolhidos na tela.',
    acao: 'Abrir necessidade de caixa', rota: 'necessidade-caixa' });

  // 2. recebimentos pagos sem conta
  if (D.semConta.length) { const v = D.semConta.reduce((t, l) => t + +l.valor, 0);
    out.push({ k: 'pago-sem-conta', origem: 'Financeiro', urg: 'alta', titulo: 'Identificar lançamentos pagos sem conta bancária',
      desc: `${D.semConta.length} lançamento(s) estão como pagos, mas sem conta. Eles não entram em nenhum saldo e podem ser baixa em duplicidade, cheque ou título liquidado no FIDC.`,
      impacto: v, impactoTxt: money0(v), regra: 'Lançamentos com status Pago e sem conta bancária.', acao: 'Abrir lançamentos', rota: 'lancamentos' }); }

  // 3. cobrar os vencidos de maior valor
  const venc = D.abertosRec.filter(l => !l.fidc_proposta_id).sort((a, b) => b.valor - a.valor);
  if (venc.length) { const top = venc.slice(0, 5), v = top.reduce((t, l) => t + +l.valor, 0), tot = venc.reduce((t, l) => t + +l.valor, 0);
    out.push({ k: 'cobrar-vencidos', origem: 'Financeiro', urg: tot > 100000 ? 'alta' : 'media', titulo: 'Cobrar os títulos vencidos de maior valor',
      desc: `${venc.length} título(s) a receber vencidos há mais de 7 dias (${money0(tot)}). Os 5 maiores: ${top.map(l => `${nomeFav(l.favorecido_id)} ${money0(l.valor)}${l.documento ? ' (NF ' + l.documento + ')' : ''}`).join(' · ')}.`,
      impacto: v, impactoTxt: `${money0(v)} nos 5 maiores`, regra: 'Receitas (1.01) em aberto, vencidas há mais de 7 dias, fora de proposta de borderô.', acao: 'Abrir contas a receber', rota: 'abertos' }); }

  // 4. concentração de clientes (últimos 90 dias)
  const porCli = {}; let totRec = 0;
  for (const l of D.rec90) { porCli[l.favorecido_id] = (porCli[l.favorecido_id] || 0) + +l.valor; totRec += +l.valor; }
  const rank = Object.entries(porCli).filter(([id]) => id !== 'null').sort((a, b) => b[1] - a[1]);
  if (rank.length && totRec) {
    const [id, v] = rank[0], p = v / totRec, top5 = rank.slice(0, 5).reduce((t, x) => t + x[1], 0) / totRec;
    if (p > 0.2 || top5 > 0.6) out.push({ k: 'concentracao', origem: 'Comercial', urg: p > 0.3 ? 'alta' : 'media', titulo: 'Reduzir a dependência dos maiores clientes',
      desc: `${nomeFav(id)} respondeu por ${pct(p)} dos recebimentos dos últimos 90 dias; os 5 maiores clientes somam ${pct(top5)}.`,
      impacto: v, impactoTxt: `${money0(v)} do maior cliente`, regra: 'Recebimentos pagos de receitas (1.01) nos últimos 90 dias; alerta se o maior passar de 20% ou os 5 maiores de 60%.',
      acao: 'Abrir beneficiários', rota: 'cadastros/favorecidos' }); }

  // 5. fundo FIDC mais barato
  const fun = {};
  for (const p of D.props) { if (!p.valor_face || !p.prazo_medio) continue; const f = (fun[p.fundo] ||= { face: 0, custo30: 0 }); f.face += +p.valor_face; f.custo30 += +p.custo_total / +p.prazo_medio * 30; }
  const fl = Object.entries(fun).filter(([, f]) => f.face > 0).map(([id, f]) => ({ id, nome: id, face: f.face, taxa: f.custo30 / f.face }));
  if (fl.length >= 2) {
    const tot = fl.reduce((t, f) => t + f.face, 0), media = fl.reduce((t, f) => t + f.taxa * f.face, 0) / tot, barato = fl.reduce((a, f) => (f.taxa < a.taxa ? f : a), fl[0]);
    const ganho = (media - barato.taxa) * tot / 3;   // por mês, se o volume médio mensal fosse ao fundo mais barato
    if (media - barato.taxa > 0.001) out.push({ k: 'fidc-barato', origem: 'FIDC', urg: ganho > 20000 ? 'media' : 'baixa', titulo: `Priorizar ${barato.nome} nas antecipações`,
      desc: `Nos últimos 90 dias o custo médio das antecipações foi ${pct(media, 2)} a cada 30 dias; ${barato.nome} saiu por ${pct(barato.taxa, 2)}. ${fl.sort((a, b) => a.taxa - b.taxa).map(f => `${f.nome} ${pct(f.taxa, 2)}`).join(' · ')}.`,
      impacto: ganho, impactoTxt: `até ${money0(ganho)}/mês`, regra: 'Borderôs operados nos últimos 90 dias: custo total ÷ prazo médio × 30 ÷ valor de face, por fundo. O ganho supõe que o fundo aceite o volume.',
      acao: 'Abrir propostas de borderô', rota: 'fidc-propostas' }); }

  // 6. despesas acima do orçado (acumulado até o último mês fechado)
  const mesAt = +D.hoje.slice(5, 7), ultimo = mesAt - 1;
  if (ultimo >= 1) {
    const real = {}, orc = {};
    for (const r of D.resumo) if (r.mes <= ultimo) real[r.plano_id] = (real[r.plano_id] || 0) + +r.total;
    for (const o of D.budget) if (o.mes <= ultimo) orc[o.plano_id] = (orc[o.plano_id] || 0) + +o.valor;
    const est = c.plano.filter(p => p.nivel === 2 && p.tipo === 'S').map(p => ({ p, r: Math.abs(real[p.id] || 0), o: Math.abs(orc[p.id] || 0) }))
      .filter(x => x.o > 0 && x.r > x.o * 1.1 && x.r - x.o > 5000).sort((a, b) => (b.r - b.o) - (a.r - a.o));
    if (est.length) { const v = est.reduce((t, x) => t + x.r - x.o, 0);
      out.push({ k: 'orcamento', origem: 'Orçamento', urg: v > 200000 ? 'alta' : 'media', titulo: 'Rever as despesas acima do orçamento',
        desc: `${est.length} classificação(ões) gastaram mais de 10% acima do budget até ${String(ultimo).padStart(2, '0')}/${D.ano}. Maiores: ${est.slice(0, 4).map(x => `${x.p.nome} +${money0(x.r - x.o)} (${pct(x.r / x.o - 1, 0)})`).join(' · ')}.`,
        impacto: v, impactoTxt: `${money0(v)} acima`, regra: 'Realizado pago × budget acumulado do ano até o último mês fechado; só desvios acima de 10% e de R$ 5.000.',
        acao: 'Abrir controle orçamentário', rota: 'controle-orcamento' }); }
  }

  // 7. recompras de títulos subindo
  const recPl = c.plano.filter(p => p.nivel === 2 && /recompra/i.test(p.nome)).map(p => p.id);
  if (recPl.length && ultimo >= 4) {
    const m = Array(12).fill(0); for (const r of D.resumo) if (recPl.includes(r.plano_id)) m[r.mes - 1] += Math.abs(+r.total);
    const ult = m[ultimo - 1], med3 = (m[ultimo - 2] + m[ultimo - 3] + m[ultimo - 4]) / 3;
    if (ult > 10000 && med3 > 0 && ult > med3 * 1.3) out.push({ k: 'recompras', origem: 'FIDC', urg: 'media', titulo: 'Investigar o aumento das recompras',
      desc: `As recompras de títulos somaram ${money0(ult)} no último mês fechado, contra média de ${money0(med3)} nos três anteriores (+${pct(ult / med3 - 1, 0)}). Recompra indica cliente que não pagou o título antecipado.`,
      impacto: ult - med3, impactoTxt: `+${money0(ult - med3)} no mês`, regra: 'Classificações com "recompra" no nome; último mês fechado × média dos 3 anteriores; alerta acima de +30%.',
      acao: 'Abrir análise FIDC', rota: 'fidc' }); }

  // 8. extratos parados
  const ultExt = {}; for (const x of D.extratos) if (x.dt_fim && (!ultExt[x.conta_id] || x.dt_fim > ultExt[x.conta_id])) ultExt[x.conta_id] = x.dt_fim;
  const parados = c.contas.filter(ct => ct.ativo && (ct.ofx_conta || ultExt[ct.id]) && (!ultExt[ct.id] || ultExt[ct.id] < addDias(D.hoje, -5)));
  if (parados.length) out.push({ k: 'extratos', origem: 'Conciliação', urg: 'media', titulo: 'Importar os extratos parados',
    desc: `Sem extrato há mais de 5 dias: ${parados.map(ct => `${ct.nome} (${ultExt[ct.id] ? 'até ' + dateBR(ultExt[ct.id]) : 'nunca'})`).join(' · ')}. Sem extrato não há conciliação nem saldo confiável.`,
    impacto: 0, impactoTxt: `${parados.length} conta(s)`, regra: 'Contas com OFX configurado cuja última importação termina há mais de 5 dias.', acao: 'Abrir conciliação', rota: 'conciliacao' });

  // 9. cadastros sem CNPJ/CPF
  const semDoc = c.favorecidos.filter(f => f.ativo && ['CLIENTES', 'FORNECEDORES'].includes(f.tipo) && !String(f.documento || '').replace(/\D/g, ''));
  if (semDoc.length) out.push({ k: 'cadastro-doc', origem: 'Cadastro', urg: 'baixa', titulo: 'Completar CNPJ/CPF dos beneficiários',
    desc: `${semDoc.length} cliente(s) e fornecedor(es) ativos sem CNPJ/CPF. Sem documento a nota fiscal, o endosso e a contabilidade não casam com o cadastro. Ex.: ${semDoc.slice(0, 5).map(f => f.nome).join(', ')}.`,
    impacto: 0, impactoTxt: `${semDoc.length} cadastro(s)`, regra: 'Beneficiários ativos do tipo cliente ou fornecedor com documento vazio.', acao: 'Abrir beneficiários', rota: 'cadastros/favorecidos' });

  // 10. estoque abaixo do ponto de pedido (espelho do Iniflex)
  if (D.estq?.abaixo.length) { const ab = D.estq.abaixo;
    out.push({ k: 'ponto-pedido', origem: 'Estoque', urg: ab.some(p => p.saldo <= 0) ? 'alta' : 'media', titulo: 'Repor os itens abaixo do ponto de pedido',
      desc: `${ab.length} produto(s) no ponto de pedido ou abaixo na posição do Iniflex de ${dateBR(D.estq.data)}: ${ab.slice(0, 5).map(p => `${p.codigo} ${p.descricao} (${p.saldo.toLocaleString('pt-BR')} ${p.unidade})`).join(' · ')}${ab.length > 5 ? '…' : ''}.`,
      impacto: 0, impactoTxt: `${ab.length} item(ns)`, regra: 'Saldo do último espelho do Iniflex (soma dos depósitos) menor ou igual ao ponto de pedido do cadastro. Em Posição de estoque há o botão que gera a requisição.',
      acao: 'Abrir posição de estoque', rota: 'estoque' }); }

  // 11. clientes esfriando (NF-e de saída)
  if (D.com) { const esf = Object.values(D.com.info).filter(c => c.st === 'esfriando').sort((a, b) => b.v12 - a.v12);
    if (esf.length) { const v = esf.reduce((t, c) => t + c.v12, 0);
      out.push({ k: 'clientes-esfriando', origem: 'Comercial', urg: v > 500000 ? 'alta' : 'media', titulo: 'Ligar para os clientes que estão esfriando',
        desc: `${esf.length} cliente(s) sem comprar há mais de 1,5× o intervalo normal deles. Maiores: ${esf.slice(0, 5).map(c => `${c.nome} (${c.desde} dias; ${money0(c.v12)} em 12 meses)`).join(' · ')}.`,
        impacto: v, impactoTxt: `${money0(v)} em 12 meses`, regra: 'Pelas NF-e de venda dos últimos 2 anos: dias desde a última compra > 1,5 × intervalo médio entre compras do cliente (mínimo 20 dias) e menos de 180 dias.',
        acao: 'Abrir carteira', rota: 'comercial/carteira' }); } }

  return out.sort((a, b) => URG[a.urg] - URG[b.urg] || b.impacto - a.impacto);
}

export async function render(root) {
  if (!temArea('fin') || state.papel === 'compras') { root.innerHTML = '<div class="card"><p>O Decision Center usa os dados do Financeiro.</p></div>'; return; }
  root.innerHTML = '<div class="loading">Calculando as recomendações…</div>';
  let D; try { D = await carregar(); } catch (e) { fail(e); root.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; return; }
  const todas = regras(D);
  const ui = { origem: '', urg: '', adiadas: false };
  const adiadas = () => { const a = ls.get('dc-adiadas', {}), h = today(); for (const k of Object.keys(a)) if (a[k] < h) delete a[k]; ls.set('dc-adiadas', a); return a; };
  const pintar = () => {
    const ad = adiadas();
    const vis = todas.filter(r => (!ui.origem || r.origem === ui.origem) && (!ui.urg || r.urg === ui.urg) && (ui.adiadas ? ad[r.k] : !ad[r.k]));
    const origens = [...new Set(todas.map(r => r.origem))];
    root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Recomendações da semana</h2><div class="muted small">Calculadas agora com regras fixas sobre os dados da plataforma. Clique em "Como foi calculado" para ver a regra de cada uma.</div></div>
        <button class="btn ghost small" id="dc-at">Recalcular</button></div>
      <div class="kpis">${origens.map(o => { const n = todas.filter(r => r.origem === o && !ad[r.k]).length;
        return `<div class="kpi clickable ${ui.origem === o ? 'on' : ''}" data-o="${esc(o)}"><div class="k-label">${esc(o)}</div><div class="k-value">${n}</div><div class="k-sub">${todas.filter(r => r.origem === o && r.urg === 'alta' && !ad[r.k]).length} alta(s)</div></div>`; }).join('')}</div>
      <div class="toolbar card" style="margin-top:12px"><label>Urgência<select id="dc-urg"><option value="">Todas</option>${Object.entries(URG_TXT).map(([k, v]) => `<option value="${k}" ${ui.urg === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" id="dc-ad" ${ui.adiadas ? 'checked' : ''}> Ver as adiadas (${Object.keys(ad).length})</label>
        ${ui.origem ? `<button class="btn ghost small" id="dc-lim">Mostrar todas as origens</button>` : ''}</div>
      <div class="dc-lista">${vis.map(r => `<div class="card dc-rec">
        <div class="dc-cab"><span class="badge ${r.urg === 'alta' ? 'vencido' : r.urg === 'media' ? 'aberto' : ''}">${URG_TXT[r.urg]}</span><span class="badge">${esc(r.origem)}</span><span class="dc-imp">${esc(r.impactoTxt)}</span></div>
        <h3 style="margin:6px 0 4px">${esc(r.titulo)}</h3><p style="margin:0 0 8px">${esc(r.desc)}</p>
        <details class="small muted"><summary>Como foi calculado</summary>${esc(r.regra)}</details>
        <div class="dc-acoes"><button class="btn primary small" data-ir="${r.rota}">${esc(r.acao)}</button>
          ${ad[r.k] ? `<button class="btn ghost small" data-vol="${r.k}">Trazer de volta</button>` : `<button class="btn ghost small" data-adia="${r.k}">Adiar 7 dias</button>`}</div></div>`).join('')
        || `<div class="card"><div class="empty">${ui.adiadas ? 'Nenhuma recomendação adiada.' : 'Nenhuma recomendação com esses filtros.'}</div></div>`}</div>`;
    $('#dc-at', root).onclick = () => render(root);
    $$('[data-o]', root).forEach(el => el.onclick = () => { ui.origem = ui.origem === el.dataset.o ? '' : el.dataset.o; pintar(); });
    $('#dc-lim', root) && ($('#dc-lim', root).onclick = () => { ui.origem = ''; pintar(); });
    $('#dc-urg', root).onchange = (e) => { ui.urg = e.target.value; pintar(); };
    $('#dc-ad', root).onchange = (e) => { ui.adiadas = e.target.checked; pintar(); };
    $$('[data-ir]', root).forEach(b => b.onclick = () => { location.hash = '#/' + b.dataset.ir; });
    $$('[data-adia]', root).forEach(b => b.onclick = () => { const a = adiadas(); a[b.dataset.adia] = addDias(today(), 7); ls.set('dc-adiadas', a); pintar(); });
    $$('[data-vol]', root).forEach(b => b.onclick = () => { const a = adiadas(); delete a[b.dataset.vol]; ls.set('dc-adiadas', a); pintar(); });
  };
  pintar();
}
