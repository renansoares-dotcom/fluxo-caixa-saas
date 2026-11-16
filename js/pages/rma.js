// Financeiro › RMA — Recuperação Judicial (FIN026, SQL 162): o Relatório Mensal de Atividades da empresa em recuperação judicial.
// Função ativada por empresa (desligada, some do menu de quem não é administrador). Um pacote por mês de competência com a
// lista de documentos pedidos pelo escritório que acompanha a recuperação: os que a plataforma gera (fluxo de caixa, contas a
// pagar e a receber, faturamento, notas emitidas, vendas e contratos) saem em PDF e Excel com nome padronizado; os demais são
// anexados. Situação de cada documento, prazo, pacote em .zip, registro do envio e reabertura. Pedido do Renan em 16/11/2026.
import { sb, state, q, loadCadastros } from '../lib/data.js';
import { $, $$, esc, toast, fail, modal, dateBR, today, confirmDialog } from '../lib/ui.js';
import { kpiGrid } from '../lib/componentes.js';
import { STATUS, FONTES, mesNome, mesCurto, fimMes, mesesDevidos, prazoMes, nomeArquivo, resumoMes, alertas, contasDoRma, contasAbertasNoMes } from '../lib/rma.js';
import { contexto, guardar as guardarArq, gerarDocumento, gerarExtratos, travasAtivas } from '../lib/rma-gerar.js';

export const title = 'RMA — Recuperação Judicial';
const CFG0 = { ativo: false, auto_extrato: true, auto_relatorios: true, contas_fora: [], papeis: ['financeiro', 'diretor'], sigla: '', processo: '', vara: '', escritorio: '', contato_nome: '', contato_email: '', mes_inicio: null, dia_entrega: 20, dias_aviso: 5, avisar: true };
const ui = { mes: null };
const SIT = { nao_aberto: ['Não aberto', ''], andamento: ['Em andamento', 'warn'], pronto: ['Pronto para enviar', 'info'], atrasado: ['Atrasado', 'neg'], enviado: ['Enviado', 'pos'] };
const CSS = `<style>
  .rm-st{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap;background:var(--surface-2);color:var(--muted)}
  .rm-st.pos{background:color-mix(in srgb,var(--pos) 14%,transparent);color:var(--pos)}.rm-st.warn{background:color-mix(in srgb,var(--warn) 16%,transparent);color:var(--warn)}
  .rm-st.neg{background:color-mix(in srgb,var(--neg) 14%,transparent);color:var(--neg)}.rm-st.info{background:color-mix(in srgb,var(--primary) 14%,transparent);color:var(--primary)}
  .rm-meses{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:8px;margin-bottom:12px}
  .rm-mes{border:1px solid var(--border);border-radius:10px;padding:8px 10px;background:var(--surface);cursor:pointer;font-size:12px}.rm-mes:hover{border-color:var(--primary)}
  .rm-mes.on{border-color:var(--primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--primary) 25%,transparent)}.rm-mes b{display:block;font-size:14px;text-transform:capitalize}
  .rm-bar{height:6px;border-radius:6px;background:var(--surface-2);overflow:hidden;margin:6px 0 4px}.rm-bar i{display:block;height:100%;background:var(--pos)}
  .rm-arq{display:flex;gap:6px;align-items:center;font-size:12px;margin:2px 0}.rm-arq a{overflow-wrap:anywhere}.rm-arq button{border:0;background:none;color:var(--muted);cursor:pointer;padding:0 4px}
  .rm-g{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}.rm-g .c2{grid-column:span 2}.rm-g .c3{grid-column:span 3}.rm-g .c4{grid-column:span 4}.rm-g .c6{grid-column:span 6}
  @media(max-width:800px){.rm-g{grid-template-columns:1fr 1fr}.rm-g .c3,.rm-g .c4,.rm-g .c6{grid-column:span 2}}
  .modal label.chk{flex-direction:row;align-items:center;gap:8px;font-weight:400;font-size:13px}.modal label.chk input{width:auto;min-height:0}
</style>`;
const JSZIP = new URL('../../vendor/jszip-3.10.1.min.js', import.meta.url).href;
let zipP = null;
const carregarZip = () => globalThis.JSZip ? Promise.resolve(globalThis.JSZip) : (zipP ??= new Promise((ok, erro) => { const sc = document.createElement('script'); sc.src = JSZIP;
  sc.onload = () => ok(globalThis.JSZip); sc.onerror = () => { zipP = null; erro(new Error('Não foi possível carregar o compactador de arquivos.')); }; document.head.appendChild(sc); }));
