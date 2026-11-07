-- =====================================================================
-- Melhoria contínua 10.3 — Auditoria por registro e alertas de ações sensíveis (07/11/2026)
--  • auditoria_registros: busca os registros pelo que foi gravado (nº, nome, valor, descrição…) em qualquer tabela auditada,
--    com quantas mudanças, quem mexeu e quando; a tela monta a linha do tempo e compara duas versões.
--  • alertas de ações sensíveis, configuráveis (Auditoria › Alertas › Parâmetros): exclusões, dados bancários de
--    beneficiário, papel/áreas de usuário, valor de lançamento pago, trava de conta, dados da conta bancária e
--    (opcional) mudanças fora do horário. Avisam administrador e diretor (configurável) pelo sino/celular/e-mail.
-- Migração ADITIVA: não altera a auditoria já gravada (os alertas valem daqui em diante).
-- =====================================================================

create table if not exists public.audit_alertas_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  regras jsonb not null default '{"exclusao": true, "banco_beneficiario": true, "papel_usuario": true, "valor_pago": true, "trava_conta": true, "conta_bancaria": true, "fora_horario": false}'::jsonb,
  tabelas_exclusao text[] not null default array['lancamentos', 'favorecidos', 'contas', 'plano_contas', 'paraquedas', 'fidc_propostas', 'contratos', 'conciliacoes', 'membros'],
  papeis text[] not null default array['admin', 'diretor'],
  horario_ini int not null default 7 check (horario_ini between 0 and 23),
  horario_fim int not null default 20 check (horario_fim between 1 and 24),
  ignorar_sistema boolean not null default true,                 -- rotinas e importações sem usuário não geram alerta
  atualizado_por text default (auth.jwt() ->> 'email'), atualizado_em timestamptz not null default now()
);
create table if not exists public.audit_alertas (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  auditoria_id bigint references public.auditoria(id) on delete cascade,
  regra text not null,
  titulo text not null,
  detalhe text,
  user_email text,
  criado_em timestamptz not null default now(),
  visto_por text, visto_em timestamptz
);
create index if not exists audit_alertas_emp on public.audit_alertas(empresa_id, criado_em desc);
create index if not exists audit_alertas_nao_vistos on public.audit_alertas(empresa_id) where visto_em is null;

-- quem vê a auditoria (administrador e diretor) vê e configura os alertas
create or replace function public._ve_auditoria(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from membros m where m.empresa_id = p_empresa and m.user_id = auth.uid() and m.papel::text in ('admin', 'diretor'));
$$;
alter table public.audit_alertas_config enable row level security;
alter table public.audit_alertas enable row level security;
drop policy if exists aac_sel on public.audit_alertas_config; drop policy if exists aac_ins on public.audit_alertas_config; drop policy if exists aac_upd on public.audit_alertas_config;
drop policy if exists aal_sel on public.audit_alertas;
create policy aac_sel on public.audit_alertas_config for select to authenticated using (public._ve_auditoria(empresa_id));
create policy aac_ins on public.audit_alertas_config for insert to authenticated with check (public._ve_auditoria(empresa_id));
create policy aac_upd on public.audit_alertas_config for update to authenticated using (public._ve_auditoria(empresa_id)) with check (public._ve_auditoria(empresa_id));
create policy aal_sel on public.audit_alertas for select to authenticated using (public._ve_auditoria(empresa_id));
grant select, insert, update on public.audit_alertas_config to authenticated;
grant select on public.audit_alertas to authenticated;

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('auditoria', 'Sistema', 'Ações sensíveis (auditoria)', 'Exclusões, dados bancários de beneficiário, papel de usuário, valor de lançamento pago e travas de conta alterados.', false, 90)
on conflict (codigo) do update set grupo = excluded.grupo, nome = excluded.nome, descricao = excluded.descricao, ordem = excluded.ordem;

