-- Régua de cobrança e PIX (melhoria 3.3 do plano de melhoria contínua, Passo 4) — 08/11/2026.
-- Aditivo.
--   • régua: lembrete antes do vencimento, aviso no dia e cobrança depois, por e-mail (cadastro do cliente e acessos do
--     Portal) e WhatsApp (quem aceitou no Portal), todo dia de manhã; etapas e regras ajustáveis na tela;
--   • pausa por cliente ou por título (negociação, promessa de pagamento), sem cobrar título cedido ao FIDC nem com
--     prorrogação pedida no Portal;
--   • PIX copia e cola (BR Code estático do Banco Central) no e-mail e no Portal, com a chave da empresa;
--   • histórico de tudo o que foi mandado e "Cobrar agora" na tela Cobrança (FIN024).

create table if not exists public.cob_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ativo boolean not null default false,
  pix_chave text check (length(pix_chave) <= 77),
  pix_nome text check (length(pix_nome) <= 60),
  pix_cidade text check (length(pix_cidade) <= 40),
  valor_minimo numeric(14,2) not null default 0 check (valor_minimo >= 0),
  excluir_cedidos boolean not null default true,
  canais text[] not null default array['email', 'whatsapp'] check (canais <@ array['email', 'whatsapp']),
  copia_email text check (copia_email is null or copia_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),   -- cópia interna da cobrança (opcional)
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
create table if not exists public.cob_etapas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  dias int not null check (dias between -30 and 180),     -- negativo: antes do vencimento; 0: no dia; positivo: dias de atraso
  modelo text not null check (modelo in ('cob_lembrete', 'cob_vencimento', 'cob_atraso')),
  ativo boolean not null default true,
  unique (empresa_id, dias)
);
create table if not exists public.cob_pausas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  favorecido_id uuid references public.favorecidos(id) on delete cascade,
  lancamento_id uuid references public.lancamentos(id) on delete cascade,
  ate date not null,
  motivo text not null check (length(trim(motivo)) >= 3 and length(motivo) <= 500),
  criado_por text default (auth.jwt() ->> 'email'), criado_em timestamptz not null default now(),
  check (favorecido_id is not null or lancamento_id is not null)
);
create index if not exists cob_pausas_emp on public.cob_pausas(empresa_id, ate);
create table if not exists public.cob_envios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  lancamento_id uuid not null references public.lancamentos(id) on delete cascade,
  etapa_dias int,                                          -- nulo: "Cobrar agora"
  modelo text not null,
  canal text not null check (canal in ('email', 'whatsapp', 'sem_contato')),
  para text,
  manual boolean not null default false,
  criado_por text, criado_em timestamptz not null default now()
);
create unique index if not exists cob_envios_unico on public.cob_envios(lancamento_id, etapa_dias, canal, coalesce(para, '')) where not manual;
create index if not exists cob_envios_lanc on public.cob_envios(lancamento_id, criado_em desc);

