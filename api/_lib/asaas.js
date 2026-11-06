// Cliente mínimo da API v3 do Asaas (https://docs.asaas.com).
import { ErroHttp } from './supabase.js';

const BASES = {
  producao: 'https://api.asaas.com/v3',
  sandbox: 'https://api-sandbox.asaas.com/v3',
};

export function configAsaas() {
  const chave = process.env.ASAAS_API_KEY;
  if (!chave) throw new ErroHttp(500, 'ASAAS_API_KEY não configurada');
  return {
    chave,
    base: BASES[process.env.ASAAS_AMBIENTE === 'producao' ? 'producao' : 'sandbox'],
    // BOLETO, PIX ou UNDEFINED (cliente escolhe boleto, PIX ou cartão na fatura)
    tipo: process.env.ASAAS_TIPO_COBRANCA || 'UNDEFINED',
    multa: Number(process.env.ASAAS_MULTA_PERCENTUAL ?? 2),
    juros: Number(process.env.ASAAS_JUROS_MENSAL_PERCENTUAL ?? 1),
  };
}

export async function asaas(caminho, { metodo = 'GET', corpo } = {}) {
  const { chave, base } = configAsaas();
  const resp = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { access_token: chave, 'Content-Type': 'application/json', 'User-Agent': 'erp-ponto-certo' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await resp.text();
  const json = texto ? JSON.parse(texto) : {};
  if (!resp.ok) {
    const msg = json.errors?.map((e) => e.description).join('; ') || `Asaas respondeu ${resp.status}`;
    throw new ErroHttp(resp.status >= 500 ? 502 : 400, `Asaas: ${msg}`);
  }
  return json;
}

/** Garante o cliente no Asaas (reaproveita pelo CPF/CNPJ) e devolve o id `cus_...`. */
export async function garantirClienteAsaas(sb, cliente) {
  if (cliente.asaas_customer_id) return cliente.asaas_customer_id;
  if (!cliente.cpf_cnpj || ![11, 14].includes(cliente.cpf_cnpj.length)) {
    throw new ErroHttp(400, `Cliente ${cliente.id} - ${cliente.nome} está sem CPF/CNPJ válido (obrigatório no Asaas)`);
  }
  const existente = await asaas(`/customers?cpfCnpj=${cliente.cpf_cnpj}`);
  let id = existente.data?.[0]?.id;
  if (!id) {
    const celular = cliente.celular_cobranca || cliente.celular;
    const criado = await asaas('/customers', {
      metodo: 'POST',
      corpo: {
        name: cliente.nome,
        cpfCnpj: cliente.cpf_cnpj,
        email: cliente.email_cobranca || cliente.email || undefined,
        mobilePhone: celular && celular.length >= 10 ? celular : undefined,
        postalCode: cliente.cep || undefined,
        address: cliente.endereco || undefined,
        addressNumber: cliente.numero || undefined,
        complement: cliente.complemento || undefined,
        province: cliente.bairro || undefined,
        externalReference: String(cliente.id),
      },
    });
    id = criado.id;
  }
  await sb.from('clientes').update({ asaas_customer_id: id }).eq('id', cliente.id);
  return id;
}

/** Busca PIX copia-e-cola e linha digitável (nem todo tipo de cobrança tem os dois). */
export async function dadosDePagamento(paymentId) {
  const [pix, boleto] = await Promise.allSettled([
    asaas(`/payments/${paymentId}/pixQrCode`),
    asaas(`/payments/${paymentId}/identificationField`),
  ]);
  return {
    pix_copia_cola: pix.status === 'fulfilled' ? pix.value.payload || null : null,
    linha_digitavel: boleto.status === 'fulfilled' ? boleto.value.identificationField || null : null,
  };
}

const STATUS = {
  PENDING: 'pendente', AWAITING_RISK_ANALYSIS: 'pendente', OVERDUE: 'vencida',
  RECEIVED: 'paga', CONFIRMED: 'paga', RECEIVED_IN_CASH: 'paga',
  REFUNDED: 'estornada', REFUND_REQUESTED: 'estornada', REFUND_IN_PROGRESS: 'estornada',
  CHARGEBACK_REQUESTED: 'estornada', CHARGEBACK_DISPUTE: 'estornada', AWAITING_CHARGEBACK_REVERSAL: 'estornada',
};
export const statusDoAsaas = (s) => STATUS[s] || 'pendente';
