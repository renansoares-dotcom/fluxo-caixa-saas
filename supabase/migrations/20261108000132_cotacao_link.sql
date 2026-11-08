-- Cotação por link e mapa comparativo (melhoria 5.2 do plano de melhoria contínua, Passo 4) — 08/11/2026.
-- Aditivo.
--   • o comprador convida fornecedores por um link (e-mail automático e/ou o link copiado para o WhatsApp); o fornecedor
--     abre a página pública cotacao.html, sem login, e preenche preço por item, frete, prazo, condição, validade;
--   • a resposta vira a cotação da requisição (a mesma tabela das cotações digitadas) e avisa o comprador;
--   • o mapa comparativo da tela compara preço, frete, prazo e o valor presente da condição de pagamento (taxa nos
--     parâmetros) e mostra o melhor preço de cada item.

-- 1) parâmetros
alter table public.compras_parametros add column if not exists cotacao_link_dias int not null default 5;
alter table public.compras_parametros add column if not exists taxa_mensal_vp numeric(6,3) not null default 1.5;   -- % ao mês para trazer as parcelas a valor presente
alter table public.compras_parametros add column if not exists cotacao_mensagem text;                              -- texto padrão do convite
alter table public.compras_parametros add column if not exists cotacao_mostra_estimado boolean not null default false;   -- mostrar o preço estimado ao fornecedor
do $$ begin
  alter table public.compras_parametros add constraint compras_par_cot_chk check (cotacao_link_dias between 1 and 60 and taxa_mensal_vp between 0 and 20);
exception when duplicate_object then null; end $$;

-- 2) convites
create table if not exists public.compras_cotacao_convites (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  requisicao_id uuid not null references public.compras_requisicoes(id) on delete cascade,
  favorecido_id uuid references public.favorecidos(id) on delete set null,
  fornecedor text not null,
  email text, telefone text,
  token text not null unique default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  expira_em date not null,
  mensagem text,
  situacao text not null default 'enviado' check (situacao in ('enviado', 'aberto', 'respondido', 'recusado', 'cancelado')),
  aberto_em timestamptz, respondido_em timestamptz, respondido_por text, recusa_motivo text,
  cotacao_id uuid references public.compras_cotacoes(id) on delete set null,
  criado_por text default (auth.jwt() ->> 'email'), criado_em timestamptz not null default now()
);
create index if not exists compras_conv_req on public.compras_cotacao_convites(requisicao_id);
alter table public.compras_cotacao_convites enable row level security;
drop policy if exists compras_conv_sel on public.compras_cotacao_convites;
drop policy if exists compras_conv_upd on public.compras_cotacao_convites;
create policy compras_conv_sel on public.compras_cotacao_convites for select to authenticated using (public.is_membro(empresa_id) or public.pode_comprar(empresa_id));
create policy compras_conv_upd on public.compras_cotacao_convites for update to authenticated using (public.pode_comprar(empresa_id)) with check (public.pode_comprar(empresa_id));
grant select, update on public.compras_cotacao_convites to authenticated;
drop trigger if exists zz_auditoria on public.compras_cotacao_convites;
create trigger zz_auditoria after insert or update or delete on public.compras_cotacao_convites for each row execute function public._auditar();
alter table public.compras_cotacoes add column if not exists convite_id uuid references public.compras_cotacao_convites(id) on delete set null;
alter table public.compras_cotacoes add column if not exists respondida_pelo_fornecedor boolean not null default false;

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('cotacao_respondida', 'Compras', 'Fornecedor respondeu a cotação', 'Um fornecedor preencheu (ou recusou) a cotação pelo link.', false, 55)
on conflict (codigo) do nothing;

