-- 017 — Permissões dos relatórios e da contagem cíclica (depende de 002: perfis, papel_atual, pode_ler).
--   relatórios, criar/fechar/cancelar contagem: admin e financeiro
--   lançar quantidade contada: qualquer usuário ativo

create or replace function rel_permitido(p_nivel text) returns boolean
language sql stable security definer set search_path = public as $$
  select case p_nivel
    when 'fin' then papel_atual() in ('admin', 'financeiro')
    when 'contar' then papel_atual() is not null
    else false end
$$;

create or replace function rel_usuario() returns text
language sql stable security definer set search_path = public as $$
  select nome from perfis where user_id = auth.uid()
$$;

alter table contagens enable row level security;
alter table contagem_itens enable row level security;
-- leitura para quem conta; escrita só pelas funções (security definer)
create policy leitura on contagens for select to authenticated using (pode_ler());
create policy leitura on contagem_itens for select to authenticated using (pode_ler());

do $$
declare f text;
begin
  foreach f in array array[
    'rel_vendas(date, date)', 'rel_estoque(int)', 'rel_receber(date, date)', 'rel_pagar(date, date)', 'rel_financeiro(date, date)',
    'contagem_criar(jsonb)', 'contagem_lancar(bigint, bigint, numeric, boolean)', 'contagem_finalizar(bigint, boolean)',
    'contagem_cancelar(bigint)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- internas: não são chamadas pelo navegador
revoke execute on function rel_resumo_vendas(date, date) from public, anon, authenticated;
revoke execute on function rel_exigir(text) from public, anon;
