// Manutenção › No Celular (PRD011): o operador pede manutenção em 3 toques; o técnico vê a fila, inicia, lança horas,
// marca o checklist, tira foto e conclui — tudo com o polegar. Liberado também para o papel Produção.
import { sb, state, q } from '../lib/data.js';
import { $, $$, esc, toast, fail, parseNum, today } from '../lib/ui.js';
import * as M from '../lib/manutencao.js';
import { gravar, novoId } from '../lib/offline.js';
import { carregarManutencao, fichaOS, nomeEq, selo, clsSit, clsPrio, CSS, BUCKET } from '../lib/manutencao-ui.js';

export const title = 'Manutenção no Celular';
const ui = { aba: 'fila' };
let D = null;
const idade = (t) => { const h = M.horasEntre(t, null); return h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} dias`; };

export async function render(root) {
  root.innerHTML = `${CSS}<style>
    .mc{max-width:560px;margin:0 auto}.mc input,.mc textarea{box-sizing:border-box;max-width:100%}.mc .card{overflow:hidden}.mc .btn.grande{width:100%;padding:16px;font-size:17px;margin-top:8px}
    .mc-eq{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.mc input[type=file]{width:100%}.mc-eq button{padding:14px 8px;border:2px solid var(--border);border-radius:12px;background:var(--surface);text-align:left;font-size:14px}
    .mc-eq button.on{border-color:var(--primary);background:var(--primary-soft)}.mc-os{background:var(--surface);border:1px solid var(--border);border-left:5px solid var(--border);border-radius:12px;padding:12px;margin-bottom:10px}
    .mc-os.c-neg{border-left-color:var(--neg)}.mc-os.c-warn{border-left-color:var(--warn)}.mc-os .acoes{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}.mc-os .acoes .btn{flex:1;padding:12px}
    .mc-tg{display:flex;gap:8px}.mc-tg label{flex:1;border:2px solid var(--border);border-radius:12px;padding:12px;text-align:center;font-weight:600}.mc-tg input{display:none}.mc-tg label:has(input:checked){border-color:var(--primary);color:var(--primary);background:var(--primary-soft)}.mc-tg label.sim:has(input:checked){border-color:var(--neg);color:var(--neg);background:color-mix(in srgb,var(--neg) 10%,transparent)}
  </style><div class="mc"><div class="chips" id="mc-a" style="margin-bottom:12px">${[['fila', 'Fila do técnico'], ['pedir', 'Pedir manutenção']].map(([k, t]) => `<span class="chip ${ui.aba === k ? 'on' : ''}" data-a="${k}" style="flex:1;text-align:center;padding:10px">${t}</span>`).join('')}</div>
    <div id="mc-c"><div class="loading">Carregando…</div></div></div>`;
  $('#mc-a', root).onclick = (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) { ui.aba = a; render(root); } };
  try { D = await carregarManutencao({ meses: 1 }); } catch (err) { fail(err); $('#mc-c', root).innerHTML = '<div class="card"><div class="empty">Não foi possível carregar.</div></div>'; return; }
  ui.aba === 'pedir' ? pedir(root) : fila(root);
}

function pedir(root) {
  const c = $('#mc-c', root), eqs = D.E.filter(e => e.situacao !== 'inativo').sort((a, b) => a.criticidade.localeCompare(b.criticidade) || a.codigo.localeCompare(b.codigo));
  let sel = null;
  c.innerHTML = `<div class="card"><h3 style="margin-top:0">1. Qual equipamento?</h3><input id="mc-b" placeholder="Procurar" style="width:100%;margin-bottom:8px">
      <div class="mc-eq" id="mc-eq">${eqs.map(e => `<button type="button" data-e="${e.id}"><b>${esc(e.codigo)}</b><br><span class="small">${esc(e.nome)}</span></button>`).join('') || '<span class="muted">Nenhum equipamento cadastrado.</span>'}</div>
    <h3>2. A máquina parou?</h3><div class="mc-tg"><label class="sim"><input type="radio" name="mc-p" value="1"> Sim, parou</label><label><input type="radio" name="mc-p" value="0" checked> Não, está rodando</label></div>
    <h3>3. O que está acontecendo?</h3><textarea id="mc-d" rows="4" style="width:100%" placeholder="Ex.: vazamento de óleo embaixo do redutor"></textarea>
    <label class="small" style="display:block;margin-top:8px">Foto (opcional)<input type="file" id="mc-f" accept="image/*" capture="environment"></label>
    <button class="btn primary grande" id="mc-ok">Enviar para a manutenção</button></div>
    <p class="muted small" style="text-align:center">A manutenção recebe na hora. Máquina parada de equipamento crítico entra como emergência.</p>`;
  $('#mc-b', c).oninput = (e) => { const b = e.target.value.toLowerCase(); $$('#mc-eq [data-e]', c).forEach(x => { x.hidden = !x.textContent.toLowerCase().includes(b); }); };
  $('#mc-eq', c).onclick = (e) => { const b = e.target.closest('[data-e]'); if (!b) return; sel = b.dataset.e; $$('#mc-eq [data-e]', c).forEach(x => x.classList.toggle('on', x === b)); };
  $('#mc-ok', c).onclick = async () => {
    const desc = $('#mc-d', c).value.trim(), parou = $('input[name=mc-p]:checked', c).value === '1';
    if (!sel) return toast('Escolha o equipamento', true); if (!desc) return toast('Diga o que está acontecendo', true);
    const eq = D.eById[sel], btn = $('#mc-ok', c); btn.disabled = true;
    try {
      // modo sem internet (melhoria 1.5): o pedido e a foto ficam no aparelho e sobem quando o sinal voltar
      const o = { id: novoId(), empresa_id: state.empresa.id, equipamento_id: sel, tipo: 'corretiva', origem: 'solicitacao', situacao: 'solicitada', descricao: desc,
        prioridade: parou ? (eq.criticidade === 'A' ? 'emergencia' : 'alta') : 'media', maquina_parou: parou, parada_inicio: parou ? new Date().toISOString() : null, solicitante: state.user?.email || null, solicitada_em: new Date().toISOString() };
      const f = $('#mc-f', c).files[0], ops = [{ t: 'insert', tabela: 'man_ordens', valores: o }];
      if (f) { const cam = `${state.empresa.id}/os/${o.id}/${Date.now()}-foto.${(f.name.split('.').pop() || 'jpg').toLowerCase()}`;
        ops.push({ t: 'upload', bucket: BUCKET, caminho: cam, arquivo: f }, { t: 'insert', tabela: 'man_anexos', valores: { id: novoId(), empresa_id: state.empresa.id, ordem_id: o.id, caminho: cam, nome: f.name, tipo: 'foto' } }); }
      const r = await gravar(`Pedido de manutenção: ${eq.codigo}`, ops);
      if (!r.pendente) { try { o.numero = (await q(sb.from('man_ordens').select('numero').eq('id', o.id)))[0]?.numero; } catch {} }
      c.innerHTML = `<div class="card" style="text-align:center;padding:30px"><div style="font-size:48px">${r.pendente ? '⏳' : '✔'}</div><h2>${r.pendente ? 'Pedido guardado no aparelho' : 'Pedido enviado'}</h2>
        <p>${r.pendente ? '' : `OS <b>${o.numero ?? ''}</b> — `}${esc(eq.codigo)} · ${esc(eq.nome)}</p>${r.pendente ? '<p class="small muted">Sem internet agora. O pedido vai para a manutenção assim que o sinal voltar; o número da OS sai nessa hora.</p>' : ''}${selo(M.PRIORIDADES[o.prioridade], clsPrio(o.prioridade))}
        <button class="btn grande" id="mc-mais">Fazer outro pedido</button></div>`;
      $('#mc-mais', c).onclick = () => render(root);
    } catch (err) { btn.disabled = false; fail(err); }
  };
}

function fila(root) {
  const c = $('#mc-c', root), agora = Date.now(), L = M.fila(D.O, agora);
  c.innerHTML = L.map(o => {
    const tem = o.situacao === 'em_execucao', cls = o.prioridade === 'emergencia' || M.atrasada(o, agora) ? 'c-neg' : o.prioridade === 'alta' ? 'c-warn' : '';
    const ck = (o.checklist || []), feitos = ck.filter(x => x.ok != null).length;
    return `<div class="mc-os ${cls}" data-os="${o.id}"><div style="display:flex;justify-content:space-between;gap:6px"><b>OS ${o.numero} · ${esc(nomeEq(D, o.equipamento_id))}</b>${selo(M.PRIORIDADES[o.prioridade], clsPrio(o.prioridade))}</div>
      <div style="margin:6px 0">${esc(o.descricao)}</div><div class="small muted">${esc(M.TIPOS_OS[o.tipo])} · há ${idade(o.solicitada_em)} · ${selo(M.SITUACOES[o.situacao], clsSit(o.situacao))}${o.maquina_parou && !o.parada_fim ? ' ' + selo('Máquina parada', 'neg') : ''}${ck.length ? ` · checklist ${feitos}/${ck.length}` : ''}</div>
      <div class="acoes">${tem ? '<button class="btn" data-h>+ Horas</button><button class="btn" data-ag>Aguardando peça</button><button class="btn primary" data-fim>✔ Concluir</button>' : '<button class="btn primary" data-ini>▶ Iniciar</button>'}<button class="btn ghost" data-ver>Abrir</button></div></div>`;
  }).join('') || '<div class="card" style="text-align:center;padding:30px"><div style="font-size:40px">🔧</div><b>Nenhuma OS na fila.</b><div class="muted small">Pedidos dos operadores e preventivas geradas aparecem aqui, na ordem de atendimento.</div></div>';
  c.onclick = async (ev) => {
    const card = ev.target.closest('[data-os]'); if (!card) return; const o = D.O.find(x => x.id === card.dataset.os), re = () => render(root);
    try {
      const ok = (r, msg) => toast(r.pendente ? `${msg} — sem internet: guardado no aparelho` : msg);
      if (ev.target.closest('[data-ini]')) { ok(await gravar(`Início da OS ${o.numero ?? ''}`, [{ t: 'update', tabela: 'man_ordens', id: o.id, valores: { situacao: 'em_execucao', inicio: o.inicio || new Date().toISOString(), responsavel: o.responsavel || state.user?.user_metadata?.nome || state.user?.email } }]), `OS ${o.numero ?? ''} iniciada`); re(); }
      else if (ev.target.closest('[data-ag]')) { ok(await gravar(`OS ${o.numero ?? ''} aguardando peça`, [{ t: 'update', tabela: 'man_ordens', id: o.id, valores: { situacao: 'aguardando_peca' } }]), 'Marcada como aguardando peça'); re(); }
      else if (ev.target.closest('[data-h]')) {
        const v = prompt('Quantas horas você trabalhou nesta OS? (ex.: 1,5)'); const h = parseNum(v || ''); if (!(h > 0)) return;
        ok(await gravar(`Horas na OS ${o.numero ?? ''}`, [{ t: 'insert', tabela: 'man_os_horas', conflito: 'sync_id', valores: { sync_id: novoId(), empresa_id: state.empresa.id, ordem_id: o.id, tecnico: state.user?.user_metadata?.nome || state.user?.email || 'Técnico', data: today(), horas: h, custo_hora: +D.P.custo_hora || 0 } }]), 'Horas lançadas');
      }
      else if (navigator.onLine === false) toast('Concluir e abrir a ficha precisam de internet. Iniciar, aguardando peça e horas funcionam sem sinal.', true);
      else fichaOS(D, o, { onMudou: re }); // concluir e abrir usam a ficha completa (falha, causa, solução, checklist, peças, foto)
    } catch (err) { fail(err); }
  };
}
