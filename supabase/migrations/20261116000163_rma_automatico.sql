-- RMA automático (pedido do Renan em 16/11/2026): ao conciliar e fechar o banco, o extrato da conta já entra no RMA do mês;
-- com todos os bancos fechados no mês, os demais relatórios da plataforma são gerados. Tudo por parâmetro.
-- A geração do PDF acontece na tela de quem fecha a conta; aqui ficam os parâmetros, a nova origem de documento
-- ("extrato da conta") e a ligação do arquivo com a conta. Aditivo.

alter table public.rma_config
  add column if not exists auto_extrato boolean not null default true,        -- fechar o banco gera o extrato da conta no RMA
  add column if not exists auto_relatorios boolean not null default true,     -- todos os bancos fechados no mês: gera os demais relatórios
  add column if not exists contas_fora uuid[] not null default '{}';          -- contas que não entram no RMA

alter table public.rma_documentos drop constraint if exists rma_documentos_fonte_check;
alter table public.rma_documentos add constraint rma_documentos_fonte_check
  check (fonte in ('anexo', 'fluxo_caixa', 'titulos', 'faturamento', 'notas_emitidas', 'vendas', 'contratos', 'extrato_conta'));

alter table public.rma_arquivos add column if not exists conta_id uuid references public.contas(id) on delete set null;
create index if not exists rma_arquivos_conta on public.rma_arquivos(conta_id) where conta_id is not null;

-- os extratos bancários passam a sair do fechamento do banco (quem já tinha a lista padrão)
update public.rma_documentos set fonte = 'extrato_conta', tela = 'fechamento',
       orientacao = 'Gerado ao fechar o banco no Fechamento do Mês: extrato conciliado de cada conta, com o saldo conferido. Anexe também o PDF emitido pelo banco quando for pedido.'
 where codigo = '06' and fonte = 'anexo' and arquivo = 'Extratos_Bancarios';

