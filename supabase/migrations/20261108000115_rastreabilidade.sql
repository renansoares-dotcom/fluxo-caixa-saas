-- =====================================================================
-- Melhoria contínua 6.4 — Rastreabilidade de ponta a ponta (08/11/2026)
-- Do lote da resina e da tinta até a NF-e do cliente, e de volta:
--   • a bobina passa a guardar a NF-e em que saiu (expedição), quem expediu e quando;
--   • prod_bobina_expedir(bobinas, nota): marca as bobinas como expedidas na nota (respeita o bloqueio da qualidade);
--   • prod_rastrear(empresa, termo): acha o termo (código da bobina, nº da OP, lote da resina/insumo/tinta, nº ou chave
--     da NF-e) e devolve a árvore: OPs, bobinas (mães e filhas), materiais e lotes consumidos (com a nota de entrada),
--     tintas (com os lotes pesados), inspeções e RNCs, e as notas e clientes que receberam as bobinas;
--   • prod_rastreio_config: o QR da etiqueta abre a tela de rastreabilidade (link) ou traz só o código.
-- Migração ADITIVA.
-- =====================================================================
alter table public.prod_bobinas add column if not exists nota_id uuid references public.nfe_notas(id) on delete set null;
alter table public.prod_bobinas add column if not exists expedida_em timestamptz;
alter table public.prod_bobinas add column if not exists expedida_por text;
create index if not exists prod_bobinas_nota on public.prod_bobinas(nota_id) where nota_id is not null;
create index if not exists prod_bobinas_mae on public.prod_bobinas(mae_id) where mae_id is not null;
create index if not exists prod_bobinas_lote on public.prod_bobinas(empresa_id, lote_materia) where lote_materia is not null;
create index if not exists prod_consumos_lote on public.prod_consumos(empresa_id, lote) where lote is not null;

create table if not exists public.prod_rastreio_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  qr_link boolean not null default true,                 -- QR com o endereço da tela (o celular abre direto) ou só o código
  exigir_nota boolean not null default false,            -- expedição só com a NF-e informada
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
alter table public.prod_rastreio_config enable row level security;
drop policy if exists prod_rastreio_config_sel on public.prod_rastreio_config;
drop policy if exists prod_rastreio_config_ins on public.prod_rastreio_config;
drop policy if exists prod_rastreio_config_upd on public.prod_rastreio_config;
create policy prod_rastreio_config_sel on public.prod_rastreio_config for select to authenticated using (public.is_participante(empresa_id));
create policy prod_rastreio_config_ins on public.prod_rastreio_config for insert to authenticated with check (public.pode_editar(empresa_id));
create policy prod_rastreio_config_upd on public.prod_rastreio_config for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
grant select, insert, update on public.prod_rastreio_config to authenticated;
drop trigger if exists zz_auditoria on public.prod_rastreio_config;
create trigger zz_auditoria after insert or update or delete on public.prod_rastreio_config for each row execute function public._auditar();

