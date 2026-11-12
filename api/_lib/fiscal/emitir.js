// Emissão, consulta, cancelamento e DANFE de NFC-e/NF-e (Focus NFe). Usado por api/fiscal.js.
// A referência (ref) da Focus é a nossa `notas_fiscais.referencia`; a numeração é do ERP (campos numero/serie).
import { montarNota, statusNota, ErroNota } from './montar.js';
import { focus, arquivoFocus, ErroFocus } from './focus.js';

const ou = (r) => { if (r.error) throw new Error(r.error.message); return r; };
const tipo = (modelo) => (modelo === 65 ? 'nfce' : 'nfe');
const erro400 = (m) => Object.assign(new Error(m), { status: 400 });
const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

export async function configFiscal(sb) {
  return ou(await sb.from('fiscal_config').select('*').eq('id', 1).single()).data;
}

async function destinatarioDoCliente(sb, clienteId) {
  const c = ou(await sb.from('clientes').select('id, nome, cpf_cnpj, rg_ie, tipo_pessoa, email, telefone, celular, cep, endereco, numero, complemento, bairro, cidades(nome, uf, ibge)')
    .eq('id', clienteId).maybeSingle()).data;
  if (!c) throw erro400('Cliente não encontrado');
  return {
    cliente_id: c.id, nome: c.nome, cpf_cnpj: c.cpf_cnpj, ie: c.tipo_pessoa === 'J' ? c.rg_ie : null, email: c.email,
    endereco: { logradouro: c.endereco, numero: c.numero, complemento: c.complemento, bairro: c.bairro, cep: c.cep,
      cMun: c.cidades?.ibge, municipio: c.cidades?.nome, uf: c.cidades?.uf, fone: c.celular || c.telefone },
  };
}

/**
 * corpo: { modelo: 55|65, itens: [{ produto_id, quantidade, valor_unitario?, desconto? }],
 *          pagamentos: [{ forma, valor, cartao? }], cliente_id?, cpf? (NFC-e), venda_id?, inf_complementar? }
 */
export async function emitirNota(sb, usuario, corpo) {
  const modelo = Number(corpo.modelo);
  if (![55, 65].includes(modelo)) throw erro400('Modelo inválido');
  const cfg = await configFiscal(sb);
  const ambiente = cfg.ambiente;
  const serie = modelo === 65 ? cfg.serie_nfce : cfg.serie_nfe;

  const pedidos = (corpo.itens || []).filter((i) => i && i.produto_id);
  if (!pedidos.length) throw erro400('Inclua pelo menos um produto');
  const ids = [...new Set(pedidos.map((i) => Number(i.produto_id)))];
  const produtos = new Map(ou(await sb.from('produtos')
    .select('id, nome, ncm, cest, cfop, cst_csosn, origem, unidade, codigo_barras, preco_venda, ibpt_federal, ibpt_estadual, ibpt_municipal')
    .in('id', ids)).data.map((p) => [Number(p.id), p]));
  const itens = pedidos.map((i) => {
    const p = produtos.get(Number(i.produto_id));
    if (!p) throw erro400(`Produto ${i.produto_id} não encontrado`);
    return {
      codigo: p.id, descricao: p.nome, ncm: p.ncm, cest: p.cest, cfop: p.cfop || 5102, csosn: p.cst_csosn || '102',
      origem: p.origem, unidade: p.unidade, ean: p.codigo_barras, quantidade: Number(i.quantidade),
      valor_unitario: i.valor_unitario != null && i.valor_unitario !== '' ? Number(i.valor_unitario) : Number(p.preco_venda),
      desconto: Number(i.desconto || 0),
      ibpt: { federal: p.ibpt_federal, estadual: p.ibpt_estadual, municipal: p.ibpt_municipal },
    };
  });

  let destinatario = null;
  if (corpo.cliente_id) destinatario = await destinatarioDoCliente(sb, Number(corpo.cliente_id));
  else if (modelo === 65 && corpo.cpf) destinatario = { cpf_cnpj: corpo.cpf, nome: corpo.nome_consumidor || null };
  const base = { modelo, ambiente, serie, itens, pagamentos: corpo.pagamentos, destinatario, natOp: cfg.natureza_operacao,
    infCpl: [cfg.inf_complementar, corpo.inf_complementar].filter(Boolean).join(' ') || undefined,
    frete: Number(corpo.frete) || 0 };

  // valida tudo antes de gastar um número
  try { montarNota({ ...base, numero: 1 }); } catch (e) { if (e instanceof ErroNota) throw erro400(e.message); throw e; }

  const reserva = ou(await sb.rpc('reservar_numero_fiscal', { p_modelo: modelo, p_serie: serie, p_ambiente: ambiente })).data[0];
  const referencia = `pc-${modelo}-${serie}-${reserva.numero}-${ambiente === 'producao' ? 'p' : 'h'}${reserva.tentativa}`;
  const { nota: payload, total } = montarNota({ ...base, numero: reserva.numero });

  const nota = ou(await sb.from('notas_fiscais').insert({
    modelo, serie, numero: reserva.numero, ambiente, tentativa: reserva.tentativa, referencia, provedor_id: referencia,
    venda_id: corpo.venda_id || null, cliente_id: destinatario?.cliente_id || null, destinatario_nome: destinatario?.nome || null,
    destinatario_doc: destinatario?.cpf_cnpj ? String(destinatario.cpf_cnpj).replace(/\D/g, '') : null,
    valor_total: total, payload, usuario: usuario.nome,
  }).select().single()).data;

  let resp;
  try {
    resp = await focus(ambiente, 'POST', `/v2/${tipo(modelo)}?ref=${encodeURIComponent(referencia)}`, payload);
  } catch (e) {
    if (e instanceof ErroFocus && e.statusOriginal < 500 && !['pending_operation', 'already_processed'].includes(e.codigo)) {
      // recusada pela Focus antes da SEFAZ (validação/cadastro): o número não foi usado
      return atualizarNota(sb, nota.id, { status: 'rejeitada', motivo: e.message, codigo_status: null });
    }
    return atualizarNota(sb, nota.id, { status: 'erro', motivo: e.message });
  }
  // NF-e é assíncrona: espera um pouco a SEFAZ antes de devolver
  for (let i = 0; resp.status === 'processando_autorizacao' && i < 6; i++) {
    await esperar(3000);
    resp = await focus(ambiente, 'GET', `/v2/${tipo(modelo)}/${encodeURIComponent(referencia)}`).catch(() => resp);
  }
  return gravarRetorno(sb, nota.id, resp);
}

