-- Agenda única (Painéis › Agenda, PAI012). Pedido do Renan em 12/11/2026.
-- Compromissos próprios (reunião, ligação, visita, tarefa, lembrete) com hora, repetição, responsável e participantes;
-- exceções por ocorrência (feito, cancelado, movido) para os que se repetem; parâmetros da agenda por empresa.
-- Os demais itens da agenda (títulos, cheques, contatos, tarefas do fechamento, contratos, frota, SST, manutenção, cargas,
-- licenças, qualidade, artes, férias) são lidos das tabelas de origem pela tela, com a permissão de quem está olhando.
-- Aditivo: só cria objetos novos.

create table if not exists public.agenda_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  fontes_desligadas text[] not null default '{}',          -- fontes que a empresa não quer ver na agenda
  semana_inicio int not null default 0 check (semana_inicio in (0, 1)),   -- 0 = domingo, 1 = segunda
  fim_de_semana boolean not null default true,
  saldo_dia boolean not null default true,                 -- mostra o saldo projetado em cada dia
  saldo_papeis text[] not null default '{admin,diretor,financeiro}',
  saldo_cheques boolean not null default true,             -- cheques entram no saldo projetado pela data "bom para"
  vencidos_em_hoje boolean not null default true,          -- títulos vencidos em aberto contam no saldo de hoje
  visao_padrao text not null default 'mes' check (visao_padrao in ('mes', 'semana', 'lista')),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);

create table if not exists public.agenda_compromissos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  titulo text not null check (length(trim(titulo)) > 0),
  descricao text,
  local text,
  tipo text not null default 'reuniao' check (tipo in ('reuniao', 'ligacao', 'visita', 'tarefa', 'lembrete', 'outro')),
  data date not null,
  hora time,                                               -- nula = dia inteiro
  hora_fim time,
  repetir text not null default 'nao' check (repetir in ('nao', 'diaria', 'semanal', 'mensal', 'anual')),
  intervalo int not null default 1 check (intervalo between 1 and 52),
  dias_semana int[] not null default '{}',                 -- semanal: 0 = domingo … 6 = sábado (vazio = o dia da data)
  repetir_ate date,
  dono uuid not null default auth.uid(),
  responsavel uuid not null default auth.uid(),
  participantes uuid[] not null default '{}',
  privado boolean not null default false,
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  situacao text not null default 'aberto' check (situacao in ('aberto', 'feito', 'cancelado')),
  feito_em timestamptz,
  feito_por uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (hora_fim is null or hora is not null),
  check (repetir_ate is null or repetir_ate >= data)
);
create index if not exists agenda_comp_emp_data on public.agenda_compromissos(empresa_id, data);

create table if not exists public.agenda_excecoes (
  id uuid primary key default gen_random_uuid(),
  compromisso_id uuid not null references public.agenda_compromissos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  data date not null,                                      -- a ocorrência original
  acao text not null check (acao in ('feito', 'cancelado', 'movido')),
  nova_data date,
  nova_hora time,
  por uuid default auth.uid(),
  em timestamptz not null default now(),
  unique (compromisso_id, data),
  check (acao <> 'movido' or nova_data is not null)
);

-- quem pode mexer num compromisso: dono, responsável, participante ou administrador
create or replace function public._agenda_pode(p_empresa uuid, p_dono uuid, p_resp uuid, p_part uuid[])
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_participante(p_empresa) and (auth.uid() in (p_dono, p_resp) or auth.uid() = any(coalesce(p_part, '{}')) or public.is_admin(p_empresa));
$$;

