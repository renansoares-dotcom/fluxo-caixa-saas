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
// Comercial
DB.comercial_vendedores = [{ id: 'rp1', empresa_id: E, nome: 'MARCOS VENDAS', email: 'marcos@exemplo.com.br', ativo: true, comissao_pct: 2 }];
DB.comercial_oportunidades = [['SUPERMERCADOS', 'Sacolas personalizadas — Natal', 'proposta', 48000, 60], ['ATACADO', 'Bobinas picotadas', 'qualificado', 22000, 40], ['DISTRIBUIDORA', 'Contrato anual de sacos de lixo', 'contato', 120000, 20], ['FARMÁCIAS', 'Sacolas farmácia', 'ganha', 18000, 100]]
  .map(([c, titulo, etapa, valor, prob], i) => ({ id: id('opp'), empresa_id: E, numero: 80 + i, favorecido_id: FV(c), vendedor_id: 'rp1', titulo, etapa, valor_estimado: valor, probabilidade: prob, previsao_fechamento: dia(HOJE, 15 + i * 7), criado_em: '2026-10-01T10:00:00Z', atualizado_em: '2026-10-25T10:00:00Z' }));
DB.comercial_metas = [];
// Créditos e FIDC
DB.creditos = [{ id: id('cr'), empresa_id: E, favorecido_id: FV('ATACADO'), natureza: 'cliente', tipo: 'adiantamento', data: '2026-10-08', valor: 15000, descricao: 'Adiantamento do pedido 7781', cancelado: false, criado_em: '2026-10-08T10:00:00Z' },
  { id: id('cr'), empresa_id: E, favorecido_id: FV('RESINAS'), natureza: 'fornecedor', tipo: 'devolucao', data: '2026-10-14', valor: 3420, descricao: 'Devolução de resina fora de especificação', cancelado: false, criado_em: '2026-10-14T10:00:00Z' }];
DB.creditos_usos = [];
DB.fidc_fundos = [{ id: 'fd1', empresa_id: E, nome: 'FUNDO EXEMPLO FIDC', ativo: true }];
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
