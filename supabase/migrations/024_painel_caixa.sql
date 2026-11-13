-- 024 — Painel de fechamento de caixa da Ponto Certo (ponto-certo-ferragens-dashboard.vercel.app, tabela pontocerto_caixa_meses no
-- Supabase do painel). A partir de dez/2026 o ERP preenche os lançamentos diários (dinheiro, cartões, PIX) com as vendas finalizadas,
-- e o restante a prazo (crediário, boleto, cheque, outras) vai num item extra de receita do mês. Vendas do Mercado Livre/Shopee ficam de
-- fora: o painel já soma o ML pelo fechamento dele. Só dias encerrados (até ontem), para o painel mudar no máximo uma vez por dia.
create or replace function painel_caixa_mes(p_mes text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_ini date; v_fim date; r jsonb;
begin
  if p_mes !~ '^\d{4}-\d{2}$' then raise exception 'Mês inválido'; end if;
  v_ini := (p_mes || '-01')::date;
  v_fim := least((v_ini + interval '1 month')::date - 1, hoje_loja() - 1);
  with v as (
    select id, data, total from vendas
    where situacao = 'finalizada' and data between v_ini and v_fim and coalesce(origem, '') <> 'marketplace'),
  pf as (
    select vp.venda_id, grupo_forma(vp.forma_pagamento_id) as g, sum(vp.valor) as valor
    from venda_pagamentos vp join v on v.id = vp.venda_id group by 1, 2),
  -- pago a mais = troco, sai do dinheiro (mesma regra de rel_vendas)
  ex as (select pf.venda_id, greatest(sum(pf.valor) - max(v.total), 0) as troco from pf join v on v.id = pf.venda_id group by 1),
  lin as (
    select v.data,
           case when pf.g = 'Dinheiro' then 'dinheiro' when pf.g = 'PIX' then 'pix'
                when pf.g like 'Cartão%' then 'cartoes' when pf.g in ('Mercado Livre', 'Shopee') then null else 'outros' end as col,
           greatest(pf.valor - case when pf.g = 'Dinheiro' then coalesce(ex.troco, 0) else 0 end, 0) as valor
    from pf join v on v.id = pf.venda_id left join ex on ex.venda_id = pf.venda_id
    union all
    select v.data, 'outros', v.total from v where not exists (select 1 from pf where pf.venda_id = v.id)),
  dia as (
    select extract(day from data)::int as dia,
           round(coalesce(sum(valor) filter (where col = 'dinheiro'), 0), 2) as dinheiro,
           round(coalesce(sum(valor) filter (where col = 'cartoes'), 0), 2) as cartoes,
           round(coalesce(sum(valor) filter (where col = 'pix'), 0), 2) as pix
    from lin group by 1)
  select jsonb_build_object(
    'mes', p_mes,
    'ate', v_fim,
    'dias', (select coalesce(jsonb_agg(jsonb_build_object('dia', d, 'dinheiro', coalesce(dia.dinheiro, 0), 'cartoes', coalesce(dia.cartoes, 0),
                                                          'pix', coalesce(dia.pix, 0)) order by d), '[]')
             from generate_series(1, greatest(extract(day from v_fim)::int, 0)) d left join dia on dia.dia = d
             where v_fim >= v_ini),
    'outros', (select round(coalesce(sum(valor), 0), 2) from lin where col = 'outros')
  ) into r;
  return r;
end $$;
