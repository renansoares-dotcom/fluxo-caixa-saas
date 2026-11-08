// LGPD e revisão de acessos (melhoria 1.10, 07/11/2026): contas puras e os textos-modelo do termo. Testes: tests/lgpd.test.js.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// texto do termo (formato simples) → HTML: "## título", "- item", **negrito**, parágrafos separados por linha em branco
export function termoHTML(texto) {
  const linhas = String(texto ?? '').replace(/\r/g, '').split('\n');
  const neg = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  let html = '', lista = false, par = [];
  const fechaPar = () => { if (par.length) { html += `<p>${par.map(neg).join(' ')}</p>`; par = []; } };
  const fechaLista = () => { if (lista) { html += '</ul>'; lista = false; } };
  for (const l of linhas) {
    const t = l.trim();
    if (!t) { fechaPar(); fechaLista(); continue; }
    if (t.startsWith('## ')) { fechaPar(); fechaLista(); html += `<h3>${neg(t.slice(3))}</h3>`; continue; }
    if (/^[-•] /.test(t)) { fechaPar(); if (!lista) { html += '<ul>'; lista = true; } html += `<li>${neg(t.slice(2))}</li>`; continue; }
    fechaLista(); par.push(t);
  }
  fechaPar(); fechaLista();
  return html;
}

// situação de uma pessoa na revisão de acessos
export function situacaoAcesso(m, cfg) {
  const lim = +cfg?.inativos_dias || 60, aviso = +cfg?.aviso_dias || 0, dias = +m?.dias || 0;
  if (m?.protegido || m?.eu) return dias >= lim ? { k: 'protegido', txt: 'Sem acesso (administrador: não é suspenso)', cls: '' } : { k: 'ok', txt: 'Em uso', cls: 'pago' };
  if (dias >= lim) return cfg?.inativos_acao === 'avisar' ? { k: 'avisar', txt: `Sem acesso há ${dias} dias`, cls: 'vencido' } : { k: 'suspender', txt: 'Será suspenso hoje', cls: 'vencido' };
  if (dias >= lim - aviso) return { k: 'aviso', txt: `Suspensão em ${lim - dias} dia(s)`, cls: 'aberto' };
  return { k: 'ok', txt: 'Em uso', cls: 'pago' };
}

// prazo de uma solicitação do titular: dias que faltam (negativo = atrasada)
export function prazoSolicitacao(prazo, hoje = new Date()) {
  const p = new Date(String(prazo).slice(0, 10) + 'T12:00:00'), h = new Date(hoje); h.setHours(12, 0, 0, 0);
  const dias = Math.round((p - h) / 864e5);
  return { dias, cls: dias < 0 ? 'vencido' : dias <= 3 ? 'aberto' : '', txt: dias < 0 ? `atrasada ${-dias} dia(s)` : dias === 0 ? 'vence hoje' : `${dias} dia(s)` };
}

// CPF para mostrar na tela: 123.***.***-09
export const mascararCPF = (v) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length === 11 ? `${d.slice(0, 3)}.***.***-${d.slice(9)}` : String(v ?? ''); };

export const TIPOS_SOLIC = { confirmacao: 'Confirmar se tratamos os dados', acesso: 'Acesso aos dados', correcao: 'Correção', anonimizacao: 'Anonimização ou eliminação',
  portabilidade: 'Portabilidade', informacao: 'Com quem compartilhamos', revogacao: 'Revogar consentimento', oposicao: 'Oposição ao tratamento' };
export const ORIGENS = { usuario: 'Usuário da plataforma', portal: 'Portal do Cliente', favorecido: 'Beneficiário (pessoa física)', colaborador: 'Colaborador (RH)',
  motorista: 'Motorista', vendedor: 'Vendedor', transportador: 'Transportador autônomo', cracha: 'Crachá de terceiro ou visitante' };

// modelos do termo — o administrador revisa e publica (Privacidade e Acessos › Termos)
export function modeloTermo(publico, { empresa = '[EMPRESA]', encarregado = '[NOME DO ENCARREGADO]', email = '[E-MAIL DO ENCARREGADO]' } = {}) {
  if (publico === 'portal') return `Este portal é oferecido por **${empresa}** para que você, cliente, consulte títulos, notas fiscais, pedidos e artes, e envie pedidos de prorrogação e aprovações.

## Quais dados usamos
- seu nome e e-mail de acesso;
- os dados da empresa cliente que você representa (razão social, CNPJ, títulos, notas e pedidos);
- o registro das suas ações no portal (data do acesso, aprovações de arte, pedidos de prorrogação), para segurança e prova do que foi combinado.

## Para que usamos
- dar acesso às informações da sua empresa e registrar as suas solicitações;
- cumprir obrigações legais e fiscais;
- proteger o portal contra acessos indevidos.

Não vendemos nem compartilhamos seus dados para publicidade. Os dados podem ser tratados por prestadores que hospedam o sistema, sob contrato e com o mesmo cuidado.

## Seus direitos
Você pode pedir a confirmação, o acesso, a correção ou a eliminação dos seus dados, entre outros direitos da Lei 13.709/2018 (LGPD). Fale com **${encarregado}** pelo e-mail **${email}**. Respondemos em até 15 dias.

## Cuidados com o seu acesso
- não compartilhe a sua senha;
- o acesso sem uso por muito tempo pode ser bloqueado; peça a liberação ao financeiro.

Ao clicar em **Li e aceito**, você declara que leu este aviso.`;
  return `Este termo vale para quem usa a plataforma de gestão de **${empresa}**.

## Uso da plataforma
- o acesso é pessoal: não compartilhe a sua senha e use a verificação em duas etapas quando for pedida;
- use as informações só para o seu trabalho. Dados de clientes, fornecedores, colaboradores e números da empresa são **confidenciais**;
- não copie nem envie dados para fora da empresa sem autorização;
- avise o administrador se perceber acesso indevido, erro ou vazamento.

## Seus dados pessoais
A empresa trata o seu nome, e-mail, papel, áreas de acesso e o registro do que você faz na plataforma (inclusões, alterações, exclusões, telas abertas e tempo de uso). Isso serve para:
- controlar quem acessa o quê e manter a segurança;
- guardar a trilha de auditoria exigida pela contabilidade e pela fiscalização;
- melhorar a plataforma e o treinamento.

O registro de uso não grava o que você digita e é apagado depois do prazo de guarda.

## Acesso sem uso
O acesso pode ser suspenso depois de um período sem entrar na plataforma. Você recebe um aviso antes. Para voltar, fale com o administrador.

## Dados de outras pessoas
Ao cadastrar clientes, fornecedores, colaboradores e motoristas, registre só o necessário. Pedidos de titulares (acesso, correção, eliminação) devem ser encaminhados a **${encarregado}** (**${email}**).

Ao clicar em **Li e aceito**, você declara que leu e vai seguir este termo.`;
}
