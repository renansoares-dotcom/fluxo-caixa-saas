// Logística › Frota e parâmetros: caminhões (capacidade, baú, custo), parâmetros da montagem de cargas e clientes com restrição.
import { sb, state, q } from '../lib/data.js';
import { erroTela, $, $$, esc, fail, toast, modal, confirmDialog } from '../lib/ui.js';
import { carregarBase, podeLogistica, TIPOS_VEICULO, PARAM_PADRAO, municipios } from '../lib/logistica.js';
import { qtd, inp, num } from '../lib/compras.js';

export const title = 'Logística — frota e parâmetros';
const ui = { aba: 'frota' };
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const soDig = (s) => String(s || '').replace(/\D/g, '');

export async function render(root) {
  root.innerHTML = `<div class="mm-topo"><div><h2 style="margin:0">Frota e parâmetros</h2><div class="muted small">Base da montagem automática das cargas. ${podeLogistica() ? '' : 'Só admin, financeiro ou diretor alteram.'}</div></div>
      <a class="btn ghost" href="#/logistica">Voltar às cargas</a></div>
    <div class="card toolbar"><div class="chips" id="lf-abas">${[['frota', 'Veículos'], ['param', 'Parâmetros'], ['cli', 'Clientes com restrição']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div></div>
    <div id="lf-corpo" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#lf-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  let B; try { B = await carregarBase(); } catch (err) { fail(err); $('#lf-corpo', root).innerHTML = erroTela(); return; }
  const corpo = $('#lf-corpo', root);
  if (ui.aba === 'frota') return frota(corpo, B, root);
  if (ui.aba === 'param') return parametros(corpo, B, root);
  return clientes(corpo, B, root);
}

function frota(corpo, B, root) {
  const m3 = (v) => v.comp_m && v.larg_m && v.alt_m ? (v.comp_m * v.larg_m * v.alt_m).toFixed(1).replace('.', ',') : '–';
  corpo.innerHTML = `<div class="card flush"><div class="card-head" style="padding:14px 16px 0"><h2 style="margin:0">Veículos</h2>${podeLogistica() ? '<button class="btn primary small" id="lf-novo">Incluir veículo</button>' : ''}</div>
    <div class="table-wrap"><table><thead><tr><th>Código</th><th>Placa</th><th>Tipo</th><th class="num">Carga máx. (kg)</th><th class="num">Baú (m³)</th><th class="num">Ocupação máx.</th><th>Pequeno</th><th>Motorista</th><th>Situação</th></tr></thead><tbody>
    ${B.veiculos.map(v => `<tr class="${podeLogistica() ? 'clickable' : ''}" data-id="${v.id}"><td><b>${esc(v.codigo)}</b></td><td>${esc(v.placa || '')}</td><td>${esc(TIPOS_VEICULO[v.tipo] || v.tipo)}</td><td class="num">${qtd(v.carga_kg)}</td>
      <td class="num">${m3(v)}</td><td class="num">${qtd(v.ocupacao_max_pct)}%</td><td>${v.pequeno ? 'sim' : ''}</td><td>${esc(v.motorista || '')}</td><td>${{ disponivel: 'Disponível', manutencao: 'Em manutenção', inativo: 'Inativo' }[v.situacao]}</td></tr>`).join('')
      || '<tr><td colspan="9" class="empty">Nenhum veículo. Cadastre os 3 caminhões e o caminhão menor.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">"Pequeno" = pode atender cliente que só recebe veículo pequeno ou fica em centro com restrição. VUC, 3/4 e utilitário já contam como pequenos. Sem as medidas do baú, só o peso limita a carga.</p>`;
  $('#lf-novo', corpo) && ($('#lf-novo', corpo).onclick = () => editarVeiculo(null, root));
  if (podeLogistica()) $$('tr[data-id]', corpo).forEach(tr => tr.onclick = () => editarVeiculo(B.veiculos.find(v => v.id === tr.dataset.id), root));
}

function editarVeiculo(v, root) {
  const f = (id, lab, val, extra = '') => `<label>${lab}<input id="${id}" value="${val ?? ''}" ${extra}></label>`;
  const md = modal({ title: v ? `Veículo ${v.codigo}` : 'Incluir veículo', body: `<div class="grid-form">
      ${f('fv-c', 'Código / apelido', esc(v?.codigo || ''), 'placeholder="TRK-01"')}${f('fv-p', 'Placa', esc(v?.placa || ''))}
      <label>Tipo<select id="fv-t">${Object.entries(TIPOS_VEICULO).map(([k, t]) => `<option value="${k}" ${(v?.tipo || 'truck') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      ${f('fv-kg', 'Carga máxima (kg)', inp(v?.carga_kg))}${f('fv-oc', 'Ocupação máxima (%)', inp(v?.ocupacao_max_pct ?? 95))}
      ${f('fv-cm', 'Baú — comprimento (m)', inp(v?.comp_m))}${f('fv-lm', 'Baú — largura (m)', inp(v?.larg_m))}${f('fv-am', 'Baú — altura (m)', inp(v?.alt_m))}
      ${f('fv-me', 'Máx. de entregas por viagem', inp(v?.max_entregas), 'placeholder="sem limite"')}
      ${f('fv-ck', 'Consumo (km/l)', inp(v?.consumo_km_l))}${f('fv-cu', 'Custo por km (R$)', inp(v?.custo_km), 'placeholder="ou consumo × diesel"')}
      ${f('fv-mo', 'Motorista habitual', esc(v?.motorista || ''))}
      <label>Situação<select id="fv-s">${[['disponivel', 'Disponível'], ['manutencao', 'Em manutenção'], ['inativo', 'Inativo']].map(([k, t]) => `<option value="${k}" ${(v?.situacao || 'disponivel') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" id="fv-pq" ${v?.pequeno ? 'checked' : ''}> Atende cliente que só recebe veículo pequeno</label>
      <label class="span2">Observação<input id="fv-o" value="${esc(v?.observacao || '')}"></label></div>`,
    foot: `${v ? '<button class="btn danger" id="fv-del" style="margin-right:auto">Excluir</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="fv-ok">Salvar</button>` });
  const n = (id) => { const s = $('#' + id, md.el).value.trim(); return s ? num(s) : null; };
  $('#fv-ok', md.el).onclick = async (ev) => {
    const row = { codigo: $('#fv-c', md.el).value.trim(), placa: $('#fv-p', md.el).value.trim().toUpperCase() || null, tipo: $('#fv-t', md.el).value, carga_kg: n('fv-kg'), ocupacao_max_pct: n('fv-oc') ?? 95,
      comp_m: n('fv-cm'), larg_m: n('fv-lm'), alt_m: n('fv-am'), max_entregas: n('fv-me'), consumo_km_l: n('fv-ck'), custo_km: n('fv-cu'), motorista: $('#fv-mo', md.el).value.trim() || null,
      situacao: $('#fv-s', md.el).value, pequeno: $('#fv-pq', md.el).checked, observacao: $('#fv-o', md.el).value.trim() || null };
    if (!row.codigo || !row.carga_kg) return toast('Preencha código e carga máxima', true);
    ev.target.disabled = true;
    try { if (v) await q(sb.from('log_veiculos').update(row).eq('id', v.id)); else await q(sb.from('log_veiculos').insert({ ...row, empresa_id: state.empresa.id }));
      md.close(); toast('Veículo salvo'); render(root); } catch (err) { fail(err); ev.target.disabled = false; }
  };
  $('#fv-del', md.el) && ($('#fv-del', md.el).onclick = async () => { if (!await confirmDialog('Excluir o veículo? Cargas antigas ficam sem veículo. Para tirar de uso, prefira "Inativo".')) return;
    try { await q(sb.from('log_veiculos').delete().eq('id', v.id)); md.close(); render(root); } catch (err) { fail(err); } });
}

async function parametros(corpo, B, root) {
  const P = B.P, M = await municipios().catch(() => ({}));
  const campo = (id, lab, val, ajuda = '') => `<label>${lab}<input id="${id}" value="${val ?? ''}" ${podeLogistica() ? '' : 'disabled'}>${ajuda ? `<span class="small muted">${ajuda}</span>` : ''}</label>`;
  corpo.innerHTML = `<div class="card"><h2>Parâmetros da montagem</h2><div class="grid-form">
      ${campo('lp-or', 'Município de saída (código IBGE)', esc(P.origem_cmun || ''), 'Vazio = município do emitente das notas (Caruaru = 2604106).')}
      ${campo('lp-fr', 'Fator rodoviário', inp(P.fator_rodoviario), 'Distância em linha reta × fator ≈ estrada. 1,3 é o usual.')}
      ${campo('lp-ve', 'Velocidade média (km/h)', inp(P.velocidade_kmh))}${campo('lp-mi', 'Minutos por entrega', inp(P.min_por_entrega))}
      ${campo('lp-jo', 'Jornada máxima (h)', inp(P.jornada_h))}${campo('lp-di', 'Diesel (R$/l)', inp(P.diesel_rs_l), 'Usado quando o veículo não tem custo por km.')}
      ${campo('lp-m3', 'm³ por tonelada', inp(P.m3_por_t), 'Volume estimado do produto embalado (fardos/caixas). Ajuste depois de medir.')}
      ${campo('lp-ra', 'Raio máximo da frota (km)', inp(P.raio_max_km), 'Acima disso a entrega aparece como "transportadora?".')}
      ${campo('lp-da', 'Dias para considerar atrasada', inp(P.dias_atraso))}
      <div class="span2"><div class="small muted">Notas que a frota entrega (modalidade de frete da NF-e)</div><div class="areas-chk">
        ${[['0', '0 — por conta do emitente (CIF)'], ['1', '1 — por conta do destinatário (FOB, cliente retira)'], ['2', '2 — de terceiros'], ['9', '9 — sem frete informado']].map(([k, t]) => `<label class="chk"><input type="checkbox" class="lp-mf" value="${k}" ${P.mod_fretes.includes(k) ? 'checked' : ''} ${podeLogistica() ? '' : 'disabled'}> ${t}</label>`).join('')}</div></div></div>
    ${podeLogistica() ? '<div style="margin-top:12px"><button class="btn primary" id="lp-ok">Salvar parâmetros</button></div>' : ''}</div>`;
  $('#lp-ok', corpo) && ($('#lp-ok', corpo).onclick = async () => {
    const n = (id) => { const s = $('#' + id, corpo).value.trim(); return s ? num(s) : null; };
    const or = soDig($('#lp-or', corpo).value);
    if (or && !M[or]) return toast('Código IBGE não encontrado (7 dígitos)', true);
    const mf = $$('.lp-mf', corpo).filter(x => x.checked).map(x => x.value); if (!mf.length) return toast('Marque ao menos uma modalidade de frete', true);
    const row = { empresa_id: state.empresa.id, origem_cmun: or || null, fator_rodoviario: n('lp-fr') ?? PARAM_PADRAO.fator_rodoviario, velocidade_kmh: n('lp-ve') ?? 55, min_por_entrega: n('lp-mi') ?? 25,
      jornada_h: n('lp-jo') ?? 10, diesel_rs_l: n('lp-di'), m3_por_t: n('lp-m3') ?? 4, raio_max_km: n('lp-ra') ?? 600, dias_atraso: n('lp-da') ?? 3, mod_fretes: mf };
    try { await q(sb.from('log_parametros').upsert(row, { onConflict: 'empresa_id' })); toast('Parâmetros salvos'); render(root); } catch (err) { fail(err); }
  });
}

function clientes(corpo, B, root) {
  corpo.innerHTML = `<div class="card flush"><div class="card-head" style="padding:14px 16px 0"><h2 style="margin:0">Clientes com restrição de entrega</h2>${podeLogistica() ? '<button class="btn primary small" id="lc-novo">Incluir cliente</button>' : ''}</div>
    <div class="table-wrap"><table><thead><tr><th>Cliente</th><th>CNPJ/CPF</th><th>Só veículo pequeno</th><th>Dias de recebimento</th><th>Horário</th><th>Observação</th></tr></thead><tbody>
    ${B.clientes.map(c => `<tr class="${podeLogistica() ? 'clickable' : ''}" data-id="${c.id}"><td>${esc(c.nome || '')}</td><td>${esc(c.documento)}</td><td>${c.so_pequeno ? 'sim' : ''}</td>
      <td>${(c.dias_receb || []).map(d => DIAS[d]).join(', ') || 'qualquer dia'}</td><td>${esc(c.horario || '')}</td><td class="wrap">${esc(c.observacao || '')}</td></tr>`).join('')
      || '<tr><td colspan="6" class="empty">Nenhum cliente com restrição.</td></tr>'}</tbody></table></div></div>`;
  const editar = (c) => {
    const md = modal({ title: c ? 'Cliente com restrição' : 'Incluir cliente', body: `<div class="grid-form">
        <label>CNPJ/CPF<input id="lc-d" value="${esc(c?.documento || '')}"></label><label>Nome<input id="lc-n" value="${esc(c?.nome || '')}"></label>
        <label class="chk"><input type="checkbox" id="lc-p" ${c?.so_pequeno ? 'checked' : ''}> Só recebe veículo pequeno</label><label>Horário de recebimento<input id="lc-h" value="${esc(c?.horario || '')}" placeholder="08h às 16h"></label>
        <div class="span2"><div class="small muted">Dias de recebimento (nenhum = qualquer dia)</div><div class="areas-chk">${DIAS.map((t, i) => `<label class="chk"><input type="checkbox" class="lc-dia" value="${i}" ${(c?.dias_receb || []).includes(i) ? 'checked' : ''}> ${t}</label>`).join('')}</div></div>
        <label class="span2">Observação<input id="lc-o" value="${esc(c?.observacao || '')}" placeholder="doca, agendamento, contato…"></label></div>`,
      foot: `${c ? '<button class="btn danger" id="lc-del" style="margin-right:auto">Excluir</button>' : ''}<button class="btn" data-close>Cancelar</button><button class="btn primary" id="lc-ok">Salvar</button>` });
    $('#lc-ok', md.el).onclick = async () => {
      const row = { documento: soDig($('#lc-d', md.el).value), nome: $('#lc-n', md.el).value.trim() || null, so_pequeno: $('#lc-p', md.el).checked, horario: $('#lc-h', md.el).value.trim() || null,
        dias_receb: $$('.lc-dia', md.el).filter(x => x.checked).map(x => +x.value), observacao: $('#lc-o', md.el).value.trim() || null };
      if (!row.documento) return toast('Informe o CNPJ/CPF', true); if (!row.dias_receb.length) row.dias_receb = null;
      try { if (c) await q(sb.from('log_clientes').update(row).eq('id', c.id)); else await q(sb.from('log_clientes').insert({ ...row, empresa_id: state.empresa.id })); md.close(); render(root); } catch (err) { fail(err); }
    };
    $('#lc-del', md.el) && ($('#lc-del', md.el).onclick = async () => { try { await q(sb.from('log_clientes').delete().eq('id', c.id)); md.close(); render(root); } catch (err) { fail(err); } });
  };
  $('#lc-novo', corpo) && ($('#lc-novo', corpo).onclick = () => editar(null));
  if (podeLogistica()) $$('tr[data-id]', corpo).forEach(tr => tr.onclick = () => editar(B.clientes.find(c => c.id === tr.dataset.id)));
}
