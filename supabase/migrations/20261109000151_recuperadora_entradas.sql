-- Recuperadora (reciclagem e reprocesso) — parte 1: cadastros, entrada pela balança, lotes, adiantamentos a fornecedor,
-- aparas internas que viram lote sozinhas e a relação para a nota de entrada.
-- Serve a quem só reprocessa a apara da própria produção (modo "interno"), a quem compra material reciclável de terceiros
-- (modo "externo") e a quem faz os dois ("ambos"). Desligado, o módulo não aparece no menu. Tudo configurável na tela. Aditivo.

-- ---------- parâmetros ----------
create table if not exists public.rec_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  modo text not null default 'desligado' check (modo in ('desligado', 'interno', 'externo', 'ambos')),
  aparas_auto boolean not null default true,              -- apara apontada no encerramento da OP vira lote de apara
  apara_material_padrao_id uuid,                          -- quando nenhuma regra por setor/máquina/motivo se aplica
  apara_custo_kg numeric(12,4) not null default 0 check (apara_custo_kg >= 0),   -- valor atribuído ao kg de apara interna
  tolerancia_kg numeric(10,3) not null default 1 check (tolerancia_kg >= 0),     -- soma dos itens × peso líquido do ticket
  desconto_max_pct numeric(5,2) not null default 30 check (desconto_max_pct between 0 and 100),  -- acima disso só quem configura fecha
  exigir_foto boolean not null default false,
  plano_compra_id uuid references public.plano_contas(id) on delete set null,          -- título a pagar da compra
  plano_adiantamento_id uuid references public.plano_contas(id) on delete set null,    -- adiantamento a fornecedor
  prazo_pagamento_dias int not null default 0 check (prazo_pagamento_dias between 0 and 120),
  abater_adiantamento boolean not null default true,
  integrar_estoque boolean not null default false,        -- compra entra no Kardex (material com produto ligado)
  est_local_id uuid references public.est_locais(id) on delete set null,
  balanca_baud int not null default 9600,
  prefixo_entrada text not null default 'LE' check (length(prefixo_entrada) between 1 and 6),
  prefixo_apara text not null default 'AP' check (length(prefixo_apara) between 1 and 6),
  atualizado_em timestamptz not null default now()
);

-- ---------- cadastros ----------
create table if not exists public.rec_materiais (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,
  nome text not null,
  polimero text not null default 'PEBD' check (polimero in ('PEBD', 'PEAD', 'PELBD', 'PP', 'BOPP', 'PET', 'PS', 'PVC', 'misto', 'outro')),
  cor text,
  condicao text not null default 'limpo' check (condicao in ('limpo', 'sujo', 'impresso', 'misto')),
  ncm text check (ncm is null or ncm ~ '^\d{8}$'),
  produto_id uuid references public.produtos(id) on delete set null,   -- para o Kardex
  ativo boolean not null default true,
  unique (empresa_id, codigo)
);
alter table public.rec_config drop constraint if exists rec_config_apara_mat_fk;
alter table public.rec_config add constraint rec_config_apara_mat_fk foreign key (apara_material_padrao_id) references public.rec_materiais(id) on delete set null;

create table if not exists public.rec_classes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,
  nome text not null,
  desconto_padrao_pct numeric(5,2) not null default 0 check (desconto_padrao_pct between 0 and 100),   -- umidade e impureza típicas
  ordem smallint not null default 0,
  ativo boolean not null default true,
  unique (empresa_id, codigo)
);

create table if not exists public.rec_precos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  material_id uuid not null references public.rec_materiais(id) on delete cascade,
  classe_id uuid references public.rec_classes(id) on delete cascade,  -- vazio = vale para qualquer classe
  vigencia date not null,
  preco_kg numeric(12,4) not null check (preco_kg >= 0),
  criado_em timestamptz not null default now()
);
create unique index if not exists rec_precos_unq on public.rec_precos(material_id, coalesce(classe_id, '00000000-0000-0000-0000-000000000000'::uuid), vigencia);

-- fornecedor de reciclável: o beneficiário ganha o tipo e a marca de coletor incentivado (crédito presumido de IBS/CBS, LC 214/2025 art. 170)
alter table public.favorecidos add column if not exists rec_tipo text check (rec_tipo is null or rec_tipo in ('catador_pf', 'cooperativa', 'associacao', 'sucateiro_pj', 'industria', 'outro'));
alter table public.favorecidos add column if not exists rec_coletor_incentivado boolean not null default false;

-- regras da apara interna: setor / máquina / motivo do refugo → material (ou ignorar)
create table if not exists public.rec_apara_regras (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  setor_id uuid references public.prod_setores(id) on delete cascade,
  maquina_id uuid references public.prod_maquinas(id) on delete cascade,
  motivo_id uuid references public.prod_motivos(id) on delete cascade,
  material_id uuid references public.rec_materiais(id) on delete cascade,
  ignorar boolean not null default false,                 -- ex.: o próprio aglutinador não gera apara para a recuperadora
  ativo boolean not null default true,
  check (ignorar or material_id is not null)
);

-- ---------- entrada pela balança ----------
create table if not exists public.rec_tickets (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int,                                            -- sequência por empresa (gatilho)
  data_hora timestamptz not null default now(),
  origem text not null default 'compra' check (origem in ('compra', 'doacao', 'transferencia')),
  fornecedor_id uuid references public.favorecidos(id) on delete restrict,
  placa text, motorista text,
  peso_bruto numeric(14,3) check (peso_bruto is null or peso_bruto >= 0),
  tara numeric(14,3) check (tara is null or tara >= 0),
  peso_liquido numeric(14,3),                             -- bruto − tara (ou a soma dos itens, sem balança de veículo)
  frete_valor numeric(14,2) not null default 0 check (frete_valor >= 0),   -- entra no custo do lote
  nf_numero text, nf_chave text check (nf_chave is null or nf_chave ~ '^\d{44}$'),
  situacao text not null default 'aberto' check (situacao in ('aberto', 'fechado', 'cancelado')),
  total numeric(16,2), abatido numeric(16,2) not null default 0,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  fotos jsonb not null default '[]',
  observacao text,
  chave_importacao text,
  fechado_em timestamptz, fechado_por uuid,
  cancelado_motivo text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  unique (empresa_id, numero),
  check (peso_bruto is null or tara is null or peso_bruto >= tara)
);
create unique index if not exists rec_tickets_chave on public.rec_tickets(empresa_id, chave_importacao) where chave_importacao is not null;
create index if not exists rec_tickets_data on public.rec_tickets(empresa_id, data_hora);

