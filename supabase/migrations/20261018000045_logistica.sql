-- =====================================================================
-- Etapa 6 (parte) — Logística: frota, parâmetros, restrições de clientes, cargas e entregas.
-- Decisão de 17/10/2026 (Renan, "pode seguir"): as cargas são montadas a partir das NF-e de saída já importadas
-- (peso bruto, volumes e endereço vêm do XML guardado em nfe_notas.xml); a importação de pedidos do Iniflex fica para depois.
-- Frota atual: 3 caminhões + 1 menor (dados a cadastrar na tela Frota e parâmetros).
-- Migração ADITIVA. Também corrige a lista de áreas válidas de membros (faltavam com, cmp, prd e entra log).
-- =====================================================================

-- áreas do menu: a restrição antiga só aceitava fin, cpd e cont (as áreas criadas depois não podiam ser marcadas)
alter table public.membros drop constraint if exists membros_areas_validas;
alter table public.membros add constraint membros_areas_validas
  check (areas is null or (cardinality(areas) > 0 and areas <@ array['fin', 'com', 'cmp', 'prd', 'log', 'cpd', 'cont']::text[]));

-- monta e altera cargas: admin, financeiro, diretor
create or replace function public.pode_logistica(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor'));
$$;
-- vê a logística: membros internos e quem vê a produção (a planta mostra os caminhões)
create or replace function public.ve_logistica(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor', 'leitura', 'producao'));
$$;

create table if not exists public.log_veiculos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,                       -- apelido curto: TRK-01, VUC-01
  placa text,
  tipo text not null default 'truck' check (tipo in ('carreta', 'truck', 'toco', 'tres_quartos', 'vuc', 'utilitario', 'outro')),
  carga_kg numeric(10,1) not null check (carga_kg > 0),
  comp_m numeric(6,2), larg_m numeric(6,2), alt_m numeric(6,2),     -- medidas internas do baú
  ocupacao_max_pct numeric(5,1) not null default 95 check (ocupacao_max_pct between 10 and 110),
  pequeno boolean not null default false,     -- atende cliente que só recebe veículo pequeno / centro urbano
  max_entregas smallint,
  consumo_km_l numeric(6,2), custo_km numeric(10,2),
  motorista text,
  situacao text not null default 'disponivel' check (situacao in ('disponivel', 'manutencao', 'inativo')),
  observacao text,
  unique (empresa_id, codigo)
);

create table if not exists public.log_parametros (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null unique references public.empresas(id) on delete cascade,
  origem_cmun text,                            -- código IBGE do ponto de saída (vazio = município do emitente das notas)
  fator_rodoviario numeric(4,2) not null default 1.30,   -- distância em linha reta × fator ≈ distância por estrada
  velocidade_kmh numeric(5,1) not null default 55,
  min_por_entrega numeric(5,1) not null default 25,
  jornada_h numeric(4,1) not null default 10,
  diesel_rs_l numeric(6,3),
  m3_por_t numeric(6,2) not null default 4,    -- volume estimado por tonelada quando o produto não tem medida
  raio_max_km numeric(7,1) not null default 600, -- acima disso a entrega é sugerida para transportadora
  mod_fretes text[] not null default array['0', '9'],    -- modFrete das notas que a frota entrega (0 = por conta do emitente)
  dias_atraso smallint not null default 3      -- nota parada há mais que isso entra como atrasada
);

create table if not exists public.log_clientes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  documento text not null,                     -- CNPJ/CPF do destinatário (só dígitos)
  nome text,
  so_pequeno boolean not null default false,
  dias_receb smallint[],                       -- 0 = domingo … 6 = sábado; vazio = qualquer dia
  horario text,
  observacao text,
  unique (empresa_id, documento)
);

create table if not exists public.log_cargas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null default 0,
  data date not null default current_date,
  veiculo_id uuid references public.log_veiculos(id) on delete set null,
  motorista text,
  status text not null default 'planejada' check (status in ('planejada', 'carregando', 'pronta', 'em_rota', 'concluida', 'cancelada')),
  peso_kg numeric(12,1), volume_m3 numeric(10,2), km_previsto numeric(9,1), horas_previstas numeric(6,2), frete_previsto numeric(12,2),
  km_real numeric(9,1),
  saida_em timestamptz, retorno_em timestamptz,
  observacao text,
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists log_cargas_data on public.log_cargas(empresa_id, data);

