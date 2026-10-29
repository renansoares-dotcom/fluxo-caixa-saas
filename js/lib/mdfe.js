// MDF-e (Manifesto Eletrônico de Documentos Fiscais) — dados e conferência da ficha do frete. Regras puras, testáveis.
// Leiaute MDF-e 3.00 (modal rodoviário) e NT 2026.001: a partir de 23/11/2026 a Sefaz recusa (rejeição 684) o MDF-e
// de quem informa o tipo do transportador — no caso da IPLAMM, carga própria em veículo de terceiro — sem o grupo do CIOT.
// Aqui ficam: tabelas de códigos, validação de chave/placa/RNTRC, a lista do que falta e o MDF-e montado (estrutura
// do leiaute) que servirá para a emissão pela plataforma (serviço de emissão, a contratar) e para o resumo impresso.
import { cpfValido, cnpjValido } from './documentos.js';

export const DATA_CIOT_MDFE = '2026-11-23';
export const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
// prodPred/tpCarga
export const TP_CARGA = { '01': 'Granel sólido', '02': 'Granel líquido', '03': 'Frigorificada', '04': 'Conteinerizada', '05': 'Carga geral', '06': 'Neogranel',
  '07': 'Perigosa (granel sólido)', '08': 'Perigosa (granel líquido)', '09': 'Perigosa (frigorificada)', '10': 'Perigosa (conteinerizada)', '11': 'Perigosa (carga geral)' };
// veicTracao/tpRod e tpCar
export const TP_ROD = { '01': 'Truck', '02': 'Toco', '03': 'Cavalo mecânico', '04': 'Van', '05': 'Utilitário', '06': 'Outros' };
export const TP_CAR = { '00': 'Não aplicável', '01': 'Aberta', '02': 'Fechada / baú', '03': 'Graneleira', '04': 'Porta-contêiner', '05': 'Sider' };
// prop/tpProp — proprietário do veículo de terceiro
export const TP_PROP = { '0': 'TAC agregado', '1': 'TAC independente', '2': 'Outros (transportadora/cooperativa)' };
// infPag/Comp/tpComp
export const TP_COMP = { '01': 'Vale-pedágio', '02': 'Impostos, taxas e contribuições', '03': 'Despesas (bancárias, meio de pagamento, outras)', '99': 'Outros' };
export const RESP_SEG = { '1': 'Emitente do MDF-e (IPLAMM)', '2': 'Contratante do serviço de transporte' };

export const soDig = (s) => String(s ?? '').replace(/\D/g, '');
const vazio = (s) => !String(s ?? '').trim();
const r2 = (v) => Math.round((+v || 0) * 100) / 100;

/** chave de acesso de 44 dígitos com dígito verificador (módulo 11, pesos 2 a 9) */
export function chaveValida(ch) {
  const c = soDig(ch); if (c.length !== 44) return false;
  let s = 0, p = 2;
  for (let i = 42; i >= 0; i--) { s += +c[i] * p; p = p === 9 ? 2 : p + 1; }
  const dv = s % 11 < 2 ? 0 : 11 - (s % 11);
  return dv === +c[43];
}
/** placa antiga (ABC1234) ou Mercosul (ABC1D23) */
export const placaValida = (p) => /^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
export const limparPlaca = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** RNTRC: 8 dígitos */
export const rntrcValido = (r) => /^\d{8}$/.test(String(r ?? '').replace(/[\s.\-/]/g, ''));
/** CIOT: 12 dígitos (tipo TCIOT do leiaute) */
export const ciotValido = (c) => /^\d{12}$/.test(soDig(c));
export const docValido = (d) => { const x = soDig(d); return x.length === 11 ? cpfValido(x) : x.length === 14 ? cnpjValido(x) : false; };

/** a IPLAMM emite o MDF-e (carga própria) com veículo de terceiro: CIOT obrigatório (NT 2026.001, rejeição 684) */
export const ciotObrigatorio = (f, t) => f?.mdfe_emissor === 'iplamm' && !!t;
export const ehAutonomo = (t) => ['tac', 'tac_eq', 'ctc'].includes(t?.tipo);

