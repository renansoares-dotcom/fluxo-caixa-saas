-- Condições do fundo por grupo de sacados (22/10/2026).
-- Motivo: a FS cobra uma taxa para um grupo de sacados (CNPJ raiz informado) e outra para os demais, e nunca mistura
-- os dois no mesmo borderô — por isso há dias com duas operações na FS. Cada fundo pode ter várias condições:
--   sacados_raiz = raízes de CNPJ (8 dígitos) que a condição cobre; vazio = "demais sacados";
--   compensação = vencimento + N dias corridos, rolando para o próximo dia útil quando cair em fim de semana/feriado;
--   vigência (contratos que mudam a taxa).
-- Sem condição cadastrada, o fundo continua usando os campos de fidc_fundos (como hoje).
-- Aditivo: só cria tabela e coluna; não altera dados. Pode rodar mais de uma vez.

create table if not exists public.fidc_fundo_condicoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  fundo_id uuid not null references public.fidc_fundos(id) on delete cascade,
  nome text not null,
  sacados_raiz text[] not null default '{}',          -- raízes de CNPJ (8 dígitos); vazio = demais sacados
  taxa_am numeric(8,4) not null,
  metodo_desagio text not null default 'simples' check (metodo_desagio in ('simples', 'fator')),
  dias_compensacao int not null default 0,
  rola_dia_util boolean not null default true,        -- data cobrada cai em fim de semana/feriado → próximo dia útil
  prazo_min_cobrado int,                              -- prazo mínimo cobrado (dias), se o fundo tiver
  tarifa_operacao numeric(12,2) not null default 0,   -- TED / tarifa por borderô
  custo_assinatura numeric(12,2) not null default 0,  -- assinatura por borderô
  tarifa_titulo numeric(12,2) not null default 0,     -- boleto por título
  custo_consulta numeric(12,2) not null default 0,    -- consulta de sacado novo
  ad_valorem_pct numeric(8,4) not null default 0,
  iof_pct numeric(8,4) not null default 0,
  vigencia_ini date,
  vigencia_fim date,
  ativo boolean not null default true,
  observacao text,
  criado_em timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fidc_fundo_condicoes_fundo on public.fidc_fundo_condicoes(fundo_id);

alter table public.fidc_fundo_condicoes enable row level security;
drop policy if exists fidc_cond_sel on public.fidc_fundo_condicoes;
drop policy if exists fidc_cond_ins on public.fidc_fundo_condicoes;
drop policy if exists fidc_cond_upd on public.fidc_fundo_condicoes;
drop policy if exists fidc_cond_del on public.fidc_fundo_condicoes;
create policy fidc_cond_sel on public.fidc_fundo_condicoes for select to authenticated using (public.is_membro(empresa_id));
create policy fidc_cond_ins on public.fidc_fundo_condicoes for insert to authenticated with check (public.pode_editar(empresa_id));
create policy fidc_cond_upd on public.fidc_fundo_condicoes for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy fidc_cond_del on public.fidc_fundo_condicoes for delete to authenticated using (public.pode_editar(empresa_id));
revoke all on public.fidc_fundo_condicoes from anon;
grant select, insert, update, delete on public.fidc_fundo_condicoes to authenticated;

-- a proposta guarda a condição usada (uma proposta = uma condição, como o borderô do fundo)
alter table public.fidc_propostas add column if not exists condicao_id uuid references public.fidc_fundo_condicoes(id) on delete set null;

-- auditoria (migração 038)
drop trigger if exists zz_auditoria on public.fidc_fundo_condicoes;
create trigger zz_auditoria after insert or update or delete on public.fidc_fundo_condicoes for each row execute function public._auditar();

-- conferência: deve mostrar 1 tabela e 1 coluna
select (select count(*) from information_schema.tables where table_name = 'fidc_fundo_condicoes') tabela,
       (select count(*) from information_schema.columns where table_name = 'fidc_propostas' and column_name = 'condicao_id') coluna;
