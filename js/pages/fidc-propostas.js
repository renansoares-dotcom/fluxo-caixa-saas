// Propostas de borderô FIDC: escolher títulos em aberto + fundo, simular, analisar, enviar e aprovar (diretor).
// O borderô original do fundo entra depois só para comparação (tela de comparação, na mesma página).
import { sb, state, q, fetchAll, podeEditar, loadCadastros } from '../lib/data.js';
import { importarNFs, lancarNFs } from '../lib/nf-titulos.js';
import { notasSemTitulo, gerarContasReceber } from '../lib/nfe-receb.js';
import { $, esc, money, money0, pct, dateBR, options, fail, toast, modal, formData, parseNum, exportXLSX, loading, MESES_CURTO, logoPNG } from '../lib/ui.js';
import { condicaoDe, condicaoDoFundo, prazos, desagioTitulo } from '../lib/fidc-condicoes.js';
import { padronizarPDF, pdfCabecalho, pdfRodapes, PRETO } from '../lib/relatorio.js';

export const title = 'Propostas de borderô';

const ui = { soSel: false, aba: 'titulos', sel: new Set(), fundoId: '', dataOp: '', recompras: '', obs: '', busca: '', venDe: '', venAte: '', campoData: 'emissao', propostaEdit: null, vencAj: {}, pf: { status: '', fundo: '', mes: '', busca: '' } };
let fundos = [], titulos = [], propostas = [], emProposta = {}, carteira = [], historico = [], condicoes = [];
// sacado: raiz do CNPJ (8 dígitos) quando houver; senão o nome normalizado (os borderôs cortam o nome em ~40 letras)
const chaveSac = (cnpj, nome) => { const d = String(cnpj || '').replace(/\D/g, ''); return d.length >= 8 ? 'c' + d.slice(0, 8) : 'n' + String(nome || '').normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 25); };

const hojeISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const dias = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const num1 = (v) => (+v || 0).toFixed(1).replace('.', ',');
// aprova/rejeita: diretor ou admin (SQL 048)
const ehDiretor = () => ['diretor', 'admin'].includes(state.papel);
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
  const ab = state.abrir?.tipo === 'proposta' ? state.abrir : null;   // vindo da busca global
  if (ab) { delete state.abrir; ui.aba = 'propostas'; }
  let vindos = null;
  if (state.borderoSel?.length) { // títulos marcados na aba A receber
    vindos = state.borderoSel; delete state.borderoSel; ui.fundoId = '';
    ui.sel = new Set(vindos); ui.soSel = true; ui.aba = 'titulos'; ui.propostaEdit = null; ui.busca = ''; ui.venDe = ''; ui.venAte = '';
  }
  root.innerHTML = `<div class="card"><div class="toolbar tabs" id="tabs">
      ${[['titulos', 'Títulos em aberto'], ['propostas', 'Propostas'], ['fundos', 'Condições dos fundos']].map(([k, n]) => `<button class="chip${ui.aba === k ? ' on' : ''}" data-aba="${k}">${n}</button>`).join('')}
      <span class="spacer"></span>
      ${podeEditar() ? '<button class="btn" id="lanc-nf">+ Lançar NFs</button><button class="btn" id="imp-nf">Importar XML das NFs</button>' : ''}</div></div>
    <div id="corpo"></div>`;
  $('#tabs', root).onclick = (e) => { const b = e.target.closest('[data-aba]'); if (b) { ui.aba = b.dataset.aba; render(root); } };
  $('#imp-nf', root) && ($('#imp-nf', root).onclick = () => importarNFs(async () => { await carregar(); ui.aba = 'titulos'; render(root); }));
  $('#lanc-nf', root) && ($('#lanc-nf', root).onclick = () => lancarNFs(async () => { await carregar(); ui.aba = 'titulos'; render(root); }));
  loading($('#corpo', root));
  try {
    await carregar(); desenhar(root);
    if (ab) { const p = propostas.find(x => x.id === ab.id); if (p) detalhe(p, root); }
    if (vindos) { const ok = vindos.filter(id => ui.sel.has(id)).length; toast(`${ok} título(s) da aba A receber prontos para simular${ok < vindos.length ? ` · ${vindos.length - ok} não disponíveis` : ''}`); $('#painel', root)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }); }
  } catch (err) { fail(err); }
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
  // condições por grupo de sacados (SQL 050); sem a tabela, cada fundo usa os próprios campos
  try { condicoes = await q(sb.from('fidc_fundo_condicoes').select('*').eq('empresa_id', e).order('nome')); } catch { condicoes = []; }
  const hj = hojeISO(); carteira = historico.filter(t => t.vencimento > hj);
  emProposta = {};
  for (const i of itensAbertos || []) emProposta[i.lancamento_id] = i.fidc_propostas;
  for (const id of [...ui.sel]) if (!titulos.some(t => t.id === id) || (emProposta[id] && !ui.propostaEdit)) ui.sel.delete(id);
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
// Condição de cada título no fundo: a do grupo do sacado (CNPJ raiz) ou a de "demais"; sem condições, a do próprio fundo.
const condTit = (fu, t, dataOp) => condicaoDe(condicoes, fu.id, cnpjDe(t), dataOp) || condicaoDoFundo(fu);

// Um borderô = uma condição (a FS nunca junta Grupo Total e demais sacados na mesma operação).
function simGrupo(fu, cond, tits, dataOp, recompras = 0) {
  const face = tits.reduce((s, t) => s + +t.valor, 0);
  let desagio = 0, fp = 0, fpc = 0; const itens = [];
  for (const t of tits) {
    const { prazo, pc, cobradoAte, recesso } = prazos(cond, dataOp, t.data, fu.recessos);
    const d = desagioTitulo(cond, t.valor, pc);
    const extraRec = recesso ? d - desagioTitulo(cond, t.valor, prazos(cond, dataOp, t.data, []).pc) : 0;
    desagio += d; fp += +t.valor * prazo; fpc += +t.valor * pc;
    itens.push({ t, prazo, pc, custo: d, cond, cobradoAte, recesso, extraRec });
  }
  const ad = face * (+cond.ad_valorem_pct || 0) / 100;
  // custos da operação: TED/fixo e assinatura por borderô, boleto por título, Serasa por sacado novo no fundo
  const jaNoFundo = new Set(historico.filter(h => h.fundo === fu.nome).map(h => chaveSac(h.cnpj_sacado, h.sacado)));
  const sacs = new Set(tits.map(t => chaveSac(cnpjDe(t), sacadoDe(t))));
  const novos = [...sacs].filter(k => !jaNoFundo.has(k)).length;
  const custos = tits.length ? { ted: +cond.tarifa_operacao || 0, assinatura: +cond.custo_assinatura || 0, boletos: tits.length * (+cond.tarifa_titulo || 0), consultas: novos * (+cond.custo_consulta || 0), novos } : { ted: 0, assinatura: 0, boletos: 0, consultas: 0, novos: 0 };
  const tar = custos.ted + custos.assinatura + custos.boletos + custos.consultas;
  const iof = face * (+cond.iof_pct || 0) / 100;
  const custo = desagio + ad + tar + iof;
  const prazo = face ? fp / face : 0, prazoC = face ? fpc / face : 0;
  const taxaEf = face && prazoC && face - custo ? custo / (face - custo) / prazoC * 30 : 0;
  const liquido = face - custo - (+recompras || 0);
  return { fu, cond, face, desagio, ad, tar, custos, iof, custo, prazo, prazoC, taxaEf, liquido, itens, n: tits.length, tits };
}

