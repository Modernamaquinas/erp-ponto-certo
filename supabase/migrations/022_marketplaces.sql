-- 022 — Marketplaces (Mercado Livre agora; Shopee no mesmo modelo): vínculo anúncio ↔ produto(s), estoque enviado aos anúncios e
-- vendas dos canais registradas no ERP. Roda também no PGlite. Permissões em 023.
--
-- Estoque do anúncio = menor, entre os produtos da composição, de floor((estoque − reserva) / quantidade por venda), nunca < 0.
-- Qualquer mudança de estoque de um produto vinculado marca os anúncios dele como "pendente"; a API (api/marketplaces.js) envia
-- os pendentes logo após a venda no PDV e, de tempos em tempos, pela rotina agendada.

alter table vendas drop constraint if exists vendas_origem_check;
alter table vendas add constraint vendas_origem_check check (origem in ('legado', 'erp', 'marketplace'));
alter table vendas add column canal text;          -- 'mercadolivre' | 'shopee' (vendas de marketplace)
alter table vendas add column canal_pedido text;   -- nº do pedido no canal

create table marketplace_config (
  canal             text primary key check (canal in ('mercadolivre', 'shopee')),
  sincronizar       boolean not null default false,  -- chave geral: sem ela nada é enviado ao canal
  importar_vendas   boolean not null default false,
  reserva_padrao    numeric(14,3) not null default 1,
  ultimo_pedido_em  timestamptz,
  atualizado_em     timestamptz not null default now()
);
insert into marketplace_config (canal) values ('mercadolivre'), ('shopee');

create table marketplace_anuncios (
  canal            text not null check (canal in ('mercadolivre', 'shopee')),
  anuncio_id       text not null,
  titulo           text,
  status           text,
  estoque_canal    numeric(14,3),      -- o que o canal informou na última leitura
  preco            numeric(14,2),
  link             text,
  foto             text,
  gtin             text,
  sku              text,
  reserva          numeric(14,3),      -- null = reserva padrão do canal
  sincronizar      boolean not null default false,
  pendente         boolean not null default true,
  estoque_enviado  numeric(14,3),
  enviado_em       timestamptz,
  erro             text,
  lido_em          timestamptz,
  atualizado_em    timestamptz not null default now(),
  primary key (canal, anuncio_id)
);

create table marketplace_composicao (
  canal       text not null,
  anuncio_id  text not null,
  produto_id  bigint not null references produtos(id),
  quantidade  numeric(14,3) not null default 1 check (quantidade > 0),   -- kit de 2 = 2
  primary key (canal, anuncio_id, produto_id),
  foreign key (canal, anuncio_id) references marketplace_anuncios(canal, anuncio_id) on delete cascade
);
create index marketplace_composicao_produto on marketplace_composicao (produto_id);

create table marketplace_pedidos (
  canal         text not null,
  pedido_id     text not null,
  status        text,
  data          timestamptz,
  total         numeric(14,2),
  itens         jsonb,
  venda_id      bigint references vendas(id),
  erro          text,
  processado_em timestamptz,
  estornado_em  timestamptz,
  atualizado_em timestamptz not null default now(),
  primary key (canal, pedido_id)
);

-- formas de pagamento dos canais (achadas pela descrição; os ids do DirectControl continuam como estão)
insert into formas_pagamento (descricao, tipo) select 'MERCADO LIVRE', 'prazo' where not exists (select 1 from formas_pagamento where descricao = 'MERCADO LIVRE');
insert into formas_pagamento (descricao, tipo) select 'SHOPEE', 'prazo' where not exists (select 1 from formas_pagamento where descricao = 'SHOPEE');

-- relatórios (016): os canais aparecem pelo nome no gráfico de formas
create or replace function grupo_forma(p_id int) returns text
language sql stable as $$
  select case
    when p_id = 2 then 'Dinheiro'
    when p_id in (13, 19) then 'PIX'
    when p_id in (8, 15) then 'Cartão de débito'
    when p_id in (6, 7, 16, 17) then 'Cartão de crédito'
    when p_id in (10, 14) then 'Crediário'
    when p_id = 18 then 'Boleto'
    when p_id in (4, 5) then 'Cheque'
    when p_id is null then 'Sem informação'
    else coalesce((select case descricao when 'MERCADO LIVRE' then 'Mercado Livre' when 'SHOPEE' then 'Shopee' end
                   from formas_pagamento where id = p_id), 'Outros') end
