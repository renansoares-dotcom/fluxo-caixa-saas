// Controle de Cheques — regras puras (sem banco nem tela): leitura do CMC-7, prazos de apresentação e prescrição,
// alíneas de devolução, alertas, histórico do emitente, agenda de compensação e valor por extenso.

const dig = (s) => String(s ?? '').replace(/\D/g, '');
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const addMeses = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'), dia = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
  const fim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(dia, fim)); return d.toISOString().slice(0, 10); };
export const diasEntre = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);

/** dígito do módulo 10 usado no CMC-7 (pesos 2 e 1 a partir da direita; produto de dois dígitos soma os dígitos) */
export function mod10(num) {
  let s = 0, p = 2;
  for (let i = num.length - 1; i >= 0; i--) { const v = +num[i] * p; s += v > 9 ? v - 9 : v; p = p === 2 ? 1 : 2; }
  return (10 - (s % 10)) % 10;
}

/**
 * Lê a linha CMC-7 do rodapé do cheque (30 dígitos, com ou sem os símbolos da leitora):
 *   campo 1 (8): banco 3 · agência 4 · DV2      campo 2 (10): compensação 3 · nº do cheque 6 · tipificação 1
 *   campo 3 (12): DV1 · conta 10 · DV3
 * DV1 confere banco+agência; DV2 confere o campo 2; DV3 confere a conta.
 */
export function lerCMC7(txt) {
  const d = dig(txt);
  if (d.length !== 30) return null;
  const banco = d.slice(0, 3), agencia = d.slice(3, 7), dv2 = +d[7], comp = d.slice(8, 11), numero = d.slice(11, 17), tipo = d[17], dv1 = +d[18], conta = d.slice(19, 29), dv3 = +d[29];
  const valido = mod10(banco + agencia) === dv1 && mod10(comp + numero + tipo) === dv2 && mod10(conta) === dv3;
  return { banco, agencia, conta: conta.replace(/^0+(?=\d)/, ''), numero, comp, cmc7: d, valido };
}

/** alíneas de devolução mais comuns (motivos do Banco Central) e se o cheque ainda pode ser reapresentado */
export const ALINEAS = [
  ['11', 'Sem fundos — 1ª apresentação', true],
  ['12', 'Sem fundos — 2ª apresentação', false],
  ['13', 'Conta encerrada', false],
  ['14', 'Prática espúria', false],
  ['20', 'Folha cancelada por solicitação do correntista', false],
  ['21', 'Sustado ou revogado (contraordem)', false],
  ['22', 'Divergência ou insuficiência de assinatura', false],
  ['24', 'Bloqueio judicial ou determinação do Banco Central', true],
  ['25', 'Cancelamento do talonário pelo banco', false],
  ['28', 'Sustado por furto ou roubo', false],
  ['30', 'Furto ou roubo de malote', false],
  ['31', 'Erro formal (data, mês grafado, valor por extenso)', false],
  ['33', 'Divergência de endosso', true],
  ['35', 'Cheque fraudado ou emitido sem controle do banco', false],
  ['44', 'Cheque prescrito', false],
  ['48', 'Cheque acima do limite sem identificação do beneficiário', true],
  ['49', 'Remessa nula — cheque já devolvido', false],
  ['70', 'Sustação provisória', true],
];
export const alineaTexto = (a) => { const x = ALINEAS.find(y => y[0] === String(a ?? '').trim()); return x ? `${x[0]} — ${x[1]}` : (a ? String(a) : ''); };
export const alineaReapresenta = (a) => { const x = ALINEAS.find(y => y[0] === String(a ?? '').trim()); return x ? x[2] : true; };

export const SITUACOES = {
  carteira: ['Em carteira', 'info'], depositado: ['Depositado', 'warn'], compensado: ['Compensado', 'pos'], devolvido: ['Devolvido', 'neg'],
  fidc: ['No FIDC', 'info'], repassado: ['Repassado', 'info'], resgatado: ['Resgatado', 'pos'], cobranca: ['Em cobrança', 'warn'],
  perda: ['Perda', 'neg'], cancelado: ['Cancelado', 'muted'],
  emitido: ['A compensar', 'warn'], sustado: ['Sustado', 'muted'],
};
export const rotuloSituacao = (s) => (SITUACOES[s] || [s || '', 'muted'])[0];
export const tomSituacao = (s) => (SITUACOES[s] || ['', 'muted'])[1];

