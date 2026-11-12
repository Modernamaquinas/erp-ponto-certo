import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gerarPPLA, montarFileiras, textosDaColuna, valoresProduto, medidasModelo } from '../src/lib/etiquetas.js';

// Modelo 2 do DirectControl ("3,3 CM X 2,2 CM (3 COL.) C/ DESCRIÇÃO"), campos como estão em ETIQUETAS_CAMPOS.
const modelo = { id: 2, descricao: '3,3 CM X 2,2 CM (3 COL.) C/ DESCRIÇÃO', temperatura: 10, pixel: 'D11', avanco: 320 };
let id = 0;
const campo = (coluna, fonte, mh, mv, sub, linha, esquerda, texto, max) =>
  ({ id: ++id, coluna, orientacao: '1', fonte, mult_h: mh, mult_v: mv, subtipo: sub, linha, esquerda, texto, max_caracteres: max });
const campos = [
  campo(1, '1', '1', '1', '000', 80, 12, '[NOME_PROD]', 26), campo(1, '1', '1', '1', '000', 74, 12, '[NOME_PROD]', 26),
  campo(1, '2', '1', '1', '000', 50, 54, '[PRECO]', 29), campo(1, 'E', '8', '2', '025', 16, 7, '[CCOD_BARRAS]', 14),
  campo(2, '1', '1', '1', '000', 80, 146, '[NOME_PROD]', 26), campo(2, '1', '1', '1', '000', 74, 146, '[NOME_PROD]', 26),
  campo(2, '2', '1', '1', '000', 50, 189, '[PRECO]', 25), campo(2, 'E', '8', '2', '025', 16, 145, '[CCOD_BARRAS]', 14),
  campo(3, '1', '1', '1', '000', 80, 287, '[NOME_PROD]', 26), campo(3, '1', '1', '1', '000', 74, 287, '[NOME_PROD]', 26),
  campo(3, '2', '1', '1', '000', 50, 327, '[PRECO]', 25), campo(3, 'E', '8', '2', '025', 16, 283, '[CCOD_BARRAS]', 14),
];
const p1 = { id: 1, nome: 'PARAF. CHIPBOARD PHILIPS FLANGEADO 3,5X35MM', codigo_barras: '7890203135943', preco_venda: 0.25 };
const p2 = { id: 2, nome: 'PARAF. CHIPBOARD PHILIPS FLANGEADO 3,5X40MM', codigo_barras: '7892261369278', preco_venda: 0.25 };
const p3 = { id: 3, nome: 'PARAF. ROSCA INT SEXTAVADO 1/4X3', codigo_barras: '7890203145706', preco_venda: 1 };

// C:\EASYCONTROL\Etiqueta.txt gravado pelo DirectControl (abr/2025) — a ordem das linhas de campo não importa na PPLA.
const REAL = ['\x02c0000', '\x02e', '\x02f320', '\x02L', 'H10', 'PC', 'A2', 'D11',
  '1E8202500160007C7890203135943', '111100000800012PARAF. CHIPBOARD PHILIPS F', '111100000740012LANGEADO 3,5X35MM', '121100000500054R$ 0,25',
  '1E8202500160145C7892261369278', '121100000500189R$ 0,25', '111100000800146PARAF. CHIPBOARD PHILIPS F', '111100000740146LANGEADO 3,5X40MM',
  '1E8202500160283C7890203145706', '121100000500327R$ 1,00', '111100000800287PARAF. ROSCA INT SEXTAVADO', '111100000740287 1/4X3',
  ':0016', 'E'];

test('gera o mesmo arquivo que o DirectControl mandou para a L42', () => {
  const saida = gerarPPLA(modelo, campos, [{ produto: p1, quantidade: 16 }, { produto: p2, quantidade: 16 }, { produto: p3, quantidade: 16 }]);
  assert.ok(saida.endsWith('\r\nE\r\n'));
  const linhas = saida.trimEnd().split('\r\n');
  assert.deepEqual(linhas.slice(0, 8), REAL.slice(0, 8));
  assert.deepEqual(linhas.slice(-2), REAL.slice(-2));
  assert.deepEqual([...linhas].sort(), [...REAL].sort());
});

test('um produto ocupa as 3 colunas e o resto sai numa fileira parcial', () => {
  const f = montarFileiras([{ produto: p1, quantidade: 7 }], 3);
  assert.deepEqual(f.map((x) => [x.produtos.map((p) => p?.id ?? null), x.copias]), [[[1, 1, 1], 2], [[1, null, null], 1]]);
  const saida = gerarPPLA(modelo, campos, [{ produto: p1, quantidade: 7 }]);
  assert.equal(saida.split('\x02L').length - 1, 2);
  assert.ok(saida.includes(':0002') && saida.includes(':0001'));
  // fileira parcial: só os campos da coluna 1
  const ultima = saida.split('\x02L').at(-1);
  assert.ok(ultima.includes('0012PARAF') && !ultima.includes('0146PARAF'));
});

test('quantidades diferentes: cada etiqueta sai exatamente o número de vezes pedido', () => {
  const itens = [{ produto: p1, quantidade: 5 }, { produto: p2, quantidade: 2 }, { produto: p3, quantidade: 4 }, { produto: { ...p1, id: 9 }, quantidade: 1 }];
  const conta = new Map();
  for (const f of montarFileiras(itens, 3)) for (const p of f.produtos) if (p) conta.set(p.id, (conta.get(p.id) || 0) + f.copias);
  assert.deepEqual(Object.fromEntries(conta), { 1: 5, 2: 2, 3: 4, 9: 1 });
});

test('variáveis: parcelas, desconto, acentos e produto sem código de barras', () => {
  const v = valoresProduto({ id: 6284, nome: 'ABRAÇADEIRA', preco_venda: 1234.5 }, { loja: 'PONTO CERTO', parcelas: 3, desconto: 5 });
  assert.equal(v.COD_BARRAS, '6284');
  assert.equal(v.PRECO, 'R$ 1.234,50');
  assert.equal(v.VALOR_PARC, 'R$ 411,50');
  const [t] = textosDaColuna([{ id: 1, texto: 'A PRAZO: [PARCELAS] X [VALOR_PARC]', linha: 10, max_caracteres: 40 }], v);
  assert.equal(t.texto, 'A PRAZO: 3 X R$ 411,50');
  const [n] = textosDaColuna([{ id: 1, texto: '[NOME_PROD]', linha: 10, max_caracteres: 30 }], v);
  assert.equal(n.texto, 'ABRACADEIRA');
});

test('medidas da prévia do modelo de 3 colunas', () => {
  const m = medidasModelo(modelo, campos);
  assert.equal(m.ncol, 3);
  assert.equal(m.passo, 138);
  assert.ok(m.altura >= 86 && m.altura < 100, String(m.altura));
});
