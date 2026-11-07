-- =====================================================================
-- Comercial › Pré-impressão e aprovação de arte pelo cliente no Portal (07/11/2026). Referência: ERP "Consultoria"
-- (032, 046–051: projeto de arte, versões imutáveis com hash, aprovação pelo cliente no portal, upload do cliente,
-- arquivamento e relatório). Refeita e ampliada:
--  - projeto de arte com a ficha técnica da embalagem (dimensões, substrato, processo, cores ligadas à Casa de Tintas,
--    código de barras, posição de desbobinamento) ligado ao cliente, ao produto e à OP;
--  - versões IMUTÁVEIS com SHA-256 do arquivo e a prévia em imagem (o PDF vira imagem no navegador), checklist de
--    pré-impressão antes de ir ao cliente;
--  - comentários com PINOS na arte (x, y), do cliente e da equipe (internos não aparecem no portal);
--  - decisão do cliente no PORTAL só sobre a última versão enviada: aprovar (com o termo, o nome digitado, o hash da
--    versão, data, IP e navegador = prova auditável), pedir alteração ou reprovar; o cliente também envia arquivo;
--  - clicheria (envio, recebimento, custo; o clichê entra nas ferramentas da produção) e liberação para produção;
--  - trava opcional: OP do produto não começa se a arte mais recente do produto não estiver aprovada.
-- O cliente do portal só acessa por funções SECURITY DEFINER (nunca por RLS das tabelas internas). Migração ADITIVA.
-- =====================================================================

-- quem trabalha a arte: comercial (admin, financeiro, diretor, vendas — vendas só na própria carteira) e produção (PCP)
create or replace function public.pre_pode(p_empresa uuid, p_fav uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where empresa_id = p_empresa and user_id = auth.uid() and papel::text in ('admin', 'financeiro', 'diretor', 'producao'))
      or (comercial_pode_editar(p_empresa) and comercial_ve_cliente(p_empresa, p_fav));
$$;
create or replace function public.pre_ve(p_empresa uuid, p_fav uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select ve_producao(p_empresa) or comercial_ve_cliente(p_empresa, p_fav);
$$;
revoke all on function public.pre_pode(uuid, uuid), public.pre_ve(uuid, uuid) from public, anon;
grant execute on function public.pre_pode(uuid, uuid), public.pre_ve(uuid, uuid) to authenticated;

-- 1) parâmetros
create table if not exists public.pre_parametros (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  checklist text[] not null default array[
    'Textos e ortografia revisados', 'Dimensões, passo e sangria conferidos', 'Cores conferidas com o padrão (Pantone / cliente)',
    'Código de barras válido e com contraste', 'Informações legais (CNPJ, lote, validade, símbolo de reciclagem)',
    'Registro, trapping e espessura mínima de linha', 'Posição de desbobinamento definida'],
  exigir_checklist boolean not null default true,
  prazo_cliente_dias int not null default 3,                 -- dias para o cliente responder
  bloquear_op boolean not null default false,                -- OP não começa sem a arte mais recente aprovada
  papeis_liberacao text[] not null default array['admin', 'diretor', 'financeiro'],   -- registram aprovação por fora, liberam produção
  termo text not null default 'Declaro que conferi esta arte — textos, ortografia, cores, dimensões, código de barras e informações legais — e autorizo a confecção dos clichês e a impressão. Alterações depois desta aprovação geram nova arte e podem gerar custo.',
  atualizado_em timestamptz not null default now()
);

-- 2) projetos de arte
create table if not exists public.pre_projetos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  numero int not null,
  favorecido_id uuid not null references public.favorecidos(id),
  produto_id uuid references public.produtos(id) on delete set null,
  ordem_id uuid references public.prod_ordens(id) on delete set null,
  nome text not null,
  codigo_cliente text,                                       -- código/nome da embalagem no cliente
  tipo text not null default 'nova' check (tipo in ('nova', 'alteracao', 'reimpressao')),
  largura_mm numeric(10,2), altura_mm numeric(10,2),         -- largura da arte e passo (repetição)
  substrato text, processo text not null default 'superficie' check (processo in ('superficie', 'verso', 'laminacao')),
  cores jsonb not null default '[]'::jsonb,                  -- [{nome, pantone, hex, tin_cor_id}]
  ean text,                                                  -- código de barras (EAN-13, EAN-8, DUN-14)
  desbobinamento smallint check (desbobinamento between 1 and 8),
  responsavel text, prazo date,
  situacao text not null default 'em_criacao' check (situacao in ('em_criacao', 'aguardando_cliente', 'alteracao_solicitada', 'reprovada', 'aprovada', 'na_clicheria', 'liberada', 'cancelada')),
  versao_aprovada_id uuid,
  clicheria_id uuid references public.favorecidos(id) on delete set null,
  cliche_enviado_em date, cliche_previsto date, cliche_recebido_em date, cliche_custo numeric(14,2), cliche_qtd smallint,
  ferramenta_id uuid references public.prod_ferramentas(id) on delete set null,
  liberada_em timestamptz, liberada_por text,
  arquivado boolean not null default false, motivo text, observacao text,
  criado_por text default (auth.jwt() ->> 'email'), criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  unique (empresa_id, numero)
);
create index if not exists pre_proj_emp on public.pre_projetos(empresa_id, situacao);
create index if not exists pre_proj_prod on public.pre_projetos(produto_id, criado_em desc);
create index if not exists pre_proj_fav on public.pre_projetos(favorecido_id);

