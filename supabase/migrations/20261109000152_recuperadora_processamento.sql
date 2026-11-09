-- Recuperadora — parte 2: processamento (ordem de reprocesso com os lotes de entrada consumidos e o apontamento por etapa),
-- rendimento por lote, fornecedor e material, qualidade do grão (ensaios contra a especificação, bloqueio até o ensaio),
-- custo do kg de grão (material + energia + água + químicos + mão de obra + máquina + outros), economia contra a resina virgem,
-- saída do grão (volta para a linha, venda ou perda) com o limite de reciclado por produto. Tudo configurável. Aditivo.

-- ---------- parâmetros novos ----------
alter table public.rec_config add column if not exists custo_kwh numeric(10,4) not null default 0 check (custo_kwh >= 0);
alter table public.rec_config add column if not exists custo_m3_agua numeric(10,4) not null default 0 check (custo_m3_agua >= 0);
alter table public.rec_config add column if not exists custo_hora_mo numeric(10,2) not null default 0 check (custo_hora_mo >= 0);
alter table public.rec_config add column if not exists custo_hora_maquina numeric(10,2) not null default 0 check (custo_hora_maquina >= 0);  -- quando a máquina não tem custo-hora
alter table public.rec_config add column if not exists meta_rendimento_pct numeric(5,2) not null default 85 check (meta_rendimento_pct between 0 and 100);
alter table public.rec_config add column if not exists exigir_ensaio boolean not null default true;        -- lote de grão nasce bloqueado até o ensaio aprovado
alter table public.rec_config add column if not exists prefixo_grao text not null default 'GR' check (length(prefixo_grao) between 1 and 6);

-- etapas do processo (roteiro da empresa)
create table if not exists public.rec_etapas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,
  nome text not null,
  ordem smallint not null default 0,
  ativo boolean not null default true,
  unique (empresa_id, codigo)
);

-- preço da resina virgem por polímero (para a economia)
create table if not exists public.rec_resina_virgem (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  polimero text not null,
  vigencia date not null,
  preco_kg numeric(12,4) not null check (preco_kg >= 0),
  fonte text,
  unique (empresa_id, polimero, vigencia)
);

-- especificação do grão por material de saída
create table if not exists public.rec_especificacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  material_id uuid not null unique references public.rec_materiais(id) on delete cascade,
  mfi_min numeric(8,3), mfi_max numeric(8,3),               -- índice de fluidez (g/10 min)
  umidade_max numeric(6,3),                                  -- %
  densidade_min numeric(6,4), densidade_max numeric(6,4),   -- g/cm³
  contaminacao_max numeric(6,3),                             -- %
  observacao text
);

-- limite de reciclado por produto acabado (% do peso da OP)
create table if not exists public.rec_limites (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  produto_id uuid not null unique references public.produtos(id) on delete cascade,
  max_pct numeric(5,2) not null check (max_pct between 0 and 100)
);

-- ---------- ordem de reprocesso ----------
create table if not exists public.rec_ordens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int,
  data date not null default current_date,
  material_saida_id uuid not null references public.rec_materiais(id),
  maquina_id uuid references public.prod_maquinas(id) on delete set null,
  situacao text not null default 'aberta' check (situacao in ('aberta', 'concluida', 'cancelada')),
  energia_kwh numeric(12,2) not null default 0 check (energia_kwh >= 0),
  agua_m3 numeric(12,3) not null default 0 check (agua_m3 >= 0),
  quimicos_valor numeric(14,2) not null default 0 check (quimicos_valor >= 0),
  mo_horas numeric(10,2) not null default 0 check (mo_horas >= 0),
  outros_valor numeric(14,2) not null default 0 check (outros_valor >= 0),
  peso_entrada numeric(14,3), peso_saida numeric(14,3),
  custo_material numeric(16,2), custo_processo numeric(16,2), custo_total numeric(16,2),
  lote_saida_id uuid references public.rec_lotes(id) on delete set null,
  observacao text,
  concluida_em timestamptz, concluida_por uuid,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);

create table if not exists public.rec_ordem_entradas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem_id uuid not null references public.rec_ordens(id) on delete cascade,
  lote_id uuid not null references public.rec_lotes(id),
  kg numeric(14,3) not null check (kg > 0),
  custo numeric(16,2) not null default 0,
  criado_em timestamptz not null default now()
);
create index if not exists rec_ordem_entradas_o on public.rec_ordem_entradas(ordem_id);
create index if not exists rec_ordem_entradas_l on public.rec_ordem_entradas(lote_id);

