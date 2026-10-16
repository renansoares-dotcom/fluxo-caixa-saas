// Produtos: tipos, materiais, peso teórico, carga do cadastro e seletor de produto (usado em Compras e Estoque).
import { sb, state, q, fetchAll } from './data.js';
import { esc } from './ui.js';

export const TIPOS = { materia_prima: 'Matéria-prima (resina)', aditivo: 'Aditivo / master', tinta_solvente: 'Tinta e solvente', embalagem: 'Embalagem',
  semiacabado: 'Semiacabado (bobina)', produto_acabado: 'Produto acabado', uso_consumo: 'Uso e consumo', peca_manutencao: 'Peça de manutenção', servico: 'Serviço', outro: 'Outro' };
export const MATERIAIS = { PEBD: 0.92, PELBD: 0.92, PEAD: 0.95, PP: 0.90, BOPP: 0.905, PET: 1.38, PVC: 1.38, PA: 1.14, OUTRO: null };
export const FORMATOS = { bobina: 'Bobina', saco: 'Saco', sacola: 'Sacola', folha: 'Folha', outro: 'Outro' };

// tipo sugerido pelo NCM do item do fornecedor
export function tipoPorNcm(ncm = '') {
  const n = String(ncm);
  if (/^390[12]/.test(n)) return 'materia_prima';
  if (/^(3206|3204|3812|3824)/.test(n)) return 'aditivo';
  if (/^(3208|3209|3210|3212|3215|3814|2901|2902|2905|2915)/.test(n)) return 'tinta_solvente';
  if (/^(4819|4821|3923|4808|3919|5607|4415)/.test(n)) return 'embalagem';
  if (/^(84|85|73|40|7318|8482|8483)/.test(n)) return 'peca_manutencao';
  return 'uso_consumo';
}

// peso teórico: g/m² = espessura(µm) × densidade(g/cm³); g/m = g/m² × largura(m) × camadas; por peça = g/m × comprimento(m)
export function pesoTeorico(p) {
  const d = +p.densidade || MATERIAIS[p.material] || null;
  if (!d || !+p.espessura_um) return null;
  const gm2 = +p.espessura_um * d, gm = +p.largura_mm ? gm2 * (+p.largura_mm / 1000) * (+p.camadas || 1) : null;
  const peca = gm && +p.comprimento_m ? gm * +p.comprimento_m : null;
  return { d, gm2, gm, peca, milheiroKg: peca ? peca : null };   // peça em g → milheiro em kg (×1000 ÷ 1000)
}

let cache = null;
export async function carregarProdutos(force = false) {
  if (cache && cache.emp === state.empresa.id && !force) return cache.lista;
  const lista = await fetchAll(() => sb.from('produtos').select('*').eq('empresa_id', state.empresa.id).order('codigo'));
  cache = { emp: state.empresa.id, lista };
  return lista;
}
export const limparCacheProdutos = () => { cache = null; };

// datalist "código — descrição" para campos de item; achar(valor) devolve o produto escolhido
export function datalistProdutos(id, lista) {
  return `<datalist id="${id}">${lista.filter(p => p.ativo).map(p => `<option value="${esc(p.codigo)} — ${esc(p.descricao)}"></option>`).join('')}</datalist>`;
}
export function acharProduto(valor, lista) {
  const cod = String(valor || '').split(' — ')[0].trim();
  return lista.find(p => p.codigo === cod && String(valor).includes(' — ')) || null;
}

// liga os campos de descrição de uma tabela de itens ao cadastro: escolher "código — descrição" na lista grava o produto,
// preenche unidade e NCM; digitar texto livre desliga. Campos: .it-d (descrição), .it-u (unidade), .it-n (NCM).
export function ligarItensProduto(tb, lista) {
  tb.addEventListener('change', (e) => {
    const d = e.target.closest('.it-d'); if (!d) return;
    const p = acharProduto(d.value, lista), tr = d.closest('tr');
    if (p) { d.dataset.prod = p.id; const u = tr.querySelector('.it-u'), n = tr.querySelector('.it-n'); if (u) u.value = p.unidade; if (n && p.ncm) n.value = p.ncm; }
    else delete d.dataset.prod;
  });
}
export const produtoDoItem = (tr) => tr.querySelector('.it-d')?.dataset.prod || null;
