-- =====================================================================
-- Contabilidade — etapa 1: plano de contas contábil, balancetes da contabilidade e saldo de abertura
--  - só cria tabelas novas; não toca em lançamentos, contas bancárias, conciliações nem plano gerencial
--  - valores com sinal: devedor positivo, credor negativo (débito/crédito do período sempre positivos)
--  - gravação só pela função importar_balancete_contabil, que confere tudo de novo no banco
-- =====================================================================

-- 1) plano de contas contábil (vem do balancete da contabilidade; nunca é apagado pela importação)
create table if not exists public.contab_contas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo int,                                   -- código reduzido da contabilidade
  classificacao text not null,                  -- ex.: 1.1.10.200.0003
  descricao text not null,
  nivel int not null,
  tipo char(1) not null check (tipo in ('S', 'A')),        -- sintética / analítica
  natureza char(1) not null check (natureza in ('D', 'C')),
  pai_id uuid references public.contab_contas(id) on delete set null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, classificacao)
);
create index if not exists contab_contas_cod on public.contab_contas(empresa_id, codigo);

-- 2) balancetes oficiais importados (um por período; reimportar o mesmo período substitui)
create table if not exists public.contab_balancetes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  data_ini date not null,
  data_fim date not null,
  arquivo_nome text,
  arquivo_hash text,                            -- SHA-256 do PDF importado
  resumo jsonb,                                 -- "Resumo do balancete" da última página
  importado_por uuid default auth.uid(),
  importado_email text default (auth.jwt() ->> 'email'),
  importado_em timestamptz not null default now(),
  unique (empresa_id, data_ini, data_fim),
  check (data_fim >= data_ini)
);

create table if not exists public.contab_balancete_itens (
  balancete_id uuid not null references public.contab_balancetes(id) on delete cascade,
  conta_id uuid not null references public.contab_contas(id) on delete cascade,
  saldo_anterior numeric(16,2) not null default 0,
  debito numeric(16,2) not null default 0,
  credito numeric(16,2) not null default 0,
  saldo_atual numeric(16,2) not null default 0,
  primary key (balancete_id, conta_id)
);
create index if not exists contab_bal_itens_conta on public.contab_balancete_itens(conta_id);

-- 3) saldo de abertura (ponto de partida da contabilidade feita pela plataforma)
create table if not exists public.contab_saldos_abertura (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  data date not null,                           -- saldo no fim deste dia (ex.: 31/12/2025)
  conta_id uuid not null references public.contab_contas(id) on delete cascade,
  saldo numeric(16,2) not null,
  balancete_id uuid references public.contab_balancetes(id) on delete set null,
  primary key (conta_id, data)
);
create index if not exists contab_abertura_emp on public.contab_saldos_abertura(empresa_id, data);

-- RLS: todos os membros consultam; gravação só pela função abaixo (e excluir balancete: quem edita)
alter table public.contab_contas enable row level security;
alter table public.contab_balancetes enable row level security;
alter table public.contab_balancete_itens enable row level security;
alter table public.contab_saldos_abertura enable row level security;
drop policy if exists contab_contas_sel on public.contab_contas;
drop policy if exists contab_bal_sel on public.contab_balancetes;
drop policy if exists contab_bal_del on public.contab_balancetes;
drop policy if exists contab_bal_itens_sel on public.contab_balancete_itens;
drop policy if exists contab_abertura_sel on public.contab_saldos_abertura;
create policy contab_contas_sel on public.contab_contas for select to authenticated using (public.is_membro(empresa_id));
create policy contab_bal_sel on public.contab_balancetes for select to authenticated using (public.is_membro(empresa_id));
create policy contab_bal_del on public.contab_balancetes for delete to authenticated using (public.pode_editar(empresa_id));
create policy contab_bal_itens_sel on public.contab_balancete_itens for select to authenticated
  using (exists (select 1 from public.contab_balancetes b where b.id = balancete_id and public.is_membro(b.empresa_id)));
create policy contab_abertura_sel on public.contab_saldos_abertura for select to authenticated using (public.is_membro(empresa_id));
grant select on public.contab_contas, public.contab_balancetes, public.contab_balancete_itens, public.contab_saldos_abertura to authenticated;
grant delete on public.contab_balancetes to authenticated;

