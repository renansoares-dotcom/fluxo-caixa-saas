-- 173 — Análise de Problemas, 2ª etapa (20/11/2026, pedido do Renan: "continuar desenvolvendo")
--   1. Anexos no problema e na ação: fotos e documentos como evidência (bucket próprio, 10 MB por arquivo).
--   2. Pareto: três fontes novas da Logística e de Compras — entregas fora do prazo por cliente, ocorrências de entrega por tipo
--      e pedidos de compra atrasados por fornecedor.
-- (Os 5 porquês da RNC e a causa da OS passam a ir para o problema novo, e o Painel da Diretoria ganha o resumo: é só tela, sem SQL.)
-- Aditivo.

-- 1) anexos
create table if not exists public.prob_anexos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  problema_id uuid not null references public.prob_problemas(id) on delete cascade,
  acao_id uuid references public.prob_acoes(id) on delete set null,    -- evidência de uma ação do plano (opcional)
  caminho text not null unique, nome text not null, tipo text, tamanho bigint,
  criado_por uuid default auth.uid(), criado_por_nome text, criado_em timestamptz not null default now()
);
create index if not exists prob_anexos_p on public.prob_anexos(problema_id, criado_em);
alter table public.prob_anexos enable row level security;
drop policy if exists prob_anexos_sel on public.prob_anexos;
create policy prob_anexos_sel on public.prob_anexos for select to authenticated using (public.prob_ve(empresa_id));
revoke all on public.prob_anexos from anon;
revoke insert, update, delete, truncate on public.prob_anexos from authenticated;
grant select on public.prob_anexos to authenticated;

