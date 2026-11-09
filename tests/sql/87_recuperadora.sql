-- Recuperadora parte 1 (SQL 151): ticket da balança com desconto pela classe e preço por vigência, tolerância do peso, lotes de entrada,
-- título a pagar, abatimento do adiantamento, cancelamento que desfaz tudo, aparas internas automáticas (regras, alteração, exclusão),
-- importação da planilha da balança, relação para a nota de entrada, painel e permissões.
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
insert into auth.users(id, email) values ('87000000-0000-0000-0000-0000000000aa', 'balanca.a@exemplo.com');
insert into membros(empresa_id, user_id, papel) values (:E, '87000000-0000-0000-0000-0000000000aa', 'producao');
insert into plano_contas(id, empresa_id, codigo, nome, natureza, nivel, tipo) values
  ('87000000-0000-0000-0000-0000000000f1', :E, '2.01.87', 'COMPRA DE RECICLÁVEL', 'D', 2, 'S'),
  ('87000000-0000-0000-0000-0000000000f2', :E, '2.01.88', 'ADIANTAMENTO A FORNECEDOR', 'D', 2, 'S');
insert into favorecidos(id, empresa_id, tipo, nome, documento, rec_tipo, rec_coletor_incentivado) values
  ('87000000-0000-0000-0000-0000000000b1', :E, 'FORNECEDORES', 'JOÃO CATADOR 87', '123.456.789-09', 'catador_pf', true),
  ('87000000-0000-0000-0000-0000000000b2', :E, 'FORNECEDORES', 'SUCATAS 87 LTDA', '11.222.333/0001-81', 'sucateiro_pj', false);
insert into prod_setores(id, empresa_id, nome) values ('87000000-0000-0000-0000-0000000000c1', :E, 'Extrusão 87'), ('87000000-0000-0000-0000-0000000000c2', :E, 'Recuperadora 87');
insert into prod_ordens(id, empresa_id, numero, quantidade) values ('87000000-0000-0000-0000-0000000000d1', :E, 98701, 1000);

select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select public.rec_configurar_padrao(:E);
select pg_temp.ok((select count(*) from rec_classes where empresa_id = :E) = 3, 'classes A, B e C');
insert into rec_materiais(id, empresa_id, codigo, nome, polimero, condicao, ncm) values
  ('87000000-0000-0000-0000-0000000000e1', :E, 'PEBD-T', 'Filme PEBD transparente', 'PEBD', 'sujo', '39151000'),
  ('87000000-0000-0000-0000-0000000000e2', :E, 'PP-C', 'PP colorido', 'PP', 'misto', null),
  ('87000000-0000-0000-0000-0000000000e3', :E, 'AP-PEBD', 'Apara PEBD interna', 'PEBD', 'limpo', null);
insert into rec_precos(empresa_id, material_id, classe_id, vigencia, preco_kg) values
  (:E, '87000000-0000-0000-0000-0000000000e1', null, '2026-01-01', 1.50),
  (:E, '87000000-0000-0000-0000-0000000000e1', null, '2026-11-01', 1.80),
  (:E, '87000000-0000-0000-0000-0000000000e1', (select id from rec_classes where empresa_id = :E and codigo = 'A'), '2026-11-01', 2.20),
  (:E, '87000000-0000-0000-0000-0000000000e2', null, '2026-01-01', 1.00);
select pg_temp.ok(public.rec_preco('87000000-0000-0000-0000-0000000000e1', (select id from rec_classes where empresa_id = :E and codigo = 'B'), '2026-11-05') = 1.80, 'preço geral vigente');
select pg_temp.ok(public.rec_preco('87000000-0000-0000-0000-0000000000e1', (select id from rec_classes where empresa_id = :E and codigo = 'A'), '2026-11-05') = 2.20, 'preço da classe vence');
select pg_temp.ok(public.rec_preco('87000000-0000-0000-0000-0000000000e1', null, '2026-10-05') = 1.50, 'vigência anterior');
update rec_config set modo = 'ambos', plano_compra_id = '87000000-0000-0000-0000-0000000000f1', plano_adiantamento_id = '87000000-0000-0000-0000-0000000000f2', prazo_pagamento_dias = 2,
  apara_material_padrao_id = '87000000-0000-0000-0000-0000000000e3', apara_custo_kg = 0.5 where empresa_id = :E;