create table if not exists public.rec_ticket_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  ticket_id uuid not null references public.rec_tickets(id) on delete cascade,
  material_id uuid not null references public.rec_materiais(id),
  classe_id uuid references public.rec_classes(id),
  peso_kg numeric(14,3) not null check (peso_kg > 0),
  desconto_pct numeric(5,2) check (desconto_pct is null or desconto_pct between 0 and 100),   -- vazio = o padrão da classe
  preco_kg numeric(12,4) check (preco_kg is null or preco_kg >= 0),                           -- vazio = tabela de preços
  peso_pago numeric(14,3), valor numeric(16,2),           -- gravados ao fechar
  lote_id uuid,
  criado_em timestamptz not null default now()
);
create index if not exists rec_ticket_itens_t on public.rec_ticket_itens(ticket_id);

-- ---------- lotes (entrada, apara e — na parte 2 — grão) ----------
create table if not exists public.rec_lotes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null,
  tipo text not null check (tipo in ('entrada', 'apara', 'grao')),
  material_id uuid references public.rec_materiais(id),
  classe_id uuid references public.rec_classes(id),
  fornecedor_id uuid references public.favorecidos(id) on delete set null,
  ticket_item_id uuid unique references public.rec_ticket_itens(id) on delete set null,
  data date not null default current_date,
  peso_kg numeric(14,3) not null default 0 check (peso_kg >= 0),
  saldo_kg numeric(14,3) not null default 0 check (saldo_kg >= 0),
  custo_total numeric(16,2) not null default 0 check (custo_total >= 0),
  situacao text not null default 'disponivel' check (situacao in ('disponivel', 'em_processo', 'consumido', 'bloqueado', 'vendido', 'cancelado')),
  est_movimento_id uuid,
  observacao text,
  criado_em timestamptz not null default now(),
  unique (empresa_id, codigo)
);
create index if not exists rec_lotes_mat on public.rec_lotes(empresa_id, tipo, material_id, situacao);
alter table public.rec_ticket_itens drop constraint if exists rec_ticket_itens_lote_fk;
alter table public.rec_ticket_itens add constraint rec_ticket_itens_lote_fk foreign key (lote_id) references public.rec_lotes(id) on delete set null;

-- apontamento → lote de apara (guarda quanto entrou para refazer quando o apontamento muda)
create table if not exists public.rec_apara_registros (
  apontamento_id uuid primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  lote_id uuid not null references public.rec_lotes(id) on delete cascade,
  kg numeric(14,3) not null
);

-- ---------- adiantamentos a fornecedor ----------
create table if not exists public.rec_adiantamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  fornecedor_id uuid not null references public.favorecidos(id) on delete restrict,
  data date not null default current_date,
  valor numeric(14,2) not null check (valor > 0),
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  situacao text not null default 'aberto' check (situacao in ('aberto', 'quitado', 'cancelado')),
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create table if not exists public.rec_adiant_abatimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  adiantamento_id uuid not null references public.rec_adiantamentos(id) on delete cascade,
  ticket_id uuid not null references public.rec_tickets(id) on delete cascade,
  valor numeric(14,2) not null check (valor > 0),
  unique (adiantamento_id, ticket_id)
);

-- ---------- segurança ----------
-- leitura: quem vê a produção; operação da balança: quem aponta; cadastros e parâmetros: quem planeja (admin, financeiro, diretor)
do $$ declare t text; begin
  foreach t in array array['rec_config', 'rec_materiais', 'rec_classes', 'rec_precos', 'rec_apara_regras', 'rec_tickets', 'rec_ticket_itens',
                           'rec_lotes', 'rec_apara_registros', 'rec_adiantamentos', 'rec_adiant_abatimentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.ve_producao(empresa_id))', t || '_sel', t);
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    if t <> 'rec_apara_registros' then
      execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
    end if;
  end loop;
  foreach t in array array['rec_config', 'rec_materiais', 'rec_classes', 'rec_precos', 'rec_apara_regras'] loop
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.pode_pcp(empresa_id))', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.pode_pcp(empresa_id)) with check (public.pode_pcp(empresa_id))', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.pode_pcp(empresa_id))', t || '_del', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
-- ticket e itens: quem aponta cria e edita enquanto está aberto; fechar e cancelar só pelas funções
drop policy if exists rec_tickets_ins on public.rec_tickets;
create policy rec_tickets_ins on public.rec_tickets for insert to authenticated with check (public.pode_apontar(empresa_id) and situacao = 'aberto');
drop policy if exists rec_tickets_upd on public.rec_tickets;
create policy rec_tickets_upd on public.rec_tickets for update to authenticated using (public.pode_apontar(empresa_id) and situacao = 'aberto') with check (public.pode_apontar(empresa_id) and situacao = 'aberto');
drop policy if exists rec_tickets_del on public.rec_tickets;
create policy rec_tickets_del on public.rec_tickets for delete to authenticated using (public.pode_apontar(empresa_id) and situacao = 'aberto');
drop policy if exists rec_ticket_itens_ins on public.rec_ticket_itens;
create policy rec_ticket_itens_ins on public.rec_ticket_itens for insert to authenticated with check (public.pode_apontar(empresa_id) and exists (select 1 from rec_tickets t where t.id = ticket_id and t.empresa_id = rec_ticket_itens.empresa_id and t.situacao = 'aberto'));
drop policy if exists rec_ticket_itens_upd on public.rec_ticket_itens;
create policy rec_ticket_itens_upd on public.rec_ticket_itens for update to authenticated using (public.pode_apontar(empresa_id) and exists (select 1 from rec_tickets t where t.id = ticket_id and t.situacao = 'aberto'))
  with check (public.pode_apontar(empresa_id) and exists (select 1 from rec_tickets t where t.id = ticket_id and t.empresa_id = rec_ticket_itens.empresa_id and t.situacao = 'aberto'));