alter table public.agenda_config enable row level security;
alter table public.agenda_compromissos enable row level security;
alter table public.agenda_excecoes enable row level security;
do $$
declare t text;
begin
  foreach t in array array['agenda_config', 'agenda_compromissos', 'agenda_excecoes'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;

create policy agenda_config_sel on public.agenda_config for select to authenticated using (public.is_participante(empresa_id));
create policy agenda_config_ins on public.agenda_config for insert to authenticated with check (public.is_admin(empresa_id) or public.is_diretor(empresa_id));
create policy agenda_config_upd on public.agenda_config for update to authenticated using (public.is_admin(empresa_id) or public.is_diretor(empresa_id)) with check (public.is_admin(empresa_id) or public.is_diretor(empresa_id));

-- compromisso privado só aparece para quem participa; os demais, para toda a equipe da empresa
create policy agenda_compromissos_sel on public.agenda_compromissos for select to authenticated
  using (public.is_participante(empresa_id) and (not privado or auth.uid() in (dono, responsavel) or auth.uid() = any(participantes)));
create policy agenda_compromissos_ins on public.agenda_compromissos for insert to authenticated
  with check (public.is_participante(empresa_id) and dono = auth.uid());
create policy agenda_compromissos_upd on public.agenda_compromissos for update to authenticated
  using (public._agenda_pode(empresa_id, dono, responsavel, participantes)) with check (public.is_participante(empresa_id));
create policy agenda_compromissos_del on public.agenda_compromissos for delete to authenticated
  using (auth.uid() = dono or public.is_admin(empresa_id));

-- as exceções seguem o compromisso; a gravação é pela função agenda_ocorrencia
create policy agenda_excecoes_sel on public.agenda_excecoes for select to authenticated
  using (exists (select 1 from public.agenda_compromissos c where c.id = compromisso_id));

-- responsável e participantes precisam ser da empresa; quem não é o dono não troca o dono; carimba a alteração
create or replace function public.tg_agenda_compromisso() returns trigger language plpgsql security definer set search_path = public as $$
declare v_fora int; v_novos uuid[]; v_quem text;
begin
  new.titulo := trim(new.titulo);
  new.participantes := coalesce((select array_agg(distinct x) from unnest(new.participantes) x where x is not null and x <> new.responsavel), '{}');
  select count(*) into v_fora from unnest(array[new.responsavel] || new.participantes) u
   where not exists (select 1 from public.membros m where m.empresa_id = new.empresa_id and m.user_id = u);
  if v_fora > 0 then raise exception 'Responsável e participantes precisam ser usuários desta empresa'; end if;
  if tg_op = 'UPDATE' then
    if new.empresa_id <> old.empresa_id then raise exception 'O compromisso não muda de empresa'; end if;
    if new.dono <> old.dono and auth.uid() is not null and not public.is_admin(new.empresa_id) then new.dono := old.dono; end if;
    new.atualizado_em := now();
    if new.situacao = 'feito' and old.situacao <> 'feito' then new.feito_em := now(); new.feito_por := auth.uid(); end if;
    if new.situacao <> 'feito' then new.feito_em := null; new.feito_por := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists agenda_compromisso_biu on public.agenda_compromissos;
create trigger agenda_compromisso_biu before insert or update on public.agenda_compromissos for each row execute function public.tg_agenda_compromisso();

-- avisa quem passou a ser responsável ou participante (menos quem está gravando)
insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('agenda', 'Painéis', 'Agenda: compromisso para você', 'Quando alguém marca um compromisso com você ou passa um compromisso para você.', false, 12)
on conflict (codigo) do nothing;

create or replace function public.tg_agenda_avisar() returns trigger language plpgsql security definer set search_path = public as $$
declare v_novos uuid[]; v_quem text; v_ant uuid[] := '{}';
begin
  if new.situacao <> 'aberto' then return new; end if;
  if tg_op = 'UPDATE' then v_ant := array[old.responsavel] || old.participantes; end if;
  select array_agg(u) into v_novos from unnest(array[new.responsavel] || new.participantes) u
   where u <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) and not (u = any(v_ant));
  if v_novos is null then return new; end if;
  select coalesce(nullif(trim(nome), ''), 'Alguém da equipe') into v_quem from public.membros where empresa_id = new.empresa_id and user_id = auth.uid();
  perform public._notificar(new.empresa_id, v_novos, 'agenda',
    case when tg_op = 'UPDATE' and new.responsavel <> old.responsavel then 'Compromisso passado para você: ' else 'Novo compromisso: ' end || new.titulo,
    coalesce(v_quem, 'Alguém da equipe') || ' · ' || to_char(new.data, 'DD/MM/YYYY') || coalesce(' às ' || to_char(new.hora, 'HH24:MI'), '') || coalesce(' · ' || nullif(trim(new.local), ''), ''),
    'agenda?abrir=' || new.id, new.id);
  return new;