function simular(fu, tits, dataOp, recompras = 0) {
  const porCond = new Map();
  for (const t of tits) { const c = condTit(fu, t, dataOp); if (!porCond.has(c.id)) porCond.set(c.id, { cond: c, tits: [] }); porCond.get(c.id).tits.push(t); }
  const gs = [...porCond.values()];
  // recompras descontadas no primeiro borderô
  const grupos = gs.map((g, i) => simGrupo(fu, g.cond, g.tits, dataOp, i === 0 ? recompras : 0));
  if (grupos.length <= 1) return { ...(grupos[0] || simGrupo(fu, condicaoDoFundo(fu), [], dataOp, recompras)), grupos };
  const soma = (k) => grupos.reduce((s, g) => s + g[k], 0);
  const face = soma('face'), custo = soma('custo');
  const fp = grupos.reduce((s, g) => s + g.prazo * g.face, 0), fpc = grupos.reduce((s, g) => s + g.prazoC * g.face, 0);
  const prazoC = face ? fpc / face : 0;
  const custos = ['ted', 'assinatura', 'boletos', 'consultas', 'novos'].reduce((o, k) => ({ ...o, [k]: grupos.reduce((s, g) => s + g.custos[k], 0) }), {});
  return { fu, cond: null, face, desagio: soma('desagio'), ad: soma('ad'), tar: soma('tar'), custos, iof: soma('iof'), custo, prazo: face ? fp / face : 0, prazoC,
    taxaEf: face && prazoC && face - custo ? custo / (face - custo) / prazoC * 30 : 0, liquido: soma('liquido'), itens: grupos.flatMap(g => g.itens), n: tits.length, grupos, tits };
}
const taxasTxt = (s) => (s.grupos?.length ? s.grupos.map(g => g.cond) : [condicaoDoFundo(s.fu)]).map(c => pct(+c.taxa_am / 100, 2)).join(' / ');

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
  if (ui.fundoId && !ativos.some(f => f.id === ui.fundoId)) ui.fundoId = '';
  const filt = titulos.filter(t => (!ui.busca || (sacadoDe(t) + ' ' + (t.documento || '')).toUpperCase().includes(ui.busca.toUpperCase()))
    && (() => { const d = ui.campoData === 'emissao' ? t.emissao : t.data; return (!ui.venDe || (d && d >= ui.venDe)) && (!ui.venAte || (d && d <= ui.venAte)); })() && (!ui.soSel || ui.sel.has(t.id)));
  const livres = filt.filter(t => !emProposta[t.id]);
  c.innerHTML = `<div id="semtit"></div>
    <div class="card"><div class="toolbar" id="flt-t">
      <label>Buscar cliente / NF<input name="busca" value="${esc(ui.busca)}" placeholder="nome ou número"></label>
      <label>Filtrar por<select name="campoData"><option value="emissao">Emissão da NF</option><option value="vencimento" ${ui.campoData === 'vencimento' ? 'selected' : ''}>Vencimento</option></select></label>
      <label>${ui.campoData === 'emissao' ? 'Emissão' : 'Vencimento'} de<input type="date" name="venDe" value="${ui.venDe}"></label>
      <label>até<input type="date" name="venAte" value="${ui.venAte}"></label>
      <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="soSel" ${ui.soSel ? 'checked' : ''}> Só os marcados</label>
      <span class="spacer"></span>
      <span class="muted small">${titulos.length} títulos em aberto · ${money0(titulos.reduce((s, t) => s + +t.valor, 0))}</span></div></div>
    <div class="grid2 prop-grid">
      <div class="card flush"><div class="card-head"><div><h2>Títulos disponíveis</h2><p class="muted small">Duplicatas em aberto (receita 1.01). Marque os títulos que vão para o borderô.</p></div>
        ${ed ? `<div class="toolbar"><button class="btn small" id="sel-todos">Marcar filtrados</button><button class="btn small" id="sel-nenhum">Limpar</button></div>` : ''}</div>
        <div class="table-wrap" style="max-height:560px">${filt.length ? `<table><thead><tr><th></th><th>Emissão</th><th>Vencimento</th><th class="num">Prazo</th><th>Cliente (sacado)</th><th>NF / parcela</th><th class="num">Valor</th></tr></thead><tbody>
          ${filt.map(t => { const ep = emProposta[t.id]; const pz = dias(ui.dataOp, t.data); return `<tr class="${ep ? 'muted' : 'clickable'}" data-id="${t.id}">
            <td>${ep ? `<span class="badge ${STATUS_CLS[ep.status]}" title="Já está na proposta nº ${ep.numero}">nº ${ep.numero}</span>` : `<input type="checkbox" ${ui.sel.has(t.id) ? 'checked' : ''} ${ed ? '' : 'disabled'} aria-label="Selecionar">`}</td>
            <td>${dateBR(t.emissao)}</td><td>${dateBR(t.data)}</td><td class="num${pz < 7 ? ' neg' : ''}">${pz}</td><td class="wrap">${esc(sacadoDe(t))}</td><td>${esc(t.documento || '')}</td><td class="num">${money(t.valor)}</td></tr>`; }).join('')}
          </tbody></table>` : `<div class="empty">${titulos.length ? 'Nenhum título no filtro.' : 'Nenhum título em aberto. Use “Importar XML das NFs”.'}</div>`}</div></div>
      <div id="painel"></div>
    </div>`;
  const f = $('#flt-t', c);
  f.addEventListener('change', (e) => { ui[e.target.name] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; abaTitulos(c, root); });
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
  // notas importadas (últimos 60 dias) que ainda não viraram título em aberto
  if (ed) notasSemTitulo(60).then(r => {
    const el = $('#semtit', c); if (!el || !r.parcelas) return;
    el.innerHTML = `<div class="card alert-row atencao" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><div><strong>${r.notas} nota(s) importada(s) ainda sem título a receber</strong> — ${r.parcelas} parcela(s), ${money0(r.valor)} (emissão ${dateBR(r.de)} a ${dateBR(r.ate)}). Lance as contas a receber para que entrem aqui.</div>
      <button class="btn primary" id="lanc-tit">Lançar contas a receber</button></div>`;
    $('#lanc-tit', el).onclick = () => gerarContasReceber({ de: r.de, ate: r.ate }, async () => { await carregar(); desenhar(root); });
  }).catch(() => {});
}

// título com o vencimento ajustado na proposta (o original fica em venc_orig)
const comVenc = (t) => ui.vencAj[t.id] && ui.vencAj[t.id] !== t.data ? { ...t, data: ui.vencAj[t.id], venc_orig: t.data } : t;

