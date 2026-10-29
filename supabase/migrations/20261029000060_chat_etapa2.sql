-- =====================================================================
-- Conversas — etapa 2 (29/10/2026).
-- Responder, encaminhar, reações, editar (até 15 min), apagar para todos (até 48 h) ou só para mim, menções com @
-- (avisam mesmo com a conversa silenciada), mensagem fixada, favoritas, busca, "visto por último" (cada pessoa escolhe),
-- cartões de registro e a CONVERSA DO REGISTRO (lançamento, pagamento antecipado, pedido de compra, ordem de
-- produção, frete e proposta FIDC): só entra quem consegue ver o registro.
-- Apagar para todos tira a mensagem da conversa, mas o original fica guardado em chat_historico (sem acesso pela API).
-- Pode rodar mais de uma vez.
-- =====================================================================

-- 1) Estrutura --------------------------------------------------------------------------------------------
alter table public.chat_conversas drop constraint if exists chat_conversas_tipo_check;
alter table public.chat_conversas add constraint chat_conversas_tipo_check check (tipo in ('direta', 'grupo', 'registro'));
alter table public.chat_conversas add column if not exists registro_tipo text;
alter table public.chat_conversas add column if not exists registro_id uuid;
alter table public.chat_conversas add column if not exists msg_fixada uuid references public.chat_mensagens(id) on delete set null;
create unique index if not exists chat_conversas_registro on public.chat_conversas(empresa_id, registro_tipo, registro_id) where registro_tipo is not null;
create index if not exists chat_conversas_msg_fixada on public.chat_conversas(msg_fixada);
create index if not exists chat_conversas_criado_por on public.chat_conversas(criado_por);
create index if not exists chat_conversas_ultima_msg_autor on public.chat_conversas(ultima_msg_autor);

alter table public.chat_mensagens add column if not exists resposta_a uuid references public.chat_mensagens(id) on delete set null;
alter table public.chat_mensagens add column if not exists encaminhada boolean not null default false;
alter table public.chat_mensagens add column if not exists editado_em timestamptz;
alter table public.chat_mensagens add column if not exists apagado_em timestamptz;
alter table public.chat_mensagens add column if not exists mencoes uuid[] not null default '{}';
alter table public.chat_mensagens add column if not exists cartao jsonb;
create index if not exists chat_mensagens_resposta on public.chat_mensagens(resposta_a);
create index if not exists chat_mensagens_mencoes on public.chat_mensagens using gin (mencoes);
create index if not exists chat_mensagens_busca on public.chat_mensagens using gin (to_tsvector('portuguese', coalesce(texto, '')));

