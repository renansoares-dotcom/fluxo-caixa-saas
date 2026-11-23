-- 195 — Arquivo Morto: pastas dentro da caixa e digitalização (23/11/2026, Renan: "Queria poder scanear os arquivos da pasta
-- referente a etiqueta"). Decisões: a digitalização fica presa à PASTA dentro da caixa, cada pasta com a sua etiqueta (menor);
-- os PDFs vêm do scanner; o papel continua seguindo o prazo de guarda (a cópia digital é para consulta, não libera descarte).
--   1. arq_pastas: pasta numerada dentro da caixa (0003.02), com etiqueta F0000000, título, tipo de documento e período.
--   2. arq_arquivos: os PDFs de cada pasta, guardados no armazenamento privado "arquivo" (até 50 MB cada).
--      Caminho: <empresa>/<caixa>/<pasta>/<id>.pdf. Ver e baixar: quem vê a caixa (as do RH continuam restritas).
--      Enviar e apagar: quem cuida do arquivo.
--   3. Tamanho da etiqueta da pasta nos parâmetros do arquivo (padrão 70 × 35 mm).
-- Aditivo.

alter table public.arq_config add column if not exists pasta_largura_mm int not null default 70 check (pasta_largura_mm between 30 and 210);
alter table public.arq_config add column if not exists pasta_altura_mm int not null default 35 check (pasta_altura_mm between 15 and 297);

create table if not exists public.arq_pastas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  caixa_id uuid not null references public.arq_caixas(id) on delete cascade,
  numero int not null,
  etiqueta text not null default ('F' || lpad(nextval('public.etiqueta_seq')::text, 7, '0')),
  titulo text not null check (length(titulo) between 2 and 120),
  tipo_id uuid references public.arq_tipos(id),
  inicio date, fim date, check (fim is null or inicio is null or fim >= inicio),
  descricao text check (length(descricao) <= 300),
  criado_por uuid default auth.uid(), criado_em timestamptz not null default now(),
  unique (caixa_id, numero)
);
create unique index if not exists arq_pastas_etiqueta on public.arq_pastas (etiqueta);
drop trigger if exists arq_pastas_etq_fixa on public.arq_pastas;
create trigger arq_pastas_etq_fixa before update of etiqueta on public.arq_pastas for each row execute function public._etq_fixa();

create table if not exists public.arq_arquivos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  pasta_id uuid not null references public.arq_pastas(id) on delete cascade,
  caminho text not null unique,
  nome text not null check (length(nome) between 1 and 200),
  tamanho bigint,
  enviado_por uuid default auth.uid(), enviado_nome text, enviado_em timestamptz not null default now()
);
create index if not exists arq_arquivos_pasta on public.arq_arquivos (pasta_id);

alter table public.arq_pastas enable row level security;
alter table public.arq_arquivos enable row level security;
revoke all on public.arq_pastas, public.arq_arquivos from anon, authenticated;
grant select on public.arq_pastas, public.arq_arquivos to authenticated;
drop policy if exists arq_pastas_ler on public.arq_pastas;
create policy arq_pastas_ler on public.arq_pastas for select to authenticated using (exists (select 1 from public.arq_caixas c where c.id = caixa_id));
drop policy if exists arq_arquivos_ler on public.arq_arquivos;
create policy arq_arquivos_ler on public.arq_arquivos for select to authenticated using (exists (select 1 from public.arq_pastas p where p.id = pasta_id));

-- quem pode enviar e apagar PDFs da pasta: quem cuida do arquivo e vê a caixa; caixa não descartada para enviar
create or replace function public._arq_pasta_mexe(p_pasta uuid, p_enviar boolean default true) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select public._arq_gestor(c.empresa_id) and public._arq_ve(c.empresa_id, c.area) and (not p_enviar or c.situacao <> 'descartada')
                     from arq_pastas p join arq_caixas c on c.id = p.caixa_id where p.id = p_pasta), false);