function painel(el, root) {
  const tits = titulos.filter(t => ui.sel.has(t.id)).map(comVenc);
  const ativos = fundos.filter(f => f.ativo);
  if (!tits.length) { el.innerHTML = `<div class="card"><h2>Nova proposta</h2><div class="empty">Marque os títulos ao lado para simular o borderô.</div>
    ${!ativos.length ? '<p class="small neg">Cadastre as condições dos fundos antes (aba “Condições dos fundos”).</p>' : ''}</div>`; return; }
  const sims = ativos.map(fu => simular(fu, tits, ui.dataOp, parseNum(ui.recompras) || 0));
  const S = sims.find(s => s.fu.id === ui.fundoId) || null; // o fundo é sempre escolhido pelo usuário
  const melhor = sims.slice().sort((a, b) => a.custo - b.custo)[0];
  // melhor fundo por título (distribuição ótima)
  let otimo = 0; const porFundoOt = {};
  for (const t of tits) {
    const best = ativos.map(fu => { const c = condTit(fu, t, ui.dataOp); return { fu, c: simular(fu, [t], ui.dataOp).desagio + t.valor * (+c.ad_valorem_pct || 0) / 100 + (+c.tarifa_titulo || 0) }; }).sort((a, b) => a.c - b.c)[0];
    otimo += best.c; porFundoOt[best.fu.nome] = (porFundoOt[best.fu.nome] || 0) + +t.valor;
  }
  const fixosOt = Object.keys(porFundoOt).reduce((s, n) => { const f = ativos.find(x => x.nome === n); return s + (+f.tarifa_operacao || 0) + (+f.custo_assinatura || 0); }, 0); otimo += fixosOt;
  const face = sims[0]?.face || 0;
  const ROT = { atencao: ['⚠', 'Atenção'], info: ['ℹ', 'Info'], ok: ['✓', 'OK'] };
  const comparacao = `<h3 style="margin-top:16px">Comparação entre fundos para estes títulos</h3>
    <div class="table-wrap"><table class="cmp-fundos"><thead><tr><th>Fundo</th><th class="num">Taxa cad.</th><th class="num">Deságio</th><th class="num">Tarifas / IOF</th><th class="num">Custo</th><th class="num">Líquido</th><th class="num">Taxa efetiva</th><th class="num">Dif. vs. + barato</th></tr></thead><tbody>
      ${sims.map(s => `<tr class="clickable ${S && s.fu.id === S.fu.id ? 'row-sel' : ''}" data-fu="${s.fu.id}" title="Usar ${esc(s.fu.nome)} nesta proposta"><td><strong>${esc(s.fu.nome)}</strong>${s.grupos.length > 1 ? ` <span class="badge aberto" title="Condições diferentes: vira ${s.grupos.length} borderôs">${s.grupos.length} borderôs</span>` : ''}</td><td class="num">${taxasTxt(s)}</td><td class="num">${money0(s.desagio)}</td><td class="num">${money0(s.ad + s.tar + s.iof)}</td><td class="num"><strong>${money0(s.custo)}</strong></td><td class="num">${money0(s.liquido)}</td><td class="num">${pct(s.taxaEf, 2)}</td><td class="num">${s === melhor ? '<span class="badge pago">menor custo</span>' : '+' + money0(s.custo - melhor.custo)}</td></tr>`).join('')}
    </tbody></table></div>
    ${Object.keys(porFundoOt).length > 1 && otimo < melhor.custo - 1 ? `<p class="small" style="margin:8px 0 0">💡 Dividindo os títulos entre fundos (cada título no mais barato) o custo seria <strong>${money0(otimo)}</strong>, ${money0(melhor.custo - otimo)} a menos: ${Object.entries(porFundoOt).map(([n, v]) => `${esc(n)} ${money0(v)}`).join(' · ')}.</p>` : ''}`;
  const escolha = `<div class="fundo-pick" id="fpick" role="radiogroup" aria-label="Fundo da operação">
      ${sims.map(s => `<button type="button" class="fundo-op${S && s.fu.id === S.fu.id ? ' on' : ''}" data-fu="${s.fu.id}" role="radio" aria-checked="${S && s.fu.id === S.fu.id}">
        <span class="fo-nome">${esc(s.fu.nome)}${s === melhor ? ' <span class="badge pago">menor custo</span>' : ''}</span>
        <span class="fo-num">${money0(s.custo)} <span class="muted small">custo · ${pct(s.taxaEf, 2)} a.m.</span></span></button>`).join('')}</div>`;
  const form = `<form id="pf" class="toolbar" style="margin-top:12px">
      <label>Data da operação<input type="date" name="dataOp" value="${ui.dataOp}"></label>
      <label>Recompras a descontar (R$)<input name="recompras" inputmode="decimal" value="${esc(ui.recompras)}" placeholder="0,00"></label>
    </form>`;
  const head = `<div class="card-head"><h2>Nova proposta${ui.propostaEdit ? ` — editando nº ${ui.propostaEdit.numero}` : ''}</h2><span class="muted small">${tits.length} títulos · ${money0(face)}</span></div>
    <h3 style="margin:4px 0 8px">Escolha o fundo (FIDC)</h3>${escolha}${form}`;
  if (!S) {
    el.innerHTML = `<div class="card">${head}
      <div class="empty" style="margin-top:12px">Escolha o fundo acima (ou clique numa linha da comparação) para ver a proposta, as verificações e enviar para aprovação.</div>
      ${comparacao}</div>`;
  } else {
    const chk = checagens(S, tits, ui.dataOp);
    const porSac = {}; for (const t of tits) { const k = sacadoDe(t); porSac[k] = (porSac[k] || 0) + +t.valor; }
    const sacOrd = Object.entries(porSac).sort((a, b) => b[1] - a[1]);
    const vencs = {}; for (const x of S.itens) { const k = x.prazo <= 30 ? 'até 30 dias' : x.prazo <= 45 ? '31 a 45' : x.prazo <= 60 ? '46 a 60' : x.prazo <= 90 ? '61 a 90' : 'acima de 90'; vencs[k] = (vencs[k] || 0) + +x.t.valor; }
    el.innerHTML = `<div class="card">${head}
    <div class="kpis" style="margin-top:12px">
      <div class="kpi"><div class="k-label">Valor de face</div><div class="k-value">${money0(S.face)}</div><div class="k-sub">${S.n} títulos · ${esc(S.fu.nome)}</div></div>
      <div class="kpi"><div class="k-label">Custo estimado</div><div class="k-value">${money0(S.custo)}</div><div class="k-sub">${pct(S.face ? S.custo / S.face : 0, 2)} da face${S !== melhor ? ` · +${money0(S.custo - melhor.custo)} vs. ${esc(melhor.fu.nome)}` : ''}</div></div>
      <div class="kpi"><div class="k-label">Líquido estimado</div><div class="k-value">${money0(S.liquido)}</div><div class="k-sub">crédito em ${esc(state.cad.contaById[S.fu.conta_credito_id]?.nome || '—')}</div></div>
      <div class="kpi"><div class="k-label">Taxa a.m.</div><div class="k-value">${pct(S.taxaEf, 2)}</div><div class="k-sub">prazo ${num1(S.prazo)} d · cobrado ${num1(S.prazoC)} d</div></div>
    </div>
    ${S.grupos.length > 1 ? `<div class="alert-row atencao" style="margin-top:10px"><span class="alert-tag">⚠ Atenção</span><div><strong>O ${esc(S.fu.nome)} não junta estas condições no mesmo borderô</strong>
      <div class="small muted">Os títulos serão enviados em ${S.grupos.length} propostas separadas, uma por condição (como o fundo opera):</div>
      <div class="table-wrap"><table class="small"><thead><tr><th>Condição</th><th class="num">Títulos</th><th class="num">Face</th><th class="num">Taxa</th><th class="num">Custo</th><th class="num">Líquido</th></tr></thead><tbody>
      ${S.grupos.map(g => `<tr><td>${esc(g.cond.nome)}${g.cond.fora_vigencia ? ' <span class="badge vencido">fora de vigência</span>' : ''}</td><td class="num">${g.n}</td><td class="num">${money0(g.face)}</td><td class="num">${pct(+g.cond.taxa_am / 100, 2)}</td><td class="num">${money0(g.custo)}</td><td class="num">${money0(g.liquido)}</td></tr>`).join('')}</tbody></table></div></div></div>`
      : `<p class="small muted" style="margin:8px 0 0">Condição: <strong>${esc(S.cond?.legado ? 'cadastro do fundo' : S.cond?.nome || '')}</strong>${S.cond && !S.cond.legado ? ` — ${pct(+S.cond.taxa_am / 100, 2)} a.m., vencimento + ${S.cond.dias_compensacao} dia(s)${S.cond.rola_dia_util ? ' (próximo dia útil)' : ''}` : ''}.${S.cond?.fora_vigencia ? ' <span class="neg">Condição fora de vigência — cadastre a do contrato atual.</span>' : ''}</p>`}
    <p class="small muted" style="margin:8px 0 0">Custos da operação no ${esc(S.fu.nome)}: ${S.grupos.length > 1 ? S.grupos.map(g => `${esc(g.cond.nome)}: ${descCustos(g.custos, g.cond, g.n)}`).join(' · ') : descCustos(S.custos, S.cond || S.fu, S.n)}.</p>
    ${comparacao}
    <h3 style="margin-top:16px">Verificações — ${esc(S.fu.nome)}</h3>
    <div class="alert-list">${chk.map(([st, t, d]) => `<div class="alert-row ${st}"><span class="alert-tag">${ROT[st][0]} ${ROT[st][1]}</span><div><strong>${esc(t)}</strong><div class="small muted">${esc(d)}</div></div></div>`).join('')}</div>
    <div class="grid2" style="margin-top:12px">
      <div><h3>Sacados na proposta</h3><div class="table-wrap"><table><tbody>${sacOrd.slice(0, 8).map(([k, v]) => `<tr><td class="wrap">${esc(k)}</td><td class="num">${money0(v)}</td><td class="num${v / S.face > .3 ? ' neg' : ''}">${pct(v / S.face)}</td></tr>`).join('')}${sacOrd.length > 8 ? `<tr class="muted"><td>Demais (${sacOrd.length - 8})</td><td class="num">${money0(sacOrd.slice(8).reduce((s, [, v]) => s + v, 0))}</td><td></td></tr>` : ''}</tbody></table></div></div>
      <div><h3>Prazos</h3><div class="table-wrap"><table><tbody>${['até 30 dias', '31 a 45', '46 a 60', '61 a 90', 'acima de 90'].filter(k => vencs[k]).map(k => `<tr><td>${k}</td><td class="num">${money0(vencs[k])}</td><td class="num">${pct(vencs[k] / S.face)}</td></tr>`).join('')}</tbody></table></div></div>
    </div>
    ${(() => { const rec = S.itens.filter(x => x.recesso); const ex = rec.reduce((s, x) => s + x.extraRec, 0); const r0 = rec[0]?.recesso;
      return rec.length ? `<div class="alert-row atencao" style="margin-top:12px"><span class="alert-tag">⚠ Recesso</span><div><strong>${rec.length} título(s) caem no recesso do ${esc(S.fu.nome)} (${dateBR(r0.de)} a ${dateBR(r0.ate)})</strong>
        <div class="small muted">São cobrados até ${dateBR(r0.cobra_ate || r0.ate)}: ${money(ex)} a mais de deságio. Ajuste o vencimento abaixo para simular outra data.</div></div></div>` : ''; })()}
    <h3 style="margin-top:16px">Títulos e vencimentos</h3>
    <div class="toolbar" style="padding:0;margin-bottom:6px"><label>Vencimento para todos<input type="date" id="v-todos"></label><button class="btn small" id="v-aplica">Aplicar</button>
      ${Object.keys(ui.vencAj).some(id => ui.sel.has(id)) ? '<button class="btn small" id="v-volta">Voltar os vencimentos das notas</button>' : ''}
      <span class="muted small">O vencimento ajustado vale para a simulação e vai para a carteira do fundo na aprovação; a nota não muda.</span></div>
    <div class="table-wrap" style="max-height:320px"><table class="small" id="v-tab"><thead><tr><th>NF / parcela</th><th>Sacado</th><th>Condição</th><th>Vencimento</th><th class="num">Prazo</th><th>Cobrado até</th><th class="num">Valor</th><th class="num">Deságio</th></tr></thead><tbody>
      ${S.itens.slice().sort((a, b) => a.t.data.localeCompare(b.t.data) || String(a.t.documento).localeCompare(String(b.t.documento))).map(x => `<tr data-vid="${x.t.id}"><td>${esc(x.t.documento || '')}</td><td class="wrap">${esc(sacadoDe(x.t))}</td><td class="small">${esc(x.cond.legado ? '—' : x.cond.nome)}</td>
        <td><input type="date" data-venc value="${x.t.data}" style="width:140px">${x.t.venc_orig ? `<div class="muted">nota: ${dateBR(x.t.venc_orig)}</div>` : ''}</td><td class="num">${x.prazo}</td>
        <td>${dateBR(x.cobradoAte)}${x.recesso ? ' <span class="badge vencido">recesso</span>' : ''}</td><td class="num">${money(x.t.valor)}</td><td class="num">${money(x.custo)}</td></tr>`).join('')}</tbody></table></div>
    <label class="span2" style="margin-top:12px">Observação para o diretor<textarea id="obs" rows="2">${esc(ui.obs)}</textarea></label>
    <div class="toolbar" style="margin-top:12px;justify-content:flex-end">
      ${ui.propostaEdit ? '<button class="btn" id="cancel-ed">Cancelar edição</button>' : ''}
      <button class="btn" id="salvar">Salvar rascunho${S.grupos.length > 1 ? `s (${S.grupos.length})` : ''}</button><button class="btn primary" id="enviar">Enviar ${S.grupos.length > 1 ? `${S.grupos.length} propostas` : 'para aprovação'} — ${esc(S.fu.nome)}</button></div>
  </div>`;
    $('#salvar', el).onclick = () => salvarProposta(root, S, tits, chk, sims, 'Rascunho');
    $('#enviar', el).onclick = () => salvarProposta(root, S, tits, chk, sims, 'Pendente');
  }
  const escolher = (e) => { const b = e.target.closest('[data-fu]'); if (!b) return; ui.fundoId = b.dataset.fu; painel(el, root); };
  $('#fpick', el).onclick = escolher;
  $('table.cmp-fundos', el).onclick = escolher;
  $('#pf', el).addEventListener('change', (e) => { ui[e.target.name] = e.target.value; if (e.target.name === 'dataOp') return abaTitulos($('#corpo', root), root); painel(el, root); });
  if (!S) return;
  $('#obs', el).oninput = (e) => { ui.obs = e.target.value; };
  const origDe = (id) => titulos.find(t => t.id === id)?.data;
  $('#v-tab', el).addEventListener('change', (e) => { const tr = e.target.closest('tr[data-vid]'); if (!tr || !e.target.matches('[data-venc]') || !e.target.value) return;
    const id = tr.dataset.vid; if (e.target.value === origDe(id)) delete ui.vencAj[id]; else ui.vencAj[id] = e.target.value; painel(el, root); });
  $('#v-aplica', el).onclick = () => { const v = $('#v-todos', el).value; if (!v) return toast('Escolha a data', true); for (const id of ui.sel) { if (v === origDe(id)) delete ui.vencAj[id]; else ui.vencAj[id] = v; } painel(el, root); };
  $('#v-volta', el) && ($('#v-volta', el).onclick = () => { for (const id of ui.sel) delete ui.vencAj[id]; painel(el, root); });
  $('#cancel-ed', el) && ($('#cancel-ed', el).onclick = () => { ui.propostaEdit = null; ui.sel.clear(); abaTitulos($('#corpo', root), root); });
}

