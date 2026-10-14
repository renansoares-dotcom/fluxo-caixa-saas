-- =====================================================================
-- Contabilidade — etapas 2 e 3: de-para e motor de partidas dobradas (fatos financeiros)
--  - rodar DEPOIS da 20261014000034_contabilidade_base.sql
--  - só cria tabelas/funções novas; NÃO altera lançamentos, contas, favorecidos nem conciliações
--  - os lançamentos contábeis gerados podem ser apagados e gerados de novo a qualquer momento
-- =====================================================================

-- 1) de-para: classificação gerencial → conta contábil da contrapartida
create table if not exists public.contab_depara_plano (
  plano_id uuid primary key references public.plano_contas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conta_id uuid references public.contab_contas(id) on delete restrict,      -- conta usada quando não há conta do favorecido
  tratamento text not null check (tratamento in ('resultado','fornecedor','cliente','obrigacao','ativo','financiamento','transferencia')),
  papel text check (papel in ('cliente','fornecedor','adiant_fornecedor','adiant_cliente','outras_obrig')), -- usa a conta do favorecido neste papel
  observacao text,
  atualizado_por text default (auth.jwt() ->> 'email'),
  atualizado_em timestamptz not null default now()
);
create index if not exists contab_depara_plano_emp on public.contab_depara_plano(empresa_id);

-- conta bancária da plataforma → conta contábil (e a conta para saldo negativo, ex.: cheque especial)
create table if not exists public.contab_depara_conta (
  conta_bancaria_id uuid primary key references public.contas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conta_id uuid not null references public.contab_contas(id) on delete restrict,
  conta_negativa_id uuid references public.contab_contas(id) on delete restrict,
  observacao text,
  atualizado_por text default (auth.jwt() ->> 'email'),
  atualizado_em timestamptz not null default now()
);

-- beneficiário → conta própria na contabilidade (cliente, fornecedor, adiantamentos…)
create table if not exists public.contab_depara_favorecido (
  favorecido_id uuid not null references public.favorecidos(id) on delete cascade,
  papel text not null check (papel in ('cliente','fornecedor','adiant_fornecedor','adiant_cliente','outras_obrig')),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conta_id uuid not null references public.contab_contas(id) on delete restrict,
  atualizado_por text default (auth.jwt() ->> 'email'),
  atualizado_em timestamptz not null default now(),
  primary key (favorecido_id, papel)
);
create index if not exists contab_depara_fav_emp on public.contab_depara_favorecido(empresa_id);

-- 2) lançamentos contábeis (partidas dobradas)
create table if not exists public.contab_lancamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  data date not null,
  historico text,
  origem text not null check (origem in ('financeiro','nota','fidc','folha','apuracao','depreciacao','estoque','manual')),
  origem_id uuid,                               -- ex.: id do lançamento financeiro que gerou
  gerado_por text default (auth.jwt() ->> 'email'),
  gerado_em timestamptz not null default now()
);
create index if not exists contab_lanc_emp_data on public.contab_lancamentos(empresa_id, data);
create index if not exists contab_lanc_origem on public.contab_lancamentos(origem, origem_id);

create table if not exists public.contab_partidas (
  id bigserial primary key,
  lancamento_id uuid not null references public.contab_lancamentos(id) on delete cascade,
  conta_id uuid not null references public.contab_contas(id) on delete restrict,
  debito numeric(16,2) not null default 0,
  credito numeric(16,2) not null default 0,
  check (debito >= 0 and credito >= 0 and (debito = 0 or credito = 0) and debito + credito > 0)
);
create index if not exists contab_partidas_lanc on public.contab_partidas(lancamento_id);
create index if not exists contab_partidas_conta on public.contab_partidas(conta_id);

-- todo lançamento contábil fecha (débitos = créditos), conferido no fim da transação
create or replace function public._contab_partidas_fecham() returns trigger
language plpgsql set search_path = public as $$
declare v_id uuid := coalesce(new.lancamento_id, old.lancamento_id); v numeric;
begin
  if not exists (select 1 from contab_lancamentos where id = v_id) then return null; end if;
  select coalesce(sum(debito - credito), 0) into v from contab_partidas where lancamento_id = v_id;
  if abs(v) > 0.005 then raise exception 'Lançamento contábil % não fecha: débitos − créditos = %', v_id, v; end if;
  return null;
end $$;
drop trigger if exists contab_partidas_fecham on public.contab_partidas;
create constraint trigger contab_partidas_fecham after insert or update or delete on public.contab_partidas
  deferrable initially deferred for each row execute function public._contab_partidas_fecham();

