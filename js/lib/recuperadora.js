// Recuperadora (reciclagem e reprocesso): rótulos e cálculos da tela — prévia do ticket da balança (mesma regra do banco,
// rec_ticket_fechar), preço vigente, abatimento do adiantamento e resumos. Sem acesso ao banco: testável no node.
const r2 = (v) => Math.round(((+v || 0) + Number.EPSILON) * 100) / 100;
const r3 = (v) => Math.round(((+v || 0) + Number.EPSILON) * 1000) / 1000;

export const MODOS = { desligado: 'Desligada', interno: 'Só aparas internas', externo: 'Só compra de terceiros', ambos: 'Aparas internas e compra de terceiros' };
export const POLIMEROS = ['PEBD', 'PEAD', 'PELBD', 'PP', 'BOPP', 'PET', 'PS', 'PVC', 'misto', 'outro'];
export const CONDICOES = { limpo: 'Limpo', sujo: 'Sujo', impresso: 'Impresso', misto: 'Misto' };
export const ORIGENS = { compra: 'Compra', doacao: 'Doação', transferencia: 'Transferência' };
export const TIPOS_FORN = { catador_pf: 'Catador (pessoa física)', cooperativa: 'Cooperativa de catadores', associacao: 'Associação de catadores', sucateiro_pj: 'Sucateiro / aparista (empresa)', industria: 'Indústria (apara de terceiros)', outro: 'Outro' };
// coletor incentivado (LC 214/2025, art. 170): pessoa física que coleta/tria e cooperativa ou associação de catadores
export const COLETOR_SUGERIDO = (tipo) => ['catador_pf', 'cooperativa', 'associacao'].includes(tipo);
export const SIT_TICKET = { aberto: ['Aberto', 'aberto'], fechado: ['Fechado', 'pago'], cancelado: ['Cancelado', 'vencido'] };
export const SIT_LOTE = { disponivel: ['Disponível', 'pago'], em_processo: ['Em processo', 'aberto'], consumido: ['Consumido', ''], bloqueado: ['Bloqueado', 'negoc'], vendido: ['Vendido', ''], cancelado: ['Cancelado', 'vencido'] };
export const TIPOS_LOTE = { entrada: 'Entrada', apara: 'Apara interna', grao: 'Grão' };

export const placa = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** preço do kg vigente na data: o da classe vence o geral; a vigência mais recente até a data (igual a rec_preco) */
export function precoVigente(precos, material, classe, data) {
  const c = (precos || []).filter(p => p.material_id === material && (p.classe_id === classe || !p.classe_id) && p.vigencia <= data)
    .sort((a, b) => (!!a.classe_id === !!b.classe_id ? (a.vigencia < b.vigencia ? 1 : -1) : a.classe_id ? -1 : 1));
  return c.length ? +c[0].preco_kg : null;
}

/**
 * prévia do ticket: t = { origem, peso_bruto, tara, peso_liquido, frete_valor }, itens = [{ peso_kg, desconto_pct, preco_kg, desconto_padrao, preco_tabela }]
 * devolve { liquido, soma, diferenca, dentro, itens: [{ desconto, preco, pago, valor, frete, custo, semPreco }], total, pagoKg, descontoMedio }
 */
