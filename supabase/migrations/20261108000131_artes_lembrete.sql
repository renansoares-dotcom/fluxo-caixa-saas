-- Prova de cor, lembrete ao cliente e biblioteca de artes (melhoria 4.4 do plano de melhoria contínua, Passo 4) — 08/11/2026.
-- Aditivo.
--   • prova de cor: a tela simula a arte com as tintas reais da Casa de Tintas (Lab medido) e mostra o ΔE2000 de cada
--     cor; aqui ficam só as faixas de leitura do ΔE (parâmetros da pré-impressão);
--   • lembrete automático ao cliente que não respondeu a arte (e-mail e WhatsApp), com intervalo e limite, e aviso à
--     equipe quando o limite é atingido sem resposta;
--   • biblioteca de artes por cliente com busca pelo código de barras: na tela (pre_projetos.ean já existe) + índice.

-- 1) parâmetros
alter table public.pre_parametros add column if not exists lembrete_ativo boolean not null default true;
alter table public.pre_parametros add column if not exists lembrete_apos_dias int not null default 2;       -- primeiro lembrete N dias depois do envio
alter table public.pre_parametros add column if not exists lembrete_intervalo_dias int not null default 2;  -- entre um lembrete e outro
alter table public.pre_parametros add column if not exists lembrete_max int not null default 3;             -- por versão enviada
alter table public.pre_parametros add column if not exists lembrete_avisar_equipe boolean not null default true;
alter table public.pre_parametros add column if not exists prova_de_ok numeric(4,2) not null default 2;       -- ΔE00 até aqui: aceitável
alter table public.pre_parametros add column if not exists prova_de_atencao numeric(4,2) not null default 3.5;   -- até aqui: perceptível; acima: fora
do $$ begin
  alter table public.pre_parametros add constraint pre_par_lembrete_chk check (lembrete_apos_dias between 1 and 30 and lembrete_intervalo_dias between 1 and 30 and lembrete_max between 1 and 10);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.pre_parametros add constraint pre_par_prova_chk check (prova_de_ok > 0 and prova_de_atencao > prova_de_ok and prova_de_atencao <= 20);
exception when duplicate_object then null; end $$;
create index if not exists pre_proj_ean on public.pre_projetos(empresa_id, ean) where ean is not null;

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('arte_sem_resposta', 'Comercial', 'Arte sem resposta do cliente', 'O cliente recebeu todos os lembretes e ainda não respondeu a arte.', false, 48)
on conflict (codigo) do nothing;

