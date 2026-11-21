-- 176 — Requisição de material ao almoxarifado, etapa 1 (21/11/2026, Renan): padronizar as retiradas e registrar tudo.
-- Regras decididas: qualquer pessoa pede; aprovação só na exceção (item controlado ou valor acima do parâmetro); o almoxarife
-- separa e entrega (em parte, se faltar), sempre identificando quem retirou (crachá ou nome); retirada no balcão registrada na
-- hora; a entrega dá saída no Kardex (tipo REQINT) com o custo no centro de custo de quem recebeu.
-- Fica para a etapa 2: cota por setor e ficha de EPI. Toda gravação passa pelas funções. Aditivo.

-- ---------------------------------------------------------------- parâmetros
create table if not exists public.alm_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  valor_aprovacao numeric(14,2) check (valor_aprovacao is null or valor_aprovacao >= 0),   -- pedido acima deste valor (ao custo médio) pede aprovação; nulo = sem regra de valor
  papeis_almoxarife text[] not null default '{admin,diretor,compras}',      -- perfis que atendem e entregam
  almoxarifes uuid[] not null default '{}',                                  -- pessoas a mais que atendem (qualquer perfil)
  papeis_aprovador text[] not null default '{admin,diretor}',
  aprovadores uuid[] not null default '{}',
  exigir_cracha boolean not null default false,       -- entrega só com o crachá lido
  permitir_balcao boolean not null default true,      -- retirada sem pedido prévio, registrada na hora pelo almoxarife
  locais uuid[],                                      -- locais do almoxarifado; nulo = insumos, manutenção e uso e consumo
  atualizado_em timestamptz not null default now()
);
create table if not exists public.alm_controlados (     -- itens que sempre pedem aprovação
  produto_id uuid primary key references public.produtos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  marcado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------- requisições, itens e entregas
create table if not exists public.alm_requisicoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  situacao text not null default 'aberta' check (situacao in ('aprovacao', 'aberta', 'parcial', 'atendida', 'encerrada', 'recusada', 'cancelada')),
  origem text not null default 'pedido' check (origem in ('pedido', 'balcao')),
  solicitante_id uuid default auth.uid(), solicitante_nome text,
  colaborador_id uuid references public.rh_colaboradores(id) on delete set null,   -- para quem é o material
  para_nome text, setor text, centro_custo_id uuid references public.centros_custo(id) on delete set null,
  motivo text check (length(motivo) <= 500),
  valor_estimado numeric(14,2) not null default 0,
  motivo_aprovacao text,                               -- por que precisou de aprovação
  decidido_por uuid, decidido_nome text, decidido_em timestamptz, decisao_motivo text,
  encerrado_motivo text,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists alm_req_sit on public.alm_requisicoes (empresa_id, situacao, criado_em desc);
create index if not exists alm_req_sol on public.alm_requisicoes (empresa_id, solicitante_id, criado_em desc);

create table if not exists public.alm_requisicao_itens (
  id uuid primary key default gen_random_uuid(),
  requisicao_id uuid not null references public.alm_requisicoes(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  produto_id uuid not null references public.produtos(id),
  codigo text not null, descricao text not null, unidade text,       -- como estava no pedido (quem pede pode não ter acesso ao cadastro)
  quantidade numeric(18,4) not null check (quantidade > 0),
  qtd_entregue numeric(18,4) not null default 0,
  controlado boolean not null default false,
  observacao text check (length(observacao) <= 200)
);
create index if not exists alm_req_itens_req on public.alm_requisicao_itens (requisicao_id);

create table if not exists public.alm_entregas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  requisicao_id uuid not null references public.alm_requisicoes(id) on delete cascade,
  entregue_por uuid default auth.uid(), entregue_nome text,
  retirou_colaborador_id uuid references public.rh_colaboradores(id) on delete set null,
  retirou_nome text not null,
  cracha_lido boolean not null default false,
  valor numeric(14,2) not null default 0,
  observacao text check (length(observacao) <= 300),
  entregue_em timestamptz not null default now()
);
create index if not exists alm_entregas_req on public.alm_entregas (requisicao_id);
create table if not exists public.alm_entrega_itens (
  id uuid primary key default gen_random_uuid(),
  entrega_id uuid not null references public.alm_entregas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  item_id uuid not null references public.alm_requisicao_itens(id) on delete cascade,
  produto_id uuid not null references public.produtos(id),
  local_id uuid not null references public.est_locais(id),
  lote_id uuid references public.est_lotes(id),
  quantidade numeric(18,4) not null check (quantidade > 0),
  movimento_id uuid references public.est_movimentos(id) on delete set null
);
create index if not exists alm_entrega_itens_ent on public.alm_entrega_itens (entrega_id);

-- ---------------------------------------------------------------- quem é quem
create or replace function public.alm_membro(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid());
$$;
create or replace function public.alm_gerencia(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'diretor'));
$$;
create or replace function public.alm_almoxarife(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros m left join alm_config c on c.empresa_id = m.empresa_id
                 where m.empresa_id = p_empresa and m.user_id = auth.uid()
                   and (m.papel::text = any(coalesce(c.papeis_almoxarife, '{admin,diretor,compras}')) or auth.uid() = any(coalesce(c.almoxarifes, '{}'))));
