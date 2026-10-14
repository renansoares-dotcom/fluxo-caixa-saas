-- =====================================================================
-- Transferência em um único lançamento
--  - o lançamento de transferência passa a ter conta de ORIGEM (conta_id) e conta de DESTINO (conta_destino_id)
--  - usa o plano de saída (3.02.xx): na origem conta como saída; no destino, como entrada no plano de contrapartida (3.01.xx)
--  - todos os cálculos (saldos, fluxo mensal/diário, DRE, saldo de abertura) passam a contar as duas pontas
--  - a conciliação aceita uma linha de extrato em cada conta para o mesmo lançamento
--  - a trava vale para as duas contas
-- Enquanto nenhum lançamento tiver conta de destino, NADA muda nos números: as transferências antigas (duas pontas)
-- continuam funcionando como hoje.
-- =====================================================================

-- 1) coluna nova
alter table public.lancamentos add column if not exists conta_destino_id uuid references public.contas(id) on delete restrict;
alter table public.lancamentos drop constraint if exists lanc_destino_diferente;
alter table public.lancamentos add constraint lanc_destino_diferente check (conta_destino_id is null or conta_destino_id <> conta_id);
create index if not exists lancamentos_destino on public.lancamentos(conta_destino_id, data) where conta_destino_id is not null;

-- 2) plano de contrapartida: 3.02.xx (saída) ↔ 3.01.xx (entrada), pelo final do código
alter table public.plano_contas add column if not exists contrapartida_id uuid references public.plano_contas(id) on delete set null;
update public.plano_contas d set contrapartida_id = c.id
  from public.plano_contas c
 where d.tipo = 'T' and c.tipo = 'T' and c.empresa_id = d.empresa_id and d.nivel = 2 and c.nivel = 2
   and d.natureza <> c.natureza and split_part(d.codigo, '.', 3) = split_part(c.codigo, '.', 3)
   and split_part(d.codigo, '.', 3) <> '' and d.contrapartida_id is null;

-- 3) pontas: cada lançamento é uma ponta na sua conta; a transferência única gera a segunda ponta no destino
create or replace view public.v_lanc_pontas with (security_invoker = on) as
  select l.id, l.empresa_id, l.data, l.status, l.conta_id, l.plano_id, l.centro_custo_id, l.favorecido_id,
         case when p.natureza = 'C' then l.valor else -l.valor end as valor_sinal, false as destino
    from public.lancamentos l join public.plano_contas p on p.id = l.plano_id
  union all
  select l.id, l.empresa_id, l.data, l.status, l.conta_destino_id, coalesce(p.contrapartida_id, l.plano_id), l.centro_custo_id, l.favorecido_id,
         l.valor, true
    from public.lancamentos l join public.plano_contas p on p.id = l.plano_id
   where l.conta_destino_id is not null;
grant select on public.v_lanc_pontas to authenticated;

-- 4) base de todos os relatórios (resumo_mensal, resumo_diario, saldo_em): agora pelas pontas
create or replace function public._lanc_filtrados(p_empresa uuid, p_de date, p_ate date, p_status text[], p_conta uuid, p_grupo uuid, p_cc uuid, p_favorecido uuid, p_disp text)
returns table(id uuid, data date, plano_id uuid, classe_id uuid, valor_sinal numeric, status text, conta_id uuid)
language sql stable set search_path = public as $$
  select v.id, v.data, v.plano_id, p.pai_id, v.valor_sinal, v.status, v.conta_id
  from v_lanc_pontas v
  join plano_contas p on p.id = v.plano_id
  join contas ct on ct.id = v.conta_id
  where v.empresa_id = p_empresa
    and is_membro(p_empresa)
    and v.data between p_de and p_ate
    and v.status = any(p_status)
    and (p_conta is null or v.conta_id = p_conta)
    and (p_grupo is null or ct.grupo_id = p_grupo)
    and (p_cc is null or v.centro_custo_id = p_cc)
    and (p_favorecido is null or v.favorecido_id = p_favorecido)
    and (p_disp is null or ct.disponibilidade = p_disp);
$$;

