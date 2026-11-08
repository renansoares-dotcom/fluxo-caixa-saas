-- Confronto pedido × nota (SQL 133): divergências no banco, bloqueio do pagamento, trava na baixa e na autorização, liberação com motivo.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1', 'email', 'usuario.a@t.com')::text, false);
  set role authenticated;
end $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_msg; end if; end $$;
create or replace function pg_temp.falha(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FALHOU (devia dar erro): %', p_msg;
end $$;
\set E '''e000000a-0000-0000-0000-000000000000'''
insert into compras_parametros(empresa_id) values (:E) on conflict (empresa_id) do nothing;
update compras_parametros set conf_tol_preco_pct = 2, conf_tol_qtd_pct = 5, conf_tol_valor = 10, conf_tol_prazo_dias = 3, conf_tol_entrega_dias = 2, conf_bloquear = true where empresa_id = :E;
insert into favorecidos(id, empresa_id, tipo, nome) values ('69000000-0000-0000-0000-0000000000f1', :E, 'FORNECEDORES', 'FORNECEDOR 69');
set session_replication_role = replica;   -- pedidos já aprovados, sem a previsão
insert into compras_pedidos(id, empresa_id, numero, favorecido_id, data_pedido, entrega_prevista, parcelas_dias, status, plano_id) values
  ('69000000-0000-0000-0000-0000000000a1', :E, 96901, '69000000-0000-0000-0000-0000000000f1', current_date - 20, current_date - 10, '{28,56}', 'aprovado', 'f000000a-0000-0000-0000-000000000000'),
  ('69000000-0000-0000-0000-0000000000a2', :E, 96902, '69000000-0000-0000-0000-0000000000f1', current_date - 5, current_date + 3, '{30}', 'aprovado', 'f000000a-0000-0000-0000-000000000000');
insert into compras_pedido_itens(id, empresa_id, pedido_id, descricao, quantidade, valor_unitario) values
  ('69000000-0000-0000-0000-0000000000b1', :E, '69000000-0000-0000-0000-0000000000a1', 'RESINA PEBD', 1000, 9.00),
  ('69000000-0000-0000-0000-0000000000b2', :E, '69000000-0000-0000-0000-0000000000a1', 'MASTER BRANCO', 50, 20.00),
  ('69000000-0000-0000-0000-0000000000b3', :E, '69000000-0000-0000-0000-0000000000a2', 'TINTA AZUL', 100, 30.00);
set session_replication_role = origin;
-- nota 1 (diverge): preço +5% na resina, 10% a mais de master, frete de R$ 40 fora do pedido, 1ª parcela em 14 dias (pedido: 28)
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, emit_nome, favorecido_id, v_nf) values
  ('69000000-0000-0000-0000-0000000000c1', :E, '69C1', 96911, current_date - 3, 'entrada', false, 'autorizada', 'FORNECEDOR 69', '69000000-0000-0000-0000-0000000000f1', 10590),
  ('69000000-0000-0000-0000-0000000000c2', :E, '69C2', 96912, current_date, 'entrada', false, 'autorizada', 'FORNECEDOR 69', '69000000-0000-0000-0000-0000000000f1', 3000);
insert into nfe_itens(id, empresa_id, nota_id, n_item, xprod, qcom, vuncom, vprod) values
  ('69000000-0000-0000-0000-0000000000d1', :E, '69000000-0000-0000-0000-0000000000c1', 1, 'RESINA PEBD', 1000, 9.45, 9450),
  ('69000000-0000-0000-0000-0000000000d2', :E, '69000000-0000-0000-0000-0000000000c1', 2, 'MASTER BRANCO', 55, 20, 1100),
  ('69000000-0000-0000-0000-0000000000d3', :E, '69000000-0000-0000-0000-0000000000c1', 3, 'PALETE', 1, 40, 40),
  ('69000000-0000-0000-0000-0000000000d4', :E, '69000000-0000-0000-0000-0000000000c2', 1, 'TINTA AZUL', 100, 30.30, 3030);
