-- Confronto pedido × nota × recebimento com bloqueio do pagamento (melhoria 5.3 do plano de melhoria contínua, Passo 4) — 08/11/2026.
-- Aditivo (recria compras_receber com a MESMA assinatura).
--   • o banco confere, no recebimento, quantidade, preço, itens não pedidos, prazo de pagamento e prazo de entrega contra o
--     pedido, com as tolerâncias dos parâmetros (antes a conferência era só na tela);
--   • divergência que bloqueia trava o pagamento dos títulos da nota: não entram em autorização e não podem ser baixados
--     até alguém dos papéis escolhidos liberar, com o motivo; títulos ligados à nota depois também nascem travados;
--   • tela "Confronto pedido × nota" nos Recebimentos, com as notas sem pedido.

-- 1) parâmetros
alter table public.compras_parametros add column if not exists conf_tol_preco_pct numeric(6,2) not null default 2;      -- preço da nota acima do pedido
alter table public.compras_parametros add column if not exists conf_tol_qtd_pct numeric(6,2) not null default 5;        -- quantidade acima do pedido
alter table public.compras_parametros add column if not exists conf_tol_valor numeric(14,2) not null default 10;        -- R$ de itens da nota fora do pedido
alter table public.compras_parametros add column if not exists conf_tol_prazo_dias int not null default 3;              -- vencimento antes do combinado
alter table public.compras_parametros add column if not exists conf_tol_entrega_dias int not null default 2;            -- entrega depois do previsto (informativo)
alter table public.compras_parametros add column if not exists conf_bloquear boolean not null default true;
alter table public.compras_parametros add column if not exists conf_papeis_liberar text[] not null default array['admin', 'diretor', 'financeiro'];
do $$ begin
  alter table public.compras_parametros add constraint compras_par_conf_chk check (conf_tol_preco_pct between 0 and 100 and conf_tol_qtd_pct between 0 and 100 and conf_tol_valor >= 0
    and conf_tol_prazo_dias between 0 and 60 and conf_tol_entrega_dias between 0 and 60);
exception when duplicate_object then null; end $$;

-- 2) bloqueio do pagamento
alter table public.lancamentos add column if not exists pagamento_bloqueado boolean not null default false;
create table if not exists public.compras_bloqueios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nota_id uuid not null references public.nfe_notas(id) on delete cascade,
  pedido_id uuid references public.compras_pedidos(id) on delete set null,
  recebimento_id uuid references public.compras_recebimentos(id) on delete set null,
  divergencias jsonb not null default '[]'::jsonb,
  valor_divergente numeric(16,2) not null default 0,
  situacao text not null default 'bloqueada' check (situacao in ('bloqueada', 'liberada')),
  criado_em timestamptz not null default now(),
  liberado_por text, liberado_em timestamptz, liberado_motivo text
);
create unique index if not exists compras_bloq_nota on public.compras_bloqueios(nota_id) where situacao = 'bloqueada';
alter table public.lancamentos add column if not exists bloqueio_id uuid references public.compras_bloqueios(id) on delete set null;
create index if not exists lancamentos_bloqueados on public.lancamentos(empresa_id) where pagamento_bloqueado;
alter table public.compras_bloqueios enable row level security;
drop policy if exists compras_bloq_sel on public.compras_bloqueios;
create policy compras_bloq_sel on public.compras_bloqueios for select to authenticated using (public.is_membro(empresa_id) or public.pode_comprar(empresa_id));
grant select on public.compras_bloqueios to authenticated;
drop trigger if exists zz_auditoria on public.compras_bloqueios;
create trigger zz_auditoria after insert or update or delete on public.compras_bloqueios for each row execute function public._auditar();

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('compras_bloqueio', 'Compras', 'Pagamento bloqueado: nota diverge do pedido', 'O recebimento encontrou divergência entre a nota e o pedido; o pagamento da nota está travado até a liberação.', false, 56)
on conflict (codigo) do nothing;

