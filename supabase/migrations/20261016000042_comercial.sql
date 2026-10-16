-- =====================================================================
-- Etapa 4a — Comercial: carteira de clientes, interações e agenda, funil até a proposta, propostas, metas
-- e painel pelas NF-e de saída (o pedido de venda continua no Iniflex).
-- Perfil novo "vendas" (representante): vê só a área Comercial e só os clientes da própria carteira
-- (favorecidos.representante_id = representante ligado ao usuário).
-- Migração ADITIVA, com UMA alteração em função existente: is_membro passa a excluir também o perfil
-- vendas (assim como já exclui compras) — sem isso o representante leria lançamentos, saldos etc.
-- =====================================================================

-- 1) papel novo (só texto é usado abaixo: o valor novo não pode ser usado como enum na mesma transação)
alter type public.papel_membro add value if not exists 'vendas';

-- 2) "membro" (leituras internas) exclui compras e vendas
create or replace function public.is_membro(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text not in ('compras', 'vendas'));
$$;

-- ---------- vendedores (representantes) e metas ----------
create table if not exists public.comercial_vendedores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  representante_id uuid references public.favorecidos(id) on delete set null,   -- o representante no cadastro (favorecidos.representante_id dos clientes)
  user_id uuid references auth.users(id) on delete set null,                    -- usuário da plataforma (perfil vendas)
  email text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (empresa_id, user_id)
);
create table if not exists public.comercial_metas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  vendedor_id uuid references public.comercial_vendedores(id) on delete cascade,   -- nulo = meta da empresa
  ano int not null, mes int not null check (mes between 1 and 12),
  valor numeric(16,2) not null check (valor >= 0)
);
create unique index if not exists comercial_metas_uk on public.comercial_metas(empresa_id, coalesce(vendedor_id, '00000000-0000-0000-0000-000000000000'::uuid), ano, mes);

