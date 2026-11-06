#!/usr/bin/env node
// Cria o primeiro usuário administrador (depois disso, use a tela Usuários do ERP).
//   node scripts/criar-admin.mjs email@exemplo.com "SenhaForte123" "Nome Completo"
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const [email, senha, nome] = process.argv.slice(2);
if (!email || !senha || !nome) {
  console.error('Uso: node scripts/criar-admin.mjs <email> <senha> "<nome>"');
  process.exit(1);
}
if (senha.length < 8) {
  console.error('A senha deve ter ao menos 8 caracteres.');
  process.exit(1);
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await sb.auth.admin.createUser({ email, password: senha, email_confirm: true });
if (error) {
  console.error('Erro ao criar usuário:', error.message);
  process.exit(1);
}
const { error: e2 } = await sb.from('perfis').insert({ user_id: data.user.id, nome, papel: 'admin' });
if (e2) {
  console.error('Usuário criado, mas falhou ao gravar o perfil:', e2.message);
  process.exit(1);
}
console.log(`Administrador ${nome} <${email}> criado.`);
