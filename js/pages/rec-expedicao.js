// Recuperadora › Expedição (REC011, SQL 167): a venda do grão (ou de um lote separado) num documento com romaneio —
// cliente, nota, transportador, lotes com kg, volumes, embalagem e preço. "Expedir" dá a saída de venda em cada lote
// (lote bloqueado pela qualidade não embarca) e gera o título a receber, se a conta estiver nos parâmetros.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, money, dateBR, today, toast, fail, modal, parseNum, exportXLSX, confirmDialog } from '../lib/ui.js';
import { carregarRec, podeOperar, podeConfig, kpi, kg, kg0, rkg, semSQL, desligada, avisoDesligada, nomeMat } from '../lib/rec-ui.js';
import { resumoExpedicao, SIT_EXPEDICAO, EMBALAGENS } from '../lib/recuperadora.js';

export const title = 'Expedição';
const mesIni = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const ui = { de: mesIni(), ate: today(), sit: 'todas' };
const n3 = (v) => v == null || v === '' ? '' : String(+v).replace('.', ',');
const aviso167 = '<div class="card"><div class="empty">A Expedição precisa do SQL 167. Avise o administrador da plataforma.</div></div>';

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try {
    const R = await carregarRec();
    if (desligada(R)) { root.innerHTML = avisoDesligada(); return; }
    const e = state.empresa.id;
    const X = await q(sb.from('rec_expedicoes').select('*, itens:rec_expedicao_itens(id)').eq('empresa_id', e).or(`and(data.gte.${ui.de},data.lte.${ui.ate}),situacao.eq.aberta`).order('data', { ascending: false }).order('numero', { ascending: false }));
    const L = X.filter(x => ui.sit === 'todas' || x.situacao === ui.sit), EXP = X.filter(x => x.situacao === 'expedida'), AB = X.filter(x => x.situacao === 'aberta');
    const pk = EXP.reduce((s, x) => s + +x.peso_total, 0), vl = EXP.reduce((s, x) => s + +x.valor_total, 0), ct = EXP.reduce((s, x) => s + +x.custo_total, 0);
    root.innerHTML = `<div class="kpis">${kpi('Expedições abertas', AB.length, AB.length ? 'aguardando o embarque' : 'nenhuma pendente', AB.length ? 'warn' : '')}
        ${kpi('Expedido no período', kg0(pk), `${EXP.length} expedição(ões) · ${new Set(EXP.map(x => x.cliente_id)).size} cliente(s)`)}
        ${kpi('Valor vendido', money(vl), pk ? `${rkg(vl / pk)} por kg` : '')}${kpi('Margem sobre o custo dos lotes', money(vl - ct), vl ? `${((vl - ct) / vl * 100).toFixed(1).replace('.', ',')}% da venda` : '', vl - ct >= 0 ? 'pos' : 'neg')}</div>
      <div class="card toolbar" style="margin-top:12px"><label class="small">De <input type="date" id="ex-de" value="${ui.de}"></label><label class="small">Até <input type="date" id="ex-ate" value="${ui.ate}"></label>
        <div class="chips" id="ex-sit">${[['todas', 'Todas'], ['aberta', 'Abertas'], ['expedida', 'Expedidas'], ['cancelada', 'Canceladas']].map(([k, t]) => `<span class="chip ${ui.sit === k ? 'on' : ''}" data-s="${k}">${t}</span>`).join('')}</div>
        <span class="spacer"></span><button class="btn" id="ex-x">Excel</button>${podeOperar() ? '<button class="btn primary" id="ex-n">+ Nova expedição</button>' : ''}</div>
      <div class="card flush" style="margin-top:12px"><div class="table-wrap" id="ex-t" style="max-height:62vh"><table><thead><tr><th>Nº</th><th>Data</th><th>Cliente</th><th>Nota</th><th>Transporte</th><th class="num">Lotes</th><th class="num">Peso</th><th class="num">Valor</th><th>Situação</th></tr></thead><tbody>
        ${L.map(x => `<tr class="clickable" data-id="${x.id}"><td><b>${x.numero}</b></td><td>${dateBR(x.data)}</td><td>${esc(R.fornById[x.cliente_id]?.nome || '—')}</td><td>${esc(x.nf_numero || '')}</td>
          <td class="small">${esc([x.transportador, x.placa].filter(Boolean).join(' · '))}</td><td class="num">${x.itens?.length ?? ''}</td><td class="num">${x.peso_total != null ? kg0(x.peso_total) : '–'}</td>
          <td class="num">${x.valor_total != null ? money(x.valor_total) : '–'}</td><td><span class="badge ${SIT_EXPEDICAO[x.situacao][1]}">${SIT_EXPEDICAO[x.situacao][0]}</span></td></tr>`).join('')
          || '<tr><td colspan="9" class="empty">Nenhuma expedição no período. "+ Nova expedição" escolhe o cliente e os lotes que embarcam.</td></tr>'}</tbody></table></div></div>
      <p class="small muted">As abertas aparecem sempre, mesmo fora do período. A margem compara o valor vendido com o custo dos lotes embarcados.</p>`;
    $('#ex-de', root).onchange = (ev) => { ui.de = ev.target.value || mesIni(); render(root); };
    $('#ex-ate', root).onchange = (ev) => { ui.ate = ev.target.value || today(); render(root); };
    $('#ex-sit', root).onclick = (ev) => { const s = ev.target.closest('[data-s]')?.dataset.s; if (s) { ui.sit = s; render(root); } };
    $('#ex-x', root).onclick = () => exportXLSX($('#ex-t table', root), `expedicoes_${ui.de}_${ui.ate}`);
    root.querySelector('tbody').onclick = (ev) => { const id = ev.target.closest('tr[data-id]')?.dataset.id; if (id) abrir(R, id, root); };
    $('#ex-n', root) && ($('#ex-n', root).onclick = async () => {
      try { const [x] = await q(sb.from('rec_expedicoes').insert({ empresa_id: e, data: today() }).select('id')); await render(root); abrir(R, x.id, root); } catch (err) { fail(err); } });
  } catch (err) { root.innerHTML = semSQL(err) ? aviso167 : `<div class="card"><div class="empty">${esc(err.message)}</div></div>`; }
}

