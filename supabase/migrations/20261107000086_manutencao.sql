-- =====================================================================
-- Produção › Manutenção industrial (07/11/2026). Referência: ERP "Consultoria" (034–038, manutenção em 6 fases), refeita e
-- ligada ao resto da plataforma:
--  - equipamentos ligados à máquina da produção (prod_maquinas) e ao bem do imobilizado (af_bens), com criticidade A/B/C;
--  - planos preventivos por DATA e/ou por HORAS DE MÁQUINA RODANDO, contadas pelos apontamentos da produção (sem horímetro)
--    ou pelas leituras do horímetro, quando houver; geração automática das OS preventivas;
--  - ordens de serviço (OS) com solicitação, prioridade, checklist, horas dos técnicos, falha/causa/solução;
--  - a parada de manutenção registrada no terminal da produção abre a OS sozinha; a OS que para a máquina abre a parada
--    (a planta da fábrica e o OEE passam a mostrar a máquina parada) e a conclusão fecha a parada;
--  - peças consumidas saem do estoque oficial (movimento REQINT, custo médio, centro de custo do equipamento);
--  - custos (peças + horas + terceiros) e indicadores (MTBF, MTTR, disponibilidade, backlog, aderência) saem destas tabelas.
-- Só cria objetos novos. Não altera paradas, apontamentos nem movimentos que já existem.
-- =====================================================================

-- quem executa/solicita (inclui o perfil Produção, que já usa o terminal) e quem gerencia (planos, custos, parâmetros)
create or replace function public.pode_manutencao(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor', 'producao'));
$$;
revoke all on function public.pode_manutencao(uuid) from public, anon;
grant execute on function public.pode_manutencao(uuid) to authenticated;

-- sem acento e minúsculo (para achar "Manutenção corretiva" pelo nome do motivo)
create or replace function public.semacento_lower(t text) returns text language sql immutable as $$
  select lower(translate(coalesce(t, ''), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'));
$$;

-- 1) parâmetros
create table if not exists public.man_parametros (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  custo_hora numeric(12,2) not null default 0,          -- custo da hora do técnico interno (entra no custo da OS)
  tolerancia_pct numeric(6,2) not null default 10,      -- preventiva "no prazo" até X% além do intervalo
  antecedencia_dias int not null default 7,             -- gera a OS preventiva X dias antes de vencer
  horas_dia int not null default 24,                    -- horas do dia (disponibilidade)
  abrir_os_pela_parada boolean not null default true,   -- parada "manutenção" no terminal abre OS
  atualizado_em timestamptz not null default now()
);

-- 2) equipamentos
create table if not exists public.man_equipamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,
  nome text not null,
  tipo text not null default 'maquina' check (tipo in ('maquina', 'utilidade', 'predial', 'movimentacao', 'instrumento', 'ferramenta', 'outro')),
  maquina_id uuid unique references public.prod_maquinas(id) on delete set null,
  bem_id uuid references public.af_bens(id) on delete set null,
  setor_id uuid references public.prod_setores(id) on delete set null,
  centro_custo_id uuid references public.centros_custo(id) on delete set null,
  pai_id uuid references public.man_equipamentos(id) on delete set null,   -- componente de outro equipamento
  criticidade char(1) not null default 'B' check (criticidade in ('A', 'B', 'C')),
  local text, fabricante text, modelo text, serie text, ano int,
  garantia_ate date,
  horimetro numeric(14,1), horimetro_em date,
  situacao text not null default 'operando' check (situacao in ('operando', 'em_manutencao', 'parado', 'inativo')),
  observacao text,
  criado_em timestamptz not null default now(),
  unique (empresa_id, codigo)
);
create index if not exists man_equip_emp on public.man_equipamentos(empresa_id, situacao);

create table if not exists public.man_leituras (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  equipamento_id uuid not null references public.man_equipamentos(id) on delete cascade,
  data date not null default current_date,
  horimetro numeric(14,1) not null check (horimetro >= 0),
  usuario text default (auth.jwt() ->> 'email'), criado_em timestamptz not null default now()
);
create index if not exists man_leit_eq on public.man_leituras(equipamento_id, data);

