-- Reclamação do cliente pelo Portal e certificado de qualidade (melhoria 6.6 do plano de melhoria contínua, Passo 4) — 08/11/2026.
-- Aditivo.
--   • o cliente abre a reclamação no Portal (nota, produto, lote, quantidade, descrição e fotos): vira uma RNC de origem
--     "cliente", com o prazo da primeira resposta e o aviso à equipe da qualidade;
--   • o cliente acompanha a RNC em 8 passos (8D) e recebe a resposta por e-mail e WhatsApp; aceita ou não a resposta;
--   • certificado de qualidade da NF-e: bobinas expedidas na nota, OPs e as inspeções aprovadas, com a declaração e o
--     responsável configurados — baixado pela equipe (Rastreabilidade) e pelo cliente (Portal).

-- 1) parâmetros (na tela da Qualidade)
alter table public.qual_parametros add column if not exists portal_reclamacao boolean not null default true;          -- aceitar reclamações pelo Portal
alter table public.qual_parametros add column if not exists portal_prazo_resposta_dias int not null default 2;         -- primeira resposta (contenção) em dias úteis corridos
alter table public.qual_parametros add column if not exists portal_mostrar_8d boolean not null default true;           -- o cliente vê a análise (8D)
alter table public.qual_parametros add column if not exists portal_papeis_aviso text[] not null default array['admin', 'diretor', 'producao'];
alter table public.qual_parametros add column if not exists certificado_ativo boolean not null default true;
alter table public.qual_parametros add column if not exists certificado_responsavel text;
alter table public.qual_parametros add column if not exists certificado_cargo text;
alter table public.qual_parametros add column if not exists certificado_texto text not null
  default 'Declaramos que os produtos desta nota fiscal foram fabricados e inspecionados conforme os planos de inspeção da empresa e atendem às especificações acordadas.';
do $$ begin
  alter table public.qual_parametros add constraint qual_par_portal_prazo_chk check (portal_prazo_resposta_dias between 0 and 30);
exception when duplicate_object then null; end $$;

-- 2) RNC: o que veio do cliente e o 8D
alter table public.qual_rnc add column if not exists nota_id uuid references public.nfe_notas(id) on delete set null;
alter table public.qual_rnc add column if not exists portal_user_id uuid;
alter table public.qual_rnc add column if not exists portal_visivel boolean not null default false;   -- o cliente acompanha no Portal
alter table public.qual_rnc add column if not exists lote_cliente text;                                -- lote/bobina informado pelo cliente
alter table public.qual_rnc add column if not exists produto_cliente text;                             -- item da nota como o cliente descreveu
alter table public.qual_rnc add column if not exists quantidade_cliente numeric(18,4);                 -- quantidade com problema, como o cliente informou
alter table public.qual_rnc add column if not exists unidade_cliente text;
alter table public.qual_rnc add column if not exists prazo_resposta date;                              -- primeira resposta ao cliente
alter table public.qual_rnc add column if not exists equipe text;                                      -- D1
alter table public.qual_rnc add column if not exists prevencao text;                                   -- D7
alter table public.qual_rnc add column if not exists resposta_cliente text;                            -- D8 / mensagem ao cliente
alter table public.qual_rnc add column if not exists respondida_em timestamptz;
alter table public.qual_rnc add column if not exists respondida_por text;
alter table public.qual_rnc add column if not exists cliente_aceite text;
alter table public.qual_rnc add column if not exists cliente_comentario text;
alter table public.qual_rnc add column if not exists cliente_avaliou_em timestamptz;
do $$ begin
  alter table public.qual_rnc add constraint qual_rnc_aceite_chk check (cliente_aceite is null or cliente_aceite in ('aceita', 'nao_aceita'));
exception when duplicate_object then null; end $$;
create index if not exists qual_rnc_portal on public.qual_rnc(favorecido_id) where portal_visivel;
alter table public.qual_anexos add column if not exists portal_visivel boolean not null default false;  -- o cliente vê (as fotos dele, por exemplo)

