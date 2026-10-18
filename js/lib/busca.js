// Busca global (botão na barra superior e atalho Ctrl+K / ⌘K)
// Procura em telas, beneficiários, plano de contas e contas (na memória) e em lançamentos, notas fiscais,
// propostas de borderô e pagamentos antecipados (no banco). Respeita o papel e as áreas de quem busca.
// Ao escolher um resultado, abre a tela certa já no registro (state.abrir = { tipo, id, ... }).
import { sb, state, q, temArea } from './data.js';
import { $, $$, esc, money, dateBR, parseNum, debounce, fail } from './ui.js';
import { abrirLancamento } from './lanc-form.js';

const MAX = 8;
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const soDig = (s) => String(s ?? '').replace(/\D/g, '');
const compras = () => state.papel === 'compras';

// área de uma rota, como no menu
const areaDaRota = (route) => ['dashboard', 'hoje', 'decisoes', 'executivo'].includes(route) ? 'fin' : document.querySelector(`#nav a[data-route="${route}"]`)?.closest('.nav-area')?.dataset.area;
const rotaLiberada = (route) => {
  const a = document.querySelector(`#nav a[data-route="${route}"]`);
  if (!a || a.hidden) return false;
  const ar = areaDaRota(route);
  if (compras() && !a.classList.contains('nav-compras')) return false;
  if (state.papel === 'vendas' && !a.classList.contains('nav-vendas')) return false;
  if (state.papel === 'producao' && !a.classList.contains('nav-producao')) return false;
  return !['fin', 'com', 'cmp', 'prd', 'log', 'cpd', 'cont'].includes(ar) || temArea(ar);
};
const ir = (route, abrir) => { if (abrir) state.abrir = abrir; if (location.hash === '#/' + route) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = '#/' + route; };

function telas(t) {
  return $$('#nav a[data-route]').filter(a => rotaLiberada(a.dataset.route) && norm(a.textContent).includes(t))
    .slice(0, 6).map(a => ({ texto: a.textContent.trim(), sub: a.closest('.nav-sec')?.querySelector('summary')?.textContent || '', go: () => ir(a.dataset.route) }));
}

function locais(t, dig) {
  const c = state.cad; if (!c || compras()) return [];
  const out = [];
  if (rotaLiberada('cadastros/favorecidos')) {
    const favs = c.favorecidos.filter(f => norm(f.label).includes(t) || norm(f.nome_fantasia).includes(t) || (dig.length >= 4 && soDig(f.documento).includes(dig))).slice(0, MAX);
    if (favs.length) out.push({ grupo: 'Beneficiários', itens: favs.map(f => ({ texto: f.label, sub: [f.tipo, f.documento].filter(Boolean).join(' · '), go: () => ir('cadastros/favorecidos', { tipo: 'fav', id: f.id }) })) });
  }
  const pl = c.plano.filter(p => p.nivel === 2 && (norm(p.codigo).startsWith(t) || norm(p.nome).includes(t))).slice(0, 6);
  if (pl.length && rotaLiberada('cadastros/plano')) out.push({ grupo: 'Plano de contas', itens: pl.map(p => ({ texto: p.label, go: () => ir('cadastros/plano') })) });
  const ct = c.contas.filter(x => norm(x.nome).includes(t) || norm(x.codigo).startsWith(t)).slice(0, 5);
  if (ct.length && rotaLiberada('cadastros/contas')) out.push({ grupo: 'Contas bancárias', itens: ct.map(x => ({ texto: x.nome, sub: x.codigo, go: () => ir('cadastros/contas') })) });
  return out;
}

