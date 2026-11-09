-- Relatórios agendados (SQL 138): fonte saldos, períodos relativos, próximo envio, prévia, envio com o acesso do dono, e-mail, permissões.
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
-- períodos (hoje = quarta 11/11/2026)
select pg_temp.ok((select de = '2026-11-10' and ate = '2026-11-10' from public._rel_periodo('ontem', '2026-11-11')), 'ontem');
select pg_temp.ok((select de = '2026-11-02' and ate = '2026-11-08' from public._rel_periodo('semana_passada', '2026-11-11')), 'semana passada seg–dom');
select pg_temp.ok((select de = '2026-10-01' and ate = '2026-10-31' from public._rel_periodo('mes_anterior', '2026-11-11')), 'mês anterior');
select pg_temp.ok((select de = '2025-12-01' and ate = '2026-11-11' from public._rel_periodo('ultimos_12_meses', '2026-11-11')), '12 meses');
select pg_temp.ok((select de = '2026-11-11' and ate = '2026-11-17' from public._rel_periodo('proximos_7', '2026-11-11')), 'próximos 7');
-- próximo envio (Recife = UTC−3)
select pg_temp.ok(public._rel_proximo('semanal', 1, 1, 8, '2026-11-11 15:00-03') = '2026-11-16 08:00-03', 'segunda 8h');
select pg_temp.ok(public._rel_proximo('dias_uteis', 1, 1, 8, '2026-11-13 09:00-03') = '2026-11-16 08:00-03', 'sexta depois das 8 → segunda');
select pg_temp.ok(public._rel_proximo('diaria', 1, 1, 8, '2026-11-11 07:00-03') = '2026-11-11 08:00-03', 'hoje ainda');
select pg_temp.ok(public._rel_proximo('mensal', 1, 5, 7, '2026-11-11 10:00-03') = '2026-12-05 07:00-03', 'dia 5 do mês seguinte');
-- formatos
select pg_temp.ok(public._rel_fmt(1234.5, 'valor') = 'R$ 1.234,50' and public._rel_fmt(15200, 'kg') = '15.200 kg' and public._rel_fmt(3.46, 'refugo_pct') = '3,5%' and public._rel_chave('2026-03', 'mes') = 'mar/2026', 'formatos');

-- dados: conta com saldo e títulos
insert into contas(id, empresa_id, nome, saldo_inicial, ativo) values ('74000000-0000-0000-0000-0000000000c1', :E, 'BANCO REL 74', 1000, true);
insert into lancamentos(empresa_id, data, plano_id, valor, descricao, conta_id, status) values
  (:E, current_date - 1, 'f000000a-0000-0000-0000-000000000000', 250, 'REL74 a', '74000000-0000-0000-0000-0000000000c1', 'Pago'),
  (:E, current_date + 3, 'f000000a-0000-0000-0000-000000000000', 400, 'REL74 b', '74000000-0000-0000-0000-0000000000c1', 'Em aberto');
select pg_temp.entrar('d0000000-0000-0000-0000-00000000000d');   -- financeiro
create temp table s as select public.ia_consultar(:E, 'saldos', 'saldo', 'conta', '{"conta":"REL 74"}') j;
select pg_temp.ok((select (j -> 'linhas' -> 0 ->> 0) = 'BANCO REL 74' and j ->> 'link' = '#/fluxo-diario' from s), 'fonte saldos');
select pg_temp.ok((select abs((j -> 'linhas' -> 0 ->> 1)::numeric) in (1250, 750) from s), 'saldo inicial + pago');
select pg_temp.ok((select (public.ia_consultar(:E, 'saldos', 'a_pagar', null, '{"conta":"REL 74"}') -> 'linhas' -> 0 ->> 1)::numeric + (public.ia_consultar(:E, 'saldos', 'a_receber', null, '{"conta":"REL 74"}') -> 'linhas' -> 0 ->> 1)::numeric = 400), 'em aberto');
-- prévia
create temp table p as select public.rel_previa(:E, '[{"titulo":"Saldo","fonte":"saldos","metrica":"saldo","agrupar":"conta","filtros":{"conta":"REL 74"},"periodo":"hoje"},
  {"fonte":"lancamentos","metrica":"valor","agrupar":"status","filtros":{"texto":"REL74"},"periodo":"proximos_30"},
  {"fonte":"inventada","metrica":"x"}]') j;
