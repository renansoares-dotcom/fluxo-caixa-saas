-- WhatsApp (melhoria 1.1b do plano de melhoria contínua, Passo 4) — 08/11/2026.
-- Aditivo. As mesmas mensagens do e-mail (SQL 092 e 124) também pelo WhatsApp, pela API oficial (WhatsApp Cloud API, Meta):
--   • cliente do Portal: arte para aprovar, resposta da prorrogação, saiu para entrega e entregue — se ele cadastrou
--     o número e aceitou receber (opt-in) no próprio Portal;
--   • equipe: os avisos que a pessoa marcou "WhatsApp" em Meus avisos, com o número e o aceite dela.
-- A Meta só deixa a empresa iniciar a conversa com MODELOS aprovados: cada mensagem da plataforma aponta para o nome
-- do modelo aprovado e a ordem dos campos ({{1}}, {{2}}…). Os textos sugeridos para aprovar estão em wa_padrao().
-- O envio é feito pela função "whatsapp" (segredos WHATSAPP_TOKEN e CRON_CHAVE), a cada minuto, como o e-mail.

create table if not exists public.wa_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ativo boolean not null default false,
  phone_number_id text check (phone_number_id ~ '^\d{6,30}$'),     -- identificação do número na Meta (não é o telefone)
  numero_exibicao text,                                             -- o telefone que o cliente vê, só para a tela
  idioma text not null default 'pt_BR' check (idioma ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  url_base text,                                                    -- endereço da plataforma (links dos botões)
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
create table if not exists public.wa_modelos (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,
  template text not null check (template ~ '^[a-z0-9_]+$' and length(template) <= 512),  -- nome do modelo aprovado na Meta
  parametros text[] not null default '{}',                          -- campos na ordem {{1}}, {{2}}…
  botao_campo text,                                                 -- campo do link do botão (o modelo tem botão de URL dinâmico)
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, codigo)
);
create table if not exists public.wa_fila (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,
  para text not null check (para ~ '^55\d{10,11}$'),
  campos jsonb not null default '{}'::jsonb,
  ref_id uuid,
  situacao text not null default 'pendente' check (situacao in ('pendente', 'enviado', 'erro', 'ignorado')),
  tentativas int not null default 0,
  erro text, provedor_id text,
  criado_em timestamptz not null default now(), enviado_em timestamptz
);
create index if not exists wa_fila_pend on public.wa_fila(criado_em) where situacao = 'pendente';
create index if not exists wa_fila_emp on public.wa_fila(empresa_id, criado_em desc);
-- o número de cada pessoa da equipe, com o aceite (vale para todas as empresas em que ela está)
create table if not exists public.wa_contatos (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  numero text check (numero ~ '^55\d{10,11}$'),
  optin_em timestamptz,
  atualizado_em timestamptz not null default now()
);
alter table public.notif_preferencias add column if not exists whatsapp boolean not null default false;
alter table public.portal_usuarios add column if not exists whatsapp text check (whatsapp ~ '^55\d{10,11}$');
alter table public.portal_usuarios add column if not exists whatsapp_optin_em timestamptz;

alter table public.wa_config enable row level security;
alter table public.wa_modelos enable row level security;
alter table public.wa_fila enable row level security;
alter table public.wa_contatos enable row level security;
drop policy if exists wa_config_sel on public.wa_config; drop policy if exists wa_config_ins on public.wa_config; drop policy if exists wa_config_upd on public.wa_config;
drop policy if exists wa_modelos_all on public.wa_modelos; drop policy if exists wa_fila_sel on public.wa_fila;
drop policy if exists wa_contatos_sel on public.wa_contatos; drop policy if exists wa_contatos_ins on public.wa_contatos; drop policy if exists wa_contatos_upd on public.wa_contatos; drop policy if exists wa_contatos_del on public.wa_contatos;
create policy wa_config_sel on public.wa_config for select to authenticated using (public.is_participante(empresa_id));
create policy wa_config_ins on public.wa_config for insert to authenticated with check (public.is_admin(empresa_id));
create policy wa_config_upd on public.wa_config for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
create policy wa_modelos_all on public.wa_modelos for all to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
create policy wa_fila_sel on public.wa_fila for select to authenticated using (public.is_admin(empresa_id));
create policy wa_contatos_sel on public.wa_contatos for select to authenticated using (user_id = auth.uid());
create policy wa_contatos_ins on public.wa_contatos for insert to authenticated with check (user_id = auth.uid());
create policy wa_contatos_upd on public.wa_contatos for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy wa_contatos_del on public.wa_contatos for delete to authenticated using (user_id = auth.uid());
grant select, insert, update on public.wa_config to authenticated;
grant select, insert, update, delete on public.wa_modelos to authenticated;
grant select on public.wa_fila to authenticated;
grant select, insert, update, delete on public.wa_contatos to authenticated;
do $$
declare t text;
begin
  foreach t in array array['wa_config', 'wa_modelos'] loop
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;