async function remotos(termo) {
  const e = state.empresa.id, t = termo.trim(), dig = soDig(t), out = [];
  const ehNum = /^\d+$/.test(t);
  const valor = !ehNum && /^\d[\d.]*(,\d{1,2})?$/.test(t) ? parseNum(t.includes(',') ? t : t.replace(/\./g, '')) : null;   // "41.000" · "1.234,56" · "350,00"
  const ehValor = valor != null;
  const mData = t.match(/^(\d{2})\/(\d{2})(?:\/(\d{4}))?$/);
  const data = mData ? `${mData[3] || new Date().getFullYear()}-${mData[2]}-${mData[1]}` : null;
  const like = `*${t.replace(/[%_,()*]/g, ' ')}*`;   // curinga do PostgREST dentro de or()
  const tarefas = [];

  if (!compras() && temArea('fin')) {
    let lq = sb.from('lancamentos').select('id,data,valor,status,plano_id,favorecido_id,descricao,documento,conta_id').eq('empresa_id', e);
    if (data) lq = lq.eq('data', data);
    else if (ehNum) lq = lq.or(`valor.eq.${+t},documento.ilike.${t}*`);
    else if (ehValor) lq = lq.eq('valor', valor);
    else lq = lq.or(`descricao.ilike.${like},documento.ilike.${like}`);
    tarefas.push(q(lq.order('data', { ascending: false }).limit(MAX)).then(rows => rows.length && out.push({ grupo: 'Lançamentos', ordem: 2, itens: rows.map(l => ({
      texto: [dateBR(l.data), money(l.valor), state.cad.planoById[l.plano_id]?.nome].filter(Boolean).join(' · '),
      sub: [state.cad.favById[l.favorecido_id]?.nome, l.descricao, l.documento && 'NF ' + l.documento, l.status].filter(Boolean).join(' · '),
      go: async () => { try { const [full] = await q(sb.from('lancamentos').select('*').eq('id', l.id)); abrirLancamento(full || l, () => {}); } catch (err) { fail(err); } },
    })) })).catch(() => {}));
  }
  if (!compras() && temArea('cpd') && rotaLiberada('notas')) {
    let nq = sb.from('nfe_notas').select('id,numero,serie,tipo,emissao,dest_nome,emit_nome,emissao_propria,v_nf').eq('empresa_id', e);
    if (dig.length === 44) nq = nq.eq('chave', dig);
    else if (ehNum) nq = nq.eq('numero', +t);
    else if (ehValor || data) nq = null;
    else nq = nq.or(`dest_nome.ilike.${like},emit_nome.ilike.${like}`);
    if (nq) tarefas.push(q(nq.order('emissao', { ascending: false }).limit(MAX)).then(rows => rows.length && out.push({ grupo: 'Notas fiscais', ordem: 3, itens: rows.map(n => ({
      texto: `NF ${n.numero}${n.serie ? '-' + n.serie : ''} · ${n.tipo === 'saida' ? 'saída' : 'entrada'} · ${dateBR(n.emissao)}`,
      sub: [(n.emissao_propria ? n.dest_nome : n.emit_nome), money(n.v_nf)].filter(Boolean).join(' · '),
      go: () => ir('notas', { tipo: 'nota', id: n.id, tipo_nf: n.tipo, emissao: n.emissao }),
    })) })).catch(() => {}));
  }
  if (!compras() && temArea('fin') && ehNum && rotaLiberada('fidc-propostas')) {
    tarefas.push(q(sb.from('fidc_propostas').select('id,numero,status,data_operacao,valor_face').eq('empresa_id', e).eq('numero', +t).limit(3)).then(rows => rows.length && out.push({ grupo: 'Propostas de borderô', ordem: 4, itens: rows.map(p => ({
      texto: `Proposta nº ${p.numero} · ${p.status}`, sub: `${dateBR(p.data_operacao)} · face ${money(p.valor_face)}`, go: () => ir('fidc-propostas', { tipo: 'proposta', id: p.id }),
    })) })).catch(() => {}));
  }
  if (rotaLiberada('paraquedas')) {
    const nPA = (t.match(/^(?:pa\s*n?º?\s*)?(\d+)$/i) || [])[1];
    let pq = sb.from('paraquedas').select('id,numero,status,razao_social,valor,data_pagamento').eq('empresa_id', e);
    pq = nPA ? pq.eq('numero', +nPA) : (ehValor || data) ? null : pq.or(`razao_social.ilike.${like},descricao.ilike.${like}`);
    if (pq) tarefas.push(q(pq.order('numero', { ascending: false }).limit(MAX)).then(rows => rows.length && out.push({ grupo: 'Pagamentos antecipados', ordem: 5, itens: rows.map(p => ({
      texto: `PA nº ${p.numero} · ${p.razao_social || ''}`, sub: `${money(p.valor)} · pagar em ${dateBR(p.data_pagamento)} · ${p.status}`, go: () => ir('paraquedas', { tipo: 'pa', id: p.id }),
    })) })).catch(() => {}));
  }
  if (rotaLiberada('compras/pedidos')) {
    const nPC = (t.match(/^(?:pc\s*n?º?\s*)?(\d+)$/i) || [])[1];
    let pc = sb.from('compras_pedidos').select('id,numero,status,total,pedido_iniflex,data_pedido').eq('empresa_id', e);
    pc = nPC ? pc.or(`numero.eq.${+nPC},pedido_iniflex.eq.${nPC}`) : (ehValor || data) ? null : pc.ilike('pedido_iniflex', like);
    if (pc) tarefas.push(q(pc.order('numero', { ascending: false }).limit(MAX)).then(rows => rows.length && out.push({ grupo: 'Pedidos de compra', ordem: 6, itens: rows.map(p => ({
      texto: `PC ${p.numero}${p.pedido_iniflex ? ' · Iniflex ' + p.pedido_iniflex : ''}`, sub: `${money(p.total)} · ${dateBR(p.data_pedido)} · ${p.status}`, go: () => ir('compras/pedidos', { tipo: 'pedido', id: p.id }),
    })) })).catch(() => {}));
  }
  await Promise.all(tarefas);
  return out.sort((a, b) => a.ordem - b.ordem);
}

