// RH — folha completa (melhoria 8.1): horas extras, avos de 13º e férias, períodos aquisitivos, cálculo de férias e de rescisão,
// e o passivo de férias e 13º. Estimativas para o caixa: INSS e IRRF do empregado ficam com a folha oficial.
// Parâmetros vêm de rh_parametros (SQL 144) e podem ser mudados na tela.

const r2 = (v) => Math.round(((+v || 0) + Number.EPSILON) * 100) / 100;
const iso = (d) => d.toISOString().slice(0, 10);
const D = (s) => new Date(s + 'T12:00:00Z');
const addDias = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const addMeses = (s, n) => { const d = D(s); const dia = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); const ult = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(dia, ult)); return iso(d); };
const diasEntre = (a, b) => Math.round((D(b) - D(a)) / 864e5);

export const PARAM_FOLHA = { he_divisor: 220, he_pct1: 50, he_pct2: 100, dsr_pct: 0, ferias_pag_dias_antes: 2, resc_prazo_dias: 10, multa_fgts_pct: 40, multa_fgts_acordo_pct: 20, aviso_base: 30, aviso_por_ano: 3, aviso_max: 90 };
export const pf = (P) => ({ ...PARAM_FOLHA, ...Object.fromEntries(Object.entries(P || {}).filter(([k, v]) => k in PARAM_FOLHA && v != null && v !== '')) });

/** horas extras: salário / divisor × horas × (1 + adicional), mais o reflexo no DSR (% sobre as horas, quando configurado) */
export function horasExtras(salario, h1, h2, P) {
  const p = pf(P), hora = (+salario || 0) / p.he_divisor;
  const v1 = r2(hora * (+h1 || 0) * (1 + p.he_pct1 / 100)), v2 = r2(hora * (+h2 || 0) * (1 + p.he_pct2 / 100));
  const dsr = r2((v1 + v2) * p.dsr_pct / 100);
  return { hora: r2(hora), v1, v2, dsr, total: r2(v1 + v2 + dsr) };
}

/** avos de 13º no ano até a data: mês com 15 dias ou mais trabalhados conta 1/12 */
export function avos13(admissao, ate) {
  const ano = +ate.slice(0, 4); let n = 0;
  for (let m = 1; m <= 12; m++) {
    const ini = `${ano}-${String(m).padStart(2, '0')}-01`, fimM = iso(new Date(Date.UTC(ano, m, 0)));
    const a = admissao && admissao > ini ? admissao : ini, b = ate < fimM ? ate : fimM;
    if (b < a) continue;
    if (diasEntre(a, b) + 1 >= 15) n++;
  }
  return Math.min(12, n);
}

/** avos de férias no período aquisitivo que começou em ini, até a data: fração de 15 dias ou mais conta 1/12 */
export function avosFerias(ini, ate) {
  if (!ini || ate < ini) return 0;
  let n = 0, a = ini;
  while (n < 12) { const prox = addMeses(a, 1); const fimF = addDias(prox, -1); if (fimF <= ate) { n++; a = prox; continue; } if (diasEntre(a, ate) + 1 >= 15) n++; break; }
  return n;
}

/**
 * períodos aquisitivos desde a admissão até a data, com os dias já gozados/abonados (ferias: [{aquisitivo_ini, dias, abono_dias, situacao}])
 * situação: em_aquisicao | a_gozar (completo, dentro do concessivo) | vencido (passou o concessivo de 12 meses sem gozar tudo) | quitado
 */
export function periodos(admissao, ate, ferias = []) {
  if (!admissao) return [];
  const out = []; let ini = admissao;
  while (ini <= ate) {
    const fim = addDias(addMeses(ini, 12), -1), limite = addDias(addMeses(fim, 12), 0);
    const usados = ferias.filter(f => f.aquisitivo_ini === ini && f.situacao !== 'cancelada').reduce((s, f) => s + (+f.dias || 0) + (+f.abono_dias || 0), 0);
    const completo = fim <= ate, saldo = Math.max(0, (completo ? 30 : Math.round(avosFerias(ini, ate) * 2.5)) - usados);
    out.push({ ini, fim, limite, completo, usados, saldo, avos: completo ? 12 : avosFerias(ini, ate),
      situacao: !completo ? 'em_aquisicao' : saldo === 0 ? 'quitado' : ate > limite ? 'vencido' : 'a_gozar' });
    ini = addDias(fim, 1);
  }
  return out;
}

