-- Comissões pelo recebido e extrato do representante (melhoria 4.3 do plano de melhoria contínua, Passo 4) — 08/11/2026.
-- Aditivo.
--   • a comissão nasce do RECEBIMENTO: título a receber pago, ligado à NF-e de venda (nfe_vinculos), do cliente da
--     carteira do representante (favorecidos.representante_id);
--   • taxa do representante com exceção por cliente; base pelo recebido ou sem IPI/ST; redução por atraso;
--     título cedido ao FIDC conta na cessão ou no vencimento + carência (sem recompra); recompra depois de paga vira estorno;
--   • fechamento mensal por representante: congela os itens (o mesmo recebimento nunca entra duas vezes), gera o
--     título a pagar da comissão e avisa o representante; o representante vê o próprio extrato.

-- 1) taxa do representante
alter table public.comercial_vendedores add column if not exists comissao_pct numeric(5,2) not null default 0;
do $$ begin
  alter table public.comercial_vendedores add constraint comercial_vend_comissao_chk check (comissao_pct between 0 and 30);
exception when duplicate_object then null; end $$;

-- 2) parâmetros
create table if not exists public.comissao_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  base text not null default 'recebido' check (base in ('recebido', 'sem_impostos')),          -- sem_impostos: tira IPI e ST na proporção da nota
  fidc_regra text not null default 'cessao' check (fidc_regra in ('cessao', 'vencimento')),   -- título cedido: na cessão ou no vencimento + carência
  fidc_carencia_dias int not null default 5 check (fidc_carencia_dias between 0 and 60),
  atraso_dias int not null default 0 check (atraso_dias between 0 and 365),                   -- 0 = sem redução por atraso
  atraso_reducao_pct numeric(5,2) not null default 0 check (atraso_reducao_pct between 0 and 100),
  inicio date not null default date_trunc('month', current_date)::date,                      -- recebimentos antes disso não entram
  plano_id uuid references public.plano_contas(id) on delete set null,                       -- conta da despesa (vazio: não gera o título a pagar)
  dia_pagamento int not null default 10 check (dia_pagamento between 1 and 28),
  papeis_fechar text[] not null default array['admin', 'diretor', 'financeiro'],
  atualizado_em timestamptz not null default now()
);

-- taxa diferente para um cliente (do representante ou de todos)
create table if not exists public.comissao_excecoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  vendedor_id uuid references public.comercial_vendedores(id) on delete cascade,   -- vazio: vale para qualquer representante
  favorecido_id uuid not null references public.favorecidos(id) on delete cascade,
  pct numeric(5,2) not null check (pct between 0 and 30),
  motivo text
);
create unique index if not exists comissao_exc_uk on public.comissao_excecoes(empresa_id, coalesce(vendedor_id, '00000000-0000-0000-0000-000000000000'::uuid), favorecido_id);

-- 3) fechamentos e itens
create table if not exists public.comissao_fechamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  vendedor_id uuid not null references public.comercial_vendedores(id) on delete restrict,
  competencia date not null check (extract(day from competencia) = 1),
  base_total numeric(16,2) not null default 0,
  comissao_total numeric(16,2) not null default 0,
  ajuste numeric(16,2) not null default 0, ajuste_motivo text,
  total numeric(16,2) not null default 0,
  situacao text not null default 'fechado' check (situacao in ('fechado', 'cancelado')),
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  fechado_por text default (auth.jwt() ->> 'email'), fechado_em timestamptz not null default now(),
  cancelado_por text, cancelado_em timestamptz, cancelado_motivo text
);
create unique index if not exists comissao_fech_uk on public.comissao_fechamentos(vendedor_id, competencia) where situacao = 'fechado';
create table if not exists public.comissao_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  fechamento_id uuid not null references public.comissao_fechamentos(id) on delete cascade,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  tipo text not null default 'comissao' check (tipo in ('comissao', 'estorno')),
  nota_numero int, favorecido_id uuid, cliente text, documento text,
  recebido_em date, vencimento date, dias_atraso int,
  valor_recebido numeric(16,2) not null, base numeric(16,2) not null, pct numeric(5,2) not null, reducao_pct numeric(5,2) not null default 0,
  comissao numeric(16,2) not null
);
create unique index if not exists comissao_itens_uk on public.comissao_itens(lancamento_id, tipo) where lancamento_id is not null;
create index if not exists comissao_itens_fech on public.comissao_itens(fechamento_id);

