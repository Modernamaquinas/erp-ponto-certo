// Campos fiscais com busca, para a entrada de notas (e o cadastro de produtos): NCM (tabela oficial + o que o cadastro já usa
// para aquele NCM), CEST, CFOP, CSOSN e origem. Cada campo é um input + botão 🔍 que abre a lista filtrável.
import { useEffect, useState } from 'react';
import { supabase, ou } from '../lib/supabase.js';
import { CFOPS, CSOSNS, ORIGENS, filtrarTabela, carregarNcm, formatarNcm, descricao } from '../lib/fiscalTabelas.js';
import { Modal, Aviso } from './ui.jsx';

function ListaEscolha({ titulo, carregar, aoEscolher, aoFechar, inicial = '', extra }) {
  const [termo, setTermo] = useState(inicial);
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    let vivo = true;
    const h = setTimeout(() => { carregar(termo).then((l) => vivo && setLista(l)).catch((e) => vivo && setErro(e.message)); }, 150);
    return () => { vivo = false; clearTimeout(h); };
  }, [termo]);
  return (
    <Modal aberto largo titulo={titulo} aoFechar={aoFechar}>
      <input className="fiscal-busca" autoFocus value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Código ou palavras da descrição" />
      {extra}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {!lista ? <p className="texto-fraco">Carregando…</p> : !lista.length ? <p className="texto-fraco">Nada encontrado.</p> : (
        <ul className="fiscal-lista">
          {lista.map(([c, d]) => (
            <li key={c}><button type="button" onClick={() => aoEscolher(c)}><strong>{c}</strong><span>{d}</span></button></li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Sugestões do próprio cadastro para um NCM (CEST/CSOSN/CFOP que os produtos da loja já usam). */
export function useSugestoesNcm(ncm) {
  const [s, setS] = useState([]);
  useEffect(() => {
    if (!/^\d{8}$/.test(ncm || '')) { setS([]); return; }
    let vivo = true;
    supabase.rpc('fiscal_sugestoes_ncm', { p_ncm: ncm }).then(({ data }) => vivo && setS(data || []));
    return () => { vivo = false; };
  }, [ncm]);
  return s;
}

export function CampoNcm({ valor, aoMudar, rotulo = 'NCM', invalido }) {
  const [aberto, setAberto] = useState(false);
  const [desc, setDesc] = useState('');
  useEffect(() => {
    let vivo = true;
    if (/^\d{8}$/.test(valor || '')) carregarNcm().then((t) => { if (vivo) setDesc(t.itens.find(([c]) => c === valor)?.[1] || 'NCM não existe na tabela vigente'); }).catch(() => {});
    else setDesc('');
    return () => { vivo = false; };
  }, [valor]);
  const inexistente = desc === 'NCM não existe na tabela vigente';
  return (
    <label className="campo fiscal-campo">
      <span>{rotulo}</span>
      <span className="fiscal-input">
        <input value={valor || ''} inputMode="numeric" maxLength={10} className={invalido || inexistente ? 'input-erro' : ''}
          onChange={(e) => aoMudar(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="00000000" />
        <button type="button" className="btn btn-sec btn-peq" title="Buscar NCM" onClick={() => setAberto(true)}>🔍</button>
      </span>
      {desc && <small className={`fiscal-desc${inexistente ? ' texto-erro' : ''}`} title={desc}>{desc}</small>}
      {aberto && (
        <ListaEscolha titulo="Buscar NCM (tabela oficial vigente)" inicial={valor || ''} aoFechar={() => setAberto(false)}
          aoEscolher={(c) => { aoMudar(c.replace(/\D/g, '')); setAberto(false); }}
          carregar={async (t) => { const tab = await carregarNcm(); return filtrarTabela(tab.itens, t, 80).map(([c, d]) => [formatarNcm(c), d]); }} />
      )}
    </label>
  );
}

export function CampoCfop({ valor, aoMudar, rotulo = 'CFOP', tipo }) {
  const [aberto, setAberto] = useState(false);
  const base = tipo === 'saida' ? CFOPS.filter(([c]) => /^[567]/.test(c)) : tipo === 'entrada' ? CFOPS.filter(([c]) => /^[123]/.test(c)) : CFOPS;
  const d = descricao(CFOPS, valor);
  return (
    <label className="campo fiscal-campo">
      <span>{rotulo}</span>
      <span className="fiscal-input">
        <input value={valor ?? ''} inputMode="numeric" maxLength={4} onChange={(e) => aoMudar(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="5102" />
        <button type="button" className="btn btn-sec btn-peq" title="Buscar CFOP" onClick={() => setAberto(true)}>🔍</button>
      </span>
      {d && <small className="fiscal-desc">{d}</small>}
      {aberto && <ListaEscolha titulo="Buscar CFOP" aoFechar={() => setAberto(false)} aoEscolher={(c) => { aoMudar(c); setAberto(false); }}
        carregar={async (t) => filtrarTabela(base, t, 80)} />}
    </label>
  );
}

export function CampoCsosn({ valor, aoMudar, rotulo = 'CSOSN (Simples)' }) {
  return (
    <label className="campo fiscal-campo">
      <span>{rotulo}</span>
      <select value={valor || ''} onChange={(e) => aoMudar(e.target.value)}>
        <option value="">—</option>
        {CSOSNS.map(([c, d]) => <option key={c} value={c}>{c} — {d}</option>)}
      </select>
    </label>
  );
}

export function CampoOrigem({ valor, aoMudar, rotulo = 'Origem' }) {
  return (
    <label className="campo fiscal-campo">
      <span>{rotulo}</span>
      <select value={String(valor ?? '0')} onChange={(e) => aoMudar(Number(e.target.value))}>
        {ORIGENS.map(([c, d]) => <option key={c} value={c}>{c} — {d}</option>)}
      </select>
    </label>
  );
}

/** CEST com as sugestões do cadastro para o NCM informado. */
export function CampoCest({ valor, aoMudar, ncm, rotulo = 'CEST' }) {
  const sug = useSugestoesNcm(ncm);
  const cests = [...new Set(sug.map((s) => s.cest).filter(Boolean))];
  return (
    <label className="campo fiscal-campo">
      <span>{rotulo}</span>
      <input value={valor || ''} inputMode="numeric" maxLength={9} list={`cest-${ncm}`} onChange={(e) => aoMudar(e.target.value.replace(/\D/g, '').slice(0, 7))} placeholder="(se houver ST)" />
      <datalist id={`cest-${ncm}`}>{cests.map((c) => <option key={c} value={c}>usado no cadastro</option>)}</datalist>
      {cests.length > 0 && !valor && <small className="fiscal-desc">cadastro usa: {cests.join(', ')}</small>}
    </label>
  );
}

/** Quadro "o seu cadastro já usa": para o NCM, combinações CEST/CSOSN/CFOP mais comuns, com botão para aplicar. */
export function SugestoesCadastro({ ncm, aoAplicar }) {
  const sug = useSugestoesNcm(ncm);
  if (!sug.length) return null;
  return (
    <div className="fiscal-sugestoes">
      <span className="texto-fraco">O cadastro da loja usa para o NCM {formatarNcm(ncm)}:</span>
      {sug.slice(0, 4).map((s, i) => (
        <button key={i} type="button" className="btn btn-sec btn-peq" title={`ex.: ${s.exemplo}`} onClick={() => aoAplicar({ cest: s.cest || '', cst_csosn: s.cst_csosn, cfop: s.cfop })}>
          CSOSN {s.cst_csosn || '—'} · CFOP {s.cfop || '—'}{s.cest ? ` · CEST ${s.cest}` : ''} <small>({s.produtos})</small>
        </button>
      ))}
    </div>
  );
}
