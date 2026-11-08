// Modo sem internet (melhoria 1.5): Terminal do Setor, Manutenção no Celular e pesagem da Casa de Tintas.
//  • leituras: nas telas da lista ROTAS, o que veio do servidor fica guardado no aparelho (IndexedDB); sem sinal, a tela
//    abre com o último dado e com o que foi registrado offline (aplicado por cima, pelos mesmos filtros da consulta);
//  • gravações: gravar() tenta na hora; sem sinal, guarda na fila e manda quando a internet voltar, na ordem;
//    inclusões levam o id gerado no aparelho (repetir não duplica) e a pesagem vai por sync_rpc (chave única, SQL 122);
//  • o selo no topo mostra "Sem internet" e quantos registros esperam; o clique abre a fila.
import { sb, state, ganchoQ } from './data.js';
import { esc, toast, modal, $ } from './ui.js';
import { ehRede, chaveLeitura, tabelaDa, filtrosDa, mesclar } from './offline-calc.js';
export { ehRede, chaveLeitura, mesclar };

export const ROTAS = ['producao/terminal', 'manutencao/celular', 'tintas/ordens', 'logistica/motorista'];
export const RPC_PERMITIDAS = ['tin_pesar', 'log_motorista_iniciar', 'log_motorista_chegada', 'log_motorista_entregar', 'log_motorista_ocorrencia', 'log_motorista_posicao', 'log_motorista_concluir'];
const DB_NOME = 'iplamm-offline', LIMITE = 3e6;   // leituras acima de ~3 MB não são guardadas
let dbP = null;
const ouvintes = new Set();

// ---------- IndexedDB mínimo ----------
function abrir() {
  if (dbP) return dbP;
  dbP = new Promise((ok, erro) => {
    if (typeof indexedDB === 'undefined') return erro(new Error('sem IndexedDB'));
    const r = indexedDB.open(DB_NOME, 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('leituras', { keyPath: 'chave' }); d.createObjectStore('fila', { keyPath: 'id' }); };
    r.onsuccess = () => ok(r.result); r.onerror = () => erro(r.error);
  });
  return dbP;
}
async function loja(nome, modo, fn) {
  const d = await abrir();
  return new Promise((ok, erro) => { const t = d.transaction(nome, modo), s = t.objectStore(nome); const r = fn(s); t.oncomplete = () => ok(r?.result); t.onerror = () => erro(t.error); });
}
const pegar = (nome, chave) => loja(nome, 'readonly', s => s.get(chave));
const todos = (nome) => loja(nome, 'readonly', s => s.getAll());
const por = (nome, v) => loja(nome, 'readwrite', s => s.put(v));
const tirar = (nome, chave) => loja(nome, 'readwrite', s => s.delete(chave));

export const ativo = () => ROTAS.includes(state.rota);

// ---------- gancho do q(): guarda as leituras e responde sem sinal ----------
ganchoQ.ler = true;
ganchoQ.ehRede = ehRede;
ganchoQ.guardar = (b, dados) => {
  if (!ativo()) return;
  try { const j = JSON.stringify(dados); if (j.length > LIMITE) return; } catch { return; }
  por('leituras', { chave: chaveLeitura(b.url), dados, em: Date.now() }).catch(() => {});
};
ganchoQ.offline = async (b) => {
  if (!ativo()) return undefined;
  try {
    const g = await pegar('leituras', chaveLeitura(b.url)), fila = await todos('fila');
    const base = g ? g.dados : [];
    marcarSemSinal(true);
    return mesclar(base, tabelaDa(b.url), filtrosDa(b.url), fila);
  } catch { return undefined; }
};

// ---------- gravações ----------
export const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

