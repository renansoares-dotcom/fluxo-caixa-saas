-- Alçadas e remessa CNAB (SQL 109): alçada por valor, dupla aprovação, segregação, Minhas aprovações, trava e NSA.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1')::text, false);
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

-- diretor fictício na empresa A
reset role;
insert into auth.users(id, email) values ('d1000000-0000-0000-0000-0000000000d1', 'diretor.a@exemplo.com') on conflict do nothing;
insert into membros(empresa_id, user_id, papel) values (:E, 'd1000000-0000-0000-0000-0000000000d1', 'diretor') on conflict do nothing;

-- sem alçada: regra antiga (diretor aprova a autorização inteira)
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
insert into autorizacoes(id, empresa_id, numero) values ('a1000109-0000-0000-0000-000000000000', :E, 901);
select pg_temp.ok((select pag_preparar('a1000109-0000-0000-0000-000000000000') ->> 'alcadas') = 'false', 'sem alçada cadastrada');

-- só o administrador cadastra alçadas
select pg_temp.falha($$insert into pag_alcadas(empresa_id, nome, valor_min, valor_max, papeis) values ('e000000a-0000-0000-0000-000000000000', 'X', 0, 10, '{financeiro}')$$, 'financeiro não cria alçada');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into pag_alcadas(empresa_id, nome, valor_min, valor_max, papeis, aprovacoes, ordem) values
  (:E, 'Até R$ 5 mil', 0, 5000, '{financeiro}', 1, 1),
  (:E, 'Acima de R$ 5 mil', 5000.01, null, '{diretor,admin}', 2, 2);

-- financeiro elabora a autorização com 3 títulos
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
insert into autorizacoes(id, empresa_id, numero) values ('a2000109-0000-0000-0000-000000000000', :E, 902);
insert into autorizacao_itens(id, autorizacao_id, empresa_id, favorecido, valor, autoriza, valor_autorizado) values
  ('b1000109-0000-0000-0000-000000000001', 'a2000109-0000-0000-0000-000000000000', :E, 'Pequeno', 1000, true, 1000),
  ('b1000109-0000-0000-0000-000000000002', 'a2000109-0000-0000-0000-000000000000', :E, 'Grande', 20000, true, 20000),
  ('b1000109-0000-0000-0000-000000000003', 'a2000109-0000-0000-0000-000000000000', :E, 'Não marcado', 300, false, 0);
select pg_temp.ok((select (pag_preparar('a2000109-0000-0000-0000-000000000000') ->> 'com_alcada')::int) = 2, 'dois títulos nas alçadas');
-- quem elaborou não aprova (segregação)
select pg_temp.falha($$select pag_decidir('a2000109-0000-0000-0000-000000000000', null, true)$$, 'quem elaborou não aprova');
reset role;
select pg_temp.ok((select count(*) from notificacoes where tipo = 'pag_alcada' and user_id in ('a0000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-0000000000d1')) = 2, 'aprovadores da alçada maior avisados');
update autorizacoes set created_by = 'a0000000-0000-0000-0000-00000000000a' where id = 'a2000109-0000-0000-0000-000000000000';
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select count(*) from minhas_aprovacoes(:E) where tipo = 'pagamento') = 1, 'aparece em Minhas aprovações');
select pg_temp.falha($$select pag_decidir('a2000109-0000-0000-0000-000000000000', array['b1000109-0000-0000-0000-000000000002'::uuid], true)$$, 'grande está fora da alçada do financeiro');
select pag_decidir('a2000109-0000-0000-0000-000000000000', null, true);
select pg_temp.ok((select situacao from autorizacao_itens where id = 'b1000109-0000-0000-0000-000000000001') = 'aprovado', 'pequeno aprovado pelo financeiro');
select pg_temp.ok((select situacao from autorizacao_itens where id = 'b1000109-0000-0000-0000-000000000002') = 'pendente', 'grande continua pendente');
-- autorização não fecha "na mão" com título pendente
select pg_temp.entrar('d1000000-0000-0000-0000-0000000000d1');
select pg_temp.falha($$update autorizacoes set status = 'Aprovada' where id = 'a2000109-0000-0000-0000-000000000000'$$, 'trava da aprovação manual');
-- dupla aprovação: diretor + administrador
select pag_decidir('a2000109-0000-0000-0000-000000000000', null, true);
select pg_temp.ok((select situacao from autorizacao_itens where id = 'b1000109-0000-0000-0000-000000000002') = 'pendente', 'falta a segunda aprovação');
select pg_temp.ok((select count(*) from minhas_aprovacoes(:E) where tipo = 'pagamento') = 0, 'quem já aprovou não vê de novo');
reset role;
update autorizacoes set created_by = 'd0000000-0000-0000-0000-00000000000d' where id = 'a2000109-0000-0000-0000-000000000000';
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.falha($$select pag_decidir('a2000109-0000-0000-0000-000000000000', null, false, '')$$, 'recusa pede motivo');
select pag_decidir('a2000109-0000-0000-0000-000000000000', null, true);
reset role;
select pg_temp.ok((select situacao from autorizacao_itens where id = 'b1000109-0000-0000-0000-000000000002') = 'aprovado', 'aprovado com duas assinaturas');
select pg_temp.ok((select status from autorizacoes where id = 'a2000109-0000-0000-0000-000000000000') = 'Aprovada', 'autorização aprovada quando tudo foi decidido');

