-- =====================================================================
-- Produção › Casa de Tintas (07/11/2026). Referência: ERP "Consultoria" (039–042: cadastros, estoque de insumo à parte,
-- receitas versionadas e ordem de preparação com pesagem). Refeita sobre o ESTOQUE OFICIAL (sem estoque paralelo):
--  - cores (Pantone, padrão do cliente ou instrumental L*a*b*) e sistemas de tinta;
--  - receitas com VERSÕES: rascunho → em teste → aprovada (só uma aprovada por receita; a anterior fica obsoleta) → bloqueada;
--    versão aprovada não muda (corrige-se por nova versão); itens são produtos do estoque (tinta base, pigmento, verniz,
--    solvente, retardador, aditivo ou a própria sobra de tinta pronta), em quantidade por base da receita;
--  - ordem de preparação só de versão aprovada, ligada à OP da impressão; pesagem item a item com tolerância (desvio fora
--    exige justificativa), ajustes de cor/viscosidade, medições (viscosidade, densidade, ΔE) contra a versão;
--  - estoque: cada pesagem sai do estoque pelo custo médio (requisição para a produção); a tinta aprovada entra como lote no
--    local Casa de Tintas (produção, custo real = soma das pesagens); entrega à máquina e retorno da sobra são transferências
--    para o "em processo" da impressão e de volta; a sobra vira ingrediente de outra ordem. Antes da implantação do estoque,
--    nada movimenta: o custo sai do último preço de compra.
-- Só cria objetos novos. Não altera produtos, movimentos nem saldos existentes.
-- =====================================================================

create or replace function public.pode_tintas(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor', 'producao'));
$$;
revoke all on function public.pode_tintas(uuid) from public, anon;
grant execute on function public.pode_tintas(uuid) to authenticated;

-- 1) parâmetros
create table if not exists public.tin_parametros (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  local_tinta_id uuid references public.est_locais(id) on delete set null,      -- onde fica a tinta pronta (lotes)
  local_insumos_id uuid references public.est_locais(id) on delete set null,    -- de onde saem os insumos (vazio: local padrão do produto)
  local_maquina_id uuid references public.est_locais(id) on delete set null,    -- para onde vai a tinta entregue (em processo da impressão)
  tolerancia_pct numeric(6,2) not null default 2,          -- desvio de pesagem aceito sem justificativa
  validade_dias int not null default 30,                   -- validade da tinta pronta
  criar_produto boolean not null default true,             -- cria o produto "tinta pronta" da cor na primeira aprovação
  papeis_aprovacao text[] not null default array['admin', 'diretor', 'financeiro'],   -- aprovam receita e concessão
  balanca_baud int not null default 9600,                  -- leitura da balança pela porta serial (navegador)
  atualizado_em timestamptz not null default now()
);

-- 2) sistemas e cores
create table if not exists public.tin_sistemas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null, descricao text, ativo boolean not null default true,
  unique (empresa_id, nome)
);
create table if not exists public.tin_cores (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null, nome text not null,
  sistema_id uuid references public.tin_sistemas(id) on delete set null,
  padrao text not null default 'pantone' check (padrao in ('pantone', 'cliente', 'instrumental')),
  referencia text,                                          -- "Pantone 286 C", "padrão aprovado em 12/10"
  lab_l numeric(7,3), lab_a numeric(7,3), lab_b numeric(7,3),
  hex text,                                                 -- cor aproximada para a tela
  favorecido_id uuid references public.favorecidos(id) on delete set null,   -- cor exclusiva do cliente
  produto_id uuid references public.produtos(id) on delete set null,         -- produto "tinta pronta" (estoque)
  ativo boolean not null default true, observacao text,
  criado_em timestamptz not null default now(),
  unique (empresa_id, codigo)
);

-- 3) receitas e versões
create table if not exists public.tin_receitas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  cor_id uuid not null references public.tin_cores(id) on delete cascade,
  codigo text not null, nome text not null,
  aplicacao text not null default 'superficie' check (aplicacao in ('superficie', 'laminacao', 'verso', 'outra')),
  substrato text,                                           -- PE, BOPP, PET…
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  unique (empresa_id, codigo)
);
create table if not exists public.tin_versoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  receita_id uuid not null references public.tin_receitas(id) on delete cascade,
  numero int not null,
  situacao text not null default 'rascunho' check (situacao in ('rascunho', 'em_teste', 'aprovada', 'bloqueada', 'obsoleta')),
  base_kg numeric(12,3) not null default 100 check (base_kg > 0),   -- as quantidades dos itens são para esta base
  viscosidade_alvo numeric(8,2), viscosidade_tol numeric(8,2), viscosidade_metodo text default 'Copo Zahn nº 2 (s)',
  densidade_alvo numeric(8,4), densidade_tol numeric(8,4),
  delta_e_max numeric(6,2),
  motivo text,                                              -- por que nasceu esta versão
  aprovada_por text, aprovada_em timestamptz,
  observacao text,
  criado_em timestamptz not null default now(),
  unique (receita_id, numero)
);
create unique index if not exists tin_versao_aprovada on public.tin_versoes(receita_id) where situacao = 'aprovada';
create table if not exists public.tin_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  versao_id uuid not null references public.tin_versoes(id) on delete cascade,
  seq int not null default 1,                               -- ordem de adição
  produto_id uuid not null references public.produtos(id),
  quantidade numeric(14,4) not null check (quantidade > 0), -- para a base_kg da versão
  funcao text not null default 'base' check (funcao in ('base', 'pigmento', 'verniz', 'solvente', 'retardador', 'aditivo', 'sobra', 'outro')),
  tolerancia_pct numeric(6,2),                              -- vazio: a dos parâmetros
  instrucao text
);
create index if not exists tin_itens_versao on public.tin_itens(versao_id, seq);