-- telefone em formato internacional do Brasil (55 + DDD + número); vazio se não der
create or replace function public._wa_numero(p text) returns text language sql immutable as $$
  select case when d ~ '^55\d{10,11}$' then d when d ~ '^\d{10,11}$' then '55' || d end
    from (select regexp_replace(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '^0+', '') d) x;
$$;

-- modelos sugeridos (texto para cadastrar e aprovar na Meta; categoria "Utilidade")
create or replace function public.wa_padrao()
returns table(codigo text, nome text, template text, parametros text[], botao_campo text, texto text)
language sql immutable set search_path = public as $$
  values
  ('arte_aprovacao', 'Arte aguardando a aprovação do cliente', 'arte_para_aprovar', array['empresa', 'arte', 'versao', 'prazo'], 'caminho',
   'Olá! {{1}} enviou a versão {{3}} da arte {{2}} para a sua aprovação. Responda até {{4}} pelo Portal do Cliente.'),
  ('prorrogacao_resposta', 'Resposta do pedido de prorrogação', 'resposta_prorrogacao', array['empresa', 'documento', 'decisao', 'vencimento'], 'caminho',
   'Olá! {{1}} respondeu o seu pedido de prorrogação do título {{2}}: {{3}}. O vencimento é {{4}}.'),
  ('entrega_saiu', 'Pedido saiu para entrega', 'pedido_saiu_entrega', array['empresa', 'notas', 'veiculo'], 'caminho',
   'Olá! A mercadoria das notas {{2}} de {{1}} saiu para entrega hoje, no veículo {{3}}. Acompanhe pelo Portal do Cliente.'),
  ('entrega_feita', 'Pedido entregue', 'pedido_entregue', array['empresa', 'nota', 'quando', 'recebedor'], 'caminho',
   'Olá! A nota {{2}} de {{1}} foi entregue em {{3}} e recebida por {{4}}. O canhoto está no Portal do Cliente.'),
  ('aviso', 'Avisos da plataforma (Meus avisos)', 'aviso_plataforma', array['empresa', 'titulo', 'texto'], 'caminho',
   'Aviso da plataforma {{1}}: {{2}}. {{3}}'),
  ('teste', 'Mensagem de teste', 'teste_plataforma', array['empresa', 'nome'], null,
   'Olá {{2}}! Esta é uma mensagem de teste da plataforma {{1}}. O WhatsApp está funcionando.');
$$;
grant execute on function public.wa_padrao() to authenticated, service_role;

