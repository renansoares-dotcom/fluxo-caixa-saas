-- =====================================================================
-- Melhoria contínua 2.2 — Minha Manhã personalizada (07/11/2026)
-- A tela inicial passa a ser montada por blocos, escolhidos e ordenados por cada pessoa (padrão pelo papel):
--   • "O que mudou desde o seu último acesso": inclusões, alterações e exclusões feitas por OUTRAS pessoas, por módulo,
--     só nas áreas que a pessoa enxerga; notas fiscais importadas; detalhe de quem fez só para administrador e diretor;
--   • "Ontem": resumo do dia útil anterior (recebido e pago, faturamento, notas de entrada, produção e refugo, cargas e
--     entregas, não conformidades), também por área.
-- Último acesso: membros_acessos (SQL 100) ganha o acesso ANTERIOR (sessão nova = mais de 30 min sem entrar).
-- Migração ADITIVA (requer SQL 100 e 101).
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_proc where proname = '_dir_pode') then
    raise exception 'Rode antes o SQL 101 (20261107000101_painel_diretoria.sql). Nada foi alterado.';
  end if;
end $$;

alter table public.membros_acessos add column if not exists acesso_anterior timestamptz;

-- lgpd_entrar (SQL 100) passa a guardar o acesso anterior; o resto continua igual
create or replace function public.lgpd_entrar(p_empresa uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t lgpd_termos;
begin
  if not is_participante(p_empresa) then raise exception 'Sem acesso a esta empresa.'; end if;
  insert into membros_acessos(empresa_id, user_id, ultimo_acesso) values (p_empresa, auth.uid(), now())
    on conflict (empresa_id, user_id) do update set
      acesso_anterior = case when membros_acessos.ultimo_acesso < now() - interval '30 minutes' then membros_acessos.ultimo_acesso else membros_acessos.acesso_anterior end,
      ultimo_acesso = now(), avisado_em = null;
  t := _lgpd_termo_vigente(p_empresa, 'equipe');
  if t.id is null or exists (select 1 from lgpd_aceites where termo_id = t.id and user_id = auth.uid()) then return null; end if;
  return jsonb_build_object('id', t.id, 'versao', t.versao, 'titulo', t.titulo, 'texto', t.texto, 'publicado_em', t.publicado_em,
    'anterior', exists (select 1 from lgpd_aceites a join lgpd_termos x on x.id = a.termo_id where x.empresa_id = p_empresa and x.publico = 'equipe' and a.user_id = auth.uid()));
end $$;

-- blocos escolhidos por pessoa e empresa: [{ "k": "mudou", "on": true }, …] na ordem da tela
create table if not exists public.manha_preferencias (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  blocos jsonb not null default '[]',
  atalhos text[] not null default '{}',
  atualizado_em timestamptz not null default now(),
  primary key (empresa_id, user_id)
);
alter table public.manha_preferencias enable row level security;
drop policy if exists manha_pref_sel on public.manha_preferencias; drop policy if exists manha_pref_ins on public.manha_preferencias;
drop policy if exists manha_pref_upd on public.manha_preferencias; drop policy if exists manha_pref_del on public.manha_preferencias;
create policy manha_pref_sel on public.manha_preferencias for select to authenticated using (user_id = auth.uid());
create policy manha_pref_ins on public.manha_preferencias for insert to authenticated with check (user_id = auth.uid() and public.is_participante(empresa_id));
create policy manha_pref_upd on public.manha_preferencias for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy manha_pref_del on public.manha_preferencias for delete to authenticated using (user_id = auth.uid());
grant select, insert, update, delete on public.manha_preferencias to authenticated;

-- área de cada tabela auditada (para mostrar só o que a pessoa enxerga)
create or replace function public._manha_area(p_tabela text) returns text language sql immutable as $$
  select case
    when p_tabela in ('lancamentos', 'contas', 'contas_travas', 'conciliacoes', 'conferencias_dia', 'orcamentos', 'orcamento_rateio_cc', 'paraquedas', 'paraquedas_pagamentos', 'paraquedas_anexos',
                      'fidc_propostas', 'fidc_fundo_condicoes', 'creditos', 'duplicatas', 'autorizacoes', 'nfe_vinculos', 'caixa_compromissos', 'decisoes_dia', 'portal_usuarios', 'portal_convites', 'portal_prorrogacoes', 'contratos', 'contrato_reajustes') then 'fin'
    when p_tabela like 'compras%' or p_tabela like 'estoque%' or p_tabela in ('produtos', 'produto_fornecedores', 'produto_estrutura', 'est_classif_regras') then 'cmp'
    when p_tabela like 'comercial%' or p_tabela like 'pre\_%' then 'com'
    when p_tabela like 'prod\_%' or p_tabela like 'man\_%' or p_tabela like 'qual\_%' or p_tabela like 'tin\_%' then 'prd'
    when p_tabela like 'log\_%' or p_tabela like 'frota%' or p_tabela like 'efrete%' then 'log'
    when p_tabela like 'contab%' or p_tabela like 'af\_%' then 'cont'
    when p_tabela like 'rh\_%' then 'rh'
    when p_tabela in ('nfe_compartilhamento', 'empresa_tributacao') then 'cpd'
    else 'cad' end;
$$;

-- a pessoa enxerga a área? (administrador: tudo; RH só marcado; papéis especiais pelas suas telas)
create or replace function public._manha_ve(p_empresa uuid, p_area text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select case
      when m.papel = 'admin' then true
      when m.papel::text = 'compras' then p_area = 'cmp'
      when m.papel::text = 'vendas' then p_area = 'com'
      when m.papel::text = 'producao' then p_area = 'prd'
      when p_area = 'rh' then 'rh' = any (coalesce(m.areas, '{}'))
      when p_area = 'cad' then true
      else m.areas is null or p_area = any (m.areas) end
    from membros m where m.empresa_id = p_empresa and m.user_id = auth.uid()), false);