/**
 * Prazos do cheque (controle gerencial): a apresentação conta da data do cheque (o "bom para" quando é pré-datado),
 * 30 dias na mesma praça ou 60 em outra; a execução prescreve N meses depois de vencido o prazo de apresentação.
 */
export function prazos(ch, cfg = {}) {
  const base = ch.bom_para || ch.emissao || ch.recebido_em;
  if (!base) return null;
  const apresentar = addDias(base, +(ch.praca_outra ? (cfg.prazo_fora ?? 60) : (cfg.prazo_praca ?? 30)));
  return { base, apresentar, prescreve: addMeses(apresentar, +(cfg.prescricao_meses ?? 6)) };
}

/** o que fazer com o cheque hoje: { k, texto, tom } */
export function proximoPasso(ch, cfg, hoje) {
  const p = prazos(ch, cfg);
  if (ch.situacao === 'carteira') {
    if (ch.bom_para > hoje) return { k: 'aguardar', texto: `bom para em ${diasEntre(hoje, ch.bom_para)} dia(s)`, tom: 'muted' };
    if (p && hoje > p.apresentar) return { k: 'vencido', texto: 'prazo de apresentação vencido', tom: 'neg' };
    if (p && diasEntre(hoje, p.apresentar) <= 5) return { k: 'urgente', texto: `depositar: prazo acaba em ${diasEntre(hoje, p.apresentar)} dia(s)`, tom: 'neg' };
    return { k: 'depositar', texto: 'pronto para depositar', tom: 'pos' };
  }
  if (ch.situacao === 'devolvido') {
    const pode = +ch.devolucoes <= +(cfg?.max_reapresentacoes ?? 1) && alineaReapresenta(ch.alinea);
    if (p && hoje > p.prescreve) return { k: 'prescrito', texto: 'prescrito para execução', tom: 'neg' };
    return pode ? { k: 'reapresentar', texto: 'pode reapresentar', tom: 'warn' } : { k: 'cobrar', texto: 'cobrar o cliente', tom: 'neg' };
  }
  return { k: '', texto: '', tom: 'muted' };
}

const chave = (ch) => dig(ch.emitente_doc) || (ch.favorecido_id ? 'f:' + ch.favorecido_id : 'e:' + String(ch.emitente || '').trim().toUpperCase());

/** histórico por emitente (CPF/CNPJ do cheque; sem ele, o cliente): quantidade, valor, devoluções e o que está em risco */
export function historicoEmitentes(cheques) {
  const m = new Map();
  for (const ch of cheques) {
    if (ch.situacao === 'cancelado') continue;
    const k = chave(ch); if (!k || k === 'e:') continue;
    const h = m.get(k) || m.set(k, { chave: k, doc: dig(ch.emitente_doc), emitente: ch.emitente || '', favorecido_id: ch.favorecido_id || null, qtd: 0, valor: 0, devolvidos: 0, valorDevolvido: 0, aberto: 0, perdas: 0 }).get(k);
    h.qtd++; h.valor += +ch.valor; if (!h.emitente && ch.emitente) h.emitente = ch.emitente;
    if (+ch.devolucoes > 0) { h.devolvidos++; h.valorDevolvido += +ch.valor; }
    if (['carteira', 'depositado', 'devolvido', 'fidc', 'repassado', 'cobranca'].includes(ch.situacao)) h.aberto += +ch.valor;
    if (ch.situacao === 'perda') h.perdas += +ch.valor;
  }
  return [...m.values()].map(h => ({ ...h, taxa: h.qtd ? h.devolvidos / h.qtd : 0 })).sort((a, b) => b.valorDevolvido - a.valorDevolvido || b.aberto - a.aberto);
}
/** devoluções anteriores do emitente de um cheque (para o aviso ao receber) */
export function riscoEmitente(cheques, novo) {
  const k = chave(novo); if (!k || k === 'e:') return null;
  return historicoEmitentes(cheques.filter(c => chave(c) === k))[0] || null;
}

