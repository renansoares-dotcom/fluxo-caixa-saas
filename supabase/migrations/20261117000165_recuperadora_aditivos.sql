-- 165 — Recuperadora: receita do grão e aditivos (17/11/2026, pedido do Renan para um cliente reciclador)
-- O grão pode levar aditivos e outros itens (masterbatch, antioxidante, deslizante, carga mineral, resina virgem).
-- * Receita por grão: itens com a dosagem em % sobre o material reciclado que entra na ordem. É uma sugestão:
--   a dosagem varia de lote para lote, então a ordem guarda o previsto e o que foi de fato usado.
-- * Produto que controla lote sai de um lote só: o mais antigo que cobre a quantidade (ou o de maior saldo).
-- * Na conclusão, os itens saem do Kardex (parâmetro), entram no custo do grão e no peso de entrada da ordem
--   (peso_entrada = reciclado + aditivos), para o rendimento e o balanço de massa não passarem de 100%.
-- * Tudo fica desligado até ligar "Usar receita e aditivos" nos Parâmetros da Recuperadora.
-- Aditivo. Nada muda para quem não liga o parâmetro.

alter table public.rec_config add column if not exists usar_aditivos boolean not null default false;
alter table public.rec_config add column if not exists aditivo_baixar_estoque boolean not null default true;      -- os itens saem do Kardex ao concluir a ordem
alter table public.rec_config add column if not exists aditivo_local_id uuid references public.est_locais(id) on delete set null;  -- vazio = local padrão de cada produto
alter table public.rec_config add column if not exists aditivo_desvio_pct numeric(5,2) not null default 20 check (aditivo_desvio_pct between 0 and 100);  -- desvio aceito entre o usado e o previsto pela receita

create table if not exists public.rec_receitas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  material_id uuid not null references public.rec_materiais(id) on delete cascade,     -- o grão que sai
  nome text not null check (length(trim(nome)) > 0),
  padrao boolean not null default false,                                               -- a que a ordem sugere primeiro
  ativo boolean not null default true,
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  unique (empresa_id, material_id, nome)
);
create index if not exists rec_receitas_m on public.rec_receitas(material_id);

create table if not exists public.rec_receita_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  receita_id uuid not null references public.rec_receitas(id) on delete cascade,
  produto_id uuid not null references public.produtos(id),
  tipo text not null default 'aditivo' check (tipo in ('aditivo', 'pigmento', 'carga', 'resina_virgem', 'outro')),
  dosagem_pct numeric(7,3) not null check (dosagem_pct > 0 and dosagem_pct <= 100),    -- % sobre o material reciclado que entra na ordem
  observacao text,
  unique (receita_id, produto_id)
);
create index if not exists rec_receita_itens_r on public.rec_receita_itens(receita_id);

create table if not exists public.rec_ordem_aditivos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem_id uuid not null references public.rec_ordens(id) on delete cascade,
  produto_id uuid not null references public.produtos(id),
  tipo text not null default 'aditivo' check (tipo in ('aditivo', 'pigmento', 'carga', 'resina_virgem', 'outro')),
  kg numeric(14,3) not null check (kg >= 0),                                           -- o que foi de fato usado
  kg_previsto numeric(14,3) check (kg_previsto is null or kg_previsto >= 0),           -- o que a receita pedia
  custo_unitario numeric(20,10), custo numeric(16,2),                                  -- gravados na conclusão (custo médio do Kardex)
  est_movimento_id uuid references public.est_movimentos(id) on delete set null,
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  unique (ordem_id, produto_id)
);
create index if not exists rec_ordem_aditivos_o on public.rec_ordem_aditivos(ordem_id);

alter table public.rec_ordens add column if not exists receita_id uuid references public.rec_receitas(id) on delete set null;
alter table public.rec_ordens add column if not exists peso_aditivos numeric(14,3);
alter table public.rec_ordens add column if not exists custo_aditivos numeric(16,2);

