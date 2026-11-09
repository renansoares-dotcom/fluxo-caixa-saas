-- Central de Integrações (SQL 139): situação de cada integração, atraso em dias úteis, falhas, parâmetros, aviso diário e acesso.
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
create or replace function pg_temp.sit(p_cod text, p_hoje date default '2026-11-11') returns jsonb language sql as $$
  select x from jsonb_array_elements(public.integ_painel('e000000a-0000-0000-0000-000000000000', p_hoje)) x where x ->> 'codigo' = p_cod
$$;
\set E '''e000000a-0000-0000-0000-000000000000'''
-- dias úteis: de sexta 06/11 a quarta 11/11 = 3 (seg, ter, qua)
select pg_temp.ok(public._dias_uteis_entre('2026-11-06', '2026-11-11') = 3, 'dias úteis');
select pg_temp.ok(public._dias_uteis_entre('2026-11-11', '2026-11-11') = 0, 'mesmo dia');
-- dados: limpa a empresa A nas fontes e cria cenários
delete from extrato_importacoes where empresa_id = :E; delete from email_fila where empresa_id = :E; delete from wa_fila where empresa_id = :E;
delete from efrete_chamadas where empresa_id = :E; delete from prod_apontamentos where empresa_id = :E and origem = 'iniflex';
update contas set ativo = false where empresa_id = :E;
insert into contas(id, empresa_id, nome, ativo) values ('75000000-0000-0000-0000-0000000000c1', :E, 'BANCO 75 A', true), ('75000000-0000-0000-0000-0000000000c2', :E, 'BANCO 75 B', true), ('75000000-0000-0000-0000-0000000000c3', :E, 'CAIXA 75', true);
insert into conc_config(empresa_id, contas_sem_alerta) values (:E, array['75000000-0000-0000-0000-0000000000c3'::uuid]) on conflict (empresa_id) do update set contas_sem_alerta = excluded.contas_sem_alerta;
insert into extrato_importacoes(empresa_id, conta_id, dt_fim, created_at, formato) values
  (:E, '75000000-0000-0000-0000-0000000000c1', '2026-11-10', '2026-11-11 08:00-03', 'ofx'),     -- em dia
  (:E, '75000000-0000-0000-0000-0000000000c2', '2026-11-04', '2026-11-05 08:00-03', 'ofx'),     -- 5 dias úteis atrás: atrasada (padrão 2)
  (:E, '75000000-0000-0000-0000-0000000000c1', '2026-10-31', '2026-11-02 10:00-03', 'vexpenses');
delete from nfe_notas where empresa_id = :E and tipo = 'saida';
insert into nfe_notas(empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, importado_em) values (:E, '75S', 97501, '2026-11-06', 'saida', true, 'autorizada', '2026-11-06 18:00-03');
insert into email_fila(empresa_id, codigo, para, situacao, erro, criado_em) values (:E, 'teste', 'a@t.com', 'erro', '422: domínio não validado', '2026-11-10 10:00-03');
insert into efrete_chamadas(empresa_id, acao, ambiente, ok, http_status, resposta, criado_em) values (:E, 'declarar', 'homologacao', true, 200, '{}', '2026-11-09 10:00-03');

select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');   -- financeiro
select pg_temp.ok((select jsonb_array_length(public.integ_painel(:E, '2026-11-11')) = 10), '10 integrações');
select pg_temp.ok((select x ->> 'situacao' = 'atrasada' and (x ->> 'atrasadas')::int = 1 and x ->> 'proximo_passo' like 'Importe o extrato de 1 conta%' from (select pg_temp.sit('extratos') x) y), 'extrato atrasado de 1 conta');
select pg_temp.ok((select x ->> 'situacao' = 'ok' and (x ->> 'dias_uteis')::int = 7 from (select pg_temp.sit('vexpenses') x) y), 'vexpenses: 7 dias úteis, limite 7');
select pg_temp.ok((select x ->> 'situacao' = 'atrasada' and (x ->> 'dias_uteis')::int = 3 from (select pg_temp.sit('nfe_saida') x) y), 'NF-e de saída atrasada (3 > 1)');
select pg_temp.ok((select x ->> 'situacao' = 'sem_dados' from (select pg_temp.sit('iniflex') x) y), 'iniflex sem dados');
select pg_temp.ok((select x ->> 'situacao' = 'falha' and x ->> 'ultimo_erro' like '422%' from (select pg_temp.sit('email') x) y), 'e-mail com falha');
select pg_temp.ok((select x ->> 'situacao' = 'ok' from (select pg_temp.sit('efrete') x) y), 'e-frete ok');
select pg_temp.ok((select x ->> 'situacao' = 'sem_uso' from (select pg_temp.sit('cnab_remessa') x) y), 'remessa sem uso');
-- parâmetros só do admin
select pg_temp.falha($$insert into integ_config(empresa_id, codigo, max_dias) values ('e000000a-0000-0000-0000-000000000000', 'nfe_saida', 5)$$, 'financeiro não muda');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into integ_config(empresa_id, codigo, max_dias) values (:E, 'nfe_saida', 5);
insert into integ_config(empresa_id, codigo, ativo) values (:E, 'iniflex', false);
select pg_temp.ok((select x ->> 'situacao' = 'ok' and (x ->> 'max_dias')::int = 5 from (select pg_temp.sit('nfe_saida') x) y), 'limite de 5 dias');
select pg_temp.ok((select x ->> 'situacao' = 'desligada' from (select pg_temp.sit('iniflex') x) y), 'desligada');
-- leitura não vê
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($$select public.integ_painel('e000000a-0000-0000-0000-000000000000')$$, 'leitura');
reset role;
-- aviso: uma vez por dia útil, só com problema, só em dia útil
select pg_temp.ok((select public._integ_avisar(:E, '2026-11-11') = 2), 'avisa extratos e e-mail');
select pg_temp.ok((select public._integ_avisar(:E, '2026-11-11') = 0), 'uma vez por dia');
select pg_temp.ok((select public._integ_avisar(:E, '2026-11-14') = 0), 'sábado não');
select pg_temp.ok((select count(*) >= 1 from notificacoes where tipo = 'integracoes' and user_id = 'd0000000-0000-0000-0000-00000000000d' and titulo like 'Integrações: 2%'), 'financeiro avisado');
insert into integ_geral(empresa_id, avisar) values (:E, false);
select pg_temp.ok((select public._integ_avisar(:E, '2026-11-12') = 0), 'aviso desligado');
select public._integ_avisos();
update contas set ativo = true where empresa_id = :E and id not in ('75000000-0000-0000-0000-0000000000c1', '75000000-0000-0000-0000-0000000000c2');
\o
select 'ok 75 central de integrações';