-- 3) versões (imutáveis), comentários com pino, decisões e linha do tempo
create table if not exists public.pre_versoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  projeto_id uuid not null references public.pre_projetos(id) on delete cascade,
  numero int not null,
  caminho text not null, nome text not null, tipo text, tamanho bigint,
  hash text not null check (hash ~ '^[0-9a-f]{64}$'),        -- SHA-256 do arquivo, calculado no navegador
  previa text,                                               -- imagem da página 1 (PDF) ou a própria imagem
  previa_largura int, previa_altura int,
  paginas int, mm_largura numeric(8,1), mm_altura numeric(8,1),   -- medidas da página 1 do PDF (conferência com a ficha)
  observacao text,                                           -- o que mudou nesta versão
  origem text not null default 'interno' check (origem in ('interno', 'cliente')),
  checklist jsonb not null default '[]'::jsonb,              -- [{item, ok}]
  enviada_em timestamptz,                                    -- enviada ao cliente
  enviado_por text default (auth.jwt() ->> 'email'), criado_em timestamptz not null default now(),
  unique (projeto_id, numero)
);
create table if not exists public.pre_comentarios (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  versao_id uuid not null references public.pre_versoes(id) on delete cascade,
  x numeric(7,4), y numeric(7,4),                            -- posição do pino (0–1 da largura e da altura); vazio = geral
  texto text not null check (length(trim(texto)) > 0),
  origem text not null default 'interno' check (origem in ('interno', 'cliente')),
  interno boolean not null default false,                    -- nota da equipe: não aparece no portal
  resolvido boolean not null default false,
  autor text, user_id uuid default auth.uid(), criado_em timestamptz not null default now()
);
create index if not exists pre_com_versao on public.pre_comentarios(versao_id);
create table if not exists public.pre_decisoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  projeto_id uuid not null references public.pre_projetos(id) on delete cascade,
  versao_id uuid not null references public.pre_versoes(id) on delete cascade,
  decisao text not null check (decisao in ('aprovada', 'alteracao', 'reprovada')),
  comentario text, nome text,                                -- nome digitado por quem decidiu (assinatura)
  origem text not null check (origem in ('cliente', 'interno')),
  termo text, hash text not null,                            -- o termo aceito e o hash da versão no momento
  user_id uuid, email text, ip text, navegador text, evidencia text,
  criado_em timestamptz not null default now()
);
create index if not exists pre_dec_proj on public.pre_decisoes(projeto_id, criado_em);
create table if not exists public.pre_eventos (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  projeto_id uuid not null references public.pre_projetos(id) on delete cascade,
  tipo text not null, texto text not null, publico boolean not null default true,   -- publico: aparece no portal
  autor text default (auth.jwt() ->> 'email'), criado_em timestamptz not null default now()
);
create index if not exists pre_ev_proj on public.pre_eventos(projeto_id, criado_em);

-- 4) acesso interno
do $$ declare t text; begin
  foreach t in array array['pre_parametros', 'pre_projetos', 'pre_versoes', 'pre_comentarios', 'pre_decisoes', 'pre_eventos'] loop
    execute format('alter table public.%s enable row level security', t);
    execute format('drop policy if exists %1$s_sel on public.%1$s; drop policy if exists %1$s_ins on public.%1$s; drop policy if exists %1$s_upd on public.%1$s; drop policy if exists %1$s_del on public.%1$s;', t);
  end loop;
end $$;
create policy pre_parametros_sel on public.pre_parametros for select to authenticated using (public.is_participante(empresa_id));
create policy pre_parametros_ins on public.pre_parametros for insert to authenticated with check (public.pode_pcp(empresa_id));
create policy pre_parametros_upd on public.pre_parametros for update to authenticated using (public.pode_pcp(empresa_id)) with check (public.pode_pcp(empresa_id));
create policy pre_projetos_sel on public.pre_projetos for select to authenticated using (public.pre_ve(empresa_id, favorecido_id));
create policy pre_projetos_ins on public.pre_projetos for insert to authenticated with check (public.pre_pode(empresa_id, favorecido_id));
create policy pre_projetos_upd on public.pre_projetos for update to authenticated using (public.pre_pode(empresa_id, favorecido_id)) with check (public.pre_pode(empresa_id, favorecido_id));
do $$ declare t text; begin
  foreach t in array array['pre_versoes', 'pre_comentarios', 'pre_decisoes', 'pre_eventos'] loop
    execute format('create policy %1$s_sel on public.%1$s for select to authenticated using (exists (select 1 from pre_projetos p where p.id = %2$s and public.pre_ve(p.empresa_id, p.favorecido_id)))', t,
      case when t = 'pre_comentarios' then '(select v.projeto_id from pre_versoes v where v.id = versao_id)' else 'projeto_id' end);
  end loop;
end $$;
create policy pre_versoes_ins on public.pre_versoes for insert to authenticated with check (exists (select 1 from pre_projetos p where p.id = projeto_id and public.pre_pode(p.empresa_id, p.favorecido_id)));
create policy pre_versoes_upd on public.pre_versoes for update to authenticated using (exists (select 1 from pre_projetos p where p.id = projeto_id and public.pre_pode(p.empresa_id, p.favorecido_id)));
create policy pre_comentarios_ins on public.pre_comentarios for insert to authenticated with check (exists (select 1 from pre_versoes v join pre_projetos p on p.id = v.projeto_id where v.id = versao_id and public.pre_pode(p.empresa_id, p.favorecido_id)));
create policy pre_comentarios_upd on public.pre_comentarios for update to authenticated using (exists (select 1 from pre_versoes v join pre_projetos p on p.id = v.projeto_id where v.id = versao_id and public.pre_pode(p.empresa_id, p.favorecido_id)));
create policy pre_eventos_ins on public.pre_eventos for insert to authenticated with check (exists (select 1 from pre_projetos p where p.id = projeto_id and public.pre_pode(p.empresa_id, p.favorecido_id)));
grant select, insert, update on public.pre_parametros, public.pre_projetos, public.pre_versoes, public.pre_comentarios to authenticated;
grant select, insert on public.pre_eventos to authenticated;
grant select on public.pre_decisoes to authenticated;
grant usage, select on sequence public.pre_eventos_id_seq to authenticated;

