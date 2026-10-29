// Conversas (chat interno): serviço que fica ligado enquanto a pessoa está na plataforma.
// Mantém a lista de conversas e as não lidas, recebe em tempo real (Supabase Realtime) mensagens, edições e reações,
// toca o som, mostra os contadores (menu, topo e título da aba), envia mensagens, anexos e áudios, guarda a fila do que
// não saiu (sem internet), e cuida do online / visto por último e do "digitando…".
// A tela Conversas (pages/conversas.js) e o mini-chat só desenham: ouvem os eventos daqui.
// Regras de acesso ficam no banco (SQL 059 e 060): aqui nada é decidido sobre quem pode ler o quê.
import { sb, state, q } from './data.js';
import { $, toast } from './ui.js';
import { dispararAvisos } from './notif.js';

const ouvintes = new Set();
let canal = null, canalPres = null, timer = null, timerFila = null, timerVisto = null, empresaId = null;
let resumo = [], contatos = null, contatosPend = null, aberta = null, pronto = false, etapa2 = false, mostrarVisto = true, meuNome = '';
const online = new Set();
const fila = [];                       // mensagens que ainda não foram confirmadas pelo servidor
const urls = new Map();                // caminho → { url, ate }
const cartoes = new Map();             // "tipo:id" → { titulo, sub, link } | null (sem acesso)

export const ouvir = (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); };
const emitir = (ev, dado) => ouvintes.forEach(f => { try { f(ev, dado); } catch (e) { console.error(e); } });
export const getResumo = () => resumo;
export const getFila = (conversa) => fila.filter(x => x.conversa === conversa);
export const chatPronto = () => pronto;
export const temEtapa2 = () => etapa2;
export const setAberta = (id) => { aberta = id || null; };
export const getAberta = () => aberta;
export const eu = () => state.user?.id;
export const estaOnline = (uid) => online.has(uid);
export const getMostrarVisto = () => mostrarVisto;
export const getMeuNome = () => meuNome;

const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const agendarResumo = debounce(() => atualizarResumo(), 400);
const marcarEntregue = debounce(() => { if (empresaId) sb.rpc('chat_marcar_entregue', { p_empresa: empresaId }).then(() => {}, () => {}); }, 1500);
const avisar = debounce(() => dispararAvisos(), 1200);
export const silenciada = (c) => !!(c?.silenciada_ate && new Date(c.silenciada_ate) > new Date());

const SELECT_1 = 'id, conversa_id, empresa_id, autor_id, tipo, texto, cliente_id, criado_em, chat_anexos(id, caminho, nome, mime, tamanho, largura, altura)';
const SELECT_2 = 'id, conversa_id, empresa_id, autor_id, tipo, texto, cliente_id, criado_em, resposta_a, encaminhada, editado_em, apagado_em, mencoes, cartao, '
  + 'chat_anexos(id, caminho, nome, mime, tamanho, largura, altura), chat_reacoes(user_id, emoji)';
export const selectMsg = () => (etapa2 ? SELECT_2 : SELECT_1);

