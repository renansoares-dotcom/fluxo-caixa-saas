-- Inventário cíclico (SQL 120): gerar pela ABC, contar, recontar, enviar, aprovar com ajuste e recusar.
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
insert into est_config(empresa_id, implantado_em) values ('e000000a-0000-0000-0000-000000000000', current_date - 60)
  on conflict (empresa_id) do update set implantado_em = coalesce(est_config.implantado_em, excluded.implantado_em);
insert into produtos(id, empresa_id, codigo, descricao, unidade) values
  ('56000000-0000-0000-0000-0000000000f1', 'e000000a-0000-0000-0000-000000000000', 'INV-A', 'MATERIAL CARO INV', 'KG'),
  ('56000000-0000-0000-0000-0000000000f2', 'e000000a-0000-0000-0000-000000000000', 'INV-C', 'MATERIAL BARATO INV', 'UN');
update produtos set controla_lote = false where codigo in ('INV-A', 'INV-C') and empresa_id = 'e000000a-0000-0000-0000-000000000000';
create temp table loc as select (select id from est_locais where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'MP') uc,
  (select id from est_tipos_movimento where empresa_id = 'e000000a-0000-0000-0000-000000000000' and codigo = 'COMPRA') compra;
grant select on loc to authenticated;
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario)
  select 'e000000a-0000-0000-0000-000000000000', current_date - 5, '56000000-0000-0000-0000-0000000000f1', uc, compra, 100, 50 from loc;
insert into est_movimentos(empresa_id, data, produto_id, local_id, tipo_movimento_id, quantidade, custo_unitario)
  select 'e000000a-0000-0000-0000-000000000000', current_date - 5, '56000000-0000-0000-0000-0000000000f2', uc, compra, 10, 1 from loc;
-- gera a contagem só com os dois itens do teste
create temp table cg as select public.est_inv_gerar('e000000a-0000-0000-0000-000000000000', (select uc from loc), null, array['56000000-0000-0000-0000-0000000000f1', '56000000-0000-0000-0000-0000000000f2']::uuid[]) id;
grant select on cg to authenticated;
select pg_temp.ok((select count(*) from est_inv_itens where contagem_id = (select id from cg)) = 2, 'dois itens');
select pg_temp.falha($$select public.est_inv_gerar('e000000a-0000-0000-0000-000000000000', (select uc from loc))$$, 'uma contagem aberta por local');
select pg_temp.falha($$select public.est_inv_enviar((select id from cg))$$, 'não envia com itens pendentes');
-- material caro: 95 contados (5% e R$ 250 de falta) → recontar; recontagem 96 → divergente
select pg_temp.ok(public.est_inv_contar((select id from est_inv_itens where contagem_id = (select id from cg) and produto_id = '56000000-0000-0000-0000-0000000000f1'), 95) = 'recontar', 'pede recontagem');
select pg_temp.ok(public.est_inv_contar((select id from est_inv_itens where contagem_id = (select id from cg) and produto_id = '56000000-0000-0000-0000-0000000000f1'), 96, 'avaria no manuseio') = 'divergente', 'divergente');
-- material barato: 10 contados → ok
select pg_temp.ok(public.est_inv_contar((select id from est_inv_itens where contagem_id = (select id from cg) and produto_id = '56000000-0000-0000-0000-0000000000f2'), 10) = 'ok', 'ok');
select public.est_inv_enviar((select id from cg));
select pg_temp.ok((select situacao = 'em_aprovacao' from est_inv_contagens where id = (select id from cg)), 'em aprovação');
-- recusa volta para recontar; reconta e envia de novo; aprova e ajusta −4
select pg_temp.falha($$select public.est_inv_aprovar((select id from cg), false, 'x')$$, 'motivo obrigatório');
select public.est_inv_aprovar((select id from cg), false, 'conferir a prateleira de cima');
select pg_temp.ok((select situacao = 'recontar' from est_inv_itens where contagem_id = (select id from cg) and produto_id = '56000000-0000-0000-0000-0000000000f1'), 'volta para recontar');
select public.est_inv_contar((select id from est_inv_itens where contagem_id = (select id from cg) and produto_id = '56000000-0000-0000-0000-0000000000f1'), 96);
select public.est_inv_enviar((select id from cg));
select pg_temp.ok(public.est_inv_aprovar((select id from cg), true) = 1, 'um ajuste');
select pg_temp.ok((select sum(quantidade) from est_saldos where produto_id = '56000000-0000-0000-0000-0000000000f1') = 96, 'saldo ajustado para 96');
select pg_temp.ok((select situacao = 'ajustado' and movimento_id is not null from est_inv_itens where contagem_id = (select id from cg) and produto_id = '56000000-0000-0000-0000-0000000000f1'), 'item ajustado');
-- nova contagem só com o material barato, sem divergência → aprovada na hora, sem ajuste
create temp table cg2 as select public.est_inv_gerar('e000000a-0000-0000-0000-000000000000', (select uc from loc), null, array['56000000-0000-0000-0000-0000000000f2']::uuid[]) id;
select public.est_inv_contar((select id from est_inv_itens where contagem_id = (select id from cg2)), 10);
select public.est_inv_enviar((select id from cg2));
select pg_temp.ok((select situacao = 'aprovada' and decidida_por like 'automático%' from est_inv_contagens where id = (select id from cg2)), 'sem divergência: aprovada sozinha');
select pg_temp.ok((select classe from est_inv_abc('e000000a-0000-0000-0000-000000000000') where produto_id = '56000000-0000-0000-0000-0000000000f2') is not null, 'curva ABC');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($$select public.est_inv_gerar('e000000a-0000-0000-0000-000000000000', (select uc from loc))$$, 'leitura não gera');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from est_inv_contagens) = 0, 'outra empresa não vê');
reset role;
\o
select 'ok 56 inventário cíclico';