-- 3) avisos
insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('qual_reclamacao', 'Qualidade', 'Reclamação de cliente pelo Portal', 'Um cliente abriu uma reclamação pelo Portal: a RNC já está aberta.', false, 62),
       ('qual_reclamacao_avaliacao', 'Qualidade', 'Cliente avaliou a resposta da reclamação', 'O cliente aceitou ou não a resposta dada à reclamação.', false, 63)
on conflict (codigo) do nothing;

-- 4) fotos do cliente: qualidade/<empresa>/portal/<pasta>/<arquivo>
create or replace function public._portal_qual_arquivo(p_nome text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from qual_anexos a join qual_rnc r on r.id = a.rnc_id
                  where a.caminho = p_nome and a.portal_visivel and r.portal_visivel and portal_meu(r.favorecido_id));
$$;
revoke all on function public._portal_qual_arquivo(text) from public, anon;
grant execute on function public._portal_qual_arquivo(text) to authenticated;
drop policy if exists qualidade_portal_ins on storage.objects;
drop policy if exists qualidade_portal_sel on storage.objects;
create policy qualidade_portal_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'qualidade' and (storage.foldername(name))[2] = 'portal'
              and exists (select 1 from public.portal_usuarios pu where pu.user_id = auth.uid() and pu.ativo
                            and pu.empresa_id = public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy qualidade_portal_sel on storage.objects for select to authenticated
  using (bucket_id = 'qualidade' and public._portal_qual_arquivo(name));

-- 5) modelos de mensagem (recriadas: as mesmas do SQL 126 + reclamação recebida e respondida)
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
   E'Olá, {{cliente}},\n\nA nossa equipe da qualidade respondeu a sua reclamação nº {{numero}} (situação: {{situacao}}):\n\n{{resposta}}\n\nNo Portal você vê a análise completa e pode nos dizer se a resposta resolveu.', 'Ver a resposta', 'empresa, cliente, numero, situacao, resposta');
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
   'Olá! {{1}} respondeu a sua reclamação nº {{2}} (situação: {{3}}). Veja a análise e a resposta no Portal do Cliente.');
$$;
grant execute on function public.wa_padrao() to authenticated, service_role;

-- 6) uso do Portal: abas e documento novos
do $$ begin
  alter table public.portal_eventos drop constraint if exists portal_eventos_tipo_check;
  alter table public.portal_eventos add constraint portal_eventos_tipo_check check (tipo in ('entrada', 'titulos', 'notas', 'entregas', 'compras', 'pedidos', 'artes', 'danfe', 'xml', 'boleto', 'pix', 'canhoto', 'reclamacoes', 'certificado'));
end $$;

