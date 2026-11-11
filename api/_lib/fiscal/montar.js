// Monta o corpo de emissão da Focus NFe (API v2, campos "planos") para NFC-e (65) e NF-e (55).
// Funções puras, testadas em tests/fiscal.test.mjs. Regras da Ponto Certo: Simples Nacional (CRT 1),
// CSOSN 102 (CFOP 5102) ou 500 (CFOP 5405, ST já retida), PIS/COFINS CST 99 sem valor — igual ao DirectControl.

export const EMITENTE = { cnpj: '11877694000166', uf: 'RS', cMun: '4305108', crt: 1 };
const HOMOLOGACAO_TEXTO = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL';

// forma_pagamento (tPag da SEFAZ)
export const FORMAS_PAGAMENTO = {
  dinheiro: '01', cheque: '02', credito: '03', debito: '04', crediario: '05', vale_alimentacao: '10',
  boleto: '15', deposito: '16', pix: '17', transferencia: '18', sem_pagamento: '90', outros: '99',
};
const ELETRONICOS = new Set(['03', '04', '17']);
// bandeira_operadora (tBand)
const BANDEIRAS = { VISA: '01', ELECTRON: '01', MASTERCARD: '02', 'MASTERCARD DEB': '02', MAESTRO: '02', AMEX: '03',
  SOROCRED: '04', DINERS: '05', ELO: '06', 'ELO CREDITO': '06', 'ELO DEBITO': '06', HIPERCARD: '07', AURA: '08', CABAL: '09',
  VERDECARD: '22', BANRICOMPRAS: '27' };
const CSOSN_ACEITOS = new Set(['102', '103', '300', '400', '500', '900']);

const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const so = (v) => String(v ?? '').replace(/\D/g, '');

export class ErroNota extends Error {}

