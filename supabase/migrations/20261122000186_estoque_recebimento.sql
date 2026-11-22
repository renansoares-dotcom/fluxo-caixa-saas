-- 186 — recebimento conferido: a nota de compra entra no estoque pela chegada do material, não pela emissão
-- Parâmetro por empresa (desligado por padrão). Ligado:
--   * a nota de compra fica "a receber" e não entra no estoque sozinha;
--   * quem atende o almoxarifado confere o material na chegada, item a item, no celular ou com o leitor;
--   * a conferência é cega por parâmetro (quem recebe não vê a quantidade da nota);
--   * entra a quantidade que chegou em bom estado, na data da chegada, ao custo unitário da nota;
--   * falta, sobra ou avaria além da tolerância vira aviso para Compras cobrar o fornecedor;
--   * nota sem material físico (serviço, energia, frete) é dispensada com o motivo.
-- Aditivo: nada é apagado.

alter table public.est_config add column if not exists entrada_por text not null default 'emissao' check (entrada_por in ('emissao', 'recebimento'));
alter table public.est_config add column if not exists receb_desde date;                     -- notas emitidas a partir desta data passam pela conferência
alter table public.est_config add column if not exists receb_cega boolean not null default true;
alter table public.est_config add column if not exists receb_tolerancia_pct numeric(6,2) not null default 0.5 check (receb_tolerancia_pct >= 0 and receb_tolerancia_pct <> 'NaN'::numeric);

