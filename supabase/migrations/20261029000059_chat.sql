-- =====================================================================
-- Conversas (chat interno no estilo WhatsApp) — etapa 1. Aprovado pelo Renan em 29/10/2026.
-- Conversas individuais e em grupo entre pessoas da mesma empresa, texto e anexos, tempo real, entregue/lido,
-- silenciar, fixar e arquivar, e aviso no celular/computador.
-- Privacidade: só quem participa da conversa lê as mensagens — o administrador da empresa NÃO lê as conversas dos
-- outros. Quem entra num grupo vê as mensagens a partir da entrada; quem sai vê só até a saída.
-- As mensagens ficam guardadas (não há exclusão nesta etapa). Toda gravação passa pelas funções chat_* abaixo;
-- as tabelas são só de leitura para a tela. Pode rodar mais de uma vez.
-- =====================================================================

-- 1) Tabelas ----------------------------------------------------------------------------------------------
create table if not exists public.chat_conversas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null check (tipo in ('direta', 'grupo')),
  nome text check (nome is null or length(nome) between 1 and 80),
  descricao text check (descricao is null or length(descricao) <= 500),
  so_admins_escrevem boolean not null default false,
  chave_direta text unique,                    -- empresa + as duas pessoas: uma conversa individual por par
  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  ultima_msg_em timestamptz,
  ultima_msg_texto text,
  ultima_msg_autor uuid references auth.users(id) on delete set null
);
create index if not exists chat_conversas_empresa on public.chat_conversas(empresa_id, ultima_msg_em desc);

create table if not exists public.chat_participantes (
  conversa_id uuid not null references public.chat_conversas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  admin boolean not null default false,
  entrou_em timestamptz not null default now(),
  saiu_em timestamptz,                         -- saiu ou foi removido do grupo
  entregue_ate timestamptz,                    -- ✓✓ cinza: mensagens até aqui chegaram ao aparelho
  lida_ate timestamptz,                        -- ✓✓ azul: mensagens até aqui foram lidas
  silenciada_ate timestamptz,
  fixada boolean not null default false,
  arquivada boolean not null default false,
  primary key (conversa_id, user_id)
);
create index if not exists chat_participantes_user on public.chat_participantes(user_id, empresa_id);
create index if not exists chat_participantes_empresa on public.chat_participantes(empresa_id);

create table if not exists public.chat_mensagens (
  id uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.chat_conversas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  autor_id uuid references auth.users(id) on delete set null,
  tipo text not null default 'texto' check (tipo in ('texto', 'anexo', 'sistema')),
  texto text check (texto is null or length(texto) <= 8000),
  cliente_id uuid unique,                      -- gerado no navegador: reenvio sem internet não duplica
  criado_em timestamptz not null default now()
);
create index if not exists chat_mensagens_conversa on public.chat_mensagens(conversa_id, criado_em desc);
create index if not exists chat_mensagens_empresa on public.chat_mensagens(empresa_id);
create index if not exists chat_mensagens_autor on public.chat_mensagens(autor_id);

create table if not exists public.chat_anexos (
  id uuid primary key default gen_random_uuid(),
  mensagem_id uuid not null references public.chat_mensagens(id) on delete cascade,
  conversa_id uuid not null references public.chat_conversas(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  caminho text not null unique,                -- no armazenamento "chat": <empresa>/<conversa>/<arquivo>
  nome text not null,
  mime text,
  tamanho bigint,
  largura int, altura int,                     -- imagens: para reservar o espaço da miniatura
  criado_em timestamptz not null default now()
);
create index if not exists chat_anexos_mensagem on public.chat_anexos(mensagem_id);
create index if not exists chat_anexos_conversa on public.chat_anexos(conversa_id, criado_em desc);
create index if not exists chat_anexos_empresa on public.chat_anexos(empresa_id);

-- 2) Quem participa ----------------------------------------------------------------------------------------
-- participa (ainda que tenha saído do grupo: lê o histórico até a saída) e é da empresa
create or replace function public.chat_participa(p_conversa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from chat_participantes p where p.conversa_id = p_conversa and p.user_id = auth.uid()
                 and public.is_participante(p.empresa_id));
