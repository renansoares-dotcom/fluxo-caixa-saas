-- =====================================================================
-- Melhoria contínua 3.10 — Forecast contínuo, orçamento por centro de custo com aprovação e justificativa obrigatória
-- (08/11/2026)
-- 1) Forecast "rolling": os meses fechados passam a ser o REALIZADO e os meses seguintes são projetados pelo método
--    escolhido (manter, budget, média dos últimos N meses ou budget × tendência do realizado). Cada atualização guarda
--    uma VERSÃO do forecast para comparar a evolução. Pode rodar sozinho quando o mês é fechado (SQL 107).
-- 2) Orçamento por centro de custo: cada centro tem um responsável, que recebe o orçamento do centro para APROVAR ou
--    DEVOLVER com comentário (entra em Minhas aprovações).
-- 3) Desvios acima da tolerância (parâmetros da empresa) precisam de justificativa até o prazo (D+N); quem é cobrado
--    recebe o aviso. A Conferência do fechamento usa a mesma tolerância.
-- Migração ADITIVA (requer os SQL 101 e 107).
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_proc where proname = '_dir_pode') then
    raise exception 'Rode antes o SQL 101 (20261107000101_painel_diretoria.sql). Nada foi alterado.';
  end if;
  if not exists (select 1 from pg_proc where proname = '_fech_prazo') then
    raise exception 'Rode antes o SQL 107 (20261108000107_fechamento_checklist.sql). Nada foi alterado.';
  end if;
end $$;

create or replace function public._orc_gestor(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public._dir_pode(p_empresa, array['admin', 'diretor', 'financeiro']);
$$;
revoke all on function public._orc_gestor(uuid) from public, anon;
grant execute on function public._orc_gestor(uuid) to authenticated;

-- ---------- parâmetros ----------
create table if not exists public.orcamento_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  tol_pct numeric(6,2) not null default 10 check (tol_pct >= 0),
  tol_valor numeric(16,2) not null default 5000 check (tol_valor >= 0),
  base_comparacao text not null default 'budget' check (base_comparacao in ('budget', 'forecast')),
  exigir_justificativa boolean not null default true,
  prazo_justificar smallint not null default 4 check (prazo_justificar between 1 and 20),   -- D+N do mês seguinte
  avisar boolean not null default true,
  avisar_papeis text[] not null default array['financeiro'],
  rolar_ao_fechar boolean not null default true,
  metodo text not null default 'tendencia' check (metodo in ('manter', 'budget', 'media', 'tendencia')),
  media_meses smallint not null default 3 check (media_meses between 1 and 12),
  tendencia_limite numeric(6,2) not null default 30 check (tendencia_limite between 0 and 100),   -- ajuste máximo (±%)
  ultimo_aviso text,                                   -- 'YYYY-MM' do último mês cobrado
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
alter table public.orcamento_config enable row level security;
drop policy if exists orcamento_config_sel on public.orcamento_config;
drop policy if exists orcamento_config_ins on public.orcamento_config;
drop policy if exists orcamento_config_upd on public.orcamento_config;
create policy orcamento_config_sel on public.orcamento_config for select to authenticated using (public.is_membro(empresa_id));
create policy orcamento_config_ins on public.orcamento_config for insert to authenticated with check (public._orc_gestor(empresa_id));
create policy orcamento_config_upd on public.orcamento_config for update to authenticated using (public._orc_gestor(empresa_id)) with check (public._orc_gestor(empresa_id));
grant select, insert, update on public.orcamento_config to authenticated;
drop trigger if exists zz_auditoria on public.orcamento_config;
create trigger zz_auditoria after insert or update or delete on public.orcamento_config for each row execute function public._auditar();

-- ---------- versões do forecast ----------
create table if not exists public.forecast_versoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ano int not null,
  ref_mes smallint not null check (ref_mes between 0 and 12),     -- realizado até este mês (0 = forecast inicial)
  metodo text,
  motivo text not null default 'manual' check (motivo in ('inicial', 'manual', 'fechamento')),
  entradas numeric(16,2), saidas numeric(16,2),
  dados jsonb not null default '[]'::jsonb,                       -- [{p: plano_id, m: mes, v: valor}] (soma por conta e mês)
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now()
);
create index if not exists forecast_versoes_emp on public.forecast_versoes(empresa_id, ano, criado_em desc);
alter table public.forecast_versoes enable row level security;
drop policy if exists forecast_versoes_sel on public.forecast_versoes;
create policy forecast_versoes_sel on public.forecast_versoes for select to authenticated using (public.is_membro(empresa_id));
grant select on public.forecast_versoes to authenticated;