// ---------- ciclo de vida ----------
export async function iniciarChat() {
  pararChat();
  if (!state.empresa || !state.user) return;
  empresaId = state.empresa.id;
  await atualizarResumo(true);
  if (!pronto) return;                  // SQL 059 ainda não rodou: o chat fica escondido
  // SQL 060 (etapa 2) já rodou?
  try { const { error } = await sb.from('chat_mensagens').select('id, apagado_em').limit(1); etapa2 = !error; } catch { etapa2 = false; }
  // o meu nome como os outros me veem (para destacar quando me mencionam): mesma regra do banco (_chat_nome)
  { const md = state.user?.user_metadata || {}; meuNome = (md.nome || md.full_name || (state.user?.email || '').split('@')[0] || '').trim();
    sb.from('membros').select('nome').eq('empresa_id', empresaId).eq('user_id', eu()).maybeSingle().then(({ data }) => { if (data?.nome?.trim()) meuNome = data.nome.trim(); }, () => {}); }
  marcarEntregue();
  canal = sb.channel('chat-' + empresaId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_mensagens', filter: `empresa_id=eq.${empresaId}` }, (p) => chegou(p.new))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_mensagens', filter: `empresa_id=eq.${empresaId}` }, (p) => mudou(p.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_participantes', filter: `empresa_id=eq.${empresaId}` }, (p) => {
      if (p.new && p.new.conversa_id) emitir('participante', p.new);
      if (p.eventType !== 'UPDATE' || p.new?.user_id === eu()) agendarResumo();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_conversas', filter: `empresa_id=eq.${empresaId}` }, (p) => { emitir('conversa', p.new); agendarResumo(); });
  if (etapa2) {
    canal.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_reacoes', filter: `empresa_id=eq.${empresaId}` }, (p) => emitir('reacao', p.new?.mensagem_id))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_reacoes', filter: `empresa_id=eq.${empresaId}` }, (p) => emitir('reacao', p.new?.mensagem_id))
      // exclusão não aceita filtro: chega só a chave (mensagem e pessoa), e a tela recarrega as reações se a mensagem estiver aberta
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_reacoes' }, (p) => emitir('reacao', p.old?.mensagem_id));
  }
  canal.subscribe((st) => emitir('conexao', st));
  if (etapa2) iniciarPresenca();
  timer = setInterval(() => atualizarResumo(), 60000);       // reserva, se o tempo real cair
  timerFila = setInterval(processarFila, 15000);
  window.addEventListener('online', processarFila);
  document.addEventListener('visibilitychange', aoVoltar);
  window.addEventListener('pagehide', gravarVisto);
}
export function pararChat() {
  gravarVisto();
  for (const c of [canal, canalPres, ...canaisDig.values()]) if (c) { try { sb.removeChannel(c); } catch {} }
  canal = canalPres = null; canaisDig.clear();
  clearInterval(timer); clearInterval(timerFila); clearInterval(timerVisto); timer = timerFila = timerVisto = null;
  window.removeEventListener('online', processarFila);
  document.removeEventListener('visibilitychange', aoVoltar);
  window.removeEventListener('pagehide', gravarVisto);
  resumo = []; contatos = null; contatosPend = null; aberta = null; pronto = false; empresaId = null; fila.length = 0; online.clear(); cartoes.clear();
  pintarContador();
}
function aoVoltar() {
  if (!empresaId) return;
  if (document.hidden) { gravarVisto(); return; }
  atualizarResumo(); marcarEntregue(); processarFila();
}

export async function atualizarResumo(primeira = false) {
  if (!empresaId) return resumo;
  try {
    resumo = await q(sb.rpc('chat_resumo', { p_empresa: empresaId })) || [];
    pronto = true;
  } catch (e) { if (primeira) { pronto = false; pintarContador(); } return resumo; }
  pintarContador();
  emitir('resumo', resumo);
  return resumo;
}

// ---------- online, visto por último e "digitando…" ----------
function iniciarPresenca() {
  sb.rpc('chat_visto', { p_mostrar: null }).then(({ data }) => {
    mostrarVisto = data !== false;
    canalPres = sb.channel('chat-pres-' + empresaId, { config: { presence: { key: eu() } } })
      .on('presence', { event: 'sync' }, () => {
        online.clear();
        for (const k of Object.keys(canalPres.presenceState())) if (k !== eu()) online.add(k);
        emitir('presenca', online);
      })
      .subscribe((st) => { if (st === 'SUBSCRIBED' && mostrarVisto) canalPres.track({ em: new Date().toISOString() }); });
  }, () => {});
  timerVisto = setInterval(() => { if (!document.hidden) gravarVisto(); }, 120000);
}
function gravarVisto() { if (empresaId && etapa2) sb.rpc('chat_visto', { p_mostrar: null }).then(() => {}, () => {}); }
export async function setMostrarVisto(sim) {
  mostrarVisto = !!(await q(sb.rpc('chat_visto', { p_mostrar: !!sim })));
  if (canalPres) { if (mostrarVisto) canalPres.track({ em: new Date().toISOString() }); else canalPres.untrack(); }
  await getContatos(true);
  emitir('presenca', online);
}

// "digitando…": um canal por conversa aberta (o evento não passa pelo banco)
const canaisDig = new Map();
const digitando = new Map();           // conversa → Map(user → {acao, ate})
export function entrarDigitando(conversa) {
  if (!etapa2 || !conversa || canaisDig.has(conversa)) return;
  const ch = sb.channel('chat-dig-' + conversa).on('broadcast', { event: 'dig' }, ({ payload }) => {
    if (!payload || payload.u === eu()) return;
    const mp = digitando.get(conversa) || new Map(); digitando.set(conversa, mp);
    if (payload.acao === 'parou') mp.delete(payload.u); else mp.set(payload.u, { acao: payload.acao, ate: Date.now() + 6000 });
    emitir('digitando', conversa);
    setTimeout(() => emitir('digitando', conversa), 6100);
  }).subscribe();
  canaisDig.set(conversa, ch);
}
export function sairDigitando(conversa) { const ch = canaisDig.get(conversa); if (ch) { try { sb.removeChannel(ch); } catch {} canaisDig.delete(conversa); } }
export function quemDigita(conversa) {
  const mp = digitando.get(conversa); if (!mp) return [];
  const agora = Date.now(); return [...mp].filter(([, v]) => v.ate > agora).map(([u, v]) => ({ u, acao: v.acao }));
}
let ultDig = 0;
export function avisarDigitando(conversa, acao = 'digitando') {
  const ch = canaisDig.get(conversa); if (!ch) return;
  if (acao === 'digitando' && Date.now() - ultDig < 2500) return;
  ultDig = acao === 'digitando' ? Date.now() : 0;
  ch.send({ type: 'broadcast', event: 'dig', payload: { u: eu(), acao } }).catch?.(() => {});
}

