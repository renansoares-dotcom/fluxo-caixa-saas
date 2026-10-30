// Cadastros › Empresa: identidade visual (cores, logos, dados institucionais, unidades) e crachás de identificação.
// SQL 066. Identidade: o administrador edita, todos veem. Crachás e fotos: quem tem acesso ao RH.
import { sb, state, q, isAdmin } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, confirmDialog, today, dateBR } from '../lib/ui.js';
import { temRH, podeRH } from '../lib/rh-dados.js';
import { BUCKET, urlArquivo, esquecerArquivo, aplicarIdentidade } from '../lib/identidade.js';
import * as CR from '../lib/crachas.js';

export const title = 'Empresa — identidade e crachás';
const ui = { aba: 'id', filtro: 'ativos', busca: '' };
let D = null;

const ID_PADRAO = () => ({ empresa_id: state.empresa.id, nome_exibicao: state.empresa.nome || '', razao_documentos: state.empresa.razao_social || '', cor_primaria: '#2b5598', cor_secundaria: '#2a1f6f',
  cor_destaque: '#0a8ed3', unidades: [], cracha_validade_meses: 24, cracha_verso: '' });

async function carregar() {
  const e = state.empresa.id;
  let id = null, sem = false;
  try { const { data, error } = await sb.from('empresa_identidade').select('*').eq('empresa_id', e).maybeSingle(); if (error) throw error; id = data; } catch { sem = true; }
  let C = [], K = [];
  if (temRH() && !sem) {
    [C, K] = await Promise.all([
      q(sb.from('rh_colaboradores').select('id,nome,cargo,setor,matricula,situacao,admissao,foto_path,autorizacao_imagem').eq('empresa_id', e).order('nome')),
      q(sb.from('crachas').select('*').eq('empresa_id', e).order('emitido_em', { ascending: false })),
    ]);
  }
  D = { id: id || ID_PADRAO(), novo: !id, sem, C, K };
  return D;
}
const ativoDe = (colabId) => D.K.find(k => k.colaborador_id === colabId && k.status === 'ativo');

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try { await carregar(); } catch (err) { fail(err); root.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Recarregue a página.</div></div>'; return; }
  if (D.sem) { root.innerHTML = '<div class="card"><div class="empty">Esta tela ainda não está disponível. Recarregue a página; se continuar, avise o administrador da plataforma.</div></div>'; return; }
  const abas = [['id', 'Identidade visual'], ...(temRH() ? [['cr', 'Crachás'], ['ter', 'Terceiros e visitantes'], ['hist', 'Histórico de crachás']] : [])];
  if (!abas.some(a => a[0] === ui.aba)) ui.aba = 'id';
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Empresa</h2><div class="muted small">Identidade visual usada na plataforma, nos relatórios, nos contratos e nos crachás.</div></div></div>
    <div class="card toolbar"><div class="chips" id="ce-abas">${abas.map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div></div>
    <div id="ce-corpo"></div>`;
  $('#ce-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  const corpo = $('#ce-corpo', root);
  if (ui.aba === 'id') return identidade(corpo, root);
  if (ui.aba === 'cr') return crachasColab(corpo, root);
  if (ui.aba === 'ter') return terceiros(corpo, root);
  return historico(corpo, root);
}

// ---------------------------------------------------------------- identidade
async function identidade(corpo, root) {
  const id = D.id, pode = isAdmin(), dis = pode ? '' : 'disabled';
  const logo = (k, rot, dica) => `<div class="ce-logo"><div class="ce-logo-prev ${k === 'logo_escuro_path' ? 'escuro' : ''}" data-prev="${k}"><span class="muted small">sem imagem</span></div>
      <div><b class="small">${rot}</b><div class="small muted">${dica}</div>${pode ? `<label class="btn small" style="margin-top:6px">Enviar imagem<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" data-up="${k}" hidden></label>
      ${id[k] ? `<button class="btn ghost small" data-tira="${k}" style="margin-top:6px">Tirar</button>` : ''}` : ''}</div></div>`;
  corpo.innerHTML = `<div class="grid2" style="align-items:start">
    <div class="card"><h3 style="margin-top:0">Nome e documentos</h3>
      <label>Nome de exibição (menu e crachás)<input id="ce-nome" value="${esc(id.nome_exibicao || '')}" maxlength="40" ${dis}></label>
      <label>Razão social no cabeçalho dos relatórios e contratos<input id="ce-razao" value="${esc(id.razao_documentos || '')}" placeholder="ex.: EMPRESA EXEMPLO INDÚSTRIA LTDA." ${dis}></label>
      <div class="grid2"><label>Site<input id="ce-site" value="${esc(id.site || '')}" ${dis}></label><label>E-mail<input id="ce-email" value="${esc(id.email || '')}" ${dis}></label>
        <label>Telefone<input id="ce-tel" value="${esc(id.telefone || '')}" ${dis}></label></div>
      <label>Rodapé dos documentos (endereço, contatos)<input id="ce-rod" value="${esc(id.rodape_documentos || '')}" ${dis}></label>
      <h3>Cores</h3>
      <div class="ce-cores">${[['cor_primaria', 'Principal (botões, faixa do crachá)'], ['cor_secundaria', 'Secundária (títulos)'], ['cor_destaque', 'Destaque (gráficos, links)']].map(([k, t]) =>
        `<label class="ce-cor"><input type="color" data-cor="${k}" value="${esc(id[k])}" ${dis}><span class="small">${t}<br><code>${esc(id[k])}</code></span></label>`).join('')}</div>
      <p class="small muted">As cores valem no tema claro da plataforma. No tema escuro a plataforma mantém as cores próprias, para ter contraste.</p>
      <h3>Crachás</h3>
      <div class="grid2"><label>Validade do crachá (meses)<input id="ce-val" type="number" min="1" max="120" value="${esc(id.cracha_validade_meses || 24)}" ${dis}></label></div>
      <label>Texto do verso<input id="ce-verso" value="${esc(id.cracha_verso || '')}" placeholder="${esc(CR.VERSO_PADRAO)}" ${dis}></label>
    </div>
    <div class="card"><h3 style="margin-top:0">Logos</h3>
      ${logo('logo_path', 'Logo principal', 'PNG com fundo transparente ou SVG; vai no menu, nos relatórios, contratos e crachás.')}
      ${logo('logo_escuro_path', 'Logo para fundo escuro', 'Versão clara do logo, para o tema escuro da plataforma (opcional).')}
      ${logo('icone_path', 'Ícone', 'Quadrado, só o símbolo (opcional).')}
      <h3>Prévia do crachá</h3><div id="ce-prev-cr" class="ce-prev-cr"></div>
    </div></div>
    <div class="card" style="margin-top:12px"><div class="card-head"><h3 style="margin:0">Unidades e endereços</h3>${pode ? '<button class="btn small" id="ce-un-add">+ Unidade</button>' : ''}</div>
      <div id="ce-uns"></div></div>
    ${pode ? '<div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn primary" id="ce-salvar">Salvar identidade</button></div>' : '<p class="small muted">Só o administrador altera a identidade.</p>'}`;
  const uns = [...(id.unidades || [])];
  const pintarUns = () => { $('#ce-uns', corpo).innerHTML = uns.length ? `<div class="table-wrap"><table><thead><tr><th>Unidade</th><th>CNPJ</th><th>Endereço</th><th>Município</th><th>UF</th><th>CEP</th><th></th></tr></thead><tbody>
      ${uns.map((u, i) => `<tr>${['nome', 'cnpj', 'endereco', 'municipio', 'uf', 'cep'].map(k => `<td><input data-un="${i}.${k}" value="${esc(u[k] || '')}" ${k === 'uf' ? 'maxlength="2" style="width:52px"' : ''} ${dis}></td>`).join('')}<td>${pode ? `<button class="btn ghost small" data-un-rm="${i}">✕</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="small muted">Nenhuma unidade cadastrada. Inclua a matriz e as filiais (fábricas, depósitos).</p>'; };
  pintarUns();
  const cores = () => Object.fromEntries($$('[data-cor]', corpo).map(i => [i.dataset.cor, i.value]));
  const atual = () => ({ ...id, ...cores(), nome_exibicao: $('#ce-nome', corpo).value.trim(), cracha_verso: $('#ce-verso', corpo).value.trim(), telefone: $('#ce-tel', corpo).value.trim(), site: $('#ce-site', corpo).value.trim() });
  const previa = async () => {
    const i = atual(), lg = await urlArquivo(i.logo_path);
    const ex = { tipo: 'colaborador', nome: 'NOME DO COLABORADOR', cargo: 'CARGO', setor: 'Setor', matricula: '0000', validade: CR.validadePadrao('colaborador', i.cracha_validade_meses), via: 1, emitido_em: today() };
    const { frente, verso } = CR.htmlCracha(ex, i, { logo: lg, qr: await CR.qrSvg(CR.urlVerificacao('exemplo')).catch(() => '') });
    $('#ce-prev-cr', corpo).innerHTML = `<style>${CR.cssCracha(i.cor_primaria)}</style><div class="ce-prev-par">${frente}${verso}</div>`;
  };
  const prevLogos = async () => { for (const k of ['logo_path', 'logo_escuro_path', 'icone_path']) { const u = await urlArquivo(id[k]); const el = corpo.querySelector(`[data-prev="${k}"]`); el.innerHTML = u ? `<img src="${u}" alt="">` : '<span class="muted small">sem imagem</span>'; } };
  prevLogos(); previa();
  corpo.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.cor) { el.parentElement.querySelector('code').textContent = el.value; previa(); }
    if (el.dataset.un) { const [i, k] = el.dataset.un.split('.'); uns[+i][k] = el.value; }
    if (['ce-nome', 'ce-verso', 'ce-tel', 'ce-site'].includes(el.id)) previa();
  });
  corpo.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'ce-un-add') { uns.push({ nome: uns.length ? 'Filial' : 'Matriz', cnpj: '', endereco: '', municipio: '', uf: '', cep: '' }); return pintarUns(); }
    if (b.dataset.unRm != null) { uns.splice(+b.dataset.unRm, 1); return pintarUns(); }
    if (b.dataset.tira) { id[b.dataset.tira] = null; await salvar(); return render(root); }
    if (b.id === 'ce-salvar') { b.disabled = true; await salvar(); b.disabled = false; }
  });
  corpo.addEventListener('change', async (e) => {
    const inp = e.target.closest('[data-up]'); if (!inp?.files?.[0]) return;
    const f = inp.files[0], k = inp.dataset.up;
    if (f.size > 5 * 1024 * 1024) return toast('A imagem passa de 5 MB', true);
    const ext = (f.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${state.empresa.id}/identidade/${k.replace('_path', '')}-${Date.now()}.${ext}`;
    try {
      const { error } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'image/png', upsert: false }); if (error) throw error;
      const antigo = id[k]; id[k] = path; await salvar(); if (antigo) { esquecerArquivo(antigo); sb.storage.from(BUCKET).remove([antigo]).catch(() => {}); }
      render(root);
    } catch (err) { fail(err); }
  });
  async function salvar() {
    const g = (s) => $(s, corpo)?.value.trim() || null;
    const row = { empresa_id: state.empresa.id, ...cores(), nome_exibicao: g('#ce-nome'), razao_documentos: g('#ce-razao'), site: g('#ce-site'), email: g('#ce-email'), telefone: g('#ce-tel'),
      rodape_documentos: g('#ce-rod'), cracha_validade_meses: Math.min(120, Math.max(1, +$('#ce-val', corpo).value || 24)), cracha_verso: g('#ce-verso'),
      unidades: uns.filter(u => Object.values(u).some(v => String(v || '').trim())), logo_path: id.logo_path || null, logo_escuro_path: id.logo_escuro_path || null, icone_path: id.icone_path || null, atualizado_em: new Date().toISOString() };
    try {
      await q(sb.from('empresa_identidade').upsert(row, { onConflict: 'empresa_id' }));
      Object.assign(id, row); D.novo = false; state.identidade = { ...id };
      await aplicarIdentidade(state.identidade); toast('Identidade salva: já vale na plataforma e nos relatórios');
    } catch (err) { fail(err); }
  }
}

// ---------------------------------------------------------------- crachás dos colaboradores
async function crachasColab(corpo, root) {
  const pode = podeRH();
  const lista = D.C.filter(c => (ui.filtro === 'todos' || (ui.filtro === 'ativos' ? c.situacao !== 'desligado' : ui.filtro === 'semfoto' ? c.situacao !== 'desligado' && !c.foto_path : ui.filtro === 'sem' ? c.situacao !== 'desligado' && !ativoDe(c.id) : c.situacao === 'desligado' && ativoDe(c.id)))
    && (!ui.busca || `${c.nome} ${c.cargo} ${c.setor} ${c.matricula}`.toLowerCase().includes(ui.busca.toLowerCase())));
  const ativos = D.C.filter(c => c.situacao !== 'desligado');
  const kpi = (r, v, s = '', cl = '') => `<div class="kpi"><div class="k-label">${r}</div><div class="k-value ${cl}">${v}</div>${s ? `<div class="k-sub">${s}</div>` : ''}</div>`;
  const venc = D.K.filter(k => k.status === 'ativo' && k.validade && k.validade < today()).length;
  const devolver = D.C.filter(c => c.situacao === 'desligado' && ativoDe(c.id)).length;
  corpo.innerHTML = `<div class="kpis">${kpi('Colaboradores ativos', ativos.length)}${kpi('Com crachá ativo', ativos.filter(c => ativoDe(c.id)).length, `${ativos.filter(c => !ativoDe(c.id)).length} sem crachá`)}
      ${kpi('Sem foto', ativos.filter(c => !c.foto_path).length, 'tire pela câmera ou envie', ativos.some(c => !c.foto_path) ? 'warn' : '')}${kpi('Vencidos', venc, '', venc ? 'neg' : '')}${kpi('Desligados com crachá', devolver, 'recolher e dar baixa', devolver ? 'neg' : '')}</div>
    <div class="card toolbar" style="margin-top:12px"><div class="chips" id="cr-f">${[['ativos', 'Ativos'], ['sem', 'Sem crachá'], ['semfoto', 'Sem foto'], ['recolher', 'A recolher'], ['todos', 'Todos']].map(([k, t]) => `<span class="chip ${ui.filtro === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div>
      <input id="cr-busca" placeholder="Procurar nome, cargo, setor, matrícula" value="${esc(ui.busca)}" style="min-width:260px">
      ${pode ? '<span style="margin-left:auto;display:flex;gap:8px"><button class="btn" id="cr-imp">Imprimir selecionados</button><button class="btn primary" id="cr-emit">Emitir e imprimir selecionados</button></span>' : ''}</div>
    <div class="card flush"><div class="table-wrap"><table><thead><tr><th><input type="checkbox" id="cr-todos"></th><th>Foto</th><th>Nome</th><th>Cargo · setor</th><th>Matrícula</th><th>Uso de imagem</th><th>Crachá</th><th></th></tr></thead><tbody>
    ${lista.map(c => { const k = ativoDe(c.id), st = k ? CR.situacao(k, c) : null;
      return `<tr data-id="${c.id}"><td><input type="checkbox" data-sel="${c.id}"></td>
        <td><div class="cr-mini" data-foto="${esc(c.foto_path || '')}">${c.foto_path ? '' : '—'}</div></td>
        <td><b>${esc(c.nome)}</b>${c.situacao === 'desligado' ? '<div class="small neg">desligado</div>' : ''}</td><td class="small">${esc(c.cargo || '')}<div class="muted">${esc(c.setor || '')}</div></td><td class="small">${esc(c.matricula || '')}</td>
        <td class="small">${c.autorizacao_imagem ? `assinada em ${dateBR(c.autorizacao_imagem)}` : `<span class="warn">não registrada</span>`}</td>
        <td class="small">${k ? `<span class="badge ${st === 'ativo' ? 'pago' : 'vencido'}">${st === 'ativo' ? 'Ativo' : st === 'vencido' ? 'Vencido' : 'Recolher'}</span><div class="muted">via ${k.via} · até ${k.validade ? dateBR(k.validade) : '—'}</div>` : '<span class="muted">sem crachá</span>'}</td>
        <td style="white-space:nowrap">${pode ? `<button class="btn ghost small" data-foto-btn="${c.id}">Foto</button><button class="btn ghost small" data-imagem="${c.id}" title="Registrar a data da autorização de uso de imagem">Autorização</button>
          ${k ? `<button class="btn ghost small" data-via="${c.id}">2ª via</button>` : ''}` : ''}</td></tr>`; }).join('') || '<tr><td colspan="8" class="empty">Nenhum colaborador neste filtro. O cadastro vem de RH › Colaboradores.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">A foto é dado pessoal (LGPD): registre a autorização de uso de imagem assinada pelo colaborador. O QR Code do verso mostra só a empresa, o nome, o cargo e se o crachá está válido.</p>`;
  carregarMinis(corpo);
  $('#cr-f', corpo).onclick = (e) => { const f = e.target.closest('[data-f]')?.dataset.f; if (f) { ui.filtro = f; crachasColab(corpo, root); } };
  $('#cr-busca', corpo).oninput = (e) => { ui.busca = e.target.value; clearTimeout(corpo._t); corpo._t = setTimeout(() => { crachasColab(corpo, root); $('#cr-busca', corpo).focus(); $('#cr-busca', corpo).setSelectionRange(99, 99); }, 300); };
  $('#cr-todos', corpo).onchange = (e) => $$('[data-sel]', corpo).forEach(x => { x.checked = e.target.checked; });
  const sel = () => $$('[data-sel]:checked', corpo).map(x => D.C.find(c => c.id === x.dataset.sel));
  corpo.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.fotoBtn) return tirarFoto(D.C.find(c => c.id === b.dataset.fotoBtn), root);
    if (b.dataset.imagem) return autorizacao(D.C.find(c => c.id === b.dataset.imagem), root);
    if (b.dataset.via) { const c = D.C.find(x => x.id === b.dataset.via); if (!await confirmDialog(`Emitir a 2ª via de ${c.nome}? O crachá atual fica cancelado.`)) return;
      try { const k = await emitir(c); await imprimir([k]); render(root); } catch (err) { fail(err); } return; }
    if (b.id === 'cr-imp') { const ks = sel().map(c => ativoDe(c.id)).filter(Boolean); if (!ks.length) return toast('Marque colaboradores que já têm crachá ativo', true); return imprimir(ks); }
    if (b.id === 'cr-emit') {
      const cs = sel().filter(c => c.situacao !== 'desligado'); if (!cs.length) return toast('Marque os colaboradores', true);
      const semFoto = cs.filter(c => !c.foto_path).length;
      if (semFoto && !await confirmDialog(`${semFoto} colaborador(es) sem foto: o crachá sai com o espaço da foto em branco. Continuar?`)) return;
      b.disabled = true;
      try { const ks = []; for (const c of cs) ks.push(ativoDe(c.id) || await emitir(c)); await imprimir(ks); render(root); } catch (err) { fail(err); b.disabled = false; }
    }
  });
}
async function carregarMinis(el) { for (const d of $$('[data-foto]', el)) { if (!d.dataset.foto) continue; const u = await urlArquivo(d.dataset.foto); if (u) d.style.backgroundImage = `url('${u}')`; } }

async function emitir(c, extra = {}) {
  const k = await q(sb.rpc('cracha_emitir', { p_cracha: { empresa_id: state.empresa.id, tipo: 'colaborador', colaborador_id: c.id, nome: c.nome, cargo: c.cargo, setor: c.setor, matricula: c.matricula,
    foto_path: c.foto_path, validade: CR.validadePadrao('colaborador', D.id.cracha_validade_meses), ...extra } }));
  D.K.forEach(x => { if (x.colaborador_id === c.id && x.status === 'ativo') x.status = 'cancelado'; }); D.K.unshift(k); return k;
}

// impressão num quadro escondido da própria página (sem janela pop-up, que o navegador bloqueia depois de esperas)
async function imprimir(ks) {
  toast('Preparando os crachás…');
  try {
    const id = D.id, logo = await CR.paraDataUrl(await urlArquivo(id.logo_path));
    const cartoes = [];
    for (const k of ks) {
      const foto = await CR.paraDataUrl(await urlArquivo(k.foto_path));
      cartoes.push(CR.htmlCracha(k, id, { logo, foto, qr: await CR.qrSvg(CR.urlVerificacao(k.codigo)) }));
    }
    document.getElementById('cr-print')?.remove();
    const fr = document.createElement('iframe'); fr.id = 'cr-print'; fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(fr);
    fr.contentDocument.open(); fr.contentDocument.write(CR.folhaImpressao(cartoes, id.cor_primaria)); fr.contentDocument.close();
    await new Promise(r => setTimeout(r, 500));
    fr.contentWindow.focus(); fr.contentWindow.print();
  } catch (err) { fail(err); }
}

// foto: câmera do computador/celular ou arquivo; recorte 3:4 e gravação em empresa/<empresa>/fotos/
async function tirarFoto(c, root, aoSalvar) {
  let stream = null;
  const md = modal({ title: `Foto do crachá — ${c.nome}`, body: `<div class="cr-cam"><video id="cf-v" playsinline autoplay muted hidden></video><img id="cf-img" hidden alt=""><div id="cf-msg" class="small muted">Use a câmera do aparelho ou envie uma foto. Rosto de frente, fundo claro, sem boné ou óculos escuros.</div><div class="cr-guia"></div></div>`,
    foot: `<button class="btn" id="cf-cam">Abrir câmera</button><label class="btn">Enviar foto<input type="file" accept="image/*" capture="user" id="cf-arq" hidden></label>
      <button class="btn" id="cf-tirar" hidden>Tirar foto</button><button class="btn" data-close>Cancelar</button><button class="btn primary" id="cf-ok" disabled>Salvar foto</button>` });
  let blob = null;
  const parar = () => { stream?.getTracks().forEach(t => t.stop()); stream = null; };
  const mostrar = async (b) => { blob = await CR.prepararFoto(b); const img = $('#cf-img', md.el); img.src = URL.createObjectURL(blob); img.hidden = false; $('#cf-v', md.el).hidden = true; $('#cf-ok', md.el).disabled = false; $('#cf-tirar', md.el).hidden = true; parar(); };
  $('#cf-cam', md.el).onclick = async () => {
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false }); }
    catch { return toast('A câmera não foi liberada no navegador. Use "Enviar foto" ou libere a câmera nas configurações do site.', true); }
    const v = $('#cf-v', md.el); v.srcObject = stream; v.hidden = false; $('#cf-img', md.el).hidden = true; $('#cf-tirar', md.el).hidden = false;
  };
  $('#cf-tirar', md.el).onclick = () => { const v = $('#cf-v', md.el), cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight; cv.getContext('2d').drawImage(v, 0, 0); cv.toBlob(b => mostrar(b), 'image/jpeg', 0.92); };
  $('#cf-arq', md.el).onchange = (e) => { const f = e.target.files?.[0]; if (f) mostrar(f).catch(fail); };
  md.el.addEventListener('click', (e) => { if (e.target === md.el || e.target.closest('[data-close]')) parar(); });
  $('#cf-ok', md.el).onclick = async (ev) => {
    ev.target.disabled = true;
    const path = `${state.empresa.id}/fotos/${c.id || 'avulso'}-${Date.now()}.jpg`;
    try {
      const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false }); if (error) throw error;
      if (aoSalvar) { await aoSalvar(path); }
      else {
        const antigo = c.foto_path;
        await q(sb.from('rh_colaboradores').update({ foto_path: path }).eq('id', c.id)); c.foto_path = path;
        // crachá ativo passa a usar a foto nova (o impresso só muda na próxima impressão)
        const k = ativoDe(c.id); if (k) { await q(sb.from('crachas').update({ foto_path: path }).eq('id', k.id)); k.foto_path = path; }
        if (antigo && !D.K.some(x => x.foto_path === antigo)) sb.storage.from(BUCKET).remove([antigo]).catch(() => {});
      }
      parar(); md.close(); toast('Foto salva'); if (root) render(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

async function autorizacao(c, root) {
  const md = modal({ title: `Autorização de uso de imagem — ${c.nome}`, body: `<p class="small">Registre a data em que o colaborador assinou a autorização para usar a foto no crachá e nos sistemas da empresa (LGPD). Guarde o documento assinado com o RH.</p>
    <label>Data da assinatura<input type="date" id="ai-d" value="${esc(c.autorizacao_imagem || today())}"></label>`,
    foot: `${c.autorizacao_imagem ? '<button class="btn ghost" id="ai-tira" style="margin-right:auto">Tirar o registro</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ai-ok">Salvar</button>` });
  const gravar = async (v) => { try { await q(sb.from('rh_colaboradores').update({ autorizacao_imagem: v }).eq('id', c.id)); c.autorizacao_imagem = v; md.close(); render(root); } catch (err) { fail(err); } };
  $('#ai-ok', md.el).onclick = () => gravar($('#ai-d', md.el).value || null);
  $('#ai-tira', md.el) && ($('#ai-tira', md.el).onclick = () => gravar(null));
}

// ---------------------------------------------------------------- terceiros e visitantes
function terceiros(corpo, root) {
  const pode = podeRH(), ks = D.K.filter(k => k.tipo !== 'colaborador' && k.status === 'ativo');
  corpo.innerHTML = `<div class="card toolbar"><span class="small muted">Crachás de prestadores de serviço (validade do contrato) e visitantes (válido só no dia).</span>
      ${pode ? '<span style="margin-left:auto;display:flex;gap:8px"><button class="btn" data-novo="visitante">+ Visitante</button><button class="btn primary" data-novo="terceiro">+ Prestador de serviço</button></span>' : ''}</div>
    <div class="card flush"><div class="table-wrap"><table><thead><tr><th>Foto</th><th>Nome</th><th>Tipo</th><th>Empresa</th><th>Validade</th><th></th></tr></thead><tbody>
    ${ks.map(k => `<tr><td><div class="cr-mini" data-foto="${esc(k.foto_path || '')}">${k.foto_path ? '' : '—'}</div></td><td><b>${esc(k.nome)}</b><div class="small muted">${esc(k.cargo || '')}</div></td>
      <td class="small">${CR.TIPOS[k.tipo]}</td><td class="small">${esc(k.empresa_terceiro || '')}</td>
      <td class="small">${k.validade ? dateBR(k.validade) : '—'}${CR.situacao(k) === 'vencido' ? ' <span class="badge vencido">vencido</span>' : ''}</td>
      <td style="white-space:nowrap">${pode ? `<button class="btn ghost small" data-imp="${k.id}">Imprimir</button><button class="btn ghost small" data-baixa="${k.id}">Devolvido</button>` : ''}</td></tr>`).join('')
      || '<tr><td colspan="6" class="empty">Nenhum crachá de terceiro ou visitante ativo.</td></tr>'}</tbody></table></div></div>`;
  carregarMinis(corpo);
  corpo.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.novo) return novoTerceiro(b.dataset.novo, root);
    if (b.dataset.imp) return imprimir([D.K.find(k => k.id === b.dataset.imp)]);
    if (b.dataset.baixa) { try { await q(sb.from('crachas').update({ status: 'devolvido', baixado_em: today() }).eq('id', b.dataset.baixa)); toast('Crachá devolvido'); render(root); } catch (err) { fail(err); } }
  };
}
function novoTerceiro(tipo, root) {
  let foto = null;
  const md = modal({ title: tipo === 'visitante' ? 'Crachá de visitante' : 'Crachá de prestador de serviço', body: `<div class="grid2">
      <label class="grow">Nome *<input id="nt-n"></label><label>CPF ou RG<input id="nt-doc"></label>
      <label class="grow">${tipo === 'visitante' ? 'De onde vem (empresa)' : 'Empresa prestadora *'}<input id="nt-emp"></label><label>${tipo === 'visitante' ? 'Motivo / quem visita' : 'Função'}<input id="nt-c"></label>
      <label>Validade<input type="date" id="nt-v" value="${CR.validadePadrao(tipo, tipo === 'terceiro' ? 6 : 0)}"></label></div>
    <p class="small muted">O CPF/RG fica só no controle interno; não vai no crachá nem no QR Code.</p>`,
    foot: `<button class="btn" id="nt-foto" style="margin-right:auto">Foto (opcional)</button><button class="btn" data-close>Cancelar</button><button class="btn primary" id="nt-ok">Emitir e imprimir</button>` });
  $('#nt-foto', md.el).onclick = () => tirarFoto({ nome: $('#nt-n', md.el).value || 'terceiro' }, null, async (p) => { foto = p; $('#nt-foto', md.el).textContent = 'Foto ✓'; });
  $('#nt-ok', md.el).onclick = async (ev) => {
    const g = (s) => $(s, md.el).value.trim();
    if (!g('#nt-n')) return toast('Informe o nome', true); if (tipo === 'terceiro' && !g('#nt-emp')) return toast('Informe a empresa prestadora', true);
    ev.target.disabled = true;
    try {
      const k = await q(sb.rpc('cracha_emitir', { p_cracha: { empresa_id: state.empresa.id, tipo, nome: g('#nt-n').toUpperCase(), documento: g('#nt-doc') || null, empresa_terceiro: g('#nt-emp').toUpperCase() || null,
        cargo: g('#nt-c') || null, validade: g('#nt-v') || null, foto_path: foto } }));
      D.K.unshift(k); md.close(); await imprimir([k]); render(root);
    } catch (err) { fail(err); ev.target.disabled = false; }
  };
}

