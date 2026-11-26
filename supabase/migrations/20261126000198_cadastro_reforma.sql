-- 198 — Comercial › Atualização Cadastral da Reforma (COM010), 26/11/2026.
-- Renan: "enviar aos clientes um questionário de atualização cadastral para a reforma tributária: eu escolho o cliente, a
-- plataforma gera um link, o cliente preenche e dá ok, e as informações chegam pra gente".
--   • link único por cliente (64 hex), válido por 30 dias (parâmetro); página pública cadastro.html, sem login;
--   • blocos: dados cadastrais e contato; perfil de ICMS; regime e créditos (Simples: opção pelo IBS/CBS regular);
--     situações especiais; declaração de quem respondeu;
--   • a resposta chega com aviso e fica pendente: quem tem o papel de aplicar compara com o cadastro e aplica os campos
--     escolhidos (favorecidos + perfil fiscal do cliente, que a Análise de Competitividade passa a usar).
-- Somente acréscimos. Funções sem login: + cadq_link_abrir e cadq_link_responder (só aceitam o token do link).

-- ------------------------------------------------------------ parâmetros
create table if not exists public.cadq_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  validade_dias int not null default 30 check (validade_dias between 1 and 365),
  mensagem text,                                                  -- texto de abertura do questionário
  papeis_usa text[] not null default '{admin,diretor,financeiro,vendas}',
  papeis_aplicar text[] not null default '{admin,diretor,financeiro}',
  atualizado_por uuid default auth.uid(), atualizado_em timestamptz not null default now()
);

-- ------------------------------------------------------------ perfil fiscal do cliente (reforma e competitividade)
create table if not exists public.cad_perfil_fiscal (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  favorecido_id uuid not null references public.favorecidos(id) on delete cascade,
  tipo text check (tipo in ('industria', 'comercio', 'consumidor_contrib', 'nao_contrib')),        -- como na COM009
  regime text check (regime in ('real', 'presumido', 'simples', 'mei')),
  destinacao text[] not null default '{}',                     -- industrializacao, revenda, uso_consumo, ativo
  cred_icms text check (cred_icms in ('sim', 'nao', 'nao_sei')),
  cred_pc text check (cred_pc in ('sim', 'nao', 'nao_sei')),
  simples_regular text check (simples_regular in ('sim', 'nao', 'avaliando')),   -- Simples/MEI: vai apurar IBS/CBS pelo regime regular
  cnae text,
  especiais jsonb not null default '{}'::jsonb,                -- beneficio_icms, reducao, zfm, orgao_publico, produtor_rural, imunidade, observacao
  contato_fiscal jsonb not null default '{}'::jsonb,           -- nome, email, telefone
  contador jsonb not null default '{}'::jsonb,                 -- escritório: nome, email, telefone
  fonte text not null default 'questionario',
  questionario_id uuid,
  atualizado_por uuid default auth.uid(), atualizado_em timestamptz not null default now(),
  unique (empresa_id, favorecido_id)
);

-- ------------------------------------------------------------ questionários (links)
create table if not exists public.cadq_questionarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  favorecido_id uuid not null references public.favorecidos(id) on delete cascade,
  cliente text not null,
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  expira_em date not null,
  mensagem text,
  situacao text not null default 'enviado' check (situacao in ('enviado', 'aberto', 'respondido', 'aplicado', 'descartado', 'cancelado')),
  aberto_em timestamptz,
  respondido_em timestamptz, respondido_por text,
  resposta jsonb,
  aplicado_em timestamptz, aplicado_por text, aplicado_campos text[],
  obs text,
  criado_por text default (auth.jwt() ->> 'email'), criado_por_id uuid default auth.uid(), criado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists cadq_q_fav on public.cadq_questionarios(empresa_id, favorecido_id);
drop trigger if exists zz_auditoria on public.cadq_questionarios;
create trigger zz_auditoria after insert or update or delete on public.cadq_questionarios for each row execute function public._auditar();
drop trigger if exists zz_auditoria on public.cad_perfil_fiscal;
create trigger zz_auditoria after insert or update or delete on public.cad_perfil_fiscal for each row execute function public._auditar();

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('cadastro_reforma', 'Comercial', 'Cliente respondeu a atualização cadastral', 'O cliente preencheu o questionário de atualização cadastral da reforma pelo link.', false, 56)
on conflict (codigo) do nothing;

