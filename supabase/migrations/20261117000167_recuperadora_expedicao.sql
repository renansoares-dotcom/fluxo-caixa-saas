-- 167 — Recuperadora: expedição (17/11/2026, pedido do Renan para um cliente reciclador)
-- A venda do grão (ou de um lote separado) sai num documento de expedição, com romaneio:
-- * cabeçalho: cliente, data, nota fiscal, transportador, placa e motorista;
-- * itens: lote, kg, volumes, embalagem e preço por kg;
-- * "Expedir" dá a saída de venda em cada lote (só lote disponível: o bloqueado pela qualidade não embarca),
--   grava os totais e gera o título a receber, se a conta estiver nos parâmetros;
-- * cancelar a expedição já expedida devolve os kg aos lotes e exclui o título ainda em aberto.
-- Aditivo. A saída avulsa pela ficha do lote continua funcionando.

alter table public.rec_config add column if not exists plano_venda_id uuid references public.plano_contas(id) on delete set null;   -- conta do título a receber da venda; vazia = não gera
alter table public.rec_config add column if not exists prazo_recebimento_dias int not null default 0 check (prazo_recebimento_dias between 0 and 365);
alter table public.rec_config add column if not exists expedicao_exigir_nf boolean not null default false;                           -- só expede com o número da nota

create table if not exists public.rec_expedicoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int,
  data date not null default current_date,
  cliente_id uuid references public.favorecidos(id),
  nf_numero text,
  transportador text, placa text, motorista text,
  situacao text not null default 'aberta' check (situacao in ('aberta', 'expedida', 'cancelada')),
  peso_total numeric(14,3), volumes_total int, valor_total numeric(16,2), custo_total numeric(16,2),
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  observacao text,
  expedida_em timestamptz, expedida_por uuid,
  cancelada_em timestamptz, cancelada_por uuid, cancelamento_motivo text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists rec_expedicoes_e on public.rec_expedicoes(empresa_id, data);

create table if not exists public.rec_expedicao_itens (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  expedicao_id uuid not null references public.rec_expedicoes(id) on delete cascade,
  lote_id uuid not null references public.rec_lotes(id),
  kg numeric(14,3) not null check (kg > 0),
  volumes int check (volumes is null or volumes >= 0),
  embalagem text,                                                       -- big bag, saco de 25 kg, granel…
  preco_kg numeric(14,4) check (preco_kg is null or preco_kg >= 0),
  valor numeric(16,2),
  custo numeric(16,2),
  saida_id uuid references public.rec_lote_saidas(id) on delete set null,
  criado_em timestamptz not null default now(),
  unique (expedicao_id, lote_id)
);
create index if not exists rec_expedicao_itens_x on public.rec_expedicao_itens(expedicao_id);
create index if not exists rec_expedicao_itens_l on public.rec_expedicao_itens(lote_id);

-- ---------- segurança ----------
do $$ declare t text; begin
  foreach t in array array['rec_expedicoes', 'rec_expedicao_itens'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.ve_producao(empresa_id))', t || '_sel', t);
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;
-- quem aponta abre e edita enquanto aberta; expedir e cancelar pelas funções
drop policy if exists rec_expedicoes_ins on public.rec_expedicoes;
create policy rec_expedicoes_ins on public.rec_expedicoes for insert to authenticated with check (public.pode_apontar(empresa_id) and situacao = 'aberta');
drop policy if exists rec_expedicoes_upd on public.rec_expedicoes;
create policy rec_expedicoes_upd on public.rec_expedicoes for update to authenticated using (public.pode_apontar(empresa_id) and situacao = 'aberta') with check (public.pode_apontar(empresa_id) and situacao = 'aberta');
drop policy if exists rec_expedicoes_del on public.rec_expedicoes;
create policy rec_expedicoes_del on public.rec_expedicoes for delete to authenticated using (public.pode_apontar(empresa_id) and situacao = 'aberta');
grant select, insert, update, delete on public.rec_expedicoes to authenticated;
drop policy if exists rec_expedicao_itens_ins on public.rec_expedicao_itens;
create policy rec_expedicao_itens_ins on public.rec_expedicao_itens for insert to authenticated with check (public.pode_apontar(empresa_id) and exists (select 1 from rec_expedicoes x where x.id = expedicao_id and x.empresa_id = rec_expedicao_itens.empresa_id and x.situacao = 'aberta'));
drop policy if exists rec_expedicao_itens_upd on public.rec_expedicao_itens;
create policy rec_expedicao_itens_upd on public.rec_expedicao_itens for update to authenticated using (public.pode_apontar(empresa_id) and exists (select 1 from rec_expedicoes x where x.id = expedicao_id and x.situacao = 'aberta'))
  with check (public.pode_apontar(empresa_id) and exists (select 1 from rec_expedicoes x where x.id = expedicao_id and x.empresa_id = rec_expedicao_itens.empresa_id and x.situacao = 'aberta'));