$$;
-- o caminho do arquivo confere com a pasta: <empresa>/<caixa>/<pasta>/<arquivo>
create or replace function public._arq_caminho_ok(p_nome text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (storage.foldername(p_nome))[1] = p.empresa_id::text and (storage.foldername(p_nome))[2] = p.caixa_id::text and array_length(storage.foldername(p_nome), 1) = 3
                     from arq_pastas p where p.id = public._uuid_ou_nulo((storage.foldername(p_nome))[3])), false);
$$;

-- ------------------------------------------------------------ armazenamento privado
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('arquivo', 'arquivo', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;
drop policy if exists arquivo_sel on storage.objects;
drop policy if exists arquivo_ins on storage.objects;
drop policy if exists arquivo_del on storage.objects;
create policy arquivo_sel on storage.objects for select to authenticated
  using (bucket_id = 'arquivo' and (exists (select 1 from public.arq_arquivos a where a.caminho = name)
         or (public._arq_caminho_ok(name) and public._arq_pasta_mexe(public._uuid_ou_nulo((storage.foldername(name))[3]), false))));   -- quem cuida vê também o que ainda não foi registrado (para apagar)
create policy arquivo_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'arquivo' and public._arq_caminho_ok(name) and public._arq_pasta_mexe(public._uuid_ou_nulo((storage.foldername(name))[3]), true));
create policy arquivo_del on storage.objects for delete to authenticated
  using (bucket_id = 'arquivo' and public._arq_caminho_ok(name) and public._arq_pasta_mexe(public._uuid_ou_nulo((storage.foldername(name))[3]), false)
         and not exists (select 1 from public.arq_arquivos a where a.caminho = name));   -- apaga o registro primeiro (arq_arquivo_excluir)