-- ------------------------------------------------------------ acesso
create or replace function public._cadq_cfg(p_empresa uuid) returns public.cadq_config
language sql stable security definer set search_path = public as $$
  select coalesce((select c from cadq_config c where c.empresa_id = p_empresa),
    row(p_empresa, 30, null, '{admin,diretor,financeiro,vendas}'::text[], '{admin,diretor,financeiro}'::text[], null, now())::cadq_config);
$$;
create or replace function public._cadq_usa(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.papel_em(p_empresa) = any((public._cadq_cfg(p_empresa)).papeis_usa), false) and public._mfa_ok(p_empresa);
$$;
create or replace function public._cadq_aplica(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.papel_em(p_empresa) = any((public._cadq_cfg(p_empresa)).papeis_aplicar), false) and public._mfa_ok(p_empresa);
$$;
-- o vendedor só vê os clientes da carteira dele
create or replace function public._cadq_ve(p_empresa uuid, p_fav uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public._cadq_usa(p_empresa) and (public.papel_em(p_empresa) <> 'vendas' or public.comercial_ve_cliente(p_empresa, p_fav));
$$;
create or replace function public.cadq_acesso(p_empresa uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('usa', public._cadq_usa(p_empresa), 'aplica', public._cadq_aplica(p_empresa), 'admin', coalesce(public.papel_em(p_empresa) = 'admin', false),
    'validade_dias', (public._cadq_cfg(p_empresa)).validade_dias, 'mensagem', (public._cadq_cfg(p_empresa)).mensagem);
$$;

alter table public.cadq_config enable row level security;
alter table public.cad_perfil_fiscal enable row level security;
alter table public.cadq_questionarios enable row level security;
drop policy if exists cadq_config_sel on public.cadq_config;
create policy cadq_config_sel on public.cadq_config for select to authenticated using (public._cadq_usa(empresa_id) or public.is_admin(empresa_id));
drop policy if exists cad_perfil_fiscal_sel on public.cad_perfil_fiscal;
create policy cad_perfil_fiscal_sel on public.cad_perfil_fiscal for select to authenticated
  using (public.is_membro(empresa_id) or public._comp_usa(empresa_id) or public._cadq_ve(empresa_id, favorecido_id));
drop policy if exists cadq_questionarios_sel on public.cadq_questionarios;
create policy cadq_questionarios_sel on public.cadq_questionarios for select to authenticated using (public._cadq_ve(empresa_id, favorecido_id));
-- escrita só pelas funções abaixo
revoke all on public.cadq_config, public.cad_perfil_fiscal, public.cadq_questionarios from anon;

-- ------------------------------------------------------------ gerar os links
-- devolve [{id, favorecido_id, cliente, token, expira_em, novo}]; reaproveita o link ainda válido do mesmo cliente
create or replace function public.cadq_gerar(p_empresa uuid, p_favorecidos uuid[], p_mensagem text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f uuid; v favorecidos; q cadq_questionarios; n int; r jsonb := '[]'::jsonb; cfg cadq_config := public._cadq_cfg(p_empresa);
begin
  if not public._cadq_usa(p_empresa) then raise exception 'Sem acesso à atualização cadastral.'; end if;
  if coalesce(array_length(p_favorecidos, 1), 0) = 0 then raise exception 'Escolha pelo menos um cliente.'; end if;
  if array_length(p_favorecidos, 1) > 500 then raise exception 'No máximo 500 clientes por vez.'; end if;
  perform pg_advisory_xact_lock(hashtext('cadq:' || p_empresa::text));
  foreach f in array p_favorecidos loop
    select * into v from favorecidos where id = f and empresa_id = p_empresa;
    if v.id is null then raise exception 'Cliente de outra empresa.'; end if;
    if not public._cadq_ve(p_empresa, f) then raise exception 'O cliente % está fora da sua carteira.', v.nome; end if;
    select * into q from cadq_questionarios where empresa_id = p_empresa and favorecido_id = f and situacao in ('enviado', 'aberto') and expira_em >= current_date
      order by criado_em desc limit 1;
    if q.id is not null then
      r := r || jsonb_build_array(jsonb_build_object('id', q.id, 'numero', q.numero, 'favorecido_id', f, 'cliente', q.cliente, 'token', q.token, 'expira_em', q.expira_em, 'novo', false,
        'email', v.email, 'telefone', v.telefone));
      continue;
    end if;
    select coalesce(max(numero), 0) + 1 into n from cadq_questionarios where empresa_id = p_empresa;
    insert into cadq_questionarios(empresa_id, numero, favorecido_id, cliente, expira_em, mensagem)
    values (p_empresa, n, f, coalesce(nullif(trim(v.nome_fantasia), ''), v.nome), current_date + cfg.validade_dias, nullif(trim(coalesce(p_mensagem, cfg.mensagem)), ''))
    returning * into q;
    r := r || jsonb_build_array(jsonb_build_object('id', q.id, 'numero', q.numero, 'favorecido_id', f, 'cliente', q.cliente, 'token', q.token, 'expira_em', q.expira_em, 'novo', true,
      'email', v.email, 'telefone', v.telefone));
  end loop;
  return r;
end $$;

-- ------------------------------------------------------------ página pública (sem login)
create or replace function public._cadq_por_token(p_token text) returns cadq_questionarios
language sql stable security definer set search_path = public as $$
  select * from cadq_questionarios where token = p_token and p_token ~ '^[0-9a-f]{64}$';
$$;

create or replace function public.cadq_link_abrir(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q cadq_questionarios := public._cadq_por_token(p_token); v favorecidos; pf cad_perfil_fiscal;
begin
  if q.id is null then raise exception 'Link inválido. Confira se o link foi copiado inteiro ou peça um novo.'; end if;
  select * into v from favorecidos where id = q.favorecido_id;
  select * into pf from cad_perfil_fiscal where empresa_id = q.empresa_id and favorecido_id = q.favorecido_id;
  if q.situacao = 'enviado' then update cadq_questionarios set situacao = 'aberto', aberto_em = now() where id = q.id; q.situacao := 'aberto'; end if;
  return jsonb_build_object(
    'empresa', (select coalesce(razao_social, nome) from empresas where id = q.empresa_id), 'numero', q.numero, 'cliente', q.cliente,
    'situacao', q.situacao, 'expira_em', q.expira_em, 'vencido', q.expira_em < current_date, 'mensagem', q.mensagem, 'respondido_em', q.respondido_em,
    -- o que já temos, para o cliente conferir (a resposta anterior, se houver, tem prioridade)
    'atual', coalesce(q.resposta, jsonb_build_object(
      'razao_social', v.nome, 'nome_fantasia', v.nome_fantasia, 'documento', v.documento, 'ie', v.ie, 'im', v.im,
      'cep', v.cep, 'logradouro', v.logradouro, 'numero', v.numero, 'complemento', v.complemento, 'bairro', v.bairro, 'municipio', v.municipio, 'uf', v.uf,
      'email_nfe', v.email, 'telefone', v.telefone, 'contribuinte_icms', v.contribuinte_icms,
      'regime', case v.regime_tributario when 'Simples Nacional' then 'simples' when 'MEI' then 'mei' when 'Lucro Presumido' then 'presumido' when 'Lucro Real' then 'real' end,
      'cnae', coalesce(pf.cnae, v.receita_dados ->> 'cnae'), 'destinacao', to_jsonb(coalesce(pf.destinacao, '{}')), 'cred_icms', pf.cred_icms, 'cred_pc', pf.cred_pc,
      'simples_regular', pf.simples_regular, 'especiais', coalesce(pf.especiais, '{}'), 'contato_fiscal', coalesce(pf.contato_fiscal, '{}'), 'contador', coalesce(pf.contador, '{}'))));
end $$;

create or replace function public.cadq_link_responder(p_token text, p_dados jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare q cadq_questionarios := public._cadq_por_token(p_token); d jsonb; v_nome text; x text;
begin
  if q.id is null then raise exception 'Link inválido.'; end if;
  if q.situacao = 'cancelado' then raise exception 'Este questionário foi cancelado. Peça um novo link.'; end if;
  if q.situacao in ('aplicado', 'descartado') then raise exception 'Este questionário já foi recebido e conferido. Para mudar alguma informação, peça um novo link.'; end if;
  if q.expira_em < current_date then raise exception 'O prazo deste link terminou em %. Peça um novo link.', to_char(q.expira_em, 'DD/MM/YYYY'); end if;
  if jsonb_typeof(p_dados) <> 'object' or length(p_dados::text) > 30000 then raise exception 'Respostas inválidas.'; end if;
  d := p_dados;
  if coalesce((d ->> 'aceite')::boolean, false) is not true then raise exception 'Marque a declaração de que as informações são verdadeiras.'; end if;
  v_nome := trim(coalesce(d -> 'declarante' ->> 'nome', ''));
  if length(v_nome) < 3 then raise exception 'Informe o nome de quem está respondendo.'; end if;
  foreach x in array array[d ->> 'email_nfe', d -> 'declarante' ->> 'email', d -> 'contato_fiscal' ->> 'email', d -> 'contador' ->> 'email'] loop
    if coalesce(trim(x), '') <> '' and trim(x) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido: %', x; end if;
  end loop;
  if coalesce(d ->> 'uf', '') <> '' and d ->> 'uf' !~ '^[A-Z]{2}$' then raise exception 'UF inválida.'; end if;
  if coalesce(d ->> 'regime', '') not in ('', 'real', 'presumido', 'simples', 'mei') then raise exception 'Regime inválido.'; end if;
  if coalesce(d ->> 'contribuinte_icms', '') not in ('', '1', '2', '9') then raise exception 'Informe se é contribuinte do ICMS.'; end if;
  update cadq_questionarios set situacao = 'respondido', respondido_em = now(), resposta = d,
    respondido_por = left(v_nome || coalesce(' (' || nullif(trim(d -> 'declarante' ->> 'cargo'), '') || ')', '') || coalesce(' <' || nullif(trim(d -> 'declarante' ->> 'email'), '') || '>', ''), 300)
  where id = q.id;
  perform _notificar_u(q.empresa_id, array_remove(_usuarios_papel(q.empresa_id, (public._cadq_cfg(q.empresa_id)).papeis_aplicar) || array[q.criado_por_id], null),
    'cadastro_reforma', q.cliente || ' respondeu a atualização cadastral', 'Questionário nº ' || q.numero || ' · confira e aplique ao cadastro',
    '#/comercial/cadastro-reforma?abrir=' || q.id, q.id, false);
end $$;

-- ------------------------------------------------------------ conferir e aplicar (interno)
-- p_campos: chaves da resposta a aplicar. Cadastro (favorecidos): nome_fantasia, ie, im, cep, logradouro, numero, complemento,
-- bairro, municipio, uf, email_nfe, telefone, contribuinte_icms, regime. Perfil fiscal: tipo, destinacao, cred_icms, cred_pc,
-- simples_regular, cnae, especiais, contato_fiscal, contador.
create or replace function public.cadq_aplicar(p_id uuid, p_campos text[]) returns void
language plpgsql security definer set search_path = public as $$
declare q cadq_questionarios; d jsonb; tem boolean := false; c text; v_por text;
begin
  select * into q from cadq_questionarios where id = p_id for update;
  if q.id is null or not public._cadq_aplica(q.empresa_id) then raise exception 'Sem permissão para aplicar ao cadastro.'; end if;
  if q.situacao not in ('respondido', 'aplicado') then raise exception 'O questionário ainda não foi respondido.'; end if;
  d := q.resposta;
  v_por := coalesce(nullif(trim((select m.nome from membros m where m.empresa_id = q.empresa_id and m.user_id = auth.uid())), ''), auth.jwt() ->> 'email');
  foreach c in array coalesce(p_campos, '{}') loop
    if c not in ('nome_fantasia', 'ie', 'im', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'municipio', 'uf', 'email_nfe', 'telefone', 'contribuinte_icms', 'regime',
                 'tipo', 'destinacao', 'cred_icms', 'cred_pc', 'simples_regular', 'cnae', 'especiais', 'contato_fiscal', 'contador') then raise exception 'Campo inválido: %', c; end if;
  end loop;
  update favorecidos f set
    nome_fantasia = case when 'nome_fantasia' = any(p_campos) then nullif(trim(d ->> 'nome_fantasia'), '') else f.nome_fantasia end,
    ie = case when 'ie' = any(p_campos) then nullif(trim(d ->> 'ie'), '') else f.ie end,
    im = case when 'im' = any(p_campos) then nullif(trim(d ->> 'im'), '') else f.im end,
    cep = case when 'cep' = any(p_campos) then nullif(regexp_replace(coalesce(d ->> 'cep', ''), '\D', '', 'g'), '') else f.cep end,
    logradouro = case when 'logradouro' = any(p_campos) then nullif(trim(d ->> 'logradouro'), '') else f.logradouro end,
    numero = case when 'numero' = any(p_campos) then nullif(trim(d ->> 'numero'), '') else f.numero end,
    complemento = case when 'complemento' = any(p_campos) then nullif(trim(d ->> 'complemento'), '') else f.complemento end,
    bairro = case when 'bairro' = any(p_campos) then nullif(trim(d ->> 'bairro'), '') else f.bairro end,
    municipio = case when 'municipio' = any(p_campos) then nullif(trim(d ->> 'municipio'), '') else f.municipio end,
    uf = case when 'uf' = any(p_campos) then nullif(d ->> 'uf', '') else f.uf end,
    email = case when 'email_nfe' = any(p_campos) then nullif(lower(trim(d ->> 'email_nfe')), '') else f.email end,
    telefone = case when 'telefone' = any(p_campos) then nullif(trim(d ->> 'telefone'), '') else f.telefone end,
    contribuinte_icms = case when 'contribuinte_icms' = any(p_campos) then nullif(d ->> 'contribuinte_icms', '') else f.contribuinte_icms end,
    regime_tributario = case when 'regime' = any(p_campos) then case d ->> 'regime' when 'simples' then 'Simples Nacional' when 'mei' then 'MEI' when 'presumido' then 'Lucro Presumido'
                             when 'real' then 'Lucro Real' else f.regime_tributario end else f.regime_tributario end
  where f.id = q.favorecido_id;
  if p_campos && array['tipo', 'destinacao', 'cred_icms', 'cred_pc', 'simples_regular', 'cnae', 'especiais', 'contato_fiscal', 'contador', 'regime', 'contribuinte_icms'] then
    insert into cad_perfil_fiscal(empresa_id, favorecido_id, fonte, questionario_id) values (q.empresa_id, q.favorecido_id, 'questionario', q.id)
    on conflict (empresa_id, favorecido_id) do nothing;
    update cad_perfil_fiscal p set
      tipo = case when 'tipo' = any(p_campos) then nullif(d ->> 'tipo', '') else p.tipo end,
      regime = case when 'regime' = any(p_campos) then nullif(d ->> 'regime', '') else p.regime end,
      destinacao = case when 'destinacao' = any(p_campos) then array(select jsonb_array_elements_text(coalesce(d -> 'destinacao', '[]'))) else p.destinacao end,
      cred_icms = case when 'cred_icms' = any(p_campos) then nullif(d ->> 'cred_icms', '') else p.cred_icms end,
      cred_pc = case when 'cred_pc' = any(p_campos) then nullif(d ->> 'cred_pc', '') else p.cred_pc end,
      simples_regular = case when 'simples_regular' = any(p_campos) then nullif(d ->> 'simples_regular', '') else p.simples_regular end,
      cnae = case when 'cnae' = any(p_campos) then nullif(trim(d ->> 'cnae'), '') else p.cnae end,
      especiais = case when 'especiais' = any(p_campos) then coalesce(d -> 'especiais', '{}') else p.especiais end,
      contato_fiscal = case when 'contato_fiscal' = any(p_campos) then coalesce(d -> 'contato_fiscal', '{}') else p.contato_fiscal end,
      contador = case when 'contador' = any(p_campos) then coalesce(d -> 'contador', '{}') else p.contador end,
      fonte = 'questionario', questionario_id = q.id, atualizado_por = auth.uid(), atualizado_em = now()
    where p.empresa_id = q.empresa_id and p.favorecido_id = q.favorecido_id;
  end if;
  update cadq_questionarios set situacao = 'aplicado', aplicado_em = now(), aplicado_por = v_por, aplicado_campos = p_campos where id = q.id;
end $$;

create or replace function public.cadq_situacao(p_id uuid, p_acao text, p_obs text default null) returns void
language plpgsql security definer set search_path = public as $$
declare q cadq_questionarios;
begin
  select * into q from cadq_questionarios where id = p_id for update;
  if q.id is null or not public._cadq_ve(q.empresa_id, q.favorecido_id) then raise exception 'Questionário não encontrado.'; end if;
  if p_acao = 'cancelar' then
    if q.situacao not in ('enviado', 'aberto') then raise exception 'Só dá para cancelar o link que ainda não foi respondido.'; end if;
    update cadq_questionarios set situacao = 'cancelado', obs = nullif(trim(p_obs), '') where id = p_id;
  elsif p_acao = 'descartar' then
    if not public._cadq_aplica(q.empresa_id) then raise exception 'Sem permissão.'; end if;
    if q.situacao <> 'respondido' then raise exception 'Só dá para descartar uma resposta ainda não aplicada.'; end if;
    if coalesce(trim(p_obs), '') = '' then raise exception 'Informe o motivo do descarte.'; end if;
    update cadq_questionarios set situacao = 'descartado', obs = trim(p_obs) where id = p_id;
  elsif p_acao = 'prorrogar' then
    if q.situacao not in ('enviado', 'aberto') then raise exception 'Só dá para prorrogar o link que ainda não foi respondido.'; end if;
    update cadq_questionarios set expira_em = greatest(expira_em, current_date) + (public._cadq_cfg(q.empresa_id)).validade_dias where id = p_id;
  else raise exception 'Ação inválida.'; end if;
end $$;

create or replace function public.cadq_config_salvar(p_empresa uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.papel_em(p_empresa) = 'admin', false) then raise exception 'Só o administrador altera os parâmetros.'; end if;
  insert into cadq_config(empresa_id) values (p_empresa) on conflict do nothing;
  update cadq_config set validade_dias = coalesce((p ->> 'validade_dias')::int, validade_dias), mensagem = nullif(trim(p ->> 'mensagem'), ''),
    papeis_usa = case when p ? 'papeis_usa' then array(select jsonb_array_elements_text(p -> 'papeis_usa')) else papeis_usa end,
    papeis_aplicar = case when p ? 'papeis_aplicar' then array(select jsonb_array_elements_text(p -> 'papeis_aplicar')) else papeis_aplicar end,
    atualizado_por = auth.uid(), atualizado_em = now()
  where empresa_id = p_empresa;
  if not exists (select 1 from cadq_config where empresa_id = p_empresa and 'admin' = any(papeis_usa) and 'admin' = any(papeis_aplicar)) then
    raise exception 'O administrador precisa continuar usando e aplicando.'; end if;
end $$;

-- ------------------------------------------------------------ permissões
revoke all on function public._cadq_cfg(uuid), public._cadq_por_token(text) from public, anon, authenticated;
revoke all on function public._cadq_usa(uuid), public._cadq_aplica(uuid), public._cadq_ve(uuid, uuid) from public, anon;
grant execute on function public._cadq_usa(uuid), public._cadq_aplica(uuid), public._cadq_ve(uuid, uuid) to authenticated;
do $$ declare f text; begin
  foreach f in array array['public.cadq_acesso(uuid)', 'public.cadq_gerar(uuid, uuid[], text)', 'public.cadq_aplicar(uuid, text[])', 'public.cadq_situacao(uuid, text, text)',
    'public.cadq_config_salvar(uuid, jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function public.cadq_link_abrir(text), public.cadq_link_responder(text, jsonb) from public;
grant execute on function public.cadq_link_abrir(text), public.cadq_link_responder(text, jsonb) to anon, authenticated;

select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('cadq_config', 'cad_perfil_fiscal', 'cadq_questionarios')) as tabelas;
