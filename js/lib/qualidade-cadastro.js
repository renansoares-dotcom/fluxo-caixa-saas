// Qualidade do cadastro (melhoria 10.1): duplicados (mesmo documento ou nome parecido), indicador de cadastro completo e
// a leitura da consulta pública do CNPJ (BrasilAPI) para comparar com o cadastro.
import { analisaDocumento, somenteDoc } from './documentos.js';

const SUFIXOS = /\b(LTDA|ME|EPP|EIRELI|S A|SA|CIA|COMERCIO|COM|INDUSTRIA|IND|DE|DA|DO|DOS|DAS|E|EM|MEI)\b/g;
export const normNome = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(SUFIXOS, ' ').replace(/\s+/g, ' ').trim();

/** semelhança 0–1: Dice dos bigramas do nome normalizado (rápido e bom para nomes de empresa) */
export function semelhanca(a, b) {
  const A = normNome(a), B = normNome(b);
  if (!A || !B) return 0; if (A === B) return 1;
  const big = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); } return m; };
  const x = big(A), y = big(B); let comum = 0;
  for (const [k, n] of x) comum += Math.min(n, y.get(k) || 0);
  return (2 * comum) / (Math.max(1, A.length - 1) + Math.max(1, B.length - 1));
}

const chavePar = (a, b) => [a, b].sort().join('|');

/**
 * grupos de duplicados: [{ motivo: 'documento'|'nome', chave, itens: [...], semelhanca }]
 * ignorados: Set de 'idA|idB' marcados como "não é duplicado"; o mesmo documento só conta entre cadastros do mesmo tipo
 */
export function duplicados(lista, { campoNome = 'nome', campoDoc = 'documento', minimo = 0.85, ignorados = new Set(), mesmoTipo = 'tipo' } = {}) {
  const ativos = lista.filter(x => x.ativo !== false), grupos = [], usados = new Set();
  if (campoDoc) {
    const porDoc = new Map();
    for (const f of ativos) { const d = somenteDoc(f[campoDoc]); if (d && d.length >= 11) { const k = d + '|' + (mesmoTipo ? f[mesmoTipo] || '' : ''); (porDoc.get(k) || porDoc.set(k, []).get(k)).push(f); } }
    for (const [k, itens] of porDoc) {
      if (itens.length < 2) continue;
      const fora = itens.filter((a, i) => itens.some((b, j) => j !== i && !ignorados.has(chavePar(a.id, b.id))));
      if (fora.length < 2) continue;
      grupos.push({ motivo: 'documento', chave: k.split('|')[0], itens: fora, semelhanca: 1 }); fora.forEach(f => usados.add(f.id));
    }
  }
  // nomes parecidos: compara dentro do mesmo "balde" (primeiras 3 letras do nome normalizado)
  const baldes = new Map();
  for (const f of ativos) { const n = normNome(f[campoNome]); if (n.length < 3) continue; const k = n.slice(0, 3) + '|' + (mesmoTipo ? f[mesmoTipo] || '' : ''); (baldes.get(k) || baldes.set(k, []).get(k)).push(f); }
  for (const itens of baldes.values()) {
    for (let i = 0; i < itens.length; i++) for (let j = i + 1; j < itens.length; j++) {
      const a = itens[i], b = itens[j];
      if (usados.has(a.id) && usados.has(b.id)) continue;
      if (ignorados.has(chavePar(a.id, b.id))) continue;
      const da = campoDoc ? somenteDoc(a[campoDoc]) : '', db = campoDoc ? somenteDoc(b[campoDoc]) : '';
      if (da && db && da !== db) continue;   // documentos diferentes: são empresas diferentes
      const s = semelhanca(a[campoNome], b[campoNome]);
      if (s >= minimo) grupos.push({ motivo: 'nome', chave: chavePar(a.id, b.id), itens: [a, b], semelhanca: s });
    }
  }
  return grupos.sort((x, y) => (x.motivo === 'documento' ? 0 : 1) - (y.motivo === 'documento' ? 0 : 1) || y.semelhanca - x.semelhanca);
}

