-- RMA — Relatório Mensal de Atividades da recuperação judicial (Financeiro › RMA — Recuperação Judicial, FIN026).
-- Pedido do Renan em 16/11/2026: função que só existe para a empresa que a ativar (a IPLAMM está em recuperação judicial).
-- O escritório que acompanha a recuperação tem plataforma própria; aqui fica o padrão do que a empresa envia todo mês:
-- a lista de documentos pedidos, um pacote por mês com a situação de cada documento, os arquivos (gerados pela plataforma
-- ou anexados), o prazo e o registro do envio. Aditivo: só cria objetos novos.

create table if not exists public.rma_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ativo boolean not null default false,
  papeis text[] not null default array['financeiro', 'diretor'],            -- além do administrador
  sigla text not null default 'EMPRESA' check (sigla ~ '^[A-Za-z0-9]{2,20}$'), -- começo do nome dos arquivos
  processo text, vara text,                                                  -- nº do processo e juízo da recuperação
  escritorio text, contato_nome text, contato_email text,                    -- quem recebe o RMA
  mes_inicio date not null default date_trunc('month', current_date)::date,  -- primeiro mês de competência a entregar
  dia_entrega smallint not null default 20 check (dia_entrega between 1 and 28),  -- dia do mês seguinte
  dias_aviso smallint not null default 5 check (dias_aviso between 0 and 30),
  avisar boolean not null default true,
  atualizado_em timestamptz not null default now()
);

create or replace function public.rma_pode(p_empresa uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros m where m.empresa_id = p_empresa and m.user_id = auth.uid()
    and (m.papel::text = 'admin' or m.papel::text = any(coalesce((select papeis from rma_config where empresa_id = p_empresa), array['financeiro', 'diretor']))));
$$;
grant execute on function public.rma_pode(uuid) to authenticated;

-- lista do que é entregue todo mês (cada empresa ajusta a sua)
create table if not exists public.rma_documentos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  codigo text not null check (codigo ~ '^[0-9A-Za-z.\-]{1,8}$'),
  grupo text not null default 'Geral',
  nome text not null,
  arquivo text not null,                                                      -- trecho do nome do arquivo, sem acento nem espaço
  fonte text not null default 'anexo' check (fonte in ('anexo', 'fluxo_caixa', 'titulos', 'faturamento', 'notas_emitidas', 'vendas', 'contratos')),
  tela text,                                                                  -- rota da tela de onde sai o documento, quando é anexado
  formatos text[] not null default array['pdf'],
  obrigatorio boolean not null default true,
  orientacao text,
  ordem int not null default 0,
  ativo boolean not null default true,
  unique (empresa_id, codigo)
);

create table if not exists public.rma_meses (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  mes date not null check (mes = date_trunc('month', mes)::date),
  prazo date not null,
  status text not null default 'aberto' check (status in ('aberto', 'enviado')),
  enviado_em timestamptz, enviado_por uuid, protocolo text,
  comentario text,                                                            -- comentários da administração sobre o mês
  criado_em timestamptz not null default now(),
  primary key (empresa_id, mes)
);

create table if not exists public.rma_entregas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null,
  mes date not null,
  documento_id uuid not null references public.rma_documentos(id) on delete cascade,
  status text not null default 'pendente' check (status in ('pendente', 'pronto', 'nao_aplica')),
  justificativa text,
  responsavel_id uuid,
  observacao text,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  foreign key (empresa_id, mes) references public.rma_meses(empresa_id, mes) on delete cascade,
  unique (empresa_id, mes, documento_id),
  check (status <> 'nao_aplica' or coalesce(btrim(justificativa), '') <> '')
);
create index if not exists rma_entregas_mes on public.rma_entregas(empresa_id, mes);

create table if not exists public.rma_arquivos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  entrega_id uuid not null references public.rma_entregas(id) on delete cascade,
  nome text not null, caminho text not null, tamanho int,
  origem text not null default 'anexo' check (origem in ('anexo', 'gerado')),
  por uuid default auth.uid(), em timestamptz not null default now()
);
create index if not exists rma_arquivos_ent on public.rma_arquivos(entrega_id);

-- ---------------------------------------------------------------- acesso
do $$ declare t text; begin
  foreach t in array array['rma_documentos', 'rma_meses', 'rma_entregas', 'rma_arquivos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_membro(empresa_id) or public.rma_pode(empresa_id))', t || '_sel', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.rma_pode(empresa_id))', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.rma_pode(empresa_id)) with check (public.rma_pode(empresa_id))', t || '_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.rma_pode(empresa_id))', t || '_del', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop trigger if exists zz_auditoria on public.%I', t);
    execute format('create trigger zz_auditoria after insert or update or delete on public.%I for each row execute function public._auditar()', t);
  end loop;
