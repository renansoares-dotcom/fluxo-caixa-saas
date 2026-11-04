-- 082 · e-frete: parâmetros pela plataforma (regra do Renan, 04/11/2026: nada fixo no código) e CIOT do frete real.
-- Aditiva. Pode rodar mais de uma vez.
--  - efrete_config: um registro por empresa com tudo o que vai no pedido do CIOT e não vem da ficha do frete.
--  - efrete_tipos_carga: tipo de carga da plataforma × código da ANTT (1 a 12), editável.
--  - log_transportadores: endereço e motoristas (CNH, nascimento, celular, endereço) — o e-frete exige no cadastro.
--  - log_fretes.ciot_dados: retorno do e-frete (código completo, protocolo, situação, datas, ambiente).
-- Credenciais (usuário, senha, hash do integrador, certificado, chave da ponte) NÃO ficam aqui: continuam como segredos do servidor.

create table if not exists public.efrete_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ambiente text not null default 'homologacao' check (ambiente in ('homologacao', 'producao')),
  tipo_viagem text not null default 'Padrao' check (tipo_viagem in ('Padrao', 'Fracionado')),
  tipo_pagamento text not null default 'eFRETE' check (tipo_pagamento in ('eFRETE', 'TransferenciaBancaria', 'DepositoAgendado')),
  pct_adiantamento numeric(5,2) not null default 0 check (pct_adiantamento between 0 and 100),
  dias_liberacao_quitacao int not null default 0 check (dias_liberacao_quitacao between 0 and 90),  -- após o fim previsto da viagem
  prazo_viagem_horas int not null default 48 check (prazo_viagem_horas between 1 and 2160),        -- fim previsto padrão = início + prazo
  docs_credenciado text[] not null default array['Canhoto da NF-e assinado pelo destinatario', 'Comprovante de entrega da carga'],
  entrega_documentacao text not null default 'RedeCredenciada' check (entrega_documentacao in ('RedeCredenciada', 'Cliente')),
  qtd_saques int check (qtd_saques between 0 and 99),
  qtd_transferencias int check (qtd_transferencias between 0 and 99),
  tipo_embalagem text not null default 'Pallet' check (tipo_embalagem in ('Bigbag', 'Pallet', 'Granel', 'Container', 'Saco', 'Caixa', 'Unitario', 'Fardo')),
  unidade_medida text not null default 'Kg' check (unidade_medida in ('Kg', 'Tonelada')),
  tipo_calculo text not null default 'SemQuebra' check (tipo_calculo in ('SemQuebra', 'QuebraSomenteUltrapassado', 'QuebraIntegral')),
  tolerancia_tipo text not null default 'Nenhum' check (tolerancia_tipo in ('Nenhum', 'Porcentagem', 'ValorAbsoluto')),
  tolerancia_valor numeric(12,2) not null default 0,
  ncm_padrao text,                                         -- usado quando a NF-e não traz NCM
  contratante_endereco jsonb not null default '{}'::jsonb,  -- {rua, numero, complemento, bairro, cep, cmun}
  observacoes_transportador text[] not null default '{}',   -- orientações ao contratado (opcional)
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid(),
  check (cardinality(docs_credenciado) >= 1)
);
alter table public.efrete_config enable row level security;
drop policy if exists efrete_config_sel on public.efrete_config;
create policy efrete_config_sel on public.efrete_config for select to authenticated using (public.ve_logistica(empresa_id));
drop policy if exists efrete_config_ins on public.efrete_config;
create policy efrete_config_ins on public.efrete_config for insert to authenticated with check (public.is_admin(empresa_id));
drop policy if exists efrete_config_upd on public.efrete_config;
create policy efrete_config_upd on public.efrete_config for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
grant select, insert, update on public.efrete_config to authenticated;
drop trigger if exists zz_auditoria on public.efrete_config;
create trigger zz_auditoria after insert or update or delete on public.efrete_config for each row execute function public._auditar();

