-- 172 — Análise de Problemas (PAI013): Pareto, Ishikawa, 5 Porquês e 5W2H num só lugar (20/11/2026, pedido do Renan)
-- Módulo geral, para qualquer área. Um PROBLEMA reúne as quatro ferramentas:
--   1. Pareto     — priorizar: dado da própria plataforma (paradas, refugos, falhas, RNC, devoluções, títulos vencidos) ou lista digitada;
--   2. Ishikawa   — levantar as causas por categoria (6M, configurável) e marcar as prováveis;
--   3. 5 Porquês  — aprofundar cada causa provável até a causa raiz;
--   4. 5W2H       — plano de ação com responsável, prazo, custo e situação, com aviso ao responsável e cobrança de atraso.
-- O problema só encerra com a causa raiz registrada, as ações concluídas e a eficácia verificada (regras configuráveis).
-- Toda gravação passa pelas funções (as tabelas só têm política de leitura). Aditivo.

-- 1) quem participa: os papéis de trabalho (portal do motorista e do colaborador ficam de fora); quem gerencia: administrador e diretor
create or replace function public.prob_pode(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor', 'compras', 'vendas', 'producao'));
$$;
create or replace function public.prob_ve(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text not in ('motorista', 'colaborador'));
$$;
create or replace function public.prob_gerencia(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'diretor'));
$$;
revoke all on function public.prob_pode(uuid), public.prob_ve(uuid), public.prob_gerencia(uuid) from public, anon;
grant execute on function public.prob_pode(uuid), public.prob_ve(uuid), public.prob_gerencia(uuid) to authenticated;

-- 2) parâmetros por empresa (sem linha = padrões abaixo)
create table if not exists public.prob_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  categorias jsonb not null default '["Método", "Máquina", "Mão de obra", "Material", "Medida", "Meio ambiente"]'::jsonb,   -- espinhas do Ishikawa
  areas jsonb not null default '["Produção", "Qualidade", "Manutenção", "Logística", "Comercial", "Compras", "Financeiro", "Fiscal", "RH", "Outra"]'::jsonb,
  exige_causa boolean not null default true,        -- encerrar só com a causa raiz registrada
  exige_acao boolean not null default true,         -- encerrar só com ao menos uma ação concluída
  exige_eficacia boolean not null default true,     -- encerrar só com a eficácia verificada
  dias_aviso int not null default 2 check (dias_aviso between 0 and 30),   -- lembrete ao responsável N dias antes do prazo da ação
  avisar_atraso boolean not null default true,      -- cobra a ação vencida (no dia seguinte ao prazo e depois toda segunda-feira)
  pareto_corte numeric(5,2) not null default 80 check (pareto_corte between 50 and 95),   -- % acumulado que define os "poucos vitais"
  atualizado_em timestamptz not null default now()
);

-- 3) o problema
create table if not exists public.prob_problemas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  titulo text not null check (length(trim(titulo)) >= 5),
  descricao text,
  area text not null default 'Outra',
  gravidade text not null default 'media' check (gravidade in ('baixa', 'media', 'alta', 'critica')),
  origem_tipo text not null default 'manual' check (origem_tipo in ('manual', 'pareto', 'rnc', 'manutencao', 'parada')),
  origem_id uuid, origem_ref text,                  -- de onde veio (RNC nº, OS nº, item do Pareto)
  responsavel_id uuid references auth.users(id) on delete set null, responsavel_nome text,
  prazo date,
  pareto jsonb,                                     -- retrato do Pareto: { fonte, de, ate, unidade, itens: [{ nome, valor }], foco: [nome] }
  ishikawa jsonb not null default '[]'::jsonb,      -- [{ categoria, causas: [{ texto, provavel }] }]
  porques jsonb not null default '[]'::jsonb,       -- cadeias: [{ partida, respostas: [texto], causa }]
  causa_raiz text,
  situacao text not null default 'aberto' check (situacao in ('aberto', 'em_analise', 'em_acao', 'verificacao', 'encerrado', 'cancelado')),
  eficacia text check (eficacia in ('eficaz', 'nao_eficaz')), eficacia_obs text, eficacia_em date,
  aberto_por uuid default auth.uid(), aberto_por_nome text, aberto_em timestamptz not null default now(),
  encerrado_em timestamptz, encerrado_por text, cancelado_motivo text,
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists prob_problemas_emp on public.prob_problemas(empresa_id, situacao);
create index if not exists prob_problemas_orig on public.prob_problemas(origem_tipo, origem_id) where origem_id is not null;