let aberto = null;
export function abrirBusca(inicial = '') {
  if (aberto) { $('#bg-input', aberto)?.focus(); return; }
  const back = document.createElement('div');
  back.className = 'modal-back busca-back';
  back.innerHTML = `<div class="busca-box" role="dialog" aria-label="Busca">
    <input id="bg-input" autocomplete="off" placeholder="Buscar beneficiário, lançamento (descrição, NF ou valor), nota, proposta, PA nº, tela…" value="${esc(inicial)}">
    <div id="bg-res" class="busca-res"><div class="muted small busca-dica">Dicas: valor "41.000" · data "08/09" · nº da NF ou da proposta · "PA 12" · CNPJ · nome da tela</div></div></div>`;
  document.body.appendChild(back); aberto = back;
  const inp = $('#bg-input', back), res = $('#bg-res', back);
  let itens = [], sel = 0, seq = 0;
  const fechar = () => { back.remove(); aberto = null; };
  const escolher = (i) => { const it = itens[i]; if (!it) return; fechar(); it.go(); };
  const pintar = (grupos, carregando) => {
    itens = grupos.flatMap(g => g.itens);
    let k = 0;
    res.innerHTML = grupos.length ? grupos.map(g => `<div class="busca-grupo">${esc(g.grupo)}</div>${g.itens.map(it => `<div class="busca-item${k === sel ? ' on' : ''}" data-k="${k++}">
        <div>${esc(it.texto)}</div>${it.sub ? `<div class="small muted">${esc(it.sub)}</div>` : ''}</div>`).join('')}`).join('') + (carregando ? '<div class="muted small busca-dica">Procurando no banco…</div>' : '')
      : (carregando ? '<div class="muted small busca-dica">Procurando…</div>' : '<div class="muted small busca-dica">Nada encontrado.</div>');
  };
  const buscar = debounce(async () => {
    const t = inp.value.trim(); const my = ++seq; sel = 0;
    if (t.length < 2) { res.innerHTML = '<div class="muted small busca-dica">Digite ao menos 2 caracteres.</div>'; itens = []; return; }
    const nt = norm(t), base = [];
    const tl = telas(nt); if (tl.length) base.push({ grupo: 'Telas', itens: tl });
    base.push(...locais(nt, soDig(t)));
    pintar(base, true);
    try { const r = await remotos(t); if (my === seq) pintar([...base, ...r], false); } catch (e) { if (my === seq) pintar(base, false); }
  }, 250);
  inp.oninput = buscar;
  inp.onkeydown = (e) => {
    if (e.key === 'Escape') return fechar();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!itens.length) return;
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + itens.length) % itens.length;
      $$('.busca-item', res).forEach(el => el.classList.toggle('on', +el.dataset.k === sel));
      $(`.busca-item[data-k="${sel}"]`, res)?.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'Enter') { e.preventDefault(); escolher(sel); }
  };
  res.onclick = (e) => { const it = e.target.closest('.busca-item'); if (it) escolher(+it.dataset.k); };
  back.addEventListener('mousedown', (e) => { if (e.target === back) fechar(); });
  inp.focus(); if (inicial) buscar();
}

let ligado = false;
export function iniciarBusca() {
  const host = $('.topbar-right'); if (!host) return;
  if (!$('#busca-btn')) {
    const b = document.createElement('button');
    b.className = 'btn ghost busca-btn'; b.id = 'busca-btn'; b.title = 'Buscar (Ctrl+K)';
    b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><span class="busca-txt">Buscar</span><kbd>Ctrl K</kbd>';
    host.insertBefore(b, host.firstChild);
    b.onclick = () => abrirBusca();
  }
  if (ligado) return; ligado = true;
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && state.empresa) { e.preventDefault(); abrirBusca(); }
  });
}
