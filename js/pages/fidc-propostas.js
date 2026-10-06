// Propostas de borderô FIDC: escolher títulos em aberto + fundo, simular, analisar, enviar e aprovar (diretor).
// O borderô original do fundo entra depois só para comparação (tela de comparação, na mesma página).
import { sb, state, q, fetchAll, podeEditar, loadCadastros } from '../lib/data.js';
import { importarNFs, lancarNFs } from '../lib/nf-titulos.js';
import { $, esc, money, money0, pct, dateBR, options, fail, toast, modal, formData, parseNum, exportXLSX, loading, MESES_CURTO, logoPNG } from '../lib/ui.js';

export const title = 'Propostas de borderô';

const ui = { aba: 'titulos', sel: new Set(), fundoId: '', dataOp: '', recompras: '', obs: '', busca: '', venDe: '', venAte: '', propostaEdit: null };
let fundos = [], titulos = [], propostas = [], emProposta = {}, carteira = [], historico = [];
// sacado: raiz do CNPJ (8 dígitos) quando houver; senão o nome normalizado (os borderôs cortam o nome em ~40 letras)
const chaveSac = (cnpj, nome) => { const d = String(cnpj || '').replace(/\D/g, ''); return d.length >= 8 ? 'c' + d.slice(0, 8) : 'n' + String(nome || '').normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 25); };

const hojeISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const dias = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const num1 = (v) => (+v || 0).toFixed(1).replace('.', ',');
const ehDiretor = () => state.papel === 'diretor';
const sacadoDe = (t) => state.cad.favById[t.favorecido_id]?.nome || t.descricao || '(sem cliente)';
const cnpjDe = (t) => state.cad.favById[t.favorecido_id]?.documento || '';
function descCustos(c, fu, n) {
  if (!c) return '';
  const p = [];
  if (c.ted) p.push(`TED/tarifa ${money(c.ted)}`);
  if (c.assinatura) p.push(`assinatura ${money(c.assinatura)}`);
  if (c.boletos) p.push(`boletos ${n} × ${money(fu?.tarifa_titulo ?? c.boletos / n)} = ${money(c.boletos)}`);
  if (c.consultas) p.push(`Serasa ${c.novos} sacado(s) novo(s) = ${money(c.consultas)}`);
  else if (c.novos === 0 && (+fu?.custo_consulta || 0) > 0) p.push('sem consulta Serasa (sacados já operados no fundo)');
  return p.length ? p.join(' · ') : 'sem tarifas cadastradas';
}
const STATUS_CLS = { Rascunho: 'negoc', Pendente: 'aberto', Aprovada: 'pago', Rejeitada: 'vencido', Cancelada: '' };

export async function render(root) {
  if (!ui.dataOp) ui.dataOp = hojeISO();
  root.innerHTML = `<div class="card"><div class="toolbar tabs" id="tabs">
      ${[['titulos', 'Títulos em aberto'], ['propostas', 'Propostas'], ['fundos', 'Condições dos fundos']].map(([k, n]) => `<button class="chip${ui.aba === k ? ' on' : ''}" data-aba="${k}">${n}</button>`).join('')}
      <span class="spacer"></span>
      ${podeEditar() ? '<button class="btn" id="lanc-nf">+ Lançar NFs</button><button class="btn" id="imp-nf">Importar NFs do ERP</button>' : ''}</div></div>
    <div id="corpo"></div>`;
  $('#tabs', root).onclick = (e) => { const b = e.target.closest('[data-aba]'); if (b) { ui.aba = b.dataset.aba; render(root); } };
  $('#imp-nf', root) && ($('#imp-nf', root).onclick = () => importarNFs(async () => { await carregar(); ui.aba = 'titulos'; render(root); }));
  $('#lanc-nf', root) && ($('#lanc-nf', root).onclick = () => lancarNFs(async () => { await carregar(); ui.aba = 'titulos'; render(root); }));
  loading($('#corpo', root));
  try { await carregar(); desenhar(root); } catch (err) { fail(err); }
}

async function carregar() {
  await loadCadastros();
  const e = state.empresa.id;
  const receitas = state.cad.plano.filter(p => p.nivel === 2 && p.codigo.startsWith('1.01')).map(p => p.id);
  let itensAbertos;
  [fundos, titulos, propostas, itensAbertos, historico] = await Promise.all([
    q(sb.from('fidc_fundos').select('*').eq('empresa_id', e).order('nome')),
    receitas.length ? fetchAll(() => sb.from('lancamentos').select('id,data,emissao,documento,descricao,favorecido_id,valor,conta_id,status,fidc_proposta_id').eq('empresa_id', e).eq('status', 'Em aberto').in('plano_id', receitas).order('data')) : [],
    q(sb.from('fidc_propostas').select('*').eq('empresa_id', e).order('numero', { ascending: false })),
    q(sb.from('fidc_proposta_itens').select('lancamento_id, proposta_id, fidc_propostas!inner(numero,status)').eq('empresa_id', e).in('fidc_propostas.status', ['Rascunho', 'Pendente'])),
    fetchAll(() => sb.from('fidc_titulos').select('fundo,valor,vencimento,sacado_agrupado,sacado,cnpj_sacado').eq('empresa_id', e)),
  ]);
  const hj = hojeISO(); carteira = historico.filter(t => t.vencimento > hj);
  emProposta = {};
  for (const i of itensAbertos || []) emProposta[i.lancamento_id] = i.fidc_propostas;
  for (const id of [...ui.sel]) if (!titulos.some(t => t.id === id)) ui.sel.delete(id);
}

function desenhar(root) {
  const c = $('#corpo', root);
  if (ui.aba === 'titulos') return abaTitulos(c, root);
  if (ui.aba === 'propostas') return abaPropostas(c, root);
  return abaFundos(c, root);
}

// ======================================================================
// Simulação
// ======================================================================
function simular(fu, tits, dataOp, recompras = 0) {
  const face = tits.reduce((s, t) => s + +t.valor, 0);
  let desagio = 0, fp = 0, fpc = 0; const itens = [];
  for (const t of tits) {
    const prazo = Math.max(1, dias(dataOp, t.data)); const pc = prazo + (+fu.dias_compensacao || 0);
    const k = (+fu.taxa_am / 100) * pc / 30; const d = +t.valor * k / (1 + k);
    desagio += d; fp += +t.valor * prazo; fpc += +t.valor * pc;
    itens.push({ t, prazo, pc, custo: d });
  }
  const ad = face * (+fu.ad_valorem_pct || 0) / 100;
  // custos da operação: TED/fixo e assinatura por borderô, boleto por título, Serasa por sacado novo no fundo
  const jaNoFundo = new Set(historico.filter(h => h.fundo === fu.nome).map(h => chaveSac(h.cnpj_sacado, h.sacado)));
  const sacs = new Set(tits.map(t => chaveSac(cnpjDe(t), sacadoDe(t))));
  const novos = [...sacs].filter(k => !jaNoFundo.has(k)).length;
  const custos = tits.length ? { ted: +fu.tarifa_operacao || 0, assinatura: +fu.custo_assinatura || 0, boletos: tits.length * (+fu.tarifa_titulo || 0), consultas: novos * (+fu.custo_consulta || 0), novos } : { ted: 0, assinatura: 0, boletos: 0, consultas: 0, novos: 0 };
  const tar = custos.ted + custos.assinatura + custos.boletos + custos.consultas;
  const iof = face * (+fu.iof_pct || 0) / 100;
  const custo = desagio + ad + tar + iof;
  const prazo = face ? fp / face : 0, prazoC = face ? fpc / face : 0;
  const taxaEf = face && prazoC && face - custo ? custo / (face - custo) / prazoC * 30 : 0;
  const liquido = face - custo - (+recompras || 0);
  return { fu, face, desagio, ad, tar, custos, iof, custo, prazo, prazoC, taxaEf, liquido, itens, n: tits.length };
}