-- 5) regras: numeração, versão imutável, situação só pelas funções, arquivado congelado, linha do tempo
create or replace function public._pre_regras() returns trigger
language plpgsql security definer set search_path = public as $$
declare p pre_projetos; j jsonb := to_jsonb(new);
begin
  if tg_table_name = 'pre_projetos' then
    if tg_op = 'INSERT' then
      if not exists (select 1 from favorecidos where id = new.favorecido_id and empresa_id = new.empresa_id) then raise exception 'Cliente de outra empresa.'; end if;
      perform pg_advisory_xact_lock(hashtext('pre_proj:' || new.empresa_id::text));
      select coalesce(max(numero), 0) + 1 into new.numero from pre_projetos where empresa_id = new.empresa_id;
      new.situacao := 'em_criacao';
    elsif current_setting('pre.funcao', true) is distinct from 'on' then
      if new.situacao is distinct from old.situacao and not (new.situacao = 'cancelada' and old.situacao not in ('liberada', 'cancelada')) and not (new.situacao = 'em_criacao' and old.situacao in ('alteracao_solicitada', 'reprovada')) then
        raise exception 'A situação da arte muda pelos botões (enviar ao cliente, aprovar, clicheria, liberar).'; end if;
      if (new.versao_aprovada_id, new.liberada_em, new.cliche_enviado_em, new.cliche_recebido_em, new.ferramenta_id) is distinct from (old.versao_aprovada_id, old.liberada_em, old.cliche_enviado_em, old.cliche_recebido_em, old.ferramenta_id) then
        raise exception 'Aprovação, clicheria e liberação mudam pelos botões.'; end if;
      if old.arquivado and new.arquivado and (new.nome, new.favorecido_id, new.produto_id) is distinct from (old.nome, old.favorecido_id, old.produto_id) then raise exception 'Arte arquivada: restaure para editar.'; end if;
      if new.situacao = 'cancelada' and old.situacao <> 'cancelada' and nullif(trim(coalesce(new.motivo, '')), '') is null then raise exception 'Informe o motivo do cancelamento.'; end if;
    end if;
    if new.produto_id is not null and not exists (select 1 from produtos where id = new.produto_id and empresa_id = new.empresa_id) then raise exception 'Produto de outra empresa.'; end if;
    if new.ean is not null then new.ean := regexp_replace(new.ean, '\D', '', 'g'); if new.ean = '' then new.ean := null; end if; end if;
    new.atualizado_em := now();
    return new;
  end if;
  if tg_table_name = 'pre_versoes' then
    select * into p from pre_projetos where id = new.projeto_id;
    if p.empresa_id <> new.empresa_id then raise exception 'Projeto de outra empresa.'; end if;
    if tg_op = 'INSERT' then
      if p.arquivado or p.situacao in ('cancelada', 'liberada') then raise exception 'Arte % %: não recebe versão nova.', p.numero, case when p.arquivado then 'arquivada' else p.situacao end; end if;
      perform pg_advisory_xact_lock(hashtext('pre_ver:' || new.projeto_id::text));
      select coalesce(max(numero), 0) + 1 into new.numero from pre_versoes where projeto_id = new.projeto_id;
      if current_setting('pre.funcao', true) is distinct from 'on' then new.origem := 'interno'; new.enviada_em := null; end if;
      if new.checklist = '[]'::jsonb then
        select coalesce(jsonb_agg(jsonb_build_object('item', x, 'ok', false)), '[]'::jsonb) into new.checklist from unnest((select checklist from pre_parametros where empresa_id = new.empresa_id)) x;
      end if;
    else
      if (new.caminho, new.hash, new.nome, new.numero, new.projeto_id, new.origem, new.previa, new.mm_largura, new.mm_altura) is distinct from (old.caminho, old.hash, old.nome, old.numero, old.projeto_id, old.origem, old.previa, old.mm_largura, old.mm_altura) then
        raise exception 'Versão % não muda: envie uma nova versão.', old.numero; end if;
      if old.enviada_em is not null and (new.checklist is distinct from old.checklist or new.observacao is distinct from old.observacao) then raise exception 'Versão % já foi ao cliente: não muda.', old.numero; end if;
      if new.enviada_em is distinct from old.enviada_em and current_setting('pre.funcao', true) is distinct from 'on' then raise exception 'Use "Enviar ao cliente".'; end if;
    end if;
    return new;
  end if;
  if tg_table_name = 'pre_comentarios' then
    if not exists (select 1 from pre_versoes v where v.id = new.versao_id and v.empresa_id = new.empresa_id) then raise exception 'Versão de outra empresa.'; end if;
    if tg_op = 'INSERT' and current_setting('pre.funcao', true) is distinct from 'on' then new.origem := 'interno'; new.autor := coalesce(new.autor, auth.jwt() ->> 'email'); end if;
    if tg_op = 'UPDATE' and (new.texto, new.x, new.y, new.origem) is distinct from (old.texto, old.x, old.y, old.origem) then raise exception 'Comentário não se edita: escreva outro.'; end if;
    return new;
  end if;
  return new;
