-- =====================================================================
-- Melhoria contínua 1.2 — Avisos no celular funcionando e "Meus avisos" (07/11/2026)
--  - catálogo dos tipos de aviso (grupo, nome, urgente) e as preferências de cada pessoa: celular e e-mail por tipo
--    (o e-mail é usado a partir do item 1.1) e o horário de silêncio (padrão 20h–7h e fim de semana; urgente passa);
--  - notificações urgentes (OS de emergência / máquina parada) e o registro do que aconteceu com o aviso no celular;
--  - avisos novos: pedido de prorrogação do Portal, resposta do cliente na arte (decisão, comentário, arquivo),
--    borderô aguardando aprovação e decidido, OS de emergência ou com máquina parada;
--  - envio automático a cada minuto (pg_cron + pg_net), além do disparo logo depois de cada ação;
--  - aviso de teste para a própria pessoa.
-- Migração ADITIVA. Depois de rodar, cadastrar os segredos da função "notificar" (ver o manual Avisos).
-- =====================================================================

alter table public.notificacoes add column if not exists urgente boolean not null default false;
alter table public.notificacoes add column if not exists push_situacao text;      -- enviado | sem_aparelho | desligado | silencio
-- o que ficou na fila antes de os avisos funcionarem não vai de uma vez para o celular (continua no sino)
update public.notificacoes set enviado_em = now(), push_situacao = 'antes_dos_avisos' where enviado_em is null;
create index if not exists notificacoes_pend2 on public.notificacoes(criado_em) where enviado_em is null;

-- 1) catálogo dos tipos (o tipo da notificação começa pelo código do catálogo: paraquedas_novo → paraquedas)
create table if not exists public.notif_tipos (
  codigo text primary key,
  grupo text not null,
  nome text not null,
  descricao text,
  urgente boolean not null default false,
  ordem int not null default 0
);
insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem) values
  ('paraquedas', 'Pagamentos', 'Pagamentos antecipados', 'Novo pedido para autorizar, autorizado, recusado, pago, comprovante.', false, 10),
  ('nd_pendente', 'Financeiro', 'Notas de débito a emitir', 'Juros e multa recebidos que pedem nota de débito.', false, 20),
  ('prorrogacao', 'Financeiro', 'Prorrogação pedida pelo cliente', 'Cliente pediu prorrogação de vencimento no Portal.', false, 25),
  ('bordero', 'Crédito / FIDC', 'Borderôs', 'Proposta de borderô aguardando aprovação e a decisão.', false, 30),
  ('decisao_dia', 'Painéis', 'Decisão do dia', 'Decisão do dia aguardando aprovação e a resposta.', false, 40),
  ('arte', 'Pré-impressão', 'Resposta do cliente na arte', 'Aprovação, pedido de alteração, comentário ou arquivo enviado pelo cliente no Portal.', false, 50),
  ('os_urgente', 'Manutenção', 'Máquina parada / OS de emergência', 'OS aberta com prioridade de emergência ou com a máquina parada. Passa pelo horário de silêncio.', true, 60),
  ('chat', 'Comunicação', 'Mensagens nas Conversas', 'Nova mensagem (respeita o silenciar de cada conversa).', false, 70),
  ('teste', 'Sistema', 'Aviso de teste', 'O aviso que você manda para conferir o celular.', false, 99)
on conflict (codigo) do update set grupo = excluded.grupo, nome = excluded.nome, descricao = excluded.descricao, urgente = excluded.urgente, ordem = excluded.ordem;
alter table public.notif_tipos enable row level security;
drop policy if exists notif_tipos_sel on public.notif_tipos;
create policy notif_tipos_sel on public.notif_tipos for select to authenticated using (true);
grant select on public.notif_tipos to authenticated;

-- 2) preferências (sem linha = recebe no celular, não recebe por e-mail)
create table if not exists public.notif_preferencias (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null references public.notif_tipos(codigo) on delete cascade,
  push boolean not null default true,
  email boolean not null default false,
  atualizado_em timestamptz not null default now(),
  primary key (user_id, empresa_id, tipo)
);
create table if not exists public.notif_horarios (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  silencio boolean not null default true,
  inicio time not null default '20:00', fim time not null default '07:00',
  fim_de_semana boolean not null default true,
  fuso text not null default 'America/Sao_Paulo',
  atualizado_em timestamptz not null default now(),
  primary key (user_id, empresa_id)
);
do $$ declare t text; begin
  foreach t in array array['notif_preferencias', 'notif_horarios'] loop
    execute format('alter table public.%s enable row level security', t);
    execute format('drop policy if exists %1$s_eu on public.%1$s', t);
    execute format('create policy %1$s_eu on public.%1$s for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.is_participante(empresa_id))', t);
    execute format('grant select, insert, update, delete on public.%s to authenticated', t);
  end loop;
