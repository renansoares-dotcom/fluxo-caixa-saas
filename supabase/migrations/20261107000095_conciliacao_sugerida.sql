-- =====================================================================
-- Melhoria contínua 3.2 — Conciliação sugerida (07/11/2026)
--  • parâmetros da conciliação por empresa (conc_config): janelas de dias, faixas de confiança, pesos de cada critério,
--    prazo do alerta de extrato faltando e as contas dispensadas do alerta (tudo na tela Conciliação › Parâmetros);
--  • formato de cada importação de extrato (ofx, cnab240, erp, vexpenses) para o painel "Extratos por conta";
--  • conc_extratos_situacao: última importação, formato e movimentos pendentes de cada conta.
-- Migração ADITIVA: não altera extratos, lançamentos nem conciliações.
-- =====================================================================

create table if not exists public.conc_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  dias_exato int not null default 3 check (dias_exato between 0 and 15),        -- lançamento pago de mesmo valor: até N dias do extrato
  dias_baixa int not null default 7 check (dias_baixa between 0 and 30),        -- título em aberto de mesmo valor: até N dias
  conf_alta int not null default 85 check (conf_alta between 1 and 100),
  conf_media int not null default 60 check (conf_media between 0 and 100),
  pesos jsonb not null default '{}'::jsonb,                                     -- pontos de cada critério (vazio = padrão)
  alerta_dias int not null default 5 check (alerta_dias between 1 and 60),      -- conta sem extrato há mais de N dias = atrasada
  contas_sem_alerta uuid[] not null default '{}',                               -- contas que não exigem extrato (ex.: caixa)
  atualizado_por text default (auth.jwt() ->> 'email'),
  atualizado_em timestamptz not null default now(),
  check (conf_media < conf_alta)
);
alter table public.conc_config enable row level security;
drop policy if exists conc_config_sel on public.conc_config; drop policy if exists conc_config_ins on public.conc_config; drop policy if exists conc_config_upd on public.conc_config;
create policy conc_config_sel on public.conc_config for select to authenticated using (public.is_membro(empresa_id));
create policy conc_config_ins on public.conc_config for insert to authenticated with check (public.pode_editar(empresa_id));
create policy conc_config_upd on public.conc_config for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
grant select, insert, update on public.conc_config to authenticated;

alter table public.extrato_importacoes add column if not exists formato text;
-- importações antigas: o formato pelo identificador dos movimentos (erp:, vx:) ou OFX
update public.extrato_importacoes i set formato = coalesce((select case when x.fitid like 'erp:%' then 'erp' when x.fitid like 'vx:%' then 'vexpenses' when x.fitid like 'cnab:%' then 'cnab240' else 'ofx' end
                                                              from public.extrato_itens x where x.importacao_id = i.id limit 1), 'ofx')
 where i.formato is null;

-- situação dos extratos por conta (para o painel e para a Central de Decisões)
create or replace function public.conc_extratos_situacao(p_empresa uuid)
returns table(conta_id uuid, ultimo_fim date, ultima_importacao timestamptz, formato text, importacoes bigint, pendentes bigint, pendentes_valor numeric)
language sql stable security definer set search_path = public as $$
  select c.id, u.dt_fim, u.created_at, u.formato, (select count(*) from extrato_importacoes i where i.conta_id = c.id),
         (select count(*) from extrato_itens x where x.conta_id = c.id and x.status = 'pendente'),
         (select coalesce(sum(x.valor), 0) from extrato_itens x where x.conta_id = c.id and x.status = 'pendente')
    from contas c
    left join lateral (select i.dt_fim, i.created_at, i.formato from extrato_importacoes i where i.conta_id = c.id order by i.dt_fim desc nulls last, i.created_at desc limit 1) u on true
   where c.empresa_id = p_empresa and is_membro(p_empresa) and coalesce(c.ativo, true);
$$;
revoke all on function public.conc_extratos_situacao(uuid) from public, anon;
grant execute on function public.conc_extratos_situacao(uuid) to authenticated;

-- conferência: tabela = 1, coluna = 1
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'conc_config') as tabela,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'extrato_importacoes' and column_name = 'formato') as coluna;
