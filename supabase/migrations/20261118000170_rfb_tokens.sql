-- 170 — Receita Federal: token de acesso temporário guardado entre as chamadas (18/11/2026, aprovado pelo Renan)
-- No primeiro teste real a Receita respondeu "API rate limit exceeded" já no pedido do token: a função pedia um token novo
-- cada vez que "acordava". Aqui o token temporário fica guardado até vencer, para a função reaproveitar e gastar menos chamadas.
-- * Só o token TEMPORÁRIO (vale minutos/horas). O Client Id e o Client Secret continuam só nos segredos da função.
-- * A chave da linha é o resumo (SHA-256) do Client Id, não o Client Id.
-- * Ninguém lê pela tela nem pela API: RLS ligada sem nenhuma política e sem permissão para anon/authenticated.
--   Só a função rfb-cbs (service_role) lê e grava.
-- Aditivo.

create table if not exists public.rfb_tokens (
  credencial text primary key,                 -- SHA-256 (hex) do Client Id
  token text not null,
  expira_em timestamptz not null,
  obtido_em timestamptz not null default now()
);
alter table public.rfb_tokens enable row level security;
revoke all on public.rfb_tokens from anon, authenticated;
comment on table public.rfb_tokens is 'Token temporário da Receita Federal (APIs da CBS). Só a função rfb-cbs (service_role) acessa; sem política de RLS de propósito.';