end $$;

-- 3) notificar com urgência
create or replace function public._notificar_u(p_empresa uuid, p_users uuid[], p_tipo text, p_titulo text, p_corpo text, p_link text, p_ref uuid, p_urgente boolean)
returns void language sql security definer set search_path = public as $$
  insert into notificacoes(empresa_id, user_id, tipo, titulo, corpo, link, ref_id, urgente)
  select p_empresa, u, p_tipo, p_titulo, p_corpo, p_link, p_ref, coalesce(p_urgente, false) from (select distinct unnest(p_users) u) x
   where u is not null and u is distinct from auth.uid();
$$;
create or replace function public._usuarios_papel(p_empresa uuid, p_papeis text[])
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct user_id), '{}') from membros where empresa_id = p_empresa and papel::text = any(p_papeis);
$$;
revoke all on function public._notificar_u(uuid, uuid[], text, text, text, text, uuid, boolean), public._usuarios_papel(uuid, text[]) from public, anon, authenticated;

-- aviso de teste para a própria pessoa (o gatilho comum não avisa quem fez a ação)
create or replace function public.notif_teste(p_empresa uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_participante(p_empresa) then raise exception 'Sem acesso.'; end if;
  insert into notificacoes(empresa_id, user_id, tipo, titulo, corpo, link)
  values (p_empresa, auth.uid(), 'teste', 'Aviso de teste', 'Se você está vendo isto no celular, os avisos estão funcionando. ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'), '#/meus-avisos');
end $$;
revoke all on function public.notif_teste(uuid) from public, anon;
grant execute on function public.notif_teste(uuid) to authenticated;

-- 4) avisos novos
create or replace function public._avisos_novos() returns trigger
language plpgsql security definer set search_path = public as $$
declare v text; p record; quem uuid[]; eq text; j jsonb; ti text; tit text; det text;
begin
  if tg_table_name = 'portal_prorrogacoes' then
    if tg_op = 'INSERT' then
      v := 'R$ ' || translate(to_char(new.valor, 'FM999,999,999,990.00'), ',.', '.,');
      perform _notificar_u(new.empresa_id, _usuarios_papel(new.empresa_id, array['admin', 'financeiro']), 'prorrogacao_nova',
        'Prorrogação pedida: ' || coalesce((select nome from favorecidos where id = new.favorecido_id), 'cliente'),
        coalesce(new.documento, '') || ' · ' || v || ' · de ' || to_char(new.vencimento_atual, 'DD/MM') || ' para ' || to_char(new.nova_data, 'DD/MM'), '#/portal-clientes', new.id, false);
    end if;
  elsif tg_table_name in ('pre_decisoes', 'pre_versoes', 'pre_comentarios') then
    j := to_jsonb(new);                                   -- campos lidos pelo json: cada tabela tem os seus
    if j ->> 'origem' <> 'cliente' then return null; end if;
    if tg_table_name = 'pre_comentarios' then
      select pp.* into p from pre_projetos pp join pre_versoes vv on vv.projeto_id = pp.id where vv.id = (j ->> 'versao_id')::uuid;
      ti := 'arte_comentario'; tit := 'Comentário do cliente na arte nº ' || p.numero; det := j ->> 'texto';
    else
      select * into p from pre_projetos where id = (j ->> 'projeto_id')::uuid;
      if tg_table_name = 'pre_versoes' then ti := 'arte_arquivo'; tit := 'Cliente enviou um arquivo na arte nº ' || p.numero; det := j ->> 'observacao';
      else
        ti := 'arte_decisao'; det := coalesce(j ->> 'nome', j ->> 'comentario');
        tit := case j ->> 'decisao' when 'aprovada' then 'Arte nº ' || p.numero || ' APROVADA pelo cliente' when 'alteracao' then 'Cliente pediu alteração na arte nº ' || p.numero else 'Cliente reprovou a arte nº ' || p.numero end;
      end if;
    end if;
    quem := _usuarios_papel(p.empresa_id, array['admin', 'diretor']) || coalesce((select array_agg(id) from auth.users where lower(email) = lower(p.criado_por)), '{}');
    perform _notificar_u(p.empresa_id, quem, ti, tit, p.nome || coalesce(' · ' || left(det, 140), ''), '#/preimpressao/artes?abrir=' || p.id, p.id, false);
  elsif tg_table_name = 'fidc_propostas' then
    if new.status = 'Pendente' and (tg_op = 'INSERT' or old.status is distinct from 'Pendente') then
      perform _notificar_u(new.empresa_id, _usuarios_papel(new.empresa_id, array['admin', 'diretor']), 'bordero_pendente', 'Borderô nº ' || new.numero || ' aguardando aprovação',
        'R$ ' || translate(to_char(new.valor_face, 'FM999,999,999,990.00'), ',.', '.,') || ' · ' || new.qtd_titulos || ' título(s)', '#/fidc-propostas?abrir=' || new.id, new.id, false);
    elsif tg_op = 'UPDATE' and old.status = 'Pendente' and new.status in ('Aprovada', 'Rejeitada') then
      perform _notificar_u(new.empresa_id, array[new.criado_por], 'bordero_decidido', 'Borderô nº ' || new.numero || ' ' || lower(new.status),
        coalesce(new.motivo, ''), '#/fidc-propostas?abrir=' || new.id, new.id, false);
    end if;
  elsif tg_table_name = 'man_ordens' then
    if (new.prioridade = 'emergencia' or new.maquina_parou) and (tg_op = 'INSERT' or not (old.prioridade = 'emergencia' or old.maquina_parou)) and new.situacao not in ('concluida', 'cancelada') then
      select codigo || ' — ' || nome into eq from man_equipamentos where id = new.equipamento_id;
      perform _notificar_u(new.empresa_id, _usuarios_papel(new.empresa_id, array['admin', 'diretor', 'producao']), 'os_urgente',
        case when new.maquina_parou then 'MÁQUINA PARADA · ' else 'EMERGÊNCIA · ' end || 'OS ' || new.numero || ' — ' || coalesce(eq, ''), left(new.descricao, 160),
        '#/manutencao/ordens?abrir=' || new.id, new.id, true);
    end if;
  end if;
  return null;