/** dados do MDF-e com os padrões da empresa por baixo (o que está na ficha vale mais) */
export function dadosMDFe(f, padrao = {}) {
  const m = f?.mdfe || {};
  return {
    uf_ini: m.uf_ini || '', uf_fim: m.uf_fim || '', percurso: m.percurso || [],
    carregamento: m.carregamento?.length ? m.carregamento : (padrao.carregamento || []),
    descarga: m.descarga || [],                                   // [{cmun, xmun, uf, chaves: [..]}]
    veiculo: (() => { const v = { renavam: '', tara: null, cap_kg: null, uf: '', tp_rod: '', tp_car: '', ...(m.veiculo || {}) }; v.placa = limparPlaca(v.placa || f?.placa || ''); return v; })(),
    reboques: m.reboques || [],                                   // [{placa, renavam, tara, cap_kg, uf, tp_car}]
    prop: { tp_prop: '1', ...(m.prop || {}) },                    // proprietário (vem do transportador)
    condutor: { nome: m.condutor?.nome || f?.motorista || '', cpf: m.condutor?.cpf || '' },
    seguro: { resp: '1', ...(padrao.seguro || {}), ...(m.seguro || {}) },          // {resp, nome, cnpj, apolice, averbacoes:[]}
    prod: { tp_carga: '05', ...(padrao.prod || {}), ...(m.prod || {}) },           // {tp_carga, nome, ncm}
    peso_kg: m.peso_kg ?? null, valor_carga: m.valor_carga ?? null,
    ciot_resp: m.ciot_resp || padrao.ciot_resp || '',            // CPF/CNPJ do responsável pela geração do CIOT
    pag: { ind_pag: '0', forma: 'ipef', ...(padrao.pag || {}), ...(m.pag || {}) },  // {ind_pag, forma ipef|pix|banco, cnpj_ipef, pix, banco, agencia, comp:[{tp, valor}], prazos:[{venc, valor}]}
    pedagio: { cnpj_forn: '', cnpj_pagador: '', ...(padrao.pedagio || {}), ...(m.pedagio || {}) },
    info: m.info || '', situacao: m.situacao || 'rascunho',
  };
}

/** chaves de todas as NF-e do manifesto */
export const chavesDe = (d) => (d.descarga || []).flatMap(x => x.chaves || []);