create table if not exists public.rec_ordem_etapas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem_id uuid not null references public.rec_ordens(id) on delete cascade,
  etapa_id uuid not null references public.rec_etapas(id),
  maquina_id uuid references public.prod_maquinas(id) on delete set null,
  operador text,
  inicio timestamptz, fim timestamptz,
  horas_maquina numeric(10,2) not null default 0 check (horas_maquina >= 0),
  kg_entrada numeric(14,3) check (kg_entrada is null or kg_entrada >= 0),
  kg_saida numeric(14,3) check (kg_saida is null or kg_saida >= 0),
  perda_umidade numeric(14,3) not null default 0 check (perda_umidade >= 0),
  perda_sujeira numeric(14,3) not null default 0 check (perda_sujeira >= 0),
  perda_finos numeric(14,3) not null default 0 check (perda_finos >= 0),
  perda_rejeito numeric(14,3) not null default 0 check (perda_rejeito >= 0),
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  check (fim is null or inicio is null or fim >= inicio)
);
create index if not exists rec_ordem_etapas_o on public.rec_ordem_etapas(ordem_id);

-- ---------- qualidade do grão ----------
create table if not exists public.rec_ensaios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  lote_id uuid not null references public.rec_lotes(id) on delete cascade,
  data date not null default current_date,
  mfi numeric(8,3), umidade numeric(6,3), densidade numeric(6,4), contaminacao numeric(6,3), cor text,
  resultado text not null check (resultado in ('aprovado', 'reprovado')),
  motivos text[] not null default '{}',
  observacao text,
  responsavel uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists rec_ensaios_l on public.rec_ensaios(lote_id, criado_em);

-- ---------- saídas do grão (e de qualquer lote): volta para a linha, venda, perda ----------
create table if not exists public.rec_lote_saidas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  lote_id uuid not null references public.rec_lotes(id),
  data date not null default current_date,
  destino text not null check (destino in ('producao', 'venda', 'perda', 'ajuste')),
  kg numeric(14,3) not null check (kg > 0),
  custo numeric(16,2) not null default 0,
  ordem_producao_id uuid references public.prod_ordens(id) on delete set null,
  documento text,                                            -- NF da venda, nº da OP digitado, motivo da perda
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists rec_lote_saidas_l on public.rec_lote_saidas(lote_id);

-- ---------- segurança ----------
do $$ declare t text; begin
  foreach t in array array['rec_etapas', 'rec_resina_virgem', 'rec_especificacoes', 'rec_limites', 'rec_ordens', 'rec_ordem_entradas', 'rec_ordem_etapas', 'rec_ensaios', 'rec_lote_saidas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.ve_producao(empresa_id))', t || '_sel', t);
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
  -- cadastros: quem planeja
  foreach t in array array['rec_etapas', 'rec_resina_virgem', 'rec_especificacoes', 'rec_limites'] loop
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.pode_pcp(empresa_id))', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.pode_pcp(empresa_id)) with check (public.pode_pcp(empresa_id))', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.pode_pcp(empresa_id))', t || '_del', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
-- ordem: quem aponta abre e edita enquanto aberta; entradas, conclusão, ensaios e saídas pelas funções
drop policy if exists rec_ordens_ins on public.rec_ordens;
create policy rec_ordens_ins on public.rec_ordens for insert to authenticated with check (public.pode_apontar(empresa_id) and situacao = 'aberta');
drop policy if exists rec_ordens_upd on public.rec_ordens;
create policy rec_ordens_upd on public.rec_ordens for update to authenticated using (public.pode_apontar(empresa_id) and situacao = 'aberta') with check (public.pode_apontar(empresa_id) and situacao = 'aberta');
grant select, insert, update on public.rec_ordens to authenticated;
drop policy if exists rec_ordem_etapas_ins on public.rec_ordem_etapas;
create policy rec_ordem_etapas_ins on public.rec_ordem_etapas for insert to authenticated with check (public.pode_apontar(empresa_id) and exists (select 1 from rec_ordens o where o.id = ordem_id and o.empresa_id = rec_ordem_etapas.empresa_id and o.situacao = 'aberta'));
drop policy if exists rec_ordem_etapas_upd on public.rec_ordem_etapas;
create policy rec_ordem_etapas_upd on public.rec_ordem_etapas for update to authenticated using (public.pode_apontar(empresa_id) and exists (select 1 from rec_ordens o where o.id = ordem_id and o.situacao = 'aberta'))
  with check (public.pode_apontar(empresa_id) and exists (select 1 from rec_ordens o where o.id = ordem_id and o.empresa_id = rec_ordem_etapas.empresa_id and o.situacao = 'aberta'));