async function abrir(R, id, root) {
  const e = state.empresa.id;
  const [[x], IT] = await Promise.all([q(sb.from('rec_expedicoes').select('*').eq('id', id)), q(sb.from('rec_expedicao_itens').select('*, lote:rec_lotes(codigo, tipo, material_id, saldo_kg, peso_kg, custo_total, situacao)').eq('expedicao_id', id).order('criado_em'))]);
  const aberta = x.situacao === 'aberta', pode = aberta && podeOperar(), dis = pode ? '' : 'disabled';
  const clientes = R.forn.filter(f => f.ativo !== false || f.id === x.cliente_id);
  const md = modal({ title: `Expedição ${x.numero}${aberta ? '' : ' — ' + SIT_EXPEDICAO[x.situacao][0].toLowerCase()}`, wide: true, body: `
    <div class="grid-form"><label class="c4">Data<input type="date" id="xp-d" value="${x.data}" ${dis}></label>
      <label class="span2">Cliente *<input id="xp-c" list="xp-cl" value="${esc(R.fornById[x.cliente_id]?.nome || '')}" placeholder="nome do cliente" ${dis}><datalist id="xp-cl">${clientes.map(f => `<option value="${esc(f.nome)}">${esc(f.documento || '')}</option>`).join('')}</datalist></label>
      <label class="c4">Nota fiscal${R.cfg.expedicao_exigir_nf ? ' *' : ''}<input id="xp-nf" value="${esc(x.nf_numero || '')}" ${dis}></label>
      <label class="c4">Transportador<input id="xp-t" value="${esc(x.transportador || '')}" ${dis}></label><label class="c4">Placa<input id="xp-p" maxlength="8" value="${esc(x.placa || '')}" style="text-transform:uppercase" ${dis}></label>
      <label class="c4">Motorista<input id="xp-m" value="${esc(x.motorista || '')}" ${dis}></label><label class="span2">Observação<input id="xp-o" value="${esc(x.observacao || '')}" ${dis}></label></div>
    ${x.situacao === 'cancelada' ? `<p class="small neg">Cancelada${x.cancelada_em ? ' em ' + new Date(x.cancelada_em).toLocaleDateString('pt-BR') : ''}: ${esc(x.cancelamento_motivo || '')}</p>` : ''}
    <h3 style="margin:14px 0 6px">Lotes que embarcam</h3>
    <div class="table-wrap"><table class="small"><thead><tr><th>Lote</th><th>Material</th><th class="num">kg</th><th class="num">Volumes</th><th>Embalagem</th><th class="num">R$/kg</th><th class="num">Valor</th><th class="num">Custo/kg</th><th></th></tr></thead><tbody>
      ${IT.map(i => { const l = i.lote || {}, ck = +l.peso_kg ? l.custo_total / l.peso_kg : null; return `<tr><td><b>${esc(l.codigo || '')}</b>${aberta && l.situacao && l.situacao !== 'disponivel' ? ` <span class="badge vencido" title="Só lote disponível embarca">${esc(l.situacao.replace('_', ' '))}</span>` : ''}</td>
        <td>${esc(nomeMat(R, l.material_id))}</td><td class="num">${kg(i.kg)}</td><td class="num">${i.volumes ?? ''}</td><td>${esc(i.embalagem || '')}</td><td class="num">${i.preco_kg == null ? '<span class="muted">sem preço</span>' : rkg(i.preco_kg)}</td>
        <td class="num">${i.valor == null ? '–' : money(i.valor)}</td><td class="num muted">${rkg(ck)}</td><td>${pode ? `<button class="btn ghost sm" data-del="${i.id}">✕</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="9" class="empty">Nenhum lote.</td></tr>'}</tbody></table></div>
    ${pode ? `<div class="toolbar" style="margin-top:6px"><label class="grow small">Lote (escolha ou leia a etiqueta)<input id="xp-lc" list="xp-ll" placeholder="código do lote"><datalist id="xp-ll"></datalist></label>
      <label class="small">kg<input id="xp-lk" inputmode="decimal" style="width:90px" placeholder="todo o saldo"></label><label class="small">Volumes<input id="xp-lv" type="number" min="0" style="width:70px"></label>
      <label class="small">Embalagem<input id="xp-le" list="xp-el" style="width:130px"><datalist id="xp-el">${EMBALAGENS.map(t => `<option value="${t}">`).join('')}</datalist></label>
      <label class="small">R$/kg<input id="xp-lp" inputmode="decimal" style="width:90px"></label><button class="btn" id="xp-la">+ Lote</button></div>` : ''}
    <div id="xp-res" style="margin-top:12px"></div>`,
    foot: `${x.situacao !== 'cancelada' && (pode || (x.situacao === 'expedida' && podeConfig())) ? '<button class="btn danger" id="xp-can">Cancelar a expedição</button>' : ''}<span class="spacer"></span>
      <button class="btn" id="xp-rom" ${IT.length ? '' : 'disabled'}>Romaneio</button>${pode ? '<button class="btn" id="xp-sv">Salvar</button><button class="btn primary" id="xp-ok">Expedir</button>' : '<button class="btn" data-close>Fechar</button>'}` });
  const el = md.el, S = resumoExpedicao(IT);
  $('#xp-res', el).innerHTML = `<div class="kpis">${kpi('Peso', kg(S.kg), `${S.lotes} lote(s) · ${S.volumes} volume(s)`)}${kpi('Valor', money(S.valor), S.semPreco ? `${S.semPreco} lote(s) sem preço` : S.kg ? `${rkg(S.valor / S.kg)} por kg` : '', S.semPreco ? 'warn' : '')}
    ${kpi('Custo dos lotes', money(S.custo), S.kg ? `${rkg(S.custo / S.kg)} por kg` : '')}${kpi('Margem', S.semPreco === S.lotes ? '–' : money(S.margem), S.valor ? `${(S.margem / S.valor * 100).toFixed(1).replace('.', ',')}% da venda` : '', S.margem >= 0 ? 'pos' : 'neg')}</div>
    ${aberta && S.indisponiveis ? `<p class="small neg">${S.indisponiveis} lote(s) não está(ão) disponível(is): libere pela Qualidade do Grão ou tire da expedição.</p>` : ''}
    ${aberta ? `<p class="small muted">Expedir dá a saída de venda em cada lote${R.cfg.plano_venda_id ? ` e gera o título a receber${+R.cfg.prazo_recebimento_dias ? ` para ${R.cfg.prazo_recebimento_dias} dia(s)` : ''}` : '. Sem a conta da venda nos parâmetros, não gera título a receber'}.</p>` : ''}`;
  $('#xp-rom', el).onclick = () => romaneio(R, x, IT, S);
  $('#xp-can', el) && ($('#xp-can', el).onclick = () => { const m2 = modal({ title: 'Cancelar a expedição', narrow: true, body: `<p class="small">${x.situacao === 'expedida' ? 'Os kg voltam aos lotes e o título a receber em aberto é excluído.' : 'A expedição aberta é cancelada; os lotes não foram baixados.'}</p><label>Motivo<input id="xc-m"></label>`,
      foot: '<button class="btn" data-close>Voltar</button><button class="btn danger" id="xc-ok">Cancelar a expedição</button>' });
    $('#xc-ok', m2.el).onclick = async () => { try { await q(sb.rpc('rec_expedicao_cancelar', { p_expedicao: x.id, p_motivo: $('#xc-m', m2.el).value })); m2.close(); md.close(); toast('Expedição cancelada'); render(root); } catch (err) { fail(err); } }; });
  if (!pode) return;
  const cliente = () => { const n = $('#xp-c', el).value.trim().toLowerCase(); return n ? clientes.find(f => f.nome.toLowerCase() === n) || null : null; };
  const salvar = async () => { const n = $('#xp-c', el).value.trim(), c = cliente();
    if (n && !c) throw new Error('Cliente não encontrado. Cadastre em Cadastros › Favorecidos ou escolha um da lista.');
    await q(sb.from('rec_expedicoes').update({ data: $('#xp-d', el).value || x.data, cliente_id: c?.id || null, nf_numero: $('#xp-nf', el).value.trim() || null, transportador: $('#xp-t', el).value.trim() || null,
      placa: $('#xp-p', el).value.trim() || null, motorista: $('#xp-m', el).value.trim() || null, observacao: $('#xp-o', el).value.trim() || null }).eq('id', x.id)); };
  const reabrir = () => { md.close(); abrir(R, id, root); };
  q(sb.from('rec_lotes').select('id, codigo, tipo, material_id, saldo_kg').eq('empresa_id', e).eq('situacao', 'disponivel').gt('saldo_kg', 0).order('data').limit(1500))
    .then(Ls => { const fora = new Set(IT.map(i => i.lote_id)); el._lotes = Ls.filter(l => !fora.has(l.id));
      $('#xp-ll', el).innerHTML = [...el._lotes].sort((a, b) => (b.tipo === 'grao') - (a.tipo === 'grao')).map(l => `<option value="${esc(l.codigo)}">${esc(nomeMat(R, l.material_id))} · saldo ${n3(l.saldo_kg)} kg</option>`).join(''); }).catch(() => {});
  $('#xp-la', el).onclick = async () => {
    const cod = $('#xp-lc', el).value.trim().toLowerCase(), l = (el._lotes || []).find(z => z.codigo.toLowerCase() === cod);
    if (!l) return toast('Lote não encontrado entre os disponíveis (lote bloqueado pela qualidade não embarca)', true);
    const k = $('#xp-lk', el).value.trim() ? parseNum($('#xp-lk', el).value) : +l.saldo_kg, p = $('#xp-lp', el).value.trim() ? parseNum($('#xp-lp', el).value) : null, v = $('#xp-lv', el).value.trim() ? +$('#xp-lv', el).value : null;
    if (!(k > 0) || k > +l.saldo_kg + 0.0005) return toast(`O lote ${l.codigo} tem ${n3(l.saldo_kg)} kg de saldo`, true);
    if (p != null && !(p >= 0)) return toast('Preço inválido', true);
    try { await salvar(); await q(sb.from('rec_expedicao_itens').insert({ empresa_id: e, expedicao_id: x.id, lote_id: l.id, kg: k, volumes: v, embalagem: $('#xp-le', el).value.trim() || null, preco_kg: p })); reabrir(); } catch (err) { fail(err); } };
  $$('[data-del]', el).forEach(b => b.onclick = async () => { try { await salvar(); await q(sb.from('rec_expedicao_itens').delete().eq('id', b.dataset.del)); reabrir(); } catch (err) { fail(err); } });
  $('#xp-sv', el).onclick = async () => { try { await salvar(); md.close(); toast('Expedição salva'); render(root); } catch (err) { fail(err); } };
  $('#xp-ok', el).onclick = async () => {
    if (!IT.length) return toast('Inclua ao menos um lote', true);
    if (!cliente()) return toast('Informe o cliente', true);
    if (!await confirmDialog(`Expedir ${kg(S.kg)} em ${S.lotes} lote(s)? Os lotes são baixados como venda${S.semPreco ? `. ${S.semPreco} lote(s) está(ão) sem preço e fica(m) fora do título a receber` : ''}.`)) return;
    try { await salvar(); const r = await q(sb.rpc('rec_expedicao_expedir', { p_expedicao: x.id }));
      md.close(); toast(`Expedição ${r.numero}: ${kg(r.kg)} · ${money(r.valor)}${r.lancamento_id ? ' · título a receber gerado' : ''}`); render(root); } catch (err) { fail(err); } };
}

function romaneio(R, x, IT, S) {
  const w = window.open('', '_blank'); if (!w) return toast('Libere as janelas pop-up para imprimir o romaneio', true);
  const c = R.fornById[x.cliente_id];
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Romaneio ${x.numero}</title><style>@page{size:A4;margin:14mm} body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:0}
    h1{font-size:18px;margin:0} h2{font-size:13px;margin:16px 0 6px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #999;padding:5px 6px;text-align:left} th{background:#eee} .n{text-align:right}
    .cab{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:6px} .g{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-top:10px} .as{display:grid;grid-template-columns:1fr 1fr 1fr;gap:28px;margin-top:46px;text-align:center} .as div{border-top:1px solid #111;padding-top:4px}</style></head><body>
    <div class="cab"><div><h1>${esc(state.empresa.nome || '')}</h1>Romaneio de expedição — material reciclado</div><div style="text-align:right"><b>Nº ${x.numero}</b><br>${dateBR(x.data)}${x.situacao !== 'expedida' ? '<br><b>' + (x.situacao === 'aberta' ? 'PRÉVIA — ainda não expedido' : 'CANCELADO') + '</b>' : ''}</div></div>
    <div class="g"><div><b>Cliente:</b> ${esc(c?.nome || '—')}${c?.documento ? ' · ' + esc(c.documento) : ''}</div><div><b>Nota fiscal:</b> ${esc(x.nf_numero || '—')}</div>
      <div><b>Transportador:</b> ${esc(x.transportador || '—')}</div><div><b>Placa:</b> ${esc(x.placa || '—')} &nbsp; <b>Motorista:</b> ${esc(x.motorista || '—')}</div></div>
    <h2>Lotes</h2><table><thead><tr><th>Lote</th><th>Material</th><th class="n">Peso (kg)</th><th class="n">Volumes</th><th>Embalagem</th><th style="width:70px">Conferido</th></tr></thead><tbody>
      ${IT.map(i => `<tr><td><b>${esc(i.lote?.codigo || '')}</b></td><td>${esc(nomeMat(R, i.lote?.material_id))}</td><td class="n">${n3(i.kg)}</td><td class="n">${i.volumes ?? ''}</td><td>${esc(i.embalagem || '')}</td><td></td></tr>`).join('')}
      <tr><th colspan="2">Total</th><th class="n">${n3(S.kg)}</th><th class="n">${S.volumes || ''}</th><th colspan="2"></th></tr></tbody></table>
    ${x.observacao ? `<p><b>Observação:</b> ${esc(x.observacao)}</p>` : ''}
    <div class="as"><div>Expedição</div><div>Motorista</div><div>Recebido pelo cliente (nome, data)</div></div>
    <script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}