-- 4) ordens de preparação, pesagens e medições
create table if not exists public.tin_ordens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  versao_id uuid not null references public.tin_versoes(id),
  cor_id uuid not null references public.tin_cores(id),
  quantidade numeric(12,3) not null check (quantidade > 0),          -- kg planejados
  ordem_id uuid references public.prod_ordens(id) on delete set null, -- OP da impressão
  situacao text not null default 'aberta' check (situacao in ('aberta', 'em_pesagem', 'em_ajuste', 'aprovada', 'entregue', 'encerrada', 'cancelada')),
  lote_id uuid references public.est_lotes(id) on delete set null,   -- lote da tinta pronta no estoque
  lote_codigo text,
  quantidade_real numeric(12,3),                                      -- soma do que foi pesado
  custo_total numeric(14,2), custo_kg numeric(14,4),
  entregue_kg numeric(12,3) not null default 0, retorno_kg numeric(12,3) not null default 0,
  validade date,
  concessao text,                                                     -- aprovada fora do padrão: motivo
  aprovada_por text, aprovada_em timestamptz,
  responsavel text, observacao text,
  criado_por text default (auth.jwt() ->> 'email'), criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists tin_ordens_emp on public.tin_ordens(empresa_id, situacao);
create table if not exists public.tin_pesagens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem_id uuid not null references public.tin_ordens(id) on delete cascade,
  item_id uuid references public.tin_itens(id) on delete set null,   -- vazio: ajuste fora da receita
  produto_id uuid not null references public.produtos(id),
  lote_id uuid references public.est_lotes(id) on delete set null,
  prevista numeric(14,4), pesada numeric(14,4) not null check (pesada > 0),
  desvio_pct numeric(8,3), fora_tolerancia boolean not null default false, justificativa text,
  ajuste boolean not null default false,
  movimento_id uuid references public.est_movimentos(id) on delete set null,
  custo numeric(14,2),
  balanca boolean not null default false,                              -- lido da balança
  situacao text not null default 'pesada' check (situacao in ('pesada', 'estornada')),
  operador text default (auth.jwt() ->> 'email'), criado_em timestamptz not null default now()
);
create index if not exists tin_pes_ordem on public.tin_pesagens(ordem_id);
create table if not exists public.tin_medicoes (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem_id uuid not null references public.tin_ordens(id) on delete cascade,
  viscosidade numeric(8,2), densidade numeric(8,4), delta_e numeric(6,2), temperatura numeric(5,1),
  ok boolean, observacao text,
  usuario text default (auth.jwt() ->> 'email'), criado_em timestamptz not null default now()
);

-- 5) acesso: lê quem participa; cores, receitas, versões, itens e parâmetros: quem gerencia a produção (pode_pcp) e o
--    tinteiro (pode_tintas) só em rascunho/teste; ordens e medições: pode_tintas. Pesagem, aprovação e estoque: funções.
do $$ declare t text; begin
  foreach t in array array['tin_parametros', 'tin_sistemas', 'tin_cores', 'tin_receitas', 'tin_versoes', 'tin_itens', 'tin_ordens', 'tin_pesagens', 'tin_medicoes'] loop
    execute format('alter table public.%s enable row level security', t);
    execute format('drop policy if exists %1$s_sel on public.%1$s; drop policy if exists %1$s_ins on public.%1$s; drop policy if exists %1$s_upd on public.%1$s; drop policy if exists %1$s_del on public.%1$s;', t);
    execute format('create policy %1$s_sel on public.%1$s for select to authenticated using (public.is_participante(empresa_id))', t);
  end loop;
  foreach t in array array['tin_parametros', 'tin_sistemas'] loop
    execute format('create policy %1$s_ins on public.%1$s for insert to authenticated with check (public.pode_pcp(empresa_id))', t);
    execute format('create policy %1$s_upd on public.%1$s for update to authenticated using (public.pode_pcp(empresa_id)) with check (public.pode_pcp(empresa_id))', t);
    execute format('create policy %1$s_del on public.%1$s for delete to authenticated using (public.pode_pcp(empresa_id))', t);
    execute format('grant select, insert, update, delete on public.%s to authenticated', t);
  end loop;
  foreach t in array array['tin_cores', 'tin_receitas', 'tin_versoes', 'tin_itens', 'tin_ordens', 'tin_medicoes'] loop
    execute format('create policy %1$s_ins on public.%1$s for insert to authenticated with check (public.pode_tintas(empresa_id))', t);
    execute format('create policy %1$s_upd on public.%1$s for update to authenticated using (public.pode_tintas(empresa_id)) with check (public.pode_tintas(empresa_id))', t);
    execute format('create policy %1$s_del on public.%1$s for delete to authenticated using (public.pode_pcp(empresa_id))', t);
    execute format('grant select, insert, update, delete on public.%s to authenticated', t);
  end loop;
  execute 'grant select on public.tin_pesagens to authenticated';
end $$;
grant usage, select on sequence public.tin_medicoes_id_seq to authenticated;

