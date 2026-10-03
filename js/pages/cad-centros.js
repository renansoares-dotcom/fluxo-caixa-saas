import { state } from '../lib/data.js';
import { crudPage } from '../lib/crud.js';

export const title = 'Centros de custo e grupos';

export async function render(root) {
  crudPage(root, {
    table: 'centros_custo', titulo: 'Centros de custo',
    rows: () => state.cad.cc,
    cols: [{ k: 'nome', t: 'Nome' }, { k: 'ativo', t: '', fmt: r => r.ativo ? '' : '<span class="badge vencido">inativo</span>' }],
    fields: [{ k: 'nome', t: 'Nome', req: true }, { k: 'ativo', t: 'Ativo', type: 'check', def: true }],
    antesSalvar: (r) => { r.nome = r.nome.trim().toUpperCase(); },
  });
  crudPage(root, {
    table: 'grupos', titulo: 'Grupos empresariais (ex.: matriz, filiais, empresas do grupo)',
    rows: () => state.cad.grupos,
    cols: [{ k: 'nome', t: 'Nome' }],
    fields: [{ k: 'nome', t: 'Nome', req: true }],
    antesSalvar: (r) => { r.nome = r.nome.trim().toUpperCase(); },
  });
}
