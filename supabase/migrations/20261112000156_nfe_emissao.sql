-- Emissão de NF-e pela API da Focus NFe (CPD › Emissão de NF-e, FIS005). Pedido do Renan em 12/11/2026.
-- Parâmetros da emissão por empresa (ambiente, dados do emitente que faltam no cadastro, regime, quem emite),
-- naturezas de operação (CFOP, CST e alíquotas padrão) e as notas emitidas (rascunho → SEFAZ → autorizada/cancelada).
-- O token da Focus NÃO fica no banco: é segredo da função focus-nfe. O retorno da SEFAZ só é gravado pela função
-- (service_role), nunca pela tela. Aditivo: só cria objetos novos.

create table if not exists public.nfe_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ambiente text not null default 'homologacao' check (ambiente in ('homologacao', 'producao')),
  papeis text[] not null default '{financeiro}',          -- além do administrador, quem pode emitir e cancelar
  crt int not null default 3 check (crt in (1, 2, 3, 4)), -- 1 Simples, 2 Simples com excesso, 3 regime normal, 4 MEI
  nome_fantasia text, numero text, complemento text, bairro text, telefone text,
  serie text not null default '1',
  natureza_padrao_id uuid,
  modalidade_frete int not null default 0,
  forma_pagamento text not null default '15',
  prazos_padrao int[] not null default '{}',              -- dias das duplicatas sugeridas (ex.: {28,35,42})
  info_padrao text,                                       -- texto fixo das informações complementares
  pis_cofins_exclui_icms boolean not null default true,
  ibs_cbs_exclui_tributos boolean not null default true,
  danfe_logo boolean not null default true,
  email_copia text,
  enviar_email_destinatario boolean not null default false,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);

create table if not exists public.nfe_naturezas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,                                     -- como aparece na lista (ex.: Venda de produção)
  natureza_operacao text not null,                        -- como sai na nota
  tipo_documento int not null default 1 check (tipo_documento in (0, 1)),
  finalidade int not null default 1 check (finalidade in (1, 2, 3, 4)),
  cfop_interno text, cfop_interestadual text,
  icms_cst text not null default '00', icms_aliquota_interna numeric(7,4) not null default 0, icms_aliquota_inter numeric(7,4), icms_reducao numeric(7,4) not null default 0,
  ipi_cst text not null default '53', ipi_aliquota numeric(7,4) not null default 0, ipi_enquadramento text not null default '999',
  pis_cst text not null default '01', pis_aliquota numeric(7,4) not null default 0,
  cofins_cst text not null default '01', cofins_aliquota numeric(7,4) not null default 0,
  ibs_cbs_cst text, ibs_cbs_classificacao text,
  cbs_aliquota numeric(7,4) not null default 0, ibs_uf_aliquota numeric(7,4) not null default 0, ibs_mun_aliquota numeric(7,4) not null default 0,
  info_complementar text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (empresa_id, nome)
);

create table if not exists public.nfe_emissoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ambiente text not null default 'homologacao' check (ambiente in ('homologacao', 'producao')),
  status text not null default 'rascunho' check (status in ('rascunho', 'enviando', 'processando', 'autorizada', 'erro', 'cancelada', 'denegada')),
  natureza_id uuid references public.nfe_naturezas(id) on delete set null,
  natureza_operacao text,
  tipo_documento int not null default 1 check (tipo_documento in (0, 1)),
  finalidade int not null default 1 check (finalidade in (1, 2, 3, 4)),
  consumidor_final boolean not null default false,
  presenca int not null default 9,
  data_emissao timestamptz not null default now(),
  data_saida timestamptz,
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  destinatario jsonb not null default '{}',
  itens jsonb not null default '[]',
  transporte jsonb not null default '{}',
  valor_frete numeric(14,2) not null default 0, valor_seguro numeric(14,2) not null default 0, valor_outras numeric(14,2) not null default 0,
  duplicatas jsonb not null default '[]',
  forma_pagamento text,
  referenciadas text[] not null default '{}',
  info_complementar text, info_fisco text,
  totais jsonb not null default '{}',
  valor_total numeric(14,2) not null default 0,
  -- retorno da SEFAZ (gravado só pela função focus-nfe)
  numero text, serie text, chave text, protocolo text, status_sefaz text, mensagem_sefaz text, erros jsonb not null default '[]',
  xml text, caminho_xml text, caminho_danfe text,
  enviada_em timestamptz, autorizada_em timestamptz, cancelada_em timestamptz, cancel_justificativa text, xml_cancelamento text,
  cartas jsonb not null default '[]',                    -- cartas de correção: [{seq, texto, em, por}]
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);
create index if not exists nfe_emissoes_emp on public.nfe_emissoes(empresa_id, criado_em desc);
create unique index if not exists nfe_emissoes_chave on public.nfe_emissoes(chave) where chave is not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'nfe_config_natureza_fk') then
    alter table public.nfe_config add constraint nfe_config_natureza_fk foreign key (natureza_padrao_id) references public.nfe_naturezas(id) on delete set null;
  end if;
