import { test } from 'node:test';
import assert from 'node:assert/strict';
import { txt, dig, bool, dinheiro, data, hora, fk, tipoPessoa, situacaoVenda, statusReceber, somarDias } from '../../scripts/migracao/transformar.mjs';

test('txt tira o preenchimento de CHAR(n) e vazio vira null', () => {
  assert.equal(txt('95096730                        '), '95096730');
  assert.equal(txt('   '), null);
  assert.equal(txt(null), null);
  assert.equal(txt(' SERRA P/ ARCO'), 'SERRA P/ ARCO');
});

test('dig mantém só dígitos', () => {
  assert.equal(dig('041.908.546-00'), '04190854600');
  assert.equal(dig('54991929947                                 '), '54991929947');
  assert.equal(dig('  '), null);
});

test('bool entende T/F com espaços', () => {
  assert.equal(bool('T   '), true);
  assert.equal(bool('F   '), false);
  assert.equal(bool(null, true), true);
});

test('dinheiro arredonda em 2 casas e null vira 0', () => {
  assert.equal(dinheiro(1.005 + 0.0001), 1.01);
  assert.equal(dinheiro(null), 0);
});

test('data e hora vêm como texto do CAST do Firebird', () => {
  assert.equal(data('2026-11-06'), '2026-11-06');
  assert.equal(data('0201-01-01'), null);
  assert.equal(hora('08:01:19.0000'), '08:01:19');
});

test('fk só mantém id que existe no destino', () => {
  const ids = new Set([1, 2]);
  assert.equal(fk(2, ids), 2);
  assert.equal(fk(3, ids), null);
  assert.equal(fk(null, ids), null);
});

test('tipoPessoa deduz pelo documento quando falta', () => {
  assert.equal(tipoPessoa(null, '11877694000166'), 'J');
  assert.equal(tipoPessoa('', '04440424074'), 'F');
  assert.equal(tipoPessoa('J   ', '04440424074'), 'J');
});

test('situacaoVenda: só T é venda válida; A com estorno é estornada', () => {
  assert.equal(situacaoVenda('T   ', null), 'finalizada');
  assert.equal(situacaoVenda('A   ', '2026-05-08'), 'estornada');
  assert.equal(situacaoVenda('A   ', null), 'aberta');
  assert.equal(situacaoVenda('C   ', '2026-05-08'), 'cancelada');
});

test('statusReceber: N com saldo zerado conta como quitada', () => {
  assert.equal(statusReceber('N   ', 156.2), 'aberto');
  assert.equal(statusReceber('N   ', 0), 'pago');
  assert.equal(statusReceber('P   ', 10), 'pago');
});

test('somarDias atravessa meses', () => {
  assert.equal(somarDias('2026-11-06', -15), '2026-10-22');
  assert.equal(somarDias('2026-12-31', 1), '2027-01-01');
});
