// Contratos (SQL 068): tipos, alertas de vigência/aviso prévio/reajuste, índice acumulado (Banco Central) e conferência de assinatura no PDF.
export const TIPOS = {
  locacao_veiculo: 'Locação de veículo (sem motorista)', locacao_veiculo_motorista: 'Locação de veículo com motorista', servico: 'Prestação de serviços',
  transporte_tac: 'Transporte com autônomo (TAC)', agregado: 'Agregado (TAC-agregado)', locacao_imovel: 'Locação de imóvel', fornecimento: 'Fornecimento',
  venda: 'Venda / cliente', confidencialidade: 'Confidencialidade', outro: 'Outro',
};
export const NATUREZA = { pagar: 'A pagar', receber: 'A receber', sem_valor: 'Sem valor' };
export const PERIODO = { mensal: 'Mensal', bimestral: 'Bimestral', trimestral: 'Trimestral', semestral: 'Semestral', anual: 'Anual', unica: 'Parcela única', sem_valor: 'Sem valor' };
export const MESES_PER = { mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 };
export const INDICES = { IPCA: 'IPCA (IBGE)', 'IGP-M': 'IGP-M (FGV)', INPC: 'INPC (IBGE)', fixo: 'Percentual fixo', nenhum: 'Sem reajuste' };
export const STATUS = { rascunho: 'Rascunho', vigente: 'Vigente', encerrado: 'Encerrado', rescindido: 'Rescindido' };
export const ARQ = { assinado: 'Contrato assinado', aditivo: 'Aditivo', minuta: 'Minuta', vistoria: 'Termo de vistoria', outro: 'Outro' };
const SGS = { IPCA: 433, 'IGP-M': 189, INPC: 188 };   // séries mensais (% no mês) do Banco Central

export const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
export const dias = (de, ate) => Math.round((new Date(ate + 'T12:00:00') - new Date(de + 'T12:00:00')) / 86400000);
const r2 = (v) => Math.round(v * 100) / 100;

/** valor mensal equivalente (para somar contratos de periodicidades diferentes) */
export function valorMensal(c) {
  if (c.natureza === 'sem_valor' || !(+c.valor > 0)) return 0;
  const m = MESES_PER[c.periodicidade];
  return m ? +c.valor / m : 0;
}

/** fim da vigência e data limite do aviso prévio (nulo quando indeterminado) */
export function limiteAviso(c) { return c.fim ? addDias(c.fim, -(+c.aviso_previo_dias || 0)) : null; }

/**
 * alertas de um contrato vigente: [{ k, txt, nivel: 'neg'|'warn'|'info', data }]
 * arquivos e reajustes: listas já filtradas do contrato
 */
