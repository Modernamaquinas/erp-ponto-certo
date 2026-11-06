// Mapa tabela a tabela: o que ler do DirectControl e como gravar no ERP.
// Ordem importa (pais antes dos filhos). `incremental: 'janela'` = na sincronização periódica só
// relê os últimos N dias (tabelas grandes); as demais são relidas inteiras (upsert idempotente).
import { txt, dig, bool, num, dinheiro, data, hora, fk, tipoPessoa, situacaoVenda, statusReceber, tipoForma, tipoPlano } from './transformar.mjs';

// Datas/horas/blobs convertidos para texto no próprio Firebird: evita o deslocamento de fuso
// do driver e lê BLOB de texto sem uma chamada extra por linha.
const D = (c, alias = c) => `CAST(${c} AS VARCHAR(10)) AS ${alias}`;
const H = (c, alias = c) => `CAST(${c} AS VARCHAR(13)) AS ${alias}`;
const B = (c, n = 2000, alias = c) => `CAST(SUBSTRING(${c} FROM 1 FOR ${n}) AS VARCHAR(${n})) AS ${alias}`;

export const TABELAS = [
  {
    tabela: 'empresa',
    extrair: (fb) => fb.consultar(`SELECT FIRST 1 RAZAO_SOCIAL, NOME_FANTASIA, CNPJ, IE, ENDERECO, BAIRRO, COD_CID, CEP, FONE, EMAIL FROM EMITENTE ORDER BY COD_EMITENTE`),
    transformar: (r) => ({
      id: 1, razao_social: txt(r.razao_social) || 'PONTO CERTO', nome_fantasia: txt(r.nome_fantasia),
      cnpj: dig(r.cnpj), ie: txt(r.ie), endereco: txt(r.endereco), bairro: txt(r.bairro),
      cidade_id: num(r.cod_cid), cep: dig(r.cep), telefone: dig(r.fone), email: txt(r.email),
    }),
  },
  {
    tabela: 'cidades',
    extrair: (fb) => fb.consultar(`SELECT COD_CID, NOME_CID, UF_CID, CODMUN_IBGE FROM CIDADES`),
    transformar: (r) => ({ id: r.cod_cid, nome: txt(r.nome_cid) || '?', uf: txt(r.uf_cid), ibge: num(r.codmun_ibge) }),
  },
  {
    tabela: 'usuarios_legado',
    extrair: (fb) => fb.consultar(`SELECT COD_USUARIO, NOME_USUARIO, NOME_COMPLETO FROM USUARIOS`),
    transformar: (r) => ({ id: r.cod_usuario, login: txt(r.nome_usuario), nome: txt(r.nome_completo) }),
  },
  {
    tabela: 'formas_pagamento',
    extrair: (fb) => fb.consultar(`SELECT COD_FPGTO, DESC_FPGTO, TIPO_PGTO FROM FORMAPGTO`),
    transformar: (r) => ({ id: r.cod_fpgto, descricao: txt(r.desc_fpgto) || `FORMA ${r.cod_fpgto}`, tipo: tipoForma(r.tipo_pgto) }),
  },
  {
    tabela: 'plano_contas',
    extrair: (fb) => fb.consultar(`SELECT COD_CONTA, NOMECONTA, ENTRADA_SAIDA FROM PLANOCONTAS`),
    transformar: (r) => ({ id: r.cod_conta, nome: txt(r.nomeconta) || `CONTA ${r.cod_conta}`, tipo: tipoPlano(r.entrada_saida) }),
  },
  {
    tabela: 'grupos_produto',
    extrair: (fb) => fb.consultar(`SELECT COD_GRUPO, NOME_GRUPO FROM GRUPOPRODUTOS`),
    transformar: (r) => ({ id: r.cod_grupo, nome: txt(r.nome_grupo) || `GRUPO ${r.cod_grupo}` }),
  },
  {
    tabela: 'subgrupos_produto',
    extrair: (fb) => fb.consultar(`SELECT COD_SUBGRUPO, COD_GRUPO, NOME_SUBGRUPO, MARGEM FROM SUBGRUPOPRODUTOS`),
    transformar: (r, c) => ({ id: r.cod_subgrupo, grupo_id: fk(r.cod_grupo, c.ids.grupos_produto),
      nome: txt(r.nome_subgrupo) || `SUBGRUPO ${r.cod_subgrupo}`, margem: num(r.margem) }),
  },
  {
    tabela: 'clientes',
    // Só colunas vindas do legado: as de cobrança (email_cobranca etc.) são do ERP e não são tocadas.
    extrair: (fb) => fb.consultar(`SELECT COD_CLI, NOME_CLI, NOME_FANTASIA, TIPO_PESSOA, CPF, RG, IE, EMAIL, CELULAR,
        FONE_RES, FONE_COM, CONTATO, CEP, ENDERECO, NUMERO, COMPLEMENTO, BAIRRO, COD_CID, ${D('DATANASC')},
        LIMITE, BLOQUEAR_VENDA, ATIVO, ${B('OBSERVACOES')}, ${D('DATACAD')}, ${D('DT_ULT_COMPRA')} FROM CLIENTES`),
    transformar: (r, c) => {
      const doc = dig(r.cpf);
      const tp = tipoPessoa(r.tipo_pessoa, doc);
      return {
        id: r.cod_cli, nome: txt(r.nome_cli) || `CLIENTE ${r.cod_cli}`, nome_fantasia: txt(r.nome_fantasia),
        tipo_pessoa: tp, cpf_cnpj: doc, rg_ie: tp === 'J' ? txt(r.ie) : txt(r.rg), email: txt(r.email),
        celular: dig(r.celular), telefone: dig(r.fone_res) || dig(r.fone_com), contato: txt(r.contato),
        cep: dig(r.cep), endereco: txt(r.endereco), numero: num(r.numero) ? String(r.numero) : null,
        complemento: txt(r.complemento), bairro: txt(r.bairro), cidade_id: fk(r.cod_cid, c.ids.cidades),
        data_nascimento: data(r.datanasc), limite_credito: num(r.limite), bloqueado: bool(r.bloquear_venda),
        ativo: bool(r.ativo, true), observacoes: txt(r.observacoes), criado_em: data(r.datacad),
        ultima_compra: data(r.dt_ult_compra),
      };
    },
  },
  {
    tabela: 'fornecedores',
    extrair: (fb) => fb.consultar(`SELECT COD_FORN, NOME_FOR, FANTASIA, TIPO_PESSOA, CGCCPF, IE, EMAIL, FONE1, CELULAR,
        CONTATO, CEP, ENDERECO, NUMERO, COMPLEMENTO, BAIRRO, COD_CID, ATIVO, ${B('OBSERVACOES')}, ${D('DATACAD')} FROM FORNECEDORES`),
    transformar: (r, c) => {
      const doc = dig(r.cgccpf);
      return {
        id: r.cod_forn, nome: txt(r.nome_for) || `FORNECEDOR ${r.cod_forn}`, fantasia: txt(r.fantasia),
        tipo_pessoa: tipoPessoa(r.tipo_pessoa, doc), cpf_cnpj: doc, ie: txt(r.ie), email: txt(r.email),
        telefone: dig(r.fone1), celular: dig(r.celular), contato: txt(r.contato), cep: dig(r.cep),
        endereco: txt(r.endereco), numero: num(r.numero) ? String(r.numero) : null, complemento: txt(r.complemento),
        bairro: txt(r.bairro), cidade_id: fk(r.cod_cid, c.ids.cidades), ativo: bool(r.ativo, true),
        observacoes: txt(r.observacoes), criado_em: data(r.datacad),
      };
    },
  },
  {
    tabela: 'produtos',
    extrair: (fb) => fb.consultar(`SELECT p.COD_PROD, p.NOME_PROD, p.MARCA, p.REFERENCIA, p.COD_BARRAS, u.UNIDADE,
        p.COD_GRUPO, p.COD_SUBGRUPO, p.PRECO1, p.PRECO_ATACADO, p.QTD_ATACADO, p.CUSTO, p.CUSTO_MEDIO, p.MARGEM,
        p.ESTOQUE, p.ESTOQUE_MINIMO, p.ATIVO, i.NCM, i.CEST, i.CFOP, i.CST2, ${B('p.UTILIZACAO', 2000, 'UTILIZACAO')},
        ${D('p.DATA_ULTIMA_ENTRADA', 'DATA_ULTIMA_ENTRADA')}, ${D('p.DATA_ULTIMA_SAIDA', 'DATA_ULTIMA_SAIDA')},
        ${D('p.DATACAD', 'DATACAD')}
      FROM PRODUTOS p
      LEFT JOIN UNIDADES u ON u.COD_UNIDADE = p.COD_UNIDADE
      LEFT JOIN PRODUTOS_IMPOSTOS i ON i.COD_PROD = p.COD_PROD`),
    transformar: (r, c) => ({
      id: r.cod_prod, nome: txt(r.nome_prod) || `PRODUTO ${r.cod_prod}`, marca: txt(r.marca), referencia: txt(r.referencia),
      codigo_barras: txt(r.cod_barras), unidade: txt(r.unidade), grupo_id: fk(r.cod_grupo, c.ids.grupos_produto),
      subgrupo_id: fk(r.cod_subgrupo, c.ids.subgrupos_produto), preco_venda: dinheiro(r.preco1),
      preco_atacado: num(r.preco_atacado) || null, qtd_atacado: num(r.qtd_atacado) || null, custo: num(r.custo),
      custo_medio: num(r.custo_medio), margem: num(r.margem), estoque: num(r.estoque) ?? 0,
      estoque_minimo: num(r.estoque_minimo), ativo: bool(r.ativo, true), ncm: txt(r.ncm), cest: txt(r.cest),
      cfop: num(r.cfop), cst_csosn: txt(r.cst2), utilizacao: txt(r.utilizacao),
      data_ultima_entrada: data(r.data_ultima_entrada), data_ultima_saida: data(r.data_ultima_saida), criado_em: data(r.datacad),
    }),
  },
  {
    tabela: 'produto_fornecedores',
    extrair: (fb) => fb.consultar(`SELECT COD_PRODFORN, COD_PROD, COD_FORN, COD_PRODUTO_FORN, PRECO1, ${D('DATA')} FROM PRODUTOS_FORN`),
    transformar: (r, c) => {
      const produto = fk(r.cod_prod, c.ids.produtos);
      const fornecedor = fk(r.cod_forn, c.ids.fornecedores);
      if (!produto || !fornecedor) return null;
      return { id: r.cod_prodforn, produto_id: produto, fornecedor_id: fornecedor,
        codigo_no_fornecedor: txt(r.cod_produto_forn), preco_custo: num(r.preco1), data: data(r.data) };
    },
  },
  {
    tabela: 'vendas',
    incremental: 'janela',
    extrair: (fb, c) => fb.consultarPaginado(`SELECT COD_NOTA, ${D('DATA')}, ${H('HORA')}, COD_CLI, CLI_FORACAD, CPF,
        TOT_PRODUTOS, DESCVALOR, ACRESCVALOR, TOT_NOTA, VENDA_FINALIZADA, ${D('DATA_ESTORNO')}, NUM_NFC, NUM_NFE,
        NUM_CAIXA, OBSERVACAO FROM VENDAS WHERE DATA IS NOT NULL${c.desde ? ` AND DATA >= '${c.desde}'` : ''}`, 'COD_NOTA'),
    transformar: (r, c) => ({
      id: r.cod_nota, data: data(r.data), hora: hora(r.hora), cliente_id: fk(r.cod_cli, c.ids.clientes),
      cliente_nome: txt(r.cli_foracad), cpf_nota: dig(r.cpf), total_produtos: num(r.tot_produtos),
      desconto: dinheiro(r.descvalor), acrescimo: dinheiro(r.acrescvalor), total: dinheiro(r.tot_nota),
      situacao: situacaoVenda(r.venda_finalizada, r.data_estorno), numero_nfce: num(r.num_nfc) || null,
      numero_nfe: num(r.num_nfe) || null, num_caixa: num(r.num_caixa), observacao: txt(r.observacao),
    }),
    filtrar: (o) => o.data !== null,
  },
  {
    tabela: 'venda_itens',
    incremental: 'janela',
    conflito: ['venda_id', 'item'],
    extrair: (fb, c) => fb.consultarPaginado(`SELECT COD_NOTA, ITEM_VENDA, COD_PROD, NOMEPROD, QUANTIDADE, PRECOUNIT,
        DESC_VENDA, VLTOTITEM, CUSTO FROM ITEMVENDA${c.desde ? ` WHERE COD_NOTA IN (SELECT COD_NOTA FROM VENDAS WHERE DATA >= '${c.desde}')` : ''}`,
      'COD_NOTA, ITEM_VENDA'),
    transformar: (r, c) => {
      if (!c.ids.vendas.has(r.cod_nota)) return null;
      return { venda_id: r.cod_nota, item: r.item_venda, produto_id: fk(r.cod_prod, c.ids.produtos),
        descricao: txt(r.nomeprod), quantidade: num(r.quantidade) ?? 0, preco_unitario: num(r.precounit) ?? 0,
        desconto: dinheiro(r.desc_venda), total: dinheiro(r.vltotitem), custo: num(r.custo) };
    },
  },
  {
    tabela: 'venda_pagamentos',
    incremental: 'janela',
    conflito: ['venda_id', 'item'],
    extrair: (fb, c) => fb.consultarPaginado(`SELECT COD_NOTA, ITEM_PGTO, COD_FPGTO, VALOR, QTDE_VEZES FROM PGTOVENDAS${
      c.desde ? ` WHERE COD_NOTA IN (SELECT COD_NOTA FROM VENDAS WHERE DATA >= '${c.desde}')` : ''}`, 'COD_NOTA, ITEM_PGTO'),
    transformar: (r, c) => {
      if (!c.ids.vendas.has(r.cod_nota)) return null;
      return { venda_id: r.cod_nota, item: r.item_pgto, forma_pagamento_id: fk(r.cod_fpgto, c.ids.formas_pagamento),
        valor: dinheiro(r.valor), parcelas: num(r.qtde_vezes) };
    },
  },
  {
    tabela: 'compras',
    incremental: 'janela',
    extrair: (fb, c) => fb.consultar(`SELECT COD_NOTA, COD_NOTAFORN, SERIE, CHAVE_NOTA, COD_FORN, ${D('DATA_EMISSAO')},
        ${D('DATA_RECEBIM')}, VALOR_TOT_PROD, VALOR_FRETE, VALOR_TOT_IPI, VALOR_ICMS_SUB, DESCONTO, VALOR_TOT_NOTA
      FROM NOTASENTRADA${c.desde ? ` WHERE DATA_EMISSAO >= '${c.desdeCompras}'` : ''}`),
    transformar: (r, c) => ({
      id: r.cod_nota, numero_nota: num(r.cod_notaforn) ? String(r.cod_notaforn) : null, serie: num(r.serie),
      chave_nfe: txt(r.chave_nota), fornecedor_id: fk(r.cod_forn, c.ids.fornecedores), data_emissao: data(r.data_emissao),
      data_entrada: data(r.data_recebim), valor_produtos: num(r.valor_tot_prod), valor_frete: num(r.valor_frete),
      valor_ipi: num(r.valor_tot_ipi), valor_st: num(r.valor_icms_sub), desconto: num(r.desconto), valor_total: num(r.valor_tot_nota),
    }),
  },
  {
    tabela: 'compra_itens',
    incremental: 'janela',
    conflito: ['compra_id', 'item'],
    extrair: (fb, c) => fb.consultarPaginado(`SELECT COD_NOTA, ITEM_NOTA, COD_PROD, XPROD, QUANTIDADE, PRECOUNIT, VLTOTITEM,
        NCM, CFOP, CEAN FROM ITEMNOTAENT${c.desde ? ` WHERE COD_NOTA IN (SELECT COD_NOTA FROM NOTASENTRADA WHERE DATA_EMISSAO >= '${c.desdeCompras}')` : ''}`,
      'COD_NOTA, ITEM_NOTA'),
    transformar: (r, c) => {
      if (!c.ids.compras.has(r.cod_nota)) return null;
      return { compra_id: r.cod_nota, item: r.item_nota, produto_id: fk(r.cod_prod, c.ids.produtos), descricao: txt(r.xprod),
        quantidade: num(r.quantidade), custo_unitario: num(r.precounit), total: num(r.vltotitem), ncm: txt(r.ncm),
        cfop: txt(r.cfop), ean: txt(r.cean) };
    },
  },
  {
    tabela: 'contas_receber',
    extrair: (fb) => fb.consultar(`SELECT COD_RECEBER, COD_CLI, COD_NOTA, DOCUMENTO, HISTORICO, NUM_PARC, TOT_PARCELAS,
        ${D('EMISSAO')}, ${D('VENCIMENTO')}, VALOR, ACRESCIMO, DESCONTO, VALORPAGO, SALDO, ${D('DATAPAGTO')}, STATUS,
        COD_CONTA, ${B('OBSERVACAO', 1000)} FROM CONTASRECEBER WHERE COD_CLI IS NOT NULL`),
    transformar: (r, c) => {
      const status = statusReceber(r.status, r.saldo);
      const venc = data(r.vencimento) || data(r.emissao);
      if (!venc) return null;
      return {
        id: r.cod_receber, cliente_id: fk(r.cod_cli, c.ids.clientes), venda_id: num(r.cod_nota),
        documento: txt(r.documento), historico: txt(r.historico), parcela: num(r.num_parc), total_parcelas: num(r.tot_parcelas),
        emissao: data(r.emissao), vencimento: venc, valor: dinheiro(r.valor), acrescimo: dinheiro(r.acrescimo),
        desconto: dinheiro(r.desconto), valor_pago: dinheiro(r.valorpago),
        saldo: status === 'aberto' ? dinheiro(r.saldo) : 0,
        data_pagamento: status === 'pago' ? (data(r.datapagto) || null) : null, status,
        plano_conta_id: fk(r.cod_conta, c.ids.plano_contas), observacao: txt(r.observacao),
        baixa_origem: status === 'pago' ? 'legado' : null,
      };
    },
    // Baixas dadas no ERP/Asaas valem mais que o legado (que ainda mostra o título aberto até alguém
    // repetir a baixa lá). Quando o legado também quitar, a pendência de réplica some sozinha.
    set: (() => {
      const erp = `contas_receber.baixa_origem in ('erp', 'asaas')`;
      const preserva = (col) => `case when ${erp} then contas_receber.${col} else excluded.${col} end`;
      return {
        valor_pago: preserva('valor_pago'), saldo: preserva('saldo'), data_pagamento: preserva('data_pagamento'),
        status: preserva('status'), baixa_origem: preserva('baixa_origem'),
        baixa_replicada_legado: `case when ${erp} and excluded.status = 'pago' then true else contas_receber.baixa_replicada_legado end`,
      };
    })(),
  },
  {
    tabela: 'recebimentos',
    incremental: 'janela',
    conflito: ['legado_chave'],
    extrair: (fb, c) => fb.consultar(`SELECT p.COD_RECEBER, p.ITEM_PGTO, p.SEQUENCIAL, p.COD_FPGTO, f.DESC_FPGTO, p.VALOR,
        ${D('p.DATA', 'DATA')}, p.COD_USUARIO FROM PGTOCONTASRECEBER p LEFT JOIN FORMAPGTO f ON f.COD_FPGTO = p.COD_FPGTO
      WHERE p.DATA IS NOT NULL${c.desde ? ` AND p.DATA >= '${c.desde}'` : ''}`),
    transformar: (r, c) => {
      if (!c.ids.contas_receber.has(r.cod_receber)) return null;
      return { legado_chave: `pcr:${r.cod_receber}:${r.item_pgto}:${r.sequencial ?? 0}`, conta_receber_id: r.cod_receber,
        data: data(r.data), forma_pagamento_id: fk(r.cod_fpgto, c.ids.formas_pagamento), forma_descricao: txt(r.desc_fpgto),
        valor: dinheiro(r.valor), origem: 'legado', usuario: c.usuarios.get(r.cod_usuario) || null };
    },
    filtrar: (o) => o.data !== null,
  },
  {
    tabela: 'contas_pagar',
    extrair: (fb) => fb.consultar(`SELECT COD_PAGAR, COD_FORN, DOCUMENTO, HISTORICO, NUM_PARC, TOT_PARC, ${D('EMISSAO')},
        ${D('VENCIMENTO')}, VALOR, ACRESCIMO, DESCONTO, VALORPAGO, SALDO, ${D('DATAPAGTO')}, COD_CONTA, OBSERVACAO, PORTADOR
      FROM CONTASPAGAR`),
    transformar: (r, c) => {
      const venc = data(r.vencimento) || data(r.emissao);
      if (!venc) return null;
      const pago = data(r.datapagto) !== null;
      return {
        id: r.cod_pagar, fornecedor_id: fk(r.cod_forn, c.ids.fornecedores), documento: txt(r.documento),
        historico: txt(r.historico), parcela: num(r.num_parc), total_parcelas: num(r.tot_parc), emissao: data(r.emissao),
        vencimento: venc, valor: dinheiro(r.valor), acrescimo: dinheiro(r.acrescimo), desconto: dinheiro(r.desconto),
        valor_pago: dinheiro(r.valorpago), saldo: pago ? 0 : dinheiro(r.saldo ?? r.valor),
        data_pagamento: pago ? data(r.datapagto) : null, status: pago ? 'pago' : 'aberto',
        plano_conta_id: fk(r.cod_conta, c.ids.plano_contas),
        observacao: [txt(r.observacao), txt(r.portador) && `Portador: ${txt(r.portador)}`].filter(Boolean).join(' | ') || null,
        baixa_origem: pago ? 'legado' : null,
        // Vencida e sem baixa no DirectControl (que nunca recebeu baixas de contas a pagar): conferir.
        conferir_baixa_legado: !pago && venc < c.hoje,
      };
    },
    set: (() => {
      const erp = `contas_pagar.baixa_origem = 'erp'`;
      const preserva = (col) => `case when ${erp} then contas_pagar.${col} else excluded.${col} end`;
      return {
        valor_pago: preserva('valor_pago'), saldo: preserva('saldo'), data_pagamento: preserva('data_pagamento'),
        status: preserva('status'), baixa_origem: preserva('baixa_origem'), observacao: preserva('observacao'),
        conferir_baixa_legado: `case when ${erp} or excluded.status = 'pago' then false else contas_pagar.conferir_baixa_legado end`,
      };
    })(),
  },
  {
    tabela: 'caixa_lancamentos',
    incremental: 'janela',
    conflito: ['legado_chave'],
    extrair: (fb, c) => fb.consultarPaginado(`SELECT COD_CAIXA, ITEM_LANCTO, ${D('DATA')}, ${H('HORA_LANCTO')}, HISTORICO,
        ENTRADA, SAIDA, COD_FPGTO, COD_CONTA, N_DOC, COD_USUARIO FROM LANCAMENTOCAIXA
      WHERE DATA IS NOT NULL${c.desde ? ` AND DATA >= '${c.desde}'` : ''}`, 'COD_CAIXA, ITEM_LANCTO'),
    transformar: (r, c) => ({
      legado_chave: `cx:${r.cod_caixa}:${r.item_lancto}`, data: data(r.data), hora: hora(r.hora_lancto),
      historico: txt(r.historico), entrada: dinheiro(r.entrada), saida: dinheiro(r.saida),
      forma_pagamento_id: fk(r.cod_fpgto, c.ids.formas_pagamento), plano_conta_id: fk(r.cod_conta, c.ids.plano_contas),
      documento: num(r.n_doc) ? String(r.n_doc) : null, origem: 'legado', usuario: c.usuarios.get(r.cod_usuario) || null,
    }),
    filtrar: (o) => o.data !== null,
  },
];

// Tabelas cujos ids são consultados no destino para validar FKs dos filhos.
export const CONJUNTOS_DE_IDS = ['cidades', 'formas_pagamento', 'plano_contas', 'grupos_produto', 'subgrupos_produto',
  'clientes', 'fornecedores', 'produtos', 'vendas', 'compras', 'contas_receber'];