export function calcTicket(t, itens, { tolerancia = 1 } = {}) {
  const bruto = t.peso_bruto === '' || t.peso_bruto == null ? null : +t.peso_bruto, tara = t.tara === '' || t.tara == null ? null : +t.tara;
  const soma = r3((itens || []).reduce((s, i) => s + (+i.peso_kg || 0), 0));
  const liquido = bruto != null && tara != null ? r3(bruto - tara) : (t.peso_liquido != null && t.peso_liquido !== '' ? +t.peso_liquido : null);
  const compra = (t.origem || 'compra') === 'compra', frete = +t.frete_valor || 0;
  const L = (itens || []).map(i => {
    const desconto = i.desconto_pct !== '' && i.desconto_pct != null ? +i.desconto_pct : (+i.desconto_padrao || 0);
    const precoInf = i.preco_kg !== '' && i.preco_kg != null ? +i.preco_kg : (i.preco_tabela != null ? +i.preco_tabela : null);
    const preco = compra ? precoInf : 0, pago = r3((+i.peso_kg || 0) * (1 - desconto / 100)), valor = r2(pago * (preco || 0));
    const fr = frete > 0 && soma > 0 ? r2(frete * (+i.peso_kg || 0) / soma) : 0;
    return { desconto, preco, pago, valor, frete: fr, custo: r2(valor + fr), semPreco: compra && preco == null };
  });
  const total = r2(L.reduce((s, x) => s + x.valor, 0)), pagoKg = r3(L.reduce((s, x) => s + x.pago, 0));
  const diferenca = liquido == null ? 0 : r3(soma - liquido);
  return { liquido: liquido ?? soma, soma, diferenca, dentro: Math.abs(diferenca) <= tolerancia + 1e-9, itens: L, total, pagoKg,
    descontoMedio: soma ? 1 - pagoKg / soma : 0, custoKg: pagoKg ? r2((total + frete) / pagoKg * 10000) / 10000 : 0 };
}

/** abatimento do adiantamento (mais antigos primeiro) até o total: { abatido, aPagar, usados: [{ id, valor }] } */
export function abatimento(total, adiantamentos) {
  let resto = r2(total); const usados = [];
  for (const a of [...(adiantamentos || [])].sort((x, y) => (x.data < y.data ? -1 : x.data > y.data ? 1 : 0))) {
    if (resto <= 0) break;
    const v = r2(Math.min(resto, +a.saldo || 0));
    if (v > 0) { usados.push({ id: a.id, valor: v }); resto = r2(resto - v); }
  }
  const abatido = r2(total - resto);
  return { abatido, aPagar: resto, usados };
}

/** saldo de cada adiantamento: valor − abatimentos */
export function saldosAdiant(adiantamentos, abatimentos) {
  const ab = new Map(); for (const b of abatimentos || []) ab.set(b.adiantamento_id, r2((ab.get(b.adiantamento_id) || 0) + +b.valor));
  return (adiantamentos || []).map(a => ({ ...a, abatido: ab.get(a.id) || 0, saldo: a.situacao === 'cancelado' ? 0 : r2(+a.valor - (ab.get(a.id) || 0)) }));
}

/** resumo dos lotes por material: { material_id: { kg, custo, lotes } } só disponíveis/bloqueados */
export function estoquePorMaterial(lotes) {
  const m = new Map();
  for (const l of lotes || []) {
    if (!['disponivel', 'bloqueado'].includes(l.situacao)) continue;
    const x = m.get(l.material_id) || { kg: 0, custo: 0, lotes: 0 };
    const prop = +l.peso_kg ? (+l.saldo_kg / +l.peso_kg) : 0;
    x.kg = r3(x.kg + +l.saldo_kg); x.custo = r2(x.custo + +l.custo_total * prop); x.lotes++;
    m.set(l.material_id, x);
  }
  for (const x of m.values()) x.custoKg = x.kg ? Math.round(x.custo / x.kg * 10000) / 10000 : 0;
  return m;
}

// ---------------------------------------------------------------- parte 2: processamento, qualidade e custo
export const DESTINOS = { producao: 'Volta para a linha (OP)', venda: 'Venda', perda: 'Perda', ajuste: 'Ajuste' };
export const PERDAS = { perda_umidade: 'Umidade', perda_sujeira: 'Sujeira', perda_finos: 'Finos', perda_rejeito: 'Rejeito' };

/** horas da etapa: informadas ou pelo início e fim */
export const horasEtapa = (e) => +e.horas_maquina > 0 ? +e.horas_maquina : (e.inicio && e.fim ? r2((new Date(e.fim) - new Date(e.inicio)) / 36e5) : 0);

/**
 * custo do processo da ordem (igual a _rec_custo_processo): energia, água, químicos, mão de obra, outros e máquina por etapa
 * custoHora(maquina_id) devolve o custo-hora da máquina (máquina → setor → padrão)
 */
