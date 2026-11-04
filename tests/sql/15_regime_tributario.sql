-- Regime tributário (SQL 078): admin grava e lê; financeiro só lê; outra empresa não vê; regime_em pela vigência;
-- criação de empresa bloqueada para quem não é admin da plataforma; criar_empresa_completa no Simples troca as contas de tributos.
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

-- admin da A grava duas vigências
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into empresa_tributacao(empresa_id, vigencia_inicio, regime, simples_atividades, fonte) values
  ('e000000a-0000-0000-0000-000000000000', '2026-01-01', 'simples', '[{"cnae":"4930-2/02","anexo":"III","fator_r":false}]', 'teste'),
  ('e000000a-0000-0000-0000-000000000000', '2027-01-01', 'simples', '[]', 'teste');
update empresa_tributacao set ibscbs_regular = true where vigencia_inicio = '2027-01-01';
select pg_temp.ok((select ibscbs_regular from regime_em('e000000a-0000-0000-0000-000000000000', '2027-03-10')), 'regime_em 2027 = linha de 2027');
select pg_temp.ok(not (select ibscbs_regular from regime_em('e000000a-0000-0000-0000-000000000000', '2026-12-31')), 'regime_em 2026 = linha de 2026');
select pg_temp.ok((select regime_em('e000000a-0000-0000-0000-000000000000', '2025-12-31')) is null, 'antes da primeira vigência: nada');
do $$ begin
  begin insert into empresa_tributacao(empresa_id, vigencia_inicio, regime, pis_cofins) values ('e000000a-0000-0000-0000-000000000000', '2028-01-01', 'simples', 'cumulativo');
    raise exception 'FALHOU: Simples com PIS/COFINS aceito';
  exception when check_violation then null; end;
end $$;
-- não é admin da plataforma: não cria empresa
do $$ begin
  begin perform criar_empresa_completa('Empresa C', null, 2026, '{"regime":"simples"}'); raise exception 'FALHOU: criou empresa sem permissão';
  exception when raise_exception then if sqlerrm not like '%bloqueada%' then raise; end if; end;
end $$;
reset role;

-- financeiro lê e não grava
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select count(*) from empresa_tributacao) = 2, 'financeiro lê');
do $$ begin
  begin insert into empresa_tributacao(empresa_id, vigencia_inicio, regime) values ('e000000a-0000-0000-0000-000000000000', '2028-01-01', 'real'); raise exception 'FALHOU: financeiro gravou';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- outra empresa não vê
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from empresa_tributacao) = 0, 'B não vê o regime da A');
select pg_temp.ok((select regime_em('e000000a-0000-0000-0000-000000000000')) is null, 'B não lê pelo regime_em');
reset role;

-- admin da plataforma cria empresa do Simples
insert into plataforma_admins(user_id) values ('b0000000-0000-0000-0000-00000000000b');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok(pode_criar_empresa(), 'admin da plataforma pode criar');
select set_config('teste.nova', criar_empresa_completa('Transportes Teste', '00.000.000/0001-91', 2026,
  '{"regime":"simples","vigencia_inicio":"2026-11-01","simples_atividades":[{"cnae":"4930-2/02","anexo":"III"}],"uf":"pe"}')::text, false);
reset role;
select pg_temp.ok((select regime from empresa_tributacao where empresa_id = current_setting('teste.nova')::uuid) = 'simples', 'regime gravado');
select pg_temp.ok((select uf from empresa_tributacao where empresa_id = current_setting('teste.nova')::uuid) = 'PE', 'UF em maiúsculas');
select pg_temp.ok((select papel from membros where empresa_id = current_setting('teste.nova')::uuid and user_id = 'b0000000-0000-0000-0000-00000000000b') = 'admin', 'criador é admin');
select pg_temp.ok(exists (select 1 from plano_contas where empresa_id = current_setting('teste.nova')::uuid and nome = 'SIMPLES NACIONAL / DAS'), 'conta do DAS');
select pg_temp.ok(not exists (select 1 from plano_contas where empresa_id = current_setting('teste.nova')::uuid and nome in ('PIS E COFINS', 'IRPJ E CSLL')), 'sem PIS/COFINS e IRPJ/CSLL no Simples');
-- Lucro Real pela mesma função mantém o plano modelo
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select set_config('teste.real', criar_empresa_completa('Indústria Teste', null, 2026, '{"regime":"real"}')::text, false);
reset role;
select pg_temp.ok((select pis_cofins from empresa_tributacao where empresa_id = current_setting('teste.real')::uuid) = 'nao_cumulativo', 'Real: não cumulativo por padrão');
select pg_temp.ok(exists (select 1 from plano_contas where empresa_id = current_setting('teste.real')::uuid and nome = 'IRPJ E CSLL'), 'Real mantém IRPJ/CSLL');
delete from plataforma_admins;
\o
select 'ok 15_regime_tributario' as resultado;
