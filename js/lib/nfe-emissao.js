// Emissão de NF-e pela API da Focus NFe — regras puras (sem banco nem tela): cálculo dos itens e dos totais, conferência
// antes de enviar, montagem do JSON da Focus e dos dados da prévia do DANFE.
// Os impostos saem da natureza de operação cadastrada (CST e alíquotas) e podem ser ajustados item a item.
// Fora desta versão: substituição tributária, DIFAL, FCP, importação/exportação e ICMS desonerado (conferir com a contabilidade).

const r2 = (v) => Math.round((+v || 0) * 100 + Number.EPSILON) / 100;
const so = (s) => String(s ?? '').replace(/\D/g, '');
const n = (v) => +v || 0;

export const STATUS = { rascunho: ['Rascunho', 'muted'], enviando: ['Enviando', 'warn'], processando: ['Na SEFAZ', 'warn'], autorizada: ['Autorizada', 'pos'], erro: ['Rejeitada', 'neg'], cancelada: ['Cancelada', 'muted'], denegada: ['Denegada', 'neg'] };
export const FINALIDADE = { 1: 'Normal', 2: 'Complementar', 3: 'Ajuste', 4: 'Devolução' };
export const FRETE = { 0: 'Por conta do emitente (CIF)', 1: 'Por conta do destinatário (FOB)', 2: 'Por conta de terceiros', 3: 'Transporte próprio do remetente', 4: 'Transporte próprio do destinatário', 9: 'Sem frete' };
export const PAGAMENTO = { '01': 'Dinheiro', '02': 'Cheque', '03': 'Cartão de crédito', '04': 'Cartão de débito', '15': 'Boleto bancário', '16': 'Depósito bancário', '17': 'PIX', '18': 'Transferência', '90': 'Sem pagamento', '99': 'Outros' };
/** CST do ICMS que destacam imposto próprio (regime normal) */
const ICMS_TRIBUTA = new Set(['00', '10', '20', '70', '90']);
const PISCOF_TRIBUTA = new Set(['01', '02']);
const IPI_TRIBUTA = new Set(['50', '99', '00', '49']);

/** local de destino: 1 interna, 2 interestadual, 3 exterior */
export const localDestino = (ufEmit, ufDest) => !ufDest || ufDest === 'EX' ? 3 : ufDest === ufEmit ? 1 : 2;
/** alíquota interestadual do ICMS: 4% importados (origem 1, 2, 3 e 8); 7% do Sul/Sudeste (menos ES) para Norte, Nordeste, Centro-Oeste e ES; 12% nos demais */
export function aliquotaInterestadual(ufOrigem, ufDestino, origem = '0') {
  if (['1', '2', '3', '8'].includes(String(origem))) return 4;
  const SS = ['SP', 'RJ', 'MG', 'PR', 'SC', 'RS'];
  return SS.includes(ufOrigem) && !SS.includes(ufDestino) ? 7 : 12;
}

/** item novo a partir do produto e da natureza de operação */
export function itemDaNatureza(prod, nat, { ufEmit, ufDest } = {}) {
  const inter = localDestino(ufEmit, ufDest) === 2, origem = String(prod?.icms_origem ?? '0');
  return {
    produto_id: prod?.id || null, codigo: prod?.codigo || '', descricao: prod?.descricao || '', ncm: so(prod?.ncm), unidade: prod?.unidade || 'UN', quantidade: 0, valor_unitario: 0, desconto: 0,
    cfop: (inter ? nat?.cfop_interestadual : nat?.cfop_interno) || '', icms_origem: origem, icms_cst: nat?.icms_cst || '00',
    icms_aliquota: inter ? (nat?.icms_aliquota_inter ?? aliquotaInterestadual(ufEmit, ufDest, origem)) : n(nat?.icms_aliquota_interna), icms_reducao: n(nat?.icms_reducao),
    ipi_cst: nat?.ipi_cst || '53', ipi_aliquota: n(nat?.ipi_aliquota), ipi_enquadramento: nat?.ipi_enquadramento || '999',
    pis_cst: nat?.pis_cst || '01', pis_aliquota: n(nat?.pis_aliquota), cofins_cst: nat?.cofins_cst || '01', cofins_aliquota: n(nat?.cofins_aliquota),
    ibs_cbs_cst: nat?.ibs_cbs_cst || '', ibs_cbs_classificacao: nat?.ibs_cbs_classificacao || '', cbs_aliquota: n(nat?.cbs_aliquota), ibs_uf_aliquota: n(nat?.ibs_uf_aliquota), ibs_mun_aliquota: n(nat?.ibs_mun_aliquota),
    info: '',
  };
}

