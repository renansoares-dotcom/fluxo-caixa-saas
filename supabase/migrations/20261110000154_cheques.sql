-- Controle de Cheques (SQL 154) — aditivo.
--   Cheques de terceiros (recebidos de clientes): carteira → depósito → compensação/devolução → reapresentação, resgate, cobrança ou perda;
--   repasse a fornecedor; envio ao FIDC dentro da Proposta de Borderô.
--   Cheques próprios (emitidos): talões, emissão ligada aos títulos a pagar, compensação, cancelamento, sustação e devolução.
-- Dinheiro: o cheque recebido baixa o título do cliente na conta "Cheques em carteira"; o depósito é uma transferência para o banco.
--           O cheque emitido baixa o título do fornecedor na conta "Cheques emitidos a compensar"; a compensação é a transferência do banco.
-- Nada muda nas tabelas e funções existentes, exceto _aprovar_proposta_fidc (passa a aceitar itens que são cheques) e a coluna
-- fidc_proposta_itens.cheque_id (nova, opcional).

-- ---------- parâmetros ----------
create table if not exists public.chq_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  conta_carteira_id uuid references public.contas(id) on delete set null,
  conta_emitidos_id uuid references public.contas(id) on delete set null,
  plano_transferencia_id uuid references public.plano_contas(id) on delete set null,
  plano_avulso_id uuid references public.plano_contas(id) on delete set null,             -- entrada do cheque recebido sem título
  plano_estorno_id uuid references public.plano_contas(id) on delete set null,            -- saída ao tirar o devolvido da carteira (cobrança)
  plano_perda_id uuid references public.plano_contas(id) on delete set null,
  plano_devolvido_receber_id uuid references public.plano_contas(id) on delete set null,  -- título "cheque devolvido a receber"
  plano_juros_id uuid references public.plano_contas(id) on delete set null,
  plano_tarifa_id uuid references public.plano_contas(id) on delete set null,
  plano_repasse_entrada_id uuid references public.plano_contas(id) on delete set null,    -- cheque repassado que voltou
  plano_repasse_pagar_id uuid references public.plano_contas(id) on delete set null,      -- dívida que volta com o fornecedor
  plano_fidc_devolvido_id uuid references public.plano_contas(id) on delete set null,     -- cheque do FIDC que voltou
  prazo_praca int not null default 30 check (prazo_praca between 1 and 365),
  prazo_fora int not null default 60 check (prazo_fora between 1 and 365),
  prescricao_meses int not null default 6 check (prescricao_meses between 1 and 60),
  max_reapresentacoes int not null default 1 check (max_reapresentacoes between 0 and 5),
  limite_cliente numeric(16,2) not null default 0 check (limite_cliente >= 0),            -- 0 = sem limite
  alerta_devolucoes int not null default 1 check (alerta_devolucoes between 1 and 20),    -- devoluções do emitente que acendem o aviso
  atualizado_em timestamptz not null default now()
);

-- ---------- cheques de terceiros ----------
create table if not exists public.chq_cheques (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  recebimento uuid not null,
  banco text not null, agencia text not null default '', conta text not null default '', numero text not null,
  cmc7 text,
  emitente text, emitente_doc text,
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  valor numeric(16,2) not null check (valor > 0),
  emissao date, bom_para date not null, recebido_em date not null,
  praca_outra boolean not null default false,
  situacao text not null default 'carteira' check (situacao in ('carteira','depositado','compensado','devolvido','fidc','repassado','resgatado','cobranca','perda','cancelado')),
  devolucoes int not null default 0,
  alinea text, devolvido_em date, origem_devolucao text check (origem_devolucao in ('deposito','fidc','repasse')),
  deposito_id uuid, conta_deposito_id uuid references public.contas(id) on delete set null,
  fidc_proposta_id uuid references public.fidc_propostas(id) on delete set null, fundo text,
  repasse_favorecido_id uuid references public.favorecidos(id) on delete set null,
  lanc_cobranca_id uuid references public.lancamentos(id) on delete set null,
  encerrado_em date,
  observacao text, fotos jsonb not null default '[]'::jsonb,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);
create index if not exists chq_cheques_emp on public.chq_cheques(empresa_id, situacao, bom_para);
create index if not exists chq_cheques_fav on public.chq_cheques(favorecido_id);
create index if not exists chq_cheques_rec on public.chq_cheques(recebimento);
create unique index if not exists chq_cheques_uniq on public.chq_cheques(empresa_id, banco, agencia, conta, numero) where situacao <> 'cancelado';

create table if not exists public.chq_receb_titulos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  recebimento uuid not null,
  lancamento_id uuid not null references public.lancamentos(id) on delete cascade,
  data_original date, avulso boolean not null default false
);
create index if not exists chq_receb_titulos_r on public.chq_receb_titulos(recebimento);

create table if not exists public.chq_depositos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null, data date not null,
  conta_id uuid not null references public.contas(id),
  qtd int not null, valor numeric(16,2) not null,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  unique (empresa_id, numero)
);

-- ---------- cheques próprios ----------
create table if not exists public.chq_taloes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conta_id uuid not null references public.contas(id) on delete cascade,
  numero_ini int not null check (numero_ini > 0), numero_fim int not null,
  ativo boolean not null default true, observacao text,
  created_at timestamptz not null default now(),
  check (numero_fim >= numero_ini and numero_fim - numero_ini < 1000)
);
create index if not exists chq_taloes_emp on public.chq_taloes(empresa_id, conta_id);

create table if not exists public.chq_emitidos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  conta_id uuid not null references public.contas(id),
  talao_id uuid references public.chq_taloes(id) on delete set null,
  numero int not null check (numero > 0),
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  nominal text,
  valor numeric(16,2) not null check (valor >= 0),
  emissao date not null, bom_para date not null,
  cruzado boolean not null default true,
  situacao text not null default 'emitido' check (situacao in ('emitido','compensado','cancelado','sustado','devolvido')),
  compensado_em date, lanc_compensacao_id uuid references public.lancamentos(id) on delete set null,
  alinea text, devolvido_em date, motivo text, observacao text,
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  unique (empresa_id, conta_id, numero)
);
create index if not exists chq_emitidos_emp on public.chq_emitidos(empresa_id, situacao, bom_para);

create table if not exists public.chq_emitido_titulos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  emitido_id uuid not null references public.chq_emitidos(id) on delete cascade,
  lancamento_id uuid not null references public.lancamentos(id) on delete cascade,
  data_original date, avulso boolean not null default false
);
create index if not exists chq_emitido_titulos_e on public.chq_emitido_titulos(emitido_id);

-- ---------- histórico ----------
create table if not exists public.chq_eventos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  cheque_id uuid references public.chq_cheques(id) on delete cascade,
  emitido_id uuid references public.chq_emitidos(id) on delete cascade,
  tipo text not null, data date not null, detalhe text,
  user_id uuid default auth.uid(), created_at timestamptz not null default now()
);
create index if not exists chq_eventos_c on public.chq_eventos(cheque_id);
create index if not exists chq_eventos_e on public.chq_eventos(emitido_id);

alter table public.fidc_proposta_itens add column if not exists cheque_id uuid references public.chq_cheques(id) on delete set null;
create index if not exists fidc_proposta_itens_chq on public.fidc_proposta_itens(cheque_id) where cheque_id is not null;