-- 7) Portal: o que o cliente pode fazer
create or replace function public.portal_qualidade_cfg(p_fav uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('reclamacao', coalesce(p.portal_reclamacao, true), 'mostrar_8d', coalesce(p.portal_mostrar_8d, true), 'certificado', coalesce(p.certificado_ativo, true),
                            'abertas', (select count(*) from qual_rnc r where r.favorecido_id = f.id and r.portal_visivel and r.situacao not in ('encerrada', 'cancelada')))
  from favorecidos f left join qual_parametros p on p.empresa_id = f.empresa_id
  where f.id = p_fav and portal_meu(p_fav);
$$;
revoke all on function public.portal_qualidade_cfg(uuid) from public, anon;
grant execute on function public.portal_qualidade_cfg(uuid) to authenticated;

-- abre a reclamação: RNC de origem cliente, fotos e avisos; devolve o número
create or replace function public.portal_reclamar(p_fav uuid, p_nota uuid, p_produto text, p_lote text, p_quantidade numeric, p_unidade text,
                                                 p_descricao text, p_fotos text[] default '{}')
returns int language plpgsql security definer set search_path = public as $$
declare f favorecidos; cfg qual_parametros; v_rnc qual_rnc; v_nota nfe_notas; v_foto text; v_mail text;
begin
  if not portal_meu(p_fav) then raise exception 'Acesso negado.'; end if;
  select * into f from favorecidos where id = p_fav;
  select * into cfg from qual_parametros where empresa_id = f.empresa_id;
  if cfg.empresa_id is not null and not cfg.portal_reclamacao then raise exception 'A empresa não recebe reclamações pelo Portal. Fale com o seu contato comercial.'; end if;
  if length(trim(coalesce(p_descricao, ''))) < 10 then raise exception 'Descreva o problema (pelo menos 10 caracteres).'; end if;
  if length(p_descricao) > 3000 then raise exception 'Descrição muito longa (até 3.000 caracteres).'; end if;
  if p_quantidade is not null and p_quantidade <= 0 then raise exception 'Quantidade inválida.'; end if;
  if coalesce(array_length(p_fotos, 1), 0) > 6 then raise exception 'Até 6 fotos por reclamação.'; end if;
  if p_nota is not null then
    select * into v_nota from nfe_notas n where n.id = p_nota and n.empresa_id = f.empresa_id and n.tipo = 'saida' and n.emissao_propria
       and (n.favorecido_id = f.id or (regexp_replace(coalesce(f.documento, ''), '\D', '', 'g') <> '' and n.dest_doc = regexp_replace(f.documento, '\D', '', 'g')));
    if v_nota.id is null then raise exception 'Nota fiscal não encontrada para este cliente.'; end if;
  end if;
  v_mail := auth.jwt() ->> 'email';
  insert into qual_rnc(empresa_id, origem, favorecido_id, nota_id, portal_user_id, portal_visivel, produto_cliente, lote_cliente, quantidade_cliente, unidade_cliente,
                       descricao, gravidade, prazo, prazo_resposta, aberta_por)
  values (f.empresa_id, 'cliente', f.id, p_nota, auth.uid(), true, nullif(trim(left(p_produto, 200)), ''), nullif(trim(left(p_lote, 100)), ''), p_quantidade, nullif(trim(left(p_unidade, 10)), ''),
          trim(p_descricao), 'media', current_date + coalesce(cfg.prazo_rnc_dias, 15), current_date + coalesce(cfg.portal_prazo_resposta_dias, 2), 'Portal: ' || coalesce(v_mail, ''))
  returning * into v_rnc;
  foreach v_foto in array coalesce(p_fotos, '{}') loop
    if v_foto !~ ('^' || f.empresa_id::text || '/portal/[0-9a-f-]{36}/[^/]+$') then raise exception 'Foto inválida.'; end if;
    insert into qual_anexos(empresa_id, rnc_id, caminho, nome, tipo, portal_visivel, criado_por)
    values (f.empresa_id, v_rnc.id, v_foto, regexp_replace(v_foto, '^.*/', ''), 'foto', true, v_mail);
  end loop;
  perform _notificar_u(f.empresa_id, _usuarios_papel(f.empresa_id, coalesce(cfg.portal_papeis_aviso, array['admin', 'diretor', 'producao'])), 'qual_reclamacao',
    'Reclamação de cliente: RNC ' || v_rnc.numero, f.nome || coalesce(' · NF ' || v_nota.numero, '') || ' — ' || left(trim(p_descricao), 140),
    '#/qualidade/nao-conformidades?abrir=' || v_rnc.id, v_rnc.id, false);
  perform _email_enfileirar(f.empresa_id, 'reclamacao_recebida', v_mail,
    jsonb_build_object('cliente', f.nome, 'numero', v_rnc.numero, 'nota', coalesce(', da nota ' || v_nota.numero, ''), 'prazo', to_char(v_rnc.prazo_resposta, 'DD/MM/YYYY'),
                       'caminho', 'portal.html?aba=reclamacoes'), v_rnc.id);
  return v_rnc.numero;
end $$;
revoke all on function public.portal_reclamar(uuid, uuid, text, text, numeric, text, text, text[]) from public, anon;
grant execute on function public.portal_reclamar(uuid, uuid, text, text, numeric, text, text, text[]) to authenticated;

-- as reclamações do cliente, com a análise (8D) quando a empresa mostra
create or replace function public.portal_reclamacoes(p_fav uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'numero', r.numero, 'aberta_em', r.aberta_em, 'nota', n.numero, 'produto', r.produto_cliente, 'lote', r.lote_cliente,
      'quantidade', r.quantidade_cliente, 'unidade', r.unidade_cliente, 'descricao', r.descricao, 'situacao', r.situacao, 'prazo_resposta', r.prazo_resposta,
      'encerrada_em', r.encerrada_em, 'resposta', r.resposta_cliente, 'respondida_em', r.respondida_em,
      'cliente_aceite', r.cliente_aceite, 'cliente_comentario', r.cliente_comentario, 'cliente_avaliou_em', r.cliente_avaliou_em,
      'd8', case when coalesce(p.portal_mostrar_8d, true) then jsonb_build_object('equipe', r.equipe, 'contencao', r.acao_imediata, 'causa', r.causa,
              'porques', r.porques, 'corretiva', r.acao_corretiva, 'prazo', r.prazo, 'eficacia', r.eficacia, 'eficacia_em', r.eficacia_em, 'prevencao', r.prevencao) end,
      'fotos', (select coalesce(jsonb_agg(jsonb_build_object('caminho', a.caminho, 'nome', a.nome) order by a.criado_em), '[]') from qual_anexos a where a.rnc_id = r.id and a.portal_visivel)
    ) order by r.aberta_em desc), '[]'::jsonb)
  from qual_rnc r left join nfe_notas n on n.id = r.nota_id left join qual_parametros p on p.empresa_id = r.empresa_id
  where portal_meu(p_fav) and r.favorecido_id = p_fav and r.portal_visivel and r.situacao <> 'cancelada';