-- 5) saldos por conta: pelas pontas
create or replace function public.saldos_contas(p_empresa uuid, p_ate date default current_date)
returns table(conta_id uuid, nome text, grupo text, disponibilidade text, saldo_pago numeric, a_receber numeric, a_pagar numeric)
language sql stable set search_path = public as $$
  select ct.id, ct.nome, g.nome, ct.disponibilidade,
         ct.saldo_inicial + coalesce(sum(case when v.status = 'Pago' and v.data <= p_ate then v.valor_sinal end), 0),
         coalesce(sum(case when v.status = 'Em aberto' and v.valor_sinal > 0 then v.valor_sinal end), 0),
         coalesce(sum(case when v.status = 'Em aberto' and v.valor_sinal < 0 then -v.valor_sinal end), 0)
  from contas ct
  left join grupos g on g.id = ct.grupo_id
  left join v_lanc_pontas v on v.conta_id = ct.id
  where ct.empresa_id = p_empresa and is_membro(p_empresa) and ct.ativo
  group by ct.id, ct.nome, g.nome, ct.disponibilidade, ct.saldo_inicial
  order by ct.codigo nulls last, ct.nome;
$$;

-- 6) lista de lançamentos: mostra também a conta de destino (colunas novas no fim)
create or replace view public.v_lancamentos with (security_invoker = on) as
 SELECT l.id, l.empresa_id, l.data, l.plano_id, l.descricao, l.opc1, l.opc2, l.opc3, l.opc4, l.favorecido_id, l.centro_custo_id,
    l.status, l.conta_id, l.valor, l.prioridade, l.origem, l.created_by, l.created_at, l.updated_at,
    (EXTRACT(year FROM l.data))::integer AS ano,
    (EXTRACT(month FROM l.data))::integer AS mes,
    CASE WHEN (p.natureza = 'C'::bpchar) THEN l.valor ELSE (- l.valor) END AS valor_sinal,
    p.codigo AS plano_codigo, p.nome AS plano_nome, p.tipo,
    c1.id AS classe_id, c1.codigo AS classe_codigo, c1.nome AS classe_nome,
    COALESCE(c1.prioridade, 'Negociável'::text) AS prioridade_classe,
    COALESCE(l.prioridade, c1.prioridade, 'Negociável'::text) AS prioridade_efetiva,
    f.nome AS favorecido_nome, f.sigla AS favorecido_sigla,
    cc.nome AS centro_custo_nome, ct.nome AS conta_nome, ct.grupo_id, ct.disponibilidade, g.nome AS grupo_nome,
    l.documento, l.emissao, l.fidc_proposta_id,
    l.conta_destino_id, cd.nome AS conta_destino_nome
   FROM lancamentos l
     JOIN plano_contas p ON p.id = l.plano_id
     LEFT JOIN plano_contas c1 ON c1.id = p.pai_id
     LEFT JOIN favorecidos f ON f.id = l.favorecido_id
     LEFT JOIN centros_custo cc ON cc.id = l.centro_custo_id
     LEFT JOIN contas ct ON ct.id = l.conta_id
     LEFT JOIN contas cd ON cd.id = l.conta_destino_id
     LEFT JOIN grupos g ON g.id = ct.grupo_id;

-- 7) validação: destino da mesma empresa, só em transferência (plano de saída 3.02)
create or replace function public.tg_lanc_mesma_empresa() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from plano_contas where id = new.plano_id and empresa_id = new.empresa_id and nivel = 2) then
    raise exception 'Plano de contas inválido para esta empresa (use uma conta de nível 2)';
  end if;
  if new.conta_id is not null and not exists (select 1 from contas where id = new.conta_id and empresa_id = new.empresa_id) then
    raise exception 'Conta bancária inválida para esta empresa';
  end if;
  if new.conta_destino_id is not null then
    if not exists (select 1 from contas where id = new.conta_destino_id and empresa_id = new.empresa_id) then
      raise exception 'Conta de destino inválida para esta empresa';
    end if;
    if new.conta_id is null then raise exception 'Transferência precisa da conta de origem'; end if;
    if not exists (select 1 from plano_contas where id = new.plano_id and tipo = 'T' and natureza = 'D') then
      raise exception 'Conta de destino só vale para transferência (plano de transferência de saída, 3.02)';
    end if;
  end if;
  if new.favorecido_id is not null and not exists (select 1 from favorecidos where id = new.favorecido_id and empresa_id = new.empresa_id) then
    raise exception 'Favorecido inválido para esta empresa';
  end if;
  if new.centro_custo_id is not null and not exists (select 1 from centros_custo where id = new.centro_custo_id and empresa_id = new.empresa_id) then
    raise exception 'Centro de custo inválido para esta empresa';
  end if;
  return new;