-- quem aprova receita e concessão (parâmetro; admin sempre)
create or replace function public.tin_pode_aprovar(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros m left join tin_parametros p on p.empresa_id = m.empresa_id
                 where m.empresa_id = p_empresa and m.user_id = auth.uid()
                   and (m.papel::text = 'admin' or m.papel::text = any(coalesce(p.papeis_aprovacao, array['admin', 'diretor', 'financeiro']))));
$$;
grant execute on function public.tin_pode_aprovar(uuid) to authenticated;

-- 6) regras: mesma empresa, versão aprovada não muda, ordem só de versão aprovada, numeração, medição contra a versão
create or replace function public._tin_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new); v tin_versoes; v_sit text; o tin_ordens;
begin
  if (j ->> 'produto_id') is not null and not exists (select 1 from produtos where id = (j ->> 'produto_id')::uuid and empresa_id = new.empresa_id) then raise exception 'Produto de outra empresa.'; end if;
  if tg_table_name = 'tin_cores' then
    new.codigo := upper(trim(new.codigo)); return new;
  end if;
  if tg_table_name = 'tin_receitas' then
    if not exists (select 1 from tin_cores where id = new.cor_id and empresa_id = new.empresa_id) then raise exception 'Cor de outra empresa.'; end if;
    new.codigo := upper(trim(new.codigo)); return new;
  end if;
  if tg_table_name = 'tin_versoes' then
    if tg_op = 'INSERT' then
      if not exists (select 1 from tin_receitas where id = new.receita_id and empresa_id = new.empresa_id) then raise exception 'Receita de outra empresa.'; end if;
      if new.numero is null or new.numero <= 0 then select coalesce(max(numero), 0) + 1 into new.numero from tin_versoes where receita_id = new.receita_id; end if;
      if new.situacao in ('aprovada') then raise exception 'A versão nasce em rascunho: aprove pelo botão.'; end if;
    else
      if current_setting('tin.aprovando', true) is distinct from 'on' then
        if new.situacao = 'aprovada' and old.situacao <> 'aprovada' then raise exception 'Aprove a versão pelo botão Aprovar (confere os itens e quem aprova).'; end if;
        if old.situacao in ('aprovada', 'obsoleta') and (new.base_kg, new.viscosidade_alvo, new.viscosidade_tol, new.densidade_alvo, new.densidade_tol, new.delta_e_max)
           is distinct from (old.base_kg, old.viscosidade_alvo, old.viscosidade_tol, old.densidade_alvo, old.densidade_tol, old.delta_e_max) then
          raise exception 'Versão % aprovada não muda: crie uma nova versão.', old.numero; end if;
        if old.situacao = 'obsoleta' and new.situacao <> 'obsoleta' then raise exception 'Versão obsoleta não volta.'; end if;
        if new.situacao = 'bloqueada' and old.situacao <> 'bloqueada' and not tin_pode_aprovar(new.empresa_id) then raise exception 'Seu perfil não bloqueia receita.'; end if;
      end if;
    end if;
    return new;
  end if;
  if tg_table_name = 'tin_itens' then
    select situacao into v_sit from tin_versoes where id = new.versao_id;
    if v_sit not in ('rascunho', 'em_teste') then raise exception 'Itens de versão % não mudam: crie uma nova versão.', v_sit; end if;
    return new;
  end if;
  if tg_table_name = 'tin_ordens' then
    if tg_op = 'INSERT' then
      select * into v from tin_versoes where id = new.versao_id and empresa_id = new.empresa_id;
      if v.id is null then raise exception 'Versão de outra empresa.'; end if;
      if v.situacao <> 'aprovada' then raise exception 'Só se prepara tinta de versão aprovada (esta está em %).', v.situacao; end if;
      new.cor_id := (select cor_id from tin_receitas where id = v.receita_id);
      perform pg_advisory_xact_lock(hashtext('tin_ordem:' || new.empresa_id::text));
      select coalesce(max(numero), 0) + 1 into new.numero from tin_ordens where empresa_id = new.empresa_id;
      if new.situacao not in ('aberta') then new.situacao := 'aberta'; end if;
    elsif current_setting('tin.aprovando', true) is distinct from 'on' then
      if new.situacao is distinct from old.situacao then
        if new.situacao = 'cancelada' and old.situacao in ('aberta', 'em_pesagem', 'em_ajuste') then
          if exists (select 1 from tin_pesagens where ordem_id = new.id and situacao = 'pesada') then raise exception 'Ordem com pesagens: estorne as pesagens antes de cancelar.'; end if;
        elsif new.situacao = 'encerrada' and old.situacao in ('aprovada', 'entregue') then null;
        else raise exception 'Situação da ordem muda pelos botões (pesar, medir, aprovar, entregar).'; end if;
      end if;
      if (new.versao_id, new.custo_total, new.custo_kg, new.lote_id, new.lote_codigo, new.entregue_kg, new.retorno_kg, new.quantidade_real, new.aprovada_em, new.concessao)
         is distinct from (old.versao_id, old.custo_total, old.custo_kg, old.lote_id, old.lote_codigo, old.entregue_kg, old.retorno_kg, old.quantidade_real, old.aprovada_em, old.concessao) then
        raise exception 'Ordem %: versão, custo, lote e quantidades mudam pelas funções.', old.numero; end if;
      if new.quantidade is distinct from old.quantidade and old.situacao <> 'aberta' then
        raise exception 'Ordem % em pesagem: use "Corrigir proporção" para mudar a quantidade.', old.numero; end if;
    end if;
    new.atualizado_em := now();
    return new;
  end if;
  if tg_table_name = 'tin_medicoes' then
    select * into o from tin_ordens where id = new.ordem_id and empresa_id = new.empresa_id;
    if o.id is null then raise exception 'Ordem de outra empresa.'; end if;
    if o.situacao not in ('em_pesagem', 'em_ajuste', 'aberta') then raise exception 'Ordem % já %.', o.numero, o.situacao; end if;
    select * into v from tin_versoes where id = o.versao_id;
    new.ok := (v.viscosidade_alvo is null or new.viscosidade is null or abs(new.viscosidade - v.viscosidade_alvo) <= coalesce(v.viscosidade_tol, 0))
          and (v.densidade_alvo is null or new.densidade is null or abs(new.densidade - v.densidade_alvo) <= coalesce(v.densidade_tol, 0))
          and (v.delta_e_max is null or new.delta_e is null or new.delta_e <= v.delta_e_max)
          and (new.viscosidade is not null or new.densidade is not null or new.delta_e is not null);
    perform set_config('tin.aprovando', 'on', true);
    update tin_ordens set situacao = case when new.ok then 'em_pesagem' else 'em_ajuste' end where id = o.id and situacao <> 'aberta';
    perform set_config('tin.aprovando', 'off', true);
    return new;
  end if;
  return new;
