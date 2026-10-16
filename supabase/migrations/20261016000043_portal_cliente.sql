-- =====================================================================
-- Etapa 4b — Portal do Cliente (portal.html). Regras (como no ERP Consultoria, migrações 043–045):
--  * o usuário do portal NUNCA entra em membros: identidade separada (portal_usuarios). Assim nenhuma política
--    da plataforma (is_membro, is_participante, pode_editar…) vale para ele;
--  * o cliente só lê por funções SECURITY DEFINER que devolvem colunas seguras (nada de fundo, borderô, plano,
--    centro de custo, conta ou descrição interna);
--  * prorrogação é SOLICITAÇÃO: o cliente nunca altera o vencimento; só o Financeiro aprova, e só a aprovação
--    muda a data do lançamento;
--  * título negociado com banco/fundo aparece como "pague pelo boleto do banco", sem citar o fundo.
-- Migração ADITIVA: só tabelas e funções novas.
-- =====================================================================

-- ---------- quem é cliente no portal ----------
create table if not exists public.portal_usuarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  favorecido_id uuid not null references public.favorecidos(id) on delete cascade,
  email text not null,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  ultimo_acesso timestamptz,
  unique (user_id, favorecido_id)
);
create index if not exists portal_usuarios_fav on public.portal_usuarios(favorecido_id);

create table if not exists public.portal_convites (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  favorecido_id uuid not null references public.favorecidos(id) on delete cascade,
  email text not null,
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '14 days',
  aceito_em timestamptz,
  aceito_por uuid references auth.users(id),
  cancelado_em timestamptz
);
create index if not exists portal_convites_email on public.portal_convites(lower(email)) where aceito_em is null and cancelado_em is null;

-- ---------- solicitações de prorrogação ----------
create table if not exists public.portal_prorrogacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  favorecido_id uuid not null references public.favorecidos(id) on delete cascade,
  lancamento_id uuid not null references public.lancamentos(id) on delete cascade,
  vencimento_atual date not null,
  nova_data date not null,
  valor numeric(16,2) not null,
  documento text,
  motivo text not null,
  status text not null default 'pendente' check (status in ('pendente', 'aprovada', 'recusada', 'cancelada')),
  resposta text,
  solicitado_por uuid not null default auth.uid(),
  solicitado_em timestamptz not null default now(),
  decidido_por uuid references auth.users(id),
  decidido_em timestamptz,
  check (nova_data > vencimento_atual)
);
create unique index if not exists portal_prorrog_pendente on public.portal_prorrogacoes(lancamento_id) where status = 'pendente';
create index if not exists portal_prorrog_emp on public.portal_prorrogacoes(empresa_id, status);

-- ---------- acesso interno às tabelas do portal ----------
alter table public.portal_usuarios enable row level security;
alter table public.portal_convites enable row level security;
alter table public.portal_prorrogacoes enable row level security;
drop policy if exists portal_usuarios_sel on public.portal_usuarios;
drop policy if exists portal_usuarios_upd on public.portal_usuarios;
create policy portal_usuarios_sel on public.portal_usuarios for select to authenticated using (public.is_membro(empresa_id) or user_id = (select auth.uid()));
create policy portal_usuarios_upd on public.portal_usuarios for update to authenticated using (public.pode_editar(empresa_id) or public.pode_aprovar_compra(empresa_id))
  with check (public.pode_editar(empresa_id) or public.pode_aprovar_compra(empresa_id));
drop policy if exists portal_convites_sel on public.portal_convites;
create policy portal_convites_sel on public.portal_convites for select to authenticated using (public.is_membro(empresa_id));
drop policy if exists portal_prorrog_sel on public.portal_prorrogacoes;
create policy portal_prorrog_sel on public.portal_prorrogacoes for select to authenticated using (public.is_membro(empresa_id));
grant select, update on public.portal_usuarios to authenticated;
grant select on public.portal_convites, public.portal_prorrogacoes to authenticated;

