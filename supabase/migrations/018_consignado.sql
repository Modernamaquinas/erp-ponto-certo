-- 018 — Consignado (o cliente leva os itens e depois acerta: fica com uma parte e devolve o resto) e vencimento do crediário
-- sempre no dia 10 do mês seguinte à compra. Roda também no PGlite.
--
-- Consignado = orçamento com tipo 'consignado', sempre de cliente cadastrado (fica na ficha dele). Ciclo do status:
--   salvar com tipo 'consignado'  -> 'consignado' (itens com o cliente; o estoque sai na entrega)
--   acerto no PDV (finalizar_venda com orcamento_id) -> 'convertido': vende só o que o cliente ficou (sem baixar o estoque
--     de novo) e devolve ao estoque o resto (quantidade_devolvida)
--   consignado_devolver -> 'devolvido': voltou tudo
--
-- Reserva = orçamento com tipo 'reserva': o estoque fica separado para o cliente (sai do disponível) até a venda ou a liberação.
--   salvar com tipo 'reserva' -> 'reservado'; venda no PDV -> 'convertido' (o que não for vendido volta ao estoque);
--   consignado_devolver (liberar a reserva) -> 'cancelado', com o estoque de volta.

alter table orcamentos drop constraint orcamentos_tipo_check;
alter table orcamentos add constraint orcamentos_tipo_check check (tipo in ('orcamento', 'prevenda', 'consignado', 'reserva'));
alter table orcamentos drop constraint orcamentos_status_check;
alter table orcamentos add constraint orcamentos_status_check check (status in ('aberto', 'convertido', 'cancelado', 'consignado', 'devolvido', 'reservado'));
alter table orcamentos add column consignado_em timestamptz;
alter table orcamentos add column acertado_em timestamptz;
alter table orcamento_itens add column quantidade_devolvida numeric(14,3);
create index orcamentos_consignado_cliente on orcamentos (cliente_id) where tipo in ('consignado', 'reserva');

-- Entrega marcada na finalização da venda (com ou sem cliente cadastrado): quem recebe, telefone, data/horário.
-- O endereço continua em vendas.endereco_entrega (015).
alter table vendas add column entrega boolean not null default false;
alter table vendas add column entrega_nome text;
alter table vendas add column entrega_telefone text;
alter table vendas add column entrega_data date;
alter table vendas add column entrega_horario text;
create index vendas_entregas on vendas (entrega_data) where entrega;

-- Crediário: 1ª parcela no dia 10 do mês seguinte à compra; as demais, dia 10 dos meses seguintes.
create or replace function vencimento_crediario(p_data date) returns date
language sql immutable as $$ select (date_trunc('month', p_data) + interval '1 month' + interval '9 days')::date $$;