insert into nfe_parcelas(empresa_id, nota_id, numero, vencimento, valor) values
  (:E, '69000000-0000-0000-0000-0000000000c1', 1, current_date - 3 + 14, 5295), (:E, '69000000-0000-0000-0000-0000000000c1', 2, current_date - 3 + 56, 5295),
  (:E, '69000000-0000-0000-0000-0000000000c2', 1, current_date + 30, 3030);

-- leitura não confronta; compras confronta (prévia)
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($$select public.compras_confrontar('69000000-0000-0000-0000-0000000000a1', null, '[]', current_date)$$, 'leitura não confronta');
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
create temp table dv as select public.compras_confrontar('69000000-0000-0000-0000-0000000000a1', '69000000-0000-0000-0000-0000000000c1',
  '[{"pedido_item_id":"69000000-0000-0000-0000-0000000000b1","nfe_item_id":"69000000-0000-0000-0000-0000000000d1","quantidade":1000,"valor_unitario":9.45},
    {"pedido_item_id":"69000000-0000-0000-0000-0000000000b2","nfe_item_id":"69000000-0000-0000-0000-0000000000d2","quantidade":55,"valor_unitario":20}]', current_date) d;
select pg_temp.ok((select jsonb_path_exists(d, '$[*] ? (@.tipo == "preco" && @.valor == 450)') from dv), 'preço +5%: R$ 450');
select pg_temp.ok((select jsonb_path_exists(d, '$[*] ? (@.tipo == "quantidade" && @.recebido == 55)') from dv), 'quantidade 55 de 50');
select pg_temp.ok((select jsonb_path_exists(d, '$[*] ? (@.tipo == "item_fora" && @.valor == 40)') from dv), 'palete fora do pedido');
select pg_temp.ok((select jsonb_path_exists(d, '$[*] ? (@.tipo == "prazo_pagamento")') from dv), '1ª parcela antes do prazo');
select pg_temp.ok((select jsonb_array_length(jsonb_path_query_array(d, '$[*] ? (@.tipo == "prazo_pagamento")')) = 1 from dv), 'a 2ª parcela (56 dias) está certa');
select pg_temp.ok((select jsonb_path_exists(d, '$[*] ? (@.tipo == "entrega" && @.bloqueia == false)') from dv), 'entrega atrasada é informativa');

-- recebe: bloqueia e trava os títulos
select public.compras_receber('69000000-0000-0000-0000-0000000000a1', '69000000-0000-0000-0000-0000000000c1', current_date,
  '[{"pedido_item_id":"69000000-0000-0000-0000-0000000000b1","nfe_item_id":"69000000-0000-0000-0000-0000000000d1","quantidade":1000,"valor_unitario":9.45},
    {"pedido_item_id":"69000000-0000-0000-0000-0000000000b2","nfe_item_id":"69000000-0000-0000-0000-0000000000d2","quantidade":55,"valor_unitario":20}]', '[]', true, null);
-- dentro da tolerância (preço +1%, prazo 30): não bloqueia
select public.compras_receber('69000000-0000-0000-0000-0000000000a2', '69000000-0000-0000-0000-0000000000c2', current_date,
  '[{"pedido_item_id":"69000000-0000-0000-0000-0000000000b3","nfe_item_id":"69000000-0000-0000-0000-0000000000d4","quantidade":100,"valor_unitario":30.30}]', '[]', true, null);
