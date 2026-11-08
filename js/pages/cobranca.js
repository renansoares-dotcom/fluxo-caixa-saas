// Financeiro › Cobrança (FIN024) — melhoria 3.3 (SQL 126, 08/11/2026).
// Aging dos títulos (a receber e a pagar) por faixa e por cliente, régua de cobrança automática (lembrete antes,
// no dia e atraso, por e-mail e WhatsApp, com PIX copia e cola), pausas, histórico do que foi mandado e "Cobrar agora".
import { sb, state, q, fetchAll, podeEditar } from '../lib/data.js';
import { $, $$, esc, money, dateBR, today, fail, toast, modal } from '../lib/ui.js';
import { aging, diasAtraso, FAIXAS, lerBoleto } from '../lib/cobranca-calc.js';
import { brcode } from '../lib/pix.js';

export const title = 'Cobrança';
const ui = { aba: 'aging', tipo: 'E', pessoa: null };
let D = null;
const MOD = { cob_lembrete: 'Lembrete', cob_vencimento: 'Vence hoje', cob_atraso: 'Atraso' };
const CAN = { email: 'E-mail', whatsapp: 'WhatsApp', sem_contato: 'Sem contato' };
const etapaTxt = (d) => d == null ? 'Cobrar agora' : d < 0 ? `${-d} dia(s) antes` : d === 0 ? 'No vencimento' : `${d} dia(s) de atraso`;

export async function render(root) {
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try {
    const e = state.empresa.id;
    const [tit, cfg, etapas, envios, pausas, boletos] = await Promise.all([
      fetchAll(() => sb.from('v_lancamentos').select('id,data,valor,valor_sinal,tipo,favorecido_id,favorecido_nome,documento,descricao,fidc_proposta_id,plano_codigo').eq('empresa_id', e).eq('status', 'Em aberto').in('tipo', ['E', 'S']).order('data')),
      q(sb.from('cob_config').select('*').eq('empresa_id', e).maybeSingle()).catch(() => undefined),
      q(sb.from('cob_etapas').select('*').eq('empresa_id', e).order('dias')).catch(() => []),
      q(sb.from('cob_envios').select('*').eq('empresa_id', e).order('criado_em', { ascending: false }).limit(1000)).catch(() => []),
      q(sb.from('cob_pausas').select('*').eq('empresa_id', e).gte('ate', today()).order('ate')).catch(() => []),
      fetchAll(() => sb.from('portal_boletos').select('*').eq('empresa_id', e)).catch(() => [])]);
    D = { tit, cfg: cfg === undefined ? null : { ativo: false, canais: ['email', 'whatsapp'], valor_minimo: 0, excluir_cedidos: true, ...(cfg || {}) }, sql: cfg !== undefined, etapas, envios, pausas, boletos: Object.fromEntries(boletos.map(b => [b.lancamento_id, b])) };
  } catch (err) { fail(err); root.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; return; }
  tela(root);
}

