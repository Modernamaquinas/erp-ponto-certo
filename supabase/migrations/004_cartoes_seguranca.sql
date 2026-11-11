-- RLS das tabelas de cartões/TEF (depende de 002_seguranca.sql e 003_cartoes.sql).

alter table tef_transacoes enable row level security;
alter table cartao_taxas enable row level security;

-- Transações: só o financeiro consulta; ninguém grava direto (só pela função do PDV abaixo).
create policy fin_leitura on tef_transacoes for select to authenticated using (pode_financeiro());

-- Taxas: o financeiro cadastra e mantém.
create policy fin_leitura on cartao_taxas for select to authenticated using (pode_financeiro());
create policy fin_insere on cartao_taxas for insert to authenticated with check (pode_financeiro());
create policy fin_altera on cartao_taxas for update to authenticated using (pode_financeiro()) with check (pode_financeiro());
create policy fin_exclui on cartao_taxas for delete to authenticated using (pode_financeiro());

alter view v_cartoes_recebiveis set (security_invoker = true);

-- Fase 2: qualquer usuário ativo (o caixa é "vendedor") registra o resultado do TEF da própria venda.
revoke execute on function registrar_transacao_tef(jsonb) from public, anon, authenticated;
create or replace function pdv_registrar_tef(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
begin
  if not pode_ler() then raise exception 'Sem permissão'; end if;
  return registrar_transacao_tef(p);
end $$;
revoke execute on function pdv_registrar_tef(jsonb) from public, anon;
grant execute on function pdv_registrar_tef(jsonb) to authenticated;