/** o que falta para emitir. Vazio = pronto. Cada item: { campo, txt, grave } (grave = a Sefaz recusa sem isso) */
export function faltasMDFe(f, t, padrao = {}) {
  const r = [], add = (campo, txt, grave = true) => r.push({ campo, txt, grave });
  if (!f) return [{ campo: 'frete', txt: 'frete', grave: true }];
  if (!f.mdfe_emissor) { add('emissor', 'quem emite o MDF-e (IPLAMM ou transportadora)'); return r; }
  if (f.mdfe_emissor === 'transportadora') {
    if (vazio(f.mdfe_chave) && vazio(f.cte_chave)) add('cte', 'chave do CT-e ou do MDF-e da transportadora', false);
    if (vazio(f.ciot)) add('ciot', 'CIOT gerado pela transportadora', false);
    return r;
  }
  const d = dadosMDFe(f, padrao);
  if (!t) add('transportador', 'transportador (dono do veículo)');
  if (!UFS.includes(d.uf_ini)) add('uf_ini', 'UF de início da viagem');
  if (!UFS.includes(d.uf_fim)) add('uf_fim', 'UF de fim da viagem');
  if ((d.percurso || []).some(u => !UFS.includes(u))) add('percurso', 'UF do percurso inválida');
  if (!d.carregamento.length || d.carregamento.some(c => !/^\d{7}$/.test(c.cmun || ''))) add('carregamento', 'município de carregamento (código IBGE)');
  if (!d.descarga.length) add('descarga', 'município de descarregamento e NF-e');
  for (const x of d.descarga) {
    if (!/^\d{7}$/.test(x.cmun || '')) add('descarga', `código IBGE do município ${x.xmun || ''}`.trim());
    if (!(x.chaves || []).length) add('descarga', `NF-e de ${x.xmun || 'um município de descarga'}`);
  }
  const ch = chavesDe(d);
  const ruins = ch.filter(c => !chaveValida(c)); if (ruins.length) add('descarga', `chave de NF-e inválida (${ruins.length})`);
  if (new Set(ch).size !== ch.length) add('descarga', 'NF-e repetida no manifesto');
  const ufsDesc = [...new Set(d.descarga.map(x => x.uf).filter(Boolean))];
  if (d.uf_fim && ufsDesc.length && !ufsDesc.includes(d.uf_fim)) add('uf_fim', `UF de fim (${d.uf_fim}) diferente da UF de descarga (${ufsDesc.join(', ')})`);
  // veículo de tração
  if (!placaValida(d.veiculo.placa)) add('veiculo', 'placa do veículo');
  if (!(+d.veiculo.tara > 0)) add('veiculo', 'tara do veículo (kg)');
  if (!TP_ROD[d.veiculo.tp_rod]) add('veiculo', 'tipo de rodado');
  if (!TP_CAR[d.veiculo.tp_car]) add('veiculo', 'tipo de carroceria');
  if (!UFS.includes(d.veiculo.uf)) add('veiculo', 'UF de licenciamento do veículo');
  d.reboques.forEach((x, i) => { if (!placaValida(x.placa) || !(+x.tara > 0) || !UFS.includes(x.uf)) add('reboque', `dados do reboque ${i + 1} (placa, tara, UF)`); });
  // proprietário (veículo de terceiro)
  if (t) {
    if (!docValido(t.documento)) add('prop', 'CPF/CNPJ do transportador (dono do veículo)');
    if (!rntrcValido(t.rntrc)) add('prop', 'RNTRC do transportador (8 dígitos)');
    if (!TP_PROP[d.prop.tp_prop]) add('prop', 'tipo do proprietário');
  }
  // condutor
  if (vazio(d.condutor.nome)) add('condutor', 'nome do motorista');
  if (!cpfValido(soDig(d.condutor.cpf))) add('condutor', 'CPF do motorista');
  // carga
  if (!(+d.peso_kg > 0)) add('carga', 'peso bruto da carga (kg)');
  if (!(+d.valor_carga > 0)) add('carga', 'valor total da carga');
  if (!TP_CARGA[d.prod.tp_carga] || vazio(d.prod.nome)) add('carga', 'produto predominante (tipo e descrição)');
  if (d.prod.ncm && !/^\d{8}$/.test(soDig(d.prod.ncm))) add('carga', 'NCM do produto predominante (8 dígitos)', false);
  if (+d.peso_kg > 0 && +d.veiculo.cap_kg > 0 && +d.peso_kg > +d.veiculo.cap_kg + (d.reboques || []).reduce((s, x) => s + (+x.cap_kg || 0), 0)) add('carga', 'peso maior que a capacidade do veículo', false);
  // CIOT (NT 2026.001)
  if (ciotObrigatorio(f, t)) {
    if (!ciotValido(f.ciot)) add('ciot', 'CIOT (12 dígitos) — obrigatório a partir de 23/11/2026 (rejeição 684)');
    if (!docValido(d.ciot_resp)) add('ciot', 'CPF/CNPJ do responsável pela geração do CIOT');
  }
  // pagamento do frete (infPag) — operação com autônomo
  if (ehAutonomo(t)) {
    if (!(+f.valor > 0)) add('pag', 'valor do frete (valor do contrato)');
    if (d.pag.forma === 'ipef' && !cnpjValido(soDig(d.pag.cnpj_ipef))) add('pag', 'CNPJ da IPEF que paga o frete');
    if (d.pag.forma === 'pix' && vazio(d.pag.pix)) add('pag', 'chave Pix do autônomo');
    if (d.pag.forma === 'banco' && (vazio(d.pag.banco) || vazio(d.pag.agencia))) add('pag', 'banco e agência do autônomo');
    if (d.pag.ind_pag === '1') {
      const soma = r2((d.pag.prazos || []).reduce((s, p) => s + (+p.valor || 0), 0));
      if (!(d.pag.prazos || []).length || soma !== r2(f.valor)) add('pag', 'parcelas do pagamento a prazo (soma = valor do frete)');
    }
    const comp = r2((d.pag.comp || []).reduce((s, c) => s + (+c.valor || 0), 0));
    if (comp > r2(f.valor)) add('pag', 'componentes do pagamento maiores que o valor do frete');
  }
  // seguro da carga (recomendado: informe o da IPLAMM)
  const s = d.seguro;
  if (vazio(s.nome) || !cnpjValido(soDig(s.cnpj)) || vazio(s.apolice)) add('seguro', 'seguro da carga (seguradora, CNPJ e apólice)', false);
  // vale-pedágio
  if (!f.pedagio_nao_ha && +f.pedagio_valor > 0 && (!cnpjValido(soDig(d.pedagio.cnpj_forn)) || vazio(f.pedagio_comprovante))) add('pedagio', 'fornecedor (CNPJ) e nº do comprovante do vale-pedágio', false);
  return r;
}
export const graves = (fs) => fs.filter(x => x.grave);
export const prontoMDFe = (f, t, padrao) => graves(faltasMDFe(f, t, padrao)).length === 0;