drop policy if exists rec_expedicao_itens_del on public.rec_expedicao_itens;
create policy rec_expedicao_itens_del on public.rec_expedicao_itens for delete to authenticated using (public.pode_apontar(empresa_id) and exists (select 1 from rec_expedicoes x where x.id = expedicao_id and x.situacao = 'aberta'));
grant select, insert, update, delete on public.rec_expedicao_itens to authenticated;

create or replace function public._rec_expedicao_antes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('rec_expedicao_' || new.empresa_id));
    if new.numero is null then new.numero := coalesce((select max(numero) from rec_expedicoes where empresa_id = new.empresa_id), 0) + 1; end if;
  end if;
  if new.cliente_id is not null and (select empresa_id from favorecidos where id = new.cliente_id) is distinct from new.empresa_id then raise exception 'Cliente de outra empresa'; end if;
  new.nf_numero := nullif(trim(new.nf_numero), ''); new.placa := nullif(upper(trim(new.placa)), '');
  if auth.uid() is not null and current_setting('app.rec_expedicao', true) is distinct from 'sim' then   -- pela tela não se gravam totais nem título
    if tg_op = 'INSERT' then new.peso_total := null; new.volumes_total := null; new.valor_total := null; new.custo_total := null; new.lancamento_id := null; new.expedida_em := null; new.expedida_por := null;
    else new.numero := old.numero; new.peso_total := old.peso_total; new.volumes_total := old.volumes_total; new.valor_total := old.valor_total; new.custo_total := old.custo_total; new.lancamento_id := old.lancamento_id;
         new.expedida_em := old.expedida_em; new.expedida_por := old.expedida_por; end if;
  end if;
  return new;
end $$;
drop trigger if exists rec_expedicao_antes on public.rec_expedicoes;
create trigger rec_expedicao_antes before insert or update on public.rec_expedicoes for each row execute function public._rec_expedicao_antes();

create or replace function public._rec_expedicao_item_antes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select empresa_id from rec_expedicoes where id = new.expedicao_id) is distinct from new.empresa_id
     or (select empresa_id from rec_lotes where id = new.lote_id) is distinct from new.empresa_id then raise exception 'Expedição ou lote de outra empresa'; end if;
  new.valor := case when new.preco_kg is not null then round(new.kg * new.preco_kg, 2) end;
  new.embalagem := nullif(trim(new.embalagem), '');
  if auth.uid() is not null and current_setting('app.rec_expedicao', true) is distinct from 'sim' then
    if tg_op = 'INSERT' then new.saida_id := null; new.custo := null; else new.saida_id := old.saida_id; new.custo := old.custo; new.expedicao_id := old.expedicao_id; end if;
  end if;
  return new;
end $$;
drop trigger if exists rec_expedicao_item_antes on public.rec_expedicao_itens;
create trigger rec_expedicao_item_antes before insert or update on public.rec_expedicao_itens for each row execute function public._rec_expedicao_item_antes();

