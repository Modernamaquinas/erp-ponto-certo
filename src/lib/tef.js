// Cliente do agente TEF do caixa (Fase 2). Contrato completo em docs/tef-cielo.md.
//
// O navegador não fala com o PinPad: um agente local no PC do caixa (Windows, ao lado do PayGo Web, que já
// atende Cielo, Stone, PagSeguro, Vero e PIX) recebe os pedidos em http://127.0.0.1 e devolve o resultado.
// Com VITE_TEF_MODO=simulador o PDV funciona sem agente (aprova tudo como Cielo), para desenvolvimento e treino.

const URL_AGENTE = (import.meta.env?.VITE_TEF_AGENTE_URL || 'http://127.0.0.1:7171').replace(/\/$/, '');
const SIMULADOR = import.meta.env?.VITE_TEF_MODO === 'simulador';

export const MODALIDADES_PDV = ['debito', 'credito', 'credito_parcelado_loja', 'credito_parcelado_adm', 'pix', 'voucher'];

async function chamar(caminho, corpo, { tempo = 180000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), tempo); // o cliente digita a senha: dá tempo
  try {
    const r = await fetch(`${URL_AGENTE}${caminho}`, {
      method: corpo ? 'POST' : 'GET', signal: ctl.signal,
      headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.mensagem || `Agente TEF respondeu ${r.status}`);
    return json;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('O TEF não respondeu a tempo. Confira o PinPad antes de tentar de novo.');
    if (e instanceof TypeError) throw new Error('Agente TEF não encontrado neste computador. Ele está aberto?');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

let seqSimulador = 0;
function simular(pedido) {
  seqSimulador += 1;
  const nsu = String(Date.now()).slice(-6);
  return {
    id: `sim-${seqSimulador}`, situacao: 'aprovada', rede: pedido.modalidade === 'pix' ? 'SHIPAY' : 'CIELO',
    modalidade: pedido.modalidade, bandeira: pedido.modalidade === 'pix' ? 'PIX' : pedido.modalidade === 'debito' ? 'ELECTRON' : 'VISA',
    parcelas: pedido.parcelas || 1, valor: pedido.valor, nsu, autorizacao: nsu.split('').reverse().join(''),
    cnpj_adquirente: '01027058000191', mensagem: 'SIMULADOR - SEM VALOR', comprovante: `*** SIMULADOR ***\nVALOR R$ ${pedido.valor}`,
  };
}

/** O agente está rodando? { ok, gerenciador, versao, pinpad } */
export async function statusTef() {
  if (SIMULADOR) return { ok: true, gerenciador: 'simulador', pinpad: 'simulado' };
  return chamar('/status', null, { tempo: 5000 });
}

/**
 * Pede o pagamento ao PinPad. Devolve a transação (situacao 'aprovada' | 'nao_concluida').
 * Aprovada fica PENDENTE no gerenciador até confirmarTef(): confirme só depois de gravar a venda/NFC-e,
 * ou desfaça com desfazerTef() se algo falhar — senão o PayGo desfaz sozinho e o cliente é estornado.
 */
export async function pagarTef({ valor, modalidade, parcelas = 1, vendaId, operador }) {
  if (!(valor > 0)) throw new Error('Valor inválido para o TEF.');
  if (!MODALIDADES_PDV.includes(modalidade)) throw new Error(`Modalidade inválida: ${modalidade}`);
  const pedido = { valor: Math.round(valor * 100) / 100, modalidade, parcelas: modalidade.startsWith('credito_parcelado') ? parcelas : 1,
    venda_id: vendaId, operador };
  return SIMULADOR ? simular(pedido) : chamar('/pagamento', pedido);
}

export async function confirmarTef(id) {
  return SIMULADOR ? { ok: true } : chamar('/confirmar', { id }, { tempo: 30000 });
}

export async function desfazerTef(id) {
  return SIMULADOR ? { ok: true } : chamar('/desfazer', { id }, { tempo: 30000 });
}

/** Cancela uma transação já confirmada (o gerenciador pede o cartão/senha do supervisor no PinPad). */
export async function cancelarTef({ nsu, valor, data, rede }) {
  return SIMULADOR ? { ...simular({ valor, modalidade: 'debito' }), operacao: 'cancelamento' } : chamar('/cancelamento', { nsu, valor, data, rede });
}

/** Converte a resposta do agente no registro de tef_transacoes (pdv_registrar_tef). */
export function paraRegistro(t, { vendaId, transacaoOriginalId } = {}) {
  return {
    venda_id: vendaId ?? null, operacao: transacaoOriginalId ? 'cancelamento' : 'venda', situacao: t.situacao,
    gerenciador: SIMULADOR ? 'simulador' : 'paygo', rede: t.rede, modalidade: t.modalidade, bandeira: t.bandeira,
    parcelas: t.parcelas || 1, valor: t.valor, nsu: t.nsu, autorizacao: t.autorizacao, cnpj_adquirente: t.cnpj_adquirente,
    mensagem: t.mensagem, comprovante: t.comprovante, transacao_original_id: transacaoOriginalId ?? null,
  };
}

/** Grava no ERP (qualquer usuário ativo; função security definer no banco). */
export async function registrarTef(supabase, transacao, opcoes) {
  const { data, error } = await supabase.rpc('pdv_registrar_tef', { p: paraRegistro(transacao, opcoes) });
  if (error) throw new Error(error.message);
  return data;
}