$$;
-- participa agora (pode escrever, anexar)
create or replace function public._chat_ativo(p_conversa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from chat_participantes p where p.conversa_id = p_conversa and p.user_id = auth.uid()
                 and p.saiu_em is null and public.is_participante(p.empresa_id));
$$;
-- nome que aparece no chat: o nome do membro, senão o do cadastro do login, senão o começo do e-mail
create or replace function public._chat_nome(p_user uuid, p_empresa uuid) returns text
language sql stable security definer set search_path = public, auth as $$
  select coalesce(nullif(trim(m.nome), ''), nullif(trim(u.raw_user_meta_data ->> 'nome'), ''),
                  nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''), split_part(u.email::text, '@', 1), 'Usuário')
  from auth.users u left join membros m on m.user_id = u.id and m.empresa_id = p_empresa where u.id = p_user;
$$;

-- 3) Leitura: as tabelas só deixam ver o que é da própria conversa --------------------------------------------
alter table public.chat_conversas enable row level security;
alter table public.chat_participantes enable row level security;
alter table public.chat_mensagens enable row level security;
alter table public.chat_anexos enable row level security;
drop policy if exists chat_conversas_sel on public.chat_conversas;
drop policy if exists chat_participantes_sel on public.chat_participantes;
drop policy if exists chat_mensagens_sel on public.chat_mensagens;
drop policy if exists chat_anexos_sel on public.chat_anexos;
create policy chat_conversas_sel on public.chat_conversas for select to authenticated using (public.chat_participa(id));
create policy chat_participantes_sel on public.chat_participantes for select to authenticated using (public.chat_participa(conversa_id));
-- mensagens: do período em que a pessoa esteve na conversa
create policy chat_mensagens_sel on public.chat_mensagens for select to authenticated using (
  exists (select 1 from public.chat_participantes p where p.conversa_id = chat_mensagens.conversa_id and p.user_id = (select auth.uid())
          and chat_mensagens.criado_em >= p.entrou_em - interval '1 second' and (p.saiu_em is null or chat_mensagens.criado_em <= p.saiu_em))
  and public.is_participante(empresa_id));
create policy chat_anexos_sel on public.chat_anexos for select to authenticated using (
  exists (select 1 from public.chat_mensagens m where m.id = chat_anexos.mensagem_id));    -- vale a regra das mensagens
revoke insert, update, delete on public.chat_conversas, public.chat_participantes, public.chat_mensagens, public.chat_anexos from anon, authenticated;
grant select on public.chat_conversas, public.chat_participantes, public.chat_mensagens, public.chat_anexos to authenticated;
revoke all on public.chat_conversas, public.chat_participantes, public.chat_mensagens, public.chat_anexos from anon;

-- 4) Contatos e lista de conversas ---------------------------------------------------------------------------
-- todas as pessoas da empresa (qualquer papel), menos quem está pedindo
create or replace function public.chat_contatos(p_empresa uuid)
returns table(user_id uuid, nome text, email text, papel text)
language sql stable security definer set search_path = public, auth as $$
  select m.user_id, public._chat_nome(m.user_id, p_empresa), u.email::text, m.papel::text
  from membros m join auth.users u on u.id = m.user_id
  where m.empresa_id = p_empresa and m.user_id <> auth.uid() and public.is_participante(p_empresa)
  order by 2;
$$;

-- a lista da esquerda: cada conversa com o nome (na individual, o da outra pessoa), a última mensagem e as não lidas
create or replace function public.chat_resumo(p_empresa uuid)
returns table(id uuid, tipo text, nome text, descricao text, outro_id uuid, so_admins_escrevem boolean, sou_admin boolean,
              saiu boolean, ultima_msg_em timestamptz, ultima_msg_texto text, ultima_msg_autor uuid, ultima_msg_autor_nome text,
              nao_lidas int, silenciada_ate timestamptz, fixada boolean, arquivada boolean, participantes int)
