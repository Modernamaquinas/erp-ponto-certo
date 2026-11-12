-- 023 — Marketplaces: admin/financeiro veem e editam vínculos, reserva e chaves de sincronização pela tela; as funções de envio,
-- leitura de anúncios e registro de pedidos só são chamadas pela API (service role).
alter table marketplace_config enable row level security;
alter table marketplace_anuncios enable row level security;
alter table marketplace_composicao enable row level security;
alter table marketplace_pedidos enable row level security;

create policy fin_le on marketplace_config for select to authenticated using (pode_financeiro());
create policy fin_altera on marketplace_config for update to authenticated using (pode_financeiro()) with check (pode_financeiro());
create policy fin_le on marketplace_anuncios for select to authenticated using (pode_financeiro());
create policy fin_altera on marketplace_anuncios for update to authenticated using (pode_financeiro()) with check (pode_financeiro());
create policy fin_le on marketplace_composicao for select to authenticated using (pode_financeiro());
create policy fin_insere on marketplace_composicao for insert to authenticated with check (pode_financeiro());
create policy fin_altera on marketplace_composicao for update to authenticated using (pode_financeiro()) with check (pode_financeiro());
create policy fin_exclui on marketplace_composicao for delete to authenticated using (pode_financeiro());
create policy fin_le on marketplace_pedidos for select to authenticated using (pode_financeiro());

-- pela tela só mudam reserva e sincronizar do anúncio (o resto vem do canal)
revoke update on marketplace_anuncios from authenticated;
grant update (reserva, sincronizar) on marketplace_anuncios to authenticated;
revoke update on marketplace_config from authenticated;
grant update (sincronizar, importar_vendas, reserva_padrao) on marketplace_config to authenticated;

revoke execute on function marketplace_pendentes(text, int) from public, anon, authenticated;
revoke execute on function marketplace_registrar_envio(text, jsonb) from public, anon, authenticated;
revoke execute on function marketplace_registrar_pedido(jsonb) from public, anon, authenticated;
revoke execute on function marketplace_ler_anuncios(text, jsonb) from public, anon, authenticated;
grant execute on function marketplace_qtd(text, text) to authenticated;
