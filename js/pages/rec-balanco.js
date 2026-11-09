// Recuperadora › Balanço de Massa (REC007): o mês em kg — material (estoque inicial + compra − desconto + aparas − consumo = estoque final),
// processo (entrada → grão + perdas apontadas + perda não explicada, contra a tolerância), grão (produzido e saídas) e resíduos (rejeito × destinado, sem CDF);
// relatório de material reciclado do período para clientes e logística reversa.
import { sb, state, q } from '../lib/data.js';
import { $, esc, toast, dateBR, today, modal } from '../lib/ui.js';
import { carregarRec, kpi, kg0, semSQL, avisoSQL, desligada, avisoDesligada } from '../lib/rec-ui.js';
import { conferirBalanco, DESTINOS, TIPOS_RESIDUO } from '../lib/recuperadora.js';

export const title = 'Balanço de Massa';
const h = new Date(), ant = new Date(h.getFullYear(), h.getMonth(), 1);
const ui = { mes: `${ant.getFullYear()}-${String(ant.getMonth() + 1).padStart(2, '0')}` };
const sinal = (v) => (+v < 0 ? '− ' : '+ ') + kg0(Math.abs(+v));
const linha = (t, v, cl = '', sub = '') => `<tr class="${cl}"><td>${t}${sub ? `<div class="small muted">${sub}</div>` : ''}</td><td class="num">${v}</td></tr>`;

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try {
    const R = await carregarRec();
    if (desligada(R)) { root.innerHTML = avisoDesligada(); return; }
    const B = await q(sb.rpc('rec_balanco', { p_empresa: state.empresa.id, p_mes: ui.mes + '-01' })), C = conferirBalanco(B), m = B.material, p = B.processo, g = B.grao, r = B.residuos;
    const pp = p.perdas || {};
    root.innerHTML = `<div class="card toolbar"><label class="small">Mês <input type="month" id="bm-m" value="${ui.mes}"></label><span class="small muted">Tolerância da perda não explicada: ${String(B.tolerancia_pct).replace('.', ',')}% da entrada (parâmetros).</span>
        <span class="spacer"></span><button class="btn" id="bm-rel">Relatório de material reciclado</button></div>
      <div class="kpis" style="margin-top:12px">${kpi('Material recebido', kg0(+m.comprado + +m.aparas + +m.outras), `${kg0(m.pesado)} pesados · desconto ${kg0(m.desconto)}`)}
        ${kpi('Grão produzido', kg0(g.produzido), p.rendimento == null ? '' : `rendimento ${(p.rendimento * 100).toFixed(1).replace('.', ',')}%`)}
        ${kpi('Perda não explicada', kg0(p.nao_explicada), p.entrada ? `${String(C.naoExplicadaPct).replace('.', ',')}% da entrada` : 'sem ordens no mês', C.processoOk ? 'pos' : 'neg')}
        ${kpi('Resíduo sem CDF', kg0(r.sem_cdf), 'destinado sem o certificado', +r.sem_cdf ? 'warn' : '')}</div>
      <div class="grid2" style="margin-top:12px;align-items:start">
        <div class="card"><h3 style="margin:0 0 8px">Material (antes do processo)</h3><table class="small"><tbody>
          ${linha('Estoque inicial em lotes', kg0(m.estoque_inicial))}${linha('Compra pesada na balança', sinal(m.pesado))}${linha('Desconto da classe (umidade e impureza)', sinal(-m.desconto), '', 'não é pago nem entra nos lotes')}
          ${linha('Apara interna', sinal(m.aparas))}${+m.outras ? linha('Doação e transferência', sinal(m.outras)) : ''}${linha('Consumido no processamento', sinal(-m.consumido))}
          ${linha('Estoque final em lotes', `<b>${kg0(m.estoque_final)}</b>`, 'row-sec')}</tbody></table>
          <p class="small ${C.materialFecha ? 'pos' : 'neg'}" style="margin:6px 0 0">${C.materialFecha ? 'A conta fecha com o saldo dos lotes.' : 'A conta não fecha com o saldo dos lotes: algum lote foi alterado fora do fluxo.'}</p></div>
        <div class="card"><h3 style="margin:0 0 8px">Processo (ordens concluídas no mês)</h3><table class="small"><tbody>
          ${linha('Entrada nas ordens', kg0(p.entrada))}${linha('Grão produzido', sinal(-p.produzido))}
          ${['umidade', 'sujeira', 'finos', 'rejeito'].map(k => linha('Perda apontada: ' + k, sinal(-(+pp[k] || 0)))).join('')}
          ${linha('Perda não explicada', `<b class="${C.processoOk ? '' : 'neg'}">${kg0(p.nao_explicada)}</b>`, 'row-sec', 'entrada − grão − perdas apontadas nas etapas')}</tbody></table>
          <p class="small ${C.processoOk ? 'pos' : 'neg'}" style="margin:6px 0 0">${C.processoOk ? 'Dentro da tolerância.' : 'Acima da tolerância: confira os pesos das etapas e a balança. O alerta vai para a Central de Decisões no mês seguinte.'}</p></div>
        <div class="card"><h3 style="margin:0 0 8px">Grão</h3><table class="small"><tbody>
          ${linha('Estoque inicial', kg0(g.estoque_inicial))}${linha('Produzido', sinal(g.produzido))}${Object.entries(g.saidas || {}).map(([k, v]) => linha('Saída: ' + (DESTINOS[k] || k).toLowerCase(), sinal(-v))).join('')}
          ${linha('Estoque final', `<b>${kg0(g.estoque_final)}</b>`, 'row-sec')}</tbody></table></div>
        <div class="card"><h3 style="margin:0 0 8px">Resíduos</h3><table class="small"><tbody>
          ${linha('Rejeito apontado nas etapas', kg0(r.rejeito_apontado))}${linha('Destinado no mês (todos os tipos)', kg0(r.destinado))}
          ${(r.por_tipo || []).map(x => linha(esc(TIPOS_RESIDUO[x.tipo] || x.tipo), kg0(x.kg), '', `${kg0(x.com_cdf || 0)} com CDF · ${kg0(x.sem_cdf || 0)} sem CDF`)).join('')}
          ${linha('Destinado sem CDF (todos os meses até aqui)', `<b class="${+r.sem_cdf ? 'warn' : ''}">${kg0(r.sem_cdf)}</b>`, 'row-sec')}</tbody></table>
          <p class="small muted" style="margin:6px 0 0">Registre a destinação com o MTR e o CDF em <a href="#/recuperadora/ambiental">Ambiental</a>. O lodo da lavagem e a borra não são pesados nas etapas: entram só pela destinação.</p></div></div>`;
    $('#bm-m', root).onchange = (e) => { if (e.target.value) { ui.mes = e.target.value; render(root); } };
    $('#bm-rel', root).onclick = () => relatorio(R, root);
  } catch (err) { root.innerHTML = semSQL(err) ? avisoSQL : `<div class="card"><div class="empty">${esc(err.message)}</div></div>`; }
}