-- RLS
alter table public.contab_depara_plano enable row level security;
alter table public.contab_depara_conta enable row level security;
alter table public.contab_depara_favorecido enable row level security;
alter table public.contab_lancamentos enable row level security;
alter table public.contab_partidas enable row level security;
do $$ declare t text; begin
  foreach t in array array['contab_depara_plano','contab_depara_conta','contab_depara_favorecido'] loop
    execute format('drop policy if exists %1$s_sel on public.%1$s; drop policy if exists %1$s_ins on public.%1$s; drop policy if exists %1$s_upd on public.%1$s; drop policy if exists %1$s_del on public.%1$s;', t);
    execute format('create policy %1$s_sel on public.%1$s for select to authenticated using (public.is_membro(empresa_id));', t);
    execute format('create policy %1$s_ins on public.%1$s for insert to authenticated with check (public.pode_editar(empresa_id));', t);
    execute format('create policy %1$s_upd on public.%1$s for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));', t);
    execute format('create policy %1$s_del on public.%1$s for delete to authenticated using (public.pode_editar(empresa_id));', t);
    execute format('grant select, insert, update, delete on public.%1$s to authenticated;', t);
  end loop;
end $$;
drop policy if exists contab_lanc_sel on public.contab_lancamentos;
drop policy if exists contab_part_sel on public.contab_partidas;
create policy contab_lanc_sel on public.contab_lancamentos for select to authenticated using (public.is_membro(empresa_id));
create policy contab_part_sel on public.contab_partidas for select to authenticated
  using (exists (select 1 from public.contab_lancamentos l where l.id = lancamento_id and public.is_membro(l.empresa_id)));
grant select on public.contab_lancamentos, public.contab_partidas to authenticated;

-- a conta do de-para tem de ser da mesma empresa
create or replace function public._contab_depara_mesma_empresa() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.conta_id is not null and not exists (select 1 from contab_contas where id = new.conta_id and empresa_id = new.empresa_id) then
    raise exception 'Conta contábil de outra empresa.'; end if;
  if tg_table_name = 'contab_depara_conta' then
    if (to_jsonb(new) ->> 'conta_negativa_id') is not null
       and not exists (select 1 from contab_contas where id = (to_jsonb(new) ->> 'conta_negativa_id')::uuid and empresa_id = new.empresa_id) then
      raise exception 'Conta contábil de outra empresa.'; end if;
  end if;
  new.atualizado_por := auth.jwt() ->> 'email'; new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists contab_depara_plano_emp on public.contab_depara_plano;
drop trigger if exists contab_depara_conta_emp on public.contab_depara_conta;
drop trigger if exists contab_depara_fav_emp on public.contab_depara_favorecido;
create trigger contab_depara_plano_emp before insert or update on public.contab_depara_plano for each row execute function public._contab_depara_mesma_empresa();
create trigger contab_depara_conta_emp before insert or update on public.contab_depara_conta for each row execute function public._contab_depara_mesma_empresa();
create trigger contab_depara_fav_emp before insert or update on public.contab_depara_favorecido for each row execute function public._contab_depara_mesma_empresa();

