-- =====================================================================
-- Estoque parametrizado — Etapa B (31/10/2026): implantação do saldo inicial e movimentos automáticos pelas NF-e.
--  - est_config: data de implantação e chave do automático (DESLIGADO até a implantação: sem saldo inicial, toda saída
--    seria barrada por saldo insuficiente).
--  - est_implantar(empresa, espelho, data, mapa depósito → local): lança o saldo inicial (tipo SI) a partir do espelho do Iniflex
--    importado em Posição de estoque, liga o automático a partir do dia seguinte e processa as notas desde então.
--  - est_processar_item / est_processar_nota / est_processar_periodo: cada item de NF-e autorizada vira movimento pela regra do CFOP.
--      saída (nota própria): produto pelo código; entrada de fornecedor: produto pelo de-para (CNPJ + código, com o fator);
--      CFOP do fornecedor (5/6/7) é lido como entrada (1/2/3); custo da entrada = custo líquido (custo_item_nfe);
--      produto com lote: entrada cria o lote NF<número>-<item>; saída consome os lotes do local do mais antigo para o mais novo.
--      Notas complementares e de ajuste não movimentam. O que não der certo vai para est_pendencias (sem produto, sem regra,
--      sem local, saldo, erro), sem travar a importação da nota.
--  - NF-e cancelada depois de movimentar: os movimentos dela são estornados sozinhos.
-- Leitura: participantes. Implantar e reprocessar: administrador e financeiro. Migração ADITIVA; pode rodar mais de uma vez.
-- Não lança nada sozinha: até a implantação, o automático fica desligado.
-- =====================================================================

create table if not exists public.est_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  implantado_em date,                       -- primeiro dia movimentado pelas notas (dia seguinte ao saldo inicial)
  espelho_id uuid references public.estoque_espelhos(id) on delete set null,
  automatico boolean not null default false,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);

create table if not exists public.est_pendencias (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nota_id uuid references public.nfe_notas(id) on delete cascade,
  nfe_item_id uuid unique references public.nfe_itens(id) on delete cascade,
  motivo text not null check (motivo in ('sem_produto','sem_regra','sem_local','saldo','erro')),
  mensagem text,
  status text not null default 'aberta' check (status in ('aberta','resolvida','ignorada')),
  criado_em timestamptz not null default now(),
  resolvido_em timestamptz
);
create index if not exists est_pendencias_emp on public.est_pendencias(empresa_id, status);

-- um item de nota pode gerar mais de um movimento (saída por lotes): o índice deixa de ser único
drop index if exists public.est_mov_nfe_item;
create index if not exists est_mov_nfe_item on public.est_movimentos(nfe_item_id) where nfe_item_id is not null;
create index if not exists est_mov_nota on public.est_movimentos(nota_id) where nota_id is not null;

-- regras de entrada que faltavam no padrão (compra com ST de mercadoria; bonificação recebida fica para decidir)
insert into public.est_regras_cfop(empresa_id, cfop, sentido, tipo_movimento_id, prioridade, observacao)
select e.id, '405', 'entrada', t.id, 100, 'Compra com ST (substituído)'
  from public.empresas e join public.est_tipos_movimento t on t.empresa_id = e.id and t.codigo = 'COMPRA'
 where not exists (select 1 from public.est_regras_cfop r where r.empresa_id = e.id and r.sentido = 'entrada' and r.cfop = '405');

-- regra de um item (mesma ordem da tela: CFOP completo > final; família > tipo SPED > qualquer; menor prioridade)
create or replace function public._est_regra(p_empresa uuid, p_cfop text, p_sentido text, p_familia uuid, p_tipo_sped text)
returns public.est_regras_cfop language sql stable security definer set search_path = public as $$
  select r.* from est_regras_cfop r
   where r.empresa_id = p_empresa and r.ativo and r.sentido = p_sentido
     and (r.cfop = p_cfop or (length(r.cfop) = 3 and r.cfop = right(p_cfop, 3)))
     and (r.familia_id is null or r.familia_id = p_familia) and (r.tipo_sped is null or r.tipo_sped = p_tipo_sped)
   order by (case when length(r.cfop) = 4 then 4 else 0 end + case when r.familia_id is not null then 2 else 0 end + case when r.tipo_sped is not null then 1 else 0 end) desc, r.prioridade
   limit 1;