-- 4) importação (tudo ou nada)
-- p_contas: [{codigo, classificacao, descricao, nivel, tipo, natureza, pai, ant, deb, cred, atu}, ...] na ordem do relatório
create or replace function public.importar_balancete_contabil(
  p_empresa uuid, p_ini date, p_fim date, p_arquivo text, p_hash text, p_resumo jsonb, p_contas jsonb, p_abertura boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_bal uuid; v_n int; v_dif numeric; v_novas int; v_abert date := p_ini - 1;
begin
  if not public.pode_editar(p_empresa) then raise exception 'Sem permissão para importar balancete.'; end if;
  if jsonb_typeof(p_contas) <> 'array' or jsonb_array_length(p_contas) = 0 then raise exception 'Balancete sem contas.'; end if;

  drop table if exists _bal;
  create temp table _bal on commit drop as
    select (e->>'codigo')::int codigo, e->>'classificacao' classificacao, left(e->>'descricao', 200) descricao,
           (e->>'nivel')::int nivel, e->>'tipo' tipo, e->>'natureza' natureza, e->>'pai' pai,
           round((e->>'ant')::numeric, 2) ant, round((e->>'deb')::numeric, 2) deb, round((e->>'cred')::numeric, 2) cred, round((e->>'atu')::numeric, 2) atu
    from jsonb_array_elements(p_contas) e;

  -- conferências no banco (as mesmas da tela)
  if exists (select 1 from _bal where classificacao !~ '^\d+(\.\d+)*$' or descricao is null or tipo not in ('S','A') or natureza not in ('D','C')) then
    raise exception 'Balancete com conta inválida.'; end if;
  if (select count(*) from _bal) <> (select count(distinct classificacao) from _bal) then raise exception 'Balancete com conta repetida.'; end if;
  select count(*) into v_n from _bal where abs(ant + deb - cred - atu) > 0.01;
  if v_n > 0 then raise exception 'Balancete não confere: % conta(s) com anterior + débito − crédito diferente do saldo atual.', v_n; end if;
  select coalesce(sum(atu), 0) into v_dif from _bal where nivel = 1;
  if abs(v_dif) > 0.01 then raise exception 'Balancete não fecha: devedoras − credoras = %.', v_dif; end if;
  select coalesce(sum(ant), 0) into v_dif from _bal where nivel = 1;
  if abs(v_dif) > 0.01 then raise exception 'Saldo anterior não fecha: devedoras − credoras = %.', v_dif; end if;
  select count(*) into v_n from _bal m where m.tipo = 'S' and abs(m.atu - (select coalesce(sum(f.atu), 0) from _bal f where f.pai = m.classificacao)) > 0.01;
  if v_n > 0 then raise exception 'Balancete não confere: % conta(s) sintética(s) diferente(s) da soma das contas abaixo.', v_n; end if;

  -- plano de contas: inclui as novas e atualiza descrição/código/estrutura das existentes
  select count(*) into v_novas from _bal b where not exists (select 1 from contab_contas c where c.empresa_id = p_empresa and c.classificacao = b.classificacao);
  insert into contab_contas(empresa_id, codigo, classificacao, descricao, nivel, tipo, natureza)
    select p_empresa, codigo, classificacao, descricao, nivel, tipo, natureza from _bal
  on conflict (empresa_id, classificacao) do update
    set codigo = excluded.codigo, descricao = excluded.descricao, nivel = excluded.nivel, tipo = excluded.tipo,
        natureza = excluded.natureza, ativo = true, updated_at = now();
  update contab_contas c set pai_id = p.id
    from _bal b join contab_contas p on p.empresa_id = p_empresa and p.classificacao = b.pai
   where c.empresa_id = p_empresa and c.classificacao = b.classificacao and c.pai_id is distinct from p.id;

  -- balancete do período (substitui se já existia)
  delete from contab_balancetes where empresa_id = p_empresa and data_ini = p_ini and data_fim = p_fim;
  insert into contab_balancetes(empresa_id, data_ini, data_fim, arquivo_nome, arquivo_hash, resumo)
    values (p_empresa, p_ini, p_fim, p_arquivo, p_hash, p_resumo) returning id into v_bal;
  insert into contab_balancete_itens(balancete_id, conta_id, saldo_anterior, debito, credito, saldo_atual)
    select v_bal, c.id, b.ant, b.deb, b.cred, b.atu from _bal b join contab_contas c on c.empresa_id = p_empresa and c.classificacao = b.classificacao;

  -- saldo de abertura = saldo anterior das contas analíticas, no dia anterior ao início do período
  if p_abertura then
    delete from contab_saldos_abertura where empresa_id = p_empresa and data = v_abert;
    insert into contab_saldos_abertura(empresa_id, data, conta_id, saldo, balancete_id)
      select p_empresa, v_abert, c.id, b.ant, v_bal from _bal b join contab_contas c on c.empresa_id = p_empresa and c.classificacao = b.classificacao
       where b.tipo = 'A' and b.ant <> 0;
  end if;

  return jsonb_build_object('balancete_id', v_bal, 'contas', (select count(*) from _bal), 'novas', v_novas,
    'abertura', case when p_abertura then v_abert end);
end $$;
revoke all on function public.importar_balancete_contabil(uuid, date, date, text, text, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.importar_balancete_contabil(uuid, date, date, text, text, jsonb, jsonb, boolean) to authenticated;
