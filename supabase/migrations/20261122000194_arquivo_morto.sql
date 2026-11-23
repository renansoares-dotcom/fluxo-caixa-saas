-- 194 — Arquivo Morto (22/11/2026, Renan: "Temos também os arquivos mortos do administrativo, financeiro, fiscal/contábil, RH…
-- Queria essa organização também"). Decisões: caixas-arquivo em estantes; registrar quem levou e quando devolve; prazo de guarda
-- com aprovação e termo de descarte; começa em 01/12, junto com o almoxarifado.
--   1. Salas e endereços (estante, prateleira, nível) com etiqueta de prateleira S0000000.
--   2. Caixa-arquivo numerada por empresa, com etiqueta C0000000, área, setor, endereço e o conteúdo (tipo de documento e período).
--   3. Tipos de documento com prazo de guarda. Os prazos vêm como SUGESTÃO e só valem para descarte depois de confirmados por
--      quem aprova o descarte (a contabilidade/jurídico confirma). Sem prazo = guarda permanente.
--   4. Retirada: pedido de quem consulta, retirada e devolução registradas por quem cuida do arquivo, com prazo de devolução.
--   5. Descarte: proposta (só caixas vencidas, sem retenção), aprovação por outra pessoa, execução com data, forma e responsável,
--      e termo de descarte. Parâmetro para suspender todo descarte (ex.: processo judicial em andamento).
--   6. Caixas do RH só aparecem para quem vê o RH, para o administrador, o diretor e quem cuida do arquivo.
-- Aditivo.

-- ------------------------------------------------------------ parâmetros
create table if not exists public.arq_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  papeis_gestor text[] not null default '{admin,financeiro,diretor}',     -- cuidam do arquivo: cadastram caixas, registram retirada e devolução
  arquivistas uuid[] not null default '{}',                               -- pessoas que cuidam do arquivo além dos perfis
  papeis_consulta text[] not null default '{admin,financeiro,diretor,compras}',   -- consultam e pedem caixas
  papeis_descarte text[] not null default '{admin,diretor}',              -- confirmam prazos e aprovam o descarte
  emprestimo_dias int not null default 7 check (emprestimo_dias between 1 and 90),
  descarte_suspenso boolean not null default false,                        -- nada é descartado enquanto ligado
  descarte_suspenso_motivo text check (length(descarte_suspenso_motivo) <= 300),
  atualizado_em timestamptz not null default now()
);

create or replace function public._arq_cfg(p_empresa uuid) returns public.arq_config
language sql stable security definer set search_path = public as $$
  select coalesce((select c from arq_config c where c.empresa_id = p_empresa), row(p_empresa, '{admin,financeiro,diretor}', '{}', '{admin,financeiro,diretor,compras}', '{admin,diretor}', 7, false, null, now())::arq_config);
$$;
create or replace function public._arq_papel(p_empresa uuid) returns text
language sql stable security definer set search_path = public as $$
  select papel::text from membros where empresa_id = p_empresa and user_id = auth.uid() limit 1;
$$;
create or replace function public._arq_gestor(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public._arq_papel(p_empresa) = any((public._arq_cfg(p_empresa)).papeis_gestor)
     or (public._arq_papel(p_empresa) is not null and auth.uid() = any((public._arq_cfg(p_empresa)).arquivistas)), false);
$$;
create or replace function public._arq_consulta(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public._arq_gestor(p_empresa) or public._arq_papel(p_empresa) = any((public._arq_cfg(p_empresa)).papeis_consulta), false);
$$;
create or replace function public._arq_aprova(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public._arq_papel(p_empresa) = any((public._arq_cfg(p_empresa)).papeis_descarte), false);
$$;
-- quem vê uma caixa da área: RH só para quem vê o RH, o administrador, o diretor e as pessoas nomeadas para cuidar do arquivo
-- (o perfil que cuida do arquivo, sozinho, não abre as caixas do RH)
create or replace function public._arq_ve(p_empresa uuid, p_area text) returns boolean
language sql stable security definer set search_path = public as $$
  select public._arq_consulta(p_empresa) and (p_area <> 'rh' or public._arq_papel(p_empresa) in ('admin', 'diretor')
    or auth.uid() = any((public._arq_cfg(p_empresa)).arquivistas) or public.ve_rh(p_empresa));
$$;

-- ------------------------------------------------------------ tipos de documento e prazo de guarda
create table if not exists public.arq_tipos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  area text not null check (area in ('administrativo', 'financeiro', 'fiscal', 'contabil', 'rh', 'juridico', 'comercial', 'compras', 'outro')),
  nome text not null check (length(nome) between 2 and 80),
  prazo_anos int check (prazo_anos between 1 and 100),          -- nulo = guarda permanente
  prazo_confirmado boolean not null default false,               -- sugestão até alguém que aprova o descarte confirmar
  confirmado_por uuid, confirmado_nome text, confirmado_em timestamptz,
  observacao text check (length(observacao) <= 300),             -- fundamento informado por quem confirmou
  ativo boolean not null default true,
  unique (empresa_id, area, nome)
);

-- ------------------------------------------------------------ salas e endereços
create table if not exists public.arq_locais (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null check (length(nome) between 2 and 60),
  ativo boolean not null default true,
  unique (empresa_id, nome)
);
create table if not exists public.arq_enderecos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  local_id uuid not null references public.arq_locais(id) on delete cascade,
  codigo text not null check (codigo ~ '^[A-Z0-9]([A-Z0-9.-]{0,18}[A-Z0-9])?$'),
  ordem int not null default 0,
  descricao text check (length(descricao) <= 80),
  etiqueta text not null default ('S' || lpad(nextval('public.etiqueta_seq')::text, 7, '0')),
  ativo boolean not null default true,
  unique (local_id, codigo)
);
create unique index if not exists arq_enderecos_etiqueta on public.arq_enderecos (etiqueta);
drop trigger if exists arq_enderecos_etq_fixa on public.arq_enderecos;
create trigger arq_enderecos_etq_fixa before update of etiqueta on public.arq_enderecos for each row execute function public._etq_fixa();