-- ---------- segurança ----------
do $$ declare t text; begin
  foreach t in array array['rec_receitas', 'rec_receita_itens', 'rec_ordem_aditivos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.ve_producao(empresa_id))', t || '_sel', t);
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
  foreach t in array array['rec_receitas', 'rec_receita_itens'] loop   -- cadastros: quem planeja
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.pode_pcp(empresa_id))', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.pode_pcp(empresa_id)) with check (public.pode_pcp(empresa_id))', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.pode_pcp(empresa_id))', t || '_del', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
-- aditivos da ordem: quem aponta, enquanto a ordem está aberta (como as etapas)
drop policy if exists rec_ordem_aditivos_ins on public.rec_ordem_aditivos;
create policy rec_ordem_aditivos_ins on public.rec_ordem_aditivos for insert to authenticated with check (public.pode_apontar(empresa_id) and exists (select 1 from rec_ordens o where o.id = ordem_id and o.empresa_id = rec_ordem_aditivos.empresa_id and o.situacao = 'aberta'));
drop policy if exists rec_ordem_aditivos_upd on public.rec_ordem_aditivos;
create policy rec_ordem_aditivos_upd on public.rec_ordem_aditivos for update to authenticated using (public.pode_apontar(empresa_id) and exists (select 1 from rec_ordens o where o.id = ordem_id and o.situacao = 'aberta'))
  with check (public.pode_apontar(empresa_id) and exists (select 1 from rec_ordens o where o.id = ordem_id and o.empresa_id = rec_ordem_aditivos.empresa_id and o.situacao = 'aberta'));
drop policy if exists rec_ordem_aditivos_del on public.rec_ordem_aditivos;
create policy rec_ordem_aditivos_del on public.rec_ordem_aditivos for delete to authenticated using (public.pode_apontar(empresa_id) and exists (select 1 from rec_ordens o where o.id = ordem_id and o.situacao = 'aberta'));
grant select, insert, update, delete on public.rec_ordem_aditivos to authenticated;

-- vínculos da mesma empresa; uma receita padrão por grão; custo e movimento só pela conclusão
create or replace function public._rec_receita_antes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select empresa_id from rec_materiais where id = new.material_id) is distinct from new.empresa_id then raise exception 'Material de outra empresa'; end if;
  new.nome := trim(new.nome);
  if new.padrao then update rec_receitas set padrao = false where empresa_id = new.empresa_id and material_id = new.material_id and id <> new.id and padrao; end if;
  return new;
end $$;
drop trigger if exists rec_receita_antes on public.rec_receitas;
create trigger rec_receita_antes before insert or update on public.rec_receitas for each row execute function public._rec_receita_antes();

create or replace function public._rec_receita_item_antes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select empresa_id from rec_receitas where id = new.receita_id) is distinct from new.empresa_id
     or (select empresa_id from produtos where id = new.produto_id) is distinct from new.empresa_id then raise exception 'Receita ou produto de outra empresa'; end if;
  return new;
end $$;
drop trigger if exists rec_receita_item_antes on public.rec_receita_itens;
create trigger rec_receita_item_antes before insert or update on public.rec_receita_itens for each row execute function public._rec_receita_item_antes();

create or replace function public._rec_aditivo_antes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select empresa_id from rec_ordens where id = new.ordem_id) is distinct from new.empresa_id
     or (select empresa_id from produtos where id = new.produto_id) is distinct from new.empresa_id then raise exception 'Ordem ou produto de outra empresa'; end if;
  if auth.uid() is not null and current_setting('app.rec_conclusao', true) is distinct from 'sim' then   -- pela tela não se grava custo nem movimento
    if tg_op = 'INSERT' then new.custo_unitario := null; new.custo := null; new.est_movimento_id := null;
    else new.custo_unitario := old.custo_unitario; new.custo := old.custo; new.est_movimento_id := old.est_movimento_id; new.ordem_id := old.ordem_id; end if;
  end if;
  return new;
end $$;
drop trigger if exists rec_aditivo_antes on public.rec_ordem_aditivos;
create trigger rec_aditivo_antes before insert or update on public.rec_ordem_aditivos for each row execute function public._rec_aditivo_antes();