-- remessa: NSA sequencial, título não entra em duas remessas
update contas set banco_codigo = '341' where id = 'c000000a-0000-0000-0000-000000000000';
insert into lancamentos(id, empresa_id, data, plano_id, conta_id, valor, descricao) values
  ('aa000109-0000-0000-0000-000000000001', :E, current_date + 5, 'f000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 1000, 'título da remessa');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select (pag_remessa_criar('c000000a-0000-0000-0000-000000000000', 'a2000109-0000-0000-0000-000000000000', current_date + 1,
  '[{"lancamento_id":"aa000109-0000-0000-0000-000000000001","forma":"ted","valor":1000,"favorecido":"Pequeno"}]') ->> 'id') as rem \gset
select pg_temp.ok((select nsa from pag_remessas where id = :'rem') = 1, 'NSA 1');
select pg_temp.falha($$select pag_remessa_criar('c000000a-0000-0000-0000-000000000000', null, current_date + 1, '[{"lancamento_id":"aa000109-0000-0000-0000-000000000001","forma":"ted","valor":1000}]')$$, 'título já está numa remessa');
select pag_remessa_gravar(:'rem', 'ARQUIVO', 'PAG.REM');
select pg_temp.falha($$select pag_remessa_gravar('$$ || :'rem' || $$', 'X', 'Y')$$, 'arquivo não é regravado');
select pag_remessa_cancelar(:'rem', 'banco recusou o arquivo');
select pg_temp.ok((select (pag_remessa_criar('c000000a-0000-0000-0000-000000000000', null, current_date + 1, '[{"lancamento_id":"aa000109-0000-0000-0000-000000000001","forma":"ted","valor":1000}]') ->> 'nsa')::int) = 2, 'depois de cancelar, gera de novo com NSA 2');
select pg_temp.falha($$select pag_remessa_criar('c000000a-0000-0000-0000-000000000000', null, current_date - 1, '[{"forma":"ted","valor":1}]')$$, 'data no passado');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($$select pag_remessa_criar('c000000a-0000-0000-0000-000000000000', null, current_date + 1, '[{"forma":"ted","valor":1}]')$$, 'leitura não gera remessa');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from pag_remessas) = 0, 'outra empresa não vê');
select pg_temp.ok((select count(*) from pag_alcadas) = 0, 'outra empresa não vê as alçadas');

reset role;
delete from pag_remessas; delete from lancamentos where id::text like 'aa000109%';
update contas set banco_codigo = null, cnab_nsa = 0 where id = 'c000000a-0000-0000-0000-000000000000';
delete from autorizacoes where numero in (901, 902); delete from pag_alcadas; delete from notificacoes where tipo = 'pag_alcada';
delete from membros where user_id = 'd1000000-0000-0000-0000-0000000000d1'; delete from auth.users where id = 'd1000000-0000-0000-0000-0000000000d1';
\o
select 'ok 45 alçadas e remessa CNAB';