end $$;
revoke all on function public._tin_regras() from public, anon, authenticated;
do $$ declare t text; begin
  foreach t in array array['tin_cores', 'tin_receitas', 'tin_versoes', 'tin_ordens'] loop
    execute format('drop trigger if exists %1$s_regras on public.%1$s', t);
    execute format('create trigger %1$s_regras before insert or update on public.%1$s for each row execute function public._tin_regras()', t);
  end loop;
end $$;
drop trigger if exists tin_medicoes_regras on public.tin_medicoes;
create trigger tin_medicoes_regras before insert on public.tin_medicoes for each row execute function public._tin_regras();

-- delete em tin_itens devolve OLD (o gatilho acima devolve NEW, nulo no delete)
create or replace function public._tin_itens_del() returns trigger language plpgsql security definer set search_path = public as $$
declare v_sit text;
begin
  select situacao into v_sit from tin_versoes where id = old.versao_id;
  if v_sit not in ('rascunho', 'em_teste') then raise exception 'Itens de versão % não mudam: crie uma nova versão.', v_sit; end if;
  return old;
end $$;
drop trigger if exists tin_itens_regras on public.tin_itens;
create trigger tin_itens_regras before insert or update on public.tin_itens for each row execute function public._tin_regras();
drop trigger if exists tin_itens_del on public.tin_itens;
create trigger tin_itens_del before delete on public.tin_itens for each row execute function public._tin_itens_del();