-- expedição: bobinas em estoque e liberadas saem na nota (ou sem nota, se a empresa não exigir)
create or replace function public.prod_bobina_expedir(p_bobinas uuid[], p_nota uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_n int; v_exige boolean; v_nota nfe_notas;
begin
  select distinct empresa_id into v_emp from prod_bobinas where id = any(p_bobinas);
  if v_emp is null then raise exception 'Nenhuma bobina encontrada.'; end if;
  if (select count(distinct empresa_id) from prod_bobinas where id = any(p_bobinas)) > 1 then raise exception 'Bobinas de empresas diferentes.'; end if;
  if not public.pode_estoque(v_emp) then raise exception 'Sem permissão para expedir.'; end if;
  select coalesce(exigir_nota, false) into v_exige from prod_rastreio_config where empresa_id = v_emp;
  if p_nota is null and coalesce(v_exige, false) then raise exception 'Informe a NF-e da expedição.'; end if;
  if p_nota is not null then
    select * into v_nota from nfe_notas where id = p_nota;
    if v_nota.empresa_id is distinct from v_emp then raise exception 'NF-e de outra empresa.'; end if;
    if v_nota.tipo <> 'saida' or not v_nota.emissao_propria then raise exception 'A NF-e precisa ser de saída, emitida pela empresa.'; end if;
    if v_nota.situacao <> 'autorizada' then raise exception 'A NF-e não está autorizada.'; end if;
  end if;
  if exists (select 1 from prod_bobinas where id = any(p_bobinas) and situacao <> 'estoque') then
    raise exception 'Só bobinas em estoque podem ser expedidas: %', (select string_agg(codigo, ', ') from prod_bobinas where id = any(p_bobinas) and situacao <> 'estoque');
  end if;
  -- o bloqueio da qualidade (gatilho do SQL 087) recusa bobina bloqueada ou reprovada
  update prod_bobinas set situacao = 'expedida', nota_id = p_nota, expedida_em = now(), expedida_por = auth.jwt() ->> 'email'
   where id = any(p_bobinas);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.prod_bobina_expedir(uuid[], uuid) from public, anon;
grant execute on function public.prod_bobina_expedir(uuid[], uuid) to authenticated;

-- desfaz a expedição (bobina volta ao estoque), com motivo na auditoria
create or replace function public.prod_bobina_desfazer_expedicao(p_bobina uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare b prod_bobinas;
begin
  select * into b from prod_bobinas where id = p_bobina;
  if b.id is null then raise exception 'Bobina não encontrada.'; end if;
  if not public.pode_editar(b.empresa_id) then raise exception 'Sem permissão.'; end if;
  if b.situacao <> 'expedida' then raise exception 'A bobina não está expedida.'; end if;
  if coalesce(length(trim(p_motivo)), 0) < 5 then raise exception 'Informe o motivo.'; end if;
  update prod_bobinas set situacao = 'estoque', nota_id = null, expedida_em = null, expedida_por = null where id = p_bobina;
end $$;
revoke all on function public.prod_bobina_desfazer_expedicao(uuid, text) from public, anon;
grant execute on function public.prod_bobina_desfazer_expedicao(uuid, text) to authenticated;

-- rastreabilidade
create or replace function public.prod_rastrear(p_empresa uuid, p_termo text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t text := upper(trim(coalesce(p_termo, ''))); v_ops uuid[]; v_bob uuid[]; v_ach jsonb := '[]'::jsonb; v_out jsonb;
begin
  if not public.is_participante(p_empresa) then raise exception 'Sem permissão.'; end if;
  if length(t) < 2 then raise exception 'Informe ao menos 2 caracteres.'; end if;
  -- termo lido do QR com link: fica só o código depois de "b="
  if t ~ '[?&]B=' then t := upper(regexp_replace(t, '^.*[?&]B=([^&#]+).*$', '\1')); end if;

  -- 1) bobinas pelo código
  select array_agg(id) into v_bob from prod_bobinas where empresa_id = p_empresa and upper(codigo) = t;
  if v_bob is not null then v_ach := v_ach || jsonb_build_array(jsonb_build_object('tipo', 'bobina', 'txt', 'Bobina ' || t)); end if;

  -- 2) OPs: das bobinas, pelo número, pelo lote consumido, pelo lote da tinta e pelas notas
  select array_agg(distinct id) into v_ops from (
    select ordem_id id from prod_bobinas where id = any(coalesce(v_bob, '{}'))
    union select id from prod_ordens where empresa_id = p_empresa and (numero::text = t or upper(coalesce(numero_iniflex, '')) = t)
    union select ordem_id from prod_consumos where empresa_id = p_empresa and upper(coalesce(lote, '')) = t
    union select ordem_id from prod_bobinas where empresa_id = p_empresa and upper(coalesce(lote_materia, '')) = t
    union select c.ordem_id from prod_consumos c join est_lotes l on l.empresa_id = c.empresa_id and l.produto_id = c.produto_id and upper(l.codigo) = upper(c.lote)
     where c.empresa_id = p_empresa and upper(coalesce(l.lote_fornecedor, '')) = t
    union select ordem_id from tin_ordens where empresa_id = p_empresa and ordem_id is not null and upper(coalesce(lote_codigo, '')) = t
    union select t2.ordem_id from tin_pesagens p join est_lotes l on l.id = p.lote_id join tin_ordens t2 on t2.id = p.ordem_id
     where p.empresa_id = p_empresa and t2.ordem_id is not null and (upper(l.codigo) = t or upper(coalesce(l.lote_fornecedor, '')) = t)
    union select b.ordem_id from prod_bobinas b join nfe_notas n on n.id = b.nota_id where b.empresa_id = p_empresa and (n.numero::text = t or upper(n.chave) = t)
  ) x where id is not null;
  if exists (select 1 from prod_ordens where empresa_id = p_empresa and (numero::text = t or upper(coalesce(numero_iniflex, '')) = t)) then
    v_ach := v_ach || jsonb_build_array(jsonb_build_object('tipo', 'op', 'txt', 'OP ' || t)); end if;
  if exists (select 1 from prod_consumos where empresa_id = p_empresa and upper(coalesce(lote, '')) = t)
     or exists (select 1 from prod_bobinas where empresa_id = p_empresa and upper(coalesce(lote_materia, '')) = t)
     or exists (select 1 from est_lotes where empresa_id = p_empresa and (upper(codigo) = t or upper(coalesce(lote_fornecedor, '')) = t)) then
    v_ach := v_ach || jsonb_build_array(jsonb_build_object('tipo', 'lote', 'txt', 'Lote ' || t)); end if;
  if exists (select 1 from tin_ordens where empresa_id = p_empresa and upper(coalesce(lote_codigo, '')) = t) then
    v_ach := v_ach || jsonb_build_array(jsonb_build_object('tipo', 'tinta', 'txt', 'Lote de tinta ' || t)); end if;
  if exists (select 1 from nfe_notas where empresa_id = p_empresa and (numero::text = t or upper(chave) = t)) then
    v_ach := v_ach || jsonb_build_array(jsonb_build_object('tipo', 'nota', 'txt', 'NF-e ' || t)); end if;

  -- caminho completo: bobinas das OPs encontradas e as mães e filhas delas (até 6 níveis), e as OPs dessas bobinas
  with recursive base as (
    select unnest(coalesce(v_bob, '{}')) id union select id from prod_bobinas where ordem_id = any(coalesce(v_ops, '{}'))
  ), sobe(id, n) as (
    select id, 0 from base
    union select b.mae_id, s.n + 1 from sobe s join prod_bobinas b on b.id = s.id where b.mae_id is not null and s.n < 6
  ), desce(id, n) as (
    select id, 0 from base
    union select b.id, d.n + 1 from desce d join prod_bobinas b on b.mae_id = d.id where d.n < 6
  )
  select array_agg(distinct id) into v_bob from (select id from sobe union select id from desce) x where id is not null;
  select array_agg(distinct id) into v_ops from (select unnest(coalesce(v_ops, '{}')) id union select ordem_id from prod_bobinas where id = any(coalesce(v_bob, '{}'))) x;

  select jsonb_build_object(
    'termo', t, 'achados', v_ach,
    'ops', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'numero', o.numero, 'numero_iniflex', o.numero_iniflex, 'produto', trim(coalesce(o.codigo_produto, '') || ' ' || coalesce(o.descricao, '')),
              'cliente', o.cliente, 'status', o.status, 'emissao', o.emissao, 'concluida_em', o.concluida_em) order by o.emissao, o.numero), '[]'::jsonb)
              from prod_ordens o where o.id = any(coalesce(v_ops, '{}'))),
    'bobinas', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'codigo', b.codigo, 'ordem_id', b.ordem_id, 'mae_id', b.mae_id, 'peso_kg', b.peso_kg, 'metros', b.metros,
              'lote_materia', b.lote_materia, 'situacao', b.situacao, 'qualidade', b.qualidade, 'criado_em', b.criado_em, 'maquina', m.codigo,
              'nota_id', b.nota_id, 'nota', n.numero, 'expedida_em', b.expedida_em) order by b.criado_em), '[]'::jsonb)
              from prod_bobinas b left join prod_maquinas m on m.id = b.maquina_id left join nfe_notas n on n.id = b.nota_id where b.id = any(coalesce(v_bob, '{}'))),
    'materiais', (select coalesce(jsonb_agg(x order by x->>'ordem_id', x->>'codigo'), '[]'::jsonb) from (
              select jsonb_build_object('ordem_id', c.ordem_id, 'codigo', coalesce(p.codigo, c.codigo), 'descricao', p.descricao, 'lote', c.lote, 'qtd', sum(c.quantidade),
                'lote_fornecedor', max(l.lote_fornecedor), 'fornecedor', max(f.nome), 'nota_entrada', max(ne.numero), 'nota_entrada_data', max(ne.emissao)) x
                from prod_consumos c left join produtos p on p.id = c.produto_id
                left join est_lotes l on l.empresa_id = c.empresa_id and l.produto_id = c.produto_id and upper(l.codigo) = upper(c.lote)
                left join favorecidos f on f.id = l.fornecedor_id
                left join lateral (select n.numero, n.emissao from est_movimentos mv join nfe_notas n on n.id = mv.nota_id where mv.lote_id = l.id and mv.nota_id is not null order by mv.data limit 1) ne on true
               where c.ordem_id = any(coalesce(v_ops, '{}')) group by c.ordem_id, coalesce(p.codigo, c.codigo), p.descricao, c.lote) z),
    'tintas', (select coalesce(jsonb_agg(jsonb_build_object('ordem_id', tt.ordem_id, 'numero', tt.numero, 'cor', co.nome, 'lote', tt.lote_codigo, 'kg', tt.quantidade_real, 'situacao', tt.situacao,
              'componentes', (select coalesce(jsonb_agg(jsonb_build_object('codigo', p.codigo, 'descricao', p.descricao, 'lote', l.codigo, 'lote_fornecedor', l.lote_fornecedor, 'kg', pe.pesada)), '[]'::jsonb)
                              from tin_pesagens pe join produtos p on p.id = pe.produto_id left join est_lotes l on l.id = pe.lote_id where pe.ordem_id = tt.id and pe.situacao = 'pesada'))), '[]'::jsonb)
              from tin_ordens tt left join tin_cores co on co.id = tt.cor_id where tt.ordem_id = any(coalesce(v_ops, '{}')) and tt.situacao <> 'cancelada'),
    'qualidade', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
              select jsonb_build_object('tipo', 'inspeção', 'numero', i.numero, 'situacao', i.situacao, 'bobina_id', i.bobina_id, 'ordem_id', i.ordem_id, 'data', i.criado_em) x
                from qual_inspecoes i where i.empresa_id = p_empresa and (i.bobina_id = any(coalesce(v_bob, '{}')) or i.ordem_id = any(coalesce(v_ops, '{}')))
              union all
              select jsonb_build_object('tipo', 'RNC', 'numero', r.numero, 'situacao', r.situacao, 'bobina_id', r.bobina_id, 'ordem_id', r.ordem_id, 'data', r.aberta_em)
                from qual_rnc r where r.empresa_id = p_empresa and (r.bobina_id = any(coalesce(v_bob, '{}')) or r.ordem_id = any(coalesce(v_ops, '{}')))) z),
    'notas', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'numero', n.numero, 'emissao', n.emissao, 'cliente', n.dest_nome, 'cnpj', n.dest_doc, 'uf', n.dest_uf,
              'bobinas', (select count(*) from prod_bobinas b where b.nota_id = n.id and b.id = any(coalesce(v_bob, '{}'))),
              'kg', (select sum(peso_kg) from prod_bobinas b where b.nota_id = n.id and b.id = any(coalesce(v_bob, '{}'))),
              'carga', (select max(c.numero) from log_carga_notas cn join log_cargas c on c.id = cn.carga_id where cn.nota_id = n.id),
              'entrega', (select max(cn.situacao) from log_carga_notas cn where cn.nota_id = n.id)) order by n.emissao), '[]'::jsonb)
              from nfe_notas n where n.id in (select nota_id from prod_bobinas where id = any(coalesce(v_bob, '{}')) and nota_id is not null))
  ) into v_out;
  return v_out;
end $$;
revoke all on function public.prod_rastrear(uuid, text) from public, anon;
grant execute on function public.prod_rastrear(uuid, text) to authenticated;

-- conferência: 3 colunas novas, 1 tabela e 3 funções
select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'prod_bobinas' and column_name in ('nota_id', 'expedida_em', 'expedida_por')) as colunas,
       (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'prod_rastreio_config') as tabela,
       (select count(*) from pg_proc where proname in ('prod_bobina_expedir', 'prod_bobina_desfazer_expedicao', 'prod_rastrear')) as funcoes;
