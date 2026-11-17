-- 166 — Recuperadora: separação por densidade (17/11/2026, pedido do Renan para um cliente reciclador)
-- No tanque de lavagem, parte do material afunda ou flutua e sai como OUTRO material (ex.: PET no meio do PEBD).
-- * Na ordem de reprocesso, cada separação informa o material, a fração (flutuou, afundou) e os kg.
-- * Na conclusão, cada separação vira um lote próprio (tipo "separado"), disponível para outra ordem ou para venda.
--   O que foi separado deixa a ordem: peso_entrada = reciclado − separado + aditivos; o custo do material vai
--   junto pelo peso (parâmetro) ou fica todo no grão.
-- * No rendimento por fornecedor, o separado conta contra quem entregou o material misturado.
-- * O balanço de massa do material passa a somar os lotes separados e a tirar as saídas diretas de lote que não é grão.
-- Desligado até marcar "Usar separação por densidade" nos Parâmetros da Recuperadora. Aditivo.

alter table public.rec_config add column if not exists usar_separacao boolean not null default false;
alter table public.rec_config add column if not exists separacao_custo text not null default 'peso' check (separacao_custo in ('peso', 'zero'));   -- o lote separado leva o custo pelo peso, ou nasce sem custo
alter table public.rec_config add column if not exists prefixo_separado text not null default 'SP' check (length(prefixo_separado) between 1 and 6);

alter table public.rec_lotes drop constraint if exists rec_lotes_tipo_check;
alter table public.rec_lotes add constraint rec_lotes_tipo_check check (tipo in ('entrada', 'apara', 'grao', 'separado'));

create table if not exists public.rec_ordem_separacoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ordem_id uuid not null references public.rec_ordens(id) on delete cascade,
  material_id uuid not null references public.rec_materiais(id),
  fracao text not null default 'afundou' check (fracao in ('flutuou', 'afundou', 'outro')),
  kg numeric(14,3) not null check (kg > 0),
  custo numeric(16,2),                                                  -- gravados na conclusão
  lote_id uuid references public.rec_lotes(id) on delete set null,
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists rec_ordem_separacoes_o on public.rec_ordem_separacoes(ordem_id);
alter table public.rec_ordens add column if not exists peso_separado numeric(14,3);

alter table public.rec_ordem_separacoes enable row level security;
drop policy if exists rec_ordem_separacoes_sel on public.rec_ordem_separacoes;
create policy rec_ordem_separacoes_sel on public.rec_ordem_separacoes for select to authenticated using (public.ve_producao(empresa_id));
drop policy if exists rec_ordem_separacoes_ins on public.rec_ordem_separacoes;
create policy rec_ordem_separacoes_ins on public.rec_ordem_separacoes for insert to authenticated with check (public.pode_apontar(empresa_id) and exists (select 1 from rec_ordens o where o.id = ordem_id and o.empresa_id = rec_ordem_separacoes.empresa_id and o.situacao = 'aberta'));
drop policy if exists rec_ordem_separacoes_upd on public.rec_ordem_separacoes;
create policy rec_ordem_separacoes_upd on public.rec_ordem_separacoes for update to authenticated using (public.pode_apontar(empresa_id) and exists (select 1 from rec_ordens o where o.id = ordem_id and o.situacao = 'aberta'))
  with check (public.pode_apontar(empresa_id) and exists (select 1 from rec_ordens o where o.id = ordem_id and o.empresa_id = rec_ordem_separacoes.empresa_id and o.situacao = 'aberta'));
drop policy if exists rec_ordem_separacoes_del on public.rec_ordem_separacoes;
create policy rec_ordem_separacoes_del on public.rec_ordem_separacoes for delete to authenticated using (public.pode_apontar(empresa_id) and exists (select 1 from rec_ordens o where o.id = ordem_id and o.situacao = 'aberta'));
grant select, insert, update, delete on public.rec_ordem_separacoes to authenticated;
drop trigger if exists zz_auditoria on public.rec_ordem_separacoes;
create trigger zz_auditoria after insert or update or delete on public.rec_ordem_separacoes for each row execute function public._auditar();