async function executar(op) {
  let r;
  if (op.t === 'insert') r = await sb.from(op.tabela).upsert(op.valores, { onConflict: op.conflito || 'id', ignoreDuplicates: true });
  else if (op.t === 'update') r = await sb.from(op.tabela).update(op.valores).eq('id', op.id);
  else if (op.t === 'upload') { r = await sb.storage.from(op.bucket).upload(op.caminho, op.arquivo); if (r.error && /already exists|Duplicate|409/i.test(String(r.error.message || r.error.statusCode || ''))) r = { data: null, error: null }; }   // já subiu antes: segue
  else if (op.t === 'rpc') { if (!RPC_PERMITIDAS.includes(op.nome)) throw new Error('Operação não permitida sem internet.'); r = await sb.rpc('sync_rpc', { p_chave: op.chave, p_nome: op.nome, p_args: op.args });
    // banco ainda sem o SQL 122: chama a função direto (sem a proteção contra repetição)
    if (r.error && /sync_rpc|Could not find the function|PGRST202/i.test(String(r.error.message || r.error.code || ''))) r = await sb.rpc(op.nome, op.args); }
  else throw new Error('Operação desconhecida: ' + op.t);
  if (r.error) { const e = new Error(r.error.message || String(r.error)); e.rede = ehRede(r.error, r.status); throw e; }
  return r.data;
}

/**
 * Grava agora ou, sem sinal, guarda para depois.
 * ops: [{t:'insert', tabela, valores (com id; ou conflito:'sync_id' e valores.sync_id)}, {t:'update', tabela, id, valores}, {t:'upload', bucket, caminho, arquivo}, {t:'rpc', nome, args, chave, sombra}]
 * Devolve {pendente: true} quando ficou na fila (a tela deve avisar). Erro do servidor é lançado como sempre.
 */
export async function gravar(rotulo, ops) {
  ops.forEach(o => { if (o.t === 'rpc') o.chave ||= novoId(); });
  const resto = [...ops], resultados = [];
  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    while (resto.length) {
      try { resultados.push(await executar(resto[0])); resto.shift(); }
      catch (e) { if (!e.rede && !ehRede(e)) throw e; break; }
    }
    if (!resto.length) { marcarSemSinal(false); return { pendente: false, resultados }; }
  }
  await por('fila', { id: novoId(), rotulo, rota: state.rota || '', ops: resto, criado_em: new Date().toISOString(), usuario: state.user?.email || '', erro: null });
  marcarSemSinal(true); avisar();
  return { pendente: true, resultados };
}

let sincronizando = false;
/** manda a fila na ordem; para no primeiro erro de rede; erro do servidor fica marcado no item */
export async function sincronizar() {
  if (sincronizando || (typeof navigator !== 'undefined' && navigator.onLine === false)) return { enviados: 0 };
  sincronizando = true; let enviados = 0, erros = 0;
  try {
    const fila = (await todos('fila')).sort((a, b) => a.criado_em.localeCompare(b.criado_em));
    for (const it of fila) {
      if (it.erro) { erros++; continue; }
      try {
        while (it.ops.length) { await executar(it.ops[0]); it.ops.shift(); await por('fila', it); }
        await tirar('fila', it.id); enviados++;
      } catch (e) {
        if (e.rede || ehRede(e)) { marcarSemSinal(true); break; }
        it.erro = e.message || String(e); await por('fila', it); erros++;
      }
    }
    if (enviados) { marcarSemSinal(false); toast(`${enviados} registro(s) feitos sem internet foram enviados`); }
    if (erros) toast(`${erros} registro(s) sem internet com erro: veja no selo do topo`, true);
  } catch { /* sem IndexedDB */ } finally { sincronizando = false; avisar(); }
  return { enviados, erros };
}
export const fila = () => todos('fila').catch(() => []);
export async function descartar(id) { await tirar('fila', id); avisar(); }
export async function tentarDeNovo(id) { const it = await pegar('fila', id); if (it) { it.erro = null; await por('fila', it); } return sincronizar(); }

