-- 192 — aprovação de perda e ajuste acima de um valor (parâmetro; desligado por padrão)
-- Ligado (Estoque › Parâmetros › Travas), um lançamento à mão dos tipos escolhidos (perda e ajustes, por padrão) cujo valor passa
-- do limite não entra direto no Kardex: vira um pedido de aprovação. Administrador, diretor ou financeiro (por parâmetro) aprovam
-- ou recusam; quem pediu nunca aprova. Aprovado, o lançamento entra com a data e os dados do pedido.
-- O pedido passa antes por todas as regras do lançamento à mão (perfil do tipo, documento, datas, saldo, local congelado):
-- o que não entraria direto também não vira pedido.
-- Aditivo: nada é apagado.

alter table public.est_config add column if not exists aprov_limite numeric(16,2) check (aprov_limite is null or (aprov_limite > 0 and aprov_limite <> 'NaN'::numeric));
alter table public.est_config add column if not exists aprov_tipos text[] not null default '{PERDA,AJ+,AJ-}';
alter table public.est_config add column if not exists aprov_papeis text[] not null default '{admin,diretor,financeiro}';

create table if not exists public.est_mov_aprovacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  situacao text not null default 'pendente' check (situacao in ('pendente', 'aprovado', 'recusado', 'cancelado')),
  data date not null,
  produto_id uuid not null references public.produtos(id),
  local_id uuid not null references public.est_locais(id),
  lote_id uuid references public.est_lotes(id),
  tipo_movimento_id uuid not null references public.est_tipos_movimento(id),
  quantidade numeric(18,4) not null check (quantidade <> 0 and quantidade <> 'NaN'::numeric),
  custo_unitario numeric(18,6) check (custo_unitario is null or custo_unitario <> 'NaN'::numeric),
  documento text, observacao text, centro_custo_id uuid,
  valor_estimado numeric(16,2) not null,
  pedido_por uuid not null default auth.uid(), pedido_nome text, pedido_em timestamptz not null default now(),
  decidido_por uuid, decidido_nome text, decidido_em timestamptz, motivo text check (length(motivo) <= 300),
  movimento_id uuid references public.est_movimentos(id),
  unique (empresa_id, numero)
);
create index if not exists est_mov_aprov_pend on public.est_mov_aprovacoes (empresa_id) where situacao = 'pendente';
alter table public.est_mov_aprovacoes enable row level security;
revoke all on public.est_mov_aprovacoes from anon, authenticated;
grant select on public.est_mov_aprovacoes to authenticated;
drop policy if exists est_mov_aprov_sel on public.est_mov_aprovacoes;
create policy est_mov_aprov_sel on public.est_mov_aprovacoes for select to authenticated using (empresa_id in (select public.est_empresas_que_vejo()));
drop trigger if exists zz_auditoria on public.est_mov_aprovacoes;
create trigger zz_auditoria after insert or update or delete on public.est_mov_aprovacoes for each row execute function public._auditar();

-- valor do lançamento: a quantidade ao custo informado ou, sem ele, ao custo médio de agora
-- (sem privilégio: lê o custo médio com as regras de quem chama, inclusive a contagem cega)
create or replace function public._est_aprov_valor(p_produto uuid, p_qtd numeric, p_custo numeric) returns numeric language sql stable set search_path = public as $$
  select round(abs(p_qtd) * coalesce(p_custo, (select c.custo_medio from est_custos c where c.produto_id = p_produto), 0), 2);
$$;

