-- 193 — Endereçamento do almoxarifado e etiquetas em lote (22/11/2026, Renan: "Iremos fazer um balanço geral e uma nova
-- organização. Minha ideia é etiquetar tudo." O almoxarifado é de estantes; a reorganização começa em 01/12, junto com o
-- inventário geral).
--   1. Endereço dentro do local: estante, prateleira e nível (A-03-2). Cada endereço tem a sua etiqueta de prateleira (E0000123),
--      com o mesmo leitor da etiqueta de mercadoria. A geração é em massa (estantes A a F, 5 prateleiras, 3 níveis).
--   2. Endereço padrão do produto em cada local: onde o produto deve ficar. Atribuído na mão, em lote ou com o leitor
--      (ler a prateleira e depois os produtos), inclusive durante a contagem do inventário geral.
--   3. A guia e a lista de contagem do inventário geral saem na ordem dos endereços (a ordem do corredor).
--   4. Tamanho próprio da etiqueta de prateleira (é uma tira, menor que a da mercadoria).
-- Aditivo: nada muda nos movimentos, saldos ou custos. O endereço não revela saldo: pode ser lido durante a contagem cega.

-- ------------------------------------------------------------ endereços
create table if not exists public.est_enderecos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  local_id uuid not null references public.est_locais(id) on delete cascade,
  codigo text not null check (codigo ~ '^[A-Z0-9]([A-Z0-9.-]{0,18}[A-Z0-9])?$'),
  estante text not null check (estante ~ '^[A-Z0-9]{1,6}$'),
  prateleira text check (prateleira ~ '^[A-Z0-9]{1,6}$'),
  nivel text check (nivel ~ '^[A-Z0-9]{1,6}$'),
  descricao text check (length(descricao) <= 80),
  ordem int not null default 0,                                   -- a ordem do corredor: guia de contagem e lista de entrega
  etiqueta text not null default ('E' || lpad(nextval('public.etiqueta_seq')::text, 7, '0')),
  ativo boolean not null default true,
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now(),
  unique (local_id, codigo),
  unique (id, local_id, empresa_id)
);
create unique index if not exists est_enderecos_etiqueta on public.est_enderecos (etiqueta);
create index if not exists est_enderecos_local on public.est_enderecos (local_id, ordem);
drop trigger if exists est_enderecos_etq_fixa on public.est_enderecos;
create trigger est_enderecos_etq_fixa before update of etiqueta on public.est_enderecos for each row execute function public._etq_fixa();

-- o endereço padrão do produto em cada local (um por produto e local)
create table if not exists public.est_produto_enderecos (
  produto_id uuid not null references public.produtos(id) on delete cascade,
  local_id uuid not null,
  empresa_id uuid not null,
  endereco_id uuid not null,
  atualizado_por uuid, atualizado_em timestamptz not null default now(),
  primary key (produto_id, local_id),
  foreign key (endereco_id, local_id, empresa_id) references public.est_enderecos (id, local_id, empresa_id) on delete cascade
);
create index if not exists est_produto_enderecos_end on public.est_produto_enderecos (endereco_id);

alter table public.est_locais add column if not exists enderecado boolean not null default false;   -- o local tem endereços

-- tamanho da etiqueta de prateleira
alter table public.etq_config add column if not exists end_largura_mm int not null default 100 check (end_largura_mm between 30 and 210);
alter table public.etq_config add column if not exists end_altura_mm int not null default 40 check (end_altura_mm between 15 and 297);

-- ------------------------------------------------------------ acesso: leitura por quem vê o estoque; escrita só pelas funções
alter table public.est_enderecos enable row level security;
alter table public.est_produto_enderecos enable row level security;
drop policy if exists est_enderecos_ler on public.est_enderecos;
create policy est_enderecos_ler on public.est_enderecos for select to authenticated using (public.pode_ver_estoque(empresa_id));
drop policy if exists est_produto_enderecos_ler on public.est_produto_enderecos;
create policy est_produto_enderecos_ler on public.est_produto_enderecos for select to authenticated using (public.pode_ver_estoque(empresa_id));
revoke all on public.est_enderecos, public.est_produto_enderecos from anon, authenticated;
grant select on public.est_enderecos, public.est_produto_enderecos to authenticated;

