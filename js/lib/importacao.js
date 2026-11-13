// Importação de Matéria-Prima (SQL 158): regras puras da tela Compras e Estoque › Importação.
// Etapas do processo, custo estimado (antes de embarcar) e custo final (com as despesas reais), exposição cambial,
// alertas de prazo e leitura das cotações do Banco Central. Sem acesso a banco nem a tela: testado em Node.

export const ETAPAS = [
  ['negociacao', 'Em negociação', 'Proforma e condições com o exportador'],
  ['pedido', 'Pedido confirmado', 'Proforma aceita; adiantamento, se houver'],
  ['producao', 'Em produção', 'Mercadoria sendo preparada no exportador'],
  ['embarcado', 'Embarcado', 'Em trânsito, com o conhecimento de embarque'],
  ['chegada', 'No porto', 'Chegou; começa a contar o prazo do contêiner'],
  ['registro', 'Declaração registrada', 'DI ou DUIMP registrada, impostos pagos'],
  ['desembaracado', 'Desembaraçado', 'Liberado pela Receita; pronto para a fábrica'],
  ['recebido', 'Recebido', 'Conferido e com entrada no estoque'],
  ['encerrado', 'Encerrado', 'Câmbio liquidado e custo fechado'],
];
export const ETAPA = Object.fromEntries(ETAPAS.map(([k, n, d], i) => [k, { nome: n, desc: d, ordem: i }]));
ETAPA.cancelado = { nome: 'Cancelado', desc: '', ordem: 99 };
export const ABERTAS = ['negociacao', 'pedido', 'producao', 'embarcado', 'chegada', 'registro', 'desembaracado', 'recebido'];
export const proximaEtapa = (s) => { const i = ETAPAS.findIndex(e => e[0] === s); return i >= 0 && i < ETAPAS.length - 1 ? ETAPAS[i + 1][0] : null; };
// campo de data de cada etapa no processo
export const DATA_ETAPA = { pedido: 'data_pedido', embarcado: 'data_embarque', chegada: 'data_chegada', registro: 'data_registro', desembaracado: 'data_desembaraco', recebido: 'data_recebimento', encerrado: 'data_encerramento' };

export const INCOTERMS = { EXW: 'EXW — na fábrica do exportador', FCA: 'FCA — entregue ao transportador', FAS: 'FAS — ao lado do navio', FOB: 'FOB — a bordo, no porto de origem',
  CFR: 'CFR — custo e frete', CIF: 'CIF — custo, seguro e frete', CPT: 'CPT — transporte pago até', CIP: 'CIP — transporte e seguro pagos até', DAP: 'DAP — entregue no local', DPU: 'DPU — entregue descarregado', DDP: 'DDP — entregue com direitos pagos' };
// o preço do exportador já traz o frete internacional / o seguro?
export const freteNoPreco = (inc) => ['CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'].includes(inc);
export const seguroNoPreco = (inc) => ['CIF', 'CIP', 'DAP', 'DPU', 'DDP'].includes(inc);
export const MODAL = { maritimo: 'Marítimo', aereo: 'Aéreo', rodoviario: 'Rodoviário' };
export const CANAL = { verde: ['Verde', 'pos'], amarelo: ['Amarelo', 'warn'], vermelho: ['Vermelho', 'neg'], cinza: ['Cinza', 'muted'] };
export const MOEDAS = { USD: 'Dólar americano', EUR: 'Euro', CNY: 'Yuan chinês', GBP: 'Libra esterlina', JPY: 'Iene' };
// séries do Banco Central (SGS) com a PTAX de venda e de compra
export const SGS = { USD: { venda: 1, compra: 10813 }, EUR: { venda: 21619, compra: 21620 } };

