// Compras › Atualização Cadastral de Fornecedores (CMP006) — SQL 199, 26/11/2026. A mesma tela da atualização dos clientes
// (COM010), para os fornecedores: regime, crédito do Simples, opção pelo IBS/CBS regular e atividade, que alimentam as cotações.
import { renderPublico } from './comercial-cadastro-reforma.js';

export const title = 'Atualização Cadastral de Fornecedores';
export const render = (root) => renderPublico(root, 'fornecedor');