/** agrupa NF-e (de log_mdfe_notas) por município de descarga e soma peso e valor */
export function descargaDasNotas(notas) {
  const g = new Map();
  for (const n of notas || []) {
    const k = n.cmun || n.xmun || '?';
    if (!g.has(k)) g.set(k, { cmun: n.cmun || '', xmun: n.xmun || '', uf: n.uf || '', chaves: [] });
    if (n.chave && !g.get(k).chaves.includes(n.chave)) g.get(k).chaves.push(n.chave);
  }
  const peso = r2((notas || []).reduce((s, n) => s + (+n.peso_kg || 0), 0));
  const valor = r2((notas || []).reduce((s, n) => s + (+n.v_nf || 0), 0));
  const prod = [...(notas || [])].sort((a, b) => (+b.v_nf || 0) - (+a.v_nf || 0))[0];
  const emit = (notas || []).find(n => n.emit_cmun);
  return { descarga: [...g.values()], peso_kg: peso || null, valor_carga: valor || null,
    produto: prod ? { nome: prod.produto || '', ncm: prod.ncm || '' } : null,
    carregamento: emit ? [{ cmun: emit.emit_cmun, xmun: emit.emit_xmun, uf: emit.emit_uf }] : null };
}

/** MDF-e montado no formato dos grupos do leiaute 3.00 (base para o serviço de emissão e para o resumo impresso) */
export function montarMDFe(f, t, emp, padrao = {}) {
  const d = dadosMDFe(f, padrao), ter = !!t;
  return {
    ide: { tpAmb: null, tpEmit: f.mdfe_emissor === 'iplamm' ? 2 : 1, mod: 58, modal: 1, dhEmi: null, tpEmis: 1, UFIni: d.uf_ini, UFFim: d.uf_fim,
      infMunCarrega: d.carregamento.map(c => ({ cMunCarrega: c.cmun, xMunCarrega: c.xmun })), infPercurso: d.percurso.map(u => ({ UFPer: u })) },
    emit: { CNPJ: soDig(emp?.cnpj), IE: soDig(emp?.ie), xNome: emp?.razao_social || emp?.nome || '' },
    infModal: { rodo: {
      infANTT: {
        infCIOT: ciotValido(f.ciot) ? [{ CIOT: soDig(f.ciot), [soDig(d.ciot_resp).length === 11 ? 'CPF' : 'CNPJ']: soDig(d.ciot_resp) }] : [],
        valePed: !f.pedagio_nao_ha && +f.pedagio_valor > 0 ? { disp: [{ CNPJForn: soDig(d.pedagio.cnpj_forn), CNPJPg: soDig(d.pedagio.cnpj_pagador) || undefined, nCompra: f.pedagio_comprovante || '', vValePed: r2(f.pedagio_valor) }] } : null,
        infContratante: [{ CNPJ: soDig(emp?.cnpj), xNome: emp?.razao_social || emp?.nome || '' }],
        infPag: ehAutonomo(t) ? [{
          xNome: t.nome, [soDig(t.documento).length === 11 ? 'CPF' : 'CNPJ']: soDig(t.documento),
          Comp: (d.pag.comp?.length ? d.pag.comp : [{ tp: '99', valor: f.valor }]).map(c => ({ tpComp: c.tp, vComp: r2(c.valor), xComp: TP_COMP[c.tp] })),
          vContrato: r2(f.valor), indPag: +d.pag.ind_pag,
          infPrazo: d.pag.ind_pag === '1' ? (d.pag.prazos || []).map((p, i) => ({ nParcela: String(i + 1).padStart(3, '0'), dVenc: p.venc, vParcela: r2(p.valor) })) : undefined,
          infBanc: d.pag.forma === 'ipef' ? { CNPJIPEF: soDig(d.pag.cnpj_ipef) } : d.pag.forma === 'pix' ? { PIX: d.pag.pix } : { codBanco: d.pag.banco, codAgencia: d.pag.agencia } }] : [],
      },
      veicTracao: { placa: d.veiculo.placa, RENAVAM: d.veiculo.renavam || undefined, tara: Math.round(+d.veiculo.tara || 0), capKG: +d.veiculo.cap_kg ? Math.round(+d.veiculo.cap_kg) : undefined,
        tpRod: d.veiculo.tp_rod, tpCar: d.veiculo.tp_car, UF: d.veiculo.uf,
        prop: ter ? { [soDig(t.documento).length === 11 ? 'CPF' : 'CNPJ']: soDig(t.documento), RNTRC: soDig(t.rntrc), xNome: t.nome, UF: d.veiculo.uf, tpProp: d.prop.tp_prop } : undefined,
        condutor: [{ xNome: d.condutor.nome, CPF: soDig(d.condutor.cpf) }] },
      veicReboque: d.reboques.map(x => ({ placa: limparPlaca(x.placa), RENAVAM: x.renavam || undefined, tara: Math.round(+x.tara || 0), capKG: Math.round(+x.cap_kg || 0), tpCar: x.tp_car || '00', UF: x.uf,
        prop: ter ? { [soDig(t.documento).length === 11 ? 'CPF' : 'CNPJ']: soDig(t.documento), RNTRC: soDig(t.rntrc), xNome: t.nome, UF: x.uf, tpProp: d.prop.tp_prop } : undefined })),
    } },
    infDoc: { infMunDescarga: d.descarga.map(x => ({ cMunDescarga: x.cmun, xMunDescarga: x.xmun, infNFe: (x.chaves || []).map(c => ({ chNFe: soDig(c) })) })) },
    seg: d.seguro.nome ? [{ infResp: { respSeg: +d.seguro.resp, CNPJ: d.seguro.resp === '2' ? soDig(emp?.cnpj) : undefined }, infSeg: { xSeg: d.seguro.nome, CNPJ: soDig(d.seguro.cnpj) },
      nApol: d.seguro.apolice, nAver: (d.seguro.averbacoes || []).filter(Boolean) }] : [],
    prodPred: { tpCarga: d.prod.tp_carga, xProd: d.prod.nome, NCM: soDig(d.prod.ncm) || undefined },
    tot: { qNFe: chavesDe(d).length, vCarga: r2(d.valor_carga), cUnid: '01', qCarga: Math.round((+d.peso_kg || 0) * 10000) / 10000 },
    infAdic: { infCpl: d.info || undefined },
  };
}

/** dias até a data (data local, sem horas) */
export const diasAte = (iso, hoje = new Date().toISOString().slice(0, 10)) => Math.round((Date.parse(iso + 'T12:00:00Z') - Date.parse(hoje + 'T12:00:00Z')) / 864e5);