// ---------- mensagens que chegam ----------
async function completa(m) { try { return await q(sb.from('chat_mensagens').select(selectMsg()).eq('id', m.id).maybeSingle()) || m; } catch { return m; } }
async function chegou(m) {
  if (!m || m.empresa_id !== empresaId) return;
  // anexos são gravados junto com a mensagem: busca a mensagem completa (e confirma que a pessoa pode ler)
  if (m.tipo === 'anexo') m = await completa(m);
  const minha = m.autor_id === eu();
  if (minha && m.cliente_id) { const i = fila.findIndex(x => x.clienteId === m.cliente_id); if (i >= 0) fila.splice(i, 1); }
  const dg = digitando.get(m.conversa_id); if (dg) { dg.delete(m.autor_id); emitir('digitando', m.conversa_id); }
  emitir('mensagem', m);
  agendarResumo();
  if (minha || m.tipo === 'sistema') return;
  marcarEntregue();
  const c = resumo.find(x => x.id === m.conversa_id);
  const vendo = aberta === m.conversa_id && !document.hidden;
  const mencionou = (m.mencoes || []).includes(eu());
  if (!vendo && (!silenciada(c) || mencionou)) {
    tocar();
    if (!location.hash.startsWith('#/conversas') && !document.querySelector('.mini-chat:not([hidden])')) {
      const quem = nomeDe(m.autor_id);
      toast(`${c && c.tipo !== 'direta' ? c.nome + ' · ' : ''}${quem}${mencionou ? ' mencionou você' : ''}: ${(m.texto || '📎 arquivo').slice(0, 80)}`);
    }
  }
}
async function mudou(m) {
  if (!m || m.empresa_id !== empresaId) return;
  emitir('mudou', await completa(m));
  agendarResumo();
}

function tocar() {
  try {
    const c = new AudioContext(), g = c.createGain(); g.gain.value = 0.05; g.connect(c.destination);
    [[660, 0], [990, 0.09]].forEach(([f, t]) => { const o = c.createOscillator(); o.frequency.value = f; o.connect(g); o.start(c.currentTime + t); o.stop(c.currentTime + t + 0.08); });
  } catch {}
}

// ---------- contadores ----------
export const naoLidas = () => resumo.filter(c => c.nao_lidas > 0 && !c.arquivada && (!silenciada(c) || c.mencoes > 0)).length;
function pintarContador() {
  const n = pronto ? naoLidas() : 0;
  const txt = n > 99 ? '99+' : String(n);
  for (const el of document.querySelectorAll('.chat-n')) { el.hidden = !n; el.textContent = txt; }
  const b = $('#chat-btn'); if (b) b.hidden = !pronto;
  const nav = document.querySelector('#nav .nav-area[data-area="conv"]'); if (nav) nav.hidden = !pronto;
  ajustarTitulo();
}
export function ajustarTitulo() {
  const n = pronto ? naoLidas() : 0;
  const base = document.title.replace(/^\(\d+\+?\)\s/, '');
  const novo = (n ? `(${n > 99 ? '99+' : n}) ` : '') + base;
  if (document.title !== novo) document.title = novo;
}
// o roteador troca o título a cada tela: recoloca o número
new MutationObserver(() => { if (!/^\(\d+\+?\)\s/.test(document.title) && pronto && naoLidas()) ajustarTitulo(); })
  .observe(document.querySelector('title') || document.head, { childList: true, subtree: true, characterData: true });

// ---------- pessoas ----------
export async function getContatos(forcar = false) {
  if (contatos && !forcar) return contatos;
  if (contatosPend && !forcar) return contatosPend;
  contatosPend = q(sb.rpc('chat_contatos', { p_empresa: empresaId })).then(r => (contatos = r || [])).finally(() => { contatosPend = null; });
  return contatosPend;
}
export const contatoDe = (uid) => contatos?.find(c => c.user_id === uid) || null;
export function nomeDe(uid) {
  if (!uid) return '';
  if (uid === eu()) return 'Você';
  return contatoDe(uid)?.nome || 'Ex-participante';
}

