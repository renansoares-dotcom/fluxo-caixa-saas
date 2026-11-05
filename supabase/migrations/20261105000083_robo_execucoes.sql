-- =====================================================================
-- Execuções dos robôs de captura (05/11/2026; Renan: "eu quero que a plataforma consulte o portal da fidc, veja o
-- título liquidado pelo cliente e registre na plataforma"; "o fluxo concluído até a liquidação dentro da plataforma").
--  - O robô (pasta Sistema › robo-fidc, roda no computador da IPLAMM) entra no portal do fundo, lê os títulos pagos
--    e grava em fidc_liquidacoes, igual à importação do PDF na Carteira Cedida. Esta tabela guarda cada execução:
--    quando rodou, de qual fundo, período consultado, quantos títulos, se deu certo e a mensagem de erro.
--  - A Carteira Cedida mostra a última sincronização de cada fundo e avisa quando a última execução falhou.
--  - Leitura: membros da empresa. Gravação: administrador e financeiro (o robô entra com um usuário financeiro).
--  - Sem update/delete pela API: o registro é histórico.
-- Migração ADITIVA; pode rodar mais de uma vez. Não altera nenhum dado existente.
-- =====================================================================
create table if not exists public.robo_execucoes (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  robo text not null,                    -- 'fidc-liquidacoes'
  fonte text not null,                   -- fundo / portal: 'Negocial'
  inicio timestamptz not null default now(),
  fim timestamptz,
  status text not null check (status in ('ok','erro','simulado')),
  periodo_de date,                       -- quitações consultadas
  periodo_ate date,
  lidos integer not null default 0,      -- títulos pagos devolvidos pelo portal
  novos integer not null default 0,      -- liquidações que não existiam na plataforma
  atualizados integer not null default 0,
  sem_titulo integer not null default 0, -- sem título correspondente na base FIDC
  valor_pago numeric(16,2) not null default 0,
  mensagem text,
  detalhe jsonb,
  maquina text,
  executado_por uuid default auth.uid()
);
create index if not exists robo_execucoes_emp_fonte on public.robo_execucoes(empresa_id, robo, fonte, inicio desc);

alter table public.robo_execucoes enable row level security;
do $$ declare a text; begin
  foreach a in array array['sel','ins','upd','del'] loop execute format('drop policy if exists robo_execucoes_%s on public.robo_execucoes', a); end loop;
end $$;
create policy robo_execucoes_sel on public.robo_execucoes for select to authenticated using (empresa_id in (select public.minhas_empresas()));
create policy robo_execucoes_ins on public.robo_execucoes for insert to authenticated with check (public.pode_editar(empresa_id));

-- conferência: tabela = 1, políticas = 2
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'robo_execucoes') as tabela,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'robo_execucoes') as politicas;
