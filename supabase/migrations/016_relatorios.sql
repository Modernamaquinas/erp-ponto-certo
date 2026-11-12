-- 016 — Relatórios (vendas, estoque, contas a receber, contas a pagar, financeiro) e contagem cíclica de estoque.
-- Tudo agregado no banco: a API do Supabase devolve no máximo 1000 linhas, então o navegador recebe um jsonb pronto.
-- Roda também no PGlite (testes). As permissões ficam em 017 (rel_permitido é redefinida lá com os papéis).

create or replace function hoje_loja() returns date
language sql stable as $$ select (now() at time zone 'America/Sao_Paulo')::date $$;

-- Quem pode o quê. Aqui (PGlite/testes) libera tudo; 017 troca pela checagem de papel do Supabase.
--   'fin'    relatórios (vendas com custo/lucro, estoque valorizado, financeiro) e criar/fechar contagens
--   'contar' lançar quantidades contadas (qualquer usuário ativo)
create or replace function rel_permitido(p_nivel text) returns boolean
language sql stable as $$ select true $$;

-- Nome de quem está usando (gravado na contagem). 017 troca pelo usuário logado.
create or replace function rel_usuario() returns text
language sql stable as $$ select null::text $$;

create or replace function rel_exigir(p_nivel text) returns void
language plpgsql stable as $$
begin
  if not coalesce(rel_permitido(p_nivel), false) then
    raise exception 'Seu usuário não tem acesso a este relatório' using errcode = '42501';
  end if;
end $$;

-- Formas de pagamento do DirectControl/ERP agrupadas para os gráficos.
create or replace function grupo_forma(p_id int) returns text
language sql immutable as $$
  select case
    when p_id = 2 then 'Dinheiro'
    when p_id in (13, 19) then 'PIX'
    when p_id in (8, 15) then 'Cartão de débito'
    when p_id in (6, 7, 16, 17) then 'Cartão de crédito'
    when p_id in (10, 14) then 'Crediário'
    when p_id = 18 then 'Boleto'
    when p_id in (4, 5) then 'Cheque'
    when p_id is null then 'Sem informação'
    else 'Outros' end
$$;

-- Período anterior de mesmo tamanho (comparativo).
create or replace function rel_resumo_vendas(p_ini date, p_fim date) returns jsonb
language sql stable as $$
  with v as (select * from vendas where situacao = 'finalizada' and data between p_ini and p_fim),
  c as (
    select coalesce(sum(vi.quantidade * vi.custo), 0) as custo,
           coalesce(sum(vi.total) filter (where vi.custo is not null and vi.custo > 0), 0) as receita_com_custo,
           coalesce(sum(vi.total), 0) as receita_itens
    from venda_itens vi join v on v.id = vi.venda_id
  )
  select jsonb_build_object(
    'qtd', (select count(*) from v),
    'total', (select coalesce(sum(total), 0) from v),
    'desconto', (select coalesce(sum(desconto), 0) from v),
    'frete', (select coalesce(sum(valor_frete), 0) from v),
    'ticket', (select coalesce(round(avg(total), 2), 0) from v),
    'itens', (select coalesce(sum(vi.quantidade), 0) from venda_itens vi join v on v.id = vi.venda_id),
    'custo', (select round(custo, 2) from c),
    -- lucro bruto = vendas sem frete - custo dos itens; cobertura = parte da receita cujos itens têm custo cadastrado
    'lucro', (select round((select coalesce(sum(total - valor_frete), 0) from v) - custo, 2) from c),
    'cobertura_custo', (select case when receita_itens > 0 then round(receita_com_custo / receita_itens * 100, 1) else 100 end from c)
  )
$$;

