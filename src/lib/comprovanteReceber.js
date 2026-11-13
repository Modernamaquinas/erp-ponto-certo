// Comprovantes do crediário (acerto no balcão e detalhe do título em Contas a Receber):
//  - quitação: o que foi pago, formas, e a declaração de quitação (dos títulos pagos e, se não sobrou nada, de todo o crediário)
//  - contas pagas (detalhado): cada título com a compra de origem (data, número, itens com quantidade e valores), vencimento,
//    recebimentos (data, forma, valor) e situação.
// Impressos por imprimirHtml (térmica 80 mm configurada ou folha A4).
import { supabase, ou } from './supabase.js';
import { moeda, data, numero, documento } from './formato.js';
import { imprimirHtml } from './impressao.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ehHoje = () => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date());

/** Busca títulos, recebimentos, compras de origem com itens e o saldo em aberto do cliente. */
export async function dadosComprovante(ids) {
  const { data: titulos } = ou(await supabase.from('contas_receber')
    .select('id, cliente_id, venda_id, documento, historico, parcela, total_parcelas, emissao, vencimento, valor, valor_pago, saldo, status, data_pagamento, clientes(id, nome, cpf_cnpj)')
    .in('id', ids).order('vencimento').order('id'));
  if (!titulos.length) throw new Error('Títulos não encontrados');
  const vendasIds = [...new Set(titulos.map((t) => t.venda_id).filter(Boolean))];
  const cliente = titulos[0].clientes;
  const [rec, vendas, itens, aberto] = await Promise.all([
    supabase.from('recebimentos').select('conta_receber_id, data, forma_descricao, valor').in('conta_receber_id', ids).order('data').order('id').then(ou),
    vendasIds.length ? supabase.from('vendas').select('id, data, total, numero_nfce').in('id', vendasIds).then(ou) : { data: [] },
    vendasIds.length ? supabase.from('venda_itens').select('venda_id, item, descricao, quantidade, preco_unitario, desconto, total, produtos(nome)')
      .in('venda_id', vendasIds).order('venda_id').order('item').limit(2000).then(ou) : { data: [] },
    supabase.from('contas_receber').select('saldo:saldo.sum()').eq('cliente_id', titulos[0].cliente_id).eq('status', 'aberto').then(ou),
  ]);
  return {
    cliente, titulos,
    recebimentos: rec.data,
    vendas: Object.fromEntries(vendas.data.map((v) => [v.id, { ...v, itens: itens.data.filter((i) => i.venda_id === v.id) }])),
    saldoAberto: Number(aberto.data?.[0]?.saldo || 0),
  };
}

const cabecalho = (titulo, cli) => `<h1>PONTO CERTO FERRAGENS</h1><div class="c">CNPJ 11.877.694/0001-66 · Caxias do Sul/RS</div>
  <div class="c"><b>${esc(titulo)}</b></div><div class="c">Emitido em ${esc(ehHoje())}</div><hr>
  <div>Cliente: ${esc(cli?.id)} - ${esc(cli?.nome)}</div>${cli?.cpf_cnpj ? `<div>CPF/CNPJ: ${esc(documento(cli.cpf_cnpj))}</div>` : ''}<hr>`;
const nomeTitulo = (t) => `${esc(t.historico || t.documento || `Título ${t.id}`)}${t.parcela ? ` (${t.parcela}/${t.total_parcelas || '?'})` : ''}`;