reset role;
select pg_temp.ok((select count(*) = 1 and bool_and(situacao = 'bloqueada') and bool_and(valor_divergente = 450 + 100 + 40) from compras_bloqueios where nota_id = '69000000-0000-0000-0000-0000000000c1'), 'bloqueio com R$ 590');
select pg_temp.ok((select count(*) = 0 from compras_bloqueios where nota_id = '69000000-0000-0000-0000-0000000000c2'), 'nota dentro da tolerância não bloqueia');
select pg_temp.ok((select count(*) = 2 and bool_and(l.pagamento_bloqueado) from nfe_vinculos v join lancamentos l on l.id = v.lancamento_id where v.nota_id = '69000000-0000-0000-0000-0000000000c1'), 'os 2 títulos travados');
select pg_temp.ok((select bool_and(not l.pagamento_bloqueado) from nfe_vinculos v join lancamentos l on l.id = v.lancamento_id where v.nota_id = '69000000-0000-0000-0000-0000000000c2'), 'título da outra nota livre');
select pg_temp.ok((select jsonb_array_length(divergencias) >= 4 from compras_recebimentos where nfe_nota_id = '69000000-0000-0000-0000-0000000000c1'), 'divergências gravadas pelo banco');
select pg_temp.ok((select count(*) >= 1 from notificacoes where tipo = 'compras_bloqueio'), 'avisou');
select l.id as lanc from nfe_vinculos v join lancamentos l on l.id = v.lancamento_id where v.nota_id = '69000000-0000-0000-0000-0000000000c1' order by l.data limit 1 \gset

-- trava: baixa, destravar na mão e autorizar
select pg_temp.falha(format($$update lancamentos set status = 'Pago' where id = %L$$, :'lanc'), 'não baixa título bloqueado');
select pg_temp.falha(format($$update lancamentos set pagamento_bloqueado = false where id = %L$$, :'lanc'), 'não destrava na mão');
insert into autorizacoes(id, empresa_id, numero) values ('69000000-0000-0000-0000-0000000000e1', :E, 96901);
select pg_temp.falha(format($$insert into autorizacao_itens(autorizacao_id, empresa_id, lancamento_id, valor, autoriza) values ('69000000-0000-0000-0000-0000000000e1', %L, %L, 5295, true)$$, 'e000000a-0000-0000-0000-000000000000', :'lanc'), 'não autoriza título bloqueado');
insert into autorizacao_itens(autorizacao_id, empresa_id, lancamento_id, valor, autoriza) values ('69000000-0000-0000-0000-0000000000e1', :E, :'lanc', 5295, false);
-- título ligado depois à nota bloqueada nasce travado
insert into lancamentos(id, empresa_id, data, plano_id, valor, descricao, status) values ('69000000-0000-0000-0000-0000000000a9', :E, current_date + 40, 'f000000a-0000-0000-0000-000000000000', 100, 'complemento NF 96911', 'Em aberto');
insert into nfe_vinculos(empresa_id, nota_id, lancamento_id, tipo) values (:E, '69000000-0000-0000-0000-0000000000c1', '69000000-0000-0000-0000-0000000000a9', 'manual');
select pg_temp.ok((select pagamento_bloqueado from lancamentos where id = '69000000-0000-0000-0000-0000000000a9'), 'vínculo posterior trava');

-- liberação: compras não libera; financeiro libera com motivo
select id as bq from compras_bloqueios where nota_id = '69000000-0000-0000-0000-0000000000c1' \gset
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
select pg_temp.falha(format($$select public.compras_liberar_pagamento(%L, 'Diferença aceita')$$, :'bq'), 'compras não libera');
select pg_temp.ok((select jsonb_array_length(public.compras_confronto_lista(:E, current_date - 30)) >= 2), 'lista do confronto');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha(format($$select public.compras_liberar_pagamento(%L, 'ok')$$, :'bq'), 'motivo curto');
select pg_temp.ok((select public.compras_liberar_pagamento(:'bq', 'Fornecedor emitiu nota de débito de R$ 590') = 3), 'libera os 3 títulos');
select pg_temp.falha(format($$select public.compras_liberar_pagamento(%L, 'De novo, outra vez')$$, :'bq'), 'não libera duas vezes');
reset role;
select pg_temp.ok((select situacao = 'liberada' and liberado_por = 'usuario.a@t.com' and liberado_motivo like 'Fornecedor%' from compras_bloqueios where id = :'bq'), 'liberação registrada');
update autorizacao_itens set autoriza = true where autorizacao_id = '69000000-0000-0000-0000-0000000000e1';
update lancamentos set status = 'Pago' where id = :'lanc';
select pg_temp.ok((select status = 'Pago' from lancamentos where id = :'lanc'), 'liberado, paga');
\o
select 'ok 69 confronto pedido × nota';
