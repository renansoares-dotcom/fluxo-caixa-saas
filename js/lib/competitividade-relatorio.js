// Relatórios em PDF da Análise de Competitividade de Preço (COM009). Sem DOM: recebe a análise salva (ou a da tela) e devolve as seções.
// Duas versões: interna (com empate, faixa e margem) e para o cliente (só o custo líquido de cada caminho e a memória de cálculo).
import { STATUS, TIPOS_CLIENTE, REGIMES_CLIENTE, rotuloUn } from './competitividade.js';

const TIPO = Object.fromEntries(TIPOS_CLIENTE), REG = Object.fromEntries(REGIMES_CLIENTE);
const pc = (v) => (v == null || !isFinite(v) ? '–' : `${(+v).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);

function tab(cab, linhas, rod = '') {
  return `<table><thead><tr>${cab.map(([t, n]) => `<th${n ? ' class="n"' : ''}>${t}</th>`).join('')}</tr></thead><tbody>${linhas || `<tr><td colspan="${cab.length}">Nenhum registro.</td></tr>`}</tbody>${rod ? `<tfoot>${rod}</tfoot>` : ''}</table>`;
}
const memoria = (L, { esc, money, un = 'unidade' }) => tab([['Item', 0], [`R$ por ${un}`, 1], ['Observação', 0]],
  (L || []).map(l => { const tot = l.k === 'custo' || l.k === 'vp' || /^Margem/.test(l.txt || ''); const c = tot ? 'th' : 'td';
    return `<tr><${c}>${esc(l.txt)}</${c}><${c} class="n">${money(l.v)}</${c}><${c}>${esc(l.obs || '')}</${c}></tr>`; }).join(''));

/** a: análise (como gravada: cliente, concorrente, proposta, resultado, parametros…); mg: dados da margem (ou null); o.interna: versão interna */
export function relatorioAnalise(a, mg, o) {
  const R = a.resultado || {}, un = rotuloUn(R.base); o = { ...o, un };
  const { esc, money, dateBR, interna } = o, c = a.cliente || {}, k = a.concorrente || {}, p = a.proposta || {};
  const cotado = (x) => (x.unid && x.unid !== (R.base || 'UN') && x.preco_informado != null ? `${money(x.preco_informado)} por ${rotuloUn(x.unid)}` : '');
  let n = 0; const h = (t) => `<h2>${++n}. ${t}</h2>`, out = [];
  const forn = interna && k.nome ? `${k.nome} (${k.uf})` : `Fornecedor atual (${k.uf || '—'})`;
  const nosso = o.empresa || 'Nossa proposta';
  out.push(h('Identificação'), tab([['Campo', 0], ['Informação', 0]], [
    ['Análise', `nº ${a.numero || '—'} de ${dateBR(a.data)}${interna ? ` · ${STATUS[a.status] || a.status || ''}` : ''}`],
    ['Cliente', `${a.cliente_nome || ''}${c.documento ? ` · ${c.documento}` : ''}`],
    ['Perfil fiscal do cliente', `${c.uf || '—'} · ${TIPO[c.tipo] || c.tipo || '—'} · ${REG[c.regime] || c.regime || '—'} · crédito de ICMS: ${c.cred_icms ? 'sim' : 'não'} · crédito de PIS/COFINS: ${c.cred_pc ? 'sim' : 'não'}`],
    ['Produto', `${a.produto_desc || '—'}${a.ncm ? ` · NCM ${a.ncm}` : ''}${+R.peso_un ? ` · ${(+R.peso_un).toLocaleString('pt-BR', { maximumFractionDigits: 4 })} kg por unidade` : ''}`],
    ['Base da comparação', `R$ por ${un}`],
    ...(interna ? [['Responsável', a.responsavel_nome || '—']] : []),
  ].map(([x, y]) => `<tr><td>${esc(x)}</td><td>${esc(y)}</td></tr>`).join('')));
  const dif = R.dif, ganha = dif != null && dif <= 1e-9;
  out.push(h(`Comparação do custo líquido por ${un}`), tab([['', 0], [esc(forn), 1], [esc(nosso), 1]], [
    ...(cotado(k) || cotado(p) ? [['Preço cotado', cotado(k) || `${money(k.preco)} por ${un}`, cotado(p) || `${money(p.preco)} por ${un}`]] : []),
    ['Origem → destino', `${k.uf || '—'} → ${c.uf || '—'}`, `${p.uf || '—'} → ${c.uf || '—'}`],
    [`Preço por ${un}`, money(k.preco), money(p.preco)],
    ['Alíquota de ICMS da operação', pc(k.aliq), pc(p.aliq)],
    ['Frete', k.frete_tipo === 'FOB' ? `FOB ${money(k.frete_un)} por ${un}` : 'CIF', p.frete_tipo === 'FOB' ? `FOB ${money(p.frete_un)} por ${un}` : 'CIF'],
    ['Custo líquido para o cliente', money(R.conc?.custoVp), money(R.nos?.custoVp)],
  ].map(([x, y, z]) => { const c2 = /^Custo/.test(x) ? 'th' : 'td'; return `<tr><${c2}>${x}</${c2}><${c2} class="n">${y}</${c2}><${c2} class="n">${z}</${c2}></tr>`; }).join('')),
  `<p>${ganha ? `O custo líquido da nossa proposta é ${money(-dif)} menor por ${un} (${pc(-R.difPct)}).` : `O custo líquido da nossa proposta é ${money(dif)} maior por ${un} (${pc(R.difPct)}).`}
   O custo líquido é o preço pago menos os créditos que o cliente recupera (ICMS e, quando aplicável, PIS/COFINS), mais o DIFAL ou a antecipação que ele recolhe e não recupera.</p>`);
  out.push(h(`Memória de cálculo — ${esc(forn)}`), memoria(R.conc?.linhas, o));
  out.push(h(`Memória de cálculo — ${esc(nosso)}`), memoria(R.nos?.linhas, o));
  const av = [...(R.conc?.avisos || []), ...(R.nos?.avisos || [])];
  if (interna) {
    out.push(h('Preço de empate e faixa de negociação'), `<p>Preço de empate: <b>${money(R.empate)}</b>. É o maior preço da nossa proposta com custo líquido para o cliente igual ou menor que o atual (o valor exato, ${(+R.empateBruto || 0).toLocaleString('pt-BR', { maximumFractionDigits: 4 })}, é arredondado para baixo).</p>`);
    if (mg?.faixa) out.push(mg.faixa.viavel ? `<p>Faixa sugerida: de <b>${money(mg.faixa.de)}</b> (margem mínima de ${pc(mg.margem_min_pct)}) a <b>${money(mg.faixa.ate)}</b> (empate).</p>`
      : `<p>Não há faixa competitiva com a margem mínima de ${pc(mg.margem_min_pct)}: o preço que dá essa margem (${money(mg.faixa.de)}) fica acima do empate (${money(mg.faixa.ate)}).</p>`);
    if (mg) {
      const lin = [['No preço proposto', p.preco, mg.proposta], ['No empate', R.empate, mg.empate], ['Na margem mínima', mg.faixa?.de, mg.piso]].filter(x => x[2]);
      out.push(h('Nossa margem (uso interno)'), tab([['Ponto', 0], ['Preço', 1], ['Margem R$', 1], ['Margem %', 1]],
        lin.map(([t, v, m]) => `<tr><td>${t}</td><td class="n">${money(v)}</td><td class="n">${money(m.margem)}</td><td class="n">${pc(m.pct)}</td></tr>`).join('')),
      '<p>Memória da margem no preço proposto:</p>', memoria(mg.proposta?.linhas, o));
    }
  }
  const RF = R.reforma || [];
  if (RF.length) {
    const mr = Object.fromEntries((mg?.reforma || []).map(x => [x.ano, x.margem]));
    out.push(h('Simulação da reforma tributária (2027 em diante)'), tab([['Ano', 0], ['ICMS que continua', 1], ['CBS + IBS', 1], [esc(forn), 1], [esc(nosso), 1], ['Diferença', 1],
      ...(interna ? [['Empate', 1], ...(mg ? [['Margem %', 1]] : [])] : [])],
    RF.map(r => `<tr><td>${r.ano}${r.situacao && r.situacao !== 'vigente' ? ` (${esc(r.situacao)})` : ''}</td><td class="n">${pc(r.icms_pct)}</td><td class="n">${pc(r.t)}</td><td class="n">${money(r.conc)}</td><td class="n">${money(r.nos)}</td><td class="n">${money(r.dif)}</td>${interna ? `<td class="n">${money(r.empate)}</td>${mg ? `<td class="n">${pc(mr[r.ano])}</td>` : ''}` : ''}</tr>`).join('')),
    '<p>Mesmos preços, com o ICMS reduzido na proporção da transição e a CBS e o IBS por fora, sem o ICMS na base, com crédito integral para o contribuinte. Estimativa com as alíquotas cadastradas por ano.</p>');
  }
  const P = a.parametros || {};
  const prem = [
    P.interna ? `Alíquota interna de ${c.uf}: ${pc(P.interna.aliquota)} (${P.interna.norma || 'norma não informada'}, desde ${dateBR(P.interna.vigencia_inicio)}${P.interna.situacao === 'a_conferir' ? ', a conferir' : ''}).` : '',
    P.antecipacao ? `Antecipação parcial de ${c.uf}: ${pc(P.antecipacao.pct)} (${P.antecipacao.norma || ''}).` : '',
    c.cred_pc ? `Crédito de PIS/COFINS de ${pc(P.pc_pct)}${P.pc_excluir_icms !== false ? ', sem o ICMS na base (Lei 14.592/2023)' : ''}.` : '',
    +P.taxa_mensal ? `Prazo trazido a valor presente a ${pc(P.taxa_mensal)} ao mês.` : '',
    ...av,
  ].filter(Boolean);
  if (prem.length) out.push(h('Premissas'), `<ul>${prem.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`);
  if (!interna) out.push('<p>Simulação para apoio à decisão de compra, com as regras de ICMS e PIS/COFINS vigentes na data; o aproveitamento dos créditos depende do enquadramento fiscal do cliente, a ser confirmado pela contabilidade dele.</p>');
  return out.join('');
}

/** lista do histórico (com os filtros já aplicados); M: margem por análise (só quem tem a liberação) */
export function relatorioHistorico(L, M, o) {
  const { esc, money, dateBR, interna } = o;
  const st = { negociacao: 0, ganha: 0, perdida: 0 }; for (const a of L) st[a.status] = (st[a.status] || 0) + 1;
  const fech = st.ganha + st.perdida;
  let n = 0; const h = (t) => `<h2>${++n}. ${t}</h2>`;
  const mot = {}; for (const a of L) if (a.status === 'perdida') { const k = (a.status_obs || 'sem motivo').trim().toLowerCase(); mot[k] = (mot[k] || 0) + 1; }
  const out = [h('Resumo'), `<p>${L.length} análise(s): ${st.negociacao} em negociação, ${st.ganha} ganha(s) e ${st.perdida} perdida(s)${fech ? `; taxa de êxito nas fechadas de ${pc(st.ganha / fech * 100)}` : ''}.</p>`];
  if (Object.keys(mot).length) out.push(tab([['Motivo da perda', 0], ['Qtd.', 1]], Object.entries(mot).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${v}</td></tr>`).join('')));
  out.push(h('Análises'), tab([['Nº', 1], ['Data', 0], ['Cliente', 0], ['Produto', 0], ['Fornecedor atual', 0], ['Preço atual', 1], ['Nosso preço', 1], ['Custo atual', 1], ['Nosso custo', 1], ['Dif. %', 1], ['Empate', 1], ['Base', 0],
    ...(interna && M ? [['Margem %', 1]] : []), ['Status', 0], ['Responsável', 0]],
  L.map(a => { const R = a.resultado || {}, k = a.concorrente || {}, m = M?.[a.id];
    return `<tr><td class="n">${a.numero}</td><td>${dateBR(a.data)}</td><td>${esc(a.cliente_nome)}</td><td>${esc(a.produto_desc || '')}</td><td>${esc(k.nome ? `${k.nome} (${k.uf})` : k.uf || '')}</td>
      <td class="n">${money(k.preco)}</td><td class="n">${money(a.proposta?.preco)}</td><td class="n">${money(R.conc?.custoVp)}</td><td class="n">${money(R.nos?.custoVp)}</td><td class="n">${pc(R.difPct)}</td><td class="n">${money(R.empate)}</td><td>${R.base === 'KG' ? 'kg' : 'un'}</td>
      ${interna && M ? `<td class="n">${m ? pc(m.proposta?.pct) : '–'}</td>` : ''}<td>${esc(STATUS[a.status] || a.status)}${a.status_obs ? ` (${esc(a.status_obs)})` : ''}</td><td>${esc(a.responsavel_nome || '')}</td></tr>`; }).join('')));
  return out.join('');
}