create table if not exists public.efrete_tipos_carga (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo_carga text not null,                                -- igual ao log_fretes.tipo_carga / log_piso_coef.tipo_carga
  codigo smallint not null check (codigo between 1 and 99),
  primary key (empresa_id, tipo_carga)
);
alter table public.efrete_tipos_carga enable row level security;
drop policy if exists efrete_tc_sel on public.efrete_tipos_carga;
create policy efrete_tc_sel on public.efrete_tipos_carga for select to authenticated using (public.ve_logistica(empresa_id));
drop policy if exists efrete_tc_ins on public.efrete_tipos_carga;
create policy efrete_tc_ins on public.efrete_tipos_carga for insert to authenticated with check (public.is_admin(empresa_id));
drop policy if exists efrete_tc_upd on public.efrete_tipos_carga;
create policy efrete_tc_upd on public.efrete_tipos_carga for update to authenticated using (public.is_admin(empresa_id)) with check (public.is_admin(empresa_id));
drop policy if exists efrete_tc_del on public.efrete_tipos_carga;
create policy efrete_tc_del on public.efrete_tipos_carga for delete to authenticated using (public.is_admin(empresa_id));
grant select, insert, update, delete on public.efrete_tipos_carga to authenticated;
drop trigger if exists zz_auditoria on public.efrete_tipos_carga;
create trigger zz_auditoria after insert or update or delete on public.efrete_tipos_carga for each row execute function public._auditar();

-- correspondência padrão (Res. ANTT 5.867/2020: 1 a 12, na ordem das tabelas do piso)
create or replace function public._efrete_tipos_padrao(p_empresa uuid) returns void
language sql security definer set search_path = public as $$
  insert into efrete_tipos_carga (empresa_id, tipo_carga, codigo)
  select p_empresa, v.t, v.c from (values
    ('granel sólido', 1), ('granel líquido', 2), ('frigorificada', 3), ('conteinerizada', 4), ('geral', 5), ('neogranel', 6),
    ('perigosa granel sólido', 7), ('perigosa granel líquido', 8), ('perigosa frigorificada', 9), ('perigosa conteinerizada', 10),
    ('perigosa geral', 11), ('granel pressurizada', 12)) v(t, c)
  on conflict (empresa_id, tipo_carga) do nothing;
$$;
revoke all on function public._efrete_tipos_padrao(uuid) from public, anon, authenticated;
select public._efrete_tipos_padrao(e.id) from public.empresas e;
create or replace function public._efrete_tipos_empresa() returns trigger
language plpgsql security definer set search_path = public as $$ begin perform _efrete_tipos_padrao(new.id); return new; end $$;
revoke all on function public._efrete_tipos_empresa() from public, anon, authenticated;
drop trigger if exists empresas_efrete_tipos on public.empresas;
create trigger empresas_efrete_tipos after insert on public.empresas for each row execute function public._efrete_tipos_empresa();

-- cadastro do transportador para o e-frete
alter table public.log_transportadores add column if not exists endereco jsonb not null default '{}'::jsonb;   -- {rua, numero, complemento, bairro, cep, cmun, xmun, uf}
alter table public.log_transportadores add column if not exists motoristas jsonb not null default '[]'::jsonb; -- [{nome, cpf, cnh, nascimento, ddd, celular, endereco{...}}]

-- retorno do e-frete no frete
alter table public.log_fretes add column if not exists ciot_dados jsonb not null default '{}'::jsonb;
-- {provedor:'efrete', ambiente, codigo:'NNNNNNNNNNNN/VVVV', id_operacao, protocolo, situacao:'emitido'|'cancelado'|'encerrado', emitido_em, cancelado_em, motivo, anexo_id}

-- Conferência: tabelas = 2, colunas = 3, tipos de carga = 12 por empresa
select (select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('efrete_config', 'efrete_tipos_carga')) as tabelas,
       (select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'log_transportadores' and column_name in ('endereco', 'motoristas')) or (table_name = 'log_fretes' and column_name = 'ciot_dados'))) as colunas,
       (select min(n) from (select count(*) n from public.efrete_tipos_carga group by empresa_id) x) as tipos_por_empresa;
