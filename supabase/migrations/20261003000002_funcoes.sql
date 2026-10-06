-- =====================================================================
-- Funções (RPC) usadas pelo front-end
-- =====================================================================

-- ---------------------------------------------------------------------
-- Onboarding: cria a empresa, torna o usuário admin e aplica um plano de contas modelo
-- ---------------------------------------------------------------------
create or replace function public.criar_empresa(p_nome text, p_cnpj text default null, p_ano int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_ano int := coalesce(p_ano, extract(year from now())::int);
begin
  if auth.uid() is null then raise exception 'Não autenticado'; end if;
  insert into empresas(nome, cnpj, ano_inicio) values (p_nome, p_cnpj, v_ano) returning id into v_emp;
  insert into membros(empresa_id, user_id, papel) values (v_emp, auth.uid(), 'admin');
  insert into grupos(empresa_id, nome) values (v_emp, 'MATRIZ');
  insert into centros_custo(empresa_id, nome)
    select v_emp, x from unnest(array['ADMINISTRATIVO','COMERCIAL','FINANCEIRO','PRODUÇÃO','LOGISTICA','DIREÇÃO']) x;
  perform aplicar_plano_modelo(v_emp);
  insert into forecast_status(empresa_id, ano, mes) select v_emp, v_ano, m from generate_series(1,12) m;
  return v_emp;
end $$;

create or replace function public.aplicar_plano_modelo(p_empresa uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_pai uuid;
begin
  for r in select * from (values
    ('1.01','Receita de vendas','E','C','receita_bruta',null, array['Receita com vendas de produtos','Receita com serviços','Adiantamento de clientes']),
    ('1.02','Receitas financeiras','E','C','receitas_financeiras',null, array['Rendimentos de aplicações','Juros recebidos','Antecipação de recebíveis (FIDC/Factoring)']),
    ('1.03','Devoluções','E','C','receita_bruta',null, array['Devolução de fornecedores']),
    ('1.04','Outras entradas','E','C','receita_bruta',null, array['Venda de ativos','Outras receitas']),
    ('2.01','Despesa com insumos','S','D','custos_diretos','Negociável', array['Matéria-prima','Embalagens','Materiais diretos']),
    ('2.02','Despesa com serviços','S','D','custos_diretos','Negociável', array['Serviços de terceiros na produção']),
    ('2.03','Despesa com pessoal','S','D','despesas_operacionais','Obrigatório', array['Salários','Férias','13º salário','FGTS','INSS','Vale-transporte','Plano de saúde','Rescisões']),
    ('2.04','Despesas comerciais','S','D','despesas_operacionais','Negociável', array['Comissões de vendas','Marketing','Brindes e doações']),
    ('2.05','Despesas administrativas','S','D','despesas_operacionais','Negociável', array['Contabilidade','Aluguel','Energia elétrica','Água','Internet e telefone','Material de expediente','Sistemas e software','Manutenção']),
    ('2.06','Despesas com logística','S','D','despesas_operacionais','Negociável', array['Fretes','Combustível','Manutenção de veículos','IPVA e licenciamento']),
    ('2.07','Despesas financeiras','S','D','despesas_financeiras','Obrigatório', array['Juros','Tarifas bancárias','IOF','Deságio de antecipação']),
    ('2.08','Tributos','S','D','tributos','Obrigatório', array['Simples Nacional / DAS','PIS e COFINS','ICMS','ISS','IRPJ e CSLL','Parcelamentos']),
    ('2.09','Investimentos','S','D','nao_operacionais','Negociável', array['Máquinas e equipamentos','Obras e instalações']),
    ('2.10','Retirada de sócios','S','D','nao_operacionais','Negociável', array['Pró-labore','Distribuição de lucros']),
    ('2.11','Outras saídas','S','D','despesas_operacionais','Negociável', array['Outras despesas']),
    ('2.12','Empréstimos','S','D','nao_operacionais','Obrigatório', array['Amortização de empréstimos']),
    ('2.13','Adiantamentos','S','D','capital_giro','Negociável', array['Adiantamento a fornecedores']),
    ('2.14','Não operacionais','S','D','nao_operacionais','Negociável', array['Despesas não operacionais']),
    ('3.01','Transferências (crédito)','T','C',null,null, array['Transferência entre contas']),
    ('3.02','Transferências (débito)','T','D',null,null, array['Transferência entre contas'])
  ) as t(codigo,nome,tipo,nat,dre,prio,filhos)
  loop
    insert into plano_contas(empresa_id,codigo,nome,tipo,natureza,nivel,dre_secao,prioridade)
      values (p_empresa, r.codigo, r.nome, r.tipo, r.nat, 1, r.dre, r.prio)
      on conflict (empresa_id,codigo) do nothing
      returning id into v_pai;
    if v_pai is not null then
      insert into plano_contas(empresa_id,codigo,nome,tipo,natureza,nivel,pai_id)
        select p_empresa, r.codigo || '.' || lpad(i::text,2,'0'), upper(r.filhos[i]), r.tipo, r.nat, 2, v_pai
        from generate_subscripts(r.filhos,1) i;
    end if;
  end loop;
end $$;

-- Adiciona um usuário já cadastrado (pelo e-mail) como membro da empresa
create or replace function public.adicionar_membro(p_empresa uuid, p_email text, p_papel public.papel_membro default 'financeiro')
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_uid uuid;
begin
  if not is_admin(p_empresa) then raise exception 'Apenas administradores podem adicionar membros'; end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then raise exception 'Usuário % não encontrado. Peça para ele criar a conta primeiro.', p_email; end if;
  insert into membros(empresa_id,user_id,papel) values (p_empresa, v_uid, p_papel)
    on conflict (empresa_id,user_id) do update set papel = excluded.papel;
end $$;

create or replace function public.listar_membros(p_empresa uuid)
returns table(user_id uuid, email text, papel public.papel_membro, created_at timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select m.user_id, u.email::text, m.papel, m.created_at
  from membros m join auth.users u on u.id = m.user_id
  where m.empresa_id = p_empresa and is_membro(p_empresa)
  order by m.created_at;
$$;

-- ---------------------------------------------------------------------
-- Filtro padrão dos relatórios (equivalente aos filtros C. Custo / Favorecido / Grupo / Conta / Disponibilidade)
-- ---------------------------------------------------------------------
create or replace function public._lanc_filtrados(
  p_empresa uuid, p_de date, p_ate date, p_status text[],
  p_conta uuid, p_grupo uuid, p_cc uuid, p_favorecido uuid, p_disp text)
returns table(id uuid, data date, plano_id uuid, classe_id uuid, valor_sinal numeric, status text, conta_id uuid)
language sql stable set search_path = public as $$
  select l.id, l.data, l.plano_id, p.pai_id,
         case when p.natureza = 'C' then l.valor else -l.valor end,
         l.status, l.conta_id
  from lancamentos l
  join plano_contas p on p.id = l.plano_id
  join contas ct on ct.id = l.conta_id
  where l.empresa_id = p_empresa
    and is_membro(p_empresa)
    and l.data between p_de and p_ate
    and l.status = any(p_status)
    and (p_conta is null or l.conta_id = p_conta)
    and (p_grupo is null or ct.grupo_id = p_grupo)
    and (p_cc is null or l.centro_custo_id = p_cc)
    and (p_favorecido is null or l.favorecido_id = p_favorecido)
    and (p_disp is null or ct.disponibilidade = p_disp);
$$;

-- Totais por conta do plano x mês (base do FC mensal, DRE e Orçado x Realizado)
create or replace function public.resumo_mensal(
  p_empresa uuid, p_ano int, p_status text[] default array['Pago'],
  p_conta uuid default null, p_grupo uuid default null, p_cc uuid default null,
  p_favorecido uuid default null, p_disp text default null)
returns table(plano_id uuid, classe_id uuid, mes int, total numeric, qtd bigint)
language sql stable set search_path = public as $$
  select plano_id, classe_id, extract(month from data)::int, sum(valor_sinal), count(*)
  from _lanc_filtrados(p_empresa, make_date(p_ano,1,1), make_date(p_ano,12,31), p_status,
                       p_conta, p_grupo, p_cc, p_favorecido, p_disp)
  group by 1,2,3;
$$;

-- Totais por dia x classificação (FC diário)
create or replace function public.resumo_diario(
  p_empresa uuid, p_ano int, p_mes int, p_status text[] default array['Pago'],
  p_conta uuid default null, p_grupo uuid default null, p_cc uuid default null,
  p_favorecido uuid default null, p_disp text default null)
returns table(dia date, classe_id uuid, total numeric)
language sql stable set search_path = public as $$
  select data, classe_id, sum(valor_sinal)
  from _lanc_filtrados(p_empresa, make_date(p_ano,p_mes,1),
                       (make_date(p_ano,p_mes,1) + interval '1 month - 1 day')::date, p_status,
                       p_conta, p_grupo, p_cc, p_favorecido, p_disp)
  group by 1,2;
$$;

-- Saldo de abertura de uma data (saldos iniciais das contas + movimentos anteriores)
create or replace function public.saldo_em(
  p_empresa uuid, p_data date, p_status text[] default array['Pago'],
  p_conta uuid default null, p_grupo uuid default null, p_cc uuid default null,
  p_favorecido uuid default null, p_disp text default null)
returns numeric language sql stable set search_path = public as $$
  select coalesce((select sum(ct.saldo_inicial + case when 'Em aberto' = any(p_status) then ct.saldo_inicial_aberto else 0 end)
                   from contas ct
                   where ct.empresa_id = p_empresa and is_membro(p_empresa)
                     and p_cc is null and p_favorecido is null
                     and (p_conta is null or ct.id = p_conta)
                     and (p_grupo is null or ct.grupo_id = p_grupo)
                     and (p_disp is null or ct.disponibilidade = p_disp)),0)
       + coalesce((select sum(valor_sinal)
                   from _lanc_filtrados(p_empresa, date '1900-01-01', p_data - 1, p_status,
                                        p_conta, p_grupo, p_cc, p_favorecido, p_disp)),0);
$$;

-- Saldos atuais por conta bancária (realizado e projetado)
create or replace function public.saldos_contas(p_empresa uuid, p_ate date default current_date)
returns table(conta_id uuid, nome text, grupo text, disponibilidade text, saldo_pago numeric, a_receber numeric, a_pagar numeric)
language sql stable set search_path = public as $$
  select ct.id, ct.nome, g.nome, ct.disponibilidade,
         ct.saldo_inicial + coalesce(sum(case when l.status='Pago' and l.data <= p_ate then
                                   case when p.natureza='C' then l.valor else -l.valor end end),0),
         coalesce(sum(case when l.status='Em aberto' and p.natureza='C' then l.valor end),0),
         coalesce(sum(case when l.status='Em aberto' and p.natureza='D' then l.valor end),0)
  from contas ct
  left join grupos g on g.id = ct.grupo_id
  left join lancamentos l on l.conta_id = ct.id
  left join plano_contas p on p.id = l.plano_id
  where ct.empresa_id = p_empresa and is_membro(p_empresa) and ct.ativo
  group by ct.id, ct.nome, g.nome, ct.disponibilidade, ct.saldo_inicial
  order by ct.codigo nulls last, ct.nome;
$$;

-- Baixa em lote (marca como Pago)
create or replace function public.baixar_lancamentos(p_ids uuid[], p_data date default null)
returns int language plpgsql set search_path = public as $$
declare n int;
begin
  update lancamentos set status = 'Pago', data = coalesce(p_data, data)
   where id = any(p_ids) and pode_editar(empresa_id);
  get diagnostics n = row_count;
  return n;
end $$;

-- Somente usuários autenticados executam as funções
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.aplicar_plano_modelo(uuid) from authenticated;