drop policy if exists rec_ticket_itens_del on public.rec_ticket_itens;
create policy rec_ticket_itens_del on public.rec_ticket_itens for delete to authenticated using (public.pode_apontar(empresa_id) and exists (select 1 from rec_tickets t where t.id = ticket_id and t.situacao = 'aberto'));
grant select, insert, update, delete on public.rec_tickets, public.rec_ticket_itens to authenticated;
-- lote: só a observação e o bloqueio mudam na tela (quem planeja); o resto pelas funções
drop policy if exists rec_lotes_upd on public.rec_lotes;
create policy rec_lotes_upd on public.rec_lotes for update to authenticated using (public.pode_pcp(empresa_id)) with check (public.pode_pcp(empresa_id));
grant select, update (observacao, situacao) on public.rec_lotes to authenticated;
grant select on public.rec_apara_registros, public.rec_adiantamentos, public.rec_adiant_abatimentos to authenticated;

-- número do ticket, peso líquido, empresa dos vínculos
create or replace function public._rec_ticket_antes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('rec_ticket_' || new.empresa_id));
    if new.numero is null then new.numero := coalesce((select max(numero) from rec_tickets where empresa_id = new.empresa_id), 0) + 1; end if;
  end if;
  if new.peso_bruto is not null and new.tara is not null then new.peso_liquido := new.peso_bruto - new.tara; end if;
  if new.fornecedor_id is not null and (select empresa_id from favorecidos where id = new.fornecedor_id) is distinct from new.empresa_id then raise exception 'Fornecedor de outra empresa'; end if;
  new.placa := nullif(upper(regexp_replace(coalesce(new.placa, ''), '[^A-Za-z0-9]', '', 'g')), '');
  return new;
end $$;
drop trigger if exists rec_ticket_antes on public.rec_tickets;
create trigger rec_ticket_antes before insert or update on public.rec_tickets for each row execute function public._rec_ticket_antes();

create or replace function public._rec_item_antes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select empresa_id from rec_tickets where id = new.ticket_id) is distinct from new.empresa_id
     or (select empresa_id from rec_materiais where id = new.material_id) is distinct from new.empresa_id
     or (new.classe_id is not null and (select empresa_id from rec_classes where id = new.classe_id) is distinct from new.empresa_id) then
    raise exception 'Material, classe ou ticket de outra empresa';
  end if;
  return new;
end $$;
drop trigger if exists rec_item_antes on public.rec_ticket_itens;
create trigger rec_item_antes before insert or update on public.rec_ticket_itens for each row execute function public._rec_item_antes();

-- preço vigente do kg: o da classe vence o geral; a vigência mais recente até a data
create or replace function public.rec_preco(p_material uuid, p_classe uuid, p_data date) returns numeric
language sql stable security definer set search_path = public as $$
  select preco_kg from rec_precos where material_id = p_material and (classe_id = p_classe or classe_id is null) and vigencia <= p_data
   order by (classe_id is null), vigencia desc limit 1
$$;

-- saldo de adiantamento por fornecedor
create or replace function public._rec_adiant_saldo(p_adiant uuid) returns numeric language sql stable security definer set search_path = public as $$
  select a.valor - coalesce((select sum(b.valor) from rec_adiant_abatimentos b where b.adiantamento_id = a.id), 0) from rec_adiantamentos a where a.id = p_adiant
$$;