create or replace function public._rec_separacao_antes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select empresa_id from rec_ordens where id = new.ordem_id) is distinct from new.empresa_id
     or (select empresa_id from rec_materiais where id = new.material_id) is distinct from new.empresa_id then raise exception 'Ordem ou material de outra empresa'; end if;
  if (select material_saida_id from rec_ordens where id = new.ordem_id) = new.material_id then raise exception 'O material separado não pode ser o grão que a ordem produz.'; end if;
  if auth.uid() is not null and current_setting('app.rec_conclusao', true) is distinct from 'sim' then   -- pela tela não se grava custo nem lote
    if tg_op = 'INSERT' then new.custo := null; new.lote_id := null; else new.custo := old.custo; new.lote_id := old.lote_id; new.ordem_id := old.ordem_id; end if;
  end if;
  return new;
end $$;
drop trigger if exists rec_separacao_antes on public.rec_ordem_separacoes;
create trigger rec_separacao_antes before insert or update on public.rec_ordem_separacoes for each row execute function public._rec_separacao_antes();
revoke all on function public._rec_separacao_antes() from public, anon, authenticated;

-- ---------- concluir (substitui a versão do SQL 165): cria os lotes separados e tira o peso e o custo deles da ordem ----------
create or replace function public.rec_ordem_concluir(p_ordem uuid, p_kg_saida numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o rec_ordens; cfg rec_config; v_ent numeric; v_mat numeric; v_proc numeric; v_lote uuid; v_cod text; n int := 1; v_prod uuid; v_local uuid; v_tipo uuid; v_mov uuid; v_adt numeric := 0; v_cadt numeric := 0; a record; v_lote_est uuid; v_cu numeric; v_tot numeric; v_sep numeric := 0; v_csep numeric := 0; sp record; v_cs numeric; v_cods text; ns int := 0;
begin
  select * into o from rec_ordens where id = p_ordem for update;
  if o.id is null or not public.pode_apontar(o.empresa_id) then raise exception 'Acesso negado.'; end if;
  if o.situacao <> 'aberta' then raise exception 'A ordem não está aberta.'; end if;
  select * into cfg from rec_config where empresa_id = o.empresa_id;
  perform set_config('app.rec_conclusao', 'sim', true);
  select sum(kg), sum(custo) into v_ent, v_mat from rec_ordem_entradas where ordem_id = o.id;
  if coalesce(v_ent, 0) <= 0 then raise exception 'Informe os lotes que entraram na ordem.'; end if;
  if coalesce(p_kg_saida, 0) <= 0 then raise exception 'Informe o peso de grão produzido.'; end if;
  -- separação por densidade: o que saiu no tanque como outro material vira lote próprio e deixa a ordem (peso e custo)
  if cfg.usar_separacao then
    select coalesce(sum(kg), 0) into v_sep from rec_ordem_separacoes where ordem_id = o.id;
    if v_sep >= v_ent then raise exception 'A separação (% kg) não pode ser igual ou maior que o material que entrou (% kg).', v_sep, v_ent; end if;
    for sp in select * from rec_ordem_separacoes where ordem_id = o.id and kg > 0 order by criado_em loop
      ns := ns + 1;
      v_cs := case when cfg.separacao_custo = 'peso' then round(sp.kg * coalesce(v_mat, 0) / v_ent, 2) else 0 end;
      v_cods := cfg.prefixo_separado || '-' || to_char(o.data, 'YYMMDD') || '-' || o.numero || '-' || ns;
      while exists (select 1 from rec_lotes where empresa_id = o.empresa_id and codigo = v_cods) loop ns := ns + 1; v_cods := cfg.prefixo_separado || '-' || to_char(o.data, 'YYMMDD') || '-' || o.numero || '-' || ns; end loop;
      insert into rec_lotes(empresa_id, codigo, tipo, material_id, data, peso_kg, saldo_kg, custo_total, situacao, observacao)
      values (o.empresa_id, v_cods, 'separado', sp.material_id, o.data, sp.kg, sp.kg, v_cs, 'disponivel', 'Separado por densidade na ordem ' || o.numero || case sp.fracao when 'flutuou' then ' (flutuou)' when 'afundou' then ' (afundou)' else '' end)
      returning id into v_lote;
      update rec_ordem_separacoes set lote_id = v_lote, custo = v_cs where id = sp.id;
      v_csep := v_csep + v_cs;
    end loop;
    v_mat := coalesce(v_mat, 0) - v_csep; v_lote := null;
  end if;
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
  if p_kg_saida > (v_ent - v_sep + v_adt) * 1.02 then raise exception 'Saíram % kg e entraram % kg: confira os pesos.', p_kg_saida, v_ent - v_sep + v_adt; end if;
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
  update rec_ordens set situacao = 'concluida', peso_entrada = v_ent - v_sep + v_adt, peso_separado = v_sep, peso_saida = p_kg_saida, custo_material = coalesce(v_mat, 0), custo_processo = v_proc,
    peso_aditivos = v_adt, custo_aditivos = v_cadt, custo_total = v_tot, lote_saida_id = v_lote, concluida_em = now(), concluida_por = auth.uid() where id = o.id;
  return jsonb_build_object('lote', v_cod, 'lote_id', v_lote, 'entrada', v_ent - v_sep + v_adt, 'separado', v_sep, 'lotes_separados', ns, 'aditivos', v_adt, 'custo_aditivos', v_cadt, 'saida', p_kg_saida, 'rendimento', round(p_kg_saida / (v_ent - v_sep + v_adt), 4),
    'custo_total', v_tot, 'custo_kg', round(v_tot / p_kg_saida, 4), 'bloqueado', cfg.exigir_ensaio);
end $$;

-- ---------- rendimento (substitui a versão do SQL 165): o separado conta contra o fornecedor do material misturado ----------
create or replace function public.rec_rendimento(p_empresa uuid, p_de date, p_ate date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb; cfg rec_config;
begin
  if not public.ve_producao(p_empresa) then raise exception 'Acesso negado.'; end if;
  select * into cfg from rec_config where empresa_id = p_empresa;
  with ord as (
    select o.*, o.peso_saida / nullif(o.peso_entrada, 0) rend, o.peso_saida / nullif(o.peso_entrada + coalesce(o.peso_separado, 0), 0) rend_bruto, m.polimero, m.codigo mcod, m.nome mnome
      from rec_ordens o join rec_materiais m on m.id = o.material_saida_id
     where o.empresa_id = p_empresa and o.situacao = 'concluida' and o.data between p_de and p_ate
  ), ent as (
    select e.*, l.tipo ltipo, l.material_id lmat, l.fornecedor_id, l.custo_total lcusto, l.peso_kg lpeso, ord.rend_bruto rend, ord.id oid,
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
                'rendimento', round(sum(peso_saida) / nullif(sum(peso_entrada), 0), 4), 'custo_material', coalesce(sum(custo_material), 0), 'custo_processo', coalesce(sum(custo_processo), 0), 'custo_aditivos', coalesce(sum(custo_aditivos), 0), 'aditivos', coalesce(sum(peso_aditivos), 0), 'separado', coalesce(sum(peso_separado), 0),
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

-- ---------- balanço de massa (substitui a versão do SQL 153): lotes separados entram no material; saída direta de lote que não é grão sai ----------
create or replace function public.rec_balanco(p_empresa uuid, p_mes date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_ini date := date_trunc('month', p_mes)::date; v_fim date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date; cfg rec_config; v jsonb;
  pesado numeric; pago numeric; aparas numeric; outras numeric; consumido numeric; produzido numeric; entrada_ord numeric; perdas jsonb; saidas jsonb; residuos jsonb; rej_apont numeric; rej_dest numeric;
  separados numeric; saidas_mat numeric; ei_m numeric; ef_m numeric; ei_g numeric; ef_g numeric; perda_ord numeric; perda_apont numeric;
begin
  if not public.ve_producao(p_empresa) then raise exception 'Acesso negado.'; end if;
  select * into cfg from rec_config where empresa_id = p_empresa;
  select coalesce(sum(i.peso_kg) filter (where t.origem = 'compra'), 0), coalesce(sum(i.peso_pago) filter (where t.origem = 'compra'), 0), coalesce(sum(i.peso_pago) filter (where t.origem <> 'compra'), 0)
    into pesado, pago, outras
    from rec_tickets t join rec_ticket_itens i on i.ticket_id = t.id
   where t.empresa_id = p_empresa and t.situacao = 'fechado' and (t.data_hora at time zone 'America/Sao_Paulo')::date between v_ini and v_fim;
  select coalesce(sum(peso_kg), 0) into aparas from rec_lotes where empresa_id = p_empresa and tipo = 'apara' and data between v_ini and v_fim and situacao <> 'cancelado';
  select coalesce(sum(peso_kg), 0) into separados from rec_lotes where empresa_id = p_empresa and tipo = 'separado' and data between v_ini and v_fim and situacao <> 'cancelado';
  select coalesce(sum(s.kg), 0) into saidas_mat from rec_lote_saidas s join rec_lotes l on l.id = s.lote_id where s.empresa_id = p_empresa and l.tipo <> 'grao' and s.data between v_ini and v_fim;
  select coalesce(sum(e.kg), 0) into consumido from rec_ordem_entradas e join rec_ordens o on o.id = e.ordem_id
   where e.empresa_id = p_empresa and o.situacao <> 'cancelada' and (e.criado_em at time zone 'America/Sao_Paulo')::date between v_ini and v_fim;
  select coalesce(sum(peso_saida), 0), coalesce(sum(peso_entrada), 0) into produzido, entrada_ord from rec_ordens where empresa_id = p_empresa and situacao = 'concluida' and data between v_ini and v_fim;
  select jsonb_build_object('umidade', coalesce(sum(t.perda_umidade), 0), 'sujeira', coalesce(sum(t.perda_sujeira), 0), 'finos', coalesce(sum(t.perda_finos), 0), 'rejeito', coalesce(sum(t.perda_rejeito), 0)),
         coalesce(sum(t.perda_umidade + t.perda_sujeira + t.perda_finos + t.perda_rejeito), 0), coalesce(sum(t.perda_rejeito), 0)
    into perdas, perda_apont, rej_apont
    from rec_ordem_etapas t join rec_ordens o on o.id = t.ordem_id where o.empresa_id = p_empresa and o.situacao = 'concluida' and o.data between v_ini and v_fim;
  perda_ord := entrada_ord - produzido;
  select coalesce(jsonb_object_agg(destino, kg), '{}') into saidas from (select s.destino, sum(s.kg) kg from rec_lote_saidas s join rec_lotes l on l.id = s.lote_id
    where s.empresa_id = p_empresa and l.tipo = 'grao' and s.data between v_ini and v_fim group by 1) z;
  select coalesce(sum(kg), 0) into rej_dest from rec_residuos where empresa_id = p_empresa and data between v_ini and v_fim;
  select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'kg', kg, 'com_cdf', com_cdf, 'sem_cdf', sem_cdf)), '[]') into residuos
    from (select tipo, sum(kg) kg, sum(kg) filter (where cdf_numero is not null) com_cdf, sum(kg) filter (where cdf_numero is null) sem_cdf
            from rec_residuos where empresa_id = p_empresa and data between v_ini and v_fim group by tipo) z;
  ei_m := public._rec_estoque_em(p_empresa, v_ini, false); ef_m := public._rec_estoque_em(p_empresa, v_fim + 1, false);
  ei_g := public._rec_estoque_em(p_empresa, v_ini, true);  ef_g := public._rec_estoque_em(p_empresa, v_fim + 1, true);
  v := jsonb_build_object('mes', v_ini, 'tolerancia_pct', coalesce(cfg.balanco_tolerancia_pct, 2),
    'material', jsonb_build_object('estoque_inicial', ei_m, 'pesado', pesado, 'desconto', pesado - pago, 'comprado', pago, 'aparas', aparas, 'outras', outras, 'separados', separados, 'saidas', saidas_mat, 'consumido', consumido, 'estoque_final', ef_m),
    'processo', jsonb_build_object('entrada', entrada_ord, 'produzido', produzido, 'perda', perda_ord, 'perda_apontada', perda_apont, 'nao_explicada', perda_ord - perda_apont,
                                   'nao_explicada_pct', round(100 * (perda_ord - perda_apont) / nullif(entrada_ord, 0), 2), 'rendimento', round(produzido / nullif(entrada_ord, 0), 4), 'perdas', perdas),
    'grao', jsonb_build_object('estoque_inicial', ei_g, 'produzido', produzido, 'saidas', saidas, 'estoque_final', ef_g),
    'residuos', jsonb_build_object('rejeito_apontado', rej_apont, 'destinado', rej_dest, 'por_tipo', residuos,
                                   'sem_cdf', coalesce((select sum(kg) from rec_residuos where empresa_id = p_empresa and cdf_numero is null and data <= v_fim), 0)));
  return v;
end $$;
