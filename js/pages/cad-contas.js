import { state } from '../lib/data.js';
import { esc, money } from '../lib/ui.js';
import { crudPage } from '../lib/crud.js';

export const title = 'Contas bancárias';
const TIPOS = ['Conta Corrente', 'Caixa', 'Conta Poupança', 'Investimento', 'Conta Escrow', 'FIDC', 'Cheques', 'Cartão de Crédito', 'Vale Combústivel', 'Digital'];

export async function render(root) {
  root.insertAdjacentHTML('beforeend', `<div class="card"><p class="muted small" style="margin:0">Saldo inicial = saldo de abertura no início do controle (${state.empresa.ano_inicio}).
    Contas marcadas como <strong>recursos bloqueados</strong> (ex.: bloqueio judicial) podem ser separadas nos relatórios pelo filtro de disponibilidade.</p></div>`);
  crudPage(root, {
    table: 'contas',
    rows: () => state.cad.contas,
    busca: (r) => `${r.nome} ${r.instituicao || ''}`,
    cols: [
      { k: 'codigo', t: 'Id' }, { k: 'nome', t: 'Nome' }, { k: 'tipo', t: 'Tipo' },
      { k: 'grupo_id', t: 'Grupo', fmt: r => esc(state.cad.grupoById[r.grupo_id]?.nome || '') },
      { k: 'disponibilidade', t: 'Disponibilidade', fmt: r => r.disponibilidade === 'Conta com recursos disponíveis' ? 'Disponível' : '<span class="badge vencido">Bloqueada</span>' },
      { k: 'instituicao', t: 'Instituição' }, { k: 'agencia', t: 'Agência' }, { k: 'numero', t: 'Conta' },
      { k: 'saldo_inicial', t: 'Saldo inicial', num: true, fmt: r => money(r.saldo_inicial) },
      { k: 'ativo', t: '', fmt: r => r.ativo ? '' : '<span class="badge vencido">inativa</span>' },
    ],
    fields: [
      { k: 'codigo', t: 'Id / código' }, { k: 'nome', t: 'Nome de identificação', req: true, span: true },
      { k: 'tipo', t: 'Tipo', list: () => TIPOS },
      { k: 'grupo_id', t: 'Grupo empresarial', type: 'select', opts: () => state.cad.grupos },
      { k: 'disponibilidade', t: 'Disponibilidade', type: 'select', req: true, value: 'id', label: 'id', def: 'Conta com recursos disponíveis',
        opts: () => [{ id: 'Conta com recursos disponíveis' }, { id: 'Conta com recursos bloqueados' }] },
      { k: 'instituicao', t: 'Instituição' }, { k: 'agencia', t: 'Agência' }, { k: 'numero', t: 'Número da conta' },
      { k: 'ofx_banco', t: 'Banco no OFX (BANKID)' }, { k: 'ofx_conta', t: 'Conta no OFX (ACCTID)' },
      { k: 'saldo_inicial', t: 'Saldo inicial real', type: 'money', def: 0 },
      { k: 'saldo_inicial_aberto', t: 'Saldo inicial em aberto', type: 'money', def: 0 },
      { k: 'saldo_budget', t: 'Saldo inicial budget', type: 'money', def: 0 },
      { k: 'saldo_forecast', t: 'Saldo inicial forecast', type: 'money', def: 0 },
      { k: 'ativo', t: 'Ativa', type: 'check', def: true },
    ],
  });
}