-- realizado pago do ano por conta e mês (mesmo critério dos relatórios: com conta bancária; sem transferências)
create or replace function public._orc_realizado(p_empresa uuid, p_ano int)
returns table(plano_id uuid, mes int, valor numeric) language sql stable security definer set search_path = public as $$
  select l.plano_id, extract(month from l.data)::int, sum(l.valor)
    from lancamentos l join plano_contas p on p.id = l.plano_id and p.tipo in ('E', 'S')
   where l.empresa_id = p_empresa and l.status = 'Pago' and l.conta_id is not null
     and l.data between make_date(p_ano, 1, 1) and make_date(p_ano, 12, 31)
   group by 1, 2;
$$;
revoke all on function public._orc_realizado(uuid, int) from public, anon, authenticated;

create or replace function public._forecast_foto(p_empresa uuid, p_ano int, p_ref int, p_metodo text, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into forecast_versoes(empresa_id, ano, ref_mes, metodo, motivo, entradas, saidas, dados)
  select p_empresa, p_ano, p_ref, p_metodo, p_motivo,
         coalesce(sum(x.v) filter (where x.tipo = 'E'), 0), coalesce(sum(x.v) filter (where x.tipo = 'S'), 0),
         coalesce(jsonb_agg(jsonb_build_object('p', x.plano_id, 'm', x.mes, 'v', round(x.v, 2)) order by x.plano_id, x.mes), '[]'::jsonb)
    from (select o.plano_id, o.mes, p.tipo, sum(o.valor) v from orcamentos o join plano_contas p on p.id = o.plano_id
           where o.empresa_id = p_empresa and o.cenario = 'forecast' and o.ano = p_ano group by 1, 2, 3) x
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public._forecast_foto(uuid, int, int, text, text) from public, anon, authenticated;

/** atualiza o forecast pelo realizado (sem checar permissão: use forecast_rolar) */
create or replace function public._forecast_rolar(p_empresa uuid, p_ano int, p_ate int, p_metodo text, p_meses int, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c orcamento_config; v_lim numeric; v_ver uuid; n_real int; n_proj int := 0;
begin
  select * into c from orcamento_config where empresa_id = p_empresa;
  p_metodo := coalesce(p_metodo, c.metodo, 'tendencia');
  p_meses := coalesce(p_meses, c.media_meses, 3);
  v_lim := coalesce(c.tendencia_limite, 30) / 100;
  if p_metodo not in ('manter', 'budget', 'media', 'tendencia') then raise exception 'Método inválido.'; end if;
  if p_ate is null or p_ate not between 1 and 12 then raise exception 'Escolha o último mês realizado (1 a 12).'; end if;
  -- primeira vez no ano: guarda o forecast como estava (versão inicial)
  if not exists (select 1 from forecast_versoes where empresa_id = p_empresa and ano = p_ano) then
    perform _forecast_foto(p_empresa, p_ano, 0, null, 'inicial');
  end if;

  -- meses realizados: forecast = realizado (por conta, sem centro de custo)
  delete from orcamentos where empresa_id = p_empresa and cenario = 'forecast' and ano = p_ano and mes <= p_ate;
  insert into orcamentos(empresa_id, cenario, ano, mes, plano_id, centro_custo_id, valor)
  select p_empresa, 'forecast', p_ano, r.mes, r.plano_id, null, round(r.valor, 2) from _orc_realizado(p_empresa, p_ano) r where r.mes <= p_ate and r.valor <> 0;
  get diagnostics n_real = row_count;

  -- meses seguintes: pelo método
  if p_ate < 12 and p_metodo <> 'manter' then
    delete from orcamentos where empresa_id = p_empresa and cenario = 'forecast' and ano = p_ano and mes > p_ate;
    if p_metodo = 'budget' then
      insert into orcamentos(empresa_id, cenario, ano, mes, plano_id, centro_custo_id, valor)
      select p_empresa, 'forecast', p_ano, b.mes, b.plano_id, b.centro_custo_id, b.valor from orcamentos b
       where b.empresa_id = p_empresa and b.cenario = 'budget' and b.ano = p_ano and b.mes > p_ate and b.valor <> 0;
    elsif p_metodo = 'media' then
      insert into orcamentos(empresa_id, cenario, ano, mes, plano_id, centro_custo_id, valor)
      select p_empresa, 'forecast', p_ano, m.mes, a.plano_id, null, a.media
        from (select r.plano_id, round(sum(r.valor) / least(p_meses, p_ate), 2) media from _orc_realizado(p_empresa, p_ano) r
               where r.mes between greatest(1, p_ate - p_meses + 1) and p_ate group by 1) a
        cross join generate_series(p_ate + 1, 12) m(mes) where a.media <> 0;
    else -- tendencia: budget do mês × (realizado ÷ budget acumulados até o mês), limitado a ± tendencia_limite
      insert into orcamentos(empresa_id, cenario, ano, mes, plano_id, centro_custo_id, valor)
      select p_empresa, 'forecast', p_ano, b.mes, b.plano_id, null,
             round(b.valor * case when coalesce(t.orc, 0) > 0 then least(1 + v_lim, greatest(1 - v_lim, coalesce(t.real, 0) / t.orc)) else 1 end, 2)
        from (select plano_id, mes, sum(valor) valor from orcamentos where empresa_id = p_empresa and cenario = 'budget' and ano = p_ano and mes > p_ate group by 1, 2) b
        left join (select bo.plano_id, sum(bo.valor) orc, (select sum(r.valor) from _orc_realizado(p_empresa, p_ano) r where r.plano_id = bo.plano_id and r.mes <= p_ate) real
                     from orcamentos bo where bo.empresa_id = p_empresa and bo.cenario = 'budget' and bo.ano = p_ano and bo.mes <= p_ate group by 1) t on t.plano_id = b.plano_id
       where b.valor <> 0;
    end if;
    get diagnostics n_proj = row_count;
  end if;

  -- situação dos meses (Orçado x Realizado)
  insert into forecast_status(empresa_id, ano, mes, status)
  select p_empresa, p_ano, m, case when m <= p_ate then 'Realizado' else 'Prev. Ajustada' end from generate_series(1, 12) m
  on conflict (empresa_id, ano, mes) do update set status = excluded.status;

  v_ver := _forecast_foto(p_empresa, p_ano, p_ate, p_metodo, p_motivo);
  return jsonb_build_object('versao', v_ver, 'realizado', n_real, 'projetado', n_proj, 'metodo', p_metodo, 'ate', p_ate);
end $$;
revoke all on function public._forecast_rolar(uuid, int, int, text, int, text) from public, anon, authenticated;

create or replace function public.forecast_rolar(p_empresa uuid, p_ano int, p_ate int, p_metodo text default null, p_meses int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not _orc_gestor(p_empresa) then raise exception 'Só administrador, diretor ou financeiro atualiza o forecast.'; end if;
  if make_date(p_ano, p_ate, 1) > date_trunc('month', current_date)::date then raise exception 'Não dá para usar o realizado de um mês que ainda não começou.'; end if;
  return _forecast_rolar(p_empresa, p_ano, p_ate, p_metodo, p_meses, 'manual');
end $$;
revoke all on function public.forecast_rolar(uuid, int, int, text, int) from public, anon;
grant execute on function public.forecast_rolar(uuid, int, int, text, int) to authenticated;

-- quando um mês é fechado (SQL 107), o forecast do ano rola sozinho até esse mês (parâmetro rolar_ao_fechar)
create or replace function public._forecast_ao_fechar() returns trigger language plpgsql security definer set search_path = public as $$
declare c orcamento_config;
begin
  if new.situacao <> 'fechado' or (tg_op = 'UPDATE' and old.situacao = 'fechado') then return new; end if;
  select * into c from orcamento_config where empresa_id = new.empresa_id;
  if c.empresa_id is not null and c.rolar_ao_fechar
     and exists (select 1 from orcamentos where empresa_id = new.empresa_id and ano = left(new.mes, 4)::int and cenario in ('budget', 'forecast')) then
    perform _forecast_rolar(new.empresa_id, left(new.mes, 4)::int, right(new.mes, 2)::int, null, null, 'fechamento');
  end if;
  return new;
end $$;
drop trigger if exists forecast_ao_fechar on public.fechamento_meses;
create trigger forecast_ao_fechar after insert or update on public.fechamento_meses for each row execute function public._forecast_ao_fechar();

-- ---------- orçamento por centro de custo com aprovação do responsável ----------
alter table public.centros_custo add column if not exists responsavel uuid references auth.users(id) on delete set null;

create table if not exists public.orcamento_cc_aprovacoes (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ano int not null,
  cenario text not null check (cenario in ('budget', 'forecast')),
  centro_custo_id uuid not null references public.centros_custo(id) on delete cascade,
  situacao text not null check (situacao in ('enviado', 'aprovado', 'devolvido')),
  total numeric(16,2),                                   -- total do centro no envio (muda depois → "alterado")
  enviado_por uuid, enviado_em timestamptz,
  decidido_por uuid, decidido_em timestamptz,
  comentario text,
  primary key (empresa_id, ano, cenario, centro_custo_id)
);
alter table public.orcamento_cc_aprovacoes enable row level security;
drop policy if exists orcamento_cc_aprovacoes_sel on public.orcamento_cc_aprovacoes;
create policy orcamento_cc_aprovacoes_sel on public.orcamento_cc_aprovacoes for select to authenticated
  using (public.is_membro(empresa_id) or exists (select 1 from centros_custo c where c.id = centro_custo_id and c.responsavel = auth.uid()));
grant select on public.orcamento_cc_aprovacoes to authenticated;

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('orcamento', 'Financeiro', 'Orçamento', 'Orçamento do seu centro de custo para aprovar, aprovado ou devolvido, e desvios sem justificativa.', false, 17)
on conflict (codigo) do nothing;

drop function if exists public.orcamento_cc_valores(uuid, int, text, uuid);
/** valores do centro de custo: lançados direto no centro + parte do rateio (orcamento_rateio_cc) das contas sem centro */
create or replace function public.orcamento_cc_valores(p_empresa uuid, p_ano int, p_cenario text, p_cc uuid)
returns table(plano_id uuid, codigo text, nome text, tipo text, mes int, valor numeric) language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_membro(p_empresa) or exists (select 1 from centros_custo where id = p_cc and empresa_id = p_empresa and responsavel = auth.uid())) then return; end if;
  return query
  select x.plano_id, p.codigo::text, p.nome::text, p.tipo::text, x.mes::int, round(sum(x.v), 2) from (
    select o.plano_id, o.mes, o.valor v from orcamentos o where o.empresa_id = p_empresa and o.ano = p_ano and o.cenario = p_cenario and o.centro_custo_id = p_cc
    union all
    select o.plano_id, o.mes, o.valor * r.pct / 100 from orcamentos o
      join orcamento_rateio_cc r on r.empresa_id = o.empresa_id and r.ano = o.ano and r.plano_id = o.plano_id and r.centro_custo_id = p_cc
     where o.empresa_id = p_empresa and o.ano = p_ano and o.cenario = p_cenario and o.centro_custo_id is null
  ) x join plano_contas p on p.id = x.plano_id group by 1, 2, 3, 4, 5 having round(sum(x.v), 2) <> 0;
end $$;
revoke all on function public.orcamento_cc_valores(uuid, int, text, uuid) from public, anon;
grant execute on function public.orcamento_cc_valores(uuid, int, text, uuid) to authenticated;

/** centros de custo que a pessoa responde (com a situação da aprovação) — vale também para quem não é do financeiro */
create or replace function public.orcamento_cc_meus(p_empresa uuid, p_ano int)
returns table(centro_custo_id uuid, nome text, cenario text, situacao text, total numeric, enviado_em timestamptz, decidido_em timestamptz, comentario text, atual numeric)
language sql stable security definer set search_path = public as $$
  select c.id, c.nome, a.cenario, a.situacao, a.total, a.enviado_em, a.decidido_em, a.comentario,
         (select coalesce(sum(v.valor), 0) from orcamento_cc_valores(p_empresa, p_ano, coalesce(a.cenario, 'budget'), c.id) v)
    from centros_custo c left join orcamento_cc_aprovacoes a on a.centro_custo_id = c.id and a.ano = p_ano and a.empresa_id = p_empresa
   where c.empresa_id = p_empresa and c.responsavel = auth.uid() and c.ativo and is_participante(p_empresa)
   order by c.nome;
$$;
revoke all on function public.orcamento_cc_meus(uuid, int) from public, anon;
grant execute on function public.orcamento_cc_meus(uuid, int) to authenticated;

create or replace function public.orcamento_cc_enviar(p_empresa uuid, p_ano int, p_cenario text, p_cc uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_resp uuid; v_nome text; v_total numeric;
begin
  if not _orc_gestor(p_empresa) then raise exception 'Só administrador, diretor ou financeiro envia o orçamento para aprovação.'; end if;
  select responsavel, nome into v_resp, v_nome from centros_custo where id = p_cc and empresa_id = p_empresa;
  if v_nome is null then raise exception 'Centro de custo não encontrado.'; end if;
  if v_resp is null then raise exception 'O centro de custo % não tem responsável. Escolha o responsável antes de enviar.', v_nome; end if;
  select coalesce(sum(valor), 0) into v_total from orcamento_cc_valores(p_empresa, p_ano, p_cenario, p_cc);
  insert into orcamento_cc_aprovacoes(empresa_id, ano, cenario, centro_custo_id, situacao, total, enviado_por, enviado_em)
  values (p_empresa, p_ano, p_cenario, p_cc, 'enviado', v_total, auth.uid(), now())
  on conflict (empresa_id, ano, cenario, centro_custo_id) do update
    set situacao = 'enviado', total = excluded.total, enviado_por = auth.uid(), enviado_em = now(), decidido_por = null, decidido_em = null, comentario = null;
  perform _notificar_u(p_empresa, array[v_resp], 'orcamento', 'Orçamento ' || p_ano || ' do centro ' || v_nome || ' para aprovar',
    initcap(p_cenario) || ': total de R$ ' || translate(to_char(v_total, 'FM999,999,999,990.00'), ',.', '.,') || '. Aprove ou devolva com comentário.', '#/orcamento-cc', null, false);
end $$;

create or replace function public.orcamento_cc_decidir(p_empresa uuid, p_ano int, p_cenario text, p_cc uuid, p_aprovar boolean, p_comentario text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_resp uuid; v_nome text; a orcamento_cc_aprovacoes;
begin
  select responsavel, nome into v_resp, v_nome from centros_custo where id = p_cc and empresa_id = p_empresa;
  if v_nome is null then raise exception 'Centro de custo não encontrado.'; end if;
  if not coalesce(v_resp = auth.uid() or is_admin(p_empresa), false) then raise exception 'Só o responsável pelo centro de custo decide o orçamento dele.'; end if;
  select * into a from orcamento_cc_aprovacoes where empresa_id = p_empresa and ano = p_ano and cenario = p_cenario and centro_custo_id = p_cc;
  if a.situacao is distinct from 'enviado' then raise exception 'Este orçamento não está aguardando aprovação.'; end if;
  if not p_aprovar and coalesce(length(trim(p_comentario)), 0) < 10 then raise exception 'Para devolver, diga o que precisa mudar (pelo menos 10 letras).'; end if;
  update orcamento_cc_aprovacoes set situacao = case when p_aprovar then 'aprovado' else 'devolvido' end, decidido_por = auth.uid(), decidido_em = now(),
         comentario = nullif(trim(p_comentario), '')
   where empresa_id = p_empresa and ano = p_ano and cenario = p_cenario and centro_custo_id = p_cc;
  perform _notificar_u(p_empresa, array[a.enviado_por] || _usuarios_papel(p_empresa, array['financeiro']), 'orcamento',
    'Orçamento do centro ' || v_nome || case when p_aprovar then ' aprovado' else ' devolvido' end,
    coalesce('Comentário: ' || nullif(trim(p_comentario), ''), 'Aprovado sem comentário.'), '#/orcamento', null, false);
end $$;
revoke all on function public.orcamento_cc_enviar(uuid, int, text, uuid), public.orcamento_cc_decidir(uuid, int, text, uuid, boolean, text) from public, anon;
grant execute on function public.orcamento_cc_enviar(uuid, int, text, uuid), public.orcamento_cc_decidir(uuid, int, text, uuid, boolean, text) to authenticated;

-- ---------- desvios e cobrança da justificativa ----------
/** contas do mês fora da tolerância (orçado × realizado pago, pela base dos parâmetros) e se já têm justificativa */
create or replace function public.orcamento_desvios(p_empresa uuid, p_ano int, p_mes int)
returns table(plano_id uuid, codigo text, nome text, tipo text, orcado numeric, realizado numeric, desvio numeric, justificado boolean)
language plpgsql stable security definer set search_path = public as $$
declare c orcamento_config;
begin
  if not is_membro(p_empresa) then return; end if;
  select * into c from orcamento_config where empresa_id = p_empresa;
  c.tol_pct := coalesce(c.tol_pct, 10); c.tol_valor := coalesce(c.tol_valor, 5000); c.base_comparacao := coalesce(c.base_comparacao, 'budget');
  return query
  with o as (select x.plano_id, sum(x.valor) v from orcamentos x where x.empresa_id = p_empresa and x.ano = p_ano and x.mes = p_mes and x.cenario = c.base_comparacao group by 1),
       r as (select x.plano_id, x.valor v from _orc_realizado(p_empresa, p_ano) x where x.mes = p_mes),
       j as (select distinct x.plano_id from orcamento_justificativas x where x.empresa_id = p_empresa and x.ano = p_ano and x.mes = p_mes and x.origem = 'acompanhamento')
  select p.id, p.codigo::text, p.nome::text, p.tipo::text, coalesce(o.v, 0), coalesce(r.v, 0),
         case when p.tipo = 'S' then coalesce(r.v, 0) - coalesce(o.v, 0) else coalesce(o.v, 0) - coalesce(r.v, 0) end,
         j.plano_id is not null
    from plano_contas p left join o on o.plano_id = p.id left join r on r.plano_id = p.id left join j on j.plano_id = p.id
   where p.empresa_id = p_empresa and p.tipo in ('E', 'S') and (o.v is not null or r.v is not null)
     and (case when p.tipo = 'S' then coalesce(r.v, 0) - coalesce(o.v, 0) else coalesce(o.v, 0) - coalesce(r.v, 0) end) > greatest(c.tol_valor, c.tol_pct / 100 * abs(coalesce(o.v, 0)))
   order by 7 desc;
end $$;
revoke all on function public.orcamento_desvios(uuid, int, int) from public, anon;
grant execute on function public.orcamento_desvios(uuid, int, int) to authenticated;

/** diário: no prazo (D+N do mês seguinte) cobra os desvios sem justificativa do mês anterior, uma vez por mês */
create or replace function public._orc_cobrar_justificativas() returns int
language plpgsql security definer set search_path = public as $$
declare c record; v_mes text := to_char(current_date - interval '1 month', 'YYYY-MM'); v_n int; v_total int := 0;
begin
  for c in select * from orcamento_config where avisar and exigir_justificativa and coalesce(ultimo_aviso, '') < v_mes loop
    if current_date < _fech_prazo(v_mes, c.prazo_justificar) then continue; end if;
    select count(*) into v_n from orcamento_desvios_sistema(c.empresa_id, left(v_mes, 4)::int, right(v_mes, 2)::int) d where not d.justificado;
    update orcamento_config set ultimo_aviso = v_mes where empresa_id = c.empresa_id;
    if v_n = 0 then continue; end if;
    insert into notificacoes(empresa_id, user_id, tipo, titulo, corpo, link)
    select c.empresa_id, u, 'orcamento', v_n || ' desvio(s) do orçamento de ' || right(v_mes, 2) || '/' || left(v_mes, 4) || ' sem justificativa',
           'O prazo era D+' || c.prazo_justificar || '. Justifique no Controle Orçamentário.', '#/controle-orcamento'
      from unnest(_usuarios_papel(c.empresa_id, c.avisar_papeis)) u;
    v_total := v_total + 1;
  end loop;
  return v_total;
end $$;

-- versão sem a checagem de acesso, para o agendamento (o is_membro depende de quem está logado)
create or replace function public.orcamento_desvios_sistema(p_empresa uuid, p_ano int, p_mes int)
returns table(plano_id uuid, justificado boolean) language plpgsql stable security definer set search_path = public as $$
declare c orcamento_config;
begin
  select * into c from orcamento_config where empresa_id = p_empresa;
  return query
  with o as (select x.plano_id, sum(x.valor) v from orcamentos x where x.empresa_id = p_empresa and x.ano = p_ano and x.mes = p_mes and x.cenario = coalesce(c.base_comparacao, 'budget') group by 1),
       r as (select x.plano_id, x.valor v from _orc_realizado(p_empresa, p_ano) x where x.mes = p_mes)
  select p.id, exists (select 1 from orcamento_justificativas j where j.empresa_id = p_empresa and j.ano = p_ano and j.mes = p_mes and j.plano_id = p.id and j.origem = 'acompanhamento')
    from plano_contas p left join o on o.plano_id = p.id left join r on r.plano_id = p.id
   where p.empresa_id = p_empresa and p.tipo in ('E', 'S') and (o.v is not null or r.v is not null)
     and (case when p.tipo = 'S' then coalesce(r.v, 0) - coalesce(o.v, 0) else coalesce(o.v, 0) - coalesce(r.v, 0) end) > greatest(coalesce(c.tol_valor, 5000), coalesce(c.tol_pct, 10) / 100 * abs(coalesce(o.v, 0)));
end $$;
revoke all on function public.orcamento_desvios_sistema(uuid, int, int), public._orc_cobrar_justificativas() from public, anon, authenticated;

do $$
begin
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron indisponível (%).', sqlerrm; return; end;
  perform cron.unschedule(jobid) from cron.job where jobname = 'orcamento-justificativas';
  perform cron.schedule('orcamento-justificativas', '23 11 * * *', $job$ select public._orc_cobrar_justificativas(); $job$);   -- 08:23 em Brasília
exception when others then raise notice 'agendamento não criado: %', sqlerrm;
end $$;

-- ---------- Minhas aprovações: + orçamento do centro de custo (recria a função do SQL 091 com o tipo novo) ----------
create or replace function public.minhas_aprovacoes(p_empresa uuid)
returns table(tipo text, id uuid, numero int, titulo text, detalhe text, valor numeric, desde timestamptz, prazo date, urgente boolean, link text, lote boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_participante(p_empresa) then return; end if;
  -- pagamentos antecipados aguardando autorização
  if pode_aprovar_paraquedas(p_empresa) then
    return query select 'pa'::text, x.id, x.numero, x.razao_social, coalesce(x.descricao, ''), x.valor, x.criado_em, x.data_pagamento, x.prioridade = 'urgente', '#/paraquedas'::text, true
      from paraquedas x where x.empresa_id = p_empresa and x.status = 'aguardando';
  end if;
  -- compras: pedidos aguardando aprovação e requisições pendentes
  if pode_aprovar_compra(p_empresa) then
    return query select 'pedido'::text, x.id, x.numero, coalesce(f.nome, 'Fornecedor'), coalesce(x.condicao_pagamento, '') || case when x.plano_id is null then ' · sem classificação: aprovar na tela' else '' end,
           x.total, x.criado_em, x.entrega_prevista, false, '#/compras/pedidos?abrir=' || x.id, x.plano_id is not null
      from compras_pedidos x left join favorecidos f on f.id = x.favorecido_id where x.empresa_id = p_empresa and x.status = 'aguardando';
    return query select 'requisicao'::text, x.id, x.numero, 'Requisição de ' || coalesce(x.solicitante, '—'), coalesce(x.observacao, ''), null::numeric, x.criado_em, x.necessidade, x.prioridade = 'urgente', '#/compras/requisicoes'::text, true
      from compras_requisicoes x where x.empresa_id = p_empresa and x.status = 'pendente';
  end if;
  -- borderôs (só o diretor decide)
  if is_diretor(p_empresa) then
    return query select 'bordero'::text, x.id, x.numero, 'Borderô — ' || coalesce(fu.nome, 'fundo'), x.qtd_titulos || ' título(s) · líquido R$ ' || translate(to_char(x.liquido, 'FM999,999,999,990.00'), ',.', '.,'),
           x.valor_face, x.criado_em, x.data_operacao, false, '#/fidc-propostas?abrir=' || x.id, true
      from fidc_propostas x left join fidc_fundos fu on fu.id = x.fundo_id where x.empresa_id = p_empresa and x.status = 'Pendente';
  end if;
  -- decisão do dia (diretor ou admin)
  if exists (select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('diretor', 'admin')) then
    return query select 'decisao_dia'::text, x.id, x.numero, 'Decisão do dia ' || to_char(x.data, 'DD/MM'), 'Saídas R$ ' || translate(to_char(x.saidas, 'FM999,999,999,990.00'), ',.', '.,') || ' · saldo final R$ ' || translate(to_char(x.saldo_fim, 'FM999,999,999,990.00'), ',.', '.,'),
           x.saidas, x.criado_em, x.data, false, '#/decisao-dia?dia=' || x.data, true
      from decisoes_dia x where x.empresa_id = p_empresa and x.status = 'Pendente';
  end if;
  -- prorrogações pedidas no Portal (admin ou financeiro)
  if pode_editar(p_empresa) then
    return query select 'prorrogacao'::text, x.id, null::int, coalesce(f.nome, 'Cliente'), coalesce(x.documento, '') || ' · de ' || to_char(x.vencimento_atual, 'DD/MM') || ' para ' || to_char(x.nova_data, 'DD/MM') || ' · ' || x.motivo,
           x.valor, x.solicitado_em, x.vencimento_atual, false, '#/portal-clientes'::text, true
      from portal_prorrogacoes x left join favorecidos f on f.id = x.favorecido_id where x.empresa_id = p_empresa and x.status = 'pendente';
  end if;
  -- reajustes de contrato propostos (admin)
  if is_admin(p_empresa) then
    return query select 'reajuste'::text, x.id, c.numero, 'Reajuste — ' || c.objeto, x.indice || ' ' || replace(to_char(x.percentual, 'FM990.00'), '.', ',') || '% · de R$ ' || translate(to_char(x.valor_anterior, 'FM999,999,990.00'), ',.', '.,') || ' para R$ ' || translate(to_char(x.valor_novo, 'FM999,999,990.00'), ',.', '.,'),
           x.valor_novo, x.proposto_em, x.data_base, false, '#/contratos'::text, true
      from contrato_reajustes x join contratos c on c.id = x.contrato_id where x.empresa_id = p_empresa and x.status = 'proposto';
  end if;
  -- receitas de tinta em teste
  if to_regclass('public.tin_versoes') is not null and tin_pode_aprovar(p_empresa) then
    return query select 'receita'::text, v.id, v.numero, r.codigo || ' — ' || r.nome, 'Versão ' || v.numero || ' em teste' || coalesce(' · ' || v.observacao, ''), null::numeric, v.criado_em, null::date, false, '#/tintas/receitas'::text, true
      from tin_versoes v join tin_receitas r on r.id = v.receita_id where v.empresa_id = p_empresa and v.situacao = 'em_teste';
  end if;
  -- artes aprovadas pelo cliente esperando liberação para a produção
  if to_regclass('public.pre_projetos') is not null and pre_pode_liberar(p_empresa) then
    return query select 'arte'::text, x.id, x.numero, x.nome, coalesce(f.nome, '') || case when x.situacao = 'na_clicheria' then ' · clichês recebidos' else ' · aprovada pelo cliente' end,
           null::numeric, x.atualizado_em, x.prazo, false, '#/preimpressao/artes?abrir=' || x.id, true
      from pre_projetos x left join favorecidos f on f.id = x.favorecido_id
     where x.empresa_id = p_empresa and not x.arquivado and (x.situacao = 'aprovada' or (x.situacao = 'na_clicheria' and x.cliche_recebido_em is not null));
  end if;
  -- inspeções da qualidade que esperam a decisão (decide na tela: exige olhar os resultados)
  if to_regclass('public.qual_inspecoes') is not null and qual_pode_decidir(p_empresa) then
    return query select 'inspecao'::text, x.id, x.numero, 'Inspeção ' || x.etapa || coalesce(' — ' || p.descricao, ''), coalesce(x.lote_texto, ''), null::numeric, x.criado_em, x.prazo::date, false, '#/qualidade/inspecoes?abrir=' || x.id, false
      from qual_inspecoes x left join produtos p on p.id = x.produto_id where x.empresa_id = p_empresa and x.situacao = 'em_inspecao';
  end if;
  -- orçamento do centro de custo enviado ao responsável (decide na tela: exige olhar os valores)
  return query select 'orcamento_cc'::text, c.id, a.ano, 'Orçamento ' || a.ano || ' — ' || c.nome, initcap(a.cenario) || ' enviado para a sua aprovação',
         a.total, a.enviado_em, null::date, false, '#/orcamento-cc'::text, false
    from orcamento_cc_aprovacoes a join centros_custo c on c.id = a.centro_custo_id
   where a.empresa_id = p_empresa and a.situacao = 'enviado' and c.responsavel = auth.uid();
end $$;
revoke all on function public.minhas_aprovacoes(uuid) from public, anon;
grant execute on function public.minhas_aprovacoes(uuid) to authenticated;

-- conferência: tabelas = 3, funções = 7
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('orcamento_config', 'forecast_versoes', 'orcamento_cc_aprovacoes')) as tabelas,
       (select count(*) from pg_proc where proname in ('forecast_rolar', 'orcamento_cc_valores', 'orcamento_cc_meus', 'orcamento_cc_enviar', 'orcamento_cc_decidir', 'orcamento_desvios', 'minhas_aprovacoes')) as funcoes;
