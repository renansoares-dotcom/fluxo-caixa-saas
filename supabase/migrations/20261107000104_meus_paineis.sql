-- =====================================================================
-- Melhoria contínua 2.5 — Meus Painéis (07/11/2026)
-- O antigo Dashboard vira "Meus Painéis": cada pessoa monta um ou mais painéis com os cartões que já existem na plataforma
-- (indicadores, gráficos e tabelas), escolhe o tamanho e a ordem. Um painel pode ser compartilhado com a empresa como
-- modelo: os outros veem e copiam para si; só o dono altera. Sem painel salvo, a tela mostra o painel padrão (a visão do
-- ano do Dashboard antigo). Migração ADITIVA.
-- =====================================================================

create table if not exists public.paineis (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  dono uuid not null default auth.uid(),
  dono_nome text,
  nome text not null check (length(trim(nome)) between 1 and 60),
  cartoes jsonb not null default '[]',           -- [{ "t": "graf_entradas_saidas", "tam": 2, "cfg": {} }, …] na ordem da tela
  compartilhado boolean not null default false,
  ordem int not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (jsonb_typeof(cartoes) = 'array' and jsonb_array_length(cartoes) <= 40)
);
create index if not exists paineis_emp_dono on public.paineis(empresa_id, dono, ordem);

alter table public.paineis enable row level security;
drop policy if exists paineis_sel on public.paineis; drop policy if exists paineis_ins on public.paineis;
drop policy if exists paineis_upd on public.paineis; drop policy if exists paineis_del on public.paineis;
create policy paineis_sel on public.paineis for select to authenticated using (public.is_participante(empresa_id) and (dono = auth.uid() or compartilhado));
create policy paineis_ins on public.paineis for insert to authenticated with check (public.is_participante(empresa_id) and dono = auth.uid());
create policy paineis_upd on public.paineis for update to authenticated using (dono = auth.uid()) with check (dono = auth.uid());
create policy paineis_del on public.paineis for delete to authenticated using (dono = auth.uid());
grant select, insert, update, delete on public.paineis to authenticated;

-- conferência: tabela = 1
select count(*) as tabela from information_schema.tables where table_schema = 'public' and table_name = 'paineis';