create or replace function salvar_orcamento(p jsonb) returns bigint
language plpgsql as $$
declare op operadores; tot record; v_id bigint := (p->>'id')::bigint; it jsonb; i int := 0; v_cli_id bigint; v_cli_nome text; v_cli_bloq boolean;
  v_tipo text := coalesce(nullif(p->>'tipo', ''), 'orcamento'); v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if v_tipo not in ('orcamento', 'prevenda', 'consignado', 'reserva') then raise exception 'Tipo inválido: %', v_tipo; end if;
  op := pdv_operador(p->>'operador_codigo');
  -- consignado tira o produto da loja: confere estoque como na venda
  select * into tot from pdv_validar_itens(op, p, v_tipo in ('consignado', 'reserva'));
  if (p->>'cliente_id') is not null then
    select id, nome, bloqueado into v_cli_id, v_cli_nome, v_cli_bloq from clientes where id = (p->>'cliente_id')::bigint;
  end if;
  if v_tipo = 'prevenda' and coalesce(nullif(trim(coalesce(v_cli_nome, p->>'cliente_nome')), ''), '') = '' then
    raise exception 'Informe o nome do cliente da pré-venda';
  end if;
  if v_tipo = 'consignado' then
    if v_cli_id is null then raise exception 'Consignado exige cliente cadastrado: o registro fica na ficha dele'; end if;
    if v_cli_bloq then raise exception 'Cliente bloqueado: não pode levar em consignado'; end if;
  end if;
  if v_tipo = 'reserva' and coalesce(nullif(trim(coalesce(v_cli_nome, p->>'cliente_nome')), ''), '') = '' then
    raise exception 'Informe o cliente da reserva';
  end if;
  if v_id is null then
    insert into orcamentos (data, hora, cliente_id, cliente_nome, operador_id, validade, total_produtos, desconto, total, observacao, tipo)
    values (v_hoje, (now() at time zone 'America/Sao_Paulo')::time, v_cli_id,
            coalesce(v_cli_nome, upper(trim(p->>'cliente_nome'))), op.id, (p->>'validade')::date, tot.total_produtos, tot.desconto_total, tot.total,
            p->>'observacao', v_tipo)
    returning id into v_id;
  else
    update orcamentos set cliente_id = v_cli_id, cliente_nome = coalesce(v_cli_nome, upper(trim(p->>'cliente_nome'))), operador_id = op.id,
           validade = (p->>'validade')::date, total_produtos = tot.total_produtos, desconto = tot.desconto_total, total = tot.total,
           observacao = p->>'observacao', tipo = v_tipo
     where id = v_id and status = 'aberto';
    if not found then raise exception 'Orçamento não está aberto (consignado já entregue se acerta pelo PDV)'; end if;
    delete from orcamento_itens where orcamento_id = v_id;
  end if;
  for it in select * from jsonb_array_elements(p->'itens') loop
    i := i + 1;
    insert into orcamento_itens (orcamento_id, item, produto_id, descricao, quantidade, preco_unitario, desconto, total)
    select v_id, i, pr.id, pr.nome, (it->>'quantidade')::numeric, (it->>'preco_unitario')::numeric, round(coalesce((it->>'desconto')::numeric, 0), 2),
           round((it->>'quantidade')::numeric * (it->>'preco_unitario')::numeric, 2) - round(coalesce((it->>'desconto')::numeric, 0), 2)
      from produtos pr where pr.id = (it->>'produto_id')::bigint;
    if v_tipo in ('consignado', 'reserva') then
      update produtos set estoque = estoque - (it->>'quantidade')::numeric, data_ultima_saida = v_hoje where id = (it->>'produto_id')::bigint;
    end if;
  end loop;
  if v_tipo in ('consignado', 'reserva') then
    update orcamentos set status = case v_tipo when 'consignado' then 'consignado' else 'reservado' end, consignado_em = now() where id = v_id;
  end if;
  return v_id;
end $$;

/** Consignado: o cliente devolveu tudo. Reserva: liberada sem venda. Os itens voltam ao estoque. */
create or replace function consignado_devolver(p jsonb) returns void
language plpgsql as $$
declare op operadores; v_id bigint := (p->>'id')::bigint; v_tipo text;
begin
  op := pdv_operador(p->>'operador_codigo');
  select tipo into v_tipo from orcamentos where id = v_id and ((tipo = 'consignado' and status = 'consignado') or (tipo = 'reserva' and status = 'reservado')) for update;
  if v_tipo is null then raise exception 'Consignado/reserva não está em aberto'; end if;
  update produtos pr set estoque = pr.estoque + x.q
    from (select produto_id, sum(quantidade) as q from orcamento_itens where orcamento_id = v_id group by 1) x where x.produto_id = pr.id;
  update orcamento_itens set quantidade_devolvida = quantidade where orcamento_id = v_id;
  update orcamentos set status = case v_tipo when 'consignado' then 'devolvido' else 'cancelado' end, acertado_em = now(),
         observacao = concat_ws(' | ', nullif(observacao, ''), case v_tipo when 'consignado' then 'DEVOLVIDO POR ' else 'RESERVA LIBERADA POR ' end || op.nome) where id = v_id;
end $$;

