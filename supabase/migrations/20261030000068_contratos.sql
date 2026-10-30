-- =====================================================================
-- Contratos — Etapa 2, parte 1 (30/10/2026; Renan: acesso só de administradores; reajuste proposto e aprovado; entrega em duas partes).
--  - contratos: cadastro (parte, tipo, valor, periodicidade, vigência, renovação, aviso prévio, índice e data-base do reajuste)
--  - contrato_arquivos: PDF assinado (gov.br), aditivos e outros documentos, no espaço privado "contratos"
--  - contrato_reajustes: reajuste proposto → aprovado/recusado; só o aprovado muda o valor e as parcelas futuras
--  - lancamentos.contrato_id: parcelas do contrato no fluxo (Em aberto, origem "contrato")
--  - contrato_gerar_parcelas(contrato, até): cria as parcelas que faltam, sem duplicar
--  - contrato_aprovar_reajuste(reajuste): aplica o novo valor no contrato e nas parcelas em aberto a partir da data-base
-- Quem acessa: só administradores da empresa. Migração ADITIVA; pode rodar mais de uma vez.
-- =====================================================================
create table if not exists public.contratos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  tipo text not null default 'servico' check (tipo in ('locacao_veiculo', 'locacao_veiculo_motorista', 'servico', 'transporte_tac', 'agregado',
                                                       'locacao_imovel', 'fornecimento', 'venda', 'confidencialidade', 'outro')),
  natureza text not null default 'pagar' check (natureza in ('pagar', 'receber', 'sem_valor')),
  objeto text not null,
  parte_tipo text not null default 'favorecido' check (parte_tipo in ('favorecido', 'transportador', 'colaborador', 'outro')),
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  transportador_id uuid references public.log_transportadores(id) on delete set null,
  colaborador_id uuid references public.rh_colaboradores(id) on delete set null,
  parte_nome text not null,
  parte_documento text,
  valor numeric(16,2) not null default 0 check (valor >= 0),
  periodicidade text not null default 'mensal' check (periodicidade in ('mensal', 'bimestral', 'trimestral', 'semestral', 'anual', 'unica', 'sem_valor')),
  dia_vencimento smallint check (dia_vencimento between 1 and 31),
  inicio date not null,
  fim date,                                        -- nulo = prazo indeterminado
  renovacao_automatica boolean not null default false,
  aviso_previo_dias smallint not null default 30 check (aviso_previo_dias between 0 and 365),
  indice text not null default 'IPCA' check (indice in ('IPCA', 'IGP-M', 'INPC', 'fixo', 'nenhum')),
  reajuste_fixo_pct numeric(7,4),                  -- quando o índice é "fixo"
  data_base date,                                  -- próxima data de reajuste
  plano_id uuid references public.plano_contas(id) on delete set null,
  centro_custo_id uuid references public.centros_custo(id) on delete set null,
  conta_id uuid references public.contas(id) on delete set null,
  responsavel text,
  status text not null default 'vigente' check (status in ('rascunho', 'vigente', 'encerrado', 'rescindido')),
  encerrado_em date, motivo_encerramento text,
  observacoes text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, numero),
  check (fim is null or fim >= inicio)
);
create index if not exists contratos_emp on public.contratos(empresa_id, status, fim);

-- número sequencial por empresa
create or replace function public.tg_contrato_numero() returns trigger language plpgsql as $$
begin
  if new.numero is null or new.numero = 0 then
    select coalesce(max(numero), 0) + 1 into new.numero from public.contratos where empresa_id = new.empresa_id;
  end if;
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists contratos_numero on public.contratos;
create trigger contratos_numero before insert or update on public.contratos for each row execute function public.tg_contrato_numero();