-- 4) acesso: quem fecha (papéis dos parâmetros); o representante só lê o que é dele
create or replace function public.comissao_pode_fechar(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros m where m.empresa_id = p_empresa and m.user_id = auth.uid()
                  and (m.papel::text = 'admin' or m.papel::text = any(coalesce((select papeis_fechar from comissao_config where empresa_id = p_empresa), array['admin', 'diretor', 'financeiro']))));
$$;
revoke all on function public.comissao_pode_fechar(uuid) from public, anon;
grant execute on function public.comissao_pode_fechar(uuid) to authenticated;

alter table public.comissao_config enable row level security;
alter table public.comissao_excecoes enable row level security;
alter table public.comissao_fechamentos enable row level security;
alter table public.comissao_itens enable row level security;
drop policy if exists comissao_config_sel on public.comissao_config;
drop policy if exists comissao_config_ins on public.comissao_config;
drop policy if exists comissao_config_upd on public.comissao_config;
create policy comissao_config_sel on public.comissao_config for select to authenticated using (public.comercial_interno(empresa_id) or public.comercial_pode_editar(empresa_id));
create policy comissao_config_ins on public.comissao_config for insert to authenticated with check (public.pode_aprovar_compra(empresa_id));
create policy comissao_config_upd on public.comissao_config for update to authenticated using (public.pode_aprovar_compra(empresa_id)) with check (public.pode_aprovar_compra(empresa_id));
drop policy if exists comissao_exc_sel on public.comissao_excecoes;
drop policy if exists comissao_exc_all on public.comissao_excecoes;
drop policy if exists comissao_exc_ins on public.comissao_excecoes;
drop policy if exists comissao_exc_upd on public.comissao_excecoes;
drop policy if exists comissao_exc_del on public.comissao_excecoes;
create policy comissao_exc_sel on public.comissao_excecoes for select to authenticated
  using (public.comercial_interno(empresa_id) or vendedor_id = public.meu_vendedor(empresa_id) or (vendedor_id is null and public.comercial_pode_editar(empresa_id)));
create policy comissao_exc_ins on public.comissao_excecoes for insert to authenticated with check (public.pode_aprovar_compra(empresa_id));
create policy comissao_exc_upd on public.comissao_excecoes for update to authenticated using (public.pode_aprovar_compra(empresa_id)) with check (public.pode_aprovar_compra(empresa_id));
create policy comissao_exc_del on public.comissao_excecoes for delete to authenticated using (public.pode_aprovar_compra(empresa_id));
drop policy if exists comissao_fech_sel on public.comissao_fechamentos;
create policy comissao_fech_sel on public.comissao_fechamentos for select to authenticated using (public.comercial_interno(empresa_id) or vendedor_id = public.meu_vendedor(empresa_id));
drop policy if exists comissao_itens_sel on public.comissao_itens;
create policy comissao_itens_sel on public.comissao_itens for select to authenticated
  using (public.comercial_interno(empresa_id) or exists (select 1 from comissao_fechamentos x where x.id = fechamento_id and x.vendedor_id = public.meu_vendedor(x.empresa_id)));
grant select, insert, update on public.comissao_config to authenticated;
grant select, insert, update, delete on public.comissao_excecoes to authenticated;
grant select on public.comissao_fechamentos, public.comissao_itens to authenticated;
do $$ declare t text; begin
  foreach t in array array['comissao_config', 'comissao_excecoes', 'comissao_fechamentos'] loop
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('comissao_fechada', 'Comercial', 'Comissão do mês fechada', 'O fechamento da sua comissão do mês está pronto: veja o extrato.', false, 46)
on conflict (codigo) do nothing;