$$;

-- ---------------------------------------------------------------- estoque calculado e pendências
create or replace function marketplace_qtd(p_canal text, p_anuncio text) returns numeric
language sql stable as $$
  select greatest(min(floor((pr.estoque - coalesce(a.reserva, c.reserva_padrao, 0)) / mc.quantidade)), 0)
  from marketplace_composicao mc
  join produtos pr on pr.id = mc.produto_id
  join marketplace_anuncios a on a.canal = mc.canal and a.anuncio_id = mc.anuncio_id
  join marketplace_config c on c.canal = mc.canal
  where mc.canal = p_canal and mc.anuncio_id = p_anuncio
$$;

create or replace function marketplace_marcar_pendente_produto() returns trigger
language plpgsql as $$
begin
  if new.estoque is distinct from old.estoque then
    update marketplace_anuncios a set pendente = true
     where (a.canal, a.anuncio_id) in (select canal, anuncio_id from marketplace_composicao where produto_id = new.id) and not a.pendente;
  end if;
  return null;
end $$;
create trigger produtos_marketplace after update of estoque on produtos for each row execute function marketplace_marcar_pendente_produto();

create or replace function marketplace_marcar_pendente_composicao() returns trigger
language plpgsql as $$
begin
  update marketplace_anuncios set pendente = true
   where canal = coalesce(new.canal, old.canal) and anuncio_id = coalesce(new.anuncio_id, old.anuncio_id);
  return null;
end $$;
create trigger composicao_marketplace after insert or update or delete on marketplace_composicao for each row execute function marketplace_marcar_pendente_composicao();

create or replace function marketplace_anuncio_toca() returns trigger
language plpgsql as $$
begin
  new.atualizado_em := now();
  if new.reserva is distinct from old.reserva or (new.sincronizar and not old.sincronizar) then new.pendente := true; end if;
  return new;
end $$;
create trigger marketplace_anuncios_toca before update on marketplace_anuncios for each row execute function marketplace_anuncio_toca();

-- Anúncios a enviar: sincronização ligada (geral e no anúncio), com composição, e quantidade calculada diferente da enviada.
create or replace function marketplace_pendentes(p_canal text, p_limite int default 100) returns table (anuncio_id text, quantidade numeric)
language sql stable security definer set search_path = public as $$
  select a.anuncio_id, marketplace_qtd(a.canal, a.anuncio_id)
  from marketplace_anuncios a join marketplace_config c on c.canal = a.canal
  where a.canal = p_canal and c.sincronizar and a.sincronizar and a.pendente
    and exists (select 1 from marketplace_composicao mc where mc.canal = a.canal and mc.anuncio_id = a.anuncio_id)
  order by a.enviado_em nulls first
  limit least(greatest(coalesce(p_limite, 100), 1), 100)
$$;