end $$;

-- 8) trava: vale para a conta de origem e para a de destino
create or replace function public._trava_lancamentos() returns trigger
language plpgsql security definer set search_path = public as $$
declare t_old date; t_new date; nat_old text; nat_new text; nm text; td_old date; td_new date;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'Pago' then
    if old.conta_id is not null then t_old := trava_ate(old.conta_id); end if;
    if old.conta_destino_id is not null then td_old := trava_ate(old.conta_destino_id); end if;
    if td_old is not null and (t_old is null or td_old > t_old) then t_old := td_old; end if;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.status = 'Pago' then
    if new.conta_id is not null then t_new := trava_ate(new.conta_id); end if;
    if new.conta_destino_id is not null then td_new := trava_ate(new.conta_destino_id); end if;
    if td_new is not null and (t_new is null or td_new > t_new) then t_new := td_new; end if;
  end if;
  if tg_op = 'DELETE' then
    if t_old is not null and old.data <= t_old then
      raise exception 'Conta travada até %: não é possível excluir o lançamento de %.', to_char(t_old, 'DD/MM/YYYY'), to_char(old.data, 'DD/MM/YYYY');
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and t_old is not null and old.data <= t_old then
    if new.data is distinct from old.data or new.valor is distinct from old.valor or new.conta_id is distinct from old.conta_id
       or new.status is distinct from old.status or new.conta_destino_id is distinct from old.conta_destino_id then
      select nome into nm from contas where id = old.conta_id;
      raise exception 'A conta % (ou a de destino) está travada até %: data, valor, contas e situação dos lançamentos até essa data não podem mudar (classificação, descrição e centro de custo podem).', nm, to_char(t_old, 'DD/MM/YYYY');
    end if;
    if new.plano_id is distinct from old.plano_id then
      select natureza into nat_old from plano_contas where id = old.plano_id;
      select natureza into nat_new from plano_contas where id = new.plano_id;
      if nat_old is distinct from nat_new then
        select nome into nm from contas where id = old.conta_id;
        raise exception 'A conta % está travada até %: a nova classificação é de natureza diferente (entrada × saída) e mudaria o saldo.', nm, to_char(t_old, 'DD/MM/YYYY');
      end if;
    end if;
    return new;
  end if;
  if t_new is not null and new.data <= t_new then
    raise exception 'Conta travada até %: não é possível lançar ou baixar lançamento com data de % nela.', to_char(t_new, 'DD/MM/YYYY'), to_char(new.data, 'DD/MM/YYYY');
  end if;
  return new;
end $$;

-- 9) conciliação: o mesmo lançamento pode ser conciliado uma vez em cada conta (origem e destino)
alter table public.conciliacoes drop constraint if exists conciliacoes_lancamento_id_key;
create unique index if not exists conciliacoes_lanc_conta on public.conciliacoes(lancamento_id, conta_id);

-- lançamento conciliado: a conta de destino também fica protegida
create or replace function public.tg_lanc_conciliado() returns trigger
language plpgsql set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return coalesce(new, old); end if;
  if not exists (select 1 from conciliacoes c where c.lancamento_id = old.id) then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    raise exception 'Lançamento conciliado com o extrato bancário: desfaça a conciliação antes de excluir';
  end if;
  if (new.data, new.valor, new.plano_id, new.conta_id, new.conta_destino_id, new.status, new.favorecido_id, new.centro_custo_id, new.prioridade, new.documento, new.emissao, new.empresa_id)
     is distinct from
     (old.data, old.valor, old.plano_id, old.conta_id, old.conta_destino_id, old.status, old.favorecido_id, old.centro_custo_id, old.prioridade, old.documento, old.emissao, old.empresa_id) then
    raise exception 'Lançamento conciliado com o extrato bancário: só a descrição e os opcionais podem ser alterados';
  end if;
  return new;
end $$;
