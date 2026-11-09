// Painéis › Pergunte à plataforma (PAI009, melhoria 1.8): perguntas em português sobre os dados da empresa, respondidas
// pela IA com texto, gráfico, a tabela usada e o link da tela de origem. Só consulta (função de borda "perguntar").
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, fail, toast, modal, chart, CORES, exportXLSX, dateBR } from '../lib/ui.js';
import { formatarValor, rotuloChave, configGrafico, textoHtml, SUGESTOES, anteriores } from '../lib/ia.js';

export const title = 'Pergunte à plataforma';
const ui = { conversa: [], aba: 'perguntar', cfg: null, pode: false };
const PAPEIS = [['admin', 'Administrador'], ['diretor', 'Diretor'], ['financeiro', 'Financeiro'], ['compras', 'Compras'], ['vendas', 'Vendas'], ['producao', 'Produção'], ['leitura', 'Leitura']];
const MODELOS = [['claude-sonnet-5-5', 'Claude Sonnet 5.5 (recomendado)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (mais rápido e barato)'], ['claude-opus-5-5', 'Claude Opus 5.5 (mais preciso, mais caro)']];

export async function render(root) {
  const e = state.empresa.id, admin = state.papel === 'admin';
  try {
    [ui.cfg, ui.pode] = await Promise.all([
      q(sb.from('ia_config').select('*').eq('empresa_id', e)).then(r => r[0] || null),
      q(sb.rpc('ia_pode', { p_empresa: e })),
    ]);
  } catch (err) {
    root.innerHTML = `<div class="card"><div class="empty">${/ia_pode|ia_config/.test(err.message || '') ? 'Esta tela precisa do SQL 137.' : 'Não foi possível carregar.'}</div></div>`; return;
  }
  const abas = [['perguntar', 'Perguntar'], ['historico', 'Minhas perguntas'], ...(admin ? [['uso', 'Uso e parâmetros']] : [])];
  if (!abas.some(a => a[0] === ui.aba)) ui.aba = 'perguntar';
  root.innerHTML = `<div class="card toolbar"><div class="chips" id="ia-abas">${abas.map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
      <span class="spacer"></span><span class="small muted">Só consulta: a IA não altera nada e só vê o que você já vê nas telas.</span></div>
    <div id="ia-corpo" style="margin-top:12px"></div>`;
  $('#ia-abas', root).onclick = (ev) => { const a = ev.target.closest('[data-a]')?.dataset.a; if (a && a !== ui.aba) { ui.aba = a; render(root); } };
  const c = $('#ia-corpo', root);
  if (ui.aba === 'historico') return historico(c);
  if (ui.aba === 'uso') return uso(c, root);
  perguntar(c, root);
}

