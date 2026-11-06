-- ERP Ponto Certo — usuários, papéis e RLS (específico do Supabase: depende de auth.users / auth.uid()).
--
-- Papéis:
--   admin      — tudo, inclusive usuários
--   financeiro — cadastros (leitura), financeiro e cobrança (escrita)
--   vendedor   — consulta de produtos, clientes e vendas; sem financeiro

create table perfis (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  nome       text not null,
  papel      text not null check (papel in ('admin', 'financeiro', 'vendedor')),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

create or replace function papel_atual() returns text
language sql stable security definer set search_path = public as $$
  select papel from perfis where user_id = auth.uid() and ativo
$$;

create or replace function pode_ler() returns boolean
language sql stable as $$ select papel_atual() is not null $$;

create or replace function pode_financeiro() returns boolean
language sql stable as $$ select papel_atual() in ('admin', 'financeiro') $$;

-- Todas as tabelas com RLS ligada; sem política = sem acesso (service role ignora RLS).
do $$
declare t text;
begin
  foreach t in array array[
    'empresa', 'cidades', 'formas_pagamento', 'plano_contas', 'usuarios_legado',
    'clientes', 'fornecedores', 'grupos_produto', 'subgrupos_produto', 'produtos',
    'produto_fornecedores', 'vendas', 'venda_itens', 'venda_pagamentos', 'compras',
    'compra_itens', 'cobrancas', 'asaas_eventos', 'contas_receber', 'recebimentos',
    'contas_pagar', 'caixa_lancamentos', 'sincronizacoes', 'perfis'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- Leitura geral para qualquer usuário ativo
do $$
declare t text;
begin
  foreach t in array array[
    'empresa', 'cidades', 'formas_pagamento', 'plano_contas', 'usuarios_legado',
    'clientes', 'fornecedores', 'grupos_produto', 'subgrupos_produto', 'produtos',
    'produto_fornecedores', 'vendas', 'venda_itens', 'venda_pagamentos', 'compras',
    'compra_itens', 'sincronizacoes'
  ] loop
    execute format('create policy leitura on %I for select to authenticated using (pode_ler())', t);
  end loop;
end $$;

-- Financeiro: leitura e escrita só para admin/financeiro
do $$
declare t text;
begin
  foreach t in array array['contas_receber', 'recebimentos', 'contas_pagar', 'caixa_lancamentos', 'cobrancas'] loop
    execute format('create policy fin_leitura on %I for select to authenticated using (pode_financeiro())', t);
    execute format('create policy fin_insere on %I for insert to authenticated with check (pode_financeiro())', t);
    execute format('create policy fin_altera on %I for update to authenticated using (pode_financeiro()) with check (pode_financeiro())', t);
  end loop;
end $$;

create policy fin_leitura on asaas_eventos for select to authenticated using (papel_atual() = 'admin');

-- Clientes: o ERP só edita os dados de cobrança (o resto vem do DirectControl na Fase 1)
create policy cobranca_altera on clientes for update to authenticated
  using (pode_financeiro()) with check (pode_financeiro());
revoke update on clientes from authenticated;
grant update (email_cobranca, celular_cobranca, cobranca_ativa, obs_cobranca) on clientes to authenticated;

-- Contas a pagar lançadas no ERP podem ser excluídas enquanto abertas
create policy fin_exclui on contas_pagar for delete to authenticated
  using (pode_financeiro() and status = 'aberto' and id >= 1000000);

-- Perfis: cada um lê o próprio; admin lê/edita todos (criação de usuário é pela API, com service role)
create policy proprio on perfis for select to authenticated
  using (user_id = auth.uid() or papel_atual() = 'admin');
create policy admin_altera on perfis for update to authenticated
  using (papel_atual() = 'admin') with check (papel_atual() = 'admin');

-- Funções de negócio: só usuários do financeiro
revoke execute on function baixar_conta_receber(bigint, numeric, date, int, text) from public, anon;
revoke execute on function baixar_conta_pagar(bigint, numeric, date, text) from public, anon;
revoke execute on function baixar_pagar_legado_em_lote(date) from public, anon;
revoke execute on function confirmar_cobranca_paga(text, date, numeric, numeric, text) from public, anon, authenticated;
grant execute on function baixar_conta_receber(bigint, numeric, date, int, text) to authenticated;
grant execute on function baixar_conta_pagar(bigint, numeric, date, text) to authenticated;
grant execute on function baixar_pagar_legado_em_lote(date) to authenticated;

-- (as funções acima são SECURITY INVOKER: os UPDATEs delas passam pelo RLS de fin_altera)

-- Somas no banco via PostgREST (select('total:saldo.sum()')): as respostas da API param em 1000 linhas,
-- então totais nunca devem ser calculados somando linhas no navegador.
alter role authenticator set pgrst.db_aggregates_enabled = 'true';
notify pgrst, 'reload config';

-- Views respeitam o RLS das tabelas base
alter view v_receber_por_cliente set (security_invoker = true);
alter view v_cobrancas_conflito set (security_invoker = true);
