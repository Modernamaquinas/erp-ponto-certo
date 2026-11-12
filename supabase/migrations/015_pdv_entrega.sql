-- PDV: frete, endereço de entrega e escolha do documento fiscal (NFC-e ou NF-e) na finalização. Roda também no PGlite.
-- O frete entra no total da venda (e no caixa/crediário); na nota ele é rateado nos itens (NFC-e com frete = entrega
-- a domicílio, indPres 4, e por isso exige cliente cadastrado com endereço). O desconto em R$ continua sendo o desconto_geral (validado pelo desconto máximo do operador).

alter table vendas add column valor_frete numeric(14,2) not null default 0;
alter table vendas add column endereco_entrega text;
alter table vendas add column documento_fiscal text not null default 'nfce' check (documento_fiscal in ('nfce', 'nfe'));

-- p ganha: frete?, endereco_entrega?, documento_fiscal? ('nfce' | 'nfe'; NF-e exige cliente_id)
create or replace function finalizar_venda(p jsonb) returns bigint
language plpgsql as $$
declare op operadores; tot record; v_id bigint; it jsonb; pg jsonb; pr record; i int := 0; j int := 0; n int; k int;
        v_pago numeric := 0; v_troco numeric; v_cli_id bigint; v_cli_nome text; v_cli_bloq boolean; v_agora timestamp := now() at time zone 'America/Sao_Paulo';
        v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_parc numeric; v_venc date; v_valor numeric;
        v_tem_dinheiro boolean := false; v_frete numeric := round(coalesce((p->>'frete')::numeric, 0), 2); v_total numeric;
        v_doc text := coalesce(nullif(p->>'documento_fiscal', ''), 'nfce');
