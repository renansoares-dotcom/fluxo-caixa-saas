// Crédito / FIDC › Carteira cedida (SQL 073): os títulos cedidos aos fundos e a liquidação de cada um,
// conferida pelo relatório de títulos pagos que o fundo envia. Controle da coobrigação: o que ainda pode voltar como recompra.
import { sb, state, q, fetchAll, podeEditar } from '../lib/data.js';
import { $, esc, money, money0, dateBR, toast, fail, modal, today, exportXLSX, erroTela } from '../lib/ui.js';
import { carregarPdfjs } from '../lib/pdfjs.js';
import { textoPdfDoc, textoHtm } from '../lib/bordero.js';
import { LEITORES, casar, carteira, SITUACOES, TIPOS, TOLERANCIA_DU } from '../lib/fidc-liquidacoes.js';

export const title = 'Carteira cedida';
const ui = { fundo: '', sit: 'risco', busca: '', aba: 'titulos' };
let B = null;
const SIT_CLS = { a_vencer: '', aguardando: 'aberto', atrasado: 'vencido', sem_relatorio: '', liquidado: 'pago', recomprado: 'aberto' };

async function carregar() {
  const e = state.empresa.id;
  const [tit, liq] = await Promise.all([
    fetchAll(() => sb.from('fidc_titulos').select('id,fundo,bordero,data_operacao,titulo,vencimento,valor,sacado,cnpj_sacado').eq('empresa_id', e).order('id')),
    fetchAll(() => sb.from('fidc_liquidacoes').select('*').eq('empresa_id', e).order('id')).catch(() => null),
  ]);
  B = { tit, liq: liq || [], semTabela: liq === null, hoje: today() };
  B.cart = carteira(B.tit, B.liq, B.hoje);
  return B;
}

/** alertas para o Decision Center: títulos vencidos sem liquidação informada pelo fundo */
export async function alertasDecisao() {
  const b = await carregar(); if (b.semTabela) return [];
  const atr = b.cart.itens.filter(i => i.sit === 'atrasado');
  return atr.length ? [{ n: atr.length, valor: atr.reduce((s, i) => s + +i.valor, 0), fundos: [...new Set(atr.map(i => i.fundo))], maiores: atr.sort((a, b) => b.valor - a.valor).slice(0, 3) }] : [];
}

export async function render(root) {
  root.innerHTML = `<div class="loading">Carregando…</div>`;
  try { await carregar(); } catch (err) { console.error(err); root.innerHTML = erroTela('a carteira cedida'); return; }
  pintar(root);
}

