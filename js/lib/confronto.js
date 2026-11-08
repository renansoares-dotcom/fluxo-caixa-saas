// Confronto pedido × nota × recebimento (melhoria 5.3): rótulos, situação de cada nota e resumo das divergências.
// A regra que bloqueia está no banco (_compras_confronto, SQL 133); aqui só a apresentação.

export const TIPOS = {
  quantidade: 'Quantidade acima do pedido', preco: 'Preço acima do pedido', item_fora: 'Item fora do pedido',
  prazo_pagamento: 'Vencimento antes do combinado', parcelas: 'Número de parcelas', entrega: 'Entrega atrasada',
  nota_qtd: 'Nota × contado', nao_veio: 'Item não veio na nota', parcial: 'Entrega parcial',
};

export const SITUACOES = {
  bloqueada: ['Pagamento bloqueado', 'neg'], liberada: ['Liberada', 'warn'], divergente: ['Divergência sem bloqueio', 'warn'],
  ok: ['Confere', 'pos'], sem_pedido: ['Sem pedido', 'muted'],
};

// situação de uma nota da lista (compras_confronto_lista)
export function situacaoNota(n) {
  if (!n) return 'sem_pedido';
  if (n.bloqueio?.situacao === 'bloqueada') return 'bloqueada';
  if (n.bloqueio?.situacao === 'liberada') return 'liberada';
  if (!(n.pedidos || []).length) return 'sem_pedido';
  return (n.divergencias || []).some(d => d.tipo !== 'parcial') ? 'divergente' : 'ok';
}

// soma do que bloqueia e textos agrupados
export function resumo(divs = []) {
  const bloq = divs.filter(d => d.bloqueia === true || d.bloqueia === 'true');
  return {
    bloqueia: bloq.length > 0,
    valor: Math.round(bloq.reduce((t, d) => t + (+d.valor || 0), 0) * 100) / 100,
    bloqueantes: bloq.map(d => d.texto),
    avisos: divs.filter(d => !(d.bloqueia === true || d.bloqueia === 'true')).map(d => d.texto),
  };
}

// quem libera: papéis dos parâmetros (admin sempre)
export function podeLiberar(papel, papeis = ['admin', 'diretor', 'financeiro']) {
  return papel === 'admin' || (papeis || []).includes(papel);
}

export function filtrar(lista, filtro) {
  if (!filtro || filtro === 'todas') return lista;
  if (filtro === 'pendentes') return lista.filter(n => ['bloqueada', 'divergente', 'sem_pedido'].includes(situacaoNota(n)));
  return lista.filter(n => situacaoNota(n) === filtro);
}
