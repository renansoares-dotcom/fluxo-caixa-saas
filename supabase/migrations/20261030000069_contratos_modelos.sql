-- =====================================================================
-- Contratos — Etapa 2, parte 2 (30/10/2026): modelos de contrato.
--  - contratos.modelo: modelo escolhido para gerar a minuta (ex.: locacao_veiculo, transporte_tac, vistoria)
--  - contratos.dados: campos próprios do modelo (veículo, rota, foro, testemunhas, seguro…)
-- A minuta é montada na plataforma com os cadastros e impressa em PDF para assinatura no gov.br.
-- Migração ADITIVA; pode rodar mais de uma vez.
-- =====================================================================
alter table public.contratos add column if not exists modelo text;
alter table public.contratos add column if not exists dados jsonb not null default '{}'::jsonb;

-- conferência: colunas = 2
select count(*) as colunas from information_schema.columns where table_schema = 'public' and table_name = 'contratos' and column_name in ('modelo', 'dados');
