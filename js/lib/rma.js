// RMA — Relatório Mensal de Atividades da recuperação judicial (SQL 162): regras puras da tela Financeiro › RMA.
// Meses e prazos do pacote, nome padronizado dos arquivos, situação do mês e os relatórios que a plataforma gera
// (fluxo de caixa, contas a pagar e a receber, faturamento, notas emitidas, vendas e contratos). Cada relatório sai
// como { titulo, periodo, tabelas: [{ nome, cab, linhas, num, total }], notas }, que a tela transforma em PDF e Excel.

const n = (v) => +v || 0, r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const mesNome = (m) => `${MESES[+m.slice(5, 7) - 1]} de ${m.slice(0, 4)}`;
export const mesCurto = (m) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
export const iniMes = (m) => `${m.slice(0, 7)}-01`;
export const fimMes = (m) => `${m.slice(0, 7)}-${String(new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate()).padStart(2, '0')}`;
const br = (s) => s ? String(s).slice(0, 10).split('-').reverse().join('/') : '';
export const STATUS = { pendente: ['Pendente', 'warn'], pronto: ['Pronto', 'pos'], nao_aplica: ['Não se aplica', ''] };
export const FONTES = { anexo: 'Anexado pela equipe', fluxo_caixa: 'Fluxo de caixa do mês', titulos: 'Contas a pagar e a receber', faturamento: 'Faturamento do mês', notas_emitidas: 'Notas fiscais emitidas', vendas: 'Vendas por cliente', contratos: 'Contratos do período', extrato_conta: 'Extrato da conta, ao fechar o banco' };