/** férias: salário/30 × dias + 1/3; abono pecuniário (até 10 dias) + 1/3; adiantamento de 13º opcional (metade do salário) */
export function feriasCalc(salario, dias, abono = 0, adiantar13 = false, gozoIni = null, P = null) {
  const s = +salario || 0, dia = s / 30;
  const ferias = r2(dia * (+dias || 0)), terco = r2(ferias / 3), vAbono = r2(dia * (+abono || 0)), tercoAbono = r2(vAbono / 3), v13 = adiantar13 ? r2(s / 2) : 0;
  const pagamento = gozoIni ? addDias(gozoIni, -pf(P).ferias_pag_dias_antes) : null;
  return { ferias, terco, abono: vAbono, terco_abono: tercoAbono, decimo: v13, total: r2(ferias + terco + vAbono + tercoAbono + v13), pagamento, retorno: gozoIni ? addDias(gozoIni, +dias || 0) : null };
}

export const MOTIVOS = {
  sem_justa_causa: 'Dispensa sem justa causa', pedido: 'Pedido de demissão', justa_causa: 'Dispensa por justa causa',
  acordo: 'Acordo entre as partes (art. 484-A)', termino_contrato: 'Término do contrato de experiência/prazo',
};
export const AVISOS = { indenizado: 'Indenizado', trabalhado: 'Trabalhado', dispensado: 'Dispensado / não se aplica' };

/** dias de aviso prévio: base + por ano completo, até o máximo (Lei 12.506/2011) */
export function diasAviso(admissao, data, P) {
  const p = pf(P); let anos = 0; while (addMeses(admissao, 12 * (anos + 1)) <= data) anos++;
  return Math.min(p.aviso_max, p.aviso_base + p.aviso_por_ano * anos);
}

/**
 * rescisão (estimativa das verbas): r = { admissao, data, salario, motivo, aviso, saldo_fgts, ferias_vencidas_dias, aquisitivo_ini }
 * aviso indenizado projeta a data para 13º e férias proporcionais; no acordo, metade do aviso e 20% de multa.
 */
export function rescisaoCalc(r, P) {
  const p = pf(P), s = +r.salario || 0, dia = s / 30, m = r.motivo;
  const diaMes = +r.data.slice(8, 10);
  const saldo = r2(dia * diaMes);
  let dAviso = 0;
  if (r.aviso === 'indenizado' && ['sem_justa_causa', 'acordo'].includes(m)) dAviso = diasAviso(r.admissao, r.data, p) * (m === 'acordo' ? 0.5 : 1);
  const aviso = r2(dia * dAviso);
  const projetada = addDias(r.data, Math.ceil(dAviso));
  const comProp = m !== 'justa_causa';
  const a13 = comProp ? avos13(r.admissao, projetada) : 0, dec = r2(s / 12 * a13);
  const venc = r2(dia * (+r.ferias_vencidas_dias || 0)), tercoVenc = r2(venc / 3);
  const aqIni = r.aquisitivo_ini || (periodos(r.admissao, r.data).slice(-1)[0]?.ini ?? r.admissao);
  const aF = comProp ? avosFerias(aqIni, projetada) : 0, prop = r2(s / 12 * aF), tercoProp = r2(prop / 3);
  const multaPct = m === 'sem_justa_causa' ? p.multa_fgts_pct : m === 'acordo' ? p.multa_fgts_acordo_pct : 0;
  // FGTS do mês da rescisão e do aviso indenizado (8%) somam ao saldo para a multa
  const fgtsMes = r2((saldo + aviso + dec) * 0.08), multa = r2(((+r.saldo_fgts || 0) + fgtsMes) * multaPct / 100);
  const verbas = [
    ['saldo_salario', `Saldo de salário (${diaMes} dia(s))`, saldo], ['aviso', `Aviso prévio indenizado (${dAviso} dia(s))`, aviso], ['decimo', `13º proporcional (${a13}/12)`, dec],
    ['ferias_vencidas', `Férias vencidas (${+r.ferias_vencidas_dias || 0} dia(s))`, venc], ['terco_vencidas', '1/3 das férias vencidas', tercoVenc],
    ['ferias_prop', `Férias proporcionais (${aF}/12)`, prop], ['terco_prop', '1/3 das férias proporcionais', tercoProp]].filter(v => v[2] > 0).map(([codigo, nome, valor]) => ({ codigo, nome, valor }));
  const total = r2(verbas.reduce((t, v) => t + v.valor, 0));
  return { verbas, total, multa_fgts: multa, multa_pct: multaPct, fgts_mes: fgtsMes, dias_aviso: dAviso, data_projetada: projetada, avos13: a13, avos_ferias: aF,
    pagamento: addDias(r.data, p.resc_prazo_dias), total_caixa: r2(total + multa) };
}

