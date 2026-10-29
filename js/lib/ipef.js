// CIOT pela IPEF — camada neutra (29/10/2026). Biblioteca pura: monta o pedido de CIOT a partir da ficha do frete e
// confere o que falta, no formato da operação de transporte da ANTT (Res. ANTT 6.078/2026). Quando a IPEF for
// contratada, um adaptador traduz este pedido para a API dela (Repom, Pamcard, e-Frete…) e devolve o retorno no
// formato de lerRetorno(). Nada aqui chama a internet.
import { soDig, dadosMDFe, docValido, rntrcValido, ehAutonomo, chavesDe } from './mdfe.js';

export const TIPO_OPERACAO = { padrao: 'Padrão (uma viagem)', tac_agregado: 'TAC agregado (período)' };
const r2 = (v) => Math.round((+v || 0) * 100) / 100;
const vazio = (s) => !String(s ?? '').trim();

/**
 * Pedido de CIOT de uma viagem (frete com autônomo contratado pela empresa).
 * @param f frete (ficha + f.mdfe)   @param t transportador   @param emp {cnpj, razao_social, nome}
 * @param o {padrao, inicio, fim, operacao}
 */
export function pedidoCIOT(f, t, emp, o = {}) {
  const d = dadosMDFe(f, o.padrao || {});
  const comp = d.pag.comp?.length ? d.pag.comp : [];
  const soma = (tp) => r2(comp.filter(c => c.tp === tp).reduce((s, c) => s + (+c.valor || 0), 0));
  const carga = d.carregamento[0] || {}, descargas = d.descarga.filter(x => x.cmun);
  return {
    operacao: o.operacao || 'padrao',
    referencia: `FRETE-${f.numero}`,                                 // para achar o frete no retorno
    contratante: { documento: soDig(emp?.cnpj), nome: emp?.razao_social || emp?.nome || '' },
    contratado: { documento: soDig(t?.documento), nome: t?.nome || '', rntrc: soDig(t?.rntrc), tipo: t?.tipo || '' },
    motorista: { nome: d.condutor.nome, cpf: soDig(d.condutor.cpf) },
    veiculos: [d.veiculo, ...d.reboques].filter(v => v.placa).map(v => ({ placa: v.placa, rntrc: soDig(t?.rntrc) })),
    origem: { cmun: carga.cmun || '', xmun: carga.xmun || '', uf: carga.uf || d.uf_ini },
    destinos: descargas.map(x => ({ cmun: x.cmun, xmun: x.xmun, uf: x.uf })),
    inicio: o.inicio || f.data || null, fim: o.fim || null,
    carga: { ncm: soDig(d.prod.ncm) || null, natureza: d.prod.nome || '', tipo_carga: f.tipo_carga || 'geral', peso_kg: +d.peso_kg || 0, valor: r2(d.valor_carga),
      nfe: chavesDe(d) },
    distancia_km: +f.km || null, eixos: +f.eixos || null, lotacao: !!f.lotacao,
    valores: { frete: r2(f.valor), piso: f.piso != null ? r2(f.piso) : null, pedagio: f.pedagio_nao_ha ? 0 : r2(f.pedagio_valor),
      impostos: soma('02'), despesas: soma('03'), outros: soma('99') },
    pagamento: { forma: d.pag.forma, a_prazo: d.pag.ind_pag === '1', parcelas: d.pag.ind_pag === '1' ? (d.pag.prazos || []).map(p => ({ venc: p.venc, valor: r2(p.valor) })) : [],
      conta: { banco: t?.conta_banco || d.pag.banco || null, agencia: t?.conta_agencia || d.pag.agencia || null, numero: t?.conta_numero || null, pix: t?.conta_pix || d.pag.pix || null,
        titular: t?.conta_titular || null, vinculo: t?.conta_vinculo || null } },
  };
}

/** o que falta para pedir o CIOT → [{campo, txt}] */
export function faltasCIOT(p) {
  const r = [], add = (campo, txt) => r.push({ campo, txt });
  if (!docValido(p.contratante.documento)) add('contratante', 'CNPJ da empresa contratante');
  if (!docValido(p.contratado.documento)) add('contratado', 'CPF/CNPJ do transportador');
  if (!rntrcValido(p.contratado.rntrc)) add('rntrc', 'RNTRC do transportador (8 dígitos)');
  if (vazio(p.motorista.nome) || !docValido(p.motorista.cpf)) add('motorista', 'motorista e CPF');
  if (!p.veiculos.length) add('veiculo', 'placa do veículo');
  if (!/^\d{7}$/.test(p.origem.cmun)) add('origem', 'município de origem (código IBGE)');
  if (!p.destinos.length || p.destinos.some(x => !/^\d{7}$/.test(x.cmun))) add('destino', 'município de destino (código IBGE)');
  if (!p.inicio) add('inicio', 'data de início da viagem');
  if (!(p.carga.peso_kg > 0)) add('peso', 'peso da carga');
  if (vazio(p.carga.natureza)) add('natureza', 'natureza da carga (produto)');
  if (!(p.valores.frete > 0)) add('frete', 'valor do frete');
  if (p.lotacao && p.valores.piso != null && p.valores.frete < p.valores.piso - 0.005) add('piso', 'frete abaixo do piso mínimo: a ANTT não gera o CIOT');
  if (p.lotacao && !(p.distancia_km > 0)) add('km', 'distância (km)');
  const c = p.pagamento.conta;
  if (p.pagamento.forma !== 'ipef' && vazio(c.pix) && vazio(c.numero)) add('conta', 'conta ou Pix indicado pelo autônomo');
  if (!c.vinculo) add('vinculo', 'de quem é a conta indicada (próprio, cônjuge ou parente)');
  if (p.pagamento.a_prazo) {
    const s = r2(p.pagamento.parcelas.reduce((a, x) => a + (+x.valor || 0), 0));
    if (!p.pagamento.parcelas.length || Math.abs(s - p.valores.frete) > 0.01) add('parcelas', 'parcelas somando o valor do frete');
  }
  return r;
}
/** o CIOT é gerado pela empresa (contratante) só quando ela contrata autônomo */
export const empresaGeraCIOT = (f, t) => ehAutonomo(t) && f?.ciot_por !== 'transportadora';

/**
 * Retorno da IPEF no formato da plataforma (o adaptador de cada IPEF entrega assim).
 * @returns {{ ok: boolean, ciot?: string, protocolo?: string, mensagem?: string, em: string }}
 */
export function lerRetorno(r = {}) {
  const ciot = soDig(r.ciot);
  return { ok: !!r.ok && ciot.length === 12, ciot: ciot || undefined, protocolo: r.protocolo || undefined, mensagem: r.mensagem || (r.ok && ciot.length !== 12 ? 'CIOT devolvido sem 12 dígitos' : undefined),
    em: r.em || new Date().toISOString() };
}