select pg_temp.ok((select jsonb_array_length(j) = 3 and j -> 0 ->> 'titulo' = 'Saldo' and j -> 0 -> 'linhas' -> 0 ->> 1 like 'R$ %' from p), 'prévia formatada');
select pg_temp.ok((select j -> 1 -> 'linhas' = '[["Em aberto", "R$ 400,00"]]'::jsonb and j -> 1 ->> 'periodo' like 'próximos 30 dias (%' from p), 'período relativo');
select pg_temp.ok((select j -> 2 ? 'erro' from p), 'bloco errado vira erro, não derruba');
-- cadastro
insert into rel_agendados(id, empresa_id, nome, blocos, frequencia, hora, destinatarios) values
  ('74000000-0000-0000-0000-0000000000a1', :E, 'Posição de caixa', '[{"titulo":"Saldo","fonte":"saldos","metrica":"saldo","agrupar":"conta","periodo":"hoje"}]', 'diaria', 8, array['dir@t.com', 'fin@t.com']);
select pg_temp.ok((select proximo_envio > now() and criado_por = 'd0000000-0000-0000-0000-00000000000d' from rel_agendados where id = '74000000-0000-0000-0000-0000000000a1'), 'próximo envio calculado');
select pg_temp.falha($$insert into rel_agendados(empresa_id, nome, blocos, destinatarios) values ('e000000a-0000-0000-0000-000000000000', 'X ruim', '[{"fonte":"notas"}]', array['a@t.com'])$$, 'bloco sem medida');
select pg_temp.falha($$insert into rel_agendados(empresa_id, nome, blocos, destinatarios) values ('e000000a-0000-0000-0000-000000000000', 'X ruim', '[{"fonte":"notas","metrica":"valor"}]', array['sem-arroba'])$$, 'e-mail inválido');
select pg_temp.ok((select public.rel_enviar_agora('74000000-0000-0000-0000-0000000000a1') = 2), 'enviar agora: 2 e-mails');
-- leitura não vê nem envia
select pg_temp.entrar('c0000000-0000-0000-0000-00000000000c');
select pg_temp.ok((select count(*) = 0 from rel_agendados), 'leitura não vê');
select pg_temp.falha($$select public.rel_enviar_agora('74000000-0000-0000-0000-0000000000a1')$$, 'leitura não envia');
select pg_temp.falha($$select public.rel_previa('e000000a-0000-0000-0000-000000000000', '[]')$$, 'leitura não monta');
reset role;
select pg_temp.ok((select count(*) = 2 and bool_and(codigo = 'relatorio_agendado') and bool_and(jsonb_array_length(campos -> 'tabelas') = 1) and bool_and(campos ->> 'frequencia' = 'todo dia')
                     from email_fila where ref_id = '74000000-0000-0000-0000-0000000000a1'), 'na fila com as tabelas');
select pg_temp.ok((select count(*) = 1 and bool_and(manual) and bool_and(erro is null) from rel_envios where rel_id = '74000000-0000-0000-0000-0000000000a1'), 'envio registrado');
-- agendamento: vencido sai e reprograma; dono sem acesso registra erro e não envia
update rel_agendados set proximo_envio = now() - interval '1 minute' where id = '74000000-0000-0000-0000-0000000000a1';
select public._rel_agendados();
select pg_temp.ok((select count(*) = 4 from email_fila where ref_id = '74000000-0000-0000-0000-0000000000a1'), 'agendado enviou');
select pg_temp.ok((select proximo_envio > now() from rel_agendados where id = '74000000-0000-0000-0000-0000000000a1'), 'reprogramado');
update membros set papel = 'leitura' where user_id = 'd0000000-0000-0000-0000-00000000000d' and empresa_id = :E;
update rel_agendados set proximo_envio = now() - interval '1 minute' where id = '74000000-0000-0000-0000-0000000000a1';
select public._rel_agendados();
select pg_temp.ok((select ultimo_erro like 'Quem criou%' from rel_agendados where id = '74000000-0000-0000-0000-0000000000a1'), 'dono sem acesso');
select pg_temp.ok((select count(*) = 4 from email_fila where ref_id = '74000000-0000-0000-0000-0000000000a1'), 'não enviou');
update membros set papel = 'financeiro' where user_id = 'd0000000-0000-0000-0000-00000000000d' and empresa_id = :E;
-- o admin edita e salva: passa a ser o dono e o erro sai
select pg_temp.entrar('a0000000-0000-0000-0000-00000000000a');
update rel_agendados set hora = 9 where id = '74000000-0000-0000-0000-0000000000a1';
reset role;
select pg_temp.ok((select criado_por = 'a0000000-0000-0000-0000-00000000000a' and ultimo_erro is null from rel_agendados where id = '74000000-0000-0000-0000-0000000000a1'), 'quem salvou vira dono');
select pg_temp.ok((select count(*) = 1 from email_padrao() where codigo = 'relatorio_agendado'), 'modelo de e-mail');
\o
select 'ok 74 relatórios agendados';
