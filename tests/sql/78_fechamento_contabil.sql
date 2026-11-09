-- Fechamento contábil assistido (SQL 142): regras padrão, sugestões (folha, apuração), gerar/refazer/desfazer, conferência bancária, fechar/reabrir e acesso.
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
create or replace function pg_temp.sug(p_cod text) returns jsonb language sql as $$
  select x from jsonb_array_elements(public.contab_fech_sugestoes('e000000a-0000-0000-0000-000000000000', '2026-10-01')) x where x ->> 'codigo' = p_cod
$$;
\set E '''e000000a-0000-0000-0000-000000000000'''
-- dados
insert into contab_contas(id, empresa_id, classificacao, descricao, nivel, tipo, natureza, codigo) values
  ('78000000-0000-0000-0000-0000000000a1', :E, '3.9.78.01', 'DESPESA 13º (78)', 4, 'A', 'D', 7801),
  ('78000000-0000-0000-0000-0000000000a2', :E, '2.1.78.01', 'PROVISÃO 13º (78)', 4, 'A', 'C', 7802),
  ('78000000-0000-0000-0000-0000000000a3', :E, '1.1.78.01', 'BANCO 78 CONTÁBIL', 4, 'A', 'D', 7803);
delete from rh_colaboradores where empresa_id = :E;
insert into rh_colaboradores(empresa_id, nome, vinculo, situacao, admissao, salario) values
  (:E, 'COLAB 78 A', 'clt', 'ativo', '2025-01-01', 3000), (:E, 'COLAB 78 B', 'clt', 'ativo', '2026-03-01', 2000),
  (:E, 'ESTAGIO 78', 'estagio', 'ativo', '2026-01-01', 1000), (:E, 'SAIU 78', 'clt', 'desligado', '2025-01-01', 5000);
insert into rh_parametros(empresa_id, inss_pct, fgts_pct) values (:E, 20, 8) on conflict (empresa_id) do update set inss_pct = 20, fgts_pct = 8;
delete from fisc_apuracoes where empresa_id = :E;

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');   -- admin
select pg_temp.ok((public.contab_fech_resumo(:E, '2026-10-15') ->> 'situacao') = 'aberto', 'resumo cria as regras padrão');
select pg_temp.ok((select count(*) from contab_fech_regras where empresa_id = :E) = 7, '7 regras padrão');
select pg_temp.ok((pg_temp.sug('decimo') ->> 'valor')::numeric = 416.67, '13º = 8,3333% de 5.000');
select pg_temp.ok((pg_temp.sug('ferias') ->> 'valor')::numeric = 555.56, 'férias = 11,1111% de 5.000');
select pg_temp.ok((pg_temp.sug('encargos') ->> 'valor')::numeric = round((416.67 + 555.56) * 0.28, 2), 'encargos = 28% das provisões');
select pg_temp.ok(pg_temp.sug('decimo') ->> 'aviso' like '%contas%', 'avisa sem contas');
select pg_temp.ok(pg_temp.sug('icms') ->> 'valor' is null and pg_temp.sug('icms') ->> 'aviso' like 'Feche a apuração%', 'ICMS espera a apuração fechada');
insert into fisc_apuracoes(empresa_id, mes, situacao, resultado) values (:E, '2026-10-01', 'fechada', '{"icms":{"recolher":1234.5,"feef":10,"adDiper":2,"fecep":3},"ipi":{"recolher":0},"pc":{"recolher":99}}');
select pg_temp.ok((pg_temp.sug('icms') ->> 'valor')::numeric = 1234.5 and (pg_temp.sug('feef_fecep') ->> 'valor')::numeric = 15, 'impostos da apuração fechada');
select pg_temp.falha($$select public.contab_fech_gerar('e000000a-0000-0000-0000-000000000000', '2026-10-01', jsonb_build_array(jsonb_build_object('regra_id', (select id from contab_fech_regras where codigo = 'decimo' and empresa_id = 'e000000a-0000-0000-0000-000000000000'), 'valor', 416.67)))$$, 'gerar sem contas');
update contab_fech_regras set conta_debito_id = '78000000-0000-0000-0000-0000000000a1', conta_credito_id = '78000000-0000-0000-0000-0000000000a2' where empresa_id = :E and codigo = 'decimo';
select pg_temp.ok(public.contab_fech_gerar(:E, '2026-10-01', jsonb_build_array(jsonb_build_object('regra_id', (select id from contab_fech_regras where codigo = 'decimo' and empresa_id = :E), 'valor', 416.67))) = 1, 'gera 1');
select pg_temp.ok((select count(*) from contab_lancamentos l join contab_partidas p on p.lancamento_id = l.id where l.empresa_id = :E and l.origem = 'folha' and l.data = '2026-10-31') = 2, 'lançamento com 2 partidas no último dia');
select pg_temp.ok((pg_temp.sug('decimo') ->> 'gerado')::boolean, 'marcado como gerado');
-- refaz com outro valor: continua um lançamento só
select public.contab_fech_gerar(:E, '2026-10-01', jsonb_build_array(jsonb_build_object('regra_id', (select id from contab_fech_regras where codigo = 'decimo' and empresa_id = :E), 'valor', 400)));
select pg_temp.ok((select count(*) from contab_lancamentos where empresa_id = :E and origem = 'folha' and data = '2026-10-31') = 1, 'refazer não duplica');
select pg_temp.ok((select valor = 400 and valor_sugerido = 416.67 from contab_fech_gerados where empresa_id = :E and mes = '2026-10-01'), 'valor ajustado e sugerido');

