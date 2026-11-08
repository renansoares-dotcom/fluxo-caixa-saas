-- =====================================================================
-- Melhoria contínua 3.8 — Checklist do fechamento, trava do mês e "quanto falta para fechar" (08/11/2026)
-- 1) Modelo do checklist da empresa: tarefas com responsável (pessoa ou perfil) e prazo em dia útil (D+N = N-ésimo dia
--    útil do mês seguinte; D+0 = último dia útil do próprio mês). Tarefa pode ser ligada a uma conferência automática.
-- 2) Tarefas do mês geradas do modelo, marcadas como feitas / não se aplica, com lembrete antes do prazo e cobrança
--    das atrasadas (aviso diário).
-- 3) Trava do mês fechado: depois de fechado, os lançamentos PAGOS com data no mês não mudam data, valor, conta,
--    classificação nem situação, nem são incluídos ou excluídos. Reabrir exige motivo, avisa a equipe e fica no histórico.
-- Parâmetros configuráveis na tela. Migração ADITIVA (requer o SQL 101, pela função _dir_pode).
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_proc where proname = '_dir_pode') then
    raise exception 'Rode antes o SQL 101 (20261107000101_painel_diretoria.sql). Nada foi alterado.';
  end if;
end $$;

-- ---------- dias úteis (feriados bancários nacionais: fixos + carnaval, Sexta-feira Santa e Corpus Christi) ----------
create or replace function public._pascoa(p_ano int) returns date language plpgsql immutable as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; mes int; dia int;
begin
  a := p_ano % 19; b := p_ano / 100; c := p_ano % 100; d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  mes := (h + l - 7 * m + 114) / 31; dia := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(p_ano, mes, dia);
end $$;

create or replace function public._eh_dia_util(p date) returns boolean language sql immutable as $$
  select extract(isodow from p) < 6
     and to_char(p, 'MM-DD') not in ('01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25')
     and p not in (_pascoa(extract(year from p)::int) - 48, _pascoa(extract(year from p)::int) - 47, _pascoa(extract(year from p)::int) - 2, _pascoa(extract(year from p)::int) + 60);
$$;

