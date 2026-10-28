-- =====================================================================
-- Pagamento Antecipado com vários pagamentos e vários anexos (28/10/2026, Renan: "pode seguir").
-- Caso que motivou: PA nº 22 devia R$ 8.459,24 e foi pago R$ 6.987,62 — o complemento sai num segundo pagamento,
-- com o próprio comprovante.
--  - paraquedas_pagamentos: cada pagamento do PA (data, valor, conta) com o seu lançamento e o seu adiantamento ao fornecedor
--  - paraquedas_anexos: vários arquivos por PA (comprovantes ligados a um pagamento, ou outros documentos)
--  - RPCs atômicas: pa_registrar_pagamento, pa_corrigir_pagamento, pa_excluir_anexo
--  - PAs que já existem: cada lançamento ligado vira o "pagamento 1" e o comprovante atual vira o anexo dele
--    (só copia referências; nenhum valor muda). Pode rodar mais de uma vez.
-- =====================================================================

create table if not exists public.paraquedas_pagamentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  paraquedas_id uuid not null references public.paraquedas(id) on delete cascade,
  lancamento_id uuid unique references public.lancamentos(id) on delete set null,
  credito_id uuid references public.creditos(id) on delete set null,
  data date not null,
  valor numeric(16,2) not null check (valor > 0),
  conta_id uuid references public.contas(id) on delete set null,
  observacao text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists pa_pag_pa on public.paraquedas_pagamentos(paraquedas_id);

create table if not exists public.paraquedas_anexos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  paraquedas_id uuid not null references public.paraquedas(id) on delete cascade,
  pagamento_id uuid references public.paraquedas_pagamentos(id) on delete set null,
  tipo text not null default 'comprovante' check (tipo in ('comprovante', 'documento')),
  path text not null unique,
  nome text,
  enviado_por text,
  enviado_em timestamptz not null default now()
);
create index if not exists pa_anx_pa on public.paraquedas_anexos(paraquedas_id);

do $$ declare t text; begin
  foreach t in array array['paraquedas_pagamentos', 'paraquedas_anexos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    -- vê: quem é da empresa (menos compras) ou quem lançou o PA
    execute format('create policy %I on public.%I for select to authenticated using (public.is_membro(empresa_id) or exists (select 1 from public.paraquedas p where p.id = paraquedas_id and p.criado_por = (select auth.uid())))', t || '_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.pode_editar(empresa_id))', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id))', t || '_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.pode_editar(empresa_id))', t || '_del', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;

-- PAs que já existem: lançamento ligado → pagamento 1; comprovante atual → anexo do pagamento 1
insert into public.paraquedas_pagamentos (empresa_id, paraquedas_id, lancamento_id, credito_id, data, valor, conta_id, criado_por, criado_em)
select p.empresa_id, p.id, l.id, p.credito_id, l.data, l.valor, l.conta_id, p.criado_por, coalesce(p.atualizado_em, now())
  from public.paraquedas p join public.lancamentos l on l.id = p.lancamento_id
 where l.valor > 0 and not exists (select 1 from public.paraquedas_pagamentos x where x.lancamento_id = l.id);
insert into public.paraquedas_anexos (empresa_id, paraquedas_id, pagamento_id, tipo, path, nome, enviado_por, enviado_em)
select p.empresa_id, p.id, (select x.id from public.paraquedas_pagamentos x where x.paraquedas_id = p.id order by x.data, x.criado_em limit 1),
       'comprovante', p.comprovante_path, p.comprovante_nome, p.comprovante_por, coalesce(p.comprovante_em, now())
  from public.paraquedas p
 where p.comprovante_path is not null and not exists (select 1 from public.paraquedas_anexos a where a.path = p.comprovante_path);

