// Carga completa real: Firebird (backup restaurado) -> PGlite, conferência de totais e regras de re-sincronização.
// Só roda com FDB_TESTE apontando para um .fdb restaurado (gbak -c) num Firebird local:
//   FDB_TESTE="C:\...\pontocerto.fdb" npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conectarFirebird, opcoesFirebird } from '../../scripts/migracao/firebird.mjs';
import { executarMigracao, conferir } from '../../scripts/migracao/migrar.mjs';
import { bancoDeTeste } from '../pgteste.mjs';

const FDB = process.env.FDB_TESTE;

test('migração completa e re-sincronização', { skip: !FDB && 'defina FDB_TESTE', timeout: 600000 }, async () => {
  const fb = await conectarFirebird(opcoesFirebird({ fdb: FDB }));
  const db = await bancoDeTeste();
  const um = async (sql, p) => (await db.query(sql, p)).rows[0];
  try {
    await executarMigracao({ fb, db, log: () => {} });

    for (const c of await conferir(fb, db)) assert.ok(c.ok, `${c.item}: origem ${c.origem} x destino ${c.destino}`);

    // Acentos preservados e busca sem acento funcionando
    const oleo = await um(`select nome from produtos where busca like '%oleo multi uso%' limit 1`);
    assert.match(oleo.nome, /ÓLEO/);

    // Vendas absurdas estornadas não entram como finalizadas
    assert.equal((await um(`select situacao from vendas where id = 33997`)).situacao, 'estornada');

    // Painel calcula
    const painel = (await um(`select resumo_painel() as r`)).r;
    assert.ok(Number(painel.receber_aberto) > 0);

    // --- Regras da sincronização (Fase 1) ---
    const titulo = await um(`select id, cliente_id, saldo from contas_receber where status = 'aberto' and baixa_origem is null order by id limit 1`);

    // 1) Cobrança Asaas paga -> título baixado no ERP, pendente de réplica no DirectControl
    await db.query(`insert into cobrancas (cliente_id, asaas_payment_id, titulos, valor, vencimento) values ($1, 'pay_teste', array[$2::bigint], $3, current_date)`,
      [titulo.cliente_id, titulo.id, titulo.saldo]);
    await db.query(`select confirmar_cobranca_paga('pay_teste', current_date, $1, $1, 'PIX')`, [titulo.saldo]);
    await db.query(`select confirmar_cobranca_paga('pay_teste', current_date, $1, $1, 'PIX')`, [titulo.saldo]); // idempotente
    let t = await um(`select status, saldo, baixa_origem, baixa_replicada_legado from contas_receber where id = $1`, [titulo.id]);
    assert.deepEqual([t.status, Number(t.saldo), t.baixa_origem, t.baixa_replicada_legado], ['pago', 0, 'asaas', false]);
    assert.equal(Number((await um(`select count(*) as n from recebimentos where conta_receber_id = $1 and origem = 'asaas'`, [titulo.id])).n), 1);

    // 2) Re-sincronizar com o legado ainda mostrando o título aberto NÃO desfaz a baixa do Asaas
    await executarMigracao({ fb, db, somente: ['contas_receber'], log: () => {} });
    t = await um(`select status, baixa_origem from contas_receber where id = $1`, [titulo.id]);
    assert.deepEqual([t.status, t.baixa_origem], ['pago', 'asaas']);

    // 3) Contas a pagar herdadas sem baixa ficam para conferência e saem do "atrasado"
    const conferir1 = Number((await um(`select count(*) as n from contas_pagar where conferir_baixa_legado`)).n);
    assert.ok(conferir1 > 2000);
    const n = (await um(`select baixar_pagar_legado_em_lote(current_date - 30) as n`)).n;
    assert.ok(n > 0);
    await executarMigracao({ fb, db, somente: ['contas_pagar'], log: () => {} });
    const depois = Number((await um(`select count(*) as n from contas_pagar where status = 'pago' and baixa_origem = 'erp'`)).n);
    assert.equal(depois, n, 'baixa em lote sobrevive à re-sincronização');

    // 4) Baixa manual parcial e validação de saldo
    const outro = await um(`select id, saldo from contas_receber where status = 'aberto' and saldo > 2 order by id limit 1`);
    await db.query(`select baixar_conta_receber($1, 1, current_date, 2, 'teste')`, [outro.id]);
    t = await um(`select status, saldo from contas_receber where id = $1`, [outro.id]);
    assert.equal(Number(t.saldo), Math.round((Number(outro.saldo) - 1) * 100) / 100);
    await assert.rejects(db.query(`select baixar_conta_receber($1, 999999, current_date, 2)`, [outro.id]), /maior que o saldo/);
  } finally {
    await fb.fechar();
    await db.close();
  }
});