// ---------------------------------------------------------------- histórico
function historico(corpo, root) {
  const pode = podeRH();
  corpo.innerHTML = `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Emissão</th><th>Nome</th><th>Tipo</th><th>Via</th><th>Validade</th><th>Situação</th><th>Baixa</th><th></th></tr></thead><tbody>
    ${D.K.map(k => { const st = CR.situacao(k, D.C.find(c => c.id === k.colaborador_id));
      return `<tr><td class="small">${dateBR(k.emitido_em)}</td><td><b>${esc(k.nome)}</b></td><td class="small">${CR.TIPOS[k.tipo]}</td><td>${k.via}</td><td class="small">${k.validade ? dateBR(k.validade) : '—'}</td>
      <td><span class="badge ${st === 'ativo' ? 'pago' : st === 'devolvido' ? '' : 'vencido'}">${st === 'cancelar' ? 'Recolher' : st === 'vencido' ? 'Vencido' : CR.SITUACAO[st]}</span></td>
      <td class="small">${k.baixado_em ? `${dateBR(k.baixado_em)}${k.motivo ? ` · ${esc(k.motivo)}` : ''}` : ''}</td>
      <td style="white-space:nowrap">${pode && k.status === 'ativo' ? `<button class="btn ghost small" data-st="${k.id}|devolvido">Devolvido</button><button class="btn ghost small" data-st="${k.id}|extraviado">Extraviado</button>` : ''}</td></tr>`; }).join('')
      || '<tr><td colspan="8" class="empty">Nenhum crachá emitido.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">Crachá devolvido ou extraviado deixa de ser válido na hora: quem ler o QR Code vê a situação.</p>`;
  corpo.onclick = async (e) => {
    const b = e.target.closest('[data-st]'); if (!b) return;
    const [idk, st] = b.dataset.st.split('|');
    if (!await confirmDialog(st === 'extraviado' ? 'Marcar como extraviado? O QR Code passa a mostrar "extraviado".' : 'Dar baixa como devolvido?')) return;
    try { await q(sb.from('crachas').update({ status: st, baixado_em: today() }).eq('id', idk)); toast('Baixa registrada'); render(root); } catch (err) { fail(err); }
  };
}