$$;
create or replace function public.alm_aprovador(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros m left join alm_config c on c.empresa_id = m.empresa_id
                 where m.empresa_id = p_empresa and m.user_id = auth.uid()
                   and (m.papel::text = any(coalesce(c.papeis_aprovador, '{admin,diretor}')) or auth.uid() = any(coalesce(c.aprovadores, '{}'))));
$$;
create or replace function public._alm_local(p_empresa uuid, p_local uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from est_locais l left join alm_config c on c.empresa_id = l.empresa_id
                 where l.id = p_local and l.empresa_id = p_empresa and l.ativo
                   and case when c.locais is null then l.finalidade in ('insumo', 'manutencao', 'uso_consumo') else l.id = any(c.locais) end);
$$;
create or replace function public._alm_nome(p_empresa uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(m.nome), ''), (select split_part(u.email, '@', 1) from auth.users u where u.id = auth.uid())) from membros m where m.empresa_id = p_empresa and m.user_id = auth.uid();
$$;
-- valor à brasileira (1.234,56), sem depender da configuração regional do banco
create or replace function public._alm_reais(v numeric) returns text language sql immutable as $$
  select replace(replace(replace(to_char(round(v, 2), 'FM999,999,999,990.00'), ',', '#'), '.', ','), '#', '.');
$$;
revoke all on function public._alm_reais(numeric) from public, anon;
-- avisa um conjunto de pessoas: 'almoxarife' ou 'aprovador'
create or replace function public._alm_avisar(p_empresa uuid, p_quem text, p_titulo text, p_corpo text, p_ref uuid) returns void language plpgsql security definer set search_path = public as $$
declare c alm_config;
begin
  select * into c from alm_config where empresa_id = p_empresa;
  insert into notificacoes(empresa_id, user_id, tipo, titulo, corpo, link, ref_id)
  select p_empresa, m.user_id, 'almoxarifado', p_titulo, p_corpo, '#/almoxarifado?id=' || p_ref, p_ref
    from membros m
   where m.empresa_id = p_empresa and m.user_id is not null and m.user_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
     and case when p_quem = 'aprovador' then m.papel::text = any(coalesce(c.papeis_aprovador, '{admin,diretor}')) or m.user_id = any(coalesce(c.aprovadores, '{}'))
              else m.papel::text = any(coalesce(c.papeis_almoxarife, '{admin,diretor,compras}')) or m.user_id = any(coalesce(c.almoxarifes, '{}')) end;
end $$;
revoke all on function public.alm_membro(uuid), public.alm_gerencia(uuid), public.alm_almoxarife(uuid), public.alm_aprovador(uuid), public._alm_local(uuid, uuid), public._alm_nome(uuid),
  public._alm_avisar(uuid, text, text, text, uuid) from public, anon;
grant execute on function public.alm_membro(uuid), public.alm_gerencia(uuid), public.alm_almoxarife(uuid), public.alm_aprovador(uuid) to authenticated;

-- ---------------------------------------------------------------- leitura
alter table public.alm_config enable row level security;
alter table public.alm_controlados enable row level security;
alter table public.alm_requisicoes enable row level security;
alter table public.alm_requisicao_itens enable row level security;
alter table public.alm_entregas enable row level security;
alter table public.alm_entrega_itens enable row level security;
create or replace function public._alm_ve(p_req uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from alm_requisicoes r
                 where r.id = p_req and (r.solicitante_id = auth.uid() or public.alm_almoxarife(r.empresa_id) or public.alm_aprovador(r.empresa_id)
                    or exists(select 1 from rh_colaboradores k where k.id = r.colaborador_id and k.user_id = auth.uid())));