function relatorio(R) {
  const md = modal({ title: 'Relatório de material reciclado', narrow: true, body: `<p class="small">Toneladas de grão produzido, origem do material recebido e resíduos destinados no período, para clientes e para a logística reversa.</p>
      <div class="grid2"><label>De<input type="date" id="rl-de" value="${ui.mes.slice(0, 4)}-01-01"></label><label>Até<input type="date" id="rl-ate" value="${today()}"></label></div>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rl-ok">Imprimir</button>' });
  $('#rl-ok', md.el).onclick = () => { const de = $('#rl-de', md.el).value, ate = $('#rl-ate', md.el).value; if (!de || !ate) return toast('Informe o período', true); md.close(); imprimir(de, ate); };
}
async function imprimir(de, ate) {
  try {
    const D = await q(sb.rpc('rec_reciclado', { p_empresa: state.empresa.id, p_de: de, p_ate: ate })), E = state.empresa;
    const tot = (a) => a.reduce((s, x) => s + +x.kg, 0), t = (v) => (+v / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    const w = window.open('', '_blank'); if (!w) return toast('Libere as janelas pop-up para imprimir', true);
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Material reciclado ${dateBR(de)} a ${dateBR(ate)}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:14mm;color:#111}
      h1{font-size:17px;margin:0 0 2px} h2{font-size:13px;margin:16px 0 4px} table{width:100%;border-collapse:collapse} th,td{border-bottom:1px solid #ccc;padding:4px;text-align:left} .n{text-align:right} .t td{font-weight:bold;border-top:1.5px solid #000}
      .ass{margin-top:24mm;width:80mm;border-top:1px solid #000;text-align:center;padding-top:2mm}</style></head><body>
      <h1>${esc(E.razao_social || E.nome || '')}</h1><div>${E.cnpj ? 'CNPJ ' + esc(E.cnpj) + ' · ' : ''}Relatório de material reciclado — ${dateBR(de)} a ${dateBR(ate)}</div>
      <h2>Grão reciclado produzido</h2><table><thead><tr><th>Material</th><th>Polímero</th><th class="n">Toneladas</th></tr></thead><tbody>
        ${(D.grao || []).map(x => `<tr><td>${esc(x.material)}</td><td>${esc(x.polimero)}</td><td class="n">${t(x.kg)}</td></tr>`).join('') || '<tr><td colspan="3">—</td></tr>'}
        <tr class="t"><td colspan="2">Total</td><td class="n">${t(tot(D.grao || []))}</td></tr></tbody></table>
      <h2>Origem do material recebido</h2><table><thead><tr><th>Origem</th><th class="n">Toneladas</th></tr></thead><tbody>
        ${(D.origem || []).map(x => `<tr><td>${esc(x.origem)}</td><td class="n">${t(x.kg)}</td></tr>`).join('') || '<tr><td colspan="2">—</td></tr>'}
        <tr class="t"><td>Total</td><td class="n">${t(tot(D.origem || []))}</td></tr></tbody></table>
      <h2>Resíduos destinados</h2><table><thead><tr><th>Tipo</th><th>Destinação</th><th class="n">Toneladas</th></tr></thead><tbody>
        ${(D.residuos || []).map(x => `<tr><td>${esc(TIPOS_RESIDUO[x.tipo] || x.tipo)}</td><td>${esc(x.destinacao)}</td><td class="n">${t(x.kg)}</td></tr>`).join('') || '<tr><td colspan="3">—</td></tr>'}</tbody></table>
      <p style="font-size:10px;color:#555;margin-top:10px">Pesos pela balança da empresa (peso pago, depois do desconto de umidade e impureza) e pelas ordens de reprocesso concluídas. Emitido em ${new Date().toLocaleString('pt-BR')}.</p>
      <div class="ass">Responsável</div><script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  } catch (err) { toast(err.message, true); }
}