end $$;

-- quem emite: administrador ou os papéis escolhidos nos parâmetros (padrão: financeiro), com as mesmas exigências do financeiro (MFA)
create or replace function public.nfe_pode(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin(p_empresa) or exists (
    select 1 from public.membros m where m.empresa_id = p_empresa and m.user_id = auth.uid()
       and m.papel::text = any(coalesce((select c.papeis from public.nfe_config c where c.empresa_id = p_empresa), '{financeiro}'))
       and (m.papel::text <> 'financeiro' or public.pode_editar(p_empresa)));
$$;

alter table public.nfe_config enable row level security;
alter table public.nfe_naturezas enable row level security;
alter table public.nfe_emissoes enable row level security;
do $$
declare t text;
begin
  foreach t in array array['nfe_config', 'nfe_naturezas', 'nfe_emissoes'] loop
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;

create policy nfe_config_sel on public.nfe_config for select to authenticated using (public.is_membro(empresa_id));
create policy nfe_config_ins on public.nfe_config for insert to authenticated with check (public.is_admin(empresa_id));
create policy nfe_config_upd on public.nfe_config for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));

create policy nfe_naturezas_sel on public.nfe_naturezas for select to authenticated using (public.is_membro(empresa_id));
create policy nfe_naturezas_ins on public.nfe_naturezas for insert to authenticated with check (public.nfe_pode(empresa_id));
create policy nfe_naturezas_upd on public.nfe_naturezas for update to authenticated using (public.nfe_pode(empresa_id)) with check (public.nfe_pode(empresa_id));
create policy nfe_naturezas_del on public.nfe_naturezas for delete to authenticated using (public.nfe_pode(empresa_id));

-- a tela só grava rascunho e nota rejeitada (para corrigir); o que foi para a SEFAZ muda só pela função
create policy nfe_emissoes_sel on public.nfe_emissoes for select to authenticated using (public.is_membro(empresa_id));
create policy nfe_emissoes_ins on public.nfe_emissoes for insert to authenticated with check (public.nfe_pode(empresa_id) and status = 'rascunho');
create policy nfe_emissoes_upd on public.nfe_emissoes for update to authenticated
  using (public.nfe_pode(empresa_id) and status in ('rascunho', 'erro')) with check (public.nfe_pode(empresa_id) and status in ('rascunho', 'erro'));
create policy nfe_emissoes_del on public.nfe_emissoes for delete to authenticated using (public.nfe_pode(empresa_id) and status = 'rascunho');

-- a tela não escreve os campos de retorno da SEFAZ nem troca empresa/ambiente de uma nota já enviada
create or replace function public.tg_nfe_emissao() returns trigger language plpgsql security definer set search_path = public as $$
declare v_tela boolean := coalesce(current_setting('app.nfe_servico', true), '') <> '1';   -- só nfe_registrar (service_role) liga esta marca
begin
  new.atualizado_em := now();
  if tg_op = 'INSERT' then
    if v_tela then
      new.ambiente := coalesce((select ambiente from public.nfe_config where empresa_id = new.empresa_id), 'homologacao');
      new.numero := null; new.chave := null; new.protocolo := null; new.xml := null; new.status_sefaz := null; new.mensagem_sefaz := null;
      new.erros := '[]'; new.autorizada_em := null; new.cancelada_em := null; new.enviada_em := null; new.cartas := '[]';
    end if;
    return new;
  end if;
  if v_tela then
    if new.empresa_id <> old.empresa_id then raise exception 'A nota não muda de empresa'; end if;
    new.numero := old.numero; new.serie := old.serie; new.chave := old.chave; new.protocolo := old.protocolo; new.xml := old.xml; new.caminho_xml := old.caminho_xml; new.caminho_danfe := old.caminho_danfe;
    new.status_sefaz := old.status_sefaz; new.mensagem_sefaz := old.mensagem_sefaz; new.erros := old.erros; new.enviada_em := old.enviada_em; new.autorizada_em := old.autorizada_em;
    new.cancelada_em := old.cancelada_em; new.cancel_justificativa := old.cancel_justificativa; new.xml_cancelamento := old.xml_cancelamento; new.cartas := old.cartas;
    -- nota rejeitada que volta a ser editada continua no ambiente em que a empresa está
    new.ambiente := coalesce((select ambiente from public.nfe_config where empresa_id = new.empresa_id), old.ambiente);
  end if;
  return new;
end $$;
drop trigger if exists nfe_emissao_biu on public.nfe_emissoes;
create trigger nfe_emissao_biu before insert or update on public.nfe_emissoes for each row execute function public.tg_nfe_emissao();