-- 4) plano de ação 5W2H
create table if not exists public.prob_acoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  problema_id uuid not null references public.prob_problemas(id) on delete cascade,
  numero int not null,
  o_que text not null check (length(trim(o_que)) >= 3),   -- What
  por_que text,                                            -- Why
  onde text,                                               -- Where
  inicio date, prazo date not null,                        -- When
  responsavel_id uuid references auth.users(id) on delete set null, responsavel_nome text not null,   -- Who
  como text,                                               -- How
  custo_previsto numeric(14,2) not null default 0 check (custo_previsto >= 0),   -- How much
  custo_real numeric(14,2) check (custo_real >= 0),
  situacao text not null default 'pendente' check (situacao in ('pendente', 'em_andamento', 'concluida', 'cancelada')),
  concluida_em date, evidencia text,
  lembrado_em date, cobrado_em date,
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  unique (problema_id, numero),
  check (inicio is null or inicio <= prazo)
);
create index if not exists prob_acoes_emp on public.prob_acoes(empresa_id, situacao, prazo);
create index if not exists prob_acoes_resp on public.prob_acoes(responsavel_id) where situacao in ('pendente', 'em_andamento');

-- 5) diário do problema (comentários e o que o sistema registrou)
create table if not exists public.prob_diario (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  problema_id uuid not null references public.prob_problemas(id) on delete cascade,
  tipo text not null default 'comentario' check (tipo in ('comentario', 'sistema')),
  texto text not null,
  autor text, autor_id uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists prob_diario_p on public.prob_diario(problema_id, criado_em);

-- 6) acesso: só leitura pelas tabelas; gravação só pelas funções
do $$ declare t text; begin
  foreach t in array array['prob_config', 'prob_problemas', 'prob_acoes', 'prob_diario'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.prob_ve(empresa_id))', t || '_sel', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- 7) utilitários internos
create or replace function public._prob_nome(p_empresa uuid, p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(m.nome), ''), (select split_part(u.email, '@', 1) from auth.users u where u.id = p_user)) from membros m where m.empresa_id = p_empresa and m.user_id = p_user;
$$;
create or replace function public._prob_log(p_problema uuid, p_texto text)
returns void language sql security definer set search_path = public as $$
  insert into prob_diario(empresa_id, problema_id, tipo, texto, autor) select empresa_id, id, 'sistema', p_texto, public._prob_nome(empresa_id, auth.uid()) from prob_problemas where id = p_problema;
$$;
-- quem conduz o problema: responsável, quem abriu, administrador ou diretor
create or replace function public._prob_conduz(p prob_problemas)
returns boolean language sql stable security definer set search_path = public as $$
  select public.prob_gerencia(p.empresa_id) or (public.prob_pode(p.empresa_id) and auth.uid() in (p.responsavel_id, p.aberto_por));
$$;
revoke all on function public._prob_nome(uuid, uuid), public._prob_log(uuid, text), public._prob_conduz(prob_problemas) from public, anon, authenticated;

-- 7.1) pessoas que podem ser responsáveis (nome para a tela escolher)
create or replace function public.prob_pessoas(p_empresa uuid)
returns table (user_id uuid, nome text, papel text) language sql stable security definer set search_path = public as $$
  select m.user_id, public._prob_nome(p_empresa, m.user_id), m.papel::text from membros m
   where m.empresa_id = p_empresa and public.prob_ve(p_empresa) and m.papel::text in ('admin', 'financeiro', 'diretor', 'compras', 'vendas', 'producao') order by 2;
$$;

