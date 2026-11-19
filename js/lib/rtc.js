// Reforma Tributária — tabelas oficiais de classificação do IBS/CBS (SQL 171).
// A base vem do código aberto da Calculadora de Tributos da Receita Federal (github.com/ReceitaFederal/calculadora-rtc-regime-regular):
// CST, cClassTrib com vigência, redução de alíquota, crédito do adquirente e o vínculo NCM ↔ cClassTrib dos anexos da LC 214/2025.
// Aqui ficam só funções puras (sem banco), para a Conferência IBS/CBS e a emissão de NF-e usarem a mesma regra e os testes rodarem sem navegador.

const so = (s) => String(s ?? '').replace(/\D/g, '');
const dia = (d) => String(d || '').slice(0, 10);
const vale = (x, d) => dia(x.inicio) <= d && (!x.fim || d <= dia(x.fim));
const dBR = (d) => { const [a, m, x] = dia(d).split('-'); return `${x}/${m}/${a}`; };
const pct = (v) => String(+(+v).toFixed(2)).replace('.', ',') + '%';

export const MODELOS = { 55: 'NF-e', 65: 'NFC-e', 57: 'CT-e', 67: 'CT-e OS', 62: 'NFCom', 66: 'NF3-e', 63: 'BP-e', 91: 'NFS-e', 77: 'NF-e ABI', 96: 'Duimp' };

/** modelo do documento pela chave de acesso de 44 dígitos (posições 21 e 22); sem chave, NF-e */
export function modeloDaChave(chave) { const c = so(chave); return c.length === 44 ? +c.slice(20, 22) : 55; }

/** monta os índices de consulta a partir das linhas das tabelas rtc_* */
export function indexar({ base = null, cst = [], classtrib = [], ncm = [], exc = [] } = {}) {
  const T = { base, cst: new Map(cst.map(x => [x.cst, x])), ct: new Map(classtrib.map(x => [x.codigo, x])), ncm: new Map(), exc: new Map(), vazio: !classtrib.length };
  for (const v of ncm) (T.ncm.get(v.codigo) || T.ncm.set(v.codigo, []).get(v.codigo)).push(v);
  for (const e of exc) (T.exc.get(e.vinculo_id) || T.exc.set(e.vinculo_id, []).get(e.vinculo_id)).push(e);
  return T;
}

/**
 * NCM aceito pela classificação na data? Mesma regra da calculadora da Receita (NcmAplicavelService):
 * classificação sem vínculo vigente aceita qualquer NCM; com vínculo, exige NCM de 8 dígitos e rejeita quando
 * nenhum vínculo vigente cobre o NCM, ou quando uma exceção vigente o cobre e não há outro vínculo vigente sem exceção.
 * devolve 'livre' | 'ok' | 'incompleto' | 'fora'
 */
export function ncmAceito(T, codigo, ncm, data) {
  const d = dia(data), n = so(ncm), todos = T.ncm.get(codigo) || [], vig = todos.filter(v => vale(v, d));
  if (!vig.length) return 'livre';
  if (n.length !== 8) return 'incompleto';
  const cobre = (v) => n.startsWith(v.ncm), excVig = (v) => (T.exc.get(v.id) || []).filter(e => vale(e, d));
  const A = vig.some(cobre);
  if (!A) return 'fora';
  const E = todos.some(v => cobre(v) && excVig(v).some(e => n.startsWith(e.ncm)));
  const S = vig.some(v => cobre(v) && (!(T.exc.get(v.id) || []).length || (T.exc.get(v.id) || []).some(e => !vale(e, d))));
  return E && !S ? 'fora' : 'ok';
}

/**
 * Confere um item contra a tabela oficial.
 * i: { cst, classtrib, ncm }   o: { data (AAAA-MM-DD), modelo (55...) }
 * devolve { nivel: 'ok' | 'warn' | 'neg', motivos: [..], ct } — nivel 'neg' é erro certo; 'warn' pede conferência.
 */
