-- Uso da plataforma (SQL 099): gravação pelo próprio usuário, relatório só do administrador, liga/desliga e guarda.
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

-- financeiro navega: 3 telas (uma curta), 1 formulário abandonado, 1 concluído, 1 erro
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
insert into uso_eventos(empresa_id, tipo, rota, segundos) values
  ('e000000a-0000-0000-0000-000000000000', 'tela', 'lancamentos', 300),
  ('e000000a-0000-0000-0000-000000000000', 'tela', 'lancamentos', 120),
  ('e000000a-0000-0000-0000-000000000000', 'tela', 'dre', 4);
insert into uso_eventos(empresa_id, tipo, rota, titulo, segundos, concluido) values
  ('e000000a-0000-0000-0000-000000000000', 'form', 'lancamentos', 'Novo lançamento', 40, false),
  ('e000000a-0000-0000-0000-000000000000', 'form', 'lancamentos', 'Novo lançamento', 25, true),
  ('e000000a-0000-0000-0000-000000000000', 'erro', 'lancamentos', 'Informe o valor', 0, null);
select pg_temp.ok((select count(*) from uso_eventos) = 0, 'usuário comum não lê os eventos');
select pg_temp.falha($$select uso_resumo('e000000a-0000-0000-0000-000000000000', current_date - 1, current_date)$$, 'só o administrador vê o relatório');
select pg_temp.falha($$insert into uso_eventos(empresa_id, user_id, tipo, rota) values ('e000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-00000000000a', 'tela', 'x')$$, 'não grava em nome de outro');
select pg_temp.falha($$insert into uso_eventos(empresa_id, tipo, rota) values ('e000000b-0000-0000-0000-000000000000', 'tela', 'x')$$, 'não grava em empresa de que não participa');
-- compras também é registrado (is_participante)
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
insert into uso_eventos(empresa_id, tipo, rota, segundos) values ('e000000a-0000-0000-0000-000000000000', 'tela', 'paraquedas', 60);
reset role;
select pg_temp.ok((select papel from uso_eventos where rota = 'paraquedas' limit 1) = 'compras', 'papel preenchido pelo banco');

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
create temp table r as select uso_resumo('e000000a-0000-0000-0000-000000000000', current_date - 1, current_date) j;
select pg_temp.ok((select (j #>> '{kpis,acessos}')::int from r) = 4, 'acessos');
select pg_temp.ok((select (j #>> '{kpis,usuarios}')::int from r) = 2, 'usuários ativos');
select pg_temp.ok((select (j #>> '{kpis,abandonos}')::int from r) = 1, 'formulário abandonado');
select pg_temp.ok((select (j #>> '{kpis,erros}')::int from r) = 1, 'erro');
select pg_temp.ok((select (x ->> 'rejeicao')::numeric from r, jsonb_array_elements(j -> 'telas') x where x ->> 'rota' = 'dre') = 100, 'saiu logo da DRE (4 s < 10 s)');
select pg_temp.ok((select (x ->> 'segundos')::int from r, jsonb_array_elements(j -> 'telas') x where x ->> 'rota' = 'lancamentos') = 420, 'tempo somado');
select pg_temp.ok((select (x ->> 'abandonos')::int from r, jsonb_array_elements(j -> 'forms') x where x ->> 'titulo' = 'Novo lançamento') = 1, 'formulário por título');
select pg_temp.ok((select count(*) from r, jsonb_array_elements(j -> 'sem_acesso') x where x ->> 'email' = 'admin.a@exemplo.com') = 1, 'membro sem acesso no período');
select pg_temp.ok((select (j #>> '{kpis,acessos}')::int from (select uso_resumo('e000000a-0000-0000-0000-000000000000', current_date - 1, current_date, 'compras') j) z) = 1, 'filtro por perfil');

-- desligado: nada é gravado; limite de rejeição configurável
insert into uso_config(empresa_id, ativo, rejeicao_segundos) values ('e000000a-0000-0000-0000-000000000000', false, 3);
insert into uso_eventos(empresa_id, tipo, rota, segundos) values ('e000000a-0000-0000-0000-000000000000', 'tela', 'desligado', 9);
select pg_temp.ok((select (x ->> 'rejeicao')::numeric from (select uso_resumo('e000000a-0000-0000-0000-000000000000', current_date - 1, current_date) j) z, jsonb_array_elements(j -> 'telas') x where x ->> 'rota' = 'dre') = 0, 'rejeição com 3 s');
reset role;
select pg_temp.ok((select count(*) from uso_eventos where rota = 'desligado') = 0, 'com o registro desligado nada é gravado');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
update uso_config set ativo = true where empresa_id = 'e000000a-0000-0000-0000-000000000000';
reset role;
select pg_temp.ok((select not ativo from uso_config where empresa_id = 'e000000a-0000-0000-0000-000000000000'), 'só o administrador altera os parâmetros');

-- guarda
update uso_eventos set criado_em = now() - interval '200 days' where rota = 'dre';
select pg_temp.ok(public._uso_limpar() = 1, 'apaga o que passou do prazo');
select pg_temp.ok((select count(*) from uso_eventos where rota = 'dre') = 0, 'DRE antiga apagada');
delete from uso_config where empresa_id = 'e000000a-0000-0000-0000-000000000000';
delete from uso_eventos where empresa_id = 'e000000a-0000-0000-0000-000000000000';
