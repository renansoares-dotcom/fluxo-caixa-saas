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

// Recompras FIDC (SQL 093) — lista e pendências FICTÍCIAS
{
  const D0 = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  const R = (numero, data, fundo, documento, cliente, valor_titulo, valor_recompra, conta, st, venc, rec, rconta, extra = {}) => ({ id: 'rc' + numero, numero, data: D0(data), fundo, documento, cliente, valor_titulo, valor_recompra,
    encargos: Math.max(0, Math.round((valor_recompra - valor_titulo) * 100) / 100), conta, vinculada: false, cancelada: false, lancamento_id: 'l' + numero, lanc_reaberto_id: 'lr' + numero,
    reaberto_status: st, reaberto_venc: venc == null ? null : D0(venc), recebido_em: rec == null ? null : D0(rec), recebido_conta: rconta, ...extra });
  window.RPC.fidc_recompras_lista = () => [
    R(6, -2, 'Negocial', '1-38110/2', 'SUPERMERCADOS BOA COMPRA LTDA', 8420.5, 8611.3, 'NEGOCIAL', 'Em aberto', 12, null, null),
    R(5, -18, 'FS', '1-37602/1', 'ATACADO SERTÃO LTDA', 5310, 5434.88, 'FS FIDC', 'Em aberto', -6, null, null),
    R(4, -25, 'Negocial', '1-37040/3', 'DISTRIBUIDORA NORDESTE LTDA', 12750, 12988.4, 'NEGOCIAL', 'Pago', null, -9, 'UNICRED PRINCIPAL'),
    R(3, -60, 'Contato', '1-36211/1', 'FARMÁCIAS SAÚDE MAIS LTDA', 2980, 3041.2, 'BRADESCO', 'Pago', null, -40, 'BRADESCO'),
    R(1, -170, 'Negocial', '1-34724/1', 'MASTERCOLA (EXEMPLO)', 3186.08, 3256.17, 'NEGOCIAL', 'Pago', null, -117, 'VEXPENSES', { vinculada: true }),
  ];
  window.RPC.fidc_recompras_pendentes = () => [
    { origem: 'fundo', id: 'q1', data: D0(-3), fundo: 'FS', documento: '38544-001', valor: 4185.9, cliente: 'ATACADO SERTÃO LTDA', sugestao_id: 'c1', sugestao_doc: '1-38544/1', sugestao_valor: 4102 },
    { origem: 'manual', id: 'm1', data: D0(-12), fundo: 'Negocial', documento: 'DOCTO REC 37811/1 NEGOCIAL FIDC', valor: 6640.12, cliente: null, sugestao_id: 'c2', sugestao_doc: '1-37811/1', sugestao_valor: 6512 },
  ];
  window.RPC.fidc_cedidos_busca = () => [
    { id: 'c1', data: D0(-40), documento: '1-38544/1', cliente: 'ATACADO SERTÃO LTDA', valor: 4102, fundo: 'FS', conta: 'FS FIDC', vencimento: D0(-4) },
    { id: 'c3', data: D0(-40), documento: '1-38544/2', cliente: 'ATACADO SERTÃO LTDA', valor: 4102, fundo: 'FS', conta: 'FS FIDC', vencimento: D0(26) },
  ];
  DB.fidc_recompra_config = [];
}