// categoria: [nome, grupo, entra no custo por padrão]
export const CATEGORIAS = {
  frete_internacional: ['Frete internacional', 'Logística', true], seguro: ['Seguro internacional', 'Logística', true],
  ii: ['Imposto de Importação (II)', 'Impostos', true], ipi: ['IPI', 'Impostos', false], pis: ['PIS-Importação', 'Impostos', false], cofins: ['COFINS-Importação', 'Impostos', false],
  icms: ['ICMS', 'Impostos', false], siscomex: ['Taxa Siscomex', 'Impostos', true], afrmm: ['AFRMM (marinha mercante)', 'Impostos', true],
  capatazia: ['Capatazia / THC', 'Porto', true], armazenagem: ['Armazenagem', 'Porto', true], demurrage: ['Demurrage (atraso do contêiner)', 'Porto', false],
  despachante: ['Despachante aduaneiro', 'Serviços', true], frete_interno: ['Frete do porto à fábrica', 'Logística', true],
  bancaria: ['Despesa bancária do câmbio', 'Financeiro', false], multa: ['Multa', 'Financeiro', false], outras: ['Outras despesas', 'Outras', true],
};
export const DOCS = { proforma: 'Proforma', invoice: 'Fatura comercial (invoice)', packing: 'Romaneio (packing list)', conhecimento: 'Conhecimento de embarque (BL / AWB / CRT)', origem: 'Certificado de origem',
  declaracao: 'Declaração de importação (DI / DUIMP)', comprovante: 'Comprovante de importação', cambio: 'Contrato de câmbio', nota: 'Nota fiscal de entrada', laudo: 'Laudo / certificado de análise', outro: 'Outro' };
export const CAMBIO_TIPO = { adiantamento: 'Adiantamento', parcela: 'Parcela', saldo: 'Saldo' };
export const CAMBIO_STATUS = { previsto: ['Previsto', 'muted'], contratado: ['Contratado', 'warn'], liquidado: ['Liquidado', 'pos'] };

const n = (v) => +v || 0, r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100, r6 = (v) => Math.round(v * 1e6) / 1e6;
const fobItem = (i) => n(i.quantidade) * n(i.valor_unitario);
const pesoItem = (i) => i.peso_liquido != null && i.peso_liquido !== '' ? n(i.peso_liquido) : (String(i.unidade || '').toUpperCase() === 'KG' ? n(i.quantidade) : 0);
export const fobTotal = (itens) => itens.reduce((s, i) => s + fobItem(i), 0);
export const numeroProcesso = (p) => `IMP ${String(p.numero || 0).padStart(3, '0')}`;
export const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);

// pesos do rateio: pelo valor (FOB) ou pelo peso; sem peso informado, cai para o valor; sem valor, para a quantidade
function pesos(itens, modo) {
  const fob = fobTotal(itens), peso = itens.reduce((s, i) => s + pesoItem(i), 0), qtd = itens.reduce((s, i) => s + n(i.quantidade), 0);
  const usar = modo === 'peso' && peso > 0 ? 'peso' : 'valor';
  return { modo: usar, de: (i) => usar === 'peso' ? pesoItem(i) / peso : fob > 0 ? fobItem(i) / fob : qtd > 0 ? n(i.quantidade) / qtd : 0 };
}

/**
 * Custo estimado, antes das despesas reais: do preço do exportador ao custo por unidade na fábrica.
 * prem: { taxa, frete, seguro (na moeda do processo), siscomex, afrmm_pct, despesas (em reais: porto, despachante, frete interno), rateio,
 *         recupera_icms, recupera_ipi, recupera_pis_cofins }.
 * Valor aduaneiro = (mercadoria + frete + seguro) × taxa. II sobre o valor aduaneiro; IPI sobre valor aduaneiro + II;
 * PIS e COFINS sobre o valor aduaneiro; ICMS "por dentro" sobre valor aduaneiro + II + IPI + PIS + COFINS + Siscomex + AFRMM.
 */