-- título travado: não é baixado, não entra em autorização e só destrava pela liberação
create or replace function public._lanc_trava_pagamento() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.pagamento_bloqueado and not new.pagamento_bloqueado and coalesce(current_setting('app.liberar_pagamento', true), '') <> 'sim' then
    raise exception 'O pagamento deste título está bloqueado por divergência entre a nota e o pedido. Libere em Compras › Recebimentos › Confronto.';
  end if;
  if new.pagamento_bloqueado and new.status = 'Pago' and (tg_op = 'INSERT' or old.status <> 'Pago') then
    raise exception 'Pagamento bloqueado: a nota deste título diverge do pedido de compra (%). Libere em Compras › Recebimentos › Confronto.', coalesce(new.documento, new.descricao, '');
  end if;
  return new;
end $$;
drop trigger if exists lancamentos_trava_pagamento on public.lancamentos;
create trigger lancamentos_trava_pagamento before insert or update of status, pagamento_bloqueado on public.lancamentos for each row execute function public._lanc_trava_pagamento();

create or replace function public._aut_item_trava() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.autoriza and new.lancamento_id is not null and exists (select 1 from lancamentos where id = new.lancamento_id and pagamento_bloqueado) then
    raise exception 'Título com pagamento bloqueado (nota diverge do pedido): libere em Compras › Recebimentos › Confronto antes de autorizar.';
  end if;
  return new;
end $$;
drop trigger if exists autorizacao_itens_trava on public.autorizacao_itens;
create trigger autorizacao_itens_trava before insert or update of autoriza, lancamento_id on public.autorizacao_itens for each row execute function public._aut_item_trava();

-- título ligado depois a uma nota bloqueada nasce travado
create or replace function public._vinculo_bloqueio() returns trigger language plpgsql security definer set search_path = public as $$
declare b uuid;
begin
  select id into b from compras_bloqueios where nota_id = new.nota_id and situacao = 'bloqueada';
  if b is not null then update lancamentos set pagamento_bloqueado = true, bloqueio_id = b where id = new.lancamento_id and status <> 'Pago'; end if;
  return null;
end $$;
drop trigger if exists nfe_vinculos_bloqueio on public.nfe_vinculos;
create trigger nfe_vinculos_bloqueio after insert on public.nfe_vinculos for each row execute function public._vinculo_bloqueio();