create table if not exists public.chat_reacoes (
  mensagem_id uuid not null references public.chat_mensagens(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversa_id uuid not null references public.chat_conversas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  emoji text not null check (length(emoji) between 1 and 16),
  criado_em timestamptz not null default now(),
  primary key (mensagem_id, user_id)
);
create index if not exists chat_reacoes_user on public.chat_reacoes(user_id);
create index if not exists chat_reacoes_conversa on public.chat_reacoes(conversa_id);
create index if not exists chat_reacoes_empresa on public.chat_reacoes(empresa_id);

create table if not exists public.chat_favoritas (
  user_id uuid not null references auth.users(id) on delete cascade,
  mensagem_id uuid not null references public.chat_mensagens(id) on delete cascade,
  conversa_id uuid not null references public.chat_conversas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  criado_em timestamptz not null default now(),
  primary key (user_id, mensagem_id)
);
create index if not exists chat_favoritas_mensagem on public.chat_favoritas(mensagem_id);
create index if not exists chat_favoritas_conversa on public.chat_favoritas(conversa_id);
create index if not exists chat_favoritas_empresa on public.chat_favoritas(empresa_id);

-- "apagar para mim"
create table if not exists public.chat_ocultas (
  user_id uuid not null references auth.users(id) on delete cascade,
  mensagem_id uuid not null references public.chat_mensagens(id) on delete cascade,
  primary key (user_id, mensagem_id)
);
create index if not exists chat_ocultas_mensagem on public.chat_ocultas(mensagem_id);

-- original das mensagens editadas e apagadas (sem acesso pela API: só o dono do banco lê, em caso de auditoria)
create table if not exists public.chat_historico (
  id bigint generated always as identity primary key,
  mensagem_id uuid not null references public.chat_mensagens(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  acao text not null check (acao in ('edicao', 'apagada')),
  texto text,
  anexos jsonb,
  por uuid references auth.users(id) on delete set null,
  em timestamptz not null default now()
);
create index if not exists chat_historico_mensagem on public.chat_historico(mensagem_id);
create index if not exists chat_historico_empresa on public.chat_historico(empresa_id);
create index if not exists chat_historico_por on public.chat_historico(por);

-- "visto por último": cada pessoa escolhe se mostra (quem esconde também não vê o dos outros, como no WhatsApp)
create table if not exists public.chat_perfis (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mostrar_visto boolean not null default true,
  visto_em timestamptz
);

-- 2) Leitura ----------------------------------------------------------------------------------------------
alter table public.chat_reacoes enable row level security;
alter table public.chat_favoritas enable row level security;
alter table public.chat_ocultas enable row level security;
alter table public.chat_historico enable row level security;
alter table public.chat_perfis enable row level security;
drop policy if exists chat_mensagens_sel on public.chat_mensagens;
create policy chat_mensagens_sel on public.chat_mensagens for select to authenticated using (
  exists (select 1 from public.chat_participantes p where p.conversa_id = chat_mensagens.conversa_id and p.user_id = (select auth.uid())
          and chat_mensagens.criado_em >= p.entrou_em - interval '1 second' and (p.saiu_em is null or chat_mensagens.criado_em <= p.saiu_em))
  and not exists (select 1 from public.chat_ocultas o where o.mensagem_id = chat_mensagens.id and o.user_id = (select auth.uid()))
  and public.is_participante(empresa_id));
drop policy if exists chat_reacoes_sel on public.chat_reacoes;
create policy chat_reacoes_sel on public.chat_reacoes for select to authenticated using (
  exists (select 1 from public.chat_mensagens m where m.id = chat_reacoes.mensagem_id));
drop policy if exists chat_favoritas_sel on public.chat_favoritas;
create policy chat_favoritas_sel on public.chat_favoritas for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists chat_ocultas_sel on public.chat_ocultas;
create policy chat_ocultas_sel on public.chat_ocultas for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists chat_perfis_sel on public.chat_perfis;
create policy chat_perfis_sel on public.chat_perfis for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.chat_reacoes, public.chat_favoritas, public.chat_ocultas, public.chat_historico, public.chat_perfis from anon, authenticated;
grant select on public.chat_reacoes, public.chat_favoritas, public.chat_ocultas, public.chat_perfis to authenticated;

-- 3) Registros que têm conversa: quem pode ver, e o cartão (título, detalhe, link) ------------------------------
create or replace function public._chat_ve_registro(p_tipo text, p_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare e uuid; cp uuid;
begin
  case p_tipo
    when 'lancamento' then select empresa_id into e from lancamentos where id = p_id; return e is not null and is_membro(e);
    when 'paraquedas' then select empresa_id, criado_por into e, cp from paraquedas where id = p_id;
      return e is not null and (is_membro(e) or (is_participante(e) and cp = auth.uid()));
    when 'compras_pedido' then select empresa_id into e from compras_pedidos where id = p_id; return e is not null and (is_membro(e) or pode_comprar(e));
    when 'prod_ordem' then select empresa_id into e from prod_ordens where id = p_id; return e is not null and ve_producao(e);
    when 'log_frete' then select empresa_id into e from log_fretes where id = p_id; return e is not null and ve_logistica(e);
    when 'fidc_proposta' then select empresa_id into e from fidc_propostas where id = p_id; return e is not null and is_membro(e);
    else return false;
  end case;
end $$;

create or replace function public._chat_reais(v numeric) returns text language sql immutable as $$
  select 'R$ ' || translate(to_char(coalesce(v, 0), 'FM999,999,999,990.00'), ',.', '.,');
$$;

-- empresa, título, detalhe e link do registro (sem conferir acesso: use junto com _chat_ve_registro)
create or replace function public._chat_registro_info(p_tipo text, p_id uuid, out empresa_id uuid, out titulo text, out sub text, out link text)
language plpgsql stable security definer set search_path = public as $$
begin
  case p_tipo
    when 'lancamento' then
      select l.empresa_id, 'Lançamento · ' || coalesce(nullif(l.descricao, ''), f.nome, 'sem descrição'),
             to_char(l.data, 'DD/MM/YYYY') || ' · ' || _chat_reais(l.valor) || ' · ' || coalesce(l.status, ''), '#/lancamentos?abrir=' || l.id
        into empresa_id, titulo, sub, link from lancamentos l left join favorecidos f on f.id = l.favorecido_id where l.id = p_id;
    when 'paraquedas' then
      select p.empresa_id, 'Pagamento antecipado nº ' || p.numero || ' · ' || coalesce(p.razao_social, ''),
             _chat_reais(p.valor) || ' · ' || coalesce(p.status, ''), '#/paraquedas?abrir=' || p.id
        into empresa_id, titulo, sub, link from paraquedas p where p.id = p_id;
    when 'compras_pedido' then
      select c.empresa_id, 'Pedido de compra nº ' || c.numero || coalesce(' · ' || f.nome, ''),
             _chat_reais(c.total) || ' · ' || coalesce(c.status, ''), '#/compras/pedidos?abrir=' || c.id
        into empresa_id, titulo, sub, link from compras_pedidos c left join favorecidos f on f.id = c.favorecido_id where c.id = p_id;
    when 'prod_ordem' then
      select o.empresa_id, 'OP nº ' || o.numero || coalesce(' · ' || nullif(o.descricao, ''), ''),
             trim(to_char(o.quantidade, 'FM999G999G990D###') || ' ' || coalesce(o.unidade, '')) || ' · ' || coalesce(o.status, ''), '#/producao/ordens?abrir=' || o.id
        into empresa_id, titulo, sub, link from prod_ordens o where o.id = p_id;
    when 'log_frete' then
      select f.empresa_id, 'Frete nº ' || f.numero || coalesce(' · ' || f.origem || ' → ' || f.destino, ''),
             _chat_reais(f.valor) || ' · ' || coalesce(f.status, ''), '#/logistica/fretes?abrir=' || f.id
        into empresa_id, titulo, sub, link from log_fretes f where f.id = p_id;
    when 'fidc_proposta' then
      select p.empresa_id, 'Proposta FIDC nº ' || p.numero, _chat_reais(p.valor_face) || ' · ' || coalesce(p.status, ''), '#/fidc-propostas?abrir=' || p.id
        into empresa_id, titulo, sub, link from fidc_propostas p where p.id = p_id;
    else null;
  end case;
end $$;

-- cartões: devolve só os que a pessoa pode ver. p_itens: [{tipo, id}]
create or replace function public.chat_cartoes(p_itens jsonb)
returns table(tipo text, id uuid, titulo text, sub text, link text)
language sql stable security definer set search_path = public as $$
  select x.tipo, x.id, i.titulo, i.sub, i.link
  from (select distinct e ->> 'tipo' as tipo, public._uuid_ou_nulo(e ->> 'id') as id from jsonb_array_elements(coalesce(p_itens, '[]')) e) x
  cross join lateral public._chat_registro_info(x.tipo, x.id) i
  where x.id is not null and i.titulo is not null and public._chat_ve_registro(x.tipo, x.id);
$$;

-- abre (ou cria) a conversa do registro e coloca a pessoa nela
create or replace function public.chat_registro(p_tipo text, p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare i record; v_id uuid; eu uuid := auth.uid();
begin
  if not public._chat_ve_registro(p_tipo, p_id) then raise exception 'Você não tem acesso a este registro'; end if;
  select * into i from public._chat_registro_info(p_tipo, p_id);
  select id into v_id from chat_conversas where empresa_id = i.empresa_id and registro_tipo = p_tipo and registro_id = p_id;
  if v_id is null then
    insert into chat_conversas(empresa_id, tipo, nome, descricao, registro_tipo, registro_id, criado_por)
    values (i.empresa_id, 'registro', left(i.titulo, 80), left(i.sub, 500), p_tipo, p_id, eu)
    on conflict (empresa_id, registro_tipo, registro_id) where registro_tipo is not null do nothing returning id into v_id;
    if v_id is null then select id into v_id from chat_conversas where empresa_id = i.empresa_id and registro_tipo = p_tipo and registro_id = p_id; end if;
  end if;
  insert into chat_participantes(conversa_id, user_id, empresa_id, admin) values (v_id, eu, i.empresa_id, true)
  on conflict (conversa_id, user_id) do update set saiu_em = null where chat_participantes.saiu_em is not null;
  return v_id;
end $$;

-- 4) Lista e contatos (recriadas: devolvem colunas novas) --------------------------------------------------------
drop function if exists public.chat_resumo(uuid);
create function public.chat_resumo(p_empresa uuid)
returns table(id uuid, tipo text, nome text, descricao text, outro_id uuid, so_admins_escrevem boolean, sou_admin boolean,
              saiu boolean, ultima_msg_em timestamptz, ultima_msg_texto text, ultima_msg_autor uuid, ultima_msg_autor_nome text,
              nao_lidas int, mencoes int, silenciada_ate timestamptz, fixada boolean, arquivada boolean, participantes int,
              registro_tipo text, registro_id uuid, msg_fixada uuid)
language sql stable security definer set search_path = public as $$
  select c.id, c.tipo,
         case when c.tipo = 'direta' then public._chat_nome(o.user_id, c.empresa_id) else c.nome end,
         c.descricao, o.user_id, c.so_admins_escrevem, eu.admin, eu.saiu_em is not null,
         c.ultima_msg_em, c.ultima_msg_texto, c.ultima_msg_autor,
         case when c.ultima_msg_autor is null then null else public._chat_nome(c.ultima_msg_autor, c.empresa_id) end,
         nl.n, nl.m, eu.silenciada_ate, eu.fixada, eu.arquivada,
         (select count(*)::int from chat_participantes x where x.conversa_id = c.id and x.saiu_em is null),
         c.registro_tipo, c.registro_id, c.msg_fixada
  from chat_participantes eu
  join chat_conversas c on c.id = eu.conversa_id
  left join lateral (select x.user_id from chat_participantes x where c.tipo = 'direta' and x.conversa_id = c.id and x.user_id <> eu.user_id limit 1) o on true
  cross join lateral (
    select count(*)::int as n, count(*) filter (where auth.uid() = any(m.mencoes))::int as m
    from chat_mensagens m
    where m.conversa_id = c.id and m.autor_id is distinct from auth.uid() and m.tipo <> 'sistema' and m.apagado_em is null
      and m.criado_em > greatest(coalesce(eu.lida_ate, '-infinity'), eu.entrou_em) and (eu.saiu_em is null or m.criado_em <= eu.saiu_em)
      and not exists (select 1 from chat_ocultas h where h.mensagem_id = m.id and h.user_id = auth.uid())) nl
  where eu.user_id = auth.uid() and eu.empresa_id = p_empresa and public.is_participante(p_empresa)
    and (c.tipo <> 'direta' or c.ultima_msg_em is not null or c.criado_por = auth.uid())
  order by eu.fixada desc, coalesce(c.ultima_msg_em, c.criado_em) desc;
$$;

drop function if exists public.chat_contatos(uuid);
create function public.chat_contatos(p_empresa uuid)
returns table(user_id uuid, nome text, email text, papel text, visto_em timestamptz)
language sql stable security definer set search_path = public, auth as $$
  select m.user_id, public._chat_nome(m.user_id, p_empresa), u.email::text, m.papel::text,
         case when coalesce(pf.mostrar_visto, true) and coalesce((select x.mostrar_visto from chat_perfis x where x.user_id = auth.uid()), true)
              then pf.visto_em end
  from membros m join auth.users u on u.id = m.user_id left join chat_perfis pf on pf.user_id = m.user_id
  where m.empresa_id = p_empresa and m.user_id <> auth.uid() and public.is_participante(p_empresa)
  order by 2;
$$;

-- presença: grava o "visto por último" e a preferência de mostrar
create or replace function public.chat_visto(p_mostrar boolean default null) returns boolean
language sql security definer set search_path = public as $$
  insert into chat_perfis(user_id, mostrar_visto, visto_em) values (auth.uid(), coalesce(p_mostrar, true), now())
  on conflict (user_id) do update set visto_em = now(), mostrar_visto = coalesce(p_mostrar, chat_perfis.mostrar_visto)
  returning mostrar_visto;
$$;

-- 5) Enviar (recriada com responder, menções, cartão e encaminhada) ---------------------------------------------
drop function if exists public.chat_enviar(uuid, text, uuid, jsonb);
create or replace function public.chat_enviar(p_conversa uuid, p_texto text, p_cliente_id uuid default null, p_anexos jsonb default '[]',
                                              p_resposta_a uuid default null, p_mencoes uuid[] default '{}', p_cartao jsonb default null,
                                              p_encaminhada boolean default false)
