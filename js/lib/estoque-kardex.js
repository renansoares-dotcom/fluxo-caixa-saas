// Estoque parametrizado (SQL 075): rótulos, regra por CFOP e simulação do custo médio ponderado móvel (o banco é quem grava).
export const FINALIDADES = {
  materia_prima: 'Matéria-prima', insumo: 'Insumos de produção', processo: 'Em processo', acabado: 'Produto acabado', aparas: 'Aparas e reprocesso',
  manutencao: 'Manutenção', uso_consumo: 'Uso e consumo', terceiros: 'Terceiros', quarentena: 'Quarentena', outro: 'Outro',
};
export const POSSE = { propria: 'Nosso, aqui', em_terceiros: 'Nosso, em poder de terceiros', de_terceiros: 'De terceiros, em nosso poder' };
/** tipo do item no SPED Fiscal (registro 0200, campo TIPO_ITEM) */
export const TIPOS_SPED = {
  '00': 'Mercadoria para revenda', '01': 'Matéria-prima', '02': 'Embalagem', '03': 'Produto em processo', '04': 'Produto acabado', '05': 'Subproduto',
  '06': 'Produto intermediário', '07': 'Material de uso e consumo', '08': 'Ativo imobilizado', '09': 'Serviços', '10': 'Outros insumos', '99': 'Outras',
};
export const SENTIDOS = { E: 'Entrada', S: 'Saída', T: 'Transferência' };
export const DOCUMENTOS = { nf: 'Nota fiscal', op: 'Ordem de produção', requisicao: 'Requisição', inventario: 'Inventário', nenhum: 'Nenhum' };
export const PAPEIS = { admin: 'Administrador', financeiro: 'Financeiro', diretor: 'Diretor', compras: 'Compras', producao: 'Produção' };
/** quem movimenta estoque (o banco confere o mesmo em pode_estoque) */
export const PODE_MOVIMENTAR = ['admin', 'financeiro', 'diretor', 'compras', 'producao'];

const r2 = (v) => Math.round((+v || 0) * 100) / 100;

/**
 * regra aplicável a um item de NF-e: CFOP completo vale mais que o final (3 dígitos); família ou tipo SPED específicos valem
 * mais que "qualquer"; depois a prioridade (menor primeiro). Devolve null quando nenhuma regra ativa casa.
 */
export function regraCfop(regras, { cfop, sentido, familia_id, tipo_sped }) {
  const c = String(cfop || '').replace(/\D/g, '');
  const ok = regras.filter(r => r.ativo !== false && r.sentido === sentido
    && (r.cfop === c || (r.cfop.length === 3 && c.slice(1) === r.cfop))
    && (!r.familia_id || r.familia_id === familia_id) && (!r.tipo_sped || r.tipo_sped === tipo_sped));
  const peso = (r) => (r.cfop.length === 4 ? 4 : 0) + (r.familia_id ? 2 : 0) + (r.tipo_sped ? 1 : 0);
  return ok.sort((a, b) => peso(b) - peso(a) || (a.prioridade ?? 100) - (b.prioridade ?? 100))[0] || null;
}

/**
 * custo médio ponderado móvel, em ordem cronológica (mesma regra do banco):
 * entrada que forma custo entra pelo custo informado; as demais entradas e todas as saídas, pelo custo médio do momento;
 * estorno usa o custo do movimento estornado. Locais que não compõem custo (de terceiros) não mexem no custo.
 * movs: [{ data, quantidade, custo_unitario?, afeta_custo, compoe_custo?, estorno? }]
 */
export function custoMedio(movs) {
  let q = 0, v = 0, cm = 0;
  const linhas = [...movs].sort((a, b) => a.data.localeCompare(b.data) || (+b.quantidade - +a.quantidade)).map(m => {
    const qt = +m.quantidade;
    const cu = (qt > 0 && m.afeta_custo && !m.estorno) || m.estorno ? +m.custo_unitario : (q > 0 ? v / q : cm);
    const val = r2(qt * cu);
    if (m.compoe_custo !== false) { q += qt; v = r2(v + val); if (q > 0) cm = v / q; }
    return { ...m, custo_unitario: cu, valor: val, custo_medio_apos: cm, saldo_apos: q };
  });
  return { linhas, quantidade: q, valor: v, custo_medio: cm };
}

/** valor do estoque por local a partir dos saldos (só locais que compõem custo entram no total) */
export function resumoLocais(saldos, locais) {
  const por = new Map(locais.map(l => [l.id, { local: l, itens: 0, quantidade: 0, valor: 0 }]));
  for (const s of saldos) { const x = por.get(s.local_id); if (!x || !+s.quantidade) continue; x.itens++; x.quantidade += +s.quantidade; x.valor = r2(x.valor + +s.valor); }
  const linhas = [...por.values()].sort((a, b) => (a.local.ordem ?? 0) - (b.local.ordem ?? 0));
  return { linhas, total: r2(linhas.filter(x => x.local.compoe_custo !== false).reduce((t, x) => t + x.valor, 0)) };
}

/** mês fechado mais recente (YYYY-MM-01) e o primeiro dia aberto */
export function periodoAberto(fechamentos) {
  const ult = fechamentos.map(f => f.mes).sort().pop() || null;
  if (!ult) return { fechadoAte: null, abertoDesde: null };
  const d = new Date(ult + 'T12:00:00'); d.setMonth(d.getMonth() + 1);
  return { fechadoAte: ult, abertoDesde: d.toISOString().slice(0, 10) };
}