-- ---------- fechar o ticket: lotes, título a pagar, abatimento do adiantamento e Kardex ----------
create or replace function public.rec_ticket_fechar(p_ticket uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  t rec_tickets; cfg rec_config; i record; v_soma numeric; v_total numeric := 0; v_lote uuid; v_desc numeric; v_preco numeric; v_pago numeric; v_valor numeric;
  v_frete numeric; v_seq int := 0; v_resto numeric; a record; v_ab numeric; v_abatido numeric := 0; v_lanc uuid; v_mov uuid; v_local uuid; v_tipo uuid; v_prod uuid;
  v_data date; v_sem_preco int := 0;
begin
  select * into t from rec_tickets where id = p_ticket for update;
  if t.id is null or not public.pode_apontar(t.empresa_id) then raise exception 'Acesso negado.'; end if;
  if t.situacao <> 'aberto' then raise exception 'Este ticket já está %.', t.situacao; end if;
  select * into cfg from rec_config where empresa_id = t.empresa_id;
  if cfg.empresa_id is null or cfg.modo = 'desligado' then raise exception 'A recuperadora está desligada nos parâmetros.'; end if;
  if t.origem = 'compra' and t.fornecedor_id is null then raise exception 'Informe o fornecedor da compra.'; end if;
  if not exists (select 1 from rec_ticket_itens where ticket_id = t.id) then raise exception 'Informe ao menos um material com o peso.'; end if;
  if cfg.exigir_foto and jsonb_array_length(coalesce(t.fotos, '[]')) = 0 then raise exception 'Os parâmetros exigem ao menos uma foto da carga.'; end if;
  select sum(peso_kg) into v_soma from rec_ticket_itens where ticket_id = t.id;
  if t.peso_liquido is null then update rec_tickets set peso_liquido = v_soma where id = t.id; t.peso_liquido := v_soma;
  elsif abs(v_soma - t.peso_liquido) > cfg.tolerancia_kg then
    raise exception 'A soma dos materiais (% kg) não bate com o peso líquido da balança (% kg). Tolerância: % kg.', v_soma, t.peso_liquido, cfg.tolerancia_kg;
  end if;
  v_data := (t.data_hora at time zone 'America/Sao_Paulo')::date;
  for i in select it.*, c.desconto_padrao_pct, m.codigo mcod, m.produto_id from rec_ticket_itens it join rec_materiais m on m.id = it.material_id left join rec_classes c on c.id = it.classe_id
            where it.ticket_id = t.id order by it.peso_kg desc, it.id loop
    v_seq := v_seq + 1;
    v_desc := coalesce(i.desconto_pct, i.desconto_padrao_pct, 0);
    if v_desc > cfg.desconto_max_pct and not public.pode_pcp(t.empresa_id) then
      raise exception 'Desconto de % %% no material % passa do máximo (% %%): quem configura a recuperadora precisa fechar este ticket.', v_desc, i.mcod, cfg.desconto_max_pct;
    end if;
    v_preco := case when t.origem = 'compra' then coalesce(i.preco_kg, public.rec_preco(i.material_id, i.classe_id, v_data)) else 0 end;
    if t.origem = 'compra' and v_preco is null then v_sem_preco := v_sem_preco + 1; v_preco := 0; end if;
    v_pago := round(i.peso_kg * (1 - v_desc / 100), 3);
    v_valor := round(v_pago * v_preco, 2);
    v_frete := case when coalesce(t.frete_valor, 0) > 0 then round(t.frete_valor * i.peso_kg / v_soma, 2) else 0 end;
    insert into rec_lotes(empresa_id, codigo, tipo, material_id, classe_id, fornecedor_id, ticket_item_id, data, peso_kg, saldo_kg, custo_total)
    values (t.empresa_id, cfg.prefixo_entrada || t.numero || '-' || v_seq, 'entrada', i.material_id, i.classe_id, t.fornecedor_id, i.id, v_data, v_pago, v_pago, v_valor + v_frete)
    returning id into v_lote;
    update rec_ticket_itens set desconto_pct = v_desc, preco_kg = v_preco, peso_pago = v_pago, valor = v_valor, lote_id = v_lote where id = i.id;
    v_total := v_total + v_valor;
    -- Kardex: compra do material ligado a um produto
    if cfg.integrar_estoque and i.produto_id is not null and v_pago > 0 then
      v_local := coalesce(cfg.est_local_id, (select id from est_locais where empresa_id = t.empresa_id and codigo = 'APA'));
      v_tipo := (select id from est_tipos_movimento where empresa_id = t.empresa_id and codigo = case when t.origem = 'compra' then 'COMPRA' else 'AJ+' end);
      if v_local is not null and v_tipo is not null then
        insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario, documento, observacao)
        values (t.empresa_id, v_data, i.produto_id, v_local, v_tipo, v_pago, round((v_valor + v_frete) / v_pago, 10), 'Ticket ' || t.numero, 'Recuperadora — lote ' || cfg.prefixo_entrada || t.numero || '-' || v_seq)
        returning id into v_mov;
        update rec_lotes set est_movimento_id = v_mov where id = v_lote;
      end if;
    end if;
  end loop;
  -- adiantamentos em aberto do fornecedor abatem a compra (mais antigos primeiro)
  if t.origem = 'compra' and cfg.abater_adiantamento and v_total > 0 then
    v_resto := v_total;
    for a in select id from rec_adiantamentos where empresa_id = t.empresa_id and fornecedor_id = t.fornecedor_id and situacao = 'aberto' order by data, criado_em loop
      exit when v_resto <= 0;
      v_ab := least(v_resto, public._rec_adiant_saldo(a.id));
      if v_ab > 0 then
        insert into rec_adiant_abatimentos(empresa_id, adiantamento_id, ticket_id, valor) values (t.empresa_id, a.id, t.id, v_ab);
        v_resto := v_resto - v_ab; v_abatido := v_abatido + v_ab;
      end if;
      if public._rec_adiant_saldo(a.id) <= 0 then update rec_adiantamentos set situacao = 'quitado' where id = a.id; end if;
    end loop;
  end if;
  -- título a pagar do que sobrou
  if t.origem = 'compra' and cfg.plano_compra_id is not null and v_total - v_abatido > 0 then
    insert into lancamentos(empresa_id, data, plano_id, favorecido_id, status, valor, descricao, documento, origem)
    values (t.empresa_id, v_data + cfg.prazo_pagamento_dias, cfg.plano_compra_id, t.fornecedor_id, 'Em aberto', v_total - v_abatido,
            'Compra de material reciclável — ticket ' || t.numero, 'REC ' || t.numero, 'recuperadora')
    returning id into v_lanc;
  end if;
  update rec_tickets set situacao = 'fechado', total = v_total, abatido = v_abatido, lancamento_id = v_lanc, fechado_em = now(), fechado_por = auth.uid() where id = t.id;
  return jsonb_build_object('total', v_total, 'abatido', v_abatido, 'a_pagar', v_total - v_abatido, 'lancamento_id', v_lanc, 'lotes', v_seq, 'sem_preco', v_sem_preco);
end $$;