language sql stable security definer set search_path = public as $$
  select c.id, c.tipo,
         case when c.tipo = 'direta' then public._chat_nome(o.user_id, c.empresa_id) else c.nome end,
         c.descricao, o.user_id, c.so_admins_escrevem, eu.admin, eu.saiu_em is not null,
         c.ultima_msg_em, c.ultima_msg_texto, c.ultima_msg_autor,
         case when c.ultima_msg_autor is null then null else public._chat_nome(c.ultima_msg_autor, c.empresa_id) end,
         (select count(*)::int from chat_mensagens m where m.conversa_id = c.id and m.autor_id is distinct from auth.uid() and m.tipo <> 'sistema'
            and m.criado_em > greatest(coalesce(eu.lida_ate, '-infinity'), eu.entrou_em) and (eu.saiu_em is null or m.criado_em <= eu.saiu_em)),
         eu.silenciada_ate, eu.fixada, eu.arquivada,
         (select count(*)::int from chat_participantes x where x.conversa_id = c.id and x.saiu_em is null)
  from chat_participantes eu
  join chat_conversas c on c.id = eu.conversa_id
  left join lateral (select x.user_id from chat_participantes x where c.tipo = 'direta' and x.conversa_id = c.id and x.user_id <> eu.user_id limit 1) o on true
  where eu.user_id = auth.uid() and eu.empresa_id = p_empresa and public.is_participante(p_empresa)
    and (c.tipo = 'grupo' or c.ultima_msg_em is not null or c.criado_por = auth.uid())
  order by eu.fixada desc, coalesce(c.ultima_msg_em, c.criado_em) desc;
$$;