create table if not exists public.contrato_arquivos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  tipo text not null default 'assinado' check (tipo in ('assinado', 'aditivo', 'minuta', 'vistoria', 'outro')),
  nome text not null,
  path text not null,
  assinatura_digital boolean,                     -- o PDF tem assinatura digital (conferido ao enviar)
  descricao text,
  enviado_por uuid default auth.uid(),
  enviado_em timestamptz not null default now()
);
create index if not exists contrato_arquivos_ct on public.contrato_arquivos(contrato_id);

create table if not exists public.contrato_reajustes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  data_base date not null,
  indice text not null,
  percentual numeric(8,4) not null,
  valor_anterior numeric(16,2) not null,
  valor_novo numeric(16,2) not null,
  fonte text,                                      -- ex.: "BCB SGS 433 — 12 meses até 09/2026" ou "informado"
  status text not null default 'proposto' check (status in ('proposto', 'aprovado', 'recusado')),
  proposto_por uuid default auth.uid(), proposto_em timestamptz not null default now(),
  decidido_por uuid, decidido_em timestamptz, observacao text,
  unique (contrato_id, data_base)
);

alter table public.lancamentos add column if not exists contrato_id uuid references public.contratos(id) on delete set null;
create index if not exists lancamentos_contrato on public.lancamentos(contrato_id) where contrato_id is not null;

-- acesso: só administradores
alter table public.contratos enable row level security;
alter table public.contrato_arquivos enable row level security;
alter table public.contrato_reajustes enable row level security;
do $$ declare t text; begin
  foreach t in array array['contratos', 'contrato_arquivos', 'contrato_reajustes'] loop
    execute format('drop policy if exists %1$s_adm on public.%1$s', t);
    execute format('create policy %1$s_adm on public.%1$s for all to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id))', t);
    execute format('grant select, insert, update, delete on public.%s to authenticated', t);
  end loop;
end $$;

-- datas das parcelas de um contrato
create or replace function public._contrato_meses(p text) returns int language sql immutable as $$
  select case p when 'mensal' then 1 when 'bimestral' then 2 when 'trimestral' then 3 when 'semestral' then 6 when 'anual' then 12 else 0 end
$$;

-- cria as parcelas que faltam até p_ate (padrão: 12 meses à frente), sem duplicar as que já existem
create or replace function public.contrato_gerar_parcelas(p_contrato uuid, p_ate date default null)
returns int language plpgsql security definer set search_path = public as $$
declare c contratos; m int; d date; ate date; n int := 0; k int := 0; dv date;
begin
  select * into c from contratos where id = p_contrato;
  if c.id is null then raise exception 'Contrato não encontrado.'; end if;
  if not is_admin(c.empresa_id) then raise exception 'Só administradores podem gerar parcelas de contratos.'; end if;
  if c.natureza = 'sem_valor' or c.periodicidade = 'sem_valor' or c.valor <= 0 then return 0; end if;
  if c.plano_id is null then raise exception 'Informe a conta do plano no contrato para gerar as parcelas.'; end if;
  if c.status <> 'vigente' then raise exception 'Só contratos vigentes geram parcelas.'; end if;
  ate := least(coalesce(p_ate, (current_date + interval '12 months')::date), coalesce(c.fim, '9999-12-31'::date));
  m := _contrato_meses(c.periodicidade);
  loop
    if m = 0 then d := c.inicio; else d := (c.inicio + make_interval(months => k * m))::date; end if;
    exit when d > ate;
    -- dia de vencimento (respeitando o fim do mês)
    dv := case when c.dia_vencimento is null then d
               else (date_trunc('month', d) + make_interval(days => least(c.dia_vencimento, extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int) - 1))::date end;
    if not exists (select 1 from lancamentos where contrato_id = c.id and date_trunc('month', data) = date_trunc('month', dv)) then
      insert into lancamentos (empresa_id, data, plano_id, centro_custo_id, conta_id, favorecido_id, valor, status, descricao, documento, origem, contrato_id)
      values (c.empresa_id, dv, c.plano_id, c.centro_custo_id, c.conta_id, c.favorecido_id, c.valor, 'Em aberto',
              left(format('Contrato nº %s — %s — %s', c.numero, c.parte_nome, c.objeto), 250), 'CT ' || c.numero, 'contrato', c.id);
      n := n + 1;
    end if;
    exit when m = 0;
    k := k + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.contrato_gerar_parcelas(uuid, date) from public, anon;