$$;
revoke all on function public._est_regra(uuid, text, text, uuid, text) from public, anon, authenticated;

create or replace function public._est_pendencia(i nfe_itens, p_motivo text, p_msg text) returns text
language plpgsql security definer set search_path = public as $$
begin
  insert into est_pendencias(empresa_id, nota_id, nfe_item_id, motivo, mensagem)
  values (i.empresa_id, i.nota_id, i.id, p_motivo, p_msg)
  on conflict (nfe_item_id) do update set motivo = excluded.motivo, mensagem = excluded.mensagem, criado_em = now()
    where est_pendencias.status <> 'ignorada';
  return p_motivo;
end $$;
revoke all on function public._est_pendencia(nfe_itens, text, text) from public, anon, authenticated;

-- processa um item de NF-e: devolve 'ok', 'ja', 'nao_movimenta', 'fora' ou o motivo da pendência
create or replace function public._est_item(p_item uuid) returns text
language plpgsql security definer set search_path = public as $$
declare i nfe_itens; n nfe_notas; pr produtos; v_fator numeric := 1; reg est_regras_cfop; tm est_tipos_movimento; v_sent text; v_cfop text;
        v_loc uuid; v_qtd numeric; v_cu numeric; ep estoque_parametros; v_lote uuid; v_resta numeric; l record; v_tira numeric; v_doc text; v_pid uuid;