-- quem é interno (vê tudo) e quem é representante
create or replace function public.comercial_interno(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor', 'leitura'));
$$;
create or replace function public.comercial_pode_editar(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor', 'vendas'));
$$;
create or replace function public.meu_vendedor(p_empresa uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from comercial_vendedores where empresa_id = p_empresa and user_id = auth.uid() and ativo limit 1;
$$;
-- o cliente está na carteira de quem consulta? (interno: todos)
create or replace function public.comercial_ve_cliente(p_empresa uuid, p_fav uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select comercial_interno(p_empresa) or exists(
    select 1 from favorecidos f join comercial_vendedores v on v.representante_id = f.representante_id
    where f.id = p_fav and f.empresa_id = p_empresa and v.user_id = auth.uid() and v.ativo);
$$;

-- ---------- interações e agenda ----------
create table if not exists public.comercial_interacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  favorecido_id uuid references public.favorecidos(id) on delete cascade,
  oportunidade_id uuid,                                  -- (ligada ao funil, quando for de uma oportunidade)
  tipo text not null default 'anotacao' check (tipo in ('ligacao', 'visita', 'email', 'whatsapp', 'reuniao', 'anotacao')),
  data timestamptz not null default now(),
  resumo text not null,
  proximo_contato date,
  proximo_assunto text,
  concluido boolean not null default false,              -- o "próximo contato" já foi feito
  vendedor_id uuid references public.comercial_vendedores(id) on delete set null,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists comercial_int_fav on public.comercial_interacoes(favorecido_id, data desc);
create index if not exists comercial_int_agenda on public.comercial_interacoes(empresa_id, proximo_contato) where not concluido;

-- ---------- funil (oportunidades) ----------
create table if not exists public.comercial_oportunidades (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null default 0,
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  prospect text,                                         -- cliente ainda não cadastrado
  contato text,
  vendedor_id uuid references public.comercial_vendedores(id) on delete set null,
  titulo text not null,
  etapa text not null default 'contato' check (etapa in ('contato', 'qualificado', 'proposta', 'ganha', 'perdida')),
  valor_estimado numeric(16,2),
  probabilidade smallint check (probabilidade between 0 and 100),
  previsao_fechamento date,
  motivo_perda text,
  pedido_iniflex text,                                   -- quando ganha: nº do pedido no Iniflex
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  fechado_em timestamptz,
  unique (empresa_id, numero),
  check (favorecido_id is not null or coalesce(trim(prospect), '') <> '')
);
create index if not exists comercial_op_emp on public.comercial_oportunidades(empresa_id, etapa);

-- ---------- propostas ----------
create table if not exists public.comercial_propostas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  oportunidade_id uuid not null references public.comercial_oportunidades(id) on delete cascade,
  numero int not null default 0,
  data date not null default current_date,
  validade date,
  condicao_pagamento text,
  prazo_entrega text,
  frete text check (frete in ('CIF', 'FOB')),
  observacao text,
  status text not null default 'rascunho' check (status in ('rascunho', 'enviada', 'aceita', 'recusada')),
  total numeric(16,2) not null default 0,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create table if not exists public.comercial_proposta_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  proposta_id uuid not null references public.comercial_propostas(id) on delete cascade,
  produto_id uuid references public.produtos(id) on delete set null,
  descricao text not null,
  material text, largura_mm numeric(10,2), espessura_um numeric(10,2), comprimento_m numeric(12,3), camadas smallint,
  cores_impressao smallint, especificacao text,
  quantidade numeric(16,3) not null check (quantidade > 0),
  unidade text not null default 'KG' check (unidade in ('KG', 'MIL', 'UN', 'M')),   -- unidade do preço
  preco numeric(16,4) not null check (preco >= 0),
  custo_estimado numeric(16,4)                            -- por unidade de preço (calculadora), só interno
);
create index if not exists comercial_prop_op on public.comercial_propostas(oportunidade_id);
create index if not exists comercial_prop_itens_p on public.comercial_proposta_itens(proposta_id);

-- numeração (reaproveita a função da 040) e totais
drop trigger if exists comercial_op_numero on public.comercial_oportunidades;
create trigger comercial_op_numero before insert on public.comercial_oportunidades for each row execute function public._compras_numero();
drop trigger if exists comercial_prop_numero on public.comercial_propostas;
create trigger comercial_prop_numero before insert on public.comercial_propostas for each row execute function public._compras_numero();

create or replace function public._comercial_op_regras() returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  if new.etapa = 'perdida' and coalesce(trim(new.motivo_perda), '') = '' then raise exception 'Informe o motivo da perda.'; end if;
  if new.etapa in ('ganha', 'perdida') and (tg_op = 'INSERT' or old.etapa not in ('ganha', 'perdida')) then new.fechado_em := now(); end if;
  if new.etapa not in ('ganha', 'perdida') then new.fechado_em := null; end if;
  if tg_op = 'INSERT' and new.vendedor_id is null then new.vendedor_id := meu_vendedor(new.empresa_id); end if;
  return new;
end $$;
drop trigger if exists comercial_op_regras on public.comercial_oportunidades;
create trigger comercial_op_regras before insert or update on public.comercial_oportunidades for each row execute function public._comercial_op_regras();

create or replace function public._comercial_prop_total() returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.proposta_id, old.proposta_id);
begin
  update comercial_propostas set total = coalesce((select round(sum(quantidade * preco), 2) from comercial_proposta_itens where proposta_id = pid), 0) where id = pid;
  return null;
end $$;
drop trigger if exists comercial_prop_total on public.comercial_proposta_itens;
create trigger comercial_prop_total after insert or update or delete on public.comercial_proposta_itens for each row execute function public._comercial_prop_total();

create or replace function public._comercial_int_vendedor() returns trigger language plpgsql as $$
begin
  if new.vendedor_id is null then new.vendedor_id := meu_vendedor(new.empresa_id); end if;
  return new;
end $$;
drop trigger if exists comercial_int_vendedor on public.comercial_interacoes;
create trigger comercial_int_vendedor before insert on public.comercial_interacoes for each row execute function public._comercial_int_vendedor();

-- ---------- RPCs de leitura (o perfil vendas não lê favorecidos, notas nem lançamentos direto) ----------
-- carteira: clientes visíveis com dados seguros
create or replace function public.comercial_clientes(p_empresa uuid)
returns table(id uuid, nome text, nome_fantasia text, documento text, segmento text, representante_id uuid, representante text,
              limite_credito numeric, prazo_padrao text, email text, telefone text, ativo boolean)
language sql stable security definer set search_path = public as $$
  select f.id, f.nome, f.nome_fantasia, f.documento, f.segmento, f.representante_id, r.nome, f.limite_credito, f.prazo_padrao, f.email, f.telefone, f.ativo
  from favorecidos f left join favorecidos r on r.id = f.representante_id
  where f.empresa_id = p_empresa and f.tipo in ('CLIENTES', 'TERCEIROS - CLIENTES')
    and (comercial_interno(p_empresa) or exists(select 1 from comercial_vendedores v where v.empresa_id = p_empresa and v.user_id = auth.uid() and v.ativo and v.representante_id = f.representante_id));
$$;

-- faturamento por nota (NF-e de saída de venda autorizadas), ligado ao cliente pelo cadastro ou pelo CNPJ
create or replace function public.comercial_notas(p_empresa uuid, p_de date, p_ate date)
returns table(nota_id uuid, numero int, emissao date, favorecido_id uuid, dest_doc text, dest_nome text, dest_uf text, valor numeric, representante_id uuid)
language sql stable security definer set search_path = public as $$
  with n as (
    select n.*, coalesce(n.favorecido_id, (select f.id from favorecidos f where f.empresa_id = n.empresa_id and f.tipo in ('CLIENTES', 'TERCEIROS - CLIENTES')
                                           and regexp_replace(coalesce(f.documento, ''), '\D', '', 'g') = n.dest_doc limit 1)) fav
    from nfe_notas n
    where n.empresa_id = p_empresa and n.tipo = 'saida' and n.emissao_propria and n.situacao = 'autorizada' and coalesce(n.finalidade, '1') = '1'
      and n.emissao between p_de and p_ate and not exists (select 1 from jsonb_array_elements(n.eventos) e where e->>'tipo' = 'devolucao_total'))
  select n.id, n.numero, n.emissao, n.fav, n.dest_doc, n.dest_nome, n.dest_uf, n.v_nf, f.representante_id
  from n left join favorecidos f on f.id = n.fav
  where comercial_interno(p_empresa) or exists(select 1 from comercial_vendedores v where v.empresa_id = p_empresa and v.user_id = auth.uid() and v.ativo and v.representante_id = f.representante_id);
$$;

-- itens vendidos por cliente × produto × mês
create or replace function public.comercial_itens(p_empresa uuid, p_de date, p_ate date)
returns table(favorecido_id uuid, dest_doc text, mes date, codigo text, descricao text, unidade text, quantidade numeric, valor numeric)
language sql stable security definer set search_path = public as $$
  select c.favorecido_id, c.dest_doc, date_trunc('month', c.emissao)::date, i.cprod, max(i.xprod), max(i.ucom), sum(i.qcom), sum(i.vprod)
  from comercial_notas(p_empresa, p_de, p_ate) c join nfe_itens i on i.nota_id = c.nota_id
  group by 1, 2, 3, 4;
$$;

-- situação financeira do cliente: em aberto (sem dados de fundo/borderô) e atraso médio de pagamento das parcelas das notas
create or replace function public.comercial_cliente_financeiro(p_empresa uuid, p_fav uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not comercial_ve_cliente(p_empresa, p_fav) then raise exception 'Cliente fora da sua carteira.'; end if;
  select jsonb_build_object(
    'abertos', coalesce((select jsonb_agg(jsonb_build_object('data', l.data, 'valor', l.valor, 'documento', l.documento, 'endossado', l.fidc_proposta_id is not null) order by l.data)
               from lancamentos l join plano_contas p on p.id = l.plano_id
               where l.empresa_id = p_empresa and l.favorecido_id = p_fav and l.status = 'Em aberto' and p.tipo = 'E'), '[]'::jsonb),
    'atraso', (select jsonb_build_object('parcelas', count(*), 'dias_medio', round(avg(l.data - pa.vencimento)::numeric, 1), 'pontual_pct', round(100.0 * count(*) filter (where l.data <= pa.vencimento) / nullif(count(*), 0), 1))
               from nfe_vinculos v join nfe_parcelas pa on pa.id = v.parcela_id join nfe_notas n on n.id = v.nota_id join lancamentos l on l.id = v.lancamento_id
               where v.empresa_id = p_empresa and l.status = 'Pago' and n.tipo = 'saida' and pa.vencimento is not null
                 and (n.favorecido_id = p_fav or l.favorecido_id = p_fav) and l.data >= current_date - 365)) into r;
  return r;
end $$;

revoke all on function public.comercial_clientes(uuid), public.comercial_notas(uuid, date, date), public.comercial_itens(uuid, date, date),
  public.comercial_cliente_financeiro(uuid, uuid) from public, anon;
grant execute on function public.comercial_clientes(uuid), public.comercial_notas(uuid, date, date), public.comercial_itens(uuid, date, date),
  public.comercial_cliente_financeiro(uuid, uuid), public.comercial_interno(uuid), public.comercial_pode_editar(uuid), public.meu_vendedor(uuid),
  public.comercial_ve_cliente(uuid, uuid) to authenticated;

-- ---------- acesso ----------
alter table public.comercial_vendedores enable row level security;
alter table public.comercial_metas enable row level security;
alter table public.comercial_interacoes enable row level security;
alter table public.comercial_oportunidades enable row level security;
alter table public.comercial_propostas enable row level security;
alter table public.comercial_proposta_itens enable row level security;

-- vendedores e metas: todos da empresa leem; admin/diretor mantêm
drop policy if exists comercial_vendedores_sel on public.comercial_vendedores;
drop policy if exists comercial_vendedores_all on public.comercial_vendedores;
create policy comercial_vendedores_sel on public.comercial_vendedores for select to authenticated using (public.is_participante(empresa_id));
create policy comercial_vendedores_all on public.comercial_vendedores for all to authenticated using (public.pode_aprovar_compra(empresa_id)) with check (public.pode_aprovar_compra(empresa_id));
drop policy if exists comercial_metas_sel on public.comercial_metas;
drop policy if exists comercial_metas_all on public.comercial_metas;
create policy comercial_metas_sel on public.comercial_metas for select to authenticated using (public.comercial_interno(empresa_id) or vendedor_id = public.meu_vendedor(empresa_id));
create policy comercial_metas_all on public.comercial_metas for all to authenticated using (public.pode_aprovar_compra(empresa_id)) with check (public.pode_aprovar_compra(empresa_id));

-- interações: interno vê tudo; representante vê as da carteira dele e as que ele mesmo registrou
drop policy if exists comercial_int_sel on public.comercial_interacoes;
drop policy if exists comercial_int_ins on public.comercial_interacoes;
drop policy if exists comercial_int_upd on public.comercial_interacoes;
drop policy if exists comercial_int_del on public.comercial_interacoes;
create policy comercial_int_sel on public.comercial_interacoes for select to authenticated
  using (public.comercial_interno(empresa_id) or criado_por = (select auth.uid()) or (favorecido_id is not null and public.comercial_ve_cliente(empresa_id, favorecido_id)));
create policy comercial_int_ins on public.comercial_interacoes for insert to authenticated
  with check (public.comercial_pode_editar(empresa_id) and (favorecido_id is null or public.comercial_ve_cliente(empresa_id, favorecido_id)));
create policy comercial_int_upd on public.comercial_interacoes for update to authenticated
  using (public.comercial_pode_editar(empresa_id) and (public.comercial_interno(empresa_id) or criado_por = (select auth.uid())))
  with check (public.comercial_pode_editar(empresa_id));
create policy comercial_int_del on public.comercial_interacoes for delete to authenticated
  using (public.comercial_pode_editar(empresa_id) and (public.comercial_interno(empresa_id) or criado_por = (select auth.uid())));

-- oportunidades: interno vê tudo; representante vê as dele
drop policy if exists comercial_op_sel on public.comercial_oportunidades;
drop policy if exists comercial_op_ins on public.comercial_oportunidades;
drop policy if exists comercial_op_upd on public.comercial_oportunidades;
create policy comercial_op_sel on public.comercial_oportunidades for select to authenticated
  using (public.comercial_interno(empresa_id) or vendedor_id = public.meu_vendedor(empresa_id));
create policy comercial_op_ins on public.comercial_oportunidades for insert to authenticated
  with check (public.comercial_pode_editar(empresa_id) and (favorecido_id is null or public.comercial_ve_cliente(empresa_id, favorecido_id)));
create policy comercial_op_upd on public.comercial_oportunidades for update to authenticated
  using (public.comercial_pode_editar(empresa_id) and (public.comercial_interno(empresa_id) or vendedor_id = public.meu_vendedor(empresa_id)))
  with check (public.comercial_pode_editar(empresa_id) and (public.comercial_interno(empresa_id) or vendedor_id = public.meu_vendedor(empresa_id)));

-- propostas e itens seguem a oportunidade
create or replace function public.comercial_ve_oportunidade(p_op uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from comercial_oportunidades o where o.id = p_op
    and (comercial_interno(o.empresa_id) or o.vendedor_id = meu_vendedor(o.empresa_id)));
$$;
grant execute on function public.comercial_ve_oportunidade(uuid) to authenticated;
drop policy if exists comercial_prop_sel on public.comercial_propostas;
drop policy if exists comercial_prop_ins on public.comercial_propostas;
drop policy if exists comercial_prop_upd on public.comercial_propostas;
drop policy if exists comercial_prop_del on public.comercial_propostas;
create policy comercial_prop_sel on public.comercial_propostas for select to authenticated using (public.comercial_ve_oportunidade(oportunidade_id));
create policy comercial_prop_ins on public.comercial_propostas for insert to authenticated with check (public.comercial_pode_editar(empresa_id) and public.comercial_ve_oportunidade(oportunidade_id));
create policy comercial_prop_upd on public.comercial_propostas for update to authenticated using (public.comercial_pode_editar(empresa_id) and public.comercial_ve_oportunidade(oportunidade_id))
  with check (public.comercial_pode_editar(empresa_id) and public.comercial_ve_oportunidade(oportunidade_id));
create policy comercial_prop_del on public.comercial_propostas for delete to authenticated using (public.comercial_pode_editar(empresa_id) and public.comercial_ve_oportunidade(oportunidade_id) and status = 'rascunho');
drop policy if exists comercial_pi_sel on public.comercial_proposta_itens;
drop policy if exists comercial_pi_all on public.comercial_proposta_itens;
create policy comercial_pi_sel on public.comercial_proposta_itens for select to authenticated
  using (exists(select 1 from comercial_propostas p where p.id = proposta_id and public.comercial_ve_oportunidade(p.oportunidade_id)));
create policy comercial_pi_all on public.comercial_proposta_itens for all to authenticated
  using (public.comercial_pode_editar(empresa_id) and exists(select 1 from comercial_propostas p where p.id = proposta_id and p.status = 'rascunho' and public.comercial_ve_oportunidade(p.oportunidade_id)))
  with check (public.comercial_pode_editar(empresa_id) and exists(select 1 from comercial_propostas p where p.id = proposta_id and p.status = 'rascunho' and public.comercial_ve_oportunidade(p.oportunidade_id)));

grant select, insert, update, delete on public.comercial_vendedores, public.comercial_metas, public.comercial_interacoes, public.comercial_propostas, public.comercial_proposta_itens to authenticated;
grant select, insert, update on public.comercial_oportunidades to authenticated;

-- ---------- custos ficam fora do alcance do representante ----------
-- de-para com último custo, estrutura e espelho do estoque (com custo): só internos e Compras (produtos continua visível a todos)
drop policy if exists produto_fornecedores_sel on public.produto_fornecedores;
create policy produto_fornecedores_sel on public.produto_fornecedores for select to authenticated using (public.is_membro(empresa_id) or public.pode_comprar(empresa_id));
drop policy if exists produto_estrutura_sel on public.produto_estrutura;
create policy produto_estrutura_sel on public.produto_estrutura for select to authenticated using (public.is_membro(empresa_id) or public.pode_comprar(empresa_id));
drop policy if exists estoque_espelhos_sel on public.estoque_espelhos;
create policy estoque_espelhos_sel on public.estoque_espelhos for select to authenticated using (public.is_membro(empresa_id) or public.pode_comprar(empresa_id));
drop policy if exists estoque_espelho_itens_sel on public.estoque_espelho_itens;
create policy estoque_espelho_itens_sel on public.estoque_espelho_itens for select to authenticated using (public.is_membro(empresa_id) or public.pode_comprar(empresa_id));
-- Compras (requisições, cotações, pedidos) também não é assunto do representante
do $$
declare t text;
begin
  foreach t in array array['compras_requisicoes', 'compras_requisicao_itens', 'compras_cotacoes', 'compras_cotacao_itens', 'compras_pedidos', 'compras_pedido_itens',
                           'compras_recebimentos', 'compras_recebimento_itens', 'compras_pedido_lancamentos', 'compras_parametros'] loop
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_membro(empresa_id) or public.pode_comprar(empresa_id))', t || '_sel', t);
  end loop;
end $$;

-- ---------- auditoria (migração 038) ----------
do $$
declare t text;
begin
  foreach t in array array['comercial_vendedores', 'comercial_metas', 'comercial_interacoes', 'comercial_oportunidades', 'comercial_propostas', 'comercial_proposta_itens'] loop
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;
