// Pergunte à plataforma (melhoria 1.8): formatação dos números, rótulos, gráfico e texto da resposta.
// A conversa com a IA fica na função de borda "perguntar"; aqui só a apresentação (testada sem navegador).

const DINHEIRO = new Set(['valor', 'saldo', 'media', 'ticket', 'produtos', 'frete', 'icms', 'ipi', 'pedagio']);
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const br = (v, d = 2) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

export function formatarValor(v, metrica) {
  if (v == null || v === '' || Number.isNaN(+v)) return '–';
  if (DINHEIRO.has(metrica)) return 'R$ ' + br(v);
  if (metrica === 'kg' || metrica === 'refugo') return br(v, 0) + ' kg';
  if (metrica === 'refugo_pct') return br(v, 1) + '%';
  if (metrica === 'horas') return br(v, 1) + ' h';
  if (metrica === 'km') return br(v, 0) + ' km';
  return br(v, 0);
}

export function rotuloChave(k, agrupar) {
  const s = String(k ?? '');
  if (agrupar === 'mes' && /^\d{4}-\d{2}$/.test(s)) return `${MESES[+s.slice(5) - 1]}/${s.slice(0, 4)}`;
  if (agrupar === 'dia' && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split('-').reverse().join('/');
  return s;
}

/** configuração do Chart.js a partir da tabela gravada e do tipo escolhido pela IA */
export function configGrafico(tabela, grafico, cores = ['#0a8ed3', '#eb6834', '#4a3aa7', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#e34948']) {
  if (!tabela || !grafico || !tabela.linhas?.length) return null;
  let linhas = tabela.linhas;
  let tipo = grafico.tipo === 'linha' ? 'line' : grafico.tipo === 'pizza' ? 'doughnut' : 'bar';
  if (tipo === 'doughnut' && (linhas.length > 6 || linhas.some(l => +l[1] < 0))) tipo = 'bar';   // pizza só com poucas fatias positivas
  const agr = tabela.agrupar || (tabela.colunas?.[0] && /mês/i.test(tabela.colunas[0]) ? 'mes' : null);
  const horizontal = tipo === 'bar' && linhas.length > 8 && !['mes', 'dia', 'ano'].includes(agr);
  if (horizontal) linhas = linhas.slice(0, 20);
  const met = tabela.metrica;
  return {
    type: tipo,
    data: {
      labels: linhas.map(l => rotuloChave(l[0], agr)),
      datasets: [{ label: tabela.colunas?.[1] || '', data: linhas.map(l => +l[1]),
        backgroundColor: tipo === 'doughnut' ? cores.slice(0, linhas.length) : cores[0], borderColor: cores[0], tension: 0.25, fill: false }],
    },
    options: {
      indexAxis: horizontal ? 'y' : 'x', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: tipo === 'doughnut' }, title: { display: !!grafico.titulo, text: grafico.titulo },
        tooltip: { callbacks: { label: (c) => formatarValor(c.raw, met) } } },
    },
  };
}

/** texto da IA → HTML simples (negrito, listas, quebras); tudo escapado antes */
export function textoHtml(t) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const linhas = esc(t || '').split('\n');
  let html = '', lista = false;
  for (const l of linhas) {
    const m = l.match(/^\s*[-*•]\s+(.*)$/);
    if (m) { if (!lista) { html += '<ul>'; lista = true; } html += `<li>${m[1]}</li>`; continue; }
    if (lista) { html += '</ul>'; lista = false; }
    if (l.trim()) html += `<p>${l}</p>`;
  }
  if (lista) html += '</ul>';
  return html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

export const SUGESTOES = [
  'Quanto faturamos por mês este ano?',
  'Quais os 10 clientes que mais compraram nos últimos 12 meses?',
  'Quanto pagamos de combustível por mês este ano?',
  'Quanto gastamos com frete de terceiros por transportadora em outubro?',
  'Qual o refugo por máquina no mês passado?',
  'Quais os fornecedores com mais pedidos de compra este ano?',
  'Quanto temos a pagar em aberto por fornecedor?',
  'Qual o ticket médio das notas por UF este ano?',
];

/** perguntas anteriores da conversa que vão como contexto (as 2 últimas com resposta) */
export const anteriores = (hist) => (hist || []).filter(h => h.resposta && !h.erro).slice(-2).map(h => ({ pergunta: h.pergunta, resposta: h.resposta }));
