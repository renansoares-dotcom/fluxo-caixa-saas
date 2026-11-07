-- =====================================================================
-- Melhoria contínua 3.7 — Prestação de contas dos Pagamentos Antecipados (07/11/2026)
-- PA pago aguardando a nota fiscal ganha PRAZO (padrão: data do pagamento + N dias, ou a previsão informada no pedido, ou
-- um prazo prorrogado com motivo). A plataforma cobra sozinha quem pediu (lembrete antes do prazo, cobrança a cada N dias
-- depois de vencido e escalada para o financeiro/diretor), com o histórico das cobranças. Saldo pendente por pessoa.
-- Tudo configurável em Pagamentos Antecipados › Parâmetros. Migração ADITIVA.
-- =====================================================================

create table if not exists public.pa_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  prazo_nota_dias int not null default 15 check (prazo_nota_dias between 1 and 180),   -- prazo padrão depois do pagamento
  lembrete_antes_dias int not null default 2 check (lembrete_antes_dias between 0 and 30),
  cobrar_cada_dias int not null default 3 check (cobrar_cada_dias between 1 and 30),    -- repete a cobrança enquanto estiver vencido
  escalar_apos_dias int not null default 10 check (escalar_apos_dias between 1 and 180), -- dias de atraso para avisar o financeiro/diretor
  escalar_papeis text[] not null default array['financeiro', 'diretor'],
  cobrar_ativo boolean not null default true,
  atualizado_por text default (auth.jwt() ->> 'email'), atualizado_em timestamptz not null default now()
);
alter table public.pa_config enable row level security;
drop policy if exists pa_config_sel on public.pa_config; drop policy if exists pa_config_ins on public.pa_config; drop policy if exists pa_config_upd on public.pa_config;
create policy pa_config_sel on public.pa_config for select to authenticated using (public.is_membro(empresa_id));
create policy pa_config_ins on public.pa_config for insert to authenticated with check (public.pode_editar(empresa_id));
create policy pa_config_upd on public.pa_config for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
grant select, insert, update on public.pa_config to authenticated;

alter table public.paraquedas add column if not exists prazo_nota date;            -- prazo prorrogado (nulo = o padrão)
alter table public.paraquedas add column if not exists prazo_motivo text;
alter table public.paraquedas add column if not exists prazo_alterado_por text;

create table if not exists public.pa_cobrancas (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  paraquedas_id uuid not null references public.paraquedas(id) on delete cascade,
  tipo text not null check (tipo in ('lembrete', 'cobranca', 'escalada', 'manual', 'prorrogacao')),
  dias_atraso int,
  mensagem text,
  enviado_por text default coalesce(auth.jwt() ->> 'email', 'automático'),
  enviado_em timestamptz not null default now()
);
create index if not exists pa_cobrancas_pa on public.pa_cobrancas(paraquedas_id, enviado_em desc);
alter table public.pa_cobrancas enable row level security;
drop policy if exists pa_cobrancas_sel on public.pa_cobrancas;
create policy pa_cobrancas_sel on public.pa_cobrancas for select to authenticated using (public.is_membro(empresa_id));
grant select on public.pa_cobrancas to authenticated;   -- gravação só pelas funções

-- tipo de aviso (preferências em Meus avisos)
insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('pa_prestacao', 'Pagamentos', 'Prestação de contas do PA', 'Lembrete do prazo da nota fiscal do pagamento antecipado, cobrança do atraso e escalada.', false, 11)
on conflict (codigo) do update set grupo = excluded.grupo, nome = excluded.nome, descricao = excluded.descricao, ordem = excluded.ordem;

-- situação de cada PA pago aguardando nota: data do pagamento, prazo, dias (negativo = atrasado), responsável e cobranças
create or replace function public._pa_situacao(p_empresa uuid)
returns table(id uuid, numero int, razao_social text, valor numeric, criado_por uuid, responsavel text, data_pago date, prazo date, origem_prazo text,
              dias_restantes int, cobrancas bigint, ultima_cobranca timestamptz, ultimo_tipo text, escalado boolean)
