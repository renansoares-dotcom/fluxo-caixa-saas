// Recuperadora: alertas para a Central de Decisões (regra 27) — licenças, ensaio, rendimento, balanço de massa, CDF, adiantamentos e tickets.
import { sb, state, q } from './data.js';
import { alertasParaDecisoes } from './recuperadora.js';

export async function alertasDecisao() {
  try { return alertasParaDecisoes(await q(sb.rpc('rec_alertas', { p_empresa: state.empresa.id }))); } catch { return []; }
}
