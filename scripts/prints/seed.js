// Dados FICTÍCIOS para os prints dos manuais. Empresa, pessoas, valores e documentos são inventados.
const DB = window.DB = window.DB || {};
let n = 0; const id = (p) => `${p}-${String(++n).padStart(4, '0')}`;
const E = 'emp1', HOJE = '2026-10-29';
let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;   // sempre os mesmos números
const pick = (a) => a[Math.floor(rnd() * a.length)];
const dia = (base, d) => { const x = new Date(base + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
DB.empresas = [{ id: E, nome: 'PLÁSTICOS EXEMPLO', razao_social: 'PLÁSTICOS EXEMPLO INDÚSTRIA LTDA', cnpj: '11222333000181', ie: '123456789', logradouro: 'RUA DAS INDÚSTRIAS, 100', municipio: 'CARUARU', uf: 'PE', cep: '55000000', ano_inicio: 2026, mes_inicio_fiscal: 1, mfa_obrigatorio: false }];
DB.membros = [['u1', 'admin', 'Renata Alves'], ['u2', 'financeiro', 'Ana Souza'], ['u3', 'diretor', 'Carlos Lima'], ['u4', 'compras', 'Beatriz Rocha'], ['u5', 'leitura', 'Diego Martins']]
  .map(([u, p, nome]) => ({ empresa_id: E, user_id: u, papel: p, nome, areas: null, created_at: '2026-01-05T10:00:00Z' }));
const PLANO = [
  ['1.01', 'RECEITAS OPERACIONAIS', 'E', 'C', 'receita_bruta', [['1.01.01', 'VENDAS DE PRODUTOS'], ['1.01.02', 'VENDAS DE SERVIÇOS']]],
  ['1.02', 'RECEITAS FINANCEIRAS', 'E', 'C', 'receitas_financeiras', [['1.02.01', 'RENDIMENTOS DE APLICAÇÃO']]],
  ['2.01', 'CUSTOS DIRETOS', 'S', 'D', 'custos_diretos', [['2.01.01', 'MATÉRIA-PRIMA (RESINA)'], ['2.01.02', 'EMBALAGENS E INSUMOS'], ['2.01.03', 'ENERGIA ELÉTRICA']]],
  ['2.02', 'PESSOAL', 'S', 'D', 'despesas_operacionais', [['2.02.01', 'SALÁRIOS'], ['2.02.02', 'ENCARGOS SOCIAIS']]],
  ['2.03', 'DESPESAS ADMINISTRATIVAS', 'S', 'D', 'despesas_operacionais', [['2.03.01', 'ALUGUEL'], ['2.03.02', 'SISTEMAS E INTERNET'], ['2.03.03', 'MANUTENÇÃO']]],
  ['2.04', 'DESPESAS FINANCEIRAS', 'S', 'D', 'despesas_financeiras', [['2.04.01', 'TARIFAS BANCÁRIAS'], ['2.04.02', 'JUROS E DESÁGIO']]],
  ['2.05', 'TRIBUTOS', 'S', 'D', 'tributos', [['2.05.01', 'ICMS'], ['2.05.02', 'PIS/COFINS']]],
  ['2.06', 'LOGÍSTICA', 'S', 'D', 'despesas_operacionais', [['2.06.01', 'FRETES DE TERCEIROS'], ['2.06.02', 'COMBUSTÍVEL']]],
  ['3.01', 'TRANSFERÊNCIAS', 'T', 'D', null, [['3.01.01', 'TRANSFERÊNCIA ENTRE CONTAS']]],
];
DB.plano_contas = [];
for (const [c, nome, tipo, nat, sec, filhos] of PLANO) {
  const pai = { id: id('pl'), empresa_id: E, codigo: c, nome, tipo, natureza: nat, nivel: 1, dre_secao: sec, ativo: true, pai_id: null, prioridade: tipo === 'S' ? (['2.02', '2.05'].includes(c) ? 'Obrigatório' : 'Negociável') : null };
  DB.plano_contas.push(pai);
  for (const [cf, nf] of filhos) DB.plano_contas.push({ id: id('pl'), empresa_id: E, codigo: cf, nome: nf, tipo, natureza: nat, nivel: 2, pai_id: pai.id, ativo: true });
}
const P = (c) => DB.plano_contas.find(p => p.codigo === c);
DB.grupos = [{ id: 'g1', empresa_id: E, nome: 'BANCOS' }, { id: 'g2', empresa_id: E, nome: 'CAIXA' }];
DB.contas = [['01', 'BANCO ALFA', 'g1', 85000], ['02', 'BANCO BETA', 'g1', 42000], ['03', 'COOPERATIVA GAMA', 'g1', 15000], ['04', 'CAIXA', 'g2', 1500]]
  .map(([c, nome, g, si]) => ({ id: id('ct'), empresa_id: E, codigo: c, tipo: g === 'g2' ? 'Caixa' : 'Conta Corrente', nome, grupo_id: g, disponibilidade: 'Conta com recursos disponíveis', instituicao: nome, agencia: '0001', numero: '12345-6', saldo_inicial_aberto: 0, saldo_inicial: si, ativo: true }));
DB.centros_custo = ['EXTRUSÃO', 'CORTE E SOLDA', 'ADMINISTRATIVO', 'COMERCIAL'].map(nome => ({ id: id('cc'), empresa_id: E, nome, ativo: true }));
const FAV = [['cliente', 'SUPERMERCADOS BOA COMPRA LTDA', '11444777000161'], ['cliente', 'DISTRIBUIDORA NORDESTE LTDA', '45723174000110'], ['cliente', 'ATACADO SERTÃO LTDA', '06990590000123'],
  ['cliente', 'FARMÁCIAS SAÚDE MAIS S.A.', '19131243000197'], ['fornecedor', 'RESINAS DO BRASIL S.A.', '33000167000101'], ['fornecedor', 'ENERGIA REGIONAL S.A.', '04895728000180'],
  ['fornecedor', 'EMBALAGENS PRIMAVERA LTDA', '61198164000160'], ['fornecedor', 'TRANSPORTES RÁPIDO LTDA', '27865757000102'], ['fornecedor', 'SISTEMAS NUVEM LTDA', '00623904000173'],
  ['fornecedor', 'IMÓVEIS CENTRO LTDA', '60701190000104'], ['fornecedor', 'JOSÉ CARLOS DA SILVA', '52998224725'], ['colaborador', 'FOLHA DE PAGAMENTO', null]];
DB.favorecidos = FAV.map(([tipo, nome, doc]) => ({ id: id('fv'), empresa_id: E, tipo: { cliente: 'CLIENTES', fornecedor: 'FORNECEDORES', colaborador: 'FUNCIONÁRIOS' }[tipo], nome, documento: doc, ativo: true, tipo_pessoa: doc && doc.length === 11 ? 'F' : 'J', municipio: 'RECIFE', uf: 'PE' }));
const F = (nome) => DB.favorecidos.find(f => f.nome.startsWith(nome));
// lançamentos de julho a dezembro: realizados até hoje, programados depois
DB.lancamentos = [];
const L = (data, plano, fav, valor, desc, extra = {}) => DB.lancamentos.push({ id: id('lc'), empresa_id: E, data, plano_id: P(plano).id, favorecido_id: fav ? F(fav).id : null,
  centro_custo_id: DB.centros_custo[plano.startsWith('2.03') ? 2 : 0].id, conta_id: (extra.conta || DB.contas[plano.startsWith('2.0') ? Math.floor(rnd() * 3) : 0]).id, valor, descricao: desc, status: data <= HOJE ? 'Pago' : 'Em aberto',
  prioridade: extra.prioridade ? 'Obrigatório' : null, origem: 'manual', documento: extra.doc || null, created_at: data + 'T09:00:00Z', ...extra.campos });
for (const m of ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']) {
  for (let k = 0; k < 8; k++) L(`${m}-${String(2 + k * 3).padStart(2, '0')}`, '1.01.01', pick(['SUPERMERCADOS', 'DISTRIBUIDORA', 'ATACADO', 'FARMÁCIAS']), Math.round(25000 + rnd() * 40000), `NF ${4100 + n} — duplicata`, { conta: pick(DB.contas.slice(0, 3)) });
  L(`${m}-05`, '2.01.01', 'RESINAS', Math.round(60000 + rnd() * 25000), 'COMPRA DE RESINA PEBD', { prioridade: 'alta' });
  L(`${m}-15`, '2.01.01', 'RESINAS', Math.round(30000 + rnd() * 15000), 'COMPRA DE RESINA PEAD');
  L(`${m}-10`, '2.01.03', 'ENERGIA', Math.round(21000 + rnd() * 4000), 'ENERGIA ELÉTRICA DA FÁBRICA', { prioridade: 'alta' });
  L(`${m}-12`, '2.01.02', 'EMBALAGENS', Math.round(6000 + rnd() * 3000), 'BOBINAS E CAIXAS');
  L(`${m}-05`, '2.02.01', 'FOLHA', 58000, 'FOLHA DE PAGAMENTO');
  L(`${m}-20`, '2.02.02', null, 19500, 'INSS E FGTS');
  L(`${m}-10`, '2.03.01', 'IMÓVEIS', 12000, 'ALUGUEL DO GALPÃO');
  L(`${m}-15`, '2.03.02', 'SISTEMAS', 1890, 'SISTEMAS E INTERNET');
  L(`${m}-20`, '2.05.01', null, Math.round(24000 + rnd() * 6000), 'ICMS DO MÊS');
  L(`${m}-25`, '2.05.02', null, Math.round(9000 + rnd() * 2000), 'PIS E COFINS');
  L(`${m}-28`, '2.04.01', null, 312.4, 'TARIFAS BANCÁRIAS');
  L(`${m}-18`, '2.06.01', 'TRANSPORTES', Math.round(9000 + rnd() * 5000), 'FRETE CARGA SALVADOR/BA');
  L(`${m}-22`, '2.06.01', 'JOSÉ CARLOS', 4500, 'FRETE AUTÔNOMO — RECIFE/PE');
}
// visão com os nomes (como a view v_lancamentos do banco)
const cl = (p) => DB.plano_contas.find(x => x.id === p.pai_id) || p;
Object.defineProperty(DB, 'v_lancamentos', { configurable: true, enumerable: true, get() {
  return DB.lancamentos.map(l => { const p = DB.plano_contas.find(x => x.id === l.plano_id), c = cl(p), f = DB.favorecidos.find(x => x.id === l.favorecido_id), ct = DB.contas.find(x => x.id === l.conta_id);
    return { ...l, ano: +l.data.slice(0, 4), mes: +l.data.slice(5, 7), valor_sinal: (p.natureza === 'C' ? 1 : -1) * l.valor, plano_codigo: p.codigo, plano_nome: p.nome, tipo: p.tipo,
      classe_id: c.id, classe_codigo: c.codigo, classe_nome: c.nome, favorecido_nome: f?.nome || null, centro_custo_nome: DB.centros_custo.find(x => x.id === l.centro_custo_id)?.nome,
      conta_nome: ct?.nome, grupo_id: ct?.grupo_id, disponibilidade: ct?.disponibilidade, grupo_nome: DB.grupos.find(g => g.id === ct?.grupo_id)?.nome, prioridade_efetiva: l.prioridade || c.prioridade || (p.tipo === 'S' ? 'Negociável' : null), prioridade_classe: c.prioridade }; });
} });
window.SEED = { E, HOJE, id, pick, rnd, dia, P, F };

// ---------- funções do banco (mesma conta das funções reais, sobre os dados acima) ----------
const filtrados = (a, de, ate) => DB.lancamentos.filter(l => l.data >= de && l.data <= ate && (a.p_status || ['Pago']).includes(l.status)
  && (!a.p_conta || l.conta_id === a.p_conta) && (!a.p_cc || l.centro_custo_id === a.p_cc) && (!a.p_favorecido || l.favorecido_id === a.p_favorecido)
  && (!a.p_grupo || DB.contas.find(c => c.id === l.conta_id)?.grupo_id === a.p_grupo)).map(l => { const p = DB.plano_contas.find(x => x.id === l.plano_id); return { ...l, classe_id: p.pai_id, valor_sinal: (p.natureza === 'C' ? 1 : -1) * l.valor, tipoP: p.tipo }; });
const agrupa = (xs, key) => { const m = new Map(); for (const x of xs) { const k = key(x); const o = m.get(k.id) || { ...k.row, total: 0, qtd: 0 }; o.total += x.valor_sinal; o.qtd++; m.set(k.id, o); } return [...m.values()].map(o => ({ ...o, total: Math.round(o.total * 100) / 100 })); };
const saldoIni = (a) => DB.contas.filter(c => (!a.p_conta || c.id === a.p_conta) && (!a.p_grupo || c.grupo_id === a.p_grupo)).reduce((s, c) => s + c.saldo_inicial, 0);
Object.assign(window.RPC = window.RPC || {}, {
  mfa_exigido: false, aceitar_convites: 0, pode_criar_empresa: false, chat_visto: true, chat_marcar_entregue: null,
  resumo_mensal: (a) => agrupa(filtrados(a, `${a.p_ano}-01-01`, `${a.p_ano}-12-31`), l => ({ id: l.plano_id + '|' + +l.data.slice(5, 7), row: { plano_id: l.plano_id, classe_id: l.classe_id, mes: +l.data.slice(5, 7) } })),
  resumo_diario: (a) => { const m = String(a.p_mes).padStart(2, '0'); return agrupa(filtrados(a, `${a.p_ano}-${m}-01`, `${a.p_ano}-${m}-31`), l => ({ id: l.data + '|' + l.classe_id, row: { dia: l.data, classe_id: l.classe_id } })); },
  saldo_em: (a) => Math.round((saldoIni(a) + filtrados(a, '1900-01-01', dia(a.p_data, -1)).reduce((s, l) => s + l.valor_sinal, 0)) * 100) / 100,
  saldos_contas: (a) => DB.contas.map(c => { const ls = DB.lancamentos.filter(l => l.conta_id === c.id), sinal = (l) => DB.plano_contas.find(x => x.id === l.plano_id).natureza === 'C' ? 1 : -1;
    const ate = a.p_ate || HOJE;
    return { conta_id: c.id, nome: c.nome, grupo: DB.grupos.find(g => g.id === c.grupo_id)?.nome, disponibilidade: c.disponibilidade,
      saldo_pago: Math.round((c.saldo_inicial + ls.filter(l => l.status === 'Pago' && l.data <= ate).reduce((s, l) => s + sinal(l) * l.valor, 0)) * 100) / 100,
      a_receber: ls.filter(l => l.status === 'Em aberto' && sinal(l) > 0).reduce((s, l) => s + l.valor, 0), a_pagar: ls.filter(l => l.status === 'Em aberto' && sinal(l) < 0).reduce((s, l) => s + l.valor, 0) }; }),
  orcamento_movimento: (a) => agrupa(filtrados({ p_status: ['Pago', 'Em aberto'] }, `${a.p_ano}-01-01`, `${a.p_ano}-12-31`).map(l => ({ ...l, valor_sinal: l.valor })), l => ({ id: [l.plano_id, l.centro_custo_id, l.data.slice(5, 7), l.status].join('|'), row: { plano_id: l.plano_id, centro_custo_id: l.centro_custo_id, mes: +l.data.slice(5, 7), status: l.status } })),
  listar_membros: () => DB.membros.map(m => ({ user_id: m.user_id, email: m.nome.toLowerCase().split(' ')[0] + '@exemplo.com.br', papel: m.papel, created_at: m.created_at, nome: m.nome })),
  compras_cadastros: () => ({ fornecedores: DB.favorecidos.filter(f => f.tipo === 'FORNECEDORES').map(f => ({ id: f.id, nome: f.nome, documento: f.documento, tipo: f.tipo })),
    centros: DB.centros_custo.map(c => ({ id: c.id, nome: c.nome })), planos: DB.plano_contas.filter(p => p.nivel === 2 && p.tipo === 'S').map(p => ({ id: p.id, codigo: p.codigo, nome: p.nome })),
    parametros: { alcada_valor: 5000, previsao_automatica: true }, pode_aprovar: true }),
  comercial_clientes: () => DB.favorecidos.filter(f => f.tipo === 'CLIENTES').map(f => ({ id: f.id, nome: f.nome, nome_fantasia: null, documento: f.documento, segmento: 'VAREJO', representante_id: 'rp1', representante: 'MARCOS VENDAS', limite_credito: 80000, prazo_padrao: '28/42', email: null, telefone: null, ativo: true })),
  comercial_notas: () => DB.lancamentos.filter(l => DB.plano_contas.find(p => p.id === l.plano_id).codigo === '1.01.01' && l.data <= HOJE).map((l, i) => { const f = DB.favorecidos.find(x => x.id === l.favorecido_id);
    return { nota_id: l.id, numero: 4100 + i, emissao: dia(l.data, -28), favorecido_id: f.id, dest_doc: f.documento, dest_nome: f.nome, dest_uf: 'PE', valor: l.valor, representante_id: 'rp1' }; }),
  comercial_itens: () => [],
});

// ---------- módulos ----------
const CC = (i) => DB.centros_custo[i].id, FV = (nome) => F(nome).id, PL = (c) => P(c).id;
// Pagamentos Antecipados
DB.paraquedas = [
  [21, 'aguardando', 'urgente', 'MANUTENÇÕES ALFA LTDA', '07526557000100', 6800, '2026-10-30', 'Troca do redutor da extrusora 2 — peças', true],
  [20, 'aprovado', 'normal', 'EMBALAGENS PRIMAVERA LTDA', '61198164000160', 3250.5, '2026-10-31', 'Lote de tubetes (pedido 118)', true],
  [19, 'pago', 'normal', 'GRÁFICA CENTRAL LTDA', '43202373000107', 1980, '2026-10-24', 'Clichês para impressão', true],
  [18, 'nota_recebida', 'normal', 'FERRAGENS DO NORTE LTDA', '06947284000104', 845.9, '2026-10-20', 'Rolamentos e correias', true],
  [17, 'rejeitado', 'normal', 'EVENTOS PRIME LTDA', '13347016000117', 5200, '2026-10-18', 'Coffee break da convenção', false],
].map(([numero, status, prioridade, razao, cnpj, valor, data, desc, nota]) => ({ id: id('pa'), empresa_id: E, numero, solicitante: 'Beatriz Rocha', razao_social: razao, cnpj, pix_tipo: 'cnpj', pix_chave: cnpj,
  valor, data_pagamento: data, descricao: desc, tera_nota: nota, previsao_nota: nota ? dia(data, 10) : null, prioridade, plano_id: PL('2.03.03'), centro_custo_id: CC(0), conta_id: DB.contas[0].id, status,
  motivo: status === 'rejeitado' ? 'Fora do orçamento do mês' : null, criado_em: dia(data, -2) + 'T10:00:00Z', atualizado_em: dia(data, -1) + 'T10:00:00Z' }));
DB.paraquedas_pagamentos = []; DB.paraquedas_anexos = [];
// Logística: frota, cargas, transportadores, fretes
DB.log_veiculos = [['TRK-01', 'ABC1D23', 'truck', 12000], ['CAR-01', 'XYZ9A87', 'carreta', 27000], ['VUC-01', 'QWE4R56', 'vuc', 3500]]
  .map(([codigo, placa, tipo, kg]) => ({ id: id('ve'), empresa_id: E, codigo, placa, tipo, carga_kg: kg, comp_m: 7, larg_m: 2.4, alt_m: 2.6, ocupacao_max_pct: 95, max_entregas: 8, consumo_km_l: 3, custo_km: 4.2, motorista: 'PAULO SANTOS', situacao: 'disponivel' }));
DB.log_cargas = [[31, '2026-10-30', 0, 'planejada', 8200], [30, '2026-10-29', 1, 'em_rota', 24500], [29, '2026-10-28', 2, 'concluida', 3100]]
  .map(([numero, data, v, status, peso]) => ({ id: id('cg'), empresa_id: E, numero, data, veiculo_id: DB.log_veiculos[v].id, motorista: 'PAULO SANTOS', status, peso_kg: peso, volume_m3: peso / 300, km_previsto: 420, frete_previsto: 1800 }));
DB.log_transportadores = [
  { id: 'tr1', empresa_id: E, nome: 'JOSÉ CARLOS DA SILVA', documento: '52998224725', tipo: 'tac', rntrc: '12345678', rntrc_validade: '2027-05-30', veiculos: [{ placa: 'JKL2M34', eixos: 5, tipo: 'carreta', tara: 8000, uf: 'PE', tp_rod: '03', tp_car: '02' }], conta_pix: '52998224725', conta_vinculo: 'proprio', contrato_validade: '2027-01-31', ativo: true },
  { id: 'tr2', empresa_id: E, nome: 'TRANSPORTES RÁPIDO LTDA', documento: '27865757000102', tipo: 'etc', rntrc: '87654321', veiculos: [], ativo: true },
  { id: 'tr3', empresa_id: E, nome: 'MARIA LÚCIA FRETES ME', documento: '28270541000185', tipo: 'tac_eq', rntrc: '11223344', veiculos: [], conta_pix: null, conta_vinculo: null, ativo: true },
];
DB.log_fretes = [
  [41, '2026-10-27', 'tr1', 4500, 4380, 'Caruaru/PE', 'Salvador/BA', 820, 'iplamm', '123456789012', 'iplamm'],
  [40, '2026-10-22', 'tr2', 6900, null, 'Caruaru/PE', 'Fortaleza/CE', 690, 'transportadora', '', 'transportadora'],
  [39, '2026-10-15', 'tr3', 3100, 3350, 'Caruaru/PE', 'Natal/RN', 410, 'iplamm', '', 'iplamm'],
].map(([numero, data, t, valor, piso, origem, destino, km, ciot_por, ciot, em]) => ({ id: id('fr'), empresa_id: E, numero, data, transportador_id: t, valor, piso, origem, destino, km, eixos: 5, lotacao: true, tabela: 'A', tipo_carga: 'geral',
  ciot_por, ciot: ciot || null, mdfe_emissor: em, mdfe: {}, pedagio_nao_ha: false, pedagio_valor: numero === 41 ? 312 : null, notas: '4521, 4522', status: 'aberto', placa: 'JKL2M34', motorista: 'JOSÉ CARLOS DA SILVA' }));
DB.log_frete_anexos = [{ id: id('fa'), empresa_id: E, transportador_id: 'tr1', tipo: 'contrato', nome: 'contrato_jose_carlos.pdf', enviado_em: '2026-02-01T10:00:00Z' }];
DB.log_piso_coef = [2, 3, 4, 5, 6, 7, 9].map((e, i) => ({ id: id('pc'), empresa_id: E, tabela: 'A', tipo_carga: 'geral', eixos: e, ccd: [4.07, 5.22, 5.92, 6.83, 7.53, 8.27, 9.41][i], cc: [452, 542, 589, 658, 672, 832, 903][i], vigencia: '2026-05-24', fonte: 'Tabela A — exemplo' }));
DB.log_frete_dispensas = []; DB.log_parametros = [{ id: 'lp1', empresa_id: E, mdfe_padrao: { prod: { tp_carga: '05', nome: 'EMBALAGENS PLÁSTICAS', ncm: '39232190' }, carregamento: [{ cmun: '2604106', xmun: 'CARUARU', uf: 'PE' }], ciot_resp: '11222333000181' } }];
// RH
DB.rh_colaboradores = [['0012', 'ANA PAULA FERREIRA', 'OPERADORA DE EXTRUSORA', 'Extrusão', 0, 2350, '2023-03-01'], ['0015', 'BRUNO COSTA LIMA', 'AUXILIAR DE PRODUÇÃO', 'Corte e solda', 1, 1900, '2024-06-10'],
  ['0021', 'CÍNTIA RAMOS', 'ANALISTA FINANCEIRA', 'Administrativo', 2, 4200, '2022-01-17'], ['0027', 'DANIEL SOUZA', 'VENDEDOR', 'Comercial', 3, 3100, '2025-02-03'], ['0030', 'ELAINE MOURA', 'OPERADORA DE CORTE', 'Corte e solda', 1, 2050, '2025-08-11']]
  .map(([matricula, nome, cargo, setor, c, salario, admissao]) => ({ id: id('rh'), empresa_id: E, matricula, nome, cpf: null, cargo, setor, centro_custo_id: CC(c), vinculo: 'clt', situacao: 'ativo', admissao, salario }));
DB.rh_folhas = []; DB.rh_folha_itens = []; DB.rh_folha_eventos = []; DB.rh_salarios = []; DB.rh_parametros = [];
// Compras
DB.compras_requisicoes = [[52, 'Ana Paula Ferreira', 0, 'Rolamentos para a extrusora 1', 'urgente', 'pendente'], [51, 'Cíntia Ramos', 2, 'Papel A4 e toner', 'normal', 'aprovada'], [50, 'Daniel Souza', 3, 'Amostras para cliente', 'normal', 'atendida']]
  .map(([numero, solicitante, c, necessidade, prioridade, status]) => ({ id: id('rq'), empresa_id: E, numero, solicitante, centro_custo_id: CC(c), necessidade, prioridade, status, criado_em: '2026-10-2' + (numero - 46) + 'T10:00:00Z' }));
DB.compras_requisicao_itens = DB.compras_requisicoes.map(r => ({ id: id('ri'), empresa_id: E, requisicao_id: r.id, descricao: r.necessidade, unidade: 'UN', quantidade: 4 }));
DB.compras_pedidos = [[118, 'EMBALAGENS PRIMAVERA', 'aprovado', 3250.5, '2026-11-05'], [117, 'RESINAS DO BRASIL', 'enviado', 84200, '2026-11-03'], [116, 'RESINAS DO BRASIL', 'recebido', 61900, '2026-10-20'], [115, 'SISTEMAS NUVEM', 'aguardando', 7800, '2026-11-10']]
  .map(([numero, fav, status, total, entrega]) => ({ id: id('pd'), empresa_id: E, numero, favorecido_id: FV(fav), data_pedido: dia(entrega, -12), entrega_prevista: entrega, condicao_pagamento: '28/56', parcelas_dias: [28, 56], plano_id: PL(fav.startsWith('RES') ? '2.01.01' : '2.01.02'), centro_custo_id: CC(0), frete: 0, desconto: 0, total, status, criado_em: dia(entrega, -12) + 'T10:00:00Z' }));
DB.compras_pedido_itens = DB.compras_pedidos.map(p => ({ id: id('pi'), empresa_id: E, pedido_id: p.id, descricao: p.total > 50000 ? 'RESINA PEBD LINEAR' : 'TUBETE 3 POLEGADAS', unidade: p.total > 50000 ? 'KG' : 'UN', quantidade: p.total > 50000 ? 10000 : 500, valor_unitario: p.total > 50000 ? p.total / 10000 : p.total / 500, qtd_recebida: p.status === 'recebido' ? (p.total > 50000 ? 10000 : 500) : 0 }));
DB.compras_cotacoes = []; DB.compras_cotacao_itens = []; DB.compras_recebimentos = []; DB.compras_parametros = [];
// Produtos e produção
DB.produtos = [['PA-100', 'SACO PEBD 40X60 0,10', 'produto_acabado', 'KG'], ['PA-210', 'BOBINA PEAD 30CM 0,05', 'produto_acabado', 'KG'], ['MP-001', 'RESINA PEBD LINEAR', 'materia_prima', 'KG'], ['MP-002', 'MASTERBATCH BRANCO', 'materia_prima', 'KG']]
  .map(([codigo, descricao, tipo, unidade]) => ({ id: id('pr'), empresa_id: E, codigo, descricao, tipo, unidade, ncm: '39232190', ativo: true, origem: 'manual', estoque_minimo: 500 }));
DB.prod_setores = ['Extrusão', 'Impressão', 'Corte e solda'].map((nome, i) => ({ id: id('ps'), empresa_id: E, nome, ordem: i + 1, horas_dia: 22, ativo: true }));
DB.prod_maquinas = [['EXT-01', 'EXTRUSORA 1', 0, 180], ['EXT-02', 'EXTRUSORA 2', 0, 220], ['IMP-01', 'IMPRESSORA FLEXO', 1, 300], ['CS-01', 'CORTE E SOLDA 1', 2, 120]]
  .map(([codigo, nome, s, cap]) => ({ id: id('pm'), empresa_id: E, setor_id: DB.prod_setores[s].id, codigo, nome, capacidade_kg_h: cap, ativo: true }));
DB.prod_ordens = [[1204, 0, 4800, 'SUPERMERCADOS', 'em_producao', '2026-11-04', 2], [1205, 1, 2500, 'DISTRIBUIDORA', 'liberada', '2026-11-06', 3], [1206, 0, 3200, 'ATACADO', 'planejada', '2026-11-10', 3], [1203, 1, 1800, 'FARMÁCIAS', 'concluida', '2026-10-28', 3]]
  .map(([numero, pr, qtd, cli, status, entrega, prio]) => ({ id: id('op'), empresa_id: E, numero, origem: 'plataforma', produto_id: DB.produtos[pr].id, codigo_produto: DB.produtos[pr].codigo, descricao: DB.produtos[pr].descricao, quantidade: qtd, unidade: 'KG', favorecido_id: FV(cli), cliente: F(cli).nome, emissao: dia(entrega, -10), entrega, prioridade: prio, status, criado_em: dia(entrega, -10) + 'T08:00:00Z' }));
DB.prod_ordem_etapas = DB.prod_ordens.flatMap(o => DB.prod_setores.map((s, i) => ({ id: id('pe'), empresa_id: E, ordem_id: o.id, setor_id: s.id, maquina_id: DB.prod_maquinas.find(m => m.setor_id === s.id)?.id, seq: i + 1, status: o.status === 'concluida' ? 'concluida' : i === 0 && o.status === 'em_producao' ? 'em_andamento' : 'aguardando', qtd_prevista: o.quantidade,
  qtd_boa: o.status === 'concluida' ? o.quantidade : i === 0 && o.status === 'em_producao' ? Math.round(o.quantidade * 0.45) : 0, refugo: 0, inicio_previsto: dia(o.entrega, -6 + i * 2), horas_previstas: 14 })));
DB.prod_apontamentos = []; DB.prod_operadores = [{ id: 'po1', empresa_id: E, nome: 'ANA PAULA FERREIRA', ativo: true }]; DB.prod_motivos = []; DB.prod_ferramentas = []; DB.prod_roteiros = [];
// Notas fiscais (cabeçalhos; sem XML)
DB.nfe_notas = DB.lancamentos.filter(l => P('1.01.01').id === l.plano_id && l.data <= HOJE).slice(-14).map((l, i) => { const f = DB.favorecidos.find(x => x.id === l.favorecido_id);
  return { id: id('nf'), empresa_id: E, chave: null, modelo: 55, serie: 1, numero: 4500 + i, emissao: dia(l.data, -28), tipo: 'saida', emissao_propria: true, finalidade: 1, natureza: 'VENDA DE PRODUÇÃO', cfops: ['5101'],
    emit_doc: '11222333000181', emit_nome: 'PLÁSTICOS EXEMPLO INDÚSTRIA LTDA', dest_doc: f.documento, dest_nome: f.nome, dest_uf: 'PE', favorecido_id: f.id, v_prod: l.valor, v_nf: l.valor, v_bc_icms: l.valor, v_icms: Math.round(l.valor * 0.18 * 100) / 100,
    v_pis: Math.round(l.valor * 0.0165 * 100) / 100, v_cofins: Math.round(l.valor * 0.076 * 100) / 100, v_ipi: 0, situacao: 'autorizada', importado_em: l.data + 'T08:00:00Z' }; });
DB.nfe_itens = []; DB.nfe_parcelas = [];
// Conciliação: extrato do Banco Alfa
const imp = { id: 'ei1', empresa_id: E, conta_id: DB.contas[0].id, arquivo: 'extrato_alfa_outubro.ofx', banco: '999', dt_inicio: '2026-10-01', dt_fim: '2026-10-28', saldo_final: 0, saldo_data: '2026-10-28', qtd: 0, novos: 0, created_at: '2026-10-29T08:00:00Z' };
DB.extrato_importacoes = [imp];
DB.extrato_itens = DB.lancamentos.filter(l => l.conta_id === DB.contas[0].id && l.data >= '2026-09-01' && l.data <= HOJE).map((l, i) => { const nat = DB.plano_contas.find(p => p.id === l.plano_id).natureza;
  return { id: id('ex'), empresa_id: E, conta_id: l.conta_id, importacao_id: imp.id, data: l.data, valor: (nat === 'C' ? 1 : -1) * l.valor, tipo: nat === 'C' ? 'CREDIT' : 'DEBIT', fitid: 'F' + i, descricao: l.descricao.toUpperCase().slice(0, 30), status: i % 3 ? 'conciliado' : 'pendente', created_at: imp.created_at }; });
DB.conciliacoes = [];
// Conciliação sugerida (SQL 095): parâmetros e situação dos extratos por conta (FICTÍCIOS)
DB.conc_config = [{ empresa_id: E, dias_exato: 3, dias_baixa: 7, conf_alta: 85, conf_media: 60, pesos: {}, alerta_dias: 5, contas_sem_alerta: [DB.contas[3].id] }];
const DR = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
window.RPC.conc_extratos_situacao = () => [
  { conta_id: DB.contas[0].id, ultimo_fim: DR(-1), ultima_importacao: DR(0) + 'T08:10:00Z', formato: 'cnab240', importacoes: 14, pendentes: DB.extrato_itens.filter(i => i.status === 'pendente').length, pendentes_valor: 18420.55 },
  { conta_id: DB.contas[1].id, ultimo_fim: DR(-9), ultima_importacao: DR(-8) + 'T09:00:00Z', formato: 'ofx', importacoes: 9, pendentes: 4, pendentes_valor: -2310.4 },
  { conta_id: DB.contas[2].id, ultimo_fim: null, ultima_importacao: null, formato: null, importacoes: 0, pendentes: 0, pendentes_valor: 0 },
  { conta_id: DB.contas[3].id, ultimo_fim: null, ultima_importacao: null, formato: null, importacoes: 0, pendentes: 0, pendentes_valor: 0 },
];
// Comercial
DB.comercial_vendedores = [{ id: 'rp1', empresa_id: E, nome: 'MARCOS VENDAS', email: 'marcos@exemplo.com.br', ativo: true, comissao_pct: 2 }];
DB.comercial_oportunidades = [['SUPERMERCADOS', 'Sacolas personalizadas — Natal', 'proposta', 48000, 60], ['ATACADO', 'Bobinas picotadas', 'qualificado', 22000, 40], ['DISTRIBUIDORA', 'Contrato anual de sacos de lixo', 'contato', 120000, 20], ['FARMÁCIAS', 'Sacolas farmácia', 'ganha', 18000, 100]]
  .map(([c, titulo, etapa, valor, prob], i) => ({ id: id('opp'), empresa_id: E, numero: 80 + i, favorecido_id: FV(c), vendedor_id: 'rp1', titulo, etapa, valor_estimado: valor, probabilidade: prob, previsao_fechamento: dia(HOJE, 15 + i * 7), criado_em: '2026-10-01T10:00:00Z', atualizado_em: '2026-10-25T10:00:00Z' }));
DB.comercial_metas = [];
// Créditos e FIDC
DB.creditos = [{ id: id('cr'), empresa_id: E, favorecido_id: FV('ATACADO'), natureza: 'cliente', tipo: 'adiantamento', data: '2026-10-08', valor: 15000, descricao: 'Adiantamento do pedido 7781', cancelado: false, criado_em: '2026-10-08T10:00:00Z' },
  { id: id('cr'), empresa_id: E, favorecido_id: FV('RESINAS'), natureza: 'fornecedor', tipo: 'devolucao', data: '2026-10-14', valor: 3420, descricao: 'Devolução de resina fora de especificação', cancelado: false, criado_em: '2026-10-14T10:00:00Z' }];
DB.creditos_usos = [];
DB.fidc_fundos = [{ id: 'fd1', empresa_id: E, nome: 'FUNDO EXEMPLO FIDC', ativo: true, taxa_am: 2.4, tarifa_operacao: 20, tarifa_titulo: 4.5, custo_assinatura: 70, metodo_desagio: 'fator', dias_compensacao: 3, limite_credito: 600000 },
  { id: 'fd2', empresa_id: E, nome: 'FUNDO ALFA', ativo: true, taxa_am: 2.1, tarifa_operacao: 35, tarifa_titulo: 5, custo_assinatura: 0, metodo_desagio: 'fator', dias_compensacao: 1, limite_credito: 250000, prazo_max: 75 },
  { id: 'fd3', empresa_id: E, nome: 'FUNDO BETA', ativo: true, taxa_am: 2.25, tarifa_operacao: 15, tarifa_titulo: 3.5, custo_assinatura: 0, metodo_desagio: 'simples', dias_compensacao: 2, prazo_max: 120 }];
DB.fidc_propostas = [[12, 'Pendente', 9, 186400, 34, 2.4], [11, 'Aprovada', 7, 142300, 31, 2.4]].map(([numero, status, qtd, face, prazo, taxa]) => ({ id: id('fp'), empresa_id: E, numero, fundo_id: 'fd1', data_operacao: '2026-10-2' + (numero - 4), status, qtd_titulos: qtd, valor_face: face, prazo_medio: prazo, prazo_cobrado: prazo + 3,
  taxa_am: taxa, desagio: Math.round(face * taxa / 100 * (prazo + 3) / 30), ad_valorem: 0, tarifas: 180, iof: Math.round(face * 0.0041 * 100) / 100, liquido: Math.round(face * 0.965), criado_em: '2026-10-20T10:00:00Z' }));
// Auditoria
DB.auditoria = [['Ana Souza', 'lancamentos', 'alterou', 'Marcou como pago: ENERGIA ELÉTRICA DA FÁBRICA'], ['Renata Alves', 'contas', 'alterou', 'Saldo inicial do BANCO BETA'], ['Beatriz Rocha', 'paraquedas', 'incluiu', 'PA nº 21']]
  .map(([nome, tabela, acao, desc], i) => ({ id: id('au'), empresa_id: E, user_id: 'u' + (i + 1), user_email: nome.split(' ')[0].toLowerCase() + '@exemplo.com.br', tabela, registro_id: null, acao, campos: ['status'], antes: {}, depois: { descricao: desc }, criado_em: `2026-10-2${8 - i}T1${i}:15:00Z` }));
// Identidade e crachás
DB.empresa_identidade = [{ empresa_id: E, nome_exibicao: 'PLÁSTICOS EXEMPLO', razao_documentos: 'PLÁSTICOS EXEMPLO INDÚSTRIA LTDA.', cor_primaria: '#2b5598', cor_secundaria: '#2a1f6f', cor_destaque: '#0a8ed3',
  telefone: '(81) 3333-4444', site: 'www.exemplo.com.br', unidades: [{ nome: 'Matriz', cnpj: '11.222.333/0001-81', endereco: 'Rua das Indústrias, 100', municipio: 'CARUARU', uf: 'PE', cep: '55000-000' }], cracha_validade_meses: 24 }];
DB.crachas = DB.rh_colaboradores.slice(0, 3).map((c, i) => ({ id: id('ck'), empresa_id: E, tipo: 'colaborador', colaborador_id: c.id, nome: c.nome, cargo: c.cargo, setor: c.setor, matricula: c.matricula,
  codigo: 'a1b2c3d4e5f6a7b8c9d0e1f' + i, via: 1, emitido_em: '2026-10-30', validade: '2028-10-30', status: 'ativo' }));
DB.rh_colaboradores.slice(0, 2).forEach(c => { c.autorizacao_imagem = '2026-10-30'; });
// contratos (SQL 068)
const CT = (numero, tipo, objeto, fav, valor, per, inicio, fim, extra = {}) => ({ id: id('ct'), empresa_id: E, numero, tipo, natureza: 'pagar', objeto, parte_tipo: 'favorecido', favorecido_id: F(fav).id,
  parte_nome: F(fav).nome, parte_documento: F(fav).documento, valor, periodicidade: per, dia_vencimento: 10, inicio, fim, renovacao_automatica: false, aviso_previo_dias: 30, indice: 'IPCA',
  data_base: null, plano_id: P('2.03.01').id, status: 'vigente', responsavel: 'Renata Alves', ...extra });
DB.contratos = [
  CT(1, 'locacao_imovel', 'Locação do galpão de expedição', 'IMÓVEIS CENTRO', 18500, 'mensal', '2024-12-01', '2026-11-30', { aviso_previo_dias: 30, data_base: '2026-12-01', indice: 'IGP-M' }),
  CT(2, 'servico', 'Licença e suporte do sistema de gestão', 'SISTEMAS NUVEM', 3200, 'mensal', '2025-11-05', '2027-11-04', { data_base: '2026-11-05', plano_id: P('2.03.02').id }),
  CT(3, 'locacao_veiculo_motorista', 'Locação de caminhão baú com motorista para rotas do interior', 'TRANSPORTES RÁPIDO', 14800, 'mensal', '2026-03-01', '2027-02-28', { data_base: '2027-03-01', plano_id: P('2.06.01').id,
    modelo: 'locacao_veiculo_motorista', dados: { veiculo: { marca_modelo: 'VW Delivery 11.180', placa: 'ABC1D23', ano: '2022', cor: 'branca', renavam: '01234567890' }, rota: 'Caruaru, Agreste e Sertão de Pernambuco', combustivel: 'da CONTRATADA', foro: 'Caruaru/PE' } }),
  CT(4, 'transporte_tac', 'Transporte de cargas por autônomo — rota Caruaru/Recife', 'JOSÉ CARLOS', 0, 'sem_valor', '2026-06-01', null, { natureza: 'sem_valor', indice: 'nenhum', aviso_previo_dias: 15 }),
  CT(5, 'fornecimento', 'Fornecimento de energia no mercado livre', 'ENERGIA REGIONAL', 46000, 'mensal', '2025-01-01', '2029-12-31', { renovacao_automatica: true, data_base: '2027-01-01', plano_id: P('2.01.03').id, aviso_previo_dias: 180 }),
];
DB.contrato_arquivos = DB.contratos.filter(c => c.numero !== 3).map(c => ({ id: id('ca'), empresa_id: E, contrato_id: c.id, tipo: 'assinado', nome: `contrato-${c.numero}-assinado.pdf`, path: `x/${c.numero}.pdf`, assinatura_digital: true, enviado_em: '2026-10-20T10:00:00Z' }));
DB.contrato_reajustes = [{ id: id('cr'), empresa_id: E, contrato_id: DB.contratos[1].id, data_base: '2026-11-05', indice: 'IPCA', percentual: 4.6812, valor_anterior: 3200, valor_novo: 3349.80,
  fonte: 'Banco Central, série 433 (IPCA), 10/2025 a 09/2026', status: 'proposto', proposto_em: '2026-10-29T15:00:00Z' }];
for (const c of DB.contratos.filter(x => x.natureza === 'pagar')) for (const m of ['2026-11', '2026-12', '2027-01'])
  DB.lancamentos.push({ id: id('lc'), empresa_id: E, data: `${m}-10`, plano_id: c.plano_id, favorecido_id: c.favorecido_id, valor: c.valor, status: 'Em aberto', descricao: `Contrato nº ${c.numero} — ${c.parte_nome}`, documento: 'CT ' + c.numero, origem: 'contrato', contrato_id: c.id });
// gestão da frota (SQL 070)
Object.assign(DB.log_veiculos[0], { marca_modelo: 'VW Delivery 11.180', ano_fab: 2021, ano_mod: 2022, cor: 'BRANCA', renavam: '01234567890', propriedade: 'proprio', km_atual: 118900, km_atual_em: '2026-10-28' });
Object.assign(DB.log_veiculos[1], { marca_modelo: 'Volvo FH 540', ano_fab: 2019, ano_mod: 2019, cor: 'BRANCA', propriedade: 'locado', contrato_id: DB.contratos[2].id, km_atual: 402300, km_atual_em: '2026-10-27' });
Object.assign(DB.log_veiculos[2], { marca_modelo: 'Mercedes Accelo 815', ano_fab: 2023, ano_mod: 2023, cor: 'BRANCA', propriedade: 'proprio', km_atual: 46100, km_atual_em: '2026-10-29' });
const [V1, V2, V3] = DB.log_veiculos;
DB.frota_motoristas = [
  { id: id('mo'), empresa_id: E, nome: 'PAULO SANTOS', cpf: '39053344705', vinculo: 'empregado', cnh_numero: '01234567890', cnh_categoria: 'E', cnh_validade: '2026-11-20', cnh_ear: true, toxicologico_data: '2024-06-10', toxicologico_validade: '2026-12-10', termo_assinado_em: '2026-02-01', ativo: true },
  { id: id('mo'), empresa_id: E, nome: 'RICARDO ALMEIDA', cpf: '11144477735', vinculo: 'empregado', cnh_numero: '09876543210', cnh_categoria: 'D', cnh_validade: '2029-03-15', cnh_ear: true, toxicologico_data: '2025-05-02', toxicologico_validade: '2027-11-02', ativo: true },
  { id: id('mo'), empresa_id: E, nome: 'JOSÉ CARLOS DA SILVA', cpf: '52998224725', vinculo: 'agregado', cnh_numero: '05544332211', cnh_categoria: 'E', cnh_validade: '2028-08-01', cnh_ear: true, toxicologico_validade: '2027-04-01', mopp_validade: '2027-09-30', ativo: true },
];
const [M1, M2] = DB.frota_motoristas;
DB.frota_documentos = [
  { id: id('fd'), empresa_id: E, veiculo_id: V1.id, tipo: 'crlv', numero: '2026', validade: '2027-09-30' }, { id: id('fd'), empresa_id: E, veiculo_id: V1.id, tipo: 'seguro', numero: 'AP-55120', emissor: 'SEGURADORA EXEMPLO', validade: '2026-12-05', valor: 7400 },
  { id: id('fd'), empresa_id: E, veiculo_id: V1.id, tipo: 'tacografo', validade: '2027-03-12' }, { id: id('fd'), empresa_id: E, veiculo_id: V3.id, tipo: 'crlv', validade: '2026-11-10' },
  { id: id('fd'), empresa_id: E, veiculo_id: V3.id, tipo: 'seguro', emissor: 'SEGURADORA EXEMPLO', validade: '2027-05-01', valor: 4300 }, { id: id('fd'), empresa_id: E, veiculo_id: V2.id, tipo: 'crlv', validade: '2027-08-31' },
];
DB.frota_planos = [
  { id: id('fp'), empresa_id: E, veiculo_id: V1.id, descricao: 'Troca de óleo e filtros', a_cada_km: 20000, a_cada_meses: 6, ultimo_km: 100100, ultima_data: '2026-05-20', ativo: true },
  { id: id('fp'), empresa_id: E, veiculo_id: V1.id, descricao: 'Revisão de freios', a_cada_km: 40000, ultimo_km: 90000, ultima_data: '2026-01-10', ativo: true },
  { id: id('fp'), empresa_id: E, veiculo_id: V3.id, descricao: 'Troca de óleo e filtros', a_cada_km: 15000, a_cada_meses: 6, ultimo_km: 40200, ultima_data: '2026-08-02', ativo: true },
];
DB.frota_manutencoes = [
  { id: id('fm'), empresa_id: E, veiculo_id: V1.id, data: '2026-10-08', km: 116500, tipo: 'pneus', oficina: 'PNEUS DO AGRESTE', descricao: 'Dois pneus dianteiros 275/80 R22.5 e alinhamento', valor: 4380, lancamento_id: 'x' },
  { id: id('fm'), empresa_id: E, veiculo_id: V3.id, data: '2026-10-21', km: 45800, tipo: 'corretiva', oficina: 'OFICINA DIESEL CENTRO', descricao: 'Troca do alternador', valor: 1650 },
];
DB.frota_abastecimentos = [];
{ let km1 = 112000, km3 = 42600; const d0 = new Date('2026-09-25T12:00:00Z');
  for (let i = 0; i < 12; i++) { const d = new Date(d0); d.setUTCDate(d.getUTCDate() + i * 3); const ds = d.toISOString().slice(0, 10);
    const l1 = 180 + (i % 3) * 15, k1 = Math.round(l1 * (i === 10 ? 2.4 : 3.6)); km1 += k1;
    DB.frota_abastecimentos.push({ id: id('fa'), empresa_id: E, veiculo_id: V1.id, motorista_id: M1.id, data: ds, km: km1, litros: l1, valor: +(l1 * 6.19).toFixed(2), combustivel: 'diesel_s10', tanque_cheio: true, posto: 'POSTO BR-232' });
    if (i % 2 === 0) { const l3 = 70, k3 = Math.round(l3 * 6.8); km3 += k3; DB.frota_abastecimentos.push({ id: id('fa'), empresa_id: E, veiculo_id: V3.id, motorista_id: M2.id, data: ds, km: km3, litros: l3, valor: +(l3 * 6.19).toFixed(2), combustivel: 'diesel_s10', tanque_cheio: true, posto: 'POSTO CENTRAL' }); } } }
DB.frota_multas = [
  { id: id('fu'), empresa_id: E, veiculo_id: V1.id, motorista_id: M1.id, auto_numero: 'S123456789', orgao: 'PRF', data_infracao: '2026-10-12', local: 'BR-232 km 120', infracao: 'Velocidade superior à máxima em até 20%', codigo: '7455-0', pontos: 4, valor: 130.16, vencimento: '2026-11-25', prazo_indicacao: '2026-11-04', situacao: 'a_indicar' },
  { id: id('fu'), empresa_id: E, veiculo_id: V3.id, motorista_id: M2.id, auto_numero: 'E987654321', orgao: 'DETRAN-PE', data_infracao: '2026-09-02', infracao: 'Estacionar em local proibido', codigo: '5550-1', pontos: 3, valor: 195.23, vencimento: '2026-10-20', situacao: 'paga', desconto_folha: true },
];
// indicadores de logística (SQL 071): cargas e entregas de maio a outubro
DB.log_parametros = [{ id: id('lp'), empresa_id: E, dias_atraso: 3, metas: { prazo_pct: 95, ocupacao_pct: 80, custo_pct: 5, devol_pct: 1 } }];
DB.log_carga_notas = DB.log_carga_notas || [];
{ const CLI = ['SUPERMERCADOS BOA COMPRA LTDA', 'DISTRIBUIDORA NORDESTE LTDA', 'ATACADO SERTÃO LTDA', 'FARMÁCIAS SAÚDE MAIS S.A.'];
  let num = 1, nn = 5000;
  ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].forEach((m, mi) => {
    for (let c = 0; c < 9; c++) {
      const v = DB.log_veiculos[c % 3], data = `${m}-${String(2 + c * 3).padStart(2, '0')}`;
      const occ = 0.66 + mi * 0.025 + (c % 3) * 0.03, peso = Math.round(+v.carga_kg * occ);
      const cg = { id: id('cg'), empresa_id: E, numero: num++, data, veiculo_id: v.id, motorista: 'PAULO SANTOS', status: 'concluida', peso_kg: peso, volume_m3: +(peso / 380).toFixed(1), km_previsto: 300 + c * 20, km_real: 310 + c * 22, frete_previsto: 1500 };
      DB.log_cargas.push(cg);
      for (let k = 0; k < 4; k++) {
        const em = dia(data, -1 - (k % 2)), atraso = (c + k + mi) % (9 - mi) === 0 ? 3 : 0, entregue = dia(data, k % 2 + atraso);
        const nota = { id: id('nf'), empresa_id: E, chave: String(26e42 + nn), numero: nn++, emissao: em, tipo: 'saida', emissao_propria: true, dest_nome: CLI[(c + k) % 4], v_nf: 18000 + ((c * 7 + k * 13) % 9) * 2500, situacao: 'autorizada' };
        DB.nfe_notas.push(nota);
        const sit = (c * 4 + k + mi) % 47 === 0 ? 'devolvida' : 'entregue';
        DB.log_carga_notas.push({ id: id('cn'), empresa_id: E, carga_id: cg.id, nota_id: nota.id, seq: k, peso_kg: peso / 4, situacao: sit, entregue_em: sit === 'entregue' ? entregue + 'T15:00:00Z' : null });
      }
    }
  }); }
// Notas com itens e impostos para os relatórios de faturamento/compras e a reforma tributária (fictícias)
{ const r2 = (v) => Math.round(v * 100) / 100;
  const PROD = [['PA-100', 'SACO PEBD 40X60 0,10', 11.8], ['PA-210', 'BOBINA PEAD 30CM 0,05', 13.4], ['PA-330', 'FILME STRETCH 50CM', 15.2], ['PA-450', 'SACOLA ALÇA CAMISETA', 12.6]];
  const CLI = [['SUPERMERCADOS BOA COMPRA LTDA', '10111222000101', 'PE'], ['DISTRIBUIDORA NORDESTE LTDA', '20222333000102', 'PB'], ['ATACADO SERTÃO LTDA', '30333444000103', 'PE'],
    ['FARMÁCIAS SAÚDE MAIS S.A.', '40444555000104', 'AL'], ['MERCADINHO SÃO JOSÉ LTDA', '50555666000105', 'PE'], ['EMBALAGENS LITORAL LTDA', '60666777000106', 'BA']];
  const FOR = [['RESINAS BRASIL S.A.', '70777888000107', 'BA', 'RESINA PEBD LINEAR', 8.9, '6101'], ['MASTER CORES LTDA', '80888999000108', 'SP', 'MASTERBATCH BRANCO', 21.5, '6101'], ['ENERGIA PE DISTRIBUIDORA', '90999000000109', 'PE', 'ENERGIA ELÉTRICA', 1, '5253']];
  const imp = (nt, v, uf, ano) => { const icms = r2(v * (uf === 'PE' ? 0.205 : 0.12)), pis = r2(v * 0.0165), cof = r2(v * 0.076), base = r2(v - icms - pis - cof);
    Object.assign(nt, { v_prod: v, v_desc: 0, v_frete: 0, v_seg: 0, v_outro: 0, v_nf: v, v_bc_icms: v, v_icms: icms, v_ipi: 0, v_pis: pis, v_cofins: cof });
    if (ano >= 2026) Object.assign(nt, { v_bc_ibscbs: base, v_cbs: r2(base * 0.009), v_ibs: r2(base * 0.001) }); return { icms, pis, cof }; };
  const itensDe = (nt, cfop, partes) => { let resto = nt.v_prod; partes.forEach(([p, q], k) => { const vp = k === partes.length - 1 ? r2(resto) : r2(q * p[2]); resto -= vp; const f = vp / nt.v_prod;
    DB.nfe_itens.push({ id: id('ni'), empresa_id: E, nota_id: nt.id, n_item: k + 1, cprod: p[0], xprod: p[1], ncm: '39232190', cfop, ucom: 'KG', qcom: q, vprod: vp, vdesc: 0, vfrete: 0, voutro: 0, cst_icms: '00',
      v_icms: r2(nt.v_icms * f), v_st: 0, v_ipi: 0, v_pis: r2(nt.v_pis * f), v_cofins: r2(nt.v_cofins * f), cst_ibscbs: nt.v_bc_ibscbs ? '000' : null, cclass_trib: nt.v_bc_ibscbs ? '000001' : null, v_cbs: nt.v_cbs ? r2(nt.v_cbs * f) : null, v_ibs: nt.v_ibs ? r2(nt.v_ibs * f) : null }); }); };
  // as notas que já existiam (logística, contas a receber): completa impostos e itens
  for (const nt of DB.nfe_notas) {
    const c = CLI.find(x => x[0] === nt.dest_nome) || CLI[(nt.numero || 0) % CLI.length];
    Object.assign(nt, { dest_nome: c[0], dest_doc: c[1], dest_uf: c[2], cfops: [c[2] === 'PE' ? '5101' : '6101'], finalidade: '1', serie: '1', natureza: 'VENDA DE PRODUÇÃO' });
    imp(nt, +nt.v_nf || +nt.v_prod, c[2], +nt.emissao.slice(0, 4));
    const p1 = PROD[(nt.numero || 0) % 4], p2 = PROD[((nt.numero || 0) + 1) % 4];
    itensDe(nt, nt.cfops[0], [[p1, Math.round(nt.v_prod * 0.6 / p1[2])], [p2, 1]]);
  }
  let num = 3000, nf = 900;
  for (let a = 2025; a <= 2026; a++) for (let m = 1; m <= (a === 2026 ? 10 : 12); m++) {
    const mes = `${a}-${String(m).padStart(2, '0')}`, cresc = a === 2026 ? 1.12 : 1, saz = 1 + 0.12 * Math.sin(m / 2);
    // vendas
    CLI.forEach((c, k) => { if (a === 2026 && m >= 5 && k < 4) return;   // de maio/2026 em diante os 4 primeiros já têm as notas da logística
     for (let rep = 0; rep < (!(a === 2026 && m >= 5) && k < 4 ? 8 : 1); rep++) {   // volume parecido com o das notas da logística
      const v = r2((rep ? 26000 : 42000 - k * 5200) * cresc * saz * (0.9 + rnd() * 0.2));
      const nt = { id: id('nf'), empresa_id: E, chave: null, modelo: 55, serie: '1', numero: num++, emissao: `${mes}-${String(Math.min(28, 4 + k * 4 + rep * 2)).padStart(2, '0')}`, tipo: 'saida', emissao_propria: true, finalidade: '1', natureza: 'VENDA DE PRODUÇÃO',
        cfops: [c[2] === 'PE' ? '5101' : '6101'], emit_doc: '11222333000181', emit_nome: 'PLÁSTICOS EXEMPLO INDÚSTRIA LTDA', dest_doc: c[1], dest_nome: c[0], dest_uf: c[2], situacao: 'autorizada', eventos: [] };
      imp(nt, v, c[2], a); const p1 = PROD[k % 4], p2 = PROD[(k + 2) % 4];
      itensDe(nt, nt.cfops[0], [[p1, Math.round(v * 0.55 / p1[2])], [p2, 1]]); DB.nfe_notas.push(nt); } });
    // devolução de cliente a cada 3 meses (emitida pelo cliente)
    if (m % 3 === 0) { const c = CLI[m % CLI.length], v = r2(1800 + m * 110);
      const nt = { id: id('nf'), empresa_id: E, modelo: 55, serie: '1', numero: nf++, emissao: `${mes}-21`, tipo: 'saida', emissao_propria: false, finalidade: '4', natureza: 'DEVOLUÇÃO DE COMPRA', cfops: [c[2] === 'PE' ? '5202' : '6202'],
        emit_doc: c[1], emit_nome: c[0], dest_doc: '11222333000181', dest_nome: 'PLÁSTICOS EXEMPLO INDÚSTRIA LTDA', situacao: 'autorizada', eventos: [] };
      imp(nt, v, c[2], a); itensDe(nt, nt.cfops[0], [[PROD[m % 4], 1]]); DB.nfe_notas.push(nt); }
    // compras
    FOR.forEach((f, k) => { const v = r2([88000, 14500, 9800][k] * cresc * saz * (0.92 + rnd() * 0.16));
      const nt = { id: id('nf'), empresa_id: E, modelo: 55, serie: '1', numero: 70000 + nf++, emissao: `${mes}-${String(6 + k * 7).padStart(2, '0')}`, tipo: 'saida', emissao_propria: false, finalidade: '1', natureza: 'VENDA', cfops: [f[5]],
        emit_doc: f[1], emit_nome: f[0], dest_doc: '11222333000181', dest_nome: 'PLÁSTICOS EXEMPLO INDÚSTRIA LTDA', situacao: 'autorizada', eventos: [] };
      imp(nt, v, f[2], a); itensDe(nt, f[5], [[[k === 2 ? 'EN-01' : `MP-00${k + 1}`, f[3], f[4]], 1]]); DB.nfe_notas.push(nt); });
  }
  // uma cancelada, uma com CBS divergente, uma sem o grupo IBS/CBS e uma com redução (setembro/2026)
  const set = DB.nfe_notas.filter(n => n.emissao_propria && n.emissao.startsWith('2026-09'));
  if (set[0]) set[0].situacao = 'cancelada';
  if (set[1]) set[1].v_cbs = r2(set[1].v_cbs * 1.25);
  if (set[2]) { set[2].v_bc_ibscbs = null; set[2].v_cbs = null; set[2].v_ibs = null; DB.nfe_itens.filter(i => i.nota_id === set[2].id).forEach(i => { i.cst_ibscbs = null; i.v_cbs = null; i.v_ibs = null; }); }
  if (set[3]) { set[3].v_cbs = r2(set[3].v_cbs * 0.4); set[3].v_ibs = r2(set[3].v_ibs * 0.4); DB.nfe_itens.filter(i => i.nota_id === set[3].id).forEach(i => { i.cst_ibscbs = '200'; i.cclass_trib = '200034'; }); }
  DB.trib_aliquotas = [];
}
// Carteira cedida: títulos cedidos a dois fundos fictícios e o relatório de pagos de um deles
{ const CL = ['SUPERMERCADOS BOA COMPRA LTDA', 'DISTRIBUIDORA NORDESTE LTDA', 'ATACADO SERTÃO LTDA', 'FARMÁCIAS SAÚDE MAIS S.A.', 'MERCADINHO SÃO JOSÉ LTDA'];
  DB.fidc_titulos = []; DB.fidc_liquidacoes = []; let nf = 8000, b = 900;
  for (const fundo of ['FUNDO ALFA', 'FUNDO BETA']) for (let k = 0; k < 16; k++) {
    const dop = dia('2026-08-03', k * 5), bord = String(b++);
    for (let p = 1; p <= 3; p++) {
      const venc = dia(dop, 21 * p + (k % 3)), v = Math.round((4200 + ((k * 37 + p * 11) % 9) * 950) * 100) / 100, t = { id: id('ft'), empresa_id: E, fundo, bordero: bord, data_operacao: dop, titulo: `${nf}-00${p}`, vencimento: venc, valor: v, sacado: CL[(k + p) % 5] };
      DB.fidc_titulos.push(t);
      if (fundo === 'FUNDO ALFA' && venc <= '2026-10-22' && !(k === 5 && p === 2) && !(k === 9 && p === 1))
        DB.fidc_liquidacoes.push({ id: id('fl'), empresa_id: E, fundo, titulo: t.titulo, bordero: bord, fidc_titulo_id: t.id, vencimento: venc, quitacao: k === 3 && p === 3 ? dia(venc, 2) : venc, sacado: t.sacado, valor_face: v, desconto: 0, mora: 0, valor_pago: v, tipo: k === 3 && p === 3 ? 'recompra' : 'normal', tipo_fundo: k === 3 && p === 3 ? 'RECOMPRA' : 'NORMAL' });
      nf++;
    }
  }
}
// Notas de débito de juros/multa (fictícias)
{ const ns = DB.nfe_notas.filter(n => n.emissao_propria && n.cfops && DB.nfe_itens.some(i => i.nota_id === n.id) && n.emissao >= '2026-09-01').slice(0, 4);
  const mk = (n, k, o) => ({ id: id('nd'), empresa_id: E, origem: 'recebimento', nota_id: n.id, nf_numero: n.numero, parcela: 2, cliente_nome: n.dest_nome, cliente_doc: n.dest_doc, criado_em: '2026-10-20T10:00:00Z', ...o });
  DB.fiscal_notas_debito = ns.length < 4 ? [] : [
    mk(ns[0], 0, { data_recebimento: '2026-10-29', valor: 241.75, status: 'pendente' }),
    mk(ns[1], 1, { data_recebimento: '2026-10-21', valor: 103.70, status: 'pendente' }),
    mk(ns[2], 2, { origem: 'fidc', data_recebimento: '2026-10-05', valor: 161.19, status: 'a_decidir', motivo: 'Juros recebidos pelo fundo FUNDO ALFA (relatório de pagos): definir com a contabilidade' }),
    mk(ns[3], 3, { data_recebimento: '2026-10-08', valor: 58.40, status: 'emitida', nd_numero: '4521', nd_serie: '1', emitida_em: '2026-10-08' }),
  ];
}
// Base FIDC (operações dos borderôs fictícios), CDI e posição de estoque — para Análise FIDC e Posição de estoque
{ const ops = {};
  for (const t of DB.fidc_titulos || []) {
    const k = t.fundo + '|' + t.bordero;
    const o = ops[k] || (ops[k] = { id: id('fo'), empresa_id: E, fundo: t.fundo, data: t.data_operacao, bordero: t.bordero, conta_id: DB.contas[0].id, qtd_titulos: 0, valor_face: 0, prazoV: 0 });
    o.qtd_titulos++; o.valor_face += +t.valor; o.prazoV += +t.valor * Math.round((Date.parse(t.vencimento) - Date.parse(t.data_operacao)) / 864e5); t.operacao_id = o.id; t.sacado_agrupado = t.sacado;
  }
  DB.fidc_operacoes = Object.values(ops).map(o => { const pm = Math.round(o.prazoV / o.valor_face * 100) / 100, taxa = o.fundo === 'FUNDO ALFA' ? 0.021 : 0.0245, des = Math.round(o.valor_face * taxa * pm / 30 * 100) / 100, tar = 20 + o.qtd_titulos * 4.5;
    const { prazoV, ...r } = o; return { ...r, valor_face: Math.round(o.valor_face * 100) / 100, desagio: des, ad_valorem: 0, tarifas: tar, iof: 0, encargos: 0, recompra: 0, desc_sacado: 0, liquido: Math.round((o.valor_face - des - tar) * 100) / 100, prazo_medio: pm, prazo_cobrado: pm, custo_total: Math.round((des + tar) * 100) / 100 }; });
  DB.indices_mensais = [1.01, 0.99, 0.96, 1.05, 1.14, 1.10, 1.28, 1.16, 1.22, 1.25].map((cdi, i) => ({ id: id('ix'), empresa_id: E, ano: 2026, mes: i + 1, cdi }));
  const esp = (data, f) => { const e = { id: id('es'), empresa_id: E, data_ref: data, arquivo: `posicao_${data}.xlsx`, linhas: DB.produtos.length, criado_em: data + 'T08:00:00Z' }; DB.estoque_espelhos.push(e);
    DB.produtos.forEach((p, k) => DB.estoque_espelho_itens.push({ id: id('ei'), empresa_id: E, espelho_id: e.id, produto_id: p.id, codigo: p.codigo, descricao: p.descricao, deposito: 'GERAL', unidade: p.unidade, quantidade: f[k], custo_unitario: [11.8, 13.4, 8.9, 21.5][k], valor: Math.round(f[k] * [11.8, 13.4, 8.9, 21.5][k] * 100) / 100 })); };
  DB.estoque_espelhos = []; DB.estoque_espelho_itens = [];
  esp('2026-10-15', [6200, 3900, 18400, 950]); esp('2026-10-29', [4800, 2650, 9300, 420]);
  DB.produtos.forEach((p, k) => { p.ponto_pedido = [3000, 3000, 12000, 600][k]; });
  DB.estoque_parametros = [{ empresa_id: E, metodo_custo: 'ultima_compra' }];
}
// Estoque parametrizado (SQL 075): locais, famílias, tipos de movimento, regras por CFOP e um kardex fictício
{ const L = (codigo, nome, finalidade, ordem, o = {}) => ({ id: id('el'), empresa_id: E, codigo, nome, finalidade, posse: 'propria', controla_saldo: true, compoe_custo: true, permite_negativo: false, papeis: null, ordem, ativo: true, ...o });
  DB.est_locais = [L('MP', 'Matéria-prima (resinas, master, aditivos)', 'materia_prima', 10), L('INS', 'Insumos de produção (tintas, solventes, tubetes, embalagens)', 'insumo', 20),
    L('PROC-1', 'Em processo — Extrusão', 'processo', 31, { setor_id: DB.prod_setores[0].id }), L('PROC-2', 'Em processo — Impressão', 'processo', 32, { setor_id: DB.prod_setores[1].id }), L('PROC-3', 'Em processo — Corte e solda', 'processo', 33, { setor_id: DB.prod_setores[2].id }),
    L('ACA', 'Produto acabado', 'acabado', 60), L('APA', 'Aparas e reprocesso', 'aparas', 70), L('MAN', 'Manutenção (peças de reposição)', 'manutencao', 80, { papeis: ['producao'] }), L('UC', 'Uso e consumo (EPI, limpeza, escritório)', 'uso_consumo', 90),
    L('TER', 'Nosso em poder de terceiros (industrialização, conserto)', 'terceiros', 100, { posse: 'em_terceiros' }), L('DTE', 'De terceiros em nosso poder', 'terceiros', 110, { posse: 'de_terceiros', compoe_custo: false }), L('QUA', 'Quarentena (aguardando a qualidade)', 'quarentena', 120)];
  const lc = (c) => DB.est_locais.find(l => l.codigo === c).id;
  const F = (codigo, nome, tipo_sped, loc, lote = false) => ({ id: id('ef'), empresa_id: E, codigo, nome, tipo_sped, local_padrao_id: loc ? lc(loc) : null, controla_lote: lote, ativo: true });
  DB.est_familias = [F('RESINA', 'Resinas', '01', 'MP', true), F('MASTER', 'Master e aditivos', '01', 'MP', true), F('TINTA', 'Tintas e solventes', '10', 'INS'), F('EMBAL', 'Embalagens e tubetes', '02', 'INS'),
    F('SEMI', 'Semiacabado (bobina, fio)', '03', 'PROC-1', true), F('ACABADO', 'Produto acabado', '04', 'ACA'), F('APARA', 'Aparas e reprocessado', '05', 'APA'), F('PECA', 'Peças de reposição', '07', 'MAN'),
    F('CONSUMO', 'Uso e consumo (geral)', '07', 'UC'), F('EPI', 'EPI', '07', 'UC'), F('REVENDA', 'Mercadoria para revenda', '00', 'ACA'), F('SERV', 'Serviços', '09'), F('OUTROS', 'Outros', '99')];
  const T = (codigo, nome, sentido, o = {}) => ({ id: id('et'), empresa_id: E, codigo, nome, sentido, afeta_custo: false, gera_financeiro: false, documento: 'nenhum', sistema: true, ativo: true, ...o });
  DB.est_tipos_movimento = [T('SI', 'Saldo inicial (implantação)', 'E', { afeta_custo: true, documento: 'inventario' }), T('COMPRA', 'Compra', 'E', { afeta_custo: true, gera_financeiro: true, documento: 'nf' }),
    T('DEVCLI', 'Devolução de cliente', 'E', { documento: 'nf', local_destino_id: lc('ACA') }), T('PROD', 'Produção (apontamento)', 'E', { afeta_custo: true, documento: 'op' }), T('AJ+', 'Ajuste de inventário (sobra)', 'E', { documento: 'inventario' }),
    T('VENDA', 'Venda', 'S', { documento: 'nf', local_origem_id: lc('ACA') }), T('REQPROD', 'Requisição para a produção', 'S', { documento: 'requisicao' }), T('REQINT', 'Requisição interna (uso e consumo, manutenção)', 'S', { documento: 'requisicao' }),
    T('REMTER', 'Remessa para terceiros (industrialização, conserto)', 'S', { documento: 'nf', local_destino_id: lc('TER') }), T('PERDA', 'Perda / sucata', 'S'), T('AJ-', 'Ajuste de inventário (falta)', 'S', { documento: 'inventario' }), T('TRF', 'Transferência entre locais', 'T')];
  const tm = (c) => DB.est_tipos_movimento.find(t => t.codigo === c).id;
  const R = (cfop, sentido, t, observacao) => ({ id: id('er'), empresa_id: E, cfop, sentido, tipo_movimento_id: t ? tm(t) : null, prioridade: 100, observacao, ativo: true });
  DB.est_regras_cfop = [R('101', 'entrada', 'COMPRA', 'Compra para industrialização'), R('102', 'entrada', 'COMPRA', 'Compra para comercialização'), R('556', 'entrada', 'COMPRA', 'Compra de material de uso e consumo'),
    R('201', 'entrada', 'DEVCLI', 'Devolução de venda de produção'), R('949', 'entrada', null, 'Outra entrada: não movimenta (revise)'), R('101', 'saida', 'VENDA', 'Venda de produção'), R('102', 'saida', 'VENDA', 'Venda de mercadoria'),
    R('915', 'saida', 'REMTER', 'Remessa para conserto'), R('922', 'saida', null, 'Simples faturamento (entrega futura): não movimenta')];
  const fam = (c) => DB.est_familias.find(f => f.codigo === c);
  DB.produtos.forEach(p => { const f = fam(p.tipo === 'produto_acabado' ? 'ACABADO' : p.codigo === 'MP-002' ? 'MASTER' : 'RESINA'); Object.assign(p, { familia_id: f.id, tipo_sped: f.tipo_sped, local_padrao_id: f.local_padrao_id, controla_lote: f.controla_lote }); });
  DB.produtos.push({ id: id('pr'), empresa_id: E, codigo: 'UC-010', descricao: 'LUVA NITRÍLICA', tipo: 'uso_consumo', unidade: 'PAR', ativo: true, origem: 'manual', familia_id: fam('EPI').id, tipo_sped: '07', local_padrao_id: lc('UC'), controla_lote: false });
  const P = (c) => DB.produtos.find(p => p.codigo === c);
  DB.est_lotes = [['MP-001', 'L-2610-01', 'BRK 7781'], ['MP-001', 'L-2610-02', 'BRK 7802'], ['MP-002', 'L-2610-03', 'CAB 1190']].map(([c, codigo, lf]) => ({ id: id('lt'), empresa_id: E, produto_id: P(c).id, codigo, lote_fornecedor: lf, origem: 'compra' }));
  const lt = (c) => DB.est_lotes.find(l => l.codigo === c).id;
  const M = [ // [data, produto, local, lote, tipo, qtd, custo]
    ['2026-10-01', 'MP-001', 'MP', 'L-2610-01', 'SI', 8000, 10.9], ['2026-10-01', 'MP-002', 'MP', 'L-2610-03', 'SI', 1200, 20.8], ['2026-10-01', 'PA-100', 'ACA', null, 'SI', 3500, 15.2], ['2026-10-01', 'PA-210', 'ACA', null, 'SI', 2100, 17.6],
    ['2026-10-01', 'UC-010', 'UC', null, 'SI', 300, 4.1], ['2026-10-08', 'MP-001', 'MP', 'L-2610-02', 'COMPRA', 12000, 11.75], ['2026-10-09', 'MP-001', 'MP', 'L-2610-01', 'REQPROD', -6500], ['2026-10-09', 'MP-002', 'MP', 'L-2610-03', 'REQPROD', -380],
    ['2026-10-14', 'PA-100', 'ACA', null, 'PROD', 5200, 15.6], ['2026-10-20', 'PA-100', 'ACA', null, 'VENDA', -4100], ['2026-10-21', 'PA-210', 'ACA', null, 'VENDA', -1300], ['2026-10-22', 'UC-010', 'UC', null, 'REQINT', -60],
    ['2026-10-27', 'MP-001', 'MP', 'L-2610-02', 'REQPROD', -5200], ['2026-10-29', 'PA-100', 'ACA', null, 'PROD', 3800, 15.9], ['2026-10-30', 'PA-100', 'ACA', null, 'VENDA', -3600]];
  const cus = {}, sal = {}; DB.est_movimentos = [];
  M.forEach(([data, c, l, lote, t, qt, cu], k) => { const p = P(c), tt = DB.est_tipos_movimento.find(x => x.codigo === t), x = cus[p.id] ||= { q: 0, v: 0, cm: 0 };
    const u = qt > 0 && tt.afeta_custo ? cu : (x.q > 0 ? x.v / x.q : x.cm), val = Math.round(qt * u * 100) / 100; x.q += qt; x.v = Math.round((x.v + val) * 100) / 100; if (x.q > 0) x.cm = x.v / x.q;
    const ks = p.id + '|' + l + '|' + (lote || ''), s = sal[ks] ||= { id: id('ss'), empresa_id: E, produto_id: p.id, local_id: lc(l), lote_id: lote ? lt(lote) : null, quantidade: 0, valor: 0 };
    s.quantidade += qt; s.valor = Math.round((s.valor + val) * 100) / 100; s.ultimo_movimento = data;
    DB.est_movimentos.push({ id: id('mv'), empresa_id: E, data, produto_id: p.id, local_id: lc(l), lote_id: lote ? lt(lote) : null, tipo_movimento_id: tt.id, quantidade: qt, custo_unitario: u, valor: val,
      custo_medio_apos: x.cm, saldo_local_apos: s.quantidade, documento: t === 'VENDA' ? 'NF 90' + (12 + k) : t === 'COMPRA' ? 'NF 55031' : t === 'PROD' ? 'OP 1' + (40 + k) : t === 'SI' ? 'Inventário de implantação' : 'REQ ' + (300 + k), criado_em: data + 'T1' + (k % 10) + ':00:00Z' }); });
  DB.est_saldos = Object.values(sal);
  DB.est_custos = Object.entries(cus).map(([pid, x]) => ({ produto_id: pid, empresa_id: E, quantidade: x.q, valor: x.v, custo_medio: x.cm, ultima_entrada: '2026-10-29' }));
  DB.est_fechamentos = [{ empresa_id: E, mes: '2026-09-01', fechado_em: '2026-10-05T12:00:00Z' }];
}

// regime tributário (SQL 078) — fictício: a empresa de exemplo entrou no Simples e optou pelo IBS/CBS no regime regular em 2027
DB.empresa_tributacao = [
  { id: 'trib1', empresa_id: E, vigencia_inicio: '2026-01-01', regime: 'simples', pis_cofins: null, irpj_apuracao: null,
    simples_atividades: [{ cnae: '2222-6/00', descricao: 'Fabricação de embalagens de material plástico', anexo: 'II', fator_r: false }, { cnae: '4930-2/02', descricao: 'Transporte rodoviário de cargas intermunicipal', anexo: 'III', fator_r: false }],
    sublimite_excedido: false, ibscbs_regular: false, incentivos: null, uf: 'PE', municipio_ibge: '2604106', cnae_principal: '2222-6/00', contabilidade: 'Escritório Contábil Exemplo', fonte: 'Cartão CNPJ e contabilidade' },
  { id: 'trib2', empresa_id: E, vigencia_inicio: '2027-01-01', regime: 'simples', pis_cofins: null, irpj_apuracao: null,
    simples_atividades: [{ cnae: '2222-6/00', descricao: 'Fabricação de embalagens de material plástico', anexo: 'II', fator_r: false }, { cnae: '4930-2/02', descricao: 'Transporte rodoviário de cargas intermunicipal', anexo: 'III', fator_r: false }],
    sublimite_excedido: false, ibscbs_regular: true, incentivos: null, uf: 'PE', municipio_ibge: '2604106', cnae_principal: '2222-6/00', contabilidade: 'Escritório Contábil Exemplo', fonte: 'Opção no Portal do Simples (setembro/2026)' },
];

// NF-e do cliente para o transporte (SQL 081) — dados FICTÍCIOS
DB.nfe_compartilhamento = [{ id: id('nc'), empresa_origem: 'emp-cliente', empresa_destino: E, empresa_id: 'emp-cliente', finalidade: 'transporte', ativo: true, desde: '2026-01-01' }];
Object.assign(window.RPC, {
  log_nfe_cliente: () => [
    { nota_id: 'n1', origem: 'INDÚSTRIA EXEMPLO LTDA', numero: 50101, serie: '1', chave: '2626', emissao: '2026-10-20', dest_nome: 'COMERCIAL ALFA LTDA', dest_uf: 'PE', xmun: 'Recife', v_nf: 18450.5, peso_kg: 2300, transp_doc: '00000000000100', transp_nome: 'TRANSPORTADORA EXEMPLO', mod_frete: '0', desta_empresa: true },
    { nota_id: 'n2', origem: 'INDÚSTRIA EXEMPLO LTDA', numero: 50098, serie: '1', chave: '2626', emissao: '2026-10-19', dest_nome: 'MERCADO BETA LTDA', dest_uf: 'PB', xmun: 'Campina Grande', v_nf: 9200, peso_kg: 1100, transp_doc: null, transp_nome: null, mod_frete: '0', desta_empresa: false },
    { nota_id: 'n3', origem: 'INDÚSTRIA EXEMPLO LTDA', numero: 50095, serie: '1', chave: '2626', emissao: '2026-10-18', dest_nome: 'DISTRIBUIDORA GAMA', dest_uf: 'AL', xmun: 'Maceió', v_nf: 12780, peso_kg: null, transp_doc: null, transp_nome: null, mod_frete: '9', desta_empresa: false },
  ],
});

// e-frete (SQL 082) — parâmetros e tipos de carga FICTÍCIOS
DB.efrete_config = [{ empresa_id: E, ambiente: 'homologacao', tipo_viagem: 'Padrao', tipo_pagamento: 'eFRETE', pct_adiantamento: 40, dias_liberacao_quitacao: 2, prazo_viagem_horas: 48,
  docs_credenciado: ['Canhoto da NF-e assinado pelo destinatario', 'Comprovante de entrega da carga'], entrega_documentacao: 'RedeCredenciada', tipo_embalagem: 'Pallet', unidade_medida: 'Kg',
  tipo_calculo: 'SemQuebra', tolerancia_tipo: 'Nenhum', tolerancia_valor: 0, contratante_endereco: { rua: 'RUA DO EXEMPLO', numero: '100', bairro: 'CENTRO', cep: '55000000', cmun: '2604106' }, observacoes_transportador: [] }];
DB.efrete_tipos_carga = [['granel sólido', 1], ['granel líquido', 2], ['frigorificada', 3], ['conteinerizada', 4], ['geral', 5], ['neogranel', 6], ['perigosa granel sólido', 7], ['perigosa granel líquido', 8],
  ['perigosa frigorificada', 9], ['perigosa conteinerizada', 10], ['perigosa geral', 11], ['granel pressurizada', 12]].map(([tipo_carga, codigo]) => ({ empresa_id: E, tipo_carga, codigo }));
// respostas FICTÍCIAS da função e-frete para as figuras do manual
window.FN = {
  status: () => ({ ambiente: 'homologacao', ponte: true, empresa_integrada: true, segredos: { homologacao: { integrador: true, usuario: true, senha: true }, producao: { integrador: false, usuario: false, senha: false } } }),
  ciot_previa: () => ({ ambiente: 'homologacao', faltas: [{ onde: 'transportador', txt: 'chassi do veículo JKL2M34 (17 caracteres)' }, { onde: 'transportador', txt: 'motorista do CPF 11144477735 no cadastro do transportador (CNH, nascimento, celular)' }],
    resumo: { contratado: 'JOSÉ CARLOS DA SILVA', motorista: null, placas: ['JKL2M34'], origem: 'Caruaru', destino: 'Salvador', valor: 6300, adiantamento: 2520, quitacao: 3780, pagamento: 'eFRETE',
      notas: [4521, 4522], peso: 12400, tipo_carga: 'geral', codigo_antt: 5 }, inicio: '2026-10-30T11:00:00.000Z', fim: '2026-11-01T11:00:00.000Z' }),
};

// Ativo Imobilizado (SQL 084) — bens, contas e depreciações FICTÍCIOS (depreciação calculada pela mesma regra da plataforma)
{
  const CT = [['1.2.30.100.0001', 'MÁQUINAS E EQUIPAMENTOS', 'D'], ['1.2.30.900.0001', '(-) DEPRECIAÇÃO ACUMULADA DE MÁQUINAS', 'C'], ['1.2.30.100.0002', 'VEÍCULOS', 'D'],
    ['1.2.30.900.0002', '(-) DEPRECIAÇÃO ACUMULADA DE VEÍCULOS', 'C'], ['1.2.30.100.0003', 'MÓVEIS E UTENSÍLIOS', 'D'], ['1.2.30.900.0003', '(-) DEPRECIAÇÃO ACUMULADA DE MÓVEIS', 'C'],
    ['1.2.30.100.0004', 'COMPUTADORES E PERIFÉRICOS', 'D'], ['1.2.30.900.0004', '(-) DEPRECIAÇÃO ACUMULADA DE COMPUTADORES', 'C'], ['3.1.20.300.0001', 'DEPRECIAÇÃO', 'D'], ['3.3.10.100.0001', 'CUSTO DO IMOBILIZADO BAIXADO', 'D']];
  DB.contab_contas = (DB.contab_contas || []).concat(CT.map(([c, d, nat], i) => ({ id: `ct-af${i}`, empresa_id: E, classificacao: c, descricao: d, tipo: 'A', natureza: nat, nivel: 5 })));
  const K = [['TER', 'Terrenos', false, 0, 1, 'nenhum', false], ['EDI', 'Edificações e construções', true, 4, 300, 'depreciacao', false], ['INS', 'Instalações', true, 10, 120, 'depreciacao', false],
    ['MAQ', 'Máquinas e equipamentos industriais', true, 10, 120, 'imediato', true, 0, 1, 8], ['EMP', 'Empilhadeiras e movimentação', true, 10, 120, 'nenhum', false],
    ['VCG', 'Caminhões e veículos de carga', true, 25, 48, 'nenhum', false, 2, 3, 8], ['VPS', 'Automóveis de passageiros', true, 20, 60, 'nenhum', false, 2, 3, 8],
    ['INF', 'Computadores e periféricos', true, 20, 60, 'nenhum', false, 6, 7, 8], ['MOV', 'Móveis e utensílios', true, 10, 120, 'nenhum', false, 4, 5, 8],
    ['FER', 'Ferramentas, clichês e cilindros', true, 20, 60, 'nenhum', false], ['SOF', 'Softwares e licenças (intangível)', true, 20, 60, 'nenhum', false]];
  DB.af_classes = K.map(([codigo, nome, deprecia, taxa_fiscal, vida_util_meses, credito_pis_cofins, ciap, a, d, x]) => ({ id: `ak-${codigo}`, empresa_id: E, codigo, nome, deprecia, taxa_fiscal, vida_util_meses, residual_pct: 0,
    conta_ativo_id: a != null ? `ct-af${a}` : null, conta_deprec_id: d != null ? `ct-af${d}` : null, conta_despesa_id: x != null ? `ct-af${x}` : null, credito_pis_cofins, ciap, ativo: true, observacao: null }));
  DB.af_parametros = [{ empresa_id: E, prefixo: 'PAT', regra_inicio: 'mes_seguinte', gerar_contabil: true, conta_custo_baixa_id: 'ct-af9', valor_minimo: 1200, ncm_imobilizado: ['8477', '8471', '8704', '9403'], planos_imobilizado: [], pis_cofins_ate: '2026-12-31', ciap_fatores: { '2026-09': 0.9612 } }];
  const cc = (n) => DB.centros_custo.find(c => c.nome === n)?.id;
  const B = [['EXTRUSORA BALÃO 65 MM', 'MAQ', '2021-03-10', 385000, 'Extrusão', 'EXTRUSÃO', 'EXT-01', 'MAQPLAST', 'MX-65', 'A1123', 46200],
    ['EXTRUSORA BALÃO 55 MM', 'MAQ', '2023-08-22', 298000, 'Extrusão', 'EXTRUSÃO', 'EXT-02', 'MAQPLAST', 'MX-55', 'B2210', 35760],
    ['IMPRESSORA FLEXOGRÁFICA 6 CORES', 'MAQ', '2022-05-04', 640000, 'Impressão', 'EXTRUSÃO', 'IMP-01', 'FLEXOTEC', 'FX-6C', 'F6-0098', 76800],
    ['MÁQUINA DE CORTE E SOLDA AUTOMÁTICA', 'MAQ', '2024-02-15', 182000, 'Corte e solda', 'CORTE E SOLDA', null, 'SOLDAMAX', 'CS-800', 'CS8-551', 21840],
    ['AGLUTINADOR 300 KG/H', 'MAQ', '2019-11-28', 96000, 'Recuperação', 'EXTRUSÃO', null, 'RECICLA', 'AG-300', 'R300-12', 0],
    ['REBOBINADEIRA 1.200 MM', 'MAQ', '2026-03-16', 74500, 'Impressão', 'EXTRUSÃO', null, 'BOBITEC', 'RB-1200', 'RB-7731', 8940],
    ['EMPILHADEIRA A GÁS 2,5 T', 'EMP', '2020-07-01', 118000, 'Expedição', 'COMERCIAL', null, 'LIFTER', 'G25', 'LF-2501', 0],
    ['CAMINHÃO TRUCK BAÚ', 'VCG', '2022-09-12', 412000, 'Pátio', 'COMERCIAL', null, 'RODOMAX', 'R-2428', '9BR-TRUCK01', 0],
    ['CAMINHÃO VUC', 'VCG', '2024-06-03', 228000, 'Pátio', 'COMERCIAL', null, 'RODOMAX', 'V-1016', '9BR-VUC01', 0],
    ['AUTOMÓVEL DA DIRETORIA', 'VPS', '2023-01-20', 168000, 'Administrativo', 'ADMINISTRATIVO', null, 'AUTOCAR', 'SEDAN', '9BR-CAR01', 0],
    ['SERVIDOR DE DADOS', 'INF', '2025-02-10', 38500, 'CPD', 'ADMINISTRATIVO', null, 'DATASERV', 'DS-220', 'SRV-7781', 4620],
    ['NOTEBOOKS DO ADMINISTRATIVO (6)', 'INF', '2025-08-05', 31200, 'Administrativo', 'ADMINISTRATIVO', null, 'NOTEX', 'NX14', 'LOTE-06', 3744],
    ['MOBILIÁRIO DO ESCRITÓRIO', 'MOV', '2021-01-15', 42000, 'Administrativo', 'ADMINISTRATIVO', null, null, null, null, 0],
    ['MESAS DE INSPEÇÃO DA PRODUÇÃO', 'MOV', '2023-04-11', 12800, 'Corte e solda', 'CORTE E SOLDA', null, null, null, null, 0]];
  const cls = (c) => DB.af_classes.find(k => k.codigo === c);
  DB.af_bens = B.map(([descricao, c, data_aquisicao, v, local, ccn, maq, marca, modelo, serie, icms], i) => ({ id: `ab-${i + 1}`, empresa_id: E, numero: i + 1, plaqueta: `PAT-${String(i + 1).padStart(6, '0')}`, descricao, classe_id: cls(c).id,
    marca, modelo, serie, centro_custo_id: cc(ccn), local, responsavel: i < 6 ? 'Encarregado de produção' : null, data_aquisicao, valor_aquisicao: v, valor_residual: 0, vida_util_meses: cls(c).vida_util_meses, taxa_fiscal: cls(c).taxa_fiscal,
    data_corte: data_aquisicao < '2025-12-01' ? '2025-12-31' : null, deprec_inicial: 0, meses_iniciais: 0, icms_credito: icms, situacao: i === 6 ? 'em_manutencao' : 'em_uso', maquina_id: maq ? (DB.prod_maquinas || []).find(m => m.codigo === maq)?.id || null : null,
    nf_numero: String(30100 + i * 7), criado_em: data_aquisicao + 'T12:00:00Z' }));
  // implantação: acumulada até 12/2025 pela vida útil, começando no mês seguinte ao da aquisição
  const dif = (a, b) => { const [x, y] = a.split('-').map(Number), [z, w] = b.split('-').map(Number); return (z * 12 + w) - (x * 12 + y); };
  for (const b of DB.af_bens.filter(b => b.data_corte)) { const m = Math.min(b.vida_util_meses, Math.max(0, dif(b.data_aquisicao.slice(0, 7), '2025-12'))); b.meses_iniciais = m; b.deprec_inicial = Math.round(b.valor_aquisicao / b.vida_util_meses * m * 100) / 100; }
  // aglutinador baixado por venda em setembro
  Object.assign(DB.af_bens[4], { situacao: 'baixado', baixa_data: '2026-09-18', baixa_tipo: 'venda', baixa_valor: 12000, baixa_motivo: 'Vendido para recicladora (NF 4870), substituído por modelo maior' });
  DB.af_depreciacoes = []; DB.af_calculos = [];
  for (let mes = 1; mes <= 9; mes++) {
    const m = `2026-${String(mes).padStart(2, '0')}`, calc = { id: `ac-${mes}`, empresa_id: E, competencia: `${m}-01`, situacao: mes <= 8 ? 'fechado' : 'calculado', qtd: 0, total: 0, total_fiscal: 0, baixas: mes === 9 ? 1 : 0, pendencias: [],
      calculado_por: 'ana.souza@exemplo.com.br', calculado_em: `2026-${String(mes + 1).padStart(2, '0')}-03T12:00:00Z`, fechado_por: mes <= 8 ? 'renata@exemplo.com.br' : null };
    for (const b of DB.af_bens) {
      const k = DB.af_classes.find(x => x.id === b.classe_id); if (!k.deprecia) continue;
      const ini = b.data_aquisicao.slice(0, 7); if (m <= ini || (b.baixa_data && b.baixa_data.slice(0, 7) <= m)) continue;
      const ds = DB.af_depreciacoes.filter(d => d.bem_id === b.id), acum = b.deprec_inicial + ds.reduce((s2, d) => s2 + d.valor, 0), usados = b.meses_iniciais + ds.length;
      const rest = b.valor_aquisicao - acum, faltam = b.vida_util_meses - usados; if (rest <= 0) continue;
      const v = faltam <= 1 ? Math.round(rest * 100) / 100 : Math.round(rest / faltam * 100) / 100, vf = Math.round(Math.min(b.valor_aquisicao - acum, b.valor_aquisicao * b.taxa_fiscal / 1200) * 100) / 100;
      DB.af_depreciacoes.push({ id: DB.af_depreciacoes.length + 1, empresa_id: E, calculo_id: calc.id, bem_id: b.id, competencia: `${m}-01`, meses: 1, valor: v, acumulada: Math.round((acum + v) * 100) / 100, valor_fiscal: vf, centro_custo_id: b.centro_custo_id });
      calc.qtd++; calc.total = Math.round((calc.total + v) * 100) / 100; calc.total_fiscal = Math.round((calc.total_fiscal + vf) * 100) / 100;
    }
    DB.af_calculos.push(calc);
  }
  DB.af_movimentos = [{ id: 1, empresa_id: E, bem_id: 'ab-2', tipo: 'aquisicao', data: '2023-08-22', para: { valor: 298000, local: 'Extrusão' }, usuario: 'renata@exemplo.com.br', criado_em: '2026-11-07T10:00:00Z' },
    { id: 2, empresa_id: E, bem_id: 'ab-2', tipo: 'transferencia', data: '2026-06-10', de: { local: 'Extrusão', responsavel: null }, para: { local: 'Extrusão — linha 2', responsavel: 'Encarregado de produção' }, usuario: 'ana.souza@exemplo.com.br', criado_em: '2026-06-10T14:00:00Z' }];
  DB.af_inventarios = [{ id: 'ai-1', empresa_id: E, numero: 1, descricao: 'Inventário da produção 2026', data_inicio: '2026-10-29', filtro: {}, situacao: 'aberto', criado_por: 'renata@exemplo.com.br', criado_em: '2026-10-29T08:00:00Z' }];
  DB.af_inventario_itens = ['ab-1', 'ab-2', 'ab-3', 'ab-6', 'ab-8', 'ab-11'].map((b, i) => ({ id: `aii-${i}`, empresa_id: E, inventario_id: 'ai-1', bem_id: b, encontrado: true,
    local_encontrado: i === 3 ? 'Corte e solda' : DB.af_bens.find(x => x.id === b).local, estado: i === 4 ? 'regular' : 'bom', conferido_por: 'ana.souza@exemplo.com.br', conferido_em: `2026-10-29T0${8 + i}:15:00Z` }));
  DB.af_anexos = [{ id: 'aa-1', empresa_id: E, bem_id: 'ab-1', caminho: 'x/nf.pdf', nome: 'NF 30100 extrusora.pdf', tipo: 'nota', criado_por: 'renata@exemplo.com.br', criado_em: '2026-11-07T10:00:00Z' }];
  DB.af_ignorados = [];
  Object.assign(window.RPC, {
    af_candidatos: () => [
      { origem: 'nfe', ref_id: 'nfi-1', data: '2026-10-21', documento: 'NF 88214', fornecedor: 'SELADORAS DO NORDESTE LTDA', descricao: 'SELADORA PNEUMÁTICA DE FUNDO 800 MM', ncm: '84778010', quantidade: 1, valor: 46800, icms: 5616, ipi: 0, nota_id: 'nf-x', motivo: 'NCM de bem durável e valor unitário a partir do mínimo' },
      { origem: 'nfe', ref_id: 'nfi-2', data: '2026-10-08', documento: 'NF 1182', fornecedor: 'INFORMÁTICA EXEMPLO', descricao: 'MONITOR 27 POL', ncm: '85285200', quantidade: 4, valor: 6400, icms: 768, ipi: 0, nota_id: 'nf-y', motivo: 'NCM de bem durável e valor unitário a partir do mínimo' },
      { origem: 'maquina', ref_id: (DB.prod_maquinas || [])[3]?.id || 'pm-x', data: null, documento: (DB.prod_maquinas || [])[3]?.codigo || 'CS-01', descricao: (DB.prod_maquinas || [])[3]?.nome || 'CORTE E SOLDA 2', quantidade: 1, valor: null, motivo: 'Máquina da produção sem bem no imobilizado' },
      { origem: 'veiculo', ref_id: (DB.log_veiculos || [])[2]?.id || 'lv-x', data: null, documento: (DB.log_veiculos || [])[2]?.placa || 'QWE4R56', descricao: 'VUC BAÚ', quantidade: 1, valor: null, motivo: 'Veículo próprio sem bem no imobilizado' }],
    af_calcular: (a) => { const m = String(a.p_competencia).slice(0, 7), ds = DB.af_depreciacoes.filter(d => d.competencia.slice(0, 7) === m);
      return { competencia: a.p_competencia, qtd: ds.length || 12, total: ds.reduce((s2, d) => s2 + d.valor, 0) || 31876.45, total_fiscal: ds.reduce((s2, d) => s2 + d.valor_fiscal, 0) || 33980.12, baixas: 0, pendencias: [],
        classes: [{ classe: 'MAQ Máquinas e equipamentos industriais', qtd: 5, valor: 13621.31, fiscal: 13621.31 }, { classe: 'VCG Caminhões e veículos de carga', qtd: 2, valor: 13333.33, fiscal: 13333.33 }, { classe: 'INF Computadores e periféricos', qtd: 2, valor: 1161.67, fiscal: 1161.67 }] }; },
    contab_balancete_gerencial: () => [],
  });
}

// Cadastro pelas notas de entrada (SQL 085) — itens de compra, regras e prontidão FICTÍCIOS
{
  const fam = (c) => DB.est_familias.find(f => f.codigo === c);
  if (!fam('FERRAM')) DB.est_familias.push({ id: 'ef-ferram', empresa_id: E, codigo: 'FERRAM', nome: 'Ferramental (clichês, anilox, lâminas, facas)', tipo_sped: '10', ativo: true },
    { id: 'ef-naoest', empresa_id: E, codigo: 'NAOEST', nome: 'Não é estoque (energia, serviços, obras)', tipo_sped: '99', ativo: true });
  const R = [[10, 'NAOEST', ['2716'], [], 'Energia elétrica'], [12, 'NAOEST', [], ['SERVICO', 'MAO DE OBRA'], 'Serviços'], [20, 'FERRAM', ['8442'], ['CLICHE', 'ANILOX'], 'Ferramental'],
    [30, 'EPI', ['6403'], [' CA ', 'LUVA'], 'EPI'], [60, 'TINTA', ['3215', '3814'], ['TINTA', 'THINNER'], 'Tintas e solventes'], [70, 'MASTER', ['3206', '3812'], ['MASTER', 'MB '], 'Master e aditivos'],
    [75, 'EMBAL', ['4822', '3923'], ['TUBETE', 'STRETCH'], 'Embalagens'], [80, 'RESINA', ['3901', '3902'], [], 'Resinas (só pelo NCM)'], [110, 'PECA', ['84', '85', '40'], [], 'Peças'], [200, 'CONSUMO', [], [], 'Tudo o que sobrar']];
  DB.est_classif_regras = R.map(([ordem, f, ncm_prefixos, palavras, observacao], i) => ({ id: 'ecr-' + i, empresa_id: E, ordem, familia_id: fam(f).id, ncm_prefixos, palavras, valor_unit_min: null, observacao, ativo: true }));
  const I = [['11222333000155', 'PETROQUÍMICA EXEMPLO', 'P2022', 'PEBD 2022N SC 25KG', 'SC', '39011010', 3200, 612000], ['44555666000177', 'DISTRIBUIDORA DE RESINAS ALFA', '000881', 'POLIETILENO BAIXA DENSIDADE 2022N', 'KG', '39011090', 41000, 389500],
    ['11222333000155', 'PETROQUÍMICA EXEMPLO', 'P118', 'PELBD 118W BB 1.250 KG', 'BB', '39014000', 120, 1312000], ['44555666000177', 'DISTRIBUIDORA DE RESINAS ALFA', '000902', 'PEAD HF0144 SC 25KG', 'SC', '39012029', 2400, 514000],
    ['77888999000100', 'MASTERBATCH BETA', 'MB-BR', 'MB BRANCO 70% TIO2 SC 25KG', 'SC', '32061119', 300, 118000], ['77888999000100', 'MASTERBATCH BETA', 'AD-SL', 'MB DESLIZANTE BAIXA MIGRACAO', 'KG', '38123900', 1800, 46800],
    ['22333444000111', 'TINTAS GAMA', 'T-AZ', 'TINTA FLEXO AZUL REFLEX', 'KG', '32151100', 900, 61200], ['22333444000111', 'TINTAS GAMA', 'TH-1', 'THINNER FLEXO', 'L', '38140090', 2600, 33800],
    ['55666777000188', 'TUBETES DELTA', 'TB76', 'TUBETE PAPELAO 76MM X 1,5M', 'UN', '48221000', 4000, 22000], ['33444555000122', 'CLICHERIA EPSILON', 'CL-901', '(006970) CLICHE 1.14 DIGITAL SACO CAFE', 'UN', '84425000', 6, 9600],
    ['66777888000133', 'ROLAMENTOS ZETA', '6205ZZ', 'ROLAMENTO 6205 ZZ', 'PC', '84821010', 40, 1480], ['88999000000144', 'EPI ETA', 'LV-12', 'LUVA NITRILICA CA 12254', 'PAR', '40151900', 200, 1900],
    ['99000111000155', 'DISTRIBUIDORA DE ENERGIA', 'ENE', 'ENERGIA ELETRICA', 'KWH', '27160000', 98000, 81500], ['10203040000199', 'MANUTENÇÃO TETA', 'MO-1', 'MAO DE OBRA', 'UN', '00000000', 1, 2400]];
  window.RPC.produto_depara_pendente = () => I.map(([emit_doc, emit_nome, codigo_fornecedor, descricao, unidade, ncm, quantidade, valor]) => ({ emit_doc, emit_nome, codigo_fornecedor, descricao, unidade, ncm, quantidade, valor, notas: 3, ultima: '2026-10-20' }));
  window.RPC.est_prontidao = () => ({ resumo: [{ sentido: 'entrada', resultado: 'sem_produto', itens: 1180, valor: 3204000 }, { sentido: 'entrada', resultado: 'nao_movimenta', itens: 42, valor: 84000 }, { sentido: 'entrada', resultado: 'sem_regra', itens: 26, valor: 91000 },
      { sentido: 'saida', resultado: 'ok', itens: 2480, valor: 7860000 }, { sentido: 'saida', resultado: 'sem_produto', itens: 12, valor: 18000 }],
    cfops_sem_regra: [{ sentido: 'entrada', cfop: '1252', itens: 18, valor: 81500, exemplo: 'ENERGIA ELETRICA' }, { sentido: 'entrada', cfop: '1910', itens: 8, valor: 9500, exemplo: 'BONIFICAÇÃO MB BRANCO' }], sem_local: [] });
  // espelho do Iniflex com linhas ainda sem produto (para a sugestão do código)
  const esp = [...(DB.estoque_espelhos || [])].sort((x, y) => y.data_ref.localeCompare(x.data_ref))[0];   // linhas novas no espelho mais recente
  if (esp) DB.estoque_espelho_itens = (DB.estoque_espelho_itens || []).concat([['MP0457', 'PEBD 2022N', 'KG', 18400], ['MP0460', 'PELBD 118W', 'KG', 32500], ['MP0471', 'PEAD HF0144', 'KG', 9100], ['AD0102', 'MB BRANCO 70% TIO2', 'KG', 1200]]
    .map(([codigo, descricao, unidade, quantidade]) => ({ id: id('ei'), empresa_id: E, espelho_id: esp.id, produto_id: null, codigo, descricao, deposito: 'ALMOX', unidade, quantidade })));
}

// Manutenção industrial (SQL 086) — equipamentos, planos, OS, horas e peças FICTÍCIOS (datas relativas a hoje)
{
  const agora = Date.now(), H = (h) => new Date(agora - h * 3600000).toISOString(), D0 = (d) => new Date(agora - d * 86400000).toISOString().slice(0, 10);
  const pm = DB.prod_maquinas, cc = (n) => DB.centros_custo.find(c => c.nome === n)?.id;
  DB.man_parametros = [{ empresa_id: E, custo_hora: 62.5, tolerancia_pct: 10, antecedencia_dias: 7, horas_dia: 24, abrir_os_pela_parada: true }];
  DB.man_equipamentos = [
    ...pm.map((m, i) => ({ id: 'me-' + (i + 1), empresa_id: E, codigo: m.codigo, nome: m.nome, tipo: 'maquina', maquina_id: m.id, setor_id: m.setor_id, centro_custo_id: cc(i === 3 ? 'CORTE E SOLDA' : 'EXTRUSÃO'), criticidade: i < 3 ? 'A' : 'B',
      local: DB.prod_setores.find(s => s.id === m.setor_id)?.nome, fabricante: ['CARNEVALLI', 'RULLI STANDARD', 'BOBST', 'MAQPLAS'][i], modelo: ['CHD 65', 'RS 70', 'F&K 20SIX', 'CS 800'][i], ano: [2016, 2019, 2021, 2014][i],
      situacao: i === 1 ? 'em_manutencao' : 'operando', bem_id: (DB.af_bens || [])[i]?.id || null })),
    { id: 'me-5', empresa_id: E, codigo: 'UT-COMP1', nome: 'COMPRESSOR DE PARAFUSO 40 HP', tipo: 'utilidade', criticidade: 'A', local: 'Casa de máquinas', fabricante: 'SCHULZ', modelo: 'SRP 4040', horimetro: 18420, horimetro_em: D0(3), situacao: 'operando', centro_custo_id: cc('EXTRUSÃO') },
    { id: 'me-6', empresa_id: E, codigo: 'UT-CHIL1', nome: 'CHILLER DE ÁGUA GELADA', tipo: 'utilidade', criticidade: 'B', local: 'Casa de máquinas', horimetro: 9310, horimetro_em: D0(10), situacao: 'operando' },
    { id: 'me-7', empresa_id: E, codigo: 'MV-EMP1', nome: 'EMPILHADEIRA ELÉTRICA 2,5 T', tipo: 'movimentacao', criticidade: 'C', local: 'Expedição', horimetro: 6120, horimetro_em: D0(5), situacao: 'operando' }];
  const HORAS = { 'me-1': 6480, 'me-2': 5210, 'me-3': 4390, 'me-4': 3820, 'me-5': 18420, 'me-6': 9310, 'me-7': 6120 };
  DB.man_falhas = [['MEC-01', 'Rolamento danificado', 'mecanica'], ['MEC-02', 'Correia rompida ou patinando', 'mecanica'], ['MEC-03', 'Vazamento de óleo no redutor', 'lubrificacao'], ['ELE-01', 'Resistência queimada', 'eletrica'],
    ['ELE-02', 'Termopar com defeito', 'instrumentacao'], ['ELE-03', 'Inversor de frequência em falha', 'eletronica'], ['PNE-01', 'Vazamento de ar comprimido', 'pneumatica'], ['HID-01', 'Bomba hidráulica sem pressão', 'hidraulica'],
    ['OPE-01', 'Ajuste incorreto pelo operador', 'operacional'], ['MEC-04', 'Faca de corte gasta', 'mecanica']].map(([codigo, nome, categoria], i) => ({ id: 'mf-' + (i + 1), empresa_id: E, codigo, nome, categoria, ativo: true }));
  DB.man_planos = [
    { id: 'mpl-1', equipamento_id: 'me-1', nome: 'Lubrificação do redutor e mancais', tipo: 'lubrificacao', a_cada_dias: 15, ultima_data: D0(18), checklist: ['Verificar nível de óleo do redutor', 'Engraxar mancais do puxador', 'Conferir vazamentos'], exige_parada: false },
    { id: 'mpl-2', equipamento_id: 'me-1', nome: 'Revisão das resistências e termopares', tipo: 'preventiva', a_cada_horas: 2000, ultima_horas: 4620, ultima_data: D0(80), checklist: ['Medir corrente de cada zona', 'Reapertar terminais', 'Testar termopares'], duracao_h: 4 },
    { id: 'mpl-3', equipamento_id: 'me-2', nome: 'Troca de correias do motor principal', tipo: 'preventiva', a_cada_horas: 3000, ultima_horas: 2400, ultima_data: D0(150), checklist: ['Trocar jogo de correias', 'Alinhar polias'] },
    { id: 'mpl-4', equipamento_id: 'me-3', nome: 'Limpeza e inspeção dos anilox', tipo: 'inspecao', a_cada_dias: 30, ultima_data: D0(12), checklist: ['Lavar anilox', 'Inspecionar células no microscópio', 'Registrar volume'] },
    { id: 'mpl-5', equipamento_id: 'me-5', nome: 'Troca de óleo e filtros do compressor', tipo: 'preventiva', a_cada_horas: 4000, ultima_horas: 14200, a_cada_dias: 180, ultima_data: D0(170), checklist: ['Trocar óleo', 'Trocar filtro de ar', 'Trocar separador', 'Drenar condensado'] },
    { id: 'mpl-6', equipamento_id: 'me-7', nome: 'Inspeção de segurança da empilhadeira', tipo: 'inspecao', a_cada_dias: 30, ultima_data: D0(20), checklist: ['Freios', 'Garfos e corrente', 'Bateria', 'Buzina e luzes'] }]
    .map(p => ({ empresa_id: E, a_cada_dias: null, a_cada_horas: null, ultima_horas: null, pecas: [], exige_parada: true, ativo: true, ...p }));
  if (!DB.produtos.some(p => p.codigo === 'PC-6205')) DB.produtos.push(...[['PC-6205', 'ROLAMENTO 6205 ZZ', 'PC'], ['PC-RES1', 'RESISTÊNCIA COLEIRA 1500W', 'PC'], ['PC-COR1', 'CORREIA B-62', 'PC'], ['PC-OLE1', 'ÓLEO REDUTOR ISO 220', 'L'], ['PC-FIL1', 'FILTRO DE AR COMPRESSOR', 'PC']]
    .map(([codigo, descricao, unidade]) => ({ id: 'pr-' + codigo, empresa_id: E, codigo, descricao, tipo: 'peca_manutencao', unidade, ativo: true, origem: 'manual' })));
  // OS: [equip, tipo, prio, situacao, descricao, horas atrás (abertura), duração h (parada), falha, solução, plano]
  const OS = [
    ['me-2', 'corretiva', 'emergencia', 'em_execucao', 'Motor principal desarmando com 15 min de operação', 5, null, 'ELE-03', null], ['me-3', 'corretiva', 'alta', 'aguardando_peca', 'Vazamento de óleo no redutor do desbobinador', 96, null, 'MEC-03', null],
    ['me-1', 'lubrificacao', 'media', 'aberta', 'Lubrificação do redutor e mancais', 30, null, null, null, 'mpl-1'], ['me-5', 'preventiva', 'media', 'programada', 'Troca de óleo e filtros do compressor', 50, null, null, null, 'mpl-5'],
    ['me-4', 'corretiva', 'media', 'solicitada', 'Solda falhando no lado esquerdo do saco', 2, null, null, null], ['me-7', 'corretiva', 'baixa', 'aberta', 'Buzina não funciona', 70, null, null, null],
    ['me-1', 'corretiva', 'emergencia', 'concluida', 'Zona 3 não aquece', 300, 6.5, 'ELE-01', 'Troca da resistência coleira da zona 3'], ['me-1', 'corretiva', 'alta', 'concluida', 'Barulho no mancal do puxador', 620, 3, 'MEC-01', 'Troca do rolamento 6205'],
    ['me-2', 'corretiva', 'alta', 'concluida', 'Correia patinando, perda de velocidade', 450, 4, 'MEC-02', 'Troca do jogo de correias B-62'], ['me-3', 'corretiva', 'media', 'concluida', 'Registro de cor saindo do lugar', 800, 1.5, 'OPE-01', 'Ajuste do registro e treinamento do operador'],
    ['me-2', 'corretiva', 'emergencia', 'concluida', 'Termopar da zona 2 marcando 0 °C', 1100, 5, 'ELE-02', 'Troca do termopar tipo J'], ['me-5', 'corretiva', 'alta', 'concluida', 'Pressão de ar caindo na linha', 900, 2.5, 'PNE-01', 'Reparo de vazamento na conexão'],
    ['me-4', 'corretiva', 'media', 'concluida', 'Faca não corta o filme', 1300, 2, 'MEC-04', 'Troca da faca de corte'], ['me-1', 'corretiva', 'alta', 'concluida', 'Resistência da zona 5 em curto', 1600, 7, 'ELE-01', 'Troca da resistência e do fusível'],
    ['me-1', 'lubrificacao', 'media', 'concluida', 'Lubrificação do redutor e mancais', 440, null, null, 'Feito conforme checklist', 'mpl-1'], ['me-3', 'inspecao', 'media', 'concluida', 'Limpeza e inspeção dos anilox', 290, null, null, 'Anilox 360 com 12% de entupimento', 'mpl-4'],
    ['me-7', 'inspecao', 'media', 'concluida', 'Inspeção de segurança da empilhadeira', 480, null, null, 'Sem ocorrências', 'mpl-6'], ['me-1', 'preventiva', 'media', 'concluida', 'Revisão das resistências e termopares', 1920, 4, null, 'Zonas 1 a 6 medidas, terminais reapertados', 'mpl-2'],
    ['me-6', 'corretiva', 'media', 'concluida', 'Chiller sem refrigerar', 700, null, 'HID-01', 'Limpeza do condensador'], ['me-2', 'melhoria', 'baixa', 'concluida', 'Instalar proteção na correia', 1000, null, null, 'Proteção instalada']];
  DB.man_ordens = OS.map(([eq, tipo, prioridade, situacao, descricao, ha, dur, fa, sol, plano], i) => {
    const conc = situacao === 'concluida', ab = H(ha), fim = conc ? H(ha - (dur || 3) - 1) : null, parou = dur != null || (situacao === 'em_execucao' && prioridade === 'emergencia');
    return { id: 'mo-' + (i + 1), empresa_id: E, numero: 101 + OS.length - i, equipamento_id: eq, tipo, prioridade, situacao, descricao, origem: plano ? 'plano' : i === 0 ? 'parada' : 'solicitacao', plano_id: plano || null,
      solicitante: ['ana.paula@exemplo.com.br', 'jose.carlos@exemplo.com.br'][i % 2], solicitada_em: ab, atualizado_em: situacao === 'aguardando_peca' ? H(90) : ab, responsavel: situacao === 'solicitada' ? null : ['Marcos Lima', 'Paulo Souza'][i % 2],
      inicio: conc || situacao === 'em_execucao' ? H(ha - 0.5) : null, fim, maquina_parou: parou, parada_inicio: parou ? ab : null, parada_fim: parou && conc ? H(ha - dur) : null,
      falha_id: fa ? DB.man_falhas.find(f => f.codigo === fa).id : null, causa: conc && fa ? 'Desgaste natural / fim de vida útil' : null, solucao: sol,
      vence_em: plano ? D0(Math.round(ha / 24) - 7) : null, programada_para: situacao === 'programada' ? D0(-2) : null, valor_terceiros: i === 11 ? 480 : i === 18 ? 1250 : 0, favorecido_id: null,
      checklist: plano ? DB.man_planos.find(p => p.id === plano).checklist.map((item, k) => ({ item, ok: conc ? true : k === 0 ? true : null, obs: null })) : [], concluida_por: conc ? 'marcos@exemplo.com.br' : null };
  });
  DB.man_os_horas = DB.man_ordens.filter(o => o.inicio).map((o, i) => ({ id: 9000 + i, empresa_id: E, ordem_id: o.id, tecnico: o.responsavel, data: o.inicio.slice(0, 10), horas: [3, 2, 4.5, 1.5, 5, 2, 2.5, 6, 1, 1.5, 1, 4, 2, 1][i % 14], custo_hora: 62.5, descricao: null }));
  const PC = [['mo-7', 'PC-RES1', 1, 386], ['mo-8', 'PC-6205', 2, 74], ['mo-9', 'PC-COR1', 4, 212], ['mo-14', 'PC-RES1', 1, 386], ['mo-15', 'PC-OLE1', 4, 168], ['mo-1', 'PC-6205', 1, 37]];
  DB.man_os_pecas = PC.map(([ordem_id, p, quantidade, custo], i) => ({ id: 'mop-' + i, empresa_id: E, ordem_id, produto_id: 'pr-' + p, quantidade, custo, movimento_id: i % 2 ? 'em-x' + i : null, situacao: 'consumida', criado_em: H(10) }));
  DB.man_leituras = [{ id: 1, empresa_id: E, equipamento_id: 'me-5', data: D0(3), horimetro: 18420 }, { id: 2, empresa_id: E, equipamento_id: 'me-5', data: D0(33), horimetro: 17910 }];
  DB.man_anexos = [{ id: 'man-a1', empresa_id: E, ordem_id: 'mo-2', caminho: 'x/vazamento.jpg', nome: 'vazamento-redutor.jpg', tipo: 'foto' }];
  Object.assign(window.RPC, {
    man_horas_maquina: (a) => HORAS[a.p_equipamento] ?? 0, man_gerar_preventivas: () => 2, man_configurar: () => ({ equipamentos: 0, falhas: 0 }),
    man_consumir_peca: () => 'mop-novo', man_estornar_peca: () => null,
  });
}

// Qualidade (SQL 087) — planos, amostragem, inspeções, RNC e bloqueios FICTÍCIOS (datas relativas a hoje)
{
  const agora = Date.now(), H = (h) => new Date(agora - h * 3600000).toISOString(), D0 = (d) => new Date(agora - d * 86400000).toISOString().slice(0, 10);
  const lc = (c) => DB.est_locais.find(l => l.codigo === c)?.id, P = (c) => DB.produtos.find(p => p.codigo === c), FV = (n) => DB.favorecidos.find(f => f.nome.startsWith(n))?.id;
  if (!lc('REP')) DB.est_locais.push({ id: 'el-rep', empresa_id: E, codigo: 'REP', nome: 'Reprovado (não conforme, aguardando disposição)', finalidade: 'quarentena', posse: 'propria', controla_saldo: true, compoe_custo: true, permite_negativo: false, papeis: null, ordem: 125, ativo: true });
  DB.qual_parametros = [{ empresa_id: E, inspecionar_recebimento: true, local_quarentena_id: lc('QUA'), local_reprovado_id: lc('REP'), prazo_horas: 24, papeis_decisao: ['admin', 'diretor', 'financeiro'], meta_aprovacao_pct: 95, prazo_rnc_dias: 15 }];
  DB.qual_amostragem = [[2, 8, 2], [9, 15, 3], [16, 25, 5], [26, 50, 8], [51, 90, 13], [91, 150, 20], [151, 280, 32], [281, 500, 50], [501, 1200, 80], [1201, 3200, 125], [3201, 10000, 200], [10001, 35000, 315], [35001, 150000, 500], [150001, 500000, 800], [500001, null, 1250]]
    .map(([lote_min, lote_max, amostra], i) => ({ id: 'qa-' + i, empresa_id: E, lote_min, lote_max, amostra, ac: 0, re: 1 }));
  const C = (nome, tipo, unidade, nominal, min, max, metodo, critica = false) => ({ nome, tipo, unidade, nominal, min, max, metodo, critica });
  DB.qual_planos = [
    { id: 'qp-1', nome: 'Recebimento de resina PEBD', etapa: 'recebimento', produto_id: P('MP-001').id, amostragem: 'fixa', amostra_fixa: 3, exige_laudo: true, instrucoes: 'Coletar 1 amostra a cada 10 sacos; conferir o laudo do lote (MFI e densidade) com a NF.',
      caracteristicas: [C('Índice de fluidez (MFI)', 'medida', 'g/10min', 2.0, 1.8, 2.2, 'plastômetro 190 °C / 2,16 kg', true), C('Densidade', 'medida', 'g/cm³', 0.922, 0.919, 0.925, 'coluna de gradiente'), C('Umidade', 'medida', '%', null, null, 0.05, 'termobalança'), C('Contaminação / pontos pretos', 'atributo', null, null, null, null, 'visual em 1 kg')] },
    { id: 'qp-2', nome: 'Recebimento de master branco', etapa: 'recebimento', produto_id: P('MP-002').id, amostragem: 'tabela', exige_laudo: true,
      caracteristicas: [C('Teor de TiO2', 'medida', '%', 70, 68, 72, 'calcinação'), C('Embalagem íntegra', 'atributo')] },
    { id: 'qp-3', nome: 'Liberação de setup — saco PEBD', etapa: 'processo', produto_id: P('PA-100').id, amostragem: 'fixa', amostra_fixa: 5, liberacao_primeira: true, instrucoes: 'Medir a espessura em 5 pontos da largura no primeiro metro da bobina; teste de solda com 3 sacos.',
      caracteristicas: [C('Espessura', 'medida', 'µm', 100, 95, 105, 'micrômetro', true), C('Largura', 'medida', 'mm', 400, 398, 402, 'trena'), C('Tratamento corona', 'medida', 'dyn/cm', 40, 38, null, 'caneta de dyna'), C('Solda', 'atributo', null, null, null, null, 'tração manual')] },
    { id: 'qp-4', nome: 'Inspeção final — saco PEBD', etapa: 'final', produto_id: P('PA-100').id, amostragem: 'tabela',
      caracteristicas: [C('Dimensões', 'atributo'), C('Impressão / registro', 'atributo'), C('Contagem por pacote', 'atributo')] }]
    .map(p => ({ empresa_id: E, familia_id: null, setor_id: null, amostra_fixa: null, exige_laudo: false, liberacao_primeira: false, instrucoes: null, ativo: true, criado_em: H(2000), ...p }));
  // lote novo na quarentena (NF de resina recebida hoje)
  const lq = { id: 'lt-q1', empresa_id: E, produto_id: P('MP-001').id, codigo: 'NF55188-1', lote_fornecedor: 'BRK 7911', origem: 'compra', bloqueado: false };
  const lb = DB.est_lotes.find(l => l.codigo === 'L-2610-02'); if (lb) Object.assign(lb, { bloqueado: true, bloqueio_motivo: 'Reclamação de cliente: gel no filme (RNC 4)' });
  DB.est_lotes.push(lq);
  DB.est_saldos.push({ id: 'ss-q1', empresa_id: E, produto_id: lq.produto_id, local_id: lc('QUA'), lote_id: lq.id, quantidade: 12500, valor: 146875, ultimo_movimento: D0(0) },
    { id: 'ss-q2', empresa_id: E, produto_id: P('MP-002').id, local_id: lc('QUA'), lote_id: null, quantidade: 600, valor: 12480, ultimo_movimento: D0(1) },
    { id: 'ss-r1', empresa_id: E, produto_id: P('MP-001').id, local_id: lc('REP'), lote_id: null, quantidade: 500, valor: 5875, ultimo_movimento: D0(9) });
  const ops = DB.prod_ordens || [], op1 = ops[0]?.id, op2 = ops[1]?.id;
  const R = (vals) => Object.entries(vals).map(([nome, v]) => Array.isArray(v) ? { nome, valores: v } : { nome, defeitos: v });
  const resina = (mfi, d, u, cont) => R({ 'Índice de fluidez (MFI)': mfi, Densidade: d, Umidade: u, 'Contaminação / pontos pretos': cont });
  const IN = [ // [etapa, origem, plano, produto, qtd, un, situacao, horas atrás, fornecedor, resultados, motivo, ref]
    ['recebimento', 'nfe', 'qp-1', 'MP-001', 12500, 'KG', 'pendente', 3, 'RESINAS', [], null, 'NF 55188 · RESINAS DO BRASIL S.A.', { movimento_id: 'mv-q1', local_destino_id: lc('MP'), lote_id: lq.id }],
    ['recebimento', 'nfe', 'qp-2', 'MP-002', 600, 'KG', 'em_inspecao', 30, 'EMBALAGENS', R({ 'Teor de TiO2': [70.4, 69.8], 'Embalagem íntegra': 0 }), null, 'NF 3321 · EMBALAGENS PRIMAVERA LTDA', { movimento_id: 'mv-q2', local_destino_id: lc('MP'), laudo_ok: false }],
    ['processo', 'liberacao', 'qp-3', 'PA-100', 118, 'KG', 'pendente', 1, null, [], null, null, { ordem_id: op1, lote_texto: 'B1204-001', prazo: new Date(agora + 3600000).toISOString() }],
    ['recebimento', 'nfe', 'qp-1', 'MP-001', 12000, 'KG', 'aprovada', 700, 'RESINAS', resina([2.01, 1.98, 2.05], [0.921, 0.922, 0.922], [0.02, 0.03, 0.02], 0), null, 'NF 55031 · RESINAS DO BRASIL S.A.', { laudo_ok: true }],
    ['recebimento', 'nfe', 'qp-1', 'MP-001', 10000, 'KG', 'aprovada', 450, 'RESINAS', resina([1.95, 2.0, 1.97], [0.920, 0.921, 0.921], [0.03, 0.03, 0.04], 0), null, 'NF 55102 · RESINAS DO BRASIL S.A.', { laudo_ok: true }],
    ['recebimento', 'nfe', 'qp-1', 'MP-001', 5000, 'KG', 'aprovada_concessao', 220, 'RESINAS', resina([2.18, 2.24, 2.21], [0.922, 0.923, 0.922], [0.04, 0.05, 0.04], 0), 'MFI 2,24 numa amostra; aprovado para a linha de sacos grossos (e-mail do PCP)', 'NF 55150 · RESINAS DO BRASIL S.A.', { laudo_ok: true, qtd_aprovada: 5000, qtd_reprovada: 0 }],
    ['recebimento', 'nfe', 'qp-1', 'MP-001', 2500, 'KG', 'reprovada', 216, 'RESINAS', resina([2.6, 2.7, 2.65], [0.922, 0.922, 0.923], [0.12, 0.10, 0.11], 2), 'MFI 2,7 (máx. 2,2) e umidade 0,12% (máx. 0,05%)', 'NF 55161 · RESINAS DO BRASIL S.A.', { laudo_ok: false, qtd_aprovada: 2000, qtd_reprovada: 500 }],
    ['recebimento', 'nfe', 'qp-2', 'MP-002', 1200, 'KG', 'aprovada', 520, 'EMBALAGENS', R({ 'Teor de TiO2': [70.1, 70.3, 69.9], 'Embalagem íntegra': 0 }), null, 'NF 3290 · EMBALAGENS PRIMAVERA LTDA', { laudo_ok: true }],
    ['recebimento', 'nfe', 'qp-2', 'MP-002', 800, 'KG', 'reprovada', 330, 'EMBALAGENS', R({ 'Teor de TiO2': [66.2, 66.8, 67.0], 'Embalagem íntegra': 1 }), 'TiO2 66% (mín. 68%) e um saco rasgado', 'NF 3305 · EMBALAGENS PRIMAVERA LTDA', { laudo_ok: true, qtd_aprovada: 0, qtd_reprovada: 800 }],
    ['processo', 'liberacao', 'qp-3', 'PA-100', 120, 'KG', 'aprovada', 300, null, R({ Espessura: [99, 101, 100, 102, 98], Largura: [400, 401], 'Tratamento corona': [42], Solda: 0 }), null, null, { ordem_id: op2, lote_texto: 'B1205-001' }],
    ['processo', 'liberacao', 'qp-3', 'PA-100', 115, 'KG', 'reprovada', 160, null, R({ Espessura: [91, 93, 92, 96, 94], Largura: [400, 400], 'Tratamento corona': [36], Solda: 1 }), 'Espessura 91 µm (mín. 95) e corona 36 dyn — reajustar a matriz', null, { ordem_id: op1, lote_texto: 'B1204-000' }],
    ['processo', 'liberacao', 'qp-3', 'PA-100', 122, 'KG', 'aprovada', 150, null, R({ Espessura: [100, 101, 99, 100, 102], Largura: [401, 400], 'Tratamento corona': [41], Solda: 0 }), null, null, { ordem_id: op1, lote_texto: 'B1204-000B' }],
    ['final', 'op', 'qp-4', 'PA-100', 1800, 'KG', 'aprovada', 240, null, R({ Dimensões: 0, 'Impressão / registro': 0, 'Contagem por pacote': 0 }), null, null, { ordem_id: ops[3]?.id }],
    ['final', 'op', 'qp-4', 'PA-100', 4800, 'KG', 'aprovada', 90, null, R({ Dimensões: 0, 'Impressão / registro': 1, 'Contagem por pacote': 0 }), null, null, { ordem_id: op2 }]];
  DB.qual_inspecoes = IN.map(([etapa, origem, plano_id, cod, quantidade, unidade, situacao, ha, forn, resultados, motivo, ref, extra], k) => {
    const dec = ['aprovada', 'aprovada_concessao', 'reprovada'].includes(situacao), am = plano_id === 'qp-1' ? [3, 0, 1] : plano_id === 'qp-3' ? [5, 0, 1] : plano_id === 'qp-2' ? [quantidade > 1200 ? 125 : 80, 1, 2] : [125, 1, 2];
    return { id: 'qi-' + (k + 1), empresa_id: E, numero: 40 + IN.length - k, etapa, origem, plano_id, produto_id: P(cod).id, quantidade, unidade, amostra: am[0], ac: am[1], re: am[2], situacao, resultados,
      defeitos: 0, fornecedor_id: forn ? FV(forn) : null, observacao: ref, motivo, criado_em: H(ha), atualizado_em: H(ha - 2), prazo: H(ha - 24), inspetor: situacao === 'pendente' ? null : 'Carla Mendes',
      inspecionada_em: situacao === 'pendente' ? null : H(ha - 2), decidida_em: dec ? H(ha - 3) : null, decidida_por: dec ? 'renata@exemplo.com.br' : null,
      qtd_aprovada: dec ? (situacao === 'reprovada' ? 0 : quantidade) : null, qtd_reprovada: dec ? (situacao === 'reprovada' ? quantidade : 0) : null, laudo_ok: null, lote_id: null, movimento_id: null, local_destino_id: null, ...extra };
  });
  DB.qual_inspecoes[0].prazo = new Date(agora + 21 * 3600000).toISOString();
  DB.qual_inspecoes[1].prazo = H(6);
  const RN = [
    ['fornecedor', 'qi-7', 'MP-001', 'RESINAS', 'Inspeção 34 reprovada: MFI 2,7 (máx. 2,2) e umidade 0,12% (máx. 0,05%)', 500, 'alta', 'devolver_fornecedor', null, 'acao', 210, 0,
      ['Resina chegou úmida', 'Sacos armazenados ao tempo no fornecedor', 'Falta de cobertura no pátio do distribuidor'], 'Armazenagem do distribuidor sem proteção', 'Exigir laudo de umidade por lote e inspeção do pátio do distribuidor', 'Marcos (Compras)', 4],
    ['fornecedor', 'qi-9', 'MP-002', 'EMBALAGENS', 'Inspeção 32 reprovada: TiO2 66% (mín. 68%) e um saco rasgado', 800, 'media', 'devolver_fornecedor', H(300), 'verificacao', 335, 380,
      ['Teor de TiO2 abaixo', 'Lote produzido com outra carga mineral'], 'Troca de matéria-prima no fornecedor sem aviso', 'Fornecedor passou a enviar o laudo com o teor por lote', 'Marcos (Compras)', -5],
    ['processo', 'qi-11', 'PA-100', null, 'Liberação reprovada: espessura 91 µm (mín. 95) e corona 36 dyn', 115, 'media', 'reclassificar', H(158), 'encerrada', 162, 120,
      ['Espessura baixa no setup', 'Matriz descentralizada', 'Parafuso de centragem frouxo'], 'Parafuso de centragem da matriz frouxo', 'Incluir o reaperto da matriz no checklist de setup', 'Paulo (Extrusão)', -2, 'eficaz'],
    ['cliente', null, 'PA-100', 'SUPERMERCADOS', 'Cliente reclamou de gel (pontos duros) no saco 40x60 da NF 9026', 320, 'alta', 'pendente', null, 'em_analise', 48, 0, [], null, null, 'Carla (Qualidade)', 10]];
  DB.qual_rnc = RN.map(([origem, insp, cod, forn, descricao, quantidade, gravidade, disposicao, exec, situacao, ha, custo, porques, causa, acao_corretiva, responsavel, prazoDias, eficacia], k) => ({
    id: 'qr-' + (k + 1), empresa_id: E, numero: k + 1, origem, inspecao_id: insp, produto_id: P(cod).id, favorecido_id: forn ? FV(forn) : null, descricao, quantidade, unidade: 'KG', gravidade, disposicao,
    disposicao_executada_em: exec, situacao, aberta_em: H(ha), aberta_por: 'carla@exemplo.com.br', custo, porques, causa, acao_corretiva, responsavel, prazo: D0(-prazoDias), eficacia: eficacia || null,
    acao_imediata: k === 3 ? 'Lote L-2610-02 bloqueado; inspeção 100% do estoque do produto' : 'Material segregado no local Reprovado', encerrada_em: situacao === 'encerrada' ? H(30) : null }));
  DB.prod_bobinas = (DB.prod_bobinas || []).concat([
    { id: 'pb-q1', empresa_id: E, codigo: 'B1204-001', ordem_id: op1, peso_kg: 118, situacao: 'estoque', qualidade: 'bloqueada', qual_inspecao_id: 'qi-3', criado_em: H(1) },
    { id: 'pb-q2', empresa_id: E, codigo: 'B1204-002', ordem_id: op1, peso_kg: 121, situacao: 'estoque', qualidade: 'bloqueada', qual_inspecao_id: 'qi-3', criado_em: H(0.5) },
    { id: 'pb-q3', empresa_id: E, codigo: 'B1198-014', ordem_id: op2, peso_kg: 96, situacao: 'estoque', qualidade: 'bloqueada', qual_inspecao_id: null, criado_em: H(50) }]);
  DB.qual_bloqueios = [
    { id: 1, empresa_id: E, tipo: 'lote', lote_id: lb?.id, acao: 'bloqueio', motivo: 'Reclamação de cliente: gel no filme (RNC 4)', usuario: 'carla@exemplo.com.br', criado_em: H(47) },
    { id: 2, empresa_id: E, tipo: 'bobina', bobina_id: 'pb-q3', acao: 'bloqueio', motivo: 'Suspeita de solda fraca (mesma OP da reclamação)', usuario: 'carla@exemplo.com.br', criado_em: H(46) },
    { id: 3, empresa_id: E, tipo: 'bobina', bobina_id: null, acao: 'liberacao', motivo: 'Inspeção 30', usuario: 'renata@exemplo.com.br', criado_em: H(147) },
    { id: 4, empresa_id: E, tipo: 'bobina', bobina_id: null, acao: 'reprovacao', motivo: 'Inspeção 30', usuario: 'renata@exemplo.com.br', criado_em: H(157) }];
  DB.qual_anexos = [{ id: 'qx-1', empresa_id: E, inspecao_id: 'qi-1', caminho: 'x/laudo.pdf', nome: 'laudo-BRK7911.pdf', tipo: 'laudo', criado_em: H(2) }];
  Object.assign(window.RPC, { qual_decidir: (a) => ({ situacao: a.p_decisao, rnc_id: a.p_decisao === 'reprovada' ? 'qr-x' : null }), qual_dispor: () => 'executada', qual_bloquear: () => 'bloqueado',
    qual_gerar_recebimento: () => 0, qual_configurar: () => ({ faixas: 0 }) });
}

// Casa de Tintas (SQL 088) — insumos, cores, receitas, ordens, pesagens e sobras FICTÍCIOS (datas relativas a hoje)
{
  const agora = Date.now(), H = (h) => new Date(agora - h * 3600000).toISOString(), D0 = (d) => new Date(agora - d * 86400000).toISOString().slice(0, 10);
  const lc = (c) => DB.est_locais.find(l => l.codigo === c)?.id, fam = DB.est_familias.find(f => f.codigo === 'TINTA');
  if (!lc('TIN')) DB.est_locais.push({ id: 'el-tin', empresa_id: E, codigo: 'TIN', nome: 'Casa de tintas (tinta pronta e sobras)', finalidade: 'processo', posse: 'propria', controla_saldo: true, compoe_custo: true, permite_negativo: false, papeis: null, ordem: 40, ativo: true });
  const INS = [['TB-AZ', 'TINTA BASE AZUL NC', 21.4], ['TB-VM', 'TINTA BASE VERMELHA NC', 23.9], ['TB-BR', 'TINTA BASE BRANCA TIO2 NC', 18.2], ['PG-AZ', 'PIGMENTO CONCENTRADO AZUL 15:3', 58.0], ['PG-VM', 'PIGMENTO CONCENTRADO VERMELHO 57:1', 64.5],
    ['PG-PT', 'PIGMENTO CONCENTRADO PRETO', 41.0], ['VZ-NC', 'VERNIZ NITROCELULOSE', 16.8], ['SV-AC', 'SOLVENTE ACETATO DE ETILA', 7.9], ['SV-AL', 'SOLVENTE ÁLCOOL ETÍLICO', 5.6], ['RT-01', 'RETARDADOR', 12.3]];
  for (const [codigo, descricao] of INS) if (!DB.produtos.some(p => p.codigo === codigo)) DB.produtos.push({ id: 'pr-' + codigo, empresa_id: E, codigo, descricao, tipo: 'tinta_solvente', unidade: 'KG', ativo: true, origem: 'manual', familia_id: fam?.id, local_padrao_id: lc('INS'), controla_lote: false });
  const tp = (c, n) => ({ id: 'pr-TP-' + c, empresa_id: E, codigo: 'TP-' + c, descricao: 'TINTA PRONTA ' + n, tipo: 'tinta_solvente', unidade: 'KG', ativo: true, origem: 'manual', familia_id: fam?.id, local_padrao_id: lc('TIN'), controla_lote: true });
  DB.produtos.push(tp('AZ286', 'AZUL 286'), tp('VM485', 'VERMELHO 485'), tp('BR01', 'BRANCO OPACO'));
  DB.est_custos = (DB.est_custos || []).concat(INS.map(([c, , cu]) => ({ produto_id: 'pr-' + c, empresa_id: E, quantidade: 400, valor: 400 * cu, custo_medio: cu })));
  DB.tin_parametros = [{ empresa_id: E, local_tinta_id: lc('TIN'), local_insumos_id: lc('INS'), local_maquina_id: lc('PROC-2'), tolerancia_pct: 2, validade_dias: 30, criar_produto: true, papeis_aprovacao: ['admin', 'diretor', 'financeiro'], balanca_baud: 9600 }];
  DB.tin_sistemas = [['Solvente — nitrocelulose', 'Flexografia de superfície em PE'], ['Solvente — poliuretano', 'Laminação e verso'], ['Base água', 'Papel e baixo odor'], ['UV', 'Cura por ultravioleta']].map(([nome, descricao], i) => ({ id: 'ts-' + i, empresa_id: E, nome, descricao, ativo: true }));
  const FV = (n) => DB.favorecidos.find(f => f.nome.startsWith(n))?.id;
  DB.tin_cores = [
    { id: 'tc-1', codigo: 'AZ286', nome: 'AZUL 286', padrao: 'pantone', referencia: 'Pantone 286 C', lab_l: 26.5, lab_a: 21.4, lab_b: -63.9, hex: '#0033A0', produto_id: 'pr-TP-AZ286' },
    { id: 'tc-2', codigo: 'VM485', nome: 'VERMELHO 485', padrao: 'pantone', referencia: 'Pantone 485 C', lab_l: 48.6, lab_a: 66.9, lab_b: 51.3, hex: '#DA291C', produto_id: 'pr-TP-VM485' },
    { id: 'tc-3', codigo: 'BR01', nome: 'BRANCO OPACO', padrao: 'instrumental', referencia: 'Opacidade ≥ 60%', lab_l: 94.8, lab_a: -0.6, lab_b: 1.9, hex: '#F4F4F2', produto_id: 'pr-TP-BR01' },
    { id: 'tc-4', codigo: 'VD-SBC', nome: 'VERDE SUPERMERCADO', padrao: 'cliente', referencia: 'Padrão físico aprovado pelo cliente em 12/10', lab_l: 50.2, lab_a: -48.1, lab_b: 22.6, hex: '#00843D', favorecido_id: FV('SUPERMERCADOS') }]
    .map(c => ({ empresa_id: E, sistema_id: 'ts-0', favorecido_id: null, ativo: true, criado_em: H(3000), ...c }));
  DB.tin_receitas = [['tr-1', 'tc-1', 'R-AZ286', 'Azul 286 — superfície PE'], ['tr-2', 'tc-2', 'R-VM485', 'Vermelho 485 — superfície PE'], ['tr-3', 'tc-3', 'R-BR01', 'Branco opaco — fundo'], ['tr-4', 'tc-4', 'R-VDSBC', 'Verde do supermercado']]
    .map(([id, cor_id, codigo, nome]) => ({ id, empresa_id: E, cor_id, codigo, nome, aplicacao: 'superficie', substrato: 'PE', ativo: true, criado_em: H(3000) }));
  const VE = [['tv-1', 'tr-1', 1, 'obsoleta', 'Primeira versão', 2600], ['tv-2', 'tr-1', 2, 'aprovada', 'Mais pigmento: tom pedido pelo cliente', 900], ['tv-3', 'tr-1', 3, 'em_teste', 'Teste com retardador para o verão', 30],
    ['tv-4', 'tr-2', 1, 'aprovada', 'Primeira versão', 1800], ['tv-5', 'tr-3', 1, 'aprovada', 'Primeira versão', 2000], ['tv-6', 'tr-4', 1, 'rascunho', 'Desenvolvimento para o cliente', 20]];
  DB.tin_versoes = VE.map(([id, receita_id, numero, situacao, motivo, ha]) => ({ id, empresa_id: E, receita_id, numero, situacao, motivo, base_kg: 100, viscosidade_alvo: receita_id === 'tr-3' ? 24 : 22, viscosidade_tol: 2,
    viscosidade_metodo: 'Copo Zahn nº 2 (s)', densidade_alvo: null, densidade_tol: null, delta_e_max: receita_id === 'tr-3' ? 2 : 1.5, criado_em: H(ha), aprovada_em: ['aprovada', 'obsoleta'].includes(situacao) ? H(ha - 20) : null, aprovada_por: ['aprovada', 'obsoleta'].includes(situacao) ? 'renata@exemplo.com.br' : null }));
  const IT = { 'tv-1': [['TB-AZ', 64, 'base'], ['PG-AZ', 20, 'pigmento'], ['SV-AC', 16, 'solvente']], 'tv-2': [['TB-AZ', 58, 'base'], ['PG-AZ', 24, 'pigmento'], ['VZ-NC', 4, 'verniz'], ['SV-AC', 14, 'solvente']],
    'tv-3': [['TB-AZ', 58, 'base'], ['PG-AZ', 24, 'pigmento'], ['VZ-NC', 4, 'verniz'], ['SV-AC', 11, 'solvente'], ['RT-01', 3, 'retardador']], 'tv-4': [['TB-VM', 62, 'base'], ['PG-VM', 22, 'pigmento'], ['SV-AC', 12, 'solvente'], ['SV-AL', 4, 'solvente']],
    'tv-5': [['TB-BR', 80, 'base'], ['VZ-NC', 8, 'verniz'], ['SV-AC', 12, 'solvente']], 'tv-6': [['TB-AZ', 30, 'base'], ['PG-AZ', 6, 'pigmento'], ['TB-BR', 20, 'base'], ['SV-AC', 14, 'solvente']] };
  DB.tin_itens = Object.entries(IT).flatMap(([versao_id, L]) => L.map(([c, quantidade, funcao], k) => ({ id: `ti-${versao_id}-${k}`, empresa_id: E, versao_id, seq: k + 1, produto_id: 'pr-' + c, quantidade, funcao, tolerancia_pct: funcao === 'pigmento' ? 1 : null,
    instrucao: funcao === 'pigmento' ? 'adicionar devagar, com o agitador ligado' : funcao === 'solvente' ? 'ajustar a viscosidade no final' : null })));
  const cus = Object.fromEntries(INS.map(([c, , cu]) => ['pr-' + c, cu])), ops = DB.prod_ordens || [];
  const OR = [ // [versão, kg, situação, horas atrás, OP, pesagens: fator por item (1 = no previsto; null = falta), medições [visc, ΔE]]
    ['tv-2', 40, 'em_pesagem', 1.5, 0, [1.004, 1.035, null, null], []], ['tv-4', 25, 'em_ajuste', 3, 1, [1, 1, 1, 1], [[26.4, 1.1]]],
    ['tv-5', 60, 'aprovada', 6, 0, [1, 1, 1], [[23.6, 0.9]]], ['tv-2', 35, 'entregue', 26, 0, [1.01, 0.995, 1, 1.02], [[22.8, 0.7]]],
    ['tv-2', 30, 'encerrada', 120, 1, [1, 1, 1, 1], [[24.9, 1.9], [22.2, 1.2]]], ['tv-4', 20, 'encerrada', 200, 1, [1.005, 1, 1, 1], [[21.4, 0.8]]],
    ['tv-5', 50, 'encerrada', 260, 2, [0.998, 1, 1.01], [[24.3, 1.3]]], ['tv-2', 30, 'encerrada', 400, 0, [1, 1.012, 1, 1], [[22.5, 0.6]]], ['tv-4', 25, 'encerrada', 500, 3, [1, 0.99, 1, 1], [[23.1, 1.7], [22.0, 1.0]]]];
  DB.tin_ordens = []; DB.tin_pesagens = []; DB.tin_medicoes = [];
  OR.forEach(([versao_id, qtd, situacao, ha, opi, fat, med], k) => {
    const id = 'to-' + (k + 1), v = DB.tin_versoes.find(x => x.id === versao_id), its = DB.tin_itens.filter(i => i.versao_id === versao_id), apr = ['aprovada', 'entregue', 'encerrada'].includes(situacao);
    let tot = 0, cu = 0;
    its.forEach((it, j) => { const f = fat[j]; if (f == null) return; const prev = Math.round(it.quantidade * qtd / 100 * 1000) / 1000, pes = Math.round(prev * f * 1000) / 1000, c = Math.round(pes * cus[it.produto_id] * 100) / 100;
      tot += pes; cu += c; DB.tin_pesagens.push({ id: `tp-${k}-${j}`, empresa_id: E, ordem_id: id, item_id: it.id, produto_id: it.produto_id, prevista: prev, pesada: pes, desvio_pct: Math.round((pes - prev) / prev * 10000) / 100,
        fora_tolerancia: (f - 1) * 100 > (it.tolerancia_pct ?? 2) + 0.001, justificativa: (f - 1) * 100 > (it.tolerancia_pct ?? 2) + 0.001 ? 'Passou na adição do pigmento' : null, ajuste: false, custo: c, balanca: j % 2 === 0, situacao: 'pesada', operador: 'jose@exemplo.com.br', criado_em: H(ha - 0.2 - j * 0.1) }); });
    if (med.length > 1) { const pes = Math.round(qtd * 0.02 * 1000) / 1000, c = Math.round(pes * cus['pr-SV-AC'] * 100) / 100; tot += pes; cu += c;
      DB.tin_pesagens.push({ id: `tp-${k}-aj`, empresa_id: E, ordem_id: id, item_id: null, produto_id: 'pr-SV-AC', prevista: null, pesada: pes, desvio_pct: null, fora_tolerancia: false, justificativa: 'Viscosidade alta: mais solvente', ajuste: true, custo: c, situacao: 'pesada', criado_em: H(ha - 0.8) }); }
    med.forEach(([vi, de], j) => DB.tin_medicoes.push({ id: 900 + k * 10 + j, empresa_id: E, ordem_id: id, viscosidade: vi, delta_e: de, temperatura: 24, ok: Math.abs(vi - v.viscosidade_alvo) <= 2 && de <= v.delta_e_max, criado_em: H(ha - 0.6 - j * 0.3) }));
    const cor = DB.tin_cores.find(c => c.id === DB.tin_receitas.find(r => r.id === v.receita_id).cor_id);
    DB.tin_ordens.push({ id, empresa_id: E, numero: 60 + OR.length - k, versao_id, cor_id: cor.id, quantidade: qtd, ordem_id: ops[opi]?.id || null, situacao, quantidade_real: Math.round(tot * 1000) / 1000,
      custo_total: apr ? Math.round(cu * 100) / 100 : null, custo_kg: apr && tot ? Math.round(cu / tot * 10000) / 10000 : null, lote_codigo: apr ? `T2611-${String(60 + OR.length - k).padStart(4, '0')}` : null,
      validade: apr ? D0(Math.round(ha / 24) - 30) : null, entregue_kg: situacao === 'entregue' ? 28 : situacao === 'encerrada' ? Math.round(tot * 0.85) : 0, retorno_kg: situacao === 'encerrada' ? Math.round(tot * 0.1 * 10) / 10 : 0,
      aprovada_em: apr ? H(ha - 1) : null, aprovada_por: apr ? 'renata@exemplo.com.br' : null, concessao: k === 8 ? 'ΔE 1,7 aceito para o fundo da embalagem' : null, responsavel: 'José (tinteiro)', criado_em: H(ha), atualizado_em: H(ha - 0.5) });
  });
  // sobras na casa de tintas (lotes da tinta pronta)
  const SB = [['pr-TP-AZ286', 'T2611-0064', 12.5, 24], ['pr-TP-VM485', 'T2610-0057', 6.0, -3], ['pr-TP-BR01', 'T2610-0059', 18.0, 18], ['pr-TP-BR01', 'T2611-0067', 60.0, 30], ['pr-TP-AZ286', 'T2610-0054', 3.5, 2]];
  SB.forEach(([produto_id, codigo, q, dias], i) => { DB.est_lotes.push({ id: 'lt-tn' + i, empresa_id: E, produto_id, codigo, origem: 'producao', validade: D0(-dias), fabricacao: D0(-dias + 30) });
    DB.est_saldos.push({ id: 'ss-tn' + i, empresa_id: E, produto_id, local_id: lc('TIN'), lote_id: 'lt-tn' + i, quantidade: q, valor: Math.round(q * 27.3 * 100) / 100, ultimo_movimento: D0(1) }); });
  Object.assign(window.RPC, { tin_pesar: () => ({ estoque: true }), tin_reescalar: (a) => a.p_quantidade, tin_aprovar_ordem: () => ({ lote: 'T2611-0069', estoque: true }), tin_movimentar: (a) => a.p_tipo,
    tin_aprovar_versao: () => 'aprovada', tin_nova_versao: () => 'tv-x', tin_estornar_pesagem: () => null, tin_configurar: () => ({ sistemas: 0 }) });
}

// Pré-impressão (SQL 089) — clientes, embalagens, versões, pinos, decisões e clicheria FICTÍCIOS (marcas inventadas; datas relativas a hoje)
{
  const agora = Date.now(), H = (h) => new Date(agora - h * 3600000).toISOString(), D0 = (d) => new Date(agora - d * 86400000).toISOString().slice(0, 10);
  const hx = (n) => Array.from({ length: 64 }, (_, i) => '0123456789abcdef'[(n * 7 + i * 13 + (i * i) % 11) % 16]).join('');
  const CL = [['fv-vd', 'VILA DOCE ALIMENTOS LTDA', '12345678000195'], ['fv-sa', 'TORREFAÇÃO SERRA AZUL LTDA', '23456789000106'], ['fv-pv', 'POMAR DO VALE SUCOS LTDA', '34567890000117'], ['fv-pt', 'PATINHAS PET FOODS LTDA', '45678901000128']];
  for (const [id, nome, documento] of CL) DB.favorecidos.push({ id, empresa_id: E, tipo: 'CLIENTES', nome, documento, ativo: true, tipo_pessoa: 'J', municipio: 'RECIFE', uf: 'PE' });
  DB.favorecidos.push({ id: 'fv-cl', empresa_id: E, tipo: 'FORNECEDORES', nome: 'CLICHERIA GRAVAFLEX LTDA', documento: '56789012000139', ativo: true, tipo_pessoa: 'J', municipio: 'RECIFE', uf: 'PE' });
  const PRD = [['pr-bisc', 'EMB-BISC-200', 'EMBALAGEM BISCOITO MARIA 200G BOPP'], ['pr-cafe', 'EMB-CAFE-500', 'EMBALAGEM CAFÉ 500G LAMINADO PET/PE'], ['pr-suco', 'ROT-SUCO-1L', 'RÓTULO SUCO LARANJA 1L BOPP'], ['pr-racao', 'EMB-RAC-1K', 'EMBALAGEM RAÇÃO 1KG PE'], ['pr-choc', 'EMB-BISC-CHOC', 'EMBALAGEM BISCOITO CHOCOLATE 200G'], ['pr-c250', 'EMB-CAFE-250', 'EMBALAGEM CAFÉ 250G LAMINADO'], ['pr-uva', 'ROT-SUCO-UVA', 'RÓTULO SUCO UVA 1L']];
  for (const [id, codigo, descricao] of PRD) DB.produtos.push({ id, empresa_id: E, codigo, descricao, tipo: 'produto_acabado', unidade: 'KG', ativo: true, origem: 'manual' });
  DB.prod_ordens.push({ id: 'op-cafe', empresa_id: E, numero: 1210, origem: 'plataforma', produto_id: 'pr-cafe', codigo_produto: 'EMB-CAFE-500', descricao: 'EMBALAGEM CAFÉ 500G LAMINADO PET/PE', quantidade: 2200, unidade: 'KG', favorecido_id: 'fv-sa', cliente: 'TORREFAÇÃO SERRA AZUL LTDA', entrega: D0(-6), prioridade: 2, status: 'planejada', criado_em: H(120) },
    { id: 'op-bisc', empresa_id: E, numero: 1211, origem: 'plataforma', produto_id: 'pr-bisc', codigo_produto: 'EMB-BISC-200', descricao: 'EMBALAGEM BISCOITO MARIA 200G BOPP', quantidade: 3500, unidade: 'KG', favorecido_id: 'fv-vd', cliente: 'VILA DOCE ALIMENTOS LTDA', entrega: D0(-10), prioridade: 3, status: 'planejada', criado_em: H(60) });
  DB.tin_cores = DB.tin_cores || [];
  const cor = (pantone, hex) => ({ nome: pantone, pantone, hex, tin_cor_id: null });
  const CK = ['Textos e ortografia revisados', 'Dimensões, passo e sangria conferidos', 'Cores conferidas com o padrão (Pantone / cliente)', 'Código de barras válido e com contraste', 'Informações legais (CNPJ, lote, validade, símbolo de reciclagem)', 'Registro, trapping e espessura mínima de linha', 'Posição de desbobinamento definida'];
  DB.pre_parametros = [{ empresa_id: E, checklist: CK, exigir_checklist: true, prazo_cliente_dias: 3, bloquear_op: true, papeis_liberacao: ['admin', 'diretor', 'financeiro'],
    termo: 'Declaro que conferi esta arte — textos, ortografia, cores, dimensões, código de barras e informações legais — e autorizo a confecção dos clichês e a impressão. Alterações depois desta aprovação geram nova arte e podem gerar custo.' }];
  const PJ = [
    // id, nº, cliente, produto, OP, nome, código, situação, horas desde criação, cores, ean, desb, prazo(dias), extra
    ['pa-1', 41, 'fv-vd', 'pr-bisc', 'op-bisc', 'Biscoito Crocantíssimo Maria 200 g', 'VD-MAR-200', 'aguardando_cliente', 110, [cor('Pantone 186 C', '#c8102e'), cor('Pantone 7406 C', '#f1c400'), cor('Pantone 1395 C', '#996017'), cor('Preto', '#1d1d1b')], '7899123450129', 1, -2, {}],
    ['pa-2', 40, 'fv-sa', 'pr-cafe', 'op-cafe', 'Café Serra Azul Extraforte 500 g', 'SA-EXT-500', 'aguardando_cliente', 170, [cor('Pantone 289 C', '#0c2340'), cor('Pantone 7404 C', '#f6d55c'), cor('Pantone 7621 C', '#ab2328'), cor('Branco', '#ffffff')], '7899123450297', 4, 2, {}],
    ['pa-3', 39, 'fv-pv', 'pr-suco', null, 'Suco Pomar do Vale Laranja 1 L', 'PV-LAR-1L', 'aprovada', 220, [cor('Pantone 1505 C', '#ff6900'), cor('Pantone 362 C', '#509e2f'), cor('Preto', '#1d1d1b')], '7899123450365', 3, null, {}],
    ['pa-4', 37, 'fv-pt', 'pr-racao', null, 'Ração Patinhas Cães Adultos 1 kg', 'PT-AD-1K', 'na_clicheria', 330, [cor('Pantone 355 C', '#009639'), cor('Pantone 109 C', '#ffd100'), cor('Branco', '#ffffff')], '7899123450433', 2, null, { clicheria_id: 'fv-cl', cliche_enviado_em: D0(3), cliche_previsto: D0(-1), cliche_custo: 2840, cliche_qtd: 3 }],
    ['pa-5', 42, 'fv-vd', 'pr-choc', null, 'Biscoito Vila Doce Chocolate 200 g', 'VD-CHO-200', 'em_criacao', 20, [cor('Pantone 4625 C', '#4f2c1d'), cor('Pantone 186 C', '#c8102e')], null, 1, null, { responsavel: 'Lucas (arte-final)' }],
    ['pa-6', 35, 'fv-sa', 'pr-c250', null, 'Café Serra Azul Tradicional 250 g', 'SA-TRA-250', 'liberada', 600, [cor('Pantone 289 C', '#0c2340'), cor('Pantone 7404 C', '#f6d55c')], '7899123450501', 4, null, { liberada_em: H(110), liberada_por: 'renata@exemplo.com.br', clicheria_id: 'fv-cl', cliche_enviado_em: D0(12), cliche_recebido_em: D0(6), cliche_custo: 1960, cliche_qtd: 2, ferramenta_id: 'pf-cl35' }],
    ['pa-7', 38, 'fv-pv', 'pr-uva', null, 'Suco Pomar do Vale Uva 1 L', 'PV-UVA-1L', 'alteracao_solicitada', 260, [cor('Pantone 2627 C', '#4b1e5b'), cor('Pantone 362 C', '#509e2f')], '7899123450372', 3, null, {}],
  ];
  DB.pre_projetos = PJ.map(([id, numero, favorecido_id, produto_id, ordem_id, nome, codigo_cliente, situacao, ha, cores, ean, desbobinamento, pz, x]) => ({ id, empresa_id: E, numero, favorecido_id, produto_id, ordem_id, nome, codigo_cliente,
    tipo: id === 'pa-6' ? 'reimpressao' : id === 'pa-1' ? 'alteracao' : 'nova', largura_mm: 250, altura_mm: 175, substrato: id === 'pa-2' || id === 'pa-6' ? 'PET 12 µm + PE 60 µm' : id === 'pa-4' ? 'PE 80 µm' : 'BOPP 20 µm',
    processo: id === 'pa-2' || id === 'pa-6' ? 'laminacao' : 'superficie', cores, ean, desbobinamento, responsavel: x.responsavel || 'Lucas (arte-final)', prazo: pz == null ? null : D0(-pz) < D0(0) ? D0(-pz) : D0(-pz),
    situacao, versao_aprovada_id: null, arquivado: false, criado_por: 'renata@exemplo.com.br', criado_em: H(ha), atualizado_em: H(Math.max(2, ha / 4)), ...x }));
  DB.pre_projetos.find(p => p.id === 'pa-2').prazo = D0(1);
  DB.pre_projetos.find(p => p.id === 'pa-1').prazo = D0(-2);
  DB.pre_projetos.find(p => p.id === 'pa-7').atualizado_em = H(76);
  DB.prod_ferramentas = (DB.prod_ferramentas || []).concat([{ id: 'pf-cl35', empresa_id: E, tipo: 'cliche', codigo: 'CL-0035-V1', descricao: 'Clichê Café Serra Azul Tradicional 250 g', produto_id: 'pr-c250', favorecido_id: 'fv-sa', cores: 2, localizacao: 'Pré-impressão', situacao: 'ativa', metros_usados: 0 }]);
  const pre = (a) => `emp1/${a}`;
  const VS = [
    // id, projeto, nº, arquivo svg, origem, enviada (h atrás) ou null, obs, horas criação
    ['pv-1a', 'pa-1', 1, 'biscoito-v1.svg', 'interno', 98, 'Primeira proposta, a partir da arte da linha anterior', 100],
    ['pv-1b', 'pa-1', 2, 'biscoito-v2.svg', 'interno', 20, 'Nome “Maria Tradicional”, selo “Nova receita” e tabela nutricional da nova receita', 22],
    ['pv-2a', 'pa-2', 1, 'cafe-v1.svg', 'interno', 100, null, 150],
    ['pv-3a', 'pa-3', 1, 'suco-v1.svg', 'cliente', null, 'Arte final da nossa agência', 210],
    ['pv-3b', 'pa-3', 2, 'suco-v1.svg', 'interno', 120, 'Arte do cliente com sangria, trapping e registro da impressora', 150],
    ['pv-4a', 'pa-4', 1, 'racao-v1.svg', 'interno', 300, null, 320], ['pv-4b', 'pa-4', 2, 'racao-v1.svg', 'interno', 200, 'Tabela de níveis de garantia corrigida', 210],
    ['pv-5a', 'pa-5', 1, 'biscoito-v1.svg', 'interno', null, 'Base da linha Maria, trocando as cores', 6],
    ['pv-6a', 'pa-6', 1, 'cafe-v1.svg', 'interno', 560, 'Reimpressão sem mudança', 580],
    ['pv-7a', 'pa-7', 1, 'suco-v1.svg', 'interno', 150, null, 240],
  ];
  DB.pre_versoes = VS.map(([id, projeto_id, numero, svg, origem, env, observacao, ha], k) => ({ id, empresa_id: E, projeto_id, numero, caminho: pre(`${projeto_id}/${svg.replace('.svg', '.pdf')}`), nome: `${projeto_id === 'pa-3' && numero === 1 ? 'suco-laranja-agencia' : DB.pre_projetos.find(p => p.id === projeto_id).codigo_cliente.toLowerCase()}-v${numero}.pdf`,
    tipo: 'application/pdf', tamanho: 1800000 + k * 210000, hash: hx(k + 3), previa: pre(`${projeto_id}/${svg}`), previa_largura: 1500, previa_altura: 1050, paginas: 1, mm_largura: 250, mm_altura: 175.2, observacao, origem,
    checklist: CK.map((item, i) => ({ item, ok: id === 'pv-5a' ? i < 4 : true })), enviada_em: env == null ? null : H(env), enviado_por: origem === 'cliente' ? 'compras@pomardovale.exemplo' : 'lucas@exemplo.com.br', criado_em: H(ha) }));
  const ap = { 'pa-3': 'pv-3b', 'pa-4': 'pv-4b', 'pa-6': 'pv-6a' };
  for (const [p, v] of Object.entries(ap)) DB.pre_projetos.find(x => x.id === p).versao_aprovada_id = v;
  const dec = (id, projeto_id, versao_id, decisao, nome, email, h, comentario = null, origem = 'cliente', evidencia = null) => ({ id, empresa_id: E, projeto_id, versao_id, decisao, nome, email, origem, comentario, evidencia,
    termo: decisao === 'aprovada' ? DB.pre_parametros[0].termo : null, hash: DB.pre_versoes.find(v => v.id === versao_id).hash, ip: origem === 'cliente' ? '177.10.20.30' : null,
    navegador: origem === 'cliente' ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130' : null, criado_em: H(h) });
  DB.pre_decisoes = [
    dec('pd-1', 'pa-1', 'pv-1a', 'alteracao', null, 'marketing@viladoce.exemplo', 70, 'Ver os pontos marcados.'),
    dec('pd-2', 'pa-3', 'pv-3b', 'aprovada', 'Ana Paula Ribeiro', 'compras@pomardovale.exemplo', 52),
    dec('pd-3', 'pa-4', 'pv-4a', 'alteracao', null, 'qualidade@patinhas.exemplo', 260, 'Proteína bruta é 21%, não 23%.'),
    dec('pd-4', 'pa-4', 'pv-4b', 'aprovada', 'Marcos Antônio Lima', 'qualidade@patinhas.exemplo', 160),
    dec('pd-5', 'pa-6', 'pv-6a', 'aprovada', 'Carla Menezes', 'carla@serraazul.exemplo', 540, null, 'interno', 'E-mail de carla@serraazul.exemplo em 01/11, 09:42: "Pode seguir com a reimpressão igual à anterior."'),
    dec('pd-6', 'pa-7', 'pv-7a', 'alteracao', null, 'compras@pomardovale.exemplo', 76, 'O roxo está muito escuro; usar o Pantone 2627 do manual da marca.'),
  ];
  const com = (id, versao_id, x, y, texto, origem, autor, h, interno = false, resolvido = false) => ({ id, empresa_id: E, versao_id, x, y, texto, origem, autor, criado_em: H(h), interno, resolvido });
  DB.pre_comentarios = [
    com('pc-1', 'pv-1a', 0.722, 0.29, 'Trocar “Maria” por “Maria Tradicional”, como no novo manual da linha.', 'cliente', 'marketing@viladoce.exemplo', 71, false, true),
    com('pc-2', 'pv-1a', 0.86, 0.45, 'Incluir o selo “Nova receita” aqui, em amarelo.', 'cliente', 'marketing@viladoce.exemplo', 71, false, true),
    com('pc-3', 'pv-1a', 0.33, 0.36, 'A tabela nutricional é da receita antiga — usar a ficha técnica nova (enviada por e-mail).', 'cliente', 'marketing@viladoce.exemplo', 70.5, false, true),
    com('pc-4', 'pv-1a', null, null, 'Recebida a ficha técnica nova da receita; ajustar a tabela e o selo.', 'interno', 'lucas@exemplo.com.br', 68, true, true),
    com('pc-5', 'pv-1b', 0.86, 0.47, 'Selo “Nova receita” aplicado conforme o pedido.', 'interno', 'lucas@exemplo.com.br', 21),
    com('pc-6', 'pv-1b', 0.2, 0.56, 'Trapping de 0,15 mm no vermelho sobre o amarelo — conferir no primeiro material.', 'interno', 'lucas@exemplo.com.br', 21, true),
    com('pc-7', 'pv-7a', 0.25, 0.2, 'O roxo está muito escuro; usar o Pantone 2627 do manual da marca.', 'cliente', 'compras@pomardovale.exemplo', 77),
  ];
  const ev = (projeto_id, h, texto, publico = true, autor = 'lucas@exemplo.com.br') => ({ id: Math.round(Math.random() * 1e9), empresa_id: E, projeto_id, tipo: 'x', texto, publico, autor, criado_em: H(h) });
  DB.pre_eventos = [ev('pa-1', 110, 'Arte criada: Biscoito Crocantíssimo Maria 200 g', true, 'renata@exemplo.com.br'), ev('pa-1', 100, 'Versão 1 criada: Primeira proposta', false), ev('pa-1', 98, 'Versão 1 enviada para aprovação'),
    ev('pa-1', 70, 'Alteração pedida na versão 1: Ver os pontos marcados.', true, 'marketing@viladoce.exemplo'), ev('pa-1', 22, 'Versão 2 criada: Nome “Maria Tradicional”, selo “Nova receita” e tabela nutricional', false), ev('pa-1', 20, 'Versão 2 enviada para aprovação'),
    ev('pa-3', 210, 'Versão 1 enviada pelo cliente: Arte final da nossa agência', true, 'compras@pomardovale.exemplo'), ev('pa-3', 120, 'Versão 2 enviada para aprovação'), ev('pa-3', 52, 'Versão 2 APROVADA por Ana Paula Ribeiro', true, 'compras@pomardovale.exemplo'),
    ev('pa-4', 160, 'Versão 2 APROVADA por Marcos Antônio Lima'), ev('pa-4', 72, 'Arte enviada para a clicheria'),
    ev('pa-2', 100, 'Versão 1 enviada para aprovação')];
  Object.assign(window.RPC, {
    pre_enviar_cliente: () => 'aguardando_cliente', pre_registrar_decisao: () => ({ situacao: 'aprovada' }), pre_clicheria: (a) => a.p_acao, pre_liberar: () => 'liberada',
    pre_arte_produto: (a) => { const p = DB.pre_projetos.filter(x => x.produto_id === a.p_produto).at(-1); return p ? [{ projeto_id: p.id, numero: p.numero, situacao: p.situacao, versao: DB.pre_versoes.find(v => v.id === p.versao_aprovada_id)?.numero, ok: ['aprovada', 'na_clicheria', 'liberada'].includes(p.situacao) }] : []; },
    // Portal do Cliente (a figura do portal entra como o comprador da VILA DOCE)
    portal_aceitar_convites: () => null,
    portal_meus_clientes: () => [{ empresa_id: E, empresa: 'IPLAMM (exemplo)', favorecido_id: 'fv-vd', cliente: 'VILA DOCE ALIMENTOS LTDA', documento: '12.345.678/0001-95' }],
    portal_artes: (a) => DB.pre_projetos.filter(p => p.favorecido_id === a.p_fav && p.situacao !== 'cancelada').map(p => { const v = DB.pre_versoes.filter(x => x.projeto_id === p.id && (x.enviada_em || x.origem === 'cliente')).at(-1);
      return v && { id: p.id, numero: p.numero, nome: p.nome, codigo_cliente: p.codigo_cliente, situacao: p.situacao, versao: v.numero, versao_id: v.id, enviada_em: v.enviada_em, prazo: p.prazo, pendente: p.situacao === 'aguardando_cliente', atualizado_em: p.atualizado_em }; }).filter(Boolean)
      .concat(a.p_fav === 'fv-vd' ? [{ id: 'pa-x1', numero: 33, nome: 'Biscoito Crocantíssimo Leite 200 g', codigo_cliente: 'VD-LEI-200', situacao: 'liberada', versao: 2, versao_id: 'pv-x1', prazo: null, pendente: false }] : []),
    portal_arte: (a) => { const p = DB.pre_projetos.find(x => x.id === a.p_projeto); const Vs = DB.pre_versoes.filter(v => v.projeto_id === p.id && (v.enviada_em || v.origem === 'cliente'));
      return { projeto: p, termo: DB.pre_parametros[0].termo, versoes: Vs, comentarios: DB.pre_comentarios.filter(c => !c.interno && Vs.some(v => v.id === c.versao_id)).map(c => ({ ...c, autor: c.origem === 'cliente' ? c.autor : 'Equipe' })),
        decisoes: DB.pre_decisoes.filter(d => d.projeto_id === p.id), eventos: DB.pre_eventos.filter(e => e.projeto_id === p.id && e.publico) }; },
    portal_arte_comentar: () => 'pc-x', portal_arte_decidir: () => ({ situacao: 'aprovada' }), portal_arte_enviar: () => 'pv-x',
  });
}

// Avisos (SQL 090) — catálogo e últimos avisos FICTÍCIOS
{
  const agora = Date.now(), H = (h) => new Date(agora - h * 3600000).toISOString();
  DB.notif_tipos = [['paraquedas', 'Pagamentos', 'Pagamentos antecipados', 'Novo pedido para autorizar, autorizado, recusado, pago, comprovante.', false, 10], ['nd_pendente', 'Financeiro', 'Notas de débito a emitir', 'Juros e multa recebidos que pedem nota de débito.', false, 20],
    ['prorrogacao', 'Financeiro', 'Prorrogação pedida pelo cliente', 'Cliente pediu prorrogação de vencimento no Portal.', false, 25], ['bordero', 'Crédito / FIDC', 'Borderôs', 'Proposta de borderô aguardando aprovação e a decisão.', false, 30],
    ['decisao_dia', 'Painéis', 'Decisão do dia', 'Decisão do dia aguardando aprovação e a resposta.', false, 40], ['arte', 'Pré-impressão', 'Resposta do cliente na arte', 'Aprovação, pedido de alteração, comentário ou arquivo enviado pelo cliente no Portal.', false, 50],
    ['os_urgente', 'Manutenção', 'Máquina parada / OS de emergência', 'OS aberta com prioridade de emergência ou com a máquina parada. Passa pelo horário de silêncio.', true, 60], ['chat', 'Comunicação', 'Mensagens nas Conversas', 'Nova mensagem (respeita o silenciar de cada conversa).', false, 70],
    ['teste', 'Sistema', 'Aviso de teste', 'O aviso que você manda para conferir o celular.', false, 99]].map(([codigo, grupo, nome, descricao, urgente, ordem]) => ({ codigo, grupo, nome, descricao, urgente, ordem }));
  DB.notif_preferencias = [{ user_id: 'u1', empresa_id: E, tipo: 'chat', push: false, email: false }];
  DB.notif_horarios = [{ user_id: 'u1', empresa_id: E, silencio: true, inicio: '20:00', fim: '07:00', fim_de_semana: true, fuso: 'America/Sao_Paulo' }];
  DB.notificacoes = (DB.notificacoes || []).concat([
    ['os_urgente', 'MÁQUINA PARADA · OS 118 — EXT-02 Extrusora 2', 'enviado', true, 3], ['arte_decisao', 'Arte nº 39 APROVADA pelo cliente', 'enviado', false, 52],
    ['prorrogacao_nova', 'Prorrogação pedida: SUPERMERCADOS BOA COMPRA LTDA', 'enviado', false, 70], ['chat', 'Nova mensagem de Marcos Vendas', 'desligado', false, 75],
    ['bordero_pendente', 'Borderô nº 52 aguardando aprovação', 'sem_aparelho', false, 96]].map(([tipo, titulo, push_situacao, urgente, h], i) => ({ id: 'nt-' + i, empresa_id: E, user_id: 'u1', tipo, titulo, corpo: '', link: '', urgente, push_situacao, enviado_em: H(h - 0.01), criado_em: H(h), lida_em: H(h - 1) })));
  window.RPC.notif_teste = () => null;
}

// Minhas aprovações (SQL 091) — lista FICTÍCIA juntando os módulos
{
  const agora = Date.now(), H = (h) => new Date(agora - h * 3600000).toISOString(), D0 = (d) => new Date(agora + d * 86400000).toISOString().slice(0, 10);
  window.RPC.minhas_aprovacoes = () => [
    ['pa', 'ap1', 214, 'POSTO SERTÃO LTDA', 'Combustível da viagem a Petrolina', 1850, 5, 0, true, '#/paraquedas', true],
    ['pa', 'ap2', 215, 'JOSÉ CARLOS DA SILVA', 'Diária de montagem da extrusora', 420, 3, 1, false, '#/paraquedas', true],
    ['pedido', 'ap3', 388, 'RESINAS DO BRASIL S.A.', '28/42 dias', 48600, 20, 4, false, '#/compras/pedidos', true],
    ['requisicao', 'ap4', 91, 'Requisição de Manutenção', 'Rolamentos 6205 para a EXT-02', null, 26, 2, true, '#/compras/requisicoes', true],
    ['bordero', 'ap5', 52, 'Borderô — Negocial', '18 título(s) · líquido R$ 176.420,00', 184300, 30, 0, false, '#/fidc-propostas', true],
    ['prorrogacao', 'ap6', null, 'SUPERMERCADOS BOA COMPRA LTDA', 'NF 18.211 · de 10/11 para 25/11 · fluxo apertado na Black Friday', 12480, 70, 3, false, '#/portal-clientes', true],
    ['reajuste', 'ap7', 12, 'Reajuste — Aluguel do galpão 2', 'IGP-M 4,12% · de R$ 18.000,00 para R$ 18.741,60', 18741.6, 50, 20, false, '#/contratos', true],
    ['receita', 'ap8', 2, 'R-VM485 — Vermelho 485 — superfície PE', 'Versão 2 em teste · pigmento 57:1 de outro fornecedor', null, 96, null, false, '#/tintas/receitas', true],
    ['arte', 'ap9', 39, 'Suco Pomar do Vale Laranja 1 L', 'POMAR DO VALE SUCOS LTDA · aprovada pelo cliente', null, 52, null, false, '#/preimpressao/artes', true],
    ['inspecao', 'ap10', 127, 'Inspeção recebimento — RESINA PEBD LINEAR', 'lote RB-2611-07', null, 8, 0, false, '#/qualidade/inspecoes', false],
    ['pagamento', 'au2', 42, 'Autorização nº 42 — 2 título(s) na sua alçada', 'De R$ 5 mil a R$ 50 mil · ENERGIA REGIONAL S.A., IMÓVEIS CENTRO LTDA', 21250, 40, 4, false, '#/autorizacao', true],
  ].map(([tipo, id, numero, titulo, detalhe, valor, h, pz, urgente, link, lote]) => ({ tipo, id, numero, titulo, detalhe, valor, desde: H(h), prazo: pz == null ? null : D0(pz), urgente, link, lote }));
}

// E-mail da plataforma (SQL 092) — configuração e fila FICTÍCIAS (envio ainda desligado, aguardando o domínio)
{
  const agora = Date.now(), H = (h) => new Date(agora - h * 3600000).toISOString();
  DB.email_config = [{ empresa_id: E, ativo: false, remetente_nome: 'IPLAMM', remetente_email: 'avisos@iplamm.com.br', responder_para: 'financeiro@iplamm.com.br', url_base: 'https://exemplo.github.io/fluxo-caixa-saas/', rodape: 'Mensagem automática da plataforma IPLAMM. Dúvidas: responda a este e-mail.' }];
  DB.email_modelos = [];
  window.RPC.email_padrao = () => [
    ['portal_convite', 'Convite para o Portal do Cliente', 'Convite para o Portal do Cliente — {{empresa}}', 'Olá,\n\n{{empresa}} liberou para {{cliente}} o acesso ao Portal do Cliente. Nele você vê os títulos e as notas fiscais, pede prorrogação de vencimento e aprova as artes das embalagens.\n\nClique no botão para criar a sua senha. O convite vale até {{validade}}.', 'Criar meu acesso', 'empresa, cliente, validade'],
    ['arte_aprovacao', 'Arte aguardando a aprovação do cliente', 'Arte nº {{numero}} aguardando a sua aprovação — {{arte}}', 'Olá,\n\nA versão {{versao}} da arte {{arte}} está pronta para a sua conferência.\n\n{{observacao}}\n\nConfira textos, cores, medidas e o código de barras. No Portal você pode marcar pontos na arte, aprovar ou pedir alteração. Responda até {{prazo}}.', 'Conferir a arte', 'empresa, cliente, arte, numero, versao, observacao, prazo'],
    ['prorrogacao_resposta', 'Resposta do pedido de prorrogação', 'Pedido de prorrogação {{decisao}} — {{documento}}', 'Olá,\n\nO seu pedido de prorrogação do título {{documento}} foi {{decisao}}. O vencimento é {{vencimento}}.\n\n{{resposta}}', 'Abrir o Portal', 'empresa, cliente, documento, decisao, vencimento, resposta'],
    ['aviso', 'Avisos da plataforma (Meus avisos)', '{{titulo}}', '{{texto}}', 'Abrir na plataforma', 'empresa, titulo, texto'],
    ['teste', 'E-mail de teste', 'E-mail de teste — {{empresa}}', 'Olá {{nome}},\n\nSe você recebeu esta mensagem, o e-mail da plataforma está funcionando.', null, 'empresa, nome'],
  ].map(([codigo, nome, assunto, corpo, botao, campos]) => ({ codigo, nome, assunto, corpo, botao, campos }));
  DB.email_fila = [
    ['arte_aprovacao', 'marketing@viladoce.exemplo', { empresa: 'PLÁSTICOS EXEMPLO', arte: 'Biscoito Crocantíssimo Maria 200 g', numero: 41, versao: 2 }, 'pendente', null, 20],
    ['portal_convite', 'compras@serraazul.exemplo', { empresa: 'PLÁSTICOS EXEMPLO', cliente: 'TORREFAÇÃO SERRA AZUL LTDA' }, 'pendente', null, 26],
    ['prorrogacao_resposta', 'financeiro@boacompra.exemplo', { empresa: 'PLÁSTICOS EXEMPLO', documento: 'NF 18.211', decisao: 'APROVADA' }, 'pendente', null, 30],
    ['aviso', 'renata@exemplo.com.br', { empresa: 'PLÁSTICOS EXEMPLO', titulo: 'MÁQUINA PARADA · OS 118 — EXT-02 Extrusora 2' }, 'pendente', null, 3],
  ].map(([codigo, para, campos, situacao, erro, h], i) => ({ id: 'ef-' + i, empresa_id: E, codigo, para, campos, situacao, erro, criado_em: H(h) }));
  window.RPC.email_teste = () => 'ef-t';
}

// Recompras FIDC (SQL 093 e 094: motivos) — lista, pendências, motivos e painel FICTÍCIOS
{
  const D0 = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  const MOT = [
    ['inadimplencia', 'Inadimplência', 'O cliente não pagou ao fundo: o título volta para a carteira, em aberto, até o cliente pagar.', 'reabrir', false, false, false, false, 'receita_bruta', '(−) Títulos recomprados por inadimplência', 'plano'],
    ['devolucao', 'Devolução de mercadoria', 'O cliente devolveu a mercadoria (total ou parcial): o título não volta, ou volta só o saldo não devolvido. A dedução da receita vem da nota de devolução.', 'baixar', true, true, false, false, 'receita_bruta', '(−) Recompras por devolução de mercadoria', 'conta'],
    ['substituicao', 'Substituição de título', 'A nota teve erro ou foi trocada: outro título foi cedido no lugar e o primeiro entra como recompra.', 'substituir', false, false, true, false, 'receita_bruta', '(−) Títulos substituídos no fundo', 'cliente'],
    ['abatimento', 'Abatimento ou desconto ao cliente', 'Foi concedido abatimento ou desconto: volta para a carteira só o valor que o cliente ainda vai pagar.', 'reabrir', true, false, false, true, 'receita_bruta', '(−) Abatimentos e descontos concedidos', 'plano'],
    ['pago_empresa', 'Cliente pagou à empresa', 'O cliente pagou direto à empresa em vez de pagar ao fundo: a recompra é o repasse e o recebimento fica vinculado.', 'recebido', false, false, false, false, 'receita_bruta', '(−) Repasses ao fundo de títulos pagos à empresa', 'plano'],
    ['prorrogacao', 'Prorrogação ou renegociação', 'O vencimento foi prorrogado ou o título renegociado com o cliente: volta em aberto com o vencimento novo.', 'reabrir', false, false, false, false, 'receita_bruta', '(−) Títulos recomprados para prorrogação', 'plano'],
    ['erro_fundo', 'Erro do fundo ou duplicidade', 'Débito indevido do fundo (erro ou duplicidade), que será devolvido: o título não volta para a carteira.', 'nenhum', false, false, false, true, 'fora', null, 'plano'],
    ['outros', 'Outros', 'Qualquer outro caso: descreva na observação.', 'reabrir', true, false, false, true, 'receita_bruta', '(−) Outras recompras de títulos', 'plano'],
  ];
  DB.fidc_recompra_motivos = MOT.map(([codigo, nome, descricao, titulo_acao, permite_parcial, exige_nota, exige_substituto, exige_obs, dre_secao, dre_rotulo, contab_modo], i) => ({
    id: 'mo-' + codigo, empresa_id: E, codigo, nome, descricao, titulo_acao, permite_parcial, exige_nota, exige_substituto, exige_obs, dre_secao, dre_rotulo, contab_modo,
    contab_conta_id: contab_modo === 'conta' ? 'ct-dev' : null, ativo: true, ordem: i + 1 }));
  DB.contab_contas = (DB.contab_contas || []).concat([{ id: 'ct-dev', empresa_id: E, classificacao: '4.1.2.1.0001', descricao: 'DEVOLUÇÕES DE VENDAS', tipo: 'A', natureza: 'D', nivel: 5 }]);
  const MO = (c) => DB.fidc_recompra_motivos.find(m => m.codigo === c);
  const R = (numero, mot, data, fundo, documento, cliente, valor_titulo, valor_recompra, conta, st, venc, rec, rconta, extra = {}) => ({ id: 'rc' + numero, numero, data: D0(data), fundo, documento, cliente, valor_titulo, valor_recompra,
    encargos: Math.max(0, Math.round((valor_recompra - valor_titulo) * 100) / 100), conta, vinculada: false, cancelada: false, lancamento_id: 'l' + numero, lanc_reaberto_id: st ? 'lr' + numero : null,
    reaberto_status: st, reaberto_venc: venc == null ? null : D0(venc), recebido_em: rec == null ? null : D0(rec), recebido_conta: rconta,
    motivo_id: MO(mot).id, motivo_nome: MO(mot).nome, motivo_codigo: mot, titulo_acao: MO(mot).titulo_acao, valor_reaberto: st ? valor_titulo : null, ...extra });
  window.RPC.fidc_recompras_lista = () => [
    R(8, 'devolucao', -1, 'FS', '1-38420/1', 'DISTRIBUIDORA NORDESTE LTDA', 6240, 6240, 'FS FIDC', 'Em aberto', 28, null, null, { valor_reaberto: 1560, nota_numero: 9187, rnc_numero: 42, observacao: 'Devolução de 3 de 4 bobinas: impressão fora do padrão' }),
    R(7, 'substituicao', -4, 'Negocial', '1-38302/1', 'FARMÁCIAS SAÚDE MAIS LTDA', 3920, 3920, 'NEGOCIAL', null, null, null, null, { titulo_novo_doc: '1-38355/1' }),
    R(6, 'inadimplencia', -2, 'Negocial', '1-38110/2', 'SUPERMERCADOS BOA COMPRA LTDA', 8420.5, 8611.3, 'NEGOCIAL', 'Em aberto', 12, null, null),
    R(5, 'inadimplencia', -18, 'FS', '1-37602/1', 'ATACADO SERTÃO LTDA', 5310, 5434.88, 'FS FIDC', 'Em aberto', -6, null, null),
    R(4, 'prorrogacao', -25, 'Negocial', '1-37040/3', 'DISTRIBUIDORA NORDESTE LTDA', 12750, 12988.4, 'NEGOCIAL', 'Pago', null, -9, 'UNICRED PRINCIPAL'),
    R(3, 'abatimento', -60, 'Contato', '1-36211/1', 'FARMÁCIAS SAÚDE MAIS LTDA', 2980, 3041.2, 'BRADESCO', 'Pago', null, -40, 'BRADESCO', { valor_reaberto: 2680, observacao: 'Abatimento de 300,00 acordado pelo comercial' }),
    R(1, 'pago_empresa', -170, 'Negocial', '1-34724/1', 'MASTERCOLA (EXEMPLO)', 3186.08, 3256.17, 'NEGOCIAL', 'Pago', null, -117, 'VEXPENSES', { vinculada: true }),
  ];
  window.RPC.fidc_recompras_pendentes = () => [
    { origem: 'fundo', id: 'q1', data: D0(-3), fundo: 'FS', documento: '38544-001', valor: 4185.9, cliente: 'ATACADO SERTÃO LTDA', sugestao_id: 'c1', sugestao_doc: '1-38544/1', sugestao_valor: 4102 },
    { origem: 'manual', id: 'm1', data: D0(-12), fundo: 'Negocial', documento: 'DOCTO REC 37811/1 NEGOCIAL FIDC', valor: 6640.12, cliente: null, sugestao_id: 'c2', sugestao_doc: '1-37811/1', sugestao_valor: 6512 },
  ];
  window.RPC.fidc_cedidos_busca = () => [
    { id: 'c1', data: D0(-40), documento: '1-38544/1', cliente: 'ATACADO SERTÃO LTDA', valor: 4102, fundo: 'FS', conta: 'FS FIDC', vencimento: D0(-4), favorecido_id: 'fv-x' },
    { id: 'c3', data: D0(-40), documento: '1-38544/2', cliente: 'ATACADO SERTÃO LTDA', valor: 4102, fundo: 'FS', conta: 'FS FIDC', vencimento: D0(26), favorecido_id: 'fv-x' },
  ];
  window.RPC.fidc_recompra_notas = () => [
    { id: 'nd1', numero: 9214, emissao: D0(-2), parte: 'ATACADO SERTÃO LTDA', valor: 3076.5, finalidade: '4', do_cliente: true },
    { id: 'nd2', numero: 9187, emissao: D0(-6), parte: 'DISTRIBUIDORA NORDESTE LTDA', valor: 4680, finalidade: '4', do_cliente: false },
  ];
  window.RPC.fidc_recompras_resumo = () => ({ cedido: 486300, recomprado: 42806.58, encargos: 873.4,
    motivos: [['inadimplencia', 13730.5, 2], ['prorrogacao', 12750, 1], ['devolucao', 6240, 1], ['substituicao', 3920, 1], ['pago_empresa', 3186.08, 1], ['abatimento', 2980, 1]]
      .map(([c, valor, qtd]) => ({ id: MO(c).id, nome: MO(c).nome, codigo: c, valor, qtd, encargos: 0 })),
    fundos: [{ fundo: 'Negocial', cedido: 251400, recomprado: 28276.58, qtd: 4 }, { fundo: 'FS', cedido: 168900, recomprado: 11550, qtd: 2 }, { fundo: 'Contato', cedido: 66000, recomprado: 2980, qtd: 1 }],
    clientes: [['DISTRIBUIDORA NORDESTE LTDA', 118400, 18990, 'Devolução de mercadoria, Prorrogação ou renegociação'], ['SUPERMERCADOS BOA COMPRA LTDA', 142300, 8420.5, 'Inadimplência'],
      ['FARMÁCIAS SAÚDE MAIS LTDA', 52800, 6900, 'Abatimento ou desconto ao cliente, Substituição de título'], ['ATACADO SERTÃO LTDA', 96500, 5310, 'Inadimplência'], ['MASTERCOLA (EXEMPLO)', 40200, 3186.08, 'Cliente pagou à empresa']]
      .map(([cliente, cedido, recomprado, motivos], i) => ({ favorecido_id: 'fx' + i, cliente, cedido, recomprado, qtd: 1, motivos })) });
  DB.fidc_recompra_config = [{ empresa_id: E, prazo_dias: 0, limite_taxa_cliente: 10 }];
  // DRE Gerencial: recompras por motivo (só acrescenta as linhas; a classe das despesas financeiras não é mexida no exemplo)
  window.RPC.fidc_recompras_dre = (a) => +a.p_ano !== 2026 ? [] : [[8, 'inadimplencia', -5310], [9, 'abatimento', -2980], [10, 'prorrogacao', -12750], [10, 'inadimplencia', -8420.5], [11, 'devolucao', -6240], [11, 'substituicao', -3920], [11, 'erro_fundo', -1180]]
    .map(([mes, c, total]) => ({ motivo_id: MO(c).id, motivo: MO(c).nome, dre_secao: MO(c).dre_secao, dre_rotulo: MO(c).dre_rotulo, classe_id: null, mes, total, qtd: 1 }));
}

// Regras de classificação, rateios e recorrentes (SQL 096) — FICTÍCIOS
{
  const CC = (n) => DB.centros_custo.find(c => c.nome.startsWith(n)).id;
  DB.cc_rateios = [
    { id: 'rt1', empresa_id: E, nome: 'Energia elétrica', partes: [{ centro_custo_id: CC('EXTRUSÃO'), pct: 60 }, { centro_custo_id: CC('CORTE'), pct: 30 }, { centro_custo_id: CC('ADMIN'), pct: 10 }], ativo: true },
    { id: 'rt2', empresa_id: E, nome: 'Aluguel do galpão', partes: [{ centro_custo_id: CC('EXTRUSÃO'), pct: 50 }, { centro_custo_id: CC('CORTE'), pct: 35 }, { centro_custo_id: CC('ADMIN'), pct: 15 }], ativo: true },
  ];
  const RG = (o) => ({ id: 'rg' + Math.random().toString(36).slice(2, 7), empresa_id: E, campo: 'texto', operador: 'contem', natureza: 'S', prioridade: 100, ativo: true, origem: 'manual', criado_em: '2026-10-01T10:00:00Z', ...o });
  DB.lanc_regras = [
    RG({ nome: 'Combustível da frota', texto: 'POSTO', plano_id: P('2.06.02').id, centro_custo_id: CC('COMERCIAL'), usos: 48, prioridade: 20 }),
    RG({ campo: 'favorecido', operador: 'igual', texto: 'ENERGIA REGIONAL S.A.', plano_id: P('2.01.03').id, rateio_id: 'rt1', usos: 10, prioridade: 50, origem: 'sugerida' }),
    RG({ texto: 'TARIFA', plano_id: P('2.04.01').id, centro_custo_id: CC('ADMIN'), usos: 64, origem: 'sugerida' }),
    RG({ texto: 'FRETE', plano_id: P('2.06.01').id, centro_custo_id: CC('COMERCIAL'), usos: 23, valor_max: 20000 }),
    RG({ campo: 'favorecido', operador: 'igual', texto: 'SISTEMAS NUVEM LTDA', plano_id: P('2.03.02').id, centro_custo_id: CC('ADMIN'), usos: 10, prioridade: 50, origem: 'sugerida' }),
    RG({ nome: 'IOF e juros do banco', operador: 'regex', texto: '^(IOF|JUROS)\\b', plano_id: P('2.04.02').id, usos: 7, prioridade: 30 }),
  ];
  const D0 = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  const RC = (descricao, plano, fav, valor, dia, frequencia = 'mensal', extra = {}) => ({ id: 'rr' + Math.random().toString(36).slice(2, 7), empresa_id: E, descricao, plano_id: P(plano).id, favorecido_id: fav ? F(fav).id : null,
    centro_custo_id: extra.cc ? CC(extra.cc) : null, conta_id: DB.contas[0].id, valor, frequencia, dia, inicio: '2026-01-01', fim: extra.fim || null, ajuste_fds: 'postergar', meses_a_frente: 3, ativo: extra.ativo !== false, prioridade: extra.prior || null });
  DB.lanc_recorrentes = [
    RC('Aluguel do galpão', '2.03.01', 'IMÓVEIS', 12000, 10, 'mensal', { cc: 'ADMIN', prior: 'Obrigatório' }),
    RC('Sistemas e internet', '2.03.02', 'SISTEMAS', 1890, 15, 'mensal', { cc: 'ADMIN' }),
    RC('Seguro patrimonial', '2.03.03', null, 7400, 20, 'anual', { cc: 'ADMIN' }),
    RC('Honorários contábeis', '2.03.03', null, 4200, 5, 'mensal', { cc: 'ADMIN', prior: 'Obrigatório' }),
    RC('Manutenção preventiva das extrusoras', '2.03.03', null, 6500, 25, 'trimestral', { cc: 'EXTRUSÃO' }),
    RC('Locação de empilhadeira', '2.03.03', null, 2300, 31, 'mensal', { cc: 'EXTRUSÃO', fim: '2026-09-01', ativo: false }),
  ];
  const R = DB.lanc_recorrentes;
  window.RPC.lanc_recorrentes_lista = () => R.map((r, i) => ({ id: r.id, abertos: r.ativo ? (r.frequencia === 'mensal' ? 3 : 1) : 0, abertos_valor: r.ativo ? r.valor * (r.frequencia === 'mensal' ? 3 : 1) : 0,
    proximo: r.ativo ? D0([3, 8, 40, 28, 18][i] ?? 5) : null, ultimo_pago: D0(-([27, 22, 300, 2, 72, 70][i] ?? 30)), pagos_12m: r.valor * 10 }));
  window.RPC.lanc_recorrentes_gerar = () => 0;
}

// Prestação de contas do PA (SQL 097) — FICTÍCIOS
{
  const D0 = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  const pa19 = DB.paraquedas.find(p => p.numero === 19);
  const mais = [[16, 'TORNEARIA PRECISÃO LTDA', 4300, -42, 'Beatriz Rocha'], [15, 'AUTO PEÇAS CAMPINA LTDA', 1260.4, -24, 'Diego Martins'], [14, 'ELÉTRICA INDUSTRIAL SUL LTDA', 3980, -12, 'Beatriz Rocha'], [13, 'HIDRÁULICA NORDESTE ME', 720, -6, 'Carlos Lima']]
    .map(([numero, razao, valor, d, sol]) => ({ ...pa19, id: 'pa-x' + numero, numero, razao_social: razao, valor, data_pagamento: D0(d), solicitante: sol, previsao_nota: null, descricao: 'Serviço / peças (sem a nota ainda)' }));
  DB.paraquedas.push(...mais);
  const S = [[pa19, -13, 'previsao', 5, 2, 'cobranca', false], ...mais.map((p, i) => [p, [-27, -9, 3, 9][i], i === 1 ? 'prorrogado' : 'padrao', [-42, -24, -12, -6][i], [6, 3, 0, 0][i], ['escalada', 'cobranca', null, null][i], i === 0])]
    .map(([p, rest, origem, pagoHa, n, tipo, esc]) => ({ id: p.id, numero: p.numero, razao_social: p.razao_social, valor: p.valor, criado_por: 'u4', responsavel: p.solicitante,
      data_pago: D0(typeof pagoHa === 'number' && pagoHa < 0 ? pagoHa : -20), prazo: D0(rest), origem_prazo: origem, dias_restantes: rest, cobrancas: n, ultima_cobranca: n ? new Date(Date.now() - 864e5).toISOString() : null, ultimo_tipo: tipo, escalado: esc }));
  window.RPC.pa_prestacao = () => S;
  DB.pa_config = [{ empresa_id: E, prazo_nota_dias: 15, lembrete_antes_dias: 2, cobrar_cada_dias: 3, escalar_apos_dias: 10, escalar_papeis: ['financeiro', 'diretor'], cobrar_ativo: true }];
  DB.pa_cobrancas = [['escalada', 27, 'PA nº 16 sem nota fiscal há 27 dia(s) do prazo'], ['cobranca', 27, 'Nota fiscal do PA nº 16 atrasada há 27 dia(s)'], ['cobranca', 24, 'Nota fiscal do PA nº 16 atrasada há 24 dia(s)'], ['manual', 20, 'Beatriz, a tornearia prometeu a nota para esta semana?'], ['lembrete', 0, 'Nota fiscal do PA nº 16 vence em 2 dia(s)']]
    .map(([tipo, dias_atraso, mensagem], i) => ({ id: i + 1, empresa_id: E, paraquedas_id: 'pa-x16', tipo, dias_atraso, mensagem, enviado_por: tipo === 'manual' ? 'renata@exemplo.com.br' : 'automático', enviado_em: new Date(Date.now() - (i * 3 + 1) * 864e5).toISOString() }));
}

// Auditoria por registro e alertas (SQL 098) — FICTÍCIOS
{
  const H = (d, h) => new Date(Date.now() - d * 864e5 - h * 36e5).toISOString();
  const fav = DB.favorecidos.find(f => f.nome.startsWith('RESINAS'));
  fav.dados_bancarios = 'BANCO 341 AG 1520 CC 88812-4'; fav.pix = '33000167000101';
  const ev = [
    [9, 'renata', 'incluiu', null, null, { nome: fav.nome, documento: fav.documento, dados_bancarios: 'BANCO 237 AG 0451 CC 12034-7', pix: null, forma_pagamento: 'Boleto', tipo: 'FORNECEDORES' }],
    [5, 'ana', 'alterou', ['forma_pagamento', 'pix'], { forma_pagamento: 'Boleto', pix: null }, { forma_pagamento: 'PIX', pix: '33000167000101' }],
    [1, 'beatriz', 'alterou', ['dados_bancarios'], { dados_bancarios: 'BANCO 237 AG 0451 CC 12034-7' }, { dados_bancarios: 'BANCO 341 AG 1520 CC 88812-4' }],
  ].map(([d, u, acao, campos, antes, depois], i) => ({ id: 9000 + i, empresa_id: E, user_id: 'u' + (i + 1), user_email: u + '@exemplo.com.br', tabela: 'favorecidos', registro_id: fav.id, acao, campos, antes, depois, criado_em: H(d, 3) }));
  DB.auditoria.push(...ev);
  window.RPC.auditoria_registros = () => [
    { tabela: 'favorecidos', registro_id: fav.id, eventos: 3, primeiro: ev[0].criado_em, ultimo: ev[2].criado_em, usuarios: 'ana@exemplo.com.br, beatriz@exemplo.com.br, renata@exemplo.com.br', excluido: false, foto: ev[0].depois },
    { tabela: 'lancamentos', registro_id: 'lx1', eventos: 4, primeiro: H(30, 1), ultimo: H(2, 5), usuarios: 'ana@exemplo.com.br', excluido: false, foto: { data: '2026-10-05', valor: 81600, descricao: 'COMPRA DE RESINA PEBD', favorecido_id: fav.id } },
    { tabela: 'paraquedas', registro_id: 'px1', eventos: 2, primeiro: H(12, 2), ultimo: H(11, 2), usuarios: 'beatriz@exemplo.com.br', excluido: true, foto: { numero: 12, razao_social: 'RESINAS DO BRASIL S.A.' } },
  ];
  DB.audit_alertas = [
    ['banco_beneficiario', 'Dados bancários do beneficiário alterados', `${fav.nome}: dados bancários`, 'beatriz', 1, null],
    ['exclusao', 'Exclusão de lançamento', 'COMPRA DE EMBALAGENS · valor 6420.00 · data 2026-10-12', 'ana', 2, null],
    ['valor_pago', 'Valor de lançamento pago alterado', 'FRETE CARGA SALVADOR/BA: 9800.00 → 11800.00', 'ana', 3, null],
    ['papel_usuario', 'Papel ou áreas de usuário alterados', 'compras → financeiro', 'renata', 6, 'renata@exemplo.com.br'],
    ['trava_conta', 'Trava de conta removida', 'BANCO ALFA · até 2026-09-30', 'renata', 8, 'carlos@exemplo.com.br'],
  ].map(([regra, titulo, detalhe, u, d, visto], i) => ({ id: 500 + i, empresa_id: E, auditoria_id: regra === 'banco_beneficiario' ? 9002 : null, regra, titulo, detalhe, user_email: u + '@exemplo.com.br', criado_em: H(d, 1), visto_por: visto, visto_em: visto ? H(d - 1, 0) : null }));
  DB.audit_alertas_config = [];
}

// Uso da plataforma (SQL 099) — FICTÍCIOS
{
  DB.uso_config = []; DB.uso_eventos = [];
  const H = (d) => new Date(Date.now() - d * 864e5).toISOString();
  const telas = [['lancamentos', 214, 6, 61200, 286, 8.4], ['conciliacao', 132, 3, 47800, 362, 4.5], ['hoje', 410, 9, 22100, 54, 41.2], ['dashboard', 188, 7, 18400, 98, 22.3],
    ['paraquedas', 96, 4, 15800, 165, 12.5], ['compras/pedidos', 71, 3, 14100, 199, 9.9], ['fluxo-mensal', 64, 5, 11200, 175, 14.1], ['dre', 38, 4, 6900, 182, 18.4],
    ['fidc-recompras', 22, 2, 5300, 241, 9.1], ['cadastros/favorecidos', 57, 5, 4100, 72, 35.1], ['relatorio', 19, 3, 2600, 137, 57.9], ['decisoes', 31, 3, 2200, 71, 29.0]]
    .map(([rota, acessos, usuarios, segundos, media, rejeicao]) => ({ rota, acessos, usuarios, segundos, media, rejeicao }));
  const perfis = [['financeiro', 'lancamentos', 160, 48000], ['financeiro', 'conciliacao', 120, 44000], ['financeiro', 'fluxo-mensal', 40, 8000], ['financeiro', 'hoje', 180, 9000], ['financeiro', 'cadastros/favorecidos', 40, 3000],
    ['diretor', 'dashboard', 120, 12000], ['diretor', 'dre', 30, 6000], ['diretor', 'decisoes', 25, 2000], ['diretor', 'hoje', 90, 5000],
    ['compras', 'paraquedas', 90, 15000], ['compras', 'compras/pedidos', 70, 14000], ['compras', 'hoje', 60, 3000],
    ['admin', 'lancamentos', 50, 13000], ['admin', 'dashboard', 60, 6000], ['admin', 'fidc-recompras', 22, 5300], ['admin', 'hoje', 80, 5100]]
    .map(([papel, rota, acessos, segundos]) => ({ papel, rota, acessos, segundos }));
  const pessoas = [['Ana Souza', 'financeiro', 22, 241, 78400, 'lancamentos', 0], ['Beatriz Rocha', 'financeiro', 20, 198, 56300, 'conciliacao', 0], ['Renata Alves', 'admin', 18, 212, 29400, 'lancamentos', 0],
    ['Carlos Lima', 'diretor', 14, 265, 25000, 'dashboard', 1], ['Diego Martins', 'compras', 19, 220, 32000, 'paraquedas', 0], ['Fernanda Costa', 'financeiro', 6, 61, 8200, 'lancamentos', 4]]
    .map(([nome, papel, dias, acessos, segundos, tela_mais, d], i) => ({ user_id: 'u' + (i + 1), nome, email: nome.toLowerCase().split(' ')[0] + '@exemplo.com.br', papel, dias, acessos, segundos, tela_mais, ultimo: H(d) }));
  const forms = [['paraquedas', 'Novo pagamento antecipado', 41, 24, 17, 212], ['lancamentos', 'Novo lançamento', 186, 171, 15, 48], ['cadastros/favorecidos', 'Novo beneficiário', 23, 12, 11, 165],
    ['conciliacao', 'Criar lançamento a partir do extrato', 64, 57, 7, 31], ['fidc-recompras', 'Registrar recompra', 14, 9, 5, 274], ['compras/pedidos', 'Novo pedido de compra', 29, 26, 3, 120]]
    .map(([rota, titulo, abertos, concluidos, abandonos, seg_ate_desistir]) => ({ rota, titulo, abertos, concluidos, abandonos, seg_ate_desistir }));
  const erros = [['paraquedas', 'Informe o CNPJ ou CPF do fornecedor', 19, 3, 0], ['lancamentos', 'Informe o plano de contas', 14, 4, 1], ['cadastros/favorecidos', 'Já existe beneficiário com o documento #', 7, 2, 2],
    ['conciliacao', 'Período travado até #: peça ao administrador', 4, 2, 5], ['fidc-recompras', 'Escolha o motivo da recompra', 3, 1, 3]]
    .map(([rota, titulo, vezes, usuarios, d]) => ({ rota, titulo, vezes, usuarios, ultimo: H(d) }));
  const dias = Array.from({ length: 30 }, (_, i) => { const d = new Date(Date.now() - (29 - i) * 864e5), fds = [0, 6].includes(d.getDay());
    return { dia: d.toISOString().slice(0, 10), usuarios: fds ? (i % 3 ? 0 : 1) : 4 + ((i * 7) % 3), horas: fds ? 0.4 : 7 + ((i * 5) % 4) }; });
  window.RPC.uso_resumo = () => ({ rejeicao_segundos: 10, guardar_dias: 180,
    kpis: { usuarios: 6, membros: 8, acessos: 1342, horas: 63.4, dias_pessoa: 99, forms: 357, abandonos: 58, erros: 47 },
    telas, perfis, pessoas, forms, erros, dias,
    sem_acesso: [{ user_id: 'u7', nome: 'Gustavo Pereira', email: 'gustavo@exemplo.com.br', papel: 'leitura', ultimo: H(52) }, { user_id: 'u8', nome: 'Helena Dias', email: 'helena@exemplo.com.br', papel: 'vendas', ultimo: null }] });
}

// Privacidade e Acessos (SQL 100) — FICTÍCIOS
{
  const H = (d) => new Date(Date.now() - d * 864e5).toISOString(), D = (d) => H(d).slice(0, 10);
  const cfg = { empresa_id: E, inativos_dias: 60, inativos_acao: 'suspender', aviso_dias: 7, incluir_admin: false, incluir_portal: true, revisao_meses: 6, prazo_resposta_dias: 15, encarregado_nome: 'Renata Alves', encarregado_email: 'privacidade@exemplo.com.br' };
  DB.lgpd_config = [cfg];
  const mem = [['u3', 'Renata Alves', 'admin', 0, true, false], ['u1', 'Ana Souza', 'financeiro', 0], ['u2', 'Beatriz Rocha', 'financeiro', 1], ['u4', 'Carlos Lima', 'diretor', 3],
    ['u5', 'Diego Martins', 'compras', 2], ['u6', 'Fernanda Costa', 'financeiro', 12], ['u7', 'Gustavo Pereira', 'leitura', 56, false, false, 2], ['u8', 'Helena Dias', 'vendas', 41]]
    .map(([user_id, nome, papel, dias, eu, protegido, av]) => ({ user_id, nome, email: nome.toLowerCase().split(' ')[0] + '@exemplo.com.br', papel, areas: papel === 'leitura' ? ['cont'] : null, desde: '2026-01-05T10:00:00Z',
      ultimo: H(dias), dias, avisado_em: av ? H(av) : null, protegido: papel === 'admin', eu: !!eu }));
  window.RPC.acessos_situacao = () => ({ config: cfg, membros: mem,
    suspensos: [{ id: 'sx1', nome: 'Igor Nunes', email: 'igor@exemplo.com.br', papel: 'financeiro', motivo: 'Sem acesso há 61 dias (automático)', automatico: true, suspenso_em: H(9), suspenso_por: 'automático', reativado_em: null },
      { id: 'sx2', nome: 'Júlia Ramos', email: 'julia@exemplo.com.br', papel: 'compras', motivo: 'Saiu da empresa', automatico: false, suspenso_em: H(40), suspenso_por: 'renata@exemplo.com.br', reativado_em: null },
      { id: 'sx3', nome: 'Diego Martins', email: 'diego@exemplo.com.br', papel: 'compras', motivo: 'Férias de 70 dias', automatico: true, suspenso_em: H(120), suspenso_por: 'automático', reativado_em: H(100) }],
    portal: [{ id: 'p1', cliente: 'SUPERMERCADO BOA COMPRA LTDA', email: 'compras@boacompra.com.br', ativo: true, ultimo: H(3), dias: 3 },
      { id: 'p2', cliente: 'PADARIA PÃO DOURADO LTDA', email: 'financeiro@paodourado.com.br', ativo: true, ultimo: H(57), dias: 57 },
      { id: 'p3', cliente: 'DISTRIBUIDORA NORDESTE S.A.', email: 'contas@nordeste.com.br', ativo: false, ultimo: H(75), dias: 75, nunca: true }],
    revisoes: [{ revisado_em: H(190), revisado_por: 'renata@exemplo.com.br', mantidos: 8, suspensos: 1, observacao: 'Revisão semestral com a diretoria' }],
    ultima_revisao: H(190), proxima_revisao: D(7) });
  const pes = (pub) => (pub === 'equipe' ? mem.map(m => ({ nome: m.nome, email: m.email, aceito_em: ['u7', 'u8'].includes(m.user_id) ? null : H(m.dias + 1) }))
    : [{ nome: 'SUPERMERCADO BOA COMPRA LTDA', email: 'compras@boacompra.com.br', aceito_em: H(20) }, { nome: 'PADARIA PÃO DOURADO LTDA', email: 'financeiro@paodourado.com.br', aceito_em: null }]);
  window.RPC.lgpd_termos_situacao = () => ({
    equipe: { id: 't1', versao: 2, titulo: 'Termo de uso e aviso de privacidade', texto: '', publicado_em: H(30), publicado_por: 'renata@exemplo.com.br', pessoas: pes('equipe') },
    portal: { id: 't2', versao: 1, titulo: 'Aviso de privacidade do Portal do Cliente', texto: '', publicado_em: H(25), publicado_por: 'renata@exemplo.com.br', pessoas: pes('portal') } });
  window.RPC.lgpd_dados_titular = () => [
    { origem: 'colaborador', id: 'cx1', nome: 'MARIA APARECIDA SILVA', ativo: false, base_legal: 'Obrigação legal trabalhista e previdenciária (guarda mínima de 5 anos após o desligamento)',
      campos: { CPF: '123.456.789-09', 'Matrícula': '0458', Cargo: 'AUXILIAR DE PRODUÇÃO', Setor: 'EXTRUSÃO', 'Vínculo': 'clt', 'Situação': 'desligado', 'Admissão': '03/02/2022', 'Desligamento': '30/09/2026', Foto: 'sim', 'Histórico salarial': 4 } },
    { origem: 'favorecido', id: 'fx1', nome: 'MARIA APARECIDA SILVA', ativo: true, base_legal: 'Execução de contrato e obrigação legal (fiscal e contábil: os lançamentos e as notas ficam guardados)',
      campos: { Tipo: 'FORNECEDORES', CPF: '123.456.789-09', 'E-mail': 'maria.silva@exemplo.com.br', Pix: '123.456.789-09', 'Lançamentos ligados': 7 } },
    { origem: 'motorista', id: 'mx1', nome: 'MARIA APARECIDA SILVA', ativo: false, base_legal: 'Obrigação legal (Código de Trânsito e Lei 13.103/2015) e execução de contrato', campos: { CPF: '123.456.789-09', 'Vínculo': 'empregado', CNH: '0412****** · D · validade 12/03/2028' } }];
  DB.lgpd_solicitacoes = [
    ['Maria Aparecida Silva', '12345678909', 'maria.silva@exemplo.com.br', 'acesso', 'Pediu por e-mail a cópia dos dados após o desligamento', 4, 'aberta'],
    ['Paulo Henrique Souza', null, '(81) 99999-0000', 'anonimizacao', 'Ex-representante pediu a eliminação do cadastro', 16, 'aberta'],
    ['Joana Freitas', '98765432100', 'joana@exemplo.com.br', 'correcao', 'Endereço desatualizado', 30, 'atendida']]
    .map(([titular_nome, titular_documento, titular_contato, tipo, descricao, d, status], i) => ({ id: 'sl' + i, empresa_id: E, titular_nome, titular_documento, titular_contato, tipo, descricao,
      recebida_em: D(d), prazo: D(d - 15), status, resposta: status === 'atendida' ? 'Endereço corrigido no cadastro e confirmado por e-mail.' : null, atendida_em: status === 'atendida' ? H(d - 3) : null, registros: [] }));
}

// Painel da Diretoria (SQL 101) — FICTÍCIOS
{
  const venda = [812, 845, 790, 702, 768, 880, 905, 870, 931, 958, 902, 975, 921].map(v => v * 1000), dev = [12, 9, 15, 8, 11, 6, 14, 10, 9, 18, 7, 12, 24].map(v => v * 1000);
  const boa = [402, 418, 377, 351, 389, 426, 431, 415, 447, 452, 428, 461, 433].map(v => v * 1000), ref = [27, 30, 26, 25, 27, 29, 28, 27, 29, 31, 28, 30, 34].map(v => v * 1000);
  const med = [118, 124, 109, 98, 112, 127, 131, 122, 133, 138, 129, 141, 132], np = [109, 117, 100, 92, 105, 121, 124, 113, 127, 131, 122, 133, 119];
  window.RPC.diretoria_operacional = () => ({ meses: [], fat_venda: venda, fat_devolucao: dev, prod_boa: boa, prod_refugo: ref,
    rnc_mes: [5, 6, 4, 3, 5, 4, 6, 5, 3, 4, 5, 3, 7], rnc_cliente: [2, 3, 1, 1, 2, 1, 2, 2, 1, 1, 2, 1, 3], rnc_em_aberto: [6, 7, 6, 5, 6, 5, 7, 6, 5, 4, 5, 4, 6], rnc_custo: [3200, 4100, 1800, 1500, 2700, 900, 3300, 2500, 1200, 1100, 2400, 800, 5600],
    ent_notas: med.map(x => x + 4), ent_entregues: med, ent_medidas: med, ent_no_prazo: np, ent_problemas: [2, 3, 1, 1, 2, 1, 2, 2, 1, 2, 1, 1, 3],
    rj_pago: [0, 0, 0, 0, 0, 0, 0, 0, 0, 450000, 450000, 450000, 380000], prazo_entrega_dias: 3, meta_prazo_logistica: 95 });
  DB.diretoria_config = [{ empresa_id: E, tolerancia_pct: 10, rj_previsto: 450000, rj_processo: '0016214-76.2025.8.17.2480', rj_inicio: '2026-07-01', rj_planos: [], producao_setores: null, caixa_contas: null, ocultos: [] }];
  DB.diretoria_metas = [['caixa', 300000], ['faturamento', 950000], ['margem', 8], ['producao', 450000], ['perdas', 6.5], ['qualidade', 1], ['entregas', 95]]
    .map(([indicador, meta]) => ({ empresa_id: E, indicador, ano: 2026, meta }));
  DB.diretoria_comentarios = [{ empresa_id: E, mes: '2026-10-01', indicador: 'perdas', texto: 'Troca de resina do fornecedor na extrusora 2 aumentou a apara na 2ª quinzena; lote devolvido e fornecedor notificado.', autor: 'carlos@exemplo.com.br' },
    { empresa_id: E, mes: '2026-10-01', indicador: 'rj', texto: 'Parcela de outubro paga parcialmente; saldo de R$ 70 mil programado para 10/11.', autor: 'renata@exemplo.com.br' }];
  DB.prod_setores ||= [{ id: 'st1', empresa_id: E, nome: 'Extrusão', ativo: true, ordem: 1 }, { id: 'st2', empresa_id: E, nome: 'Impressão', ativo: true, ordem: 2 }, { id: 'st3', empresa_id: E, nome: 'Corte e solda', ativo: true, ordem: 3 }];
}

// Minha Manhã personalizada (SQL 102) — FICTÍCIOS
{
  const H = (h) => new Date(Date.now() - h * 36e5).toISOString();
  DB.manha_preferencias = [];
  const ont = '2026-11-06';
  window.RPC.manha_resumo = () => ({ desde: H(15.3), ontem: ont, detalhe_pessoas: true,
    mudou: { avisos: 3, notas: { saida: 14, entrada: 6 },
      por_tabela: [['lancamentos', 'fin', 23, 17, 5, 1, 2, 1.1], ['paraquedas', 'fin', 4, 2, 2, 0, 2, 2.4], ['prod_apontamentos', 'prd', 38, 38, 0, 0, 5, 0.7], ['qual_rnc', 'prd', 2, 1, 1, 0, 1, 5.2],
        ['compras_pedidos', 'cmp', 3, 2, 1, 0, 1, 3.9], ['log_carga_notas', 'log', 11, 0, 11, 0, 1, 1.8], ['favorecidos', 'cad', 2, 1, 1, 0, 2, 6.0]]
        .map(([tabela, area, total, incluiu, alterou, excluiu, pessoas, h]) => ({ tabela, area, total, incluiu, alterou, excluiu, pessoas, ultimo: H(h) })),
      recentes: [['beatriz', 'incluiu', 'lancamentos', 'TARIFA BANCÁRIA PIX', 1.1], ['ana', 'alterou', 'paraquedas', 'RESINAS DO BRASIL S.A.', 2.4], ['diego', 'incluiu', 'compras_pedidos', '418', 3.9],
        ['carlos', 'alterou', 'qual_rnc', 'Bobina com variação de espessura', 5.2], ['ana', 'excluiu', 'lancamentos', 'FRETE EM DUPLICIDADE', 6.5]]
        .map(([u, acao, tabela, rotulo, h]) => ({ user_email: u + '@exemplo.com.br', acao, tabela, rotulo, criado_em: H(h) })) },
    dia: { fin: { recebido: 186420.55, pago: 142310.18, lancamentos: 47 }, fat: { notas: 14, valor: 52380.4 }, entradas: { notas: 6, valor: 71240 },
      prod: { boa: 17850, refugo: 1210, apontamentos: 38 }, rnc: 1, log: { cargas: 3, entregues: 11, problemas: 1 } } });
}

// Central de Decisões (SQL 103) — FICTÍCIOS
{
  const H = (d, h = 0) => new Date(Date.now() - d * 864e5 - h * 36e5).toISOString(), D = (d) => H(d).slice(0, 10), F = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  DB.decisoes_config = []; DB.decisoes_dia ||= [];
  const pessoas = [['u3', 'Renata Alves', 'admin'], ['u1', 'Ana Souza', 'financeiro'], ['u2', 'Beatriz Rocha', 'financeiro'], ['u4', 'Carlos Lima', 'diretor']].map(([user_id, nome, papel]) => ({ user_id, nome, papel }));
  const hist = [
    ['extratos', 'Conciliação', 'Importar os extratos parados', 'delegado', null, 'Beatriz Rocha', 'Importar o OFX do Banco Alfa e conciliar até segunda', 'renata', 0.1],
    ['cadastro-doc', 'Cadastro', 'Completar CNPJ/CPF dos beneficiários', 'adiado', F(10), null, 'Aguardando a planilha da contabilidade', 'ana', 1],
    ['fidc-barato', 'FIDC', 'Priorizar o fundo mais barato nas antecipações', 'resolvido', null, null, 'Borderô de quinta enviado à Negocial; a FS só para o Grupo Total', 'carlos', 2],
    ['caixa-minimo', 'Caixa', 'Cobrir a falta de caixa prevista', 'adiado', D(1), null, 'Esperar a liberação do borderô', 'renata', 6],
    ['pago-sem-conta', 'Caixa', 'Lançamentos pagos sem conta bancária', 'resolvido', null, null, 'Contas informadas nos 12 lançamentos de setembro', 'beatriz', 9],
  ];
  window.RPC.decisoes_situacao = () => ({
    atual: Object.fromEntries(hist.map(([k, origem, titulo, situacao, ate, dn, nota, u, d]) => [k, { situacao, ate, delegado_para: dn ? 'u2' : null, delegado_nome: dn, nota, por_email: u + '@exemplo.com.br', criado_em: H(d), assinatura: situacao === 'resolvido' ? (k === 'fidc-barato' ? 'x' : 'y') : null }])),
    historico: hist.map(([chave, origem, titulo, situacao, ate, delegado_nome, nota, u, d], i) => ({ id: i, chave, origem, titulo, situacao, ate, delegado_nome, nota, por_email: u + '@exemplo.com.br', criado_em: H(d, 2) })),
    pessoas });
  DB.saude_historico = Array.from({ length: 30 }, (_, i) => { const g = Math.round(58 + i * 0.6 + (i % 4) * 2 - (i % 7 === 3 ? 6 : 0)); return { empresa_id: E, dia: D(30 - i), geral: g,
    areas: { fin: g - 12 + (i % 3), com: 88, cmp: 92, prd: g - 2, qua: 80 + (i % 5), log: 90, fis: 85, gov: 76 + (i % 4) }, alertas: 14 - Math.floor(i / 4) }; });
  if (!DB.decisoes_dia.length) DB.decisoes_dia.push(...[[118, 0, 'Pendente', 182400], [117, 1, 'Aprovada', 151230], [116, 2, 'Aprovada', 96410], [115, 3, 'Rejeitada', -12300]].map(([numero, d, status, saldo_fim]) =>
    ({ id: 'dd' + numero, empresa_id: E, numero, data: D(d), status, saldo_fim, criado_em: H(d, 14), decidido_em: status !== 'Pendente' ? H(d, 12) : null, motivo: status === 'Rejeitada' ? 'Segurar o pagamento da resina até o borderô' : null, itens: [], contas: [] })));
}

// Meus Painéis (SQL 104) — FICTÍCIOS
DB.paineis = [
  { id: 'pn1', empresa_id: E, dono: 'u1', dono_nome: 'renata', nome: 'Diretoria', ordem: 1, compartilhado: true, cartoes: [
    { t: 'resumo_diretoria', tam: 3 }, { t: 'graf_faturamento', tam: 2 }, { t: 'ind_diretoria', tam: 1, cfg: { k: 'perdas' } },
    { t: 'graf_producao', tam: 2 }, { t: 'ind_diretoria', tam: 1, cfg: { k: 'entregas' } }, { t: 'graf_necessidade', tam: 2 }, { t: 'kpi_abertos', tam: 1 }] },
  { id: 'pn2', empresa_id: E, dono: 'u1', dono_nome: 'renata', nome: 'Visão do ano', ordem: 2, compartilhado: false, cartoes: [
    { t: 'kpi_saldo', tam: 1 }, { t: 'kpi_entradas_saidas', tam: 1 }, { t: 'kpi_resultado', tam: 1 }, { t: 'graf_entradas_saidas', tam: 2 }, { t: 'kpi_abertos', tam: 1 },
    { t: 'graf_composicao', tam: 1 }, { t: 'tab_saldos', tam: 2 }, { t: 'tab_vencimentos', tam: 3 }] },
  { id: 'pn3', empresa_id: E, dono: 'u4', dono_nome: 'carlos', nome: 'Fábrica', ordem: 1, compartilhado: true, cartoes: [{ t: 'graf_producao', tam: 2 }, { t: 'graf_qualidade', tam: 1 }, { t: 'graf_entregas', tam: 3 }] },
];

// Cenários de caixa (SQL 106) — FICTÍCIOS
DB.caixa_config = [{ empresa_id: E, caixa_minimo: 700000, horizonte_semanas: 13, contas: null, cenario_alerta: null, avisar: true, avisar_papeis: ['admin', 'diretor', 'financeiro'], avisar_semanas: 4 }];
DB.caixa_cenarios = [
  { id: 'cc0', empresa_id: E, nome: 'Otimista', tipo: 'otimista', cor: '#16a34a', ordem: 2, ativo: true, descricao: 'Recebe tudo no prazo e alonga os pagamentos a fornecedores em 7 dias.',
    premissas: { pagar_atraso_dias: 7, forecast_receitas_pct: 105, forecast_despesas_pct: 97 } },
  { id: 'cc1', empresa_id: E, nome: 'Pessimista', tipo: 'pessimista', cor: '#dc2626', ordem: 3, ativo: true, descricao: 'Inadimplência de 10%, atraso de 20 dias e receitas do forecast 15% abaixo.',
    premissas: { receber_pct: 90, receber_atraso_dias: 20, vencidos_receber_pct: 50, forecast_receitas_pct: 85, forecast_despesas_pct: 103 } },
  { id: 'cc2', empresa_id: E, nome: 'RJ homologada em dezembro', tipo: 'personalizado', cor: '#9333ea', ordem: 10, ativo: true, descricao: 'Base + parcelas do plano a partir de dezembro e venda do terreno em janeiro.',
    premissas: { rj: { ativo: true, passivo: 4800000, desagio_pct: 50, carencia_meses: 0, parcelas: 120, juros_aa_pct: 6, inicio: '2026-12', dia: 15 },
      eventos: [{ data: '2027-01-20', descricao: 'Venda do terreno (fictício)', valor: 350000 }] } },
];
window.RPC.caixa_registrar_alerta = () => false;

// Checklist do fechamento (SQL 107) — FICTÍCIOS (mês 10/2026; hoje = D+4)
DB.fechamento_config = [{ empresa_id: E, meta_dia_util: 5, papeis_fechar: ['admin', 'diretor'], exigir_checklist: true, lembrar: true, lembrete_dias_antes: 1, cobrar_atrasadas: true, avisar_reabertura: ['admin', 'diretor', 'financeiro'] }];
{
  const M = [
    [1, 'Importar e conciliar os extratos bancários', 'Extratos até o último dia do mês, sem movimento pendente.', 'Financeiro', 1, null, 'financeiro', 'ext', '#/conciliacao'],
    [2, 'Lançamentos pagos com conta bancária', 'Nenhum lançamento pago fora dos relatórios.', 'Financeiro', 1, null, 'financeiro', 'semconta', '#/lancamentos'],
    [3, 'Baixar ou reprogramar os títulos vencidos', 'Nada em aberto vencido até o fim do mês.', 'Financeiro', 2, 'u2', null, 'abertos', '#/abertos'],
    [4, 'Notas de venda ligadas ao financeiro', 'Toda nota de venda com recebimento, título ou borderô.', 'Faturamento', 2, null, 'financeiro', 'notas', '#/notas'],
    [5, 'Decidir os borderôs FIDC do mês', 'Nenhuma proposta pendente com operação no mês.', 'Financeiro', 2, 'u3', null, 'bord', '#/fidc-propostas'],
    [6, 'Prestação de contas dos pagamentos antecipados', 'Notas dos PAs pagos no mês recebidas ou cobradas.', 'Financeiro', 3, 'u2', null, null, '#/paraquedas'],
    [7, 'Justificar os desvios do orçamento', 'Contas fora da tolerância com justificativa.', 'Controladoria', 4, 'u2', null, 'orc', '#/controle-orcamento'],
    [8, 'Conferir a folha de outubro com o financeiro', 'Salários, encargos e adiantamentos lançados.', 'RH', 3, 'u5', null, null, '#/folha'],
    [9, 'Fechar e travar as contas bancárias', 'Cada conta conciliada, batendo e travada até o fim do mês.', 'Financeiro', 4, 'u1', null, 'contas', '#/fechamento'],
    [10, 'Revisar a DRE Gerencial e enviar à diretoria', 'Conferir as variações relevantes antes de enviar.', 'Controladoria', 5, 'u2', null, null, '#/dre'],
    [11, 'Enviar os documentos à contabilidade', 'Extratos, notas e relatórios do mês para o escritório contábil.', 'Contabilidade', 5, null, 'financeiro', null, null],
  ];
  const PZ = { 1: '2026-11-03', 2: '2026-11-04', 3: '2026-11-05', 4: '2026-11-06', 5: '2026-11-09' };
  DB.fechamento_modelos = M.map(([ordem, titulo, descricao, area, dia_util, responsavel, papel, etapa_auto, link]) => ({ id: 'fm' + ordem, empresa_id: E, ordem, titulo, descricao, area, dia_util, responsavel, papel, etapa_auto, link, obrigatoria: true, ativo: true }));
  const SIT = { 6: ['feita', 'u2', '2026-11-05T15:20:00Z', 'Notas de 9 PAs recebidas; 2 cobradas'], 11: ['nao_aplica', 'u2', '2026-11-06T10:00:00Z', 'Envio passou a ser pelo portal do escritório'] };
  DB.fechamento_tarefas = M.map(([ordem, titulo, descricao, area, dia_util, responsavel, papel, etapa_auto, link]) => {
    const s = SIT[ordem] || ['pendente', null, null, null];
    return { id: 'ft' + ordem, empresa_id: E, mes: '2026-10', modelo_id: 'fm' + ordem, ordem, titulo, descricao, area, dia_util, prazo: PZ[dia_util], responsavel, papel, etapa_auto, link, obrigatoria: true,
      situacao: s[0], feita_por: s[1], feita_em: s[2], observacao: s[3] };
  });
  DB.fechamento_meses = [];
  DB.fechamento_eventos = [
    { id: 2, empresa_id: E, mes: '2026-10', acao: 'tarefa', detalhe: 'Enviar os documentos à contabilidade: não se aplica (Envio passou a ser pelo portal do escritório)', por_email: 'ana@exemplo.com.br', em: '2026-11-06T10:00:00Z' },
    { id: 1, empresa_id: E, mes: '2026-10', acao: 'tarefa', detalhe: 'Prestação de contas dos pagamentos antecipados: feita (Notas de 9 PAs recebidas; 2 cobradas)', por_email: 'ana@exemplo.com.br', em: '2026-11-05T15:20:00Z' },
  ];
  window.RPC.fechamento_gerar = () => 0;
}

// Forecast contínuo (SQL 108) — FICTÍCIOS: budget e forecast 2026 a partir da média dos lançamentos, versões e centros de custo
{
  const planos = DB.plano_contas.filter(p => p.nivel === 2 && ['E', 'S'].includes(p.tipo));
  const media = {};
  for (const l of DB.lancamentos.filter(l => l.data.startsWith('2026') && l.status === 'Pago')) media[l.plano_id] = (media[l.plano_id] || 0) + +l.valor;
  let k = 0; DB.orcamentos = [];
  for (const p of planos) {
    const base = (media[p.id] || 0) / 10; if (base < 500) continue;
    for (let m = 1; m <= 12; m++) {
      const b = Math.round(base * (0.92 + ((k + m) % 5) * 0.03) / 100) * 100;
      DB.orcamentos.push({ id: 'ob' + (++k) + '-' + m, empresa_id: E, cenario: 'budget', ano: 2026, mes: m, plano_id: p.id, centro_custo_id: null, valor: b });
      DB.orcamentos.push({ id: 'of' + k + '-' + m, empresa_id: E, cenario: 'forecast', ano: 2026, mes: m, plano_id: p.id, centro_custo_id: null, valor: Math.round(b * (p.tipo === 'S' ? 1.04 : 0.97) / 100) * 100 });
    }
  }
  const dados = (f) => DB.orcamentos.filter(o => o.cenario === 'forecast').map(o => ({ p: o.plano_id, m: o.mes, v: Math.round(o.valor * f(o)) }));
  const tot = (d, t) => d.filter(x => DB.plano_contas.find(p => p.id === x.p).tipo === t).reduce((s, x) => s + x.v, 0);
  const V = [[0, null, 'inicial', '2026-08-04T12:00:00Z', () => 1.0], [8, 'tendencia', 'fechamento', '2026-09-05T13:10:00Z', (o) => o.mes > 8 ? 1.02 : 0.99], [9, 'tendencia', 'fechamento', '2026-10-06T13:10:00Z', (o) => o.mes > 9 ? 1.05 : 1.01], [9, 'media', 'manual', '2026-10-20T15:30:00Z', (o) => o.mes > 9 ? 0.98 : 1.01]];
  DB.forecast_versoes = V.map(([ref_mes, metodo, motivo, criado_em, f], i) => { const d = dados(f); return { id: 'fv' + i, empresa_id: E, ano: 2026, ref_mes, metodo, motivo, criado_em, dados: d, entradas: tot(d, 'E'), saidas: tot(d, 'S') }; });
  DB.orcamento_config = [{ empresa_id: E, tol_pct: 10, tol_valor: 5000, base_comparacao: 'budget', exigir_justificativa: true, prazo_justificar: 4, avisar: true, avisar_papeis: ['financeiro'], rolar_ao_fechar: true, metodo: 'tendencia', media_meses: 3, tendencia_limite: 30 }];
  const resp = { 'EXTRUSÃO': 'u1', 'CORTE E SOLDA': 'u3', 'ADMINISTRATIVO': 'u2', 'COMERCIAL': null };
  DB.centros_custo.forEach(c => { c.responsavel = resp[c.nome] ?? null; });
  const cc = (n) => DB.centros_custo.find(c => c.nome === n).id;
  DB.orcamento_cc_aprovacoes = [
    { empresa_id: E, ano: 2026, cenario: 'budget', centro_custo_id: cc('EXTRUSÃO'), situacao: 'enviado', total: 0, enviado_por: 'u2', enviado_em: '2026-11-06T14:00:00Z' },
    { empresa_id: E, ano: 2026, cenario: 'budget', centro_custo_id: cc('CORTE E SOLDA'), situacao: 'aprovado', total: 0, enviado_por: 'u2', enviado_em: '2026-11-03T10:00:00Z', decidido_em: '2026-11-04T09:00:00Z' },
    { empresa_id: E, ano: 2026, cenario: 'budget', centro_custo_id: cc('ADMINISTRATIVO'), situacao: 'devolvido', total: 0, enviado_por: 'u2', enviado_em: '2026-11-03T10:00:00Z', decidido_em: '2026-11-05T16:00:00Z', comentario: 'Faltou o reajuste do aluguel a partir de agosto.' },
  ];
  const PCT = { 'EXTRUSÃO': 0.45, 'CORTE E SOLDA': 0.25, 'ADMINISTRATIVO': 0.2, 'COMERCIAL': 0.1 };
  const valoresCC = (ccId, cen) => { const n = DB.centros_custo.find(c => c.id === ccId)?.nome; const f = PCT[n] || 0;
    return DB.orcamentos.filter(o => o.cenario === (cen || 'budget')).map(o => { const p = DB.plano_contas.find(x => x.id === o.plano_id);
      return p.tipo === 'S' ? { plano_id: o.plano_id, codigo: p.codigo, nome: p.nome, tipo: p.tipo, mes: o.mes, valor: Math.round(o.valor * f) } : null; }).filter(x => x && x.valor); };
  for (const a of DB.orcamento_cc_aprovacoes) a.total = valoresCC(a.centro_custo_id).reduce((s, x) => s + x.valor, 0) - (a.situacao === 'aprovado' ? 0 : 0);
  window.RPC.orcamento_cc_valores = (a) => valoresCC(a.p_cc, a.p_cenario);
  window.RPC.orcamento_cc_meus = () => DB.centros_custo.filter(c => c.responsavel === 'u1').map(c => { const a = DB.orcamento_cc_aprovacoes.find(x => x.centro_custo_id === c.id) || {};
    const tot = valoresCC(c.id).reduce((s, x) => s + x.valor, 0); return { centro_custo_id: c.id, nome: c.nome, cenario: a.cenario || 'budget', situacao: a.situacao || null, total: a.total, enviado_em: a.enviado_em, decidido_em: a.decidido_em, comentario: a.comentario, atual: tot }; });
  window.RPC.forecast_rolar = () => ({ realizado: 0, projetado: 0 });
}

// Alçadas e remessa CNAB (SQL 109) — FICTÍCIOS
{
  DB.pag_alcadas = [
    { id: 'pa1', empresa_id: E, nome: 'Até R$ 5 mil', valor_min: 0, valor_max: 5000, centro_custo_id: null, papeis: ['financeiro'], usuarios: [], aprovacoes: 1, ordem: 1, ativo: true },
    { id: 'pa2', empresa_id: E, nome: 'De R$ 5 mil a R$ 50 mil', valor_min: 5000.01, valor_max: 50000, centro_custo_id: null, papeis: ['diretor'], usuarios: [], aprovacoes: 1, ordem: 2, ativo: true },
    { id: 'pa3', empresa_id: E, nome: 'Acima de R$ 50 mil', valor_min: 50000.01, valor_max: null, centro_custo_id: null, papeis: ['diretor', 'admin'], usuarios: [], aprovacoes: 2, ordem: 3, ativo: true },
  ];
  DB.pag_config = [{ empresa_id: E, quem_elabora_nao_aprova: true, avisar_aprovadores: true }];
  const c0 = DB.contas[0]; Object.assign(c0, { banco_codigo: '341', agencia: '0123', agencia_dv: '', numero: '45678', conta_dv: '9', cnab_convenio: '', cnab_nsa: 6, cnab_layout: {} });
  const forn = DB.favorecidos.filter(f => f.tipo === 'FORNECEDORES').slice(0, 6);
  const bancos = [['237', '1234', '5', '56789', '0'], ['001', '3456', 'X', '112233', '4'], ['341', '0123', '', '99887', '1']];
  forn.forEach((f, i) => { f.documento = f.documento || `1234567800${String(i).padStart(2, '0')}95`.slice(0, 14);
    if (i % 3 === 2) Object.assign(f, { pix: 'financeiro@' + f.nome.toLowerCase().split(' ')[0] + '.com.br', pix_tipo: 'email' });
    else { const b = bancos[i % 3]; Object.assign(f, { banco_codigo: b[0], agencia: b[1], agencia_dv: b[2], conta_numero: b[3], conta_dv: b[4], conta_tipo: 'CC' }); } });
  const abertos = DB.lancamentos.filter(l => l.status === 'Em aberto' && DB.plano_contas.find(p => p.id === l.plano_id)?.tipo === 'S').slice(0, 7);
  abertos.forEach((l, i) => { if (!l.favorecido_id && forn[i % forn.length]) l.favorecido_id = forn[i % forn.length].id; });
  const vals = [1850, 3420, 12800, 27600, 64300, 980, 8450];
  DB.autorizacoes = [
    { id: 'au2', empresa_id: E, numero: 42, emissao: '2026-11-06', elaborado_por: 'Ana Souza', status: 'Pendente', total_listado: 186400, total_autorizado: vals.reduce((a, b) => a + b, 0), created_by: 'u2', created_at: '2026-11-06T15:00:00Z' },
    { id: 'au1', empresa_id: E, numero: 41, emissao: '2026-10-30', elaborado_por: 'Ana Souza', status: 'Aprovada', total_listado: 98000, total_autorizado: 41250, created_by: 'u2', created_at: '2026-10-30T15:00:00Z' },
  ];
  const fav = (l) => DB.favorecidos.find(f => f.id === l.favorecido_id)?.nome || 'Fornecedor';
  const alc = (v) => v <= 5000 ? 'pa1' : v <= 50000 ? 'pa2' : 'pa3';
  const sit2 = ['aprovado', 'aprovado', 'pendente', 'aprovado', 'pendente', 'aprovado', 'recusado'];
  DB.autorizacao_itens = [
    ...abertos.map((l, i) => ({ id: 'ai2' + i, autorizacao_id: 'au2', empresa_id: E, lancamento_id: l.id, vencimento: '2026-11-1' + (i % 9), favorecido: fav(l), descricao: l.descricao, valor: vals[i], autoriza: true, valor_autorizado: vals[i], alcada_id: alc(vals[i]), situacao: sit2[i] })),
    ...abertos.slice(0, 4).map((l, i) => ({ id: 'ai1' + i, autorizacao_id: 'au1', empresa_id: E, lancamento_id: l.id, vencimento: '2026-11-0' + (i + 3), favorecido: fav(l), descricao: l.descricao, valor: [9800, 12450, 7600, 11400][i], autoriza: true, valor_autorizado: [9800, 12450, 7600, 11400][i], alcada_id: 'pa2', situacao: 'aprovado' })),
  ];
  DB.pag_aprovacoes = [
    { id: 1, empresa_id: E, item_id: 'ai20', user_id: 'u2', email: 'ana@exemplo.com.br', aprovado: true, em: '2026-11-06T16:00:00Z' },
    { id: 2, empresa_id: E, item_id: 'ai23', user_id: 'u3', email: 'carlos@exemplo.com.br', aprovado: true, em: '2026-11-07T09:10:00Z' },
    { id: 3, empresa_id: E, item_id: 'ai24', user_id: 'u3', email: 'carlos@exemplo.com.br', aprovado: true, em: '2026-11-07T09:12:00Z' },
    { id: 4, empresa_id: E, item_id: 'ai26', user_id: 'u3', email: 'carlos@exemplo.com.br', aprovado: false, motivo: 'negociar o prazo com o fornecedor', em: '2026-11-07T09:13:00Z' },
  ];
  // um título com boleto
  if (abertos[1]) abertos[1].codigo_barras = '23797162800000124503456789012345678901234567';
  DB.pag_remessas = [{ id: 'pr6', empresa_id: E, conta_id: c0.id, autorizacao_id: 'au0', nsa: 6, data_pagamento: '2026-10-23', qtd: 5, total: 38720.4, arquivo: 'ARQUIVO FICTICIO', nome_arquivo: 'PAG_341_20261023_000006.REM', situacao: 'gerada', gerado_em: '2026-10-22T17:40:00Z' }];
  DB.pag_remessa_itens = [];
}
window.RPC.pag_remessa_criar = () => ({ id: 'prx', nsa: 7 });
window.RPC.pag_remessa_gravar = () => null;

// Comparador de fundos (SQL 110) — borderôs FICTÍCIOS de jan a jul/2026 para a série mensal
{
  const tx = { 'FUNDO ALFA': [2.15, 2.12, 2.18, 2.1, 2.08, 2.14, 2.11], 'FUNDO BETA': [2.5, 2.46, 2.52, 2.44, 2.47, 2.41, 2.43], 'FUNDO EXEMPLO FIDC': [2.62, 2.6, 2.55, 2.58, 2.49, 2.53, 2.5] };
  let k = 0;
  for (const [fundo, t] of Object.entries(tx)) t.forEach((taxa, i) => {
    for (const [pm, face] of [[28 + (i % 3) * 6, 61000 + i * 4300], [52 + (i % 2) * 14, 38000 + i * 2100]]) {
      const custo = Math.round(face * (taxa / 100) * pm / 30 / (1 + (taxa / 100) * pm / 30) * 100) / 100 + 60;
      DB.fidc_operacoes.push({ id: 'fox' + (++k), empresa_id: E, fundo, data: `2026-0${i + 1}-1${k % 9}`, bordero: 'X' + k, qtd_titulos: 6, valor_face: face, desagio: custo - 60, ad_valorem: 0, tarifas: 60, iof: 0, encargos: 0,
        recompra: 0, desc_sacado: 0, liquido: face - custo, prazo_medio: pm, custo_total: custo });
    }
  });
  for (const o of DB.fidc_operacoes) if (o.custo_total == null) o.custo_total = +o.desagio + +o.ad_valorem + +o.tarifas + +o.iof + +o.encargos;
  DB.fidc_comparador_config = [{ empresa_id: E, cdi_aa: 13.65, cdi_data: '2026-11-03', periodo_meses: 12, faixas_prazo: [30, 45, 60, 90], respeitar_limites: true, economia_minima: 100 }];
}

// Índices financeiros (SQL 111) — plano contábil resumido e balancetes mensais FICTÍCIOS (jan/2025 a nov/2026)
{
  const S = [['1', 'ATIVO'], ['1.1', 'ATIVO CIRCULANTE'], ['1.1.1', 'DISPONÍVEL'], ['1.1.2', 'CLIENTES'], ['1.1.3', 'OUTROS CRÉDITOS'], ['1.1.5', 'ESTOQUE'],
    ['1.2', 'ATIVO NÃO CIRCULANTE'], ['1.2.1', 'REALIZÁVEL A LONGO PRAZO'], ['1.2.3', 'IMOBILIZADO'], ['1.2.30.7', '(-) DEPRECIAÇÕES ACUMULADAS'],
    ['2', 'PASSIVO'], ['2.1', 'PASSIVO CIRCULANTE'], ['2.1.1', 'OBRIGAÇÕES DO CIRCULANTE'], ['2.1.3', 'FORNECEDORES'], ['2.1.4', 'OBRIGAÇÕES TRIBUTÁRIAS'], ['2.1.5', 'OBRIGAÇÕES TRABALHISTAS'],
    ['2.2', 'PASSIVO NÃO CIRCULANTE'], ['2.2.1', 'PASSIVO EXIGÍVEL A LONGO PRAZO'], ['2.3', 'PATRIMÔNIO LÍQUIDO'], ['2.3.1', 'CAPITAL SOCIAL'], ['2.3.5', 'LUCROS OU PREJUÍZOS ACUMULADOS'],
    ['3', 'CUSTOS E DESPESAS'], ['3.2', 'DESPESAS OPERACIONAIS'], ['3.2.1', 'DESPESAS COM VENDAS'], ['3.2.2', 'DESPESAS ADMINISTRATIVAS'], ['3.2.20.5', 'DESPESAS FINANCEIRAS'],
    ['4', 'RECEITAS'], ['4.1', 'RECEITAS OPERACIONAIS'], ['4.1.1', 'RECEITA BRUTA DE VENDAS'], ['4.1.2', '(-) DEDUÇÕES DA RECEITA BRUTA'], ['4.1.3', 'RECEITAS FINANCEIRAS'],
    ['5', 'CONTAS DE APURAÇÃO'], ['5.1', 'CUSTOS DOS PRODUTOS VENDIDOS']];
  const pai = (c) => { const p = c.split('.'); for (let n = p.length - 1; n > 0; n--) { const x = S.find(s => s[0] === p.slice(0, n).join('.')); if (x) return 'ix-' + x[0]; } return null; };
  DB.contab_contas = (DB.contab_contas || []).concat(S.map(([c, d]) => ({ id: 'ix-' + c, empresa_id: E, classificacao: c, descricao: d, tipo: 'S', natureza: ['1', '3', '5'].includes(c[0]) ? 'D' : 'C', nivel: c.split('.').length, pai_id: pai(c) })));
  const A = {}; // analíticas: uma por grupo
  for (const c of ['1.1.1', '1.1.2', '1.1.3', '1.1.5', '1.2.1', '1.2.3', '1.2.30.7', '2.1.1', '2.1.3', '2.1.4', '2.1.5', '2.2.1', '2.3.1', '2.3.5', '3.2.1', '3.2.2', '3.2.20.5', '4.1.1', '4.1.2', '4.1.3', '5.1']) {
    A[c] = 'ixa-' + c; DB.contab_contas.push({ id: A[c], empresa_id: E, classificacao: c + '.1.0001', descricao: S.find(s => s[0] === c)[1] + ' (exemplo)', tipo: 'A', natureza: ['1', '3', '5'].includes(c[0]) ? 'D' : 'C', nivel: c.split('.').length + 2, pai_id: 'ix-' + c });
  }
  DB.contab_saldos_abertura = [{ empresa_id: E, conta_id: A['1.1.1'], data: '2024-12-31', saldo: 0 }];
  DB.contab_balancetes = DB.contab_balancetes || [];
  DB.indices_config = [];
  DB.indices_comentarios = [{ empresa_id: E, mes: '2026-10-01', texto: 'A liquidez corrente voltou a subir em outubro com a renegociação de fornecedores para 60 dias. O prazo de recebimento caiu com a cessão de títulos ao FIDC.\nPróximo passo: alongar a dívida bancária de curto prazo.', atualizado_em: '2026-11-05T10:00:00Z' }];
  // série mensal: t = 0 (jan/2025) … 22 (nov/2026); valores redondos e fictícios
  const t0 = (ym) => (+ym.slice(0, 4) - 2025) * 12 + (+ym.slice(5, 7) - 1);
  const fluxo = (t) => { const rb = 2600000 + 180000 * Math.sin(t / 2) + 9000 * t; return { rb, ded: rb * 0.22, cmv: rb * 0.78 * 0.66, dv: rb * 0.05, da: 205000, df: 128000 - 1500 * t, rf: 6000, dep: 75000 }; };
  const saldoFim = (t) => {
    const crise = Math.exp(-((t - 15) ** 2) / 18);   // aperto no meio de 2026
    const v = {
      '1.1.1': 260000 - 170000 * crise + 4000 * t, '1.1.2': 2300000 - 380000 * crise - 9000 * t, '1.1.3': 310000, '1.1.5': 1500000 + 250000 * crise, '1.2.1': 420000,
      '1.2.3': 9200000 + 20000 * t, '1.2.30.7': -(3100000 + 75000 * (t + 1)),
      '2.1.1': -(1350000 + 220000 * crise - 8000 * t), '2.1.3': -(1450000 + 300000 * crise + 8000 * t), '2.1.4': -820000, '2.1.5': -460000, '2.2.1': -(5200000 - 30000 * t), '2.3.1': -3000000,
    };
    // resultado do ano corrente (jan até o mês) nas contas de resultado
    const ano = Math.floor(t / 12) * 12; const ac = { '4.1.1': 0, '4.1.2': 0, '5.1': 0, '3.2.1': 0, '3.2.2': 0, '3.2.20.5': 0, '4.1.3': 0 };
    for (let k = ano; k <= t; k++) { const f = fluxo(k); ac['4.1.1'] -= f.rb; ac['4.1.2'] += f.ded; ac['5.1'] += f.cmv; ac['3.2.1'] += f.dv; ac['3.2.2'] += f.da + f.dep; ac['3.2.20.5'] += f.df; ac['4.1.3'] -= f.rf; }
    Object.assign(v, ac);
    v['2.3.5'] = -Object.values(v).reduce((s, x) => s + x, 0);   // prejuízos acumulados fecham o balanço
    return v;
  };
  window.RPC.contab_balancete_gerencial = (a) => {
    const t = t0(String(a.p_fim)); if (t < 0) return [];
    const fim = saldoFim(t), ini = t % 12 === 0 ? Object.fromEntries(Object.keys(fim).map(k => [k, /^[345]/.test(k) ? 0 : saldoFim(t - 1)[k]])) : saldoFim(t - 1);
    const f = fluxo(t), mov = { '4.1.1': [0, f.rb], '4.1.2': [f.ded, 0], '5.1': [f.cmv, 0], '3.2.1': [f.dv, 0], '3.2.2': [f.da + f.dep, 0], '3.2.20.5': [f.df, 0], '4.1.3': [0, f.rf], '1.2.30.7': [0, f.dep] };
    return Object.keys(fim).map(c => { const d = fim[c] - (ini[c] || 0); const [db, cr] = mov[c] || (d >= 0 ? [d, 0] : [0, -d]);
      return { conta_id: A[c], saldo_anterior: Math.round((ini[c] || 0) * 100) / 100, debito: Math.round(db * 100) / 100, credito: Math.round(cr * 100) / 100, saldo_atual: Math.round(fim[c] * 100) / 100 }; });
  };
}

// Implantação do estoque (SQL 112) — situação FICTÍCIA no meio da implantação
{
  DB.est_implantacao_config = [];
  DB.est_implantacao_etapas = [
    { empresa_id: E, etapa: 'espelho', responsavel: 'Controladoria', prevista: '2026-11-04', observacao: 'Saldo de 31/10 exportado do Iniflex' },
    { empresa_id: E, etapa: 'cadastro', responsavel: 'Compras', prevista: '2026-11-13' },
    { empresa_id: E, etapa: 'depara', responsavel: 'Compras', prevista: '2026-11-06' },
    { empresa_id: E, etapa: 'cfop', responsavel: 'Fiscal', prevista: '2026-11-12' },
    { empresa_id: E, etapa: 'saldo', responsavel: 'Controladoria', prevista: '2026-11-20' },
  ];
  window.RPC.est_implantacao_situacao = (a) => ({
    desde: a.p_desde || '2025-11-08',
    espelho: { qtd: 1, data_ref: '2026-10-31', linhas: 1284, valor: 3864210.55, depositos: 6 },
    locais: { ativos: 14, setores: 3, setores_sem_local: 0 },
    cadastro: { produtos: 1655, nao_acabados: 767, esp_linhas: 1284, esp_ligadas: 1037, esp_valor: 3864210.55, esp_valor_ligado: 3520114.9, sem_familia: 4 },
    depara: { qtd: 1102 },
    prontidao: { resumo: [
      { sentido: 'entrada', resultado: 'ok', itens: 4120, valor: 21450300 }, { sentido: 'entrada', resultado: 'nao_movimenta', itens: 610, valor: 1880400 },
      { sentido: 'entrada', resultado: 'sem_produto', itens: 362, valor: 1715200 }, { sentido: 'entrada', resultado: 'sem_regra', itens: 48, valor: 96400 },
      { sentido: 'saida', resultado: 'ok', itens: 9210, valor: 30875000 }, { sentido: 'saida', resultado: 'nao_movimenta', itens: 130, valor: 412000 },
      { sentido: 'saida', resultado: 'sem_regra', itens: 21, valor: 58300 } ],
      cfops_sem_regra: [{ sentido: 'entrada', cfop: '1949', itens: 41, valor: 82100, exemplo: 'PALETE DE MADEIRA (RETORNO)' }, { sentido: 'saida', cfop: '5915', itens: 21, valor: 58300, exemplo: 'CILINDRO PARA CONSERTO' }, { sentido: 'entrada', cfop: '1916', itens: 7, valor: 14300, exemplo: 'RETORNO DE CONSERTO' }] },
    saldo: { implantado_em: null, movimentos: 0, valor: 0 },
    automatico: { ligado: false, pendencias: 0 },
    fechamento: { qtd: 0, ultimo: null },
  });
}

// OEE (SQL 113) — números FICTÍCIOS por máquina e período (a função do banco é simulada aqui)
{
  DB.prod_oee_config = [{ empresa_id: E, meta_oee: 65, meta_disp: 85, meta_perf: 85, meta_qual: 95, atencao_pp: 10, metas_maquina: {}, contar_os_manutencao: true }];
  // perfil de cada máquina: disponibilidade, desempenho e refugo médios
  const PERF = { 'EXT-01': [0.86, 0.84, 0.045], 'EXT-02': [0.74, 0.79, 0.07], 'IMP-01': [0.81, 0.72, 0.03], 'CS-01': [0.66, 0.88, 0.055] };
  const MOT = [['Setup / troca de pedido', true], ['Falta de material', false], ['Ajuste de solda', false], ['Limpeza programada', true], ['Falta de operador', false], ['Troca de bobina', false]];
  window.RPC.prod_oee = (a) => {
    const de = a.p_de, ate = a.p_ate, g = a.p_grupo || 'dia', dias = [];
    for (let d = new Date(de + 'T12:00:00'); d.toISOString().slice(0, 10) <= ate; d.setDate(d.getDate() + 1)) dias.push(d.toISOString().slice(0, 10));
    const perDe = (d) => { if (g === 'dia') return d; if (g === 'mes') return d.slice(0, 8) + '01'; const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
    const grupos = new Map(); for (const d of dias) (grupos.get(perDe(d)) || grupos.set(perDe(d), []).get(perDe(d))).push(d);
    const linhas = [], paradas = [], refugos = [];
    DB.prod_maquinas.forEach((m, mi) => {
      const [dsp, pf, rf] = PERF[m.codigo] || [0.8, 0.8, 0.05];
      let k = 0;
      for (const [per, ds] of grupos) {
        k++; const onda = 1 + 0.06 * Math.sin(k / 1.7 + mi), cal = 22 * ds.length, plan = cal * 0.07, tp = cal - plan;
        const run = tp * Math.min(0.98, dsp * onda), prod = run * m.capacidade_kg_h * Math.min(0.99, pf * (2 - onda) ** 0.3), ref = prod * rf * (2 - onda);
        const os = mi === 1 && k % 3 === 0 ? 6.5 : 0, naoPl = Math.max(0, (tp - run) * 0.62 - os);
        linhas.push({ maquina_id: m.id, per, horas_cal: cal, dias: ds.length, horas_run: +run.toFixed(2), bom: Math.round(prod - ref), refugo: Math.round(ref), apont: ds.length * 3, h_plan: +plan.toFixed(2), h_nao_plan: +naoPl.toFixed(2), h_os: os, qtd_os: os ? 1 : 0 });
      }
      const tot = dias.length * 22;
      MOT.forEach(([motivo, planejada], j) => { const h = tot * (planejada ? 0.035 : [0, 0.05, 0.018, 0, 0.012, 0.022][j]) * (1 + mi * 0.15); if (h > 0) paradas.push({ maquina_id: m.id, motivo, planejada, qtd: Math.max(1, Math.round(h / 1.4)), horas: +h.toFixed(2) }); });
      if (mi === 1) paradas.push({ maquina_id: m.id, motivo: 'Manutenção (OS corretiva)', planejada: false, qtd: 2, horas: 13 });
      [['Bolha / furo no filme', 0.42], ['Espessura fora', 0.25], ['Registro de impressão', 0.18], ['Solda fraca', 0.15]].forEach(([motivo, p]) => refugos.push({ maquina_id: m.id, motivo, kg: Math.round(tot * m.capacidade_kg_h * 0.8 * (PERF[m.codigo]?.[2] || 0.05) * p) }));
    });
    return { de, ate, grupo: g, linhas, paradas, refugos };
  };
}

// Custo das OPs (SQL 114) — composição FICTÍCIA de algumas OPs (a função do banco é simulada aqui)
{
  DB.prod_custo_config = [{ empresa_id: E, custo_hora_padrao: 180, ratear_manutencao: true, dias_preco: 90, tolerancia_pct: 10, margem_minima_pct: 15 }];
  const OPS = [
    [1203, 'PA-210 BOBINA PEAD 30CM 0,05', 'FARMÁCIAS', 1800, 1760, 74, 8.42, 8.31, 0, 12.6, 260, 14.4, 9.6, 'concluida', '2026-11-03'],
    [1198, 'PA-100 SACO PEBD 40X60 0,10', 'SUPERMERCADOS', 5200, 5060, 310, 8.37, 8.31, 2950, 18.5, 380, 13.9, 11.2, 'concluida', '2026-10-28'],
    [1195, 'PA-100 SACO PEBD 40X60 0,10', 'ATACADO', 3000, 2810, 290, 9.25, 8.31, 1840, 15.2, 650, 13.9, 10.4, 'concluida', '2026-10-22'],
    [1191, 'PA-210 BOBINA PEAD 30CM 0,05', 'DISTRIBUIDORA', 2400, 2390, 61, 8.25, 8.31, 0, 13.0, 0, 14.6, 9.7, 'concluida', '2026-10-15'],
    [1187, 'PA-305 SACOLA ALÇA CAMISETA', 'SUPERMERCADOS', 1500, 1430, 95, 9.10, 8.85, 1120, 11.4, 210, 13.4, 11.8, 'concluida', '2026-10-09'],
    [1204, 'PA-100 SACO PEBD 40X60 0,10', 'SUPERMERCADOS', 4800, 2160, 140, 8.33, 8.31, 0, 7.1, 0, null, 10.1, 'em_producao', '2026-11-07'],
  ];
  const bruto = ([numero, produto, cliente, qtd, bom, ref, cMat, cMatOrc, tinta, horas, manut, preco, horasOrc, status, ref_dt], i) => ({
    ordem: { id: 'opc' + i, numero, numero_iniflex: String(81000 + numero), produto, quantidade: qtd, unidade: 'KG', status, cliente, referencia: ref_dt },
    producao: { bom, refugo: ref },
    material: [{ codigo: 'MP-001', descricao: 'RESINA PEBD LINEAR', qtd: Math.round((bom + ref) * 0.93), custo: cMat, fonte: 'custo médio', valor: Math.round((bom + ref) * 0.93 * cMat * 100) / 100 },
      { codigo: 'MP-002', descricao: 'MASTERBATCH BRANCO', qtd: Math.round((bom + ref) * 0.07), custo: 14.2, fonte: i === 4 ? 'última compra' : 'custo médio', valor: Math.round((bom + ref) * 0.07 * 14.2 * 100) / 100 }],
    tinta: tinta ? [{ numero: 300 + i, cor: 'AZUL PROCESSO', kg: Math.round(tinta / 38), valor: tinta }] : [],
    maquina: [{ codigo: 'EXT-01', nome: 'EXTRUSORA 1', setor: 'Extrusão', horas: Math.round(horas * 0.6 * 10) / 10, custo_hora: 180, valor: Math.round(horas * 0.6 * 180) },
      { codigo: 'CS-01', nome: 'CORTE E SOLDA 1', setor: 'Corte e solda', horas: Math.round(horas * 0.4 * 10) / 10, custo_hora: 120, valor: Math.round(horas * 0.4 * 120) }],
    manutencao: manut ? [{ maquina_id: 'm', mes: ref_dt.slice(0, 8) + '01', horas_op: Math.round(horas * 0.6), horas_mes: 410, custo_mes: Math.round(manut * 410 / (horas * 0.6)), valor: manut }] : [],
    orcado: { material: [{ codigo: 'MP-001', valor: Math.round(qtd * 1.02 * 0.93 * cMatOrc) }, { codigo: 'MP-002', valor: Math.round(qtd * 1.02 * 0.07 * 14.2) }], maquina: [{ setor: 'Extrusão', horas: horasOrc, custo_hora: 180, valor: horasOrc * 180 * qtd / 1000 }], tem_estrutura: true },
    venda: { preco, valor: preco ? preco * 20000 : null, qtd: preco ? 20000 : null, notas: preco ? 9 : 0, dias: 90 },
  });
  const LISTA = OPS.map(bruto);
  window.RPC.prod_custo_ops = () => LISTA;
  window.RPC.prod_custo_op = (a) => LISTA.find(x => x.ordem.id === a.p_ordem) || LISTA[0];
}

// Rastreabilidade (SQL 115) — caminho FICTÍCIO de um lote de resina até os clientes
{
  DB.prod_rastreio_config = [{ empresa_id: E, qr_link: true, exigir_nota: true }];
  const o1 = { id: 'rto1', numero: 1188, numero_iniflex: '81188', produto: 'PI-040 BOBINA PEBD 40CM 0,08 (extrusão)', cliente: 'SUPERMERCADOS', status: 'concluida', emissao: '2026-10-12' };
  const o2 = { id: 'rto2', numero: 1190, numero_iniflex: '81190', produto: 'PA-100 SACO PEBD 40X60 0,10 IMPRESSO', cliente: 'SUPERMERCADOS', status: 'concluida', emissao: '2026-10-14' };
  const b = (codigo, ordem_id, peso, sit, extra = {}) => ({ id: 'rtb-' + codigo, codigo, ordem_id, peso_kg: peso, situacao: sit, qualidade: 'liberada', maquina: ordem_id === 'rto1' ? 'EXT-01' : 'IMP-01', criado_em: '2026-10-13T10:00:00Z', ...extra });
  const bob = [b('B-104511', 'rto1', 612.4, 'consumida', { lote_materia: 'LT-BK-2291' }), b('B-104512', 'rto1', 598.1, 'consumida', { lote_materia: 'LT-BK-2291' }), b('B-104513', 'rto1', 605.0, 'estoque', { lote_materia: 'LT-BK-2291', qualidade: 'bloqueada' }),
    b('B-104620', 'rto2', 590.2, 'expedida', { mae_id: 'rtb-B-104511', nota_id: 'rtn1', nota: 4561, expedida_em: '2026-10-16T14:00:00Z' }), b('B-104621', 'rto2', 583.7, 'expedida', { mae_id: 'rtb-B-104512', nota_id: 'rtn2', nota: 4570, expedida_em: '2026-10-18T09:00:00Z' })];
  window.RPC.prod_rastrear = (a) => ({
    termo: String(a.p_termo || '').toUpperCase(), achados: [{ tipo: 'lote', txt: 'Lote ' + String(a.p_termo || '').toUpperCase() }],
    ops: [o1, o2], bobinas: bob,
    materiais: [{ ordem_id: 'rto1', codigo: 'MP-001', descricao: 'RESINA PEBD LINEAR', lote: 'LT-BK-2291', lote_fornecedor: 'BRK-26-0918-A', qtd: 1450, fornecedor: 'RESINAS DO BRASIL S.A.', nota_entrada: 88214, nota_entrada_data: '2026-10-02' },
      { ordem_id: 'rto1', codigo: 'MP-002', descricao: 'MASTERBATCH BRANCO', lote: 'MB-7731', qtd: 95, fornecedor: 'COLOR MASTER LTDA', nota_entrada: 1182, nota_entrada_data: '2026-09-25' }],
    tintas: [{ ordem_id: 'rto2', numero: 312, cor: 'AZUL PROCESSO', lote: 'TI-312', kg: 38.5, situacao: 'entregue', componentes: [{ codigo: 'TN-BASE-AZ', lote: 'L-5521', lote_fornecedor: 'SK-2210' }, { codigo: 'TN-VERNIZ', lote: 'L-5490' }] }],
    qualidade: [{ tipo: 'inspeção', numero: 211, situacao: 'aprovada', ordem_id: 'rto1' }, { tipo: 'RNC', numero: 37, situacao: 'em_analise', bobina_id: 'rtb-B-104513' }],
    notas: [{ id: 'rtn1', numero: 4561, emissao: '2026-10-16', cliente: 'SUPERMERCADOS EXEMPLO LTDA', cnpj: '11', uf: 'PE', bobinas: 1, kg: 590.2, carga: 88, entrega: 'entregue' },
      { id: 'rtn2', numero: 4570, emissao: '2026-10-18', cliente: 'ATACADO MODELO S.A.', cnpj: '22', uf: 'PB', bobinas: 1, kg: 583.7, carga: 91, entrega: 'pendente' }],
  });
}

// Preventivas por horas e peças críticas (SQL 116) — situação FICTÍCIA
{
  const hoje = new Date('2026-11-08T12:00:00'), d = (n) => { const x = new Date(hoje); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  window.RPC.man_preventivas_horas = () => [
    { plano_id: 'ph1', plano: 'Troca do óleo da redutora', equipamento: 'EXT-02 EXTRUSORA 2', criticidade: 'A', a_cada_horas: 2000, desde_ultima: 2045, pct: 102.3, ritmo_h_dia: 19.4, dias_restantes: 0, previsao: d(0), fonte: 'horímetro + apontamentos', os_aberta: 1 },
    { plano_id: 'ph2', plano: 'Revisão das resistências do cilindro', equipamento: 'EXT-01 EXTRUSORA 1', criticidade: 'A', a_cada_horas: 1500, desde_ultima: 1388, pct: 92.5, ritmo_h_dia: 20.1, dias_restantes: 5.6, previsao: d(6), fonte: 'horímetro + apontamentos', os_aberta: 1 },
    { plano_id: 'ph3', plano: 'Lubrificação dos rolos de impressão', equipamento: 'IMP-01 IMPRESSORA FLEXO', criticidade: 'B', a_cada_horas: 500, desde_ultima: 341, pct: 68.2, ritmo_h_dia: 16.8, dias_restantes: 9.5, previsao: d(10), fonte: 'apontamentos', os_aberta: 0 },
    { plano_id: 'ph4', plano: 'Troca da lâmina de solda', equipamento: 'CS-01 CORTE E SOLDA 1', criticidade: 'B', a_cada_horas: 800, desde_ultima: 302, pct: 37.8, ritmo_h_dia: 14.2, dias_restantes: 35.1, previsao: d(36), fonte: 'apontamentos', os_aberta: 0 },
    { plano_id: 'ph5', plano: 'Inspeção do bobinador', equipamento: 'EXT-02 EXTRUSORA 2', criticidade: 'A', a_cada_horas: 1000, desde_ultima: 210, pct: 21, ritmo_h_dia: 19.4, dias_restantes: 40.7, previsao: d(41), fonte: 'horímetro + apontamentos', os_aberta: 0 }];
  window.RPC.man_pecas_situacao = () => [
    { id: 'pc1', produto_id: 'pp1', codigo: 'PC-RES-220', descricao: 'RESISTÊNCIA CERÂMICA 220V 1500W', unidade: 'UN', equipamento: 'EXT-01 EXTRUSORA 1', minimo: 4, ponto_pedido: 6, saldo: 3, consumo_12m: 14, previsto_planos: 4, situacao: 'abaixo', ultimo_preco: 385.0 },
    { id: 'pc2', produto_id: 'pp2', codigo: 'PC-LAM-800', descricao: 'LÂMINA DE SOLDA 800 MM', unidade: 'UN', equipamento: 'CS-01 CORTE E SOLDA 1', minimo: 2, ponto_pedido: 3, saldo: 3, consumo_12m: 9, previsto_planos: 1, situacao: 'comprar', ultimo_preco: 212.4 },
    { id: 'pc3', produto_id: 'pp3', codigo: 'PC-ROL-6206', descricao: 'ROLAMENTO 6206 2RS', unidade: 'UN', equipamento: null, minimo: 6, ponto_pedido: 10, saldo: 18, consumo_12m: 22, previsto_planos: 2, situacao: 'ok', ultimo_preco: 48.9 },
    { id: 'pc4', produto_id: 'pp4', codigo: 'PC-OLEO-220', descricao: 'ÓLEO REDUTOR ISO 220 (BALDE 20 L)', unidade: 'UN', equipamento: 'EXT-02 EXTRUSORA 2', minimo: 1, ponto_pedido: 2, saldo: 2, consumo_12m: 5, previsto_planos: 1, situacao: 'comprar', ultimo_preco: 690.0 },
    { id: 'pc5', produto_id: 'pp5', codigo: 'PC-COR-B68', descricao: 'CORREIA B-68', unidade: 'UN', equipamento: 'IMP-01 IMPRESSORA FLEXO', minimo: 2, ponto_pedido: 3, saldo: 5, consumo_12m: 4, previsto_planos: 0, situacao: 'ok', ultimo_preco: 75.3 }];
  DB.man_parametros = (DB.man_parametros || []).map(p => ({ ...p, gerar_horas_pct: 90, dias_ritmo: 30, horizonte_pecas_dias: 30, avisar_pecas: true, avisar_pecas_dias: 7 }));
}

// Previsão de tinta (SQL 117) — programação e fichas FICTÍCIAS
{
  const d = (n) => { const x = new Date('2026-11-08T12:00:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const CO = [['tpc1', 'AZ-286', 'AZUL PROCESSO 286', '#0033a0'], ['tpc2', 'VM-485', 'VERMELHO 485', '#da291c'], ['tpc3', 'AM-109', 'AMARELO 109', '#ffd100'], ['tpc4', 'BR-OP', 'BRANCO OPACO', '#f4f4f4'], ['tpc5', 'VD-354', 'VERDE 354', '#00b140']];
  const P = [['tpp1', 'PA-100', 'SACO PEBD 40X60 0,10 IMPRESSO'], ['tpp2', 'PA-305', 'SACOLA ALÇA CAMISETA'], ['tpp3', 'PA-410', 'SACO PADARIA 30X45']];
  DB.tin_previsao_config = [{ empresa_id: E, horizonte_dias: 14, ops_media: 10, consumo_padrao_g_kg: 0, setor_impressao_id: null }];
  DB.tin_produto_cores = [['tpp1', 'tpc1', 9.5], ['tpp1', 'tpc4', 14], ['tpp2', 'tpc2', null], ['tpp2', 'tpc3', 6.2], ['tpp3', 'tpc5', 7.8]].map(([produto_id, cor_id, consumo_g_kg], i) => ({ id: 'tpf' + i, empresa_id: E, produto_id, cor_id, consumo_g_kg }));
  DB.produtos = DB.produtos.concat(P.filter(([id]) => !DB.produtos.some(x => x.id === id)).map(([id, codigo, descricao]) => ({ id, empresa_id: E, codigo, descricao, unidade: 'KG', tipo_sped: '04', ativo: true })));
  DB.tin_cores = (DB.tin_cores || []).concat(CO.filter(([id]) => !(DB.tin_cores || []).some(c => c.id === id)).map(([id, codigo, nome, hex]) => ({ id, empresa_id: E, codigo, nome, hex, ativo: true })));
  window.RPC.tin_consumo_real = () => [{ produto_id: 'tpp1', cor_id: 'tpc1', ops: 8, g_kg: 10.4 }, { produto_id: 'tpp1', cor_id: 'tpc4', ops: 8, g_kg: 13.1 }, { produto_id: 'tpp2', cor_id: 'tpc2', ops: 5, g_kg: 8.9 }, { produto_id: 'tpp2', cor_id: 'tpc3', ops: 5, g_kg: 7.6 }];
  const op = (n, prod, cli, dd, kgp, gkg, fonte) => ({ op: n, numero_iniflex: String(81000 + n), produto: prod, cliente: cli, data: d(dd), kg_produto: kgp, g_kg: gkg, fonte, kg_tinta: Math.round(kgp * gkg) / 1000 });
  window.RPC.tin_previsao = () => ({ horizonte: 14, ate: d(14), cores: [
    { cor_id: 'tpc1', codigo: 'AZ-286', nome: 'AZUL PROCESSO 286', hex: '#0033a0', necessidade: 68.4, sobra: 12.5, preparar: 55.9, primeira: d(1), tem_receita: true, sobras: [{ ordem: 298, lote: 'TI-298', kg: 7.5, validade: d(9) }, { ordem: 305, lote: 'TI-305', kg: 5.0, validade: d(21) }],
      ops: [op(1206, 'PA-100 SACO PEBD 40X60 0,10 IMPRESSO', 'ATACADO', 1, 3200, 9.5, 'ficha'), op(1211, 'PA-100 SACO PEBD 40X60 0,10 IMPRESSO', 'SUPERMERCADOS', 6, 4000, 9.5, 'ficha')] },
    { cor_id: 'tpc4', codigo: 'BR-OP', nome: 'BRANCO OPACO', hex: '#f4f4f4', necessidade: 100.8, sobra: 0, preparar: 100.8, primeira: d(1), tem_receita: true, sobras: [], ops: [op(1206, 'PA-100 SACO PEBD 40X60 0,10 IMPRESSO', 'ATACADO', 1, 3200, 14, 'ficha'), op(1211, 'PA-100 SACO PEBD 40X60 0,10 IMPRESSO', 'SUPERMERCADOS', 6, 4000, 14, 'ficha')] },
    { cor_id: 'tpc2', codigo: 'VM-485', nome: 'VERMELHO 485', hex: '#da291c', necessidade: 22.3, sobra: 9.2, preparar: 13.1, primeira: d(3), tem_receita: true, sobras: [{ ordem: 301, lote: 'TI-301', kg: 9.2, validade: d(15) }], ops: [op(1208, 'PA-305 SACOLA ALÇA CAMISETA', 'FARMÁCIAS', 3, 2500, 8.9, 'média de 5 OP(s)')] },
    { cor_id: 'tpc3', codigo: 'AM-109', nome: 'AMARELO 109', hex: '#ffd100', necessidade: 15.5, sobra: 0, preparar: 15.5, primeira: d(3), tem_receita: false, sobras: [], ops: [op(1208, 'PA-305 SACOLA ALÇA CAMISETA', 'FARMÁCIAS', 3, 2500, 6.2, 'ficha')] }],
    insumos: [{ codigo: 'TN-BASE-BR', descricao: 'BASE BRANCA NC', unidade: 'KG', necessidade: 78.6, saldo: 64 }, { codigo: 'TN-BASE-AZ', descricao: 'CONCENTRADO AZUL FTALO', unidade: 'KG', necessidade: 31.3, saldo: 58 },
      { codigo: 'SOLV-ACET', descricao: 'ACETATO DE ETILA', unidade: 'KG', necessidade: 42.5, saldo: 180 }, { codigo: 'TN-BASE-VM', descricao: 'CONCENTRADO VERMELHO RUBI', unidade: 'KG', necessidade: 7.9, saldo: 12 }],
    sem_ficha: [{ op: 1213, produto: 'PA-512 SACO FRUTAS 25X35', produto_id: null, data: d(9), kg: 1800 }], sem_consumo: [],
    sobras_paradas: [{ ordem: 288, cor: 'LJ-151 LARANJA 151', hex: '#ff8200', lote: 'TI-288', kg: 6.3, validade: d(4) }, { ordem: 292, cor: 'PT-PRETO PRETO', hex: '#111', lote: 'TI-292', kg: 11.8, validade: d(26) }] });
  DB.tin_receitas = DB.tin_receitas || [];
}

// Planta ao vivo (SQL 118) — planta e situação FICTÍCIAS: produzindo, em manutenção, parada longa e setup
{
  const [s0, s1, s2] = DB.prod_setores, M = (c) => DB.prod_maquinas.find(m => m.codigo === c);
  const agoraMenos = (min) => new Date(Date.now() - min * 6e4).toISOString();
  DB.prod_planta = [{ empresa_id: E, largura_m: 52, profundidade_m: 24, elementos: [
    { id: 'pe1', t: 'setor', x: 2, y: 2, w: 14, d: 16, nome: s0.nome, setor_id: s0.id }, { id: 'pe2', t: 'setor', x: 20, y: 2, w: 12, d: 16, nome: s1.nome, setor_id: s1.id },
    { id: 'pe3', t: 'setor', x: 36, y: 2, w: 13, d: 16, nome: s2.nome, setor_id: s2.id }, { id: 'pe4', t: 'seta', de: 'pe1', para: 'pe2' }, { id: 'pe5', t: 'seta', de: 'pe2', para: 'pe3' },
    { id: 'pe6', t: 'corredor', x: 1, y: 19.5, w: 50, d: 2.5 }] }];
  [['EXT-01', 4, 4, 'extrusora'], ['EXT-02', 4, 11, 'extrusora'], ['IMP-01', 22, 6, 'impressora'], ['CS-01', 38, 6, 'corte_solda']].forEach(([c, x, y, tv]) => Object.assign(M(c), { pos_x: x, pos_y: y, rotacao: 0, tipo_visual: tv }));
  DB.prod_motivos = [['pm-fm', 'Falta de material', false], ['pm-man', 'Manutenção corretiva', false], ['pm-set', 'Setup / troca de pedido', true]].map(([id, nome, planejada]) => ({ id, empresa_id: E, tipo: 'parada', nome, planejada, ativo: true }));
  const op = DB.prod_ordens.find(o => o.status === 'em_producao') || DB.prod_ordens[0];
  DB.prod_apontamentos = [{ id: 'pa-vivo', empresa_id: E, ordem_id: op.id, maquina_id: M('EXT-01').id, setor_id: s0.id, inicio: agoraMenos(150), fim: null, qtd_boa: 0, refugo: 0, operador_nome: 'ANA PAULA FERREIRA', origem: 'plataforma' }];
  DB.prod_bobinas = (DB.prod_bobinas || []).concat([1, 2, 3, 4].map(i => ({ id: 'pbv' + i, empresa_id: E, codigo: 'B-1047' + i, ordem_id: op.id, apontamento_id: 'pa-vivo', maquina_id: M('EXT-01').id, peso_kg: 112 + i * 3, situacao: 'estoque', qualidade: 'liberada' })));
  DB.prod_paradas = [{ id: 'pp-man', empresa_id: E, maquina_id: M('EXT-02').id, motivo_id: 'pm-man', inicio: agoraMenos(52), fim: null },
    { id: 'pp-fm', empresa_id: E, maquina_id: M('IMP-01').id, motivo_id: 'pm-fm', inicio: agoraMenos(38), fim: null },
    { id: 'pp-set', empresa_id: E, maquina_id: M('CS-01').id, motivo_id: 'pm-set', inicio: agoraMenos(12), fim: null }];
  DB.prod_planta_config = [{ empresa_id: E, atualizar_seg: 30, parada_longa_min: 20, avisar_parada: true, avisar_papeis: ['admin', 'diretor'], tempo_real: true }];
  // OS aberta que parou a EXT-02 (o equipamento ligado à máquina vem junto, como no select com join)
  const eq = (DB.man_equipamentos || []).find(e => e.maquina_id === M('EXT-02').id) || { id: 'me-ext2' };
  DB.man_ordens = (DB.man_ordens || []).map(o => ({ ...o, man_equipamentos: { maquina_id: (DB.man_equipamentos || []).find(e => e.id === o.equipamento_id)?.maquina_id || null } }));
  DB.man_ordens.push({ id: 'mo-vivo', empresa_id: E, numero: 131, equipamento_id: eq.id, tipo: 'corretiva', prioridade: 'alta', situacao: 'em_execucao', descricao: 'Resistência da zona 3 queimada', responsavel: 'Marcos Lima', maquina_parou: true, parada_inicio: agoraMenos(52), parada_id: 'pp-man', man_equipamentos: { maquina_id: M('EXT-02').id } });
}

// Reposição de estoque (SQL 119) — cálculo FICTÍCIO com o estoque já implantado
{
  DB.est_reposicao_config = [{ empresa_id: E, janela_dias: 90, nivel_servico: 95, lead_time_padrao: 15, intervalo_compra_dias: 15, parado_dias: 90, fonte: 'auto' }];
  const R = (id, codigo, descricao, un, familia, d, sd, lt, ltf, minAt, ppAt, saldo, ped, custo, parado) => {
    const es = Math.round(1.65 * sd * Math.sqrt(lt) * 10) / 10, pp = Math.round((d * lt + es) * 10) / 10, mx = Math.round((pp + d * 15) * 10) / 10;
    const sit = d === 0 && saldo > 0 && parado >= 90 ? 'parado' : saldo <= es ? 'critico' : saldo + ped <= pp ? 'comprar' : saldo > mx * 2 ? 'excesso' : 'ok';
    return { produto_id: id, codigo, descricao, unidade: un, familia, fonte: 'kardex', consumo_janela: Math.round(d * 90), consumo_dia: d, sigma_dia: sd, lead_time: lt, lead_fonte: ltf, estoque_seguranca: es, ponto_pedido: pp, estoque_maximo: mx,
      minimo_atual: minAt, ponto_atual: ppAt, saldo, em_pedido: ped, cobertura_dias: d ? Math.round(saldo / d * 10) / 10 : null, giro_anual: d && saldo ? Math.round(d * 365 / saldo * 100) / 100 : null,
      dias_sem_saida: parado, valor_saldo: Math.round(saldo * custo * 100) / 100, custo, sugestao: sit === 'critico' || sit === 'comprar' ? Math.max(0, Math.round((mx - saldo - ped) * 10) / 10) : 0, situacao: sit };
  };
  window.RPC.est_reposicao = () => [
    R('rp1', 'MP-001', 'RESINA PEBD LINEAR', 'KG', 'Resinas', 1420, 380, 12, 'real', 8000, 15000, 1800, 0, 8.4, 0),
    R('rp2', 'MP-002', 'MASTERBATCH BRANCO', 'KG', 'Masterbatch', 96, 31, 20, 'produto', 500, 1500, 1820, 1000, 14.2, 1),
    R('rp3', 'MP-007', 'RESINA PEAD SOPRO', 'KG', 'Resinas', 610, 190, 12, 'real', 3000, 6000, 3950, 2500, 8.9, 0),
    R('rp4', 'TN-BASE-AZ', 'CONCENTRADO AZUL FTALO', 'KG', 'Tintas e insumos', 4.8, 2.1, 25, 'padrão', 20, 60, 110, 0, 62.5, 2),
    R('rp5', 'IN-TUB-3', 'TUBETE 3 POLEGADAS', 'UN', 'Embalagens', 210, 55, 7, 'real', 800, 2000, 2650, 0, 2.15, 0),
    R('rp6', 'MP-019', 'ADITIVO ANTIBLOQUEIO', 'KG', 'Aditivos', 0, 0, 15, 'padrão', 50, 100, 375, 0, 22.4, 143),
    R('rp7', 'IN-FITA-48', 'FITA ADESIVA 48 MM', 'UN', 'Embalagens', 18, 6, 5, 'real', 50, 120, 820, 0, 4.9, 3)];
}

// Inventário cíclico (SQL 120) — contagens FICTÍCIAS no estoque já implantado
{
  DB.est_config = DB.est_config && DB.est_config.length ? DB.est_config.map(c => ({ ...c, implantado_em: c.implantado_em || '2026-10-01' })) : [{ empresa_id: E, implantado_em: '2026-10-01' }];
  DB.est_inv_config = [{ empresa_id: E, dias_a: 30, dias_b: 60, dias_c: 120, itens_por_contagem: 20, tolerancia_pct: 2, tolerancia_valor: 100, contagem_cega: true, recontar: true, papeis_aprovacao: ['admin', 'diretor', 'financeiro'] }];
  const lc = (c) => DB.est_locais.find(l => l.codigo === c)?.id;
  const PR = (codigo, descricao, unidade, tipo = 'materia_prima') => { let p = DB.produtos.find(x => x.codigo === codigo); if (!p) { p = { id: 'pi-' + codigo, empresa_id: E, codigo, descricao, unidade, tipo, ativo: true }; DB.produtos.push(p); } return p.id; };
  const it = [
    ['MP-001', 'RESINA PEBD LINEAR', 'KG', 'A', 1800, 8.4], ['MP-007', 'RESINA PEAD SOPRO', 'KG', 'A', 3950, 8.9], ['MP-002', 'MASTERBATCH BRANCO', 'KG', 'B', 1820, 14.2],
    ['MP-019', 'ADITIVO ANTIBLOQUEIO', 'KG', 'C', 375, 22.4], ['MP-021', 'MASTERBATCH PRETO', 'KG', 'B', 640, 12.9], ['MP-030', 'ADITIVO DESLIZANTE', 'KG', 'C', 210, 19.8]].map(([c, d, u, cl, s, cu]) => ({ p: PR(c, d, u), cl, s, cu }));
  const lt = DB.est_lotes.find(l => l.codigo === 'L-2610-01');
  const I = (cont, k, sit, contado, recontado, quem, just, lote) => ({ id: `ii-${cont}-${k}`, empresa_id: E, contagem_id: cont, produto_id: it[k].p, lote_id: lote || null, classe: it[k].cl, saldo_sistema: it[k].s, custo: it[k].cu,
    contado, recontado, contado_por: quem, contado_em: contado == null ? null : '2026-11-08T09:' + (10 + k) + ':00Z', situacao: sit, justificativa: just || null });
  DB.est_inv_contagens = [
    { id: 'ic14', empresa_id: E, numero: 14, local_id: lc('MP'), situacao: 'aberta', criada_por: 'beatriz.rocha@exemplo.com', criada_em: '2026-11-08T08:40:00Z' },
    { id: 'ic13', empresa_id: E, numero: 13, local_id: lc('MP'), situacao: 'em_aprovacao', criada_por: 'beatriz.rocha@exemplo.com', criada_em: '2026-11-06T08:30:00Z', enviada_em: '2026-11-06T11:05:00Z' },
    { id: 'ic12', empresa_id: E, numero: 12, local_id: lc('INS') || lc('MP'), situacao: 'aprovada', criada_por: 'beatriz.rocha@exemplo.com', criada_em: '2026-11-03T08:30:00Z', decidida_por: 'carlos.lima@exemplo.com', decidida_em: '2026-11-03T16:20:00Z' }];
  DB.est_inv_itens = [
    I('ic14', 0, 'ok', 1795, null, 'ana.ferreira@exemplo.com', null, lt?.id), I('ic14', 1, 'recontar', 3810, null, 'ana.ferreira@exemplo.com'), I('ic14', 2, 'pendente', null, null, null),
    I('ic14', 3, 'pendente', null, null, null), I('ic14', 4, 'ok', 640, null, 'ana.ferreira@exemplo.com'), I('ic14', 5, 'pendente', null, null, null),
    I('ic13', 0, 'ok', 1802, null, 'ana.ferreira@exemplo.com'), I('ic13', 1, 'divergente', 3700, 3720, 'ana.ferreira@exemplo.com', 'Big bag rasgado no fundo do corredor 3'),
    I('ic13', 2, 'ok', 1818, null, 'ana.ferreira@exemplo.com'), I('ic13', 3, 'divergente', 402, 400, 'ana.ferreira@exemplo.com', 'Sacos achados na área de pesagem'),
    I('ic13', 4, 'ok', 641, null, 'ana.ferreira@exemplo.com'), I('ic13', 5, 'ok', 210, null, 'ana.ferreira@exemplo.com'),
    I('ic12', 2, 'ok', 1820, null, 'bruno.lima@exemplo.com'), I('ic12', 4, 'ajustado', 610, 612, 'bruno.lima@exemplo.com', 'Falta de 1 saco')];
  const hoje = Date.parse('2026-11-08');
  window.RPC.est_inv_abc = () => [...it.map((x, k) => ({ produto_id: x.p, classe: x.cl, valor: x.s * x.cu, ultima_contagem: k < 5 ? '2026-11-06T10:00:00Z' : null })),
    ...Array.from({ length: 34 }, (_, k) => ({ produto_id: 'abc-' + k, classe: k < 4 ? 'A' : k < 12 ? 'B' : 'C', valor: 1000, ultima_contagem: k % 3 ? new Date(hoje - (k * 6) * 864e5).toISOString() : null }))];
}

// Programação inteligente (SQL 121) — OPs de impressão FICTÍCIAS com cores e impedimentos
{
  DB.prod_prog_config = [{ empresa_id: E, considerar_arte: true, considerar_cliche: true, considerar_tinta: true, considerar_material: true, troca_cor_min: 20, limpeza_escuro_claro_min: 40, janela_entrega_dias: 3, horizonte_dias: 21, setor_impressao_id: null }];
  const S = (n) => DB.prod_setores.find(s => s.nome.startsWith(n)), imp = S('Impress'), ext = S('Extrus'), IMP = DB.prod_maquinas.find(m => m.setor_id === imp.id);
  const C = { BR: ['BR-01', 'BRANCO OPACO', '#F7F7F2', 3], AM: ['AM-02', 'AMARELO OURO', '#F6C21C', 18], VM: ['VM-05', 'VERMELHO 485', '#D52B1E', 52], AZ: ['AZ-03', 'AZUL 286', '#0033A0', 78], VD: ['VD-07', 'VERDE BANDEIRA', '#00843D', 60], PT: ['PT-01', 'PRETO', '#1A1A1A', 92] };
  const cor = (k) => ({ id: 'tc-' + k, codigo: C[k][0], nome: C[k][1], hex: C[k][2], esc: C[k][3] });
  const OPS = [
    [1210, 'PA-310', 'SACO PADARIA 30X45 IMPRESSO', 'PANIFICADORA PÃO BOM', '2026-11-10', 2, ['PT', 'VM'], 7.5, []],
    [1211, 'PA-322', 'SACO HORTIFRUTI 40X60', 'SUPERMERCADOS', '2026-11-11', 3, ['AM', 'VD'], 6, []],
    [1212, 'PA-410', 'BOBINA AUTOMÁTICA CAFÉ', 'TORREFAÇÃO SERRA', '2026-11-11', 3, ['BR', 'AM'], 5, []],
    [1213, 'PA-415', 'SACO RAÇÃO 15 KG', 'AGRO NORDESTE', '2026-11-12', 3, ['AZ', 'VM', 'AM'], 9, [{ tipo: 'cliche', texto: 'Clichê não recebido (previsto 12/11)' }]],
    [1214, 'PA-120', 'SACO FARMÁCIA 20X30', 'FARMÁCIAS', '2026-11-13', 3, ['VD', 'BR'], 4.5, []],
    [1215, 'PA-501', 'FILME LAMINAÇÃO SNACK', 'SNACKS DO VALE', '2026-11-14', 3, ['VM', 'AM', 'PT'], 8, [{ tipo: 'arte', texto: 'Arte não aprovada (projeto nº 88: aguardando cliente)' }, { tipo: 'tinta', texto: 'Tinta VM-05 não preparada' }]],
    [1216, 'PA-133', 'SACO DELIVERY 35X50', 'DISTRIBUIDORA', '2026-11-17', 3, ['AZ'], 5, []],
    [1217, 'PA-210', 'BOBINA PEAD IMPRESSA', 'ATACADO', '2026-11-18', 3, ['BR'], 6, [{ tipo: 'material', texto: 'MP-001 sem saldo: faltam 1.250,0 KG' }]]];
  window.__progRows = [];
  OPS.forEach(([n, cod, desc, cli, ent, pri, cs, h, imped], k) => {
    const op = { id: 'opi' + n, empresa_id: E, numero: n, origem: 'plataforma', codigo_produto: cod, descricao: desc, quantidade: 1500 + k * 250, unidade: 'KG', cliente: cli, entrega: ent, prioridade: pri, status: 'liberada', emissao: '2026-11-01', criado_em: '2026-11-01T08:00:00Z' };
    DB.prod_ordens.push(op);
    const e1 = { id: 'pei' + n + 'a', empresa_id: E, ordem_id: op.id, setor_id: ext.id, seq: 1, status: k < 5 ? 'concluida' : 'aguardando', qtd_prevista: op.quantidade, horas_previstas: 8 };
    const e2 = { id: 'pei' + n + 'b', empresa_id: E, ordem_id: op.id, setor_id: imp.id, seq: 2, status: 'aguardando', qtd_prevista: op.quantidade, horas_previstas: h, maquina_id: null };
    DB.prod_ordem_etapas.push(e1, e2);
    window.__progRows.push({ etapa_id: e2.id, ordem_id: op.id, numero: n, maquina_id: null, setor_id: imp.id, seq: 2, impressao: true, impedimentos: imped,
      avisos: k < 5 ? [] : [{ tipo: 'etapa', texto: 'Aguarda a etapa anterior (Extrusão)' }], cores: cs.map(cor).sort((a, b) => a.esc - b.esc), escuridao: Math.max(...cs.map(c => C[c][3])) });
  });
  window.RPC.prod_prontidao = () => window.__progRows;
}

// Desempenho (SQL 123) — tempos de abertura FICTÍCIOS
{
  DB.uso_config = [{ empresa_id: E, ativo: true, guardar_dias: 180, rejeicao_segundos: 10, limite_ms: 2000, cache_cadastros: true }];
  const T = (rota, cargas, usuarios, p50, p90, pior, pct) => ({ rota, cargas, usuarios, p50, p90, pior, pct_acima: pct });
  window.RPC.desempenho_resumo = () => ({ limite_ms: 2000, total: 4870, acima: 312, p50: 640, p90: 1580,
    telas: [T('fluxo-mensal', 210, 4, 1900, 3400, 7200, 38.1), T('lancamentos', 1320, 6, 820, 2350, 5100, 14.2), T('estoque/kardex', 180, 3, 1100, 2100, 3900, 11.7),
      T('dashboard', 640, 7, 700, 1500, 2600, 4.1), T('producao/terminal', 1450, 9, 380, 900, 1800, 0), T('hoje', 760, 8, 420, 880, 1500, 0), T('producao/ordens', 310, 5, 510, 1100, 2200, 1.3)],
    dias: [] });
}

// App do motorista (SQL 124) — carga de hoje FICTÍCIA com entregas pelo celular
{
  const hoje = new Date().toISOString().slice(0, 10), M1 = DB.frota_motoristas[0], V1 = DB.log_veiculos[0];
  M1.user_id = 'u-mot1'; DB.frota_motoristas[1].user_id = 'u-mot2';
  DB.log_app_config = [{ empresa_id: E, exigir_canhoto: true, exigir_assinatura: false, exigir_recebedor: true, exigir_km: true, rastrear_min: 10, avisar_cliente_saida: true, avisar_cliente_entrega: true, portal_mostra_fila: true, papeis_ocorrencia: ['admin', 'financeiro', 'diretor'] }];
  const cg = { id: 'cg-app', empresa_id: E, numero: 32, data: hoje, veiculo_id: V1.id, motorista_id: M1.id, motorista: M1.nome, status: 'em_rota', peso_kg: 7600, volume_m3: 21, km_previsto: 180, frete_previsto: 900,
    saida_em: hoje + 'T10:40:00Z', km_saida: 118920 };
  DB.log_cargas.push(cg);
  const EN = [
    ['SUPERMERCADOS BOA COMPRA LTDA', 'AV. AGAMENON MAGALHÃES', '1200', 'MAURÍCIO DE NASSAU', 'CARUARU', '55012000', '8137210000', 24, 'entregue', 'JOÃO PEREIRA', '11:32'],
    ['FARMÁCIAS SAÚDE MAIS S.A.', 'RUA DUQUE DE CAXIAS', '455', 'CENTRO', 'CARUARU', '55002000', '8137224411', 8, 'entregue', 'ANA LÚCIA', '12:05'],
    ['ATACADO SERTÃO LTDA', 'ROD. BR-104', 'KM 62', 'DISTRITO INDUSTRIAL', 'TORITAMA', '55125000', '', 30, 'nao_entregue', null, null],
    ['DISTRIBUIDORA NORDESTE LTDA', 'RUA SANTA CRUZ', '87', 'CENTRO', 'SANTA CRUZ DO CAPIBARIBE', '55190000', '8137311122', 16, 'pendente', null, null],
    ['MERCADINHO SÃO JOÃO', 'RUA DO COMÉRCIO', '12', 'CENTRO', 'TAQUARITINGA DO NORTE', '55790000', '8137561010', 6, 'pendente', null, null]];
  window.__appEnt = EN.map(([cli, lgr, nro, bai, cid, cep, fone, vol, sit, rec, hora], k) => {
    const nota = { id: 'nf-app' + k, empresa_id: E, chave: 'APP' + k, numero: 6120 + k, emissao: hoje, tipo: 'saida', emissao_propria: true, dest_nome: cli, dest_doc: '1122233300018' + k, dest_uf: 'PE', v_nf: 8000 + k * 1500, situacao: 'autorizada' };
    DB.nfe_notas.push(nota);
    const cn = { id: 'cn-app' + k, empresa_id: E, carga_id: cg.id, nota_id: nota.id, seq: k + 1, peso_kg: 1500, volume_m3: 4, situacao: sit, entregue_em: hora ? `${hoje}T${String(+hora.slice(0, 2) + 3).padStart(2, '0')}:${hora.slice(3)}:00Z` : null,
      chegada_em: hora ? new Date(Date.parse(`${hoje}T${String(+hora.slice(0, 2) + 3).padStart(2, '0')}:${hora.slice(3)}:00Z`) - 12 * 60000).toISOString() : null, recebedor_nome: rec, recebedor_doc: rec ? '1234567' : null,
      canhoto_path: rec ? `${E}/entregas/cg-app/cn-app${k}-canhoto.jpg` : null, baixa_por: sit === 'pendente' ? null : 'app' };
    DB.log_carga_notas.push(cn);
    return { id: cn.id, seq: k + 1, situacao: sit, chegada_em: cn.chegada_em, entregue_em: cn.entregue_em, recebedor_nome: rec, tem_canhoto: !!rec, peso_kg: 1500, nota: nota.numero, serie: '1', valor: nota.v_nf, cliente: cli, documento: nota.dest_doc,
      logradouro: lgr, nro, bairro: bai, cidade: cid, uf: 'PE', cep, fone, volumes: vol, restricao: k === 3 ? 'Recebe das 8h às 16h · doca lateral' : null, ocorrencias: k === 2 ? 1 : 0 };
  });
  DB.log_ocorrencias = [{ id: 'oc-app1', empresa_id: E, carga_id: cg.id, carga_nota_id: 'cn-app2', tipo: 'ausente', descricao: 'Galpão fechado, ninguém atendeu no telefone', nao_entregue: true, criado_em: hoje + 'T15:48:00Z', lat: -7.98, lng: -36.06, foto_path: `${E}/entregas/cg-app/ocorrencia-1.jpg` }];
  DB.log_posicoes = [{ id: 1, empresa_id: E, carga_id: cg.id, lat: -7.95, lng: -36.2, em: hoje + 'T16:10:00Z' }];
  window.RPC.log_motorista_cargas = () => [{ id: cg.id, empresa_id: E, empresa: 'PLÁSTICOS EXEMPLO', numero: 32, data: hoje, status: 'em_rota', veiculo: V1.codigo, placa: V1.placa, motorista: M1.nome, saida_em: cg.saida_em, km_saida: cg.km_saida,
    observacao: 'Levar a nota de devolução do Atacado Sertão (NF 5871).', config: DB.log_app_config[0], entregas: window.__appEnt }];
  window.RPC.log_notas_das_cargas = (a) => DB.log_carga_notas.filter(cn => (a.p_cargas || []).includes(cn.carga_id)).sort((x, y) => x.seq - y.seq).map(cn => {
    const n = DB.nfe_notas.find(x => x.id === cn.nota_id) || {}, e = (window.__appEnt || []).find(x => x.id === cn.id) || {};
    return { carga_nota_id: cn.id, carga_id: cn.carga_id, nota_id: n.id, seq: cn.seq, situacao: cn.situacao, entregue_em: cn.entregue_em, numero: n.numero, emissao: n.emissao, dest_doc: n.dest_doc || n.dest_nome, dest_nome: n.dest_nome,
      uf: 'PE', cmun: null, xmun: e.cidade || 'CARUARU', bairro: e.bairro, cep: e.cep, logradouro: e.logradouro, nro: e.nro, peso_kg: cn.peso_kg, volume_m3: cn.volume_m3, v_nf: n.v_nf };
  });
}

// WhatsApp (SQL 125) — configuração e fila FICTÍCIAS
{
  DB.wa_config = [{ empresa_id: E, ativo: true, phone_number_id: '104857392018475', numero_exibicao: '(81) 3721-0000', idioma: 'pt_BR', url_base: 'https://exemplo.github.io/fluxo-caixa-saas/' }];
  DB.wa_modelos = [{ empresa_id: E, codigo: 'aviso', template: 'aviso_plataforma_v2', parametros: ['titulo', 'texto'], botao_campo: 'caminho', ativo: true }];
  DB.wa_contatos = [{ user_id: 'u1', numero: '5581998765432', optin_em: '2026-11-08T09:00:00Z' }];
  window.RPC.wa_padrao = () => [
    ['arte_aprovacao', 'Arte aguardando a aprovação do cliente', 'arte_para_aprovar', ['empresa', 'arte', 'versao', 'prazo'], 'caminho', 'Olá! {{1}} enviou a versão {{3}} da arte {{2}} para a sua aprovação. Responda até {{4}} pelo Portal do Cliente.'],
    ['prorrogacao_resposta', 'Resposta do pedido de prorrogação', 'resposta_prorrogacao', ['empresa', 'documento', 'decisao', 'vencimento'], 'caminho', 'Olá! {{1}} respondeu o seu pedido de prorrogação do título {{2}}: {{3}}. O vencimento é {{4}}.'],
    ['entrega_saiu', 'Pedido saiu para entrega', 'pedido_saiu_entrega', ['empresa', 'notas', 'veiculo'], 'caminho', 'Olá! A mercadoria das notas {{2}} de {{1}} saiu para entrega hoje, no veículo {{3}}. Acompanhe pelo Portal do Cliente.'],
    ['entrega_feita', 'Pedido entregue', 'pedido_entregue', ['empresa', 'nota', 'quando', 'recebedor'], 'caminho', 'Olá! A nota {{2}} de {{1}} foi entregue em {{3}} e recebida por {{4}}. O canhoto está no Portal do Cliente.'],
    ['aviso', 'Avisos da plataforma (Meus avisos)', 'aviso_plataforma', ['empresa', 'titulo', 'texto'], 'caminho', 'Aviso da plataforma {{1}}: {{2}}. {{3}}'],
    ['teste', 'Mensagem de teste', 'teste_plataforma', ['empresa', 'nome'], null, 'Olá {{2}}! Esta é uma mensagem de teste da plataforma {{1}}. O WhatsApp está funcionando.'],
  ].map(([codigo, nome, template, parametros, botao_campo, texto]) => ({ codigo, nome, template, parametros, botao_campo, texto }));
  const F = (min, cod, para, sit, erro) => ({ id: 'wf' + min, empresa_id: E, codigo: cod, para, situacao: sit, erro: erro || null, campos: {}, criado_em: new Date(Date.parse('2026-11-08T14:00:00Z') - min * 60000).toISOString() });
  DB.wa_fila = [F(3, 'entrega_feita', '5581991234567', 'enviado'), F(25, 'entrega_saiu', '5581991234567', 'enviado'), F(26, 'entrega_saiu', '5587988776655', 'enviado'),
    F(70, 'aviso', '5581998765432', 'enviado'), F(130, 'arte_aprovacao', '5581977665544', 'erro', '132001: Template name does not exist in the translation'), F(200, 'teste', '5581998765432', 'enviado')];
}

// Cobrança (SQL 126) — títulos em aberto e régua FICTÍCIOS
{
  const hoje = new Date().toISOString().slice(0, 10), dd = (n) => new Date(Date.parse(hoje + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const pl = DB.plano_contas.find(p => p.codigo === '1.01.01'), fv = (n) => DB.favorecidos.find(f => f.nome.startsWith(n));
  const T = [['SUPERMERCADOS', 6, 18400, '4812/1'], ['SUPERMERCADOS', -12, 9800, '4790/2'], ['DISTRIBUIDORA', -2, 12600, '4801/1'], ['DISTRIBUIDORA', -38, 7300, '4702/3'],
    ['ATACADO', -95, 21500, '4511/2'], ['ATACADO', -64, 6200, '4588/1'], ['FARMÁCIAS', 3, 5400, '4820/1'], ['FARMÁCIAS', 15, 5400, '4820/2'], ['SUPERMERCADOS', 25, 18400, '4812/2'], ['DISTRIBUIDORA', -20, 4100, '4760/1']];
  T.forEach(([n, d, v, doc], k) => { const f = fv(n); if (f) DB.lancamentos.push({ id: 'cob-l' + k, empresa_id: E, data: dd(d), plano_id: pl.id, favorecido_id: f.id, valor: v, descricao: 'NF ' + doc.split('/')[0] + ' — duplicata', documento: doc, status: 'Em aberto', conta_id: DB.contas[0].id }); });
  const fs = fv('SUPERMERCADOS'), fd = fv('DISTRIBUIDORA'), fa = fv('ATACADO');
  if (fs) fs.email = 'financeiro@boacompra.exemplo';
  DB.cob_config = [{ empresa_id: E, ativo: true, pix_chave: '12345678000195', pix_nome: 'PLASTICOS EXEMPLO LTDA', pix_cidade: 'CARUARU', valor_minimo: 100, excluir_cedidos: true, canais: ['email', 'whatsapp'] }];
  DB.cob_etapas = [[-3, 'cob_lembrete'], [0, 'cob_vencimento'], [3, 'cob_atraso'], [10, 'cob_atraso'], [30, 'cob_atraso']].map(([dias, modelo], k) => ({ id: 'ce' + k, empresa_id: E, dias, modelo, ativo: true }));
  const V = (min, l, dias, mod, canal, para, manual) => ({ id: 'cv' + min, empresa_id: E, lancamento_id: l, etapa_dias: dias, modelo: mod, canal, para, manual: !!manual, criado_por: manual ? 'renata@exemplo.com.br' : null, criado_em: new Date(Date.now() - min * 3600e3).toISOString() });
  DB.cob_envios = [V(2, 'cob-l1', 10, 'cob_atraso', 'email', 'financeiro@boacompra.exemplo'), V(3, 'cob-l1', 10, 'cob_atraso', 'whatsapp', '5581991234567'), V(5, 'cob-l2', null, 'cob_atraso', 'email', 'contas@distribuidora.exemplo', true),
    V(26, 'cob-l9', 3, 'cob_atraso', 'sem_contato', null), V(50, 'cob-l0', -3, 'cob_lembrete', 'email', 'financeiro@boacompra.exemplo'), V(170, 'cob-l1', 3, 'cob_atraso', 'email', 'financeiro@boacompra.exemplo')];
  DB.cob_pausas = fa ? [{ id: 'cp1', empresa_id: E, favorecido_id: fa.id, ate: dd(12), motivo: 'Negociação do parcelamento com o diretor (reunião dia 15)', criado_por: 'renata@exemplo.com.br' }] : [];
}

// Portal: boleto, DANFE e uso (SQL 127) — dados FICTÍCIOS (o portal entra como a VILA DOCE)
{
  const hoje = new Date().toISOString().slice(0, 10), dd = (n) => new Date(Date.parse(hoje + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  // linha digitável FICTÍCIA com os dígitos certos (banco 999 inexistente), para o título e o vencimento do exemplo
  const m10 = (n) => { let s = 0, p = 2; for (let i = n.length - 1; i >= 0; i--) { let x = +n[i] * p; if (x > 9) x -= 9; s += x; p = p === 2 ? 1 : 2; } return (10 - s % 10) % 10; };
  const m11 = (n) => { let s = 0, p = 2; for (let i = n.length - 1; i >= 0; i--) { s += +n[i] * p; p = p === 9 ? 2 : p + 1; } const d = 11 - s % 11; return d === 0 || d > 9 ? 1 : d; };
  const linhaFicticia = (venc, valor, livre) => {
    const f = Math.round((Date.parse(venc) - Date.UTC(2025, 1, 22)) / 864e5) + 1000, v = String(Math.round(valor * 100)).padStart(10, '0');
    const sem = '9999' + f + v + livre, dv = m11(sem), c1 = '9999' + livre.slice(0, 5), c2 = livre.slice(5, 15), c3 = livre.slice(15, 25);
    return `${c1.slice(0, 5)}.${c1.slice(5)}${m10(c1)} ${c2.slice(0, 5)}.${c2.slice(5)}${m10(c2)} ${c3.slice(0, 5)}.${c3.slice(5)}${m10(c3)} ${dv} ${f}${v}`;
  };
  const XML = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><nfeProc xmlns=\"http://www.portalfiscal.inf.br/nfe\" versao=\"4.00\"><NFe><infNFe Id=\"NFe26110812345678000195550010000182111000182118\" versao=\"4.00\">\n<ide><natOp>VENDA DE PRODU\u00c7\u00c3O</natOp><serie>1</serie><nNF>18211</nNF><dhEmi>2026-11-03T09:12:00-03:00</dhEmi><dhSaiEnt>2026-11-03T14:00:00-03:00</dhSaiEnt><tpNF>1</tpNF><tpAmb>1</tpAmb></ide>\n<emit><CNPJ>12345678000195</CNPJ><xNome>PLASTICOS EXEMPLO LTDA</xNome><enderEmit><xLgr>Rua A</xLgr><nro>100</nro><xBairro>Distrito Industrial</xBairro><xMun>Caruaru</xMun><UF>PE</UF><CEP>55000000</CEP></enderEmit><IE>123456789</IE></emit>\n<dest><CNPJ>98765432000110</CNPJ><xNome>VILA DOCE ALIMENTOS LTDA</xNome><enderDest><xLgr>Av. B</xLgr><nro>5</nro><xBairro>Centro</xBairro><xMun>Recife</xMun><UF>PE</UF><CEP>50000000</CEP></enderDest><IE>987654</IE></dest>\n<det nItem=\"1\"><prod><cProd>SAC-01</cProd><xProd>SACOLA 40X50</xProd><NCM>39232190</NCM><CFOP>5101</CFOP><uCom>KG</uCom><qCom>100.0000</qCom><vUnCom>12.3450</vUnCom><vProd>1234.50</vProd></prod>\n<imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>1234.50</vBC><pICMS>18.00</pICMS><vICMS>222.21</vICMS></ICMS00></ICMS><IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>1234.50</vBC><pIPI>0.00</pIPI><vIPI>0.00</vIPI></IPITrib></IPI></imposto><infAdProd>Lote 7</infAdProd></det>\n<det nItem=\"2\"><prod><cProd>BOB-02</cProd><xProd>BOBINA</xProd><NCM>39201099</NCM><CFOP>5101</CFOP><uCom>KG</uCom><qCom>1</qCom><vUnCom>10</vUnCom><vProd>10.00</vProd></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS></imposto></det>\n<total><ICMSTot><vBC>1234.50</vBC><vICMS>222.21</vICMS><vBCST>0</vBCST><vST>0</vST><vProd>1244.50</vProd><vFrete>0</vFrete><vSeg>0</vSeg><vDesc>0</vDesc><vIPI>0</vIPI><vOutro>0</vOutro><vNF>1244.50</vNF></ICMSTot></total>\n<transp><modFrete>0</modFrete><transporta><xNome>TRANSPORTES EXEMPLO</xNome></transporta><vol><qVol>3</qVol><esp>FARDO</esp><pesoL>100.000</pesoL><pesoB>103.500</pesoB></vol></transp>\n<cobr><dup><nDup>001</nDup><dVenc>2026-12-03</dVenc><vDup>622.25</vDup></dup><dup><nDup>002</nDup><dVenc>2027-01-03</dVenc><vDup>622.25</vDup></dup></cobr>\n<infAdic><infCpl>Pedido 4521</infCpl></infAdic></infNFe></NFe><protNFe><infProt><tpAmb>1</tpAmb><chNFe>26110812345678000195550010000182111000182118</chNFe><dhRecbto>2026-11-03T09:13:05-03:00</dhRecbto><nProt>126260000123456</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>";
  window.RPC.portal_titulos = () => [
    { id: 'pt1', data: dd(-4), documento: '18190/2', valor: 6220.5, situacao: 'aberto', prorrogacao: null, pode_prorrogar: false },
    { id: 'pt2', data: dd(6), documento: '18211/1', valor: 622.25, situacao: 'aberto', prorrogacao: null, pode_prorrogar: true },
    { id: 'pt3', data: dd(36), documento: '18211/2', valor: 622.25, situacao: 'aberto', prorrogacao: null, pode_prorrogar: true },
    { id: 'pt4', data: dd(-20), documento: '18102/1', valor: 4810, situacao: 'pago' }, { id: 'pt5', data: dd(-35), documento: '18050/2', valor: 3920.4, situacao: 'pago' }];
  window.RPC.portal_boletos_meus = () => [{ lancamento_id: 'pt1', linha_digitavel: linhaFicticia(dd(-4), 6220.5, '0000001819000020000000001'), arquivo_path: 'e/boletos/pt1/boleto.pdf', vencimento: dd(-4) },
    { lancamento_id: 'pt2', linha_digitavel: linhaFicticia(dd(6), 622.25, '0000001821100010000000002'), arquivo_path: null, vencimento: dd(6) }];
  window.RPC.portal_notas = () => [
    { id: 'pn1', numero: 18211, serie: '1', emissao: dd(-5), valor: 1244.5, parcelas: [{ vencimento: dd(6), valor: 622.25 }, { vencimento: dd(36), valor: 622.25 }], chave: '26110812345678000195550010000182111000182118', tem_xml: true },
    { id: 'pn2', numero: 18190, serie: '1', emissao: dd(-34), valor: 12441, parcelas: [{ vencimento: dd(-34), valor: 6220.5 }, { vencimento: dd(-4), valor: 6220.5 }], chave: '26101012345678000195550010000181901000181904', tem_xml: true },
    { id: 'pn3', numero: 18102, serie: '1', emissao: dd(-50), valor: 4810, parcelas: [{ vencimento: dd(-20), valor: 4810 }], chave: '26100912345678000195550010000181021000181029', tem_xml: false }];
  window.RPC.portal_nota_xml = () => XML;
  window.RPC.portal_registrar = () => null;
  const U = (email, cliente, ult, dias, t, n, e, a, da, x, b, p, c, ar, pr, wa, ativo = true) => ({ user_id: email, email, cliente, favorecido_id: cliente, ativo, ultimo_acesso: ult, dias_com_acesso: dias, titulos: t, notas: n, entregas: e, artes: a, danfe: da, xml: x, boletos: b, pix: p, canhotos: c, artes_respondidas: ar, prorrogacoes: pr, whatsapp: wa });
  const H = (h) => new Date(Date.now() - h * 36e5).toISOString();
  window.RPC.portal_uso = () => [
    U('compras@viladoce.exemplo', 'VILA DOCE ALIMENTOS LTDA', H(2), 14, 22, 9, 6, 11, 7, 3, 4, 2, 1, 5, 1, true),
    U('financeiro@boacompra.exemplo', 'SUPERMERCADOS BOA COMPRA LTDA', H(26), 9, 15, 4, 2, 0, 3, 3, 6, 5, 0, 0, 2, true),
    U('marketing@serraazul.exemplo', 'TORREFAÇÃO SERRA AZUL LTDA', H(70), 4, 2, 1, 0, 6, 0, 0, 0, 0, 0, 3, 0, false),
    U('fiscal@distribuidoranorte.exemplo', 'DISTRIBUIDORA NORTE LTDA', H(24 * 12), 2, 2, 3, 0, 0, 1, 4, 0, 0, 0, 0, 0, false),
    U('compras@atacadosul.exemplo', 'ATACADO SUL LTDA', H(24 * 75), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, false),
    U('ex@farmavida.exemplo', 'FARMÁCIAS VIDA LTDA', null, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, false, false)];
  DB.portal_boletos = [{ id: 'pb1', empresa_id: E, lancamento_id: 'cob-l1', linha_digitavel: linhaFicticia(dd(-12), 9800, '0000004790000020000000003'), arquivo_path: E + '/boletos/cob-l1/boleto.pdf', vencimento: dd(-12) }];
}

// Reclamação pelo Portal e certificado (SQL 128) — dados FICTÍCIOS
{
  const agora = Date.now(), Hh = (h) => new Date(agora - h * 36e5).toISOString(), dd = (n) => new Date(agora + n * 864e5).toISOString().slice(0, 10);
  Object.assign(DB.qual_parametros[0], { portal_reclamacao: true, portal_mostrar_8d: true, portal_prazo_resposta_dias: 2, portal_papeis_aviso: ['admin', 'diretor', 'producao'],
    certificado_ativo: true, certificado_responsavel: 'Carla Menezes', certificado_cargo: 'Coordenadora da Qualidade' });
  const nota = DB.nfe_notas[DB.nfe_notas.length - 1];
  const R1 = { id: 'qr-p1', empresa_id: E, numero: 6, origem: 'cliente', produto_id: 'pr-bisc', favorecido_id: 'fv-vd', nota_id: nota?.id, portal_visivel: true, portal_user_id: 'u-portal',
    produto_cliente: 'Embalagem biscoito Maria 200 g', lote_cliente: 'B1211-018', quantidade_cliente: 1200, unidade_cliente: 'UN', descricao: 'A solda inferior abre na máquina de empacotar: cerca de 1.200 embalagens do fardo 3 perderam o produto.',
    gravidade: 'alta', disposicao: 'pendente', situacao: 'aberta', aberta_em: Hh(5), aberta_por: 'Portal: compras@viladoce.exemplo', custo: 0, porques: [], prazo: dd(15), prazo_resposta: dd(1), equipe: null };
  const R2 = { id: 'qr-p2', empresa_id: E, numero: 5, origem: 'cliente', produto_id: 'pr-bisc', favorecido_id: 'fv-vd', nota_id: nota?.id, portal_visivel: true, produto_cliente: 'Embalagem biscoito Maria 200 g',
    lote_cliente: 'B1198-007', quantidade_cliente: 40, unidade_cliente: 'KG', descricao: 'Cor vermelha mais clara que o padrão aprovado em parte da bobina.', gravidade: 'media', disposicao: 'pendente', situacao: 'acao',
    aberta_em: Hh(24 * 9), aberta_por: 'Portal: compras@viladoce.exemplo', custo: 0, prazo: dd(6), prazo_resposta: dd(-7), equipe: 'Carla (Qualidade), Paulo (Impressão), Lucas (Casa de Tintas)',
    acao_imediata: 'Bobinas restantes do lote separadas e conferidas no espectrofotômetro; reposição de 40 kg enviada na NF 18233', causa: 'Viscosidade da tinta acima do padrão no fim do turno',
    porques: ['Cor mais clara no fim da bobina', 'Tinta mais viscosa', 'Diluição não corrigida no fim do turno'], acao_corretiva: 'Medição da viscosidade a cada 2 horas, com registro no Terminal', responsavel: 'Paulo (Impressão)',
    prevencao: 'Checklist de viscosidade incluído em todas as impressoras', resposta_cliente: 'Identificamos a viscosidade da tinta acima do padrão no fim do turno. Enviamos a reposição de 40 kg e passamos a medir a viscosidade a cada 2 horas, com registro. Acompanhamos as próximas entregas no espectrofotômetro.',
    respondida_em: Hh(24 * 7), respondida_por: 'carla@exemplo.com.br' };
  DB.qual_rnc.unshift(R1, R2);
  DB.qual_anexos.push({ id: 'qx-p1', empresa_id: E, rnc_id: 'qr-p1', caminho: E + '/portal/x/reclamacao-foto1.svg', nome: 'foto1.jpg', tipo: 'foto', portal_visivel: true, criado_em: Hh(5) },
    { id: 'qx-p2', empresa_id: E, rnc_id: 'qr-p1', caminho: E + '/portal/x/reclamacao-foto2.svg', nome: 'foto2.jpg', tipo: 'foto', portal_visivel: true, criado_em: Hh(5) });
  const cli = (r) => ({ id: r.id, numero: r.numero, aberta_em: r.aberta_em, nota: nota?.numero, produto: r.produto_cliente, lote: r.lote_cliente, quantidade: r.quantidade_cliente, unidade: r.unidade_cliente, descricao: r.descricao,
    situacao: r.situacao, prazo_resposta: r.prazo_resposta, resposta: r.resposta_cliente || null, respondida_em: r.respondida_em || null,
    d8: { equipe: r.equipe, contencao: r.acao_imediata || null, causa: r.causa || null, porques: r.porques, corretiva: r.acao_corretiva || null, prazo: r.prazo, eficacia: r.eficacia || null, prevencao: r.prevencao || null },
    fotos: DB.qual_anexos.filter(a => a.rnc_id === r.id).map(a => ({ caminho: a.caminho, nome: a.nome })) });
  Object.assign(window.RPC, {
    portal_qualidade_cfg: () => ({ reclamacao: true, mostrar_8d: true, certificado: true, abertas: 2 }),
    portal_reclamacoes: () => [cli(R1), cli(R2)], portal_reclamar: () => 7, portal_reclamacao_avaliar: () => null, qual_responder_cliente: () => 2,
    portal_certificados: () => ['pn1', 'pn2'] });
  const CERT = { nota: { numero: 18211, serie: '1', emissao: dd(-5), chave: '26110812345678000195550010000182111000182118', cliente: 'VILA DOCE ALIMENTOS LTDA', cliente_doc: '12345678000195' },
    empresa: { nome: 'PLÁSTICOS EXEMPLO LTDA', cnpj: '12.345.678/0001-95' }, responsavel: 'Carla Menezes', cargo: 'Coordenadora da Qualidade', bobinas: 3, kg: 1386.4, gerado_em: new Date().toISOString(),
    texto: 'Declaramos que os produtos desta nota fiscal foram fabricados e inspecionados conforme os planos de inspeção da empresa e atendem às especificações acordadas.',
    ops: [{ numero: 1211, produto: 'EMB-BISC-200 · EMBALAGEM BISCOITO MARIA 200G BOPP', expedida: true,
      bobinas: [{ codigo: 'B1211-016', peso_kg: 462.1, metros: 6120, lote_materia: 'LT-BK-2291' }, { codigo: 'B1211-017', peso_kg: 458.9, metros: 6080, lote_materia: 'LT-BK-2291' }, { codigo: 'B1211-018', peso_kg: 465.4, metros: 6150, lote_materia: 'LT-BK-2302' }],
      inspecoes: [{ numero: 214, etapa: 'processo', situacao: 'aprovada', data: dd(-6), inspetor: 'Renata', plano: 'Liberação da impressão', caracteristicas: [{ nome: 'Delta E da cor 186 C', tipo: 'medida', min: 0, max: 2 }, { nome: 'Registro', tipo: 'medida', min: 0, max: 0.3, unidade: 'mm' }, { nome: 'Código de barras', tipo: 'atributo' }],
          resultados: [{ nome: 'Delta E da cor 186 C', valores: [0.8, 1.1, 0.9] }, { nome: 'Registro', valores: [0.1, 0.2, 0.15] }, { nome: 'Código de barras', defeitos: 0 }] },
        { numero: 219, etapa: 'final', situacao: 'aprovada', data: dd(-5), inspetor: 'Renata', plano: 'Final embalagem BOPP', caracteristicas: [{ nome: 'Espessura', tipo: 'medida', min: 28, max: 32, unidade: 'µm' }, { nome: 'Resistência da solda', tipo: 'medida', min: 1.5, unidade: 'kgf' }, { nome: 'Aparência', tipo: 'atributo' }],
          resultados: [{ nome: 'Espessura', valores: [29.6, 30.2, 30.1, 29.8, 30.4] }, { nome: 'Resistência da solda', valores: [2.1, 2.3, 1.9, 2.2, 2.0] }, { nome: 'Aparência', defeitos: 0 }] }] },
      { numero: 1204, produto: 'FILME BOPP 30 µm (extrusão)', expedida: false, bobinas: [],
        inspecoes: [{ numero: 205, etapa: 'processo', situacao: 'aprovada', data: dd(-9), inspetor: 'Paulo', plano: 'Liberação da extrusão', caracteristicas: [{ nome: 'Tratamento corona', tipo: 'medida', min: 38, unidade: 'dyn' }], resultados: [{ nome: 'Tratamento corona', valores: [40, 41, 40] }] }] }] };
  window.RPC.portal_certificado = () => CERT; window.RPC.qual_certificado = () => CERT;
}

// Curva ABC, mapa e rotas (SQL 129) — cidades e visitas FICTÍCIAS
{
  const CID = [[2611606, 'Recife', 'PE', -8.0467, -34.8771], [2604106, 'Caruaru', 'PE', -8.2845, -35.9699], [2504009, 'Campina Grande', 'PB', -7.222, -35.8731], [2607901, 'Jaboatão dos Guararapes', 'PE', -8.113, -35.015],
    [2507507, 'João Pessoa', 'PB', -7.1151, -34.8641], [2606002, 'Garanhuns', 'PE', -8.8824, -36.4966], [2704302, 'Maceió', 'AL', -9.666, -35.735], [2609600, 'Olinda', 'PE', -8.0102, -34.8545],
    [2927408, 'Salvador', 'BA', -12.9718, -38.5011], [2408102, 'Natal', 'RN', -5.7936, -35.1986], [2604007, 'Carpina', 'PE', -7.8457, -35.2514], [2304400, 'Fortaleza', 'CE', -3.7166, -38.5423],
    [2613107, 'São Caetano', 'PE', -8.3376, -36.2869], [3550308, 'São Paulo', 'SP', -23.5329, -46.6395], [2602902, 'Cabo de Santo Agostinho', 'PE', -8.2822, -35.0253], [2610707, 'Paulista', 'PE', -7.934, -34.8684]];
  DB.geo_municipios = CID.map(([codigo_ibge, nome, uf, lat, lng]) => ({ codigo_ibge, nome, uf, lat, lng }));
  // mais clientes fictícios, com histórico de notas de 24 meses (perfis: frequente, esfriando, inativo, novo)
  const NOMES = ['MERCADINHO SOL NASCENTE', 'PADARIA TRIGO BOM', 'DISTRIBUIDORA AGRESTE', 'SUPERMERCADO BOA VIZINHANÇA', 'ATACAREJO DO POVO', 'FRIGORÍFICO SERTANEJO', 'LATICÍNIOS VALE VERDE',
    'CAFÉ SERRA ALTA', 'DOCES DA VOVÓ', 'BISCOITOS PRIMAVERA', 'SORVETES POLAR', 'TEMPEROS DO NORDESTE', 'AÇAÍ DA PRAIA', 'RAÇÕES CAMPEÃ', 'POLPAS TROPICAL', 'ÁGUA MINERAL FONTE CLARA',
    'MASSAS DONA BENTA FICTÍCIA', 'GRANJA OVO FELIZ', 'CASA DO PÃO', 'EMPÓRIO NATURAL'];
  const PERF = [[22, 9], [14, 5], [20, 5], [26, 3], [30, 3], [40, 4], [35, 2.4], [28, 2], [21, 1.2], [45, 1], [60, 0.9], [30, 0.7], [18, 0.5], [70, 0.45], [25, 0.35], [90, 0.3], [35, 0.25], [50, 0.15], [40, 0.1], [30, 0.08]];
  const PARADO = { 2: 70, 5: 95, 9: 210, 13: 260, 16: 75 }, NOVO = { 11: 60, 18: 40 };
  const hoje0 = new Date(), dd0 = (n) => new Date(hoje0.getTime() - n * 864e5).toISOString().slice(0, 10);
  const extra = NOMES.map((nome, i) => ({ id: 'fv-x' + i, empresa_id: E, tipo: 'CLIENTES', nome: nome + ' LTDA', documento: String(10000000000100 + i * 1013), ativo: true }));
  const notasX = [];
  extra.forEach((f, i) => { const [cada, mil] = PERF[i], fim = PARADO[i] || (i % 3), ini = NOVO[i] || 720; let n = 0;
    for (let d = ini; d >= fim; d -= cada) notasX.push({ nota_id: f.id + '-' + n, numero: 5000 + notasX.length, emissao: dd0(d), favorecido_id: f.id, dest_doc: f.documento, dest_nome: f.nome, dest_uf: 'PE', valor: Math.round(mil * 1000 * cada / 30 * (0.85 + ((n++ * 37) % 30) / 100)), representante_id: i % 2 ? 'rp1' : 'rp2' }); });
  const cc0 = window.RPC.comercial_clientes, cn0 = window.RPC.comercial_notas;
  window.RPC.comercial_clientes = (a) => cc0(a).concat(extra.map((f, i) => ({ id: f.id, nome: f.nome, nome_fantasia: null, documento: f.documento, segmento: 'VAREJO', representante_id: i % 2 ? 'rp1' : 'rp2', representante: i % 2 ? 'MARCOS VENDAS' : 'JULIANA REPRESENTAÇÕES', limite_credito: 50000, prazo_padrao: '28', email: null, telefone: null, ativo: true })));
  window.RPC.comercial_notas = (a) => cn0(a).concat(notasX);
  const cli = DB.favorecidos.filter(f => f.tipo === 'CLIENTES').concat(extra);
  window.RPC.comercial_geo_clientes = () => cli.map((f, i) => { if (i === cli.length - 1) return { id: f.id, cod_municipio: null, municipio: null, uf: null, lat: null, lng: null };
    const [cod_municipio, municipio, uf, lat, lng] = CID[i % CID.length]; return { id: f.id, cod_municipio, municipio, uf, lat, lng }; });
  window.RPC.comercial_origem = () => [{ codigo_ibge: 2604106, nome: 'Caruaru', uf: 'PE', lat: -8.2845, lng: -35.9699 }];
  window.RPC.comercial_geo_preencher = () => 0;
  DB.comercial_config = [{ empresa_id: E, abc_a_pct: 80, abc_b_pct: 95, abc_meses: 12, esfriando_fator: 1.5, esfriando_min_dias: 20, inativo_dias: 180, novo_dias: 90, visita_dias_a: 30, visita_dias_b: 60, visita_dias_c: 120,
    acao_a: 'visita', acao_b: 'ligacao', acao_c: 'whatsapp', prazo_acao_dias: 7, origem_cod_municipio: 2604106, visitas_por_dia: 4, km_por_dia: 350, fator_estrada: 1.25, raio_km: 250 }];
  const H0 = (d) => new Date(Date.now() - d * 864e5).toISOString();
  DB.comercial_interacoes = (DB.comercial_interacoes || []).concat(cli.slice(0, 6).map((f, i) => ({ id: 'civ' + i, empresa_id: E, favorecido_id: f.id, tipo: 'visita', data: H0([12, 75, 20, 140, 45, 95][i]), resumo: 'Visita de relacionamento', concluido: true })));
}

// Comissões (SQL 130) — recebimentos e fechamentos FICTÍCIOS
{
  DB.comercial_vendedores[0].comissao_pct = 3;
  DB.comercial_vendedores.push({ id: 'rp2', empresa_id: E, nome: 'JULIANA REPRESENTAÇÕES', email: 'juliana@exemplo.com.br', ativo: true, comissao_pct: 2.5 });
  const pl = DB.plano_contas.find(p => p.tipo === 'S' && p.nivel === 2);
  DB.comissao_config = [{ empresa_id: E, base: 'sem_impostos', fidc_regra: 'vencimento', fidc_carencia_dias: 5, atraso_dias: 15, atraso_reducao_pct: 50, inicio: '2026-07-01', plano_id: pl?.id, dia_pagamento: 10, papeis_fechar: ['admin', 'diretor', 'financeiro'] }];
  const cli = (n) => DB.favorecidos.find(f => f.nome.startsWith(n))?.id || null;
  DB.comissao_excecoes = [{ id: 'cx1', empresa_id: E, vendedor_id: null, favorecido_id: 'fv-x3', pct: 1.5, motivo: 'Preço especial negociado pela diretoria' }];
  const I = (dia, nf, cliente, doc, rec, pct, red = 0, atraso = 0, tipo = 'comissao') => { const base = Math.round(rec * 0.92 * 100) / 100;
    return { lancamento_id: 'cl' + nf + doc, tipo, nota_numero: nf, cliente, documento: nf + '/' + doc, recebido_em: '2026-10-' + String(dia).padStart(2, '0'), vencimento: '2026-10-' + String(Math.max(1, dia - atraso)).padStart(2, '0'),
      dias_atraso: atraso, valor_recebido: rec, base, pct, reducao_pct: red, comissao: Math.round(base * pct / 100 * (1 - red / 100) * 100) / 100 }; };
  const itM = [I(2, 4812, 'SUPERMERCADOS BOA COMPRA LTDA', 1, 18400, 3), I(6, 4790, 'SUPERMERCADOS BOA COMPRA LTDA', 2, 9800, 3), I(9, 4801, 'ATACADO SERTÃO LTDA', 1, 12600, 3, 50, 22),
    I(14, 4820, 'FARMÁCIAS SAÚDE MAIS S.A.', 1, 5400, 3), I(21, 4833, 'DISTRIBUIDORA NORDESTE LTDA', 1, 7300, 3), I(28, 4702, 'DISTRIBUIDORA NORDESTE LTDA', 3, -7300, 3, 0, 0, 'estorno')];
  const itJ = [I(3, 4815, 'SUPERMERCADO BOA VIZINHANÇA LTDA', 1, 6200, 2.5), I(10, 4826, 'MERCADINHO SOL NASCENTE LTDA', 2, 8150, 2.5), I(17, 4841, 'ATACAREJO DO POVO LTDA', 1, 4300, 1.5), I(24, 4850, 'PADARIA TRIGO BOM LTDA', 1, 2900, 2.5)];
  const sum = (L, k) => Math.round(L.reduce((s, x) => s + x[k], 0) * 100) / 100;
  window.RPC.comissao_apurar = (a) => String(a.p_competencia).startsWith('2026-09') ? [
      { vendedor_id: 'rp2', nome: 'JULIANA REPRESENTAÇÕES', pct: 2.5, itens: [], fechamento: { id: 'cf2', total: 512.4, base_total: 20496, comissao_total: 512.4, ajuste: 0, fechado_em: '2026-10-03T12:00:00Z', fechado_por: 'renata@exemplo.com.br' } },
      { vendedor_id: 'rp1', nome: 'MARCOS VENDAS', pct: 3, itens: [], fechamento: { id: 'cf1', total: 1365.2, base_total: 45507, comissao_total: 1365.2, ajuste: 0, fechado_em: '2026-10-03T12:00:00Z', fechado_por: 'renata@exemplo.com.br' } }]
    : [{ vendedor_id: 'rp2', nome: 'JULIANA REPRESENTAÇÕES', pct: 2.5, itens: itJ, fechamento: null }, { vendedor_id: 'rp1', nome: 'MARCOS VENDAS', pct: 3, itens: itM, fechamento: null }];
  const F = (id, comp, vend, it, pago, pag) => ({ id, competencia: comp, vendedor: vend, base_total: sum(it, 'base'), comissao_total: sum(it, 'comissao'), ajuste: 0, total: sum(it, 'comissao'), lancamento_id: 'lc' + id, pago, pagamento: pag,
    fechado_em: comp.slice(0, 8) + '28T12:00:00Z', fechado_por: 'renata@exemplo.com.br', itens: it.map(x => ({ ...x, recebido_em: comp.slice(0, 8) + x.recebido_em.slice(8) })) });
  window.RPC.comissao_extrato = () => [F('cf1', '2026-09-01', 'MARCOS VENDAS', itM.slice(0, 5), false, '2026-10-10'), F('cf2', '2026-09-01', 'JULIANA REPRESENTAÇÕES', itJ, false, '2026-10-10'),
    F('cf3', '2026-08-01', 'MARCOS VENDAS', itM.slice(0, 4), true, '2026-09-10'), F('cf4', '2026-08-01', 'JULIANA REPRESENTAÇÕES', itJ.slice(0, 3), true, '2026-09-10')];
  window.RPC.comissao_fechar = () => 'cf-x'; window.RPC.comissao_cancelar = () => null;
}

// Prova de cor, lembretes e biblioteca de artes (SQL 131) — tintas e eventos FICTÍCIOS
{
  Object.assign(DB.pre_parametros[0], { lembrete_ativo: true, lembrete_apos_dias: 2, lembrete_intervalo_dias: 2, lembrete_max: 3, lembrete_avisar_equipe: true, prova_de_ok: 2, prova_de_atencao: 3.5 });
  const TC = [['tcp-186', 'VM186', 'VERMELHO 186', 'Pantone 186 C', 48.5, 64.0, 47.0, '#d9452c'], ['tcp-7406', 'AM7406', 'AMARELO 7406', 'Pantone 7406 C', 79.9, 7.6, 83.1, '#efc000'],
    ['tcp-1395', 'MR1395', 'MARROM 1395', 'Pantone 1395 C', 46.5, 21.4, 50.6, '#9a6418'], ['tcp-pr', 'PR01', 'PRETO', 'Preto', 18.9, 0.6, 1.2, '#2b2b29']];
  DB.tin_cores = DB.tin_cores.concat(TC.map(([id, codigo, nome, referencia, lab_l, lab_a, lab_b, hex]) => ({ id, empresa_id: E, codigo, nome, padrao: 'pantone', referencia, lab_l, lab_a, lab_b, hex, ativo: true })));
  const pj = DB.pre_projetos.find(p => p.id === 'pa-1');
  if (pj) pj.cores = pj.cores.map(c => ({ ...c, tin_cor_id: { 'Pantone 186 C': 'tcp-186', 'Pantone 7406 C': 'tcp-7406', 'Pantone 1395 C': 'tcp-1395', 'Preto': 'tcp-pr' }[c.pantone] || null }));
  const v1 = DB.pre_versoes.filter(v => v.projeto_id === 'pa-1' && v.enviada_em).at(-1);
  if (v1) DB.pre_eventos = (DB.pre_eventos || []).concat([{ id: 9901, empresa_id: E, projeto_id: 'pa-1', tipo: 'lembrete', texto: 'Lembrete 1 de 3 enviado ao cliente (versão ' + v1.numero + ')', publico: false, autor: 'plataforma', criado_em: new Date(Date.parse(v1.enviada_em) + 2 * 864e5).toISOString() }]);
  window.RPC.pre_lembrar_agora = () => 2;
}

// Cotação por link (SQL 132) — requisição, cotações e convites FICTÍCIOS
{
  const agora = Date.now(), Hh = (h) => new Date(agora - h * 36e5).toISOString(), dd = (n) => new Date(agora + n * 864e5).toISOString().slice(0, 10);
  const R = { id: 'rq-cot', empresa_id: E, numero: 53, solicitante: 'Paulo (Extrusão)', centro_custo_id: DB.compras_requisicoes[0].centro_custo_id, necessidade: dd(12), prioridade: 'normal', status: 'aprovada', criado_em: Hh(72), observacao: 'Reposição do estoque de matéria-prima para a programação de dezembro' };
  DB.compras_requisicoes.unshift(R);
  const IT = [['rqi1', 'RESINA PEBD LINEAR (SACO 25 KG)', 'KG', 10000, 9.8], ['rqi2', 'MASTERBATCH BRANCO 60%', 'KG', 400, 21], ['rqi3', 'ADITIVO DESLIZANTE', 'KG', 120, 34]];
  DB.compras_requisicao_itens.push(...IT.map(([id, descricao, unidade, quantidade, valor_estimado]) => ({ id, empresa_id: E, requisicao_id: R.id, descricao, unidade, quantidade, valor_estimado })));
  const C = [['cq1', 'RESINAS DO BRASIL S.A.', 7, '28/42/56', [28, 42, 56], 0, false, [9.45, 20.5, 35.9]], ['cq2', 'POLÍMEROS NORDESTE LTDA', 4, 'à vista', [0], 380, true, [9.3, 22.4, 31.5]],
    ['cq3', 'COLOR MASTER LTDA', 10, '30 dias', [30], 150, true, [null, 19.8, 33.2]]];
  DB.compras_cotacoes = DB.compras_cotacoes.concat(C.map(([id, fornecedor, prazo_entrega_dias, condicao_pagamento, parcelas_dias, frete, link]) => ({ id, empresa_id: E, requisicao_id: R.id, fornecedor, prazo_entrega_dias, condicao_pagamento, parcelas_dias, frete,
    validade: dd(10), escolhida: false, respondida_pelo_fornecedor: link, criado_em: Hh(link ? 20 : 40) })));
  C.forEach(([cid, , , , , , , pr]) => pr.forEach((v, k) => { if (v != null) DB.compras_cotacao_itens.push({ id: cid + k, empresa_id: E, cotacao_id: cid, requisicao_item_id: IT[k][0], valor_unitario: v }); }));
  DB.compras_parametros = [{ empresa_id: E, alcada_valor: 5000, previsao_automatica: true, cotacao_link_dias: 5, taxa_mensal_vp: 1.5, cotacao_mostra_estimado: false, cotacao_mensagem: 'Entrega no galpão 2 (Caruaru). Informe o preço com ICMS e IPI.' }];
  const tk = (n) => String(n).repeat(64).slice(0, 64);
  DB.compras_cotacao_convites = [
    { id: 'cv1', empresa_id: E, requisicao_id: R.id, fornecedor: 'POLÍMEROS NORDESTE LTDA', email: 'vendas@polimerosne.exemplo', telefone: null, token: tk('a'), expira_em: dd(2), situacao: 'respondido', aberto_em: Hh(26), respondido_em: Hh(20), cotacao_id: 'cq2', criado_em: Hh(48) },
    { id: 'cv2', empresa_id: E, requisicao_id: R.id, fornecedor: 'COLOR MASTER LTDA', email: 'comercial@colormaster.exemplo', telefone: '81988776655', token: tk('b'), expira_em: dd(2), situacao: 'respondido', aberto_em: Hh(30), respondido_em: Hh(22), cotacao_id: 'cq3', criado_em: Hh(48) },
    { id: 'cv3', empresa_id: E, requisicao_id: R.id, fornecedor: 'PLÁSTICOS DO AGRESTE', email: null, telefone: '81977665544', token: tk('c'), expira_em: dd(2), situacao: 'aberto', aberto_em: Hh(6), criado_em: Hh(48) },
    { id: 'cv4', empresa_id: E, requisicao_id: R.id, fornecedor: 'DISTRIBUIDORA QUÍMICA SUL', email: 'cotacoes@dqsul.exemplo', telefone: null, token: tk('d'), expira_em: dd(2), situacao: 'recusado', recusa_motivo: 'Não atendemos Pernambuco', respondido_em: Hh(30), criado_em: Hh(48) }];
  window.RPC.compras_convidar = () => tk('e');
  window.RPC.cotacao_link_abrir = () => ({ empresa: 'PLÁSTICOS EXEMPLO LTDA', fornecedor: 'PLÁSTICOS DO AGRESTE', numero: 53, necessidade: dd(12), situacao: 'aberto', expira_em: dd(2), vencido: false,
    mensagem: 'Entrega no galpão 2 (Caruaru). Informe o preço com ICMS e IPI.', itens: IT.map(([id, descricao, unidade, quantidade]) => ({ id, descricao, unidade, quantidade, observacao: id === 'rqi1' ? 'Índice de fluidez entre 0,8 e 1,2' : null, preco: null })), resposta: null });
  window.RPC.cotacao_link_responder = () => null; window.RPC.cotacao_link_recusar = () => null;
}

// Confronto pedido × nota (SQL 133) — notas, divergências e bloqueios FICTÍCIOS
{
  const agora = Date.now(), dd = (n) => new Date(agora + n * 864e5).toISOString().slice(0, 10), Hh = (h) => new Date(agora - h * 36e5).toISOString();
  Object.assign(DB.compras_parametros[0], { conf_tol_preco_pct: 2, conf_tol_qtd_pct: 5, conf_tol_valor: 10, conf_tol_prazo_dias: 3, conf_tol_entrega_dias: 2, conf_bloquear: true, conf_papeis_liberar: ['admin', 'diretor', 'financeiro'] });
  const p117 = DB.compras_pedidos.find(p => p.numero === 117);
  if (p117) { p117.parcelas_dias = [28, 42, 56]; p117.entrega_prevista = dd(-6); }
  window.RPC.compras_notas_candidatas = () => [{ id: 'nf-cf1', numero: 77310, serie: '1', emissao: dd(-2), v_nf: 87570, emit_doc: '11222333000144', ja_recebida: false,
    itens: [{ id: 'nfi-cf1', n_item: 1, xprod: 'RESINA PEBD LINEAR', ucom: 'KG', qcom: 10000, vuncom: 8.715, cprod: 'PEBDL', ncm: '39011092' },
      { id: 'nfi-cf2', n_item: 2, xprod: 'PALETE PBR (RETORNÁVEL)', ucom: 'UN', qcom: 12, vuncom: 35, cprod: 'PLT', ncm: '44152000' }],
    parcelas: [[1, 26], [2, 40], [3, 54]].map(([numero, d]) => ({ numero, vencimento: dd(d), valor: 29190, vinculada: false })) }];
  window.RPC.compras_confrontar = (a) => (a.p_nota ? [
    { tipo: 'preco', bloqueia: true, valor: 2950, texto: 'RESINA PEBD LINEAR: preço da nota 8,7150 acima do pedido 8,4200 (+3,5%; tolerância 2%)' },
    { tipo: 'item_fora', bloqueia: true, valor: 420, texto: 'Itens da nota fora do pedido: R$ 420,00 (tolerância R$ 10,00)' },
    { tipo: 'entrega', bloqueia: false, texto: 'Entrega 4 dia(s) depois do previsto' }] : []);
  const B = (id, v, divs, sit = 'bloqueada', lib = {}) => ({ id, situacao: sit, valor_divergente: v, divergencias: divs, criado_em: Hh(30), ...lib });
  const d1 = [{ tipo: 'preco', bloqueia: true, valor: 2950, texto: 'RESINA PEBD LINEAR: preço da nota 8,7150 acima do pedido 8,4200 (+3,5%; tolerância 2%)' },
    { tipo: 'item_fora', bloqueia: true, valor: 420, texto: 'Itens da nota fora do pedido: R$ 420,00 (tolerância R$ 10,00)' }, { tipo: 'entrega', bloqueia: false, texto: 'Entrega 4 dia(s) depois do previsto' }];
  const d2 = [{ tipo: 'prazo_pagamento', bloqueia: true, texto: `Parcela 1 vence ${dd(6).split('-').reverse().join('/')}; pelo pedido (28 dias) seria ${dd(20).split('-').reverse().join('/')}` }, { tipo: 'parcelas', bloqueia: false, texto: 'A nota tem 2 parcela(s); o pedido, 3' }];
  const d3 = [{ tipo: 'quantidade', bloqueia: true, valor: 980, texto: 'FILME STRETCH 500 MM: recebido 1.140 de 1.000 pedidos (tolerância 5%)' }];
  window.RPC.compras_confronto_lista = () => [
    { nota_id: 'n1', numero: 77310, serie: '1', emissao: dd(-2), fornecedor: 'RESINAS DO BRASIL S.A.', v_nf: 87570, pedidos: [{ id: 'x', numero: 117 }], divergencias: d1, bloqueio: B('bq1', 3370, d1),
      titulos: [{ id: 't1', data: dd(26), valor: 29190, status: 'Em aberto', bloqueado: true }, { id: 't2', data: dd(40), valor: 29190, status: 'Em aberto', bloqueado: true }, { id: 't3', data: dd(54), valor: 29190, status: 'Em aberto', bloqueado: true }] },
    { nota_id: 'n2', numero: 5521, serie: '2', emissao: dd(-4), fornecedor: 'COLOR MASTER LTDA', v_nf: 8400, pedidos: [{ id: 'y', numero: 114 }], divergencias: d2, bloqueio: B('bq2', 0, d2),
      titulos: [{ id: 't4', data: dd(6), valor: 4200, status: 'Em aberto', bloqueado: true }, { id: 't5', data: dd(36), valor: 4200, status: 'Em aberto', bloqueado: true }] },
    { nota_id: 'n3', numero: 1290, serie: '1', emissao: dd(-6), fornecedor: 'EMBALAGENS PRIMAVERA', v_nf: 2310, pedidos: [], divergencias: [], bloqueio: null, titulos: [{ id: 't6', data: dd(22), valor: 2310, status: 'Em aberto', bloqueado: false }] },
    { nota_id: 'n4', numero: 66012, serie: '1', emissao: dd(-9), fornecedor: 'POLÍMEROS NORDESTE LTDA', v_nf: 51200, pedidos: [{ id: 'z', numero: 112 }], divergencias: [{ tipo: 'entrega', bloqueia: false, texto: 'Entrega 3 dia(s) depois do previsto' }], bloqueio: null,
      titulos: [{ id: 't7', data: dd(19), valor: 51200, status: 'Em aberto', bloqueado: false }] },
    { nota_id: 'n5', numero: 30455, serie: '1', emissao: dd(-12), fornecedor: 'TRANSFILMES LTDA', v_nf: 18980, pedidos: [{ id: 'w', numero: 110 }], divergencias: d3,
      bloqueio: B('bq3', 980, d3, 'liberada', { liberado_por: 'diretoria@plasticosexemplo.com.br', liberado_em: Hh(50), liberado_motivo: 'Fornecedor emitiu nota de débito de R$ 980,00 (ND 112); excesso fica em estoque' }),
      titulos: [{ id: 't8', data: dd(16), valor: 18980, status: 'Em aberto', bloqueado: false }] },
    { nota_id: 'n6', numero: 9081, serie: '1', emissao: dd(-15), fornecedor: 'RESINAS DO BRASIL S.A.', v_nf: 61900, pedidos: [{ id: 'v', numero: 116 }], divergencias: [], bloqueio: null,
      titulos: [{ id: 't9', data: dd(13), valor: 61900, status: 'Em aberto', bloqueado: false }] }];
  window.RPC.compras_liberar_pagamento = () => 3;
}

// IQF do fornecedor (SQL 134) — notas e eventos FICTÍCIOS
{
  const agora = Date.now(), dd = (n) => new Date(agora + n * 864e5).toISOString().slice(0, 10);
  Object.assign(DB.compras_parametros[0], { iqf_peso_qualidade: 40, iqf_peso_entrega: 35, iqf_peso_preco: 25, iqf_meses: 12, iqf_meta: 80, iqf_faixa_a: 90, iqf_pontos_dia_atraso: 10, iqf_min_eventos: 3 });
  const ids = { 'RESINAS DO BRASIL S.A.': 'fv-iqf1', 'POLÍMEROS NORDESTE LTDA': 'fv-iqf2', 'COLOR MASTER LTDA': 'fv-iqf3' };
  for (const c of DB.compras_cotacoes) if (ids[c.fornecedor]) c.favorecido_id = ids[c.fornecedor];
  const L = [
    ['fv-iqf4', 'TRANSFILMES LTDA', 50, 4, 55, 6, 75, 4, 57.8, 'C'],
    ['fv-iqf1', 'RESINAS DO BRASIL S.A.', 87.5, 8, 80, 10, 70, 10, 80.5, 'B'],
    ['fv-iqf3', 'COLOR MASTER LTDA', 100, 5, 72.5, 4, 100, 3, 89.9, 'B'],
    ['fv-iqf5', 'EMBALAGENS PRIMAVERA', null, 0, 100, 5, 100, 5, 100, 'A'],
    ['fv-iqf2', 'POLÍMEROS NORDESTE LTDA', 100, 6, 100, 7, 85.7, 7, 96.4, 'A'],
    ['fv-iqf6', 'TUBETES CARUARU', null, 0, 100, 2, null, 0, 100, 'N']];
  const lista = L.map(([favorecido_id, nome, qualidade, n_qualidade, entrega, n_entrega, preco, n_preco, iqf, classe]) => ({ favorecido_id, nome, qualidade, n_qualidade, entrega, n_entrega, preco, n_preco, iqf, classe, eventos: null }));
  const EV = [['qualidade', -6, 0, 'Inspeção 412: reprovada (espessura fora da tolerância)'], ['entrega', -6, 70, 'PC 110: entregue 5 dia(s) depois do previsto'], ['preco', -6, 0, 'PC 110: FILME STRETCH 500 MM: recebido 1.140 de 1.000 pedidos (tolerância 5%)'],
    ['qualidade', -35, 100, 'Inspeção 377: aprovada'], ['entrega', -35, 100, 'PC 98: entregue no prazo'], ['preco', -35, 100, 'PC 98: nota conferiu com o pedido'],
    ['qualidade', -70, 50, 'Inspeção 341: aprovada com concessão'], ['entrega', -70, 0, 'PC 87: entregue 14 dia(s) depois do previsto'], ['preco', -70, 100, 'PC 87: nota conferiu com o pedido'],
    ['qualidade', -110, 50, 'Inspeção 298: aprovada com concessão'], ['entrega', -110, 60, 'PC 75: entregue 6 dia(s) depois do previsto'], ['preco', -110, 100, 'PC 75: nota conferiu com o pedido']];
  window.RPC.compras_iqf = (a) => a.p_favorecido ? lista.filter(f => f.favorecido_id === a.p_favorecido).map(f => ({ ...f, eventos: EV.map(([dimensao, d, nota, texto]) => ({ dimensao, data: dd(d), nota, texto })) })) : lista;
}

// Frete próprio × terceirizado por rota (SQL 135) — números FICTÍCIOS
{
  const hoje = new Date(), fim = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const ini = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - 5, 1)).toISOString().slice(0, 10);
  Object.assign(DB.log_parametros[0], { comp_rota_por: 'municipio', comp_meses: 6, comp_dif_pct: 10, comp_min_t: 1 });
  const L = (viagens, notas, peso_kg, custo) => ({ viagens, notas, peso_kg, custo, rs_t: peso_kg ? Math.round(custo / peso_kg * 1000 * 100) / 100 : null });
  const r = (rota, p, t, sugestao) => { const dif = p.rs_t && t.rs_t ? Math.round((t.rs_t / p.rs_t - 1) * 1000) / 10 : null;
    const economia = sugestao === 'terceirizar' ? Math.round((p.rs_t - t.rs_t) * p.peso_kg / 1000 * 100) / 100 : sugestao === 'frota_propria' ? Math.round((t.rs_t - p.rs_t) * t.peso_kg / 1000 * 100) / 100 : 0;
    return { rota, proprio: p, terceiro: t, dif_pct: sugestao === 'sem_base' ? null : dif, sugestao, economia }; };
  window.RPC.log_frete_comparativo = () => ({ de: ini, ate: fim, rota_por: 'municipio', dif_pct: 10, min_t: 1, rotas: [
    r('RECIFE / PE', L(38, 214, 142300, 21345), L(6, 31, 21800, 3270), 'equivalente'),
    r('JOÃO PESSOA / PB', L(9, 47, 36400, 9100), L(7, 39, 30100, 5719), 'terceirizar'),
    r('MACEIÓ / AL', L(4, 18, 14200, 2556), L(11, 52, 48600, 11178), 'frota_propria'),
    r('CARUARU / PE', L(26, 131, 88900, 4890), L(0, 0, 0, 0), 'sem_base'),
    r('NATAL / RN', L(0, 0, 0, 0), L(5, 22, 19800, 6336), 'sem_base'),
    r('FORTALEZA/CE', L(0, 0, 0, 0), L(2, 0, 0, 4800), 'sem_base')] });
}

// Frota: pneus, VExpenses e avisos de vencimento (SQL 136) — dados FICTÍCIOS
{
  Object.assign(DB.log_parametros[0], { frota_alerta_ativo: true, frota_alerta_dias: 30, frota_alerta_km: 1000, frota_alerta_papeis: ['admin', 'financeiro', 'diretor'],
    frota_vexp_palavras: 'POSTO, COMBUST, DIESEL, SHELL, IPIRANGA, PETROBRAS, RAIZEN, ALE COMBUST, GASOLINA, ETANOL, ARLA' });
  const [V1, , V3] = DB.log_veiculos, [M1, M2] = DB.frota_motoristas;
  globalThis.MOCK_VEXPENSES = { inicio: '2026-11-01', fim: '2026-11-07', itens: [
    { fitid: 'vx:1', data: '2026-11-02', valor: -1238.00, tipo: 'CARTAO', descricao: 'AUTO POSTO BR-232 — PAULO SANTOS' },
    { fitid: 'vx:2', data: '2026-11-02', valor: -38.90, tipo: 'CARTAO', descricao: 'RESTAURANTE DO TREVO — PAULO SANTOS' },
    { fitid: 'vx:3', data: '2026-11-03', valor: -433.30, tipo: 'CARTAO', descricao: 'POSTO IPIRANGA CARUARU — RICARDO ALMEIDA' },
    { fitid: 'vx:4', data: '2026-11-05', valor: -96.00, tipo: 'CARTAO', descricao: 'ARLA 32 POSTO SHELL — PAULO SANTOS' },
    { fitid: 'vx:5', data: '2026-11-06', valor: -1190.25, tipo: 'CARTAO', descricao: 'AUTO POSTO BR-232 — PAULO SANTOS' }] };
  DB.frota_abastecimentos.push({ id: 'fa-vx', empresa_id: E, veiculo_id: V1.id, motorista_id: M1.id, data: '2026-11-02', km: Math.max(...DB.frota_abastecimentos.filter(a => a.veiculo_id === V1.id).map(a => +a.km)) + 690, litros: 200, valor: 1238, combustivel: 'diesel_s10', tanque_cheio: true, posto: 'AUTO POSTO BR-232', origem: 'vexpenses', vexp_ref: 'vx:1' });
  window.RPC.frota_vencimentos = () => [
    { chave: 'a', fase: 'vencido', origem: V3.codigo, item: 'CRLV / licenciamento', vence: '2026-11-10', dias: -2, falta_km: null },
    { chave: 'b', fase: 'aviso', origem: 'PAULO SANTOS', item: 'CNH', vence: '2026-11-20', dias: 12, falta_km: null },
    { chave: 'c', fase: 'aviso', origem: V1.codigo, item: 'Preventiva: Troca de óleo e filtros', vence: '2026-11-20', dias: 12, falta_km: 640 },
    { chave: 'd', fase: 'aviso', origem: V1.codigo, item: 'Seguro', vence: '2026-12-05', dias: 27, falta_km: null }];
  window.RPC.frota_avisar_agora = () => 0;
  DB.frota_manutencoes.push({ id: 'fm-pn', empresa_id: E, veiculo_id: V1.id, data: '2026-11-04', km: 120500, tipo: 'pneus', oficina: 'PNEUS DO AGRESTE', descricao: 'Recapagem de 4 pneus de tração', valor: 2240 },
    { id: 'fm-pv', empresa_id: E, veiculo_id: V1.id, data: '2026-11-05', km: 120600, tipo: 'preventiva', oficina: 'OFICINA DIESEL CENTRO', descricao: 'Lubrificação e regulagem de freios', valor: 380 });
}

// Pergunte à plataforma (SQL 137) — respostas e números FICTÍCIOS
{
  DB.ia_config = [{ empresa_id: E, ativo: true, modelo: 'claude-sonnet-5-5', papeis: ['admin', 'diretor', 'financeiro', 'compras'], limite_dia: 30, max_consultas: 6, guardar_dias: 180, instrucoes: 'Arredonde os valores grandes para mil reais quando fizer comparações.' }];
  DB.ia_perguntas = [];
  window.RPC.ia_pode = () => true;
  window.RPC.ia_uso = () => ({ perguntas: 148, pessoas: 6, erros: 3, positivas: 41, negativas: 4, tokens_entrada: 612400, tokens_saida: 58300, ms_medio: 6400,
    por_pessoa: [{ email: 'diretoria@exemplo.com.br', n: 52 }, { email: 'financeiro@exemplo.com.br', n: 47 }, { email: 'compras@exemplo.com.br', n: 31 }, { email: 'renan@exemplo.com.br', n: 18 }] });
  let n = 0;
  const base = { modelo: 'claude-sonnet-5-5', tokens_entrada: 4100, tokens_saida: 380, ms: 5200 };
  window.FN = window.FN || {};
  window.FN.perguntar = (b) => {
    n++;
    if (/client/i.test(b.pergunta)) return { id: 'ia' + n, ...base, pergunta: b.pergunta,
      resposta: 'Nos últimos 12 meses (nov/2025 a out/2026), os 10 maiores clientes somaram **R$ 9.842.300,00**, 61% do faturamento.\n- **SUPERMERCADOS BOM PREÇO** lidera com R$ 2.184.600,00\n- os três primeiros respondem por 34% do faturamento',
      grafico: { tipo: 'barras', titulo: 'Faturamento por cliente — 12 meses', consulta: 0 }, link: '#/notas', link_rotulo: 'Notas Fiscais',
      consultas: [{ fonte: 'notas', metrica: 'valor', agrupar: 'cliente', de: '2025-11-01', ate: '2026-10-31', n: 10, total: 16135000 }],
      tabela: { colunas: ['destinatário da nota', 'valor total das notas'], metrica: 'valor', agrupar: 'cliente', linhas: [
        ['SUPERMERCADOS BOM PREÇO LTDA', 2184600], ['DISTRIBUIDORA NORDESTE ALIMENTOS', 1563200], ['PANIFICADORA PÃO DOURADO', 1742100], ['ATACADÃO DO AGRESTE', 980400],
        ['FRIGORÍFICO SERTÃO', 812900], ['LATICÍNIOS VALE VERDE', 744300], ['MERCADINHO SÃO JOSÉ', 551800], ['ÁGUAS CRISTALINAS', 472300], ['CEREALISTA RECIFE', 422100], ['HORTIFRÚTI DA SERRA', 368600]].sort((a, b) => b[1] - a[1]) } };
    return { id: 'ia' + n, ...base, pergunta: b.pergunta,
      resposta: 'Em 2026, até 08/11, o faturamento (notas de saída próprias) foi de **R$ 13.426.900,00**, média de R$ 1.342.690,00 por mês.\n- melhor mês: **outubro**, com R$ 1.612.400,00\n- novembro tem só 8 dias e fica fora da comparação\n- de janeiro a outubro, o faturamento cresceu 21%',
      grafico: { tipo: 'linha', titulo: 'Faturamento por mês — 2026', consulta: 0 }, link: '#/notas', link_rotulo: 'Notas Fiscais',
      consultas: [{ fonte: 'notas', metrica: 'valor', agrupar: 'mes', filtros: { tipo: 'saida', propria: 'true' }, de: '2026-01-01', ate: '2026-11-08', n: 11, total: 13426900 }],
      tabela: { colunas: ['mês (AAAA-MM)', 'valor total das notas'], metrica: 'valor', agrupar: 'mes', linhas: [
        ['2026-01', 1331800], ['2026-02', 1207300], ['2026-03', 1365900], ['2026-04', 1298400], ['2026-05', 1402100], ['2026-06', 1355600],
        ['2026-07', 1421700], ['2026-08', 1489200], ['2026-09', 1514600], ['2026-10', 1612400], ['2026-11', 427900]] } };
  };
}

// Relatórios agendados (SQL 138) — relatórios, envios e tabelas FICTÍCIOS
{
  const agora = Date.now(), H = (h) => new Date(agora + h * 36e5).toISOString();
  window.RPC.ia_catalogo = () => ({"saldos": {"descricao": "Posição de caixa: saldo das contas bancárias ativas (pagos até a data final), e o que está em aberto a receber e a pagar em cada conta. Use só a data final (ate); sem ela, hoje.", "link": "#/fluxo-diario", "rotulo": "Fluxo de Caixa Diário", "metricas": {"saldo": "saldo realizado das contas", "a_receber": "em aberto a receber", "a_pagar": "em aberto a pagar"}, "agrupar": {"conta": "conta bancária", "grupo": "grupo de contas", "disponibilidade": "disponibilidade da conta"}, "filtros": {"conta": "parte do nome da conta", "disponibilidade": "parte da disponibilidade"}}, "lancamentos": {"descricao": "Lançamentos do financeiro (contas a pagar e a receber, pagos e em aberto), pela data do lançamento. Valor sempre positivo; o tipo diz se é entrada (receita/recebimento) ou saída (despesa/pagamento). Transferências entre contas aparecem como saída e entrada; exclua com excluir_transferencias.", "link": "#/lancamentos", "rotulo": "Lançamentos", "metricas": {"valor": "soma dos valores", "saldo": "entradas menos saídas", "quantidade": "número de lançamentos", "media": "valor médio"}, "agrupar": {"mes": "mês (AAAA-MM)", "ano": "ano", "dia": "dia", "plano": "conta do plano de contas (nível 2)", "classe": "classe do plano (nível 1)", "favorecido": "cliente/fornecedor/beneficiário", "centro_custo": "centro de custo", "conta": "conta bancária", "status": "Pago ou Em aberto", "tipo": "entrada ou saída"}, "filtros": {"status": "Pago | Em aberto", "tipo": "entrada | saida", "plano": "código ou início do código do plano (ex.: 2.03)", "plano_nome": "parte do nome da conta do plano", "favorecido": "parte do nome", "centro_custo": "parte do nome", "conta": "parte do nome da conta bancária", "texto": "parte da descrição", "excluir_transferencias": "true para tirar as transferências entre contas"}}, "notas": {"descricao": "Notas fiscais eletrônicas autorizadas (faturamento = saída própria; compras = entrada), pela data de emissão. Valor = valor total da nota.", "link": "#/notas", "rotulo": "Notas Fiscais", "metricas": {"valor": "valor total das notas", "produtos": "valor dos produtos", "frete": "frete destacado na nota", "icms": "ICMS", "ipi": "IPI", "quantidade": "número de notas", "ticket": "valor médio por nota"}, "agrupar": {"mes": "mês", "ano": "ano", "dia": "dia", "cliente": "destinatário da nota", "fornecedor": "emitente da nota", "uf": "UF do destinatário", "natureza": "natureza da operação", "cfop": "primeiro CFOP da nota"}, "filtros": {"tipo": "saida | entrada", "propria": "true = emitida pela empresa", "cliente": "parte do nome do destinatário", "fornecedor": "parte do nome do emitente", "uf": "sigla da UF", "cfop": "CFOP ou início (ex.: 5101, 61)", "natureza": "parte da natureza da operação"}}, "fretes": {"descricao": "Fretes contratados de terceiros (Fretes e CIOT), não cancelados, pela data do frete.", "link": "#/logistica/fretes", "rotulo": "Fretes e CIOT", "metricas": {"valor": "valor dos fretes", "pedagio": "pedágio", "km": "quilômetros", "quantidade": "número de fretes", "media": "valor médio do frete"}, "agrupar": {"mes": "mês", "ano": "ano", "transportador": "transportadora", "destino": "destino", "placa": "placa"}, "filtros": {"transportador": "parte do nome", "destino": "parte do destino"}}, "compras": {"descricao": "Pedidos de compra não cancelados, pela data do pedido. Valor = total do pedido.", "link": "#/compras/pedidos", "rotulo": "Pedidos de compra", "metricas": {"valor": "valor dos pedidos", "quantidade": "número de pedidos", "media": "valor médio"}, "agrupar": {"mes": "mês", "ano": "ano", "fornecedor": "fornecedor", "status": "situação do pedido"}, "filtros": {"fornecedor": "parte do nome", "status": "rascunho | aprovacao | aprovado | enviado | recebido_parcial | recebido"}}, "producao": {"descricao": "Apontamentos de produção (quilos bons, refugo e horas) por máquina e setor, pela data de início.", "link": "#/producao", "rotulo": "Painel de Produção", "metricas": {"kg": "quilos bons produzidos", "refugo": "quilos de refugo/apara", "refugo_pct": "refugo em % do total", "horas": "horas apontadas", "quantidade": "número de apontamentos"}, "agrupar": {"mes": "mês", "ano": "ano", "dia": "dia", "maquina": "máquina", "setor": "setor", "turno": "turno", "operador": "operador"}, "filtros": {"maquina": "parte do nome", "setor": "parte do nome", "turno": "turno"}}});
  window.RPC.rel_pode = () => true;
  const B = (titulo, fonte, metrica, agrupar, periodo, filtros = {}) => ({ titulo, fonte, metrica, agrupar, periodo, filtros, limite: 15 });
  DB.rel_agendados = [
    { id: 'rl1', empresa_id: E, nome: 'Posição de caixa', frequencia: 'dias_uteis', dia_semana: 1, dia_mes: 1, hora: 8, ativo: true, destinatarios: ['diretoria@plasticosexemplo.com.br', 'financeiro@plasticosexemplo.com.br'],
      blocos: [B('Saldo das contas', 'saldos', 'saldo', 'conta', 'hoje'), B('A pagar nos próximos 7 dias', 'lancamentos', 'valor', 'favorecido', 'proximos_7', { status: 'Em aberto', tipo: 'saida', excluir_transferencias: 'true' }),
        B('A receber nos próximos 7 dias', 'lancamentos', 'valor', 'favorecido', 'proximos_7', { status: 'Em aberto', tipo: 'entrada', excluir_transferencias: 'true' })],
      proximo_envio: H(11), ultimo_envio: H(-13), ultimo_erro: null },
    { id: 'rl2', empresa_id: E, nome: 'Faturamento semanal', frequencia: 'semanal', dia_semana: 1, dia_mes: 1, hora: 8, ativo: true, destinatarios: ['diretoria@plasticosexemplo.com.br', 'comercial@plasticosexemplo.com.br'],
      blocos: [B('Semana passada por cliente', 'notas', 'valor', 'cliente', 'semana_passada', { tipo: 'saida', propria: 'true' }), B('Ano por mês', 'notas', 'valor', 'mes', 'ano_atual', { tipo: 'saida', propria: 'true' })],
      proximo_envio: H(11), ultimo_envio: H(-157), ultimo_erro: null },
    { id: 'rl3', empresa_id: E, nome: 'Despesas do mês anterior', frequencia: 'mensal', dia_semana: 1, dia_mes: 2, hora: 8, ativo: true, destinatarios: ['diretoria@plasticosexemplo.com.br'],
      blocos: [B('Por classe', 'lancamentos', 'valor', 'classe', 'mes_anterior', { status: 'Pago', tipo: 'saida', excluir_transferencias: 'true' })], proximo_envio: H(565), ultimo_envio: H(-155), ultimo_erro: null },
    { id: 'rl4', empresa_id: E, nome: 'Produção de ontem', frequencia: 'dias_uteis', dia_semana: 1, dia_mes: 1, hora: 7, ativo: false, destinatarios: ['producao@plasticosexemplo.com.br'],
      blocos: [B('Quilos por máquina', 'producao', 'kg', 'maquina', 'ontem')], proximo_envio: null, ultimo_envio: H(-60), ultimo_erro: 'Quem criou o relatório não tem mais acesso (perfil administrador, diretor ou financeiro).' }];
  DB.rel_envios = [{ id: 'ev1', empresa_id: E, rel_id: 'rl1', enviado_em: H(-13), manual: false, destinatarios: 2, blocos: 3, erro: null }, { id: 'ev2', empresa_id: E, rel_id: 'rl1', enviado_em: H(-37), manual: false, destinatarios: 2, blocos: 3, erro: null },
    { id: 'ev3', empresa_id: E, rel_id: 'rl1', enviado_em: H(-40), manual: true, destinatarios: 2, blocos: 3, erro: null }];
  window.RPC.rel_previa = () => [
    { titulo: 'Saldo das contas', periodo: 'hoje (09/11/2026)', colunas: ['conta bancária', 'saldo realizado das contas'], linhas: [['BANCO DO NORDESTE C/C', 'R$ 412.830,15'], ['ITAÚ C/C', 'R$ 188.402,77'], ['CAIXA ECONÔMICA C/C', 'R$ 64.120,00'], ['CAIXA INTERNO', 'R$ 2.315,40']], total: 'R$ 667.668,32' },
    { titulo: 'A pagar nos próximos 7 dias', periodo: 'próximos 7 dias (09/11 a 15/11/2026)', colunas: ['cliente/fornecedor/beneficiário', 'soma dos valores'], linhas: [['RESINAS DO BRASIL S.A.', 'R$ 87.570,00'], ['FOLHA DE PAGAMENTO', 'R$ 64.200,00'], ['COPEL ENERGIA', 'R$ 38.912,44'], ['COLOR MASTER LTDA', 'R$ 8.400,00']], total: 'R$ 199.082,44' },
    { titulo: 'A receber nos próximos 7 dias', periodo: 'próximos 7 dias (09/11 a 15/11/2026)', colunas: ['cliente/fornecedor/beneficiário', 'soma dos valores'], linhas: [['SUPERMERCADOS BOM PREÇO LTDA', 'R$ 112.450,00'], ['PANIFICADORA PÃO DOURADO', 'R$ 46.300,00'], ['ATACADÃO DO AGRESTE', 'R$ 22.180,00']], total: 'R$ 180.930,00' }];
  window.RPC.rel_enviar_agora = () => 2;
}

// Central de Integrações (SQL 139) — situações FICTÍCIAS
{
  const H = (h) => new Date(Date.now() - h * 36e5).toISOString();
  const I = (codigo, nome, area, descricao, link, situacao, ultima, dias_uteis, qtd_30d, max_dias, max_padrao, extra = {}) => ({ codigo, nome, area, descricao, link, ativo: situacao !== 'desligada', situacao, ultima, dias_uteis, qtd_30d, max_dias, max_padrao, falhas_7d: 0, ...extra });
  window.RPC.integ_painel = () => [
    I('extratos', 'Extratos bancários', 'Financeiro', 'OFX, CNAB 240 e extrato do ERP importados na Conciliação Bancária, por conta.', '#/conciliacao', 'atrasada', H(5), 0, 41, 2, 2,
      { atrasadas: 1, pendentes: 23, detalhe: '1 conta(s) com o extrato atrasado; 23 lançamento(s) do extrato a conciliar', proximo_passo: 'Importe o extrato de 1 conta(s) atrasada(s) na Conciliação Bancária.' }),
    I('vexpenses', 'VExpenses', 'Financeiro', 'Extrato de despesas dos cartões (VExpenses) importado na Conciliação.', '#/conciliacao', 'ok', H(98), 4, 5, 7, 7, { proximo_passo: 'Em dia.' }),
    I('nfe_saida', 'NF-e de saída', 'Fiscal', 'XML das notas emitidas pela empresa, importados em Notas Fiscais.', '#/notas', 'ok', H(16), 1, 22, 1, 1, { detalhe: 'última emissão importada: 06/11/2026', proximo_passo: 'Em dia.' }),
    I('nfe_entrada', 'NF-e de entrada', 'Fiscal', 'XML das notas dos fornecedores, importados em Notas Fiscais.', '#/notas', 'atrasada', H(150), 5, 9, 3, 3,
      { proximo_passo: 'Importe os XML das notas de fornecedores recebidas. Última: há 5 dia(s) útil(eis); esperado a cada 3.' }),
    I('iniflex', 'Iniflex — produção', 'Produção', 'Apontamentos de produção importados do Iniflex.', '#/producao/importar', 'ok', H(20), 1, 19, 1, 1, { proximo_passo: 'Em dia.' }),
    I('efrete', 'e-frete (CIOT)', 'Logística', 'Chamadas ao e-frete para declarar e encerrar o CIOT dos fretes.', '#/logistica/fretes', 'falha', H(30), 1, 14, 0, 0,
      { falhas_7d: 1, ultimo_erro: 'Excecao: certificado digital vencido em 05/11/2026', proximo_passo: 'Abra o frete e repita a chamada; se persistir, confira o certificado e as credenciais do e-frete.' }),
    I('cnab_remessa', 'Remessa de pagamentos (CNAB)', 'Financeiro', 'Arquivos de pagamento gerados na Autorização de Pagamentos para o banco.', '#/autorizacao', 'ok', H(26), 1, 8, 0, 0, { proximo_passo: 'Em dia.' }),
    I('email', 'E-mail', 'Comunicação', 'Envio dos e-mails da plataforma pelo Resend.', '#/config/email', 'ok', H(1), 0, 312, 0, 0, { proximo_passo: 'Em dia.' }),
    I('whatsapp', 'WhatsApp', 'Comunicação', 'Envio das mensagens pela API oficial do WhatsApp.', '#/config/whatsapp', 'sem_uso', null, null, 0, 0, 0, { proximo_passo: 'Ainda não usado.' }),
    I('rotinas', 'Rotinas automáticas', 'Plataforma', 'Agendamentos do banco (avisos, cobranças, relatórios, recorrentes, limpezas).', '#/integracoes', 'ok', H(0.1), 0, 9840, 0, 0, { proximo_passo: 'Em dia.' })];
  DB.integ_geral = [{ empresa_id: E, avisar: true, papeis: ['admin', 'financeiro'] }];
  DB.integ_config = [];
}

// NF-e da SEFAZ (SQL 140) — notas e fornecedores FICTÍCIOS
{
  const D = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const ch = (i) => `26261112345678000190550010000${String(4810 + i).padStart(5, '0')}1000${String(4810 + i).padStart(5, '0')}`.slice(0, 44);
  const X = '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe"><ide><nNF>4811</nNF></ide></infNFe></NFe></nfeProc>';
  const d = (i, nome, doc, dias, valor, situacao, man, extra = {}) => ({ id: 'dfe-' + i, empresa_id: E, chave: ch(i), nsu: 1200 + i, emitente_doc: doc, emitente_nome: nome, emissao: D(dias), valor,
    situacao_nfe: 'autorizada', situacao, manifestacao: man, manifestado_em: man ? new Date().toISOString() : null, manifestacao_erro: null, nota_id: situacao === 'importada' ? 'nf-x' : null,
    recebido_em: new Date().toISOString(), xml: situacao === 'xml_disponivel' ? X : null, ...extra });
  DB.dfe_documentos = [
    d(1, 'RESINAS DO BRASIL S.A.', '12.345.678/0001-90', 1, 87570, 'xml_disponivel', 'ciencia'),
    d(2, 'COLOR MASTER TINTAS LTDA', '23.456.789/0001-01', 2, 8400, 'xml_disponivel', 'ciencia'),
    d(3, 'EMBALAGENS NORDESTE LTDA', '34.567.890/0001-12', 0, 15320.5, 'resumo', null),
    d(4, 'QUIMICA AGRESTE EIRELI', '45.678.901/0001-23', 3, 4210, 'xml_disponivel', 'ciencia'),
    d(5, 'ADESIVOS PRIME S.A.', '56.789.012/0001-34', 6, 22980, 'importada', 'confirmacao'),
    d(6, 'FILMES TÉCNICOS LTDA', '67.890.123/0001-45', 9, 51200, 'importada', 'ciencia'),
    d(7, 'TRANSPORTES RÁPIDO SUL', '78.901.234/0001-56', 12, 1830, 'ignorada', null),
    d(8, 'FORNECEDOR DESCONHECIDO LTDA', '89.012.345/0001-67', 4, 3990, 'resumo', 'desconhecimento'),
    d(9, 'PAPELÃO DO CABO LTDA', '90.123.456/0001-78', 5, 6740, 'resumo', null, { situacao_nfe: 'cancelada' })];
  DB.dfe_config = [{ empresa_id: E, ativo: true, ambiente: 'producao', ciencia_automatica: true, avisar: true, papeis: ['admin', 'financeiro', 'compras'], ultimo_nsu: 1209, max_nsu: 1209,
    proxima_consulta: new Date(Date.now() + 42 * 6e4).toISOString(), ultima_consulta: new Date(Date.now() - 18 * 6e4).toISOString(), ultimo_cstat: '137', ultimo_motivo: 'Nenhum documento localizado', ultimo_erro: null,
    validade_certificado: '2027-06-30T00:00:00Z' }];
  window.RPC.dfe_resumo = () => { const L = DB.dfe_documentos, c = (s) => L.filter(x => x.situacao === s).length;
    return { resumo: c('resumo'), xml: c('xml_disponivel'), importadas: c('importada'), ignoradas: c('ignorada'),
      valor_pendente: L.filter(x => ['resumo', 'xml_disponivel'].includes(x.situacao) && x.situacao_nfe === 'autorizada').reduce((a, x) => a + x.valor, 0) }; };
  window.RPC.dfe_ignorar = () => null;
  window.FN = window.FN || {};
  window.FN.consultar = () => ({ empresas: [{ novas: 2, xml: 1, ciencias: 1 }] });
  window.FN.manifestar = () => ({ ok: true, cStat: '135' });
}