language sql stable security definer set search_path = public as $$
  with cfg as (select coalesce((select prazo_nota_dias from pa_config where empresa_id = p_empresa), 15) dias),
  pg as (
    select p.id, greatest(
      (select max(l.data) from paraquedas_pagamentos x join lancamentos l on l.id = x.lancamento_id where x.paraquedas_id = p.id and l.status = 'Pago'),
      (select l.data from lancamentos l where l.id = p.lancamento_id and l.status = 'Pago')) data_pago
      from paraquedas p where p.empresa_id = p_empresa and p.status = 'pago' and p.tera_nota
  )
  select p.id, p.numero, p.razao_social, p.valor, p.criado_por,
         coalesce(nullif(trim(p.solicitante), ''), u.raw_user_meta_data ->> 'nome', split_part(u.email, '@', 1), '—'),
         coalesce(pg.data_pago, p.data_pagamento),
         coalesce(p.prazo_nota, p.previsao_nota, coalesce(pg.data_pago, p.data_pagamento) + (select dias from cfg)),
         case when p.prazo_nota is not null then 'prorrogado' when p.previsao_nota is not null then 'previsao' else 'padrao' end,
         coalesce(p.prazo_nota, p.previsao_nota, coalesce(pg.data_pago, p.data_pagamento) + (select dias from cfg)) - current_date,
         (select count(*) from pa_cobrancas c where c.paraquedas_id = p.id and c.tipo <> 'prorrogacao'),
         (select max(enviado_em) from pa_cobrancas c where c.paraquedas_id = p.id and c.tipo <> 'prorrogacao'),
         (select c.tipo from pa_cobrancas c where c.paraquedas_id = p.id and c.tipo <> 'prorrogacao' order by c.enviado_em desc limit 1),
         -- escalada vale até o prazo ser prorrogado
         exists (select 1 from pa_cobrancas c where c.paraquedas_id = p.id and c.tipo = 'escalada'
                  and c.enviado_em > coalesce((select max(r.enviado_em) from pa_cobrancas r where r.paraquedas_id = p.id and r.tipo = 'prorrogacao'), '-infinity'::timestamptz))
    from paraquedas p join pg on pg.id = p.id left join auth.users u on u.id = p.criado_por;
$$;
revoke all on function public._pa_situacao(uuid) from public, anon, authenticated;

-- para a tela (respeita quem pode ver os PAs: compras só vê os seus)
create or replace function public.pa_prestacao(p_empresa uuid)
returns table(id uuid, numero int, razao_social text, valor numeric, criado_por uuid, responsavel text, data_pago date, prazo date, origem_prazo text,
              dias_restantes int, cobrancas bigint, ultima_cobranca timestamptz, ultimo_tipo text, escalado boolean)
language sql stable security definer set search_path = public as $$
  select s.* from _pa_situacao(p_empresa) s
   where is_participante(p_empresa) and (s.criado_por = auth.uid() or is_membro(p_empresa));
$$;
revoke all on function public.pa_prestacao(uuid) from public, anon;
grant execute on function public.pa_prestacao(uuid) to authenticated;