-- 5) o que ainda não foi pago ao representante até uma data: recebimentos novos e estornos (recompra/estorno do recebimento)
create or replace function public._comissao_candidatos(p_empresa uuid, p_vendedor uuid, p_ate date)
returns table(lancamento_id uuid, tipo text, nota_numero int, favorecido_id uuid, cliente text, documento text, recebido_em date, vencimento date, dias_atraso int,
              valor_recebido numeric, base numeric, pct numeric, reducao_pct numeric, comissao numeric)
language sql stable security definer set search_path = public as $$
  with cfg as (select coalesce(c.base, 'recebido') base, coalesce(c.fidc_regra, 'cessao') fidc_regra, coalesce(c.fidc_carencia_dias, 5) car,
                      coalesce(c.atraso_dias, 0) atraso_dias, coalesce(c.atraso_reducao_pct, 0) atraso_red, coalesce(c.inicio, date_trunc('month', current_date)::date) inicio
                 from (select 1) z left join comissao_config c on c.empresa_id = p_empresa),
  vd as (select * from comercial_vendedores where id = p_vendedor and empresa_id = p_empresa),
  rec as (
    select l.id, n.numero, f.id fav, f.nome, l.documento, l.valor, n.v_nf, n.v_ipi, n.v_st, pa.vencimento,
           case when l.fidc_proposta_id is not null and cfg.fidc_regra = 'vencimento' then coalesce(pa.vencimento, l.data) + cfg.car else l.data end receb
      from lancamentos l join nfe_vinculos v on v.lancamento_id = l.id join nfe_notas n on n.id = v.nota_id
      left join nfe_parcelas pa on pa.id = v.parcela_id
      join favorecidos f on f.id = coalesce(n.favorecido_id, l.favorecido_id)
      join plano_contas pc on pc.id = l.plano_id, vd, cfg
     where l.empresa_id = p_empresa and l.status = 'Pago' and pc.tipo = 'E' and n.tipo = 'saida' and n.emissao_propria
       and f.representante_id = vd.representante_id
       and not exists (select 1 from comissao_itens i join comissao_fechamentos x on x.id = i.fechamento_id where i.lancamento_id = l.id and i.tipo = 'comissao' and x.situacao = 'fechado'))
  select r.id, 'comissao', r.numero, r.fav, r.nome, r.documento, r.receb, r.vencimento, greatest(r.receb - r.vencimento, 0),
         r.valor, b.base, t.pct, red.r, round(b.base * t.pct / 100 * (1 - red.r / 100), 2)
    from rec r cross join cfg cross join vd
    cross join lateral (select round(case when cfg.base = 'sem_impostos' and coalesce(r.v_nf, 0) > 0
                                          then r.valor * (r.v_nf - coalesce(r.v_ipi, 0) - coalesce(r.v_st, 0)) / r.v_nf else r.valor end, 2) base) b
    cross join lateral (select coalesce((select e.pct from comissao_excecoes e where e.empresa_id = p_empresa and e.favorecido_id = r.fav and e.vendedor_id = vd.id),
                                        (select e.pct from comissao_excecoes e where e.empresa_id = p_empresa and e.favorecido_id = r.fav and e.vendedor_id is null),
                                        vd.comissao_pct) pct) t
    cross join lateral (select case when cfg.atraso_dias > 0 and r.vencimento is not null and r.receb - r.vencimento > cfg.atraso_dias then cfg.atraso_red else 0 end r) red
   where r.receb between cfg.inicio and p_ate and t.pct > 0
  union all
  -- estorno: pago numa comissão fechada e hoje em aberto (recompra do FIDC, estorno do recebimento)
  select i.lancamento_id, 'estorno', i.nota_numero, i.favorecido_id, i.cliente, i.documento, p_ate, i.vencimento, i.dias_atraso,
         -i.valor_recebido, -i.base, i.pct, i.reducao_pct, -i.comissao
    from comissao_itens i join comissao_fechamentos x on x.id = i.fechamento_id and x.situacao = 'fechado' and x.vendedor_id = p_vendedor
    join lancamentos l on l.id = i.lancamento_id
   where i.tipo = 'comissao' and l.status <> 'Pago'
     and not exists (select 1 from comissao_itens e join comissao_fechamentos y on y.id = e.fechamento_id and y.situacao = 'fechado' where e.lancamento_id = i.lancamento_id and e.tipo = 'estorno');
