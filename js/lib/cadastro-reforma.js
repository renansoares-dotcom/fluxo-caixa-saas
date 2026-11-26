// Atualização cadastral da reforma tributária (COM010, SQL 198): definição dos campos do questionário, usada pela página
// pública (cadastro.html) e pela tela interna (comparar com o cadastro e aplicar). Sem acesso ao banco.

export const DESTINACOES = [['industrializacao', 'Industrialização (insumo da produção)'], ['revenda', 'Revenda (comércio)'], ['uso_consumo', 'Uso e consumo'], ['ativo', 'Ativo imobilizado']];
export const REGIMES = [['real', 'Lucro Real'], ['presumido', 'Lucro Presumido'], ['simples', 'Simples Nacional'], ['mei', 'MEI']];
export const CONTRIB = [['1', 'Sim, contribuinte do ICMS (tem inscrição estadual)'], ['2', 'Contribuinte isento de inscrição estadual'], ['9', 'Não contribuinte do ICMS']];
export const SIM_NAO = [['sim', 'Sim'], ['nao', 'Não'], ['nao_sei', 'Não sei']];
export const SIMPLES_REGULAR = [['sim', 'Sim, vamos optar pelo regime regular'], ['nao', 'Não, vamos continuar recolhendo tudo pelo Simples'], ['avaliando', 'Ainda estamos avaliando']];
export const TIPOS = [['industria', 'Indústria'], ['comercio', 'Comércio'], ['consumidor_contrib', 'Consumidor final contribuinte'], ['nao_contrib', 'Não contribuinte']];
export const REDUCOES = [['nenhuma', 'Nenhuma'], ['reducao_30', 'Redução de 30%'], ['reducao_60', 'Redução de 60%'], ['aliquota_zero', 'Alíquota zero'], ['regime_especifico', 'Regime específico'], ['nao_sei', 'Não sei']];

const rot = (L) => Object.fromEntries(L);
/** campos que podem ser aplicados: chave, rótulo, bloco, onde vai (fav = cadastro; pf = perfil fiscal), como mostrar */
export const CAMPOS = [
  ['nome_fantasia', 'Nome fantasia', 'Dados cadastrais', 'fav'], ['ie', 'Inscrição estadual', 'Dados cadastrais', 'fav'], ['im', 'Inscrição municipal', 'Dados cadastrais', 'fav'],
  ['cep', 'CEP', 'Dados cadastrais', 'fav'], ['logradouro', 'Logradouro', 'Dados cadastrais', 'fav'], ['numero', 'Número', 'Dados cadastrais', 'fav'],
  ['complemento', 'Complemento', 'Dados cadastrais', 'fav'], ['bairro', 'Bairro', 'Dados cadastrais', 'fav'], ['municipio', 'Município', 'Dados cadastrais', 'fav'],
  ['uf', 'UF', 'Dados cadastrais', 'fav'], ['email_nfe', 'E-mail para NF-e e XML', 'Dados cadastrais', 'fav'], ['telefone', 'Telefone', 'Dados cadastrais', 'fav'],
  ['contato_fiscal', 'Contato do fiscal', 'Dados cadastrais', 'pf'], ['contador', 'Escritório de contabilidade', 'Dados cadastrais', 'pf'],
  ['contribuinte_icms', 'Contribuinte do ICMS', 'Perfil de ICMS', 'fav'], ['tipo', 'Atividade', 'Perfil de ICMS', 'pf'], ['destinacao', 'Destino das compras', 'Perfil de ICMS', 'pf'],
  ['cnae', 'CNAE principal', 'Perfil de ICMS', 'pf'],
  ['regime', 'Regime tributário', 'Regime e créditos', 'fav'], ['cred_icms', 'Aproveita crédito de ICMS', 'Regime e créditos', 'pf'],
  ['cred_pc', 'Aproveita crédito de PIS/COFINS', 'Regime e créditos', 'pf'], ['simples_regular', 'Simples/MEI: IBS e CBS pelo regime regular', 'Regime e créditos', 'pf'],
  ['especiais', 'Situações especiais', 'Situações especiais', 'pf'],
].map(([chave, rotulo, bloco, destino]) => ({ chave, rotulo, bloco, destino }));