/** prazo de D+N do mês 'YYYY-MM': N-ésimo dia útil do mês seguinte; D+0 = último dia útil do próprio mês */
create or replace function public._fech_prazo(p_mes text, p_n int) returns date language plpgsql immutable as $$
declare d date; k int := 0;
begin
  if p_n <= 0 then
    d := (to_date(p_mes || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date;
    while not _eh_dia_util(d) loop d := d - 1; end loop;
    return d;
  end if;
  d := (to_date(p_mes || '-01', 'YYYY-MM-DD') + interval '1 month')::date;
  loop
    if _eh_dia_util(d) then k := k + 1; if k >= p_n then return d; end if; end if;
    d := d + 1;
  end loop;
end $$;

-- quem administra o checklist (modelo, parâmetros, marcar qualquer tarefa): administrador, diretor e financeiro
create or replace function public._fech_gestor(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public._dir_pode(p_empresa, array['admin', 'diretor', 'financeiro']);
$$;
revoke all on function public._fech_gestor(uuid) from public, anon;
grant execute on function public._fech_gestor(uuid) to authenticated;

-- ---------- tabelas ----------
create table if not exists public.fechamento_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  meta_dia_util smallint not null default 5 check (meta_dia_util between 1 and 20),     -- fechar até D+N
  papeis_fechar text[] not null default array['admin', 'diretor'],                        -- quem fecha e reabre o mês
  exigir_checklist boolean not null default true,                                         -- pendência obrigatória exige justificativa
  lembrar boolean not null default true,
  lembrete_dias_antes smallint not null default 1 check (lembrete_dias_antes between 0 and 10),
  cobrar_atrasadas boolean not null default true,
  avisar_reabertura text[] not null default array['admin', 'diretor', 'financeiro'],
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);

create table if not exists public.fechamento_modelos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  titulo text not null check (length(trim(titulo)) between 1 and 120),
  descricao text,
  area text,
  dia_util smallint not null default 1 check (dia_util between 0 and 20),
  responsavel uuid references auth.users(id) on delete set null,
  papel text,                                                -- quando não há pessoa: perfil responsável
  etapa_auto text check (etapa_auto in ('ext', 'semconta', 'abertos', 'notas', 'bord', 'orc', 'contas')),
  link text,
  obrigatoria boolean not null default true,
  ordem smallint not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create index if not exists fechamento_modelos_emp on public.fechamento_modelos(empresa_id, ordem);

create table if not exists public.fechamento_tarefas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  mes text not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  modelo_id uuid references public.fechamento_modelos(id) on delete set null,
  titulo text not null,
  descricao text,
  area text,
  dia_util smallint not null,
  prazo date not null,
  responsavel uuid references auth.users(id) on delete set null,
  papel text,
  etapa_auto text,
  link text,
  obrigatoria boolean not null default true,
  ordem smallint not null default 0,
  situacao text not null default 'pendente' check (situacao in ('pendente', 'feita', 'nao_aplica')),
  feita_por uuid, feita_em timestamptz,
  observacao text,
  ultimo_aviso date,
  criado_em timestamptz not null default now()
);
create unique index if not exists fechamento_tarefas_modelo on public.fechamento_tarefas(empresa_id, mes, modelo_id) where modelo_id is not null;
create index if not exists fechamento_tarefas_mes on public.fechamento_tarefas(empresa_id, mes, ordem);

create table if not exists public.fechamento_meses (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  mes text not null check (mes ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  situacao text not null default 'fechado' check (situacao in ('fechado', 'reaberto')),
  fechado_por uuid, fechado_em timestamptz,
  justificativa text,                                   -- quando fecha com pendência
  reaberto_por uuid, reaberto_em timestamptz, motivo_reabertura text,
  primary key (empresa_id, mes)
);

create table if not exists public.fechamento_eventos (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  mes text not null,
  acao text not null check (acao in ('fechou', 'reabriu', 'tarefa')),
  detalhe text,
  pendencias jsonb,
  por uuid default auth.uid(),
  por_email text,
  em timestamptz not null default now()
);
create index if not exists fechamento_eventos_emp on public.fechamento_eventos(empresa_id, mes, em desc);

alter table public.fechamento_config enable row level security;
alter table public.fechamento_modelos enable row level security;
alter table public.fechamento_tarefas enable row level security;
alter table public.fechamento_meses enable row level security;
alter table public.fechamento_eventos enable row level security;
drop policy if exists fechamento_config_sel on public.fechamento_config;
drop policy if exists fechamento_config_ins on public.fechamento_config;
drop policy if exists fechamento_config_upd on public.fechamento_config;
drop policy if exists fechamento_modelos_sel on public.fechamento_modelos;
drop policy if exists fechamento_modelos_ins on public.fechamento_modelos;
drop policy if exists fechamento_modelos_upd on public.fechamento_modelos;
drop policy if exists fechamento_modelos_del on public.fechamento_modelos;
drop policy if exists fechamento_tarefas_sel on public.fechamento_tarefas;
drop policy if exists fechamento_meses_sel on public.fechamento_meses;
drop policy if exists fechamento_eventos_sel on public.fechamento_eventos;
create policy fechamento_config_sel on public.fechamento_config for select to authenticated using (public.is_membro(empresa_id));
create policy fechamento_config_ins on public.fechamento_config for insert to authenticated with check (public._fech_gestor(empresa_id));
create policy fechamento_config_upd on public.fechamento_config for update to authenticated using (public._fech_gestor(empresa_id)) with check (public._fech_gestor(empresa_id));
create policy fechamento_modelos_sel on public.fechamento_modelos for select to authenticated using (public.is_membro(empresa_id));
create policy fechamento_modelos_ins on public.fechamento_modelos for insert to authenticated with check (public._fech_gestor(empresa_id));
create policy fechamento_modelos_upd on public.fechamento_modelos for update to authenticated using (public._fech_gestor(empresa_id)) with check (public._fech_gestor(empresa_id));
create policy fechamento_modelos_del on public.fechamento_modelos for delete to authenticated using (public._fech_gestor(empresa_id));
create policy fechamento_tarefas_sel on public.fechamento_tarefas for select to authenticated using (public.is_membro(empresa_id));
create policy fechamento_meses_sel on public.fechamento_meses for select to authenticated using (public.is_membro(empresa_id));
create policy fechamento_eventos_sel on public.fechamento_eventos for select to authenticated using (public.is_membro(empresa_id));
grant select, insert, update on public.fechamento_config to authenticated;
grant select, insert, update, delete on public.fechamento_modelos to authenticated;
grant select on public.fechamento_tarefas, public.fechamento_meses, public.fechamento_eventos to authenticated;
-- as tarefas e o mês só mudam pelas funções abaixo (regras e histórico)

drop trigger if exists zz_auditoria on public.fechamento_modelos;
create trigger zz_auditoria after insert or update or delete on public.fechamento_modelos for each row execute function public._auditar();
drop trigger if exists zz_auditoria on public.fechamento_config;
create trigger zz_auditoria after insert or update or delete on public.fechamento_config for each row execute function public._auditar();

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('fechamento', 'Financeiro', 'Fechamento do mês', 'Tarefa do checklist perto do prazo ou atrasada, mês fechado ou reaberto.', false, 16)
on conflict (codigo) do nothing;

create or replace function public._fech_email() returns text language sql stable security definer set search_path = public as $$
  select email from auth.users where id = auth.uid();
$$;

-- ---------- modelo padrão ----------
create or replace function public.fechamento_modelo_padrao(p_empresa uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not _fech_gestor(p_empresa) then raise exception 'Só administrador, diretor ou financeiro monta o checklist.'; end if;
  if exists (select 1 from fechamento_modelos where empresa_id = p_empresa) then raise exception 'A empresa já tem um modelo de checklist.'; end if;
  insert into fechamento_modelos(empresa_id, ordem, titulo, descricao, area, dia_util, papel, etapa_auto, link) values
    (p_empresa, 1, 'Importar e conciliar os extratos bancários', 'Extratos até o último dia do mês, sem movimento pendente.', 'Financeiro', 1, 'financeiro', 'ext', '#/conciliacao'),
    (p_empresa, 2, 'Lançamentos pagos com conta bancária', 'Nenhum lançamento pago fora dos relatórios.', 'Financeiro', 1, 'financeiro', 'semconta', '#/lancamentos'),
    (p_empresa, 3, 'Baixar ou reprogramar os títulos vencidos', 'Nada em aberto vencido até o fim do mês.', 'Financeiro', 2, 'financeiro', 'abertos', '#/abertos'),
    (p_empresa, 4, 'Notas de venda ligadas ao financeiro', 'Toda nota de venda com recebimento, título ou borderô.', 'Faturamento', 2, 'financeiro', 'notas', '#/notas'),
    (p_empresa, 5, 'Decidir os borderôs FIDC do mês', 'Nenhuma proposta pendente com operação no mês.', 'Financeiro', 2, 'diretor', 'bord', '#/fidc-propostas'),
    (p_empresa, 6, 'Prestação de contas dos pagamentos antecipados', 'Notas dos PAs pagos no mês recebidas ou cobradas.', 'Financeiro', 3, 'financeiro', null, '#/paraquedas'),
    (p_empresa, 7, 'Justificar os desvios do orçamento', 'Contas fora da tolerância com justificativa.', 'Controladoria', 4, 'financeiro', 'orc', '#/controle-orcamento'),
    (p_empresa, 8, 'Fechar e travar as contas bancárias', 'Cada conta conciliada, batendo e travada até o fim do mês.', 'Financeiro', 4, 'admin', 'contas', '#/fechamento'),
    (p_empresa, 9, 'Revisar a DRE Gerencial e enviar à diretoria', 'Conferir as variações relevantes antes de enviar.', 'Controladoria', 5, 'financeiro', null, '#/dre'),
    (p_empresa, 10, 'Enviar os documentos à contabilidade', 'Extratos, notas e relatórios do mês para o escritório contábil.', 'Contabilidade', 5, 'financeiro', null, null);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- tarefas do mês ----------
/** cria as tarefas do mês a partir do modelo ativo (só as que faltam); qualquer pessoa da empresa pode chamar */
create or replace function public.fechamento_gerar(p_empresa uuid, p_mes text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_membro(p_empresa) then raise exception 'Sem acesso.'; end if;
  if p_mes !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Mês inválido.'; end if;
  insert into fechamento_tarefas(empresa_id, mes, modelo_id, titulo, descricao, area, dia_util, prazo, responsavel, papel, etapa_auto, link, obrigatoria, ordem)
  select m.empresa_id, p_mes, m.id, m.titulo, m.descricao, m.area, m.dia_util, _fech_prazo(p_mes, m.dia_util), m.responsavel, m.papel, m.etapa_auto, m.link, m.obrigatoria, m.ordem
    from fechamento_modelos m
   where m.empresa_id = p_empresa and m.ativo
     and not exists (select 1 from fechamento_tarefas t where t.empresa_id = p_empresa and t.mes = p_mes and t.modelo_id = m.id)
     and not exists (select 1 from fechamento_meses f where f.empresa_id = p_empresa and f.mes = p_mes and f.situacao = 'fechado')
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

/** marca a tarefa: feita / nao_aplica / pendente (desfazer). Pode o responsável (pessoa ou perfil) ou um gestor. */
create or replace function public.fechamento_marcar(p_tarefa uuid, p_situacao text, p_observacao text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t fechamento_tarefas; v_papel text;
begin
  select * into t from fechamento_tarefas where id = p_tarefa;
  if t.id is null or not is_membro(t.empresa_id) then raise exception 'Tarefa não encontrada.'; end if;
  if p_situacao not in ('pendente', 'feita', 'nao_aplica') then raise exception 'Situação inválida.'; end if;
  select papel::text into v_papel from membros where empresa_id = t.empresa_id and user_id = auth.uid();
  if not coalesce(_fech_gestor(t.empresa_id) or t.responsavel = auth.uid() or (t.responsavel is null and t.papel = v_papel), false) then
    raise exception 'Só o responsável pela tarefa ou um gestor do fechamento pode marcá-la.';
  end if;
  if exists (select 1 from fechamento_meses where empresa_id = t.empresa_id and mes = t.mes and situacao = 'fechado') then
    raise exception 'O mês % está fechado. Reabra o mês para mudar o checklist.', t.mes;
  end if;
  if p_situacao = 'nao_aplica' and coalesce(length(trim(p_observacao)), 0) < 5 then raise exception 'Diga por que a tarefa não se aplica neste mês.'; end if;
  update fechamento_tarefas set situacao = p_situacao,
         feita_por = case when p_situacao = 'pendente' then null else auth.uid() end,
         feita_em = case when p_situacao = 'pendente' then null else now() end,
         observacao = coalesce(nullif(trim(p_observacao), ''), case when p_situacao = 'pendente' then null else observacao end)
   where id = p_tarefa;
  insert into fechamento_eventos(empresa_id, mes, acao, detalhe, por_email)
  values (t.empresa_id, t.mes, 'tarefa', t.titulo || ': ' || case p_situacao when 'feita' then 'feita' when 'nao_aplica' then 'não se aplica' else 'voltou a pendente' end
          || coalesce(' (' || nullif(trim(p_observacao), '') || ')', ''), _fech_email());
end $$;

/** ajusta responsável e prazo de uma tarefa do mês (gestor) */
create or replace function public.fechamento_ajustar(p_tarefa uuid, p_responsavel uuid, p_papel text, p_dia_util int) returns void
language plpgsql security definer set search_path = public as $$
declare t fechamento_tarefas;
begin
  select * into t from fechamento_tarefas where id = p_tarefa;
  if t.id is null or not _fech_gestor(t.empresa_id) then raise exception 'Só um gestor do fechamento ajusta a tarefa.'; end if;
  if p_dia_util is null or p_dia_util not between 0 and 20 then raise exception 'O prazo vai de D+0 a D+20.'; end if;
  if p_responsavel is not null and not exists (select 1 from membros where empresa_id = t.empresa_id and user_id = p_responsavel) then raise exception 'A pessoa não é da empresa.'; end if;
  update fechamento_tarefas set responsavel = p_responsavel, papel = case when p_responsavel is null then p_papel else null end,
         dia_util = p_dia_util, prazo = _fech_prazo(t.mes, p_dia_util), ultimo_aviso = null where id = p_tarefa;
end $$;

-- ---------- trava do mês ----------
create or replace function public.fech_mes_fechado(p_empresa uuid, p_data date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from fechamento_meses where empresa_id = p_empresa and mes = to_char(p_data, 'YYYY-MM') and situacao = 'fechado');
$$;
grant execute on function public.fech_mes_fechado(uuid, date) to authenticated;

/** fecha o mês. p_pendencias: o que ainda está pendente (conferências automáticas e tarefas), mostrado na tela */
create or replace function public.fechamento_fechar(p_empresa uuid, p_mes text, p_pendencias jsonb default '[]'::jsonb, p_justificativa text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c fechamento_config; v_pend int; v_users uuid[];
begin
  select * into c from fechamento_config where empresa_id = p_empresa;
  if c.empresa_id is null then c.papeis_fechar := array['admin', 'diretor']; c.exigir_checklist := true; c.avisar_reabertura := array['admin', 'diretor', 'financeiro']; end if;
  if not _dir_pode(p_empresa, c.papeis_fechar) then raise exception 'Seu perfil não fecha o mês (veja os Parâmetros do fechamento).'; end if;
  if p_mes !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Mês inválido.'; end if;
  if p_mes >= to_char(current_date, 'YYYY-MM') then raise exception 'Só dá para fechar um mês que já terminou.'; end if;
  if exists (select 1 from fechamento_meses where empresa_id = p_empresa and mes = p_mes and situacao = 'fechado') then raise exception 'O mês já está fechado.'; end if;
  select count(*) into v_pend from fechamento_tarefas t
   where t.empresa_id = p_empresa and t.mes = p_mes and t.obrigatoria and t.situacao = 'pendente' and t.etapa_auto is null;
  v_pend := v_pend + coalesce(jsonb_array_length(case when jsonb_typeof(p_pendencias) = 'array' then p_pendencias end), 0);
  if c.exigir_checklist and v_pend > 0 and coalesce(length(trim(p_justificativa)), 0) < 15 then
    raise exception 'Há % pendência(s) no checklist. Para fechar mesmo assim, escreva a justificativa (pelo menos 15 letras).', v_pend;
  end if;
  insert into fechamento_meses(empresa_id, mes, situacao, fechado_por, fechado_em, justificativa)
  values (p_empresa, p_mes, 'fechado', auth.uid(), now(), nullif(trim(p_justificativa), ''))
  on conflict (empresa_id, mes) do update set situacao = 'fechado', fechado_por = auth.uid(), fechado_em = now(), justificativa = nullif(trim(p_justificativa), '');
  insert into fechamento_eventos(empresa_id, mes, acao, detalhe, pendencias, por_email)
  values (p_empresa, p_mes, 'fechou', case when v_pend > 0 then 'Fechado com ' || v_pend || ' pendência(s): ' || trim(p_justificativa) else 'Fechado com o checklist completo.' end, p_pendencias, _fech_email());
  v_users := _usuarios_papel(p_empresa, c.avisar_reabertura);
  perform _notificar_u(p_empresa, v_users, 'fechamento', 'Mês ' || to_char(to_date(p_mes || '-01', 'YYYY-MM-DD'), 'MM/YYYY') || ' fechado',
    'Os lançamentos pagos do mês estão travados.' || case when v_pend > 0 then ' Fechado com ' || v_pend || ' pendência(s).' else '' end, '#/fechamento?mes=' || p_mes, null, false);
end $$;

create or replace function public.fechamento_reabrir(p_empresa uuid, p_mes text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare c fechamento_config; v_users uuid[];
begin
  select * into c from fechamento_config where empresa_id = p_empresa;
  if c.empresa_id is null then c.papeis_fechar := array['admin', 'diretor']; c.avisar_reabertura := array['admin', 'diretor', 'financeiro']; end if;
  if not _dir_pode(p_empresa, c.papeis_fechar) then raise exception 'Seu perfil não reabre o mês (veja os Parâmetros do fechamento).'; end if;
  if not exists (select 1 from fechamento_meses where empresa_id = p_empresa and mes = p_mes and situacao = 'fechado') then raise exception 'O mês não está fechado.'; end if;
  if coalesce(length(trim(p_motivo)), 0) < 15 then raise exception 'Explique o motivo da reabertura (pelo menos 15 letras).'; end if;
  update fechamento_meses set situacao = 'reaberto', reaberto_por = auth.uid(), reaberto_em = now(), motivo_reabertura = trim(p_motivo)
   where empresa_id = p_empresa and mes = p_mes;
  insert into fechamento_eventos(empresa_id, mes, acao, detalhe, por_email) values (p_empresa, p_mes, 'reabriu', trim(p_motivo), _fech_email());
  v_users := _usuarios_papel(p_empresa, c.avisar_reabertura);
  perform _notificar_u(p_empresa, v_users, 'fechamento', 'Mês ' || to_char(to_date(p_mes || '-01', 'YYYY-MM-DD'), 'MM/YYYY') || ' reaberto',
    'Motivo: ' || left(trim(p_motivo), 200), '#/fechamento?mes=' || p_mes, null, true);
end $$;

revoke all on function public.fechamento_modelo_padrao(uuid), public.fechamento_gerar(uuid, text), public.fechamento_marcar(uuid, text, text),
  public.fechamento_ajustar(uuid, uuid, text, int), public.fechamento_fechar(uuid, text, jsonb, text), public.fechamento_reabrir(uuid, text, text) from public, anon;
grant execute on function public.fechamento_modelo_padrao(uuid), public.fechamento_gerar(uuid, text), public.fechamento_marcar(uuid, text, text),
  public.fechamento_ajustar(uuid, uuid, text, int), public.fechamento_fechar(uuid, text, jsonb, text), public.fechamento_reabrir(uuid, text, text) to authenticated;

-- lançamentos pagos de mês fechado
create or replace function public._fech_trava_lancamentos() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_old boolean := false; v_new boolean := false;
begin
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'Pago' then v_old := fech_mes_fechado(old.empresa_id, old.data); end if;
  if tg_op in ('INSERT', 'UPDATE') and new.status = 'Pago' then v_new := fech_mes_fechado(new.empresa_id, new.data); end if;
  if tg_op = 'DELETE' then
    if v_old then raise exception 'O mês % está fechado: não é possível excluir o lançamento pago de %. Peça a reabertura do mês.', to_char(old.data, 'MM/YYYY'), to_char(old.data, 'DD/MM/YYYY'); end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and v_old then
    if new.data is distinct from old.data or new.valor is distinct from old.valor or new.conta_id is distinct from old.conta_id
       or new.conta_destino_id is distinct from old.conta_destino_id or new.status is distinct from old.status or new.plano_id is distinct from old.plano_id then
      raise exception 'O mês % está fechado: data, valor, conta, classificação e situação dos lançamentos pagos não podem mudar (descrição, documento e centro de custo podem). Peça a reabertura do mês.', to_char(old.data, 'MM/YYYY');
    end if;
    return new;
  end if;
  if v_new then raise exception 'O mês % está fechado: não é possível lançar ou baixar com data de %. Peça a reabertura do mês.', to_char(new.data, 'MM/YYYY'), to_char(new.data, 'DD/MM/YYYY'); end if;
  return new;
end $$;
drop trigger if exists trava_mes_fechado on public.lancamentos;
create trigger trava_mes_fechado before insert or update or delete on public.lancamentos for each row execute function public._fech_trava_lancamentos();

-- ---------- lembretes e cobrança (diário) ----------
create or replace function public._fech_lembretes() returns int
language plpgsql security definer set search_path = public as $$
declare t record; v_users uuid[]; n int := 0;
begin
  for t in
    select ft.*, c.lembrete_dias_antes, c.lembrar, c.cobrar_atrasadas
      from fechamento_tarefas ft
      join fechamento_config c on c.empresa_id = ft.empresa_id
     where ft.situacao = 'pendente' and ft.etapa_auto is null
       and (ft.ultimo_aviso is null or ft.ultimo_aviso < current_date)
       and not exists (select 1 from fechamento_meses f where f.empresa_id = ft.empresa_id and f.mes = ft.mes and f.situacao = 'fechado')
       and ((c.lembrar and ft.prazo between current_date and current_date + c.lembrete_dias_antes)
            or (c.cobrar_atrasadas and ft.prazo < current_date and _eh_dia_util(current_date)))
  loop
    v_users := case when t.responsavel is not null then array[t.responsavel] else _usuarios_papel(t.empresa_id, array[coalesce(t.papel, 'financeiro')]) end;
    insert into notificacoes(empresa_id, user_id, tipo, titulo, corpo, link)
    select t.empresa_id, u, 'fechamento',
           case when t.prazo < current_date then 'Fechamento atrasado: ' else 'Fechamento: ' end || t.titulo,
           'Fechamento de ' || to_char(to_date(t.mes || '-01', 'YYYY-MM-DD'), 'MM/YYYY') || ' · prazo D+' || t.dia_util || ' (' || to_char(t.prazo, 'DD/MM') || ')' ||
           case when t.prazo < current_date then ', ' || (current_date - t.prazo) || ' dia(s) de atraso.' else '.' end,
           '#/fechamento?mes=' || t.mes
      from unnest(v_users) u;
    update fechamento_tarefas set ultimo_aviso = current_date where id = t.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public._fech_lembretes() from public, anon, authenticated;

do $$
begin
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron indisponível (%).', sqlerrm; return; end;
  perform cron.unschedule(jobid) from cron.job where jobname = 'fechamento-lembretes';
  perform cron.schedule('fechamento-lembretes', '13 11 * * *', $job$ select public._fech_lembretes(); $job$);   -- 08:13 em Brasília
exception when others then raise notice 'agendamento não criado: %', sqlerrm;
end $$;

-- conferência: tabelas = 5, prazo de D+1 de dez/2026 = 04/01/2027 (1º e 2/3 de jan: feriado e fim de semana)
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('fechamento_config', 'fechamento_modelos', 'fechamento_tarefas', 'fechamento_meses', 'fechamento_eventos')) as tabelas,
       public._fech_prazo('2026-12', 1) as d1_dez;