-- 3) o confronto: [{tipo, texto, item, esperado, recebido, valor, bloqueia}]
create or replace function public._compras_confronto(p_pedido uuid, p_nota uuid, p_itens jsonb, p_data date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p compras_pedidos; n nfe_notas; c compras_parametros; out jsonb := '[]'; it jsonb; pi compras_pedido_itens; v_q numeric; v_pr numeric; v_fora numeric;
  tol_p numeric; tol_q numeric; tol_v numeric; tol_d int; tol_e int; v_base date; r record; k int := 0;
begin
  select * into p from compras_pedidos where id = p_pedido;
  select * into c from compras_parametros where empresa_id = p.empresa_id;
  tol_p := coalesce(c.conf_tol_preco_pct, 2); tol_q := coalesce(c.conf_tol_qtd_pct, 5); tol_v := coalesce(c.conf_tol_valor, 10);
  tol_d := coalesce(c.conf_tol_prazo_dias, 3); tol_e := coalesce(c.conf_tol_entrega_dias, 2);
  -- itens: quantidade e preço contra o pedido
  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    select * into pi from compras_pedido_itens where id = (it ->> 'pedido_item_id')::uuid and pedido_id = p.id;
    continue when pi.id is null or coalesce((it ->> 'quantidade')::numeric, 0) <= 0;
    v_q := pi.qtd_recebida + (it ->> 'quantidade')::numeric;
    if v_q > pi.quantidade * (1 + tol_q / 100) + 0.00001 then
      out := out || jsonb_build_object('tipo', 'quantidade', 'item', pi.descricao, 'esperado', pi.quantidade, 'recebido', v_q, 'bloqueia', true,
        'valor', round((v_q - pi.quantidade) * coalesce(nullif(it ->> 'valor_unitario', '')::numeric, pi.valor_unitario), 2),
        'texto', format('%s: recebido %s de %s pedidos (tolerância %s%%)', pi.descricao, trim(to_char(v_q, 'FM999G999G990D####')), trim(to_char(pi.quantidade, 'FM999G999G990D####')), tol_q));
    end if;
    v_pr := nullif(it ->> 'valor_unitario', '')::numeric;
    if v_pr is not null and pi.valor_unitario > 0 and v_pr > pi.valor_unitario * (1 + tol_p / 100) + 0.00001 then
      out := out || jsonb_build_object('tipo', 'preco', 'item', pi.descricao, 'esperado', pi.valor_unitario, 'recebido', v_pr, 'bloqueia', true,
        'valor', round((v_pr - pi.valor_unitario) * (it ->> 'quantidade')::numeric, 2),
        'texto', format('%s: preço da nota %s acima do pedido %s (+%s%%; tolerância %s%%)', pi.descricao, to_char(v_pr, 'FM999G990D0000'), to_char(pi.valor_unitario, 'FM999G990D0000'),
                        to_char((v_pr / pi.valor_unitario - 1) * 100, 'FM990D0'), tol_p));
    end if;
  end loop;
  if p_nota is not null then
    select * into n from nfe_notas where id = p_nota;
    -- itens da nota que não estão no recebimento
    select coalesce(sum(i.vprod), 0) into v_fora from nfe_itens i where i.nota_id = n.id
       and not exists (select 1 from jsonb_array_elements(coalesce(p_itens, '[]')) x where nullif(x ->> 'nfe_item_id', '')::uuid = i.id);
    if v_fora > tol_v then
      out := out || jsonb_build_object('tipo', 'item_fora', 'valor', v_fora, 'bloqueia', true,
        'texto', format('Itens da nota fora do pedido: R$ %s (tolerância R$ %s)', translate(to_char(v_fora, 'FM999G999G990D00'), ',.', '.,'), translate(to_char(tol_v, 'FM999G990D00'), ',.', '.,')));
    end if;
    -- prazo de pagamento: cada parcela da nota contra a parcela do pedido (dias contados da emissão da nota)
    v_base := n.emissao;
    for r in select pa.numero, pa.vencimento, (p.parcelas_dias)[row_number() over (order by pa.numero)] dias from nfe_parcelas pa where pa.nota_id = n.id and pa.vencimento is not null order by pa.numero loop
      k := k + 1;
      if r.dias is not null and r.vencimento < v_base + r.dias - tol_d then
        out := out || jsonb_build_object('tipo', 'prazo_pagamento', 'esperado', v_base + r.dias, 'recebido', r.vencimento, 'bloqueia', true,
          'texto', format('Parcela %s vence %s; pelo pedido (%s dias) seria %s', r.numero, to_char(r.vencimento, 'DD/MM/YYYY'), r.dias, to_char(v_base + r.dias, 'DD/MM/YYYY')));
      end if;
    end loop;
    if k > 0 and k <> coalesce(array_length(p.parcelas_dias, 1), 0) then
      out := out || jsonb_build_object('tipo', 'parcelas', 'esperado', coalesce(array_length(p.parcelas_dias, 1), 0), 'recebido', k, 'bloqueia', false,
        'texto', format('A nota tem %s parcela(s); o pedido, %s', k, coalesce(array_length(p.parcelas_dias, 1), 0)));
    end if;
  end if;
  -- entrega (informativo; alimenta a avaliação do fornecedor)
  if p.entrega_prevista is not null and coalesce(p_data, current_date) > p.entrega_prevista + tol_e then
    out := out || jsonb_build_object('tipo', 'entrega', 'esperado', p.entrega_prevista, 'recebido', coalesce(p_data, current_date), 'bloqueia', false,
      'texto', format('Entrega %s dia(s) depois do previsto (%s)', coalesce(p_data, current_date) - p.entrega_prevista, to_char(p.entrega_prevista, 'DD/MM/YYYY')));
  end if;
  return out;
end $$;
revoke all on function public._compras_confronto(uuid, uuid, jsonb, date) from public, anon, authenticated;

-- prévia na tela (antes de registrar)
create or replace function public.compras_confrontar(p_pedido uuid, p_nota uuid, p_itens jsonb, p_data date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p compras_pedidos;
begin
  select * into p from compras_pedidos where id = p_pedido;
  if p.id is null or not pode_comprar(p.empresa_id) then raise exception 'Sem acesso a este pedido.'; end if;
  return _compras_confronto(p_pedido, p_nota, p_itens, p_data);
end $$;
revoke all on function public.compras_confrontar(uuid, uuid, jsonb, date) from public, anon;
grant execute on function public.compras_confrontar(uuid, uuid, jsonb, date) to authenticated;

-- 4) recebimento (recriado: o mesmo de antes + o confronto do banco e o bloqueio)
create or replace function public.compras_receber(p_pedido uuid, p_nota uuid, p_data date, p_itens jsonb, p_divergencias jsonb,
                                                  p_lancar_parcelas boolean, p_observacao text)
returns uuid language plpgsql security definer set search_path = public as $$
declare p compras_pedidos; rid uuid; it jsonb; pi compras_pedido_itens; f text; n nfe_notas; pa record; lid uuid; falta numeric; v_div jsonb; cfg compras_parametros; b uuid; v_val numeric;
begin
  select * into p from compras_pedidos where id = p_pedido for update;
  if p.id is null or not pode_comprar(p.empresa_id) then raise exception 'Sem acesso a este pedido.'; end if;
  if p.status not in ('aprovado', 'enviado', 'recebido_parcial') then raise exception 'Só pedido aprovado pode ser recebido (situação atual: %).', p.status; end if;
  if p_nota is not null then
    select * into n from nfe_notas where id = p_nota and empresa_id = p.empresa_id and tipo = 'entrada';
    if n.id is null then raise exception 'Nota de entrada não encontrada.'; end if;
  end if;
  if jsonb_array_length(coalesce(p_itens, '[]'::jsonb)) = 0 then raise exception 'Informe ao menos um item recebido.'; end if;
  v_div := _compras_confronto(p.id, p_nota, p_itens, coalesce(p_data, current_date))
        || coalesce((select jsonb_agg(d || '{"bloqueia":false}'::jsonb) from jsonb_array_elements(coalesce(p_divergencias, '[]'::jsonb)) d
                      where d ->> 'tipo' in ('nota_qtd', 'nao_veio', 'parcial')), '[]'::jsonb);   -- o que só a tela confere (nota × contado)
  insert into compras_recebimentos (empresa_id, pedido_id, nfe_nota_id, data, divergencias, observacao)
  values (p.empresa_id, p.id, p_nota, coalesce(p_data, current_date), v_div, p_observacao) returning id into rid;
  for it in select * from jsonb_array_elements(p_itens) loop
    select * into pi from compras_pedido_itens where id = (it->>'pedido_item_id')::uuid and pedido_id = p.id;
    if pi.id is null then raise exception 'Item não pertence ao pedido.'; end if;
    if coalesce((it->>'quantidade')::numeric, 0) <= 0 then continue; end if;
    insert into compras_recebimento_itens (empresa_id, recebimento_id, pedido_item_id, nfe_item_id, quantidade, valor_unitario)
    values (p.empresa_id, rid, pi.id, nullif(it->>'nfe_item_id', '')::uuid, (it->>'quantidade')::numeric, nullif(it->>'valor_unitario', '')::numeric);
    update compras_pedido_itens set qtd_recebida = qtd_recebida + (it->>'quantidade')::numeric where id = pi.id;
  end loop;
  select coalesce(sum(greatest(quantidade - qtd_recebida, 0)), 0) into falta from compras_pedido_itens where pedido_id = p.id;
  update compras_pedidos set status = case when falta <= 0 then 'recebido' else 'recebido_parcial' end where id = p.id;   -- refaz a previsão pelo que falta
  -- divergência que bloqueia: trava o pagamento da nota (os títulos de agora e os que forem ligados depois)
  select * into cfg from compras_parametros where empresa_id = p.empresa_id;
  if p_nota is not null and coalesce(cfg.conf_bloquear, true) and exists (select 1 from jsonb_array_elements(v_div) d where (d ->> 'bloqueia')::boolean) then
    select coalesce(sum((d ->> 'valor')::numeric), 0) into v_val from jsonb_array_elements(v_div) d where (d ->> 'bloqueia')::boolean;
    select id into b from compras_bloqueios where nota_id = p_nota and situacao = 'bloqueada';
    if b is null then
      insert into compras_bloqueios(empresa_id, nota_id, pedido_id, recebimento_id, divergencias, valor_divergente) values (p.empresa_id, p_nota, p.id, rid, v_div, v_val) returning id into b;
    else
      update compras_bloqueios set divergencias = divergencias || v_div, valor_divergente = valor_divergente + v_val, recebimento_id = rid where id = b;
    end if;
    perform _notificar_u(p.empresa_id, _usuarios_papel(p.empresa_id, coalesce(cfg.conf_papeis_liberar, array['admin', 'diretor', 'financeiro'])) || _usuarios_papel(p.empresa_id, array['compras']),
      'compras_bloqueio', 'Pagamento bloqueado: NF ' || n.numero || ' diverge do PC ' || p.numero,
      (select string_agg(d ->> 'texto', ' · ') from jsonb_array_elements(v_div) d where (d ->> 'bloqueia')::boolean), '#/compras/recebimentos?aba=confronto', b, false);
  end if;
  if p_lancar_parcelas and p_nota is not null then
    select nome into f from favorecidos where id = p.favorecido_id;
    for pa in select * from nfe_parcelas where nota_id = p_nota
               and not exists (select 1 from nfe_vinculos v where v.parcela_id = nfe_parcelas.id or (v.nota_id = p_nota and v.parcela_id is null))
               order by numero loop
      insert into lancamentos (empresa_id, data, plano_id, descricao, favorecido_id, centro_custo_id, status, valor, origem, documento, emissao)
      values (p.empresa_id, coalesce(pa.vencimento, n.emissao), p.plano_id, left(format('NF %s — %s — PC %s', n.numero, f, p.numero), 250),
              p.favorecido_id, p.centro_custo_id, 'Em aberto', pa.valor, 'compras:nota', format('%s-%s', n.numero, pa.numero), n.emissao)
      returning id into lid;
      insert into nfe_vinculos (empresa_id, nota_id, parcela_id, lancamento_id, tipo) values (p.empresa_id, p_nota, pa.id, lid, 'exata');
      insert into compras_pedido_lancamentos (empresa_id, pedido_id, lancamento_id, tipo) values (p.empresa_id, p.id, lid, 'nota');
    end loop;
  end if;
  if b is not null then   -- títulos já existentes da nota
    update lancamentos l set pagamento_bloqueado = true, bloqueio_id = b
      from nfe_vinculos v where v.nota_id = p_nota and v.lancamento_id = l.id and l.status <> 'Pago';
  end if;
  return rid;
end $$;
revoke all on function public.compras_receber(uuid, uuid, date, jsonb, jsonb, boolean, text) from public, anon;
grant execute on function public.compras_receber(uuid, uuid, date, jsonb, jsonb, boolean, text) to authenticated;

-- 5) liberar o pagamento (papéis dos parâmetros), com o motivo
create or replace function public.compras_liberar_pagamento(p_bloqueio uuid, p_motivo text)
returns int language plpgsql security definer set search_path = public as $$
declare b compras_bloqueios; n int;
begin
  select * into b from compras_bloqueios where id = p_bloqueio for update;
  if b.id is null then raise exception 'Bloqueio não encontrado.'; end if;
  if not exists (select 1 from membros m where m.empresa_id = b.empresa_id and m.user_id = auth.uid()
                  and (m.papel::text = 'admin' or m.papel::text = any(coalesce((select conf_papeis_liberar from compras_parametros where empresa_id = b.empresa_id), array['admin', 'diretor', 'financeiro'])))) then
    raise exception 'Seu perfil não libera pagamento bloqueado.'; end if;
  if b.situacao <> 'bloqueada' then raise exception 'Este bloqueio já foi liberado.'; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo da liberação (ex.: fornecedor emitiu nota de débito, diferença aceita pela diretoria).'; end if;
  perform set_config('app.liberar_pagamento', 'sim', true);
  update lancamentos set pagamento_bloqueado = false where bloqueio_id = b.id;
  get diagnostics n = row_count;
  update compras_bloqueios set situacao = 'liberada', liberado_por = auth.jwt() ->> 'email', liberado_em = now(), liberado_motivo = trim(p_motivo) where id = b.id;
  return n;