-- Resultado do envio: [{ anuncio_id, ok, quantidade?, erro? }]. Só tira o "pendente" se o estoque não mudou de novo no meio.
create or replace function marketplace_registrar_envio(p_canal text, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  for r in select * from jsonb_array_elements(coalesce(p, '[]')) loop
    if coalesce((r->>'ok')::boolean, false) then
      update marketplace_anuncios set estoque_enviado = (r->>'quantidade')::numeric, estoque_canal = (r->>'quantidade')::numeric, enviado_em = now(), erro = null,
             pendente = marketplace_qtd(canal, anuncio_id) is distinct from (r->>'quantidade')::numeric
       where canal = p_canal and anuncio_id = r->>'anuncio_id';
    else
      update marketplace_anuncios set erro = left(r->>'erro', 500), enviado_em = now() where canal = p_canal and anuncio_id = r->>'anuncio_id';
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- vendas dos canais
-- p = { canal, pedido_id, status ('paid' | 'cancelled' | ...), data, total, itens: [{ anuncio_id, titulo, quantidade, preco_unitario }] }
-- Pago e ainda não registrado -> venda finalizada (origem 'marketplace'), estoque baixado pela composição, sem caixa (o dinheiro
-- entra pelo canal). Cancelado depois de registrado -> venda cancelada e estoque devolvido. Idempotente por (canal, pedido_id).
create or replace function marketplace_registrar_pedido(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_canal text := p->>'canal'; v_pedido text := p->>'pedido_id'; v_status text := coalesce(p->>'status', '');
  v_ped marketplace_pedidos; it jsonb; mc record; v_id bigint; i int := 0; v_total numeric := 0; v_peso numeric; v_preco numeric;
  v_faltando text[] := '{}'; v_forma int; v_data timestamp := coalesce((p->>'data')::timestamptz, now()) at time zone 'America/Sao_Paulo';
  v_resto numeric; v_n int;
begin
  if v_canal not in ('mercadolivre', 'shopee') or coalesce(v_pedido, '') = '' then raise exception 'Pedido inválido'; end if;
  select * into v_ped from marketplace_pedidos where canal = v_canal and pedido_id = v_pedido for update;

  -- cancelado depois de registrado: estorna
  if v_status = 'cancelled' then
    if v_ped.venda_id is not null and v_ped.estornado_em is null then
      -- soma por produto: o mesmo produto pode estar em mais de uma linha (avulso e dentro de um kit)
      update produtos pr set estoque = pr.estoque + x.q
        from (select produto_id, sum(quantidade) as q from venda_itens where venda_id = v_ped.venda_id group by 1) x where x.produto_id = pr.id;
      update vendas set situacao = 'cancelada', observacao = concat_ws(' | ', observacao, 'CANCELADO NO CANAL') where id = v_ped.venda_id;
      update marketplace_pedidos set status = v_status, estornado_em = now(), atualizado_em = now() where canal = v_canal and pedido_id = v_pedido;
      return jsonb_build_object('acao', 'estornado', 'venda_id', v_ped.venda_id);
    end if;
    insert into marketplace_pedidos (canal, pedido_id, status, data, total, itens) values (v_canal, v_pedido, v_status, v_data, (p->>'total')::numeric, p->'itens')
    on conflict (canal, pedido_id) do update set status = excluded.status, atualizado_em = now();
    return jsonb_build_object('acao', 'ignorado');
  end if;
  if v_ped.venda_id is not null then
    update marketplace_pedidos set status = v_status, atualizado_em = now() where canal = v_canal and pedido_id = v_pedido;
    return jsonb_build_object('acao', 'ja_registrado', 'venda_id', v_ped.venda_id);
  end if;
  if v_status <> 'paid' then
    insert into marketplace_pedidos (canal, pedido_id, status, data, total, itens) values (v_canal, v_pedido, v_status, v_data, (p->>'total')::numeric, p->'itens')
    on conflict (canal, pedido_id) do update set status = excluded.status, itens = excluded.itens, atualizado_em = now();
    return jsonb_build_object('acao', 'aguardando_pagamento');
  end if;

  -- todos os anúncios do pedido precisam estar vinculados
  for it in select * from jsonb_array_elements(coalesce(p->'itens', '[]')) loop
    if not exists (select 1 from marketplace_composicao where canal = v_canal and anuncio_id = it->>'anuncio_id') then
      v_faltando := v_faltando || coalesce(it->>'titulo', it->>'anuncio_id');
    end if;
  end loop;
  if cardinality(v_faltando) > 0 or jsonb_array_length(coalesce(p->'itens', '[]')) = 0 then
    insert into marketplace_pedidos (canal, pedido_id, status, data, total, itens, erro) values (v_canal, v_pedido, v_status, v_data, (p->>'total')::numeric, p->'itens',
      'Anúncio sem produto vinculado: ' || array_to_string(v_faltando, ', '))
    on conflict (canal, pedido_id) do update set status = excluded.status, itens = excluded.itens, erro = excluded.erro, atualizado_em = now();
    return jsonb_build_object('acao', 'pendente_vinculo', 'faltando', to_jsonb(v_faltando));
  end if;

  select id into v_forma from formas_pagamento where descricao = case v_canal when 'mercadolivre' then 'MERCADO LIVRE' else 'SHOPEE' end order by id limit 1;
  insert into vendas (data, hora, cliente_nome, total_produtos, desconto, total, situacao, observacao, origem, canal, canal_pedido)
  values (v_data::date, v_data::time, case v_canal when 'mercadolivre' then 'MERCADO LIVRE' else 'SHOPEE' end || ' #' || v_pedido, 0, 0, 0, 'finalizada',
          'PEDIDO ' || upper(v_canal) || ' ' || v_pedido, 'marketplace', v_canal, v_pedido)
  returning id into v_id;

  for it in select * from jsonb_array_elements(p->'itens') loop
    -- valor do anúncio dividido entre os produtos da composição, pelo preço de venda de cada um
    select sum(mc2.quantidade * greatest(pr2.preco_venda, 0.01)), count(*) into v_peso, v_n
      from marketplace_composicao mc2 join produtos pr2 on pr2.id = mc2.produto_id where mc2.canal = v_canal and mc2.anuncio_id = it->>'anuncio_id';
    v_resto := round((it->>'quantidade')::numeric * (it->>'preco_unitario')::numeric, 2);
    for mc in select mc2.produto_id, mc2.quantidade, pr2.nome, greatest(pr2.preco_venda, 0.01) as pv, coalesce(pr2.custo_medio, pr2.custo) as custo
              from marketplace_composicao mc2 join produtos pr2 on pr2.id = mc2.produto_id
              where mc2.canal = v_canal and mc2.anuncio_id = it->>'anuncio_id' order by mc2.produto_id loop
      i := i + 1;
      v_n := v_n - 1;
      v_preco := case when v_n = 0 then v_resto
                 else round((it->>'quantidade')::numeric * (it->>'preco_unitario')::numeric * mc.quantidade * mc.pv / v_peso, 2) end;
      v_resto := v_resto - v_preco;
      insert into venda_itens (venda_id, item, produto_id, descricao, quantidade, preco_unitario, desconto, total, custo)
      values (v_id, i, mc.produto_id, mc.nome, (it->>'quantidade')::numeric * mc.quantidade,
              round(v_preco / ((it->>'quantidade')::numeric * mc.quantidade), 4), 0, v_preco, mc.custo);
      update produtos set estoque = estoque - (it->>'quantidade')::numeric * mc.quantidade, data_ultima_saida = v_data::date where id = mc.produto_id;
      v_total := v_total + v_preco;
    end loop;
  end loop;
  update vendas set total_produtos = v_total, total = v_total where id = v_id;
  insert into venda_pagamentos (venda_id, item, forma_pagamento_id, valor, parcelas) values (v_id, 1, v_forma, v_total, 1);

  insert into marketplace_pedidos (canal, pedido_id, status, data, total, itens, venda_id, processado_em, erro)
  values (v_canal, v_pedido, v_status, v_data, (p->>'total')::numeric, p->'itens', v_id, now(), null)
  on conflict (canal, pedido_id) do update set status = excluded.status, itens = excluded.itens, venda_id = excluded.venda_id,
    processado_em = excluded.processado_em, erro = null, atualizado_em = now();
  return jsonb_build_object('acao', 'registrado', 'venda_id', v_id, 'total', v_total);
end $$;

-- Leitura dos anúncios vindos do canal (upsert sem mexer em vínculo/reserva/sincronização) + vínculo automático pelo GTIN
-- quando o anúncio tem um único GTIN e ele é o código de barras de exatamente um produto ativo.
-- p = [{ anuncio_id, titulo, status, estoque, preco, link, foto, gtin, sku }]
create or replace function marketplace_ler_anuncios(p_canal text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_auto int := 0; v_prod bigint; v_n int := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p, '[]')) loop
    continue when coalesce(r->>'anuncio_id', '') = '';
    v_n := v_n + 1;
    insert into marketplace_anuncios (canal, anuncio_id, titulo, status, estoque_canal, preco, link, foto, gtin, sku, lido_em)
    values (p_canal, r->>'anuncio_id', r->>'titulo', r->>'status', (r->>'estoque')::numeric, (r->>'preco')::numeric, r->>'link', r->>'foto',
            nullif(r->>'gtin', ''), nullif(r->>'sku', ''), now())
    on conflict (canal, anuncio_id) do update set titulo = excluded.titulo, status = excluded.status, estoque_canal = excluded.estoque_canal,
      preco = excluded.preco, link = excluded.link, foto = excluded.foto, gtin = excluded.gtin, sku = excluded.sku, lido_em = now();
    if not exists (select 1 from marketplace_composicao where canal = p_canal and anuncio_id = r->>'anuncio_id')
       and coalesce(r->>'gtin', '') ~ '^\d{8,14}$' then
      select min(id) into v_prod from produtos where ativo and codigo_barras = r->>'gtin' having count(*) = 1;
      if v_prod is not null then
        insert into marketplace_composicao (canal, anuncio_id, produto_id, quantidade) values (p_canal, r->>'anuncio_id', v_prod, 1);
        v_auto := v_auto + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('lidos', v_n, 'vinculados_automaticamente', v_auto);
end $$;