$$;
revoke all on function public.portal_reclamacoes(uuid) from public, anon;
grant execute on function public.portal_reclamacoes(uuid) to authenticated;

-- o cliente diz se a resposta resolveu; "não resolveu" numa RNC encerrada a reabre para análise
create or replace function public.portal_reclamacao_avaliar(p_fav uuid, p_rnc uuid, p_aceita boolean, p_comentario text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r qual_rnc; cfg qual_parametros; f favorecidos;
begin
  if not portal_meu(p_fav) then raise exception 'Acesso negado.'; end if;
  select * into r from qual_rnc where id = p_rnc and favorecido_id = p_fav and portal_visivel for update;
  if r.id is null then raise exception 'Reclamação não encontrada.'; end if;
  if r.resposta_cliente is null then raise exception 'A reclamação ainda não foi respondida.'; end if;
  if not p_aceita and length(trim(coalesce(p_comentario, ''))) < 5 then raise exception 'Conte por que a resposta não resolveu.'; end if;
  update qual_rnc set cliente_aceite = case when p_aceita then 'aceita' else 'nao_aceita' end, cliente_comentario = nullif(trim(left(p_comentario, 1000)), ''),
         cliente_avaliou_em = now(),
         situacao = case when not p_aceita and situacao = 'encerrada' then 'em_analise' else situacao end,
         encerrada_em = case when not p_aceita and situacao = 'encerrada' then null else encerrada_em end
   where id = r.id;
  select * into cfg from qual_parametros where empresa_id = r.empresa_id;
  select * into f from favorecidos where id = p_fav;
  perform _notificar_u(r.empresa_id, _usuarios_papel(r.empresa_id, coalesce(cfg.portal_papeis_aviso, array['admin', 'diretor', 'producao'])), 'qual_reclamacao_avaliacao',
    'RNC ' || r.numero || ': ' || case when p_aceita then 'cliente aceitou a resposta' else 'cliente NÃO aceitou a resposta' end,
    f.nome || coalesce(' — ' || left(trim(p_comentario), 140), ''), '#/qualidade/nao-conformidades?abrir=' || r.id, r.id, not p_aceita);
end $$;
revoke all on function public.portal_reclamacao_avaliar(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.portal_reclamacao_avaliar(uuid, uuid, boolean, text) to authenticated;

-- 8) equipe: responder ao cliente (e-mail aos usuários do Portal do cliente e WhatsApp a quem aceitou)
create or replace function public.qual_responder_cliente(p_rnc uuid, p_resposta text)
returns int language plpgsql security definer set search_path = public as $$
declare r qual_rnc; f favorecidos; v_campos jsonb; u record; n int := 0;
  SIT constant jsonb := '{"aberta":"recebida","em_analise":"em análise","acao":"ação em andamento","verificacao":"verificando a eficácia","encerrada":"encerrada"}';
begin
  select * into r from qual_rnc where id = p_rnc for update;
  if r.id is null or not pode_qualidade(r.empresa_id) then raise exception 'Acesso negado.'; end if;
  if r.favorecido_id is null then raise exception 'A RNC não tem cliente.'; end if;
  if length(trim(coalesce(p_resposta, ''))) < 10 then raise exception 'Escreva a resposta ao cliente (pelo menos 10 caracteres).'; end if;
  update qual_rnc set resposta_cliente = trim(left(p_resposta, 4000)), respondida_em = now(), respondida_por = auth.jwt() ->> 'email',
         portal_visivel = true, cliente_aceite = null, cliente_comentario = null, cliente_avaliou_em = null,
         situacao = case when situacao = 'aberta' then 'em_analise' else situacao end
   where id = r.id returning * into r;
  select * into f from favorecidos where id = r.favorecido_id;
  v_campos := jsonb_build_object('cliente', f.nome, 'numero', r.numero, 'situacao', coalesce(SIT ->> r.situacao, r.situacao), 'resposta', r.resposta_cliente,
                                 'caminho', 'portal.html?aba=reclamacoes');
  for u in select distinct lower(email) e from portal_usuarios where favorecido_id = r.favorecido_id and ativo loop
    perform _email_enfileirar(r.empresa_id, 'reclamacao_resposta', u.e, v_campos, r.id); n := n + 1;
  end loop;
  for u in select distinct whatsapp w from portal_usuarios where favorecido_id = r.favorecido_id and ativo and whatsapp is not null and whatsapp_optin_em is not null loop
    perform _wa_enfileirar(r.empresa_id, 'reclamacao_resposta', u.w, v_campos, r.id); n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.qual_responder_cliente(uuid, text) from public, anon;
grant execute on function public.qual_responder_cliente(uuid, text) to authenticated;

-- 9) certificado de qualidade da NF-e: bobinas expedidas na nota, OPs (e as das bobinas-mãe) e inspeções aprovadas
create or replace function public._qual_certificado(p_nota uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with nota as (select * from nfe_notas where id = p_nota),
  bob as (select b.* from prod_bobinas b, nota where b.nota_id = nota.id),
  ops as (select distinct ordem_id id from bob union select distinct m.ordem_id from bob b join prod_bobinas m on m.id = b.mae_id)
  select jsonb_build_object(
    'nota', jsonb_build_object('id', n.id, 'numero', n.numero, 'serie', n.serie, 'emissao', n.emissao, 'chave', n.chave, 'cliente', coalesce(fv.nome, n.dest_nome), 'cliente_doc', n.dest_doc),
    'empresa', jsonb_build_object('nome', e.nome, 'cnpj', e.cnpj),
    'texto', coalesce(p.certificado_texto, 'Declaramos que os produtos desta nota fiscal foram fabricados e inspecionados conforme os planos de inspeção da empresa e atendem às especificações acordadas.'),
    'responsavel', p.certificado_responsavel, 'cargo', p.certificado_cargo,
    'ops', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'numero', o.numero, 'numero_iniflex', o.numero_iniflex,
              'produto', coalesce(pr.codigo || ' · ' || pr.descricao, o.descricao), 'expedida', exists (select 1 from bob where bob.ordem_id = o.id),
              'bobinas', (select coalesce(jsonb_agg(jsonb_build_object('codigo', b.codigo, 'peso_kg', b.peso_kg, 'metros', b.metros, 'lote_materia', b.lote_materia) order by b.codigo), '[]') from bob b where b.ordem_id = o.id),
              'inspecoes', (select coalesce(jsonb_agg(jsonb_build_object('numero', i.numero, 'etapa', i.etapa, 'situacao', i.situacao, 'data', coalesce(i.decidida_em, i.inspecionada_em),
                               'inspetor', i.inspetor, 'plano', pl.nome, 'caracteristicas', coalesce(pl.caracteristicas, '[]'), 'resultados', i.resultados) order by i.numero), '[]')
                            from qual_inspecoes i left join qual_planos pl on pl.id = i.plano_id
                           where i.ordem_id = o.id and i.situacao in ('aprovada', 'aprovada_concessao'))
            ) order by o.numero), '[]') from prod_ordens o left join produtos pr on pr.id = o.produto_id where o.id in (select id from ops)),
    'bobinas', (select count(*) from bob), 'kg', (select coalesce(sum(peso_kg), 0) from bob),
    'gerado_em', now())
  from nota n join empresas e on e.id = n.empresa_id left join favorecidos fv on fv.id = n.favorecido_id left join qual_parametros p on p.empresa_id = n.empresa_id;
