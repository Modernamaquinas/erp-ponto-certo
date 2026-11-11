// Cliente da API da Nuvem Fiscal (OAuth2 client credentials). Usado pelas funções da Vercel e pelo
// script de instalação (scripts/fiscal-configurar.mjs).
//   NUVEMFISCAL_CLIENT_ID / NUVEMFISCAL_CLIENT_SECRET   credenciais (painel Nuvem Fiscal > Credenciais de API)
//   NUVEMFISCAL_API = sandbox | producao                 qual API (a SEFAZ de homologação/produção é escolhida na nota)

const URL_AUTH = 'https://auth.nuvemfiscal.com.br/oauth/token';
const ESCOPOS = process.env.NUVEMFISCAL_ESCOPOS || 'empresa nfce nfe';

export function baseNuvemFiscal() {
  return process.env.NUVEMFISCAL_API === 'sandbox' ? 'https://api.sandbox.nuvemfiscal.com.br' : 'https://api.nuvemfiscal.com.br';
}

export function nuvemFiscalConfigurada() {
  return Boolean(process.env.NUVEMFISCAL_CLIENT_ID && process.env.NUVEMFISCAL_CLIENT_SECRET);
}

let token = null; // { valor, expira }

async function obterToken() {
  if (token && token.expira > Date.now() + 60000) return token.valor;
  if (!nuvemFiscalConfigurada()) throw Object.assign(new Error('Nuvem Fiscal não configurada (NUVEMFISCAL_CLIENT_ID/SECRET)'), { status: 503 });
  const r = await fetch(URL_AUTH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: process.env.NUVEMFISCAL_CLIENT_ID,
      client_secret: process.env.NUVEMFISCAL_CLIENT_SECRET, scope: ESCOPOS }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw Object.assign(new Error(`Nuvem Fiscal recusou as credenciais: ${j.error_description || j.error || r.status}`), { status: 502 });
  token = { valor: j.access_token, expira: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return token.valor;
}

/** Erro da API com a mensagem que a Nuvem Fiscal devolveu. */
export class ErroNuvemFiscal extends Error {
  constructor(status, corpo) {
    const e = corpo?.error || corpo;
    const det = Array.isArray(e?.errors) ? e.errors.map((x) => x.message || x.description || JSON.stringify(x)).join('; ') : '';
    super(`${e?.message || `Nuvem Fiscal respondeu ${status}`}${det ? ` (${det})` : ''}`);
    this.status = status >= 500 ? 502 : 400;
    this.statusOriginal = status;
    this.corpo = corpo;
  }
}

/** Chamada JSON. `binario: true` devolve um Buffer (PDF/XML). */
export async function nuvemFiscal(metodo, caminho, corpo, { binario = false, tentativas = 2 } = {}) {
  const url = `${baseNuvemFiscal()}${caminho}`;
  for (let i = 1; ; i++) {
    const r = await fetch(url, {
      method: metodo,
      headers: { Authorization: `Bearer ${await obterToken()}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    if (r.status === 401 && i < tentativas) { token = null; continue; }
    if (binario && r.ok) return Buffer.from(await r.arrayBuffer());
    const texto = await r.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { json = { message: texto.slice(0, 300) }; }
    if (!r.ok) throw new ErroNuvemFiscal(r.status, json);
    return json;
  }
}