-- 3) catálogo de falhas
create table if not exists public.man_falhas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null, nome text not null,
  categoria text not null default 'mecanica' check (categoria in ('mecanica', 'eletrica', 'eletronica', 'hidraulica', 'pneumatica', 'lubrificacao', 'operacional', 'instrumentacao', 'outra')),
  ativo boolean not null default true,
  unique (empresa_id, codigo)
);

-- 4) planos preventivos
create table if not exists public.man_planos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  equipamento_id uuid not null references public.man_equipamentos(id) on delete cascade,
  nome text not null,
  tipo text not null default 'preventiva' check (tipo in ('preventiva', 'lubrificacao', 'inspecao', 'preditiva', 'calibracao')),
  a_cada_dias int check (a_cada_dias > 0),
  a_cada_horas numeric(10,1) check (a_cada_horas > 0),
  checklist text[] not null default '{}',
  pecas jsonb not null default '[]'::jsonb,              -- [{produto_id, quantidade}] previstas
  duracao_h numeric(6,2),
  especialidade text,
  exige_parada boolean not null default true,
  ultima_data date, ultima_horas numeric(14,1),          -- última execução (data e horas de máquina na época)
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  check (a_cada_dias is not null or a_cada_horas is not null)
);
create index if not exists man_planos_eq on public.man_planos(equipamento_id);

-- 5) ordens de serviço
create table if not exists public.man_ordens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  equipamento_id uuid not null references public.man_equipamentos(id),
  tipo text not null default 'corretiva' check (tipo in ('corretiva', 'preventiva', 'lubrificacao', 'inspecao', 'preditiva', 'calibracao', 'melhoria')),
  origem text not null default 'solicitacao' check (origem in ('solicitacao', 'plano', 'parada', 'inspecao', 'manual')),
  plano_id uuid references public.man_planos(id) on delete set null,
  parada_id uuid references public.prod_paradas(id) on delete set null,
  prioridade text not null default 'media' check (prioridade in ('emergencia', 'alta', 'media', 'baixa')),
  situacao text not null default 'aberta' check (situacao in ('solicitada', 'aberta', 'programada', 'em_execucao', 'aguardando_peca', 'aguardando_terceiro', 'concluida', 'cancelada')),
  descricao text not null,
  solicitante text default (auth.jwt() ->> 'email'),
  solicitada_em timestamptz not null default now(),
  programada_para date,
  vence_em date,                                         -- preventiva: data limite pelo plano
  responsavel text,
  inicio timestamptz, fim timestamptz,
  maquina_parou boolean not null default false,
  parada_inicio timestamptz, parada_fim timestamptz,     -- tempo de máquina parada por esta OS
  falha_id uuid references public.man_falhas(id) on delete set null,
  causa text, solucao text,
  checklist jsonb not null default '[]'::jsonb,          -- [{item, ok, obs}]
  valor_terceiros numeric(14,2) not null default 0,
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  horas_maquina numeric(14,1),                           -- horas de máquina na conclusão (preventiva por horas)
  motivo_cancelamento text,
  concluida_por text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, numero),
  check (fim is null or inicio is null or fim >= inicio),
  check (parada_fim is null or parada_inicio is null or parada_fim >= parada_inicio)
);
create index if not exists man_os_emp on public.man_ordens(empresa_id, situacao);
create index if not exists man_os_eq on public.man_ordens(equipamento_id, solicitada_em);
create unique index if not exists man_os_plano_aberta on public.man_ordens(plano_id) where plano_id is not null and situacao not in ('concluida', 'cancelada');

create table if not exists public.man_os_horas (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem_id uuid not null references public.man_ordens(id) on delete cascade,
  tecnico text not null, data date not null default current_date,
  horas numeric(6,2) not null check (horas > 0 and horas <= 24),
  custo_hora numeric(12,2), descricao text,
  criado_em timestamptz not null default now()
);
create index if not exists man_os_horas_os on public.man_os_horas(ordem_id);