drop policy if exists rec_ordem_etapas_del on public.rec_ordem_etapas;
create policy rec_ordem_etapas_del on public.rec_ordem_etapas for delete to authenticated using (public.pode_apontar(empresa_id) and exists (select 1 from rec_ordens o where o.id = ordem_id and o.situacao = 'aberta'));
grant select, insert, update, delete on public.rec_ordem_etapas to authenticated;
grant select on public.rec_ordem_entradas, public.rec_ensaios, public.rec_lote_saidas to authenticated;

-- número da ordem e vínculos da mesma empresa
create or replace function public._rec_ordem_antes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('rec_ordem_' || new.empresa_id));
    if new.numero is null then new.numero := coalesce((select max(numero) from rec_ordens where empresa_id = new.empresa_id), 0) + 1; end if;
  end if;
  if (select empresa_id from rec_materiais where id = new.material_saida_id) is distinct from new.empresa_id
     or (new.maquina_id is not null and (select empresa_id from prod_maquinas where id = new.maquina_id) is distinct from new.empresa_id) then
    raise exception 'Material ou máquina de outra empresa';
  end if;
  return new;
end $$;
drop trigger if exists rec_ordem_antes on public.rec_ordens;
create trigger rec_ordem_antes before insert or update on public.rec_ordens for each row execute function public._rec_ordem_antes();

create or replace function public._rec_etapa_antes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select empresa_id from rec_etapas where id = new.etapa_id) is distinct from new.empresa_id
     or (new.maquina_id is not null and (select empresa_id from prod_maquinas where id = new.maquina_id) is distinct from new.empresa_id) then
    raise exception 'Etapa ou máquina de outra empresa';
  end if;
  if new.inicio is not null and new.fim is not null and coalesce(new.horas_maquina, 0) = 0 then
    new.horas_maquina := round(extract(epoch from new.fim - new.inicio) / 3600.0, 2);
  end if;
  return new;
end $$;
drop trigger if exists rec_etapa_antes on public.rec_ordem_etapas;
create trigger rec_etapa_antes before insert or update on public.rec_ordem_etapas for each row execute function public._rec_etapa_antes();

