import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase.js';
import { useRota, PerfilCtx, podeFinanceiro } from './lib/contexto.js';
import { Aviso } from './componentes/ui.jsx';
import Login from './paginas/Login.jsx';
import Painel from './paginas/Painel.jsx';
import Clientes from './paginas/Clientes.jsx';
import ClienteDetalhe from './paginas/ClienteDetalhe.jsx';
import Produtos from './paginas/Produtos.jsx';
import Fornecedores from './paginas/Fornecedores.jsx';
import Receber from './paginas/Receber.jsx';
import Cobrancas from './paginas/Cobrancas.jsx';
import Pagar from './paginas/Pagar.jsx';
import Caixa from './paginas/Caixa.jsx';
import Cartoes from './paginas/Cartoes.jsx';
import NotasFiscais from './paginas/NotasFiscais.jsx';
import PDV from './paginas/PDV.jsx';
import Orcamentos from './paginas/Orcamentos.jsx';
import PreVenda from './paginas/PreVenda.jsx';
import Etiquetas from './paginas/Etiquetas.jsx';
import Vendas from './paginas/Vendas.jsx';
import Compras from './paginas/Compras.jsx';
import Usuarios from './paginas/Usuarios.jsx';

const MENU = [
  { grupo: 'Geral', itens: [{ rota: '/', rotulo: 'Painel', icone: '◧' }] },
  { grupo: 'Financeiro', fin: true, itens: [
    { rota: '/receber', rotulo: 'Contas a Receber', icone: '↓' },
    { rota: '/cobrancas', rotulo: 'Cobranças Asaas', icone: '◎' },
    { rota: '/pagar', rotulo: 'Contas a Pagar', icone: '↑' },
    { rota: '/caixa', rotulo: 'Caixa', icone: '▤' },
    { rota: '/cartoes', rotulo: 'Cartões e PIX', icone: '▭' },
  ] },
  { grupo: 'Cadastros', itens: [
    { rota: '/clientes', rotulo: 'Clientes', icone: '☺' },
    { rota: '/produtos', rotulo: 'Produtos e Preços', icone: '▦' },
    { rota: '/fornecedores', rotulo: 'Fornecedores', icone: '⛟' },
    { rota: '/etiquetas', rotulo: 'Etiquetas', icone: '▥' },
  ] },
  { grupo: 'Movimento', itens: [
    { rota: '/pdv', rotulo: 'Nova venda (PDV)', icone: '⊕' },
    { rota: '/prevenda', rotulo: 'Pré-venda (celular)', icone: '📱' },
    { rota: '/orcamentos', rotulo: 'Orçamentos', icone: '✎' },
    { rota: '/vendas', rotulo: 'Vendas', icone: '$' },
    { rota: '/compras', rotulo: 'Notas de Compra', icone: '⎘' },
    { rota: '/notas', rotulo: 'Notas Fiscais', icone: '🗎' },
  ] },
  { grupo: 'Sistema', admin: true, itens: [{ rota: '/usuarios', rotulo: 'Usuários', icone: '⚙' }] },
];

