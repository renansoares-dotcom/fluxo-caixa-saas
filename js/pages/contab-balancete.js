// Contabilidade › Balancete: balancetes oficiais importados da contabilidade (PDF) e saldo de abertura.
// A importação lê o PDF no navegador, confere tudo e só grava se fechar (o banco confere de novo).
import { sb, state, q, fetchAll, podeEditar } from '../lib/data.js';
import { $, esc, money, dateBR, toast, fail, loading, modal, exportXLSX, debounce } from '../lib/ui.js';

export const title = 'Balancete';

const ui = { sel: null, nivel: 0, comSaldo: true, busca: '', fechadas: new Set() };
let dados = null;

const dc = (v) => (Math.abs(+v) < 0.005 ? '0,00' : money(Math.abs(+v)) + (+v > 0 ? 'D' : 'C'));
const so = (s) => String(s || '').replace(/\D/g, '');

export async function render(root) {
  root.innerHTML = `
    <div class="toolbar">
      <label>Balancete<select id="bsel"></select></label>
      <label>Nível<select id="niv"><option value="0">Todos</option>${[1, 2, 3, 4, 5].map(n => `<option value="${n}">Até ${n}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" id="csal" ${ui.comSaldo ? 'checked' : ''}> Só com saldo ou movimento</label>
      <label>Buscar<input id="bus" placeholder="conta, código ou descrição" value="${esc(ui.busca)}"></label>
      <span class="spacer"></span>
      ${podeEditar() ? '<button class="btn primary" id="imp">Importar balancete (PDF)</button>' : ''}
      <button class="btn" id="exp">Exportar Excel</button>
    </div>
    <div id="info" class="muted small" style="margin-bottom:8px"></div>
    <div id="pend"></div>
    <div class="kpis" id="kp" style="margin-bottom:12px"></div>
    <div class="card flush"><div class="table-wrap" id="tbl"></div></div>`;
  $('#niv', root).value = String(ui.nivel);
  $('#niv', root).onchange = (e) => { ui.nivel = +e.target.value; pintar(root); };
  $('#csal', root).onchange = (e) => { ui.comSaldo = e.target.checked; pintar(root); };
  $('#bus', root).oninput = debounce((e) => { ui.busca = e.target.value.trim(); pintar(root); }, 250);
  $('#bsel', root).onchange = (e) => { ui.sel = e.target.value; carregarItens(root); };
  $('#exp', root).onclick = () => exportXLSX($('#tbl table', root), `balancete_${(ui.sel || '').replace(/[^\w-]/g, '')}`);
  if ($('#imp', root)) $('#imp', root).onclick = () => importar(root);
  await carregar(root);
}

async function carregar(root) {
  const tbl = $('#tbl', root); loading(tbl);
  try {
    const emp = state.empresa.id;
    const [contas, bals, aberturas] = await Promise.all([
      fetchAll(() => sb.from('contab_contas').select('id, codigo, classificacao, descricao, nivel, tipo, natureza, pai_id').eq('empresa_id', emp).order('classificacao')),
      q(sb.from('contab_balancetes').select('id, data_ini, data_fim, arquivo_nome, importado_email, importado_em, resumo').eq('empresa_id', emp).order('data_fim', { ascending: false })),
      fetchAll(() => sb.from('contab_saldos_abertura').select('data, conta_id, saldo, balancete_id').eq('empresa_id', emp)),
    ]);
    dados = { contas, bals, aberturas, itens: null };
    const datasAb = [...new Set(aberturas.map(a => a.data))].sort().reverse();
    // balancete feito pela plataforma: um por mês, a partir do mês seguinte à abertura
    const meses = [];
    if (datasAb.length) {
      const fim = new Date().toISOString().slice(0, 7);
      for (let d = new Date(datasAb[datasAb.length - 1] + 'T12:00:00'); ; ) {
        d.setDate(1); d.setMonth(d.getMonth() + 1); const m = d.toISOString().slice(0, 7); if (m > fim) break; meses.push(m);
      }
    }
    const opts = [...meses.reverse().map(m => [`g:${m}`, `${MESN[+m.slice(5) - 1]}/${m.slice(0, 4)} (plataforma)`]),
                  ...bals.map(b => [`b:${b.id}`, `${dateBR(b.data_ini)} a ${dateBR(b.data_fim)} (contabilidade)`]),
                  ...datasAb.map(d => [`a:${d}`, `Saldo de abertura em ${dateBR(d)}`])];
    if (!opts.length) {
      $('#bsel', root).innerHTML = '<option value="">—</option>';
      $('#kp', root).innerHTML = '';
      tbl.innerHTML = `<div class="empty">Nenhum balancete importado ainda.<br><span class="small">${podeEditar() ? 'Use “Importar balancete (PDF)” com o balancete assinado enviado pela contabilidade.' : 'Peça a quem cuida da contabilidade para importar o balancete.'}</span></div>`;
      return;
    }
    if (!opts.some(o => o[0] === ui.sel)) ui.sel = (opts.find(o => o[0][0] === 'b') || opts[0])[0];
    $('#bsel', root).innerHTML = opts.map(([v, t]) => `<option value="${v}" ${v === ui.sel ? 'selected' : ''}>${esc(t)}</option>`).join('');
    await carregarItens(root);
  } catch (e) {
    fail(e);
    tbl.innerHTML = /contab_/.test(e.message || '') ? '<div class="empty">A contabilidade ainda não foi ativada no banco.<br><span class="small">Rode a migration 20261014000034_contabilidade_base.sql.</span></div>' : '';
  }
}

async function carregarItens(root) {
  const tbl = $('#tbl', root); loading(tbl);
  try {
    const [tipo, id] = [ui.sel.slice(0, 1), ui.sel.slice(2)];
    $('#pend', root).innerHTML = '';
    if (tipo === 'g') {
      const ini = id + '-01', fim = fimMes(id);
      dados.itens = await q(sb.rpc('contab_balancete_gerencial', { p_empresa: state.empresa.id, p_ini: ini, p_fim: fim }));
      $('#info', root).innerHTML = `Balancete feito pela plataforma · ${dateBR(ini)} a ${dateBR(fim)} · saldo de abertura + lançamentos contábeis gerados dos fatos financeiros pagos.
        ${podeEditar() ? ' <button class="btn small" id="gerar">Gerar lançamentos contábeis do mês</button>' : ''}`;
      if ($('#gerar', root)) $('#gerar', root).onclick = () => gerar(root, ini, fim);
    } else if (tipo === 'b') {
      dados.itens = await fetchAll(() => sb.from('contab_balancete_itens').select('conta_id, saldo_anterior, debito, credito, saldo_atual').eq('balancete_id', id));
      const b = dados.bals.find(x => x.id === id);
      $('#info', root).innerHTML = `Balancete oficial da contabilidade · ${dateBR(b.data_ini)} a ${dateBR(b.data_fim)} · arquivo ${esc(b.arquivo_nome || '—')} · importado por ${esc(b.importado_email || '—')} em ${dateBR(b.importado_em)}`;
    } else {
      // abertura: só as analíticas são gravadas; as sintéticas somam as de baixo
      dados.itens = dados.aberturas.filter(a => a.data === id).map(a => ({ conta_id: a.conta_id, saldo_anterior: 0, debito: 0, credito: 0, saldo_atual: +a.saldo }));
      $('#info', root).innerHTML = `Saldo de abertura em ${dateBR(id)} — ponto de partida da contabilidade feita pela plataforma (vem do “saldo anterior” do balancete importado).`;
    }
    pintar(root);
  } catch (e) { fail(e); tbl.innerHTML = ''; }
}

// monta a árvore com os valores do balancete (sintéticas somadas a partir das analíticas quando faltarem)
function linhas() {
  const by = new Map(dados.contas.map(c => [c.id, { ...c, ant: 0, deb: 0, cred: 0, atu: 0, tem: false, filhos: [] }]));
  const ab = ui.sel.startsWith('a:'), soma = ui.sel[0] !== 'b';   // abertura e plataforma: sintéticas = própria + filhas
  for (const it of dados.itens) {
    const c = by.get(it.conta_id); if (!c) continue;
    c.ant = +it.saldo_anterior; c.deb = +it.debito; c.cred = +it.credito; c.atu = +it.saldo_atual; c.tem = true;
  }
  for (const c of by.values()) if (c.pai_id && by.has(c.pai_id)) by.get(c.pai_id).filhos.push(c);
  if (soma) {
    const sobe = (c) => { for (const f of c.filhos) { sobe(f); for (const k of ['ant', 'deb', 'cred', 'atu']) c[k] += f[k]; if (f.tem) c.tem = true; } };
    for (const c of by.values()) if (!c.pai_id || !by.has(c.pai_id)) sobe(c);
  }
  // ordem do relatório: árvore (mãe, depois as filhas), irmãs em ordem de classificação
  const ord = [], porCls = (a, b) => cmpClass(a.classificacao, b.classificacao);
  const desce = (c) => { ord.push(c); c.filhos.sort(porCls).forEach(desce); };
  [...by.values()].filter(c => !c.pai_id || !by.has(c.pai_id)).sort(porCls).forEach(desce);
  return { ord, by, ab };
}
const MESN = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const fimMes = (m) => { const d = new Date(+m.slice(0, 4), +m.slice(5), 0); return `${m}-${String(d.getDate()).padStart(2, '0')}`; };

// gera (ou refaz) os lançamentos contábeis do mês a partir dos lançamentos financeiros pagos
async function gerar(root, ini, fim) {
  const b = $('#gerar', root); b.disabled = true; b.textContent = 'Gerando…';
  try {
    const r = await q(sb.rpc('gerar_contabil_financeiro', { p_empresa: state.empresa.id, p_ini: ini, p_fim: fim }));
    toast(`${r.gerados} lançamentos contábeis gerados${r.pendentes ? ` · ${r.pendentes} pendente(s)` : ''}`);
    await carregarItens(root);
    $('#pend', root).innerHTML = pendHTML(r);
  } catch (e) { fail(e); b.disabled = false; b.textContent = 'Gerar lançamentos contábeis do mês'; }
}
function pendHTML(r) {
  if (!r.pendentes) return `<div class="card" style="margin-bottom:12px"><strong class="pos">✔ Todos os ${r.gerados} lançamentos financeiros pagos do mês foram contabilizados.</strong></div>`;
  return `<div class="card" style="margin-bottom:12px"><strong class="neg">${r.pendentes} lançamento(s) financeiro(s) sem contabilização</strong>
    <span class="small muted"> — complete o de-para em Contabilidade › De-para e gere de novo.</span>
    ${(r.pendencias || []).map(p => `<details style="margin-top:6px"><summary>${esc(p.motivo)}: ${p.qtd} · ${money(p.valor)}</summary>
      <table class="small"><tbody>${(p.exemplos || []).map(x => `<tr><td>${dateBR(x.data)}</td><td>${esc(x.classif)}</td><td>${esc(x.descricao || '')}</td><td class="num">${money(x.valor)}</td></tr>`).join('')}</tbody></table></details>`).join('')}</div>`;
}

function cmpClass(a, b) {
  const x = a.split('.'), y = b.split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1; if (y[i] === undefined) return 1;
    if (x[i] !== y[i]) return x[i].localeCompare(y[i], undefined, { numeric: true });
  }
  return 0;
}

function pintar(root) {
  if (!dados?.itens) return;
  const { ord, by, ab } = linhas();
  const raiz = (cl) => ord.find(c => c.classificacao === cl);
  const v = (cl) => raiz(cl)?.atu || 0;
  let resultado = -(v('3') + v('4') + v('5')); if (Math.abs(resultado) < 0.005) resultado = 0;
  $('#kp', root).innerHTML = [
    ['Ativo', v('1')], ['Passivo exigível', v('2.1') + v('2.2')], ['Patrimônio líquido', v('2.3') - resultado], [ab ? 'Resultado' : 'Resultado do período', resultado],
  ].map(([t, x]) => `<div class="kpi"><div class="k-label">${t}</div><div class="k-value">${t.startsWith('Resultado') ? `<span class="${x >= 0 ? 'pos' : 'neg'}">${money(x)}</span>` : dc(x)}</div>${t.startsWith('Resultado') ? `<div class="k-sub">${x > 0 ? 'lucro' : x < 0 ? 'prejuízo' : '—'}</div>` : t === 'Patrimônio líquido' && resultado ? '<div class="k-sub">inclui o resultado do período</div>' : ''}</div>`).join('');

  const termo = ui.busca.toLowerCase();
  const fechadaAcima = (c) => { let p = c.pai_id && by.get(c.pai_id); while (p) { if (ui.fechadas.has(p.id)) return true; p = p.pai_id && by.get(p.pai_id); } return false; };
  const vis = ord.filter(c => {
    if (!c.tem) return false;
    if (ui.comSaldo && Math.abs(c.ant) < 0.005 && Math.abs(c.atu) < 0.005 && c.deb < 0.005 && c.cred < 0.005) return false;
    if (ui.nivel && c.nivel > ui.nivel) return false;
    if (termo) return c.classificacao.startsWith(termo) || String(c.codigo) === termo || c.descricao.toLowerCase().includes(termo);
    return !fechadaAcima(c);
  });
  const cols = ab ? ['Saldo'] : ['Saldo anterior', 'Débito', 'Crédito', 'Saldo atual'];
  $('#tbl', root).innerHTML = `<table class="bal-tbl"><thead><tr><th>Classificação</th><th>Código</th><th>Descrição</th>${cols.map(c => `<th class="num">${c}</th>`).join('')}</tr></thead><tbody>
    ${vis.map(c => `<tr class="${c.tipo === 'S' ? 'row-sec bal-s' : ''}" data-id="${c.id}">
      <td class="nowrap">${c.tipo === 'S' && !termo ? `<span class="bal-tg">${ui.fechadas.has(c.id) ? '▸' : '▾'}</span>` : '<span class="bal-tg"></span>'}${esc(c.classificacao)}</td>
      <td class="muted">${c.codigo ?? ''}</td>
      <td style="padding-left:${8 + (c.nivel - 1) * 14}px">${esc(c.descricao)}</td>
      ${ab ? `<td class="num">${dc(c.atu)}</td>` : `<td class="num">${dc(c.ant)}</td><td class="num">${money(c.deb)}</td><td class="num">${money(c.cred)}</td><td class="num">${dc(c.atu)}</td>`}
    </tr>`).join('') || `<tr><td colspan="${3 + cols.length}" class="empty">Nenhuma conta com esse filtro.</td></tr>`}</tbody></table>`;
  $('#tbl tbody', root).onclick = (e) => {
    const tr = e.target.closest('tr.bal-s'); if (!tr || termo) return;
    const id = tr.dataset.id; ui.fechadas.has(id) ? ui.fechadas.delete(id) : ui.fechadas.add(id); pintar(root);
  };
}

// ------------------------------------------------------------------ importação
async function importar(root) {
  const m = modal({
    title: 'Importar balancete da contabilidade', wide: true,
    body: `<p class="small muted" style="margin-top:0">Escolha o PDF do <strong>balancete de verificação</strong> (pode ser o assinado digitalmente).
      A leitura acontece aqui no navegador e o balancete só é gravado se todas as conferências fecharem.</p>
      <input type="file" id="arq" accept="application/pdf,.pdf">
      <div id="res" style="margin-top:12px"></div>`,
    foot: `<button class="btn" data-close>Cancelar</button><button class="btn primary" id="grv" disabled>Gravar balancete</button>`,
  });
  let lido = null, arquivo = null, hash = null;
  const res = $('#res', m.el), grv = $('#grv', m.el);
  $('#arq', m.el).onchange = async (e) => {
    arquivo = e.target.files[0]; lido = null; grv.disabled = true;
    if (!arquivo) { res.innerHTML = ''; return; }
    loading(res, 'Lendo o PDF…');
    try {
      const { lerBalanceteArquivo } = await import('../lib/balancete.js');
      lido = await lerBalanceteArquivo(arquivo);
      const buf = await arquivo.arrayBuffer();
      hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
      res.innerHTML = resumoLeitura(lido);
      const cnpjOk = !state.empresa.cnpj || !lido.cab.cnpj || so(state.empresa.cnpj) === so(lido.cab.cnpj);
      grv.disabled = !(lido.conferencia.ok && cnpjOk && lido.cab.ini && lido.cab.fim && lido.contas.length);
    } catch (err) { console.error(err); res.innerHTML = `<div class="card neg">Não foi possível ler este PDF: ${esc(err.message || err)}</div>`; }
  };
  grv.onclick = async () => {
    if (!lido) return;
    grv.disabled = true; grv.textContent = 'Gravando…';
    try {
      const contas = lido.contas.map(c => ({ codigo: c.codigo, classificacao: c.classificacao, descricao: c.descricao, nivel: c.nivel, tipo: c.tipo, natureza: c.natureza, pai: c.pai, ant: c.ant, deb: c.deb, cred: c.cred, atu: c.atu }));
      const r = await q(sb.rpc('importar_balancete_contabil', { p_empresa: state.empresa.id, p_ini: lido.cab.ini, p_fim: lido.cab.fim,
        p_arquivo: arquivo.name, p_hash: hash, p_resumo: lido.resumo, p_contas: contas, p_abertura: !!$('#abert', m.el)?.checked }));
      toast(`Balancete gravado: ${r.contas} contas${r.novas ? ` (${r.novas} novas no plano contábil)` : ''}${r.abertura ? ` · saldo de abertura em ${dateBR(r.abertura)}` : ''}`);
      m.close(); ui.sel = `b:${r.balancete_id}`; carregar(root);
    } catch (err) { fail(err); grv.disabled = false; grv.textContent = 'Gravar balancete'; }
  };

  function resumoLeitura(r) {
    const { cab, conferencia: cf } = r;
    if (!r.contas.length) return `<div class="card"><strong class="neg">Este PDF não parece ser um balancete de verificação.</strong><div class="small muted">Use o arquivo “Balancete de verificação” enviado pela contabilidade (não o Balanço, a DRE ou a DFC).</div></div>`;
    const cnpjOk = !state.empresa.cnpj || !cab.cnpj || so(state.empresa.cnpj) === so(cab.cnpj);
    const jaTem = dados?.bals?.find(b => b.data_ini === cab.ini && b.data_fim === cab.fim);
    const abertData = cab.ini ? new Date(new Date(cab.ini + 'T12:00:00').getTime() - 864e5).toISOString().slice(0, 10) : null;
    const temAbert = (dados?.aberturas || []).length > 0;
    const ok = (b, t) => `<li class="${b ? 'pos' : 'neg'}">${b ? '✔' : '✖'} ${t}</li>`;
    const tipos = (t) => cf.erros.filter(e => e.tipo === t).length;
    return `
      <div class="grid2">
        <div><div class="small muted">Empresa</div><strong>${esc(cab.empresa || '—')}</strong><div class="small ${cnpjOk ? 'muted' : 'neg'}">CNPJ ${esc(cab.cnpj || '—')}${cnpjOk ? '' : ' — diferente do CNPJ desta empresa!'}</div></div>
        <div><div class="small muted">Período</div><strong>${dateBR(cab.ini)} a ${dateBR(cab.fim)}</strong><div class="small muted">${cf.contas} contas (${cf.analiticas} analíticas)</div></div>
      </div>
      <ul class="bal-check">
        ${ok(cf.contas > 0 && !tipos('duplicada'), 'Contas lidas sem repetição')}
        ${ok(!tipos('linha'), 'Em toda conta: saldo anterior + débito − crédito = saldo atual')}
        ${ok(!tipos('grupo'), 'Toda conta sintética = soma das contas abaixo dela (nenhuma conta faltando)')}
        ${ok(!tipos('fechamento') && !tipos('resumo'), 'Devedoras = credoras e totais iguais ao “Resumo do balancete”')}
      </ul>
      ${cf.erros.length ? `<div class="card" style="max-height:220px;overflow:auto"><strong class="neg">O balancete não será gravado enquanto houver diferença:</strong><ul class="small">${cf.erros.slice(0, 40).map(e => `<li>${esc(e.msg)}</li>`).join('')}</ul></div>` : ''}
      ${!cnpjOk ? '<p class="neg small">O CNPJ do arquivo é de outra empresa: não é possível gravar aqui.</p>' : ''}
      ${jaTem ? `<p class="warn small">Já existe um balancete de ${dateBR(cab.ini)} a ${dateBR(cab.fim)}, importado em ${dateBR(jaTem.importado_em)}. Gravar substitui pelo novo.</p>` : ''}
      ${abertData ? `<label class="bal-abert"><input type="checkbox" id="abert" ${temAbert ? '' : 'checked'}><span>Usar o <strong>saldo anterior</strong> deste balancete como <strong>saldo de abertura em ${dateBR(abertData)}</strong> (ponto de partida da contabilidade da plataforma)</span></label>` : ''}`;
  }
}
