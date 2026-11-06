import { createContext, useContext, useEffect, useState } from 'react';

// ---------------------------------------------------------------- rotas (hash: #/caminho?param=valor)
function lerRota() {
  const [caminho, query = ''] = (window.location.hash.slice(1) || '/').split('?');
  return { caminho: caminho || '/', params: Object.fromEntries(new URLSearchParams(query)) };
}

export function navegar(caminho) {
  window.location.hash = caminho;
}

export function useRota() {
  const [rota, setRota] = useState(lerRota);
  useEffect(() => {
    const f = () => setRota(lerRota());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return rota;
}

// ---------------------------------------------------------------- usuário logado
export const PerfilCtx = createContext(null);
export const usePerfil = () => useContext(PerfilCtx);
export const podeFinanceiro = (p) => Boolean(p && ['admin', 'financeiro'].includes(p.papel));