-- o arquivo fica em problemas/<empresa>/<problema>/<arquivo>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('problemas', 'problemas', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/csv', 'text/plain'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;
drop policy if exists problemas_arq_sel on storage.objects;
drop policy if exists problemas_arq_ins on storage.objects;
drop policy if exists problemas_arq_del on storage.objects;
create policy problemas_arq_sel on storage.objects for select to authenticated using (bucket_id = 'problemas' and public.prob_ve(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy problemas_arq_ins on storage.objects for insert to authenticated with check (bucket_id = 'problemas' and public.prob_pode(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy problemas_arq_del on storage.objects for delete to authenticated using (bucket_id = 'problemas' and public.prob_pode(public._uuid_ou_nulo((storage.foldername(name))[1])));

-- registra o arquivo já enviado: confere o caminho, o problema e a ação
create or replace function public.prob_anexar(p_problema uuid, p_acao uuid, p_caminho text, p_nome text, p_tipo text default null, p_tamanho bigint default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare x prob_problemas; v_id uuid;
begin
  select * into x from prob_problemas where id = p_problema;
  if x.id is null or not public.prob_pode(x.empresa_id) then raise exception 'Problema não encontrado ou sem permissão.'; end if;
  if x.situacao = 'cancelado' then raise exception 'Problema cancelado não recebe anexo.'; end if;
  if p_caminho is null or p_caminho not like x.empresa_id::text || '/' || x.id::text || '/%' or p_caminho like '%..%' then raise exception 'Caminho do arquivo inválido.'; end if;
  if coalesce(length(trim(p_nome)), 0) = 0 then raise exception 'Informe o nome do arquivo.'; end if;
  if p_acao is not null and not exists (select 1 from prob_acoes where id = p_acao and problema_id = p_problema) then raise exception 'A ação não é deste problema.'; end if;
  if (select count(*) from prob_anexos where problema_id = p_problema) >= 40 then raise exception 'Limite de 40 anexos por problema.'; end if;
  insert into prob_anexos(empresa_id, problema_id, acao_id, caminho, nome, tipo, tamanho, criado_por_nome)
  values (x.empresa_id, p_problema, p_acao, p_caminho, left(trim(p_nome), 200), p_tipo, p_tamanho, public._prob_nome(x.empresa_id, auth.uid())) returning id into v_id;
  perform public._prob_log(p_problema, 'Anexo incluído: ' || left(trim(p_nome), 120) || case when p_acao is not null then ' (ação ' || (select numero from prob_acoes where id = p_acao) || ')' else '' end || '.');
  return v_id;
end $$;

-- exclui o registro e devolve o caminho, para a tela apagar o arquivo. Quem enviou ou quem conduz o problema
create or replace function public.prob_anexo_excluir(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare a prob_anexos; x prob_problemas;
begin
  select * into a from prob_anexos where id = p_id;
  select * into x from prob_problemas where id = a.problema_id;
  if a.id is null or not public.prob_pode(a.empresa_id) then raise exception 'Anexo não encontrado ou sem permissão.'; end if;
  if not (a.criado_por = auth.uid() or public._prob_conduz(x)) then raise exception 'Só quem enviou o anexo ou quem conduz o problema exclui.'; end if;
  if x.situacao in ('encerrado', 'cancelado') then raise exception 'Problema encerrado ou cancelado: os anexos ficam preservados.'; end if;
  delete from prob_anexos where id = p_id;
  perform public._prob_log(a.problema_id, 'Anexo excluído: ' || left(a.nome, 120) || '.');
  return a.caminho;
end $$;
revoke all on function public.prob_anexar(uuid, uuid, text, text, text, bigint), public.prob_anexo_excluir(uuid) from public, anon;
grant execute on function public.prob_anexar(uuid, uuid, text, text, text, bigint), public.prob_anexo_excluir(uuid) to authenticated;

-- 2) Pareto: as fontes do SQL 172 e mais três (entregas_atraso, ocorrencias, atraso_fornecedor)
create or replace function public.prob_pareto(p_empresa uuid, p_fonte text, p_de date, p_ate date)
returns table (nome text, valor numeric, qtd bigint) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.prob_ve(p_empresa) then raise exception 'Sem permissão.'; end if;
  if p_de is null or p_ate is null or p_ate < p_de then raise exception 'Período inválido.'; end if;
  if p_fonte = 'paradas' then          -- horas de máquina parada por motivo (paradas não planejadas)
    return query select coalesce(m.nome, 'Sem motivo informado'), round(sum(extract(epoch from (coalesce(p.fim, now()) - p.inicio)) / 3600.0)::numeric, 1), count(*)
      from prod_paradas p left join prod_motivos m on m.id = p.motivo_id
     where p.empresa_id = p_empresa and p.inicio >= p_de and p.inicio < p_ate + 1 and not coalesce(m.planejada, false) group by 1;
  elsif p_fonte = 'refugos' then       -- kg de refugo por motivo
    return query select coalesce(m.nome, 'Sem motivo informado'), round(sum(a.refugo), 1), count(*)
      from prod_apontamentos a left join prod_motivos m on m.id = a.refugo_motivo_id
     where a.empresa_id = p_empresa and a.inicio >= p_de and a.inicio < p_ate + 1 and a.refugo > 0 group by 1;
  elsif p_fonte = 'falhas' then        -- ordens corretivas de manutenção por tipo de falha
    return query select coalesce(f.nome, 'Sem falha informada'), count(*)::numeric, count(*)
      from man_ordens o left join man_falhas f on f.id = o.falha_id
     where o.empresa_id = p_empresa and o.tipo = 'corretiva' and o.situacao <> 'cancelada' and o.solicitada_em >= p_de and o.solicitada_em < p_ate + 1 group by 1;
  elsif p_fonte = 'rnc_produto' then   -- não conformidades por produto
    return query select coalesce(pr.descricao, 'Sem produto'), count(*)::numeric, count(*)
      from qual_rnc r left join produtos pr on pr.id = r.produto_id
     where r.empresa_id = p_empresa and r.situacao <> 'cancelada' and r.aberta_em >= p_de and r.aberta_em < p_ate + 1 group by 1;
  elsif p_fonte = 'rnc_custo' then     -- custo da não qualidade por origem da RNC
    return query select case r.origem when 'inspecao' then 'Inspeção' when 'processo' then 'Processo' when 'cliente' then 'Cliente' when 'fornecedor' then 'Fornecedor' when 'auditoria' then 'Auditoria' else 'Interna' end,
        round(sum(r.custo), 2), count(*)
      from qual_rnc r where r.empresa_id = p_empresa and r.situacao <> 'cancelada' and r.aberta_em >= p_de and r.aberta_em < p_ate + 1 group by 1 having sum(r.custo) > 0;
  elsif p_fonte = 'devolucoes' then    -- valor das notas de devolução por cliente
    return query select coalesce(nullif(case when n.emissao_propria then n.dest_nome else n.emit_nome end, ''), 'Sem nome'), round(sum(n.v_nf), 2), count(*)
      from nfe_notas n where n.empresa_id = p_empresa and n.finalidade = '4' and n.tipo = 'entrada' and n.situacao = 'autorizada' and n.emissao >= p_de and n.emissao <= p_ate group by 1;
  elsif p_fonte = 'vencidos' then      -- títulos a receber vencidos e em aberto, por cliente (vencimento no período)
    if not exists (select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor')) then raise exception 'Esta fonte é do financeiro: só administrador, financeiro ou diretor consulta.'; end if;
    return query select coalesce(f.nome, 'Sem cliente'), round(sum(l.valor), 2), count(*)
      from lancamentos l join plano_contas pc on pc.id = l.plano_id left join favorecidos f on f.id = l.favorecido_id
     where l.empresa_id = p_empresa and l.status = 'Em aberto' and pc.tipo = 'E' and l.data >= p_de and l.data <= least(p_ate, (now() at time zone 'America/Recife')::date - 1) group by 1;
  elsif p_fonte = 'entregas_atraso' then   -- entregas a clientes fora do prazo (dias entre a emissão da nota e a entrega acima do parâmetro da Logística), por cliente
    return query select coalesce(nullif(n.dest_nome, ''), 'Sem nome'), count(*)::numeric, count(*)
      from log_carga_notas cn join log_cargas g on g.id = cn.carga_id join nfe_notas n on n.id = cn.nota_id
     where cn.empresa_id = p_empresa and cn.situacao = 'entregue' and cn.entregue_em is not null and n.emissao is not null and coalesce(g.status, '') <> 'cancelada'
       and g.data >= p_de and g.data <= p_ate
       and (cn.entregue_em at time zone 'America/Recife')::date - n.emissao > coalesce((select dias_atraso from log_parametros where empresa_id = p_empresa limit 1), 3) group by 1;
  elsif p_fonte = 'ocorrencias' then   -- ocorrências registradas nas entregas, por tipo
    return query select case o.tipo when 'ausente' then 'Cliente ausente' when 'recusa' then 'Recusa da mercadoria' when 'avaria' then 'Avaria' when 'endereco' then 'Endereço errado' when 'atraso' then 'Atraso' when 'veiculo' then 'Problema no veículo' else 'Outro' end,
        count(*)::numeric, count(*)
      from log_ocorrencias o where o.empresa_id = p_empresa and o.criado_em >= p_de and o.criado_em < p_ate + 1 group by 1;
  elsif p_fonte = 'atraso_fornecedor' then   -- pedidos de compra recebidos depois da data prevista, ou vencidos e ainda não recebidos, por fornecedor
    return query select coalesce(f.nome, 'Sem fornecedor'), count(*)::numeric, count(*)
      from compras_pedidos pd left join favorecidos f on f.id = pd.favorecido_id
      left join lateral (select min(r.data) primeira from compras_recebimentos r where r.pedido_id = pd.id) rc on true
     where pd.empresa_id = p_empresa and pd.entrega_prevista >= p_de and pd.entrega_prevista <= p_ate and pd.status in ('aprovado', 'enviado', 'recebido_parcial', 'recebido')
       and coalesce(rc.primeira, (now() at time zone 'America/Recife')::date) > pd.entrega_prevista group by 1;
  else raise exception 'Fonte de dados desconhecida.';
  end if;
end $$;
