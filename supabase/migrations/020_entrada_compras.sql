-- 020 — Entrada de notas de compra pelo XML (ou pela chave, baixando o XML pela Focus NFe) e lista de compras.
-- Roda também no PGlite. Permissões em 021 (usa rel_permitido de 016/017: só admin/financeiro).

alter table compras add column origem text not null default 'legado' check (origem in ('legado', 'erp'));
alter table compras add column natureza_operacao text;
alter table compras add column valor_seguro numeric(14,2);
alter table compras add column valor_outras numeric(14,2);
alter table compras add column valor_icms numeric(14,2);
alter table compras add column observacao text;
alter table compras add column xml text;
alter table compras add column lancada_por text;
alter table compras add column lancada_em timestamptz;
create index compras_chave on compras (chave_nfe);

alter table compra_itens add column codigo_fornecedor text;
alter table compra_itens add column unidade text;
alter table compra_itens add column fator numeric(14,4);          -- unidades de estoque por unidade da nota (caixa com 12 = 12)
alter table compra_itens add column quantidade_estoque numeric(14,3);
alter table compra_itens add column custo_final numeric(14,4);    -- por unidade de estoque, com IPI/ST/frete/outras − desconto
alter table compra_itens add column cest text;
alter table compra_itens add column cst_icms text;
alter table compra_itens add column origem int;
alter table compra_itens add column valor_ipi numeric(14,2);
alter table compra_itens add column valor_st numeric(14,2);
alter table compra_itens add column produto_criado boolean not null default false;

-- ---------------------------------------------------------------- preparar: casa os itens do XML com o cadastro
-- p = { fornecedor_cnpj, chave, itens: [{ item, codigo, ean }] }
-- Casamento: 1) código do produto no fornecedor (produto_fornecedores, o mais usado); 2) código de barras (EAN).
create or replace function entrada_preparar(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_forn record; v_dup record; r jsonb;
begin
  perform rel_exigir('fin');
  select id, nome, fantasia into v_forn from fornecedores
   where regexp_replace(coalesce(cpf_cnpj, ''), '\D', '', 'g') = regexp_replace(coalesce(p->>'fornecedor_cnpj', ''), '\D', '', 'g') and coalesce(p->>'fornecedor_cnpj', '') <> ''
   order by ativo desc, id limit 1;
  if coalesce(p->>'chave', '') <> '' then
    select id, origem, data_entrada into v_dup from compras where chave_nfe = p->>'chave' order by id limit 1;
  end if;
  with it as (
    select (e->>'item')::int as item, nullif(e->>'codigo', '') as codigo, nullif(e->>'ean', '') as ean from jsonb_array_elements(coalesce(p->'itens', '[]')) e
  ),
  por_codigo as (
    select it.item, (select pf.produto_id from produto_fornecedores pf join produtos pr on pr.id = pf.produto_id
                      where pf.fornecedor_id = v_forn.id and pf.codigo_no_fornecedor = it.codigo
                      group by pf.produto_id order by bool_or(pr.ativo) desc, count(*) desc, max(pf.data) desc nulls last limit 1) as produto_id
    from it where v_forn.id is not null and it.codigo is not null
  ),
  por_ean as (
    select it.item, (select id from produtos where codigo_barras = it.ean order by ativo desc, id limit 1) as produto_id from it where it.ean is not null
  ),
  casado as (
    select it.item, coalesce(c.produto_id, e.produto_id) as produto_id,
           case when c.produto_id is not null then 'codigo_fornecedor' when e.produto_id is not null then 'ean' end as como
    from it left join por_codigo c on c.item = it.item left join por_ean e on e.item = it.item
  )
  select jsonb_build_object(
    'fornecedor', case when v_forn.id is null then null else jsonb_build_object('id', v_forn.id, 'nome', v_forn.nome, 'fantasia', v_forn.fantasia) end,
    'duplicada', case when v_dup.id is null then null else jsonb_build_object('compra_id', v_dup.id, 'origem', v_dup.origem, 'data_entrada', v_dup.data_entrada) end,
    'itens', coalesce((select jsonb_agg(jsonb_build_object('item', c.item, 'como', c.como, 'produto', case when pr.id is null then null else jsonb_build_object(
                 'id', pr.id, 'nome', pr.nome, 'unidade', pr.unidade, 'codigo_barras', pr.codigo_barras, 'estoque', pr.estoque, 'custo', pr.custo,
                 'custo_medio', pr.custo_medio, 'preco_venda', pr.preco_venda, 'margem', coalesce(pr.margem, sg.margem), 'ncm', pr.ncm, 'cest', pr.cest,
                 'cst_csosn', pr.cst_csosn, 'cfop', pr.cfop, 'origem', pr.origem, 'ativo', pr.ativo, 'grupo_id', pr.grupo_id) end) order by c.item)
               from casado c left join produtos pr on pr.id = c.produto_id left join subgrupos_produto sg on sg.id = pr.subgrupo_id), '[]')
  ) into r;
  return r;
end $$;

-- Sugestões fiscais pelo próprio cadastro: para um NCM, quais CEST / CSOSN / CFOP os produtos da loja já usam.
create or replace function fiscal_sugestoes_ncm(p_ncm text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('cest', cest, 'cst_csosn', cst_csosn, 'cfop', cfop, 'produtos', n, 'exemplo', exemplo) order by n desc), '[]')
  from (select nullif(cest, '') as cest, cst_csosn, cfop, count(*) as n, min(nome) as exemplo from produtos
        where ativo and ncm = regexp_replace(coalesce(p_ncm, ''), '\D', '', 'g') group by 1, 2, 3 order by 4 desc limit 8) x
  where rel_permitido('fin')