returns public.chat_mensagens
language plpgsql security definer set search_path = public as $$
declare c chat_conversas; m chat_mensagens; eu uuid := auth.uid(); a jsonb; v_txt text := nullif(btrim(coalesce(p_texto, ''), E' \t\r\n'), '');
  v_prev text; v_nome text; r record; n_anexos int := jsonb_array_length(coalesce(p_anexos, '[]')); v_menc uuid[]; v_cartao jsonb;
begin
  if p_cliente_id is not null then
    select * into m from chat_mensagens where cliente_id = p_cliente_id and autor_id = eu;
    if found then return m; end if;
  end if;
  select * into c from chat_conversas where id = p_conversa;
  if c.id is null or not public._chat_ativo(p_conversa) then raise exception 'Você não participa desta conversa'; end if;
  if c.so_admins_escrevem and not public._chat_admin(p_conversa) then raise exception 'Só os administradores podem escrever neste grupo'; end if;
  if p_cartao is not null then
    if not public._chat_ve_registro(p_cartao ->> 'tipo', public._uuid_ou_nulo(p_cartao ->> 'id')) then raise exception 'Você não tem acesso a este registro'; end if;
    v_cartao := jsonb_build_object('tipo', p_cartao ->> 'tipo', 'id', p_cartao ->> 'id');
  end if;
  if v_txt is null and n_anexos = 0 and v_cartao is null then raise exception 'Mensagem vazia'; end if;
  if length(v_txt) > 8000 then raise exception 'Mensagem muito longa (até 8.000 caracteres)'; end if;
  if n_anexos > 10 then raise exception 'Até 10 arquivos por mensagem'; end if;
  if p_resposta_a is not null and not exists (select 1 from chat_mensagens x where x.id = p_resposta_a and x.conversa_id = p_conversa) then
    raise exception 'A mensagem respondida não é desta conversa';
  end if;
  select coalesce(array_agg(distinct p.user_id), '{}') into v_menc from chat_participantes p
   where p.conversa_id = p_conversa and p.saiu_em is null and p.user_id <> eu and p.user_id = any(coalesce(p_mencoes, '{}'));

  insert into chat_mensagens(conversa_id, empresa_id, autor_id, tipo, texto, cliente_id, resposta_a, mencoes, cartao, encaminhada)
  values (p_conversa, c.empresa_id, eu, case when n_anexos > 0 then 'anexo' else 'texto' end, v_txt, p_cliente_id, p_resposta_a, v_menc, v_cartao, coalesce(p_encaminhada, false))
  returning * into m;
  for a in select * from jsonb_array_elements(coalesce(p_anexos, '[]')) loop
    if (a ->> 'caminho') is null or (a ->> 'caminho') not like c.empresa_id || '/' || c.id || '/%' then raise exception 'Arquivo fora da conversa'; end if;
    insert into chat_anexos(mensagem_id, conversa_id, empresa_id, caminho, nome, mime, tamanho, largura, altura)
    values (m.id, c.id, c.empresa_id, a ->> 'caminho', left(coalesce(nullif(a ->> 'nome', ''), 'arquivo'), 200), a ->> 'mime',
            nullif(a ->> 'tamanho', '')::bigint, nullif(a ->> 'largura', '')::int, nullif(a ->> 'altura', '')::int);
  end loop;

  v_prev := coalesce(left(regexp_replace(v_txt, '\s+', ' ', 'g'), 120),
                     case when n_anexos = 1 and (p_anexos -> 0 ->> 'mime') like 'audio/%' then '🎤 Mensagem de voz'
                          when n_anexos = 1 and (p_anexos -> 0 ->> 'mime') like 'image/%' then '📷 Foto'
                          when n_anexos = 1 then '📎 ' || left(coalesce(p_anexos -> 0 ->> 'nome', 'arquivo'), 100)
                          when n_anexos > 1 then '📎 ' || n_anexos || ' arquivos'
                          else '🔗 ' || coalesce((select i.titulo from public._chat_registro_info(v_cartao ->> 'tipo', (v_cartao ->> 'id')::uuid) i), 'Registro') end);
  update chat_conversas set ultima_msg_em = m.criado_em, ultima_msg_texto = v_prev, ultima_msg_autor = eu where id = c.id;
  update chat_participantes set lida_ate = m.criado_em, entregue_ate = m.criado_em where conversa_id = c.id and user_id = eu;
  update chat_participantes set arquivada = false where conversa_id = c.id and saiu_em is null and arquivada;

  v_nome := public._chat_nome(eu, c.empresa_id);
  -- mencionados: avisa sempre (mesmo silenciada)
  for r in select unnest(v_menc) as user_id loop
    insert into notificacoes(empresa_id, user_id, tipo, titulo, corpo, link, ref_id)
    values (c.empresa_id, r.user_id, 'chat', v_nome || ' mencionou você' || case when c.tipo <> 'direta' then ' em ' || c.nome else '' end,
            v_prev, '#/conversas?c=' || c.id, c.id);
  end loop;
  -- demais: um aviso por conversa a cada 2 minutos, só para quem não silenciou
  for r in select p.user_id from chat_participantes p
           where p.conversa_id = c.id and p.user_id <> eu and p.saiu_em is null and coalesce(p.silenciada_ate, '-infinity') < now()
             and not (p.user_id = any(v_menc))
             and not exists (select 1 from notificacoes n where n.user_id = p.user_id and n.tipo = 'chat' and n.ref_id = c.id
                             and n.lida_em is null and n.criado_em > now() - interval '2 minutes')
  loop
    insert into notificacoes(empresa_id, user_id, tipo, titulo, corpo, link, ref_id)
    values (c.empresa_id, r.user_id, 'chat', case when c.tipo = 'direta' then v_nome else c.nome end,
            case when c.tipo = 'direta' then '' else v_nome || ': ' end || v_prev, '#/conversas?c=' || c.id, c.id);
  end loop;
  return m;
