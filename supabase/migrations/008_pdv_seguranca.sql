-- RLS do PDV (depende de 002 e 007). Venda e orçamento só pela API (service role), que confere o operador.

alter table operadores enable row level security;
alter table orcamentos enable row level security;
alter table orcamento_itens enable row level security;

-- O código do operador funciona como senha: só o admin vê e cadastra.
create policy admin_le on operadores for select to authenticated using (papel_atual() = 'admin');
create policy admin_insere on operadores for insert to authenticated with check (papel_atual() = 'admin');
create policy admin_altera on operadores for update to authenticated using (papel_atual() = 'admin') with check (papel_atual() = 'admin');

create policy leitura on orcamentos for select to authenticated using (pode_ler());
create policy leitura on orcamento_itens for select to authenticated using (pode_ler());

revoke execute on function finalizar_venda(jsonb) from public, anon, authenticated;
revoke execute on function salvar_orcamento(jsonb) from public, anon, authenticated;
revoke execute on function pdv_operador(text) from public, anon, authenticated;
revoke execute on function pdv_validar_itens(operadores, jsonb, boolean) from public, anon, authenticated;