-- 8) parâmetros
create or replace function public.prob_config_salvar(p_empresa uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare cat jsonb := p -> 'categorias'; ar jsonb := p -> 'areas';
begin
  if not public.prob_gerencia(p_empresa) then raise exception 'Só administrador ou diretor altera os parâmetros.'; end if;
  if cat is not null and (jsonb_typeof(cat) <> 'array' or jsonb_array_length(cat) not between 3 and 10) then raise exception 'Informe de 3 a 10 categorias para o Ishikawa.'; end if;
  if ar is not null and (jsonb_typeof(ar) <> 'array' or jsonb_array_length(ar) not between 1 and 30) then raise exception 'Informe de 1 a 30 áreas.'; end if;
  insert into prob_config(empresa_id) values (p_empresa) on conflict (empresa_id) do nothing;
  update prob_config set categorias = coalesce(cat, categorias), areas = coalesce(ar, areas),
    exige_causa = coalesce((p ->> 'exige_causa')::boolean, exige_causa), exige_acao = coalesce((p ->> 'exige_acao')::boolean, exige_acao),
    exige_eficacia = coalesce((p ->> 'exige_eficacia')::boolean, exige_eficacia), dias_aviso = coalesce((p ->> 'dias_aviso')::int, dias_aviso),
    avisar_atraso = coalesce((p ->> 'avisar_atraso')::boolean, avisar_atraso), pareto_corte = coalesce((p ->> 'pareto_corte')::numeric, pareto_corte), atualizado_em = now()
   where empresa_id = p_empresa;
end $$;

-- 9) abrir o problema
create or replace function public.prob_abrir(p_empresa uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; n int; r uuid := nullif(p ->> 'responsavel_id', '')::uuid; eu text := public._prob_nome(p_empresa, auth.uid());
begin
  if not public.prob_pode(p_empresa) then raise exception 'Sem permissão para abrir problema nesta empresa.'; end if;
  if coalesce(length(trim(p ->> 'titulo')), 0) < 5 then raise exception 'Descreva o problema no título (mínimo de 5 letras).'; end if;
  if r is not null and not exists (select 1 from membros where empresa_id = p_empresa and user_id = r) then raise exception 'O responsável precisa ser um usuário desta empresa.'; end if;
  perform pg_advisory_xact_lock(hashtext('prob:' || p_empresa::text));
  select coalesce(max(numero), 0) + 1 into n from prob_problemas where empresa_id = p_empresa;
  insert into prob_problemas(empresa_id, numero, titulo, descricao, area, gravidade, origem_tipo, origem_id, origem_ref, responsavel_id, responsavel_nome, prazo, pareto, porques, causa_raiz, aberto_por_nome)
  values (p_empresa, n, trim(p ->> 'titulo'), nullif(trim(p ->> 'descricao'), ''), coalesce(nullif(trim(p ->> 'area'), ''), 'Outra'), coalesce(nullif(p ->> 'gravidade', ''), 'media'),
    coalesce(nullif(p ->> 'origem_tipo', ''), 'manual'), nullif(p ->> 'origem_id', '')::uuid, nullif(trim(p ->> 'origem_ref'), ''),
    coalesce(r, auth.uid()), public._prob_nome(p_empresa, coalesce(r, auth.uid())), nullif(p ->> 'prazo', '')::date,
    case when jsonb_typeof(p -> 'pareto') = 'object' then p -> 'pareto' end, case when jsonb_typeof(p -> 'porques') = 'array' then p -> 'porques' else '[]'::jsonb end,
    nullif(trim(p ->> 'causa_raiz'), ''), eu)
  returning id into v_id;
  perform public._prob_log(v_id, 'Problema aberto por ' || coalesce(eu, 'usuário') || '.');
  perform public._notificar_u(p_empresa, array[coalesce(r, auth.uid())], 'problema', 'Problema nº ' || n || ' sob sua responsabilidade', trim(p ->> 'titulo'), '#/problemas?id=' || v_id, v_id, false);
  return v_id;
end $$;

-- 10) salvar a análise (dados gerais, Pareto, Ishikawa, 5 porquês, causa raiz)
create or replace function public.prob_salvar(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare x prob_problemas; r uuid; tem boolean; mudou boolean;
begin
  select * into x from prob_problemas where id = p_id for update;
  if x.id is null or not public.prob_pode(x.empresa_id) then raise exception 'Problema não encontrado ou sem permissão.'; end if;
  if x.situacao in ('encerrado', 'cancelado') then raise exception 'Problema % não aceita alteração. Reabra antes.', case x.situacao when 'encerrado' then 'encerrado' else 'cancelado' end; end if;
  if p ? 'titulo' and coalesce(length(trim(p ->> 'titulo')), 0) < 5 then raise exception 'Descreva o problema no título (mínimo de 5 letras).'; end if;
  if p ? 'ishikawa' and jsonb_typeof(p -> 'ishikawa') <> 'array' then raise exception 'Ishikawa inválido.'; end if;
  if p ? 'porques' and jsonb_typeof(p -> 'porques') <> 'array' then raise exception '5 porquês inválidos.'; end if;
  r := case when p ? 'responsavel_id' then nullif(p ->> 'responsavel_id', '')::uuid else x.responsavel_id end;
  mudou := r is distinct from x.responsavel_id;
  if mudou then
    if not public._prob_conduz(x) then raise exception 'Só quem conduz o problema (responsável, quem abriu, administrador ou diretor) troca o responsável.'; end if;
    if r is not null and not exists (select 1 from membros where empresa_id = x.empresa_id and user_id = r) then raise exception 'O responsável precisa ser um usuário desta empresa.'; end if;
  end if;
  update prob_problemas set
    titulo = case when p ? 'titulo' then trim(p ->> 'titulo') else titulo end,
    descricao = case when p ? 'descricao' then nullif(trim(p ->> 'descricao'), '') else descricao end,
    area = case when p ? 'area' then coalesce(nullif(trim(p ->> 'area'), ''), 'Outra') else area end,
    gravidade = case when p ? 'gravidade' then p ->> 'gravidade' else gravidade end,
    prazo = case when p ? 'prazo' then nullif(p ->> 'prazo', '')::date else prazo end,
    responsavel_id = r, responsavel_nome = case when mudou then public._prob_nome(x.empresa_id, r) else responsavel_nome end,
    pareto = case when p ? 'pareto' then (case when jsonb_typeof(p -> 'pareto') = 'object' then p -> 'pareto' end) else pareto end,
    ishikawa = case when p ? 'ishikawa' then p -> 'ishikawa' else ishikawa end,
    porques = case when p ? 'porques' then p -> 'porques' else porques end,
    causa_raiz = case when p ? 'causa_raiz' then nullif(trim(p ->> 'causa_raiz'), '') else causa_raiz end,
    atualizado_em = now()
   where id = p_id returning * into x;
  -- a análise começou: sai de "aberto"
  tem := jsonb_array_length(x.ishikawa) > 0 or jsonb_array_length(x.porques) > 0 or x.causa_raiz is not null or x.pareto is not null;
  if x.situacao = 'aberto' and tem then update prob_problemas set situacao = 'em_analise' where id = p_id; end if;
  if mudou then
    perform public._notificar_u(x.empresa_id, array[r], 'problema', 'Problema nº ' || x.numero || ' sob sua responsabilidade', x.titulo, '#/problemas?id=' || x.id, x.id, false);
    perform public._prob_log(p_id, 'Responsável alterado para ' || coalesce(x.responsavel_nome, '—') || '.');
  end if;
end $$;

-- 11) ação do plano 5W2H: incluir ou alterar
create or replace function public.prob_acao_salvar(p_problema uuid, p_acao uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare x prob_problemas; a prob_acoes; v_id uuid; n int; r uuid := nullif(p ->> 'responsavel_id', '')::uuid; nome text; pz date := nullif(p ->> 'prazo', '')::date;
begin
  select * into x from prob_problemas where id = p_problema for update;
  if x.id is null or not public.prob_pode(x.empresa_id) then raise exception 'Problema não encontrado ou sem permissão.'; end if;
  if x.situacao in ('encerrado', 'cancelado') then raise exception 'Problema encerrado ou cancelado não aceita ação. Reabra antes.'; end if;
  if coalesce(length(trim(p ->> 'o_que')), 0) < 3 then raise exception 'Informe o que será feito.'; end if;
  if pz is null then raise exception 'Informe o prazo da ação.'; end if;
  if r is not null and not exists (select 1 from membros where empresa_id = x.empresa_id and user_id = r) then raise exception 'O responsável precisa ser um usuário desta empresa.'; end if;
  nome := coalesce(public._prob_nome(x.empresa_id, r), nullif(trim(p ->> 'responsavel_nome'), ''));
  if nome is null then raise exception 'Informe quem é o responsável pela ação.'; end if;
  if coalesce((p ->> 'custo_previsto')::numeric, 0) < 0 then raise exception 'O custo não pode ser negativo.'; end if;
  if p_acao is null then
    select coalesce(max(numero), 0) + 1 into n from prob_acoes where problema_id = p_problema;
    insert into prob_acoes(empresa_id, problema_id, numero, o_que, por_que, onde, inicio, prazo, responsavel_id, responsavel_nome, como, custo_previsto)
    values (x.empresa_id, p_problema, n, trim(p ->> 'o_que'), nullif(trim(p ->> 'por_que'), ''), nullif(trim(p ->> 'onde'), ''), nullif(p ->> 'inicio', '')::date, pz, r, nome,
      nullif(trim(p ->> 'como'), ''), coalesce((p ->> 'custo_previsto')::numeric, 0)) returning id into v_id;
    perform public._prob_log(p_problema, 'Ação ' || n || ' incluída: ' || trim(p ->> 'o_que') || ' (' || nome || ', até ' || to_char(pz, 'DD/MM/YYYY') || ').');
    if r is not null then perform public._notificar_u(x.empresa_id, array[r], 'problema', 'Nova ação para você: prazo ' || to_char(pz, 'DD/MM/YYYY'), trim(p ->> 'o_que') || ' — problema nº ' || x.numero || ': ' || x.titulo, '#/problemas?id=' || x.id || '&aba=5w2h', v_id, false); end if;
  else
    select * into a from prob_acoes where id = p_acao and problema_id = p_problema for update;
    if a.id is null then raise exception 'Ação não encontrada.'; end if;
    if a.situacao in ('concluida', 'cancelada') then raise exception 'Ação concluída ou cancelada não é alterada. Reabra a ação antes.'; end if;
    update prob_acoes set o_que = trim(p ->> 'o_que'), por_que = nullif(trim(p ->> 'por_que'), ''), onde = nullif(trim(p ->> 'onde'), ''), inicio = nullif(p ->> 'inicio', '')::date, prazo = pz,
      responsavel_id = r, responsavel_nome = nome, como = nullif(trim(p ->> 'como'), ''), custo_previsto = coalesce((p ->> 'custo_previsto')::numeric, 0),
      lembrado_em = case when pz is distinct from a.prazo then null else lembrado_em end, cobrado_em = case when pz is distinct from a.prazo then null else cobrado_em end, atualizado_em = now()
     where id = p_acao;
    v_id := p_acao;
    if pz is distinct from a.prazo then perform public._prob_log(p_problema, 'Ação ' || a.numero || ': prazo alterado de ' || to_char(a.prazo, 'DD/MM/YYYY') || ' para ' || to_char(pz, 'DD/MM/YYYY') || '.'); end if;
    if r is not null and r is distinct from a.responsavel_id then
      perform public._notificar_u(x.empresa_id, array[r], 'problema', 'Ação passada para você: prazo ' || to_char(pz, 'DD/MM/YYYY'), trim(p ->> 'o_que') || ' — problema nº ' || x.numero || ': ' || x.titulo, '#/problemas?id=' || x.id || '&aba=5w2h', v_id, false);
      perform public._prob_log(p_problema, 'Ação ' || a.numero || ': responsável alterado para ' || nome || '.');
    end if;
  end if;
  update prob_problemas set situacao = 'em_acao', atualizado_em = now() where id = p_problema and situacao in ('aberto', 'em_analise', 'verificacao');
  return v_id;
end $$;

-- 12) andamento da ação: o responsável pela ação ou quem conduz o problema
create or replace function public.prob_acao_situacao(p_acao uuid, p_situacao text, p jsonb default '{}'::jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare a prob_acoes; x prob_problemas; abertas int; feitas int; novo text;
begin
  select * into a from prob_acoes where id = p_acao for update;
  select * into x from prob_problemas where id = a.problema_id for update;
  if a.id is null or not public.prob_pode(a.empresa_id) then raise exception 'Ação não encontrada ou sem permissão.'; end if;
  if not (auth.uid() = a.responsavel_id or public._prob_conduz(x)) then raise exception 'Só o responsável pela ação ou quem conduz o problema muda a situação dela.'; end if;
  if x.situacao in ('encerrado', 'cancelado') then raise exception 'Problema encerrado ou cancelado. Reabra antes.'; end if;
  if p_situacao not in ('pendente', 'em_andamento', 'concluida', 'cancelada') then raise exception 'Situação inválida.'; end if;
  if p_situacao = 'cancelada' and coalesce(length(trim(p ->> 'evidencia')), 0) < 5 then raise exception 'Informe o motivo do cancelamento da ação.'; end if;
  if p_situacao = 'cancelada' and not public._prob_conduz(x) then raise exception 'Só quem conduz o problema cancela uma ação.'; end if;
  update prob_acoes set situacao = p_situacao,
    concluida_em = case when p_situacao = 'concluida' then coalesce(nullif(p ->> 'concluida_em', '')::date, (now() at time zone 'America/Recife')::date) else null end,
    evidencia = case when p ? 'evidencia' then nullif(trim(p ->> 'evidencia'), '') else evidencia end,
    custo_real = case when p ? 'custo_real' then nullif(p ->> 'custo_real', '')::numeric else custo_real end, atualizado_em = now()
   where id = p_acao;
  perform public._prob_log(a.problema_id, 'Ação ' || a.numero || ': ' || case p_situacao when 'concluida' then 'concluída' when 'cancelada' then 'cancelada (' || trim(p ->> 'evidencia') || ')' when 'em_andamento' then 'em andamento' else 'voltou para pendente' end || '.');
  select count(*) filter (where situacao in ('pendente', 'em_andamento')), count(*) filter (where situacao = 'concluida') into abertas, feitas from prob_acoes where problema_id = a.problema_id;
  novo := case when abertas = 0 and feitas > 0 then 'verificacao' when abertas > 0 then 'em_acao' else x.situacao end;
  if novo is distinct from x.situacao then
    update prob_problemas set situacao = novo, atualizado_em = now() where id = x.id;
    if novo = 'verificacao' then
      perform public._prob_log(x.id, 'Todas as ações concluídas: o problema aguarda a verificação da eficácia.');
      perform public._notificar_u(x.empresa_id, array[x.responsavel_id, x.aberto_por], 'problema', 'Problema nº ' || x.numero || ': ações concluídas', 'Verifique a eficácia e encerre: ' || x.titulo, '#/problemas?id=' || x.id || '&aba=fechar', x.id, false);
    end if;
  end if;
  return novo;
end $$;

-- 13) encerrar (com a verificação da eficácia), cancelar e reabrir
create or replace function public.prob_encerrar(p_id uuid, p_eficacia text, p_obs text default null)
returns text language plpgsql security definer set search_path = public as $$
declare x prob_problemas; c prob_config; abertas int; feitas int;
begin
  select * into x from prob_problemas where id = p_id for update;
  if x.id is null or not public._prob_conduz(x) then raise exception 'Só quem conduz o problema (responsável, quem abriu, administrador ou diretor) encerra.'; end if;
  if x.situacao in ('encerrado', 'cancelado') then raise exception 'O problema já está encerrado ou cancelado.'; end if;
  select * into c from prob_config where empresa_id = x.empresa_id;
  select count(*) filter (where situacao in ('pendente', 'em_andamento')), count(*) filter (where situacao = 'concluida') into abertas, feitas from prob_acoes where problema_id = p_id;
  if abertas > 0 then raise exception 'Ainda há % ação(ões) em aberto no plano. Conclua ou cancele antes de encerrar.', abertas; end if;
  if coalesce(c.exige_causa, true) and x.causa_raiz is null then raise exception 'Registre a causa raiz antes de encerrar.'; end if;
  if coalesce(c.exige_acao, true) and feitas = 0 then raise exception 'O plano de ação precisa de ao menos uma ação concluída.'; end if;
  if coalesce(c.exige_eficacia, true) and p_eficacia is null then raise exception 'Informe se as ações foram eficazes.'; end if;
  if p_eficacia is not null and p_eficacia not in ('eficaz', 'nao_eficaz') then raise exception 'Eficácia inválida.'; end if;
  if p_eficacia = 'nao_eficaz' then
    -- não resolveu: o problema volta para a análise, com o registro do que foi verificado
    if coalesce(length(trim(p_obs)), 0) < 5 then raise exception 'Descreva o que foi verificado (por que as ações não resolveram).'; end if;
    update prob_problemas set situacao = 'em_analise', eficacia = 'nao_eficaz', eficacia_obs = trim(p_obs), eficacia_em = (now() at time zone 'America/Recife')::date, atualizado_em = now() where id = p_id;
    perform public._prob_log(p_id, 'Verificação: as ações NÃO foram eficazes. ' || trim(p_obs) || ' O problema voltou para a análise.');
    return 'em_analise';
  end if;
  update prob_problemas set situacao = 'encerrado', eficacia = p_eficacia, eficacia_obs = nullif(trim(p_obs), ''), eficacia_em = case when p_eficacia is not null then (now() at time zone 'America/Recife')::date end,
    encerrado_em = now(), encerrado_por = public._prob_nome(x.empresa_id, auth.uid()), atualizado_em = now() where id = p_id;
  perform public._prob_log(p_id, 'Problema encerrado' || case when p_eficacia = 'eficaz' then ' com as ações eficazes' else '' end || '.' || coalesce(' ' || nullif(trim(p_obs), ''), ''));
  return 'encerrado';