/** passivo de férias e 13º por colaborador na data: 13º do ano (avos) + férias vencidas/a gozar + proporcionais, com 1/3 */
export function passivo(colabs, feriasPorColab, ate) {
  const linhas = [];
  for (const c of colabs) {
    if (c.situacao === 'desligado' || !['clt', 'aprendiz'].includes(c.vinculo || 'clt') || !c.admissao) continue;
    const s = +c.salario || 0, P = periodos(c.admissao, ate, feriasPorColab.get(c.id) || []);
    const diasDev = P.filter(x => x.completo && x.saldo > 0).reduce((t, x) => t + x.saldo, 0);
    const vencidos = P.filter(x => x.situacao === 'vencido').length;
    const atual = P.find(x => !x.completo), avF = atual ? atual.avos : 0;
    const a13 = avos13(c.admissao, ate);
    const ferias = r2(s / 30 * diasDev * 4 / 3), prop = r2(s / 12 * avF * 4 / 3), dec = r2(s / 12 * a13);
    linhas.push({ id: c.id, nome: c.nome, salario: s, diasDevidos: diasDev, vencidos, proximoLimite: P.filter(x => x.situacao === 'a_gozar').map(x => x.limite)[0] || null,
      avosFerias: avF, avos13: a13, ferias, feriasProp: prop, decimo: dec, total: r2(ferias + prop + dec) });
  }
  const tot = (k) => r2(linhas.reduce((t, l) => t + l[k], 0));
  return { linhas: linhas.sort((a, b) => b.vencidos - a.vencidos || b.total - a.total), total: { ferias: tot('ferias'), feriasProp: tot('feriasProp'), decimo: tot('decimo'), total: tot('total'), vencidos: linhas.filter(l => l.vencidos).length } };
}

/** folha real importada × prevista, por colaborador (chave: matrícula ou CPF) */
export function compararReal(itens, reais, colabById) {
  const so = (x) => String(x || '').replace(/\D/g, '');
  const porChave = new Map(); for (const r of reais) { if (r.matricula) porChave.set('m' + String(r.matricula).trim(), r); if (so(r.cpf)) porChave.set('c' + so(r.cpf), r); }
  const usados = new Set(), linhas = [];
  for (const it of itens) {
    const c = colabById[it.colaborador_id] || {}; const r = porChave.get('m' + String(c.matricula || '').trim()) || porChave.get('c' + so(c.cpf));
    if (r) usados.add(r);
    const prev = r2(+it.adiantamento + +it.liquido);
    linhas.push({ item_id: it.id, colaborador_id: it.colaborador_id, nome: c.nome, previsto: prev, real: r ? r2(r.liquido) : null, dif: r ? r2(r.liquido - prev) : null, real_r: r || null });
  }
  return { linhas, semCadastro: reais.filter(r => !usados.has(r)) };
}

/** linhas da planilha da folha oficial (primeira aba, header:1) -> [{matricula, cpf, nome, proventos, descontos, liquido, inss, fgts, irrf}] */
export function lerFolhaReal(rows) {
  const N = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  const hi = rows.findIndex(r => r && r.some(x => /LIQUIDO/.test(N(x))) && r.some(x => /NOME|MATRICULA|CPF|FUNCIONARIO|COLABORADOR/.test(N(x))));
  if (hi < 0) throw new Error('Não achei o cabeçalho: a planilha precisa da coluna de líquido e da matrícula, CPF ou nome.');
  const h = rows[hi].map(N), col = (re) => h.findIndex(x => re.test(x));
  const ix = { matricula: col(/MATRICULA|^CODIGO|^COD\.?$/), cpf: col(/^CPF/), nome: col(/^NOME|FUNCIONARIO|COLABORADOR/), proventos: col(/PROVENTO|BRUTO|VENCIMENTO/), descontos: col(/DESCONTO/),
    liquido: col(/LIQUIDO/), inss: col(/^INSS|INSS EMPREGADO|INSS SEGURADO/), fgts: col(/FGTS/), irrf: col(/IRRF|IMPOSTO DE RENDA|^IR$/) };
  const n = (v) => typeof v === 'number' ? v : (() => { const s = String(v ?? '').replace(/[^\d,.-]/g, ''); if (!s) return null; return +(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s); })();
  return rows.slice(hi + 1).filter(r => r && r[ix.liquido] != null && r[ix.liquido] !== '' && (ix.nome < 0 || !/TOTAL/.test(N(r[ix.nome]))))
    .map(r => ({ matricula: ix.matricula >= 0 && r[ix.matricula] != null ? String(r[ix.matricula]).trim() : null, cpf: ix.cpf >= 0 ? String(r[ix.cpf] ?? '').replace(/\D/g, '') || null : null,
      nome: ix.nome >= 0 ? String(r[ix.nome] ?? '').trim() : null, proventos: ix.proventos >= 0 ? n(r[ix.proventos]) : null, descontos: ix.descontos >= 0 ? n(r[ix.descontos]) : null,
      liquido: n(r[ix.liquido]) || 0, inss: ix.inss >= 0 ? n(r[ix.inss]) : null, fgts: ix.fgts >= 0 ? n(r[ix.fgts]) : null, irrf: ix.irrf >= 0 ? n(r[ix.irrf]) : null }))
    .filter(x => x.matricula || x.cpf || x.nome);
}
