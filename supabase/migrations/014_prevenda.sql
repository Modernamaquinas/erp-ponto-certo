-- Pré-venda: o vendedor monta o pedido no celular (lendo o código de barras pela câmera) com o nome do cliente,
-- e o caixa abre o registro no PDV para receber. É um orçamento com tipo 'prevenda': o PDV converte em venda
-- pelo mesmo caminho (finalizar_venda com orcamento_id, que barra a conversão em dobro). Roda também no PGlite.

alter table orcamentos add column tipo text not null default 'orcamento' check (tipo in ('orcamento', 'prevenda'));
create index orcamentos_prevenda_aberta on orcamentos (data desc, id desc) where tipo = 'prevenda' and status = 'aberto';

create or replace function salvar_orcamento(p jsonb) returns bigint
language plpgsql as $$
declare op operadores; tot record; v_id bigint := (p->>'id')::bigint; it jsonb; i int := 0; v_cli_id bigint; v_cli_nome text;
  v_tipo text := coalesce(nullif(p->>'tipo', ''), 'orcamento');
begin
  op := pdv_operador(p->>'operador_codigo');
  select * into tot from pdv_validar_itens(op, p, false);
  if (p->>'cliente_id') is not null then select id, nome into v_cli_id, v_cli_nome from clientes where id = (p->>'cliente_id')::bigint; end if;
  if v_tipo = 'prevenda' and coalesce(nullif(trim(coalesce(v_cli_nome, p->>'cliente_nome')), ''), '') = '' then
    raise exception 'Informe o nome do cliente da pré-venda';
  end if;
  if v_id is null then
    insert into orcamentos (data, hora, cliente_id, cliente_nome, operador_id, validade, total_produtos, desconto, total, observacao, tipo)
    values ((now() at time zone 'America/Sao_Paulo')::date, (now() at time zone 'America/Sao_Paulo')::time, v_cli_id,
            coalesce(v_cli_nome, upper(trim(p->>'cliente_nome'))), op.id, (p->>'validade')::date, tot.total_produtos, tot.desconto_total, tot.total,
            p->>'observacao', v_tipo)
    returning id into v_id;
  else
    update orcamentos set cliente_id = v_cli_id, cliente_nome = coalesce(v_cli_nome, upper(trim(p->>'cliente_nome'))), operador_id = op.id,
           validade = (p->>'validade')::date, total_produtos = tot.total_produtos, desconto = tot.desconto_total, total = tot.total,
           observacao = p->>'observacao'
     where id = v_id and status = 'aberto';
    if not found then raise exception 'Orçamento não está aberto'; end if;
    delete from orcamento_itens where orcamento_id = v_id;
  end if;
  for it in select * from jsonb_array_elements(p->'itens') loop
    i := i + 1;
    insert into orcamento_itens (orcamento_id, item, produto_id, descricao, quantidade, preco_unitario, desconto, total)
    select v_id, i, pr.id, pr.nome, (it->>'quantidade')::numeric, (it->>'preco_unitario')::numeric, round(coalesce((it->>'desconto')::numeric, 0), 2),
           round((it->>'quantidade')::numeric * (it->>'preco_unitario')::numeric, 2) - round(coalesce((it->>'desconto')::numeric, 0), 2)
      from produtos pr where pr.id = (it->>'produto_id')::bigint;
  end loop;
  return v_id;
end $$;
-- create or replace mantém os grants (008 revogou execute de authenticated); só a API (service role) chama.
