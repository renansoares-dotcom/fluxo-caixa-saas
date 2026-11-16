-- 159 · Fretes: retenções do transportador autônomo PESSOA FÍSICA (INSS, SEST/SENAT e IRRF) no CIOT, no pagamento e no financeiro.
-- Aditiva. Pode rodar mais de uma vez.
--  - log_retencao_param: percentuais, teto do INSS e tabela do IRRF por empresa e vigência (regra do Renan: nada fixo no código).
--    Valores iniciais de 2026 gravados como "a confirmar com a contabilidade" (conferido = false).
--  - log_transportadores.dependentes: nº de dependentes do autônomo para o IRRF.
--  - log_fretes.retencoes: o que foi retido no frete {inss, sest_senat, irrf, total, liquido, base_inss, base_irrf, vigencia, memoria, lancamentos}.
--  - efrete_config.retencao_pagamento: 'liquido' (as parcelas do CIOT saem já sem o retido) ou 'bruto' (o e-frete desconta).
-- Regras do cálculo: js/lib/frete-retencoes.js (cópia em supabase/functions/efrete/retencoes.js).

create table if not exists public.log_retencao_param (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  vigencia date not null,                                             -- vale a partir desta data, até a próxima vigência
  inss_pct numeric(6,3) not null default 11 check (inss_pct between 0 and 100),
  inss_base_pct numeric(6,3) not null default 20 check (inss_base_pct between 0 and 100),   -- parte do frete que é remuneração
  inss_teto numeric(12,2) not null check (inss_teto > 0),              -- teto do salário de contribuição
  sest_senat_pct numeric(6,3) not null default 2.5 check (sest_senat_pct between 0 and 100),
  sest_senat_teto boolean not null default true,                       -- SEST/SENAT respeita o mesmo teto do INSS
  irrf_base_pct numeric(6,3) not null default 10 check (irrf_base_pct between 0 and 100),   -- parte do frete que é rendimento tributável
  irrf_dependente numeric(12,2) not null default 0 check (irrf_dependente >= 0),
  irrf_simplificado numeric(12,2) not null default 0 check (irrf_simplificado >= 0),
  irrf_minimo numeric(12,2) not null default 10 check (irrf_minimo >= 0),   -- retenção até este valor é dispensada
  irrf_faixas jsonb not null,                                          -- [{ate, aliq, deduzir}], a última com ate = null
  irrf_reducao jsonb,                                                  -- {isento_ate, valor_max, limite, a, b} (Lei 15.270/2025) ou null
  conferido boolean not null default false,                            -- a contabilidade conferiu estes valores
  observacao text,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid(),
  primary key (empresa_id, vigencia),
  check (jsonb_typeof(irrf_faixas) = 'array' and jsonb_array_length(irrf_faixas) >= 1)
);
alter table public.log_retencao_param enable row level security;
drop policy if exists log_retencao_param_sel on public.log_retencao_param;
create policy log_retencao_param_sel on public.log_retencao_param for select to authenticated using (public.ve_logistica(empresa_id));
drop policy if exists log_retencao_param_ins on public.log_retencao_param;
create policy log_retencao_param_ins on public.log_retencao_param for insert to authenticated with check (public.is_admin(empresa_id));
drop policy if exists log_retencao_param_upd on public.log_retencao_param;
create policy log_retencao_param_upd on public.log_retencao_param for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
drop policy if exists log_retencao_param_del on public.log_retencao_param;
create policy log_retencao_param_del on public.log_retencao_param for delete to authenticated using (public.is_admin(empresa_id));
grant select, insert, update, delete on public.log_retencao_param to authenticated;
drop trigger if exists zz_auditoria on public.log_retencao_param;
create trigger zz_auditoria after insert or update or delete on public.log_retencao_param for each row execute function public._auditar();

-- valores iniciais de 2026: teto do INSS R$ 8.475,55; tabela progressiva mensal do IRRF (Lei 15.191/2025) e redução da Lei 15.270/2025
create or replace function public._log_retencao_padrao(p_empresa uuid) returns void
language sql security definer set search_path = public as $$
  insert into log_retencao_param (empresa_id, vigencia, inss_pct, inss_base_pct, inss_teto, sest_senat_pct, sest_senat_teto, irrf_base_pct, irrf_dependente, irrf_simplificado, irrf_minimo, irrf_faixas, irrf_reducao, conferido, observacao, atualizado_por)
  values (p_empresa, date '2026-01-01', 11, 20, 8475.55, 2.5, true, 10, 189.59, 607.20, 10,
    '[{"ate":2428.80,"aliq":0,"deduzir":0},{"ate":2826.65,"aliq":7.5,"deduzir":182.16},{"ate":3751.05,"aliq":15,"deduzir":394.16},{"ate":4664.68,"aliq":22.5,"deduzir":675.49},{"ate":null,"aliq":27.5,"deduzir":908.73}]'::jsonb,
    '{"isento_ate":5000,"valor_max":312.89,"limite":7350,"a":978.62,"b":0.133145}'::jsonb,
    false, 'Valores iniciais de 2026 gravados pela plataforma em 16/11/2026 — a confirmar com a contabilidade.', null)
  on conflict (empresa_id, vigencia) do nothing;
$$;
revoke all on function public._log_retencao_padrao(uuid) from public, anon, authenticated;
select public._log_retencao_padrao(e.id) from public.empresas e;
create or replace function public._log_retencao_empresa() returns trigger
language plpgsql security definer set search_path = public as $$ begin perform _log_retencao_padrao(new.id); return new; end $$;
revoke all on function public._log_retencao_empresa() from public, anon, authenticated;
drop trigger if exists empresas_log_retencao on public.empresas;
create trigger empresas_log_retencao after insert on public.empresas for each row execute function public._log_retencao_empresa();

alter table public.log_transportadores add column if not exists dependentes smallint not null default 0 check (dependentes between 0 and 30);
alter table public.log_fretes add column if not exists retencoes jsonb not null default '{}'::jsonb;
alter table public.efrete_config add column if not exists retencao_pagamento text not null default 'liquido' check (retencao_pagamento in ('liquido', 'bruto'));

-- Conferência: tabela = 1, colunas = 3, parâmetro inicial em todas as empresas
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'log_retencao_param') as tabela,
       (select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'log_transportadores' and column_name = 'dependentes')
          or (table_name = 'log_fretes' and column_name = 'retencoes') or (table_name = 'efrete_config' and column_name = 'retencao_pagamento'))) as colunas,
       (select count(*) from public.empresas e where not exists (select 1 from public.log_retencao_param p where p.empresa_id = e.id)) as empresas_sem_parametro;