end $$;
revoke all on function public._pre_regras() from public, anon, authenticated;
drop trigger if exists pre_projetos_regras on public.pre_projetos;
create trigger pre_projetos_regras before insert or update on public.pre_projetos for each row execute function public._pre_regras();
drop trigger if exists pre_versoes_regras on public.pre_versoes;
create trigger pre_versoes_regras before insert or update on public.pre_versoes for each row execute function public._pre_regras();
drop trigger if exists pre_comentarios_regras on public.pre_comentarios;
create trigger pre_comentarios_regras before insert or update on public.pre_comentarios for each row execute function public._pre_regras();

-- linha do tempo automática
create or replace function public._pre_evento() returns trigger
language plpgsql security definer set search_path = public as $$
declare nomes jsonb := '{"em_criacao":"Em criação","aguardando_cliente":"Aguardando o cliente","alteracao_solicitada":"Alteração solicitada","reprovada":"Reprovada","aprovada":"Aprovada","na_clicheria":"Na clicheria","liberada":"Liberada para produção","cancelada":"Cancelada"}';
begin
  if tg_table_name = 'pre_projetos' then
    if tg_op = 'INSERT' then insert into pre_eventos(empresa_id, projeto_id, tipo, texto) values (new.empresa_id, new.id, 'criado', 'Arte criada: ' || new.nome);
    elsif new.situacao is distinct from old.situacao then
      insert into pre_eventos(empresa_id, projeto_id, tipo, texto, publico) values (new.empresa_id, new.id, 'situacao', nomes ->> new.situacao || coalesce(' — ' || nullif(new.motivo, ''), ''), new.situacao <> 'em_criacao');
    elsif new.arquivado is distinct from old.arquivado then
      insert into pre_eventos(empresa_id, projeto_id, tipo, texto, publico) values (new.empresa_id, new.id, 'arquivo', case when new.arquivado then 'Arquivada' else 'Restaurada' end, false);
    end if;
  elsif tg_table_name = 'pre_versoes' then
    insert into pre_eventos(empresa_id, projeto_id, tipo, texto, publico, autor)
    values (new.empresa_id, new.projeto_id, 'versao', 'Versão ' || new.numero || case when new.origem = 'cliente' then ' enviada pelo cliente' else ' criada' end || coalesce(': ' || nullif(new.observacao, ''), ''), new.origem = 'cliente', new.enviado_por);
  end if;
  return null;
end $$;
revoke all on function public._pre_evento() from public, anon, authenticated;
drop trigger if exists pre_projetos_evento on public.pre_projetos;
create trigger pre_projetos_evento after insert or update on public.pre_projetos for each row execute function public._pre_evento();
drop trigger if exists pre_versoes_evento on public.pre_versoes;
create trigger pre_versoes_evento after insert on public.pre_versoes for each row execute function public._pre_evento();

create or replace function public.pre_pode_liberar(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros m left join pre_parametros p on p.empresa_id = m.empresa_id
                 where m.empresa_id = p_empresa and m.user_id = auth.uid()
                   and (m.papel::text = 'admin' or m.papel::text = any(coalesce(p.papeis_liberacao, array['admin', 'diretor', 'financeiro']))));
$$;
grant execute on function public.pre_pode_liberar(uuid) to authenticated;

-- IP e navegador de quem chamou (PostgREST põe os cabeçalhos da requisição em request.headers)
create or replace function public._pre_origem() returns jsonb language plpgsql stable set search_path = public as $$
declare h jsonb;
begin
  begin h := nullif(current_setting('request.headers', true), '')::jsonb; exception when others then h := null; end;
  return jsonb_build_object('ip', coalesce(nullif(trim(split_part(h ->> 'x-forwarded-for', ',', 1)), ''), h ->> 'x-real-ip', h ->> 'cf-connecting-ip'), 'navegador', left(h ->> 'user-agent', 300));
end $$;

