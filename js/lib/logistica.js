// Logística: parâmetros, frota, coordenadas dos municípios (IBGE), montagem automática de cargas e ordem de entrega.
// Distâncias estimadas entre os centros dos municípios (linha reta × fator rodoviário); dentro da mesma cidade, a ordem segue o CEP.
import { sb, state, q } from './data.js';
import { esc, dateBR } from './ui.js';
import { abrirRelatorio } from './relatorio.js';

export const TIPOS_VEICULO = { carreta: 'Carreta', truck: 'Truck', toco: 'Toco', tres_quartos: '3/4', vuc: 'VUC', utilitario: 'Utilitário', outro: 'Outro' };
export const ST_CARGA = { planejada: ['Planejada', 'negoc'], carregando: ['Carregando', 'aberto'], pronta: ['Pronta para sair', 'pago'], em_rota: ['Em rota', 'aberto'], concluida: ['Concluída', 'pago'], cancelada: ['Cancelada', 'vencido'] };
export const PROX_ST = { planejada: ['carregando', 'Começar a carregar'], carregando: ['pronta', 'Carga pronta'], pronta: ['em_rota', 'Saiu para entrega'], em_rota: ['concluida', 'Concluir (voltou)'] };
export const podeLogistica = () => ['admin', 'financeiro', 'diretor'].includes(state.papel);
export const PARAM_PADRAO = { origem_cmun: null, fator_rodoviario: 1.3, velocidade_kmh: 55, min_por_entrega: 25, jornada_h: 10, diesel_rs_l: null, m3_por_t: 4, raio_max_km: 600, mod_fretes: ['0', '9'], dias_atraso: 3 };
const soDig = (s) => String(s || '').replace(/\D/g, '');

let MUN = null;
export async function municipios() {
  if (MUN) return MUN;
  const r = await fetch(new URL('../../data/municipios.json', import.meta.url)); MUN = await r.json(); return MUN;
}
export function distKm(a, b) {
  if (!a || !b) return Infinity; const R = 6371, rad = Math.PI / 180;
  const dLa = (b[0] - a[0]) * rad, dLo = (b[1] - a[1]) * rad, la1 = a[0] * rad, la2 = b[0] * rad;
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2));
}
export const capacidade = (v) => { const f = (+v.ocupacao_max_pct || 100) / 100, m3 = v.comp_m && v.larg_m && v.alt_m ? v.comp_m * v.larg_m * v.alt_m : null;
  return { kg: +v.carga_kg * f, m3: m3 ? m3 * f : Infinity, m3Bruto: m3 }; };
export const veiculoPequeno = (v) => v.pequeno || ['vuc', 'utilitario', 'tres_quartos'].includes(v.tipo);

export async function carregarBase() {
  const e = state.empresa.id;
  const [veiculos, par, clientes] = await Promise.all([q(sb.from('log_veiculos').select('*').eq('empresa_id', e).order('codigo')),
    q(sb.from('log_parametros').select('*').eq('empresa_id', e)), q(sb.from('log_clientes').select('*').eq('empresa_id', e).order('nome'))]);
  return { veiculos, P: { ...PARAM_PADRAO, ...(par[0] || {}) }, temParam: !!par[0], clientes, cliPorDoc: Object.fromEntries(clientes.map(c => [soDig(c.documento), c])) };
}

