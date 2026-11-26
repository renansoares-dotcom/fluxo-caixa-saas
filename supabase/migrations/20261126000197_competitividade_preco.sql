-- 197 — Comercial › Análise de Competitividade de Preço (COM009), 26/11/2026.
-- Renan: comparar a nossa proposta com o preço que o cliente já paga a outro fornecedor, pelo custo líquido para o cliente
-- depois dos créditos e dos impostos de cada caminho. Parâmetros por vigência e por empresa (multiempresa), pré-carregados
-- e editáveis em tela: alíquota interna por UF/NCM, regra interestadual (4/7/12%), antecipação parcial por destino.
-- PIS/COFINS, PRODEPE, FEEF e o regime vêm do que já existe (fisc_param, empresa_tributacao); CBS/IBS de trib_aliquotas.
-- Somente acréscimos.

-- ------------------------------------------------------------ alíquota interna por UF (e por NCM, quando houver regra própria)
create table if not exists public.fisc_icms_interna (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  uf char(2) not null check (uf ~ '^[A-Z]{2}$'),
  ncm_prefixo text not null default '' check (ncm_prefixo ~ '^\d{0,8}$'),   -- vazio = regra geral (modal) da UF
  aliquota numeric(7,4) not null check (aliquota between 0 and 40),            -- alíquota total da operação interna
  fecp numeric(7,4) not null default 0 check (fecp between 0 and 10),          -- parcela de fundo de pobreza já somada (informativa)
  vigencia_inicio date not null,
  norma text, fonte text,
  situacao text not null default 'a_conferir' check (situacao in ('vigente', 'a_conferir')),
  ativo boolean not null default true,
  observacao text,
  atualizado_por uuid default auth.uid(), atualizado_em timestamptz not null default now(),
  unique (empresa_id, uf, ncm_prefixo, vigencia_inicio)
);
create index if not exists fisc_icms_interna_emp on public.fisc_icms_interna(empresa_id, uf);

-- ------------------------------------------------------------ regra da alíquota interestadual
create table if not exists public.fisc_icms_inter_regra (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  vigencia_inicio date not null,
  ufs_sul_sudeste text[] not null default '{SP,RJ,MG,PR,SC,RS}',   -- origens que usam a alíquota reduzida para N/NE/CO/ES
  aliq_ss_para_nne numeric(7,4) not null default 7 check (aliq_ss_para_nne between 0 and 40),
  aliq_geral numeric(7,4) not null default 12 check (aliq_geral between 0 and 40),
  aliq_importado numeric(7,4) not null default 4 check (aliq_importado between 0 and 40),
  norma text, fonte text,
  atualizado_por uuid default auth.uid(), atualizado_em timestamptz not null default now(),
  unique (empresa_id, vigencia_inicio)
);

-- ------------------------------------------------------------ antecipação parcial (destino)
create table if not exists public.fisc_antecipacao (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  uf_destino char(2) not null check (uf_destino ~ '^[A-Z]{2}$'),
  aliq_inter numeric(7,4) not null check (aliq_inter between 0 and 40),    -- alíquota da operação interestadual
  aliq_interna numeric(7,4),                                               -- interna do destino a que o percentual se refere (nulo = qualquer)
  pct numeric(7,4) not null check (pct between 0 and 40),
  tipos_cliente text[] not null default '{comercio}',
  vigencia_inicio date not null,
  norma text, fonte text,
  ativo boolean not null default true,
  atualizado_por uuid default auth.uid(), atualizado_em timestamptz not null default now(),
  unique (empresa_id, uf_destino, aliq_inter, aliq_interna, vigencia_inicio)
);