-- adiantamento ao catador
select public.rec_adiantamento_lancar(:E, '87000000-0000-0000-0000-0000000000b1', '2026-11-03', 100, 'vale da semana');
select pg_temp.ok((select count(*) from lancamentos where empresa_id = :E and origem = 'recuperadora' and documento = 'REC ADT' and valor = 100 and status = 'Em aberto') = 1, 'adiantamento gera título');

-- ticket pela balança (operador da balança)
select pg_temp.entrar('87000000-0000-0000-0000-0000000000aa');
insert into rec_tickets(id, empresa_id, data_hora, fornecedor_id, placa, peso_bruto, tara) values
  ('87000000-0000-0000-0000-000000000a01', :E, '2026-11-05 10:00-03', '87000000-0000-0000-0000-0000000000b1', 'abc-1d23', 2500, 1500);
select pg_temp.ok((select numero = 1 and peso_liquido = 1000 and placa = 'ABC1D23' from rec_tickets where id = '87000000-0000-0000-0000-000000000a01'), 'número, líquido e placa');
insert into rec_ticket_itens(empresa_id, ticket_id, material_id, classe_id, peso_kg) values
  (:E, '87000000-0000-0000-0000-000000000a01', '87000000-0000-0000-0000-0000000000e1', (select id from rec_classes where empresa_id = :E and codigo = 'B'), 700),
  (:E, '87000000-0000-0000-0000-000000000a01', '87000000-0000-0000-0000-0000000000e2', null, 290);
select pg_temp.ok((select count(*) from rec_ticket_itens where ticket_id = '87000000-0000-0000-0000-000000000a01') = 2, 'itens');
-- 990 kg × 1000 kg: tolerância de 1 kg
select pg_temp.falha($$select public.rec_ticket_fechar('87000000-0000-0000-0000-000000000a01')$$, 'soma fora da tolerância');
update rec_ticket_itens set peso_kg = 300 where ticket_id = '87000000-0000-0000-0000-000000000a01' and material_id = '87000000-0000-0000-0000-0000000000e2';
-- desconto acima do máximo: operador não fecha
update rec_ticket_itens set desconto_pct = 40 where ticket_id = '87000000-0000-0000-0000-000000000a01' and material_id = '87000000-0000-0000-0000-0000000000e2';
select pg_temp.falha($$select public.rec_ticket_fechar('87000000-0000-0000-0000-000000000a01')$$, 'desconto acima do máximo');
update rec_ticket_itens set desconto_pct = null where ticket_id = '87000000-0000-0000-0000-000000000a01' and material_id = '87000000-0000-0000-0000-0000000000e2';
select public.rec_ticket_fechar('87000000-0000-0000-0000-000000000a01');
-- 700 × (1 − 8%) = 644 kg × 1,80 = 1.159,20 ; 300 kg × 1,00 = 300,00 → 1.459,20; abate 100 → 1.359,20
select pg_temp.ok((select situacao = 'fechado' and total = 1459.20 and abatido = 100 from rec_tickets where id = '87000000-0000-0000-0000-000000000a01'), 'total e abatimento');
select pg_temp.ok((select peso_kg = 644 and saldo_kg = 644 and custo_total = 1159.20 and codigo = 'LE1-1' from rec_lotes where ticket_item_id in (select id from rec_ticket_itens where material_id = '87000000-0000-0000-0000-0000000000e1')), 'lote com desconto da classe B');
reset role;
select pg_temp.ok((select valor = 1359.20 and data = '2026-11-07' and status = 'Em aberto' from lancamentos l join rec_tickets t on t.lancamento_id = l.id where t.id = '87000000-0000-0000-0000-000000000a01'), 'título a pagar com prazo');
select pg_temp.ok((select situacao = 'quitado' from rec_adiantamentos where empresa_id = :E), 'adiantamento quitado');
select pg_temp.entrar('87000000-0000-0000-0000-0000000000aa');
select pg_temp.ok((select count(*) from rec_tickets where id = '87000000-0000-0000-0000-000000000a01' and placa = 'ABC1D23') = 1, 'placa intacta');
update rec_tickets set placa = 'X' where id = '87000000-0000-0000-0000-000000000a01';
select pg_temp.ok((select placa = 'ABC1D23' from rec_tickets where id = '87000000-0000-0000-0000-000000000a01'), 'fechado não muda');
select pg_temp.falha($$select public.rec_ticket_cancelar('87000000-0000-0000-0000-000000000a01', 'pesagem errada')$$, 'operador não cancela fechado');