-- ------------------------------------------------------------ caixas e conteúdo
create table if not exists public.arq_caixas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  etiqueta text not null default ('C' || lpad(nextval('public.etiqueta_seq')::text, 7, '0')),
  area text not null check (area in ('administrativo', 'financeiro', 'fiscal', 'contabil', 'rh', 'juridico', 'comercial', 'compras', 'outro')),
  setor text check (length(setor) <= 60),
  titulo text not null check (length(titulo) between 2 and 120),
  endereco_id uuid references public.arq_enderecos(id) on delete set null,
  periodo_inicio date, periodo_fim date,
  descartar_em date,                       -- quando a caixa inteira pode ser descartada (nulo: guarda permanente ou sem conteúdo)
  permanente boolean not null default false,
  prazo_pendente boolean not null default false,   -- algum tipo da caixa ainda sem prazo confirmado
  reter boolean not null default false, reter_motivo text check (length(reter_motivo) <= 300),   -- retenção: não entra no descarte
  situacao text not null default 'arquivada' check (situacao in ('arquivada', 'emprestada', 'descartada')),
  observacao text check (length(observacao) <= 300),
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create unique index if not exists arq_caixas_etiqueta on public.arq_caixas (etiqueta);
create index if not exists arq_caixas_end on public.arq_caixas (endereco_id);
drop trigger if exists arq_caixas_etq_fixa on public.arq_caixas;
create trigger arq_caixas_etq_fixa before update of etiqueta on public.arq_caixas for each row execute function public._etq_fixa();

create table if not exists public.arq_itens (
  id uuid primary key default gen_random_uuid(),
  caixa_id uuid not null references public.arq_caixas(id) on delete cascade,
  empresa_id uuid not null,
  tipo_id uuid not null references public.arq_tipos(id),
  descricao text check (length(descricao) <= 200),
  inicio date not null, fim date not null check (fim >= inicio),
  ordem int not null default 0
);
create index if not exists arq_itens_caixa on public.arq_itens (caixa_id);

-- ------------------------------------------------------------ retiradas
create table if not exists public.arq_emprestimos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  caixa_id uuid not null references public.arq_caixas(id) on delete cascade,
  situacao text not null default 'pedido' check (situacao in ('pedido', 'retirada', 'devolvida', 'cancelado')),
  pedido_por uuid, pedido_nome text, pedido_em timestamptz,
  motivo text check (length(motivo) <= 300),
  para_id uuid, para_nome text,                         -- quem levou
  retirado_por uuid, retirado_nome text, retirado_em timestamptz, previsto date,
  devolvido_por uuid, devolvido_nome text, devolvido_em timestamptz,
  cancelado_motivo text check (length(cancelado_motivo) <= 300)
);
create index if not exists arq_emprestimos_caixa on public.arq_emprestimos (caixa_id);
create unique index if not exists arq_emprestimos_aberto on public.arq_emprestimos (caixa_id) where situacao = 'retirada';

-- ------------------------------------------------------------ descartes
create table if not exists public.arq_descartes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  situacao text not null default 'proposto' check (situacao in ('proposto', 'aprovado', 'recusado', 'executado', 'cancelado')),
  proposto_por uuid, proposto_nome text, proposto_em timestamptz not null default now(), observacao text check (length(observacao) <= 300),
  decidido_por uuid, decidido_nome text, decidido_em timestamptz, motivo text check (length(motivo) <= 300),
  executado_em date, forma text check (forma in ('fragmentacao', 'reciclagem', 'incineracao', 'empresa_especializada')),
  responsavel text check (length(responsavel) <= 120), testemunha text check (length(testemunha) <= 120),
  registrado_por uuid, registrado_nome text, registrado_em timestamptz,
  unique (empresa_id, numero)
);
create table if not exists public.arq_descarte_caixas (
  descarte_id uuid not null references public.arq_descartes(id) on delete cascade,
  caixa_id uuid not null references public.arq_caixas(id),
  primary key (descarte_id, caixa_id)
);

-- ------------------------------------------------------------ acesso: leitura por política; escrita só pelas funções
do $$ declare t text; begin
  foreach t in array array['arq_config', 'arq_tipos', 'arq_locais', 'arq_enderecos', 'arq_caixas', 'arq_itens', 'arq_emprestimos', 'arq_descartes', 'arq_descarte_caixas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
  end loop;
end $$;
create policy arq_config_ler on public.arq_config for select to authenticated using (public._arq_consulta(empresa_id));
create policy arq_tipos_ler on public.arq_tipos for select to authenticated using (public._arq_consulta(empresa_id));
create policy arq_locais_ler on public.arq_locais for select to authenticated using (public._arq_consulta(empresa_id));
create policy arq_enderecos_ler on public.arq_enderecos for select to authenticated using (public._arq_consulta(empresa_id));
create policy arq_caixas_ler on public.arq_caixas for select to authenticated using (public._arq_ve(empresa_id, area));
create policy arq_itens_ler on public.arq_itens for select to authenticated using (exists (select 1 from public.arq_caixas c where c.id = caixa_id));
create policy arq_emprestimos_ler on public.arq_emprestimos for select to authenticated using (exists (select 1 from public.arq_caixas c where c.id = caixa_id));
create policy arq_descartes_ler on public.arq_descartes for select to authenticated using (public._arq_gestor(empresa_id) or public._arq_aprova(empresa_id));
create policy arq_descarte_caixas_ler on public.arq_descarte_caixas for select to authenticated using (exists (select 1 from public.arq_descartes d where d.id = descarte_id));

-- ------------------------------------------------------------ funções internas
create or replace function public._arq_nome() returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim((select m.nome from membros m where m.user_id = auth.uid() and m.nome is not null limit 1)), ''), split_part((select email from auth.users where id = auth.uid()), '@', 1));
$$;

