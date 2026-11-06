import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------- dados
/** Executa `buscar()` (async, devolve { dados, total? }) quando `deps` mudam; ignora respostas atrasadas. */
export function useConsulta(buscar, deps) {
  const [estado, setEstado] = useState({ dados: null, total: 0, carregando: true, erro: null });
  const versao = useRef(0);
  const executar = useCallback(async () => {
    const v = ++versao.current;
    setEstado((e) => ({ ...e, carregando: true, erro: null }));
    try {
      const r = await buscar();
      if (v === versao.current) setEstado({ dados: r.dados, total: r.total ?? 0, carregando: false, erro: null });
    } catch (erro) {
      if (v === versao.current) setEstado((e) => ({ ...e, carregando: false, erro: erro.message }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { executar(); }, [executar]);
  return { ...estado, recarregar: executar };
}

/** Valor com atraso (para busca enquanto digita). */
export function useAtrasado(valor, ms = 300) {
  const [v, setV] = useState(valor);
  useEffect(() => { const t = setTimeout(() => setV(valor), ms); return () => clearTimeout(t); }, [valor, ms]);
  return v;
}

// ---------------------------------------------------------------- avisos (toasts)
const AvisosCtx = createContext(() => {});
export const useAvisar = () => useContext(AvisosCtx);

export function ProvedorAvisos({ children }) {
  const [lista, setLista] = useState([]);
  const avisar = useCallback((texto, tipo = 'ok') => {
    const id = Math.random();
    setLista((l) => [...l, { id, texto, tipo }]);
    setTimeout(() => setLista((l) => l.filter((a) => a.id !== id)), tipo === 'erro' ? 8000 : 4000);
  }, []);
  return (
    <AvisosCtx.Provider value={avisar}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {lista.map((a) => <div key={a.id} className={`toast toast-${a.tipo}`}>{a.texto}</div>)}
      </div>
    </AvisosCtx.Provider>
  );
}

// ---------------------------------------------------------------- layout
export function Pagina({ titulo, subtitulo, acoes, children }) {
  return (
    <section className="pagina">
      <header className="pagina-topo">
        <div>
          <h1>{titulo}</h1>
          {subtitulo && <p className="pagina-sub">{subtitulo}</p>}
        </div>
        {acoes && <div className="pagina-acoes">{acoes}</div>}
      </header>
      {children}
    </section>
  );
}

export function Filtros({ children }) {
  return <div className="filtros">{children}</div>;
}

export function Campo({ rotulo, children, largo }) {
  return (
    <label className={`campo${largo ? ' campo-largo' : ''}`}>
      <span>{rotulo}</span>
      {children}
    </label>
  );
}

export function Aviso({ tipo = 'info', children }) {
  return <div className={`aviso aviso-${tipo}`}>{children}</div>;
}

export function Etiqueta({ tipo = 'neutra', children }) {
  return <span className={`etiqueta etiqueta-${tipo}`}>{children}</span>;
}

export function Cartao({ rotulo, valor, detalhe, tipo, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={`cartao${tipo ? ` cartao-${tipo}` : ''}`} onClick={onClick} type={onClick ? 'button' : undefined}>
      <span className="cartao-rotulo">{rotulo}</span>
      <strong className="cartao-valor">{valor}</strong>
      {detalhe && <span className="cartao-detalhe">{detalhe}</span>}
    </Tag>
  );
}

// ---------------------------------------------------------------- tabela
/**
 * colunas: [{ titulo, campo?, render?(linha), alinhar?: 'dir'|'centro', classe? }]
 * selecao: { selecionados: Set, alternar(id), alternarTodos(ids), podeSelecionar?(linha) }
 */
export function Tabela({ colunas, linhas, chave = 'id', aoClicar, selecao, carregando, erro, vazio = 'Nada encontrado.', rodape }) {
  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;
  const selecionaveis = selecao ? (linhas || []).filter((l) => !selecao.podeSelecionar || selecao.podeSelecionar(l)) : [];
  const todos = selecao && selecionaveis.length > 0 && selecionaveis.every((l) => selecao.selecionados.has(l[chave]));
  return (
    <div className={`tabela-caixa${carregando ? ' carregando' : ''}`}>
      <table className="tabela">
        <thead>
          <tr>
            {selecao && (
              <th className="col-sel">
                <input type="checkbox" aria-label="Selecionar todos" checked={todos}
                  onChange={() => selecao.alternarTodos(selecionaveis.map((l) => l[chave]), !todos)} />
              </th>
            )}
            {colunas.map((c, i) => <th key={i} className={c.alinhar ? `al-${c.alinhar}` : undefined}>{c.titulo}</th>)}
          </tr>
        </thead>
        <tbody>
          {(linhas || []).map((l) => {
            const pode = selecao && (!selecao.podeSelecionar || selecao.podeSelecionar(l));
            return (
              <tr key={l[chave]} onClick={aoClicar ? () => aoClicar(l) : undefined} className={aoClicar ? 'clicavel' : undefined}>
                {selecao && (
                  <td className="col-sel" onClick={(e) => e.stopPropagation()}>
                    {pode && <input type="checkbox" aria-label="Selecionar" checked={selecao.selecionados.has(l[chave])} onChange={() => selecao.alternar(l[chave])} />}
                  </td>
                )}
                {colunas.map((c, i) => (
                  <td key={i} className={[c.alinhar && `al-${c.alinhar}`, c.classe].filter(Boolean).join(' ') || undefined}>
                    {c.render ? c.render(l) : l[c.campo]}
                  </td>
                ))}
              </tr>
            );
          })}
          {!carregando && linhas && linhas.length === 0 && (
            <tr><td colSpan={colunas.length + (selecao ? 1 : 0)} className="tabela-vazia">{vazio}</td></tr>
          )}
          {!linhas && carregando && (
            <tr><td colSpan={colunas.length + (selecao ? 1 : 0)} className="tabela-vazia">Carregando…</td></tr>
          )}
        </tbody>
        {rodape && <tfoot>{rodape}</tfoot>}
      </table>
    </div>
  );
}

export function useSelecao() {
  const [selecionados, setSel] = useState(() => new Set());
  return {
    selecionados,
    alternar: (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }),
    alternarTodos: (ids, marcar) => setSel((s) => { const n = new Set(s); ids.forEach((id) => (marcar ? n.add(id) : n.delete(id))); return n; }),
    limpar: () => setSel(new Set()),
  };
}

export function Paginacao({ pagina, total, porPagina, aoMudar }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (total <= porPagina) return total ? <p className="paginacao-info">{total} registro(s)</p> : null;
  return (
    <nav className="paginacao" aria-label="Paginação">
      <button type="button" className="btn btn-sec" disabled={pagina <= 1} onClick={() => aoMudar(pagina - 1)}>‹ Anterior</button>
      <span>Página {pagina} de {paginas} · {total} registros</span>
      <button type="button" className="btn btn-sec" disabled={pagina >= paginas} onClick={() => aoMudar(pagina + 1)}>Próxima ›</button>
    </nav>
  );
}

// ---------------------------------------------------------------- modal
export function Modal({ titulo, aberto, aoFechar, children, rodape, largo }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);
  return (
    <dialog ref={ref} className={`modal${largo ? ' modal-largo' : ''}`} onCancel={(e) => { e.preventDefault(); aoFechar(); }}>
      {aberto && (
        <>
          <header className="modal-topo">
            <h2>{titulo}</h2>
            <button type="button" className="btn-icone" aria-label="Fechar" onClick={aoFechar}>×</button>
          </header>
          <div className="modal-corpo">{children}</div>
          {rodape && <footer className="modal-rodape">{rodape}</footer>}
        </>
      )}
    </dialog>
  );
}

export function Detalhes({ itens }) {
  return (
    <dl className="detalhes">
      {itens.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (
        <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
      ))}
    </dl>
  );
}
