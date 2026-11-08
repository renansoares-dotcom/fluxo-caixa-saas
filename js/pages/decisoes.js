// Central de Decisões (antigo Decision Center + Decisão do Dia, melhoria 2.3, SQL 103): abas Alertas, Pagamentos do dia,
// Saúde da empresa e Histórico. Alertas calculados com regras explícitas sobre os dados da plataforma (sem IA): motivo,
// impacto, urgência, regra e ação; cada um pode ser resolvido, adiado ou delegado, e tudo fica no histórico.
import { sb, state, q, fetchAll, temArea, isAdmin } from '../lib/data.js';
import { $, $$, esc, money0, pct, dateBR, fail, today, toast, modal } from '../lib/ui.js';
import { AREAS, estado, assinatura, saude, faixa, FAIXA, PESOS_PADRAO } from '../lib/decisoes-calc.js';

export const title = 'Central de Decisões';

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
    seguro(q(sb.from('extrato_importacoes').select('conta_id,dt_fim').eq('empresa_id', e)).then(async (x) => { x.cfg = (await q(sb.from('conc_config').select('alerta_dias,contas_sem_alerta').eq('empresa_id', e)).catch(() => []))[0] || null; return x; }), []),
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
  const prorrog = await q(sb.from('portal_prorrogacoes').select('id,valor,solicitado_em').eq('empresa_id', e).eq('status', 'pendente')).catch(() => []);
  // contratos (só administradores): vencimento, aviso prévio e reajuste
  const contratos = isAdmin() ? await (async () => {
    const [C, A, R, K] = await Promise.all([q(sb.from('contratos').select('*').eq('empresa_id', e).eq('status', 'vigente')), q(sb.from('contrato_arquivos').select('contrato_id,tipo').eq('empresa_id', e)),
      q(sb.from('contrato_reajustes').select('contrato_id,data_base,status,percentual').eq('empresa_id', e)), import('../lib/contratos.js')]);
    return C.map(c => ({ c, al: K.alertas(c, A.filter(a => a.contrato_id === c.id), R.filter(r => r.contrato_id === c.id), hoje).filter(a => a.nivel !== 'info'), mensal: K.valorMensal(c) })).filter(x => x.al.length);
  })().catch(() => []) : [];
  const frota = await import(`./frota.js?v=${Date.now()}`).then(m => m.alertasDecisao()).catch(() => []);
  const cedida = await import(`./fidc-carteira.js?v=${Date.now()}`).then(m => m.alertasDecisao()).catch(() => []);
  const ndeb = await import(`./fiscal-notas-debito.js?v=${Date.now()}`).then(m => m.alertasDecisao()).catch(() => []);
  const imob = temArea('cont') ? await import(`./imobilizado.js?v=${Date.now()}`).then(m => m.alertasDecisao()).catch(() => []) : [];
  const tint = temArea('prd') ? await import(`./tintas.js?v=${Date.now()}`).then(m => m.alertasDecisao()).catch(() => []) : [];
  const qual = temArea('prd') ? await import(`./qualidade.js?v=${Date.now()}`).then(m => m.alertasDecisao()).catch(() => []) : [];
  const recomp = temArea('fin') ? await import(`./fidc-recompras.js?v=${Date.now()}`).then(m => m.alertasDecisao()).catch(() => []) : [];
  const paPrest = temArea('fin') ? await import(`../lib/pa-prestacao.js?v=${Date.now()}`).then(m => m.alertasDecisao()).catch(() => []) : [];
  const audAl = await import(`./auditoria.js?v=${Date.now()}`).then(m => m.alertasDecisao()).catch(() => []);
  const lgpd = await import(`./lgpd.js?v=${Date.now()}`).then(m => m.alertasDecisao()).catch(() => []);
  const arte = temArea('com') || temArea('prd') ? await import(`./preimpressao.js?v=${Date.now()}`).then(m => m.alertasDecisao()).catch(() => []) : [];
  const manut = temArea('prd') ? await import(`./manutencao.js?v=${Date.now()}`).then(m => m.alertasDecisao()).catch(() => []) : [];
  return { hoje, ano, rec90, abertosRec, props, fundos, resumo, budget, extratos, semConta, nec, estq, com, prorrog, contratos, frota, cedida, ndeb, imob, manut, qual, tint, arte, recomp, paPrest, audAl, lgpd };
}