const nv = (v) => (+v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function dados(e) {
  const C = await contexto(e), cfg = { ...CFG0, ...(C.cfg || {}), _existe: !!C.cfg };
  if (!cfg.ativo) return { ...C, cfg, pode: false };
  C.meses.sort((a, b) => b.mes.localeCompare(a.mes));
  return { ...C, cfg, pode: !!(await q(sb.rpc('rma_pode', { p_empresa: e }))) };
}

/** alertas para a Central de Decisões (regra 30) */
export async function alertasDecisao() {
  try { const D = await dados(state.empresa.id); return alertas(D.cfg, D.meses, D.ent, D.docs, today()); } catch { return []; }
}

export async function render(root) {
  const e = state.empresa.id, hoje = today(), admin = state.papel === 'admin';
  const prm = new URLSearchParams(location.hash.split('?')[1] || '');
  if (/^\d{4}-\d{2}$/.test(prm.get('mes') || '')) ui.mes = prm.get('mes') + '-01';
  root.innerHTML = `${CSS}<div class="mm-topo"><div><h2 style="margin:0">RMA — Relatório Mensal de Atividades</h2><div class="muted small">O que a empresa em recuperação judicial entrega todo mês: documentos, prazo e registro do envio.</div></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap" id="rm-acoes"></div></div><div id="rm-corpo"><div class="loading">Carregando…</div></div>`;
  const corpo = $('#rm-corpo', root);
  let D;
  try { await loadCadastros().catch(() => {}); D = await dados(e); }
  catch (err) { fail(err); corpo.innerHTML = '<div class="card"><div class="empty">Não foi possível carregar. Confira se o SQL 162 (RMA) já foi executado.</div></div>'; return; }
  const re = () => render(root), cfg = D.cfg, pode = D.pode, empresaNome = state.empresa?.razao_social || state.empresa?.nome || '';

  if (!cfg.ativo) {
    corpo.innerHTML = `<div class="card"><h3 style="margin-top:0">O RMA está desligado nesta empresa</h3>
      <p>Esta função é para a empresa em <b>recuperação judicial</b>, que precisa entregar todo mês um conjunto de documentos ao Administrador Judicial ou ao escritório que acompanha o processo. Quem não está nessa situação não precisa ativá-la.</p>
      <p class="muted small">Ativada, a tela cria um pacote por mês com a lista de documentos, gera os que saem da plataforma, guarda os anexos, controla o prazo e registra o envio.</p>
      ${admin ? '<button class="btn primary" id="rm-ativar">Ativar o RMA para esta empresa</button>' : '<p class="small">Só o administrador ativa.</p>'}</div>`;
    $('#rm-ativar', corpo) && ($('#rm-ativar', corpo).onclick = () => parametros(true));
    return;
  }
  const mesesK = mesesDevidos(cfg.mes_inicio, hoje), M = Object.fromEntries(D.meses.map(m => [m.mes, m]));
  if (!ui.mes || !mesesK.includes(ui.mes)) ui.mes = mesesK.find(k => M[k]?.status !== 'enviado') || mesesK[0] || null;
  const entDe = (k) => D.ent.filter(x => x.mes === k), R = (k) => resumoMes(M[k], entDe(k), D.docs, hoje), docDe = (id) => D.docs.find(d => d.id === id);
  const AL = alertas(cfg, D.meses, D.ent, D.docs, hoje);

  $('#rm-acoes', root).innerHTML = `${admin ? '<button class="btn ghost" id="rm-par">Parâmetros</button>' : ''}${pode ? '<button class="btn ghost" id="rm-docs">Documentos pedidos</button>' : ''}`;
  $('#rm-par', root) && ($('#rm-par', root).onclick = () => parametros(false));
  $('#rm-docs', root) && ($('#rm-docs', root).onclick = documentos);

  if (!D.docs.length) { corpo.innerHTML = `<div class="card"><div class="empty">Nenhum documento na lista do RMA.${admin ? ' <button class="btn primary small" id="rm-padrao">Criar a lista padrão</button>' : ' Peça ao administrador para criar a lista.'}</div></div>`;
    $('#rm-padrao', corpo) && ($('#rm-padrao', corpo).onclick = async () => { try { const n = await q(sb.rpc('rma_documentos_padrao', { p_empresa: e })); toast(`${n} documento(s) incluído(s).`); re(); } catch (err) { fail(err); } }); return; }
  if (!mesesK.length) { corpo.innerHTML = `<div class="card"><div class="empty">O primeiro mês de competência do RMA é ${mesNome(cfg.mes_inicio)}. O pacote é aberto quando o mês termina.</div></div>`; return; }

  const k = ui.mes, mes = M[k], r = R(k), enviado = mes?.status === 'enviado', edita = pode && mes && !enviado;
  const ents = entDe(k).map(x => ({ ...x, doc: docDe(x.documento_id) })).filter(x => x.doc).sort((a, b) => a.doc.ordem - b.doc.ordem);
  const contasRma = contasDoRma(state.cad?.contas || [], cfg), abertasNoMes = contasAbertasNoMes(k, state.cad?.contas || [], travasAtivas(D), cfg), bancosOk = contasRma.length > 0 && !abertasNoMes.length;
  const arqDe = (id) => D.arqs.filter(a => a.entrega_id === id);
  const grupos = [...new Set(ents.map(x => x.doc.grupo))];
  const enviados = mesesK.filter(x => M[x]?.status === 'enviado').length, atras = mesesK.filter(x => R(x).situacao === 'atrasado' || (!M[x] && prazoMes(x, cfg.dia_entrega) < hoje)).length;

  corpo.innerHTML = `<div id="rm-k"></div>
    ${AL.length ? `<div class="card" style="margin-top:12px;border-left:4px solid var(--${AL.some(a => a.nivel === 'alto') ? 'neg' : 'warn'})"><b>Prazos</b><ul style="margin:6px 0 0;padding-left:18px">${AL.slice(0, 8).map(a => `<li><a href="#" data-mes="${a.mes}">${esc(a.texto)}</a></li>`).join('')}</ul></div>` : ''}
    <h3>Meses de competência</h3><div class="rm-meses">${mesesK.map(x => { const s = R(x), pz = M[x]?.prazo || prazoMes(x, cfg.dia_entrega), sit = !M[x] && pz < hoje ? 'atrasado' : s.situacao;
      return `<div class="rm-mes ${x === k ? 'on' : ''}" data-mes="${x}"><b>${esc(mesNome(x).replace(' de ', '/').replace(/^(\w{3})\w*/, '$1'))}</b><span class="rm-st ${SIT[sit][1]}">${SIT[sit][0]}</span>
        <div class="rm-bar"><i style="width:${s.pct}%"></i></div><span class="muted">${M[x] ? `${s.pronto + s.nao_aplica} de ${s.total}` : 'pacote não aberto'} · prazo ${dateBR(pz).slice(0, 5)}</span></div>`; }).join('')}</div>
    <div class="card"><div style="display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap"><div style="flex:1;min-width:240px"><h2 style="margin:0">${esc(mesNome(k).replace(/^./, c => c.toUpperCase()))} <span class="rm-st ${SIT[r.situacao][1]}">${SIT[r.situacao][0]}</span></h2>
        <div class="small muted">${mes ? `Entregar até ${dateBR(mes.prazo)}${enviado ? ` · enviado em ${dateBR(String(mes.enviado_em).slice(0, 10))}${mes.protocolo ? ` · protocolo ${esc(mes.protocolo)}` : ''}` : r.dias < 0 ? ` · ${-r.dias} dia(s) de atraso` : ` · faltam ${r.dias} dia(s)`}` : `Prazo: ${dateBR(prazoMes(k, cfg.dia_entrega))}`}${cfg.escritorio ? ` · para ${esc(cfg.escritorio)}` : ''}</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${!mes && pode ? '<button class="btn primary" id="rm-abrir">Abrir o pacote do mês</button>' : ''}
          ${edita ? '<button class="btn" id="rm-gerar">Gerar os relatórios da plataforma</button>' : ''}${mes && D.arqs.some(a => ents.some(x => x.id === a.entrega_id)) ? '<button class="btn ghost" id="rm-zip">Baixar o pacote (.zip)</button>' : ''}
          ${edita ? `<button class="btn primary" id="rm-enviar" ${r.faltam ? 'title="Ainda há documento obrigatório pendente"' : ''}>Registrar o envio</button>` : ''}${pode && enviado ? '<button class="btn ghost" id="rm-reabrir">Reabrir o mês</button>' : ''}</div></div>
      ${mes && contasRma.length ? `<p class="small" style="margin:8px 0 0"><b>Bancos do mês:</b> ${bancosOk ? `<span class="pos">todas as ${contasRma.length} conta(s) fechadas até ${dateBR(fimMes(k))}</span>` : `${contasRma.length - abertasNoMes.length} de ${contasRma.length} conta(s) fechadas até ${dateBR(fimMes(k))}; em aberto: ${esc(abertasNoMes.map(c => c.nome).join(', '))}`}.
        ${cfg.auto_extrato ? ' O extrato entra aqui sozinho quando a conta é fechada.' : ''}${cfg.auto_relatorios ? ' Os demais relatórios são gerados quando todas estiverem fechadas.' : ''}</p>` : ''}
      ${mes?.comentario ? `<p class="small" style="white-space:pre-wrap;margin:8px 0 0"><b>Comentários da administração:</b> ${esc(mes.comentario)}</p>` : ''}</div>
    ${!mes ? `<div class="card" style="margin-top:12px"><div class="empty">O pacote de ${esc(mesNome(k))} ainda não foi aberto.${pode ? ' Abra para criar a lista de documentos do mês.' : ''}</div></div>` : `
    <div class="card flush" style="margin-top:12px"><div class="table-wrap"><table><thead><tr><th style="width:44px">Nº</th><th>Documento</th><th>De onde vem</th><th>Arquivos</th><th>Situação</th><th></th></tr></thead><tbody>
    ${grupos.map(g => `<tr><td colspan="6" class="small muted" style="background:var(--surface-2)"><b>${esc(g)}</b></td></tr>` + ents.filter(x => x.doc.grupo === g).map(x => { const A = arqDe(x.id), ger = x.doc.fonte !== 'anexo';
      return `<tr><td><b>${esc(x.doc.codigo)}</b></td><td class="wrap"><b>${esc(x.doc.nome)}</b>${x.doc.obrigatorio ? '' : ' <span class="small muted">(opcional)</span>'}${x.doc.orientacao ? `<div class="small muted">${esc(x.doc.orientacao)}</div>` : ''}${x.observacao ? `<div class="small">Obs.: ${esc(x.observacao)}</div>` : ''}</td>
        <td class="small wrap" style="width:180px">${x.doc.fonte === 'extrato_conta' ? `<span class="rm-st info">Automático ao fechar o banco</span><div class="muted">${contasRma.length - abertasNoMes.length} de ${contasRma.length} conta(s) fechada(s) no mês</div>${abertasNoMes.length ? `<div class="warn">falta: ${esc(abertasNoMes.slice(0, 4).map(c => c.nome).join(', '))}${abertasNoMes.length > 4 ? ` e mais ${abertasNoMes.length - 4}` : ''}</div>` : ''}<div><a href="#/fechamento">abrir o Fechamento do Mês</a></div>`
          : ger ? `<span class="rm-st info">Gerado pela plataforma</span><div class="muted">${esc(FONTES[x.doc.fonte])}</div>` : `Anexo${x.doc.tela ? `<div><a href="#/${esc(x.doc.tela)}">abrir a tela de origem</a></div>` : ''}`}<div class="muted">${esc(x.doc.formatos.map(f => f.toUpperCase()).join(' e '))}</div></td>
        <td class="wrap" style="overflow-wrap:anywhere">${A.map(a => `<div class="rm-arq"><a href="#" data-abrir="${esc(a.caminho)}" data-nome="${esc(a.nome)}">${esc(a.nome)}</a>${edita ? `<button data-xa="${a.id}" title="Excluir o arquivo">✕</button>` : ''}</div>`).join('') || (x.status === 'nao_aplica' ? `<span class="small muted">${esc(x.justificativa || '')}</span>` : '<span class="small muted">nenhum arquivo</span>')}</td>
        <td><span class="rm-st ${STATUS[x.status][1]}">${STATUS[x.status][0]}</span></td>
        <td class="wrap" style="width:140px">${edita ? `${ger ? `<button class="btn small" data-ger="${x.id}">Gerar</button> ` : ''}<button class="btn ghost small" data-anx="${x.id}">Anexar</button> <button class="btn ghost small" data-mais="${x.id}">${x.status === 'nao_aplica' ? 'Voltar a pendente' : 'Não se aplica'}</button>` : ''}</td></tr>`; }).join('')).join('')}
    </tbody></table></div></div><input type="file" id="rm-file" multiple hidden accept=".pdf,.xlsx,.xls,.csv,.txt,.zip,.png,.jpg,.jpeg,.docx">
    <p class="small muted">Os arquivos seguem o padrão <b>${esc(nomeArquivo(cfg.sigla, k, { codigo: 'NN', arquivo: 'Documento' }, 'pdf'))}</b>: sigla da empresa, mês de competência, número e nome do documento. O anexo é renomeado para o padrão ao entrar.</p>`}`;

  kpiGrid($('#rm-k', corpo), [
    { id: 'm', label: 'Meses a entregar', valor: String(mesesK.length), sub: `desde ${mesCurto(cfg.mes_inicio)}` },
    { id: 'e', label: 'Enviados', valor: String(enviados), sub: `${mesesK.length - enviados} em aberto`, tom: enviados === mesesK.length ? 'pos' : '' },
    { id: 'a', label: 'Em atraso', valor: String(atras), sub: atras ? 'prazo vencido sem envio' : 'nenhum prazo vencido', tom: atras ? 'neg' : '' },
    { id: 'd', label: `Documentos de ${mesCurto(k)}`, valor: mes ? `${r.pronto + r.nao_aplica} de ${r.total}` : '—', sub: mes ? (r.faltam ? `${r.faltam} obrigatório(s) pendente(s)` : 'nada pendente') : 'pacote não aberto', tom: mes && r.faltam ? 'warn' : '' },
  ]);
  $$('[data-mes]', corpo).forEach(a => a.onclick = (ev) => { ev.preventDefault(); ui.mes = a.dataset.mes; re(); });
  const on = (s, f) => $(s, corpo) && ($(s, corpo).onclick = f);
  on('#rm-abrir', async () => { try { const n = await q(sb.rpc('rma_abrir_mes', { p_empresa: e, p_mes: k })); toast(`Pacote aberto com ${n} documento(s).`); re(); } catch (err) { fail(err); } });
  on('#rm-gerar', async (ev) => { const L = ents.filter(x => x.doc.fonte !== 'anexo' && x.status !== 'nao_aplica'); if (!L.length) return toast('Nenhum documento desta lista é gerado pela plataforma.', true);
    ev.target.disabled = true; let ok = 0; const erros = [];
    for (const x of L) { ev.target.textContent = `Gerando ${x.doc.codigo}…`; try { await gerar(x); ok++; } catch (err) { if (x.doc.fonte !== 'extrato_conta') erros.push(`${x.doc.codigo}: ${err.message || err}`); } }
    toast(`${ok} documento(s) gerado(s)${erros.length ? `; ${erros.length} com erro` : ''}.`, !!erros.length); if (erros.length) console.warn('[RMA]', erros); re(); });
  $$('[data-ger]', corpo).forEach(b => b.onclick = async () => { b.disabled = true; b.textContent = 'Gerando…'; try { await gerar(ents.find(x => x.id === b.dataset.ger)); toast('Documento gerado.'); re(); } catch (err) { fail(err); b.disabled = false; b.textContent = 'Gerar'; } });
  let alvo = null;
  $$('[data-anx]', corpo).forEach(b => b.onclick = () => { alvo = ents.find(x => x.id === b.dataset.anx); $('#rm-file', corpo).value = ''; $('#rm-file', corpo).click(); });
  $('#rm-file', corpo) && ($('#rm-file', corpo).onchange = async (ev) => { const F = [...ev.target.files]; if (!F.length || !alvo) return;
    try { let seq = arqDe(alvo.id).filter(a => a.origem === 'anexo').length;
      for (const f of F) { if (f.size > 26214400) throw new Error(`"${f.name}" passa de 25 MB.`); seq++; const ext = (f.name.split('.').pop() || 'pdf').toLowerCase();
        await guardar(alvo, f, nomeArquivo(cfg.sigla, k, alvo.doc, ext, F.length > 1 || seq > 1 ? seq : 0), 'anexo', f.type || 'application/octet-stream'); }
      toast(`${F.length} arquivo(s) anexado(s).`); re(); } catch (err) { fail(err); re(); } });
  $$('[data-xa]', corpo).forEach(b => b.onclick = async () => { const a = D.arqs.find(x => x.id === b.dataset.xa); if (!await confirmDialog(`Excluir "${a.nome}"?`)) return;
    try { await sb.storage.from('rma').remove([a.caminho]); await q(sb.from('rma_arquivos').delete().eq('id', a.id)); re(); } catch (err) { fail(err); } });
  $$('[data-abrir]', corpo).forEach(a => a.onclick = async (ev) => { ev.preventDefault(); const { data, error } = await sb.storage.from('rma').createSignedUrl(a.dataset.abrir, 600, { download: a.dataset.nome }); if (error) return fail(error); window.open(data.signedUrl, '_blank', 'noopener'); });
  $$('[data-mais]', corpo).forEach(b => b.onclick = () => { const x = ents.find(y => y.id === b.dataset.mais);
    if (x.status === 'nao_aplica') return q(sb.from('rma_entregas').update({ status: arqDe(x.id).length ? 'pronto' : 'pendente' }).eq('id', x.id)).then(re).catch(fail);
    modal({ title: `${x.doc.codigo} — não se aplica em ${mesCurto(k)}`, narrow: true, body: `<p class="small muted">${esc(x.doc.nome)}</p><label>Motivo (vai junto com o pacote)<textarea id="rm-just" rows="3" placeholder="Ex.: sem constrições judiciais no período."></textarea></label>`,
      foot: '<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="rm-sj">Salvar</button>',
      onMount: (m, close) => { $('#rm-sj', m).onclick = async () => { const t = $('#rm-just', m).value.trim(); if (!t) return toast('Informe o motivo.', true);
        try { await q(sb.from('rma_entregas').update({ status: 'nao_aplica', justificativa: t }).eq('id', x.id)); close(); re(); } catch (err) { fail(err); } }; } }); });
  on('#rm-zip', async (ev) => { ev.target.disabled = true; ev.target.textContent = 'Montando…';
    try { const JSZip = await carregarZip(), zip = new JSZip(), pasta = zip.folder(`${cfg.sigla.toUpperCase()}_RMA_${k.slice(0, 7)}`), linhas = [`RMA — ${empresaNome}`, `Competência: ${mesNome(k)}`, cfg.processo ? `Processo nº ${cfg.processo}` : '', ''];
      for (const x of ents) { const A = arqDe(x.id); linhas.push(`${x.doc.codigo} ${x.doc.nome}: ${x.status === 'nao_aplica' ? 'NÃO SE APLICA — ' + (x.justificativa || '') : A.length ? A.map(a => a.nome).join(', ') : 'PENDENTE'}`);
        for (const a of A) { const { data, error } = await sb.storage.from('rma').download(a.caminho); if (error) throw error; pasta.file(a.nome, data); } }
      if (mes.comentario) linhas.push('', 'Comentários da administração:', mes.comentario);
      pasta.file('00_Indice_do_pacote.txt', linhas.filter((l, i) => l !== '' || i > 2).join('\r\n'));
      const blob = await zip.generateAsync({ type: 'blob' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${cfg.sigla.toUpperCase()}_RMA_${k.slice(0, 7)}.zip`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (err) { fail(err); } ev.target.disabled = false; ev.target.textContent = 'Baixar o pacote (.zip)'; });
  on('#rm-enviar', () => { const pend = ents.filter(x => x.status === 'pendente');
    modal({ title: `Registrar o envio do RMA de ${mesCurto(k)}`, body: `${pend.some(x => x.doc.obrigatorio) ? `<div class="card" style="border-left:4px solid var(--neg)"><b>Ainda falta documento obrigatório:</b><ul style="margin:4px 0 0;padding-left:18px">${pend.filter(x => x.doc.obrigatorio).map(x => `<li>${esc(x.doc.codigo)} ${esc(x.doc.nome)}</li>`).join('')}</ul></div>` : ''}
        <p class="small muted">Registre aqui depois de enviar o pacote${cfg.escritorio ? ` a ${esc(cfg.escritorio)}` : ''}${cfg.contato_email ? ` (${esc(cfg.contato_email)})` : ''}. O mês fica travado; para trocar um arquivo, reabra.</p>
        <label>Protocolo ou referência do envio (opcional)<input id="rm-prot" placeholder="nº do protocolo, data e hora do e-mail…"></label><label>Comentários da administração sobre o mês (opcional)<textarea id="rm-com" rows="4">${esc(mes.comentario || '')}</textarea></label>`,
      foot: '<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="rm-se">Registrar o envio</button>',
      onMount: (m, close) => { $('#rm-se', m).onclick = async () => { try { await q(sb.rpc('rma_enviar', { p_empresa: e, p_mes: k, p_protocolo: $('#rm-prot', m).value, p_comentario: $('#rm-com', m).value })); close(); toast('Envio registrado.'); re(); } catch (err) { fail(err); } }; } }); });
  on('#rm-reabrir', () => modal({ title: `Reabrir o RMA de ${mesCurto(k)}`, narrow: true, body: '<label>Motivo<textarea id="rm-mot" rows="3"></textarea></label>', foot: '<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="rm-sr">Reabrir</button>',
    onMount: (m, close) => { $('#rm-sr', m).onclick = async () => { try { await q(sb.rpc('rma_reabrir', { p_empresa: e, p_mes: k, p_motivo: $('#rm-mot', m).value })); close(); toast('Mês reaberto.'); re(); } catch (err) { fail(err); } }; } }));

  const guardar = (x, blob, nome, origem, tipo) => guardarArq(D, x, k, blob, nome, origem, tipo);
  async function gerar(x) {
    if (x.doc.fonte !== 'extrato_conta') return gerarDocumento(D, x, x.doc, k);
    const r = await gerarExtratos(D, x, x.doc, k);
    if (!r.gerados.length) throw new Error(`Nenhuma conta está fechada até ${dateBR(fimMes(k))}. Feche o banco em Financeiro › Fechamento do Mês.`);
    return r;
  }

  // ------------------------------------------------------------ lista de documentos e parâmetros
  function documentos() {
    const linha = (d) => `<tr data-id="${d.id || ''}"><td><input name="codigo" value="${esc(d.codigo || '')}" style="width:54px" maxlength="8"></td><td><input name="grupo" value="${esc(d.grupo || 'Geral')}" style="min-width:150px"></td><td><input name="nome" value="${esc(d.nome || '')}" style="min-width:260px"></td>
      <td><input name="arquivo" value="${esc(d.arquivo || '')}" style="min-width:150px"></td><td><select name="fonte">${Object.entries(FONTES).map(([f, t]) => `<option value="${f}" ${d.fonte === f ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></td>
      <td><select name="formatos"><option value="pdf" ${String(d.formatos) === 'pdf' ? 'selected' : ''}>PDF</option><option value="pdf,xlsx" ${String(d.formatos) === 'pdf,xlsx' ? 'selected' : ''}>PDF e Excel</option><option value="xlsx" ${String(d.formatos) === 'xlsx' ? 'selected' : ''}>Excel</option></select></td>
      <td style="text-align:center"><input type="checkbox" name="obrigatorio" ${d.obrigatorio !== false ? 'checked' : ''}></td><td style="text-align:center"><input type="checkbox" name="ativo" ${d.ativo !== false ? 'checked' : ''}></td></tr>`;
    modal({ title: 'Documentos pedidos no RMA', wide: true, body: `<p class="small muted">A lista vale para os pacotes abertos daqui em diante; num mês já aberto, use "Abrir o pacote" de novo para incluir um documento novo. "Nome do arquivo" é o trecho que entra no nome padronizado.</p>
        <div class="table-wrap"><table class="rm-docs"><thead><tr><th>Nº</th><th>Grupo</th><th>Documento</th><th>Nome do arquivo</th><th>De onde vem</th><th>Formato</th><th>Obrig.</th><th>Ativo</th></tr></thead><tbody id="rm-dl">${D.docs.map(linha).join('')}</tbody></table></div>
        ${admin ? '<p><button class="btn ghost small" id="rm-nd">+ Documento</button></p>' : '<p class="small muted">Só o administrador altera a lista.</p>'}`,
      foot: `<button class="btn ghost" data-close>Fechar</button>${admin ? '<button class="btn primary" id="rm-sd">Salvar a lista</button>' : ''}`,
      onMount: (m, close) => { if (!admin) $$('input,select', m).forEach(i => i.disabled = true);
        $('#rm-nd', m) && ($('#rm-nd', m).onclick = () => $('#rm-dl', m).insertAdjacentHTML('beforeend', linha({ codigo: String(D.docs.length + 2).padStart(2, '0'), fonte: 'anexo', formatos: ['pdf'] })));
        $('#rm-sd', m) && ($('#rm-sd', m).onclick = async () => { try { let ordem = 0;
          for (const tr of $$('#rm-dl tr', m)) { ordem += 10; const g = (nm) => $(`[name=${nm}]`, tr), row = { codigo: g('codigo').value.trim(), grupo: g('grupo').value.trim() || 'Geral', nome: g('nome').value.trim(), arquivo: g('arquivo').value.trim() || g('nome').value.trim(), fonte: g('fonte').value,
              formatos: g('formatos').value.split(','), obrigatorio: g('obrigatorio').checked, ativo: g('ativo').checked, ordem };
            if (!row.codigo || !row.nome) continue;
            if (tr.dataset.id) await q(sb.from('rma_documentos').update(row).eq('id', tr.dataset.id)); else await q(sb.from('rma_documentos').insert({ ...row, empresa_id: e })); }
          close(); toast('Lista salva.'); re(); } catch (err) { fail(err); } }); } });
  }
  function parametros(ativar) {
    const PAP = [['financeiro', 'Financeiro'], ['diretor', 'Diretor'], ['leitura', 'Leitura']], ck = (nm, r, v) => `<label class="chk c3"><input type="checkbox" name="${nm}" ${v ? 'checked' : ''}> ${r}</label>`, d = (x) => esc(cfg[x] ?? '');
    const sigla0 = cfg.sigla || (state.empresa?.nome || 'EMPRESA').normalize('NFD').replace(/[^A-Za-z0-9 ]/g, '').trim().split(/\s+/)[0].toUpperCase().slice(0, 20);
    modal({ title: ativar ? 'Ativar o RMA' : 'Parâmetros do RMA', wide: true, body: `<form id="rm-fp"><div class="rm-g">
        ${ck('ativo', '<b>RMA ativado para esta empresa</b>', ativar || cfg.ativo)}<div class="c3 small muted">Desligado, a tela some do menu de quem não é administrador. Os pacotes já montados ficam guardados.</div>
        <label class="c2">Sigla nos arquivos<input name="sigla" value="${esc(sigla0)}" maxlength="20" required></label><label class="c2">Primeiro mês de competência<input type="month" name="mes_inicio" value="${esc(String(cfg.mes_inicio || '').slice(0, 7))}" required></label>
        <label>Entregar até o dia<input type="number" name="dia_entrega" min="1" max="28" value="${cfg.dia_entrega}"></label><label>Avisar (dias antes)<input type="number" name="dias_aviso" min="0" max="30" value="${cfg.dias_aviso}"></label>
        <label class="c3">Número do processo<input name="processo" value="${d('processo')}"></label><label class="c3">Juízo / vara<input name="vara" value="${d('vara')}"></label>
        <label class="c2">Quem recebe (escritório ou Administrador Judicial)<input name="escritorio" value="${d('escritorio')}"></label><label class="c2">Contato<input name="contato_nome" value="${d('contato_nome')}"></label><label class="c2">E-mail<input type="email" name="contato_email" value="${d('contato_email')}"></label>
        <div class="c6"><b class="small">Quem opera, além do administrador</b></div>${PAP.map(([p, r]) => `<label class="chk c2"><input type="checkbox" name="papel" value="${p}" ${cfg.papeis.includes(p) ? 'checked' : ''}> ${r}</label>`).join('')}
        ${ck('avisar', 'Avisar a equipe quando o envio for registrado', cfg.avisar)}
        <div class="c6"><b class="small">Automático pelo fechamento do banco</b></div>
        ${ck('auto_extrato', 'Ao conciliar e fechar o banco, gerar o extrato da conta no RMA', cfg.auto_extrato)}${ck('auto_relatorios', 'Com todos os bancos fechados no mês, gerar os demais relatórios', cfg.auto_relatorios)}
        <div class="c6 small muted">Contas que <b>não</b> entram no RMA (não geram extrato nem seguram os demais relatórios):</div>
        ${(state.cad?.contas || []).filter(c => c.ativo !== false && c.tipo !== 'Cheques').map(c => `<label class="chk c2"><input type="checkbox" name="fora" value="${c.id}" ${(cfg.contas_fora || []).includes(c.id) ? 'checked' : ''}> ${esc(c.nome)}</label>`).join('')}</div></form>
        <p class="small muted">O dia de entrega é do mês seguinte ao de competência (o RMA de outubro vence em novembro). Confirme o prazo com quem recebe.${ativar ? ' Ao ativar, a lista padrão de documentos é criada; ajuste em "Documentos pedidos".' : ''}</p>`,
      foot: '<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="rm-sp">Salvar</button>',
      onMount: (m, close) => { $('#rm-sp', m).onclick = async () => { const f = $('#rm-fp', m);
        const row = { empresa_id: e, ativo: f.ativo.checked, sigla: f.sigla.value.trim().replace(/[^A-Za-z0-9]/g, ''), mes_inicio: f.mes_inicio.value ? f.mes_inicio.value + '-01' : null, dia_entrega: +f.dia_entrega.value || 20, dias_aviso: +f.dias_aviso.value || 0,
          processo: f.processo.value.trim() || null, vara: f.vara.value.trim() || null, escritorio: f.escritorio.value.trim() || null, contato_nome: f.contato_nome.value.trim() || null, contato_email: f.contato_email.value.trim() || null,
          papeis: $$('[name=papel]:checked', m).map(x => x.value), avisar: f.avisar.checked, auto_extrato: f.auto_extrato.checked, auto_relatorios: f.auto_relatorios.checked, contas_fora: $$('[name=fora]:checked', m).map(x => x.value), atualizado_em: new Date().toISOString() };
        if (row.sigla.length < 2 || !row.mes_inicio) return toast('Informe a sigla e o primeiro mês de competência.', true);
        try { await q(sb.from('rma_config').upsert(row)); if (row.ativo && !D.docs.length) await q(sb.rpc('rma_documentos_padrao', { p_empresa: e }));
          close(); toast(row.ativo ? 'RMA ativado.' : 'Parâmetros salvos.'); document.dispatchEvent(new Event('rma-config')); re(); } catch (err) { fail(err); } }; } });
  }
}