end $$;

-- 6) Editar, apagar, reagir, favoritar, fixar ---------------------------------------------------------------------
create or replace function public._chat_previa(p_conversa uuid) returns void
language sql security definer set search_path = public as $$
  -- refaz a prévia da lista quando a última mensagem foi editada ou apagada
  update chat_conversas c set ultima_msg_texto = coalesce(
      case when m.apagado_em is not null then '🚫 Mensagem apagada' else left(regexp_replace(m.texto, '\s+', ' ', 'g'), 120) end, c.ultima_msg_texto)
  from (select * from chat_mensagens where conversa_id = p_conversa and tipo <> 'sistema' order by criado_em desc limit 1) m
  where c.id = p_conversa and m.criado_em = c.ultima_msg_em;
$$;

create or replace function public.chat_editar(p_mensagem uuid, p_texto text) returns public.chat_mensagens
language plpgsql security definer set search_path = public as $$
declare m chat_mensagens; v_txt text := nullif(btrim(coalesce(p_texto, ''), E' \t\r\n'), '');
begin
  select * into m from chat_mensagens where id = p_mensagem;
  if m.id is null or m.autor_id is distinct from auth.uid() or not public._chat_ativo(m.conversa_id) then raise exception 'Só quem enviou pode editar'; end if;
  if m.tipo = 'sistema' or m.apagado_em is not null then raise exception 'Esta mensagem não pode ser editada'; end if;
  if now() - m.criado_em > interval '15 minutes' then raise exception 'Só dá para editar até 15 minutos depois de enviar'; end if;
  if v_txt is null and m.tipo <> 'anexo' then raise exception 'Mensagem vazia'; end if;
  if length(v_txt) > 8000 then raise exception 'Mensagem muito longa (até 8.000 caracteres)'; end if;
  if v_txt is not distinct from m.texto then return m; end if;
  insert into chat_historico(mensagem_id, empresa_id, acao, texto, por) values (m.id, m.empresa_id, 'edicao', m.texto, auth.uid());
  update chat_mensagens set texto = v_txt, editado_em = now() where id = m.id returning * into m;
  perform public._chat_previa(m.conversa_id);
  return m;