-- ---------- acesso ----------
do $$
declare t text;
begin
  foreach t in array array['chq_config', 'chq_cheques', 'chq_receb_titulos', 'chq_depositos', 'chq_taloes', 'chq_emitidos', 'chq_emitido_titulos', 'chq_eventos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_membro(empresa_id))', t || '_sel', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  foreach t in array array['chq_config', 'chq_taloes'] loop
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.pode_editar(empresa_id))', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id))', t || '_upd', t);
    execute format('grant insert, update on public.%I to authenticated', t);
  end loop;
  drop policy if exists chq_taloes_del on public.chq_taloes;
  create policy chq_taloes_del on public.chq_taloes for delete to authenticated using (public.pode_editar(empresa_id));
  grant delete on public.chq_taloes to authenticated;
  foreach t in array array['chq_config', 'chq_cheques', 'chq_depositos', 'chq_taloes', 'chq_emitidos'] loop
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;

-- ---------- apoio ----------
create or replace function public._chq_cfg(p_empresa uuid) returns public.chq_config
language plpgsql stable security definer set search_path = public as $$
declare c chq_config;
begin
  if not pode_editar(p_empresa) then raise exception 'Somente o financeiro ou o administrador movimenta cheques'; end if;
  select * into c from chq_config where empresa_id = p_empresa;
  if not found or c.conta_carteira_id is null or c.plano_transferencia_id is null then
    raise exception 'Configure o Controle de Cheques primeiro (Financeiro › Cheques › Parâmetros › Configurar padrão)';
  end if;
  return c;
end $$;

create or replace function public._chq_ev(p_empresa uuid, p_cheque uuid, p_emitido uuid, p_tipo text, p_data date, p_detalhe text) returns void
language sql security definer set search_path = public as $$
  insert into chq_eventos(empresa_id, cheque_id, emitido_id, tipo, data, detalhe) values (p_empresa, p_cheque, p_emitido, p_tipo, p_data, nullif(p_detalhe, ''));
$$;