end $$;

create or replace function public.prob_cancelar(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare x prob_problemas;
begin
  select * into x from prob_problemas where id = p_id for update;
  if x.id is null or not public._prob_conduz(x) then raise exception 'Só quem conduz o problema cancela.'; end if;
  if x.situacao in ('encerrado', 'cancelado') then raise exception 'O problema já está encerrado ou cancelado.'; end if;
  if coalesce(length(trim(p_motivo)), 0) < 5 then raise exception 'Informe o motivo do cancelamento.'; end if;
  update prob_acoes set situacao = 'cancelada', evidencia = coalesce(evidencia, 'Problema cancelado.'), atualizado_em = now() where problema_id = p_id and situacao in ('pendente', 'em_andamento');
  update prob_problemas set situacao = 'cancelado', cancelado_motivo = trim(p_motivo), encerrado_em = now(), encerrado_por = public._prob_nome(x.empresa_id, auth.uid()), atualizado_em = now() where id = p_id;
  perform public._prob_log(p_id, 'Problema cancelado: ' || trim(p_motivo));
end $$;

create or replace function public.prob_reabrir(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare x prob_problemas;
begin
  select * into x from prob_problemas where id = p_id for update;
  if x.id is null or not public.prob_gerencia(x.empresa_id) then raise exception 'Só administrador ou diretor reabre um problema.'; end if;
  if x.situacao not in ('encerrado', 'cancelado') then raise exception 'O problema não está encerrado nem cancelado.'; end if;
  if coalesce(length(trim(p_motivo)), 0) < 5 then raise exception 'Informe o motivo da reabertura.'; end if;
  update prob_problemas set situacao = 'em_analise', encerrado_em = null, encerrado_por = null, cancelado_motivo = null, eficacia = null, eficacia_obs = null, eficacia_em = null, atualizado_em = now() where id = p_id;
  perform public._prob_log(p_id, 'Problema reaberto: ' || trim(p_motivo));
end $$;

-- 14) ação concluída ou cancelada volta para pendente (só quem conduz o problema)
create or replace function public.prob_acao_reabrir(p_acao uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a prob_acoes; x prob_problemas;
begin
  select * into a from prob_acoes where id = p_acao for update;
  select * into x from prob_problemas where id = a.problema_id for update;
  if a.id is null or not public._prob_conduz(x) then raise exception 'Só quem conduz o problema reabre uma ação.'; end if;
  if x.situacao in ('encerrado', 'cancelado') then raise exception 'Problema encerrado ou cancelado. Reabra o problema antes.'; end if;
  if a.situacao not in ('concluida', 'cancelada') then raise exception 'A ação não está concluída nem cancelada.'; end if;
  update prob_acoes set situacao = 'pendente', concluida_em = null, lembrado_em = null, cobrado_em = null, atualizado_em = now() where id = p_acao;
  update prob_problemas set situacao = 'em_acao', atualizado_em = now() where id = x.id;
  perform public._prob_log(x.id, 'Ação ' || a.numero || ' reaberta.');
end $$;

-- 15) diário
create or replace function public.prob_comentar(p_id uuid, p_texto text)
returns void language plpgsql security definer set search_path = public as $$
declare x prob_problemas;
begin
  select * into x from prob_problemas where id = p_id;
  if x.id is null or not public.prob_pode(x.empresa_id) then raise exception 'Problema não encontrado ou sem permissão.'; end if;
  if coalesce(length(trim(p_texto)), 0) < 2 then raise exception 'Escreva o comentário.'; end if;
  insert into prob_diario(empresa_id, problema_id, tipo, texto, autor) values (x.empresa_id, p_id, 'comentario', trim(p_texto), public._prob_nome(x.empresa_id, auth.uid()));
  perform public._notificar_u(x.empresa_id, array[x.responsavel_id, x.aberto_por], 'problema', 'Comentário no problema nº ' || x.numero, left(trim(p_texto), 140), '#/problemas?id=' || x.id || '&aba=diario', x.id, false);
end $$;

-- 16) Pareto com o dado da plataforma: devolve categoria, valor (na unidade da fonte) e quantidade de ocorrências
create or replace function public.prob_pareto(p_empresa uuid, p_fonte text, p_de date, p_ate date)
returns table (nome text, valor numeric, qtd bigint) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.prob_ve(p_empresa) then raise exception 'Sem permissão.'; end if;
  if p_de is null or p_ate is null or p_ate < p_de then raise exception 'Período inválido.'; end if;
  if p_fonte = 'paradas' then          -- horas de máquina parada por motivo (paradas não planejadas)
    return query select coalesce(m.nome, 'Sem motivo informado'), round(sum(extract(epoch from (coalesce(p.fim, now()) - p.inicio)) / 3600.0)::numeric, 1), count(*)
      from prod_paradas p left join prod_motivos m on m.id = p.motivo_id
     where p.empresa_id = p_empresa and p.inicio >= p_de and p.inicio < p_ate + 1 and not coalesce(m.planejada, false) group by 1;
  elsif p_fonte = 'refugos' then       -- kg de refugo por motivo
    return query select coalesce(m.nome, 'Sem motivo informado'), round(sum(a.refugo), 1), count(*)
      from prod_apontamentos a left join prod_motivos m on m.id = a.refugo_motivo_id
     where a.empresa_id = p_empresa and a.inicio >= p_de and a.inicio < p_ate + 1 and a.refugo > 0 group by 1;
  elsif p_fonte = 'falhas' then        -- ordens corretivas de manutenção por tipo de falha
    return query select coalesce(f.nome, 'Sem falha informada'), count(*)::numeric, count(*)
      from man_ordens o left join man_falhas f on f.id = o.falha_id
     where o.empresa_id = p_empresa and o.tipo = 'corretiva' and o.situacao <> 'cancelada' and o.solicitada_em >= p_de and o.solicitada_em < p_ate + 1 group by 1;
  elsif p_fonte = 'rnc_produto' then   -- não conformidades por produto
    return query select coalesce(pr.descricao, 'Sem produto'), count(*)::numeric, count(*)
      from qual_rnc r left join produtos pr on pr.id = r.produto_id
     where r.empresa_id = p_empresa and r.situacao <> 'cancelada' and r.aberta_em >= p_de and r.aberta_em < p_ate + 1 group by 1;
  elsif p_fonte = 'rnc_custo' then     -- custo da não qualidade por origem da RNC
    return query select case r.origem when 'inspecao' then 'Inspeção' when 'processo' then 'Processo' when 'cliente' then 'Cliente' when 'fornecedor' then 'Fornecedor' when 'auditoria' then 'Auditoria' else 'Interna' end,
        round(sum(r.custo), 2), count(*)
      from qual_rnc r where r.empresa_id = p_empresa and r.situacao <> 'cancelada' and r.aberta_em >= p_de and r.aberta_em < p_ate + 1 group by 1 having sum(r.custo) > 0;
  elsif p_fonte = 'devolucoes' then    -- valor das notas de devolução por cliente
    return query select coalesce(nullif(case when n.emissao_propria then n.dest_nome else n.emit_nome end, ''), 'Sem nome'), round(sum(n.v_nf), 2), count(*)
      from nfe_notas n where n.empresa_id = p_empresa and n.finalidade = '4' and n.tipo = 'entrada' and n.situacao = 'autorizada' and n.emissao >= p_de and n.emissao <= p_ate group by 1;
  elsif p_fonte = 'vencidos' then      -- títulos a receber vencidos e em aberto, por cliente (vencimento no período)
    if not exists (select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor')) then raise exception 'Esta fonte é do financeiro: só administrador, financeiro ou diretor consulta.'; end if;
    return query select coalesce(f.nome, 'Sem cliente'), round(sum(l.valor), 2), count(*)
      from lancamentos l join plano_contas pc on pc.id = l.plano_id left join favorecidos f on f.id = l.favorecido_id
     where l.empresa_id = p_empresa and l.status = 'Em aberto' and pc.tipo = 'E' and l.data >= p_de and l.data <= least(p_ate, (now() at time zone 'America/Recife')::date - 1) group by 1;
  else raise exception 'Fonte de dados desconhecida.';
  end if;
end $$;

-- 17) avisos de prazo: lembrete N dias antes e cobrança do atraso (dia seguinte ao prazo e depois toda segunda-feira)
create or replace function public._prob_avisos()
returns int language plpgsql security definer set search_path = public as $$
declare a record; hoje date := (now() at time zone 'America/Recife')::date; n int := 0;
begin
  for a in select ac.*, p.numero as pnum, p.titulo, p.responsavel_id as dono, coalesce(c.dias_aviso, 2) as dias, coalesce(c.avisar_atraso, true) as cobra
             from prob_acoes ac join prob_problemas p on p.id = ac.problema_id left join prob_config c on c.empresa_id = ac.empresa_id
            where ac.situacao in ('pendente', 'em_andamento') and p.situacao not in ('encerrado', 'cancelado') loop
    if a.prazo >= hoje and a.prazo - hoje <= a.dias and a.lembrado_em is null and a.responsavel_id is not null then
      insert into notificacoes(empresa_id, user_id, tipo, titulo, corpo, link, ref_id)
      values (a.empresa_id, a.responsavel_id, 'problema', case when a.prazo = hoje then 'Ação vence hoje' else 'Ação vence em ' || to_char(a.prazo, 'DD/MM') end, a.o_que || ' — problema nº ' || a.pnum || ': ' || a.titulo, '#/problemas?id=' || a.problema_id || '&aba=5w2h', a.id);
      update prob_acoes set lembrado_em = hoje where id = a.id; n := n + 1;
    elsif a.prazo < hoje and a.cobra and (a.cobrado_em is null or (extract(isodow from hoje) = 1 and a.cobrado_em < hoje)) then
      insert into notificacoes(empresa_id, user_id, tipo, titulo, corpo, link, ref_id, urgente)
      select a.empresa_id, u, 'problema', 'Ação atrasada há ' || (hoje - a.prazo) || ' dia(s)', a.o_que || ' (' || a.responsavel_nome || ') — problema nº ' || a.pnum || ': ' || a.titulo, '#/problemas?id=' || a.problema_id || '&aba=5w2h', a.id, false
        from (select distinct unnest(array[a.responsavel_id, a.dono]) u) x where u is not null;
      update prob_acoes set cobrado_em = hoje where id = a.id; n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public._prob_avisos() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('problemas-avisos') where exists (select 1 from cron.job where jobname = 'problemas-avisos');
    perform cron.schedule('problemas-avisos', '17 10 * * *', 'select public._prob_avisos()');   -- 07:17 em Recife, todos os dias
  end if;
end $$;

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('problema', 'Gestão', 'Análise de problemas', 'Problema ou ação sob sua responsabilidade, prazo chegando, ação atrasada, ações concluídas e comentários.', false, 44)
on conflict (codigo) do nothing;

do $$ declare f text; begin
  foreach f in array array['prob_config_salvar(uuid, jsonb)', 'prob_abrir(uuid, jsonb)', 'prob_salvar(uuid, jsonb)', 'prob_acao_salvar(uuid, uuid, jsonb)', 'prob_acao_situacao(uuid, text, jsonb)',
    'prob_encerrar(uuid, text, text)', 'prob_cancelar(uuid, text)', 'prob_reabrir(uuid, text)', 'prob_acao_reabrir(uuid)', 'prob_comentar(uuid, text)', 'prob_pareto(uuid, text, date, date)', 'prob_pessoas(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
