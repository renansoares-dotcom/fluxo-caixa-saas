// Recuperadora › Ambiental (REC008): destinação de resíduos (rejeito, lodo, borra…) com MTR, CDF, transportador, destinador, custo
// (título a pagar) e anexos; licenças e documentos ambientais com validade, aviso antes de vencer e anexos.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, money, dateBR, today, toast, fail, modal, parseNum, confirmDialog, exportXLSX } from '../lib/ui.js';
import { carregarRec, podeConfig, kpi, kg0, semSQL, avisoSQL, desligada, avisoDesligada } from '../lib/rec-ui.js';
import { TIPOS_RESIDUO, situacaoLicenca } from '../lib/recuperadora.js';

export const title = 'Ambiental';
const ui = { aba: new URLSearchParams(location.hash.split('?')[1] || '').get('aba') || 'residuos', ano: String(new Date().getFullYear()) };
const n3 = (v) => v == null || v === '' ? '' : String(+v).replace('.', ',');

export async function render(root) {
  root.innerHTML = `<div class="card toolbar"><div class="chips" id="am-abas">${[['residuos', 'Destinação de resíduos'], ['licencas', 'Licenças e documentos']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}">${t}</span>`).join('')}</div>
    <span class="spacer"></span><span id="am-acoes"></span></div><div id="am-c" style="margin-top:12px"><div class="loading">Carregando…</div></div>`;
  $('#am-abas', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  const c = $('#am-c', root);
  try {
    const R = await carregarRec();
    if (desligada(R)) { c.innerHTML = avisoDesligada(); return; }
    if (ui.aba === 'residuos') await residuos(c, R, root); else await licencas(c, R, root);
  } catch (err) { c.innerHTML = semSQL(err) ? avisoSQL : `<div class="card"><div class="empty">${esc(err.message)}</div></div>`; }
}

const anexos = (lista) => (lista || []).map((a, k) => `<a href="#" data-arq="${k}">${esc(a.nome || 'arquivo ' + (k + 1))}</a>`).join(' · ');
const abrirAnexo = async (a) => { try { const { data, error } = await sb.storage.from('recuperadora').createSignedUrl(a.path, 300); if (error) throw error; window.open(data.signedUrl, '_blank', 'noopener'); } catch (err) { fail(err); } };
async function subir(files, pasta) {
  const out = [];
  for (const f of files) { if (f.size > 8 * 1024 * 1024) { toast(`${f.name}: até 8 MB`, true); continue; }
    const path = `${state.empresa.id}/${pasta}/${Date.now()}-${f.name.replace(/[^\w.-]+/g, '_')}`;
    const { error } = await sb.storage.from('recuperadora').upload(path, f, { contentType: f.type || 'application/pdf' }); if (error) throw error;
    out.push({ path, nome: f.name, em: new Date().toISOString() }); }
  return out;
}

async function residuos(c, R, root) {
  const e = state.empresa.id, pode = podeConfig();
  const L = await q(sb.from('rec_residuos').select('*').eq('empresa_id', e).gte('data', ui.ano + '-01-01').lte('data', ui.ano + '-12-31').order('data', { ascending: false }));
  $('#am-acoes', root).innerHTML = `<label class="small">Ano <select id="am-ano">${[0, 1, 2].map(i => String(new Date().getFullYear() - i)).map(a => `<option ${a === ui.ano ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
    <button class="btn" id="am-x">Excel</button>${pode ? ' <button class="btn primary" id="am-n">+ Destinação</button>' : ''}`;
  const sem = L.filter(x => !x.cdf_numero);
  c.innerHTML = `<div class="kpis">${kpi('Destinado no ano', kg0(L.reduce((s, x) => s + +x.kg, 0)), `${L.length} envio(s)`)}${kpi('Sem CDF', kg0(sem.reduce((s, x) => s + +x.kg, 0)), `${sem.length} envio(s)`, sem.length ? 'warn' : '')}
      ${kpi('Custo da destinação', money(L.reduce((s, x) => s + +x.valor, 0)))}</div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap" id="am-t" style="max-height:62vh"><table><thead><tr><th>Data</th><th>Resíduo</th><th class="num">kg</th><th>Transportador / destinador</th><th>MTR</th><th>CDF</th><th class="num">Custo</th></tr></thead><tbody>
      ${L.map(x => `<tr class="${pode ? 'clickable' : ''}" data-id="${x.id}"><td>${dateBR(x.data)}</td><td>${esc(TIPOS_RESIDUO[x.tipo] || x.tipo)}${x.destinacao ? `<div class="small muted">${esc(x.destinacao)}</div>` : ''}</td><td class="num">${n3(x.kg)}</td>
        <td class="small">${esc(R.fornById[x.transportador_id]?.nome || '—')}<br>${esc(R.fornById[x.destinador_id]?.nome || '—')}</td><td>${esc(x.mtr_numero || '—')}</td>
        <td>${x.cdf_numero ? `${esc(x.cdf_numero)}<div class="small muted">${dateBR(x.cdf_data)}</div>` : '<span class="badge negoc">aguardando</span>'}</td><td class="num">${+x.valor ? money(x.valor) : '–'}</td></tr>`).join('')
        || '<tr><td colspan="7" class="empty">Nenhuma destinação no ano. Registre cada envio de rejeito, lodo ou borra com o MTR; depois, o CDF.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">MTR: Manifesto de Transporte de Resíduos (SINIR). CDF: Certificado de Destinação Final, emitido pelo destinador. Com valor e a conta de resíduos nos parâmetros, a destinação gera o título a pagar.</p>`;
  $('#am-ano', root).onchange = (ev) => { ui.ano = ev.target.value; render(root); };
  $('#am-x', root).onclick = () => exportXLSX($('#am-t table', c), `destinacao_residuos_${ui.ano}`);
  const abrir = (x = {}) => {
    const fs = R.forn.filter(f => f.ativo || f.id === x.transportador_id || f.id === x.destinador_id), opt = (sel) => `<option value="">—</option>${fs.map(f => `<option value="${f.id}" ${f.id === sel ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}`;
    let arqs = [...(x.arquivos || [])];
    const md = modal({ title: x.id ? 'Destinação de resíduo' : 'Nova destinação', wide: true, body: `<form id="rf" class="grid-form">
        <label class="c4">Data<input type="date" name="d" value="${x.data || today()}"></label><label class="c4">Resíduo<select name="t">${Object.entries(TIPOS_RESIDUO).map(([k, t]) => `<option value="${k}" ${x.tipo === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="c4">Peso (kg) *<input name="kg" inputmode="decimal" value="${n3(x.kg)}"></label><label class="c4">Destinação<input name="ds" value="${esc(x.destinacao || '')}" list="am-dl"><datalist id="am-dl"><option>Aterro industrial<option>Coprocessamento<option>Reciclagem<option>Incineração<option>Tratamento de efluentes</datalist></label>
        <label class="span2">Transportador<select name="tr">${opt(x.transportador_id)}</select></label><label class="span2">Destinador<select name="de">${opt(x.destinador_id)}</select></label>
        <label class="c4">MTR (número)<input name="mtr" value="${esc(x.mtr_numero || '')}"></label><label class="c4">Data do MTR<input type="date" name="mtrd" value="${x.mtr_data || ''}"></label>
        <label class="c4">CDF (número)<input name="cdf" value="${esc(x.cdf_numero || '')}"></label><label class="c4">Data do CDF<input type="date" name="cdfd" value="${x.cdf_data || ''}"></label>
        <label class="c4">Custo (R$)<input name="v" inputmode="decimal" value="${+x.valor ? money(x.valor) : ''}" ${x.lancamento_id ? 'disabled title="já gerou o título a pagar"' : ''}></label><label class="span2">Observação<input name="o" value="${esc(x.observacao || '')}"></label></form>
      <div style="margin-top:8px"><b class="small">Anexos (MTR, CDF, fotos)</b> <span id="rf-arq" class="small">${anexos(arqs) || '<span class="muted">nenhum</span>'}</span> <label class="btn sm" style="margin-left:6px">+ Arquivo<input type="file" id="rf-up" multiple accept="application/pdf,image/*" hidden></label></div>
      ${x.lancamento_id ? '<p class="small muted">O título a pagar desta destinação está nos Lançamentos.</p>' : R.cfg.plano_residuos_id ? '' : '<p class="small muted">Sem a conta de resíduos nos parâmetros: o custo fica só no registro, sem título a pagar.</p>'}`,
      foot: `${x.id ? '<button class="btn danger" id="rf-del">Excluir</button>' : ''}<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="rf-ok">Salvar</button>` });
    const ligar = () => $$('[data-arq]', md.el).forEach(a => a.onclick = (ev) => { ev.preventDefault(); abrirAnexo(arqs[+a.dataset.arq]); }); ligar();
    $('#rf-up', md.el).onchange = async (ev) => { try { arqs = arqs.concat(await subir(ev.target.files, 'residuos')); $('#rf-arq', md.el).innerHTML = anexos(arqs); ligar(); } catch (err) { fail(err); } };
    $('#rf-ok', md.el).onclick = async (ev) => { const f = $('#rf', md.el), kgv = parseNum(f.kg.value); if (!(kgv > 0)) return toast('Informe o peso', true); ev.target.disabled = true;
      const v = { empresa_id: state.empresa.id, data: f.d.value || today(), tipo: f.t.value, kg: kgv, destinacao: f.ds.value.trim() || null, transportador_id: f.tr.value || null, destinador_id: f.de.value || null,
        mtr_numero: f.mtr.value.trim() || null, mtr_data: f.mtrd.value || null, cdf_numero: f.cdf.value.trim() || null, cdf_data: f.cdfd.value || null, observacao: f.o.value.trim() || null, arquivos: arqs,
        ...(x.lancamento_id ? {} : { valor: parseNum(f.v.value) || 0 }) };
      try { await q(x.id ? sb.from('rec_residuos').update(v).eq('id', x.id) : sb.from('rec_residuos').insert(v)); md.close(); toast('Destinação salva'); render(root); } catch (err) { ev.target.disabled = false; fail(err); } };
    $('#rf-del', md.el) && ($('#rf-del', md.el).onclick = async () => { if (!await confirmDialog('Excluir esta destinação? O título a pagar em aberto, se houver, continua nos Lançamentos.')) return;
      try { await q(sb.from('rec_residuos').delete().eq('id', x.id)); md.close(); render(root); } catch (err) { fail(err); } });
  };
  $('#am-n', root) && ($('#am-n', root).onclick = () => abrir());
  c.querySelector('tbody').onclick = (ev) => { const id = ev.target.closest('tr[data-id]')?.dataset.id; if (id && pode) abrir(L.find(x => x.id === id)); };
}

async function licencas(c, R, root) {
  const e = state.empresa.id, pode = podeConfig(), hoje = today(), ant = +R.cfg.licenca_antecedencia_dias || 60;
  const L = await q(sb.from('rec_licencas').select('*').eq('empresa_id', e).order('validade', { nullsFirst: false }));
  $('#am-acoes', root).innerHTML = pode ? '<button class="btn primary" id="am-nl">+ Licença ou documento</button>' : '';
  const S = L.map(l => ({ ...l, s: situacaoLicenca(l, hoje, ant) }));
  c.innerHTML = `<div class="kpis">${kpi('Vencidas', S.filter(x => x.ativo && x.s.k === 'vencida').length, '', S.some(x => x.ativo && x.s.k === 'vencida') ? 'neg' : '')}${kpi('A vencer', S.filter(x => x.ativo && x.s.k === 'avencer').length, `dentro de ${ant} dias (padrão)`, S.some(x => x.ativo && x.s.k === 'avencer') ? 'warn' : '')}
      ${kpi('Em dia', S.filter(x => x.ativo && x.s.k === 'ok').length)}</div>
    <div class="card flush" style="margin-top:12px"><div class="table-wrap"><table><thead><tr><th>Documento</th><th>Número</th><th>Órgão</th><th>Emissão</th><th>Validade</th><th>Situação</th><th>Anexos</th></tr></thead><tbody>
      ${S.map(l => `<tr class="${pode ? 'clickable' : ''}" data-id="${l.id}"><td><b>${esc(l.tipo)}</b>${l.ativo ? '' : ' <span class="badge">inativa</span>'}${l.observacao ? `<div class="small muted">${esc(l.observacao)}</div>` : ''}</td><td>${esc(l.numero || '')}</td><td>${esc(l.orgao || '')}</td>
        <td>${dateBR(l.emissao)}</td><td>${dateBR(l.validade)}</td><td><span class="badge ${l.s.k === 'vencida' ? 'vencido' : l.s.k === 'avencer' ? 'negoc' : l.s.k === 'ok' ? 'pago' : ''}">${l.s.txt}</span></td>
        <td class="small">${(l.arquivos || []).length ? (l.arquivos || []).length + ' arquivo(s)' : '—'}</td></tr>`).join('')
        || '<tr><td colspan="7" class="empty">Nenhuma licença. Cadastre a Licença de Operação, o CTF/IBAMA, a outorga de água, o AVCB e os demais documentos com validade.</td></tr>'}</tbody></table></div></div>
    <p class="small muted">O administrador e o diretor recebem um aviso quando a licença entra na antecedência (do documento ou dos parâmetros) e outro quando vence; a Central de Decisões mostra as vencidas e as que estão para vencer.</p>`;
  const abrir = (l = {}) => {
    let arqs = [...(l.arquivos || [])];
    const md = modal({ title: l.id ? 'Licença ou documento' : 'Nova licença ou documento', body: `<form id="lf" class="grid2"><label class="span2">Documento *<input name="t" required list="am-lt" value="${esc(l.tipo || '')}"><datalist id="am-lt">
        <option>Licença de Operação (LO)<option>Licença de Instalação (LI)<option>Licença Prévia (LP)<option>Cadastro Técnico Federal (CTF/IBAMA)<option>Outorga de uso de água<option>Licença de lançamento de efluentes<option>AVCB (Corpo de Bombeiros)<option>Alvará de funcionamento<option>Certificado de regularidade (CR/IBAMA)</datalist></label>
        <label>Número<input name="n" value="${esc(l.numero || '')}"></label><label>Órgão<input name="o" value="${esc(l.orgao || '')}" placeholder="CPRH, IBAMA, APAC…"></label>
        <label>Emissão<input type="date" name="em" value="${l.emissao || ''}"></label><label>Validade<input type="date" name="va" value="${l.validade || ''}"></label>
        <label>Avisar com (dias)<input type="number" name="an" min="1" max="365" value="${l.antecedencia_dias ?? ''}" placeholder="padrão ${ant}"></label><label class="chk"><input type="checkbox" name="at" ${l.ativo !== false ? 'checked' : ''}> Ativa</label>
        <label class="span2">Observação / condicionantes<input name="ob" value="${esc(l.observacao || '')}"></label></form>
      <div style="margin-top:8px"><b class="small">Anexos</b> <span id="lf-arq" class="small">${anexos(arqs) || '<span class="muted">nenhum</span>'}</span> <label class="btn sm" style="margin-left:6px">+ Arquivo<input type="file" id="lf-up" multiple accept="application/pdf,image/*" hidden></label></div>`,
      foot: `${l.id ? '<button class="btn danger" id="lf-del">Excluir</button>' : ''}<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="lf-ok">Salvar</button>` });
    const ligar = () => $$('[data-arq]', md.el).forEach(a => a.onclick = (ev) => { ev.preventDefault(); abrirAnexo(arqs[+a.dataset.arq]); }); ligar();
    $('#lf-up', md.el).onchange = async (ev) => { try { arqs = arqs.concat(await subir(ev.target.files, 'licencas')); $('#lf-arq', md.el).innerHTML = anexos(arqs); ligar(); } catch (err) { fail(err); } };
    $('#lf-ok', md.el).onclick = async () => { const f = $('#lf', md.el); if (!f.reportValidity()) return;
      const v = { empresa_id: e, tipo: f.t.value.trim(), numero: f.n.value.trim() || null, orgao: f.o.value.trim() || null, emissao: f.em.value || null, validade: f.va.value || null,
        antecedencia_dias: f.an.value ? Math.max(1, Math.min(365, +f.an.value)) : null, observacao: f.ob.value.trim() || null, ativo: f.at.checked, arquivos: arqs };
      try { await q(l.id ? sb.from('rec_licencas').update(v).eq('id', l.id) : sb.from('rec_licencas').insert(v)); md.close(); toast('Salvo'); render(root); } catch (err) { fail(err); } };
    $('#lf-del', md.el) && ($('#lf-del', md.el).onclick = async () => { if (!await confirmDialog('Excluir este documento?')) return; try { await q(sb.from('rec_licencas').delete().eq('id', l.id)); md.close(); render(root); } catch (err) { fail(err); } });
  };
  $('#am-nl', root) && ($('#am-nl', root).onclick = () => abrir());
  c.querySelector('tbody').onclick = (ev) => { const id = ev.target.closest('tr[data-id]')?.dataset.id; if (id && pode) abrir(L.find(x => x.id === id)); };
}