export function estimar(itens, prem = {}) {
  const taxa = n(prem.taxa), w = pesos(itens, prem.rateio), frete = n(prem.frete), seguro = n(prem.seguro);
  const afrmm = r2(frete * taxa * n(prem.afrmm_pct) / 100), sis = n(prem.siscomex), locais = n(prem.despesas);
  const L = itens.map(i => {
    const p = w.de(i), va = (fobItem(i) + frete * p + seguro * p) * taxa;
    const ii = va * n(i.aliq_ii) / 100, ipi = (va + ii) * n(i.aliq_ipi) / 100, pis = va * n(i.aliq_pis) / 100, cofins = va * n(i.aliq_cofins) / 100;
    const aduan = sis * p + afrmm * p, al = n(i.aliq_icms) / 100;
    const icms = al > 0 && al < 1 ? (va + ii + ipi + pis + cofins + aduan) / (1 - al) * al : 0;
    const recup = (prem.recupera_ipi !== false ? ipi : 0) + (prem.recupera_pis_cofins !== false ? pis + cofins : 0) + (prem.recupera_icms !== false ? icms : 0);
    const desembolso = va + ii + ipi + pis + cofins + icms + aduan + locais * p, custo = desembolso - recup;
    return { item_id: i.id, descricao: i.descricao, quantidade: n(i.quantidade), unidade: i.unidade, fob_moeda: r2(fobItem(i)), valor_aduaneiro: r2(va), ii: r2(ii), ipi: r2(ipi), pis: r2(pis), cofins: r2(cofins), icms: r2(icms),
      despesas: r2(aduan + locais * p), recuperavel: r2(recup), desembolso: r2(desembolso), custo_total: r2(custo), custo_unitario: n(i.quantidade) ? r6(custo / n(i.quantidade)) : 0 };
  });
  const soma = (k) => r2(L.reduce((s, x) => s + x[k], 0)), fob = fobTotal(itens);
  return { taxa, rateio: w.modo, fob_moeda: r2(fob), fob_brl: r2(fob * taxa), valor_aduaneiro: soma('valor_aduaneiro'), ii: soma('ii'), ipi: soma('ipi'), pis: soma('pis'), cofins: soma('cofins'), icms: soma('icms'),
    siscomex: r2(sis), afrmm, despesas_locais: r2(locais), recuperavel: soma('recuperavel'), desembolso: soma('desembolso'), custo_total: soma('custo_total'),
    fator: fob * taxa > 0 ? soma('custo_total') / (fob * taxa) : null, itens: L };
}

/**
 * Custo final: mercadoria pela taxa da declaração (ou a prevista, ou a última cotação) mais as despesas que compõem o custo,
 * rateadas pelo valor ou pelo peso (a despesa de um item só vai direto para ele). Igual à função imp_custo do banco.
 * A diferença entre o câmbio liquidado e a mercadoria pela taxa da declaração é variação cambial, fora do custo.
 */
export function custoFinal(proc, itens, despesas = [], cambios = [], cfg = {}, cotacao = null) {
  const taxa = n(proc.taxa_di) || n(proc.taxa_prevista) || n(cotacao) || null;
  const origem = n(proc.taxa_di) ? 'declaracao' : n(proc.taxa_prevista) ? 'prevista' : taxa ? 'cotacao' : 'sem_taxa';
  const w = pesos(itens, proc.rateio || cfg.rateio || 'valor'), t = taxa || 0;
  const rateadas = despesas.filter(d => d.compoe_custo && !d.item_id).reduce((s, d) => s + n(d.valor), 0);
  const L = itens.map(i => { const dir = despesas.filter(d => d.compoe_custo && d.item_id === i.id).reduce((s, d) => s + n(d.valor), 0), desp = rateadas * w.de(i) + dir, tot = fobItem(i) * t + desp;
    return { item_id: i.id, descricao: i.descricao, quantidade: n(i.quantidade), unidade: i.unidade, fob_moeda: r2(fobItem(i)), fob_brl: r2(fobItem(i) * t), despesas: r2(desp), custo_total: r2(tot), custo_unitario: n(i.quantidade) ? r6(tot / n(i.quantidade)) : 0 }; });
  const liq = cambios.filter(c => c.status === 'liquidado'), liqMoeda = liq.reduce((s, c) => s + n(c.valor_moeda), 0), liqBrl = liq.reduce((s, c) => s + n(c.valor_brl), 0), fob = fobTotal(itens);
  const fora = despesas.filter(d => !d.compoe_custo), custo = r2(L.reduce((s, x) => s + x.custo_total, 0));
  return { moeda: proc.moeda, taxa, taxa_origem: origem, rateio: w.modo, fob_moeda: r2(fob), fob_brl: r2(fob * t), despesas_custo: r2(despesas.filter(d => d.compoe_custo).reduce((s, d) => s + n(d.valor), 0)),
    despesas_fora: r2(fora.reduce((s, d) => s + n(d.valor), 0)), impostos_recuperaveis: r2(fora.filter(d => ['icms', 'ipi', 'pis', 'cofins'].includes(d.categoria)).reduce((s, d) => s + n(d.valor), 0)),
    custo_total: custo, fator: fob * t > 0 ? custo / (fob * t) : null, cambio_liquidado_moeda: r2(liqMoeda), cambio_liquidado_brl: r2(liqBrl), variacao_cambial: taxa ? r2(liqBrl - liqMoeda * taxa) : null, itens: L };
}