-- ------------------------------------------------------------ funções
create or replace function public._end_local(p_empresa uuid, p_local uuid) returns est_locais
language plpgsql stable security definer set search_path = public as $$
declare l est_locais;
begin
  if not public.pode_estoque(p_empresa) then raise exception 'Sem permissão para organizar o estoque.'; end if;
  select * into l from est_locais where id = p_local and empresa_id = p_empresa;
  if not found then raise exception 'Local não encontrado nesta empresa.'; end if;
  if not l.controla_saldo then raise exception 'O local % não controla saldo: não recebe endereços.', l.nome; end if;
  return l;
end $$;

-- geração em massa: estantes x prateleiras x níveis; o que já existe fica como está. Devolve quantos endereços foram criados.
create or replace function public.est_end_gerar(p_empresa uuid, p_local uuid, p_estantes text[], p_prateleiras int, p_niveis int, p_digitos int default 2)
returns int language plpgsql security definer set search_path = public as $$
declare l est_locais; e text; pr int; nv int; v_ordem int; v_cod text; v_n int := 0; v_est text[];
begin
  l := public._end_local(p_empresa, p_local);
  select array_agg(distinct upper(btrim(x))) into v_est from unnest(p_estantes) x where btrim(coalesce(x, '')) <> '';
  if v_est is null then raise exception 'Informe pelo menos uma estante.'; end if;
  if exists (select 1 from unnest(v_est) x where x !~ '^[A-Z0-9]{1,6}$') then raise exception 'Estante: use letras e números, até 6 caracteres (ex.: A, B, E01).'; end if;
  if p_prateleiras is null or p_prateleiras < 1 or p_prateleiras > 99 then raise exception 'Prateleiras por estante: de 1 a 99.'; end if;
  if p_niveis is null or p_niveis < 0 or p_niveis > 20 then raise exception 'Níveis por prateleira: de 0 (sem nível) a 20.'; end if;
  if p_digitos is null or p_digitos not in (1, 2, 3) then raise exception 'Dígitos da prateleira: 1, 2 ou 3.'; end if;
  if length(p_prateleiras::text) > p_digitos then raise exception 'Com % prateleiras, use pelo menos % dígitos.', p_prateleiras, length(p_prateleiras::text); end if;
  if array_length(v_est, 1) * p_prateleiras * greatest(p_niveis, 1) > 3000 then raise exception 'Muitos endereços de uma vez (máximo 3.000). Gere por partes.'; end if;
  perform pg_advisory_xact_lock(hashtext('est_end:' || p_local::text));
  select coalesce(max(ordem), 0) into v_ordem from est_enderecos where local_id = p_local;
  foreach e in array (select array_agg(x order by x) from unnest(v_est) x) loop
    for pr in 1 .. p_prateleiras loop
      for nv in 1 .. greatest(p_niveis, 1) loop
        v_cod := e || '-' || lpad(pr::text, p_digitos, '0') || case when p_niveis > 0 then '-' || nv else '' end;
        v_ordem := v_ordem + 10;
        insert into est_enderecos (empresa_id, local_id, codigo, estante, prateleira, nivel, ordem)
          values (p_empresa, p_local, v_cod, e, lpad(pr::text, p_digitos, '0'), case when p_niveis > 0 then nv::text end, v_ordem)
        on conflict (local_id, codigo) do nothing;
        if found then v_n := v_n + 1; end if;
      end loop;
    end loop;
  end loop;
  update est_locais set enderecado = true where id = p_local and not enderecado;
  return v_n;
end $$;