-- 7) versões: aprovar (a anterior fica obsoleta) e nova versão (cópia)
create or replace function public.tin_aprovar_versao(p_versao uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v tin_versoes;
begin
  select * into v from tin_versoes where id = p_versao for update;
  if not found then raise exception 'Versão não encontrada.'; end if;
  if not tin_pode_aprovar(v.empresa_id) then raise exception 'Seu perfil não aprova receita (Casa de Tintas › Parâmetros).'; end if;
  if v.situacao not in ('rascunho', 'em_teste') then raise exception 'Versão em % não se aprova.', v.situacao; end if;
  if not exists (select 1 from tin_itens where versao_id = v.id) then raise exception 'A versão não tem itens.'; end if;
  perform set_config('tin.aprovando', 'on', true);
  update tin_versoes set situacao = 'obsoleta' where receita_id = v.receita_id and situacao = 'aprovada';
  update tin_versoes set situacao = 'aprovada', aprovada_por = auth.jwt() ->> 'email', aprovada_em = now() where id = v.id;
  perform set_config('tin.aprovando', 'off', true);
  return 'aprovada';
end $$;
create or replace function public.tin_nova_versao(p_versao uuid, p_motivo text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v tin_versoes; n uuid;
begin
  select * into v from tin_versoes where id = p_versao;
  if not found or not pode_tintas(v.empresa_id) then raise exception 'Sem permissão.'; end if;
  if exists (select 1 from tin_versoes where receita_id = v.receita_id and situacao in ('rascunho', 'em_teste')) then
    raise exception 'Já existe uma versão em rascunho ou em teste nesta receita: continue nela.'; end if;
  insert into tin_versoes(empresa_id, receita_id, base_kg, viscosidade_alvo, viscosidade_tol, viscosidade_metodo, densidade_alvo, densidade_tol, delta_e_max, motivo, observacao)
  values (v.empresa_id, v.receita_id, v.base_kg, v.viscosidade_alvo, v.viscosidade_tol, v.viscosidade_metodo, v.densidade_alvo, v.densidade_tol, v.delta_e_max, p_motivo, v.observacao)
  returning id into n;
  insert into tin_itens(empresa_id, versao_id, seq, produto_id, quantidade, funcao, tolerancia_pct, instrucao)
  select empresa_id, n, seq, produto_id, quantidade, funcao, tolerancia_pct, instrucao from tin_itens where versao_id = v.id;
  return n;
end $$;
revoke all on function public.tin_aprovar_versao(uuid), public.tin_nova_versao(uuid, text) from public, anon;
grant execute on function public.tin_aprovar_versao(uuid), public.tin_nova_versao(uuid, text) to authenticated;

-- estoque implantado?
create or replace function public._tin_estoque(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select implantado_em is not null from est_config where empresa_id = p_empresa), false);
$$;

-- 8) pesagem: sai do estoque (REQPROD, custo médio) ou, antes da implantação, pelo último preço
create or replace function public.tin_pesar(p_ordem uuid, p_item uuid, p_produto uuid, p_qtd numeric, p_lote uuid default null,
  p_justificativa text default null, p_balanca boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o tin_ordens; v tin_versoes; it tin_itens; qp tin_parametros; pr produtos; v_prev numeric; v_ja numeric; v_desv numeric; v_tol numeric; v_fora boolean := false;
        t uuid; v_loc uuid; v_lote uuid := p_lote; v_mov uuid; v_val numeric; v_id uuid; op prod_ordens;
begin
  select * into o from tin_ordens where id = p_ordem for update;
  if o.id is null or not pode_tintas(o.empresa_id) then raise exception 'Sem permissão.'; end if;
  if o.situacao not in ('aberta', 'em_pesagem', 'em_ajuste') then raise exception 'Ordem % já %.', o.numero, o.situacao; end if;
  if coalesce(p_qtd, 0) <= 0 then raise exception 'Peso inválido.'; end if;
  select * into v from tin_versoes where id = o.versao_id;
  select * into qp from tin_parametros where empresa_id = o.empresa_id;
  if p_item is not null then
    select * into it from tin_itens where id = p_item and versao_id = o.versao_id;
    if it.id is null then raise exception 'Item não é desta receita.'; end if;
    select * into pr from produtos where id = coalesce(p_produto, it.produto_id) and empresa_id = o.empresa_id;
    if pr.id <> it.produto_id and it.funcao <> 'sobra' then raise exception 'O item pede outro produto.'; end if;
    v_prev := round(it.quantidade * o.quantidade / v.base_kg, 4);
    select coalesce(sum(pesada), 0) into v_ja from tin_pesagens where ordem_id = o.id and item_id = it.id and situacao = 'pesada' and not ajuste;
    v_desv := round(((v_ja + p_qtd) - v_prev) / v_prev * 100, 3);
    v_tol := coalesce(it.tolerancia_pct, qp.tolerancia_pct, 2);
    v_fora := abs(v_desv) > v_tol and (v_ja + p_qtd) > v_prev;   -- acima já é fora; abaixo ainda pode completar
  else
    select * into pr from produtos where id = p_produto and empresa_id = o.empresa_id;
    if pr.id is null then raise exception 'Escolha o produto do ajuste.'; end if;
    if nullif(trim(coalesce(p_justificativa, '')), '') is null then raise exception 'Ajuste fora da receita: diga o motivo (cor, viscosidade…).'; end if;
  end if;
  if v_fora and nullif(trim(coalesce(p_justificativa, '')), '') is null then
    raise exception 'Peso % fora da tolerância (desvio %%%): informe a justificativa ou use "Corrigir proporção".', p_qtd, v_desv; end if;
  if _tin_estoque(o.empresa_id) then
    select id into t from est_tipos_movimento where empresa_id = o.empresa_id and codigo = 'REQPROD' and ativo;
    if t is null then raise exception 'Tipo de movimento REQPROD não configurado no estoque.'; end if;
    -- sobra de tinta pronta sai do local da casa de tintas; insumo do local escolhido nos parâmetros ou do local padrão
    v_loc := case when exists (select 1 from tin_cores where produto_id = pr.id) then coalesce(qp.local_tinta_id, pr.local_padrao_id) else coalesce(qp.local_insumos_id, pr.local_padrao_id) end;
    if v_loc is null then raise exception 'Produto % sem local: defina o local dos insumos nos parâmetros.', pr.codigo; end if;
    if pr.controla_lote and v_lote is null then   -- vence primeiro, depois o mais antigo; sem lote bloqueado
      select s.lote_id into v_lote from est_saldos s join est_lotes l on l.id = s.lote_id
       where s.produto_id = pr.id and s.local_id = v_loc and s.quantidade >= p_qtd and not coalesce(l.bloqueado, false)
       order by l.validade nulls last, l.criado_em limit 1;
      if v_lote is null then raise exception 'Nenhum lote de % com % kg em estoque.', pr.codigo, p_qtd; end if;
    end if;
    select * into op from prod_ordens where id = o.ordem_id;
    insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, documento, observacao)
    values (o.empresa_id, current_date, pr.id, v_loc, v_lote, t, -p_qtd, 'Tinta ' || o.numero, 'Casa de tintas' || coalesce(' · OP ' || op.numero, ''))
    returning id, abs(coalesce(valor, 0)) into v_mov, v_val;
  else
    select p_qtd * coalesce((select custo_medio from est_custos where produto_id = pr.id and custo_medio > 0),
                            (select pf.ultimo_preco from produto_fornecedores pf where pf.produto_id = pr.id and pf.ultimo_preco is not null order by pf.ultima_compra desc nulls last limit 1), 0)
      into v_val;
  end if;
  insert into tin_pesagens(empresa_id, ordem_id, item_id, produto_id, lote_id, prevista, pesada, desvio_pct, fora_tolerancia, justificativa, ajuste, movimento_id, custo, balanca)
  values (o.empresa_id, o.id, p_item, pr.id, v_lote, v_prev, p_qtd, v_desv, v_fora, nullif(trim(coalesce(p_justificativa, '')), ''), p_item is null, v_mov, round(coalesce(v_val, 0), 2), coalesce(p_balanca, false))
  returning id into v_id;
  perform set_config('tin.aprovando', 'on', true);
  update tin_ordens set situacao = case when situacao = 'aberta' then 'em_pesagem' else situacao end,
         quantidade_real = (select sum(pesada) from tin_pesagens where ordem_id = o.id and situacao = 'pesada') where id = o.id;
  perform set_config('tin.aprovando', 'off', true);
  return jsonb_build_object('id', v_id, 'prevista', v_prev, 'desvio_pct', v_desv, 'fora', v_fora, 'custo', round(coalesce(v_val, 0), 2), 'estoque', v_mov is not null);
