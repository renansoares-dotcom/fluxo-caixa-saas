// Produção › Terminal do setor: tela de chão de fábrica (botões grandes). Cada operador entra com o próprio acesso.
// Por máquina: iniciar produção numa etapa de OP, registrar bobina (etiqueta com QR), parada com motivo, encerrar com kg bons e apara.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, dateBR, fail, toast, modal } from '../lib/ui.js';
import { cadProducao, imprimirEtiquetas } from '../lib/producao.js';
import { qtd, num } from '../lib/compras.js';

export const title = 'Terminal de produção';
let C = null, timer = null;
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const dur = (ini) => { const m = Math.max(0, Math.round((Date.now() - new Date(ini)) / 60000)); return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`; };

export async function render(root) {
  clearInterval(timer);
  try { C = await cadProducao(true); } catch (err) { fail(err); return; }
  const meu = C.operadores.find(o => o.user_id === state.user?.id && o.ativo);
  const setores = C.setores.filter(s => s.ativo && (!meu?.setores?.length || meu.setores.includes(s.id)));
  let setorId = lsGet('terminal-setor'); if (!setores.some(s => s.id === setorId)) setorId = setores[0]?.id;
  if (!setores.length) { root.innerHTML = '<div class="card"><div class="empty">Nenhum setor cadastrado (Produção › Cadastros).</div></div>'; return; }
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Terminal — <select id="tm-s" class="tm-sel">${setores.map(s => `<option value="${s.id}" ${s.id === setorId ? 'selected' : ''}>${esc(s.nome)}</option>`).join('')}</select></h2>
      <div class="muted small">${meu ? `Operador: <b>${esc(meu.nome)}</b>` : '<span class="warn">Seu usuário não está ligado a um operador (Produção › Cadastros › Operadores). Os apontamentos ficam sem operador.</span>'}</div></div>
      <button class="btn ghost" id="tm-at">Atualizar</button></div>
    <div id="tm-corpo" class="tm-grid"><div class="loading">Carregando…</div></div>`;
  $('#tm-s', root).onchange = (e) => { lsSet('terminal-setor', e.target.value); render(root); };
  $('#tm-at', root).onclick = () => render(root);
  await pintar(root, setorId, meu);
  timer = setInterval(() => { if (!document.body.contains(root.querySelector('#tm-corpo'))) return clearInterval(timer); $$('[data-ini]', root).forEach(el => { el.textContent = dur(el.dataset.ini); }); }, 30000);
}

async function pintar(root, setorId, meu) {
  const e = state.empresa.id, maqs = C.maquinas.filter(m => m.ativo && m.setor_id === setorId);
  let abertos = [], paradas = [], etapas = [], ops = [];
  try {
    [abertos, paradas, etapas] = await Promise.all([
      q(sb.from('prod_apontamentos').select('*').eq('empresa_id', e).is('fim', null).in('maquina_id', maqs.map(m => m.id).concat(['00000000-0000-0000-0000-000000000000']))),
      q(sb.from('prod_paradas').select('*').eq('empresa_id', e).is('fim', null).in('maquina_id', maqs.map(m => m.id).concat(['00000000-0000-0000-0000-000000000000']))),
      q(sb.from('prod_ordem_etapas').select('*').eq('empresa_id', e).eq('setor_id', setorId).neq('status', 'concluida'))]);
    const ids = [...new Set([...etapas.map(x => x.ordem_id), ...abertos.map(a => a.ordem_id)])];
    ops = ids.length ? await q(sb.from('prod_ordens').select('*').in('id', ids)) : [];
  } catch (err) { return fail(err); }
  const opById = Object.fromEntries(ops.map(o => [o.id, o]));
  const fila = etapas.filter(x => ['liberada', 'em_producao'].includes(opById[x.ordem_id]?.status))
    .sort((a, b) => opById[a.ordem_id].prioridade - opById[b.ordem_id].prioridade || String(opById[a.ordem_id].entrega || '9').localeCompare(String(opById[b.ordem_id].entrega || '9')));
  const corpo = $('#tm-corpo', root);
  corpo.innerHTML = maqs.map(m => {
    const ap = abertos.find(a => a.maquina_id === m.id), pa = paradas.find(p => p.maquina_id === m.id), op = ap ? opById[ap.ordem_id] : null;
    const est = pa ? 'parada' : ap ? 'produzindo' : 'livre';
    return `<div class="card tm-maq tm-${est}"><div class="tm-cab"><div><div class="tm-cod">${esc(m.codigo)}</div><div class="small muted">${esc(m.nome)}</div></div><span class="tm-est">${{ livre: 'Livre', produzindo: 'Produzindo', parada: 'Parada' }[est]}</span></div>
      ${op ? `<div class="tm-op"><b>OP ${op.numero}</b>${op.numero_iniflex ? ` · ${esc(op.numero_iniflex)}` : ''}<div class="small">${esc(op.codigo_produto || '')} ${esc(op.descricao || '')}</div><div class="small muted">${esc(op.cliente || '')} · desde <span data-ini="${ap.inicio}">${dur(ap.inicio)}</span></div></div>` : ''}
      ${pa ? `<div class="tm-op warn"><b>${esc(C.motById[pa.motivo_id]?.nome || 'Parada')}</b> há <span data-ini="${pa.inicio}">${dur(pa.inicio)}</span></div>` : ''}
      <div class="tm-bts">
        ${est === 'livre' ? `<button class="btn primary tm-b" data-act="iniciar" data-m="${m.id}">Iniciar produção</button><button class="btn tm-b" data-act="parar" data-m="${m.id}">Parada</button>` : ''}
        ${est === 'produzindo' ? `<button class="btn primary tm-b" data-act="bobina" data-m="${m.id}">Registrar bobina</button><button class="btn tm-b" data-act="parar" data-m="${m.id}">Parada</button><button class="btn tm-b" data-act="encerrar" data-m="${m.id}">Encerrar</button>` : ''}
        ${est === 'parada' ? `<button class="btn primary tm-b" data-act="retomar" data-m="${m.id}">Retomar</button>` : ''}</div></div>`;
  }).join('') || '<div class="card"><div class="empty">Nenhuma máquina ativa neste setor.</div></div>';
  corpo.insertAdjacentHTML('beforeend', `<div class="card tm-fila"><h3 style="margin:0 0 6px">Fila do setor</h3>${fila.slice(0, 12).map(x => { const o = opById[x.ordem_id];
    return `<div class="small" style="padding:4px 0;border-bottom:1px solid var(--border)"><b>OP ${o.numero}</b> · P${o.prioridade} · ${esc(o.codigo_produto || '')} ${esc(o.descricao || '')} · ${qtd(o.quantidade)} ${esc(o.unidade)}${o.entrega ? ` · entrega ${dateBR(o.entrega)}` : ''}${x.maquina_id ? ` · ${esc(C.maqById[x.maquina_id]?.codigo || '')}` : ''}</div>`; }).join('') || '<div class="muted small">Nenhuma OP liberada para este setor.</div>'}</div>`);
  $$('[data-act]', corpo).forEach(b => b.onclick = () => acao(b.dataset.act, C.maqById[b.dataset.m], { abertos, paradas, fila, opById, meu, root, setorId }));
}

