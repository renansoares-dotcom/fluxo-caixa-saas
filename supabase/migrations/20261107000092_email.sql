-- =====================================================================
-- Melhoria contínua 1.1 — E-mail da plataforma (07/11/2026). Remetente avisos@iplamm.com.br (o domínio é validado com o TI;
-- até lá o envio fica DESLIGADO e os e-mails esperam na fila por até 7 dias).
--  - configuração por empresa (remetente, responder para, endereço da plataforma, ligado/desligado);
--  - modelos editáveis por tela (assunto e texto com {{campos}}); sem modelo salvo, vale o texto padrão;
--  - fila de envio com a situação de cada e-mail (pendente, enviado, erro, ignorado) e o motivo do erro;
--  - e-mails automáticos: convite do Portal (para o cliente), arte aguardando aprovação (para os usuários do Portal do
--    cliente), resposta da prorrogação (para quem pediu) e os avisos internos que a pessoa marcou "e-mail" em Meus avisos;
--  - envio pela função "email" (provedor Resend), chamada logo depois das ações e pelo agendamento a cada minuto.
-- Migração ADITIVA.
-- =====================================================================

create table if not exists public.email_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ativo boolean not null default false,                      -- liga depois que o domínio estiver validado
  remetente_nome text not null default 'IPLAMM',
  remetente_email text not null default 'avisos@iplamm.com.br',
  responder_para text,
  url_base text,                                             -- endereço da plataforma (preenchido pela tela)
  rodape text not null default 'Mensagem automática da plataforma. Não responda a este e-mail se o campo "responder para" não estiver configurado.',
  atualizado_em timestamptz not null default now()
);
create table if not exists public.email_modelos (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,
  assunto text not null,
  corpo text not null,                                       -- texto simples com {{campos}}; linhas em branco viram parágrafos
  botao text,                                                -- texto do botão (o link vem do campo {{link}})
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, codigo)
);
create table if not exists public.email_fila (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,
  para text not null check (para ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  campos jsonb not null default '{}'::jsonb,
  ref_id uuid,
  situacao text not null default 'pendente' check (situacao in ('pendente', 'enviado', 'erro', 'ignorado')),
  tentativas int not null default 0,
  erro text, provedor_id text,
  criado_em timestamptz not null default now(), enviado_em timestamptz
);
create index if not exists email_fila_pend on public.email_fila(criado_em) where situacao = 'pendente';
create index if not exists email_fila_emp on public.email_fila(empresa_id, criado_em desc);

alter table public.email_config enable row level security;
alter table public.email_modelos enable row level security;
alter table public.email_fila enable row level security;
drop policy if exists email_config_sel on public.email_config; drop policy if exists email_config_ins on public.email_config; drop policy if exists email_config_upd on public.email_config;
drop policy if exists email_modelos_all on public.email_modelos; drop policy if exists email_fila_sel on public.email_fila;
create policy email_config_sel on public.email_config for select to authenticated using (public.is_participante(empresa_id));
create policy email_config_ins on public.email_config for insert to authenticated with check (public.is_admin(empresa_id));
create policy email_config_upd on public.email_config for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
create policy email_modelos_all on public.email_modelos for all to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
create policy email_fila_sel on public.email_fila for select to authenticated using (public.is_admin(empresa_id));
grant select, insert, update on public.email_config to authenticated;
grant select, insert, update, delete on public.email_modelos to authenticated;
grant select on public.email_fila to authenticated;

-- textos padrão (valem enquanto a empresa não salvar o seu modelo)
create or replace function public.email_padrao()
returns table(codigo text, nome text, assunto text, corpo text, botao text, campos text)
language sql immutable set search_path = public as $$
  values
  ('portal_convite', 'Convite para o Portal do Cliente', 'Convite para o Portal do Cliente — {{empresa}}',
   E'Olá,\n\n{{empresa}} liberou para {{cliente}} o acesso ao Portal do Cliente. Nele você vê os títulos e as notas fiscais, pede prorrogação de vencimento e aprova as artes das embalagens.\n\nClique no botão para criar a sua senha. O convite vale até {{validade}}.', 'Criar meu acesso', 'empresa, cliente, validade'),
  ('arte_aprovacao', 'Arte aguardando a aprovação do cliente', 'Arte nº {{numero}} aguardando a sua aprovação — {{arte}}',
   E'Olá,\n\nA versão {{versao}} da arte {{arte}} está pronta para a sua conferência.\n\n{{observacao}}\n\nConfira textos, cores, medidas e o código de barras. No Portal você pode marcar pontos na arte, aprovar ou pedir alteração. Responda até {{prazo}}.', 'Conferir a arte', 'empresa, cliente, arte, numero, versao, observacao, prazo'),
  ('prorrogacao_resposta', 'Resposta do pedido de prorrogação', 'Pedido de prorrogação {{decisao}} — {{documento}}',
   E'Olá,\n\nO seu pedido de prorrogação do título {{documento}} foi {{decisao}}. O vencimento é {{vencimento}}.\n\n{{resposta}}', 'Abrir o Portal', 'empresa, cliente, documento, decisao, vencimento, resposta'),
  ('aviso', 'Avisos da plataforma (Meus avisos)', '{{titulo}}', E'{{texto}}', 'Abrir na plataforma', 'empresa, titulo, texto'),
  ('teste', 'E-mail de teste', 'E-mail de teste — {{empresa}}', E'Olá {{nome}},\n\nSe você recebeu esta mensagem, o e-mail da plataforma está funcionando.', null, 'empresa, nome');
$$;
grant execute on function public.email_padrao() to authenticated, service_role;

-- coloca um e-mail na fila (só o banco chama; a tela usa email_teste)
create or replace function public._email_enfileirar(p_empresa uuid, p_codigo text, p_para text, p_campos jsonb, p_ref uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_para is null or p_para !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return; end if;
  if exists (select 1 from email_modelos where empresa_id = p_empresa and codigo = p_codigo and not ativo) then return; end if;   -- modelo desligado
  insert into email_fila(empresa_id, codigo, para, campos, ref_id)
  values (p_empresa, p_codigo, lower(trim(p_para)),
          coalesce(p_campos, '{}') || jsonb_build_object('empresa', (select nome from empresas where id = p_empresa)), p_ref);
end $$;
revoke all on function public._email_enfileirar(uuid, text, text, jsonb, uuid) from public, anon, authenticated;

-- e-mail de teste para quem está logado (administrador)
create or replace function public.email_teste(p_empresa uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_admin(p_empresa) then raise exception 'Só o administrador manda o e-mail de teste.'; end if;
  insert into email_fila(empresa_id, codigo, para, campos)
  values (p_empresa, 'teste', lower(auth.jwt() ->> 'email'), jsonb_build_object('empresa', (select nome from empresas where id = p_empresa), 'nome', coalesce(auth.jwt() -> 'user_metadata' ->> 'nome', '')))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.email_teste(uuid) from public, anon;
grant execute on function public.email_teste(uuid) to authenticated;

-- 1) convite do Portal → e-mail do cliente
create or replace function public._email_portal() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_fav text; r record;
begin
  if tg_table_name = 'portal_convites' then
    select nome into v_fav from favorecidos where id = new.favorecido_id;
    perform _email_enfileirar(new.empresa_id, 'portal_convite', new.email,
      jsonb_build_object('cliente', v_fav, 'caminho', 'portal.html?convite=' || new.token, 'validade', to_char(new.expira_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')), new.id);
  elsif tg_table_name = 'portal_prorrogacoes' then
    if old.status = 'pendente' and new.status in ('aprovada', 'recusada') then
      perform _email_enfileirar(new.empresa_id, 'prorrogacao_resposta', (select email from auth.users where id = new.solicitado_por),
        jsonb_build_object('cliente', (select nome from favorecidos where id = new.favorecido_id), 'documento', coalesce(new.documento, ''),
          'decisao', case new.status when 'aprovada' then 'APROVADA' else 'RECUSADA' end,
          'vencimento', to_char(case when new.status = 'aprovada' then new.nova_data else new.vencimento_atual end, 'DD/MM/YYYY'),
          'resposta', coalesce(new.resposta, ''), 'caminho', 'portal.html'), new.id);
    end if;
  elsif tg_table_name = 'pre_versoes' then
    if new.enviada_em is not null and old.enviada_em is null then
      for r in select pu.email, p.numero, p.nome, p.prazo, p.id pid, f.nome cli
                 from pre_projetos p join portal_usuarios pu on pu.favorecido_id = p.favorecido_id and pu.ativo
                 join favorecidos f on f.id = p.favorecido_id where p.id = new.projeto_id loop
        perform _email_enfileirar(new.empresa_id, 'arte_aprovacao', r.email,
          jsonb_build_object('cliente', r.cli, 'arte', r.nome, 'numero', r.numero, 'versao', new.numero, 'observacao', coalesce(new.observacao, ''),
            'prazo', coalesce(to_char(r.prazo, 'DD/MM/YYYY'), ''), 'caminho', 'portal.html?arte=' || r.pid), new.id);
      end loop;
    end if;
  end if;
  return null;
end $$;
revoke all on function public._email_portal() from public, anon, authenticated;
drop trigger if exists portal_convites_email on public.portal_convites;
create trigger portal_convites_email after insert on public.portal_convites for each row execute function public._email_portal();
drop trigger if exists portal_prorrogacoes_email on public.portal_prorrogacoes;
create trigger portal_prorrogacoes_email after update of status on public.portal_prorrogacoes for each row execute function public._email_portal();
do $$ begin
  if to_regclass('public.pre_versoes') is not null then
    drop trigger if exists pre_versoes_email on public.pre_versoes;
    create trigger pre_versoes_email after update of enviada_em on public.pre_versoes for each row execute function public._email_portal();
  end if;
end $$;

-- 2) avisos internos com "e-mail" marcado em Meus avisos
create or replace function public._email_aviso() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cod text;
begin
  if new.tipo in ('chat', 'teste') then return null; end if;
  select codigo into v_cod from notif_tipos where new.tipo = codigo or new.tipo like codigo || '\_%' order by length(codigo) desc limit 1;
  if v_cod is null or not exists (select 1 from notif_preferencias where user_id = new.user_id and empresa_id = new.empresa_id and tipo = v_cod and email) then return null; end if;
  perform _email_enfileirar(new.empresa_id, 'aviso', (select email from auth.users where id = new.user_id),
    jsonb_build_object('titulo', new.titulo, 'texto', coalesce(new.corpo, ''), 'caminho', 'index.html' || coalesce(new.link, ''), 'urgente', new.urgente), new.id);
  return null;
end $$;
revoke all on function public._email_aviso() from public, anon, authenticated;
drop trigger if exists notificacoes_email on public.notificacoes;
create trigger notificacoes_email after insert on public.notificacoes for each row execute function public._email_aviso();

-- 3) envio a cada minuto (mesma chave do Vault usada pelos avisos)
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'pg_cron/pg_net indisponíveis: o e-mail sai só pelo disparo depois das ações.'; return;
  end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'email-enviar';
  perform cron.schedule('email-enviar', '* * * * *', $job$
    select net.http_post(
      url := 'https://ceyzvhcpgokysgmpdalt.supabase.co/functions/v1/email',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-chave', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'notificar_cron'), '')),
      body := '{}'::jsonb)
    where exists (select 1 from public.email_fila f join public.email_config c on c.empresa_id = f.empresa_id and c.ativo
                   where f.situacao = 'pendente' and f.criado_em > now() - interval '7 days')
      and exists (select 1 from vault.decrypted_secrets where name = 'notificar_cron');
  $job$);
exception when others then raise notice 'agendamento do e-mail não criado: %', sqlerrm;
end $$;

-- conferência: tabelas = 3, gatilhos = 4 (3 se a pré-impressão não existir)
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('email_config', 'email_modelos', 'email_fila')) as tabelas,
       (select count(*) from pg_trigger where tgname like '%\_email') as gatilhos;