function tela(root) {
  const hoje = today(), tits = D.tit.filter(t => t.tipo === ui.tipo), A = aging(tits, hoje);
  const ult = {}; D.envios.forEach(v => { if (!ult[v.lancamento_id]) ult[v.lancamento_id] = v; });
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Cobrança</h2><div class="muted small">Aging dos títulos em aberto e a régua de cobrança automática, por e-mail e WhatsApp, com PIX.</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">${D.sql && podeEditar() ? '<button class="btn" id="cb-par">Parâmetros e PIX</button>' : ''}</div></div>
    ${D.sql ? `<div class="card small" style="border-left:3px solid ${D.cfg.ativo ? 'var(--pos)' : 'var(--warn)'};margin-bottom:12px">Régua ${D.cfg.ativo ? '<b>ligada</b>: roda todo dia às 8h' : '<b>desligada</b>: nada é mandado aos clientes'} · ${D.etapas.filter(x => x.ativo).length} etapa(s) · PIX ${D.cfg.pix_chave ? 'cadastrado' : '<span class="neg">sem chave</span>'}</div>` : '<div class="card small" style="border-left:3px solid var(--warn);margin-bottom:12px">A régua começa depois do SQL 126. O aging já funciona.</div>'}
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${[['aging', 'Aging'], ['regua', 'Régua'], ['historico', 'Histórico'], ['pausas', `Pausas (${D.pausas.length})`]].map(([k, t]) => `<button class="chip${ui.aba === k ? ' on' : ''}" data-aba="${k}">${t}</button>`).join('')}</div>
    <div id="cb-corpo"></div>`;
  $$('[data-aba]', root).forEach(b => b.onclick = () => { ui.aba = b.dataset.aba; tela(root); });
  $('#cb-par', root) && ($('#cb-par', root).onclick = () => parametros(root));
  const c = $('#cb-corpo', root);
  if (ui.aba === 'aging') return abaAging(c, A, tits, ult, root);
  if (ui.aba === 'regua') return abaRegua(c, root);
  if (ui.aba === 'historico') return abaHistorico(c);
  return abaPausas(c, root);
}

function abaAging(c, A, tits, ult, root) {
  const max = Math.max(...A.faixas.map(f => f.valor), 1), cor = (k) => k === 'vencer' ? 'var(--pos)' : k === 'd15' ? '#e0a800' : k === 'd30' ? '#e07a00' : 'var(--neg)';
  const p = ui.pessoa && A.pessoas.find(x => x.id === ui.pessoa);
  c.innerHTML = `<div style="display:flex;gap:6px;margin-bottom:12px">${[['E', 'A receber'], ['S', 'A pagar']].map(([k, t]) => `<button class="chip${ui.tipo === k ? ' on' : ''}" data-tp="${k}">${t}</button>`).join('')}</div>
    <div class="kpis" style="margin-bottom:12px"><div class="kpi"><div class="k-label">Em aberto</div><div class="k-value">${money(A.total)}</div><div class="k-sub">${tits.length} título(s)</div></div>
      <div class="kpi"><div class="k-label">Vencido</div><div class="k-value ${A.vencido ? 'neg' : ''}">${money(A.vencido)}</div><div class="k-sub">${Math.round(A.pctVencido * 100)}% do aberto</div></div>
      <div class="kpi"><div class="k-label">Atraso médio</div><div class="k-value">${Math.round(A.atrasoMedio)} dias</div><div class="k-sub">ponderado pelo valor vencido</div></div>
      <div class="kpi"><div class="k-label">Mais de 90 dias</div><div class="k-value ${A.faixas[5].valor ? 'neg' : ''}">${money(A.faixas[5].valor)}</div><div class="k-sub">${Math.round(A.faixas[5].pct * 100)}% do aberto</div></div></div>
    <div class="card" style="margin-bottom:12px"><h3 style="margin:0 0 10px">Por faixa de atraso</h3>
      ${A.faixas.map(f => `<div style="display:grid;grid-template-columns:110px 1fr 130px 50px;gap:10px;align-items:center;margin:6px 0"><span class="small">${f.nome}</span>
        <div style="background:var(--surface-2);border-radius:6px;height:18px;overflow:hidden"><i style="display:block;height:100%;width:${(f.valor / max * 100).toFixed(1)}%;background:${cor(f.k)}"></i></div>
        <span class="num small">${money(f.valor)}</span><span class="num small muted">${Math.round(f.pct * 100)}%</span></div>`).join('')}</div>
    <div class="card flush"><div class="table-wrap" style="max-height:60vh"><table class="small"><thead><tr><th>${ui.tipo === 'E' ? 'Cliente' : 'Fornecedor'}</th>${FAIXAS.map(f => `<th class="num">${f.nome}</th>`).join('')}<th class="num">Total</th><th class="num">Maior atraso</th></tr></thead><tbody>
      ${A.pessoas.slice(0, 300).map(x => `<tr data-p="${x.id}" style="cursor:pointer"><td><b>${esc(x.nome)}</b> <span class="muted">${x.n}</span></td>${FAIXAS.map(f => `<td class="num ${f.k !== 'vencer' && x[f.k] ? 'neg' : ''}">${x[f.k] ? money(x[f.k]) : ''}</td>`).join('')}
        <td class="num"><b>${money(x.total)}</b></td><td class="num">${x.maior ? x.maior + ' d' : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Nada em aberto.</td></tr>'}</tbody></table></div></div>`;
  $$('[data-tp]', c).forEach(b => b.onclick = () => { ui.tipo = b.dataset.tp; ui.pessoa = null; tela(root); });
  $$('[data-p]', c).forEach(tr => tr.onclick = () => titulosDe(A.pessoas.find(x => x.id === tr.dataset.p), tits, ult, root));
  if (p) titulosDe(p, tits, ult, root);
}

function titulosDe(p, tits, ult, root) {
  const hoje = today(), l = tits.filter(t => (t.favorecido_id || 'sem') === p.id), rec = ui.tipo === 'E';
  const md = modal({ title: p.nome, wide: true, body: `<div class="table-wrap"><table class="small"><thead><tr><th>Vencimento</th><th>Documento</th><th class="num">Valor</th><th>Atraso</th>${rec ? '<th>Última cobrança</th><th></th>' : ''}</tr></thead><tbody>
    ${l.map(t => { const d = diasAtraso(t.data, hoje), u = ult[t.id]; return `<tr><td>${dateBR(t.data)}</td><td>${esc(t.documento || t.descricao || '')}${t.fidc_proposta_id ? ' <span class="badge negoc">cedido</span>' : ''}</td><td class="num">${money(Math.abs(t.valor_sinal))}</td>
      <td>${d > 0 ? `<span class="badge vencido">${d} d</span>` : `<span class="muted">em ${-d} d</span>`}</td>
      ${rec ? `<td>${u ? `${new Date(u.criado_em).toLocaleDateString('pt-BR')} · ${MOD[u.modelo] || u.modelo} · ${CAN[u.canal]}` : '<span class="muted">—</span>'}</td>
      <td style="white-space:nowrap">${D.sql && podeEditar() && !t.fidc_proposta_id ? `<button class="btn ghost small" data-co="${t.id}">Cobrar agora</button><button class="btn ghost small" data-pz="${t.id}">Pausar</button><button class="btn ghost small" data-bo="${t.id}" title="Boleto que o cliente baixa no Portal">${D.boletos[t.id] ? 'Boleto ✓' : 'Boleto'}</button>` : ''}${D.cfg?.pix_chave ? `<button class="btn ghost small" data-px="${t.id}">PIX</button>` : ''}</td>` : ''}</tr>`; }).join('')}</tbody></table></div>`,
    foot: `${rec && D.sql && podeEditar() && p.id !== 'sem' ? '<button class="btn" id="tp-pz">Pausar a cobrança do cliente</button>' : ''}<span class="spacer"></span><button class="btn" data-close>Fechar</button>` });
  $$('[data-co]', md.el).forEach(b => b.onclick = async () => { try { const n = await q(sb.rpc('cob_cobrar_agora', { p_lancamento: b.dataset.co }));
    sb.functions.invoke('email', { body: {} }).catch(() => {}); sb.functions.invoke('whatsapp', { body: {} }).catch(() => {});
    toast(n ? `Cobrança mandada (${n} mensagem(ns))` : 'O cliente não tem e-mail nem WhatsApp aceito: registrado como sem contato', !n); md.close(); render(root); } catch (err) { fail(err); } });
  $$('[data-pz]', md.el).forEach(b => b.onclick = () => { md.close(); pausar(root, { lancamento_id: b.dataset.pz }); });
  $$('[data-bo]', md.el).forEach(b => b.onclick = () => { md.close(); boleto(root, l.find(x => x.id === b.dataset.bo)); });
  $('#tp-pz', md.el) && ($('#tp-pz', md.el).onclick = () => { md.close(); pausar(root, { favorecido_id: p.id }); });
  $$('[data-px]', md.el).forEach(b => b.onclick = () => { const t = l.find(x => x.id === b.dataset.px);
    try { const code = brcode({ chave: D.cfg.pix_chave, nome: D.cfg.pix_nome || state.empresa.nome, cidade: D.cfg.pix_cidade, valor: Math.abs(t.valor_sinal), txid: t.documento || 'T' + t.id.replace(/-/g, '').slice(0, 20) });
      navigator.clipboard?.writeText(code); toast('PIX copia e cola copiado: cole na mensagem ao cliente'); } catch (err) { fail(err); } });
}

// boleto do título para o Portal (melhoria 3.5, SQL 127): PDF e/ou linha digitável, com os dígitos conferidos
function boleto(root, t) {
  const b = D.boletos[t.id] || {};
  const m = modal({ title: `Boleto — ${esc(t.documento || t.descricao || '')}`, body: `<p class="small muted">O cliente baixa o boleto na aba Títulos do Portal enquanto o título estiver em aberto.</p>
    <label>Linha digitável<input id="bo-l" value="${esc(b.linha_digitavel || '')}" placeholder="00190.00009 01234.567890 12345.678901 2 12340000010000" style="font-family:monospace"></label><div class="small" id="bo-i" style="min-height:18px"></div>
    <label style="margin-top:8px">Vencimento do boleto<input type="date" id="bo-v" value="${b.vencimento || t.data}"></label>
    <label style="margin-top:8px">PDF do boleto ${b.arquivo_path ? '<span class="muted">(já anexado; escolha outro para trocar)</span>' : ''}<input type="file" id="bo-f" accept="application/pdf,image/png,image/jpeg"></label>`,
    foot: `${b.id ? '<button class="btn danger" id="bo-x">Retirar do Portal</button>' : ''}<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="bo-ok">Salvar</button>` });
  const conferir = () => { const v = $('#bo-l', m.el).value.trim(), r = v ? lerBoleto(v) : null, i = $('#bo-i', m.el);
    if (!r) { i.textContent = ''; return true; }
    if (!r.ok) { i.innerHTML = `<span class="neg">${esc(r.erro)}</span>`; return false; }
    const dif = r.valor && Math.abs(r.valor - Math.abs(t.valor_sinal)) > 0.005;
    i.innerHTML = `<span class="pos">Dígitos conferidos</span>${r.vencimento ? ` · vence ${dateBR(r.vencimento)}` : ''}${r.valor ? ` · ${money(r.valor)}` : ''}${dif ? ` <span class="neg">(o título é de ${money(Math.abs(t.valor_sinal))})</span>` : ''}`;
    if (r.vencimento && !b.id) $('#bo-v', m.el).value = r.vencimento; return true; };
  $('#bo-l', m.el).oninput = conferir; conferir();
  $('#bo-x', m.el) && ($('#bo-x', m.el).onclick = async () => { if (!confirm('Retirar o boleto do Portal?')) return;
    try { await q(sb.from('portal_boletos').delete().eq('id', b.id)); if (b.arquivo_path) await sb.storage.from('portal').remove([b.arquivo_path]); toast('Boleto retirado'); m.close(); render(root); } catch (e) { fail(e); } });
  $('#bo-ok', m.el).onclick = async (ev) => {
    const linha = $('#bo-l', m.el).value.trim() || null, f = $('#bo-f', m.el).files[0];
    if (linha && !conferir()) return toast('Confira a linha digitável', true);
    if (!linha && !f && !b.arquivo_path) return toast('Informe a linha digitável ou anexe o PDF', true);
    ev.target.disabled = true;
    try {
      let caminho = b.arquivo_path || null;
      if (f) { if (f.size > 10 * 1048576) throw new Error('Arquivo acima de 10 MB');
        caminho = `${state.empresa.id}/boletos/${t.id}/${Date.now()}-${f.name.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-60)}`;
        const { error } = await sb.storage.from('portal').upload(caminho, f, { contentType: f.type || 'application/pdf' }); if (error) throw error;
        if (b.arquivo_path) sb.storage.from('portal').remove([b.arquivo_path]).catch(() => {}); }
      await q(sb.from('portal_boletos').upsert({ empresa_id: state.empresa.id, lancamento_id: t.id, linha_digitavel: linha, arquivo_path: caminho, vencimento: $('#bo-v', m.el).value || null, atualizado_em: new Date().toISOString() }, { onConflict: 'lancamento_id' }));
      toast('Boleto disponível no Portal'); m.close(); render(root);
    } catch (e) { fail(e); ev.target.disabled = false; }
  };
}

function pausar(root, alvo) {
  const m = modal({ title: alvo.favorecido_id ? 'Pausar a cobrança do cliente' : 'Pausar a cobrança do título', body: `<label>Até<input type="date" id="pz-a" value="${new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10)}"></label>
    <label style="margin-top:8px">Motivo<input id="pz-m" placeholder="ex.: promessa de pagamento dia 20, negociação em andamento"></label>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="pz-ok">Pausar</button>' });
  $('#pz-ok', m.el).onclick = async () => {
    const ate = $('#pz-a', m.el).value, mot = $('#pz-m', m.el).value.trim();
    if (!ate || ate < today()) return toast('Escolha a data', true); if (mot.length < 3) return toast('Informe o motivo', true);
    try { await q(sb.from('cob_pausas').insert({ empresa_id: state.empresa.id, ...alvo, ate, motivo: mot })); m.close(); toast('Cobrança pausada'); render(root); } catch (err) { fail(err); }
  };
}

function abaRegua(c, root) {
  if (!D.sql) { c.innerHTML = '<div class="card"><div class="empty">Execute o SQL 126 para montar a régua.</div></div>'; return; }
  const ed = podeEditar();
  c.innerHTML = `<div class="card flush"><div style="padding:14px 16px 0;display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">Etapas da régua</h3>
      ${ed ? `<div style="display:flex;gap:6px">${D.etapas.length ? '' : '<button class="btn small" id="rg-pad">Usar a régua padrão</button>'}<button class="btn small primary" id="rg-nova">Nova etapa</button></div>` : ''}</div>
    <div class="table-wrap"><table><thead><tr><th>Quando</th><th>Mensagem</th><th>Situação</th><th class="num">Mandadas (30 dias)</th>${ed ? '<th></th>' : ''}</tr></thead><tbody>
    ${D.etapas.map(x => { const n = D.envios.filter(v => v.etapa_dias === x.dias && Date.now() - Date.parse(v.criado_em) < 30 * 864e5 && v.canal !== 'sem_contato').length;
      return `<tr><td><b>${etapaTxt(x.dias)}</b></td><td>${MOD[x.modelo]}</td><td>${x.ativo ? '<span class="badge pago">ligada</span>' : '<span class="badge">desligada</span>'}</td><td class="num">${n}</td>
      ${ed ? `<td style="white-space:nowrap"><button class="btn ghost small" data-tg="${x.id}">${x.ativo ? 'Desligar' : 'Ligar'}</button><button class="btn ghost small" data-rm="${x.id}">Excluir</button></td>` : ''}</tr>`; }).join('') || `<tr><td colspan="5" class="empty">Nenhuma etapa. ${ed ? 'Use a régua padrão: 3 dias antes, no dia, 3, 10 e 30 dias depois.' : ''}</td></tr>`}</tbody></table></div></div>
    <p class="small muted">A régua roda todo dia às 8h para os títulos a receber em aberto com cliente, a partir do valor mínimo. Não cobra título cedido ao FIDC (parâmetro), com prorrogação pedida no Portal ou pausado. Os textos ficam em Cadastros › E-mails da Plataforma e › WhatsApp da Plataforma.</p>`;
  $('#rg-pad', c) && ($('#rg-pad', c).onclick = async () => { try { await q(sb.rpc('cob_etapas_padrao', { p_empresa: state.empresa.id })); toast('Régua padrão criada'); render(root); } catch (e) { fail(e); } });
  $('#rg-nova', c) && ($('#rg-nova', c).onclick = () => {
    const m = modal({ title: 'Nova etapa', body: `<label>Quando<select id="ne-q"><option value="-1">Antes do vencimento</option><option value="0">No vencimento</option><option value="1" selected>Depois do vencimento</option></select></label>
      <label style="margin-top:8px">Dias<input type="number" id="ne-d" min="1" max="180" value="5"></label>`, foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="ne-ok">Incluir</button>' });
    $('#ne-q', m.el).onchange = (e) => { $('#ne-d', m.el).disabled = e.target.value === '0'; };
    $('#ne-ok', m.el).onclick = async () => { const s = +$('#ne-q', m.el).value, d = s === 0 ? 0 : s * Math.abs(+$('#ne-d', m.el).value || 0);
      if (s !== 0 && !d) return toast('Informe os dias', true);
      try { await q(sb.from('cob_etapas').insert({ empresa_id: state.empresa.id, dias: d, modelo: d < 0 ? 'cob_lembrete' : d === 0 ? 'cob_vencimento' : 'cob_atraso' })); m.close(); toast('Etapa incluída'); render(root); } catch (e) { fail(e); } };
  });
  $$('[data-tg]', c).forEach(b => b.onclick = async () => { const x = D.etapas.find(y => y.id === b.dataset.tg); try { await q(sb.from('cob_etapas').update({ ativo: !x.ativo }).eq('id', x.id)); render(root); } catch (e) { fail(e); } });
  $$('[data-rm]', c).forEach(b => b.onclick = async () => { if (!confirm('Excluir esta etapa?')) return; try { await q(sb.from('cob_etapas').delete().eq('id', b.dataset.rm)); render(root); } catch (e) { fail(e); } });
}

function abaHistorico(c) {
  const T = Object.fromEntries(D.tit.map(t => [t.id, t]));
  c.innerHTML = `<div class="card flush"><div class="table-wrap" style="max-height:65vh"><table class="small"><thead><tr><th>Quando</th><th>Cliente · título</th><th>Etapa</th><th>Mensagem</th><th>Canal</th><th>Para</th></tr></thead><tbody>
    ${D.envios.slice(0, 500).map(v => { const t = T[v.lancamento_id]; return `<tr><td>${new Date(v.criado_em).toLocaleString('pt-BR').slice(0, 17)}</td><td>${esc(t?.favorecido_nome || '')} <span class="muted">${esc(t?.documento || (t ? '' : 'título já baixado'))}</span></td>
      <td>${etapaTxt(v.etapa_dias)}${v.manual && v.criado_por ? ` <span class="muted">por ${esc(v.criado_por.split('@')[0])}</span>` : ''}</td><td>${MOD[v.modelo] || v.modelo}</td>
      <td>${v.canal === 'sem_contato' ? '<span class="badge vencido">sem contato</span>' : CAN[v.canal]}</td><td>${esc(v.para || '')}</td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">Nada mandado ainda.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">"Sem contato": o cliente não tem e-mail no cadastro nem acesso ao Portal. Cadastre o e-mail em Beneficiários.</p>`;
}

function abaPausas(c, root) {
  const F = Object.fromEntries(D.tit.map(t => [t.favorecido_id, t.favorecido_nome])), T = Object.fromEntries(D.tit.map(t => [t.id, t]));
  c.innerHTML = `<div class="card flush"><div class="table-wrap"><table class="small"><thead><tr><th>Cliente ou título</th><th>Até</th><th>Motivo</th><th>Por</th>${podeEditar() ? '<th></th>' : ''}</tr></thead><tbody>
    ${D.pausas.map(p => `<tr><td>${p.favorecido_id ? `<b>${esc(F[p.favorecido_id] || 'Cliente')}</b> (todos os títulos)` : `${esc(T[p.lancamento_id]?.favorecido_nome || '')} · ${esc(T[p.lancamento_id]?.documento || 'título')}`}</td>
      <td>${dateBR(p.ate)}</td><td>${esc(p.motivo)}</td><td class="muted">${esc((p.criado_por || '').split('@')[0])}</td>${podeEditar() ? `<td><button class="btn ghost small" data-ex="${p.id}">Retomar</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="5" class="empty">Nenhuma pausa ativa. Pause pelo Aging (clique no cliente).</td></tr>'}</tbody></table></div></div>`;
  $$('[data-ex]', c).forEach(b => b.onclick = async () => { try { await q(sb.from('cob_pausas').delete().eq('id', b.dataset.ex)); toast('Cobrança retomada'); render(root); } catch (e) { fail(e); } });
}

function parametros(root) {
  const c = D.cfg;
  const m = modal({ title: 'Parâmetros da cobrança e PIX', body: `<label class="chk"><input type="checkbox" id="cp-on" ${c.ativo ? 'checked' : ''}> Ligar a régua (manda as mensagens aos clientes todo dia às 8h)</label>
    <div class="grid-form" style="margin-top:8px">
      <label>Chave PIX da empresa<input id="cp-ch" value="${esc(c.pix_chave || '')}" placeholder="CNPJ, e-mail, telefone ou chave aleatória"></label>
      <label>Nome do recebedor (como no banco)<input id="cp-no" value="${esc(c.pix_nome || state.empresa.nome || '')}"></label>
      <label>Cidade do recebedor<input id="cp-ci" value="${esc(c.pix_cidade || '')}"></label>
      <label>Cobrar a partir de (R$)<input type="number" id="cp-vm" min="0" step="10" value="${c.valor_minimo || 0}"></label>
      <label>Cópia interna de cada cobrança (e-mail, opcional)<input id="cp-cp" value="${esc(c.copia_email || '')}"></label></div>
    <div class="small" style="margin:10px 0 4px">Canais:</div>
    <label class="chk"><input type="checkbox" class="cp-c" value="email" ${c.canais.includes('email') ? 'checked' : ''}> E-mail (do cadastro do cliente e dos acessos do Portal)</label>
    <label class="chk"><input type="checkbox" class="cp-c" value="whatsapp" ${c.canais.includes('whatsapp') ? 'checked' : ''}> WhatsApp (de quem aceitou no Portal)</label>
    <label class="chk" style="margin-top:6px"><input type="checkbox" id="cp-ced" ${c.excluir_cedidos ? 'checked' : ''}> Não cobrar título cedido ao FIDC (o fundo cobra)</label>
    <p class="small muted">O PIX vai como "copia e cola" no e-mail e no WhatsApp, com o valor e o número do título. O cliente também gera o QR no Portal. O pagamento entra pela conciliação bancária.</p>`,
    foot: '<button class="btn" data-close>Cancelar</button><button class="btn primary" id="cp-ok">Salvar</button>' });
  $('#cp-ok', m.el).onclick = async () => {
    const reg = { empresa_id: state.empresa.id, ativo: $('#cp-on', m.el).checked, pix_chave: $('#cp-ch', m.el).value.trim() || null, pix_nome: $('#cp-no', m.el).value.trim() || null, pix_cidade: $('#cp-ci', m.el).value.trim() || null,
      valor_minimo: +$('#cp-vm', m.el).value || 0, copia_email: $('#cp-cp', m.el).value.trim() || null, canais: $$('.cp-c:checked', m.el).map(x => x.value), excluir_cedidos: $('#cp-ced', m.el).checked, atualizado_em: new Date().toISOString() };
    if (reg.ativo && !reg.canais.length) return toast('Escolha ao menos um canal', true);
    if (reg.ativo && !D.etapas.some(x => x.ativo)) return toast('Monte a régua (aba Régua) antes de ligar', true);
    if (reg.pix_chave && (!reg.pix_cidade)) return toast('Informe a cidade do recebedor do PIX', true);
    try { await q(sb.from('cob_config').upsert(reg)); m.close(); toast(reg.ativo ? 'Régua ligada' : 'Parâmetros salvos'); render(root); } catch (e) { fail(e); }
  };
}
