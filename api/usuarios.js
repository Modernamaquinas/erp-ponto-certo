// GET  /api/usuarios            lista usuários (admin)
// POST /api/usuarios { email, senha, nome, papel }  cria usuário (admin)
import { supabaseServico, exigirUsuario, rota, ErroHttp } from './_lib/supabase.js';

const PAPEIS = ['admin', 'financeiro', 'vendedor'];

export default rota(async (req, res) => {
  await exigirUsuario(req, ['admin']);
  const sb = supabaseServico();

  if (req.method === 'GET') {
    const { data: perfis, error } = await sb.from('perfis').select('*').order('nome');
    if (error) throw error;
    const { data: lista } = await sb.auth.admin.listUsers({ perPage: 200 });
    const emails = new Map((lista?.users || []).map((u) => [u.id, u.email]));
    return res.json({ usuarios: perfis.map((p) => ({ ...p, email: emails.get(p.user_id) || null })) });
  }

  if (req.method === 'POST') {
    const { email, senha, nome, papel } = req.body || {};
    if (!email || !nome) throw new ErroHttp(400, 'Informe nome e e-mail');
    if (!senha || String(senha).length < 8) throw new ErroHttp(400, 'A senha deve ter ao menos 8 caracteres');
    if (!PAPEIS.includes(papel)) throw new ErroHttp(400, 'Papel inválido');
    const { data, error } = await sb.auth.admin.createUser({ email, password: senha, email_confirm: true });
    if (error) throw new ErroHttp(400, error.message);
    const { error: e2 } = await sb.from('perfis').insert({ user_id: data.user.id, nome, papel });
    if (e2) {
      await sb.auth.admin.deleteUser(data.user.id);
      throw e2;
    }
    return res.status(201).json({ ok: true, user_id: data.user.id });
  }

  throw new ErroHttp(405, 'Método não suportado');
});
