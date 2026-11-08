// Roteiro da implantação do estoque (melhoria 5.1): avalia cada passo com os números do banco
// (est_implantacao_situacao) e as metas da empresa. Funções puras.

export const ETAPAS = [
  { k: 'espelho', nome: 'Saldo do Iniflex importado', rota: 'estoque', acao: 'Importar o espelho em Posição de Estoque',
    o_que: 'Exportar do Iniflex o saldo de matérias-primas, insumos, peças e produtos por depósito, com o custo, e importar em Posição de Estoque › Importar espelho.' },
  { k: 'locais', nome: 'Locais e setores', rota: 'estoque/parametros', acao: 'Conferir locais em Parâmetros do Estoque',
    o_que: 'Cada setor da produção (extrusão, impressão, corte e solda) precisa de um local "em processo". Cadastre os setores em Produção › Cadastros e crie os locais em Parâmetros do Estoque.' },
  { k: 'cadastro', nome: 'Materiais cadastrados', rota: 'estoque/cadastro-notas', acao: 'Gravar os produtos em Cadastro pelas Notas',
    o_que: 'Cadastrar resinas, masters, tintas, insumos e peças. Use Cadastro pelas Notas de Entrada: grave a curva A e B primeiro. O código do Iniflex liga a linha do espelho ao produto.' },
  { k: 'depara', nome: 'De-para das compras', rota: 'estoque/cadastro-notas', acao: 'Ligar os itens dos fornecedores',
    o_que: 'Cada item de nota de entrada (código do fornecedor) precisa apontar para um produto, com o fator de conversão. O cadastro pelas notas já cria o de-para.' },
  { k: 'cfop', nome: 'Regras dos CFOPs', rota: 'estoque/cadastro-notas', acao: 'Criar as regras que faltam',
    o_que: 'Todo CFOP usado nas notas precisa de regra: qual movimento gera (compra, venda, remessa, retorno) ou "não movimenta".' },
  { k: 'vendas', nome: 'Vendas prontas', rota: 'estoque/produtos', acao: 'Conferir os produtos acabados',
    o_que: 'As notas de venda saem pelo código do produto. Produtos vendidos sem cadastro ou sem local viram pendência.' },
  { k: 'saldo', nome: 'Saldo inicial implantado', rota: 'estoque/kardex', acao: 'Implantar o saldo no Kardex',
    o_que: 'No Kardex, Implantar saldo inicial: escolher o espelho, a data e o local de cada depósito. Só pode ser feito uma vez, com o Kardex vazio.' },
  { k: 'automatico', nome: 'Automático e pendências', rota: 'estoque/kardex', acao: 'Tratar as pendências das notas',
    o_que: 'Com o saldo implantado, as NF-e passam a movimentar sozinhas. O que não fecha vira pendência no Kardex: resolver ou ignorar e reprocessar.' },
  { k: 'fechamento', nome: 'Primeiro mês fechado', rota: 'estoque/kardex', acao: 'Fechar o mês do estoque',
    o_que: 'Conferir o saldo físico com o Kardex e fechar o primeiro mês. A partir daí o estoque é o oficial da empresa.' },
];
export const CFG_PADRAO = { meta_cadastro_pct: 95, meta_entrada_pct: 90, meta_saida_pct: 98, janela_meses: 12 };
export const SIT = { feito: ['Concluído', 'pago'], andamento: ['Em andamento', 'aberto'], pendente: ['A fazer', 'vencido'], bloqueado: ['Aguarda passo anterior', ''], dispensado: ['Não se aplica', ''] };