create or replace function public._chq_lanc(p_empresa uuid, p_data date, p_plano uuid, p_desc text, p_fav uuid, p_status text, p_conta uuid, p_destino uuid, p_valor numeric, p_doc text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if p_plano is null then raise exception 'Falta definir uma conta do plano nos Parâmetros dos cheques para lançar "%"', p_desc; end if;
  insert into lancamentos(empresa_id, data, plano_id, descricao, favorecido_id, status, conta_id, conta_destino_id, valor, origem, documento)
  values (p_empresa, p_data, p_plano, p_desc, p_fav, p_status, p_conta, p_destino, p_valor, 'cheques', p_doc) returning id into v;
  return v;
end $$;

-- Cria as duas contas de cheques e sugere as contas do plano pelos códigos e nomes usuais. Pode rodar de novo: só completa o que falta.
create or replace function public.chq_configurar_padrao(p_empresa uuid) returns public.chq_config
language plpgsql security definer set search_path = public as $$
declare c chq_config; v_cart uuid; v_emit uuid;
  pl record;
begin
  if not pode_editar(p_empresa) then raise exception 'Somente o financeiro ou o administrador configura os cheques'; end if;
  insert into chq_config(empresa_id) values (p_empresa) on conflict (empresa_id) do nothing;
  select * into c from chq_config where empresa_id = p_empresa for update;
  if c.conta_carteira_id is null then
    select id into v_cart from contas where empresa_id = p_empresa and upper(nome) = 'CHEQUES EM CARTEIRA' limit 1;
    if v_cart is null then
      insert into contas(empresa_id, tipo, nome, disponibilidade) values (p_empresa, 'Cheques', 'CHEQUES EM CARTEIRA', 'Conta com recursos bloqueados') returning id into v_cart;
    end if;
  end if;
  if c.conta_emitidos_id is null then
    select id into v_emit from contas where empresa_id = p_empresa and upper(nome) = 'CHEQUES EMITIDOS A COMPENSAR' limit 1;
    if v_emit is null then
      insert into contas(empresa_id, tipo, nome, disponibilidade) values (p_empresa, 'Cheques', 'CHEQUES EMITIDOS A COMPENSAR', 'Conta com recursos bloqueados') returning id into v_emit;
    end if;
  end if;
  update chq_config set
    conta_carteira_id = coalesce(conta_carteira_id, v_cart),
    conta_emitidos_id = coalesce(conta_emitidos_id, v_emit),
    plano_transferencia_id = coalesce(plano_transferencia_id,
      (select id from plano_contas where empresa_id = p_empresa and nivel = 2 and tipo = 'T' and natureza = 'D' order by (codigo = '3.02.01') desc, codigo limit 1)),
    plano_avulso_id = coalesce(plano_avulso_id,
      (select id from plano_contas where empresa_id = p_empresa and nivel = 2 and natureza = 'C' and tipo <> 'T' and upper(nome) like '%RECEITA%CHEQUE%' order by codigo limit 1)),
    plano_devolvido_receber_id = coalesce(plano_devolvido_receber_id,
      (select id from plano_contas where empresa_id = p_empresa and nivel = 2 and natureza = 'C' and tipo <> 'T' and upper(nome) like '%CHEQUE%DEVOLVIDO%CLIENTE%' order by codigo limit 1)),
    plano_fidc_devolvido_id = coalesce(plano_fidc_devolvido_id,
      (select id from plano_contas where empresa_id = p_empresa and nivel = 2 and natureza = 'C' and tipo <> 'T' and upper(nome) like '%CHEQUE%DEVOLVIDO%CLIENTE%' order by codigo limit 1)),
    plano_repasse_entrada_id = coalesce(plano_repasse_entrada_id,
      (select id from plano_contas where empresa_id = p_empresa and nivel = 2 and natureza = 'C' and tipo <> 'T' and upper(nome) like '%CHEQUE%DEVOLVIDO%FORNECEDOR%' order by codigo limit 1)),
    plano_repasse_pagar_id = coalesce(plano_repasse_pagar_id,
      (select id from plano_contas where empresa_id = p_empresa and nivel = 2 and natureza = 'D' and tipo <> 'T' and upper(nome) like '%CHEQUE%DEVOLVIDO%FORNECEDOR%' order by codigo limit 1)),
    plano_juros_id = coalesce(plano_juros_id,
      (select id from plano_contas where empresa_id = p_empresa and nivel = 2 and natureza = 'C' and tipo <> 'T' and upper(nome) like '%JUROS%RECEBID%' order by codigo limit 1)),
    atualizado_em = now()
   where empresa_id = p_empresa returning * into c;
  return c;
end $$;

-- títulos em aberto de uma natureza (C = a receber, D = a pagar), travados para a baixa
create or replace function public._chq_titulos(p_empresa uuid, p_titulos uuid[], p_natureza text) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_n int; v_tot numeric;
begin
  if coalesce(array_length(p_titulos, 1), 0) = 0 then return 0; end if;
  select count(*), coalesce(sum(l.valor), 0) into v_n, v_tot
    from lancamentos l join plano_contas p on p.id = l.plano_id
   where l.id = any(p_titulos) and l.empresa_id = p_empresa and l.status = 'Em aberto' and l.fidc_proposta_id is null and p.natureza = p_natureza and p.tipo <> 'T';
  if v_n <> (select count(distinct x) from unnest(p_titulos) x) then
    raise exception 'Algum título escolhido não está em aberto, está em borderô de FIDC ou não é %', case p_natureza when 'C' then 'a receber' else 'a pagar' end;
  end if;
  perform 1 from lancamentos where id = any(p_titulos) for update;
  return v_tot;
end $$;

-- ---------- cheques de terceiros: receber ----------
-- p_cheques: [{banco, agencia, conta, numero, cmc7, emitente, emitente_doc, valor, emissao, bom_para, praca_outra, observacao}]
-- Com títulos: baixa os títulos do cliente na conta Cheques em carteira (a soma dos cheques não pode ser menor que a dos títulos;
-- a sobra entra como recebimento avulso em p_plano). Sem títulos: entra tudo como avulso em p_plano (ou no plano padrão).
create or replace function public.chq_receber(p_empresa uuid, p_favorecido uuid, p_data date, p_cheques jsonb, p_titulos uuid[] default '{}', p_plano uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare c chq_config; v_rec uuid := gen_random_uuid(); x jsonb; v_tot numeric := 0; v_tit numeric; v_id uuid; v_n int := 0; v_aberto numeric; v_l uuid; v_nums text := '';
begin
  c := _chq_cfg(p_empresa);
  if p_data is null then raise exception 'Informe a data do recebimento'; end if;
  if jsonb_typeof(p_cheques) <> 'array' or jsonb_array_length(p_cheques) = 0 then raise exception 'Informe ao menos um cheque'; end if;
  if p_favorecido is not null and not exists (select 1 from favorecidos where id = p_favorecido and empresa_id = p_empresa) then raise exception 'Cliente inválido'; end if;
  for x in select * from jsonb_array_elements(p_cheques) loop
    if coalesce(trim(x->>'banco'), '') = '' or coalesce(trim(x->>'numero'), '') = '' then raise exception 'Cada cheque precisa do banco e do número'; end if;
    if coalesce((x->>'valor')::numeric, 0) <= 0 then raise exception 'Cheque % sem valor', x->>'numero'; end if;
    if nullif(x->>'bom_para', '') is null then raise exception 'Cheque % sem a data "bom para"', x->>'numero'; end if;
    begin
      insert into chq_cheques(empresa_id, recebimento, banco, agencia, conta, numero, cmc7, emitente, emitente_doc, favorecido_id, valor, emissao, bom_para, recebido_em, praca_outra, observacao)
      values (p_empresa, v_rec, trim(x->>'banco'), coalesce(trim(x->>'agencia'), ''), coalesce(trim(x->>'conta'), ''), trim(x->>'numero'), nullif(regexp_replace(coalesce(x->>'cmc7', ''), '\D', '', 'g'), ''),
              nullif(trim(x->>'emitente'), ''), nullif(regexp_replace(coalesce(x->>'emitente_doc', ''), '\D', '', 'g'), ''), p_favorecido, round((x->>'valor')::numeric, 2),
              nullif(x->>'emissao', '')::date, (x->>'bom_para')::date, p_data, coalesce((x->>'praca_outra')::boolean, false), nullif(trim(x->>'observacao'), ''))
      returning id into v_id;
    exception when unique_violation then
      raise exception 'O cheque nº % do banco % (ag. %, conta %) já está cadastrado', x->>'numero', x->>'banco', coalesce(x->>'agencia', ''), coalesce(x->>'conta', '');
    end;
    perform _chq_ev(p_empresa, v_id, null, 'recebido', p_data, 'bom para ' || to_char((x->>'bom_para')::date, 'DD/MM/YYYY'));
    v_tot := v_tot + round((x->>'valor')::numeric, 2); v_n := v_n + 1; v_nums := v_nums || case when v_nums = '' then '' else ', ' end || trim(x->>'numero');
  end loop;
  if c.limite_cliente > 0 and p_favorecido is not null then
    select coalesce(sum(valor), 0) into v_aberto from chq_cheques where empresa_id = p_empresa and favorecido_id = p_favorecido and situacao in ('carteira', 'depositado', 'devolvido', 'fidc', 'repassado');
    if v_aberto > c.limite_cliente and not exists (select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text = 'admin') then
      raise exception 'Este cliente passaria a ter R$ % em cheques em aberto, acima do limite de R$ % (Parâmetros). Só o administrador recebe acima do limite.', to_char(v_aberto, 'FM999G999G990D00'), to_char(c.limite_cliente, 'FM999G999G990D00');
    end if;
  end if;
  v_tit := _chq_titulos(p_empresa, p_titulos, 'C');
  if v_tit - v_tot > 0.05 then
    raise exception 'Os cheques somam R$ % e os títulos R$ %. Divida o título ou receba a diferença de outra forma antes.', to_char(v_tot, 'FM999G999G990D00'), to_char(v_tit, 'FM999G999G990D00');
  end if;
  if v_tit > 0 then
    insert into chq_receb_titulos(empresa_id, recebimento, lancamento_id, data_original) select p_empresa, v_rec, id, data from lancamentos where id = any(p_titulos);
    update lancamentos set status = 'Pago', data = p_data, conta_id = c.conta_carteira_id where id = any(p_titulos);
  end if;
  if v_tot - v_tit > 0.05 then
    v_l := _chq_lanc(p_empresa, p_data, coalesce(p_plano, c.plano_avulso_id), format('Recebido em cheque (%s)', v_nums), p_favorecido, 'Pago', c.conta_carteira_id, null, v_tot - v_tit, 'CH ' || split_part(v_nums, ',', 1));
    if (select natureza from plano_contas where id = coalesce(p_plano, c.plano_avulso_id)) <> 'C' then raise exception 'A conta do plano do recebimento avulso precisa ser de entrada'; end if;
    insert into chq_receb_titulos(empresa_id, recebimento, lancamento_id, avulso) values (p_empresa, v_rec, v_l, true);
  end if;
  return v_rec;
end $$;

-- corrige os dados de cadastro enquanto o cheque está em carteira (o valor não muda: cancele o recebimento e refaça)
create or replace function public.chq_editar(p_id uuid, p_dados jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare q chq_cheques;
begin
  select * into q from chq_cheques where id = p_id for update;
  if not found then raise exception 'Cheque não encontrado'; end if;
  perform _chq_cfg(q.empresa_id);
  if p_dados ?| array['banco', 'agencia', 'conta', 'numero', 'bom_para', 'emissao', 'praca_outra'] and q.situacao <> 'carteira' then
    raise exception 'Só dá para corrigir banco, número e datas enquanto o cheque está em carteira';
  end if;
  begin
    update chq_cheques set
      banco = coalesce(nullif(trim(p_dados->>'banco'), ''), banco), agencia = coalesce(trim(p_dados->>'agencia'), agencia), conta = coalesce(trim(p_dados->>'conta'), conta),
      numero = coalesce(nullif(trim(p_dados->>'numero'), ''), numero),
      cmc7 = case when p_dados ? 'cmc7' then nullif(regexp_replace(coalesce(p_dados->>'cmc7', ''), '\D', '', 'g'), '') else cmc7 end,
      emitente = case when p_dados ? 'emitente' then nullif(trim(p_dados->>'emitente'), '') else emitente end,
      emitente_doc = case when p_dados ? 'emitente_doc' then nullif(regexp_replace(coalesce(p_dados->>'emitente_doc', ''), '\D', '', 'g'), '') else emitente_doc end,
      emissao = case when p_dados ? 'emissao' then nullif(p_dados->>'emissao', '')::date else emissao end,
      bom_para = coalesce(nullif(p_dados->>'bom_para', '')::date, bom_para),
      praca_outra = coalesce((p_dados->>'praca_outra')::boolean, praca_outra),
      observacao = case when p_dados ? 'observacao' then nullif(trim(p_dados->>'observacao'), '') else observacao end,
      fotos = case when jsonb_typeof(p_dados->'fotos') = 'array' then p_dados->'fotos' else fotos end
     where id = p_id;
  exception when unique_violation then raise exception 'Já existe outro cheque com esse banco, agência, conta e número';
  end;
end $$;

-- desfaz o recebimento inteiro (todos os cheques dele ainda em carteira): os títulos voltam a ficar em aberto
create or replace function public.chq_cancelar_recebimento(p_recebimento uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; r record;
begin
  select empresa_id into v_emp from chq_cheques where recebimento = p_recebimento limit 1;
  if v_emp is null then raise exception 'Recebimento não encontrado'; end if;
  perform _chq_cfg(v_emp);
  if coalesce(length(trim(p_motivo)), 0) < 5 then raise exception 'Informe o motivo do cancelamento'; end if;
  if exists (select 1 from chq_cheques where recebimento = p_recebimento and situacao <> 'carteira') then
    raise exception 'Algum cheque deste recebimento já saiu da carteira (depósito, FIDC ou repasse). Desfaça esse passo antes.';
  end if;
  if exists (select 1 from fidc_proposta_itens i join fidc_propostas p on p.id = i.proposta_id join chq_cheques q on q.id = i.cheque_id
              where q.recebimento = p_recebimento and p.status in ('Rascunho', 'Pendente')) then
    raise exception 'Algum cheque deste recebimento está numa proposta de borderô. Tire-o da proposta antes.';
  end if;
  for r in select * from chq_receb_titulos where recebimento = p_recebimento loop
    if r.avulso then delete from lancamentos where id = r.lancamento_id;
    else update lancamentos set status = 'Em aberto', conta_id = null, data = coalesce(r.data_original, data) where id = r.lancamento_id; end if;
  end loop;
  delete from chq_receb_titulos where recebimento = p_recebimento;
  update chq_cheques set situacao = 'cancelado', encerrado_em = current_date, observacao = concat_ws(' | ', observacao, 'cancelado: ' || trim(p_motivo)) where recebimento = p_recebimento;
  insert into chq_eventos(empresa_id, cheque_id, tipo, data, detalhe) select v_emp, id, 'cancelado', current_date, trim(p_motivo) from chq_cheques where recebimento = p_recebimento;
end $$;

-- ---------- depósito (borderô de depósito) ----------
create or replace function public.chq_depositar(p_empresa uuid, p_ids uuid[], p_conta uuid, p_data date) returns uuid
language plpgsql security definer set search_path = public as $$
declare c chq_config; v_n int; v_tot numeric; v_dep uuid; v_num int; v_l uuid; v_ruim text;
begin
  c := _chq_cfg(p_empresa);
  if p_data is null or coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Escolha os cheques e a data do depósito'; end if;
  if not exists (select 1 from contas where id = p_conta and empresa_id = p_empresa) or p_conta in (c.conta_carteira_id, c.conta_emitidos_id) then raise exception 'Escolha a conta bancária do depósito'; end if;
  perform 1 from chq_cheques where id = any(p_ids) for update;
  select count(*), sum(valor) into v_n, v_tot from chq_cheques where id = any(p_ids) and empresa_id = p_empresa
     and (situacao = 'carteira' or (situacao = 'devolvido' and devolucoes <= c.max_reapresentacoes));
  if v_n <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception 'Algum cheque não está em carteira ou já passou do limite de reapresentações (%)', c.max_reapresentacoes;
  end if;
  select string_agg(numero, ', ') into v_ruim from chq_cheques where id = any(p_ids) and bom_para > p_data;
  if v_ruim is not null then raise exception 'Cheque(s) % ainda não chegaram na data "bom para"', v_ruim; end if;
  if exists (select 1 from fidc_proposta_itens i join fidc_propostas p on p.id = i.proposta_id where i.cheque_id = any(p_ids) and p.status in ('Rascunho', 'Pendente')) then
    raise exception 'Algum cheque está numa proposta de borderô em aberto. Tire-o da proposta antes de depositar.';
  end if;
  perform pg_advisory_xact_lock(hashtext('chq_dep' || p_empresa::text));
  select coalesce(max(numero), 0) + 1 into v_num from chq_depositos where empresa_id = p_empresa;
  v_l := _chq_lanc(p_empresa, p_data, c.plano_transferencia_id, format('Depósito de cheques nº %s (%s cheque%s)', v_num, v_n, case when v_n > 1 then 's' else '' end), null, 'Pago', c.conta_carteira_id, p_conta, v_tot, 'DEP ' || v_num);
  insert into chq_depositos(empresa_id, numero, data, conta_id, qtd, valor, lancamento_id) values (p_empresa, v_num, p_data, p_conta, v_n, v_tot, v_l) returning id into v_dep;
  insert into chq_eventos(empresa_id, cheque_id, tipo, data, detalhe)
    select p_empresa, id, case when situacao = 'devolvido' then 'reapresentado' else 'depositado' end, p_data, 'depósito nº ' || v_num from chq_cheques where id = any(p_ids);
  update chq_cheques set situacao = 'depositado', deposito_id = v_dep, conta_deposito_id = p_conta where id = any(p_ids);
  return v_dep;
end $$;

create or replace function public.chq_deposito_cancelar(p_deposito uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d chq_depositos;
begin
  select * into d from chq_depositos where id = p_deposito for update;
  if not found then raise exception 'Depósito não encontrado'; end if;
  perform _chq_cfg(d.empresa_id);
  if exists (select 1 from chq_cheques where deposito_id = p_deposito and situacao <> 'depositado') then
    raise exception 'Algum cheque deste depósito já foi compensado ou devolvido';
  end if;
  delete from lancamentos where id = d.lancamento_id;
  insert into chq_eventos(empresa_id, cheque_id, tipo, data, detalhe) select d.empresa_id, id, 'depósito cancelado', current_date, 'depósito nº ' || d.numero from chq_cheques where deposito_id = p_deposito;
  update chq_cheques set situacao = case when devolucoes > 0 then 'devolvido' else 'carteira' end, deposito_id = null, conta_deposito_id = null where deposito_id = p_deposito;
  delete from chq_depositos where id = p_deposito;
end $$;

-- ---------- compensação (depositado, no FIDC ou repassado): encerra o cheque, sem mexer em dinheiro ----------
create or replace function public.chq_compensar(p_ids uuid[], p_data date) returns int
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_n int;
begin
  select empresa_id into v_emp from chq_cheques where id = any(p_ids) limit 1;
  if v_emp is null then raise exception 'Escolha os cheques'; end if;
  perform _chq_cfg(v_emp);
  if p_data is null then raise exception 'Informe a data'; end if;
  if exists (select 1 from chq_cheques where id = any(p_ids) and (empresa_id <> v_emp or situacao not in ('depositado', 'fidc', 'repassado'))) then
    raise exception 'Só cheques depositados, enviados ao FIDC ou repassados podem ser marcados como compensados';
  end if;
  insert into chq_eventos(empresa_id, cheque_id, tipo, data, detalhe) select v_emp, id, 'compensado', p_data, 'estava ' || situacao from chq_cheques where id = any(p_ids);
  update chq_cheques set situacao = 'compensado', encerrado_em = p_data where id = any(p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------- devolução ----------
create or replace function public.chq_devolver(p_id uuid, p_data date, p_alinea text, p_tarifa numeric default 0) returns void
language plpgsql security definer set search_path = public as $$
declare q chq_cheques; c chq_config; v_org text; v_doc text;
begin
  select * into q from chq_cheques where id = p_id for update;
  if not found then raise exception 'Cheque não encontrado'; end if;
  c := _chq_cfg(q.empresa_id);
  if p_data is null or coalesce(trim(p_alinea), '') = '' then raise exception 'Informe a data e o motivo (alínea) da devolução'; end if;
  v_doc := 'CH ' || q.numero;
  if q.situacao in ('depositado', 'compensado') and q.conta_deposito_id is not null then
    v_org := 'deposito';
    perform _chq_lanc(q.empresa_id, p_data, c.plano_transferencia_id, format('Cheque devolvido nº %s (alínea %s)', q.numero, trim(p_alinea)), q.favorecido_id, 'Pago', q.conta_deposito_id, c.conta_carteira_id, q.valor, v_doc);
    if coalesce(p_tarifa, 0) > 0 then
      perform _chq_lanc(q.empresa_id, p_data, c.plano_tarifa_id, format('Tarifa de devolução do cheque nº %s', q.numero), null, 'Pago', q.conta_deposito_id, null, round(p_tarifa, 2), v_doc);
    end if;
  elsif q.situacao = 'fidc' then
    v_org := 'fidc';
    perform _chq_lanc(q.empresa_id, p_data, c.plano_fidc_devolvido_id, format('Cheque nº %s devolvido pelo %s (alínea %s)', q.numero, coalesce(q.fundo, 'fundo'), trim(p_alinea)), q.favorecido_id, 'Pago', c.conta_carteira_id, null, q.valor, v_doc);
  elsif q.situacao = 'repassado' then
    v_org := 'repasse';
    perform _chq_lanc(q.empresa_id, p_data, c.plano_repasse_entrada_id, format('Cheque repassado nº %s devolvido (alínea %s)', q.numero, trim(p_alinea)), q.repasse_favorecido_id, 'Pago', c.conta_carteira_id, null, q.valor, v_doc);
    perform _chq_lanc(q.empresa_id, p_data, c.plano_repasse_pagar_id, format('Cheque repassado nº %s devolvido: valor a pagar de novo', q.numero), q.repasse_favorecido_id, 'Em aberto', null, null, q.valor, v_doc);
  else
    raise exception 'Só cheques depositados, enviados ao FIDC ou repassados podem ser devolvidos (este está %)', q.situacao;
  end if;
  update chq_cheques set situacao = 'devolvido', devolucoes = devolucoes + 1, alinea = trim(p_alinea), devolvido_em = p_data, origem_devolucao = v_org, encerrado_em = null where id = p_id;
  perform _chq_ev(q.empresa_id, p_id, null, 'devolvido', p_data, 'alínea ' || trim(p_alinea) || case v_org when 'fidc' then ' · pelo fundo' when 'repasse' then ' · pelo fornecedor' else '' end);
end $$;

-- o cliente paga o cheque devolvido (dinheiro, PIX, TED) e leva o cheque
create or replace function public.chq_resgatar(p_id uuid, p_conta uuid, p_data date, p_juros numeric default 0) returns void
language plpgsql security definer set search_path = public as $$
declare q chq_cheques; c chq_config;
begin
  select * into q from chq_cheques where id = p_id for update;
  if not found then raise exception 'Cheque não encontrado'; end if;
  c := _chq_cfg(q.empresa_id);
  if q.situacao <> 'devolvido' then raise exception 'Só cheque devolvido pode ser resgatado'; end if;
  if p_data is null or not exists (select 1 from contas where id = p_conta and empresa_id = q.empresa_id) or p_conta in (c.conta_carteira_id, c.conta_emitidos_id) then
    raise exception 'Informe a data e a conta em que o cliente pagou';
  end if;
  perform _chq_lanc(q.empresa_id, p_data, c.plano_transferencia_id, format('Resgate do cheque devolvido nº %s', q.numero), q.favorecido_id, 'Pago', c.conta_carteira_id, p_conta, q.valor, 'CH ' || q.numero);
  if coalesce(p_juros, 0) > 0 then
    perform _chq_lanc(q.empresa_id, p_data, c.plano_juros_id, format('Juros do cheque devolvido nº %s', q.numero), q.favorecido_id, 'Pago', p_conta, null, round(p_juros, 2), 'CH ' || q.numero);
  end if;
  update chq_cheques set situacao = 'resgatado', encerrado_em = p_data where id = p_id;
  perform _chq_ev(q.empresa_id, p_id, null, 'resgatado', p_data, case when coalesce(p_juros, 0) > 0 then 'com juros de R$ ' || to_char(p_juros, 'FM999G990D00') end);
end $$;

-- tira o cheque devolvido da carteira e abre um título a receber contra o cliente (cobrança, protesto, acordo)
create or replace function public.chq_cobrar(p_id uuid, p_data date, p_vencimento date) returns uuid
language plpgsql security definer set search_path = public as $$
declare q chq_cheques; c chq_config; v_l uuid;
begin
  select * into q from chq_cheques where id = p_id for update;
  if not found then raise exception 'Cheque não encontrado'; end if;
  c := _chq_cfg(q.empresa_id);
  if q.situacao <> 'devolvido' then raise exception 'Só cheque devolvido vai para cobrança'; end if;
  if p_data is null or p_vencimento is null then raise exception 'Informe a data e o vencimento do título de cobrança'; end if;
  perform _chq_lanc(q.empresa_id, p_data, c.plano_estorno_id, format('Cheque devolvido nº %s enviado para cobrança', q.numero), q.favorecido_id, 'Pago', c.conta_carteira_id, null, q.valor, 'CH ' || q.numero);
  v_l := _chq_lanc(q.empresa_id, p_vencimento, c.plano_devolvido_receber_id, format('Cheque devolvido nº %s (banco %s, alínea %s)', q.numero, q.banco, coalesce(q.alinea, '')), q.favorecido_id, 'Em aberto', null, null, q.valor, 'CH ' || q.numero);
  update chq_cheques set situacao = 'cobranca', lanc_cobranca_id = v_l where id = p_id;
  perform _chq_ev(q.empresa_id, p_id, null, 'cobrança', p_data, 'título a receber com vencimento em ' || to_char(p_vencimento, 'DD/MM/YYYY'));
  return v_l;
end $$;

create or replace function public.chq_perda(p_id uuid, p_data date, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare q chq_cheques; c chq_config;
begin
  select * into q from chq_cheques where id = p_id for update;
  if not found then raise exception 'Cheque não encontrado'; end if;
  c := _chq_cfg(q.empresa_id);
  if q.situacao <> 'devolvido' then raise exception 'Só cheque devolvido pode ser baixado como perda'; end if;
  if p_data is null or coalesce(length(trim(p_motivo)), 0) < 5 then raise exception 'Informe a data e o motivo da perda'; end if;
  perform _chq_lanc(q.empresa_id, p_data, coalesce(c.plano_perda_id, c.plano_estorno_id), format('Perda com o cheque devolvido nº %s', q.numero), q.favorecido_id, 'Pago', c.conta_carteira_id, null, q.valor, 'CH ' || q.numero);
  update chq_cheques set situacao = 'perda', encerrado_em = p_data where id = p_id;
  perform _chq_ev(q.empresa_id, p_id, null, 'perda', p_data, trim(p_motivo));
end $$;

-- ---------- repasse a fornecedor ----------
create or replace function public.chq_repassar(p_empresa uuid, p_ids uuid[], p_favorecido uuid, p_data date, p_titulos uuid[] default '{}', p_plano uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare c chq_config; v_n int; v_tot numeric; v_tit numeric; v_nums text;
begin
  c := _chq_cfg(p_empresa);
  if p_data is null or coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Escolha os cheques e a data do repasse'; end if;
  if not exists (select 1 from favorecidos where id = p_favorecido and empresa_id = p_empresa) then raise exception 'Escolha o fornecedor que recebe os cheques'; end if;
  perform 1 from chq_cheques where id = any(p_ids) for update;
  select count(*), sum(valor), string_agg(numero, ', ') into v_n, v_tot, v_nums from chq_cheques where id = any(p_ids) and empresa_id = p_empresa and situacao = 'carteira';
  if v_n <> (select count(distinct x) from unnest(p_ids) x) then raise exception 'Só cheques em carteira podem ser repassados'; end if;
  if exists (select 1 from fidc_proposta_itens i join fidc_propostas p on p.id = i.proposta_id where i.cheque_id = any(p_ids) and p.status in ('Rascunho', 'Pendente')) then
    raise exception 'Algum cheque está numa proposta de borderô em aberto';
  end if;
  v_tit := _chq_titulos(p_empresa, p_titulos, 'D');
  if v_tit - v_tot > 0.05 then
    raise exception 'Os cheques somam R$ % e os títulos a pagar R$ %. Divida o título ou pague a diferença de outra forma antes.', to_char(v_tot, 'FM999G999G990D00'), to_char(v_tit, 'FM999G999G990D00');
  end if;
  if v_tit > 0 then update lancamentos set status = 'Pago', data = p_data, conta_id = c.conta_carteira_id where id = any(p_titulos); end if;
  if v_tot - v_tit > 0.05 then
    if p_plano is null or (select natureza from plano_contas where id = p_plano and empresa_id = p_empresa) is distinct from 'D' then
      raise exception 'Os cheques somam R$ % a mais que os títulos: escolha a conta do plano (de saída) para a diferença', to_char(v_tot - v_tit, 'FM999G999G990D00');
    end if;
    perform _chq_lanc(p_empresa, p_data, p_plano, format('Pago com cheque de terceiros (%s)', v_nums), p_favorecido, 'Pago', c.conta_carteira_id, null, v_tot - v_tit, 'CH ' || split_part(v_nums, ',', 1));
  end if;
  update chq_cheques set situacao = 'repassado', repasse_favorecido_id = p_favorecido where id = any(p_ids);
  insert into chq_eventos(empresa_id, cheque_id, tipo, data, detalhe) select p_empresa, id, 'repassado', p_data, (select nome from favorecidos where id = p_favorecido) from chq_cheques where id = any(p_ids);
end $$;

-- ---------- cheques próprios ----------
create or replace function public.chq_emitir(p_empresa uuid, p_conta uuid, p_numero int, p_favorecido uuid, p_nominal text, p_valor numeric, p_emissao date, p_bom_para date,
                                             p_titulos uuid[] default '{}', p_plano uuid default null, p_obs text default null, p_cruzado boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare c chq_config; v_num int := p_numero; v_talao uuid; v_tit numeric; v_id uuid; v_l uuid;
begin
  c := _chq_cfg(p_empresa);
  if c.conta_emitidos_id is null then raise exception 'Defina a conta "Cheques emitidos a compensar" nos Parâmetros'; end if;
  if not exists (select 1 from contas where id = p_conta and empresa_id = p_empresa) or p_conta in (c.conta_carteira_id, c.conta_emitidos_id) then raise exception 'Escolha a conta bancária do cheque'; end if;
  if coalesce(p_valor, 0) <= 0 or p_emissao is null then raise exception 'Informe o valor e a data de emissão'; end if;
  perform pg_advisory_xact_lock(hashtext('chq_emit' || p_conta::text));
  if v_num is null then
    select t.id, n into v_talao, v_num from chq_taloes t, generate_series(t.numero_ini, t.numero_fim) n
     where t.empresa_id = p_empresa and t.conta_id = p_conta and t.ativo and not exists (select 1 from chq_emitidos e where e.conta_id = p_conta and e.numero = n)
     order by t.numero_ini, n limit 1;
    if v_num is null then raise exception 'Não há folha livre nos talões desta conta. Cadastre um talão ou informe o número do cheque.'; end if;
  else
    select id into v_talao from chq_taloes where empresa_id = p_empresa and conta_id = p_conta and v_num between numero_ini and numero_fim limit 1;
  end if;
  if exists (select 1 from chq_emitidos where empresa_id = p_empresa and conta_id = p_conta and numero = v_num) then raise exception 'O cheque nº % desta conta já foi usado', v_num; end if;
  v_tit := _chq_titulos(p_empresa, p_titulos, 'D');
  if v_tit > 0 and abs(v_tit - p_valor) > 0.05 then
    raise exception 'O cheque é de R$ % e os títulos somam R$ %: o cheque próprio precisa ter o valor exato dos títulos', to_char(p_valor, 'FM999G999G990D00'), to_char(v_tit, 'FM999G999G990D00');
  end if;
  insert into chq_emitidos(empresa_id, conta_id, talao_id, numero, favorecido_id, nominal, valor, emissao, bom_para, cruzado, observacao)
  values (p_empresa, p_conta, v_talao, v_num, p_favorecido, nullif(trim(p_nominal), ''), round(p_valor, 2), p_emissao, coalesce(p_bom_para, p_emissao), coalesce(p_cruzado, true), nullif(trim(p_obs), ''))
  returning id into v_id;
  if v_tit > 0 then
    insert into chq_emitido_titulos(empresa_id, emitido_id, lancamento_id, data_original) select p_empresa, v_id, id, data from lancamentos where id = any(p_titulos);
    update lancamentos set status = 'Pago', data = p_emissao, conta_id = c.conta_emitidos_id where id = any(p_titulos);
  else
    if p_plano is null or (select natureza from plano_contas where id = p_plano and empresa_id = p_empresa) is distinct from 'D' then
      raise exception 'Cheque sem título: escolha a conta do plano (de saída) do pagamento';
    end if;
    v_l := _chq_lanc(p_empresa, p_emissao, p_plano, format('Cheque nº %s%s', v_num, case when nullif(trim(p_obs), '') is not null then ' — ' || trim(p_obs) else '' end), p_favorecido, 'Pago', c.conta_emitidos_id, null, round(p_valor, 2), 'CH ' || v_num);
    insert into chq_emitido_titulos(empresa_id, emitido_id, lancamento_id, avulso) values (p_empresa, v_id, v_l, true);
  end if;
  perform _chq_ev(p_empresa, null, v_id, 'emitido', p_emissao, 'bom para ' || to_char(coalesce(p_bom_para, p_emissao), 'DD/MM/YYYY'));
  return v_id;
end $$;

create or replace function public.chq_emitido_compensar(p_id uuid, p_data date) returns void
language plpgsql security definer set search_path = public as $$
declare e chq_emitidos; c chq_config; v_l uuid;
begin
  select * into e from chq_emitidos where id = p_id for update;
  if not found then raise exception 'Cheque não encontrado'; end if;
  c := _chq_cfg(e.empresa_id);
  if e.situacao not in ('emitido', 'devolvido') then raise exception 'Este cheque está % e não pode ser compensado', e.situacao; end if;
  if p_data is null then raise exception 'Informe a data da compensação'; end if;
  v_l := _chq_lanc(e.empresa_id, p_data, c.plano_transferencia_id, format('Compensação do cheque nº %s', e.numero), e.favorecido_id, 'Pago', e.conta_id, c.conta_emitidos_id, e.valor, 'CH ' || e.numero);
  update chq_emitidos set situacao = 'compensado', compensado_em = p_data, lanc_compensacao_id = v_l where id = p_id;
  perform _chq_ev(e.empresa_id, null, p_id, 'compensado', p_data, null);
end $$;

-- cancela (ou susta) o cheque ainda não compensado: os títulos voltam a ficar em aberto
create or replace function public.chq_emitido_cancelar(p_id uuid, p_motivo text, p_sustar boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare e chq_emitidos; r record;
begin
  select * into e from chq_emitidos where id = p_id for update;
  if not found then raise exception 'Cheque não encontrado'; end if;
  perform _chq_cfg(e.empresa_id);
  if e.situacao not in ('emitido', 'devolvido') then raise exception 'Este cheque está % e não pode ser cancelado', e.situacao; end if;
  if coalesce(length(trim(p_motivo)), 0) < 5 then raise exception 'Informe o motivo'; end if;
  for r in select * from chq_emitido_titulos where emitido_id = p_id loop
    if r.avulso then delete from lancamentos where id = r.lancamento_id;
    else update lancamentos set status = 'Em aberto', conta_id = null, data = coalesce(r.data_original, data) where id = r.lancamento_id; end if;
  end loop;
  delete from chq_emitido_titulos where emitido_id = p_id;
  update chq_emitidos set situacao = case when p_sustar then 'sustado' else 'cancelado' end, motivo = trim(p_motivo) where id = p_id;
  perform _chq_ev(e.empresa_id, null, p_id, case when p_sustar then 'sustado' else 'cancelado' end, current_date, trim(p_motivo));
end $$;

create or replace function public.chq_emitido_devolver(p_id uuid, p_data date, p_alinea text) returns void
language plpgsql security definer set search_path = public as $$
declare e chq_emitidos;
begin
  select * into e from chq_emitidos where id = p_id for update;
  if not found then raise exception 'Cheque não encontrado'; end if;
  perform _chq_cfg(e.empresa_id);
  if e.situacao <> 'emitido' then raise exception 'Só cheque emitido e ainda não compensado pode ser marcado como devolvido'; end if;
  if p_data is null or coalesce(trim(p_alinea), '') = '' then raise exception 'Informe a data e o motivo (alínea)'; end if;
  update chq_emitidos set situacao = 'devolvido', devolvido_em = p_data, alinea = trim(p_alinea) where id = p_id;
  perform _chq_ev(e.empresa_id, null, p_id, 'devolvido', p_data, 'alínea ' || trim(p_alinea));
end $$;

-- folha inutilizada (rasura, extravio): ocupa o número sem valor
create or replace function public.chq_folha_inutilizar(p_empresa uuid, p_conta uuid, p_numero int, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform _chq_cfg(p_empresa);
  if coalesce(length(trim(p_motivo)), 0) < 5 then raise exception 'Informe o motivo'; end if;
  if exists (select 1 from chq_emitidos where empresa_id = p_empresa and conta_id = p_conta and numero = p_numero) then raise exception 'O cheque nº % desta conta já foi usado', p_numero; end if;
  insert into chq_emitidos(empresa_id, conta_id, talao_id, numero, valor, emissao, bom_para, situacao, motivo)
  values (p_empresa, p_conta, (select id from chq_taloes where empresa_id = p_empresa and conta_id = p_conta and p_numero between numero_ini and numero_fim limit 1), p_numero, 0, current_date, current_date, 'cancelado', trim(p_motivo))
  returning id into v_id;
  perform _chq_ev(p_empresa, null, v_id, 'folha inutilizada', current_date, trim(p_motivo));
  return v_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['_chq_cfg(uuid)', '_chq_ev(uuid,uuid,uuid,text,date,text)', '_chq_lanc(uuid,date,uuid,text,uuid,text,uuid,uuid,numeric,text)', '_chq_titulos(uuid,uuid[],text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['chq_configurar_padrao(uuid)', 'chq_receber(uuid,uuid,date,jsonb,uuid[],uuid)', 'chq_editar(uuid,jsonb)', 'chq_cancelar_recebimento(uuid,text)',
    'chq_depositar(uuid,uuid[],uuid,date)', 'chq_deposito_cancelar(uuid)', 'chq_compensar(uuid[],date)', 'chq_devolver(uuid,date,text,numeric)', 'chq_resgatar(uuid,uuid,date,numeric)',
    'chq_cobrar(uuid,date,date)', 'chq_perda(uuid,date,text)', 'chq_repassar(uuid,uuid[],uuid,date,uuid[],uuid)',
    'chq_emitir(uuid,uuid,int,uuid,text,numeric,date,date,uuid[],uuid,text,boolean)', 'chq_emitido_compensar(uuid,date)', 'chq_emitido_cancelar(uuid,text,boolean)',
    'chq_emitido_devolver(uuid,date,text)', 'chq_folha_inutilizar(uuid,uuid,int,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------- FIDC: a proposta de borderô aceita cheques em carteira como itens ----------
-- Igual à versão em produção, com três mudanças: (1) itens com cheque_id não exigem lançamento; (2) os cheques saem da conta
-- Cheques em carteira para a conta do fundo por uma transferência; (3) os cheques ficam "no FIDC", ligados à proposta.
create or replace function public._aprovar_proposta_fidc(p_id uuid, p_motivo text, p_aprovador uuid)
returns text language plpgsql security definer set search_path = public as $$
declare pr fidc_propostas; fu fidc_fundos; n_aberto int; n_itens int; n_sem int; v_origem text; v_op uuid; v_rot text;
        pl_jur uuid; pl_tar uuid; pl_rec uuid; pl_td uuid; pl_tc uuid; v_cc uuid;
        n_chq int; n_chq_ok int; v_chq numeric; cq chq_config;
begin
  select * into pr from fidc_propostas where id = p_id for update;
  if not found then raise exception 'Proposta não encontrada'; end if;
  if pr.status <> 'Pendente' then raise exception 'A proposta nº % não está pendente (status: %)', pr.numero, pr.status; end if;
  select * into fu from fidc_fundos where id = pr.fundo_id;
  if fu.conta_id is null then raise exception 'Cadastre a conta do fundo % antes de aprovar', fu.nome; end if;

  if pr.origem = 'base_fidc' then
    update fidc_proposta_itens i set lancamento_id = x.lid
      from (select distinct on (i2.id) i2.id iid, l.id lid
              from fidc_proposta_itens i2
              join lancamentos l on l.empresa_id = pr.empresa_id and l.fidc_proposta_id is null
                and (l.status = 'Em aberto' or (l.status = 'Pago' and l.conta_id is null))
                and nf_parcela(coalesce(l.documento, l.descricao)) = nf_parcela(i2.documento) and abs(l.valor - i2.valor) <= 0.05
             where i2.proposta_id = p_id and i2.lancamento_id is null and i2.cheque_id is null
               and not exists (select 1 from fidc_proposta_itens o where o.lancamento_id = l.id)
             order by i2.id, (l.status = 'Em aberto') desc, l.data) x
     where i.id = x.iid;
    select count(*) into n_sem from fidc_proposta_itens where proposta_id = p_id and lancamento_id is null and cheque_id is null;
    if n_sem > 0 then raise exception '% título(s) deste borderô ainda não estão lançados em aberto. Gere as contas a receber das notas (Notas Fiscais › Recebimentos × Notas) e aprove de novo.', n_sem; end if;
  end if;

  select count(*), count(*) filter (where (l.status = 'Em aberto' or (pr.origem = 'base_fidc' and l.status = 'Pago' and l.conta_id is null)) and l.fidc_proposta_id is null)
    into n_itens, n_aberto
    from fidc_proposta_itens i join lancamentos l on l.id = i.lancamento_id where i.proposta_id = p_id and i.cheque_id is null;
  select count(*), count(*) filter (where q.situacao = 'carteira' and q.fidc_proposta_id is null and abs(q.valor - i.valor) <= 0.05), coalesce(sum(i.valor), 0)
    into n_chq, n_chq_ok, v_chq
    from fidc_proposta_itens i join chq_cheques q on q.id = i.cheque_id where i.proposta_id = p_id;
  if n_itens = 0 and n_chq = 0 then raise exception 'Proposta sem títulos vinculados'; end if;
  if n_aberto <> n_itens then raise exception '% título(s) já não estão em aberto ou estão em outra proposta', n_itens - n_aberto; end if;
  if n_chq_ok <> n_chq then raise exception '% cheque(s) desta proposta já não estão em carteira', n_chq - n_chq_ok; end if;

  select id into pl_jur from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.08';
  select id into pl_tar from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.32';
  select id into pl_rec from plano_contas where empresa_id = pr.empresa_id and codigo = '2.07.11';
  select id into pl_td  from plano_contas where empresa_id = pr.empresa_id and codigo = '3.02.01';
  select id into pl_tc  from plano_contas where empresa_id = pr.empresa_id and codigo = '3.01.01';
  select id into v_cc from centros_custo where empresa_id = pr.empresa_id and nome = 'FINANCEIRO';
  v_origem := 'fidc:proposta:' || pr.numero;
  v_rot := case when pr.origem = 'base_fidc' then format('borderô %s', coalesce(pr.comparativo->>'bordero', ''))
                   when pr.analise ? 'espelho' then format('borderô %s', coalesce(pr.analise->'espelho'->>'bordero', pr.comparativo->>'bordero', ''))
                   else 'estimado' end;

  perform set_config('app.aprovando', 'sim', true);
  update lancamentos l set status = 'Pago', data = pr.data_operacao, conta_id = fu.conta_id, fidc_proposta_id = p_id
    from fidc_proposta_itens i where i.proposta_id = p_id and i.lancamento_id = l.id and i.cheque_id is null;

  if n_chq > 0 then
    select * into cq from chq_config where empresa_id = pr.empresa_id;
    if cq.conta_carteira_id is null or coalesce(cq.plano_transferencia_id, pl_td) is null then raise exception 'Configure o Controle de Cheques (conta Cheques em carteira) antes de aprovar borderô com cheques'; end if;
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, conta_destino_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, coalesce(cq.plano_transferencia_id, pl_td), format('%s — %s cheque(s) da proposta nº %s', fu.nome, n_chq, pr.numero), v_cc, 'Pago', cq.conta_carteira_id, fu.conta_id, v_chq, v_origem, p_id);
    insert into chq_eventos(empresa_id, cheque_id, tipo, data, detalhe)
      select pr.empresa_id, i.cheque_id, 'enviado ao FIDC', pr.data_operacao, format('%s · proposta nº %s', fu.nome, pr.numero) from fidc_proposta_itens i where i.proposta_id = p_id and i.cheque_id is not null;
    update chq_cheques q set situacao = 'fidc', fidc_proposta_id = p_id, fundo = fu.nome from fidc_proposta_itens i where i.proposta_id = p_id and i.cheque_id = q.id;
  end if;

  if pl_jur is not null and pr.desagio > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_jur, format('%s — deságio proposta nº %s (%s)', fu.nome, pr.numero, v_rot), v_cc, 'Pago', fu.conta_id, pr.desagio, v_origem, p_id);
  end if;
  if pl_tar is not null and pr.ad_valorem + pr.tarifas + pr.iof > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_tar, format('%s — tarifas/IOF proposta nº %s (%s)', fu.nome, pr.numero, v_rot), v_cc, 'Pago', fu.conta_id, pr.ad_valorem + pr.tarifas + pr.iof, v_origem, p_id);
  end if;
  if pl_rec is not null and pr.recompras > 0 then
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_rec, format('%s — recompras descontadas proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', fu.conta_id, pr.recompras, v_origem, p_id);
  end if;
  if pl_td is not null and pr.liquido > 0 and coalesce(pr.conta_credito_id, fu.conta_credito_id) is not null then
    -- transferência única: sai da conta do fundo e entra na conta de crédito, num lançamento só
    insert into lancamentos(empresa_id, data, plano_id, descricao, centro_custo_id, status, conta_id, conta_destino_id, valor, origem, fidc_proposta_id)
    values (pr.empresa_id, pr.data_operacao, pl_td, format('%s — líquido proposta nº %s', fu.nome, pr.numero), v_cc, 'Pago', fu.conta_id, coalesce(pr.conta_credito_id, fu.conta_credito_id), pr.liquido, v_origem, p_id);
  end if;

  if pr.origem = 'base_fidc' and pr.operacao_id is not null then
    v_op := pr.operacao_id;
  else
    insert into fidc_operacoes(empresa_id, fundo, data, bordero, arquivo, conta_id, qtd_titulos, valor_face, desagio, ad_valorem, tarifas, iof,
                               encargos, recompra, desc_sacado, liquido, prazo_medio, prazo_cobrado, observacao)
    values (pr.empresa_id, fu.nome, pr.data_operacao, 'P' || pr.numero, 'Proposta nº ' || pr.numero || case when pr.analise ? 'espelho' then ' (espelho do borderô ' || coalesce(pr.analise->'espelho'->>'bordero', '') || ')' else ' (plataforma)' end, fu.conta_id, pr.qtd_titulos,
            pr.valor_face, pr.desagio, pr.ad_valorem, pr.tarifas, pr.iof, 0, pr.recompras, 0, pr.liquido, pr.prazo_medio, pr.prazo_cobrado,
            nullif(concat_ws('; ', pr.observacao, p_motivo), ''))
    returning id into v_op;
    insert into fidc_titulos(empresa_id, operacao_id, fundo, bordero, data_operacao, titulo, vencimento, valor, cnpj_sacado, sacado, sacado_agrupado)
    select pr.empresa_id, v_op, fu.nome, 'P' || pr.numero, pr.data_operacao, i.documento, i.vencimento, i.valor, i.cnpj, i.sacado, i.sacado
      from fidc_proposta_itens i where i.proposta_id = p_id;
  end if;

  update fidc_propostas set status = 'Aprovada', motivo = p_motivo, aprovado_por = p_aprovador, aprovado_em = now(), operacao_id = v_op where id = p_id;
  return 'Aprovada';
end $$;

-- ---------- fotos e imagens dos cheques: cheques/<empresa>/<cheque>/<arquivo> ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cheques', 'cheques', false, 8388608, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
drop policy if exists cheques_arq_sel on storage.objects;
drop policy if exists cheques_arq_ins on storage.objects;
drop policy if exists cheques_arq_del on storage.objects;
create policy cheques_arq_sel on storage.objects for select to authenticated using (bucket_id = 'cheques' and public.is_membro(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy cheques_arq_ins on storage.objects for insert to authenticated with check (bucket_id = 'cheques' and public.pode_editar(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy cheques_arq_del on storage.objects for delete to authenticated using (bucket_id = 'cheques' and public.pode_editar(public._uuid_ou_nulo((storage.foldername(name))[1])));
