// Comercial: dados das NF-e de saída e da carteira (por RPC — o perfil vendas só enxerga a própria carteira),
// situação de cada cliente (ativo, novo, esfriando, inativo) e rótulos do funil.
import { sb, state, q } from './data.js';
import { today } from './ui.js';

export const ETAPAS = { contato: 'Contato', qualificado: 'Qualificado', proposta: 'Proposta enviada', ganha: 'Ganha', perdida: 'Perdida' };
export const ABERTAS = ['contato', 'qualificado', 'proposta'];
export const TIPOS_INT = { ligacao: 'Ligação', visita: 'Visita', email: 'E-mail', whatsapp: 'WhatsApp', reuniao: 'Reunião', anotacao: 'Anotação' };
export const ST_CLI = { ativo: ['Ativo', 'pago'], novo: ['Novo', 'negoc'], esfriando: ['Esfriando', 'aberto'], inativo: ['Inativo', 'vencido'], sem: ['Sem compra', ''] };
export const interno = () => ['admin', 'financeiro', 'diretor', 'leitura'].includes(state.papel);
export const podeEditarCom = () => ['admin', 'financeiro', 'diretor', 'vendas'].includes(state.papel);
export const podeConfigCom = () => ['admin', 'diretor'].includes(state.papel);
export const addDias = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const dias = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
const soDig = (s) => String(s || '').replace(/\D/g, '');

let cache = null;
// base comercial: clientes da carteira + notas de 24 meses (ligadas ao cliente pelo cadastro ou CNPJ)
export async function baseComercial(force = false) {
  if (cache && cache.emp === state.empresa.id && !force && Date.now() - cache.t < 120000) return cache;
  const e = state.empresa.id, h = today();
  const [clientes, notas, vendedores] = await Promise.all([q(sb.rpc('comercial_clientes', { p_empresa: e })),
    q(sb.rpc('comercial_notas', { p_empresa: e, p_de: addDias(h, -730), p_ate: h })),
    q(sb.from('comercial_vendedores').select('*').eq('empresa_id', e).order('nome'))]);
  const porDoc = {}; for (const c of clientes) if (soDig(c.documento)) porDoc[soDig(c.documento)] = c;
  for (const n of notas) { if (!n.favorecido_id && porDoc[n.dest_doc]) n.favorecido_id = porDoc[n.dest_doc].id; n.chave = n.favorecido_id || 'doc:' + n.dest_doc; }
  // situação de cada cliente pelo histórico de compras
  const hist = {}; for (const n of notas) (hist[n.chave] ||= []).push(n);
  const info = {};
  for (const [k, ns] of Object.entries(hist)) {
    ns.sort((a, b) => a.emissao.localeCompare(b.emissao));
    const datas = [...new Set(ns.map(n => n.emissao))].sort();
    const gaps = datas.slice(1).map((d, i) => dias(datas[i], d)).filter(g => g > 0);
    const intervalo = gaps.length ? gaps.reduce((t, g) => t + g, 0) / gaps.length : null;
    const ult = datas[datas.length - 1], desde = dias(ult, h), prim = datas[0];
    const v12 = ns.filter(n => n.emissao > addDias(h, -365)).reduce((t, n) => t + +n.valor, 0);
    const v12a = ns.filter(n => n.emissao <= addDias(h, -365)).reduce((t, n) => t + +n.valor, 0);
    let st = 'ativo';
    if (desde > 180) st = 'inativo';
    else if (intervalo && desde > Math.max(1.5 * intervalo, 20)) st = 'esfriando';
    else if (prim > addDias(h, -90)) st = 'novo';
    info[k] = { chave: k, nome: ns[ns.length - 1].dest_nome, uf: ns[ns.length - 1].dest_uf, notas: ns.length, primeira: prim, ultima: ult, desde, intervalo, v12, v12a, st,
      ticket: ns.length ? ns.reduce((t, n) => t + +n.valor, 0) / ns.length : 0 };
  }
  cache = { emp: e, t: Date.now(), clientes, notas, vendedores, info, porDoc };
  return cache;
}
export const limparBaseComercial = () => { cache = null; };
