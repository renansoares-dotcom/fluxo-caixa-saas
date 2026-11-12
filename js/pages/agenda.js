// Painéis › Agenda (PAI012, SQL 155): agenda única em calendário (mês, semana e lista) com tudo o que tem data na plataforma —
// compromissos próprios (hora, repetição, responsável, participantes, privado) e os itens das telas de origem (títulos,
// cheques, contatos, fechamento, contratos, cargas, frota, manutenção, qualidade, licenças, exames, férias), cada pessoa vendo
// só o que o perfil dela alcança. Saldo projetado por dia, e resolver / adiar (também arrastando) / delegar direto da agenda.
// Pedido do Renan em 12/11/2026.
import { sb, state, q, fetchAll, loadCadastros, temArea, temRH } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, money, dateBR, today, options, confirmDialog } from '../lib/ui.js';
import { FONTES, fonte, fontesVisiveis, TIPOS, REPETIR, DIAS, textoRepeticao, ocorrencias, itensTitulos, itensCheques, itensContatos, itensFechamento, itensContratos, itemSimples,
  filtrar, porDia, resumoDia, gradeMes, semanaDe, periodo, navegar, saldoPorDia, valorCurto, addDias, diaSemana } from '../lib/agenda.js';

export const title = 'Agenda';
const ls = (k, v) => { try { const x = localStorage.getItem(k); return x == null ? v : JSON.parse(x); } catch { return v; } };
const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } };
const ui = { visao: null, ref: null, dia: null, meus: false, busca: '', feitos: true, ocultas: null };
const CFG0 = { fontes_desligadas: [], semana_inicio: 0, fim_de_semana: true, saldo_dia: true, saldo_papeis: ['admin', 'diretor', 'financeiro'], saldo_cheques: true, vencidos_em_hoje: true, visao_padrao: 'mes' };
const CSS = `<style>
  .ag-topo{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.ag-topo h2{margin:0 4px;font-size:18px}.ag-topo h2::first-letter{text-transform:uppercase}.ag-topo input{min-height:36px}
  .ag-corpo{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:12px;align-items:start}@media(max-width:1150px){.ag-corpo{grid-template-columns:1fr}}
  .ag-fontes{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
  .ag-f{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border:1px solid var(--border);border-radius:999px;font-size:12px;cursor:pointer;background:var(--surface);user-select:none}
  .ag-f i,.ag-it i,.ag-g i{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block}.ag-f.off{opacity:.45;text-decoration:line-through}
  .ag-mes{display:grid;grid-template-columns:repeat(var(--cols),minmax(0,1fr));border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--surface)}
  .ag-cab{padding:6px 8px;font-size:11.5px;font-weight:600;color:var(--muted);text-transform:uppercase;border-bottom:1px solid var(--border);background:var(--surface-2)}
  .ag-dia{min-height:118px;padding:5px 6px 6px;border-right:1px solid var(--border);border-bottom:1px solid var(--border);cursor:pointer;display:flex;flex-direction:column;gap:3px;min-width:0}
  .ag-dia:hover{background:var(--surface-2)}.ag-dia.fora{opacity:.5}.ag-dia.sel{box-shadow:inset 0 0 0 2px var(--primary)}.ag-dia.solta{background:var(--primary-soft)}
  .ag-dia.baixo{background:color-mix(in srgb,var(--neg) 7%,transparent)}
  .ag-n{display:flex;justify-content:space-between;align-items:baseline;font-size:12.5px;font-weight:600}.ag-n b{display:inline-flex;min-width:22px;height:22px;align-items:center;justify-content:center;border-radius:50%}
  .ag-dia.hoje .ag-n b{background:var(--primary);color:#fff}.ag-n span{font-size:10.5px;font-weight:500;color:var(--muted);font-variant-numeric:tabular-nums}.ag-n span.neg{color:var(--neg);font-weight:700}
  .ag-it,.ag-g{display:flex;align-items:center;gap:4px;font-size:11.5px;line-height:1.25;padding:2px 4px;border-radius:5px;background:var(--surface-2);white-space:nowrap;overflow:hidden;min-width:0}
  .ag-it span,.ag-g span{overflow:hidden;text-overflow:ellipsis}.ag-it.feito span{text-decoration:line-through;opacity:.6}.ag-it[draggable=true]{cursor:grab}
  .ag-g.atr{box-shadow:inset 2px 0 0 var(--neg)}.ag-g em{font-style:normal;margin-left:auto;color:var(--muted);font-variant-numeric:tabular-nums;padding-left:4px;flex:none}.ag-g span{flex:1 1 auto;min-width:0}
  .ag-mais{font-size:11px;color:var(--muted)}
  .ag-sem .ag-dia{min-height:420px}.ag-sem .ag-it{white-space:normal;align-items:flex-start;overflow-wrap:anywhere}.ag-sem .ag-it i{margin-top:4px}.ag-sem .ag-it small{display:block;color:var(--muted)}
  .ag-lado h3{margin:0 0 2px}.ag-lado .ag-li{display:flex;gap:8px;padding:8px 0;border-top:1px solid var(--border);cursor:pointer;align-items:flex-start}.ag-lado .ag-li:first-of-type{border-top:0}
  .ag-li i{width:9px;height:9px;border-radius:50%;margin-top:5px;flex:none}.ag-li .t{flex:1;min-width:0;font-size:13px}.ag-li .t small{display:block;color:var(--muted)}.ag-li .v{font-variant-numeric:tabular-nums;font-size:13px;white-space:nowrap}
  .ag-li.feito .t{text-decoration:line-through;opacity:.6}
  .ag-saldo{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:8px 0 4px}.ag-saldo div{border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-size:12.5px}.ag-saldo span{display:block;color:var(--muted);font-size:11px}
  .ag-lista td.d{white-space:nowrap;font-weight:600;vertical-align:top}
  .ag-form{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.ag-form .c2{grid-column:span 2}.ag-form .c4{grid-column:span 4}@media(max-width:700px){.ag-form{grid-template-columns:1fr 1fr}.ag-form .c4{grid-column:span 2}}
  .ag-chk{display:flex;gap:6px;flex-wrap:wrap}.ag-chk label,.modal label.chk{display:inline-flex;flex-direction:row;align-items:center;gap:6px;font-weight:400;font-size:13px}.ag-chk input,.modal label.chk input{width:auto;min-height:0}
  .ag-chk label{border:1px solid var(--border);border-radius:999px;padding:3px 10px}
</style>`;
const podeFin = () => ['admin', 'financeiro'].includes(state.papel);
const podeCom = () => ['admin', 'financeiro', 'diretor', 'vendas'].includes(state.papel);

