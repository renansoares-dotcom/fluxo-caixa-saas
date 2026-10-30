-- =====================================================================
-- Cadastros › Empresa — identidade visual e crachás (30/10/2026, Renan: "Aprovo sim"; impressão em A4 para recortar e plastificar).
--  - empresa_identidade: nome de exibição, razão social dos documentos, cores, logos, unidades, contatos e rodapé
--  - espaço de arquivos "empresa" (privado): <empresa>/identidade/... (logos) e <empresa>/fotos/... (fotos dos crachás)
--  - rh_colaboradores: foto e data da autorização de uso de imagem (LGPD)
--  - crachas: cada crachá emitido (colaborador, terceiro ou visitante), com código do QR, validade, via e devolução
--  - cracha_verificar(codigo): página pública do QR Code — mostra só empresa, nome, tipo, situação e validade
-- Quem edita: identidade = administrador; crachás e fotos = quem edita o RH. Migração ADITIVA; pode rodar mais de uma vez.
-- =====================================================================
create table if not exists public.empresa_identidade (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  nome_exibicao text,                        -- como a empresa aparece na plataforma e nos crachás
  razao_documentos text,                     -- linha do cabeçalho dos relatórios e contratos
  cor_primaria text not null default '#2b5598',
  cor_secundaria text not null default '#2a1f6f',
  cor_destaque text not null default '#0a8ed3',
  logo_path text, logo_escuro_path text, icone_path text,
  site text, email text, telefone text,
  unidades jsonb not null default '[]'::jsonb, -- [{nome, cnpj, endereco, municipio, uf, cep}]
  rodape_documentos text,                    -- ex.: endereço e contatos no rodapé de contratos
  cracha_validade_meses smallint not null default 24 check (cracha_validade_meses between 1 and 120),
  cracha_verso text,                         -- texto do verso (ex.: "Uso obrigatório nas dependências...")
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid()
);
alter table public.empresa_identidade enable row level security;
drop policy if exists empresa_identidade_sel on public.empresa_identidade;
drop policy if exists empresa_identidade_ins on public.empresa_identidade;
drop policy if exists empresa_identidade_upd on public.empresa_identidade;
create policy empresa_identidade_sel on public.empresa_identidade for select to authenticated using (is_membro(empresa_id) or is_participante(empresa_id));
create policy empresa_identidade_ins on public.empresa_identidade for insert to authenticated with check (is_admin(empresa_id));
create policy empresa_identidade_upd on public.empresa_identidade for update to authenticated using (is_admin(empresa_id)) with check (is_admin(empresa_id));
grant select, insert, update on public.empresa_identidade to authenticated;
do $$ begin
  begin
    alter table public.empresa_identidade add constraint empresa_identidade_cores check (cor_primaria ~ '^#[0-9a-fA-F]{6}$' and cor_secundaria ~ '^#[0-9a-fA-F]{6}$' and cor_destaque ~ '^#[0-9a-fA-F]{6}$');
  exception when duplicate_object then null; end;
end $$;

alter table public.rh_colaboradores add column if not exists foto_path text;
alter table public.rh_colaboradores add column if not exists autorizacao_imagem date;   -- data em que assinou a autorização de uso de imagem

create table if not exists public.crachas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null default 'colaborador' check (tipo in ('colaborador', 'terceiro', 'visitante')),
  colaborador_id uuid references public.rh_colaboradores(id) on delete set null,
  nome text not null,
  cargo text, setor text, matricula text,
  empresa_terceiro text,                     -- terceiro: empresa prestadora; visitante: de onde vem
  documento text,                            -- terceiro/visitante: CPF ou RG (só para controle interno; não vai no QR)
  foto_path text,
  codigo text not null unique default substr(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 1, 24),   -- vai no QR Code
  via smallint not null default 1,
  emitido_em date not null default current_date,
  validade date,
  status text not null default 'ativo' check (status in ('ativo', 'devolvido', 'cancelado', 'extraviado')),
  baixado_em date, motivo text,
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now()
);
create index if not exists crachas_emp on public.crachas(empresa_id, status, nome);
create index if not exists crachas_colab on public.crachas(colaborador_id);
alter table public.crachas enable row level security;
drop policy if exists crachas_sel on public.crachas;
drop policy if exists crachas_ins on public.crachas;
drop policy if exists crachas_upd on public.crachas;
drop policy if exists crachas_del on public.crachas;
create policy crachas_sel on public.crachas for select to authenticated using (ve_rh(empresa_id));
create policy crachas_ins on public.crachas for insert to authenticated with check (edita_rh(empresa_id));
create policy crachas_upd on public.crachas for update to authenticated using (edita_rh(empresa_id)) with check (edita_rh(empresa_id));
create policy crachas_del on public.crachas for delete to authenticated using (edita_rh(empresa_id));
grant select, insert, update, delete on public.crachas to authenticated;