-- 3) modelos de e-mail (recriada: as do SQL 131 + convite de cotação)
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
   E'Olá,\n\nA versão {{versao}} da arte {{arte}} foi enviada em {{enviada}} e ainda aguarda a sua conferência.\n\nA produção da embalagem só começa depois da aprovação. No Portal você aprova ou pede alteração em poucos minutos.', 'Conferir a arte', 'empresa, cliente, arte, numero, versao, enviada'),
  ('cotacao_convite', 'Pedido de cotação ao fornecedor', 'Pedido de cotação nº {{numero}} — {{empresa}}',
   E'Olá, {{fornecedor}},\n\n{{empresa}} pede a sua cotação para {{itens}} item(ns) da requisição nº {{numero}}.\n\n{{mensagem}}\n\nPreencha os preços, o prazo de entrega e a condição de pagamento direto na página, sem precisar de cadastro. O link vale até {{validade}}.', 'Preencher a cotação', 'empresa, fornecedor, numero, itens, mensagem, validade');
$$;
grant execute on function public.email_padrao() to authenticated, service_role;


-- 4) convidar (comprador): devolve o token; manda o e-mail se houver
create or replace function public.compras_convidar(p_requisicao uuid, p_favorecido uuid, p_fornecedor text, p_email text, p_telefone text default null, p_mensagem text default null)
returns text language plpgsql security definer set search_path = public as $$
declare r compras_requisicoes; cfg compras_parametros; c compras_cotacao_convites; v_nome text; v_email text;
begin
  select * into r from compras_requisicoes where id = p_requisicao;
  if r.id is null or not pode_comprar(r.empresa_id) then raise exception 'Acesso negado.'; end if;
  if r.status not in ('aprovada', 'pendente') then raise exception 'A requisição % não está aberta para cotação.', r.numero; end if;
  select * into cfg from compras_parametros where empresa_id = r.empresa_id;
  v_nome := coalesce(nullif(trim(p_fornecedor), ''), (select nome from favorecidos where id = p_favorecido and empresa_id = r.empresa_id));
  if v_nome is null then raise exception 'Informe o fornecedor.'; end if;
  v_email := nullif(lower(trim(coalesce(p_email, (select email from favorecidos where id = p_favorecido)))), '');
  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido.'; end if;
  insert into compras_cotacao_convites(empresa_id, requisicao_id, favorecido_id, fornecedor, email, telefone, expira_em, mensagem)
  values (r.empresa_id, r.id, p_favorecido, left(v_nome, 200), v_email, nullif(trim(p_telefone), ''), current_date + coalesce(cfg.cotacao_link_dias, 5),
          nullif(trim(coalesce(p_mensagem, cfg.cotacao_mensagem)), ''))
  returning * into c;
  if v_email is not null then
    perform _email_enfileirar(r.empresa_id, 'cotacao_convite', v_email,
      jsonb_build_object('fornecedor', v_nome, 'numero', r.numero, 'itens', (select count(*) from compras_requisicao_itens where requisicao_id = r.id),
                         'mensagem', coalesce(c.mensagem, ''), 'validade', to_char(c.expira_em, 'DD/MM/YYYY'), 'caminho', 'cotacao.html?t=' || c.token), c.id);
  end if;
  return c.token;
end $$;
revoke all on function public.compras_convidar(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.compras_convidar(uuid, uuid, text, text, text, text) to authenticated;

-- 5) página do fornecedor (sem login): abrir, responder e recusar
create or replace function public._cotacao_convite(p_token text) returns compras_cotacao_convites language sql stable security definer set search_path = public as $$
  select * from compras_cotacao_convites where token = p_token and length(p_token) = 64;
$$;
revoke all on function public._cotacao_convite(text) from public, anon, authenticated;