function perguntar(c, root) {
  if (!ui.pode) {
    c.innerHTML = `<div class="card"><div class="empty">${!ui.cfg?.ativo ? 'A pergunta à plataforma está desligada.' : 'O seu perfil não tem acesso à pergunta à plataforma.'}
      ${state.papel === 'admin' ? '<br><span class="small">Ligue e escolha os perfis em <b>Uso e parâmetros</b>.</span>' : '<br><span class="small">Peça ao administrador.</span>'}</div></div>`;
    return;
  }
  c.innerHTML = `<div id="ia-conv"></div>
    <div class="card" style="position:sticky;bottom:8px">
      <form id="ia-f" style="display:flex;gap:8px;align-items:flex-end">
        <textarea id="ia-p" rows="2" maxlength="1000" placeholder="Pergunte sobre faturamento, despesas, fretes, compras ou produção. Ex.: quanto pagamos de combustível por mês este ano?" style="flex:1;resize:vertical"></textarea>
        <button class="btn primary" id="ia-ok">Perguntar</button></form>
      ${ui.conversa.length ? '<div style="margin-top:6px"><button class="btn ghost small" id="ia-nova">Nova conversa</button> <span class="small muted">As duas últimas perguntas entram como contexto ("e em fevereiro?").</span></div>' : ''}
    </div>`;
  const conv = $('#ia-conv', c);
  const desenhar = () => {
    conv.innerHTML = ui.conversa.length ? ui.conversa.map((r, i) => cartao(r, i)).join('')
      : `<div class="card"><h3 style="margin:0 0 8px">Exemplos</h3><div class="chips">${SUGESTOES.map(s => `<span class="chip" data-s="${esc(s)}">${esc(s)}</span>`).join('')}</div>
         <p class="small muted" style="margin:10px 0 0">A resposta mostra o período considerado, um gráfico e a tabela com os números usados, e leva à tela de origem. Fontes: lançamentos, notas fiscais, fretes, pedidos de compra e produção.</p></div>`;
    ui.conversa.forEach((r, i) => { const cv = $(`#ia-g${i}`, conv); if (cv && r.grafico) chart(cv, configGrafico(r.tabela, r.grafico, CORES)); });
    $$('[data-s]', conv).forEach(s => s.onclick = () => { $('#ia-p', c).value = s.dataset.s; enviar(); });
    ligarCartoes(conv);
  };
  const enviar = async () => {
    const p = $('#ia-p', c).value.trim(); if (p.length < 3) return toast('Escreva a pergunta', true);
    const btn = $('#ia-ok', c); btn.disabled = true; btn.textContent = 'Pensando…';
    ui.conversa.push({ pergunta: p, carregando: true }); desenhar(); conv.lastElementChild?.scrollIntoView({ block: 'end' });
    try {
      const { data, error } = await sb.functions.invoke('perguntar', { body: { empresa_id: state.empresa.id, pergunta: p, anteriores: anteriores(ui.conversa.slice(0, -1)) } });
      let r = data;
      if (error) { let m = error.message; try { m = (await error.context.json()).erro || m; } catch { /* sem corpo */ } r = { pergunta: p, erro: m }; }
      ui.conversa[ui.conversa.length - 1] = r?.erro ? { pergunta: p, erro: r.erro } : r;
      $('#ia-p', c).value = '';
    } catch (err) { ui.conversa[ui.conversa.length - 1] = { pergunta: p, erro: err.message }; }
    btn.disabled = false; btn.textContent = 'Perguntar';
    perguntar(c, root); $('#ia-conv', c).lastElementChild?.scrollIntoView({ block: 'start' });
  };
  $('#ia-f', c).onsubmit = (ev) => { ev.preventDefault(); enviar(); };
  $('#ia-p', c).onkeydown = (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); enviar(); } };
  $('#ia-nova', c) && ($('#ia-nova', c).onclick = () => { ui.conversa = []; perguntar(c, root); });
  desenhar();
}

