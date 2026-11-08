-- Planta ao vivo (SQL 118): aviso de parada longa (uma vez), parada planejada fora, configuração.
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
insert into prod_setores(id, empresa_id, nome) values ('5a000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'Setor PV');
insert into prod_maquinas(id, empresa_id, setor_id, codigo, nome) values
  ('5a000000-0000-0000-0000-0000000000a1', 'e000000a-0000-0000-0000-000000000000', '5a000000-0000-0000-0000-000000000001', 'MQ-PV1', 'Máquina PV 1'),
  ('5a000000-0000-0000-0000-0000000000a2', 'e000000a-0000-0000-0000-000000000000', '5a000000-0000-0000-0000-000000000001', 'MQ-PV2', 'Máquina PV 2');
insert into prod_motivos(id, empresa_id, tipo, nome, planejada) values
  ('5a000000-0000-0000-0000-0000000000b1', 'e000000a-0000-0000-0000-000000000000', 'parada', 'Falta de material PV', false),
  ('5a000000-0000-0000-0000-0000000000b2', 'e000000a-0000-0000-0000-000000000000', 'parada', 'Setup PV', true);
insert into prod_paradas(empresa_id, maquina_id, motivo_id, inicio) values
  ('e000000a-0000-0000-0000-000000000000', '5a000000-0000-0000-0000-0000000000a1', '5a000000-0000-0000-0000-0000000000b1', now() - interval '45 minutes'),
  ('e000000a-0000-0000-0000-000000000000', '5a000000-0000-0000-0000-0000000000a2', '5a000000-0000-0000-0000-0000000000b2', now() - interval '90 minutes');
select pg_temp.ok(public._planta_avisos() >= 1, 'avisa a parada longa');
select pg_temp.ok((select avisada_em is not null from prod_paradas where maquina_id = '5a000000-0000-0000-0000-0000000000a1'), 'marcada como avisada');
select pg_temp.ok((select avisada_em is null from prod_paradas where maquina_id = '5a000000-0000-0000-0000-0000000000a2'), 'planejada não avisa');
select pg_temp.ok((select count(*) from notificacoes where tipo = 'parada_longa' and ref_id = (select id from prod_paradas where maquina_id = '5a000000-0000-0000-0000-0000000000a1')) >= 1, 'aviso gravado');
select pg_temp.ok(public._planta_avisos() = 0, 'não repete');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
insert into prod_planta_config(empresa_id, parada_longa_min) values ('e000000a-0000-0000-0000-000000000000', 60);
select pg_temp.falha($$update prod_planta_config set atualizar_seg = 5$$, 'intervalo fora da faixa');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
update prod_planta_config set parada_longa_min = 5;
select pg_temp.ok((select parada_longa_min from prod_planta_config) = 60, 'leitura não altera');
reset role;
delete from notificacoes where tipo = 'parada_longa'; delete from prod_planta_config; delete from prod_paradas where maquina_id in ('5a000000-0000-0000-0000-0000000000a1', '5a000000-0000-0000-0000-0000000000a2');
delete from prod_motivos where nome like '%PV'; delete from prod_maquinas where codigo like 'MQ-PV%'; delete from prod_setores where nome = 'Setor PV';
\o
select 'ok 54 planta ao vivo';
