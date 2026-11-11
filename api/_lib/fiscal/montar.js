// Monta o corpo de emissão (layout NF-e 4.00 em JSON, formato da Nuvem Fiscal) para NFC-e (65) e NF-e (55).
// Funções puras, testadas em tests/fiscal.test.mjs. Regras da Ponto Certo: Simples Nacional (CRT 1),
// CSOSN 102 (CFOP 5102) ou 500 (CFOP 5405, ST já retida), PIS/COFINS CST 99 sem valor — igual ao DirectControl.

export const EMITENTE = {
  cnpj: '11877694000166', uf: 'RS', cUF: 43, cMun: '4305108', crt: 1,
};
const HOMOLOGACAO_TEXTO = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

// tPag da SEFAZ
export const FORMAS_PAGAMENTO = {
  dinheiro: '01', cheque: '02', credito: '03', debito: '04', crediario: '05', vale_alimentacao: '10',
  boleto: '15', deposito: '16', pix: '17', transferencia: '18', sem_pagamento: '90', outros: '99',
};
const ELETRONICOS = new Set(['03', '04', '17']);
// tBand (bandeira do cartão)
const BANDEIRAS = { VISA: '01', ELECTRON: '01', MASTERCARD: '02', 'MASTERCARD DEB': '02', MAESTRO: '02', AMEX: '03',
  SOROCRED: '04', DINERS: '05', ELO: '06', 'ELO CREDITO': '06', 'ELO DEBITO': '06', HIPERCARD: '07', AURA: '08', CABAL: '09',
  BANRICOMPRAS: '27', VERDECARD: '22' };

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const so = (v) => String(v ?? '').replace(/\D/g, '');

export class ErroNota extends Error {}

/** GTIN válido (8/12/13/14 dígitos com dígito verificador) ou 'SEM GTIN'. */
export function gtin(v) {
  const d = so(v);
  if (![8, 12, 13, 14].includes(d.length) || /^0+$/.test(d)) return 'SEM GTIN';
  const corpo = d.slice(0, -1).split('').reverse().map(Number);
  const soma = corpo.reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (soma % 10)) % 10 === Number(d.at(-1)) ? d : 'SEM GTIN';
}

