-- Funções de gatilho não devem ser chamáveis pela API
revoke execute on function public.tg_autorizacao_numero(), public.tg_lanc_mesma_empresa(), public.tg_updated_at() from authenticated, anon, public;