$$;

/** dados da Minha Manhã: o que mudou desde o acesso anterior e o resumo do dia útil anterior */
create or replace function public.manha_resumo(p_empresa uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare desde timestamptz; ontem date := current_date - 1; adm boolean; r jsonb; mud jsonb; ont jsonb := '{}';
begin
  if not is_participante(p_empresa) then raise exception 'Sem acesso a esta empresa.'; end if;
  while extract(isodow from ontem) > 5 loop ontem := ontem - 1; end loop;
  select coalesce(acesso_anterior, ultimo_acesso - interval '1 day') into desde from membros_acessos where empresa_id = p_empresa and user_id = auth.uid();
  desde := least(coalesce(desde, now() - interval '1 day'), now() - interval '1 minute');
  desde := greatest(desde, now() - interval '30 days');
  adm := _dir_pode(p_empresa, array['admin', 'diretor']);

  -- o que mudou (por outras pessoas), por tabela e ação
  select jsonb_build_object(
    'por_tabela', coalesce((select jsonb_agg(x order by x.total desc) from (
        select a.tabela, _manha_area(a.tabela) area, count(*) total,
               count(*) filter (where a.acao = 'incluiu') incluiu, count(*) filter (where a.acao = 'alterou') alterou, count(*) filter (where a.acao = 'excluiu') excluiu,
               count(distinct a.user_id) pessoas, max(a.criado_em) ultimo
          from auditoria a
         where a.empresa_id = p_empresa and a.criado_em > desde and a.user_id is distinct from auth.uid()
           and case when a.tabela = 'membros' then adm else _manha_ve(p_empresa, _manha_area(a.tabela)) end
         group by 1, 2) x), '[]'),
    'recentes', case when adm then coalesce((select jsonb_agg(x order by x.criado_em desc) from (
        select a.tabela, a.acao, a.user_email, a.criado_em, a.operacao_nome,
               coalesce(a.depois ->> 'descricao', a.depois ->> 'nome', a.depois ->> 'razao_social', a.antes ->> 'descricao', a.antes ->> 'nome', a.depois ->> 'numero', a.antes ->> 'numero') rotulo
          from auditoria a where a.empresa_id = p_empresa and a.criado_em > desde and a.user_id is distinct from auth.uid()
         order by a.criado_em desc limit 12) x), '[]') else null end,
    'notas', case when _manha_ve(p_empresa, 'cpd') or _manha_ve(p_empresa, 'fin') or _manha_ve(p_empresa, 'cmp') then (
        select jsonb_build_object('saida', count(*) filter (where emissao_propria and tipo = 'saida'), 'entrada', count(*) filter (where not (emissao_propria and tipo = 'saida')))
          from nfe_notas where empresa_id = p_empresa and importado_em > desde) end,
    'avisos', (select count(*) from notificacoes where user_id = auth.uid() and empresa_id = p_empresa and lida_em is null)
  ) into mud;

  -- ontem (dia útil anterior), por área
  if _manha_ve(p_empresa, 'fin') then
    ont := ont || jsonb_build_object('fin', (select jsonb_build_object(
      'recebido', coalesce(sum(l.valor) filter (where p.natureza = 'C' and p.tipo = 'E'), 0),
      'pago', coalesce(sum(l.valor) filter (where p.natureza = 'D' and p.tipo = 'S'), 0),
      'lancamentos', count(*) filter (where p.tipo in ('E', 'S')))
      from lancamentos l join plano_contas p on p.id = l.plano_id
     where l.empresa_id = p_empresa and l.status = 'Pago' and l.data = ontem and l.conta_id is not null));
  end if;
  if _manha_ve(p_empresa, 'fin') or _manha_ve(p_empresa, 'com') or _manha_ve(p_empresa, 'cpd') then
    ont := ont || jsonb_build_object('fat', (select jsonb_build_object('notas', count(distinct n.id), 'valor', coalesce(sum(_dir_fat_sinal(i.cfop, n.emissao_propria) *
        (coalesce(i.vprod, 0) - coalesce(i.vdesc, 0) + coalesce(i.vfrete, 0) + coalesce(i.voutro, 0) + coalesce(i.v_ipi, 0) + coalesce(i.v_st, 0))), 0))
      from nfe_notas n join nfe_itens i on i.nota_id = n.id
     where n.empresa_id = p_empresa and n.situacao = 'autorizada' and n.emissao = ontem and coalesce(_dir_fat_sinal(i.cfop, n.emissao_propria), 0) <> 0));
  end if;
  if _manha_ve(p_empresa, 'cmp') then
    ont := ont || jsonb_build_object('entradas', (select jsonb_build_object('notas', count(*), 'valor', coalesce(sum(v_nf), 0))
      from nfe_notas where empresa_id = p_empresa and situacao = 'autorizada' and emissao = ontem and not (emissao_propria and tipo = 'saida')));
  end if;
  if _manha_ve(p_empresa, 'prd') then
    ont := ont || jsonb_build_object('prod', (select jsonb_build_object('boa', coalesce(sum(qtd_boa), 0), 'refugo', coalesce(sum(refugo), 0), 'apontamentos', count(*))
      from prod_apontamentos where empresa_id = p_empresa and (inicio at time zone 'America/Recife')::date = ontem),
      'rnc', (select count(*) from qual_rnc where empresa_id = p_empresa and situacao <> 'cancelada' and (aberta_em at time zone 'America/Recife')::date = ontem));
  end if;
  if _manha_ve(p_empresa, 'log') then
    ont := ont || jsonb_build_object('log', (select jsonb_build_object('cargas', count(distinct g.id), 'entregues', count(cn.id) filter (where cn.situacao = 'entregue'),
        'problemas', count(cn.id) filter (where cn.situacao in ('devolvida', 'nao_entregue')))
      from log_cargas g left join log_carga_notas cn on cn.carga_id = g.id where g.empresa_id = p_empresa and g.data = ontem and g.status <> 'cancelada'));
  end if;

  return jsonb_build_object('desde', desde, 'ontem', ontem, 'mudou', mud, 'dia', ont, 'detalhe_pessoas', adm);
end $$;
revoke all on function public.manha_resumo(uuid) from public, anon;
grant execute on function public.manha_resumo(uuid) to authenticated;
revoke all on function public._manha_ve(uuid, text) from public, anon;
grant execute on function public._manha_ve(uuid, text) to authenticated;

-- conferência: tabela = 1, função = 1
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'manha_preferencias') as tabela,
       (select count(*) from pg_proc where proname = 'manha_resumo') as funcao;