-- ---------- entradas da ordem: separa o kg do lote (o saldo cai na hora; volta se tirar enquanto a ordem está aberta) ----------
create or replace function public.rec_ordem_entrada(p_ordem uuid, p_lote uuid, p_kg numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare o rec_ordens; l rec_lotes; v uuid; v_custo numeric;
begin
  select * into o from rec_ordens where id = p_ordem for update;
  if o.id is null or not public.pode_apontar(o.empresa_id) then raise exception 'Acesso negado.'; end if;
  if o.situacao <> 'aberta' then raise exception 'A ordem não está aberta.'; end if;
  select * into l from rec_lotes where id = p_lote for update;
  if l.id is null or l.empresa_id <> o.empresa_id then raise exception 'Lote não encontrado.'; end if;
  if l.tipo = 'grao' and l.material_id = o.material_saida_id then null; end if;   -- reprocessar grão é permitido
  if l.situacao not in ('disponivel', 'em_processo') then raise exception 'O lote % está %: não entra no processamento.', l.codigo, l.situacao; end if;
  if coalesce(p_kg, 0) <= 0 or p_kg > l.saldo_kg + 0.0005 then raise exception 'O lote % tem % kg de saldo.', l.codigo, l.saldo_kg; end if;
  v_custo := round(p_kg * l.custo_total / nullif(l.peso_kg, 0), 2);
  update rec_lotes set saldo_kg = saldo_kg - p_kg, situacao = case when saldo_kg - p_kg <= 0.0005 then 'consumido' else 'em_processo' end where id = l.id;
  insert into rec_ordem_entradas(empresa_id, ordem_id, lote_id, kg, custo) values (o.empresa_id, o.id, l.id, p_kg, coalesce(v_custo, 0)) returning id into v;
  return v;
end $$;

create or replace function public.rec_ordem_entrada_tirar(p_entrada uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e rec_ordem_entradas; o rec_ordens;
begin
  select * into e from rec_ordem_entradas where id = p_entrada;
  select * into o from rec_ordens where id = e.ordem_id for update;
  if o.id is null or not public.pode_apontar(o.empresa_id) then raise exception 'Acesso negado.'; end if;
  if o.situacao <> 'aberta' then raise exception 'A ordem não está aberta.'; end if;
  update rec_lotes set saldo_kg = saldo_kg + e.kg,
    situacao = case when saldo_kg + e.kg >= peso_kg - 0.0005 and not exists (select 1 from rec_ordem_entradas x where x.lote_id = e.lote_id and x.id <> e.id) then 'disponivel' else 'em_processo' end
   where id = e.lote_id;
  delete from rec_ordem_entradas where id = e.id;
end $$;

-- custo-hora da máquina: a da máquina, a do setor, o padrão do custo da OP, o padrão da recuperadora
create or replace function public._rec_custo_hora(p_empresa uuid, p_maquina uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select m.custo_hora from prod_maquinas m where m.id = p_maquina), (select s.custo_hora from prod_maquinas m join prod_setores s on s.id = m.setor_id where m.id = p_maquina),
                  nullif((select custo_hora_padrao from prod_custo_config where empresa_id = p_empresa), 0), (select custo_hora_maquina from rec_config where empresa_id = p_empresa), 0)
$$;

-- custo do processo da ordem (sem o material)
create or replace function public._rec_custo_processo(p_ordem uuid) returns numeric language sql stable security definer set search_path = public as $$
  select round(o.energia_kwh * c.custo_kwh + o.agua_m3 * c.custo_m3_agua + o.quimicos_valor + o.mo_horas * c.custo_hora_mo + o.outros_valor
    + coalesce((select sum(e.horas_maquina * public._rec_custo_hora(o.empresa_id, coalesce(e.maquina_id, o.maquina_id))) from rec_ordem_etapas e where e.ordem_id = o.id), 0), 2)
  from rec_ordens o join rec_config c on c.empresa_id = o.empresa_id where o.id = p_ordem
$$;

-- ---------- concluir: lote de grão com o custo total; bloqueado até o ensaio (parâmetro); Kardex opcional ----------
create or replace function public.rec_ordem_concluir(p_ordem uuid, p_kg_saida numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o rec_ordens; cfg rec_config; v_ent numeric; v_mat numeric; v_proc numeric; v_lote uuid; v_cod text; n int := 1; v_prod uuid; v_local uuid; v_tipo uuid; v_mov uuid;
begin
  select * into o from rec_ordens where id = p_ordem for update;
  if o.id is null or not public.pode_apontar(o.empresa_id) then raise exception 'Acesso negado.'; end if;
  if o.situacao <> 'aberta' then raise exception 'A ordem não está aberta.'; end if;
  select * into cfg from rec_config where empresa_id = o.empresa_id;
  select sum(kg), sum(custo) into v_ent, v_mat from rec_ordem_entradas where ordem_id = o.id;
  if coalesce(v_ent, 0) <= 0 then raise exception 'Informe os lotes que entraram na ordem.'; end if;
  if coalesce(p_kg_saida, 0) <= 0 then raise exception 'Informe o peso de grão produzido.'; end if;
  if p_kg_saida > v_ent * 1.02 then raise exception 'Saíram % kg e entraram % kg: confira os pesos.', p_kg_saida, v_ent; end if;
  v_proc := public._rec_custo_processo(o.id);
  v_cod := cfg.prefixo_grao || '-' || to_char(o.data, 'YYMMDD') || '-' || o.numero;
  while exists (select 1 from rec_lotes where empresa_id = o.empresa_id and codigo = v_cod) loop n := n + 1; v_cod := cfg.prefixo_grao || '-' || to_char(o.data, 'YYMMDD') || '-' || o.numero || '-' || n; end loop;
  insert into rec_lotes(empresa_id, codigo, tipo, material_id, data, peso_kg, saldo_kg, custo_total, situacao)
  values (o.empresa_id, v_cod, 'grao', o.material_saida_id, o.data, p_kg_saida, p_kg_saida, coalesce(v_mat, 0) + v_proc, case when cfg.exigir_ensaio then 'bloqueado' else 'disponivel' end)
  returning id into v_lote;
  -- lotes de entrada que ficaram "em processo" por esta ordem passam a consumidos se zeraram
  update rec_lotes l set situacao = 'consumido' where l.id in (select lote_id from rec_ordem_entradas where ordem_id = o.id) and l.saldo_kg <= 0.0005;
  update rec_lotes l set situacao = 'disponivel' where l.id in (select lote_id from rec_ordem_entradas where ordem_id = o.id) and l.saldo_kg > 0.0005 and l.situacao = 'em_processo'
     and not exists (select 1 from rec_ordem_entradas x join rec_ordens y on y.id = x.ordem_id where x.lote_id = l.id and y.situacao = 'aberta' and y.id <> o.id);
  -- Kardex: grão com produto ligado entra como produção
  v_prod := (select produto_id from rec_materiais where id = o.material_saida_id);
  if cfg.integrar_estoque and v_prod is not null then
    v_local := coalesce(cfg.est_local_id, (select id from est_locais where empresa_id = o.empresa_id and codigo = 'APA'));
    v_tipo := (select id from est_tipos_movimento where empresa_id = o.empresa_id and codigo = 'PROD');
    if v_local is not null and v_tipo is not null then
      insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario, documento, observacao)
      values (o.empresa_id, o.data, v_prod, v_local, v_tipo, p_kg_saida, round((coalesce(v_mat, 0) + v_proc) / p_kg_saida, 10), 'Reprocesso ' || o.numero, 'Recuperadora — lote ' || v_cod)
      returning id into v_mov;
      update rec_lotes set est_movimento_id = v_mov where id = v_lote;
    end if;
  end if;
  update rec_ordens set situacao = 'concluida', peso_entrada = v_ent, peso_saida = p_kg_saida, custo_material = coalesce(v_mat, 0), custo_processo = v_proc,
    custo_total = coalesce(v_mat, 0) + v_proc, lote_saida_id = v_lote, concluida_em = now(), concluida_por = auth.uid() where id = o.id;
  return jsonb_build_object('lote', v_cod, 'lote_id', v_lote, 'entrada', v_ent, 'saida', p_kg_saida, 'rendimento', round(p_kg_saida / v_ent, 4),
    'custo_total', coalesce(v_mat, 0) + v_proc, 'custo_kg', round((coalesce(v_mat, 0) + v_proc) / p_kg_saida, 4), 'bloqueado', cfg.exigir_ensaio);
end $$;

-- cancelar ordem aberta: devolve o kg aos lotes
create or replace function public.rec_ordem_cancelar(p_ordem uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare o rec_ordens; e record;
begin
  select * into o from rec_ordens where id = p_ordem for update;
  if o.id is null or not public.pode_apontar(o.empresa_id) then raise exception 'Acesso negado.'; end if;
  if o.situacao <> 'aberta' then raise exception 'Só a ordem aberta pode ser cancelada.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo.'; end if;
  for e in select id from rec_ordem_entradas where ordem_id = o.id loop perform public.rec_ordem_entrada_tirar(e.id); end loop;
  update rec_ordens set situacao = 'cancelada', observacao = trim(coalesce(observacao, '') || ' Cancelada: ' || p_motivo) where id = o.id;
end $$;

-- ---------- ensaio do grão: compara com a especificação, libera ou bloqueia o lote ----------
create or replace function public.rec_ensaio_registrar(p_lote uuid, p_mfi numeric, p_umidade numeric, p_densidade numeric, p_contaminacao numeric, p_cor text, p_obs text default null, p_forcar text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l rec_lotes; s rec_especificacoes; m text[] := '{}'; r text; v uuid;
begin
  select * into l from rec_lotes where id = p_lote for update;
  if l.id is null or not public.pode_apontar(l.empresa_id) then raise exception 'Acesso negado.'; end if;
  if l.situacao not in ('disponivel', 'bloqueado') then raise exception 'O lote % está %.', l.codigo, l.situacao; end if;
  select * into s from rec_especificacoes where material_id = l.material_id;
  if p_mfi is not null and s.mfi_min is not null and p_mfi < s.mfi_min then m := m || ('índice de fluidez abaixo de ' || s.mfi_min); end if;
  if p_mfi is not null and s.mfi_max is not null and p_mfi > s.mfi_max then m := m || ('índice de fluidez acima de ' || s.mfi_max); end if;
  if p_umidade is not null and s.umidade_max is not null and p_umidade > s.umidade_max then m := m || ('umidade acima de ' || s.umidade_max || '%'); end if;
  if p_densidade is not null and s.densidade_min is not null and p_densidade < s.densidade_min then m := m || ('densidade abaixo de ' || s.densidade_min); end if;
  if p_densidade is not null and s.densidade_max is not null and p_densidade > s.densidade_max then m := m || ('densidade acima de ' || s.densidade_max); end if;
  if p_contaminacao is not null and s.contaminacao_max is not null and p_contaminacao > s.contaminacao_max then m := m || ('contaminação acima de ' || s.contaminacao_max || '%'); end if;
  r := case when cardinality(m) = 0 then 'aprovado' else 'reprovado' end;
  -- liberar fora da especificação (concessão) só quem planeja, com motivo
  if p_forcar = 'aprovado' and r = 'reprovado' then
    if not public.pode_pcp(l.empresa_id) or length(trim(coalesce(p_obs, ''))) < 5 then raise exception 'Liberar fora da especificação exige admin, financeiro ou diretor e a justificativa.'; end if;
    r := 'aprovado'; m := m || 'liberado por concessão'::text;
  elsif p_forcar = 'reprovado' then r := 'reprovado';
  end if;
  insert into rec_ensaios(empresa_id, lote_id, mfi, umidade, densidade, contaminacao, cor, resultado, motivos, observacao)
  values (l.empresa_id, l.id, p_mfi, p_umidade, p_densidade, p_contaminacao, nullif(trim(p_cor), ''), r, m, nullif(trim(p_obs), '')) returning id into v;
  update rec_lotes set situacao = case when r = 'aprovado' then 'disponivel' else 'bloqueado' end where id = l.id;
  return jsonb_build_object('resultado', r, 'motivos', to_jsonb(m), 'tem_especificacao', s.id is not null);
end $$;

-- ---------- saída de lote (grão para a linha, venda, perda, ajuste) ----------
create or replace function public.rec_lote_baixar(p_lote uuid, p_kg numeric, p_destino text, p_data date default current_date, p_op uuid default null, p_documento text default null, p_obs text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare l rec_lotes; v_custo numeric; o prod_ordens; v_lim numeric; v_rec numeric; aviso text;
begin
  select * into l from rec_lotes where id = p_lote for update;
  if l.id is null or not public.pode_apontar(l.empresa_id) then raise exception 'Acesso negado.'; end if;
  if p_destino not in ('producao', 'venda', 'perda', 'ajuste') then raise exception 'Destino inválido.'; end if;
  if p_destino in ('perda', 'ajuste') and not public.pode_pcp(l.empresa_id) then raise exception 'Perda e ajuste só por admin, financeiro ou diretor.'; end if;
  if l.situacao <> 'disponivel' then raise exception 'O lote % está % e não pode sair.', l.codigo, l.situacao; end if;
  if coalesce(p_kg, 0) <= 0 or p_kg > l.saldo_kg + 0.0005 then raise exception 'O lote % tem % kg de saldo.', l.codigo, l.saldo_kg; end if;
  if p_destino = 'perda' and length(trim(coalesce(p_obs, p_documento, ''))) < 5 then raise exception 'Informe o motivo da perda.'; end if;
  if p_op is not null then select * into o from prod_ordens where id = p_op and empresa_id = l.empresa_id; if o.id is null then raise exception 'OP não encontrada.'; end if; end if;
  v_custo := round(p_kg * l.custo_total / nullif(l.peso_kg, 0), 2);
  insert into rec_lote_saidas(empresa_id, lote_id, data, destino, kg, custo, ordem_producao_id, documento, observacao)
  values (l.empresa_id, l.id, coalesce(p_data, current_date), p_destino, p_kg, coalesce(v_custo, 0), p_op, nullif(trim(p_documento), ''), nullif(trim(p_obs), ''));
  update rec_lotes set saldo_kg = saldo_kg - p_kg, situacao = case when saldo_kg - p_kg <= 0.0005 then case when p_destino = 'venda' then 'vendido' else 'consumido' end else situacao end where id = l.id;
  -- limite de reciclado do produto da OP
  if o.id is not null and o.produto_id is not null then
    select max_pct into v_lim from rec_limites where produto_id = o.produto_id;
    if v_lim is not null then
      select sum(kg) into v_rec from rec_lote_saidas where ordem_producao_id = o.id and destino = 'producao';
      if v_rec / o.quantidade * 100 > v_lim then
        aviso := format('A OP %s já recebeu %s kg de reciclado (%s%% da quantidade), acima do limite de %s%% do produto.', o.numero, round(v_rec, 1), round(v_rec / o.quantidade * 100, 1), v_lim);
        perform _notificar_u(l.empresa_id, public._usuarios_papel(l.empresa_id, array['admin', 'diretor']), 'rec_limite_reciclado', 'Reciclado acima do limite na OP ' || o.numero, aviso, '#/recuperadora/lotes', l.id, false);
      end if;
    end if;
  end if;
  return jsonb_build_object('custo', coalesce(v_custo, 0), 'aviso', aviso);
end $$;

-- ---------- rendimento e custo no período ----------
-- rendimento da ordem = saída ÷ entrada; o grão de cada lote de entrada = kg consumido × rendimento da ordem (atribuição proporcional)
create or replace function public.rec_rendimento(p_empresa uuid, p_de date, p_ate date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; cfg rec_config;
begin
  if not public.ve_producao(p_empresa) then raise exception 'Acesso negado.'; end if;
  select * into cfg from rec_config where empresa_id = p_empresa;
  with ord as (
    select o.*, o.peso_saida / nullif(o.peso_entrada, 0) rend, m.polimero, m.codigo mcod, m.nome mnome
      from rec_ordens o join rec_materiais m on m.id = o.material_saida_id
     where o.empresa_id = p_empresa and o.situacao = 'concluida' and o.data between p_de and p_ate
  ), ent as (
    select e.*, l.tipo ltipo, l.material_id lmat, l.fornecedor_id, l.custo_total lcusto, l.peso_kg lpeso, ord.rend, ord.id oid,
           (select i.valor from rec_ticket_itens i where i.id = l.ticket_item_id) * e.kg / nullif(l.peso_kg, 0) pago,
           (select i.peso_kg from rec_ticket_itens i where i.id = l.ticket_item_id) * e.kg / nullif(l.peso_kg, 0) pesado
      from rec_ordem_entradas e join ord on ord.id = e.ordem_id join rec_lotes l on l.id = e.lote_id
  ), virg as (
    select polimero, (select preco_kg from rec_resina_virgem r where r.empresa_id = p_empresa and r.polimero = x.polimero and r.vigencia <= p_ate order by vigencia desc limit 1) preco
      from (select distinct polimero from ord) x
  ), perdas as (
    select sum(perda_umidade) umidade, sum(perda_sujeira) sujeira, sum(perda_finos) finos, sum(perda_rejeito) rejeito
      from rec_ordem_etapas t where t.ordem_id in (select id from ord)
  )
  select jsonb_build_object(
    'meta_pct', coalesce(cfg.meta_rendimento_pct, 85),
    'total', (select jsonb_build_object('ordens', count(*), 'entrada', coalesce(sum(peso_entrada), 0), 'saida', coalesce(sum(peso_saida), 0),
                'rendimento', round(sum(peso_saida) / nullif(sum(peso_entrada), 0), 4), 'custo_material', coalesce(sum(custo_material), 0), 'custo_processo', coalesce(sum(custo_processo), 0),
                'custo_kg', round(sum(custo_total) / nullif(sum(peso_saida), 0), 4)) from ord),
    'perdas', (select to_jsonb(p) from perdas p),
    'grao', coalesce((select jsonb_agg(jsonb_build_object('material', mcod || ' — ' || mnome, 'polimero', g.polimero, 'ordens', g.n, 'entrada', g.ent, 'saida', g.sai, 'rendimento', round(g.sai / nullif(g.ent, 0), 4),
                'custo_material_kg', round(g.cm / nullif(g.sai, 0), 4), 'custo_processo_kg', round(g.cp / nullif(g.sai, 0), 4), 'custo_kg', round((g.cm + g.cp) / nullif(g.sai, 0), 4),
                'virgem_kg', vg.preco, 'economia', case when vg.preco is not null then round((vg.preco - (g.cm + g.cp) / nullif(g.sai, 0)) * g.sai, 2) end) order by g.sai desc)
               from (select mcod, mnome, polimero, count(*) n, sum(peso_entrada) ent, sum(peso_saida) sai, sum(custo_material) cm, sum(custo_processo) cp from ord group by mcod, mnome, polimero) g
               left join virg vg on vg.polimero = g.polimero), '[]'),
    'fornecedores', coalesce((select jsonb_agg(jsonb_build_object('fornecedor_id', f.id, 'fornecedor', coalesce(f.nome, 'Aparas internas'), 'rec_tipo', f.rec_tipo, 'pesado', round(z.pesado, 3), 'consumido', round(z.kg, 3),
                'grao', round(z.grao, 3), 'rendimento', round(z.grao / nullif(z.kg, 0), 4), 'rendimento_pesado', round(z.grao / nullif(z.pesado, 0), 4), 'pago', round(z.pago, 2),
                'custo_grao_kg', round(z.pago / nullif(z.grao, 0), 4), 'preco_pago_kg', round(z.pago / nullif(z.pesado, 0), 4)) order by z.kg desc)
               from (select fornecedor_id, sum(kg) kg, sum(kg * rend) grao, sum(coalesce(pago, custo)) pago, sum(coalesce(pesado, kg)) pesado from ent group by fornecedor_id) z
               left join favorecidos f on f.id = z.fornecedor_id), '[]'),
    'materiais', coalesce((select jsonb_agg(jsonb_build_object('material', m.codigo || ' — ' || m.nome, 'tipo', z.ltipo, 'consumido', round(z.kg, 3), 'grao', round(z.grao, 3), 'rendimento', round(z.grao / nullif(z.kg, 0), 4)) order by z.kg desc)
               from (select lmat, ltipo, sum(kg) kg, sum(kg * rend) grao from ent group by lmat, ltipo) z join rec_materiais m on m.id = z.lmat), '[]'),
    'ordens', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'numero', numero, 'data', data, 'material', mcod, 'entrada', peso_entrada, 'saida', peso_saida, 'rendimento', round(rend, 4),
                'custo_kg', round(custo_total / nullif(peso_saida, 0), 4)) order by data desc, numero desc) from ord), '[]')
  ) into v;
  return v;
end $$;

-- ---------- padrões ----------
create or replace function public.rec_configurar_padrao(p_empresa uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.pode_pcp(p_empresa) then raise exception 'Acesso negado.'; end if;
  insert into rec_config(empresa_id) values (p_empresa) on conflict do nothing;
  insert into rec_classes(empresa_id, codigo, nome, desconto_padrao_pct, ordem)
  select p_empresa, c, n, d, o from (values ('A', 'Limpo e seco', 2, 1), ('B', 'Sujeira leve', 8, 2), ('C', 'Sujo ou úmido', 15, 3)) v(c, n, d, o)
  on conflict (empresa_id, codigo) do nothing;
  insert into rec_etapas(empresa_id, codigo, nome, ordem)
  select p_empresa, c, n, o from (values ('TRI', 'Triagem', 1), ('MOA', 'Moagem', 2), ('LAV', 'Lavagem', 3), ('SEC', 'Secagem', 4), ('AGL', 'Aglutinação', 5), ('EXT', 'Extrusão e granulação', 6)) v(c, n, o)
  on conflict (empresa_id, codigo) do nothing;
end $$;

do $$ declare f text; begin
  foreach f in array array['rec_ordem_entrada(uuid, uuid, numeric)', 'rec_ordem_entrada_tirar(uuid)', 'rec_ordem_concluir(uuid, numeric)', 'rec_ordem_cancelar(uuid, text)',
                           'rec_ensaio_registrar(uuid, numeric, numeric, numeric, numeric, text, text, text)', 'rec_lote_baixar(uuid, numeric, text, date, uuid, text, text)',
                           'rec_rendimento(uuid, date, date)', 'rec_configurar_padrao(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['_rec_ordem_antes()', '_rec_etapa_antes()', '_rec_custo_hora(uuid, uuid)', '_rec_custo_processo(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('rec_limite_reciclado', 'Produção', 'Reciclado acima do limite na OP', 'Grão reciclado dado à OP passou do limite de reciclado do produto (Recuperadora).', false, 97)
on conflict (codigo) do nothing;

-- empresas que já ligaram o módulo ganham as etapas padrão
insert into public.rec_etapas(empresa_id, codigo, nome, ordem)
select c.empresa_id, v.c, v.n, v.o from public.rec_config c
 cross join (values ('TRI', 'Triagem', 1), ('MOA', 'Moagem', 2), ('LAV', 'Lavagem', 3), ('SEC', 'Secagem', 4), ('AGL', 'Aglutinação', 5), ('EXT', 'Extrusão e granulação', 6)) v(c, n, o)
on conflict (empresa_id, codigo) do nothing;

comment on table public.rec_ordens is 'Recuperadora: ordem de reprocesso (lotes de entrada → lote de grão), com custos e rendimento (parte 2)';
comment on table public.rec_ensaios is 'Recuperadora: ensaio do lote de grão contra a especificação do material (parte 2)';
comment on table public.rec_lote_saidas is 'Recuperadora: saída de lote — volta para a linha (OP), venda, perda ou ajuste (parte 2)';