/** Data/hora com fuso de Brasília (AAAA-MM-DDThh:mm:ss-03:00). */
export function dataHoraSP(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}-03:00`;
}

function icms(csosn, origem) {
  const orig = Number(origem) || 0;
  const c = String(csosn || '').trim();
  if (['102', '103', '300', '400'].includes(c)) return { ICMSSN102: { orig, CSOSN: c } };
  if (c === '500') return { ICMSSN500: { orig, CSOSN: '500' } };
  if (c === '900') return { ICMSSN900: { orig, CSOSN: '900' } };
  throw new ErroNota(`CSOSN ${c || '(vazio)'} não suportado na emissão automática`);
}

/** CFOP de saída conforme o destino: 5xxx dentro do RS, 6xxx para fora. */
export function cfopDestino(cfop, interestadual) {
  const c = String(cfop || '').trim();
  if (!/^[56]\d{3}$/.test(c)) throw new ErroNota(`CFOP inválido: ${c || '(vazio)'}`);
  return (interestadual ? '6' : '5') + c.slice(1);
}

/**
 * @param {object} p
 * @param {55|65} p.modelo
 * @param {'homologacao'|'producao'} p.ambiente
 * @param {number} p.serie @param {number} p.numero
 * @param {Array} p.itens  [{ codigo, descricao, ncm, cest, cfop, csosn, origem, unidade, ean, quantidade, valor_unitario, desconto, ibpt:{federal,estadual,municipal} }]
 * @param {Array} p.pagamentos [{ forma: 'dinheiro'|'credito'|..., valor, cartao?: { cnpj, bandeira, autorizacao, integrado } }]
 * @param {object} [p.destinatario] { nome, cpf_cnpj, ie, email, endereco: { logradouro, numero, complemento, bairro, cMun, municipio, uf, cep, fone } }
 */
export function montarNota({ modelo, ambiente, serie, numero, itens, pagamentos, destinatario, natOp = 'VENDA DE MERCADORIA',
  infCpl, referencia, dhEmi = dataHoraSP(), emitente = EMITENTE }) {
  if (![55, 65].includes(modelo)) throw new ErroNota('Modelo deve ser 55 (NF-e) ou 65 (NFC-e)');
  if (!itens?.length) throw new ErroNota('A nota precisa de pelo menos um item');
  if (itens.length > 990) throw new ErroNota('Máximo de 990 itens por nota');
  const homolog = ambiente === 'homologacao';
  const nfce = modelo === 65;

  // destinatário
  let dest;
  const doc = so(destinatario?.cpf_cnpj);
  if (!nfce && !destinatario) throw new ErroNota('NF-e exige destinatário');
  if (doc && ![11, 14].includes(doc.length)) throw new ErroNota('CPF/CNPJ do destinatário inválido');
  const ufDest = destinatario?.endereco?.uf?.toUpperCase();
  const interestadual = !nfce && ufDest && ufDest !== emitente.uf;
  const ieDest = so(destinatario?.ie);
  const contribuinte = !nfce && doc.length === 14 && ieDest.length > 0;
  if (destinatario && (doc || !nfce)) {
    if (!nfce && !doc) throw new ErroNota('NF-e exige CPF ou CNPJ do destinatário');
    dest = { [doc.length === 14 ? 'CNPJ' : 'CPF']: doc, indIEDest: contribuinte ? 1 : 9 };
    const nome = homolog && !nfce ? HOMOLOGACAO_TEXTO : destinatario.nome;
    if (nome) dest.xNome = String(nome).slice(0, 60);
    if (contribuinte) dest.IE = ieDest;
    if (destinatario.email) dest.email = String(destinatario.email).slice(0, 60);
    const e = destinatario.endereco;
    if (!nfce) {
      if (!e?.logradouro || !e?.cMun || !e?.uf || !e?.municipio) throw new ErroNota('NF-e exige o endereço completo do destinatário (com cidade)');
      dest.enderDest = { xLgr: e.logradouro, nro: e.numero || 'S/N', xBairro: e.bairro || 'CENTRO', cMun: String(e.cMun),
        xMun: e.municipio, UF: e.uf.toUpperCase(), cPais: '1058', xPais: 'BRASIL' };
      if (e.complemento) dest.enderDest.xCpl = e.complemento;
      if (so(e.cep).length === 8) dest.enderDest.CEP = so(e.cep);
      if (so(e.fone).length >= 6) dest.enderDest.fone = so(e.fone);
    }
  }

  // itens
  let vProd = 0; let vDesc = 0; let vTotTrib = 0; const trib = { federal: 0, estadual: 0, municipal: 0 };
  const det = itens.map((it, i) => {
    const q = Number(it.quantidade);
    const vUn = Number(it.valor_unitario);
    if (!(q > 0)) throw new ErroNota(`Item ${i + 1}: quantidade inválida`);
    if (!(vUn > 0)) throw new ErroNota(`Item ${i + 1}: valor inválido`);
    const ncm = so(it.ncm);
    if (ncm.length !== 8) throw new ErroNota(`Item ${i + 1} (${it.descricao}): produto sem NCM válido`);
    const bruto = r2(q * vUn);
    const desc = r2(it.desconto || 0);
    if (desc < 0 || desc >= bruto) throw new ErroNota(`Item ${i + 1}: desconto inválido`);
    const liquido = r2(bruto - desc);
    vProd = r2(vProd + bruto); vDesc = r2(vDesc + desc);
    const tb = it.ibpt || {};
    const t = { federal: r2(liquido * (Number(tb.federal) || 0) / 100), estadual: r2(liquido * (Number(tb.estadual) || 0) / 100),
      municipal: r2(liquido * (Number(tb.municipal) || 0) / 100) };
    const tItem = r2(t.federal + t.estadual + t.municipal);
    trib.federal = r2(trib.federal + t.federal); trib.estadual = r2(trib.estadual + t.estadual); trib.municipal = r2(trib.municipal + t.municipal);
    vTotTrib = r2(vTotTrib + tItem);
    const ean = gtin(it.ean);
    const un = String(it.unidade || 'UN').trim().toUpperCase().slice(0, 6) || 'UN';
    const prod = {
      cProd: String(it.codigo), cEAN: ean,
      xProd: (homolog && nfce && i === 0 ? HOMOLOGACAO_TEXTO : String(it.descricao || '').trim()).slice(0, 120),
      NCM: ncm, CFOP: cfopDestino(it.cfop || '5102', interestadual), uCom: un, qCom: q, vUnCom: vUn, vProd: bruto,
      cEANTrib: ean, uTrib: un, qTrib: q, vUnTrib: vUn, indTot: 1,
    };
    if (!prod.xProd) throw new ErroNota(`Item ${i + 1}: sem descrição`);
    const cest = so(it.cest);
    if (cest.length === 7) prod.CEST = cest;
    if (desc > 0) prod.vDesc = desc;
    return {
      nItem: i + 1, prod,
      imposto: {
        ...(tItem > 0 ? { vTotTrib: tItem } : {}),
        ICMS: icms(it.csosn, it.origem),
        PIS: { PISOutr: { CST: '99', vBC: 0, pPIS: 0, vPIS: 0 } },
        COFINS: { COFINSOutr: { CST: '99', vBC: 0, pCOFINS: 0, vCOFINS: 0 } },
      },
    };
  });
  const vNF = r2(vProd - vDesc);

  // pagamentos
  if (!pagamentos?.length) throw new ErroNota('Informe a forma de pagamento');
  let pago = 0;
  const detPag = pagamentos.map((pg) => {
    const tPag = FORMAS_PAGAMENTO[pg.forma] || pg.forma;
    if (!Object.values(FORMAS_PAGAMENTO).includes(tPag)) throw new ErroNota(`Forma de pagamento inválida: ${pg.forma}`);
    const vPag = r2(pg.valor);
    if (tPag !== '90' && !(vPag > 0)) throw new ErroNota('Valor de pagamento inválido');
    pago = r2(pago + vPag);
    const d = { indPag: tPag === '05' ? 1 : 0, tPag, vPag: tPag === '90' ? 0 : vPag };
    if (tPag === '99') d.xPag = String(pg.descricao || 'OUTROS').slice(0, 60);
    if (ELETRONICOS.has(tPag)) {
      const c = pg.cartao || {};
      d.card = { tpIntegra: c.integrado ? 1 : 2 };
      if (c.integrado) {
        if (so(c.cnpj).length === 14) d.card.CNPJ = so(c.cnpj);
        const band = BANDEIRAS[String(c.bandeira || '').toUpperCase()];
        if (band && tPag !== '17') d.card.tBand = band;
        if (c.autorizacao) d.card.cAut = String(c.autorizacao).slice(0, 128);
      }
    }
    return d;
  });
  const semPagamento = detPag.every((d) => d.tPag === '90');
  if (!semPagamento && pago < vNF) throw new ErroNota(`Pagamentos (${pago.toFixed(2)}) menores que o total da nota (${vNF.toFixed(2)})`);
  const troco = semPagamento ? 0 : r2(pago - vNF);
  if (troco > 0 && !pagamentos.some((pg) => (FORMAS_PAGAMENTO[pg.forma] || pg.forma) === '01')) {
    throw new ErroNota('Troco só é permitido com pagamento em dinheiro');
  }

  const textoTrib = vTotTrib > 0
    ? `Trib aprox R$ ${trib.federal.toFixed(2)} Federal, ${trib.estadual.toFixed(2)} Estadual e ${trib.municipal.toFixed(2)} Municipal. Fonte: IBPT.`
    : null;
  const cpl = [infCpl, textoTrib].filter(Boolean).join(' ').slice(0, 5000);

  const infNFe = {
    versao: '4.00',
    ide: {
      cUF: emitente.cUF, natOp: String(natOp).slice(0, 60), mod: modelo, serie, nNF: numero, dhEmi,
      ...(nfce ? {} : { dhSaiEnt: dhEmi }),
      tpNF: 1, idDest: interestadual ? 2 : 1, cMunFG: emitente.cMun, tpImp: nfce ? 4 : 1, tpEmis: 1,
      tpAmb: homolog ? 2 : 1, finNFe: 1, indFinal: nfce || !contribuinte ? 1 : 0, indPres: 1,
      procEmi: 0, verProc: 'ERP Ponto Certo 1.0',
    },
    emit: { CNPJ: emitente.cnpj, CRT: emitente.crt },
    ...(dest ? { dest } : {}),
    det,
    total: { ICMSTot: { vBC: 0, vICMS: 0, vICMSDeson: 0, vFCP: 0, vBCST: 0, vST: 0, vFCPST: 0, vFCPSTRet: 0, vProd, vFrete: 0,
      vSeg: 0, vDesc, vII: 0, vIPI: 0, vIPIDevol: 0, vPIS: 0, vCOFINS: 0, vOutro: 0, vNF, ...(vTotTrib > 0 ? { vTotTrib } : {}) } },
    transp: { modFrete: 9 },
    pag: { detPag, ...(troco > 0 ? { vTroco: troco } : {}) },
    ...(cpl ? { infAdic: { infCpl: cpl } } : {}),
  };
  return { ambiente, referencia, infNFe };
}

/** Status da Nuvem Fiscal -> status de notas_fiscais. */
export function statusNota(s) {
  return { autorizado: 'autorizada', rejeitado: 'rejeitada', denegado: 'denegada', cancelado: 'cancelada', erro: 'erro',
    pendente: 'processando', encerrado: 'autorizada' }[s] || 'processando';
}
