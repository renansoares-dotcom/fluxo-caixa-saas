\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1', 'email', 'u@t.com')::text, false);
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
-- RAD: recolhimento da CBS pelo adquirente (SQL 168) — parâmetros, regra por fornecedor, marcação e títulos
insert into favorecidos(id, empresa_id, nome) values ('a1000000-0000-0000-0000-0000000000f1', :E, 'Fornecedor RAD 1'), ('a1000000-0000-0000-0000-0000000000f2', :E, 'Fornecedor RAD 2');
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, favorecido_id, v_nf, v_cbs) values
  ('a1000000-0000-0000-0000-000000000a01', :E, '26261100000000000000000000000000000000081001', 81001, '2026-11-03', 'saida', false, 'autorizada', 'a1000000-0000-0000-0000-0000000000f1', 10000, 90),
  ('a1000000-0000-0000-0000-000000000a02', :E, '26261100000000000000000000000000000000081002', 81002, '2026-11-04', 'saida', false, 'autorizada', 'a1000000-0000-0000-0000-0000000000f2', 5000, 45),
  ('a1000000-0000-0000-0000-000000000a03', :E, '26261100000000000000000000000000000000081003', 81003, '2026-11-05', 'saida', false, 'autorizada', 'a1000000-0000-0000-0000-0000000000f1', 800, 0),
  ('a1000000-0000-0000-0000-000000000a04', :E, '26261100000000000000000000000000000000081004', 81004, '2026-11-05', 'saida', true, 'autorizada', null, 700, 6.3),
  ('a1000000-0000-0000-0000-000000000a05', :E, '26261100000000000000000000000000000000081005', 81005, '2026-11-06', 'saida', false, 'cancelada', 'a1000000-0000-0000-0000-0000000000f1', 600, 5.4);
-- a nota 81001 tem dois títulos em aberto (6.000 em 20/11 e 4.000 em 10/12) e um já pago
insert into lancamentos(id, empresa_id, data, plano_id, valor, status, documento, favorecido_id) values
  ('a1000000-0000-0000-0000-000000000b01', :E, '2026-12-10', 'f000000a-0000-0000-0000-000000000000', 4000, 'Em aberto', '81001/2', 'a1000000-0000-0000-0000-0000000000f1'),
  ('a1000000-0000-0000-0000-000000000b02', :E, '2026-11-20', 'f000000a-0000-0000-0000-000000000000', 6000, 'Em aberto', '81001/1', 'a1000000-0000-0000-0000-0000000000f1');
insert into nfe_vinculos(empresa_id, nota_id, lancamento_id, tipo) values (:E, 'a1000000-0000-0000-0000-000000000a01', 'a1000000-0000-0000-0000-000000000b01', 'manual'), (:E, 'a1000000-0000-0000-0000-000000000a01', 'a1000000-0000-0000-0000-000000000b02', 'manual');

select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');   -- financeiro
select pg_temp.falha($$select public.rad_marcar('a1000000-0000-0000-0000-000000000a01')$$, 'desligado nos parâmetros');
insert into rad_config(empresa_id, ativo) values (:E, true);
select pg_temp.ok((select regra_padrao = 'perguntar' from rad_config where empresa_id = :E), 'regra padrão: perguntar');
select pg_temp.falha($$select public.rad_marcar('a1000000-0000-0000-0000-000000000a03')$$, 'nota sem CBS');
select pg_temp.falha($$select public.rad_marcar('a1000000-0000-0000-0000-000000000a04')$$, 'nota emitida pela empresa');
select pg_temp.falha($$select public.rad_marcar('a1000000-0000-0000-0000-000000000a05')$$, 'nota cancelada');
-- regra "nunca" do fornecedor barra a marcação
insert into rad_fornecedores(empresa_id, favorecido_id, regra) values (:E, 'a1000000-0000-0000-0000-0000000000f2', 'nunca');
select pg_temp.falha($$select public.rad_marcar('a1000000-0000-0000-0000-000000000a02')$$, 'fornecedor com a regra nunca');
select pg_temp.falha($$insert into rad_fornecedores(empresa_id, favorecido_id, regra) values ('e000000a-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-0000000000f2', 'sempre')$$, 'uma regra por fornecedor');
-- marca a 81001: guarda a CBS da nota e quem marcou; não marca duas vezes
create temp table m1 as select public.rad_marcar('a1000000-0000-0000-0000-000000000a01', '  combinado com o fornecedor ') id;
grant select on m1 to authenticated;
select pg_temp.ok((select valor_cbs = 90 and situacao = 'marcado' and observacao = 'combinado com o fornecedor' and marcado_por = 'd0000000-0000-0000-0000-00000000000d' and chave like '%81001' from rad_recolhimentos where id = (select id from m1)), 'marcação gravada');
select pg_temp.falha($$select public.rad_marcar('a1000000-0000-0000-0000-000000000a01')$$, 'marcar duas vezes');
select pg_temp.falha($$insert into rad_recolhimentos(empresa_id, nota_id, valor_cbs) values ('e000000a-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000a02', 45)$$, 'inclusão direta');
-- a CBS sai do título de vencimento mais próximo: 6.000 − 90 = 5.910
select pg_temp.ok((select count(*) = 1 and bool_and(lancamento_id = 'a1000000-0000-0000-0000-000000000b02' and valor_cbs = 90 and valor_titulo = 6000 and liquido_sugerido = 5910 and nota_numero = 81001) from public.rad_titulos(:E)), 'título e líquido sugerido');
select pg_temp.ok((select valor = 6000 and status = 'Em aberto' from lancamentos where id = 'a1000000-0000-0000-0000-000000000b02'), 'o título não muda');
-- pago o primeiro, a sugestão passa para o próximo título em aberto
reset role; update lancamentos set status = 'Pago' where id = 'a1000000-0000-0000-0000-000000000b02'; select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select lancamento_id = 'a1000000-0000-0000-0000-000000000b01' and liquido_sugerido = 3910 from public.rad_titulos(:E)), 'passa para o próximo título em aberto');
-- desmarcar libera a nota para marcar de novo
select public.rad_desmarcar((select id from m1), 'fornecedor vai recolher');
select pg_temp.ok((select situacao = 'cancelado' and cancelamento_motivo = 'fornecedor vai recolher' from rad_recolhimentos where id = (select id from m1)) and (select count(*) = 0 from public.rad_titulos(:E)), 'desmarcada');
select pg_temp.falha($$select public.rad_desmarcar((select id from m1))$$, 'desmarcar duas vezes');
select pg_temp.ok(public.rad_marcar('a1000000-0000-0000-0000-000000000a01') is not null, 'marca de novo depois de desmarcar');
-- quem só lê vê, mas não configura nem marca
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) = 2 from rad_recolhimentos where empresa_id = :E), 'leitura vê as marcações');
update rad_config set ativo = false where empresa_id = :E;
select pg_temp.falha($$insert into rad_fornecedores(empresa_id, favorecido_id, regra) values ('e000000a-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-0000000000f1', 'sempre')$$, 'leitura não cria regra');
select pg_temp.falha($$select public.rad_marcar('a1000000-0000-0000-0000-000000000a02')$$, 'leitura não marca');
reset role;
select pg_temp.ok((select ativo from rad_config where empresa_id = 'e000000a-0000-0000-0000-000000000000'), 'leitura não desligou o parâmetro');
-- outra empresa não enxerga
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) = 0 from rad_recolhimentos) and (select count(*) = 0 from public.rad_titulos('e000000a-0000-0000-0000-000000000000')), 'isolamento entre empresas');
reset role;