-- conferência: banco com saldo no fluxo × balancete importado
reset role;
insert into contas(id, empresa_id, nome, ativo, saldo_inicial) values ('78000000-0000-0000-0000-0000000000c1', :E, 'BANCO 78', true, 1000);
insert into contab_depara_conta(conta_bancaria_id, empresa_id, conta_id) values ('78000000-0000-0000-0000-0000000000c1', :E, '78000000-0000-0000-0000-0000000000a3');
insert into contab_balancetes(id, empresa_id, data_ini, data_fim) values ('78000000-0000-0000-0000-0000000000b1', :E, '2026-10-01', '2026-10-31');
insert into contab_balancete_itens(balancete_id, conta_id, saldo_atual) values ('78000000-0000-0000-0000-0000000000b1', '78000000-0000-0000-0000-0000000000a3', 1000.5);
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select (x ->> 'ok')::boolean and (x ->> 'diferenca')::numeric = 0.5 from jsonb_array_elements(public.contab_fech_conferencia(:E, '2026-10-01') -> 'contas') x where x ->> 'nome' = 'BANCO 78'), 'banco confere dentro da tolerância');
update contab_fech_config set tolerancia = 0 where empresa_id = :E;
select pg_temp.ok((select not (x ->> 'ok')::boolean from jsonb_array_elements(public.contab_fech_conferencia(:E, '2026-10-01') -> 'contas') x where x ->> 'nome' = 'BANCO 78'), 'tolerância zero acusa');
select pg_temp.ok(public.contab_fech_conferencia(:E, '2026-10-01') ->> 'fonte' = 'importado', 'fonte importado');

-- fechar: bloqueia gerar e desfazer; só admin reabre
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');   -- financeiro
select public.contab_fech_situacao(:E, '2026-10-01', true, 'conferido');
select pg_temp.ok((public.contab_fech_resumo(:E, '2026-10-01') ->> 'situacao') = 'fechado', 'fechado');
select pg_temp.falha($$select public.contab_fech_desfazer('e000000a-0000-0000-0000-000000000000', '2026-10-01', (select id from contab_fech_regras where codigo = 'decimo' and empresa_id = 'e000000a-0000-0000-0000-000000000000'))$$, 'fechado não desfaz');
select pg_temp.falha($$select public.contab_fech_situacao('e000000a-0000-0000-0000-000000000000', '2026-10-01', false)$$, 'financeiro não reabre');
update contab_fech_regras set percentual = 1 where empresa_id = :E and codigo = 'decimo';
select pg_temp.ok((select percentual from contab_fech_regras where empresa_id = :E and codigo = 'decimo') = 8.3333, 'financeiro não altera regras');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select public.contab_fech_situacao(:E, '2026-10-01', false);
select public.contab_fech_desfazer(:E, '2026-10-01', (select id from contab_fech_regras where codigo = 'decimo' and empresa_id = :E));
select pg_temp.ok((select count(*) from contab_lancamentos where empresa_id = :E and origem = 'folha' and data = '2026-10-31') = 0, 'desfeito');
select public.contab_fech_exportado(:E, '2026-10-01');
select pg_temp.ok((public.contab_fech_resumo(:E, '2026-10-01') ->> 'exportado_em') is not null, 'exportação registrada');

select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');   -- leitura
select pg_temp.falha($$select public.contab_fech_sugestoes('e000000a-0000-0000-0000-000000000000', '2026-10-01')$$, 'leitura sem acesso');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from contab_fech_regras where empresa_id = :E) = 0, 'outra empresa não vê');
reset role;
\o
select 'ok 78 fechamento contábil';
