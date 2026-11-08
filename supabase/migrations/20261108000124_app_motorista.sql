-- App do motorista (melhoria 7.1 do plano de melhoria contínua, Passo 4) — 08/11/2026.
-- Aditivo. O motorista entra na plataforma pelo celular (perfil novo "motorista") e só vê as cargas dele:
--   • rota do dia na ordem de entrega, com endereço, telefone, volumes e o mapa;
--   • iniciar a rota (km de saída), chegada no cliente, entrega com o nome e o documento de quem recebeu,
--     a foto do canhoto e a assinatura na tela, ocorrência (cliente ausente, recusa, avaria, endereço, outro) com foto,
--     e concluir a rota (km de chegada);
--   • posição do celular a cada N minutos durante a rota (opcional, parâmetro);
--   • funciona sem internet (modo sem internet, SQL 122): os registros sobem quando o sinal voltar.
-- O cliente vê no Portal "saiu para entrega", quantas entregas faltam antes da dele e, depois, o canhoto;
-- e recebe e-mail na saída e na entrega (parâmetros). Ocorrência avisa a logística.

-- 1) perfil e acesso
alter type public.papel_membro add value if not exists 'motorista';

-- o motorista não é membro "pleno": não vê financeiro, cadastros nem relatórios (mesma regra de compras, vendas e produção)
create or replace function public.is_membro(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text not in ('compras', 'vendas', 'producao', 'motorista')))
     and public._mfa_ok(p_empresa);
$$;
create or replace function public.minhas_empresas()
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.empresa_id from membros m
   where m.user_id = auth.uid() and m.papel::text not in ('compras', 'vendas', 'producao', 'motorista') and public._mfa_ok(m.empresa_id);
$$;

-- 2) ligações
alter table public.frota_motoristas add column if not exists user_id uuid references auth.users(id) on delete set null;
create unique index if not exists frota_motoristas_user on public.frota_motoristas(empresa_id, user_id) where user_id is not null;
alter table public.log_cargas add column if not exists motorista_id uuid references public.frota_motoristas(id) on delete set null;
alter table public.log_cargas add column if not exists km_saida numeric(10,1);
alter table public.log_cargas add column if not exists km_chegada numeric(10,1);
create index if not exists log_cargas_motorista on public.log_cargas(motorista_id, data) where motorista_id is not null;
alter table public.log_carga_notas add column if not exists chegada_em timestamptz;
alter table public.log_carga_notas add column if not exists recebedor_nome text check (length(recebedor_nome) <= 120);
alter table public.log_carga_notas add column if not exists recebedor_doc text check (length(recebedor_doc) <= 30);
alter table public.log_carga_notas add column if not exists canhoto_path text;
alter table public.log_carga_notas add column if not exists assinatura_path text;
alter table public.log_carga_notas add column if not exists lat numeric(9,6);
alter table public.log_carga_notas add column if not exists lng numeric(9,6);
alter table public.log_carga_notas add column if not exists baixa_por text;         -- 'app' quando veio do celular

-- 3) parâmetros do app (Logística › Cargas › App do motorista)
create table if not exists public.log_app_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  exigir_canhoto boolean not null default true,
  exigir_assinatura boolean not null default false,
  exigir_recebedor boolean not null default true,
  exigir_km boolean not null default true,
  rastrear_min smallint not null default 0 check (rastrear_min between 0 and 60),   -- 0 = não grava a posição durante a rota
  avisar_cliente_saida boolean not null default true,
  avisar_cliente_entrega boolean not null default true,
  portal_mostra_fila boolean not null default true,                               -- "faltam N entregas antes da sua"
  papeis_ocorrencia text[] not null default array['admin', 'financeiro', 'diretor'],
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
alter table public.log_app_config enable row level security;
drop policy if exists log_app_config_sel on public.log_app_config;
drop policy if exists log_app_config_ins on public.log_app_config;
drop policy if exists log_app_config_upd on public.log_app_config;
create policy log_app_config_sel on public.log_app_config for select to authenticated using (public.is_participante(empresa_id));
create policy log_app_config_ins on public.log_app_config for insert to authenticated with check (public.pode_logistica(empresa_id));
create policy log_app_config_upd on public.log_app_config for update to authenticated using (public.pode_logistica(empresa_id)) with check (public.pode_logistica(empresa_id));
grant select, insert, update on public.log_app_config to authenticated;
drop trigger if exists zz_auditoria on public.log_app_config;
create trigger zz_auditoria after insert or update or delete on public.log_app_config for each row execute function public._auditar();

