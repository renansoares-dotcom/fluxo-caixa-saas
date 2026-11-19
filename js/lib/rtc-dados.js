// Carrega as tabelas oficiais de classificação do IBS/CBS (SQL 171) uma vez por sessão e devolve os índices de js/lib/rtc.js.
// São tabelas de referência iguais para todas as empresas; se ainda não existirem no banco, devolve a tabela vazia (as telas seguem sem a conferência oficial).
import { sb, q, fetchAll } from './data.js';
import { indexar } from './rtc.js';

let cache = null;
export async function carregarRtc() {
  if (cache) return cache;
  try {
    const [base, cst, classtrib, ncm, exc] = await Promise.all([
      q(sb.from('rtc_base').select('*').eq('id', 1).maybeSingle()),
      q(sb.from('rtc_cst').select('*')),
      fetchAll(() => sb.from('rtc_classtrib').select('*').order('codigo')),
      fetchAll(() => sb.from('rtc_classtrib_ncm').select('id, codigo, ncm, inicio, fim').order('id')),
      fetchAll(() => sb.from('rtc_classtrib_ncm_exc').select('id, vinculo_id, ncm, inicio, fim').order('id'))]);
    cache = indexar({ base, cst, classtrib, ncm, exc });
  } catch { return indexar(); }   // sem a tabela (SQL 171 ainda não aplicado): não guarda, para tentar de novo depois
  return cache;
}
/** texto da origem da base, para o rodapé das telas */
export const origemRtc = (T) => T && !T.vazio && T.base ? `Tabela oficial da Receita Federal (base ${T.base.versao_base}${T.base.calculadora ? ', calculadora ' + T.base.calculadora : ''}, carregada em ${new Date(T.base.carregada_em).toLocaleDateString('pt-BR')}): ${T.base.linhas?.classtrib || T.ct.size} classificações.` : '';