// agrupa notas pendentes por destinatário + município (uma parada por cliente/cidade)
export function paradas(notas, base, M, origem) {
  const g = {}, hoje = new Date().toISOString().slice(0, 10), P = base.P;
  for (const n of notas) {
    const k = soDig(n.dest_doc) + '|' + (n.cmun || n.xmun || '');
    const p = (g[k] ||= { key: k, doc: soDig(n.dest_doc), nome: n.dest_nome, cmun: n.cmun, xmun: n.xmun, uf: n.uf, bairro: n.bairro, cep: soDig(n.cep), logradouro: n.logradouro, nro: n.nro,
      coord: M[n.cmun] || null, notas: [], kg: 0, m3: 0, vol: 0, valor: 0, emissao: n.emissao });
    const kgN = +n.peso_b || +n.peso_l || 0;
    p.notas.push({ ...n, kg: kgN, m3: kgN / 1000 * (+P.m3_por_t || 4) }); p.kg += kgN; p.m3 += kgN / 1000 * (+P.m3_por_t || 4); p.vol += +n.q_vol || 0; p.valor += +n.v_nf || 0;
    if (n.emissao < p.emissao) p.emissao = n.emissao;
  }
  return Object.values(g).map(p => {
    const cli = base.cliPorDoc[p.doc], dias = Math.round((Date.parse(hoje) - Date.parse(p.emissao)) / 864e5);
    const dist = p.coord && origem ? distKm(origem, p.coord) * (+P.fator_rodoviario || 1.3) : null;
    return { ...p, dias, atrasada: dias > (+P.dias_atraso || 3), soPequeno: !!cli?.so_pequeno, cli, distKm: dist, longe: dist != null && dist > (+P.raio_max_km || 600), semCoord: !p.coord };
  }).sort((a, b) => (b.atrasada - a.atrasada) || a.emissao.localeCompare(b.emissao) || b.kg - a.kg);
}

// ordem de entrega: vizinho mais próximo a partir da origem + melhoria 2-opt (volta à origem); mesma cidade segue o CEP
export function ordenar(stops, origem) {
  if (stops.length < 2) return stops.slice();
  const d = (a, b) => { const x = distKm(a.coord, b.coord); return isFinite(x) ? x : 9999; };
  const O = { coord: origem }, rest = stops.slice(); let rota = [], atual = O;
  while (rest.length) { let bi = 0, bd = Infinity;
    rest.forEach((s, i) => { const dd = d(atual, s) + (s.cep && atual.cep ? Math.abs(+s.cep - +atual.cep) * 1e-9 : 0); if (dd < bd) { bd = dd; bi = i; } });
    atual = rest.splice(bi, 1)[0]; rota.push(atual); }
  const tot = (r) => r.reduce((t, s, i) => t + d(i ? r[i - 1] : O, s), 0) + d(r[r.length - 1], O);
  let melhor = tot(rota), mudou = true, voltas = 0;
  while (mudou && voltas++ < 40) { mudou = false;
    for (let i = 0; i < rota.length - 1; i++) for (let j = i + 1; j < rota.length; j++) {
      const nova = [...rota.slice(0, i), ...rota.slice(i, j + 1).reverse(), ...rota.slice(j + 1)], t = tot(nova);
      if (t < melhor - 1e-6) { rota = nova; melhor = t; mudou = true; } } }
  return rota;
}

// métricas de uma carga: peso, volume, km (ida e volta), horas e frete
export function metricas(stops, v, P, origem) {
  const kgT = stops.reduce((t, s) => t + s.kg, 0), m3T = stops.reduce((t, s) => t + s.m3, 0), f = +P.fator_rodoviario || 1.3;
  let km = 0, ant = origem; const cidades = [];
  for (const s of stops) { const x = distKm(ant, s.coord); km += isFinite(x) ? x * f : 0; if (x < 1 && ant !== origem) km += 3; ant = s.coord || ant; if (!cidades.includes(s.xmun)) cidades.push(s.xmun); }
  if (stops.length) { const x = distKm(ant, origem); km += isFinite(x) ? x * f : 0; }
  const horas = km / (+P.velocidade_kmh || 55) + stops.length * (+P.min_por_entrega || 25) / 60;
  const frete = v ? (v.custo_km ? km * v.custo_km : (v.consumo_km_l && P.diesel_rs_l ? km / v.consumo_km_l * P.diesel_rs_l : null)) : null;
  const cap = v ? capacidade(v) : null;
  return { kg: kgT, m3: m3T, km, horas, frete, cidades, pctKg: cap ? kgT / (+v.carga_kg) : null, pctM3: cap && cap.m3Bruto ? m3T / cap.m3Bruto : null,
    estoura: cap ? kgT > cap.kg + 1e-6 || m3T > cap.m3 + 1e-6 : false, passaJornada: horas > (+P.jornada_h || 10), entregas: stops.length };
}

