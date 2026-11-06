// Webhook do Asaas (configurar em Asaas > Integrações > Webhooks, URL https://SEUDOMINIO/api/asaas-webhook,
// com o mesmo token de ASAAS_WEBHOOK_TOKEN). Responde 200 sempre que o evento foi registrado, para o
// Asaas não pausar a fila; erros de processamento ficam em asaas_eventos.erro.
import { supabaseServico } from './_lib/supabase.js';
import { aplicarPagamento } from './_lib/cobrancas.js';
import { timingSafeEqual } from 'node:crypto';

export const config = { maxDuration: 30 };

function tokenValido(recebido) {
  const esperado = process.env.ASAAS_WEBHOOK_TOKEN || '';
  if (!esperado || !recebido) return false;
  const a = Buffer.from(String(recebido));
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  if (!tokenValido(req.headers['asaas-access-token'])) return res.status(401).json({ erro: 'token inválido' });

  const evento = req.body || {};
  const sb = supabaseServico();
  const pagamento = evento.payment;

  const { data: registro, error } = await sb.from('asaas_eventos')
    .insert({ evento_id: evento.id || null, evento: evento.event || '?', payment_id: pagamento?.id || null, payload: evento })
    .select('id').single();
  if (error) {
    if (error.code === '23505') return res.status(200).json({ ok: true, duplicado: true });
    console.error(error);
    return res.status(500).json({ erro: 'falha ao registrar evento' });
  }

  try {
    if (pagamento && /^PAYMENT_/.test(evento.event || '')) {
      if (evento.event === 'PAYMENT_DELETED') {
        const { data: cb } = await sb.from('cobrancas').select('id, status').eq('asaas_payment_id', pagamento.id).maybeSingle();
        if (cb && cb.status !== 'paga') {
          await sb.from('contas_receber').update({ cobranca_id: null }).eq('cobranca_id', cb.id);
          await sb.from('cobrancas').update({ status: 'cancelada' }).eq('id', cb.id);
        }
      } else {
        await aplicarPagamento(sb, pagamento);
      }
    }
    await sb.from('asaas_eventos').update({ processado: true }).eq('id', registro.id);
  } catch (erro) {
    console.error(erro);
    await sb.from('asaas_eventos').update({ erro: String(erro.message || erro).slice(0, 1000) }).eq('id', registro.id);
  }
  return res.status(200).json({ ok: true });
}