end $$;
create or replace function public.tin_estornar_pesagem(p_pesagem uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare p tin_pesagens; o tin_ordens;
begin
  select * into p from tin_pesagens where id = p_pesagem;
  select * into o from tin_ordens where id = p.ordem_id;
  if p.id is null or not pode_tintas(p.empresa_id) then raise exception 'Sem permissão.'; end if;
  if p.situacao <> 'pesada' then raise exception 'Pesagem já estornada.'; end if;
  if o.situacao not in ('aberta', 'em_pesagem', 'em_ajuste') then raise exception 'Ordem % já %: a pesagem não se estorna.', o.numero, o.situacao; end if;
  if p.movimento_id is not null then perform est_estornar(p.movimento_id, current_date, coalesce(p_motivo, 'Estorno da pesagem da tinta ' || o.numero)); end if;
  update tin_pesagens set situacao = 'estornada' where id = p.id;
  perform set_config('tin.aprovando', 'on', true);
  update tin_ordens set quantidade_real = (select sum(pesada) from tin_pesagens where ordem_id = o.id and situacao = 'pesada') where id = o.id;
  perform set_config('tin.aprovando', 'off', true);
end $$;
-- corrigir proporção: quando um componente passou do previsto, a ordem cresce na mesma proporção e os demais itens
-- passam a ser pesados pela nova quantidade (mantém a fórmula)
create or replace function public.tin_reescalar(p_ordem uuid, p_quantidade numeric)
returns numeric language plpgsql security definer set search_path = public as $$
declare o tin_ordens;
begin
  select * into o from tin_ordens where id = p_ordem for update;
  if o.id is null or not pode_tintas(o.empresa_id) then raise exception 'Sem permissão.'; end if;
  if o.situacao not in ('aberta', 'em_pesagem', 'em_ajuste') then raise exception 'Ordem % já %.', o.numero, o.situacao; end if;
  if coalesce(p_quantidade, 0) <= 0 or p_quantidade > o.quantidade * 3 then raise exception 'Nova quantidade inválida.'; end if;
  perform set_config('tin.aprovando', 'on', true);
  update tin_ordens set quantidade = round(p_quantidade, 3), observacao = coalesce(observacao || ' · ', '') || 'Proporção corrigida: ' || o.quantidade || ' → ' || round(p_quantidade, 3) || ' kg' where id = o.id;
  perform set_config('tin.aprovando', 'off', true);
  return round(p_quantidade, 3);
end $$;
revoke all on function public.tin_reescalar(uuid, numeric) from public, anon;
grant execute on function public.tin_reescalar(uuid, numeric) to authenticated;
revoke all on function public.tin_pesar(uuid, uuid, uuid, numeric, uuid, text, boolean), public.tin_estornar_pesagem(uuid, text) from public, anon;
grant execute on function public.tin_pesar(uuid, uuid, uuid, numeric, uuid, text, boolean), public.tin_estornar_pesagem(uuid, text) to authenticated;

-- 9) aprovar a tinta: todos os itens pesados, última medição dentro (ou concessão de quem aprova); vira lote no estoque
create or replace function public.tin_aprovar_ordem(p_ordem uuid, p_concessao text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o tin_ordens; c tin_cores; qp tin_parametros; md tin_medicoes; v_falta int; v_qtd numeric; v_cus numeric; v_cod text; v_lote uuid; t uuid; v_prod uuid; v_fam uuid;
begin
  select * into o from tin_ordens where id = p_ordem for update;
  if o.id is null or not pode_tintas(o.empresa_id) then raise exception 'Sem permissão.'; end if;
  if o.situacao not in ('em_pesagem', 'em_ajuste') then raise exception 'Ordem % em %: nada a aprovar.', o.numero, o.situacao; end if;
  select count(*) into v_falta from tin_itens it where it.versao_id = o.versao_id
     and not exists (select 1 from tin_pesagens p where p.ordem_id = o.id and p.item_id = it.id and p.situacao = 'pesada');
  if v_falta > 0 then raise exception 'Faltam % item(ns) da receita para pesar.', v_falta; end if;
  -- item abaixo do previsto além da tolerância (pela quantidade atual da ordem)
  select count(*) into v_falta from tin_itens it join tin_versoes vv on vv.id = it.versao_id where it.versao_id = o.versao_id
     and (select coalesce(sum(p.pesada), 0) from tin_pesagens p where p.ordem_id = o.id and p.item_id = it.id and p.situacao = 'pesada')
         < it.quantidade * o.quantidade / vv.base_kg * (1 - coalesce(it.tolerancia_pct, (select tolerancia_pct from tin_parametros where empresa_id = o.empresa_id), 2) / 100) - 0.0001;
  if v_falta > 0 and nullif(trim(coalesce(p_concessao, '')), '') is null then raise exception '% item(ns) abaixo do previsto: complete a pesagem ou aprove com concessão.', v_falta; end if;
  select * into md from tin_medicoes where ordem_id = o.id order by criado_em desc, id desc limit 1;
  if (md.id is null or not md.ok) then
    if nullif(trim(coalesce(p_concessao, '')), '') is null then raise exception 'A última medição está fora do padrão (ou não há medição): meça de novo ou aprove com concessão.'; end if;
    if not tin_pode_aprovar(o.empresa_id) then raise exception 'Concessão só por quem aprova receitas.'; end if;
  end if;
  select * into qp from tin_parametros where empresa_id = o.empresa_id;
  select * into c from tin_cores where id = o.cor_id;
  select coalesce(sum(pesada), 0), coalesce(sum(custo), 0) into v_qtd, v_cus from tin_pesagens where ordem_id = o.id and situacao = 'pesada';
  v_cod := 'T' || to_char(current_date, 'YYMM') || '-' || lpad(o.numero::text, 4, '0');
  if _tin_estoque(o.empresa_id) and qp.local_tinta_id is not null then
    v_prod := c.produto_id;
    if v_prod is null and coalesce(qp.criar_produto, true) then
      select id into v_fam from est_familias where empresa_id = o.empresa_id and codigo = 'TINTA';
      insert into produtos(empresa_id, codigo, descricao, tipo, unidade, familia_id, local_padrao_id, controla_lote, ativo)
      values (o.empresa_id, 'TP-' || c.codigo, left('TINTA PRONTA ' || c.nome, 120), 'tinta_solvente', 'KG', v_fam, qp.local_tinta_id, true, true)
      on conflict do nothing returning id into v_prod;
      if v_prod is null then select id into v_prod from produtos where empresa_id = o.empresa_id and codigo = 'TP-' || c.codigo; end if;
      update tin_cores set produto_id = v_prod where id = c.id;
    end if;
    if v_prod is not null then
      select id into t from est_tipos_movimento where empresa_id = o.empresa_id and codigo = 'PROD' and ativo;
      if t is null then raise exception 'Tipo de movimento PROD não configurado no estoque.'; end if;
      insert into est_lotes(empresa_id, produto_id, codigo, fabricacao, validade, origem)
      values (o.empresa_id, v_prod, v_cod, current_date, current_date + coalesce(qp.validade_dias, 30), 'producao')
      on conflict (empresa_id, produto_id, codigo) do update set validade = excluded.validade returning id into v_lote;
      insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, documento, observacao)
      values (o.empresa_id, current_date, v_prod, qp.local_tinta_id, v_lote, t, v_qtd, case when v_qtd > 0 then v_cus / v_qtd end, 'Tinta ' || o.numero, 'Tinta pronta ' || c.codigo);
    end if;
  end if;
  perform set_config('tin.aprovando', 'on', true);
  update tin_ordens set situacao = 'aprovada', lote_id = v_lote, lote_codigo = v_cod, quantidade_real = v_qtd, custo_total = round(v_cus, 2),
         custo_kg = case when v_qtd > 0 then round(v_cus / v_qtd, 4) end, validade = current_date + coalesce(qp.validade_dias, 30),
         concessao = nullif(trim(coalesce(p_concessao, '')), ''), aprovada_por = auth.jwt() ->> 'email', aprovada_em = now()
   where id = o.id;
  perform set_config('tin.aprovando', 'off', true);
  return jsonb_build_object('lote', v_cod, 'quantidade', v_qtd, 'custo_kg', case when v_qtd > 0 then round(v_cus / v_qtd, 4) end, 'estoque', v_lote is not null);
