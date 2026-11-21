// Leitor de código de barras: o que acontece quando um código é lido (em qualquer tela, sem clicar em nada) ou digitado na
// janela "Ler código". Etapa 1 (21/11/2026): chave do DANFE → acha a nota na plataforma ou na SEFAZ e leva à conferência do pedido.
import { sb, state, q } from './data.js';
import { $, $$, esc, modal, toast, money, dateBR, fail } from './ui.js';
import { reconhecer, chaveFormatada, cnpjFormatado, detector } from './leitura.js';

const AUTO = 'fc-leitor-auto';
export const leituraAutomatica = () => { try { return localStorage.getItem(AUTO) !== '0'; } catch { return true; } };
const ir = (rota, abrir) => { if (abrir) state.abrir = abrir; if (location.hash === '#/' + rota) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = '#/' + rota; };
const tenta = async (p) => { try { return await p; } catch { return null; } };
const soDig = (s) => String(s || '').replace(/\D/g, '');
let aberta = null;

/** trata um código lido ou digitado */
export async function tratarLeitura(txt) {
  const r = reconhecer(txt);
  if (r.tipo === 'vazio') return;
  if (r.tipo === 'nfe') return notaLida(r);
  if (r.tipo === 'boleto') return toast(`Boleto lido${r.valor ? ` (${money(r.valor)})` : ''}. O lançamento da conta a pagar pela leitura do boleto ainda não está disponível.`);
  if (r.tipo === 'invalido') return toast(r.motivo, true);
  toast(`Código não reconhecido: ${String(r.codigo).slice(0, 40)}. Por enquanto a leitura vale para o código de barras do DANFE.`, true);
}

async function notaLida(k) {
  if (!state.empresa?.id) return;
  const e = state.empresa.id;
  const [nota, dfe] = await Promise.all([
    tenta(q(sb.from('nfe_notas').select('id,chave,numero,serie,emissao,tipo,emissao_propria,emit_nome,emit_doc,dest_nome,v_nf,situacao,favorecido_id').eq('empresa_id', e).eq('chave', k.chave).maybeSingle())),
    tenta(q(sb.from('dfe_documentos').select('id,chave,emitente_nome,emissao,valor,situacao,situacao_nfe').eq('empresa_id', e).eq('chave', k.chave).maybeSingle()))]);
  let pedidos = [], recebida = null;
  if (nota?.tipo === 'entrada') {
    [pedidos, recebida] = await Promise.all([
      nota.favorecido_id ? tenta(q(sb.from('compras_pedidos').select('id,numero,status,total,entrega_prevista').eq('empresa_id', e).eq('favorecido_id', nota.favorecido_id).in('status', ['aprovado', 'enviado', 'recebido_parcial']).order('numero'))) : [],
      tenta(q(sb.from('compras_recebimentos').select('id,data,pedido_id').eq('empresa_id', e).eq('nfe_nota_id', nota.id).limit(1)))]);
    pedidos = pedidos || []; recebida = recebida?.[0] || null;
  }
  const propria = soDig(state.empresa.cnpj) === k.cnpj;
  const fav = (state.cad?.favorecidos || []).find(f => soDig(f.documento) === k.cnpj);
  const emitente = nota?.emit_nome || dfe?.emitente_nome || (propria ? state.empresa.nome : fav?.nome || fav?.label) || 'Emitente não cadastrado';
  let situacao, botoes = '';
  if (nota) {
    situacao = `<span class="badge pago">Importada</span> Está em Notas Fiscais: emissão ${dateBR(nota.emissao)}, ${money(nota.v_nf)}, ${esc(nota.situacao)}.${recebida ? ` <b>Já usada no recebimento de ${dateBR(recebida.data)}.</b>` : ''}`;
    botoes = `<button class="btn ${pedidos.length && !recebida ? '' : 'primary'}" id="lt-abrir">Abrir a nota</button>`
      + (recebida ? '' : pedidos.slice(0, 4).map(p => `<button class="btn primary" data-ped="${p.id}">Conferir com o PC ${p.numero}</button>`).join(''));
    if (nota.tipo === 'entrada' && !recebida && !pedidos.length) situacao += '<div class="small muted" style="margin-top:6px">Não há pedido de compra aprovado e em aberto para este fornecedor.</div>';
  } else if (dfe?.situacao === 'xml_disponivel') {
    situacao = `<span class="badge previsto">Na SEFAZ</span> A nota chegou da SEFAZ (${dateBR(dfe.emissao)}, ${money(dfe.valor)}) e ainda não foi importada em Notas Fiscais.`;
    botoes = '<button class="btn primary" id="lt-imp">Importar agora</button>';
  } else if (dfe) {
    situacao = `<span class="badge previsto">Na SEFAZ</span> ${dfe.situacao === 'importada' ? 'Consta como importada, mas não foi encontrada em Notas Fiscais.' : 'A SEFAZ enviou só o resumo desta nota; o XML completo chega depois da ciência da operação.'}`;
    botoes = '<a class="btn primary" href="#/notas/sefaz" data-close>Abrir NF-e da SEFAZ</a>';
  } else {
    situacao = `<span class="badge vencido">Não está na plataforma</span> ${propria ? 'É uma nota emitida pela própria empresa que ainda não foi importada.' : 'Esta nota ainda não foi importada nem chegou da SEFAZ.'}`;
    botoes = `${propria ? '' : '<a class="btn" href="#/notas/sefaz" data-close>NF-e da SEFAZ</a>'}<a class="btn primary" href="#/notas" data-close>Importar o XML em Notas Fiscais</a>`;
  }
  aberta?.close?.();
  const m = aberta = modal({ title: `${k.documento} nº ${k.numero} lida`, body: `
    <div class="grid-form small">
      <div><span class="muted">Emitente</span><div><b>${esc(emitente)}</b></div><div>${cnpjFormatado(k.cnpj)} · ${k.uf}</div></div>
      <div><span class="muted">Documento</span><div>${k.documento} nº ${k.numero} · série ${esc(k.serie)}</div><div>emitida em ${String(k.mes).padStart(2, '0')}/${k.ano}</div></div>
      <div class="full" style="grid-column:1/-1"><span class="muted">Chave de acesso</span><div style="font-family:monospace;font-size:12px">${chaveFormatada(k.chave)}</div></div>
    </div>
    <div style="margin-top:14px">${situacao}</div>`,
    foot: `<button class="btn ghost" data-close>Fechar</button><span class="spacer"></span>${botoes}` });
  $('#lt-abrir', m.el) && ($('#lt-abrir', m.el).onclick = () => { m.close(); ir('notas', { tipo: 'nota', id: nota.id, tipo_nf: nota.tipo, emissao: nota.emissao }); });
  $$('[data-ped]', m.el).forEach(b => b.onclick = () => { m.close(); ir('compras/recebimentos', { tipo: 'receber', id: b.dataset.ped, nota: nota.id }); });
  $('#lt-imp', m.el) && ($('#lt-imp', m.el).onclick = async (ev) => {
    ev.target.disabled = true;
    try {
      const x = await q(sb.from('dfe_documentos').select('chave,xml').eq('id', dfe.id).single());
      if (!x?.xml) { toast('O XML desta nota não está disponível', true); ev.target.disabled = false; return; }
      const { importarXmls } = await import('../pages/notas.js');
      m.close(); importarXmls([{ nome: `SEFAZ ${x.chave}.xml`, xml: x.xml }], () => tratarLeitura(k.chave));
    } catch (err) { fail(err); ev.target.disabled = false; }
  });
}