create table if not exists public.man_os_pecas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem_id uuid not null references public.man_ordens(id) on delete cascade,
  produto_id uuid not null references public.produtos(id),
  quantidade numeric(16,4) not null check (quantidade > 0),
  local_id uuid references public.est_locais(id),
  movimento_id uuid references public.est_movimentos(id) on delete set null,
  custo numeric(16,2),                                   -- valor da saída no estoque (custo médio)
  situacao text not null default 'consumida' check (situacao in ('consumida', 'estornada')),
  usuario text default (auth.jwt() ->> 'email'), criado_em timestamptz not null default now()
);
create index if not exists man_os_pecas_os on public.man_os_pecas(ordem_id);

create table if not exists public.man_anexos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem_id uuid references public.man_ordens(id) on delete cascade,
  equipamento_id uuid references public.man_equipamentos(id) on delete cascade,
  caminho text not null, nome text not null,
  tipo text not null default 'foto' check (tipo in ('foto', 'manual', 'laudo', 'nota', 'documento')),
  criado_por text default (auth.jwt() ->> 'email'), criado_em timestamptz not null default now(),
  check (ordem_id is not null or equipamento_id is not null)
);

-- 6) acesso: lê quem vê a produção; equipamentos, planos, falhas e parâmetros: quem gerencia (pode_pcp);
--    OS, horas, leituras e anexos: quem executa (pode_manutencao). Peças só pela função (mexe no estoque).
do $$ declare t text; begin
  foreach t in array array['man_parametros', 'man_equipamentos', 'man_leituras', 'man_falhas', 'man_planos', 'man_ordens', 'man_os_horas', 'man_os_pecas', 'man_anexos'] loop
    execute format('alter table public.%s enable row level security', t);
    execute format('drop policy if exists %1$s_sel on public.%1$s; drop policy if exists %1$s_ins on public.%1$s; drop policy if exists %1$s_upd on public.%1$s; drop policy if exists %1$s_del on public.%1$s;', t);
    execute format('create policy %1$s_sel on public.%1$s for select to authenticated using (public.ve_producao(empresa_id))', t);
  end loop;
  foreach t in array array['man_parametros', 'man_equipamentos', 'man_falhas', 'man_planos'] loop
    execute format('create policy %1$s_ins on public.%1$s for insert to authenticated with check (public.pode_pcp(empresa_id))', t);
    execute format('create policy %1$s_upd on public.%1$s for update to authenticated using (public.pode_pcp(empresa_id)) with check (public.pode_pcp(empresa_id))', t);
    execute format('create policy %1$s_del on public.%1$s for delete to authenticated using (public.pode_pcp(empresa_id))', t);
    execute format('grant select, insert, update, delete on public.%s to authenticated', t);
  end loop;
  foreach t in array array['man_leituras', 'man_ordens', 'man_os_horas', 'man_anexos'] loop
    execute format('create policy %1$s_ins on public.%1$s for insert to authenticated with check (public.pode_manutencao(empresa_id))', t);
    execute format('create policy %1$s_upd on public.%1$s for update to authenticated using (public.pode_manutencao(empresa_id)) with check (public.pode_manutencao(empresa_id))', t);
    execute format('grant select, insert, update on public.%s to authenticated', t);
  end loop;
  -- apagar OS, horas e anexos: só quem gerencia
  foreach t in array array['man_ordens', 'man_os_horas', 'man_anexos', 'man_leituras'] loop
    execute format('create policy %1$s_del on public.%1$s for delete to authenticated using (public.pode_pcp(empresa_id))', t);
    execute format('grant delete on public.%s to authenticated', t);
  end loop;
  execute 'grant select on public.man_os_pecas to authenticated';
end $$;
grant usage, select on sequence public.man_leituras_id_seq, public.man_os_horas_id_seq to authenticated;

