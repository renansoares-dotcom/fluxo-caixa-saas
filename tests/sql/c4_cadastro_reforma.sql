\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1', 'email', 'u@t.com')::text, false);
  set role authenticated;
end $$;
create or replace function pg_temp.anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', '', false); perform set_config('request.jwt.claims', '{"role":"anon"}', false); set role anon; end $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_msg; end if; end $$;
create or replace function pg_temp.falha(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FALHOU (devia dar erro): %', p_msg;
end $$;
-- 198 — atualização cadastral da reforma: link por cliente, página pública, conferir e aplicar
\set E '''e000000a-0000-0000-0000-000000000000'''
\set EB '''e000000b-0000-0000-0000-000000000000'''
\set ADM '''a0000000-0000-0000-0000-00000000000a'''
\set ADB '''b0000000-0000-0000-0000-00000000000b'''
\set FIN '''d0000000-0000-0000-0000-00000000000d'''
\set CMP '''f0000000-0000-0000-0000-00000000000f'''
\set C1 '''c4000000-0000-0000-0000-0000000000c1'''
\set C2 '''c4000000-0000-0000-0000-0000000000c2'''
insert into favorecidos(id, empresa_id, tipo, nome, documento, uf, email, regime_tributario) values
  (:C1, :E, 'CLIENTES', 'CLIENTE REFORMA UM LTDA', '11.222.333/0001-81', 'PE', 'antigo@cliente.com', 'Lucro Presumido'),
  (:C2, :E, 'CLIENTES', 'CLIENTE REFORMA DOIS LTDA', '22.333.444/0001-90', 'SE', null, null) on conflict do nothing;
create temp table _g (k text primary key, v text); grant all on _g to authenticated, anon;

-- gerar
select pg_temp.entrar(:CMP::uuid);
select pg_temp.falha(format('select public.cadq_gerar(%L, array[%L]::uuid[])', 'e000000a-0000-0000-0000-000000000000', 'c4000000-0000-0000-0000-0000000000c1'), 'compras não gera');
select pg_temp.entrar(:FIN::uuid);
insert into _g select 'r1', public.cadq_gerar(:E::uuid, array[:C1::uuid, :C2::uuid])::text;
insert into _g select 't1', (v::jsonb -> 0 ->> 'token') from _g where k = 'r1';
select pg_temp.ok((select jsonb_array_length(v::jsonb) = 2 and length(v::jsonb -> 0 ->> 'token') = 64 from _g where k = 'r1'), 'dois links de 64 caracteres');
select pg_temp.ok((select expira_em = current_date + 30 from cadq_questionarios where favorecido_id = :C1::uuid), 'validade de 30 dias');
select pg_temp.ok(not (public.cadq_gerar(:E::uuid, array[:C1::uuid]) -> 0 ->> 'novo')::boolean, 'link válido é reaproveitado');
select pg_temp.ok((select count(*) = 2 from cadq_questionarios), 'sem link duplicado');

-- página pública
select pg_temp.anon();
select pg_temp.falha('select public.cadq_link_abrir(''abc'')', 'token inválido');
select pg_temp.falha('select count(*) from cadq_questionarios', 'anônimo sem acesso à tabela');
select pg_temp.ok((public.cadq_link_abrir((select v from _g where k = 't1')) -> 'atual' ->> 'email_nfe') = 'antigo@cliente.com', 'traz o cadastro atual para conferir');
select pg_temp.ok((public.cadq_link_abrir((select v from _g where k = 't1')) -> 'atual' ->> 'regime') = 'presumido', 'regime traduzido');
select pg_temp.falha(format('select public.cadq_link_responder(%L, %L::jsonb)', (select v from _g where k = 't1'), '{"aceite":false,"declarante":{"nome":"Fulano"}}'), 'sem a declaração');
select pg_temp.falha(format('select public.cadq_link_responder(%L, %L::jsonb)', (select v from _g where k = 't1'), '{"aceite":true,"declarante":{"nome":"Fulano"},"email_nfe":"xx"}'), 'e-mail inválido');
select public.cadq_link_responder((select v from _g where k = 't1'), '{"aceite":true,"declarante":{"nome":"Maria Fiscal","cargo":"Contadora","email":"maria@cliente.com"},
  "email_nfe":"nfe@cliente.com","ie":"0123456-78","uf":"PE","regime":"real","contribuinte_icms":"1","tipo":"industria","destinacao":["industrializacao"],
  "cred_icms":"sim","cred_pc":"sim","especiais":{"zfm":false},"contato_fiscal":{"nome":"Maria","email":"maria@cliente.com"}}'::jsonb);
reset role;
select pg_temp.ok((select situacao = 'respondido' and respondido_por like 'Maria Fiscal (Contadora)%' from cadq_questionarios where favorecido_id = :C1::uuid), 'resposta recebida');
select pg_temp.ok(exists (select 1 from notificacoes where tipo = 'cadastro_reforma'), 'aviso de resposta');
select pg_temp.ok((select email = 'antigo@cliente.com' from favorecidos where id = :C1::uuid), 'nada muda no cadastro antes de aplicar');

-- aplicar
select pg_temp.entrar(:CMP::uuid);
select pg_temp.ok((select count(*) = 0 from cadq_questionarios), 'compras não vê');
select pg_temp.entrar(:FIN::uuid);
select pg_temp.falha(format('select public.cadq_aplicar(%L, array[%L])', (select id from cadq_questionarios where favorecido_id = 'c4000000-0000-0000-0000-0000000000c1'), 'documento'), 'campo fora da lista');
select public.cadq_aplicar((select id from cadq_questionarios where favorecido_id = :C1::uuid), array['email_nfe', 'ie', 'regime', 'tipo', 'destinacao', 'cred_icms', 'cred_pc', 'contato_fiscal']);
reset role;
select pg_temp.ok((select email = 'nfe@cliente.com' and ie = '0123456-78' and regime_tributario = 'Lucro Real' from favorecidos where id = :C1::uuid), 'cadastro atualizado');
select pg_temp.ok((select tipo = 'industria' and regime = 'real' and cred_icms = 'sim' and destinacao = '{industrializacao}' from cad_perfil_fiscal where favorecido_id = :C1::uuid), 'perfil fiscal gravado');
select pg_temp.ok((select situacao = 'aplicado' from cadq_questionarios where favorecido_id = :C1::uuid), 'aplicado');
select pg_temp.anon();
select pg_temp.falha(format('select public.cadq_link_responder(%L, %L::jsonb)', (select v from _g where k = 't1'), '{"aceite":true,"declarante":{"nome":"Outro"}}'), 'depois de aplicado não responde de novo');
reset role;

-- cancelar, prorrogar, outra empresa, vencido
select pg_temp.entrar(:FIN::uuid);
select public.cadq_situacao((select id from cadq_questionarios where favorecido_id = :C2::uuid), 'prorrogar');
select pg_temp.ok((select expira_em = current_date + 60 from cadq_questionarios where favorecido_id = :C2::uuid), 'prorrogado');
select public.cadq_situacao((select id from cadq_questionarios where favorecido_id = :C2::uuid), 'cancelar');
select pg_temp.ok((public.cadq_gerar(:E::uuid, array[:C2::uuid]) -> 0 ->> 'novo')::boolean, 'cancelado: gera link novo');
select pg_temp.entrar(:ADB::uuid);
select pg_temp.falha(format('select public.cadq_gerar(%L, array[%L]::uuid[])', 'e000000b-0000-0000-0000-000000000000', 'c4000000-0000-0000-0000-0000000000c1'), 'cliente de outra empresa');
select pg_temp.ok((select count(*) = 0 from cadq_questionarios), 'outra empresa não vê');
reset role;
update cadq_questionarios set expira_em = current_date - 1 where favorecido_id = :C2::uuid and situacao = 'enviado';
insert into _g select 't2', token from cadq_questionarios where favorecido_id = :C2::uuid and situacao = 'enviado' limit 1;
select pg_temp.anon();
select pg_temp.ok((public.cadq_link_abrir((select v from _g where k = 't2')) ->> 'vencido')::boolean, 'link vencido avisa');
select pg_temp.falha(format('select public.cadq_link_responder(%L, %L::jsonb)', (select v from _g where k = 't2'), '{"aceite":true,"declarante":{"nome":"Fulano"}}'), 'vencido não responde');
reset role;
select pg_temp.entrar(:ADM::uuid);
select pg_temp.falha(format('select public.cadq_config_salvar(%L, %L::jsonb)', 'e000000a-0000-0000-0000-000000000000', '{"papeis_aplicar":["diretor"]}'), 'admin continua aplicando');
select public.cadq_config_salvar(:E::uuid, '{"validade_dias":15,"papeis_usa":["admin","diretor","financeiro","vendas"],"papeis_aplicar":["admin","diretor","financeiro"]}');
select pg_temp.ok((public.cadq_acesso(:E::uuid) ->> 'validade_dias')::int = 15, 'validade configurável');
reset role;