-- 2ª via: cancela a anterior da mesma pessoa e numera a via (feito no banco para não haver dois ativos)
create or replace function public.cracha_emitir(p_cracha jsonb) returns public.crachas
language plpgsql security definer set search_path = public as $$
declare e uuid := (p_cracha->>'empresa_id')::uuid; c uuid := nullif(p_cracha->>'colaborador_id', '')::uuid; v int := 1; r crachas;
begin
  if not edita_rh(e) then raise exception 'Sem permissão para emitir crachás.'; end if;
  if c is not null then
    select coalesce(max(via), 0) + 1 into v from crachas where empresa_id = e and colaborador_id = c;
    update crachas set status = 'cancelado', baixado_em = current_date, motivo = coalesce(motivo, 'substituído pela via ' || v)
     where empresa_id = e and colaborador_id = c and status = 'ativo';
  end if;
  insert into crachas (empresa_id, tipo, colaborador_id, nome, cargo, setor, matricula, empresa_terceiro, documento, foto_path, via, validade)
  values (e, coalesce(p_cracha->>'tipo', 'colaborador'), c, p_cracha->>'nome', p_cracha->>'cargo', p_cracha->>'setor', p_cracha->>'matricula',
          p_cracha->>'empresa_terceiro', p_cracha->>'documento', p_cracha->>'foto_path', v, nullif(p_cracha->>'validade', '')::date)
  returning * into r;
  return r;
end $$;
revoke execute on function public.cracha_emitir(jsonb) from public, anon;
grant execute on function public.cracha_emitir(jsonb) to authenticated, service_role;

-- verificação pública pelo QR Code (sem login): só o necessário para conferir o portador
create or replace function public.cracha_verificar(p_codigo text)
returns table(empresa text, nome text, tipo text, cargo text, situacao text, validade date)
language sql stable security definer set search_path = public as $$
  select coalesce(i.nome_exibicao, e.nome), c.nome, c.tipo, case when c.tipo = 'colaborador' then c.cargo end,
         case when c.status <> 'ativo' then c.status
              when c.validade is not null and c.validade < current_date then 'vencido'
              when c.tipo = 'colaborador' and exists (select 1 from rh_colaboradores r where r.id = c.colaborador_id and r.situacao = 'desligado') then 'cancelado'
              else 'ativo' end,
         c.validade
    from crachas c join empresas e on e.id = c.empresa_id left join empresa_identidade i on i.empresa_id = c.empresa_id
   where c.codigo = p_codigo and length(p_codigo) = 24;
$$;
revoke execute on function public.cracha_verificar(text) from public;
grant execute on function public.cracha_verificar(text) to anon, authenticated, service_role;

-- arquivos: empresa/<empresa>/identidade/<arquivo> (logos) · empresa/<empresa>/fotos/<arquivo> (fotos dos crachás)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('empresa', 'empresa', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create or replace function public._empresa_arq(p_nome text, p_gravar boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select case (storage.foldername(p_nome))[2]
    when 'identidade' then case when p_gravar then is_admin(_uuid_ou_nulo((storage.foldername(p_nome))[1])) else is_membro(_uuid_ou_nulo((storage.foldername(p_nome))[1])) or is_participante(_uuid_ou_nulo((storage.foldername(p_nome))[1])) end
    when 'fotos' then case when p_gravar then edita_rh(_uuid_ou_nulo((storage.foldername(p_nome))[1])) else ve_rh(_uuid_ou_nulo((storage.foldername(p_nome))[1])) end
    else false end;
$$;
revoke execute on function public._empresa_arq(text, boolean) from public, anon;
grant execute on function public._empresa_arq(text, boolean) to authenticated, service_role;
drop policy if exists empresa_arq_sel on storage.objects;
drop policy if exists empresa_arq_ins on storage.objects;
drop policy if exists empresa_arq_upd on storage.objects;
drop policy if exists empresa_arq_del on storage.objects;
create policy empresa_arq_sel on storage.objects for select to authenticated using (bucket_id = 'empresa' and public._empresa_arq(name, false));
create policy empresa_arq_ins on storage.objects for insert to authenticated with check (bucket_id = 'empresa' and public._empresa_arq(name, true));
create policy empresa_arq_upd on storage.objects for update to authenticated using (bucket_id = 'empresa' and public._empresa_arq(name, true));
create policy empresa_arq_del on storage.objects for delete to authenticated using (bucket_id = 'empresa' and public._empresa_arq(name, true));

-- auditoria (o que mudou e quem mudou)
do $$ begin
  if to_regprocedure('public._auditar()') is not null then
    drop trigger if exists zz_auditoria on public.empresa_identidade;
    create trigger zz_auditoria after insert or update or delete on public.empresa_identidade for each row execute function public._auditar();
    drop trigger if exists zz_auditoria on public.crachas;
    create trigger zz_auditoria after insert or update or delete on public.crachas for each row execute function public._auditar();
  end if;
end $$;

-- conferência: tabelas = 2, colunas = 2, funcoes = 3, bucket = 1
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('empresa_identidade', 'crachas')) as tabelas,
       (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'rh_colaboradores' and column_name in ('foto_path', 'autorizacao_imagem')) as colunas,
       (select count(*) from pg_proc where proname in ('cracha_emitir', 'cracha_verificar', '_empresa_arq')) as funcoes,
       (select count(*) from storage.buckets where id = 'empresa') as bucket;