// Verificações de limite e concentração para um fundo
function checagens(sim, tits, dataOp) {
  const fu = sim.fu; const out = [];
  const cart = carteira.filter(t => t.fundo === fu.nome);
  const cartV = cart.reduce((s, t) => s + +t.valor, 0);
  if (fu.limite_credito) {
    const apos = cartV + sim.face; const ok = apos <= +fu.limite_credito;
    out.push([ok ? 'ok' : 'atencao', 'Limite de crédito', `Carteira a vencer ${money0(cartV)} + proposta ${money0(sim.face)} = ${money0(apos)} de ${money0(fu.limite_credito)} (${pct(apos / fu.limite_credito)})`]);
  } else out.push(['info', 'Limite de crédito', `Sem limite cadastrado. Carteira a vencer no fundo: ${money0(cartV)}.`]);
  // concentração do sacado no fundo após a operação
  const porSac = {};
  for (const t of cart) { const k = (t.sacado_agrupado || t.sacado || '').toUpperCase(); porSac[k] = (porSac[k] || 0) + +t.valor; }
  for (const t of tits) { const k = sacadoDe(t).toUpperCase(); porSac[k] = (porSac[k] || 0) + +t.valor; }
  const tot = cartV + sim.face; const maior = Object.entries(porSac).sort((a, b) => b[1] - a[1])[0];
  if (maior && tot) {
    const p = maior[1] / tot; const lim = fu.limite_sacado_pct ? +fu.limite_sacado_pct / 100 : 0.3;
    out.push([p > lim ? 'atencao' : 'ok', 'Concentração no fundo após a operação', `Maior sacado: ${maior[0]} com ${pct(p)} da carteira do fundo (limite ${pct(lim, 0)}${fu.limite_sacado_pct ? '' : ', referência'}).`]);
  }
  const fora = sim.itens.filter(x => (fu.prazo_min && x.prazo < fu.prazo_min) || (fu.prazo_max && x.prazo > fu.prazo_max));
  if (fu.prazo_min || fu.prazo_max) out.push([fora.length ? 'atencao' : 'ok', 'Prazo dos títulos', fora.length ? `${fora.length} título(s) fora do prazo aceito (${fu.prazo_min || 0} a ${fu.prazo_max || '∞'} dias).` : `Todos dentro do prazo aceito (${fu.prazo_min || 0} a ${fu.prazo_max || '∞'} dias).`]);
  const curtos = sim.itens.filter(x => x.prazo < 7);
  if (curtos.length) out.push(['info', 'Títulos de prazo muito curto', `${curtos.length} título(s) vencem em menos de 7 dias; o custo fixo pesa mais nesses.`]);
  const venc = tits.filter(t => t.data <= dataOp);
  if (venc.length) out.push(['atencao', 'Títulos vencidos', `${venc.length} título(s) com vencimento até a data da operação.`]);
  return out;
}

// ======================================================================
// Aba: títulos em aberto e montagem da proposta
// ======================================================================
function abaTitulos(c, root) {
  const ed = podeEditar();
  const ativos = fundos.filter(f => f.ativo);
  if (!ui.fundoId && ativos.length) ui.fundoId = ativos.slice().sort((a, b) => a.taxa_am - b.taxa_am)[0].id;
  const filt = titulos.filter(t => (!ui.busca || (sacadoDe(t) + ' ' + (t.documento || '')).toUpperCase().includes(ui.busca.toUpperCase()))
    && (!ui.venDe || t.data >= ui.venDe) && (!ui.venAte || t.data <= ui.venAte));
  const livres = filt.filter(t => !emProposta[t.id]);
  c.innerHTML = `
    <div class="card"><div class="toolbar" id="flt-t">
      <label>Buscar cliente / NF<input name="busca" value="${esc(ui.busca)}" placeholder="nome ou número"></label>
      <label>Vencimento de<input type="date" name="venDe" value="${ui.venDe}"></label>
      <label>até<input type="date" name="venAte" value="${ui.venAte}"></label>
      <span class="spacer"></span>
      <span class="muted small">${titulos.length} títulos em aberto · ${money0(titulos.reduce((s, t) => s + +t.valor, 0))}</span></div></div>
    <div class="grid2 prop-grid">
      <div class="card flush"><div class="card-head"><div><h2>Títulos disponíveis</h2><p class="muted small">Duplicatas em aberto (receita 1.01). Marque os títulos que vão para o borderô.</p></div>
        ${ed ? `<div class="toolbar"><button class="btn small" id="sel-todos">Marcar filtrados</button><button class="btn small" id="sel-nenhum">Limpar</button></div>` : ''}</div>
        <div class="table-wrap" style="max-height:560px">${filt.length ? `<table><thead><tr><th></th><th>Vencimento</th><th class="num">Prazo</th><th>Cliente (sacado)</th><th>NF / parcela</th><th class="num">Valor</th></tr></thead><tbody>
          ${filt.map(t => { const ep = emProposta[t.id]; const pz = dias(ui.dataOp, t.data); return `<tr class="${ep ? 'muted' : 'clickable'}" data-id="${t.id}">
            <td>${ep ? `<span class="badge ${STATUS_CLS[ep.status]}" title="Já está na proposta nº ${ep.numero}">nº ${ep.numero}</span>` : `<input type="checkbox" ${ui.sel.has(t.id) ? 'checked' : ''} ${ed ? '' : 'disabled'} aria-label="Selecionar">`}</td>
            <td>${dateBR(t.data)}</td><td class="num${pz < 7 ? ' neg' : ''}">${pz}</td><td class="wrap">${esc(sacadoDe(t))}</td><td>${esc(t.documento || '')}</td><td class="num">${money(t.valor)}</td></tr>`; }).join('')}
          </tbody></table>` : `<div class="empty">${titulos.length ? 'Nenhum título no filtro.' : 'Nenhum título em aberto. Use “Importar NFs do ERP”.'}</div>`}</div></div>
      <div id="painel"></div>
    </div>`;
  const f = $('#flt-t', c);
  f.addEventListener('change', (e) => { ui[e.target.name] = e.target.value; abaTitulos(c, root); });
  if (ed) {
    $('table', c)?.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]'); if (!tr || emProposta[tr.dataset.id]) return;
      const id = tr.dataset.id; ui.sel.has(id) ? ui.sel.delete(id) : ui.sel.add(id);
      const cb = $('input[type=checkbox]', tr); if (cb) cb.checked = ui.sel.has(id);
      painel($('#painel', c), root);
    });
    $('#sel-todos', c).onclick = () => { livres.forEach(t => ui.sel.add(t.id)); abaTitulos(c, root); };
    $('#sel-nenhum', c).onclick = () => { ui.sel.clear(); abaTitulos(c, root); };
  }
  painel($('#painel', c), root);
}