-- nome legível do registro (só quando a regra já pegou: evita consulta a cada linha da auditoria)
create or replace function public._audit_nome(p_tabela text, p_reg text, p_antes jsonb, p_depois jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare v text := coalesce(p_antes ->> 'nome', p_depois ->> 'nome', p_antes ->> 'descricao', p_depois ->> 'descricao', p_antes ->> 'razao_social', p_depois ->> 'razao_social',
                           'nº ' || coalesce(p_antes ->> 'numero', p_depois ->> 'numero'));
begin
  if v is null and p_reg ~ '^[0-9a-f-]{36}$' then
    v := case p_tabela when 'favorecidos' then (select nome from favorecidos where id = p_reg::uuid)
                       when 'contas' then (select nome from contas where id = p_reg::uuid)
                       when 'lancamentos' then (select descricao from lancamentos where id = p_reg::uuid) end;
  end if;
  return coalesce(v, '');
end $$;
revoke all on function public._audit_nome(text, text, jsonb, jsonb) from public, anon, authenticated;

-- avalia cada linha nova da auditoria contra as regras da empresa
create or replace function public._auditoria_alertar() returns trigger
language plpgsql security definer set search_path = public as $$
declare c audit_alertas_config; rg jsonb; v_regra text; v_tit text; v_det text; h int; dow int; v_nome text;
        nome_tab text := case new.tabela when 'lancamentos' then 'lançamento' when 'favorecidos' then 'beneficiário' when 'contas' then 'conta bancária'
          when 'plano_contas' then 'plano de contas' when 'paraquedas' then 'pagamento antecipado' when 'fidc_propostas' then 'proposta de borderô'
          when 'contratos' then 'contrato' when 'conciliacoes' then 'conciliação' when 'membros' then 'usuário' when 'contas_travas' then 'trava de conta' else new.tabela end;
begin
  select * into c from audit_alertas_config where empresa_id = new.empresa_id;
  if c.empresa_id is null then
    c := row(new.empresa_id, '{"exclusao": true, "banco_beneficiario": true, "papel_usuario": true, "valor_pago": true, "trava_conta": true, "conta_bancaria": true, "fora_horario": false}'::jsonb,
             array['lancamentos', 'favorecidos', 'contas', 'plano_contas', 'paraquedas', 'fidc_propostas', 'contratos', 'conciliacoes', 'membros'],
             array['admin', 'diretor'], 7, 20, true, null, now())::audit_alertas_config;
  end if;
  if c.ignorar_sistema and new.user_id is null then return null; end if;
  rg := c.regras;
  v_regra := null;
  if coalesce((rg ->> 'banco_beneficiario')::boolean, false) and new.tabela = 'favorecidos' and new.acao = 'alterou'
     and new.campos && array['dados_bancarios', 'pix', 'forma_pagamento', 'documento'] then
    v_regra := 'banco_beneficiario'; v_tit := 'Dados bancários do beneficiário alterados';
    v_nome := _audit_nome(new.tabela, new.registro_id, new.antes, new.depois);
    v_det := v_nome || ': ' || array_to_string(array(select case x when 'dados_bancarios' then 'dados bancários' when 'pix' then 'Pix' when 'forma_pagamento' then 'forma de pagamento' else 'CNPJ/CPF' end
                                                     from unnest(new.campos) x where x = any(array['dados_bancarios', 'pix', 'forma_pagamento', 'documento'])), ', ');
  elsif coalesce((rg ->> 'papel_usuario')::boolean, false) and new.tabela = 'membros' and (new.acao <> 'alterou' or new.campos && array['papel', 'areas']) then
    v_regra := 'papel_usuario'; v_tit := case new.acao when 'incluiu' then 'Usuário incluído na empresa' when 'excluiu' then 'Usuário removido da empresa' else 'Papel ou áreas de usuário alterados' end;
    v_det := coalesce(new.antes ->> 'papel', '') || case when new.acao = 'alterou' then ' → ' else '' end || coalesce(new.depois ->> 'papel', '');
  elsif coalesce((rg ->> 'valor_pago')::boolean, false) and new.tabela = 'lancamentos' and new.acao = 'alterou' and 'valor' = any(new.campos)
     and coalesce(new.depois ->> 'status', (select status from lancamentos where id = new.registro_id::uuid)) = 'Pago' then
    v_regra := 'valor_pago'; v_tit := 'Valor de lançamento pago alterado';
    v_det := _audit_nome(new.tabela, new.registro_id, null, null) || ': ' || (new.antes ->> 'valor') || ' → ' || (new.depois ->> 'valor');
  elsif coalesce((rg ->> 'trava_conta')::boolean, false) and new.tabela = 'contas_travas' and new.acao in ('alterou', 'excluiu') then
    v_regra := 'trava_conta'; v_tit := case new.acao when 'excluiu' then 'Trava de conta removida' else 'Trava de conta alterada' end;
    v_det := coalesce((select nome from contas where id = coalesce(new.antes ->> 'conta_id', new.depois ->> 'conta_id')::uuid), '') || ' · até ' || coalesce(new.antes ->> 'ate', '') || case when new.acao = 'alterou' then ' → ' || coalesce(new.depois ->> 'ate', '') else '' end;
  elsif coalesce((rg ->> 'conta_bancaria')::boolean, false) and new.tabela = 'contas' and new.acao = 'alterou'
     and new.campos && array['numero', 'agencia', 'banco', 'instituicao', 'ofx_banco', 'ofx_conta', 'saldo_inicial'] then
    v_regra := 'conta_bancaria'; v_tit := 'Dados da conta bancária alterados';
    v_det := _audit_nome(new.tabela, new.registro_id, new.antes, new.depois) || ': ' || array_to_string(new.campos, ', ');
  elsif coalesce((rg ->> 'exclusao')::boolean, false) and new.acao = 'excluiu' and new.tabela = any(c.tabelas_exclusao) then
    v_regra := 'exclusao'; v_tit := 'Exclusão de ' || nome_tab;
    v_det := trim(both ' ·' from concat_ws(' · ', nullif(_audit_nome(new.tabela, new.registro_id, new.antes, new.depois), ''), case when new.antes ? 'valor' then 'valor ' || (new.antes ->> 'valor') end, case when new.antes ? 'data' then 'data ' || (new.antes ->> 'data') end));
  end if;
  -- fora do horário (só se nenhuma outra regra pegou): mudança feita à noite ou no fim de semana
  if v_regra is null and coalesce((rg ->> 'fora_horario')::boolean, false) and new.user_id is not null and new.tabela in ('lancamentos', 'favorecidos', 'contas', 'paraquedas', 'membros') then
    h := extract(hour from new.criado_em at time zone 'America/Sao_Paulo'); dow := extract(isodow from new.criado_em at time zone 'America/Sao_Paulo');
    if h < c.horario_ini or h >= c.horario_fim or dow in (6, 7) then
      v_regra := 'fora_horario'; v_tit := initcap(new.acao) || ' ' || nome_tab || ' fora do horário'; v_det := nullif(_audit_nome(new.tabela, new.registro_id, new.antes, new.depois), '');
    end if;
  end if;
  if v_regra is null then return null; end if;
  insert into audit_alertas(empresa_id, auditoria_id, regra, titulo, detalhe, user_email) values (new.empresa_id, new.id, v_regra, v_tit, left(v_det, 400), new.user_email);
  perform _notificar_u(new.empresa_id, _usuarios_papel(new.empresa_id, c.papeis), 'auditoria', v_tit,
    concat_ws(' · ', nullif(left(v_det, 200), ''), 'por ' || coalesce(new.user_email, 'sistema')), '#/auditoria', null, false);
  return null;
end $$;
revoke all on function public._auditoria_alertar() from public, anon, authenticated;
drop trigger if exists auditoria_alertar on public.auditoria;
create trigger auditoria_alertar after insert on public.auditoria for each row execute function public._auditoria_alertar();

/** marcar alertas como vistos */
create or replace function public.audit_alertas_visto(p_ids bigint[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update audit_alertas set visto_em = now(), visto_por = auth.jwt() ->> 'email' where id = any(p_ids) and visto_em is null and _ve_auditoria(empresa_id);
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.audit_alertas_visto(bigint[]) from public, anon;
grant execute on function public.audit_alertas_visto(bigint[]) to authenticated;

/** busca os registros auditados pelo que foi gravado: devolve um por registro, com a última foto e quem mexeu */
create or replace function public.auditoria_registros(p_empresa uuid, p_tabela text, p_busca text, p_de date default null, p_ate date default null)
returns table(tabela text, registro_id text, eventos bigint, primeiro timestamptz, ultimo timestamptz, usuarios text, excluido boolean, foto jsonb)
language sql stable security definer set search_path = public as $$
  with a as (
    select x.* from auditoria x
     where x.empresa_id = p_empresa and _ve_auditoria(p_empresa)
       and (nullif(p_tabela, '') is null or x.tabela = p_tabela)
       and (p_de is null or x.criado_em >= p_de) and (p_ate is null or x.criado_em < p_ate + 1)
  ), hit as (
    select distinct a.tabela, a.registro_id from a
     where coalesce(trim(p_busca), '') <> ''
       and (a.registro_id = trim(p_busca) or coalesce(a.antes::text, '') ilike '%' || trim(p_busca) || '%' or coalesce(a.depois::text, '') ilike '%' || trim(p_busca) || '%')
     limit 200
  )
  select h.tabela, h.registro_id, count(*), min(a.criado_em), max(a.criado_em),
         string_agg(distinct coalesce(a.user_email, 'sistema'), ', '),
         bool_or(a.acao = 'excluiu'),
         (select coalesce(z.depois, z.antes) from auditoria z where z.tabela = h.tabela and z.registro_id = h.registro_id and z.empresa_id = p_empresa
           and (z.acao <> 'alterou') order by z.criado_em desc limit 1)
    from hit h join auditoria a on a.tabela = h.tabela and a.registro_id = h.registro_id and a.empresa_id = p_empresa
   group by h.tabela, h.registro_id
   order by max(a.criado_em) desc;
$$;
revoke all on function public.auditoria_registros(uuid, text, text, date, date) from public, anon;
grant execute on function public.auditoria_registros(uuid, text, text, date, date) to authenticated;

-- conferência: tabelas = 2, gatilho = 1
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('audit_alertas_config', 'audit_alertas')) as tabelas,
       (select count(*) from pg_trigger where tgname = 'auditoria_alertar') as gatilho;
