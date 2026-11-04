-- Piso ANTT (SQL 080): referência nacional com 272 coeficientes da Portaria SUROC 22/2026; empresa nova nasce com a tabela;
-- usuário lê a referência mas não grava; valores de conferência batem com a portaria.
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

select pg_temp.ok((select count(*) from antt_piso_coef where vigencia = '2026-09-30') = 272, 'referência com 272 coeficientes');
select pg_temp.ok((select count(*) from log_piso_coef where empresa_id = 'e000000a-0000-0000-0000-000000000000' and vigencia = '2026-09-30') = 272, 'empresa criada depois recebeu a tabela');
-- conferência com a portaria (Tabela A geral 5 eixos; Tabela C geral 2 eixos; Tabela A frigorificada 9 eixos)
select pg_temp.ok((select (ccd, cc) = (6.8284, 657.56) from antt_piso_coef where tabela = 'A' and tipo_carga = 'geral' and eixos = 5), 'A geral 5 eixos');
select pg_temp.ok((select (ccd, cc) = (3.4762, 172.50) from antt_piso_coef where tabela = 'C' and tipo_carga = 'geral' and eixos = 2), 'C geral 2 eixos');
select pg_temp.ok((select (ccd, cc) = (11.1479, 1067.06) from antt_piso_coef where tabela = 'A' and tipo_carga = 'frigorificada' and eixos = 9), 'A frigorificada 9 eixos');
select pg_temp.ok(not exists (select 1 from antt_piso_coef where tabela in ('B', 'D') and eixos < 4), 'B e D não têm 2 e 3 eixos');

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select count(*) from antt_piso_coef) >= 272, 'usuário lê a referência');
do $$ begin
  begin update antt_piso_coef set ccd = 1 where tabela = 'A'; raise exception 'FALHOU: usuário alterou a referência';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
