-- =====================================================================
-- Melhoria contínua 5.5 — Inventário cíclico pelo celular (08/11/2026)
-- Contagens pequenas e frequentes, em vez de parar a fábrica para o inventário anual:
--   • est_inv_gerar: escolhe os itens de um local pela curva ABC do valor em estoque e pela frequência de cada classe
--     (A a cada 30 dias, B 60, C 120 — ajustável), começando pelos que estão há mais tempo sem contar;
--   • contagem cega pelo celular (leitura da etiqueta/código), o saldo do sistema é guardado na hora da contagem;
--   • divergência acima da tolerância pede recontagem; depois, a contagem vai para aprovação;
--   • est_inv_aprovar: quem aprova gera os ajustes de inventário (AJ+ sobra / AJ− falta) no Kardex, pelo custo médio.
-- Migração ADITIVA.
-- =====================================================================
create table if not exists public.est_inv_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  dias_a smallint not null default 30 check (dias_a between 7 and 365),
  dias_b smallint not null default 60 check (dias_b between 7 and 365),
  dias_c smallint not null default 120 check (dias_c between 7 and 730),
  itens_por_contagem smallint not null default 20 check (itens_por_contagem between 1 and 200),
  tolerancia_pct numeric(5,2) not null default 2 check (tolerancia_pct between 0 and 50),
  tolerancia_valor numeric(12,2) not null default 100 check (tolerancia_valor >= 0),
  contagem_cega boolean not null default true,
  recontar boolean not null default true,
  papeis_aprovacao text[] not null default array['admin', 'diretor', 'financeiro'],
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
create table if not exists public.est_inv_contagens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  local_id uuid not null references public.est_locais(id),
  situacao text not null default 'aberta' check (situacao in ('aberta', 'em_aprovacao', 'aprovada', 'recusada', 'cancelada')),
  observacao text check (length(observacao) <= 500),
  criada_por text default (auth.jwt() ->> 'email'), criada_em timestamptz not null default now(),
  enviada_em timestamptz,
  decidida_por text, decidida_em timestamptz, motivo text,
  unique (empresa_id, numero)
);
create table if not exists public.est_inv_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  contagem_id uuid not null references public.est_inv_contagens(id) on delete cascade,
  produto_id uuid not null references public.produtos(id),
  lote_id uuid references public.est_lotes(id),
  classe char(1) check (classe in ('A', 'B', 'C')),
  saldo_sistema numeric(18,4),                 -- guardado na hora da contagem
  custo numeric(20,10),
  contado numeric(18,4) check (contado is null or contado >= 0),
  recontado numeric(18,4) check (recontado is null or recontado >= 0),
  contado_por text, contado_em timestamptz,
  situacao text not null default 'pendente' check (situacao in ('pendente', 'recontar', 'ok', 'divergente', 'ajustado')),
  justificativa text check (length(justificativa) <= 300),
  movimento_id uuid references public.est_movimentos(id) on delete set null,
  unique (contagem_id, produto_id, lote_id)
);
create index if not exists est_inv_itens_prod on public.est_inv_itens(empresa_id, produto_id, contado_em);

