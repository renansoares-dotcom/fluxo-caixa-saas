// CPD › Emissão de NF-e (FIS005, SQL 156): emissão de nota fiscal eletrônica pela API da Focus NFe, pela função focus-nfe.
// Nota avulsa: natureza de operação (CFOP, CST e alíquotas padrão), destinatário do cadastro, itens com os impostos calculados
// e ajustáveis, transporte, duplicatas e informações complementares. Prévia e DANFE no leiaute novo (NT 2026.010, com IBS, CBS e
// Imposto Seletivo) gerados pela própria plataforma a partir do XML. Cancelamento, carta de correção, e-mail e inutilização.
// Pedido do Renan em 12/11/2026.
import { sb, state, q, fetchAll, loadCadastros } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, money, dateBR, today, options, parseNum, confirmDialog, logoPNG } from '../lib/ui.js';
import { kpiGrid } from '../lib/componentes.js';
import { STATUS, FINALIDADE, FRETE, PAGAMENTO, calcular, itemDaNatureza, parcelar, validar, payloadFocus, dadosDanfe, localDestino } from '../lib/nfe-emissao.js';
import { lerDanfe, danfePDF, fmtChave, fmtDoc } from '../lib/danfe.js';

export const title = 'Emissão de NF-e';
const CFG0 = { ambiente: 'homologacao', papeis: ['financeiro'], crt: 3, serie: '1', modalidade_frete: 0, forma_pagamento: '15', prazos_padrao: [], pis_cofins_exclui_icms: true, ibs_cbs_exclui_tributos: true, danfe_logo: true, enviar_email_destinatario: false };
const ui = { filtro: 'todas', busca: '' };
const CSS = `<style>
  .nf-st{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap}
  .nf-st.pos{background:color-mix(in srgb,var(--pos) 14%,transparent);color:var(--pos)}.nf-st.warn{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
  .nf-st.neg{background:color-mix(in srgb,var(--neg) 14%,transparent);color:var(--neg)}.nf-st.muted{background:var(--surface-2);color:var(--muted)}
  .nf-amb{border-left:4px solid var(--warn);margin-bottom:12px}.nf-amb.prod{border-left-color:var(--pos)}
  .nf-g{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}.nf-g .c2{grid-column:span 2}.nf-g .c3{grid-column:span 3}.nf-g .c4{grid-column:span 4}.nf-g .c6{grid-column:span 6}
  @media(max-width:800px){.nf-g{grid-template-columns:1fr 1fr}.nf-g .c3,.nf-g .c4,.nf-g .c6{grid-column:span 2}}
  .nf-it{width:100%;border-collapse:collapse;font-size:12.5px}.nf-it th{font-size:11px;color:var(--muted);text-align:left;padding:3px 4px;font-weight:600}.nf-it td{padding:2px 3px;vertical-align:top}
  .nf-it input,.nf-it select{min-height:30px;padding:3px 6px;font-size:12.5px;width:100%;min-width:0}.nf-it .n{text-align:right}.nf-it tr.imp td{padding-bottom:8px;border-bottom:1px solid var(--border)}
  .nf-imp{display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:4px}.nf-imp label{font-size:10.5px;color:var(--muted);font-weight:500}
  .nf-tot{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;margin:10px 0}.nf-tot div{border:1px solid var(--border);border-radius:8px;padding:6px 8px;font-size:12.5px}.nf-tot span{display:block;color:var(--muted);font-size:10.5px}
  @media(max-width:900px){.nf-tot{grid-template-columns:repeat(4,minmax(0,1fr))}.nf-imp{grid-template-columns:repeat(3,minmax(0,1fr))}}
  .nf-sec{margin:16px 0 6px;font-size:13px;font-weight:700}.nf-err{border-left:4px solid var(--neg);margin:0 0 10px}.nf-err li{margin:2px 0}
  .modal label.chk{flex-direction:row;align-items:center;gap:8px;font-weight:400;font-size:13px}.modal label.chk input{width:auto;min-height:0}
</style>`;
const st = (s) => `<span class="nf-st ${(STATUS[s] || [s, 'muted'])[1]}">${esc((STATUS[s] || [s])[0])}</span>`;
const nv = (v, c = 2) => (+v || 0).toFixed(c).replace('.', ',');
const pn = (v) => parseNum(String(v || '0')) || 0;