function Conteudo({ rota, perfil }) {
  const { caminho, params } = rota;
  const fin = podeFinanceiro(perfil);
  const semAcesso = <Aviso tipo="erro">Seu usuário não tem acesso a esta área.</Aviso>;
  const m = caminho.match(/^\/clientes\/(\d+)$/);
  if (m) return <ClienteDetalhe id={Number(m[1])} />;
  switch (caminho) {
    case '/': return <Painel />;
    case '/clientes': return <Clientes />;
    case '/produtos': return <Produtos />;
    case '/fornecedores': return <Fornecedores />;
    case '/vendas': return <Vendas params={params} />;
    case '/compras': return <Compras />;
    case '/notas': return <NotasFiscais params={params} />;
    case '/pdv': return <PDV params={params} modo="venda" />;
    case '/orcamento': return <PDV params={params} modo="orcamento" />;
    case '/orcamentos': return <Orcamentos />;
    case '/prevenda': return <PreVenda />;
    case '/etiquetas': return <Etiquetas key={`${params.produto}-${params.compra}`} params={params} />;
    case '/operadores': return perfil.papel === 'admin' ? <Usuarios /> : semAcesso;
    case '/receber': return fin ? <Receber params={params} /> : semAcesso;
    case '/cobrancas': return fin ? <Cobrancas params={params} /> : semAcesso;
    case '/pagar': return fin ? <Pagar params={params} /> : semAcesso;
    case '/caixa': return fin ? <Caixa /> : semAcesso;
    case '/cartoes': return fin ? <Cartoes params={params} /> : semAcesso;
    case '/usuarios': return perfil.papel === 'admin' ? <Usuarios /> : semAcesso;
    default: return <Aviso>Página não encontrada.</Aviso>;
  }
}

export default function App() {
  const [sessao, setSessao] = useState(undefined);
  const [perfil, setPerfil] = useState(undefined);
  const [menuAberto, setMenuAberto] = useState(false);
  const rota = useRota();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSessao(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSessao(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!sessao) { setPerfil(sessao === null ? null : undefined); return; }
    supabase.from('perfis').select('*').eq('user_id', sessao.user.id).maybeSingle()
      .then(({ data }) => setPerfil(data && data.ativo ? data : null));
  }, [sessao]);

  useEffect(() => { setMenuAberto(false); }, [rota.caminho]);

  if (sessao === undefined) return <div className="tela-cheia">Carregando…</div>;
  if (!sessao) return <Login />;
  if (perfil === undefined) return <div className="tela-cheia">Carregando…</div>;
  if (perfil === null) {
    return (
      <div className="tela-cheia">
        <Aviso tipo="erro">Usuário sem perfil ativo no ERP. Peça a um administrador para liberar o acesso.</Aviso>
        <button type="button" className="btn btn-sec" onClick={() => supabase.auth.signOut()}>Sair</button>
      </div>
    );
  }

  const ativo = (r) => (r === '/' ? rota.caminho === '/' : rota.caminho.startsWith(r));
  return (
    <PerfilCtx.Provider value={perfil}>
      <div className={`app${menuAberto ? ' menu-aberto' : ''}`}>
        <aside className="lateral">
          <a href="#/" className="lateral-logo"><img src="/logo.png" alt="Ponto Certo Ferragens" /></a>
          <nav>
            {MENU.filter((g) => (!g.fin || podeFinanceiro(perfil)) && (!g.admin || perfil.papel === 'admin')).map((g) => (
              <div key={g.grupo} className="menu-grupo">
                <span className="menu-titulo">{g.grupo}</span>
                {g.itens.map((i) => (
                  <a key={i.rota} href={`#${i.rota}`} className={`menu-item${ativo(i.rota) ? ' ativo' : ''}`}>
                    <span className="menu-icone" aria-hidden="true">{i.icone}</span>{i.rotulo}
                  </a>
                ))}
              </div>
            ))}
          </nav>
          <div className="lateral-rodape">
            <span className="usuario-nome">{perfil.nome}</span>
            <span className="usuario-papel">{perfil.papel}</span>
            <button type="button" className="btn btn-sec btn-peq" onClick={() => supabase.auth.signOut()}>Sair</button>
          </div>
        </aside>
        <div className="principal">
          <header className="barra-movel">
            <button type="button" className="btn-icone" aria-label="Menu" onClick={() => setMenuAberto((v) => !v)}>☰</button>
            <img src="/logo.png" alt="Ponto Certo" />
          </header>
          <main><Conteudo rota={rota} perfil={perfil} /></main>
        </div>
        {menuAberto && <div className="veu" onClick={() => setMenuAberto(false)} />}
      </div>
    </PerfilCtx.Provider>
  );
}