create table if not exists public.est_recebimentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  nota_id uuid not null references public.nfe_notas(id),
  situacao text not null default 'conferindo' check (situacao in ('conferindo', 'conferido', 'dispensado', 'cancelado')),
  data date,                                                    -- dia em que o material chegou
  conferente_id uuid default auth.uid(), conferente_nome text,
  iniciado_em timestamptz not null default now(), conferido_em timestamptz,
  observacao text check (length(observacao) <= 300),
  divergencias int not null default 0,
  unique (empresa_id, numero)
);
create unique index if not exists est_receb_nota on public.est_recebimentos (nota_id) where situacao <> 'cancelado';
create table if not exists public.est_recebimento_itens (
  id uuid primary key default gen_random_uuid(),
  recebimento_id uuid not null references public.est_recebimentos(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nfe_item_id uuid not null references public.nfe_itens(id),
  qtd_nota numeric(18,4) not null check (qtd_nota <> 'NaN'::numeric),     -- na unidade da nota; não aparece para quem confere com a conferência cega
  contada numeric(18,4) check (contada is null or (contada >= 0 and contada <> 'NaN'::numeric)),
  avariada numeric(18,4) not null default 0 check (avariada >= 0 and avariada <> 'NaN'::numeric),
  qtd_entra numeric(18,4) check (qtd_entra is null or qtd_entra <> 'NaN'::numeric),
  divergencia text,
  contado_por uuid, contado_em timestamptz,
  unique (recebimento_id, nfe_item_id)
);
-- leitura só pelas funções: é o que torna a conferência cega
alter table public.est_recebimentos enable row level security;
alter table public.est_recebimento_itens enable row level security;
revoke all on public.est_recebimentos, public.est_recebimento_itens from anon, authenticated;
grant select on public.est_recebimentos to authenticated;
drop policy if exists est_recebimentos_sel on public.est_recebimentos;
create policy est_recebimentos_sel on public.est_recebimentos for select to authenticated using (empresa_id in (select public.est_empresas_que_vejo()) or public.alm_almoxarife(empresa_id));
drop trigger if exists zz_auditoria on public.est_recebimentos;
create trigger zz_auditoria after insert or update or delete on public.est_recebimentos for each row execute function public._auditar();

create or replace function public._est_receb_ativo(p_empresa uuid, p_emissao date) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from est_config c where c.empresa_id = p_empresa and c.entrada_por = 'recebimento' and c.receb_desde is not null and p_emissao >= c.receb_desde);
$$;
-- quem confere: quem atende o almoxarifado (os perfis e pessoas dos parâmetros da Requisição de Material)
create or replace function public._est_receb_pode(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select public.alm_almoxarife(p_empresa) and public._mfa_ok(p_empresa);
$$;
create or replace function public._est_receb_ve_nota(p_empresa uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor', 'compras')) and public._mfa_ok(p_empresa);
$$;

create or replace function public._est_item(p_item uuid) returns text
language plpgsql security definer set search_path = public as $$
declare i nfe_itens; n nfe_notas; pr produtos; v_fator numeric := 1; reg est_regras_cfop; tm est_tipos_movimento; v_sent text; v_cfop text;
        v_loc uuid; v_qtd numeric; v_cu numeric; ep estoque_parametros; v_lote uuid; v_resta numeric; l record; v_tira numeric; v_doc text; v_pid uuid;
        v_data date; v_qtd_nota numeric; v_ri record;
begin
  select * into i from nfe_itens where id = p_item;
  select * into n from nfe_notas where id = i.nota_id;
  if n.situacao <> 'autorizada' or coalesce(n.finalidade, '1') in ('2', '3') or coalesce(i.qcom, 0) <= 0 then return 'fora'; end if;
  if exists (select 1 from est_movimentos m where m.nfe_item_id = i.id and m.estorno_de is null
              and not exists (select 1 from est_movimentos e where e.estorno_de = m.id)) then return 'ja'; end if;
  if exists (select 1 from est_pendencias where nfe_item_id = i.id and status = 'ignorada') then return 'fora'; end if;
  -- conferido e não chegou nada em bom estado: não entra e não pendura (nem por falta de de-para)
  if n.tipo = 'entrada' and not n.emissao_propria and public._est_receb_ativo(n.empresa_id, n.emissao)
     and exists (select 1 from est_recebimento_itens ri join est_recebimentos r on r.id = ri.recebimento_id where ri.nfe_item_id = i.id and r.situacao = 'conferido' and coalesce(ri.qtd_entra, 0) <= 0) then
    update est_pendencias set status = 'resolvida', resolvido_em = now() where nfe_item_id = i.id and status = 'aberta';
    return 'nao_chegou';
  end if;
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
  v_data := n.emissao; v_qtd_nota := v_qtd;
  -- entrada pelo recebimento conferido (SQL 186): a nota de compra só entra quando o material é conferido na chegada,
  -- com a data da chegada e a quantidade que chegou em bom estado; o custo unitário continua o da nota
  if tm.sentido = 'E' and not n.emissao_propria and n.tipo = 'entrada' and public._est_receb_ativo(n.empresa_id, n.emissao) then
    select r.data, ri.qtd_entra into v_ri from est_recebimento_itens ri join est_recebimentos r on r.id = ri.recebimento_id
     where ri.nfe_item_id = i.id and r.situacao = 'conferido' limit 1;
    if not found then return 'a_receber'; end if;
    v_data := v_ri.data; v_qtd := round(coalesce(v_ri.qtd_entra, 0) * coalesce(v_fator, 1), 4);
    if v_qtd <= 0 then
      update est_pendencias set status = 'resolvida', resolvido_em = now() where nfe_item_id = i.id and status = 'aberta';
      return 'nao_chegou';
    end if;
  end if;
  begin
    if tm.sentido = 'E' then
      if tm.afeta_custo then select * into ep from estoque_parametros where empresa_id = n.empresa_id; v_cu := custo_item_nfe(i, ep) / v_qtd_nota; end if;   -- custo da nota por unidade da nota
      if pr.controla_lote then
        insert into est_lotes(empresa_id, produto_id, codigo, fornecedor_id, origem)
        values (n.empresa_id, pr.id, 'NF' || n.numero || '-' || i.n_item, n.favorecido_id, 'compra')
        on conflict (empresa_id, produto_id, codigo) do update set codigo = excluded.codigo returning id into v_lote;
      end if;
      insert into est_movimentos(empresa_id, data, produto_id, local_id, lote_id, tipo_movimento_id, quantidade, custo_unitario, nota_id, nfe_item_id, documento)
      values (n.empresa_id, v_data, pr.id, v_loc, v_lote, tm.id, v_qtd, v_cu, n.id, i.id, v_doc);
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

-- parâmetros do recebimento (administrador). Ao ligar, as notas emitidas a partir de hoje passam pela conferência.
create or replace function public.est_receb_salvar(p_empresa uuid, p_ativo boolean, p_cega boolean, p_tolerancia numeric, p_desde date default null)
returns void language plpgsql security definer set search_path = public as $$
declare c est_config;
begin
  if not is_admin(p_empresa) or not _mfa_ok(p_empresa) then raise exception 'Só o administrador muda a forma de entrada das notas no estoque.'; end if;
  if p_tolerancia is null or p_tolerancia = 'NaN'::numeric or p_tolerancia < 0 or p_tolerancia > 50 then raise exception 'Tolerância de 0 a 50%%.'; end if;
  if p_desde is not null and p_desde > current_date + 60 then raise exception 'Data de início inválida.'; end if;
  insert into est_config (empresa_id) values (p_empresa) on conflict (empresa_id) do nothing;
  select * into c from est_config where empresa_id = p_empresa for update;
  update est_config set entrada_por = case when coalesce(p_ativo, false) then 'recebimento' else 'emissao' end,
         receb_desde = case when coalesce(p_ativo, false) then coalesce(p_desde, case when c.entrada_por = 'recebimento' then c.receb_desde end, current_date) else receb_desde end,
         receb_cega = coalesce(p_cega, true), receb_tolerancia_pct = p_tolerancia, atualizado_em = now(), atualizado_por = auth.uid()
   where empresa_id = p_empresa;
end $$;

-- fila: notas de compra a receber e as conferências em andamento
create or replace function public.est_receb_fila(p_empresa uuid)
returns table (nota_id uuid, numero int, serie text, emit_nome text, emit_doc text, emissao date, v_nf numeric, itens int, recebimento_id uuid, situacao text, conferente_nome text, contados int, dias int)
language plpgsql stable security definer set search_path = public as $$
declare c est_config;
begin
  if not (public._est_receb_pode(p_empresa) or public._est_receb_ve_nota(p_empresa)) then raise exception 'Sem acesso ao recebimento.'; end if;
  select * into c from est_config where empresa_id = p_empresa;
  if c.entrada_por is distinct from 'recebimento' or c.receb_desde is null then return; end if;
  return query
  select n.id, n.numero, n.serie::text, n.emit_nome::text, n.emit_doc::text, n.emissao, case when public._est_receb_ve_nota(p_empresa) then n.v_nf end,
         (select count(*)::int from nfe_itens i where i.nota_id = n.id), r.id, coalesce(r.situacao, 'a_receber'), r.conferente_nome,
         (select count(*)::int from est_recebimento_itens ri where ri.recebimento_id = r.id and ri.contada is not null), (current_date - n.emissao)::int
    from nfe_notas n left join est_recebimentos r on r.nota_id = n.id and r.situacao <> 'cancelado'
   where n.empresa_id = p_empresa and n.tipo = 'entrada' and not n.emissao_propria and n.situacao = 'autorizada' and coalesce(n.finalidade, '1') not in ('2', '3')
     and n.emissao >= c.receb_desde and (r.id is null or r.situacao = 'conferindo')
   order by n.emissao, n.numero;
end $$;

-- começa a conferência de uma nota (ou retoma a que está em andamento)
create or replace function public.est_receb_iniciar(p_nota uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare n nfe_notas; v_id uuid; v_num int;
begin
  select * into n from nfe_notas where id = p_nota;
  if not found or not public._est_receb_pode(n.empresa_id) then raise exception 'Só quem atende o almoxarifado confere o recebimento.'; end if;
  if n.tipo <> 'entrada' or n.emissao_propria or n.situacao <> 'autorizada' or not public._est_receb_ativo(n.empresa_id, n.emissao) then raise exception 'Esta nota não passa pela conferência de recebimento.'; end if;
  perform pg_advisory_xact_lock(hashtext('est_receb:' || n.empresa_id::text));
  select id into v_id from est_recebimentos where nota_id = n.id and situacao <> 'cancelado';
  if v_id is not null then
    if (select situacao from est_recebimentos where id = v_id) <> 'conferindo' then raise exception 'Esta nota já foi recebida ou dispensada.'; end if;
    return v_id;
  end if;
  select coalesce(max(numero), 0) + 1 into v_num from est_recebimentos where empresa_id = n.empresa_id;
  insert into est_recebimentos (empresa_id, numero, nota_id, conferente_nome) values (n.empresa_id, v_num, n.id, public._alm_nome(n.empresa_id)) returning id into v_id;
  insert into est_recebimento_itens (recebimento_id, empresa_id, nfe_item_id, qtd_nota)
  select v_id, n.empresa_id, i.id, coalesce(i.qcom, 0) from nfe_itens i where i.nota_id = n.id and coalesce(i.qcom, 0) > 0;
  return v_id;
end $$;

-- itens da conferência. Com a conferência cega, a quantidade da nota não vem para quem confere.
create or replace function public.est_receb_itens(p_receb uuid)
returns table (item_id uuid, n_item int, cprod text, xprod text, ucom text, produto_codigo text, produto_descricao text, etiqueta text, qtd_nota numeric, contada numeric, avariada numeric, qtd_entra numeric, divergencia text)
language plpgsql stable security definer set search_path = public as $$
declare r est_recebimentos; n nfe_notas; v_ve boolean;
begin
  select * into r from est_recebimentos where id = p_receb;
  if not found or not (public._est_receb_pode(r.empresa_id) or public._est_receb_ve_nota(r.empresa_id)) then raise exception 'Sem acesso ao recebimento.'; end if;
  select * into n from nfe_notas where id = r.nota_id;
  -- a quantidade da nota aparece para quem confere só com a conferência aberta (parâmetro) ou depois de concluída
  v_ve := r.situacao <> 'conferindo' or not coalesce((select receb_cega from est_config where empresa_id = r.empresa_id), true)
          or (public._est_receb_ve_nota(r.empresa_id) and not public._est_receb_pode(r.empresa_id));
  return query
  select ri.id, i.n_item, i.cprod::text, i.xprod::text, i.ucom::text, p.codigo::text, p.descricao::text, p.etiqueta::text,
         case when v_ve then ri.qtd_nota end, ri.contada, ri.avariada, ri.qtd_entra, ri.divergencia
    from est_recebimento_itens ri join nfe_itens i on i.id = ri.nfe_item_id
    left join produto_fornecedores pf on pf.empresa_id = r.empresa_id and pf.emit_doc = n.emit_doc and pf.codigo_fornecedor = i.cprod
    left join produtos p on p.id = pf.produto_id
   where ri.recebimento_id = p_receb order by i.n_item;
end $$;

-- registra o que chegou de um item, na unidade da nota (o leitor ou a câmera escolhem o item pela etiqueta do produto)
create or replace function public.est_receb_contar(p_item uuid, p_qtd numeric, p_avariada numeric default 0)
returns void language plpgsql security definer set search_path = public as $$
declare ri est_recebimento_itens; r est_recebimentos;
begin
  select * into ri from est_recebimento_itens where id = p_item;
  select * into r from est_recebimentos where id = ri.recebimento_id for update;
  if r.id is null or not public._est_receb_pode(r.empresa_id) then raise exception 'Só quem atende o almoxarifado confere o recebimento.'; end if;
  if r.situacao <> 'conferindo' then raise exception 'Esta conferência já foi concluída.'; end if;
  if p_qtd is null or p_qtd = 'NaN'::numeric or p_qtd < 0 then raise exception 'Quantidade inválida.'; end if;
  if p_avariada is null or p_avariada = 'NaN'::numeric or p_avariada < 0 or p_avariada > p_qtd then raise exception 'A quantidade avariada não pode passar da que chegou.'; end if;
  update est_recebimento_itens set contada = p_qtd, avariada = p_avariada, contado_por = auth.uid(), contado_em = now() where id = p_item;
end $$;

-- conclui: compara com a nota, avisa Compras das divergências e lança a entrada no estoque na data da chegada
create or replace function public.est_receb_concluir(p_receb uuid, p_data date default null, p_observacao text default null, p_zerar_pendentes boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r est_recebimentos; n nfe_notas; c est_config; v_data date := coalesce(p_data, (now() at time zone 'America/Recife')::date); x record; v_div int := 0; v_lanc int := 0; v_res text; v_txt text := '';
begin
  select * into r from est_recebimentos where id = p_receb for update;
  if not found or not public._est_receb_pode(r.empresa_id) then raise exception 'Só quem atende o almoxarifado confere o recebimento.'; end if;
  if r.situacao <> 'conferindo' then raise exception 'Esta conferência já foi concluída.'; end if;
  select * into n from nfe_notas where id = r.nota_id;
  select * into c from est_config where empresa_id = r.empresa_id;
  if v_data > (now() at time zone 'America/Recife')::date then raise exception 'A data da chegada não pode ser futura.'; end if;
  if v_data < n.emissao then raise exception 'O material não pode ter chegado antes da emissão da nota (%).', to_char(n.emissao, 'DD/MM/YYYY'); end if;
  if exists (select 1 from est_recebimento_itens where recebimento_id = r.id and contada is null) then
    if not coalesce(p_zerar_pendentes, false) then raise exception 'Há itens sem conferência. Confira-os, ou confirme que não chegaram (ficam com zero).'; end if;
    update est_recebimento_itens set contada = 0, contado_por = auth.uid(), contado_em = now() where recebimento_id = r.id and contada is null;
  end if;
  update est_recebimento_itens set qtd_entra = contada - avariada,
         divergencia = nullif(concat_ws('; ',
           case when contada < qtd_nota and abs(contada - qtd_nota) > qtd_nota * c.receb_tolerancia_pct / 100 then 'faltou ' || trim(to_char(qtd_nota - contada, 'FM999G999G990D####')) end,
           case when contada > qtd_nota and abs(contada - qtd_nota) > qtd_nota * c.receb_tolerancia_pct / 100 then 'sobrou ' || trim(to_char(contada - qtd_nota, 'FM999G999G990D####')) end,
           case when avariada > 0 then 'avariado ' || trim(to_char(avariada, 'FM999G999G990D####')) end), '')
   where recebimento_id = r.id;
  select count(*) into v_div from est_recebimento_itens where recebimento_id = r.id and divergencia is not null;
  update est_recebimentos set situacao = 'conferido', data = v_data, conferido_em = now(), divergencias = v_div, observacao = left(nullif(trim(coalesce(p_observacao, '')), ''), 300) where id = r.id;
  -- lança no estoque o que já pode entrar (estoque implantado e chegada a partir da implantação); o resto entra pelo reprocessamento
  if c.implantado_em is not null and v_data >= c.implantado_em then
    for x in select ri.nfe_item_id from est_recebimento_itens ri join nfe_itens i on i.id = ri.nfe_item_id where ri.recebimento_id = r.id order by i.n_item loop
      v_res := public._est_item(x.nfe_item_id);
      if v_res = 'ok' then v_lanc := v_lanc + 1; end if;
    end loop;
  end if;
  if v_div > 0 then
    select string_agg(i.cprod || ' ' || left(i.xprod, 40) || ': ' || ri.divergencia, E'\n' order by i.n_item) into v_txt
      from est_recebimento_itens ri join nfe_itens i on i.id = ri.nfe_item_id where ri.recebimento_id = r.id and ri.divergencia is not null;
    begin
      perform _notificar_u(r.empresa_id, public._usuarios_papel(r.empresa_id, array['compras', 'admin']), 'recebimento',
        'Recebimento com divergência: NF ' || n.numero || ' de ' || coalesce(n.emit_nome, n.emit_doc), left(v_txt, 900), '#/estoque/recebimento?r=' || r.id, r.id, true);
    exception when others then null; end;
  end if;
  return jsonb_build_object('divergencias', v_div, 'lancados', v_lanc, 'data', v_data);
end $$;

-- nota sem material físico (serviço, energia, frete): sai da fila com o motivo
create or replace function public.est_receb_dispensar(p_nota uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare n nfe_notas; v_num int;
begin
  select * into n from nfe_notas where id = p_nota;
  if not found or not public._est_receb_pode(n.empresa_id) then raise exception 'Só quem atende o almoxarifado confere o recebimento.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe por que esta nota não tem material para receber.'; end if;
  if exists (select 1 from est_recebimentos where nota_id = n.id and situacao in ('conferido', 'dispensado')) then raise exception 'Esta nota já foi recebida ou dispensada.'; end if;
  perform pg_advisory_xact_lock(hashtext('est_receb:' || n.empresa_id::text));
  update est_recebimentos set situacao = 'cancelado' where nota_id = n.id and situacao = 'conferindo';
  select coalesce(max(numero), 0) + 1 into v_num from est_recebimentos where empresa_id = n.empresa_id;
  insert into est_recebimentos (empresa_id, numero, nota_id, situacao, conferente_nome, conferido_em, observacao)
  values (n.empresa_id, v_num, n.id, 'dispensado', public._alm_nome(n.empresa_id), now(), 'Dispensada: ' || left(trim(p_motivo), 280));
end $$;

do $$ declare r record; begin
  for r in select p.oid::regprocedure f, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname ~ '^_?est_receb' ) loop
    execute format('revoke all on function %s from public, anon, authenticated', r.f);
    if r.proname !~ '^_' then execute format('grant execute on function %s to authenticated', r.f); end if;
  end loop;
end $$;
revoke all on function public._est_item(uuid) from public, anon, authenticated;