/** Comprovante de quitação. `acerto` (opcional) = retorno de receber_acerto: mostra o pago agora, formas e troco. */
export function imprimirQuitacao(d, { acerto, largura } = {}) {
  const pagoAgora = acerto ? Object.fromEntries(acerto.titulos.map((t) => [t.id, Number(t.pago)])) : null;
  const linhas = d.titulos.map((t) => `<tr><td>Venc. ${esc(data(t.vencimento))} · ${nomeTitulo(t)}</td></tr>
    <tr><td><table><tr><td>Valor ${esc(moeda(t.valor))}</td><td class="d">${pagoAgora ? `pago agora ${esc(moeda(pagoAgora[t.id] || 0))}` : `pago ${esc(moeda(t.valor_pago))}`}</td></tr>
    <tr><td>${t.status === 'pago' ? `QUITADO em ${esc(data(t.data_pagamento))}` : 'EM ABERTO'}</td><td class="d">${Number(t.saldo) > 0 ? `resta ${esc(moeda(t.saldo))}` : ''}</td></tr></table></td></tr>`).join('');
  const quitados = d.titulos.filter((t) => t.status === 'pago');
  const formas = acerto ? acerto.pagamentos.map((p) => `<tr><td>${esc({ dinheiro: 'Dinheiro', pix: 'PIX', debito: 'Cartão de débito', credito: 'Cartão de crédito', cheque: 'Cheque' }[p.forma] || p.forma)}</td><td class="d">${esc(moeda(p.valor))}</td></tr>`).join('') : '';
  const totalPago = acerto ? Number(acerto.total) : d.titulos.reduce((s, t) => s + Number(t.valor_pago), 0);
  const declaracao = quitados.length
    ? `<p>Declaramos para os devidos fins que ${quitados.length === 1 ? 'o título acima marcado como QUITADO foi pago' : `os ${quitados.length} títulos acima marcados como QUITADO foram pagos`} integralmente, nada mais havendo a cobrar sobre ${quitados.length === 1 ? 'ele' : 'eles'}.</p>`
    : '';
  const geral = d.saldoAberto <= 0
    ? '<p class="c"><b>O CLIENTE NÃO POSSUI DÉBITOS EM ABERTO NO CREDIÁRIO DA LOJA NESTA DATA.</b></p>'
    : `<p>Saldo ainda em aberto no crediário: <b>${esc(moeda(d.saldoAberto))}</b></p>`;
  return imprimirHtml(`${cabecalho('COMPROVANTE DE PAGAMENTO E QUITAÇÃO', d.cliente)}
    <table>${linhas}</table><hr>
    <table><tr><td class="g">TOTAL PAGO</td><td class="d g">${esc(moeda(totalPago))}</td></tr>${formas}
    ${acerto && Number(acerto.troco) > 0 ? `<tr><td>Troco</td><td class="d">${esc(moeda(acerto.troco))}</td></tr>` : ''}</table><hr>
    ${declaracao}${geral}
    ${acerto?.usuario ? `<div class="c">Recebido por ${esc(acerto.usuario)}</div>` : ''}
    <br><br><div class="c">_______________________________</div><div class="c">Ponto Certo Ferragens</div>`,
  { titulo: 'Comprovante de quitação', largura });
}

/** Contas pagas, detalhado: compra de origem com os itens, datas e valores de cada título e de cada recebimento. */
export function imprimirContasPagas(d, { largura } = {}) {
  const porVenda = new Map();
  for (const t of d.titulos) {
    const k = t.venda_id || `t${t.id}`;
    if (!porVenda.has(k)) porVenda.set(k, []);
    porVenda.get(k).push(t);
  }
  const blocos = [...porVenda.entries()].map(([k, tits]) => {
    const v = typeof k === 'number' || /^\d+$/.test(k) ? d.vendas[k] : null;
    const itens = v?.itens?.length ? `<table>${v.itens.map((i) => `<tr><td colspan="2">${esc(i.produtos?.nome || i.descricao || 'Item')}</td></tr>
        <tr><td>&nbsp;&nbsp;${esc(numero(Number(i.quantidade)))} x ${esc(moeda(i.preco_unitario))}${Number(i.desconto) > 0 ? ` (desc. ${esc(moeda(i.desconto))})` : ''}</td><td class="d">${esc(moeda(i.total))}</td></tr>`).join('')}
        <tr><td><b>Total da compra</b></td><td class="d"><b>${esc(moeda(v.total))}</b></td></tr></table>` : '<div>(itens da compra não disponíveis)</div>';
    const parcelas = tits.map((t) => {
      const recs = d.recebimentos.filter((r) => r.conta_receber_id === t.id)
        .map((r) => `<tr><td>&nbsp;&nbsp;pago ${esc(data(r.data))} ${esc(r.forma_descricao || '')}</td><td class="d">${esc(moeda(r.valor))}</td></tr>`).join('');
      return `<tr><td colspan="2"><b>${t.parcela ? `Parcela ${t.parcela}/${t.total_parcelas || '?'}` : nomeTitulo(t)}</b> · venc. ${esc(data(t.vencimento))}</td></tr>
        <tr><td>&nbsp;&nbsp;valor</td><td class="d">${esc(moeda(t.valor))}</td></tr>${recs}
        <tr><td>&nbsp;&nbsp;${t.status === 'pago' ? `<b>QUITADA</b> em ${esc(data(t.data_pagamento))}` : '<b>EM ABERTO</b>'}</td><td class="d">${Number(t.saldo) > 0 ? `resta ${esc(moeda(t.saldo))}` : ''}</td></tr>`;
    }).join('');
    return `<div><b>${v ? `COMPRA Nº ${esc(v.id)} de ${esc(data(v.data))}` : esc(tits[0].historico || tits[0].documento || 'Título')}</b>${v?.numero_nfce ? ` · NFC-e ${esc(v.numero_nfce)}` : ''}</div>
      ${itens}<table>${parcelas}</table><hr>`;
  }).join('');
  const pago = d.titulos.reduce((s, t) => s + Number(t.valor_pago), 0);
  return imprimirHtml(`${cabecalho('CONTAS PAGAS - DETALHADO', d.cliente)}${blocos}
    <table><tr><td class="g">TOTAL PAGO NESSES TÍTULOS</td><td class="d g">${esc(moeda(pago))}</td></tr>
    <tr><td>Saldo em aberto no crediário</td><td class="d">${esc(moeda(d.saldoAberto))}</td></tr></table>`,
  { titulo: 'Contas pagas', largura });
}
