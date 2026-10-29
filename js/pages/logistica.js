// Logística › Cargas: entregas pendentes (NF-e de saída com frete por conta da empresa), montagem automática por peso,
// volume, região e jornada, ajuste arrastando entre caminhões, romaneio, mapa e acompanhamento da entrega.
import { sb, state, q } from '../lib/data.js';
import { erroTela, $, $$, esc, dateBR, today, fail, toast, modal, confirmDialog } from '../lib/ui.js';
import { badge } from '../lib/compras.js';
import { carregarBase, municipios, paradas, ordenar, metricas, montarCargas, capacidade, veiculoPequeno, imprimirRomaneio, mapaSVG, podeLogistica,
  TIPOS_VEICULO, ST_CARGA, PROX_ST } from '../lib/logistica.js';

export const title = 'Logística — cargas';
const ui = { data: null, de: null, ate: null };
let B, M, origem, PEND = [], SALVAS = [], PROP = null, BAIXAS = [];
const kg = (v) => Math.round(+v || 0).toLocaleString('pt-BR');
const t1 = (v) => (+v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const money = (v) => v == null ? '–' : 'R$ ' + Math.round(v).toLocaleString('pt-BR');
const addDias = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const soDig = (s) => String(s || '').replace(/\D/g, '');
const ATIVAS = ['carregando', 'pronta', 'em_rota'];

export async function render(root) {
  ui.data ||= today(); ui.ate ||= today(); ui.de ||= addDias(today(), -7);
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try {
    [B, M] = await Promise.all([carregarBase(), municipios()]);
  } catch (err) { fail(err); root.innerHTML = erroTela(); return; }
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Cargas e entregas</h2><div class="muted small">Notas de saída com frete por conta da empresa (modFrete ${esc(B.P.mod_fretes.join(', '))}). Peso e volumes vêm da nota; volume em m³ estimado por tonelada quando não há medida.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end"><label>Dia das cargas<input type="date" id="lg-d" value="${ui.data}"></label>
      <label>Notas de<input type="date" id="lg-de" value="${ui.de}"></label><label>até<input type="date" id="lg-ate" value="${ui.ate}"></label>
      <a class="btn ghost" href="#/logistica/frota">Frota e parâmetros</a></div></div>
    <div id="lg-corpo"><div class="loading">Carregando notas…</div></div>`;
  $('#lg-d', root).onchange = (e) => { ui.data = e.target.value; PROP = null; render(root); };
  $('#lg-de', root).onchange = (e) => { ui.de = e.target.value; PROP = null; render(root); };
  $('#lg-ate', root).onchange = (e) => { ui.ate = e.target.value; PROP = null; render(root); };
  await recarregar(root);
}

async function recarregar(root) {
  const e = state.empresa.id;
  try {
    const [notas, doDia, ativas] = await Promise.all([q(sb.rpc('log_notas_pendentes', { p_empresa: e, p_de: ui.de, p_ate: ui.ate })),
      q(sb.from('log_cargas').select('*').eq('empresa_id', e).eq('data', ui.data).neq('status', 'cancelada').order('numero')),
      q(sb.from('log_cargas').select('*').eq('empresa_id', e).in('status', ATIVAS).order('numero'))]);
    const cmunO = B.P.origem_cmun || notas.find(n => n.emit_cmun)?.emit_cmun || localStorage.getItem('lg-origem') || null;
    if (cmunO) { try { localStorage.setItem('lg-origem', cmunO); } catch {} }
    origem = cmunO ? M[cmunO] : null;
    PEND = paradas(notas, B, M, origem);
    const ehBaixa = (c) => c.status === 'concluida' && !c.veiculo_id && String(c.observacao || '').startsWith('Baixa inicial');
    BAIXAS = doDia.filter(ehBaixa);
    const cargas = [...doDia.filter(c => !ehBaixa(c)), ...ativas.filter(a => !doDia.some(d => d.id === a.id))];
    const linhas = cargas.length ? await q(sb.rpc('log_notas_das_cargas', { p_empresa: e, p_cargas: cargas.map(c => c.id) })) : [];
    SALVAS = cargas.map(c => {
      const v = B.veiculos.find(x => x.id === c.veiculo_id) || null, stops = [];
      for (const l of linhas.filter(x => x.carga_id === c.id)) {
        const k = soDig(l.dest_doc) + '|' + (l.cmun || l.xmun || ''), ult = stops[stops.length - 1];
        const n = { ...l, id: l.nota_id, kg: +l.peso_kg || 0, m3: +l.volume_m3 || 0 };
        if (ult && ult.key === k) { ult.notas.push(n); ult.kg += n.kg; ult.m3 += n.m3; }
        else stops.push({ key: k, doc: soDig(l.dest_doc), nome: l.dest_nome, cmun: l.cmun, xmun: l.xmun, uf: l.uf, bairro: l.bairro, cep: soDig(l.cep), logradouro: l.logradouro, nro: l.nro,
          coord: M[l.cmun] || null, notas: [n], kg: n.kg, m3: n.m3, vol: 0 });
      }
      return { c, v, stops, m: metricas(stops, v, B.P, origem) };
    });
  } catch (err) { fail(err); $('#lg-corpo', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar as notas.</div></div>'; return; }
  pintar(root);
}

function pintar(root) {
  const corpo = $('#lg-corpo', root), ed = podeLogistica();
  const disp = B.veiculos.filter(v => v.situacao === 'disponivel');
  const longe = PEND.filter(s => s.longe), atras = PEND.filter(s => s.atrasada);
  const todas = [...SALVAS.filter(s => s.c.data === ui.data), ...(PROP?.cargas || [])];
  const ocup = todas.filter(x => x.m.pctKg != null), ocMed = ocup.length ? ocup.reduce((t, x) => t + x.m.pctKg, 0) / ocup.length : null;
  const frete = todas.reduce((t, x) => t + (x.m.frete || 0), 0);
  corpo.innerHTML = `
    ${!B.veiculos.length ? `<div class="card" style="border-left:4px solid var(--warn,#f59e0b)"><b>Cadastre a frota primeiro.</b> <span class="muted">Placa, carga máxima e medidas do baú de cada caminhão.</span> <a href="#/logistica/frota">Ir para Frota e parâmetros</a></div>` : ''}
    ${!origem ? '<div class="card" style="border-left:4px solid var(--warn,#f59e0b)"><b>Ponto de saída desconhecido.</b> Informe o código IBGE do município da fábrica em Frota e parâmetros › Parâmetros.</div>' : ''}
    <div class="pl-kpis">${[['Entregas pendentes', `${PEND.length} · ${t1(PEND.reduce((t, s) => t + s.kg, 0) / 1000)} t`, ''], ['Atrasadas', String(atras.length), atras.length ? 'neg' : ''],
      ['Cargas do dia', String(todas.length), ''], ['Ocupação média', ocMed == null ? '–' : Math.round(ocMed * 100) + '%', ''], ['Frete previsto', frete ? money(frete) : '–', ''],
      ['Para transportadora', String(longe.length), longe.length ? 'warn' : '']].map(([t, v, c]) => `<div class="pl-k"><span>${t}</span><b class="${c}">${v}</b></div>`).join('')}</div>
    <div class="lg-grade">
      <div class="card lg-pend" data-alvo="pend"><div class="card-head"><h2 style="margin:0">Pendentes de carga</h2>${ed && PEND.length ? '<button class="btn ghost small" id="lg-baixa" title="Para notas que já foram entregues antes de usar a plataforma">Baixa inicial…</button>' : ''}</div>
        ${BAIXAS.map(c => `<div class="small muted" style="margin-bottom:8px">Baixa inicial feita hoje (${kg(c.peso_kg)} kg). ${ed ? `<a href="#" data-desf="${c.id}">Desfazer</a>` : ''}</div>`).join('')}
        <div class="lg-lista">${PEND.map(s => itemPend(s)).join('') || '<div class="empty">Nenhuma nota pendente de entrega no período.</div>'}</div></div>
      <div>
        ${ed ? `<div class="lg-acoes"><button class="btn primary" id="lg-auto" ${!disp.length || !origem ? 'disabled' : ''}>Montar cargas automaticamente</button><button class="btn" id="lg-nova" ${!disp.length ? 'disabled' : ''}>Nova carga</button>
          <button class="btn ghost" id="lg-mapa">Ver no mapa</button></div>` : '<div class="lg-acoes"><button class="btn ghost" id="lg-mapa">Ver no mapa</button></div>'}
        ${PROP ? `<div class="lg-prop-bar"><div><b>Sugestão — ainda não salva.</b> ${PROP.cargas.length} carga(s)${PROP.sobra.length ? ` · ${PROP.sobra.length} entrega(s) não couberam hoje` : ''}${PROP.fora.length ? ` · ${PROP.fora.length} longe ou sem endereço (transportadora)` : ''}. Arraste para ajustar.</div>
          <div style="display:flex;gap:8px"><button class="btn" id="lg-desc">Descartar</button><button class="btn primary" id="lg-salvar">Salvar cargas</button></div></div>` : ''}
        <div class="lg-cargas">${(PROP?.cargas || []).map((x, i) => cardCarga(x, 'p' + i)).join('')}${SALVAS.map(x => cardCarga(x, x.c.id)).join('')
          || (PROP ? '' : '<div class="card"><div class="empty">Nenhuma carga neste dia. Use "Montar cargas automaticamente" ou "Nova carga".</div></div>')}</div>
      </div></div>`;
  ligar(root);
}

function itemPend(s) {
  const tags = [s.atrasada ? `<span class="lg-tag neg">${s.dias} dias</span>` : '', s.soPequeno ? '<span class="lg-tag">só veículo pequeno</span>' : '',
    s.longe ? `<span class="lg-tag warn">${kg(s.distKm)} km · transportadora?</span>` : '', s.semCoord ? '<span class="lg-tag warn">município sem coordenada</span>' : ''].join('');
  const alvos = [...(PROP?.cargas || []).map((x, i) => ['p' + i, `Sugestão ${i + 1} — ${x.veiculo.codigo}`]), ...SALVAS.filter(x => ['planejada', 'carregando'].includes(x.c.status)).map(x => [x.c.id, `Carga ${x.c.numero} — ${x.v?.codigo || ''}`])];
  return `<div class="lg-item" draggable="${podeLogistica()}" data-src="pend" data-key="${esc(s.key)}"><div class="lg-item-l"><b>${esc(s.nome || '')}</b><div class="small muted">${esc(s.xmun || '')}/${esc(s.uf || '')} · NF ${s.notas.map(n => n.numero).join(', ')}</div>${tags ? `<div>${tags}</div>` : ''}</div>
    <div class="lg-item-r"><b>${kg(s.kg)} kg</b><div class="small muted">${t1(s.m3)} m³${s.vol ? ` · ${kg(s.vol)} vol` : ''}</div>
    ${podeLogistica() && alvos.length ? `<select class="lg-mover" data-key="${esc(s.key)}"><option value="">+ carga…</option>${alvos.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select>` : ''}</div></div>`;
}

function cardCarga(x, id) {
  const prop = ehProp(id), c = x.c || { status: 'planejada' }, v = x.veiculo || x.v, m = x.m, ed = podeLogistica();
  const editavel = ed && (prop || ['planejada', 'carregando'].includes(c.status)), cap = v ? capacidade(v) : null;
  const pK = m.pctKg != null ? Math.round(m.pctKg * 100) : null, pV = m.pctM3 != null ? Math.round(m.pctM3 * 100) : null;
  const barra = (lab, p, txt) => `<div class="lg-lb"><span>${lab}</span><span>${p == null ? '–' : p + '%'} · ${txt}</span></div><div class="pl-bar"><i style="width:${Math.min(100, p || 0)}%;${p > 100 ? 'background:var(--neg)' : ''}"></i></div>`;
  const outrosV = B.veiculos.filter(o => o.situacao === 'disponivel');
  return `<div class="card lg-carga ${prop ? 'lg-proposta' : ''}" data-alvo="${id}">
    <div class="lg-ch"><div><b class="lg-cod">${esc(v?.codigo || 'Sem veículo')}</b> ${prop ? '<span class="small muted">sugestão</span>' : `<span class="small muted">carga ${c.numero}${c.data !== ui.data ? ' · ' + dateBR(c.data) : ''}</span>`}
      <div class="small muted">${v ? `${esc(TIPOS_VEICULO[v.tipo] || v.tipo)}${v.placa ? ' · ' + esc(v.placa) : ''} · ${kg(v.carga_kg)} kg${cap?.m3Bruto ? ' · ' + t1(cap.m3Bruto) + ' m³' : ''}` : ''}</div></div>
      ${prop ? '' : badge(ST_CARGA, c.status)}</div>
    ${editavel && !prop ? `<div class="lg-linha"><select class="lg-veic" data-id="${id}">${outrosV.map(o => `<option value="${o.id}" ${o.id === v?.id ? 'selected' : ''}>${esc(o.codigo)}</option>`).join('')}</select>
      <input class="lg-mot" data-id="${id}" placeholder="Motorista" value="${esc(c.motorista || v?.motorista || '')}"></div>` : ''}
    ${barra('Peso', pK, kg(m.kg) + ' kg')}${barra('Volume', pV, t1(m.m3) + ' m³')}
    ${m.estoura ? '<div class="small neg">Passa da capacidade do veículo.</div>' : ''}${m.passaJornada ? `<div class="small warn">Passa da jornada (${t1(m.horas)} h).</div>` : ''}
    <ol class="lg-stops">${x.stops.map((s, i) => `<li class="lg-stop" draggable="${editavel}" data-src="${id}" data-key="${esc(s.key)}"><span class="lg-n">${i + 1}</span><div><b>${esc(s.nome || '')}</b><div class="small muted">${esc(s.xmun || '')} · NF ${s.notas.map(n => n.numero).join(', ')} · ${kg(s.kg)} kg</div>
        ${!prop && c.status === 'em_rota' ? `<div class="lg-ent">${entregaBtns(s, id)}</div>` : ''}</div>${editavel ? `<button class="lg-x" data-tirar="${esc(s.key)}" data-id="${id}" title="Tirar da carga">×</button>` : ''}</li>`).join('') || '<li class="muted small">Arraste entregas para cá.</li>'}</ol>
    <div class="small muted">${m.cidades.slice(0, 6).map(esc).join(' → ')}${m.cidades.length > 6 ? ' …' : ''}</div>
    <div class="small">${kg(m.km)} km · ${t1(m.horas)} h · frete ${money(m.frete)}${m.frete && m.kg ? ` (R$ ${(m.frete / m.kg).toFixed(2).replace('.', ',')}/kg)` : ''}</div>
    <div class="lg-bts">
      ${!prop && ed && PROX_ST[c.status] ? `<button class="btn small primary" data-st="${id}">${PROX_ST[c.status][1]}</button>` : ''}
      <button class="btn small" data-rom="${id}">Romaneio</button>
      ${!prop && ed && c.status === 'planejada' ? `<button class="btn small danger" data-del="${id}">Excluir</button>` : ''}
      ${!prop && ed && ['carregando', 'pronta'].includes(c.status) ? `<button class="btn small ghost" data-canc="${id}">Cancelar</button>` : ''}</div></div>`;
}
function entregaBtns(s, id) {
  const sit = s.notas[0]?.situacao || 'pendente';
  if (sit === 'entregue') return '<span class="lg-tag ok">entregue</span>';
  if (sit === 'nao_entregue') return '<span class="lg-tag neg">não entregue — volta para pendentes</span>';
  return podeLogistica() ? `<button class="btn small" data-ent="ok" data-id="${id}" data-key="${esc(s.key)}">Entregue</button><button class="btn small ghost" data-ent="nao" data-id="${id}" data-key="${esc(s.key)}">Não entregue</button>` : '';
}

const ehProp = (id) => /^p\d+$/.test(String(id));
const achar = (id) => ehProp(id) ? PROP.cargas[+id.slice(1)] : SALVAS.find(x => x.c.id === id);
const recalcProp = (x) => { x.stops = ordenar(x.stops, origem); x.m = metricas(x.stops, x.veiculo, B.P, origem); };

function ligar(root) {
  const corpo = $('#lg-corpo', root);
  $('#lg-auto', corpo) && ($('#lg-auto', corpo).onclick = () => {
    const ocupados = new Set(SALVAS.filter(x => x.c.data === ui.data || ATIVAS.includes(x.c.status)).map(x => x.c.veiculo_id));
    const livres = B.veiculos.filter(v => v.situacao === 'disponivel' && !ocupados.has(v.id));
    if (!livres.length) return toast('Todos os veículos disponíveis já têm carga neste dia', true);
    PROP = montarCargas(PEND, livres, B.P, origem);
    if (!PROP.cargas.length) { toast('Nada coube nos veículos livres (verifique capacidade e jornada)', true); PROP = null; return; }
    PEND = PEND.filter(s => !PROP.cargas.some(c => c.stops.includes(s)));
    pintar(root);
  });
  $$('[data-desf]', corpo).forEach(a => a.onclick = async (ev) => { ev.preventDefault(); if (!await confirmDialog('Desfazer a baixa inicial? As notas voltam para pendentes.')) return;
    try { await q(sb.from('log_cargas').delete().eq('id', a.dataset.desf)); await recarregar(root); } catch (err) { fail(err); } });
  $('#lg-baixa', corpo) && ($('#lg-baixa', corpo).onclick = () => {
    const md = modal({ title: 'Baixa inicial de entregas', body: `<p>Use uma vez, no começo, para tirar da lista as notas que <b>já foram entregues</b> antes da plataforma. Elas ficam registradas como entregues numa carga de baixa (sem veículo), e dá para desfazer excluindo essa carga.</p>
      <div class="grid-form"><label>Dar baixa nas notas emitidas até<input type="date" id="bi-ate" value="${addDias(today(), -1)}"></label></div>
      <p class="small muted" id="bi-info"></p>`, foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="bi-ok">Dar baixa</button>' });
    const alvo = () => PEND.filter(s => !PROP?.cargas.some(c => c.stops.includes(s))).flatMap(s => s.notas).filter(n => n.emissao <= $('#bi-ate', md.el).value);
    const info = () => { const a = alvo(); $('#bi-info', md.el).textContent = `${a.length} nota(s) · ${kg(a.reduce((t, n) => t + n.kg, 0))} kg no período carregado (${dateBR(ui.de)} a ${dateBR(ui.ate)}). Para notas mais antigas, aumente o período antes.`; };
    $('#bi-ate', md.el).onchange = info; info();
    $('#bi-ok', md.el).onclick = async (ev) => {
      const a = alvo(); if (!a.length) return toast('Nenhuma nota até essa data', true);
      ev.target.disabled = true;
      try {
        const [c] = await q(sb.from('log_cargas').insert({ empresa_id: state.empresa.id, data: today(), status: 'concluida', peso_kg: a.reduce((t, n) => t + n.kg, 0), observacao: `Baixa inicial — entregas anteriores ao uso da plataforma (notas até ${dateBR($('#bi-ate', md.el).value)})` }).select());
        for (let i = 0; i < a.length; i += 200) await q(sb.from('log_carga_notas').insert(a.slice(i, i + 200).map((n, k) => ({ empresa_id: state.empresa.id, carga_id: c.id, nota_id: n.id, seq: i + k + 1, peso_kg: n.kg, volume_m3: n.m3, situacao: 'entregue' }))));
        md.close(); toast(`${a.length} nota(s) baixadas`); PROP = null; await recarregar(root);
      } catch (err) { fail(err); ev.target.disabled = false; }
    };
  });
  $('#lg-desc', corpo) && ($('#lg-desc', corpo).onclick = () => { PROP = null; recarregar(root); });
  $('#lg-salvar', corpo) && ($('#lg-salvar', corpo).onclick = async (ev) => {
    ev.target.disabled = true;
    try { for (const x of PROP.cargas.filter(x => x.stops.length)) await salvarNova(x.veiculo, x.stops, x.veiculo.motorista);
      PROP = null; toast('Cargas salvas'); await recarregar(root); } catch (err) { fail(err); ev.target.disabled = false; }
  });
  $('#lg-nova', corpo) && ($('#lg-nova', corpo).onclick = () => {
    const ocupados = new Set(SALVAS.filter(x => x.c.data === ui.data).map(x => x.c.veiculo_id));
    const md = modal({ title: 'Nova carga', body: `<div class="grid-form"><label>Veículo<select id="nc-v">${B.veiculos.filter(v => v.situacao === 'disponivel').map(v => `<option value="${v.id}">${esc(v.codigo)}${ocupados.has(v.id) ? ' (já tem carga hoje)' : ''}</option>`).join('')}</select></label>
      <label>Motorista<input id="nc-m"></label></div><p class="small muted">A carga começa vazia; arraste ou use "+ carga…" nas entregas pendentes.</p>`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="nc-ok">Criar</button>' });
    $('#nc-v', md.el).onchange = () => { const v = B.veiculos.find(x => x.id === $('#nc-v', md.el).value); if (v?.motorista && !$('#nc-m', md.el).value) $('#nc-m', md.el).value = v.motorista; }; $('#nc-v', md.el).onchange();
    $('#nc-ok', md.el).onclick = async () => { try { await salvarNova(B.veiculos.find(x => x.id === $('#nc-v', md.el).value), [], $('#nc-m', md.el).value.trim()); md.close(); await recarregar(root); } catch (err) { fail(err); } };
  });
  $('#lg-mapa', corpo).onclick = () => {
    if (!origem) return toast('Defina o ponto de saída em Frota e parâmetros', true);
    const rotas = [...(PROP?.cargas || []).map(x => ({ stops: x.stops, salva: false })), ...SALVAS.filter(x => x.c.data === ui.data || ATIVAS.includes(x.c.status)).map(x => ({ stops: x.stops, salva: true }))];
    const legenda = [...(PROP?.cargas || []).map((x, i) => `${x.veiculo.codigo} (sugestão)`), ...SALVAS.filter(x => x.c.data === ui.data || ATIVAS.includes(x.c.status)).map(x => `${x.v?.codigo || ''} · carga ${x.c.numero}`)];
    const cores = ['#2563eb', '#7c3aed', '#16a34a', '#ea580c', '#0891b2', '#db2777'];
    modal({ title: 'Trajetos do dia', body: `${mapaSVG(origem, rotas)}<div class="lg-leg">${legenda.map((t, i) => `<span><i style="background:${cores[i % cores.length]}"></i>${esc(t)}</span>`).join('')}</div>
      <p class="small muted">Pontos no centro de cada município; linha tracejada = sugestão ainda não salva. Distâncias estimadas (linha reta × fator ${String(B.P.fator_rodoviario).replace('.', ',')}).</p>`, wide: true });
  };
  // mover pelo seletor (funciona também no celular)
  $$('.lg-mover', corpo).forEach(sel => sel.onchange = () => { if (sel.value) mover({ src: 'pend', key: sel.dataset.key }, sel.value, root); });
  $$('[data-tirar]', corpo).forEach(b => b.onclick = () => mover({ src: b.dataset.id, key: b.dataset.tirar }, 'pend', root));
  // arrastar e soltar
  $$('[draggable="true"]', corpo).forEach(el => el.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', JSON.stringify({ src: el.dataset.src, key: el.dataset.key })); ev.dataTransfer.effectAllowed = 'move'; }));
  $$('[data-alvo]', corpo).forEach(al => {
    al.addEventListener('dragover', (ev) => { ev.preventDefault(); al.classList.add('lg-sobre'); });
    al.addEventListener('dragleave', () => al.classList.remove('lg-sobre'));
    al.addEventListener('drop', (ev) => { ev.preventDefault(); al.classList.remove('lg-sobre'); let d; try { d = JSON.parse(ev.dataTransfer.getData('text/plain')); } catch { return; } mover(d, al.dataset.alvo, root); });
  });
  $$('.lg-veic', corpo).forEach(s => s.onchange = async () => { try { const x = achar(s.dataset.id); x.v = B.veiculos.find(v => v.id === s.value); await q(sb.from('log_cargas').update({ veiculo_id: s.value }).eq('id', x.c.id)); await gravarTotais(x); await recarregar(root); } catch (err) { fail(err); } });
  $$('.lg-mot', corpo).forEach(i => i.onchange = async () => { try { await q(sb.from('log_cargas').update({ motorista: i.value.trim() || null }).eq('id', i.dataset.id)); toast('Motorista salvo'); } catch (err) { fail(err); } });
  $$('[data-rom]', corpo).forEach(b => b.onclick = () => { const x = achar(b.dataset.rom); imprimirRomaneio(x.c || { data: ui.data }, x.v || x.veiculo, x.stops, x.m); });
  $$('[data-del]', corpo).forEach(b => b.onclick = async () => { if (!await confirmDialog('Excluir esta carga? As notas voltam para pendentes.')) return; try { await q(sb.from('log_cargas').delete().eq('id', b.dataset.del)); await recarregar(root); } catch (err) { fail(err); } });
  $$('[data-canc]', corpo).forEach(b => b.onclick = async () => { if (!await confirmDialog('Cancelar esta carga? As notas voltam para pendentes.')) return; try { await q(sb.from('log_cargas').update({ status: 'cancelada' }).eq('id', b.dataset.canc)); await recarregar(root); } catch (err) { fail(err); } });
  $$('[data-st]', corpo).forEach(b => b.onclick = async () => {
    const x = achar(b.dataset.st), prox = PROX_ST[x.c.status][0];
    try {
      if (prox === 'em_rota' && !x.stops.length) return toast('A carga está vazia', true);
      if (prox === 'concluida') {
        const pend = x.stops.flatMap(s => s.notas).filter(n => n.situacao === 'pendente');
        if (pend.length) { const r = await escolha(`${pend.length} nota(s) desta carga ainda estão sem baixa. Como ficam?`, [['entregue', 'Todas entregues'], ['nao_entregue', 'Não entregues (voltam para pendentes)']]);
          if (!r) return; await q(sb.from('log_carga_notas').update({ situacao: r }).in('id', pend.map(n => n.carga_nota_id))); }
      }
      await q(sb.from('log_cargas').update({ status: prox }).eq('id', x.c.id)); toast(ST_CARGA[prox][0]); await recarregar(root);
    } catch (err) { fail(err); }
  });
  $$('[data-ent]', corpo).forEach(b => b.onclick = async () => {
    const x = achar(b.dataset.id), st = x.stops.find(s => s.key === b.dataset.key);
    try { await q(sb.from('log_carga_notas').update({ situacao: b.dataset.ent === 'ok' ? 'entregue' : 'nao_entregue' }).in('id', st.notas.map(n => n.carga_nota_id))); await recarregar(root); } catch (err) { fail(err); }
  });
}

// move uma parada entre pendentes, sugestões e cargas salvas
async function mover(d, destino, root) {
  if (!podeLogistica() || d.src === destino) return;
  const deProp = ehProp(d.src), paraProp = ehProp(destino);
  let stop;
  if (d.src === 'pend') stop = PEND.find(s => s.key === d.key);
  else { const x = achar(d.src); stop = x?.stops.find(s => s.key === d.key);
    if (!deProp && !['planejada', 'carregando'].includes(x.c.status)) return toast('Carga já saiu; não dá para tirar entrega', true); }
  if (!stop) return;
  if ((deProp && !paraProp && destino !== 'pend') || (!deProp && d.src !== 'pend' && paraProp)) return toast('Salve a sugestão antes de misturar com cargas salvas', true);
  try {
    if (destino !== 'pend') { const alvo = achar(destino), v = alvo.veiculo || alvo.v;
      if (stop.soPequeno && v && !veiculoPequeno(v)) { if (!await confirmDialog(`${stop.nome} só recebe veículo pequeno e ${v.codigo} não é marcado como pequeno. Colocar mesmo assim?`)) return; } }
    // tira da origem
    if (deProp) { const x = achar(d.src); x.stops = x.stops.filter(s => s !== stop); recalcProp(x); }
    else if (d.src !== 'pend') { await q(sb.from('log_carga_notas').delete().in('id', stop.notas.map(n => n.carga_nota_id))); const x = achar(d.src); x.stops = x.stops.filter(s => s !== stop); await reordenarSalva(x); }
    else if (PROP) { PROP.sobra = PROP.sobra.filter(s => s !== stop); PROP.fora = PROP.fora.filter(s => s !== stop); }
    // põe no destino
    if (paraProp) { const x = achar(destino); x.stops.push(stop); recalcProp(x); PEND = PEND.filter(s => s !== stop); }
    else if (destino !== 'pend') { const x = achar(destino);
      await q(sb.from('log_carga_notas').insert(stop.notas.map(n => ({ empresa_id: state.empresa.id, carga_id: x.c.id, nota_id: n.id, seq: 99, peso_kg: n.kg, volume_m3: n.m3 }))));
      x.stops.push(stop); await reordenarSalva(x); }
    if (paraProp || deProp) { if (destino === 'pend' && deProp) PEND = [...PEND, stop]; pintar(root); }
    else await recarregar(root);
  } catch (err) { fail(err); await recarregar(root); }
}

async function salvarNova(v, stops, motorista) {
  const m = metricas(stops, v, B.P, origem);
  const [c] = await q(sb.from('log_cargas').insert({ empresa_id: state.empresa.id, data: ui.data, veiculo_id: v?.id || null, motorista: motorista || v?.motorista || null, status: 'planejada',
    peso_kg: m.kg, volume_m3: m.m3, km_previsto: m.km, horas_previstas: m.horas, frete_previsto: m.frete }).select());
  const linhas = stops.flatMap((s, i) => s.notas.map(n => ({ empresa_id: state.empresa.id, carga_id: c.id, nota_id: n.id, seq: i + 1, peso_kg: n.kg, volume_m3: n.m3 })));
  if (linhas.length) await q(sb.from('log_carga_notas').insert(linhas));
  return c;
}
async function reordenarSalva(x) {
  const ord = ordenar(x.stops, origem); x.stops = ord;
  // grava a nova ordem só das notas que já existem no banco (as recém-inseridas recebem a ordem no recarregar seguinte)
  const ids = await q(sb.from('log_carga_notas').select('id,nota_id').eq('carga_id', x.c.id));
  for (const [i, s] of ord.entries()) { const nids = s.notas.map(n => n.id); const alvo = ids.filter(r => nids.includes(r.nota_id)).map(r => r.id); if (alvo.length) await q(sb.from('log_carga_notas').update({ seq: i + 1 }).in('id', alvo)); }
  await gravarTotais(x);
}
async function gravarTotais(x) {
  const m = metricas(x.stops, x.v, B.P, origem); x.m = m;
  await q(sb.from('log_cargas').update({ peso_kg: m.kg, volume_m3: m.m3, km_previsto: m.km, horas_previstas: m.horas, frete_previsto: m.frete }).eq('id', x.c.id));
}

function escolha(msg, opcoes) {
  return new Promise(res => {
    const md = modal({ title: 'Concluir carga', body: `<p>${esc(msg)}</p>`, foot: `<button class="btn" data-close>Voltar</button>${opcoes.map(([v, t]) => `<button class="btn ${v === opcoes[0][0] ? 'primary' : ''}" data-op="${v}">${esc(t)}</button>`).join('')}` });
    let feito = false; $$('[data-op]', md.el).forEach(b => b.onclick = () => { feito = true; md.close(); res(b.dataset.op); });
    new MutationObserver((_, o) => { if (!md.el.isConnected) { o.disconnect(); if (!feito) res(null); } }).observe(document.body, { childList: true, subtree: true });
  });
}
