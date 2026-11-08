// Uso da plataforma: contas puras (sem banco), usadas pelo registro (js/lib/uso.js) e pela tela (js/pages/uso.js). Testes: tests/uso.test.js.

// título do formulário ou mensagem de erro sem números (nº do PA, valores, datas), para agrupar "Editar PA nº 21" e "Editar PA nº 22"
export const normalizarTexto = (t) => String(t ?? '').replace(/\s+/g, ' ').replace(/\d[\d.,/:-]*/g, '#').replace(/(#\s*)+/g, '# ').trim().slice(0, 160);

// rota sem a parte depois do "?" (#/auditoria?aba=alertas → auditoria)
export const rotaLimpa = (r) => String(r || '').replace(/^#?\/?/, '').split('?')[0].slice(0, 80) || 'hoje';

// 45 s · 12 min · 3 h 05
export function fmtTempo(seg) {
  const s = Math.max(0, Math.round(+seg || 0));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return m === 60 ? `${h + 1} h` : `${h} h ${String(m).padStart(2, '0')}`;
}

// perfil × tela: para cada papel, o tempo total e as telas em que ele passa mais tempo (com a fatia de cada uma)
export function perfisResumo(linhas, max = 6) {
  const por = {};
  for (const l of linhas || []) { const p = (por[l.papel] ||= { papel: l.papel, segundos: 0, acessos: 0, telas: [] }); p.segundos += +l.segundos || 0; p.acessos += +l.acessos || 0; p.telas.push(l); }
  return Object.values(por).map(p => ({ ...p,
    telas: p.telas.sort((a, b) => (+b.segundos || 0) - (+a.segundos || 0) || (+b.acessos || 0) - (+a.acessos || 0)).slice(0, max)
      .map(t => ({ rota: t.rota, acessos: +t.acessos || 0, segundos: +t.segundos || 0, fatia: p.segundos ? Math.round(100 * (+t.segundos || 0) / p.segundos) : 0 })) }))
    .sort((a, b) => b.segundos - a.segundos);
}

// telas do menu que ninguém abriu no período
export const telasSemUso = (menu, usadas) => { const u = new Set((usadas || []).map(t => t.rota)); return (menu || []).filter(m => !u.has(m.rota)); };

// formulário: % de desistência (só faz sentido com uma amostra mínima)
export const taxaDesistencia = (f) => (+f.abertos ? Math.round(100 * (+f.abandonos || 0) / +f.abertos) : 0);

// período pronto: últimos N dias até hoje (datas ISO)
export function periodo(dias, hoje = new Date()) {
  const ate = new Date(hoje); const de = new Date(hoje); de.setDate(de.getDate() - (dias - 1));
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { de: iso(de), ate: iso(ate) };
}
