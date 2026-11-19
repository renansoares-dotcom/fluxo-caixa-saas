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
-- Reforma Tributária — tabelas oficiais de classificação do IBS/CBS (SQL 171): carga íntegra, leitura para todos, gravação para ninguém
select pg_temp.ok((select versao_base ~ '^V[0-9]{4}$' and (linhas ->> 'classtrib')::int = (select count(*) from rtc_classtrib) and (linhas ->> 'ncm')::int = (select count(*) from rtc_classtrib_ncm)
  and (linhas ->> 'excecoes')::int = (select count(*) from rtc_classtrib_ncm_exc) and (linhas ->> 'cst')::int = (select count(*) from rtc_cst) from rtc_base where id = 1), 'a carga bate com o resumo gravado');
select pg_temp.ok((select count(*) >= 150 from rtc_classtrib) and (select count(*) >= 15 from rtc_cst) and (select count(*) >= 900 from rtc_classtrib_ncm), 'tabelas carregadas');
select pg_temp.ok((select count(*) = 0 from rtc_classtrib where left(codigo, 3) <> cst or codigo !~ '^[0-9]{6}$'), 'todo cClassTrib tem 6 dígitos e começa pelo CST dele');
select pg_temp.ok((select count(*) = 0 from rtc_classtrib_ncm where ncm !~ '^[0-9]{2,8}$') and (select count(*) = 0 from rtc_classtrib_ncm_exc where ncm !~ '^[0-9]{2,8}$'), 'NCM dos anexos só com dígitos');
select pg_temp.ok((select count(*) = 0 from rtc_classtrib where red_cbs < 0 or red_cbs > 100 or red_ibs_uf < 0 or red_ibs_uf > 100), 'redução entre 0 e 100%');
select pg_temp.ok((select cst = '000' and red_cbs = 0 and 55 = any(modelos) and fim is null and credito_adquirente_cbs from rtc_classtrib where codigo = '000001'), '000001: tributação integral, aceita em NF-e, com crédito');
select pg_temp.ok((select red_cbs = 100 and red_ibs_uf = 100 and anexo = '1' from rtc_classtrib where codigo = '200003'), '200003: cesta básica com redução de 100% (Anexo I)');
select pg_temp.ok(exists (select 1 from rtc_classtrib_ncm where codigo = '200003' and '10063021' like ncm || '%'), 'arroz (1006.30.21) consta do anexo do 200003');
select pg_temp.ok(not exists (select 1 from rtc_classtrib_ncm where codigo = '200003' and '39012029' like ncm || '%'), 'polietileno não consta do anexo da cesta básica');
select pg_temp.ok((select count(*) = 5 from pg_class c where c.relname like 'rtc\_%' and c.relkind = 'r' and c.relrowsecurity and c.relnamespace = 'public'::regnamespace), 'RLS ligada nas 5 tabelas');
select pg_temp.ok(not has_table_privilege('anon', 'public.rtc_classtrib', 'select'), 'visitante não lê');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) > 0 from rtc_classtrib) and (select count(*) > 0 from rtc_classtrib_ncm) and (select count(*) = 1 from rtc_base), 'qualquer usuário logado lê');
select pg_temp.falha($$insert into public.rtc_cst (cst, descricao, inicio) values ('999', 'x', '2026-01-01')$$, 'usuário não inclui CST');
reset role;
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.falha($$update public.rtc_classtrib set red_cbs = 0 where codigo = '200003'$$, 'administrador não altera a tabela oficial');
select pg_temp.falha($$delete from public.rtc_classtrib_ncm$$, 'administrador não apaga os vínculos');
reset role;
select pg_temp.ok((select red_cbs = 100 from rtc_classtrib where codigo = '200003'), 'tabela intacta');
