// Regime tributário de cada empresa (SQL 078, tabela empresa_tributacao): Simples Nacional, MEI, Lucro Presumido ou Lucro Real,
// com data de início de vigência. A plataforma usa a linha vigente na data do que estiver calculando (apuração, simulador da
// reforma, RH, DRE). Sem linha cadastrada, as telas avisam e não supõem o regime.
// A parte "pura" (sem banco) é testada em tests/regime.test.js.

export const REGIMES = {
  simples: { t: 'Simples Nacional', c: 'Simples' },
  mei: { t: 'MEI (Simei)', c: 'MEI' },
  presumido: { t: 'Lucro Presumido', c: 'Presumido' },
  real: { t: 'Lucro Real', c: 'Real' },
};
// Anexos da LC 123/2006 (descrição curta, para escolher a atividade)
export const ANEXOS = {
  I: 'Anexo I — comércio',
  II: 'Anexo II — indústria',
  III: 'Anexo III — serviços e transporte de cargas',
  IV: 'Anexo IV — serviços com INSS fora do DAS',
  V: 'Anexo V — serviços técnicos (Fator R)',
};
export const PIS_COFINS = { cumulativo: 'Cumulativo (3,65%)', nao_cumulativo: 'Não cumulativo (9,25%)' };
export const IRPJ = { trimestral: 'Trimestral', anual: 'Anual (estimativa mensal)' };
// teto do Simples e sublimite do ICMS/ISS (LC 123/2006, art. 3º e art. 13-A)
export const TETO_SIMPLES = 4800000;
export const SUBLIMITE = 3600000;
export const TETO_MEI = 81000;

const soDig = (s) => String(s || '').replace(/\D/g, '');

/** linha vigente numa data (AAAA-MM-DD): a de maior início de vigência até a data; null se não houver */
export function vigente(lista = [], data = new Date().toISOString().slice(0, 10)) {
  let r = null;
  for (const x of lista) if (x.vigencia_inicio <= data && (!r || x.vigencia_inicio > r.vigencia_inicio)) r = x;
  return r;
}
/** linha seguinte (para mostrar "até dd/mm") */
export function proxima(lista = [], linha) {
  if (!linha) return null;
  return lista.filter(x => x.vigencia_inicio > linha.vigencia_inicio).sort((a, b) => a.vigencia_inicio.localeCompare(b.vigencia_inicio))[0] || null;
}

export const ehSimples = (r) => r?.regime === 'simples' || r?.regime === 'mei';

/** texto de uma linha para cabeçalhos e avisos: "Simples Nacional · Anexo III · IBS/CBS no DAS" */
export function descricao(r) {
  if (!r) return 'Regime tributário não cadastrado';
  const p = [REGIMES[r.regime]?.t || r.regime];
  if (r.regime === 'simples') {
    const an = [...new Set((r.simples_atividades || []).map(a => a.anexo).filter(Boolean))];
    if (an.length) p.push('Anexo ' + an.join(', '));
    if ((r.simples_atividades || []).some(a => a.fator_r)) p.push('Fator R');
    if (r.sublimite_excedido) p.push('ICMS/ISS fora do DAS (sublimite)');
    p.push(r.ibscbs_regular ? 'IBS/CBS pelo regime regular' : 'IBS/CBS no DAS');
  }
  if (r.regime === 'presumido' || r.regime === 'real') {
    if (r.pis_cofins) p.push('PIS/COFINS ' + (r.pis_cofins === 'nao_cumulativo' ? 'não cumulativo' : 'cumulativo'));
    if (r.irpj_apuracao) p.push('IRPJ/CSLL ' + IRPJ[r.irpj_apuracao].toLowerCase());
  }
  if (r.incentivos) p.push(r.incentivos);
  return p.join(' · ');
}