create or replace function public.cotacao_link_abrir(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c compras_cotacao_convites; r compras_requisicoes; cfg compras_parametros;
begin
  c := _cotacao_convite(p_token);
  if c.id is null then raise exception 'Link de cotação inválido.'; end if;
  select * into r from compras_requisicoes where id = c.requisicao_id;
  select * into cfg from compras_parametros where empresa_id = c.empresa_id;
  if c.situacao = 'enviado' then update compras_cotacao_convites set situacao = 'aberto', aberto_em = now() where id = c.id; c.situacao := 'aberto'; end if;
  return jsonb_build_object(
    'empresa', (select coalesce(razao_social, nome) from empresas where id = c.empresa_id), 'fornecedor', c.fornecedor, 'numero', r.numero, 'necessidade', r.necessidade,
    'situacao', c.situacao, 'expira_em', c.expira_em, 'vencido', c.expira_em < current_date or r.status not in ('aprovada', 'pendente'), 'mensagem', c.mensagem,
    'itens', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'descricao', i.descricao, 'unidade', i.unidade, 'quantidade', i.quantidade, 'observacao', i.observacao,
                'estimado', case when coalesce(cfg.cotacao_mostra_estimado, false) then i.valor_estimado end,
                'preco', (select ci.valor_unitario from compras_cotacao_itens ci where ci.cotacao_id = c.cotacao_id and ci.requisicao_item_id = i.id)) order by i.descricao), '[]')
              from compras_requisicao_itens i where i.requisicao_id = r.id),
    'resposta', (select jsonb_build_object('prazo', q.prazo_entrega_dias, 'condicao', q.condicao_pagamento, 'parcelas', q.parcelas_dias, 'frete', q.frete, 'validade', q.validade, 'observacao', q.observacao,
                                           'respondido_em', c.respondido_em, 'respondido_por', c.respondido_por, 'escolhida', q.escolhida) from compras_cotacoes q where q.id = c.cotacao_id),
    'recusa_motivo', c.recusa_motivo);
end $$;