// ---------- selo no topo ----------
let semSinal = false;
function marcarSemSinal(v) { if (semSinal !== v) { semSinal = v; avisar(); } }
export const aoMudar = (fn) => { ouvintes.add(fn); return () => ouvintes.delete(fn); };
async function avisar() {
  const L = await fila(), el = typeof document !== 'undefined' && document.getElementById('off-ind');
  ouvintes.forEach(f => { try { f(L, semSinal); } catch {} });
  if (!el) return;
  const off = semSinal || navigator.onLine === false, err = L.filter(x => x.erro).length;
  el.hidden = !off && !L.length;
  el.className = 'btn small off-ind ' + (err ? 'neg' : off ? 'warn' : '');
  el.textContent = off ? `Sem internet${L.length ? ' · ' + L.length + ' a enviar' : ''}` : err ? `${err} com erro` : `${L.length} a enviar`;
}

function abrirFila() {
  fila().then(L => {
    const m = modal({ title: 'Registros feitos sem internet', body: `<p class="small muted">Ficam guardados neste aparelho e vão para a plataforma, na ordem, quando a internet voltar. Não limpe os dados do navegador com registros na fila.</p>
      <div class="table-wrap"><table class="small"><thead><tr><th>Quando</th><th>O quê</th><th>Situação</th><th></th></tr></thead><tbody>
      ${L.sort((a, b) => a.criado_em.localeCompare(b.criado_em)).map(x => `<tr><td>${new Date(x.criado_em).toLocaleString('pt-BR').slice(0, 17)}</td><td>${esc(x.rotulo)}</td>
        <td>${x.erro ? `<span class="badge vencido">Erro</span> <span class="small">${esc(x.erro)}</span>` : '<span class="badge aberto">Aguardando</span>'}</td>
        <td style="white-space:nowrap">${x.erro ? `<button class="btn ghost small" data-de="${x.id}">Tentar de novo</button>` : ''}<button class="btn ghost small" data-dc="${x.id}">Descartar</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nada na fila.</td></tr>'}</tbody></table></div>`,
      foot: '<button class="btn" data-close>Fechar</button><button class="btn primary" id="of-sync">Enviar agora</button>' });
    $('#of-sync', m.el).onclick = async () => { const r = await sincronizar(); m.close(); if (!r.enviados && navigator.onLine === false) toast('Ainda sem internet', true); };
    m.el.querySelectorAll('[data-dc]').forEach(b => b.onclick = async () => { if (!confirm('Descartar este registro? Ele não vai para a plataforma.')) return; await descartar(b.dataset.dc); m.close(); abrirFila(); });
    m.el.querySelectorAll('[data-de]').forEach(b => b.onclick = async () => { await tentarDeNovo(b.dataset.de); m.close(); abrirFila(); });
  });
}

/** liga o modo sem internet: service worker (app abre sem sinal), selo, sincronização ao voltar e a cada 30 s */
export function iniciarOffline(versao) {
  if (typeof window === 'undefined') return;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  const el = document.getElementById('off-ind'); if (el) el.onclick = abrirFila;
  window.addEventListener('online', () => { marcarSemSinal(false); state.cad = state.cad?._offline ? null : state.cad; sincronizar(); });
  window.addEventListener('offline', () => marcarSemSinal(true));
  setInterval(() => { sincronizar(); }, 30000);
  sincronizar(); avisar();
  // deixa as três telas guardadas no aparelho (o service worker grava os arquivos ao baixar)
  if (versao && navigator.onLine !== false) setTimeout(() => ['producao-terminal', 'manutencao-celular', 'tintas-ordens', 'logistica-motorista'].forEach(p => import(`../pages/${p}.js?v=${versao}`).catch(() => {})), 8000);
}

// membro e empresa guardados para abrir sem sinal
export const guardarEntrada = (uid, emp, papel, areas) => { try { localStorage.setItem('fc-off-' + uid, JSON.stringify({ emp, papel, areas })); } catch {} };
export const lerEntrada = (uid) => { try { return JSON.parse(localStorage.getItem('fc-off-' + uid) || 'null'); } catch { return null; } };