/** quanto do processo já tem câmbio previsto, contratado e liquidado, e o que ainda está sem cobertura */
export function coberturaCambio(itens, cambios) {
  const fob = r2(fobTotal(itens)), por = (s) => r2(cambios.filter(c => c.status === s).reduce((a, c) => a + n(c.valor_moeda), 0));
  const previsto = por('previsto'), contratado = por('contratado'), liquidado = por('liquidado');
  return { fob, previsto, contratado, liquidado, programado: r2(previsto + contratado + liquidado), sem_programar: r2(fob - previsto - contratado - liquidado) };
}

/**
 * Exposição cambial da empresa: o que ainda vai ser pago em moeda estrangeira e ainda não tem taxa travada.
 * cambios com { moeda, valor_moeda, status, taxa, vencimento }; cot = { USD: 5.40, ... } (última cotação de venda).
 * Sensibilidade: quanto o desembolso em reais muda a cada 1% de variação da moeda.
 */
export function exposicao(cambios, cot = {}) {
  const M = {};
  for (const c of cambios) {
    if (c.status === 'liquidado') continue;
    const m = M[c.moeda] || (M[c.moeda] = { moeda: c.moeda, aberto: 0, travado: 0, travado_brl: 0, cotacao: n(cot[c.moeda]) || null });
    if (c.status === 'contratado') { m.travado += n(c.valor_moeda); m.travado_brl += n(c.valor_moeda) * n(c.taxa); } else m.aberto += n(c.valor_moeda);
  }
  return Object.values(M).map(m => ({ ...m, aberto: r2(m.aberto), travado: r2(m.travado), travado_brl: r2(m.travado_brl), aberto_brl: m.cotacao ? r2(m.aberto * m.cotacao) : null, por_ponto: m.cotacao ? r2(m.aberto * m.cotacao / 100) : null }))
    .sort((a, b) => (b.aberto_brl || 0) - (a.aberto_brl || 0));
}