-- 3) motor: lançamentos financeiros PAGOS do período → partidas dobradas
--    entrada (classificação C): D banco / C contrapartida ; saída (D): D contrapartida / C banco
--    transferência única: D banco de destino / C banco de origem
--    o que não tiver de-para não é gerado e volta como pendência (com o motivo)
create or replace function public.gerar_contabil_financeiro(p_empresa uuid, p_ini date, p_fim date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_apag int; v_lanc int; v_pend jsonb;
begin
  if not public.pode_editar(p_empresa) then raise exception 'Sem permissão.'; end if;
  if p_fim < p_ini or p_fim - p_ini > 400 then raise exception 'Período inválido.'; end if;

  drop table if exists _cf;
  create temp table _cf on commit drop as
  select l.id, l.data, l.valor, l.descricao, p.codigo || ' ' || p.nome as classif, p.natureza, p.tipo as ptipo,
         dc.conta_id as banco, dd.conta_id as banco_dest, l.conta_destino_id,
         case when l.conta_destino_id is not null then null
              else coalesce(df.conta_id, dp.conta_id) end as contra,
         dp.plano_id is not null as tem_depara, dp.tratamento,
         case
           when dc.conta_id is null then 'Conta bancária sem conta contábil'
           when l.conta_destino_id is not null and dd.conta_id is null then 'Conta de destino sem conta contábil'
           when l.conta_destino_id is null and p.tipo = 'T' then 'Transferência sem conta de destino (ponta antiga)'
           when l.conta_destino_id is null and dp.plano_id is null then 'Classificação sem de-para'
           when l.conta_destino_id is null and coalesce(df.conta_id, dp.conta_id) is null then 'Beneficiário sem conta contábil'
         end as motivo
    from lancamentos l
    join plano_contas p on p.id = l.plano_id
    left join contab_depara_conta dc on dc.conta_bancaria_id = l.conta_id
    left join contab_depara_conta dd on dd.conta_bancaria_id = l.conta_destino_id
    left join contab_depara_plano dp on dp.plano_id = l.plano_id
    left join contab_depara_favorecido df on df.favorecido_id = l.favorecido_id and df.papel = dp.papel
   where l.empresa_id = p_empresa and l.status = 'Pago' and l.data between p_ini and p_fim and l.valor <> 0;

  delete from contab_lancamentos where empresa_id = p_empresa and origem = 'financeiro' and data between p_ini and p_fim;
  get diagnostics v_apag = row_count;

  insert into contab_lancamentos(empresa_id, data, historico, origem, origem_id)
    select p_empresa, data, left(coalesce(descricao, '') || ' [' || classif || ']', 300), 'financeiro', id from _cf where motivo is null;
  get diagnostics v_lanc = row_count;

  insert into contab_partidas(lancamento_id, conta_id, debito, credito)
  select cl.id, x.conta, x.d, x.c
    from _cf f join contab_lancamentos cl on cl.origem = 'financeiro' and cl.origem_id = f.id and cl.empresa_id = p_empresa,
    lateral (values
      -- débito
      (case when f.conta_destino_id is not null then f.banco_dest when f.natureza = 'C' then f.banco else f.contra end, abs(f.valor), 0::numeric),
      -- crédito
      (case when f.conta_destino_id is not null then f.banco when f.natureza = 'C' then f.contra else f.banco end, 0::numeric, abs(f.valor))
    ) as x(conta, d, c)
   where f.motivo is null;

  select coalesce(jsonb_agg(jsonb_build_object('motivo', motivo, 'qtd', qtd, 'valor', valor, 'exemplos', ex) order by qtd desc), '[]'::jsonb) into v_pend
    from (select motivo, count(*) qtd, round(sum(abs(valor)), 2) valor,
                 (select jsonb_agg(jsonb_build_object('id', id, 'data', data, 'valor', valor, 'classif', classif, 'descricao', descricao))
                    from (select * from _cf g where g.motivo = f.motivo order by abs(valor) desc limit 30) s) ex
            from _cf f where motivo is not null group by motivo) t;

  return jsonb_build_object('apagados', v_apag, 'gerados', v_lanc, 'pendentes', (select count(*) from _cf where motivo is not null), 'pendencias', v_pend);
end $$;
revoke all on function public.gerar_contabil_financeiro(uuid, date, date) from public, anon;
grant execute on function public.gerar_contabil_financeiro(uuid, date, date) to authenticated;

-- 4) balancete gerencial (feito pela plataforma) das contas analíticas, a partir do saldo de abertura
--    saldo com sinal: devedor +, credor −
create or replace function public.contab_balancete_gerencial(p_empresa uuid, p_ini date, p_fim date)
returns table(conta_id uuid, saldo_anterior numeric, debito numeric, credito numeric, saldo_atual numeric)
language sql stable security definer set search_path = public as $$
  with ab as (
    select max(data) d from contab_saldos_abertura where empresa_id = p_empresa and data < p_ini
  ), mov as (
    select pt.conta_id,
           sum(case when l.data < p_ini then pt.debito - pt.credito else 0 end) antes,
           sum(case when l.data >= p_ini then pt.debito else 0 end) deb,
           sum(case when l.data >= p_ini then pt.credito else 0 end) cred
      from contab_partidas pt join contab_lancamentos l on l.id = pt.lancamento_id, ab
     where l.empresa_id = p_empresa and l.data > ab.d and l.data <= p_fim
     group by pt.conta_id
  ), abert as (
    select s.conta_id, s.saldo from contab_saldos_abertura s, ab where s.empresa_id = p_empresa and s.data = ab.d
  )
  select c.id, round(coalesce(a.saldo, 0) + coalesce(m.antes, 0), 2), round(coalesce(m.deb, 0), 2), round(coalesce(m.cred, 0), 2),
         round(coalesce(a.saldo, 0) + coalesce(m.antes, 0) + coalesce(m.deb, 0) - coalesce(m.cred, 0), 2)
    from contab_contas c left join abert a on a.conta_id = c.id left join mov m on m.conta_id = c.id
   where c.empresa_id = p_empresa and public.is_membro(p_empresa) and (a.conta_id is not null or m.conta_id is not null)
     and (select d from ab) is not null;
$$;
revoke all on function public.contab_balancete_gerencial(uuid, date, date) from public, anon;
grant execute on function public.contab_balancete_gerencial(uuid, date, date) to authenticated;
