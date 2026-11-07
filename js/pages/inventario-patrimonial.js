// Contabilidade › Patrimônio › Inventário Patrimonial (SQL 084): tela feita para o celular.
// Lê a plaqueta pela câmera (QR da etiqueta), por leitor de código ou digitando, e registra o bem no inventário aberto,
// com o local e o estado. Ao abrir o QR da etiqueta pela câmera do celular (#/contab/inventario?pat=…), mostra o bem na hora.
import { sb, state, q, fetchAll, podeEditar } from '../lib/data.js';
import { $, $$, esc, toast, fail, dateBR, money, erroTela } from '../lib/ui.js';
import * as I from '../lib/imobilizado.js';

export const title = 'Inventário Patrimonial';
let D = null, fluxo = null, timer = null;
const ui = { inv: null, local: '', estado: 'bom' };
const ls = { get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento */ } } };

async function carregar() {
  const e = state.empresa.id;
  const [B, Iv, K] = await Promise.all([
    fetchAll(() => sb.from('af_bens').select('id,numero,plaqueta,descricao,classe_id,local,responsavel,centro_custo_id,situacao,serie,data_aquisicao,baixa_data').eq('empresa_id', e).order('numero')),
    q(sb.from('af_inventarios').select('*').eq('empresa_id', e).eq('situacao', 'aberto').order('numero', { ascending: false })),
    q(sb.from('af_classes').select('id,codigo,nome').eq('empresa_id', e)),
  ]);
  D = { B, Iv, kById: Object.fromEntries(K.map(k => [k.id, k])) };
}
const parar = () => { if (timer) cancelAnimationFrame(timer); timer = null; if (fluxo) fluxo.getTracks().forEach(t => t.stop()); fluxo = null; };
window.addEventListener('hashchange', parar);