// ---------------------------------------------------------------- regras
function regras(D) {
  const c = state.cad, out = [];
  const nomeFav = (id) => c.favById[id]?.nome || '(sem beneficiário)';

  // 1. caixa abaixo do mínimo nas próximas semanas
  if (D.nec?.primeira) out.push({ k: 'caixa-minimo', origem: 'Caixa', urg: 'alta', titulo: 'Cobrir a falta de caixa prevista',
    desc: `No cenário ${D.nec.cenario || 'Base'}, a projeção fica abaixo do mínimo de ${money0(D.nec.minimo)} a partir da semana de ${dateBR(D.nec.primeira.ini)}; o menor saldo previsto é ${money0(D.nec.pior.saldo)}.`,
    impacto: D.nec.primeira.falta, impactoTxt: `${money0(D.nec.primeira.falta)} na 1ª semana`, regra: 'Necessidade de caixa com o cenário do alerta, as contas, o mínimo e o horizonte dos Parâmetros da tela.',
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
  const cExt = D.extratos.cfg || {}, diasExt = +(cExt.alerta_dias ?? 5), semAlerta = new Set(cExt.contas_sem_alerta || []);
  const parados = c.contas.filter(ct => ct.ativo && !semAlerta.has(ct.id) && (ct.ofx_conta || ultExt[ct.id]) && (!ultExt[ct.id] || ultExt[ct.id] < addDias(D.hoje, -diasExt)));
  if (parados.length) out.push({ k: 'extratos', origem: 'Conciliação', urg: 'media', titulo: 'Importar os extratos parados',
    desc: `Sem extrato há mais de ${diasExt} dia(s): ${parados.map(ct => `${ct.nome} (${ultExt[ct.id] ? 'até ' + dateBR(ultExt[ct.id]) : 'nunca'})`).join(' · ')}. Sem extrato não há conciliação nem saldo confiável.`,
    impacto: 0, impactoTxt: `${parados.length} conta(s)`, regra: 'Contas com extrato (OFX, CNAB ou relatório) cuja última importação termina há mais dias que o parâmetro da conciliação (padrão 5); contas dispensadas em Conciliação › Extratos por conta não entram.', acao: 'Abrir conciliação', rota: 'conciliacao' });

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

  // 12. pedidos de prorrogação do Portal do Cliente aguardando
  if (D.prorrog?.length) { const v = D.prorrog.reduce((t, p) => t + +p.valor, 0);
    out.push({ k: 'portal-prorrogacao', origem: 'Financeiro', urg: D.prorrog.some(p => p.solicitado_em < addDias(D.hoje, -2)) ? 'alta' : 'media', titulo: 'Responder os pedidos de prorrogação dos clientes',
      desc: `${D.prorrog.length} pedido(s) feitos pelo Portal do Cliente aguardando resposta. O cliente vê a decisão no portal.`, impacto: v, impactoTxt: money0(v),
      regra: 'Pedidos com situação pendente em Portal do Cliente; urgência alta se algum tem mais de 2 dias.', acao: 'Abrir Portal do Cliente', rota: 'portal-clientes' }); }

  // 13. contratos com vencimento, aviso prévio ou reajuste a tratar
  if (D.contratos?.length) { const v = D.contratos.reduce((t, x) => t + x.mensal * 12, 0);
    out.push({ k: 'contratos', origem: 'Contratos', urg: D.contratos.some(x => x.al.some(a => a.nivel === 'neg')) ? 'alta' : 'media', titulo: 'Tratar os contratos com prazo ou reajuste',
      desc: D.contratos.slice(0, 5).map(x => `nº ${x.c.numero} ${x.c.parte_nome}: ${x.al.map(a => a.txt.toLowerCase()).join('; ')}`).join(' · ') + (D.contratos.length > 5 ? ` · e mais ${D.contratos.length - 5}` : ''),
      impacto: v, impactoTxt: `${money0(v)} por ano`, regra: 'Contratos vigentes vencendo em até 90 dias, com aviso prévio em até 30 dias ou com reajuste na data-base (até 30 dias) ou para aprovar.',
      acao: 'Abrir contratos', rota: 'contratos' }); }

  // 16. notas de débito de juros/multa a emitir (reforma tributária)
  for (const a of D.ndeb || []) out.push({ k: 'nota-debito', origem: 'Fiscal', urg: 'alta', titulo: 'Emitir as notas de débito de juros e multa recebidos',
    desc: `${a.n} recebimento(s) com juros/multa (${money0(a.valor)}) ainda sem NF-e de débito${a.atrasadas ? `; ${a.atrasadas} há mais de 5 dias` : ''}. A nota de débito (finalidade 6, tipo 04) é emitida no dia do recebimento e referencia a nota de origem (LC 214/2025, art. 12, § 1º, II).`,
    impacto: a.valor, impactoTxt: money0(a.valor), regra: 'Lançamentos em 1.02.17 JUROS E MULTAS RECEBIDOS sem nota de débito emitida.', acao: 'Abrir notas de débito', rota: 'fiscal/notas-debito' });

  // 15. títulos cedidos vencidos sem liquidação informada pelo fundo (risco de recompra)
  for (const a of D.cedida || []) out.push({ k: 'fidc-sem-liquidacao', origem: 'FIDC', urg: a.valor > 50000 ? 'alta' : 'media', titulo: 'Conferir títulos cedidos vencidos sem liquidação',
    desc: `${a.n} título(s) cedidos a ${a.fundos.join(', ')} venceram e o relatório de pagos do fundo, que já vai mais de 3 dias úteis além do vencimento, não trouxe o pagamento (${money0(a.valor)}). Maiores: ${a.maiores.map(i => `${i.titulo} ${i.sacado || ''} ${money0(i.valor)}`).join(' · ')}. Importe o relatório de pagos do fundo ou cobre o cliente antes da recompra.`,
    impacto: a.valor, impactoTxt: money0(a.valor), regra: 'Títulos da base FIDC sem liquidação no relatório de pagos do fundo, quando o relatório cobre o vencimento + 3 dias úteis. Fundos sem relatório importado não entram.', acao: 'Abrir carteira cedida', rota: 'fidc-carteira' });

  // 14. frota: documentos, preventivas, motoristas e multas
  const fr = (D.frota || []).filter(a => a.nivel === 'neg' || a.nivel === 'warn');
  if (fr.length) out.push({ k: 'frota', origem: 'Logística', urg: fr.some(a => a.nivel === 'neg') ? 'alta' : 'media', titulo: 'Regularizar a frota e os motoristas',
    desc: fr.slice(0, 5).map(a => `${a.origem}: ${a.txt}`).join(' · ') + (fr.length > 5 ? ` · e mais ${fr.length - 5}` : ''), impacto: 0, impactoTxt: `${fr.length} pendência(s)`,
    regra: 'Documentos vencendo em até 60 dias, preventivas no limite, CNH/toxicológico/MOPP vencendo, consumo fora da média e multas com prazo de indicação em até 7 dias.',
    acao: 'Abrir gestão da frota', rota: 'logistica/gestao-frota' });

  // 17. ativo imobilizado: depreciação do mês, contas das classes, compras a imobilizar e inventário físico
  const im = D.imob || [];
  if (im.length) out.push({ k: 'imobilizado', origem: 'Contabilidade', urg: im.some(a => a.nivel === 'warn') ? 'media' : 'baixa', titulo: 'Manter o ativo imobilizado em dia',
    desc: im.map(a => a.txt).join(' · '), impacto: 0, impactoTxt: `${im.length} ponto(s)`,
    regra: 'Depreciação do mês anterior calculada, classes com bens ligadas às contas contábeis, compras do ano (NF-e, lançamentos, máquinas e veículos) imobilizadas e inventário físico concluído nos últimos 12 meses.',
    acao: 'Abrir ativo imobilizado', rota: 'contab/imobilizado' });

  // 18. manutenção industrial: emergências, OS atrasadas, peça parada há dias e preventivas vencidas sem OS
  const mn = D.manut || [];
  if (mn.length) out.push({ k: 'manutencao', origem: 'Manutenção', urg: mn.some(a => a.nivel === 'neg') ? 'alta' : 'media', titulo: 'Destravar a manutenção das máquinas',
    desc: mn.map(a => a.txt).join(' · '), impacto: 0, impactoTxt: `${mn.length} ponto(s)`,
    regra: 'OS de emergência aberta, OS atrasada (preventiva além do vencimento, emergência há mais de 24 h, alta há mais de 72 h), OS aguardando peça há mais de 3 dias e plano preventivo vencido sem OS. Máquina parada é produção perdida.',
    acao: 'Abrir painel de manutenção', rota: 'manutencao' });

  // 19. qualidade: máquina aguardando liberação, inspeção fora do prazo, material em quarentena, RNC vencida ou sem disposição, IQF abaixo da meta
  const ql = D.qual || [];
  if (ql.length) out.push({ k: 'qualidade', origem: 'Qualidade', urg: ql.some(a => a.nivel === 'neg') ? 'alta' : 'media', titulo: 'Destravar a qualidade',
    desc: ql.map(a => a.txt).join(' · '), impacto: 0, impactoTxt: `${ql.length} ponto(s)`,
    regra: 'Inspeção de liberação pendente (máquina aguardando), inspeção fora do prazo, valor parado na quarentena, não conformidade com a ação vencida ou com material sem disposição, fornecedor com 3 lotes ou mais abaixo da meta de IQF e lotes/bobinas bloqueados.',
    acao: 'Abrir painel da qualidade', rota: 'qualidade' });

  // 20. casa de tintas: ordens paradas, tinta em ajuste, sobra vencida ou vencendo, receita em teste há muito tempo
  const tn = D.tint || [];
  if (tn.length) out.push({ k: 'tintas', origem: 'Casa de Tintas', urg: tn.some(a => a.nivel === 'neg') ? 'alta' : 'media', titulo: 'Organizar a casa de tintas',
    desc: tn.map(a => a.txt).join(' · '), impacto: 0, impactoTxt: `${tn.length} ponto(s)`,
    regra: 'Ordem de preparação parada há mais de 24 h, tinta em ajuste de cor ou viscosidade, lote de tinta pronta vencido ou vencendo em 7 dias (usar a sobra mais antiga primeiro) e versão de receita em teste há mais de 15 dias.',
    acao: 'Abrir painel da casa de tintas', rota: 'tintas' });

  // 21. pré-impressão: arte sem resposta do cliente no prazo, OP esperando arte, alteração parada, clichê atrasado, aprovada sem liberar
  const ar = D.arte || [];
  if (ar.length) out.push({ k: 'preimpressao', origem: 'Pré-impressão', urg: ar.some(a => a.nivel === 'alto') ? 'alta' : 'media', titulo: 'Destravar as artes',
    desc: ar.map(a => a.titulo).join(' · '), impacto: 0, impactoTxt: `${ar.length} ponto(s)`,
    regra: 'Arte com o cliente além do prazo de resposta, OP aberta de produto cuja arte mais recente não está aprovada, alteração pedida sem nova versão há 2 dias, clichê além da previsão e arte aprovada há 3 dias sem liberar para a produção.',
    acao: 'Abrir painel da pré-impressão', rota: 'preimpressao' });

  // 22. recompras: título recomprado vencido sem receber; recompra informada pelo fundo ou lançada à mão sem registro;
  //     cliente com taxa de recompra (recomprado ÷ cedido no ano) acima do limite dos parâmetros
  const rc = D.recomp || [];
  if (rc.length) out.push({ k: 'recompras', origem: 'Crédito / FIDC', urg: rc.some(a => a.nivel === 'alto') ? 'alta' : 'media', titulo: 'Cobrar e registrar as recompras',
    desc: rc.map(a => a.titulo + (a.detalhe && /taxa de recompra/.test(a.titulo) ? ` (${a.detalhe})` : '')).join(' · '), impacto: rc.reduce((s, a) => s + (a.valor || 0), 0), impactoTxt: null,
    regra: 'Título que a empresa recomprou do fundo e voltou para a carteira, com vencimento passado e sem recebimento; recompra que aparece no relatório do fundo ou em 2.07.11 sem registro (o título não volta para a carteira e a DRE não sabe o motivo); cliente com taxa de recompra no ano acima do limite dos Parâmetros da recompra (padrão 10%).',
    acao: 'Abrir as recompras', rota: 'fidc-recompras' });

  // 23. prestação de contas do PA: nota fiscal atrasada (prazo da nota vencido), por responsável
  const pp = D.paPrest || [];
  if (pp.length) out.push({ k: 'pa_prestacao', origem: 'Pagamentos', urg: pp.some(a => a.nivel === 'alto') ? 'alta' : 'media', titulo: 'Cobrar as notas fiscais dos pagamentos antecipados',
    desc: pp.map(a => `${a.titulo}: ${a.detalhe}`).join(' · '), impacto: pp.reduce((s, a) => s + (a.valor || 0), 0), impactoTxt: null,
    regra: 'PA pago aguardando nota com o prazo vencido (previsão do pedido, prazo prorrogado ou o prazo padrão dos Parâmetros depois do pagamento). Alta quando o atraso passa do prazo de escalada.',
    acao: 'Abrir a prestação de contas', rota: 'paraquedas' });

  // 24. auditoria: ações sensíveis ainda não vistas (exclusões, dados bancários, usuários, valor pago, travas)
  const aa = D.audAl || [];
  if (aa.length) out.push({ k: 'auditoria', origem: 'Auditoria', urg: aa.some(a => a.nivel === 'alto') ? 'alta' : 'media', titulo: 'Conferir as ações sensíveis',
    desc: aa.map(a => `${a.titulo}: ${a.detalhe}`).join(' · '), impacto: 0, impactoTxt: aa[0].titulo,
    regra: 'Alertas da Auditoria ainda não marcados como vistos (as regras ficam em Auditoria › Alertas › Parâmetros). Alta para dados bancários de beneficiário e usuários. Só para administrador e diretor.',
    acao: 'Abrir os alertas', rota: 'auditoria?aba=alertas' });

  // 25. LGPD e acessos: solicitações de titular com prazo, revisão de acessos vencida e acessos sem uso
  for (const a of D.lgpd || []) out.push({ k: 'lgpd-' + a.aba + a.nivel, origem: 'Privacidade e Acessos', urg: a.nivel === 'alto' ? 'alta' : a.nivel === 'medio' ? 'media' : 'baixa', titulo: a.titulo,
    desc: a.detalhe, impacto: 0, impactoTxt: null,
    regra: 'Solicitações de titulares com o prazo de resposta em até 3 dias ou vencido (LGPD, art. 19), revisão periódica de acessos vencida e pessoas sem entrar perto do prazo de suspensão. Só para o administrador.',
    acao: a.aba === 'solic' ? 'Abrir as solicitações' : 'Abrir a revisão de acessos', rota: `lgpd?aba=${a.aba}` });

  return out.sort((a, b) => URG[a.urg] - URG[b.urg] || b.impacto - a.impacto);
}

const ABAS = [['alertas', 'Alertas'], ['pagamentos', 'Pagamentos do dia'], ['saude', 'Saúde da empresa'], ['historico', 'Histórico']];
const ui = { aba: 'alertas', origem: '', urg: '', ver: 'abertos' };
const podeTratar = () => ['admin', 'diretor', 'financeiro'].includes(state.papel);
const podeParam = () => ['admin', 'diretor'].includes(state.papel);
let cache = null;   // { todas, S (situação), cfg, inds }

export async function render(root) {
  if (!temArea('fin') || ['compras', 'vendas', 'producao'].includes(state.papel)) { root.innerHTML = '<div class="card"><p>A Central de Decisões usa os dados do Financeiro.</p></div>'; return; }
  const prm = new URLSearchParams(location.hash.split('?')[1] || '');
  ui.aba = ABAS.some(([k]) => k === prm.get('aba')) ? prm.get('aba') : 'alertas';
  if (prm.get('minhas')) ui.ver = 'minhas';
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Central de Decisões</h2><div class="muted small">Os alertas da plataforma, a decisão de pagamentos do dia, a saúde da empresa por área e o histórico do que foi decidido.</div></div>
      <div style="display:flex;gap:8px">${podeParam() ? '<button class="btn small" id="dc-par">Parâmetros</button>' : ''}<button class="btn ghost small" id="dc-at">Recalcular</button></div></div>
    <div class="card toolbar"><div class="chips" id="dc-abas">${ABAS.map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-aba="${k}">${t}</span>`).join('')}</div></div>
    <div id="dc-corpo" style="margin-top:12px"><div class="loading">Calculando…</div></div>`;
  $('#dc-abas', root).onclick = (e) => { const k = e.target.closest('[data-aba]')?.dataset.aba; if (k && k !== ui.aba) { history.replaceState(null, '', '#/decisoes?aba=' + k); render(root); } };
  $('#dc-at', root).onclick = () => { cache = null; render(root); };
  $('#dc-par', root) && ($('#dc-par', root).onclick = () => parametros(() => { cache = null; render(root); }));
  const corpo = $('#dc-corpo', root);
  if (ui.aba === 'pagamentos') { const m = await import(`./decisao-dia.js?v=${Date.now()}`); return m.render(corpo); }
  try { cache ||= await base(); } catch (e) { fail(e); corpo.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; return; }
  const re = () => render(root);
  if (ui.aba === 'alertas') return abaAlertas(corpo, re);
  if (ui.aba === 'saude') return abaSaude(corpo, re);
  return abaHistorico(corpo);
}

async function base() {
  const e = state.empresa.id, D = await carregar(), todas = regras(D);
  const [S, cfg, inds] = await Promise.all([
    q(sb.rpc('decisoes_situacao', { p_empresa: e, p_dias: 90 })).catch(() => ({ atual: {}, historico: [], pessoas: [], semSQL: true })),
    q(sb.from('decisoes_config').select('*').eq('empresa_id', e).maybeSingle()).catch(() => null),
    import(`./diretoria.js?v=${Date.now()}`).then(async m => (await m.carregarPainel(m.mesAnterior())).inds).catch(() => []),
  ]);
  const hoje = today();
  for (const r of todas) { r.est = estado(r, S.atual[r.k], hoje); r.ass = assinatura(r); }
  return { todas, S, cfg: cfg || {}, inds, decs: await q(sb.from('decisoes_dia').select('numero,data,status,saldo_fim,criado_em,decidido_em,motivo').eq('empresa_id', e).order('criado_em', { ascending: false }).limit(30)).catch(() => []) };
}

// ---------------------------------------------------------------- Alertas
function abaAlertas(corpo, re) {
  const { todas, S } = cache, eu = state.user?.id;
  const filtroVer = { abertos: (r) => r.est.aberto, minhas: (r) => r.est.k === 'delegado' && r.est.para === eu, resolvidos: (r) => r.est.k === 'resolvido', adiados: (r) => r.est.k === 'adiado' };
  const conta = (k) => todas.filter(filtroVer[k]).length;
  const abertas = todas.filter(r => r.est.aberto), origens = [...new Set(todas.map(r => r.origem))];
  const vis = todas.filter(filtroVer[ui.ver]).filter(r => (!ui.origem || r.origem === ui.origem) && (!ui.urg || r.urg === ui.urg));
  const marca = (r) => r.est.k === 'aberto' ? '' : `<div class="small" style="margin:4px 0;padding:4px 8px;border-radius:6px;background:var(--surface-2)"><b>${esc(r.est.txt)}</b>${S.atual[r.k]?.nota ? ` — ${esc(S.atual[r.k].nota)}` : ''}</div>`;
  corpo.innerHTML = `
    ${S.semSQL ? '<div class="card small" style="background:var(--warn-soft);margin-bottom:12px">Resolver, adiar e delegar precisam do SQL 103. Enquanto isso, os alertas aparecem sem as tratativas.</div>' : ''}
    <div class="kpis">${origens.map(o => { const n = abertas.filter(r => r.origem === o).length;
      return `<div class="kpi clickable ${ui.origem === o ? 'on' : ''}" data-o="${esc(o)}"><div class="k-label">${esc(o)}</div><div class="k-value">${n}</div><div class="k-sub">${abertas.filter(r => r.origem === o && r.urg === 'alta').length} alta(s)</div></div>`; }).join('')}</div>
    <div class="toolbar card" style="margin-top:12px"><div class="chips" id="dc-ver">${[['abertos', 'Abertos'], ['minhas', 'Delegados a mim'], ['adiados', 'Adiados'], ['resolvidos', 'Resolvidos']].map(([k, t]) => `<span class="chip ${ui.ver === k ? 'on' : ''}" data-ver="${k}">${t} (${conta(k)})</span>`).join('')}</div>
      <span class="spacer"></span><label>Urgência<select id="dc-urg"><option value="">Todas</option>${Object.entries(URG_TXT).map(([k, v]) => `<option value="${k}" ${ui.urg === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      ${ui.origem ? '<button class="btn ghost small" id="dc-lim">Todas as origens</button>' : ''}</div>
    <div class="dc-lista">${vis.map(r => `<div class="card dc-rec" data-k="${esc(r.k)}">
      <div class="dc-cab"><span class="badge ${r.urg === 'alta' ? 'vencido' : r.urg === 'media' ? 'aberto' : ''}">${URG_TXT[r.urg]}</span><span class="badge">${esc(r.origem)}</span>${r.est.k === 'delegado' ? '<span class="badge negoc">delegado</span>' : r.est.k === 'voltou' || r.est.k === 'venceu' ? '<span class="badge vencido">voltou</span>' : ''}<span class="dc-imp">${esc(r.impactoTxt || '')}</span></div>
      <h3 style="margin:6px 0 4px">${esc(r.titulo)}</h3><p style="margin:0 0 8px">${esc(r.desc)}</p>${marca(r)}
      <details class="small muted"><summary>Como foi calculado</summary>${esc(r.regra)}</details>
      <div class="dc-acoes"><button class="btn primary small" data-ir="${r.rota}">${esc(r.acao)}</button>
        ${podeTratar() && !S.semSQL ? (r.est.aberto ? `<button class="btn ghost small" data-t="resolvido">Resolver</button><button class="btn ghost small" data-t="adiado">Adiar</button><button class="btn ghost small" data-t="delegado">Delegar</button>`
          : '<button class="btn ghost small" data-t="reaberto">Reabrir</button>') : ''}</div></div>`).join('')
      || `<div class="card"><div class="empty">${ui.ver === 'abertos' ? 'Nenhum alerta aberto com esses filtros. 👏' : 'Nada aqui.'}</div></div>`}</div>`;
  $$('[data-o]', corpo).forEach(el => el.onclick = () => { ui.origem = ui.origem === el.dataset.o ? '' : el.dataset.o; abaAlertas(corpo, re); });
  $('#dc-lim', corpo) && ($('#dc-lim', corpo).onclick = () => { ui.origem = ''; abaAlertas(corpo, re); });
  $('#dc-urg', corpo).onchange = (e) => { ui.urg = e.target.value; abaAlertas(corpo, re); };
  $('#dc-ver', corpo).onclick = (e) => { const k = e.target.closest('[data-ver]')?.dataset.ver; if (k) { ui.ver = k; abaAlertas(corpo, re); } };
  $$('[data-ir]', corpo).forEach(b => b.onclick = () => { location.hash = '#/' + b.dataset.ir; });
  $$('[data-t]', corpo).forEach(b => b.onclick = () => tratar(todas.find(r => r.k === b.closest('[data-k]').dataset.k), b.dataset.t, re));
}

function tratar(r, sit, re) {
  const dias = cache.cfg.adiar_dias || 7, d = new Date(); d.setDate(d.getDate() + dias); const ate = d.toISOString().slice(0, 10);
  const T = { resolvido: ['Resolver o alerta', 'O que foi feito', 'Ex.: borderô aprovado e caixa recomposto', 'Resolver'], adiado: ['Adiar o alerta', 'Motivo (opcional)', 'Ex.: aguardando a resposta do banco', 'Adiar'],
    delegado: ['Delegar o alerta', 'Instrução (opcional)', 'Ex.: importar o extrato do Itaú até amanhã', 'Delegar'], reaberto: ['Reabrir o alerta', 'Motivo (opcional)', '', 'Reabrir'] }[sit];
  const m = modal({ title: T[0], body: `<div class="small muted" style="margin-bottom:8px"><b>${esc(r.titulo)}</b><br>${esc(r.desc)}</div>
      ${sit === 'adiado' ? `<label>Adiar até<input type="date" id="tr-ate" value="${ate}" min="${today()}"></label>` : ''}
      ${sit === 'delegado' ? `<label>Para quem<select id="tr-p">${cache.S.pessoas.filter(p => p.user_id !== state.user?.id).map(p => `<option value="${p.user_id}">${esc(p.nome)} (${esc(p.papel)})</option>`).join('')}</select></label>` : ''}
      <label style="margin-top:8px">${T[1]}<textarea id="tr-n" rows="3" placeholder="${esc(T[2])}"></textarea></label>
      ${sit === 'resolvido' ? '<p class="small muted">O alerta some enquanto o conteúdo for o mesmo. Se mudar (outro valor, mais itens), ele volta marcado.</p>' : ''}
      ${sit === 'delegado' ? '<p class="small muted">A pessoa recebe um aviso e o alerta mostra o responsável. Ele continua aberto até ser resolvido.</p>' : ''}`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="tr-ok">${T[3]}</button>` });
  $('#tr-ok', m.el).onclick = async () => {
    try { await q(sb.rpc('decisoes_tratar', { p_empresa: state.empresa.id, p_chave: r.k, p_origem: r.origem, p_titulo: r.titulo, p_situacao: sit,
        p_ate: sit === 'adiado' ? $('#tr-ate', m.el).value : null, p_delegado: sit === 'delegado' ? $('#tr-p', m.el).value : null, p_nota: $('#tr-n', m.el).value, p_assinatura: r.ass }));
      m.close(); toast({ resolvido: 'Alerta resolvido', adiado: 'Alerta adiado', delegado: 'Alerta delegado', reaberto: 'Alerta reaberto' }[sit]); cache = null; re(); }
    catch (e) { fail(e); }
  };
}

// ---------------------------------------------------------------- Saúde da empresa
async function abaSaude(corpo) {
  const { todas, cfg, inds } = cache, S = saude(todas.filter(r => r.est.aberto), inds, cfg.pesos || {}, cfg.pesos_areas || {});
  const fx = (n) => FAIXA[faixa(n, cfg)];
  // foto do dia (tendência)
  if (podeTratar()) q(sb.from('saude_historico').upsert({ empresa_id: state.empresa.id, dia: today(), geral: S.geral, areas: Object.fromEntries(S.areas.map(a => [a.k, a.nota])), alertas: todas.filter(r => r.est.aberto).length })).catch(() => {});
  const hist = await q(sb.from('saude_historico').select('dia,geral,areas').eq('empresa_id', state.empresa.id).order('dia').limit(120)).catch(() => []);
  const g = fx(S.geral), ang = S.geral / 100 * 180;
  const linha = (vals) => { if (vals.length < 2) return '<div class="small muted">A tendência aparece a partir do 2º dia.</div>'; const W = 600, H = 70, x = (i) => 4 + i * (W - 8) / (vals.length - 1), y = (v) => H - 4 - v / 100 * (H - 8);
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:70px"><line x1="0" x2="${W}" y1="${y(cfg.faixa_boa ?? 80)}" y2="${y(cfg.faixa_boa ?? 80)}" stroke="var(--pos)" stroke-dasharray="3 3" stroke-width="1"/><line x1="0" x2="${W}" y1="${y(cfg.faixa_atencao ?? 60)}" y2="${y(cfg.faixa_atencao ?? 60)}" stroke="var(--neg)" stroke-dasharray="3 3" stroke-width="1"/><polyline points="${vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')}" fill="none" stroke="var(--primary)" stroke-width="2"/></svg>`; };
  corpo.innerHTML = `<div style="display:grid;grid-template-columns:minmax(260px,320px) 1fr;gap:12px;align-items:stretch">
      <div class="card" style="text-align:center"><div class="small muted">Saúde da empresa</div>
        <svg viewBox="0 0 200 115" style="width:220px;max-width:100%"><path d="M10 105 A90 90 0 0 1 190 105" fill="none" stroke="var(--border)" stroke-width="16" stroke-linecap="round"/>
          <path d="M10 105 A90 90 0 0 1 190 105" fill="none" stroke="${g.cor}" stroke-width="16" stroke-linecap="round" stroke-dasharray="${(ang / 180 * 282.7).toFixed(1)} 400"/>
          <text x="100" y="98" text-anchor="middle" style="font-size:38px;font-weight:700;fill:var(--text)">${S.geral}</text></svg>
        <div><span class="badge ${g.cls}">${g.txt}</span></div><p class="small muted">Média das áreas${Object.keys(cfg.pesos_areas || {}).length ? ' (com os pesos dos Parâmetros)' : ''}. ${todas.filter(r => r.est.aberto).length} alerta(s) aberto(s).</p></div>
      <div class="card"><div class="small muted">Evolução (uma foto por dia)</div>${linha(hist.map(h => h.geral))}
        ${hist.length ? `<div class="small muted" style="display:flex;justify-content:space-between"><span>${dateBR(hist[0].dia)}</span><span>${dateBR(hist[hist.length - 1].dia)}</span></div>` : ''}
        <p class="small muted" style="margin-bottom:0">Linhas tracejadas: ${cfg.faixa_boa ?? 80} (saudável) e ${cfg.faixa_atencao ?? 60} (crítica abaixo).</p></div></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px;margin-top:12px">${S.areas.map(a => { const f = fx(a.nota), h = hist.map(x => x.areas?.[a.k]).filter(v => v != null);
      return `<div class="card" style="border-top:3px solid ${f.cor}"><div style="display:flex;justify-content:space-between;align-items:baseline"><b>${esc(a.nome)}</b><span class="badge ${f.cls}">${f.txt}</span></div>
        <div style="font-size:2em;font-weight:700;margin:4px 0">${a.nota}<span class="small muted" style="font-weight:400"> /100</span>${h.length > 1 ? `<span class="small ${h[h.length - 1] >= h[0] ? 'pos' : 'neg'}" style="font-weight:400;margin-left:8px">${h[h.length - 1] >= h[0] ? '+' : ''}${h[h.length - 1] - h[0]} no período</span>` : ''}</div>
        ${a.motivos.length ? `<div class="small">${a.motivos.slice(0, 5).map(m => `<div style="display:flex;justify-content:space-between;gap:8px;border-top:1px solid var(--border);padding:3px 0"><span>${esc(m.txt)}</span><span class="neg nowrap">−${m.pontos}</span></div>`).join('')}${a.motivos.length > 5 ? `<div class="muted">+ ${a.motivos.length - 5} motivo(s)</div>` : ''}</div>` : '<div class="small muted">Sem alertas abertos nem indicadores fora da meta.</div>'}</div>`; }).join('')}</div>
    <details class="small muted" style="margin-top:10px"><summary>Como a saúde é calculada</summary>Cada área começa com 100 e perde pontos por alerta aberto (alta ${{ ...PESOS_PADRAO, ...cfg.pesos }.alta}, média ${{ ...PESOS_PADRAO, ...cfg.pesos }.media}, baixa ${{ ...PESOS_PADRAO, ...cfg.pesos }.baixa}) e por indicador do Painel da Diretoria do mês anterior fora da meta (${{ ...PESOS_PADRAO, ...cfg.pesos }.fora_meta}) ou em atenção (${{ ...PESOS_PADRAO, ...cfg.pesos }.atencao}). Alertas resolvidos ou adiados não contam; delegados contam até serem resolvidos. Nunca fica abaixo de 0. O índice geral é a média das áreas (com peso, se definido). Áreas: ${AREAS.map(a => `${a.nome} (${[...a.origens, ...a.inds].join(', ') || '—'})`).join('; ')}.</details>`;
}

// ---------------------------------------------------------------- Histórico
function abaHistorico(corpo) {
  const H = cache.S.historico || [], D = cache.decs || [];
  const SIT = { resolvido: ['Resolveu', 'pago'], adiado: ['Adiou', 'aberto'], delegado: ['Delegou', 'negoc'], reaberto: ['Reabriu', ''] };
  corpo.innerHTML = `<h3 style="margin:0 0 6px">Alertas tratados (90 dias)</h3>
    <div class="card flush"><div class="table-wrap"><table><thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Alerta</th><th>Observação</th></tr></thead><tbody>
      ${H.map(h => `<tr><td class="nowrap small">${new Date(h.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</td><td class="small">${esc(String(h.por_email || '').split('@')[0])}</td>
        <td><span class="badge ${SIT[h.situacao][1]}">${SIT[h.situacao][0]}</span>${h.situacao === 'adiado' ? `<div class="small muted">até ${dateBR(h.ate)}</div>` : h.situacao === 'delegado' ? `<div class="small muted">para ${esc(h.delegado_nome || '')}</div>` : ''}</td>
        <td class="wrap"><b>${esc(h.titulo || '')}</b><div class="small muted">${esc(h.origem || '')}</div></td><td class="wrap small">${esc(h.nota || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhum alerta tratado ainda.</td></tr>'}</tbody></table></div></div>
    <h3 style="margin:18px 0 6px">Decisões de pagamentos do dia</h3>
    <div class="card flush"><div class="table-wrap"><table><thead><tr><th>Nº</th><th>Dia</th><th>Situação</th><th class="num">Saldo final previsto</th><th>Registrada</th><th></th></tr></thead><tbody>
      ${D.map(d => `<tr><td>${d.numero}</td><td>${dateBR(d.data)}</td><td><span class="badge ${d.status === 'Aprovada' ? 'pago' : d.status === 'Rejeitada' ? 'vencido' : 'aberto'}">${esc(d.status)}</span>${d.motivo ? `<div class="small muted">${esc(d.motivo)}</div>` : ''}</td>
        <td class="num">${d.saldo_fim != null ? money0(d.saldo_fim) : '—'}</td><td class="small">${new Date(d.criado_em).toLocaleDateString('pt-BR')}</td><td><a class="btn ghost small" href="#/decisoes?aba=pagamentos&dia=${d.data}">Abrir</a></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhuma decisão registrada.</td></tr>'}</tbody></table></div></div>`;
}

// ---------------------------------------------------------------- Parâmetros
function parametros(depois) {
  const c = cache?.cfg || {}, P = { ...PESOS_PADRAO, ...(c.pesos || {}) }, PA = c.pesos_areas || {};
  const n = (id, v, min, max, rot) => `<label>${rot}<input type="number" id="${id}" min="${min}" max="${max}" value="${v}"></label>`;
  const m = modal({ title: 'Parâmetros da Central de Decisões', wide: true, body: `<h3 style="margin:0 0 6px">Pontos que cada item tira da saúde da área</h3>
      <div class="grid-form">${n('pp-alta', P.alta, 0, 100, 'Alerta de urgência alta')}${n('pp-media', P.media, 0, 100, 'Alerta de urgência média')}${n('pp-baixa', P.baixa, 0, 100, 'Alerta de urgência baixa')}
        ${n('pp-fora', P.fora_meta, 0, 100, 'Indicador fora da meta')}${n('pp-at', P.atencao, 0, 100, 'Indicador em atenção')}</div>
      <h3 style="margin:14px 0 6px">Faixas e adiamento</h3>
      <div class="grid-form">${n('pp-boa', c.faixa_boa ?? 80, 1, 100, 'Saudável a partir de')}${n('pp-crit', c.faixa_atencao ?? 60, 0, 99, 'Crítica abaixo de')}${n('pp-adia', c.adiar_dias ?? 7, 1, 90, 'Adiar, por padrão (dias)')}</div>
      <h3 style="margin:14px 0 6px">Peso de cada área no índice geral</h3>
      <div class="grid-form">${AREAS.map(a => n('pa-' + a.k, PA[a.k] ?? 1, 0, 10, a.nome)).join('')}</div>
      <p class="small muted">Peso 0 tira a área do índice geral (ela continua aparecendo). Os pesos valem para os cálculos a partir de agora; as fotos dos dias anteriores não mudam.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pp-ok">Salvar</button>' });
  $('#pp-ok', m.el).onclick = async () => {
    const v = (id) => +$('#' + id, m.el).value;
    const row = { empresa_id: state.empresa.id, pesos: { alta: v('pp-alta'), media: v('pp-media'), baixa: v('pp-baixa'), fora_meta: v('pp-fora'), atencao: v('pp-at') },
      faixa_boa: v('pp-boa'), faixa_atencao: v('pp-crit'), adiar_dias: v('pp-adia'), pesos_areas: Object.fromEntries(AREAS.map(a => [a.k, v('pa-' + a.k)])), atualizado_por: state.user?.email, atualizado_em: new Date().toISOString() };
    if (!(row.faixa_atencao < row.faixa_boa)) return toast('A faixa crítica precisa ser menor que a saudável', true);
    if (!AREAS.some(a => row.pesos_areas[a.k] > 0)) return toast('Deixe ao menos uma área com peso', true);
    try { await q(sb.from('decisoes_config').upsert(row)); m.close(); toast('Parâmetros salvos'); depois(); } catch (e) { fail(e); }
  };
}
