// Regras de cobrança: títulos do crediário -> cobrança Asaas (boleto + PIX) -> baixa automática.
import { asaas, configAsaas, garantirClienteAsaas, dadosDePagamento, statusDoAsaas } from './asaas.js';
import { ErroHttp } from './supabase.js';

export const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

/** Cria UMA cobrança no Asaas cobrindo vários títulos em aberto do MESMO cliente. */
export async function criarCobranca(sb, usuario, { titulos, vencimento, descricao }) {
  const ids = [...new Set((titulos || []).map(Number))].filter(Number.isFinite);
  if (!ids.length) throw new ErroHttp(400, 'Selecione ao menos um título');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento || '') || vencimento < hojeSP()) {
    throw new ErroHttp(400, 'Vencimento da cobrança deve ser hoje ou uma data futura');
  }

  const { data: contas, error } = await sb.from('contas_receber')
    .select('id, cliente_id, documento, historico, saldo, status, cobranca_id').in('id', ids);
  if (error) throw error;
  if (contas.length !== ids.length) throw new ErroHttp(400, 'Algum título não foi encontrado');
  const clientes = new Set(contas.map((c) => c.cliente_id));
  if (clientes.size !== 1 || !contas[0].cliente_id) throw new ErroHttp(400, 'Os títulos de uma cobrança devem ser do mesmo cliente');
  const invalido = contas.find((c) => c.status !== 'aberto' || c.cobranca_id);
  if (invalido) throw new ErroHttp(400, `Título ${invalido.id} não está em aberto ou já tem cobrança`);

  const { data: cliente } = await sb.from('clientes').select('*').eq('id', contas[0].cliente_id).single();
  const valor = Math.round(contas.reduce((s, c) => s + Number(c.saldo), 0) * 100) / 100;
  if (valor < 5) throw new ErroHttp(400, 'O Asaas exige cobrança de no mínimo R$ 5,00');

  const docs = contas.map((c) => c.documento || c.id).join(', ');
  const texto = (descricao || `Ponto Certo Ferragens - crediário (vendas ${docs})`).slice(0, 500);

  const { data: cb, error: e1 } = await sb.from('cobrancas')
    .insert({ cliente_id: cliente.id, titulos: ids, valor, vencimento, descricao: texto, criado_por: usuario?.id || null })
    .select().single();
  if (e1) throw e1;

  // Reserva os títulos antes de chamar o Asaas (evita duas cobranças para o mesmo título).
  const { data: reservados } = await sb.from('contas_receber').update({ cobranca_id: cb.id })
    .in('id', ids).is('cobranca_id', null).eq('status', 'aberto').select('id');
  try {
    if ((reservados || []).length !== ids.length) throw new ErroHttp(409, 'Outro usuário gerou cobrança para estes títulos agora há pouco');

    const cfg = configAsaas();
    const customer = await garantirClienteAsaas(sb, cliente);
    const pagamento = await asaas('/payments', {
      metodo: 'POST',
      corpo: {
        customer, billingType: cfg.tipo, value: valor, dueDate: vencimento, description: texto,
        externalReference: `cobranca:${cb.id}`,
        fine: cfg.multa > 0 ? { value: cfg.multa } : undefined,
        interest: cfg.juros > 0 ? { value: cfg.juros } : undefined,
      },
    });
    const extras = await dadosDePagamento(pagamento.id);
    const { data: final } = await sb.from('cobrancas').update({
      asaas_payment_id: pagamento.id, status: statusDoAsaas(pagamento.status),
      link_fatura: pagamento.invoiceUrl || null, link_boleto: pagamento.bankSlipUrl || null, ...extras,
    }).eq('id', cb.id).select().single();
    return final;
  } catch (erro) {
    await sb.from('contas_receber').update({ cobranca_id: null }).eq('cobranca_id', cb.id);
    await sb.from('cobrancas').update({ status: 'erro', erro: String(erro.message || erro).slice(0, 500) }).eq('id', cb.id);
    throw erro;
  }
}

/**
 * Fechamento do crediário: uma cobrança por cliente com todos os títulos em aberto vencendo até `ate`
 * e ainda sem cobrança. Processa no máximo `limite` clientes por chamada (o painel repete até zerar).
 */
