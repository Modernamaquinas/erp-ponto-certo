// Cliente da API Focus NFe v2 (HTTP Basic: token como usuário, senha vazia). Docs: https://doc.focusnfe.com.br
//   FOCUS_TOKEN_HOMOLOGACAO / FOCUS_TOKEN_PRODUCAO  tokens DA EMPRESA (emissão) — Vercel e .env
//   FOCUS_TOKEN                                       token principal da conta (cadastro de empresas) — só .env local

const BASES = { homologacao: 'https://homologacao.focusnfe.com.br', producao: 'https://api.focusnfe.com.br' };

export function tokenEmissao(ambiente) {
  return ambiente === 'producao' ? process.env.FOCUS_TOKEN_PRODUCAO : process.env.FOCUS_TOKEN_HOMOLOGACAO;
}

export function focusConfigurada(ambiente) {
  return Boolean(tokenEmissao(ambiente));
}

/** Erro devolvido pela Focus ({ codigo, mensagem, erros }). */
export class ErroFocus extends Error {
  constructor(status, corpo) {
    const det = Array.isArray(corpo?.erros) ? corpo.erros.map((e) => e.mensagem || e.message || JSON.stringify(e)).join('; ') : '';
    super(`${corpo?.mensagem || `Focus NFe respondeu ${status}`}${det ? ` (${det})` : ''}`);
    this.status = status >= 500 ? 502 : 400;
    this.statusOriginal = status;
    this.codigo = corpo?.codigo;
    this.corpo = corpo;
  }
}

/**
 * @param {'homologacao'|'producao'} ambiente  define URL base e token (a menos que `token` seja passado)
 * @param {object} [op] { token, binario, timeout }
 */
export async function focus(ambiente, metodo, caminho, corpo, { token, binario = false, timeout = 55000 } = {}) {
  const t = token || tokenEmissao(ambiente);
  if (!t) throw Object.assign(new Error(`Focus NFe sem token de ${ambiente} (FOCUS_TOKEN_${ambiente.toUpperCase()})`), { status: 503 });
  const r = await fetch(`${BASES[ambiente]}${caminho}`, {
    method: metodo,
    signal: AbortSignal.timeout(timeout),
    headers: { Authorization: `Basic ${Buffer.from(`${t}:`).toString('base64')}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (binario && r.ok) return { tipo: r.headers.get('content-type') || 'application/octet-stream', dados: Buffer.from(await r.arrayBuffer()) };
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = { mensagem: texto.slice(0, 300) }; }
  if (!r.ok) throw new ErroFocus(r.status, json);
  return json;
}

/** Baixa um arquivo pelo caminho devolvido pela Focus (caminho_danfe, caminho_xml_nota_fiscal…). */
export async function arquivoFocus(ambiente, caminho) {
  if (/^https?:\/\//.test(caminho)) {
    const r = await fetch(caminho, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw Object.assign(new Error(`Arquivo indisponível (${r.status})`), { status: 502 });
    return { tipo: r.headers.get('content-type') || 'application/octet-stream', dados: Buffer.from(await r.arrayBuffer()) };
  }
  return focus(ambiente, 'GET', caminho, null, { binario: true });
}
