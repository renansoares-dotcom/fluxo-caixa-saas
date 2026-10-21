// Importar LANÇAMENTOS a partir do relatório RFLX036 do ERP ("Extrato de Contas por Quebra por Conta Pagamento").
// Diferente da Conciliação (onde o relatório do ERP vira extrato de contas sem banco), aqui cada linha vira um
// lançamento Pago na conta do relatório: plano pela "Conta Pagamento" do ERP, favorecido pelo emitente,
// transferência entre contas com a outra conta lida do histórico ("TRANSF P/ BNB", "ABASTECIMENTO CARTAO
// MOTORISTAS"...). Não duplica: lançamento que já existe (mesmo dia, valor e conta) é pulado; título em aberto
// do mesmo valor/favorecido é baixado em vez de criar outro. Nada é gravado sem a revisão do usuário.
import { sb, state, q, fetchAll } from './data.js';
import { $, esc, money, dateBR, options, fail, toast, modal } from './ui.js';
import { lerRelatorioERP } from './erp-extrato.js';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const r2 = (v) => Math.round(v * 100) / 100;
const semCodigo = (s) => String(s || '').replace(/^\s*\d+\s*-\s*/, '').trim();
const addDias = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

// semelhança entre nomes (0–1): igual, um contém o outro, ou distância de edição pequena (erros de digitação do ERP:
// "EQUPAMENTOS", "TERCERIZADOS", "SINDITATO", "COMISSÃO DE TERCEIROS" × "TERCEIRO")
function lev(a, b) {
  const m = a.length, n = b.length; if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
export function semelhanca(a, b) {
  a = norm(a); b = norm(b); if (!a || !b) return 0;
  if (a === b) return 1;
  const d = lev(a, b), r = 1 - d / Math.max(a.length, b.length);
  if ((a.includes(b) || b.includes(a)) && Math.min(a.length, b.length) >= 4) return Math.max(r, 0.9);
  return r;
}

// a outra conta de uma transferência, pelo texto do ERP
const REGRAS_CONTA = [
  [/subconta/, 'UNICRED - SUBCONTA'], [/kratos/, 'UNICRED - KRATOS'], [/unicred|unicrde/, 'UNICRED - PRINCIPAL'],
  [/vinculada/, 'BANCO DO NORDESTE - CONTA VINCULADA'], [/fundo .*bnb|bnb .*fundo/, 'FUNDO DE INVESTIMENTO BNB'], [/\bbnb\b|nordeste/, 'BANCO DO NORDESTE'],
  [/bradesco|bardesco|bradeco/, 'BRADESCO'], [/itau .*boleto/, 'ITAÚ - BOLETOS'], [/itau/, 'ITAÚ - MOVIMENTO'],
  [/cartao motorista|cartoes motorista|vexpenses/, 'VEXPENSES'], [/vortx .*contato/, 'VORTX-CONTATO'], [/vortx .*negocial/, 'VORTX-NEGOCIAL'],
  [/contato/, 'CONTATO'], [/negocial/, 'NEGOCIAL'], [/\bfs\b/, 'FS'], [/vector/, 'VECTOR'], [/caixa/, 'CAIXA CARTEIRA'],
  [/santander/, 'SANTANDER'], [/nubank/, 'NUBANK PJ'], [/socio/, 'SOCIO'],
];
function contaPeloTexto(txt, contas) {
  const t = norm(txt);
  for (const [re, nome] of REGRAS_CONTA) if (re.test(t)) { const c = contas.find(x => norm(x.nome) === norm(nome)); if (c) return c; }
  return null;
}

const ehTransf = (it) => /transfer/i.test(norm(it.contaErp)) || /transferencia entre contas/.test(norm(it.operacao));
const ehBordero = (it) => /^operacao (contato|negocial|fs|vector)\b/.test(norm(it.obs));

// favorecido pelo emitente (ou "FORNECEDOR: NOME" nas observações); só casa com cadastro existente
function acharFavorecido(it, favs) {
  const nomes = [it.emitente, (String(it.obs || '').match(/fornecedor:\s*(.+)$/i) || [])[1]].filter(Boolean);
  for (const nm of nomes) {
    const n = norm(nm); if (n.length < 3) continue;
    const exato = favs.find(f => norm(f.nome) === n); if (exato) return exato;
    // o ERP corta nomes longos: o cadastro começa com o texto do ERP (ou o contrário)
    const cand = favs.filter(f => { const fn = norm(f.nome); return fn.length >= 6 && (fn.startsWith(n) || n.startsWith(fn)); });
    if (cand.length === 1) return cand[0];
  }
  return null;
}

/**
 * Monta a proposta de cada linha. Puro (sem banco), para testar.
 * ctx: { itens, contaId, cad:{ contas, planos (selecionáveis), favorecidos }, existentes (v_lancamentos Pago da conta no período),
 *        abertos (v_lancamentos Em aberto), usoPlano {plano_id: n}, ccPorPlano {plano_id: cc_id}, contraTransf {sinal: conta_id}, mapa {chave: plano_id} }
 */
export function planejar(ctx) {
  const { itens, contaId, cad, existentes = [], abertos = [], usoPlano = {}, ccPorPlano = {}, contraTransf = {}, mapa = {} } = ctx;
  const planoT = cad.planos.find(p => p.codigo === '3.02.01') || cad.planos.find(p => p.tipo === 'T' && p.natureza === 'D');
  const usados = new Set(), usadosAb = new Set();
  const chavePlano = (it) => `${semCodigo(it.contaErp) || '(sem conta)'}|${it.valor > 0 ? 'C' : 'D'}`;
  const planoDe = (it) => {
    const k = chavePlano(it); if (mapa[k]) return { plano: cad.planos.find(p => p.id === mapa[k]) || null, como: 'escolhido' };
    const tipo = it.valor > 0 ? 'E' : 'S', alvo = semCodigo(it.contaErp);
    if (!alvo) return { plano: null, como: 'sem conta no ERP' };
    const cands = cad.planos.filter(p => p.tipo === tipo).map(p => ({ p, s: semelhanca(p.nome, alvo) })).filter(x => x.s >= 0.8)
      .sort((a, b) => b.s - a.s || (usoPlano[b.p.id] || 0) - (usoPlano[a.p.id] || 0));
    return cands.length ? { plano: cands[0].p, como: cands[0].s === 1 ? 'nome igual' : 'nome parecido' } : { plano: null, como: 'sem correspondência' };
  };
  return [...itens].sort((a, b) => a.data.localeCompare(b.data)).map(it => {
    const v = r2(Math.abs(it.valor)), cred = it.valor > 0;
    const p = { it, chave: chavePlano(it), valor: v, cred, acao: 'novo', avisos: [], plano: null, como: '', conta_id: contaId, conta_destino_id: null, favorecido: null, cc: null, existente: null, aberto: null };
    if (ehTransf(it)) {
      p.plano = planoT; p.como = 'transferência';
      let outra = contaPeloTexto(`${it.obs} ${it.documento}`, cad.contas);
      if (!outra || outra.id === contaId) {
        // "TRANSF P/ UNICRED PJ" no extrato da própria Unicred: a outra ponta vem do histórico de transferências
        outra = cad.contas.find(c => c.id === contraTransf[cred ? 'C' : 'D']) || null;
        p.avisos.push(outra ? `outra conta pelo histórico (${outra.nome}) — confira` : 'escolha a outra conta');
      }
      if (cred) { p.conta_id = outra?.id || null; p.conta_destino_id = contaId; } else { p.conta_destino_id = outra?.id || null; }
      if (ehBordero(it)) { p.acao = 'pular'; p.avisos.push('líquido de borderô: entra quando a proposta for aprovada'); }
    } else {
      const r = planoDe(it); p.plano = r.plano; p.como = r.como;
      if (!r.plano) p.avisos.push('escolha o plano de contas');
      p.favorecido = acharFavorecido(it, cad.favorecidos);
      p.cc = (r.plano && ccPorPlano[r.plano.id]) || null;
    }
    // já lançado? mesmo dia, mesmo valor, mesma conta (e, na transferência, a mesma outra conta quando conhecida)
    const ex = existentes.find(l => !usados.has(l.id) && l.data === it.data && Math.abs(+l.valor - v) < 0.005 && (
      p.plano?.tipo === 'T' ? (l.conta_destino_id && [l.conta_id, l.conta_destino_id].includes(contaId) && (l.conta_destino_id === contaId) === cred)
        : (!l.conta_destino_id && l.conta_id === contaId && (l.tipo === 'E') === cred)));
    if (ex) { usados.add(ex.id); p.existente = ex; p.acao = 'existe'; return p; }
    // título em aberto do mesmo valor (até 30 dias antes / 7 depois): baixa em vez de criar outro
    if (p.plano?.tipo !== 'T') {
      const cand = abertos.filter(l => !usadosAb.has(l.id) && Math.abs(+l.valor - v) < 0.005 && (l.tipo === 'E') === cred && l.data >= addDias(it.data, -30) && l.data <= addDias(it.data, 7));
      const doc = norm(it.documento).replace(/\s/g, '');
      const bom = cand.find(l => p.favorecido && l.favorecido_id === p.favorecido.id) || cand.find(l => doc && l.documento && doc.includes(norm(l.documento).replace(/\s/g, '')));
      if (bom) { usadosAb.add(bom.id); p.aberto = bom; p.acao = 'baixar'; }
    }
    if (p.acao === 'novo' && (!p.plano || (p.plano.tipo === 'T' && (!p.conta_id || !p.conta_destino_id)))) p.acao = 'pendente';
    return p;
  });
}

const LS = () => `erp-lanc:${state.empresa.id}`;
const lerLS = () => { try { return JSON.parse(localStorage.getItem(LS()) || '{}'); } catch { return {}; } };
const gravarLS = (o) => { try { localStorage.setItem(LS(), JSON.stringify(o)); } catch { /* sem storage: só nesta sessão */ } };

function contaDoRelatorio(banco, contas, lembradas) {
  if (lembradas[banco]) return lembradas[banco];
  const rot = norm(semCodigo(banco)); if (!rot) return '';
  const exato = contas.filter(c => norm(c.nome) === rot); if (exato.length === 1) return exato[0].id;
  const cand = contas.filter(c => { const n = norm(c.nome); return n && (` ${rot} `.includes(` ${n} `) || ` ${n} `.includes(` ${rot} `)); });
  return cand.length === 1 ? cand[0].id : '';
}

const ACOES = { novo: ['Criar', 'pago'], baixar: ['Baixar título', 'conc'], existe: ['Já lançado', ''], pular: ['Fora', 'vencido'], pendente: ['Completar', 'aberto'] };

/** Abre o assistente. `onDone` recarrega a tela de lançamentos. */
export function importarLancamentosERP(onDone = () => {}) {
  const c = state.cad, e = state.empresa.id;
  const contas = c.contas.filter(x => x.ativo !== false);
  const planos = c.contasPlano.filter(p => p.ativo !== false);
  let rel = null, props = [], contaId = '', filtro = 'todos', ctxBase = null;
  const m = modal({ title: 'Importar lançamentos do ERP', wide: true,
    body: `<p class="small muted" style="margin-top:0">No ERP, gere o <strong>RFLX036 — Extrato de Contas por Quebra por <u>Conta Pagamento</u></strong> do banco (o período que quiser) e exporte em <strong>XLSX</strong>.
      Cada linha vira um lançamento <strong>Pago</strong> nessa conta, com o plano de contas pela "Conta Pagamento" do ERP e o favorecido pelo emitente.
      O que já estiver lançado (mesmo dia, valor e conta) é pulado; título em aberto do mesmo valor é baixado. Revise antes de gravar.
      Depois, concilie com o extrato do banco (OFX) na Conciliação Bancária.</p>
      <input type="file" id="arq" accept=".xlsx,.xls,.ods,.csv"><div id="cab" style="margin-top:10px"></div><div id="res"></div>`,
    foot: '<span class="muted small" id="rod" style="margin-right:auto"></span><button class="btn" data-close>Fechar</button><button class="btn primary" id="ok" disabled>Gravar</button>' });

  const planoSel = (p) => `<select data-plano style="max-width:230px">${options([{ id: '', label: 'Selecione…' }, ...planos.filter(x => x.tipo === (p.cred ? 'E' : 'S') || x.id === p.plano?.id)], { label: 'label', selected: p.plano?.id || '' })}</select>`;
  const contaSel = (attr, sel) => `<select ${attr} style="max-width:200px">${options(contas, { empty: 'Selecione…', selected: sel || '' })}</select>`;

  function desenhar() {
    const cont = (a) => props.filter(p => p.acao === a).length;
    const vis = props.map((p, k) => ({ p, k })).filter(({ p }) => filtro === 'todos' || p.acao === filtro);
    $('#res', m.el).innerHTML = `<div class="chips" id="flt" style="margin:10px 0">${[['todos', `Todas (${props.length})`], ...Object.keys(ACOES).map(a => [a, `${ACOES[a][0]} (${cont(a)})`])].map(([a, t]) => `<span class="chip ${filtro === a ? 'on' : ''}" data-f="${a}">${t}</span>`).join('')}</div>
      <div class="table-wrap" style="max-height:52vh"><table class="small"><thead><tr><th></th><th>Data</th><th>Histórico (conta no ERP)</th><th>Plano de contas</th><th>Favorecido / outra conta</th><th class="num">Valor</th><th>Situação</th></tr></thead><tbody>
      ${vis.map(({ p, k }) => `<tr data-k="${k}" class="${p.acao === 'existe' || p.acao === 'pular' ? 'muted' : ''}">
        <td><input type="checkbox" data-on ${['novo', 'baixar'].includes(p.acao) ? 'checked' : ''} ${p.acao === 'existe' ? 'disabled' : ''}></td>
        <td class="small">${dateBR(p.it.data)}</td>
        <td class="small wrap" style="max-width:280px">${esc(p.it.obs || p.it.operacao)}<div class="muted">${esc(semCodigo(p.it.contaErp) || '—')}${p.it.documento ? ` · ${esc(p.it.documento)}` : ''}</div></td>
        <td class="small">${p.plano?.tipo === 'T' || p.acao === 'existe' ? esc(p.plano?.label || '—') : planoSel(p)}${p.como && p.plano?.tipo !== 'T' ? `<div class="muted">${esc(p.como)}</div>` : ''}</td>
        <td class="small wrap">${p.plano?.tipo === 'T' && p.acao !== 'existe' ? (p.cred ? `de ${contaSel('data-outra', p.conta_id)}` : `para ${contaSel('data-outra', p.conta_destino_id)}`) : esc(p.favorecido?.nome || '—')}</td>
        <td class="num ${p.cred ? 'pos' : 'neg'}">${money(p.cred ? p.valor : -p.valor)}</td>
        <td class="small wrap"><span class="badge ${ACOES[p.acao][1]}">${ACOES[p.acao][0]}</span>
          ${p.existente ? `<div class="muted">${esc(p.existente.descricao || p.existente.plano_nome || '')}</div>` : ''}
          ${p.aberto ? `<div class="muted">título ${dateBR(p.aberto.data)} ${esc(p.aberto.favorecido_nome || p.aberto.descricao || '')}</div>` : ''}
          ${p.avisos.map(a => `<div class="muted">⚠ ${esc(a)}</div>`).join('')}</td></tr>`).join('')}</tbody></table></div>`;
    const sel = props.filter(p => p.marcado);
    $('#rod', m.el).textContent = `Criar ${sel.filter(p => p.acao === 'novo').length} · baixar ${sel.filter(p => p.acao === 'baixar').length} · já lançados ${cont('existe')} · movimento a gravar ${money(sel.reduce((s, p) => s + (p.cred ? p.valor : -p.valor), 0))}`;
    $('#ok', m.el).disabled = !sel.length || sel.some(p => !valido(p));
  }
  const valido = (p) => p.acao === 'baixar' || (p.plano && (p.plano.tipo !== 'T' || (p.conta_id && p.conta_destino_id && p.conta_id !== p.conta_destino_id)));
  function replanejar() {
    const mapa = lerLS().planos || {};
    const antes = new Map(props.map(p => [p.it.fitid, p]));
    props = planejar({ ...ctxBase, contaId, mapa });
    for (const p of props) {
      const a = antes.get(p.it.fitid);
      if (a && p.plano?.tipo === 'T' && a.outraManual) { if (p.cred) p.conta_id = a.conta_id; else p.conta_destino_id = a.conta_destino_id; p.outraManual = true; if (p.acao === 'pendente' && valido(p)) p.acao = 'novo'; }
      p.marcado = a && a.marcadoManual != null ? a.marcadoManual : ['novo', 'baixar'].includes(p.acao);
      if (a) p.marcadoManual = a.marcadoManual;
    }
    desenhar();
  }

  async function preparar() {
    const ds = rel.itens.map(i => i.data).sort(), ini = ds[0], fim = ds[ds.length - 1];
    const [existentes, abertos, hist] = await Promise.all([
      fetchAll(() => sb.from('v_lancamentos').select('id,data,valor,tipo,status,conta_id,conta_destino_id,descricao,documento,favorecido_id,favorecido_nome,plano_nome').eq('empresa_id', e).eq('status', 'Pago').gte('data', ini).lte('data', fim).or(`conta_id.eq.${contaId},conta_destino_id.eq.${contaId}`)),
      fetchAll(() => sb.from('v_lancamentos').select('id,data,valor,tipo,status,conta_id,conta_destino_id,descricao,documento,favorecido_id,favorecido_nome,plano_nome').eq('empresa_id', e).eq('status', 'Em aberto').gte('data', addDias(ini, -7)).lte('data', addDias(fim, 30))),
      fetchAll(() => sb.from('lancamentos').select('plano_id,centro_custo_id,conta_id,conta_destino_id').eq('empresa_id', e).gte('data', addDias(ini, -120)).lt('data', ini)),
    ]);
    const usoPlano = {}, ccN = {}, contra = { C: {}, D: {} };
    for (const l of hist) {
      usoPlano[l.plano_id] = (usoPlano[l.plano_id] || 0) + 1;
      if (l.centro_custo_id) { const k = `${l.plano_id}|${l.centro_custo_id}`; ccN[k] = (ccN[k] || 0) + 1; }
      if (l.conta_destino_id === contaId && l.conta_id) contra.C[l.conta_id] = (contra.C[l.conta_id] || 0) + 1;
      if (l.conta_id === contaId && l.conta_destino_id) contra.D[l.conta_destino_id] = (contra.D[l.conta_destino_id] || 0) + 1;
    }
    const ccPorPlano = {};
    for (const [k, n] of Object.entries(ccN)) { const [pl, cc] = k.split('|'); if (!ccPorPlano[pl] || n > ccN[`${pl}|${ccPorPlano[pl]}`]) ccPorPlano[pl] = cc; }
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    ctxBase = { itens: rel.itens, cad: { contas, planos, favorecidos: c.favorecidos }, existentes, abertos, usoPlano, ccPorPlano, contraTransf: { C: top(contra.C), D: top(contra.D) } };
    props = []; replanejar();
  }

  $('#arq', m.el).onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    try { rel = lerRelatorioERP(await f.arrayBuffer(), f.name, { detalhe: true }); } catch (err) { $('#cab', m.el).innerHTML = `<div class="cf-msg neg small">${esc(err.message || err)}</div>`; return; }
    if (!rel.itens.some(i => i.contaErp)) { $('#cab', m.el).innerHTML = '<div class="cf-msg neg small">O relatório não tem a quebra por <strong>Conta Pagamento</strong>: no ERP, escolha "Primeira Quebra: Conta Pagamento" para trazer o plano de contas de cada linha.</div>'; return; }
    contaId = contaDoRelatorio(rel.banco, contas, lerLS().contas || {});
    const cab = () => { $('#cab', m.el).innerHTML = `<div class="toolbar" style="padding:0">
      <span class="small">${esc(rel.banco || '')} · ${dateBR(rel.inicio)} a ${dateBR(rel.fim)} · ${rel.itens.length} linhas · créditos ${money(rel.totalCred)} · débitos ${money(-rel.totalDeb)}
      ${rel.confere ? '<span class="badge pago">total confere</span>' : '<span class="badge vencido">total não confere</span>'}</span>
      <label>Conta no sistema${contaSel('id="conta"', contaId)}</label></div>`;
      $('#conta', m.el).onchange = async (x) => { contaId = x.target.value; const o = lerLS(); o.contas = { ...(o.contas || {}), [rel.banco]: contaId }; gravarLS(o); if (contaId) { try { await preparar(); } catch (er) { fail(er); } } };
    };
    cab();
    if (contaId) { try { await preparar(); } catch (er) { fail(er); } }
  };

  m.el.addEventListener('click', (ev) => { const ch = ev.target.closest('[data-f]'); if (ch) { filtro = ch.dataset.f; desenhar(); } });
  m.el.addEventListener('change', (ev) => {
    const tr = ev.target.closest('tr[data-k]'); if (!tr) return; const p = props[+tr.dataset.k];
    if (ev.target.matches('[data-on]')) { p.marcado = p.marcadoManual = ev.target.checked; desenhar(); }
    else if (ev.target.matches('[data-plano]')) {
      // a escolha vale para todas as linhas da mesma conta do ERP e fica lembrada para os próximos relatórios
      const o = lerLS(); o.planos = { ...(o.planos || {}), [p.chave]: ev.target.value || undefined }; gravarLS(o); replanejar();
    } else if (ev.target.matches('[data-outra]')) {
      if (p.cred) p.conta_id = ev.target.value || null; else p.conta_destino_id = ev.target.value || null;
      p.outraManual = true; if (p.acao === 'pendente' && valido(p)) { p.acao = 'novo'; p.marcado = true; }
      desenhar();
    }
  });

  $('#ok', m.el).onclick = async () => {
    const btn = $('#ok', m.el); btn.disabled = true;
    const sel = props.filter(p => p.marcado && valido(p));
    const novos = sel.filter(p => p.acao !== 'baixar').map(p => ({
      empresa_id: e, data: p.it.data, plano_id: p.plano.id, status: 'Pago', valor: p.valor,
      conta_id: p.conta_id, conta_destino_id: p.plano.tipo === 'T' ? p.conta_destino_id : null,
      descricao: (p.it.obs || p.it.operacao || '').slice(0, 500) || null, documento: p.it.documento || null,
      favorecido_id: p.favorecido?.id || null, centro_custo_id: p.cc || null, origem: p.it.fitid,
    }));
    try {
      // não grava duas vezes a mesma linha do ERP (origem = identificador da linha)
      const ja = new Set();
      for (let i = 0; i < novos.length; i += 200) for (const l of await q(sb.from('lancamentos').select('origem').eq('empresa_id', e).in('origem', novos.slice(i, i + 200).map(n => n.origem)))) ja.add(l.origem);
      const gravar = novos.filter(n => !ja.has(n.origem));
      for (let i = 0; i < gravar.length; i += 200) await q(sb.from('lancamentos').insert(gravar.slice(i, i + 200)));
      let baixados = 0;
      for (const p of sel.filter(x => x.acao === 'baixar')) {
        await q(sb.from('lancamentos').update({ status: 'Pago', data: p.it.data, conta_id: contaId }).eq('id', p.aberto.id).eq('status', 'Em aberto'));
        baixados++;
      }
      toast(`${gravar.length} lançamento(s) criado(s)${baixados ? ` · ${baixados} título(s) baixado(s)` : ''}${ja.size ? ` · ${ja.size} já existiam` : ''}`);
      m.close(); onDone();
    } catch (err) { fail(err); btn.disabled = false; }
  };
}
