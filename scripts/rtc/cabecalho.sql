-- 171 — Reforma Tributária: tabelas oficiais de classificação do IBS/CBS (19/11/2026, pedido do Renan)
-- A Receita Federal abriu o código da Calculadora de Tributos (Portaria Cotec 342/2026, licença MIT) em
-- github.com/ReceitaFederal/calculadora-rtc-regime-regular. Junto com o código vem a base oficial: CST, cClassTrib com vigência,
-- redução de alíquota, indicadores de crédito e o vínculo NCM ↔ cClassTrib dos anexos da LC 214/2025.
-- Aqui a plataforma guarda essa base (só CBS/IBS; o Imposto Seletivo fica de fora) para:
--   * a Conferência IBS/CBS dizer se o cClassTrib da nota existe, está em vigor, combina com o CST, vale para o documento e aceita o NCM;
--   * a emissão de NF-e sugerir e validar o CST e o cClassTrib antes de enviar.
-- São tabelas de referência, iguais para todas as empresas: todo usuário logado lê, ninguém grava pela tela.
-- ESTE ARQUIVO É GERADO por scripts/rtc/gerar-sql.py (não editar os INSERTs à mão). Para atualizar: gerar uma migração nova.
-- Aditivo.

create table if not exists public.rtc_base (
  id smallint primary key default 1 check (id = 1),
  versao_base text not null,                    -- última migração da base da Receita (ex.: V0059)
  calculadora text, commit text, fonte text,
  linhas jsonb,
  carregada_em timestamptz not null default now()
);
create table if not exists public.rtc_cst (
  cst text primary key,
  descricao text not null,
  inicio date not null, fim date,
  grupo_ibscbs boolean not null default false,   -- o CST exige o grupo de valores do IBS/CBS na nota
  reducao boolean not null default false,        -- admite redução de alíquota
  diferimento boolean not null default false
);
create table if not exists public.rtc_classtrib (
  codigo text primary key,                       -- cClassTrib (6 dígitos)
  cst text not null references public.rtc_cst(cst),
  descricao text not null,
  tipo_aliquota text, nomenclatura text, anexo text,
  red_cbs numeric(7,4) not null default 0, red_ibs_uf numeric(7,4) not null default 0, red_ibs_mun numeric(7,4) not null default 0,   -- % de redução da alíquota
  credito_adquirente_cbs boolean not null default false, credito_adquirente_ibs boolean not null default false,
  credito_antecedente text,                      -- Manutenção | Anulação do crédito da operação anterior
  credito_presumido_fornecedor boolean not null default false, credito_presumido_adquirente boolean not null default false,
  fundamento text,
  inicio date not null, fim date,
  modelos int[] not null default '{}',           -- modelos de documento que aceitam a classificação (55 NF-e, 65 NFC-e, 57 CT-e, 91 NFS-e...)
  atualizado_em date
);
create table if not exists public.rtc_classtrib_ncm (
  id int primary key,
  codigo text not null references public.rtc_classtrib(codigo) on delete cascade,
  ncm text not null,                             -- NCM ou começo dele (2 a 8 dígitos)
  inicio date not null, fim date
);
create index if not exists rtc_classtrib_ncm_c on public.rtc_classtrib_ncm(codigo);
create table if not exists public.rtc_classtrib_ncm_exc (
  id int primary key,
  vinculo_id int not null references public.rtc_classtrib_ncm(id) on delete cascade,
  ncm text not null,                             -- NCM (ou começo) que fica de fora do vínculo
  inicio date not null, fim date
);

do $$ declare t text; begin
  foreach t in array array['rtc_base', 'rtc_cst', 'rtc_classtrib', 'rtc_classtrib_ncm', 'rtc_classtrib_ncm_exc'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_leitura', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_leitura', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
  end loop;
end $$;