async function salvarProposta(root, S, tits, chk, sims, status) {
  const gs = S.grupos?.length ? S.grupos : [S];
  if (gs.length > 1 && ui.propostaEdit) return toast(`Na edição a proposta nº ${ui.propostaEdit.numero} não pode virar ${gs.length}: deixe só títulos de uma condição`, true);
  if (status === 'Pendente' && !confirm(gs.length > 1
    ? `Enviar ${gs.length} propostas (${S.fu.nome}: ${gs.map(g => `${g.cond.nome} ${g.n} títulos ${money0(g.face)}`).join(' · ')}) para aprovação do diretor?`
    : `Enviar a proposta (${S.fu.nome}, ${tits.length} títulos, ${money0(S.face)}) para aprovação do diretor?`)) return;
  const feitas = [];
  try {
    for (const g of gs) feitas.push(await gravarProposta(g, chk, sims, status));
  } catch (err) { fail(err); if (!feitas.length) return; }
  toast(status === 'Pendente' ? `Proposta${feitas.length > 1 ? 's' : ''} nº ${feitas.map(p => p.numero).join(', ')} enviada${feitas.length > 1 ? 's' : ''} para aprovação` : `Rascunho${feitas.length > 1 ? 's' : ''} nº ${feitas.map(p => p.numero).join(', ')} salvo${feitas.length > 1 ? 's' : ''}`);
  ui.sel.clear(); ui.vencAj = {}; ui.soSel = false; ui.fundoId = ''; ui.obs = ''; ui.recompras = ''; ui.propostaEdit = null; ui.aba = 'propostas';
  render(root);
}

async function gravarProposta(S, chk, sims, status) {
  const e = state.empresa.id; const cd = S.cond || condicaoDoFundo(S.fu);
  const row = { empresa_id: e, fundo_id: S.fu.id, data_operacao: ui.dataOp, status, qtd_titulos: S.n, valor_face: +S.face.toFixed(2),
    prazo_medio: +S.prazo.toFixed(2), prazo_cobrado: +S.prazoC.toFixed(2), taxa_am: +(S.taxaEf * 100).toFixed(4), desagio: +S.desagio.toFixed(2), ad_valorem: +S.ad.toFixed(2),
    tarifas: +S.tar.toFixed(2), iof: +S.iof.toFixed(2), recompras: +(S.face - S.custo - S.liquido).toFixed(2), liquido: +S.liquido.toFixed(2), conta_credito_id: S.fu.conta_credito_id,
    observacao: ui.obs || null, enviado_em: status === 'Pendente' ? new Date().toISOString() : null,
    analise: { checagens: chk, comparacao: sims.map(s => ({ fundo: s.fu.nome, taxa_cad: +s.fu.taxa_am, custo: +s.custo.toFixed(2), liquido: +s.liquido.toFixed(2), taxa: +(s.taxaEf * 100).toFixed(4) })),
      custos: Object.fromEntries(Object.entries(S.custos).map(([k, v]) => [k, +(+v).toFixed(2)])),
      condicoes: { nome: cd.legado ? null : cd.nome, taxa_am: +cd.taxa_am, ad_valorem_pct: +cd.ad_valorem_pct, tarifa_operacao: +cd.tarifa_operacao, custo_assinatura: +cd.custo_assinatura, tarifa_titulo: +cd.tarifa_titulo, custo_consulta: +cd.custo_consulta, iof_pct: +cd.iof_pct, dias_compensacao: cd.dias_compensacao, rola_dia_util: !!cd.rola_dia_util, metodo_desagio: cd.metodo_desagio || 'fator' } } };
  if (!cd.legado) row.condicao_id = cd.id;
  {
    let p;
    if (ui.propostaEdit) {
      p = await q(sb.from('fidc_propostas').update(row).eq('id', ui.propostaEdit.id).select().single());
      await q(sb.from('fidc_proposta_itens').delete().eq('proposta_id', p.id));
    } else p = await q(sb.from('fidc_propostas').insert(row).select().single());
    const itens = S.itens.map(x => ({ proposta_id: p.id, empresa_id: e, lancamento_id: x.t.id, documento: x.t.documento, sacado: sacadoDe(x.t), cnpj: cnpjDe(x.t) || null,
      emissao: x.t.emissao, vencimento: x.t.data, valor: x.t.valor, prazo: x.prazo, custo_estimado: +x.custo.toFixed(2), ...(x.t.venc_orig ? { vencimento_original: x.t.venc_orig } : {}) }));
    for (let i = 0; i < itens.length; i += 500) await q(sb.from('fidc_proposta_itens').insert(itens.slice(i, i + 500)));
    return p;
  }
}

