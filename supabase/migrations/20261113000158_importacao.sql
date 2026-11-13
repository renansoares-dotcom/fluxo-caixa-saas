-- Importação de Matéria-Prima (Compras e Estoque › Importação, CMP005). Pedido do Renan em 13/11/2026.
-- Processo de importação com etapas (do pedido ao recebimento), itens com NCM e alíquotas, câmbio (adiantamento e saldo em moeda
-- estrangeira, contratação e liquidação), despesas e impostos da nacionalização, custo final por item (landed cost), documentos,
-- títulos no financeiro e entrada no estoque com o custo apurado. Cotações PTAX guardadas para a exposição cambial.
-- Aditivo: só cria objetos novos.

-- ---------------------------------------------------------------- parâmetros por empresa
create table if not exists public.imp_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  papeis text[] not null default array['financeiro', 'diretor', 'compras'],          -- além do administrador
  moeda_padrao text not null default 'USD' check (moeda_padrao ~ '^[A-Z]{3}$'),
  rateio text not null default 'valor' check (rateio in ('valor', 'peso')),           -- como as despesas vão para os itens
  recupera_icms boolean not null default true,                                       -- imposto recuperável não entra no custo
  recupera_ipi boolean not null default true,
  recupera_pis_cofins boolean not null default true,
  gerar_titulos boolean not null default true,                                       -- câmbio e despesas viram títulos no financeiro
  plano_mercadoria_id uuid references public.plano_contas(id) on delete set null,
  plano_impostos_id uuid references public.plano_contas(id) on delete set null,
  plano_despesas_id uuid references public.plano_contas(id) on delete set null,
  plano_bancarias_id uuid references public.plano_contas(id) on delete set null,
  centro_custo_id uuid references public.centros_custo(id) on delete set null,
  local_id uuid references public.est_locais(id) on delete set null,                 -- local de entrada no estoque (vazio = o do produto)
  tipo_movimento_id uuid references public.est_tipos_movimento(id) on delete set null,
  free_time_padrao smallint not null default 14 check (free_time_padrao between 0 and 120),
  dias_aviso_chegada smallint not null default 7 check (dias_aviso_chegada between 0 and 60),
  dias_aviso_cambio smallint not null default 5 check (dias_aviso_cambio between 0 and 60),
  dias_aviso_freetime smallint not null default 3 check (dias_aviso_freetime between 0 and 30),
  avisar boolean not null default true,
  atualizado_em timestamptz not null default now()
);

create or replace function public.imp_pode(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros m where m.empresa_id = p_empresa and m.user_id = auth.uid()
    and (m.papel::text = 'admin' or m.papel::text = any(coalesce((select papeis from imp_config where empresa_id = p_empresa), array['financeiro', 'diretor', 'compras']))));
$$;
grant execute on function public.imp_pode(uuid) to authenticated;

-- ---------------------------------------------------------------- processo
create table if not exists public.imp_processos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null default 0,
  referencia text,                                              -- referência do exportador / pedido
  favorecido_id uuid not null references public.favorecidos(id),  -- exportador
  pais_origem text,
  incoterm text not null default 'FOB' check (incoterm in ('EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP')),
  moeda text not null default 'USD' check (moeda ~ '^[A-Z]{3}$'),
  taxa_prevista numeric(12,6) check (taxa_prevista is null or taxa_prevista > 0),
  taxa_di numeric(12,6) check (taxa_di is null or taxa_di > 0),  -- câmbio usado no registro da declaração
  modal text not null default 'maritimo' check (modal in ('maritimo', 'aereo', 'rodoviario')),
  local_embarque text, local_destino text,
  status text not null default 'negociacao' check (status in ('negociacao', 'pedido', 'producao', 'embarcado', 'chegada', 'registro', 'desembaracado', 'recebido', 'encerrado', 'cancelado')),
  data_pedido date, embarque_previsto date, data_embarque date, chegada_prevista date, data_chegada date,
  data_registro date, data_desembaraco date, data_recebimento date, data_encerramento date,
  proforma text, invoice text, conhecimento text,              -- nº da proforma, da fatura comercial e do BL / AWB / CRT
  navio text, containers text,
  declaracao text,                                              -- nº da DI ou da DUIMP
  canal text check (canal in ('verde', 'amarelo', 'vermelho', 'cinza')),
  despachante_id uuid references public.favorecidos(id) on delete set null,
  agente_id uuid references public.favorecidos(id) on delete set null,
  free_time_dias smallint check (free_time_dias is null or free_time_dias between 0 and 120),
  data_devolucao_container date,
  peso_liquido numeric(16,3), peso_bruto numeric(16,3),
  rateio text check (rateio in ('valor', 'peso')),              -- vazio = o dos parâmetros
  estimativa jsonb not null default '{}'::jsonb,                -- premissas do custo estimado (frete, seguro, despesas previstas)
  pedido_id uuid references public.compras_pedidos(id) on delete set null,
  nfe_nota_id uuid references public.nfe_notas(id) on delete set null,   -- nota fiscal de entrada da importação
  observacao text, motivo_cancelamento text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists imp_proc_emp on public.imp_processos(empresa_id, status);