begin
  select * into i from nfe_itens where id = p_item;
  select * into n from nfe_notas where id = i.nota_id;
  if n.situacao <> 'autorizada' or coalesce(n.finalidade, '1') in ('2', '3') or coalesce(i.qcom, 0) <= 0 then return 'fora'; end if;
  if exists (select 1 from est_movimentos m where m.nfe_item_id = i.id and m.estorno_de is null
              and not exists (select 1 from est_movimentos e where e.estorno_de = m.id)) then return 'ja'; end if;
  if exists (select 1 from est_pendencias where nfe_item_id = i.id and status = 'ignorada') then return 'fora'; end if;
  v_sent := n.tipo;
  v_cfop := regexp_replace(coalesce(i.cfop, ''), '\D', '', 'g');
  if not n.emissao_propria and v_sent = 'entrada' and left(v_cfop, 1) in ('5','6','7') then
    v_cfop := translate(left(v_cfop, 1), '567', '123') || substr(v_cfop, 2);
  end if;
  -- produto
  if not n.emissao_propria then
    select pf.produto_id, pf.fator into v_pid, v_fator from produto_fornecedores pf
     where pf.empresa_id = n.empresa_id and pf.emit_doc = n.emit_doc and pf.codigo_fornecedor = i.cprod limit 1;
    if v_pid is not null then select * into pr from produtos where id = v_pid; end if;
  else
    select * into pr from produtos where empresa_id = n.empresa_id and codigo = i.cprod;
  end if;
  -- regra antes do produto: CFOP que não movimenta não precisa de cadastro
  reg := _est_regra(n.empresa_id, v_cfop, v_sent, pr.familia_id, pr.tipo_sped);
  if reg.id is not null and reg.tipo_movimento_id is null then
    update est_pendencias set status = 'resolvida', resolvido_em = now() where nfe_item_id = i.id and status = 'aberta';
    return 'nao_movimenta';
  end if;
  if pr.id is null then
    return _est_pendencia(i, 'sem_produto', case when n.emissao_propria then 'Código ' || coalesce(i.cprod, '?') || ' sem cadastro em Produtos'
      else 'Item ' || coalesce(i.cprod, '?') || ' de ' || coalesce(n.emit_nome, n.emit_doc) || ' sem de-para' end);
  end if;
  if reg.id is null then return _est_pendencia(i, 'sem_regra', 'Sem regra para o CFOP ' || v_cfop || ' (' || v_sent || ')'); end if;
  select * into tm from est_tipos_movimento where id = reg.tipo_movimento_id;
  v_loc := coalesce(reg.local_id, case when tm.sentido = 'S' then tm.local_origem_id else tm.local_destino_id end, pr.local_padrao_id);
  if v_loc is null then return _est_pendencia(i, 'sem_local', 'Produto ' || pr.codigo || ' sem local padrão e regra sem local'); end if;
  v_qtd := round(i.qcom * coalesce(v_fator, 1), 4);
  v_doc := 'NF ' || n.numero || coalesce(' · ' || nullif(n.emit_nome, ''), '');
  begin
    if tm.sentido = 'E' then
      if tm.afeta_custo then select * into ep from estoque_parametros where empresa_id = n.empresa_id; v_cu := custo_item_nfe(i, ep) / v_qtd; end if;
      if pr.controla_lote then
        insert into est_lotes(empresa_id, produto_id, codigo, fornecedor_id, origem)
        values (n.empresa_id, pr.id, 'NF' || n.numero || '-' || i.n_item, n.favorecido_id, 'compra')
        on conflict (empresa_id, produto_id, codigo) do update set codigo = excluded.codigo returning id into v_lote;
      end if;
      insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, nota_id, nfe_item_id, documento)
      values (n.empresa_id, n.emissao, pr.id, v_loc, v_lote, tm.id, v_qtd, v_cu, n.id, i.id, v_doc);
    elsif not pr.controla_lote then
      insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, nota_id, nfe_item_id, documento)
      values (n.empresa_id, n.emissao, pr.id, v_loc, tm.id, -v_qtd, n.id, i.id, v_doc);
    else   -- saída de produto com lote: do lote mais antigo para o mais novo
      v_resta := v_qtd;
      for l in select s.lote_id, s.quantidade from est_saldos s left join est_lotes lt on lt.id = s.lote_id
                where s.produto_id = pr.id and s.local_id = v_loc and s.quantidade > 0 order by lt.criado_em nulls first loop
        exit when v_resta <= 0;
        v_tira := least(v_resta, l.quantidade);
        insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, nota_id, nfe_item_id, documento)
        values (n.empresa_id, n.emissao, pr.id, v_loc, l.lote_id, tm.id, -v_tira, n.id, i.id, v_doc);
        v_resta := v_resta - v_tira;
      end loop;
      if v_resta > 0 then raise exception 'Saldo insuficiente de % no local: faltam %', pr.codigo, v_resta; end if;
    end if;
  exception when others then
    return _est_pendencia(i, case when sqlerrm like 'Saldo insuficiente%' then 'saldo' else 'erro' end, sqlerrm);
  end;
  update est_pendencias set status = 'resolvida', resolvido_em = now() where nfe_item_id = i.id and status = 'aberta';
  return 'ok';
end $$;
revoke all on function public._est_item(uuid) from public, anon, authenticated;

-- reprocessar à mão (tela de pendências)
create or replace function public.est_processar_item(p_item uuid) returns text
language plpgsql security definer set search_path = public as $$
declare e uuid;
begin
  select empresa_id into e from nfe_itens where id = p_item;
  if not pode_editar(e) then raise exception 'Só administrador ou financeiro reprocessa.'; end if;
  return _est_item(p_item);
end $$;

create or replace function public.est_processar_periodo(p_empresa uuid, p_de date, p_ate date)
returns table(resultado text, itens bigint) language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not pode_editar(p_empresa) then raise exception 'Só administrador ou financeiro reprocessa.'; end if;
  return query
  select r, count(*) from (
    select _est_item(i.id) r from nfe_itens i join nfe_notas n on n.id = i.nota_id
     where n.empresa_id = p_empresa and n.emissao between p_de and p_ate and n.situacao = 'autorizada'
     order by n.emissao, n.tipo, n.numero, i.n_item) x group by r order by 2 desc;   -- entradas antes das saídas no mesmo dia
end $$;

-- automático: item novo de nota com data a partir da implantação
create or replace function public._est_item_novo() returns trigger
language plpgsql security definer set search_path = public as $$
declare c est_config; d date;
begin
  select * into c from est_config where empresa_id = new.empresa_id;
  if not coalesce(c.automatico, false) then return null; end if;
  select emissao into d from nfe_notas where id = new.nota_id;
  if d >= c.implantado_em then perform _est_item(new.id); end if;
  return null;