end $$;
revoke all on function public._avisos_novos() from public, anon, authenticated;
drop trigger if exists portal_prorrogacoes_aviso on public.portal_prorrogacoes;
create trigger portal_prorrogacoes_aviso after insert on public.portal_prorrogacoes for each row execute function public._avisos_novos();
do $$ begin
  if to_regclass('public.pre_decisoes') is not null then
    drop trigger if exists pre_decisoes_aviso on public.pre_decisoes;
    create trigger pre_decisoes_aviso after insert on public.pre_decisoes for each row execute function public._avisos_novos();
    drop trigger if exists pre_versoes_aviso on public.pre_versoes;
    create trigger pre_versoes_aviso after insert on public.pre_versoes for each row execute function public._avisos_novos();
    drop trigger if exists pre_comentarios_aviso on public.pre_comentarios;
    create trigger pre_comentarios_aviso after insert on public.pre_comentarios for each row execute function public._avisos_novos();
  end if;
  if to_regclass('public.man_ordens') is not null then
    drop trigger if exists man_ordens_aviso on public.man_ordens;
    create trigger man_ordens_aviso after insert or update of prioridade, maquina_parou on public.man_ordens for each row execute function public._avisos_novos();
  end if;
end $$;
drop trigger if exists fidc_propostas_aviso on public.fidc_propostas;
create trigger fidc_propostas_aviso after insert or update of status on public.fidc_propostas for each row execute function public._avisos_novos();

-- 5) envio automático a cada minuto (se o projeto tiver pg_cron e pg_net). A chave fica no Vault (nome: notificar_cron),
--    cadastrada à mão pelo administrador — nunca no repositório.
do $$
begin
  begin
    create extension if not exists pg_net;
    create extension if not exists pg_cron;
  exception when others then raise notice 'pg_cron/pg_net indisponíveis: o envio continua só pelo disparo depois de cada ação (%).', sqlerrm; return;
  end;
  perform cron.unschedule(jobid) from cron.job where jobname = 'avisos-notificar';
  perform cron.schedule('avisos-notificar', '* * * * *', $job$
    select net.http_post(
      url := 'https://ceyzvhcpgokysgmpdalt.supabase.co/functions/v1/notificar',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-chave', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'notificar_cron'), '')),
      body := '{}'::jsonb)
    where exists (select 1 from public.notificacoes where enviado_em is null and criado_em > now() - interval '4 days')
      and exists (select 1 from vault.decrypted_secrets where name = 'notificar_cron');
  $job$);
exception when others then raise notice 'agendamento não criado: %', sqlerrm;
end $$;

-- conferência: tipos = 9, tabelas = 3, gatilhos novos ≥ 2
select (select count(*) from public.notif_tipos) as tipos,
       (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('notif_tipos', 'notif_preferencias', 'notif_horarios')) as tabelas,
       (select count(*) from pg_trigger where tgname like '%\_aviso') as gatilhos,
       (select count(*) from pg_extension where extname = 'pg_cron') as cron;