end $$;

create or replace function public.chat_apagar(p_mensagem uuid, p_para_todos boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare m chat_mensagens; eu uuid := auth.uid();
begin
  select * into m from chat_mensagens where id = p_mensagem;
  if m.id is null or not public.chat_participa(m.conversa_id) then raise exception 'Mensagem não encontrada'; end if;
  if not coalesce(p_para_todos, true) then
    insert into chat_ocultas(user_id, mensagem_id) values (eu, m.id) on conflict do nothing;
    return;
  end if;
  if m.autor_id is distinct from eu or not public._chat_ativo(m.conversa_id) then raise exception 'Só quem enviou pode apagar para todos'; end if;
  if m.tipo = 'sistema' or m.apagado_em is not null then return; end if;
  if now() - m.criado_em > interval '48 hours' then raise exception 'Só dá para apagar para todos até 48 horas depois de enviar'; end if;
  insert into chat_historico(mensagem_id, empresa_id, acao, texto, anexos, por)
  values (m.id, m.empresa_id, 'apagada', m.texto,
          (select jsonb_agg(to_jsonb(a) - 'mensagem_id') from chat_anexos a where a.mensagem_id = m.id), eu);
  delete from chat_anexos where mensagem_id = m.id;          -- o arquivo deixa de abrir (a regra do armazenamento segue os anexos)
  delete from chat_reacoes where mensagem_id = m.id;
  delete from chat_favoritas where mensagem_id = m.id;
  update chat_conversas set msg_fixada = null where msg_fixada = m.id;
  update chat_mensagens set texto = null, cartao = null, mencoes = '{}', apagado_em = now() where id = m.id;
  perform public._chat_previa(m.conversa_id);
end $$;

create or replace function public.chat_reagir(p_mensagem uuid, p_emoji text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m chat_mensagens;
begin
  select * into m from chat_mensagens where id = p_mensagem;
  if m.id is null or not public._chat_ativo(m.conversa_id) or m.apagado_em is not null or m.tipo = 'sistema' then raise exception 'Não dá para reagir a esta mensagem'; end if;
  if nullif(trim(coalesce(p_emoji, '')), '') is null then
    delete from chat_reacoes where mensagem_id = m.id and user_id = auth.uid();
  else
    insert into chat_reacoes(mensagem_id, user_id, conversa_id, empresa_id, emoji) values (m.id, auth.uid(), m.conversa_id, m.empresa_id, left(trim(p_emoji), 16))
    on conflict (mensagem_id, user_id) do update set emoji = excluded.emoji, criado_em = now();
  end if;
end $$;

create or replace function public.chat_favoritar(p_mensagem uuid, p_sim boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare m chat_mensagens;
begin
  select * into m from chat_mensagens where id = p_mensagem;
  if m.id is null or not public.chat_participa(m.conversa_id) then raise exception 'Mensagem não encontrada'; end if;
  if coalesce(p_sim, true) then
    insert into chat_favoritas(user_id, mensagem_id, conversa_id, empresa_id) values (auth.uid(), m.id, m.conversa_id, m.empresa_id) on conflict do nothing;
  else delete from chat_favoritas where user_id = auth.uid() and mensagem_id = m.id;
  end if;
end $$;

create or replace function public.chat_fixar_msg(p_conversa uuid, p_mensagem uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare c chat_conversas;
begin
  select * into c from chat_conversas where id = p_conversa;
  if c.id is null or not public._chat_ativo(p_conversa) then raise exception 'Você não participa desta conversa'; end if;
  if c.so_admins_escrevem and not public._chat_admin(p_conversa) then raise exception 'Só os administradores podem fixar neste grupo'; end if;
  if p_mensagem is not null and not exists (select 1 from chat_mensagens where id = p_mensagem and conversa_id = p_conversa and apagado_em is null and tipo <> 'sistema') then
    raise exception 'Mensagem não encontrada';
  end if;
  update chat_conversas set msg_fixada = p_mensagem where id = p_conversa;
  if p_mensagem is not null then perform public._chat_sistema(p_conversa, public._chat_nome(auth.uid(), c.empresa_id) || ' fixou uma mensagem'); end if;
end $$;

-- conversa do registro: qualquer participante coloca outra pessoa (os grupos seguem só com os administradores)
create or replace function public.chat_grupo_adicionar(p_conversa uuid, p_users uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_tipo text; r record; n int := 0;
begin
  select empresa_id, tipo into v_emp, v_tipo from chat_conversas where id = p_conversa;
  if not (public._chat_admin(p_conversa) or (v_tipo = 'registro' and public._chat_ativo(p_conversa))) then
    raise exception 'Só os administradores do grupo podem adicionar pessoas';
  end if;
  for r in select m.user_id from membros m where m.empresa_id = v_emp and m.user_id = any(coalesce(p_users, '{}')) loop
    insert into chat_participantes(conversa_id, user_id, empresa_id) values (p_conversa, r.user_id, v_emp)
    on conflict (conversa_id, user_id) do update set saiu_em = null, admin = false, entrou_em = now(), lida_ate = null, entregue_ate = null
      where chat_participantes.saiu_em is not null;
    if found then
      n := n + 1;
      perform public._chat_sistema(p_conversa, public._chat_nome(auth.uid(), v_emp) || ' adicionou ' || public._chat_nome(r.user_id, v_emp));
    end if;
  end loop;
  return n;
end $$;

-- 7) Busca nas mensagens: roda com as permissões de quem busca (as regras de leitura valem) ------------------------
create or replace function public.chat_buscar(p_empresa uuid, p_termo text, p_conversa uuid default null)
returns table(id uuid, conversa_id uuid, autor_id uuid, texto text, criado_em timestamptz)
language sql stable security invoker set search_path = public as $$
  select m.id, m.conversa_id, m.autor_id, m.texto, m.criado_em
  from chat_mensagens m
  where m.empresa_id = p_empresa and m.apagado_em is null and m.tipo <> 'sistema' and length(trim(coalesce(p_termo, ''))) >= 2
    and (p_conversa is null or m.conversa_id = p_conversa)
    and (to_tsvector('portuguese', coalesce(m.texto, '')) @@ websearch_to_tsquery('portuguese', p_termo)
         or m.texto ilike '%' || replace(replace(replace(trim(p_termo), '\', '\\'), '%', '\%'), '_', '\_') || '%')
  order by m.criado_em desc
  limit 80;
$$;

-- 8) Permissões e tempo real ------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['chat_cartoes(jsonb)', 'chat_registro(text,uuid)', 'chat_resumo(uuid)', 'chat_contatos(uuid)', 'chat_visto(boolean)',
    'chat_enviar(uuid,text,uuid,jsonb,uuid,uuid[],jsonb,boolean)', 'chat_editar(uuid,text)', 'chat_apagar(uuid,boolean)',
    'chat_reagir(uuid,text)', 'chat_favoritar(uuid,boolean)', 'chat_fixar_msg(uuid,uuid)', 'chat_grupo_adicionar(uuid,uuid[])',
    'chat_buscar(uuid,text,uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array['_chat_ve_registro(text,uuid)', '_chat_registro_info(text,uuid)', '_chat_previa(uuid)', '_chat_reais(numeric)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_reacoes') then
    alter publication supabase_realtime add table public.chat_reacoes;
  end if;
end $$;
-- edição e "apagada" chegam em tempo real como UPDATE de chat_mensagens (a tabela já está na publicação)

-- conferência: tabelas = 9, funcoes = 31, no_tempo_real = 4
select (select count(*) from pg_tables where schemaname = 'public' and tablename like 'chat\_%') as tabelas,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like any (array['chat\_%', '\_chat\_%'])) as funcoes,
       (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'chat\_%') as no_tempo_real;