$$;
revoke all on function public._alm_ve(uuid) from public, anon;
grant execute on function public._alm_ve(uuid) to authenticated;
drop policy if exists alm_config_ler on public.alm_config;
create policy alm_config_ler on public.alm_config for select to authenticated using (public.alm_membro(empresa_id));
drop policy if exists alm_controlados_ler on public.alm_controlados;
create policy alm_controlados_ler on public.alm_controlados for select to authenticated using (public.alm_membro(empresa_id));
drop policy if exists alm_requisicoes_ler on public.alm_requisicoes;
create policy alm_requisicoes_ler on public.alm_requisicoes for select to authenticated using (public._alm_ve(id));
drop policy if exists alm_requisicao_itens_ler on public.alm_requisicao_itens;
create policy alm_requisicao_itens_ler on public.alm_requisicao_itens for select to authenticated using (public._alm_ve(requisicao_id));
drop policy if exists alm_entregas_ler on public.alm_entregas;
create policy alm_entregas_ler on public.alm_entregas for select to authenticated using (public._alm_ve(requisicao_id));
drop policy if exists alm_entrega_itens_ler on public.alm_entrega_itens;
create policy alm_entrega_itens_ler on public.alm_entrega_itens for select to authenticated
  using (exists(select 1 from alm_entregas e where e.id = entrega_id and public._alm_ve(e.requisicao_id)));