/** janela "Ler código": campo para o leitor (ou para digitar a chave) e a opção da leitura automática deste computador */
export function abrirLeitura() {
  const m = modal({ title: 'Ler código de barras', narrow: true, body: `
    <label>Leia o código de barras do DANFE ou digite a chave de acesso<input id="lt-cod" inputmode="numeric" autocomplete="off" placeholder="44 dígitos" style="font-family:monospace"></label>
    <p class="small muted">O leitor funciona como um teclado: aponte para o código de barras do DANFE e a plataforma acha a nota. Não precisa abrir esta janela — com a leitura automática ligada, basta ler o código em qualquer tela, sem clicar em nenhum campo.</p>
    <label style="display:flex;flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="lt-auto" style="width:auto;margin:0" ${leituraAutomatica() ? 'checked' : ''}> Leitura automática em qualquer tela, neste computador</label>`,
    foot: '<button class="btn" data-close>Fechar</button><button class="btn primary" id="lt-ok">Procurar</button>' });
  const cod = $('#lt-cod', m.el); setTimeout(() => cod.focus(), 50);
  const vai = () => { const v = cod.value.trim(); if (!v) return toast('Leia ou digite o código', true); m.close(); tratarLeitura(v); };
  cod.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); vai(); } };
  $('#lt-ok', m.el).onclick = vai;
  $('#lt-auto', m.el).onchange = (e) => { try { localStorage.setItem(AUTO, e.target.checked ? '1' : '0'); } catch { /* sem armazenamento */ } toast(e.target.checked ? 'Leitura automática ligada neste computador' : 'Leitura automática desligada neste computador'); };
}

/** leitura em qualquer tela: quando ninguém está digitando num campo e chegam muitos caracteres de uma vez, é o leitor */
export function instalarLeitor() {
  const d = detector(); let timer = null;
  const dispara = () => { const c = d.fim(); if (c) tratarLeitura(c); return !!c; };
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || !leituraAutomatica()) return;
    const el = e.target;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) { d.limpar(); return; }
    if (e.key === 'Enter' || e.key === 'Tab') {
      clearTimeout(timer);
      if (d.pendente() >= 20) { if (dispara()) { e.preventDefault(); e.stopPropagation(); } } else d.limpar();
      return;
    }
    if (e.key.length === 1) { d.tecla(e.key, performance.now()); clearTimeout(timer); timer = setTimeout(dispara, 150); }
  }, true);
}
