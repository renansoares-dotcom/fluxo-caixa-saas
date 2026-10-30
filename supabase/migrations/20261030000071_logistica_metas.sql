-- =====================================================================
-- Indicadores de logística — Etapa 4 (30/10/2026; Renan: "Sim, com essas metas").
--  - log_parametros.metas: metas dos indicadores (entregas no prazo, ocupação, custo logístico sobre as notas, devoluções)
--    ajustadas na tela Logística › Indicadores por quem edita a logística.
-- Migração ADITIVA; pode rodar mais de uma vez.
-- =====================================================================
alter table public.log_parametros add column if not exists metas jsonb not null
  default '{"prazo_pct": 95, "ocupacao_pct": 80, "custo_pct": 5, "devol_pct": 1}'::jsonb;

-- conferência: coluna = 1
select count(*) as coluna from information_schema.columns where table_schema = 'public' and table_name = 'log_parametros' and column_name = 'metas';