-- finalizar_venda (de 015) + acerto de consignado + crediário no dia 10.
create or replace function finalizar_venda(p jsonb) returns bigint
language plpgsql as $$
declare op operadores; tot record; v_id bigint; it jsonb; pg jsonb; pr record; i int := 0; j int := 0; n int; k int;
        v_pago numeric := 0; v_troco numeric; v_cli_id bigint; v_cli_nome text; v_cli_bloq boolean; v_agora timestamp := now() at time zone 'America/Sao_Paulo';
        v_hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_parc numeric; v_venc date; v_valor numeric;
        v_tem_dinheiro boolean := false; v_frete numeric := round(coalesce((p->>'frete')::numeric, 0), 2); v_total numeric;
        v_doc text := coalesce(nullif(p->>'documento_fiscal', ''), 'nfce');
        v_ent jsonb := case when jsonb_typeof(p->'entrega') = 'object' then p->'entrega' end;
        v_orc orcamentos; v_consig boolean := false; v_separado boolean := false; xc record; v_resto numeric; v_dev numeric;
begin
  op := pdv_operador(p->>'operador_codigo');
  if (p->>'orcamento_id') is not null then
    select * into v_orc from orcamentos where id = (p->>'orcamento_id')::bigint for update;
    if v_orc.id is null then raise exception 'Orçamento não encontrado'; end if;
    v_consig := v_orc.tipo = 'consignado';
    -- consignado e reserva já tiraram o estoque: a venda só acerta a diferença
    v_separado := v_orc.tipo in ('consignado', 'reserva');
    if v_consig and v_orc.status <> 'consignado' then raise exception 'Este consignado já foi acertado ou devolvido'; end if;
    if v_orc.tipo = 'reserva' and v_orc.status <> 'reservado' then raise exception 'Esta reserva já foi vendida ou liberada'; end if;
    if not v_separado and v_orc.status <> 'aberto' then raise exception 'Orçamento não está aberto'; end if;
    if not op.converte_orcamento then raise exception 'Operador sem permissão para converter orçamento'; end if;
  end if;
  if v_consig and (p->>'cliente_id') is distinct from v_orc.cliente_id::text then
    raise exception 'O acerto do consignado é do cliente %', v_orc.cliente_nome;
  end if;
  if v_separado then
    -- só vende o que foi separado, até a quantidade separada
    for xc in select (e->>'produto_id')::bigint as produto_id, sum((e->>'quantidade')::numeric) as q from jsonb_array_elements(p->'itens') e group by 1 loop
      select coalesce(sum(quantidade), 0) into v_resto from orcamento_itens where orcamento_id = v_orc.id and produto_id = xc.produto_id;
      if v_resto = 0 then raise exception 'Produto % não saiu neste %', xc.produto_id, case when v_consig then 'consignado' else 'pedido reservado' end; end if;
      if xc.q > v_resto then raise exception 'Quantidade vendida do produto % (%) maior que a % (%)', xc.produto_id, xc.q, case when v_consig then 'levada' else 'reservada' end, v_resto; end if;
    end loop;
  end if;
  -- no acerto o estoque já saiu na entrega do consignado (ou na reserva): não confere de novo
  select * into tot from pdv_validar_itens(op, p, not v_separado);
  if v_frete < 0 then raise exception 'Frete inválido'; end if;
  if v_doc not in ('nfce', 'nfe') then raise exception 'Documento fiscal inválido: %', v_doc; end if;
  if v_doc = 'nfe' and (p->>'cliente_id') is null then raise exception 'NF-e exige cliente cadastrado (com CPF/CNPJ e endereço)'; end if;
  if v_frete > 0 and (p->>'cliente_id') is null then raise exception 'Venda com frete exige cliente cadastrado (CPF/CNPJ e endereço vão na nota)'; end if;
  v_total := tot.total + v_frete;
  if v_ent is not null then
    if coalesce(nullif(trim(coalesce(p->>'endereco_entrega', '')), ''), '') = '' then raise exception 'Entrega: informe o endereço'; end if;
    if (p->>'cliente_id') is null and coalesce(nullif(trim(coalesce(v_ent->>'nome', '')), ''), '') = '' then raise exception 'Entrega: informe o nome de quem recebe'; end if;
    if (p->>'cliente_id') is null and length(regexp_replace(coalesce(v_ent->>'telefone', ''), '\D', '', 'g')) < 10 then raise exception 'Entrega: informe o telefone com DDD'; end if;
    if (v_ent->>'data') is not null and (v_ent->>'data')::date < v_hoje then raise exception 'Entrega: a data já passou'; end if;
  end if;

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
                      observacao, origem, operador_id, orcamento_id, valor_frete, endereco_entrega, documento_fiscal,
                      entrega, entrega_nome, entrega_telefone, entrega_data, entrega_horario)
  values (v_hoje, v_agora::time, v_cli_id, coalesce(v_cli_nome, p->>'cliente_nome'), nullif(regexp_replace(coalesce(p->>'cpf', ''), '\D', '', 'g'), ''),
          tot.total_produtos, tot.desconto_total, v_total, 'finalizada', (p->>'num_caixa')::int,
          case when v_consig then concat_ws(' | ', nullif(p->>'observacao', ''), 'ACERTO DO CONSIGNADO ' || v_orc.id)
               when v_separado then concat_ws(' | ', nullif(p->>'observacao', ''), 'VENDA DA RESERVA ' || v_orc.id) else p->>'observacao' end,
          'erp', op.id, (p->>'orcamento_id')::bigint, v_frete, nullif(trim(coalesce(p->>'endereco_entrega', '')), ''), v_doc,
          v_ent is not null, upper(nullif(trim(coalesce(v_ent->>'nome', '')), '')), nullif(regexp_replace(coalesce(v_ent->>'telefone', ''), '\D', '', 'g'), ''),
          (v_ent->>'data')::date, nullif(trim(coalesce(v_ent->>'horario', '')), ''))
  returning id into v_id;

  for it in select * from jsonb_array_elements(p->'itens') loop
    i := i + 1;
    select id, nome, coalesce(custo_medio, custo) as custo into pr from produtos where id = (it->>'produto_id')::bigint for update;
    insert into venda_itens (venda_id, item, produto_id, descricao, quantidade, preco_unitario, desconto, total, custo)
    values (v_id, i, pr.id, pr.nome, (it->>'quantidade')::numeric, (it->>'preco_unitario')::numeric,
            round(coalesce((it->>'desconto')::numeric, 0), 2),
            round((it->>'quantidade')::numeric * (it->>'preco_unitario')::numeric, 2) - round(coalesce((it->>'desconto')::numeric, 0), 2), pr.custo);
    if not v_separado then
      update produtos set estoque = estoque - (it->>'quantidade')::numeric, data_ultima_saida = v_hoje where id = pr.id;
    end if;
  end loop;

  for pg in select * from jsonb_array_elements(p->'pagamentos') loop
    j := j + 1;
    v_valor := round((pg->>'valor')::numeric, 2);
    n := greatest(1, least(24, coalesce((pg->>'parcelas')::int, 1)));
    insert into venda_pagamentos (venda_id, item, forma_pagamento_id, valor, parcelas)
    values (v_id, j, forma_pagamento_pdv(pg->>'forma'), v_valor, n);
    if pg->>'forma' = 'crediario' then
      v_venc := vencimento_crediario(v_hoje); -- regra da loja: sempre dia 10 do mês seguinte
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

  if v_separado then
    -- o que não foi vendido volta ao estoque; a devolução é registrada linha a linha (na ordem dos itens levados)
    for xc in select produto_id, sum(quantidade) as levado from orcamento_itens where orcamento_id = v_orc.id group by 1 loop
      select coalesce(sum((e->>'quantidade')::numeric), 0) into v_resto from jsonb_array_elements(p->'itens') e where (e->>'produto_id')::bigint = xc.produto_id;
      v_dev := xc.levado - v_resto;
      if v_dev > 0 then update produtos set estoque = estoque + v_dev where id = xc.produto_id; end if;
      -- distribui o vendido pelas linhas; o que sobra em cada linha é devolução
      for pr in select item, quantidade from orcamento_itens where orcamento_id = v_orc.id and produto_id = xc.produto_id order by item loop
        update orcamento_itens set quantidade_devolvida = pr.quantidade - least(pr.quantidade, v_resto)
         where orcamento_id = v_orc.id and item = pr.item;
        v_resto := greatest(v_resto - pr.quantidade, 0);
      end loop;
    end loop;
    update orcamentos set status = 'convertido', venda_id = v_id, acertado_em = now() where id = v_orc.id;
  elsif v_orc.id is not null then
    update orcamentos set status = 'convertido', venda_id = v_id where id = v_orc.id;
  end if;
  return v_id;
end $$;
-- create or replace mantém os grants de 008 (só a API, com a service role, chama).