-- grava o pedido a partir do lançamento que acabou de passar por todas as regras.
-- Só funciona de dentro do gatilho do lançamento (pg_trigger_depth), no modo "pedir aprovação": não há como gravar um pedido sem passar pelas regras.
create or replace function public._est_aprov_registrar(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare v_emp uuid := (p ->> 'empresa_id')::uuid; v_num int; v_id uuid; v_val numeric; v_users uuid[];
begin
  if pg_trigger_depth() < 1 or coalesce(current_setting('app.est_aprov_pedir', true), '') <> 'sim' then raise exception 'Pedido de aprovação é feito pelo Kardex.'; end if;
  if auth.uid() is null or not public.pode_estoque(v_emp) then raise exception 'Sem permissão no estoque.'; end if;
  -- o motor do saldo ainda não rodou: confere aqui o saldo da saída, como ele conferiria
  if (p ->> 'quantidade')::numeric < 0 and not coalesce((select permite_negativo from est_locais where id = (p ->> 'local_id')::uuid), false)
     and coalesce((select sum(quantidade) from est_saldos where produto_id = (p ->> 'produto_id')::uuid and local_id = (p ->> 'local_id')::uuid
                    and lote_id is not distinct from nullif(p ->> 'lote_id', '')::uuid), 0) + (p ->> 'quantidade')::numeric < 0 then
    raise exception 'Saldo insuficiente no local para este lançamento.';
  end if;
  perform pg_advisory_xact_lock(hashtext('est_aprov:' || v_emp::text));
  select coalesce(max(numero), 0) + 1 into v_num from est_mov_aprovacoes where empresa_id = v_emp;
  v_val := public._est_aprov_valor((p ->> 'produto_id')::uuid, (p ->> 'quantidade')::numeric, nullif(p ->> 'custo_unitario', '')::numeric);
  insert into est_mov_aprovacoes (empresa_id, numero, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, documento, observacao, centro_custo_id, valor_estimado, pedido_por, pedido_nome)
  values (v_emp, v_num, (p ->> 'data')::date, (p ->> 'produto_id')::uuid, (p ->> 'local_id')::uuid, nullif(p ->> 'lote_id', '')::uuid, (p ->> 'tipo_movimento_id')::uuid,
          (p ->> 'quantidade')::numeric, nullif(p ->> 'custo_unitario', '')::numeric, left(nullif(trim(coalesce(p ->> 'documento', '')), ''), 60),
          left(nullif(trim(coalesce(p ->> 'observacao', '')), ''), 200), nullif(p ->> 'centro_custo_id', '')::uuid, v_val, auth.uid(), public._alm_nome(v_emp))
  returning id into v_id;
  perform set_config('app.est_aprov_id', v_id::text, true);
  select array_agg(m.user_id) into v_users from membros m join est_config c on c.empresa_id = m.empresa_id
   where m.empresa_id = v_emp and m.papel::text = any(c.aprov_papeis) and m.user_id <> auth.uid();
  begin
    perform _notificar_u(v_emp, v_users, 'estoque', 'Aprovar lançamento de estoque nº ' || v_num || ' (' || to_char(v_val, 'FMR$ 999G999G990D00') || ')',
      (select codigo || ' ' || descricao from produtos where id = (p ->> 'produto_id')::uuid) || ' · ' || (p ->> 'quantidade') || ' · ' || coalesce(p ->> 'observacao', ''),
      '#/estoque/kardex?aprovacoes=1', v_id, false);
  exception when others then null; end;
  return v_id;
end $$;
revoke all on function public._est_aprov_registrar(jsonb) from public, anon;
grant execute on function public._est_aprov_registrar(jsonb) to authenticated;   -- o gatilho roda como a pessoa; fora do gatilho a função se recusa

-- a trava: depois das guardas do lançamento e antes do motor que atualiza o saldo (por isso o nome, na ordem alfabética dos gatilhos).
-- Só vale para o lançamento à mão.
create or replace function public._est_mov_aprov() returns trigger language plpgsql set search_path = public as $$
declare c record; v_cod text; v_val numeric;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;   -- plataforma (aprovação, notas, inventário etc.)
  if coalesce(current_setting('app.est_aprov_pedir', true), '') = 'sim' then   -- modo "pedir aprovação": passou em todas as regras; vira pedido, não movimento
    perform public._est_aprov_registrar(to_jsonb(new));
    return null;
  end if;
  select aprov_limite, aprov_tipos into c from est_config where empresa_id = new.empresa_id;
  if c.aprov_limite is null then return new; end if;
  select codigo into v_cod from est_tipos_movimento where id = new.tipo_movimento_id;
  v_val := public._est_aprov_valor(new.produto_id, new.quantidade, new.custo_unitario);
  if v_cod = any(c.aprov_tipos) and v_val > c.aprov_limite then
    raise exception 'Lançamento de % acima do limite de % para este tipo: peça a aprovação (botão Pedir aprovação).',
      to_char(v_val, 'FMR$ 999G999G990D00'), to_char(c.aprov_limite, 'FMR$ 999G999G990D00') using hint = 'est_aprovacao_necessaria';
  end if;
  return new;
end $$;
revoke all on function public._est_mov_aprov() from public, anon, authenticated;
drop trigger if exists est_movimentos_l_aprov on public.est_movimentos;
create trigger est_movimentos_l_aprov before insert on public.est_movimentos for each row execute function public._est_mov_aprov();

-- pede a aprovação: o lançamento passa por todas as regras do lançamento à mão, como a própria pessoa, e vira pedido
create or replace function public.est_mov_pedir(p jsonb) returns uuid language plpgsql set search_path = public as $$
declare v_emp uuid := (p ->> 'empresa_id')::uuid; c record; v_id text;
begin
  if current_user <> 'authenticated' then raise exception 'Pedido de aprovação é feito pela tela do Kardex.'; end if;
  select aprov_limite, aprov_tipos into c from est_config where empresa_id = v_emp;
  if c.aprov_limite is null then raise exception 'A aprovação por valor não está ligada: lance direto.'; end if;
  if (select codigo from est_tipos_movimento where id = (p ->> 'tipo_movimento_id')::uuid and empresa_id = v_emp) <> all(c.aprov_tipos)
     or public._est_aprov_valor((p ->> 'produto_id')::uuid, (p ->> 'quantidade')::numeric, nullif(p ->> 'custo_unitario', '')::numeric) <= c.aprov_limite then
    raise exception 'Este lançamento não precisa de aprovação: lance direto.';
  end if;
  perform set_config('app.est_aprov_pedir', 'sim', true);
  perform set_config('app.est_aprov_id', '', true);
  insert into est_movimentos (empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, documento, observacao, centro_custo_id)
  values (v_emp, (p ->> 'data')::date, (p ->> 'produto_id')::uuid, (p ->> 'local_id')::uuid, nullif(p ->> 'lote_id', '')::uuid, (p ->> 'tipo_movimento_id')::uuid,
          (p ->> 'quantidade')::numeric, nullif(p ->> 'custo_unitario', '')::numeric, nullif(p ->> 'documento', ''), nullif(p ->> 'observacao', ''), nullif(p ->> 'centro_custo_id', '')::uuid);
  perform set_config('app.est_aprov_pedir', '', true);
  v_id := nullif(current_setting('app.est_aprov_id', true), '');
  if v_id is null then raise exception 'O pedido não foi gravado.'; end if;
  return v_id::uuid;
end $$;
revoke all on function public.est_mov_pedir(jsonb) from public, anon;
grant execute on function public.est_mov_pedir(jsonb) to authenticated;

-- decide: aprovar lança no Kardex com a data e os dados do pedido; recusar exige o motivo; quem pediu não decide
create or replace function public.est_mov_decidir(p_id uuid, p_aprova boolean, p_motivo text default null) returns text language plpgsql security definer set search_path = public as $$
declare a est_mov_aprovacoes; v_mov uuid;
begin
  select * into a from est_mov_aprovacoes where id = p_id for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if not exists (select 1 from membros m join est_config c on c.empresa_id = m.empresa_id where m.empresa_id = a.empresa_id and m.user_id = auth.uid() and m.papel::text = any(c.aprov_papeis))
     or not public._mfa_ok(a.empresa_id) then raise exception 'Seu perfil não aprova lançamentos de estoque.'; end if;
  if a.situacao <> 'pendente' then raise exception 'Este pedido já foi decidido.'; end if;
  if a.pedido_por = auth.uid() then raise exception 'Quem pediu não aprova o próprio lançamento.'; end if;
  if not coalesce(p_aprova, false) then
    if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo da recusa.'; end if;
    update est_mov_aprovacoes set situacao = 'recusado', decidido_por = auth.uid(), decidido_nome = public._alm_nome(a.empresa_id), decidido_em = now(), motivo = left(trim(p_motivo), 300) where id = a.id;
    return 'recusado';
  end if;
  insert into est_movimentos (empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, documento, observacao, centro_custo_id)
  values (a.empresa_id, a.data, a.produto_id, a.local_id, a.lote_id, a.tipo_movimento_id, a.quantidade, a.custo_unitario,
          coalesce(a.documento, 'AP ' || a.numero), left(coalesce(a.observacao, '') || ' · aprovado por ' || coalesce(public._alm_nome(a.empresa_id), ''), 200), a.centro_custo_id)
  returning id into v_mov;
  update est_mov_aprovacoes set situacao = 'aprovado', decidido_por = auth.uid(), decidido_nome = public._alm_nome(a.empresa_id), decidido_em = now(),
         motivo = left(nullif(trim(coalesce(p_motivo, '')), ''), 300), movimento_id = v_mov where id = a.id;
  return 'aprovado';
end $$;

-- quem pediu desiste
create or replace function public.est_mov_cancelar_pedido(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update est_mov_aprovacoes set situacao = 'cancelado', decidido_por = auth.uid(), decidido_em = now() where id = p_id and situacao = 'pendente' and pedido_por = auth.uid();
  if not found then raise exception 'Só quem pediu cancela, e só enquanto está pendente.'; end if;
end $$;

-- parâmetros (administrador)
create or replace function public.est_aprov_salvar(p_empresa uuid, p_limite numeric, p_tipos text[], p_papeis text[]) returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(p_empresa) or not _mfa_ok(p_empresa) then raise exception 'Só o administrador muda a aprovação por valor.'; end if;
  if p_limite is not null and (p_limite = 'NaN'::numeric or p_limite <= 0) then raise exception 'Limite inválido.'; end if;
  if p_papeis is null or cardinality(p_papeis) = 0 or not (p_papeis <@ array['admin', 'diretor', 'financeiro']) then raise exception 'Quem aprova: administrador, diretor ou financeiro.'; end if;
  if p_tipos is null or cardinality(p_tipos) = 0 then raise exception 'Escolha os tipos de movimento que pedem aprovação.'; end if;
  insert into est_config (empresa_id) values (p_empresa) on conflict (empresa_id) do nothing;
  update est_config set aprov_limite = p_limite, aprov_tipos = p_tipos, aprov_papeis = p_papeis, atualizado_em = now(), atualizado_por = auth.uid() where empresa_id = p_empresa;
end $$;

revoke all on function public.est_mov_decidir(uuid, boolean, text), public.est_mov_cancelar_pedido(uuid), public.est_aprov_salvar(uuid, numeric, text[], text[]), public._est_aprov_valor(uuid, numeric, numeric) from public, anon;
grant execute on function public._est_aprov_valor(uuid, numeric, numeric) to authenticated;
grant execute on function public.est_mov_decidir(uuid, boolean, text), public.est_mov_cancelar_pedido(uuid), public.est_aprov_salvar(uuid, numeric, text[], text[]) to authenticated;
