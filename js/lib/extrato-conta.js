// Extrato da conta (Conferência do Dia › Extrato em PDF): o movimento pago da conta no formato de extrato bancário —
// saldo inicial, cada lançamento com o saldo corrente e, por dia, entradas, saídas e saldo final. Parte pura (sem banco nem tela),
// usada pela tela e pelos testes. Os números são os mesmos da Conferência do Dia (lançamentos pagos, transferência = duas pontas).

const r2 = (v) => Math.round(v * 100) / 100;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => (Math.abs(v) < 0.005 ? 0 : v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const semana = (iso) => SEM[new Date(iso + 'T12:00:00').getDay()];

/**
 * Monta o extrato de uma conta.
 * @param {object[]} cel   dias da Conferência (cada um com d, ini, fim, ent, sai, dl = lançamentos com .sinal)
 * @param {object}   o     { de, ate (ISO), historico(l) → { titulo, detalhe, documento } }
 * @returns {{ saldoInicial, entradas, saidas, saldoFinal, qtd, dias: [{ d, ini, ent, sai, fim, itens: [{ titulo, detalhe, documento, valor, saldo }] }] }}
 */
export function montarExtrato(cel, { de, ate, historico = (l) => ({ titulo: l.descricao || '', detalhe: '', documento: l.documento || '' }) } = {}) {
  const sel = cel.filter(x => (!de || x.d >= de) && (!ate || x.d <= ate)).sort((a, b) => a.d.localeCompare(b.d));
  if (!sel.length) return { saldoInicial: 0, entradas: 0, saidas: 0, saldoFinal: 0, qtd: 0, dias: [] };
  const dias = sel.map(x => {
    let s = +x.ini;
    const itens = (x.dl || []).map(l => { s = r2(s + l.sinal); const h = historico(l); return { ...h, valor: r2(l.sinal), saldo: s }; });
    return { d: x.d, ini: r2(+x.ini), ent: r2(x.ent), sai: r2(x.sai), fim: r2(+x.fim), itens };
  });
  const entradas = r2(dias.reduce((t, x) => t + x.ent, 0)), saidas = r2(dias.reduce((t, x) => t + x.sai, 0));
  return { saldoInicial: dias[0].ini, entradas, saidas, saldoFinal: dias[dias.length - 1].fim, qtd: dias.reduce((t, x) => t + x.itens.length, 0), dias };
}

const num = (v) => `<td class="n ${v < -0.005 ? 'neg' : ''}">${brl(v)}</td>`;
const vazio = '<td class="n"></td>';

/** quadro de resumo do extrato (conta e período) */
function quadro(conta, e, de, ate) {
  const banco = [conta.instituicao, conta.agencia && `ag. ${conta.agencia}`, conta.numero && `c/c ${conta.numero}`].filter(Boolean).join(' · ');
  return `<table class="info ext-res"><tr><td>Conta</td><td>${esc(conta.nome)}${banco ? ` <span class="m">(${esc(banco)})</span>` : ''}</td></tr>
    <tr><td>Período</td><td>${dataBR(de)} a ${dataBR(ate)}</td></tr></table>
    <table class="ext-tot"><tr><td>Saldo inicial<b>${brl(e.saldoInicial)}</b></td><td>(+) Entradas<b class="pos">${brl(e.entradas)}</b></td>
      <td>(−) Saídas<b class="neg">${brl(Math.abs(e.saidas))}</b></td><td>(=) Saldo final<b class="${e.saldoFinal < -0.005 ? 'neg' : ''}">${brl(e.saldoFinal)}</b></td></tr></table>`;
}

/**
 * HTML do extrato de uma conta.
 * detalhado: cada lançamento com o saldo corrente, agrupado por dia (abre com o saldo inicial do dia, fecha com entradas, saídas e saldo final);
 * resumido: uma linha por dia. semMovimento: inclui os dias sem lançamento (só no resumido; no detalhado viram uma linha de saldo).
 */
export function htmlExtrato(conta, e, { de, ate, detalhado = true, semMovimento = false } = {}) {
  const dias = semMovimento ? e.dias : e.dias.filter(x => x.itens.length);
  if (!detalhado) {
    return `${quadro(conta, e, de, ate)}
    <table class="ext"><thead><tr><th>Data</th><th class="n">Saldo inicial</th><th class="n">Entradas</th><th class="n">Saídas</th><th class="n">Saldo final</th><th class="n">Lanç.</th></tr></thead><tbody>
    ${dias.map(x => `<tr><td class="nw">${dataBR(x.d)} <span class="m">${semana(x.d)}</span></td>${num(x.ini)}${x.ent ? num(x.ent) : vazio}${x.sai ? num(Math.abs(x.sai)) : vazio}<td class="n"><b class="${x.fim < -0.005 ? 'neg' : ''}">${brl(x.fim)}</b></td><td class="n">${x.itens.length || ''}</td></tr>`).join('')
      || '<tr><td colspan="6" class="m">Sem movimento no período.</td></tr>'}</tbody>
    <tfoot><tr><td>Período</td>${num(e.saldoInicial)}${num(e.entradas)}${num(Math.abs(e.saidas))}${num(e.saldoFinal)}<td class="n">${e.qtd}</td></tr></tfoot></table>`;
  }
  const corpo = dias.map(x => {
    const cab = `<tr class="gr"><td class="nw">${dataBR(x.d)} <span class="m">${semana(x.d)}</span></td><td colspan="3">SALDO INICIAL DO DIA</td>${vazio}${num(x.ini)}</tr>`;
    if (!x.itens.length) return cab.replace('SALDO INICIAL DO DIA', 'SEM MOVIMENTO — SALDO DO DIA');
    const its = x.itens.map(i => `<tr><td></td><td>${esc(i.titulo)}${i.detalhe ? `<div class="m">${esc(i.detalhe)}</div>` : ''}</td><td class="nw">${esc(i.documento || '')}</td>
      ${i.valor > 0 ? num(i.valor) : vazio}${i.valor < 0 ? num(Math.abs(i.valor)) : vazio}${num(i.saldo)}</tr>`).join('');
    const tot = `<tr class="st"><td></td><td colspan="2">Total do dia ${dataBR(x.d).slice(0, 5)}: ${x.itens.length} lançamento(s)</td>${num(x.ent)}${num(Math.abs(x.sai))}<td class="n"><b class="${x.fim < -0.005 ? 'neg' : ''}">${brl(x.fim)}</b></td></tr>`;
    return cab + its + tot;
  }).join('');
  return `${quadro(conta, e, de, ate)}
    <table class="ext"><thead><tr><th style="width:62px">Data</th><th>Histórico</th><th style="width:70px">Documento</th><th class="n" style="width:82px">Entradas</th><th class="n" style="width:82px">Saídas</th><th class="n" style="width:90px">Saldo</th></tr></thead><tbody>
    ${corpo || '<tr><td colspan="6" class="m">Sem movimento no período.</td></tr>'}</tbody>
    <tfoot><tr><td colspan="3">Total do período · ${e.qtd} lançamento(s)</td>${num(e.entradas)}${num(Math.abs(e.saidas))}${num(e.saldoFinal)}</tr></tfoot></table>`;
}

/** regras de estilo próprias do extrato (somadas ao padrão dos relatórios) */
export const CSS_EXTRATO = `
  .ext-tot{width:100%;border-collapse:collapse;margin:6px 0 10px} .ext-tot td{border:0;border-top:1.2px solid #000;border-bottom:1.2px solid #000;padding:6px 8px;width:25%;font-size:9.5px}
  .ext-tot b{display:block;font-size:13px;margin-top:2px;text-align:left} .ext td.nw,.ext-res td.nw{white-space:nowrap}
  .ext td{font-size:9.8px} .ext tr.gr td{font-size:9.8px} .ext tr.st td{background:#fafafa}
  .ext-conta{page-break-before:always} .ext-conta:first-of-type{page-break-before:auto}`;
