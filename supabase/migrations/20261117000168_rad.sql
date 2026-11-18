-- 168 — RAD: recolhimento da CBS pelo adquirente (17/11/2026, pedido do Renan)
-- Primeira parte, sem ligação com a Receita: liga o uso, a regra por fornecedor e a marcação da nota de compra
-- que a empresa decidiu recolher como adquirente (art. 36 da LC 214/2025). A geração do DARF pela API e a
-- confirmação do recolhimento entram depois, sobre estas mesmas tabelas.
-- * rad_config: desligado por padrão; conta do título do DARF; regra padrão (sempre, nunca, perguntar).
-- * rad_fornecedores: regra por fornecedor, que vale mais que a padrão.
-- * rad_recolhimentos: a nota marcada, com a CBS destacada nela. Uma marcação ativa por nota.
-- * rad_titulos(empresa): para cada nota marcada, o título em aberto de onde a CBS seria abatida (o de vencimento
--   mais próximo) e o líquido sugerido. É só sugestão: nada muda no título.
-- Aditivo.

create table if not exists public.rad_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ativo boolean not null default false,
  regra_padrao text not null default 'perguntar' check (regra_padrao in ('sempre', 'nunca', 'perguntar')),
  plano_darf_id uuid references public.plano_contas(id) on delete set null,      -- conta do título do DARF (uso na 2ª parte)
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);

create table if not exists public.rad_fornecedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  favorecido_id uuid not null references public.favorecidos(id) on delete cascade,
  regra text not null check (regra in ('sempre', 'nunca', 'perguntar')),
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  unique (empresa_id, favorecido_id)
);

create table if not exists public.rad_recolhimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nota_id uuid not null references public.nfe_notas(id) on delete cascade,
  chave text,
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  valor_cbs numeric(16,2) not null check (valor_cbs > 0),
  situacao text not null default 'marcado' check (situacao in ('marcado', 'darf_gerado', 'recolhido', 'cancelado')),
  observacao text,
  marcado_por uuid default auth.uid(), marcado_por_nome text, marcado_em timestamptz not null default now(),
  cancelado_por uuid, cancelado_em timestamptz, cancelamento_motivo text
);
create unique index if not exists rad_recolhimentos_nota_ativa on public.rad_recolhimentos(nota_id) where situacao <> 'cancelado';
create index if not exists rad_recolhimentos_emp on public.rad_recolhimentos(empresa_id, situacao);

-- ---------- segurança: todos da empresa leem; quem edita o financeiro configura; marcar e desmarcar só pelas funções ----------
do $$ declare t text; begin
  foreach t in array array['rad_config', 'rad_fornecedores', 'rad_recolhimentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_membro(empresa_id))', t || '_sel', t);
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
  foreach t in array array['rad_config', 'rad_fornecedores'] loop
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.pode_editar(empresa_id))', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id))', t || '_upd', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;
drop policy if exists rad_fornecedores_del on public.rad_fornecedores;
create policy rad_fornecedores_del on public.rad_fornecedores for delete to authenticated using (public.pode_editar(empresa_id));
grant delete on public.rad_fornecedores to authenticated;
grant select on public.rad_recolhimentos to authenticated;

create or replace function public._rad_fornecedor_antes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select empresa_id from favorecidos where id = new.favorecido_id) is distinct from new.empresa_id then raise exception 'Fornecedor de outra empresa'; end if;
  return new;
end $$;
drop trigger if exists rad_fornecedor_antes on public.rad_fornecedores;
create trigger rad_fornecedor_antes before insert or update on public.rad_fornecedores for each row execute function public._rad_fornecedor_antes();

-- ---------- marcar a nota de compra para o recolhimento pelo adquirente ----------
create or replace function public.rad_marcar(p_nota uuid, p_observacao text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare n nfe_notas; v_id uuid; v_regra text;
begin
  select * into n from nfe_notas where id = p_nota;
  if n.id is null or not public.pode_editar(n.empresa_id) then raise exception 'Acesso negado.'; end if;
  if not coalesce((select ativo from rad_config where empresa_id = n.empresa_id), false) then raise exception 'O recolhimento pelo adquirente está desligado nos parâmetros.'; end if;
  if n.emissao_propria then raise exception 'Só nota de fornecedor pode ser recolhida pelo adquirente.'; end if;
  if n.situacao <> 'autorizada' then raise exception 'A nota não está autorizada.'; end if;
  if coalesce(n.v_cbs, 0) <= 0 then raise exception 'A nota não tem CBS destacada.'; end if;
  if exists (select 1 from rad_recolhimentos where nota_id = n.id and situacao <> 'cancelado') then raise exception 'Esta nota já está marcada para o recolhimento pelo adquirente.'; end if;
  select regra into v_regra from rad_fornecedores where empresa_id = n.empresa_id and favorecido_id = n.favorecido_id;
  if v_regra = 'nunca' then raise exception 'Este fornecedor está com a regra "nunca recolher" nos parâmetros do RAD.'; end if;
  insert into rad_recolhimentos(empresa_id, nota_id, chave, favorecido_id, valor_cbs, observacao, marcado_por, marcado_por_nome)
  values (n.empresa_id, n.id, n.chave, n.favorecido_id, n.v_cbs, nullif(trim(p_observacao), ''), auth.uid(), (select nome from membros where empresa_id = n.empresa_id and user_id = auth.uid()))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.rad_desmarcar(p_id uuid, p_motivo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r rad_recolhimentos;
begin
  select * into r from rad_recolhimentos where id = p_id for update;
  if r.id is null or not public.pode_editar(r.empresa_id) then raise exception 'Acesso negado.'; end if;
  if r.situacao <> 'marcado' then raise exception 'Só a nota apenas marcada pode ser desmarcada.'; end if;
  update rad_recolhimentos set situacao = 'cancelado', cancelado_por = auth.uid(), cancelado_em = now(), cancelamento_motivo = nullif(trim(p_motivo), '') where id = r.id;
end $$;

-- ---------- títulos das notas marcadas: de onde a CBS seria abatida e o líquido sugerido ao fornecedor ----------
create or replace function public.rad_titulos(p_empresa uuid) returns table (lancamento_id uuid, recolhimento_id uuid, nota_id uuid, nota_numero int, valor_cbs numeric, valor_titulo numeric, liquido_sugerido numeric)
language sql stable security definer set search_path = public as $$
  select x.lid, x.rid, x.nid, x.numero, x.valor_cbs, x.vt, greatest(0, x.vt - x.valor_cbs)
    from (select l.id lid, r.id rid, n.id nid, n.numero, r.valor_cbs, abs(l.valor) vt, row_number() over (partition by r.id order by l.data, l.id) ordem
            from rad_recolhimentos r join nfe_notas n on n.id = r.nota_id join nfe_vinculos v on v.nota_id = n.id join lancamentos l on l.id = v.lancamento_id
           where r.empresa_id = p_empresa and r.situacao = 'marcado' and l.status <> 'Pago' and public.is_membro(p_empresa)) x
   where x.ordem = 1;
$$;

revoke all on function public._rad_fornecedor_antes() from public, anon, authenticated;
revoke all on function public.rad_marcar(uuid, text), public.rad_desmarcar(uuid, text), public.rad_titulos(uuid) from public, anon;
grant execute on function public.rad_marcar(uuid, text), public.rad_desmarcar(uuid, text), public.rad_titulos(uuid) to authenticated;