-- 2) modelos de mensagem (recriadas: as mesmas do SQL 128 + lembrete da arte)
create or replace function public.email_padrao()
returns table(codigo text, nome text, assunto text, corpo text, botao text, campos text)
language sql immutable set search_path = public as $$
  values
  ('portal_convite', 'Convite para o Portal do Cliente', 'Convite para o Portal do Cliente — {{empresa}}',
   E'Olá,\n\n{{empresa}} liberou para {{cliente}} o acesso ao Portal do Cliente. Nele você vê os títulos e as notas fiscais, pede prorrogação de vencimento e aprova as artes das embalagens.\n\nClique no botão para criar a sua senha. O convite vale até {{validade}}.', 'Criar meu acesso', 'empresa, cliente, validade'),
  ('arte_aprovacao', 'Arte aguardando a aprovação do cliente', 'Arte nº {{numero}} aguardando a sua aprovação — {{arte}}',
   E'Olá,\n\nA versão {{versao}} da arte {{arte}} está pronta para a sua conferência.\n\n{{observacao}}\n\nConfira textos, cores, medidas e o código de barras. No Portal você pode marcar pontos na arte, aprovar ou pedir alteração. Responda até {{prazo}}.', 'Conferir a arte', 'empresa, cliente, arte, numero, versao, observacao, prazo'),
  ('prorrogacao_resposta', 'Resposta do pedido de prorrogação', 'Pedido de prorrogação {{decisao}} — {{documento}}',
   E'Olá,\n\nO seu pedido de prorrogação do título {{documento}} foi {{decisao}}. O vencimento é {{vencimento}}.\n\n{{resposta}}', 'Abrir o Portal', 'empresa, cliente, documento, decisao, vencimento, resposta'),
  ('aviso', 'Avisos da plataforma (Meus avisos)', '{{titulo}}', E'{{texto}}', 'Abrir na plataforma', 'empresa, titulo, texto'),
  ('teste', 'E-mail de teste', 'E-mail de teste — {{empresa}}', E'Olá {{nome}},\n\nSe você recebeu esta mensagem, o e-mail da plataforma está funcionando.', null, 'empresa, nome'),
  ('entrega_saiu', 'Pedido saiu para entrega', 'Seu pedido saiu para entrega — NF {{notas}}',
   E'Olá,\n\nA mercadoria das notas {{notas}} saiu para entrega hoje, no veículo {{veiculo}}.\n\nNo Portal você acompanha a entrega e, depois, vê o canhoto assinado.', 'Acompanhar a entrega', 'empresa, cliente, notas, veiculo'),
  ('entrega_feita', 'Pedido entregue', 'Pedido entregue — NF {{nota}}',
   E'Olá,\n\nA nota {{nota}} foi entregue em {{quando}} e recebida por {{recebedor}}.\n\nO canhoto assinado fica disponível no Portal.', 'Ver o canhoto', 'empresa, cliente, nota, quando, recebedor'),
  ('cob_lembrete', 'Cobrança: lembrete antes do vencimento', 'Lembrete: título {{documento}} vence em {{vencimento}}',
   E'Olá, {{cliente}},\n\nLembramos que o título {{documento}}, no valor de {{valor}}, vence em {{vencimento}}.\n\nPara pagar com PIX, use o código copia e cola:\n{{pix}}\n\nSe já pagou, desconsidere esta mensagem.', 'Ver no Portal', 'empresa, cliente, documento, valor, vencimento, pix'),
  ('cob_vencimento', 'Cobrança: vence hoje', 'O título {{documento}} vence hoje',
   E'Olá, {{cliente}},\n\nO título {{documento}}, no valor de {{valor}}, vence hoje ({{vencimento}}).\n\nPara pagar com PIX, use o código copia e cola:\n{{pix}}\n\nSe já pagou, desconsidere esta mensagem.', 'Ver no Portal', 'empresa, cliente, documento, valor, vencimento, pix'),
  ('cob_atraso', 'Cobrança: título em atraso', 'Título {{documento}} em aberto há {{dias}} dia(s)',
   E'Olá, {{cliente}},\n\nNão identificamos o pagamento do título {{documento}}, no valor de {{valor}}, vencido em {{vencimento}} ({{dias}} dia(s) de atraso).\n\nPara pagar com PIX, use o código copia e cola:\n{{pix}}\n\nSe já pagou, por favor responda com o comprovante. Se precisar negociar, fale com o nosso financeiro.', 'Ver no Portal', 'empresa, cliente, documento, valor, vencimento, dias, pix'),
  ('reclamacao_recebida', 'Reclamação recebida pelo Portal', 'Recebemos a sua reclamação — nº {{numero}}',
   E'Olá, {{cliente}},\n\nRecebemos a sua reclamação nº {{numero}}{{nota}}. A nossa equipe da qualidade já está analisando e dá a primeira resposta até {{prazo}}.\n\nVocê acompanha a análise pelo Portal do Cliente.', 'Acompanhar', 'empresa, cliente, numero, nota, prazo'),
  ('reclamacao_resposta', 'Resposta da reclamação', 'Resposta da reclamação nº {{numero}}',
   E'Olá, {{cliente}},\n\nA nossa equipe da qualidade respondeu a sua reclamação nº {{numero}} (situação: {{situacao}}):\n\n{{resposta}}\n\nNo Portal você vê a análise completa e pode nos dizer se a resposta resolveu.', 'Ver a resposta', 'empresa, cliente, numero, situacao, resposta'),
  ('arte_lembrete', 'Lembrete: arte aguardando a aprovação', 'Lembrete: a arte nº {{numero}} aguarda a sua aprovação — {{arte}}',
   E'Olá,\n\nA versão {{versao}} da arte {{arte}} foi enviada em {{enviada}} e ainda aguarda a sua conferência.\n\nA produção da embalagem só começa depois da aprovação. No Portal você aprova ou pede alteração em poucos minutos.', 'Conferir a arte', 'empresa, cliente, arte, numero, versao, enviada');
$$;
grant execute on function public.email_padrao() to authenticated, service_role;