grant execute on function public.contrato_gerar_parcelas(uuid, date) to authenticated, service_role;

-- aprova (ou recusa) um reajuste proposto
create or replace function public.contrato_decidir_reajuste(p_reajuste uuid, p_aprovar boolean, p_obs text default null)
returns contrato_reajustes language plpgsql security definer set search_path = public as $$
declare r contrato_reajustes; c contratos;
begin
  select * into r from contrato_reajustes where id = p_reajuste for update;
  if r.id is null then raise exception 'Reajuste não encontrado.'; end if;
  if not is_admin(r.empresa_id) then raise exception 'Só administradores decidem reajustes.'; end if;
  if r.status <> 'proposto' then raise exception 'Este reajuste já foi decidido.'; end if;
  update contrato_reajustes set status = case when p_aprovar then 'aprovado' else 'recusado' end, decidido_por = auth.uid(), decidido_em = now(), observacao = p_obs
   where id = r.id returning * into r;
  select * into c from contratos where id = r.contrato_id;
  if p_aprovar then
    update contratos set valor = r.valor_novo where id = c.id;
    update lancamentos set valor = r.valor_novo where contrato_id = c.id and status = 'Em aberto' and data >= r.data_base;
  end if;
  -- próxima data-base: um ano depois (aprovado ou recusado)
  update contratos set data_base = (r.data_base + interval '1 year')::date where id = c.id and (data_base is null or data_base <= r.data_base);
  return r;
end $$;
revoke execute on function public.contrato_decidir_reajuste(uuid, boolean, text) from public, anon;
grant execute on function public.contrato_decidir_reajuste(uuid, boolean, text) to authenticated, service_role;

-- arquivos: contratos/<empresa>/<contrato>/<arquivo> (privado; só administradores)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contratos', 'contratos', false, 15728640, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists contratos_arq_sel on storage.objects;
drop policy if exists contratos_arq_ins on storage.objects;
drop policy if exists contratos_arq_upd on storage.objects;
drop policy if exists contratos_arq_del on storage.objects;
create policy contratos_arq_sel on storage.objects for select to authenticated using (bucket_id = 'contratos' and public.is_admin(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy contratos_arq_ins on storage.objects for insert to authenticated with check (bucket_id = 'contratos' and public.is_admin(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy contratos_arq_upd on storage.objects for update to authenticated using (bucket_id = 'contratos' and public.is_admin(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy contratos_arq_del on storage.objects for delete to authenticated using (bucket_id = 'contratos' and public.is_admin(public._uuid_ou_nulo((storage.foldername(name))[1])));

-- auditoria
do $$ begin
  if to_regprocedure('public._auditar()') is not null then
    drop trigger if exists zz_auditoria on public.contratos;
    create trigger zz_auditoria after insert or update or delete on public.contratos for each row execute function public._auditar();
    drop trigger if exists zz_auditoria on public.contrato_reajustes;
    create trigger zz_auditoria after insert or update or delete on public.contrato_reajustes for each row execute function public._auditar();
  end if;
end $$;

-- conferência: tabelas = 3, coluna = 1, funcoes = 3, bucket = 1
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('contratos', 'contrato_arquivos', 'contrato_reajustes')) as tabelas,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'lancamentos' and column_name = 'contrato_id') as coluna,
       (select count(*) from pg_proc where proname in ('contrato_gerar_parcelas', 'contrato_decidir_reajuste', '_contrato_meses')) as funcoes,
       (select count(*) from storage.buckets where id = 'contratos') as bucket;