end $$;
alter table public.rma_config enable row level security;
drop policy if exists rma_config_sel on public.rma_config;
create policy rma_config_sel on public.rma_config for select to authenticated using (public.is_participante(empresa_id));   -- o menu de todos precisa saber se está ligado
drop policy if exists rma_config_ins on public.rma_config;
create policy rma_config_ins on public.rma_config for insert to authenticated with check (public.is_admin(empresa_id));
drop policy if exists rma_config_upd on public.rma_config;
create policy rma_config_upd on public.rma_config for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
grant select, insert, update on public.rma_config to authenticated;
drop trigger if exists zz_auditoria on public.rma_config;
create trigger zz_auditoria after insert or update or delete on public.rma_config for each row execute function public._auditar();

insert into public.notif_tipos(codigo, grupo, nome, descricao, urgente, ordem)
values ('rma', 'Financeiro', 'RMA da recuperação judicial', 'Prazo de entrega do Relatório Mensal de Atividades chegando ou vencido, e pacote enviado.', false, 47)
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------- lista padrão (a do escritório que acompanha a recuperação, em 16/11/2026)
create or replace function public.rma_documentos_padrao(p_empresa uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is not null and not is_admin(p_empresa) then raise exception 'Só o administrador cria a lista de documentos.'; end if;
  insert into rma_documentos(empresa_id, codigo, grupo, nome, arquivo, fonte, tela, formatos, ordem, orientacao)
  select p_empresa, v.codigo, v.grupo, v.nome, v.arquivo, v.fonte, v.tela, v.formatos, v.ordem, v.orientacao
    from (values
      ('01', 'Departamento Contábil', 'Balancete de verificação mensal (PDF e Excel)', 'Balancete', 'anexo', 'contab/balancete', array['pdf', 'xlsx'], 10, 'O balancete oficial vem da contabilidade. Anexe o PDF e a planilha do mês.'),
      ('02', 'Departamento Contábil', 'Demonstração de Resultado do Exercício (DRE)', 'DRE', 'anexo', 'contab/dre', array['pdf'], 20, 'DRE contábil do mês, emitida pela contabilidade.'),
      ('03', 'Departamento Contábil', 'Balanço patrimonial (quando encerrado o período)', 'Balanco_Patrimonial', 'anexo', 'contab/balanco', array['pdf'], 30, 'Só nos meses em que há balanço encerrado. Nos demais, marque "não se aplica" com o motivo.'),
      ('04', 'Departamento Financeiro', 'Fluxo de caixa', 'Fluxo_de_Caixa', 'fluxo_caixa', 'fluxo-mensal', array['pdf', 'xlsx'], 40, 'Gerado pela plataforma: entradas e saídas pagas no mês por conta do plano, e saldo das contas.'),
      ('06', 'Departamento Financeiro', 'Extratos bancários completos de todas as contas de titularidade da recuperanda', 'Extratos_Bancarios', 'anexo', 'conciliacao', array['pdf'], 60, 'Um extrato por conta, do primeiro ao último dia do mês, baixado do banco.'),
      ('07', 'Departamento Financeiro', 'Relatórios de contas a pagar e a receber', 'Contas_a_Pagar_e_Receber', 'titulos', 'contas', array['pdf', 'xlsx'], 70, 'Gerado pela plataforma: títulos em aberto no último dia do mês.'),
      ('08', 'Departamento Financeiro', 'Relatório de faturamento mensal', 'Faturamento_Mensal', 'faturamento', 'notas', array['pdf', 'xlsx'], 80, 'Gerado pela plataforma a partir das notas de saída do mês.'),
      ('09', 'Relatórios', 'Relação de notas fiscais emitidas', 'Notas_Fiscais_Emitidas', 'notas_emitidas', 'notas', array['pdf', 'xlsx'], 90, 'Gerado pela plataforma: todas as notas emitidas no mês, inclusive as canceladas.'),
      ('10', 'Relatórios', 'Relatório de produção e/ou vendas', 'Producao_e_Vendas', 'vendas', 'producao', array['pdf', 'xlsx'], 100, 'Gerado pela plataforma: vendas do mês por cliente. Anexe também o relatório de produção, se for pedido.'),
      ('11', 'Relatórios', 'Relatório de estoque, quando aplicável', 'Estoque', 'anexo', 'estoque', array['pdf'], 110, 'Posição do estoque no último dia do mês.'),
      ('12', 'Relatórios', 'Relação de contratos firmados, alterados ou rescindidos no período', 'Contratos_do_Periodo', 'contratos', 'contratos', array['pdf', 'xlsx'], 120, 'Gerado pela plataforma a partir de Cadastros › Contratos.'),
      ('13', 'Geral', 'Relação atualizada de processos judiciais e administrativos', 'Processos_Judiciais', 'anexo', null, array['pdf'], 130, 'Relação fornecida pelo jurídico.'),
      ('14', 'Geral', 'Informações sobre constrições judiciais eventualmente existentes', 'Constricoes_Judiciais', 'anexo', null, array['pdf'], 140, 'Bloqueios, penhoras e arrestos do mês. Sem ocorrência, marque "não se aplica" e escreva "sem constrições no período".')
    ) as v(codigo, grupo, nome, arquivo, fonte, tela, formatos, ordem, orientacao)
   where not exists (select 1 from rma_documentos d where d.empresa_id = p_empresa and d.codigo = v.codigo);
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.rma_documentos_padrao(uuid) to authenticated;

-- ---------------------------------------------------------------- regras
create or replace function public._rma_documento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.arquivo := regexp_replace(btrim(new.arquivo), '[^A-Za-z0-9_\-]+', '_', 'g');
  if new.arquivo = '' then raise exception 'Informe o nome do arquivo do documento.'; end if;
  if cardinality(new.formatos) = 0 or not (new.formatos <@ array['pdf', 'xlsx']) then raise exception 'Formatos aceitos: pdf e xlsx.'; end if;
  return new;
end $$;
drop trigger if exists rma_documento_regras on public.rma_documentos;
create trigger rma_documento_regras before insert or update on public.rma_documentos for each row execute function public._rma_documento();

-- abre o pacote do mês: uma entrega para cada documento ativo (pode ser chamada de novo: só completa o que falta)
create or replace function public.rma_abrir_mes(p_empresa uuid, p_mes date) returns int
language plpgsql security definer set search_path = public as $$
declare c rma_config; v_mes date := date_trunc('month', p_mes)::date; n int;
begin
  if not rma_pode(p_empresa) then raise exception 'Sem permissão para abrir o RMA.'; end if;
  select * into c from rma_config where empresa_id = p_empresa;
  if not coalesce(c.ativo, false) then raise exception 'O RMA não está ativado para esta empresa.'; end if;
  if v_mes < c.mes_inicio then raise exception 'O primeiro mês do RMA desta empresa é %.', to_char(c.mes_inicio, 'MM/YYYY'); end if;
  if v_mes > date_trunc('month', current_date)::date then raise exception 'Não é possível abrir um mês que ainda não começou.'; end if;
  insert into rma_meses(empresa_id, mes, prazo) values (p_empresa, v_mes, (v_mes + interval '1 month')::date + (c.dia_entrega - 1)) on conflict do nothing;
  if (select status from rma_meses where empresa_id = p_empresa and mes = v_mes) = 'enviado' then return 0; end if;
  insert into rma_entregas(empresa_id, mes, documento_id)
  select p_empresa, v_mes, d.id from rma_documentos d where d.empresa_id = p_empresa and d.ativo on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.rma_abrir_mes(uuid, date) to authenticated;

create or replace function public._rma_entrega() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; m rma_meses;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  select * into m from rma_meses where empresa_id = r.empresa_id and mes = r.mes;
  if m.status = 'enviado' and auth.uid() is not null then raise exception 'O RMA de % já foi enviado: reabra o mês para alterar.', to_char(r.mes, 'MM/YYYY'); end if;
  if tg_op = 'DELETE' then return old; end if;
  if not exists (select 1 from rma_documentos where id = new.documento_id and empresa_id = new.empresa_id) then raise exception 'Documento de outra empresa.'; end if;
  if new.status = 'pronto' and not exists (select 1 from rma_arquivos where entrega_id = new.id) then raise exception 'Anexe ou gere o arquivo antes de marcar como pronto.'; end if;
  if new.status <> 'nao_aplica' then new.justificativa := null; end if;
  new.atualizado_em := now(); new.atualizado_por := coalesce(auth.uid(), new.atualizado_por);
  return new;
end $$;
drop trigger if exists rma_entrega_regras on public.rma_entregas;
create trigger rma_entrega_regras before insert or update or delete on public.rma_entregas for each row execute function public._rma_entrega();

-- arquivo incluído deixa a entrega pronta; sem nenhum arquivo, ela volta a pendente
create or replace function public._rma_arquivo() returns trigger
language plpgsql security definer set search_path = public as $$
declare e rma_entregas; m rma_meses; v_id uuid;
begin
  v_id := case when tg_op = 'DELETE' then old.entrega_id else new.entrega_id end;
  select * into e from rma_entregas where id = v_id;
  if e.id is null then return null; end if;                                   -- entrega saindo em cascata
  select * into m from rma_meses where empresa_id = e.empresa_id and mes = e.mes;
  if m.status = 'enviado' and auth.uid() is not null then raise exception 'O RMA de % já foi enviado: reabra o mês para alterar.', to_char(e.mes, 'MM/YYYY'); end if;
  if tg_op = 'INSERT' then
    if new.empresa_id <> e.empresa_id then raise exception 'Arquivo de outra empresa.'; end if;
    update rma_entregas set status = 'pronto' where id = e.id and status <> 'pronto';
  elsif not exists (select 1 from rma_arquivos where entrega_id = e.id) then
    update rma_entregas set status = 'pendente' where id = e.id and status = 'pronto';
  end if;
  return null;
end $$;
drop trigger if exists rma_arquivo_regras on public.rma_arquivos;
create trigger rma_arquivo_regras after insert or delete on public.rma_arquivos for each row execute function public._rma_arquivo();

-- registra o envio: todo documento obrigatório precisa estar pronto ou justificado como "não se aplica"
create or replace function public.rma_enviar(p_empresa uuid, p_mes date, p_protocolo text default null, p_comentario text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', p_mes)::date; v_falta text; c rma_config; v_users uuid[];
begin
  if not rma_pode(p_empresa) then raise exception 'Sem permissão para registrar o envio do RMA.'; end if;
  if not exists (select 1 from rma_meses where empresa_id = p_empresa and mes = v_mes and status = 'aberto') then raise exception 'Mês não aberto ou já enviado.'; end if;
  select string_agg(d.codigo || ' ' || d.nome, '; ' order by d.ordem) into v_falta
    from rma_entregas e join rma_documentos d on d.id = e.documento_id where e.empresa_id = p_empresa and e.mes = v_mes and e.status = 'pendente' and d.obrigatorio;
  if v_falta is not null then raise exception 'Ainda falta: %', left(v_falta, 400); end if;
  update rma_meses set status = 'enviado', enviado_em = now(), enviado_por = auth.uid(), protocolo = nullif(btrim(p_protocolo), ''), comentario = coalesce(nullif(btrim(p_comentario), ''), comentario)
   where empresa_id = p_empresa and mes = v_mes;
  select * into c from rma_config where empresa_id = p_empresa;
  if coalesce(c.avisar, true) then
    select array_agg(m.user_id) into v_users from membros m where m.empresa_id = p_empresa and m.user_id is distinct from auth.uid() and (m.papel::text = 'admin' or m.papel::text = any(c.papeis));
    if v_users is not null then perform _notificar(p_empresa, v_users, 'rma', format('RMA de %s enviado', to_char(v_mes, 'MM/YYYY')), coalesce('Protocolo ' || nullif(btrim(p_protocolo), ''), 'Envio registrado na plataforma.'), 'rma?mes=' || to_char(v_mes, 'YYYY-MM'), null); end if;
  end if;
end $$;
grant execute on function public.rma_enviar(uuid, date, text, text) to authenticated;

create or replace function public.rma_reabrir(p_empresa uuid, p_mes date, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not rma_pode(p_empresa) then raise exception 'Sem permissão para reabrir o RMA.'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Informe o motivo da reabertura.'; end if;
  update rma_meses set status = 'aberto', comentario = concat_ws(E'\n', comentario, format('Reaberto em %s: %s', to_char(now() at time zone 'America/Recife', 'DD/MM/YYYY'), btrim(p_motivo)))
   where empresa_id = p_empresa and mes = date_trunc('month', p_mes)::date and status = 'enviado';
  if not found then raise exception 'Este mês não está enviado.'; end if;
end $$;
grant execute on function public.rma_reabrir(uuid, date, text) to authenticated;

-- ---------------------------------------------------------------- arquivos
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rma', 'rma', false, 26214400, array['image/png', 'image/jpeg', 'application/pdf', 'application/zip', 'text/csv', 'text/plain',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;
drop policy if exists rma_arq_sel on storage.objects;
drop policy if exists rma_arq_ins on storage.objects;
drop policy if exists rma_arq_del on storage.objects;
create policy rma_arq_sel on storage.objects for select to authenticated using (bucket_id = 'rma' and (public.is_membro(public._uuid_ou_nulo((storage.foldername(name))[1])) or public.rma_pode(public._uuid_ou_nulo((storage.foldername(name))[1]))));
create policy rma_arq_ins on storage.objects for insert to authenticated with check (bucket_id = 'rma' and public.rma_pode(public._uuid_ou_nulo((storage.foldername(name))[1])));
create policy rma_arq_del on storage.objects for delete to authenticated using (bucket_id = 'rma' and public.rma_pode(public._uuid_ou_nulo((storage.foldername(name))[1])));