-- gravação do retorno da Focus/SEFAZ: só a função focus-nfe (service_role) chama
create or replace function public.nfe_registrar(p_id uuid, p_dados jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.nfe_servico', '1', true);
  update public.nfe_emissoes set
    status = coalesce(p_dados ->> 'status', status),
    numero = coalesce(p_dados ->> 'numero', numero), serie = coalesce(p_dados ->> 'serie', serie), chave = coalesce(p_dados ->> 'chave', chave), protocolo = coalesce(p_dados ->> 'protocolo', protocolo),
    status_sefaz = coalesce(p_dados ->> 'status_sefaz', status_sefaz), mensagem_sefaz = coalesce(p_dados ->> 'mensagem_sefaz', mensagem_sefaz),
    erros = coalesce(p_dados -> 'erros', case when p_dados ->> 'status' in ('autorizada', 'processando', 'enviando') then '[]'::jsonb else erros end),
    xml = coalesce(p_dados ->> 'xml', xml), caminho_xml = coalesce(p_dados ->> 'caminho_xml', caminho_xml), caminho_danfe = coalesce(p_dados ->> 'caminho_danfe', caminho_danfe),
    enviada_em = case when p_dados ->> 'status' = 'enviando' then now() else enviada_em end,
    autorizada_em = case when p_dados ->> 'status' = 'autorizada' and autorizada_em is null then coalesce((p_dados ->> 'autorizada_em')::timestamptz, now()) else autorizada_em end,
    cancelada_em = case when p_dados ->> 'status' = 'cancelada' and cancelada_em is null then now() else cancelada_em end,
    cancel_justificativa = coalesce(p_dados ->> 'cancel_justificativa', cancel_justificativa), xml_cancelamento = coalesce(p_dados ->> 'xml_cancelamento', xml_cancelamento),
    cartas = case when p_dados ? 'carta' then cartas || jsonb_build_array(p_dados -> 'carta') else cartas end
  where id = p_id;
  if not found then perform set_config('app.nfe_servico', '', true); raise exception 'Nota não encontrada'; end if;
  perform set_config('app.nfe_servico', '', true);
end $$;

do $$ begin
  revoke all on function public.nfe_registrar(uuid, jsonb) from public, anon, authenticated;
  grant execute on function public.nfe_registrar(uuid, jsonb) to service_role;
  revoke all on function public.nfe_pode(uuid) from public, anon;
  grant execute on function public.nfe_pode(uuid) to authenticated, service_role;
  revoke all on function public.tg_nfe_emissao() from public, anon, authenticated;
end $$;

-- naturezas de partida (só os códigos; as alíquotas ficam zeradas para a contabilidade preencher)
create or replace function public.nfe_naturezas_padrao(p_empresa uuid) returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if not public.nfe_pode(p_empresa) then raise exception 'Sem permissão para configurar a emissão'; end if;
  insert into public.nfe_naturezas(empresa_id, nome, natureza_operacao, tipo_documento, finalidade, cfop_interno, cfop_interestadual, icms_cst, ipi_cst, pis_cst, cofins_cst)
  select p_empresa, v.nome, v.nat, v.tipo, v.fin, v.ci, v.ce, v.icms, v.ipi, v.pis, v.cof
    from (values ('Venda de produção', 'VENDA DE PRODUCAO DO ESTABELECIMENTO', 1, 1, '5101', '6101', '00', '50', '01', '01'),
                 ('Venda de mercadoria de terceiros', 'VENDA DE MERCADORIA ADQUIRIDA DE TERCEIROS', 1, 1, '5102', '6102', '00', '53', '01', '01'),
                 ('Remessa para industrialização', 'REMESSA PARA INDUSTRIALIZACAO POR ENCOMENDA', 1, 1, '5901', '6901', '50', '55', '08', '08'),
                 ('Remessa de amostra grátis', 'REMESSA DE AMOSTRA GRATIS', 1, 1, '5911', '6911', '40', '53', '08', '08'),
                 ('Devolução de compra', 'DEVOLUCAO DE COMPRA PARA INDUSTRIALIZACAO', 1, 4, '5201', '6201', '00', '99', '49', '49'),
                 ('Outras saídas', 'OUTRAS SAIDAS', 1, 1, '5949', '6949', '90', '99', '49', '49')) v(nome, nat, tipo, fin, ci, ce, icms, ipi, pis, cof)
   where not exists (select 1 from public.nfe_naturezas n where n.empresa_id = p_empresa and n.nome = v.nome);
  get diagnostics v = row_count;
  return v;
end $$;
do $$ begin
  revoke all on function public.nfe_naturezas_padrao(uuid) from public, anon;
  grant execute on function public.nfe_naturezas_padrao(uuid) to authenticated;
end $$;
