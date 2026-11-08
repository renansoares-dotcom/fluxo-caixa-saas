-- Cotação por link (SQL 132): convite, página pública do fornecedor (anon), resposta, nova resposta, recusa, validade e avisos.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1', 'email', 'compras.a@exemplo.com')::text, false);
  set role authenticated;
end $$;
create or replace function pg_temp.anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', '{"role":"anon"}', false); perform set_config('request.jwt.claim.sub', '', false); set role anon; end $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_msg; end if; end $$;
create or replace function pg_temp.falha(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FALHOU (devia dar erro): %', p_msg;
end $$;
grant execute on function pg_temp.ok(boolean, text), pg_temp.falha(text, text) to anon;
\set E '''e000000a-0000-0000-0000-000000000000'''
insert into favorecidos(id, empresa_id, tipo, nome, email) values ('68000000-0000-0000-0000-0000000000f1', :E, 'FORNECEDORES', 'FORNECEDOR 68', 'vendas@forn68.exemplo');
insert into compras_requisicoes(id, empresa_id, numero, status) values ('68000000-0000-0000-0000-0000000000a1', :E, 96801, 'aprovada'), ('68000000-0000-0000-0000-0000000000a2', :E, 96802, 'cancelada');
insert into compras_requisicao_itens(id, empresa_id, requisicao_id, descricao, unidade, quantidade) values
  ('68000000-0000-0000-0000-0000000000b1', :E, '68000000-0000-0000-0000-0000000000a1', 'RESINA PEBD', 'KG', 1000),
  ('68000000-0000-0000-0000-0000000000b2', :E, '68000000-0000-0000-0000-0000000000a1', 'MASTER BRANCO', 'KG', 50);
create temp table tk(t text, n int); grant all on tk to authenticated, anon;

select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($$select public.compras_convidar('68000000-0000-0000-0000-0000000000a1', null, 'X', null)$$, 'leitura não convida');
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
select pg_temp.falha($$select public.compras_convidar('68000000-0000-0000-0000-0000000000a2', null, 'X', null)$$, 'requisição cancelada');
select pg_temp.falha($$select public.compras_convidar('68000000-0000-0000-0000-0000000000a1', null, 'X', 'sem-arroba')$$, 'e-mail inválido');
insert into tk select public.compras_convidar('68000000-0000-0000-0000-0000000000a1', '68000000-0000-0000-0000-0000000000f1', null, null), 1;
insert into tk select public.compras_convidar('68000000-0000-0000-0000-0000000000a1', null, 'FORNECEDOR SEM CADASTRO', null, '81999990068'), 2;
reset role;
select pg_temp.ok((select length(t) = 64 from tk where n = 1), 'token de 64');
select pg_temp.ok((select count(*) = 1 and bool_and(para = 'vendas@forn68.exemplo') from email_fila where codigo = 'cotacao_convite' and campos ->> 'caminho' like 'cotacao.html?t=%'), 'e-mail pelo cadastro');

-- o fornecedor abre e responde sem login
select pg_temp.anon();
select pg_temp.falha($$select public.cotacao_link_abrir('x')$$, 'token inválido');
select pg_temp.ok((select (public.cotacao_link_abrir(t) ->> 'fornecedor') = 'FORNECEDOR 68' and jsonb_array_length(public.cotacao_link_abrir(t) -> 'itens') = 2 from tk where n = 1), 'abre');
select pg_temp.falha($$select public.cotacao_link_responder((select t from tk where n = 1), '[{"item_id":"68000000-0000-0000-0000-0000000000b1","valor_unitario":-1}]', 10, '28/42', '{28,42}', 0, null, 'Ana', null)$$, 'preço negativo');
select pg_temp.falha($$select public.cotacao_link_responder((select t from tk where n = 1), '[{"item_id":"68000000-0000-0000-0000-0000000000b1","valor_unitario":9.5}]', 10, '28/42', '{28,42}', 0, null, '', null)$$, 'sem nome');
select pg_temp.falha($$select public.cotacao_link_responder((select t from tk where n = 1), '[{"item_id":"68000000-0000-0000-0000-0000000000a1","valor_unitario":9.5}]', 10, null, null, 0, null, 'Ana', null)$$, 'item de outra requisição');
select public.cotacao_link_responder((select t from tk where n = 1), '[{"item_id":"68000000-0000-0000-0000-0000000000b1","valor_unitario":9.5},{"item_id":"68000000-0000-0000-0000-0000000000b2","valor_unitario":22}]',
  10, '28/42 dias', '{28,42}', 150, current_date + 15, 'Preço com ICMS', 'Ana Vendas', 'ana@forn68.exemplo');
select pg_temp.ok((select (public.cotacao_link_abrir(t) -> 'resposta' ->> 'frete')::numeric = 150 and (public.cotacao_link_abrir(t) -> 'itens' -> 0 ->> 'preco') is not null from tk where n = 1), 'vê a própria resposta');
-- corrige a resposta (mesma cotação)
select public.cotacao_link_responder((select t from tk where n = 1), '[{"item_id":"68000000-0000-0000-0000-0000000000b1","valor_unitario":9.2},{"item_id":"68000000-0000-0000-0000-0000000000b2","valor_unitario":22}]',
  8, '28/42 dias', '{28,42}', 150, current_date + 15, null, 'Ana Vendas', null);
select public.cotacao_link_recusar((select t from tk where n = 2), 'Sem estoque de master');
select pg_temp.falha($$select public.cotacao_link_recusar((select t from tk where n = 1), 'x')$$, 'respondido não recusa');
reset role;
select pg_temp.ok((select count(*) = 1 from compras_cotacoes where requisicao_id = '68000000-0000-0000-0000-0000000000a1' and respondida_pelo_fornecedor), 'uma cotação só');
select pg_temp.ok((select prazo_entrega_dias = 8 and frete = 150 and parcelas_dias = '{28,42}' and favorecido_id = '68000000-0000-0000-0000-0000000000f1' from compras_cotacoes where requisicao_id = '68000000-0000-0000-0000-0000000000a1'), 'cotação atualizada');
select pg_temp.ok((select valor_unitario = 9.2 from compras_cotacao_itens where requisicao_item_id = '68000000-0000-0000-0000-0000000000b1'), 'preço corrigido');
select pg_temp.ok((select situacao = 'respondido' and respondido_por like 'Ana Vendas%' from compras_cotacao_convites where token = (select t from tk where n = 1)), 'convite respondido');
select pg_temp.ok((select situacao = 'recusado' and recusa_motivo = 'Sem estoque de master' from compras_cotacao_convites where token = (select t from tk where n = 2)), 'recusado');
select pg_temp.ok((select count(*) >= 3 from notificacoes where tipo = 'cotacao_respondida' and ref_id = '68000000-0000-0000-0000-0000000000a1'), 'comprador avisado');
-- escolhida: não muda mais; vencida: não responde
update compras_cotacoes set escolhida = true where requisicao_id = '68000000-0000-0000-0000-0000000000a1';
select pg_temp.anon();
select pg_temp.falha($$select public.cotacao_link_responder((select t from tk where n = 1), '[{"item_id":"68000000-0000-0000-0000-0000000000b1","valor_unitario":1}]', 1, null, null, 0, null, 'Ana', null)$$, 'escolhida');
reset role;
update compras_cotacoes set escolhida = false where requisicao_id = '68000000-0000-0000-0000-0000000000a1';
update compras_cotacao_convites set expira_em = current_date - 1 where token = (select t from tk where n = 1);
select pg_temp.anon();
select pg_temp.ok((select (public.cotacao_link_abrir(t) ->> 'vencido')::boolean from tk where n = 1), 'vencido');
select pg_temp.falha($$select public.cotacao_link_responder((select t from tk where n = 1), '[{"item_id":"68000000-0000-0000-0000-0000000000b1","valor_unitario":1}]', 1, null, null, 0, null, 'Ana', null)$$, 'vencido não responde');
select pg_temp.ok((select count(*) = 0 from compras_cotacao_convites), 'anon não lê a tabela');
reset role;
\o
select 'ok 68 cotação por link';
