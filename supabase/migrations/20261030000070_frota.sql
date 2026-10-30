-- =====================================================================
-- Gestão da frota e motoristas — Etapa 3 (30/10/2026; Renan: abastecimento digitado; manutenção e multas geram
-- lançamento no fluxo; acesso de quem edita a logística: admin, financeiro e diretor).
--  - log_veiculos: identificação (RENAVAM, chassi, modelo, ano), propriedade (próprio/locado/agregado → contrato) e km atual
--  - frota_documentos: CRLV/licenciamento, IPVA, seguro, tacógrafo, AET… com validade e arquivo
--  - frota_planos: manutenção preventiva por km e/ou meses
--  - frota_manutencoes: preventivas e corretivas (oficina, itens, valor, lançamento no fluxo)
--  - frota_abastecimentos: data, km, litros, valor, posto (consumo km/l e custo/km)
--  - frota_motoristas: CNH, toxicológico, MOPP, termo de responsabilidade (ligado ao colaborador do RH)
--  - frota_multas: auto de infração, prazo para indicar condutor, situação, desconto em folha, lançamento no fluxo
--  - espaço de arquivos "frota" (privado): <empresa>/<…>
-- Migração ADITIVA; pode rodar mais de uma vez.
-- =====================================================================
alter table public.log_veiculos add column if not exists renavam text;
alter table public.log_veiculos add column if not exists chassi text;
alter table public.log_veiculos add column if not exists marca_modelo text;
alter table public.log_veiculos add column if not exists ano_fab smallint;
alter table public.log_veiculos add column if not exists ano_mod smallint;
alter table public.log_veiculos add column if not exists cor text;
alter table public.log_veiculos add column if not exists propriedade text not null default 'proprio';
alter table public.log_veiculos add column if not exists contrato_id uuid references public.contratos(id) on delete set null;
alter table public.log_veiculos add column if not exists km_atual numeric(10,0);
alter table public.log_veiculos add column if not exists km_atual_em date;
do $$ begin
  begin alter table public.log_veiculos add constraint log_veiculos_propriedade check (propriedade in ('proprio', 'locado', 'agregado'));
  exception when duplicate_object then null; end;
end $$;

create table if not exists public.frota_motoristas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  colaborador_id uuid references public.rh_colaboradores(id) on delete set null,
  nome text not null,
  cpf text,
  vinculo text not null default 'empregado' check (vinculo in ('empregado', 'terceiro', 'agregado')),
  cnh_numero text, cnh_categoria text, cnh_validade date,
  cnh_ear boolean not null default false,          -- "exerce atividade remunerada" na CNH
  toxicologico_data date, toxicologico_validade date,
  mopp_validade date,                               -- curso de produtos perigosos (quando aplicável)
  termo_assinado_em date,                           -- termo de responsabilidade pelo uso de veículo
  ativo boolean not null default true,
  observacao text,
  criado_em timestamptz not null default now()
);
create index if not exists frota_motoristas_emp on public.frota_motoristas(empresa_id, ativo, nome);

create table if not exists public.frota_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  veiculo_id uuid not null references public.log_veiculos(id) on delete cascade,
  tipo text not null check (tipo in ('crlv', 'ipva', 'seguro', 'tacografo', 'aet', 'antt', 'outro')),
  numero text, emissor text,
  validade date,
  valor numeric(12,2),
  arquivo_path text,
  observacao text,
  criado_em timestamptz not null default now()
);
create index if not exists frota_documentos_v on public.frota_documentos(veiculo_id, tipo, validade);

create table if not exists public.frota_planos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  veiculo_id uuid not null references public.log_veiculos(id) on delete cascade,
  descricao text not null,                          -- ex.: troca de óleo e filtros
  a_cada_km int check (a_cada_km > 0),
  a_cada_meses smallint check (a_cada_meses > 0),
  ultimo_km numeric(10,0), ultima_data date,        -- última execução (atualizada ao registrar a manutenção)
  ativo boolean not null default true,
  check (a_cada_km is not null or a_cada_meses is not null)
);
create index if not exists frota_planos_v on public.frota_planos(veiculo_id);

create table if not exists public.frota_manutencoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  veiculo_id uuid not null references public.log_veiculos(id) on delete cascade,
  plano_id uuid references public.frota_planos(id) on delete set null,
  data date not null,
  km numeric(10,0),
  tipo text not null default 'corretiva' check (tipo in ('preventiva', 'corretiva', 'pneus', 'funilaria', 'outro')),
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  oficina text,
  descricao text not null,
  valor numeric(12,2) not null default 0 check (valor >= 0),
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  arquivo_path text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists frota_manut_v on public.frota_manutencoes(empresa_id, veiculo_id, data);