-- ---------- cancelar um ticket ----------
-- aberto: só marca; fechado: só se os lotes não foram usados e o título não foi pago (desfaz lotes, título, abatimentos e Kardex)
create or replace function public.rec_ticket_cancelar(p_ticket uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare t rec_tickets; l record;
begin
  select * into t from rec_tickets where id = p_ticket for update;
  if t.id is null then raise exception 'Ticket não encontrado.'; end if;
  if t.situacao = 'cancelado' then raise exception 'Este ticket já está cancelado.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo do cancelamento.'; end if;
  if t.situacao = 'aberto' and not public.pode_apontar(t.empresa_id) then raise exception 'Acesso negado.'; end if;
  if t.situacao = 'fechado' then
    if not public.pode_pcp(t.empresa_id) then raise exception 'Só quem configura a recuperadora cancela um ticket fechado.'; end if;
    if exists (select 1 from rec_lotes x join rec_ticket_itens i on i.lote_id = x.id where i.ticket_id = t.id and (x.situacao not in ('disponivel', 'bloqueado') or x.saldo_kg < x.peso_kg)) then
      raise exception 'Algum lote deste ticket já foi usado no processamento: não dá para cancelar.';
    end if;
    if t.lancamento_id is not null and exists (select 1 from lancamentos where id = t.lancamento_id and status = 'Pago') then
      raise exception 'O título deste ticket já foi pago: estorne o pagamento antes de cancelar.';
    end if;
    perform public._iniciar_operacao('Cancelamento do ticket ' || t.numero || ' da recuperadora');
    for l in select x.* from rec_lotes x join rec_ticket_itens i on i.lote_id = x.id where i.ticket_id = t.id loop
      if l.est_movimento_id is not null then perform public.est_estornar(l.est_movimento_id, current_date, 'Cancelamento do ticket ' || t.numero); end if;
      update rec_lotes set situacao = 'cancelado', saldo_kg = 0, observacao = trim(coalesce(observacao, '') || ' Cancelado: ' || p_motivo) where id = l.id;
    end loop;
    if t.lancamento_id is not null then delete from lancamentos where id = t.lancamento_id and status = 'Em aberto'; end if;
    update rec_adiantamentos set situacao = 'aberto' where id in (select adiantamento_id from rec_adiant_abatimentos where ticket_id = t.id) and situacao = 'quitado';
    delete from rec_adiant_abatimentos where ticket_id = t.id;
  end if;
  update rec_tickets set situacao = 'cancelado', cancelado_motivo = trim(p_motivo) where id = t.id;
end $$;


-- nota da compra informada depois do fechamento (a do fornecedor ou a nota de entrada emitida pela empresa)
create or replace function public.rec_ticket_nota(p_ticket uuid, p_numero text, p_chave text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t rec_tickets;
begin
  select * into t from rec_tickets where id = p_ticket;
  if t.id is null or not public.pode_apontar(t.empresa_id) then raise exception 'Acesso negado.'; end if;
  if t.situacao = 'cancelado' then raise exception 'Ticket cancelado.'; end if;
  if nullif(regexp_replace(coalesce(p_chave, ''), '\D', '', 'g'), '') is not null and regexp_replace(p_chave, '\D', '', 'g') !~ '^\d{44}$' then raise exception 'A chave da NF-e tem 44 dígitos.'; end if;
  update rec_tickets set nf_numero = nullif(trim(p_numero), ''), nf_chave = nullif(regexp_replace(coalesce(p_chave, ''), '\D', '', 'g'), '') where id = t.id;
end $$;

-- ---------- adiantamento a fornecedor (gera o título a pagar) ----------
create or replace function public.rec_adiantamento_lancar(p_empresa uuid, p_fornecedor uuid, p_data date, p_valor numeric, p_obs text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare cfg rec_config; v uuid; v_lanc uuid;
begin
  if not public.pode_pcp(p_empresa) then raise exception 'Acesso negado.'; end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'Informe o valor do adiantamento.'; end if;
  if (select empresa_id from favorecidos where id = p_fornecedor) is distinct from p_empresa then raise exception 'Fornecedor de outra empresa'; end if;
  select * into cfg from rec_config where empresa_id = p_empresa;
  if cfg.plano_adiantamento_id is not null then
    insert into lancamentos(empresa_id, data, plano_id, favorecido_id, status, valor, descricao, documento, origem)
    values (p_empresa, coalesce(p_data, current_date), cfg.plano_adiantamento_id, p_fornecedor, 'Em aberto', p_valor,
            'Adiantamento a fornecedor de reciclável' || coalesce(' — ' || nullif(trim(p_obs), ''), ''), 'REC ADT', 'recuperadora')
    returning id into v_lanc;
  end if;
  insert into rec_adiantamentos(empresa_id, fornecedor_id, data, valor, lancamento_id, observacao) values (p_empresa, p_fornecedor, coalesce(p_data, current_date), p_valor, v_lanc, nullif(trim(p_obs), ''))
  returning id into v;
  return v;
end $$;

create or replace function public.rec_adiantamento_cancelar(p_adiant uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a rec_adiantamentos;
begin
  select * into a from rec_adiantamentos where id = p_adiant for update;
  if a.id is null or not public.pode_pcp(a.empresa_id) then raise exception 'Acesso negado.'; end if;
  if exists (select 1 from rec_adiant_abatimentos where adiantamento_id = a.id) then raise exception 'Este adiantamento já abateu compras: não dá para cancelar.'; end if;
  if a.lancamento_id is not null and exists (select 1 from lancamentos where id = a.lancamento_id and status = 'Pago') then raise exception 'O adiantamento já foi pago: estorne o pagamento antes.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo.'; end if;
  if a.lancamento_id is not null then delete from lancamentos where id = a.lancamento_id and status = 'Em aberto'; end if;
  update rec_adiantamentos set situacao = 'cancelado', observacao = trim(coalesce(observacao, '') || ' Cancelado: ' || p_motivo) where id = a.id;
end $$;

-- ---------- apara interna → lote de apara ----------
create or replace function public._rec_lote_apara(p_empresa uuid, p_material uuid, p_data date) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; v_base text; v_cod text; n int := 1;
begin
  select id into v from rec_lotes where empresa_id = p_empresa and tipo = 'apara' and material_id = p_material and data = p_data and situacao = 'disponivel' order by criado_em limit 1;
  if v is not null then return v; end if;
  v_base := coalesce((select prefixo_apara from rec_config where empresa_id = p_empresa), 'AP') || '-' || to_char(p_data, 'YYMMDD') || '-' || (select codigo from rec_materiais where id = p_material);
  v_cod := v_base;
  while exists (select 1 from rec_lotes where empresa_id = p_empresa and codigo = v_cod) loop n := n + 1; v_cod := v_base || '-' || n; end loop;
  insert into rec_lotes(empresa_id, codigo, tipo, material_id, data) values (p_empresa, v_cod, 'apara', p_material, p_data) returning id into v;
  return v;
end $$;

-- aplica (ou refaz) a apara de um apontamento
create or replace function public._rec_apara_aplicar(p_apont uuid) returns numeric
language plpgsql security definer set search_path = public as $$
declare ap prod_apontamentos; cfg rec_config; reg rec_apara_registros; v_kg numeric := 0; v_mat uuid; v_ign boolean := false; v_lote uuid; v_custo numeric;
begin
  select * into ap from prod_apontamentos where id = p_apont;
  select * into reg from rec_apara_registros where apontamento_id = p_apont;
  if reg.apontamento_id is not null then   -- desfaz o que entrou antes
    v_custo := round(reg.kg * coalesce((select apara_custo_kg from rec_config where empresa_id = reg.empresa_id), 0), 2);
    update rec_lotes set peso_kg = greatest(0, peso_kg - reg.kg), saldo_kg = greatest(0, saldo_kg - reg.kg), custo_total = greatest(0, custo_total - v_custo) where id = reg.lote_id;
    delete from rec_apara_registros where apontamento_id = p_apont;
  end if;
  if ap.id is null then return 0; end if;
  select * into cfg from rec_config where empresa_id = ap.empresa_id;
  if cfg.empresa_id is null or cfg.modo not in ('interno', 'ambos') or not cfg.aparas_auto or ap.fim is null or coalesce(ap.refugo, 0) <= 0 then return 0; end if;
  select r.material_id, r.ignorar into v_mat, v_ign from rec_apara_regras r
   where r.empresa_id = ap.empresa_id and r.ativo
     and (r.maquina_id is null or r.maquina_id = ap.maquina_id) and (r.setor_id is null or r.setor_id = ap.setor_id) and (r.motivo_id is null or r.motivo_id = ap.refugo_motivo_id)
   order by (r.maquina_id is not null)::int * 4 + (r.motivo_id is not null)::int * 2 + (r.setor_id is not null)::int desc limit 1;
  if coalesce(v_ign, false) then return 0; end if;
  v_mat := coalesce(v_mat, cfg.apara_material_padrao_id);
  if v_mat is null then return 0; end if;
  v_kg := ap.refugo;
  v_lote := public._rec_lote_apara(ap.empresa_id, v_mat, (ap.fim at time zone 'America/Sao_Paulo')::date);
  update rec_lotes set peso_kg = peso_kg + v_kg, saldo_kg = saldo_kg + v_kg, custo_total = custo_total + round(v_kg * cfg.apara_custo_kg, 2) where id = v_lote;
  insert into rec_apara_registros(apontamento_id, empresa_id, lote_id, kg) values (ap.id, ap.empresa_id, v_lote, v_kg);
  return v_kg;
end $$;

create or replace function public._rec_apara_apont() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then perform public._rec_apara_aplicar(old.id); return old; end if;
  perform public._rec_apara_aplicar(new.id);
  return new;
end $$;
drop trigger if exists rec_apara on public.prod_apontamentos;
create trigger rec_apara after insert or update of refugo, fim, refugo_motivo_id, maquina_id, setor_id or delete on public.prod_apontamentos
  for each row execute function public._rec_apara_apont();

-- refaz as aparas a partir de uma data (ao ligar o módulo ou depois de mudar as regras)
create or replace function public.rec_aparas_reprocessar(p_empresa uuid, p_de date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; kg numeric := 0; v numeric;
begin
  if not public.pode_pcp(p_empresa) then raise exception 'Acesso negado.'; end if;
  if p_de is null or p_de < current_date - 400 then raise exception 'Escolha uma data dos últimos 400 dias.'; end if;
  for r in select id from prod_apontamentos where empresa_id = p_empresa and fim >= p_de::timestamptz
           union select apontamento_id from rec_apara_registros g join rec_lotes l on l.id = g.lote_id where g.empresa_id = p_empresa and l.data >= p_de loop
    v := public._rec_apara_aplicar(r.id); n := n + 1; kg := kg + coalesce(v, 0);
  end loop;
  return jsonb_build_object('apontamentos', n, 'kg', kg);
end $$;

-- ---------- importação da planilha da balança ----------
-- p_linhas: [{chave, data_hora, placa, motorista, fornecedor (documento ou nome), peso_bruto, tara, peso_liquido, material (código ou nome), classe (código), observacao}]
create or replace function public.rec_tickets_importar(p_empresa uuid, p_linhas jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; v_forn uuid; v_mat uuid; v_cla uuid; v_t uuid; v_chave text; v_liq numeric; criados int := 0; repetidos int := 0; erros jsonb := '[]'; i int := 0; v_doc text;
begin
  if not public.pode_apontar(p_empresa) then raise exception 'Acesso negado.'; end if;
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) > 2000 then raise exception 'Envie até 2.000 linhas.'; end if;
  for x in select * from jsonb_array_elements(p_linhas) loop
    i := i + 1;
    v_doc := regexp_replace(coalesce(x ->> 'fornecedor', ''), '\D', '', 'g');
    v_forn := null; v_mat := null; v_cla := null;
    if coalesce(x ->> 'fornecedor', '') <> '' then
      select id into v_forn from favorecidos where empresa_id = p_empresa and ativo
        and ((length(v_doc) in (11, 14) and regexp_replace(coalesce(documento, ''), '\D', '', 'g') = v_doc)
             or upper(unaccent_simples(nome)) = upper(unaccent_simples(trim(x ->> 'fornecedor'))))
       order by (regexp_replace(coalesce(documento, ''), '\D', '', 'g') = v_doc) desc limit 1;
      if v_forn is null then erros := erros || jsonb_build_object('linha', i, 'erro', 'Fornecedor não cadastrado: ' || (x ->> 'fornecedor')); continue; end if;
    end if;
    if coalesce(x ->> 'material', '') <> '' then
      select id into v_mat from rec_materiais where empresa_id = p_empresa and (upper(codigo) = upper(trim(x ->> 'material')) or upper(unaccent_simples(nome)) = upper(unaccent_simples(trim(x ->> 'material')))) limit 1;
      if v_mat is null then erros := erros || jsonb_build_object('linha', i, 'erro', 'Material não cadastrado: ' || (x ->> 'material')); continue; end if;
    end if;
    if coalesce(x ->> 'classe', '') <> '' then select id into v_cla from rec_classes where empresa_id = p_empresa and upper(codigo) = upper(trim(x ->> 'classe')) limit 1; end if;
    v_chave := coalesce(nullif(x ->> 'chave', ''), md5(concat_ws('|', x ->> 'data_hora', x ->> 'placa', x ->> 'fornecedor', x ->> 'peso_bruto', x ->> 'tara', x ->> 'peso_liquido', x ->> 'material')));
    if exists (select 1 from rec_tickets where empresa_id = p_empresa and chave_importacao = v_chave) then repetidos := repetidos + 1; continue; end if;
    begin
      insert into rec_tickets(empresa_id, data_hora, origem, fornecedor_id, placa, motorista, peso_bruto, tara, peso_liquido, observacao, chave_importacao)
      values (p_empresa, coalesce((x ->> 'data_hora')::timestamptz, now()), case when v_forn is null then 'transferencia' else 'compra' end, v_forn, x ->> 'placa', x ->> 'motorista',
              nullif(x ->> 'peso_bruto', '')::numeric, nullif(x ->> 'tara', '')::numeric, nullif(x ->> 'peso_liquido', '')::numeric, x ->> 'observacao', v_chave)
      returning id, peso_liquido into v_t, v_liq;
      if v_mat is not null and coalesce(v_liq, 0) > 0 then
        insert into rec_ticket_itens(empresa_id, ticket_id, material_id, classe_id, peso_kg) values (p_empresa, v_t, v_mat, v_cla, v_liq);
      end if;
      criados := criados + 1;
    exception when others then erros := erros || jsonb_build_object('linha', i, 'erro', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('criados', criados, 'repetidos', repetidos, 'erros', erros);
end $$;

-- ---------- relação para a nota de entrada (compras sem nota do fornecedor) ----------
create or replace function public.rec_relacao_nota(p_empresa uuid, p_de date, p_ate date) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.ve_producao(p_empresa) then (
    select coalesce(jsonb_agg(jsonb_build_object('fornecedor_id', f.id, 'fornecedor', f.nome, 'documento', f.documento, 'rec_tipo', f.rec_tipo, 'coletor_incentivado', f.rec_coletor_incentivado,
      'material', m.codigo || ' — ' || m.nome, 'ncm', m.ncm, 'tickets', z.tickets, 'kg', z.kg, 'valor', z.valor, 'preco_medio', round(z.valor / nullif(z.kg, 0), 4))
      order by f.nome, m.codigo), '[]')
      from (select t.fornecedor_id, i.material_id, string_agg(distinct t.numero::text, ', ') tickets, sum(i.peso_pago) kg, sum(i.valor) valor
              from rec_tickets t join rec_ticket_itens i on i.ticket_id = t.id
             where t.empresa_id = p_empresa and t.situacao = 'fechado' and t.origem = 'compra' and t.nf_numero is null and t.nf_chave is null
               and (t.data_hora at time zone 'America/Sao_Paulo')::date between p_de and p_ate
             group by t.fornecedor_id, i.material_id) z
      join favorecidos f on f.id = z.fornecedor_id join rec_materiais m on m.id = z.material_id) end
$$;

-- ---------- painel do mês ----------
create or replace function public.rec_painel(p_empresa uuid, p_mes date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_ini date := date_trunc('month', p_mes)::date; v_fim date := (date_trunc('month', p_mes) + interval '1 month - 1 day')::date; v jsonb;
begin
  if not public.ve_producao(p_empresa) then raise exception 'Acesso negado.'; end if;
  with tk as (
    select t.*, (t.data_hora at time zone 'America/Sao_Paulo')::date dia from rec_tickets t
     where t.empresa_id = p_empresa and t.situacao = 'fechado' and (t.data_hora at time zone 'America/Sao_Paulo')::date between v_ini and v_fim
  ), it as (select i.*, tk.dia, tk.fornecedor_id, tk.origem from rec_ticket_itens i join tk on tk.id = i.ticket_id),
  ap as (select l.material_id, l.data dia, g.kg from rec_apara_registros g join rec_lotes l on l.id = g.lote_id where g.empresa_id = p_empresa and l.data between v_ini and v_fim)
  select jsonb_build_object(
    'mes', v_ini,
    'comprado_kg', coalesce((select sum(peso_kg) from it where origem = 'compra'), 0),
    'pago_kg', coalesce((select sum(peso_pago) from it where origem = 'compra'), 0),
    'valor', coalesce((select sum(valor) from it where origem = 'compra'), 0),
    'outras_entradas_kg', coalesce((select sum(peso_pago) from it where origem <> 'compra'), 0),
    'apara_kg', coalesce((select sum(kg) from ap), 0),
    'tickets', (select count(*) from tk),
    'tickets_abertos', (select count(*) from rec_tickets where empresa_id = p_empresa and situacao = 'aberto'),
    'a_pagar', coalesce((select sum(valor) from lancamentos where empresa_id = p_empresa and origem = 'recuperadora' and status = 'Em aberto' and documento <> 'REC ADT'), 0),
    'adiant_saldo', coalesce((select sum(public._rec_adiant_saldo(id)) from rec_adiantamentos where empresa_id = p_empresa and situacao = 'aberto'), 0),
    'por_material', coalesce((select jsonb_agg(x order by (x ->> 'kg')::numeric desc) from (
        select jsonb_build_object('material', m.codigo || ' — ' || m.nome, 'kg', coalesce(c.kg, 0), 'pago_kg', coalesce(c.pago, 0), 'valor', coalesce(c.valor, 0), 'apara_kg', coalesce(a.kg, 0),
               'estoque_kg', coalesce((select sum(saldo_kg) from rec_lotes l where l.material_id = m.id and l.situacao in ('disponivel', 'bloqueado') and l.tipo <> 'grao'), 0)) x
          from rec_materiais m
          left join (select material_id, sum(peso_kg) kg, sum(peso_pago) pago, sum(valor) valor from it group by 1) c on c.material_id = m.id
          left join (select material_id, sum(kg) kg from ap group by 1) a on a.material_id = m.id
         where m.empresa_id = p_empresa and (c.kg is not null or a.kg is not null or exists (select 1 from rec_lotes l where l.material_id = m.id and l.situacao in ('disponivel', 'bloqueado')))) z), '[]'),
    'fornecedores', coalesce((select jsonb_agg(x order by (x ->> 'kg')::numeric desc) from (
        select jsonb_build_object('fornecedor', f.nome, 'rec_tipo', f.rec_tipo, 'tickets', count(distinct it.ticket_id), 'kg', sum(it.peso_kg), 'pago_kg', sum(it.peso_pago), 'valor', sum(it.valor),
               'desconto_pct', round(100 * (1 - sum(it.peso_pago) / nullif(sum(it.peso_kg), 0)), 2), 'preco_medio', round(sum(it.valor) / nullif(sum(it.peso_pago), 0), 4)) x
          from it join favorecidos f on f.id = it.fornecedor_id where it.origem = 'compra' group by f.id, f.nome, f.rec_tipo order by sum(it.peso_kg) desc limit 15) z), '[]'),
    'dias', coalesce((select jsonb_agg(jsonb_build_object('dia', d::date, 'compra_kg', coalesce((select sum(peso_kg) from it where it.dia = d::date and origem = 'compra'), 0),
                                                          'apara_kg', coalesce((select sum(kg) from ap where ap.dia = d::date), 0)) order by d)
                      from generate_series(v_ini, v_fim, interval '1 day') d), '[]'),
    'aparas_sem_material', (select count(*) from prod_apontamentos a where a.empresa_id = p_empresa and a.fim >= v_ini::timestamptz and a.fim < (v_fim + 1)::timestamptz and a.refugo > 0
                              and not exists (select 1 from rec_apara_registros g where g.apontamento_id = a.id)
                              and not exists (select 1 from rec_apara_regras r where r.empresa_id = p_empresa and r.ativo and r.ignorar
                                                and (r.maquina_id is null or r.maquina_id = a.maquina_id) and (r.setor_id is null or r.setor_id = a.setor_id) and (r.motivo_id is null or r.motivo_id = a.refugo_motivo_id))))
  into v;
  return v;
end $$;

-- ---------- padrões ao ligar o módulo ----------
create or replace function public.rec_configurar_padrao(p_empresa uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.pode_pcp(p_empresa) then raise exception 'Acesso negado.'; end if;
  insert into rec_config(empresa_id) values (p_empresa) on conflict do nothing;
  insert into rec_classes(empresa_id, codigo, nome, desconto_padrao_pct, ordem)
  select p_empresa, c, n, d, o from (values ('A', 'Limpo e seco', 2, 1), ('B', 'Sujeira leve', 8, 2), ('C', 'Sujo ou úmido', 15, 3)) v(c, n, d, o)
  on conflict (empresa_id, codigo) do nothing;
end $$;

do $$ declare f text; begin
  foreach f in array array['rec_preco(uuid, uuid, date)', 'rec_ticket_fechar(uuid)', 'rec_ticket_cancelar(uuid, text)', 'rec_ticket_nota(uuid, text, text)', 'rec_adiantamento_lancar(uuid, uuid, date, numeric, text)',
                           'rec_adiantamento_cancelar(uuid, text)', 'rec_aparas_reprocessar(uuid, date)', 'rec_tickets_importar(uuid, jsonb)', 'rec_relacao_nota(uuid, date, date)',
                           'rec_painel(uuid, date)', 'rec_configurar_padrao(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['_rec_ticket_antes()', '_rec_item_antes()', '_rec_adiant_saldo(uuid)', '_rec_lote_apara(uuid, uuid, date)', '_rec_apara_aplicar(uuid)', '_rec_apara_apont()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ---------- fotos da carga: recuperadora/<empresa>/<ticket>/<arquivo> ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recuperadora', 'recuperadora', false, 8388608, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
drop policy if exists recuperadora_arq_sel on storage.objects;
drop policy if exists recuperadora_arq_ins on storage.objects;
drop policy if exists recuperadora_arq_del on storage.objects;
create policy recuperadora_arq_sel on storage.objects for select to authenticated using (bucket_id = 'recuperadora' and public.ve_producao(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy recuperadora_arq_ins on storage.objects for insert to authenticated with check (bucket_id = 'recuperadora' and public.pode_apontar(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy recuperadora_arq_del on storage.objects for delete to authenticated using (bucket_id = 'recuperadora' and public.pode_apontar(public._uuid_ou_nulo((storage.foldername(name))[1])));

comment on table public.rec_config is 'Recuperadora: modo (interno/externo/ambos), aparas, balança, pagamento e Kardex (parte 1)';
comment on table public.rec_tickets is 'Recuperadora: ticket de pesagem da entrada de material (compra, doação, transferência)';
comment on table public.rec_lotes is 'Recuperadora: lotes de entrada, de apara interna e (parte 2) de grão, com saldo e custo';
