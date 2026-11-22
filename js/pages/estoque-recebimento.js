// Compras › Estoque › Recebimento de Notas (EST011) — SQL 186, 22/11/2026.
// Com a entrada pelo recebimento ligada, a nota de compra fica "a receber" e só entra no estoque quando quem atende o almoxarifado
// confere o material na chegada: item a item, pelo celular, leitor ou câmera; a conferência é cega por parâmetro; entra o que chegou
// em bom estado, na data da chegada, ao custo da nota; falta, sobra e avaria vão como aviso para Compras.
import { sb, state, q, isAdmin } from '../lib/data.js';
import { $, $$, esc, money, fail, toast, modal, dateBR, parseNum, today } from '../lib/ui.js';

export const title = 'Recebimento de Notas';
let D = null;
const n = (v, d = 4) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d }));
const SIT = { a_receber: ['A receber', 'aberto'], conferindo: ['Conferindo', 'negoc'], conferido: ['Recebida', 'pago'], dispensado: ['Dispensada', ''], cancelado: ['Cancelada', ''] };
const badge = (s) => `<span class="badge ${SIT[s]?.[1] || ''}">${SIT[s]?.[0] || s}</span>`;
const ir = (root, r) => { history.replaceState(null, '', '#/estoque/recebimento' + (r ? '?r=' + r : '')); render(root); };

