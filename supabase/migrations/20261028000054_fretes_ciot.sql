-- =====================================================================
-- Logística › Fretes e CIOT — etapas 1 e 2 da conformidade ANTT (28/10/2026, Renan: "pode seguir").
-- Base: Resolução ANTT 6.078/2026 (CIOT em toda operação; contratante de autônomo gera por IPEF; CIOT no MDF-e;
-- piso mínimo), MP 1.343/2026 (multa ao contratante abaixo do piso), NT MDF-e 2026.001 (MDF-e sem CIOT recusado a partir de 23/11/2026).
--  - log_transportadores: autônomo (tac), autônomo equiparado (tac_eq), transportadora (etc), cooperativa (ctc); RNTRC, conta indicada
--  - log_fretes: ficha de cada frete contratado (carga, NF-e, rota, km, eixos, valor × piso, CIOT, MDF-e, CT-e, vale-pedágio)
--  - log_frete_anexos: contrato, CIOT, MDF-e, CT-e, vale-pedágio, comprovantes (bucket privado "logistica")
--  - log_piso_coef: coeficientes do piso mínimo (CCD R$/km, CC R$) editáveis; carregada a Tabela A — carga geral, lotação
--  - trava: lançamento ligado a frete com autônomo só vira "Pago" sem pendências (CIOT, MDF-e, contrato, conta indicada, RNTRC, piso)
-- Migração ADITIVA. Pode rodar mais de uma vez.
-- =====================================================================

create table if not exists public.log_transportadores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  nome text not null,
  documento text,                                     -- CPF ou CNPJ, só dígitos
  tipo text not null default 'etc' check (tipo in ('tac', 'tac_eq', 'etc', 'ctc')),
  rntrc text,
  rntrc_validade date,
  veiculos jsonb not null default '[]'::jsonb,        -- [{"placa":"ABC1D23","eixos":5,"tipo":"carreta"}]
  conta_banco text, conta_agencia text, conta_numero text, conta_pix text,
  conta_titular text,
  conta_vinculo text check (conta_vinculo in ('proprio', 'conjuge', 'parente')),   -- autônomo: conta dele, do cônjuge ou parente até 2º grau
  contrato_validade date,
  ipef text,
  observacao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create unique index if not exists log_transp_doc on public.log_transportadores(empresa_id, documento) where documento is not null and documento <> '';

create table if not exists public.log_piso_coef (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tabela text not null default 'A' check (tabela in ('A', 'B', 'C', 'D')),
  tipo_carga text not null default 'geral',
  eixos smallint not null check (eixos between 2 and 9),
  ccd numeric(10,4) not null,                          -- R$ por km
  cc numeric(10,2) not null,                           -- R$ carga e descarga
  vigencia date not null default current_date,
  fonte text,
  unique (empresa_id, tabela, tipo_carga, eixos, vigencia)
);

create table if not exists public.log_fretes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null default 0,
  data date not null default current_date,
  transportador_id uuid references public.log_transportadores(id) on delete restrict,
  carga_id uuid references public.log_cargas(id) on delete set null,
  notas text,                                          -- números das NF-e transportadas
  origem text, destino text,
  km numeric(9,1),
  lotacao boolean not null default true,               -- piso só se aplica a carga lotação
  tabela text not null default 'A',
  tipo_carga text not null default 'geral',
  eixos smallint,
  retorno_vazio boolean not null default false,
  km_retorno numeric(9,1),
  valor numeric(14,2),
  piso numeric(14,2),                                  -- calculado na ficha (km × CCD + CC [+ 0,92 × CCD × km retorno])
  placa text,
  motorista text,
  ciot text,
  ciot_por text check (ciot_por in ('iplamm', 'transportadora')),
  mdfe_chave text,
  cte_chave text,
  pedagio_valor numeric(12,2),
  pedagio_comprovante text,
  pedagio_nao_ha boolean not null default false,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  status text not null default 'aberto' check (status in ('aberto', 'cancelado')),
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists log_fretes_data on public.log_fretes(empresa_id, data);
create index if not exists log_fretes_lanc on public.log_fretes(lancamento_id);
drop trigger if exists log_fretes_numero on public.log_fretes;
create trigger log_fretes_numero before insert on public.log_fretes for each row execute function public._compras_numero();

create table if not exists public.log_frete_anexos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  frete_id uuid references public.log_fretes(id) on delete cascade,
  transportador_id uuid references public.log_transportadores(id) on delete cascade,
  tipo text not null default 'outro' check (tipo in ('contrato', 'ciot', 'mdfe', 'cte', 'vale_pedagio', 'comprovante', 'outro')),
  path text not null unique,
  nome text,
  enviado_por text,
  enviado_em timestamptz not null default now(),
  check (frete_id is not null or transportador_id is not null)
);
create index if not exists log_anx_frete on public.log_frete_anexos(frete_id);
create index if not exists log_anx_transp on public.log_frete_anexos(transportador_id);

do $$ declare t text; begin
  foreach t in array array['log_transportadores', 'log_piso_coef', 'log_fretes', 'log_frete_anexos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.ve_logistica(empresa_id))', t || '_sel', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.pode_logistica(empresa_id)) with check (public.pode_logistica(empresa_id))', t || '_all', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;

