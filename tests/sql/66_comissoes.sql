-- Comissões (SQL 130): pelo recebido, base sem impostos, exceção por cliente, redução por atraso, fechamento, título a pagar,
-- estorno da recompra, cancelamento e extrato do representante.
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
\set E '''e000000a-0000-0000-0000-000000000000'''
insert into auth.users(id, email) values ('66000000-0000-0000-0000-0000000000a1', 'rep66@exemplo.com'), ('66000000-0000-0000-0000-0000000000a2', 'rep66b@exemplo.com');
insert into membros(empresa_id, user_id, papel) values (:E, '66000000-0000-0000-0000-0000000000a1', 'vendas'), (:E, '66000000-0000-0000-0000-0000000000a2', 'vendas');
insert into plano_contas(id, empresa_id, codigo, nome, natureza, nivel, tipo) values ('66000000-0000-0000-0000-0000000000b1', :E, '1.01.66', 'VENDAS 66', 'C', 2, 'E'),
  ('66000000-0000-0000-0000-0000000000b2', :E, '2.03.66', 'COMISSÕES 66', 'D', 2, 'S');
insert into favorecidos(id, empresa_id, tipo, nome) values ('66000000-0000-0000-0000-0000000000e1', :E, 'REPRESENTANTES', 'REP 66'), ('66000000-0000-0000-0000-0000000000e2', :E, 'REPRESENTANTES', 'REP 66B');
insert into favorecidos(id, empresa_id, tipo, nome, representante_id) values
  ('66000000-0000-0000-0000-0000000000f1', :E, 'CLIENTES', 'CLIENTE 66 UM', '66000000-0000-0000-0000-0000000000e1'),
  ('66000000-0000-0000-0000-0000000000f2', :E, 'CLIENTES', 'CLIENTE 66 DOIS', '66000000-0000-0000-0000-0000000000e1'),
  ('66000000-0000-0000-0000-0000000000f3', :E, 'CLIENTES', 'CLIENTE 66 TRES', '66000000-0000-0000-0000-0000000000e2');
insert into comercial_vendedores(id, empresa_id, nome, representante_id, user_id, comissao_pct) values
  ('66000000-0000-0000-0000-0000000000c1', :E, 'Rep 66', '66000000-0000-0000-0000-0000000000e1', '66000000-0000-0000-0000-0000000000a1', 3),
  ('66000000-0000-0000-0000-0000000000c2', :E, 'Rep 66B', '66000000-0000-0000-0000-0000000000e2', '66000000-0000-0000-0000-0000000000a2', 2);
insert into comissao_excecoes(empresa_id, vendedor_id, favorecido_id, pct) values (:E, null, '66000000-0000-0000-0000-0000000000f2', 5);
insert into comissao_config(empresa_id, base, atraso_dias, atraso_reducao_pct, inicio, plano_id) values (:E, 'sem_impostos', 5, 50, '2026-09-01', '66000000-0000-0000-0000-0000000000b2')
  on conflict (empresa_id) do update set base = excluded.base, atraso_dias = 5, atraso_reducao_pct = 50, inicio = '2026-09-01', plano_id = excluded.plano_id;
insert into nfe_notas(id, empresa_id, chave, numero, emissao, tipo, emissao_propria, situacao, favorecido_id, v_nf, v_ipi) values
  ('66000000-0000-0000-0000-0000000000d1', :E, 'COM66A', 96601, '2026-08-10', 'saida', true, 'autorizada', '66000000-0000-0000-0000-0000000000f1', 1000, 100),
  ('66000000-0000-0000-0000-0000000000d2', :E, 'COM66B', 96602, '2026-08-15', 'saida', true, 'autorizada', '66000000-0000-0000-0000-0000000000f2', 500, 0),
  ('66000000-0000-0000-0000-0000000000d3', :E, 'COM66C', 96603, '2026-08-15', 'saida', true, 'autorizada', '66000000-0000-0000-0000-0000000000f3', 800, 0);