-- ------------------------------------------------------------ pastas
-- p = { id?, caixa_id, titulo, tipo_id, inicio, fim, descricao }
create or replace function public.arq_pasta_salvar(p_empresa uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare c arq_caixas; v_id uuid := nullif(p->>'id', '')::uuid; v_cx uuid; v_ini date := nullif(p->>'inicio', '')::date; v_fim date := nullif(p->>'fim', '')::date;
  v_tipo uuid := nullif(p->>'tipo_id', '')::uuid;
begin
  if v_id is not null then select caixa_id into v_cx from arq_pastas where id = v_id and empresa_id = p_empresa; if not found then raise exception 'Pasta não encontrada.'; end if;
  else v_cx := nullif(p->>'caixa_id', '')::uuid; end if;
  select * into c from arq_caixas where id = v_cx and empresa_id = p_empresa for update;
  if not found or not public._arq_gestor(p_empresa) or not public._arq_ve(p_empresa, c.area) then raise exception 'Só quem cuida do arquivo cadastra pastas.'; end if;
  if c.situacao = 'descartada' then raise exception 'A caixa % foi descartada.', c.numero; end if;
  if length(btrim(coalesce(p->>'titulo', ''))) < 2 then raise exception 'Informe o título da pasta.'; end if;
  if v_tipo is not null and not exists (select 1 from arq_tipos where id = v_tipo and empresa_id = p_empresa) then raise exception 'Tipo de documento não encontrado.'; end if;
  if v_ini is not null and v_fim is not null and v_fim < v_ini then raise exception 'Período invertido.'; end if;
  if v_id is null then
    insert into arq_pastas (empresa_id, caixa_id, numero, titulo, tipo_id, inicio, fim, descricao)
      values (p_empresa, c.id, (select coalesce(max(numero), 0) + 1 from arq_pastas where caixa_id = c.id), btrim(p->>'titulo'), v_tipo, v_ini, v_fim, nullif(btrim(coalesce(p->>'descricao', '')), ''))
      returning id into v_id;
  else
    update arq_pastas set titulo = btrim(p->>'titulo'), tipo_id = v_tipo, inicio = v_ini, fim = v_fim, descricao = nullif(btrim(coalesce(p->>'descricao', '')), '') where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.arq_pasta_excluir(p_pasta uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pa arq_pastas;
begin
  select * into pa from arq_pastas where id = p_pasta for update;
  if not found or not public._arq_pasta_mexe(p_pasta, true) then raise exception 'Pasta não encontrada ou sem permissão.'; end if;
  if exists (select 1 from arq_arquivos where pasta_id = p_pasta) then raise exception 'A pasta tem arquivos digitalizados. Apague os arquivos antes.'; end if;
  delete from arq_pastas where id = p_pasta;
end $$;

-- ------------------------------------------------------------ arquivos digitalizados
-- depois de enviar o PDF ao armazenamento, registra o arquivo na pasta (confere que o arquivo existe e está no caminho da pasta)
create or replace function public.arq_arquivo_registrar(p_pasta uuid, p_caminho text, p_nome text)
returns uuid language plpgsql security definer set search_path = public as $$
declare pa arq_pastas; o record; v_id uuid;
begin
  select * into pa from arq_pastas where id = p_pasta;
  if not found or not public._arq_pasta_mexe(p_pasta, true) then raise exception 'Só quem cuida do arquivo envia a digitalização.'; end if;
  if p_caminho is null or p_caminho not like pa.empresa_id || '/' || pa.caixa_id || '/' || pa.id || '/%' or not public._arq_caminho_ok(p_caminho) then raise exception 'Caminho do arquivo não confere com a pasta.'; end if;
  select name, (metadata->>'size')::bigint tam, metadata->>'mimetype' mime into o from storage.objects where bucket_id = 'arquivo' and name = p_caminho;
  if not found then raise exception 'Arquivo não encontrado no armazenamento. Envie de novo.'; end if;
  if coalesce(o.mime, 'application/pdf') <> 'application/pdf' then raise exception 'Só PDF.'; end if;
  insert into arq_arquivos (empresa_id, pasta_id, caminho, nome, tamanho, enviado_nome)
    values (pa.empresa_id, pa.id, p_caminho, left(coalesce(nullif(btrim(p_nome), ''), 'digitalizacao.pdf'), 200), o.tam, public._arq_nome())
  on conflict (caminho) do nothing returning id into v_id;
  if v_id is null then raise exception 'Este arquivo já está registrado.'; end if;
  return v_id;
end $$;

-- apaga o registro e devolve o caminho; a tela apaga o arquivo do armazenamento em seguida (a política só deixa apagar sem registro)
create or replace function public.arq_arquivo_excluir(p_arquivo uuid)
returns text language plpgsql security definer set search_path = public as $$
declare a arq_arquivos;
begin
  select * into a from arq_arquivos where id = p_arquivo for update;
  if not found or not public._arq_pasta_mexe(a.pasta_id, false) then raise exception 'Arquivo não encontrado ou sem permissão.'; end if;
  delete from arq_arquivos where id = a.id;
  return a.caminho;
end $$;

-- ------------------------------------------------------------ parâmetros: tamanho da etiqueta da pasta (os demais seguem como no 194)
create or replace function public.arq_config_salvar(p_empresa uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_pap text[] := array['admin', 'financeiro', 'diretor', 'compras', 'producao', 'vendas', 'leitura'];
  g text[] := case when p ? 'papeis_gestor' then array(select jsonb_array_elements_text(p->'papeis_gestor')) else '{admin,financeiro,diretor}' end;
  cs text[] := case when p ? 'papeis_consulta' then array(select jsonb_array_elements_text(p->'papeis_consulta')) else '{admin,financeiro,diretor,compras}' end;
  d text[] := case when p ? 'papeis_descarte' then array(select jsonb_array_elements_text(p->'papeis_descarte')) else '{admin,diretor}' end;
  a uuid[] := case when p ? 'arquivistas' then array(select (jsonb_array_elements_text(p->'arquivistas'))::uuid) else '{}' end;
  v_dias int := coalesce((p->>'emprestimo_dias')::int, 7); v_susp boolean := coalesce((p->>'descarte_suspenso')::boolean, false);
  v_pl int := coalesce((p->>'pasta_largura_mm')::int, (select pasta_largura_mm from arq_config where empresa_id = p_empresa), 70);
  v_pa int := coalesce((p->>'pasta_altura_mm')::int, (select pasta_altura_mm from arq_config where empresa_id = p_empresa), 35);
begin
  if public._arq_papel(p_empresa) is distinct from 'admin' then raise exception 'Só o administrador muda os parâmetros do arquivo.'; end if;
  if not (g <@ v_pap and cs <@ v_pap and d <@ v_pap) then raise exception 'Perfil inválido.'; end if;
  if cardinality(g) = 0 then raise exception 'Escolha pelo menos um perfil que cuida do arquivo.'; end if;
  if cardinality(d) = 0 or not (d && array['admin', 'diretor']) then raise exception 'O descarte precisa ser aprovado pelo administrador ou pelo diretor (inclua pelo menos um).'; end if;
  if exists (select 1 from unnest(a) x where not exists (select 1 from membros m where m.empresa_id = p_empresa and m.user_id = x)) then raise exception 'Pessoa que não é da empresa na lista de quem cuida do arquivo.'; end if;
  if v_dias < 1 or v_dias > 90 then raise exception 'Prazo de devolução: de 1 a 90 dias.'; end if;
  if v_pl < 30 or v_pl > 210 or v_pa < 15 or v_pa > 297 then raise exception 'Etiqueta da pasta: largura de 30 a 210 mm, altura de 15 a 297 mm.'; end if;
  if v_susp and length(btrim(coalesce(p->>'descarte_suspenso_motivo', ''))) < 5 then raise exception 'Informe o motivo da suspensão do descarte.'; end if;
  insert into arq_config (empresa_id, papeis_gestor, arquivistas, papeis_consulta, papeis_descarte, emprestimo_dias, descarte_suspenso, descarte_suspenso_motivo, pasta_largura_mm, pasta_altura_mm)
    values (p_empresa, g, a, cs, d, v_dias, v_susp, nullif(btrim(coalesce(p->>'descarte_suspenso_motivo', '')), ''), v_pl, v_pa)
  on conflict (empresa_id) do update set papeis_gestor = excluded.papeis_gestor, arquivistas = excluded.arquivistas, papeis_consulta = excluded.papeis_consulta,
    papeis_descarte = excluded.papeis_descarte, emprestimo_dias = excluded.emprestimo_dias, descarte_suspenso = excluded.descarte_suspenso,
    descarte_suspenso_motivo = excluded.descarte_suspenso_motivo, pasta_largura_mm = excluded.pasta_largura_mm, pasta_altura_mm = excluded.pasta_altura_mm, atualizado_em = now();
end $$;

-- _arq_cfg monta a linha padrão com todas as colunas (inclusive as novas)
create or replace function public._arq_cfg(p_empresa uuid) returns public.arq_config
language plpgsql stable security definer set search_path = public as $$
declare c arq_config;
begin
  select * into c from arq_config where empresa_id = p_empresa;
  if not found then c.empresa_id := p_empresa; c.papeis_gestor := '{admin,financeiro,diretor}'; c.arquivistas := '{}'; c.papeis_consulta := '{admin,financeiro,diretor,compras}';
    c.papeis_descarte := '{admin,diretor}'; c.emprestimo_dias := 7; c.descarte_suspenso := false; c.pasta_largura_mm := 70; c.pasta_altura_mm := 35; end if;
  return c;
end $$;

revoke all on function public._arq_cfg(uuid), public._arq_pasta_mexe(uuid, boolean), public._arq_caminho_ok(text) from public, anon;
revoke all on function public._arq_cfg(uuid) from authenticated;
grant execute on function public._arq_pasta_mexe(uuid, boolean), public._arq_caminho_ok(text) to authenticated;   -- usadas nas políticas do armazenamento
do $$ declare f text; begin
  foreach f in array array['public.arq_pasta_salvar(uuid, jsonb)', 'public.arq_pasta_excluir(uuid)', 'public.arq_arquivo_registrar(uuid, text, text)',
                           'public.arq_arquivo_excluir(uuid)', 'public.arq_config_salvar(uuid, jsonb)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