function painel(el, root) {
  const tits = titulos.filter(t => ui.sel.has(t.id));
  const ativos = fundos.filter(f => f.ativo);
  if (!tits.length) { el.innerHTML = `<div class="card"><h2>Nova proposta</h2><div class="empty">Marque os títulos ao lado para simular o borderô.</div>
    ${!ativos.length ? '<p class="small neg">Cadastre as condições dos fundos antes (aba “Condições dos fundos”).</p>' : ''}</div>`; return; }
  const sims = ativos.map(fu => simular(fu, tits, ui.dataOp, parseNum(ui.recompras) || 0));
  const S = sims.find(s => s.fu.id === ui.fundoId) || sims[0];
  const melhor = sims.slice().sort((a, b) => a.custo - b.custo)[0];
  // melhor fundo por título (distribuição ótima)
  let otimo = 0; const porFundoOt = {};
  for (const t of tits) {
    const best = ativos.map(fu => ({ fu, c: simular(fu, [t], ui.dataOp).desagio + t.valor * (+fu.ad_valorem_pct || 0) / 100 + (+fu.tarifa_titulo || 0) })).sort((a, b) => a.c - b.c)[0];
    otimo += best.c; porFundoOt[best.fu.nome] = (porFundoOt[best.fu.nome] || 0) + +t.valor;
  }
  const fixosOt = Object.keys(porFundoOt).reduce((s, n) => { const f = ativos.find(x => x.nome === n); return s + (+f.tarifa_operacao || 0) + (+f.custo_assinatura || 0); }, 0); otimo += fixosOt;
  const chk = checagens(S, tits, ui.dataOp);
  const porSac = {}; for (const t of tits) { const k = sacadoDe(t); porSac[k] = (porSac[k] || 0) + +t.valor; }
  const sacOrd = Object.entries(porSac).sort((a, b) => b[1] - a[1]);
  const vencs = {}; for (const x of S.itens) { const k = x.prazo <= 30 ? 'até 30 dias' : x.prazo <= 45 ? '31 a 45' : x.prazo <= 60 ? '46 a 60' : x.prazo <= 90 ? '61 a 90' : 'acima de 90'; vencs[k] = (vencs[k] || 0) + +x.t.valor; }
  const ROT = { atencao: ['⚠', 'Atenção'], info: ['ℹ', 'Info'], ok: ['✓', 'OK'] };
  el.innerHTML = `<div class="card">
    <div class="card-head"><h2>Nova proposta${ui.propostaEdit ? ` — editando nº ${ui.propostaEdit.numero}` : ''}</h2><span class="muted small">${tits.length} títulos · ${money0(S.face)}</span></div>
    <form id="pf" class="toolbar">
      <label>Fundo<select name="fundoId">${options(ativos.map(f => ({ id: f.id, nome: f.nome })), { selected: S.fu.id })}</select></label>
      <label>Data da operação<input type="date" name="dataOp" value="${ui.dataOp}"></label>
      <label>Recompras a descontar (R$)<input name="recompras" inputmode="decimal" value="${esc(ui.recompras)}" placeholder="0,00"></label>
    </form>
    <div class="kpis" style="margin-top:12px">
      <div class="kpi"><div class="k-label">Valor de face</div><div class="k-value">${money0(S.face)}</div><div class="k-sub">${S.n} títulos</div></div>
      <div class="kpi"><div class="k-label">Custo estimado</div><div class="k-value">${money0(S.custo)}</div><div class="k-sub">${pct(S.face ? S.custo / S.face : 0, 2)} da face</div></div>
      <div class="kpi"><div class="k-label">Líquido estimado</div><div class="k-value">${money0(S.liquido)}</div><div class="k-sub">crédito em ${esc(state.cad.contaById[S.fu.conta_credito_id]?.nome || '—')}</div></div>
      <div class="kpi"><div class="k-label">Taxa a.m.</div><div class="k-value">${pct(S.taxaEf, 2)}</div><div class="k-sub">prazo ${num1(S.prazo)} d · cobrado ${num1(S.prazoC)} d</div></div>
    </div>
    <h3 style="margin-top:16px">Comparação entre fundos para estes títulos</h3>
    <div class="table-wrap"><table><thead><tr><th>Fundo</th><th class="num">Taxa cad.</th><th class="num">Deságio</th><th class="num">Tarifas, assin., boletos, Serasa, IOF</th><th class="num">Custo</th><th class="num">Líquido</th><th class="num">Dif. vs. + barato</th><th></th></tr></thead><tbody>
      ${sims.map(s => `<tr class="${s.fu.id === S.fu.id ? 'row-sel' : ''}"><td>${esc(s.fu.nome)}</td><td class="num">${pct(s.fu.taxa_am / 100, 2)}</td><td class="num">${money0(s.desagio)}</td><td class="num">${money0(s.ad + s.tar + s.iof)}</td><td class="num"><strong>${money0(s.custo)}</strong></td><td class="num">${money0(s.liquido)}</td><td class="num">${s === melhor ? '—' : '+' + money0(s.custo - melhor.custo)}</td><td>${s === melhor ? '<span class="badge pago">menor custo</span>' : ''}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small muted" style="margin:6px 0 0">Custos da operação no ${esc(S.fu.nome)}: ${descCustos(S.custos, S.fu, S.n)}.</p>
    ${Object.keys(porFundoOt).length > 1 && otimo < melhor.custo - 1 ? `<p class="small" style="margin:8px 0 0">💡 Dividindo os títulos entre fundos (cada título no mais barato) o custo seria <strong>${money0(otimo)}</strong>, ${money0(melhor.custo - otimo)} a menos: ${Object.entries(porFundoOt).map(([n, v]) => `${esc(n)} ${money0(v)}`).join(' · ')}.</p>` : ''}
    <h3 style="margin-top:16px">Verificações — ${esc(S.fu.nome)}</h3>
    <div class="alert-list">${chk.map(([st, t, d]) => `<div class="alert-row ${st}"><span class="alert-tag">${ROT[st][0]} ${ROT[st][1]}</span><div><strong>${esc(t)}</strong><div class="small muted">${esc(d)}</div></div></div>`).join('')}</div>
    <div class="grid2" style="margin-top:12px">
      <div><h3>Sacados na proposta</h3><div class="table-wrap"><table><tbody>${sacOrd.slice(0, 8).map(([k, v]) => `<tr><td class="wrap">${esc(k)}</td><td class="num">${money0(v)}</td><td class="num${v / S.face > .3 ? ' neg' : ''}">${pct(v / S.face)}</td></tr>`).join('')}${sacOrd.length > 8 ? `<tr class="muted"><td>Demais (${sacOrd.length - 8})</td><td class="num">${money0(sacOrd.slice(8).reduce((s, [, v]) => s + v, 0))}</td><td></td></tr>` : ''}</tbody></table></div></div>
      <div><h3>Prazos</h3><div class="table-wrap"><table><tbody>${['até 30 dias', '31 a 45', '46 a 60', '61 a 90', 'acima de 90'].filter(k => vencs[k]).map(k => `<tr><td>${k}</td><td class="num">${money0(vencs[k])}</td><td class="num">${pct(vencs[k] / S.face)}</td></tr>`).join('')}</tbody></table></div></div>
    </div>
    <label class="span2" style="margin-top:12px">Observação para o diretor<textarea id="obs" rows="2">${esc(ui.obs)}</textarea></label>
    <div class="toolbar" style="margin-top:12px;justify-content:flex-end">
      ${ui.propostaEdit ? '<button class="btn" id="cancel-ed">Cancelar edição</button>' : ''}
      <button class="btn" id="salvar">Salvar rascunho</button><button class="btn primary" id="enviar">Enviar para aprovação</button></div>
  </div>`;
  $('#pf', el).addEventListener('change', (e) => { ui[e.target.name] = e.target.value; if (e.target.name === 'dataOp') return abaTitulos($('#corpo', root), root); painel(el, root); });
  $('#obs', el).oninput = (e) => { ui.obs = e.target.value; };
  $('#salvar', el).onclick = () => salvarProposta(root, S, tits, chk, sims, 'Rascunho');
  $('#enviar', el).onclick = () => salvarProposta(root, S, tits, chk, sims, 'Pendente');
  $('#cancel-ed', el) && ($('#cancel-ed', el).onclick = () => { ui.propostaEdit = null; ui.sel.clear(); abaTitulos($('#corpo', root), root); });
}

async function salvarProposta(root, S, tits, chk, sims, status) {
  if (status === 'Pendente' && !confirm(`Enviar a proposta (${S.fu.nome}, ${tits.length} títulos, ${money0(S.face)}) para aprovação do diretor?`)) return;
  const e = state.empresa.id;
  const row = { empresa_id: e, fundo_id: S.fu.id, data_operacao: ui.dataOp, status, qtd_titulos: S.n, valor_face: +S.face.toFixed(2),
    prazo_medio: +S.prazo.toFixed(2), prazo_cobrado: +S.prazoC.toFixed(2), taxa_am: +(S.taxaEf * 100).toFixed(4), desagio: +S.desagio.toFixed(2), ad_valorem: +S.ad.toFixed(2),
    tarifas: +S.tar.toFixed(2), iof: +S.iof.toFixed(2), recompras: parseNum(ui.recompras) || 0, liquido: +S.liquido.toFixed(2), conta_credito_id: S.fu.conta_credito_id,
    observacao: ui.obs || null, enviado_em: status === 'Pendente' ? new Date().toISOString() : null,
    analise: { checagens: chk, comparacao: sims.map(s => ({ fundo: s.fu.nome, taxa_cad: +s.fu.taxa_am, custo: +s.custo.toFixed(2), liquido: +s.liquido.toFixed(2), taxa: +(s.taxaEf * 100).toFixed(4) })),
      custos: Object.fromEntries(Object.entries(S.custos).map(([k, v]) => [k, +(+v).toFixed(2)])),
      condicoes: { taxa_am: +S.fu.taxa_am, ad_valorem_pct: +S.fu.ad_valorem_pct, tarifa_operacao: +S.fu.tarifa_operacao, custo_assinatura: +S.fu.custo_assinatura, tarifa_titulo: +S.fu.tarifa_titulo, custo_consulta: +S.fu.custo_consulta, iof_pct: +S.fu.iof_pct, dias_compensacao: S.fu.dias_compensacao } } };
  try {
    let p;
    if (ui.propostaEdit) {
      p = await q(sb.from('fidc_propostas').update(row).eq('id', ui.propostaEdit.id).select().single());
      await q(sb.from('fidc_proposta_itens').delete().eq('proposta_id', p.id));
    } else p = await q(sb.from('fidc_propostas').insert(row).select().single());
    const itens = S.itens.map(x => ({ proposta_id: p.id, empresa_id: e, lancamento_id: x.t.id, documento: x.t.documento, sacado: sacadoDe(x.t), cnpj: cnpjDe(x.t) || null,
      emissao: x.t.emissao, vencimento: x.t.data, valor: x.t.valor, prazo: x.prazo, custo_estimado: +x.custo.toFixed(2) }));
    for (let i = 0; i < itens.length; i += 500) await q(sb.from('fidc_proposta_itens').insert(itens.slice(i, i + 500)));
    toast(status === 'Pendente' ? `Proposta nº ${p.numero} enviada para aprovação` : `Rascunho nº ${p.numero} salvo`);
    ui.sel.clear(); ui.obs = ''; ui.recompras = ''; ui.propostaEdit = null; ui.aba = 'propostas';
    render(root);
  } catch (err) { fail(err); }
}

// ======================================================================
// Aba: propostas (lista, detalhe, aprovação)
// ======================================================================
function abaPropostas(c, root) {
  const fuById = Object.fromEntries(fundos.map(f => [f.id, f]));
  const pend = propostas.filter(p => p.status === 'Pendente');
  c.innerHTML = `${ehDiretor() && pend.length ? `<div class="card alert-row atencao" style="display:block"><strong>${pend.length} proposta(s) aguardando sua aprovação</strong> — ${money0(pend.reduce((s, p) => s + +p.valor_face, 0))} em títulos.</div>` : ''}
    <div class="card flush"><div class="card-head"><h2>Propostas de borderô</h2><span class="muted small">Clique para ver os detalhes${ehDiretor() ? ' e aprovar' : ''}.</span></div>
    <div class="table-wrap">${propostas.length ? `<table><thead><tr><th>Nº</th><th>Status</th><th>Fundo</th><th>Data op.</th><th class="num">Títulos</th><th class="num">Face</th><th class="num">Custo</th><th class="num">Líquido</th><th class="num">Taxa a.m.</th><th>Borderô original</th></tr></thead><tbody>
      ${propostas.map(p => `<tr class="clickable" data-id="${p.id}"><td>${p.numero}</td><td><span class="badge ${STATUS_CLS[p.status]}">${p.status}</span></td><td>${esc(fuById[p.fundo_id]?.nome || '')}</td><td>${dateBR(p.data_operacao)}</td>
        <td class="num">${p.qtd_titulos}</td><td class="num">${money0(p.valor_face)}</td><td class="num">${money0(p.custo_total)}</td><td class="num">${money0(p.liquido)}</td><td class="num">${pct(p.taxa_am / 100, 2)}</td>
        <td>${p.comparativo ? `<span class="badge ${p.comparativo.recusados || p.comparativo.extras || p.comparativo.divergentes ? 'aberto' : 'pago'}">nº ${esc(p.comparativo.bordero || '')}</span>` : p.status === 'Aprovada' ? '<span class="muted small">a comparar</span>' : ''}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Nenhuma proposta ainda.</div>'}</div></div>`;
  $('table', c)?.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) detalhe(propostas.find(p => p.id === tr.dataset.id), root); });
}