-- 7) regras: mesma empresa, numeração da OS, horímetro e equipamento em manutenção
create or replace function public._man_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new);
begin
  if tg_table_name = 'man_equipamentos' then
    if new.maquina_id is not null and not exists (select 1 from prod_maquinas where id = new.maquina_id and empresa_id = new.empresa_id) then raise exception 'Máquina de outra empresa.'; end if;
    if new.bem_id is not null and not exists (select 1 from af_bens where id = new.bem_id and empresa_id = new.empresa_id) then raise exception 'Bem de outra empresa.'; end if;
    if new.pai_id is not null and (new.pai_id = new.id or not exists (select 1 from man_equipamentos where id = new.pai_id and empresa_id = new.empresa_id)) then raise exception 'Equipamento principal inválido.'; end if;
    new.codigo := upper(trim(new.codigo));
    return new;
  end if;
  if (j ->> 'equipamento_id') is not null and not exists (select 1 from man_equipamentos where id = (j ->> 'equipamento_id')::uuid and empresa_id = new.empresa_id) then
    raise exception 'Equipamento de outra empresa.'; end if;
  if tg_table_name = 'man_ordens' then
    if tg_op = 'INSERT' and (new.numero is null or new.numero <= 0) then
      perform pg_advisory_xact_lock(hashtext('man_os:' || new.empresa_id::text));
      select coalesce(max(numero), 0) + 1 into new.numero from man_ordens where empresa_id = new.empresa_id;
    end if;
    if tg_op = 'UPDATE' and old.situacao in ('concluida', 'cancelada') and new.situacao = old.situacao
       and (new.equipamento_id, new.tipo, new.parada_inicio, new.parada_fim, new.inicio, new.fim) is distinct from (old.equipamento_id, old.tipo, old.parada_inicio, old.parada_fim, old.inicio, old.fim)
       and not public.pode_pcp(new.empresa_id) then
      raise exception 'OS % encerrada: só quem gerencia a manutenção corrige datas e tipo.', old.numero; end if;
    if new.situacao = 'em_execucao' and new.inicio is null then new.inicio := now(); end if;
    if new.situacao = 'concluida' and (tg_op = 'INSERT' or old.situacao <> 'concluida') then
      new.fim := coalesce(new.fim, now()); new.inicio := coalesce(new.inicio, new.fim);
      if new.maquina_parou then new.parada_fim := coalesce(new.parada_fim, new.fim); end if;
      new.horas_maquina := coalesce(new.horas_maquina, man_horas_maquina(new.equipamento_id, new.fim));
      new.concluida_por := coalesce(new.concluida_por, auth.jwt() ->> 'email');
    end if;
    if new.maquina_parou and new.parada_inicio is null then new.parada_inicio := coalesce(new.inicio, now()); end if;
    new.atualizado_em := now();
  end if;
  if tg_table_name = 'man_os_horas' and not exists (select 1 from man_ordens where id = (j ->> 'ordem_id')::uuid and empresa_id = new.empresa_id and situacao not in ('concluida', 'cancelada')) then
    raise exception 'OS encerrada ou de outra empresa.'; end if;
  return new;
end $$;
drop trigger if exists man_equip_regras on public.man_equipamentos;
create trigger man_equip_regras before insert or update on public.man_equipamentos for each row execute function public._man_regras();
drop trigger if exists man_planos_regras on public.man_planos;
create trigger man_planos_regras before insert or update on public.man_planos for each row execute function public._man_regras();
drop trigger if exists man_leit_regras on public.man_leituras;
create trigger man_leit_regras before insert on public.man_leituras for each row execute function public._man_regras();
drop trigger if exists man_os_regras on public.man_ordens;
create trigger man_os_regras before insert or update on public.man_ordens for each row execute function public._man_regras();
drop trigger if exists man_os_horas_regras on public.man_os_horas;
create trigger man_os_horas_regras before insert or update on public.man_os_horas for each row execute function public._man_regras();

-- leitura do horímetro atualiza o equipamento (a maior leitura vale)
create or replace function public._man_leitura() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update man_equipamentos set horimetro = new.horimetro, horimetro_em = new.data
   where id = new.equipamento_id and (horimetro is null or horimetro <= new.horimetro);
  return null;
end $$;
drop trigger if exists man_leitura_eq on public.man_leituras;
create trigger man_leitura_eq after insert on public.man_leituras for each row execute function public._man_leitura();

