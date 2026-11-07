// Manutenção (SQL 086) — dados e ficha da OS, usados pelo Painel, Ordens de Serviço, Equipamentos e pelo celular.
import { sb, state, q, fetchAll, loadCadastros, podeEditar } from './data.js';
import { $, $$, esc, toast, fail, modal, confirmDialog, today, dateBR, money, options, parseNum } from './ui.js';
import { abrirRelatorio } from './relatorio.js';
import { podePCP, podeApontar } from './producao.js';
import * as M from './manutencao.js';

export { podePCP, podeApontar };
export const BUCKET = 'manutencao';
const nf = (v, c = 1) => v == null || v === '' ? '–' : (+v).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
const hora = (t) => t ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
export const dtLocal = (t) => { if (!t) return ''; const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
export const deLocal = (v) => v ? new Date(v).toISOString() : null;

/** carrega tudo o que as telas de manutenção usam (OS dos últimos 13 meses + todas as abertas) */
export async function carregarManutencao({ meses = 13 } = {}) {
  const e = state.empresa.id; await loadCadastros();
  const desde = new Date(); desde.setMonth(desde.getMonth() - meses);
  const seg = (p, v = []) => p.catch(() => v);
  const [Pm, E, Pl, F, O1, O2, S, Mq, Pr] = await Promise.all([
    q(sb.from('man_parametros').select('*').eq('empresa_id', e)),
    q(sb.from('man_equipamentos').select('*').eq('empresa_id', e).order('codigo')),
    q(sb.from('man_planos').select('*').eq('empresa_id', e).order('nome')),
    q(sb.from('man_falhas').select('*').eq('empresa_id', e).order('codigo')),
    fetchAll(() => sb.from('man_ordens').select('*').eq('empresa_id', e).gte('solicitada_em', desde.toISOString()).order('numero', { ascending: false })),
    q(sb.from('man_ordens').select('*').eq('empresa_id', e).in('situacao', M.ABERTAS).order('numero', { ascending: false })),
    seg(q(sb.from('prod_setores').select('id,nome').eq('empresa_id', e).order('nome'))),
    seg(q(sb.from('prod_maquinas').select('id,codigo,nome,setor_id,ativo').eq('empresa_id', e).order('codigo'))),
    seg(fetchAll(() => sb.from('produtos').select('id,codigo,descricao,unidade,tipo,local_padrao_id').eq('empresa_id', e).eq('ativo', true).in('tipo', ['peca_manutencao', 'uso_consumo', 'outro']).order('descricao'))),
  ]);
  const O = [...new Map([...O1, ...O2].map(o => [o.id, o])).values()].sort((a, b) => b.numero - a.numero);
  const ids = O.map(o => o.id);
  const H = [], P = [];
  for (let i = 0; i < ids.length; i += 150) {
    const fatia = ids.slice(i, i + 150);
    const [h, p] = await Promise.all([q(sb.from('man_os_horas').select('*').in('ordem_id', fatia)), q(sb.from('man_os_pecas').select('*').in('ordem_id', fatia))]);
    H.push(...h); P.push(...p);
  }
  const horasEq = {};
  await Promise.all(E.filter(x => x.situacao !== 'inativo' && (x.maquina_id || x.horimetro != null)).slice(0, 80).map(async (x) => {
    horasEq[x.id] = +(await q(sb.rpc('man_horas_maquina', { p_equipamento: x.id })).catch(() => 0)) || 0;
  }));
  const D = { P: Pm[0] || { custo_hora: 0, tolerancia_pct: 10, antecedencia_dias: 7, horas_dia: 24, abrir_os_pela_parada: true }, E, Pl, F, O, H, Pc: P, S, Mq, Pr, horasEq,
    eById: Object.fromEntries(E.map(x => [x.id, x])), fById: Object.fromEntries(F.map(x => [x.id, x])), prById: Object.fromEntries(Pr.map(x => [x.id, x])), semConfig: !Pm[0] };
  return D;
}
export const nomeEq = (D, id) => { const e = D.eById[id]; return e ? `${e.codigo} · ${e.nome}` : '—'; };
export const selo = (txt, cls = '') => `<span class="mn-sel ${cls}">${esc(txt)}</span>`;
export const clsSit = (s) => ({ solicitada: 'warn', aberta: 'warn', programada: '', em_execucao: 'info', aguardando_peca: 'warn', aguardando_terceiro: 'warn', concluida: 'pos', cancelada: 'muted' }[s] || '');
export const clsPrio = (p) => ({ emergencia: 'neg', alta: 'warn', media: '', baixa: 'muted' }[p] || '');
export const CSS = `<style>
  .mn-sel{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;background:var(--primary-soft);white-space:nowrap}
  .mn-sel.pos{background:color-mix(in srgb,var(--pos) 14%,transparent);color:var(--pos)}.mn-sel.warn{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
  .mn-sel.neg{background:color-mix(in srgb,var(--neg) 14%,transparent);color:var(--neg)}.mn-sel.info{background:color-mix(in srgb,var(--brand-cyan) 14%,transparent);color:var(--brand-cyan)}.mn-sel.muted{color:var(--muted)}
  .mn-check{display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)}.mn-check input[type=text]{flex:1}
  .mn-k{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
  .mn-col{background:var(--bg);border-radius:10px;padding:8px;min-height:80px}.mn-card{background:var(--surface);border:1px solid var(--border);border-left:4px solid var(--border);border-radius:8px;padding:8px;margin-bottom:8px;cursor:pointer}
  .mn-card.c-neg{border-left-color:var(--neg)}.mn-card.c-warn{border-left-color:var(--warn)}.mn-kanban{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}@media(max-width:900px){.mn-kanban{grid-template-columns:1fr}}
  .mn-kpis6{grid-template-columns:repeat(6,minmax(0,1fr))!important}@media(max-width:1100px){.mn-kpis6{grid-template-columns:repeat(3,minmax(0,1fr))!important}}@media(max-width:600px){.mn-kpis6{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
  .card label.chk{flex-direction:row;align-items:center;gap:8px;font-weight:400;color:var(--text);font-size:13px}.card label.chk input{width:auto;min-height:0}
  .mm-topo .mn-acoes{display:flex;gap:8px;align-items:end;flex-wrap:nowrap;white-space:nowrap}
</style>`;

/** nova OS (ou solicitação) */
export function novaOS(D, { pre = {}, onSalvo, solicitacao = false } = {}) {
  const eqs = D.E.filter(e => e.situacao !== 'inativo');
  const md = modal({ title: solicitacao ? 'Pedir manutenção' : 'Nova ordem de serviço', body: `<form id="no"><div class="grid-form">
    <label class="span2">Equipamento *<select name="eq" required>${options(eqs.map(e => ({ id: e.id, nome: `${e.codigo} · ${e.nome}` })), { selected: pre.equipamento_id, empty: '— escolha —' })}</select></label>
    ${solicitacao ? '' : `<label>Tipo<select name="tipo">${Object.entries(M.TIPOS_OS).map(([k, t]) => `<option value="${k}" ${(pre.tipo || 'corretiva') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`}
    <label class="full">O que está acontecendo? *<textarea name="desc" rows="3" required placeholder="Ex.: barulho no redutor da extrusora, temperatura da zona 3 não sobe">${esc(pre.descricao || '')}</textarea></label>
    <label class="${solicitacao ? '' : 'xs'}">Prioridade<select name="prio">${Object.entries(M.PRIORIDADES).map(([k, t]) => `<option value="${k}" ${(pre.prioridade || 'media') === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    ${solicitacao ? '' : `<label class="xs">Programar para<input type="date" name="prog" value="${pre.programada_para || ''}"></label><label>Responsável<input name="resp" value="${esc(pre.responsavel || '')}"></label>`}
  </div><label class="chk" style="margin-top:12px;display:flex;gap:8px;align-items:center"><input type="checkbox" name="parou" ${pre.maquina_parou ? 'checked' : ''}> A máquina está parada por causa disso (conta como parada de manutenção até a OS ser concluída)</label></form>`, foot: `<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" id="no-ok">${solicitacao ? 'Enviar pedido' : 'Abrir OS'}</button>` });
  $('#no-ok', md.el).onclick = async () => {
    const f = $('#no', md.el); if (!f.reportValidity()) return;
    const reg = { empresa_id: state.empresa.id, equipamento_id: f.eq.value, tipo: f.tipo?.value || 'corretiva', origem: solicitacao ? 'solicitacao' : 'manual', prioridade: f.prio.value,
      situacao: solicitacao ? 'solicitada' : (f.prog?.value ? 'programada' : 'aberta'), descricao: f.desc.value.trim(), maquina_parou: f.parou.checked,
      programada_para: f.prog?.value || null, responsavel: f.resp?.value.trim() || null, solicitante: state.user?.email || null };
    if (reg.maquina_parou) reg.parada_inicio = new Date().toISOString();
    try { const [o] = await q(sb.from('man_ordens').insert(reg).select()); md.close(); toast(solicitacao ? `Pedido enviado: OS ${o.numero}` : `OS ${o.numero} aberta`); onSalvo?.(o); } catch (e) { fail(e); }
  };
}

/** ficha da OS: dados, execução (checklist, falha, causa, solução), horas, peças, terceiros, anexos */
export async function fichaOS(D, o, { onMudou } = {}) {
  const exe = podeApontar(), ger = podePCP(), aberta = M.ABERTAS.includes(o.situacao);
  const [H, P, A] = await Promise.all([q(sb.from('man_os_horas').select('*').eq('ordem_id', o.id).order('data')), q(sb.from('man_os_pecas').select('*').eq('ordem_id', o.id).order('criado_em')),
    q(sb.from('man_anexos').select('*').eq('ordem_id', o.id).order('criado_em')).catch(() => [])]);
  const c = M.custoOS(o, H, P, +D.P.custo_hora || 0), eq = D.eById[o.equipamento_id];
  const ck = Array.isArray(o.checklist) ? o.checklist.map(x => ({ ...x })) : [];
  const md = modal({ title: `OS ${o.numero} — ${nomeEq(D, o.equipamento_id)}`, wide: true, body: `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${selo(M.SITUACOES[o.situacao], clsSit(o.situacao))}${selo(M.PRIORIDADES[o.prioridade], clsPrio(o.prioridade))}${selo(M.TIPOS_OS[o.tipo])}
      ${o.maquina_parou ? selo('Máquina parada', 'neg') : ''}${M.atrasada(o) ? selo('Atrasada', 'neg') : ''}<span class="muted small">Aberta ${hora(o.solicitada_em)} por ${esc(o.solicitante || '')} · origem ${esc(o.origem)}</span></div>
    <p style="margin:10px 0">${esc(o.descricao)}</p>
    <div class="kpis">${['Peças', 'Mão de obra', 'Terceiros', 'Custo total'].map((t, i) => `<div class="kpi"><div class="k-label">${t}</div><div class="k-value">${money([c.pecas, c.mao, c.terceiros, c.total][i])}</div>${i === 1 ? `<div class="k-sub">${nf(c.horas)} h</div>` : ''}</div>`).join('')}
      <div class="kpi"><div class="k-label">Máquina parada</div><div class="k-value">${o.maquina_parou ? nf(M.horasEntre(o.parada_inicio || o.solicitada_em, o.parada_fim || o.fim)) + ' h' : '–'}</div></div></div>
    <div class="chips" id="fo-abas" style="margin:14px 0 8px">${[['exe', 'Execução'], ['horas', `Horas (${H.length})`], ['pecas', `Peças (${P.filter(x => x.situacao !== 'estornada').length})`], ['ter', 'Terceiros'], ['anx', `Fotos e anexos (${A.length})`]].map(([k, t], i) => `<span class="chip ${i ? '' : 'on'}" data-t="${k}">${t}</span>`).join('')}</div>
    <div data-p="exe"><form id="fo"><div class="grid-form">
      <label>Responsável<input name="resp" value="${esc(o.responsavel || '')}" ${aberta && exe ? '' : 'disabled'}></label>
      <label class="xs">Programada<input type="date" name="prog" value="${o.programada_para || ''}" ${aberta && exe ? '' : 'disabled'}></label>
      <label class="xs">Início<input type="datetime-local" name="ini" value="${dtLocal(o.inicio)}" ${exe && (aberta || ger) ? '' : 'disabled'}></label>
      <label class="xs">Fim<input type="datetime-local" name="fim" value="${dtLocal(o.fim)}" ${exe && (aberta || ger) ? '' : 'disabled'}></label>
      <label class="chk xs"><input type="checkbox" name="parou" ${o.maquina_parou ? 'checked' : ''} ${aberta && exe ? '' : 'disabled'}> Máquina parou</label>
      <label class="xs">Parada desde<input type="datetime-local" name="pini" value="${dtLocal(o.parada_inicio)}" ${exe && (aberta || ger) ? '' : 'disabled'}></label>
      <label class="xs">Voltou a operar<input type="datetime-local" name="pfim" value="${dtLocal(o.parada_fim)}" ${exe && (aberta || ger) ? '' : 'disabled'}></label>
      <label class="c4">Falha<select name="falha" ${exe ? '' : 'disabled'}><option value="">—</option>${Object.entries(M.CATEGORIAS).map(([k, t]) => { const fs = D.F.filter(f => f.categoria === k && (f.ativo || f.id === o.falha_id)); return fs.length ? `<optgroup label="${t}">${fs.map(f => `<option value="${f.id}" ${o.falha_id === f.id ? 'selected' : ''}>${esc(f.codigo)} · ${esc(f.nome)}</option>`).join('')}</optgroup>` : ''; }).join('')}</select></label>
      <label class="span2">Causa<textarea name="causa" rows="2" ${exe ? '' : 'disabled'}>${esc(o.causa || '')}</textarea></label>
      <label class="span2">O que foi feito<textarea name="sol" rows="2" ${exe ? '' : 'disabled'}>${esc(o.solucao || '')}</textarea></label>
    </div></form>
    ${ck.length ? `<h4 style="margin:12px 0 4px">Checklist</h4><div id="fo-ck">${ck.map((x, i) => `<div class="mn-check"><select data-ck="${i}" ${aberta && exe ? '' : 'disabled'} style="width:110px"><option value="">—</option><option value="ok" ${x.ok === true ? 'selected' : ''}>✔ Feito</option><option value="nao" ${x.ok === false ? 'selected' : ''}>✕ Não feito</option></select>
      <span style="flex:1">${esc(x.item)}</span><input type="text" data-cko="${i}" value="${esc(x.obs || '')}" placeholder="Observação" ${aberta && exe ? '' : 'disabled'}></div>`).join('')}</div>` : ''}
    ${o.situacao === 'cancelada' ? `<p class="muted">Cancelada: ${esc(o.motivo_cancelamento || '')}</p>` : ''}</div>
    <div data-p="horas" hidden>${aberta && exe ? `<div class="grid-form" style="align-items:end"><label>Técnico<input id="fh-t" value="${esc(state.user?.user_metadata?.nome || state.user?.email || '')}"></label><label class="xs">Data<input type="date" id="fh-d" value="${today()}"></label>
      <label class="xs">Horas<input id="fh-h" inputmode="decimal" placeholder="1,5"></label><label class="span2">O que fez<input id="fh-x"></label><div style="display:flex;align-items:end"><button class="btn" id="fh-ok" type="button">Registrar horas</button></div></div>` : ''}
      <div class="table-wrap"><table><tr><th>Data</th><th>Técnico</th><th class="num">Horas</th><th>Descrição</th></tr>${H.map(h => `<tr><td>${dateBR(h.data)}</td><td>${esc(h.tecnico)}</td><td class="num">${nf(h.horas)}</td><td class="wrap">${esc(h.descricao || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Sem horas registradas.</td></tr>'}</table></div>
      <p class="muted small">Custo da hora interna: ${money(D.P.custo_hora)} (Equipamentos e Planos › Parâmetros).</p></div>
    <div data-p="pecas" hidden>${aberta && exe ? `<div class="grid-form" style="align-items:end"><label class="span2">Peça ou material<select id="fp-p">${options(D.Pr.map(p => ({ id: p.id, nome: `${p.codigo} · ${p.descricao} (${p.unidade})` })), { empty: '— escolha —' })}</select></label>
      <div style="display:flex;gap:6px;align-items:end"><label style="flex:1;min-width:0">Quantidade<input id="fp-q" inputmode="decimal"></label><button class="btn" id="fp-ok" type="button">Usar na OS</button></div></div>
      <p class="muted small">Sai do estoque oficial (requisição interna, custo médio, centro de custo do equipamento). Antes da implantação do estoque, fica registrada pelo último custo de compra.</p>` : ''}
      <div class="table-wrap"><table><tr><th>Peça</th><th class="num">Qtd.</th><th class="num">Custo</th><th>Situação</th><th></th></tr>${P.map(p => { const pr = D.prById[p.produto_id]; return `<tr><td class="wrap">${esc(pr ? `${pr.codigo} · ${pr.descricao}` : p.produto_id)}</td><td class="num">${nf(p.quantidade, 2)}</td><td class="num">${money(p.custo)}</td>
        <td>${p.situacao === 'estornada' ? selo('Estornada', 'muted') : p.movimento_id ? selo('Baixada do estoque', 'pos') : selo('Registrada (sem estoque)')}</td><td>${p.situacao === 'consumida' && exe && (aberta || ger) ? `<button class="btn small ghost" data-est="${p.id}">Estornar</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">Nenhuma peça.</td></tr>'}</table></div></div>
    <div data-p="ter" hidden><div class="grid-form">
      <label class="span2">Prestador<select id="ft-f" ${exe ? '' : 'disabled'}>${options(state.cad.favorecidos, { label: 'label', selected: o.favorecido_id, empty: '—' })}</select></label>
      <label class="xs">Valor (R$)<input id="ft-v" inputmode="decimal" value="${+o.valor_terceiros ? nf(o.valor_terceiros, 2) : ''}" ${exe ? '' : 'disabled'}></label>
      ${o.lancamento_id ? '<div class="span2 small" style="align-self:end;padding-bottom:8px">✔ Conta a pagar lançada no fluxo.</div>' : podeEditar() ? `<label class="c4">Conta do plano (conta a pagar)<select id="ft-p">${options(state.cad.contasPlano, { value: 'id', label: 'label', selected: state.cad.contasPlano.find(p => /MANUTEN/i.test(p.nome))?.id, empty: '— não lançar —' })}</select></label>
        <label class="xs">Vencimento<input type="date" id="ft-d" value="${today()}"></label>` : ''}
    </div><p class="muted small">Serviço de terceiro (oficina, assistência técnica). Com a conta do plano escolhida, ao salvar entra um lançamento "Em aberto" no fluxo de caixa.</p></div>
    <div data-p="anx" hidden>${exe ? '<div class="toolbar"><input type="file" id="fa-a" accept="image/*,application/pdf" capture="environment" multiple><button class="btn small" id="fa-ok" type="button">Enviar</button></div>' : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap">${A.map(a => `<a href="#" data-ver="${esc(a.caminho)}" class="btn small ghost">📎 ${esc(a.nome)}</a>`).join('') || '<span class="muted">Sem anexos.</span>'}</div></div>`,
    foot: `${ger && aberta ? '<button class="btn danger" id="fo-canc">Cancelar OS</button>' : ''}<span class="spacer"></span><button class="btn" id="fo-imp">Imprimir OS</button>
      ${exe && aberta ? `${o.situacao !== 'em_execucao' ? '<button class="btn" id="fo-ini">▶ Iniciar</button>' : '<button class="btn" id="fo-peca">Aguardando peça</button><button class="btn" id="fo-terc">Aguardando terceiro</button>'}
        <button class="btn" id="fo-salva">Salvar</button><button class="btn primary" id="fo-concl">✔ Concluir</button>` : exe ? '<button class="btn primary" id="fo-salva">Salvar</button>' : ''}` });
  const el = md.el, recarregar = async () => { md.close(); onMudou?.(); };
  $('#fo-abas', el).onclick = (ev) => { const t = ev.target.closest('[data-t]')?.dataset.t; if (!t) return; $$('#fo-abas .chip', el).forEach(x => x.classList.toggle('on', x.dataset.t === t)); $$('[data-p]', el).forEach(x => { x.hidden = x.dataset.p !== t; }); };
  const ler = () => {
    const f = $('#fo', el), reg = {};
    if (!f.resp.disabled) { reg.responsavel = f.resp.value.trim() || null; reg.programada_para = f.prog.value || null; reg.maquina_parou = f.parou.checked; }
    if (!f.ini.disabled) { reg.inicio = deLocal(f.ini.value); reg.fim = deLocal(f.fim.value); reg.parada_inicio = deLocal(f.pini.value); reg.parada_fim = deLocal(f.pfim.value); }
    if (!f.falha.disabled) { reg.falha_id = f.falha.value || null; reg.causa = f.causa.value.trim() || null; reg.solucao = f.sol.value.trim() || null; }
    if (ck.length) { $$('[data-ck]', el).forEach(x => { const v = x.value; ck[+x.dataset.ck].ok = v === 'ok' ? true : v === 'nao' ? false : null; }); $$('[data-cko]', el).forEach(x => { ck[+x.dataset.cko].obs = x.value.trim() || null; }); reg.checklist = ck; }
    const ft = $('#ft-v', el); if (ft && !ft.disabled) { reg.valor_terceiros = ft.value.trim() ? parseNum(ft.value) : 0; reg.favorecido_id = $('#ft-f', el).value || null; }
    return reg;
  };
  const salvar = async (extra = {}) => {
    const reg = { ...ler(), ...extra };
    // conta a pagar do serviço de terceiro
    const pl = $('#ft-p', el)?.value;
    if (!o.lancamento_id && pl && +reg.valor_terceiros > 0) {
      const [l] = await q(sb.from('lancamentos').insert({ empresa_id: state.empresa.id, data: $('#ft-d', el).value || today(), plano_id: pl, favorecido_id: reg.favorecido_id, valor: +reg.valor_terceiros, status: 'Em aberto',
        descricao: `OS ${o.numero} — ${(eq?.nome || '')} — ${o.descricao}`.slice(0, 250), documento: `OS ${o.numero}`, origem: 'manutencao', centro_custo_id: eq?.centro_custo_id || null }).select('id'));
      reg.lancamento_id = l.id;
    }
    await q(sb.from('man_ordens').update(reg).eq('id', o.id));
  };
  const b = (id, fn) => { const x = $(id, el); if (x) x.onclick = async () => { try { await fn(); } catch (e) { fail(e); } }; };
  b('#fo-salva', async () => { await salvar(); toast('OS salva'); recarregar(); });
  b('#fo-ini', async () => { await salvar({ situacao: 'em_execucao', inicio: o.inicio || new Date().toISOString() }); toast(`OS ${o.numero} em execução`); recarregar(); });
  b('#fo-peca', async () => { await salvar({ situacao: 'aguardando_peca' }); toast('Aguardando peça'); recarregar(); });
  b('#fo-terc', async () => { await salvar({ situacao: 'aguardando_terceiro' }); toast('Aguardando terceiro'); recarregar(); });
  b('#fo-concl', async () => {
    const reg = ler();
    if (o.tipo === 'corretiva' && !reg.solucao) { toast('Diga o que foi feito antes de concluir', true); return; }
    if (ck.some(x => x.ok == null) && !await confirmDialog('Há itens do checklist sem resposta. Concluir mesmo assim?')) return;
    await salvar({ situacao: 'concluida' }); toast(`OS ${o.numero} concluída${o.maquina_parou ? ' — a máquina voltou a operar' : ''}`); recarregar();
  });
  b('#fo-canc', async () => { const m = prompt('Motivo do cancelamento:'); if (!m?.trim()) return; await q(sb.from('man_ordens').update({ situacao: 'cancelada', motivo_cancelamento: m.trim() }).eq('id', o.id)); toast('OS cancelada'); recarregar(); });
  b('#fo-imp', async () => imprimirOS(D, o, H, P));
  b('#fh-ok', async () => {
    const h = parseNum($('#fh-h', el).value); if (!(h > 0)) return toast('Informe as horas', true);
    await q(sb.from('man_os_horas').insert({ empresa_id: state.empresa.id, ordem_id: o.id, tecnico: $('#fh-t', el).value.trim() || 'Técnico', data: $('#fh-d', el).value || today(), horas: h, custo_hora: +D.P.custo_hora || 0, descricao: $('#fh-x', el).value.trim() || null }));
    toast('Horas registradas'); md.close(); fichaOS(D, o, { onMudou });
  });
  b('#fp-ok', async () => {
    const p = $('#fp-p', el).value, qt = parseNum($('#fp-q', el).value); if (!p || !(qt > 0)) return toast('Escolha a peça e a quantidade', true);
    await q(sb.rpc('man_consumir_peca', { p_ordem: o.id, p_produto: p, p_qtd: qt, p_local: null })); toast('Peça lançada na OS'); md.close(); fichaOS(D, o, { onMudou });
  });
  $$('[data-est]', el).forEach(x => x.onclick = async () => { if (!await confirmDialog('Estornar esta peça? Ela volta para o estoque.')) return; try { await q(sb.rpc('man_estornar_peca', { p_peca: x.dataset.est, p_motivo: null })); toast('Peça estornada'); md.close(); fichaOS(D, o, { onMudou }); } catch (e) { fail(e); } });
  b('#fa-ok', async () => {
    const fs = [...$('#fa-a', el).files]; if (!fs.length) return toast('Escolha a foto ou o arquivo', true);
    for (const f of fs) { const cam = `${state.empresa.id}/os/${o.id}/${Date.now()}-${f.name.normalize('NFD').replace(/[^\w.-]+/g, '_')}`; const { error } = await sb.storage.from(BUCKET).upload(cam, f); if (error) throw error;
      await q(sb.from('man_anexos').insert({ empresa_id: state.empresa.id, ordem_id: o.id, caminho: cam, nome: f.name, tipo: f.type.startsWith('image/') ? 'foto' : 'documento' })); }
    toast('Enviado'); md.close(); fichaOS(D, o, { onMudou });
  });
  $$('[data-ver]', el).forEach(a => a.onclick = async (ev) => { ev.preventDefault(); try { const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(a.dataset.ver, 300); if (error) throw error; window.open(data.signedUrl, '_blank'); } catch (e) { fail(e); } });
}

const T = (cab, L, num = []) => `<table><thead><tr>${cab.map((h, i) => `<th${num.includes(i) ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${L.map(l => `<tr>${l.map((v, i) => `<td${num.includes(i) ? ' class="num"' : ''}>${v ?? ''}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cab.length}">—</td></tr>`}</tbody></table>`;
export function imprimirOS(D, o, H, P) {
  const eq = D.eById[o.equipamento_id] || {}, c = M.custoOS(o, H, P, +D.P.custo_hora || 0), f = D.fById[o.falha_id];
  abrirRelatorio({ nome: `OS ${o.numero}`, titulo: `ORDEM DE SERVIÇO DE MANUTENÇÃO Nº ${o.numero}`, subtitulo: `${esc(eq.codigo || '')} — ${esc(eq.nome || '')}`,
    extraCss: '.num{text-align:right} .ass{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:50px} .ass div{border-top:1px solid #000;padding-top:4px;text-align:center;font-size:10pt} .ck{font-family:monospace}',
    corpo: `<h2>1. Identificação</h2>${T(['Campo', 'Valor'], [['Tipo / prioridade', `${M.TIPOS_OS[o.tipo]} · ${M.PRIORIDADES[o.prioridade]}`], ['Situação', M.SITUACOES[o.situacao]], ['Aberta', `${hora(o.solicitada_em)} por ${esc(o.solicitante || '')} (${esc(o.origem)})`],
      ['Equipamento', `${esc(eq.codigo || '')} ${esc(eq.nome || '')} · criticidade ${eq.criticidade || ''}${eq.local ? ' · ' + esc(eq.local) : ''}`], ['Programada / vence', `${dateBR(o.programada_para) || '—'} / ${dateBR(o.vence_em) || '—'}`], ['Responsável', esc(o.responsavel || '')],
      ['Execução', `${hora(o.inicio) || '—'} a ${hora(o.fim) || '—'}`], ['Máquina parada', o.maquina_parou ? `${hora(o.parada_inicio)} a ${hora(o.parada_fim) || '—'}` : 'Não']])}
      <h2>2. Serviço</h2><p><b>Solicitação:</b> ${esc(o.descricao)}</p><p><b>Falha:</b> ${f ? esc(f.codigo + ' · ' + f.nome) : '—'}</p><p><b>Causa:</b> ${esc(o.causa || '—')}</p><p><b>O que foi feito:</b> ${esc(o.solucao || '—')}</p>
      ${(o.checklist || []).length ? `<h2>3. Checklist</h2>${T(['', 'Item', 'Observação'], o.checklist.map(x => [`<span class="ck">${x.ok === true ? '[X]' : x.ok === false ? '[ ]✕' : '[ ]'}</span>`, esc(x.item), esc(x.obs || '')]))}` : ''}
      <h2>${(o.checklist || []).length ? 4 : 3}. Recursos e custo</h2>${T(['Técnico', 'Data', 'Horas'], H.map(h => [esc(h.tecnico), dateBR(h.data), nf(h.horas)]), [2])}
      ${T(['Peça', 'Qtd.', 'Custo'], P.filter(p => p.situacao !== 'estornada').map(p => { const pr = D.prById[p.produto_id]; return [esc(pr ? pr.codigo + ' ' + pr.descricao : ''), nf(p.quantidade, 2), money(p.custo)]; }), [1, 2])}
      ${T(['Peças', 'Mão de obra', 'Terceiros', 'Total'], [[money(c.pecas), money(c.mao), money(c.terceiros), `<b>${money(c.total)}</b>`]], [0, 1, 2, 3])}
      <div class="ass"><div>Executante</div><div>Responsável pela produção (liberação da máquina)</div></div>`, rodape: 'Base: ordens de serviço da manutenção na plataforma' });
}