/**
 * Calcula os itens e os totais. cab: { valor_frete, valor_seguro, valor_outras, consumidor_final }.
 * cfg: { crt, pis_cofins_exclui_icms, ibs_cbs_exclui_tributos }.
 * Frete, seguro e outras despesas são rateados pelo valor dos produtos e entram nas bases.
 */
export function calcular(itens, cab = {}, cfg = {}) {
  const simples = [1, 2, 4].includes(+cfg.crt), brutoTot = itens.reduce((s, i) => s + r2(n(i.quantidade) * n(i.valor_unitario)), 0);
  let fr = r2(cab.valor_frete), sg = r2(cab.valor_seguro), ou = r2(cab.valor_outras);
  const calc = itens.map((i, k) => {
    const bruto = r2(n(i.quantidade) * n(i.valor_unitario)), ult = k === itens.length - 1, prop = brutoTot ? bruto / brutoTot : 0;
    const rat = (tot, resto) => ult ? resto : r2(tot * prop);
    const frete = rat(r2(cab.valor_frete), fr), seguro = rat(r2(cab.valor_seguro), sg), outras = rat(r2(cab.valor_outras), ou); fr = r2(fr - frete); sg = r2(sg - seguro); ou = r2(ou - outras);
    const desc = r2(i.desconto), oper = r2(bruto - desc + frete + seguro + outras);
    const ipiTrib = IPI_TRIBUTA.has(String(i.ipi_cst)) && n(i.ipi_aliquota) > 0, ipi_base = ipiTrib ? oper : 0, ipi_valor = r2(ipi_base * n(i.ipi_aliquota) / 100);
    const icmsTrib = !simples && ICMS_TRIBUTA.has(String(i.icms_cst)) && n(i.icms_aliquota) > 0;
    // o IPI entra na base do ICMS quando a mercadoria vai para consumidor final (uso, consumo ou ativo)
    const icms_base = icmsTrib ? r2((oper + (cab.consumidor_final ? ipi_valor : 0)) * (1 - n(i.icms_reducao) / 100)) : 0, icms_valor = r2(icms_base * n(i.icms_aliquota) / 100);
    const pcBase = r2(oper - (cfg.pis_cofins_exclui_icms === false ? 0 : icms_valor));
    const pis_base = PISCOF_TRIBUTA.has(String(i.pis_cst)) ? pcBase : 0, pis_valor = r2(pis_base * n(i.pis_aliquota) / 100);
    const cofins_base = PISCOF_TRIBUTA.has(String(i.cofins_cst)) ? pcBase : 0, cofins_valor = r2(cofins_base * n(i.cofins_aliquota) / 100);
    // IBS/CBS: valor da operação sem ICMS, PIS e COFINS (fase de teste de 2026); o IPI não entra
    const temRtc = !!String(i.ibs_cbs_cst || '').trim();
    const ibs_cbs_base = temRtc ? r2(oper - (cfg.ibs_cbs_exclui_tributos === false ? 0 : icms_valor + pis_valor + cofins_valor)) : 0;
    const cbs_valor = r2(ibs_cbs_base * n(i.cbs_aliquota) / 100), ibs_uf_valor = r2(ibs_cbs_base * n(i.ibs_uf_aliquota) / 100), ibs_mun_valor = r2(ibs_cbs_base * n(i.ibs_mun_aliquota) / 100);
    return { ...i, numero_item: k + 1, valor_bruto: bruto, desconto: desc, frete, seguro, outras, icms_base, icms_valor, ipi_base, ipi_valor, pis_base, pis_valor, cofins_base, cofins_valor,
      ibs_cbs_base, cbs_valor, ibs_uf_valor, ibs_mun_valor, total: r2(oper + ipi_valor) };
  });
  const S = (k) => r2(calc.reduce((s, i) => s + n(i[k]), 0));
  const totais = { produtos: S('valor_bruto'), desconto: S('desconto'), frete: S('frete'), seguro: S('seguro'), outras: S('outras'), icms_base: S('icms_base'), icms: S('icms_valor'), ipi: S('ipi_valor'),
    pis: S('pis_valor'), cofins: S('cofins_valor'), ibs_cbs_base: S('ibs_cbs_base'), cbs: S('cbs_valor'), ibs_uf: S('ibs_uf_valor'), ibs_mun: S('ibs_mun_valor'), nota: S('total') };
  return { itens: calc, totais };
}