export async function cobrarEmLote(sb, usuario, { ate, vencimento, limite = 12, pular = [] }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ate || '')) throw new ErroHttp(400, 'Informe até qual vencimento cobrar');
  // A API devolve no máximo 1000 linhas: clientes que já falharam saem no próprio filtro para não
  // ocuparem esse espaço, e `restantes` só conta o que coube (o painel repete enquanto houver).
  let consulta = sb.from('contas_receber')
    .select('id, cliente_id, clientes!inner(nome, cobranca_ativa)')
    .eq('status', 'aberto').is('cobranca_id', null).lte('vencimento', ate)
    .eq('clientes.cobranca_ativa', true).order('cliente_id').order('id');
  const ignorar = pular.map(Number).filter(Number.isFinite);
  if (ignorar.length) consulta = consulta.not('cliente_id', 'in', `(${ignorar.join(',')})`);
  const { data: contas, error } = await consulta;
  if (error) throw error;

  const porCliente = new Map();
  for (const c of contas) {
    if (!porCliente.has(c.cliente_id)) porCliente.set(c.cliente_id, { nome: c.clientes.nome, titulos: [] });
    porCliente.get(c.cliente_id).titulos.push(c.id);
  }

  const resultados = [];
  for (const [clienteId, g] of [...porCliente].slice(0, limite)) {
    try {
      const cb = await criarCobranca(sb, usuario, { titulos: g.titulos, vencimento });
      resultados.push({ cliente_id: clienteId, nome: g.nome, ok: true, valor: cb.valor });
    } catch (erro) {
      resultados.push({ cliente_id: clienteId, nome: g.nome, ok: false, erro: erro.message });
    }
  }
  return { resultados, restantes: Math.max(porCliente.size - limite, 0) };
}

export async function cancelarCobranca(sb, id) {
  const { data: cb } = await sb.from('cobrancas').select('*').eq('id', id).single();
  if (!cb) throw new ErroHttp(404, 'Cobrança não encontrada');
  if (!['pendente', 'vencida', 'erro'].includes(cb.status)) throw new ErroHttp(400, `Cobrança ${cb.status} não pode ser cancelada`);
  if (cb.asaas_payment_id) await asaas(`/payments/${cb.asaas_payment_id}`, { metodo: 'DELETE' });
  await sb.from('contas_receber').update({ cobranca_id: null }).eq('cobranca_id', cb.id);
  const { data } = await sb.from('cobrancas').update({ status: 'cancelada' }).eq('id', cb.id).select().single();
  return data;
}

/** Aplica no ERP o estado atual de um pagamento do Asaas (webhook ou consulta manual). */
export async function aplicarPagamento(sb, pagamento) {
  const status = statusDoAsaas(pagamento.status);
  const { data: cb } = await sb.from('cobrancas').select('id, status').eq('asaas_payment_id', pagamento.id).maybeSingle();
  if (!cb) return null;

  if (status === 'paga') {
    const { error } = await sb.rpc('confirmar_cobranca_paga', {
      p_asaas_id: pagamento.id,
      p_data: pagamento.clientPaymentDate || pagamento.paymentDate || hojeSP(),
      p_valor_pago: pagamento.value,
      p_valor_liquido: pagamento.netValue ?? null,
      p_tipo: pagamento.billingType || null,
    });
    if (error) throw error;
  } else if (status === 'estornada' && cb.status === 'paga') {
    // Títulos continuam baixados: reabrir é decisão manual (pode ter havido acordo com o cliente).
    await sb.from('cobrancas').update({ status, erro: 'Pagamento estornado no Asaas — verifique se os títulos devem ser reabertos' }).eq('id', cb.id);
  } else if (cb.status !== 'paga' && cb.status !== status) {
    await sb.from('cobrancas').update({ status }).eq('id', cb.id);
  }
  return status;
}

export async function atualizarDoAsaas(sb, id) {
  const { data: cb } = await sb.from('cobrancas').select('asaas_payment_id').eq('id', id).single();
  if (!cb?.asaas_payment_id) throw new ErroHttp(400, 'Cobrança sem vínculo com o Asaas');
  const pagamento = await asaas(`/payments/${cb.asaas_payment_id}`);
  if (pagamento.deleted) {
    await sb.from('contas_receber').update({ cobranca_id: null }).eq('cobranca_id', id);
    await sb.from('cobrancas').update({ status: 'cancelada' }).eq('id', id);
  } else {
    await aplicarPagamento(sb, pagamento);
  }
  const { data } = await sb.from('cobrancas').select('*').eq('id', id).single();
  return data;
}