-- a partir de quando o item pode ser descartado: 1º de janeiro do ano seguinte ao fim do período, mais o prazo
create or replace function public._arq_descarte_item(p_prazo int, p_fim date) returns date language sql immutable as $$
  select case when p_prazo is null then null else make_date(extract(year from p_fim)::int + 1 + p_prazo, 1, 1) end;
$$;

-- recalcula período, data de descarte e pendência de prazo das caixas
create or replace function public._arq_recalc(p_caixas uuid[]) returns void language plpgsql security definer set search_path = public as $$
begin
  update arq_caixas c set periodo_inicio = x.ini, periodo_fim = x.fim, permanente = coalesce(x.perm, false), prazo_pendente = coalesce(x.pend, false),
         descartar_em = case when coalesce(x.perm, false) or x.n = 0 then null else x.dsc end
    from (select c2.id, min(i.inicio) ini, max(i.fim) fim, bool_or(t.prazo_anos is null) perm, bool_or(not t.prazo_confirmado) pend, count(i.id) n,
                 max(public._arq_descarte_item(t.prazo_anos, i.fim)) dsc
            from arq_caixas c2 left join arq_itens i on i.caixa_id = c2.id left join arq_tipos t on t.id = i.tipo_id
           where c2.id = any(p_caixas) group by c2.id) x
   where c.id = x.id;
end $$;

-- por que a caixa não pode ser descartada hoje (nulo = pode)
create or replace function public._arq_impede(c arq_caixas) returns text language sql stable security definer set search_path = public as $$
  select case
    when c.situacao = 'descartada' then 'já descartada'
    when c.situacao = 'emprestada' then 'está retirada'
    when c.reter then 'retida: ' || coalesce(c.reter_motivo, 'sem motivo')
    when not exists (select 1 from arq_itens i where i.caixa_id = c.id) then 'sem conteúdo registrado'
    when c.permanente then 'tem documento de guarda permanente'
    when c.prazo_pendente then 'prazo de guarda ainda não confirmado'
    when c.descartar_em > current_date then 'guarda até ' || to_char(c.descartar_em - 1, 'DD/MM/YYYY')
    when (public._arq_cfg(c.empresa_id)).descarte_suspenso then 'descarte suspenso nos parâmetros'
  end;
$$;