-- coloca na fila (só o banco chama). Sem modelo para o código, ou com o modelo desligado, não entra.
create or replace function public._wa_enfileirar(p_empresa uuid, p_codigo text, p_numero text, p_campos jsonb, p_ref uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare n text := public._wa_numero(p_numero);
begin
  if n is null then return; end if;
  if exists (select 1 from wa_modelos where empresa_id = p_empresa and codigo = p_codigo and not ativo) then return; end if;
  if not exists (select 1 from wa_modelos where empresa_id = p_empresa and codigo = p_codigo)
     and not exists (select 1 from wa_padrao() where codigo = p_codigo) then return; end if;
  insert into wa_fila(empresa_id, codigo, para, campos, ref_id)
  values (p_empresa, p_codigo, n, coalesce(p_campos, '{}') || jsonb_build_object('empresa', (select nome from empresas where id = p_empresa)), p_ref);
end $$;
revoke all on function public._wa_enfileirar(uuid, text, text, jsonb, uuid) from public, anon, authenticated;

-- o e-mail ao cliente do Portal também vai pelo WhatsApp de quem aceitou (mesma mensagem, mesmo momento)
create or replace function public._email_enfileirar(p_empresa uuid, p_codigo text, p_para text, p_campos jsonb, p_ref uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if p_para is null or p_para !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return; end if;
  if not exists (select 1 from email_modelos where empresa_id = p_empresa and codigo = p_codigo and not ativo) then
    insert into email_fila(empresa_id, codigo, para, campos, ref_id)
    values (p_empresa, p_codigo, lower(trim(p_para)),
            coalesce(p_campos, '{}') || jsonb_build_object('empresa', (select nome from empresas where id = p_empresa)), p_ref);
  end if;
  if p_codigo in ('arte_aprovacao', 'prorrogacao_resposta', 'entrega_saiu', 'entrega_feita') then
    for r in select distinct whatsapp from portal_usuarios
              where empresa_id = p_empresa and ativo and lower(email) = lower(trim(p_para)) and whatsapp is not null and whatsapp_optin_em is not null loop
      perform _wa_enfileirar(p_empresa, p_codigo, r.whatsapp, p_campos, p_ref);
    end loop;
  end if;
end $$;
revoke all on function public._email_enfileirar(uuid, text, text, jsonb, uuid) from public, anon, authenticated;

-- avisos internos com "WhatsApp" marcado em Meus avisos
create or replace function public._wa_aviso() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cod text; v_num text;
begin
  if new.tipo in ('chat', 'teste') then return null; end if;
  select codigo into v_cod from notif_tipos where new.tipo = codigo or new.tipo like codigo || '\_%' order by length(codigo) desc limit 1;
  if v_cod is null or not exists (select 1 from notif_preferencias where user_id = new.user_id and empresa_id = new.empresa_id and tipo = v_cod and whatsapp) then return null; end if;
  select numero into v_num from wa_contatos where user_id = new.user_id and optin_em is not null;
  if v_num is null then return null; end if;
  perform _wa_enfileirar(new.empresa_id, 'aviso', v_num,
    jsonb_build_object('titulo', left(new.titulo, 200), 'texto', left(coalesce(new.corpo, ''), 600), 'caminho', 'index.html' || coalesce(new.link, '')), new.id);
  return null;
end $$;
revoke all on function public._wa_aviso() from public, anon, authenticated;
drop trigger if exists notificacoes_whatsapp on public.notificacoes;
create trigger notificacoes_whatsapp after insert on public.notificacoes for each row execute function public._wa_aviso();

-- o cliente do Portal cadastra o próprio número e aceita (ou deixa de aceitar) receber pelo WhatsApp
create or replace function public.portal_whatsapp(p_numero text, p_aceito boolean)
returns text language plpgsql security definer set search_path = public as $$
declare n text := public._wa_numero(p_numero);
begin
  if not exists (select 1 from portal_usuarios where user_id = auth.uid()) then raise exception 'Sem acesso ao Portal.'; end if;
  if p_aceito and n is null then raise exception 'Informe o celular com DDD.'; end if;
  update portal_usuarios set whatsapp = case when p_aceito then n else whatsapp end,
         whatsapp_optin_em = case when p_aceito then coalesce(whatsapp_optin_em, now()) else null end
   where user_id = auth.uid();
  return n;
end $$;
create or replace function public.portal_whatsapp_meu()
returns table(numero text, aceito boolean) language sql stable security definer set search_path = public as $$
  select whatsapp, whatsapp_optin_em is not null from portal_usuarios where user_id = auth.uid() order by whatsapp_optin_em desc nulls last limit 1;
$$;
revoke all on function public.portal_whatsapp(text, boolean), public.portal_whatsapp_meu() from public, anon;
grant execute on function public.portal_whatsapp(text, boolean), public.portal_whatsapp_meu() to authenticated;

-- mensagem de teste para o próprio número (administrador)
create or replace function public.wa_teste(p_empresa uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_num text; v_id uuid;
begin
  if not is_admin(p_empresa) then raise exception 'Só o administrador manda a mensagem de teste.'; end if;
  select numero into v_num from wa_contatos where user_id = auth.uid() and optin_em is not null;
  if v_num is null then raise exception 'Cadastre o seu celular e aceite receber pelo WhatsApp em Meus avisos.'; end if;
  insert into wa_fila(empresa_id, codigo, para, campos)
  values (p_empresa, 'teste', v_num, jsonb_build_object('empresa', (select nome from empresas where id = p_empresa), 'nome', coalesce(auth.jwt() -> 'user_metadata' ->> 'nome', '')))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.wa_teste(uuid) from public, anon;
grant execute on function public.wa_teste(uuid) to authenticated;

-- envio a cada minuto (mesma chave do Vault do e-mail e dos avisos)
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_cron/pg_net indisponíveis: o WhatsApp sai só pelo disparo depois das ações.'; return;
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'whatsapp-enviar';
  perform cron.schedule('whatsapp-enviar', '* * * * *', $job$
    select net.http_post(
      url := 'https://ceyzvhcpgokysgmpdalt.supabase.co/functions/v1/whatsapp',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-chave', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'notificar_cron'), '')),
      body := '{}'::jsonb)
    where exists (select 1 from public.wa_fila f join public.wa_config c on c.empresa_id = f.empresa_id and c.ativo
                   where f.situacao = 'pendente' and f.criado_em > now() - interval '3 days')
      and exists (select 1 from vault.decrypted_secrets where name = 'notificar_cron');
  $job$);
exception when others then raise notice 'agendamento do WhatsApp não criado: %', sqlerrm;
end $$;

select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('wa_config', 'wa_modelos', 'wa_fila', 'wa_contatos')) as tabelas;