-- cancelar desfaz lotes, título e abatimento
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
select public.rec_ticket_cancelar('87000000-0000-0000-0000-000000000a01', 'pesagem errada');
select pg_temp.ok((select count(*) from rec_lotes where empresa_id = :E and tipo = 'entrada' and situacao = 'cancelado') = 2, 'lotes cancelados');
select pg_temp.ok((select count(*) from lancamentos where empresa_id = :E and documento = 'REC 1') = 0, 'título excluído');
select pg_temp.ok((select situacao = 'aberto' from rec_adiantamentos where empresa_id = :E) and (select count(*) from rec_adiant_abatimentos) = 0, 'adiantamento volta a abrir');

-- aparas internas
insert into rec_apara_regras(empresa_id, setor_id, ignorar) values (:E, '87000000-0000-0000-0000-0000000000c2', true);
insert into prod_apontamentos(id, empresa_id, ordem_id, setor_id, inicio, fim, refugo) values
  ('87000000-0000-0000-0000-000000000b01', :E, '87000000-0000-0000-0000-0000000000d1', '87000000-0000-0000-0000-0000000000c1', '2026-11-06 08:00-03', '2026-11-06 12:00-03', 35),
  ('87000000-0000-0000-0000-000000000b02', :E, '87000000-0000-0000-0000-0000000000d1', '87000000-0000-0000-0000-0000000000c1', '2026-11-06 13:00-03', '2026-11-06 15:00-03', 15),
  ('87000000-0000-0000-0000-000000000b03', :E, '87000000-0000-0000-0000-0000000000d1', '87000000-0000-0000-0000-0000000000c2', '2026-11-06 13:00-03', '2026-11-06 15:00-03', 40),
  ('87000000-0000-0000-0000-000000000b04', :E, '87000000-0000-0000-0000-0000000000d1', '87000000-0000-0000-0000-0000000000c1', '2026-11-06 16:00-03', null, 9);
select pg_temp.ok((select peso_kg = 50 and saldo_kg = 50 and custo_total = 25 and codigo = 'AP-261106-AP-PEBD' from rec_lotes where empresa_id = :E and tipo = 'apara'), 'lote de apara do dia (setor ignorado, aberto fora)');
update prod_apontamentos set refugo = 20 where id = '87000000-0000-0000-0000-000000000b01';
update prod_apontamentos set fim = '2026-11-06 17:00-03' where id = '87000000-0000-0000-0000-000000000b04';
select pg_temp.ok((select peso_kg = 44 from rec_lotes where empresa_id = :E and tipo = 'apara'), 'alteração e encerramento refazem');
delete from prod_apontamentos where id = '87000000-0000-0000-0000-000000000b02';
select pg_temp.ok((select peso_kg = 29 from rec_lotes where empresa_id = :E and tipo = 'apara'), 'exclusão tira do lote');
insert into rec_apara_regras(empresa_id, setor_id, material_id) values (:E, '87000000-0000-0000-0000-0000000000c1', '87000000-0000-0000-0000-0000000000e1');
select pg_temp.ok((public.rec_aparas_reprocessar(:E, '2026-11-01') ->> 'kg')::numeric = 29, 'reprocessar com a regra nova');
select pg_temp.ok((select coalesce(sum(saldo_kg), 0) from rec_lotes where empresa_id = :E and tipo = 'apara' and material_id = '87000000-0000-0000-0000-0000000000e3') = 0
              and (select sum(saldo_kg) from rec_lotes where empresa_id = :E and tipo = 'apara' and material_id = '87000000-0000-0000-0000-0000000000e1') = 29, 'apara vai para o material da regra');