-- 5) Criar conversas ---------------------------------------------------------------------------------------
create or replace function public._chat_sistema(p_conversa uuid, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into chat_mensagens(conversa_id, empresa_id, autor_id, tipo, texto)
  select id, empresa_id, auth.uid(), 'sistema', p_texto from chat_conversas where id = p_conversa;
end $$;

create or replace function public.chat_abrir_direta(p_empresa uuid, p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_chave text; eu uuid := auth.uid();
begin
  if not public.is_participante(p_empresa) then raise exception 'Sem acesso a esta empresa'; end if;
  if p_user is null or p_user = eu then raise exception 'Escolha outra pessoa'; end if;
  if not exists (select 1 from membros where empresa_id = p_empresa and user_id = p_user) then raise exception 'Esta pessoa não é da empresa'; end if;
  v_chave := p_empresa || ':' || least(eu, p_user) || ':' || greatest(eu, p_user);
  select id into v_id from chat_conversas where chave_direta = v_chave;
  if v_id is null then
    insert into chat_conversas(empresa_id, tipo, chave_direta, criado_por) values (p_empresa, 'direta', v_chave, eu)
      on conflict (chave_direta) do nothing returning id into v_id;
    if v_id is null then select id into v_id from chat_conversas where chave_direta = v_chave; end if;
    insert into chat_participantes(conversa_id, user_id, empresa_id) values (v_id, eu, p_empresa), (v_id, p_user, p_empresa)
      on conflict do nothing;
  end if;
  return v_id;
end $$;

create or replace function public.chat_criar_grupo(p_empresa uuid, p_nome text, p_descricao text, p_users uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; eu uuid := auth.uid();
begin
  if not public.is_participante(p_empresa) then raise exception 'Sem acesso a esta empresa'; end if;
  if nullif(trim(p_nome), '') is null then raise exception 'Dê um nome ao grupo'; end if;
  insert into chat_conversas(empresa_id, tipo, nome, descricao, criado_por)
  values (p_empresa, 'grupo', left(trim(p_nome), 80), nullif(left(trim(coalesce(p_descricao, '')), 500), ''), eu) returning id into v_id;
  insert into chat_participantes(conversa_id, user_id, empresa_id, admin) values (v_id, eu, p_empresa, true);
  insert into chat_participantes(conversa_id, user_id, empresa_id)
  select v_id, m.user_id, p_empresa from membros m where m.empresa_id = p_empresa and m.user_id = any(coalesce(p_users, '{}')) and m.user_id <> eu
  on conflict do nothing;
  perform public._chat_sistema(v_id, public._chat_nome(eu, p_empresa) || ' criou o grupo "' || left(trim(p_nome), 80) || '"');
  update chat_conversas c set ultima_msg_em = now(), ultima_msg_texto = 'Grupo criado', ultima_msg_autor = eu where c.id = v_id;
  return v_id;
end $$;

-- 6) Administrar grupo (só administradores do grupo; sair, qualquer um) -----------------------------------
create or replace function public._chat_admin(p_conversa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from chat_participantes p join chat_conversas c on c.id = p.conversa_id
                 where p.conversa_id = p_conversa and p.user_id = auth.uid() and p.saiu_em is null and p.admin and c.tipo = 'grupo'
                   and public.is_participante(p.empresa_id));
$$;

create or replace function public.chat_grupo_editar(p_conversa uuid, p_nome text, p_descricao text, p_so_admins boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_antigo text;
begin
  if not public._chat_admin(p_conversa) then raise exception 'Só os administradores do grupo podem alterar o grupo'; end if;
  if nullif(trim(p_nome), '') is null then raise exception 'Dê um nome ao grupo'; end if;
  select nome into v_antigo from chat_conversas where id = p_conversa;
  update chat_conversas set nome = left(trim(p_nome), 80), descricao = nullif(left(trim(coalesce(p_descricao, '')), 500), ''),
         so_admins_escrevem = coalesce(p_so_admins, false)
   where id = p_conversa;
  if v_antigo is distinct from left(trim(p_nome), 80) then
    perform public._chat_sistema(p_conversa, public._chat_nome(auth.uid(), (select empresa_id from chat_conversas where id = p_conversa))
                                 || ' mudou o nome do grupo para "' || left(trim(p_nome), 80) || '"');
  end if;
end $$;

create or replace function public.chat_grupo_adicionar(p_conversa uuid, p_users uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; r record; n int := 0;
begin
  if not public._chat_admin(p_conversa) then raise exception 'Só os administradores do grupo podem adicionar pessoas'; end if;
  select empresa_id into v_emp from chat_conversas where id = p_conversa;
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

create or replace function public.chat_grupo_remover(p_conversa uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; eu uuid := auth.uid();
begin
  select empresa_id into v_emp from chat_conversas where id = p_conversa and tipo = 'grupo';
  if v_emp is null then raise exception 'Grupo não encontrado'; end if;
  if p_user = eu then
    if not public._chat_ativo(p_conversa) then raise exception 'Você não está neste grupo'; end if;
  elsif not public._chat_admin(p_conversa) then raise exception 'Só os administradores do grupo podem remover pessoas';
  end if;
  update chat_participantes set saiu_em = now(), admin = false where conversa_id = p_conversa and user_id = p_user and saiu_em is null;
  if not found then return; end if;
  perform public._chat_sistema(p_conversa, case when p_user = eu then public._chat_nome(eu, v_emp) || ' saiu'
                                                else public._chat_nome(eu, v_emp) || ' removeu ' || public._chat_nome(p_user, v_emp) end);
  -- grupo sem administrador: o participante mais antigo passa a ser
  if not exists (select 1 from chat_participantes where conversa_id = p_conversa and saiu_em is null and admin) then
    update chat_participantes set admin = true
     where (conversa_id, user_id) = (select conversa_id, user_id from chat_participantes where conversa_id = p_conversa and saiu_em is null order by entrou_em limit 1);
  end if;
end $$;

create or replace function public.chat_grupo_admin(p_conversa uuid, p_user uuid, p_admin boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public._chat_admin(p_conversa) then raise exception 'Só os administradores do grupo podem fazer isso'; end if;
  if not coalesce(p_admin, false) and not exists (select 1 from chat_participantes where conversa_id = p_conversa and saiu_em is null and admin and user_id <> p_user) then
    raise exception 'O grupo precisa de pelo menos um administrador';
  end if;
  update chat_participantes set admin = coalesce(p_admin, false) where conversa_id = p_conversa and user_id = p_user and saiu_em is null;
end $$;

-- 7) Enviar ------------------------------------------------------------------------------------------------
-- p_anexos: [{caminho, nome, mime, tamanho, largura, altura}] já enviados ao armazenamento "chat" em <empresa>/<conversa>/
create or replace function public.chat_enviar(p_conversa uuid, p_texto text, p_cliente_id uuid default null, p_anexos jsonb default '[]')
returns public.chat_mensagens
language plpgsql security definer set search_path = public as $$
declare c chat_conversas; m chat_mensagens; eu uuid := auth.uid(); a jsonb; v_txt text := nullif(btrim(coalesce(p_texto, ''), E' \t\r\n'), '');
  v_prev text; v_nome text; r record; n_anexos int := jsonb_array_length(coalesce(p_anexos, '[]'));
begin
  if p_cliente_id is not null then
    select * into m from chat_mensagens where cliente_id = p_cliente_id and autor_id = eu;
    if found then return m; end if;                                  -- reenvio da fila: já foi
  end if;
  select * into c from chat_conversas where id = p_conversa;
  if c.id is null or not public._chat_ativo(p_conversa) then raise exception 'Você não participa desta conversa'; end if;
  if c.so_admins_escrevem and not public._chat_admin(p_conversa) then raise exception 'Só os administradores podem escrever neste grupo'; end if;
  if v_txt is null and n_anexos = 0 then raise exception 'Mensagem vazia'; end if;
  if length(v_txt) > 8000 then raise exception 'Mensagem muito longa (até 8.000 caracteres)'; end if;
  if n_anexos > 10 then raise exception 'Até 10 arquivos por mensagem'; end if;

  insert into chat_mensagens(conversa_id, empresa_id, autor_id, tipo, texto, cliente_id)
  values (p_conversa, c.empresa_id, eu, case when n_anexos > 0 then 'anexo' else 'texto' end, v_txt, p_cliente_id)
  returning * into m;
  for a in select * from jsonb_array_elements(coalesce(p_anexos, '[]')) loop
    if (a ->> 'caminho') is null or (a ->> 'caminho') not like c.empresa_id || '/' || c.id || '/%' then raise exception 'Arquivo fora da conversa'; end if;
    insert into chat_anexos(mensagem_id, conversa_id, empresa_id, caminho, nome, mime, tamanho, largura, altura)
    values (m.id, c.id, c.empresa_id, a ->> 'caminho', left(coalesce(nullif(a ->> 'nome', ''), 'arquivo'), 200), a ->> 'mime',
            nullif(a ->> 'tamanho', '')::bigint, nullif(a ->> 'largura', '')::int, nullif(a ->> 'altura', '')::int);
  end loop;

  v_prev := coalesce(left(regexp_replace(v_txt, '\s+', ' ', 'g'), 120),
                     case when n_anexos = 1 then '📎 ' || left(coalesce(p_anexos -> 0 ->> 'nome', 'arquivo'), 100) else '📎 ' || n_anexos || ' arquivos' end);
  update chat_conversas set ultima_msg_em = m.criado_em, ultima_msg_texto = v_prev, ultima_msg_autor = eu where id = c.id;
  update chat_participantes set lida_ate = m.criado_em, entregue_ate = m.criado_em, arquivada = false where conversa_id = c.id and user_id = eu;
  update chat_participantes set arquivada = false where conversa_id = c.id and saiu_em is null and arquivada;

  -- aviso no celular/computador: um por conversa a cada 2 minutos, só para quem não silenciou
  v_nome := public._chat_nome(eu, c.empresa_id);
  for r in select p.user_id from chat_participantes p
           where p.conversa_id = c.id and p.user_id <> eu and p.saiu_em is null and coalesce(p.silenciada_ate, '-infinity') < now()
             and not exists (select 1 from notificacoes n where n.user_id = p.user_id and n.tipo = 'chat' and n.ref_id = c.id
                             and n.lida_em is null and n.criado_em > now() - interval '2 minutes')
  loop
    insert into notificacoes(empresa_id, user_id, tipo, titulo, corpo, link, ref_id)
    values (c.empresa_id, r.user_id, 'chat', case when c.tipo = 'grupo' then c.nome else v_nome end,
            case when c.tipo = 'grupo' then v_nome || ': ' else '' end || v_prev, '#/conversas?c=' || c.id, c.id);
  end loop;
  return m;
end $$;

-- 8) Entregue, lida e preferências ---------------------------------------------------------------------------
create or replace function public.chat_marcar(p_conversa uuid, p_lida boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  update chat_participantes set entregue_ate = greatest(coalesce(entregue_ate, '-infinity'), now()),
         lida_ate = case when p_lida then greatest(coalesce(lida_ate, '-infinity'), now()) else lida_ate end
   where conversa_id = p_conversa and user_id = auth.uid() and saiu_em is null and public.is_participante(empresa_id);
  if p_lida then
    update notificacoes set lida_em = now() where user_id = auth.uid() and tipo = 'chat' and ref_id = p_conversa and lida_em is null;
  end if;
end $$;

-- o aparelho abriu a plataforma: tudo o que chegou até agora foi entregue
create or replace function public.chat_marcar_entregue(p_empresa uuid) returns void
language sql security definer set search_path = public as $$
  update chat_participantes p set entregue_ate = now()
   where p.user_id = auth.uid() and p.empresa_id = p_empresa and p.saiu_em is null and public.is_participante(p_empresa)
     and exists (select 1 from chat_conversas c where c.id = p.conversa_id and c.ultima_msg_em > coalesce(p.entregue_ate, '-infinity'));
$$;

create or replace function public.chat_preferencias(p_conversa uuid, p_silenciada_ate timestamptz default null, p_fixada boolean default null,
                                                    p_arquivada boolean default null, p_tirar_silencio boolean default false) returns void
language plpgsql security definer set search_path = public as $$
begin
  update chat_participantes set
    silenciada_ate = case when p_tirar_silencio then null else coalesce(p_silenciada_ate, silenciada_ate) end,
    fixada = coalesce(p_fixada, fixada), arquivada = coalesce(p_arquivada, arquivada)
  where conversa_id = p_conversa and user_id = auth.uid() and public.is_participante(empresa_id);
end $$;

-- 9) Permissões das funções ------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['chat_participa(uuid)', 'chat_contatos(uuid)', 'chat_resumo(uuid)', 'chat_abrir_direta(uuid,uuid)',
    'chat_criar_grupo(uuid,text,text,uuid[])', 'chat_grupo_editar(uuid,text,text,boolean)', 'chat_grupo_adicionar(uuid,uuid[])',
    'chat_grupo_remover(uuid,uuid)', 'chat_grupo_admin(uuid,uuid,boolean)', 'chat_enviar(uuid,text,uuid,jsonb)',
    'chat_marcar(uuid,boolean)', 'chat_marcar_entregue(uuid)', 'chat_preferencias(uuid,timestamptz,boolean,boolean,boolean)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  foreach f in array array['_chat_ativo(uuid)', '_chat_nome(uuid,uuid)', '_chat_sistema(uuid,text)', '_chat_admin(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- 10) Arquivos: armazenamento privado "chat", pasta <empresa>/<conversa>/ ---------------------------------------
-- anexa quem participa agora da conversa da pasta (e a pasta da empresa é a da conversa)
create or replace function public._chat_pode_anexar(p_nome text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from chat_conversas c
                 where c.id = public._uuid_ou_nulo(split_part(p_nome, '/', 2))
                   and c.empresa_id = public._uuid_ou_nulo(split_part(p_nome, '/', 1))
                   and public._chat_ativo(c.id));
$$;
revoke execute on function public._chat_pode_anexar(text) from public, anon;
grant execute on function public._chat_pode_anexar(text) to authenticated, service_role;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat', 'chat', false, 26214400, null)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;
drop policy if exists chat_arq_sel on storage.objects;
drop policy if exists chat_arq_ins on storage.objects;
create policy chat_arq_sel on storage.objects for select to authenticated using (
  bucket_id = 'chat' and exists (select 1 from public.chat_anexos a where a.caminho = storage.objects.name));   -- vale a regra das mensagens
create policy chat_arq_ins on storage.objects for insert to authenticated with check (
  bucket_id = 'chat' and public._chat_pode_anexar(storage.objects.name));

-- 11) Tempo real ------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['chat_mensagens', 'chat_participantes', 'chat_conversas'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- conferência: tabelas = 4, funcoes = 18, no_tempo_real = 3
select (select count(*) from pg_tables where schemaname = 'public' and tablename like 'chat\_%') as tabelas,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like any (array['chat\_%', '\_chat\_%'])) as funcoes,
       (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'chat\_%') as no_tempo_real;
