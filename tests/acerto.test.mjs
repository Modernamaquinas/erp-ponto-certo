// Acerto do crediário no balcão (026_acerto_receber.sql).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoDeTeste } from './pgteste.mjs';

async function preparar() {
  const db = await bancoDeTeste();
  await db.exec(`
    insert into formas_pagamento (id, descricao) values (2, 'DINHEIRO'), (13, 'PIX'), (7, 'CARTAO CREDITO'), (8, 'CARTAO DEBITO'), (5, 'CHEQUE');
    insert into clientes (id, nome) values (10, 'JOAO'), (11, 'MARIA');
    insert into contas_receber (id, cliente_id, vencimento, valor, saldo, status, historico) values
      (100, 10, hoje_loja() - 40, 100, 100, 'aberto', 'VENDA 1 1/3'),
      (101, 10, hoje_loja() - 10, 100, 100, 'aberto', 'VENDA 1 2/3'),
      (102, 10, hoje_loja() + 20, 100, 100, 'aberto', 'VENDA 1 3/3'),
      (103, 11, hoje_loja() - 5, 50, 50, 'aberto', 'MARIA'),
      (104, 10, hoje_loja() - 60, 30, 0, 'pago', 'JA PAGO');
  `);
  return db;
}
const acerto = async (db, p) => (await db.query('select receber_acerto($1) r', [JSON.stringify(p)])).rows[0].r;
const conta = async (db, id) => (await db.query('select saldo::float s, status from contas_receber where id = $1', [id])).rows[0];

test('acerto: escolhe títulos, divide em formas, troco no dinheiro, baixa do mais antigo e lança no caixa', async () => {
  const db = await preparar();
  // paga o 100 inteiro e 60 do 101; pix 50 + dinheiro 120 (recebido) => 170 para 160 = 10 de troco
  const r = await acerto(db, { titulos: [{ id: 101, valor: 60 }, { id: 100 }], pagamentos: [{ forma: 'pix', valor: 50 }, { forma: 'dinheiro', valor: 120 }], usuario: 'CAIXA' });
  assert.equal(Number(r.total), 160);
  assert.equal(Number(r.troco), 10);
  assert.deepEqual(r.titulos.map((t) => t.id), [100, 101], 'do vencimento mais antigo para o mais novo');
  assert.deepEqual(await conta(db, 100), { s: 0, status: 'pago' });
  assert.deepEqual(await conta(db, 101), { s: 40, status: 'aberto' });
  assert.deepEqual(await conta(db, 102), { s: 100, status: 'aberto' }, 'não escolhido não muda');
  const rec = (await db.query('select conta_receber_id id, forma_pagamento_id f, valor::float v from recebimentos order by id')).rows;
  assert.deepEqual(rec, [{ id: 100, f: 13, v: 50 }, { id: 100, f: 2, v: 50 }, { id: 101, f: 2, v: 60 }]);
  const cx = (await db.query('select forma_pagamento_id f, entrada::float e, saida::float s from caixa_lancamentos order by id')).rows;
  assert.deepEqual(cx, [{ f: 13, e: 50, s: 0 }, { f: 2, e: 120, s: 0 }, { f: 2, e: 0, s: 10 }]);
});

test('acerto: recusa o que não pode', async () => {
  const db = await preparar();
  const erro = (p, re) => assert.rejects(acerto(db, p), re);
  await erro({ titulos: [], pagamentos: [{ forma: 'pix', valor: 1 }] }, /Selecione/);
  await erro({ titulos: [{ id: 100 }, { id: 103 }], pagamentos: [{ forma: 'pix', valor: 150 }] }, /mesmo cliente/);
  await erro({ titulos: [{ id: 104 }], pagamentos: [{ forma: 'pix', valor: 30 }] }, /não está em aberto/);
  await erro({ titulos: [{ id: 100, valor: 150 }], pagamentos: [{ forma: 'pix', valor: 150 }] }, /maior que o saldo/);
  await erro({ titulos: [{ id: 100 }], pagamentos: [{ forma: 'pix', valor: 90 }] }, /menor que o total/);
  await erro({ titulos: [{ id: 100 }], pagamentos: [{ forma: 'pix', valor: 110 }] }, /troco do dinheiro/);
  await erro({ titulos: [{ id: 100 }], pagamentos: [{ forma: 'crediario', valor: 100 }] }, /Forma de pagamento inválida/);
  await erro({ titulos: [{ id: 100 }, { id: 100 }], pagamentos: [{ forma: 'pix', valor: 200 }] }, /repetido/);
  await db.exec(`insert into cobrancas (id, cliente_id, titulos, valor, vencimento) values (1, 10, '{102}', 100, hoje_loja());
                 update contas_receber set cobranca_id = 1 where id = 102;`);
  await erro({ titulos: [{ id: 102 }], pagamentos: [{ forma: 'pix', valor: 100 }] }, /cobrança Asaas/);
  assert.deepEqual(await conta(db, 100), { s: 100, status: 'aberto' }, 'nada foi baixado nas tentativas recusadas');
  assert.equal((await db.query('select count(*)::int n from caixa_lancamentos')).rows[0].n, 0);
});
