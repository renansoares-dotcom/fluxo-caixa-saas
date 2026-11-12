// Agenda única — regras puras (sem banco nem tela): catálogo das fontes, repetição dos compromissos, grade do mês e da
// semana, normalização dos itens das telas de origem, filtros, resumo por dia e saldo projetado por dia.

const d = (iso) => new Date(iso + 'T12:00:00Z');
const iso = (dt) => dt.toISOString().slice(0, 10);
export const addDias = (i, n) => { const x = d(i); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
export const diaSemana = (i) => d(i).getUTCDay();
export const diasEntre = (a, b) => Math.round((d(b) - d(a)) / 864e5);
const ultimoDia = (ano, mes) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();   // mes 1–12
const dataDe = (ano, mes, dia) => `${ano}-${String(mes).padStart(2, '0')}-${String(Math.min(dia, ultimoDia(ano, mes))).padStart(2, '0')}`;
export const addMeses = (i, n) => { const [a, m, dia] = i.split('-').map(Number), t = a * 12 + (m - 1) + n; return dataDe(Math.floor(t / 12), (t % 12 + 12) % 12 + 1, dia); };

/** fontes da agenda: chave, nome, cor, área do menu que dá acesso e tela de origem */
export const FONTES = [
  { k: 'compromisso', curto: 'compromissos', nome: 'Compromissos', cor: '#4f46e5', area: null, rota: 'agenda' },
  { k: 'receber', curto: 'rec.', nome: 'A receber', cor: '#15803d', area: 'fin', rota: 'abertos', valor: true },
  { k: 'pagar', curto: 'pag.', nome: 'A pagar', cor: '#b91c1c', area: 'fin', rota: 'abertos', valor: true },
  { k: 'cheque_rec', curto: 'chq', nome: 'Cheques de clientes', cor: '#0d9488', area: 'fin', rota: 'cheques', valor: true },
  { k: 'cheque_emi', curto: 'chq pr.', nome: 'Cheques próprios', cor: '#c2410c', area: 'fin', rota: 'cheques?aba=emitidos', valor: true },
  { k: 'fechamento', curto: 'fechamento', nome: 'Tarefas do fechamento', cor: '#7c3aed', area: 'fin', rota: 'fechamento' },
  { k: 'contato', curto: 'contatos', nome: 'Contatos com clientes', cor: '#0369a1', area: 'com', rota: 'comercial/carteira' },
  { k: 'arte', curto: 'artes', nome: 'Artes: prazos', cor: '#be185d', area: 'com', rota: 'preimpressao/artes' },
  { k: 'contrato', curto: 'contratos', nome: 'Contratos', cor: '#a16207', area: null, rota: 'contratos', papeis: ['admin', 'diretor', 'financeiro'] },
  { k: 'carga', curto: 'cargas', nome: 'Cargas e entregas', cor: '#0e7490', area: 'log', rota: 'logistica' },
  { k: 'frota', curto: 'frota', nome: 'Frota: documentos e CNH', cor: '#57534e', area: 'log', rota: 'logistica/gestao-frota' },
  { k: 'manutencao', curto: 'manutenção', nome: 'Manutenção', cor: '#9a3412', area: 'prd', rota: 'manutencao/ordens' },
  { k: 'qualidade', curto: 'qualidade', nome: 'Qualidade: prazos', cor: '#6d28d9', area: 'prd', rota: 'qualidade/nao-conformidades' },
  { k: 'licenca', curto: 'licenças', nome: 'Licenças ambientais', cor: '#4d7c0f', area: 'prd', rota: 'recuperadora/ambiental' },
  { k: 'sst', curto: 'exames', nome: 'Exames e treinamentos', cor: '#1d4ed8', area: 'rh', rota: 'rh/sst' },
  { k: 'ferias', curto: 'férias', nome: 'Férias', cor: '#0f766e', area: 'rh', rota: 'rh/ferias' },
];
export const fonte = (k) => FONTES.find(f => f.k === k) || { k, nome: k, cor: '#64748b', rota: 'agenda' };
/** fontes que a pessoa pode ver: área do menu, papel e o que a empresa desligou */
export function fontesVisiveis({ temArea, temRH, papel, desligadas = [] }) {
  return FONTES.filter(f => !desligadas.includes(f.k) && (!f.papeis || f.papeis.includes(papel)) && (!f.area || (f.area === 'rh' ? temRH() : temArea(f.area))));
}

export const TIPOS = { reuniao: 'Reunião', ligacao: 'Ligação', visita: 'Visita', tarefa: 'Tarefa', lembrete: 'Lembrete', outro: 'Outro' };
export const REPETIR = { nao: 'Não repete', diaria: 'Todo dia', semanal: 'Toda semana', mensal: 'Todo mês', anual: 'Todo ano' };
export const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** texto da repetição: "toda semana (seg, qua), até 31/12/2026" */
export function textoRepeticao(c) {
  if (!c || c.repetir === 'nao') return '';
  const n = +c.intervalo || 1, un = { diaria: ['todo dia', 'dias'], semanal: ['toda semana', 'semanas'], mensal: ['todo mês', 'meses'], anual: ['todo ano', 'anos'] }[c.repetir];
  let t = n === 1 ? un[0] : `a cada ${n} ${un[1]}`;
  if (c.repetir === 'semanal' && c.dias_semana?.length) t += ` (${[...c.dias_semana].sort().map(x => DIAS[x]).join(', ')})`;
  if (c.repetir_ate) t += `, até ${c.repetir_ate.split('-').reverse().join('/')}`;
  return t;
}

/** datas originais da série dentro de [de, ate] */
export function datasDaSerie(c, de, ate) {
  const fim = c.repetir_ate && c.repetir_ate < ate ? c.repetir_ate : ate, n = Math.max(1, +c.intervalo || 1), out = [];
  if (c.repetir === 'nao' || !c.repetir) return c.data >= de && c.data <= ate ? [c.data] : [];
  if (fim < c.data || fim < de) return [];
  if (c.repetir === 'diaria') {
    let x = c.data; if (x < de) x = addDias(x, Math.ceil(diasEntre(x, de) / n) * n);
    for (; x <= fim && out.length < 800; x = addDias(x, n)) out.push(x);
  } else if (c.repetir === 'semanal') {
    const dias = c.dias_semana?.length ? [...new Set(c.dias_semana)].sort() : [diaSemana(c.data)];
    let sem = addDias(c.data, -diaSemana(c.data));   // domingo da semana do início
    if (addDias(sem, 6) < de) sem = addDias(sem, Math.floor(diasEntre(sem, de) / (7 * n)) * 7 * n);
    for (; sem <= fim && out.length < 800; sem = addDias(sem, 7 * n)) for (const w of dias) { const x = addDias(sem, w); if (x >= c.data && x >= de && x <= fim) out.push(x); }
  } else {
    const passo = c.repetir === 'anual' ? 12 * n : n;
    for (let i = 0, x = c.data; x <= fim && i < 1200; i++, x = addMeses(c.data, i * passo)) if (x >= de) out.push(x);
  }
  return out;
}

/** ocorrências de um compromisso em [de, ate], já com as exceções (feito, cancelado, movido) */
export function ocorrencias(c, de, ate, excecoes = []) {
  if (c.situacao === 'cancelado') return [];
  const base = { fonte: 'compromisso', id: c.id, titulo: c.titulo, hora: c.hora ? String(c.hora).slice(0, 5) : null, horaFim: c.hora_fim ? String(c.hora_fim).slice(0, 5) : null,
    sub: [TIPOS[c.tipo] || '', c.local || ''].filter(Boolean).join(' · '), serie: c.repetir !== 'nao', pessoas: [c.dono, c.responsavel, ...(c.participantes || [])], comp: c, rota: 'agenda', acoes: { feito: true, adiar: true } };
  if (c.repetir === 'nao' || !c.repetir) return c.data >= de && c.data <= ate ? [{ ...base, uid: 'compromisso:' + c.id, data: c.data, dataOriginal: c.data, feito: c.situacao === 'feito' }] : [];
  const ex = new Map(excecoes.filter(x => x.compromisso_id === c.id).map(x => [x.data, x])), out = [];
  for (const dt of datasDaSerie(c, de, ate)) {
    const x = ex.get(dt);
    if (x && (x.acao === 'cancelado' || x.acao === 'movido')) continue;
    out.push({ ...base, uid: `compromisso:${c.id}:${dt}`, data: dt, dataOriginal: dt, feito: x?.acao === 'feito' });
  }
  for (const x of ex.values()) {
    if (x.acao !== 'movido' || x.nova_data < de || x.nova_data > ate) continue;
    if (x.data < c.data || (c.repetir_ate && x.data > c.repetir_ate)) continue;
    out.push({ ...base, uid: `compromisso:${c.id}:${x.data}`, data: x.nova_data, dataOriginal: x.data, hora: x.nova_hora ? String(x.nova_hora).slice(0, 5) : base.hora, feito: false, movido: true });
  }
  return out;
}

// ---------- itens das telas de origem ----------
/** títulos em aberto → a receber / a pagar (transferências ficam fora) */
export function itensTitulos(lancs, { planoById, favById, hoje, podeAdiar = false }) {
  const out = [];
  for (const l of lancs) {
    const p = planoById[l.plano_id]; if (!p || p.tipo === 'T') continue;
    const rec = p.natureza === 'C';
    out.push({ uid: 'lanc:' + l.id, fonte: rec ? 'receber' : 'pagar', id: l.id, data: l.data, titulo: favById[l.favorecido_id]?.nome || l.descricao || p.nome || 'Título',
      sub: [l.documento ? 'doc. ' + l.documento : '', p.nome].filter(Boolean).join(' · '), valor: +l.valor, sinal: rec ? 1 : -1, atrasado: l.data < hoje, rota: 'lancamentos?abrir=' + l.id, acoes: { adiar: podeAdiar } });
  }
  return out;
}
/** cheques: de clientes em carteira ou depositados (entrada) e próprios a compensar (saída), pela data "bom para" */
export function itensCheques(cheques, emitidos, { favById, contaById, hoje }) {
  const out = [];
  for (const c of cheques) if (['carteira', 'depositado'].includes(c.situacao))
    out.push({ uid: 'chq:' + c.id, fonte: 'cheque_rec', id: c.id, data: c.bom_para, titulo: `Cheque nº ${c.numero} · ${favById[c.favorecido_id]?.nome || c.emitente || ''}`.trim(), sub: c.situacao === 'depositado' ? 'depositado, aguardando compensar' : 'em carteira',
      valor: +c.valor, sinal: 1, noSaldo: c.situacao === 'carteira', atrasado: c.situacao === 'carteira' && c.bom_para < hoje, rota: 'cheques' + (c.situacao === 'depositado' ? '?aba=depositos' : ''), acoes: {} });
  for (const e of emitidos) if (e.situacao === 'emitido' && +e.valor > 0)
    out.push({ uid: 'chqe:' + e.id, fonte: 'cheque_emi', id: e.id, data: e.bom_para, titulo: `Cheque próprio nº ${e.numero} · ${favById[e.favorecido_id]?.nome || e.nominal || ''}`.trim(), sub: contaById[e.conta_id]?.nome || '',
      valor: +e.valor, sinal: -1, noSaldo: true, atrasado: e.bom_para < hoje, rota: 'cheques?aba=emitidos', acoes: {} });
  return out;
}
/** próximos contatos com clientes (Comercial) */
export function itensContatos(rows, { favById, hoje, podeEditar = false }) {
  return rows.filter(r => r.proximo_contato && !r.concluido).map(r => ({ uid: 'contato:' + r.id, fonte: 'contato', id: r.id, data: r.proximo_contato, titulo: `Contato: ${favById[r.favorecido_id]?.nome || 'cliente'}`,
    sub: r.proximo_assunto || r.resumo || '', atrasado: r.proximo_contato < hoje, pessoas: [r.vendedor_id, r.criado_por].filter(Boolean), rota: 'comercial/carteira', acoes: { feito: podeEditar, adiar: podeEditar } }));
}
/** tarefas do checklist do fechamento */
export function itensFechamento(rows, { hoje }) {
  return rows.filter(r => r.prazo).map(r => ({ uid: 'fech:' + r.id, fonte: 'fechamento', id: r.id, data: r.prazo, titulo: r.titulo, sub: `fechamento de ${String(r.mes).slice(0, 7).split('-').reverse().join('/')}`,
    feito: r.situacao !== 'pendente', atrasado: r.situacao === 'pendente' && r.prazo < hoje, pessoas: r.responsavel ? [r.responsavel] : [], rota: 'fechamento', acoes: {} }));
}
/** contratos vigentes: fim da vigência e data-base do reajuste (aniversário) dentro do período */
export function itensContratos(rows, { de, ate, hoje }) {
  const out = [];
  for (const c of rows) {
    if (c.status !== 'vigente') continue;
    const nome = `Contrato ${c.numero || ''} · ${c.parte_nome || c.objeto || ''}`.replace(/\s+/g, ' ').trim();
    if (c.fim && c.fim >= de && c.fim <= ate) out.push({ uid: 'contrato-fim:' + c.id, fonte: 'contrato', id: c.id, data: c.fim, titulo: nome, sub: c.renovacao_automatica ? 'fim da vigência (renova sozinho)' : 'fim da vigência', atrasado: c.fim < hoje, rota: 'contratos', acoes: {} });
    if (c.data_base && (c.indice || +c.reajuste_fixo_pct)) for (let a = +de.slice(0, 4); a <= +ate.slice(0, 4); a++) {
      const dt = dataDe(a, +c.data_base.slice(5, 7), +c.data_base.slice(8, 10));
      if (dt > c.data_base && dt >= de && dt <= ate && (!c.fim || dt <= c.fim)) out.push({ uid: `contrato-reaj:${c.id}:${a}`, fonte: 'contrato', id: c.id, data: dt, titulo: nome, sub: `data-base do reajuste${c.indice ? ' (' + c.indice + ')' : ''}`, rota: 'contratos', acoes: {} });
    }
  }
  return out;
}
/** item genérico de vencimento ou prazo */
export const itemSimples = (fonteK, id, data, titulo, sub, hoje, extra = {}) => ({ uid: `${fonteK}:${id}${extra.sufixo || ''}`, fonte: fonteK, id, data, titulo, sub: sub || '', atrasado: !extra.semAtraso && data < hoje, rota: fonte(fonteK).rota, acoes: {}, ...extra });

// ---------- filtros e agrupamentos ----------
/** filtra por fontes desligadas pela pessoa, "só os meus" (itens com pessoa precisam ser da pessoa) e busca */
export function filtrar(itens, { ocultas = new Set(), meus = false, uid = null, busca = '', feitos = true } = {}) {
  const b = busca.trim().toLowerCase();
  return itens.filter(i => !ocultas.has(i.fonte) && (feitos || !i.feito) && (!meus || !i.pessoas?.length || i.pessoas.includes(uid))
    && (!b || [i.titulo, i.sub, i.valor != null ? String(i.valor) : ''].some(v => String(v || '').toLowerCase().includes(b))));
}
const ordemItem = (a, b) => (a.fonte === 'compromisso' ? 0 : 1) - (b.fonte === 'compromisso' ? 0 : 1) || (a.hora ? 1 : 0) - (b.hora ? 1 : 0) || String(a.hora || '').localeCompare(String(b.hora || '')) || FONTES.findIndex(f => f.k === a.fonte) - FONTES.findIndex(f => f.k === b.fonte) || (b.valor || 0) - (a.valor || 0) || String(a.titulo).localeCompare(String(b.titulo));
/** Map data → itens ordenados (compromissos primeiro: dia inteiro, depois por hora; em seguida as outras fontes) */
export function porDia(itens) {
  const m = new Map();
  for (const i of itens) (m.get(i.data) || m.set(i.data, []).get(i.data)).push(i);
  for (const L of m.values()) L.sort(ordemItem);
  return m;
}
/** resumo do dia para a célula do mês: compromissos um a um e as demais fontes somadas */
export function resumoDia(itens) {
  const comp = itens.filter(i => i.fonte === 'compromisso'), g = new Map();
  for (const i of itens) { if (i.fonte === 'compromisso') continue; const x = g.get(i.fonte) || g.set(i.fonte, { fonte: i.fonte, n: 0, valor: 0, atrasado: false, pendentes: 0 }).get(i.fonte); x.n++; x.valor += i.valor || 0; if (!i.feito) x.pendentes++; if (i.atrasado && !i.feito) x.atrasado = true; }
  return { compromissos: comp, grupos: [...g.values()].sort((a, b) => FONTES.findIndex(f => f.k === a.fonte) - FONTES.findIndex(f => f.k === b.fonte)) };
}

// ---------- grades ----------
/** semanas do mês (com os dias vizinhos para completar), começando no domingo (0) ou na segunda (1) */
export function gradeMes(ano, mes, inicio = 0) {
  const p = dataDe(ano, mes, 1), u = dataDe(ano, mes, 31);
  let x = addDias(p, -((diaSemana(p) - inicio + 7) % 7)); const sem = [];
  while (x <= u) { sem.push(Array.from({ length: 7 }, (_, i) => addDias(x, i))); x = addDias(x, 7); }
  return sem;
}
export const semanaDe = (data, inicio = 0) => { const p = addDias(data, -((diaSemana(data) - inicio + 7) % 7)); return Array.from({ length: 7 }, (_, i) => addDias(p, i)); };
/** período carregado para cada visão: { de, ate, titulo } */
export function periodo(visao, ref, inicio = 0, diasLista = 30) {
  const br = (i) => i.split('-').reverse().join('/');
  if (visao === 'semana') { const s = semanaDe(ref, inicio); return { de: s[0], ate: s[6], titulo: `${br(s[0]).slice(0, 5)} a ${br(s[6])}` }; }
  if (visao === 'lista') return { de: ref, ate: addDias(ref, diasLista - 1), titulo: `${br(ref)} a ${br(addDias(ref, diasLista - 1))}` };
  const g = gradeMes(+ref.slice(0, 4), +ref.slice(5, 7), inicio);
  return { de: g[0][0], ate: g[g.length - 1][6], titulo: `${MESES[+ref.slice(5, 7) - 1]} de ${ref.slice(0, 4)}` };
}
/** anda para o período anterior (−1) ou seguinte (+1) */
export const navegar = (visao, ref, sentido, diasLista = 30) => visao === 'semana' ? addDias(ref, 7 * sentido) : visao === 'lista' ? addDias(ref, diasLista * sentido) : addMeses(ref.slice(0, 8) + '01', sentido);

// ---------- saldo projetado ----------
/**
 * Saldo previsto no fim de cada dia, de hoje até `ate`: saldo de hoje + entradas − saídas em aberto.
 * fluxos: [{ data, valor }] com sinal (+ entra, − sai). Vencidos entram em hoje quando `vencidosEmHoje`.
 * Devolve Map data → { entra, sai, saldo, abaixo }.
 */
export function saldoPorDia({ saldo, fluxos, hoje, ate, vencidosEmHoje = true, minimo = null }) {
  const mov = new Map(), add = (dt, v) => { const x = mov.get(dt) || mov.set(dt, { entra: 0, sai: 0 }).get(dt); if (v >= 0) x.entra += v; else x.sai += -v; };
  for (const f of fluxos) {
    if (!f.data || !f.valor) continue;
    if (f.data < hoje) { if (vencidosEmHoje) add(hoje, +f.valor); } else if (f.data <= ate) add(f.data, +f.valor);
  }
  const out = new Map(); let s = +saldo || 0;
  for (let x = hoje; x <= ate; x = addDias(x, 1)) {
    const m = mov.get(x) || { entra: 0, sai: 0 }; s += m.entra - m.sai;
    out.set(x, { entra: m.entra, sai: m.sai, saldo: Math.round(s * 100) / 100, abaixo: minimo != null && s < minimo });
  }
  return out;
}
/** valor curto para a célula do calendário: 1.234 → "1,2 mil", 2.500.000 → "2,5 mi" */
export function valorCurto(v) {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',') + ' mi';
  if (a >= 1e3) return s + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace('.', ',') + ' mil';
  return s + a.toFixed(0);
}