begin
  op := pdv_operador(p->>'operador_codigo');
  select * into tot from pdv_validar_itens(op, p, true);
  if v_frete < 0 then raise exception 'Frete inválido'; end if;
  if v_doc not in ('nfce', 'nfe') then raise exception 'Documento fiscal inválido: %', v_doc; end if;
  if v_doc = 'nfe' and (p->>'cliente_id') is null then raise exception 'NF-e exige cliente cadastrado (com CPF/CNPJ e endereço)'; end if;
  -- NFC-e com frete = entrega a domicílio: a SEFAZ exige destinatário com CPF/CNPJ e endereço (rejeições 787/788)
  if v_frete > 0 and (p->>'cliente_id') is null then raise exception 'Venda com frete exige cliente cadastrado (CPF/CNPJ e endereço vão na nota)'; end if;
  v_total := tot.total + v_frete;

  if jsonb_array_length(coalesce(p->'pagamentos', '[]')) = 0 then raise exception 'Informe a forma de pagamento'; end if;
  for pg in select * from jsonb_array_elements(p->'pagamentos') loop
    if forma_pagamento_pdv(pg->>'forma') is null then raise exception 'Forma de pagamento inválida: %', pg->>'forma'; end if;
    if coalesce((pg->>'valor')::numeric, 0) <= 0 then raise exception 'Valor de pagamento inválido'; end if;
    v_pago := v_pago + round((pg->>'valor')::numeric, 2);
    if pg->>'forma' = 'dinheiro' then v_tem_dinheiro := true; end if;
    if pg->>'forma' = 'crediario' and (p->>'cliente_id') is null then raise exception 'Crediário exige cliente'; end if;
  end loop;
  if v_pago < v_total then raise exception 'Pagamento (%) menor que o total (%)', v_pago, v_total; end if;
  v_troco := v_pago - v_total;
  if v_troco > 0 and not v_tem_dinheiro then raise exception 'Troco só é permitido com pagamento em dinheiro'; end if;

  if (p->>'cliente_id') is not null then
    select id, nome, bloqueado into v_cli_id, v_cli_nome, v_cli_bloq from clientes where id = (p->>'cliente_id')::bigint;
    if v_cli_id is null then raise exception 'Cliente não encontrado'; end if;
    if v_cli_bloq and exists (select 1 from jsonb_array_elements(p->'pagamentos') x where x->>'forma' = 'crediario') then
      raise exception 'Cliente bloqueado para crediário';
    end if;
  end if;

  insert into vendas (data, hora, cliente_id, cliente_nome, cpf_nota, total_produtos, desconto, total, situacao, num_caixa,
                      observacao, origem, operador_id, orcamento_id, valor_frete, endereco_entrega, documento_fiscal)
  values (v_hoje, v_agora::time, v_cli_id, coalesce(v_cli_nome, p->>'cliente_nome'), nullif(regexp_replace(coalesce(p->>'cpf', ''), '\D', '', 'g'), ''),
          tot.total_produtos, tot.desconto_total, v_total, 'finalizada', (p->>'num_caixa')::int, p->>'observacao', 'erp', op.id,
          (p->>'orcamento_id')::bigint, v_frete, nullif(trim(coalesce(p->>'endereco_entrega', '')), ''), v_doc)
  returning id into v_id;

  for it in select * from jsonb_array_elements(p->'itens') loop
    i := i + 1;
    select id, nome, coalesce(custo_medio, custo) as custo into pr from produtos where id = (it->>'produto_id')::bigint for update;
    insert into venda_itens (venda_id, item, produto_id, descricao, quantidade, preco_unitario, desconto, total, custo)
    values (v_id, i, pr.id, pr.nome, (it->>'quantidade')::numeric, (it->>'preco_unitario')::numeric,
            round(coalesce((it->>'desconto')::numeric, 0), 2),
            round((it->>'quantidade')::numeric * (it->>'preco_unitario')::numeric, 2) - round(coalesce((it->>'desconto')::numeric, 0), 2), pr.custo);
    update produtos set estoque = estoque - (it->>'quantidade')::numeric, data_ultima_saida = v_hoje where id = pr.id;
  end loop;

  for pg in select * from jsonb_array_elements(p->'pagamentos') loop
    j := j + 1;
    v_valor := round((pg->>'valor')::numeric, 2);
    n := greatest(1, least(24, coalesce((pg->>'parcelas')::int, 1)));
    insert into venda_pagamentos (venda_id, item, forma_pagamento_id, valor, parcelas)
    values (v_id, j, forma_pagamento_pdv(pg->>'forma'), v_valor, n);
    if pg->>'forma' = 'crediario' then
      v_venc := coalesce((pg->>'primeiro_vencimento')::date, v_hoje + 30);
      for k in 1..n loop
        v_parc := case when k < n then round(v_valor / n, 2) else v_valor - round(v_valor / n, 2) * (n - 1) end;
        insert into contas_receber (cliente_id, venda_id, documento, historico, parcela, total_parcelas, emissao, vencimento,
                                    valor, saldo, status, baixa_replicada_legado)
        values (v_cli_id, v_id, v_id::text, 'VENDA N ' || v_id, k, n, v_hoje, (v_venc + make_interval(months => k - 1))::date,
                v_parc, v_parc, 'aberto', true);
      end loop;
    else
      insert into caixa_lancamentos (data, hora, historico, entrada, forma_pagamento_id, documento, origem, usuario)
      values (v_hoje, v_agora::time, 'RECEITA VENDA N ' || v_id || ' - ' || coalesce(v_cli_nome, 'AO CONSUMIDOR'), v_valor,
              forma_pagamento_pdv(pg->>'forma'), v_id::text, 'erp', op.nome);
    end if;
  end loop;
  if v_troco > 0 then
    insert into caixa_lancamentos (data, hora, historico, saida, forma_pagamento_id, documento, origem, usuario)
    values (v_hoje, v_agora::time, 'TROCO VENDA N ' || v_id, v_troco, 2, v_id::text, 'erp', op.nome);
  end if;

  if (p->>'orcamento_id') is not null then
    if not op.converte_orcamento then raise exception 'Operador sem permissão para converter orçamento'; end if;
    update orcamentos set status = 'convertido', venda_id = v_id where id = (p->>'orcamento_id')::bigint and status = 'aberto';
    if not found then raise exception 'Orçamento não está aberto'; end if;
  end if;
  return v_id;
end $$;
-- create or replace mantém os grants de 008 (só a API, com a service role, chama).
