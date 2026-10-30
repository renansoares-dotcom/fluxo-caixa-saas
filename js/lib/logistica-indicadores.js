// Indicadores de logística (SQL 071): nível de serviço, eficiência das cargas, custo logístico e frota, por mês, com metas.
import * as F from './frota.js';

export const METAS_PADRAO = { prazo_pct: 95, ocupacao_pct: 80, custo_pct: 5, devol_pct: 1 };
const r1 = (v) => v == null || !isFinite(v) ? null : Math.round(v * 10) / 10;
const r2 = (v) => v == null || !isFinite(v) ? null : Math.round(v * 100) / 100;
const div = (a, b) => b ? a / b : null;
const dia = (ts) => (ts || '').slice(0, 10);
const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
export const mesesAte = (mes, n) => Array.from({ length: n }, (_, i) => { const d = new Date(mes + '-15T12:00:00'); d.setMonth(d.getMonth() - (n - 1 - i)); return d.toISOString().slice(0, 7); });

/**
 * B = { cargas, cnotas (com nota: {emissao, v_nf, dest_nome}), veiculos, fretes, abast, manut, multas, locacao: {veiculo_id: valor mensal}, diasAtraso }
 * devolve os indicadores do mês (YYYY-MM)
 */
export function indicadores(mes, B) {
  const noMes = (d) => (d || '').slice(0, 7) === mes;
  const cargas = B.cargas.filter(c => noMes(c.data) && c.status !== 'cancelada');
  const ids = new Set(cargas.map(c => c.id));
  const cn = B.cnotas.filter(n => ids.has(n.carga_id));
  const entregues = cn.filter(n => n.situacao === 'entregue');
  const lead = entregues.filter(n => n.entregue_em && n.nota?.emissao).map(n => ({ n, d: diasEntre(n.nota.emissao, dia(n.entregue_em)) }));
  const noPrazo = lead.filter(x => x.d <= (B.diasAtraso ?? 3));
  const problemas = cn.filter(n => ['devolvida', 'nao_entregue'].includes(n.situacao));
  const vById = Object.fromEntries(B.veiculos.map(v => [v.id, v]));
  // ocupação: só cargas que saíram
  const sairam = cargas.filter(c => ['em_rota', 'concluida'].includes(c.status));
  const ocPeso = sairam.map(c => { const v = vById[c.veiculo_id]; return v && +v.carga_kg && c.peso_kg != null ? +c.peso_kg / +v.carga_kg : null; }).filter(x => x != null);
  const ocVol = sairam.map(c => { const v = vById[c.veiculo_id]; const cap = v && v.comp_m && v.larg_m && v.alt_m ? v.comp_m * v.larg_m * v.alt_m : 0; return cap && c.volume_m3 != null ? +c.volume_m3 / cap : null; }).filter(x => x != null);
  const kmC = sairam.map(c => +(c.km_real ?? c.km_previsto) || 0);
  const comAmbos = sairam.filter(c => c.km_real != null && +c.km_previsto > 0);
  // custos
  const proprios = B.veiculos.filter(v => v.situacao !== 'inativo');
  const custoFrota = proprios.reduce((s, v) => s + F.custoMes(v, mes, { abast: B.abast, manut: B.manut, multas: B.multas, locacaoMensal: B.locacao?.[v.id] || 0 }).total, 0);
  const fretesMes = B.fretes.filter(f => noMes(f.data) && f.status !== 'cancelado');
  const custoTerc = fretesMes.reduce((s, f) => s + (+f.valor || 0), 0);
  const custoTotal = custoFrota + custoTerc;
  const valorEntregue = entregues.reduce((s, n) => s + (+n.nota?.v_nf || 0), 0);
  const pesoProprio = sairam.filter(c => c.veiculo_id).reduce((s, c) => s + (+c.peso_kg || 0), 0);
  const cargaFrete = new Set(fretesMes.map(f => f.carga_id).filter(Boolean));
  const pesoTerc = B.cargas.filter(c => cargaFrete.has(c.id)).reduce((s, c) => s + (+c.peso_kg || 0), 0);
  const pesoTotal = cargas.reduce((s, c) => s + (+c.peso_kg || 0), 0);
  // frota
  const kmFrota = proprios.reduce((s, v) => s + F.custoMes(v, mes, { abast: B.abast }).km, 0);
  const trechos = proprios.flatMap(v => F.consumo(B.abast.filter(a => a.veiculo_id === v.id)).trechos.filter(t => noMes(t.data)));
  const multasMes = B.multas.filter(m => noMes(m.data_infracao) && m.situacao !== 'cancelada').length;
  const manutMes = B.manut.filter(m => noMes(m.data)).reduce((s, m) => s + +m.valor, 0);
  // clientes com mais atraso
  const atr = {}; for (const x of lead.filter(x => x.d > (B.diasAtraso ?? 3))) { const k = x.n.nota?.dest_nome || '—'; (atr[k] ||= { nome: k, qtd: 0, dias: 0 }); atr[k].qtd++; atr[k].dias += x.d; }
  return {
    mes, cargas: cargas.length, notas: cn.length, entregues: entregues.length,
    prazo_pct: r1(div(noPrazo.length * 100, lead.length)), lead_dias: r1(div(lead.reduce((s, x) => s + x.d, 0), lead.length)), devol_pct: r1(div(problemas.length * 100, cn.length)),
    ocupacao_pct: r1(div(ocPeso.reduce((s, x) => s + x, 0) * 100, ocPeso.length)), ocupacao_vol_pct: r1(div(ocVol.reduce((s, x) => s + x, 0) * 100, ocVol.length)),
    entregas_carga: r1(div(cn.length, cargas.length)), km_carga: r1(div(kmC.reduce((s, x) => s + x, 0), kmC.length)),
    desvio_km_pct: r1(div(comAmbos.reduce((s, c) => s + (+c.km_real - +c.km_previsto), 0) * 100, comAmbos.reduce((s, c) => s + +c.km_previsto, 0))),
    custo_frota: r2(custoFrota), custo_terceiros: r2(custoTerc), custo_total: r2(custoTotal), valor_entregue: r2(valorEntregue),
    custo_pct: r2(div(custoTotal * 100, valorEntregue)), custo_kg: r2(div(custoTotal, pesoTotal)), custo_entrega: r2(div(custoTotal, entregues.length)),
    custo_kg_proprio: r2(div(custoFrota, pesoProprio)), custo_kg_terceiros: r2(div(custoTerc, pesoTerc)),
    veiculos_disp: B.veiculos.filter(v => v.situacao === 'disponivel').length, veiculos_total: B.veiculos.filter(v => v.situacao !== 'inativo').length,
    km_frota: kmFrota, kml: r2(div(trechos.reduce((s, t) => s + t.dist, 0), trechos.reduce((s, t) => s + t.litros, 0))),
    multas_10mil_km: r2(div(multasMes * 10000, kmFrota)), manut_km: r2(div(manutMes, kmFrota)),
    atrasos: Object.values(atr).sort((a, b) => b.qtd - a.qtd).slice(0, 5).map(a => ({ ...a, media: r1(a.dias / a.qtd) })),
  };
}

/** situação de um indicador frente à meta: 'ok' | 'warn' (até 10% fora) | 'neg' ; maior = melhor quando sentido = 'maior' */
export function frenteMeta(v, meta, sentido = 'maior') {
  if (v == null || meta == null) return null;
  if (sentido === 'maior') return v >= meta ? 'ok' : v >= meta * 0.9 ? 'warn' : 'neg';
  return v <= meta ? 'ok' : v <= meta * 1.1 + (meta < 2 ? 0.5 : 0) ? 'warn' : 'neg';
}
