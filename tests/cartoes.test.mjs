// Cartões/TEF: previsão de recebimento por parcela e registro de transações do PDV (003_cartoes.sql).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bancoDeTeste } from './pgteste.mjs';

test('recebíveis: parcelado pela loja cai mês a mês, com taxa da faixa certa', async () => {
  const db = await bancoDeTeste();
  try {
    await db.exec(`
      insert into cartao_taxas (rede, modalidade, parcelas_ate, taxa_percentual, dias_recebimento) values
        ('CIELO', 'credito_parcelado_loja', 6, 3.5, 30), ('CIELO', 'credito_parcelado_loja', 12, 4.2, 30),
        ('CIELO', 'debito', 1, 1.1, 1);
      insert into tef_transacoes (id, situacao, rede, modalidade, parcelas, valor, data_hora) values
        (1, 'aprovada', 'CIELO', 'credito_parcelado_loja', 3, 100, '2026-11-06 10:00'),
        (2, 'aprovada', 'CIELO', 'debito', 1, 50, '2026-11-06 11:00'),
        (3, 'nao_concluida', 'CIELO', 'debito', 1, 70, '2026-11-06 11:05'),
        (4, 'aprovada', 'STONE', 'credito', 1, 20, '2026-11-07 09:00');
    `);
    const r = (await db.query(`select transacao_id, parcela, valor_bruto::text as b, taxa_percentual::text as t,
      valor_liquido::text as l, previsao::text as p from v_cartoes_recebiveis order by transacao_id, parcela`)).rows;
    assert.deepEqual(r.map((x) => [Number(x.transacao_id), x.parcela, x.b, x.t, x.l, x.p]), [
      [1, 1, '33.34', '3.500', '32.17', '2026-12-06'],
      [1, 2, '33.33', '3.500', '32.16', '2027-01-05'],
      [1, 3, '33.33', '3.500', '32.16', '2027-02-04'],
      [2, 1, '50.00', '1.100', '49.45', '2026-11-07'],
      [4, 1, '20.00', null, null, '2026-12-07'], // sem taxa cadastrada: prazo padrão, líquido em aberto
    ]);
  } finally {
    await db.close();
  }
});

test('PDV registra transação e o cancelamento aprovado marca a original', async () => {
  const db = await bancoDeTeste();
  try {
    const venda = { situacao: 'aprovada', rede: 'cielo', modalidade: 'credito', bandeira: 'visa', valor: 89.9, nsu: '001725', autorizacao: '902727' };
    const id = Number((await db.query('select registrar_transacao_tef($1) as id', [JSON.stringify(venda)])).rows[0].id);
    assert.ok(id >= 1000000);
    const t = (await db.query('select rede, bandeira, origem from tef_transacoes where id = $1', [id])).rows[0];
    assert.deepEqual(t, { rede: 'CIELO', bandeira: 'VISA', origem: 'erp' });

    const cancela = { operacao: 'cancelamento', situacao: 'aprovada', transacao_original_id: id, valor: 89.9 };
    await db.query('select registrar_transacao_tef($1)', [JSON.stringify(cancela)]);
    assert.equal((await db.query('select situacao from tef_transacoes where id = $1', [id])).rows[0].situacao, 'cancelada');
    assert.equal((await db.query('select count(*)::int as n from v_cartoes_recebiveis')).rows[0].n, 0);
    await assert.rejects(db.query('select registrar_transacao_tef($1)', [JSON.stringify(cancela)]), /já cancelada/);
    await assert.rejects(db.query(`select registrar_transacao_tef('{"situacao":"cancelada"}')`), /Situação inválida/);
  } finally {
    await db.close();
  }
});