function pintar(root) {
  const C = B.cart, T = C.total, fundos = [...new Set(B.tit.map(t => t.fundo))].sort();
  root.innerHTML = `
    ${B.semTabela ? '<div class="card"><span class="badge vencido">SQL 073 pendente</span> A tabela de liquidações ainda não foi criada no banco: a tela mostra os títulos, mas nenhum aparece como liquidado.</div>' : ''}
    <div class="kpis">
      <div class="kpi"><div class="k-label">Coobrigação (ainda pode voltar)</div><div class="k-value">${money0(T.coobrigacao)}</div><div class="k-sub">a vencer + vencidos sem liquidação informada</div></div>
      <div class="kpi"><div class="k-label">A vencer</div><div class="k-value">${money0(T.a_vencer)}</div><div class="k-sub">${T.n_a_vencer} título(s)</div></div>
      <div class="kpi"><div class="k-label">Vencidos, aguardando o fundo</div><div class="k-value">${money0(T.aguardando + T.sem_relatorio)}</div><div class="k-sub">${T.n_aguardando} depois do último relatório · ${T.n_sem_relatorio} de fundo sem relatório</div></div>
      <div class="kpi"><div class="k-label">Vencidos sem liquidação</div><div class="k-value ${T.atrasado ? 'neg' : ''}">${money0(T.atrasado)}</div><div class="k-sub">${T.n_atrasado} título(s) · risco de recompra</div></div>
      <div class="kpi"><div class="k-label">Liquidados · recomprados</div><div class="k-value">${money0(T.liquidado)}</div><div class="k-sub">${T.n_liquidado} liquidados · ${T.n_recomprado} recomprados (${money0(T.recomprado)})</div></div>
    </div>
    <div class="card flush"><div class="table-wrap"><table><thead><tr><th>Fundo</th><th class="num">A vencer</th><th class="num">Vencidos aguardando o fundo</th><th class="num">Vencidos sem liquidação</th><th class="num">Coobrigação</th><th class="num">Liquidados</th><th class="num">Recomprados</th><th>Último relatório</th></tr></thead><tbody>
      ${C.fundos.map(f => { const u = f.cobertura;
        return `<tr class="clickable" data-f="${esc(f.fundo)}"><td><strong>${esc(f.fundo)}</strong></td><td class="num">${money(f.a_vencer)}</td><td class="num">${money(f.aguardando + f.sem_relatorio)}</td><td class="num ${f.atrasado ? 'neg' : ''}">${money(f.atrasado)}${f.n_atrasado ? `<div class="small muted">${f.n_atrasado} título(s)</div>` : ''}</td><td class="num"><strong>${money(f.coobrigacao)}</strong></td><td class="num">${money(f.liquidado)}</td><td class="num">${money(f.recomprado)}</td><td class="small">${u ? 'pagos até ' + dateBR(u) : '<span class="badge vencido">nenhum importado</span>'}</td></tr>`; }).join('')}
    </tbody></table></div></div>
    <div class="card"><div class="toolbar" style="margin-bottom:0">
      <div class="chips" id="cc-abas">${[['titulos', 'Títulos'], ['fora', 'Pagos fora da base']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
      <label>Fundo<select id="cc-fundo"><option value="">Todos</option>${fundos.map(f => `<option ${ui.fundo === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></label>
      ${ui.aba === 'titulos' ? `<label>Situação<select id="cc-sit">${[['risco', 'Vencidos sem liquidação + aguardando'], ['coob', 'Toda a coobrigação'], ...Object.entries(SITUACOES), ['', 'Todas']].map(([k, t]) => `<option value="${k}" ${ui.sit === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>` : ''}
      <label class="grow">Buscar<input id="cc-busca" value="${esc(ui.busca)}" placeholder="título, cliente, borderô"></label>
      <span class="spacer"></span><button class="btn" id="cc-xls">Excel</button>${podeEditar() && !B.semTabela ? '<button class="btn primary" id="cc-imp">Importar relatório de pagos</button>' : ''}
    </div></div>
    <div id="cc-lista"></div>`;
  root.querySelector('tbody').onclick = (e) => { const f = e.target.closest('tr[data-f]')?.dataset.f; if (f) { ui.fundo = f; ui.sit = 'risco'; pintar(root); } };
  $('#cc-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; pintar(root); } };
  $('#cc-fundo', root).onchange = (e) => { ui.fundo = e.target.value; lista(root); };
  $('#cc-sit', root) && ($('#cc-sit', root).onchange = (e) => { ui.sit = e.target.value; lista(root); });
  let tm; $('#cc-busca', root).oninput = (e) => { clearTimeout(tm); tm = setTimeout(() => { ui.busca = e.target.value; lista(root); }, 250); };
  $('#cc-xls', root).onclick = () => { const t = $('#cc-lista table', root); if (t) exportXLSX(t, `carteira_cedida_${ui.aba}_${B.hoje}`); };
  $('#cc-imp', root) && ($('#cc-imp', root).onclick = () => importar(root));
  lista(root);
}

function lista(root) {
  const c = $('#cc-lista', root), b = ui.busca.trim().toLowerCase();
  if (ui.aba === 'fora') {
    const L = B.liq.filter(l => !l.fidc_titulo_id && (!ui.fundo || l.fundo === ui.fundo) && (!b || `${l.titulo} ${l.sacado} ${l.bordero}`.toLowerCase().includes(b))).sort((x, y) => y.quitacao.localeCompare(x.quitacao));
    c.innerHTML = `<p class="small muted">Títulos que o fundo informou como pagos, mas cujo borderô não está na base FIDC da plataforma (borderôs de 2025, cheques e notas de crédito). Ficam só para consulta.</p>
      <div class="card flush"><div class="table-wrap" style="max-height:60vh"><table><thead><tr><th>Fundo</th><th>Título</th><th>Borderô</th><th>Cliente</th><th>Vencimento</th><th>Pago em</th><th class="num">Face</th><th class="num">Pago</th><th>Tipo</th></tr></thead><tbody>
      ${L.slice(0, 1500).map(l => `<tr><td>${esc(l.fundo)}</td><td>${esc(l.titulo)}</td><td>${esc(l.bordero)}</td><td class="wrap">${esc(l.sacado || '')}</td><td>${dateBR(l.vencimento)}</td><td>${dateBR(l.quitacao)}</td><td class="num">${money(l.valor_face)}</td><td class="num">${money(l.valor_pago)}</td><td>${TIPOS[l.tipo] || l.tipo}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Nenhum.</td></tr>'}
      </tbody></table></div></div>`;
    return;
  }
  const filtro = ui.sit === 'risco' ? (i) => ['atrasado', 'aguardando', 'sem_relatorio'].includes(i.sit) : ui.sit === 'coob' ? (i) => ['a_vencer', 'aguardando', 'atrasado', 'sem_relatorio'].includes(i.sit) : ui.sit ? (i) => i.sit === ui.sit : () => true;
  const L = B.cart.itens.filter(i => filtro(i) && (!ui.fundo || i.fundo === ui.fundo) && (!b || `${i.titulo} ${i.sacado} ${i.bordero}`.toLowerCase().includes(b)))
    .sort((x, y) => (y.sit === 'atrasado') - (x.sit === 'atrasado') || x.vencimento.localeCompare(y.vencimento));
  const tot = L.reduce((s, i) => s + +i.valor, 0);
  c.innerHTML = `<p class="small muted">${L.length} título(s) · ${money(tot)}${L.length > 1500 ? ' · mostrando os 1.500 primeiros (use os filtros)' : ''}. Vencido sem liquidação = o relatório do fundo já vai ${TOLERANCIA_DU} dias úteis além do vencimento e não trouxe o pagamento: confira com o fundo e com o cliente antes que vire recompra.</p>
    <div class="card flush"><div class="table-wrap" style="max-height:60vh"><table><thead><tr><th>Fundo</th><th>Borderô</th><th>Título</th><th>Cliente</th><th>Cedido em</th><th>Vencimento</th><th class="num">Valor</th><th>Situação</th><th>Liquidação</th></tr></thead><tbody>
    ${L.slice(0, 1500).map(i => `<tr><td>${esc(i.fundo)}</td><td>${esc(i.bordero)}</td><td>${esc(i.titulo)}</td><td class="wrap">${esc(i.sacado || '')}</td><td>${dateBR(i.data_operacao)}</td><td>${dateBR(i.vencimento)}</td><td class="num">${money(i.valor)}</td>
      <td><span class="badge ${SIT_CLS[i.sit]}">${SITUACOES[i.sit]}</span>${i.sit === 'atrasado' ? `<div class="small muted">${i.atraso} dia(s) úteis</div>` : ''}</td>
      <td class="small">${i.liq ? `${dateBR(i.liq.quitacao)} · ${money(i.liq.valor_pago)}${i.liq.tipo !== 'normal' ? ' · ' + (TIPOS[i.liq.tipo] || i.liq.tipo) : ''}` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">Nenhum título nesta situação.</td></tr>'}
    </tbody></table></div></div>`;
}

// ---------------------------------------------------------------- importação do relatório de pagos
async function lerArquivo(file) {
  const buf = await file.arrayBuffer();
  if (/\.pdf$/i.test(file.name) || String.fromCharCode(...new Uint8Array(buf.slice(0, 4))) === '%PDF') {
    const lib = await carregarPdfjs(); return textoPdfDoc(await lib.getDocument({ data: new Uint8Array(buf) }).promise);
  }
  return textoHtm(new TextDecoder('windows-1252').decode(buf));
}

function importar(root) {
  const fundos = [...new Set(B.tit.map(t => t.fundo))].sort();
  let prev = null;
  const m = modal({ title: 'Importar relatório de títulos pagos', wide: true, body: `
    <div class="toolbar"><label>Fundo<select id="li-fundo">${fundos.map(f => `<option ${f === (ui.fundo || 'Negocial') ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></label>
      <label class="grow">Arquivo do fundo<input type="file" id="li-arq" accept=".pdf,.htm,.html"></label></div>
    <p class="small muted" id="li-leitor"></p><div id="li-res"></div>`,
    foot: '<button class="btn" data-close>Fechar</button><button class="btn primary" id="li-ok" disabled>Importar</button>' });
  const leitor = () => { const f = $('#li-fundo', m.el).value; $('#li-leitor', m.el).innerHTML = LEITORES[f] ? `Formato lido: ${esc(LEITORES[f].nome)}. Pode ser o ano inteiro: o que já foi importado é atualizado, sem duplicar.` : '<span class="badge vencido">Ainda não há leitor para o relatório deste fundo.</span> Envie um exemplo do relatório para incluirmos.'; };
  leitor(); $('#li-fundo', m.el).onchange = () => { leitor(); prev = null; $('#li-res', m.el).innerHTML = ''; $('#li-ok', m.el).disabled = true; };
  $('#li-arq', m.el).onchange = async (e) => {
    const file = e.target.files[0], fundo = $('#li-fundo', m.el).value, L = LEITORES[fundo]; if (!file || !L) return;
    $('#li-res', m.el).innerHTML = '<div class="loading">Lendo o relatório…</div>';
    try {
      const txt = await lerArquivo(file);
      if (!L.reconhece(txt)) throw new Error(`O arquivo não parece o relatório de pagos da ${fundo}.`);
      const linhas = L.ler(txt); if (!linhas.length) throw new Error('Nenhum título encontrado no arquivo.');
      const cs = casar(linhas, B.tit.filter(t => t.fundo === fundo));
      const ja = new Set(B.liq.filter(l => l.fundo === fundo).map(l => `${l.titulo}|${l.bordero}`));
      const novos = cs.linhas.filter(l => !ja.has(`${l.titulo}|${l.bordero}`));
      const soma = (a, k) => a.reduce((s, x) => s + x[k], 0);
      const por = (t) => cs.linhas.filter(l => l.tipo === t);
      const quit = cs.linhas.map(l => l.quitacao).sort();
      prev = { fundo, arquivo: file.name, linhas: cs.linhas };
      $('#li-res', m.el).innerHTML = `<div class="kpis">
          <div class="kpi"><div class="k-label">Títulos pagos no arquivo</div><div class="k-value">${cs.linhas.length}</div><div class="k-sub">${dateBR(quit[0])} a ${dateBR(quit.at(-1))} · pago ${money(soma(cs.linhas, 'valor_pago'))}</div></div>
          <div class="kpi"><div class="k-label">Pelo cliente</div><div class="k-value">${money0(soma(por('normal'), 'valor_face') + soma(por('deposito_sacado'), 'valor_face'))}</div><div class="k-sub">${por('normal').length} normais · ${por('deposito_sacado').length} depósitos</div></div>
          <div class="kpi"><div class="k-label">Recomprados</div><div class="k-value">${money0(soma(por('recompra'), 'valor_face'))}</div><div class="k-sub">${por('recompra').length} título(s)</div></div>
          <div class="kpi"><div class="k-label">Ligados à base FIDC</div><div class="k-value">${cs.linhas.length - cs.semTitulo.length}</div><div class="k-sub">${cs.semTitulo.length} fora da base (borderôs antigos, cheques)</div></div>
          <div class="kpi"><div class="k-label">Novos nesta importação</div><div class="k-value">${novos.length}</div><div class="k-sub">${cs.linhas.length - novos.length} já importados (atualizados)</div></div></div>
        ${cs.divergentes.length ? `<p class="small"><span class="badge aberto">${cs.divergentes.length} com valor diferente</span> ${cs.divergentes.slice(0, 8).map(l => `${esc(l.titulo)} (fundo ${money(l.valor_face)}; ${esc(l.aviso)})`).join(' · ')}</p>` : ''}
        <p class="small muted">Nada muda nos lançamentos: a importação só registra a liquidação de cada título cedido.</p>`;
      $('#li-ok', m.el).disabled = false;
    } catch (err) { $('#li-res', m.el).innerHTML = `<div class="empty">${esc(err.message || err)}</div>`; }
  };
  $('#li-ok', m.el).onclick = async () => {
    if (!prev) return; const bt = $('#li-ok', m.el); bt.disabled = true; bt.textContent = 'Importando…';
    try {
      const rows = prev.linhas.map(({ aviso, ...l }) => ({ ...l, empresa_id: state.empresa.id, fundo: prev.fundo, arquivo: prev.arquivo, importado_em: new Date().toISOString() }));
      const unicos = [...new Map(rows.map(r => [`${r.titulo}|${r.bordero}`, r])).values()];   // a mesma linha duas vezes no arquivo: fica a última
      for (let i = 0; i < unicos.length; i += 500) await q(sb.from('fidc_liquidacoes').upsert(unicos.slice(i, i + 500), { onConflict: 'empresa_id,fundo,titulo,bordero' }));
      toast(`${unicos.length} liquidação(ões) da ${prev.fundo} registradas`); m.close(); render(root);
    } catch (err) { fail(err); bt.disabled = false; bt.textContent = 'Importar'; }
  };
}