-- importação da planilha da balança
select pg_temp.entrar('87000000-0000-0000-0000-0000000000aa');
select pg_temp.ok((public.rec_tickets_importar(:E, '[{"chave":"b1","data_hora":"2026-11-08T09:00:00-03:00","fornecedor":"11222333000181","peso_bruto":"1800","tara":"1000","material":"pp-c"},
   {"chave":"b2","fornecedor":"Ninguém 87","peso_liquido":"10"},{"chave":"b3","data_hora":"2026-11-08T11:00:00-03:00","fornecedor":"joão catador 87","peso_liquido":"120","material":"PEBD-T","classe":"A"}]'::jsonb) ->> 'criados')::int = 2, 'importa 2 e rejeita fornecedor desconhecido');
select pg_temp.ok((public.rec_tickets_importar(:E, '[{"chave":"b1","fornecedor":"11222333000181","peso_liquido":"1"}]'::jsonb) ->> 'repetidos')::int = 1, 'não importa duas vezes');
select public.rec_ticket_fechar(id) from rec_tickets where empresa_id = :E and chave_importacao in ('b1', 'b3');
select pg_temp.ok((select total = 258.72 from rec_tickets where chave_importacao = 'b3'), 'classe A: 120 × 98% × 2,20');
select pg_temp.ok(jsonb_array_length(public.rec_relacao_nota(:E, '2026-11-01', '2026-11-30')) = 2, 'relação para a nota de entrada');
select public.rec_ticket_nota(id, '123') from rec_tickets where chave_importacao = 'b1';
select pg_temp.ok(jsonb_array_length(public.rec_relacao_nota(:E, '2026-11-01', '2026-11-30')) = 1, 'com nota sai da relação');
select pg_temp.falha($$select public.rec_ticket_nota(id, '1', '123') from rec_tickets where chave_importacao = 'b3'$$, 'chave inválida');
select pg_temp.ok((public.rec_painel(:E, '2026-11-01') ->> 'comprado_kg')::numeric = 920 and (public.rec_painel(:E, '2026-11-01') ->> 'apara_kg')::numeric = 29, 'painel do mês');

-- permissões
select pg_temp.entrar('f0000000-0000-0000-0000-00000000000f');   -- compras: não opera a balança
select pg_temp.falha($$insert into rec_tickets(empresa_id) values ('e000000a-0000-0000-0000-000000000000')$$, 'compras não abre ticket');
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');   -- leitura
select pg_temp.ok((select count(*) from rec_tickets where empresa_id = :E) = 3, 'leitura vê');
select pg_temp.falha($$select public.rec_adiantamento_lancar('e000000a-0000-0000-0000-000000000000', '87000000-0000-0000-0000-0000000000b1', current_date, 10)$$, 'leitura não adianta');
select pg_temp.entrar('b0000000-0000-0000-0000-00000000000b');   -- outra empresa
select pg_temp.ok((select count(*) from rec_tickets) = 0 and (select count(*) from rec_lotes) = 0, 'isolamento');
select pg_temp.falha($$select public.rec_painel('e000000a-0000-0000-0000-000000000000', '2026-11-01')$$, 'painel de outra empresa');
reset role;
\o
select 'ok 87 recuperadora entradas';