// montagem automática: começa pela parada mais urgente e junta as mais próximas enquanto couber (peso, volume, nº de entregas e jornada)
export function montarCargas(stops, veiculos, P, origem) {
  const livres = stops.filter(s => !s.longe && !s.semCoord), fora = stops.filter(s => s.longe || s.semCoord);
  const ordemV = [...veiculos].sort((a, b) => (veiculoPequeno(a) - veiculoPequeno(b)) || (+b.carga_kg - +a.carga_kg));
  const usados = new Set(), cargas = [];
  for (const v of ordemV) {
    const cap = capacidade(v), cand = livres.filter(s => !usados.has(s.key) && (veiculoPequeno(v) || !s.soPequeno));
    if (veiculoPequeno(v)) cand.sort((a, b) => (b.soPequeno - a.soPequeno) || (b.atrasada - a.atrasada));
    const cabeCap = (sel, s) => { const kgT = sel.reduce((t, x) => t + x.kg, 0) + s.kg, m3T = sel.reduce((t, x) => t + x.m3, 0) + s.m3;
      return kgT <= cap.kg && m3T <= cap.m3 && !(v.max_entregas && sel.length + 1 > v.max_entregas); };
    const cabeJornada = (sel, s) => !metricas(ordenar([...sel, s], origem), v, P, origem).passaJornada;
    const semente = cand.find(s => cabeCap([], s) && cabeJornada([], s)); if (!semente) continue;
    const sel = [semente]; usados.add(semente.key);
    for (;;) {
      const opc = cand.filter(s => !usados.has(s.key) && cabeCap(sel, s))
        .map(s => ({ s, dd: Math.min(...sel.map(x => distKm(x.coord, s.coord))) - (s.atrasada ? 15 : 0) })).sort((a, b) => a.dd - b.dd);
      const ok = opc.slice(0, 12).find(o => cabeJornada(sel, o.s)); if (!ok) break;
      sel.push(ok.s); usados.add(ok.s.key);
    }
    const rota = ordenar(sel, origem); cargas.push({ veiculo: v, stops: rota, m: metricas(rota, v, P, origem) });
  }
  return { cargas, sobra: livres.filter(s => !usados.has(s.key)), fora };
}

// ---------------------------------------------------------------- impressão do romaneio
export async function imprimirRomaneio(carga, veiculo, stops, m) {
  const w = window.open('', '_blank'); if (!w) return alert('Libere as janelas pop-up para imprimir o romaneio');
  const kg = (v) => Math.round(+v || 0).toLocaleString('pt-BR');
  const linhas = (lista, carreg) => lista.map((s, i) => `<tr><td class="c">${carreg ? lista.length - i : i + 1}</td><td><b>${esc(s.nome || '')}</b><br><span class="p">${esc([s.logradouro, s.nro].filter(Boolean).join(', '))}${s.bairro ? ' · ' + esc(s.bairro) : ''}</span></td>
    <td>${esc(s.xmun || '')}/${esc(s.uf || '')}</td><td>${s.notas.map(n => n.numero).join(', ')}</td><td class="n">${kg(s.vol)}</td><td class="n">${kg(s.kg)}</td>${carreg ? '' : '<td class="ass"></td>'}</tr>`).join('');
  await abrirRelatorio({ janela: w, nome: `Romaneio — carga ${carga.numero || '(sugestão)'}`, titulo: `Romaneio de carga ${carga.numero ? 'nº ' + carga.numero : '(sugestão)'}`,
    subtitulo: `${dateBR(carga.data)} · ${esc(veiculo?.codigo || '')} ${esc(veiculo?.placa || '')}`,
    extraCss: '.c{text-align:center;width:28px} .p{color:#555;font-size:9.5px} td.ass{width:150px;border-left:.25px solid #bbb} @media print{h2{page-break-after:avoid}}',
    corpo: `<h2>1. Dados da carga</h2>
    <table class="info"><tr><td>Data</td><td>${dateBR(carga.data)}</td><td><b>Veículo</b></td><td>${esc(veiculo?.codigo || '')} ${esc(veiculo?.placa || '')}</td></tr>
      <tr><td>Motorista</td><td>${esc(carga.motorista || veiculo?.motorista || '')}</td><td><b>Peso / entregas</b></td><td>${kg(m.kg)} kg · ${stops.length}</td></tr>
      <tr><td>Volume estimado</td><td>${m.m3.toFixed(1).replace('.', ',')} m³</td><td><b>Trajeto previsto</b></td><td>${kg(m.km)} km · ${m.horas.toFixed(1).replace('.', ',')} h</td></tr>
      <tr><td>Saída</td><td>&nbsp;</td><td><b>Volta / km final</b></td><td>&nbsp;</td></tr></table>
    <h2>2. Ordem de carregamento (a última entrega entra primeiro)</h2><table><thead><tr><th class="c">#</th><th>Cliente</th><th>Cidade</th><th>Notas</th><th class="n">Vol.</th><th class="n">kg</th></tr></thead><tbody>${linhas(stops.slice().reverse(), true)}</tbody></table>
    <h2>3. Ordem de entrega</h2><table><thead><tr><th class="c">#</th><th>Cliente / endereço</th><th>Cidade</th><th>Notas</th><th class="n">Vol.</th><th class="n">kg</th><th>Recebido por / assinatura</th></tr></thead><tbody>${linhas(stops, false)}</tbody></table>`,
    rodape: `Romaneio emitido pela plataforma · ${esc(state.empresa.nome || '')}` });
}