create table if not exists public.log_carga_notas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  carga_id uuid not null references public.log_cargas(id) on delete cascade,
  nota_id uuid not null references public.nfe_notas(id) on delete cascade,
  seq smallint not null default 0,             -- ordem de entrega (o carregamento é o inverso)
  peso_kg numeric(12,1), volume_m3 numeric(10,2),
  situacao text not null default 'pendente' check (situacao in ('pendente', 'entregue', 'nao_entregue', 'devolvida')),
  entregue_em timestamptz, observacao text,
  unique (carga_id, nota_id)
);
create index if not exists log_carga_notas_nota on public.log_carga_notas(nota_id);

-- numeração e datas da carga
drop trigger if exists log_cargas_numero on public.log_cargas;
create trigger log_cargas_numero before insert on public.log_cargas for each row execute function public._compras_numero();
create or replace function public._log_carga_regras() returns trigger language plpgsql as $$
begin
  if new.status = 'em_rota' and (tg_op = 'INSERT' or old.status <> 'em_rota') and new.saida_em is null then new.saida_em := now(); end if;
  if new.status = 'concluida' and (tg_op = 'INSERT' or old.status <> 'concluida') and new.retorno_em is null then new.retorno_em := now(); end if;
  return new;
end $$;
drop trigger if exists log_carga_regras on public.log_cargas;
create trigger log_carga_regras before insert or update on public.log_cargas for each row execute function public._log_carga_regras();

-- a mesma nota não pode estar em duas cargas ativas
create or replace function public._log_nota_unica() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists(select 1 from log_carga_notas cn join log_cargas c on c.id = cn.carga_id
             where cn.nota_id = new.nota_id and cn.id <> new.id and c.status <> 'cancelada' and cn.situacao in ('pendente', 'entregue')) then
    raise exception 'A nota já está em outra carga. Tire de lá antes.';
  end if;
  if new.situacao = 'entregue' and new.entregue_em is null then new.entregue_em := now(); end if;
  return new;
end $$;
drop trigger if exists log_nota_unica on public.log_carga_notas;
create trigger log_nota_unica before insert or update on public.log_carga_notas for each row execute function public._log_nota_unica();

-- notas de saída que ainda precisam ser entregues (peso, volumes e endereço lidos do XML)
create or replace function public.log_notas_pendentes(p_empresa uuid, p_de date, p_ate date)
returns table(id uuid, numero int, serie text, emissao date, favorecido_id uuid, dest_doc text, dest_nome text, uf text, cmun text, xmun text,
              bairro text, cep text, logradouro text, nro text, peso_b numeric, peso_l numeric, q_vol numeric, v_nf numeric, mod_frete text, emit_cmun text)
