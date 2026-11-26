// Base fiscal da compra inteligente (SQL 199/200): regime e UF da empresa, parâmetros da Apuração (PRODEPE, FEEF, PIS/COFINS),
// alíquota interna por NCM e as alíquotas da reforma. Usada no mapa da requisição (CMP002) e no cotado × realizado do pedido (CMP003).
import { sb, state, q, fetchAll } from './data.js';
import { today } from './ui.js';
import { fatorIcmsEfetivo } from './aquisicao.js';
import { aliqInterna } from './competitividade.js';

export async function baseFiscal(par) {
  const e = state.empresa.id, hoje = today(), um = (x) => (Array.isArray(x) ? x[0] : x) || null;
  const [trib, fisc, interna, anos] = await Promise.all([
    q(sb.from('empresa_tributacao').select('*').eq('empresa_id', e).lte('vigencia_inicio', hoje).order('vigencia_inicio', { ascending: false }).limit(1)).then(um).catch(() => null),
    q(sb.from('fisc_param').select('*').eq('empresa_id', e).lte('vigencia_inicio', hoje).order('vigencia_inicio', { ascending: false }).limit(1)).then(um).catch(() => null),
    fetchAll(() => sb.from('fisc_icms_interna').select('*').eq('empresa_id', e)).catch(() => []),
    q(sb.from('trib_aliquotas').select('*').eq('empresa_id', e).order('ano')).catch(() => [])]);
  const nos = { uf: trib?.uf || null, ipi_contribuinte: par?.aq_ipi_contribuinte !== false, pc_nao_cumulativo: trib?.pis_cofins ? trib.pis_cofins === 'nao_cumulativo' : !['simples', 'mei'].includes(trib?.regime),
    simples: ['simples', 'mei'].includes(trib?.regime), ibscbs_regular: !!trib?.ibscbs_regular };
  const P = { pc_pct: fisc ? (+fisc.pis_pct || 0) + (+fisc.cofins_pct || 0) || 9.25 : 9.25, pc_excluir_icms: fisc?.pc_excluir_icms !== false, pc_incluir_frete: fisc?.pc_incluir_frete !== false,
    pc_incluir_ipi: !!fisc?.pc_incluir_ipi, ciap_meses: par?.aq_ciap_meses || 48, taxa_mensal: +(par?.taxa_mensal_vp ?? 1.5),
    fator_icms: fatorIcmsEfetivo(fisc, { prodepe_saidas_pct: +(par?.aq_prodepe_saidas_pct ?? 100) }), simples_credito_ibs_pct: +(par?.aq_simples_credito_ibs_pct || 0),
    internaDe: (ncm) => aliqInterna(interna, nos.uf, ncm, hoje)?.aliquota ?? null };
  return { nos, P, fisc, anos, semInterna: !interna.length, semUf: !nos.uf, reforma: !!par?.aq_reforma };
}