create table if not exists public.imp_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  processo_id uuid not null references public.imp_processos(id) on delete cascade,
  produto_id uuid references public.produtos(id) on delete set null,
  descricao text not null,
  ncm text, unidade text not null default 'KG',
  quantidade numeric(16,4) not null check (quantidade > 0),
  valor_unitario numeric(18,6) not null default 0 check (valor_unitario >= 0),   -- na moeda do processo
  peso_liquido numeric(16,3),
  aliq_ii numeric(7,4) not null default 0, aliq_ipi numeric(7,4) not null default 0, aliq_pis numeric(7,4) not null default 0,
  aliq_cofins numeric(7,4) not null default 0, aliq_icms numeric(7,4) not null default 0,
  lote text,
  qtd_recebida numeric(16,4) not null default 0,
  custo_unitario numeric(20,10),                                -- custo final por unidade gravado no recebimento
  ordem int not null default 0
);
create index if not exists imp_itens_proc on public.imp_itens(processo_id);

-- ---------------------------------------------------------------- câmbio: o que se paga ao exportador
create table if not exists public.imp_cambios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  processo_id uuid not null references public.imp_processos(id) on delete cascade,
  tipo text not null default 'saldo' check (tipo in ('adiantamento', 'parcela', 'saldo')),
  valor_moeda numeric(16,2) not null check (valor_moeda > 0),
  vencimento date not null,
  status text not null default 'previsto' check (status in ('previsto', 'contratado', 'liquidado')),
  contrato text, banco text,
  data_contratacao date,
  taxa numeric(12,6) check (taxa is null or taxa > 0),          -- taxa contratada
  data_liquidacao date,
  valor_brl numeric(16,2) check (valor_brl is null or valor_brl >= 0),
  conta_id uuid references public.contas(id) on delete set null,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  check (status = 'previsto' or (taxa is not null and data_contratacao is not null)),
  check (status <> 'liquidado' or data_liquidacao is not null)
);
create index if not exists imp_cambios_proc on public.imp_cambios(processo_id);
create index if not exists imp_cambios_venc on public.imp_cambios(empresa_id, status, vencimento);

-- ---------------------------------------------------------------- despesas e impostos da nacionalização (em reais)
create table if not exists public.imp_despesas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  processo_id uuid not null references public.imp_processos(id) on delete cascade,
  item_id uuid references public.imp_itens(id) on delete set null,   -- despesa de um item só (vazio = rateada)
  categoria text not null check (categoria in ('ii', 'ipi', 'pis', 'cofins', 'icms', 'siscomex', 'afrmm', 'frete_internacional', 'seguro', 'capatazia',
                                               'armazenagem', 'despachante', 'frete_interno', 'demurrage', 'bancaria', 'multa', 'outras')),
  descricao text,
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  documento text,
  valor numeric(16,2) not null check (valor >= 0),
  valor_moeda numeric(16,2), taxa numeric(12,6),                 -- quando a despesa nasce em moeda estrangeira (frete, seguro)
  vencimento date not null default current_date,
  pago boolean not null default false,
  data_pagamento date,
  conta_id uuid references public.contas(id) on delete set null,
  compoe_custo boolean not null default true,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  check (not pago or data_pagamento is not null)
);
create index if not exists imp_despesas_proc on public.imp_despesas(processo_id);

create table if not exists public.imp_eventos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  processo_id uuid not null references public.imp_processos(id) on delete cascade,
  etapa text not null, data date not null default current_date,
  texto text,
  por uuid default auth.uid(), em timestamptz not null default now()
);
create index if not exists imp_eventos_proc on public.imp_eventos(processo_id, em);

create table if not exists public.imp_anexos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  processo_id uuid not null references public.imp_processos(id) on delete cascade,
  tipo text not null default 'outro' check (tipo in ('proforma', 'invoice', 'packing', 'conhecimento', 'origem', 'declaracao', 'comprovante', 'cambio', 'nota', 'laudo', 'outro')),
  nome text not null, caminho text not null, tamanho int,
  por uuid default auth.uid(), em timestamptz not null default now()
);
create index if not exists imp_anexos_proc on public.imp_anexos(processo_id);

-- cotações (PTAX do Banco Central ou digitadas): servem à exposição cambial e à taxa prevista
create table if not exists public.imp_ptax (
  moeda text not null check (moeda ~ '^[A-Z]{3}$'),
  data date not null,
  compra numeric(12,6), venda numeric(12,6) not null check (venda > 0),
  fonte text not null default 'manual',
  atualizado_em timestamptz not null default now(),
  primary key (moeda, data)
);

