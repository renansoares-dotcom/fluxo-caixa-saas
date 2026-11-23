-- 191 — segurança transversal: funções privilegiadas que quem não fez login conseguia chamar
-- Havia 71 funções "security definer" executáveis pelo papel anon (sem login). A maior parte só respondia "não" sem login,
-- mas três gravavam dados: _indices_gravar (índices econômicos), _indices_atualizar (disparava buscas no Banco Central)
-- e rma_documentos_padrao (a checagem de administrador só valia com login).
-- Agora:
--   * só as páginas públicas de propósito continuam abertas sem login: cotação pelo link do fornecedor, convite para entrar,
--     convite do portal do cliente, verificação do crachá e "posso criar empresa";
--   * as funções internas (índices econômicos) ficam só para a plataforma (agendador e servidor);
--   * as funções de gatilho perdem o acesso direto (o gatilho continua disparando normalmente);
--   * as demais seguem para quem fez login e para o servidor.
-- Aditivo: nada é apagado.

do $$
declare r record;
  v_publicas text[] := array['cotacao_link_abrir', 'cotacao_link_recusar', 'cotacao_link_responder', 'portal_ver_convite', 'ver_convite', 'cracha_verificar', 'pode_criar_empresa'];
  v_internas text[] := array['_indices_gravar', '_indices_atualizar'];
begin
  for r in select p.oid::regprocedure f, p.proname, pg_get_function_result(p.oid) res
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute') and p.proname <> all(v_publicas) loop
    execute format('revoke execute on function %s from public, anon', r.f);
    if r.proname = any(v_internas) then
      execute format('revoke execute on function %s from authenticated', r.f);
      if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', r.f); end if;
    elsif r.res <> 'trigger' then
      execute format('grant execute on function %s to authenticated', r.f);
      if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', r.f); end if;
    end if;
  end loop;
end $$;

-- rma_documentos_padrao: a lista padrão de documentos só pelo administrador (ou pela própria plataforma, sem usuário)
create or replace function public._rma_doc_pode(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then current_user not in ('anon', 'authenticated') else is_admin(p_empresa) end;
$$;
revoke all on function public._rma_doc_pode(uuid) from public, anon, authenticated;

create or replace function public.rma_documentos_padrao(p_empresa uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public._rma_doc_pode(p_empresa) then raise exception 'Só o administrador cria a lista de documentos.'; end if;
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
revoke all on function public.rma_documentos_padrao(uuid) from public, anon;
grant execute on function public.rma_documentos_padrao(uuid) to authenticated;
