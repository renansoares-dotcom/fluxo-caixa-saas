-- =====================================================================
-- Regime tributário por empresa (04/11/2026; Renan: "Precisamos criar nova empresa, para isso a plataforma terá que
-- atender o simples nacional").
--  - empresa_tributacao: regime de cada empresa com data de início de vigência (Simples Nacional, MEI, Lucro Presumido,
--    Lucro Real). Uma linha por mudança: a plataforma usa a linha vigente na data do que estiver calculando.
--    No Simples guarda as atividades (CNAE, anexo, Fator R), o sublimite e a opção do IBS/CBS pelo regime regular
--    (LC 214/2025; a opção vale por semestre, então cada semestre com opção diferente é uma linha nova).
--  - plataforma_admins: quem pode criar empresas mesmo com a criação bloqueada (criar_empresa_liberado = false).
--    Sem políticas: só as funções leem; o cadastro é feito pelo SQL Editor.
--  - criar_empresa_completa: cria a empresa (mesmo caminho do criar_empresa) e já grava o regime; no Simples e no MEI
--    o grupo 2.08 Tributos do plano modelo vem com as contas do Simples (DAS) em vez de PIS/COFINS e IRPJ/CSLL.
--  - A IPLAMM recebe a linha atual: Lucro Real, PIS/COFINS não cumulativo, PRODEPE, desde 01/01/2026.
-- Migração ADITIVA; pode rodar mais de uma vez. Não altera lançamentos, notas nem o plano de contas existente.
-- =====================================================================

create table if not exists public.empresa_tributacao (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  vigencia_inicio date not null,
  regime text not null check (regime in ('simples', 'mei', 'presumido', 'real')),
  pis_cofins text check (pis_cofins in ('cumulativo', 'nao_cumulativo')),          -- Presumido/Real
  irpj_apuracao text check (irpj_apuracao in ('trimestral', 'anual')),            -- Presumido/Real
  simples_atividades jsonb not null default '[]'::jsonb,   -- [{cnae, descricao, anexo 'I'..'V', fator_r bool}]
  sublimite_excedido boolean not null default false,       -- Simples: RBT12 acima de 3,6 mi → ICMS e ISS fora do DAS
  ibscbs_regular boolean not null default false,           -- Simples: IBS e CBS pelo regime regular (fora do DAS)
  incentivos text,                                          -- ex.: PRODEPE
  uf char(2),
  municipio_ibge text,
  cnae_principal text,
  contabilidade text,                                       -- escritório / responsável
  observacao text,
  fonte text,                                               -- de onde veio a informação (cartão CNPJ, contabilidade…)
  criado_em timestamptz not null default now(),
  criado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, vigencia_inicio),
  constraint empresa_tributacao_coerente check (
    (regime in ('simples', 'mei') and pis_cofins is null and irpj_apuracao is null)
    or (regime = 'presumido' and coalesce(pis_cofins, 'cumulativo') = 'cumulativo' and not sublimite_excedido and not ibscbs_regular)
    or (regime = 'real' and not sublimite_excedido and not ibscbs_regular)),
  constraint empresa_tributacao_atividades check (jsonb_typeof(simples_atividades) = 'array')
);
create index if not exists empresa_tributacao_emp on public.empresa_tributacao(empresa_id, vigencia_inicio desc);

alter table public.empresa_tributacao enable row level security;
do $$ declare a text; begin
  foreach a in array array['sel','ins','upd','del'] loop execute format('drop policy if exists empresa_tributacao_%s on public.empresa_tributacao', a); end loop;
end $$;
create policy empresa_tributacao_sel on public.empresa_tributacao for select to authenticated using (empresa_id in (select public.minhas_empresas()));
create policy empresa_tributacao_ins on public.empresa_tributacao for insert to authenticated with check (public.is_admin(empresa_id));
create policy empresa_tributacao_upd on public.empresa_tributacao for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
create policy empresa_tributacao_del on public.empresa_tributacao for delete to authenticated using (public.is_admin(empresa_id));

drop trigger if exists zz_auditoria on public.empresa_tributacao;
create trigger zz_auditoria after insert or update or delete on public.empresa_tributacao for each row execute function public._auditar();

create or replace function public._empresa_tributacao_upd() returns trigger language plpgsql set search_path = public as $$
begin new.atualizado_em := now(); return new; end $$;
revoke all on function public._empresa_tributacao_upd() from public, anon, authenticated;
drop trigger if exists empresa_tributacao_upd on public.empresa_tributacao;
create trigger empresa_tributacao_upd before update on public.empresa_tributacao for each row execute function public._empresa_tributacao_upd();

-- regime vigente numa data (a linha com o maior início de vigência até a data); vale a RLS de quem chama
create or replace function public.regime_em(p_empresa uuid, p_data date default current_date)
returns public.empresa_tributacao language sql stable security invoker set search_path = public as $$
  select * from empresa_tributacao where empresa_id = p_empresa and vigencia_inicio <= coalesce(p_data, current_date)
  order by vigencia_inicio desc limit 1;
$$;
revoke execute on function public.regime_em(uuid, date) from public, anon;
grant execute on function public.regime_em(uuid, date) to authenticated;

-- ---------- quem pode criar empresas ----------
create table if not exists public.plataforma_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  observacao text,
  criado_em timestamptz not null default now()
);
alter table public.plataforma_admins enable row level security;   -- sem políticas: cadastro só pelo SQL Editor