/** alertas da tela e da Central de Decisões */
export function alertas({ cheques = [], emitidos = [], cfg = {}, hoje, saldos = null }) {
  const a = [], soma = (L) => L.reduce((s, x) => s + +x.valor, 0);
  const cart = cheques.filter(c => c.situacao === 'carteira');
  const prontos = cart.filter(c => c.bom_para <= hoje), urg = prontos.filter(c => ['urgente', 'vencido'].includes(proximoPasso(c, cfg, hoje).k));
  if (urg.length) a.push({ k: 'prazo', nivel: 'alto', titulo: `${urg.length} cheque(s) com o prazo de apresentação vencido ou acabando`, valor: soma(urg), detalhe: urg.slice(0, 4).map(c => `nº ${c.numero}`).join(' · ') });
  if (prontos.length > urg.length) a.push({ k: 'depositar', nivel: 'medio', titulo: `${prontos.length - urg.length} cheque(s) em carteira prontos para depositar`, valor: soma(prontos) - soma(urg), detalhe: 'Já passaram da data "bom para".' });
  const dev = cheques.filter(c => c.situacao === 'devolvido');
  if (dev.length) a.push({ k: 'devolvidos', nivel: 'alto', titulo: `${dev.length} cheque(s) devolvido(s) aguardando reapresentação, resgate ou cobrança`, valor: soma(dev), detalhe: dev.slice(0, 4).map(c => `nº ${c.numero} (${c.alinea || 's/ alínea'})`).join(' · ') });
  const fidcVenc = cheques.filter(c => c.situacao === 'fidc' && addDias(c.bom_para, 5) < hoje);
  if (fidcVenc.length) a.push({ k: 'fidc', nivel: 'baixo', titulo: `${fidcVenc.length} cheque(s) no FIDC com a data já passada sem baixa`, valor: soma(fidcVenc), detalhe: 'Marque como compensado ou devolvido conforme o retorno do fundo.' });
  const dep = cheques.filter(c => c.situacao === 'depositado' && c.bom_para && addDias(c.bom_para, 0) <= addDias(hoje, -5));
  if (dep.length) a.push({ k: 'compensar', nivel: 'baixo', titulo: `${dep.length} cheque(s) depositado(s) há mais de 5 dias sem confirmar a compensação`, valor: soma(dep), detalhe: 'Confira o extrato e marque como compensado ou devolvido.' });
  const em = emitidos.filter(e => e.situacao === 'emitido' && +e.valor > 0), em7 = em.filter(e => e.bom_para <= addDias(hoje, 7));
  if (em7.length) {
    const porConta = {}; for (const e of em7) porConta[e.conta_id] = (porConta[e.conta_id] || 0) + +e.valor;
    const falta = saldos ? Object.entries(porConta).filter(([c, v]) => saldos[c] != null && saldos[c] < v) : [];
    a.push({ k: 'proprios', nivel: falta.length ? 'alto' : 'medio', titulo: falta.length ? `Saldo insuficiente para ${falta.length} conta(s) com cheques próprios a compensar em 7 dias` : `${em7.length} cheque(s) próprio(s) a compensar nos próximos 7 dias`,
      valor: soma(em7), detalhe: em7.slice(0, 4).map(e => `nº ${e.numero}`).join(' · '), contas: falta.map(([c]) => c) });
  }
  const devEm = emitidos.filter(e => e.situacao === 'devolvido');
  if (devEm.length) a.push({ k: 'proprio-devolvido', nivel: 'alto', titulo: `${devEm.length} cheque(s) próprio(s) devolvido(s)`, valor: soma(devEm), detalhe: 'Regularize com o favorecido: o título continua baixado até cancelar ou compensar o cheque.' });
  return a;
}

/** agenda de compensação: por dia, o que entra (terceiros em carteira/depositados/devolvidos reapresentáveis) e o que sai (próprios) */
export function agenda({ cheques = [], emitidos = [], hoje, dias = 30 }) {
  const fim = addDias(hoje, dias), m = new Map();
  const dia = (d) => m.get(d) || m.set(d, { data: d, entra: 0, sai: 0, itens: [] }).get(d);
  for (const c of cheques) {
    if (!['carteira', 'depositado'].includes(c.situacao)) continue;
    const d = c.bom_para < hoje ? hoje : c.bom_para; if (d > fim) continue;
    const x = dia(d); x.entra += +c.valor; x.itens.push({ tipo: 'entra', numero: c.numero, valor: +c.valor, situacao: c.situacao, atrasado: c.bom_para < hoje });
  }
  for (const e of emitidos) {
    if (e.situacao !== 'emitido' || !+e.valor) continue;
    const d = e.bom_para < hoje ? hoje : e.bom_para; if (d > fim) continue;
    const x = dia(d); x.sai += +e.valor; x.itens.push({ tipo: 'sai', numero: String(e.numero), valor: +e.valor, conta_id: e.conta_id, atrasado: e.bom_para < hoje });
  }
  let ac = 0;
  return [...m.values()].sort((a, b) => a.data.localeCompare(b.data)).map(x => ({ ...x, liquido: x.entra - x.sai, acumulado: (ac += x.entra - x.sai) }));
}

