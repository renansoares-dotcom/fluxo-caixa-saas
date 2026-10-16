// Compras: cadastros (via RPC — o perfil Compras não lê as tabelas de cadastro), situações e utilidades comuns às telas.
import { sb, state, q } from './data.js';
import { esc, money, parseNum } from './ui.js';

let cache = null;
export async function cadCompras(force = false) {
  if (cache && cache.emp === state.empresa.id && !force) return cache;
  const r = await q(sb.rpc('compras_cadastros', { p_empresa: state.empresa.id }));
  cache = { emp: state.empresa.id, ...r, forById: Object.fromEntries(r.fornecedores.map(f => [f.id, f])),
    ccById: Object.fromEntries(r.centros.map(c => [c.id, c])), planoById: Object.fromEntries(r.planos.map(p => [p.id, p])) };
  return cache;
}

export const ST_REQ = { pendente: ['Aguardando aprovação', 'aberto'], aprovada: ['Aprovada', 'negoc'], rejeitada: ['Rejeitada', 'vencido'],
  atendida: ['Virou pedido', 'pago'], cancelada: ['Cancelada', ''] };
export const ST_PED = { rascunho: ['Rascunho', ''], aguardando: ['Aguardando aprovação', 'aberto'], aprovado: ['Aprovado', 'negoc'],
  enviado: ['Enviado ao fornecedor', 'negoc'], recebido_parcial: ['Recebido em parte', 'aberto'], recebido: ['Recebido', 'pago'], cancelado: ['Cancelado', ''] };
export const badge = (mapa, st) => `<span class="badge ${mapa[st]?.[1] || ''}">${esc(mapa[st]?.[0] || st)}</span>`;
export const ABERTOS = ['aprovado', 'enviado', 'recebido_parcial'];

export const qtd = (v) => (v == null ? '' : (+v).toLocaleString('pt-BR', { maximumFractionDigits: 4 }));
export const unit = (v) => (v == null ? '–' : 'R$ ' + (+v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
// valor para campo de digitação (sem separador de milhar, vírgula decimal)
export const inp = (v) => (v == null || v === '' ? '' : String(+v).replace('.', ','));
// "2.000" sem vírgula é dois mil (separador de milhar), não 2
export const num = (s) => { let t = String(s ?? '').trim(); if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); const v = parseNum(t); return isFinite(v) ? v : 0; };
export const diasTxt = (arr) => (arr || []).length ? arr.join('/') + ' dias' : 'à vista';
export const lerDias = (s) => String(s || '').split(/[^\d]+/).filter(Boolean).map(Number);
export const podeAprovar = () => ['admin', 'diretor'].includes(state.papel);
export const fmtMoney = money;