-- 8) horas de máquina rodando: horímetro (quando há leitura) ou soma dos apontamentos da produção
create or replace function public.man_horas_maquina(p_equipamento uuid, p_ate timestamptz default now())
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(
    (select e.horimetro from man_equipamentos e where e.id = p_equipamento and e.horimetro is not null),
    (select round(sum(extract(epoch from (least(coalesce(a.fim, p_ate), p_ate) - a.inicio))) / 3600.0, 1)
       from prod_apontamentos a join man_equipamentos e on e.maquina_id = a.maquina_id
      where e.id = p_equipamento and a.inicio < p_ate),
    0);
$$;
revoke all on function public.man_horas_maquina(uuid, timestamptz) from public, anon;
grant execute on function public.man_horas_maquina(uuid, timestamptz) to authenticated;

-- 9) parada de manutenção no terminal → OS; OS que para a máquina → parada (planta e OEE); conclusão fecha a parada
create or replace function public._man_parada_abre_os() returns trigger
language plpgsql security definer set search_path = public as $$
declare e man_equipamentos; m text; v_os uuid;
begin
  if new.origem <> 'plataforma' or new.fim is not null then return null; end if;
  if current_setting('man.parada_da_os', true) = 'on' then return null; end if;   -- a própria OS criou esta parada
  select nome into m from prod_motivos where id = new.motivo_id;
  if m is null or semacento_lower(m) not like '%manuten%' then return null; end if;
  if not coalesce((select abrir_os_pela_parada from man_parametros where empresa_id = new.empresa_id), true) then return null; end if;
  select * into e from man_equipamentos where maquina_id = new.maquina_id;
  if e.id is null then return null; end if;
  if exists (select 1 from man_ordens where equipamento_id = e.id and tipo = 'corretiva' and situacao not in ('concluida', 'cancelada') and maquina_parou) then return null; end if;
  insert into man_ordens(empresa_id, equipamento_id, tipo, origem, parada_id, prioridade, situacao, descricao, solicitante, maquina_parou, parada_inicio)
  values (new.empresa_id, e.id, 'corretiva', 'parada', new.id, case when e.criticidade = 'A' then 'emergencia' else 'alta' end, 'solicitada',
          left('Parada no terminal: ' || m || coalesce(' — ' || nullif(new.observacao, ''), ''), 500), coalesce(auth.jwt() ->> 'email', 'terminal'), true, new.inicio)
  returning id into v_os;
  update man_equipamentos set situacao = 'parado' where id = e.id and situacao = 'operando';
  return null;
end $$;

create or replace function public._man_os_parada() returns trigger
language plpgsql security definer set search_path = public as $$
declare e man_equipamentos; v_mot uuid; v_par uuid;
begin
  select * into e from man_equipamentos where id = new.equipamento_id;
  -- abre a parada da produção quando a OS para a máquina (e ainda não tem parada)
  if new.maquina_parou and new.parada_id is null and new.situacao not in ('concluida', 'cancelada', 'solicitada') and e.maquina_id is not null then
    select id into v_mot from prod_motivos where empresa_id = new.empresa_id and tipo = 'parada' and ativo and semacento_lower(nome) like '%manuten%'
      order by (semacento_lower(nome) like '%' || case when new.tipo = 'corretiva' then 'corret' else 'prevent' end || '%') desc, nome limit 1;
    if not exists (select 1 from prod_paradas where maquina_id = e.maquina_id and fim is null) then
      perform set_config('man.parada_da_os', 'on', true);
      insert into prod_paradas(empresa_id, maquina_id, motivo_id, inicio, observacao, origem)
      values (new.empresa_id, e.maquina_id, v_mot, coalesce(new.parada_inicio, now()), 'OS ' || new.numero || ' — ' || left(new.descricao, 200), 'plataforma')
      returning id into v_par;
      perform set_config('man.parada_da_os', 'off', true);
      update man_ordens set parada_id = v_par where id = new.id;
    end if;
  end if;
  -- situação do equipamento
  if new.situacao in ('em_execucao', 'aguardando_peca', 'aguardando_terceiro') then
    update man_equipamentos set situacao = case when new.maquina_parou then 'em_manutencao' else situacao end where id = e.id and situacao <> 'inativo';
  end if;
  if tg_op = 'UPDATE' and new.situacao in ('concluida', 'cancelada') and old.situacao not in ('concluida', 'cancelada') then
    -- fecha a parada da produção e devolve o equipamento à operação (se não houver outra OS parando a máquina)
    if new.parada_id is not null then
      update prod_paradas set fim = coalesce(new.parada_fim, new.fim, now()) where id = new.parada_id and fim is null;
    end if;
    if not exists (select 1 from man_ordens o where o.equipamento_id = e.id and o.id <> new.id and o.maquina_parou and o.situacao not in ('concluida', 'cancelada')) then
      update man_equipamentos set situacao = 'operando' where id = e.id and situacao in ('em_manutencao', 'parado');
    end if;
    -- plano: última execução
    if new.situacao = 'concluida' and new.plano_id is not null then
      update man_planos set ultima_data = coalesce(new.fim, now())::date, ultima_horas = coalesce(new.horas_maquina, ultima_horas) where id = new.plano_id;
    end if;
  end if;
  return null;
