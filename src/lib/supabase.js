import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

/** Chama uma função do /api com o token do usuário logado. Lança Error com a mensagem do servidor. */
export async function api(caminho, { metodo = 'POST', corpo } = {}) {
  const { data } = await supabase.auth.getSession();
  const resp = await fetch(`/api/${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(json.erro || `Erro ${resp.status}`);
  return json;
}

/** Lança o erro do Supabase (para usar com try/catch e mostrar a mensagem). */
export function ou(resultado) {
  if (resultado.error) throw new Error(resultado.error.message);
  return resultado;
}