export function custoProcesso(o, etapas, cfg, custoHora = () => 0) {
  const p = { energia: r2((+o.energia_kwh || 0) * (+cfg.custo_kwh || 0)), agua: r2((+o.agua_m3 || 0) * (+cfg.custo_m3_agua || 0)), quimicos: r2(+o.quimicos_valor || 0),
    mao_obra: r2((+o.mo_horas || 0) * (+cfg.custo_hora_mo || 0)), outros: r2(+o.outros_valor || 0),
    maquina: r2((etapas || []).reduce((s, e) => s + horasEtapa(e) * (+custoHora(e.maquina_id || o.maquina_id) || 0), 0)) };
  p.total = r2(p.energia + p.agua + p.quimicos + p.mao_obra + p.outros + p.maquina);
  return p;
}

/** resumo da ordem: entrada, perdas apontadas, rendimento e custo por kg (com a saída informada ou prevista pela última etapa) */
export function resumoOrdem(o, entradas, etapas, cfg, custoHora, saida = null) {
  const entrada = r3((entradas || []).reduce((s, e) => s + (+e.kg || 0), 0)), material = r2((entradas || []).reduce((s, e) => s + (+e.custo || 0), 0));
  const perdas = Object.fromEntries(Object.keys(PERDAS).map(k => [k, r3((etapas || []).reduce((s, e) => s + (+e[k] || 0), 0))]));
  const perdaTotal = r3(Object.values(perdas).reduce((s, v) => s + v, 0));
  const ult = [...(etapas || [])].filter(e => e.kg_saida != null && e.kg_saida !== '').sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)).at(-1);
  const kgSaida = saida != null ? +saida : (o.peso_saida != null ? +o.peso_saida : (ult ? +ult.kg_saida : r3(entrada - perdaTotal)));
  const proc = custoProcesso(o, etapas, cfg, custoHora), total = r2(material + proc.total);
  return { entrada, material, perdas, perdaTotal, kgSaida, rendimento: entrada ? kgSaida / entrada : null, processo: proc, total, custoKg: kgSaida ? Math.round(total / kgSaida * 10000) / 10000 : null,
    naoExplicado: r3(entrada - kgSaida - perdaTotal) };
}

/** avalia o ensaio contra a especificação (prévia do rec_ensaio_registrar): lista de motivos; vazia = aprovado */
export function avaliarEnsaio(e, s) {
  const m = []; if (!s) return m;
  const n = (v) => v === '' || v == null ? null : +v;
  const mfi = n(e.mfi), um = n(e.umidade), de = n(e.densidade), co = n(e.contaminacao);
  if (mfi != null && s.mfi_min != null && mfi < +s.mfi_min) m.push(`índice de fluidez abaixo de ${s.mfi_min}`);
  if (mfi != null && s.mfi_max != null && mfi > +s.mfi_max) m.push(`índice de fluidez acima de ${s.mfi_max}`);
  if (um != null && s.umidade_max != null && um > +s.umidade_max) m.push(`umidade acima de ${s.umidade_max}%`);
  if (de != null && s.densidade_min != null && de < +s.densidade_min) m.push(`densidade abaixo de ${s.densidade_min}`);
  if (de != null && s.densidade_max != null && de > +s.densidade_max) m.push(`densidade acima de ${s.densidade_max}`);
  if (co != null && s.contaminacao_max != null && co > +s.contaminacao_max) m.push(`contaminação acima de ${s.contaminacao_max}%`);
  return m;
}

/**
 * preço equivalente pelo rendimento: quanto valeria o kg pesado do fornecedor se ele rendesse a média.
 * f = { preco_pago_kg, rendimento_pesado }, media = rendimento médio (grão ÷ pesado) de todos os fornecedores
 */
export function precoEquivalente(f, media) {
  if (!f || f.preco_pago_kg == null || !f.rendimento_pesado || !media) return null;
  return Math.round(+f.preco_pago_kg * (+f.rendimento_pesado / media) * 10000) / 10000;
}
