// e-frete na plataforma (04/11/2026): parâmetros da empresa (Logística › Frota e parâmetros › e-frete) e o CIOT do frete
// (ficha do frete › CIOT pelo e-frete). Regra do Renan: todo parâmetro pela tela, nada fixo no código.
// As credenciais (usuário, senha, hash, certificado) ficam como segredos do servidor: a tela só mostra se estão cadastradas.
import { sb, state, q, isAdmin } from './data.js';
import { $, $$, esc, money, toast, fail, modal, confirmDialog } from './ui.js';

export const AMBIENTES = { homologacao: 'Homologação (testes)', producao: 'Produção (vale de verdade)' };
export const PAGAMENTOS = { eFRETE: 'Cartão e-frete (meio de pagamento)', TransferenciaBancaria: 'Transferência bancária', DepositoAgendado: 'Depósito agendado (conta ou Pix)' };
export const ENTREGA_DOC = { RedeCredenciada: 'No posto da rede credenciada', Cliente: 'No cliente (exige registrar a descarga)' };
export const EMBALAGENS = ['Pallet', 'Bigbag', 'Granel', 'Container', 'Saco', 'Caixa', 'Unitario', 'Fardo'];
export const CALCULOS = { SemQuebra: 'Sem quebra (não desconta)', QuebraSomenteUltrapassado: 'Desconta só o que passar da tolerância', QuebraIntegral: 'Desconta toda a diferença' };
export const TOLERANCIAS = { Nenhum: 'Nenhuma', Porcentagem: 'Porcentagem', ValorAbsoluto: 'Peso (na unidade escolhida)' };
export const CODIGOS_ANTT = { 1: 'Granel sólido', 2: 'Granel líquido', 3: 'Frigorificada ou aquecida', 4: 'Conteinerizada', 5: 'Carga geral', 6: 'Neogranel',
  7: 'Perigosa (granel sólido)', 8: 'Perigosa (granel líquido)', 9: 'Perigosa (frigorificada ou aquecida)', 10: 'Perigosa (conteinerizada)', 11: 'Perigosa (carga geral)', 12: 'Granel pressurizada' };
export const CONFIG_PADRAO = { ambiente: 'homologacao', tipo_viagem: 'Padrao', tipo_pagamento: 'eFRETE', pct_adiantamento: 0, dias_liberacao_quitacao: 0, prazo_viagem_horas: 48,
  docs_credenciado: ['Canhoto da NF-e assinado pelo destinatario', 'Comprovante de entrega da carga'], entrega_documentacao: 'RedeCredenciada', qtd_saques: null, qtd_transferencias: null,
  tipo_embalagem: 'Pallet', unidade_medida: 'Kg', tipo_calculo: 'SemQuebra', tolerancia_tipo: 'Nenhum', tolerancia_valor: 0, ncm_padrao: '', contratante_endereco: {}, observacoes_transportador: [] };

const soDig = (s) => String(s ?? '').replace(/\D/g, '');
const opts = (o, v) => Object.entries(o).map(([k, t]) => `<option value="${esc(k)}" ${String(v) === String(k) ? 'selected' : ''}>${esc(t)}</option>`).join('');

/** chama a função do servidor e devolve o JSON (ou {erro}) */
export async function efrete(acao, body = {}) {
  const { data, error } = await sb.functions.invoke('efrete', { body: { acao, ...body } });
  if (!error) return data || { erro: 'O servidor do e-frete não respondeu.' };
  try { return await error.context.json(); } catch { return { erro: error.message }; }
}
export function baixarPdf(b64, nome) {
  const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bin], { type: 'application/pdf' }));
  const a = document.createElement('a'); a.href = url; a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const endTxt = (e) => (e && e.rua ? `${e.rua}, ${e.numero || 'S/N'}${e.complemento ? ' ' + e.complemento : ''} — ${e.bairro || ''} — CEP ${e.cep || ''} — IBGE ${e.cmun || ''}` : '');
