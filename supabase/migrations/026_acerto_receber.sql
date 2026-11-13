-- 026 — Acerto do crediário no balcão: o cliente escolhe quais títulos em aberto vai pagar (um a um, pagamento total ou parcial de
-- cada), e o pagamento pode ser dividido em várias formas, com troco no dinheiro. Tudo numa transação: cada parte vira um
-- recebimento pela baixar_conta_receber (mesma regra da baixa manual) e entra no caixa como no PDV (entrada por forma + saída do troco).
-- Títulos em cobrança Asaas ficam de fora (a baixa deles é automática). Roda com o usuário logado (RLS: admin/financeiro).
create or replace function receber_acerto(p jsonb) returns jsonb
language plpgsql as $$
declare
  v_data date := coalesce((p->>'data')::date, hoje_loja());
  v_usuario text := coalesce(rel_usuario(), p->>'usuario');
  v_cli bigint; v_nome text; v_total numeric := 0; v_pago numeric := 0; v_din numeric := 0; v_troco numeric;
  t record; pg jsonb; v_forma int; v_valor numeric; v_resta numeric; v_parte numeric; k int := 0;
  v_ids text; v_titulos jsonb := '[]'; a_id bigint[] := '{}'; a_val numeric[] := '{}'; a_resta numeric[] := '{}'; i int;
begin
  perform rel_exigir('fin');
  if jsonb_array_length(coalesce(p->'titulos', '[]')) = 0 then raise exception 'Selecione pelo menos um título'; end if;
  if jsonb_array_length(coalesce(p->'pagamentos', '[]')) = 0 then raise exception 'Informe o pagamento'; end if;

  if (select count(distinct x->>'id') from jsonb_array_elements(p->'titulos') x) <> jsonb_array_length(p->'titulos') then
    raise exception 'Título repetido no acerto'; end if;
  -- títulos: trava, confere e soma o que vai ser pago de cada um
  for t in
    select c.*, (x->>'valor')::numeric as pagar
    from jsonb_array_elements(p->'titulos') x join contas_receber c on c.id = (x->>'id')::bigint
    order by c.vencimento, c.id for update of c
  loop
    if t.status <> 'aberto' then raise exception 'O título % não está em aberto', t.id; end if;
    if t.cobranca_id is not null then raise exception 'O título % está numa cobrança Asaas: cancele a cobrança antes de receber no balcão', t.id; end if;
    if v_cli is not null and v_cli <> t.cliente_id then raise exception 'Os títulos precisam ser do mesmo cliente'; end if;
    v_cli := t.cliente_id;
    v_valor := round(coalesce(t.pagar, t.saldo), 2);
    if v_valor <= 0 then raise exception 'Valor a pagar do título % deve ser positivo', t.id; end if;
    if v_valor > t.saldo then raise exception 'Valor do título % (%) maior que o saldo (%)', t.id, v_valor, t.saldo; end if;
    k := k + 1;
    a_id := a_id || t.id; a_val := a_val || v_valor; a_resta := a_resta || v_valor;
    v_total := v_total + v_valor;
  end loop;
  if k <> jsonb_array_length(p->'titulos') then raise exception 'Título não encontrado'; end if;
  select nome into v_nome from clientes where id = v_cli;
  v_ids := array_to_string(a_id, ', ');

  -- pagamentos: o que passar do total é troco e tem que sair do dinheiro
  for pg in select * from jsonb_array_elements(p->'pagamentos') loop
    if coalesce(pg->>'forma', '') not in ('dinheiro', 'pix', 'debito', 'credito', 'cheque') then
      raise exception 'Forma de pagamento inválida no acerto: %', coalesce(pg->>'forma', '(vazia)'); end if;
    v_valor := round(coalesce((pg->>'valor')::numeric, 0), 2);
    if v_valor <= 0 then raise exception 'Valor de pagamento deve ser positivo'; end if;
    v_pago := v_pago + v_valor;
    if pg->>'forma' = 'dinheiro' then v_din := v_din + v_valor; end if;
  end loop;
  if v_pago < v_total then raise exception 'Pagamento (%) menor que o total do acerto (%)', v_pago, v_total; end if;
  v_troco := v_pago - v_total;
  if v_troco > v_din then raise exception 'O valor pago acima do total só pode ser troco do dinheiro'; end if;

  -- distribui cada pagamento pelos títulos, do vencimento mais antigo para o mais novo
  for pg in select * from jsonb_array_elements(p->'pagamentos') loop
    v_forma := forma_pagamento_pdv(pg->>'forma');
    v_resta := round((pg->>'valor')::numeric, 2);
    if pg->>'forma' = 'dinheiro' and v_troco > 0 then
      v_parte := least(v_troco, v_resta); v_resta := v_resta - v_parte;
    end if;
    insert into caixa_lancamentos (data, hora, historico, entrada, forma_pagamento_id, documento, origem, usuario)
    values (v_data, (now() at time zone 'America/Sao_Paulo')::time, 'RECEBIMENTO CREDIARIO - ' || coalesce(v_nome, v_cli::text) || ' (TIT. ' || v_ids || ')',
            round((pg->>'valor')::numeric, 2), v_forma, 'ACERTO ' || v_cli, 'erp', v_usuario);
    for i in 1..k loop
      exit when v_resta <= 0;
      continue when a_resta[i] <= 0;
      v_parte := least(v_resta, a_resta[i]);
      perform baixar_conta_receber(a_id[i], v_parte, v_data, v_forma, v_usuario);
      a_resta[i] := a_resta[i] - v_parte;
      v_resta := v_resta - v_parte;
    end loop;
  end loop;
  if v_troco > 0 then
    insert into caixa_lancamentos (data, hora, historico, saida, forma_pagamento_id, documento, origem, usuario)
    values (v_data, (now() at time zone 'America/Sao_Paulo')::time, 'TROCO RECEBIMENTO CREDIARIO - ' || coalesce(v_nome, v_cli::text),
            v_troco, 2, 'ACERTO ' || v_cli, 'erp', v_usuario);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'vencimento', c.vencimento, 'historico', coalesce(c.historico, c.documento),
                                               'pago', a.valor, 'saldo', c.saldo, 'status', c.status) order by a.ord), '[]')
    into v_titulos from unnest(a_id, a_val) with ordinality a(id, valor, ord) join contas_receber c on c.id = a.id;
  return jsonb_build_object('cliente_id', v_cli, 'cliente', v_nome, 'data', v_data, 'total', v_total, 'pago', v_pago,
                            'troco', v_troco, 'titulos', v_titulos, 'pagamentos', p->'pagamentos', 'usuario', v_usuario);
end $$;