end $$;
revoke all on function public.compras_liberar_pagamento(uuid, text) from public, anon;
grant execute on function public.compras_liberar_pagamento(uuid, text) to authenticated;

-- 6) a tela: notas de entrada dos fornecedores com o pedido, as divergências, o bloqueio e as notas sem pedido
create or replace function public.compras_confronto_lista(p_empresa uuid, p_de date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_membro(p_empresa) or pode_comprar(p_empresa)) then raise exception 'Acesso negado.'; end if;
  return (select coalesce(jsonb_agg(x order by x ->> 'emissao' desc, x ->> 'numero' desc), '[]') from (
    select jsonb_build_object('nota_id', n.id, 'numero', n.numero, 'serie', n.serie, 'emissao', n.emissao, 'fornecedor', coalesce(fv.nome, n.emit_nome), 'v_nf', n.v_nf,
      'pedidos', (select coalesce(jsonb_agg(distinct jsonb_build_object('id', pd.id, 'numero', pd.numero)), '[]') from compras_recebimentos r join compras_pedidos pd on pd.id = r.pedido_id where r.nfe_nota_id = n.id),
      'divergencias', (select coalesce(jsonb_agg(d), '[]') from compras_recebimentos r, jsonb_array_elements(r.divergencias) d where r.nfe_nota_id = n.id),
      'bloqueio', (select to_jsonb(b) from compras_bloqueios b where b.nota_id = n.id order by b.criado_em desc limit 1),
      'titulos', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'data', l.data, 'valor', l.valor, 'status', l.status, 'bloqueado', l.pagamento_bloqueado) order by l.data), '[]')
                    from nfe_vinculos v join lancamentos l on l.id = v.lancamento_id where v.nota_id = n.id)) x
      from nfe_notas n left join favorecidos fv on fv.id = n.favorecido_id
     where n.empresa_id = p_empresa and n.tipo = 'entrada' and not n.emissao_propria and n.situacao = 'autorizada' and n.emissao >= p_de) z);
end $$;
revoke all on function public.compras_confronto_lista(uuid, date) from public, anon;
grant execute on function public.compras_confronto_lista(uuid, date) to authenticated;

select (select count(*) from information_schema.columns where table_name = 'compras_parametros' and column_name like 'conf_%') as parametros,
       (select count(*) from information_schema.columns where table_name = 'lancamentos' and column_name in ('pagamento_bloqueado', 'bloqueio_id')) as colunas;
