// Recuperadora › Entradas e Balança (REC002): ticket de pesagem (bruto, tara, materiais, classe, desconto, preço), leitura da balança,
// fotos, fechamento (lotes, título a pagar, abatimento do adiantamento), comprovante, importação da planilha da balança;
// fornecedores de reciclável e adiantamentos; relação para a nota de entrada das compras sem nota.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, money, dateBR, today, toast, fail, modal, parseNum, exportXLSX, confirmDialog } from '../lib/ui.js';
import { carregarRec, podeOperar, podeConfig, kpi, kg, kg0, rkg, badgeTicket, semSQL, avisoSQL, desligada, avisoDesligada, nomeMat, optMats, optClas } from '../lib/rec-ui.js';
import { calcTicket, precoVigente, abatimento, saldosAdiant, ORIGENS, TIPOS_FORN, COLETOR_SUGERIDO, placa } from '../lib/recuperadora.js';
import { temBalanca, lerBalanca } from '../lib/balanca.js';
import { lerPlanilha, mapearColunas } from '../lib/importador.js';

export const title = 'Entradas e Balança';
const mesIni = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10); };
const ui = { aba: 'tickets', de: mesIni(), ate: today(), sit: 'todos', busca: '' };
const n3 = (v) => v == null || v === '' ? '' : String(+v).replace('.', ',');
const hora = (s) => new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const localDT = (s) => { const d = s ? new Date(s) : new Date(); const p = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

export async function render(root) {
  root.innerHTML = `<div class="card toolbar"><div class="chips" id="re-abas">${[['tickets', 'Tickets da balança'], ['fornecedores', 'Fornecedores e adiantamentos'], ['relacao', 'Relação para a nota de entrada']]
      .map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div><span class="spacer"></span><span id="re-acoes"></span></div>
    <div id="re-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#re-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  const c = $('#re-corpo', root);
  try {
    const R = await carregarRec();
    if (desligada(R)) { c.innerHTML = avisoDesligada(); return; }
    if (ui.aba === 'tickets') await tickets(c, R, root); else if (ui.aba === 'fornecedores') await fornecedores(c, R, root); else await relacao(c, R, root);
  } catch (err) { c.innerHTML = semSQL(err) ? avisoSQL : `<div class="card"><div class="empty">${esc(err.message)}</div></div>`; }
}

// ------------------------------------------------------------------ tickets
async function tickets(c, R, root) {
  const e = state.empresa.id, compra = R.cfg.modo !== 'interno';
  const T = await q(sb.from('rec_tickets').select('*, itens:rec_ticket_itens(*)').eq('empresa_id', e)
    .gte('data_hora', ui.de + 'T00:00:00-03:00').lte('data_hora', ui.ate + 'T23:59:59-03:00').order('data_hora', { ascending: false }).limit(1000));
  const abertos = await q(sb.from('rec_tickets').select('id').eq('empresa_id', e).eq('situacao', 'aberto'));
  const L = T.filter(t => ui.sit === 'todos' || t.situacao === ui.sit).filter(t => !ui.busca || `${t.numero} ${R.fornById[t.fornecedor_id]?.nome || ''} ${t.placa || ''} ${t.motorista || ''}`.toLowerCase().includes(ui.busca));
  const F = T.filter(t => t.situacao === 'fechado'), soma = (a, f) => a.reduce((s, x) => s + (+f(x) || 0), 0);
  const itensF = F.flatMap(t => t.itens.map(i => ({ ...i, origem: t.origem })));
  $('#re-acoes', root).innerHTML = podeOperar() ? `<button class="btn" id="re-imp">Importar planilha da balança</button> <button class="btn primary" id="re-novo">+ Novo ticket</button>` : '';
  c.innerHTML = `<div class="kpis">${kpi('Entrou (fechados)', kg0(soma(itensF, i => i.peso_kg)), `${F.length} ticket(s) no período`)}
      ${compra ? kpi('Peso pago', kg0(soma(itensF.filter(i => i.origem === 'compra'), i => i.peso_pago)), `desconto médio ${(() => { const b = soma(itensF.filter(i => i.origem === 'compra'), i => i.peso_kg); return b ? ((1 - soma(itensF.filter(i => i.origem === 'compra'), i => i.peso_pago) / b) * 100).toFixed(1).replace('.', ',') + '%' : '–'; })()}`) : ''}
      ${compra ? kpi('Valor das compras', money(soma(F, t => t.total)), `abatido de adiantamentos ${money(soma(F, t => t.abatido))}`) : ''}
      ${kpi('Tickets abertos', (abertos || []).length, 'aguardando fechamento', (abertos || []).length ? 'warn' : '')}</div>
    <div class="card toolbar" style="margin-top:12px"><label class="small">De <input type="date" id="re-de" value="${ui.de}"></label><label class="small">Até <input type="date" id="re-ate" value="${ui.ate}"></label>
      <div class="chips" id="re-sit">${[['todos', 'Todos'], ['aberto', 'Abertos'], ['fechado', 'Fechados'], ['cancelado', 'Cancelados']].map(([k, t]) => `<span class="chip ${ui.sit === k ? 'on' : ''}" data-s="${k}">${t}</span>`).join('')}</div>
      <label class="grow small">Buscar<input id="re-bus" value="${esc(ui.busca)}" placeholder="nº, fornecedor, placa ou motorista"></label><button class="btn" id="re-xls">Excel</button></div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap" style="max-height:62vh" id="re-tab"><table><thead><tr><th>Nº</th><th>Data e hora</th><th>Origem / fornecedor</th><th>Placa</th><th>Materiais</th>
      <th class="num">Líquido</th><th class="num">Pago</th><th class="num">Total</th><th>Situação</th></tr></thead><tbody>
      ${L.map(t => `<tr class="clickable" data-id="${t.id}"><td><b>${t.numero}</b></td><td>${hora(t.data_hora)}</td>
        <td>${t.fornecedor_id ? esc(R.fornById[t.fornecedor_id]?.nome || '') : `<span class="muted">${ORIGENS[t.origem]}</span>`}${t.origem !== 'compra' && t.fornecedor_id ? ` <span class="badge">${ORIGENS[t.origem]}</span>` : ''}
          ${t.situacao === 'fechado' && t.origem === 'compra' && !t.nf_numero ? ' <span class="badge negoc" title="Compra sem nota: entra na relação para a nota de entrada">sem nota</span>' : ''}</td>
        <td>${esc(t.placa || '')}</td><td class="small">${t.itens.map(i => esc(R.matById[i.material_id]?.codigo || '?')).join(', ') || '<span class="muted">—</span>'}</td>
        <td class="num">${t.peso_liquido != null ? kg0(t.peso_liquido) : '–'}</td><td class="num">${t.situacao === 'fechado' ? kg0(soma(t.itens, i => i.peso_pago)) : '–'}</td>
        <td class="num">${t.total != null ? money(t.total) : '–'}</td><td>${badgeTicket(t.situacao)}</td></tr>`).join('')
        || '<tr><td colspan="9" class="empty">Nenhum ticket no período.</td></tr>'}</tbody></table></div></div>`;
  $('#re-de', c).onchange = (ev) => { ui.de = ev.target.value || mesIni(); render(root); };
  $('#re-ate', c).onchange = (ev) => { ui.ate = ev.target.value || today(); render(root); };
  $('#re-sit', c).onclick = (ev) => { const s = ev.target.closest('[data-s]')?.dataset.s; if (s) { ui.sit = s; render(root); } };
  let tm; $('#re-bus', c).oninput = (ev) => { clearTimeout(tm); tm = setTimeout(() => { ui.busca = ev.target.value.toLowerCase().trim(); render(root); }, 350); };
  $('#re-xls', c).onclick = () => exportXLSX($('#re-tab table', c), `tickets_recuperadora_${ui.de}_${ui.ate}`);
  c.querySelector('tbody').onclick = (ev) => { const id = ev.target.closest('tr[data-id]')?.dataset.id; if (id) abrirTicket(R, T.find(t => t.id === id), root); };
  $('#re-novo', root) && ($('#re-novo', root).onclick = () => abrirTicket(R, null, root));
  $('#re-imp', root) && ($('#re-imp', root).onclick = () => importar(R, root));
}

async function abrirTicket(R, t0, root) {
  const e = state.empresa.id, aberto = !t0 || t0.situacao === 'aberto', pode = podeOperar() && aberto, dis = pode ? '' : 'disabled';
  const modoInterno = R.cfg.modo === 'interno';
  const t = t0 ? { ...t0 } : { origem: modoInterno ? 'transferencia' : 'compra', data_hora: new Date().toISOString(), fotos: [], frete_valor: 0 };
  let itens = (t0?.itens || []).map(i => ({ ...i }));
  if (!itens.length && pode) itens.push({ material_id: R.mats.find(m => m.ativo)?.id, classe_id: null, peso_kg: '' });
  const adiant = t.fornecedor_id ? saldosAdiant(await q(sb.from('rec_adiantamentos').select('*').eq('empresa_id', e).eq('fornecedor_id', t.fornecedor_id).eq('situacao', 'aberto')),
    await q(sb.from('rec_adiant_abatimentos').select('*').eq('empresa_id', e))) : [];
  const forns = R.forn.filter(f => f.ativo || f.id === t.fornecedor_id).sort((a, b) => (!!b.rec_tipo - !!a.rec_tipo) || a.nome.localeCompare(b.nome));
  const md = modal({ title: t0 ? `Ticket ${t0.numero}` : 'Novo ticket de pesagem', wide: true, body: `
    <div class="grid-form">
      <label class="c4">Data e hora<input type="datetime-local" id="tk-dh" value="${localDT(t.data_hora)}" ${dis}></label>
      <label class="c4">Origem<select id="tk-or" ${dis}>${Object.entries(ORIGENS).filter(([k]) => !modoInterno || k !== 'compra').map(([k, x]) => `<option value="${k}" ${t.origem === k ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="span2">Fornecedor${t.origem === 'compra' ? ' *' : ''}<select id="tk-fo" ${dis}><option value="">—</option>${forns.map(f => `<option value="${f.id}" ${f.id === t.fornecedor_id ? 'selected' : ''}>${esc(f.nome)}${f.rec_tipo ? ' · ' + esc(TIPOS_FORN[f.rec_tipo]) : ''}</option>`).join('')}</select></label>
      <label class="c4">Placa<input id="tk-pl" value="${esc(t.placa || '')}" maxlength="8" ${dis}></label>
      <label class="c4">Motorista<input id="tk-mo" value="${esc(t.motorista || '')}" ${dis}></label>
      <label class="c4">Peso bruto (kg)<span style="display:flex;gap:4px"><input id="tk-br" inputmode="decimal" value="${n3(t.peso_bruto)}" ${dis}>${pode && temBalanca() ? '<button type="button" class="btn sm" data-bal="tk-br" title="Ler a balança">⚖</button>' : ''}</span></label>
      <label class="c4">Tara (kg)<span style="display:flex;gap:4px"><input id="tk-ta" inputmode="decimal" value="${n3(t.tara)}" ${dis}>${pode && temBalanca() ? '<button type="button" class="btn sm" data-bal="tk-ta" title="Ler a balança">⚖</button>' : ''}</span></label>
      <label class="c4">Peso líquido (kg)<input id="tk-li" inputmode="decimal" value="${n3(t.peso_liquido)}" ${dis} placeholder="bruto − tara"></label>
      <label class="c4">Frete pago à parte (R$)<input id="tk-fr" inputmode="decimal" value="${t.frete_valor ? money(t.frete_valor) : ''}" ${dis} placeholder="entra no custo do lote"></label>
    </div>
    <h3 style="margin:14px 0 6px">Materiais</h3>
    <div class="table-wrap"><table class="small"><thead><tr><th>Material</th><th>Classe</th><th class="num">Peso (kg)</th><th class="num">Desconto %</th><th class="num">R$/kg</th><th class="num">Peso pago</th><th class="num">Valor</th><th></th></tr></thead><tbody id="tk-it"></tbody></table></div>
    ${pode ? '<button type="button" class="btn sm" id="tk-add" style="margin-top:6px">+ Material</button>' : ''}
    <div id="tk-res" style="margin-top:10px"></div>
    <div class="grid-form" style="margin-top:10px">
      <label class="c4">NF do fornecedor (número)<input id="tk-nf" value="${esc(t.nf_numero || '')}" ${t0?.situacao === 'cancelado' ? 'disabled' : ''}></label>
      <label class="span2">Chave da NF-e<input id="tk-ch" value="${esc(t.nf_chave || '')}" maxlength="54" ${t0?.situacao === 'cancelado' ? 'disabled' : ''}></label>
      <label class="span2">Observação<input id="tk-ob" value="${esc(t.observacao || '')}" ${dis}></label>
    </div>
    <div style="margin-top:10px"><b class="small">Fotos da carga</b> <span id="tk-fotos" class="small"></span> ${podeOperar() && t0?.situacao !== 'cancelado' ? '<label class="btn sm" style="margin-left:6px">+ Foto<input type="file" id="tk-ft" accept="image/*" capture="environment" multiple hidden></label>' : ''}</div>
    ${t0?.situacao === 'cancelado' ? `<p class="small neg">Cancelado: ${esc(t0.cancelado_motivo || '')}</p>` : ''}
    ${t0?.situacao === 'fechado' && t0.lancamento_id ? '<p class="small muted">O título a pagar deste ticket está nos Lançamentos (documento "REC ' + t0.numero + '").</p>' : ''}`,
    foot: `${t0 && t0.situacao !== 'cancelado' && (aberto ? podeOperar() : podeConfig()) ? '<button class="btn danger" id="tk-can">Cancelar ticket</button>' : ''}
      ${t0 && aberto && podeOperar() ? '<button class="btn ghost" id="tk-exc">Excluir</button>' : ''}<span class="spacer"></span>
      ${t0?.situacao === 'fechado' ? '<button class="btn" id="tk-pr">Comprovante</button>' : ''}
      ${t0?.situacao === 'fechado' && podeOperar() ? '<button class="btn primary" id="tk-nfok">Salvar a nota</button>' : ''}
      ${pode ? '<button class="btn" id="tk-sv">Salvar aberto</button><button class="btn primary" id="tk-fe">Fechar ticket</button>' : '<button class="btn" data-close>Fechar</button>'}` });
  const el = md.el, data = () => ($('#tk-dh', el).value || localDT()).slice(0, 10);
  const tk = () => ({ origem: $('#tk-or', el).value, peso_bruto: parseNum($('#tk-br', el).value), tara: parseNum($('#tk-ta', el).value), peso_liquido: parseNum($('#tk-li', el).value), frete_valor: parseNum($('#tk-fr', el).value) || 0 });
  const lerItens = () => { if (!pode) return; $$('#tk-it tr', el).forEach((tr, k) => { const i = itens[k]; if (!i) return;
    i.material_id = $('.it-m', tr).value; i.classe_id = $('.it-c', tr).value || null; i.peso_kg = parseNum($('.it-p', tr).value); const d = $('.it-d', tr).value.trim(), p = $('.it-v', tr).value.trim();
    i.desconto_pct = d === '' ? null : parseNum(d); i.preco_kg = p === '' ? null : parseNum(p); }); };
  const enriquecer = () => itens.map(i => ({ ...i, desconto_padrao: R.claById[i.classe_id]?.desconto_padrao_pct ?? 0, preco_tabela: precoVigente(R.precos, i.material_id, i.classe_id || null, data()) }));
  const desenharItens = () => {
    const C = calcTicket(tk(), enriquecer(), { tolerancia: +R.cfg.tolerancia_kg || 0 });
    $('#tk-it', el).innerHTML = itens.map((i, k) => { const x = C.itens[k], en = enriquecer()[k];
      return pode ? `<tr><td><select class="it-m">${optMats(R, i.material_id)}</select></td><td><select class="it-c">${optClas(R, i.classe_id)}</select></td>
        <td class="num"><input class="it-p" inputmode="decimal" style="width:90px" value="${n3(i.peso_kg)}"></td>
        <td class="num"><input class="it-d" inputmode="decimal" style="width:70px" value="${i.desconto_pct == null ? '' : n3(i.desconto_pct)}" placeholder="${n3(en.desconto_padrao)}"></td>
        <td class="num"><input class="it-v" inputmode="decimal" style="width:80px" value="${i.preco_kg == null ? '' : n3(i.preco_kg)}" placeholder="${en.preco_tabela == null ? 'sem preço' : n3(en.preco_tabela)}"></td>
        <td class="num">${kg(x.pago)}</td><td class="num">${x.semPreco ? '<span class="warn">sem preço</span>' : money(x.valor)}</td><td><button type="button" class="btn ghost sm" data-rm="${k}">✕</button></td></tr>`
        : `<tr><td>${esc(nomeMat(R, i.material_id))}</td><td>${esc(R.claById[i.classe_id]?.codigo || '—')}</td><td class="num">${kg(i.peso_kg)}</td><td class="num">${n3(i.desconto_pct ?? 0)}%</td>
        <td class="num">${rkg(i.preco_kg)}</td><td class="num">${kg(i.peso_pago ?? x.pago)}</td><td class="num">${money(i.valor ?? x.valor)}</td><td></td></tr>`; }).join('') || '<tr><td colspan="8" class="empty">Nenhum material.</td></tr>';
    const ab = abatimento(C.total, adiant), compra = tk().origem === 'compra';
    $('#tk-res', el).innerHTML = `<div class="kpis">${kpi('Peso líquido', kg(C.liquido))}${kpi('Soma dos materiais', kg(C.soma), C.dentro ? 'confere' : `diferença ${kg(C.diferenca)} (tolerância ${kg(R.cfg.tolerancia_kg)})`, C.dentro ? 'pos' : 'neg')}
      ${compra ? kpi('Peso pago', kg(C.pagoKg), `desconto médio ${(C.descontoMedio * 100).toFixed(1).replace('.', ',')}%`) + kpi('Total da compra', money(C.total), C.itens.some(x => x.semPreco) ? 'há material sem preço na tabela' : '', C.itens.some(x => x.semPreco) ? 'warn' : '')
        + (aberto && adiant.length ? kpi('Adiantamento a abater', money(ab.abatido), `a pagar ${money(ab.aPagar)}`) : '') + (!aberto ? kpi('A pagar', money((+t0.total || 0) - (+t0.abatido || 0)), +t0.abatido ? `abatido ${money(t0.abatido)}` : '') : '') : ''}</div>`;
    $$('[data-rm]', el).forEach(b => b.onclick = () => { lerItens(); itens.splice(+b.dataset.rm, 1); desenharItens(); });
  };
  const fotos = () => { $('#tk-fotos', el).innerHTML = (t.fotos || []).length ? t.fotos.map((f, k) => `<a href="#" data-ft="${k}">foto ${k + 1}</a>`).join(' · ') : '<span class="muted">nenhuma</span>';
    $$('[data-ft]', el).forEach(a => a.onclick = async (ev) => { ev.preventDefault(); try { const { data: d, error } = await sb.storage.from('recuperadora').createSignedUrl(t.fotos[+a.dataset.ft].path, 300); if (error) throw error; window.open(d.signedUrl, '_blank', 'noopener'); } catch (err) { fail(err); } }); };
  fotos(); desenharItens();
  if (pode) {
    $('#tk-it', el).addEventListener('change', () => { lerItens(); desenharItens(); });
    ['#tk-br', '#tk-ta', '#tk-li', '#tk-fr', '#tk-dh', '#tk-or'].forEach(s => $(s, el).addEventListener('change', () => { lerItens();
      const b = parseNum($('#tk-br', el).value), ta = parseNum($('#tk-ta', el).value); if (b != null && ta != null && !isNaN(b) && !isNaN(ta) && $('#tk-br', el).value && $('#tk-ta', el).value) $('#tk-li', el).value = n3(Math.round((b - ta) * 1000) / 1000); desenharItens(); }));
    $('#tk-add', el).onclick = () => { lerItens(); itens.push({ material_id: R.mats.find(m => m.ativo)?.id, classe_id: null, peso_kg: '' }); desenharItens(); };
    $$('[data-bal]', el).forEach(b => b.onclick = async () => { b.disabled = true; try { const p = await lerBalanca({ baud: +R.cfg.balanca_baud || 9600 }); $('#' + b.dataset.bal, el).value = n3(p); $('#' + b.dataset.bal, el).dispatchEvent(new Event('change')); toast(`Balança: ${n3(p)} kg`); } catch (err) { fail(err); } b.disabled = false; });
    $('#tk-fo', el).onchange = () => { const f = R.fornById[$('#tk-fo', el).value]; if (f && !f.rec_tipo) toast('Dica: classifique este fornecedor na aba Fornecedores e adiantamentos (catador, cooperativa, sucateiro…)'); };
  }
  const salvar = async () => {
    lerItens();
    const o = $('#tk-or', el).value, fo = $('#tk-fo', el).value || null;
    if (o === 'compra' && !fo) throw new Error('Informe o fornecedor da compra');
    const it = itens.filter(i => i.material_id && +i.peso_kg > 0);
    if (itens.some(i => !(+i.peso_kg > 0))) throw new Error('Informe o peso de cada material (ou retire a linha vazia)');
    const ch = $('#tk-ch', el).value.replace(/\D/g, ''); if (ch && ch.length !== 44) throw new Error('A chave da NF-e tem 44 dígitos');
    const b = parseNum($('#tk-br', el).value), ta = parseNum($('#tk-ta', el).value);
    if ($('#tk-br', el).value && $('#tk-ta', el).value && b < ta) throw new Error('A tara não pode passar do peso bruto');
    const v = { empresa_id: e, data_hora: new Date($('#tk-dh', el).value || localDT()).toISOString(), origem: o, fornecedor_id: fo, placa: placa($('#tk-pl', el).value) || null, motorista: $('#tk-mo', el).value.trim() || null,
      peso_bruto: $('#tk-br', el).value ? b : null, tara: $('#tk-ta', el).value ? ta : null, peso_liquido: $('#tk-br', el).value && $('#tk-ta', el).value ? null : ($('#tk-li', el).value ? parseNum($('#tk-li', el).value) : null),
      frete_valor: parseNum($('#tk-fr', el).value) || 0, nf_numero: $('#tk-nf', el).value.trim() || null, nf_chave: ch || null, observacao: $('#tk-ob', el).value.trim() || null, fotos: t.fotos || [] };
    let id = t.id;
    if (id) await q(sb.from('rec_tickets').update(v).eq('id', id)); else { const [n] = await q(sb.from('rec_tickets').insert(v).select('id, numero')); id = n.id; t.id = id; t.numero = n.numero; }
    await q(sb.from('rec_ticket_itens').delete().eq('ticket_id', id));
    if (it.length) await q(sb.from('rec_ticket_itens').insert(it.map(i => ({ empresa_id: e, ticket_id: id, material_id: i.material_id, classe_id: i.classe_id || null, peso_kg: +i.peso_kg,
      desconto_pct: i.desconto_pct == null || isNaN(i.desconto_pct) ? null : i.desconto_pct, preco_kg: i.preco_kg == null || isNaN(i.preco_kg) ? null : i.preco_kg }))));
    return id;
  };
  $('#tk-sv', el) && ($('#tk-sv', el).onclick = async (ev) => { ev.target.disabled = true; try { await salvar(); md.close(); toast('Ticket salvo aberto'); render(root); } catch (err) { ev.target.disabled = false; fail(err); } });
  $('#tk-fe', el) && ($('#tk-fe', el).onclick = async (ev) => {
    ev.target.disabled = true;
    try { const id = await salvar(); const r = await q(sb.rpc('rec_ticket_fechar', { p_ticket: id }));
      md.close(); toast(`Ticket fechado: ${r.lotes} lote(s)${r.a_pagar ? ` · a pagar ${money(r.a_pagar)}` : ''}${r.abatido ? ` · abatido ${money(r.abatido)}` : ''}${r.sem_preco ? ` · ${r.sem_preco} material(is) sem preço` : ''}`); render(root); }
    catch (err) { ev.target.disabled = false; fail(err); }
  });
  $('#tk-nfok', el) && ($('#tk-nfok', el).onclick = async () => { try { await q(sb.rpc('rec_ticket_nota', { p_ticket: t.id, p_numero: $('#tk-nf', el).value, p_chave: $('#tk-ch', el).value || null })); md.close(); toast('Nota salva'); render(root); } catch (err) { fail(err); } });
  $('#tk-exc', el) && ($('#tk-exc', el).onclick = async () => { if (!await confirmDialog(`Excluir o ticket ${t.numero}? Use "Cancelar" se quiser guardar o registro.`)) return; try { await q(sb.from('rec_tickets').delete().eq('id', t.id)); md.close(); toast('Ticket excluído'); render(root); } catch (err) { fail(err); } });
  $('#tk-can', el) && ($('#tk-can', el).onclick = () => {
    const m2 = modal({ title: `Cancelar o ticket ${t.numero}`, narrow: true, body: `<p class="small">${t0.situacao === 'fechado' ? 'Desfaz os lotes, o título a pagar em aberto, o abatimento do adiantamento e a entrada no Kardex. Só dá se os lotes não foram usados e o título não foi pago.' : 'O ticket fica guardado como cancelado.'}</p><label>Motivo<input id="cn-m"></label>`,
      foot: '<button class="btn" data-close>Voltar</button><button class="btn danger" id="cn-ok">Cancelar o ticket</button>' });
    $('#cn-ok', m2.el).onclick = async () => { try { await q(sb.rpc('rec_ticket_cancelar', { p_ticket: t.id, p_motivo: $('#cn-m', m2.el).value })); m2.close(); md.close(); toast('Ticket cancelado'); render(root); } catch (err) { fail(err); } };
  });
  $('#tk-pr', el) && ($('#tk-pr', el).onclick = () => comprovante(R, t0));
  $('#tk-ft', el) && ($('#tk-ft', el).onchange = async (ev) => {
    try {
      if (!t.id) { if (!pode) return; t.id = await salvar(); }
      for (const f of ev.target.files) { if (f.size > 8 * 1024 * 1024) { toast(`${f.name}: até 8 MB`, true); continue; }
        const path = `${e}/${t.id}/${Date.now()}-${f.name.replace(/[^\w.-]+/g, '_')}`;
        const { error } = await sb.storage.from('recuperadora').upload(path, f, { contentType: f.type || 'image/jpeg' }); if (error) throw error;
        t.fotos = [...(t.fotos || []), { path, nome: f.name, em: new Date().toISOString() }]; }
      if (aberto) await q(sb.from('rec_tickets').update({ fotos: t.fotos }).eq('id', t.id)); else toast('Ticket fechado: a foto ficou guardada, mas só entra na ficha enquanto o ticket está aberto', true);
      fotos(); toast('Foto anexada');
    } catch (err) { fail(err); }
  });
}

function comprovante(R, t) {
  const f = R.fornById[t.fornecedor_id], w = window.open('', '_blank'); if (!w) return toast('Libere as janelas pop-up para imprimir', true);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Ticket ${t.numero}</title><style>body{font-family:Arial,sans-serif;font-size:12px;margin:12mm;color:#111}
    h1{font-size:16px;margin:0} table{width:100%;border-collapse:collapse;margin-top:8px} th,td{border-bottom:1px solid #ccc;padding:4px;text-align:left} .n{text-align:right} .t{font-weight:bold} .ass{margin-top:28mm;display:flex;gap:20mm} .ass div{flex:1;border-top:1px solid #000;text-align:center;padding-top:2mm}</style></head><body>
    <h1>${esc(state.empresa.nome || '')} — Comprovante de pesagem nº ${t.numero}</h1>
    <p>${hora(t.data_hora)} · ${ORIGENS[t.origem]}${f ? ` · <b>${esc(f.nome)}</b> ${esc(f.documento || '')}` : ''}${t.placa ? ` · placa ${esc(t.placa)}` : ''}${t.motorista ? ` · motorista ${esc(t.motorista)}` : ''}</p>
    <p>Bruto ${t.peso_bruto != null ? kg(t.peso_bruto) : '–'} · Tara ${t.tara != null ? kg(t.tara) : '–'} · <b>Líquido ${kg(t.peso_liquido)}</b></p>
    <table><thead><tr><th>Material</th><th>Classe</th><th class="n">Peso</th><th class="n">Desconto</th><th class="n">Peso pago</th><th class="n">R$/kg</th><th class="n">Valor</th></tr></thead><tbody>
    ${t.itens.map(i => `<tr><td>${esc(nomeMat(R, i.material_id))}</td><td>${esc(R.claById[i.classe_id]?.codigo || '—')}</td><td class="n">${kg(i.peso_kg)}</td><td class="n">${n3(i.desconto_pct)}%</td><td class="n">${kg(i.peso_pago)}</td><td class="n">${rkg(i.preco_kg)}</td><td class="n">${money(i.valor)}</td></tr>`).join('')}
    <tr class="t"><td colspan="6">Total</td><td class="n">${money(t.total)}</td></tr>${+t.abatido ? `<tr><td colspan="6">Abatido de adiantamento</td><td class="n">− ${money(t.abatido)}</td></tr><tr class="t"><td colspan="6">A pagar</td><td class="n">${money(t.total - t.abatido)}</td></tr>` : ''}</tbody></table>
    <div class="ass"><div>Fornecedor</div><div>Balança / recebimento</div></div><script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

async function importar(R, root) {
  const md = modal({ title: 'Importar a planilha da balança', wide: true, body: `<p class="small">Excel ou CSV exportado pelo sistema da balança. Cada linha vira um ticket aberto (com o material, se a coluna existir); a mesma linha não entra duas vezes. Confira e feche os tickets na lista.</p>
      <input type="file" id="ib-f" accept=".xlsx,.xls,.csv,.txt"><div id="ib-m" style="margin-top:10px"></div><div id="ib-r"></div>`,
    foot: '<button class="btn" data-close>Fechar</button><button class="btn primary" id="ib-ok" disabled>Importar</button>' });
  let M = null;
  const campos = [{ k: 'data_hora', t: 'Data e hora', re: /data|hora/i, tipo: 'datahora' }, { k: 'chave', t: 'Nº do ticket na balança', re: /ticket|n[ºo°]|pesagem|c[oó]d/i },
    { k: 'placa', t: 'Placa', re: /placa/i }, { k: 'motorista', t: 'Motorista', re: /motorista/i }, { k: 'fornecedor', t: 'Fornecedor (CNPJ/CPF ou nome)', re: /fornec|cliente|cnpj|cpf|parceiro/i },
    { k: 'peso_bruto', t: 'Peso bruto', re: /bruto|entrada/i, tipo: 'numero' }, { k: 'tara', t: 'Tara', re: /tara|sa[ií]da/i, tipo: 'numero' }, { k: 'peso_liquido', t: 'Peso líquido', re: /l[ií]quido|liq/i, tipo: 'numero' },
    { k: 'material', t: 'Material (código ou nome)', re: /material|produto/i }, { k: 'classe', t: 'Classe', re: /classe|qualidade/i }, { k: 'observacao', t: 'Observação', re: /obs/i }];
  $('#ib-f', md.el).onchange = async (ev) => { try { const aoa = await lerPlanilha(ev.target.files[0]); M = mapearColunas($('#ib-m', md.el), aoa, campos); $('#ib-ok', md.el).disabled = false; } catch (err) { fail(err); } };
  $('#ib-ok', md.el).onclick = async (ev) => {
    const L = M.linhas().filter(l => l.peso_bruto != null || l.peso_liquido != null);
    if (!L.length) return toast('Nenhuma linha com peso', true);
    ev.target.disabled = true;
    try { const r = await q(sb.rpc('rec_tickets_importar', { p_empresa: state.empresa.id, p_linhas: L.map(l => ({ ...l, chave: l.chave ? 'bal:' + l.chave : null })) }));
      $('#ib-r', md.el).innerHTML = `<p><b>${r.criados}</b> ticket(s) criado(s) · ${r.repetidos} já importado(s)${r.erros.length ? ` · <span class="neg">${r.erros.length} com erro</span>` : ''}</p>
        ${r.erros.length ? `<div class="table-wrap" style="max-height:30vh"><table class="small"><tbody>${r.erros.map(x => `<tr><td>linha ${x.linha}</td><td>${esc(x.erro)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
      if (r.criados) render(root);
    } catch (err) { ev.target.disabled = false; fail(err); }
  };
}

// ------------------------------------------------------------------ fornecedores e adiantamentos
async function fornecedores(c, R, root) {
  const e = state.empresa.id, desde = new Date(Date.now() - 90 * 864e5).toISOString();
  const [A, B, T] = await Promise.all([q(sb.from('rec_adiantamentos').select('*').eq('empresa_id', e).order('data', { ascending: false })), q(sb.from('rec_adiant_abatimentos').select('*').eq('empresa_id', e)),
    q(sb.from('rec_tickets').select('fornecedor_id, total, itens:rec_ticket_itens(peso_kg, peso_pago)').eq('empresa_id', e).eq('situacao', 'fechado').gte('data_hora', desde))]);
  const S = saldosAdiant(A, B), saldo = new Map(), comp = new Map();
  for (const a of S) if (a.situacao === 'aberto') saldo.set(a.fornecedor_id, (saldo.get(a.fornecedor_id) || 0) + a.saldo);
  for (const t of T) { const x = comp.get(t.fornecedor_id) || { kg: 0, valor: 0, n: 0 }; x.kg += t.itens.reduce((s, i) => s + +i.peso_kg, 0); x.valor += +t.total || 0; x.n++; comp.set(t.fornecedor_id, x); }
  const F = R.forn.filter(f => f.rec_tipo || saldo.has(f.id) || comp.has(f.id));
  $('#re-acoes', root).innerHTML = (podeConfig() ? '<button class="btn" id="rf-cl">Classificar fornecedor</button> <button class="btn primary" id="rf-ad">+ Adiantamento</button>' : '');
  c.innerHTML = `<div class="kpis">${kpi('Fornecedores de reciclável', F.length, `${F.filter(f => f.rec_coletor_incentivado).length} coletor(es) incentivado(s)`)}${kpi('Adiantamentos em aberto', money([...saldo.values()].reduce((s, v) => s + v, 0)), `${saldo.size} fornecedor(es)`)}</div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap" style="max-height:45vh"><table><thead><tr><th>Fornecedor</th><th>Tipo</th><th>Coletor incentivado</th><th class="num">Comprado (90 dias)</th><th class="num">Valor (90 dias)</th><th class="num">Adiantamento em aberto</th></tr></thead><tbody>
      ${F.map(f => `<tr class="${podeConfig() ? 'clickable' : ''}" data-f="${f.id}"><td><b>${esc(f.nome)}</b><div class="small muted">${esc(f.documento || '')}${f.pix ? ' · PIX ' + esc(f.pix) : ''}</div></td><td>${esc(TIPOS_FORN[f.rec_tipo] || '—')}</td>
        <td>${f.rec_coletor_incentivado ? '<span class="badge pago">sim</span>' : '<span class="muted">não</span>'}</td>
        <td class="num">${comp.has(f.id) ? kg0(comp.get(f.id).kg) : '–'}</td><td class="num">${comp.has(f.id) ? money(comp.get(f.id).valor) : '–'}</td><td class="num">${saldo.get(f.id) ? money(saldo.get(f.id)) : '–'}</td></tr>`).join('')
        || '<tr><td colspan="6" class="empty">Nenhum fornecedor classificado. Use "Classificar fornecedor" para marcar catadores, cooperativas e sucateiros.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Coletor incentivado (LC 214/2025, art. 170): pessoa física que coleta ou faz a triagem de resíduos e associação ou cooperativa de catadores. A compra deles gera crédito presumido de IBS e CBS no regime regular; a marca alimenta a apuração na parte 3 da Recuperadora.</p>
    <h3 style="margin:16px 0 6px">Adiantamentos</h3>
    <div class="card flush"><div class="table-wrap" style="max-height:40vh"><table><thead><tr><th>Data</th><th>Fornecedor</th><th class="num">Valor</th><th class="num">Abatido</th><th class="num">Saldo</th><th>Situação</th><th>Observação</th><th></th></tr></thead><tbody>
      ${S.map(a => `<tr><td>${dateBR(a.data)}</td><td>${esc(R.fornById[a.fornecedor_id]?.nome || '')}</td><td class="num">${money(a.valor)}</td><td class="num">${money(a.abatido)}</td><td class="num"><b>${money(a.saldo)}</b></td>
        <td><span class="badge ${a.situacao === 'aberto' ? 'aberto' : a.situacao === 'quitado' ? 'pago' : 'vencido'}">${a.situacao}</span></td><td class="small">${esc(a.observacao || '')}</td>
        <td>${podeConfig() && a.situacao === 'aberto' && !a.abatido ? `<button class="btn ghost sm" data-ca="${a.id}">Cancelar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Nenhum adiantamento.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">O adiantamento gera o título a pagar na conta dos parâmetros; ao fechar o ticket do fornecedor, o saldo abate a compra (os mais antigos primeiro).</p>`;
  const classificar = (f = null) => {
    const md = modal({ title: 'Fornecedor de reciclável', body: `<form id="cf" class="grid2"><label class="span2">Beneficiário<select name="f" ${f ? 'disabled' : ''}>${R.forn.filter(x => x.ativo || x.id === f?.id).map(x => `<option value="${x.id}" ${x.id === f?.id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select>
        <span class="small muted">Não está na lista? Cadastre em Cadastros › Beneficiários (com CPF ou CNPJ).</span></label>
        <label>Tipo<select name="t"><option value="">— não é fornecedor de reciclável —</option>${Object.entries(TIPOS_FORN).map(([k, x]) => `<option value="${k}" ${f?.rec_tipo === k ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" name="ci" ${f?.rec_coletor_incentivado ? 'checked' : ''}> Coletor incentivado (art. 170 da LC 214/2025)</label>
        <label class="span2">Chave PIX<input name="pix" value="${esc(f?.pix || '')}"></label></form>`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="cf-ok">Salvar</button>' });
    const fm = $('#cf', md.el);
    fm.t.onchange = () => { fm.ci.checked = COLETOR_SUGERIDO(fm.t.value); };
    $('#cf-ok', md.el).onclick = async () => { const id = f?.id || fm.f.value;
      try { await q(sb.from('favorecidos').update({ rec_tipo: fm.t.value || null, rec_coletor_incentivado: !!fm.t.value && fm.ci.checked, pix: fm.pix.value.trim() || null }).eq('id', id));
        md.close(); toast('Fornecedor salvo'); await carregarRec(true); render(root); } catch (err) { fail(err); } };
  };
  $('#rf-cl', root) && ($('#rf-cl', root).onclick = () => classificar());
  c.querySelector('tbody').onclick = (ev) => { const id = ev.target.closest('tr[data-f]')?.dataset.f; if (id && podeConfig()) classificar(R.fornById[id]); };
  $('#rf-ad', root) && ($('#rf-ad', root).onclick = () => {
    const md = modal({ title: 'Adiantamento a fornecedor', body: `<form id="af" class="grid2"><label class="span2">Fornecedor *<select name="f">${R.forn.filter(x => x.ativo).sort((a, b) => (!!b.rec_tipo - !!a.rec_tipo) || a.nome.localeCompare(b.nome)).map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('')}</select></label>
        <label>Data<input type="date" name="d" value="${today()}"></label><label>Valor (R$) *<input name="v" inputmode="decimal"></label><label class="span2">Observação<input name="o" placeholder="ex.: vale da semana"></label></form>
        ${R.cfg.plano_adiantamento_id ? '<p class="small muted">Gera o título a pagar na conta de adiantamento dos parâmetros.</p>' : '<p class="small warn">Sem a conta de adiantamento nos parâmetros: fica só o controle, sem título a pagar.</p>'}`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="af-ok">Lançar</button>' });
    $('#af-ok', md.el).onclick = async (ev) => { const f = $('#af', md.el), v = parseNum(f.v.value); if (!(v > 0)) return toast('Informe o valor', true); ev.target.disabled = true;
      try { await q(sb.rpc('rec_adiantamento_lancar', { p_empresa: e, p_fornecedor: f.f.value, p_data: f.d.value, p_valor: v, p_obs: f.o.value || null })); md.close(); toast('Adiantamento lançado'); render(root); }
      catch (err) { ev.target.disabled = false; fail(err); } };
  });
  $$('[data-ca]', c).forEach(b => b.onclick = () => {
    const md = modal({ title: 'Cancelar adiantamento', narrow: true, body: '<label>Motivo<input id="ca-m"></label>', foot: '<button class="btn" data-close>Voltar</button><button class="btn danger" id="ca-ok">Cancelar</button>' });
    $('#ca-ok', md.el).onclick = async () => { try { await q(sb.rpc('rec_adiantamento_cancelar', { p_adiant: b.dataset.ca, p_motivo: $('#ca-m', md.el).value })); md.close(); toast('Adiantamento cancelado'); render(root); } catch (err) { fail(err); } };
  });
}

// ------------------------------------------------------------------ relação para a nota de entrada
async function relacao(c, R, root) {
  const L = await q(sb.rpc('rec_relacao_nota', { p_empresa: state.empresa.id, p_de: ui.de, p_ate: ui.ate }));
  $('#re-acoes', root).innerHTML = '<button class="btn" id="rr-x">Excel</button>';
  const tot = L.reduce((s, x) => ({ kg: s.kg + +x.kg, v: s.v + +x.valor }), { kg: 0, v: 0 });
  c.innerHTML = `<div class="card toolbar"><label class="small">De <input type="date" id="rr-de" value="${ui.de}"></label><label class="small">Até <input type="date" id="rr-ate" value="${ui.ate}"></label>
      <span class="small muted">Compras fechadas sem nota do fornecedor, por fornecedor e material, para emitir a nota de entrada no sistema fiscal.</span></div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap" id="rr-t"><table><thead><tr><th>Fornecedor</th><th>CPF/CNPJ</th><th>Material</th><th>NCM</th><th>Tickets</th><th class="num">Peso pago (kg)</th><th class="num">R$/kg médio</th><th class="num">Valor</th></tr></thead><tbody>
      ${L.map(x => `<tr><td>${esc(x.fornecedor)}<div class="small muted">${esc(TIPOS_FORN[x.rec_tipo] || '')}${x.coletor_incentivado ? ' · coletor incentivado' : ''}</div></td><td>${esc(x.documento || '')}</td><td>${esc(x.material)}</td><td>${esc(x.ncm || '')}</td>
        <td class="small">${esc(x.tickets)}</td><td class="num">${n3(x.kg)}</td><td class="num">${n3(x.preco_medio)}</td><td class="num">${money(x.valor)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Nenhuma compra sem nota no período.</td></tr>'}
      ${L.length ? `<tr class="row-sec"><td colspan="5">Total</td><td class="num">${n3(Math.round(tot.kg * 1000) / 1000)}</td><td></td><td class="num">${money(tot.v)}</td></tr>` : ''}</tbody></table></div></div>
    <p class="small muted">Depois de emitir a nota, informe o número no ticket (botão "Salvar a nota") e ele sai desta relação.</p>`;
  $('#rr-de', c).onchange = (ev) => { ui.de = ev.target.value || mesIni(); render(root); };
  $('#rr-ate', c).onchange = (ev) => { ui.ate = ev.target.value || today(); render(root); };
  $('#rr-x', root).onclick = () => exportXLSX($('#rr-t table', c), `relacao_nota_entrada_${ui.de}_${ui.ate}`);
}