create or replace function public.pode_criar_empresa()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (valor #>> '{}')::boolean from plataforma_parametros where chave = 'criar_empresa_liberado'), false)
      or exists (select 1 from plataforma_admins where user_id = auth.uid());
$$;
revoke execute on function public.pode_criar_empresa() from public;
grant execute on function public.pode_criar_empresa() to anon, authenticated;

-- ---------- criar a empresa já com o regime ----------
-- p_trib: {regime, vigencia_inicio, pis_cofins, irpj_apuracao, simples_atividades, sublimite_excedido, ibscbs_regular,
--          incentivos, uf, municipio_ibge, cnae_principal, contabilidade, observacao, fonte}
create or replace function public.criar_empresa_completa(p_nome text, p_cnpj text default null, p_ano int default null, p_trib jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_reg text := nullif(p_trib->>'regime', ''); v_pai uuid; v_ano int := coalesce(p_ano, extract(year from now())::int);
begin
  if v_reg is not null and v_reg not in ('simples', 'mei', 'presumido', 'real') then raise exception 'Regime tributário inválido: %', v_reg; end if;
  v_emp := criar_empresa(p_nome, nullif(trim(coalesce(p_cnpj, '')), ''), v_ano);   -- confere login e o bloqueio da criação
  if v_reg is null then return v_emp; end if;
  insert into empresa_tributacao(empresa_id, vigencia_inicio, regime, pis_cofins, irpj_apuracao, simples_atividades, sublimite_excedido,
      ibscbs_regular, incentivos, uf, municipio_ibge, cnae_principal, contabilidade, observacao, fonte)
    values (v_emp, coalesce(nullif(p_trib->>'vigencia_inicio', '')::date, make_date(v_ano, 1, 1)), v_reg,
      case when v_reg in ('presumido', 'real') then coalesce(nullif(p_trib->>'pis_cofins', ''), case v_reg when 'real' then 'nao_cumulativo' else 'cumulativo' end) end,
      case when v_reg in ('presumido', 'real') then nullif(p_trib->>'irpj_apuracao', '') end,
      case when v_reg in ('simples', 'mei') then coalesce(p_trib->'simples_atividades', '[]'::jsonb) else '[]'::jsonb end,
      v_reg = 'simples' and coalesce((p_trib->>'sublimite_excedido')::boolean, false),
      v_reg = 'simples' and coalesce((p_trib->>'ibscbs_regular')::boolean, false),
      nullif(p_trib->>'incentivos', ''), nullif(upper(p_trib->>'uf'), ''), nullif(p_trib->>'municipio_ibge', ''),
      nullif(p_trib->>'cnae_principal', ''), nullif(p_trib->>'contabilidade', ''), nullif(p_trib->>'observacao', ''),
      coalesce(nullif(p_trib->>'fonte', ''), 'Informado na criação da empresa'));
  -- Simples e MEI: contas de tributos do Simples no lugar das do Lucro Presumido/Real (empresa recém-criada, sem lançamentos)
  if v_reg in ('simples', 'mei') then
    select id into v_pai from plano_contas where empresa_id = v_emp and codigo = '2.08';
    if v_pai is not null then
      delete from plano_contas where empresa_id = v_emp and pai_id = v_pai;
      insert into plano_contas(empresa_id, codigo, nome, tipo, natureza, nivel, pai_id)
        select v_emp, '2.08.' || lpad(i::text, 2, '0'), x, 'S', 'D', 2, v_pai
        from unnest(case v_reg when 'mei' then array['DAS-MEI', 'PARCELAMENTOS']
                     else array['SIMPLES NACIONAL / DAS', 'ICMS-ST, DIFAL E ANTECIPAÇÃO', 'ISS RETIDO', 'INSS PATRONAL (ANEXO IV)', 'IBS E CBS (REGIME REGULAR)', 'PARCELAMENTOS'] end)
          with ordinality as t(x, i);
    end if;
  end if;
  return v_emp;
end $$;
revoke execute on function public.criar_empresa_completa(text, text, int, jsonb) from public, anon;
grant execute on function public.criar_empresa_completa(text, text, int, jsonb) to authenticated;

-- ---------- IPLAMM: regime atual ----------
insert into public.empresa_tributacao(empresa_id, vigencia_inicio, regime, pis_cofins, incentivos, uf, fonte)
select id, date '2026-01-01', 'real', 'nao_cumulativo', 'PRODEPE (ICMS)', 'PE', 'Informado pelo Renan (14/10/2026): Lucro Real, PIS/COFINS não cumulativo, PRODEPE'
from public.empresas where regexp_replace(coalesce(cnpj, ''), '\D', '', 'g') = '14677338000197'
on conflict (empresa_id, vigencia_inicio) do nothing;

-- conferência: tabelas = 2, politicas = 4, funcoes = 3, iplamm = 1 (0 no banco de testes)
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('empresa_tributacao', 'plataforma_admins')) as tabelas,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'empresa_tributacao') as politicas,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
          and p.proname in ('regime_em', 'criar_empresa_completa', 'pode_criar_empresa')) as funcoes,
       (select count(*) from public.empresa_tributacao t join public.empresas e on e.id = t.empresa_id where t.regime = 'real') as iplamm;
