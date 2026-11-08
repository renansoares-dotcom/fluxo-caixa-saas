-- =====================================================================
-- Melhoria contínua 9.4 — Índices financeiros (08/11/2026)
-- Liquidez, endividamento, ciclo de caixa e EBITDA com a tendência de 12 meses, calculados na tela a partir do balancete
-- (da plataforma ou da contabilidade). Aqui ficam os parâmetros da empresa:
--   • grupos: de que contas do plano contábil vem cada componente (ativo circulante, estoques, fornecedores, empréstimos…);
--   • faixas: "bom" e "atenção" de cada índice (a empresa define o que é confortável para ela);
--   • fonte padrão e quantidade de meses da tendência;
-- e o comentário da administração por mês, que vai para o relatório da Diretoria ou do Administrador Judicial.
-- Migração ADITIVA.
-- =====================================================================
create table if not exists public.indices_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  fonte text not null default 'plataforma' check (fonte in ('plataforma', 'contabilidade')),
  meses smallint not null default 12 check (meses between 6 and 24),
  grupos jsonb not null default '{}'::jsonb,       -- { componente: ["classificação", ...] } — vazio = padrão do plano
  faixas jsonb not null default '{}'::jsonb,       -- { índice: { bom: n, atencao: n } } — vazio = padrão
  ocultos text[] not null default '{}',            -- índices escondidos da tela e do relatório
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid(),
  check (jsonb_typeof(grupos) = 'object' and jsonb_typeof(faixas) = 'object')
);
create table if not exists public.indices_comentarios (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  mes date not null check (extract(day from mes) = 1),   -- 1º dia do mês de referência
  texto text not null check (length(texto) between 1 and 4000),
  autor uuid default auth.uid(),
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, mes)
);

alter table public.indices_config enable row level security;
alter table public.indices_comentarios enable row level security;
drop policy if exists indices_config_sel on public.indices_config;
drop policy if exists indices_config_ins on public.indices_config;
drop policy if exists indices_config_upd on public.indices_config;
create policy indices_config_sel on public.indices_config for select to authenticated using (public.is_membro(empresa_id));
create policy indices_config_ins on public.indices_config for insert to authenticated with check (public.pode_editar(empresa_id));
create policy indices_config_upd on public.indices_config for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
drop policy if exists indices_comentarios_sel on public.indices_comentarios;
drop policy if exists indices_comentarios_ins on public.indices_comentarios;
drop policy if exists indices_comentarios_upd on public.indices_comentarios;
drop policy if exists indices_comentarios_del on public.indices_comentarios;
create policy indices_comentarios_sel on public.indices_comentarios for select to authenticated using (public.is_membro(empresa_id));
create policy indices_comentarios_ins on public.indices_comentarios for insert to authenticated with check (public.pode_editar(empresa_id));
create policy indices_comentarios_upd on public.indices_comentarios for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy indices_comentarios_del on public.indices_comentarios for delete to authenticated using (public.pode_editar(empresa_id));
grant select, insert, update on public.indices_config to authenticated;
grant select, insert, update, delete on public.indices_comentarios to authenticated;
drop trigger if exists zz_auditoria on public.indices_config;
create trigger zz_auditoria after insert or update or delete on public.indices_config for each row execute function public._auditar();
drop trigger if exists zz_auditoria on public.indices_comentarios;
create trigger zz_auditoria after insert or update or delete on public.indices_comentarios for each row execute function public._auditar();

-- conferência: tabelas = 2
select count(*) as tabelas from information_schema.tables where table_schema = 'public' and table_name in ('indices_config', 'indices_comentarios');