const n0 = (v) => Number(v || 0);
const pct = (a, b) => (n0(b) > 0 ? (n0(a) / n0(b)) * 100 : null);
const fmtN = (v) => n0(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const fmtP = (v) => (v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`);
const fmtR = (v) => 'R$ ' + n0(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** prontidão de um sentido (entrada ou saída): valor pronto ÷ valor total; e os itens por resultado */
export function prontidao(pr, sentido) {
  const l = ((pr && pr.resumo) || []).filter(r => r.sentido === sentido);
  const tot = l.reduce((s, r) => s + n0(r.valor), 0), itens = l.reduce((s, r) => s + n0(r.itens), 0);
  const pronto = l.filter(r => r.resultado === 'ok' || r.resultado === 'nao_movimenta').reduce((s, r) => s + n0(r.valor), 0);
  const por = Object.fromEntries(l.map(r => [r.resultado, { itens: n0(r.itens), valor: n0(r.valor) }]));
  return { total: tot, itens, pronto, pct: pct(pronto, tot), por };
}

/** avalia os 9 passos; etapas = registros de est_implantacao_etapas (responsável, prevista, dispensada) */
export function avaliar(sit, cfg = {}, etapas = [], hoje = new Date().toISOString().slice(0, 10)) {
  const c = { ...CFG_PADRAO, ...Object.fromEntries(Object.entries(cfg || {}).filter(([, v]) => v != null)) };
  const S = sit || {}, E = Object.fromEntries((etapas || []).map(e => [e.etapa, e]));
  const ent = prontidao(S.prontidao, 'entrada'), sai = prontidao(S.prontidao, 'saida');
  const cad = S.cadastro || {}, esp = S.espelho || {}, loc = S.locais || {}, sal = S.saldo || {}, aut = S.automatico || {}, fec = S.fechamento || {};
  const pctCad = pct(cad.esp_valor_ligado, cad.esp_valor) ?? pct(cad.esp_ligadas, cad.esp_linhas);
  const semRegra = ((S.prontidao || {}).cfops_sem_regra || []);
  const semProdEnt = ent.por.sem_produto || { itens: 0, valor: 0 };
  const r = {};
  r.espelho = !esp.qtd ? { s: 'pendente', pct: 0, txt: ['Nenhum espelho importado.'] }
    : { s: 'feito', pct: 100, txt: [`Espelho de ${br(esp.data_ref)}: ${fmtN(esp.linhas)} linhas em ${fmtN(esp.depositos)} depósito(s)${esp.valor != null ? `, ${fmtR(esp.valor)}` : ''}.`] };
  r.locais = { s: !loc.ativos ? 'pendente' : loc.setores_sem_local ? 'andamento' : 'feito', pct: !loc.ativos ? 0 : loc.setores_sem_local ? 60 : 100,
    txt: [`${fmtN(loc.ativos)} locais ativos; ${fmtN(loc.setores)} setor(es) da produção${loc.setores_sem_local ? `, ${fmtN(loc.setores_sem_local)} sem local "em processo"` : ''}.`] };
  r.cadastro = !esp.qtd ? { s: n0(cad.nao_acabados) ? 'andamento' : 'bloqueado', pct: n0(cad.nao_acabados) ? 30 : 0, txt: [`${fmtN(cad.nao_acabados)} materiais cadastrados (fora os acabados). A conferência com o Iniflex começa quando o espelho for importado.`] }
    : { s: pctCad != null && pctCad >= c.meta_cadastro_pct ? 'feito' : pctCad ? 'andamento' : 'pendente', pct: Math.min(100, (pctCad || 0) / c.meta_cadastro_pct * 100),
      txt: [`${fmtP(pctCad)} do valor do espelho com produto (meta ${fmtP(c.meta_cadastro_pct)}): ${fmtN(cad.esp_ligadas)} de ${fmtN(cad.esp_linhas)} linhas.`, `${fmtN(cad.nao_acabados)} materiais cadastrados; ${fmtN(cad.sem_familia)} produto(s) sem família.`] };
  const pctDepara = ent.total ? 100 - (semProdEnt.valor / ent.total) * 100 : null;
  r.depara = !ent.total ? { s: 'pendente', pct: 0, txt: ['Sem notas de entrada no período.'] }
    : { s: pctDepara >= c.meta_entrada_pct ? 'feito' : n0(S.depara?.qtd) ? 'andamento' : 'pendente', pct: Math.min(100, pctDepara / c.meta_entrada_pct * 100),
      txt: [`${fmtN(S.depara?.qtd)} itens de fornecedor ligados; ${fmtN(semProdEnt.itens)} itens de nota de entrada ainda sem produto (${fmtR(semProdEnt.valor)}).`] };
  r.cfop = { s: semRegra.length ? (ent.total || sai.total ? 'andamento' : 'pendente') : (ent.total || sai.total ? 'feito' : 'pendente'), pct: semRegra.length ? 50 : 100,
    txt: [semRegra.length ? `${semRegra.length} CFOP(s) sem regra: ${semRegra.slice(0, 6).map(x => x.cfop).join(', ')}${semRegra.length > 6 ? '…' : ''}.` : 'Todos os CFOPs das notas têm regra.'] };
  r.vendas = !sai.total ? { s: 'pendente', pct: 0, txt: ['Sem notas de venda no período.'] }
    : { s: sai.pct >= c.meta_saida_pct ? 'feito' : 'andamento', pct: Math.min(100, sai.pct / c.meta_saida_pct * 100),
      txt: [`${fmtP(sai.pct)} do valor das saídas pronto para movimentar (meta ${fmtP(c.meta_saida_pct)}).`, ...['sem_produto', 'sem_regra', 'sem_local'].filter(k => sai.por[k]).map(k => `${fmtN(sai.por[k].itens)} item(ns) ${ROT[k]}.`)] };
  const prontos = ['espelho', 'cadastro', 'depara', 'cfop'].every(k => r[k].s === 'feito' || E[k]?.dispensada);
  r.saldo = sal.implantado_em ? { s: 'feito', pct: 100, txt: [`Implantado; notas movimentam a partir de ${br(sal.implantado_em)}. ${fmtN(sal.movimentos)} movimentos; estoque de ${fmtR(sal.valor)}.`] }
    : { s: prontos ? 'pendente' : 'bloqueado', pct: 0, txt: [prontos ? 'Tudo pronto para implantar o saldo inicial.' : 'Aguarda o espelho, o cadastro, o de-para e as regras.'] };
  r.automatico = !sal.implantado_em ? { s: 'bloqueado', pct: 0, txt: ['Liga junto com a implantação do saldo.'] }
    : { s: aut.ligado && !n0(aut.pendencias) ? 'feito' : 'andamento', pct: aut.ligado ? (n0(aut.pendencias) ? 70 : 100) : 30,
      txt: [`Automático ${aut.ligado ? 'ligado' : 'DESLIGADO'}; ${fmtN(aut.pendencias)} pendência(s) aberta(s).`] };
  r.fechamento = !sal.implantado_em ? { s: 'bloqueado', pct: 0, txt: ['Depois da implantação.'] }
    : { s: n0(fec.qtd) ? 'feito' : 'pendente', pct: n0(fec.qtd) ? 100 : 0, txt: [n0(fec.qtd) ? `${fmtN(fec.qtd)} mês(es) fechado(s); último ${br(fec.ultimo).slice(3)}.` : 'Nenhum mês fechado.'] };
  const lista = ETAPAS.map(e => {
    const x = r[e.k], et = E[e.k] || {};
    const s = et.dispensada ? 'dispensado' : x.s;
    const atrasada = !['feito', 'dispensado'].includes(s) && et.prevista && et.prevista < hoje;
    return { ...e, s, pct: s === 'dispensado' ? 100 : Math.round(x.pct || 0), txt: x.txt, responsavel: et.responsavel || null, prevista: et.prevista || null, observacao: et.observacao || null, atrasada };
  });
  const validas = lista.filter(l => l.s !== 'dispensado');
  const geral = validas.length ? Math.round(validas.reduce((t, l) => t + l.pct, 0) / validas.length) : 100;
  const proxima = lista.find(l => !['feito', 'dispensado', 'bloqueado'].includes(l.s)) || null;
  return { etapas: lista, geral, proxima, ent, sai, semRegra, concluida: validas.every(l => l.s === 'feito') };
}
const ROT = { sem_produto: 'sem produto', sem_regra: 'sem regra de CFOP', sem_local: 'sem local' };
function br(d) { return d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—'; }
