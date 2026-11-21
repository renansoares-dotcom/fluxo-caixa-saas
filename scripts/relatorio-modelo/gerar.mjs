// FASE 0 do padrão de relatórios: gera os dois modelos em PDF (dados fictícios) para aprovação do leiaute.
// Uso: PLAYWRIGHT=/caminho/index.mjs node scripts/relatorio-modelo/gerar.mjs <pasta de saída>
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { htmlPadrao, numero, dataBR, esc } from '../../js/lib/relatorio-padrao.js';

const SAIDA = process.argv[2] || '/tmp/relatorio-modelo';
const EMPRESA = { nome: 'IPLAMM – INDÚSTRIA DE PLÁSTICOS LTDA.', cnpj: '14.677.338/0001-97' };
const QUANDO = new Date(2026, 10, 21, 12, 10), USUARIO = 'Renata Alves';
const AVISO = 'Modelo de leiaute – dados fictícios.';
const r2 = (v) => Math.round(v * 100) / 100, r4 = (v) => Math.round(v * 1e4) / 1e4;
let semente = 20261121; const rnd = () => (semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648;

// ------------------------------------------------------------------ 1. Kardex por produto (analítico, paisagem)
function kardex() {
  const prods = [
    ['100231', 'RESINA PEBD GRANULADA NATURAL', 'KG', '01', 18450, 7.82, 'Almoxarifado de matéria-prima'],
    ['100236', 'RESINA PEAD SOPRO NATURAL', 'KG', '01', 9200, 8.14, 'Almoxarifado de matéria-prima'],
    ['100410', 'MASTERBATCH BRANCO 70%', 'KG', '01', 1250, 21.4, 'Almoxarifado de matéria-prima'],
    ['200118', 'BOBINA PEBD CANELA 40 CM X 0,10', 'KG', '04', 6310, 11.96, 'Expedição'],
    ['200342', 'SACO PEBD 60 X 90 X 0,12 TRANSPARENTE', 'KG', '04', 4120, 12.35, 'Expedição'],
    ['300027', 'APARA DE PEBD LIMPA', 'KG', '06', 2380, 2.1, 'Recuperadora'],
  ];
  const grupos = []; let nMov = 0; const T = { ent: 0, sai: 0, vEnt: 0, vSai: 0, ini: 0, fim: 0 };
  for (const [cod, desc, un, sped, q0, c0, local] of prods) {
    let q = q0, cm = c0, val = r2(q0 * c0); const mp = sped === '01', ap = sped === '06'; const linhas = []; let ent = 0, sai = 0, vEnt = 0, vSai = 0;
    const dias = [...new Set(Array.from({ length: mp ? 13 : 11 }, () => 1 + Math.floor(rnd() * 30)))].sort((a, b) => a - b);
    for (const d of dias) {
      const data = `2026-10-${String(d).padStart(2, '0')}`; const entrada = rnd() < (mp ? 0.3 : ap ? 0.6 : 0.55);
      let mov, doc, lote = '', qt, cu;
      if (entrada) {
        qt = Math.round((mp ? 6000 + rnd() * 12000 : 400 + rnd() * 1800) / 25) * 25;
        cu = mp ? r4(c0 * (0.97 + rnd() * 0.08)) : r4(cm * (0.98 + rnd() * 0.04));
        mov = mp ? 'Compra' : ap ? 'Apara da produção' : 'Produção'; doc = mp ? `NF ${48000 + Math.floor(rnd() * 900)}` : `OP ${2600 + Math.floor(rnd() * 90)}`;
        lote = mp ? `L${2610 + Math.floor(rnd() * 80)}` : '';
        const v = r2(qt * cu); val = r2(val + v); q += qt; cm = val / q; ent += qt; vEnt += v;
        linhas.push([dataBR(data), mov, esc(local), lote, doc, numero(qt, 3), '', numero(q, 3), numero(cu, 4), numero(v), numero(cm, 4)]);
      } else {
        qt = Math.min(q, Math.round((mp ? 1500 + rnd() * 4500 : 300 + rnd() * 1500) / 25) * 25); if (!qt) continue;
        mov = mp ? 'Requisição para produção' : ap ? 'Consumo na recuperadora' : 'Venda'; doc = mp || ap ? `OP ${2600 + Math.floor(rnd() * 90)}` : `NF ${15200 + Math.floor(rnd() * 400)}`;
        const v = qt === q ? val : r2(qt * cm); val = r2(val - v); q -= qt; sai += qt; vSai += v;
        linhas.push([dataBR(data), mov, esc(local), lote, doc, '', numero(qt, 3), numero(q, 3), numero(cm, 4), numero(-v), numero(cm, 4)]);
      }
    }
    nMov += linhas.length; T.ent += ent; T.sai += sai; T.vEnt += vEnt; T.vSai += vSai; T.ini += r2(q0 * c0); T.fim += val;
    grupos.push({ titulo: `${cod} – ${esc(desc)} · Unidade ${un} · Tipo do item ${sped}`,
      anterior: [{ v: 'Saldo anterior em 30/09/2026', span: 7 }, numero(q0, 3), '', numero(r2(q0 * c0)), numero(c0, 4)],
      linhas, subtotal: [{ v: `Total do produto · ${linhas.length} movimento(s)`, span: 5 }, numero(ent, 3), numero(sai, 3), numero(q, 3), '', numero(val), numero(cm, 4)] });
  }
  return { arquivo: 'Modelo_Kardex_por_produto', codigo: 'EST002-R01', nome: 'Kardex por produto', titulo: 'Kardex por produto', subtitulo: 'Movimentos de 01/10/2026 a 31/10/2026, com saldo e custo médio após cada movimento',
    paisagem: true, empresa: EMPRESA, emissao: { numero: 127, quando: QUANDO, usuario: USUARIO }, fonte: `Fonte: Estoque › Kardex. Custo médio ponderado móvel. ${AVISO}`, registros: nMov,
    parametros: [['Período', '01/10/2026 a 31/10/2026'], ['Local', ''], ['Produto', '100231 a 300027'], ['Tipo do item (SPED)', ''], ['Tipo de movimento', ''], ['Lote', ''],
      ['Estornos', 'Incluídos'], ['Produtos sem movimento', 'Não listados'], ['Nível', 'Analítico'], ['Agrupamento', 'Produto'], ['Ordenação', 'Código do produto; data'], ['Variante', 'Kardex mensal – todos os locais']],
    resumo: [['Produtos', String(prods.length)], ['Movimentos', numero(nMov, 0)], ['Entradas (kg)', numero(T.ent, 3)], ['Saídas (kg)', numero(T.sai, 3)], ['Valor inicial (R$)', numero(T.ini)], ['Entradas (R$)', numero(T.vEnt)], ['Saídas (R$)', numero(T.vSai)], ['Valor final (R$)', numero(T.fim)]],
    secoes: [{ titulo: 'Movimentos por produto', tabela: { grupos,
      colunas: [{ t: 'Data', w: '6.5%' }, { t: 'Movimento', w: '15%' }, { t: 'Local', w: '17%' }, { t: 'Lote', w: '5.5%' }, { t: 'Documento', w: '7.5%' }, { t: 'Entrada', n: 1, w: '8%' }, { t: 'Saída', n: 1, w: '8%' },
        { t: 'Saldo', n: 1, w: '8.5%' }, { t: 'Custo unit.', n: 1, w: '7%' }, { t: 'Valor (R$)', n: 1, w: '9.5%' }, { t: 'Custo médio', n: 1, w: '7.5%' }],
      total: [{ v: 'Total geral', span: 5 }, numero(T.ent, 3), numero(T.sai, 3), '', '', numero(T.fim), ''],
      nota: 'Quantidades em kg. Saída valorizada ao custo médio do momento (valor negativo). No total geral, o valor é o do estoque no fim do período.' } }],
    _conf: { T } };
}

// ------------------------------------------------------------------ 2. Apuração de impostos (com indicadores, retrato)
function apuracao() {
  const linha = (cfop, desc, notas, vc, pBase, aIcms, aIpi, pc = true) => { const bc = r2(vc * pBase), ipi = r2(vc * aIpi / (1 + aIpi)); const basePC = vc - ipi;
    return { cfop, desc, notas, vc, bc, icms: r2(bc * aIcms), ipi, pis: pc ? r2(basePC * 0.0165) : 0, cofins: pc ? r2(basePC * 0.076) : 0 }; };
  const S = [linha('5.101', 'Venda de produção do estabelecimento (estadual)', 212, 1184320.4, 0.97, 0.205, 0.0325), linha('6.101', 'Venda de produção do estabelecimento (interestadual)', 148, 932615.75, 0.97, 0.12, 0.0325),
    linha('6.107', 'Venda de produção a não contribuinte (interestadual)', 9, 41870.2, 0.97, 0.12, 0.0325), linha('5.124', 'Industrialização efetuada para outra empresa (estadual)', 14, 96440, 1, 0.205, 0),
    linha('5.901', 'Remessa para industrialização por encomenda (estadual)', 6, 58210.3, 0, 0, 0, false), linha('5.910', 'Remessa em bonificação, doação ou brinde (estadual)', 3, 4318.6, 1, 0.205, 0.0325, false),
    linha('6.949', 'Outra saída não especificada (interestadual)', 4, 12760, 0, 0, 0, false)];
  const E = [linha('1.101', 'Compra para industrialização (estadual)', 37, 402118.9, 1, 0.205, 0.0325, false), linha('2.101', 'Compra para industrialização (interestadual)', 58, 871344.25, 1, 0.07, 0.0325, false),
    linha('3.101', 'Compra para industrialização (exterior)', 2, 318650, 1, 0.205, 0.0325, false), linha('1.201', 'Devolução de venda de produção (estadual)', 5, 21430.8, 0.97, 0.205, 0.0325),
    linha('2.201', 'Devolução de venda de produção (interestadual)', 3, 17905.4, 0.97, 0.12, 0.0325), linha('1.556', 'Compra de material para uso ou consumo (estadual)', 41, 36218.15, 0, 0, 0, false),
    linha('1.902', 'Retorno de mercadoria remetida para industrialização (estadual)', 6, 58210.3, 0, 0, 0, false)];
  const K = ['vc', 'bc', 'icms', 'ipi', 'pis', 'cofins'];
  const soma = (L) => Object.fromEntries([['notas', L.reduce((a, x) => a + x.notas, 0)], ...K.map(k => [k, r2(L.reduce((a, x) => a + x[k], 0))])]);
  const porCfop = (a, b) => a.cfop.localeCompare(b.cfop); S.sort(porCfop); E.sort(porCfop);
  const tab = (L) => { const t = soma(L); return { colunas: [{ t: 'CFOP', w: '6.5%' }, { t: 'Descrição', w: '28%' }, { t: 'Notas', n: 1, w: '5.5%' }, { t: 'Valor contábil', n: 1, w: '11.5%' }, { t: 'Base do ICMS', n: 1, w: '11.5%' }, { t: 'ICMS', n: 1, w: '10%' }, { t: 'IPI', n: 1, w: '9%' }, { t: 'PIS', n: 1, w: '8.5%' }, { t: 'COFINS', n: 1, w: '9.5%' }],
    linhas: L.map(x => [x.cfop, esc(x.desc), numero(x.notas, 0), ...K.map(k => numero(x[k]))]), total: [{ v: 'Total', span: 2 }, numero(t.notas, 0), ...K.map(k => numero(t[k]))] }; };
  const tS = soma(S), dev = soma(E.filter(x => x.cfop.endsWith('.201'))), comp = soma(E.filter(x => !x.cfop.endsWith('.201')));
  const sIcms = r2(tS.icms - dev.icms - comp.icms), sIpi = r2(tS.ipi - dev.ipi - comp.ipi), sPC = r2(tS.pis + tS.cofins - dev.pis - dev.cofins);
  return { arquivo: 'Modelo_Apuracao_de_impostos', codigo: 'FIS002-R01', nome: 'Apuração de impostos – livro por CFOP', titulo: 'Apuração de impostos', subtitulo: 'Livro por CFOP e impostos destacados nas notas – outubro de 2026',
    paisagem: false, empresa: EMPRESA, emissao: { numero: 128, quando: QUANDO, usuario: USUARIO }, fonte: `Fonte: Fiscal › Apuração de Impostos (itens das notas importadas). ${AVISO}`, registros: S.length + E.length,
    parametros: [['Mês de referência', '10/2026'], ['Regime no mês', 'Lucro Real'], ['Operações', 'Saídas e entradas'], ['Situação das notas', 'Autorizadas'], ['CFOP', ''], ['CST', ''],
      ['Agrupamento', 'CFOP'], ['Nível', 'Sintético'], ['Ordenação', 'CFOP'], ['Variante', 'Nenhuma (filtros avulsos)']],
    resumo: [['Notas de saída', numero(tS.notas, 0)], ['Valor contábil das saídas (R$)', numero(tS.vc)], ['ICMS (R$)', numero(tS.icms)], ['IPI (R$)', numero(tS.ipi)], ['PIS (R$)', numero(tS.pis)], ['COFINS (R$)', numero(tS.cofins)]],
    secoes: [{ titulo: 'Saídas – notas emitidas', tabela: tab(S) },
      { titulo: 'Entradas – compras e devoluções', tabela: { ...tab(E), nota: 'Nas notas de fornecedores, o CFOP é o da entrada na empresa. PIS e COFINS de crédito não vêm do destaque do fornecedor: são calculados pelas regras da empresa.' } },
      { titulo: 'Impostos destacados nas notas', tabela: { colunas: [{ t: 'Linha', w: '52%' }, { t: 'ICMS', n: 1, w: '16%' }, { t: 'IPI', n: 1, w: '16%' }, { t: 'PIS e COFINS', n: 1, w: '16%' }],
        linhas: [['Débitos – saídas (notas emitidas)', numero(tS.icms), numero(tS.ipi), numero(r2(tS.pis + tS.cofins))], ['(-) Devoluções de clientes', numero(-dev.icms), numero(-dev.ipi), numero(-r2(dev.pis + dev.cofins))],
          ['(-) Créditos destacados nas compras', numero(-comp.icms), numero(-comp.ipi), '']],
        total: ['Saldo antes das regras da empresa', numero(sIcms), numero(sIpi), numero(sPC)],
        nota: 'Prévia: soma do que está destacado nas notas autorizadas. Não é o imposto a recolher. Notas canceladas fora da apuração: 2 (R$ 13.480,00).' } }] };
}

const pwm = await import(process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : 'playwright'); const { chromium } = pwm.default?.chromium ? pwm.default : pwm;
mkdirSync(SAIDA, { recursive: true });
const b = await chromium.launch(), p = await b.newPage();
for (const s of [kardex(), apuracao()]) {
  const html = htmlPadrao(s); writeFileSync(join(SAIDA, s.arquivo + '.html'), html);
  await p.setContent(html, { waitUntil: 'load' });
  writeFileSync(join(SAIDA, s.arquivo + '.pdf'), await p.pdf({ preferCSSPageSize: true, printBackground: true }));
  console.log(join(SAIDA, s.arquivo + '.pdf'));
}
await b.close();
