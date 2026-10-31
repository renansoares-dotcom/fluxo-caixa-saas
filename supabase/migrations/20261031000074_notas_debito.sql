-- =====================================================================
-- Reforma tributária — notas de débito de juros e multa (31/10/2026; Renan: "1 - pode; 2 - fica a decidir; 3 - qualquer valor").
--  - LC 214/2025, art. 12, § 1º, II: juros, multas e acréscimos recebidos entram na base da CBS e do IBS. No recebimento
--    o fornecedor emite NF-e de débito (finNFe 6, tpNFDebito 04 – Multa e juros) que referencia os itens da nota de origem
--    (NT 2025.002-RTC). A plataforma ainda não emite NF-e: aqui fica a FILA de notas de débito a emitir, gerada sozinha.
--  - Juros recebidos pela empresa: o título é baixado pelo valor de face e a diferença vira lançamento em 1.02.17 JUROS E
--    MULTAS RECEBIDOS, ligado ao título (lancamentos.juros_de). Todo lançamento Pago em 1.02.17 cria a pendência (status pendente).
--  - Juros recebidos pelo fundo (mora no relatório de pagos do FIDC, título pago pelo cliente): pendência "a decidir"
--    até a definição com a contabilidade.
--  - Leitura: membros. Gravação: administrador e financeiro. Exclusão: administrador.
-- Migração ADITIVA; pode rodar mais de uma vez. Não altera dados existentes (só cria pendências de liquidações já importadas).
-- =====================================================================
alter table public.lancamentos add column if not exists juros_de uuid references public.lancamentos(id) on delete set null;
create index if not exists lancamentos_juros_de on public.lancamentos(juros_de) where juros_de is not null;

create table if not exists public.fiscal_notas_debito (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  origem text not null check (origem in ('recebimento','fidc','manual')),
  lancamento_id uuid unique references public.lancamentos(id) on delete set null,          -- o lançamento dos juros (1.02.17)
  titulo_id uuid references public.lancamentos(id) on delete set null,                      -- o título recebido com atraso
  fidc_liquidacao_id uuid unique references public.fidc_liquidacoes(id) on delete set null, -- juros recebidos pelo fundo
  nota_id uuid references public.nfe_notas(id) on delete set null,                          -- NF-e de origem
  nf_numero int, parcela int,
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  cliente_nome text, cliente_doc text,
  data_recebimento date not null,
  valor numeric(16,2) not null check (valor > 0),
  status text not null default 'pendente' check (status in ('pendente','a_decidir','emitida','dispensada')),
  motivo text,                                   -- dispensa / observação
  nd_numero text, nd_serie text, nd_chave text, emitida_em date,
  payload jsonb,                                 -- itens rateados e dados da NF-e de débito no momento da emissão (futura API)
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
create index if not exists fiscal_nd_emp_status on public.fiscal_notas_debito(empresa_id, status);

alter table public.fiscal_notas_debito enable row level security;
do $$ declare a text; begin
  foreach a in array array['sel','ins','upd','del'] loop execute format('drop policy if exists fiscal_notas_debito_%s on public.fiscal_notas_debito', a); end loop;
end $$;
create policy fiscal_notas_debito_sel on public.fiscal_notas_debito for select to authenticated using (empresa_id in (select public.minhas_empresas()));
create policy fiscal_notas_debito_ins on public.fiscal_notas_debito for insert to authenticated with check (public.pode_editar(empresa_id));
create policy fiscal_notas_debito_upd on public.fiscal_notas_debito for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
create policy fiscal_notas_debito_del on public.fiscal_notas_debito for delete to authenticated using (public.is_admin(empresa_id));

-- NF-e de saída da empresa para uma NF/parcela: primeiro pelo vínculo nota ↔ título, depois pelo número
create or replace function public._nd_nota(p_empresa uuid, p_titulo uuid, p_doc text)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select v.nota_id from nfe_vinculos v where v.lancamento_id = p_titulo limit 1),
    (select n.id from nfe_notas n where n.empresa_id = p_empresa and n.emissao_propria and n.tipo = 'saida' and n.situacao = 'autorizada'
        and n.numero = (nf_parcela(p_doc))[1] order by n.emissao desc limit 1));
$$;
revoke all on function public._nd_nota(uuid, uuid, text) from public, anon, authenticated;