-- ---------- lado interno: convidar, cancelar, decidir ----------
create or replace function public.portal_pode_gerir(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select pode_editar(p_empresa) or pode_aprovar_compra(p_empresa);    -- admin, financeiro, diretor
$$;

create or replace function public.portal_criar_convite(p_empresa uuid, p_favorecido uuid, p_email text)
returns text language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email)); v_token text;
begin
  if not portal_pode_gerir(p_empresa) then raise exception 'Só admin, financeiro ou diretor convida clientes para o portal.'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido: %', p_email; end if;
  if not exists (select 1 from favorecidos where id = p_favorecido and empresa_id = p_empresa and tipo in ('CLIENTES', 'TERCEIROS - CLIENTES')) then
    raise exception 'O portal é só para clientes cadastrados.'; end if;
  if exists (select 1 from membros m join auth.users u on u.id = m.user_id where lower(u.email) = v_email) then
    raise exception 'Este e-mail é de um usuário interno da plataforma. Use outro e-mail para o acesso de cliente.'; end if;
  update portal_convites set cancelado_em = now() where favorecido_id = p_favorecido and lower(email) = v_email and aceito_em is null and cancelado_em is null;
  insert into portal_convites (empresa_id, favorecido_id, email) values (p_empresa, p_favorecido, v_email) returning token into v_token;
  return v_token;
end $$;

