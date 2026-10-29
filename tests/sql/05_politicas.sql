-- Uma política por ação (SQL 063): quem edita continua editando, quem só vê continua só vendo, e uma empresa não vê a outra.
\set ON_ERROR_STOP 1
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1')::text, false);
  set role authenticated;
end $$;
grant execute on function pg_temp.entrar(uuid) to authenticated;

do $$ begin
  if exists (select 1 from (select tablename, acao from (select tablename, unnest(case when cmd = 'ALL' then array['SELECT','INSERT','UPDATE','DELETE'] else array[cmd] end) acao
      from pg_policies where schemaname = 'public' and permissive = 'PERMISSIVE' and 'authenticated' = any(roles)) x group by 1, 2 having count(*) > 1) y)
  then raise exception 'ainda há políticas sobrepostas'; end if;
end $$;

-- admin da A edita a logística da A
\o /dev/null
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
\o
do $$ begin
  insert into log_clientes(empresa_id, documento, nome) values ('e000000a-0000-0000-0000-000000000000', '11222333000181', 'CLIENTE TESTE');
  update log_clientes set nome = 'CLIENTE TESTE 2' where documento = '11222333000181';
  if not found then raise exception 'admin da A não conseguiu alterar'; end if;
  if (select count(*) from empresas) <> 1 then raise exception 'admin da A deveria ver 1 empresa'; end if;
  if (select count(*) from membros) <> 4 then raise exception 'admin da A deveria ver os 4 membros da A'; end if;
end $$;
reset role;

-- leitura da A vê, mas não edita nem apaga
\o /dev/null
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
\o
do $$ begin
  if (select count(*) from log_clientes) <> 1 then raise exception 'leitura da A deveria ver o cliente'; end if;
  update log_clientes set nome = 'X'; if found then raise exception 'leitura alterou'; end if;
  delete from log_clientes; if found then raise exception 'leitura apagou'; end if;
  begin
    insert into log_clientes(empresa_id, documento) values ('e000000a-0000-0000-0000-000000000000', '1');
    raise exception 'leitura inseriu';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- compras da A não vê a logística; admin da B não vê a A
\o /dev/null
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
\o
do $$ begin if exists (select 1 from log_clientes) then raise exception 'compras viu a logística'; end if; end $$;
reset role;
\o /dev/null
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
\o
do $$ begin
  if exists (select 1 from log_clientes) then raise exception 'B viu a logística da A'; end if;
  if exists (select 1 from membros where empresa_id = 'e000000a-0000-0000-0000-000000000000') then raise exception 'B viu membros da A'; end if;
  delete from log_clientes; if found then raise exception 'B apagou dado da A'; end if;
end $$;
reset role;
\o /dev/null
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
\o
do $$ begin delete from log_clientes where documento = '11222333000181'; if not found then raise exception 'admin da A não apagou'; end if; end $$;
reset role;
\echo 'ok: 05_politicas'
