-- 185 — devolução ao almoxarifado
-- O material que sobrou de uma requisição volta ao almoxarifado pelo mesmo caminho por onde saiu:
--   * só o que foi entregue e ainda não foi devolvido nem estornado;
--   * volta ao custo em que saiu (o custo médio não muda por causa da devolução) e ao mesmo centro de custo, que tem o consumo reduzido;
--   * material avariado é registrado, mas não volta ao estoque: continua como consumo do setor;
--   * prazo para devolver em dias, por parâmetro (30 por padrão; vazio = sem prazo).
-- Aditivo: nada é apagado.

alter table public.alm_config add column if not exists devolucao_dias int check (devolucao_dias is null or devolucao_dias between 1 and 365);
update public.alm_config set devolucao_dias = 30 where devolucao_dias is null;   -- empresas que já usam o almoxarifado começam com 30 dias
alter table public.alm_config alter column devolucao_dias set default 30;
alter table public.alm_entrega_itens add column if not exists qtd_devolvida numeric(18,4) not null default 0 check (qtd_devolvida >= 0 and qtd_devolvida <> 'NaN'::numeric);

create table if not exists public.alm_devolucoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  requisicao_id uuid not null references public.alm_requisicoes(id),
  recebido_por uuid default auth.uid(), recebido_nome text,
  devolveu_colaborador_id uuid, devolveu_nome text not null, cracha_lido boolean not null default false,
  motivo text not null check (length(motivo) between 3 and 300),
  criado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create table if not exists public.alm_devolucao_itens (
  id uuid primary key default gen_random_uuid(),
  devolucao_id uuid not null references public.alm_devolucoes(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  entrega_item_id uuid not null references public.alm_entrega_itens(id),
  produto_id uuid not null references public.produtos(id),
  local_id uuid references public.est_locais(id),
  lote_id uuid references public.est_lotes(id),
  quantidade numeric(18,4) not null check (quantidade > 0 and quantidade <> 'NaN'::numeric),
  estado text not null default 'boa' check (estado in ('boa', 'avariada')),
  movimento_id uuid references public.est_movimentos(id)
);
create index if not exists alm_dev_req on public.alm_devolucoes (requisicao_id);
create index if not exists alm_dev_itens on public.alm_devolucao_itens (entrega_item_id);

alter table public.alm_devolucoes enable row level security;
alter table public.alm_devolucao_itens enable row level security;
revoke all on public.alm_devolucoes, public.alm_devolucao_itens from anon, authenticated;
grant select on public.alm_devolucoes, public.alm_devolucao_itens to authenticated;
drop policy if exists alm_devolucoes_sel on public.alm_devolucoes;
create policy alm_devolucoes_sel on public.alm_devolucoes for select to authenticated using (public.alm_almoxarife(empresa_id) or public.alm_aprovador(empresa_id)
  or exists (select 1 from alm_requisicoes r where r.id = requisicao_id and r.solicitante_id = auth.uid()));
drop policy if exists alm_devolucao_itens_sel on public.alm_devolucao_itens;
create policy alm_devolucao_itens_sel on public.alm_devolucao_itens for select to authenticated using (devolucao_id in (select id from alm_devolucoes));
drop trigger if exists zz_auditoria on public.alm_devolucoes;
create trigger zz_auditoria after insert or update or delete on public.alm_devolucoes for each row execute function public._auditar();

-- o tipo de movimento da devolução: entrada que forma custo, pelo custo informado (o da saída); só a plataforma lança
insert into est_tipos_movimento(empresa_id, codigo, nome, sentido, afeta_custo, gera_financeiro, documento, sistema, papeis_manual)
select e.empresa_id, 'DEVALM', 'Devolução ao almoxarifado', 'E', true, false, 'requisicao', true, '{}'::text[]
  from (select distinct empresa_id from est_tipos_movimento) e
 where not exists (select 1 from est_tipos_movimento t where t.empresa_id = e.empresa_id and t.codigo = 'DEVALM');

create or replace function public._alm_tipo_devolucao(p_empresa uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from est_tipos_movimento where empresa_id = p_empresa and codigo = 'DEVALM' and ativo;
  if v is null then
    insert into est_tipos_movimento(empresa_id, codigo, nome, sentido, afeta_custo, gera_financeiro, documento, sistema, papeis_manual)
    values (p_empresa, 'DEVALM', 'Devolução ao almoxarifado', 'E', true, false, 'requisicao', true, '{}'::text[])
    on conflict do nothing returning id into v;
    if v is null then select id into v from est_tipos_movimento where empresa_id = p_empresa and codigo = 'DEVALM'; end if;
  end if;
  if v is null or not (select ativo from est_tipos_movimento where id = v) then raise exception 'O tipo de movimento Devolução ao almoxarifado está inativo (Estoque › Parâmetros › Tipos de movimento).'; end if;
  return v;
end $$;

-- o que ainda pode voltar de uma requisição
create or replace function public.alm_devolviveis(p_requisicao uuid)
returns table (entrega_item_id uuid, entregue_em timestamptz, retirou_nome text, produto_id uuid, codigo text, descricao text, unidade text, local_id uuid, local_nome text,
               lote_id uuid, lote text, entregue numeric, devolvido numeric, pode_devolver numeric, prazo_ate date)
language plpgsql stable security definer set search_path = public as $$
declare r alm_requisicoes; v_dias int;
begin
  select * into r from alm_requisicoes where id = p_requisicao;
  if not found or not (public.alm_almoxarife(r.empresa_id) or r.solicitante_id = auth.uid()) then raise exception 'Sem acesso a esta requisição.'; end if;
  v_dias := (select devolucao_dias from alm_config where empresa_id = r.empresa_id);
  return query
  select ei.id, en.entregue_em, en.retirou_nome, ei.produto_id, p.codigo::text, p.descricao::text, p.unidade::text, ei.local_id, l.nome::text, ei.lote_id, lt.codigo::text,
         ei.quantidade, ei.qtd_devolvida, ei.quantidade - ei.qtd_devolvida,
         case when v_dias is null then null else ((en.entregue_em at time zone 'America/Recife')::date + v_dias) end
    from alm_entrega_itens ei join alm_entregas en on en.id = ei.entrega_id join produtos p on p.id = ei.produto_id
    left join est_locais l on l.id = ei.local_id left join est_lotes lt on lt.id = ei.lote_id
   where en.requisicao_id = p_requisicao and ei.estornado_em is null and ei.quantidade - ei.qtd_devolvida > 0
   order by en.entregue_em, p.descricao;
end $$;

-- registra a devolução. p_itens: [{"entrega_item_id": "...", "quantidade": 2, "estado": "boa"|"avariada"}]
create or replace function public.alm_devolver(p_requisicao uuid, p_itens jsonb, p_motivo text, p_devolveu uuid default null, p_devolveu_nome text default null, p_cracha_codigo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r alm_requisicoes; cfg alm_config; k rh_colaboradores; it jsonb; ei alm_entrega_itens; en alm_entregas; om est_movimentos; v_q numeric; v_est text; v_dev uuid; v_num int;
  v_tm uuid; v_mov uuid; v_nome text; v_cracha boolean; v_hoje date := (now() at time zone 'America/Recife')::date; v_n int := 0; v_val numeric := 0; v_v numeric; v_dias int;
begin
  select * into r from alm_requisicoes where id = p_requisicao;
  if not found or not public.alm_almoxarife(r.empresa_id) then raise exception 'Só quem atende o almoxarifado recebe a devolução.'; end if;
  select * into cfg from alm_config where empresa_id = r.empresa_id;
  if jsonb_typeof(coalesce(p_itens, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Informe o que está sendo devolvido.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Informe o motivo da devolução.'; end if;
  if p_devolveu is not null then
    select * into k from rh_colaboradores where id = p_devolveu and empresa_id = r.empresa_id;
    if not found then raise exception 'Quem devolve não é colaborador desta empresa.'; end if;
  end if;
  v_nome := coalesce(k.nome, nullif(trim(coalesce(p_devolveu_nome, '')), ''));
  if v_nome is null then raise exception 'Identifique quem está devolvendo (crachá ou nome).'; end if;
  v_cracha := public._alm_cracha_confere(r.empresa_id, p_cracha_codigo, p_devolveu, p_devolveu_nome);
  v_tm := public._alm_tipo_devolucao(r.empresa_id);
  perform pg_advisory_xact_lock(hashtext('alm_dev:' || r.empresa_id::text));
  select coalesce(max(numero), 0) + 1 into v_num from alm_devolucoes where empresa_id = r.empresa_id;
  insert into alm_devolucoes (empresa_id, numero, requisicao_id, recebido_nome, devolveu_colaborador_id, devolveu_nome, cracha_lido, motivo)
  values (r.empresa_id, v_num, r.id, public._alm_nome(r.empresa_id), k.id, v_nome, v_cracha, left(trim(p_motivo), 300)) returning id into v_dev;
  for it in select * from jsonb_array_elements(p_itens) loop
    v_q := (it ->> 'quantidade')::numeric;
    if v_q is null or v_q = 'NaN'::numeric then raise exception 'Quantidade inválida.'; end if;
    if v_q <= 0 then continue; end if;
    v_est := coalesce(it ->> 'estado', 'boa');
    if v_est not in ('boa', 'avariada') then raise exception 'Estado inválido: boa ou avariada.'; end if;
    select * into ei from alm_entrega_itens where id = (it ->> 'entrega_item_id')::uuid for update;
    select * into en from alm_entregas where id = ei.entrega_id;
    if ei.id is null or en.requisicao_id <> r.id then raise exception 'Item que não foi entregue nesta requisição.'; end if;
    if ei.estornado_em is not null then raise exception 'Esta entrega foi estornada: não há o que devolver.'; end if;
    if v_q > ei.quantidade - ei.qtd_devolvida + 0.00005 then
      raise exception 'Devolução de % maior que o entregue e ainda não devolvido (%).', (select codigo from produtos where id = ei.produto_id), ei.quantidade - ei.qtd_devolvida;
    end if;
    v_dias := cfg.devolucao_dias;
    if v_dias is not null and (en.entregue_em at time zone 'America/Recife')::date + v_dias < v_hoje then
      raise exception 'O prazo de devolução de % dias terminou para %, entregue em %.', v_dias, (select codigo from produtos where id = ei.produto_id), to_char(en.entregue_em at time zone 'America/Recife', 'DD/MM/YYYY');
    end if;
    v_mov := null;
    if v_est = 'boa' then   -- volta ao mesmo local e lote, ao custo em que saiu, no centro de custo que consumiu
      select * into om from est_movimentos where id = ei.movimento_id;
      begin
        insert into est_movimentos (empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, documento, observacao, centro_custo_id)
        values (r.empresa_id, v_hoje, ei.produto_id, ei.local_id, ei.lote_id, v_tm, v_q, coalesce(om.custo_unitario, 0), 'DV ' || v_num,
                left('Devolução da requisição nº ' || r.numero || ' — ' || v_nome || ': ' || trim(p_motivo), 200), om.centro_custo_id)
        returning id, valor into v_mov, v_v;
      exception when others then
        raise exception 'Item %: %', (select codigo from produtos where id = ei.produto_id), sqlerrm;
      end;
      v_val := v_val + coalesce(v_v, 0);
    end if;
    insert into alm_devolucao_itens (devolucao_id, empresa_id, entrega_item_id, produto_id, local_id, lote_id, quantidade, estado, movimento_id)
    values (v_dev, r.empresa_id, ei.id, ei.produto_id, ei.local_id, ei.lote_id, v_q, v_est, v_mov);
    update alm_entrega_itens set qtd_devolvida = qtd_devolvida + v_q where id = ei.id;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Informe a quantidade devolvida de pelo menos um item.'; end if;
  return jsonb_build_object('devolucao_id', v_dev, 'numero', v_num, 'itens', v_n, 'valor', round(v_val, 2));
end $$;

-- a devolução só entra pela tela do almoxarifado: lançada à mão no Kardex, ficaria sem o vínculo com a entrega
create or replace function public._alm_devalm_protege() returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and exists (select 1 from est_tipos_movimento t where t.id = new.tipo_movimento_id and t.codigo = 'DEVALM') then
    raise exception 'Devolução ao almoxarifado é registrada em Requisição de Material, na requisição de onde o material saiu.';
  end if;
  return new;
end $$;
drop trigger if exists est_movimentos_a_devalm on public.est_movimentos;
create trigger est_movimentos_a_devalm before insert on public.est_movimentos for each row execute function public._alm_devalm_protege();

-- prazo da devolução (parâmetro do almoxarifado)
create or replace function public.alm_devolucao_salvar(p_empresa uuid, p_dias int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.alm_gerencia(p_empresa) then raise exception 'Só o administrador ou o diretor muda os parâmetros do almoxarifado'; end if;
  if p_dias is not null and (p_dias < 1 or p_dias > 365) then raise exception 'Prazo de 1 a 365 dias, ou vazio para sem prazo.'; end if;
  if not exists (select 1 from alm_config where empresa_id = p_empresa) then raise exception 'Salve primeiro os parâmetros do almoxarifado.'; end if;
  update alm_config set devolucao_dias = p_dias, atualizado_em = now() where empresa_id = p_empresa;
end $$;

-- o estorno de uma entrega já devolvida em parte não pode devolver ao estoque o que já voltou pela devolução
create or replace function public._alm_entrega_estorno_protege() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estornado_em is not null and old.estornado_em is null and old.qtd_devolvida > 0 then
    raise exception 'Parte deste item já foi devolvida ao almoxarifado: o estorno da entrega não é possível. Registre a devolução do restante.';
  end if;
  return new;
end $$;
drop trigger if exists alm_entrega_itens_estorno on public.alm_entrega_itens;
create trigger alm_entrega_itens_estorno before update on public.alm_entrega_itens for each row execute function public._alm_entrega_estorno_protege();

do $$ declare r record; begin
  for r in select p.oid::regprocedure f, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('_alm_tipo_devolucao', 'alm_devolviveis', 'alm_devolver', 'alm_devolucao_salvar', '_alm_entrega_estorno_protege', '_alm_devalm_protege') loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
    if r.proname !~ '^_' then execute format('grant execute on function %s to authenticated', r.f); end if;
  end loop;
end $$;
