// Produção › Planta da fábrica: acompanhamento ao vivo (isométrico no computador e na TV, planta baixa no celular)
// e editor da planta (vista de cima, arrastar e soltar) para montar setores, máquinas, corredores, áreas, portões e setas.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, dateBR, fail, toast, modal, confirmDialog } from '../lib/ui.js';
import { podePCP, limparCadProducao } from '../lib/producao.js';
import { TIPOS_VISUAIS, TIPOS_AREA, COR, ROTULO_ST, pegada, uid, carregarPlanta, carregarSituacao, desenharIso, desenharBaixa, rascunho, textoMaquina, dur, COR_V, ROT_V, lugaresCaminhoes, textoVeiculo, capKg } from '../lib/planta.js';
import { qtd } from '../lib/compras.js';
import { TIPOS_VEICULO } from '../lib/logistica.js';
import { criarPlanta3D } from '../lib/planta3d.js';
let V3 = null, falhou3d = false;

export const title = 'Planta da fábrica';
const ui = { sel: null, editando: false };
let timer = null;
const celular = () => matchMedia('(max-width: 900px)').matches;
const kg = (v) => Math.round(+v || 0).toLocaleString('pt-BR');
const pctTxt = (v) => (v == null ? '–' : (v * 100).toFixed(1).replace('.', ',') + '%');