-- ---------- aplicar a receita na ordem: kg previsto = material reciclado que entrou × dosagem ----------
create or replace function public.rec_ordem_aplicar_receita(p_ordem uuid, p_receita uuid) returns int
language plpgsql security definer set search_path = public as $$
declare o rec_ordens; r rec_receitas; v_ent numeric; n int;
begin
  select * into o from rec_ordens where id = p_ordem for update;
  if o.id is null or not public.pode_apontar(o.empresa_id) then raise exception 'Acesso negado.'; end if;
  if o.situacao <> 'aberta' then raise exception 'A ordem não está aberta.'; end if;
  select * into r from rec_receitas where id = p_receita;
  if r.id is null or r.empresa_id <> o.empresa_id then raise exception 'Receita não encontrada.'; end if;
  select coalesce(sum(kg), 0) into v_ent from rec_ordem_entradas where ordem_id = o.id;
  if v_ent <= 0 then raise exception 'Inclua primeiro os lotes que entram: a receita é calculada sobre o peso deles.'; end if;
  delete from rec_ordem_aditivos where ordem_id = o.id;
  insert into rec_ordem_aditivos(empresa_id, ordem_id, produto_id, tipo, kg, kg_previsto)
  select o.empresa_id, o.id, i.produto_id, i.tipo, round(v_ent * i.dosagem_pct / 100, 3), round(v_ent * i.dosagem_pct / 100, 3) from rec_receita_itens i where i.receita_id = r.id;
  get diagnostics n = row_count;
  update rec_ordens set receita_id = r.id where id = o.id;
  return n;
end $$;