export function alertas(c, arquivos = [], reajustes = [], hoje = new Date().toISOString().slice(0, 10)) {
  const out = [];
  if (c.status !== 'vigente') return out;
  if (c.fim) {
    const dFim = dias(hoje, c.fim);
    if (dFim < 0 && c.renovacao_automatica) out.push({ k: 'renovar', nivel: 'warn', data: c.fim, txt: `Renovado automaticamente em ${br(c.fim)}: atualize a vigência` });
    else if (dFim < 0) out.push({ k: 'vencido', nivel: 'neg', data: c.fim, txt: `Venceu em ${br(c.fim)}: renove ou encerre` });
    else if (dFim <= 90 && !c.renovacao_automatica) out.push({ k: 'vence', nivel: dFim <= 30 ? 'neg' : 'warn', data: c.fim, txt: `Vence em ${dFim} dia(s) (${br(c.fim)})` });
    const lim = limiteAviso(c);
    if (lim && +c.aviso_previo_dias > 0) {
      const dLim = dias(hoje, lim);
      if (dLim >= 0 && dLim <= 30) out.push({ k: 'aviso', nivel: dLim <= 7 ? 'neg' : 'warn', data: lim, txt: `Último dia para aviso prévio: ${br(lim)} (${dLim} dia(s))` });
    }
  }
  const prop = reajustes.find(r => r.status === 'proposto');
  if (prop) out.push({ k: 'aprovar', nivel: 'warn', data: prop.data_base, txt: `Reajuste de ${pctBR(prop.percentual)} para aprovar` });
  else if (c.data_base && c.indice !== 'nenhum' && c.natureza !== 'sem_valor') {
    const dB = dias(hoje, c.data_base);
    const feito = reajustes.some(r => r.data_base === c.data_base);
    if (!feito && dB <= 30) out.push({ k: 'reajuste', nivel: dB < 0 ? 'neg' : 'warn', data: c.data_base, txt: dB < 0 ? `Reajuste pendente desde ${br(c.data_base)}` : `Reajuste em ${br(c.data_base)}` });
  }
  if (!arquivos.some(a => a.tipo === 'assinado')) out.push({ k: 'sem-pdf', nivel: 'info', data: null, txt: 'Sem o contrato assinado anexado' });
  return out;
}
const br = (iso) => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';
export const pctBR = (v) => `${(+v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;

/** os 12 meses do índice usados para a data-base: do 13º ao 2º mês antes dela (último índice publicado) */
export function janelaIndice(dataBase) {
  const d = new Date(dataBase.slice(0, 7) + '-01T12:00:00');
  const fim = new Date(d); fim.setMonth(fim.getMonth() - 2);       // ex.: data-base 04/2026 → até 02/2026
  const ini = new Date(fim); ini.setMonth(ini.getMonth() - 11);    // → desde 03/2025
  const f = (x) => `${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`;
  return { ini: `01/${f(ini)}`, fim: `01/${f(fim)}`, rotulo: `${f(ini)} a ${f(fim)}` };
}
/** acumula variações mensais (%): (1+a)(1+b)…−1 */
export function acumular(mensais) { return r2Pct(mensais.reduce((acc, v) => acc * (1 + (+v) / 100), 1) * 100 - 100); }
const r2Pct = (v) => Math.round(v * 10000) / 10000;

/** índice acumulado em 12 meses pela API pública do Banco Central (SGS). Lança erro se não conseguir. */
export async function indiceAcumulado(indice, dataBase, fetcher = fetch) {
  const cod = SGS[indice]; if (!cod) throw new Error('Índice sem série no Banco Central');
  const j = janelaIndice(dataBase);
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${cod}/dados?formato=json&dataInicial=${j.ini}&dataFinal=${j.fim}`;
  const r = await fetcher(url); if (!r.ok) throw new Error(`Banco Central respondeu ${r.status}`);
  const dados = await r.json();
  if (!Array.isArray(dados) || dados.length < 12) throw new Error(`O Banco Central ainda não tem os 12 meses (${j.rotulo})`);
  return { percentual: acumular(dados.slice(-12).map(x => String(x.valor).replace(',', '.'))), fonte: `Banco Central, série ${cod} (${indice}), ${j.rotulo}` };
}

/** novo valor com o percentual (2 casas) */
export const reajustar = (valor, pct) => r2(+valor * (1 + (+pct) / 100));

/** o PDF tem assinatura digital? (procura o dicionário de assinatura: /ByteRange + /Sig ou formato CAdES/PKCS#7) */
export function temAssinaturaDigital(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = ''; const passo = 0x8000;
  for (let i = 0; i < u8.length; i += passo) s += String.fromCharCode.apply(null, u8.subarray(i, i + passo));
  return /\/ByteRange\s*\[/.test(s) && /\/Type\s*\/Sig\b|adbe\.pkcs7|ETSI\.CAdES/.test(s);
}

/** próxima vigência numa renovação: mesmo prazo do período anterior */
export function proximaVigencia(c) {
  if (!c.fim) return null;
  const meses = Math.max(1, Math.round(dias(c.inicio, c.fim) / 30.44));
  const d = new Date(c.fim + 'T12:00:00'); d.setMonth(d.getMonth() + meses);
  return d.toISOString().slice(0, 10);
}