create or replace function public.wa_padrao()
returns table(codigo text, nome text, template text, parametros text[], botao_campo text, texto text)
language sql immutable set search_path = public as $$
  values
  ('arte_aprovacao', 'Arte aguardando a aprovação do cliente', 'arte_para_aprovar', array['empresa', 'arte', 'versao', 'prazo'], 'caminho',
   'Olá! {{1}} enviou a versão {{3}} da arte {{2}} para a sua aprovação. Responda até {{4}} pelo Portal do Cliente.'),
  ('prorrogacao_resposta', 'Resposta do pedido de prorrogação', 'resposta_prorrogacao', array['empresa', 'documento', 'decisao', 'vencimento'], 'caminho',
   'Olá! {{1}} respondeu o seu pedido de prorrogação do título {{2}}: {{3}}. O vencimento é {{4}}.'),
  ('entrega_saiu', 'Pedido saiu para entrega', 'pedido_saiu_entrega', array['empresa', 'notas', 'veiculo'], 'caminho',
   'Olá! A mercadoria das notas {{2}} de {{1}} saiu para entrega hoje, no veículo {{3}}. Acompanhe pelo Portal do Cliente.'),
  ('entrega_feita', 'Pedido entregue', 'pedido_entregue', array['empresa', 'nota', 'quando', 'recebedor'], 'caminho',
   'Olá! A nota {{2}} de {{1}} foi entregue em {{3}} e recebida por {{4}}. O canhoto está no Portal do Cliente.'),
  ('aviso', 'Avisos da plataforma (Meus avisos)', 'aviso_plataforma', array['empresa', 'titulo', 'texto'], 'caminho',
   'Aviso da plataforma {{1}}: {{2}}. {{3}}'),
  ('teste', 'Mensagem de teste', 'teste_plataforma', array['empresa', 'nome'], null,
   'Olá {{2}}! Esta é uma mensagem de teste da plataforma {{1}}. O WhatsApp está funcionando.'),
  ('cob_lembrete', 'Cobrança: lembrete antes do vencimento', 'cobranca_lembrete', array['empresa', 'documento', 'valor', 'vencimento', 'pix'], 'caminho',
   'Olá! Lembrete de {{1}}: o título {{2}}, de {{3}}, vence em {{4}}. PIX copia e cola: {{5}}. Se já pagou, desconsidere.'),
  ('cob_vencimento', 'Cobrança: vence hoje', 'cobranca_vencimento', array['empresa', 'documento', 'valor', 'pix'], 'caminho',
   'Olá! O título {{2}} de {{1}}, de {{3}}, vence hoje. PIX copia e cola: {{4}}. Se já pagou, desconsidere.'),
  ('cob_atraso', 'Cobrança: título em atraso', 'cobranca_atraso', array['empresa', 'documento', 'valor', 'vencimento', 'dias', 'pix'], 'caminho',
   'Olá! {{1}} não identificou o pagamento do título {{2}}, de {{3}}, vencido em {{4}} ({{5}} dias). PIX copia e cola: {{6}}. Se já pagou, responda com o comprovante.'),
  ('reclamacao_resposta', 'Resposta da reclamação', 'reclamacao_respondida', array['empresa', 'numero', 'situacao'], 'caminho',
   'Olá! {{1}} respondeu a sua reclamação nº {{2}} (situação: {{3}}). Veja a análise e a resposta no Portal do Cliente.'),
  ('arte_lembrete', 'Lembrete: arte aguardando a aprovação', 'arte_lembrete', array['empresa', 'arte', 'versao', 'enviada'], 'caminho',
   'Olá! A versão {{3}} da arte {{2}}, enviada por {{1}} em {{4}}, ainda aguarda a sua aprovação. A produção só começa depois dela. Confira no Portal do Cliente.');
$$;
grant execute on function public.wa_padrao() to authenticated, service_role;