do $$ declare t text;
begin
  foreach t in array array['est_inv_config', 'est_inv_contagens', 'est_inv_itens'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %1$s_sel on public.%1$s; drop policy if exists %1$s_ins on public.%1$s; drop policy if exists %1$s_upd on public.%1$s; drop policy if exists %1$s_del on public.%1$s', t);
    execute format('create policy %1$s_sel on public.%1$s for select to authenticated using (public.is_participante(empresa_id))', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop trigger if exists zz_auditoria on public.%1$s; create trigger zz_auditoria after insert or update or delete on public.%1$s for each row execute function public._auditar()', t);
  end loop;
end $$;
create policy est_inv_config_ins on public.est_inv_config for insert to authenticated with check (public.pode_editar(empresa_id));
create policy est_inv_config_upd on public.est_inv_config for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
grant insert, update on public.est_inv_config to authenticated;
-- contagens e itens só mudam pelas funções abaixo

create or replace function public._inv_cfg(p_empresa uuid) returns est_inv_config language sql stable security definer set search_path = public as $$
  select coalesce((select c from est_inv_config c where c.empresa_id = p_empresa),
                  (select row(p_empresa, 30, 60, 120, 20, 2, 100, true, true, array['admin', 'diretor', 'financeiro'], now(), null)::est_inv_config));
$$;

-- curva ABC pelo valor do saldo de cada produto (80% / 15% / 5%)
create or replace function public.est_inv_abc(p_empresa uuid)
returns table(produto_id uuid, classe char(1), valor numeric, ultima_contagem timestamptz)
language sql stable security definer set search_path = public as $$
  with v as (select s.produto_id, sum(s.valor) val from est_saldos s where s.empresa_id = p_empresa and s.quantidade > 0 group by 1),
  a as (select v.*, sum(val) over (order by val desc rows unbounded preceding) / nullif(sum(val) over (), 0) ac from v)
  select a.produto_id, (case when a.ac <= 0.80 or a.ac = (select min(ac) from a) then 'A' when a.ac <= 0.95 then 'B' else 'C' end)::char(1), round(a.val, 2),
         (select max(i.contado_em) from est_inv_itens i where i.produto_id = a.produto_id and i.situacao in ('ok', 'divergente', 'ajustado'))
    from a where public.is_participante(p_empresa);
$$;
revoke all on function public.est_inv_abc(uuid) from public, anon;
grant execute on function public.est_inv_abc(uuid) to authenticated;

-- gera a contagem do local com os itens vencidos pela frequência da classe (os mais atrasados primeiro)
create or replace function public.est_inv_gerar(p_empresa uuid, p_local uuid, p_qtd int default null, p_produtos uuid[] default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare cfg est_inv_config; v_id uuid; v_num int; v_n int;
begin
  if not public.pode_estoque(p_empresa) then raise exception 'Sem permissão.'; end if;
  if not exists (select 1 from est_locais where id = p_local and empresa_id = p_empresa and ativo) then raise exception 'Local inválido.'; end if;
  if (select implantado_em from est_config where empresa_id = p_empresa) is null then raise exception 'Implante o saldo inicial do estoque antes do inventário cíclico.'; end if;
  if exists (select 1 from est_inv_contagens where empresa_id = p_empresa and local_id = p_local and situacao = 'aberta') then raise exception 'Já há uma contagem aberta neste local.'; end if;
  cfg := _inv_cfg(p_empresa);
  select coalesce(max(numero), 0) + 1 into v_num from est_inv_contagens where empresa_id = p_empresa;
  insert into est_inv_contagens(empresa_id, numero, local_id) values (p_empresa, v_num, p_local) returning id into v_id;
  insert into est_inv_itens(empresa_id, contagem_id, produto_id, lote_id, classe)
  select p_empresa, v_id, s.produto_id, s.lote_id, coalesce(abc.classe, 'C')
    from est_saldos s left join est_inv_abc(p_empresa) abc on abc.produto_id = s.produto_id
   where s.empresa_id = p_empresa and s.local_id = p_local and s.quantidade > 0
     and (p_produtos is null or s.produto_id = any(p_produtos))
     and (p_produtos is not null or abc.ultima_contagem is null
          or abc.ultima_contagem < now() - make_interval(days => case coalesce(abc.classe, 'C') when 'A' then cfg.dias_a when 'B' then cfg.dias_b else cfg.dias_c end))
   order by case coalesce(abc.classe, 'C') when 'A' then 1 when 'B' then 2 else 3 end, abc.ultima_contagem nulls first, abc.valor desc nulls last
   limit coalesce(p_qtd, cfg.itens_por_contagem);
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Nenhum item a contar neste local agora (todos dentro da frequência).'; end if;
  return v_id;
end $$;
revoke all on function public.est_inv_gerar(uuid, uuid, int, uuid[]) from public, anon;
grant execute on function public.est_inv_gerar(uuid, uuid, int, uuid[]) to authenticated;

-- registra a contagem (ou recontagem) de um item; guarda o saldo do sistema e decide ok, recontar ou divergente
create or replace function public.est_inv_contar(p_item uuid, p_qtd numeric, p_justificativa text default null)
returns text language plpgsql security definer set search_path = public as $$
declare it est_inv_itens; c est_inv_contagens; cfg est_inv_config; v_sis numeric; v_custo numeric; v_dif numeric; v_q numeric; v_sit text;
begin
  select * into it from est_inv_itens where id = p_item;
  select * into c from est_inv_contagens where id = it.contagem_id;
  if c.id is null or not public.pode_estoque(c.empresa_id) then raise exception 'Sem permissão.'; end if;
  if c.situacao <> 'aberta' then raise exception 'Contagem % não está aberta.', c.numero; end if;
  if p_qtd is null or p_qtd < 0 then raise exception 'Quantidade inválida.'; end if;
  cfg := _inv_cfg(c.empresa_id);
  select coalesce(sum(quantidade), 0) into v_sis from est_saldos where produto_id = it.produto_id and local_id = c.local_id and lote_id is not distinct from it.lote_id;
  select coalesce(custo_medio, 0) into v_custo from est_custos where produto_id = it.produto_id;
  if it.situacao = 'recontar' then v_q := p_qtd; else v_q := p_qtd; end if;
  v_dif := v_q - v_sis;
  v_sit := case when abs(v_dif) <= greatest(abs(v_sis) * cfg.tolerancia_pct / 100, 0) and abs(v_dif * coalesce(v_custo, 0)) <= cfg.tolerancia_valor then 'ok'
                when it.situacao = 'pendente' and cfg.recontar then 'recontar'
                else 'divergente' end;
  update est_inv_itens set saldo_sistema = v_sis, custo = v_custo,
         contado = case when it.situacao = 'recontar' then contado else p_qtd end,
         recontado = case when it.situacao = 'recontar' then p_qtd else recontado end,
         contado_por = auth.jwt() ->> 'email', contado_em = now(), situacao = v_sit,
         justificativa = coalesce(nullif(trim(p_justificativa), ''), justificativa)
   where id = p_item;
  return v_sit;
end $$;
revoke all on function public.est_inv_contar(uuid, numeric, text) from public, anon;
grant execute on function public.est_inv_contar(uuid, numeric, text) to authenticated;

-- inclui na contagem um item lido que não estava na lista (achado no local)
create or replace function public.est_inv_incluir(p_contagem uuid, p_produto uuid, p_lote uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare c est_inv_contagens; v_id uuid;
begin
  select * into c from est_inv_contagens where id = p_contagem;
  if c.id is null or not public.pode_estoque(c.empresa_id) then raise exception 'Sem permissão.'; end if;
  if c.situacao <> 'aberta' then raise exception 'Contagem fechada.'; end if;
  if not exists (select 1 from produtos where id = p_produto and empresa_id = c.empresa_id) then raise exception 'Produto de outra empresa.'; end if;
  insert into est_inv_itens(empresa_id, contagem_id, produto_id, lote_id, classe) values (c.empresa_id, c.id, p_produto, p_lote, 'C')
  on conflict (contagem_id, produto_id, lote_id) do update set produto_id = excluded.produto_id returning id into v_id;
  return v_id;
end $$;
revoke all on function public.est_inv_incluir(uuid, uuid, uuid) from public, anon;
grant execute on function public.est_inv_incluir(uuid, uuid, uuid) to authenticated;

-- envia para aprovação (todos contados); itens ok são encerrados sem ajuste
create or replace function public.est_inv_enviar(p_contagem uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c est_inv_contagens; v_users uuid[];
begin
  select * into c from est_inv_contagens where id = p_contagem;
  if c.id is null or not public.pode_estoque(c.empresa_id) then raise exception 'Sem permissão.'; end if;
  if c.situacao <> 'aberta' then raise exception 'Contagem não está aberta.'; end if;
  if exists (select 1 from est_inv_itens where contagem_id = c.id and situacao in ('pendente', 'recontar')) then raise exception 'Há itens sem contagem ou para recontar.'; end if;
  -- sem divergência: aprovada na hora, sem ajuste
  if not exists (select 1 from est_inv_itens where contagem_id = c.id and situacao = 'divergente') then
    update est_inv_contagens set situacao = 'aprovada', enviada_em = now(), decidida_em = now(), decidida_por = 'automático (sem divergência)' where id = c.id;
    return;
  end if;
  update est_inv_contagens set situacao = 'em_aprovacao', enviada_em = now() where id = c.id;
  v_users := _usuarios_papel(c.empresa_id, (_inv_cfg(c.empresa_id)).papeis_aprovacao);
  begin
    perform _notificar_u(c.empresa_id, v_users, 'inventario', 'Inventário nº ' || c.numero || ' com divergências para aprovar',
      (select count(*) from est_inv_itens where contagem_id = c.id and situacao = 'divergente') || ' item(ns) divergente(s).', '#/estoque/inventario?c=' || c.id, c.id, false);
  end;
end $$;
revoke all on function public.est_inv_enviar(uuid) from public, anon;
grant execute on function public.est_inv_enviar(uuid) to authenticated;

-- aprova (gera os ajustes AJ+ e AJ− dos divergentes no Kardex) ou recusa (volta para contar de novo)
create or replace function public.est_inv_aprovar(p_contagem uuid, p_aprovar boolean, p_motivo text default null)
returns int language plpgsql security definer set search_path = public as $$
declare c est_inv_contagens; cfg est_inv_config; it record; v_tipo uuid; v_mov uuid; v_n int := 0; v_q numeric; v_dif numeric;
begin
  select * into c from est_inv_contagens where id = p_contagem;
  if c.id is null then raise exception 'Contagem não encontrada.'; end if;
  cfg := _inv_cfg(c.empresa_id);
  if not exists (select 1 from membros where empresa_id = c.empresa_id and user_id = auth.uid() and papel::text = any(cfg.papeis_aprovacao)) then raise exception 'Sem permissão para aprovar.'; end if;
  if c.situacao <> 'em_aprovacao' then raise exception 'Contagem não está em aprovação.'; end if;
  if not p_aprovar then
    if coalesce(length(trim(p_motivo)), 0) < 5 then raise exception 'Informe o motivo.'; end if;
    update est_inv_contagens set situacao = 'aberta', decidida_por = auth.jwt() ->> 'email', decidida_em = now(), motivo = p_motivo where id = c.id;
    update est_inv_itens set situacao = 'recontar' where contagem_id = c.id and situacao = 'divergente';
    return 0;
  end if;
  for it in select * from est_inv_itens where contagem_id = c.id and situacao = 'divergente' loop
    v_q := coalesce(it.recontado, it.contado);
    v_dif := v_q - it.saldo_sistema;
    continue when v_dif = 0;
    select id into v_tipo from est_tipos_movimento where empresa_id = c.empresa_id and codigo = case when v_dif > 0 then 'AJ+' else 'AJ-' end and ativo;
    if v_tipo is null then raise exception 'Tipo de movimento % não configurado.', case when v_dif > 0 then 'AJ+' else 'AJ-' end; end if;
    insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, documento, observacao)
    values (c.empresa_id, current_date, it.produto_id, c.local_id, it.lote_id, v_tipo, v_dif, case when v_dif > 0 then nullif(it.custo, 0) end,
            'INV ' || c.numero, left(coalesce(it.justificativa, 'Inventário cíclico'), 200))
    returning id into v_mov;
    update est_inv_itens set situacao = 'ajustado', movimento_id = v_mov where id = it.id;
    v_n := v_n + 1;
  end loop;
  update est_inv_contagens set situacao = 'aprovada', decidida_por = auth.jwt() ->> 'email', decidida_em = now(), motivo = p_motivo where id = c.id;
  return v_n;
end $$;
revoke all on function public.est_inv_aprovar(uuid, boolean, text) from public, anon;
grant execute on function public.est_inv_aprovar(uuid, boolean, text) to authenticated;

create or replace function public.est_inv_cancelar(p_contagem uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare c est_inv_contagens;
begin
  select * into c from est_inv_contagens where id = p_contagem;
  if c.id is null or not public.pode_editar(c.empresa_id) then raise exception 'Sem permissão.'; end if;
  if c.situacao not in ('aberta', 'em_aprovacao') then raise exception 'Contagem encerrada.'; end if;
  if coalesce(length(trim(p_motivo)), 0) < 5 then raise exception 'Informe o motivo.'; end if;
  update est_inv_contagens set situacao = 'cancelada', decidida_por = auth.jwt() ->> 'email', decidida_em = now(), motivo = p_motivo where id = c.id;
end $$;
revoke all on function public.est_inv_cancelar(uuid, text) from public, anon;
grant execute on function public.est_inv_cancelar(uuid, text) to authenticated;

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('inventario', 'Compras', 'Inventário para aprovar', 'Contagem do inventário cíclico com divergências esperando aprovação.', false, 42)
on conflict (codigo) do nothing;

-- conferência: 3 tabelas e 7 funções
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('est_inv_config', 'est_inv_contagens', 'est_inv_itens')) as tabelas,
       (select count(*) from pg_proc where proname in ('est_inv_abc', 'est_inv_gerar', 'est_inv_contar', 'est_inv_incluir', 'est_inv_enviar', 'est_inv_aprovar', 'est_inv_cancelar')) as funcoes;