-- ---------- concluir (substitui a versão do SQL 152): soma os aditivos ao peso e ao custo e dá baixa no Kardex ----------
create or replace function public.rec_ordem_concluir(p_ordem uuid, p_kg_saida numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o rec_ordens; cfg rec_config; v_ent numeric; v_mat numeric; v_proc numeric; v_lote uuid; v_cod text; n int := 1; v_prod uuid; v_local uuid; v_tipo uuid; v_mov uuid; v_adt numeric := 0; v_cadt numeric := 0; a record; v_lote_est uuid; v_cu numeric; v_tot numeric;
begin
  select * into o from rec_ordens where id = p_ordem for update;
  if o.id is null or not public.pode_apontar(o.empresa_id) then raise exception 'Acesso negado.'; end if;
  if o.situacao <> 'aberta' then raise exception 'A ordem não está aberta.'; end if;
  select * into cfg from rec_config where empresa_id = o.empresa_id;
  perform set_config('app.rec_conclusao', 'sim', true);
  select sum(kg), sum(custo) into v_ent, v_mat from rec_ordem_entradas where ordem_id = o.id;
  if coalesce(v_ent, 0) <= 0 then raise exception 'Informe os lotes que entraram na ordem.'; end if;
  if coalesce(p_kg_saida, 0) <= 0 then raise exception 'Informe o peso de grão produzido.'; end if;
  -- aditivos e demais itens da receita: entram no peso e no custo; saem do Kardex (parâmetro)
  if cfg.usar_aditivos then
    v_tipo := (select id from est_tipos_movimento where empresa_id = o.empresa_id and codigo = 'REQPROD');
    for a in select d.*, p.codigo pcod, p.controla_lote, p.local_padrao_id from rec_ordem_aditivos d join produtos p on p.id = d.produto_id where d.ordem_id = o.id and d.kg > 0 order by d.criado_em loop
      v_mov := null;
      v_cu := coalesce((select case when c.quantidade > 0 then c.valor / c.quantidade else c.custo_medio end from est_custos c where c.produto_id = a.produto_id), 0);
      if cfg.aditivo_baixar_estoque then
        v_local := coalesce(cfg.aditivo_local_id, a.local_padrao_id);
        if v_local is null or v_tipo is null then raise exception 'Defina o local de onde saem os aditivos (Parâmetros da Recuperadora) ou o local padrão do produto %.', a.pcod; end if;
        v_lote_est := null;
        if a.controla_lote then
          v_lote_est := (select s.lote_id from est_saldos s join est_lotes el on el.id = s.lote_id where s.produto_id = a.produto_id and s.local_id = v_local and not el.bloqueado and s.quantidade > 0 order by (s.quantidade >= a.kg) desc, s.ultimo_movimento, s.quantidade desc limit 1);
          if v_lote_est is null then raise exception 'O produto % controla lote e não tem lote liberado com saldo no local dos aditivos.', a.pcod; end if;
        end if;
        insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, documento, observacao)
        values (o.empresa_id, o.data, a.produto_id, v_local, v_lote_est, v_tipo, -a.kg, 'Reprocesso ' || o.numero, 'Recuperadora — aditivo da ordem ' || o.numero)
        returning id, custo_unitario into v_mov, v_cu;
      end if;
      update rec_ordem_aditivos set custo_unitario = coalesce(v_cu, 0), custo = round(a.kg * coalesce(v_cu, 0), 2), est_movimento_id = v_mov where id = a.id;
      v_adt := v_adt + a.kg; v_cadt := v_cadt + round(a.kg * coalesce(v_cu, 0), 2);
    end loop;
  end if;
  if p_kg_saida > (v_ent + v_adt) * 1.02 then raise exception 'Saíram % kg e entraram % kg: confira os pesos.', p_kg_saida, v_ent + v_adt; end if;
  v_proc := public._rec_custo_processo(o.id);
  v_tot := coalesce(v_mat, 0) + v_cadt + v_proc;
  v_cod := cfg.prefixo_grao || '-' || to_char(o.data, 'YYMMDD') || '-' || o.numero;
  while exists (select 1 from rec_lotes where empresa_id = o.empresa_id and codigo = v_cod) loop n := n + 1; v_cod := cfg.prefixo_grao || '-' || to_char(o.data, 'YYMMDD') || '-' || o.numero || '-' || n; end loop;
  insert into rec_lotes(empresa_id, codigo, tipo, material_id, data, peso_kg, saldo_kg, custo_total, situacao)
  values (o.empresa_id, v_cod, 'grao', o.material_saida_id, o.data, p_kg_saida, p_kg_saida, v_tot, case when cfg.exigir_ensaio then 'bloqueado' else 'disponivel' end)
  returning id into v_lote;
  -- lotes de entrada que ficaram "em processo" por esta ordem passam a consumidos se zeraram
  update rec_lotes l set situacao = 'consumido' where l.id in (select lote_id from rec_ordem_entradas where ordem_id = o.id) and l.saldo_kg <= 0.0005;
  update rec_lotes l set situacao = 'disponivel' where l.id in (select lote_id from rec_ordem_entradas where ordem_id = o.id) and l.saldo_kg > 0.0005 and l.situacao = 'em_processo'
     and not exists (select 1 from rec_ordem_entradas x join rec_ordens y on y.id = x.ordem_id where x.lote_id = l.id and y.situacao = 'aberta' and y.id <> o.id);
  -- Kardex: grão com produto ligado entra como produção
  v_prod := (select produto_id from rec_materiais where id = o.material_saida_id);
  if cfg.integrar_estoque and v_prod is not null then
    v_local := coalesce(cfg.est_local_id, (select id from est_locais where empresa_id = o.empresa_id and codigo = 'APA'));
    v_tipo := (select id from est_tipos_movimento where empresa_id = o.empresa_id and codigo = 'PROD');
    if v_local is not null and v_tipo is not null then
      insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario, documento, observacao)
      values (o.empresa_id, o.data, v_prod, v_local, v_tipo, p_kg_saida, round(v_tot / p_kg_saida, 10), 'Reprocesso ' || o.numero, 'Recuperadora — lote ' || v_cod)
      returning id into v_mov;
      update rec_lotes set est_movimento_id = v_mov where id = v_lote;
    end if;
  end if;
  update rec_ordens set situacao = 'concluida', peso_entrada = v_ent + v_adt, peso_saida = p_kg_saida, custo_material = coalesce(v_mat, 0), custo_processo = v_proc,
    peso_aditivos = v_adt, custo_aditivos = v_cadt, custo_total = v_tot, lote_saida_id = v_lote, concluida_em = now(), concluida_por = auth.uid() where id = o.id;
  return jsonb_build_object('lote', v_cod, 'lote_id', v_lote, 'entrada', v_ent + v_adt, 'aditivos', v_adt, 'custo_aditivos', v_cadt, 'saida', p_kg_saida, 'rendimento', round(p_kg_saida / (v_ent + v_adt), 4),
    'custo_total', v_tot, 'custo_kg', round(v_tot / p_kg_saida, 4), 'bloqueado', cfg.exigir_ensaio);
end $$;

