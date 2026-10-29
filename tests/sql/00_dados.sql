-- Dados FICTÍCIOS para os testes de banco: duas empresas, cada uma com um administrador, e um usuário de leitura na A.
insert into auth.users(id, email) values
  ('a0000000-0000-0000-0000-00000000000a', 'admin.a@exemplo.com'),
  ('b0000000-0000-0000-0000-00000000000b', 'admin.b@exemplo.com'),
  ('c0000000-0000-0000-0000-00000000000c', 'leitura.a@exemplo.com'),
  ('d0000000-0000-0000-0000-00000000000d', 'financeiro.a@exemplo.com');
insert into empresas(id, nome) values ('e000000a-0000-0000-0000-000000000000', 'Empresa A'), ('e000000b-0000-0000-0000-000000000000', 'Empresa B');
insert into membros(empresa_id, user_id, papel) values
  ('e000000a-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-00000000000a', 'admin'),
  ('e000000b-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-00000000000b', 'admin'),
  ('e000000a-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-00000000000c', 'leitura'),
  ('e000000a-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-00000000000d', 'financeiro');
insert into plano_contas(id, empresa_id, codigo, nome, natureza, nivel, tipo) values
  ('f000000a-0000-0000-0000-000000000000', 'e000000a-0000-0000-0000-000000000000', '2.05.09', 'DESPESA TESTE', 'D', 2, 'S'),
  ('f000000b-0000-0000-0000-000000000000', 'e000000b-0000-0000-0000-000000000000', '2.05.09', 'DESPESA TESTE', 'D', 2, 'S');
insert into contas(id, empresa_id, nome) values
  ('c000000a-0000-0000-0000-000000000000', 'e000000a-0000-0000-0000-000000000000', 'Banco A'),
  ('c000000b-0000-0000-0000-000000000000', 'e000000b-0000-0000-0000-000000000000', 'Banco B');
insert into lancamentos(empresa_id, data, plano_id, conta_id, valor, descricao) values
  ('e000000a-0000-0000-0000-000000000000', '2026-10-01', 'f000000a-0000-0000-0000-000000000000', 'c000000a-0000-0000-0000-000000000000', 100, 'lançamento da A'),
  ('e000000b-0000-0000-0000-000000000000', '2026-10-01', 'f000000b-0000-0000-0000-000000000000', 'c000000b-0000-0000-0000-000000000000', 200, 'lançamento da B');

