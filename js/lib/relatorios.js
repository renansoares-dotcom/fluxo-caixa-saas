// Relatórios agendados (melhoria 1.7): modelos prontos, períodos, frequência e validação (o envio é do banco, SQL 138).

export const PERIODOS = {
  hoje: 'Hoje', ontem: 'Ontem', semana_atual: 'Esta semana', semana_passada: 'Semana passada', mes_atual: 'Este mês', mes_anterior: 'Mês anterior',
  ano_atual: 'Este ano', ultimos_7: 'Últimos 7 dias', ultimos_30: 'Últimos 30 dias', ultimos_12_meses: 'Últimos 12 meses', proximos_7: 'Próximos 7 dias', proximos_30: 'Próximos 30 dias',
};
export const FREQUENCIAS = { diaria: 'Todo dia', dias_uteis: 'Dias úteis (seg. a sex.)', semanal: 'Toda semana', mensal: 'Todo mês' };
export const DIAS_SEMANA = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

const B = (titulo, fonte, metrica, agrupar, periodo, filtros = {}, extra = {}) => ({ titulo, fonte, metrica, agrupar, periodo, filtros, limite: 15, ...extra });
export const MODELOS = [
  { id: 'caixa', nome: 'Posição de caixa', frequencia: 'dias_uteis', hora: 8, descricao: 'Saldo das contas e o que vence nos próximos 7 dias.',
    blocos: [B('Saldo das contas', 'saldos', 'saldo', 'conta', 'hoje'),
      B('A pagar nos próximos 7 dias', 'lancamentos', 'valor', 'favorecido', 'proximos_7', { status: 'Em aberto', tipo: 'saida', excluir_transferencias: 'true' }),
      B('A receber nos próximos 7 dias', 'lancamentos', 'valor', 'favorecido', 'proximos_7', { status: 'Em aberto', tipo: 'entrada', excluir_transferencias: 'true' })] },
  { id: 'pagar', nome: 'Contas a pagar da semana', frequencia: 'semanal', dia_semana: 1, hora: 8, descricao: 'Os títulos a pagar da semana, por dia e por favorecido.',
    blocos: [B('Por dia', 'lancamentos', 'valor', 'dia', 'proximos_7', { status: 'Em aberto', tipo: 'saida', excluir_transferencias: 'true' }, { ordem: 'chave' }),
      B('Por favorecido', 'lancamentos', 'valor', 'favorecido', 'proximos_7', { status: 'Em aberto', tipo: 'saida', excluir_transferencias: 'true' })] },
  { id: 'faturamento', nome: 'Faturamento', frequencia: 'semanal', dia_semana: 1, hora: 8, descricao: 'Faturamento da semana passada por cliente e do ano por mês.',
    blocos: [B('Semana passada por cliente', 'notas', 'valor', 'cliente', 'semana_passada', { tipo: 'saida', propria: 'true' }),
      B('Ano por mês', 'notas', 'valor', 'mes', 'ano_atual', { tipo: 'saida', propria: 'true' }, { ordem: 'chave' })] },
  { id: 'despesas', nome: 'Despesas do mês anterior', frequencia: 'mensal', dia_mes: 2, hora: 8, descricao: 'Despesas pagas no mês anterior por classe e por centro de custo.',
    blocos: [B('Por classe', 'lancamentos', 'valor', 'classe', 'mes_anterior', { status: 'Pago', tipo: 'saida', excluir_transferencias: 'true' }),
      B('Por centro de custo', 'lancamentos', 'valor', 'centro_custo', 'mes_anterior', { status: 'Pago', tipo: 'saida', excluir_transferencias: 'true' })] },
  { id: 'producao', nome: 'Produção de ontem', frequencia: 'dias_uteis', hora: 7, descricao: 'Quilos e refugo por máquina no dia anterior.',
    blocos: [B('Quilos por máquina', 'producao', 'kg', 'maquina', 'ontem'), B('Refugo % por máquina', 'producao', 'refugo_pct', 'maquina', 'ontem')] },
  { id: 'fretes', nome: 'Fretes do mês anterior', frequencia: 'mensal', dia_mes: 3, hora: 8, descricao: 'Fretes de terceiros do mês anterior por transportadora e destino.',
    blocos: [B('Por transportadora', 'fretes', 'valor', 'transportador', 'mes_anterior'), B('Por destino', 'fretes', 'valor', 'destino', 'mes_anterior')] },
];

export function descreverFrequencia(r) {
  const h = `às ${String(r.hora ?? 8).padStart(2, '0')}h`;
  if (r.frequencia === 'semanal') return `Toda ${DIAS_SEMANA[r.dia_semana || 1]} ${h}`;
  if (r.frequencia === 'mensal') return `Todo dia ${r.dia_mes || 1} ${h}`;
  return `${FREQUENCIAS[r.frequencia] || 'Todo dia'} ${h}`;
}

export function parseFiltros(txt) {
  const o = {};
  for (const p of String(txt || '').split(/[;\n]/)) {
    const i = p.indexOf('='); if (i < 1) continue;
    const k = p.slice(0, i).trim(), v = p.slice(i + 1).trim();
    if (k && v) o[k] = v;
  }
  return o;
}
export const filtrosTexto = (f) => Object.entries(f || {}).map(([k, v]) => `${k}=${v}`).join('; ');

export function validar(r, catalogo = null) {
  const e = [];
  if (!r.nome || r.nome.trim().length < 3) e.push('Dê um nome ao relatório.');
  const emails = r.destinatarios || [];
  if (!emails.length) e.push('Informe ao menos um destinatário.');
  for (const m of emails) if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m)) e.push(`E-mail inválido: ${m}`);
  if (emails.length > 20) e.push('No máximo 20 destinatários.');
  if (!r.blocos?.length) e.push('Inclua ao menos um bloco.');
  if (r.blocos?.length > 10) e.push('No máximo 10 blocos.');
  (r.blocos || []).forEach((b, i) => {
    if (!b.fonte || !b.metrica) e.push(`Bloco ${i + 1}: escolha a fonte e a medida.`);
    else if (catalogo && !catalogo[b.fonte]?.metricas?.[b.metrica]) e.push(`Bloco ${i + 1}: a medida não existe nessa fonte.`);
    if (catalogo && b.agrupar && !catalogo[b.fonte]?.agrupar?.[b.agrupar]) e.push(`Bloco ${i + 1}: o agrupamento não existe nessa fonte.`);
  });
  return e;
}

export const separarEmails = (txt) => [...new Set(String(txt || '').split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean))];
