// Créditos e adiantamentos: saldo por cliente/fornecedor, cadastro e onde cada crédito foi usado.
import { sb, state, q, loadCadastros, podeEditar } from '../lib/data.js';
import { erroTela, $, esc, money, dateBR, fail, toast, exportXLSX } from '../lib/ui.js';
import { TIPOS, creditosComSaldo, novoCredito, devolverCredito } from '../lib/creditos.js';

export const title = 'Créditos e adiantamentos';
const ui = { nat: 'cliente', saldo: true, busca: '' };
let L = [];

export async function render(root) {
  await loadCadastros();
  root.innerHTML = `
    <div class="card"><div class="card-head" style="margin-bottom:0">
      <div><h2 style="margin:0">Créditos e adiantamentos</h2><p class="muted small" style="margin:4px 0 0">Adiantamentos recebidos de clientes (ou pagos a fornecedores) antes da nota, e créditos de clientes (devolução, desconto, acordo). O saldo é usado nas parcelas das notas em <em>Notas Fiscais › nota › Usar crédito</em>.</p></div>
      <div style="display:flex;gap:8px">${podeEditar() ? '<button class="btn primary" id="novo">+ Novo crédito / adiantamento</button>' : ''}<button class="btn" id="exp">Exportar Excel</button></div></div>
      <div class="toolbar" id="flt" style="margin-top:10px">
        <label>De<select name="nat"><option value="cliente">Clientes</option><option value="fornecedor">Fornecedores</option></select></label>
        <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" name="saldo" checked> Só com saldo</label>
        <label class="grow">Buscar<input name="busca" placeholder="cliente, CNPJ, descrição"></label>
      </div></div>
    <div class="kpis" id="kpis"></div><div id="corpo"><div class="loading">Carregando…</div></div>`;
  $('#flt', root).oninput = (e) => { const n = e.target.name; if (!n) return; ui[n] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; if (n === 'busca') pintar(root); else carregar(root); };
  $('#novo', root) && ($('#novo', root).onclick = () => novoCredito({ natureza: ui.nat }, () => carregar(root)));
  $('#exp', root).onclick = () => exportXLSX($('#corpo table', root), `creditos_${ui.nat}`);
  await carregar(root);
}

async function carregar(root) {
  try { L = await creditosComSaldo({ natureza: ui.nat, todos: !ui.saldo }); }
  catch (e) { $('#corpo', root).innerHTML = erroTela('os créditos e adiantamentos'); $('#kpis', root).innerHTML = ''; return; }
  pintar(root);
}

function pintar(root) {
  const cad = state.cad, b = ui.busca.trim().toLowerCase();
  const R = L.filter(c => { const f = cad.favById[c.favorecido_id]; return !b || `${f?.nome} ${f?.documento} ${c.descricao}`.toLowerCase().includes(b); });
  const tot = (k) => R.reduce((s, c) => s + +c[k], 0);
  $('#kpis', root).innerHTML = `
    <div class="kpi"><div class="k-label">Saldo de créditos ${ui.nat === 'cliente' ? 'de clientes' : 'com fornecedores'}</div><div class="k-value">${money(tot('saldo'))}</div><div class="k-sub">${R.filter(c => c.saldo > 0.005).length} crédito(s) em aberto</div></div>
    <div class="kpi"><div class="k-label">Adiantamentos em aberto</div><div class="k-value">${money(R.filter(c => c.tipo === 'adiantamento').reduce((s, c) => s + c.saldo, 0))}</div><div class="k-sub">aguardando nota</div></div>
    <div class="kpi"><div class="k-label">Já usado em notas</div><div class="k-value">${money(tot('usado'))}</div></div>`;
  $('#corpo', root).innerHTML = !R.length ? '<div class="card"><div class="empty">Nenhum crédito.</div></div>' : `<div class="card flush"><div class="table-wrap"><table><thead><tr><th>Data</th><th>${ui.nat === 'cliente' ? 'Cliente' : 'Fornecedor'}</th><th>Tipo</th><th>Descrição</th><th class="num">Valor</th><th class="num">Usado / devolvido</th><th class="num">Saldo</th><th>Origem</th><th></th></tr></thead><tbody>
    ${R.map(c => { const f = cad.favById[c.favorecido_id]; return `<tr><td>${dateBR(c.data)}</td><td class="wrap">${esc(f?.nome || '—')}<div class="small muted">${esc(f?.documento || '')}</div></td><td>${esc(TIPOS[c.tipo] || c.tipo)}</td><td class="wrap small">${esc(c.descricao || '')}</td>
      <td class="num">${money(c.valor)}</td><td class="num">${money(c.usado)}</td><td class="num"><strong>${money(c.saldo)}</strong></td><td class="small">${c.tipo === 'pago_maior' ? 'pagamento ligado à nota' : c.lancamento_id ? 'lançamento ligado' : c.nota_id ? 'nota de devolução' : '—'}</td>
      <td style="white-space:nowrap">${podeEditar() && c.saldo > 0.005 ? `<button class="btn small" data-dev="${c.id}" title="${ui.nat === 'cliente' ? 'A empresa devolve o valor ao cliente' : 'O fornecedor devolve o valor em dinheiro'}">Devolver</button> ` : ''}${podeEditar() && c.usado < 0.005 ? `<button class="btn ghost small" data-canc="${c.id}" title="Cancelar este crédito">✕</button>` : ''}</td></tr>`; }).join('')}
    </tbody></table></div></div>`;
  $('#corpo', root).onclick = async (e) => {
    const dv = e.target.closest('[data-dev]')?.dataset.dev; if (dv) return devolverCredito(L.find(c => c.id === dv), () => carregar(root));
    const id = e.target.closest('[data-canc]')?.dataset.canc; if (!id) return;
    if (!confirm('Cancelar este crédito? Ele deixa de aparecer para uso nas notas.')) return;
    try { await q(sb.from('creditos').update({ cancelado: true }).eq('id', id)); toast('Crédito cancelado'); carregar(root); } catch (err) { fail(err); }
  };
}