async function carregar(e, P, cfg, visiveis, hoje) {
  const c = state.cad, tem = (k) => visiveis.some(f => f.k === k), seg = (p) => p.catch(() => []), entre = (qy, col) => qy.gte(col, P.de).lte(col, P.ate);
  const querSaldo = cfg.saldo_dia && temArea('fin') && (cfg.saldo_papeis || []).includes(state.papel);
  const finTit = tem('receber') || tem('pagar');
  const [comps1, compsN, excs, lancs, chq, chqE, cont, fech, contr, cargas, fdoc, fmot, veic, man, equip, rnc, artes, lic, sst, sstT, colab, fer, saldos, cxCfg] = await Promise.all([
    seg(q(entre(sb.from('agenda_compromissos').select('*').eq('empresa_id', e).eq('repetir', 'nao'), 'data'))),
    seg(q(sb.from('agenda_compromissos').select('*').eq('empresa_id', e).neq('repetir', 'nao').lte('data', P.ate))),
    seg(q(sb.from('agenda_excecoes').select('*').eq('empresa_id', e))),
    finTit || querSaldo ? seg(fetchAll(() => sb.from('lancamentos').select('id,data,valor,plano_id,favorecido_id,descricao,documento').eq('empresa_id', e).eq('status', 'Em aberto').lte('data', P.ate).order('data').order('id'))) : [],
    tem('cheque_rec') || querSaldo ? seg(q(sb.from('chq_cheques').select('id,numero,situacao,bom_para,valor,favorecido_id,emitente').eq('empresa_id', e).in('situacao', ['carteira', 'depositado']).lte('bom_para', P.ate))) : [],
    tem('cheque_emi') || querSaldo ? seg(q(sb.from('chq_emitidos').select('id,numero,situacao,bom_para,valor,favorecido_id,nominal,conta_id').eq('empresa_id', e).eq('situacao', 'emitido').lte('bom_para', P.ate))) : [],
    tem('contato') ? seg(q(entre(sb.from('comercial_interacoes').select('id,favorecido_id,proximo_contato,proximo_assunto,resumo,concluido,vendedor_id,criado_por').eq('empresa_id', e).eq('concluido', false), 'proximo_contato'))) : [],
    tem('fechamento') ? seg(q(entre(sb.from('fechamento_tarefas').select('id,mes,titulo,prazo,situacao,responsavel').eq('empresa_id', e), 'prazo'))) : [],
    tem('contrato') ? seg(q(sb.from('contratos').select('id,numero,objeto,parte_nome,fim,data_base,indice,reajuste_fixo_pct,renovacao_automatica,status').eq('empresa_id', e).eq('status', 'vigente'))) : [],
    tem('carga') ? seg(q(entre(sb.from('log_cargas').select('id,numero,data,status,motorista,veiculo_id').eq('empresa_id', e).neq('status', 'cancelada'), 'data'))) : [],
    tem('frota') ? seg(q(entre(sb.from('frota_documentos').select('id,veiculo_id,tipo,validade').eq('empresa_id', e), 'validade'))) : [],
    tem('frota') ? seg(q(sb.from('frota_motoristas').select('id,nome,cnh_validade,toxicologico_validade,mopp_validade,ativo').eq('empresa_id', e).eq('ativo', true))) : [],
    tem('frota') || tem('carga') ? seg(q(sb.from('log_veiculos').select('id,placa').eq('empresa_id', e))) : [],
    tem('manutencao') ? seg(q(sb.from('man_ordens').select('id,numero,tipo,situacao,descricao,programada_para,vence_em,equipamento_id,responsavel').eq('empresa_id', e).in('situacao', ['solicitada', 'aberta', 'programada', 'em_execucao', 'aguardando_peca', 'aguardando_terceiro']).limit(800))) : [],
    tem('manutencao') ? seg(q(sb.from('man_equipamentos').select('id,nome').eq('empresa_id', e))) : [],
    tem('qualidade') ? seg(q(entre(sb.from('qual_rnc').select('id,numero,descricao,prazo,situacao,responsavel').eq('empresa_id', e).in('situacao', ['aberta', 'em_analise', 'acao', 'verificacao']), 'prazo'))) : [],
    tem('arte') ? seg(q(entre(sb.from('pre_projetos').select('id,numero,nome,prazo,situacao,favorecido_id,arquivado').eq('empresa_id', e).in('situacao', ['em_criacao', 'aguardando_cliente', 'alteracao_solicitada', 'reprovada', 'aprovada', 'na_clicheria']), 'prazo'))) : [],
    tem('licenca') ? seg(q(entre(sb.from('rec_licencas').select('id,tipo,numero,orgao,validade,ativo').eq('empresa_id', e).eq('ativo', true), 'validade'))) : [],
    tem('sst') ? seg(q(entre(sb.from('rh_sst_registros').select('id,colaborador_id,tipo_id,vence_em').eq('empresa_id', e), 'vence_em'))) : [],
    tem('sst') ? seg(q(sb.from('rh_sst_tipos').select('id,nome').eq('empresa_id', e))) : [],
    tem('sst') || tem('ferias') ? seg(q(sb.from('rh_colaboradores').select('id,nome').eq('empresa_id', e))) : [],
    tem('ferias') ? seg(q(entre(sb.from('rh_ferias').select('id,colaborador_id,gozo_ini,dias,situacao').eq('empresa_id', e).neq('situacao', 'cancelada'), 'gozo_ini'))) : [],
    querSaldo ? q(sb.rpc('saldos_contas', { p_empresa: e, p_ate: hoje })).catch(() => null) : null,
    querSaldo ? q(sb.from('caixa_config').select('caixa_minimo,contas').eq('empresa_id', e)).catch(() => []) : [],
  ]);
  const nome = (L) => Object.fromEntries(L.map(x => [x.id, x.nome ?? x.placa])), V = nome(veic), EQ = nome(equip), ST = nome(sstT), CO = nome(colab);
  const ctx = { planoById: c?.planoById || {}, favById: c?.favById || {}, contaById: c?.contaById || {}, hoje, de: P.de, ate: P.ate };
  const noPeriodo = (i) => i.data >= P.de && i.data <= P.ate;
  let itens = [];
  for (const cp of [...comps1, ...compsN]) itens.push(...ocorrencias(cp, P.de, P.ate, excs));
  const tit = itensTitulos(lancs, { ...ctx, podeAdiar: podeFin() }), chqI = itensCheques(chq, chqE, ctx);
  if (finTit) itens.push(...tit.filter(i => tem(i.fonte)));
  itens.push(...chqI.filter(i => tem(i.fonte)));
  itens.push(...itensContatos(cont, { ...ctx, podeEditar: podeCom() }), ...itensFechamento(fech, ctx), ...itensContratos(contr, ctx));
  const DOC = { crlv: 'CRLV', ipva: 'IPVA', seguro: 'Seguro', tacografo: 'Tacógrafo', aet: 'AET', antt: 'ANTT', outro: 'Documento' };
  for (const x of cargas) itens.push(itemSimples('carga', x.id, x.data, `Carga nº ${x.numero}${x.motorista ? ' · ' + x.motorista : ''}`, [V[x.veiculo_id], { planejada: 'planejada', carregando: 'carregando', pronta: 'pronta', em_rota: 'em rota', concluida: 'concluída' }[x.status]].filter(Boolean).join(' · '), hoje, { feito: x.status === 'concluida', semAtraso: x.status === 'concluida' }));
  for (const x of fdoc) itens.push(itemSimples('frota', x.id, x.validade, `${DOC[x.tipo] || 'Documento'} vence · ${V[x.veiculo_id] || 'veículo'}`, 'documento do veículo', hoje));
  for (const m of fmot) for (const [k, t] of [['cnh_validade', 'CNH'], ['toxicologico_validade', 'Exame toxicológico'], ['mopp_validade', 'MOPP']]) if (m[k]) itens.push(itemSimples('frota', m.id, m[k], `${t} vence · ${m.nome}`, 'motorista', hoje, { sufixo: ':' + k }));
  for (const x of man) { const dt = x.programada_para || x.vence_em; if (dt) itens.push(itemSimples('manutencao', x.id, String(dt).slice(0, 10), `OS nº ${x.numero} · ${EQ[x.equipamento_id] || 'equipamento'}`, [x.tipo, x.responsavel, x.descricao].filter(Boolean).join(' · ').slice(0, 120), hoje, { rota: 'manutencao/ordens?abrir=' + x.id })); }
  for (const x of rnc) itens.push(itemSimples('qualidade', x.id, x.prazo, `RNC nº ${x.numero}: prazo da ação`, [x.responsavel, x.descricao].filter(Boolean).join(' · ').slice(0, 120), hoje));
  for (const x of artes) if (!x.arquivado) itens.push(itemSimples('arte', x.id, x.prazo, `Arte nº ${x.numero} · ${x.nome || ''}`, ctx.favById[x.favorecido_id]?.nome || '', hoje));
  for (const x of lic) itens.push(itemSimples('licenca', x.id, x.validade, `Licença vence · ${x.tipo || ''} ${x.numero || ''}`.trim(), x.orgao || '', hoje));
  for (const x of sst) itens.push(itemSimples('sst', x.id, x.vence_em, `${ST[x.tipo_id] || 'Exame/treinamento'} vence`, CO[x.colaborador_id] || '', hoje));
  for (const x of fer) itens.push(itemSimples('ferias', x.id, x.gozo_ini, `Férias · ${CO[x.colaborador_id] || 'colaborador'}`, `${x.dias || ''} dia(s)`, hoje, { semAtraso: true }));
  itens = itens.filter(i => tem(i.fonte) && noPeriodo(i));
  // saldo projetado: saldo de hoje nas contas da Necessidade de Caixa + títulos em aberto + cheques pela data "bom para"
  let saldo = null;
  if (querSaldo && saldos) {
    const cx = cxCfg[0] || {}, sel = cx.contas?.length ? new Set(cx.contas) : new Set(saldos.filter(s => !/bloqueio/i.test(s.nome || '') && c?.contaById[s.conta_id]?.tipo !== 'Cheques' && !/bloquead/i.test(c?.contaById[s.conta_id]?.disponibilidade || '')).map(s => s.conta_id));
    const sHoje = saldos.filter(s => sel.has(s.conta_id)).reduce((t, s) => t + +s.saldo_pago, 0);
    const fluxos = tit.map(i => ({ data: i.data, valor: i.sinal * i.valor })).concat(cfg.saldo_cheques ? chqI.filter(i => i.noSaldo).map(i => ({ data: i.data, valor: i.sinal * i.valor })) : []);
    saldo = { hoje: sHoje, minimo: +cx.caixa_minimo > 0 ? +cx.caixa_minimo : null, contas: sel.size,
      dias: saldoPorDia({ saldo: sHoje, fluxos, hoje, ate: P.ate < hoje ? hoje : P.ate, vencidosEmHoje: cfg.vencidos_em_hoje, minimo: +cx.caixa_minimo > 0 ? +cx.caixa_minimo : null }) };
  }
  return { itens, saldo, comps: [...comps1, ...compsN] };
}