-- arquivos: logistica/<empresa>/<frete ou transportador>/<arquivo>; privado (link temporário)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('logistica', 'logistica', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'text/xml', 'application/xml'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists logistica_arq_sel on storage.objects;
drop policy if exists logistica_arq_ins on storage.objects;
drop policy if exists logistica_arq_del on storage.objects;
create policy logistica_arq_sel on storage.objects for select to authenticated using (bucket_id = 'logistica' and public.ve_logistica(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy logistica_arq_ins on storage.objects for insert to authenticated with check (bucket_id = 'logistica' and public.pode_logistica(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy logistica_arq_del on storage.objects for delete to authenticated using (bucket_id = 'logistica' and public.pode_logistica(public._uuid_ou_nulo((storage.foldername(name))[1])));

-- Tabela A — carga geral, lotação (Anexo II, com reajuste da Portaria SUROC nº 22/2026, conforme TranspNet).
-- Conferir na calculadora oficial da ANTT; os valores ficam editáveis na tela.
insert into public.log_piso_coef (empresa_id, tabela, tipo_carga, eixos, ccd, cc, vigencia, fonte)
select e.id, 'A', 'geral', v.eixos, v.ccd, v.cc, date '2026-05-24', 'Tabela A carga geral lotação — Portaria SUROC 22/2026 (conferir na ANTT)'
  from public.empresas e,
       (values (2, 4.0738, 451.84), (3, 5.2177, 541.86), (4, 5.9180, 588.86), (5, 6.8284, 657.56), (6, 7.5347, 671.93), (7, 8.2727, 831.66), (9, 9.4114, 903.32)) v(eixos, ccd, cc)
on conflict (empresa_id, tabela, tipo_carga, eixos, vigencia) do nothing;

-- ---------------------------------------------------------------------
-- Pendências de um frete (vazio = conforme). Autônomo: tudo é exigência; transportadora: CIOT, MDF-e e piso viram aviso.
create or replace function public.log_frete_pendencias(p_frete uuid)
returns text[] language plpgsql stable security definer set search_path = public as $$
declare f log_fretes; t log_transportadores; r text[] := '{}'; tac boolean; tem_contrato boolean;
begin
  select * into f from log_fretes where id = p_frete;
  if f.id is null then return array['frete não encontrado']; end if;
  select * into t from log_transportadores where id = f.transportador_id;
  if t.id is null then return array['sem transportador']; end if;
  tac := t.tipo in ('tac', 'tac_eq', 'ctc');
  if coalesce(f.valor, 0) <= 0 then r := array_append(r, 'valor do frete'); end if;
  if nullif(trim(coalesce(f.ciot, '')), '') is null then r := array_append(r, 'CIOT'); end if;
  if nullif(trim(coalesce(f.mdfe_chave, '')), '') is null then r := array_append(r, 'MDF-e'); end if;
  if f.lotacao and f.piso is not null and f.valor is not null and f.valor < f.piso - 0.005 then r := array_append(r, 'abaixo do piso mínimo'); end if;
  if f.lotacao and f.piso is null then r := array_append(r, 'piso não calculado'); end if;
  if not f.pedagio_nao_ha and coalesce(f.pedagio_valor, 0) <= 0 then r := array_append(r, 'vale-pedágio'); end if;
  if tac then
    if nullif(trim(coalesce(t.rntrc, '')), '') is null then r := array_append(r, 'RNTRC'); elsif t.rntrc_validade is not null and t.rntrc_validade < f.data then r := array_append(r, 'RNTRC vencido'); end if;
    select exists(select 1 from log_frete_anexos a where a.transportador_id = t.id and a.tipo = 'contrato') or exists(select 1 from log_frete_anexos a where a.frete_id = f.id and a.tipo = 'contrato') into tem_contrato;
    if not tem_contrato then r := array_append(r, 'contrato'); end if;
    if t.contrato_validade is not null and t.contrato_validade < f.data then r := array_append(r, 'contrato vencido'); end if;
    if nullif(trim(coalesce(t.conta_numero, '') || coalesce(t.conta_pix, '')), '') is null or t.conta_vinculo is null then r := array_append(r, 'conta indicada pelo autônomo'); end if;
  end if;
  return r;
end $$;
revoke execute on function public.log_frete_pendencias(uuid) from anon, public;
grant execute on function public.log_frete_pendencias(uuid) to authenticated;

-- Trava: pagamento de frete com autônomo só com o frete sem pendências (lançamento ligado à ficha do frete).
create or replace function public._log_frete_trava_pagamento() returns trigger
language plpgsql security definer set search_path = public as $$
declare f record; p text[];
begin
  if new.status <> 'Pago' or (tg_op = 'UPDATE' and old.status = 'Pago') then return new; end if;
  for f in select lf.id, lf.numero, t.tipo from log_fretes lf join log_transportadores t on t.id = lf.transportador_id
            where lf.lancamento_id = new.id and lf.status = 'aberto' loop
    if f.tipo in ('tac', 'tac_eq', 'ctc') then
      p := log_frete_pendencias(f.id);
      if cardinality(p) > 0 then
        raise exception 'Frete nº % (autônomo) não pode ser pago: falta %', f.numero, array_to_string(p, ', ');
      end if;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists log_frete_trava_pagamento on public.lancamentos;
create trigger log_frete_trava_pagamento before insert or update of status on public.lancamentos for each row execute function public._log_frete_trava_pagamento();

-- conferência: 4 tabelas e os coeficientes carregados
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('log_transportadores', 'log_piso_coef', 'log_fretes', 'log_frete_anexos')) as tabelas,
       (select count(*) from public.log_piso_coef) as coeficientes;