end $$;



drop trigger if exists man_parada_abre_os on public.prod_paradas;
create trigger man_parada_abre_os after insert on public.prod_paradas for each row execute function public._man_parada_abre_os();
drop trigger if exists man_os_parada on public.man_ordens;
create trigger man_os_parada after insert or update on public.man_ordens for each row execute function public._man_os_parada();

-- 10) preventivas: gera as OS dos planos que vencem até a data (por dias e/ou horas); não duplica OS aberta do plano
create or replace function public.man_gerar_preventivas(p_empresa uuid, p_ate date default null)
returns int language plpgsql security definer set search_path = public as $$
declare pr man_parametros; p record; v_n int := 0; v_vence date; v_h numeric; v_lim date;
begin
  if not public.pode_manutencao(p_empresa) then raise exception 'Sem permissão.'; end if;
  select * into pr from man_parametros where empresa_id = p_empresa;
  v_lim := coalesce(p_ate, current_date + coalesce(pr.antecedencia_dias, 7));
  for p in select pl.*, e.situacao eq_sit, e.criticidade from man_planos pl join man_equipamentos e on e.id = pl.equipamento_id
            where pl.empresa_id = p_empresa and pl.ativo and e.situacao <> 'inativo'
              and not exists (select 1 from man_ordens o where o.plano_id = pl.id and o.situacao not in ('concluida', 'cancelada')) loop
    v_vence := null;
    if p.a_cada_dias is not null then v_vence := coalesce(p.ultima_data, current_date) + p.a_cada_dias; end if;
    if p.a_cada_horas is not null then
      v_h := man_horas_maquina(p.equipamento_id) - coalesce(p.ultima_horas, 0);
      if v_h >= p.a_cada_horas * 0.9 then v_vence := least(coalesce(v_vence, current_date), current_date); end if;   -- 90% das horas: já gera
    end if;
    if p.ultima_data is null and p.a_cada_dias is not null and p.a_cada_horas is null then v_vence := current_date; end if;   -- nunca executado: gera já
    continue when v_vence is null or v_vence > v_lim;
    insert into man_ordens(empresa_id, equipamento_id, tipo, origem, plano_id, prioridade, situacao, descricao, programada_para, vence_em, maquina_parou, checklist, solicitante)
    values (p_empresa, p.equipamento_id, p.tipo, 'plano', p.id, case when p.criticidade = 'A' then 'alta' else 'media' end, 'programada', p.nome,
            greatest(current_date, v_vence - 1), v_vence, p.exige_parada,
            coalesce((select jsonb_agg(jsonb_build_object('item', x, 'ok', null)) from unnest(p.checklist) x), '[]'::jsonb), 'plano preventivo');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.man_gerar_preventivas(uuid, date) from public, anon;
grant execute on function public.man_gerar_preventivas(uuid, date) to authenticated;