create or replace function public.cotacao_link_responder(p_token text, p_itens jsonb, p_prazo_dias int, p_condicao text, p_parcelas int[], p_frete numeric,
                                                        p_validade date, p_observacao text, p_nome text, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare c compras_cotacao_convites; r compras_requisicoes; v_cot uuid; v_n int; x jsonb; v_avisar uuid[];
begin
  c := _cotacao_convite(p_token);
  if c.id is null then raise exception 'Link de cotação inválido.'; end if;
  select * into r from compras_requisicoes where id = c.requisicao_id;
  if c.situacao = 'cancelado' then raise exception 'Este pedido de cotação foi cancelado pelo comprador.'; end if;
  if c.expira_em < current_date or r.status not in ('aprovada', 'pendente') then raise exception 'O prazo desta cotação terminou.'; end if;
  if exists (select 1 from compras_cotacoes where id = c.cotacao_id and escolhida) then raise exception 'Esta cotação já foi escolhida e não pode mais ser alterada.'; end if;
  if length(trim(coalesce(p_nome, ''))) < 3 then raise exception 'Informe o seu nome.'; end if;
  if p_email is not null and trim(p_email) <> '' and p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido.'; end if;
  if jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then raise exception 'Informe o preço de pelo menos um item.'; end if;
  if coalesce(p_frete, 0) < 0 or coalesce(p_prazo_dias, 0) < 0 or coalesce(p_prazo_dias, 0) > 365 then raise exception 'Frete ou prazo inválido.'; end if;
  if p_parcelas is not null and (array_length(p_parcelas, 1) > 24 or exists (select 1 from unnest(p_parcelas) d where d < 0 or d > 720)) then raise exception 'Parcelas inválidas.'; end if;
  for x in select * from jsonb_array_elements(p_itens) loop
    if not exists (select 1 from compras_requisicao_itens where id = (x ->> 'item_id')::uuid and requisicao_id = r.id) then raise exception 'Item inválido.'; end if;
    if (x ->> 'valor_unitario')::numeric is null or (x ->> 'valor_unitario')::numeric < 0 or (x ->> 'valor_unitario')::numeric > 1e9 then raise exception 'Preço inválido.'; end if;
  end loop;
  v_cot := c.cotacao_id;
  if v_cot is null then
    insert into compras_cotacoes(empresa_id, requisicao_id, favorecido_id, fornecedor, prazo_entrega_dias, condicao_pagamento, parcelas_dias, frete, validade, observacao, convite_id, respondida_pelo_fornecedor, criado_por)
    values (c.empresa_id, r.id, c.favorecido_id, c.fornecedor, p_prazo_dias, left(nullif(trim(p_condicao), ''), 200), coalesce(p_parcelas, '{28}'), coalesce(p_frete, 0), p_validade,
            left(nullif(trim(p_observacao), ''), 2000), c.id, true, null)
    returning id into v_cot;
  else
    update compras_cotacoes set prazo_entrega_dias = p_prazo_dias, condicao_pagamento = left(nullif(trim(p_condicao), ''), 200), parcelas_dias = coalesce(p_parcelas, '{28}'),
           frete = coalesce(p_frete, 0), validade = p_validade, observacao = left(nullif(trim(p_observacao), ''), 2000) where id = v_cot;
    delete from compras_cotacao_itens where cotacao_id = v_cot;
  end if;
  insert into compras_cotacao_itens(empresa_id, cotacao_id, requisicao_item_id, valor_unitario)
  select c.empresa_id, v_cot, (e ->> 'item_id')::uuid, round((e ->> 'valor_unitario')::numeric, 4) from jsonb_array_elements(p_itens) e
  on conflict (cotacao_id, requisicao_item_id) do update set valor_unitario = excluded.valor_unitario;
  get diagnostics v_n = row_count;
  update compras_cotacao_convites set situacao = 'respondido', respondido_em = now(), respondido_por = left(trim(p_nome) || coalesce(' <' || nullif(trim(p_email), '') || '>', ''), 200),
         cotacao_id = v_cot, recusa_motivo = null where id = c.id;
  v_avisar := _usuarios_papel(c.empresa_id, array['admin', 'compras']) || coalesce((select array_agg(u.id) from auth.users u where lower(u.email) = lower(c.criado_por)), '{}');
  perform _notificar_u(c.empresa_id, v_avisar, 'cotacao_respondida', c.fornecedor || ' respondeu a cotação da requisição ' || r.numero,
    v_n || ' item(ns) cotado(s)' || coalesce(' · prazo ' || p_prazo_dias || ' dia(s)', ''), '#/compras/requisicoes?abrir=' || r.id, r.id, false);
end $$;

create or replace function public.cotacao_link_recusar(p_token text, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare c compras_cotacao_convites; r compras_requisicoes;
begin
  c := _cotacao_convite(p_token);
  if c.id is null then raise exception 'Link de cotação inválido.'; end if;
  if c.situacao in ('cancelado', 'respondido') then raise exception 'Este pedido de cotação não pode mais ser recusado.'; end if;
  select * into r from compras_requisicoes where id = c.requisicao_id;
  update compras_cotacao_convites set situacao = 'recusado', recusa_motivo = left(coalesce(nullif(trim(p_motivo), ''), 'Sem motivo informado'), 500), respondido_em = now() where id = c.id;
  perform _notificar_u(c.empresa_id, _usuarios_papel(c.empresa_id, array['admin', 'compras']), 'cotacao_respondida', c.fornecedor || ' não vai cotar a requisição ' || r.numero,
    coalesce(nullif(trim(p_motivo), ''), 'Sem motivo informado'), '#/compras/requisicoes?abrir=' || r.id, r.id, false);
end $$;
revoke all on function public.cotacao_link_abrir(text), public.cotacao_link_responder(text, jsonb, int, text, int[], numeric, date, text, text, text), public.cotacao_link_recusar(text, text) from public;
grant execute on function public.cotacao_link_abrir(text), public.cotacao_link_responder(text, jsonb, int, text, int[], numeric, date, text, text, text), public.cotacao_link_recusar(text, text) to anon, authenticated;

select (select count(*) from information_schema.tables where table_name = 'compras_cotacao_convites') as tabela,
       (select count(*) from information_schema.columns where table_name = 'compras_parametros' and column_name in ('cotacao_link_dias', 'taxa_mensal_vp')) as parametros;