// ---------- cartões de registro ----------
export async function infoCartoes(lista) {
  const falta = lista.filter(c => c && c.tipo && c.id && !cartoes.has(`${c.tipo}:${c.id}`));
  if (falta.length && etapa2) {
    try {
      const r = await q(sb.rpc('chat_cartoes', { p_itens: falta.map(c => ({ tipo: c.tipo, id: c.id })) })) || [];
      for (const c of falta) cartoes.set(`${c.tipo}:${c.id}`, null);
      for (const x of r) cartoes.set(`${x.tipo}:${x.id}`, x);
    } catch {}
  }
  return (c) => (c ? cartoes.get(`${c.tipo}:${c.id}`) : null);
}

// ---------- enviar ----------
const limparNome = (n) => String(n || 'arquivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_').slice(-80);
const LIMITE = 25 * 1024 * 1024;

// fotos grandes vão reduzidas (como no WhatsApp): até 1920 px, JPEG. Outros arquivos vão como estão.
async function prepararArquivo(f) {
  const ehImg = /^image\/(jpeg|png|webp|gif)$/.test(f.type);
  let dim = {};
  if (ehImg) { try { const b = await createImageBitmap(f); dim = { largura: b.width, altura: b.height }; b.close?.(); } catch {} }
  if (/^image\/(jpeg|webp)$/.test(f.type) && f.size > 1.5 * 1024 * 1024 && dim.largura) {
    try {
      const fator = Math.min(1, 1920 / Math.max(dim.largura, dim.altura));
      const bmp = await createImageBitmap(f);
      const cv = document.createElement('canvas'); cv.width = Math.round(dim.largura * fator); cv.height = Math.round(dim.altura * fator);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.85));
      if (blob && blob.size < f.size) return { arquivo: new File([blob], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }), largura: cv.width, altura: cv.height };
    } catch {}
  }
  return { arquivo: f, ...dim };
}

/** entra na fila e tenta enviar. arquivos: File[]. extra: { resposta_a, mencoes, cartao, encaminhada, anexos (já no armazenamento) } */
export function enviar(conversa, texto, arquivos = [], extra = {}) {
  for (const f of arquivos) if (f.size > LIMITE) { toast(`"${f.name}" passa de 25 MB`, true); return null; }
  const item = { clienteId: crypto.randomUUID(), conversa, texto: texto || '', arquivos, anexos: extra.anexos || null, extra, status: 'enviando', criado_em: new Date().toISOString(), erro: null };
  fila.push(item);
  emitir('fila', item);
  enviarItem(item);
  return item;
}
export function reenviar(clienteId) { const it = fila.find(x => x.clienteId === clienteId); if (it) { it.status = 'enviando'; emitir('fila', it); enviarItem(it); } }
export function descartar(clienteId) { const i = fila.findIndex(x => x.clienteId === clienteId); if (i >= 0) { const [it] = fila.splice(i, 1); it.status = 'descartado'; emitir('fila', it); } }

async function enviarItem(item) {
  if (item.ocupado) return;
  item.ocupado = true;
  try {
    if (item.arquivos.length && !item.anexos) {
      const anexos = [];
      for (const f of item.arquivos) {
        const p = await prepararArquivo(f);
        const caminho = `${empresaId}/${item.conversa}/${crypto.randomUUID()}-${limparNome(p.arquivo.name)}`;
        const { error } = await sb.storage.from('chat').upload(caminho, p.arquivo, { contentType: p.arquivo.type || 'application/octet-stream', upsert: false });
        if (error) throw error;
        anexos.push({ caminho, nome: p.arquivo.name, mime: p.arquivo.type || null, tamanho: p.arquivo.size, largura: p.largura || null, altura: p.altura || null });
      }
      item.anexos = anexos;
    }
    const ex = item.extra || {};
    const args = { p_conversa: item.conversa, p_texto: item.texto || null, p_cliente_id: item.clienteId, p_anexos: item.anexos || [] };
    if (etapa2) Object.assign(args, { p_resposta_a: ex.resposta_a || null, p_mencoes: ex.mencoes || [], p_cartao: ex.cartao || null, p_encaminhada: !!ex.encaminhada });
    const m = await q(sb.rpc('chat_enviar', args));
    if (m && !m.chat_anexos) m.chat_anexos = (item.anexos || []).map(x => ({ ...x, mensagem_id: m.id }));
    if (m && !m.chat_reacoes) m.chat_reacoes = [];
    const i = fila.indexOf(item); if (i >= 0) fila.splice(i, 1);
    item.status = 'enviada';
    emitir('enviada', { item, m });
    avisar();
    agendarResumo();
  } catch (e) {
    const semRede = !navigator.onLine || /fetch|network|Failed to fetch|Load failed/i.test(e?.message || '');
    item.status = semRede ? 'aguardando' : 'falhou';
    item.erro = semRede ? 'Sem internet: vai assim que a conexão voltar' : (e?.message || String(e));
    emitir('fila', item);
  } finally { item.ocupado = false; }
}
function processarFila() { if (!navigator.onLine) return; for (const it of fila) if (it.status === 'aguardando') { it.status = 'enviando'; emitir('fila', it); enviarItem(it); } }