$$;

-- ---------------------------------------------------------------- lançar a nota
-- p = { chave?, numero, serie, data_emissao, data_entrada?, natureza?, xml?, observacao?,
--   fornecedor: { id? | cnpj, nome, fantasia, ie, endereco, numero, complemento, bairro, cidade_ibge, cep, telefone },
--   totais: { produtos, frete, seguro, desconto, ipi, st, outras, icms, total },
--   itens: [{ item, produto_id? | novo: { nome, unidade, codigo_barras, grupo_id, preco_venda }, codigo_fornecedor, descricao, ean,
--             ncm, cest, cfop, cst_icms, origem, unidade, quantidade, fator, valor_unitario, valor_produtos, valor_ipi, valor_st, custo_total,
--             atualizar?: { ncm, cest, cst_csosn, cfop, origem, preco_venda, codigo_barras } }],
--   duplicatas: [{ numero, vencimento, valor }], gerar_pagar: bool }
create or replace function lancar_compra(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_forn bigint := nullif(p #>> '{fornecedor,id}', '')::bigint; f jsonb := p->'fornecedor'; v_cnpj text; v_id bigint; v_hoje date := hoje_loja();
  it jsonb; v_prod bigint; v_qtd numeric; v_fator numeric; v_custo numeric; pr record; u jsonb; v_criado boolean; d jsonb; k int := 0; n int;
  v_usuario text := rel_usuario(); v_dup bigint; v_entrada date := coalesce(nullif(p->>'data_entrada', '')::date, hoje_loja());
begin
  perform rel_exigir('fin');
  if jsonb_array_length(coalesce(p->'itens', '[]')) = 0 then raise exception 'A nota não tem itens'; end if;
  if coalesce(p->>'chave', '') <> '' then
    if length(p->>'chave') <> 44 then raise exception 'Chave de acesso inválida'; end if;
    select id into v_dup from compras where chave_nfe = p->>'chave' limit 1;
    if v_dup is not null then raise exception 'Esta nota já foi lançada (compra %)', v_dup; end if;
  end if;
  if v_entrada > v_hoje then raise exception 'Data de entrada no futuro'; end if;

  -- fornecedor: o informado, o mesmo CNPJ ou um novo cadastro com os dados do XML
  v_cnpj := regexp_replace(coalesce(f->>'cnpj', ''), '\D', '', 'g');
  if v_forn is null and v_cnpj <> '' then
    select id into v_forn from fornecedores where regexp_replace(coalesce(cpf_cnpj, ''), '\D', '', 'g') = v_cnpj order by ativo desc, id limit 1;
  end if;
  if v_forn is null then
    if coalesce(f->>'nome', '') = '' then raise exception 'Informe o fornecedor'; end if;
    insert into fornecedores (nome, fantasia, tipo_pessoa, cpf_cnpj, ie, telefone, cep, endereco, numero, complemento, bairro, cidade_id, criado_em)
    values (upper(f->>'nome'), upper(nullif(f->>'fantasia', '')), case when length(v_cnpj) = 11 then 'F' else 'J' end, nullif(v_cnpj, ''),
            nullif(f->>'ie', ''), nullif(f->>'telefone', ''), nullif(f->>'cep', ''), upper(nullif(f->>'endereco', '')), nullif(f->>'numero', ''),
            upper(nullif(f->>'complemento', '')), upper(nullif(f->>'bairro', '')),
            (select id from cidades where ibge = nullif(f->>'cidade_ibge', '')::int limit 1), v_hoje)
    returning id into v_forn;
  end if;

  insert into compras (numero_nota, serie, chave_nfe, fornecedor_id, data_emissao, data_entrada, valor_produtos, valor_frete, valor_ipi, valor_st,
                       desconto, valor_total, valor_seguro, valor_outras, valor_icms, natureza_operacao, observacao, xml, origem, lancada_por, lancada_em)
  values (nullif(p->>'numero', ''), nullif(p->>'serie', '')::int, nullif(p->>'chave', ''), v_forn, nullif(p->>'data_emissao', '')::date, v_entrada,
          (p #>> '{totais,produtos}')::numeric, (p #>> '{totais,frete}')::numeric, (p #>> '{totais,ipi}')::numeric, (p #>> '{totais,st}')::numeric,
          (p #>> '{totais,desconto}')::numeric, (p #>> '{totais,total}')::numeric, (p #>> '{totais,seguro}')::numeric, (p #>> '{totais,outras}')::numeric,
          (p #>> '{totais,icms}')::numeric, p->>'natureza', p->>'observacao', p->>'xml', 'erp', v_usuario, now())
  returning id into v_id;

  for it in select * from jsonb_array_elements(p->'itens') loop
    v_fator := coalesce(nullif(it->>'fator', '')::numeric, 1);
    if v_fator <= 0 then raise exception 'Item %: fator de conversão inválido', it->>'item'; end if;
    v_qtd := round((it->>'quantidade')::numeric * v_fator, 3);
    if v_qtd <= 0 then raise exception 'Item %: quantidade inválida', it->>'item'; end if;
    v_custo := round((it->>'custo_total')::numeric / v_qtd, 4);
    v_prod := nullif(it->>'produto_id', '')::bigint;
    v_criado := false;
    u := coalesce(it->'atualizar', '{}');

    if v_prod is null then
      if it->'novo' is null then raise exception 'Item % (%): escolha o produto do cadastro ou cadastre um novo', it->>'item', it->>'descricao'; end if;
      if coalesce(it #>> '{novo,nome}', '') = '' then raise exception 'Item %: informe o nome do produto novo', it->>'item'; end if;
      if coalesce(u->>'ncm', it->>'ncm', '') !~ '^\d{8}$' then raise exception 'Item %: NCM do produto novo precisa ter 8 dígitos', it->>'item'; end if;
      insert into produtos (nome, unidade, codigo_barras, grupo_id, preco_venda, custo, custo_medio, estoque, ativo, ncm, cest, cfop, cst_csosn,
                            origem, data_ultima_entrada, criado_em, alterado_erp)
      values (upper(it #>> '{novo,nome}'), upper(coalesce(nullif(it #>> '{novo,unidade}', ''), 'UN')), nullif(coalesce(it #>> '{novo,codigo_barras}', it->>'ean'), ''),
              nullif(it #>> '{novo,grupo_id}', '')::int, coalesce(nullif(u->>'preco_venda', '')::numeric, nullif(it #>> '{novo,preco_venda}', '')::numeric, 0),
              v_custo, v_custo, 0, true, coalesce(u->>'ncm', it->>'ncm'), nullif(coalesce(u->>'cest', it->>'cest'), ''),
              coalesce(nullif(u->>'cfop', '')::int, 5102), coalesce(nullif(u->>'cst_csosn', ''), '102'), coalesce(nullif(u->>'origem', '')::int, nullif(it->>'origem', '')::int, 0),
              v_entrada, v_hoje, true)
      returning id into v_prod;
      v_criado := true;
    end if;

    select id, estoque, custo_medio, custo into pr from produtos where id = v_prod for update;
    if pr.id is null then raise exception 'Item %: produto % não encontrado', it->>'item', v_prod; end if;
    update produtos set
      estoque = pr.estoque + v_qtd,
      custo = v_custo,
      -- custo médio ponderado (com estoque zerado/negativo, vale o custo desta compra)
      custo_medio = case when pr.estoque > 0 and coalesce(pr.custo_medio, pr.custo, 0) > 0
                         then round((pr.estoque * coalesce(nullif(pr.custo_medio, 0), pr.custo) + v_qtd * v_custo) / (pr.estoque + v_qtd), 4) else v_custo end,
      data_ultima_entrada = v_entrada,
      ncm = case when not v_criado and u ? 'ncm' and u->>'ncm' ~ '^\d{8}$' then u->>'ncm' else ncm end,
      cest = case when not v_criado and u ? 'cest' then nullif(regexp_replace(coalesce(u->>'cest', ''), '\D', '', 'g'), '') else cest end,
      cst_csosn = case when not v_criado and u ? 'cst_csosn' then u->>'cst_csosn' else cst_csosn end,
      cfop = case when not v_criado and u ? 'cfop' then (u->>'cfop')::int else cfop end,
      origem = case when not v_criado and u ? 'origem' then (u->>'origem')::int else origem end,
      preco_venda = case when not v_criado and nullif(u->>'preco_venda', '') is not null then (u->>'preco_venda')::numeric else preco_venda end,
      codigo_barras = case when not v_criado and nullif(u->>'codigo_barras', '') is not null then u->>'codigo_barras' else codigo_barras end,
      alterado_erp = case when not v_criado and (u ?| array['ncm', 'cest', 'cst_csosn', 'cfop', 'origem', 'preco_venda', 'codigo_barras']) then true else alterado_erp end
    where id = v_prod;

    -- vínculo produto x código no fornecedor (próxima nota casa sozinha)
    if coalesce(it->>'codigo_fornecedor', '') <> '' then
      if exists (select 1 from produto_fornecedores where fornecedor_id = v_forn and codigo_no_fornecedor = it->>'codigo_fornecedor' and produto_id = v_prod) then
        update produto_fornecedores set preco_custo = round((it->>'valor_unitario')::numeric, 4), data = v_entrada
         where fornecedor_id = v_forn and codigo_no_fornecedor = it->>'codigo_fornecedor' and produto_id = v_prod;
      else
        insert into produto_fornecedores (produto_id, fornecedor_id, codigo_no_fornecedor, preco_custo, data)
        values (v_prod, v_forn, it->>'codigo_fornecedor', round((it->>'valor_unitario')::numeric, 4), v_entrada);
      end if;
    end if;

    insert into compra_itens (compra_id, item, produto_id, descricao, quantidade, custo_unitario, total, ncm, cfop, ean, codigo_fornecedor, unidade, fator,
                              quantidade_estoque, custo_final, cest, cst_icms, origem, valor_ipi, valor_st, produto_criado)
    values (v_id, (it->>'item')::int, v_prod, it->>'descricao', (it->>'quantidade')::numeric, (it->>'valor_unitario')::numeric,
            (it->>'valor_produtos')::numeric, it->>'ncm', it->>'cfop', it->>'ean', it->>'codigo_fornecedor', it->>'unidade', v_fator,
            v_qtd, v_custo, it->>'cest', it->>'cst_icms', nullif(it->>'origem', '')::int, nullif(it->>'valor_ipi', '')::numeric,
            nullif(it->>'valor_st', '')::numeric, v_criado);
  end loop;

  -- duplicatas -> contas a pagar
  if coalesce((p->>'gerar_pagar')::boolean, false) then
    n := jsonb_array_length(coalesce(p->'duplicatas', '[]'));
    for d in select * from jsonb_array_elements(coalesce(p->'duplicatas', '[]')) loop
      k := k + 1;
      if coalesce((d->>'valor')::numeric, 0) <= 0 or nullif(d->>'vencimento', '') is null then raise exception 'Duplicata %: informe vencimento e valor', k; end if;
      insert into contas_pagar (fornecedor_id, compra_id, documento, historico, parcela, total_parcelas, emissao, vencimento, valor, saldo, status)
      values (v_forn, v_id, concat_ws('/', nullif(p->>'numero', ''), nullif(d->>'numero', '')),
              'NF ' || coalesce(p->>'numero', '') || ' - ' || coalesce((select coalesce(fantasia, nome) from fornecedores where id = v_forn), ''),
              k, n, nullif(p->>'data_emissao', '')::date, (d->>'vencimento')::date, round((d->>'valor')::numeric, 2), round((d->>'valor')::numeric, 2), 'aberto');
    end loop;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------- lista de compras
-- p = { situacao: 'todos'|'falta'|'minimo', grupo_id?, fornecedor_id?, dias? (vendas p/ média, padrão 90), cobertura? (dias, padrão 30),
--       incluir_sem_giro? (itens zerados sem venda no período e sem mínimo; padrão false) }
-- falta = estoque <= 0; minimo = estoque_minimo > 0 e estoque <= estoque_minimo.
-- Sugestão = o que falta para chegar ao maior entre o mínimo e a cobertura (média diária de venda × dias de cobertura),
-- e no mínimo a quantidade do estoque mínimo (ou 1).
create or replace function lista_compras(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_hoje date := hoje_loja(); v_dias int := least(greatest(coalesce((p->>'dias')::int, 90), 7), 730);
        v_cob int := least(greatest(coalesce((p->>'cobertura')::int, 30), 1), 365); v_sit text := coalesce(nullif(p->>'situacao', ''), 'todos');
        v_grupo int := nullif(p->>'grupo_id', '')::int; v_forn bigint := nullif(p->>'fornecedor_id', '')::bigint;
        v_sem_giro boolean := coalesce((p->>'incluir_sem_giro')::boolean, false); r jsonb;
begin
  perform rel_exigir('fin');
  with vend as (
    select vi.produto_id, sum(vi.quantidade) as q from venda_itens vi join vendas v on v.id = vi.venda_id
    where v.situacao = 'finalizada' and v.data > v_hoje - v_dias and vi.produto_id is not null group by 1
  ),
  -- último fornecedor: a compra mais recente do produto (nota de entrada); sem compra, o vínculo mais recente
  ult as (
    select distinct on (ci.produto_id) ci.produto_id, c.fornecedor_id, c.data_entrada, coalesce(ci.custo_final, ci.custo_unitario) as custo, ci.codigo_fornecedor
    from compra_itens ci join compras c on c.id = ci.compra_id where ci.produto_id is not null
    order by ci.produto_id, c.data_entrada desc nulls last, c.id desc
  ),
  vinc as (
    select distinct on (produto_id) produto_id, fornecedor_id, codigo_no_fornecedor from produto_fornecedores order by produto_id, data desc nulls last, id desc
  ),
  base as (
    select pr.id, pr.nome, pr.referencia, pr.codigo_barras, pr.unidade, coalesce(g.nome, 'Sem grupo') as grupo, pr.estoque, pr.estoque_minimo,
           coalesce(vd.q, 0) as vendido, round(coalesce(vd.q, 0) / v_dias, 3) as media_dia,
           coalesce(u.fornecedor_id, vc.fornecedor_id) as fornecedor_id, coalesce(u.codigo_fornecedor, vc.codigo_no_fornecedor) as codigo_fornecedor,
           u.data_entrada as ultima_compra, coalesce(u.custo, nullif(pr.custo, 0), pr.custo_medio) as ultimo_custo, pr.preco_venda,
           case when pr.estoque <= 0 then 'falta' else 'minimo' end as situacao
    from produtos pr left join grupos_produto g on g.id = pr.grupo_id left join vend vd on vd.produto_id = pr.id
    left join ult u on u.produto_id = pr.id left join vinc vc on vc.produto_id = pr.id
    where pr.ativo and (v_grupo is null or pr.grupo_id = v_grupo)
      and (pr.estoque <= 0 or (pr.estoque_minimo > 0 and pr.estoque <= pr.estoque_minimo))
      and (v_sem_giro or coalesce(vd.q, 0) > 0 or pr.estoque_minimo > 0)
  ),
  sug as (
    -- no mínimo ou em falta, sugere pelo menos a quantidade do mínimo (ou 1)
    select b.*, greatest(ceil(greatest(coalesce(b.estoque_minimo, 0), b.media_dia * v_cob) - b.estoque), greatest(ceil(coalesce(b.estoque_minimo, 0)), 1)) as sugestao
    from base b
    where (v_sit = 'todos' or b.situacao = v_sit) and (v_forn is null or b.fornecedor_id = v_forn)
  )
  select jsonb_build_object(
    'parametros', jsonb_build_object('dias', v_dias, 'cobertura', v_cob, 'situacao', v_sit),
    'resumo', (select jsonb_build_object('itens', count(*), 'em_falta', count(*) filter (where situacao = 'falta'),
                 'no_minimo', count(*) filter (where situacao = 'minimo'), 'valor_estimado', round(coalesce(sum(sugestao * coalesce(ultimo_custo, 0)), 0), 2)) from sug),
    'itens', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nome', s.nome, 'referencia', s.referencia, 'codigo_barras', s.codigo_barras, 'unidade', s.unidade,
                 'grupo', s.grupo, 'estoque', s.estoque, 'estoque_minimo', s.estoque_minimo, 'vendido', s.vendido, 'media_dia', s.media_dia,
                 'sugestao', s.sugestao, 'situacao', s.situacao, 'fornecedor_id', s.fornecedor_id, 'fornecedor', coalesce(f.fantasia, f.nome),
                 'fornecedor_celular', coalesce(f.celular, f.telefone), 'codigo_fornecedor', s.codigo_fornecedor, 'ultima_compra', s.ultima_compra,
                 'ultimo_custo', s.ultimo_custo, 'preco_venda', s.preco_venda)
               order by coalesce(f.fantasia, f.nome) nulls last, s.situacao, s.nome)
             from (select * from sug order by vendido desc limit 3000) s left join fornecedores f on f.id = s.fornecedor_id), '[]')
  ) into r;
  return r;
end $$;