// ======================================================================
// Aba: propostas (lista, detalhe, aprovação)
// ======================================================================
function abaPropostas(c, root) {
  const fuById = Object.fromEntries(fundos.map(f => [f.id, f]));
  const pend = propostas.filter(p => p.status === 'Pendente');
  const f = ui.pf;
  const meses = [...new Set(propostas.map(p => p.data_operacao.slice(0, 7)))].sort().reverse();
  const bord = (p) => p.comparativo?.bordero || '';
  const L = propostas.filter(p => (!f.status || p.status === f.status) && (!f.fundo || p.fundo_id === f.fundo) && (!f.mes || p.data_operacao.startsWith(f.mes))
    && (!f.busca || `${p.numero} ${bord(p)} ${p.observacao || ''}`.toLowerCase().includes(f.busca.toLowerCase())))
    .sort((a, b) => (a.status === 'Pendente' ? 0 : 1) - (b.status === 'Pendente' ? 0 : 1) || b.data_operacao.localeCompare(a.data_operacao) || b.numero - a.numero);
  const S = (k) => L.reduce((s, p) => s + (+p[k] || 0), 0);
  const MES = (m) => `${MESES_CURTO[+m.slice(5) - 1]}/${m.slice(0, 4)}`;
  c.innerHTML = `${ehDiretor() && pend.length ? `<div class="card alert-row atencao" style="display:block"><strong>${pend.length} proposta(s) aguardando sua aprovação</strong> — ${money0(pend.reduce((s, p) => s + +p.valor_face, 0))} em títulos.</div>` : ''}
    <div class="card"><div class="toolbar" id="pf">
      <label>Status<select name="status"><option value="">Todos</option>${['Pendente', 'Aprovada', 'Rascunho', 'Rejeitada', 'Cancelada'].map(s => `<option ${f.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label>Fundo<select name="fundo"><option value="">Todos</option>${fundos.map(x => `<option value="${x.id}" ${f.fundo === x.id ? 'selected' : ''}>${esc(x.nome)}</option>`).join('')}</select></label>
      <label>Mês<select name="mes"><option value="">Todos</option>${meses.map(m => `<option value="${m}" ${f.mes === m ? 'selected' : ''}>${MES(m)}</option>`).join('')}</select></label>
      <label class="grow">Buscar<input name="busca" value="${esc(f.busca)}" placeholder="nº da proposta ou do borderô"></label>
      <button class="btn" id="exp-prop">Exportar Excel</button></div>
      <div class="kpis" style="margin:12px 0 0">
        <div class="kpi"><div class="k-label">Propostas</div><div class="k-value">${L.length}</div><div class="k-sub">${L.filter(p => p.status === 'Pendente').length} pendente(s) · ${L.filter(p => p.status === 'Aprovada').length} aprovada(s)</div></div>
        <div class="kpi"><div class="k-label">Valor de face</div><div class="k-value">${money0(S('valor_face'))}</div><div class="k-sub">${S('qtd_titulos')} títulos</div></div>
        <div class="kpi"><div class="k-label">Custo</div><div class="k-value">${money0(S('custo_total'))}</div><div class="k-sub">${S('valor_face') ? pct(S('custo_total') / S('valor_face'), 2) : '—'} da face</div></div>
        <div class="kpi"><div class="k-label">Líquido</div><div class="k-value">${money0(S('liquido'))}</div><div class="k-sub">${S('recompras') ? `recompras ${money0(S('recompras'))}` : '&nbsp;'}</div></div></div></div>
    <div class="card flush"><div class="card-head"><h2>Propostas de borderô</h2><span class="muted small">Clique para ver os títulos, as notas e os recebimentos${ehDiretor() ? ' e aprovar' : ''}. Borderôs que vieram da base FIDC têm a marca <span class="badge">base FIDC</span>.</span></div>
    <div class="table-wrap" style="max-height:62vh">${L.length ? `<table id="tprop"><thead><tr><th>Nº</th><th>Status</th><th>Fundo</th><th>Borderô</th><th>Data op.</th><th class="num">Títulos</th><th class="num">Face</th><th class="num">Custo</th><th class="num">Líquido</th><th class="num">Taxa a.m.</th><th class="num">Prazo</th></tr></thead><tbody>
      ${L.map(p => `<tr class="clickable" data-id="${p.id}"><td>${p.numero}</td><td><span class="badge ${STATUS_CLS[p.status]}">${p.status}</span></td><td>${esc(fuById[p.fundo_id]?.nome || '')}</td>
        <td>${p.origem === 'base_fidc' ? `${esc(bord(p))} <span class="badge">base FIDC</span>` : p.comparativo ? `<span class="badge ${p.comparativo.recusados || p.comparativo.extras || p.comparativo.divergentes ? 'aberto' : 'pago'}">nº ${esc(bord(p))}</span>` : p.status === 'Aprovada' ? '<span class="muted small">a comparar</span>' : ''}</td>
        <td>${dateBR(p.data_operacao)}</td><td class="num">${p.qtd_titulos}</td><td class="num">${money0(p.valor_face)}</td><td class="num">${money0(p.custo_total)}</td><td class="num">${money0(p.liquido)}</td><td class="num">${pct(p.taxa_am / 100, 2)}</td><td class="num">${num1(p.prazo_medio)} d</td></tr>`).join('')}
      <tr style="font-weight:600"><td colspan="5">Total</td><td class="num">${S('qtd_titulos')}</td><td class="num">${money0(S('valor_face'))}</td><td class="num">${money0(S('custo_total'))}</td><td class="num">${money0(S('liquido'))}</td><td colspan="2"></td></tr></tbody></table>` : '<div class="empty">Nenhuma proposta com esses filtros.</div>'}</div></div>`;
  $('#pf', c).onchange = (e) => { if (e.target.name && e.target.name !== 'busca') { f[e.target.name] = e.target.value; abaPropostas(c, root); } };
  let tb; $('#pf [name=busca]', c).oninput = (e) => { clearTimeout(tb); tb = setTimeout(() => { f.busca = e.target.value; abaPropostas(c, root); const i = $('#pf [name=busca]', c); i.focus(); i.setSelectionRange?.(i.value.length, i.value.length); }, 350); };
  $('#exp-prop', c).onclick = () => exportXLSX($('#tprop', c), 'propostas_bordero');
  $('#tprop', c)?.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) detalhe(propostas.find(p => p.id === tr.dataset.id), root); });
}

async function detalhe(p, root) {
  const fu = fundos.find(f => f.id === p.fundo_id) || {};
  let itens = [];
  const base = p.origem === 'base_fidc';
  try {
    itens = await q(sb.from('fidc_proposta_itens').select('*').eq('proposta_id', p.id).order('vencimento'));
    if (base) {
      const tIds = itens.map(i => i.fidc_titulo_id).filter(Boolean), lIds = itens.map(i => i.lancamento_id).filter(Boolean);
      const nv = tIds.length ? await q(sb.from('nfe_fidc_vinculos').select('fidc_titulo_id,nota_id,parcela_id,n:nfe_notas(numero,dest_nome)').in('fidc_titulo_id', tIds)) : [];
      const ls = lIds.length ? await q(sb.from('lancamentos').select('id,data,valor,status,conta_id,descricao').in('id', lIds)) : [];
      const pIds = nv.map(v => v.parcela_id).filter(Boolean);
      const rc = pIds.length ? await q(sb.from('nfe_vinculos').select('parcela_id,l:lancamentos(data,valor,conta_id)').in('parcela_id', pIds)) : [];
      for (const i of itens) { i.nf = nv.find(v => v.fidc_titulo_id === i.fidc_titulo_id); i.lanc = ls.find(l => l.id === i.lancamento_id); i.rec = i.nf ? rc.filter(r => r.parcela_id === i.nf.parcela_id) : []; }
    }
  } catch (e) { return fail(e); }
  const an = p.analise || {}; const ROT = { atencao: ['⚠', 'Atenção'], info: ['ℹ', 'Info'], ok: ['✓', 'OK'] };
  const ed = podeEditar();
  const acoes = [];
  if (ehDiretor() && p.status === 'Pendente') acoes.push('<button class="btn danger" id="rej">Rejeitar</button>', '<button class="btn primary" id="apr">Aprovar operação</button>');
  if (ed && !base && ['Rascunho', 'Rejeitada'].includes(p.status)) acoes.push('<button class="btn" id="edit">Editar</button>', '<button class="btn danger" id="del">Excluir</button>');
  if (ed && p.status === 'Rascunho') acoes.push('<button class="btn primary" id="env">Enviar para aprovação</button>');
  if (ed && !base && p.status === 'Pendente') acoes.push('<button class="btn" id="canc">Cancelar envio</button>');
  const semLanc = base ? itens.filter(i => !i.lancamento_id).length : 0;
  const m = modal({
    title: `Proposta nº ${p.numero} — ${fu.nome || ''}`, wide: true,
    body: `<p style="margin:0 0 10px"><span class="badge ${STATUS_CLS[p.status]}">${p.status}</span>
        <span class="muted small">criada em ${dateBR(p.criado_em.slice(0, 10))}${p.enviado_em ? ' · enviada em ' + dateBR(p.enviado_em.slice(0, 10)) : ''}${p.aprovado_em ? ` · ${p.status === 'Aprovada' ? 'aprovada' : 'decidida'} em ${dateBR(p.aprovado_em.slice(0, 10))}` : ''}</span></p>
      ${base ? `<p class="small" style="margin-top:0">Borderô <strong>${esc(p.comparativo?.bordero || '')}</strong> do ${esc(fu.nome || '')} registrado na base FIDC — valores reais do borderô.${p.status === 'Pendente' ? (semLanc ? ` <span class="neg">${semLanc} título(s) ainda não estão lançados em aberto: importe os XML das NFs antes de aprovar (a aprovação liga os títulos sozinha).</span>` : ' Títulos ligados aos lançamentos em aberto.') : ''}</p>` : ''}
      ${p.motivo ? `<p class="small"><strong>Motivo / comentário do diretor:</strong> ${esc(p.motivo)}</p>` : ''}
      <div class="kpis">
        <div class="kpi"><div class="k-label">Valor de face</div><div class="k-value">${money0(p.valor_face)}</div><div class="k-sub">${p.qtd_titulos} títulos · operação ${dateBR(p.data_operacao)}</div></div>
        <div class="kpi"><div class="k-label">${base ? 'Custo do borderô' : 'Custo estimado'}</div><div class="k-value">${money0(p.custo_total)}</div><div class="k-sub">deságio ${money0(p.desagio)} · tarifas/IOF ${money0(+p.tarifas + +p.iof + +p.ad_valorem)}</div></div>
        <div class="kpi"><div class="k-label">${base ? 'Líquido' : 'Líquido estimado'}</div><div class="k-value">${money0(p.liquido)}</div><div class="k-sub">${p.recompras > 0 ? `recompras ${money0(p.recompras)} · ` : ''}crédito em ${esc(state.cad.contaById[p.conta_credito_id]?.nome || '—')}</div></div>
        <div class="kpi"><div class="k-label">Taxa a.m.</div><div class="k-value">${pct(p.taxa_am / 100, 2)}</div><div class="k-sub">prazo ${num1(p.prazo_medio)} d · cobrado ${num1(p.prazo_cobrado)} d</div></div>
      </div>
      ${an.custos ? `<p class="small" style="margin-top:10px"><strong>Custos da operação:</strong> ${descCustos(an.custos, an.condicoes, p.qtd_titulos)}${+p.ad_valorem ? ` · ad valorem ${money(p.ad_valorem)}` : ''}${+p.iof ? ` · IOF ${money(p.iof)}` : ''}.</p>` : ''}
      ${p.observacao ? `<p class="small" style="margin-top:10px"><strong>Observação:</strong> ${esc(p.observacao)}</p>` : ''}
      ${an.comparacao ? `<h3 style="margin-top:14px">Comparação entre fundos (no envio)</h3><div class="table-wrap"><table><thead><tr><th>Fundo</th><th class="num">Custo</th><th class="num">Líquido</th><th class="num">Taxa a.m.</th></tr></thead><tbody>
        ${an.comparacao.slice().sort((a, b) => a.custo - b.custo).map(x => `<tr class="${x.fundo === fu.nome ? 'row-sel' : ''}"><td>${esc(x.fundo)}</td><td class="num">${money0(x.custo)}</td><td class="num">${money0(x.liquido)}</td><td class="num">${pct(x.taxa / 100, 2)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${an.checagens ? `<h3 style="margin-top:14px">Verificações</h3><div class="alert-list">${an.checagens.map(([st, t, d]) => `<div class="alert-row ${st}"><span class="alert-tag">${ROT[st][0]} ${ROT[st][1]}</span><div><strong>${esc(t)}</strong><div class="small muted">${esc(d)}</div></div></div>`).join('')}</div>` : ''}
      ${p.comparativo && !base ? blocoComparativo(p.comparativo) : ''}
      <h3 style="margin-top:14px">Títulos (${itens.length})</h3>
      ${base ? `<div class="table-wrap" style="max-height:340px"><table id="titp"><thead><tr><th>Título</th><th>Sacado</th><th>Vencimento</th><th class="num">Prazo</th><th class="num">Valor</th><th>NF / cliente</th><th>Lançamento do título</th><th>Recebimento vinculado à nota</th></tr></thead><tbody>
        ${itens.map(i => `<tr><td>${esc(i.documento || '')}</td><td class="wrap small">${esc(i.sacado || '')}</td><td>${dateBR(i.vencimento)}</td><td class="num">${i.prazo ?? ''}</td><td class="num">${money(i.valor)}</td>
          <td class="small">${i.nf ? `NF ${i.nf.n?.numero ?? ''} · ${esc(i.nf.n?.dest_nome || '')}` : '<span class="muted">nota não importada</span>'}</td>
          <td class="small">${i.lanc ? `<span class="badge ${i.lanc.status === 'Pago' ? 'pago' : 'aberto'}">${esc(i.lanc.status)}</span> ${dateBR(i.lanc.data)} · ${esc(state.cad.contaById[i.lanc.conta_id]?.nome || '—')}` : '<span class="muted">—</span>'}</td>
          <td class="small">${i.rec.map(r => `${dateBR(r.l?.data)} · ${money(r.l?.valor)} · ${esc(state.cad.contaById[r.l?.conta_id]?.nome || '—')}`).join('<br>') || '<span class="muted">—</span>'}</td></tr>`).join('')}
        <tr style="font-weight:600"><td colspan="4">Total</td><td class="num">${money(itens.reduce((s, i) => s + +i.valor, 0))}</td><td colspan="3"></td></tr></tbody></table></div>` : `<div class="table-wrap" style="max-height:300px"><table><thead><tr><th>Vencimento</th><th class="num">Prazo</th><th>Sacado</th><th>NF / parcela</th><th class="num">Valor</th><th class="num">Custo est.</th>${p.comparativo ? '<th>No borderô</th>' : ''}</tr></thead><tbody>
        ${itens.map(i => `<tr><td>${dateBR(i.vencimento)}</td><td class="num">${i.prazo ?? ''}</td><td class="wrap">${esc(i.sacado || '')}</td><td>${esc(i.documento || '')}</td><td class="num">${money(i.valor)}</td><td class="num">${money(i.custo_estimado)}</td>${p.comparativo ? `<td>${esc(i.situacao_bordero || '')}</td>` : ''}</tr>`).join('')}</tbody></table></div>`}`,
    foot: `<button class="btn" id="pdfp" style="margin-right:auto">PDF para aprovação</button>${base ? '<button class="btn" id="expi">Exportar Excel</button>' : ''}${p.status === 'Aprovada' && ed && !base ? '<button class="btn" id="cmpb">Comparar com borderô original</button>' : ''}${ed && ['Pendente', 'Aprovada'].includes(p.status) ? '<button class="btn" id="dupl">Duplicatas para endosso</button>' : ''}${acoes.join('')}<button class="btn" data-close>Fechar</button>`,
  });
  const act = async (fn, msg) => { try { await fn(); toast(msg); m.close(); await carregar(); desenhar(root); } catch (e) { fail(e); } };
  $('#pdfp', m.el).onclick = () => pdfProposta(p, fu, itens);
  $('#expi', m.el) && ($('#expi', m.el).onclick = () => exportXLSX($('#titp', m.el), `bordero_${fu.nome}_${p.comparativo?.bordero || p.numero}`));
  $('#apr', m.el) && ($('#apr', m.el).onclick = () => { const c = prompt(base ? `Aprovar o borderô ${p.comparativo?.bordero || ''} (proposta nº ${p.numero})?\nOs ${p.qtd_titulos} títulos passam a pagos na conta ${state.cad.contaById[fu.conta_id]?.nome || fu.nome} em ${dateBR(p.data_operacao)} e são lançados o deságio, as tarifas e o crédito do líquido com os valores reais do borderô.\n\nComentário (opcional):` : `Aprovar a proposta nº ${p.numero}?\nOs ${p.qtd_titulos} títulos passam a pagos na conta ${state.cad.contaById[fu.conta_id]?.nome || fu.nome} em ${dateBR(p.data_operacao)}, são lançados deságio, tarifas e o crédito do líquido, e a operação entra na Análise FIDC como borderô P${p.numero}.\n\nComentário (opcional):`, ''); if (c === null) return;
    act(() => q(sb.rpc('decidir_proposta_fidc', { p_id: p.id, p_aprovar: true, p_motivo: c || null })), `Proposta nº ${p.numero} aprovada`); });
  $('#rej', m.el) && ($('#rej', m.el).onclick = () => { const c = prompt('Motivo da rejeição:', ''); if (c === null) return;
    act(() => q(sb.rpc('decidir_proposta_fidc', { p_id: p.id, p_aprovar: false, p_motivo: c || null })), `Proposta nº ${p.numero} rejeitada`); });
  $('#env', m.el) && ($('#env', m.el).onclick = () => act(() => q(sb.from('fidc_propostas').update({ status: 'Pendente', enviado_em: new Date().toISOString() }).eq('id', p.id)), 'Enviada para aprovação'));
  $('#canc', m.el) && ($('#canc', m.el).onclick = () => { if (confirm('Cancelar o envio? A proposta volta a rascunho.')) act(() => q(sb.from('fidc_propostas').update({ status: 'Rascunho', enviado_em: null }).eq('id', p.id)), 'Envio cancelado'); });
  $('#del', m.el) && ($('#del', m.el).onclick = () => { if (confirm(`Excluir a proposta nº ${p.numero}?`)) act(() => q(sb.from('fidc_propostas').delete().eq('id', p.id)), 'Proposta excluída'); });
  $('#edit', m.el) && ($('#edit', m.el).onclick = () => {
    ui.propostaEdit = p; ui.sel = new Set(itens.map(i => i.lancamento_id).filter(Boolean)); ui.fundoId = p.fundo_id; ui.dataOp = p.data_operacao;
    ui.vencAj = Object.fromEntries(itens.filter(i => i.lancamento_id && i.vencimento_original && i.vencimento !== i.vencimento_original).map(i => [i.lancamento_id, i.vencimento]));
    ui.recompras = p.recompras ? String(p.recompras).replace('.', ',') : ''; ui.obs = p.observacao || ''; ui.aba = 'titulos';
    for (const id of ui.sel) delete emProposta[id];
    m.close(); render(root);
  });
  $('#dupl', m.el) && ($('#dupl', m.el).onclick = () => { m.close(); state.duplicataProp = p.id; location.hash = '#/duplicatas'; });
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
  c.innerHTML = `<div class="card flush"><div class="card-head"><div><h2>Condições dos fundos</h2><p class="muted small">Usadas para simular as propostas. Os valores iniciais vieram da média dos borderôs de jul–set/2026; ajuste conforme o contrato de cada fundo. Prazo cobrado = prazo real + dias de compensação. FS conferida com o borderô 001226 (06/10): 2,46% a.m. em juros simples sobre a face, prazo + 3 dias. Assinatura, boletos e consultas Serasa entram no custo do borderô (FS e Negocial conferidos com os borderôs de set/2026); a consulta só é cobrada para sacado que ainda não teve título no fundo.</p></div>
    ${ed ? '<button class="btn" id="novo-f">+ Fundo</button>' : ''}</div>
    <div class="table-wrap"><table><thead><tr><th>Fundo</th><th>Conta do fundo</th><th>Crédito do líquido</th>${campos.map(([, n]) => `<th class="num">${n}</th>`).join('')}<th>Deságio</th><th>Ativo</th></tr></thead><tbody>
      ${fundos.map(f => `<tr class="${ed ? 'clickable' : ''}" data-id="${f.id}"><td><strong>${esc(f.nome)}</strong>${(f.recessos || []).map(r => `<div class="muted small">recesso ${dateBR(r.de)}–${dateBR(r.ate)}</div>`).join('')}</td><td>${esc(state.cad.contaById[f.conta_id]?.nome || '—')}</td><td>${esc(state.cad.contaById[f.conta_credito_id]?.nome || '—')}</td>
        ${campos.map(([k]) => `<td class="num">${f[k] == null ? '–' : ['tarifa_operacao', 'custo_assinatura', 'tarifa_titulo', 'custo_consulta', 'limite_credito'].includes(k) ? money(f[k]) : String(f[k]).replace('.', ',')}</td>`).join('')}<td class="small">${f.metodo_desagio === 'simples' ? 'juros simples' : 'por dentro'}</td><td>${f.ativo ? 'sim' : 'não'}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  blocoCondicoes(c, root);
  if (!ed) return;
  const editar = (f) => {
    const m = modal({
      title: f.id ? `Condições — ${f.nome}` : 'Novo fundo', wide: true,
      body: `<form id="ff" class="grid-form">
        <label>Nome (igual ao dos borderôs)<input name="nome" value="${esc(f.nome || '')}" required></label>
        <label>Conta do fundo<select name="conta_id">${options(state.cad.contas, { empty: '—', selected: f.conta_id })}</select></label>
        <label>Conta de crédito do líquido<select name="conta_credito_id">${options(state.cad.contas, { empty: '—', selected: f.conta_credito_id })}</select></label>
        ${campos.map(([k, n]) => `<label>${n}<input name="${k}" inputmode="decimal" value="${f[k] == null ? '' : String(f[k]).replace('.', ',')}"></label>`).join('')}
        <label>Cálculo do deságio<select name="metodo_desagio"><option value="fator" ${f.metodo_desagio !== 'simples' ? 'selected' : ''}>Por dentro — v·k/(1+k)</option><option value="simples" ${f.metodo_desagio === 'simples' ? 'selected' : ''}>Juros simples sobre a face — v × taxa × dias/30</option></select></label>
        <label>Ativo<select name="ativo"><option value="1" ${f.ativo !== false ? 'selected' : ''}>sim</option><option value="0" ${f.ativo === false ? 'selected' : ''}>não</option></select></label>
        <label class="span2">Recessos — períodos sem expediente do fundo, um por linha: "20/12/2026 a 07/01/2027" (cobra até o último dia; para outra data, acrescente "cobra 08/01/2027")
          <textarea name="recessos" rows="2">${esc((f.recessos || []).map(r => `${dateBR(r.de)} a ${dateBR(r.ate)}${r.cobra_ate && r.cobra_ate !== r.ate ? ` cobra ${dateBR(r.cobra_ate)}` : ''}`).join('\n'))}</textarea></label>
        <label class="span2">Observação<input name="observacao" value="${esc(f.observacao || '')}"></label></form>`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="fs">Salvar</button>',
    });
    $('#fs', m.el).onclick = async () => {
      const form = $('#ff', m.el); if (!form.reportValidity()) return; const d = formData(form);
      const row = { empresa_id: state.empresa.id, nome: d.nome.trim(), conta_id: d.conta_id || null, conta_credito_id: d.conta_credito_id || null, ativo: d.ativo === '1', metodo_desagio: d.metodo_desagio || 'fator', observacao: d.observacao || null, updated_at: new Date().toISOString() };
      for (const [k] of campos) { const v = String(d[k] ?? '').trim(); row[k] = v === '' ? (['prazo_min', 'prazo_max', 'limite_credito', 'limite_sacado_pct'].includes(k) ? null : 0) : parseNum(v); }
      const iso = (x) => { const m = String(x || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
      const recs = String(d.recessos || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const ds = [...l.matchAll(/\d{2}\/\d{2}\/\d{4}/g)].map(m => iso(m[0])); return ds.length >= 2 ? { de: ds[0], ate: ds[1], ...(ds[2] ? { cobra_ate: ds[2] } : {}) } : null; });
      if (recs.some(r => !r || r.de > r.ate)) return toast('Recesso: use "dd/mm/aaaa a dd/mm/aaaa" em cada linha', true);
      if (recs.length || (f.recessos || []).length) row.recessos = recs;
      try { if (f.id) await q(sb.from('fidc_fundos').update(row).eq('id', f.id)); else await q(sb.from('fidc_fundos').insert(row)); toast('Condições salvas'); m.close(); await carregar(); desenhar(root); } catch (e) { fail(e); }
    };
  };
  $('table', c).onclick = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) editar(fundos.find(f => f.id === tr.dataset.id)); };
  $('#novo-f', c).onclick = () => editar({ ativo: true });
}

// Condições por grupo de sacados (SQL 050): uma taxa para um grupo (CNPJ raiz) e outra para os demais; cada uma vira seu borderô
const fmtRaiz = (r) => r.length === 8 ? `${r.slice(0, 2)}.${r.slice(2, 5)}.${r.slice(5, 8)}` : r;
function blocoCondicoes(c, root) {
  const ed = podeEditar();
  const fuNome = (id) => fundos.find(f => f.id === id)?.nome || '—';
  const el = document.createElement('div'); el.className = 'card flush'; el.style.marginTop = '12px';
  const L = condicoes.slice().sort((a, b) => fuNome(a.fundo_id).localeCompare(fuNome(b.fundo_id)) || (a.sacados_raiz?.length ? 0 : 1) - (b.sacados_raiz?.length ? 0 : 1) || String(a.vigencia_ini || '').localeCompare(String(b.vigencia_ini || '')));
  el.innerHTML = `<div class="card-head"><div><h2>Condições por grupo de sacados</h2><p class="muted small">Quando o fundo cobra taxas diferentes por sacado (ex.: FS — Grupo Total × demais). Cada título usa a condição do seu sacado (CNPJ raiz); sem grupo informado = demais sacados.
      Títulos de condições diferentes nunca vão no mesmo borderô: a proposta é dividida em uma por condição. Prazo cobrado = vencimento + dias, rolando para o próximo dia útil (feriados nacionais). Fundo sem condição cadastrada usa a linha do fundo acima.</p></div>
    ${ed ? '<button class="btn" id="nova-cond">+ Condição</button>' : ''}</div>
    <div class="table-wrap">${L.length ? `<table><thead><tr><th>Fundo</th><th>Condição</th><th>Sacados (CNPJ raiz)</th><th class="num">Taxa a.m.</th><th class="num">Venc. +</th><th class="num">Tarifas (borderô / título / consulta)</th><th>Vigência</th><th>Ativa</th></tr></thead><tbody>
      ${L.map(k => `<tr class="${ed ? 'clickable' : ''}" data-cid="${k.id}"><td><strong>${esc(fuNome(k.fundo_id))}</strong></td><td>${esc(k.nome)}</td><td class="small">${k.sacados_raiz?.length ? k.sacados_raiz.map(fmtRaiz).join(', ') : '<span class="muted">demais sacados</span>'}</td>
        <td class="num">${pct(+k.taxa_am / 100, 2)}</td><td class="num">${k.dias_compensacao} d${k.rola_dia_util ? ' → dia útil' : ''}${k.prazo_min_cobrado ? ` · mín. ${k.prazo_min_cobrado} d` : ''}</td>
        <td class="num">${money(+k.tarifa_operacao + +k.custo_assinatura)} / ${money(k.tarifa_titulo)} / ${money(k.custo_consulta)}</td>
        <td class="small">${k.vigencia_ini ? dateBR(k.vigencia_ini) : 'início'} → ${k.vigencia_fim ? dateBR(k.vigencia_fim) : 'em vigor'}</td><td>${k.ativo ? 'sim' : 'não'}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Nenhuma condição por grupo. Todos os fundos usam a linha do fundo.</div>'}</div>`;
  c.appendChild(el);
  if (!ed) return;
  const NUM = [['taxa_am', 'Taxa a.m. (%)'], ['dias_compensacao', 'Dias após o vencimento'], ['prazo_min_cobrado', 'Prazo mínimo cobrado (dias)'], ['tarifa_operacao', 'TED / tarifa por borderô (R$)'],
    ['custo_assinatura', 'Assinatura por borderô (R$)'], ['tarifa_titulo', 'Boleto por título (R$)'], ['custo_consulta', 'Consulta de sacado novo (R$)'], ['ad_valorem_pct', 'Ad valorem (% face)'], ['iof_pct', 'IOF (% face)']];
  const editar = (k) => {
    const m = modal({ title: k.id ? `Condição — ${k.nome}` : 'Nova condição', wide: true, body: `<form id="fc" class="grid-form">
      <label>Fundo<select name="fundo_id" required>${options(fundos, { empty: 'Selecione…', selected: k.fundo_id })}</select></label>
      <label>Nome<input name="nome" value="${esc(k.nome || '')}" required placeholder="ex.: Grupo Total / Demais sacados"></label>
      <label class="span2">Sacados do grupo — CNPJ (ou só a raiz, 8 dígitos), separados por vírgula; vazio = demais sacados<input name="sacados" value="${esc((k.sacados_raiz || []).map(fmtRaiz).join(', '))}"></label>
      ${NUM.map(([n, r]) => `<label>${r}<input name="${n}" inputmode="decimal" value="${k[n] == null ? '' : String(k[n]).replace('.', ',')}"></label>`).join('')}
      <label>Cálculo do deságio<select name="metodo_desagio"><option value="simples" ${k.metodo_desagio !== 'fator' ? 'selected' : ''}>Juros simples sobre a face</option><option value="fator" ${k.metodo_desagio === 'fator' ? 'selected' : ''}>Por dentro — v·k/(1+k)</option></select></label>
      <label>Fim de semana / feriado<select name="rola_dia_util"><option value="1" ${k.rola_dia_util !== false ? 'selected' : ''}>rola para o próximo dia útil</option><option value="0" ${k.rola_dia_util === false ? 'selected' : ''}>conta dias corridos</option></select></label>
      <label>Vigência de<input type="date" name="vigencia_ini" value="${k.vigencia_ini || ''}"></label><label>até<input type="date" name="vigencia_fim" value="${k.vigencia_fim || ''}"></label>
      <label>Ativa<select name="ativo"><option value="1" ${k.ativo !== false ? 'selected' : ''}>sim</option><option value="0" ${k.ativo === false ? 'selected' : ''}>não</option></select></label>
      <label class="span2">Observação<input name="observacao" value="${esc(k.observacao || '')}"></label></form>`,
      foot: `${k.id ? '<button class="btn danger" id="cdel" style="margin-right:auto">Excluir</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="cok">Salvar</button>` });
    $('#cok', m.el).onclick = async () => {
      const form = $('#fc', m.el); if (!form.reportValidity()) return; const d = formData(form);
      const raizes = [...new Set(String(d.sacados || '').split(/[,;\s]+/).map(x => x.replace(/\D/g, '')).filter(x => x.length >= 8).map(x => x.slice(0, 8)))];
      const row = { empresa_id: state.empresa.id, fundo_id: d.fundo_id, nome: d.nome.trim(), sacados_raiz: raizes, metodo_desagio: d.metodo_desagio, rola_dia_util: d.rola_dia_util === '1',
        vigencia_ini: d.vigencia_ini || null, vigencia_fim: d.vigencia_fim || null, ativo: d.ativo === '1', observacao: d.observacao || null, updated_at: new Date().toISOString() };
      for (const [n] of NUM) { const v = String(d[n] ?? '').trim(); row[n] = v === '' ? (n === 'prazo_min_cobrado' ? null : 0) : parseNum(v); }
      if (!(row.taxa_am > 0)) return toast('Informe a taxa', true);
      try { if (k.id) await q(sb.from('fidc_fundo_condicoes').update(row).eq('id', k.id)); else await q(sb.from('fidc_fundo_condicoes').insert(row)); toast('Condição salva'); m.close(); await carregar(); desenhar(root); } catch (e) { fail(e); }
    };
    $('#cdel', m.el) && ($('#cdel', m.el).onclick = async () => { if (!confirm(`Excluir a condição "${k.nome}"? As propostas já feitas não mudam.`)) return; try { await q(sb.from('fidc_fundo_condicoes').delete().eq('id', k.id)); m.close(); await carregar(); desenhar(root); } catch (e) { fail(e); } });
  };
  $('table', el) && ($('table', el).onclick = (e) => { const tr = e.target.closest('tr[data-cid]'); if (tr) editar(condicoes.find(x => x.id === tr.dataset.cid)); });
  $('#nova-cond', el).onclick = () => editar({ ativo: true, rola_dia_util: true, metodo_desagio: 'simples' });
}

// ======================================================================
// PDF da proposta (para aprovação do diretor)
// ======================================================================
async function pdfProposta(p, fu, itens) {
  const { jsPDF } = window.jspdf;
  const doc = padronizarPDF(new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' }));
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const azul = PRETO, marinho = PRETO;
  const t = (s) => String(s ?? '').replace(/[✓]/g, 'OK').replace(/[⚠ℹ]\s*/g, '').replace(/[−–]/g, '-').replace(/×/g, 'x');
  const logo = await logoPNG().catch(() => null);
  pdfCabecalho(doc, `Proposta de borderô nº ${p.numero} - ${t(fu.nome)}`, logo, { M: 14, sub: `operação em ${dateBR(p.data_operacao)} · status: ${p.status}` });
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
    foot: [['', '', 'TOTAL', '', money(p.valor_face), money(itens.reduce((s, i) => s + +(i.custo_estimado || 0), 0))]], footStyles: { fillColor: [242, 242, 242], textColor: 20, fontStyle: 'bold' },
    styles: { fontSize: 7.5, cellPadding: 1.3 }, columnStyles: { 1: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } }, margin: { left: 14, right: 14 } });
  y = doc.lastAutoTable.finalY + 24; if (y > H - 25) { doc.addPage(); y = 40; }
  doc.setDrawColor(120); doc.setLineWidth(.3); doc.line(20, y, 90, y); doc.line(W - 90, y, W - 20, y); doc.setFontSize(8.5);
  doc.text('Elaborado por (financeiro)', 20, y + 5); doc.text('Diretor - aprovo a operação', W - 90, y + 5);
  pdfRodapes(doc, 'Fonte: proposta de borderô e títulos selecionados na plataforma', { M: 14 });
  doc.save(`proposta_fidc_${p.numero}_${fu.nome}.pdf`);
}
