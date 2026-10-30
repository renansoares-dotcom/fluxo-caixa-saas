// Gestão da frota (SQL 070): validade de documentos e habilitação, consumo (método do tanque cheio), preventivas e custo por veículo.
export const DOCS = { crlv: 'CRLV / licenciamento', ipva: 'IPVA', seguro: 'Seguro', tacografo: 'Aferição do tacógrafo', aet: 'AET', antt: 'ANTT / RNTRC', outro: 'Outro' };
export const PROPRIEDADE = { proprio: 'Próprio', locado: 'Locado', agregado: 'Agregado' };
export const TIPOS_MANUT = { preventiva: 'Preventiva', corretiva: 'Corretiva', pneus: 'Pneus', funilaria: 'Funilaria', outro: 'Outro' };
export const COMBUSTIVEL = { diesel_s10: 'Diesel S10', diesel_s500: 'Diesel S500', gasolina: 'Gasolina', etanol: 'Etanol', gnv: 'GNV', arla: 'ARLA 32' };
export const SIT_MULTA = { a_indicar: 'Indicar condutor', indicada: 'Condutor indicado', recurso: 'Em recurso', a_pagar: 'A pagar', paga: 'Paga', descontada: 'Descontada em folha', cancelada: 'Cancelada' };
export const VINCULO = { empregado: 'Empregado', terceiro: 'Terceiro', agregado: 'Agregado' };

export const dias = (de, ate) => Math.round((new Date(ate + 'T12:00:00') - new Date(de + 'T12:00:00')) / 86400000);
export const addMeses = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); };
const br = (iso) => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';
const r2 = (v) => Math.round(v * 100) / 100;

/** situação de uma validade: vencido/≤30 dias = neg, ≤60 = warn */
export function validade(iso, hoje, rotulo = 'Vence') {
  if (!iso) return null;
  const d = dias(hoje, iso);
  if (d < 0) return { nivel: 'neg', dias: d, txt: `vencido em ${br(iso)}` };
  if (d <= 30) return { nivel: 'neg', dias: d, txt: `${rotulo.toLowerCase()} em ${d} dia(s) (${br(iso)})` };
  if (d <= 60) return { nivel: 'warn', dias: d, txt: `${rotulo.toLowerCase()} em ${d} dias (${br(iso)})` };
  return { nivel: 'ok', dias: d, txt: `válido até ${br(iso)}` };
}

/** documentos do veículo: o mais recente de cada tipo e a sua situação */
export function situacaoDocs(docs, hoje) {
  const por = {};
  for (const d of docs) if (!por[d.tipo] || (d.validade || '') > (por[d.tipo].validade || '')) por[d.tipo] = d;
  return Object.values(por).map(d => ({ ...d, sit: validade(d.validade, hoje) }));
}

/**
 * consumo pelo método do tanque cheio: entre dois abastecimentos com tanque cheio,
 * km/l = distância ÷ litros colocados depois do primeiro (inclusive os parciais) até o segundo.
 * devolve { trechos: [{ id, data, km, dist, litros, kml }], media }
 */
export function consumo(abast) {
  const xs = abast.filter(a => a.combustivel !== 'arla').slice().sort((a, b) => +a.km - +b.km || a.data.localeCompare(b.data));
  const trechos = []; let ref = null, litros = 0;
  for (const a of xs) {
    if (ref) litros += +a.litros;
    if (a.tanque_cheio) {
      if (ref && +a.km > +ref.km && litros > 0) trechos.push({ id: a.id, data: a.data, km: +a.km, dist: +a.km - +ref.km, litros: r2(litros), kml: r2((+a.km - +ref.km) / litros) });
      ref = a; litros = 0;
    }
  }
  const dist = trechos.reduce((s, t) => s + t.dist, 0), lt = trechos.reduce((s, t) => s + t.litros, 0);
  return { trechos, media: lt ? r2(dist / lt) : null };
}
/** trechos com consumo pior que a média menos a tolerância (padrão 15%) */
export const foraDaMedia = (c, tol = 0.15) => c.media ? c.trechos.filter(t => t.kml < c.media * (1 - tol)) : [];

