// Emissão, consulta, cancelamento e DANFE de NFC-e/NF-e (Nuvem Fiscal). Usado por api/fiscal.js.
import { montarNota, statusNota, ErroNota, EMITENTE } from './montar.js';
import { nuvemFiscal, ErroNuvemFiscal } from './nuvemfiscal.js';

const ou = (r) => { if (r.error) throw new Error(r.error.message); return r; };
const tipo = (modelo) => (modelo === 65 ? 'nfce' : 'nfe');
const erro400 = (m) => Object.assign(new Error(m), { status: 400 });

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
    infCpl: [cfg.inf_complementar, corpo.inf_complementar].filter(Boolean).join(' ') || undefined };

  // valida tudo antes de gastar um número
  try { montarNota({ ...base, numero: 1 }); } catch (e) { if (e instanceof ErroNota) throw erro400(e.message); throw e; }

  const reserva = ou(await sb.rpc('reservar_numero_fiscal', { p_modelo: modelo, p_serie: serie, p_ambiente: ambiente })).data[0];
  const referencia = `${modelo}-${serie}-${reserva.numero}-${ambiente === 'producao' ? 'p' : 'h'}-${reserva.tentativa}`;
  const payload = montarNota({ ...base, numero: reserva.numero, referencia });
  const total = payload.infNFe.total.ICMSTot.vNF;

  const nota = ou(await sb.from('notas_fiscais').insert({
    modelo, serie, numero: reserva.numero, ambiente, tentativa: reserva.tentativa, referencia, venda_id: corpo.venda_id || null,
    cliente_id: destinatario?.cliente_id || null, destinatario_nome: destinatario?.nome || null,
    destinatario_doc: destinatario?.cpf_cnpj ? String(destinatario.cpf_cnpj).replace(/\D/g, '') : null,
    valor_total: total, payload, usuario: usuario.nome,
  }).select().single()).data;

  let resp;
  try {
    resp = await nuvemFiscal('POST', `/${tipo(modelo)}`, payload);
  } catch (e) {
    // 4xx = recusado pela Nuvem Fiscal antes da SEFAZ (número não usado); falha de rede/5xx = situação incerta
    const recusado = e instanceof ErroNuvemFiscal && e.statusOriginal < 500;
    return atualizarNota(sb, nota.id, { status: recusado ? 'rejeitada' : 'erro', motivo: e.message });
  }
  return gravarRetorno(sb, nota.id, resp);
}

function camposDoRetorno(resp) {
  const a = resp.autorizacao || {};
  return {
    provedor_id: resp.id, status: statusNota(resp.status), chave: resp.chave || a.chave_acesso || null,
    protocolo: a.numero_protocolo || null, codigo_status: a.codigo_status ?? null,
    motivo: a.motivo_status || a.mensagem || null, emitida_em: resp.data_emissao || null,
  };
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

/** Reconsulta a situação (útil para 'processando' e 'erro'). */
export async function consultarNota(sb, id) {
  const n = await lerNota(sb, id);
  if (n.provedor_id) return gravarRetorno(sb, n.id, await nuvemFiscal('GET', `/${tipo(n.modelo)}/${n.provedor_id}`));
  // sem id: procura pela referência (a chamada pode ter chegado à Nuvem Fiscal antes da falha de rede)
  const q = new URLSearchParams({ cpf_cnpj: EMITENTE.cnpj, ambiente: n.ambiente, referencia: n.referencia });
  const lista = await nuvemFiscal('GET', `/${tipo(n.modelo)}?${q}`);
  const achada = lista?.data?.[0];
  if (achada) return gravarRetorno(sb, n.id, achada);
  // não chegou: o número fica livre para a próxima nota
  return atualizarNota(sb, n.id, n.status === 'erro' ? { status: 'rejeitada', motivo: `${n.motivo || ''} (não chegou à SEFAZ)`.trim() } : {});
}

export async function cancelarNota(sb, usuario, id, justificativa) {
  const j = String(justificativa || '').trim();
  if (j.length < 15 || j.length > 255) throw erro400('A justificativa precisa ter de 15 a 255 caracteres');
  const n = await lerNota(sb, id);
  if (n.status !== 'autorizada') throw erro400('Só nota autorizada pode ser cancelada');
  const ev = await nuvemFiscal('POST', `/${tipo(n.modelo)}/${n.provedor_id}/cancelamento`, { justificativa: j });
  if (ev.status !== 'registrado') {
    throw erro400(`SEFAZ não registrou o cancelamento: ${ev.motivo_status || ev.mensagem || ev.status}`);
  }
  return atualizarNota(sb, n.id, { status: 'cancelada', cancelada_em: ev.data_evento || new Date().toISOString(),
    justificativa_cancelamento: j, motivo: ev.motivo_status || n.motivo });
}

/** DANFE (NF-e) ou DANFCE (NFC-e) em PDF, base64. */
export async function pdfNota(sb, id) {
  const n = await lerNota(sb, id);
  if (!n.provedor_id) throw erro400('Nota sem retorno da SEFAZ');
  const pdf = await nuvemFiscal('GET', `/${tipo(n.modelo)}/${n.provedor_id}/pdf`, null, { binario: true });
  return { nome: `${tipo(n.modelo)}-${n.serie}-${n.numero}.pdf`, base64: pdf.toString('base64') };
}

export async function xmlNota(sb, id) {
  const n = await lerNota(sb, id);
  if (!n.provedor_id) throw erro400('Nota sem retorno da SEFAZ');
  const xml = await nuvemFiscal('GET', `/${tipo(n.modelo)}/${n.provedor_id}/xml`, null, { binario: true });
  return { nome: `${n.chave || `${tipo(n.modelo)}-${n.numero}`}.xml`, base64: xml.toString('base64') };
}

export async function statusSefaz(modelo = 65) {
  return nuvemFiscal('GET', `/${tipo(modelo)}/sefaz/status?cpf_cnpj=${EMITENTE.cnpj}`);
}