-- ------------------------------------------------------------ parâmetros da tela
create table if not exists public.com_comp_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  papeis_usa text[] not null default '{admin,diretor,financeiro,vendas}',
  papeis_margem text[] not null default '{admin,diretor}',
  usuarios_margem uuid[] not null default '{}',                 -- liberação individual (ex.: gerente comercial)
  margem_min_pct numeric(7,4) not null default 10 check (margem_min_pct between -100 and 100),
  despesas_pct numeric(7,4) not null default 0 check (despesas_pct between 0 and 100),   -- comissão e outras despesas variáveis
  taxa_mensal numeric(7,4) not null default 0 check (taxa_mensal between 0 and 20),     -- 0 = sem valor presente do prazo
  pc_pct numeric(7,4) not null default 9.25 check (pc_pct between 0 and 100),           -- crédito do cliente no não cumulativo
  pc_excluir_icms boolean not null default true,                                         -- Lei 14.592/2023
  pc_cumulativo_pct numeric(7,4) not null default 3.65 check (pc_cumulativo_pct between 0 and 100),
  simples_pct numeric(7,4) check (simples_pct between 0 and 100),                       -- empresa do Simples: alíquota efetiva do DAS
  reforma_padrao boolean not null default false,
  atualizado_por uuid default auth.uid(), atualizado_em timestamptz not null default now()
);