-- ------------------------------------------------------------ parâmetros e tipos
create or replace function public.arq_config_salvar(p_empresa uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_pap text[] := array['admin', 'financeiro', 'diretor', 'compras', 'producao', 'vendas', 'leitura'];
  g text[] := case when p ? 'papeis_gestor' then array(select jsonb_array_elements_text(p->'papeis_gestor')) else '{admin,financeiro,diretor}' end;
  cs text[] := case when p ? 'papeis_consulta' then array(select jsonb_array_elements_text(p->'papeis_consulta')) else '{admin,financeiro,diretor,compras}' end;
  d text[] := case when p ? 'papeis_descarte' then array(select jsonb_array_elements_text(p->'papeis_descarte')) else '{admin,diretor}' end;
  a uuid[] := case when p ? 'arquivistas' then array(select (jsonb_array_elements_text(p->'arquivistas'))::uuid) else '{}' end;
  v_dias int := coalesce((p->>'emprestimo_dias')::int, 7); v_susp boolean := coalesce((p->>'descarte_suspenso')::boolean, false);
begin
  if public._arq_papel(p_empresa) <> 'admin' or public._arq_papel(p_empresa) is null then raise exception 'Só o administrador muda os parâmetros do arquivo.'; end if;
  if not (g <@ v_pap and cs <@ v_pap and d <@ v_pap) then raise exception 'Perfil inválido.'; end if;
  if cardinality(g) = 0 then raise exception 'Escolha pelo menos um perfil que cuida do arquivo.'; end if;
  if cardinality(d) = 0 or not (d && array['admin', 'diretor']) then raise exception 'O descarte precisa ser aprovado pelo administrador ou pelo diretor (inclua pelo menos um).'; end if;
  if exists (select 1 from unnest(a) x where not exists (select 1 from membros m where m.empresa_id = p_empresa and m.user_id = x)) then raise exception 'Pessoa que não é da empresa na lista de quem cuida do arquivo.'; end if;
  if v_dias < 1 or v_dias > 90 then raise exception 'Prazo de devolução: de 1 a 90 dias.'; end if;
  if v_susp and length(btrim(coalesce(p->>'descarte_suspenso_motivo', ''))) < 5 then raise exception 'Informe o motivo da suspensão do descarte.'; end if;
  insert into arq_config (empresa_id, papeis_gestor, arquivistas, papeis_consulta, papeis_descarte, emprestimo_dias, descarte_suspenso, descarte_suspenso_motivo)
    values (p_empresa, g, a, cs, d, v_dias, v_susp, nullif(btrim(coalesce(p->>'descarte_suspenso_motivo', '')), ''))
  on conflict (empresa_id) do update set papeis_gestor = excluded.papeis_gestor, arquivistas = excluded.arquivistas, papeis_consulta = excluded.papeis_consulta,
    papeis_descarte = excluded.papeis_descarte, emprestimo_dias = excluded.emprestimo_dias, descarte_suspenso = excluded.descarte_suspenso,
    descarte_suspenso_motivo = excluded.descarte_suspenso_motivo, atualizado_em = now();
end $$;

-- tipos sugeridos (prazo a confirmar pela contabilidade/jurídico). Idempotente: só cria o que falta.
create or replace function public.arq_configurar(p_empresa uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public._arq_gestor(p_empresa) then raise exception 'Só quem cuida do arquivo prepara os tipos de documento.'; end if;
  insert into arq_tipos (empresa_id, area, nome, prazo_anos)
  select p_empresa, a, n, p from (values
    ('fiscal', 'Notas fiscais de entrada e saída', 5), ('fiscal', 'Livros e apurações fiscais', 5), ('fiscal', 'Guias de recolhimento de tributos', 5),
    ('contabil', 'Livros contábeis e balanços', 10), ('contabil', 'Conciliações e documentos de apoio da contabilidade', 10),
    ('financeiro', 'Comprovantes de pagamento e recebimento', 5), ('financeiro', 'Extratos bancários', 5), ('financeiro', 'Contratos de empréstimo e financiamento', 5),
    ('rh', 'Registro de empregados (livro ou fichas)', null), ('rh', 'Folha de pagamento e recibos', 10), ('rh', 'Cartões de ponto', 5),
    ('rh', 'Rescisões', 5), ('rh', 'FGTS e encargos', 5), ('rh', 'Saúde e segurança do trabalho (ASO, PPP, laudos)', 20),
    ('administrativo', 'Contratos com clientes e fornecedores', 5), ('administrativo', 'Correspondência e documentos gerais', 5),
    ('juridico', 'Processos judiciais e administrativos', null), ('compras', 'Pedidos e cotações de compra', 5), ('comercial', 'Pedidos de venda e propostas', 5),
    ('outro', 'Outros documentos', null)) v(a, n, p)
  on conflict (empresa_id, area, nome) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- criar ou alterar tipo. Mudar o prazo desfaz a confirmação; confirmar é de quem aprova o descarte.
create or replace function public.arq_tipo_salvar(p_empresa uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare t arq_tipos; v_id uuid := nullif(p->>'id', '')::uuid; v_prazo int := nullif(p->>'prazo_anos', '')::int;
  v_conf boolean := coalesce((p->>'prazo_confirmado')::boolean, false);
begin
  if not public._arq_gestor(p_empresa) and not public._arq_aprova(p_empresa) then raise exception 'Sem permissão para os tipos de documento.'; end if;
  if v_prazo is not null and (v_prazo < 1 or v_prazo > 100) then raise exception 'Prazo de guarda: de 1 a 100 anos (vazio = permanente).'; end if;
  if v_conf and not public._arq_aprova(p_empresa) and not exists (select 1 from arq_tipos where id = v_id and prazo_confirmado and prazo_anos is not distinct from v_prazo) then
    raise exception 'Só quem aprova o descarte confirma o prazo de guarda.'; end if;
  if v_id is not null then
    select * into t from arq_tipos where id = v_id and empresa_id = p_empresa for update;
    if not found then raise exception 'Tipo não encontrado.'; end if;
    -- prazo igual e sem pedido de (des)confirmação: a confirmação fica como está
    if t.prazo_anos is not distinct from v_prazo and not (p ? 'prazo_confirmado' and public._arq_aprova(p_empresa)) then v_conf := t.prazo_confirmado; end if;
    update arq_tipos set area = coalesce(p->>'area', area), nome = coalesce(nullif(btrim(p->>'nome'), ''), nome), prazo_anos = v_prazo,
           observacao = nullif(btrim(coalesce(p->>'observacao', '')), ''), ativo = coalesce((p->>'ativo')::boolean, ativo),
           prazo_confirmado = v_conf,
           confirmado_por = case when not v_conf then null when v_conf = t.prazo_confirmado and t.prazo_anos is not distinct from v_prazo then t.confirmado_por else auth.uid() end,
           confirmado_nome = case when not v_conf then null when v_conf = t.prazo_confirmado and t.prazo_anos is not distinct from v_prazo then t.confirmado_nome else public._arq_nome() end,
           confirmado_em = case when not v_conf then null when v_conf = t.prazo_confirmado and t.prazo_anos is not distinct from v_prazo then t.confirmado_em else now() end
     where id = v_id;
  else
    insert into arq_tipos (empresa_id, area, nome, prazo_anos, observacao, prazo_confirmado, confirmado_por, confirmado_nome, confirmado_em)
      values (p_empresa, p->>'area', btrim(p->>'nome'), v_prazo, nullif(btrim(coalesce(p->>'observacao', '')), ''), v_conf,
              case when v_conf then auth.uid() end, case when v_conf then public._arq_nome() end, case when v_conf then now() end)
      returning id into v_id;
  end if;
  perform public._arq_recalc(array(select distinct i.caixa_id from arq_itens i where i.tipo_id = v_id));
  return v_id;
end $$;

-- ------------------------------------------------------------ salas e endereços
create or replace function public.arq_local_salvar(p_empresa uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if not public._arq_gestor(p_empresa) then raise exception 'Só quem cuida do arquivo cadastra as salas.'; end if;
  if v_id is null then insert into arq_locais (empresa_id, nome) values (p_empresa, btrim(p->>'nome')) returning id into v_id;
  else update arq_locais set nome = coalesce(nullif(btrim(p->>'nome'), ''), nome), ativo = coalesce((p->>'ativo')::boolean, ativo) where id = v_id and empresa_id = p_empresa;
    if not found then raise exception 'Sala não encontrada.'; end if; end if;
  return v_id;
end $$;

create or replace function public.arq_end_gerar(p_empresa uuid, p_local uuid, p_estantes text[], p_prateleiras int, p_niveis int, p_digitos int default 2)
returns int language plpgsql security definer set search_path = public as $$
declare e text; pr int; nv int; v_ordem int; v_cod text; v_n int := 0; v_est text[];
begin
  if not public._arq_gestor(p_empresa) then raise exception 'Só quem cuida do arquivo gera endereços.'; end if;
  if not exists (select 1 from arq_locais where id = p_local and empresa_id = p_empresa and ativo) then raise exception 'Sala não encontrada.'; end if;
  select array_agg(distinct upper(btrim(x))) into v_est from unnest(p_estantes) x where btrim(coalesce(x, '')) <> '';
  if v_est is null then raise exception 'Informe pelo menos uma estante.'; end if;
  if exists (select 1 from unnest(v_est) x where x !~ '^[A-Z0-9]{1,6}$') then raise exception 'Estante: use letras e números, até 6 caracteres.'; end if;
  if p_prateleiras is null or p_prateleiras < 1 or p_prateleiras > 99 then raise exception 'Prateleiras por estante: de 1 a 99.'; end if;
  if p_niveis is null or p_niveis < 0 or p_niveis > 20 then raise exception 'Níveis por prateleira: de 0 a 20.'; end if;
  if p_digitos is null or p_digitos not in (1, 2, 3) or length(p_prateleiras::text) > p_digitos then raise exception 'Dígitos da prateleira insuficientes.'; end if;
  if array_length(v_est, 1) * p_prateleiras * greatest(p_niveis, 1) > 3000 then raise exception 'Muitos endereços de uma vez (máximo 3.000).'; end if;
  perform pg_advisory_xact_lock(hashtext('arq_end:' || p_local::text));
  select coalesce(max(ordem), 0) into v_ordem from arq_enderecos where local_id = p_local;
  foreach e in array (select array_agg(x order by x) from unnest(v_est) x) loop
    for pr in 1 .. p_prateleiras loop
      for nv in 1 .. greatest(p_niveis, 1) loop
        v_cod := e || '-' || lpad(pr::text, p_digitos, '0') || case when p_niveis > 0 then '-' || nv else '' end;
        v_ordem := v_ordem + 10;
        insert into arq_enderecos (empresa_id, local_id, codigo, ordem) values (p_empresa, p_local, v_cod, v_ordem) on conflict (local_id, codigo) do nothing;
        if found then v_n := v_n + 1; end if;
      end loop;
    end loop;
  end loop;
  return v_n;
end $$;

create or replace function public.arq_end_salvar(p_empresa uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v arq_enderecos;
begin
  if not public._arq_gestor(p_empresa) then raise exception 'Só quem cuida do arquivo altera endereços.'; end if;
  select * into v from arq_enderecos where id = (p->>'id')::uuid and empresa_id = p_empresa for update;
  if not found then raise exception 'Endereço não encontrado.'; end if;
  if not coalesce((p->>'ativo')::boolean, true) and exists (select 1 from arq_caixas where endereco_id = v.id and situacao <> 'descartada') then
    raise exception 'O endereço % tem caixas. Mude as caixas antes de desativá-lo.', v.codigo; end if;
  update arq_enderecos set descricao = nullif(btrim(coalesce(p->>'descricao', '')), ''), ordem = coalesce((p->>'ordem')::int, ordem), ativo = coalesce((p->>'ativo')::boolean, ativo) where id = v.id;
end $$;

-- ------------------------------------------------------------ caixas
-- p = { id?, area, setor, titulo, endereco_id, observacao, reter, reter_motivo, itens: [{ tipo_id, descricao, inicio, fim }] } (os itens substituem os anteriores)
create or replace function public.arq_caixa_salvar(p_empresa uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare c arq_caixas; v_id uuid := nullif(p->>'id', '')::uuid; it jsonb; v_k int := 0; v_area text := p->>'area'; v_end uuid := nullif(p->>'endereco_id', '')::uuid;
  v_reter boolean := coalesce((p->>'reter')::boolean, false);
begin
  if not public._arq_gestor(p_empresa) then raise exception 'Só quem cuida do arquivo cadastra caixas.'; end if;
  if v_area is null or v_area not in ('administrativo', 'financeiro', 'fiscal', 'contabil', 'rh', 'juridico', 'comercial', 'compras', 'outro') then raise exception 'Escolha a área da caixa.'; end if;
  if not public._arq_ve(p_empresa, v_area) then raise exception 'Caixas do RH: só quem vê o RH, o administrador, o diretor ou quem foi nomeado para cuidar do arquivo.'; end if;
  if length(btrim(coalesce(p->>'titulo', ''))) < 2 then raise exception 'Informe o título da caixa (o que ela guarda).'; end if;
  if v_end is not null and not exists (select 1 from arq_enderecos where id = v_end and empresa_id = p_empresa and ativo) then raise exception 'Endereço não encontrado ou inativo.'; end if;
  if v_reter and length(btrim(coalesce(p->>'reter_motivo', ''))) < 5 then raise exception 'Informe o motivo da retenção.'; end if;
  if jsonb_typeof(coalesce(p->'itens', '[]')) <> 'array' or jsonb_array_length(coalesce(p->'itens', '[]')) > 200 then raise exception 'Conteúdo inválido (máximo 200 linhas por caixa).'; end if;
  for it in select * from jsonb_array_elements(coalesce(p->'itens', '[]')) loop
    if not exists (select 1 from arq_tipos t where t.id = nullif(it->>'tipo_id', '')::uuid and t.empresa_id = p_empresa) then raise exception 'Tipo de documento não encontrado (linha %).', v_k + 1; end if;
    if nullif(it->>'inicio', '') is null or nullif(it->>'fim', '') is null or (it->>'fim')::date < (it->>'inicio')::date then raise exception 'Período inválido na linha % do conteúdo.', v_k + 1; end if;
    if (it->>'inicio')::date < date '1900-01-01' or (it->>'fim')::date > current_date + 366 then raise exception 'Período fora da faixa na linha %.', v_k + 1; end if;
    v_k := v_k + 1;
  end loop;
  if v_id is null then
    perform pg_advisory_xact_lock(hashtext('arq_cx:' || p_empresa::text));
    insert into arq_caixas (empresa_id, numero, area, setor, titulo, endereco_id, observacao, reter, reter_motivo)
      values (p_empresa, (select coalesce(max(numero), 0) + 1 from arq_caixas where empresa_id = p_empresa), v_area, nullif(btrim(coalesce(p->>'setor', '')), ''),
              btrim(p->>'titulo'), v_end, nullif(btrim(coalesce(p->>'observacao', '')), ''), v_reter, case when v_reter then btrim(p->>'reter_motivo') end)
      returning id into v_id;
  else
    select * into c from arq_caixas where id = v_id and empresa_id = p_empresa for update;
    if not found then raise exception 'Caixa não encontrada.'; end if;
    if c.situacao = 'descartada' then raise exception 'A caixa % foi descartada e não pode ser alterada.', c.numero; end if;
    if not public._arq_ve(p_empresa, c.area) then raise exception 'Caixa não encontrada.'; end if;
    if exists (select 1 from arq_descarte_caixas dc join arq_descartes d on d.id = dc.descarte_id where dc.caixa_id = v_id and d.situacao in ('proposto', 'aprovado')) then
      raise exception 'A caixa % está numa proposta de descarte. Cancele ou recuse a proposta antes de alterá-la.', c.numero; end if;
    update arq_caixas set area = v_area, setor = nullif(btrim(coalesce(p->>'setor', '')), ''), titulo = btrim(p->>'titulo'), endereco_id = v_end,
           observacao = nullif(btrim(coalesce(p->>'observacao', '')), ''), reter = v_reter, reter_motivo = case when v_reter then btrim(p->>'reter_motivo') end where id = v_id;
    delete from arq_itens where caixa_id = v_id;
  end if;
  insert into arq_itens (caixa_id, empresa_id, tipo_id, descricao, inicio, fim, ordem)
  select v_id, p_empresa, (x->>'tipo_id')::uuid, nullif(btrim(coalesce(x->>'descricao', '')), ''), (x->>'inicio')::date, (x->>'fim')::date, o::int
    from jsonb_array_elements(coalesce(p->'itens', '[]')) with ordinality e(x, o);
  perform public._arq_recalc(array[v_id]);
  return v_id;
end $$;

-- guardar caixas num endereço (leitor: a prateleira e depois as caixas)
create or replace function public.arq_caixa_mover(p_empresa uuid, p_caixas uuid[], p_endereco uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public._arq_gestor(p_empresa) then raise exception 'Só quem cuida do arquivo muda caixas de lugar.'; end if;
  if p_endereco is not null and not exists (select 1 from arq_enderecos where id = p_endereco and empresa_id = p_empresa and ativo) then raise exception 'Endereço não encontrado ou inativo.'; end if;
  if exists (select 1 from arq_caixas where id = any(p_caixas) and (empresa_id <> p_empresa or situacao = 'descartada' or not public._arq_ve(p_empresa, area))) then raise exception 'Caixa de outra empresa, sem acesso ou já descartada.'; end if;
  update arq_caixas set endereco_id = p_endereco where id = any(p_caixas) and empresa_id = p_empresa;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ------------------------------------------------------------ retirada e devolução
create or replace function public.arq_emp_pedir(p_caixa uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c arq_caixas; v_id uuid;
begin
  select * into c from arq_caixas where id = p_caixa;
  if not found or not public._arq_ve(c.empresa_id, c.area) then raise exception 'Caixa não encontrada.'; end if;
  if c.situacao = 'descartada' then raise exception 'A caixa % foi descartada.', c.numero; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe para que precisa da caixa.'; end if;
  if exists (select 1 from arq_emprestimos where caixa_id = p_caixa and situacao = 'pedido' and pedido_por = auth.uid()) then raise exception 'Você já pediu esta caixa.'; end if;
  insert into arq_emprestimos (empresa_id, caixa_id, situacao, pedido_por, pedido_nome, pedido_em, motivo)
    values (c.empresa_id, p_caixa, 'pedido', auth.uid(), public._arq_nome(), now(), btrim(p_motivo)) returning id into v_id;
  return v_id;
end $$;

-- retirada: de um pedido (p_pedido) ou direta. Quem levou: pessoa da empresa (p_para) ou nome.
create or replace function public.arq_emp_retirar(p_caixa uuid, p_pedido uuid, p_para uuid, p_para_nome text, p_motivo text, p_previsto date)
returns uuid language plpgsql security definer set search_path = public as $$
declare c arq_caixas; e arq_emprestimos; v_id uuid; v_nome text;
begin
  select * into c from arq_caixas where id = p_caixa for update;
  if not found or not public._arq_gestor(c.empresa_id) or not public._arq_ve(c.empresa_id, c.area) then raise exception 'Só quem cuida do arquivo registra a retirada.'; end if;
  if c.situacao <> 'arquivada' then raise exception 'A caixa % está %.', c.numero, case c.situacao when 'emprestada' then 'retirada' else 'descartada' end; end if;
  if p_previsto is null or p_previsto < current_date or p_previsto > current_date + 180 then raise exception 'Data de devolução: de hoje até 180 dias.'; end if;
  if p_para is not null then
    select coalesce(nullif(trim(m.nome), ''), split_part(u.email, '@', 1)) into v_nome from membros m join auth.users u on u.id = m.user_id where m.empresa_id = c.empresa_id and m.user_id = p_para;
    if v_nome is null then raise exception 'Pessoa não é da empresa.'; end if;
  else v_nome := nullif(btrim(coalesce(p_para_nome, '')), '');
    if v_nome is null or length(v_nome) < 3 then raise exception 'Informe quem está levando a caixa.'; end if;
  end if;
  if p_pedido is not null then
    select * into e from arq_emprestimos where id = p_pedido and caixa_id = p_caixa and situacao = 'pedido' for update;
    if not found then raise exception 'Pedido não encontrado ou já atendido.'; end if;
    update arq_emprestimos set situacao = 'retirada', para_id = p_para, para_nome = v_nome, retirado_por = auth.uid(), retirado_nome = public._arq_nome(), retirado_em = now(), previsto = p_previsto,
           motivo = coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), motivo) where id = p_pedido;
    v_id := p_pedido;
  else
    if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo da retirada.'; end if;
    insert into arq_emprestimos (empresa_id, caixa_id, situacao, motivo, para_id, para_nome, retirado_por, retirado_nome, retirado_em, previsto)
      values (c.empresa_id, p_caixa, 'retirada', btrim(p_motivo), p_para, v_nome, auth.uid(), public._arq_nome(), now(), p_previsto) returning id into v_id;
  end if;
  update arq_caixas set situacao = 'emprestada' where id = p_caixa;
  return v_id;
end $$;

create or replace function public.arq_emp_devolver(p_emprestimo uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e arq_emprestimos;
begin
  select * into e from arq_emprestimos where id = p_emprestimo for update;
  if not found or not public._arq_gestor(e.empresa_id) then raise exception 'Só quem cuida do arquivo registra a devolução.'; end if;
  if e.situacao <> 'retirada' then raise exception 'Esta retirada já foi encerrada.'; end if;
  update arq_emprestimos set situacao = 'devolvida', devolvido_por = auth.uid(), devolvido_nome = public._arq_nome(), devolvido_em = now() where id = e.id;
  update arq_caixas set situacao = 'arquivada' where id = e.caixa_id and situacao = 'emprestada';
end $$;

create or replace function public.arq_emp_cancelar(p_emprestimo uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare e arq_emprestimos;
begin
  select * into e from arq_emprestimos where id = p_emprestimo for update;
  if not found or not (e.pedido_por = auth.uid() or public._arq_gestor(e.empresa_id)) then raise exception 'Pedido não encontrado.'; end if;
  if e.situacao <> 'pedido' then raise exception 'Só o pedido ainda não atendido pode ser cancelado.'; end if;
  update arq_emprestimos set situacao = 'cancelado', cancelado_motivo = nullif(btrim(coalesce(p_motivo, '')), '') where id = e.id;
end $$;

-- ------------------------------------------------------------ descarte
create or replace function public.arq_descartaveis(p_empresa uuid)
returns table (caixa_id uuid, numero int, area text, titulo text, periodo_inicio date, periodo_fim date, descartar_em date, impede text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public._arq_gestor(p_empresa) or public._arq_aprova(p_empresa)) then raise exception 'Sem permissão.'; end if;
  return query select c.id, c.numero, c.area, c.titulo, c.periodo_inicio, c.periodo_fim, c.descartar_em, public._arq_impede(c)
    from arq_caixas c where c.empresa_id = p_empresa and c.situacao <> 'descartada' and public._arq_ve(p_empresa, c.area) and c.descartar_em is not null and c.descartar_em <= current_date + 365
     and not exists (select 1 from arq_descarte_caixas dc join arq_descartes d on d.id = dc.descarte_id where dc.caixa_id = c.id and d.situacao in ('proposto', 'aprovado'))
   order by c.descartar_em, c.numero;
end $$;

create or replace function public.arq_descarte_propor(p_empresa uuid, p_caixas uuid[], p_obs text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; c arq_caixas; v_mot text;
begin
  if not public._arq_gestor(p_empresa) then raise exception 'Só quem cuida do arquivo propõe o descarte.'; end if;
  if (public._arq_cfg(p_empresa)).descarte_suspenso then raise exception 'O descarte está suspenso nos parâmetros: %.', (public._arq_cfg(p_empresa)).descarte_suspenso_motivo; end if;
  if coalesce(cardinality(p_caixas), 0) = 0 then raise exception 'Escolha as caixas.'; end if;
  perform pg_advisory_xact_lock(hashtext('arq_desc:' || p_empresa::text));
  for c in select * from arq_caixas where id = any(p_caixas) for update loop
    if c.empresa_id <> p_empresa or not public._arq_ve(p_empresa, c.area) then raise exception 'Caixa de outra empresa ou sem acesso.'; end if;
    v_mot := public._arq_impede(c);
    if v_mot is not null then raise exception 'A caixa % não pode ser descartada: %.', c.numero, v_mot; end if;
    if exists (select 1 from arq_descarte_caixas dc join arq_descartes d on d.id = dc.descarte_id where dc.caixa_id = c.id and d.situacao in ('proposto', 'aprovado')) then
      raise exception 'A caixa % já está numa proposta de descarte.', c.numero; end if;
  end loop;
  if (select count(*) from arq_caixas where id = any(p_caixas)) <> cardinality(p_caixas) then raise exception 'Caixa não encontrada.'; end if;
  insert into arq_descartes (empresa_id, numero, proposto_por, proposto_nome, observacao)
    values (p_empresa, (select coalesce(max(numero), 0) + 1 from arq_descartes where empresa_id = p_empresa), auth.uid(), public._arq_nome(), nullif(btrim(coalesce(p_obs, '')), ''))
    returning id into v_id;
  insert into arq_descarte_caixas (descarte_id, caixa_id) select v_id, x from unnest(p_caixas) x;
  return v_id;
end $$;

create or replace function public.arq_descarte_decidir(p_descarte uuid, p_aprovar boolean, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare d arq_descartes; c arq_caixas; v_mot text;
begin
  select * into d from arq_descartes where id = p_descarte for update;
  if not found or not public._arq_aprova(d.empresa_id) then raise exception 'Só quem aprova o descarte decide.'; end if;
  if d.situacao <> 'proposto' then raise exception 'Esta proposta já foi decidida.'; end if;
  if d.proposto_por = auth.uid() then raise exception 'Quem propôs o descarte não aprova a própria proposta.'; end if;
  if not p_aprovar and length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo da recusa.'; end if;
  if p_aprovar then
    for c in select x.* from arq_caixas x join arq_descarte_caixas dc on dc.caixa_id = x.id where dc.descarte_id = d.id for update of x loop
      v_mot := public._arq_impede(c);
      if v_mot is not null then raise exception 'A caixa % não pode mais ser descartada: %.', c.numero, v_mot; end if;
    end loop;
  end if;
  update arq_descartes set situacao = case when p_aprovar then 'aprovado' else 'recusado' end, decidido_por = auth.uid(), decidido_nome = public._arq_nome(), decidido_em = now(),
         motivo = nullif(btrim(coalesce(p_motivo, '')), '') where id = d.id;
end $$;

-- o descarte físico aconteceu: data, forma, responsável e testemunha. As caixas saem do arquivo.
create or replace function public.arq_descarte_executar(p_descarte uuid, p_data date, p_forma text, p_responsavel text, p_testemunha text)
returns int language plpgsql security definer set search_path = public as $$
declare d arq_descartes; c arq_caixas; v_mot text; v_n int;
begin
  select * into d from arq_descartes where id = p_descarte for update;
  if not found or not public._arq_gestor(d.empresa_id) then raise exception 'Só quem cuida do arquivo registra o descarte.'; end if;
  if d.situacao <> 'aprovado' then raise exception 'O descarte precisa estar aprovado.'; end if;
  if (public._arq_cfg(d.empresa_id)).descarte_suspenso then raise exception 'O descarte está suspenso nos parâmetros.'; end if;
  if p_data is null or p_data > current_date or p_data < d.decidido_em::date then raise exception 'Data do descarte: entre a aprovação e hoje.'; end if;
  if p_forma is null or p_forma not in ('fragmentacao', 'reciclagem', 'incineracao', 'empresa_especializada') then raise exception 'Escolha a forma do descarte.'; end if;
  if length(btrim(coalesce(p_responsavel, ''))) < 3 then raise exception 'Informe o responsável pelo descarte.'; end if;
  for c in select x.* from arq_caixas x join arq_descarte_caixas dc on dc.caixa_id = x.id where dc.descarte_id = d.id for update of x loop
    v_mot := public._arq_impede(c);
    if v_mot is not null then raise exception 'A caixa % não pode ser descartada: %.', c.numero, v_mot; end if;
  end loop;
  update arq_caixas set situacao = 'descartada', endereco_id = null where id in (select caixa_id from arq_descarte_caixas where descarte_id = d.id);
  get diagnostics v_n = row_count;
  update arq_descartes set situacao = 'executado', executado_em = p_data, forma = p_forma, responsavel = btrim(p_responsavel), testemunha = nullif(btrim(coalesce(p_testemunha, '')), ''),
         registrado_por = auth.uid(), registrado_nome = public._arq_nome(), registrado_em = now() where id = d.id;
  return v_n;
end $$;

create or replace function public.arq_descarte_cancelar(p_descarte uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare d arq_descartes;
begin
  select * into d from arq_descartes where id = p_descarte for update;
  if not found or not (public._arq_gestor(d.empresa_id) or public._arq_aprova(d.empresa_id)) then raise exception 'Sem permissão.'; end if;
  if d.situacao not in ('proposto', 'aprovado') then raise exception 'Só proposta em aberto pode ser cancelada.'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo.'; end if;
  update arq_descartes set situacao = 'cancelado', motivo = btrim(p_motivo) where id = d.id;
end $$;

-- pessoas da empresa para a retirada (quem cuida do arquivo)
create or replace function public.arq_pessoas(p_empresa uuid)
returns table (user_id uuid, nome text, papel text) language plpgsql stable security definer set search_path = public as $$
begin
  if not (public._arq_gestor(p_empresa) or public._arq_papel(p_empresa) = 'admin') then raise exception 'Sem permissão.'; end if;
  return query select m.user_id, coalesce(nullif(trim(m.nome), ''), split_part(u.email, '@', 1))::text, m.papel::text from membros m join auth.users u on u.id = m.user_id
    where m.empresa_id = p_empresa and m.papel::text <> 'motorista' order by 2;
end $$;

-- ------------------------------------------------------------ permissões
revoke all on function public._arq_cfg(uuid), public._arq_papel(uuid), public._arq_nome(), public._arq_recalc(uuid[]), public._arq_impede(arq_caixas),
  public._arq_descarte_item(int, date) from public, anon, authenticated;
revoke all on function public._arq_gestor(uuid), public._arq_consulta(uuid), public._arq_aprova(uuid), public._arq_ve(uuid, text) from public, anon;
grant execute on function public._arq_gestor(uuid), public._arq_consulta(uuid), public._arq_aprova(uuid), public._arq_ve(uuid, text) to authenticated;
do $$ declare f text; begin
  foreach f in array array['public.arq_config_salvar(uuid, jsonb)', 'public.arq_configurar(uuid)', 'public.arq_tipo_salvar(uuid, jsonb)', 'public.arq_local_salvar(uuid, jsonb)',
    'public.arq_end_gerar(uuid, uuid, text[], int, int, int)', 'public.arq_end_salvar(uuid, jsonb)', 'public.arq_caixa_salvar(uuid, jsonb)', 'public.arq_caixa_mover(uuid, uuid[], uuid)',
    'public.arq_emp_pedir(uuid, text)', 'public.arq_emp_retirar(uuid, uuid, uuid, text, text, date)', 'public.arq_emp_devolver(uuid)', 'public.arq_emp_cancelar(uuid, text)',
    'public.arq_descartaveis(uuid)', 'public.arq_descarte_propor(uuid, uuid[], text)', 'public.arq_descarte_decidir(uuid, boolean, text)',
    'public.arq_descarte_executar(uuid, date, text, text, text)', 'public.arq_descarte_cancelar(uuid, text)', 'public.arq_pessoas(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
