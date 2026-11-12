// HTML do comprovante de venda e do orçamento, impressos pelo navegador (impressao.js).
import { moeda, numero, data } from './formato.js';

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CABECALHO = `<div class="c"><img src="${location.origin}/logo.png" alt=""/><br/><b>PONTO CERTO COMERCIO DE FERRAGENS LTDA</b><br/>
  CNPJ 11.877.694/0001-66 - IE 0290521327<br/>R. Thereza Dalcanali Zugno, 280 - Planalto Rio Branco<br/>Caxias do Sul/RS</div><hr/>`;
const FORMAS = { dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Cartão débito', credito: 'Cartão crédito', crediario: 'Crediário', boleto: 'Boleto', cheque: 'Cheque' };

function linhasItens(itens) {
  return itens.map((i, k) => {
    const q = Number(i.quantidade); const pu = Number(i.preco_unitario); const d = Number(i.desconto || 0);
    return `<tr><td colspan="3">${k + 1} ${esc(i.produto_id)} ${esc(i.descricao || i.nome)}</td></tr>
      <tr><td>${numero(q)} x ${moeda(pu)}</td><td class="d">${d ? `-${moeda(d)}` : ''}</td><td class="d">${moeda(q * pu - d)}</td></tr>`;
  }).join('');
}

/** Comprovante de venda (não substitui o DANFCE; traz o número da NFC-e quando houver). */
export function htmlComprovante({ venda_id, itens, pagamentos, desconto_geral = 0, frete = 0, endereco, total, troco = 0, operador, cliente, nota }) {
  const bruto = itens.reduce((s, i) => s + Number(i.quantidade) * Number(i.preco_unitario), 0);
  const desc = itens.reduce((s, i) => s + Number(i.desconto || 0), 0) + Number(desconto_geral || 0);
  return `${CABECALHO}<h1>COMPROVANTE DE VENDA</h1>
    <div>Venda nº ${esc(venda_id)} - ${new Date().toLocaleString('pt-BR')}</div>
    <div>Operador: ${esc(operador)}</div>${cliente ? `<div>Cliente: ${esc(cliente)}</div>` : ''}<hr/>
    <table>${linhasItens(itens)}</table><hr/>
    <table><tr><td>Subtotal</td><td class="d">${moeda(bruto)}</td></tr>
    ${desc ? `<tr><td>Descontos</td><td class="d">-${moeda(desc)}</td></tr>` : ''}
    ${Number(frete) ? `<tr><td>Frete</td><td class="d">${moeda(frete)}</td></tr>` : ''}
    <tr class="g"><td>TOTAL</td><td class="d">${moeda(total)}</td></tr>
    ${pagamentos.map((p) => `<tr><td>${esc(FORMAS[p.forma] || p.forma)}${p.parcelas > 1 ? ` ${p.parcelas}x` : ''}</td><td class="d">${moeda(p.valor)}</td></tr>`).join('')}
    ${troco > 0 ? `<tr><td>Troco</td><td class="d">${moeda(troco)}</td></tr>` : ''}</table><hr/>
    ${endereco ? `<div>Entrega: ${esc(endereco)}</div><hr/>` : ''}
    <div class="c">${nota?.status === 'autorizada' ? `${nota.modelo === 55 ? 'NF-e' : 'NFC-e'} nº ${esc(nota.numero)} série ${esc(nota.serie)}<br/>Chave: ${esc(nota.chave)}` : 'Nota fiscal pendente de emissão'}</div>
    <div class="c">Obrigado pela preferência!</div>`;
}

/** Orçamento para o cliente. */
export function htmlOrcamento(o, itens) {
  return `${CABECALHO}<h1>ORÇAMENTO Nº ${esc(o.id)}</h1>
    <div>Data: ${data(o.data)}${o.validade ? ` - Válido até ${data(o.validade)}` : ''}</div>
    ${o.cliente_nome ? `<div>Cliente: ${esc(o.cliente_nome)}</div>` : ''}<hr/>
    <table>${linhasItens(itens)}</table><hr/>
    <table><tr><td>Produtos</td><td class="d">${moeda(o.total_produtos)}</td></tr>
    ${Number(o.desconto) ? `<tr><td>Descontos</td><td class="d">-${moeda(o.desconto)}</td></tr>` : ''}
    <tr class="g"><td>TOTAL</td><td class="d">${moeda(o.total)}</td></tr></table>
    ${o.observacao ? `<hr/><div>${esc(o.observacao)}</div>` : ''}<hr/>
    <div class="c">Orçamento sujeito a disponibilidade de estoque.<br/>Documento sem valor fiscal.</div>`;
}