$$;
revoke all on function public._comissao_candidatos(uuid, uuid, date) from public, anon, authenticated;

-- apuração do mês (prévia): por representante, o que entra no fechamento e o fechamento já feito
create or replace function public.comissao_apurar(p_empresa uuid, p_competencia date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_ini date := date_trunc('month', p_competencia)::date; v_fim date := (date_trunc('month', p_competencia) + interval '1 month - 1 day')::date; v_meu uuid; r jsonb := '[]';
begin
  if not (comercial_interno(p_empresa) or comercial_pode_editar(p_empresa)) then raise exception 'Acesso negado.'; end if;
  v_meu := case when comercial_interno(p_empresa) then null else meu_vendedor(p_empresa) end;
  if not comercial_interno(p_empresa) and v_meu is null then return '[]'; end if;
  select coalesce(jsonb_agg(x order by x ->> 'nome'), '[]') into r from (
    select jsonb_build_object('vendedor_id', v.id, 'nome', v.nome, 'pct', v.comissao_pct, 'user_id', v.user_id,
      'fechamento', (select to_jsonb(f) from comissao_fechamentos f where f.vendedor_id = v.id and f.competencia = v_ini and f.situacao = 'fechado'),
      'itens', (select coalesce(jsonb_agg(to_jsonb(c) order by c.recebido_em, c.nota_numero), '[]') from _comissao_candidatos(p_empresa, v.id, v_fim) c
                 where not exists (select 1 from comissao_fechamentos f where f.vendedor_id = v.id and f.competencia = v_ini and f.situacao = 'fechado'))) x
      from comercial_vendedores v where v.empresa_id = p_empresa and v.ativo and (v_meu is null or v.id = v_meu)) z;
  return r;
end $$;
revoke all on function public.comissao_apurar(uuid, date) from public, anon;
grant execute on function public.comissao_apurar(uuid, date) to authenticated;

-- fecha o mês de um representante: congela os itens, gera o título a pagar (se houver conta) e avisa
create or replace function public.comissao_fechar(p_vendedor uuid, p_competencia date, p_ajuste numeric default 0, p_motivo text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v comercial_vendedores; cfg comissao_config; v_ini date := date_trunc('month', p_competencia)::date; v_fim date := (date_trunc('month', p_competencia) + interval '1 month - 1 day')::date;
  f comissao_fechamentos; v_lanc uuid;
begin
  select * into v from comercial_vendedores where id = p_vendedor;
  if v.id is null or not comissao_pode_fechar(v.empresa_id) then raise exception 'Acesso negado.'; end if;
  if v_fim >= current_date then raise exception 'Só dá para fechar um mês que já terminou.'; end if;
  if coalesce(p_ajuste, 0) <> 0 and length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo do ajuste.'; end if;
  if exists (select 1 from comissao_fechamentos where vendedor_id = v.id and competencia = v_ini and situacao = 'fechado') then raise exception 'Este mês já está fechado para %.', v.nome; end if;
  select * into cfg from comissao_config where empresa_id = v.empresa_id;
  insert into comissao_fechamentos(empresa_id, vendedor_id, competencia, ajuste, ajuste_motivo) values (v.empresa_id, v.id, v_ini, coalesce(p_ajuste, 0), nullif(trim(p_motivo), ''))
  returning * into f;
  insert into comissao_itens(empresa_id, fechamento_id, lancamento_id, tipo, nota_numero, favorecido_id, cliente, documento, recebido_em, vencimento, dias_atraso, valor_recebido, base, pct, reducao_pct, comissao)
  select v.empresa_id, f.id, c.lancamento_id, c.tipo, c.nota_numero, c.favorecido_id, c.cliente, c.documento, c.recebido_em, c.vencimento, c.dias_atraso, c.valor_recebido, c.base, c.pct, c.reducao_pct, c.comissao
    from _comissao_candidatos(v.empresa_id, v.id, v_fim) c;
  update comissao_fechamentos x set base_total = coalesce(s.b, 0), comissao_total = coalesce(s.c, 0), total = coalesce(s.c, 0) + x.ajuste
    from (select sum(base) b, sum(comissao) c from comissao_itens where fechamento_id = f.id) s where x.id = f.id returning x.* into f;
  if cfg.plano_id is not null and f.total > 0 then
    insert into lancamentos(empresa_id, data, plano_id, favorecido_id, status, valor, descricao, documento, origem)
    values (v.empresa_id, (v_ini + interval '1 month')::date + (cfg.dia_pagamento - 1), cfg.plano_id, v.representante_id, 'Em aberto', f.total,
            'Comissão ' || to_char(v_ini, 'MM/YYYY') || ' — ' || v.nome, 'COM ' || to_char(v_ini, 'MM/YYYY'), 'comissao')
    returning id into v_lanc;
    update comissao_fechamentos set lancamento_id = v_lanc where id = f.id;
  end if;
  if v.user_id is not null then
    perform _notificar_u(v.empresa_id, array[v.user_id], 'comissao_fechada', 'Comissão de ' || to_char(v_ini, 'MM/YYYY') || ' fechada',
      'Total R$ ' || translate(to_char(f.total, 'FM999G999G990D00'), ',.', '.,'), '#/comercial/comissoes', f.id, false);
  end if;
  return f.id;
end $$;
revoke all on function public.comissao_fechar(uuid, date, numeric, text) from public, anon;
grant execute on function public.comissao_fechar(uuid, date, numeric, text) to authenticated;

-- cancela um fechamento ainda não pago (o título a pagar em aberto é excluído; os itens voltam para a apuração)
create or replace function public.comissao_cancelar(p_fechamento uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare f comissao_fechamentos;
begin
  select * into f from comissao_fechamentos where id = p_fechamento for update;
  if f.id is null or not comissao_pode_fechar(f.empresa_id) then raise exception 'Acesso negado.'; end if;
  if f.situacao <> 'fechado' then raise exception 'Fechamento já cancelado.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo.'; end if;
  if exists (select 1 from lancamentos where id = f.lancamento_id and status = 'Pago') then raise exception 'A comissão já foi paga: o fechamento não pode ser cancelado.'; end if;
  delete from comissao_itens where fechamento_id = f.id;
  update comissao_fechamentos set situacao = 'cancelado', cancelado_por = auth.jwt() ->> 'email', cancelado_em = now(), cancelado_motivo = trim(p_motivo), lancamento_id = null where id = f.id;
  delete from lancamentos where id = f.lancamento_id and status = 'Em aberto';
end $$;
revoke all on function public.comissao_cancelar(uuid, text) from public, anon;
grant execute on function public.comissao_cancelar(uuid, text) to authenticated;

-- extrato: fechamentos com a situação do pagamento (o representante: só os dele)
create or replace function public.comissao_extrato(p_empresa uuid, p_vendedor uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_meu uuid;
begin
  if not (comercial_interno(p_empresa) or comercial_pode_editar(p_empresa)) then raise exception 'Acesso negado.'; end if;
  v_meu := case when comercial_interno(p_empresa) then p_vendedor else meu_vendedor(p_empresa) end;
  if not comercial_interno(p_empresa) and v_meu is null then return '[]'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(f) || jsonb_build_object('vendedor', v.nome, 'pago', l.status = 'Pago', 'pagamento', l.data,
            'itens', (select coalesce(jsonb_agg(to_jsonb(i) order by i.recebido_em, i.nota_numero), '[]') from comissao_itens i where i.fechamento_id = f.id))
          order by f.competencia desc, v.nome), '[]')
    from comissao_fechamentos f join comercial_vendedores v on v.id = f.vendedor_id left join lancamentos l on l.id = f.lancamento_id
   where f.empresa_id = p_empresa and f.situacao = 'fechado' and (v_meu is null or f.vendedor_id = v_meu));
end $$;
revoke all on function public.comissao_extrato(uuid, uuid) from public, anon;
grant execute on function public.comissao_extrato(uuid, uuid) to authenticated;

select (select count(*) from information_schema.tables where table_name in ('comissao_config', 'comissao_excecoes', 'comissao_fechamentos', 'comissao_itens')) as tabelas;