async function detalhe(p, root) {
  const fu = fundos.find(f => f.id === p.fundo_id) || {};
  let itens = [];
  try { itens = await q(sb.from('fidc_proposta_itens').select('*').eq('proposta_id', p.id).order('vencimento')); } catch (e) { return fail(e); }
  const an = p.analise || {}; const ROT = { atencao: ['⚠', 'Atenção'], info: ['ℹ', 'Info'], ok: ['✓', 'OK'] };
  const ed = podeEditar();
  const acoes = [];
  if (ehDiretor() && p.status === 'Pendente') acoes.push('<button class="btn danger" id="rej">Rejeitar</button>', '<button class="btn primary" id="apr">Aprovar operação</button>');
  if (ed && ['Rascunho', 'Rejeitada'].includes(p.status)) acoes.push('<button class="btn" id="edit">Editar</button>', '<button class="btn danger" id="del">Excluir</button>');
  if (ed && p.status === 'Rascunho') acoes.push('<button class="btn primary" id="env">Enviar para aprovação</button>');
  if (ed && p.status === 'Pendente') acoes.push('<button class="btn" id="canc">Cancelar envio</button>');
  const m = modal({
    title: `Proposta nº ${p.numero} — ${fu.nome || ''}`, wide: true,
    body: `<p style="margin:0 0 10px"><span class="badge ${STATUS_CLS[p.status]}">${p.status}</span>
        <span class="muted small">criada em ${dateBR(p.criado_em.slice(0, 10))}${p.enviado_em ? ' · enviada em ' + dateBR(p.enviado_em.slice(0, 10)) : ''}${p.aprovado_em ? ` · ${p.status === 'Aprovada' ? 'aprovada' : 'decidida'} em ${dateBR(p.aprovado_em.slice(0, 10))}` : ''}</span></p>
      ${p.motivo ? `<p class="small"><strong>Motivo / comentário do diretor:</strong> ${esc(p.motivo)}</p>` : ''}
      <div class="kpis">
        <div class="kpi"><div class="k-label">Valor de face</div><div class="k-value">${money0(p.valor_face)}</div><div class="k-sub">${p.qtd_titulos} títulos · operação ${dateBR(p.data_operacao)}</div></div>
        <div class="kpi"><div class="k-label">Custo estimado</div><div class="k-value">${money0(p.custo_total)}</div><div class="k-sub">deságio ${money0(p.desagio)} · tarifas/IOF ${money0(+p.tarifas + +p.iof + +p.ad_valorem)}</div></div>
        <div class="kpi"><div class="k-label">Líquido estimado</div><div class="k-value">${money0(p.liquido)}</div><div class="k-sub">${p.recompras > 0 ? `recompras ${money0(p.recompras)} · ` : ''}crédito em ${esc(state.cad.contaById[p.conta_credito_id]?.nome || '—')}</div></div>
        <div class="kpi"><div class="k-label">Taxa a.m.</div><div class="k-value">${pct(p.taxa_am / 100, 2)}</div><div class="k-sub">prazo ${num1(p.prazo_medio)} d · cobrado ${num1(p.prazo_cobrado)} d</div></div>
      </div>
      ${an.custos ? `<p class="small" style="margin-top:10px"><strong>Custos da operação:</strong> ${descCustos(an.custos, an.condicoes, p.qtd_titulos)}${+p.ad_valorem ? ` · ad valorem ${money(p.ad_valorem)}` : ''}${+p.iof ? ` · IOF ${money(p.iof)}` : ''}.</p>` : ''}
      ${p.observacao ? `<p class="small" style="margin-top:10px"><strong>Observação:</strong> ${esc(p.observacao)}</p>` : ''}
      ${an.comparacao ? `<h3 style="margin-top:14px">Comparação entre fundos (no envio)</h3><div class="table-wrap"><table><thead><tr><th>Fundo</th><th class="num">Custo</th><th class="num">Líquido</th><th class="num">Taxa a.m.</th></tr></thead><tbody>
        ${an.comparacao.slice().sort((a, b) => a.custo - b.custo).map(x => `<tr class="${x.fundo === fu.nome ? 'row-sel' : ''}"><td>${esc(x.fundo)}</td><td class="num">${money0(x.custo)}</td><td class="num">${money0(x.liquido)}</td><td class="num">${pct(x.taxa / 100, 2)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${an.checagens ? `<h3 style="margin-top:14px">Verificações</h3><div class="alert-list">${an.checagens.map(([st, t, d]) => `<div class="alert-row ${st}"><span class="alert-tag">${ROT[st][0]} ${ROT[st][1]}</span><div><strong>${esc(t)}</strong><div class="small muted">${esc(d)}</div></div></div>`).join('')}</div>` : ''}
      ${p.comparativo ? blocoComparativo(p.comparativo) : ''}
      <h3 style="margin-top:14px">Títulos (${itens.length})</h3>
      <div class="table-wrap" style="max-height:300px"><table><thead><tr><th>Vencimento</th><th class="num">Prazo</th><th>Sacado</th><th>NF / parcela</th><th class="num">Valor</th><th class="num">Custo est.</th>${p.comparativo ? '<th>No borderô</th>' : ''}</tr></thead><tbody>
        ${itens.map(i => `<tr><td>${dateBR(i.vencimento)}</td><td class="num">${i.prazo ?? ''}</td><td class="wrap">${esc(i.sacado || '')}</td><td>${esc(i.documento || '')}</td><td class="num">${money(i.valor)}</td><td class="num">${money(i.custo_estimado)}</td>${p.comparativo ? `<td>${esc(i.situacao_bordero || '')}</td>` : ''}</tr>`).join('')}</tbody></table></div>`,
    foot: `<button class="btn" id="pdfp" style="margin-right:auto">PDF para aprovação</button>${p.status === 'Aprovada' && ed ? '<button class="btn" id="cmpb">Comparar com borderô original</button>' : ''}${acoes.join('')}<button class="btn" data-close>Fechar</button>`,
  });
  const act = async (fn, msg) => { try { await fn(); toast(msg); m.close(); await carregar(); desenhar(root); } catch (e) { fail(e); } };
  $('#pdfp', m.el).onclick = () => pdfProposta(p, fu, itens);
  $('#apr', m.el) && ($('#apr', m.el).onclick = () => { const c = prompt(`Aprovar a proposta nº ${p.numero}?\nOs ${p.qtd_titulos} títulos passam a pagos na conta ${state.cad.contaById[fu.conta_id]?.nome || fu.nome} em ${dateBR(p.data_operacao)}, são lançados deságio, tarifas e o crédito do líquido, e a operação entra na Análise FIDC como borderô P${p.numero}.\n\nComentário (opcional):`, ''); if (c === null) return;
    act(() => q(sb.rpc('decidir_proposta_fidc', { p_id: p.id, p_aprovar: true, p_motivo: c || null })), `Proposta nº ${p.numero} aprovada`); });
  $('#rej', m.el) && ($('#rej', m.el).onclick = () => { const c = prompt('Motivo da rejeição:', ''); if (c === null) return;
    act(() => q(sb.rpc('decidir_proposta_fidc', { p_id: p.id, p_aprovar: false, p_motivo: c || null })), `Proposta nº ${p.numero} rejeitada`); });
  $('#env', m.el) && ($('#env', m.el).onclick = () => act(() => q(sb.from('fidc_propostas').update({ status: 'Pendente', enviado_em: new Date().toISOString() }).eq('id', p.id)), 'Enviada para aprovação'));
  $('#canc', m.el) && ($('#canc', m.el).onclick = () => { if (confirm('Cancelar o envio? A proposta volta a rascunho.')) act(() => q(sb.from('fidc_propostas').update({ status: 'Rascunho', enviado_em: null }).eq('id', p.id)), 'Envio cancelado'); });
  $('#del', m.el) && ($('#del', m.el).onclick = () => { if (confirm(`Excluir a proposta nº ${p.numero}?`)) act(() => q(sb.from('fidc_propostas').delete().eq('id', p.id)), 'Proposta excluída'); });
  $('#edit', m.el) && ($('#edit', m.el).onclick = () => {
    ui.propostaEdit = p; ui.sel = new Set(itens.map(i => i.lancamento_id).filter(Boolean)); ui.fundoId = p.fundo_id; ui.dataOp = p.data_operacao;
    ui.recompras = p.recompras ? String(p.recompras).replace('.', ',') : ''; ui.obs = p.observacao || ''; ui.aba = 'titulos';
    for (const id of ui.sel) delete emProposta[id];
    m.close(); render(root);
  });
  $('#cmpb', m.el) && ($('#cmpb', m.el).onclick = () => { m.close(); compararBordero(p, fu, itens, root); });
}

// ======================================================================
// Comparação com o borderô original (lido do arquivo do fundo ou já na base FIDC)
// ======================================================================
function blocoComparativo(cp) {
  const linha = (n, a, b, fmt = money0) => { const d = (+b || 0) - (+a || 0); return `<tr><td>${n}</td><td class="num">${fmt(a)}</td><td class="num">${fmt(b)}</td><td class="num ${Math.abs(d) > 1 ? (d > 0 ? 'neg' : 'pos') : ''}">${Math.abs(d) > (fmt === money0 ? 1 : 0.00005) ? (d > 0 ? '+' : '') + fmt(d) : '✓'}</td></tr>`; };
  return `<h3 style="margin-top:14px">Simulado × borderô original ${cp.bordero ? `(${esc(cp.fundo || '')} nº ${esc(cp.bordero)}, ${dateBR(cp.data)})` : ''}</h3>
    <div class="table-wrap"><table><thead><tr><th></th><th class="num">Proposta</th><th class="num">Borderô</th><th class="num">Diferença</th></tr></thead><tbody>
      ${linha('Títulos', cp.prop.n, cp.real.n, v => v ?? '–')}${linha('Valor de face', cp.prop.face, cp.real.face)}${linha('Deságio / juros', cp.prop.desagio, cp.real.desagio)}
      ${linha('Tarifas, IOF e ad valorem', cp.prop.outros, cp.real.outros)}${linha('Custo total', cp.prop.custo, cp.real.custo)}${linha('Recompras descontadas', cp.prop.recompra, cp.real.recompra)}
      ${linha('Líquido', cp.prop.liquido, cp.real.liquido)}${linha('Taxa a.m.', cp.prop.taxa, cp.real.taxa, v => pct(v, 2))}</tbody></table></div>
    <p class="small muted" style="margin:6px 0 0">Títulos: ${cp.aceitos} aceitos · ${cp.recusados} da proposta fora do borderô · ${cp.extras} no borderô sem estar na proposta${cp.divergentes ? ` · ${cp.divergentes} com valor diferente` : ''}.</p>`;
}

async function compararBordero(p, fu, itens, root) {
  // Candidatos: borderôs do mesmo fundo na base FIDC, de 3 dias antes a 7 dias depois da data da operação
  const d0 = new Date(p.data_operacao + 'T12:00:00'); const a = new Date(d0); a.setDate(a.getDate() - 3); const b = new Date(d0); b.setDate(b.getDate() + 7);
  let cands = [];
  try { cands = await q(sb.from('fidc_operacoes').select('*').eq('empresa_id', state.empresa.id).eq('fundo', fu.nome).gte('data', a.toISOString().slice(0, 10)).lte('data', b.toISOString().slice(0, 10)).order('data')); } catch (e) { return fail(e); }
  cands = cands.filter(o => !/^P\d+$/.test(o.bordero)); // as operações P<nº> são as próprias propostas aprovadas
  const m = modal({
    title: `Comparar proposta nº ${p.numero} com o borderô original`, wide: true,
    body: `<p class="small muted" style="margin-top:0">Escolha o borderô do ${esc(fu.nome)} já registrado na base FIDC, ou leia o arquivo enviado pelo fundo (.htm ou .pdf). O registro oficial continua sendo a proposta aprovada (operação P${p.numero} na base FIDC); o borderô serve só de conferência e não é gravado na base.</p>
      ${cands.length ? `<div class="table-wrap"><table><thead><tr><th></th><th>Data</th><th>Borderô</th><th class="num">Títulos</th><th class="num">Face</th><th class="num">Líquido</th></tr></thead><tbody>
        ${cands.map(o => `<tr><td><input type="radio" name="op" value="${o.id}" ${p.operacao_id === o.id ? 'checked' : ''}></td><td>${dateBR(o.data)}</td><td>${esc(o.bordero)}</td><td class="num">${o.qtd_titulos}</td><td class="num">${money0(o.valor_face)}</td><td class="num">${money0(o.liquido)}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="small">Nenhum borderô desse fundo na base FIDC perto da data da operação.</p>'}
      <div class="toolbar" style="margin-top:12px"><label>Ou ler o arquivo do fundo<input type="file" id="arq-b" accept=".htm,.html,.pdf"></label></div>
      <div id="leitura" class="small" style="margin-top:8px"></div>`,
    foot: '<button class="btn" data-close>Fechar</button><button class="btn primary" id="cmp-ok">Comparar</button>',
  });
  let lido = null;
  $('#arq-b', m.el).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    $('#leitura', m.el).textContent = 'Lendo o arquivo…';
    try {
      const { lerBordero } = await import('../lib/bordero.js');
      lido = await lerBordero(f, fu.nome);
      $('#leitura', m.el).innerHTML = `Lido: <strong>${esc(lido.fundo)} borderô ${esc(lido.bordero || '?')}</strong> de ${dateBR(lido.data || '')} — ${lido.titulos.length} títulos, face ${money0(lido.valor_face)}, líquido ${money0(lido.liquido)}.`;
    } catch (err) { lido = null; $('#leitura', m.el).innerHTML = `<span class="neg">Não consegui ler este arquivo: ${esc(err.message || err)}</span>`; }
  };
  $('#cmp-ok', m.el).onclick = async () => {
    try {
      let op, tits;
      const id = $('input[name=op]:checked', m.el)?.value;
      if (lido) { op = lido; tits = lido.titulos; }
      else if (id) { op = cands.find(o => o.id === id); tits = await q(sb.from('fidc_titulos').select('*').eq('operacao_id', id)); }
      else return toast('Escolha um borderô ou leia o arquivo');
      // 36077-1, 36077-001 e 036077/1 são o mesmo título: compara número e parcela sem zeros à esquerda
      const norm = (s) => String(s || '').split(/[-\/.\s]+/).map(x => x.replace(/\D/g, '')).filter(Boolean).map(x => String(+x)).join('-');
      const chave = (doc, venc, val) => `${norm(doc)}|${venc}|${(+val).toFixed(2)}`;
      const usados = new Set(); let aceitos = 0, divergentes = 0;
      const sit = {};
      for (const i of itens) {
        let k = tits.findIndex((t, ix) => !usados.has(ix) && norm(t.titulo) && norm(i.documento) && norm(t.titulo) === norm(i.documento));
        if (k < 0) k = tits.findIndex((t, ix) => !usados.has(ix) && t.vencimento === i.vencimento && Math.abs(+t.valor - +i.valor) < 0.02);
        if (k >= 0) { usados.add(k); aceitos++; const dv = Math.abs(+tits[k].valor - +i.valor) > 0.02; if (dv) divergentes++; sit[i.id] = dv ? `valor ${money(tits[k].valor)}` : 'aceito'; }
        else sit[i.id] = 'fora do borderô';
      }
      const custoReal = (+op.desagio || 0) + (+op.ad_valorem || 0) + (+op.tarifas || 0) + (+op.iof || 0) + (+op.encargos || 0);
      const pc = +(op.prazo_cobrado ?? op.prazo_medio) || 0;
      const taxaReal = op.valor_face && pc && op.valor_face - custoReal ? custoReal / (op.valor_face - custoReal) / pc * 30 : 0;
      const cp = { fundo: op.fundo || fu.nome, bordero: op.bordero, data: op.data, aceitos, divergentes, recusados: itens.length - aceitos, extras: tits.length - usados.size,
        prop: { n: itens.length, face: +p.valor_face, desagio: +p.desagio, outros: +p.ad_valorem + +p.tarifas + +p.iof, custo: +p.custo_total, recompra: +p.recompras, liquido: +p.liquido, taxa: +p.taxa_am / 100 },
        real: { n: tits.length, face: +op.valor_face, desagio: (+op.desagio || 0) + (+op.encargos || 0), outros: (+op.ad_valorem || 0) + (+op.tarifas || 0) + (+op.iof || 0), custo: custoReal, recompra: +op.recompra || 0, liquido: +op.liquido, taxa: taxaReal } };
      await q(sb.from('fidc_propostas').update({ comparativo: cp }).eq('id', p.id));
      for (const i of itens) await q(sb.from('fidc_proposta_itens').update({ situacao_bordero: sit[i.id] }).eq('id', i.id));
      toast('Comparação registrada'); m.close(); await carregar();
      detalhe(propostas.find(x => x.id === p.id), root);
    } catch (e) { fail(e); }
  };
}

// ======================================================================
// Aba: condições dos fundos
// ======================================================================
function abaFundos(c, root) {
  const ed = podeEditar();
  const campos = [['taxa_am', 'Taxa a.m. (%)'], ['ad_valorem_pct', 'Ad valorem (% face)'], ['tarifa_operacao', 'TED / tarifa por borderô (R$)'], ['custo_assinatura', 'Assinatura eletrônica por borderô (R$)'],
    ['tarifa_titulo', 'Boleto / cobrança por título (R$)'], ['custo_consulta', 'Consulta Serasa por sacado novo (R$)'],
    ['iof_pct', 'IOF (% face)'], ['dias_compensacao', 'Dias de compensação'], ['prazo_min', 'Prazo mín. (dias)'], ['prazo_max', 'Prazo máx. (dias)'], ['limite_credito', 'Limite de crédito (R$)'], ['limite_sacado_pct', 'Limite por sacado (%)']];
  c.innerHTML = `<div class="card flush"><div class="card-head"><div><h2>Condições dos fundos</h2><p class="muted small">Usadas para simular as propostas. Os valores iniciais vieram da média dos borderôs de jul–set/2026; ajuste conforme o contrato de cada fundo. Prazo cobrado = prazo real + dias de compensação. Assinatura, boletos e consultas Serasa entram no custo do borderô (FS e Negocial conferidos com os borderôs de set/2026); a consulta só é cobrada para sacado que ainda não teve título no fundo.</p></div>
    ${ed ? '<button class="btn" id="novo-f">+ Fundo</button>' : ''}</div>
    <div class="table-wrap"><table><thead><tr><th>Fundo</th><th>Conta do fundo</th><th>Crédito do líquido</th>${campos.map(([, n]) => `<th class="num">${n}</th>`).join('')}<th>Ativo</th></tr></thead><tbody>
      ${fundos.map(f => `<tr class="${ed ? 'clickable' : ''}" data-id="${f.id}"><td><strong>${esc(f.nome)}</strong></td><td>${esc(state.cad.contaById[f.conta_id]?.nome || '—')}</td><td>${esc(state.cad.contaById[f.conta_credito_id]?.nome || '—')}</td>
        ${campos.map(([k]) => `<td class="num">${f[k] == null ? '–' : ['tarifa_operacao', 'custo_assinatura', 'tarifa_titulo', 'custo_consulta', 'limite_credito'].includes(k) ? money(f[k]) : String(f[k]).replace('.', ',')}</td>`).join('')}<td>${f.ativo ? 'sim' : 'não'}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  if (!ed) return;
  const editar = (f) => {
    const m = modal({
      title: f.id ? `Condições — ${f.nome}` : 'Novo fundo', wide: true,
      body: `<form id="ff" class="grid-form">
        <label>Nome (igual ao dos borderôs)<input name="nome" value="${esc(f.nome || '')}" required></label>
        <label>Conta do fundo<select name="conta_id">${options(state.cad.contas, { empty: '—', selected: f.conta_id })}</select></label>
        <label>Conta de crédito do líquido<select name="conta_credito_id">${options(state.cad.contas, { empty: '—', selected: f.conta_credito_id })}</select></label>
        ${campos.map(([k, n]) => `<label>${n}<input name="${k}" inputmode="decimal" value="${f[k] == null ? '' : String(f[k]).replace('.', ',')}"></label>`).join('')}
        <label>Ativo<select name="ativo"><option value="1" ${f.ativo !== false ? 'selected' : ''}>sim</option><option value="0" ${f.ativo === false ? 'selected' : ''}>não</option></select></label>
        <label class="span2">Observação<input name="observacao" value="${esc(f.observacao || '')}"></label></form>`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="fs">Salvar</button>',
    });
    $('#fs', m.el).onclick = async () => {
      const form = $('#ff', m.el); if (!form.reportValidity()) return; const d = formData(form);
      const row = { empresa_id: state.empresa.id, nome: d.nome.trim(), conta_id: d.conta_id || null, conta_credito_id: d.conta_credito_id || null, ativo: d.ativo === '1', observacao: d.observacao || null, updated_at: new Date().toISOString() };
      for (const [k] of campos) { const v = String(d[k] ?? '').trim(); row[k] = v === '' ? (['prazo_min', 'prazo_max', 'limite_credito', 'limite_sacado_pct'].includes(k) ? null : 0) : parseNum(v); }
      try { if (f.id) await q(sb.from('fidc_fundos').update(row).eq('id', f.id)); else await q(sb.from('fidc_fundos').insert(row)); toast('Condições salvas'); m.close(); await carregar(); desenhar(root); } catch (e) { fail(e); }
    };
  };
  $('table', c).onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) editar(fundos.find(f => f.id === tr.dataset.id)); };
  $('#novo-f', c).onclick = () => editar({ ativo: true });
}

// ======================================================================
// PDF da proposta (para aprovação do diretor)
// ======================================================================
async function pdfProposta(p, fu, itens) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const azul = [43, 85, 152], marinho = [42, 31, 111];
  const t = (s) => String(s ?? '').replace(/[✓]/g, 'OK').replace(/[⚠ℹ]\s*/g, '').replace(/[−–]/g, '-').replace(/×/g, 'x');
  const logo = await logoPNG();
  if (logo) doc.addImage(logo.data, 'PNG', 14, 8, 12 * logo.ratio, 12);
  doc.setTextColor(...marinho); doc.setFontSize(14); doc.setFont(undefined, 'bold');
  doc.text(`Proposta de borderô nº ${p.numero} — ${fu.nome}`, W - 14, 13, { align: 'right' });
  doc.setFontSize(9); doc.setFont(undefined, 'normal'); doc.setTextColor(90);
  doc.text(`${state.empresa.nome} · operação em ${dateBR(p.data_operacao)} · status: ${p.status}`, W - 14, 18.5, { align: 'right' });
  doc.setDrawColor(...marinho); doc.setLineWidth(.6); doc.line(14, 23, W - 14, 23); doc.setTextColor(20);
  const kv = [['Valor de face', money(p.valor_face)], ['Títulos', String(p.qtd_titulos)], ['Deságio estimado', money(p.desagio)], ['Tarifas, IOF e ad valorem', money(+p.tarifas + +p.iof + +p.ad_valorem)],
    ...(p.analise?.custos ? [['   TED / tarifa do borderô', money(p.analise.custos.ted)], ['   Assinatura eletrônica', money(p.analise.custos.assinatura)], [`   Boletos (${p.qtd_titulos} títulos)`, money(p.analise.custos.boletos)], [`   Consulta Serasa (${p.analise.custos.novos} sacado(s) novo(s))`, money(p.analise.custos.consultas)]].filter(r => r[1] !== money(0)) : []),
    ['Custo total estimado', money(p.custo_total)], ['Recompras a descontar', money(p.recompras)], ['Líquido estimado', money(p.liquido)], ['Taxa a.m.', pct(p.taxa_am / 100, 2)],
    ['Prazo médio / cobrado', `${num1(p.prazo_medio)} / ${num1(p.prazo_cobrado)} dias`], ['Conta de crédito', state.cad.contaById[p.conta_credito_id]?.nome || '-']];
  doc.autoTable({ startY: 27, theme: 'grid', body: kv, styles: { fontSize: 8.5, cellPadding: 1.6 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 }, 1: { halign: 'right' } }, margin: { left: 14, right: W / 2 + 4 } });
  const an = p.analise || {};
  if (an.comparacao) doc.autoTable({ startY: 27, theme: 'grid', head: [['Fundo', 'Custo', 'Líquido', 'Taxa a.m.']], headStyles: { fillColor: azul },
    body: an.comparacao.slice().sort((a, b) => a.custo - b.custo).map(x => [x.fundo + (x.fundo === fu.nome ? ' (escolhido)' : ''), money(x.custo), money(x.liquido), pct(x.taxa / 100, 2)]),
    styles: { fontSize: 8, cellPadding: 1.5 }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } }, margin: { left: W / 2 + 2, right: 14 } });
  let y = Math.max(doc.lastAutoTable.finalY, 27 + kv.length * 7) + 6;
  if (an.checagens) {
    doc.autoTable({ startY: y, theme: 'grid', head: [['Status', 'Verificação', 'Detalhe']], headStyles: { fillColor: azul }, body: an.checagens.map(([st, a, b]) => [st === 'atencao' ? 'Atenção' : st === 'ok' ? 'OK' : 'Info', t(a), t(b)]),
      styles: { fontSize: 7.5, cellPadding: 1.4 }, columnStyles: { 0: { cellWidth: 16, fontStyle: 'bold' }, 1: { cellWidth: 48 } }, margin: { left: 14, right: 14 } });
    y = doc.lastAutoTable.finalY + 6;
  }
  if (p.observacao) { doc.setFontSize(8.5); doc.text(doc.splitTextToSize('Observação: ' + t(p.observacao), W - 28), 14, y); y += 8; }
  doc.autoTable({ startY: y, theme: 'grid', head: [['Vencimento', 'Prazo', 'Sacado', 'NF / parcela', 'Valor', 'Custo est.']], headStyles: { fillColor: azul },
    body: itens.map(i => [dateBR(i.vencimento), i.prazo ?? '', t(i.sacado || ''), i.documento || '', money(i.valor), money(i.custo_estimado)]),
    foot: [['', '', 'TOTAL', '', money(p.valor_face), money(itens.reduce((s, i) => s + +(i.custo_estimado || 0), 0))]], footStyles: { fillColor: [232, 238, 248], textColor: 20, fontStyle: 'bold' },
    styles: { fontSize: 7.5, cellPadding: 1.3 }, columnStyles: { 1: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } }, margin: { left: 14, right: 14 } });
  y = doc.lastAutoTable.finalY + 24; if (y > H - 25) { doc.addPage(); y = 40; }
  doc.setDrawColor(120); doc.setLineWidth(.3); doc.line(20, y, 90, y); doc.line(W - 90, y, W - 20, y); doc.setFontSize(8.5);
  doc.text('Elaborado por (financeiro)', 20, y + 5); doc.text('Diretor — aprovo a operação', W - 90, y + 5);
  const n = doc.getNumberOfPages(); for (let i = 1; i <= n; i++) { doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(130); doc.text(`Página ${i} de ${n}`, W - 14, H - 7, { align: 'right' }); }
  doc.save(`proposta_fidc_${p.numero}_${fu.nome}.pdf`);
}
