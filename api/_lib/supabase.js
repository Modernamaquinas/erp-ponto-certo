import { createClient } from '@supabase/supabase-js';

let cliente = null;

/** Cliente com service role (ignora RLS) — só no servidor. */
export function supabaseServico() {
  if (!cliente) {
    const url = process.env.SUPABASE_URL;
    const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !chave) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados');
    cliente = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return cliente;
}

export class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

/** Valida o token do usuário logado (Authorization: Bearer) e o papel dele em `perfis`. */
export async function exigirUsuario(req, papeis = ['admin', 'financeiro']) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new ErroHttp(401, 'Não autenticado');
  const sb = supabaseServico();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) throw new ErroHttp(401, 'Sessão inválida ou expirada');
  const { data: perfil } = await sb.from('perfis').select('nome, papel, ativo').eq('user_id', data.user.id).maybeSingle();
  if (!perfil?.ativo || !papeis.includes(perfil.papel)) throw new ErroHttp(403, 'Sem permissão para esta operação');
  return { id: data.user.id, email: data.user.email, ...perfil };
}

/** Envolve um handler: converte ErroHttp/erros em JSON. */
export function rota(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (erro) {
      const status = erro.status || 500;
      if (status >= 500) console.error(erro);
      res.status(status).json({ erro: erro.message || 'Erro interno' });
    }
  };
}