create or replace function public._log_app_cfg(p_empresa uuid) returns public.log_app_config
language sql stable security definer set search_path = public as $$
  select coalesce((select c from log_app_config c where c.empresa_id = p_empresa),
                  row(p_empresa, true, false, true, true, 0, true, true, true, array['admin', 'financeiro', 'diretor'], now(), null)::log_app_config);
$$;
revoke all on function public._log_app_cfg(uuid) from public, anon, authenticated;

-- 4) ocorrências e posições
create table if not exists public.log_ocorrencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  carga_id uuid not null references public.log_cargas(id) on delete cascade,
  carga_nota_id uuid references public.log_carga_notas(id) on delete set null,
  tipo text not null check (tipo in ('ausente', 'recusa', 'avaria', 'endereco', 'atraso', 'veiculo', 'outro')),
  descricao text check (length(descricao) <= 2000),
  foto_path text,
  nao_entregue boolean not null default false,
  lat numeric(9,6), lng numeric(9,6),
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now(),
  resolvida_em timestamptz, resolvida_por text, resolucao text check (length(resolucao) <= 2000)
);
create index if not exists log_ocorrencias_carga on public.log_ocorrencias(carga_id);
create index if not exists log_ocorrencias_abertas on public.log_ocorrencias(empresa_id) where resolvida_em is null;
create table if not exists public.log_posicoes (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  carga_id uuid not null references public.log_cargas(id) on delete cascade,
  lat numeric(9,6) not null, lng numeric(9,6) not null, precisao_m numeric(8,1),
  em timestamptz not null default now()
);
create index if not exists log_posicoes_carga on public.log_posicoes(carga_id, em desc);
do $$
declare t text;
begin
  foreach t in array array['log_ocorrencias', 'log_posicoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.ve_logistica(empresa_id))', t || '_sel', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
-- a logística resolve a ocorrência; a inclusão é só pelo app (funções abaixo)
create policy log_ocorrencias_upd on public.log_ocorrencias for update to authenticated using (public.pode_logistica(empresa_id)) with check (public.pode_logistica(empresa_id));
grant update (resolvida_em, resolvida_por, resolucao) on public.log_ocorrencias to authenticated;
drop trigger if exists zz_auditoria on public.log_ocorrencias;
create trigger zz_auditoria after insert or update or delete on public.log_ocorrencias for each row execute function public._auditar();

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('log_ocorrencia', 'Logística', 'Ocorrência na entrega', 'O motorista registrou uma ocorrência (cliente ausente, recusa, avaria, endereço, veículo).', false, 75)
on conflict (codigo) do nothing;

-- 5) quem é o motorista da carga
create or replace function public._eh_motorista_da_carga(p_carga uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from log_cargas c join frota_motoristas m on m.id = c.motorista_id
                  join membros mb on mb.empresa_id = c.empresa_id and mb.user_id = auth.uid()
                 where c.id = p_carga and m.user_id = auth.uid() and m.ativo and public._mfa_ok(c.empresa_id));
$$;
revoke all on function public._eh_motorista_da_carga(uuid) from public, anon;
grant execute on function public._eh_motorista_da_carga(uuid) to authenticated;

-- carga em que o motorista pode mexer (ou a logística, pelo escritório)
create or replace function public._log_carga_app(p_carga uuid) returns public.log_cargas
language plpgsql stable security definer set search_path = public as $$
declare c log_cargas;
begin
  select * into c from log_cargas where id = p_carga;
  if c.id is null then raise exception 'Carga não encontrada.'; end if;
  if not (public._eh_motorista_da_carga(c.id) or public.pode_logistica(c.empresa_id)) then raise exception 'Esta carga não é sua.'; end if;
  if c.status in ('cancelada') then raise exception 'Carga cancelada.'; end if;
  return c;
