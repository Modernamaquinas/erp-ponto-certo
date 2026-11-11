-- Quem edita cadastros: admin e financeiro (depende de 002 e 010). Estoque não se edita aqui (só por venda,
-- compra ou ajuste de estoque), por isso as colunas de produtos são liberadas uma a uma.

create policy fin_altera on produtos for update to authenticated using (pode_financeiro()) with check (pode_financeiro());
revoke update on produtos from authenticated;
grant update (nome, marca, referencia, codigo_barras, unidade, grupo_id, subgrupo_id, preco_venda, preco_atacado, qtd_atacado,
  custo, margem, estoque_minimo, ativo, ncm, cest, cfop, cst_csosn, origem, utilizacao, ibpt_federal, ibpt_estadual, ibpt_municipal)
  on produtos to authenticated;

create policy fin_altera on fornecedores for update to authenticated using (pode_financeiro()) with check (pode_financeiro());
revoke update on fornecedores from authenticated;
grant update (nome, fantasia, tipo_pessoa, cpf_cnpj, ie, email, telefone, celular, contato, cep, endereco, numero, complemento,
  bairro, cidade_id, ativo, observacoes) on fornecedores to authenticated;

-- clientes: a política cobranca_altera (002) já permite UPDATE ao financeiro; agora libera também o cadastro
grant update (nome, nome_fantasia, tipo_pessoa, cpf_cnpj, rg_ie, email, celular, telefone, contato, cep, endereco, numero,
  complemento, bairro, cidade_id, data_nascimento, limite_credito, bloqueado, ativo, observacoes) on clientes to authenticated;
