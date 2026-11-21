// Padrão de relatórios, fase 1: parte pura da tela Relatórios emitidos (PAI014) — filtro e resumo do histórico.
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** filtra as emissões pelos filtros da tela: { codigo, formato, usuario, busca } */
export function filtrarEmissoes(L, f = {}) {
  const b = norm(f.busca).trim();
  return (L || []).filter(x => (!f.codigo || x.codigo === f.codigo) && (!f.formato || x.formato === f.formato) && (!f.usuario || x.usuario_nome === f.usuario)
    && (!b || norm(`${x.codigo} ${x.nome} ${x.numero} ${(x.parametros || []).map(p => (p || []).join(' ')).join(' ')}`).includes(b)));
}
/** indicadores do período: total, por formato, relatórios diferentes, pessoas e o relatório mais emitido */
export function resumoEmissoes(L) {
  const cont = new Map();
  for (const x of L || []) { const c = cont.get(x.codigo) || { codigo: x.codigo, nome: x.nome, n: 0 }; c.n++; cont.set(x.codigo, c); }
  const mais = [...cont.values()].sort((a, b) => b.n - a.n || a.codigo.localeCompare(b.codigo))[0] || null;
  return { total: (L || []).length, pdf: (L || []).filter(x => x.formato === 'pdf').length, xlsx: (L || []).filter(x => x.formato === 'xlsx').length,
    relatorios: cont.size, pessoas: new Set((L || []).map(x => x.usuario_id || x.usuario_nome).filter(Boolean)).size, mais };
}
