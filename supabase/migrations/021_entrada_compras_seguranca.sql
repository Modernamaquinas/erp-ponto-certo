-- 021 — Permissões da entrada de notas e da lista de compras (as funções checam rel_permitido('fin') por dentro).
do $$
declare f text;
begin
  foreach f in array array['entrada_preparar(jsonb)', 'fiscal_sugestoes_ncm(text)', 'lancar_compra(jsonb)', 'lista_compras(jsonb)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
