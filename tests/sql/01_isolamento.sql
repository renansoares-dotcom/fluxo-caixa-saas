-- Uma empresa nunca enxerga nem altera os dados da outra; leitura não grava; sem login não executa funções.
\set ON_ERROR_STOP 1
create or replace function pg_temp.entrar(p uuid, p_aal text default 'aal1') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', p_aal)::text, false);
  set role authenticated;
end $$;
grant execute on function pg_temp.entrar(uuid, text) to authenticated;

\o /dev/null
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
\o
do $$ begin
  if (select count(*) from lancamentos) <> 1 then raise exception 'admin da A deveria ver só o lançamento da A'; end if;
  if exists (select 1 from lancamentos where empresa_id = 'e000000b-0000-0000-0000-000000000000') then raise exception 'A enxergou dado da B'; end if;
  update lancamentos set valor = 1 where empresa_id = 'e000000b-0000-0000-0000-000000000000';
  if found then raise exception 'A alterou dado da B'; end if;
end $$;
reset role;

\o /dev/null
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
\o
do $$ begin
  begin
    insert into lancamentos(empresa_id, data, plano_id, conta_id, valor) values
      ('e000000a-0000-0000-0000-000000000000', '2026-10-02', 'f000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 5);
    raise exception 'leitura conseguiu lançar';
  exception when insufficient_privilege then null;   -- RLS recusou: certo
  end;
end $$;
reset role;

set role anon;
do $$ begin
  begin perform is_membro('e000000a-0000-0000-0000-000000000000'); raise exception 'anon executou is_membro';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'isolamento entre empresas: ok' as resultado;
