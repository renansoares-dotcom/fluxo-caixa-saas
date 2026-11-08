-- Minha Manhã (SQL 102): acesso anterior, o que mudou por outras pessoas e pelas áreas, resumo do dia útil anterior, preferências.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1', 'email', 'teste@exemplo.com')::text, false);
  set role authenticated;
end $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_msg; end if; end $$;
\set E '''e000000a-0000-0000-0000-000000000000'''

-- acesso anterior: só muda numa sessão nova (mais de 30 min)
insert into membros_acessos(empresa_id, user_id, ultimo_acesso) values (:E, 'd0000000-0000-0000-0000-00000000000d', now() - interval '2 hours')
  on conflict (empresa_id, user_id) do update set ultimo_acesso = excluded.ultimo_acesso, acesso_anterior = null;
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select lgpd_entrar(:E);
reset role;
select pg_temp.ok((select acesso_anterior between now() - interval '2 hours 1 minute' and now() - interval '119 minutes' from membros_acessos where empresa_id = :E and user_id = 'd0000000-0000-0000-0000-00000000000d'), 'guardou o acesso de 2 h atrás');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select lgpd_entrar(:E);
reset role;
select pg_temp.ok((select acesso_anterior < now() - interval '1 hour' from membros_acessos where empresa_id = :E and user_id = 'd0000000-0000-0000-0000-00000000000d'), 'recarregar a página não apaga o acesso anterior');

-- o administrador lança; o financeiro vê no "o que mudou"; o compras não (área financeira)
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into lancamentos(empresa_id, data, plano_id, conta_id, valor, descricao, status) values
  (:E, current_date, 'f000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 38, 'MANHA 38', 'Em aberto');
reset role;
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
create temp table r as select manha_resumo('e000000a-0000-0000-0000-000000000000') j;
select pg_temp.ok((select (x ->> 'incluiu')::int >= 1 from r, jsonb_array_elements(j #> '{mudou,por_tabela}') x where x ->> 'tabela' = 'lancamentos'), 'financeiro vê o lançamento incluído pelo administrador');
select pg_temp.ok((select j #> '{mudou,recentes}' = 'null'::jsonb from r), 'financeiro não vê quem fez (só administrador e diretor)');
select pg_temp.ok((select j #> '{dia,fin}' is not null and (j ->> 'ontem')::date < current_date and extract(isodow from (j ->> 'ontem')::date) <= 5 from r), 'resumo do dia útil anterior');
reset role;
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
select pg_temp.ok((select not exists (select 1 from jsonb_array_elements(j #> '{mudou,por_tabela}') x where x ->> 'area' = 'fin') and j #> '{dia,fin}' is null
  from (select manha_resumo('e000000a-0000-0000-0000-000000000000') j) z), 'compras não vê o financeiro');
-- quem fez não aparece para si mesmo
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select j #> '{mudou,recentes}' is not null from (select manha_resumo('e000000a-0000-0000-0000-000000000000') j) z), 'administrador vê os recentes');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(manha_resumo(:E) #> '{mudou,recentes}') x where x ->> 'rotulo' = 'MANHA 38'), 'o próprio lançamento não aparece');

-- preferências: cada um só as suas
insert into manha_preferencias(empresa_id, blocos, atalhos) values (:E, '[{"k":"mudou","on":true}]', '{lancamentos}');
reset role;
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select count(*) from manha_preferencias) = 0, 'não vê a preferência de outro');
reset role;
select pg_temp.ok(_manha_area('prod_ordens') = 'prd' and _manha_area('compras_pedidos') = 'cmp' and _manha_area('lancamentos') = 'fin' and _manha_area('favorecidos') = 'cad' and _manha_area('pre_projetos') = 'com', 'áreas das tabelas');

delete from lancamentos where descricao = 'MANHA 38'; delete from manha_preferencias; delete from membros_acessos;
