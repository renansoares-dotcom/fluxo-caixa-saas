// Revisão dos lançamentos "Pago" sem conta bancária (ficam fora do fluxo de caixa e da DRE).
// Classifica cada um e deixa o usuário decidir em lote: excluir os duplicados (o recebimento já existe com conta)
// ou definir a conta onde o dinheiro entrou. Nada é alterado sem confirmação.
import { sb, state, q, fetchAll, podeEditar } from './data.js';
import { $, $$, esc, money, dateBR, fail, toast, modal, options, exportXLSX } from './ui.js';

const dias = (a, b) => Math.round((Date.parse(a + 'T12:00:00') - Date.parse(b + 'T12:00:00')) / 864e5);
const perto = (a, b) => Math.abs(+a - +b) <= 0.05;
const addDias = (d, n) => new Date(Date.parse(d + 'T12:00:00') + n * 864e5).toISOString().slice(0, 10);
// "1-35556/2 (obs…)" → {nf:35556, parc:2}; "35556-2", "35556/2", "033775-001" também
export function nfParc(txt) {
  const s = String(txt || '').replace(/\(.*$/, '').trim();
  let m = s.match(/^\d+-(\d{3,7})\/(\d{1,3})\b/); if (m) return `${+m[1]}/${+m[2]}`;
  m = s.match(/^0*(\d{3,7})\s*[-/.]\s*0*(\d{1,3})\b/); if (m) return `${+m[1]}/${+m[2]}`;
  return null;
}
const CAT = {
  dup: ['Duplicado: a mesma NF/parcela e valor já está lançada com conta', 'pago'],
  prov: ['Provável duplicado: mesmo cliente e valor em até 5 dias (NF diferente ou sem NF)', 'aberto'],
  pix: ['Valor já entrou no extrato (conciliado com outro lançamento)', 'aberto'],
  rep: ['Repetido nesta lista (mesmo documento, valor e data)', 'aberto'],
  sem: ['Sem correspondência: falta definir a conta', 'vencido'],
};

async function carregar() {
  const e = state.empresa.id;
  const sc = await fetchAll(() => sb.from('lancamentos').select('id,data,valor,descricao,documento,origem,favorecido_id,plano_id').eq('empresa_id', e).eq('status', 'Pago').is('conta_id', null).order('data').order('id'));
  if (!sc.length) return { sc, cand: [], ext: [], vinc: new Map() };
  const ds = sc.map(l => l.data).sort(), ini = addDias(ds[0], -15), fim = addDias(ds[ds.length - 1], 90);
  const [cand, ext, vv] = await Promise.all([
    fetchAll(() => sb.from('lancamentos').select('id,data,valor,descricao,documento,favorecido_id,plano_id,conta_id').eq('empresa_id', e).eq('status', 'Pago').not('conta_id', 'is', null).gte('data', ini).lte('data', fim).gt('valor', 0).order('id')),
    fetchAll(() => sb.from('extrato_itens').select('id,data,valor,descricao,conta_id,status').eq('empresa_id', e).eq('status', 'conciliado').gt('valor', 0).gte('data', ini).lte('data', fim).order('id')),
    (async () => { const out = []; for (let i = 0; i < sc.length; i += 150) out.push(...await q(sb.from('nfe_vinculos').select('id,lancamento_id,n:nfe_notas(numero)').in('lancamento_id', sc.slice(i, i + 150).map(l => l.id)))); return out; })(),
  ]);
  const ocupados = new Set();
  for (let i = 0; i < cand.length; i += 150) for (const v of await q(sb.from('nfe_vinculos').select('lancamento_id').in('lancamento_id', cand.slice(i, i + 150).map(l => l.id)))) ocupados.add(v.lancamento_id);
  return { sc, cand, ext, vinc: new Map(vv.map(v => [v.lancamento_id, v])), ocupados };
}

function classificar({ sc, cand, ext }) {
  const porNF = new Map();
  for (const c of cand) { const k = nfParc(c.documento || c.descricao); if (k) (porNF.get(k) || porNF.set(k, []).get(k)).push(c); }
  const usados = new Set(), usadosExt = new Set(), R = new Map();
  // 1º a mesma NF/parcela e valor; 2º mesmo cliente, valor e data próxima — cada lançamento com conta serve a um só
  for (const l of sc) {
    const k = nfParc(l.documento || l.descricao);
    const par = k && (porNF.get(k) || []).find(c => !usados.has(c.id) && perto(c.valor, l.valor));
    if (par) { usados.add(par.id); R.set(l.id, { l, k, cat: 'dup', par }); }
  }
  for (const l of sc) {
    if (R.has(l.id)) continue;
    const par = cand.filter(c => !usados.has(c.id) && c.favorecido_id && c.favorecido_id === l.favorecido_id && c.plano_id === l.plano_id && perto(c.valor, l.valor) && Math.abs(dias(c.data, l.data)) <= 5)
      .sort((a, b) => Math.abs(dias(a.data, l.data)) - Math.abs(dias(b.data, l.data)))[0];
    if (par) { usados.add(par.id); R.set(l.id, { l, k: nfParc(l.documento || l.descricao), cat: 'prov', par }); }
  }
  const vistos = new Map();
  return sc.map(l => {
    if (R.has(l.id)) return R.get(l.id);
    const k = nfParc(l.documento || l.descricao);
    const ex = ext.find(x => !usadosExt.has(x.id) && perto(x.valor, l.valor) && Math.abs(dias(x.data, l.data)) <= 5);
    if (ex) { usadosExt.add(ex.id); return { l, k, cat: 'pix', ex }; }
    const chave = `${k || l.descricao}|${(+l.valor).toFixed(2)}|${l.data}`;
    if (vistos.has(chave)) return { l, k, cat: 'rep', irmao: vistos.get(chave) };
    vistos.set(chave, l);
    return { l, k, cat: 'sem' };
  });
}

export async function revisarSemConta(onDone) {
  const m = modal({ title: 'Recebimentos "Pago" sem conta bancária', wide: true, body: '<div class="loading">Analisando…</div>' });
  let D, L;
  try { D = await carregar(); L = classificar(D); } catch (e) { fail(e); m.close(); return; }
  const cad = state.cad, fav = (id) => cad.favById?.[id]?.nome || '—', conta = (id) => cad.contaById[id]?.nome || '—';
  const sel = new Set(L.filter(x => x.cat === 'dup').map(x => x.l.id));
  const pinta = () => {
    const tot = (c) => L.filter(x => x.cat === c), soma = (a) => a.reduce((s, x) => s + +x.l.valor, 0);
    const vSel = L.filter(x => sel.has(x.l.id)).reduce((s, x) => s + +x.l.valor, 0);
    $('.modal-body', m.el).innerHTML = !L.length ? '<div class="empty">Nenhum lançamento pago sem conta. 🎉</div>' : `
      <p class="small muted" style="margin-top:0">Sem conta bancária, esses recebimentos ficam fora do fluxo de caixa e da DRE. Para cada um: <strong>exclua</strong> se for duplicado (o recebimento já existe com conta — a ligação com a nota passa para ele) ou <strong>defina a conta</strong> onde o dinheiro entrou.</p>
      <div class="kpis" style="margin:0 0 10px">${Object.entries(CAT).map(([c, [t]]) => `<div class="kpi"><div class="k-label">${esc(t)}</div><div class="k-value">${tot(c).length}</div><div class="k-sub">${money(soma(tot(c)))}</div></div>`).join('')}</div>
      <div class="toolbar" style="margin:0 0 8px">
        <span class="chips">${[['dup', 'Marcar duplicados'], ['prov', 'Marcar prováveis'], ['pix', 'Marcar já no extrato'], ['rep', 'Marcar repetidos'], ['sem', 'Marcar sem correspondência'], ['', 'Limpar']].map(([c, t]) => `<span class="chip" data-mc="${c}">${t}</span>`).join('')}</span>
        <span class="grow"></span><strong>${sel.size} marcado(s) · ${money(vSel)}</strong>
      </div>
      <div class="table-wrap" style="max-height:52vh"><table id="tsc"><thead><tr><th></th><th>Data</th><th>Cliente</th><th>Documento</th><th class="num">Valor</th><th>NF ligada</th><th>Linha planilha</th><th>Situação</th><th>Correspondência</th></tr></thead><tbody>
      ${L.map(x => { const [t, b] = CAT[x.cat]; const v = D.vinc.get(x.l.id);
        const corr = x.par ? `${dateBR(x.par.data)} · ${esc(conta(x.par.conta_id))} · ${money(x.par.valor)} · ${esc((x.par.documento || x.par.descricao || '').slice(0, 30))}`
          : x.ex ? `Extrato ${esc(conta(x.ex.conta_id))} ${dateBR(x.ex.data)} · ${money(x.ex.valor)} · ${esc((x.ex.descricao || '').slice(0, 40))}`
          : x.irmao ? 'igual a outra linha acima' : '';
        return `<tr><td><input type="checkbox" data-id="${x.l.id}" ${sel.has(x.l.id) ? 'checked' : ''}></td><td>${dateBR(x.l.data)}</td><td class="wrap">${esc(fav(x.l.favorecido_id))}</td>
          <td class="wrap small">${esc(x.l.documento || x.l.descricao || '')}</td><td class="num">${money(x.l.valor)}</td><td>${v?.n ? v.n.numero : ''}</td><td class="small">${esc(x.l.origem || '')}</td>
          <td><span class="badge ${b}">${esc(t.split(':')[0])}</span></td><td class="small wrap">${corr}</td></tr>`; }).join('')}
      </tbody></table></div>`;
    const f = $('.modal-foot', m.el) || m.el.querySelector('.modal').appendChild(Object.assign(document.createElement('div'), { className: 'modal-foot' }));
    f.innerHTML = L.length ? `<button class="btn" id="xls">Exportar Excel</button><span class="grow"></span>
      ${podeEditar() ? `<label class="small">Conta<select id="cta">${options(cad.contas.filter(c => c.ativo !== false), { empty: 'escolha…' })}</select></label>
      <button class="btn" id="defc" ${sel.size ? '' : 'disabled'}>Definir conta nos marcados</button>
      <button class="btn danger" id="exc" ${sel.size ? '' : 'disabled'}>Excluir marcados</button>` : ''}` : '<button class="btn" data-close>Fechar</button>';
    $$('[data-mc]', m.el).forEach(ch => ch.onclick = () => { const c = ch.dataset.mc; if (!c) sel.clear(); else L.filter(x => x.cat === c).forEach(x => sel.add(x.l.id)); pinta(); });
    $('#tsc', m.el) && ($('#tsc', m.el).onchange = (e) => { const id = e.target.dataset.id; if (!id) return; e.target.checked ? sel.add(id) : sel.delete(id); pinta(); });
    $('#xls', m.el) && ($('#xls', m.el).onclick = () => exportXLSX($('#tsc', m.el), 'pagos_sem_conta'));
    $('#exc', m.el) && ($('#exc', m.el).onclick = () => excluir());
    $('#defc', m.el) && ($('#defc', m.el).onclick = () => definirConta($('#cta', m.el).value));
  };

  async function excluir() {
    const alvo = L.filter(x => sel.has(x.l.id));
    const naoDup = alvo.filter(x => x.cat === 'sem').length, prov = alvo.filter(x => x.cat === 'prov').length;
    if (!confirm(`Excluir ${alvo.length} lançamento(s), ${money(alvo.reduce((s, x) => s + +x.l.valor, 0))}?${naoDup ? `\n\nAtenção: ${naoDup} deles NÃO têm correspondência encontrada — só exclua se tiver certeza de que são duplicados.` : ''}${prov ? `\n\n${prov} são prováveis duplicados (mesmo cliente e valor, NF diferente) — confira antes.` : ''}\n\nA ligação com a nota fiscal passa para o lançamento correspondente (com conta), quando houver.`)) return;
    try {
      // passa a ligação com a NF para o lançamento que fica (se ele ainda não tiver)
      const ocup = new Set(D.ocupados);
      for (const x of alvo) {
        const v = D.vinc.get(x.l.id);
        if (v && x.par && !ocup.has(x.par.id)) { await q(sb.from('nfe_vinculos').update({ lancamento_id: x.par.id }).eq('id', v.id)); ocup.add(x.par.id); }
      }
      const ids = alvo.map(x => x.l.id);
      for (let i = 0; i < ids.length; i += 150) await q(sb.from('lancamentos').delete().in('id', ids.slice(i, i + 150)).is('conta_id', null).eq('status', 'Pago'));
      toast(`${ids.length} lançamento(s) excluído(s)`); await recarregar();
    } catch (e) { fail(e); }
  }
  async function definirConta(cid) {
    if (!cid) return toast('Escolha a conta', true);
    const alvo = L.filter(x => sel.has(x.l.id));
    const dup = alvo.filter(x => x.cat !== 'sem').length;
    if (!confirm(`Definir a conta ${conta(cid)} em ${alvo.length} lançamento(s), ${money(alvo.reduce((s, x) => s + +x.l.valor, 0))}?${dup ? `\n\nAtenção: ${dup} deles parecem duplicados — com conta, passam a contar em dobro nos relatórios.` : ''}`)) return;
    try {
      const ids = alvo.map(x => x.l.id);
      for (let i = 0; i < ids.length; i += 150) await q(sb.from('lancamentos').update({ conta_id: cid }).in('id', ids.slice(i, i + 150)).is('conta_id', null));
      toast(`Conta definida em ${ids.length} lançamento(s)`); await recarregar();
    } catch (e) { fail(e); }
  }
  async function recarregar() {
    $('.modal-body', m.el).innerHTML = '<div class="loading">Atualizando…</div>';
    try { D = await carregar(); L = classificar(D); sel.clear(); pinta(); onDone && onDone(); } catch (e) { fail(e); }
  }
  pinta();
}