-- um endereço: criar (sem id) ou alterar. p = { id?, local_id, codigo, estante, prateleira, nivel, descricao, ordem, ativo }
create or replace function public.est_end_salvar(p_empresa uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare l est_locais; v est_enderecos; v_id uuid := nullif(p->>'id', '')::uuid; v_cod text := upper(btrim(coalesce(p->>'codigo', '')));
  v_est text := upper(btrim(coalesce(p->>'estante', ''))); v_pr text := nullif(upper(btrim(coalesce(p->>'prateleira', ''))), '');
  v_nv text := nullif(upper(btrim(coalesce(p->>'nivel', ''))), ''); v_ativo boolean := coalesce((p->>'ativo')::boolean, true);
begin
  if v_id is not null then
    select * into v from est_enderecos where id = v_id and empresa_id = p_empresa for update;
    if not found then raise exception 'Endereço não encontrado.'; end if;
    l := public._end_local(p_empresa, v.local_id);
  else
    l := public._end_local(p_empresa, nullif(p->>'local_id', '')::uuid);
  end if;
  if v_est = '' then v_est := split_part(v_cod, '-', 1); end if;
  if v_cod = '' then v_cod := v_est || coalesce('-' || v_pr, '') || coalesce('-' || v_nv, ''); end if;
  if v_cod !~ '^[A-Z0-9]([A-Z0-9.-]{0,18}[A-Z0-9])?$' then raise exception 'Código do endereço: letras, números, ponto e hífen, até 20 caracteres (ex.: A-03-2).'; end if;
  if v_est !~ '^[A-Z0-9]{1,6}$' or (v_pr is not null and v_pr !~ '^[A-Z0-9]{1,6}$') or (v_nv is not null and v_nv !~ '^[A-Z0-9]{1,6}$') then
    raise exception 'Estante, prateleira e nível: letras e números, até 6 caracteres cada.'; end if;
  if exists (select 1 from est_enderecos where local_id = l.id and codigo = v_cod and id is distinct from v_id) then raise exception 'Já existe o endereço % no local %.', v_cod, l.nome; end if;
  if v_id is not null and not v_ativo and v.ativo and exists (select 1 from est_produto_enderecos where endereco_id = v_id) then
    raise exception 'O endereço % tem produtos. Mude os produtos de endereço antes de desativá-lo.', v.codigo; end if;
  if v_id is null then
    insert into est_enderecos (empresa_id, local_id, codigo, estante, prateleira, nivel, descricao, ordem, ativo)
      values (p_empresa, l.id, v_cod, v_est, v_pr, v_nv, nullif(btrim(coalesce(p->>'descricao', '')), ''),
              coalesce((p->>'ordem')::int, (select coalesce(max(ordem), 0) + 10 from est_enderecos where local_id = l.id)), v_ativo)
      returning id into v_id;
    update est_locais set enderecado = true where id = l.id and not enderecado;
  else
    update est_enderecos set codigo = v_cod, estante = v_est, prateleira = v_pr, nivel = v_nv, descricao = nullif(btrim(coalesce(p->>'descricao', '')), ''),
           ordem = coalesce((p->>'ordem')::int, ordem), ativo = v_ativo where id = v_id;
  end if;
  return v_id;
end $$;

-- excluir endereço que ainda não tem produto (o que tem produto só é desativado depois de esvaziado)
create or replace function public.est_end_excluir(p_empresa uuid, p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare v_n int; v_cod text;
begin
  if not public.pode_estoque(p_empresa) then raise exception 'Sem permissão para organizar o estoque.'; end if;
  select e.codigo into v_cod from est_enderecos e where e.id = any(p_ids) and e.empresa_id = p_empresa and exists (select 1 from est_produto_enderecos pe where pe.endereco_id = e.id) limit 1;
  if v_cod is not null then raise exception 'O endereço % tem produtos. Mude os produtos de endereço antes de excluí-lo.', v_cod; end if;
  delete from est_enderecos where id = any(p_ids) and empresa_id = p_empresa;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- a ordem do corredor: a lista de ids na ordem em que se anda
create or replace function public.est_end_ordenar(p_empresa uuid, p_local uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare l est_locais;
begin
  l := public._end_local(p_empresa, p_local);
  perform pg_advisory_xact_lock(hashtext('est_end:' || p_local::text));
  if exists (select 1 from unnest(p_ids) x where not exists (select 1 from est_enderecos e where e.id = x and e.local_id = p_local)) then raise exception 'Há endereço de outro local na lista.'; end if;
  update est_enderecos e set ordem = o.n * 10 from unnest(p_ids) with ordinality o(id, n) where e.id = o.id;
end $$;

-- endereço padrão dos produtos: p_itens = [{ produto_id, local_id, endereco_id | null }] (null = tira o produto do endereço).
-- Devolve { atribuidos, removidos, trocados: [{ produto, de, para }] } — "trocados" avisa quem já tinha outro endereço.
create or replace function public.est_end_atribuir(p_empresa uuid, p_itens jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it jsonb; v_prod uuid; v_loc uuid; v_end uuid; v_ant text; v_novo text; v_pcod text; l est_locais;
  v_atr int := 0; v_rem int := 0; v_troc jsonb := '[]';
begin
  if not public.pode_estoque(p_empresa) then raise exception 'Sem permissão para organizar o estoque.'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Nenhum produto informado.'; end if;
  if jsonb_array_length(p_itens) > 2000 then raise exception 'Muitos produtos de uma vez (máximo 2.000).'; end if;
  for it in select * from jsonb_array_elements(p_itens) loop
    v_prod := nullif(it->>'produto_id', '')::uuid; v_loc := nullif(it->>'local_id', '')::uuid; v_end := nullif(it->>'endereco_id', '')::uuid;
    select codigo into v_pcod from produtos where id = v_prod and empresa_id = p_empresa;
    if not found then raise exception 'Produto não encontrado nesta empresa.'; end if;
    if v_end is not null then
      select e.local_id, e.codigo into v_loc, v_novo from est_enderecos e where e.id = v_end and e.empresa_id = p_empresa and e.ativo
        and (it->>'local_id' is null or e.local_id = (it->>'local_id')::uuid);
      if not found then raise exception 'Endereço não encontrado, inativo ou de outro local (produto %).', v_pcod; end if;
    end if;
    if v_loc is null then raise exception 'Informe o local (produto %).', v_pcod; end if;
    l := public._end_local(p_empresa, v_loc);
    perform pg_advisory_xact_lock(hashtext('est_end_p:' || v_prod::text || v_loc::text));
    select e.codigo into v_ant from est_produto_enderecos pe join est_enderecos e on e.id = pe.endereco_id where pe.produto_id = v_prod and pe.local_id = v_loc;
    if v_end is null then
      delete from est_produto_enderecos where produto_id = v_prod and local_id = v_loc;
      if found then v_rem := v_rem + 1; end if;
    else
      insert into est_produto_enderecos (produto_id, local_id, empresa_id, endereco_id, atualizado_por)
        values (v_prod, v_loc, p_empresa, v_end, auth.uid())
      on conflict (produto_id, local_id) do update set endereco_id = excluded.endereco_id, atualizado_por = excluded.atualizado_por, atualizado_em = now();
      v_atr := v_atr + 1;
      if v_ant is not null and v_ant <> v_novo then v_troc := v_troc || jsonb_build_object('produto', v_pcod, 'de', v_ant, 'para', v_novo); end if;
    end if;
  end loop;
  return jsonb_build_object('atribuidos', v_atr, 'removidos', v_rem, 'trocados', v_troc);
end $$;

-- tamanho da etiqueta de prateleira
create or replace function public.etq_config_endereco_salvar(p_empresa uuid, p_largura int, p_altura int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'diretor')) then
    raise exception 'Só o administrador ou o diretor muda os parâmetros da etiqueta'; end if;
  if p_largura is null or p_largura < 30 or p_largura > 210 or p_altura is null or p_altura < 15 or p_altura > 297 then
    raise exception 'Tamanho da etiqueta de prateleira fora da faixa (largura 30 a 210 mm, altura 15 a 297 mm)'; end if;
  insert into etq_config (empresa_id, end_largura_mm, end_altura_mm) values (p_empresa, p_largura, p_altura)
  on conflict (empresa_id) do update set end_largura_mm = excluded.end_largura_mm, end_altura_mm = excluded.end_altura_mm, atualizado_em = now();
end $$;

-- ------------------------------------------------------------ inventário geral: lista na ordem do corredor, com o endereço
drop function if exists public.est_ig_lista(uuid);
create function public.est_ig_lista(p_ig_local uuid)
returns table (item_id uuid, produto_id uuid, codigo text, descricao text, unidade text, etiqueta text, lote_id uuid, lote text, lote_etiqueta text,
               quantidade numeric, feito boolean, incluido boolean, situacao text, papel text, contado numeric, auditado numeric,
               endereco_id uuid, endereco text, endereco_ordem int)
language plpgsql stable security definer set search_path = public as $$
declare gl est_ig_locais; g est_ig_inventarios; v_papel text;
begin
  select * into gl from est_ig_locais where id = p_ig_local;
  if not found or not public.pode_estoque(gl.empresa_id) then raise exception 'Sem acesso.'; end if;
  select * into g from est_ig_inventarios where id = gl.inventario_id;
  v_papel := case when gl.situacao = 'terceira' and auth.uid() in (gl.responsavel_id, gl.auditor_id) then 'terceira'
                  when auth.uid() = gl.responsavel_id then 'contador' when auth.uid() = gl.auditor_id then 'auditor' end;
  if v_papel is null then raise exception 'Este local é contado por % e auditado por %.', gl.responsavel_nome, coalesce(gl.auditor_nome, 'ninguém'); end if;
  if v_papel = 'auditor' and gl.situacao = 'contando' then raise exception 'A auditoria deste local começa quando % concluir a contagem.', gl.responsavel_nome; end if;
  return query
  select i.id, i.produto_id, p.codigo::text, p.descricao::text, p.unidade::text, p.etiqueta::text, i.lote_id, lt.codigo::text, lt.etiqueta::text,
         case v_papel when 'contador' then i.contado when 'auditor' then i.auditado else i.terceira end,
         case v_papel when 'contador' then i.contado is not null when 'auditor' then i.auditado is not null else i.situacao = 'resolvido' end,
         i.incluido,
         case when v_papel = 'terceira' and i.situacao = 'divergente' and i.terceira is not null then (case when i.terceira_por = auth.uid() then 'aguarda_outro' else 'confirmar' end) when v_papel = 'contador' then (case when i.contado is null then 'pendente' else 'contado' end) else i.situacao end, v_papel,
         case when v_papel = 'terceira' then i.contado end, case when v_papel = 'terceira' then i.auditado end,   -- na terceira contagem os dois veem as duas quantidades
         en.id, en.codigo, en.ordem
    from est_ig_itens i join produtos p on p.id = i.produto_id left join est_lotes lt on lt.id = i.lote_id
    left join est_produto_enderecos pe on pe.produto_id = i.produto_id and pe.local_id = i.local_id
    left join est_enderecos en on en.id = pe.endereco_id
   where i.ig_local_id = p_ig_local
     and (v_papel = 'contador' or (v_papel = 'auditor' and i.na_amostra) or (v_papel = 'terceira' and i.situacao in ('divergente', 'resolvido') and i.na_amostra))
   order by en.ordem nulls last, en.codigo, p.descricao, lt.codigo;
end $$;

-- ------------------------------------------------------------ permissões
revoke all on function public._end_local(uuid, uuid) from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['public.est_end_gerar(uuid, uuid, text[], int, int, int)', 'public.est_end_salvar(uuid, jsonb)', 'public.est_end_excluir(uuid, uuid[])',
                           'public.est_end_ordenar(uuid, uuid, uuid[])', 'public.est_end_atribuir(uuid, jsonb)', 'public.etq_config_endereco_salvar(uuid, int, int)',
                           'public.est_ig_lista(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