/** duplicatas em parcelas iguais (a última leva a diferença de centavos); prazos em dias a partir da emissão */
export function parcelar(total, prazos, emissao, numero = '') {
  const P = (prazos || []).map(Number).filter(x => x >= 0); if (!P.length || !(total > 0)) return [];
  const base = Math.floor(total * 100 / P.length) / 100; let resto = r2(total);
  return P.map((d, i) => { const v = i === P.length - 1 ? resto : base; resto = r2(resto - v); const dt = new Date(String(emissao).slice(0, 10) + 'T12:00:00Z'); dt.setUTCDate(dt.getUTCDate() + d);
    return { numero: `${numero ? numero + '/' : ''}${String(i + 1).padStart(3, '0')}`, vencimento: dt.toISOString().slice(0, 10), valor: v }; });
}

/** confere a nota antes de enviar: lista de problemas em texto (vazia = pode enviar) */
export function validar(nota, emit, cfg = {}) {
  const p = [], d = nota.destinatario || {}, doc = so(d.documento), C = calcular(nota.itens || [], nota, cfg);
  if (so(emit?.cnpj).length !== 14) p.push('Emitente: CNPJ da empresa não cadastrado.');
  for (const [k, t] of [['logradouro', 'logradouro'], ['numero', 'número'], ['bairro', 'bairro'], ['municipio', 'município'], ['uf', 'UF'], ['cep', 'CEP'], ['ie', 'inscrição estadual']]) if (!String(emit?.[k] || '').trim()) p.push(`Emitente: falta ${t} (Parâmetros da emissão).`);
  if (!String(nota.natureza_operacao || '').trim()) p.push('Informe a natureza da operação.');
  if (!String(d.nome || '').trim()) p.push('Destinatário: informe o nome.');
  if (![11, 14].includes(doc.length)) p.push('Destinatário: CNPJ ou CPF inválido.');
  for (const [k, t] of [['logradouro', 'logradouro'], ['numero', 'número'], ['bairro', 'bairro'], ['municipio', 'município'], ['uf', 'UF'], ['cep', 'CEP']]) if (!String(d[k] || '').trim()) p.push(`Destinatário: falta ${t}.`);
  if (+d.indicador_ie === 1 && !so(d.ie)) p.push('Destinatário contribuinte do ICMS precisa da inscrição estadual.');
  if (+nota.finalidade === 4 && !(nota.referenciadas || []).some(c => so(c).length === 44)) p.push('Devolução: informe a chave (44 dígitos) da nota devolvida.');
  if (!(nota.itens || []).length) p.push('Inclua ao menos um item.');
  C.itens.forEach((i) => { const q = `Item ${i.numero_item}`;
    if (!String(i.descricao || '').trim()) p.push(`${q}: falta a descrição.`);
    if (so(i.ncm).length !== 8) p.push(`${q}: NCM precisa ter 8 dígitos.`);
    if (!/^[1-7]\d{3}$/.test(String(i.cfop || ''))) p.push(`${q}: CFOP inválido.`);
    else { const ini = String(i.cfop)[0], loc = localDestino(emit?.uf, d.uf), esp = +nota.tipo_documento === 0 ? { 1: '1', 2: '2', 3: '3' }[loc] : { 1: '5', 2: '6', 3: '7' }[loc]; if (ini !== esp) p.push(`${q}: CFOP ${i.cfop} não combina com a operação (esperado começar com ${esp}).`); }
    if (!(n(i.quantidade) > 0) || !(n(i.valor_unitario) > 0)) p.push(`${q}: informe quantidade e valor unitário.`);
    if (i.desconto > i.valor_bruto) p.push(`${q}: desconto maior que o valor do item.`);
    if (String(i.ibs_cbs_cst || '').trim() && so(i.ibs_cbs_classificacao).length !== 6) p.push(`${q}: classificação tributária do IBS/CBS precisa ter 6 dígitos.`);
  });
  const dup = r2((nota.duplicatas || []).reduce((s, x) => s + n(x.valor), 0));
  if ((nota.duplicatas || []).length && Math.abs(dup - C.totais.nota) > 0.01) p.push(`As duplicatas somam ${dup.toFixed(2)} e a nota ${C.totais.nota.toFixed(2)}.`);
  return p;
}