do $$ declare t text; begin
  foreach t in array array['alm_config', 'alm_controlados', 'alm_requisicoes', 'alm_requisicao_itens', 'alm_entregas', 'alm_entrega_itens'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- catálogo: o que o almoxarifado tem para entregar
-- produto ativo com saldo num local do almoxarifado, ou cujo local de entrada é um desses locais. O custo só aparece para quem atende ou aprova.
create or replace function public.alm_catalogo(p_empresa uuid)
returns table(produto_id uuid, codigo text, descricao text, unidade text, saldo numeric, controlado boolean, custo numeric, etiqueta text)
language plpgsql stable security definer set search_path = public as $$
declare v_ve boolean := public.alm_almoxarife(p_empresa) or public.alm_aprovador(p_empresa);
begin
  if not public.alm_membro(p_empresa) then raise exception 'Sem acesso a esta empresa'; end if;
  return query
  select p.id, p.codigo, p.descricao, p.unidade,
         coalesce((select sum(s.quantidade) from est_saldos s where s.produto_id = p.id and public._alm_local(p_empresa, s.local_id)), 0),
         exists(select 1 from alm_controlados k where k.produto_id = p.id),
         case when v_ve then (select case when c.quantidade > 0 then round(c.valor / c.quantidade, 4) end from est_custos c where c.produto_id = p.id) end,
         p.etiqueta
    from produtos p
   where p.empresa_id = p_empresa and coalesce(p.ativo, true)
     and (exists(select 1 from est_saldos s where s.produto_id = p.id and s.quantidade <> 0 and public._alm_local(p_empresa, s.local_id))
          or (p.local_padrao_id is not null and public._alm_local(p_empresa, p.local_padrao_id)))
   order by p.descricao;
end $$;

-- saldo do produto em cada local do almoxarifado (para o almoxarife escolher de onde entrega)
create or replace function public.alm_saldos(p_empresa uuid, p_produtos uuid[])
returns table(produto_id uuid, local_id uuid, local_nome text, quantidade numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.alm_almoxarife(p_empresa) then raise exception 'Só quem atende o almoxarifado consulta o saldo por local'; end if;
  return query
  select s.produto_id, s.local_id, l.nome, sum(s.quantidade)
    from est_saldos s join est_locais l on l.id = s.local_id
   where s.empresa_id = p_empresa and s.produto_id = any(p_produtos) and public._alm_local(p_empresa, s.local_id)
   group by s.produto_id, s.local_id, l.nome, l.ordem having sum(s.quantidade) <> 0 order by l.ordem;
end $$;

-- pessoas que podem retirar (para o almoxarife escolher) e a pessoa do crachá lido
create or replace function public.alm_pessoas(p_empresa uuid)
returns table(colaborador_id uuid, nome text, matricula text, setor text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.alm_almoxarife(p_empresa) then raise exception 'Só quem atende o almoxarifado consulta as pessoas'; end if;
  return query select k.id, k.nome, k.matricula, k.setor from rh_colaboradores k where k.empresa_id = p_empresa and k.situacao <> 'desligado' order by k.nome;
end $$;
create or replace function public.alm_cracha(p_empresa uuid, p_codigo text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c crachas; k rh_colaboradores;
begin
  if not public.alm_almoxarife(p_empresa) then raise exception 'Só quem atende o almoxarifado lê o crachá'; end if;
  select * into c from crachas where empresa_id = p_empresa and codigo = trim(p_codigo);
  if not found then return jsonb_build_object('achou', false); end if;
  if c.colaborador_id is not null then select * into k from rh_colaboradores where id = c.colaborador_id; end if;
  return jsonb_build_object('achou', true, 'colaborador_id', c.colaborador_id, 'nome', coalesce(k.nome, c.nome), 'setor', coalesce(k.setor, c.setor), 'tipo', c.tipo,
    'valido', c.status = 'ativo' and (c.validade is null or c.validade >= current_date) and coalesce(k.situacao, 'ativo') <> 'desligado',
    'situacao', case when c.status <> 'ativo' then 'crachá ' || c.status when c.validade < current_date then 'crachá vencido' when k.situacao = 'desligado' then 'pessoa desligada' else 'válido' end);
end $$;

-- ---------------------------------------------------------------- pedir
-- p_itens = [{ "produto_id": uuid, "quantidade": n, "observacao": text }]; p_colaborador = para quem é (só o almoxarife pede por outra pessoa)
create or replace function public.alm_requisitar(p_empresa uuid, p_itens jsonb, p_motivo text default null, p_colaborador uuid default null, p_para_nome text default null, p_origem text default 'pedido')
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg alm_config; k rh_colaboradores; it jsonb; p produtos; v_id uuid; v_num int; v_valor numeric := 0; v_q numeric; v_cu numeric; v_ctrl text[] := '{}'; v_mot text; v_sit text;
  v_eu text := public._alm_nome(p_empresa); v_almox boolean := public.alm_almoxarife(p_empresa);
begin
  if not public.alm_membro(p_empresa) then raise exception 'Sem acesso a esta empresa'; end if;
  if p_origem not in ('pedido', 'balcao') then raise exception 'Origem inválida'; end if;
  if jsonb_typeof(coalesce(p_itens, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Inclua pelo menos um item'; end if;
  if jsonb_array_length(p_itens) > 60 then raise exception 'Muitos itens numa requisição só (máximo 60)'; end if;
  if length(coalesce(p_motivo, '')) > 500 then raise exception 'Motivo muito longo'; end if;
  select * into cfg from alm_config where empresa_id = p_empresa;
  if p_colaborador is not null then
    select * into k from rh_colaboradores where id = p_colaborador and empresa_id = p_empresa;
    if not found then raise exception 'Colaborador não encontrado'; end if;
    if k.user_id is distinct from auth.uid() and not v_almox then raise exception 'Só quem atende o almoxarifado pede em nome de outra pessoa'; end if;
  else
    select * into k from rh_colaboradores where empresa_id = p_empresa and user_id = auth.uid();
    if not found and nullif(trim(coalesce(p_para_nome, '')), '') is not null and not v_almox then raise exception 'Só quem atende o almoxarifado pede em nome de outra pessoa'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('alm_requisicoes:' || p_empresa::text));
  select coalesce(max(numero), 0) + 1 into v_num from alm_requisicoes where empresa_id = p_empresa;
  insert into alm_requisicoes (empresa_id, numero, origem, solicitante_id, solicitante_nome, colaborador_id, para_nome, setor, centro_custo_id, motivo)
  values (p_empresa, v_num, p_origem, auth.uid(), v_eu, k.id, coalesce(k.nome, nullif(trim(coalesce(p_para_nome, '')), ''), v_eu), k.setor, k.centro_custo_id, nullif(trim(coalesce(p_motivo, '')), ''))
  returning id into v_id;
  for it in select * from jsonb_array_elements(p_itens) loop
    select * into p from produtos where id = (it ->> 'produto_id')::uuid and empresa_id = p_empresa;
    if not found then raise exception 'Item que não é desta empresa'; end if;
    v_q := (it ->> 'quantidade')::numeric;
    if v_q is null or v_q <= 0 then raise exception 'Quantidade inválida em %', p.descricao; end if;
    if exists(select 1 from alm_requisicao_itens where requisicao_id = v_id and produto_id = p.id) then raise exception 'O item % está repetido', p.descricao; end if;
    select case when c.quantidade > 0 then c.valor / c.quantidade else 0 end into v_cu from est_custos c where c.produto_id = p.id;
    v_valor := v_valor + v_q * coalesce(v_cu, 0);
    insert into alm_requisicao_itens (requisicao_id, empresa_id, produto_id, codigo, descricao, unidade, quantidade, controlado, observacao)
    values (v_id, p_empresa, p.id, p.codigo, p.descricao, p.unidade, v_q, exists(select 1 from alm_controlados where produto_id = p.id), left(nullif(trim(coalesce(it ->> 'observacao', '')), ''), 200));
    if exists(select 1 from alm_controlados where produto_id = p.id) then v_ctrl := v_ctrl || p.descricao; end if;
  end loop;
  v_mot := nullif(concat_ws('; ',
    case when array_length(v_ctrl, 1) > 0 then 'item controlado: ' || array_to_string(v_ctrl, ', ') end,
    case when cfg.valor_aprovacao is not null and v_valor > cfg.valor_aprovacao then 'valor estimado de R$ ' || public._alm_reais(v_valor) || ' acima do limite de R$ ' || public._alm_reais(cfg.valor_aprovacao) end), '');
  v_sit := case when v_mot is null then 'aberta' else 'aprovacao' end;
  update alm_requisicoes set situacao = v_sit, valor_estimado = round(v_valor, 2), motivo_aprovacao = v_mot where id = v_id;
  if v_sit = 'aprovacao' then
    perform public._alm_avisar(p_empresa, 'aprovador', 'Requisição nº ' || v_num || ' aguarda aprovação', coalesce(v_eu, '') || ': ' || v_mot, v_id);
  elsif p_origem = 'pedido' then
    perform public._alm_avisar(p_empresa, 'almoxarife', 'Nova requisição nº ' || v_num, coalesce(v_eu, '') || ' pediu ' || jsonb_array_length(p_itens) || ' item(ns)', v_id);
  end if;
  return jsonb_build_object('id', v_id, 'numero', v_num, 'situacao', v_sit, 'motivo_aprovacao', v_mot);
end $$;

-- ---------------------------------------------------------------- aprovar ou recusar
create or replace function public.alm_decidir(p_id uuid, p_aprova boolean, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r alm_requisicoes;
begin
  select * into r from alm_requisicoes where id = p_id for update;
  if not found or not public.alm_aprovador(r.empresa_id) then raise exception 'Só quem aprova decide a requisição'; end if;
  if r.situacao <> 'aprovacao' then raise exception 'Esta requisição não está aguardando aprovação'; end if;
  if not coalesce(p_aprova, false) and length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Diga o motivo da recusa'; end if;
  update alm_requisicoes set situacao = case when p_aprova then 'aberta' else 'recusada' end, decidido_por = auth.uid(), decidido_nome = public._alm_nome(r.empresa_id),
    decidido_em = now(), decisao_motivo = left(nullif(trim(coalesce(p_motivo, '')), ''), 300), atualizado_em = now() where id = p_id;
  if r.solicitante_id is not null and r.solicitante_id <> auth.uid() then
    insert into notificacoes(empresa_id, user_id, tipo, titulo, corpo, link, ref_id)
    values (r.empresa_id, r.solicitante_id, 'almoxarifado', 'Requisição nº ' || r.numero || case when p_aprova then ' aprovada' else ' recusada' end, coalesce(nullif(trim(coalesce(p_motivo, '')), ''), 'Aguarde a separação no almoxarifado.'), '#/almoxarifado?id=' || p_id, p_id);
  end if;
  if p_aprova then perform public._alm_avisar(r.empresa_id, 'almoxarife', 'Requisição nº ' || r.numero || ' aprovada', 'Pode separar e entregar.', p_id); end if;
end $$;

-- ---------------------------------------------------------------- entregar
-- p_itens = [{ "item_id": uuid, "quantidade": n, "local_id": uuid }]; identifica sempre quem retirou (colaborador ou nome)
create or replace function public.alm_entregar(p_id uuid, p_itens jsonb, p_retirou uuid default null, p_retirou_nome text default null, p_cracha boolean default false, p_obs text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r alm_requisicoes; cfg alm_config; k rh_colaboradores; it jsonb; i alm_requisicao_itens; p produtos; tm uuid; v_ent uuid; v_q numeric; v_loc uuid; v_mov uuid; v_val numeric := 0; v_v numeric;
  v_resta numeric; v_tira numeric; l record; v_nome text; v_hoje date := (now() at time zone 'America/Recife')::date; v_cc uuid; v_n int := 0;
begin
  select * into r from alm_requisicoes where id = p_id for update;
  if not found or not public.alm_almoxarife(r.empresa_id) then raise exception 'Só quem atende o almoxarifado entrega'; end if;
  if r.situacao not in ('aberta', 'parcial') then raise exception 'Esta requisição não está liberada para entrega (%).', r.situacao; end if;
  if jsonb_typeof(coalesce(p_itens, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Informe o que está sendo entregue'; end if;
  select * into cfg from alm_config where empresa_id = r.empresa_id;
  if coalesce(cfg.exigir_cracha, false) and not coalesce(p_cracha, false) then raise exception 'A entrega exige a leitura do crachá de quem retira'; end if;
  if p_retirou is not null then
    select * into k from rh_colaboradores where id = p_retirou and empresa_id = r.empresa_id;
    if not found then raise exception 'Quem retira não é colaborador desta empresa'; end if;
  end if;
  v_nome := coalesce(k.nome, nullif(trim(coalesce(p_retirou_nome, '')), ''));
  if v_nome is null then raise exception 'Identifique quem está retirando (crachá ou nome)'; end if;
  select id into tm from est_tipos_movimento where empresa_id = r.empresa_id and codigo = 'REQINT' and ativo;
  if tm is null then select id into tm from est_tipos_movimento where empresa_id = r.empresa_id and sentido = 'S' and documento = 'requisicao' and ativo order by codigo limit 1; end if;
  if tm is null then raise exception 'Falta o tipo de movimento de requisição interna (Estoque › Parâmetros › Tipos de movimento)'; end if;
  v_cc := coalesce(k.centro_custo_id, r.centro_custo_id);
  insert into alm_entregas (empresa_id, requisicao_id, entregue_por, entregue_nome, retirou_colaborador_id, retirou_nome, cracha_lido, observacao)
  values (r.empresa_id, p_id, auth.uid(), public._alm_nome(r.empresa_id), k.id, v_nome, coalesce(p_cracha, false), left(nullif(trim(coalesce(p_obs, '')), ''), 300)) returning id into v_ent;
  for it in select * from jsonb_array_elements(p_itens) loop
    v_q := (it ->> 'quantidade')::numeric; if v_q is null or v_q <= 0 then continue; end if;
    select * into i from alm_requisicao_itens where id = (it ->> 'item_id')::uuid and requisicao_id = p_id for update;
    if not found then raise exception 'Item que não é desta requisição'; end if;
    if v_q > i.quantidade - i.qtd_entregue + 0.00005 then raise exception 'Entrega de % maior que o pendente (%).', i.descricao, i.quantidade - i.qtd_entregue; end if;
    v_loc := (it ->> 'local_id')::uuid;
    if not public._alm_local(r.empresa_id, v_loc) then raise exception 'O local de % não é do almoxarifado', i.descricao; end if;
    select * into p from produtos where id = i.produto_id;
    if coalesce(p.controla_lote, false) then
      -- produto com lote: sai do lote mais antigo com saldo no local
      v_resta := v_q;
      for l in select s.lote_id, s.quantidade from est_saldos s join est_lotes lt on lt.id = s.lote_id where s.produto_id = p.id and s.local_id = v_loc and s.quantidade > 0 order by lt.criado_em, lt.codigo loop
        exit when v_resta <= 0; v_tira := least(v_resta, l.quantidade);
        insert into est_movimentos (empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, documento, observacao, centro_custo_id)
        values (r.empresa_id, v_hoje, p.id, v_loc, l.lote_id, tm, -v_tira, 'RM ' || r.numero, 'Requisição ao almoxarifado nº ' || r.numero || ' — ' || v_nome, v_cc) returning id, valor into v_mov, v_v;
        insert into alm_entrega_itens (entrega_id, empresa_id, item_id, produto_id, local_id, lote_id, quantidade, movimento_id) values (v_ent, r.empresa_id, i.id, p.id, v_loc, l.lote_id, v_tira, v_mov);
        v_val := v_val + abs(coalesce(v_v, 0)); v_resta := v_resta - v_tira;
      end loop;
      if v_resta > 0.00005 then raise exception 'Saldo insuficiente de % nos lotes deste local: faltam %.', p.codigo, v_resta; end if;
    else
      insert into est_movimentos (empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, documento, observacao, centro_custo_id)
      values (r.empresa_id, v_hoje, p.id, v_loc, tm, -v_q, 'RM ' || r.numero, 'Requisição ao almoxarifado nº ' || r.numero || ' — ' || v_nome, v_cc) returning id, valor into v_mov, v_v;
      insert into alm_entrega_itens (entrega_id, empresa_id, item_id, produto_id, local_id, quantidade, movimento_id) values (v_ent, r.empresa_id, i.id, p.id, v_loc, v_q, v_mov);
      v_val := v_val + abs(coalesce(v_v, 0));
    end if;
    update alm_requisicao_itens set qtd_entregue = qtd_entregue + v_q where id = i.id; v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Informe a quantidade de pelo menos um item'; end if;
  update alm_entregas set valor = round(v_val, 2) where id = v_ent;
  update alm_requisicoes set situacao = case when exists(select 1 from alm_requisicao_itens where requisicao_id = p_id and qtd_entregue < quantidade - 0.00005) then 'parcial' else 'atendida' end,
    centro_custo_id = coalesce(centro_custo_id, v_cc), atualizado_em = now() where id = p_id returning situacao into r.situacao;
  if r.solicitante_id is not null and r.solicitante_id <> auth.uid() then
    insert into notificacoes(empresa_id, user_id, tipo, titulo, corpo, link, ref_id)
    values (r.empresa_id, r.solicitante_id, 'almoxarifado', 'Requisição nº ' || r.numero || case when r.situacao = 'atendida' then ' entregue' else ' entregue em parte' end, 'Retirada por ' || v_nome || '.', '#/almoxarifado?id=' || p_id, p_id);
  end if;
  return jsonb_build_object('entrega_id', v_ent, 'situacao', r.situacao, 'valor', round(v_val, 2));
end $$;

-- ---------------------------------------------------------------- balcão: pede e entrega na mesma hora
-- p_itens = [{ "produto_id", "quantidade", "local_id" }]. Se algum item pedir aprovação, a requisição fica aguardando e nada é entregue.
create or replace function public.alm_balcao(p_empresa uuid, p_itens jsonb, p_retirou uuid default null, p_retirou_nome text default null, p_cracha boolean default false, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cfg alm_config; v jsonb; e jsonb; v_it jsonb;
begin
  if not public.alm_almoxarife(p_empresa) then raise exception 'Só quem atende o almoxarifado registra retirada no balcão'; end if;
  select * into cfg from alm_config where empresa_id = p_empresa;
  if not coalesce(cfg.permitir_balcao, true) then raise exception 'A retirada no balcão está desligada: é preciso pedir antes'; end if;
  if p_retirou is null and nullif(trim(coalesce(p_retirou_nome, '')), '') is null then raise exception 'Identifique quem está retirando (crachá ou nome)'; end if;
  if coalesce(cfg.exigir_cracha, false) and not coalesce(p_cracha, false) then raise exception 'A entrega exige a leitura do crachá de quem retira'; end if;
  v := public.alm_requisitar(p_empresa, p_itens, p_motivo, p_retirou, p_retirou_nome, 'balcao');
  if v ->> 'situacao' <> 'aberta' then return v || jsonb_build_object('entregue', false); end if;
  select jsonb_agg(jsonb_build_object('item_id', i.id, 'quantidade', i.quantidade, 'local_id', x ->> 'local_id')) into v_it
    from alm_requisicao_itens i join jsonb_array_elements(p_itens) x on (x ->> 'produto_id')::uuid = i.produto_id where i.requisicao_id = (v ->> 'id')::uuid;
  e := public.alm_entregar((v ->> 'id')::uuid, v_it, p_retirou, p_retirou_nome, p_cracha, null);
  return v || e || jsonb_build_object('entregue', true);
end $$;

-- ---------------------------------------------------------------- cancelar (quem pediu, antes de qualquer entrega) ou encerrar o que falta (almoxarife)
create or replace function public.alm_cancelar(p_id uuid, p_motivo text default null)
returns text language plpgsql security definer set search_path = public as $$
declare r alm_requisicoes; v_almox boolean; v_nova text;
begin
  select * into r from alm_requisicoes where id = p_id for update;
  if not found then raise exception 'Requisição não encontrada'; end if;
  v_almox := public.alm_almoxarife(r.empresa_id);
  if not v_almox and r.solicitante_id is distinct from auth.uid() then raise exception 'Só quem pediu ou quem atende o almoxarifado cancela'; end if;
  if r.situacao not in ('aprovacao', 'aberta', 'parcial') then raise exception 'Esta requisição já foi concluída'; end if;
  if r.situacao = 'parcial' and not v_almox then raise exception 'Parte já foi entregue: só o almoxarifado encerra o restante'; end if;
  if v_almox and r.solicitante_id is distinct from auth.uid() and length(trim(coalesce(p_motivo, ''))) < 3 then raise exception 'Diga o motivo'; end if;
  v_nova := case when r.situacao = 'parcial' then 'encerrada' else 'cancelada' end;
  update alm_requisicoes set situacao = v_nova, encerrado_motivo = left(nullif(trim(coalesce(p_motivo, '')), ''), 300), atualizado_em = now() where id = p_id;
  if r.solicitante_id is not null and r.solicitante_id <> auth.uid() then
    insert into notificacoes(empresa_id, user_id, tipo, titulo, corpo, link, ref_id)
    values (r.empresa_id, r.solicitante_id, 'almoxarifado', 'Requisição nº ' || r.numero || case when v_nova = 'encerrada' then ' encerrada com itens pendentes' else ' cancelada' end, coalesce(nullif(trim(coalesce(p_motivo, '')), ''), ''), '#/almoxarifado?id=' || p_id, p_id);
  end if;
  return v_nova;
end $$;

-- ---------------------------------------------------------------- parâmetros e itens controlados (administrador e diretor)
create or replace function public.alm_config_salvar(p_empresa uuid, p_valor numeric, p_papeis_almoxarife text[], p_almoxarifes uuid[], p_papeis_aprovador text[], p_aprovadores uuid[],
  p_cracha boolean, p_balcao boolean, p_locais uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare ok text[] := '{admin,diretor,financeiro,compras,vendas,producao,leitura}';
begin
  if not public.alm_gerencia(p_empresa) then raise exception 'Só o administrador ou o diretor muda os parâmetros do almoxarifado'; end if;
  if p_valor is not null and p_valor < 0 then raise exception 'Valor inválido'; end if;
  if not (coalesce(p_papeis_almoxarife, '{}') <@ ok) or not (coalesce(p_papeis_aprovador, '{}') <@ ok) then raise exception 'Perfil inválido'; end if;
  if exists(select 1 from unnest(coalesce(p_almoxarifes, '{}') || coalesce(p_aprovadores, '{}')) u where not exists(select 1 from membros m where m.empresa_id = p_empresa and m.user_id = u)) then raise exception 'Pessoa que não é desta empresa'; end if;
  if p_locais is not null and (array_length(p_locais, 1) is null or exists(select 1 from unnest(p_locais) x where not exists(select 1 from est_locais l where l.id = x and l.empresa_id = p_empresa))) then raise exception 'Local inválido'; end if;
  insert into alm_config (empresa_id, valor_aprovacao, papeis_almoxarife, almoxarifes, papeis_aprovador, aprovadores, exigir_cracha, permitir_balcao, locais)
  values (p_empresa, p_valor, coalesce(p_papeis_almoxarife, '{}'), coalesce(p_almoxarifes, '{}'), coalesce(p_papeis_aprovador, '{}'), coalesce(p_aprovadores, '{}'), coalesce(p_cracha, false), coalesce(p_balcao, true), p_locais)
  on conflict (empresa_id) do update set valor_aprovacao = excluded.valor_aprovacao, papeis_almoxarife = excluded.papeis_almoxarife, almoxarifes = excluded.almoxarifes,
    papeis_aprovador = excluded.papeis_aprovador, aprovadores = excluded.aprovadores, exigir_cracha = excluded.exigir_cracha, permitir_balcao = excluded.permitir_balcao, locais = excluded.locais, atualizado_em = now();
end $$;
create or replace function public.alm_controlar(p_empresa uuid, p_produto uuid, p_sim boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.alm_gerencia(p_empresa) then raise exception 'Só o administrador ou o diretor marca item controlado'; end if;
  if not exists(select 1 from produtos where id = p_produto and empresa_id = p_empresa) then raise exception 'Produto não é desta empresa'; end if;
  if coalesce(p_sim, false) then insert into alm_controlados (produto_id, empresa_id) values (p_produto, p_empresa) on conflict do nothing;
  else delete from alm_controlados where produto_id = p_produto; end if;
end $$;
-- quem pode ser nomeado almoxarife ou aprovador (nomes dos usuários da empresa)
create or replace function public.alm_usuarios(p_empresa uuid)
returns table(user_id uuid, nome text, papel text) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.alm_gerencia(p_empresa) then raise exception 'Só o administrador ou o diretor consulta os usuários'; end if;
  return query select m.user_id, coalesce(nullif(trim(m.nome), ''), split_part(u.email, '@', 1))::text, m.papel::text from membros m join auth.users u on u.id = m.user_id
    where m.empresa_id = p_empresa and m.papel::text not in ('motorista') order by 2;
end $$;

revoke all on function public.alm_catalogo(uuid), public.alm_saldos(uuid, uuid[]), public.alm_pessoas(uuid), public.alm_cracha(uuid, text),
  public.alm_requisitar(uuid, jsonb, text, uuid, text, text), public.alm_decidir(uuid, boolean, text), public.alm_entregar(uuid, jsonb, uuid, text, boolean, text),
  public.alm_balcao(uuid, jsonb, uuid, text, boolean, text), public.alm_cancelar(uuid, text),
  public.alm_config_salvar(uuid, numeric, text[], uuid[], text[], uuid[], boolean, boolean, uuid[]), public.alm_controlar(uuid, uuid, boolean), public.alm_usuarios(uuid) from public, anon;
grant execute on function public.alm_catalogo(uuid), public.alm_saldos(uuid, uuid[]), public.alm_pessoas(uuid), public.alm_cracha(uuid, text),
  public.alm_requisitar(uuid, jsonb, text, uuid, text, text), public.alm_decidir(uuid, boolean, text), public.alm_entregar(uuid, jsonb, uuid, text, boolean, text),
  public.alm_balcao(uuid, jsonb, uuid, text, boolean, text), public.alm_cancelar(uuid, text),
  public.alm_config_salvar(uuid, numeric, text[], uuid[], text[], uuid[], boolean, boolean, uuid[]), public.alm_controlar(uuid, uuid, boolean), public.alm_usuarios(uuid) to authenticated;