insert into nfe_parcelas(id, empresa_id, nota_id, numero, vencimento, valor) values
  ('66000000-0000-0000-0000-000000000091', :E, '66000000-0000-0000-0000-0000000000d1', 1, '2026-09-10', 1000),
  ('66000000-0000-0000-0000-000000000092', :E, '66000000-0000-0000-0000-0000000000d2', 1, '2026-09-05', 500),
  ('66000000-0000-0000-0000-000000000093', :E, '66000000-0000-0000-0000-0000000000d3', 1, '2026-09-05', 800);
insert into lancamentos(id, empresa_id, data, plano_id, favorecido_id, valor, status, documento) values
  ('66000000-0000-0000-0000-000000000001', :E, '2026-09-20', '66000000-0000-0000-0000-0000000000b1', '66000000-0000-0000-0000-0000000000f1', 1000, 'Pago', '96601/1'),
  ('66000000-0000-0000-0000-000000000002', :E, '2026-09-05', '66000000-0000-0000-0000-0000000000b1', '66000000-0000-0000-0000-0000000000f2', 500, 'Pago', '96602/1'),
  ('66000000-0000-0000-0000-000000000003', :E, '2026-09-06', '66000000-0000-0000-0000-0000000000b1', '66000000-0000-0000-0000-0000000000f3', 800, 'Pago', '96603/1'),
  ('66000000-0000-0000-0000-000000000004', :E, '2026-08-20', '66000000-0000-0000-0000-0000000000b1', '66000000-0000-0000-0000-0000000000f1', 300, 'Pago', 'ANTES'),
  ('66000000-0000-0000-0000-000000000005', :E, '2026-10-20', '66000000-0000-0000-0000-0000000000b1', '66000000-0000-0000-0000-0000000000f1', 200, 'Em aberto', 'ABERTO');
insert into nfe_vinculos(empresa_id, nota_id, parcela_id, lancamento_id, tipo) values
  (:E, '66000000-0000-0000-0000-0000000000d1', '66000000-0000-0000-0000-000000000091', '66000000-0000-0000-0000-000000000001', 'exata'),
  (:E, '66000000-0000-0000-0000-0000000000d2', '66000000-0000-0000-0000-000000000092', '66000000-0000-0000-0000-000000000002', 'exata'),
  (:E, '66000000-0000-0000-0000-0000000000d3', '66000000-0000-0000-0000-000000000093', '66000000-0000-0000-0000-000000000003', 'exata'),
  (:E, '66000000-0000-0000-0000-0000000000d1', null, '66000000-0000-0000-0000-000000000004', 'manual'),
  (:E, '66000000-0000-0000-0000-0000000000d1', null, '66000000-0000-0000-0000-000000000005', 'manual');

-- o representante vê a prévia só dele
select pg_temp.entrar('66000000-0000-0000-0000-0000000000a1');
create temp table ap as select public.comissao_apurar(:E, '2026-09-01') j; grant all on ap to authenticated;
select pg_temp.ok((select jsonb_array_length(j) = 1 and j -> 0 ->> 'nome' = 'Rep 66' from ap), 'só o próprio representante');
select pg_temp.ok((select jsonb_array_length(j -> 0 -> 'itens') = 2 from ap), 'dois recebimentos (antes do início e em aberto ficam fora)');
select pg_temp.ok((select (i ->> 'base')::numeric = 900 and (i ->> 'pct')::numeric = 3 and (i ->> 'reducao_pct')::numeric = 50 and (i ->> 'comissao')::numeric = 13.5 and (i ->> 'dias_atraso')::int = 10
                     from ap, jsonb_array_elements(j -> 0 -> 'itens') i where (i ->> 'nota_numero')::int = 96601), 'sem IPI, 3%, atraso reduz 50%');
select pg_temp.ok((select (i ->> 'comissao')::numeric = 25 from ap, jsonb_array_elements(j -> 0 -> 'itens') i where (i ->> 'nota_numero')::int = 96602), 'exceção de 5% no cliente');
select pg_temp.falha($$select public.comissao_fechar('66000000-0000-0000-0000-0000000000c1', '2026-09-01')$$, 'representante não fecha');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select jsonb_array_length(public.comissao_apurar(:E, '2026-09-01')) >= 2), 'leitura vê todos');
select pg_temp.falha($$select public.comissao_fechar('66000000-0000-0000-0000-0000000000c1', '2026-09-01')$$, 'leitura não fecha');