-- 11) peças: saída do estoque oficial (REQINT) e estorno
--     antes da implantação do estoque (est_config sem data), a peça fica registrada pelo último custo de compra, sem baixar saldo
create or replace function public.man_consumir_peca(p_ordem uuid, p_produto uuid, p_qtd numeric, p_local uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare o man_ordens; e man_equipamentos; pr produtos; t uuid; v_loc uuid; v_mov uuid; v_id uuid; v_val numeric; v_impl date;
begin
  select * into o from man_ordens where id = p_ordem;
  if o.id is null or not public.pode_manutencao(o.empresa_id) then raise exception 'Sem permissão.'; end if;
  if o.situacao in ('concluida', 'cancelada') then raise exception 'OS % encerrada.', o.numero; end if;
  if coalesce(p_qtd, 0) <= 0 then raise exception 'Quantidade inválida.'; end if;
  select * into pr from produtos where id = p_produto and empresa_id = o.empresa_id;
  if pr.id is null then raise exception 'Produto de outra empresa.'; end if;
  select * into e from man_equipamentos where id = o.equipamento_id;
  select implantado_em into v_impl from est_config where empresa_id = o.empresa_id;
  if v_impl is null then
    select p_qtd * pf.ultimo_preco into v_val from produto_fornecedores pf where pf.produto_id = pr.id and pf.ultimo_preco is not null order by pf.ultima_compra desc nulls last limit 1;
    insert into man_os_pecas(empresa_id, ordem_id, produto_id, quantidade, local_id, custo)
    values (o.empresa_id, o.id, pr.id, p_qtd, p_local, round(coalesce(v_val, 0), 2)) returning id into v_id;
    return v_id;
  end if;
  select id into t from est_tipos_movimento where empresa_id = o.empresa_id and codigo = 'REQINT' and ativo;
  if t is null then raise exception 'Tipo de movimento REQINT não configurado no estoque.'; end if;
  v_loc := coalesce(p_local, pr.local_padrao_id, (select id from est_locais where empresa_id = o.empresa_id and codigo = 'MAN'));
  if v_loc is null then raise exception 'Escolha o local de onde sai a peça.'; end if;
  insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, documento, observacao, centro_custo_id)
  values (o.empresa_id, current_date, pr.id, v_loc, t, -p_qtd, 'OS ' || o.numero, left(e.codigo || ' ' || e.nome, 200), e.centro_custo_id)
  returning id, abs(coalesce(valor, 0)) into v_mov, v_val;
  insert into man_os_pecas(empresa_id, ordem_id, produto_id, quantidade, local_id, movimento_id, custo)
  values (o.empresa_id, o.id, pr.id, p_qtd, v_loc, v_mov, v_val) returning id into v_id;
  return v_id;
