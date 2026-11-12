-- 019 — Consignado: como as demais funções do PDV (008), só a API (service role) chama.
revoke execute on function consignado_devolver(jsonb) from public, anon, authenticated;