export async function render(root) {
  const e = state.empresa.id, emp = state.empresa;
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">Emissão de NF-e</h2><div class="muted small">Notas emitidas pela Focus NFe, com o DANFE no leiaute novo (IBS, CBS e Imposto Seletivo).</div></div>
    <div class="pi-acoes" style="display:flex;gap:8px;flex-wrap:wrap" id="nf-acoes"></div></div><div id="nf-corpo"><div class="loading">Carregando…</div></div>`;
  const corpo = $('#nf-corpo', root);
  let cfg, nats, notas, pode = false, empFull, prods = [];
  try {
    await loadCadastros();
    const [C, N, L, P, E] = await Promise.all([q(sb.from('nfe_config').select('*').eq('empresa_id', e)), q(sb.from('nfe_naturezas').select('*').eq('empresa_id', e).order('nome')),
      q(sb.from('nfe_emissoes').select('id,status,ambiente,numero,serie,chave,natureza_operacao,destinatario,valor_total,data_emissao,autorizada_em,erros,mensagem_sefaz,cartas,criado_em').eq('empresa_id', e).order('criado_em', { ascending: false }).limit(400)),
      q(sb.rpc('nfe_pode', { p_empresa: e })), q(sb.from('empresas').select('*').eq('id', e))]);
    prods = await fetchAll(() => sb.from('produtos').select('id,codigo,descricao,unidade,ncm,ativo').eq('empresa_id', e).order('codigo')).catch(() => []);
    cfg = { ...CFG0, ...(C[0] || {}) }; cfg._existe = !!C[0]; nats = N; notas = L; pode = !!P; empFull = E[0] || emp;
  } catch (err) { fail(err); corpo.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 156 (emissão de NF-e) já foi executado.</div></div>'; return; }
  const re = () => render(root), admin = state.papel === 'admin', c = state.cad;
  const emit = () => ({ cnpj: empFull.cnpj, razao_social: empFull.razao_social || empFull.nome, nome: empFull.nome, ie: empFull.ie, logradouro: empFull.logradouro, municipio: empFull.municipio, uf: empFull.uf, cep: empFull.cep,
    nome_fantasia: cfg.nome_fantasia, numero: cfg.numero, complemento: cfg.complemento, bairro: cfg.bairro, telefone: cfg.telefone });
  const fn = async (body) => { const { data, error } = await sb.functions.invoke('focus-nfe', { body: { empresa_id: e, ...body } }); if (error) { let m = error.message; try { m = (await error.context.json()).erro || m; } catch { /* sem corpo */ } throw new Error(m); } if (data?.erro) throw new Error(data.erro); return data; };

  $('#nf-acoes', root).innerHTML = `${admin ? '<button class="btn ghost" id="nf-par">Parâmetros</button>' : ''}${pode ? '<button class="btn ghost" id="nf-nat">Naturezas de operação</button><button class="btn ghost" id="nf-inu">Inutilizar numeração</button><button class="btn primary" id="nf-nova">Nova nota</button>' : ''}`;
  $('#nf-par', root) && ($('#nf-par', root).onclick = parametros);
  $('#nf-nat', root) && ($('#nf-nat', root).onclick = naturezas);
  $('#nf-inu', root) && ($('#nf-inu', root).onclick = inutilizar);
  $('#nf-nova', root) && ($('#nf-nova', root).onclick = () => editar(null));

  const faltaCfg = [!cfg._existe && 'os parâmetros da emissão', !nats.length && 'ao menos uma natureza de operação'].filter(Boolean);
  function pintar() {
    const doAmb = notas.filter(n => n.ambiente === cfg.ambiente), mes = today().slice(0, 7), aut = doAmb.filter(n => n.status === 'autorizada' && String(n.autorizada_em || '').slice(0, 7) === mes);
    const b = ui.busca.trim().toLowerCase();
    const L = notas.filter(n => (ui.filtro === 'todas' || n.status === ui.filtro || (ui.filtro === 'processando' && n.status === 'enviando')) && (!b || [n.numero, n.chave, n.destinatario?.nome, n.natureza_operacao, String(n.valor_total)].some(v => String(v || '').toLowerCase().includes(b))));
    corpo.innerHTML = `<div class="card nf-amb ${cfg.ambiente === 'producao' ? 'prod' : ''}"><b>Ambiente: ${cfg.ambiente === 'producao' ? 'Produção (notas com valor fiscal)' : 'Homologação (testes, sem valor fiscal)'}</b>
        ${faltaCfg.length ? `<div class="small" style="margin-top:4px">Para emitir, falta cadastrar ${faltaCfg.join(' e ')}.</div>` : ''}</div>
      <div id="nf-k"></div>
      <div class="card toolbar" style="margin:12px 0"><div class="chips" id="nf-f">${[['todas', 'Todas'], ['rascunho', 'Rascunhos'], ['processando', 'Na SEFAZ'], ['autorizada', 'Autorizadas'], ['erro', 'Rejeitadas'], ['cancelada', 'Canceladas']].map(([k, t]) => `<span class="chip ${ui.filtro === k ? 'on' : ''}" data-f="${k}">${t}</span>`).join('')}</div><span class="spacer"></span>
        <label>Buscar<input id="nf-b" value="${esc(ui.busca)}" placeholder="nº, cliente, chave, valor" style="min-width:210px"></label></div>
      <div class="card flush"><div class="table-wrap"><table><thead><tr><th>Nota</th><th>Destinatário</th><th>Natureza</th><th>Emissão</th><th class="num">Valor</th><th>Situação</th><th></th></tr></thead><tbody>
      ${L.map(n => `<tr><td><b>${n.numero ? 'nº ' + esc(n.numero) : '—'}</b>${n.serie ? `<span class="small muted"> · série ${esc(n.serie)}</span>` : ''}${n.ambiente === 'homologacao' ? '<div class="small muted">homologação</div>' : ''}</td>
        <td class="wrap">${esc(n.destinatario?.nome || '—')}<div class="small muted">${esc(fmtDoc(n.destinatario?.documento || ''))}</div></td><td class="wrap small">${esc(n.natureza_operacao || '')}</td><td>${dateBR(String(n.data_emissao).slice(0, 10))}</td><td class="num">${money(n.valor_total)}</td>
        <td>${st(n.status)}${n.status === 'erro' && n.erros?.length ? `<div class="small neg wrap" style="max-width:260px">${esc(n.erros[0])}${n.erros.length > 1 ? ` (+${n.erros.length - 1})` : ''}</div>` : ''}${n.cartas?.length ? `<div class="small muted">${n.cartas.length} carta(s) de correção</div>` : ''}</td>
        <td style="white-space:nowrap">${['rascunho', 'erro'].includes(n.status) ? `<button class="btn ${pode ? 'primary' : 'ghost'} small" data-a="abrir" data-id="${n.id}">${pode ? 'Abrir' : 'Ver'}</button>` : ''}
          ${['enviando', 'processando'].includes(n.status) && pode ? `<button class="btn small" data-a="consultar" data-id="${n.id}">Consultar</button>` : ''}
          ${['autorizada', 'cancelada'].includes(n.status) ? `<button class="btn ghost small" data-a="danfe" data-id="${n.id}">DANFE</button> <button class="btn ghost small" data-a="xml" data-id="${n.id}">XML</button>` : ''}
          ${n.status === 'autorizada' && pode ? ` <button class="btn ghost small" data-a="mais" data-id="${n.id}">Mais</button>` : ''}</td></tr>`).join('')
        || '<tr><td colspan="7" class="empty">Nenhuma nota aqui.</td></tr>'}</tbody></table></div></div>`;
    kpiGrid($('#nf-k', corpo), [
      { id: 'autorizada', label: 'Autorizadas no mês', valor: money(aut.reduce((s, n) => s + +n.valor_total, 0)), sub: `${aut.length} nota(s)` },
      { id: 'rascunho', label: 'Rascunhos', valor: String(notas.filter(n => n.status === 'rascunho').length), sub: 'ainda não enviados' },
      { id: 'processando', label: 'Na SEFAZ', valor: String(notas.filter(n => ['enviando', 'processando'].includes(n.status)).length), sub: 'aguardando retorno', tom: notas.some(n => ['enviando', 'processando'].includes(n.status)) ? 'warn' : '' },
      { id: 'erro', label: 'Rejeitadas', valor: String(notas.filter(n => n.status === 'erro').length), sub: 'corrigir e reenviar', tom: notas.some(n => n.status === 'erro') ? 'neg' : '' },
    ], (id) => { ui.filtro = id; pintar(); });
    $('#nf-f', corpo).onclick = (ev) => { const f = ev.target.closest('[data-f]')?.dataset.f; if (f) { ui.filtro = f; pintar(); } };
    $('#nf-b', corpo).oninput = (ev) => { ui.busca = ev.target.value; clearTimeout(pintar._t); pintar._t = setTimeout(() => { pintar(); const x = $('#nf-b', corpo); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }, 300); };
    $$('[data-a]', corpo).forEach(x => x.onclick = () => acao(x.dataset.a, x.dataset.id, x));
  }
  pintar();

  const carregar = async (id) => (await q(sb.from('nfe_emissoes').select('*').eq('id', id)))[0];
  async function baixarDanfe(n, previa = false) {
    try { const d = !previa && n.xml ? lerDanfe(n.xml) : dadosDanfe(n, emit(), cfg); if (!d) return toast('XML da nota ainda não disponível. Clique em Consultar.', true);
      const lg = cfg.danfe_logo ? await logoPNG() : null;
      const doc = danfePDF(d, window.jspdf.jsPDF, { logo: lg?.data, marca: previa ? 'PRÉVIA - SEM VALOR FISCAL' : n.status === 'cancelada' ? 'CANCELADA' : null });
      if (previa) window.open(doc.output('bloburl'), '_blank'); else doc.save(`DANFE_${n.numero || 'nota'}.pdf`);
    } catch (err) { fail(err); }
  }
  async function acao(k, id, btn) {
    try {
      if (k === 'abrir') return editar(await carregar(id));
      if (k === 'danfe') return baixarDanfe(await carregar(id));
      if (k === 'xml') { const n = await carregar(id); if (!n.xml) return toast('XML ainda não disponível. Clique em Consultar.', true);
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([n.xml], { type: 'application/xml' })); a.download = `${n.chave || 'nfe'}-nfe.xml`; a.click(); return; }
      if (k === 'consultar') { btn.disabled = true; const r = await fn({ acao: 'consultar', nota_id: id }); toast(r.status === 'autorizada' ? 'Nota autorizada' : r.status === 'erro' ? 'Nota rejeitada: veja o motivo' : 'Ainda em processamento na SEFAZ', r.status === 'erro'); return re(); }
      if (k === 'mais') return mais(await carregar(id));
    } catch (err) { fail(err); if (btn) btn.disabled = false; }
  }
  function mais(n) {
    const m = modal({ title: `NF-e nº ${n.numero} · série ${n.serie}`, narrow: true, body: `<p class="small" style="margin-top:0">Chave: <b>${esc(fmtChave(n.chave || ''))}</b><br>Protocolo: ${esc(n.protocolo || '—')} · autorizada em ${n.autorizada_em ? dateBR(String(n.autorizada_em).slice(0, 10)) : '—'}</p>
      ${(n.cartas || []).length ? `<div class="small" style="margin-bottom:10px"><b>Cartas de correção</b>${n.cartas.map(x => `<div>${x.seq}ª · ${dateBR(String(x.em).slice(0, 10))}: ${esc(x.texto)}</div>`).join('')}</div>` : ''}
      <label>Enviar por e-mail para<input id="mx-em" value="${esc(n.destinatario?.email || '')}" placeholder="um ou mais e-mails, separados por vírgula"></label><button class="btn small" id="mx-env" style="margin-top:6px">Enviar XML e DANFE</button>
      <label style="margin-top:14px">Carta de correção (15 a 1.000 caracteres)<textarea id="mx-cc" rows="3" placeholder="Não corrige valores, quantidades, impostos nem troca o destinatário."></textarea></label><button class="btn small" id="mx-ccb" style="margin-top:6px">Registrar carta de correção</button>
      <label style="margin-top:14px">Cancelar a nota: justificativa (15 a 255 caracteres)<textarea id="mx-ju" rows="2"></textarea></label><button class="btn small" id="mx-can" style="margin-top:6px;color:var(--neg)">Cancelar a nota na SEFAZ</button>
      <p class="small muted">O prazo de cancelamento é o da SEFAZ (em regra, 24 horas da autorização). Depois dele, a correção é por nota de devolução ou estorno.</p>`, foot: '<button class="btn ghost" data-close>Fechar</button>' });
    const run = async (b, body, ok) => { b.disabled = true; try { const r = await fn({ nota_id: n.id, ...body }); if (r.ok === false) throw new Error((r.erros || []).join(' · ') || 'A SEFAZ não aceitou.'); toast(ok); m.close(); re(); } catch (err) { fail(err); b.disabled = false; } };
    $('#mx-env', m.el).onclick = (ev) => run(ev.target, { acao: 'email', emails: $('#mx-em', m.el).value.split(/[,;\s]+/).filter(Boolean) }, 'E-mail enviado pela Focus NFe');
    $('#mx-ccb', m.el).onclick = (ev) => run(ev.target, { acao: 'carta', correcao: $('#mx-cc', m.el).value }, 'Carta de correção registrada');
    $('#mx-can', m.el).onclick = async (ev) => { if (await confirmDialog(`Cancelar a NF-e nº ${n.numero} na SEFAZ? Não dá para desfazer.`)) run(ev.target, { acao: 'cancelar', justificativa: $('#mx-ju', m.el).value }, 'Nota cancelada'); };
  }

  // ------------------------------------------------------------ nota (rascunho)
  function editar(n) {
    const novo = !n, so = (s) => String(s ?? '').replace(/\D/g, ''), leitura = !pode;
    const natP = nats.find(x => x.id === (n?.natureza_id || cfg.natureza_padrao_id)) || nats.find(x => x.ativo) || null;
    const N = n ? { ...n, itens: (n.itens || []).map(i => ({ ...i })), destinatario: { ...(n.destinatario || {}) }, transporte: { ...(n.transporte || {}) }, duplicatas: (n.duplicatas || []).map(x => ({ ...x })) }
      : { natureza_id: natP?.id || null, natureza_operacao: natP?.natureza_operacao || '', tipo_documento: natP?.tipo_documento ?? 1, finalidade: natP?.finalidade ?? 1, consumidor_final: false, presenca: 9, data_emissao: new Date().toISOString(),
          favorecido_id: null, destinatario: {}, itens: [], transporte: { modalidade: cfg.modalidade_frete }, valor_frete: 0, valor_seguro: 0, valor_outras: 0, duplicatas: [], forma_pagamento: cfg.forma_pagamento, referenciadas: [],
          info_complementar: [cfg.info_padrao, natP?.info_complementar].filter(Boolean).join(' '), info_fisco: '' };
    const nat = () => nats.find(x => x.id === N.natureza_id);
    const m = modal({ title: novo ? 'Nova NF-e' : `NF-e ${N.status === 'erro' ? 'rejeitada: corrigir e reenviar' : 'em rascunho'}`, wide: true, body: `
      ${N.status === 'erro' && N.erros?.length ? `<div class="card nf-err"><b>Motivo da rejeição</b><ul style="margin:4px 0 0;padding-left:18px">${N.erros.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      <div class="nf-g"><label class="c2">Natureza de operação<select id="e-nat">${options(nats.filter(x => x.ativo || x.id === N.natureza_id), { label: 'nome', selected: N.natureza_id, empty: 'Escolha' })}</select></label>
        <label class="c2">Texto da natureza na nota<input id="e-natop" value="${esc(N.natureza_operacao || '')}" maxlength="60"></label>
        <label>Tipo<select id="e-tipo"><option value="1" ${+N.tipo_documento === 1 ? 'selected' : ''}>Saída</option><option value="0" ${+N.tipo_documento === 0 ? 'selected' : ''}>Entrada</option></select></label>
        <label>Finalidade<select id="e-fin">${Object.entries(FINALIDADE).map(([k, t]) => `<option value="${k}" ${+N.finalidade === +k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="c4" id="e-ref-l" ${+N.finalidade === 4 || +N.finalidade === 2 ? '' : 'hidden'}>Chave da nota referenciada (devolução ou complementar)<input id="e-ref" value="${esc((N.referenciadas || [])[0] || '')}" maxlength="54" placeholder="44 dígitos"></label></div>
      <div class="nf-sec">Destinatário</div>
      <div class="nf-g"><label class="c3">Cliente ou fornecedor do cadastro<select id="e-fav">${options(c.favorecidos, { label: 'label', selected: N.favorecido_id, empty: 'Escolha para preencher os dados' })}</select></label>
        <label class="c3">Nome / razão social<input id="d-nome" value="${esc(N.destinatario.nome || '')}"></label>
        <label class="c2">CNPJ / CPF<input id="d-documento" value="${esc(N.destinatario.documento || '')}"></label><label>Contribuinte<select id="d-indicador_ie">${[[1, 'Contribuinte'], [2, 'Isento'], [9, 'Não contribuinte']].map(([k, t]) => `<option value="${k}" ${+(N.destinatario.indicador_ie ?? 1) === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Inscr. estadual<input id="d-ie" value="${esc(N.destinatario.ie || '')}"></label><label class="c2">E-mail<input id="d-email" value="${esc(N.destinatario.email || '')}"></label>
        <label class="c3">Logradouro<input id="d-logradouro" value="${esc(N.destinatario.logradouro || '')}"></label><label>Número<input id="d-numero" value="${esc(N.destinatario.numero || '')}"></label><label class="c2">Bairro<input id="d-bairro" value="${esc(N.destinatario.bairro || '')}"></label>
        <label class="c2">Município<input id="d-municipio" value="${esc(N.destinatario.municipio || '')}"></label><label>UF<input id="d-uf" value="${esc(N.destinatario.uf || '')}" maxlength="2" style="text-transform:uppercase"></label><label>CEP<input id="d-cep" value="${esc(N.destinatario.cep || '')}"></label>
        <label>Telefone<input id="d-telefone" value="${esc(N.destinatario.telefone || '')}"></label><label class="chk" style="align-self:end"><input type="checkbox" id="e-cf" ${N.consumidor_final ? 'checked' : ''}> Consumidor final</label></div>
      <div class="nf-sec">Itens</div>
      <div style="display:flex;gap:8px;align-items:end;margin-bottom:6px"><label style="flex:1">Incluir produto do cadastro<select id="e-prod">${options(prods.filter(p => p.ativo !== false).slice(0, 4000), { label: (p) => `${p.codigo} · ${p.descricao}`, empty: 'Escolha o produto' })}</select></label><button class="btn ghost" id="e-livre">+ Item sem cadastro</button></div>
      <div id="e-itens"></div><div class="nf-tot" id="e-tot"></div>
      <div class="nf-g"><label>Frete (R$)<input id="e-frete" value="${nv(N.valor_frete)}"></label><label>Seguro (R$)<input id="e-seg" value="${nv(N.valor_seguro)}"></label><label>Outras despesas (R$)<input id="e-out" value="${nv(N.valor_outras)}"></label>
        <label class="c3">Quem paga o frete<select id="t-modalidade">${Object.entries(FRETE).map(([k, t]) => `<option value="${k}" ${+(N.transporte.modalidade ?? 9) === +k ? 'selected' : ''}>${k} - ${t}</option>`).join('')}</select></label></div>
      <div class="nf-sec">Transporte e volumes</div>
      <div class="nf-g"><label class="c2">Transportador<input id="t-nome" value="${esc(N.transporte.nome || '')}"></label><label>CNPJ / CPF<input id="t-documento" value="${esc(N.transporte.documento || '')}"></label><label>Placa<input id="t-placa" value="${esc(N.transporte.placa || '')}"></label><label>UF da placa<input id="t-placa_uf" value="${esc(N.transporte.placa_uf || '')}" maxlength="2"></label><label>Volumes<input id="t-volumes" value="${esc(N.transporte.volumes || '')}"></label>
        <label>Espécie<input id="t-especie" value="${esc(N.transporte.especie || '')}" placeholder="BOBINA, CAIXA…"></label><label>Peso líquido (kg)<input id="t-peso_liquido" value="${N.transporte.peso_liquido ? nv(N.transporte.peso_liquido, 3) : ''}"></label><label>Peso bruto (kg)<input id="t-peso_bruto" value="${N.transporte.peso_bruto ? nv(N.transporte.peso_bruto, 3) : ''}"></label></div>
      <div class="nf-sec">Cobrança</div>
      <div class="nf-g"><label class="c2">Forma de pagamento<select id="e-fp">${Object.entries(PAGAMENTO).map(([k, t]) => `<option value="${k}" ${N.forma_pagamento === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="c2">Prazos das duplicatas (dias)<input id="e-prz" value="${esc((cfg.prazos_padrao || []).join(', '))}" placeholder="ex.: 28, 35, 42"></label><div style="align-self:end"><button class="btn ghost" id="e-ger">Gerar duplicatas</button></div></div>
      <div id="e-dups" class="small" style="margin-top:6px"></div>
      <div class="nf-sec">Informações complementares</div><textarea id="e-info" rows="3">${esc(N.info_complementar || '')}</textarea>`,
      foot: `${!novo && N.status === 'rascunho' && pode ? '<button class="btn ghost" id="e-del" style="margin-right:auto">Excluir rascunho</button>' : ''}<button class="btn ghost" data-close>Voltar</button><button class="btn ghost" id="e-prev">Prévia do DANFE</button>${leitura ? '' : '<button class="btn" id="e-salvar">Salvar rascunho</button><button class="btn primary" id="e-emitir">Emitir</button>'}` });
    const ctxUF = () => ({ ufEmit: empFull.uf, ufDest: ($('#d-uf', m.el).value || '').toUpperCase() });
    const ler = () => { ['nome', 'documento', 'ie', 'email', 'logradouro', 'numero', 'bairro', 'municipio', 'uf', 'cep', 'telefone'].forEach(k => N.destinatario[k] = $('#d-' + k, m.el).value.trim()); N.destinatario.uf = N.destinatario.uf.toUpperCase(); N.destinatario.indicador_ie = +$('#d-indicador_ie', m.el).value;
      ['nome', 'documento', 'placa', 'placa_uf', 'especie'].forEach(k => N.transporte[k] = $('#t-' + k, m.el).value.trim()); N.transporte.modalidade = +$('#t-modalidade', m.el).value; N.transporte.volumes = pn($('#t-volumes', m.el).value) || null; N.transporte.peso_liquido = pn($('#t-peso_liquido', m.el).value) || null; N.transporte.peso_bruto = pn($('#t-peso_bruto', m.el).value) || null;
      N.natureza_id = $('#e-nat', m.el).value || null; N.natureza_operacao = $('#e-natop', m.el).value.trim(); N.tipo_documento = +$('#e-tipo', m.el).value; N.finalidade = +$('#e-fin', m.el).value; N.consumidor_final = $('#e-cf', m.el).checked;
      N.favorecido_id = $('#e-fav', m.el).value || null; N.valor_frete = pn($('#e-frete', m.el).value); N.valor_seguro = pn($('#e-seg', m.el).value); N.valor_outras = pn($('#e-out', m.el).value); N.forma_pagamento = $('#e-fp', m.el).value;
      N.referenciadas = so($('#e-ref', m.el).value) ? [so($('#e-ref', m.el).value)] : []; N.info_complementar = $('#e-info', m.el).value.trim();
      $$('#e-itens tr[data-i]', m.el).forEach(tr => { const i = N.itens[+tr.dataset.i]; $$('[data-k]', tr).forEach(x => { const k = x.dataset.k; i[k] = x.dataset.t === 'n' ? pn(x.value) : x.value.trim(); }); });
      $$('#e-itens tr[data-j]', m.el).forEach(tr => { const i = N.itens[+tr.dataset.j]; $$('[data-k]', tr).forEach(x => { const k = x.dataset.k; i[k] = x.dataset.t === 'n' ? pn(x.value) : x.value.trim(); }); }); };
    const C = () => calcular(N.itens, N, cfg);
    const totais = () => { const T = C().totais; $('#e-tot', m.el).innerHTML = [['Produtos', T.produtos], ['Desconto', T.desconto], ['Base ICMS', T.icms_base], ['ICMS', T.icms], ['IPI', T.ipi], ['PIS + COFINS', T.pis + T.cofins], ['CBS + IBS', T.cbs + T.ibs_uf + T.ibs_mun], ['Total da nota', T.nota]].map(([t, v], k) => `<div><span>${t}</span><b>${k === 7 ? money(v) : nv(v)}</b></div>`).join(''); return T; };
    const inp = (k, v, t = '', x = '') => `<input data-k="${k}" ${t ? `data-t="${t}"` : ''} value="${esc(v ?? '')}" ${x} ${leitura ? 'disabled' : ''}>`;
    const itens = () => { const K = C().itens;
      $('#e-itens', m.el).innerHTML = N.itens.length ? `<table class="nf-it"><thead><tr><th style="width:80px">Código</th><th>Descrição</th><th style="width:84px">NCM</th><th style="width:58px">CFOP</th><th style="width:48px">Un</th><th style="width:82px" class="n">Quant.</th><th style="width:92px" class="n">Valor unit.</th><th style="width:76px" class="n">Desconto</th><th style="width:92px" class="n">Total</th><th style="width:30px"></th></tr></thead><tbody>
        ${N.itens.map((i, k) => `<tr data-i="${k}"><td>${inp('codigo', i.codigo)}</td><td>${inp('descricao', i.descricao)}</td><td>${inp('ncm', i.ncm, '', 'maxlength="10"')}</td><td>${inp('cfop', i.cfop, '', 'maxlength="4"')}</td><td>${inp('unidade', i.unidade)}</td>
          <td>${inp('quantidade', i.quantidade ? nv(i.quantidade, 4).replace(/,?0+$/, '') : '', 'n', 'class="n"')}</td><td>${inp('valor_unitario', i.valor_unitario ? nv(i.valor_unitario, 6).replace(/0{1,4}$/, '') : '', 'n', 'class="n"')}</td><td>${inp('desconto', i.desconto ? nv(i.desconto) : '', 'n', 'class="n"')}</td>
          <td class="n" style="padding-top:8px"><b>${nv(K[k].total)}</b></td><td>${leitura ? '' : `<button class="btn ghost icon small" data-x="${k}" title="Tirar o item">✕</button>`}</td></tr>
          <tr class="imp" data-j="${k}"><td></td><td colspan="9"><div class="nf-imp">
            <label>CST ICMS${inp('icms_cst', i.icms_cst, '', 'maxlength="3"')}</label><label>% ICMS${inp('icms_aliquota', nv(i.icms_aliquota), 'n')}</label><label>CST IPI${inp('ipi_cst', i.ipi_cst, '', 'maxlength="2"')}</label><label>% IPI${inp('ipi_aliquota', nv(i.ipi_aliquota), 'n')}</label>
            <label>CST PIS/COF.${inp('pis_cst', i.pis_cst, '', 'maxlength="2"')}</label><label>% PIS${inp('pis_aliquota', nv(i.pis_aliquota, 4).replace(/0{1,2}$/, ''), 'n')}</label><label>% COFINS${inp('cofins_aliquota', nv(i.cofins_aliquota, 4).replace(/0{1,2}$/, ''), 'n')}</label>
            <label>CST IBS/CBS${inp('ibs_cbs_cst', i.ibs_cbs_cst, '', 'maxlength="3"')}</label><label>cClassTrib${inp('ibs_cbs_classificacao', i.ibs_cbs_classificacao, '', 'maxlength="6"')}</label></div>
            <div class="small muted" style="margin-top:2px">ICMS ${nv(K[k].icms_valor)} · IPI ${nv(K[k].ipi_valor)} · PIS ${nv(K[k].pis_valor)} · COFINS ${nv(K[k].cofins_valor)}${String(i.ibs_cbs_cst || '').trim() ? ` · CBS ${nv(K[k].cbs_valor)} · IBS ${nv(K[k].ibs_uf_valor + K[k].ibs_mun_valor)}` : ''}</div></td></tr>`).join('')}</tbody></table>` : '<div class="empty" style="padding:14px 0">Nenhum item. Escolha um produto acima.</div>';
      $$('#e-itens input', m.el).forEach(x => x.onchange = () => { ler(); N.itens.forEach(i => { i.cofins_cst = i.pis_cst; }); itens(); });
      $$('[data-x]', m.el).forEach(b => b.onclick = () => { ler(); N.itens.splice(+b.dataset.x, 1); itens(); });
      totais(); dups(); };
    const dups = () => { $('#e-dups', m.el).innerHTML = N.duplicatas.length ? N.duplicatas.map(x => `${esc(x.numero)} · ${dateBR(x.vencimento)} · <b>${money(x.valor)}</b>`).join(' &nbsp;|&nbsp; ') + (leitura ? '' : ' &nbsp;<a href="#" id="e-ldup">limpar</a>') : '<span class="muted">Sem duplicatas (nota sem cobrança ou à vista).</span>';
      $('#e-ldup', m.el) && ($('#e-ldup', m.el).onclick = (ev) => { ev.preventDefault(); N.duplicatas = []; dups(); }); };
    const add = (prod) => { ler(); if (!nat()) return toast('Escolha a natureza de operação primeiro', true); N.itens.push(itemDaNatureza(prod, nat(), ctxUF())); itens(); };
    $('#e-prod', m.el).onchange = (ev) => { const p = prods.find(x => x.id === ev.target.value); if (p) add(p); ev.target.value = ''; };
    $('#e-livre', m.el).onclick = () => add(null);
    $('#e-nat', m.el).onchange = () => { const x = nats.find(y => y.id === $('#e-nat', m.el).value); if (!x) return; $('#e-natop', m.el).value = x.natureza_operacao; $('#e-tipo', m.el).value = x.tipo_documento; $('#e-fin', m.el).value = x.finalidade; $('#e-fin', m.el).onchange();
      ler(); if (N.itens.length) { N.itens = N.itens.map(i => ({ ...itemDaNatureza({ id: i.produto_id, codigo: i.codigo, descricao: i.descricao, ncm: i.ncm, unidade: i.unidade, icms_origem: i.icms_origem }, x, ctxUF()), quantidade: i.quantidade, valor_unitario: i.valor_unitario, desconto: i.desconto, info: i.info })); toast('Impostos dos itens refeitos pela nova natureza'); } itens(); };
    $('#e-fin', m.el).onchange = () => { $('#e-ref-l', m.el).hidden = !['2', '4'].includes($('#e-fin', m.el).value); };
    $('#e-fav', m.el).onchange = (ev) => { const f = c.favById[ev.target.value]; if (!f) return; const set = (k, v) => { $('#d-' + k, m.el).value = v ?? ''; };
      set('nome', f.razao_social || f.nome); set('documento', f.documento); set('ie', f.ie); set('email', f.email); set('logradouro', f.logradouro); set('numero', f.numero); set('bairro', f.bairro); set('municipio', f.municipio); set('uf', f.uf); set('cep', f.cep); set('telefone', f.telefone);
      $('#d-indicador_ie', m.el).value = f.contribuinte_icms === false || String(f.documento || '').replace(/\D/g, '').length === 11 ? 9 : f.ie ? 1 : 2; $('#e-cf', m.el).checked = !!f.consumidor_final;
      ler(); const loc = localDestino(empFull.uf, N.destinatario.uf), x = nat(); if (x && N.itens.length) { N.itens.forEach(i => { i.cfop = (loc === 2 ? x.cfop_interestadual : x.cfop_interno) || i.cfop; }); toast('CFOP dos itens ajustado para o destino'); } itens(); };
    ['#e-frete', '#e-seg', '#e-out', '#e-cf'].forEach(s => $(s, m.el).onchange = () => { ler(); itens(); });
    $('#e-ger', m.el).onclick = () => { ler(); const T = C().totais, P = $('#e-prz', m.el).value.split(/[,;\s]+/).filter(Boolean).map(Number); if (!P.length) return toast('Informe os prazos em dias', true); N.duplicatas = parcelar(T.nota, P, N.data_emissao); dups(); };
    const gravar = async () => { ler(); const K = C();
      const d = { empresa_id: e, natureza_id: N.natureza_id, natureza_operacao: N.natureza_operacao, tipo_documento: N.tipo_documento, finalidade: N.finalidade, consumidor_final: N.consumidor_final, presenca: N.presenca ?? 9, data_emissao: new Date().toISOString(),
        favorecido_id: N.favorecido_id, destinatario: N.destinatario, itens: N.itens, transporte: N.transporte, valor_frete: N.valor_frete, valor_seguro: N.valor_seguro, valor_outras: N.valor_outras, duplicatas: N.duplicatas, forma_pagamento: N.forma_pagamento,
        referenciadas: N.referenciadas, info_complementar: N.info_complementar || null, totais: K.totais, valor_total: K.totais.nota, status: N.status === 'erro' ? 'erro' : 'rascunho' };
      N.data_emissao = d.data_emissao;
      if (N.id) await q(sb.from('nfe_emissoes').update(d).eq('id', N.id)); else { const r = await q(sb.from('nfe_emissoes').insert(d).select('id')); N.id = r[0].id; N.status = 'rascunho'; } };
    $('#e-prev', m.el).onclick = () => { ler(); baixarDanfe({ ...N, ambiente: cfg.ambiente }, true); };
    $('#e-salvar', m.el) && ($('#e-salvar', m.el).onclick = async (ev) => { ev.target.disabled = true; try { await gravar(); toast('Rascunho salvo'); m.close(); re(); } catch (err) { fail(err); ev.target.disabled = false; } });
    $('#e-del', m.el) && ($('#e-del', m.el).onclick = async () => { if (!await confirmDialog('Excluir este rascunho?')) return; try { await q(sb.from('nfe_emissoes').delete().eq('id', N.id)); m.close(); re(); } catch (err) { fail(err); } });
    $('#e-emitir', m.el) && ($('#e-emitir', m.el).onclick = async (ev) => { ler();
      const prob = validar(N, emit(), cfg); if (prob.length) { toast(prob[0] + (prob.length > 1 ? ` (+${prob.length - 1} pendência(s))` : ''), true); return; }
      const T = C().totais;
      if (!await confirmDialog(`Emitir a NF-e de ${money(T.nota)} para ${N.destinatario.nome} em ${cfg.ambiente === 'producao' ? 'PRODUÇÃO (com valor fiscal)' : 'homologação (teste)'}?`)) return;
      ev.target.disabled = true; ev.target.textContent = 'Enviando…';
      try { await gravar(); const r = await fn({ acao: 'emitir', nota_id: N.id, payload: payloadFocus(N, emit(), cfg) });
        toast(r.status === 'autorizada' ? `Nota nº ${r.numero} autorizada` : r.status === 'erro' ? 'Nota rejeitada: ' + (r.erros?.[0] || 'veja o motivo na lista') : 'Nota enviada: aguardando a SEFAZ. Clique em Consultar em instantes.', r.status === 'erro');
        m.close(); ui.filtro = 'todas'; re();
      } catch (err) { fail(err); ev.target.disabled = false; ev.target.textContent = 'Emitir'; } });
    itens();
  }

  // ------------------------------------------------------------ naturezas, parâmetros, inutilização
  function naturezas() {
    const m = modal({ title: 'Naturezas de operação', wide: true, body: `<p class="small muted" style="margin-top:0">Cada natureza guarda o CFOP, os CST e as alíquotas que entram nos itens da nota. As alíquotas devem ser definidas com a contabilidade; na nota, cada item ainda pode ser ajustado.</p>
      <div class="table-wrap"><table><thead><tr><th>Nome</th><th>CFOP</th><th>ICMS</th><th>IPI</th><th>PIS / COFINS</th><th>IBS / CBS</th><th></th></tr></thead><tbody>${nats.map(x => `<tr><td><b>${esc(x.nome)}</b>${x.ativo ? '' : ' <span class="nf-st muted">inativa</span>'}<div class="small muted">${esc(x.natureza_operacao)}</div></td><td>${esc(x.cfop_interno || '—')} / ${esc(x.cfop_interestadual || '—')}</td>
        <td>CST ${esc(x.icms_cst)} · ${nv(x.icms_aliquota_interna)}%</td><td>CST ${esc(x.ipi_cst)} · ${nv(x.ipi_aliquota)}%</td><td>CST ${esc(x.pis_cst)} · ${nv(x.pis_aliquota)}% / ${nv(x.cofins_aliquota)}%</td><td>${x.ibs_cbs_cst ? `CST ${esc(x.ibs_cbs_cst)} · ${esc(x.ibs_cbs_classificacao || '')}` : '—'}</td>
        <td><button class="btn ghost small" data-n="${x.id}">Editar</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nenhuma natureza cadastrada.</td></tr>'}</tbody></table></div>`,
      foot: `<button class="btn ghost" id="na-pad" style="margin-right:auto">Criar as naturezas de partida</button><button class="btn ghost" data-close>Fechar</button><button class="btn primary" id="na-nova">Nova natureza</button>` });
    $('#na-pad', m.el).onclick = async (ev) => { ev.target.disabled = true; try { const k = await q(sb.rpc('nfe_naturezas_padrao', { p_empresa: e })); toast(k ? `${k} natureza(s) criada(s). Preencha as alíquotas.` : 'As naturezas de partida já existem.'); m.close(); await re(); } catch (err) { fail(err); ev.target.disabled = false; } };
    const form = (x = {}) => { const f = (k, t, v, cl = '') => `<label class="${cl}">${t}<input id="n-${k}" value="${esc(v ?? '')}"></label>`, p = (k, t) => f(k, t, nv(x[k] ?? 0, 4).replace(/0{1,2}$/, ''));
      const m2 = modal({ title: x.id ? 'Editar natureza' : 'Nova natureza', body: `<div class="nf-g">${f('nome', 'Nome na lista', x.nome, 'c3')}${f('natureza_operacao', 'Texto que sai na nota', x.natureza_operacao, 'c3')}
        <label class="c2">Tipo<select id="n-tipo_documento"><option value="1" ${+(x.tipo_documento ?? 1) === 1 ? 'selected' : ''}>Saída</option><option value="0" ${+x.tipo_documento === 0 ? 'selected' : ''}>Entrada</option></select></label>
        <label class="c2">Finalidade<select id="n-finalidade">${Object.entries(FINALIDADE).map(([k, t]) => `<option value="${k}" ${+(x.finalidade ?? 1) === +k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>${f('cfop_interno', 'CFOP no estado', x.cfop_interno)}${f('cfop_interestadual', 'CFOP outro estado', x.cfop_interestadual)}
        ${f('icms_cst', 'CST ICMS', x.icms_cst ?? '00')}${p('icms_aliquota_interna', '% ICMS no estado')}${f('icms_aliquota_inter', '% ICMS outro estado', x.icms_aliquota_inter == null ? '' : nv(x.icms_aliquota_inter))}${p('icms_reducao', '% redução da base')}${f('ipi_cst', 'CST IPI', x.ipi_cst ?? '53')}${p('ipi_aliquota', '% IPI')}
        ${f('ipi_enquadramento', 'Enquadr. IPI', x.ipi_enquadramento ?? '999')}${f('pis_cst', 'CST PIS', x.pis_cst ?? '01')}${p('pis_aliquota', '% PIS')}${f('cofins_cst', 'CST COFINS', x.cofins_cst ?? '01')}${p('cofins_aliquota', '% COFINS')}<div></div>
        ${f('ibs_cbs_cst', 'CST IBS/CBS', x.ibs_cbs_cst)}${f('ibs_cbs_classificacao', 'cClassTrib (6 díg.)', x.ibs_cbs_classificacao)}${p('cbs_aliquota', '% CBS')}${p('ibs_uf_aliquota', '% IBS UF')}${p('ibs_mun_aliquota', '% IBS Município')}<div></div>
        <label class="c6">Informação complementar desta natureza<textarea id="n-info_complementar" rows="2">${esc(x.info_complementar || '')}</textarea></label>
        <label class="chk c6"><input type="checkbox" id="n-ativo" ${x.ativo === false ? '' : 'checked'}> Ativa</label></div>
        <p class="small muted">"% ICMS outro estado" em branco usa a regra geral (4% importado, 7% ou 12% conforme origem e destino). Sem CST de IBS/CBS, a nota sai sem o grupo da Reforma Tributária.</p>`,
        foot: '<button class="btn ghost" data-close>Voltar</button><button class="btn primary" id="n-ok">Salvar</button>' });
      $('#n-ok', m2.el).onclick = async (ev) => { const g = (k) => $('#n-' + k, m2.el).value.trim(), d = { empresa_id: e, ativo: $('#n-ativo', m2.el).checked, tipo_documento: +g('tipo_documento'), finalidade: +g('finalidade') };
        ['nome', 'natureza_operacao', 'cfop_interno', 'cfop_interestadual', 'icms_cst', 'ipi_cst', 'ipi_enquadramento', 'pis_cst', 'cofins_cst', 'ibs_cbs_cst', 'ibs_cbs_classificacao', 'info_complementar'].forEach(k => d[k] = g(k) || null);
        ['icms_aliquota_interna', 'icms_reducao', 'ipi_aliquota', 'pis_aliquota', 'cofins_aliquota', 'cbs_aliquota', 'ibs_uf_aliquota', 'ibs_mun_aliquota'].forEach(k => d[k] = pn(g(k)));
        d.icms_aliquota_inter = g('icms_aliquota_inter') === '' ? null : pn(g('icms_aliquota_inter'));
        if (!d.nome || !d.natureza_operacao) return toast('Informe o nome e o texto da natureza', true);
        ev.target.disabled = true; try { if (x.id) await q(sb.from('nfe_naturezas').update(d).eq('id', x.id)); else await q(sb.from('nfe_naturezas').insert(d)); toast('Natureza salva'); m2.close(); m.close(); await re(); } catch (err) { fail(err); ev.target.disabled = false; } }; };
    $('#na-nova', m.el).onclick = () => form();
    $$('[data-n]', m.el).forEach(b => b.onclick = () => form(nats.find(x => x.id === b.dataset.n)));
  }

  function parametros() {
    const PAP = [['financeiro', 'Financeiro'], ['diretor', 'Diretor'], ['compras', 'Compras'], ['vendas', 'Vendas']];
    const f = (k, t, cl = '', ph = '') => `<label class="${cl}">${t}<input id="p-${k}" value="${esc(cfg[k] ?? '')}" placeholder="${ph}"></label>`;
    const m = modal({ title: 'Parâmetros da emissão de NF-e', wide: true, body: `
      <h3 style="margin-top:0">Ambiente</h3><div class="nf-g"><label class="c2">Emitir em<select id="p-ambiente"><option value="homologacao" ${cfg.ambiente === 'homologacao' ? 'selected' : ''}>Homologação (testes)</option><option value="producao" ${cfg.ambiente === 'producao' ? 'selected' : ''}>Produção (valor fiscal)</option></select></label>
        <div class="c4" style="align-self:end;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn ghost" id="p-th">Testar homologação</button><button class="btn ghost" id="p-tp">Testar produção</button><span class="small" id="p-tr"></span></div></div>
      <p class="small muted">O token da Focus NFe não fica na plataforma: é gravado por você como segredo da função <b>focus-nfe</b> no Supabase (FOCUS_NFE_TOKEN_HOMOLOGACAO e FOCUS_NFE_TOKEN_PRODUCAO). Os botões acima conferem se a Focus aceita cada token.</p>
      <h3>Emitente (o que falta no cadastro da empresa)</h3>
      <p class="small" style="margin:0 0 6px">${esc(empFull.razao_social || empFull.nome || '')} · CNPJ ${esc(fmtDoc(empFull.cnpj || ''))} · IE ${esc(empFull.ie || '—')} · ${esc([empFull.logradouro, empFull.municipio, empFull.uf, empFull.cep].filter(Boolean).join(', '))}</p>
      <div class="nf-g">${f('nome_fantasia', 'Nome fantasia', 'c2')}${f('numero', 'Número')}${f('complemento', 'Complemento')}${f('bairro', 'Bairro')}${f('telefone', 'Telefone')}
        <label class="c2">Regime tributário (CRT)<select id="p-crt">${[[3, '3 - Regime normal'], [1, '1 - Simples Nacional'], [2, '2 - Simples, excesso de sublimite'], [4, '4 - MEI']].map(([k, t]) => `<option value="${k}" ${+cfg.crt === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>${f('serie', 'Série')}</div>
      <h3>Padrões da nota</h3><div class="nf-g"><label class="c2">Natureza padrão<select id="p-natureza_padrao_id">${options(nats, { label: 'nome', selected: cfg.natureza_padrao_id, empty: 'Nenhuma' })}</select></label>
        <label class="c2">Frete padrão<select id="p-modalidade_frete">${Object.entries(FRETE).map(([k, t]) => `<option value="${k}" ${+cfg.modalidade_frete === +k ? 'selected' : ''}>${k} - ${t}</option>`).join('')}</select></label>
        <label class="c2">Forma de pagamento padrão<select id="p-forma_pagamento">${Object.entries(PAGAMENTO).map(([k, t]) => `<option value="${k}" ${cfg.forma_pagamento === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="c2">Prazos das duplicatas (dias)<input id="p-prazos" value="${esc((cfg.prazos_padrao || []).join(', '))}" placeholder="ex.: 28, 35, 42"></label>${f('email_copia', 'E-mail que recebe cópia', 'c2')}
        <label class="chk c2" style="align-self:end"><input type="checkbox" id="p-enviar_email_destinatario" ${cfg.enviar_email_destinatario ? 'checked' : ''}> Enviar XML e DANFE ao cliente ao autorizar</label>
        <label class="c6">Texto fixo das informações complementares<textarea id="p-info_padrao" rows="2">${esc(cfg.info_padrao || '')}</textarea></label></div>
      <h3>Cálculo e DANFE</h3>
      <label class="chk"><input type="checkbox" id="p-pis_cofins_exclui_icms" ${cfg.pis_cofins_exclui_icms ? 'checked' : ''}> Tirar o ICMS da base do PIS e da COFINS</label>
      <label class="chk" style="margin-top:6px"><input type="checkbox" id="p-ibs_cbs_exclui_tributos" ${cfg.ibs_cbs_exclui_tributos ? 'checked' : ''}> Tirar ICMS, PIS e COFINS da base do IBS e da CBS</label>
      <label class="chk" style="margin-top:6px"><input type="checkbox" id="p-danfe_logo" ${cfg.danfe_logo ? 'checked' : ''}> Logo da empresa no DANFE</label>
      <h3>Quem emite, além do administrador</h3><div style="display:flex;gap:14px;flex-wrap:wrap">${PAP.map(([k, t]) => `<label class="chk"><input type="checkbox" data-pp="${k}" ${cfg.papeis.includes(k) ? 'checked' : ''}>${t}</label>`).join('')}</div>`,
      foot: '<button class="btn ghost" data-close>Voltar</button><button class="btn primary" id="p-ok">Salvar</button>' });
    const testar = async (amb, b) => { b.disabled = true; $('#p-tr', m.el).textContent = 'Testando…'; try { const r = await fn({ acao: 'testar', ambiente: amb }); $('#p-tr', m.el).innerHTML = `<b class="${r.ok ? 'pos' : 'neg'}">${esc(r.motivo || '')}</b>`; } catch (err) { $('#p-tr', m.el).innerHTML = `<b class="neg">${esc(err.message)}</b>`; } b.disabled = false; };
    $('#p-th', m.el).onclick = (ev) => testar('homologacao', ev.target); $('#p-tp', m.el).onclick = (ev) => testar('producao', ev.target);
    $('#p-ok', m.el).onclick = async (ev) => { const g = (k) => $('#p-' + k, m.el).value.trim(), ck = (k) => $('#p-' + k, m.el).checked;
      const d = { empresa_id: e, ambiente: g('ambiente'), crt: +g('crt'), serie: g('serie') || '1', natureza_padrao_id: g('natureza_padrao_id') || null, modalidade_frete: +g('modalidade_frete'), forma_pagamento: g('forma_pagamento'),
        prazos_padrao: $('#p-prazos', m.el).value.split(/[,;\s]+/).filter(Boolean).map(Number).filter(x => x >= 0), info_padrao: g('info_padrao') || null, email_copia: g('email_copia') || null, enviar_email_destinatario: ck('enviar_email_destinatario'),
        pis_cofins_exclui_icms: ck('pis_cofins_exclui_icms'), ibs_cbs_exclui_tributos: ck('ibs_cbs_exclui_tributos'), danfe_logo: ck('danfe_logo'), papeis: $$('[data-pp]:checked', m.el).map(x => x.dataset.pp), atualizado_em: new Date().toISOString() };
      ['nome_fantasia', 'numero', 'complemento', 'bairro', 'telefone'].forEach(k => d[k] = g(k) || null);
      if (d.ambiente === 'producao' && cfg.ambiente !== 'producao' && !await confirmDialog('Passar para PRODUÇÃO? A partir de agora as notas emitidas terão valor fiscal. Faça isso só depois de testar em homologação e validar os impostos com a contabilidade.')) return;
      ev.target.disabled = true; try { await q(sb.from('nfe_config').upsert(d)); toast('Parâmetros salvos'); m.close(); re(); } catch (err) { fail(err); ev.target.disabled = false; } };
  }

  function inutilizar() {
    const m = modal({ title: 'Inutilizar numeração', narrow: true, body: `<p class="small muted" style="margin-top:0">Use quando um número foi pulado e não será usado. A inutilização é registrada na SEFAZ no ambiente atual (${cfg.ambiente === 'producao' ? 'produção' : 'homologação'}) e não pode ser desfeita.</p>
      <div class="nf-g"><label class="c2">Série<input id="i-s" value="${esc(cfg.serie)}"></label><label class="c2">Do número<input id="i-a" type="number"></label><label class="c2">Até o número<input id="i-b" type="number"></label>
      <label class="c6">Justificativa (mínimo 15 caracteres)<textarea id="i-j" rows="2"></textarea></label></div>`, foot: '<button class="btn ghost" data-close>Voltar</button><button class="btn primary" id="i-ok">Inutilizar</button>' });
    $('#i-ok', m.el).onclick = async (ev) => { const a = +$('#i-a', m.el).value, b = +$('#i-b', m.el).value || a, j = $('#i-j', m.el).value.trim();
      if (!(a > 0) || b < a) return toast('Informe a faixa de números', true); if (j.length < 15) return toast('Justificativa com ao menos 15 caracteres', true);
      if (!await confirmDialog(`Inutilizar os números ${a} a ${b} da série ${$('#i-s', m.el).value}?`)) return;
      ev.target.disabled = true; try { const r = await fn({ acao: 'inutilizar', serie: $('#i-s', m.el).value, numero_inicial: a, numero_final: b, justificativa: j }); if (!r.ok) throw new Error((r.erros || []).join(' · ') || 'A SEFAZ não aceitou.'); toast('Numeração inutilizada'); m.close(); } catch (err) { fail(err); ev.target.disabled = false; } };
  }
}