end $$;
create or replace function public.man_estornar_peca(p_peca uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare pc man_os_pecas; o man_ordens;
begin
  select * into pc from man_os_pecas where id = p_peca;
  select * into o from man_ordens where id = pc.ordem_id;
  if pc.id is null or not public.pode_manutencao(pc.empresa_id) then raise exception 'Sem permissão.'; end if;
  if pc.situacao <> 'consumida' then raise exception 'Peça já estornada.'; end if;
  if o.situacao in ('concluida', 'cancelada') and not public.pode_pcp(o.empresa_id) then raise exception 'OS encerrada: só quem gerencia estorna.'; end if;
  if pc.movimento_id is not null then perform est_estornar(pc.movimento_id, current_date, coalesce(p_motivo, 'Estorno da peça da OS ' || o.numero)); end if;
  update man_os_pecas set situacao = 'estornada' where id = pc.id;
end $$;
revoke all on function public.man_consumir_peca(uuid, uuid, numeric, uuid), public.man_estornar_peca(uuid, text) from public, anon;
grant execute on function public.man_consumir_peca(uuid, uuid, numeric, uuid), public.man_estornar_peca(uuid, text) to authenticated;

-- 12) importar as máquinas da produção como equipamentos (uma vez por máquina) e criar o catálogo de falhas de partida
create or replace function public.man_configurar(p_empresa uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_eq int; v_f int;
begin
  if not public.pode_pcp(p_empresa) then raise exception 'Sem permissão.'; end if;
  insert into man_parametros(empresa_id) values (p_empresa) on conflict do nothing;
  insert into man_equipamentos(empresa_id, codigo, nome, tipo, maquina_id, setor_id, criticidade, bem_id)
  select m.empresa_id, m.codigo, m.nome, 'maquina', m.id, m.setor_id, 'A', (select b.id from af_bens b where b.maquina_id = m.id and b.situacao <> 'baixado' limit 1)
    from prod_maquinas m
   where m.empresa_id = p_empresa and m.ativo and not exists (select 1 from man_equipamentos e where e.maquina_id = m.id)
     and not exists (select 1 from man_equipamentos e where e.empresa_id = p_empresa and e.codigo = upper(trim(m.codigo)));
  get diagnostics v_eq = row_count;
  insert into man_falhas(empresa_id, codigo, nome, categoria)
  select p_empresa, c, n, k from (values
    ('MEC-ROL', 'Rolamento danificado', 'mecanica'), ('MEC-COR', 'Correia rompida ou gasta', 'mecanica'), ('MEC-ROS', 'Desgaste de rosca / canhão', 'mecanica'),
    ('MEC-VAZ', 'Vazamento', 'mecanica'), ('MEC-FAC', 'Faca / lâmina de corte gasta', 'mecanica'), ('MEC-ALI', 'Desalinhamento / folga', 'mecanica'),
    ('ELE-MOT', 'Motor elétrico queimado', 'eletrica'), ('ELE-RES', 'Resistência de aquecimento queimada', 'eletrica'), ('ELE-COM', 'Contator / disjuntor / fusível', 'eletrica'),
    ('ELE-TER', 'Termopar / controle de temperatura', 'instrumentacao'), ('ELT-INV', 'Inversor de frequência', 'eletronica'), ('ELT-CLP', 'CLP / IHM', 'eletronica'),
    ('PNE-VAZ', 'Vazamento de ar / cilindro pneumático', 'pneumatica'), ('HID-BOM', 'Bomba / mangueira hidráulica', 'hidraulica'),
    ('LUB-FAL', 'Falta de lubrificação', 'lubrificacao'), ('OPE-AJU', 'Ajuste / regulagem de operação', 'operacional'), ('OPE-USO', 'Uso indevido', 'operacional'),
    ('OUT', 'Outra', 'outra')) x(c, n, k)
  on conflict (empresa_id, codigo) do nothing;
  get diagnostics v_f = row_count;
  return jsonb_build_object('equipamentos', v_eq, 'falhas', v_f);
end $$;
revoke all on function public.man_configurar(uuid) from public, anon;
grant execute on function public.man_configurar(uuid) to authenticated;
revoke all on function public._man_regras(), public._man_leitura(), public._man_parada_abre_os(), public._man_os_parada() from public, anon, authenticated;

-- 13) arquivos: manutencao/<empresa>/<…>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('manutencao', 'manutencao', false, 15728640, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists manutencao_arq_sel on storage.objects;
drop policy if exists manutencao_arq_ins on storage.objects;
drop policy if exists manutencao_arq_del on storage.objects;
create policy manutencao_arq_sel on storage.objects for select to authenticated using (bucket_id = 'manutencao' and public.ve_producao(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy manutencao_arq_ins on storage.objects for insert to authenticated with check (bucket_id = 'manutencao' and public.pode_manutencao(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy manutencao_arq_del on storage.objects for delete to authenticated using (bucket_id = 'manutencao' and public.pode_pcp(public._uuid_ou_nulo((storage.foldername(name))[1])));

-- 14) auditoria
do $$ declare t text; begin
  if to_regprocedure('public._auditar()') is not null then
    foreach t in array array['man_parametros', 'man_equipamentos', 'man_planos', 'man_ordens', 'man_os_pecas'] loop
      execute format('drop trigger if exists zz_auditoria on public.%s', t);
      execute format('create trigger zz_auditoria after insert or update or delete on public.%s for each row execute function public._auditar()', t);
    end loop;
  end if;
end $$;

-- conferência: tabelas = 9, funções = 7, bucket = 1
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'man\_%') as tabelas,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in
         ('pode_manutencao', 'man_horas_maquina', 'man_gerar_preventivas', 'man_consumir_peca', 'man_estornar_peca', 'man_configurar', 'semacento_lower')) as funcoes,
       (select count(*) from storage.buckets where id = 'manutencao') as bucket;