const dec = (v, c = 2) => (+v || 0).toFixed(c);
/**
 * JSON da Focus NFe (POST /v2/nfe?ref=...). Os nomes do grupo de IBS/CBS seguem a documentação de campos da Focus;
 * os de IBS UF e IBS Município devem ser conferidos na primeira emissão em homologação.
 */
export function payloadFocus(nota, emit, cfg = {}) {
  const C = calcular(nota.itens || [], nota, cfg), d = nota.destinatario || {}, doc = so(d.documento), simples = [1, 2, 4].includes(+cfg.crt), t = nota.transporte || {};
  const limpa = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null));
  const p = limpa({
    natureza_operacao: nota.natureza_operacao, data_emissao: nota.data_emissao, data_entrada_saida: nota.data_saida || nota.data_emissao, tipo_documento: +nota.tipo_documento, finalidade_emissao: +nota.finalidade || 1,
    local_destino: localDestino(emit.uf, d.uf), consumidor_final: nota.consumidor_final ? 1 : 0, presenca_comprador: +(nota.presenca ?? 9), modalidade_frete: +(t.modalidade ?? 9),
    cnpj_emitente: so(emit.cnpj), nome_emitente: emit.razao_social || emit.nome, nome_fantasia_emitente: emit.nome_fantasia, logradouro_emitente: emit.logradouro, numero_emitente: emit.numero, complemento_emitente: emit.complemento,
    bairro_emitente: emit.bairro, municipio_emitente: emit.municipio, uf_emitente: emit.uf, cep_emitente: so(emit.cep), telefone_emitente: so(emit.telefone), inscricao_estadual_emitente: so(emit.ie), regime_tributario_emitente: +cfg.crt || 3,
    [doc.length === 11 ? 'cpf_destinatario' : 'cnpj_destinatario']: doc, nome_destinatario: d.nome, inscricao_estadual_destinatario: so(d.ie), indicador_inscricao_estadual_destinatario: +(d.indicador_ie ?? 9),
    logradouro_destinatario: d.logradouro, numero_destinatario: d.numero, complemento_destinatario: d.complemento, bairro_destinatario: d.bairro, municipio_destinatario: d.municipio, uf_destinatario: d.uf, cep_destinatario: so(d.cep),
    pais_destinatario: 'Brasil', telefone_destinatario: so(d.telefone), email_destinatario: d.email,
    valor_produtos: dec(C.totais.produtos), valor_frete: dec(C.totais.frete), valor_seguro: dec(C.totais.seguro), valor_desconto: dec(C.totais.desconto), valor_outras_despesas: dec(C.totais.outras), valor_ipi: dec(C.totais.ipi), valor_total: dec(C.totais.nota),
    informacoes_adicionais_contribuinte: nota.info_complementar, informacoes_adicionais_fisco: nota.info_fisco,
    nome_transportador: t.nome, [so(t.documento).length === 11 ? 'cpf_transportador' : 'cnpj_transportador']: so(t.documento) || null, inscricao_estadual_transportador: so(t.ie), endereco_transportador: t.endereco, municipio_transportador: t.municipio, uf_transportador: t.uf,
    veiculo_placa: t.placa, veiculo_uf: t.placa_uf,
  });
  if (n(t.volumes) || n(t.peso_bruto)) p.volumes = [limpa({ quantidade: n(t.volumes) || null, especie: t.especie, marca: t.marca, numero: t.numeracao, peso_liquido: n(t.peso_liquido) ? dec(t.peso_liquido, 3) : null, peso_bruto: n(t.peso_bruto) ? dec(t.peso_bruto, 3) : null })];
  if ((nota.referenciadas || []).length) p.notas_referenciadas = nota.referenciadas.filter(c => so(c).length === 44).map(c => ({ chave_nfe: so(c) }));
  const dups = nota.duplicatas || [];
  if (dups.length) { p.numero_fatura = dups[0].numero.split('/')[0] || '1'; p.valor_original_fatura = dec(C.totais.nota); p.valor_liquido_fatura = dec(C.totais.nota);
    p.duplicatas = dups.map(x => ({ numero: String(x.numero).split('/').pop(), data_vencimento: x.vencimento, valor: dec(x.valor) })); }
  p.formas_pagamento = [{ forma_pagamento: +nota.finalidade === 4 || +nota.finalidade === 3 ? '90' : (nota.forma_pagamento || (dups.length ? '15' : '90')), valor_pagamento: +nota.finalidade === 4 || +nota.finalidade === 3 || (nota.forma_pagamento || (dups.length ? '15' : '90')) === '90' ? '0.00' : dec(C.totais.nota), indicador_pagamento: dups.length ? 1 : 0 }];
  p.items = C.itens.map(i => limpa({
    numero_item: i.numero_item, codigo_produto: i.codigo || String(i.numero_item), descricao: i.descricao, cfop: String(i.cfop), codigo_ncm: so(i.ncm), unidade_comercial: i.unidade, quantidade_comercial: dec(i.quantidade, 4), valor_unitario_comercial: dec(i.valor_unitario, 10).replace(/0+$/, '').replace(/\.$/, '.00'),
    unidade_tributavel: i.unidade, quantidade_tributavel: dec(i.quantidade, 4), valor_unitario_tributavel: dec(i.valor_unitario, 10).replace(/0+$/, '').replace(/\.$/, '.00'), valor_bruto: dec(i.valor_bruto), valor_desconto: i.desconto ? dec(i.desconto) : null,
    valor_frete: i.frete ? dec(i.frete) : null, valor_seguro: i.seguro ? dec(i.seguro) : null, valor_outras_despesas: i.outras ? dec(i.outras) : null, inclui_no_total: 1, informacoes_adicionais_item: i.info,
    icms_origem: String(i.icms_origem ?? '0'), icms_situacao_tributaria: String(i.icms_cst),
    ...(!simples && i.icms_base ? { icms_modalidade_base_calculo: 3, icms_base_calculo: dec(i.icms_base), icms_aliquota: dec(i.icms_aliquota), icms_valor: dec(i.icms_valor), icms_reducao_base_calculo: n(i.icms_reducao) ? dec(i.icms_reducao) : null } : {}),
    ipi_situacao_tributaria: String(i.ipi_cst), ipi_codigo_enquadramento_legal: String(i.ipi_enquadramento || '999'), ...(i.ipi_base ? { ipi_base_calculo: dec(i.ipi_base), ipi_aliquota: dec(i.ipi_aliquota), ipi_valor: dec(i.ipi_valor) } : {}),
    pis_situacao_tributaria: String(i.pis_cst), ...(i.pis_base ? { pis_base_calculo: dec(i.pis_base), pis_aliquota_porcentual: dec(i.pis_aliquota), pis_valor: dec(i.pis_valor) } : {}),
    cofins_situacao_tributaria: String(i.cofins_cst), ...(i.cofins_base ? { cofins_base_calculo: dec(i.cofins_base), cofins_aliquota_porcentual: dec(i.cofins_aliquota), cofins_valor: dec(i.cofins_valor) } : {}),
    ...(String(i.ibs_cbs_cst || '').trim() ? { ibs_cbs_situacao_tributaria: String(i.ibs_cbs_cst), ibs_cbs_classificacao_tributaria: so(i.ibs_cbs_classificacao), ibs_cbs_base_calculo: dec(i.ibs_cbs_base),
      cbs_aliquota: dec(i.cbs_aliquota, 4), cbs_valor: dec(i.cbs_valor), ibs_uf_aliquota: dec(i.ibs_uf_aliquota, 4), ibs_uf_valor: dec(i.ibs_uf_valor), ibs_mun_aliquota: dec(i.ibs_mun_aliquota, 4), ibs_mun_valor: dec(i.ibs_mun_valor), ibs_valor_total: dec(i.ibs_uf_valor + i.ibs_mun_valor) } : {}),
  }));
  return p;
}