export async function render(root) {
  clearInterval(timer);
  root.innerHTML = '<div class="loading">Carregando…</div>';
  let C, planta;
  try { ({ C, planta } = await carregarPlanta()); } catch (err) { fail(err); root.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Se a migração 044 ainda não rodou, rode-a antes.</div></div>'; return; }
  _els = planta.elementos || [];
  if (ui.editando) return editor(root, C, planta);
  const temPlanta = (planta.elementos || []).length || C.maquinas.some(m => m.pos_x != null);
  root.innerHTML = `<div class="pl-pagina">
    <div class="mm-topo"><div><h2 style="margin:0">Planta da fábrica</h2><div class="muted small" id="pl-at">Carregando situação…</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${temPlanta ? '<button class="btn ghost" id="pl-tv">Modo TV</button>' : ''}${podePCP() ? '<button class="btn" id="pl-ed">Editar planta</button>' : ''}</div></div>
    <div class="pl-leg">${Object.entries(ROTULO_ST).map(([k, t]) => `<span><i style="background:${COR[k]}"></i>${t}</span>`).join('')}</div>
    <div id="pl-kpis" class="pl-kpis"></div>
    <div id="pl-cv" class="pl-cv"></div>
    <div id="pl-det" class="card pl-det"></div></div>`;
  $('#pl-ed', root) && ($('#pl-ed', root).onclick = () => { ui.editando = true; render(root); });
  $('#pl-tv', root) && ($('#pl-tv', root).onclick = () => modoTV(true));
  if (!temPlanta) {
    $('#pl-cv', root).innerHTML = `<div class="pl-vazio"><h3>A planta ainda não foi montada</h3><p>Monte os setores e posicione as máquinas no editor. Dá para começar por um rascunho automático, feito a partir dos setores e máquinas cadastrados, e depois arrastar cada coisa para o lugar certo.</p>
      ${podePCP() ? '<button class="btn primary" id="pl-montar">Montar a planta</button>' : '<p class="muted small">Peça a um administrador, financeiro ou diretor para montar.</p>'}</div>`;
    $('#pl-montar', root) && ($('#pl-montar', root).onclick = () => { ui.editando = true; render(root); });
    $('#pl-det', root).remove();
  }
  let S = null;
  const pintar = () => {
    if (!root.isConnected) return;
    $('#pl-at', root).textContent = `Atualizado às ${S.atualizado.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · atualiza sozinho a cada 30 s`;
    const K = S.kpi;
    $('#pl-kpis', root).innerHTML = [['Produzindo', `${K.produzindo} de ${K.total}`, ''], ['Paradas agora', String(K.paradas), K.paradas ? 'neg' : ''], ['Em setup', String(K.setup), ''],
      ['Kg bons hoje', kg(K.kgDia), ''], ['Apara hoje', pctTxt(K.apara), K.apara > .08 ? 'warn' : ''], ['OPs atrasadas', String(K.atrasadas), K.atrasadas ? 'neg' : ''], ...(S.frota ? [['Cargas hoje', `${S.frota.cargasHoje} · ${(S.frota.kgHoje / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t`, '']] : [])]
      .map(([t, v, c]) => `<div class="pl-k"><span>${t}</span><b class="${c}">${v}</b></div>`).join('');
    if (!temPlanta) return;
    if (!ui.sel || (!C.maqById[ui.sel] && !String(ui.sel).startsWith('v:'))) ui.sel = (C.maquinas.find(m => S.maq[m.id]?.st === 'parada' && m.pos_x != null) || C.maquinas.find(m => m.pos_x != null))?.id || null;
    const maqs = C.maquinas.filter(m => m.ativo);
    const cvEl = $('#pl-cv', root), selK = String(ui.sel).startsWith('v:') ? ui.sel : 'm:' + ui.sel;
    if (celular() && !document.body.classList.contains('pl-tv')) { V3 = null; cvEl.innerHTML = desenharBaixa(planta, maqs, S, { modo: 'situacao', sel: selK }); }
    else if (!falhou3d) {
      if (!V3 || !cvEl.querySelector('.p3-wrap')) {
        cvEl.classList.add('pl-cv3');
        criarPlanta3D(cvEl, { aoClicar: (s) => { ui.sel = s.startsWith('m:') ? s.slice(2) : s; pintar(); } })
          .then(v => { V3 = v; V3.montar(planta, maqs, S, selK); detalhe(root, C, S); })
          .catch(() => { falhou3d = true; V3 = null; cvEl.classList.remove('pl-cv3'); pintar(); });
        detalhe(root, C, S); return;
      }
      V3.montar(planta, maqs, S, selK); detalhe(root, C, S); return;
    }
    else cvEl.innerHTML = desenharIso(planta, maqs, S, { sel: ui.sel });
    $$('[data-m]', $('#pl-cv', root)).forEach(g => g.onclick = () => { ui.sel = g.dataset.m; pintar(); });
    $$('[data-v]', $('#pl-cv', root)).forEach(g => g.onclick = () => { ui.sel = 'v:' + g.dataset.v; pintar(); });
    detalhe(root, C, S);
  };
  const atualizar = async () => { try { S = await carregarSituacao(C); pintar(); } catch (err) { if (root.isConnected) fail(err); } };
  await atualizar();
  timer = setInterval(() => { if (!root.isConnected) { clearInterval(timer); modoTV(false); return; } atualizar(); }, 30000);
}

function detalhe(root, C, S) {
  const el = $('#pl-det', root); if (!el) return;
  if (String(ui.sel).startsWith('v:')) return detalheVeiculo(el, planta_els(), S);
  const m = C.maqById[ui.sel];
  if (!m) { el.innerHTML = '<div class="muted small">Toque numa máquina para ver o resumo.</div>'; return; }
  const x = S.maq[m.id], op = x.op, feito = x.etapa ? +x.etapa.qtd_boa : 0;
  const tag = `<span class="pl-tag" style="background:${COR[x.st]}">${esc(ROTULO_ST[x.st])}${x.desde && x.st !== 'livre' ? ' há ' + esc(dur(x.desde)) : ''}</span>`;
  el.innerHTML = `<div class="pl-det-g"><div><div class="muted small">${esc(C.setorById[m.setor_id]?.nome || '')} · ${esc((TIPOS_VISUAIS[m.tipo_visual] || TIPOS_VISUAIS.generica).t)}</div>
      <h3 style="margin:2px 0 6px">${esc(m.codigo)} — ${esc(m.nome)}</h3>${tag}
      ${op ? `<div class="small muted" style="margin:12px 0 4px">OP: ${qtd(feito)} de ${qtd(op.quantidade)} ${esc(op.unidade)} apontados na etapa</div><div class="pl-bar"><i style="width:${Math.min(100, feito / op.quantidade * 100).toFixed(0)}%"></i></div>` : ''}
      <div class="small muted" style="margin-top:8px">Hoje: ${kg(x.kgDia)} kg bons${x.refDia ? ` · apara ${kg(x.refDia)} kg` : ''}${x.bobinasCurso ? ` · ${x.bobinasCurso} bobina(s) nesta produção` : ''}</div>
      ${op ? '<div style="margin-top:12px"><button class="btn small" id="pl-op">Abrir OP</button></div>' : ''}</div>
    <dl class="pl-dl">${x.motivo ? `<dt>Motivo</dt><dd>${esc(x.motivo)}</dd>` : ''}${op ? `<dt>OP</dt><dd>${op.numero}${op.numero_iniflex ? ` · Iniflex ${esc(op.numero_iniflex)}` : ''}</dd><dt>Produto</dt><dd>${esc(op.codigo_produto || '')} ${esc(op.descricao || '')}</dd>
      <dt>Cliente</dt><dd>${esc(op.cliente || '–')}</dd><dt>Entrega</dt><dd>${dateBR(op.entrega) || '–'}</dd>` : '<dt>OP</dt><dd>Nenhuma em produção</dd>'}
      <dt>Operador</dt><dd>${esc(x.operador || '–')}</dd>${m.capacidade_kg_h ? `<dt>Capacidade</dt><dd>${qtd(m.capacidade_kg_h)} kg/h</dd>` : ''}</dl></div>`;
  $('#pl-op', el) && ($('#pl-op', el).onclick = () => { state.abrir = { tipo: 'op', id: op.id }; location.hash = '#/producao/ordens'; });
}

let _els = [];
const planta_els = () => _els;
function detalheVeiculo(el, els, S) {
  const x = lugaresCaminhoes(els, S.frota).find(i => 'v:' + i.v.id === ui.sel);
  if (!x) { el.innerHTML = '<div class="muted small">Caminhão não encontrado.</div>'; return; }
  const v = x.v, c = x.c, pct = c?.peso_kg ? Math.round(+c.peso_kg / +v.carga_kg * 100) : null;
  el.innerHTML = `<div class="pl-det-g"><div><div class="muted small">Frota · ${esc(TIPOS_VEICULO[v.tipo] || v.tipo || '')}${v.placa ? ' · ' + esc(v.placa) : ''}</div><h3 style="margin:2px 0 6px">${esc(v.codigo)}</h3>
      <span class="pl-tag" style="background:${COR_V[x.est]}">${esc(ROT_V[x.est])}</span>
      ${pct != null ? `<div class="small muted" style="margin:12px 0 4px">Ocupação: ${pct}% do peso (${kg(c.peso_kg)} de ${kg(v.carga_kg)} kg)</div><div class="pl-bar"><i style="width:${Math.min(100, pct)}%"></i></div>` : ''}
      <div style="margin-top:12px"><button class="btn small" id="pl-carga">Abrir cargas</button></div></div>
    <dl class="pl-dl"><dt>Situação</dt><dd>${esc(textoVeiculo(x))}</dd>${c ? `<dt>Carga</dt><dd>nº ${c.numero} · ${dateBR(c.data)}</dd>${c.km_previsto ? `<dt>Trajeto</dt><dd>${kg(c.km_previsto)} km previstos</dd>` : ''}` : '<dt>Carga</dt><dd>Nenhuma hoje</dd>'}
      <dt>Motorista</dt><dd>${esc(c?.motorista || v.motorista || '–')}</dd><dt>Capacidade</dt><dd>${kg(v.carga_kg)} kg</dd></dl></div>`;
  $('#pl-carga', el).onclick = () => { location.hash = '#/logistica'; };
}

function modoTV(on) {
  document.body.classList.toggle('pl-tv', on);
  try { if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.(); if (!on && document.fullscreenElement) document.exitFullscreen?.(); } catch {}
  if (on) { const sair = () => { if (!document.fullscreenElement) { document.body.classList.remove('pl-tv'); document.removeEventListener('fullscreenchange', sair); } }; document.addEventListener('fullscreenchange', sair); }
  window.dispatchEvent(new Event('resize'));
}

// ====================================================================== editor
let VEIC = [];
async function editor(root, C, planta) {
  try { VEIC = await q(sb.from('log_veiculos').select('id,codigo,placa').eq('empresa_id', state.empresa.id).order('codigo')); } catch { VEIC = []; }
  const orig = Object.fromEntries(C.maquinas.map(m => [m.id, { pos_x: m.pos_x, pos_y: m.pos_y, rotacao: m.rotacao || 0, tipo_visual: m.tipo_visual || 'generica' }]));
  const D = { L: +planta.largura_m || 60, Pf: +planta.profundidade_m || 30, els: JSON.parse(JSON.stringify(planta.elementos || [])), maqs: C.maquinas.map(m => ({ ...m, rotacao: m.rotacao || 0, tipo_visual: m.tipo_visual || 'generica' })) };
  let sel = null, sujo = false, ver3d = false;
  const snap = (v) => Math.round(v * 2) / 2;
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Editar planta da fábrica</h2><div class="muted small">Arraste para mover, puxe o quadradinho do canto para mudar o tamanho. Grade de 0,5 m. Delete apaga; setas do teclado ajustam.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end"><label>Largura (m)<input id="pe-L" type="number" min="5" max="500" step="1" value="${D.L}" style="width:90px"></label><label>Profundidade (m)<input id="pe-P" type="number" min="5" max="500" step="1" value="${D.Pf}" style="width:90px"></label>
      <button class="btn ghost" id="pe-3d">Ver em 3D</button><button class="btn" id="pe-cancel">Cancelar</button><button class="btn primary" id="pe-ok">Salvar planta</button></div></div>
    <div class="pe-grade"><aside class="card pe-pal" id="pe-pal"></aside><div class="pe-cv" id="pe-cv"></div><aside class="card pe-prop" id="pe-prop"></aside></div>`;
  const cv = $('#pe-cv', root);
  const marcar = () => { sujo = true; };
  const centroVisivel = (w, d) => ({ x: snap(Math.max(0, D.L / 2 - w / 2)), y: snap(Math.max(0, D.Pf / 2 - d / 2)) });
  const elById = (id) => D.els.find(e => e.id === id);
  const maqDe = (s) => s && s.startsWith('m:') ? D.maqs.find(m => m.id === s.slice(2)) : null;

  function paleta() {
    const sem = D.maqs.filter(m => m.ativo && (m.pos_x == null || m.pos_y == null));
    $('#pe-pal', root).innerHTML = `<h3>Elementos</h3><div class="pe-bts">
        <button class="btn small" data-add="setor">▭ Setor</button><button class="btn small" data-add="corredor">═ Corredor</button>
        <button class="btn small" data-add="paletes">▦ Área de paletes</button><button class="btn small" data-add="estoque">▦ Estoque de MP</button>
        <button class="btn small" data-add="expedicao">▦ Expedição</button><button class="btn small" data-add="portao">▬ Portão</button>
        <button class="btn small" data-add="seta">→ Seta de fluxo</button></div>
      <h3>Galpão e pátio</h3><div class="pe-bts">
        <button class="btn small" data-add="parede">▮ Parede</button><button class="btn small" data-add="doca">⇥ Doca</button>
        <button class="btn small" data-add="vaga">▯ Vaga de garagem</button><button class="btn small" data-add="patio">▩ Pátio</button>
        <button class="btn small" data-add="rua">═ Rua / acesso</button><button class="btn small" data-add="guarita">⌂ Guarita</button></div>
      <h3>Cenário</h3><div class="pe-bts">
        <button class="btn small" data-add="telao_p">▣ Telão de produção</button><button class="btn small" data-add="telao_l">▣ Telão de logística</button>
        <button class="btn small" data-add="arvore">✿ Árvore</button></div>
      <h3>Máquinas sem lugar (${sem.length})</h3><div class="pe-lista">${sem.map(m => `<button class="pe-item" data-por="${m.id}"><b>${esc(m.codigo)}</b> ${esc(m.nome)}<span class="small muted">${esc(C.setorById[m.setor_id]?.nome || '')} · ${esc(TIPOS_VISUAIS[m.tipo_visual]?.t || '')}</span></button>`).join('') || '<div class="muted small">Todas as máquinas ativas estão na planta.</div>'}</div>
      <button class="btn small" id="pe-nova" style="width:100%;margin-top:8px">+ Nova máquina</button>
      <h3>Atalhos</h3><button class="btn ghost small" id="pe-rasc" style="width:100%">Rascunho automático</button>
      <p class="small muted">Monta setores lado a lado na ordem do fluxo, com as máquinas de cada um em fila e as setas entre eles. Depois é só arrastar para o lugar real.</p>`;
    $$('[data-add]', root).forEach(b => b.onclick = () => adicionar(b.dataset.add));
    $$('[data-por]', root).forEach(b => b.onclick = () => { const m = D.maqs.find(x => x.id === b.dataset.por), pg = pegada(m), c = centroVisivel(pg.w, pg.d); m.pos_x = c.x; m.pos_y = c.y; sel = 'm:' + m.id; marcar(); tudo(); });
    $('#pe-nova', root).onclick = novaMaquina;
    $('#pe-rasc', root).onclick = async () => {
      if (!C.setores.some(s => s.ativo)) return toast('Cadastre os setores primeiro (ou use + Nova máquina, que cria o setor junto)', true);
      if ((D.els.length || D.maqs.some(m => m.pos_x != null)) && !await confirmDialog('O rascunho substitui o que já está montado nesta edição. Continuar?')) return;
      const R = rascunho({ ...C, maquinas: D.maqs }, D.L, D.Pf); D.els = R.elementos; D.L = R.L; D.Pf = R.Pf; $('#pe-L', root).value = D.L; $('#pe-P', root).value = D.Pf;
      D.maqs.forEach(m => { const p = R.pos[m.id]; if (p) Object.assign(m, p); else if (m.ativo) { m.pos_x = null; m.pos_y = null; } }); sel = null; marcar(); tudo();
    };
  }

  function adicionar(tipo) {
    if (tipo === 'seta') return novaSeta();
    const dims = { setor: [10, 8], corredor: [14, 2.5], portao: [4, 1], paletes: [6, 4], estoque: [8, 4], expedicao: [8, 5], parede: [20, .3], doca: [9, 3.2], vaga: [3, 8.4], patio: [20, 14], rua: [30, 4], guarita: [2.5, 2], telao_p: [5, .5], telao_l: [5, .5], arvore: [2.5, 2.5] }[tipo];
    const c = centroVisivel(...dims), base = { id: uid(), x: c.x, y: c.y, w: dims[0], d: dims[1] };
    let el;
    if (tipo === 'setor') el = { ...base, t: 'setor', nome: 'Novo setor', setor_id: null };
    else if (['paletes', 'estoque', 'expedicao'].includes(tipo)) el = { ...base, t: 'area', tipo, nome: TIPOS_AREA[tipo] };
    else if (tipo === 'doca') el = { ...base, t: 'doca', nome: 'Doca ' + (D.els.filter(e => e.t === 'doca').length + 1) };
    else if (tipo === 'vaga') el = { ...base, t: 'vaga', nome: 'Vaga ' + (D.els.filter(e => e.t === 'vaga').length + 1), veiculo_id: null };
    else if (tipo === 'parede') el = { ...base, t: 'parede', altura: 3 };
    else if (tipo === 'telao_p' || tipo === 'telao_l') el = { ...base, t: 'telao', tipo: tipo === 'telao_p' ? 'producao' : 'logistica', giro: 0 };
    else el = { ...base, t: tipo };
    D.els.push(el); sel = el.id; marcar(); tudo();
  }
  function novaSeta() {
    const rets = D.els.filter(e => e.t === 'setor' || e.t === 'area');
    if (rets.length < 2) return toast('Desenhe pelo menos dois setores ou áreas antes da seta', true);
    const opts = (v) => rets.map(e => `<option value="${e.id}" ${v === e.id ? 'selected' : ''}>${esc(e.nome || TIPOS_AREA[e.tipo] || 'Setor')}</option>`).join('');
    const md = modal({ title: 'Seta de fluxo', body: `<p class="small muted">Entre dois setores, a etiqueta mostra as bobinas paradas esperando a etapa seguinte. De um setor para uma área (ex.: expedição), mostra os kg produzidos hoje no setor.</p>
      <div class="grid-form"><label>De<select id="ns-de">${opts(rets[0].id)}</select></label><label>Para<select id="ns-para">${opts(rets[1].id)}</select></label></div>`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ns-ok">Criar seta</button>' });
    $('#ns-ok', md.el).onclick = () => { const de = $('#ns-de', md.el).value, para = $('#ns-para', md.el).value; if (de === para) return toast('Escolha origem e destino diferentes', true);
      const el = { id: uid(), t: 'seta', de, para }; D.els.push(el); sel = el.id; md.close(); marcar(); tudo(); };
  }
  function novaMaquina() {
    const md = modal({ title: 'Nova máquina', body: `<div class="grid-form"><label>Código<input id="nm-c" placeholder="EXT-01"></label><label>Nome<input id="nm-n" placeholder="Extrusora balão 1"></label>
      <label>Desenho<select id="nm-t">${Object.entries(TIPOS_VISUAIS).map(([k, t]) => `<option value="${k}">${t.t}</option>`).join('')}</select></label>
      <label>Setor<select id="nm-s">${C.setores.map(s => `<option value="${s.id}">${esc(s.nome)}</option>`).join('')}<option value="__novo">+ Novo setor…</option></select></label>
      <label id="nm-sn-l" style="display:none">Nome do novo setor<input id="nm-sn" placeholder="Extrusão"></label><label>Capacidade (kg/h)<input id="nm-cap" placeholder="opcional"></label></div>
      <p class="small muted">A máquina entra no cadastro (Produção › Cadastros) na hora e aparece no centro da planta para você arrastar.</p>`,
      foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="nm-ok">Criar</button>' });
    const vs = () => { $('#nm-sn-l', md.el).style.display = $('#nm-s', md.el).value === '__novo' ? '' : 'none'; };
    $('#nm-s', md.el).onchange = vs; if (!C.setores.length) { $('#nm-s', md.el).value = '__novo'; } vs();
    $('#nm-ok', md.el).onclick = async (ev) => {
      const codigo = $('#nm-c', md.el).value.trim(), nome = $('#nm-n', md.el).value.trim(); if (!codigo || !nome) return toast('Preencha código e nome', true);
      ev.target.disabled = true;
      try {
        let setor = $('#nm-s', md.el).value;
        if (setor === '__novo') { const sn = $('#nm-sn', md.el).value.trim(); if (!sn) { ev.target.disabled = false; return toast('Dê o nome do setor', true); }
          const [s] = await q(sb.from('prod_setores').insert({ empresa_id: state.empresa.id, nome: sn, ordem: C.setores.length + 1 }).select()); C.setores.push(s); C.setorById[s.id] = s; setor = s.id; }
        const capTxt = $('#nm-cap', md.el).value.trim().replace(/\./g, '').replace(',', '.');
        const tipo_visual = $('#nm-t', md.el).value, pg = pegada({ tipo_visual, rotacao: 0 }), c = centroVisivel(pg.w, pg.d);
        const [m] = await q(sb.from('prod_maquinas').insert({ empresa_id: state.empresa.id, codigo, nome, setor_id: setor, tipo_visual, capacidade_kg_h: capTxt ? +capTxt : null }).select());
        C.maquinas.push(m); C.maqById[m.id] = m; orig[m.id] = { pos_x: null, pos_y: null, rotacao: 0, tipo_visual };
        D.maqs.push({ ...m, pos_x: c.x, pos_y: c.y, rotacao: 0 }); sel = 'm:' + m.id; limparCadProducao(); md.close(); marcar(); tudo(); toast('Máquina criada');
      } catch (err) { fail(err); ev.target.disabled = false; }
    };
  }

  function propriedades() {
    const el = $('#pe-prop', root), m = maqDe(sel), e = m ? null : elById(sel);
    if (!m && !e) { el.innerHTML = `<h3>Propriedades</h3><p class="small muted">Selecione um elemento na planta.</p><h3>Como montar</h3><ol class="small muted pe-dicas"><li>Ajuste largura e profundidade do galpão.</li><li>Desenhe os setores e ligue cada um ao setor do cadastro.</li><li>Coloque as máquinas da lista à esquerda e arraste para o lugar.</li><li>Acrescente corredores, portões e áreas.</li><li>Crie as setas na ordem do fluxo.</li><li>Confira em "Ver em 3D" e salve.</li></ol>`; return; }
    const tam = (x) => `<label>Largura (m)<input type="number" step=".5" min=".5" id="pp-w" value="${x.w}"></label><label>Profundidade (m)<input type="number" step=".5" min=".5" id="pp-d" value="${x.d}"></label>`;
    const del = '<button class="btn danger small" id="pp-del" style="margin-top:10px">Excluir da planta</button>';
    if (m) {
      el.innerHTML = `<h3>${esc(m.codigo)}</h3><div class="small muted">${esc(m.nome)} · ${esc(C.setorById[m.setor_id]?.nome || '')}</div>
        <div class="grid-form" style="grid-template-columns:1fr;margin-top:10px"><label>Desenho<select id="pp-tv">${Object.entries(TIPOS_VISUAIS).map(([k, t]) => `<option value="${k}" ${m.tipo_visual === k ? 'selected' : ''}>${t.t}</option>`).join('')}</select></label>
        <div style="display:flex;gap:8px"><label>X (m)<input type="number" step=".5" id="pp-x" value="${m.pos_x}"></label><label>Y (m)<input type="number" step=".5" id="pp-y" value="${m.pos_y}"></label></div></div>
        <button class="btn small" id="pp-rot" style="margin-top:10px">↻ Girar (${+m.rotacao === 90 ? 'ao longo da profundidade' : 'ao longo da largura'})</button><br>
        <button class="btn danger small" id="pp-tirar" style="margin-top:10px">Tirar da planta</button><p class="small muted">Tirar da planta não apaga a máquina do cadastro.</p>`;
      $('#pp-tv', el).onchange = (ev) => { m.tipo_visual = ev.target.value; marcar(); tudo(); };
      $('#pp-x', el).onchange = (ev) => { m.pos_x = snap(+ev.target.value); marcar(); tudo(); };
      $('#pp-y', el).onchange = (ev) => { m.pos_y = snap(+ev.target.value); marcar(); tudo(); };
      $('#pp-rot', el).onclick = () => { m.rotacao = +m.rotacao === 90 ? 0 : 90; marcar(); tudo(); };
      $('#pp-tirar', el).onclick = () => { m.pos_x = null; m.pos_y = null; sel = null; marcar(); tudo(); };
      return;
    }
    if (e.t === 'seta') {
      const rets = D.els.filter(x => x.t === 'setor' || x.t === 'area'), opts = (v) => rets.map(x => `<option value="${x.id}" ${v === x.id ? 'selected' : ''}>${esc(x.nome || 'Setor')}</option>`).join('');
      el.innerHTML = `<h3>Seta de fluxo</h3><div class="grid-form" style="grid-template-columns:1fr"><label>De<select id="pp-de">${opts(e.de)}</select></label><label>Para<select id="pp-para">${opts(e.para)}</select></label></div>${del}`;
      $('#pp-de', el).onchange = (ev) => { e.de = ev.target.value; marcar(); tudo(); }; $('#pp-para', el).onchange = (ev) => { e.para = ev.target.value; marcar(); tudo(); };
    } else {
      const titulo = { setor: 'Setor', area: 'Área', corredor: 'Corredor', portao: 'Portão', parede: 'Parede', doca: 'Doca', vaga: 'Vaga de garagem', patio: 'Pátio', rua: 'Rua / acesso', guarita: 'Guarita', telao: 'Telão', arvore: 'Árvore' }[e.t];
      el.innerHTML = `<h3>${titulo}</h3><div class="grid-form" style="grid-template-columns:1fr">
        ${['setor', 'area', 'doca', 'vaga', 'rua'].includes(e.t) ? `<label>Nome<input id="pp-n" value="${esc(e.nome || '')}"></label>` : ''}
        ${e.t === 'parede' ? `<label>Altura (m)<input type="number" step=".5" min=".3" id="pp-alt" value="${e.altura ?? 3}"></label><p class="small muted" style="margin:0">Paredes da frente ficam melhores baixas (0,5 m), para não esconder o que está dentro no 3D.</p>` : ''}
        ${e.t === 'vaga' ? `<label>Caminhão fixo desta vaga<select id="pp-vv"><option value="">— qualquer —</option>${VEIC.map(v => `<option value="${v.id}" ${e.veiculo_id === v.id ? 'selected' : ''}>${esc(v.codigo)}${v.placa ? ' · ' + esc(v.placa) : ''}</option>`).join('')}</select></label>` : ''}
        ${e.t === 'doca' ? '<p class="small muted" style="margin:0">O caminhão aparece aqui enquanto a carga está carregando ou pronta.</p>' : ''}
        ${e.t === 'rua' ? '<p class="small muted" style="margin:0">Caminhões em rota aparecem aqui.</p>' : ''}
        ${e.t === 'telao' ? `<label>Mostra<select id="pp-tl"><option value="producao" ${e.tipo === 'producao' ? 'selected' : ''}>Números da produção</option><option value="logistica" ${e.tipo === 'logistica' ? 'selected' : ''}>Números da logística</option></select></label>
          <button class="btn small" id="pp-gt" type="button">↻ Girar 45°</button>` : ''}
        ${e.t === 'setor' ? `<label>Setor do cadastro<select id="pp-s"><option value="">— nenhum —</option>${C.setores.map(s => `<option value="${s.id}" ${e.setor_id === s.id ? 'selected' : ''}>${esc(s.nome)}</option>`).join('')}</select></label>
          <p class="small muted" style="margin:0">Ligar ao cadastro faz a seta mostrar o material parado entre as etapas.</p>` : ''}
        ${e.t === 'area' ? `<label>Tipo<select id="pp-ta">${Object.entries(TIPOS_AREA).map(([k, t]) => `<option value="${k}" ${e.tipo === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>` : ''}
        <div style="display:flex;gap:8px">${tam(e)}</div></div>${del}`;
      $('#pp-n', el) && ($('#pp-n', el).oninput = (ev) => { e.nome = ev.target.value; marcar(); desenhar(); });
      $('#pp-s', el) && ($('#pp-s', el).onchange = (ev) => { e.setor_id = ev.target.value || null; if (e.setor_id && (!e.nome || e.nome === 'Novo setor')) { e.nome = C.setorById[e.setor_id].nome; } marcar(); tudo(); });
      $('#pp-alt', el) && ($('#pp-alt', el).onchange = (ev) => { e.altura = Math.max(.3, +ev.target.value || 3); marcar(); desenhar(); });
      $('#pp-vv', el) && ($('#pp-vv', el).onchange = (ev) => { e.veiculo_id = ev.target.value || null; marcar(); });
      $('#pp-tl', el) && ($('#pp-tl', el).onchange = (ev) => { e.tipo = ev.target.value; marcar(); });
      $('#pp-gt', el) && ($('#pp-gt', el).onclick = () => { e.giro = ((e.giro || 0) + 1) % 8; marcar(); });
      $('#pp-ta', el) && ($('#pp-ta', el).onchange = (ev) => { e.tipo = ev.target.value; marcar(); tudo(); });
      $('#pp-w', el).onchange = (ev) => { e.w = Math.max(.5, snap(+ev.target.value)); marcar(); tudo(); };
      $('#pp-d', el).onchange = (ev) => { e.d = Math.max(.5, snap(+ev.target.value)); marcar(); tudo(); };
    }
    $('#pp-del', el).onclick = () => excluir();
  }
  function excluir() {
    const m = maqDe(sel); if (m) { m.pos_x = null; m.pos_y = null; }
    else { D.els = D.els.filter(x => x.id !== sel && x.de !== sel && x.para !== sel); }
    sel = null; marcar(); tudo();
  }

  // ---- desenho e arrastar
  function desenhar() {
    const plt = { largura_m: D.L, profundidade_m: D.Pf, elementos: D.els };
    if (ver3d) { const maqs = D.maqs.filter(m => m.ativo); if (cv.querySelector('.p3-wrap')) return; criarPlanta3D(cv).then(v => v.montar(plt, maqs, null, null)).catch(() => { cv.innerHTML = desenharIso(plt, maqs, null, {}); }); return; }
    cv.innerHTML = desenharBaixa(plt, D.maqs.filter(m => m.ativo), null, { modo: 'editor', sel });
  }
  function tudo() { desenhar(); paleta(); propriedades(); $('#pe-3d', root).textContent = ver3d ? 'Voltar a editar' : 'Ver em 3D'; }
  const ponto = (ev) => { const svg = cv.querySelector('svg'), p = svg.createSVGPoint(); p.x = ev.clientX; p.y = ev.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  let arr = null;
  cv.addEventListener('pointerdown', (ev) => {
    if (ver3d) return;
    const alca = ev.target.closest('[data-alca]'), g = ev.target.closest('[data-el]');
    if (!g && !alca) { if (sel) { sel = null; tudo(); } return; }
    const id = alca ? alca.dataset.alca : g.dataset.el; const p = ponto(ev);
    if (sel !== id) { sel = id; desenhar(); propriedades(); }
    const m = maqDe(id), e = m ? null : elById(id);
    if (e?.t === 'seta') return;
    arr = { id, alca: !!alca, p0: p, o: m ? { x: +m.pos_x, y: +m.pos_y } : { x: e.x, y: e.y, w: e.w, d: e.d } };
    ev.preventDefault();
  });
  const mover = (ev) => {
    if (!arr) return; const p = ponto(ev), dx = p.x - arr.p0.x, dy = p.y - arr.p0.y;
    const m = maqDe(arr.id), e = m ? null : elById(arr.id);
    if (m) { const pg = pegada(m); m.pos_x = Math.min(Math.max(0, snap(arr.o.x + dx)), D.L - pg.w); m.pos_y = Math.min(Math.max(0, snap(arr.o.y + dy)), D.Pf - pg.d); }
    else if (arr.alca) { e.w = Math.max(.5, Math.min(snap(arr.o.w + dx), D.L - e.x)); e.d = Math.max(.5, Math.min(snap(arr.o.d + dy), D.Pf - e.y)); }
    else { e.x = Math.min(Math.max(0, snap(arr.o.x + dx)), D.L - e.w); e.y = Math.min(Math.max(0, snap(arr.o.y + dy)), D.Pf - e.d); }
    marcar(); desenhar();
  };
  const soltar = () => { if (arr) { arr = null; propriedades(); } };
  window.addEventListener('pointermove', mover); window.addEventListener('pointerup', soltar);
  const tecla = (ev) => {
    if (!root.isConnected) { window.removeEventListener('keydown', tecla); window.removeEventListener('pointermove', mover); window.removeEventListener('pointerup', soltar); return; }
    if (!sel || ver3d || /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName)) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); return excluir(); }
    const d = { ArrowLeft: [-.5, 0], ArrowRight: [.5, 0], ArrowUp: [0, -.5], ArrowDown: [0, .5] }[ev.key]; if (!d) return;
    ev.preventDefault(); const m = maqDe(sel), e = m ? null : elById(sel);
    if (m && m.pos_x != null) { m.pos_x = Math.max(0, +m.pos_x + d[0]); m.pos_y = Math.max(0, +m.pos_y + d[1]); } else if (e && e.t !== 'seta') { e.x = Math.max(0, e.x + d[0]); e.y = Math.max(0, e.y + d[1]); }
    marcar(); desenhar(); propriedades();
  };
  window.addEventListener('keydown', tecla);

  $('#pe-L', root).onchange = (ev) => { D.L = Math.min(500, Math.max(5, +ev.target.value || 60)); marcar(); desenhar(); };
  $('#pe-P', root).onchange = (ev) => { D.Pf = Math.min(500, Math.max(5, +ev.target.value || 30)); marcar(); desenhar(); };
  $('#pe-3d', root).onclick = () => { ver3d = !ver3d; tudo(); };
  $('#pe-cancel', root).onclick = async () => { if (sujo && !await confirmDialog('Sair sem salvar as mudanças da planta?')) return; ui.editando = false; render(root); };
  $('#pe-ok', root).onclick = async (ev) => {
    ev.target.disabled = true;
    try {
      const e = state.empresa.id;
      await q(sb.from('prod_planta').upsert({ empresa_id: e, largura_m: D.L, profundidade_m: D.Pf, elementos: D.els, atualizado_em: new Date().toISOString() }, { onConflict: 'empresa_id' }));
      const mud = D.maqs.filter(m => { const o = orig[m.id] || {}; return String(o.pos_x ?? '') !== String(m.pos_x ?? '') || String(o.pos_y ?? '') !== String(m.pos_y ?? '') || +o.rotacao !== +m.rotacao || o.tipo_visual !== m.tipo_visual; });
      for (const m of mud) await q(sb.from('prod_maquinas').update({ pos_x: m.pos_x, pos_y: m.pos_y, rotacao: +m.rotacao, tipo_visual: m.tipo_visual }).eq('id', m.id));
      limparCadProducao(); ui.editando = false; toast('Planta salva'); render(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
  tudo();
}