exception when others then return new;   -- o aviso nunca impede a gravação
end $$;
drop trigger if exists agenda_compromisso_avisar on public.agenda_compromissos;
create trigger agenda_compromisso_avisar after insert or update of responsavel, participantes on public.agenda_compromissos for each row execute function public.tg_agenda_avisar();

-- resolve uma ocorrência: feito, cancelado, movido (adiar) ou reaberto.
-- Compromisso sem repetição: altera o próprio compromisso. Com repetição: grava a exceção só daquela data.
create or replace function public.agenda_ocorrencia(p_id uuid, p_data date, p_acao text, p_nova_data date default null, p_nova_hora time default null)
returns void language plpgsql security definer set search_path = public as $$
declare c public.agenda_compromissos;
begin
  select * into c from public.agenda_compromissos where id = p_id;
  if c.id is null then raise exception 'Compromisso não encontrado'; end if;
  if not public._agenda_pode(c.empresa_id, c.dono, c.responsavel, c.participantes) then raise exception 'Só quem participa do compromisso pode alterá-lo'; end if;
  if p_acao not in ('feito', 'cancelado', 'movido', 'reaberto') then raise exception 'Ação inválida'; end if;
  if p_acao = 'movido' and p_nova_data is null then raise exception 'Informe a nova data'; end if;
  if c.repetir = 'nao' then
    update public.agenda_compromissos set
      situacao = case p_acao when 'feito' then 'feito' when 'cancelado' then 'cancelado' else 'aberto' end,
      data = case when p_acao = 'movido' then p_nova_data else data end,
      hora = case when p_acao = 'movido' and p_nova_hora is not null then p_nova_hora else hora end,
      hora_fim = case when p_acao = 'movido' and p_nova_hora is not null and hora is not null and hora_fim is not null then p_nova_hora + (hora_fim - hora) else hora_fim end
    where id = p_id;
    return;
  end if;
  if p_data is null then raise exception 'Informe a data da ocorrência'; end if;
  if p_acao = 'reaberto' then
    delete from public.agenda_excecoes where compromisso_id = p_id and data = p_data;
    return;
  end if;
  insert into public.agenda_excecoes(compromisso_id, empresa_id, data, acao, nova_data, nova_hora)
  values (p_id, c.empresa_id, p_data, p_acao, case when p_acao = 'movido' then p_nova_data end, case when p_acao = 'movido' then p_nova_hora end)
  on conflict (compromisso_id, data) do update set acao = excluded.acao, nova_data = excluded.nova_data, nova_hora = excluded.nova_hora, por = auth.uid(), em = now();
end $$;

-- encerra a repetição a partir de uma data (apagar "esta e as próximas")
create or replace function public.agenda_encerrar_repeticao(p_id uuid, p_a_partir date)
returns void language plpgsql security definer set search_path = public as $$
declare c public.agenda_compromissos;
begin
  select * into c from public.agenda_compromissos where id = p_id;
  if c.id is null then raise exception 'Compromisso não encontrado'; end if;
  if not (auth.uid() in (c.dono, c.responsavel) or public.is_admin(c.empresa_id)) then raise exception 'Só o dono ou o responsável encerra a repetição'; end if;
  if p_a_partir <= c.data then
    update public.agenda_compromissos set situacao = 'cancelado' where id = p_id;
  else
    update public.agenda_compromissos set repetir_ate = p_a_partir - 1 where id = p_id;
    delete from public.agenda_excecoes where compromisso_id = p_id and data >= p_a_partir;
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['_agenda_pode(uuid,uuid,uuid,uuid[])', 'agenda_ocorrencia(uuid,date,text,date,time)', 'agenda_encerrar_repeticao(uuid,date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  revoke all on function public.tg_agenda_compromisso() from public, anon, authenticated;
  revoke all on function public.tg_agenda_avisar() from public, anon, authenticated;
end $$;
