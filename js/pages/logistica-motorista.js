// Logística › App do Motorista (LOG006) — melhoria 7.1 (SQL 124, 08/11/2026).
// Feita para o celular: as cargas do motorista, a rota na ordem de entrega com endereço, telefone e mapa,
// iniciar a rota (km), chegada, entrega com quem recebeu + foto do canhoto + assinatura na tela, ocorrência com foto,
// concluir (km). Funciona sem internet (melhoria 1.5): o registro e as fotos ficam no aparelho e sobem depois.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, dateBR, fail, toast, modal } from '../lib/ui.js';
import { gravar, novoId } from '../lib/offline.js';

export const title = 'App do Motorista';
const ui = { carga: null };
let L = [];
const OCORR = { ausente: 'Cliente ausente / fechado', recusa: 'Cliente recusou', avaria: 'Avaria na mercadoria', endereco: 'Endereço não encontrado', atraso: 'Atraso', veiculo: 'Problema no veículo', outro: 'Outra' };
const SIT = { pendente: ['A entregar', ''], entregue: ['Entregue', 'pago'], nao_entregue: ['Não entregue', 'vencido'], devolvida: ['Devolvida', 'vencido'] };
const ST = { planejada: 'Planejada', carregando: 'Carregando', pronta: 'Pronta para sair', em_rota: 'Em rota', concluida: 'Concluída' };
const salvo = (r, msg) => toast(r.pendente ? `${msg} — sem internet: guardado no aparelho` : msg);
const endereco = (e) => [[e.logradouro, e.nro].filter(Boolean).join(', '), e.complemento, e.bairro, [e.cidade, e.uf].filter(Boolean).join('/'), e.cep && String(e.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2')].filter(Boolean).join(' · ');
const mapa = (e) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([[e.logradouro, e.nro].filter(Boolean).join(' '), e.bairro, e.cidade, e.uf, 'Brasil'].filter(Boolean).join(', '));
const fone = (f) => String(f || '').replace(/\D/g, '');

// posição do celular (opcional: sem permissão segue sem ela)
const posicao = () => new Promise(ok => {
  if (!navigator.geolocation) return ok(null);
  navigator.geolocation.getCurrentPosition(p => ok({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), prec: Math.round(p.coords.accuracy) }), () => ok(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
});
let relogio = null;
function rastrear(c) {
  clearInterval(relogio); relogio = null;
  const min = +c?.config?.rastrear_min || 0;
  if (!min || c.status !== 'em_rota') return;
  const vai = async () => { const p = await posicao(); if (p) gravar(`Posição da carga ${c.numero}`, [{ t: 'rpc', nome: 'log_motorista_posicao', args: { p_carga: c.id, p_lat: p.lat, p_lng: p.lng, p_precisao: p.prec } }]).catch(() => {}); };
  vai(); relogio = setInterval(vai, min * 60000);
}

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try { L = await q(sb.rpc('log_motorista_cargas', {}, { get: true })) || []; }   // GET: o modo sem internet guarda a rota no aparelho
  catch (err) { fail(err); root.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 124 já foi executado.</div></div>'; return; }
  if (!ui.carga || !L.some(c => c.id === ui.carga)) ui.carga = (L.find(c => c.status === 'em_rota') || L.find(c => c.status !== 'concluida') || L[0])?.id || null;
  tela(root);
}

function tela(root) {
  const c = L.find(x => x.id === ui.carga);
  rastrear(c);
  if (!c) { root.innerHTML = `<div class="mot"><h2 style="margin:0 0 6px">App do Motorista</h2><div class="card"><div class="empty">Nenhuma carga para você hoje. A logística escolhe o motorista na carga (Cargas e Entregas).</div></div></div>`; return; }
  const ents = c.entregas || [], feitas = ents.filter(e => e.situacao !== 'pendente').length, prox = ents.find(e => e.situacao === 'pendente');
  root.innerHTML = `<div class="mot">
    ${L.length > 1 ? `<div class="mot-cargas">${L.map(x => `<button class="chip${x.id === c.id ? ' on' : ''}" data-cg="${x.id}">Carga ${x.numero} · ${dateBR(x.data).slice(0, 5)}</button>`).join('')}</div>` : ''}
    <div class="card mot-topo"><div><div class="mot-titulo">Carga ${c.numero} <span class="badge ${c.status === 'em_rota' ? 'aberto' : c.status === 'concluida' ? 'pago' : 'negoc'}">${ST[c.status] || c.status}</span></div>
      <div class="muted small">${esc(c.veiculo || '')}${c.placa ? ' · ' + esc(c.placa) : ''} · ${dateBR(c.data)} · ${feitas} de ${ents.length} entregas</div>
      <div class="pl-bar" style="margin-top:6px"><i style="width:${ents.length ? Math.round(100 * feitas / ents.length) : 0}%"></i></div></div>
      ${['planejada', 'carregando', 'pronta'].includes(c.status) ? '<button class="btn primary mot-big" id="mt-ini">Iniciar a rota</button>' : ''}
      ${c.status === 'em_rota' ? `<button class="btn mot-big ${prox ? '' : 'primary'}" id="mt-fim">Concluir a rota</button>` : ''}</div>
    ${c.observacao ? `<div class="card small">${esc(c.observacao)}</div>` : ''}
    ${ents.map(e => cartao(e, c, e === prox)).join('')}
    ${c.status === 'em_rota' ? '<button class="btn ghost mot-big" id="mt-oc" style="width:100%">Ocorrência sem entrega (veículo, atraso…)</button>' : ''}
  </div>`;
  $$('[data-cg]', root).forEach(b => b.onclick = () => { ui.carga = b.dataset.cg; tela(root); });
  $('#mt-ini', root) && ($('#mt-ini', root).onclick = () => iniciar(c, root));
  $('#mt-fim', root) && ($('#mt-fim', root).onclick = () => concluir(c, root));
  $('#mt-oc', root) && ($('#mt-oc', root).onclick = () => ocorrencia(c, null, root));
  $$('[data-che]', root).forEach(b => b.onclick = async () => { const e = ents.find(x => x.id === b.dataset.che), p = await posicao();
    try { const r = await gravar(`Chegada: NF ${e.nota}`, [{ t: 'rpc', nome: 'log_motorista_chegada', args: { p_carga_nota: e.id, p_lat: p?.lat ?? null, p_lng: p?.lng ?? null } }]);
      e.chegada_em = new Date().toISOString(); salvo(r, 'Chegada registrada'); tela(root); } catch (err) { fail(err); } });
  $$('[data-ent]', root).forEach(b => b.onclick = () => entregar(c, ents.find(x => x.id === b.dataset.ent), root));
  $$('[data-oc]', root).forEach(b => b.onclick = () => ocorrencia(c, ents.find(x => x.id === b.dataset.oc), root));
}

function cartao(e, c, prox) {
  const s = SIT[e.situacao] || [e.situacao, ''], rota = c.status === 'em_rota' && e.situacao === 'pendente', f = fone(e.fone);
  return `<div class="card mot-ent ${prox ? 'mot-prox' : ''} ${e.situacao !== 'pendente' ? 'mot-feita' : ''}">
    <div class="mot-cab"><span class="mot-n">${e.seq || ''}</span><div style="flex:1"><b>${esc(e.cliente || '')}</b><div class="small muted">NF ${e.nota}${e.volumes ? ' · ' + e.volumes + ' vol.' : ''}${e.peso_kg ? ' · ' + Math.round(e.peso_kg).toLocaleString('pt-BR') + ' kg' : ''}</div></div>
      <span class="badge ${s[1]}">${s[0]}</span></div>
    <div class="small">${esc(endereco(e))}</div>
    ${e.restricao ? `<div class="small warn">${esc(e.restricao)}</div>` : ''}
    ${e.situacao === 'entregue' ? `<div class="small muted">Recebido por ${esc(e.recebedor_nome || '—')} às ${new Date(e.entregue_em).toLocaleTimeString('pt-BR').slice(0, 5)}${e.tem_canhoto ? ' · canhoto ✔' : ''}</div>` : ''}
    <div class="mot-bts"><a class="btn small" href="${mapa(e)}" target="_blank" rel="noopener">Mapa</a>${f ? `<a class="btn small" href="tel:${f}">Ligar</a>` : ''}
      ${rota && !e.chegada_em ? `<button class="btn small" data-che="${e.id}">Cheguei</button>` : ''}
      ${rota ? `<button class="btn small primary" data-ent="${e.id}">Entregar</button><button class="btn small ghost" data-oc="${e.id}">Ocorrência</button>` : ''}</div></div>`;
}

async function iniciar(c, root) {
  const exige = c.config?.exigir_km !== false;
  const m = modal({ title: `Iniciar a carga ${c.numero}`, body: `<label>Km do painel na saída${exige ? '' : ' (opcional)'}<input id="mi-km" inputmode="numeric" style="font-size:1.2em"></label>
    <p class="small muted">O cliente é avisado de que a mercadoria saiu para entrega.</p>`, foot: '<button class="btn" data-close>Voltar</button><button class="btn primary" id="mi-ok">Iniciar</button>' });
  $('#mi-ok', m.el).onclick = async () => {
    const km = $('#mi-km', m.el).value.replace(/\D/g, ''); if (exige && !km) return toast('Informe o km', true);
    try { const r = await gravar(`Início da carga ${c.numero}`, [{ t: 'rpc', nome: 'log_motorista_iniciar', args: { p_carga: c.id, p_km: km ? +km : null } }]);
      m.close(); c.status = 'em_rota'; salvo(r, 'Boa viagem! Rota iniciada'); r.pendente ? tela(root) : render(root); } catch (e) { fail(e); }
  };
}

async function concluir(c, root) {
  const pend = (c.entregas || []).filter(e => e.situacao === 'pendente').length;
  if (pend) return toast(`Ainda há ${pend} entrega(s) sem baixa: marque entregue ou registre a ocorrência.`, true);
  const exige = c.config?.exigir_km !== false;
  const m = modal({ title: `Concluir a carga ${c.numero}`, body: `<label>Km do painel na chegada${exige ? '' : ' (opcional)'}<input id="mf-km" inputmode="numeric" style="font-size:1.2em"></label>${c.km_saida ? `<p class="small muted">Saída: ${(+c.km_saida).toLocaleString('pt-BR')} km</p>` : ''}`,
    foot: '<button class="btn" data-close>Voltar</button><button class="btn primary" id="mf-ok">Concluir</button>' });
  $('#mf-ok', m.el).onclick = async () => {
    const km = $('#mf-km', m.el).value.replace(/\D/g, ''); if (exige && !km) return toast('Informe o km', true);
    if (km && c.km_saida && +km < +c.km_saida) return toast('O km de chegada é menor que o de saída', true);
    try { const r = await gravar(`Conclusão da carga ${c.numero}`, [{ t: 'rpc', nome: 'log_motorista_concluir', args: { p_carga: c.id, p_km: km ? +km : null } }]);
      m.close(); c.status = 'concluida'; salvo(r, 'Carga concluída'); r.pendente ? tela(root) : render(root); } catch (e) { fail(e); }
  };
}

// foto reduzida (1600 px, JPEG 0,8): canhoto legível e leve para subir pelo celular
async function reduzir(file) {
  try {
    const img = await createImageBitmap(file), k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const cv = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return await new Promise(ok => cv.toBlob(b => ok(b || file), 'image/jpeg', 0.8));
  } catch { return file; }
}
const pasta = (c) => `${c.empresa_id}/entregas/${c.id}/`;

function assinatura(cv) {
  const g = cv.getContext('2d'); let des = false, vazio = true;
  g.lineWidth = 2.5; g.lineCap = 'round'; g.strokeStyle = '#111';
  const pt = (ev) => { const r = cv.getBoundingClientRect(), t = ev.touches?.[0] || ev; return [(t.clientX - r.left) * cv.width / r.width, (t.clientY - r.top) * cv.height / r.height]; };
  const ini = (ev) => { ev.preventDefault(); des = true; vazio = false; g.beginPath(); g.moveTo(...pt(ev)); };
  const mov = (ev) => { if (!des) return; ev.preventDefault(); g.lineTo(...pt(ev)); g.stroke(); };
  const fim = () => { des = false; };
  cv.addEventListener('pointerdown', ini); cv.addEventListener('pointermove', mov); window.addEventListener('pointerup', fim);
  return { vazio: () => vazio, limpar: () => { g.clearRect(0, 0, cv.width, cv.height); vazio = true; }, blob: () => new Promise(ok => cv.toBlob(ok, 'image/png')) };
}

function entregar(c, e, root) {
  const cfg = c.config || {};
  const m = modal({ title: `Entregar NF ${e.nota}`, body: `<div class="small muted" style="margin-bottom:8px">${esc(e.cliente || '')}</div>
    <label>Quem recebeu${cfg.exigir_recebedor !== false ? '' : ' (opcional)'}<input id="me-nome" autocomplete="off" style="font-size:1.1em"></label>
    <label style="margin-top:8px">Documento (RG/CPF, opcional)<input id="me-doc" inputmode="numeric"></label>
    <label style="margin-top:8px">Foto do canhoto assinado${cfg.exigir_canhoto !== false ? '' : ' (opcional)'}<input type="file" id="me-foto" accept="image/*" capture="environment"></label>
    <div style="margin-top:8px"><div class="small">Assinatura na tela${cfg.exigir_assinatura ? '' : ' (opcional)'} <button class="btn ghost small" id="me-limpa" type="button">Limpar</button></div>
      <canvas id="me-ass" width="600" height="200" style="width:100%;height:140px;border:2px dashed #94a3b8;border-radius:8px;touch-action:none;background:#fff"></canvas></div>
    <label style="margin-top:8px">Observação<input id="me-obs"></label>`,
    foot: '<button class="btn" data-close>Voltar</button><button class="btn primary" id="me-ok">Confirmar entrega</button>' });
  const A = assinatura($('#me-ass', m.el)); $('#me-limpa', m.el).onclick = () => A.limpar();
  $('#me-ok', m.el).onclick = async (ev) => {
    const nome = $('#me-nome', m.el).value.trim(), f = $('#me-foto', m.el).files[0];
    if (cfg.exigir_recebedor !== false && !nome) return toast('Informe quem recebeu', true);
    if (cfg.exigir_canhoto !== false && !f) return toast('Tire a foto do canhoto', true);
    if (cfg.exigir_assinatura && A.vazio()) return toast('Peça a assinatura na tela', true);
    ev.target.disabled = true;
    try {
      const ops = [], base = pasta(c) + e.id + '-' + Date.now();
      let can = null, ass = null;
      if (f) { can = base + '-canhoto.jpg'; ops.push({ t: 'upload', bucket: 'logistica', caminho: can, arquivo: await reduzir(f) }); }
      if (!A.vazio()) { ass = base + '-assinatura.png'; ops.push({ t: 'upload', bucket: 'logistica', caminho: ass, arquivo: await A.blob() }); }
      const p = await posicao();
      ops.push({ t: 'rpc', nome: 'log_motorista_entregar', args: { p_carga_nota: e.id, p_recebedor: nome || null, p_documento: $('#me-doc', m.el).value.trim() || null, p_canhoto: can, p_assinatura: ass,
        p_lat: p?.lat ?? null, p_lng: p?.lng ?? null, p_obs: $('#me-obs', m.el).value.trim() || null } });
      const r = await gravar(`Entrega NF ${e.nota} — ${e.cliente || ''}`, ops);
      m.close(); Object.assign(e, { situacao: 'entregue', recebedor_nome: nome, entregue_em: new Date().toISOString(), tem_canhoto: !!can });
      salvo(r, 'Entrega registrada'); tela(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

function ocorrencia(c, e, root) {
  const m = modal({ title: e ? `Ocorrência — NF ${e.nota}` : `Ocorrência na carga ${c.numero}`, body: `${e ? `<div class="small muted" style="margin-bottom:8px">${esc(e.cliente || '')}</div>` : ''}
    <label>O que aconteceu<select id="mo-t">${Object.entries(OCORR).filter(([k]) => e || ['atraso', 'veiculo', 'outro'].includes(k)).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></label>
    <label style="margin-top:8px">Descrição<textarea id="mo-d" rows="3"></textarea></label>
    <label style="margin-top:8px">Foto (opcional)<input type="file" id="mo-f" accept="image/*" capture="environment"></label>
    ${e ? '<label class="chk" style="margin-top:8px"><input type="checkbox" id="mo-ne" checked> A mercadoria NÃO foi entregue (volta com o caminhão)</label>' : ''}
    <p class="small muted">A logística recebe o aviso na hora.</p>`,
    foot: '<button class="btn" data-close>Voltar</button><button class="btn primary" id="mo-ok">Registrar</button>' });
  $('#mo-ok', m.el).onclick = async (ev) => {
    const tipo = $('#mo-t', m.el).value, desc = $('#mo-d', m.el).value.trim(), f = $('#mo-f', m.el).files[0], ne = !!$('#mo-ne', m.el)?.checked;
    if (tipo === 'outro' && !desc) return toast('Descreva a ocorrência', true);
    ev.target.disabled = true;
    try {
      const ops = [], id = novoId(); let foto = null;
      if (f) { foto = pasta(c) + 'ocorrencia-' + id + '.jpg'; ops.push({ t: 'upload', bucket: 'logistica', caminho: foto, arquivo: await reduzir(f) }); }
      const p = await posicao();
      ops.push({ t: 'rpc', nome: 'log_motorista_ocorrencia', args: { p_carga: c.id, p_carga_nota: e?.id || null, p_tipo: tipo, p_descricao: desc || null, p_foto: foto, p_nao_entregue: ne, p_lat: p?.lat ?? null, p_lng: p?.lng ?? null, p_id: id } });
      const r = await gravar(`Ocorrência: ${OCORR[tipo]}${e ? ' — NF ' + e.nota : ''}`, ops);
      m.close(); if (e && ne) e.situacao = 'nao_entregue'; salvo(r, 'Ocorrência registrada'); tela(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}
