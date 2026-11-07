-- Prestação de contas do PA (SQL 097): prazo padrão/previsão/prorrogado, lembrete, cobrança, escalada, cobrar agora, permissões.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
create or replace function pg_temp.entrar(p uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p::text, false);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated', 'aal', 'aal1', 'email', 'admin.a@exemplo.com')::text, false);
  set role authenticated;
end $$;
create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_cond, false) then raise exception 'FALHOU: %', p_msg; end if; end $$;
create or replace function pg_temp.falha(p_sql text, p_msg text) returns void language plpgsql as $$
begin
  begin execute p_sql; exception when others then return; end;
  raise exception 'FALHOU (devia dar erro): %', p_msg;
end $$;

-- PAs pagos aguardando nota (o usuário f… é de compras e pediu os dois primeiros)
alter table paraquedas disable trigger paraquedas_regras;
insert into paraquedas(id, empresa_id, numero, razao_social, valor, data_pagamento, descricao, tera_nota, status, criado_por, solicitante, previsao_nota) values
  ('ad330000-0000-0000-0000-000000000001', 'e000000a-0000-0000-0000-000000000000', 901, 'FORNECEDOR ATRASADO', 1000, current_date - 40, 'peças', true, 'pago', 'f0000000-0000-0000-0000-00000000000f', 'Bia', null),
  ('ad330000-0000-0000-0000-000000000002', 'e000000a-0000-0000-0000-000000000000', 902, 'FORNECEDOR NO PRAZO', 500, current_date - 13, 'serviço', true, 'pago', 'f0000000-0000-0000-0000-00000000000f', 'Bia', null),
  ('ad330000-0000-0000-0000-000000000003', 'e000000a-0000-0000-0000-000000000000', 903, 'COM PREVISÃO', 300, current_date - 30, 'frete', true, 'pago', 'd0000000-0000-0000-0000-00000000000d', null, current_date + 20),
  ('ad330000-0000-0000-0000-000000000004', 'e000000a-0000-0000-0000-000000000000', 904, 'SEM NOTA', 200, current_date - 60, 'gorjeta', false, 'pago', 'd0000000-0000-0000-0000-00000000000d', null, null);
alter table paraquedas enable trigger paraquedas_regras;

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.ok((select count(*) from pa_prestacao('e000000a-0000-0000-0000-000000000000') where numero between 901 and 904) = 3, 'sem nota fiscal fica de fora');
select pg_temp.ok((select dias_restantes = -25 and origem_prazo = 'padrao' and responsavel = 'Bia' from pa_prestacao('e000000a-0000-0000-0000-000000000000') where numero = 901), 'prazo padrão 15 dias depois do pagamento');
select pg_temp.ok((select dias_restantes = 20 and origem_prazo = 'previsao' from pa_prestacao('e000000a-0000-0000-0000-000000000000') where numero = 903), 'a previsão do pedido vale como prazo');

-- cobrança automática: 901 cobrado e escalado (25 dias ≥ 10); 902 vence em 2 dias → lembrete; 903 nada
reset role;
select pg_temp.ok(_pa_cobrar('e000000a-0000-0000-0000-000000000000') = 3, 'cobrança + escalada do 901 e lembrete do 902');
select pg_temp.ok((select string_agg(tipo, ',' order by tipo) = 'cobranca,escalada' from pa_cobrancas where paraquedas_id = 'ad330000-0000-0000-0000-000000000001'), 'histórico do 901');
select pg_temp.ok((select tipo = 'lembrete' from pa_cobrancas where paraquedas_id = 'ad330000-0000-0000-0000-000000000002'), 'lembrete do 902');
select pg_temp.ok((select count(*) from notificacoes where tipo = 'pa_prestacao' and user_id = 'f0000000-0000-0000-0000-00000000000f') = 2, 'quem pediu recebeu os avisos');
select pg_temp.ok((select count(*) from notificacoes where tipo = 'pa_prestacao' and user_id = 'd0000000-0000-0000-0000-00000000000d') = 1, 'financeiro recebeu a escalada');
select pg_temp.ok(_pa_cobrar('e000000a-0000-0000-0000-000000000000') = 0, 'no mesmo dia não repete');

-- prorrogar (zera a escalada) e cobrar agora
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select pg_temp.falha($q$select pa_prorrogar('ad330000-0000-0000-0000-000000000001', current_date + 5, '')$q$, 'prorrogar exige motivo');
select pg_temp.falha($q$select pa_prorrogar('ad330000-0000-0000-0000-000000000004', current_date + 5, 'x')$q$, 'sem nota não tem prazo');
select pa_prorrogar('ad330000-0000-0000-0000-000000000001', current_date + 5, 'fornecedor emite na sexta');
select pg_temp.ok((select dias_restantes = 5 and origem_prazo = 'prorrogado' and not escalado from pa_prestacao('e000000a-0000-0000-0000-000000000000') where numero = 901), 'prazo prorrogado e escalada zerada');
select pa_cobrar_agora('ad330000-0000-0000-0000-000000000003', 'Bia, cobra o frete por favor');
select pg_temp.ok((select tipo = 'manual' and mensagem like 'Bia%' from pa_cobrancas where paraquedas_id = 'ad330000-0000-0000-0000-000000000003'), 'cobrança manual');
select pg_temp.falha($q$select pa_cobrar_agora('ad330000-0000-0000-0000-000000000004')$q$, 'sem nota não cobra');
reset role;

-- compras só vê os seus; leitura não cobra; outra empresa não vê
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');
select pg_temp.ok((select count(*) from pa_prestacao('e000000a-0000-0000-0000-000000000000') where numero between 901 and 904) = 2, 'compras vê só os seus');
reset role;
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.falha($q$select pa_cobrar_agora('ad330000-0000-0000-0000-000000000002')$q$, 'leitura não cobra');
select pg_temp.falha($q$select pa_cobrar_rodar('e000000a-0000-0000-0000-000000000000')$q$, 'leitura não roda a cobrança');
reset role;
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');
select pg_temp.ok((select count(*) from pa_prestacao('e000000a-0000-0000-0000-000000000000')) = 0, 'outra empresa não vê');
select pg_temp.ok((select count(*) from pa_cobrancas) = 0, 'outra empresa não lê as cobranças');
reset role;
\o
select 'pa prestacao ok';