/** Confere os dígitos verificadores de CPF (11) ou CNPJ (14). */
export function documentoValido(v) {
  const d = so(v);
  if (/^(\d)\1+$/.test(d)) return false;
  const dv = (base, pesos) => { const r = base.split('').reduce((s, n, i) => s + Number(n) * pesos[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  if (d.length === 11) {
    const p = (n) => Array.from({ length: n }, (_, i) => n + 1 - i);
    return dv(d.slice(0, 9), p(9)) === Number(d[9]) && dv(d.slice(0, 10), p(10)) === Number(d[10]);
  }
  if (d.length === 14) {
    const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    return dv(d.slice(0, 12), p1) === Number(d[12]) && dv(d.slice(0, 13), [6, ...p1]) === Number(d[13]);
  }
  return false;
}

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
  infCpl, dhEmi = dataHoraSP(), emitente = EMITENTE }) {
  if (![55, 65].includes(modelo)) throw new ErroNota('Modelo deve ser 55 (NF-e) ou 65 (NFC-e)');
  if (!itens?.length) throw new ErroNota('A nota precisa de pelo menos um item');
  if (itens.length > 990) throw new ErroNota('Máximo de 990 itens por nota');
  const homolog = ambiente === 'homologacao';
  const nfce = modelo === 65;

  const nota = {
    cnpj_emitente: emitente.cnpj, natureza_operacao: String(natOp).slice(0, 60), data_emissao: dhEmi,
    numero: String(numero), serie: String(serie), modalidade_frete: 9, presenca_comprador: 1,
  };

  // destinatário
  const doc = so(destinatario?.cpf_cnpj);
  if (!nfce && !destinatario) throw new ErroNota('NF-e exige destinatário');
  if (doc && !documentoValido(doc)) throw new ErroNota(`${doc.length === 14 ? 'CNPJ' : 'CPF'} do destinatário inválido (confira o cadastro)`);
  const ufDest = destinatario?.endereco?.uf?.toUpperCase();
  const interestadual = !nfce && Boolean(ufDest) && ufDest !== emitente.uf;
  const ieDest = so(destinatario?.ie);
  const contribuinte = !nfce && doc.length === 14 && ieDest.length > 0;
  if (!nfce && !doc) throw new ErroNota('NF-e exige CPF ou CNPJ do destinatário');
  if (doc) {
    nota[doc.length === 14 ? 'cnpj_destinatario' : 'cpf_destinatario'] = doc;
    const nome = homolog && !nfce ? HOMOLOGACAO_TEXTO : destinatario.nome;
    if (nome) nota.nome_destinatario = String(nome).slice(0, 60);
    if (destinatario.email) nota.email_destinatario = String(destinatario.email).slice(0, 60);
  }
  nota.local_destino = interestadual ? 2 : 1;
  if (!nfce) {
    const e = destinatario.endereco;
    if (!e?.logradouro || !e?.cMun || !e?.uf || !e?.municipio) throw new ErroNota('NF-e exige o endereço completo do destinatário (com cidade)');
    // a SEFAZ recusa logradouro/bairro com menos de 2 letras (cadastros antigos têm "C", ".")
    if (String(e.logradouro).trim().length < 2) throw new ErroNota('Endereço do cliente incompleto (logradouro). Corrija o cadastro.');
    if (e.bairro && String(e.bairro).trim().length < 2) throw new ErroNota('Bairro do cliente incompleto. Corrija o cadastro.');
    Object.assign(nota, {
      tipo_documento: 1, finalidade_emissao: 1, consumidor_final: contribuinte ? 0 : 1, data_entrada_saida: dhEmi,
      indicador_inscricao_estadual_destinatario: contribuinte ? 1 : 9,
      logradouro_destinatario: e.logradouro, numero_destinatario: e.numero || 'S/N', bairro_destinatario: e.bairro || 'CENTRO',
      municipio_destinatario: e.municipio, codigo_municipio_destinatario: String(e.cMun), uf_destinatario: e.uf.toUpperCase(),
      pais_destinatario: 'Brasil',
    });
    if (contribuinte) nota.inscricao_estadual_destinatario = ieDest;
    if (e.complemento) nota.complemento_destinatario = e.complemento;
    if (so(e.cep).length === 8) nota.cep_destinatario = so(e.cep);
    if (so(e.fone).length >= 6) nota.telefone_destinatario = so(e.fone);
  } else if (doc) {
    nota.indicador_inscricao_estadual_destinatario = 9;
  }

  // itens
  let vProd = 0; let vDesc = 0; let vTotTrib = 0; const trib = { federal: 0, estadual: 0, municipal: 0 };
  nota.items = itens.map((it, i) => {
    const q = Number(it.quantidade);
    const vUn = Number(it.valor_unitario);
    if (!(q > 0)) throw new ErroNota(`Item ${i + 1}: quantidade inválida`);
    if (!(vUn > 0)) throw new ErroNota(`Item ${i + 1}: valor inválido`);
    const ncm = so(it.ncm);
    if (ncm.length !== 8) throw new ErroNota(`Item ${i + 1} (${it.descricao}): produto sem NCM válido`);
    const csosn = String(it.csosn || '').trim();
    if (!CSOSN_ACEITOS.has(csosn)) throw new ErroNota(`Item ${i + 1}: CSOSN ${csosn || '(vazio)'} não suportado na emissão automática`);
    const bruto = r2(q * vUn);
    const desc = r2(it.desconto || 0);
    if (desc < 0 || desc >= bruto) throw new ErroNota(`Item ${i + 1}: desconto inválido`);
    const liquido = r2(bruto - desc);
    vProd = r2(vProd + bruto); vDesc = r2(vDesc + desc);
    const tb = it.ibpt || {};
    const t = { federal: r2(liquido * (Number(tb.federal) || 0) / 100), estadual: r2(liquido * (Number(tb.estadual) || 0) / 100),
      municipal: r2(liquido * (Number(tb.municipal) || 0) / 100) };
    const tItem = r2(t.federal + t.estadual + t.municipal);
    for (const k of Object.keys(trib)) trib[k] = r2(trib[k] + t[k]);
    vTotTrib = r2(vTotTrib + tItem);
    const ean = gtin(it.ean);
    const un = String(it.unidade || 'UN').trim().toUpperCase().slice(0, 6) || 'UN';
    const descricao = (homolog && nfce && i === 0 ? HOMOLOGACAO_TEXTO : String(it.descricao || '').trim()).slice(0, 120);
    if (!descricao) throw new ErroNota(`Item ${i + 1}: sem descrição`);
    const item = {
      numero_item: i + 1, codigo_produto: String(it.codigo), descricao, codigo_ncm: ncm,
      cfop: cfopDestino(it.cfop || '5102', interestadual), unidade_comercial: un, quantidade_comercial: q,
      valor_unitario_comercial: vUn, unidade_tributavel: un, quantidade_tributavel: q, valor_unitario_tributavel: vUn,
      valor_bruto: bruto, codigo_barras_comercial: ean, codigo_barras_tributavel: ean, inclui_no_total: 1,
      icms_origem: Number(it.origem) || 0, icms_situacao_tributaria: csosn,
      pis_situacao_tributaria: '99', pis_base_calculo: 0, pis_aliquota_porcentual: 0, pis_valor: 0,
      cofins_situacao_tributaria: '99', cofins_base_calculo: 0, cofins_aliquota_porcentual: 0, cofins_valor: 0,
    };
    const cest = so(it.cest);
    if (cest.length === 7) item.cest = cest;
    if (desc > 0) item.valor_desconto = desc;
    if (tItem > 0) item.valor_total_tributos = tItem;
    return item;
  });
  const vNF = r2(vProd - vDesc);
  if (!nfce) Object.assign(nota, { valor_produtos: vProd, valor_desconto: vDesc, valor_total: vNF, valor_frete: 0, valor_seguro: 0 });

  // pagamentos
  if (!pagamentos?.length) throw new ErroNota('Informe a forma de pagamento');
  let pago = 0;
  nota.formas_pagamento = pagamentos.map((pg) => {
    const tPag = FORMAS_PAGAMENTO[pg.forma] || pg.forma;
    if (!Object.values(FORMAS_PAGAMENTO).includes(tPag)) throw new ErroNota(`Forma de pagamento inválida: ${pg.forma}`);
    const vPag = tPag === '90' ? 0 : r2(pg.valor);
    if (tPag !== '90' && !(vPag > 0)) throw new ErroNota('Valor de pagamento inválido');
    pago = r2(pago + vPag);
    const d = { forma_pagamento: tPag, valor_pagamento: vPag };
    if (tPag === '05') d.indicador_pagamento = 1;
    if (tPag === '99') d.descricao_pagamento = String(pg.descricao || 'OUTROS').slice(0, 60);
    if (ELETRONICOS.has(tPag)) {
      const c = pg.cartao || {};
      d.tipo_integracao = c.integrado ? 1 : 2;
      if (c.integrado) {
        if (so(c.cnpj).length === 14) d.cnpj_credenciadora = so(c.cnpj);
        const band = BANDEIRAS[String(c.bandeira || '').toUpperCase()];
        if (band && tPag !== '17') d.bandeira_operadora = band;
        if (c.autorizacao) d.numero_autorizacao = String(c.autorizacao).slice(0, 128);
      }
    }
    return d;
  });
  const semPagamento = nota.formas_pagamento.every((d) => d.forma_pagamento === '90');
  if (!semPagamento && pago < vNF) throw new ErroNota(`Pagamentos (${pago.toFixed(2)}) menores que o total da nota (${vNF.toFixed(2)})`);
  const troco = semPagamento ? 0 : r2(pago - vNF);
  if (troco > 0 && !nota.formas_pagamento.some((d) => d.forma_pagamento === '01')) {
    throw new ErroNota('Troco só é permitido com pagamento em dinheiro');
  }
  if (troco > 0) nota.valor_troco = troco;

  const textoTrib = vTotTrib > 0
    ? `Trib aprox R$ ${trib.federal.toFixed(2)} Federal, ${trib.estadual.toFixed(2)} Estadual e ${trib.municipal.toFixed(2)} Municipal. Fonte: IBPT.`
    : null;
  const cpl = [infCpl, textoTrib].filter(Boolean).join(' ').slice(0, 5000);
  if (cpl) nota.informacoes_adicionais_contribuinte = cpl;
  return { nota, total: vNF };
}

/** Status da Focus NFe -> status de notas_fiscais. */
export function statusNota(s) {
  return { autorizado: 'autorizada', erro_autorizacao: 'rejeitada', denegado: 'denegada', cancelado: 'cancelada',
    processando_autorizacao: 'processando' }[s] || 'processando';
}