-- ---------- rendimento (substitui a versão do SQL 152): custo dos aditivos separado do material e do processo ----------
create or replace function public.rec_rendimento(p_empresa uuid, p_de date, p_ate date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; cfg rec_config;
begin
  if not public.ve_producao(p_empresa) then raise exception 'Acesso negado.'; end if;
  select * into cfg from rec_config where empresa_id = p_empresa;
  with ord as (
    select o.*, o.peso_saida / nullif(o.peso_entrada, 0) rend, m.polimero, m.codigo mcod, m.nome mnome
      from rec_ordens o join rec_materiais m on m.id = o.material_saida_id
     where o.empresa_id = p_empresa and o.situacao = 'concluida' and o.data between p_de and p_ate
  ), ent as (
    select e.*, l.tipo ltipo, l.material_id lmat, l.fornecedor_id, l.custo_total lcusto, l.peso_kg lpeso, ord.rend, ord.id oid,
           (select i.valor from rec_ticket_itens i where i.id = l.ticket_item_id) * e.kg / nullif(l.peso_kg, 0) pago,
           (select i.peso_kg from rec_ticket_itens i where i.id = l.ticket_item_id) * e.kg / nullif(l.peso_kg, 0) pesado
      from rec_ordem_entradas e join ord on ord.id = e.ordem_id join rec_lotes l on l.id = e.lote_id
  ), virg as (
    select polimero, (select preco_kg from rec_resina_virgem r where r.empresa_id = p_empresa and r.polimero = x.polimero and r.vigencia <= p_ate order by vigencia desc limit 1) preco
      from (select distinct polimero from ord) x
  ), perdas as (
    select sum(perda_umidade) umidade, sum(perda_sujeira) sujeira, sum(perda_finos) finos, sum(perda_rejeito) rejeito
      from rec_ordem_etapas t where t.ordem_id in (select id from ord)
  )
  select jsonb_build_object(
    'meta_pct', coalesce(cfg.meta_rendimento_pct, 85),
    'total', (select jsonb_build_object('ordens', count(*), 'entrada', coalesce(sum(peso_entrada), 0), 'saida', coalesce(sum(peso_saida), 0),
                'rendimento', round(sum(peso_saida) / nullif(sum(peso_entrada), 0), 4), 'custo_material', coalesce(sum(custo_material), 0), 'custo_processo', coalesce(sum(custo_processo), 0), 'custo_aditivos', coalesce(sum(custo_aditivos), 0), 'aditivos', coalesce(sum(peso_aditivos), 0),
                'custo_kg', round(sum(custo_total) / nullif(sum(peso_saida), 0), 4)) from ord),
    'perdas', (select to_jsonb(p) from perdas p),
    'grao', coalesce((select jsonb_agg(jsonb_build_object('material', mcod || ' — ' || mnome, 'polimero', g.polimero, 'ordens', g.n, 'entrada', g.ent, 'saida', g.sai, 'rendimento', round(g.sai / nullif(g.ent, 0), 4),
                'custo_material_kg', round(g.cm / nullif(g.sai, 0), 4), 'custo_processo_kg', round(g.cp / nullif(g.sai, 0), 4), 'custo_aditivos_kg', round(g.ca / nullif(g.sai, 0), 4), 'aditivos', g.adt, 'custo_kg', round((g.cm + g.cp + g.ca) / nullif(g.sai, 0), 4),
                'virgem_kg', vg.preco, 'economia', case when vg.preco is not null then round((vg.preco - (g.cm + g.cp + g.ca) / nullif(g.sai, 0)) * g.sai, 2) end) order by g.sai desc)
               from (select mcod, mnome, polimero, count(*) n, sum(peso_entrada) ent, sum(peso_saida) sai, sum(custo_material) cm, sum(custo_processo) cp, coalesce(sum(custo_aditivos), 0) ca, coalesce(sum(peso_aditivos), 0) adt from ord group by mcod, mnome, polimero) g
               left join virg vg on vg.polimero = g.polimero), '[]'),
    'fornecedores', coalesce((select jsonb_agg(jsonb_build_object('fornecedor_id', f.id, 'fornecedor', coalesce(f.nome, 'Aparas internas'), 'rec_tipo', f.rec_tipo, 'pesado', round(z.pesado, 3), 'consumido', round(z.kg, 3),
                'grao', round(z.grao, 3), 'rendimento', round(z.grao / nullif(z.kg, 0), 4), 'rendimento_pesado', round(z.grao / nullif(z.pesado, 0), 4), 'pago', round(z.pago, 2),
                'custo_grao_kg', round(z.pago / nullif(z.grao, 0), 4), 'preco_pago_kg', round(z.pago / nullif(z.pesado, 0), 4)) order by z.kg desc)
               from (select fornecedor_id, sum(kg) kg, sum(kg * rend) grao, sum(coalesce(pago, custo)) pago, sum(coalesce(pesado, kg)) pesado from ent group by fornecedor_id) z
               left join favorecidos f on f.id = z.fornecedor_id), '[]'),
    'materiais', coalesce((select jsonb_agg(jsonb_build_object('material', m.codigo || ' — ' || m.nome, 'tipo', z.ltipo, 'consumido', round(z.kg, 3), 'grao', round(z.grao, 3), 'rendimento', round(z.grao / nullif(z.kg, 0), 4)) order by z.kg desc)
               from (select lmat, ltipo, sum(kg) kg, sum(kg * rend) grao from ent group by lmat, ltipo) z join rec_materiais m on m.id = z.lmat), '[]'),
    'ordens', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'numero', numero, 'data', data, 'material', mcod, 'entrada', peso_entrada, 'saida', peso_saida, 'rendimento', round(rend, 4),
                'custo_kg', round(custo_total / nullif(peso_saida, 0), 4)) order by data desc, numero desc) from ord), '[]')
  ) into v;
  return v;