create or replace function public.portal_cancelar_convite(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e uuid;
begin
  select empresa_id into e from portal_convites where id = p_id;
  if e is null or not portal_pode_gerir(e) then raise exception 'Sem permissão.'; end if;
  update portal_convites set cancelado_em = now() where id = p_id and aceito_em is null;
end $$;

create or replace function public.portal_decidir_prorrogacao(p_id uuid, p_aprovar boolean, p_resposta text)
returns void language plpgsql security definer set search_path = public as $$
declare s portal_prorrogacoes; l lancamentos;
begin
  select * into s from portal_prorrogacoes where id = p_id for update;
  if s.id is null or not pode_editar(s.empresa_id) then raise exception 'Só admin ou financeiro decide prorrogação.'; end if;
  if s.status <> 'pendente' then raise exception 'Solicitação já decidida.'; end if;
  if not p_aprovar and coalesce(trim(p_resposta), '') = '' then raise exception 'Informe o motivo da recusa (o cliente vê a resposta).'; end if;
  if p_aprovar then
    select * into l from lancamentos where id = s.lancamento_id for update;
    if l.status <> 'Em aberto' then raise exception 'O título não está mais em aberto.'; end if;
    if l.fidc_proposta_id is not null then raise exception 'Título negociado com banco/fundo: a prorrogação é com a instituição.'; end if;
    update lancamentos set data = s.nova_data where id = l.id;      -- passa pelos gatilhos normais (trava, auditoria)
  end if;
  update portal_prorrogacoes set status = case when p_aprovar then 'aprovada' else 'recusada' end, resposta = nullif(trim(p_resposta), ''),
         decidido_por = auth.uid(), decidido_em = now() where id = p_id;
end $$;

-- ---------- lado do cliente ----------
-- convite visível antes do login (só o necessário para a tela de cadastro)
create or replace function public.portal_ver_convite(p_token text)
returns table(empresa text, cliente text, email text)
language sql stable security definer set search_path = public as $$
  select e.nome, f.nome, c.email from portal_convites c join empresas e on e.id = c.empresa_id join favorecidos f on f.id = c.favorecido_id
  where c.token = p_token and c.aceito_em is null and c.cancelado_em is null and c.expira_em > now();
$$;

-- aceita os convites do e-mail confirmado de quem entrou
create or replace function public.portal_aceitar_convites()
returns int language plpgsql security definer set search_path = public as $$
declare v_email text; v_conf timestamptz; r record; n int := 0;
begin
  if auth.uid() is null then return 0; end if;
  select lower(email), email_confirmed_at into v_email, v_conf from auth.users where id = auth.uid();
  if v_email is null or v_conf is null then return 0; end if;
  if exists (select 1 from membros where user_id = auth.uid()) then return 0; end if;     -- usuário interno não vira cliente
  for r in select * from portal_convites where lower(email) = v_email and aceito_em is null and cancelado_em is null and expira_em > now() loop
    insert into portal_usuarios (empresa_id, user_id, favorecido_id, email) values (r.empresa_id, auth.uid(), r.favorecido_id, v_email)
      on conflict (user_id, favorecido_id) do update set ativo = true;
    update portal_convites set aceito_em = now(), aceito_por = auth.uid() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- o cliente do portal pode ver este favorecido?
create or replace function public.portal_meu(p_fav uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from portal_usuarios where user_id = auth.uid() and favorecido_id = p_fav and ativo);
$$;

create or replace function public.portal_meus_clientes()
returns table(empresa_id uuid, empresa text, favorecido_id uuid, cliente text, documento text)
language plpgsql security definer set search_path = public as $$
begin
  update portal_usuarios set ultimo_acesso = now() where user_id = auth.uid();
  return query select pu.empresa_id, e.nome, f.id, f.nome, f.documento
    from portal_usuarios pu join empresas e on e.id = pu.empresa_id join favorecidos f on f.id = pu.favorecido_id
    where pu.user_id = auth.uid() and pu.ativo order by e.nome, f.nome;
end $$;

-- títulos: a pagar à empresa (em aberto), negociados com banco/fundo e pagos nos últimos 12 meses
create or replace function public.portal_titulos(p_fav uuid)
returns table(id uuid, situacao text, data date, valor numeric, documento text, emissao date, pode_prorrogar boolean, prorrogacao text)
language sql stable security definer set search_path = public as $$
  select l.id,
         case when l.fidc_proposta_id is not null then 'negociado' when l.status = 'Em aberto' then 'aberto' else 'pago' end,
         l.data, l.valor, l.documento, l.emissao,
         (l.status = 'Em aberto' and l.fidc_proposta_id is null and not exists (select 1 from portal_prorrogacoes s where s.lancamento_id = l.id and s.status = 'pendente')),
         (select s.status || coalesce(': ' || s.resposta, '') from portal_prorrogacoes s where s.lancamento_id = l.id order by s.solicitado_em desc limit 1)
  from lancamentos l join plano_contas p on p.id = l.plano_id
  where portal_meu(p_fav) and l.favorecido_id = p_fav and p.tipo = 'E' and p.natureza = 'C'
    and ((l.status = 'Em aberto') or (l.fidc_proposta_id is not null and l.data >= current_date - 30) or (l.status = 'Pago' and l.data >= current_date - 365))
  order by l.data;
$$;

-- notas fiscais de venda para o cliente (pelo cadastro ou pelo CNPJ)
create or replace function public.portal_notas(p_fav uuid, p_de date)
returns table(id uuid, numero int, serie text, emissao date, valor numeric, chave text, tem_xml boolean, parcelas jsonb)
language sql stable security definer set search_path = public as $$
  select n.id, n.numero, n.serie, n.emissao, n.v_nf, n.chave, n.xml is not null,
         coalesce((select jsonb_agg(jsonb_build_object('numero', pa.numero, 'vencimento', pa.vencimento, 'valor', pa.valor) order by pa.numero) from nfe_parcelas pa where pa.nota_id = n.id), '[]'::jsonb)
  from nfe_notas n, favorecidos f
  where portal_meu(p_fav) and f.id = p_fav and n.empresa_id = f.empresa_id and n.tipo = 'saida' and n.emissao_propria and n.situacao = 'autorizada'
    and n.emissao >= p_de and (n.favorecido_id = f.id or (regexp_replace(coalesce(f.documento, ''), '\D', '', 'g') <> '' and n.dest_doc = regexp_replace(f.documento, '\D', '', 'g')))
  order by n.emissao desc, n.numero desc;
$$;

create or replace function public.portal_nota_xml(p_fav uuid, p_nota uuid)
returns text language sql stable security definer set search_path = public as $$
  select n.xml from nfe_notas n, favorecidos f
  where portal_meu(p_fav) and f.id = p_fav and n.id = p_nota and n.empresa_id = f.empresa_id and n.tipo = 'saida' and n.emissao_propria
    and (n.favorecido_id = f.id or (regexp_replace(coalesce(f.documento, ''), '\D', '', 'g') <> '' and n.dest_doc = regexp_replace(f.documento, '\D', '', 'g')));
$$;

-- o que o cliente comprou (por produto, 12 meses)
create or replace function public.portal_compras(p_fav uuid)
returns table(codigo text, descricao text, unidade text, quantidade numeric, valor numeric, ultima date, notas bigint)
language sql stable security definer set search_path = public as $$
  select i.cprod, max(i.xprod), max(i.ucom), sum(i.qcom), sum(i.vprod), max(n.emissao), count(distinct n.id)
  from portal_notas(p_fav, current_date - 365) pn join nfe_notas n on n.id = pn.id join nfe_itens i on i.nota_id = n.id
  group by i.cprod order by sum(i.vprod) desc;
$$;

create or replace function public.portal_solicitar_prorrogacao(p_fav uuid, p_lancamento uuid, p_nova_data date, p_motivo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare l lancamentos; v uuid;
begin
  if not portal_meu(p_fav) then raise exception 'Sem acesso.'; end if;
  select * into l from lancamentos where id = p_lancamento and favorecido_id = p_fav;
  if l.id is null or l.status <> 'Em aberto' then raise exception 'Título não encontrado ou não está em aberto.'; end if;
  if l.fidc_proposta_id is not null then raise exception 'Este título foi negociado com uma instituição financeira: trate a prorrogação com o banco indicado no boleto.'; end if;
  if p_nova_data is null or p_nova_data <= l.data then raise exception 'A nova data precisa ser depois do vencimento atual.'; end if;
  if p_nova_data > l.data + 90 then raise exception 'Pedidos acima de 90 dias devem ser tratados diretamente com o financeiro.'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo.'; end if;
  if exists (select 1 from portal_prorrogacoes where lancamento_id = l.id and status = 'pendente') then raise exception 'Já existe um pedido de prorrogação em análise para este título.'; end if;
  insert into portal_prorrogacoes (empresa_id, favorecido_id, lancamento_id, vencimento_atual, nova_data, valor, documento, motivo)
  values (l.empresa_id, p_fav, l.id, l.data, p_nova_data, l.valor, l.documento, trim(p_motivo)) returning id into v;
  return v;
end $$;

create or replace function public.portal_minhas_solicitacoes(p_fav uuid)
returns table(id uuid, documento text, valor numeric, vencimento_atual date, nova_data date, status text, resposta text, solicitado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.documento, s.valor, s.vencimento_atual, s.nova_data, s.status, s.resposta, s.solicitado_em
  from portal_prorrogacoes s where portal_meu(p_fav) and s.favorecido_id = p_fav order by s.solicitado_em desc limit 50;
$$;

revoke all on function public.portal_criar_convite(uuid, uuid, text), public.portal_cancelar_convite(uuid), public.portal_decidir_prorrogacao(uuid, boolean, text),
  public.portal_aceitar_convites(), public.portal_meus_clientes(), public.portal_titulos(uuid), public.portal_notas(uuid, date), public.portal_nota_xml(uuid, uuid),
  public.portal_compras(uuid), public.portal_solicitar_prorrogacao(uuid, uuid, date, text), public.portal_minhas_solicitacoes(uuid) from public, anon;
grant execute on function public.portal_criar_convite(uuid, uuid, text), public.portal_cancelar_convite(uuid), public.portal_decidir_prorrogacao(uuid, boolean, text),
  public.portal_aceitar_convites(), public.portal_meus_clientes(), public.portal_titulos(uuid), public.portal_notas(uuid, date), public.portal_nota_xml(uuid, uuid),
  public.portal_compras(uuid), public.portal_solicitar_prorrogacao(uuid, uuid, date, text), public.portal_minhas_solicitacoes(uuid),
  public.portal_meu(uuid), public.portal_pode_gerir(uuid) to authenticated;
grant execute on function public.portal_ver_convite(text) to anon, authenticated;

-- ---------- auditoria ----------
do $$
declare t text;
begin
  foreach t in array array['portal_usuarios', 'portal_convites', 'portal_prorrogacoes'] loop
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;
