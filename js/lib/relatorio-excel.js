// Padrão de relatórios, fase 1: cabeçalho da planilha exportada (o mesmo do PDF) e registro da emissão em Excel.
import { EMPRESA_REL } from './relatorio-base.js';
import { linhasCabecalho, deslocarPlanilha } from './relatorio-padrao.js';
import { capturarFiltros, varianteEmUso } from './relatorio-filtros.js';
import { registrarEmissao, rotaAtual } from './relatorio-emissao.js';

const cnpjFmt = (c) => { const d = String(c || '').replace(/\D/g, ''); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : String(c || ''); };

/** linhas do cabeçalho para a planilha da tela aberta; a planilha exportada de dentro de uma ficha sai sem o quadro de parâmetros */
export async function cabecalhoPlanilha(titulo = '') {
  const naFicha = !!document.querySelector('.modal-back');
  const nome = `${titulo || document.querySelector('#page-title')?.textContent?.trim() || 'Relatório'} – planilha`;
  const cap = naFicha ? null : capturarFiltros();
  let pars = cap?.parametros || [];
  if (cap) { const v = varianteEmUso(rotaAtual(), cap.estado); if (v) pars = [...pars, ['Variante', v]]; }
  const em = await registrarEmissao({ nome, formato: 'xlsx', tipo: naFicha ? 'documento' : 'relatorio', parametros: pars, filtros: cap?.estado || null });
  const linhas = linhasCabecalho({ empresa: { nome: EMPRESA_REL, cnpj: cnpjFmt(em.cnpj) }, codigo: em.codigo, nome, emissao: { numero: em.numero, quando: em.quando, usuario: em.usuario }, parametros: pars });
  linhas.desloca = deslocarPlanilha;
  return linhas;
}
