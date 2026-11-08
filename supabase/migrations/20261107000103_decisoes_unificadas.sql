-- =====================================================================
-- Melhoria contínua 2.3 — Central de Decisões (07/11/2026)
-- Decisão do Dia e Decision Center viram uma tela só (abas). Cada alerta pode ser RESOLVIDO (some até o conteúdo mudar),
-- ADIADO (some até a data) ou DELEGADO (a pessoa recebe o aviso e o alerta mostra o responsável). Tudo fica no histórico.
-- Saúde da empresa 0–100 por área, calculada pelos alertas abertos e pelos indicadores do Painel da Diretoria, com uma
-- foto por dia para a tendência. Pesos e faixas configuráveis. Migração ADITIVA (requer SQL 101 para os indicadores).
-- =====================================================================

create table if not exists public.decisoes_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  pesos jsonb not null default '{"alta": 20, "media": 8, "baixa": 3, "fora_meta": 15, "atencao": 5}',
  faixa_boa int not null default 80 check (faixa_boa between 1 and 100),
  faixa_atencao int not null default 60 check (faixa_atencao between 0 and 99),
  adiar_dias int not null default 7 check (adiar_dias between 1 and 90),
  pesos_areas jsonb not null default '{}',          -- peso de cada área no índice geral (padrão 1)
  atualizado_por text default (auth.jwt() ->> 'email'), atualizado_em timestamptz not null default now(),
  check (faixa_atencao < faixa_boa)
);
create table if not exists public.decisoes_tratativas (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  chave text not null,                               -- identificador do alerta (regra)
  origem text, titulo text,
  situacao text not null check (situacao in ('resolvido', 'adiado', 'delegado', 'reaberto')),
  ate date,                                          -- adiado até
  delegado_para uuid,
  nota text,
  assinatura text,                                   -- conteúdo do alerta quando foi resolvido (mudou = volta)
  por uuid default auth.uid(), por_email text default (auth.jwt() ->> 'email'),
  criado_em timestamptz not null default now()
);
create index if not exists decisoes_trat_emp on public.decisoes_tratativas(empresa_id, chave, criado_em desc);
create table if not exists public.saude_historico (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  dia date not null default current_date,
  geral int not null check (geral between 0 and 100),
  areas jsonb not null default '{}',
  alertas int not null default 0,
  primary key (empresa_id, dia)
);

create or replace function public._dec_pode(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'diretor', 'financeiro'));
$$;

alter table public.decisoes_config enable row level security;
alter table public.decisoes_tratativas enable row level security;
alter table public.saude_historico enable row level security;
do $$ declare t text; begin
  foreach t in array array['decisoes_config', 'decisoes_tratativas', 'saude_historico'] loop
    execute format('drop policy if exists %1$s_sel on public.%1$s; drop policy if exists %1$s_ins on public.%1$s; drop policy if exists %1$s_upd on public.%1$s', t);
    execute format('create policy %1$s_sel on public.%1$s for select to authenticated using (public.is_membro(empresa_id))', t);
  end loop;
end $$;
create policy decisoes_config_ins on public.decisoes_config for insert to authenticated with check (public._dir_pode(empresa_id, array['admin', 'diretor']));
create policy decisoes_config_upd on public.decisoes_config for update to authenticated using (public._dir_pode(empresa_id, array['admin', 'diretor'])) with check (public._dir_pode(empresa_id, array['admin', 'diretor']));
-- a foto do dia é gravada por quem abre a tela (o último cálculo do dia vale)
create policy saude_historico_ins on public.saude_historico for insert to authenticated with check (public._dec_pode(empresa_id));
create policy saude_historico_upd on public.saude_historico for update to authenticated using (public._dec_pode(empresa_id)) with check (public._dec_pode(empresa_id));
grant select, insert, update on public.decisoes_config, public.saude_historico to authenticated;
grant select on public.decisoes_tratativas to authenticated;

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('decisao', 'Painéis', 'Alerta delegado a você', 'Um alerta da Central de Decisões foi delegado a você.', false, 41)
on conflict (codigo) do nothing;