// ---------------------------------------------------------------- mapa simples (sem mapa de fundo): pontos pelas coordenadas e o trajeto
export function mapaSVG(origem, rotas) {
  const pts = [origem, ...rotas.flatMap(r => r.stops.map(s => s.coord))].filter(Boolean);
  if (!pts.length) return '<div class="empty">Sem coordenadas.</div>';
  const la = pts.map(p => p[0]), lo = pts.map(p => p[1]), pad = .15;
  const y0 = Math.min(...la) - pad, y1 = Math.max(...la) + pad, x0 = Math.min(...lo) - pad, x1 = Math.max(...lo) + pad;
  const W = 800, H = Math.max(260, Math.min(620, W * (y1 - y0) / (x1 - x0 || 1))), X = (p) => (p[1] - x0) / (x1 - x0 || 1) * W, Y = (p) => (y1 - p[0]) / (y1 - y0 || 1) * H;
  const cores = ['#2563eb', '#7c3aed', '#16a34a', '#ea580c', '#0891b2', '#db2777'];
  const nomes = new Map();
  const corpo = rotas.map((r, i) => { const c = r.cor || cores[i % cores.length], seq = [origem, ...r.stops.map(s => s.coord).filter(Boolean), origem];
    r.stops.forEach(s => { if (s.coord) nomes.set(s.coord.join(), s.xmun); });
    return `<polyline points="${seq.map(p => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join(' ')}" fill="none" stroke="${c}" stroke-width="2.5" stroke-dasharray="${r.salva ? '' : '7 5'}" opacity=".85"/>
      ${r.stops.map((s, k) => s.coord ? `<g><circle cx="${X(s.coord).toFixed(1)}" cy="${Y(s.coord).toFixed(1)}" r="9" fill="${c}"/><text x="${X(s.coord).toFixed(1)}" y="${(Y(s.coord) + 3.5).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">${k + 1}</text></g>` : '').join('')}`; }).join('');
  const rot = [...nomes].map(([k, n]) => { const p = k.split(',').map(Number); return `<text x="${(X(p) + 12).toFixed(1)}" y="${(Y(p) - 8).toFixed(1)}" font-size="11" fill="#1b2350">${esc(n || '')}</text>`; }).join('');
  return `<svg viewBox="-20 -20 ${W + 40} ${H + 40}" style="width:100%;height:auto;background:#f4f7fe;border-radius:10px" font-family="Inter,system-ui,sans-serif">${corpo}${rot}
    <g><rect x="${(X(origem) - 9).toFixed(1)}" y="${(Y(origem) - 9).toFixed(1)}" width="18" height="18" rx="4" fill="#2a1f6f"/><text x="${(X(origem) + 13).toFixed(1)}" y="${(Y(origem) + 4).toFixed(1)}" font-size="12" font-weight="800" fill="#2a1f6f">Fábrica</text></g></svg>`;
}