-- lista padrão: o 06 nasce como extrato da conta e entra o 05 (conciliações bancárias)
create or replace function public.rma_documentos_padrao(p_empresa uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is not null and not is_admin(p_empresa) then raise exception 'Só o administrador cria a lista de documentos.'; end if;
  insert into rma_documentos(empresa_id, codigo, grupo, nome, arquivo, fonte, tela, formatos, ordem, orientacao)
  select p_empresa, v.codigo, v.grupo, v.nome, v.arquivo, v.fonte, v.tela, v.formatos, v.ordem, v.orientacao
    from (values
      ('01', 'Departamento Contábil', 'Balancete de verificação mensal (PDF e Excel)', 'Balancete', 'anexo', 'contab/balancete', array['pdf', 'xlsx'], 10, 'O balancete oficial vem da contabilidade. Anexe o PDF e a planilha do mês.'),
      ('02', 'Departamento Contábil', 'Demonstração de Resultado do Exercício (DRE)', 'DRE', 'anexo', 'contab/dre', array['pdf'], 20, 'DRE contábil do mês, emitida pela contabilidade.'),
      ('03', 'Departamento Contábil', 'Balanço patrimonial (quando encerrado o período)', 'Balanco_Patrimonial', 'anexo', 'contab/balanco', array['pdf'], 30, 'Só nos meses em que há balanço encerrado. Nos demais, marque "não se aplica" com o motivo.'),
      ('04', 'Departamento Financeiro', 'Fluxo de caixa', 'Fluxo_de_Caixa', 'fluxo_caixa', 'fluxo-mensal', array['pdf', 'xlsx'], 40, 'Gerado pela plataforma: entradas e saídas pagas no mês por conta do plano, e saldo das contas.'),
      ('05', 'Departamento Financeiro', 'Conciliações bancárias', 'Conciliacao_Bancaria', 'anexo', 'conciliacao', array['pdf'], 50, 'Uma por conta: saldo do extrato × saldo da plataforma no último dia do mês e itens em aberto.'),
      ('06', 'Departamento Financeiro', 'Extratos bancários completos de todas as contas de titularidade da recuperanda', 'Extratos_Bancarios', 'extrato_conta', 'fechamento', array['pdf'], 60, 'Gerado ao fechar o banco no Fechamento do Mês: extrato conciliado de cada conta, com o saldo conferido. Anexe também o PDF emitido pelo banco quando for pedido.'),
      ('07', 'Departamento Financeiro', 'Relatórios de contas a pagar e a receber', 'Contas_a_Pagar_e_Receber', 'titulos', 'contas', array['pdf', 'xlsx'], 70, 'Gerado pela plataforma: títulos em aberto no último dia do mês.'),
      ('08', 'Departamento Financeiro', 'Relatório de faturamento mensal', 'Faturamento_Mensal', 'faturamento', 'notas', array['pdf', 'xlsx'], 80, 'Gerado pela plataforma a partir das notas de saída do mês.'),
      ('09', 'Relatórios', 'Relação de notas fiscais emitidas', 'Notas_Fiscais_Emitidas', 'notas_emitidas', 'notas', array['pdf', 'xlsx'], 90, 'Gerado pela plataforma: todas as notas emitidas no mês, inclusive as canceladas.'),
      ('10', 'Relatórios', 'Relatório de produção e/ou vendas', 'Producao_e_Vendas', 'vendas', 'producao', array['pdf', 'xlsx'], 100, 'Gerado pela plataforma: vendas do mês por cliente. Anexe também o relatório de produção, se for pedido.'),
      ('11', 'Relatórios', 'Relatório de estoque, quando aplicável', 'Estoque', 'anexo', 'estoque', array['pdf'], 110, 'Posição do estoque no último dia do mês.'),
      ('12', 'Relatórios', 'Relação de contratos firmados, alterados ou rescindidos no período', 'Contratos_do_Periodo', 'contratos', 'contratos', array['pdf', 'xlsx'], 120, 'Gerado pela plataforma a partir de Cadastros › Contratos.'),
      ('13', 'Geral', 'Relação atualizada de processos judiciais e administrativos', 'Processos_Judiciais', 'anexo', null, array['pdf'], 130, 'Relação fornecida pelo jurídico.'),
      ('14', 'Geral', 'Informações sobre constrições judiciais eventualmente existentes', 'Constricoes_Judiciais', 'anexo', null, array['pdf'], 140, 'Bloqueios, penhoras e arrestos do mês. Sem ocorrência, marque "não se aplica" e escreva "sem constrições no período".')
    ) as v(codigo, grupo, nome, arquivo, fonte, tela, formatos, ordem, orientacao)
   where not exists (select 1 from rma_documentos d where d.empresa_id = p_empresa and d.codigo = v.codigo);
  get diagnostics n = row_count;
  return n;
end $$;

-- abrir o mês também serve a quem fecha o banco (o extrato entra sozinho): basta poder editar o financeiro
create or replace function public.rma_abrir_mes(p_empresa uuid, p_mes date) returns int
language plpgsql security definer set search_path = public as $$
declare c rma_config; v_mes date := date_trunc('month', p_mes)::date; n int;
begin
  if not rma_pode(p_empresa) then raise exception 'Sem permissão para abrir o RMA.'; end if;
  select * into c from rma_config where empresa_id = p_empresa;
  if not coalesce(c.ativo, false) then raise exception 'O RMA não está ativado para esta empresa.'; end if;
  if v_mes < c.mes_inicio then raise exception 'O primeiro mês do RMA desta empresa é %.', to_char(c.mes_inicio, 'MM/YYYY'); end if;
  if v_mes > date_trunc('month', current_date)::date then raise exception 'Não é possível abrir um mês que ainda não começou.'; end if;
  insert into rma_meses(empresa_id, mes, prazo) values (p_empresa, v_mes, (v_mes + interval '1 month')::date + (c.dia_entrega - 1)) on conflict do nothing;
  if (select status from rma_meses where empresa_id = p_empresa and mes = v_mes) = 'enviado' then return 0; end if;
  insert into rma_entregas(empresa_id, mes, documento_id)
  select p_empresa, v_mes, d.id from rma_documentos d where d.empresa_id = p_empresa and d.ativo on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
