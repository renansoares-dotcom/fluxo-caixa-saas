-- Retenções do autônomo no frete (SQL 159): parâmetro inicial de 2026 em toda empresa, só o admin grava, leitura vê, outra empresa
-- não vê, nova vigência convive com a anterior, colunas novas do transportador, do frete e dos parâmetros do e-frete.
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
grant execute on all functions in schema pg_temp to authenticated, anon;
\set E '''e000000a-0000-0000-0000-000000000000'''

select pg_temp.ok((select count(*) from empresas e where not exists (select 1 from log_retencao_param p where p.empresa_id = e.id)) = 0, 'toda empresa tem o parâmetro inicial');
select pg_temp.ok((select inss_pct = 11 and inss_base_pct = 20 and inss_teto = 8475.55 and sest_senat_pct = 2.5 and irrf_base_pct = 10 and not conferido
  from log_retencao_param where empresa_id = :E and vigencia = '2026-01-01'), 'valores iniciais de 2026, ainda não conferidos');
select pg_temp.ok((select jsonb_array_length(irrf_faixas) = 5 and (irrf_faixas -> 4 ->> 'ate') is null and (irrf_reducao ->> 'isento_ate')::numeric = 5000
  from log_retencao_param where empresa_id = :E and vigencia = '2026-01-01'), 'tabela do IRRF com 5 faixas e redução de 2026');

-- empresa nova nasce com o parâmetro
begin;
insert into empresas(id, nome) values ('e0000159-0000-0000-0000-000000000000', 'EMPRESA NOVA 159');
select pg_temp.ok((select count(*) from log_retencao_param where empresa_id = 'e0000159-0000-0000-0000-000000000000') = 1, 'empresa nova recebe o parâmetro');
rollback;

-- admin grava: confere, cria nova vigência; valores inválidos são recusados
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
update log_retencao_param set conferido = true, observacao = 'conferido' where empresa_id = :E and vigencia = '2026-01-01';
insert into log_retencao_param(empresa_id, vigencia, inss_teto, irrf_faixas) values (:E, '2027-01-01', 9000, '[{"ate":null,"aliq":0,"deduzir":0}]');
select pg_temp.falha($q$update log_retencao_param set inss_pct = 150 where empresa_id = 'e000000a-0000-0000-0000-000000000000'$q$, 'INSS acima de 100%');
select pg_temp.falha($q$update log_retencao_param set irrf_faixas = '[]' where empresa_id = 'e000000a-0000-0000-0000-000000000000'$q$, 'tabela do IRRF vazia');
select pg_temp.falha($q$insert into log_retencao_param(empresa_id, vigencia, inss_teto, irrf_faixas) values ('e000000a-0000-0000-0000-000000000000', '2028-01-01', 0, '[{"ate":null,"aliq":0,"deduzir":0}]')$q$, 'teto zero');
reset role;
select pg_temp.ok((select count(*) from log_retencao_param where empresa_id = :E) = 2 and (select conferido from log_retencao_param where empresa_id = :E and vigencia = '2026-01-01'), 'duas vigências; a de 2026 conferida');

-- leitura vê e não grava; financeiro não grava
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from log_retencao_param where empresa_id = :E) = 2, 'leitura vê');
update log_retencao_param set inss_pct = 1 where empresa_id = :E;
select pg_temp.falha($q$insert into log_retencao_param(empresa_id, vigencia, inss_teto, irrf_faixas) values ('e000000a-0000-0000-0000-000000000000', '2029-01-01', 1, '[{"ate":null,"aliq":0,"deduzir":0}]')$q$, 'leitura não cria vigência');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
update log_retencao_param set inss_pct = 1 where empresa_id = :E;
delete from log_retencao_param where empresa_id = :E;
reset role;
select pg_temp.ok((select count(*) = 2 and min(inss_pct) = 11 from log_retencao_param where empresa_id = :E), 'leitura e financeiro não alteram nem apagam');

-- outra empresa não vê
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from log_retencao_param where empresa_id = :E) = 0, 'outra empresa não vê');
reset role;

-- colunas novas
select pg_temp.ok((select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'log_transportadores' and column_name = 'dependentes')
  or (table_name = 'log_fretes' and column_name = 'retencoes') or (table_name = 'efrete_config' and column_name = 'retencao_pagamento'))) = 3, 'colunas novas');
select pg_temp.falha($q$insert into efrete_config(empresa_id, retencao_pagamento) values ('e000000a-0000-0000-0000-000000000000', 'outro')$q$, 'forma de retenção inválida');

delete from log_retencao_param where empresa_id = :E and vigencia = '2027-01-01';
update log_retencao_param set conferido = false, observacao = null where empresa_id = :E and vigencia = '2026-01-01';