end $$;
revoke all on function public.tin_aprovar_ordem(uuid, text) from public, anon;
grant execute on function public.tin_aprovar_ordem(uuid, text) to authenticated;

-- 10) entregar à máquina e retorno da sobra (transferências do lote, quando há estoque)
create or replace function public.tin_movimentar(p_ordem uuid, p_tipo text, p_qtd numeric, p_local uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare o tin_ordens; qp tin_parametros; c tin_cores; v_dest uuid; v_saldo numeric;
begin
  select * into o from tin_ordens where id = p_ordem for update;
  if o.id is null or not pode_tintas(o.empresa_id) then raise exception 'Sem permissão.'; end if;
  if coalesce(p_qtd, 0) <= 0 then raise exception 'Quantidade inválida.'; end if;
  if p_tipo not in ('entrega', 'retorno') then raise exception 'Tipo inválido.'; end if;
  if p_tipo = 'entrega' and o.situacao not in ('aprovada', 'entregue') then raise exception 'Só se entrega tinta aprovada.'; end if;
  if p_tipo = 'retorno' and o.situacao not in ('entregue') then raise exception 'Só volta tinta que foi entregue.'; end if;
  if p_tipo = 'entrega' and o.entregue_kg - o.retorno_kg + p_qtd > coalesce(o.quantidade_real, o.quantidade) + 0.001 then
    raise exception 'Entrega maior que a tinta disponível do lote.'; end if;
  if p_tipo = 'retorno' and p_qtd > o.entregue_kg - o.retorno_kg + 0.001 then raise exception 'Retorno maior que o entregue.'; end if;
  select * into qp from tin_parametros where empresa_id = o.empresa_id;
  select * into c from tin_cores where id = o.cor_id;
  if o.lote_id is not null and _tin_estoque(o.empresa_id) then
    v_dest := coalesce(p_local, qp.local_maquina_id);
    if v_dest is null then raise exception 'Defina nos parâmetros o local "em processo" da impressão.'; end if;
    if p_tipo = 'entrega' then
      perform est_transferir(o.empresa_id, current_date, c.produto_id, qp.local_tinta_id, v_dest, p_qtd, o.lote_id, null, 'Tinta ' || o.numero || ' entregue à máquina');
    else
      select coalesce(sum(quantidade), 0) into v_saldo from est_saldos where produto_id = c.produto_id and local_id = v_dest and lote_id = o.lote_id;
      if v_saldo + 0.001 < p_qtd then raise exception 'O local da máquina tem % kg deste lote (o resto já foi consumido na OP).', v_saldo; end if;
      perform est_transferir(o.empresa_id, current_date, c.produto_id, v_dest, qp.local_tinta_id, p_qtd, o.lote_id, null, 'Sobra da tinta ' || o.numero);
    end if;
  end if;
  perform set_config('tin.aprovando', 'on', true);
  update tin_ordens set entregue_kg = entregue_kg + case when p_tipo = 'entrega' then p_qtd else 0 end,
         retorno_kg = retorno_kg + case when p_tipo = 'retorno' then p_qtd else 0 end, situacao = 'entregue' where id = o.id;
  perform set_config('tin.aprovando', 'off', true);
  return p_tipo;
end $$;
revoke all on function public.tin_movimentar(uuid, text, numeric, uuid) from public, anon;
grant execute on function public.tin_movimentar(uuid, text, numeric, uuid) to authenticated;

-- 11) configuração inicial: local Casa de tintas, parâmetros e sistemas de partida
create or replace function public.tin_configurar(p_empresa uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_tin uuid; v_ins uuid; v_maq uuid; v_n int := 0;
begin
  if not pode_pcp(p_empresa) then raise exception 'Só administrador, financeiro ou diretor configura a casa de tintas.'; end if;
  insert into est_locais(empresa_id, codigo, nome, finalidade, ordem) values (p_empresa, 'TIN', 'Casa de tintas (tinta pronta e sobras)', 'processo', 40)
  on conflict (empresa_id, codigo) do update set nome = est_locais.nome returning id into v_tin;
  select id into v_ins from est_locais where empresa_id = p_empresa and codigo = 'INS';
  select l.id into v_maq from est_locais l left join prod_setores s on s.id = l.setor_id
   where l.empresa_id = p_empresa and l.finalidade = 'processo' and l.codigo <> 'TIN'
     and (semacento_lower(s.nome) like '%impress%' or semacento_lower(l.nome || ' ' || l.codigo) like '%imp%') order by l.ordem limit 1;
  insert into tin_parametros(empresa_id, local_tinta_id, local_insumos_id, local_maquina_id) values (p_empresa, v_tin, v_ins, v_maq)
  on conflict (empresa_id) do update set local_tinta_id = coalesce(tin_parametros.local_tinta_id, excluded.local_tinta_id),
    local_insumos_id = coalesce(tin_parametros.local_insumos_id, excluded.local_insumos_id), local_maquina_id = coalesce(tin_parametros.local_maquina_id, excluded.local_maquina_id);
  insert into tin_sistemas(empresa_id, nome, descricao)
  select p_empresa, x.n, x.d from (values ('Solvente — nitrocelulose', 'Flexografia de superfície em PE'), ('Solvente — poliuretano', 'Laminação e verso'),
    ('Base água', 'Papel e aplicações de baixo odor'), ('UV', 'Cura por ultravioleta')) x(n, d)
  on conflict (empresa_id, nome) do nothing;
  get diagnostics v_n = row_count;
  return jsonb_build_object('local_tinta', v_tin, 'local_maquina', v_maq, 'sistemas', v_n);
end $$;
revoke all on function public.tin_configurar(uuid) from public, anon;
grant execute on function public.tin_configurar(uuid) to authenticated;
revoke all on function public._tin_estoque(uuid), public._tin_itens_del() from public, anon, authenticated;

-- 12) auditoria
do $$ declare t text; begin
  if to_regprocedure('public._auditar()') is not null then
    foreach t in array array['tin_parametros', 'tin_cores', 'tin_receitas', 'tin_versoes', 'tin_itens', 'tin_ordens', 'tin_pesagens'] loop
      execute format('drop trigger if exists zz_auditoria on public.%s', t);
      execute format('create trigger zz_auditoria after insert or update or delete on public.%s for each row execute function public._auditar()', t);
    end loop;
  end if;
end $$;

-- conferência: tabelas = 9, funções = 10
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'tin\_%') as tabelas,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in
         ('pode_tintas', 'tin_pode_aprovar', 'tin_aprovar_versao', 'tin_nova_versao', 'tin_pesar', 'tin_estornar_pesagem', 'tin_reescalar', 'tin_aprovar_ordem', 'tin_movimentar', 'tin_configurar')) as funcoes;