/** cobrança automática (agendamento diário) ou de uma empresa; devolve quantos avisos saíram */
create or replace function public._pa_cobrar(p_empresa uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare e uuid; c pa_config; s record; n int := 0; v_tipo text; v_tit text; v_corpo text; v_dest uuid[];
begin
  for e in select distinct p.empresa_id from paraquedas p where p.status = 'pago' and p.tera_nota and (p_empresa is null or p.empresa_id = p_empresa) loop
    select * into c from pa_config where empresa_id = e;
    if c.empresa_id is null then c := row(e, 15, 2, 3, 10, array['financeiro', 'diretor'], true, null, now())::pa_config; end if;
    continue when not c.cobrar_ativo;
    for s in select * from _pa_situacao(e) loop
      v_tipo := null;
      if s.dias_restantes >= 0 and s.dias_restantes <= c.lembrete_antes_dias
         and not exists (select 1 from pa_cobrancas x where x.paraquedas_id = s.id and x.tipo = 'lembrete' and x.enviado_em::date >= s.prazo - c.lembrete_antes_dias - 1) then
        v_tipo := 'lembrete';
      elsif s.dias_restantes < 0 and (s.ultima_cobranca is null or s.ultima_cobranca::date <= current_date - c.cobrar_cada_dias or s.ultimo_tipo = 'lembrete') then
        v_tipo := 'cobranca';
      end if;
      if v_tipo is not null then
        v_tit := case when v_tipo = 'lembrete' then 'Nota fiscal do PA nº ' || s.numero || ' vence ' || case when s.dias_restantes = 0 then 'hoje' else 'em ' || s.dias_restantes || ' dia(s)' end
                      else 'Nota fiscal do PA nº ' || s.numero || ' atrasada há ' || -s.dias_restantes || ' dia(s)' end;
        v_corpo := s.razao_social || ' · ' || to_char(s.valor, 'FM999G999G990D00') || ' pago em ' || to_char(s.data_pago, 'DD/MM') || '. Prazo da nota: ' || to_char(s.prazo, 'DD/MM/YYYY') || '. Peça a nota ao fornecedor e envie ao financeiro.';
        perform _notificar_u(e, array[s.criado_por], 'pa_prestacao', v_tit, v_corpo, '#/paraquedas', s.id, false);
        insert into pa_cobrancas(empresa_id, paraquedas_id, tipo, dias_atraso, mensagem, enviado_por) values (e, s.id, v_tipo, greatest(-s.dias_restantes, 0), v_tit, 'automático');
        n := n + 1;
      end if;
      -- escalada: atraso grande e ainda não escalado (desde a última prorrogação)
      if s.dias_restantes < 0 and -s.dias_restantes >= c.escalar_apos_dias and not s.escalado then
        v_dest := _usuarios_papel(e, c.escalar_papeis);
        v_tit := 'PA nº ' || s.numero || ' sem nota fiscal há ' || -s.dias_restantes || ' dia(s) do prazo';
        perform _notificar_u(e, v_dest, 'pa_prestacao', v_tit, s.razao_social || ' · ' || to_char(s.valor, 'FM999G999G990D00') || ' · responsável: ' || s.responsavel || '. Já foram ' || s.cobrancas || ' cobrança(s).', '#/paraquedas', s.id, false);
        insert into pa_cobrancas(empresa_id, paraquedas_id, tipo, dias_atraso, mensagem, enviado_por) values (e, s.id, 'escalada', -s.dias_restantes, v_tit, 'automático');
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public._pa_cobrar(uuid) from public, anon, authenticated;

/** "Cobrar agora": aviso imediato para quem pediu (e, se marcado, para os papéis da escalada) */
create or replace function public.pa_cobrar_agora(p_id uuid, p_mensagem text default null, p_escalar boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare p paraquedas; s record; c pa_config; v_tit text;
begin
  select * into p from paraquedas where id = p_id;
  if p.id is null or not pode_editar(p.empresa_id) then raise exception 'Sem permissão.'; end if;
  select * into s from _pa_situacao(p.empresa_id) x where x.id = p.id;
  if s.id is null then raise exception 'Este PA não está aguardando nota fiscal.'; end if;
  select * into c from pa_config where empresa_id = p.empresa_id;
  v_tit := 'Cobrança: nota fiscal do PA nº ' || s.numero || case when s.dias_restantes < 0 then ' (atrasada há ' || -s.dias_restantes || ' dia(s))' else ' (prazo ' || to_char(s.prazo, 'DD/MM') || ')' end;
  perform _notificar_u(p.empresa_id, array[s.criado_por] || case when p_escalar then _usuarios_papel(p.empresa_id, coalesce(c.escalar_papeis, array['financeiro', 'diretor'])) else '{}'::uuid[] end,
    'pa_prestacao', v_tit, coalesce(nullif(trim(p_mensagem), ''), s.razao_social || ' · ' || to_char(s.valor, 'FM999G999G990D00') || '. Envie a nota fiscal ao financeiro.'), '#/paraquedas', p.id, false);
  insert into pa_cobrancas(empresa_id, paraquedas_id, tipo, dias_atraso, mensagem) values (p.empresa_id, p.id, case when p_escalar then 'escalada' else 'manual' end, greatest(-s.dias_restantes, 0), coalesce(nullif(trim(p_mensagem), ''), v_tit));
end $$;
revoke all on function public.pa_cobrar_agora(uuid, text, boolean) from public, anon;
grant execute on function public.pa_cobrar_agora(uuid, text, boolean) to authenticated;

/** prorrogar o prazo da nota (com motivo; fica no histórico e zera a escalada) */
create or replace function public.pa_prorrogar(p_id uuid, p_prazo date, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare p paraquedas;
begin
  select * into p from paraquedas where id = p_id for update;
  if p.id is null or not pode_editar(p.empresa_id) then raise exception 'Sem permissão.'; end if;
  if p.status <> 'pago' or not p.tera_nota then raise exception 'Só o PA pago aguardando nota tem prazo.'; end if;
  if p_prazo is null or p_prazo < current_date then raise exception 'O novo prazo tem de ser de hoje em diante.'; end if;
  if nullif(trim(coalesce(p_motivo, '')), '') is null then raise exception 'Informe o motivo da prorrogação.'; end if;
  update paraquedas set prazo_nota = p_prazo, prazo_motivo = trim(p_motivo), prazo_alterado_por = auth.jwt() ->> 'email' where id = p.id;
  insert into pa_cobrancas(empresa_id, paraquedas_id, tipo, mensagem) values (p.empresa_id, p.id, 'prorrogacao', 'Prazo até ' || to_char(p_prazo, 'DD/MM/YYYY') || ': ' || trim(p_motivo));
end $$;
revoke all on function public.pa_prorrogar(uuid, date, text) from public, anon;
grant execute on function public.pa_prorrogar(uuid, date, text) to authenticated;

/** rodar a cobrança automática agora (para a empresa) */
create or replace function public.pa_cobrar_rodar(p_empresa uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not pode_editar(p_empresa) then raise exception 'Sem permissão.'; end if;
  return _pa_cobrar(p_empresa);
end $$;
revoke all on function public.pa_cobrar_rodar(uuid) from public, anon;
grant execute on function public.pa_cobrar_rodar(uuid) to authenticated;

-- agendamento diário (8h23 de Brasília), se o projeto tiver pg_cron
do $$
begin
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron indisponível: a cobrança roda pelo botão da tela (%).', sqlerrm; return; end;
  perform cron.unschedule(jobid) from cron.job where jobname = 'pa-cobrar';
  perform cron.schedule('pa-cobrar', '23 11 * * *', $job$ select public._pa_cobrar(null); $job$);
exception when others then raise notice 'agendamento não criado: %', sqlerrm;
end $$;

-- conferência: tabelas = 2, funções = 6
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('pa_config', 'pa_cobrancas')) as tabelas,
       (select count(*) from pg_proc where proname in ('_pa_situacao', 'pa_prestacao', '_pa_cobrar', 'pa_cobrar_agora', 'pa_prorrogar', 'pa_cobrar_rodar')) as funcoes;