end $$;
revoke all on function public._log_carga_app(uuid) from public, anon, authenticated;

-- 6) as cargas do motorista: de ontem a amanhã e as que ainda estão em rota
create or replace function public.log_motorista_cargas()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce((
    with ns as (select array[array['n', 'http://www.portalfiscal.inf.br/nfe']] a),
    cg as (
      select c.*, v.codigo veic_codigo, v.placa veic_placa, m.nome mot_nome, e.nome empresa_nome
        from log_cargas c join frota_motoristas m on m.id = c.motorista_id join empresas e on e.id = c.empresa_id
        left join log_veiculos v on v.id = c.veiculo_id
       where m.user_id = auth.uid() and m.ativo and c.status not in ('cancelada')
         and (c.status in ('carregando', 'pronta', 'em_rota') or c.data between current_date - 1 and current_date + 1)
         and exists (select 1 from membros mb where mb.empresa_id = c.empresa_id and mb.user_id = auth.uid()) and public._mfa_ok(c.empresa_id))
    select jsonb_agg(jsonb_build_object(
      'id', cg.id, 'empresa_id', cg.empresa_id, 'empresa', cg.empresa_nome, 'numero', cg.numero, 'data', cg.data, 'status', cg.status,
      'veiculo', cg.veic_codigo, 'placa', cg.veic_placa, 'motorista', cg.mot_nome, 'saida_em', cg.saida_em, 'km_saida', cg.km_saida, 'observacao', cg.observacao,
      'config', (select to_jsonb(x) - 'atualizado_por' from (select (public._log_app_cfg(cg.empresa_id)).*) x),
      'entregas', coalesce((select jsonb_agg(jsonb_build_object(
          'id', cn.id, 'seq', cn.seq, 'situacao', cn.situacao, 'chegada_em', cn.chegada_em, 'entregue_em', cn.entregue_em, 'recebedor_nome', cn.recebedor_nome,
          'tem_canhoto', cn.canhoto_path is not null, 'peso_kg', cn.peso_kg, 'nota', n.numero, 'serie', n.serie, 'valor', n.v_nf, 'cliente', n.dest_nome, 'documento', n.dest_doc,
          'logradouro', (xpath('//n:dest/n:enderDest/n:xLgr/text()', n.xml::xml, ns.a))[1]::text,
          'nro', (xpath('//n:dest/n:enderDest/n:nro/text()', n.xml::xml, ns.a))[1]::text,
          'complemento', (xpath('//n:dest/n:enderDest/n:xCpl/text()', n.xml::xml, ns.a))[1]::text,
          'bairro', (xpath('//n:dest/n:enderDest/n:xBairro/text()', n.xml::xml, ns.a))[1]::text,
          'cidade', (xpath('//n:dest/n:enderDest/n:xMun/text()', n.xml::xml, ns.a))[1]::text,
          'uf', n.dest_uf,
          'cep', (xpath('//n:dest/n:enderDest/n:CEP/text()', n.xml::xml, ns.a))[1]::text,
          'fone', (xpath('//n:dest/n:enderDest/n:fone/text()', n.xml::xml, ns.a))[1]::text,
          'volumes', (select sum(nullif(v::text, '')::numeric) from unnest(xpath('//n:transp/n:vol/n:qVol/text()', n.xml::xml, ns.a)) v),
          'restricao', (select concat_ws(' · ', nullif(lc.horario, ''), nullif(lc.observacao, '')) from log_clientes lc where lc.empresa_id = cn.empresa_id and lc.documento = n.dest_doc),
          'ocorrencias', (select count(*) from log_ocorrencias o where o.carga_nota_id = cn.id))
        order by cn.seq) from log_carga_notas cn join nfe_notas n on n.id = cn.nota_id where cn.carga_id = cg.id), '[]'::jsonb))
      order by cg.data, cg.numero)
    from cg, ns), '[]'::jsonb);