/** próxima preventiva: por km e/ou por tempo; o que vencer primeiro manda */
export function preventiva(p, kmAtual, hoje) {
  if (!p.ultimo_km && !p.ultima_data) return { nivel: 'info', txt: 'sem execução registrada' };
  const out = { kmProx: p.a_cada_km && p.ultimo_km != null ? +p.ultimo_km + p.a_cada_km : null, dataProx: p.a_cada_meses && p.ultima_data ? addMeses(p.ultima_data, p.a_cada_meses) : null };
  const faltaKm = out.kmProx != null && kmAtual != null ? out.kmProx - +kmAtual : null;
  const faltaD = out.dataProx ? dias(hoje, out.dataProx) : null;
  const venc = (faltaKm != null && faltaKm <= 0) || (faltaD != null && faltaD <= 0);
  const perto = (faltaKm != null && faltaKm <= Math.max(1000, (p.a_cada_km || 0) * 0.1)) || (faltaD != null && faltaD <= 30);
  const partes = [faltaKm != null ? (faltaKm <= 0 ? `passou ${(-faltaKm).toLocaleString('pt-BR')} km` : `faltam ${faltaKm.toLocaleString('pt-BR')} km`) : null,
    faltaD != null ? (faltaD <= 0 ? `venceu em ${br(out.dataProx)}` : `até ${br(out.dataProx)}`) : null].filter(Boolean);
  return { ...out, faltaKm, faltaDias: faltaD, nivel: venc ? 'neg' : perto ? 'warn' : 'ok', txt: partes.join(' · ') };
}

/** alertas do motorista: CNH, toxicológico, MOPP e termo de responsabilidade */
export function alertasMotorista(m, hoje) {
  if (!m.ativo) return [];
  const out = [];
  const add = (iso, rot) => { const s = validade(iso, hoje); if (s && s.nivel !== 'ok') out.push({ nivel: s.nivel, txt: `${rot}: ${s.txt}` }); };
  add(m.cnh_validade, 'CNH'); add(m.toxicologico_validade, 'Toxicológico'); add(m.mopp_validade, 'MOPP');
  if (!m.cnh_validade) out.push({ nivel: 'warn', txt: 'CNH sem validade cadastrada' });
  if (/[CDE]/i.test(m.cnh_categoria || '') && !m.toxicologico_validade) out.push({ nivel: 'warn', txt: 'Toxicológico não cadastrado (CNH C, D ou E)' });
  if (m.vinculo === 'empregado' && !m.termo_assinado_em) out.push({ nivel: 'info', txt: 'Sem termo de responsabilidade assinado' });
  return out;
}
/** alerta da multa: prazo de indicação do condutor e vencimento do pagamento */
export function alertaMulta(mu, hoje) {
  if (mu.situacao === 'a_indicar' && mu.prazo_indicacao) { const d = dias(hoje, mu.prazo_indicacao); if (d <= 7) return { nivel: 'neg', txt: d < 0 ? `prazo de indicação venceu em ${br(mu.prazo_indicacao)}` : `indicar condutor até ${br(mu.prazo_indicacao)}` }; }
  if (['a_pagar', 'a_indicar', 'indicada'].includes(mu.situacao) && mu.vencimento && !mu.lancamento_id) { const d = dias(hoje, mu.vencimento); if (d <= 10) return { nivel: d < 0 ? 'neg' : 'warn', txt: d < 0 ? `venceu em ${br(mu.vencimento)}` : `vence em ${br(mu.vencimento)}` }; }
  return null;
}

/** custo do veículo no mês (YYYY-MM): combustível, manutenção, multas, locação; km rodados pelo hodômetro dos abastecimentos */
export function custoMes(v, mes, { abast = [], manut = [], multas = [], locacaoMensal = 0 } = {}) {
  const doMes = (d) => (d || '').slice(0, 7) === mes;
  const ab = abast.filter(a => a.veiculo_id === v.id && doMes(a.data));
  const combustivel = ab.reduce((s, a) => s + +a.valor, 0);
  const manutencao = manut.filter(m => m.veiculo_id === v.id && doMes(m.data)).reduce((s, m) => s + +m.valor, 0);
  const mult = multas.filter(m => m.veiculo_id === v.id && doMes(m.data_infracao) && m.situacao !== 'cancelada').reduce((s, m) => s + +m.valor, 0);
  const kms = abast.filter(a => a.veiculo_id === v.id && (doMes(a.data) || a.data < mes + '-01')).map(a => ({ km: +a.km, data: a.data }));
  const antes = kms.filter(k => k.data < mes + '-01').sort((a, b) => b.km - a.km)[0];
  const noMes = kms.filter(k => doMes(k.data)).sort((a, b) => b.km - a.km)[0];
  const km = noMes && antes ? noMes.km - antes.km : (ab.length > 1 ? Math.max(...ab.map(a => +a.km)) - Math.min(...ab.map(a => +a.km)) : 0);
  const total = r2(combustivel + manutencao + mult + (+locacaoMensal || 0));
  return { combustivel: r2(combustivel), manutencao: r2(manutencao), multas: r2(mult), locacao: r2(+locacaoMensal || 0), total, km, custoKm: km > 0 ? r2(total / km) : null, litros: r2(ab.reduce((s, a) => s + +a.litros, 0)) };
}