create table if not exists public.frota_abastecimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  veiculo_id uuid not null references public.log_veiculos(id) on delete cascade,
  motorista_id uuid references public.frota_motoristas(id) on delete set null,
  data date not null,
  km numeric(10,0) not null check (km >= 0),
  litros numeric(10,3) not null check (litros > 0),
  valor numeric(12,2) not null check (valor >= 0),
  combustivel text not null default 'diesel_s10' check (combustivel in ('diesel_s10', 'diesel_s500', 'gasolina', 'etanol', 'gnv', 'arla')),
  tanque_cheio boolean not null default true,
  posto text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists frota_abast_v on public.frota_abastecimentos(empresa_id, veiculo_id, data, km);

create table if not exists public.frota_multas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  veiculo_id uuid references public.log_veiculos(id) on delete set null,
  motorista_id uuid references public.frota_motoristas(id) on delete set null,
  auto_numero text,
  orgao text,
  data_infracao date not null,
  local text,
  infracao text not null,
  codigo text,
  pontos smallint,
  valor numeric(12,2) not null default 0 check (valor >= 0),
  vencimento date,
  prazo_indicacao date,                             -- prazo para indicar o condutor infrator
  situacao text not null default 'a_indicar' check (situacao in ('a_indicar', 'indicada', 'recurso', 'a_pagar', 'paga', 'descontada', 'cancelada')),
  desconto_folha boolean not null default false,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  arquivo_path text,
  observacao text,
  criado_em timestamptz not null default now()
);
create index if not exists frota_multas_emp on public.frota_multas(empresa_id, situacao, data_infracao);

-- acesso: quem edita a logística (admin, financeiro, diretor)
do $$ declare t text; begin
  foreach t in array array['frota_motoristas', 'frota_documentos', 'frota_planos', 'frota_manutencoes', 'frota_abastecimentos', 'frota_multas'] loop
    execute format('alter table public.%s enable row level security', t);
    execute format('drop policy if exists %1$s_log on public.%1$s', t);
    execute format('create policy %1$s_log on public.%1$s for all to authenticated using (public.pode_logistica(empresa_id)) with check (public.pode_logistica(empresa_id))', t);
    execute format('grant select, insert, update, delete on public.%s to authenticated', t);
  end loop;
end $$;

-- km atual do veículo acompanha o maior km lançado (abastecimento ou manutenção)
create or replace function public.tg_frota_km() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.km is not null then
    update log_veiculos set km_atual = new.km, km_atual_em = new.data
     where id = new.veiculo_id and (km_atual is null or km_atual < new.km);
  end if;
  return new;
end $$;
drop trigger if exists frota_abast_km on public.frota_abastecimentos;
create trigger frota_abast_km after insert or update on public.frota_abastecimentos for each row execute function public.tg_frota_km();
drop trigger if exists frota_manut_km on public.frota_manutencoes;
create trigger frota_manut_km after insert or update on public.frota_manutencoes for each row execute function public.tg_frota_km();

-- preventiva executada: atualiza a última execução do plano
create or replace function public.tg_frota_plano() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.plano_id is not null then
    update frota_planos set ultimo_km = coalesce(new.km, ultimo_km), ultima_data = new.data
     where id = new.plano_id and (ultima_data is null or ultima_data <= new.data);
  end if;
  return new;
end $$;
drop trigger if exists frota_manut_plano on public.frota_manutencoes;
create trigger frota_manut_plano after insert or update on public.frota_manutencoes for each row execute function public.tg_frota_plano();

-- arquivos: frota/<empresa>/<…>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('frota', 'frota', false, 15728640, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists frota_arq_sel on storage.objects;
drop policy if exists frota_arq_ins on storage.objects;
drop policy if exists frota_arq_upd on storage.objects;
drop policy if exists frota_arq_del on storage.objects;
create policy frota_arq_sel on storage.objects for select to authenticated using (bucket_id = 'frota' and public.pode_logistica(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy frota_arq_ins on storage.objects for insert to authenticated with check (bucket_id = 'frota' and public.pode_logistica(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy frota_arq_upd on storage.objects for update to authenticated using (bucket_id = 'frota' and public.pode_logistica(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy frota_arq_del on storage.objects for delete to authenticated using (bucket_id = 'frota' and public.pode_logistica(public._uuid_ou_nulo((storage.foldername(name))[1])));

-- auditoria
do $$ declare t text; begin
  if to_regprocedure('public._auditar()') is not null then
    foreach t in array array['frota_motoristas', 'frota_documentos', 'frota_manutencoes', 'frota_multas'] loop
      execute format('drop trigger if exists zz_auditoria on public.%s', t);
      execute format('create trigger zz_auditoria after insert or update or delete on public.%s for each row execute function public._auditar()', t);
    end loop;
  end if;
end $$;

-- conferência: tabelas = 6, colunas = 10, bucket = 1
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'frota\_%') as tabelas,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'log_veiculos'
         and column_name in ('renavam', 'chassi', 'marca_modelo', 'ano_fab', 'ano_mod', 'cor', 'propriedade', 'contrato_id', 'km_atual', 'km_atual_em')) as colunas,
       (select count(*) from storage.buckets where id = 'frota') as bucket;