/** folhas do talão: livres, usadas e a próxima */
export function folhasTalao(talao, emitidos) {
  const usados = new Set(emitidos.filter(e => e.conta_id === talao.conta_id && e.numero >= talao.numero_ini && e.numero <= talao.numero_fim).map(e => e.numero));
  const total = talao.numero_fim - talao.numero_ini + 1; let proxima = null;
  for (let n = talao.numero_ini; n <= talao.numero_fim; n++) if (!usados.has(n)) { proxima = n; break; }
  return { total, usadas: usados.size, livres: total - usados.size, proxima };
}

// ---------- valor por extenso (cópia de cheque) ----------
const U = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const D = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const C = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
function ate999(n) {
  if (n === 100) return 'cem';
  const p = [], c = Math.floor(n / 100), r = n % 100;
  if (c) p.push(C[c]);
  if (r < 20) { if (r) p.push(U[r]); } else { const d = Math.floor(r / 10), u = r % 10; p.push(D[d] + (u ? ' e ' + U[u] : '')); }
  return p.join(' e ');
}
function inteiroExtenso(n) {
  if (n === 0) return 'zero';
  const grupos = [[1e9, 'bilhão', 'bilhões'], [1e6, 'milhão', 'milhões'], [1e3, 'mil', 'mil'], [1, '', '']], partes = [];
  let resto = n, ultQ = 0;
  for (const [v, sing, plur] of grupos) {
    const q = Math.floor(resto / v); resto %= v; if (!q) continue;
    partes.push(v === 1e3 && q === 1 ? 'mil' : `${ate999(q)}${sing ? ' ' + (q === 1 ? sing : plur) : ''}`); ultQ = q;
  }
  if (partes.length === 1) return partes[0];
  // "e" antes do último grupo quando ele é menor que 100 ou centena redonda (mil e cem, dois mil e quinze); senão vírgula
  const liga = ultQ < 100 || ultQ % 100 === 0 ? ' e ' : ', ';
  return partes.slice(0, -1).join(', ') + liga + partes[partes.length - 1];
}
export function valorPorExtenso(valor) {
  const cent = Math.round(+valor * 100), r = Math.floor(cent / 100), c = cent % 100;
  if (!(cent > 0)) return 'zero real';
  const pr = r ? `${inteiroExtenso(r)}${r >= 1e6 && r % 1e6 === 0 ? ' de' : ''} ${r === 1 ? 'real' : 'reais'}` : '';
  const pc = c ? `${inteiroExtenso(c)} ${c === 1 ? 'centavo' : 'centavos'}` : '';
  return [pr, pc].filter(Boolean).join(' e ');
}

/** confere os cheques digitados no recebimento antes de gravar: lista de problemas (texto) */
export function validarRecebimento(cheques, { titulos = 0, existentes = [] } = {}) {
  const p = [], vistos = new Set();
  if (!cheques.length) p.push('Informe ao menos um cheque.');
  cheques.forEach((c, i) => {
    const n = i + 1, id = [dig(c.banco), dig(c.agencia), dig(c.conta), String(c.numero || '').trim()].join('|');
    if (!String(c.banco || '').trim() || !String(c.numero || '').trim()) p.push(`Cheque ${n}: informe o banco e o número.`);
    if (!(+c.valor > 0)) p.push(`Cheque ${n}: informe o valor.`);
    if (!c.bom_para) p.push(`Cheque ${n}: informe a data "bom para".`);
    if (vistos.has(id)) p.push(`Cheque ${n}: repetido nesta lista.`); vistos.add(id);
    if (existentes.some(e => e.situacao !== 'cancelado' && [dig(e.banco), dig(e.agencia), dig(e.conta), String(e.numero).trim()].join('|') === id)) p.push(`Cheque ${n}: já está cadastrado.`);
  });
  const tot = cheques.reduce((s, c) => s + (+c.valor || 0), 0);
  if (titulos - tot > 0.05) p.push('Os cheques somam menos que os títulos escolhidos.');
  return p;
}
