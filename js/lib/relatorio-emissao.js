// Padrão de relatórios, fase 1 (SQL 174): registra a emissão (código do relatório, número sequencial, quem emitiu) e
// devolve a identificação que sai no cabeçalho. Sem o SQL 174, ou sem internet, o relatório sai do mesmo jeito, sem número.
import { sb, state } from './data.js';
import { codigoDa } from './telas.js';

export const rotaAtual = () => (typeof location === 'undefined' ? '' : location.hash.replace(/^#\/?/, '').split('?')[0]);
/** nome estável do relatório (sem o número do documento): "Pedido de compra PC 123" → "Pedido de compra" */
export const nomeEstavel = (nome) => String(nome || '').replace(/\s+(n[ºo°.]\s*|PC\s+|OP\s+|OS\s+)?\d.*$/i, '').replace(/[\s—–-]+$/, '').trim() || String(nome || '').trim();

let semSql = false;
export async function registrarEmissao({ nome, formato = 'pdf', tipo = 'relatorio', parametros = [], filtros = null, espera = 5000 } = {}) {
  const rota = rotaAtual(), tela = codigoDa(rota) || '';
  const base = { codigo: tela, numero: null, usuario: state.user?.email?.split('@')[0] || '', cnpj: state.empresa?.cnpj || '', quando: new Date(), rota, tela };
  if (semSql || !state.empresa?.id || (typeof navigator !== 'undefined' && navigator.onLine === false)) return base;
  try {
    const rpc = sb.rpc('relp_emitir', { p_empresa: state.empresa.id, p_tela: tela, p_nome: nomeEstavel(nome), p_rota: rota, p_formato: formato, p_tipo: tipo, p_parametros: parametros, p_filtros: filtros });
    const { data, error } = await Promise.race([rpc, new Promise(r => setTimeout(() => r({ error: { message: 'tempo esgotado' } }), espera))]);
    if (error) { if (/relp_emitir|schema cache|does not exist|PGRST202/i.test(error.message || '')) semSql = true; return base; }
    return { ...base, codigo: data.codigo || tela, numero: data.numero ?? null, usuario: data.usuario || base.usuario, cnpj: data.cnpj ?? '', quando: data.emitido_em ? new Date(data.emitido_em) : base.quando };
  } catch { return base; }
}
