// Modelos de contrato (SQL 069): minutas-base preenchidas com os cadastros da empresa, da outra parte e do contrato.
// Saem em A4, no padrão do papel timbrado, para imprimir em PDF e assinar no gov.br. Revise com o jurídico antes do primeiro uso.
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LACUNA = '<span class="lac">______________________</span>';

// ---------------------------------------------------------------- formatação
export const dataBR = (iso) => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '';
export function dataExtenso(iso) {
  if (!iso) return '';
  const M = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} de ${M[m - 1]} de ${a}`;
}
export function docFmt(d) {
  const s = String(d || '').replace(/\D/g, '');
  if (s.length === 11) return s.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (s.length === 14) return s.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d || '';
}
const moeda = (v) => (+v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const U = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const D = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const C = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
function ate999(n) {
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100), r = n % 100, p = [];
  if (c) p.push(C[c]);
  if (r) p.push(r < 20 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? ' e ' + U[r % 10] : ''));
  return p.join(' e ');
}
function inteiro(n) {
  if (n === 0) return 'zero';
  const NOMES = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']];
  const gs = []; let k = 0, x = n;
  while (x > 0) { const g = x % 1000; if (g) gs.unshift({ g, k }); x = Math.floor(x / 1000); k++; }
  return gs.map(({ g, k: kk }, j) => {
    const txt = kk === 1 && g === 1 ? 'mil' : ate999(g) + (kk ? ' ' + NOMES[kk][g === 1 ? 0 : 1] : '');
    const sep = j === 0 ? '' : (j === gs.length - 1 && (g < 100 || g % 100 === 0) ? ' e ' : ' ');
    return sep + txt;
  }).join('');
}
/** valor por extenso em reais: 1.250,50 → "mil, duzentos e cinquenta reais e cinquenta centavos" */
export function extenso(v) {
  const t = Math.round((+v || 0) * 100), r = Math.floor(t / 100), c = t % 100;
  const partes = [];
  if (r) { const s = inteiro(r); partes.push(`${s}${/(milhão|milhões|bilhão|bilhões)$/.test(s) ? ' de' : ''} ${r === 1 ? 'real' : 'reais'}`); }
  if (c) partes.push(`${inteiro(c)} ${c === 1 ? 'centavo' : 'centavos'}`);
  return partes.join(' e ') || 'zero real';
}
export const valorTxt = (v) => `${moeda(v)} (${extenso(v)})`;

const PER = { mensal: 'por mês', bimestral: 'por bimestre', trimestral: 'por trimestre', semestral: 'por semestre', anual: 'por ano', unica: 'em parcela única' };

// ---------------------------------------------------------------- partes
function endereco(o) {
  if (!o) return '';
  const l = [o.logradouro, o.numero].filter(Boolean).join(', ');
  return [l, o.complemento, o.bairro, o.municipio && o.uf ? `${o.municipio}/${o.uf}` : o.municipio, o.cep ? `CEP ${String(o.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2')}` : ''].filter(Boolean).join(', ');
}
/** qualificação da empresa (sempre pessoa jurídica) */
function qualEmpresa(e, papel) {
  return `<b>${esc(e.razao)}</b>, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${esc(docFmt(e.cnpj)) || LACUNA}, com sede em ${esc(e.endereco) || LACUNA}, neste ato representada por ${esc(e.rep_nome) || LACUNA}${e.rep_qualif ? ', ' + esc(e.rep_qualif) : ''}, CPF nº ${esc(docFmt(e.rep_cpf)) || LACUNA}, doravante denominada <b>${papel}</b>`;
}
/** qualificação da outra parte (PF ou PJ pelo tamanho do documento) */
function qualParte(p, papel) {
  const doc = String(p.doc || '').replace(/\D/g, '');
  if (doc.length === 14) return `<b>${esc(p.nome)}</b>, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${esc(docFmt(doc))}, com sede em ${esc(p.endereco) || LACUNA}, neste ato representada por ${esc(p.rep_nome) || LACUNA}${p.rep_qualif ? ', ' + esc(p.rep_qualif) : ''}${p.rep_nome ? `, CPF nº ${p.rep_cpf ? esc(docFmt(p.rep_cpf)) : LACUNA}` : ''}, doravante denominada <b>${papel}</b>`;
  return `<b>${esc(p.nome)}</b>, inscrito(a) no CPF sob o nº ${doc ? esc(docFmt(doc)) : LACUNA}${p.rg ? `, RG nº ${esc(p.rg)}` : ''}, residente e domiciliado(a) em ${esc(p.endereco) || LACUNA}, doravante denominado(a) <b>${papel}</b>`;
}

/**
 * contexto do modelo a partir do que a tela já tem:
 *  empresa (empresas), ident (empresa_identidade), contrato, parte {nome, doc, endereco, …} e dados (campos do modelo)
 */
export function contexto({ empresa = {}, ident = {}, contrato = {}, parte = {}, logo = null }) {
  const un = (ident.unidades || [])[0] || {};
  const e = {
    // Lei 11.101/2005, art. 69: em todos os contratos do devedor, “em Recuperação Judicial” após o nome empresarial
    razao: ((r) => /RECUPERA/i.test(empresa.razao_social || '') && !/RECUPERA/i.test(r) ? `${r.replace(/\.$/, '')}. – EM RECUPERAÇÃO JUDICIAL` : r.replace(/\.$/, '') + '.')(ident.razao_documentos || empresa.razao_social || empresa.nome || ''),
    cnpj: empresa.cnpj || un.cnpj, endereco: un.endereco ? [un.endereco, un.municipio && `${un.municipio}/${un.uf}`, un.cep && `CEP ${un.cep}`].filter(Boolean).join(', ') : endereco(empresa),
    rep_nome: empresa.responsavel_nome, rep_cpf: empresa.responsavel_cpf, municipio: un.municipio || empresa.municipio, uf: un.uf || empresa.uf,
    telefone: ident.telefone, site: ident.site, rodape: ident.rodape_documentos,
  };
  const d = { foro: e.municipio && e.uf ? `${e.municipio}/${e.uf}` : '', ...(contrato.dados || {}) };
  return { e, p: { ...parte, endereco: parte.endereco || '' }, c: contrato, d, logo, cor: ident.cor_primaria || '#2b5598' };
}

// ---------------------------------------------------------------- cláusulas comuns
const v = (x) => (x == null || x === '' ? LACUNA : esc(x));
function clPrazo(x, quem = 'qualquer das partes') {
  const { c } = x;
  if (!c.fim) return [`O presente contrato vigora por prazo indeterminado a partir de ${dataBR(c.inicio) || LACUNA}, podendo ser rescindido por ${quem} mediante aviso prévio por escrito de ${c.aviso_previo_dias ?? 30} (${extensoN(c.aviso_previo_dias ?? 30)}) dias.`];
  return [`O presente contrato vigora de ${dataBR(c.inicio) || LACUNA} a ${dataBR(c.fim)}${c.renovacao_automatica ? ', renovando-se automaticamente por igual período se nenhuma das partes manifestar, por escrito, o desinteresse na renovação' : ''}.`,
    `Qualquer das partes poderá rescindi-lo antes do término mediante aviso prévio por escrito de ${c.aviso_previo_dias ?? 30} (${extensoN(c.aviso_previo_dias ?? 30)}) dias, sem multa, ressalvado o pagamento do que for devido até a data da rescisão.`];
}
const extensoN = (n) => inteiro(+n || 0);
function clPreco(x, quem, recebe) {
  const { c, d } = x;
  if (c.natureza === 'sem_valor' || !(+c.valor > 0)) return null;
  const venc = c.dia_vencimento ? `até o dia ${c.dia_vencimento} de cada ${c.periodicidade === 'mensal' ? 'mês' : 'período'}` : 'no vencimento combinado';
  return [`Pelo objeto deste contrato, a ${quem} pagará à ${recebe} o valor de ${valorTxt(c.valor)} ${PER[c.periodicidade] || ''}, ${c.periodicidade === 'unica' ? 'na data combinada' : venc}, mediante ${d.forma_pagamento ? esc(d.forma_pagamento) : 'depósito ou PIX em conta de titularidade da ' + recebe}.`,
    `O pagamento fica condicionado à apresentação do documento fiscal ou recibo correspondente, quando exigível. O atraso sujeita o valor devido a multa de 2% (dois por cento) e juros de 1% (um por cento) ao mês, calculados pro rata die.`];
}
function clReajuste(x) {
  const { c } = x;
  if (c.natureza === 'sem_valor' || c.indice === 'nenhum' || !(+c.valor > 0)) return null;
  const ind = c.indice === 'fixo' ? `pelo percentual fixo de ${String(c.reajuste_fixo_pct ?? '____').replace('.', ',')}% (ao ano)` : `pela variação acumulada do ${c.indice} nos 12 (doze) meses anteriores`;
  return [`O valor será reajustado a cada 12 (doze) meses${c.data_base ? `, tendo como data-base ${dataBR(c.data_base).slice(0, 5)}` : ''}, ${ind}. Em caso de extinção do índice, será adotado o que oficialmente o substituir.`];
}
const clLGPD = () => ['As partes tratarão os dados pessoais a que tiverem acesso em razão deste contrato apenas para a sua execução, em conformidade com a Lei nº 13.709/2018 (Lei Geral de Proteção de Dados Pessoais), adotando medidas de segurança adequadas e comunicando à outra parte qualquer incidente que os envolva.'];
function clFinais(x) {
  return ['Este contrato não gera vínculo empregatício entre as partes nem entre uma delas e os empregados, prepostos ou contratados da outra, respondendo cada parte, com exclusividade, pelos encargos trabalhistas, previdenciários e fiscais do seu pessoal.',
    'Nenhuma alteração deste contrato terá validade se não for feita por aditivo escrito e assinado pelas partes. A tolerância de uma parte com o descumprimento da outra não importa novação nem renúncia de direitos.',
    'As partes reconhecem como válida a assinatura deste instrumento por meio eletrônico, inclusive pela plataforma gov.br ou com certificado digital ICP-Brasil, nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001, dispensada a assinatura física.',
    `Fica eleito o foro da comarca de ${v(x.d.foro)} para dirimir as questões oriundas deste contrato, com renúncia a qualquer outro, por mais privilegiado que seja.`];
}
function veiculo(d) {
  const ve = d.veiculo || {};
  const t = [ve.marca_modelo && `${esc(ve.marca_modelo)}`, ve.ano && `ano ${esc(ve.ano)}`, ve.cor && `cor ${esc(ve.cor)}`, `placa ${ve.placa ? esc(String(ve.placa).toUpperCase()) : LACUNA}`, `RENAVAM ${ve.renavam ? esc(ve.renavam) : LACUNA}`].filter(Boolean).join(', ');
  return `o veículo ${t}`;
}

// ---------------------------------------------------------------- modelos
const PAPEIS = (x, a, b) => x.c.natureza === 'receber' ? { nos: b, eles: a } : { nos: a, eles: b };   // a = quem paga

export const MODELOS = {
  locacao_veiculo: {
    titulo: 'Contrato de locação de veículo', tipos: ['locacao_veiculo'], campos: ['veiculo', 'uso', 'seguro', 'forma_pagamento', 'foro', 'testemunhas'],
    papeis: (x) => PAPEIS(x, 'LOCATÁRIA', 'LOCADORA'),
    clausulas: (x, P) => [
      ['Do objeto', [`A ${P.loc('LOCADORA')} dá em locação à ${P.loc('LOCATÁRIA')} ${veiculo(x.d)}, de sua propriedade, em perfeitas condições de uso e com a documentação regular, para uso ${x.d.uso ? esc(x.d.uso) : 'nas atividades da LOCATÁRIA'}.`]],
      ['Do prazo', clPrazo(x)],
      ['Do preço e do pagamento', clPreco(x, 'LOCATÁRIA', 'LOCADORA')],
      ['Do reajuste', clReajuste(x)],
      ['Da entrega e da devolução', ['O veículo será entregue e devolvido mediante Termo de Vistoria assinado pelas partes, com o registro da quilometragem, do nível de combustível, do estado de conservação e de eventuais avarias, que integra este contrato.',
        'A LOCATÁRIA devolverá o veículo no estado em que o recebeu, ressalvado o desgaste natural pelo uso normal.']],
      ['Das obrigações da LOCATÁRIA', ['Usar o veículo conforme a sua destinação, somente por condutores habilitados na categoria exigida e por ela autorizados; arcar com o combustível; não sublocar, ceder ou emprestar o veículo sem autorização escrita; comunicar à LOCADORA, em até 24 (vinte e quatro) horas, qualquer acidente, furto, roubo ou dano.']],
      ['Das obrigações da LOCADORA', ['Manter o veículo com a documentação regular (CRLV, IPVA, licenciamento e seguro obrigatório) e responder pelas manutenções preventivas e corretivas decorrentes do desgaste natural, salvo os danos causados por mau uso, que serão de responsabilidade da LOCATÁRIA.']],
      ['Das multas e infrações de trânsito', ['As multas e infrações cometidas durante a locação são de responsabilidade da LOCATÁRIA, que indicará o condutor responsável no prazo previsto no art. 257 do Código de Trânsito Brasileiro, a partir da notificação recebida da LOCADORA.']],
      ['Do seguro', [`O seguro do veículo (casco e responsabilidade civil perante terceiros) fica a cargo ${x.d.seguro ? esc(x.d.seguro) : 'da LOCADORA'}. A franquia, em caso de sinistro causado por culpa do condutor, será suportada pela LOCATÁRIA.`]],
      ['Da proteção de dados', clLGPD()],
      ['Das disposições finais', clFinais(x)],
    ],
  },
  locacao_veiculo_motorista: {
    titulo: 'Contrato de locação de veículo com motorista', tipos: ['locacao_veiculo_motorista'], campos: ['veiculo', 'motorista', 'rota', 'combustivel', 'seguro', 'forma_pagamento', 'foro', 'testemunhas'],
    papeis: (x) => PAPEIS(x, 'CONTRATANTE', 'CONTRATADA'),
    clausulas: (x) => [
      ['Do objeto', [`A CONTRATADA coloca à disposição da CONTRATANTE ${veiculo(x.d)}, com motorista por ela contratado e habilitado${x.d.motorista ? ` (${esc(x.d.motorista)})` : ''}, para a execução de transportes ${x.d.rota ? `na seguinte rota ou região: ${esc(x.d.rota)}` : 'conforme as programações da CONTRATANTE'}.`]],
      ['Do prazo', clPrazo(x)],
      ['Do preço e do pagamento', clPreco(x, 'CONTRATANTE', 'CONTRATADA')],
      ['Do reajuste', clReajuste(x)],
      ['Do motorista', ['O motorista é empregado ou contratado exclusivo da CONTRATADA, que responde integralmente pela sua remuneração, encargos trabalhistas e previdenciários, controle de jornada e tempos de descanso previstos na Lei nº 13.103/2015, exames toxicológicos e treinamentos obrigatórios, sem qualquer subordinação à CONTRATANTE.',
        'A CONTRATADA substituirá o motorista, em até 48 (quarenta e oito) horas, nas faltas, férias e afastamentos, ou quando a CONTRATANTE apontar justo motivo.']],
      ['Do veículo', [`A CONTRATADA mantém o veículo em perfeitas condições, com a documentação regular, manutenção em dia e cronotacógrafo aferido, quando exigido. O combustível fica a cargo ${x.d.combustivel ? esc(x.d.combustivel) : 'da CONTRATADA'}.`]],
      ['Das multas e infrações', ['As infrações de trânsito, as multas e os danos causados pelo motorista, inclusive a terceiros e às mercadorias transportadas, são de responsabilidade da CONTRATADA.']],
      ['Do seguro', [`O seguro do veículo e de responsabilidade civil perante terceiros fica a cargo ${x.d.seguro ? esc(x.d.seguro) : 'da CONTRATADA'}.`]],
      ['Da proteção de dados', clLGPD()],
      ['Das disposições finais', clFinais(x)],
    ],
  },
  servico: {
    titulo: 'Contrato de prestação de serviços', tipos: ['servico', 'fornecimento', 'locacao_imovel', 'venda', 'outro'], campos: ['escopo', 'local', 'forma_pagamento', 'foro', 'testemunhas'],
    papeis: (x) => PAPEIS(x, 'CONTRATANTE', 'CONTRATADA'),
    clausulas: (x) => [
      ['Do objeto', [`A CONTRATADA prestará à CONTRATANTE os seguintes serviços: ${esc(x.c.objeto) || LACUNA}${x.d.escopo ? `, conforme o escopo: ${esc(x.d.escopo)}` : ''}${x.d.local ? `, no local: ${esc(x.d.local)}` : ''}.`]],
      ['Do prazo', clPrazo(x)],
      ['Do preço e do pagamento', clPreco(x, 'CONTRATANTE', 'CONTRATADA')],
      ['Do reajuste', clReajuste(x)],
      ['Da execução', ['A CONTRATADA executará os serviços com autonomia técnica, com pessoal próprio e qualificado, observando as normas de segurança do trabalho e as regras internas da CONTRATANTE quando estiver em suas dependências.',
        'Os serviços que não forem prestados conforme o combinado serão refeitos pela CONTRATADA, sem custo, no prazo indicado pela CONTRATANTE.']],
      ['Da confidencialidade', ['A CONTRATADA manterá sigilo sobre as informações da CONTRATANTE a que tiver acesso, durante a vigência e por 2 (dois) anos após o término deste contrato.']],
      ['Da proteção de dados', clLGPD()],
      ['Das disposições finais', clFinais(x)],
    ],
  },
  transporte_tac: {
    titulo: 'Contrato de transporte rodoviário de cargas — Transportador Autônomo (TAC)', tipos: ['transporte_tac'], campos: ['veiculo', 'rntrc', 'rota', 'foro', 'testemunhas'],
    papeis: () => ({ nos: 'CONTRATANTE', eles: 'CONTRATADO' }),
    clausulas: (x) => [
      ['Do objeto', [`O CONTRATADO, Transportador Autônomo de Cargas inscrito no RNTRC sob o nº ${v(x.d.rntrc)}, realizará para a CONTRATANTE o transporte rodoviário de cargas${x.d.rota ? ` na seguinte rota ou região: ${esc(x.d.rota)}` : ''}, utilizando ${veiculo(x.d)}, nos termos da Lei nº 11.442/2007.`,
        'Cada viagem será contratada por Ordem de Carregamento que indicará origem, destino, carga, peso e valor do frete, e que integra este contrato.']],
      ['Da natureza da relação', ['A relação entre as partes é de natureza exclusivamente comercial, não caracterizando vínculo empregatício, nos termos do art. 5º da Lei nº 11.442/2007.']],
      ['Do prazo', clPrazo(x)],
      ['Do frete', ['O valor de cada frete será o indicado na Ordem de Carregamento e nunca inferior ao piso mínimo de frete da ANTT vigente (Lei nº 13.703/2018).',
        'Para cada viagem, a CONTRATANTE gerará o Código Identificador da Operação de Transporte (CIOT) e efetuará o pagamento do frete por meio de Instituição de Pagamento Eletrônico de Frete (IPEF) habilitada pela ANTT, em conta de titularidade do CONTRATADO ou por ele indicada nos termos da regulamentação, conforme o art. 5º-A da Lei nº 11.442/2007.',
        'O Vale-Pedágio obrigatório será antecipado pela CONTRATANTE, em separado e sem integrar o valor do frete (Lei nº 10.209/2001).']],
      ['Das obrigações do CONTRATADO', ['Manter regulares a sua inscrição no RNTRC, a CNH na categoria exigida, o exame toxicológico, a documentação e o licenciamento do veículo; respeitar os tempos de direção e descanso; emitir os documentos fiscais e de transporte que lhe couberem; comunicar imediatamente qualquer sinistro, avaria, roubo ou atraso.',
        'Contratar e manter os seguros obrigatórios do transportador previstos no art. 13 da Lei nº 11.442/2007, quando a ele couberem.']],
      ['Da responsabilidade pela carga', ['O CONTRATADO responde pela carga desde o recebimento até a entrega ao destinatário, nos limites da Lei nº 11.442/2007, devendo conferir volumes e lacres no carregamento e registrar qualquer divergência no documento de transporte.']],
      ['Da proteção de dados', clLGPD()],
      ['Das disposições finais', clFinais(x)],
    ],
  },
  agregado: {
    titulo: 'Contrato de agregação — Transportador Autônomo de Cargas Agregado (TAC-agregado)', tipos: ['agregado'], campos: ['veiculo', 'rntrc', 'rota', 'foro', 'testemunhas'],
    papeis: () => ({ nos: 'CONTRATANTE', eles: 'AGREGADO' }),
    clausulas: (x) => [
      ['Do objeto', [`O AGREGADO, Transportador Autônomo de Cargas inscrito no RNTRC sob o nº ${v(x.d.rntrc)}, coloca ${veiculo(x.d)}, conduzido por ele próprio ou por preposto seu, a serviço da CONTRATANTE, com exclusividade, mediante remuneração certa, nos termos do art. 4º, § 1º, da Lei nº 11.442/2007${x.d.rota ? `, para atender à seguinte rota ou região: ${esc(x.d.rota)}` : ''}.`]],
      ['Da natureza da relação', ['A relação entre as partes é de natureza exclusivamente comercial, não caracterizando vínculo empregatício, nos termos do art. 5º da Lei nº 11.442/2007.']],
      ['Do prazo', clPrazo(x)],
      ['Da remuneração', [...(clPreco(x, 'CONTRATANTE', 'AGREGADO') || ['A remuneração será a indicada nas Ordens de Carregamento de cada viagem.']),
        'Cada viagem terá o seu CIOT, e o pagamento será feito por Instituição de Pagamento Eletrônico de Frete (IPEF) habilitada pela ANTT, em conta de titularidade do AGREGADO ou por ele indicada nos termos da regulamentação, respeitado o piso mínimo de frete da ANTT. O Vale-Pedágio obrigatório será antecipado em separado.']],
      ['Do reajuste', clReajuste(x)],
      ['Das obrigações do AGREGADO', ['Manter regulares o RNTRC, a CNH, o exame toxicológico, a documentação, a manutenção e o licenciamento do veículo; respeitar os tempos de direção e descanso; contratar e manter os seguros obrigatórios do transportador previstos no art. 13 da Lei nº 11.442/2007, quando a ele couberem; comunicar imediatamente sinistros, avarias e atrasos.']],
      ['Da identificação do veículo', ['A plotagem do veículo com a marca da CONTRATANTE, se houver, será feita e retirada por conta da CONTRATANTE, sem cobrir faixas refletivas, placas ou identificações obrigatórias, e será removida até 10 (dez) dias após o término deste contrato.']],
      ['Da proteção de dados', clLGPD()],
      ['Das disposições finais', clFinais(x)],
    ],
  },
  confidencialidade: {
    titulo: 'Acordo de confidencialidade', tipos: ['confidencialidade'], campos: ['finalidade', 'prazo_sigilo', 'foro', 'testemunhas'],
    papeis: () => ({ nos: 'PARTE REVELADORA E RECEPTORA', eles: 'PARTE REVELADORA E RECEPTORA' }),
    clausulas: (x) => [
      ['Do objeto', [`As partes trocarão informações confidenciais com a finalidade de ${x.d.finalidade ? esc(x.d.finalidade) : esc(x.c.objeto) || LACUNA}, e se obrigam a mantê-las em sigilo nos termos deste acordo.`]],
      ['Das informações confidenciais', ['São confidenciais todas as informações técnicas, comerciais, financeiras, de clientes, fornecedores, preços, processos e produtos, recebidas por qualquer meio, identificadas ou não como confidenciais.',
        'Não são confidenciais as informações que já eram públicas, que se tornarem públicas sem culpa da parte receptora, que ela já possuía de forma lícita ou que tiver de revelar por ordem judicial ou de autoridade, caso em que avisará a outra parte imediatamente.']],
      ['Das obrigações', ['Cada parte usará as informações somente para a finalidade deste acordo, dará acesso apenas às pessoas que precisem conhecê-las e que estejam obrigadas a igual sigilo, e devolverá ou destruirá as informações quando solicitado.']],
      ['Do prazo', [`Este acordo vigora a partir de ${dataBR(x.c.inicio) || LACUNA}, e as obrigações de sigilo permanecem por ${x.d.prazo_sigilo || 5} (${extensoN(x.d.prazo_sigilo || 5)}) anos após o fim da relação entre as partes.`]],
      ['Das penalidades', ['A parte que descumprir este acordo responderá pelas perdas e danos causados à outra, sem prejuízo das demais medidas legais cabíveis.']],
      ['Da proteção de dados', clLGPD()],
      ['Das disposições finais', clFinais(x).slice(1)],
    ],
  },
  responsabilidade_motorista: {
    titulo: 'Termo de responsabilidade pelo uso de veículo', termo: true, tipos: [], campos: ['veiculo', 'cnh', 'foro'],
    papeis: () => ({ nos: 'EMPRESA', eles: 'COLABORADOR' }),
    clausulas: (x) => [
      ['Do veículo', [`O COLABORADOR recebe da EMPRESA, para uso exclusivo em serviço, ${veiculo(x.d)}, nas condições descritas no Termo de Vistoria assinado na entrega.`]],
      ['Dos compromissos do COLABORADOR', [`Manter válida a CNH nº ${v(x.d.cnh?.numero)}, categoria ${v(x.d.cnh?.categoria)}, e, quando exigido, o exame toxicológico; não conduzir sob efeito de álcool ou de qualquer substância psicoativa; respeitar a legislação de trânsito e os tempos de direção e descanso; fazer a verificação diária do veículo; não transportar pessoas ou cargas não autorizadas; comunicar à EMPRESA, imediatamente, qualquer acidente, avaria, multa, furto ou roubo.`]],
      ['Das infrações de trânsito', ['O COLABORADOR reconhece a sua responsabilidade pelas infrações que cometer na condução do veículo e concorda em ser indicado como condutor infrator, assinando o formulário de identificação do condutor quando a EMPRESA receber a notificação.']],
      ['Dos danos', ['Nos termos do art. 462, § 1º, da CLT, o COLABORADOR autoriza o desconto em sua remuneração dos valores de multas de trânsito de sua responsabilidade e dos danos que causar ao veículo ou a terceiros por dolo ou culpa (imprudência, negligência ou imperícia), apurados com direito de defesa, respeitados os limites legais.']],
      ['Da devolução', ['O veículo será devolvido sempre que a EMPRESA solicitar e no desligamento, mediante Termo de Vistoria.']],
      ['Das disposições finais', [`Fica eleito o foro da comarca de ${v(x.d.foro)}.`]],
    ],
  },
  uso_imagem: {
    titulo: 'Termo de autorização de uso de imagem', termo: true, tipos: [], campos: ['uso_externo'],
    papeis: () => ({ nos: 'EMPRESA', eles: 'TITULAR' }),
    clausulas: (x) => [
      ['Da autorização', [`O TITULAR autoriza a EMPRESA, a título gratuito, a usar a sua imagem (fotografia) no crachá de identificação, nos sistemas internos de controle de acesso e de pessoal e na comunicação interna da EMPRESA${x.d.uso_externo ? ', bem como em materiais institucionais e redes sociais da EMPRESA, sem fins de venda de produto específico' : ''}.`]],
      ['Da finalidade e dos dados', ['A imagem será tratada apenas para as finalidades acima, com base na Lei nº 13.709/2018 (LGPD) e no art. 20 do Código Civil, e guardada com acesso restrito às pessoas autorizadas.']],
      ['Do prazo e da revogação', ['Esta autorização vale enquanto durar o vínculo do TITULAR com a EMPRESA e pode ser revogada a qualquer tempo, por escrito, sem efeito sobre os usos já realizados. No desligamento, a foto deixa de ser usada e é excluída dos sistemas, ressalvadas as obrigações legais de guarda.']],
    ],
  },
  // ------------------------------------------------------------ modelos consolidados com o jurídico (06/11/2026)
  // Base: minutas do jurídico (locação IPLAMM → Kratos e transporte Kratos → IPLAMM) + exigências da ANTT, da Lei 11.442/2007,
  // da Lei 11.101/2005 (recuperação judicial) e da reforma tributária. Ver relatório IPLAMM_Analise_Contratos_Locacao_Transporte_06-11-2026.
  locacao_veiculo_carga: {
    titulo: 'Contrato de locação de veículos automotores para transporte de cargas', tipos: [], anexoVeiculos: true,
    campos: ['veiculos', 'rntrc', 'rj_processo', 'foro', 'testemunhas'],
    papeis: (x) => PAPEIS(x, 'LOCATÁRIA', 'LOCADORA'),
    clausulas: (x) => [
      ['Do objeto', [
        `O presente contrato tem por objeto a locação onerosa, pela LOCADORA à LOCATÁRIA, dos veículos automotores de carga relacionados no <b>Anexo I (Relação dos Veículos)</b>, de propriedade da LOCADORA, destinados exclusivamente ao transporte rodoviário remunerado de cargas realizado pela LOCATÁRIA, empresa de transporte rodoviário de cargas inscrita no Registro Nacional de Transportadores Rodoviários de Cargas (RNTRC) sob o nº ${v(x.d.rntrc)}.`,
        'A locação compreende exclusivamente a disponibilização dos veículos, sem fornecimento de motoristas, ajudantes, combustível ou serviços operacionais pela LOCADORA.',
        'A LOCATÁRIA utilizará os veículos no desenvolvimento de suas atividades empresariais, inclusive na execução de serviços de transporte eventualmente contratados pela própria LOCADORA, sem que isso implique confusão entre as obrigações decorrentes dos contratos.',
        'A inclusão, a substituição ou a exclusão de veículos será feita por termo aditivo que atualize o Anexo I.',
        'É vedada a cessão, transferência, sublocação ou disponibilização dos veículos a terceiros sem autorização prévia e expressa da LOCADORA.']],
      ['Do prazo', [
        x.c.inicio && x.c.fim ? `O presente contrato vigora de ${dataBR(x.c.inicio)} a ${dataBR(x.c.fim)}.` : 'O presente contrato terá vigência de 12 (doze) meses, contados da data de sua assinatura.',
        'A prorrogação dependerá de acordo escrito entre as partes, mediante termo aditivo.',
        'A permanência dos veículos em poder da LOCATÁRIA após o término contratual, sem autorização da LOCADORA, sujeitará a LOCATÁRIA às consequências legais e contratuais, inclusive à indenização pela utilização indevida e por eventuais perdas e danos.']],
      ['Do valor e da forma de pagamento', [
        `Pela locação, a LOCATÁRIA pagará à LOCADORA o valor mensal indicado para cada veículo no Anexo I, totalizando ${+x.c.valor > 0 ? valorTxt(x.c.valor) : LACUNA} por mês.`,
        'O pagamento ocorrerá até o 5º (quinto) dia útil de cada mês, por transferência bancária ou PIX para conta de titularidade da LOCADORA, contra o documento de cobrança emitido por ela.',
        'O atraso no pagamento acarretará multa moratória de 2% (dois por cento) sobre o valor vencido, juros de mora de 1% (um por cento) ao mês, calculados pro rata die, e atualização monetária pelo IPCA.',
        'O atraso superior a 15 (quinze) dias autorizará a LOCADORA a rescindir o contrato, mediante notificação escrita, sem prejuízo da cobrança dos valores devidos e da exigência de devolução dos veículos.',
        'Os valores serão reajustados a cada 12 (doze) meses pela variação acumulada do IPCA/IBGE, ou pelo índice oficial que venha a substituí-lo.',
        'Eventual compensação entre valores de aluguel e créditos decorrentes de serviços de transporte prestados pela LOCATÁRIA dependerá de autorização expressa e escrita da LOCADORA, mediante conciliação financeira entre as partes.']],
      ['Da regularização perante a ANTT e o órgão de trânsito', [
        'A LOCADORA providenciará, às suas expensas, a alteração dos veículos para a categoria “aluguel” perante o órgão executivo de trânsito, exigida para o cadastro na frota de transportador inscrito no RNTRC (Resolução ANTT nº 5.982/2022).',
        'A LOCADORA, na condição de proprietária, cadastrará este contrato no sistema RNTRC Digital da ANTT. Em seguida, a LOCATÁRIA incluirá os veículos em sua frota no RNTRC.',
        'Nenhum veículo será utilizado em transporte remunerado antes de constar da frota da LOCATÁRIA no RNTRC.',
        'A LOCATÁRIA manterá ativo o seu RNTRC, com responsável técnico cadastrado, durante toda a vigência.',
        'No encerramento da locação, ou na exclusão de um veículo do Anexo I, a LOCATÁRIA excluirá o veículo de sua frota no RNTRC no prazo de 5 (cinco) dias úteis, e a LOCADORA encerrará o cadastro do contrato.']],
      ['Da entrega, das condições e da devolução dos veículos', [
        'Os veículos serão entregues à LOCATÁRIA mediante Termo de Entrega e Vistoria (Anexo II), com a descrição de suas condições gerais de conservação, funcionamento, quilometragem e acessórios, e as eventuais ressalvas da LOCATÁRIA.',
        'A LOCADORA disponibilizará os veículos com documentação regular e em condições de utilização compatíveis com sua finalidade, observadas as normas de segurança e circulação aplicáveis.',
        'A LOCATÁRIA conservará os veículos e os devolverá nas condições em que os recebeu, ressalvado o desgaste natural decorrente do uso regular, mediante novo Termo de Vistoria.']],
      ['Das obrigações da LOCATÁRIA', [
        'Constituem obrigações da LOCATÁRIA: a) utilizar os veículos exclusivamente no transporte rodoviário de cargas, respeitando sua capacidade e especificações técnicas; b) disponibilizar motoristas empregados ou por ela contratados, habilitados na categoria exigida, com exame toxicológico em dia e observância da jornada e dos tempos de descanso da Lei nº 13.103/2015; c) responder integralmente pelos encargos trabalhistas, previdenciários e fiscais desses profissionais; d) arcar com combustível, lubrificantes, pedágios, estacionamentos, lavagem e demais custos operacionais, ressalvado o vale-pedágio obrigatório, que é de responsabilidade do embarcador (Lei nº 10.209/2001); e) registrar, em cada viagem remunerada, o Código Identificador da Operação de Transporte (CIOT) e emitir o CT-e e o MDF-e exigidos; f) comunicar imediatamente à LOCADORA acidentes, furtos, roubos, apreensões, avarias ou fatos que comprometam a integridade ou a disponibilidade dos veículos; g) não realizar modificações estruturais ou mecânicas sem autorização escrita da LOCADORA; h) não transportar cargas ilícitas, perigosas ou incompatíveis com os veículos sem o cumprimento das autorizações e exigências legais; i) permitir vistorias pela LOCADORA, mediante comunicação prévia e sem prejuízo injustificado da operação; j) não permitir a condução por pessoas sem habilitação compatível ou em condições incompatíveis com a segurança viária; k) cumprir as normas de trânsito, de transporte rodoviário e de segurança aplicáveis.']],
      ['Das obrigações da LOCADORA', [
        'Constituem obrigações da LOCADORA: a) manter os veículos com a documentação regular, arcando com o IPVA, o licenciamento anual e as taxas de propriedade; b) responder pelos defeitos preexistentes à entrega, pelos vícios ocultos comprovadamente anteriores à locação e pelos problemas estruturais não decorrentes da utilização pela LOCATÁRIA; c) entregar à LOCATÁRIA os documentos necessários ao cadastro dos veículos no RNTRC e à circulação.']],
      ['Da manutenção e conservação', [
        'Cabem à LOCATÁRIA a manutenção preventiva decorrente da utilização regular (troca de óleo, filtros, lubrificantes e itens de revisão periódica) e a reposição dos itens de desgaste pelo uso: pneus, lonas e pastilhas de freio, embreagem, bateria, lâmpadas e palhetas.',
        'Cabem à LOCADORA os reparos de motor, caixa de câmbio, diferencial, chassi e estrutura, salvo quando decorrentes de mau uso, negligência, imperícia, acidente ou descumprimento das recomendações técnicas, que serão de responsabilidade da LOCATÁRIA.',
        'A LOCATÁRIA comunicará previamente à LOCADORA a necessidade de reparos relevantes, salvo emergências necessárias à segurança ou à preservação do patrimônio, e manterá registro das manutenções realizadas, com os comprovantes.',
        'É vedada a realização de intervenções que alterem as características originais dos veículos sem autorização da LOCADORA.']],
      ['Das multas, infrações e responsabilidades', [
        'A LOCATÁRIA responderá pelas multas de trânsito, penalidades administrativas e despesas decorrentes de infrações praticadas durante a posse e utilização dos veículos, desde que relacionadas a atos ou omissões que lhe sejam imputáveis.',
        'A LOCATÁRIA indicará o condutor responsável pela infração no prazo previsto no art. 257 do Código de Trânsito Brasileiro, contado da notificação recebida da LOCADORA.',
        'Caso a LOCADORA suporte pagamentos ou despesas de responsabilidade da LOCATÁRIA, terá direito ao ressarcimento, mediante apresentação dos comprovantes.',
        'A LOCATÁRIA responderá pelos danos comprovadamente causados aos veículos e a terceiros em razão de sua atuação, de seus empregados, prepostos ou contratados, assegurado à LOCADORA o direito de regresso quando responsabilizada por conduta imputável à LOCATÁRIA.']],
      ['Dos seguros e sinistros', [
        'A LOCATÁRIA manterá, durante toda a vigência, seguro dos veículos com coberturas compatíveis com os riscos da operação, incluindo colisão, incêndio, roubo, furto e responsabilidade civil perante terceiros, com a identificação dos veículos, a indicação do uso comercial para transporte de cargas e a <b>LOCADORA como beneficiária</b> da indenização por danos aos veículos.',
        'Os seguros obrigatórios do transportador (RCTR-C, RC-DC e RC-V), previstos no art. 13 da Lei nº 11.442/2007, são de responsabilidade da LOCATÁRIA e independem do seguro dos veículos.',
        'A LOCATÁRIA apresentará cópia das apólices e comprovantes de sua regularidade antes do início da utilização dos veículos e sempre que solicitada.',
        'Em caso de sinistro, a LOCATÁRIA comunicará imediatamente a ocorrência à LOCADORA, à seguradora e às autoridades competentes, e responderá pelas franquias e pelos prejuízos não cobertos quando decorrentes de fatos que lhe sejam imputáveis.',
        'Em caso de perda total, as partes observarão a indenização securitária efetivamente recebida, assegurado à LOCADORA o ressarcimento de prejuízos adicionais comprovados e imputáveis à LOCATÁRIA, vedado o recebimento em duplicidade pelo mesmo dano.']],
      ['Da responsabilidade trabalhista e operacional', [
        'A LOCATÁRIA é exclusivamente responsável pela contratação, remuneração, direção e fiscalização de seus motoristas, ajudantes e demais profissionais envolvidos na operação, não havendo vínculo empregatício entre eles e a LOCADORA.',
        'Eventuais responsabilidades impostas à LOCADORA por determinação legal ou judicial não afastarão o direito de regresso contra a LOCATÁRIA quando decorrentes de obrigações a ela atribuídas.']],
      ['Dos tributos', [
        'Cada parte responde pelos tributos incidentes sobre sua atividade. A LOCADORA emitirá mensalmente o documento de cobrança do aluguel exigido pela legislação vigente, destacando o IBS e a CBS a partir de sua incidência sobre a locação de bens móveis (Lei Complementar nº 214/2025).']],
      ...(x.d.rj_processo || /RECUPERA/i.test(x.e.razao || '') ? [['Da recuperação judicial da LOCADORA', [
        `A LOCADORA encontra-se em recuperação judicial (processo nº ${v(x.d.rj_processo)}). As partes declaram que a locação não importa alienação nem oneração dos veículos, que permanecem de propriedade da LOCADORA e não poderão ser dados em garantia nem responder por obrigações da LOCATÁRIA.`,
        'A LOCADORA dará ciência deste contrato ao administrador judicial antes do início da locação.']]] : []),
      ['Da rescisão', [
        'O contrato poderá ser rescindido por qualquer das partes mediante comunicação escrita com antecedência mínima de 30 (trinta) dias, ressalvadas as hipóteses de rescisão imediata por justa causa.',
        'A LOCADORA poderá rescindir antecipadamente o contrato, mediante notificação, nas hipóteses de: a) inadimplemento contratual relevante; b) utilização dos veículos em finalidade diversa da contratada; c) sublocação ou cessão não autorizada; d) ausência de seguro obrigatório ou contratualmente exigido; e) uso dos veículos em condições que comprometam gravemente sua integridade ou segurança; f) descumprimento reiterado das obrigações de manutenção; g) prática de atividades ilícitas envolvendo os veículos.',
        'Encerrado o contrato, a LOCATÁRIA devolverá os veículos em até 48 (quarenta e oito) horas, no local indicado pela LOCADORA, mediante vistoria, com os CIOTs e MDF-e das viagens encerrados e os veículos excluídos de sua frota no RNTRC.',
        'A retenção injustificada dos veículos após o prazo de devolução sujeitará a LOCATÁRIA ao pagamento de indenização diária equivalente ao dobro do aluguel diário proporcional de cada veículo, sem prejuízo de perdas e danos comprovados.',
        'A rescisão não prejudicará a exigibilidade de obrigações vencidas nem as responsabilidades decorrentes de fatos ocorridos durante a vigência.']],
      ['Da independência contratual', [
        'A presente locação constitui relação jurídica autônoma em relação a eventual contrato de prestação de serviços de transporte firmado entre as partes.',
        'A contratação de fretes pela LOCADORA não implica cessão gratuita dos veículos, compensação automática de valores ou alteração das condições da locação, e o encerramento de um dos contratos não extingue automaticamente o outro.']],
      ['Da confidencialidade e da proteção de dados', ['As partes preservarão o sigilo das informações comerciais, operacionais, financeiras e estratégicas a que tiverem acesso em razão deste contrato.', ...clLGPD()]],
      ['Das disposições gerais', [
        'Qualquer alteração deste contrato dependerá de termo aditivo escrito e assinado pelas partes. A tolerância quanto ao descumprimento de obrigações não constituirá renúncia de direitos nem novação.',
        'Para o cadastro no RNTRC, este contrato será assinado com firma reconhecida ou com certificado digital ICP-Brasil (Medida Provisória nº 2.200-2/2001). Os termos aditivos e os termos de vistoria poderão ser assinados pela plataforma gov.br.',
        'Integram este contrato o Anexo I (Relação dos Veículos e Valores) e o Anexo II (Termo de Entrega e Vistoria).',
        `Fica eleito o foro da comarca de ${v(x.d.foro)} para dirimir as controvérsias decorrentes deste instrumento, com renúncia a qualquer outro, por mais privilegiado que seja.`]],
    ],
  },
  transporte_etc: {
    titulo: 'Contrato de prestação de serviços de transporte rodoviário de cargas', tipos: [], anexoFretes: true,
    campos: ['rntrc', 'fretes', 'rj_processo', 'foro', 'testemunhas'],
    papeis: (x) => PAPEIS(x, 'CONTRATANTE', 'CONTRATADA'),
    clausulas: (x) => [
      ['Do objeto', [
        `O presente contrato tem por objeto a prestação, pela CONTRATADA, empresa de transporte rodoviário de cargas inscrita no RNTRC sob o nº ${v(x.d.rntrc)}, de serviços de transporte rodoviário de cargas por conta de terceiros e mediante remuneração, nos termos da Lei nº 11.442/2007, das mercadorias de interesse da CONTRATANTE.`,
        'Os serviços compreendem a coleta, o transporte e a entrega das mercadorias nos destinos indicados pela CONTRATANTE, conforme as características de cada operação.',
        'Os transportes poderão ser realizados com veículos próprios, locados ou legitimamente disponibilizados à CONTRATADA, inclusive os objeto de contrato de locação firmado com a CONTRATANTE, desde que constem da frota da CONTRATADA no RNTRC.',
        'A CONTRATADA executará os serviços com autonomia técnica, administrativa e operacional, responsabilizando-se pelos meios necessários à adequada execução do transporte.',
        'O presente contrato não estabelece exclusividade nem obrigação de contratação de quantidade mínima de fretes.']],
      ['Da solicitação e execução dos fretes', [
        'Cada frete será solicitado pela CONTRATANTE por ordem de transporte registrada em sua plataforma de gestão, por e-mail ou por outro meio escrito, contendo, sempre que aplicável: a) identificação da carga e das notas fiscais; b) local de coleta e destino; c) data ou período de execução; d) quantidade, peso e características das mercadorias; e) condições especiais de transporte; f) valor do frete; g) responsabilidade pela carga e descarga.',
        'A CONTRATADA confirmará o aceite de cada solicitação antes do início da operação e comunicará à CONTRATANTE as alterações relevantes de rota, prazo, veículo ou condições de transporte.']],
      ['Dos documentos e do registro da operação', [
        'A CONTRATADA registrará o Código Identificador da Operação de Transporte (CIOT) antes do início de cada viagem, nos termos da Resolução ANTT nº 6.078/2026, e o informará no Manifesto Eletrônico de Documentos Fiscais (MDF-e) e à CONTRATANTE.',
        'A CONTRATADA emitirá o Conhecimento de Transporte Eletrônico (CT-e), tendo a CONTRATANTE como tomadora do serviço, e o MDF-e da viagem, e encerrará o CIOT e o MDF-e após a entrega.',
        'A CONTRATADA responde pelas penalidades decorrentes da falta, do erro ou da não vinculação do CIOT ao MDF-e, salvo quando causadas por informação incorreta fornecida pela CONTRATANTE.']],
      ['Do valor dos fretes e das condições de pagamento', [
        'O valor de cada frete será o da Tabela de Fretes (Anexo I) para a rota, ou o previamente negociado e registrado na ordem de transporte, considerando distância, peso, volume, destino e demais condições da operação.',
        'O valor do frete de carga lotação não será inferior ao piso mínimo fixado pela ANTT vigente na data da contratação (Lei nº 13.703/2018). Publicada nova tabela da ANTT, os valores do Anexo I serão ajustados ao piso na mesma data.',
        'Por se tratar de carga geral, sem frota dedicada por razões sanitárias ou de certificação, não é devido pagamento de retorno vazio, salvo ajuste escrito entre as partes.',
        'Não haverá valor fixo mensal; é devida remuneração exclusivamente pelos fretes efetivamente contratados e executados, ressalvadas as hipóteses legais de pagamento ou indenização.',
        'O pagamento será realizado em até 5 (cinco) dias após a conclusão do transporte, a apresentação do CT-e e a comprovação da entrega, exclusivamente em conta de titularidade da CONTRATADA.',
        'Os custos operacionais ordinários são da CONTRATADA. Despesas extraordinárias somente serão reembolsadas quando previamente autorizadas ou legalmente devidas.',
        'Os valores decorrentes de eventual locação de veículos entre as partes constituem obrigações independentes e não serão compensados com os créditos de frete sem autorização expressa e escrita das partes.']],
      ['Do vale-pedágio', [
        'A CONTRATANTE antecipará o vale-pedágio obrigatório por meio de fornecedora habilitada pela ANTT, em valor separado do frete, nos termos da Lei nº 10.209/2001, e a CONTRATADA registrará o número do vale-pedágio no documento da viagem.']],
      ['Da carga, da descarga e da estadia', [
        'A responsabilidade pela carga e pela descarga será indicada em cada ordem de transporte. O prazo para carga e descarga é o previsto no art. 11 da Lei nº 11.442/2007; ultrapassado o prazo por motivo não imputável à CONTRATADA, será devida a indenização por estadia prevista na mesma lei.']],
      ['Das obrigações da CONTRATADA', [
        'São obrigações da CONTRATADA: a) executar os serviços com diligência, segurança e observância dos prazos; b) manter regularidade cadastral, fiscal e operacional, inclusive o RNTRC ativo, com responsável técnico e com os veículos utilizados em sua frota; c) disponibilizar motoristas habilitados e qualificados, observadas a jornada e os tempos de descanso da Lei nº 13.103/2015; d) utilizar veículos adequados às características, peso e volume das cargas, em condições regulares de funcionamento e segurança; e) adotar as medidas necessárias à preservação das mercadorias; f) comunicar imediatamente atrasos relevantes, acidentes, avarias, extravios, roubos ou furtos; g) emitir e apresentar os documentos fiscais e de transporte exigidos; h) responder pelos atos de seus empregados, prepostos e subcontratados; i) comprovar a entrega das mercadorias por documentação idônea, inclusive o canhoto da nota fiscal assinado; j) não utilizar as mercadorias para finalidade diversa da execução contratual.']],
      ['Das obrigações da CONTRATANTE', [
        'São obrigações da CONTRATANTE: a) fornecer as informações necessárias à execução dos transportes; b) disponibilizar as mercadorias para coleta nas condições acordadas, com as notas fiscais emitidas; c) informar as características especiais das cargas e as exigências de acondicionamento e manuseio; d) pagar os fretes executados e comprovados nos prazos ajustados; e) comunicar alterações relevantes das solicitações; f) cumprir as obrigações legais do contratante do transporte, inclusive quanto ao vale-pedágio obrigatório e ao piso mínimo do frete.']],
      ['Da responsabilidade pelas mercadorias', [
        'A CONTRATADA é responsável pela guarda, conservação e integridade das mercadorias desde o recebimento até a entrega ao destinatário, e responde por perdas, extravios, avarias e danos que lhe sejam imputáveis, nos limites e prazos da Lei nº 11.442/2007.',
        'Na hipótese de sinistro, a CONTRATADA adotará as providências necessárias à preservação da carga, à comunicação às autoridades e seguradoras e à redução dos prejuízos. A apuração observará os documentos fiscais e as circunstâncias comprovadas, vedado o enriquecimento sem causa.',
        'A CONTRATADA não responderá por prejuízos decorrentes exclusivamente de informações incorretas fornecidas pela CONTRATANTE, de vício próprio da mercadoria ou de outras excludentes legais, desde que comprovadas.']],
      ['Dos seguros', [
        'A CONTRATADA manterá, durante a vigência, os seguros obrigatórios do transportador vinculados ao seu RNTRC, nos termos do art. 13 da Lei nº 11.442/2007, com a redação da Lei nº 14.599/2023: a) RCTR-C, de responsabilidade civil por danos à carga em acidente; b) RC-DC, de desaparecimento da carga; c) RC-V, de danos a terceiros causados pelo veículo.',
        'As coberturas terão limites compatíveis com o valor das cargas transportadas, e cada viagem será averbada. Cópia das apólices será entregue à CONTRATANTE antes do primeiro transporte e a cada renovação.',
        'A CONTRATADA observará os procedimentos de gerenciamento de riscos exigidos pelas seguradoras. A existência de seguro não afasta as responsabilidades da CONTRATADA, observada a vedação de dupla indenização.']],
      ['Da subcontratação', [
        'A CONTRATADA não transferirá a execução dos serviços a terceiros sem autorização prévia e escrita da CONTRATANTE.',
        'Autorizada a subcontratação de Transportador Autônomo de Cargas, a CONTRATADA gerará o CIOT por Instituição de Pagamento Eletrônico de Frete habilitada pela ANTT, respeitará o piso mínimo do frete, pagará o frete na conta indicada pelo autônomo e não descontará seguro ou taxas administrativas do valor do frete, permanecendo responsável perante a CONTRATANTE.']],
      ['Da responsabilidade trabalhista e tributária', [
        'A CONTRATADA é responsável pela contratação, remuneração e direção de seus empregados, motoristas, ajudantes e demais profissionais, não havendo vínculo empregatício entre eles e a CONTRATANTE, e responde pelos encargos trabalhistas, previdenciários, fiscais e tributários de sua atividade.',
        'A CONTRATADA informará à CONTRATANTE o seu regime de apuração do IBS e da CBS e comunicará qualquer mudança com antecedência mínima de 30 (trinta) dias, destacando os tributos no CT-e conforme a legislação (Lei Complementar nº 214/2025).',
        'Caso a CONTRATANTE suporte prejuízos decorrentes do descumprimento de obrigações da CONTRATADA, fica assegurado o direito de regresso.']],
      ['Dos danos e das penalidades', [
        'O descumprimento injustificado de obrigações sujeitará a parte inadimplente às consequências previstas neste instrumento e na legislação. A CONTRATADA responderá pelos prejuízos diretos, efetivos e comprovados causados à CONTRATANTE por inadimplemento que lhe seja imputável, observados a gravidade, o nexo causal e os limites legais.']],
      ['Da vigência e da rescisão', [
        x.c.inicio && x.c.fim ? `O presente contrato vigora de ${dataBR(x.c.inicio)} a ${dataBR(x.c.fim)}, podendo ser prorrogado mediante acordo escrito.` : 'O presente contrato terá vigência de 12 (doze) meses, contados da data de sua assinatura, podendo ser prorrogado mediante acordo escrito.',
        'Qualquer das partes poderá rescindir o contrato mediante comunicação escrita com antecedência mínima de 30 (trinta) dias, observados os serviços em andamento.',
        'A CONTRATANTE poderá rescindir antecipadamente o contrato, mediante notificação, nas hipóteses de: a) descumprimento contratual relevante; b) atrasos reiterados e injustificados; c) irregularidade cadastral ou operacional que impeça a execução legal dos transportes, inclusive no RNTRC; d) ausência dos seguros obrigatórios; e) falhas graves que comprometam a integridade das mercadorias ou a segurança da operação; f) transferência não autorizada da execução dos serviços; g) prática de atos ilícitos relacionados ao contrato.',
        'A rescisão não afasta a obrigação de concluir os transportes já iniciados, salvo determinação legal, risco à segurança ou acordo entre as partes, nem a exigibilidade dos valores e responsabilidades anteriores.']],
      ['Da autonomia e da independência contratual', [
        'O presente instrumento não estabelece sociedade, associação, representação comercial, mandato, vínculo empregatício ou subordinação entre as partes.',
        'A eventual utilização de veículos locados da CONTRATANTE não modifica a natureza jurídica da prestação dos serviços nem afasta as obrigações operacionais da CONTRATADA, e a relação de transporte permanece juridicamente distinta do contrato de locação de veículos.']],
      ...(x.d.rj_processo || /RECUPERA/i.test(x.e.razao || '') ? [['Da recuperação judicial da CONTRATANTE', [
        `A CONTRATANTE encontra-se em recuperação judicial (processo nº ${v(x.d.rj_processo)}) e dará ciência deste contrato ao administrador judicial. Os créditos da CONTRATADA por serviços prestados após o pedido de recuperação judicial observam o art. 67 da Lei nº 11.101/2005.`]]] : []),
      ['Da confidencialidade e da proteção de dados', ['A CONTRATADA manterá sigilo sobre informações comerciais, operacionais, financeiras, rotas, clientes e demais dados estratégicos da CONTRATANTE.', ...clLGPD()]],
      ['Das disposições gerais', [
        'Qualquer alteração deste contrato será formalizada por escrito. A tolerância quanto ao descumprimento de obrigações não constituirá renúncia de direitos nem novação.',
        'As partes reconhecem a validade da assinatura eletrônica deste instrumento pela plataforma gov.br ou com certificado digital ICP-Brasil (Medida Provisória nº 2.200-2/2001).',
        'Integram este contrato o Anexo I (Tabela de Fretes) e as ordens de transporte aceitas, quanto às condições específicas de cada operação.',
        `Fica eleito o foro da comarca de ${v(x.d.foro)} para dirimir as controvérsias decorrentes deste contrato, com renúncia a qualquer outro, por mais privilegiado que seja.`]],
    ],
  },
  vistoria: {
    titulo: 'Termo de vistoria de veículo', termo: true, vistoria: true, tipos: [], campos: ['veiculo', 'vistoria'],
    papeis: () => ({ nos: 'PRIMEIRA PARTE', eles: 'SEGUNDA PARTE' }),
    clausulas: () => [],
  },
};
export const MODELO_PADRAO = (tipo) => Object.entries(MODELOS).find(([, m]) => m.tipos.includes(tipo))?.[0] || 'servico';

/** campos próprios de cada modelo, para o formulário */
export const CAMPOS = {
  veiculo: { t: 'Veículo', sub: [['marca_modelo', 'Marca e modelo'], ['placa', 'Placa'], ['ano', 'Ano'], ['cor', 'Cor'], ['renavam', 'RENAVAM']] },
  motorista: { t: 'Motorista (nome e CNH)' }, rota: { t: 'Rota ou região' }, uso: { t: 'Uso do veículo', ph: 'ex.: entregas na Região Metropolitana do Recife' },
  combustivel: { t: 'Combustível por conta de', ph: 'ex.: da CONTRATANTE' }, seguro: { t: 'Seguro por conta de', ph: 'ex.: da CONTRATADA' },
  forma_pagamento: { t: 'Forma de pagamento', ph: 'ex.: PIX para a chave CNPJ da CONTRATADA' }, foro: { t: 'Foro (cidade/UF)' },
  escopo: { t: 'Escopo detalhado' }, local: { t: 'Local da prestação' }, rntrc: { t: 'RNTRC do transportador' },
  finalidade: { t: 'Finalidade da troca de informações' }, prazo_sigilo: { t: 'Sigilo após o fim (anos)', num: true },
  cnh: { t: 'CNH do colaborador', sub: [['numero', 'Número'], ['categoria', 'Categoria']] },
  uso_externo: { t: 'Autorizar também uso em material institucional e redes sociais', bool: true },
  testemunhas: { t: 'Testemunhas', sub: [['t1_nome', 'Testemunha 1 — nome'], ['t1_cpf', 'CPF'], ['t2_nome', 'Testemunha 2 — nome'], ['t2_cpf', 'CPF']] },
  veiculos: { t: 'Veículos (Anexo I) — um por linha: placa;marca/modelo;ano;cor;RENAVAM;chassi;eixos;valor mensal', area: true, ph: 'PEL9I69;FORD CARGO 1317 E TG;2011/2012;BRANCA;00000000000;9BFXXXXXXXXXXXXXX;2;3500,00' },
  fretes: { t: 'Tabela de fretes (Anexo I) — uma rota por linha: origem;destino;km;eixos;piso ANTT;frete', area: true, ph: 'Caruaru/PE;Recife/PE;140;2;1022,17;1200,00' },
  rj_processo: { t: 'Processo da recuperação judicial (se houver)', ph: 'nº do processo e vara' },
  vistoria: { t: 'Vistoria', sub: [['momento', 'Entrega ou devolução'], ['data', 'Data (dd/mm/aaaa)'], ['km', 'Quilometragem'], ['combustivel', 'Nível de combustível'], ['avarias', 'Avarias observadas']] },
};

/** o que está faltando para a minuta sair completa */
export function faltas(id, x) {
  const m = MODELOS[id], f = [];
  if (!x.e.cnpj) f.push('CNPJ da empresa (Empresa e Usuários)');
  if (!x.e.endereco) f.push('endereço da empresa (Cadastros › Empresa › Unidades)');
  if (!x.e.rep_nome) f.push('representante legal da empresa (Empresa e Usuários)');
  if (!x.p.nome) f.push('nome da outra parte');
  if (!m.termo && !String(x.p.doc || '').replace(/\D/g, '')) f.push('CPF/CNPJ da outra parte');
  if (!m.termo && !x.p.endereco) f.push('endereço da outra parte (cadastro do beneficiário)');
  if (m.campos.includes('veiculo') && !x.d.veiculo?.placa) f.push('placa do veículo');
  if (m.campos.includes('rntrc') && !x.d.rntrc) f.push('RNTRC');
  if (m.campos.includes('foro') && !x.d.foro) f.push('foro');
  if (m.anexoVeiculos && !linhas(x.d.veiculos).length) f.push('veículos do Anexo I');
  if (m.anexoVeiculos && linhas(x.d.veiculos).some(l => !l[4] || !l[5])) f.push('RENAVAM e chassi de todos os veículos');
  if (m.anexoFretes && !linhas(x.d.fretes).length) f.push('tabela de fretes do Anexo I');
  if (/RECUPERA/i.test(x.e.razao || '') && m.campos.includes('rj_processo') && !x.d.rj_processo) f.push('processo da recuperação judicial');
  return f;
}

// ---------------------------------------------------------------- anexos (linhas separadas por ;)
export const linhas = (t) => String(t || '').split(/\n+/).map(l => l.split(';').map(c => c.trim())).filter(l => l[0]);
const num = (t) => +String(t || '').replace(/\./g, '').replace(',', '.') || 0;
export function anexosHTML(m, x) {
  const out = [];
  if (m.anexoVeiculos) {
    const ls = linhas(x.d.veiculos), tot = ls.reduce((a, l) => a + num(l[7]), 0);
    out.push(`<h2 class="anx">Anexo I — Relação dos veículos e valores</h2><table class="vis"><thead><tr><th>Nº</th><th>Placa</th><th>Marca/modelo</th><th>Ano</th><th>Cor</th><th>RENAVAM</th><th>Chassi</th><th>Eixos</th><th>Valor mensal</th></tr></thead><tbody>${
      (ls.length ? ls : [[]]).map((l, i) => `<tr><td>${i + 1}</td>${[0, 1, 2, 3, 4, 5, 6].map(k => `<td>${l[k] ? esc(k === 0 ? l[k].toUpperCase() : l[k]) : LACUNA}</td>`).join('')}<td>${l[7] ? moeda(num(l[7])) : LACUNA}</td></tr>`).join('')}
      <tr><td colspan="8"><b>Total mensal</b></td><td><b>${tot ? moeda(tot) : LACUNA}</b></td></tr></tbody></table>
      <p>Os veículos estão registrados em nome da LOCADORA, na categoria “aluguel”, e serão incluídos na frota da LOCATÁRIA no RNTRC antes do primeiro transporte.</p>
      <h2 class="anx">Anexo II — Termo de entrega e vistoria</h2><p>Um termo por veículo, no modelo “Termo de vistoria de veículo” da plataforma, assinado pelas partes na entrega e na devolução.</p>`);
  }
  if (m.anexoFretes) {
    const ls = linhas(x.d.fretes);
    out.push(`<h2 class="anx">Anexo I — Tabela de fretes</h2><table class="vis"><thead><tr><th>Nº</th><th>Origem</th><th>Destino</th><th>km</th><th>Eixos</th><th>Piso ANTT</th><th>Frete</th></tr></thead><tbody>${
      (ls.length ? ls : [[]]).map((l, i) => `<tr><td>${i + 1}</td>${[0, 1, 2, 3].map(k => `<td>${l[k] ? esc(l[k]) : LACUNA}</td>`).join('')}<td>${l[4] ? moeda(num(l[4])) : LACUNA}</td><td>${l[5] ? moeda(num(l[5])) : LACUNA}</td></tr>`).join('')}</tbody></table>
      <p>Carga geral, lotação, Tabela A da ANTT. O frete nunca é inferior ao piso vigente; o piso acompanha a tabela da ANTT em vigor na data de cada frete.</p>`);
  }
  return out.length ? `<div class="anexos">${out.join('')}</div>` : '';
}

// ---------------------------------------------------------------- documento
function vistoriaHTML(x) {
  const vi = x.d.vistoria || {};
  const itens = ['Lataria e pintura', 'Para-choques e retrovisores', 'Vidros e para-brisa', 'Faróis, lanternas e setas', 'Pneus (estado e calibragem)', 'Estepe, macaco e chave de roda',
    'Triângulo e extintor (quando obrigatório)', 'Bancos, painel e cintos', 'Tacógrafo (veículos de carga)', 'Documentos (CRLV)', 'Limpeza interna e externa'];
  return `<p><b>Veículo:</b> ${veiculo(x.d).replace(/^o veículo /, '')}</p>
    <p><b>${esc(vi.momento || 'Entrega / devolução')}</b> em ${v(vi.data)} · <b>Quilometragem:</b> ${v(vi.km)} · <b>Combustível:</b> ${v(vi.combustivel)}</p>
    <table class="vis"><thead><tr><th>Item</th><th>Bom</th><th>Regular</th><th>Ruim</th><th>Observação</th></tr></thead><tbody>
    ${itens.map(i => `<tr><td>${i}</td><td></td><td></td><td></td><td></td></tr>`).join('')}</tbody></table>
    <p><b>Avarias observadas:</b> ${vi.avarias ? esc(vi.avarias) : '<br><br><br>'}</p>
    <p>As partes conferiram o veículo e concordam com o estado registrado neste termo. Fotos do veículo, quando tiradas, integram este termo.</p>`;
}

/** HTML completo (A4) da minuta */
export function documento(id, x, { data = new Date().toISOString().slice(0, 10) } = {}) {
  const m = MODELOS[id]; if (!m) throw new Error('Modelo desconhecido');
  const pap = m.papeis(x);
  const P = { loc: (s) => s };
  const qual = id === 'confidencialidade'
    ? `${qualEmpresa(x.e, 'PARTE')}; e ${qualParte(x.p, 'PARTE')}; em conjunto denominadas <b>PARTES</b>`
    : `${qualEmpresa(x.e, pap.nos)}; e ${qualParte(x.p, pap.eles)}`;
  const cls = m.clausulas(x, P).filter(([, ps]) => ps && ps.length);
  const corpo = m.vistoria ? vistoriaHTML(x) : cls.map(([t, ps], i) => `<h3>Cláusula ${i + 1}ª — ${t}</h3>${ps.map((p, j) => `<p>${ps.length > 1 ? `<b>${i + 1}.${j + 1}.</b> ` : ''}${p}</p>`).join('')}`).join('');
  const intro = m.vistoria ? `<p>Entre ${qual}, foi feita a vistoria do veículo abaixo.</p>`
    : m.termo ? `<p>Pelo presente termo, ${qual}, declaram e ajustam o que segue.</p>`
    : `<p>Pelo presente instrumento particular, ${qual}, têm entre si justo e contratado o que segue.</p>`;
  const nosNome = x.e.razao, elesNome = x.p.nome || '';
  const t = x.d.testemunhas || {};
  const ass = (nome, papel, doc) => `<div class="ass"><div class="linha"></div><b>${esc(nome) || '&nbsp;'}</b><br>${papel}${doc ? `<br>${esc(doc)}` : ''}</div>`;
  const assinaturas = `<div class="asss">${ass(nosNome, pap.nos.split(' ')[0] === 'PARTE' ? 'PARTE' : pap.nos, x.e.rep_nome ? `por ${x.e.rep_nome}` : '')}${ass(elesNome, pap.eles.split(' ')[0] === 'PARTE' ? 'PARTE' : pap.eles, docFmt(x.p.doc))}</div>
    ${!m.termo || m.campos.includes('testemunhas') ? `<div class="asss">${ass(t.t1_nome, 'Testemunha 1', t.t1_cpf ? 'CPF ' + docFmt(t.t1_cpf) : 'CPF')}${ass(t.t2_nome, 'Testemunha 2', t.t2_cpf ? 'CPF ' + docFmt(t.t2_cpf) : 'CPF')}</div>` : ''}`;
  const local = `${x.e.municipio || '____________'}, ${dataExtenso(data)}.`;
  const numero = x.c.numero ? `Contrato nº ${x.c.numero}` : '';
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(m.titulo)}${numero ? ' — ' + numero : ''}</title><style>
    @page{size:A4;margin:22mm 22mm 20mm}
    *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{margin:0;font-family:'Times New Roman',Times,serif;font-size:11.5pt;line-height:1.45;color:#111}
    .cab{display:flex;justify-content:space-between;align-items:center;gap:16px}
    .cab img{max-height:16mm;max-width:50mm}
    .cab .r{text-align:right;font-size:8pt;line-height:1.35;color:#333;max-width:95mm}
    .fil{height:2px;background:linear-gradient(90deg,#1590d6,${x.cor} 45%,#2a1f6f);margin:4mm 0 8mm}
    h1{font-size:13.5pt;text-align:center;text-transform:uppercase;margin:0 0 2mm;letter-spacing:.3px}
    .num{text-align:center;font-size:9.5pt;color:#444;margin-bottom:6mm}
    h3{font-size:11.5pt;margin:5mm 0 1.5mm;text-transform:uppercase}
    p{margin:0 0 2.2mm;text-align:justify}
    .lac{color:#999}
    .local{margin-top:7mm;text-align:right}
    .asss{display:flex;gap:14mm;margin-top:14mm;break-inside:avoid}
    .ass{flex:1;text-align:center;font-size:10pt;line-height:1.35}
    .linha{border-top:1px solid #111;margin-bottom:2mm}
    table.vis{width:100%;border-collapse:collapse;margin:3mm 0;font-size:10pt}
    table.vis th,table.vis td{border:1px solid #999;padding:1.6mm 2mm;text-align:left}
    table.vis td:nth-child(n+2):nth-child(-n+4),table.vis th:nth-child(n+2):nth-child(-n+4){width:14mm;text-align:center}
    .fecho{break-inside:avoid}
    .anexos{break-before:page} h2.anx{font-size:12pt;text-transform:uppercase;margin:6mm 0 2mm} .anexos table.vis{font-size:8.5pt}
    .ajuda{font-family:Arial,sans-serif;font-size:11px;background:#fff8d6;border:1px solid #e8d48a;padding:8px 10px;margin-bottom:10px}
    @media print{.ajuda{display:none}}
  </style></head><body>
  <div class="ajuda">Para gerar o PDF: escolha <b>Salvar como PDF</b> na impressão. Depois assine em assinador.iti.br (gov.br) e anexe o arquivo assinado na ficha do contrato.</div>
  <div class="cab">${x.logo ? `<img src="${x.logo}" alt="">` : '<span></span>'}<div class="r"><b>${esc(x.e.razao)}</b><br>CNPJ ${esc(docFmt(x.e.cnpj))}${x.e.endereco ? `<br>${esc(x.e.endereco)}` : ''}${x.e.telefone ? `<br>${esc(x.e.telefone)}${x.e.site ? ' · ' + esc(x.e.site) : ''}` : ''}</div></div>
  <div class="fil"></div>
  <h1>${esc(m.titulo)}</h1>${numero ? `<div class="num">${numero}</div>` : ''}
  ${intro}${corpo}
  ${m.vistoria ? '' : m.termo ? '<p>E, por estarem de acordo, as partes assinam este termo, em formato eletrônico ou em 2 (duas) vias de igual teor.</p>' : '<p>E, por estarem assim justas e contratadas, as partes assinam este instrumento, em formato eletrônico ou em 2 (duas) vias de igual teor, na presença das testemunhas abaixo.</p>'}
  <div class="fecho"><p class="local">${local}</p>${assinaturas}</div>
  ${anexosHTML(m, x)}
  </body></html>`;
}
