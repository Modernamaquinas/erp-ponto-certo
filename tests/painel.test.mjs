// Envio das vendas ao painel de fechamento de caixa (024_painel_caixa.sql).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoDeTeste } from './pgteste.mjs';

test('painel_caixa_mes: dias encerrados por forma, troco fora, a prazo em outros, ML e estornadas fora', async () => {
  const db = await bancoDeTeste();
  await db.exec(`
    insert into formas_pagamento (id, descricao) values (2, 'DINHEIRO'), (13, 'PIX'), (16, 'CARTAO CREDITO'), (8, 'CARTAO DEBITO'),
      (14, 'CREDIARIO'), (40, 'MERCADO LIVRE');
    insert into vendas (id, data, total, situacao, origem) values
      (1, hoje_loja() - 1, 100, 'finalizada', 'erp'),   -- 120 em dinheiro => 20 de troco
      (2, hoje_loja() - 1, 60, 'finalizada', 'erp'),    -- pix 30 + crédito 20 + débito 10
      (3, hoje_loja() - 1, 9999, 'estornada', 'erp'),
      (4, hoje_loja() - 1, 80, 'finalizada', 'erp'),    -- crediário
      (5, hoje_loja() - 1, 45, 'finalizada', 'marketplace'),
      (6, hoje_loja() - 1, 15, 'finalizada', 'erp'),    -- sem pagamento registrado
      (7, hoje_loja(), 500, 'finalizada', 'erp');       -- hoje: ainda não vai
    insert into venda_pagamentos (venda_id, item, forma_pagamento_id, valor) values
      (1, 1, 2, 120), (2, 1, 13, 30), (2, 2, 16, 20), (2, 3, 8, 10), (3, 1, 2, 9999), (4, 1, 14, 80), (5, 1, 40, 45), (7, 1, 2, 500);
  `);
  const ontem = (await db.query(`select to_char(hoje_loja() - 1, 'YYYY-MM') m, extract(day from hoje_loja() - 1)::int d`)).rows[0];
  const r = (await db.query(`select painel_caixa_mes($1) r`, [ontem.m])).rows[0].r;
  assert.equal(r.dias.length, ontem.d, 'um registro por dia até ontem');
  const d = r.dias.find((x) => x.dia === ontem.d);
  assert.deepEqual({ dinheiro: Number(d.dinheiro), cartoes: Number(d.cartoes), pix: Number(d.pix) }, { dinheiro: 100, cartoes: 30, pix: 30 });
  assert.equal(Number(r.outros), 95, 'crediário 80 + venda sem pagamento 15');
  assert.ok(r.dias.filter((x) => x.dia !== ontem.d).every((x) => Number(x.dinheiro) + Number(x.cartoes) + Number(x.pix) === 0));

  await assert.rejects(db.query(`select painel_caixa_mes('2026-13x')`), /Mês inválido/);
  const futuro = (await db.query(`select painel_caixa_mes(to_char(hoje_loja() + 62, 'YYYY-MM')) r`)).rows[0].r;
  assert.deepEqual(futuro.dias, []);
});