function cartao(r, i) {
  const t = r.tabela;
  return `<div class="card" style="margin-bottom:12px" data-i="${i}">
    <div class="small muted" style="margin-bottom:6px">Você perguntou</div><div style="font-weight:600;margin-bottom:10px">${esc(r.pergunta)}</div>
    ${r.carregando ? '<div class="loading">Consultando os dados…</div>'
      : r.erro ? `<div class="neg">${esc(r.erro)}</div>`
      : `<div class="ia-resp">${textoHtml(r.resposta)}</div>
        ${r.grafico ? `<div style="height:${t && t.linhas.length > 8 && !['mes', 'dia', 'ano'].includes(t.agrupar) ? 360 : 260}px;margin:12px 0"><canvas id="ia-g${i}"></canvas></div>` : ''}
        ${t ? `<details style="margin-top:8px"><summary class="small">Números usados (${t.linhas.length} linha(s))</summary><div class="table-wrap"><table class="ia-tab"><thead><tr><th>${esc(t.colunas[0])}</th><th class="num">${esc(t.colunas[1])}</th></tr></thead>
          <tbody>${t.linhas.map(l => `<tr><td>${esc(rotuloChave(l[0], t.agrupar))}</td><td class="num">${formatarValor(l[1], t.metrica)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">
          ${r.link ? `<a class="btn small" href="${esc(r.link)}">Abrir ${esc(r.link_rotulo || 'a tela')}</a>` : ''}
          ${t ? `<button class="btn small ghost" data-x="${i}">Excel</button>` : ''}
          <span class="spacer" style="flex:1"></span>
          ${r.consultas?.length ? `<span class="small muted" title="${esc(r.consultas.map(x => `${x.fonte} · ${x.metrica}${x.agrupar ? ' por ' + x.agrupar : ''}${x.de ? ' · ' + dateBR(x.de) : ''}${x.ate ? ' a ' + dateBR(x.ate) : ''}`).join('\n'))}">${r.consultas.length} consulta(s)</span>` : ''}
          ${r.id ? `<button class="btn small ghost ${r.avaliacao === 1 ? 'on' : ''}" data-av="1" data-id="${r.id}" title="Resposta certa">👍</button><button class="btn small ghost ${r.avaliacao === -1 ? 'on' : ''}" data-av="-1" data-id="${r.id}" title="Resposta errada">👎</button>` : ''}
        </div>`}
  </div>`;
}

function ligarCartoes(el) {
  $$('[data-x]', el).forEach(b => b.onclick = () => { const r = ui.conversa[+b.dataset.x]; exportXLSX([r.tabela.colunas, ...r.tabela.linhas.map(l => [rotuloChave(l[0], r.tabela.agrupar), +l[1]])], 'pergunta'); });
  $$('[data-av]', el).forEach(b => b.onclick = async () => {
    const av = +b.dataset.av; let com = null;
    if (av === -1) com = prompt('O que estava errado? (ajuda a melhorar as respostas)') ?? null;
    try {
      await q(sb.rpc('ia_avaliar', { p_pergunta: b.dataset.id, p_avaliacao: av, p_comentario: com }));
      const r = ui.conversa.find(x => x.id === b.dataset.id); if (r) r.avaliacao = av;
      b.parentElement.querySelectorAll('[data-av]').forEach(x => x.classList.toggle('on', x === b)); toast('Obrigado pela avaliação');
    } catch (err) { fail(err); }
  });
}

async function historico(c) {
  let L = [];
  try { L = await q(sb.from('ia_perguntas').select('*').eq('empresa_id', state.empresa.id).eq('user_id', state.user?.id).order('criado_em', { ascending: false }).limit(50)); }
  catch (err) { return fail(err); }
  c.innerHTML = L.length ? `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Quando</th><th>Pergunta</th><th>Resposta</th><th></th></tr></thead><tbody>
    ${L.map((r, i) => `<tr data-h="${i}" style="cursor:pointer"><td class="small" style="white-space:nowrap">${new Date(r.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
      <td class="wrap">${esc(r.pergunta)}</td><td class="wrap small">${esc((r.erro || r.resposta || '').slice(0, 160))}</td><td>${r.avaliacao === 1 ? '👍' : r.avaliacao === -1 ? '👎' : ''}</td></tr>`).join('')}</tbody></table></div></div>
    <p class="small muted">Clique para ver de novo a resposta com o gráfico. O histórico fica guardado por ${ui.cfg?.guardar_dias ?? 180} dias.</p>`
    : '<div class="card"><div class="empty">Você ainda não fez perguntas.</div></div>';
  $$('[data-h]', c).forEach(tr => tr.onclick = () => { ui.conversa = [L[+tr.dataset.h]]; ui.aba = 'perguntar'; render(c.closest('#ia-corpo').parentElement); });
}

async function uso(c, root) {
  const C = ui.cfg || {}, de = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  let U = null; try { U = await q(sb.rpc('ia_uso', { p_empresa: state.empresa.id, p_de: de })); } catch { U = null; }
  const sel = C.papeis || ['admin', 'diretor', 'financeiro'];
  c.innerHTML = `${U ? `<div class="kpis" style="margin-bottom:12px">
      <div class="kpi"><div class="k-label">Perguntas (30 dias)</div><div class="k-value">${U.perguntas}</div><div class="k-sub">${U.pessoas} pessoa(s) · ${U.erros} com erro</div></div>
      <div class="kpi"><div class="k-label">Avaliações</div><div class="k-value">👍 ${U.positivas} · 👎 ${U.negativas}</div><div class="k-sub">as 👎 trazem o comentário no histórico</div></div>
      <div class="kpi"><div class="k-label">Tokens</div><div class="k-value">${(U.tokens_entrada + U.tokens_saida).toLocaleString('pt-BR')}</div><div class="k-sub">${U.tokens_entrada.toLocaleString('pt-BR')} de entrada · ${U.tokens_saida.toLocaleString('pt-BR')} de saída</div></div>
      <div class="kpi"><div class="k-label">Tempo médio</div><div class="k-value">${U.ms_medio ? (U.ms_medio / 1000).toFixed(1).replace('.', ',') + ' s' : '–'}</div><div class="k-sub">por resposta</div></div></div>
    ${(U.por_pessoa || []).length ? `<div class="card" style="margin-bottom:12px"><h3 style="margin:0 0 6px">Por pessoa</h3>${U.por_pessoa.map(p => `<div class="small">${esc(p.email)} — ${p.n}</div>`).join('')}</div>` : ''}` : ''}
    <div class="card form"><h3 style="margin:0 0 10px">Parâmetros</h3>
      <label class="chk"><input type="checkbox" id="ip-on" ${C.ativo ? 'checked' : ''}> Ligar a pergunta à plataforma</label>
      <div class="grid-form" style="margin-top:10px">
        <label>Modelo da IA<select id="ip-m">${MODELOS.map(([k, t]) => `<option value="${k}" ${(C.modelo || 'claude-sonnet-5-5') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="xs">Perguntas por pessoa em 24 h<input id="ip-l" type="number" min="1" max="500" value="${C.limite_dia ?? 30}"></label>
        <label class="xs">Consultas por pergunta<input id="ip-c" type="number" min="1" max="12" value="${C.max_consultas ?? 6}"></label>
        <label class="xs">Guardar o histórico (dias)<input id="ip-g" type="number" min="7" max="730" value="${C.guardar_dias ?? 180}"></label></div>
      <div style="margin-top:10px"><b class="small">Perfis que podem perguntar</b><div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:4px">${PAPEIS.map(([k, t]) => `<label class="chk"><input type="checkbox" class="ip-p" value="${k}" ${sel.includes(k) ? 'checked' : ''}> ${t}</label>`).join('')}</div></div>
      <label style="margin-top:10px">Orientação para as respostas (opcional)<textarea id="ip-i" rows="2" maxlength="600" placeholder="Ex.: arredonde para mil reais; o ano fiscal começa em janeiro; chame os clientes pela sigla">${esc(C.instrucoes || '')}</textarea></label>
      <p class="small muted">A IA é o Claude, da Anthropic, chamado pela função "perguntar" com o segredo ANTHROPIC_API_KEY do Supabase. Vão para a IA a pergunta, o catálogo e os números agregados das consultas (sem CPF/CNPJ nem dados bancários). Cada pessoa só consulta o que já vê nas telas.</p>
      <div style="text-align:right"><button class="btn primary" id="ip-ok">Salvar</button></div></div>`;
  $('#ip-ok', c).onclick = async (ev) => {
    const row = { empresa_id: state.empresa.id, ativo: $('#ip-on', c).checked, modelo: $('#ip-m', c).value, limite_dia: Math.min(500, Math.max(1, +$('#ip-l', c).value || 30)),
      max_consultas: Math.min(12, Math.max(1, +$('#ip-c', c).value || 6)), guardar_dias: Math.min(730, Math.max(7, +$('#ip-g', c).value || 180)),
      papeis: $$('.ip-p:checked', c).map(x => x.value), instrucoes: $('#ip-i', c).value.trim() || null, atualizado_em: new Date().toISOString() };
    if (!row.papeis.length) return toast('Escolha ao menos um perfil', true);
    ev.target.disabled = true;
    try { await q(sb.from('ia_config').upsert(row)); toast('Parâmetros salvos'); render(root); } catch (err) { fail(err); ev.target.disabled = false; }
  };
}