end $$;
revoke all on function public._est_item_novo() from public, anon, authenticated;
drop trigger if exists nfe_itens_estoque on public.nfe_itens;
create trigger nfe_itens_estoque after insert on public.nfe_itens for each row execute function public._est_item_novo();

-- nota cancelada: estorna o que ela movimentou (na data da nota; se o mês estiver fechado, hoje)
create or replace function public._est_nota_cancelada() returns trigger
language plpgsql security definer set search_path = public as $$
declare m record;
begin
  if new.situacao = old.situacao or new.situacao = 'autorizada' then return null; end if;
  for m in select mv.* from est_movimentos mv where mv.nota_id = new.id and mv.estorno_de is null
            and not exists (select 1 from est_movimentos e where e.estorno_de = mv.id) loop
    begin
      insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, estorno_de, nota_id, documento, observacao)
      values (m.empresa_id, m.data, m.produto_id, m.local_id, m.lote_id, m.tipo_movimento_id, -m.quantidade, m.custo_unitario, m.id, m.nota_id, m.documento, 'Estorno: NF-e ' || new.situacao);
    exception when others then
      insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, estorno_de, nota_id, documento, observacao)
      values (m.empresa_id, current_date, m.produto_id, m.local_id, m.lote_id, m.tipo_movimento_id, -m.quantidade, m.custo_unitario, m.id, m.nota_id, m.documento, 'Estorno: NF-e ' || new.situacao);
    end;
  end loop;
  update est_pendencias set status = 'resolvida', resolvido_em = now() where nota_id = new.id and status = 'aberta';
  return null;
end $$;
revoke all on function public._est_nota_cancelada() from public, anon, authenticated;
drop trigger if exists nfe_notas_estoque_cancelada on public.nfe_notas;
create trigger nfe_notas_estoque_cancelada after update of situacao on public.nfe_notas for each row execute function public._est_nota_cancelada();

