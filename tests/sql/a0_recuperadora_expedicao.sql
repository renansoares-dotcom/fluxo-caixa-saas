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
-- Recuperadora: expedição (SQL 167)
insert into favorecidos(id, empresa_id, nome) values ('a9000000-0000-0000-0000-0000000000c1', :E, 'Cliente de grão 100');
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
-- lotes: o grão da ordem do teste 98 (540 kg, R$ 1.280, bloqueado até o ensaio) e o separado do teste 99 (5 kg restantes)
create temp table lg as select id, codigo, saldo_kg, custo_total, peso_kg, situacao from rec_lotes where id = (select lote_saida_id from rec_ordens where id = '98000000-0000-0000-0000-000000000f01');
create temp table ls as select l.id, l.saldo_kg from rec_lotes l join rec_ordem_separacoes s on s.lote_id = l.id where s.ordem_id = '99000000-0000-0000-0000-000000000f01';
select pg_temp.ok((select situacao = 'bloqueado' and saldo_kg = 540 from lg) and (select saldo_kg = 5 from ls), 'lotes de partida');
grant select on lg, ls to authenticated;
insert into rec_expedicoes(id, empresa_id, data, nf_numero, placa, peso_total, valor_total) values ('a9000000-0000-0000-0000-000000000e01', :E, '2026-11-16', ' 1234 ', 'abc1d23', 999, 999);
select pg_temp.ok((select numero = 1 and nf_numero = '1234' and placa = 'ABC1D23' and peso_total is null and valor_total is null from rec_expedicoes where id = 'a9000000-0000-0000-0000-000000000e01'), 'número, limpeza e totais só pela função');
insert into rec_expedicao_itens(empresa_id, expedicao_id, lote_id, kg, volumes, embalagem, preco_kg, custo) select :E, 'a9000000-0000-0000-0000-000000000e01', id, 200, 8, 'saco de 25 kg', 6.5, 999 from lg;
insert into rec_expedicao_itens(empresa_id, expedicao_id, lote_id, kg, volumes, embalagem) select :E, 'a9000000-0000-0000-0000-000000000e01', id, 5, 1, 'big bag' from ls;
select pg_temp.ok((select valor = 1300 and custo is null from rec_expedicao_itens where preco_kg = 6.5), 'valor do item = kg × preço; custo não vem da tela');
select pg_temp.falha($$select public.rec_expedicao_expedir('a9000000-0000-0000-0000-000000000e01')$$, 'sem cliente');
update rec_expedicoes set cliente_id = 'a9000000-0000-0000-0000-0000000000c1' where id = 'a9000000-0000-0000-0000-000000000e01';
-- lote bloqueado pela qualidade não embarca; nada sai pela metade
select pg_temp.falha($$select public.rec_expedicao_expedir('a9000000-0000-0000-0000-000000000e01')$$, 'lote bloqueado');
select pg_temp.ok((select saldo_kg = 5 from rec_lotes where id = (select id from ls)), 'falha não baixa nada');
reset role; update rec_lotes set situacao = 'disponivel' where id = (select id from lg); select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
-- exige a nota quando o parâmetro pede
update rec_config set expedicao_exigir_nf = true where empresa_id = :E;
update rec_expedicoes set nf_numero = null where id = 'a9000000-0000-0000-0000-000000000e01';
select pg_temp.falha($$select public.rec_expedicao_expedir('a9000000-0000-0000-0000-000000000e01')$$, 'sem nota');
update rec_expedicoes set nf_numero = '1234' where id = 'a9000000-0000-0000-0000-000000000e01';
-- sem conta de venda: expede sem título. 200 kg de grão a custo 1280/540 = 474,07; 5 kg do separado a R$ 1,00 = 5,00
create temp table x1 as select public.rec_expedicao_expedir('a9000000-0000-0000-0000-000000000e01') r;
select pg_temp.ok((select (r ->> 'kg')::numeric = 205 and (r ->> 'volumes')::int = 9 and (r ->> 'valor')::numeric = 1300 and (r ->> 'custo')::numeric = 479.07 and (r ->> 'sem_preco')::int = 1 and r ->> 'lancamento_id' is null from x1), 'expedir: totais, custo e item sem preço');
select pg_temp.ok((select situacao = 'expedida' and peso_total = 205 and valor_total = 1300 and expedida_em is not null from rec_expedicoes where id = 'a9000000-0000-0000-0000-000000000e01'), 'expedição gravada');
select pg_temp.ok((select saldo_kg = 340 and situacao = 'disponivel' from rec_lotes where id = (select id from lg)) and (select saldo_kg = 0 and situacao = 'vendido' from rec_lotes where id = (select id from ls)), 'saldo dos lotes');
select pg_temp.ok((select count(*) = 2 and bool_and(s.destino = 'venda' and s.documento = 'NF 1234') from rec_expedicao_itens i join rec_lote_saidas s on s.id = i.saida_id where i.expedicao_id = 'a9000000-0000-0000-0000-000000000e01'), 'saídas de venda ligadas aos itens');
update rec_expedicoes set observacao = 'x' where id = 'a9000000-0000-0000-0000-000000000e01';
select pg_temp.ok((select observacao is null from rec_expedicoes where id = 'a9000000-0000-0000-0000-000000000e01'), 'expedida não muda pela tela');
select pg_temp.falha($$select public.rec_expedicao_expedir('a9000000-0000-0000-0000-000000000e01')$$, 'expedir de novo');
-- produção cancela a aberta, mas não a expedida
select pg_temp.falha($$select public.rec_expedicao_cancelar('a9000000-0000-0000-0000-000000000e01', 'x')$$, 'motivo curto');
select public.rec_expedicao_cancelar('a9000000-0000-0000-0000-000000000e01', 'Cliente recusou a carga');
select pg_temp.ok((select saldo_kg = 540 from rec_lotes where id = (select id from lg)) and (select saldo_kg = 5 and situacao = 'disponivel' from rec_lotes where id = (select id from ls)), 'cancelar devolve os kg');
select pg_temp.ok((select situacao = 'cancelada' and cancelamento_motivo = 'Cliente recusou a carga' from rec_expedicoes where id = 'a9000000-0000-0000-0000-000000000e01') and not exists (select 1 from rec_lote_saidas where documento = 'NF 1234'), 'cancelada e sem saídas');
-- com conta de venda e prazo: gera o título a receber; título pago trava o cancelamento
update rec_config set expedicao_exigir_nf = false, prazo_recebimento_dias = 28, plano_venda_id = (select id from plano_contas where empresa_id = 'e000000a-0000-0000-0000-000000000000' and tipo = 'E' and nivel = 2 order by codigo limit 1) where empresa_id = :E;
select pg_temp.ok((select plano_venda_id is not null from rec_config where empresa_id = :E), 'há conta de receita no plano');
insert into rec_expedicoes(id, empresa_id, data, cliente_id) values ('a9000000-0000-0000-0000-000000000e02', :E, '2026-11-17', 'a9000000-0000-0000-0000-0000000000c1');
insert into rec_expedicao_itens(empresa_id, expedicao_id, lote_id, kg, preco_kg) select :E, 'a9000000-0000-0000-0000-000000000e02', id, 100, 7 from lg;
create temp table x2 as select public.rec_expedicao_expedir('a9000000-0000-0000-0000-000000000e02') r;
select pg_temp.ok((select l.valor = 700 and l.status = 'Em aberto' and l.data = '2026-12-15' and l.favorecido_id = 'a9000000-0000-0000-0000-0000000000c1' and l.documento = 'EXP 2' and l.origem = 'recuperadora'
  from lancamentos l where l.id = (select (r ->> 'lancamento_id')::uuid from x2)), 'título a receber com o prazo');
select pg_temp.ok((select (r ->> 'margem')::numeric = round(700 - 100 * 1280 / 540.0, 2) from x2), 'margem da expedição');
reset role; update lancamentos set status = 'Pago' where id = (select (r ->> 'lancamento_id')::uuid from x2); select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.falha($$select public.rec_expedicao_cancelar('a9000000-0000-0000-0000-000000000e02', 'Tentativa com o título recebido')$$, 'título já recebido');
-- quem só lê não abre expedição
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($$insert into rec_expedicoes(empresa_id) values ('e000000a-0000-0000-0000-000000000000')$$, 'leitura não abre expedição');
select pg_temp.falha($$select public.rec_expedicao_expedir('a9000000-0000-0000-0000-000000000e02')$$, 'leitura não expede');
reset role;
update rec_config set plano_venda_id = null, prazo_recebimento_dias = 0 where empresa_id = 'e000000a-0000-0000-0000-000000000000';