/** encaminhar: copia os arquivos para a pasta da conversa de destino e envia como "Encaminhada" */
export async function encaminhar(m, destinos) {
  let n = 0;
  for (const d of destinos) {
    const anexos = [];
    for (const a of (m.chat_anexos || [])) {
      const caminho = `${empresaId}/${d}/${crypto.randomUUID()}-${limparNome(a.nome)}`;
      const { error } = await sb.storage.from('chat').copy(a.caminho, caminho);
      if (error) throw error;
      anexos.push({ caminho, nome: a.nome, mime: a.mime, tamanho: a.tamanho, largura: a.largura, altura: a.altura });
    }
    enviar(d, m.texto || '', [], { encaminhada: true, cartao: m.cartao || null, anexos: anexos.length ? anexos : null });
    n++;
  }
  return n;
}

// ---------- anexos: link temporário (1 hora) ----------
export async function urlsAnexos(caminhos) {
  const agora = Date.now(), faltam = [...new Set(caminhos)].filter(c => !(urls.get(c)?.ate > agora));
  if (faltam.length) {
    try {
      const { data } = await sb.storage.from('chat').createSignedUrls(faltam, 3600);
      for (const d of data || []) if (d.signedUrl) urls.set(d.path, { url: d.signedUrl, ate: agora + 50 * 60e3 });
    } catch {}
  }
  return Object.fromEntries(caminhos.map(c => [c, urls.get(c)?.url || null]));
}

// ---------- ações ----------
export const marcarLida = debounce((conversa) => {
  if (!conversa || document.hidden) return;
  const c = resumo.find(x => x.id === conversa);
  if (c && c.nao_lidas) { c.nao_lidas = 0; c.mencoes = 0; pintarContador(); emitir('resumo', resumo); }
  sb.rpc('chat_marcar', { p_conversa: conversa, p_lida: true }).then(() => agendarResumo(), () => {});
}, 600);
export async function abrirDireta(uid) { return q(sb.rpc('chat_abrir_direta', { p_empresa: empresaId, p_user: uid })); }
export async function abrirRegistro(tipo, id) { const c = await q(sb.rpc('chat_registro', { p_tipo: tipo, p_id: id })); await atualizarResumo(); return c; }
export async function criarGrupo(nome, descricao, users) { const id = await q(sb.rpc('chat_criar_grupo', { p_empresa: empresaId, p_nome: nome, p_descricao: descricao || null, p_users: users })); await atualizarResumo(); return id; }
export async function preferencias(conversa, prefs) {
  await q(sb.rpc('chat_preferencias', { p_conversa: conversa, p_silenciada_ate: prefs.silenciada_ate ?? null, p_fixada: prefs.fixada ?? null,
    p_arquivada: prefs.arquivada ?? null, p_tirar_silencio: !!prefs.tirar_silencio }));
  await atualizarResumo();
}
export const editar = (id, texto) => q(sb.rpc('chat_editar', { p_mensagem: id, p_texto: texto }));
export const apagar = (id, paraTodos) => q(sb.rpc('chat_apagar', { p_mensagem: id, p_para_todos: paraTodos }));
export const reagir = (id, emoji) => q(sb.rpc('chat_reagir', { p_mensagem: id, p_emoji: emoji || null }));
export const favoritar = (id, sim) => q(sb.rpc('chat_favoritar', { p_mensagem: id, p_sim: sim }));
export const fixarMsg = (conversa, id) => q(sb.rpc('chat_fixar_msg', { p_conversa: conversa, p_mensagem: id || null }));
export const buscar = (termo, conversa = null) => q(sb.rpc('chat_buscar', { p_empresa: empresaId, p_termo: termo, p_conversa: conversa }));
export const getEmpresa = () => empresaId;
