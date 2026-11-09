-- NF-e de entrada automática pela SEFAZ (DF-e) — melhoria 9.1 do plano de melhoria contínua, Passo 5 — 08/11/2026.
-- Aditivo. A função "sefaz-dfe" (com a ponte da Vercel, que leva o certificado A1) consulta a Distribuição DF-e do Ambiente
-- Nacional pelo último NSU e grava aqui o que veio: o resumo da nota (resNFe), o XML completo (procNFe) e os eventos
-- (cancelamento). Para o fornecedor liberar o XML completo, a plataforma manifesta "Ciência da Operação" sozinha
-- (parâmetro). Na tela "NF-e da SEFAZ", o XML disponível entra em Notas Fiscais pelo mesmo importador dos arquivos, e a
-- equipe faz a manifestação conclusiva (confirmação, desconhecimento ou operação não realizada).
-- Regras da SEFAZ respeitadas: sem documento novo (cStat 137) ou já no último NSU, a próxima consulta só depois de 1 hora.

create table if not exists public.dfe_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ativo boolean not null default false,
  ambiente text not null default 'producao' check (ambiente in ('producao', 'homologacao')),
  ciencia_automatica boolean not null default true,
  avisar boolean not null default true,
  papeis text[] not null default array['admin', 'financeiro', 'compras'],
  ultimo_nsu bigint not null default 0,
  max_nsu bigint,
  proxima_consulta timestamptz not null default now(),
  ultima_consulta timestamptz, ultimo_cstat text, ultimo_motivo text, ultimo_erro text,
  validade_certificado timestamptz
);
create table if not exists public.dfe_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  chave text not null check (chave ~ '^\d{44}$'),
  nsu bigint,
  emitente_doc text, emitente_nome text, emissao date, valor numeric(16,2),
  situacao_nfe text not null default 'autorizada' check (situacao_nfe in ('autorizada', 'denegada', 'cancelada')),
  xml text,
  situacao text not null default 'resumo' check (situacao in ('resumo', 'xml_disponivel', 'importada', 'ignorada')),
  manifestacao text check (manifestacao in ('ciencia', 'confirmacao', 'desconhecimento', 'nao_realizada')),
  manifestado_em timestamptz, manifestacao_erro text, justificativa text,
  nota_id uuid references public.nfe_notas(id) on delete set null,
  recebido_em timestamptz not null default now(),
  unique (empresa_id, chave)
);
create index if not exists dfe_doc_sit on public.dfe_documentos(empresa_id, situacao, emissao desc);
alter table public.dfe_config enable row level security;
alter table public.dfe_documentos enable row level security;
create or replace function public.dfe_pode(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.papel_em(p_empresa) in ('admin', 'diretor', 'financeiro', 'compras')
$$;
revoke all on function public.dfe_pode(uuid) from public, anon;
grant execute on function public.dfe_pode(uuid) to authenticated;
drop policy if exists dfe_config_sel on public.dfe_config;
create policy dfe_config_sel on public.dfe_config for select to authenticated using (public.dfe_pode(empresa_id));
drop policy if exists dfe_config_ins on public.dfe_config;
create policy dfe_config_ins on public.dfe_config for insert to authenticated with check (public.is_admin(empresa_id));
drop policy if exists dfe_config_upd on public.dfe_config;
create policy dfe_config_upd on public.dfe_config for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
drop policy if exists dfe_documentos_sel on public.dfe_documentos;
create policy dfe_documentos_sel on public.dfe_documentos for select to authenticated using (public.dfe_pode(empresa_id));
grant select, insert, update on public.dfe_config to authenticated;
grant select on public.dfe_documentos to authenticated;
drop trigger if exists zz_auditoria on public.dfe_config;
create trigger zz_auditoria after insert or update or delete on public.dfe_config for each row execute function public._auditar();

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('dfe_novas', 'Fiscal', 'NF-e de entrada recebidas da SEFAZ', 'Notas emitidas contra o CNPJ da empresa chegaram pela Distribuição DF-e.', false, 41)
on conflict (codigo) do nothing;

-- código IBGE da UF (cUFAutor)
create or replace function public._uf_codigo(p_uf text) returns int language sql immutable as $$
  select (array[11,12,13,14,15,16,17,21,22,23,24,25,26,27,28,29,31,32,33,35,41,42,43,50,51,52,53])[array_position(
    array['RO','AC','AM','RR','PA','AP','TO','MA','PI','CE','RN','PB','PE','AL','SE','BA','MG','ES','RJ','SP','PR','SC','RS','MS','MT','GO','DF'], upper(p_uf))]
$$;

-- o que a função de borda precisa para consultar (só service role)
create or replace function public.dfe_para_consultar(p_empresa uuid default null)
returns table(empresa_id uuid, cnpj text, cuf int, ambiente text, ultimo_nsu bigint, ciencia_automatica boolean)
language sql stable security definer set search_path = public as $$
  select c.empresa_id, regexp_replace(e.cnpj, '\D', '', 'g'), _uf_codigo(e.uf), c.ambiente, c.ultimo_nsu, c.ciencia_automatica
    from dfe_config c join empresas e on e.id = c.empresa_id
   where c.ativo and length(regexp_replace(coalesce(e.cnpj, ''), '\D', '', 'g')) = 14 and _uf_codigo(e.uf) is not null
     and (p_empresa is null or c.empresa_id = p_empresa) and (p_empresa is not null or c.proxima_consulta <= now())
$$;
revoke all on function public.dfe_para_consultar(uuid) from public, anon, authenticated;

-- grava a resposta de uma consulta; devolve se vale consultar de novo agora (ainda há NSU para buscar)
create or replace function public.dfe_registrar(p_empresa uuid, p_resp jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d jsonb; x xml; ns text[] := array[array['n', 'http://www.portalfiscal.inf.br/nfe']]; v_ch text; v_tp text; n_novas int := 0; n_xml int := 0; n_canc int := 0;
  v_ult bigint := nullif(p_resp ->> 'ultNSU', '')::bigint; v_max bigint := nullif(p_resp ->> 'maxNSU', '')::bigint; v_cstat text := p_resp ->> 'cStat'; v_mais boolean;
  v_cfg dfe_config;
begin
  select * into v_cfg from dfe_config where empresa_id = p_empresa;
  for d in select * from jsonb_array_elements(coalesce(p_resp -> 'docs', '[]')) loop
    continue when d ->> 'xml' is null;
    begin x := (d ->> 'xml')::xml; exception when others then continue; end;
    if d ->> 'schema' = 'resNFe' then
      v_ch := (xpath('//n:chNFe/text()', x, ns))[1]::text;
      insert into dfe_documentos(empresa_id, chave, nsu, emitente_doc, emitente_nome, emissao, valor, situacao_nfe)
      values (p_empresa, v_ch, (d ->> 'nsu')::bigint, coalesce((xpath('//n:CNPJ/text()', x, ns))[1]::text, (xpath('//n:CPF/text()', x, ns))[1]::text),
              (xpath('//n:xNome/text()', x, ns))[1]::text, left((xpath('//n:dhEmi/text()', x, ns))[1]::text, 10)::date, (xpath('//n:vNF/text()', x, ns))[1]::text::numeric,
              case (xpath('//n:cSitNFe/text()', x, ns))[1]::text when '2' then 'denegada' when '3' then 'cancelada' else 'autorizada' end)
      on conflict (empresa_id, chave) do nothing;
      if found then n_novas := n_novas + 1; end if;
    elsif d ->> 'schema' = 'procNFe' then
      v_ch := substr((xpath('//n:infNFe/@Id', x, ns))[1]::text, 4);
      insert into dfe_documentos(empresa_id, chave, nsu, emitente_doc, emitente_nome, emissao, valor, xml, situacao)
      values (p_empresa, v_ch, (d ->> 'nsu')::bigint, coalesce((xpath('//n:emit/n:CNPJ/text()', x, ns))[1]::text, (xpath('//n:emit/n:CPF/text()', x, ns))[1]::text),
              (xpath('//n:emit/n:xNome/text()', x, ns))[1]::text, left((xpath('//n:ide/n:dhEmi/text()', x, ns))[1]::text, 10)::date,
              (xpath('//n:total/n:ICMSTot/n:vNF/text()', x, ns))[1]::text::numeric, d ->> 'xml', 'xml_disponivel')
      on conflict (empresa_id, chave) do update set xml = excluded.xml, nsu = excluded.nsu,
        situacao = case when dfe_documentos.situacao in ('importada', 'ignorada') then dfe_documentos.situacao else 'xml_disponivel' end;
      if not exists (select 1 from dfe_documentos where empresa_id = p_empresa and chave = v_ch and nota_id is not null) then n_xml := n_xml + 1; end if;
    elsif d ->> 'schema' in ('resEvento', 'procEventoNFe') then
      v_ch := (xpath('//n:chNFe/text()', x, ns))[1]::text; v_tp := (xpath('//n:tpEvento/text()', x, ns))[1]::text;
      if v_tp = '110111' then   -- cancelamento pelo emitente
        update dfe_documentos set situacao_nfe = 'cancelada' where empresa_id = p_empresa and chave = v_ch;
        update nfe_notas set situacao = 'cancelada' where empresa_id = p_empresa and chave = v_ch and situacao <> 'cancelada';
        n_canc := n_canc + 1;
      end if;
    end if;
  end loop;
  -- nota que já estava em Notas Fiscais (importada pelo arquivo) marca o documento como importado
  update dfe_documentos d set situacao = 'importada', nota_id = n.id from nfe_notas n
   where d.empresa_id = p_empresa and n.empresa_id = p_empresa and n.chave = d.chave and d.situacao <> 'importada';
  -- 137 = nenhum documento; ultNSU = maxNSU = em dia → próxima consulta em 1 hora (regra da SEFAZ)
  v_mais := v_cstat = '138' and v_ult is not null and v_max is not null and v_ult < v_max;
  update dfe_config set ultimo_nsu = greatest(ultimo_nsu, coalesce(v_ult, ultimo_nsu)), max_nsu = coalesce(v_max, max_nsu), ultima_consulta = now(),
         ultimo_cstat = v_cstat, ultimo_motivo = p_resp ->> 'xMotivo', ultimo_erro = case when v_cstat in ('137', '138') then null else coalesce(p_resp ->> 'erro', p_resp ->> 'xMotivo') end,
         validade_certificado = coalesce(nullif(p_resp ->> 'validade_certificado', '')::timestamptz, validade_certificado),
         proxima_consulta = case when v_mais then now() else now() + interval '1 hour' end
   where empresa_id = p_empresa;
  if (n_novas + n_xml) > 0 and coalesce(v_cfg.avisar, true) then
    perform _notificar_u(p_empresa, _usuarios_papel(p_empresa, coalesce(v_cfg.papeis, array['admin', 'financeiro', 'compras'])), 'dfe_novas',
      'NF-e da SEFAZ: ' || (n_novas + n_xml) || ' nota(s) de entrada', format('%s resumo(s) novo(s) e %s XML disponível(is) para importar.', n_novas, n_xml), '#/notas/sefaz', null, false);
  end if;
  return jsonb_build_object('novas', n_novas, 'xml', n_xml, 'cancelamentos', n_canc, 'mais', v_mais);
end $$;
revoke all on function public.dfe_registrar(uuid, jsonb) from public, anon, authenticated;

-- resumos à espera da ciência (para a SEFAZ liberar o XML)
create or replace function public.dfe_para_ciencia(p_empresa uuid, p_limite int default 20)
returns table(id uuid, chave text) language sql stable security definer set search_path = public as $$
  select d.id, d.chave from dfe_documentos d join dfe_config c on c.empresa_id = d.empresa_id
   where d.empresa_id = p_empresa and c.ciencia_automatica and d.situacao = 'resumo' and d.manifestacao is null and d.manifestacao_erro is null
     and d.situacao_nfe = 'autorizada' order by d.emissao limit p_limite
$$;
revoke all on function public.dfe_para_ciencia(uuid, int) from public, anon, authenticated;

-- resultado de uma manifestação (135 registrado; 573 duplicidade = já estava)
create or replace function public.dfe_manifestado(p_doc uuid, p_tipo text, p_cstat text, p_motivo text, p_just text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_cstat in ('135', '136', '573') then
    update dfe_documentos set manifestacao = p_tipo, manifestado_em = now(), manifestacao_erro = null, justificativa = coalesce(p_just, justificativa) where id = p_doc;
  else
    update dfe_documentos set manifestacao_erro = left(coalesce(p_cstat || ': ', '') || coalesce(p_motivo, 'falha'), 300) where id = p_doc;
  end if;
end $$;
revoke all on function public.dfe_manifestado(uuid, text, text, text, text) from public, anon, authenticated;

-- a nota importada em Notas Fiscais marca o documento da SEFAZ
create or replace function public._dfe_nota_importada() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update dfe_documentos set situacao = 'importada', nota_id = new.id where empresa_id = new.empresa_id and chave = new.chave and situacao <> 'importada';
  return null;
end $$;
drop trigger if exists nfe_notas_dfe on public.nfe_notas;
create trigger nfe_notas_dfe after insert on public.nfe_notas for each row execute function public._dfe_nota_importada();

-- ignorar (ex.: nota que não interessa) e voltar
create or replace function public.dfe_ignorar(p_doc uuid, p_ignorar boolean) returns void language plpgsql security definer set search_path = public as $$
declare v_emp uuid;
begin
  select empresa_id into v_emp from dfe_documentos where id = p_doc;
  if v_emp is null or not dfe_pode(v_emp) then raise exception 'Documento não encontrado.'; end if;
  update dfe_documentos set situacao = case when p_ignorar then 'ignorada' when xml is not null then 'xml_disponivel' else 'resumo' end where id = p_doc and situacao <> 'importada';
end $$;
revoke all on function public.dfe_ignorar(uuid, boolean) from public, anon;
grant execute on function public.dfe_ignorar(uuid, boolean) to authenticated;

-- notas de entrada que estão em Notas Fiscais mas não vieram pela SEFAZ não importam aqui; o painel da tela:
create or replace function public.dfe_resumo(p_empresa uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select case when not dfe_pode(p_empresa) then null else jsonb_build_object(
    'resumo', count(*) filter (where situacao = 'resumo'), 'xml', count(*) filter (where situacao = 'xml_disponivel'),
    'importadas', count(*) filter (where situacao = 'importada'), 'ignoradas', count(*) filter (where situacao = 'ignorada'),
    'sem_conclusiva', count(*) filter (where situacao_nfe = 'autorizada' and coalesce(manifestacao, 'ciencia') = 'ciencia' and emissao < current_date - 150),
    'valor_pendente', coalesce(sum(valor) filter (where situacao in ('resumo', 'xml_disponivel') and situacao_nfe = 'autorizada'), 0)) end
    from dfe_documentos where empresa_id = p_empresa
$$;
revoke all on function public.dfe_resumo(uuid) from public, anon;
grant execute on function public.dfe_resumo(uuid) to authenticated;

-- agendamento: a cada hora chama a função de borda (ela só consulta as empresas com a próxima consulta vencida)
do $$
begin
  begin create extension if not exists pg_cron; create extension if not exists pg_net; exception when others then raise notice 'pg_cron/pg_net indisponíveis (%).', sqlerrm; return; end;
  perform cron.unschedule(jobid) from cron.job where jobname = 'sefaz-dfe';
  perform cron.schedule('sefaz-dfe', '7 * * * *', $job$
    select net.http_post(
      url := 'https://ceyzvhcpgokysgmpdalt.supabase.co/functions/v1/sefaz-dfe',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-chave', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'notificar_cron'), '')),
      body := '{"acao":"consultar"}'::jsonb)
    where exists (select 1 from public.dfe_config where ativo and proxima_consulta <= now())
      and exists (select 1 from vault.decrypted_secrets where name = 'notificar_cron');
  $job$);
exception when others then raise notice 'agendamento da SEFAZ não criado: %', sqlerrm;
end $$;

select public._uf_codigo('PE') as pe;
