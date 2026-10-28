// Fretes contratados e conformidade ANTT (SQL 054) — regras puras, para a tela e para testar.
// Piso mínimo (Res. ANTT 5.867/2020 e atualizações): piso = km × CCD + CC; retorno vazio obrigatório soma 0,92 × CCD × km de retorno.
// Só vale para carga lotação. Autônomo (TAC/TAC equiparado/cooperativa): o contratante gera o CIOT pela IPEF e paga pela IPEF.

export const TIPOS_TRANSP = { tac: 'Autônomo (TAC)', tac_eq: 'Autônomo equiparado (até 3 veículos)', etc: 'Transportadora (ETC)', ctc: 'Cooperativa (CTC)' };
export const TIPO_CURTO = { tac: 'Autônomo', tac_eq: 'Autônomo equip.', etc: 'Transportadora', ctc: 'Cooperativa' };
export const ehAutonomo = (t) => ['tac', 'tac_eq', 'ctc'].includes(t?.tipo);
export const TIPOS_ANEXO = { contrato: 'Contrato', ciot: 'CIOT', mdfe: 'MDF-e', cte: 'CT-e', vale_pedagio: 'Vale-pedágio', comprovante: 'Comprovante de pagamento', outro: 'Outro' };
export const VINCULO = { proprio: 'Do próprio autônomo', conjuge: 'Do cônjuge / companheiro(a)', parente: 'De parente até 2º grau' };
const r2 = (v) => Math.round((+v || 0) * 100) / 100;

/** coeficiente vigente na data: mesma tabela, tipo de carga e eixos, vigência mais recente até a data */
export function coefDe(coefs, { tabela = 'A', tipo_carga = 'geral', eixos }, data) {
  return (coefs || []).filter(c => c.tabela === tabela && c.tipo_carga === tipo_carga && +c.eixos === +eixos && (!data || c.vigencia <= data))
    .sort((a, b) => String(b.vigencia).localeCompare(String(a.vigencia)))[0] || null;
}
export function calcPiso(f, coefs) {
  if (!f.lotacao || !(+f.km > 0) || !f.eixos) return null;
  const c = coefDe(coefs, f, f.data); if (!c) return null;
  return r2(+f.km * +c.ccd + +c.cc + (f.retorno_vazio && +f.km_retorno > 0 ? 0.92 * +c.ccd * +f.km_retorno : 0));
}

/** mesmas regras de log_frete_pendencias (SQL 054): para autônomo são exigências que travam o pagamento; para transportadora, avisos */
export function pendencias(f, t, anexos = []) {
  const r = [];
  if (!t) return ['transportador'];
  const vazio = (s) => !String(s ?? '').trim();
  if (!(+f.valor > 0)) r.push('valor do frete');
  if (vazio(f.ciot)) r.push('CIOT');
  if (vazio(f.mdfe_chave)) r.push('MDF-e');
  if (f.lotacao && f.piso != null && f.valor != null && +f.valor < +f.piso - 0.005) r.push('abaixo do piso mínimo');
  if (f.lotacao && f.piso == null) r.push('piso não calculado');
  if (!f.pedagio_nao_ha && !(+f.pedagio_valor > 0)) r.push('vale-pedágio');
  if (ehAutonomo(t)) {
    if (vazio(t.rntrc)) r.push('RNTRC'); else if (t.rntrc_validade && t.rntrc_validade < f.data) r.push('RNTRC vencido');
    if (!anexos.some(a => a.tipo === 'contrato' && (a.transportador_id === t.id || (f.id && a.frete_id === f.id)))) r.push('contrato');
    if (t.contrato_validade && t.contrato_validade < f.data) r.push('contrato vencido');
    if ((vazio(t.conta_numero) && vazio(t.conta_pix)) || !t.conta_vinculo) r.push('conta indicada pelo autônomo');
  }
  return r;
}
/** pendências do cadastro do transportador (sem frete) */
export function pendenciasTransp(t, anexos = [], hoje = new Date().toISOString().slice(0, 10)) {
  const r = [], vazio = (s) => !String(s ?? '').trim();
  if (vazio(t.documento)) r.push('CPF/CNPJ');
  if (vazio(t.rntrc)) r.push('RNTRC'); else if (t.rntrc_validade && t.rntrc_validade < hoje) r.push('RNTRC vencido');
  if (ehAutonomo(t)) {
    if (!anexos.some(a => a.tipo === 'contrato' && a.transportador_id === t.id)) r.push('contrato');
    if ((vazio(t.conta_numero) && vazio(t.conta_pix)) || !t.conta_vinculo) r.push('conta indicada');
  }
  return r;
}
/** tipo sugerido pelo documento: CPF = autônomo; CNPJ = transportadora (confirmar a frota no RNTRC: até 3 veículos = equiparado) */
export const tipoPeloDoc = (doc) => (String(doc || '').replace(/\D/g, '').length === 11 ? 'tac' : 'etc');
/** placas: "ABC1D23;5;carreta" por linha */
export const lerVeiculos = (txt) => String(txt || '').split(/\n+/).map(l => l.split(/[;,\t]/).map(x => x.trim())).filter(p => p[0])
  .map(([placa, eixos, tipo]) => ({ placa: placa.toUpperCase().replace(/[^A-Z0-9]/g, ''), eixos: +eixos || null, tipo: tipo || null }));
export const veiculosTxt = (vs) => (vs || []).map(v => [v.placa, v.eixos || '', v.tipo || ''].join(';')).join('\n');