end $$;
revoke all on function public.log_motorista_cargas() from public, anon;
grant execute on function public.log_motorista_cargas() to authenticated;

-- 7) ações do app
create or replace function public.log_motorista_iniciar(p_carga uuid, p_km numeric default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare c log_cargas;
begin
  c := _log_carga_app(p_carga);
  if c.status = 'em_rota' then return true; end if;                                      -- repetido (sem internet): segue
  if c.status not in ('planejada', 'carregando', 'pronta') then raise exception 'A carga já foi concluída.'; end if;
  if (_log_app_cfg(c.empresa_id)).exigir_km and p_km is null then raise exception 'Informe o km do painel na saída.'; end if;
  if p_km is not null and p_km < 0 then raise exception 'Km inválido.'; end if;
  update log_cargas set status = 'em_rota', km_saida = coalesce(p_km, km_saida), saida_em = coalesce(saida_em, now()) where id = c.id;
  return true;
end $$;

create or replace function public.log_motorista_chegada(p_carga_nota uuid, p_lat numeric default null, p_lng numeric default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare cn log_carga_notas; c log_cargas;
begin
  select * into cn from log_carga_notas where id = p_carga_nota;
  if cn.id is null then raise exception 'Entrega não encontrada.'; end if;
  c := _log_carga_app(cn.carga_id);
  if c.status <> 'em_rota' then raise exception 'Inicie a rota antes.'; end if;
  update log_carga_notas set chegada_em = coalesce(chegada_em, now()), lat = coalesce(lat, p_lat), lng = coalesce(lng, p_lng) where id = cn.id;
  return true;
end $$;

create or replace function public.log_motorista_entregar(p_carga_nota uuid, p_recebedor text default null, p_documento text default null,
  p_canhoto text default null, p_assinatura text default null, p_lat numeric default null, p_lng numeric default null, p_obs text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare cn log_carga_notas; c log_cargas; cfg log_app_config; pref text;
begin
  select * into cn from log_carga_notas where id = p_carga_nota;
  if cn.id is null then raise exception 'Entrega não encontrada.'; end if;
  c := _log_carga_app(cn.carga_id);
  if cn.situacao = 'entregue' then return true; end if;                                  -- repetido: já está entregue
  if c.status <> 'em_rota' then raise exception 'Inicie a rota antes.'; end if;
  cfg := _log_app_cfg(c.empresa_id);
  if cfg.exigir_recebedor and coalesce(trim(p_recebedor), '') = '' then raise exception 'Informe o nome de quem recebeu.'; end if;
  if cfg.exigir_canhoto and p_canhoto is null then raise exception 'Tire a foto do canhoto assinado.'; end if;
  if cfg.exigir_assinatura and p_assinatura is null then raise exception 'Peça a assinatura na tela.'; end if;
  -- os arquivos precisam estar na pasta desta carga
  pref := c.empresa_id || '/entregas/' || c.id || '/';
  if (p_canhoto is not null and left(p_canhoto, length(pref)) <> pref) or (p_assinatura is not null and left(p_assinatura, length(pref)) <> pref) then
    raise exception 'Arquivo fora da pasta da carga.';
  end if;
  update log_carga_notas set situacao = 'entregue', entregue_em = now(), chegada_em = coalesce(chegada_em, now()),
    recebedor_nome = nullif(trim(p_recebedor), ''), recebedor_doc = nullif(trim(p_documento), ''), canhoto_path = p_canhoto, assinatura_path = p_assinatura,
    lat = coalesce(p_lat, lat), lng = coalesce(p_lng, lng), observacao = coalesce(nullif(trim(p_obs), ''), observacao), baixa_por = 'app'
  where id = cn.id;
  return true;
end $$;

create or replace function public.log_motorista_ocorrencia(p_carga uuid, p_carga_nota uuid, p_tipo text, p_descricao text default null,
  p_foto text default null, p_nao_entregue boolean default false, p_lat numeric default null, p_lng numeric default null, p_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare c log_cargas; v_id uuid; v_cli text; cfg log_app_config;
begin
  c := _log_carga_app(p_carga);
  if p_id is not null and exists (select 1 from log_ocorrencias where id = p_id) then return p_id; end if;      -- repetido
  if p_carga_nota is not null and not exists (select 1 from log_carga_notas where id = p_carga_nota and carga_id = c.id) then raise exception 'A entrega não é desta carga.'; end if;
  if p_nao_entregue and p_carga_nota is null then raise exception 'Escolha a entrega que não foi feita.'; end if;
  if p_tipo = 'outro' and coalesce(trim(p_descricao), '') = '' then raise exception 'Descreva a ocorrência.'; end if;
  if p_foto is not null and left(p_foto, length(c.empresa_id || '/entregas/' || c.id || '/')) <> c.empresa_id || '/entregas/' || c.id || '/' then raise exception 'Arquivo fora da pasta da carga.'; end if;
  insert into log_ocorrencias(id, empresa_id, carga_id, carga_nota_id, tipo, descricao, foto_path, nao_entregue, lat, lng)
  values (coalesce(p_id, gen_random_uuid()), c.empresa_id, c.id, p_carga_nota, p_tipo, nullif(trim(p_descricao), ''), p_foto, coalesce(p_nao_entregue, false), p_lat, p_lng)
  returning id into v_id;
  if p_nao_entregue then
    update log_carga_notas set situacao = 'nao_entregue', observacao = coalesce(nullif(trim(p_descricao), ''), observacao), baixa_por = 'app'
     where id = p_carga_nota and situacao = 'pendente';
  end if;
  select n.dest_nome into v_cli from log_carga_notas cn join nfe_notas n on n.id = cn.nota_id where cn.id = p_carga_nota;
  cfg := _log_app_cfg(c.empresa_id);
  perform _notificar_u(c.empresa_id, _usuarios_papel(c.empresa_id, cfg.papeis_ocorrencia), 'log_ocorrencia',
    'Ocorrência na carga ' || c.numero || ': ' || case p_tipo when 'ausente' then 'cliente ausente' when 'recusa' then 'recusa' when 'avaria' then 'avaria'
      when 'endereco' then 'endereço' when 'atraso' then 'atraso' when 'veiculo' then 'veículo' else 'outra' end,
    concat_ws(' · ', v_cli, case when p_nao_entregue then 'NÃO ENTREGUE' end, nullif(trim(p_descricao), '')), '#/logistica?carga=' || c.id, v_id, p_tipo = 'veiculo');
  return v_id;
end $$;

create or replace function public.log_motorista_posicao(p_carga uuid, p_lat numeric, p_lng numeric, p_precisao numeric default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare c log_cargas; v_min smallint;
begin
  c := _log_carga_app(p_carga);
  v_min := (_log_app_cfg(c.empresa_id)).rastrear_min;
  if v_min = 0 or c.status <> 'em_rota' then return true; end if;
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Posição inválida.'; end if;
  -- uma posição a cada (rastrear_min - 10%) no mínimo
  if exists (select 1 from log_posicoes where carga_id = c.id and em > now() - make_interval(secs => v_min * 54)) then return true; end if;
  insert into log_posicoes(empresa_id, carga_id, lat, lng, precisao_m) values (c.empresa_id, c.id, p_lat, p_lng, p_precisao);
  return true;
end $$;

create or replace function public.log_motorista_concluir(p_carga uuid, p_km numeric default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare c log_cargas; v_pend int;
begin
  c := _log_carga_app(p_carga);
  if c.status = 'concluida' then return true; end if;
  if c.status <> 'em_rota' then raise exception 'A rota ainda não começou.'; end if;
  select count(*) into v_pend from log_carga_notas where carga_id = c.id and situacao = 'pendente';
  if v_pend > 0 then raise exception 'Ainda há % entrega(s) sem baixa: entregue ou ocorrência de não entregue.', v_pend; end if;
  if (_log_app_cfg(c.empresa_id)).exigir_km and p_km is null then raise exception 'Informe o km do painel na chegada.'; end if;
  if p_km is not null and c.km_saida is not null and p_km < c.km_saida then raise exception 'O km de chegada é menor que o de saída.'; end if;
  update log_cargas set status = 'concluida', km_chegada = p_km, km_real = case when p_km is not null and km_saida is not null then p_km - km_saida else km_real end,
    retorno_em = coalesce(retorno_em, now()) where id = c.id;
  return true;
end $$;

do $$
declare f text;
begin
  foreach f in array array['log_motorista_iniciar(uuid, numeric)', 'log_motorista_chegada(uuid, numeric, numeric)',
    'log_motorista_entregar(uuid, text, text, text, text, numeric, numeric, text)', 'log_motorista_ocorrencia(uuid, uuid, text, text, text, boolean, numeric, numeric, uuid)',
    'log_motorista_posicao(uuid, numeric, numeric, numeric)', 'log_motorista_concluir(uuid, numeric)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- 8) arquivos do app: logistica/<empresa>/entregas/<carga>/<arquivo>
drop policy if exists logistica_app_ins on storage.objects;
drop policy if exists logistica_app_sel on storage.objects;
drop policy if exists logistica_portal_sel on storage.objects;
create policy logistica_app_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'logistica' and (storage.foldername(name))[2] = 'entregas' and public._eh_motorista_da_carga(public._uuid_ou_nulo((storage.foldername(name))[3])));
create policy logistica_app_sel on storage.objects for select to authenticated
  using (bucket_id = 'logistica' and (storage.foldername(name))[2] = 'entregas' and public._eh_motorista_da_carga(public._uuid_ou_nulo((storage.foldername(name))[3])));
-- o cliente do Portal vê o canhoto das notas dele
create or replace function public._log_canhoto_do_portal(p_nome text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from log_carga_notas cn join nfe_notas n on n.id = cn.nota_id join portal_usuarios pu on pu.empresa_id = n.empresa_id and pu.user_id = auth.uid() and pu.ativo
                  join favorecidos f on f.id = pu.favorecido_id
                 where cn.canhoto_path = p_nome
                   and (n.favorecido_id = f.id or (regexp_replace(coalesce(f.documento, ''), '\D', '', 'g') <> '' and n.dest_doc = regexp_replace(f.documento, '\D', '', 'g'))));
$$;
revoke all on function public._log_canhoto_do_portal(text) from public, anon;
grant execute on function public._log_canhoto_do_portal(text) to authenticated;
create policy logistica_portal_sel on storage.objects for select to authenticated
  using (bucket_id = 'logistica' and (storage.foldername(name))[2] = 'entregas' and public._log_canhoto_do_portal(name));

-- 9) Portal: situação da entrega das notas do cliente
create or replace function public.portal_entregas(p_fav uuid)
returns table(nota_id uuid, numero int, situacao text, carga_status text, saida_em timestamptz, entregue_em timestamptz, recebedor text,
              canhoto_path text, antes_da_sua int, veiculo text)
language sql stable security definer set search_path = public as $$
  select n.id, n.numero, cn.situacao, c.status, c.saida_em, cn.entregue_em, cn.recebedor_nome, cn.canhoto_path,
         case when (public._log_app_cfg(c.empresa_id)).portal_mostra_fila and c.status = 'em_rota' and cn.situacao = 'pendente'
              then (select count(*)::int from log_carga_notas o where o.carga_id = c.id and o.seq < cn.seq and o.situacao = 'pendente') end,
         (select v.placa from log_veiculos v where v.id = c.veiculo_id)
    from nfe_notas n join favorecidos f on f.id = p_fav
    join log_carga_notas cn on cn.nota_id = n.id join log_cargas c on c.id = cn.carga_id and c.status <> 'cancelada'
   where portal_meu(p_fav) and n.empresa_id = f.empresa_id and n.emissao >= current_date - 120
     and (n.favorecido_id = f.id or (regexp_replace(coalesce(f.documento, ''), '\D', '', 'g') <> '' and n.dest_doc = regexp_replace(f.documento, '\D', '', 'g')))
     and not (c.veiculo_id is null and c.observacao like 'Baixa inicial%')
   order by n.emissao desc, n.numero desc;
$$;
revoke all on function public.portal_entregas(uuid) from public, anon;
grant execute on function public.portal_entregas(uuid) to authenticated;

-- 10) e-mails ao cliente: saiu para entrega e entregue
create or replace function public.email_padrao()
returns table(codigo text, nome text, assunto text, corpo text, botao text, campos text)
language sql immutable set search_path = public as $$
  values
  ('portal_convite', 'Convite para o Portal do Cliente', 'Convite para o Portal do Cliente — {{empresa}}',
   E'Olá,\n\n{{empresa}} liberou para {{cliente}} o acesso ao Portal do Cliente. Nele você vê os títulos e as notas fiscais, pede prorrogação de vencimento e aprova as artes das embalagens.\n\nClique no botão para criar a sua senha. O convite vale até {{validade}}.', 'Criar meu acesso', 'empresa, cliente, validade'),
  ('arte_aprovacao', 'Arte aguardando a aprovação do cliente', 'Arte nº {{numero}} aguardando a sua aprovação — {{arte}}',
   E'Olá,\n\nA versão {{versao}} da arte {{arte}} está pronta para a sua conferência.\n\n{{observacao}}\n\nConfira textos, cores, medidas e o código de barras. No Portal você pode marcar pontos na arte, aprovar ou pedir alteração. Responda até {{prazo}}.', 'Conferir a arte', 'empresa, cliente, arte, numero, versao, observacao, prazo'),
  ('prorrogacao_resposta', 'Resposta do pedido de prorrogação', 'Pedido de prorrogação {{decisao}} — {{documento}}',
   E'Olá,\n\nO seu pedido de prorrogação do título {{documento}} foi {{decisao}}. O vencimento é {{vencimento}}.\n\n{{resposta}}', 'Abrir o Portal', 'empresa, cliente, documento, decisao, vencimento, resposta'),
  ('aviso', 'Avisos da plataforma (Meus avisos)', '{{titulo}}', E'{{texto}}', 'Abrir na plataforma', 'empresa, titulo, texto'),
  ('teste', 'E-mail de teste', 'E-mail de teste — {{empresa}}', E'Olá {{nome}},\n\nSe você recebeu esta mensagem, o e-mail da plataforma está funcionando.', null, 'empresa, nome'),
  ('entrega_saiu', 'Pedido saiu para entrega', 'Seu pedido saiu para entrega — NF {{notas}}',
   E'Olá,\n\nA mercadoria das notas {{notas}} saiu para entrega hoje, no veículo {{veiculo}}.\n\nNo Portal você acompanha a entrega e, depois, vê o canhoto assinado.', 'Acompanhar a entrega', 'empresa, cliente, notas, veiculo'),
  ('entrega_feita', 'Pedido entregue', 'Pedido entregue — NF {{nota}}',
   E'Olá,\n\nA nota {{nota}} foi entregue em {{quando}} e recebida por {{recebedor}}.\n\nO canhoto assinado fica disponível no Portal.', 'Ver o canhoto', 'empresa, cliente, nota, quando, recebedor');
$$;
grant execute on function public.email_padrao() to authenticated, service_role;

create or replace function public._log_email_cliente() returns trigger
language plpgsql security definer set search_path = public as $$
declare cfg log_app_config; r record; v_placa text;
begin
  if tg_table_name = 'log_cargas' then
    if new.status = 'em_rota' and old.status is distinct from 'em_rota' then
      cfg := _log_app_cfg(new.empresa_id);
      if not cfg.avisar_cliente_saida then return null; end if;
      select coalesce(placa, codigo) into v_placa from log_veiculos where id = new.veiculo_id;
      for r in select pu.email, f.nome cli, pu.favorecido_id, string_agg(distinct n.numero::text, ', ') notas
                 from log_carga_notas cn join nfe_notas n on n.id = cn.nota_id
                 join portal_usuarios pu on pu.empresa_id = n.empresa_id and pu.ativo
                 join favorecidos f on f.id = pu.favorecido_id
                where cn.carga_id = new.id and cn.situacao = 'pendente'
                  and (n.favorecido_id = f.id or (regexp_replace(coalesce(f.documento, ''), '\D', '', 'g') <> '' and n.dest_doc = regexp_replace(f.documento, '\D', '', 'g')))
                group by pu.email, f.nome, pu.favorecido_id loop
        perform _email_enfileirar(new.empresa_id, 'entrega_saiu', r.email,
          jsonb_build_object('cliente', r.cli, 'notas', r.notas, 'veiculo', coalesce(v_placa, 'da empresa'), 'caminho', 'portal.html?aba=entregas'), new.id);
      end loop;
    end if;
  elsif tg_table_name = 'log_carga_notas' then
    if new.situacao = 'entregue' and old.situacao is distinct from 'entregue' and new.baixa_por = 'app' then
      cfg := _log_app_cfg(new.empresa_id);
      if not cfg.avisar_cliente_entrega then return null; end if;
      for r in select pu.email, f.nome cli, n.numero
                 from nfe_notas n join portal_usuarios pu on pu.empresa_id = n.empresa_id and pu.ativo join favorecidos f on f.id = pu.favorecido_id
                where n.id = new.nota_id
                  and (n.favorecido_id = f.id or (regexp_replace(coalesce(f.documento, ''), '\D', '', 'g') <> '' and n.dest_doc = regexp_replace(f.documento, '\D', '', 'g'))) loop
        perform _email_enfileirar(new.empresa_id, 'entrega_feita', r.email,
          jsonb_build_object('cliente', r.cli, 'nota', r.numero, 'quando', to_char(new.entregue_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
            'recebedor', coalesce(new.recebedor_nome, 'o cliente'), 'caminho', 'portal.html?aba=entregas'), new.id);
      end loop;
    end if;
  end if;
  return null;
end $$;
revoke all on function public._log_email_cliente() from public, anon, authenticated;
drop trigger if exists log_cargas_email on public.log_cargas;
create trigger log_cargas_email after update of status on public.log_cargas for each row execute function public._log_email_cliente();
drop trigger if exists log_carga_notas_email on public.log_carga_notas;
create trigger log_carga_notas_email after update of situacao on public.log_carga_notas for each row execute function public._log_email_cliente();

-- 11) sem internet: as ações do app entram na lista do sync_rpc (executa uma vez só por chave)
create or replace function public.sync_rpc(p_chave uuid, p_nome text, p_args jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare r jsonb; v_args text;
begin
  if p_chave is null then raise exception 'Chave obrigatória.'; end if;
  if p_nome is null or p_nome not in ('tin_pesar', 'log_motorista_iniciar', 'log_motorista_chegada', 'log_motorista_entregar', 'log_motorista_ocorrencia',
                                       'log_motorista_posicao', 'log_motorista_concluir') then
    raise exception 'Operação não permitida sem internet: %.', coalesce(p_nome, '');
  end if;
  if p_args is null or jsonb_typeof(p_args) <> 'object' then raise exception 'Argumentos inválidos.'; end if;
  select resultado into r from sync_chaves where chave = p_chave;
  if found then return r; end if;
  select string_agg(format('%I => %s', k, quote_nullable(v #>> '{}')), ', ' order by k) into v_args
    from jsonb_each(p_args) as x(k, v) where k ~ '^p_[a-z_]+$';
  execute format('select to_jsonb(public.%I(%s))', p_nome, coalesce(v_args, '')) into r;
  insert into sync_chaves(chave, nome, resultado) values (p_chave, p_nome, r);
  return r;
end $$;
revoke all on function public.sync_rpc(uuid, text, jsonb) from public, anon;
grant execute on function public.sync_rpc(uuid, text, jsonb) to authenticated;

select (select count(*) from pg_proc where proname like 'log_motorista_%') as funcoes_app,
       (select count(*) from information_schema.tables where table_name in ('log_ocorrencias', 'log_posicoes', 'log_app_config')) as tabelas;