-- 6) lado interno: enviar ao cliente, registrar decisão recebida por fora, clicheria, liberar, arquivar
create or replace function public.pre_enviar_cliente(p_versao uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v pre_versoes; p pre_projetos; qp pre_parametros; v_falta int;
begin
  select * into v from pre_versoes where id = p_versao;
  select * into p from pre_projetos where id = v.projeto_id for update;
  if v.id is null or not pre_pode(p.empresa_id, p.favorecido_id) then raise exception 'Sem permissão.'; end if;
  if p.arquivado or p.situacao in ('cancelada', 'liberada', 'na_clicheria') then raise exception 'Arte % em %: não vai ao cliente.', p.numero, p.situacao; end if;
  if v.numero <> (select max(numero) from pre_versoes where projeto_id = p.id) then raise exception 'Só a versão mais recente vai ao cliente.'; end if;
  if v.enviada_em is not null then raise exception 'Versão % já enviada.', v.numero; end if;
  select * into qp from pre_parametros where empresa_id = p.empresa_id;
  if coalesce(qp.exigir_checklist, true) then
    select count(*) into v_falta from jsonb_array_elements(v.checklist) x where not coalesce((x ->> 'ok')::boolean, false);
    if v_falta > 0 then raise exception 'Faltam % item(ns) do checklist de pré-impressão.', v_falta; end if;
  end if;
  if v.previa is null then raise exception 'A versão não tem a prévia em imagem: envie o arquivo de novo.'; end if;
  perform set_config('pre.funcao', 'on', true);
  update pre_versoes set enviada_em = now() where id = v.id;
  update pre_projetos set situacao = 'aguardando_cliente', prazo = coalesce(prazo, current_date + coalesce(qp.prazo_cliente_dias, 3)) where id = p.id;
  insert into pre_eventos(empresa_id, projeto_id, tipo, texto) values (p.empresa_id, p.id, 'enviada', 'Versão ' || v.numero || ' enviada para aprovação');
  perform set_config('pre.funcao', 'off', true);
  return 'aguardando_cliente';
end $$;

-- decisão: núcleo comum do portal e do registro interno
create or replace function public._pre_decidir(p_versao uuid, p_decisao text, p_comentario text, p_nome text, p_origem text, p_evidencia text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v pre_versoes; p pre_projetos; qp pre_parametros; o jsonb := _pre_origem(); v_id uuid; v_sit text;
begin
  select * into v from pre_versoes where id = p_versao;
  select * into p from pre_projetos where id = v.projeto_id for update;
  if p_decisao not in ('aprovada', 'alteracao', 'reprovada') then raise exception 'Decisão inválida.'; end if;
  if p.arquivado or p.situacao <> 'aguardando_cliente' then raise exception 'Esta arte não está aguardando aprovação.'; end if;
  if v.enviada_em is null or v.numero <> (select max(numero) from pre_versoes where projeto_id = p.id and enviada_em is not null) then
    raise exception 'Só a última versão enviada pode ser decidida.'; end if;
  if v.numero <> (select max(numero) from pre_versoes where projeto_id = p.id) then raise exception 'Há uma versão mais nova em preparação: aguarde o envio.'; end if;
  if p_decisao = 'aprovada' and nullif(trim(coalesce(p_nome, '')), '') is null then raise exception 'Para aprovar, digite seu nome completo (assinatura).'; end if;
  if p_decisao <> 'aprovada' and nullif(trim(coalesce(p_comentario, '')), '') is null and not exists (select 1 from pre_comentarios where versao_id = v.id and not interno and origem = p_origem) then
    raise exception 'Diga o que precisa mudar (no comentário ou com pinos na arte).'; end if;
  select * into qp from pre_parametros where empresa_id = p.empresa_id;
  insert into pre_decisoes(empresa_id, projeto_id, versao_id, decisao, comentario, nome, origem, termo, hash, user_id, email, ip, navegador, evidencia)
  values (p.empresa_id, p.id, v.id, p_decisao, nullif(trim(coalesce(p_comentario, '')), ''), nullif(trim(coalesce(p_nome, '')), ''), p_origem,
          case when p_decisao = 'aprovada' then coalesce(qp.termo, '') end, v.hash, auth.uid(), auth.jwt() ->> 'email', o ->> 'ip', o ->> 'navegador', p_evidencia)
  returning id into v_id;
  v_sit := case p_decisao when 'aprovada' then 'aprovada' when 'alteracao' then 'alteracao_solicitada' else 'reprovada' end;
  perform set_config('pre.funcao', 'on', true);
  update pre_projetos set situacao = v_sit, versao_aprovada_id = case when p_decisao = 'aprovada' then v.id else versao_aprovada_id end, motivo = null where id = p.id;
  insert into pre_eventos(empresa_id, projeto_id, tipo, texto)
  values (p.empresa_id, p.id, 'decisao', case p_decisao when 'aprovada' then 'Versão ' || v.numero || ' APROVADA por ' || trim(p_nome) when 'alteracao' then 'Alteração pedida na versão ' || v.numero else 'Versão ' || v.numero || ' reprovada' end
          || case when p_origem = 'interno' then ' (registrada pela equipe)' else '' end || coalesce(': ' || nullif(trim(p_comentario), ''), ''));
  perform set_config('pre.funcao', 'off', true);
  return jsonb_build_object('id', v_id, 'situacao', v_sit, 'hash', v.hash, 'versao', v.numero);
end $$;
revoke all on function public._pre_decidir(uuid, text, text, text, text, text), public._pre_origem() from public, anon, authenticated;

create or replace function public.pre_registrar_decisao(p_versao uuid, p_decisao text, p_comentario text, p_nome text, p_evidencia text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p pre_projetos;
begin
  select pp.* into p from pre_projetos pp join pre_versoes v on v.projeto_id = pp.id where v.id = p_versao;
  if p.id is null or not pre_pode_liberar(p.empresa_id) then raise exception 'Só quem libera a pré-impressão registra a decisão recebida por e-mail ou mensagem.'; end if;
  if nullif(trim(coalesce(p_evidencia, '')), '') is null then raise exception 'Anexe a evidência (e-mail ou mensagem do cliente).'; end if;
  return _pre_decidir(p_versao, p_decisao, p_comentario, p_nome, 'interno', p_evidencia);
end $$;

create or replace function public.pre_clicheria(p_projeto uuid, p_acao text, p_fornecedor uuid default null, p_data date default null, p_previsto date default null,
  p_custo numeric default null, p_qtd int default null, p_criar_ferramenta boolean default true)
returns text language plpgsql security definer set search_path = public as $$
declare p pre_projetos; v_f uuid; v_cod text;
begin
  select * into p from pre_projetos where id = p_projeto for update;
  if p.id is null or not pre_pode(p.empresa_id, p.favorecido_id) then raise exception 'Sem permissão.'; end if;
  perform set_config('pre.funcao', 'on', true);
  if p_acao = 'enviar' then
    if p.situacao <> 'aprovada' then raise exception 'Só arte aprovada vai para a clicheria.'; end if;
    update pre_projetos set situacao = 'na_clicheria', clicheria_id = coalesce(p_fornecedor, clicheria_id), cliche_enviado_em = coalesce(p_data, current_date), cliche_previsto = p_previsto,
           cliche_custo = coalesce(p_custo, cliche_custo), cliche_qtd = coalesce(p_qtd, cliche_qtd, jsonb_array_length(cores)) where id = p.id;
    insert into pre_eventos(empresa_id, projeto_id, tipo, texto) values (p.empresa_id, p.id, 'clicheria', 'Arte enviada para a clicheria' || coalesce(' (previsão ' || to_char(p_previsto, 'DD/MM') || ')', ''));
  elsif p_acao = 'receber' then
    if p.situacao <> 'na_clicheria' then raise exception 'A arte não está na clicheria.'; end if;
    if coalesce(p_criar_ferramenta, true) then
      v_cod := 'CL-' || lpad(p.numero::text, 4, '0') || '-V' || (select numero from pre_versoes where id = p.versao_aprovada_id);
      insert into prod_ferramentas(empresa_id, tipo, codigo, descricao, produto_id, favorecido_id, cores, localizacao, situacao, observacao)
      values (p.empresa_id, 'cliche', v_cod, left('Clichê ' || p.nome, 200), p.produto_id, p.favorecido_id, coalesce(p_qtd, p.cliche_qtd, jsonb_array_length(p.cores))::smallint, 'Pré-impressão', 'ativa', 'Arte ' || p.numero)
      on conflict (empresa_id, codigo) do update set situacao = 'ativa' returning id into v_f;
    end if;
    update pre_projetos set cliche_recebido_em = coalesce(p_data, current_date), cliche_custo = coalesce(p_custo, cliche_custo), cliche_qtd = coalesce(p_qtd, cliche_qtd), ferramenta_id = coalesce(v_f, ferramenta_id) where id = p.id;
    insert into pre_eventos(empresa_id, projeto_id, tipo, texto, publico) values (p.empresa_id, p.id, 'clicheria', 'Clichês recebidos' || coalesce(' — ferramenta ' || v_cod, ''), false);
  else raise exception 'Ação inválida.'; end if;
  perform set_config('pre.funcao', 'off', true);
  return p_acao;
end $$;

create or replace function public.pre_liberar(p_projeto uuid)
returns text language plpgsql security definer set search_path = public as $$
declare p pre_projetos;
begin
  select * into p from pre_projetos where id = p_projeto for update;
  if p.id is null or not pre_pode_liberar(p.empresa_id) then raise exception 'Seu perfil não libera arte para a produção.'; end if;
  if p.situacao not in ('aprovada', 'na_clicheria') or p.versao_aprovada_id is null then raise exception 'Só arte aprovada é liberada.'; end if;
  if p.situacao = 'na_clicheria' and p.cliche_recebido_em is null then raise exception 'Os clichês ainda não chegaram.'; end if;
  perform set_config('pre.funcao', 'on', true);
  update pre_projetos set situacao = 'liberada', liberada_em = now(), liberada_por = auth.jwt() ->> 'email' where id = p.id;
  perform set_config('pre.funcao', 'off', true);
  return 'liberada';
end $$;
revoke all on function public.pre_enviar_cliente(uuid), public.pre_registrar_decisao(uuid, text, text, text, text), public.pre_clicheria(uuid, text, uuid, date, date, numeric, int, boolean), public.pre_liberar(uuid) from public, anon;
grant execute on function public.pre_enviar_cliente(uuid), public.pre_registrar_decisao(uuid, text, text, text, text), public.pre_clicheria(uuid, text, uuid, date, date, numeric, int, boolean), public.pre_liberar(uuid) to authenticated;

-- arte em vigor de um produto (a mais recente não cancelada) — usada na OP e na trava
create or replace function public.pre_arte_produto(p_produto uuid)
returns table(projeto_id uuid, numero int, situacao text, versao int, ok boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.numero, p.situacao, (select numero from pre_versoes where id = p.versao_aprovada_id), p.situacao in ('aprovada', 'na_clicheria', 'liberada')
    from pre_projetos p where p.produto_id = p_produto and p.situacao <> 'cancelada' and not p.arquivado
     and (is_participante(p.empresa_id)) order by p.criado_em desc limit 1;
$$;
grant execute on function public.pre_arte_produto(uuid) to authenticated;

-- trava opcional: a OP não vai para liberada/em produção se a arte mais recente do produto não estiver aprovada
create or replace function public._pre_trava_op() returns trigger
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if new.status in ('liberada', 'em_producao') and old.status is distinct from new.status and new.produto_id is not null
     and coalesce((select bloquear_op from pre_parametros where empresa_id = new.empresa_id), false) then
    select p.numero, p.situacao into a from pre_projetos p where p.produto_id = new.produto_id and p.situacao <> 'cancelada' and not p.arquivado order by p.criado_em desc limit 1;
    if a.numero is not null and a.situacao not in ('aprovada', 'na_clicheria', 'liberada') then
      raise exception 'OP %: a arte % do produto ainda não foi aprovada pelo cliente (Pré-impressão).', new.numero, a.numero; end if;
  end if;
  return new;
end $$;
revoke all on function public._pre_trava_op() from public, anon, authenticated;
drop trigger if exists prod_ordens_arte on public.prod_ordens;
create trigger prod_ordens_arte before update of status on public.prod_ordens for each row execute function public._pre_trava_op();

-- 7) lado do cliente (portal): só funções, só os projetos do favorecido do portal, nunca os arquivados nem as notas internas
create or replace function public.portal_artes(p_fav uuid)
returns table(id uuid, numero int, nome text, codigo_cliente text, situacao text, versao int, versao_id uuid, enviada_em timestamptz, prazo date, pendente boolean, atualizado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.numero, p.nome, p.codigo_cliente, p.situacao, v.numero, v.id, v.enviada_em, p.prazo, p.situacao = 'aguardando_cliente', p.atualizado_em
    from pre_projetos p
    left join lateral (select * from pre_versoes x where x.projeto_id = p.id and (x.enviada_em is not null or x.origem = 'cliente') order by x.numero desc limit 1) v on true
   where portal_meu(p_fav) and p.favorecido_id = p_fav and not p.arquivado and p.situacao <> 'cancelada'
     and exists (select 1 from pre_versoes x where x.projeto_id = p.id and (x.enviada_em is not null or x.origem = 'cliente'))
   order by (p.situacao = 'aguardando_cliente') desc, p.atualizado_em desc;
$$;

create or replace function public.portal_arte(p_fav uuid, p_projeto uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p pre_projetos;
begin
  select * into p from pre_projetos where id = p_projeto and favorecido_id = p_fav and not arquivado;
  if p.id is null or not portal_meu(p_fav) then raise exception 'Arte não encontrada.'; end if;
  return jsonb_build_object(
    'projeto', jsonb_build_object('id', p.id, 'numero', p.numero, 'nome', p.nome, 'codigo_cliente', p.codigo_cliente, 'situacao', p.situacao, 'prazo', p.prazo,
      'largura_mm', p.largura_mm, 'altura_mm', p.altura_mm, 'substrato', p.substrato, 'processo', p.processo, 'cores', p.cores, 'ean', p.ean, 'desbobinamento', p.desbobinamento,
      'versao_aprovada_id', p.versao_aprovada_id, 'empresa_id', p.empresa_id),
    'termo', coalesce((select termo from pre_parametros where empresa_id = p.empresa_id), ''),
    'versoes', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'numero', v.numero, 'nome', v.nome, 'tipo', v.tipo, 'tamanho', v.tamanho, 'hash', v.hash, 'caminho', v.caminho,
      'previa', v.previa, 'previa_largura', v.previa_largura, 'previa_altura', v.previa_altura, 'mm_largura', v.mm_largura, 'mm_altura', v.mm_altura, 'paginas', v.paginas, 'observacao', v.observacao, 'origem', v.origem, 'enviada_em', v.enviada_em, 'criado_em', v.criado_em) order by v.numero)
      from pre_versoes v where v.projeto_id = p.id and (v.enviada_em is not null or v.origem = 'cliente')), '[]'::jsonb),
    'comentarios', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'versao_id', c.versao_id, 'x', c.x, 'y', c.y, 'texto', c.texto, 'origem', c.origem, 'autor', case when c.origem = 'cliente' then c.autor else 'Equipe' end,
      'resolvido', c.resolvido, 'criado_em', c.criado_em) order by c.criado_em)
      from pre_comentarios c join pre_versoes v on v.id = c.versao_id where v.projeto_id = p.id and not c.interno and (v.enviada_em is not null or v.origem = 'cliente')), '[]'::jsonb),
    'decisoes', coalesce((select jsonb_agg(jsonb_build_object('versao_id', d.versao_id, 'decisao', d.decisao, 'comentario', d.comentario, 'nome', d.nome, 'origem', d.origem, 'hash', d.hash, 'criado_em', d.criado_em) order by d.criado_em)
      from pre_decisoes d where d.projeto_id = p.id), '[]'::jsonb),
    'eventos', coalesce((select jsonb_agg(jsonb_build_object('texto', e.texto, 'criado_em', e.criado_em) order by e.criado_em) from pre_eventos e where e.projeto_id = p.id and e.publico), '[]'::jsonb));
