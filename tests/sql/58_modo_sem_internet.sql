-- Modo sem internet (SQL 122): sync_rpc executa uma vez só por chave, só funções da lista, com as permissões do usuário.
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
insert into produtos(id, empresa_id, codigo, descricao, unidade) values ('58000000-0000-0000-0000-0000000000f1', 'e000000a-0000-0000-0000-000000000000', 'TN-OFF', 'BASE OFFLINE', 'KG');
insert into tin_cores(id, empresa_id, codigo, nome) values ('58000000-0000-0000-0000-0000000000a1', 'e000000a-0000-0000-0000-000000000000', 'OFF-1', 'COR OFFLINE');
insert into tin_receitas(id, empresa_id, cor_id, codigo, nome) values ('58000000-0000-0000-0000-0000000000b1', 'e000000a-0000-0000-0000-000000000000', '58000000-0000-0000-0000-0000000000a1', 'R-OFF', 'Offline');
alter table tin_versoes disable trigger user; alter table tin_itens disable trigger user; alter table tin_ordens disable trigger user;
insert into tin_versoes(id, empresa_id, receita_id, numero, situacao, base_kg) values ('58000000-0000-0000-0000-0000000000b2', 'e000000a-0000-0000-0000-000000000000', '58000000-0000-0000-0000-0000000000b1', 1, 'aprovada', 100);
insert into tin_itens(id, empresa_id, versao_id, produto_id, quantidade, funcao) values ('58000000-0000-0000-0000-0000000000b3', 'e000000a-0000-0000-0000-000000000000', '58000000-0000-0000-0000-0000000000b2', '58000000-0000-0000-0000-0000000000f1', 100, 'base');
insert into tin_ordens(id, empresa_id, numero, versao_id, cor_id, quantidade, situacao) values ('58000000-0000-0000-0000-0000000000c1', 'e000000a-0000-0000-0000-000000000000', 99581, '58000000-0000-0000-0000-0000000000b2', '58000000-0000-0000-0000-0000000000a1', 10, 'aberta');
alter table tin_versoes enable trigger user; alter table tin_itens enable trigger user; alter table tin_ordens enable trigger user;
update produtos set controla_lote = false, local_padrao_id = (select id from est_locais where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'MP') where id = '58000000-0000-0000-0000-0000000000f1';
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario)
  select 'e000000a-0000-0000-0000-000000000000', current_date - 1, '58000000-0000-0000-0000-0000000000f1', l.id, t.id, 100, 20
  from est_locais l, est_tipos_movimento t where l.empresa_id = 'e000000a-0000-0000-0000-000000000000' and l.codigo = 'INS' and t.empresa_id = l.empresa_id and t.codigo = 'COMPRA';
create temp table a as select '{"p_ordem":"58000000-0000-0000-0000-0000000000c1","p_item":"58000000-0000-0000-0000-0000000000b3","p_produto":null,"p_qtd":4.5,"p_lote":null,"p_justificativa":null,"p_balanca":true}'::jsonb j;
-- a mesma chave duas vezes (a resposta se perdeu e o aparelho mandou de novo): uma pesagem só
select public.sync_rpc('58000000-0000-0000-0000-00000000aaa1', 'tin_pesar', (select j from a));
select public.sync_rpc('58000000-0000-0000-0000-00000000aaa1', 'tin_pesar', (select j from a));
select pg_temp.ok((select count(*) = 1 and sum(pesada) = 4.5 and bool_and(balanca) from tin_pesagens where ordem_id = '58000000-0000-0000-0000-0000000000c1'), 'uma pesagem de 4,5 kg pela balança');
-- outra chave: outra pesagem
select public.sync_rpc('58000000-0000-0000-0000-00000000aaa2', 'tin_pesar', jsonb_set((select j from a), '{p_qtd}', '1'));
select pg_temp.ok((select sum(pesada) = 5.5 from tin_pesagens where ordem_id = '58000000-0000-0000-0000-0000000000c1'), 'segunda chave soma');
select pg_temp.falha($$select public.sync_rpc(gen_random_uuid(), 'tin_aprovar_ordem', '{"p_ordem":"58000000-0000-0000-0000-0000000000c1"}')$$, 'fora da lista');
select pg_temp.falha($$select public.sync_rpc(gen_random_uuid(), 'tin_pesar', '[]')$$, 'argumentos inválidos');
select pg_temp.falha($$select public.sync_rpc(null, 'tin_pesar', '{}')$$, 'sem chave');
-- erro da função: nada fica guardado e a chave pode ser usada de novo
select pg_temp.falha($$select public.sync_rpc('58000000-0000-0000-0000-00000000aaa3', 'tin_pesar', jsonb_set((select j from a), '{p_qtd}', '0'))$$, 'peso inválido');
select pg_temp.ok((select count(*) = 0 from sync_chaves where chave = '58000000-0000-0000-0000-00000000aaa3'), 'erro não grava a chave');
-- inclusão repetida pelo aparelho (como o PostgREST faz no upsert com ignoreDuplicates): não duplica
insert into prod_setores(id, empresa_id, nome) values ('58000000-0000-0000-0000-0000000000d1', 'e000000a-0000-0000-0000-000000000000', 'Setor Offline') on conflict (id) do nothing;
insert into prod_setores(id, empresa_id, nome) values ('58000000-0000-0000-0000-0000000000d1', 'e000000a-0000-0000-0000-000000000000', 'Setor Offline') on conflict (id) do nothing;
select pg_temp.ok((select count(*) = 1 from prod_setores where id = '58000000-0000-0000-0000-0000000000d1'), 'upsert sem duplicar');
-- leitura: a função vale com as permissões do usuário
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($$select public.sync_rpc(gen_random_uuid(), 'tin_pesar', (select j from a))$$, 'leitura não pesa');
select pg_temp.ok((select count(*) = 0 from sync_chaves), 'não vê as chaves dos outros');
reset role;
\o
select 'ok 58 modo sem internet';