-- ---------------------------------------------------------------------
-- Registra um pagamento (pago agora): lançamento Pago + adiantamento ao fornecedor (se terá nota e tem cadastro) + linha do pagamento.
-- Se houver lançamento programado "Em aberto" do PA, ele é reduzido pelo valor pago (some quando zera), para o fluxo não contar duas vezes.
-- O PA passa a "pago" no primeiro pagamento; enquanto faltar valor, a tela mostra "pago parcialmente — falta X".
create or replace function public.pa_registrar_pagamento(p_pa uuid, p_data date, p_valor numeric, p_conta uuid, p_obs text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare p paraquedas; v_pago numeric; v_n int; v_l uuid; v_c uuid; v_id uuid; r record; v_resta numeric := round(p_valor, 2);
begin
  select * into p from paraquedas where id = p_pa for update;
  if p.id is null then raise exception 'Pagamento antecipado não encontrado'; end if;
  if not pode_editar(p.empresa_id) then raise exception 'Só o financeiro registra pagamentos'; end if;
  if p.status not in ('aprovado', 'pago') then raise exception 'O PA nº % não está autorizado (situação: %)', p.numero, p.status; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe o valor pago'; end if;
  if p.plano_id is null then raise exception 'O PA nº % não tem plano de contas: programe ou edite a classificação antes', p.numero; end if;
  select coalesce(sum(x.valor), 0), count(*) into v_pago, v_n from paraquedas_pagamentos x join lancamentos l on l.id = x.lancamento_id
   where x.paraquedas_id = p.id and l.status = 'Pago';
  if v_pago + p_valor > p.valor + 0.005 then
    raise exception 'Passa do valor do PA nº %: já pago %, falta %', p.numero, translate(to_char(v_pago, 'FM999,999,990.00'), ',.', '.,'), translate(to_char(p.valor - v_pago, 'FM999,999,990.00'), ',.', '.,');
  end if;
  insert into lancamentos(empresa_id, data, plano_id, descricao, status, conta_id, centro_custo_id, favorecido_id, valor, origem, documento)
  values (p.empresa_id, p_data, p.plano_id, left('PA ' || p.numero || ' — ' || p.descricao || ' (pagamento ' || (v_n + 1) || ')', 250), 'Pago',
          p_conta, p.centro_custo_id, p.favorecido_id, round(p_valor, 2), 'paraquedas', 'PA ' || p.numero)
  returning id into v_l;
  if p.tera_nota and p.favorecido_id is not null then
    insert into creditos(empresa_id, favorecido_id, natureza, tipo, data, valor, descricao, lancamento_id)
    values (p.empresa_id, p.favorecido_id, 'fornecedor', 'adiantamento', p_data, round(p_valor, 2), left('PA ' || p.numero || ' — ' || p.descricao, 200), v_l)
    returning id into v_c;
  end if;
  insert into paraquedas_pagamentos(empresa_id, paraquedas_id, lancamento_id, credito_id, data, valor, conta_id, observacao)
  values (p.empresa_id, p.id, v_l, v_c, p_data, round(p_valor, 2), p_conta, nullif(trim(coalesce(p_obs, '')), '')) returning id into v_id;
  -- programado em aberto: reduz pelo valor pago
  for r in select x.id xid, l.id lid, l.valor from paraquedas_pagamentos x join lancamentos l on l.id = x.lancamento_id
            where x.paraquedas_id = p.id and l.status = 'Em aberto' order by l.data loop
    exit when v_resta <= 0;
    if r.valor <= v_resta + 0.005 then
      v_resta := v_resta - r.valor;
      delete from paraquedas_pagamentos where id = r.xid;
      if p.lancamento_id = r.lid then update paraquedas set lancamento_id = null where id = p.id; p.lancamento_id := null; end if;
      delete from lancamentos where id = r.lid;
    else
      update lancamentos set valor = round(r.valor - v_resta, 2) where id = r.lid;
      update paraquedas_pagamentos set valor = round(r.valor - v_resta, 2) where id = r.xid;
      v_resta := 0;
    end if;
  end loop;
  update paraquedas set lancamento_id = coalesce(lancamento_id, v_l), credito_id = coalesce(credito_id, v_c), conta_id = coalesce(conta_id, p_conta),
         status = 'pago'   -- saiu dinheiro: vira adiantamento; se faltar, a tela mostra "pago parcialmente — falta X"
   where id = p.id;
  return v_id;
end $$;

-- Corrige o valor de um pagamento já registrado (ex.: digitado o valor do PA, mas pago a menor).
-- Ajusta o lançamento e o adiantamento ao fornecedor juntos. Lançamento conciliado não muda (trava da conciliação).
create or replace function public.pa_corrigir_pagamento(p_pagamento uuid, p_valor numeric, p_data date default null)
returns void language plpgsql security definer set search_path = public as $$
declare x paraquedas_pagamentos; p paraquedas; v_outros numeric; v_usado numeric;
begin
  select * into x from paraquedas_pagamentos where id = p_pagamento for update;
  if x.id is null then raise exception 'Pagamento não encontrado'; end if;
  select * into p from paraquedas where id = x.paraquedas_id for update;
  if not pode_editar(x.empresa_id) then raise exception 'Só o financeiro corrige pagamentos'; end if;
  if p_valor is null or p_valor <= 0 then raise exception 'Informe o valor correto'; end if;
  select coalesce(sum(valor), 0) into v_outros from paraquedas_pagamentos where paraquedas_id = x.paraquedas_id and id <> x.id;
  if v_outros + p_valor > p.valor + 0.005 then raise exception 'Passa do valor do PA nº % (outros pagamentos: %)', p.numero, translate(to_char(v_outros, 'FM999,999,990.00'), ',.', '.,'); end if;
  if x.credito_id is not null then
    select coalesce(sum(valor), 0) into v_usado from creditos_usos where credito_id = x.credito_id;
    if v_usado > p_valor + 0.005 then raise exception 'O adiantamento deste pagamento já abateu % em nota; desfaça o abatimento antes', translate(to_char(v_usado, 'FM999,999,990.00'), ',.', '.,'); end if;
    update creditos set valor = round(p_valor, 2), data = coalesce(p_data, data) where id = x.credito_id;
  end if;
  if x.lancamento_id is not null then update lancamentos set valor = round(p_valor, 2), data = coalesce(p_data, data) where id = x.lancamento_id; end if;
  update paraquedas_pagamentos set valor = round(p_valor, 2), data = coalesce(p_data, data) where id = x.id;
  -- se ficou faltando, o PA continua "pago" e a tela mostra "pago parcialmente — falta X"
end $$;

revoke execute on function public.pa_registrar_pagamento(uuid, date, numeric, uuid, text), public.pa_corrigir_pagamento(uuid, numeric, date) from anon, public;
grant execute on function public.pa_registrar_pagamento(uuid, date, numeric, uuid, text), public.pa_corrigir_pagamento(uuid, numeric, date) to authenticated;

-- conferência: tabelas criadas e PAs já existentes copiados
select (select count(*) from public.paraquedas_pagamentos) as pagamentos, (select count(*) from public.paraquedas_anexos) as anexos,
       (select count(*) from public.paraquedas where lancamento_id is not null) as pas_com_lancamento;