export async function render(root) {
  parar();
  const qs = new URLSearchParams(location.hash.split('?')[1] || '');
  root.innerHTML = '<div class="loading">Carregando…</div>';
  try { await carregar(); } catch (e) { console.error(e); root.innerHTML = erroTela('o inventário (rode o SQL 084 se ainda não rodou)'); return; }
  ui.inv = qs.get('inv') || ui.inv || ls.get('af-inv', null);
  if (!D.Iv.some(i => i.id === ui.inv)) ui.inv = D.Iv[0]?.id || null;
  ui.local = ls.get('af-inv-local', ''); ui.estado = ls.get('af-inv-estado', 'bom');
  const iv = D.Iv.find(i => i.id === ui.inv);
  const temCam = 'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia;
  root.innerHTML = `<style>
    .ivp{max-width:560px;margin:0 auto}.ivp .grande{font-size:18px;padding:14px;min-height:48px;width:100%;box-sizing:border-box}
    .ivp video{width:100%;border-radius:12px;background:#000;aspect-ratio:4/3;object-fit:cover}.ivp .bem{border:2px solid var(--brand-blue);border-radius:12px;padding:14px;margin-top:12px}
    .ivp .plq{font-family:ui-monospace,monospace;font-size:20px;font-weight:700}.ivp .btn{min-height:44px}.ivp .lin{display:flex;gap:8px;flex-wrap:wrap}.ivp .lin>*{flex:1 1 140px}
    .ivp .ok{border-color:var(--pos);background:color-mix(in srgb,var(--pos) 10%,transparent)}.ivp .erro{border-color:var(--neg);background:color-mix(in srgb,var(--neg) 8%,transparent)}</style>
  <div class="ivp">
    <div class="card"><label>Inventário<select id="ip-inv" class="grande">${D.Iv.length ? D.Iv.map(i => `<option value="${i.id}" ${i.id === ui.inv ? 'selected' : ''}>Nº ${i.numero} — ${esc(i.descricao)}</option>`).join('') : '<option value="">Nenhum inventário aberto (só consulta)</option>'}</select></label>
      ${iv ? `<div class="lin" style="margin-top:8px"><label>Local onde estou<input id="ip-local" class="grande" value="${esc(ui.local)}" list="ip-locais" placeholder="ex.: Extrusão"><datalist id="ip-locais">${[...new Set(D.B.map(b => b.local).filter(Boolean))].sort().map(l => `<option value="${esc(l)}">`).join('')}</datalist></label>
        <label>Estado<select id="ip-estado" class="grande">${Object.entries(I.ESTADOS).map(([k, t]) => `<option value="${k}" ${ui.estado === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label></div>` : ''}
      <div id="ip-prog" class="muted small" style="margin-top:8px"></div></div>
    <div class="card" style="margin-top:12px">${temCam ? '<button class="btn primary grande" id="ip-cam">📷 Ler QR pela câmera</button><video id="ip-video" playsinline muted hidden></video>' : '<div class="muted small">Este navegador não lê QR pela câmera dentro da página: use a câmera do celular na etiqueta (abre esta tela já no bem) ou digite a plaqueta.</div>'}
      <input id="ip-cod" class="grande" placeholder="Plaqueta ou número + Enter" style="margin-top:8px" autocomplete="off" inputmode="text">
      <div id="ip-bem"></div></div>
  </div>`;
  $('#ip-inv', root).onchange = (e) => { ui.inv = e.target.value; ls.set('af-inv', ui.inv); render(root); };
  const lc = $('#ip-local', root); if (lc) lc.onchange = (e) => { ui.local = e.target.value.trim(); ls.set('af-inv-local', ui.local); };
  const es = $('#ip-estado', root); if (es) es.onchange = (e) => { ui.estado = e.target.value; ls.set('af-inv-estado', ui.estado); };
  const progresso = async () => {
    if (!iv) return;
    const n = await q(sb.from('af_inventario_itens').select('bem_id', { count: 'exact', head: false }).eq('inventario_id', iv.id)).catch(() => []);
    const alvo = D.B.filter(b => noEscopo(b, iv)).length;
    $('#ip-prog', root).textContent = `${n.length} conferido(s) de ${alvo} esperado(s) · referência ${dateBR(iv.data_inicio)}`;
  };
  progresso();
  const mostrar = async (txt) => {
    const cod = I.lerCodigo(txt), box = $('#ip-bem', root); if (!cod) return;
    const b = D.B.find(x => cod.plaqueta ? x.plaqueta === cod.plaqueta : x.numero === cod.numero);
    if (!b) { box.innerHTML = `<div class="bem erro"><b>Plaqueta ${esc(cod.plaqueta || cod.numero)} não cadastrada.</b>${iv && podeEditar() ? '<div class="lin" style="margin-top:10px"><button class="btn" id="ip-semcad">Registrar como achado sem cadastro</button></div>' : ''}</div>`;
      const sc = $('#ip-semcad', root); if (sc) sc.onclick = () => registrar(null, `Plaqueta ${cod.plaqueta || cod.numero} sem cadastro`); navigator.vibrate?.(200); return; }
    const k = D.kById[b.classe_id];
    box.innerHTML = `<div class="bem ${b.situacao === 'baixado' ? 'erro' : ''}"><div class="plq">${esc(b.plaqueta)}</div><div style="font-size:16px">${esc(b.descricao)}</div>
      <div class="muted small" style="margin-top:6px">${esc(k ? k.nome : '')}${b.serie ? ` · S/N ${esc(b.serie)}` : ''} · desde ${dateBR(b.data_aquisicao)}<br>Local no cadastro: <b>${esc(b.local || '—')}</b>${b.responsavel ? ` · ${esc(b.responsavel)}` : ''}</div>
      ${b.situacao === 'baixado' ? `<div style="margin-top:8px"><b>Bem baixado em ${dateBR(b.baixa_data)}.</b> Avise o financeiro.</div>` : ''}
      ${iv && podeEditar() && b.situacao !== 'baixado' ? `<div class="lin" style="margin-top:12px"><button class="btn primary" id="ip-ok">✔ Encontrado${ui.local ? ` em ${esc(ui.local)}` : ''}</button></div>` : ''}</div>`;
    const ok = $('#ip-ok', root); if (ok) ok.onclick = () => registrar(b);
    navigator.vibrate?.(60);
  };
  const registrar = async (b, desc = null) => {
    try {
      const reg = { encontrado: true, local_encontrado: ui.local || b?.local || null, estado: ui.estado };
      const ja = b ? (await q(sb.from('af_inventario_itens').select('id').eq('inventario_id', iv.id).eq('bem_id', b.id)))[0] : null;
      if (ja) await q(sb.from('af_inventario_itens').update(reg).eq('id', ja.id));
      else await q(sb.from('af_inventario_itens').insert({ empresa_id: state.empresa.id, inventario_id: iv.id, bem_id: b?.id || null, descricao: desc, ...reg }));
      $('#ip-bem', root).querySelector('.bem')?.classList.add('ok'); const ok = $('#ip-ok', root); if (ok) { ok.disabled = true; ok.textContent = '✔ Registrado'; }
      toast(b ? `✔ ${b.plaqueta}` : 'Registrado'); progresso(); $('#ip-cod', root).focus();
    } catch (e) { fail(e); }
  };
  const cod = $('#ip-cod', root); cod.onkeydown = (e) => { if (e.key === 'Enter') { mostrar(cod.value); cod.value = ''; } };
  if (qs.get('pat')) { mostrar(qs.get('pat')); history.replaceState(null, '', `#/contab/inventario${ui.inv ? '?inv=' + ui.inv : ''}`); }
  const cam = $('#ip-cam', root); if (cam) cam.onclick = async () => {
    const v = $('#ip-video', root);
    if (fluxo) { parar(); v.hidden = true; cam.textContent = '📷 Ler QR pela câmera'; return; }
    try {
      fluxo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      v.srcObject = fluxo; v.hidden = false; await v.play(); cam.textContent = '■ Parar a câmera';
      const det = new window.BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39'] }); let ultimo = '', quando = 0;
      const ciclo = async () => {
        if (!fluxo) return;
        try { const r = await det.detect(v); const t = r[0]?.rawValue; if (t && (t !== ultimo || Date.now() - quando > 4000)) { ultimo = t; quando = Date.now(); mostrar(t); } } catch { /* quadro sem código */ }
        timer = requestAnimationFrame(ciclo);
      };
      ciclo();
    } catch (e) { parar(); fail(new Error('Não foi possível abrir a câmera: ' + (e.message || e))); }
  };
}
function noEscopo(b, iv) {
  const f = iv.filtro || {};
  return b.situacao !== 'baixado' && b.data_aquisicao <= iv.data_inicio && (!f.classe_id || b.classe_id === f.classe_id) && (!f.centro_custo_id || b.centro_custo_id === f.centro_custo_id) && (!f.local || b.local === f.local);
}