export function validarItem(T, i, o = {}) {
  const out = { nivel: 'ok', motivos: [], ct: null };
  if (!T || T.vazio) return out;
  const cst = String(i.cst ?? '').trim(), cod = String(i.classtrib ?? '').trim(), d = dia(o.data) || new Date().toISOString().slice(0, 10), modelo = +(o.modelo || 55);
  if (!cst && !cod) return out;
  const add = (nv, t) => { out.motivos.push(t); if (nv === 'neg' || out.nivel === 'ok') out.nivel = nv; };
  if (cst) { const c = T.cst.get(cst); if (!c) add('neg', `CST ${cst} não existe na tabela oficial do IBS/CBS`); else if (!vale(c, d)) add('neg', `CST ${cst} fora de vigência em ${dBR(d)}`); }
  if (!cod) { add('warn', `CST ${cst} sem cClassTrib`); return out; }
  const ct = T.ct.get(cod);
  if (!ct) { add('neg', `cClassTrib ${cod} não existe na tabela oficial`); return out; }
  out.ct = ct;
  if (!vale(ct, d)) add('neg', `cClassTrib ${cod} fora de vigência em ${dBR(d)} (vale ${ct.fim ? `de ${dBR(ct.inicio)} a ${dBR(ct.fim)}` : `a partir de ${dBR(ct.inicio)}`})`);
  if (cst && ct.cst !== cst) add('neg', `cClassTrib ${cod} é do CST ${ct.cst}, mas o item está com CST ${cst}`);
  if ((ct.modelos || []).length && !ct.modelos.includes(modelo)) add('warn', `cClassTrib ${cod} não é aceito em ${MODELOS[modelo] || 'documento modelo ' + modelo}`);
  const n = ncmAceito(T, cod, i.ncm, d);
  if (n === 'fora') add('neg', `NCM ${so(i.ncm)} não consta do anexo do cClassTrib ${cod}`);
  if (n === 'incompleto') add('warn', `cClassTrib ${cod} exige o NCM completo (8 dígitos)`);
  return out;
}

/** texto curto da classificação: descrição, redução e crédito */
export function resumoClasstrib(ct) {
  if (!ct) return '';
  const r = +ct.red_cbs || 0, ri = Math.max(+ct.red_ibs_uf || 0, +ct.red_ibs_mun || 0);
  const red = !r && !ri ? '' : r === ri ? ` · redução de ${pct(r)}` : ` · redução de ${pct(r)} na CBS e ${pct(ri)} no IBS`;
  const cred = ct.credito_adquirente_cbs || ct.credito_adquirente_ibs ? '' : ' · sem crédito para quem compra';
  return `${ct.descricao}${red}${cred}`;
}

/**
 * Classificações possíveis para um item: as vigentes aceitas no documento cujo anexo cobre o NCM (primeiro) e as sem anexo de NCM.
 * devolve [{ codigo, cst, descricao, especifico }] — especifico = o anexo da classificação cita este NCM
 */
export function sugestoes(T, { ncm, data, modelo = 55 } = {}) {
  if (!T || T.vazio) return [];
  const d = dia(data) || new Date().toISOString().slice(0, 10), out = [];
  for (const ct of T.ct.values()) {
    if (!vale(ct, d) || ((ct.modelos || []).length && !ct.modelos.includes(+modelo))) continue;
    const n = ncmAceito(T, ct.codigo, ncm, d);
    if (n === 'ok') out.push({ codigo: ct.codigo, cst: ct.cst, descricao: ct.descricao, especifico: true });
    else if (n === 'livre') out.push({ codigo: ct.codigo, cst: ct.cst, descricao: ct.descricao, especifico: false });
  }
  return out.sort((a, b) => (b.especifico - a.especifico) || a.codigo.localeCompare(b.codigo));
}

/** junta a conferência dos itens de uma nota: { nivel, motivos (sem repetir, com a contagem de itens), reducoes: [texto] } */
export function validarNota(T, itens, o = {}) {
  const cont = new Map(), red = new Set(); let nivel = 'ok';
  for (const it of itens || []) {
    const r = validarItem(T, { cst: it.cst_ibscbs ?? it.cst, classtrib: it.cclass_trib ?? it.classtrib, ncm: it.ncm }, o);
    if (r.nivel === 'neg' || (r.nivel === 'warn' && nivel === 'ok')) nivel = r.nivel;
    for (const m of r.motivos) cont.set(m, (cont.get(m) || 0) + 1);
    if (r.ct && r.nivel === 'ok' && (+r.ct.red_cbs || +r.ct.red_ibs_uf || +r.ct.red_ibs_mun)) red.add(`${r.ct.codigo}: redução de ${pct(r.ct.red_cbs)}${+r.ct.red_cbs !== +r.ct.red_ibs_uf ? ` na CBS e ${pct(r.ct.red_ibs_uf)} no IBS` : ''}`);
  }
  // redução única: todos os itens com classificação válida e o mesmo percentual — dá para conferir o valor da nota inteira
  const R = (itens || []).map(it => T.ct.get(String(it.cclass_trib ?? it.classtrib ?? '').trim())), um = R.length && nivel === 'ok' && R.every(c => c && +c.red_cbs === +R[0].red_cbs && +c.red_ibs_uf === +R[0].red_ibs_uf && +c.red_ibs_mun === +R[0].red_ibs_mun);
  return { nivel, motivos: [...cont].map(([m, k]) => k > 1 ? `${m} (${k} itens)` : m), reducoes: [...red], unica: um ? { cbs: +R[0].red_cbs, ibs: Math.max(+R[0].red_ibs_uf, +R[0].red_ibs_mun) } : null };
}