async function acao(act, m, X) {
  const e = state.empresa.id, ap = X.abertos.find(a => a.maquina_id === m.id), pa = X.paradas.find(p => p.maquina_id === m.id);
  const recarregar = () => render(X.root);
  try {
    if (act === 'iniciar') {
      const fila = X.fila.filter(x => !x.maquina_id || x.maquina_id === m.id);
      if (!fila.length) return toast('Nenhuma OP liberada para esta máquina/setor', true);
      const md = modal({ title: `Iniciar produção — ${m.codigo}`, body: `<div class="tm-lista">${fila.map(x => { const o = X.opById[x.ordem_id];
        return `<button class="btn tm-item" data-e="${x.id}"><b>OP ${o.numero}</b> · ${esc(o.codigo_produto || '')} ${esc(o.descricao || '')}<br><span class="small muted">${esc(o.cliente || '')} · ${qtd(o.quantidade)} ${esc(o.unidade)} · feito ${qtd(x.qtd_boa)}${o.entrega ? ` · entrega ${dateBR(o.entrega)}` : ''}</span></button>`; }).join('')}</div>` });
      $$('[data-e]', md.el).forEach(b => b.onclick = async () => { const x = fila.find(f => f.id === b.dataset.e);
        try { await q(sb.from('prod_apontamentos').insert({ empresa_id: e, ordem_id: x.ordem_id, etapa_id: x.id, setor_id: X.setorId, maquina_id: m.id, operador_id: X.meu?.id || null, operador_nome: X.meu?.nome || state.user?.email || null }));
          md.close(); toast('Produção iniciada'); recarregar(); } catch (err) { fail(err); } });
    }
    if (act === 'parar') {
      const mots = C.motivos.filter(x => x.tipo === 'parada' && x.ativo);
      const md = modal({ title: `Parada — ${m.codigo}`, body: `<div class="tm-lista">${mots.map(x => `<button class="btn tm-item" data-mt="${x.id}">${esc(x.nome)}${x.planejada ? ' <span class="small muted">(planejada)</span>' : ''}</button>`).join('') || '<p class="muted">Cadastre os motivos de parada em Produção › Cadastros.</p>'}</div>` });
      $$('[data-mt]', md.el).forEach(b => b.onclick = async () => { try { await q(sb.from('prod_paradas').insert({ empresa_id: e, maquina_id: m.id, ordem_id: ap?.ordem_id || null, motivo_id: b.dataset.mt, operador_id: X.meu?.id || null }));
        md.close(); toast('Parada registrada'); recarregar(); } catch (err) { fail(err); } });
    }
    if (act === 'retomar') { await q(sb.from('prod_paradas').update({ fim: new Date().toISOString() }).eq('id', pa.id)); toast('Máquina retomada'); recarregar(); }
    if (act === 'bobina') {
      const op = X.opById[ap.ordem_id];
      const md = modal({ title: `Bobina — OP ${op.numero}`, body: `<div class="grid-form tm-form"><label>Peso (kg) *<input id="bb-p" inputmode="decimal"></label><label>Metros<input id="bb-m" inputmode="decimal"></label>
        <label>Quantidade (un./milheiros)<input id="bb-q" inputmode="decimal"></label><label>Bobina mãe (código)<input id="bb-mae" placeholder="leia o QR ou digite"></label><label class="span2">Lote da matéria-prima<input id="bb-l"></label></div>`,
        foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary tm-b" id="bb-ok">Registrar e imprimir etiqueta</button>` });
      $('#bb-ok', md.el).onclick = async (ev) => {
        const peso = num($('#bb-p', md.el).value); if (!(peso > 0)) return toast('Informe o peso', true);
        ev.target.disabled = true;
        try {
          const maeCod = $('#bb-mae', md.el).value.trim(); let mae = null;
          if (maeCod) { mae = (await q(sb.from('prod_bobinas').select('id,lote_materia').eq('empresa_id', e).eq('codigo', maeCod)))[0]; if (!mae) { ev.target.disabled = false; return toast('Bobina mãe não encontrada', true); } }
          const et = (await q(sb.from('prod_ordem_etapas').select('seq').eq('id', ap.etapa_id)))[0];
          const n = (await q(sb.from('prod_bobinas').select('id').eq('ordem_id', op.id).eq('etapa_id', ap.etapa_id))).length + 1;
          const b = await q(sb.from('prod_bobinas').insert({ empresa_id: e, codigo: `B${op.numero}-${et?.seq || 1}-${String(n).padStart(3, '0')}`, ordem_id: op.id, etapa_id: ap.etapa_id, apontamento_id: ap.id, maquina_id: m.id,
            peso_kg: peso, metros: $('#bb-m', md.el).value ? num($('#bb-m', md.el).value) : null, quantidade: $('#bb-q', md.el).value ? num($('#bb-q', md.el).value) : null, mae_id: mae?.id || null,
            lote_materia: $('#bb-l', md.el).value.trim() || mae?.lote_materia || null, operador_id: X.meu?.id || null }).select('*').single());
          md.close(); toast(`Bobina ${b.codigo} registrada`); imprimirEtiquetas([b], op, (id) => C.maqById[id]?.codigo || '');
        } catch (err) { fail(err); ev.target.disabled = false; }
      };
    }
    if (act === 'encerrar') {
      const bob = await q(sb.from('prod_bobinas').select('peso_kg,quantidade').eq('apontamento_id', ap.id));
      const op = X.opById[ap.ordem_id], somaKg = bob.reduce((t, b) => t + +b.peso_kg, 0), somaQ = bob.reduce((t, b) => t + (+b.quantidade || 0), 0);
      const sug = op.unidade === 'KG' ? somaKg : somaQ;
      const mots = C.motivos.filter(x => x.tipo === 'refugo' && x.ativo);
      const md = modal({ title: `Encerrar — OP ${op.numero} em ${m.codigo}`, body: `<p class="small" style="margin-top:0">${bob.length} bobina(s) registradas neste apontamento${somaKg ? ` · ${qtd(somaKg)} kg` : ''}.</p>
        <div class="grid-form tm-form"><label>Produzido bom (${esc(op.unidade)}) *<input id="en-b" inputmode="decimal" value="${sug ? String(Math.round(sug * 1000) / 1000).replace('.', ',') : ''}"></label>
        <label>Apara / refugo (kg)<input id="en-r" inputmode="decimal" value="0"></label>
        <label>Motivo do refugo<select id="en-m"><option value="">—</option>${mots.map(x => `<option value="${x.id}">${esc(x.nome)}</option>`).join('')}</select></label>
        <label>Turno<select id="en-t"><option value="">—</option><option>1º</option><option>2º</option><option>3º</option></select></label>
        <label class="span2">Observação<input id="en-o"></label></div>`,
        foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary tm-b" id="en-ok">Encerrar apontamento</button>` });
      $('#en-ok', md.el).onclick = async (ev) => {
        const boa = num($('#en-b', md.el).value), ref = num($('#en-r', md.el).value);
        if (!(boa >= 0) || $('#en-b', md.el).value.trim() === '') return toast('Informe a quantidade boa', true);
        if (ref > 0 && !$('#en-m', md.el).value && mots.length) return toast('Escolha o motivo do refugo', true);
        ev.target.disabled = true;
        try { await q(sb.from('prod_apontamentos').update({ fim: new Date().toISOString(), qtd_boa: boa, refugo: ref, refugo_motivo_id: $('#en-m', md.el).value || null, turno: $('#en-t', md.el).value || null, observacao: $('#en-o', md.el).value.trim() || null }).eq('id', ap.id));
          if (pa) await q(sb.from('prod_paradas').update({ fim: new Date().toISOString() }).eq('id', pa.id));
          md.close(); toast('Apontamento encerrado'); recarregar(); } catch (err) { fail(err); ev.target.disabled = false; }
      };
    }
  } catch (err) { fail(err); }
}
