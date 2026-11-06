import { useState } from 'react';
import { supabase, api, ou } from '../lib/supabase.js';
import { dataHora } from '../lib/formato.js';
import { usePerfil } from '../lib/contexto.js';
import { Pagina, Campo, Tabela, Modal, Etiqueta, useConsulta, useAvisar } from '../componentes/ui.jsx';

const PAPEIS = { admin: 'Administrador', financeiro: 'Financeiro', vendedor: 'Vendedor (consulta)' };

export default function Usuarios() {
  const eu = usePerfil();
  const avisar = useAvisar();
  const [novo, setNovo] = useState(null);
  const lista = useConsulta(async () => ({ dados: (await api('usuarios', { metodo: 'GET' })).usuarios }), []);

  async function alterar(u, campos) {
    try {
      ou(await supabase.from('perfis').update(campos).eq('user_id', u.user_id));
      lista.recarregar();
    } catch (e) {
      avisar(e.message, 'erro');
    }
  }

  async function criar(e) {
    e.preventDefault();
    try {
      await api('usuarios', { corpo: novo });
      avisar('Usuário criado.');
      setNovo(null);
      lista.recarregar();
    } catch (erro) {
      avisar(erro.message, 'erro');
    }
  }

  return (
    <Pagina titulo="Usuários" acoes={<button type="button" className="btn btn-pri" onClick={() => setNovo({ nome: '', email: '', senha: '', papel: 'vendedor' })}>Novo usuário</button>}>
      <Tabela carregando={lista.carregando} erro={lista.erro} linhas={lista.dados} chave="user_id"
        colunas={[
          { titulo: 'Nome', campo: 'nome' },
          { titulo: 'E-mail', campo: 'email' },
          { titulo: 'Papel', render: (u) => (
            <select value={u.papel} disabled={u.user_id === eu.user_id} onChange={(e) => alterar(u, { papel: e.target.value })}>
              {Object.entries(PAPEIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>) },
          { titulo: 'Situação', render: (u) => (u.ativo ? <Etiqueta tipo="ok">Ativo</Etiqueta> : <Etiqueta>Inativo</Etiqueta>) },
          { titulo: 'Desde', render: (u) => dataHora(u.criado_em) },
          { titulo: '', render: (u) => u.user_id !== eu.user_id && (
            <button type="button" className="btn btn-sec btn-peq" onClick={() => alterar(u, { ativo: !u.ativo })}>{u.ativo ? 'Desativar' : 'Reativar'}</button>) },
        ]} />
      {novo && (
        <Modal aberto titulo="Novo usuário" aoFechar={() => setNovo(null)}
          rodape={<><button type="button" className="btn btn-sec" onClick={() => setNovo(null)}>Cancelar</button>
            <button type="submit" form="form-usuario" className="btn btn-pri">Criar</button></>}>
          <form id="form-usuario" className="form-grade" onSubmit={criar}>
            <Campo rotulo="Nome" largo><input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} required /></Campo>
            <Campo rotulo="E-mail" largo><input type="email" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} required /></Campo>
            <Campo rotulo="Senha inicial (mín. 8)"><input type="password" minLength={8} value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} required /></Campo>
            <Campo rotulo="Papel">
              <select value={novo.papel} onChange={(e) => setNovo({ ...novo, papel: e.target.value })}>
                {Object.entries(PAPEIS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Campo>
          </form>
        </Modal>
      )}
    </Pagina>
  );
}
