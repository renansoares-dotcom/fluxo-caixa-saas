-- =====================================================================
-- Fretes pagos sem ficha: dispensa com justificativa (28/10/2026, Renan: "pode seguir").
-- Tira o lançamento dos alertas de "Conformidade do mês" sem apagar nada: fica registrado o motivo, quem e quando.
-- Motivos: relacao_encerrada (autônomo antigo, sem atividade com a IPLAMM), contratado_terceiro (frete contratado pelo
-- fornecedor/cliente, CT-e em nome da IPLAMM como tomadora), nao_e_frete (despesa lançada no plano de fretes), outro.
-- Migração ADITIVA. Pode rodar mais de uma vez.
-- =====================================================================
create table if not exists public.log_frete_dispensas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  lancamento_id uuid not null unique references public.lancamentos(id) on delete cascade,
  motivo text not null check (motivo in ('relacao_encerrada', 'contratado_terceiro', 'nao_e_frete', 'outro')),
  justificativa text not null,
  criado_por uuid default auth.uid(),
  criado_email text default (auth.jwt() ->> 'email'),
  criado_em timestamptz not null default now()
);
alter table public.log_frete_dispensas enable row level security;
drop policy if exists log_frete_dispensas_sel on public.log_frete_dispensas;
drop policy if exists log_frete_dispensas_all on public.log_frete_dispensas;
create policy log_frete_dispensas_sel on public.log_frete_dispensas for select to authenticated using (public.ve_logistica(empresa_id));
create policy log_frete_dispensas_all on public.log_frete_dispensas for all to authenticated using (public.pode_logistica(empresa_id)) with check (public.pode_logistica(empresa_id));
revoke all on public.log_frete_dispensas from anon;
grant select, insert, update, delete on public.log_frete_dispensas to authenticated;
drop trigger if exists zz_auditoria on public.log_frete_dispensas;
create trigger zz_auditoria after insert or update or delete on public.log_frete_dispensas for each row execute function public._auditar();

select count(*) as tabela_criada from information_schema.tables where table_schema = 'public' and table_name = 'log_frete_dispensas';