/** meses de competência do RMA, do primeiro mês até o último mês encerrado (o mês corrente não entra), do mais novo para o mais antigo */
export function mesesDevidos(inicio, hoje) {
  const out = []; let [a, m] = [+hoje.slice(0, 4), +hoje.slice(5, 7)];
  for (;;) { m--; if (m === 0) { m = 12; a--; } const k = `${a}-${String(m).padStart(2, '0')}-01`; if (k < iniMes(inicio)) break; out.push(k); if (out.length > 240) break; }
  return out;
}
/** prazo de entrega: dia configurado do mês seguinte ao de competência */
export function prazoMes(mes, dia = 20) { const a = +mes.slice(0, 4), m = +mes.slice(5, 7); return `${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`; }
/** nome padronizado: SIGLA_RMA_2026-10_04_Fluxo_de_Caixa.pdf */
export function nomeArquivo(sigla, mes, doc, ext, seq = 0) {
  const limpo = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${limpo(sigla).toUpperCase() || 'EMPRESA'}_RMA_${mes.slice(0, 7)}_${limpo(doc.codigo)}_${limpo(doc.arquivo)}${seq ? '_' + seq : ''}.${String(ext).replace(/^\./, '').toLowerCase()}`;
}
/** situação de um mês: contagem por estado, o que falta de obrigatório e a relação com o prazo */
export function resumoMes(mes, entregas, docs, hoje) {
  const D = Object.fromEntries(docs.map(d => [d.id, d])), L = entregas.filter(e => D[e.documento_id]);
  const c = { pendente: 0, pronto: 0, nao_aplica: 0 }; for (const e of L) c[e.status]++;
  const faltam = L.filter(e => e.status === 'pendente' && D[e.documento_id].obrigatorio).length, total = L.length;
  const dias = mes?.prazo ? Math.round((Date.parse(mes.prazo + 'T12:00:00Z') - Date.parse(hoje + 'T12:00:00Z')) / 864e5) : null;
  const situacao = !mes ? 'nao_aberto' : mes.status === 'enviado' ? 'enviado' : dias < 0 ? 'atrasado' : !faltam && total ? 'pronto' : 'andamento';
  return { ...c, total, faltam, dias, situacao, pct: total ? Math.round((c.pronto + c.nao_aplica) / total * 100) : 0 };
}
/** alertas: mês encerrado sem pacote aberto, prazo vencido e prazo chegando */
export function alertas(cfg, meses, entregas, docs, hoje) {
  if (!cfg?.ativo) return [];
  const M = Object.fromEntries(meses.map(m => [m.mes, m])), out = [];
  for (const k of mesesDevidos(cfg.mes_inicio, hoje)) {
    const m = M[k], r = resumoMes(m, entregas.filter(e => e.mes === k), docs, hoje);
    if (r.situacao === 'enviado') continue;
    const prazo = m?.prazo || prazoMes(k, cfg.dia_entrega), dias = Math.round((Date.parse(prazo + 'T12:00:00Z') - Date.parse(hoje + 'T12:00:00Z')) / 864e5);
    if (dias < 0) out.push({ mes: k, nivel: 'alto', texto: `RMA de ${mesCurto(k)}: prazo venceu em ${br(prazo)}${m ? ` e ${r.faltam ? `faltam ${r.faltam} documento(s)` : 'o envio não foi registrado'}` : ' e o pacote não foi aberto'}` });
    else if (dias <= (cfg.dias_aviso ?? 5)) out.push({ mes: k, nivel: 'medio', texto: `RMA de ${mesCurto(k)}: entregar até ${br(prazo)}${m ? (r.faltam ? `, faltam ${r.faltam} documento(s)` : ', pronto para enviar') : ', pacote ainda não aberto'}` });
  }
  return out;
}

/** meses de competência inteiramente cobertos pelo fechamento de uma conta (fechada até `ate`), do mais antigo para o mais novo */
export function mesesCobertos(inicio, ate) {
  const out = []; let a = +inicio.slice(0, 4), m = +inicio.slice(5, 7);
  for (let i = 0; i < 240; i++) { const k = `${a}-${String(m).padStart(2, '0')}-01`; if (fimMes(k) > ate) break; out.push(k); m++; if (m === 13) { m = 1; a++; } }
  return out;
}
/** contas que entram no RMA: ativas, fora da lista de exclusão dos parâmetros; as contas de cheques (carteira e emitidos) são de controle interno e nunca entram */
export const contasDoRma = (contas, cfg) => contas.filter(c => c.ativo !== false && c.tipo !== 'Cheques' && !(cfg?.contas_fora || []).includes(c.id));
/** o mês está com todos os bancos fechados? travas: [{ conta_id, ate }] ativas. Devolve as contas que ainda faltam. */
export function contasAbertasNoMes(mes, contas, travas, cfg) {
  const T = Object.fromEntries(travas.map(t => [t.conta_id, t.ate])), fim = fimMes(mes);
  return contasDoRma(contas, cfg).filter(c => !(T[c.id] && T[c.id] >= fim));
}
/** nome do arquivo do extrato de uma conta: SIGLA_RMA_2026-04_06_Extrato_Bradesco.pdf */
export const nomeExtrato = (sigla, mes, doc, conta, ext = 'pdf') => nomeArquivo(sigla, mes, { codigo: doc.codigo, arquivo: 'Extrato_' + String(conta.nome || 'conta').trim().replace(/\s+/g, '_') }, ext);

// ---------------------------------------------------------------- relatórios gerados
const soma = (L, f) => r2(L.reduce((s, x) => s + n(f(x)), 0));
const cab = (titulo, mes, empresa) => ({ titulo, periodo: `Competência: ${mesNome(mes)}`, empresa });

/**
 * Fluxo de caixa do mês: lançamentos pagos no mês por conta do plano (transferências entre contas ficam fora) e o saldo das contas.
 * lancs: pagos do mês; planos: { id, codigo, nome, tipo E|S|T, pai_id }; saldosIni/saldosFim: linhas de saldos_contas (conta_id, nome, saldo_pago).
 */
export function fluxoCaixa(mes, lancs, planos, saldosIni = [], saldosFim = [], empresa = '') {
  const P = Object.fromEntries(planos.map(p => [p.id, p])), ini = iniMes(mes), fim = fimMes(mes), G = {};
  for (const l of lancs) { const p = P[l.plano_id]; if (!p || p.tipo === 'T' || l.status !== 'Pago' || l.data < ini || l.data > fim) continue;
    const g = G[p.id] || (G[p.id] = { p, v: 0 }); g.v += n(l.valor); }
  const linhasDe = (tipo) => Object.values(G).filter(g => g.p.tipo === tipo).sort((a, b) => String(a.p.codigo).localeCompare(String(b.p.codigo), 'pt', { numeric: true }))
    .map(g => [g.p.codigo, g.p.nome, P[g.p.pai_id]?.nome || '', r2(g.v)]);
  const E = linhasDe('E'), S = linhasDe('S'), tE = soma(E, x => x[3]), tS = soma(S, x => x[3]);
  const F = Object.fromEntries(saldosFim.map(s => [s.conta_id, s])), contas = saldosIni.map(s => [s.nome, r2(n(s.saldo_pago)), r2(n(F[s.conta_id]?.saldo_pago)), r2(n(F[s.conta_id]?.saldo_pago) - n(s.saldo_pago))])
    .filter(x => x[1] || x[2]);
  const si = soma(contas, x => x[1]), sf = soma(contas, x => x[2]);
  return { ...cab('Fluxo de caixa', mes, empresa), tabelas: [
    { nome: 'Resumo do mês', cab: ['', 'Valor (R$)'], num: [1], linhas: [['Saldo inicial das contas', si], ['(+) Entradas', tE], ['(-) Saídas', tS], ['(=) Geração de caixa do mês', r2(tE - tS)], ['Saldo final das contas', sf]] },
    { nome: 'Entradas por conta do plano', cab: ['Código', 'Conta', 'Grupo', 'Valor (R$)'], num: [3], linhas: E, total: ['', 'Total das entradas', '', tE] },
    { nome: 'Saídas por conta do plano', cab: ['Código', 'Conta', 'Grupo', 'Valor (R$)'], num: [3], linhas: S, total: ['', 'Total das saídas', '', tS] },
    { nome: 'Saldo por conta bancária', cab: ['Conta', 'Saldo inicial', 'Saldo final', 'Variação'], num: [1, 2, 3], linhas: contas, total: ['Total', si, sf, r2(sf - si)] },
  ], notas: ['Regime de caixa: lançamentos pagos e recebidos no mês. Transferências entre contas da própria empresa não entram em entradas nem em saídas.',
    Math.abs(r2(sf - si) - r2(tE - tS)) > 0.01 ? `A variação do saldo das contas (${r2(sf - si).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}) difere da geração de caixa (${r2(tE - tS).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}): há lançamento pago sem conta bancária ou em conta inativa.` : null].filter(Boolean),
    totais: { entradas: tE, saidas: tS, saldo_inicial: si, saldo_final: sf } };
}

/**
 * Contas a pagar e a receber no último dia do mês. Um título estava em aberto naquele dia se foi emitido até lá e
 * (ainda está em aberto hoje ou foi pago depois). Sem data de emissão, vale a data em que o título foi criado.
 */
export function titulosAbertos(mes, lancs, planos, favs = {}, empresa = '') {
  const P = Object.fromEntries(planos.map(p => [p.id, p])), fim = fimMes(mes);
  const L = lancs.filter(l => { const p = P[l.plano_id]; if (!p || p.tipo === 'T') return false; const nasc = String(l.emissao || l.created_at || l.data).slice(0, 10);
    return nasc <= fim && (l.status === 'Em aberto' || l.data > fim); });
  const faixa = (l) => { if (l.status === 'Pago') return 'Liquidado depois do mês'; const d = Math.round((Date.parse(fim + 'T12:00:00Z') - Date.parse(l.data + 'T12:00:00Z')) / 864e5);
    return d <= 0 ? 'A vencer' : d <= 30 ? 'Vencido até 30 dias' : d <= 90 ? 'Vencido de 31 a 90 dias' : 'Vencido há mais de 90 dias'; };
  const tab = (tipo) => L.filter(l => P[l.plano_id].tipo === tipo).sort((a, b) => a.data.localeCompare(b.data))
    .map(l => [br(l.status === 'Pago' ? (l.emissao || l.data) : l.data), favs[l.favorecido_id] || '', l.descricao || '', l.documento || '', P[l.plano_id].nome, faixa(l), r2(n(l.valor))]);
  const R = tab('E'), Pg = tab('S'), FX = ['A vencer', 'Vencido até 30 dias', 'Vencido de 31 a 90 dias', 'Vencido há mais de 90 dias', 'Liquidado depois do mês'];
  const porFaixa = FX.map(f => [f, soma(R.filter(x => x[5] === f), x => x[6]), soma(Pg.filter(x => x[5] === f), x => x[6])]).filter(x => x[1] || x[2]);
  const tR = soma(R, x => x[6]), tP = soma(Pg, x => x[6]), C = ['Vencimento', 'Cliente / fornecedor', 'Descrição', 'Documento', 'Conta', 'Situação em ' + br(fim), 'Valor (R$)'];
  return { ...cab('Contas a pagar e a receber', mes, empresa), periodo: `Posição em ${br(fim)}`, tabelas: [
    { nome: 'Resumo por situação', cab: ['Situação', 'A receber (R$)', 'A pagar (R$)'], num: [1, 2], linhas: porFaixa, total: ['Total', tR, tP] },
    { nome: 'Contas a receber', cab: C, num: [6], linhas: R, total: ['', '', '', '', '', `${R.length} título(s)`, tR] },
    { nome: 'Contas a pagar', cab: C, num: [6], linhas: Pg, total: ['', '', '', '', '', `${Pg.length} título(s)`, tP] },
  ], notas: ['Posição reconstituída pela plataforma: títulos emitidos até o último dia do mês que ainda estavam em aberto naquela data. "Liquidado depois do mês" são títulos pagos ou recebidos depois do fechamento; nesses, a coluna Vencimento mostra a emissão.',
    'Os créditos sujeitos à recuperação judicial seguem o quadro de credores e o plano; esta relação traz os títulos lançados no financeiro.'], totais: { receber: tR, pagar: tP, qtd_receber: R.length, qtd_pagar: Pg.length } };
}

const doMes = (notas, mes) => { const i = iniMes(mes), f = fimMes(mes); return notas.filter(x => { const d = String(x.emissao).slice(0, 10); return x.tipo === 'saida' && x.emissao_propria !== false && d >= i && d <= f; }); };
const ehDevolucao = (x) => +x.finalidade === 4;
const ehVenda = (x) => !ehDevolucao(x) && (x.cfops || []).some(c => /^[567](1[0-2]\d|25\d|40[1-5]|65\d|933)/.test(String(c)) || /^[567]10[1-9]|^[567]11\d|^[567]12\d/.test(String(c)));

/** Relação de notas fiscais emitidas no mês (todas, inclusive canceladas) */
export function notasEmitidas(mes, notas, empresa = '') {
  const L = doMes(notas, mes).sort((a, b) => String(a.emissao).localeCompare(String(b.emissao)) || n(a.numero) - n(b.numero));
  const linhas = L.map(x => [br(x.emissao), `${x.numero}${x.serie ? '/' + x.serie : ''}`, x.dest_nome || '', x.dest_doc || '', x.dest_uf || '', (x.cfops || []).join(' '), x.natureza || '', x.situacao === 'autorizada' ? 'Autorizada' : x.situacao === 'cancelada' ? 'Cancelada' : x.situacao || '', r2(n(x.v_nf)), x.chave || '']);
  const ok = L.filter(x => x.situacao === 'autorizada');
  return { ...cab('Relação de notas fiscais emitidas', mes, empresa), tabelas: [
    { nome: 'Notas emitidas', cab: ['Emissão', 'Número', 'Destinatário', 'CNPJ / CPF', 'UF', 'CFOP', 'Natureza', 'Situação', 'Valor (R$)', 'Chave de acesso'], num: [8], linhas, total: ['', `${L.length} nota(s)`, '', '', '', '', '', `${ok.length} autorizada(s)`, soma(ok, x => x.v_nf), ''] },
  ], notas: ['O total considera só as notas autorizadas. Notas canceladas aparecem na relação para manter a sequência da numeração.'], totais: { qtd: L.length, autorizadas: ok.length, canceladas: L.filter(x => x.situacao === 'cancelada').length, valor: soma(ok, x => x.v_nf) } };
}

/** Faturamento do mês: vendas, devoluções e outras saídas, com os impostos destacados e o faturamento por dia */
export function faturamento(mes, notas, empresa = '') {
  const L = doMes(notas, mes).filter(x => x.situacao === 'autorizada'), V = L.filter(ehVenda), D = L.filter(ehDevolucao), O = L.filter(x => !ehVenda(x) && !ehDevolucao(x));
  const imp = (X) => soma(X, x => n(x.v_icms) + n(x.v_st) + n(x.v_ipi) + n(x.v_pis) + n(x.v_cofins) + n(x.v_ibs) + n(x.v_cbs));
  const bruto = soma(V, x => x.v_nf), impostos = imp(V), dias = {};
  for (const x of V) { const d = String(x.emissao).slice(0, 10); (dias[d] ||= { q: 0, v: 0 }); dias[d].q++; dias[d].v += n(x.v_nf); }
  return { ...cab('Relatório de faturamento mensal', mes, empresa), tabelas: [
    { nome: 'Resumo do faturamento', cab: ['', 'Notas', 'Valor (R$)'], num: [1, 2], linhas: [['Faturamento bruto (vendas)', V.length, bruto], ['(-) Impostos destacados nas vendas', '', impostos], ['(=) Faturamento líquido de impostos', '', r2(bruto - impostos)],
      ['Devoluções emitidas (a fornecedores)', D.length, soma(D, x => x.v_nf)], ['Outras saídas (remessas, bonificações, transferências)', O.length, soma(O, x => x.v_nf)]] },
    { nome: 'Impostos destacados nas vendas', cab: ['Imposto', 'Valor (R$)'], num: [1], linhas: [['ICMS', soma(V, x => x.v_icms)], ['ICMS ST', soma(V, x => x.v_st)], ['IPI', soma(V, x => x.v_ipi)], ['PIS', soma(V, x => x.v_pis)], ['COFINS', soma(V, x => x.v_cofins)], ['IBS', soma(V, x => x.v_ibs)], ['CBS', soma(V, x => x.v_cbs)]].filter(x => x[1]), total: ['Total', impostos] },
    { nome: 'Faturamento por dia', cab: ['Dia', 'Notas', 'Valor (R$)'], num: [1, 2], linhas: Object.keys(dias).sort().map(d => [br(d), dias[d].q, r2(dias[d].v)]), total: ['Total', V.length, bruto] },
  ], notas: ['Faturamento = notas de saída autorizadas com CFOP de venda. Devoluções de clientes são notas de entrada e não aparecem aqui; canceladas ficam fora.'], totais: { bruto, impostos, liquido: r2(bruto - impostos), notas: V.length } };
}

/** Vendas do mês por cliente, da maior para a menor, com a participação de cada um */
export function vendasPorCliente(mes, notas, empresa = '') {
  const V = doMes(notas, mes).filter(x => x.situacao === 'autorizada' && ehVenda(x)), G = {};
  for (const x of V) { const k = x.dest_doc || x.dest_nome; const g = G[k] || (G[k] = { nome: x.dest_nome || '', doc: x.dest_doc || '', uf: x.dest_uf || '', q: 0, v: 0 }); g.q++; g.v += n(x.v_nf); }
  const tot = soma(V, x => x.v_nf), L = Object.values(G).sort((a, b) => b.v - a.v);
  return { ...cab('Relatório de vendas', mes, empresa), tabelas: [
    { nome: 'Vendas por cliente', cab: ['Cliente', 'CNPJ / CPF', 'UF', 'Notas', 'Valor (R$)', '% do mês'], num: [3, 4, 5], linhas: L.map(g => [g.nome, g.doc, g.uf, g.q, r2(g.v), tot ? r2(g.v / tot * 100) : 0]), total: [`${L.length} cliente(s)`, '', '', V.length, tot, tot ? 100 : 0] },
  ], notas: ['Notas de saída autorizadas com CFOP de venda, pelo valor total da nota.'], totais: { clientes: L.length, valor: tot } };
}

/** Contratos firmados, alterados ou rescindidos no mês */
export function contratosPeriodo(mes, contratos, empresa = '') {
  const i = iniMes(mes), f = fimMes(mes), d = (v) => String(v || '').slice(0, 10), em = (v) => d(v) >= i && d(v) <= f, NAT = { pagar: 'A pagar', receber: 'A receber', sem_valor: 'Sem valor' };
  const lin = (c, ev, quando) => [ev, br(quando), c.numero || '', c.parte_nome || '', c.objeto || '', NAT[c.natureza] || '', r2(n(c.valor)), c.periodicidade || '', br(c.inicio), br(c.fim)];
  const firmados = contratos.filter(c => c.status !== 'rascunho' && em(c.inicio)), enc = contratos.filter(c => ['encerrado', 'rescindido'].includes(c.status) && em(c.encerrado_em));
  const alt = contratos.filter(c => c.status === 'vigente' && em(c.atualizado_em) && !em(c.inicio) && d(c.criado_em) < i);
  const linhas = [...firmados.map(c => lin(c, 'Firmado', c.inicio)), ...alt.map(c => lin(c, 'Alterado', c.atualizado_em)), ...enc.map(c => lin(c, c.status === 'rescindido' ? 'Rescindido' : 'Encerrado', c.encerrado_em))];
  return { ...cab('Relação de contratos firmados, alterados ou rescindidos', mes, empresa), tabelas: [
    { nome: 'Contratos do período', cab: ['Ocorrência', 'Data', 'Número', 'Parte', 'Objeto', 'Natureza', 'Valor (R$)', 'Periodicidade', 'Início', 'Fim'], num: [6], linhas: linhas.length ? linhas : [['Sem contratos firmados, alterados ou rescindidos no período', '', '', '', '', '', '', '', '', '']] },
  ], notas: ['Fonte: Cadastros › Contratos. "Alterado" são contratos vigentes modificados no mês (reajuste, valor, prazo ou parte).'], totais: { firmados: firmados.length, alterados: alt.length, encerrados: enc.length } };
}

/**
 * Extrato conciliado de uma conta no mês: quadro do fechamento (saldo da plataforma × saldo conferido no banco), resumo e cada
 * lançamento pago com o saldo corrente. Transferência entra nas duas contas (sai de conta_id, entra em conta_destino_id).
 * lancs: pagos do mês em que a conta é origem ou destino; planos com natureza C|D; fecho: { ate, saldo_banco, saldo_sistema, observacao, por, em, pendentes, valorPendente }.
 */
export function extratoConta(mes, conta, lancs, planos, favs = {}, saldoInicial = 0, fecho = null, empresa = '') {
  const P = Object.fromEntries(planos.map(p => [p.id, p])), ini = iniMes(mes), fim = fimMes(mes);
  const L = lancs.filter(l => l.status === 'Pago' && l.data >= ini && l.data <= fim && (l.conta_id === conta.id || l.conta_destino_id === conta.id))
    .flatMap(l => { const out = [];
      if (l.conta_id === conta.id) out.push({ l, sinal: (P[l.plano_id]?.natureza === 'C' ? 1 : -1) * n(l.valor), transf: l.conta_destino_id ? 'Transferência enviada' : '' });
      if (l.conta_destino_id === conta.id) out.push({ l, sinal: n(l.valor), transf: 'Transferência recebida' });
      return out; })
    .sort((a, b) => a.l.data.localeCompare(b.l.data) || String(a.l.created_at || '').localeCompare(String(b.l.created_at || '')));
  let s = r2(n(saldoInicial)); const linhas = [];
  for (const x of L) { s = r2(s + x.sinal); const p = P[x.l.plano_id];
    linhas.push([br(x.l.data), [favs[x.l.favorecido_id], x.l.descricao, x.transf].filter(Boolean).join(' — ') || (p?.nome || ''), p ? `${p.codigo} ${p.nome}` : '', x.l.documento || '', x.sinal > 0 ? r2(x.sinal) : '', x.sinal < 0 ? r2(-x.sinal) : '', s]); }
  const ent = soma(L.filter(x => x.sinal > 0), x => x.sinal), sai = soma(L.filter(x => x.sinal < 0), x => -x.sinal), final = r2(n(saldoInicial) + ent - sai);
  const banco = [conta.instituicao, conta.agencia && `agência ${conta.agencia}`, conta.numero && `conta ${conta.numero}`].filter(Boolean).join(' · ');
  const noMes = fecho && fecho.ate === fim, dif = noMes && fecho.saldo_banco != null ? r2(n(fecho.saldo_banco) - final) : null;
  const quadro = [['Conta', conta.nome + (banco ? ` (${banco})` : '')], ['Situação', fecho ? `Conciliada e fechada até ${br(fecho.ate)}` : 'Conta ainda não fechada neste mês'],
    ['Saldo da plataforma em ' + br(fim), final]];
  if (noMes && fecho.saldo_banco != null) quadro.push(['Saldo conferido no banco em ' + br(fim), r2(n(fecho.saldo_banco))], ['Diferença', dif]);
  if (fecho?.pendentes) quadro.push([`Movimentos do extrato do banco sem conciliar no mês (${fecho.pendentes})`, r2(n(fecho.valorPendente))]);
  if (fecho?.por || fecho?.em) quadro.push(['Fechada por', [fecho.por, fecho.em && br(fecho.em)].filter(Boolean).join(' em ')]);
  if (fecho?.observacao) quadro.push(['Observação do fechamento', fecho.observacao]);
  return { ...cab('Extrato conciliado da conta', mes, empresa), periodo: `${conta.nome} — ${br(ini)} a ${br(fim)}`, tabelas: [
    { nome: 'Fechamento da conta', cab: ['', 'Informação'], num: [1], linhas: quadro },
    { nome: 'Resumo do mês', cab: ['Saldo inicial', '(+) Entradas', '(-) Saídas', '(=) Saldo final'], num: [0, 1, 2, 3], linhas: [[r2(n(saldoInicial)), ent, sai, final]] },
    { nome: 'Movimentos', cab: ['Data', 'Histórico', 'Conta do plano', 'Documento', 'Entrada', 'Saída', 'Saldo'], num: [4, 5, 6], linhas: linhas.length ? linhas : [['', 'Sem movimento no período', '', '', '', '', final]], total: ['', `${L.length} lançamento(s)`, '', '', ent, sai, final] },
  ], notas: ['Lançamentos pagos e recebidos da conta na plataforma, os mesmos conferidos com o extrato do banco na conciliação. Transferências entre contas da empresa aparecem nas duas contas.',
    dif != null && Math.abs(dif) > 0.05 ? `Atenção: o saldo conferido no banco difere do saldo da plataforma em ${dif.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}.` : null].filter(Boolean),
    totais: { saldo_inicial: r2(n(saldoInicial)), entradas: ent, saidas: sai, saldo_final: final, qtd: L.length, diferenca: dif } };
}

export const GERADORES = { fluxo_caixa: fluxoCaixa, titulos: titulosAbertos, faturamento, notas_emitidas: notasEmitidas, vendas: vendasPorCliente, contratos: contratosPeriodo };

/** o relatório como planilha: uma lista de linhas por tabela (para uma aba cada) */
export function paraPlanilhas(rel) {
  return rel.tabelas.map(t => ({ nome: t.nome.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), linhas: [[rel.empresa || ''], [rel.titulo], [rel.periodo], [], t.cab, ...t.linhas, ...(t.total ? [t.total] : []), [], ...(rel.notas || []).map(x => [x])] }));
}
