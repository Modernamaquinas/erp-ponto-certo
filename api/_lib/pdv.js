// Regras do PDV fora do banco: rateio do desconto geral nos itens (para a NFC-e) e montagem da emissão.
import { emitirNota } from './fiscal/emitir.js';
import { documentoValido } from './fiscal/montar.js';

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const ou = (r) => { if (r.error) throw Object.assign(new Error(r.error.message), { status: 400 }); return r; };

/**
 * Distribui o desconto geral da venda entre os itens, proporcional ao valor líquido de cada um
 * (a NFC-e só tem desconto por item). O último item absorve a diferença de centavos.
 * itens: [{ quantidade, preco_unitario, desconto }]  ->  mesmos itens com `desconto` final
 */
export function ratearDesconto(itens, descontoGeral) {
  const dg = r2(descontoGeral || 0);
  const liquidos = itens.map((i) => r2(r2(Number(i.quantidade) * Number(i.preco_unitario)) - r2(i.desconto || 0)));
  const base = liquidos.reduce((s, v) => s + v, 0);
  if (dg <= 0 || base <= 0) return itens.map((i) => ({ ...i, desconto: r2(i.desconto || 0) }));
  let resto = dg;
  const saida = itens.map((i, k) => {
    const parte = k === itens.length - 1 ? resto : Math.min(r2(dg * liquidos[k] / base), resto);
    resto = r2(resto - parte);
    return { ...i, desconto: r2((i.desconto || 0) + parte) };
  });
  // se o último item não comporta o resto (desconto >= valor), redistribui o excedente nos anteriores
  for (let k = saida.length - 1; k >= 0; k--) {
    const bruto = r2(Number(saida[k].quantidade) * Number(saida[k].preco_unitario));
    const exc = r2(saida[k].desconto - (bruto - 0.01));
    if (exc > 0) {
      saida[k].desconto = r2(bruto - 0.01);
      if (k > 0) saida[k - 1].desconto = r2(saida[k - 1].desconto + exc);
    }
  }
  return saida;
}

/**
 * Emite a nota de uma venda do ERP já gravada (também serve para tentar de novo depois): NFC-e (cupom) ou, quando o
 * caixa escolheu, NF-e (DANFE A4, exige cliente com CPF/CNPJ e endereço). Frete e endereço de entrega vão na nota.
 */
export async function emitirNotaDaVenda(sb, usuario, vendaId, { cpf, cartoes = [], modelo } = {}) {
  const v = ou(await sb.from('vendas').select('id, cliente_id, cpf_nota, desconto, total, origem, numero_nfce, numero_nfe, valor_frete, endereco_entrega, documento_fiscal, entrega, entrega_data, entrega_horario')
    .eq('id', vendaId).single()).data;
  const mod = Number(modelo) || (v.documento_fiscal === 'nfe' ? 55 : 65);
  const frete = Number(v.valor_frete) || 0;
  // NF-e, e NFC-e com frete (entrega a domicílio), vão para o cliente do cadastro, com o endereço dele
  const comCliente = mod === 55 || frete > 0;
  const nome = mod === 55 ? 'NF-e' : 'NFC-e';
  if (v.origem !== 'erp') throw Object.assign(new Error(`Só vendas feitas no ERP emitem ${nome} por aqui`), { status: 400 });
  if (v.numero_nfce || v.numero_nfe) throw Object.assign(new Error(`A venda já tem a ${v.numero_nfe ? `NF-e ${v.numero_nfe}` : `NFC-e ${v.numero_nfce}`}`), { status: 400 });
  if (comCliente && (!v.cliente_id || v.cliente_id === 1)) {
    throw Object.assign(new Error(`${mod === 55 ? 'NF-e' : 'NFC-e com frete'} exige cliente cadastrado (com CPF/CNPJ e endereço)`), { status: 400 });
  }
  const itens = ou(await sb.from('venda_itens').select('item, produto_id, quantidade, preco_unitario, desconto').eq('venda_id', vendaId).order('item')).data;
  const pags = ou(await sb.from('venda_pagamentos').select('forma_pagamento_id, valor').eq('venda_id', vendaId).order('item')).data;
  const descItens = itens.reduce((s, i) => s + Number(i.desconto), 0);
  const rateados = ratearDesconto(itens, r2(Number(v.desconto) - descItens));
  // NFC-e: CPF/CNPJ digitado no caixa, senão o do cliente da venda (se for válido). NF-e: sempre o cliente.
  let docNota = null; let nomeNota = null;
  if (!comCliente) {
    docNota = cpf || v.cpf_nota || null;
    if (!docNota && v.cliente_id && v.cliente_id !== 1) {
      const cli = (await sb.from('clientes').select('nome, cpf_cnpj').eq('id', v.cliente_id).maybeSingle()).data;
      if (cli && documentoValido(cli.cpf_cnpj)) { docNota = cli.cpf_cnpj; nomeNota = cli.nome; }
    }
    if (docNota && !documentoValido(docNota)) throw Object.assign(new Error('CPF/CNPJ na nota inválido'), { status: 400 });
  }
  const FORMA = { 2: 'dinheiro', 5: 'cheque', 7: 'credito', 8: 'debito', 13: 'pix', 14: 'crediario', 18: 'boleto', 12: 'sem_pagamento' };
  const pagamentos = pags.map((p, k) => ({ forma: FORMA[p.forma_pagamento_id] || 'outros', valor: Number(p.valor), cartao: cartoes[k] }));
  const nota = await emitirNota(sb, usuario, {
    modelo: mod, venda_id: v.id, ...(comCliente ? { cliente_id: v.cliente_id } : { cpf: docNota, nome_consumidor: nomeNota }),
    itens: rateados.map((i) => ({ produto_id: i.produto_id, quantidade: Number(i.quantidade), valor_unitario: Number(i.preco_unitario), desconto: i.desconto })),
    pagamentos, frete,
    inf_complementar: textoEntrega(v),
  });
  if (nota.status === 'autorizada') await sb.from('vendas').update(mod === 55 ? { numero_nfe: nota.numero } : { numero_nfce: nota.numero }).eq('id', v.id);
  return nota;
}

/** Compatibilidade: NFC-e da venda. */
export const emitirNfceDaVenda = (sb, usuario, vendaId, opcoes = {}) => emitirNotaDaVenda(sb, usuario, vendaId, { ...opcoes, modelo: 65 });

/** Observação da nota com o endereço (e data/horário) da entrega. */
export function textoEntrega(v) {
  if (!v.endereco_entrega) return undefined;
  const quando = v.entrega && v.entrega_data ? ` EM ${v.entrega_data.split('-').reverse().join('/')}${v.entrega_horario ? ` ${v.entrega_horario}` : ''}` : '';
  return `ENTREGA${quando}: ${String(v.endereco_entrega).replace(/\s+/g, ' ').trim()}`.slice(0, 400);
}