-- ---------- expedir: saída de venda em cada lote, totais e título a receber ----------
create or replace function public.rec_expedicao_expedir(p_expedicao uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x rec_expedicoes; cfg rec_config; i record; r jsonb; v_saida uuid; v_kg numeric := 0; v_vol int := 0; v_val numeric := 0; v_custo numeric := 0; v_lanc uuid; n int := 0; v_doc text; v_sem int := 0;
begin
  select * into x from rec_expedicoes where id = p_expedicao for update;
  if x.id is null or not public.pode_apontar(x.empresa_id) then raise exception 'Acesso negado.'; end if;
  if x.situacao <> 'aberta' then raise exception 'A expedição não está aberta.'; end if;
  if x.cliente_id is null then raise exception 'Informe o cliente da expedição.'; end if;
  select * into cfg from rec_config where empresa_id = x.empresa_id;
  if coalesce(cfg.expedicao_exigir_nf, false) and x.nf_numero is null then raise exception 'Informe o número da nota fiscal: os parâmetros exigem a nota para expedir.'; end if;
  perform set_config('app.rec_expedicao', 'sim', true);
  v_doc := coalesce('NF ' || x.nf_numero, 'EXP ' || x.numero);
  for i in select t.*, l.codigo from rec_expedicao_itens t join rec_lotes l on l.id = t.lote_id where t.expedicao_id = x.id order by t.criado_em loop
    n := n + 1;
    r := public.rec_lote_baixar(i.lote_id, i.kg, 'venda', x.data, null, v_doc, 'Expedição ' || x.numero);   -- confere a situação e o saldo do lote
    select id into v_saida from rec_lote_saidas where lote_id = i.lote_id and destino = 'venda' order by criado_em desc, id desc limit 1;
    update rec_expedicao_itens set saida_id = v_saida, custo = (r ->> 'custo')::numeric where id = i.id;
    v_kg := v_kg + i.kg; v_vol := v_vol + coalesce(i.volumes, 0); v_val := v_val + coalesce(i.valor, 0); v_custo := v_custo + coalesce((r ->> 'custo')::numeric, 0);
    if i.valor is null then v_sem := v_sem + 1; end if;
  end loop;
  if n = 0 then raise exception 'Inclua ao menos um lote na expedição.'; end if;
  if cfg.plano_venda_id is not null and v_val > 0 then
    insert into lancamentos(empresa_id, data, plano_id, favorecido_id, status, valor, descricao, documento, origem)
    values (x.empresa_id, x.data + coalesce(cfg.prazo_recebimento_dias, 0), cfg.plano_venda_id, x.cliente_id, 'Em aberto', v_val, 'Venda de material reciclado — expedição ' || x.numero, v_doc, 'recuperadora')
    returning id into v_lanc;
  end if;
  update rec_expedicoes set situacao = 'expedida', peso_total = v_kg, volumes_total = v_vol, valor_total = v_val, custo_total = v_custo, lancamento_id = v_lanc, expedida_em = now(), expedida_por = auth.uid() where id = x.id;
  return jsonb_build_object('numero', x.numero, 'lotes', n, 'kg', v_kg, 'volumes', v_vol, 'valor', v_val, 'custo', v_custo, 'margem', v_val - v_custo, 'lancamento_id', v_lanc, 'sem_preco', v_sem);
end $$;

-- ---------- cancelar: a aberta só muda a situação; a expedida devolve os kg e exclui o título em aberto (admin, financeiro ou diretor) ----------
create or replace function public.rec_expedicao_cancelar(p_expedicao uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare x rec_expedicoes; i record; v_status text;
begin
  select * into x from rec_expedicoes where id = p_expedicao for update;
  if x.id is null or not public.pode_apontar(x.empresa_id) then raise exception 'Acesso negado.'; end if;
  if x.situacao = 'cancelada' then raise exception 'A expedição já está cancelada.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo.'; end if;
  perform set_config('app.rec_expedicao', 'sim', true);
  if x.situacao = 'expedida' then
    if not public.pode_pcp(x.empresa_id) then raise exception 'Expedição já expedida só é cancelada por admin, financeiro ou diretor.'; end if;
    if x.lancamento_id is not null then
      select status into v_status from lancamentos where id = x.lancamento_id;
      if v_status = 'Pago' then raise exception 'O título desta venda já foi recebido: estorne o recebimento antes de cancelar a expedição.'; end if;
      if v_status is not null then delete from lancamentos where id = x.lancamento_id; end if;
    end if;
    for i in select * from rec_expedicao_itens where expedicao_id = x.id and saida_id is not null loop
      update rec_lotes set saldo_kg = saldo_kg + i.kg, situacao = case when situacao in ('vendido', 'consumido') then 'disponivel' else situacao end where id = i.lote_id;
      delete from rec_lote_saidas where id = i.saida_id;
      update rec_expedicao_itens set saida_id = null where id = i.id;
    end loop;
  end if;
  update rec_expedicoes set situacao = 'cancelada', lancamento_id = null, cancelada_em = now(), cancelada_por = auth.uid(), cancelamento_motivo = trim(p_motivo) where id = x.id;
end $$;

revoke all on function public._rec_expedicao_antes(), public._rec_expedicao_item_antes() from public, anon, authenticated;
revoke all on function public.rec_expedicao_expedir(uuid), public.rec_expedicao_cancelar(uuid, text) from public, anon;
grant execute on function public.rec_expedicao_expedir(uuid), public.rec_expedicao_cancelar(uuid, text) to authenticated;