end $$;

-- ---------- resumo dos aditivos no período: por tipo, por item e as ordens fora do desvio aceito ----------
create or replace function public.rec_aditivos_resumo(p_empresa uuid, p_de date, p_ate date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg rec_config; v jsonb;
begin
  if not public.ve_producao(p_empresa) then raise exception 'Acesso negado.'; end if;
  select * into cfg from rec_config where empresa_id = p_empresa;
  with ord as (select * from rec_ordens where empresa_id = p_empresa and situacao = 'concluida' and data between p_de and p_ate),
  ad as (select d.*, o.numero, o.data, p.codigo pcod, p.descricao pnome from rec_ordem_aditivos d join ord o on o.id = d.ordem_id join produtos p on p.id = d.produto_id where d.kg > 0 or coalesce(d.kg_previsto, 0) > 0)
  select jsonb_build_object(
    'desvio_pct', coalesce(cfg.aditivo_desvio_pct, 20),
    'total', (select jsonb_build_object('ordens', count(*) filter (where coalesce(peso_aditivos, 0) > 0), 'kg', coalesce(sum(peso_aditivos), 0), 'custo', coalesce(sum(custo_aditivos), 0),
                'entrada', coalesce(sum(peso_entrada), 0), 'reciclado', coalesce(sum(peso_entrada - coalesce(peso_aditivos, 0)), 0),
                'reciclado_pct', round(100 * sum(peso_entrada - coalesce(peso_aditivos, 0)) / nullif(sum(peso_entrada), 0), 2)) from ord),
    'tipos', coalesce((select jsonb_agg(jsonb_build_object('tipo', tipo, 'kg', kg, 'custo', custo) order by kg desc) from (select tipo, sum(kg) kg, coalesce(sum(custo), 0) custo from ad group by tipo) z), '[]'),
    'itens', coalesce((select jsonb_agg(jsonb_build_object('produto', pcod || ' — ' || pnome, 'tipo', tipo, 'kg', kg, 'previsto', previsto, 'custo', custo, 'custo_kg', round(custo / nullif(kg, 0), 4), 'ordens', n) order by kg desc)
               from (select pcod, pnome, tipo, sum(kg) kg, sum(kg_previsto) previsto, coalesce(sum(custo), 0) custo, count(*) n from ad group by pcod, pnome, tipo) z), '[]'),
    'desvios', coalesce((select jsonb_agg(jsonb_build_object('ordem_id', ordem_id, 'numero', numero, 'data', data, 'produto', pcod || ' — ' || pnome, 'kg', kg, 'previsto', kg_previsto,
                 'desvio_pct', round(100 * (kg - kg_previsto) / kg_previsto, 1)) order by data desc, numero desc)
               from ad where kg_previsto > 0 and abs(kg - kg_previsto) / kg_previsto * 100 > coalesce(cfg.aditivo_desvio_pct, 20)), '[]')
  ) into v;
  return v;
end $$;

revoke all on function public._rec_receita_antes(), public._rec_receita_item_antes(), public._rec_aditivo_antes() from public, anon, authenticated;
revoke all on function public.rec_ordem_aplicar_receita(uuid, uuid), public.rec_aditivos_resumo(uuid, date, date) from public, anon;
grant execute on function public.rec_ordem_aplicar_receita(uuid, uuid), public.rec_aditivos_resumo(uuid, date, date) to authenticated;
