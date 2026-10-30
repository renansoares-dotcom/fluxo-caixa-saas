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
  return `<b>${esc(e.razao)}</b>, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${esc(docFmt(e.cnpj)) || LACUNA}, com sede em ${esc(e.endereco) || LACUNA}, neste ato representada por ${esc(e.rep_nome) || LACUNA}, CPF nº ${esc(docFmt(e.rep_cpf)) || LACUNA}, doravante denominada <b>${papel}</b>`;
}
/** qualificação da outra parte (PF ou PJ pelo tamanho do documento) */
function qualParte(p, papel) {
  const doc = String(p.doc || '').replace(/\D/g, '');
  if (doc.length === 14) return `<b>${esc(p.nome)}</b>, pessoa jurídica de direito privado, inscrita no CNPJ sob o nº ${esc(docFmt(doc))}, com sede em ${esc(p.endereco) || LACUNA}, neste ato representada por ${esc(p.rep_nome) || LACUNA}, doravante denominada <b>${papel}</b>`;
  return `<b>${esc(p.nome)}</b>, inscrito(a) no CPF sob o nº ${doc ? esc(docFmt(doc)) : LACUNA}${p.rg ? `, RG nº ${esc(p.rg)}` : ''}, residente e domiciliado(a) em ${esc(p.endereco) || LACUNA}, doravante denominado(a) <b>${papel}</b>`;
}

/**
 * contexto do modelo a partir do que a tela já tem:
 *  empresa (empresas), ident (empresa_identidade), contrato, parte {nome, doc, endereco, …} e dados (campos do modelo)
 */
export function contexto({ empresa = {}, ident = {}, contrato = {}, parte = {}, logo = null }) {
  const un = (ident.unidades || [])[0] || {};
  const e = {
    razao: (ident.razao_documentos || empresa.razao_social || empresa.nome || '').replace(/\.$/, '') + '.',
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
  return f;
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
  </body></html>`;
}