alter table public.cob_config enable row level security;
alter table public.cob_etapas enable row level security;
alter table public.cob_pausas enable row level security;
alter table public.cob_envios enable row level security;
do $$
declare t text;
begin
  foreach t in array array['cob_config', 'cob_etapas', 'cob_pausas', 'cob_envios'] loop
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_membro(empresa_id))', t || '_sel', t);
  end loop;
  foreach t in array array['cob_config', 'cob_etapas', 'cob_pausas'] loop
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.pode_editar(empresa_id))', t || '_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.pode_editar(empresa_id)) with check (public.pode_editar(empresa_id))', t || '_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.pode_editar(empresa_id))', t || '_del', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;
grant select on public.cob_envios to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- PIX copia e cola (o mesmo cálculo de js/lib/pix.js)
create or replace function public._pix_txt(p text, n int) returns text language sql immutable as $$
  select left(trim(regexp_replace(regexp_replace(upper(translate(coalesce(p, ''),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')), '[^A-Z0-9 ]', '', 'g'), '\s+', ' ', 'g')), n);
$$;
create or replace function public._pix_crc16(p text) returns text language plpgsql immutable as $$
declare crc int := 65535; b bytea := convert_to(p, 'UTF8'); i int; j int;
begin
  for i in 0 .. length(b) - 1 loop
    crc := crc # (get_byte(b, i) << 8);
    for j in 1 .. 8 loop
      if (crc & 32768) <> 0 then crc := ((crc << 1) # 4129) & 65535; else crc := (crc << 1) & 65535; end if;
    end loop;
  end loop;
  return upper(lpad(to_hex(crc), 4, '0'));
end $$;
create or replace function public.pix_brcode(p_chave text, p_nome text, p_cidade text, p_valor numeric default null, p_txid text default null)
returns text language plpgsql immutable as $$
declare c text; id text; f text; nm text; cd text;
begin
  if coalesce(trim(p_chave), '') = '' then return null; end if;
  id := left(regexp_replace(coalesce(p_txid, ''), '[^A-Za-z0-9]', '', 'g'), 25); if id = '' then id := '***'; end if;
  nm := coalesce(nullif(_pix_txt(p_nome, 25), ''), 'RECEBEDOR'); cd := coalesce(nullif(_pix_txt(p_cidade, 15), ''), 'BRASIL');
  c := '0014br.gov.bcb.pix' || '01' || lpad(length(trim(p_chave))::text, 2, '0') || trim(p_chave);
  f := '000201' || '26' || lpad(length(c)::text, 2, '0') || c || '52040000' || '5303986'
    || case when p_valor > 0 then '54' || lpad(length(to_char(p_valor, 'FM9999999990.00'))::text, 2, '0') || to_char(p_valor, 'FM9999999990.00') else '' end
    || '5802BR' || '59' || lpad(length(nm)::text, 2, '0') || nm || '60' || lpad(length(cd)::text, 2, '0') || cd
    || '62' || lpad((length(id) + 4)::text, 2, '0') || '05' || lpad(length(id)::text, 2, '0') || id || '6304';
  return f || _pix_crc16(f);
end $$;
grant execute on function public.pix_brcode(text, text, text, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- modelos de e-mail e de WhatsApp da cobrança (recriadas com os anteriores)
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
   E'Olá, {{cliente}},\n\nNão identificamos o pagamento do título {{documento}}, no valor de {{valor}}, vencido em {{vencimento}} ({{dias}} dia(s) de atraso).\n\nPara pagar com PIX, use o código copia e cola:\n{{pix}}\n\nSe já pagou, por favor responda com o comprovante. Se precisar negociar, fale com o nosso financeiro.', 'Ver no Portal', 'empresa, cliente, documento, valor, vencimento, dias, pix');
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
   'Olá! {{1}} não identificou o pagamento do título {{2}}, de {{3}}, vencido em {{4}} ({{5}} dias). PIX copia e cola: {{6}}. Se já pagou, responda com o comprovante.');
$$;
grant execute on function public.wa_padrao() to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- títulos a receber em aberto, com o cliente
create or replace function public._cob_campos(p_lanc uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('cliente', f.nome, 'documento', coalesce(nullif(l.documento, ''), left(l.descricao, 40)),
    'valor', 'R$ ' || translate(to_char(l.valor, 'FM999G999G990D00'), ',.', '.,'), 'vencimento', to_char(l.data, 'DD/MM/YYYY'),
    'dias', greatest(current_date - l.data, 0),
    'pix', coalesce(pix_brcode(c.pix_chave, coalesce(c.pix_nome, e.nome), c.pix_cidade, l.valor, coalesce(l.documento, 'T' || left(replace(l.id::text, '-', ''), 20))), '(chave PIX não cadastrada)'),
    'caminho', 'portal.html?aba=titulos')
  from lancamentos l join empresas e on e.id = l.empresa_id left join favorecidos f on f.id = l.favorecido_id left join cob_config c on c.empresa_id = l.empresa_id
  where l.id = p_lanc;
$$;
revoke all on function public._cob_campos(uuid) from public, anon, authenticated;

-- manda uma etapa de um título pelos canais (devolve quantas mensagens)
create or replace function public._cob_enviar(p_lanc uuid, p_dias int, p_modelo text, p_manual boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare l lancamentos; cfg cob_config; v_campos jsonb; r record; n int := 0; v_ok boolean;
begin
  select * into l from lancamentos where id = p_lanc;
  select * into cfg from cob_config where empresa_id = l.empresa_id;
  v_campos := _cob_campos(l.id);
  if 'email' = any(coalesce(cfg.canais, array['email', 'whatsapp'])) then
    for r in select distinct lower(trim(x)) e from (
               select f.email x from favorecidos f where f.id = l.favorecido_id
               union all select pu.email from portal_usuarios pu where pu.favorecido_id = l.favorecido_id and pu.ativo) z
              where x ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' loop
      insert into cob_envios(empresa_id, lancamento_id, etapa_dias, modelo, canal, para, manual, criado_por)
      values (l.empresa_id, l.id, p_dias, p_modelo, 'email', r.e, p_manual, auth.jwt() ->> 'email') on conflict do nothing returning true into v_ok;
      if v_ok then perform _email_enfileirar(l.empresa_id, p_modelo, r.e, v_campos, l.id); n := n + 1; end if;
      v_ok := null;
    end loop;
    if cfg.copia_email is not null and n > 0 then perform _email_enfileirar(l.empresa_id, p_modelo, cfg.copia_email, v_campos, l.id); end if;
  end if;
  if 'whatsapp' = any(coalesce(cfg.canais, array['email', 'whatsapp'])) then
    for r in select distinct pu.whatsapp w from portal_usuarios pu where pu.favorecido_id = l.favorecido_id and pu.ativo and pu.whatsapp is not null and pu.whatsapp_optin_em is not null loop
      insert into cob_envios(empresa_id, lancamento_id, etapa_dias, modelo, canal, para, manual, criado_por)
      values (l.empresa_id, l.id, p_dias, p_modelo, 'whatsapp', r.w, p_manual, auth.jwt() ->> 'email') on conflict do nothing returning true into v_ok;
      if v_ok then perform _wa_enfileirar(l.empresa_id, p_modelo, r.w, v_campos, l.id); n := n + 1; end if;
      v_ok := null;
    end loop;
  end if;
  if n = 0 then
    insert into cob_envios(empresa_id, lancamento_id, etapa_dias, modelo, canal, para, manual, criado_por)
    values (l.empresa_id, l.id, p_dias, p_modelo, 'sem_contato', null, p_manual, auth.jwt() ->> 'email') on conflict do nothing;
  end if;
  return n;
end $$;
revoke all on function public._cob_enviar(uuid, int, text, boolean) from public, anon, authenticated;

-- a régua do dia (cron 8h10): cada etapa ativa, com 2 dias de tolerância se o agendamento falhar
create or replace function public._cob_regua(p_empresa uuid default null, p_hoje date default current_date)
returns int language plpgsql security definer set search_path = public as $$
declare cfg cob_config; et record; l record; n int := 0;
begin
  for cfg in select * from cob_config where ativo and (p_empresa is null or empresa_id = p_empresa) loop
    for et in select * from cob_etapas where empresa_id = cfg.empresa_id and ativo order by dias loop
      for l in select la.id from lancamentos la join plano_contas p on p.id = la.plano_id
                where la.empresa_id = cfg.empresa_id and la.status = 'Em aberto' and p.tipo = 'E' and p.natureza = 'C'
                  and la.favorecido_id is not null and la.valor >= cfg.valor_minimo
                  and la.data + et.dias between p_hoje - 2 and p_hoje
                  and not (cfg.excluir_cedidos and la.fidc_proposta_id is not null)
                  and not exists (select 1 from cob_pausas pz where pz.empresa_id = cfg.empresa_id and pz.ate >= p_hoje
                                   and (pz.lancamento_id = la.id or pz.favorecido_id = la.favorecido_id))
                  and not exists (select 1 from portal_prorrogacoes pp where pp.lancamento_id = la.id and pp.status = 'pendente')
                  and not exists (select 1 from cob_envios ce where ce.lancamento_id = la.id and ce.etapa_dias = et.dias and not ce.manual)
                  -- não manda uma etapa antiga depois de uma mais nova
                  and not exists (select 1 from cob_envios ce where ce.lancamento_id = la.id and ce.etapa_dias > et.dias and not ce.manual) loop
        perform _cob_enviar(l.id, et.dias, et.modelo, false); n := n + 1;
      end loop;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public._cob_regua(uuid, date) from public, anon, authenticated;

-- "Cobrar agora" (financeiro): manda a cobrança de atraso (ou o lembrete, se ainda não venceu) na hora
create or replace function public.cob_cobrar_agora(p_lancamento uuid)
returns int language plpgsql security definer set search_path = public as $$
declare l lancamentos; p plano_contas;
begin
  select * into l from lancamentos where id = p_lancamento;
  if l.id is null or not pode_editar(l.empresa_id) then raise exception 'Sem permissão.'; end if;
  select * into p from plano_contas where id = l.plano_id;
  if l.status <> 'Em aberto' or p.tipo <> 'E' then raise exception 'Só título a receber em aberto.'; end if;
  if l.favorecido_id is null then raise exception 'O título não tem cliente.'; end if;
  if exists (select 1 from cob_envios where lancamento_id = l.id and manual and criado_em > now() - interval '12 hours') then
    raise exception 'Este título já foi cobrado nas últimas 12 horas.';
  end if;
  return _cob_enviar(l.id, null, case when l.data < current_date then 'cob_atraso' when l.data = current_date then 'cob_vencimento' else 'cob_lembrete' end, true);
end $$;
revoke all on function public.cob_cobrar_agora(uuid) from public, anon;
grant execute on function public.cob_cobrar_agora(uuid) to authenticated;

-- etapas padrão quando a empresa ainda não montou a régua: 3 dias antes, no dia, 3, 10 e 30 dias depois
create or replace function public.cob_etapas_padrao(p_empresa uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not pode_editar(p_empresa) then raise exception 'Sem permissão.'; end if;
  if exists (select 1 from cob_etapas where empresa_id = p_empresa) then return 0; end if;
  insert into cob_etapas(empresa_id, dias, modelo) values (p_empresa, -3, 'cob_lembrete'), (p_empresa, 0, 'cob_vencimento'),
    (p_empresa, 3, 'cob_atraso'), (p_empresa, 10, 'cob_atraso'), (p_empresa, 30, 'cob_atraso');
  return 5;
end $$;
revoke all on function public.cob_etapas_padrao(uuid) from public, anon;
grant execute on function public.cob_etapas_padrao(uuid) to authenticated;

-- PIX do título no Portal (só o cliente dono do título)
create or replace function public.portal_pix(p_fav uuid, p_lancamento uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l lancamentos; c cob_config; v text;
begin
  if not portal_meu(p_fav) then raise exception 'Sem acesso.'; end if;
  select * into l from lancamentos where id = p_lancamento and favorecido_id = p_fav and status = 'Em aberto' and fidc_proposta_id is null;
  if l.id is null then raise exception 'Título não disponível para PIX.'; end if;
  select * into c from cob_config where empresa_id = l.empresa_id;
  v := pix_brcode(c.pix_chave, coalesce(c.pix_nome, (select nome from empresas where id = l.empresa_id)), c.pix_cidade, l.valor,
                  coalesce(l.documento, 'T' || left(replace(l.id::text, '-', ''), 20)));
  if v is null then raise exception 'A empresa ainda não cadastrou a chave PIX.'; end if;
  return jsonb_build_object('brcode', v, 'valor', l.valor, 'documento', l.documento, 'vencimento', l.data, 'recebedor', coalesce(c.pix_nome, (select nome from empresas where id = l.empresa_id)));
end $$;
revoke all on function public.portal_pix(uuid, uuid) from public, anon;
grant execute on function public.portal_pix(uuid, uuid) to authenticated;

-- agendamento: todo dia às 8h10 (11h10 UTC)
do $$
begin
  begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron indisponível (%).', sqlerrm; return; end;
  perform cron.unschedule(jobid) from cron.job where jobname = 'cobranca-regua';
  perform cron.schedule('cobranca-regua', '10 11 * * *', $job$ select public._cob_regua(); $job$);
exception when others then raise notice 'agendamento da régua não criado: %', sqlerrm;
end $$;

select (select count(*) from information_schema.tables where table_name in ('cob_config', 'cob_etapas', 'cob_pausas', 'cob_envios')) as tabelas,
       public.pix_brcode('12345678000195', 'Plásticos Exemplo Ltda', 'Caruaru', 1234.5, 'NF 18.211/1') as exemplo_pix;