function camposDoRetorno(resp) {
  const c = {
    status: statusNota(resp.status), chave: resp.chave_nfe || null, protocolo: resp.protocolo || resp.numero_protocolo || null,
    codigo_status: resp.status_sefaz ? Number(resp.status_sefaz) || null : null, motivo: resp.mensagem_sefaz || resp.mensagem || null,
  };
  if (c.status === 'autorizada') c.emitida_em = resp.data_emissao || new Date().toISOString();
  return c;
}

async function atualizarNota(sb, id, campos) {
  return ou(await sb.from('notas_fiscais').update(campos).eq('id', id).select().single()).data;
}

async function gravarRetorno(sb, id, resp) {
  return atualizarNota(sb, id, camposDoRetorno(resp));
}

async function lerNota(sb, id) {
  const n = ou(await sb.from('notas_fiscais').select('*').eq('id', id).maybeSingle()).data;
  if (!n) throw erro400('Nota não encontrada');
  return n;
}

const caminhoNota = (n) => `/v2/${tipo(n.modelo)}/${encodeURIComponent(n.referencia)}`;

/** Reconsulta a situação (para 'processando' e 'erro'). */
export async function consultarNota(sb, id) {
  const n = await lerNota(sb, id);
  try {
    return gravarRetorno(sb, n.id, await focus(n.ambiente, 'GET', caminhoNota(n)));
  } catch (e) {
    // 404 = a chamada nunca chegou à Focus: o número fica livre para a próxima nota
    if (e instanceof ErroFocus && e.statusOriginal === 404 && n.status === 'erro') {
      return atualizarNota(sb, n.id, { status: 'rejeitada', motivo: `${n.motivo || ''} (não chegou à SEFAZ)`.trim() });
    }
    throw e;
  }
}

export async function cancelarNota(sb, usuario, id, justificativa) {
  const j = String(justificativa || '').trim();
  if (j.length < 15 || j.length > 255) throw erro400('A justificativa precisa ter de 15 a 255 caracteres');
  const n = await lerNota(sb, id);
  if (n.status !== 'autorizada') throw erro400('Só nota autorizada pode ser cancelada');
  const r = await focus(n.ambiente, 'DELETE', caminhoNota(n), { justificativa: j });
  if (r.status !== 'cancelado') throw erro400(`SEFAZ não registrou o cancelamento: ${r.mensagem_sefaz || r.status}`);
  return atualizarNota(sb, n.id, { status: 'cancelada', cancelada_em: new Date().toISOString(),
    justificativa_cancelamento: j, motivo: r.mensagem_sefaz || n.motivo });
}

async function baixarArquivo(sb, id, campo) {
  const n = await lerNota(sb, id);
  if (!['autorizada', 'cancelada'].includes(n.status)) throw erro400('Nota sem autorização da SEFAZ');
  const dados = await focus(n.ambiente, 'GET', caminhoNota(n));
  const caminho = dados[campo];
  if (!caminho) throw erro400('Arquivo ainda não disponível na Focus NFe');
  const arq = await arquivoFocus(n.ambiente, caminho);
  const ext = caminho.split('?')[0].split('.').pop().toLowerCase();
  return { nome: `${tipo(n.modelo)}-${n.serie}-${n.numero}.${ext}`, tipo: arq.tipo, base64: arq.dados.toString('base64') };
}

/** DANFE (NF-e, PDF) ou DANFCE (NFC-e, HTML). */
export const danfeNota = (sb, id) => baixarArquivo(sb, id, 'caminho_danfe');
export const xmlNota = (sb, id) => baixarArquivo(sb, id, 'caminho_xml_nota_fiscal');

/** A Focus não tem consulta de status da SEFAZ; confere se o token do ambiente é aceito. */
export async function verificarFocus(ambiente) {
  try {
    await focus(ambiente, 'GET', '/v2/nfce/pc-verificacao-conexao', null, { timeout: 15000 });
    return { ok: true };
  } catch (e) {
    if (e instanceof ErroFocus && e.statusOriginal === 404) return { ok: true };
    return { ok: false, erro: e.message };
  }
}