end $$;

create or replace function public.portal_arte_comentar(p_fav uuid, p_versao uuid, p_x numeric, p_y numeric, p_texto text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v pre_versoes; p pre_projetos; v_id uuid; v_nome text;
begin
  select * into v from pre_versoes where id = p_versao;
  select * into p from pre_projetos where id = v.projeto_id;
  if p.id is null or p.favorecido_id <> p_fav or not portal_meu(p_fav) or p.arquivado then raise exception 'Arte não encontrada.'; end if;
  if v.enviada_em is null and v.origem <> 'cliente' then raise exception 'Versão não disponível.'; end if;
  if p.situacao in ('cancelada', 'liberada') then raise exception 'Arte encerrada.'; end if;
  if nullif(trim(coalesce(p_texto, '')), '') is null then raise exception 'Escreva o comentário.'; end if;
  if (p_x is not null and (p_x < 0 or p_x > 1)) or (p_y is not null and (p_y < 0 or p_y > 1)) then raise exception 'Posição inválida.'; end if;
  select email into v_nome from portal_usuarios where user_id = auth.uid() and favorecido_id = p_fav limit 1;
  perform set_config('pre.funcao', 'on', true);
  insert into pre_comentarios(empresa_id, versao_id, x, y, texto, origem, interno, autor) values (p.empresa_id, v.id, p_x, p_y, left(trim(p_texto), 2000), 'cliente', false, v_nome) returning id into v_id;
  perform set_config('pre.funcao', 'off', true);
  return v_id;
end $$;

create or replace function public.portal_arte_decidir(p_fav uuid, p_versao uuid, p_decisao text, p_comentario text, p_nome text, p_aceite boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p pre_projetos;
begin
  select pp.* into p from pre_projetos pp join pre_versoes v on v.projeto_id = pp.id where v.id = p_versao;
  if p.id is null or p.favorecido_id <> p_fav or not portal_meu(p_fav) then raise exception 'Arte não encontrada.'; end if;
  if p_decisao = 'aprovada' and not coalesce(p_aceite, false) then raise exception 'Para aprovar, marque a declaração de conferência da arte.'; end if;
  return _pre_decidir(p_versao, p_decisao, p_comentario, p_nome, 'cliente', null);
end $$;

-- cliente envia um arquivo (arte nova dele ou correção): a arte volta para a equipe revisar
create or replace function public.portal_arte_enviar(p_fav uuid, p_projeto uuid, p_caminho text, p_previa text, p_nome text, p_tipo text, p_tamanho bigint, p_hash text,
  p_obs text, p_largura int default null, p_altura int default null, p_mm_largura numeric default null, p_mm_altura numeric default null, p_paginas int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare p pre_projetos; v_id uuid;
begin
  select * into p from pre_projetos where id = p_projeto for update;
  if p.id is null or p.favorecido_id <> p_fav or not portal_meu(p_fav) or p.arquivado then raise exception 'Arte não encontrada.'; end if;
  if p.situacao in ('cancelada', 'liberada', 'na_clicheria', 'aprovada') then raise exception 'Arte já aprovada: para mudar, fale com a equipe (gera uma arte nova).'; end if;
  if p_caminho is null or split_part(p_caminho, '/', 1) <> p.empresa_id::text or split_part(p_caminho, '/', 2) <> p.id::text then raise exception 'Arquivo inválido.'; end if;
  if p_previa is not null and (split_part(p_previa, '/', 1) <> p.empresa_id::text or split_part(p_previa, '/', 2) <> p.id::text) then raise exception 'Prévia inválida.'; end if;
  if p_tamanho > 52428800 then raise exception 'Arquivo maior que 50 MB.'; end if;
  perform set_config('pre.funcao', 'on', true);
  insert into pre_versoes(empresa_id, projeto_id, caminho, nome, tipo, tamanho, hash, previa, previa_largura, previa_altura, mm_largura, mm_altura, paginas, observacao, origem, enviado_por)
  values (p.empresa_id, p.id, p_caminho, left(p_nome, 200), p_tipo, p_tamanho, lower(p_hash), p_previa, p_largura, p_altura, p_mm_largura, p_mm_altura, p_paginas, nullif(trim(coalesce(p_obs, '')), ''), 'cliente',
          (select email from portal_usuarios where user_id = auth.uid() and favorecido_id = p_fav limit 1))
  returning id into v_id;
  update pre_projetos set situacao = 'em_criacao' where id = p.id;
  perform set_config('pre.funcao', 'off', true);
  return v_id;
end $$;
revoke all on function public.portal_artes(uuid), public.portal_arte(uuid, uuid), public.portal_arte_comentar(uuid, uuid, numeric, numeric, text),
  public.portal_arte_decidir(uuid, uuid, text, text, text, boolean), public.portal_arte_enviar(uuid, uuid, text, text, text, text, bigint, text, text, int, int, numeric, numeric, int) from public, anon;
grant execute on function public.portal_artes(uuid), public.portal_arte(uuid, uuid), public.portal_arte_comentar(uuid, uuid, numeric, numeric, text),
  public.portal_arte_decidir(uuid, uuid, text, text, text, boolean), public.portal_arte_enviar(uuid, uuid, text, text, text, text, bigint, text, text, int, int, numeric, numeric, int) to authenticated;

-- 8) arquivos: artes/<empresa>/<projeto>/<arquivo> — equipe pelo projeto; cliente do portal só os do próprio projeto
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('artes', 'artes', false, 52428800, array['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/tiff', 'application/postscript', 'application/illustrator', 'application/octet-stream'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create or replace function public._pre_arquivo(p_nome text, p_escrever boolean)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from pre_projetos p
                  where p.id = _uuid_ou_nulo((storage.foldername(p_nome))[2]) and p.empresa_id = _uuid_ou_nulo((storage.foldername(p_nome))[1])
                    and (case when p_escrever then pre_pode(p.empresa_id, p.favorecido_id) else pre_ve(p.empresa_id, p.favorecido_id) end
                         or (not p.arquivado and portal_meu(p.favorecido_id)
                             and case when p_escrever then p.situacao not in ('cancelada', 'liberada', 'na_clicheria', 'aprovada')
                                      -- o cliente só lê os arquivos das versões que foram a ele (nunca os rascunhos da equipe)
                                      else exists (select 1 from pre_versoes v where v.projeto_id = p.id and (v.enviada_em is not null or v.origem = 'cliente') and p_nome in (v.caminho, v.previa)) end)));
$$;
grant execute on function public._pre_arquivo(text, boolean) to authenticated;
drop policy if exists artes_arq_sel on storage.objects;
drop policy if exists artes_arq_ins on storage.objects;
create policy artes_arq_sel on storage.objects for select to authenticated using (bucket_id = 'artes' and public._pre_arquivo(name, false));
create policy artes_arq_ins on storage.objects for insert to authenticated with check (bucket_id = 'artes' and public._pre_arquivo(name, true));

-- 9) auditoria
do $$ declare t text; begin
  if to_regprocedure('public._auditar()') is not null then
    foreach t in array array['pre_parametros', 'pre_projetos', 'pre_versoes', 'pre_decisoes'] loop
      execute format('drop trigger if exists zz_auditoria on public.%s', t);
      execute format('create trigger zz_auditoria after insert or update or delete on public.%s for each row execute function public._auditar()', t);
    end loop;
  end if;
end $$;

-- conferência: tabelas = 6, funções do portal = 5, bucket = 1
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'pre\_%') as tabelas,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('portal_artes', 'portal_arte', 'portal_arte_comentar', 'portal_arte_decidir', 'portal_arte_enviar')) as funcoes_portal,
       (select count(*) from storage.buckets where id = 'artes') as bucket;