/** dados para a prévia do DANFE (mesmo formato de lerDanfe), antes de a nota existir na SEFAZ */
export function dadosDanfe(nota, emit, cfg = {}) {
  const C = calcular(nota.itens || [], nota, cfg), d = nota.destinatario || {}, t = nota.transporte || {}, T = C.totais, rtc = C.itens.some(i => String(i.ibs_cbs_cst || '').trim());
  return {
    crt: String(cfg.crt || 3), chave: so(nota.chave), numero: String(nota.numero || '0'), serie: String(nota.serie || cfg.serie || '1'), tipo: String(nota.tipo_documento ?? 1), natureza: nota.natureza_operacao || '', ambiente: nota.ambiente === 'producao' ? '1' : '2',
    emissao: nota.data_emissao || '', saida: nota.data_saida || nota.data_emissao || '', protocolo: nota.protocolo || '', autorizada_em: nota.autorizada_em || '', cstat: '',
    emit: { nome: emit.razao_social || emit.nome || '', fant: emit.nome_fantasia || '', doc: so(emit.cnpj), ie: so(emit.ie), iest: '', lgr: emit.logradouro || '', nro: emit.numero || '', cpl: emit.complemento || '', bairro: emit.bairro || '', mun: emit.municipio || '', uf: emit.uf || '', cep: so(emit.cep), fone: emit.telefone || '' },
    dest: { nome: d.nome || '', doc: so(d.documento), ie: so(d.ie), lgr: d.logradouro || '', nro: d.numero || '', cpl: d.complemento || '', bairro: d.bairro || '', mun: d.municipio || '', uf: d.uf || '', cep: so(d.cep), fone: d.telefone || '' },
    dups: (nota.duplicatas || []).map(x => ({ n: x.numero, venc: x.vencimento, valor: +x.valor })),
    tot: { bc: T.icms_base, icms: T.icms, bcst: 0, st: 0, prod: T.produtos, frete: T.frete, seg: T.seguro, desc: T.desconto, outro: T.outras, ipi: T.ipi, trib: null, nf: T.nota },
    totRtc: rtc ? { cbs: T.cbs, ibsUF: T.ibs_uf, ibsMun: T.ibs_mun, is: null, ibsMono: null, cbsMono: null, ibsMonoRet: null, cbsMonoRet: null } : null,
    transp: { mod: String(t.modalidade ?? 9), nome: t.nome || '', doc: so(t.documento), ie: so(t.ie), ender: t.endereco || '', mun: t.municipio || '', uf: t.uf || '', placa: t.placa || '', placa_uf: t.placa_uf || '', qvol: t.volumes ? String(t.volumes) : '', esp: t.especie || '', marca: t.marca || '', nvol: t.numeracao || '', pesoL: n(t.peso_liquido) || null, pesoB: n(t.peso_bruto) || null },
    infCpl: nota.info_complementar || '', infFisco: nota.info_fisco || '',
    itens: C.itens.map(i => ({ cod: i.codigo, desc: i.descricao, ncm: so(i.ncm), cst: String(i.icms_origem ?? '0') + String(i.icms_cst || ''), cfop: String(i.cfop || ''), un: i.unidade, qtd: n(i.quantidade), vun: n(i.valor_unitario), vtot: i.valor_bruto,
      bc: i.icms_base, vicms: i.icms_valor, picms: i.icms_base ? n(i.icms_aliquota) : 0, vipi: i.ipi_valor, pipi: i.ipi_base ? n(i.ipi_aliquota) : 0, info: i.info || '',
      rtc: String(i.ibs_cbs_cst || '').trim() ? { classTrib: so(i.ibs_cbs_classificacao), cst: i.ibs_cbs_cst, bc: i.ibs_cbs_base, pIBSUF: n(i.ibs_uf_aliquota), vIBSUF: i.ibs_uf_valor, pIBSMun: n(i.ibs_mun_aliquota), vIBSMun: i.ibs_mun_valor, pCBS: n(i.cbs_aliquota), vCBS: i.cbs_valor, bcIS: null, pIS: null, vIS: null } : null })),
  };
}

/** traduz o retorno da Focus para a situação da plataforma */
export function situacaoFocus(r) {
  const s = r?.status;
  if (s === 'autorizado') return 'autorizada';
  if (s === 'cancelado') return 'cancelada';
  if (s === 'processando_autorizacao') return 'processando';
  if (s === 'denegado') return 'denegada';
  if (s === 'erro_autorizacao' || r?.codigo || r?.erros) return 'erro';
  return 'processando';
}
/** mensagens de erro da Focus/SEFAZ em uma lista de textos */
export function errosFocus(r) {
  const L = [];
  if (r?.mensagem_sefaz && r.status !== 'autorizado' && r.status !== 'cancelado') L.push(`${r.status_sefaz ? r.status_sefaz + ' - ' : ''}${r.mensagem_sefaz}`);
  if (r?.mensagem && !r?.erros?.length) L.push(r.mensagem);
  for (const e of r?.erros || []) L.push(`${e.campo ? e.campo + ': ' : ''}${e.mensagem || e.codigo || ''}`);
  return L;
}
