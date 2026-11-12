// Link público e assinado para o cliente baixar o DANFE (PDF) ou o XML de uma nota, sem login no ERP
// (enviado por WhatsApp no fim da venda). HMAC-SHA256 sobre nota + arquivo + validade; sem a assinatura certa,
// ou depois da validade, o link não abre nada. Segredo: LINK_NOTA_SEGREDO, ou derivado da chave de serviço do Supabase.
import { createHmac, timingSafeEqual } from 'node:crypto';

const DIAS_VALIDADE = 60;
const ARQUIVOS = ['danfe', 'xml'];

function segredo() {
  const base = process.env.LINK_NOTA_SEGREDO || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw Object.assign(new Error('Sem segredo para assinar links de nota'), { status: 503 });
  return createHmac('sha256', base).update('pc-link-nota-v1').digest();
}

const assinatura = (id, arquivo, exp) => createHmac('sha256', segredo()).update(`${id}.${arquivo}.${exp}`).digest('base64url');

/** Parâmetros de query do link (sem a origem). */
export function assinarLinkNota(id, arquivo, agora = Date.now()) {
  if (!ARQUIVOS.includes(arquivo)) throw Object.assign(new Error('Arquivo inválido'), { status: 400 });
  const exp = Math.floor(agora / 1000) + DIAS_VALIDADE * 86400;
  return `arquivo=${arquivo}&id=${Number(id)}&exp=${exp}&sig=${assinatura(Number(id), arquivo, exp)}`;
}

/** true se o link é desta nota/arquivo, foi assinado por nós e ainda vale. */
export function linkNotaValido({ id, arquivo, exp, sig }, agora = Date.now()) {
  if (!ARQUIVOS.includes(arquivo) || !/^\d+$/.test(String(id)) || !/^\d+$/.test(String(exp)) || typeof sig !== 'string') return false;
  if (Number(exp) * 1000 < agora) return false;
  const esperado = Buffer.from(assinatura(Number(id), arquivo, Number(exp)));
  const recebido = Buffer.from(sig);
  return esperado.length === recebido.length && timingSafeEqual(esperado, recebido);
}

export const VALIDADE_LINK_DIAS = DIAS_VALIDADE;