export const CAMPOS_FAV = {
  documento: ['CNPJ/CPF válido', 25, (f) => analisaDocumento(f.documento).valido], endereco: ['Endereço (logradouro, município, UF, CEP)', 15, (f) => !!(f.logradouro && f.municipio && f.uf && f.cep)],
  email: ['E-mail', 10, (f) => /\S+@\S+\.\S+/.test(f.email || '')], telefone: ['Telefone', 10, (f) => String(f.telefone || '').replace(/\D/g, '').length >= 10],
  pagamento: ['Dados de pagamento (banco ou PIX)', 15, (f) => !!(f.pix || (f.banco_codigo && f.agencia && f.conta_numero) || f.dados_bancarios)],
  ie: ['Inscrição estadual ou indicador de ICMS (PJ)', 10, (f) => f.tipo_pessoa === 'PF' || !!(f.ie || f.contribuinte_icms)], receita: ['Conferido na Receita (situação ativa)', 15, (f) => f.receita_situacao === 'ATIVA'],
};
export const CAMPOS_PROD = {
  ncm: ['NCM (8 dígitos)', 30, (p) => /^\d{8}$/.test(String(p.ncm || '').replace(/\D/g, ''))], unidade: ['Unidade', 15, (p) => !!p.unidade], grupo: ['Grupo', 15, (p) => !!p.grupo],
  tipo: ['Tipo do produto', 10, (p) => !!p.tipo && p.tipo !== 'outro'], estoque: ['Estoque mínimo ou ponto de pedido', 15, (p) => p.estoque_minimo != null || p.ponto_pedido != null],
  descricao: ['Descrição com 10 caracteres ou mais', 15, (p) => String(p.descricao || '').trim().length >= 10],
};

/** indicador 0–100 pelos campos e pesos (pesos da empresa sobrepõem os padrão; peso 0 tira o campo) */
export function completude(item, campos, pesos = {}) {
  let tot = 0, ok = 0; const faltam = [];
  for (const [k, [rot, padrao, teste]] of Object.entries(campos)) {
    const p = pesos[k] != null ? +pesos[k] : padrao; if (!p) continue;
    tot += p; if (teste(item)) ok += p; else faltam.push(rot);
  }
  return { nota: tot ? Math.round(ok / tot * 100) : 100, faltam };
}

/** resposta da BrasilAPI (/api/cnpj/v1) -> campos do cadastro e a situação */
export function lerReceita(r) {
  if (!r || !r.cnpj) return null;
  const tel = String(r.ddd_telefone_1 || '').replace(/\D/g, '');
  return {
    situacao: String(r.descricao_situacao_cadastral || '').toUpperCase() || null, data_situacao: r.data_situacao_cadastral || null, abertura: r.data_inicio_atividade || null,
    cnae: r.cnae_fiscal ? `${r.cnae_fiscal} ${r.cnae_fiscal_descricao || ''}`.trim() : null, simples: r.opcao_pelo_simples ?? null, mei: r.opcao_pelo_mei ?? null,
    campos: { nome: r.razao_social || null, nome_fantasia: r.nome_fantasia || null, logradouro: [r.descricao_tipo_de_logradouro, r.logradouro].filter(Boolean).join(' ') || null,
      numero: r.numero || null, complemento: r.complemento || null, bairro: r.bairro || null, municipio: r.municipio || null, uf: r.uf || null,
      cep: r.cep ? String(r.cep).replace(/\D/g, '').replace(/^(\d{5})(\d{3})$/, '$1-$2') : null, telefone: tel.length >= 10 ? tel : null, email: r.email ? String(r.email).toLowerCase() : null },
  };
}

/** o que muda: [{campo, atual, receita, vazio}] — "vazio" = o cadastro está em branco */
export function diferencas(f, R) {
  const N = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
  return Object.entries(R?.campos || {}).filter(([, v]) => v).filter(([k, v]) => N(f[k]) !== N(v)).map(([campo, v]) => ({ campo, atual: f[campo] || '', receita: v, vazio: !f[campo] }));
}