-- lançamento Pago em 1.02.17 → pendência de nota de débito
create or replace function public._nd_de_lancamento() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cod text; t lancamentos; v_doc text; v_nota uuid; f favorecidos; quem uuid[];
begin
  if new.status <> 'Pago' or coalesce(new.valor, 0) <= 0 then return new; end if;
  select codigo into v_cod from plano_contas where id = new.plano_id;
  if v_cod is distinct from '1.02.17' then return new; end if;
  if exists (select 1 from fiscal_notas_debito where lancamento_id = new.id) then   -- valor/data corrigidos antes de emitir
    update fiscal_notas_debito set valor = new.valor, data_recebimento = new.data, atualizado_em = now()
     where lancamento_id = new.id and status = 'pendente' and (valor <> new.valor or data_recebimento <> new.data);
    return new;
  end if;
  if new.juros_de is not null then select * into t from lancamentos where id = new.juros_de; end if;
  v_doc := coalesce(t.documento, new.documento);
  v_nota := _nd_nota(new.empresa_id, t.id, v_doc);
  select * into f from favorecidos where id = coalesce(new.favorecido_id, t.favorecido_id);
  insert into fiscal_notas_debito(empresa_id, origem, lancamento_id, titulo_id, nota_id, nf_numero, parcela, favorecido_id, cliente_nome, cliente_doc, data_recebimento, valor, status)
  values (new.empresa_id, 'recebimento', new.id, t.id, v_nota, (nf_parcela(v_doc))[1], (nf_parcela(v_doc))[2], f.id, f.nome, f.documento, new.data, new.valor, 'pendente');
  select array_agg(user_id) into quem from membros where empresa_id = new.empresa_id and papel::text in ('admin', 'financeiro');
  perform _notificar(new.empresa_id, quem, 'nd_pendente', 'Emitir nota de débito de juros/multa',
    coalesce(f.nome, 'Cliente') || ' — R$ ' || translate(to_char(new.valor, 'FM999,999,990.00'), ',.', '.,') || coalesce(' · NF ' || v_doc, '') || ' · recebido em ' || to_char(new.data, 'DD/MM'),
    '#/fiscal/notas-debito', new.id);
  return new;
end $$;
revoke all on function public._nd_de_lancamento() from public, anon, authenticated;
drop trigger if exists lancamentos_nd on public.lancamentos;
create trigger lancamentos_nd after insert or update of status, plano_id, valor, data on public.lancamentos
  for each row execute function public._nd_de_lancamento();

-- lançamento de juros excluído antes da emissão: a pendência sai junto (emitida ou dispensada fica, sem o vínculo)
create or replace function public._nd_lancamento_excluido() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from fiscal_notas_debito where lancamento_id = old.id and status = 'pendente';
  return old;
end $$;
revoke all on function public._nd_lancamento_excluido() from public, anon, authenticated;
drop trigger if exists lancamentos_nd_del on public.lancamentos;
create trigger lancamentos_nd_del before delete on public.lancamentos for each row execute function public._nd_lancamento_excluido();

-- liquidação no fundo com mora paga pelo cliente → pendência "a decidir"
create or replace function public._nd_de_liquidacao() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tit lancamentos; v_nota uuid;
begin
  if coalesce(new.mora, 0) <= 0 or new.tipo not in ('normal', 'deposito_sacado') then return new; end if;
  if exists (select 1 from fiscal_notas_debito where fidc_liquidacao_id = new.id) then
    update fiscal_notas_debito set valor = new.mora, data_recebimento = new.quitacao, atualizado_em = now()
     where fidc_liquidacao_id = new.id and status = 'a_decidir' and (valor <> new.mora or data_recebimento <> new.quitacao);
    return new;
  end if;
  select l.* into v_tit from lancamentos l where l.empresa_id = new.empresa_id and l.fidc_proposta_id is not null
     and nf_parcela(l.documento) = nf_parcela(new.titulo) order by l.data desc limit 1;
  v_nota := _nd_nota(new.empresa_id, v_tit.id, new.titulo);
  insert into fiscal_notas_debito(empresa_id, origem, fidc_liquidacao_id, titulo_id, nota_id, nf_numero, parcela, favorecido_id, cliente_nome, cliente_doc, data_recebimento, valor, status, motivo)
  values (new.empresa_id, 'fidc', new.id, v_tit.id, v_nota, (nf_parcela(new.titulo))[1], (nf_parcela(new.titulo))[2], v_tit.favorecido_id, new.sacado, new.cnpj_sacado,
          new.quitacao, new.mora, 'a_decidir', 'Juros recebidos pelo fundo ' || new.fundo || ' (relatório de pagos): definir com a contabilidade');
  return new;
end $$;
revoke all on function public._nd_de_liquidacao() from public, anon, authenticated;
drop trigger if exists fidc_liquidacoes_nd on public.fidc_liquidacoes;
create trigger fidc_liquidacoes_nd after insert or update of mora, tipo, quitacao on public.fidc_liquidacoes
  for each row execute function public._nd_de_liquidacao();

-- liquidações já importadas
update public.fidc_liquidacoes set mora = mora where mora > 0 and tipo in ('normal', 'deposito_sacado')
   and id not in (select fidc_liquidacao_id from public.fiscal_notas_debito where fidc_liquidacao_id is not null);

-- conferência: tabela = 1, políticas = 4, gatilhos = 3
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'fiscal_notas_debito') as tabela,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'fiscal_notas_debito') as politicas,
       (select count(*) from pg_trigger where tgname in ('lancamentos_nd', 'lancamentos_nd_del', 'fidc_liquidacoes_nd')) as gatilhos,
       (select count(*) from public.fiscal_notas_debito) as pendencias;
