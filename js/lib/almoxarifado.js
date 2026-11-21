// Requisição de material ao almoxarifado (SQL 176), parte pura: situações, pendências, validação da entrega e indicadores.
export const SIT = { aprovacao: ['Aguardando aprovação', 'warn'], aberta: ['Aguardando entrega', 'previsto'], parcial: ['Entregue em parte', 'warn'], atendida: ['Entregue', 'pago'],
  encerrada: ['Encerrada com pendência', ''], recusada: ['Recusada', 'vencido'], cancelada: ['Cancelada', ''] };
export const ABERTAS = ['aprovacao', 'aberta', 'parcial'];
export const PAPEIS = { admin: 'Administrador', diretor: 'Diretor', financeiro: 'Financeiro', compras: 'Compras', vendas: 'Vendas', producao: 'Produção', leitura: 'Leitura' };
const n = (v) => +v || 0;

/** quanto falta entregar de um item */
export const pendente = (it) => Math.max(0, Math.round((n(it.quantidade) - n(it.qtd_entregue)) * 1e4) / 1e4);
export const temPendencia = (itens) => (itens || []).some(it => pendente(it) > 0);

/** número escrito à brasileira → número ("2,5" = 2.5; "1.000" = 1000); inválido = NaN */
export function qtdBR(t) { const s = String(t ?? '').trim().replace(/\s/g, ''); if (!/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(s)) return NaN; return +s.replace(/\./g, '').replace(',', '.'); }

/** código do crachá dentro do que o leitor mandou: o QR traz um endereço (…cracha.html?c=CÓDIGO); só os 24 caracteres do código importam,
 *  porque dois-pontos, barras e interrogação podem chegar trocados conforme o teclado configurado no leitor */
export function codigoCracha(txt) {
  const t = String(txt ?? '').trim(); if (!/cracha|c[=\-_]/i.test(t) && !/^[0-9a-f]{24}$/i.test(t)) return null;
  const m = /(?:^|[^0-9a-f])([0-9a-f]{24})(?![0-9a-f])/i.exec(' ' + t);
  return m ? m[1].toLowerCase() : null;
}

/** sugestão de entrega: para cada item pendente, o local com mais saldo e o quanto dá para entregar agora.
 *  itens = itens da requisição; saldos = [{ produto_id, local_id, local_nome, quantidade }] */
export function sugerirEntrega(itens, saldos) {
  return (itens || []).filter(it => pendente(it) > 0).map(it => {
    const S = (saldos || []).filter(s => s.produto_id === it.produto_id && n(s.quantidade) > 0).sort((a, b) => n(b.quantidade) - n(a.quantidade));
    const melhor = S[0] || null, falta = pendente(it);
    return { item_id: it.id, produto_id: it.produto_id, codigo: it.codigo, descricao: it.descricao, unidade: it.unidade, falta, locais: S,
      local_id: melhor?.local_id || '', quantidade: melhor ? Math.min(falta, n(melhor.quantidade)) : 0, semSaldo: !melhor };
  });
}

/** confere a entrega antes de gravar: linhas = [{ item_id, descricao, falta, quantidade, local_id, saldoLocal }]; devolve a lista de problemas (vazia = pode entregar) */
export function conferirEntrega(linhas, { quem = '', exigirCracha = false, crachaLido = false } = {}) {
  const erros = []; const L = (linhas || []).filter(l => n(l.quantidade) > 0);
  if (!L.length) erros.push('Informe a quantidade de pelo menos um item.');
  for (const l of L) {
    if (Number.isNaN(+l.quantidade)) erros.push(`${l.descricao}: quantidade inválida.`);
    else if (n(l.quantidade) > n(l.falta) + 1e-9) erros.push(`${l.descricao}: a entrega (${l.quantidade}) é maior que o pendente (${l.falta}).`);
    if (!l.local_id) erros.push(`${l.descricao}: escolha o local de onde sai.`);
    else if (l.saldoLocal != null && n(l.quantidade) > n(l.saldoLocal) + 1e-9) erros.push(`${l.descricao}: o local tem só ${l.saldoLocal}.`);
  }
  if (!String(quem || '').trim()) erros.push('Identifique quem está retirando (leia o crachá ou escolha a pessoa).');
  if (exigirCracha && !crachaLido) erros.push('A entrega exige a leitura do crachá de quem retira.');
  return erros;
}

/** filtro da lista: { situacao ('' | 'abertas' | código), setor, busca, de, ate } */
export function filtrar(L, f = {}) {
  const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(), b = norm(f.busca).trim();
  return (L || []).filter(r => (!f.situacao || (f.situacao === 'abertas' ? ABERTAS.includes(r.situacao) : r.situacao === f.situacao)) && (!f.setor || (r.setor || '') === f.setor)
    && (!f.de || String(r.criado_em).slice(0, 10) >= f.de) && (!f.ate || String(r.criado_em).slice(0, 10) <= f.ate)
    && (!b || norm(`${r.numero} ${r.para_nome} ${r.solicitante_nome} ${r.setor} ${r.motivo} ${(r.itens || []).map(i => i.codigo + ' ' + i.descricao).join(' ')}`).includes(b)));
}

/** indicadores: filas de hoje e o que saiu no mês (mes = 'AAAA-MM'); entregas = [{ requisicao_id, valor, entregue_em, cracha_lido }] */
export function resumo(reqs, entregas, mes) {
  const R = reqs || [], E = (entregas || []).filter(e => String(e.entregue_em).slice(0, 7) === mes);
  const balcao = new Set(R.filter(r => r.origem === 'balcao').map(r => r.id));
  return { entregar: R.filter(r => r.situacao === 'aberta' || r.situacao === 'parcial').length, aprovar: R.filter(r => r.situacao === 'aprovacao').length,
    entregasMes: E.length, valorMes: Math.round(E.reduce((t, e) => t + n(e.valor), 0) * 100) / 100, balcaoMes: E.filter(e => balcao.has(e.requisicao_id)).length,
    comCracha: E.filter(e => e.cracha_lido).length };
}

/** consumo por setor no período: [{ setor, requisicoes, valor }] do maior para o menor */
export function consumoPorSetor(reqs, entregas) {
  const porReq = new Map(); for (const e of entregas || []) porReq.set(e.requisicao_id, (porReq.get(e.requisicao_id) || 0) + n(e.valor));
  const g = new Map();
  for (const r of reqs || []) { if (!porReq.has(r.id)) continue; const k = r.setor || 'Sem setor'; const x = g.get(k) || { setor: k, requisicoes: 0, valor: 0 }; x.requisicoes++; x.valor += porReq.get(r.id); g.set(k, x); }
  return [...g.values()].map(x => ({ ...x, valor: Math.round(x.valor * 100) / 100 })).sort((a, b) => b.valor - a.valor || a.setor.localeCompare(b.setor));
}