export const camposEndereco = (pfx, e = {}, dis = '') => `
  <label class="grow">Rua / logradouro<input id="${pfx}-rua" value="${esc(e.rua || '')}" ${dis}></label><label>Número<input id="${pfx}-num" value="${esc(e.numero || '')}" ${dis}></label>
  <label>Complemento<input id="${pfx}-cpl" value="${esc(e.complemento || '')}" ${dis}></label><label>Bairro<input id="${pfx}-bai" value="${esc(e.bairro || '')}" ${dis}></label>
  <label>CEP<input id="${pfx}-cep" value="${esc(e.cep || '')}" ${dis}></label><label>Município (código IBGE)<input id="${pfx}-mun" value="${esc(e.cmun || '')}" placeholder="7 dígitos" ${dis}></label>`;
export const lerEndereco = (pfx, raiz) => {
  const v = (s) => ($(`#${pfx}-${s}`, raiz)?.value || '').trim();
  const e = { rua: v('rua').toUpperCase(), numero: v('num') || 'S/N', complemento: v('cpl'), bairro: v('bai').toUpperCase(), cep: soDig(v('cep')), cmun: soDig(v('mun')) };
  return e.rua || e.bairro || e.cep || e.cmun ? e : {};
};

// ------------------------------------------------------------------ Parâmetros do e-frete (aba de Frota e parâmetros)
export async function parametrosEfrete(corpo, rerender) {
  const e = state.empresa.id, pode = isAdmin(), dis = pode ? '' : 'disabled';
  let C, T, st, emp, trib;
  try {
    [C, T, emp, trib] = await Promise.all([
      q(sb.from('efrete_config').select('*').eq('empresa_id', e).maybeSingle()),
      q(sb.from('efrete_tipos_carga').select('*').eq('empresa_id', e).order('codigo')),
      q(sb.from('empresas').select('logradouro, municipio, uf, cep').eq('id', e).maybeSingle()),
      q(sb.from('empresa_tributacao').select('municipio_ibge').eq('empresa_id', e).order('vigencia_inicio', { ascending: false }).limit(1)).catch(() => []),
    ]);
  } catch (err) { fail(err); corpo.innerHTML = '<p class="neg">Não foi possível ler os parâmetros do e-frete.</p>'; return; }
  const c = { ...CONFIG_PADRAO, ...(C || {}) };
  if (!c.contratante_endereco?.rua && emp?.logradouro) {
    const [rua, resto] = String(emp.logradouro).split(/,\s*/);
    c.contratante_endereco = { rua: rua || '', numero: (resto || '').match(/\d+/)?.[0] || '', bairro: '', cep: soDig(emp.cep), cmun: trib?.[0]?.municipio_ibge || '' };
  }
  const tiposPlataforma = [...new Set([...(T || []).map(t => t.tipo_carga), 'geral'])];
  corpo.innerHTML = `<div class="card"><h2>Parâmetros do e-frete (CIOT e pagamento do frete)</h2>
    <p class="small muted" style="margin-top:0">Tudo o que vai no pedido do CIOT e não vem da ficha do frete. ${pode ? '' : 'Só o administrador altera.'}</p>
    <div id="ef-status" class="small card" style="padding:10px;margin-bottom:10px">Conferindo a conexão…</div>
    <div class="grid-form">
      <label>Ambiente<select id="ef-amb" ${dis} data-nobusca>${opts(AMBIENTES, c.ambiente)}</select><span class="small muted">Produção só depois do teste completo e com as credenciais de produção cadastradas no servidor.</span></label>
      <label>Forma de pagamento ao transportador<select id="ef-tp" ${dis} data-nobusca>${opts(PAGAMENTOS, c.tipo_pagamento)}</select></label>
      <label>Adiantamento (% do frete)<input id="ef-ad" value="${esc(c.pct_adiantamento)}" ${dis}><span class="small muted">Liberado no início da viagem. O resto é a quitação.</span></label>
      <label>Quitação liberada (dias após o fim previsto)<input id="ef-dl" value="${esc(c.dias_liberacao_quitacao)}" ${dis}></label>
      <label>Prazo padrão da viagem (horas)<input id="ef-pz" value="${esc(c.prazo_viagem_horas)}" ${dis}><span class="small muted">Fim previsto = início + prazo; pode ser mudado em cada CIOT.</span></label>
      <label>Onde o motorista entrega a documentação<select id="ef-ed" ${dis} data-nobusca>${opts(ENTREGA_DOC, c.entrega_documentacao)}</select></label>
      <label class="span2">Documentos que o posto retém na quitação (um por linha, mínimo 10 caracteres)<textarea id="ef-dc" rows="3" ${dis}>${esc((c.docs_credenciado || []).join('\n'))}</textarea></label>
      <label class="span2">Orientações ao transportador (opcional, uma por linha)<textarea id="ef-ot" rows="2" ${dis}>${esc((c.observacoes_transportador || []).join('\n'))}</textarea></label>
      <label>Quantidade de saques<input id="ef-qs" value="${esc(c.qtd_saques ?? '')}" placeholder="não informar" ${dis}></label>
      <label>Quantidade de transferências<input id="ef-qt" value="${esc(c.qtd_transferencias ?? '')}" placeholder="não informar" ${dis}></label>
      <label>Embalagem<select id="ef-em" ${dis} data-nobusca>${EMBALAGENS.map(x => `<option ${c.tipo_embalagem === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label>Unidade da mercadoria<select id="ef-un" ${dis} data-nobusca>${opts({ Kg: 'Quilo', Tonelada: 'Tonelada' }, c.unidade_medida)}</select></label>
      <label>Quebra de carga<select id="ef-qc" ${dis} data-nobusca>${opts(CALCULOS, c.tipo_calculo)}</select></label>
      <label>Tolerância de perda<select id="ef-tt" ${dis} data-nobusca>${opts(TOLERANCIAS, c.tolerancia_tipo)}</select></label>
      <label>Valor da tolerância<input id="ef-tv" value="${esc(c.tolerancia_valor)}" ${dis}></label>
      <label>NCM padrão (quando a NF-e não traz)<input id="ef-ncm" value="${esc(c.ncm_padrao || '')}" ${dis}></label>
    </div>
    <h3 style="margin:14px 0 4px">Endereço da empresa contratante</h3>
    <div class="grid-form">${camposEndereco('ef-ce', c.contratante_endereco, dis)}</div>
    <h3 style="margin:14px 0 4px">Tipo de carga × código da ANTT</h3>
    <p class="small muted" style="margin-top:0">O tipo de carga da ficha do frete vira o código que vai para o e-frete (Res. ANTT 5.867/2020).</p>
    <div class="table-wrap"><table><thead><tr><th>Tipo de carga na plataforma</th><th>Código ANTT</th></tr></thead><tbody>
      ${tiposPlataforma.map(tc => { const cur = (T || []).find(x => x.tipo_carga === tc)?.codigo; return `<tr><td>${esc(tc)}</td><td><select class="ef-tc" data-tc="${esc(tc)}" ${dis} data-nobusca><option value="">—</option>${Object.entries(CODIGOS_ANTT).map(([k, t]) => `<option value="${k}" ${+cur === +k ? 'selected' : ''}>${k} · ${esc(t)}</option>`).join('')}</select></td></tr>`; }).join('')}
    </tbody></table></div>
    ${pode ? '<div style="margin-top:12px"><button class="btn primary" id="ef-ok">Salvar parâmetros do e-frete</button></div>' : ''}</div>`;

  efrete('status').then(s => {
    const el = $('#ef-status', corpo); if (!el) return;
    if (!s || s.erro) { el.innerHTML = `<span class="neg">${esc(s?.erro || 'Não foi possível consultar o servidor do e-frete.')}</span>`; return; }
    const sim = (b) => b ? '<span class="pos">cadastrado</span>' : '<span class="neg">falta</span>';
    const g = (a) => `usuário ${sim(s.segredos?.[a]?.usuario)} · senha ${sim(s.segredos?.[a]?.senha)} · hash do integrador ${sim(s.segredos?.[a]?.integrador)}`;
    el.innerHTML = `<b>Credenciais no servidor</b> (os valores nunca aparecem aqui) — Homologação: ${g('homologacao')}<br>Produção: ${g('producao')}<br>
      Caminho: ${s.ponte ? 'ponte Node.js (Vercel)' : 'direto'} · ${s.empresa_integrada ? 'esta empresa usa o e-frete' : '<span class="neg">o CNPJ desta empresa não é o da integração (segredo EFRETE_CNPJ)</span>'}`;
  });

  $('#ef-ok', corpo) && ($('#ef-ok', corpo).onclick = async (ev) => {
    const v = (id) => $('#' + id, corpo).value.trim(), nnum = (id) => { const s = v(id).replace(',', '.'); return s === '' ? null : +s; };
    const linhas = (id) => v(id).split(/\n+/).map(x => x.trim()).filter(Boolean);
    const docs = linhas('ef-dc');
    if (v('ef-tp') === 'eFRETE' && !docs.some(d => d.length >= 10)) return toast('Informe ao menos um documento com 10 caracteres ou mais', true);
    const ad = nnum('ef-ad'); if (!(ad >= 0 && ad <= 100)) return toast('Adiantamento entre 0 e 100%', true);
    if (v('ef-amb') === 'producao' && c.ambiente !== 'producao' && !await confirmDialog('Mudar para PRODUÇÃO? A partir daí cada CIOT emitido é real e o pagamento pelo e-frete é cobrado.')) return;
    const row = { empresa_id: e, ambiente: v('ef-amb'), tipo_pagamento: v('ef-tp'), pct_adiantamento: ad, dias_liberacao_quitacao: nnum('ef-dl') ?? 0, prazo_viagem_horas: nnum('ef-pz') ?? 48,
      entrega_documentacao: v('ef-ed'), docs_credenciado: docs.length ? docs : CONFIG_PADRAO.docs_credenciado, observacoes_transportador: linhas('ef-ot'),
      qtd_saques: nnum('ef-qs'), qtd_transferencias: nnum('ef-qt'), tipo_embalagem: v('ef-em'), unidade_medida: v('ef-un'), tipo_calculo: v('ef-qc'),
      tolerancia_tipo: v('ef-tt'), tolerancia_valor: nnum('ef-tv') ?? 0, ncm_padrao: soDig(v('ef-ncm')) || null, contratante_endereco: lerEndereco('ef-ce', corpo),
      atualizado_em: new Date().toISOString() };
    const tipos = $$('.ef-tc', corpo).filter(s => s.value).map(s => ({ empresa_id: e, tipo_carga: s.dataset.tc, codigo: +s.value }));
    ev.target.disabled = true;
    try {
      await q(sb.from('efrete_config').upsert(row, { onConflict: 'empresa_id' }));
      if (tipos.length) await q(sb.from('efrete_tipos_carga').upsert(tipos, { onConflict: 'empresa_id,tipo_carga' }));
      toast('Parâmetros do e-frete salvos'); rerender();
    } catch (err) { fail(err); ev.target.disabled = false; }
  });
}

// ------------------------------------------------------------------ CIOT do frete
/** situação do CIOT do frete para a ficha */
export const situacaoCiot = (f) => {
  const d = f?.ciot_dados || {};
  if (d.situacao === 'emitido') return { emitido: true, txt: `CIOT ${d.codigo} emitido pelo e-frete em ${new Date(d.emitido_em).toLocaleString('pt-BR')}${d.ambiente === 'homologacao' ? ' (homologação)' : ''}` };
  if (d.situacao === 'cancelado') return { emitido: false, txt: `Último CIOT ${d.codigo} cancelado em ${new Date(d.cancelado_em).toLocaleString('pt-BR')}` };
  return { emitido: false, txt: '' };
};
const paraInput = (iso) => { const d = new Date(iso); return new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 16); };
const deInput = (v) => new Date(`${v}:00-03:00`).toISOString();

/** janela do CIOT pelo e-frete (emitir, PDF, cancelar). depois(): recarregar a tela */
export async function janelaCiot(f, depois) {
  const md = modal({ title: `CIOT pelo e-frete — frete nº ${f.numero}`, wide: true, body: '<div id="ec-c"><div class="loading">Conferindo os dados do frete…</div></div>', foot: '<button class="btn" data-close>Fechar</button>' });
  const c = $('#ec-c', md.el);
  const linha = (t, v) => `<tr><td class="muted">${esc(t)}</td><td>${v}</td></tr>`;
  const passosHTML = (ps) => `<table>${(ps || []).map(p => `<tr><td>${esc(p.nome)}</td><td class="${p.ok ? 'pos' : 'neg'}">${p.ok ? '✓ ok' : '✗ ' + esc(p.mensagem || 'HTTP ' + p.status)}${p.protocolo ? ` <span class="muted small">prot. ${esc(String(p.protocolo))}</span>` : ''}</td></tr>`).join('')}</table>`;

  if (f.ciot_dados?.situacao === 'emitido') {
    const d = f.ciot_dados;
    c.innerHTML = `<table>${linha('CIOT', `<b>${esc(d.codigo)}</b>`)}${linha('Ambiente', esc(AMBIENTES[d.ambiente] || d.ambiente))}${linha('Emitido em', esc(new Date(d.emitido_em).toLocaleString('pt-BR')))}
      ${linha('Viagem', `${esc(d.inicio || '')} → ${esc(d.fim || '')}`)}${linha('Valor', money(d.valor))}${linha('Protocolo', esc(String(d.protocolo || '')))}</table>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" id="ec-pdf">PDF do CIOT</button><button class="btn danger" id="ec-can">Cancelar CIOT</button></div>
      <p class="small muted">Lotação não pode ser retificada: para corrigir, cancele o CIOT (e o MDF-e, se já emitido) e emita de novo.</p><div id="ec-out"></div>`;
    $('#ec-pdf', c).onclick = async (ev) => { ev.target.disabled = true; const r = await efrete('ciot_pdf', { frete_id: f.id }); ev.target.disabled = false;
      if (r?.pdf) baixarPdf(r.pdf, `CIOT ${d.codigo.replace('/', '-')}.pdf`); else toast(r?.erro || r?.mensagem || 'O e-frete não devolveu o PDF', true); };
    $('#ec-can', c).onclick = async () => {
      const m2 = modal({ title: `Cancelar o CIOT ${d.codigo}`, body: '<label>Motivo (vai para o e-frete e para a ANTT)<textarea id="ec-mot" rows="3" placeholder="ex.: placa do veículo errada; viagem não realizada"></textarea></label>',
        foot: '<button class="btn" data-close>Voltar</button><button class="btn danger" id="ec-cok">Cancelar o CIOT</button>' });
      $('#ec-cok', m2.el).onclick = async (ev) => {
        const motivo = $('#ec-mot', m2.el).value.trim(); if (motivo.length < 15) return toast('Escreva o motivo (mínimo 15 caracteres)', true);
        ev.target.disabled = true; const r = await efrete('ciot_cancelar', { frete_id: f.id, motivo });
        if (r?.ok) { m2.close(); md.close(); toast('CIOT cancelado'); depois && depois(); } else { ev.target.disabled = false; toast(r?.erro || r?.mensagem || 'Não cancelou', true); }
      };
    };
    return;
  }

  const previa = async (inicio, fim) => {
    const r = await efrete('ciot_previa', { frete_id: f.id, ...(inicio ? { inicio, fim } : {}) });
    if (!r || r.erro) { c.innerHTML = `<p class="neg">${esc(r?.erro || 'O servidor do e-frete não respondeu.')}</p>`; return; }
    const ONDE = { transportador: 'Cadastro do transportador', frete: 'Ficha do frete / Dados do MDF-e', parametros: 'Parâmetros do e-frete (Frota e parâmetros)', notas: 'NF-e' };
    const grupos = {}; (r.faltas || []).forEach(x => (grupos[x.onde] ||= []).push(x.txt));
    const R = r.resumo || {};
    c.innerHTML = `<p class="small">Ambiente: <b>${esc(AMBIENTES[r.ambiente] || r.ambiente)}</b>${r.ambiente === 'producao' ? ' — o CIOT emitido aqui é real.' : ''}</p>
      ${r.faltas?.length ? `<div class="neg"><b>Falta para emitir (${r.faltas.length}):</b>${Object.entries(grupos).map(([o, ts]) => `<div style="margin-top:6px"><b>${esc(ONDE[o] || o)}</b><ul style="margin:2px 0">${ts.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>`).join('')}</div>`
        : '<div class="pos"><b>Pronto para emitir.</b></div>'}
      <table style="margin-top:8px">${linha('Contratado', esc(R.contratado || '—'))}${linha('Motorista', esc(R.motorista || '—'))}${linha('Veículos', esc((R.placas || []).join(', ') || '—'))}
        ${linha('Rota', `${esc(R.origem || '?')} → ${esc(R.destino || '?')}`)}${linha('NF-e', esc((R.notas || []).join(', ') || '—') + ` · ${esc(String(R.peso || 0))} kg`)}
        ${linha('Tipo de carga', `${esc(R.tipo_carga || '')} · código ANTT ${esc(String(R.codigo_antt ?? '—'))}`)}
        ${linha('Valor', `${money(R.valor)} · adiantamento ${money(R.adiantamento)} · quitação ${money(R.quitacao)} · ${esc(PAGAMENTOS[R.pagamento] || R.pagamento || '')}`)}</table>
      <div class="grid2" style="margin-top:8px"><label>Início previsto<input type="datetime-local" id="ec-ini" value="${paraInput(r.inicio)}"></label><label>Fim previsto<input type="datetime-local" id="ec-fim" value="${paraInput(r.fim)}"></label></div>
      <div style="display:flex;gap:8px;margin-top:10px"><button class="btn" id="ec-conf">Conferir de novo</button>${r.faltas?.length ? '' : '<button class="btn primary" id="ec-emit">Emitir CIOT</button>'}</div><div id="ec-out" style="margin-top:10px"></div>`;
    $('#ec-conf', c).onclick = () => { c.innerHTML = '<div class="loading">Conferindo…</div>'; previa(deInput($('#ec-ini', md.el)?.value || paraInput(r.inicio)), deInput($('#ec-fim', md.el)?.value || paraInput(r.fim))); };
    $('#ec-emit', c) && ($('#ec-emit', c).onclick = async (ev) => {
      const inicio = deInput($('#ec-ini', c).value), fim = deInput($('#ec-fim', c).value);
      if (r.ambiente === 'producao' && !await confirmDialog(`Emitir o CIOT de verdade (produção) para o frete nº ${f.numero}, valor ${money(R.valor)}?`)) return;
      ev.target.disabled = true; $('#ec-out', c).innerHTML = '<div class="loading">Enviando ao e-frete…</div>';
      try {
        const x = await efrete('ciot_emitir', { frete_id: f.id, inicio, fim });
        if (x?.faltas?.length) { previa(inicio, fim); return; }
        $('#ec-out', c).innerHTML = (x?.erro ? `<p class="neg">${esc(x.erro)}</p>` : '') + (x?.ciot ? `<p class="pos"><b>CIOT ${esc(x.ciot)} emitido.</b> O número foi gravado no frete e o PDF ficou nos anexos.</p>` : '') + passosHTML(x?.passos)
          + (x?.pdf ? '<button class="btn small" id="ec-pdf2" style="margin-top:6px">Baixar o PDF do CIOT</button>' : '');
        if (x?.pdf) $('#ec-pdf2', c).onclick = () => baixarPdf(x.pdf, `CIOT ${String(x.ciot).replace('/', '-')}.pdf`);
        if (x?.ciot) depois && depois(); else ev.target.disabled = false;
      } catch (err) { fail(err); ev.target.disabled = false; }
    });
  };
  previa();
}