-- ------------------------------------------------------------ análises
create table if not exists public.com_competitividade (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  data date not null default current_date,
  cliente_id uuid references public.favorecidos(id) on delete set null,
  cliente_nome text not null,
  cliente jsonb not null default '{}'::jsonb,          -- uf, tipo, regime, cred_icms, cred_pc, documento
  produto_id uuid references public.produtos(id) on delete set null,
  produto_desc text,
  ncm text,
  concorrente jsonb not null default '{}'::jsonb,      -- nome, uf, preco, aliq, importado, simples, frete, prazo
  proposta jsonb not null default '{}'::jsonb,         -- preco, frete, prazo
  resultado jsonb not null default '{}'::jsonb,        -- custos, diferença, empate (sem a margem)
  parametros jsonb not null default '{}'::jsonb,       -- cópia dos parâmetros usados (vigências, alíquotas)
  status text not null default 'negociacao' check (status in ('negociacao', 'ganha', 'perdida')),
  status_obs text,
  historico jsonb not null default '[]'::jsonb,
  responsavel_id uuid default auth.uid(),
  responsavel_nome text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists com_competitividade_emp on public.com_competitividade(empresa_id, data desc);

-- a margem fica separada: só quem tem a liberação lê
create table if not exists public.com_competitividade_margem (
  analise_id uuid primary key references public.com_competitividade(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  dados jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

-- ------------------------------------------------------------ acesso
create or replace function public._comp_cfg(p_empresa uuid) returns public.com_comp_config
language sql stable security definer set search_path = public as $$
  select coalesce((select c from com_comp_config c where c.empresa_id = p_empresa), row(p_empresa, '{admin,diretor,financeiro,vendas}'::text[], '{admin,diretor}'::text[],
    '{}'::uuid[], 10, 0, 0, 9.25, true, 3.65, null, false, null, now())::com_comp_config);
$$;
create or replace function public._comp_usa(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.papel_em(p_empresa) = any((public._comp_cfg(p_empresa)).papeis_usa), false) and public._mfa_ok(p_empresa);
$$;
create or replace function public._comp_margem(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.papel_em(p_empresa) is not null and (public.papel_em(p_empresa) = any((public._comp_cfg(p_empresa)).papeis_margem)
    or auth.uid() = any((public._comp_cfg(p_empresa)).usuarios_margem)), false) and public._mfa_ok(p_empresa);
$$;
create or replace function public.comp_acesso(p_empresa uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('usa', public._comp_usa(p_empresa), 'margem', public._comp_margem(p_empresa), 'admin', coalesce(public.papel_em(p_empresa) = 'admin', false));
$$;

alter table public.fisc_icms_interna enable row level security;
alter table public.fisc_icms_inter_regra enable row level security;
alter table public.fisc_antecipacao enable row level security;
alter table public.com_comp_config enable row level security;
alter table public.com_competitividade enable row level security;
alter table public.com_competitividade_margem enable row level security;
do $$ declare t text; a text; begin
  foreach t in array array['fisc_icms_interna', 'fisc_icms_inter_regra', 'fisc_antecipacao', 'com_comp_config'] loop
    foreach a in array array['sel', 'ins', 'upd', 'del'] loop execute format('drop policy if exists %s_%s on public.%s', t, a, t); end loop;
    execute format('create policy %s_sel on public.%s for select to authenticated using (public.is_membro(empresa_id) or public._comp_usa(empresa_id))', t, t);   -- vendas não é membro pleno
    execute format('create policy %s_ins on public.%s for insert to authenticated with check (public.is_admin(empresa_id))', t, t);
    execute format('create policy %s_upd on public.%s for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id))', t, t);
    execute format('create policy %s_del on public.%s for delete to authenticated using (public.is_admin(empresa_id))', t, t);
  end loop;
end $$;
drop policy if exists com_competitividade_sel on public.com_competitividade;
create policy com_competitividade_sel on public.com_competitividade for select to authenticated using (public._comp_usa(empresa_id));
drop policy if exists com_competitividade_margem_sel on public.com_competitividade_margem;
create policy com_competitividade_margem_sel on public.com_competitividade_margem for select to authenticated using (public._comp_margem(empresa_id));
-- análises e margem: escrita só pelas funções abaixo

-- ------------------------------------------------------------ pré-carga dos parâmetros (idempotente, por empresa)
-- Alíquotas gerais (modais) das 27 UFs conferidas em 26/11/2026 (Buscador NCM, conferido em 16/11/2026, com a norma de cada UF);
-- ficam "a conferir" até a contabilidade confirmar. Antecipação parcial de PE: Decreto 44.650/2017 na redação do Decreto 55.981/2023.
create or replace function public.comp_configurar(p_empresa uuid) returns int
language plpgsql security definer set search_path = public as $$
declare k int := 0; j int;
begin
  if not public._comp_usa(p_empresa) and not public.is_admin(p_empresa) then raise exception 'Sem acesso à análise de competitividade.'; end if;
  insert into com_comp_config(empresa_id) values (p_empresa) on conflict do nothing;
  if not exists (select 1 from fisc_icms_interna where empresa_id = p_empresa) then
    insert into fisc_icms_interna(empresa_id, uf, aliquota, vigencia_inicio, norma, fonte, situacao)
    select p_empresa, v.uf, v.al, v.vig::date, v.norma, 'Buscador NCM (alíquota geral por UF, conferido em 16/11/2026), pré-carga de 26/11/2026', 'a_conferir'
    from (values ('AC', 19, '2023-04-01', 'LC 422/2022'), ('AL', 20.5, '2026-04-01', 'Lei 9.776/2025'), ('AM', 20, '2023-03-29', 'LC 242/2022'),
      ('AP', 18, '1997-12-29', 'Lei 0400/1997'), ('BA', 20.5, '2024-02-07', 'Lei 14.629/2023'), ('CE', 20, '2024-01-01', 'Lei 18.305/2023'),
      ('DF', 20, '2024-01-22', 'Lei 7.326/2023'), ('ES', 17, '2000-01-01', 'Lei 12.020/2023'), ('GO', 19, '2024-04-01', 'Lei 22.460/2023'),
      ('MA', 23, '2025-02-23', 'Lei 12.246/2024'), ('MG', 18, '2000-01-01', 'Lei 6.763/1975'), ('MS', 17, '2000-01-01', 'Lei 1.810/1997'),
      ('MT', 17, '2000-01-01', 'Lei 7.098/1998'), ('PA', 19, '2023-03-16', 'Lei 9.755/2022'), ('PB', 20, '2024-01-01', 'Lei 12.788/2023'),
      ('PE', 20.5, '2024-01-01', 'Lei 15.730/2016, art. 15, VII (redação da Lei 18.305/2023)'), ('PI', 22.5, '2025-04-01', 'Lei 8.558/2024'),
      ('PR', 19.5, '2024-03-18', 'Lei 21.850/2023'), ('RJ', 20, '2024-03-20', 'Lei 10.253/2023'), ('RN', 20, '2025-03-20', 'Lei 11.999/2024'),
      ('RO', 19.5, '2024-01-12', 'Lei 5.634/2023'), ('RR', 20, '2023-03-30', 'Lei 1.767/2022'), ('RS', 17, '2000-01-01', 'Lei 8.820/1989'),
      ('SC', 17, '2000-01-01', 'Lei 10.297/1996'), ('SE', 19, '2023-04-01', 'Lei 9.120/2022'), ('SP', 18, '2000-01-01', 'Lei 6.374/1989'),
      ('TO', 20, '2023-04-01', 'Lei 4.141/2023')) as v(uf, al, vig, norma);
    get diagnostics j = row_count; k := k + j;
  end if;
  if not exists (select 1 from fisc_icms_inter_regra where empresa_id = p_empresa) then
    insert into fisc_icms_inter_regra(empresa_id, vigencia_inicio, norma, fonte)
    values (p_empresa, '2013-01-01', 'Resolução do Senado 22/1989 (7% e 12%) e 13/2012 (4% para importados)', 'pré-carga de 26/11/2026');
    k := k + 1;
  end if;
  if not exists (select 1 from fisc_antecipacao where empresa_id = p_empresa) then
    insert into fisc_antecipacao(empresa_id, uf_destino, aliq_inter, aliq_interna, pct, vigencia_inicio, norma, fonte)
    values (p_empresa, 'PE', 7, 20.5, 15.27, '2024-01-01', 'Decreto 44.650/2017 (redação do Decreto 55.981/2023): Sul/Sudeste, exceto ES', 'pré-carga de 26/11/2026'),
           (p_empresa, 'PE', 12, 20.5, 8.34, '2024-01-01', 'Decreto 44.650/2017 (redação do Decreto 55.981/2023): N/NE/CO e ES', 'pré-carga de 26/11/2026'),
           (p_empresa, 'PE', 4, 20.5, 19.44, '2024-01-01', 'Decreto 44.650/2017 (redação do Decreto 55.981/2023): importado a 4%', 'pré-carga de 26/11/2026');
    k := k + 3;
  end if;
  return k;
end $$;

-- ------------------------------------------------------------ parâmetros da tela (admin)
create or replace function public.comp_config_salvar(p_empresa uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.papel_em(p_empresa) = 'admin', false) then raise exception 'Só o administrador altera os parâmetros.'; end if;
  if not ('admin' = any(coalesce(array(select jsonb_array_elements_text(p->'papeis_usa')), '{}'))) then raise exception 'O administrador precisa continuar usando a tela.'; end if;
  insert into com_comp_config(empresa_id) values (p_empresa) on conflict do nothing;
  update com_comp_config set
    papeis_usa = array(select jsonb_array_elements_text(p->'papeis_usa')),
    papeis_margem = array(select jsonb_array_elements_text(coalesce(p->'papeis_margem', '[]'))),
    usuarios_margem = array(select (jsonb_array_elements_text(coalesce(p->'usuarios_margem', '[]')))::uuid),
    margem_min_pct = coalesce((p->>'margem_min_pct')::numeric, margem_min_pct),
    despesas_pct = coalesce((p->>'despesas_pct')::numeric, despesas_pct),
    taxa_mensal = coalesce((p->>'taxa_mensal')::numeric, taxa_mensal),
    pc_pct = coalesce((p->>'pc_pct')::numeric, pc_pct),
    pc_excluir_icms = coalesce((p->>'pc_excluir_icms')::boolean, pc_excluir_icms),
    pc_cumulativo_pct = coalesce((p->>'pc_cumulativo_pct')::numeric, pc_cumulativo_pct),
    simples_pct = nullif(p->>'simples_pct', '')::numeric,
    reforma_padrao = coalesce((p->>'reforma_padrao')::boolean, reforma_padrao),
    atualizado_por = auth.uid(), atualizado_em = now()
  where empresa_id = p_empresa;
end $$;

create or replace function public.comp_pessoas(p_empresa uuid)
returns table (user_id uuid, nome text, papel text) language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.papel_em(p_empresa) = 'admin', false) then raise exception 'Só o administrador consulta.'; end if;
  return query select m.user_id, coalesce(nullif(trim(m.nome), ''), split_part(u.email, '@', 1))::text, m.papel::text
    from membros m left join auth.users u on u.id = m.user_id where m.empresa_id = p_empresa order by 2;
end $$;

-- ------------------------------------------------------------ salvar a análise
-- p: {id?, data, cliente_id, cliente_nome, cliente, produto_id, produto_desc, ncm, concorrente, proposta, resultado, parametros}
-- p_margem: a visão interna (gravada só se quem salva tem a liberação)
create or replace function public.comp_salvar(p_empresa uuid, p jsonb, p_margem jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; x com_competitividade; n int; v_nome text;
begin
  if not public._comp_usa(p_empresa) then raise exception 'Sem acesso à análise de competitividade.'; end if;
  if coalesce(trim(p->>'cliente_nome'), '') = '' then raise exception 'Informe o cliente.'; end if;
  if coalesce((p->'proposta'->>'preco')::numeric, 0) <= 0 or coalesce((p->'concorrente'->>'preco')::numeric, 0) <= 0 then raise exception 'Informe os dois preços.'; end if;
  if nullif(p->>'cliente_id', '') is not null and not exists (select 1 from favorecidos where id = (p->>'cliente_id')::uuid and empresa_id = p_empresa) then raise exception 'Cliente de outra empresa.'; end if;
  if nullif(p->>'produto_id', '') is not null and not exists (select 1 from produtos where id = (p->>'produto_id')::uuid and empresa_id = p_empresa) then raise exception 'Produto de outra empresa.'; end if;
  v_nome := coalesce(nullif(trim((select m.nome from membros m where m.empresa_id = p_empresa and m.user_id = auth.uid())), ''), (select split_part(email, '@', 1) from auth.users where id = auth.uid()));
  if v_id is null then
    perform pg_advisory_xact_lock(hashtext('comp:' || p_empresa::text));
    select coalesce(max(numero), 0) + 1 into n from com_competitividade where empresa_id = p_empresa;
    insert into com_competitividade(empresa_id, numero, data, cliente_id, cliente_nome, cliente, produto_id, produto_desc, ncm, concorrente, proposta, resultado, parametros,
      responsavel_id, responsavel_nome, historico)
    values (p_empresa, n, coalesce(nullif(p->>'data', '')::date, current_date), nullif(p->>'cliente_id', '')::uuid, trim(p->>'cliente_nome'), coalesce(p->'cliente', '{}'),
      nullif(p->>'produto_id', '')::uuid, p->>'produto_desc', p->>'ncm', coalesce(p->'concorrente', '{}'), coalesce(p->'proposta', '{}'), coalesce(p->'resultado', '{}'),
      coalesce(p->'parametros', '{}'), auth.uid(), v_nome, jsonb_build_array(jsonb_build_object('em', now(), 'por', v_nome, 'status', 'negociacao', 'obs', 'Análise criada')))
    returning * into x;
  else
    select * into x from com_competitividade where id = v_id and empresa_id = p_empresa for update;
    if not found then raise exception 'Análise não encontrada.'; end if;
    if x.responsavel_id is distinct from auth.uid() and not coalesce(public.papel_em(p_empresa) in ('admin', 'diretor'), false) then raise exception 'Só o responsável ou a diretoria altera a análise.'; end if;
    update com_competitividade set data = coalesce(nullif(p->>'data', '')::date, data), cliente_id = nullif(p->>'cliente_id', '')::uuid, cliente_nome = trim(p->>'cliente_nome'),
      cliente = coalesce(p->'cliente', '{}'), produto_id = nullif(p->>'produto_id', '')::uuid, produto_desc = p->>'produto_desc', ncm = p->>'ncm',
      concorrente = coalesce(p->'concorrente', '{}'), proposta = coalesce(p->'proposta', '{}'), resultado = coalesce(p->'resultado', '{}'),
      parametros = coalesce(p->'parametros', '{}'), atualizado_em = now(),
      historico = historico || jsonb_build_array(jsonb_build_object('em', now(), 'por', v_nome, 'status', x.status, 'obs', 'Análise recalculada'))
    where id = v_id returning * into x;
  end if;
  if p_margem is not null and public._comp_margem(p_empresa) then
    insert into com_competitividade_margem(analise_id, empresa_id, dados) values (x.id, p_empresa, p_margem)
    on conflict (analise_id) do update set dados = excluded.dados, atualizado_em = now();
  end if;
  return jsonb_build_object('id', x.id, 'numero', x.numero);
end $$;

create or replace function public.comp_status(p_id uuid, p_status text, p_obs text default null) returns void
language plpgsql security definer set search_path = public as $$
declare x com_competitividade; v_nome text;
begin
  select * into x from com_competitividade where id = p_id for update;
  if not found or not public._comp_usa(x.empresa_id) then raise exception 'Análise não encontrada.'; end if;
  if p_status not in ('negociacao', 'ganha', 'perdida') then raise exception 'Status inválido.'; end if;
  if p_status = 'perdida' and coalesce(trim(p_obs), '') = '' then raise exception 'Informe o motivo da perda (ex.: preço, prazo, qualidade).'; end if;
  v_nome := coalesce(nullif(trim((select m.nome from membros m where m.empresa_id = x.empresa_id and m.user_id = auth.uid())), ''), (select split_part(email, '@', 1) from auth.users where id = auth.uid()));
  update com_competitividade set status = p_status, status_obs = nullif(trim(p_obs), ''), atualizado_em = now(),
    historico = historico || jsonb_build_array(jsonb_build_object('em', now(), 'por', v_nome, 'status', p_status, 'obs', nullif(trim(p_obs), '')))
  where id = p_id;
end $$;

create or replace function public.comp_excluir(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare x com_competitividade;
begin
  select * into x from com_competitividade where id = p_id;
  if not found or not public._comp_usa(x.empresa_id) then raise exception 'Análise não encontrada.'; end if;
  if not (coalesce(public.papel_em(x.empresa_id) = 'admin', false) or (x.responsavel_id = auth.uid() and x.status = 'negociacao')) then
    raise exception 'Só o administrador, ou o responsável enquanto está em negociação, exclui a análise.'; end if;
  delete from com_competitividade where id = p_id;
end $$;


-- ------------------------------------------------------------ base para o cálculo (regime da empresa, reforma e, para quem vê a margem, PRODEPE e custo)
create or replace function public.comp_base(p_empresa uuid, p_produto uuid default null, p_data date default current_date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t empresa_tributacao; f fisc_param; r jsonb;
begin
  if not public._comp_usa(p_empresa) then raise exception 'Sem acesso à análise de competitividade.'; end if;
  select * into t from empresa_tributacao where empresa_id = p_empresa and vigencia_inicio <= coalesce(p_data, current_date) order by vigencia_inicio desc limit 1;
  r := jsonb_build_object('uf', t.uf, 'regime', t.regime, 'pis_cofins', t.pis_cofins, 'incentivos', t.incentivos,
    'vigencia_regime', t.vigencia_inicio,
    'reforma', coalesce((select jsonb_agg(to_jsonb(a) - 'empresa_id' - 'atualizado_por' order by a.ano) from trib_aliquotas a where a.empresa_id = p_empresa), '[]'::jsonb));
  if public._comp_margem(p_empresa) then
    select * into f from fisc_param where empresa_id = p_empresa and vigencia_inicio <= coalesce(p_data, current_date) order by vigencia_inicio desc limit 1;
    r := r || jsonb_build_object('fisc', case when f.id is null then null else to_jsonb(f) - 'empresa_id' - 'atualizado_por' end,
      'custo', (select jsonb_build_object('custo_medio', c.custo_medio, 'quantidade', c.quantidade, 'ultima_entrada', c.ultima_entrada) from est_custos c
                where c.produto_id = p_produto and c.empresa_id = p_empresa));
  end if;
  return r;
end $$;

-- ------------------------------------------------------------ permissões
revoke all on function public._comp_cfg(uuid) from public, anon, authenticated;
revoke all on function public._comp_usa(uuid), public._comp_margem(uuid) from public, anon;
grant execute on function public._comp_usa(uuid), public._comp_margem(uuid) to authenticated;   -- usadas nas políticas de leitura
do $$ declare f text; begin
  foreach f in array array['public.comp_acesso(uuid)', 'public.comp_configurar(uuid)', 'public.comp_config_salvar(uuid, jsonb)', 'public.comp_pessoas(uuid)',
    'public.comp_salvar(uuid, jsonb, jsonb)', 'public.comp_base(uuid, uuid, date)', 'public.comp_status(uuid, text, text)', 'public.comp_excluir(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('fisc_icms_interna', 'fisc_icms_inter_regra', 'fisc_antecipacao',
  'com_comp_config', 'com_competitividade', 'com_competitividade_margem')) as tabelas;