create or replace function rel_vendas(p_ini date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_dias int := p_fim - p_ini + 1;
  v_mensal boolean := (p_fim - p_ini) > 62;
  r jsonb;
begin
  perform rel_exigir('fin');
  if p_ini is null or p_fim is null or p_fim < p_ini then raise exception 'Período inválido'; end if;
  if v_dias > 1100 then raise exception 'Período máximo de 3 anos'; end if;

  with v as (select * from vendas where situacao = 'finalizada' and data between p_ini and p_fim),
  serie as (
    select g::date as periodo from generate_series(
      case when v_mensal then date_trunc('month', p_ini) else p_ini end,
      case when v_mensal then date_trunc('month', p_fim) else p_fim end,
      case when v_mensal then interval '1 month' else interval '1 day' end) g
  ),
  pf as (
    select vp.venda_id, grupo_forma(vp.forma_pagamento_id) as g, sum(vp.valor) as valor
    from venda_pagamentos vp join v on v.id = vp.venda_id group by 1, 2
  ),
  -- o que foi pago a mais numa venda é troco: sai do dinheiro
  ex as (select pf.venda_id, greatest(sum(pf.valor) - max(v.total), 0) as troco from pf join v on v.id = pf.venda_id group by 1),
  formas as (
    select pf.g, sum(greatest(pf.valor - case when pf.g = 'Dinheiro' then ex.troco else 0 end, 0)) as total, count(distinct pf.venda_id) as qtd
    from pf join ex on ex.venda_id = pf.venda_id group by 1
    union all
    select 'Sem informação', coalesce(sum(v.total), 0), count(*) from v where not exists (select 1 from pf where pf.venda_id = v.id)
    having count(*) > 0
  ),
  vend as (
    select coalesce(o.nome, u.nome, 'Não informado') as nome, count(*) as qtd, sum(v.total) as total
    from v left join operadores o on o.id = v.operador_id left join usuarios_legado u on u.id = v.vendedor_legado
    group by 1
  ),
  itens as (
    select vi.*, p.nome as produto_nome, p.grupo_id from venda_itens vi join v on v.id = vi.venda_id left join produtos p on p.id = vi.produto_id
  )
  select jsonb_build_object(
    'periodo', jsonb_build_object('ini', p_ini, 'fim', p_fim, 'agrupamento', case when v_mensal then 'mes' else 'dia' end),
    'resumo', rel_resumo_vendas(p_ini, p_fim),
    'anterior', rel_resumo_vendas(p_ini - v_dias, p_ini - 1),
    'serie', (select coalesce(jsonb_agg(jsonb_build_object('periodo', s.periodo, 'qtd', coalesce(x.qtd, 0), 'total', coalesce(x.total, 0)) order by s.periodo), '[]')
              from serie s left join (
                select case when v_mensal then date_trunc('month', data)::date else data end as periodo, count(*) as qtd, sum(total) as total
                from v group by 1) x on x.periodo = s.periodo),
    'por_forma', (select coalesce(jsonb_agg(jsonb_build_object('forma', g, 'total', round(total, 2), 'qtd', qtd) order by total desc), '[]')
                  from (select g, sum(total) as total, sum(qtd) as qtd from formas group by g) f where total > 0),
    'por_situacao', (select coalesce(jsonb_agg(jsonb_build_object('situacao', situacao, 'qtd', qtd, 'total', total) order by qtd desc), '[]')
                     from (select situacao, count(*) as qtd,
                                  case when situacao = 'finalizada' then sum(total) end as total
                           from vendas where data between p_ini and p_fim group by 1) s),
    'por_documento', (select coalesce(jsonb_agg(jsonb_build_object('documento', d, 'qtd', qtd, 'total', total) order by total desc), '[]')
                      from (select case when numero_nfe is not null then 'NF-e' when numero_nfce is not null then 'NFC-e' else 'Sem nota no ERP' end as d,
                                   count(*) as qtd, sum(total) as total from v group by 1) d),
    'por_origem', (select coalesce(jsonb_agg(jsonb_build_object('origem', origem, 'qtd', qtd, 'total', total)), '[]')
                   from (select origem, count(*) as qtd, sum(total) as total from v group by 1) o),
    'por_dia_semana', (select coalesce(jsonb_agg(jsonb_build_object('dia', d, 'qtd', qtd, 'total', total) order by d), '[]')
                       from (select extract(isodow from data)::int as d, count(*) as qtd, sum(total) as total from v group by 1) s),
    'por_hora', (select coalesce(jsonb_agg(jsonb_build_object('hora', h, 'qtd', qtd, 'total', total) order by h), '[]')
                 from (select extract(hour from hora)::int as h, count(*) as qtd, sum(total) as total from v where hora is not null group by 1) s),
    'por_vendedor', (select coalesce(jsonb_agg(jsonb_build_object('vendedor', nome, 'qtd', qtd, 'total', total, 'ticket', round(total / qtd, 2)) order by total desc), '[]') from vend),
    'por_grupo', (select coalesce(jsonb_agg(jsonb_build_object('grupo', grupo, 'total', total, 'lucro', lucro) order by total desc), '[]')
                  from (select coalesce(gp.nome, 'Sem grupo') as grupo, round(sum(i.total), 2) as total,
                               round(sum(i.total - i.quantidade * coalesce(nullif(i.custo, 0), null)), 2) as lucro
                        from itens i left join grupos_produto gp on gp.id = i.grupo_id group by 1) g),
    'top_produtos', (select coalesce(jsonb_agg(t order by (t->>'total')::numeric desc), '[]') from (
                       select jsonb_build_object('produto_id', produto_id, 'nome', coalesce(max(produto_nome), max(descricao)),
                              'qtd', sum(quantidade), 'total', round(sum(total), 2),
                              'lucro', round(sum(total - quantidade * coalesce(nullif(custo, 0), null)), 2)) as t
                       from itens group by produto_id order by sum(total) desc limit 30) x),
    'top_clientes', (select coalesce(jsonb_agg(jsonb_build_object('cliente_id', cliente_id, 'nome', nome, 'qtd', qtd, 'total', total) order by total desc), '[]')
                     from (select v.cliente_id, coalesce(max(c.nome), max(v.cliente_nome)) as nome, count(*) as qtd, sum(v.total) as total
                           from v left join clientes c on c.id = v.cliente_id where v.cliente_id is not null
                           group by 1 order by 4 desc limit 20) c)
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------- estoque
create or replace function rel_estoque(p_dias_sem_giro int default 180) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_hoje date := hoje_loja(); v_dias int := greatest(coalesce(p_dias_sem_giro, 180), 30);
begin
  perform rel_exigir('fin');
  with p as (
    select pr.*, coalesce(nullif(pr.custo_medio, 0), pr.custo, 0) as custo_un, coalesce(gp.nome, 'Sem grupo') as grupo
    from produtos pr left join grupos_produto gp on gp.id = pr.grupo_id where pr.ativo
  ),
  -- curva ABC pelas vendas dos últimos 365 dias (A = 80% do faturamento, B = próximos 15%, C = resto vendido)
  vend as (
    select vi.produto_id, sum(vi.total) as total from venda_itens vi join vendas v on v.id = vi.venda_id
    where v.situacao = 'finalizada' and v.data > v_hoje - 365 and vi.produto_id is not null group by 1
  ),
  abc as (
    select produto_id, total, sum(total) over (order by total desc, produto_id) / nullif(sum(total) over (), 0) as acum from vend
  ),
  lista as (
    select p.id, p.nome, p.referencia, p.codigo_barras, p.unidade, p.grupo, p.estoque, p.estoque_minimo, p.custo_un,
           p.preco_venda, p.data_ultima_saida, p.data_ultima_entrada,
           case when a.acum is null then null when a.acum <= 0.80 then 'A' when a.acum <= 0.95 then 'B' else 'C' end as curva
    from p left join abc a on a.produto_id = p.id
  )
  select jsonb_build_object(
    'resumo', (select jsonb_build_object(
        'itens', count(*),
        'com_estoque', count(*) filter (where estoque > 0),
        'zerados', count(*) filter (where estoque = 0),
        'negativos', count(*) filter (where estoque < 0),
        'abaixo_minimo', count(*) filter (where estoque_minimo > 0 and estoque < estoque_minimo),
        'valor_custo', round(coalesce(sum(estoque * custo_un) filter (where estoque > 0), 0), 2),
        'valor_venda', round(coalesce(sum(estoque * preco_venda) filter (where estoque > 0), 0), 2),
        'sem_custo', count(*) filter (where estoque > 0 and custo_un = 0),
        'sem_giro', count(*) filter (where estoque > 0 and (data_ultima_saida is null or data_ultima_saida < v_hoje - v_dias)),
        'valor_sem_giro', round(coalesce(sum(estoque * custo_un) filter (where estoque > 0 and (data_ultima_saida is null or data_ultima_saida < v_hoje - v_dias)), 0), 2),
        'dias_sem_giro', v_dias) from lista),
    'curva', (select coalesce(jsonb_agg(jsonb_build_object('curva', c, 'itens', itens, 'valor_estoque', valor) order by c), '[]')
              from (select coalesce(curva, 'Sem venda') as c, count(*) as itens,
                           round(coalesce(sum(estoque * custo_un) filter (where estoque > 0), 0), 2) as valor
                    from lista group by 1) x),
    'por_grupo', (select coalesce(jsonb_agg(jsonb_build_object('grupo', grupo, 'itens', itens, 'qtd', qtd, 'valor_custo', vc, 'valor_venda', vv) order by vc desc), '[]')
                  from (select grupo, count(*) as itens, coalesce(sum(estoque) filter (where estoque > 0), 0) as qtd,
                               round(coalesce(sum(estoque * custo_un) filter (where estoque > 0), 0), 2) as vc,
                               round(coalesce(sum(estoque * preco_venda) filter (where estoque > 0), 0), 2) as vv
                        from lista group by 1) g),
    'abaixo_minimo', (select coalesce(jsonb_agg(to_jsonb(x) order by x.falta desc), '[]') from (
                        select id, nome, referencia, grupo, estoque, estoque_minimo, curva, data_ultima_saida,
                               estoque_minimo - estoque as falta from lista
                        where estoque_minimo > 0 and estoque < estoque_minimo order by curva nulls last, estoque_minimo - estoque desc limit 300) x),
    'negativos', (select coalesce(jsonb_agg(to_jsonb(x) order by x.estoque), '[]') from (
                    select id, nome, referencia, grupo, estoque, curva, data_ultima_saida from lista where estoque < 0 order by estoque limit 300) x),
    'sem_giro', (select coalesce(jsonb_agg(to_jsonb(x) order by x.valor desc), '[]') from (
                   select id, nome, referencia, grupo, estoque, round(estoque * custo_un, 2) as valor, data_ultima_saida, data_ultima_entrada from lista
                   where estoque > 0 and (data_ultima_saida is null or data_ultima_saida < v_hoje - v_dias)
                   order by estoque * custo_un desc limit 300) x)
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------- contas a receber
create or replace function rel_receber(p_ini date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_hoje date := hoje_loja(); v_mensal boolean := (p_fim - p_ini) > 62;
begin
  perform rel_exigir('fin');
  if p_ini is null or p_fim is null or p_fim < p_ini then raise exception 'Período inválido'; end if;
  with a as (select * from contas_receber where status = 'aberto' and saldo > 0),
  rec as (select * from recebimentos where data between p_ini and p_fim)
  select jsonb_build_object(
    'resumo', jsonb_build_object(
      'aberto', (select coalesce(sum(saldo), 0) from a),
      'vencido', (select coalesce(sum(saldo), 0) from a where vencimento < v_hoje),
      'a_vencer', (select coalesce(sum(saldo), 0) from a where vencimento >= v_hoje),
      'titulos', (select count(*) from a),
      'titulos_vencidos', (select count(*) from a where vencimento < v_hoje),
      'clientes', (select count(distinct cliente_id) from a),
      'clientes_atraso', (select count(distinct cliente_id) from a where vencimento < v_hoje),
      'recebido', (select coalesce(sum(valor), 0) from rec),
      'vencendo_periodo', (select coalesce(sum(saldo), 0) from a where vencimento between p_ini and p_fim)),
    'aging', (select coalesce(jsonb_agg(jsonb_build_object('faixa', faixa, 'ordem', ordem, 'titulos', n, 'saldo', s) order by ordem), '[]') from (
                select case when d > 180 then 'Vencido há mais de 180 dias' when d > 90 then 'Vencido 91–180 dias' when d > 60 then 'Vencido 61–90 dias'
                            when d > 30 then 'Vencido 31–60 dias' when d > 0 then 'Vencido 1–30 dias' when d > -31 then 'A vencer em até 30 dias'
                            when d > -61 then 'A vencer em 31–60 dias' else 'A vencer em mais de 60 dias' end as faixa,
                       case when d > 180 then 1 when d > 90 then 2 when d > 60 then 3 when d > 30 then 4 when d > 0 then 5
                            when d > -31 then 6 when d > -61 then 7 else 8 end as ordem,
                       count(*) as n, sum(saldo) as s
                from (select saldo, v_hoje - vencimento as d from a) x group by 1, 2) f),
    'vencimentos', (select coalesce(jsonb_agg(jsonb_build_object('mes', m, 'saldo', s) order by m), '[]') from (
                      select date_trunc('month', vencimento)::date as m, sum(saldo) as s from a
                      where vencimento >= date_trunc('month', v_hoje) and vencimento < date_trunc('month', v_hoje) + interval '12 months' group by 1) x),
    'recebido_serie', (select coalesce(jsonb_agg(jsonb_build_object('periodo', p, 'total', t) order by p), '[]') from (
                         select case when v_mensal then date_trunc('month', data)::date else data end as p, sum(valor) as t from rec group by 1) x),
    'recebido_forma', (select coalesce(jsonb_agg(jsonb_build_object('forma', f, 'total', t) order by t desc), '[]') from (
                         select case when forma_pagamento_id is not null then grupo_forma(forma_pagamento_id)
                                     when origem = 'asaas' then 'Asaas (boleto/PIX)' else coalesce(initcap(forma_descricao), 'Sem informação') end as f,
                                sum(valor) as t from rec group by 1) x),
    'devedores', (select coalesce(jsonb_agg(to_jsonb(x) order by x.vencido desc, x.saldo desc), '[]') from (
                    select a.cliente_id, coalesce(max(c.nome), 'Sem cliente') as nome, max(coalesce(c.celular_cobranca, c.celular)) as celular,
                           count(*) as titulos, sum(a.saldo) as saldo,
                           coalesce(sum(a.saldo) filter (where a.vencimento < v_hoje), 0) as vencido,
                           greatest(max(v_hoje - a.vencimento), 0) as dias_atraso
                    from a left join clientes c on c.id = a.cliente_id group by a.cliente_id
                    order by 6 desc, 5 desc limit 50) x)
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------- contas a pagar
create or replace function rel_pagar(p_ini date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_hoje date := hoje_loja();
begin
  perform rel_exigir('fin');
  if p_ini is null or p_fim is null or p_fim < p_ini then raise exception 'Período inválido'; end if;
  -- "conferir_baixa_legado" = vencidas no DirectControl, provavelmente pagas direto no banco: ficam à parte
  with a as (select * from contas_pagar where status = 'aberto' and saldo > 0 and not conferir_baixa_legado),
  pg as (select * from contas_pagar where data_pagamento between p_ini and p_fim and valor_pago > 0)
  select jsonb_build_object(
    'resumo', jsonb_build_object(
      'aberto', (select coalesce(sum(saldo), 0) from a),
      'vencido', (select coalesce(sum(saldo), 0) from a where vencimento < v_hoje),
      'proximos_7', (select coalesce(sum(saldo), 0) from a where vencimento between v_hoje and v_hoje + 7),
      'proximos_30', (select coalesce(sum(saldo), 0) from a where vencimento between v_hoje and v_hoje + 30),
      'titulos', (select count(*) from a),
      'pago_periodo', (select coalesce(sum(valor_pago), 0) from pg),
      'vencendo_periodo', (select coalesce(sum(saldo), 0) from a where vencimento between p_ini and p_fim),
      'a_conferir', (select count(*) from contas_pagar where status = 'aberto' and conferir_baixa_legado),
      'a_conferir_valor', (select coalesce(sum(saldo), 0) from contas_pagar where status = 'aberto' and conferir_baixa_legado)),
    'semanas', (select coalesce(jsonb_agg(jsonb_build_object('semana', s, 'saldo', t, 'titulos', n) order by s), '[]') from (
                  select date_trunc('week', vencimento)::date as s, sum(saldo) as t, count(*) as n from a
                  where vencimento >= v_hoje and vencimento < v_hoje + 56 group by 1) x),
    'vencimentos', (select coalesce(jsonb_agg(jsonb_build_object('mes', m, 'saldo', s) order by m), '[]') from (
                      select date_trunc('month', vencimento)::date as m, sum(saldo) as s from a
                      where vencimento >= date_trunc('month', v_hoje) and vencimento < date_trunc('month', v_hoje) + interval '12 months' group by 1) x),
    'por_fornecedor', (select coalesce(jsonb_agg(to_jsonb(x) order by x.saldo desc), '[]') from (
                         select a.fornecedor_id, coalesce(max(f.fantasia), max(f.nome), 'Sem fornecedor') as nome, count(*) as titulos, sum(a.saldo) as saldo,
                                coalesce(sum(a.saldo) filter (where a.vencimento < v_hoje), 0) as vencido, min(a.vencimento) as proximo
                         from a left join fornecedores f on f.id = a.fornecedor_id group by a.fornecedor_id order by 4 desc limit 50) x),
    'por_plano', (select coalesce(jsonb_agg(jsonb_build_object('plano', p, 'pago', t) order by t desc), '[]') from (
                    select coalesce(pc.nome, 'Sem plano de contas') as p, sum(pg.valor_pago) as t
                    from pg left join plano_contas pc on pc.id = pg.plano_conta_id group by 1) x),
    'vencidas', (select coalesce(jsonb_agg(to_jsonb(x) order by x.vencimento), '[]') from (
                   select a.id, a.vencimento, a.documento, a.historico, a.saldo, coalesce(f.fantasia, f.nome) as fornecedor
                   from a left join fornecedores f on f.id = a.fornecedor_id where a.vencimento < v_hoje order by a.vencimento limit 200) x)
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------- financeiro (caixa, resultado e projeção)
create or replace function rel_financeiro(p_ini date, p_fim date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; v_hoje date := hoje_loja(); v_mensal boolean := (p_fim - p_ini) > 62; v_vendas jsonb;
begin
  perform rel_exigir('fin');
  if p_ini is null or p_fim is null or p_fim < p_ini then raise exception 'Período inválido'; end if;
  v_vendas := rel_resumo_vendas(p_ini, p_fim);
  with cx as (select * from caixa_lancamentos where data between p_ini and p_fim),
  despesas as (select coalesce(sum(valor_pago), 0) as t from contas_pagar where data_pagamento between p_ini and p_fim and valor_pago > 0)
  select jsonb_build_object(
    'caixa', jsonb_build_object(
      'entradas', (select coalesce(sum(entrada), 0) from cx),
      'saidas', (select coalesce(sum(saida), 0) from cx)),
    'caixa_serie', (select coalesce(jsonb_agg(jsonb_build_object('periodo', p, 'entradas', e, 'saidas', s) order by p), '[]') from (
                      select case when v_mensal then date_trunc('month', data)::date else data end as p, sum(entrada) as e, sum(saida) as s
                      from cx group by 1) x),
    'caixa_forma', (select coalesce(jsonb_agg(jsonb_build_object('forma', f, 'entradas', e, 'saidas', s) order by e desc), '[]') from (
                      select grupo_forma(forma_pagamento_id) as f, sum(entrada) as e, sum(saida) as s from cx group by 1) x),
    'caixa_plano', (select coalesce(jsonb_agg(jsonb_build_object('plano', p, 'entradas', e, 'saidas', s) order by s desc, e desc), '[]') from (
                      select coalesce(pc.nome, 'Sem plano de contas') as p, sum(cx.entrada) as e, sum(cx.saida) as s
                      from cx left join plano_contas pc on pc.id = cx.plano_conta_id group by 1) x),
    'resultado', jsonb_build_object(
      'vendas', (v_vendas->>'total')::numeric - (v_vendas->>'frete')::numeric,
      'frete', (v_vendas->>'frete')::numeric,
      'custo_mercadoria', (v_vendas->>'custo')::numeric,
      'lucro_bruto', (v_vendas->>'lucro')::numeric,
      'cobertura_custo', (v_vendas->>'cobertura_custo')::numeric,
      'despesas_pagas', (select t from despesas),
      'resultado', (v_vendas->>'lucro')::numeric - (select t from despesas)),
    'projecao', (select coalesce(jsonb_agg(jsonb_build_object('faixa', faixa, 'ordem', ordem, 'receber', rcb, 'pagar', pgr) order by ordem), '[]') from (
                   select f.faixa, f.ordem,
                          (select coalesce(sum(saldo), 0) from contas_receber where status = 'aberto' and vencimento between f.ini and f.fim) as rcb,
                          (select coalesce(sum(saldo), 0) from contas_pagar where status = 'aberto' and not conferir_baixa_legado and vencimento between f.ini and f.fim) as pgr
                   from (values ('Vencidos', 1, date '1900-01-01', v_hoje - 1), ('Próximos 7 dias', 2, v_hoje, v_hoje + 6),
                                ('8 a 30 dias', 3, v_hoje + 7, v_hoje + 30), ('31 a 60 dias', 4, v_hoje + 31, v_hoje + 60),
                                ('61 a 90 dias', 5, v_hoje + 61, v_hoje + 90)) f(faixa, ordem, ini, fim)) x)
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------- contagem cíclica de estoque
-- Uma contagem é uma lista de produtos escolhidos por critério (grupo, curva ABC, há mais tempo sem contar). O estoque do
-- sistema é fotografado na criação; quem conta lança a quantidade (celular/leitor). Ao fechar, o ajuste aplica a DIFERENÇA
-- (contado - foto) sobre o estoque atual, então vendas feitas durante a contagem não são perdidas.
create table contagens (
  id              bigint primary key generated by default as identity,
  descricao       text not null,
  criterio        jsonb not null default '{}',
  status          text not null default 'aberta' check (status in ('aberta', 'finalizada', 'cancelada')),
  ajustada        boolean not null default false,
  criada_por      text,
  criada_em       timestamptz not null default now(),
  finalizada_por  text,
  finalizada_em   timestamptz
);

create table contagem_itens (
  contagem_id      bigint not null references contagens(id) on delete cascade,
  produto_id       bigint not null references produtos(id),
  estoque_sistema  numeric(14,3) not null,
  custo            numeric(14,4),
  quantidade       numeric(14,3),
  contado_por      text,
  contado_em       timestamptz,
  ajuste           numeric(14,3),
  primary key (contagem_id, produto_id)
);
create index contagem_itens_produto on contagem_itens (produto_id, contado_em);

create or replace function contagem_criar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  v_lim int := least(greatest(coalesce((p->>'quantidade')::int, 50), 1), 500);
  v_grupo int := nullif(p->>'grupo_id', '')::int;
  v_curva text := nullif(p->>'curva', '');
  v_dias int := coalesce(nullif(p->>'nao_contados_dias', '')::int, 0);
  v_so_estoque boolean := coalesce((p->>'apenas_com_estoque')::boolean, true);
  v_hoje date := hoje_loja();
  v_n int;
begin
  perform rel_exigir('fin');
  if v_curva is not null and v_curva not in ('A', 'B', 'C') then raise exception 'Curva inválida'; end if;
  insert into contagens (descricao, criterio, criada_por)
  values (coalesce(nullif(trim(p->>'descricao'), ''), 'Contagem ' || to_char(v_hoje, 'DD/MM/YYYY')), p - 'descricao', rel_usuario())
  returning id into v_id;

  with vend as (
    select vi.produto_id, sum(vi.total) as total from venda_itens vi join vendas v on v.id = vi.venda_id
    where v.situacao = 'finalizada' and v.data > v_hoje - 365 and vi.produto_id is not null group by 1
  ),
  abc as (
    select produto_id, total, sum(total) over (order by total desc, produto_id) / nullif(sum(total) over (), 0) as acum from vend
  ),
  ult as (select produto_id, max(contado_em) as em from contagem_itens where contado_em is not null group by 1),
  cand as (
    select pr.id, pr.estoque, coalesce(nullif(pr.custo_medio, 0), pr.custo) as custo, u.em as ultima, coalesce(a.total, 0) as vendido,
           case when a.acum is null then null when a.acum <= 0.80 then 'A' when a.acum <= 0.95 then 'B' else 'C' end as curva
    from produtos pr left join abc a on a.produto_id = pr.id left join ult u on u.produto_id = pr.id
    where pr.ativo and (v_grupo is null or pr.grupo_id = v_grupo) and (not v_so_estoque or pr.estoque <> 0)
  )
  insert into contagem_itens (contagem_id, produto_id, estoque_sistema, custo)
  select v_id, id, estoque, custo from cand
  where (v_curva is null or curva = v_curva) and (v_dias = 0 or ultima is null or ultima < now() - make_interval(days => v_dias))
  order by ultima nulls first, vendido desc, id
  limit v_lim;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Nenhum produto atende a esse critério'; end if;
  return v_id;
end $$;

create or replace function contagem_lancar(p_contagem bigint, p_produto bigint, p_quantidade numeric, p_somar boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_status text; r record;
begin
  perform rel_exigir('contar');
  select status into v_status from contagens where id = p_contagem;
  if v_status is null then raise exception 'Contagem não encontrada'; end if;
  if v_status <> 'aberta' then raise exception 'Esta contagem já foi fechada'; end if;
  if p_quantidade is null or p_quantidade < 0 then raise exception 'Quantidade inválida'; end if;
  update contagem_itens set
    quantidade = case when p_somar then coalesce(quantidade, 0) + p_quantidade else p_quantidade end,
    contado_por = rel_usuario(), contado_em = now()
  where contagem_id = p_contagem and produto_id = p_produto
  returning * into r;
  if not found then raise exception 'Produto % não está nesta contagem', p_produto; end if;
  return jsonb_build_object('produto_id', r.produto_id, 'quantidade', r.quantidade, 'estoque_sistema', r.estoque_sistema);
end $$;

create or replace function contagem_finalizar(p_contagem bigint, p_ajustar boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_status text; v_n int := 0; v_valor numeric := 0;
begin
  perform rel_exigir('fin');
  select status into v_status from contagens where id = p_contagem for update;
  if v_status is null then raise exception 'Contagem não encontrada'; end if;
  if v_status <> 'aberta' then raise exception 'Esta contagem já foi fechada'; end if;
  if p_ajustar then
    update contagem_itens set ajuste = quantidade - estoque_sistema
    where contagem_id = p_contagem and quantidade is not null;
    update produtos pr set estoque = pr.estoque + ci.ajuste
    from contagem_itens ci where ci.contagem_id = p_contagem and ci.produto_id = pr.id and ci.ajuste is not null and ci.ajuste <> 0;
    get diagnostics v_n = row_count;
    select coalesce(sum(ajuste * coalesce(custo, 0)), 0) into v_valor from contagem_itens where contagem_id = p_contagem and ajuste is not null;
  end if;
  update contagens set status = 'finalizada', ajustada = p_ajustar, finalizada_por = rel_usuario(), finalizada_em = now() where id = p_contagem;
  return jsonb_build_object('ajustados', v_n, 'valor_ajuste', round(v_valor, 2));
end $$;

create or replace function contagem_cancelar(p_contagem bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform rel_exigir('fin');
  update contagens set status = 'cancelada', finalizada_por = rel_usuario(), finalizada_em = now() where id = p_contagem and status = 'aberta';
  if not found then raise exception 'Só contagem aberta pode ser cancelada'; end if;
end $$;