export async function render(root) {
  const rid = new URLSearchParams(location.hash.split('?')[1] || '').get('r');
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try {
    const e = state.empresa.id;
    const [cfg, pode] = await Promise.all([q(sb.from('est_config').select('entrada_por,receb_desde,receb_cega,receb_tolerancia_pct,implantado_em').eq('empresa_id', e).maybeSingle()).catch(() => null),
      q(sb.rpc('alm_almoxarife', { p_empresa: e })).catch(() => false)]);
    D = { cfg: { entrada_por: 'emissao', receb_cega: true, receb_tolerancia_pct: 0.5, ...(cfg || {}) }, pode: !!pode };
    if (rid) {
      const r = (await q(sb.from('est_recebimentos').select('*').eq('id', rid).maybeSingle()));
      if (r) return r.situacao === 'conferindo' && D.pode ? conferir(root, r) : ficha(root, r);
    }
    await lista(root);
  } catch (err) { fail(err); root.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 186 já foi executado.</div></div>'; }
}

async function lista(root) {
  const ligado = D.cfg.entrada_por === 'recebimento';
  const [fila, feitos] = ligado ? await Promise.all([q(sb.rpc('est_receb_fila', { p_empresa: state.empresa.id })),
    q(sb.from('est_recebimentos').select('id,numero,nota_id,situacao,data,conferente_nome,conferido_em,divergencias,observacao,nfe_notas(numero,emit_nome,emissao)').eq('empresa_id', state.empresa.id)
      .in('situacao', ['conferido', 'dispensado']).order('numero', { ascending: false }).limit(100))]) : [[], []];
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Recebimento de Notas</h2><div class="muted small">A nota de compra entra no estoque quando o material é conferido na chegada.</div></div>
    <div style="display:flex;gap:8px">${isAdmin() ? '<button class="btn" id="rc-par">Parâmetros</button>' : ''}</div></div>
    ${ligado ? '' : `<div class="card small" style="border-left:3px solid var(--warn);margin-bottom:12px">A entrada pelo recebimento está <b>desligada</b>: a nota de compra entra no estoque na data de emissão, sem conferência.${isAdmin() ? ' Ligue em Parâmetros.' : ''}</div>`}
    ${ligado && !D.cfg.implantado_em ? '<div class="card small" style="border-left:3px solid var(--warn);margin-bottom:12px">O estoque ainda não foi implantado: as conferências ficam registradas, e o que chegar a partir da implantação entra no estoque.</div>' : ''}
    ${ligado ? `<div class="kpis" style="margin-bottom:12px"><div class="kpi"><div class="k-label">A receber</div><div class="k-value">${fila.filter(f => f.situacao === 'a_receber').length}</div><div class="k-sub">notas emitidas a partir de ${dateBR(D.cfg.receb_desde)}</div></div>
      <div class="kpi"><div class="k-label">Em conferência</div><div class="k-value">${fila.filter(f => f.situacao === 'conferindo').length}</div><div class="k-sub">começadas e não concluídas</div></div>
      <div class="kpi"><div class="k-label">Mais antiga</div><div class="k-value ${fila.some(f => f.dias > 15) ? 'warn' : ''}">${fila.length ? Math.max(...fila.map(f => f.dias)) + ' dias' : '—'}</div><div class="k-sub">desde a emissão</div></div>
      <div class="kpi"><div class="k-label">Com divergência</div><div class="k-value">${feitos.filter(f => f.divergencias > 0).length}</div><div class="k-sub">nas últimas 100 recebidas</div></div></div>
    <div class="card flush" style="margin-bottom:12px"><div style="padding:10px 14px"><b>Notas a receber</b></div><div class="table-wrap"><table><thead><tr><th>NF</th><th>Fornecedor</th><th>Emissão</th><th class="num">Dias</th><th class="num">Itens</th>${fila.some(f => f.v_nf != null) ? '<th class="num">Valor</th>' : ''}<th>Situação</th><th></th></tr></thead><tbody>
      ${fila.map(f => `<tr><td><b>${f.numero}</b>${f.serie ? `<span class="muted small">-${esc(f.serie)}</span>` : ''}</td><td>${esc(f.emit_nome || f.emit_doc || '')}</td><td>${dateBR(f.emissao)}</td><td class="num ${f.dias > 15 ? 'warn' : ''}">${f.dias}</td>
        <td class="num">${f.situacao === 'conferindo' ? `${f.contados} de ${f.itens}` : f.itens}</td>${fila.some(x => x.v_nf != null) ? `<td class="num">${money(f.v_nf)}</td>` : ''}<td>${badge(f.situacao)}${f.conferente_nome ? ` <span class="muted small">${esc(f.conferente_nome)}</span>` : ''}</td>
        <td style="white-space:nowrap">${D.pode ? `<button class="btn primary small" data-conf="${f.nota_id}">${f.situacao === 'conferindo' ? 'Continuar' : 'Conferir'}</button> <button class="btn ghost small" data-disp="${f.nota_id}" data-num="${f.numero}">Sem material</button>` : ''}</td></tr>`).join('')
        || '<tr><td colspan="8" class="empty">Nenhuma nota a receber.</td></tr>'}</tbody></table></div></div>
    <div class="card flush"><div style="padding:10px 14px"><b>Recebidas e dispensadas</b></div><div class="table-wrap"><table><thead><tr><th>Nº</th><th>NF</th><th>Fornecedor</th><th>Chegada</th><th>Conferida por</th><th>Situação</th><th class="num">Divergências</th></tr></thead><tbody>
      ${feitos.map(r => `<tr data-r="${r.id}" style="cursor:pointer"><td>${r.numero}</td><td>${r.nfe_notas?.numero ?? ''}</td><td>${esc(r.nfe_notas?.emit_nome || '')}</td><td>${r.data ? dateBR(r.data) : '—'}</td><td>${esc(r.conferente_nome || '')}</td>
        <td>${badge(r.situacao)}</td><td class="num ${r.divergencias ? 'neg' : ''}">${r.divergencias || '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nenhum recebimento ainda.</td></tr>'}</tbody></table></div></div>` : ''}`;
  $('#rc-par', root) && ($('#rc-par', root).onclick = () => parametros(root));
  $$('[data-conf]', root).forEach(b => b.onclick = async () => { try { ir(root, await q(sb.rpc('est_receb_iniciar', { p_nota: b.dataset.conf }))); } catch (e) { fail(e); } });
  $$('[data-r]', root).forEach(tr => tr.onclick = () => ir(root, tr.dataset.r));
  $$('[data-disp]', root).forEach(b => b.onclick = async () => {
    const mot = (prompt(`NF ${b.dataset.num}: por que não há material para receber? (ex.: nota de serviço, energia, frete)`) || '').trim(); if (!mot) return;
    try { await q(sb.rpc('est_receb_dispensar', { p_nota: b.dataset.disp, p_motivo: mot })); toast('Nota dispensada'); render(root); } catch (e) { fail(e); } });
}

async function conferir(root, r) {
  const [its, nota] = await Promise.all([q(sb.rpc('est_receb_itens', { p_receb: r.id })), q(sb.from('nfe_notas').select('numero,serie,emit_nome,emissao').eq('id', r.nota_id).maybeSingle()).catch(() => null)]);
  const cega = its.every(i => i.qtd_nota == null), falta = its.filter(i => i.contada == null), temCam = 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;
  const rot = (i) => `${esc(i.xprod || '')} <span class="muted small">${esc(i.cprod || '')}${i.produto_codigo ? ' → ' + esc(i.produto_codigo) : ' · sem de-para'}</span>`;
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Conferência — NF ${nota?.numero ?? ''} ${esc(nota?.emit_nome || '')}</h2>
      <div class="muted small">Emissão ${dateBR(nota?.emissao)} · ${its.length - falta.length} de ${its.length} itens conferidos${cega ? ' · conferência cega: conte o que chegou, sem a nota' : ''}</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="cf-v">← Recebimento</button><button class="btn primary" id="cf-fim">Concluir o recebimento</button></div></div>
    <form id="cf-f" class="card" style="display:grid;grid-template-columns:1fr 140px 140px auto;gap:8px;align-items:end;margin-bottom:12px">
      <label>Leia a etiqueta ou digite o código<input id="cf-cod" autocomplete="off" placeholder="Etiqueta, código do produto ou do fornecedor" style="font-size:1.1em" autofocus></label>
      <label>Chegou (unid. da nota)<input id="cf-q" inputmode="decimal" style="font-size:1.1em"></label>
      <label>Avariado<input id="cf-a" inputmode="decimal" placeholder="0" style="font-size:1.1em"></label><button class="btn primary" style="min-height:44px">Registrar</button>
      <div id="cf-it" class="small" style="grid-column:1/-1"></div>
      ${temCam ? '<div style="grid-column:1/-1"><button type="button" class="btn" id="cf-cam" style="min-height:44px">Ler pela câmera</button><video id="cf-video" playsinline muted hidden style="width:100%;max-width:420px;border-radius:12px;background:#000;aspect-ratio:4/3;object-fit:cover;display:block;margin-top:8px"></video></div>' : ''}</form>
    <div class="card flush"><div class="table-wrap"><table class="small"><thead><tr><th>#</th><th>Item da nota</th><th>Unid.</th>${cega ? '' : '<th class="num">Nota</th>'}<th class="num">Chegou</th><th class="num">Avariado</th><th></th></tr></thead><tbody id="cf-tb"></tbody></table></div></div>`;
  const pinta = () => { $('#cf-tb', root).innerHTML = its.map(i => `<tr><td>${i.n_item}</td><td>${rot(i)}</td><td>${esc(i.ucom || '')}</td>${cega ? '' : `<td class="num">${n(i.qtd_nota)}</td>`}
      <td class="num">${i.contada == null ? '<span class="muted">a conferir</span>' : `<b>${n(i.contada)}</b>`}</td><td class="num">${+i.avariada ? n(i.avariada) : ''}</td>
      <td><button class="btn ghost small" data-it="${i.item_id}">${i.contada == null ? 'Conferir' : 'Corrigir'}</button></td></tr>`).join('');
    $$('[data-it]', root).forEach(b => b.onclick = () => escolher(its.find(x => x.item_id === b.dataset.it))); };
  let alvo = null, recemLido = false;
  const escolher = (i) => { alvo = i; $('#cf-it', root).innerHTML = i ? `<b>${esc(i.xprod || '')}</b> · ${esc(i.ucom || '')}` : ''; if (i) { $('#cf-a', root).value = ''; $('#cf-q', root).focus(); } };
  const achar = (cod) => { const t = cod.trim().toUpperCase(), igual = (v) => (v || '').toUpperCase() === t;
    return its.find(i => igual(i.etiqueta)) || its.find(i => igual(i.produto_codigo)) || its.find(i => igual(i.cprod)); };
  pinta();
  $('#cf-cod', root).onchange = (e) => { const cod = decodeURIComponent(e.target.value.replace(/^.*[?&]b=([^&#]+).*$/i, '$1')); if (!cod.trim()) return escolher(null);
    const i = achar(cod); if (!i) return toast('Este item não está na nota', true); recemLido = true; escolher(i); };
  $('#cf-f', root).onsubmit = async (e) => {
    e.preventDefault(); if (!alvo) return toast('Leia a etiqueta ou escolha o item', true);
    if (recemLido && $('#cf-q', root).value.trim() === '') { recemLido = false; return $('#cf-q', root).focus(); }   // o Enter do leitor escolhe o item
    recemLido = false;
    const qv = parseNum($('#cf-q', root).value), av = $('#cf-a', root).value.trim() === '' ? 0 : parseNum($('#cf-a', root).value);
    if ($('#cf-q', root).value.trim() === '' || !(qv >= 0)) return toast('Informe quanto chegou', true);
    if (!(av >= 0) || av > qv) return toast('O avariado não pode passar do que chegou', true);
    try { await q(sb.rpc('est_receb_contar', { p_item: alvo.item_id, p_qtd: qv, p_avariada: av }));
      alvo.contada = qv; alvo.avariada = av; toast('Registrado'); pinta(); escolher(null); $('#cf-cod', root).value = ''; $('#cf-q', root).value = ''; $('#cf-cod', root).focus();
      $('.muted.small', root).textContent = `Emissão ${dateBR(nota?.emissao)} · ${its.filter(x => x.contada != null).length} de ${its.length} itens conferidos${cega ? ' · conferência cega: conte o que chegou, sem a nota' : ''}`;
    } catch (err) { fail(err); }
  };
  let fluxo = null, quadro = 0; const parar = () => { cancelAnimationFrame(quadro); fluxo?.getTracks().forEach(t => t.stop()); fluxo = null; };
  const cam = $('#cf-cam', root);
  if (cam) cam.onclick = async () => {
    const v = $('#cf-video', root);
    if (fluxo) { parar(); v.hidden = true; cam.textContent = 'Ler pela câmera'; return; }
    try {
      fluxo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      v.srcObject = fluxo; v.hidden = false; await v.play(); cam.textContent = 'Parar a câmera';
      const det = new window.BarcodeDetector({ formats: ['code_128', 'qr_code', 'code_39', 'ean_13'] }); let ultimo = '', quando = 0;
      const ciclo = async () => {
        if (!fluxo || !v.isConnected) return parar();
        try { const t = (await det.detect(v))[0]?.rawValue; if (t && (t !== ultimo || Date.now() - quando > 4000)) { ultimo = t; quando = Date.now(); const c = $('#cf-cod', root); c.value = t; c.dispatchEvent(new Event('change')); } } catch { /* quadro sem código */ }
        quadro = requestAnimationFrame(ciclo);
      };
      ciclo();
    } catch (err) { parar(); fail(new Error('Não foi possível abrir a câmera: ' + (err.message || err))); }
  };
  $('#cf-v', root).onclick = () => { parar(); ir(root, null); };
  $('#cf-fim', root).onclick = () => {
    const pend = its.filter(i => i.contada == null).length;
    const m = modal({ title: 'Concluir o recebimento', body: `<div class="grid-form"><label>Data da chegada<input type="date" id="cf-d" value="${today()}" max="${today()}" min="${nota?.emissao || ''}"></label>
        <label class="span2">Observação<input id="cf-o" maxlength="300" placeholder="Opcional"></label></div>
      ${pend ? `<p class="small" style="color:var(--warn)">${pend} item(ns) sem conferência: ao concluir, ficam como <b>não chegou</b> (zero).</p>` : ''}
      <p class="small muted">Entra no estoque o que chegou em bom estado, na data da chegada, ao custo da nota. Falta, sobra ou avaria vão como aviso para Compras. Depois de concluída, a conferência não muda.</p>`,
      foot: '<button class="btn" data-close>Voltar</button><button class="btn primary" id="cf-ok">Concluir</button>' });
    $('#cf-ok', m.el).onclick = async () => {
      try { const x = await q(sb.rpc('est_receb_concluir', { p_receb: r.id, p_data: $('#cf-d', m.el).value, p_observacao: $('#cf-o', m.el).value.trim() || null, p_zerar_pendentes: pend > 0 }));
        m.close(); parar(); toast(`Recebimento concluído${x.divergencias ? ` · ${x.divergencias} divergência(s) avisada(s) a Compras` : ''}${x.lancados ? ` · ${x.lancados} item(ns) no estoque` : ''}`); ir(root, r.id);
      } catch (e) { fail(e); }
    };
  };
}

async function ficha(root, r) {
  const [its, nota] = await Promise.all([q(sb.rpc('est_receb_itens', { p_receb: r.id })), q(sb.from('nfe_notas').select('numero,serie,emit_nome,emissao').eq('id', r.nota_id).maybeSingle()).catch(() => null)]);
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Recebimento nº ${r.numero} — NF ${nota?.numero ?? ''} ${esc(nota?.emit_nome || '')} ${badge(r.situacao)}</h2>
      <div class="muted small">Emissão ${dateBR(nota?.emissao)}${r.data ? ' · chegada ' + dateBR(r.data) : ''} · ${esc(r.conferente_nome || '')}${r.observacao ? ' · ' + esc(r.observacao) : ''}</div></div>
    <button class="btn ghost" id="fc-v">← Recebimento</button></div>
    <div class="card flush"><div class="table-wrap"><table class="small"><thead><tr><th>#</th><th>Item da nota</th><th>Unid.</th><th class="num">Nota</th><th class="num">Chegou</th><th class="num">Avariado</th><th class="num">Entrou</th><th>Divergência</th></tr></thead><tbody>
      ${its.map(i => `<tr><td>${i.n_item}</td><td>${esc(i.xprod || '')} <span class="muted">${esc(i.cprod || '')}${i.produto_codigo ? ' → ' + esc(i.produto_codigo) : ''}</span></td><td>${esc(i.ucom || '')}</td>
        <td class="num">${n(i.qtd_nota)}</td><td class="num">${n(i.contada)}</td><td class="num">${+i.avariada ? n(i.avariada) : ''}</td><td class="num"><b>${n(i.qtd_entra)}</b></td><td class="${i.divergencia ? 'neg' : ''}">${esc(i.divergencia || '')}</td></tr>`).join('')
        || '<tr><td colspan="8" class="empty">Nota dispensada: sem material para receber.</td></tr>'}</tbody></table></div></div>`;
  $('#fc-v', root).onclick = () => ir(root, null);
}

function parametros(root) {
  const c = D.cfg, lig = c.entrada_por === 'recebimento';
  const m = modal({ title: 'Parâmetros do recebimento', body: `
    <label style="display:flex;flex-direction:row;gap:8px;align-items:flex-start;font-weight:400;margin:6px 0"><input type="checkbox" id="rp-on" ${lig ? 'checked' : ''} style="margin-top:3px"> <span><b>Entrada pelo recebimento</b>: a nota de compra só entra no estoque depois de conferida na chegada, com a data da chegada</span></label>
    <label style="display:flex;flex-direction:row;gap:8px;align-items:flex-start;font-weight:400;margin:6px 0"><input type="checkbox" id="rp-cg" ${c.receb_cega ? 'checked' : ''} style="margin-top:3px"> <span>Conferência cega: quem confere não vê a quantidade da nota</span></label>
    <div class="grid-form"><label>Tolerância de quantidade (%)<input type="number" id="rp-t" min="0" max="50" step="0.1" value="${+c.receb_tolerancia_pct}"></label>
      <label>Notas emitidas a partir de<input type="date" id="rp-d" value="${c.receb_desde || today()}"></label></div>
    <p class="small muted">Notas emitidas antes da data continuam entrando pela emissão. Quem confere: quem atende o almoxarifado (Requisição de Material › Parâmetros).</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="rp-ok">Salvar</button>' });
  $('#rp-ok', m.el).onclick = async () => {
    const t = +$('#rp-t', m.el).value; if (!(t >= 0 && t <= 50)) return toast('Tolerância de 0 a 50%', true);
    try { await q(sb.rpc('est_receb_salvar', { p_empresa: state.empresa.id, p_ativo: $('#rp-on', m.el).checked, p_cega: $('#rp-cg', m.el).checked, p_tolerancia: t, p_desde: $('#rp-d', m.el).value || null }));
      m.close(); toast('Parâmetros salvos'); render(root); } catch (e) { fail(e); }
  };
}