const pessoa = (o) => [o?.nome, o?.email, o?.telefone].filter(x => x && String(x).trim()).join(' · ');
const ESP = { beneficio_icms: 'Benefício de ICMS', reducao: 'Redução na reforma', zfm: 'Zona Franca/ALC', orgao_publico: 'Órgão público', produtor_rural: 'Produtor rural', imunidade: 'Imunidade/isenção', observacao: 'Observação' };
/** texto de um valor para comparar e mostrar */
export function texto(chave, v) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return '';
  switch (chave) {
    case 'contribuinte_icms': return rot(CONTRIB)[v] || String(v);
    case 'regime': return rot(REGIMES)[v] || String(v);
    case 'tipo': return rot(TIPOS)[v] || String(v);
    case 'destinacao': return (v || []).map(x => (rot(DESTINACOES)[x] || x).split(' (')[0]).join(', ');
    case 'cred_icms': case 'cred_pc': return rot(SIM_NAO)[v] || String(v);
    case 'simples_regular': return rot(SIMPLES_REGULAR)[v] || String(v);
    case 'contato_fiscal': case 'contador': return pessoa(v);
    case 'especiais': return Object.entries(v || {}).filter(([, x]) => x !== false && x !== '' && x != null && x !== 'nenhuma')
      .map(([k, x]) => (x === true ? ESP[k] || k : `${ESP[k] || k}: ${k === 'reducao' ? rot(REDUCOES)[x] || x : x}`)).join(' · ');
    case 'cep': return String(v).replace(/\D/g, '').replace(/^(\d{5})(\d{3})$/, '$1-$2');
    default: return String(v).trim();
  }
}
const norm = (chave, v) => texto(chave, v).toLowerCase().replace(/\s+/g, ' ').replace(chave === 'cep' || chave === 'telefone' ? /\D/g : /$^/, '');

/** valor atual (do cadastro e do perfil fiscal) no formato da resposta */
export function atualDoCadastro(f = {}, pf = {}) {
  const reg = { 'Simples Nacional': 'simples', MEI: 'mei', 'Lucro Presumido': 'presumido', 'Lucro Real': 'real' };
  return { nome_fantasia: f.nome_fantasia, ie: f.ie, im: f.im, cep: f.cep, logradouro: f.logradouro, numero: f.numero, complemento: f.complemento, bairro: f.bairro,
    municipio: f.municipio, uf: f.uf, email_nfe: f.email, telefone: f.telefone, contribuinte_icms: f.contribuinte_icms, regime: reg[f.regime_tributario] || pf?.regime || '',
    tipo: pf?.tipo, destinacao: pf?.destinacao || [], cnae: pf?.cnae || f.receita_dados?.cnae, cred_icms: pf?.cred_icms, cred_pc: pf?.cred_pc, simples_regular: pf?.simples_regular,
    especiais: pf?.especiais || {}, contato_fiscal: pf?.contato_fiscal || {}, contador: pf?.contador || {} };
}

/** linhas da comparação: { chave, rotulo, bloco, atual, novo, muda } — só o que o cliente respondeu */
export function comparar(resposta = {}, atual = {}) {
  return CAMPOS.filter(c => texto(c.chave, resposta[c.chave]) !== '')
    .map(c => ({ ...c, atual: texto(c.chave, atual[c.chave]), novo: texto(c.chave, resposta[c.chave]), muda: norm(c.chave, resposta[c.chave]) !== norm(c.chave, atual[c.chave]) }));
}

/** perfil fiscal para a Análise de Competitividade a partir do perfil do cliente (null se não houver o essencial) */
export function perfilParaCompetitividade(pf, f) {
  if (!pf) return null;
  const tipo = pf.tipo || (f?.contribuinte_icms === '9' ? 'nao_contrib' : null);
  const regime = pf.regime === 'mei' ? 'simples' : pf.regime;
  if (!tipo && !regime) return null;
  const o = {};
  if (f?.uf) o.uf = f.uf;
  if (tipo) o.tipo = tipo;
  if (regime) o.regime = regime;
  if (pf.cred_icms === 'sim' || pf.cred_icms === 'nao') o.cred_icms = pf.cred_icms === 'sim';
  if (pf.cred_pc === 'sim' || pf.cred_pc === 'nao') o.cred_pc = pf.cred_pc === 'sim';
  return o;
}

/** confere a resposta antes de enviar: lista de problemas (vazia = ok) */
export function conferir(d) {
  const P = [], email = (x) => !x || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(x).trim());
  if (!d.contribuinte_icms) P.push('Informe se a empresa é contribuinte do ICMS.');
  if (!d.regime) P.push('Informe o regime tributário.');
  if (!(d.destinacao || []).length) P.push('Marque para que a empresa usa o que compra de nós.');
  for (const [x, t] of [[d.email_nfe, 'e-mail para NF-e'], [d.declarante?.email, 'seu e-mail'], [d.contato_fiscal?.email, 'e-mail do contato fiscal'], [d.contador?.email, 'e-mail da contabilidade']])
    if (!email(x)) P.push(`Confira o ${t}.`);
  if (d.cep && String(d.cep).replace(/\D/g, '').length !== 8) P.push('O CEP tem 8 números.');
  if (!d.declarante?.nome || d.declarante.nome.trim().length < 3) P.push('Informe o seu nome.');
  if (!d.aceite) P.push('Marque a declaração de que as informações são verdadeiras.');
  return P;
}

/** tipo de atividade sugerido pela destinação (a mais forte define) */
export function tipoPelaDestinacao(dest = [], contrib) {
  if (contrib === '9') return 'nao_contrib';
  if (dest.includes('industrializacao')) return 'industria';
  if (dest.includes('revenda')) return 'comercio';
  if (dest.length) return 'consumidor_contrib';
  return '';
}