export async function render(root) {
  const e = state.empresa.id, hoje = today(), uid = state.user?.id;
  const prm = new URLSearchParams(location.hash.split('?')[1] || '');
  root.innerHTML = `${CSS}<div id="ag"><div class="loading">Carregando…</div></div>`;
  let cfg = { ...CFG0 }, semSQL = false, membros = [];
  try {
    await loadCadastros().catch(() => {});
    const [C, M] = await Promise.all([sb.from('agenda_config').select('*').eq('empresa_id', e), q(sb.from('membros').select('user_id,nome,papel').eq('empresa_id', e)).catch(() => [])]);
    if (C.error) semSQL = true; else if (C.data?.[0]) cfg = { ...CFG0, ...C.data[0] };
    membros = M.filter(m => !['motorista', 'colaborador'].includes(m.papel)).map(m => ({ ...m, nome: (m.nome || '').trim() || 'Sem nome (' + m.papel + ')' })).sort((a, b) => a.nome.localeCompare(b.nome));
  } catch (err) { fail(err); }
  if (ui.visao == null) { ui.visao = ls('ag-visao', null) || cfg.visao_padrao; ui.ref = hoje; ui.dia = hoje; ui.ocultas = new Set(ls('ag-ocultas', [])); ui.meus = ls('ag-meus', false); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(prm.get('dia') || '')) { ui.ref = ui.dia = prm.get('dia'); }
  const visiveis = fontesVisiveis({ temArea, temRH, papel: state.papel, desligadas: cfg.fontes_desligadas });
  const nomeDe = (u) => membros.find(m => m.user_id === u)?.nome || (u === uid ? 'Você' : 'Alguém da equipe');
  const el = $('#ag', root);
  let D = { itens: [], saldo: null, comps: [] }, P;

  const recarregar = async () => {
    P = periodo(ui.visao, ui.ref, cfg.semana_inicio);
    try { D = await carregar(e, P, cfg, visiveis, hoje); } catch (err) { fail(err); }
    pintar();
  };
  const lista = () => filtrar(D.itens, { ocultas: ui.ocultas, meus: ui.meus, uid, busca: ui.busca, feitos: ui.feitos });
  const chip = (i, { curto = true } = {}) => `<div class="ag-it ${i.feito ? 'feito' : ''}" data-i="${esc(i.uid)}" ${i.acoes?.adiar && !i.feito ? 'draggable="true"' : ''} title="${esc(i.titulo)}"><i style="background:${fonte(i.fonte).cor}"></i><span>${i.hora ? `<b>${i.hora}</b> ` : ''}${esc(i.titulo)}${!curto && i.valor != null ? ` · ${money(i.valor)}` : ''}${!curto && i.sub ? `<small>${esc(i.sub)}</small>` : ''}</span></div>`;
  const numDia = (d, M) => { const s = D.saldo?.dias.get(d); return `<div class="ag-n"><b>${+d.slice(8)}</b>${s ? `<span class="${s.abaixo || s.saldo < 0 ? 'neg' : ''}" title="Saldo previsto no fim do dia: ${money(s.saldo)}">${valorCurto(s.saldo)}</span>` : ''}</div>`; };
  const classesDia = (d, mesRef) => `ag-dia${d === hoje ? ' hoje' : ''}${d === ui.dia ? ' sel' : ''}${mesRef && d.slice(0, 7) !== mesRef ? ' fora' : ''}${D.saldo?.dias.get(d)?.abaixo || D.saldo?.dias.get(d)?.saldo < 0 ? ' baixo' : ''}`;
  const colunas = () => { const o = [0, 1, 2, 3, 4, 5, 6].map(i => (i + cfg.semana_inicio) % 7); return cfg.fim_de_semana ? o : o.filter(w => w !== 0 && w !== 6); };

  function vMes(M) {
    const cols = colunas(), g = gradeMes(+ui.ref.slice(0, 4), +ui.ref.slice(5, 7), cfg.semana_inicio), mesRef = ui.ref.slice(0, 7);
    return `<div class="ag-mes" style="--cols:${cols.length}">${cols.map(w => `<div class="ag-cab">${DIAS[w]}</div>`).join('')}
      ${g.map(sem => sem.filter(d => cols.includes(diaSemana(d))).map(d => { const L = M.get(d) || [], R = resumoDia(L), max = 4;
        const linhas = [...R.compromissos.map(i => chip(i)), ...R.grupos.map(x => `<div class="ag-g ${x.atrasado ? 'atr' : ''}" title="${esc(fonte(x.fonte).nome)}"><i style="background:${fonte(x.fonte).cor}"></i><span>${x.n > 1 ? x.n + ' ' : ''}${esc(fonte(x.fonte).curto || fonte(x.fonte).nome)}</span>${x.valor ? `<em>${valorCurto(x.valor)}</em>` : ''}</div>`)];
        return `<div class="${classesDia(d, mesRef)}" data-dia="${d}">${numDia(d)}${linhas.slice(0, max).join('')}${linhas.length > max ? `<div class="ag-mais">+ ${linhas.length - max} linha(s)</div>` : ''}</div>`; }).join('')).join('')}</div>`;
  }
  function vSemana(M) {
    const cols = colunas(), s = semanaDe(ui.ref, cfg.semana_inicio).filter(d => cols.includes(diaSemana(d)));
    return `<div class="ag-mes ag-sem" style="--cols:${s.length}">${s.map(d => `<div class="ag-cab">${DIAS[diaSemana(d)]} ${dateBR(d).slice(0, 5)}</div>`).join('')}
      ${s.map(d => { const L = M.get(d) || []; return `<div class="${classesDia(d)}" data-dia="${d}">${numDia(d)}${L.slice(0, 14).map(i => chip(i, { curto: false })).join('')}${L.length > 14 ? `<div class="ag-mais">+ ${L.length - 14} item(ns): clique no dia</div>` : ''}</div>`; }).join('')}</div>`;
  }
  function vLista(M) {
    const dias = [...M.keys()].sort();
    return `<div class="card flush"><div class="table-wrap"><table class="ag-lista" id="ag-tab"><thead><tr><th>Dia</th><th>Hora</th><th>O quê</th><th>Tipo</th><th class="num">Valor</th></tr></thead><tbody>
      ${dias.map(d => M.get(d).map((i, k) => `<tr class="clickable" data-i="${esc(i.uid)}">${k === 0 ? `<td class="d" rowspan="${M.get(d).length}">${DIAS[diaSemana(d)]} ${dateBR(d).slice(0, 5)}${d === hoje ? '<div class="small muted">hoje</div>' : ''}</td>` : ''}
        <td>${i.hora || ''}</td><td class="wrap">${i.feito ? '<s>' : ''}${esc(i.titulo)}${i.feito ? '</s>' : ''}${i.sub ? `<div class="small muted">${esc(i.sub)}</div>` : ''}${i.atrasado && !i.feito ? '<div class="small neg">atrasado</div>' : ''}</td>
        <td><span style="display:inline-flex;align-items:center;gap:6px"><i style="width:8px;height:8px;border-radius:50%;background:${fonte(i.fonte).cor};display:inline-block"></i>${esc(fonte(i.fonte).nome)}</span></td><td class="num">${i.valor != null ? money(i.sinal * i.valor) : ''}</td></tr>`).join('')).join('')
        || '<tr><td colspan="5" class="empty">Nada na agenda neste período.</td></tr>'}</tbody></table></div></div>`;
  }
  function lado(M) {
    const L = M.get(ui.dia) || [], s = D.saldo?.dias.get(ui.dia), atras = lista().filter(i => i.atrasado && !i.feito && i.data < hoje).length;
    return `<div class="card ag-lado"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div><h3>${DIAS[diaSemana(ui.dia)]}, ${dateBR(ui.dia)}</h3><div class="small muted">${ui.dia === hoje ? 'hoje' : ui.dia < hoje ? 'passado' : `em ${Math.round((Date.parse(ui.dia) - Date.parse(hoje)) / 864e5)} dia(s)`} · ${L.length} item(ns)</div></div>
        ${semSQL ? '' : `<button class="btn ghost small" id="ag-novo-dia" title="Novo compromisso neste dia">+ Neste dia</button>`}</div>
      ${s ? `<div class="ag-saldo"><div><span>Entra</span><b class="pos">${money(s.entra)}</b></div><div><span>Sai</span><b class="neg">${money(s.sai)}</b></div><div><span>Saldo previsto</span><b class="${s.abaixo || s.saldo < 0 ? 'neg' : ''}">${money(s.saldo)}</b></div></div>
        ${s.abaixo ? `<div class="small neg">Abaixo do caixa mínimo (${money(D.saldo.minimo)}). <a href="#/necessidade-caixa">Ver a Necessidade de Caixa</a></div>` : ''}` : ''}
      <div style="margin-top:8px">${L.map(i => `<div class="ag-li ${i.feito ? 'feito' : ''}" data-i="${esc(i.uid)}"><i style="background:${fonte(i.fonte).cor}"></i><div class="t">${i.hora ? `<b>${i.hora}${i.horaFim ? '–' + i.horaFim : ''}</b> ` : ''}${esc(i.titulo)}<small>${esc([fonte(i.fonte).nome, i.sub].filter(Boolean).join(' · '))}${i.atrasado && !i.feito ? ' · <span class="neg">atrasado</span>' : ''}</small></div>${i.valor != null ? `<div class="v ${i.sinal > 0 ? 'pos' : 'neg'}">${money(i.sinal * i.valor)}</div>` : ''}</div>`).join('')
        || '<div class="empty" style="padding:18px 0">Nada neste dia.</div>'}</div></div>
      ${atras ? `<div class="card small" style="margin-top:12px;border-left:4px solid var(--neg)"><b>${atras}</b> item(ns) atrasado(s) neste período. <a href="#" id="ag-atr">Ver na lista</a></div>` : ''}
      ${D.saldo ? `<p class="small muted" style="margin:10px 4px 0">O número pequeno em cada dia é o saldo previsto no fim do dia: saldo de hoje (${money(D.saldo.hoje)}, ${D.saldo.contas} conta(s) da Necessidade de Caixa) mais o que entra e menos o que sai em aberto${cfg.vencidos_em_hoje ? ', com os vencidos contados em hoje' : ''}.</p>` : ''}`;
  }

  function pintar() {
    const L = lista(), M = porDia(L);
    el.innerHTML = `${semSQL ? '<div class="card small" style="background:var(--warn-soft);margin-bottom:12px">Os compromissos próprios e os parâmetros precisam do SQL 155. Enquanto isso, a agenda mostra os itens das outras telas.</div>' : ''}
      <div class="ag-topo"><button class="btn ghost" id="ag-hoje">Hoje</button><button class="btn ghost icon" id="ag-ant" title="Anterior">‹</button><button class="btn ghost icon" id="ag-prox" title="Seguinte">›</button><h2>${esc(P.titulo)}</h2>
        <div class="chips" id="ag-vis">${[['mes', 'Mês'], ['semana', 'Semana'], ['lista', 'Lista']].map(([k, t]) => `<span class="chip ${ui.visao === k ? 'on' : ''}" data-v="${k}">${t}</span>`).join('')}</div><span class="spacer" style="flex:1"></span>
        <label style="display:inline-flex;flex-direction:row;gap:6px;align-items:center;font-weight:400;font-size:13px;white-space:nowrap"><input type="checkbox" id="ag-meus" ${ui.meus ? 'checked' : ''} style="width:auto;min-height:0"> Só os meus</label>
        <input id="ag-b" placeholder="Buscar na agenda" value="${esc(ui.busca)}" style="max-width:140px">
        ${['admin', 'diretor'].includes(state.papel) && !semSQL ? '<button class="btn ghost" id="ag-par">Parâmetros</button>' : ''}${semSQL ? '' : '<button class="btn primary" id="ag-novo">+ Compromisso</button>'}</div>
      <div class="ag-fontes">${visiveis.map(f => `<span class="ag-f ${ui.ocultas.has(f.k) ? 'off' : ''}" data-fo="${f.k}" title="Mostrar ou esconder"><i style="background:${f.cor}"></i>${esc(f.nome)}</span>`).join('')}</div>
      <div class="ag-corpo"><div id="ag-cal">${ui.visao === 'mes' ? vMes(M) : ui.visao === 'semana' ? vSemana(M) : vLista(M)}</div><div id="ag-lado">${lado(M)}</div></div>`;
    $('#ag-hoje', el).onclick = () => { ui.ref = ui.dia = hoje; recarregar(); };
    $('#ag-ant', el).onclick = () => { ui.ref = navegar(ui.visao, ui.ref, -1); ui.dia = ui.ref; recarregar(); };
    $('#ag-prox', el).onclick = () => { ui.ref = navegar(ui.visao, ui.ref, 1); ui.dia = ui.ref; recarregar(); };
    $('#ag-vis', el).onclick = (ev) => { const v = ev.target.closest('[data-v]')?.dataset.v; if (!v) return; ui.visao = v; gravar('ag-visao', v); if (v === 'lista' && ui.ref < hoje && ui.ref.slice(0, 7) === hoje.slice(0, 7)) ui.ref = hoje; else if (v !== 'lista') ui.ref = ui.dia; recarregar(); };
    $('#ag-meus', el).onchange = (ev) => { ui.meus = ev.target.checked; gravar('ag-meus', ui.meus); pintar(); };
    $('#ag-b', el).oninput = (ev) => { ui.busca = ev.target.value; clearTimeout(pintar._t); pintar._t = setTimeout(() => { pintar(); const b = $('#ag-b', el); b.focus(); b.setSelectionRange(b.value.length, b.value.length); }, 300); };
    $$('[data-fo]', el).forEach(c => c.onclick = () => { const k = c.dataset.fo; ui.ocultas.has(k) ? ui.ocultas.delete(k) : ui.ocultas.add(k); gravar('ag-ocultas', [...ui.ocultas]); pintar(); });
    $('#ag-novo', el) && ($('#ag-novo', el).onclick = () => formulario({ data: ui.dia }));
    $('#ag-novo-dia', el) && ($('#ag-novo-dia', el).onclick = () => formulario({ data: ui.dia }));
    $('#ag-par', el) && ($('#ag-par', el).onclick = parametros);
    $('#ag-atr', el) && ($('#ag-atr', el).onclick = (ev) => { ev.preventDefault(); ui.visao = 'lista'; ui.ref = P.de; recarregar(); });
    const achar = (u) => D.itens.find(i => i.uid === u);
    $$('[data-i]', el).forEach(x => { x.onclick = (ev) => { ev.stopPropagation(); const i = achar(x.dataset.i); i && detalhe(i); };
      if (x.draggable) x.ondragstart = (ev) => { ev.dataTransfer.setData('text/plain', x.dataset.i); ev.dataTransfer.effectAllowed = 'move'; }; });
    $$('[data-dia]', el).forEach(c => { c.onclick = () => { ui.dia = c.dataset.dia; $$('.ag-dia.sel', el).forEach(z => z.classList.remove('sel')); c.classList.add('sel'); $('#ag-lado', el).innerHTML = lado(porDia(lista())); ligarLado(); };
      c.ondblclick = () => !semSQL && formulario({ data: c.dataset.dia });
      c.ondragover = (ev) => { ev.preventDefault(); c.classList.add('solta'); }; c.ondragleave = () => c.classList.remove('solta');
      c.ondrop = (ev) => { ev.preventDefault(); c.classList.remove('solta'); const i = achar(ev.dataTransfer.getData('text/plain')); if (i && i.data !== c.dataset.dia) adiar(i, c.dataset.dia); }; });
    ligarLado();
  }
  function ligarLado() {
    $$('#ag-lado [data-i]', el).forEach(x => x.onclick = () => { const i = D.itens.find(z => z.uid === x.dataset.i); i && detalhe(i); });
    $('#ag-novo-dia', el) && ($('#ag-novo-dia', el).onclick = () => formulario({ data: ui.dia }));
    $('#ag-atr', el) && ($('#ag-atr', el).onclick = (ev) => { ev.preventDefault(); ui.visao = 'lista'; ui.ref = P.de; recarregar(); });
  }

  // ------------------------------------------------------------ ações
  async function adiar(i, nova, hora = null) {
    try {
      if (i.fonte === 'compromisso') await q(sb.rpc('agenda_ocorrencia', { p_id: i.id, p_data: i.dataOriginal, p_acao: 'movido', p_nova_data: nova, p_nova_hora: hora }));
      else if (i.fonte === 'receber' || i.fonte === 'pagar') { if (!await confirmDialog(`Mudar o vencimento de "${i.titulo}" (${money(i.valor)}) de ${dateBR(i.data)} para ${dateBR(nova)}?`)) return; await q(sb.from('lancamentos').update({ data: nova }).eq('id', i.id)); }
      else if (i.fonte === 'contato') await q(sb.from('comercial_interacoes').update({ proximo_contato: nova }).eq('id', i.id));
      else return toast('Este item é alterado na tela de origem', true);
      toast(`Movido para ${dateBR(nova)}`); ui.dia = nova; await recarregar();
    } catch (err) { fail(err); }
  }
  async function feito(i, desfazer = false) {
    try {
      if (i.fonte === 'compromisso') await q(sb.rpc('agenda_ocorrencia', { p_id: i.id, p_data: i.dataOriginal, p_acao: desfazer ? 'reaberto' : 'feito' }));
      else if (i.fonte === 'contato') await q(sb.from('comercial_interacoes').update({ concluido: true }).eq('id', i.id));
      toast(desfazer ? 'Reaberto' : 'Marcado como feito'); await recarregar();
    } catch (err) { fail(err); }
  }

  function detalhe(i) {
    const f = fonte(i.fonte), c = i.comp, ehComp = i.fonte === 'compromisso';
    const meu = ehComp && (c.dono === uid || c.responsavel === uid || (c.participantes || []).includes(uid) || state.papel === 'admin');
    const podeF = ehComp ? meu : !!i.acoes?.feito, podeA = ehComp ? meu : !!i.acoes?.adiar;
    const m = modal({ title: i.titulo, narrow: true, body: `<p style="margin-top:0"><span style="display:inline-flex;align-items:center;gap:6px"><i style="width:9px;height:9px;border-radius:50%;background:${f.cor};display:inline-block"></i><b>${esc(f.nome)}</b></span>
        · ${DIAS[diaSemana(i.data)]}, ${dateBR(i.data)}${i.hora ? ` · ${i.hora}${i.horaFim ? ' às ' + i.horaFim : ''}` : ''}${i.feito ? ' · <b class="pos">feito</b>' : i.atrasado ? ' · <b class="neg">atrasado</b>' : ''}</p>
      ${i.valor != null ? `<p style="font-size:20px;font-weight:700;margin:0 0 8px" class="${i.sinal > 0 ? 'pos' : 'neg'}">${money(i.sinal * i.valor)}</p>` : ''}
      ${i.sub ? `<p class="small">${esc(i.sub)}</p>` : ''}
      ${ehComp ? `<p class="small">${c.descricao ? esc(c.descricao).replace(/\n/g, '<br>') + '<br>' : ''}Responsável: <b>${esc(nomeDe(c.responsavel))}</b>${c.participantes?.length ? ` · com ${c.participantes.map(u => esc(nomeDe(u))).join(', ')}` : ''}${c.dono !== c.responsavel ? ` · criado por ${esc(nomeDe(c.dono))}` : ''}
        ${c.favorecido_id ? `<br>Cliente/fornecedor: ${esc(state.cad?.favById[c.favorecido_id]?.nome || '')}` : ''}${i.serie ? `<br>Repete ${esc(textoRepeticao(c))}${i.movido ? ` (esta ocorrência era de ${dateBR(i.dataOriginal)})` : ''}` : ''}${c.privado ? '<br>🔒 Privado: só os participantes veem' : ''}</p>` : ''}
      ${podeA && !i.feito ? `<div style="display:grid;grid-template-columns:1fr ${ehComp && i.hora ? '110px ' : ''}auto;gap:8px;align-items:end;margin-top:10px"><label>Adiar para<input type="date" id="dt-n" value="${addDias(i.data < hoje ? hoje : i.data, 1)}"></label>${ehComp && i.hora ? `<label>Hora<input type="time" id="dt-h" value="${i.hora}"></label>` : ''}<button class="btn" id="dt-ad">Adiar</button></div>` : ''}
      ${ehComp && meu && !i.feito ? `<div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end;margin-top:10px"><label>Passar para<select id="dt-p">${options(membros.filter(x => x.user_id !== c.responsavel), { value: 'user_id', empty: 'Escolha a pessoa' })}</select></label><button class="btn" id="dt-de">Delegar</button></div>` : ''}`,
      foot: `${ehComp && (c.dono === uid || state.papel === 'admin') ? '<button class="btn ghost" id="dt-x" style="margin-right:auto">Excluir</button>' : ''}${ehComp && meu ? '<button class="btn ghost" id="dt-e">Editar</button>' : ''}
        ${!ehComp ? `<a class="btn ghost" href="#/${f.rota === 'agenda' ? 'agenda' : esc(i.rota || f.rota)}" data-close>Abrir na tela de origem</a>` : ''}
        ${podeF ? (i.feito ? (ehComp ? '<button class="btn" id="dt-r">Reabrir</button>' : '') : '<button class="btn primary" id="dt-f">Feito</button>') : '<button class="btn ghost" data-close>Fechar</button>'}` });
    const fechar = (p) => p.then(() => m.close());
    $('#dt-f', m.el) && ($('#dt-f', m.el).onclick = () => fechar(feito(i)));
    $('#dt-r', m.el) && ($('#dt-r', m.el).onclick = () => fechar(feito(i, true)));
    $('#dt-ad', m.el) && ($('#dt-ad', m.el).onclick = () => { const n = $('#dt-n', m.el).value; if (!n) return toast('Informe a data', true); m.close(); adiar(i, n, $('#dt-h', m.el)?.value || null); });
    $('#dt-de', m.el) && ($('#dt-de', m.el).onclick = async () => { const p = $('#dt-p', m.el).value; if (!p) return toast('Escolha a pessoa', true);
      try { await q(sb.from('agenda_compromissos').update({ responsavel: p, participantes: [...new Set([...(c.participantes || []).filter(x => x !== p), c.responsavel])] }).eq('id', c.id)); toast(`Passado para ${nomeDe(p)}, que foi avisado(a)`); m.close(); recarregar(); } catch (err) { fail(err); } });
    $('#dt-e', m.el) && ($('#dt-e', m.el).onclick = () => { m.close(); formulario(c); });
    $('#dt-x', m.el) && ($('#dt-x', m.el).onclick = async () => {
      try {
        if (!i.serie) { if (!await confirmDialog('Excluir este compromisso?')) return; await q(sb.from('agenda_compromissos').delete().eq('id', c.id)); }
        else {
          const esc2 = await new Promise(res => { const m2 = modal({ title: 'Excluir compromisso que se repete', narrow: true, body: '<p style="margin-top:0">O que você quer excluir?</p>', foot: '<button class="btn ghost" data-close>Voltar</button><button class="btn" data-o="uma">Só esta data</button><button class="btn" data-o="prox">Esta e as próximas</button><button class="btn" data-o="todas">Todas</button>' });
            $$('[data-o]', m2.el).forEach(b => b.onclick = () => { res(b.dataset.o); m2.close(); }); $$('[data-close]', m2.el).forEach(b => b.addEventListener('click', () => res(null))); });
          if (!esc2) return;
          if (esc2 === 'uma') await q(sb.rpc('agenda_ocorrencia', { p_id: c.id, p_data: i.dataOriginal, p_acao: 'cancelado' }));
          else if (esc2 === 'prox') await q(sb.rpc('agenda_encerrar_repeticao', { p_id: c.id, p_a_partir: i.dataOriginal }));
          else await q(sb.from('agenda_compromissos').delete().eq('id', c.id));
        }
        toast('Excluído'); m.close(); recarregar();
      } catch (err) { fail(err); } });
  }

  function formulario(c = {}) {
    const novo = !c.id, favs = state.cad?.favorecidos || [];
    const m = modal({ title: novo ? 'Novo compromisso' : 'Editar compromisso', wide: false, body: `<div class="ag-form">
      <label class="c4">Assunto<input id="fc-titulo" value="${esc(c.titulo || '')}" placeholder="Ex.: Reunião de caixa" maxlength="140"></label>
      <label>Tipo<select id="fc-tipo">${Object.entries(TIPOS).map(([k, t]) => `<option value="${k}" ${k === (c.tipo || 'reuniao') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Data<input type="date" id="fc-data" value="${c.data || ui.dia}"></label>
      <label>Início<input type="time" id="fc-hora" value="${c.hora ? String(c.hora).slice(0, 5) : ''}"></label><label>Fim<input type="time" id="fc-fim" value="${c.hora_fim ? String(c.hora_fim).slice(0, 5) : ''}"></label>
      <div class="c4 small muted" style="margin-top:-6px">Sem hora de início, o compromisso vale para o dia inteiro.</div>
      <label class="c2">Repetir<select id="fc-rep">${Object.entries(REPETIR).map(([k, t]) => `<option value="${k}" ${k === (c.repetir || 'nao') ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="rp">A cada<input type="number" id="fc-int" min="1" max="52" value="${c.intervalo || 1}"></label><label class="rp">Até (opcional)<input type="date" id="fc-ate" value="${c.repetir_ate || ''}"></label>
      <div class="c4 rp-sem"><div class="small muted" style="margin-bottom:4px">Dias da semana</div><div class="ag-chk">${DIAS.map((dn, w) => `<label><input type="checkbox" data-w="${w}" ${(c.dias_semana || []).includes(w) ? 'checked' : ''}>${dn}</label>`).join('')}</div></div>
      <label class="c2">Responsável<select id="fc-resp">${options(membros, { value: 'user_id', selected: c.responsavel || uid })}</select></label>
      <label class="c2">Local (opcional)<input id="fc-local" value="${esc(c.local || '')}"></label>
      <div class="c4"><div class="small muted" style="margin-bottom:4px">Participantes (são avisados)</div><div class="ag-chk" id="fc-part">${membros.map(p => `<label><input type="checkbox" data-u="${p.user_id}" ${(c.participantes || []).includes(p.user_id) ? 'checked' : ''}>${esc(p.nome)}</label>`).join('') || '<span class="small muted">Sem outras pessoas na empresa.</span>'}</div></div>
      <label class="c4">Cliente ou fornecedor (opcional)<select id="fc-fav">${options(favs, { label: 'label', selected: c.favorecido_id, empty: 'Nenhum' })}</select></label>
      <label class="c4">Anotações<textarea id="fc-desc" rows="3">${esc(c.descricao || '')}</textarea></label>
      <label class="chk c4"><input type="checkbox" id="fc-priv" ${c.privado ? 'checked' : ''}> Privado: só eu e os participantes vemos</label></div>`,
      foot: '<button class="btn ghost" data-close>Voltar</button><button class="btn primary" id="fc-ok">Salvar</button>' });
    const rep = () => { const r = $('#fc-rep', m.el).value; $$('.rp', m.el).forEach(x => x.hidden = r === 'nao'); $('.rp-sem', m.el).hidden = r !== 'semanal'; };
    $('#fc-rep', m.el).onchange = rep; rep(); setTimeout(() => $('#fc-titulo', m.el).focus(), 50);
    $('#fc-ok', m.el).onclick = async (ev) => {
      const g = (k) => $('#fc-' + k, m.el).value, r = g('rep');
      const d = { titulo: g('titulo').trim(), tipo: g('tipo'), data: g('data'), hora: g('hora') || null, hora_fim: g('hora') && g('fim') ? g('fim') : null, repetir: r, intervalo: r === 'nao' ? 1 : Math.max(1, +g('int') || 1),
        dias_semana: r === 'semanal' ? $$('[data-w]:checked', m.el).map(x => +x.dataset.w) : [], repetir_ate: r === 'nao' ? null : g('ate') || null, responsavel: g('resp') || uid, local: g('local').trim() || null,
        participantes: $$('#fc-part [data-u]:checked', m.el).map(x => x.dataset.u), favorecido_id: g('fav') || null, descricao: g('desc').trim() || null, privado: $('#fc-priv', m.el).checked };
      if (!d.titulo) return toast('Informe o assunto', true); if (!d.data) return toast('Informe a data', true);
      if (d.hora_fim && d.hora_fim <= d.hora) return toast('O fim precisa ser depois do início', true);
      if (d.repetir_ate && d.repetir_ate < d.data) return toast('"Até" precisa ser depois da data', true);
      ev.target.disabled = true;
      try { if (novo) await q(sb.from('agenda_compromissos').insert({ ...d, empresa_id: e, dono: uid })); else await q(sb.from('agenda_compromissos').update(d).eq('id', c.id));
        toast('Compromisso salvo'); m.close(); ui.dia = d.data; if (d.data < P.de || d.data > P.ate) ui.ref = d.data; recarregar(); } catch (err) { fail(err); ev.target.disabled = false; }
    };
  }

  function parametros() {
    const PAPEIS = [['admin', 'Administrador'], ['diretor', 'Diretor'], ['financeiro', 'Financeiro'], ['leitura', 'Leitura']];
    const m = modal({ title: 'Parâmetros da agenda', body: `
      <h3 style="margin-top:0">O que aparece na agenda da empresa</h3><div class="ag-chk">${FONTES.filter(f => f.k !== 'compromisso').map(f => `<label><input type="checkbox" data-fk="${f.k}" ${cfg.fontes_desligadas.includes(f.k) ? '' : 'checked'}>${esc(f.nome)}</label>`).join('')}</div>
      <p class="small muted">Cada pessoa só vê as fontes das áreas a que tem acesso, e pode esconder as que não quiser na própria tela.</p>
      <h3>Calendário</h3><div class="ag-form"><label class="c2">A semana começa<select id="pa-ini"><option value="0" ${cfg.semana_inicio === 0 ? 'selected' : ''}>no domingo</option><option value="1" ${cfg.semana_inicio === 1 ? 'selected' : ''}>na segunda</option></select></label>
        <label class="c2">Visão ao abrir<select id="pa-vis">${[['mes', 'Mês'], ['semana', 'Semana'], ['lista', 'Lista']].map(([k, t]) => `<option value="${k}" ${cfg.visao_padrao === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="chk c4"><input type="checkbox" id="pa-fds" ${cfg.fim_de_semana ? 'checked' : ''}> Mostrar sábado e domingo</label></div>
      <h3>Saldo previsto por dia</h3><label class="chk"><input type="checkbox" id="pa-saldo" ${cfg.saldo_dia ? 'checked' : ''}> Mostrar o saldo previsto em cada dia</label>
      <div class="small muted" style="margin:8px 0 4px">Quem vê o saldo</div><div class="ag-chk">${PAPEIS.map(([k, t]) => `<label><input type="checkbox" data-pp="${k}" ${cfg.saldo_papeis.includes(k) ? 'checked' : ''}>${t}</label>`).join('')}</div>
      <label class="chk" style="margin-top:10px"><input type="checkbox" id="pa-chq" ${cfg.saldo_cheques ? 'checked' : ''}> Contar os cheques (de clientes em carteira e próprios a compensar) pela data "bom para"</label>
      <label class="chk" style="margin-top:6px"><input type="checkbox" id="pa-venc" ${cfg.vencidos_em_hoje ? 'checked' : ''}> Contar os títulos vencidos em aberto no saldo de hoje</label>
      <p class="small muted">O saldo de partida, as contas consideradas e o caixa mínimo são os da Necessidade de Caixa.</p>`,
      foot: '<button class="btn ghost" data-close>Voltar</button><button class="btn primary" id="pa-ok">Salvar</button>' });
    $('#pa-ok', m.el).onclick = async (ev) => {
      const d = { empresa_id: e, fontes_desligadas: $$('[data-fk]', m.el).filter(x => !x.checked).map(x => x.dataset.fk), semana_inicio: +$('#pa-ini', m.el).value, visao_padrao: $('#pa-vis', m.el).value, fim_de_semana: $('#pa-fds', m.el).checked,
        saldo_dia: $('#pa-saldo', m.el).checked, saldo_papeis: $$('[data-pp]:checked', m.el).map(x => x.dataset.pp), saldo_cheques: $('#pa-chq', m.el).checked, vencidos_em_hoje: $('#pa-venc', m.el).checked, atualizado_em: new Date().toISOString() };
      ev.target.disabled = true;
      try { await q(sb.from('agenda_config').upsert(d)); toast('Parâmetros salvos'); m.close(); render(root); } catch (err) { fail(err); ev.target.disabled = false; }
    };
  }

  await recarregar();
  const abrir = prm.get('abrir');
  if (abrir) { const c = D.comps.find(x => x.id === abrir) || (await q(sb.from('agenda_compromissos').select('*').eq('id', abrir)).catch(() => []))[0];
    if (c) { const i = D.itens.find(x => x.id === abrir && x.fonte === 'compromisso') || ocorrencias({ ...c, repetir: 'nao' }, c.data, c.data)[0]; if (i) { if (c.data < P.de || c.data > P.ate) { ui.ref = ui.dia = c.data; await recarregar(); } detalhe(D.itens.find(x => x.id === abrir && x.fonte === 'compromisso') || i); } } }
}

/** bloco da Minha Manhã: compromissos de hoje e de amanhã da pessoa */
export async function compromissosDoDia() {
  try {
    const e = state.empresa.id, hoje = today(), ate = addDias(hoje, 1), uid = state.user?.id;
    const [a, b, x] = await Promise.all([q(sb.from('agenda_compromissos').select('*').eq('empresa_id', e).eq('repetir', 'nao').gte('data', hoje).lte('data', ate)), q(sb.from('agenda_compromissos').select('*').eq('empresa_id', e).neq('repetir', 'nao').lte('data', ate)), q(sb.from('agenda_excecoes').select('*').eq('empresa_id', e))]);
    return filtrar([...a, ...b].flatMap(c => ocorrencias(c, hoje, ate, x)), { meus: true, uid, feitos: false }).sort((p, s) => p.data.localeCompare(s.data) || String(p.hora || '').localeCompare(String(s.hora || '')));
  } catch { return []; }
}