-- 3) lembretes do dia: arte aguardando o cliente, versão enviada há N dias, sem lembrete recente e abaixo do limite
create or replace function public._pre_lembretes(p_hoje date default current_date)
returns int language plpgsql security definer set search_path = public as $$
declare r record; u record; n int := 0; v_campos jsonb; v_feitos int;
begin
  for r in
    select p.id, p.empresa_id, p.numero, p.nome, p.favorecido_id, f.nome cli, v.numero vnum, v.enviada_em,
           coalesce(c.lembrete_apos_dias, 2) apos, coalesce(c.lembrete_intervalo_dias, 2) intervalo, coalesce(c.lembrete_max, 3) maximo,
           coalesce(c.lembrete_avisar_equipe, true) avisar, coalesce(c.papeis_liberacao, array['admin', 'diretor', 'financeiro']) papeis,
           (select count(*) from pre_eventos e where e.projeto_id = p.id and e.tipo = 'lembrete' and e.criado_em >= v.enviada_em) feitos,
           (select max(e.criado_em) from pre_eventos e where e.projeto_id = p.id and e.tipo = 'lembrete' and e.criado_em >= v.enviada_em) ultimo
      from pre_projetos p join favorecidos f on f.id = p.favorecido_id
      left join pre_parametros c on c.empresa_id = p.empresa_id
      join lateral (select x.numero, x.enviada_em from pre_versoes x where x.projeto_id = p.id and x.enviada_em is not null order by x.numero desc limit 1) v on true
     where p.situacao = 'aguardando_cliente' and not p.arquivado and coalesce(c.lembrete_ativo, true)
  loop
    continue when (p_hoje - (r.enviada_em at time zone 'America/Sao_Paulo')::date) < r.apos;
    continue when r.feitos >= r.maximo;
    continue when r.ultimo is not null and (p_hoje - (r.ultimo at time zone 'America/Sao_Paulo')::date) < r.intervalo;
    v_campos := jsonb_build_object('cliente', r.cli, 'arte', r.nome, 'numero', r.numero, 'versao', r.vnum, 'enviada', to_char(r.enviada_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'),
                                   'caminho', 'portal.html?arte=' || r.id);
    for u in select distinct lower(email) e from portal_usuarios where favorecido_id = r.favorecido_id and ativo loop
      perform _email_enfileirar(r.empresa_id, 'arte_lembrete', u.e, v_campos, r.id);
    end loop;
    for u in select distinct whatsapp w from portal_usuarios where favorecido_id = r.favorecido_id and ativo and whatsapp is not null and whatsapp_optin_em is not null loop
      perform _wa_enfileirar(r.empresa_id, 'arte_lembrete', u.w, v_campos, r.id);
    end loop;
    v_feitos := r.feitos + 1;
    insert into pre_eventos(empresa_id, projeto_id, tipo, texto, publico, autor)
    values (r.empresa_id, r.id, 'lembrete', 'Lembrete ' || v_feitos || ' de ' || r.maximo || ' enviado ao cliente (versão ' || r.vnum || ')', false, 'plataforma');
    if v_feitos >= r.maximo and r.avisar then
      perform _notificar_u(r.empresa_id, _usuarios_papel(r.empresa_id, r.papeis), 'arte_sem_resposta', 'Arte nº ' || r.numero || ' sem resposta do cliente',
        r.cli || ' — ' || r.nome || ': ' || r.maximo || ' lembrete(s) enviados. Ligue para o cliente.', '#/preimpressao/artes?abrir=' || r.id, r.id, false);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public._pre_lembretes(date) from public, anon, authenticated;

-- lembrete na hora, pela ficha da arte (conta no limite)
create or replace function public.pre_lembrar_agora(p_projeto uuid)
returns int language plpgsql security definer set search_path = public as $$
declare p pre_projetos; v pre_versoes; n int := 0; u record; v_campos jsonb;
begin
  select * into p from pre_projetos where id = p_projeto;
  if p.id is null or not pre_pode(p.empresa_id, p.favorecido_id) then raise exception 'Acesso negado.'; end if;
  if p.situacao <> 'aguardando_cliente' then raise exception 'A arte não está aguardando o cliente.'; end if;
  select * into v from pre_versoes where projeto_id = p.id and enviada_em is not null order by numero desc limit 1;
  if v.id is null then raise exception 'Nenhuma versão foi enviada ao cliente.'; end if;
  if exists (select 1 from pre_eventos where projeto_id = p.id and tipo = 'lembrete' and criado_em > now() - interval '12 hours') then
    raise exception 'Já foi enviado um lembrete nas últimas 12 horas.'; end if;
  v_campos := jsonb_build_object('cliente', (select nome from favorecidos where id = p.favorecido_id), 'arte', p.nome, 'numero', p.numero, 'versao', v.numero,
                                 'enviada', to_char(v.enviada_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), 'caminho', 'portal.html?arte=' || p.id);
  for u in select distinct lower(email) e from portal_usuarios where favorecido_id = p.favorecido_id and ativo loop
    perform _email_enfileirar(p.empresa_id, 'arte_lembrete', u.e, v_campos, p.id); n := n + 1;
  end loop;
  for u in select distinct whatsapp w from portal_usuarios where favorecido_id = p.favorecido_id and ativo and whatsapp is not null and whatsapp_optin_em is not null loop
    perform _wa_enfileirar(p.empresa_id, 'arte_lembrete', u.w, v_campos, p.id); n := n + 1;
  end loop;
  insert into pre_eventos(empresa_id, projeto_id, tipo, texto, publico)
  values (p.empresa_id, p.id, 'lembrete', 'Lembrete enviado na hora ao cliente (versão ' || v.numero || ', ' || n || ' mensagem(ns))', false);
  return n;
end $$;
revoke all on function public.pre_lembrar_agora(uuid) from public, anon;
grant execute on function public.pre_lembrar_agora(uuid) to authenticated;

-- 4) agendamento: todo dia às 9h20 (12h20 UTC)
do $$
begin
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron indisponível (%).', sqlerrm; return; end;
  perform cron.unschedule(jobid) from cron.job where jobname = 'pre-lembretes';
  perform cron.schedule('pre-lembretes', '20 12 * * *', $job$ select public._pre_lembretes(); $job$);
exception when others then raise notice 'agendamento dos lembretes não criado: %', sqlerrm;
end $$;

select (select count(*) from information_schema.columns where table_name = 'pre_parametros' and (column_name like 'lembrete_%' or column_name like 'prova_%')) as parametros;