-- ---------------------------------------------------------------- acesso
do $$ declare t text; begin
  foreach t in array array['imp_processos', 'imp_itens', 'imp_cambios', 'imp_despesas', 'imp_eventos', 'imp_anexos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_membro(empresa_id) or public.imp_pode(empresa_id))', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.imp_pode(empresa_id))', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.imp_pode(empresa_id)) with check (public.imp_pode(empresa_id))', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.imp_pode(empresa_id))', t || '_del', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    if t <> 'imp_eventos' then execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t); end if;
  end loop;
end $$;
alter table public.imp_config enable row level security;
drop policy if exists imp_config_sel on public.imp_config;
create policy imp_config_sel on public.imp_config for select to authenticated using (public.is_membro(empresa_id) or public.imp_pode(empresa_id));
drop policy if exists imp_config_ins on public.imp_config;
create policy imp_config_ins on public.imp_config for insert to authenticated with check (public.is_admin(empresa_id));
drop policy if exists imp_config_upd on public.imp_config;
create policy imp_config_upd on public.imp_config for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
grant select, insert, update on public.imp_config to authenticated;
drop trigger if exists zz_auditoria on public.imp_config;
create trigger zz_auditoria after insert or update or delete on public.imp_config for each row execute function public._auditar();
alter table public.imp_ptax enable row level security;
drop policy if exists imp_ptax_sel on public.imp_ptax;
create policy imp_ptax_sel on public.imp_ptax for select to authenticated using (true);
grant select on public.imp_ptax to authenticated;

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('importacao', 'Compras e Estoque', 'Importação: etapas, câmbio e prazos', 'Mudança de etapa do processo de importação, câmbio a vencer, chegada atrasada e prazo de devolução do contêiner.', false, 61)
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------- regras do processo: número, datas da etapa, histórico e aviso
create or replace function public._imp_processo() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cfg imp_config;
begin
  if tg_op = 'INSERT' then
    if coalesce(new.numero, 0) = 0 then
      perform pg_advisory_xact_lock(hashtext('imp_processos'), hashtext(new.empresa_id::text));
      select coalesce(max(numero), 0) + 1 into new.numero from imp_processos where empresa_id = new.empresa_id;
    end if;
    select * into v_cfg from imp_config where empresa_id = new.empresa_id;
    if new.free_time_dias is null and new.modal = 'maritimo' then new.free_time_dias := coalesce(v_cfg.free_time_padrao, 14); end if;
  else
    if new.empresa_id <> old.empresa_id or new.numero <> old.numero then raise exception 'Empresa e número do processo não mudam.'; end if;
    if old.status in ('encerrado', 'cancelado') and new.status = old.status and auth.uid() is not null then raise exception 'Processo % não pode ser alterado: reabra antes.', old.status; end if;
  end if;
  if not exists (select 1 from favorecidos where id = new.favorecido_id and empresa_id = new.empresa_id) then raise exception 'Exportador inválido para esta empresa.'; end if;
  if new.status = 'cancelado' and coalesce(btrim(new.motivo_cancelamento), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    -- cada etapa tem a sua data: quem avança sem informar grava hoje
    case new.status
      when 'pedido' then new.data_pedido := coalesce(new.data_pedido, current_date);
      when 'embarcado' then new.data_embarque := coalesce(new.data_embarque, current_date);
      when 'chegada' then new.data_chegada := coalesce(new.data_chegada, current_date);
      when 'registro' then new.data_registro := coalesce(new.data_registro, current_date);
      when 'desembaracado' then new.data_desembaraco := coalesce(new.data_desembaraco, current_date);
      when 'recebido' then new.data_recebimento := coalesce(new.data_recebimento, current_date);
      when 'encerrado' then new.data_encerramento := coalesce(new.data_encerramento, current_date);
      else null;
    end case;
  end if;
  -- prazo de devolução do contêiner: chegada + dias livres
  if new.data_chegada is not null and new.free_time_dias is not null and (tg_op = 'INSERT' or new.data_chegada is distinct from old.data_chegada or new.free_time_dias is distinct from old.free_time_dias) then
    new.data_devolucao_container := coalesce(case when tg_op = 'UPDATE' and new.data_devolucao_container is distinct from old.data_devolucao_container then new.data_devolucao_container end,
                                             new.data_chegada + new.free_time_dias);
  end if;
  new.atualizado_em := now();
  return new;
end $$;
drop trigger if exists imp_processo_regras on public.imp_processos;
create trigger imp_processo_regras before insert or update on public.imp_processos for each row execute function public._imp_processo();

create or replace function public._imp_processo_evento() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_nomes jsonb := '{"negociacao":"Em negociação","pedido":"Pedido confirmado","producao":"Em produção no exportador","embarcado":"Embarcado","chegada":"Chegou ao porto","registro":"Declaração registrada","desembaracado":"Desembaraçado","recebido":"Recebido na fábrica","encerrado":"Encerrado","cancelado":"Cancelado"}';
  v_data date; v_users uuid[]; v_cfg imp_config; v_forn text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return null; end if;
  v_data := case new.status when 'pedido' then new.data_pedido when 'embarcado' then new.data_embarque when 'chegada' then new.data_chegada when 'registro' then new.data_registro
                 when 'desembaracado' then new.data_desembaraco when 'recebido' then new.data_recebimento when 'encerrado' then new.data_encerramento else current_date end;
  insert into imp_eventos(empresa_id, processo_id, etapa, data, texto)
  values (new.empresa_id, new.id, new.status, coalesce(v_data, current_date), case when new.status = 'cancelado' then new.motivo_cancelamento end);
  if tg_op = 'INSERT' then return null; end if;
  select * into v_cfg from imp_config where empresa_id = new.empresa_id;
  if coalesce(v_cfg.avisar, true) then
    select array_agg(m.user_id) into v_users from membros m where m.empresa_id = new.empresa_id and m.user_id is distinct from auth.uid()
       and (m.papel::text = 'admin' or m.papel::text = any(coalesce(v_cfg.papeis, array['financeiro', 'diretor', 'compras'])));
    select nome into v_forn from favorecidos where id = new.favorecido_id;
    if v_users is not null then
      perform _notificar(new.empresa_id, v_users, 'importacao', format('Importação %s: %s', new.numero, v_nomes ->> new.status),
        left(format('%s%s', v_forn, case when new.referencia is not null then ' · ' || new.referencia else '' end), 200), 'compras/importacao?p=' || new.id, new.id);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists imp_processo_evento on public.imp_processos;
create trigger imp_processo_evento after insert or update on public.imp_processos for each row execute function public._imp_processo_evento();

-- exclusão: só processo sem pagamento e sem recebimento (o que já andou é cancelado, não apagado)
create or replace function public._imp_processo_del() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from imp_cambios where processo_id = old.id and status = 'liquidado') or exists (select 1 from imp_despesas where processo_id = old.id and pago)
     or exists (select 1 from imp_itens where processo_id = old.id and qtd_recebida > 0) then
    raise exception 'O processo % já tem pagamento ou recebimento: cancele em vez de excluir.', old.numero;
  end if;
  return old;