-- implantação: saldo inicial pelo espelho do Iniflex (posição no fim do dia p_data). p_mapa = {"DEPÓSITO": "local_id", ...}
-- Linhas sem cadastro, com quantidade ≤ 0 ou de depósito sem local ficam de fora (a tela mostra antes). Sem custo no espelho:
-- usa o último custo do de-para; sem nenhum, entra a custo zero e aparece na conferência.
create or replace function public.est_implantar(p_empresa uuid, p_espelho uuid, p_data date, p_mapa jsonb, p_processar boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t uuid; x record; v_lote uuid; n int := 0; z int := 0; v_val numeric := 0; r jsonb := '[]'::jsonb; v_cu numeric;
begin
  if not pode_editar(p_empresa) then raise exception 'Só administrador ou financeiro implanta o estoque.'; end if;
  if exists (select 1 from est_config where empresa_id = p_empresa and implantado_em is not null) then raise exception 'O estoque já foi implantado. Para refazer, fale com o suporte da plataforma.'; end if;
  if exists (select 1 from est_movimentos where empresa_id = p_empresa) then raise exception 'Já há movimentos no kardex: a implantação é feita com o kardex vazio.'; end if;
  if not exists (select 1 from estoque_espelhos where id = p_espelho and empresa_id = p_empresa) then raise exception 'Espelho não encontrado.'; end if;
  select id into t from est_tipos_movimento where empresa_id = p_empresa and codigo = 'SI';
  if t is null then raise exception 'Cadastre o tipo de movimento SI (saldo inicial).'; end if;
  for x in select ei.produto_id, ei.deposito, sum(ei.quantidade) q, sum(coalesce(ei.valor, 0)) v, bool_and(ei.valor is not null or ei.custo_unitario is not null) tem_custo,
                  (p_mapa ->> ei.deposito)::uuid local_id, p.codigo, p.controla_lote
             from estoque_espelho_itens ei join produtos p on p.id = ei.produto_id
            where ei.espelho_id = p_espelho and ei.produto_id is not null and p_mapa ? ei.deposito
            group by ei.produto_id, ei.deposito, p.codigo, p.controla_lote having sum(ei.quantidade) > 0 loop
    v_cu := case when x.tem_custo then x.v / x.q
                 else (select pf.ultimo_preco from produto_fornecedores pf where pf.produto_id = x.produto_id and pf.ultimo_preco is not null order by pf.ultima_compra desc nulls last limit 1) end;
    if v_cu is null then v_cu := 0; z := z + 1; end if;
    v_lote := null;
    if x.controla_lote then
      insert into est_lotes(empresa_id, produto_id, codigo, origem) values (p_empresa, x.produto_id, 'SI-' || to_char(p_data, 'YYYYMMDD'), 'inventario')
      on conflict (empresa_id, produto_id, codigo) do update set codigo = excluded.codigo returning id into v_lote;
    end if;
    insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, documento, observacao)
    values (p_empresa, p_data, x.produto_id, x.local_id, v_lote, t, x.q, v_cu, 'Saldo inicial', 'Implantação pelo espelho do Iniflex de ' || to_char(p_data, 'DD/MM/YYYY') || ' · depósito ' || x.deposito);
    n := n + 1; v_val := v_val + round(x.q * v_cu, 2);
  end loop;
  if n = 0 then raise exception 'Nenhuma linha implantada: confira o mapa de depósitos e o cadastro dos produtos.'; end if;
  insert into est_config(empresa_id, implantado_em, espelho_id, automatico, atualizado_em) values (p_empresa, p_data + 1, p_espelho, true, now())
  on conflict (empresa_id) do update set implantado_em = excluded.implantado_em, espelho_id = excluded.espelho_id, automatico = true, atualizado_em = now(), atualizado_por = auth.uid();
  if p_processar and p_data < current_date then
    select coalesce(jsonb_agg(jsonb_build_object('resultado', resultado, 'itens', itens)), '[]'::jsonb) into r from est_processar_periodo(p_empresa, p_data + 1, current_date);
  end if;
  return jsonb_build_object('movimentos', n, 'valor', v_val, 'sem_custo', z, 'notas', r);
end $$;

-- automático liga/desliga (administrador)
create or replace function public.est_automatico(p_empresa uuid, p_ligar boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(p_empresa) then raise exception 'Só o administrador liga ou desliga o automático.'; end if;
  if p_ligar and not exists (select 1 from est_config where empresa_id = p_empresa and implantado_em is not null) then raise exception 'Implante o saldo inicial antes de ligar o automático.'; end if;
  update est_config set automatico = p_ligar, atualizado_em = now(), atualizado_por = auth.uid() where empresa_id = p_empresa;
  return p_ligar;
end $$;

-- ---------------------------------------------------------------- segurança
alter table public.est_config enable row level security;
alter table public.est_pendencias enable row level security;
do $$ declare t text; a text; begin
  foreach t in array array['est_config','est_pendencias'] loop
    foreach a in array array['sel','ins','upd','del'] loop execute format('drop policy if exists %1$s_%2$s on public.%1$s', t, a); end loop;
    execute format('create policy %1$s_sel on public.%1$s for select to authenticated using (public.is_participante(empresa_id))', t);
  end loop;
end $$;
-- pendência: ignorar / reabrir pela tela (administrador e financeiro); config só pelas funções
create policy est_pendencias_upd on public.est_pendencias for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id));
revoke execute on function public.est_implantar(uuid, uuid, date, jsonb, boolean), public.est_processar_periodo(uuid, date, date) from public, anon;
grant execute on function public.est_processar_item(uuid), public.est_processar_periodo(uuid, date, date), public.est_implantar(uuid, uuid, date, jsonb, boolean),
  public.est_automatico(uuid, boolean) to authenticated;

-- conferência: tabelas = 2, gatilhos = 2, automático ligado = 0 (só liga na implantação)
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('est_config', 'est_pendencias')) as tabelas,
       (select count(*) from pg_trigger where tgname in ('nfe_itens_estoque', 'nfe_notas_estoque_cancelada')) as gatilhos,
       (select count(*) from public.est_config where automatico) as automatico_ligado;