/** o que falta ou está incoerente na linha (vazio = ok); avisos não impedem gravar, erros sim */
export function conferir(r) {
  const erros = [], avisos = [];
  if (!r?.regime || !REGIMES[r.regime]) erros.push('escolha o regime');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r?.vigencia_inicio || '')) erros.push('informe o início da vigência');
  if (r?.uf && !/^[A-Za-z]{2}$/.test(r.uf)) erros.push('UF com duas letras');
  if (r?.regime === 'simples') {
    const at = r.simples_atividades || [];
    if (!at.length) avisos.push('cadastre ao menos uma atividade com o anexo (o cálculo do DAS depende dele)');
    at.forEach((a, i) => {
      if (!ANEXOS[a.anexo]) erros.push(`atividade ${i + 1}: escolha o anexo`);
      if (a.cnae && soDig(a.cnae).length !== 7) avisos.push(`atividade ${i + 1}: CNAE com 7 dígitos (ex.: 4930-2/02)`);
      if (a.fator_r && a.anexo !== 'V' && a.anexo !== 'III') avisos.push(`atividade ${i + 1}: Fator R só vale entre os anexos III e V`);
    });
    if (r.ibscbs_regular && !['01', '07'].includes(String(r.vigencia_inicio || '').slice(5, 7)))
      avisos.push('a opção do IBS/CBS pelo regime regular vale por semestre: a vigência costuma começar em janeiro ou julho');
  }
  if (r?.regime === 'presumido' && r.pis_cofins === 'nao_cumulativo') erros.push('no Lucro Presumido o PIS/COFINS é cumulativo');
  if (r?.regime === 'real' && !r.pis_cofins) avisos.push('informe o PIS/COFINS (no Lucro Real, em regra, não cumulativo)');
  return { erros, avisos };
}

/** linha pronta para gravar (só os campos do regime escolhido) */
export function normalizar(r, empresaId) {
  const s = r.regime === 'simples' || r.regime === 'mei', lr = r.regime === 'presumido' || r.regime === 'real';
  const txt = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
  return {
    empresa_id: empresaId, vigencia_inicio: r.vigencia_inicio, regime: r.regime,
    pis_cofins: lr ? (r.regime === 'presumido' ? 'cumulativo' : (r.pis_cofins || 'nao_cumulativo')) : null,
    irpj_apuracao: lr ? (r.irpj_apuracao || null) : null,
    simples_atividades: s ? (r.simples_atividades || []).filter(a => a.anexo || a.cnae || a.descricao)
      .map(a => ({ cnae: txt(a.cnae), descricao: txt(a.descricao), anexo: a.anexo || null, fator_r: !!a.fator_r })) : [],
    sublimite_excedido: r.regime === 'simples' && !!r.sublimite_excedido,
    ibscbs_regular: r.regime === 'simples' && !!r.ibscbs_regular,
    incentivos: txt(r.incentivos), uf: txt(r.uf)?.toUpperCase() || null, municipio_ibge: txt(r.municipio_ibge),
    cnae_principal: txt(r.cnae_principal), contabilidade: txt(r.contabilidade), observacao: txt(r.observacao), fonte: txt(r.fonte),
  };
}

// ---------------------------------------------------------------- banco (usa a sessão da plataforma)
let _cache = { emp: null, lista: [], sem: false };
/** lista de vigências da empresa (cache por empresa); sem o SQL 078 devolve [] e marca sem = true */
export async function carregarRegimes(empresaId, force = false) {
  if (!force && _cache.emp === empresaId) return _cache.lista;
  const { sb } = await import('./data.js');
  try {
    const { data, error } = await sb.from('empresa_tributacao').select('*').eq('empresa_id', empresaId).order('vigencia_inicio');
    if (error) throw error;
    _cache = { emp: empresaId, lista: data || [], sem: false };
  } catch { _cache = { emp: empresaId, lista: [], sem: true }; }
  return _cache.lista;
}
export const semTabelaRegime = () => _cache.sem;
export function esquecerRegimes() { _cache = { emp: null, lista: [], sem: false }; }
/** regime vigente da empresa atual na data */
export async function regimeEm(empresaId, data) { return vigente(await carregarRegimes(empresaId), data); }