-- o financeiro fecha setembro
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha($$select public.comissao_fechar('66000000-0000-0000-0000-0000000000c1', date_trunc('month', current_date)::date)$$, 'mês em curso');
select pg_temp.falha($$select public.comissao_fechar('66000000-0000-0000-0000-0000000000c1', '2026-09-01', 10, '')$$, 'ajuste sem motivo');
create temp table fx as select public.comissao_fechar('66000000-0000-0000-0000-0000000000c1', '2026-09-01', 1.5, 'Acerto de arredondamento') id; grant all on fx to authenticated;
reset role;
select pg_temp.ok((select comissao_total = 38.5 and total = 40 and base_total = 1400 from comissao_fechamentos where id = (select id from fx)), 'totais');
select pg_temp.ok((select l.valor = 40 and l.status = 'Em aberto' and l.data = '2026-10-10' and l.favorecido_id = '66000000-0000-0000-0000-0000000000e1'
                     from comissao_fechamentos f join lancamentos l on l.id = f.lancamento_id where f.id = (select id from fx)), 'título a pagar dia 10');
select pg_temp.ok((select count(*) = 1 from notificacoes where tipo = 'comissao_fechada' and user_id = '66000000-0000-0000-0000-0000000000a1'), 'aviso ao representante');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha($$select public.comissao_fechar('66000000-0000-0000-0000-0000000000c1', '2026-09-01')$$, 'já fechado');
select pg_temp.ok((select jsonb_array_length(x -> 'itens') = 0 and x -> 'fechamento' is not null from jsonb_array_elements(public.comissao_apurar(:E, '2026-09-01')) x where x ->> 'nome' = 'Rep 66'), 'prévia mostra o fechamento');
select pg_temp.ok((select count(*) = 0 from jsonb_array_elements(public.comissao_apurar(:E, '2026-10-01')) x, jsonb_array_elements(x -> 'itens') i where x ->> 'nome' = 'Rep 66'), 'nada em outubro');

-- recompra: o recebimento volta a aberto e vira estorno em outubro
reset role;
update lancamentos set status = 'Em aberto' where id = '66000000-0000-0000-0000-000000000001';
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select (i ->> 'comissao')::numeric = -13.5 and i ->> 'tipo' = 'estorno' from jsonb_array_elements(public.comissao_apurar(:E, '2026-10-01')) x, jsonb_array_elements(x -> 'itens') i where x ->> 'nome' = 'Rep 66'), 'estorno');

-- extrato do representante
select pg_temp.entrar('66000000-0000-0000-0000-0000000000a1');
select pg_temp.ok((select jsonb_array_length(public.comissao_extrato(:E)) = 1 and (public.comissao_extrato(:E) -> 0 ->> 'total')::numeric = 40), 'extrato do representante');
select pg_temp.ok((select count(*) = 0 from comissao_fechamentos where vendedor_id = '66000000-0000-0000-0000-0000000000c2'), 'não vê o fechamento do outro');
select pg_temp.entrar('66000000-0000-0000-0000-0000000000a2');
select pg_temp.ok((select jsonb_array_length(public.comissao_extrato(:E)) = 0), 'o outro representante não vê');

-- cancelar: os itens voltam para a apuração e o título a pagar some
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.falha($$select public.comissao_cancelar((select id from fx), '')$$, 'cancelar sem motivo');
select public.comissao_cancelar((select id from fx), 'Fechado antes da baixa do extrato');
reset role;
select pg_temp.ok((select situacao = 'cancelado' from comissao_fechamentos where id = (select id from fx)), 'cancelado');
select pg_temp.ok((select count(*) = 0 from lancamentos where descricao like 'Comissão 09/2026 — Rep 66%'), 'título excluído');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');
select pg_temp.ok((select jsonb_array_length(x -> 'itens') = 1 from jsonb_array_elements(public.comissao_apurar(:E, '2026-09-01')) x where x ->> 'nome' = 'Rep 66'), 'itens voltam (só o que está pago)');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.falha($$select public.comissao_apurar('e000000a-0000-0000-0000-000000000000', '2026-09-01')$$, 'outra empresa');
reset role;
\o
select 'ok 66 comissões';