$$;
revoke all on function public._qual_certificado(uuid) from public, anon, authenticated;

create or replace function public.qual_certificado(p_nota uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e uuid;
begin
  select empresa_id into e from nfe_notas where id = p_nota;
  if e is null or not is_participante(e) then raise exception 'Acesso negado.'; end if;
  if not exists (select 1 from prod_bobinas where nota_id = p_nota) then raise exception 'Nenhuma bobina foi expedida nesta nota (Rastreabilidade › Expedir bobinas).'; end if;
  return _qual_certificado(p_nota);
end $$;
revoke all on function public.qual_certificado(uuid) from public, anon;
grant execute on function public.qual_certificado(uuid) to authenticated;

-- notas do cliente que têm certificado (bobinas expedidas)
create or replace function public.portal_certificados(p_fav uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct b.nota_id from prod_bobinas b join nfe_notas n on n.id = b.nota_id join favorecidos f on f.id = p_fav
   left join qual_parametros p on p.empresa_id = n.empresa_id
   where portal_meu(p_fav) and coalesce(p.certificado_ativo, true) and n.empresa_id = f.empresa_id and n.tipo = 'saida' and n.emissao_propria
     and (n.favorecido_id = f.id or (regexp_replace(coalesce(f.documento, ''), '\D', '', 'g') <> '' and n.dest_doc = regexp_replace(f.documento, '\D', '', 'g')));
$$;
revoke all on function public.portal_certificados(uuid) from public, anon;
grant execute on function public.portal_certificados(uuid) to authenticated;

create or replace function public.portal_certificado(p_fav uuid, p_nota uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from portal_certificados(p_fav) x where x = p_nota) then raise exception 'Certificado indisponível para esta nota.'; end if;
  return _qual_certificado(p_nota);
end $$;
revoke all on function public.portal_certificado(uuid, uuid) from public, anon;
grant execute on function public.portal_certificado(uuid, uuid) to authenticated;

select (select count(*) from information_schema.columns where table_name = 'qual_rnc' and column_name in ('nota_id', 'portal_visivel', 'resposta_cliente', 'cliente_aceite', 'equipe', 'prevencao')) as colunas_rnc,
       (select count(*) from information_schema.columns where table_name = 'qual_parametros' and (column_name like 'portal_%' or column_name like 'certificado_%')) as parametros;