/** registra o que foi feito com um alerta */
create or replace function public.decisoes_tratar(p_empresa uuid, p_chave text, p_origem text, p_titulo text, p_situacao text,
  p_ate date default null, p_delegado uuid default null, p_nota text default null, p_assinatura text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; quem text;
begin
  if not _dec_pode(p_empresa) then raise exception 'Só administrador, diretor e financeiro tratam os alertas.'; end if;
  if p_situacao not in ('resolvido', 'adiado', 'delegado', 'reaberto') then raise exception 'Situação inválida.'; end if;
  if p_situacao = 'adiado' and (p_ate is null or p_ate <= current_date) then raise exception 'Informe até quando adiar (data futura).'; end if;
  if p_situacao = 'delegado' then
    if p_delegado is null or not exists (select 1 from membros where empresa_id = p_empresa and user_id = p_delegado) then raise exception 'Escolha uma pessoa da empresa.'; end if;
  end if;
  if p_situacao = 'resolvido' and length(trim(coalesce(p_nota, ''))) < 3 then raise exception 'Diga o que foi feito para resolver.'; end if;
  insert into decisoes_tratativas(empresa_id, chave, origem, titulo, situacao, ate, delegado_para, nota, assinatura)
    values (p_empresa, left(p_chave, 200), left(p_origem, 80), left(p_titulo, 300), p_situacao, case when p_situacao = 'adiado' then p_ate end,
            case when p_situacao = 'delegado' then p_delegado end, nullif(trim(p_nota), ''), left(p_assinatura, 2000))
    returning id into v_id;
  if p_situacao = 'delegado' then
    quem := coalesce((select nullif(trim(nome), '') from membros where empresa_id = p_empresa and user_id = auth.uid()), split_part(auth.jwt() ->> 'email', '@', 1), 'Alguém');
    perform _notificar_u(p_empresa, array[p_delegado], 'decisao', 'Alerta delegado a você: ' || left(p_titulo, 120),
      quem || ' delegou a você' || coalesce(' — ' || nullif(trim(p_nota), ''), '') || '.', '#/decisoes?aba=alertas&minhas=1', null, false);
  end if;
  return v_id;
end $$;
revoke all on function public.decisoes_tratar(uuid, text, text, text, text, date, uuid, text, text) from public, anon;
grant execute on function public.decisoes_tratar(uuid, text, text, text, text, date, uuid, text, text) to authenticated;

/** situação atual de cada alerta (último registro por chave) e o histórico recente */
create or replace function public.decisoes_situacao(p_empresa uuid, p_dias int default 90) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_membro(p_empresa) then raise exception 'Sem acesso.'; end if;
  return jsonb_build_object(
    'atual', coalesce((select jsonb_object_agg(chave, to_jsonb(x) - 'chave') from (
        select distinct on (t.chave) t.chave, t.situacao, t.ate, t.delegado_para, t.nota, t.assinatura, t.por_email, t.criado_em,
               (select coalesce(nullif(trim(m.nome), ''), split_part(u.email::text, '@', 1)) from membros m join auth.users u on u.id = m.user_id where m.empresa_id = p_empresa and m.user_id = t.delegado_para) delegado_nome
          from decisoes_tratativas t where t.empresa_id = p_empresa order by t.chave, t.criado_em desc) x), '{}'),
    'historico', coalesce((select jsonb_agg(to_jsonb(h) order by h.criado_em desc) from (
        select t.id, t.chave, t.origem, t.titulo, t.situacao, t.ate, t.nota, t.por_email, t.criado_em,
               (select coalesce(nullif(trim(m.nome), ''), split_part(u.email::text, '@', 1)) from membros m join auth.users u on u.id = m.user_id where m.empresa_id = p_empresa and m.user_id = t.delegado_para) delegado_nome
          from decisoes_tratativas t where t.empresa_id = p_empresa and t.criado_em > now() - make_interval(days => greatest(p_dias, 1)) order by t.criado_em desc limit 300) h), '[]'),
    'pessoas', coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'nome', coalesce(nullif(trim(m.nome), ''), split_part(u.email::text, '@', 1)), 'papel', m.papel) order by m.nome)
        from membros m join auth.users u on u.id = m.user_id where m.empresa_id = p_empresa and m.papel::text in ('admin', 'diretor', 'financeiro', 'leitura')), '[]'));
end $$;
revoke all on function public.decisoes_situacao(uuid, int) from public, anon;
grant execute on function public.decisoes_situacao(uuid, int) to authenticated;

-- conferência: tabelas = 3, funções = 2
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('decisoes_config', 'decisoes_tratativas', 'saude_historico')) as tabelas,
       (select count(*) from pg_proc where proname in ('decisoes_tratar', 'decisoes_situacao')) as funcoes;