end $$;
drop trigger if exists imp_processo_del on public.imp_processos;
create trigger imp_processo_del before delete on public.imp_processos for each row execute function public._imp_processo_del();

-- filhos: mesma empresa do processo e processo aberto
create or replace function public._imp_filho() returns trigger
language plpgsql security definer set search_path = public as $$
declare p imp_processos; r record;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  select * into p from imp_processos where id = r.processo_id;
  if p.id is null then return r; end if;                                   -- exclusão em cascata do processo
  if tg_op <> 'DELETE' and new.empresa_id <> p.empresa_id then raise exception 'O registro precisa ser da mesma empresa do processo.'; end if;
  if p.status in ('encerrado', 'cancelado') and auth.uid() is not null then raise exception 'O processo % está %: reabra antes de alterar.', p.numero, p.status; end if;
  return r;
end $$;
do $$ declare t text; begin
  foreach t in array array['imp_itens', 'imp_cambios', 'imp_despesas'] loop
    execute format('drop trigger if exists imp_filho on public.%I', t);
    execute format('create trigger imp_filho before insert or update or delete on public.%I for each row execute function public._imp_filho()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- títulos no financeiro (câmbio e despesas)
-- a taxa que vale para a previsão: a contratada, a do processo ou a última cotação conhecida
create or replace function public._imp_taxa(p_processo uuid, p_taxa numeric default null) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(p_taxa, p.taxa_di, p.taxa_prevista, (select venda from imp_ptax x where x.moeda = p.moeda order by data desc limit 1))
    from imp_processos p where p.id = p_processo
$$;
revoke all on function public._imp_taxa(uuid, numeric) from public, anon, authenticated;

create or replace function public._imp_titulo_cambio() returns trigger
language plpgsql security definer set search_path = public as $$
declare p imp_processos; c imp_config; v_valor numeric; v_desc text; v_forn text; l lancamentos;
begin
  if tg_op = 'DELETE' then
    if old.lancamento_id is not null then
      select * into l from lancamentos where id = old.lancamento_id;
      if l.status = 'Pago' and old.status = 'liquidado' and auth.uid() is not null and exists (select 1 from imp_processos where id = old.processo_id) then
        raise exception 'Este câmbio já foi liquidado: volte a situação para contratado antes de excluir.'; end if;
    end if;
    return old;
  end if;
  select * into p from imp_processos where id = new.processo_id;
  select * into c from imp_config where empresa_id = new.empresa_id;
  if new.conta_id is not null and not exists (select 1 from contas where id = new.conta_id and empresa_id = new.empresa_id) then raise exception 'Conta bancária inválida para esta empresa.'; end if;
  if new.status = 'liquidado' and new.valor_brl is null then new.valor_brl := round(new.valor_moeda * new.taxa, 2); end if;
  if not coalesce(c.gerar_titulos, true) or c.plano_mercadoria_id is null then return new; end if;
  v_valor := coalesce(case when new.status = 'liquidado' then new.valor_brl end, round(new.valor_moeda * _imp_taxa(new.processo_id, new.taxa), 2));
  if v_valor is null then return new; end if;                              -- sem nenhuma taxa conhecida ainda
  select nome into v_forn from favorecidos where id = p.favorecido_id;
  v_desc := left(format('IMP %s — %s — câmbio %s %s %s', p.numero, v_forn, new.tipo, p.moeda, to_char(new.valor_moeda, 'FM999G999G990D00')), 250);
  if new.lancamento_id is not null then select * into l from lancamentos where id = new.lancamento_id; end if;
  if l.id is null then
    insert into lancamentos (empresa_id, data, plano_id, descricao, favorecido_id, centro_custo_id, status, conta_id, valor, origem, documento)
    values (new.empresa_id, case when new.status = 'liquidado' then new.data_liquidacao else new.vencimento end, c.plano_mercadoria_id, v_desc, p.favorecido_id, c.centro_custo_id,
            case when new.status = 'liquidado' then 'Pago' else 'Em aberto' end, case when new.status = 'liquidado' then new.conta_id end, v_valor, 'importacao', coalesce(new.contrato, 'IMP ' || p.numero))
    returning id into new.lancamento_id;
  elsif new.status = 'liquidado' then
    update lancamentos set data = new.data_liquidacao, status = 'Pago', conta_id = coalesce(new.conta_id, conta_id), valor = v_valor, descricao = v_desc, documento = coalesce(new.contrato, documento) where id = l.id;
  elsif tg_op = 'UPDATE' and old.status = 'liquidado' then                 -- liquidação desfeita: o título volta a ficar em aberto
    update lancamentos set data = new.vencimento, status = 'Em aberto', conta_id = null, valor = v_valor, descricao = v_desc where id = l.id;
  elsif l.status = 'Em aberto' then
    update lancamentos set data = new.vencimento, valor = v_valor, descricao = v_desc, documento = coalesce(new.contrato, documento) where id = l.id;
  end if;                                                                  -- título baixado direto no financeiro: fica como está
  return new;
end $$;
drop trigger if exists imp_titulo_cambio on public.imp_cambios;
create trigger imp_titulo_cambio before insert or update or delete on public.imp_cambios for each row execute function public._imp_titulo_cambio();

create or replace function public._imp_titulo_despesa() returns trigger
language plpgsql security definer set search_path = public as $$
declare p imp_processos; c imp_config; v_plano uuid; v_desc text; l lancamentos;
  v_nomes jsonb := '{"ii":"Imposto de Importação","ipi":"IPI","pis":"PIS","cofins":"COFINS","icms":"ICMS","siscomex":"Taxa Siscomex","afrmm":"AFRMM","frete_internacional":"Frete internacional","seguro":"Seguro","capatazia":"Capatazia","armazenagem":"Armazenagem","despachante":"Despachante","frete_interno":"Frete interno","demurrage":"Demurrage","bancaria":"Despesa bancária","multa":"Multa","outras":"Outras despesas"}';
begin
  if tg_op = 'DELETE' then
    if old.lancamento_id is not null then
      if old.pago and auth.uid() is not null and exists (select 1 from imp_processos where id = old.processo_id) then raise exception 'Despesa já paga: desmarque o pagamento antes de excluir.'; end if;
    end if;
    return old;
  end if;
  select * into p from imp_processos where id = new.processo_id;
  select * into c from imp_config where empresa_id = new.empresa_id;
  if new.conta_id is not null and not exists (select 1 from contas where id = new.conta_id and empresa_id = new.empresa_id) then raise exception 'Conta bancária inválida para esta empresa.'; end if;
  if new.item_id is not null and not exists (select 1 from imp_itens where id = new.item_id and processo_id = new.processo_id) then raise exception 'O item não é deste processo.'; end if;
  if tg_op = 'INSERT' and new.compoe_custo then                             -- imposto recuperável nasce fora do custo (pode ser mudado depois)
    if (new.categoria = 'icms' and coalesce(c.recupera_icms, true)) or (new.categoria = 'ipi' and coalesce(c.recupera_ipi, true))
       or (new.categoria in ('pis', 'cofins') and coalesce(c.recupera_pis_cofins, true)) or new.categoria in ('bancaria', 'multa', 'demurrage') then
      new.compoe_custo := false;
    end if;
  end if;
  v_plano := case when new.categoria in ('ii', 'ipi', 'pis', 'cofins', 'icms', 'siscomex', 'afrmm') then coalesce(c.plano_impostos_id, c.plano_despesas_id)
                  when new.categoria = 'bancaria' then coalesce(c.plano_bancarias_id, c.plano_despesas_id) else c.plano_despesas_id end;
  if not coalesce(c.gerar_titulos, true) or v_plano is null or new.valor = 0 then return new; end if;
  v_desc := left(format('IMP %s — %s%s', p.numero, v_nomes ->> new.categoria, case when coalesce(new.descricao, '') <> '' then ' — ' || new.descricao else '' end), 250);
  if new.lancamento_id is not null then select * into l from lancamentos where id = new.lancamento_id; end if;
  if l.id is null then
    insert into lancamentos (empresa_id, data, plano_id, descricao, favorecido_id, centro_custo_id, status, conta_id, valor, origem, documento)
    values (new.empresa_id, case when new.pago then new.data_pagamento else new.vencimento end, v_plano, v_desc, new.favorecido_id, c.centro_custo_id,
            case when new.pago then 'Pago' else 'Em aberto' end, case when new.pago then new.conta_id end, new.valor, 'importacao', coalesce(new.documento, 'IMP ' || p.numero))
    returning id into new.lancamento_id;
  elsif new.pago then
    update lancamentos set data = new.data_pagamento, status = 'Pago', conta_id = coalesce(new.conta_id, conta_id), valor = new.valor, descricao = v_desc, favorecido_id = new.favorecido_id where id = l.id;
  elsif tg_op = 'UPDATE' and old.pago then
    update lancamentos set data = new.vencimento, status = 'Em aberto', conta_id = null, valor = new.valor, descricao = v_desc, favorecido_id = new.favorecido_id where id = l.id;
  elsif l.status = 'Em aberto' then
    update lancamentos set data = new.vencimento, valor = new.valor, descricao = v_desc, favorecido_id = new.favorecido_id where id = l.id;
  end if;
  return new;
end $$;
drop trigger if exists imp_titulo_despesa on public.imp_despesas;
create trigger imp_titulo_despesa before insert or update or delete on public.imp_despesas for each row execute function public._imp_titulo_despesa();

-- o título em aberto sai junto com o câmbio ou a despesa (depois da exclusão, para não mexer na linha que está saindo)
create or replace function public._imp_titulo_apagar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.lancamento_id is not null then delete from lancamentos where id = old.lancamento_id and status = 'Em aberto'; end if;
  return null;
end $$;
drop trigger if exists imp_titulo_apagar on public.imp_cambios;
create trigger imp_titulo_apagar after delete on public.imp_cambios for each row execute function public._imp_titulo_apagar();
drop trigger if exists imp_titulo_apagar on public.imp_despesas;
create trigger imp_titulo_apagar after delete on public.imp_despesas for each row execute function public._imp_titulo_apagar();

-- ---------------------------------------------------------------- custo final (landed cost)
-- Mercadoria pela taxa da declaração (ou a prevista); despesas que compõem o custo rateadas pelo valor ou pelo peso dos itens
-- (a de um item só vai direto para ele). A diferença entre o que foi pago no câmbio e a mercadoria pela taxa da declaração é
-- variação cambial: resultado financeiro, fora do custo.
create or replace function public._imp_custo(p_processo uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p imp_processos; c imp_config; v_taxa numeric; v_origem text; v_rateio text; v_fob numeric; v_peso numeric; v_qtd numeric;
  v_rat numeric; v_fora numeric; v_itens jsonb; v_liq_moeda numeric; v_liq_brl numeric; v_apos numeric; v_recup numeric;
begin
  select * into p from imp_processos where id = p_processo;
  if p.id is null then return null; end if;
  select * into c from imp_config where empresa_id = p.empresa_id;
  v_taxa := _imp_taxa(p_processo); v_origem := case when p.taxa_di is not null then 'declaracao' when p.taxa_prevista is not null then 'prevista' when v_taxa is not null then 'cotacao' else 'sem_taxa' end;
  v_rateio := coalesce(p.rateio, c.rateio, 'valor');
  select coalesce(sum(quantidade * valor_unitario), 0), coalesce(sum(coalesce(peso_liquido, case when upper(unidade) = 'KG' then quantidade else 0 end)), 0), coalesce(sum(quantidade), 0)
    into v_fob, v_peso, v_qtd from imp_itens where processo_id = p_processo;
  if v_rateio = 'peso' and v_peso = 0 then v_rateio := 'valor'; end if;
  select coalesce(sum(valor) filter (where compoe_custo and item_id is null), 0), coalesce(sum(valor) filter (where not compoe_custo), 0),
         coalesce(sum(valor) filter (where compoe_custo and p.data_recebimento is not null and criado_em::date > p.data_recebimento), 0),
         coalesce(sum(valor) filter (where not compoe_custo and categoria in ('icms', 'ipi', 'pis', 'cofins')), 0)
    into v_rat, v_fora, v_apos, v_recup from imp_despesas where processo_id = p_processo;
  select coalesce(sum(valor_moeda), 0), coalesce(sum(valor_brl), 0) into v_liq_moeda, v_liq_brl from imp_cambios where processo_id = p_processo and status = 'liquidado';
  select coalesce(jsonb_agg(jsonb_build_object('item_id', x.id, 'descricao', x.descricao, 'quantidade', x.quantidade, 'unidade', x.unidade, 'fob_moeda', x.fob,
      'fob_brl', round(x.fob * coalesce(v_taxa, 0), 2), 'despesas', round(x.rat + x.dir, 2), 'custo_total', round(x.fob * coalesce(v_taxa, 0) + x.rat + x.dir, 2),
      'custo_unitario', round((x.fob * coalesce(v_taxa, 0) + x.rat + x.dir) / x.quantidade, 6)) order by x.ordem, x.descricao), '[]'::jsonb)
    into v_itens
    from (select i.id, i.descricao, i.quantidade, i.unidade, i.ordem, i.quantidade * i.valor_unitario as fob,
                 v_rat * case when v_rateio = 'peso' then coalesce(i.peso_liquido, case when upper(i.unidade) = 'KG' then i.quantidade else 0 end) / nullif(v_peso, 0)
                              when v_fob > 0 then i.quantidade * i.valor_unitario / v_fob else i.quantidade / nullif(v_qtd, 0) end as rat,
                 coalesce((select sum(d.valor) from imp_despesas d where d.item_id = i.id and d.compoe_custo), 0) as dir
            from imp_itens i where i.processo_id = p_processo) x;
  return jsonb_build_object('moeda', p.moeda, 'taxa', v_taxa, 'taxa_origem', v_origem, 'rateio', v_rateio, 'fob_moeda', v_fob, 'fob_brl', round(v_fob * coalesce(v_taxa, 0), 2),
    'despesas_custo', (select coalesce(sum(valor), 0) from imp_despesas where processo_id = p_processo and compoe_custo), 'despesas_fora', v_fora, 'impostos_recuperaveis', v_recup,
    'custo_total', (select coalesce(sum((e ->> 'custo_total')::numeric), 0) from jsonb_array_elements(v_itens) e),
    'cambio_liquidado_moeda', v_liq_moeda, 'cambio_liquidado_brl', v_liq_brl,
    'variacao_cambial', case when v_taxa is null then null else round(v_liq_brl - v_liq_moeda * v_taxa, 2) end,
    'despesas_apos_recebimento', v_apos, 'itens', v_itens);
end $$;
revoke all on function public._imp_custo(uuid) from public, anon, authenticated;

create or replace function public.imp_custo(p_processo uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e uuid;
begin
  select empresa_id into e from imp_processos where id = p_processo;
  if e is null or not (is_membro(e) or imp_pode(e)) then raise exception 'Sem acesso a este processo.'; end if;
  return _imp_custo(p_processo);
end $$;
grant execute on function public.imp_custo(uuid) to authenticated;

-- ---------------------------------------------------------------- recebimento: entrada no estoque com o custo apurado
-- p_itens: [{item_id, quantidade, lote}]. Sem produto ligado, ou com p_movimentar = false, só registra a quantidade e o custo.
create or replace function public.imp_receber(p_processo uuid, p_data date, p_itens jsonb, p_movimentar boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p imp_processos; c imp_config; v_custo jsonb; x jsonb; i imp_itens; pr produtos; v_cu numeric; v_qtd numeric; v_local uuid; v_tipo uuid; v_lote uuid;
  n_mov int := 0; n_reg int := 0; v_sem text[] := '{}'; v_falta int;
begin
  select * into p from imp_processos where id = p_processo for update;
  if p.id is null or not imp_pode(p.empresa_id) then raise exception 'Sem permissão para receber esta importação.'; end if;
  if p.status in ('encerrado', 'cancelado') then raise exception 'O processo está %.', p.status; end if;
  if p.status not in ('desembaracado', 'recebido') then raise exception 'Só processo desembaraçado pode ser recebido (etapa atual: %).', p.status; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Informe os itens recebidos.'; end if;
  select * into c from imp_config where empresa_id = p.empresa_id;
  v_custo := _imp_custo(p_processo);
  if v_custo ->> 'taxa' is null then raise exception 'Informe a taxa de câmbio da declaração (ou a prevista) antes de receber: sem ela não há custo.'; end if;
  for x in select * from jsonb_array_elements(p_itens) loop
    select * into i from imp_itens where id = (x ->> 'item_id')::uuid and processo_id = p_processo;
    if i.id is null then raise exception 'Item não encontrado neste processo.'; end if;
    v_qtd := (x ->> 'quantidade')::numeric;
    if v_qtd is null or v_qtd <= 0 then continue; end if;
    select (e ->> 'custo_unitario')::numeric into v_cu from jsonb_array_elements(v_custo -> 'itens') e where (e ->> 'item_id')::uuid = i.id;
    if p_movimentar and i.produto_id is not null then
      select * into pr from produtos where id = i.produto_id;
      v_local := coalesce(c.local_id, pr.local_padrao_id, (select local_padrao_id from est_familias where id = pr.familia_id),
                          (select id from est_locais where empresa_id = p.empresa_id and codigo = 'MP' and ativo));
      v_tipo := coalesce(c.tipo_movimento_id, (select id from est_tipos_movimento where empresa_id = p.empresa_id and codigo = 'COMPRA' and ativo));
      if v_local is null or v_tipo is null then raise exception 'O estoque desta empresa não está configurado (local de matéria-prima e tipo de movimento de compra). Configure em Estoque › Parâmetros ou receba sem movimentar o estoque.'; end if;
      v_lote := null;
      if pr.controla_lote or coalesce(x ->> 'lote', i.lote, '') <> '' then
        insert into est_lotes(empresa_id, produto_id, codigo, lote_fornecedor, fornecedor_id, origem)
        values (p.empresa_id, pr.id, coalesce(nullif(x ->> 'lote', ''), nullif(i.lote, ''), 'IMP-' || p.numero), nullif(x ->> 'lote', ''), p.favorecido_id, 'compra')
        on conflict (empresa_id, produto_id, codigo) do update set fornecedor_id = excluded.fornecedor_id returning id into v_lote;
      end if;
      insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, nota_id, documento, observacao)
      values (p.empresa_id, coalesce(p_data, current_date), pr.id, v_local, v_lote, v_tipo, v_qtd, v_cu, p.nfe_nota_id, 'IMP ' || p.numero,
              left(format('Importação %s%s — custo final com as despesas da nacionalização', p.numero, case when p.declaracao is not null then ', declaração ' || p.declaracao else '' end), 250));
      n_mov := n_mov + 1;
    else
      if i.produto_id is null then v_sem := v_sem || i.descricao; end if;
      n_reg := n_reg + 1;
    end if;
    update imp_itens set qtd_recebida = qtd_recebida + v_qtd, custo_unitario = v_cu, lote = coalesce(nullif(x ->> 'lote', ''), lote) where id = i.id;
  end loop;
  if n_mov + n_reg = 0 then raise exception 'Nenhuma quantidade informada.'; end if;
  select count(*) into v_falta from imp_itens where processo_id = p_processo and qtd_recebida < quantidade;
  update imp_processos set status = 'recebido', data_recebimento = coalesce(data_recebimento, p_data, current_date) where id = p_processo and v_falta = 0 and status <> 'recebido';
  insert into imp_eventos(empresa_id, processo_id, etapa, data, texto)
  values (p.empresa_id, p_processo, 'recebimento', coalesce(p_data, current_date), format('%s item(ns) com entrada no estoque%s%s', n_mov,
          case when n_reg > 0 then format(', %s só registrado(s)', n_reg) else '' end, case when v_falta > 0 then format('; %s item(ns) ainda com saldo a receber', v_falta) else '' end));
  return jsonb_build_object('movimentos', n_mov, 'registrados', n_reg, 'sem_produto', to_jsonb(v_sem), 'faltam', v_falta);
end $$;
grant execute on function public.imp_receber(uuid, date, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------- cotações: grava a lista lida do Banco Central ou digitada
create or replace function public.imp_ptax_gravar(p_empresa uuid, p_linhas jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare x jsonb; n int := 0;
begin
  if not imp_pode(p_empresa) then raise exception 'Sem permissão para gravar cotações.'; end if;
  if jsonb_typeof(p_linhas) <> 'array' then return 0; end if;
  for x in select * from jsonb_array_elements(p_linhas) loop
    if (x ->> 'moeda') ~ '^[A-Z]{3}$' and (x ->> 'venda')::numeric > 0 and (x ->> 'data')::date <= current_date then
      insert into imp_ptax(moeda, data, compra, venda, fonte) values (x ->> 'moeda', (x ->> 'data')::date, nullif(x ->> 'compra', '')::numeric, (x ->> 'venda')::numeric, left(coalesce(x ->> 'fonte', 'manual'), 60))
      on conflict (moeda, data) do update set compra = excluded.compra, venda = excluded.venda, fonte = excluded.fonte, atualizado_em = now();
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
grant execute on function public.imp_ptax_gravar(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- documentos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('importacao', 'importacao', false, 15728640, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/xml', 'text/xml',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;
drop policy if exists importacao_arq_sel on storage.objects;
drop policy if exists importacao_arq_ins on storage.objects;
drop policy if exists importacao_arq_del on storage.objects;
create policy importacao_arq_sel on storage.objects for select to authenticated using (bucket_id = 'importacao' and (public.is_membro(public._uuid_ou_nulo((storage.foldername(name))[1])) or public.imp_pode(public._uuid_ou_nulo((storage.foldername(name))[1]))));
create policy importacao_arq_ins on storage.objects for insert to authenticated with check (bucket_id = 'importacao' and public.imp_pode(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy importacao_arq_del on storage.objects for delete to authenticated using (bucket_id = 'importacao' and public.imp_pode(public._uuid_ou_nulo((storage.foldername(name))[1])));
