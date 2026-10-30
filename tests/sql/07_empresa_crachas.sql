-- Identidade da empresa e crachás (SQL 066): só o administrador muda a identidade; só o RH emite crachá;
-- 2ª via cancela a anterior; o QR Code verifica sem login e mostra só o necessário; outra empresa não vê nada.
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
grant execute on all functions in schema pg_temp to authenticated, anon;
insert into rh_colaboradores(id, empresa_id, nome, cargo, setor, matricula, situacao, salario) values
  ('c1000000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 'PESSOA TESTE', 'OPERADOR', 'Extrusão', '0001', 'ativo', 2000);

-- administrador da A: identidade, crachá, 2ª via, foto
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
insert into empresa_identidade(empresa_id, nome_exibicao, cor_primaria) values ('e000000a-0000-0000-0000-000000000000', 'EMPRESA A', '#112233');
select (cracha_emitir(jsonb_build_object('empresa_id', 'e000000a-0000-0000-0000-000000000000', 'colaborador_id', 'c1000000-0000-0000-0000-000000000001', 'nome', 'PESSOA TESTE', 'cargo', 'OPERADOR'))).codigo as c1 \gset
select (cracha_emitir(jsonb_build_object('empresa_id', 'e000000a-0000-0000-0000-000000000000', 'colaborador_id', 'c1000000-0000-0000-0000-000000000001', 'nome', 'PESSOA TESTE', 'cargo', 'OPERADOR'))).codigo as c2 \gset
select pg_temp.ok((select count(*) from crachas where status = 'ativo') = 1, 'só um crachá ativo por pessoa');
select pg_temp.ok((select via from crachas where codigo = :'c2') = 2, '2ª via numerada');
insert into storage.objects(bucket_id, name) values ('empresa', 'e000000a-0000-0000-0000-000000000000/fotos/c1.jpg'), ('empresa', 'e000000a-0000-0000-0000-000000000000/identidade/logo.png');
reset role;

-- leitura da A: vê a identidade, não muda; sem RH não vê crachá nem foto
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) from empresa_identidade) = 1, 'leitura vê a identidade');
update empresa_identidade set cor_primaria = '#000000';
select pg_temp.ok((select cor_primaria from empresa_identidade) = '#112233', 'leitura não muda a identidade');
select pg_temp.ok((select count(*) from crachas) = 0, 'sem RH não vê crachás');
select pg_temp.ok((select count(*) from storage.objects where bucket_id = 'empresa' and name like '%/fotos/%') = 0, 'sem RH não vê fotos');
select pg_temp.ok((select count(*) from storage.objects where bucket_id = 'empresa' and name like '%/identidade/%') = 1, 'membro vê o logo');
do $$ begin
  begin perform cracha_emitir(jsonb_build_object('empresa_id', 'e000000a-0000-0000-0000-000000000000', 'nome', 'X'));
    raise exception 'FALHOU: leitura emitiu crachá';
  exception when raise_exception then if sqlerrm like 'FALHOU%' then raise; end if; end;
end $$;
reset role;

-- outra empresa não vê nada da A
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from empresa_identidade) = 0, 'B não vê a identidade da A');
select pg_temp.ok((select count(*) from crachas) = 0, 'B não vê crachás da A');
select pg_temp.ok((select count(*) from storage.objects where bucket_id = 'empresa') = 0, 'B não vê arquivos da A');
reset role;

-- QR Code sem login
set role anon;
select pg_temp.ok((select situacao from cracha_verificar(:'c2')) = 'ativo', 'QR da via atual = ativo');
select pg_temp.ok((select situacao from cracha_verificar(:'c1')) = 'cancelado', 'QR da via antiga = cancelado');
select pg_temp.ok((select empresa from cracha_verificar(:'c2')) = 'EMPRESA A', 'QR mostra a empresa');
select pg_temp.ok(not exists (select 1 from cracha_verificar('qualquer')), 'código inválido não mostra nada');
reset role;
update rh_colaboradores set situacao = 'desligado' where id = 'c1000000-0000-0000-0000-000000000001';
set role anon;
select pg_temp.ok((select situacao from cracha_verificar(:'c2')) = 'cancelado', 'desligado = crachá cancelado');
reset role;
\o
select 'empresa e crachás: ok' as resultado;