language plpgsql stable security definer set search_path = public as $$
declare mods text[];
begin
  if not pode_logistica(p_empresa) then raise exception 'Sem permissão para a logística.'; end if;
  select coalesce((select mod_fretes from log_parametros where empresa_id = p_empresa), array['0', '9']) into mods;
  return query
  with ns as (select array[array['n', 'http://www.portalfiscal.inf.br/nfe']] a),
  base as (
    select n.id, n.numero, n.serie, n.emissao, n.favorecido_id, n.dest_doc, n.dest_nome, n.dest_uf, n.v_nf, n.xml::xml x
      from nfe_notas n
     where n.empresa_id = p_empresa and n.tipo = 'saida' and n.emissao_propria and n.situacao = 'autorizada'
       and coalesce(n.finalidade, '1') = '1' and n.xml is not null and n.emissao between p_de and p_ate
       and not exists(select 1 from log_carga_notas cn join log_cargas c on c.id = cn.carga_id
                       where cn.nota_id = n.id and c.status <> 'cancelada' and cn.situacao in ('pendente', 'entregue')))
  select b.id, b.numero, b.serie, b.emissao, b.favorecido_id, b.dest_doc, b.dest_nome, b.dest_uf,
         (xpath('//n:dest/n:enderDest/n:cMun/text()', b.x, ns.a))[1]::text,
         (xpath('//n:dest/n:enderDest/n:xMun/text()', b.x, ns.a))[1]::text,
         (xpath('//n:dest/n:enderDest/n:xBairro/text()', b.x, ns.a))[1]::text,
         (xpath('//n:dest/n:enderDest/n:CEP/text()', b.x, ns.a))[1]::text,
         (xpath('//n:dest/n:enderDest/n:xLgr/text()', b.x, ns.a))[1]::text,
         (xpath('//n:dest/n:enderDest/n:nro/text()', b.x, ns.a))[1]::text,
         coalesce((select sum(nullif(v::text, '')::numeric) from unnest(xpath('//n:transp/n:vol/n:pesoB/text()', b.x, ns.a)) v), 0),
         coalesce((select sum(nullif(v::text, '')::numeric) from unnest(xpath('//n:transp/n:vol/n:pesoL/text()', b.x, ns.a)) v), 0),
         coalesce((select sum(nullif(v::text, '')::numeric) from unnest(xpath('//n:transp/n:vol/n:qVol/text()', b.x, ns.a)) v), 0),
         b.v_nf,
         (xpath('//n:transp/n:modFrete/text()', b.x, ns.a))[1]::text,
         (xpath('//n:emit/n:enderEmit/n:cMun/text()', b.x, ns.a))[1]::text
    from base b, ns
   where (xpath('//n:transp/n:modFrete/text()', b.x, ns.a))[1]::text = any(mods);
end $$;

-- resumo das notas de uma lista de cargas (para as telas, sem ler o XML de novo)
create or replace function public.log_notas_das_cargas(p_empresa uuid, p_cargas uuid[])
returns table(carga_nota_id uuid, carga_id uuid, nota_id uuid, seq smallint, situacao text, entregue_em timestamptz, numero int, emissao date, dest_doc text, dest_nome text,
              uf text, cmun text, xmun text, bairro text, cep text, logradouro text, nro text, peso_kg numeric, volume_m3 numeric, v_nf numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not ve_logistica(p_empresa) then raise exception 'Sem permissão para a logística.'; end if;
  return query
  with ns as (select array[array['n', 'http://www.portalfiscal.inf.br/nfe']] a)
  select cn.id, cn.carga_id, n.id, cn.seq, cn.situacao, cn.entregue_em, n.numero, n.emissao, n.dest_doc, n.dest_nome, n.dest_uf,
         (xpath('//n:dest/n:enderDest/n:cMun/text()', n.xml::xml, ns.a))[1]::text,
         (xpath('//n:dest/n:enderDest/n:xMun/text()', n.xml::xml, ns.a))[1]::text,
         (xpath('//n:dest/n:enderDest/n:xBairro/text()', n.xml::xml, ns.a))[1]::text,
         (xpath('//n:dest/n:enderDest/n:CEP/text()', n.xml::xml, ns.a))[1]::text,
         (xpath('//n:dest/n:enderDest/n:xLgr/text()', n.xml::xml, ns.a))[1]::text,
         (xpath('//n:dest/n:enderDest/n:nro/text()', n.xml::xml, ns.a))[1]::text,
         cn.peso_kg, cn.volume_m3, n.v_nf
    from log_carga_notas cn join nfe_notas n on n.id = cn.nota_id, ns
   where cn.empresa_id = p_empresa and cn.carga_id = any(p_cargas)
   order by cn.carga_id, cn.seq;
end $$;

revoke all on function public.log_notas_pendentes(uuid, date, date), public.log_notas_das_cargas(uuid, uuid[]) from public, anon;
grant execute on function public.log_notas_pendentes(uuid, date, date), public.log_notas_das_cargas(uuid, uuid[]), public.pode_logistica(uuid), public.ve_logistica(uuid) to authenticated;

-- ---------- acesso ----------
do $$
declare t text;
begin
  foreach t in array array['log_veiculos', 'log_parametros', 'log_clientes', 'log_cargas', 'log_carga_notas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.ve_logistica(empresa_id))', t || '_sel', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.pode_logistica(empresa_id)) with check (public.pode_logistica(empresa_id))', t || '_all', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;