/** alertas de prazo: chegada atrasada ou próxima, câmbio a vencer sem contrato, contêiner a devolver, declaração parada */
export function alertas(processos, cambios, cfg = {}, hoje = new Date().toISOString().slice(0, 10)) {
  const out = [], dc = cfg.dias_aviso_chegada ?? 7, dk = cfg.dias_aviso_cambio ?? 5, df = cfg.dias_aviso_freetime ?? 3, P = Object.fromEntries(processos.map(p => [p.id, p]));
  for (const p of processos) {
    if (!ABERTAS.includes(p.status)) continue;
    const ref = numeroProcesso(p);
    if (['pedido', 'producao'].includes(p.status) && p.embarque_previsto && p.embarque_previsto < hoje) out.push({ k: 'embarque', nivel: 'medio', processo_id: p.id, data: p.embarque_previsto, texto: `${ref}: embarque previsto para ${br(p.embarque_previsto)} ainda não confirmado` });
    if (p.status === 'embarcado' && p.chegada_prevista) { const d = diasEntre(hoje, p.chegada_prevista);
      if (d < 0) out.push({ k: 'chegada', nivel: 'alto', processo_id: p.id, data: p.chegada_prevista, texto: `${ref}: chegada prevista para ${br(p.chegada_prevista)} está ${-d} dia(s) atrasada` });
      else if (d <= dc) out.push({ k: 'chegada', nivel: 'baixo', processo_id: p.id, data: p.chegada_prevista, texto: `${ref}: chega em ${d === 0 ? 'hoje' : d + ' dia(s)'} (${br(p.chegada_prevista)})` }); }
    if (['chegada', 'registro', 'desembaracado'].includes(p.status) && p.data_devolucao_container) { const d = diasEntre(hoje, p.data_devolucao_container);
      if (d < 0) out.push({ k: 'container', nivel: 'alto', processo_id: p.id, data: p.data_devolucao_container, texto: `${ref}: prazo do contêiner venceu há ${-d} dia(s); demurrage correndo` });
      else if (d <= df) out.push({ k: 'container', nivel: 'medio', processo_id: p.id, data: p.data_devolucao_container, texto: `${ref}: devolver o contêiner até ${br(p.data_devolucao_container)}` }); }
    if (p.status === 'chegada' && p.data_chegada && diasEntre(p.data_chegada, hoje) > 5) out.push({ k: 'registro', nivel: 'medio', processo_id: p.id, data: p.data_chegada, texto: `${ref}: no porto há ${diasEntre(p.data_chegada, hoje)} dias sem declaração registrada` });
  }
  for (const c of cambios) {
    const p = P[c.processo_id]; if (!p || c.status === 'liquidado' || p.status === 'cancelado') continue;
    const d = diasEntre(hoje, c.vencimento), ref = numeroProcesso(p), v = `${p.moeda} ${n(c.valor_moeda).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    if (d < 0) out.push({ k: 'cambio', nivel: 'alto', processo_id: p.id, data: c.vencimento, texto: `${ref}: câmbio de ${v} venceu em ${br(c.vencimento)} e não foi liquidado` });
    else if (d <= dk) out.push({ k: 'cambio', nivel: c.status === 'previsto' ? 'alto' : 'medio', processo_id: p.id, data: c.vencimento, texto: `${ref}: câmbio de ${v} vence em ${d === 0 ? 'hoje' : d + ' dia(s)'}${c.status === 'previsto' ? ', ainda sem contrato' : ''}` });
  }
  const peso = { alto: 0, medio: 1, baixo: 2 };
  return out.sort((a, b) => peso[a.nivel] - peso[b.nivel] || a.data.localeCompare(b.data));
}
const br = (s) => s.slice(0, 10).split('-').reverse().join('/');

/** junta as respostas das séries do Banco Central ([{data:'dd/mm/aaaa', valor:'5.4018'}]) em linhas { moeda, data, compra, venda } */
export function lerSgs(moeda, venda = [], compra = []) {
  const iso = (d) => String(d || '').split('/').reverse().join('-'), num = (v) => { const x = parseFloat(String(v).replace(',', '.')); return isFinite(x) && x > 0 ? x : null; };
  const C = Object.fromEntries((Array.isArray(compra) ? compra : []).map(x => [iso(x.data), num(x.valor)]));
  return (Array.isArray(venda) ? venda : []).map(x => ({ moeda, data: iso(x.data), venda: num(x.valor), compra: C[iso(x.data)] ?? null, fonte: 'Banco Central (PTAX)' })).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.data) && x.venda);
}

/** confere o processo antes de avançar de etapa; devolve a lista do que falta */
export function faltaParaEtapa(proc, itens, etapa) {
  const f = [];
  if (!itens.length && etapa !== 'negociacao') f.push('Inclua ao menos um item.');
  if (etapa === 'embarcado' && !proc.conhecimento) f.push('Informe o conhecimento de embarque (BL, AWB ou CRT).');
  if (['registro', 'desembaracado'].includes(etapa) && !proc.declaracao) f.push('Informe o número da declaração (DI ou DUIMP).');
  if (['registro', 'desembaracado'].includes(etapa) && !n(proc.taxa_di)) f.push('Informe a taxa de câmbio da declaração: é ela que forma o custo da mercadoria.');
  if (etapa === 'encerrado' && itens.some(i => n(i.qtd_recebida) < n(i.quantidade))) f.push('Ainda há item com saldo a receber.');
  return f;
}
