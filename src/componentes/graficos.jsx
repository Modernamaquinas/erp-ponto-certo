// Gráficos dos relatórios, sem biblioteca: colunas (série no tempo), colunas duplas (entradas x saídas) e barras horizontais
// (participação por categoria). Uma cor por série, dica ao passar o mouse/foco, e "Ver tabela" em todos (acessível e
// para conferir números). Cores vêm dos tokens do styles.css, então seguem o tema claro/escuro.
import { useState } from 'react';
import { moeda } from '../lib/formato.js';

const compacto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
export const valorCurto = (v) => compacto.format(Number(v || 0));

function Moldura({ titulo, subtitulo, tabela, children, legenda }) {
  const [verTabela, setVerTabela] = useState(false);
  return (
    <div className="grafico">
      <div className="grafico-topo">
        <div><h2>{titulo}</h2>{subtitulo && <p className="texto-fraco grafico-sub">{subtitulo}</p>}</div>
        <div className="grafico-acoes">
          {legenda}
          {tabela && <button type="button" className="btn btn-sec btn-peq" onClick={() => setVerTabela((v) => !v)}>{verTabela ? 'Ver gráfico' : 'Ver tabela'}</button>}
        </div>
      </div>
      {verTabela ? tabela : children}
    </div>
  );
}

function TabelaSimples({ colunas, linhas }) {
  return (
    <div className="tabela-caixa">
      <table className="tabela tabela-compacta">
        <thead><tr>{colunas.map((c, i) => <th key={i} className={i ? 'al-dir' : undefined}>{c}</th>)}</tr></thead>
        <tbody>{linhas.map((l, i) => <tr key={i}>{l.map((v, j) => <td key={j} className={j ? 'al-dir' : undefined}>{v}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/**
 * Colunas verticais. dados: [{ rotulo, valor, dica?: [linhas] }]. Rotula só o maior e o último (não um número em cada barra).
 * formatar: valor -> texto da dica/tabela (padrão moeda).
 */
export function Colunas({ titulo, subtitulo, dados, formatar = moeda, rotuloTabela = 'Valor', cor = 'marca' }) {
  const [foco, setFoco] = useState(null);
  if (!dados?.length) return <Moldura titulo={titulo}><p className="texto-fraco">Sem dados no período.</p></Moldura>;
  const max = Math.max(...dados.map((d) => Number(d.valor)), 0) || 1;
  const maior = dados.reduce((im, d, i) => (Number(d.valor) > Number(dados[im].valor) ? i : im), 0);
  const passo = Math.ceil(dados.length / 16); // com muitas colunas, mostra um rótulo do eixo a cada N
  return (
    <Moldura titulo={titulo} subtitulo={subtitulo}
      tabela={<TabelaSimples colunas={['', rotuloTabela]} linhas={dados.map((d) => [d.rotulo, formatar(d.valor)])} />}>
      <div className={`barras barras-${cor}`} role="img" aria-label={`${titulo}; maior: ${dados[maior].rotulo}, ${formatar(dados[maior].valor)}`}>
        {dados.map((d, i) => {
          const altura = (Math.max(Number(d.valor), 0) / max) * 100;
          const rotulado = (i === maior || i === dados.length - 1) && Number(d.valor) > 0;
          return (
            <button key={i} type="button" className={`barra-col${foco === i ? ' foco' : ''}`}
              onMouseEnter={() => setFoco(i)} onMouseLeave={() => setFoco(null)} onFocus={() => setFoco(i)} onBlur={() => setFoco(null)}
              aria-label={`${d.rotulo}: ${formatar(d.valor)}`}>
              <span className="barra-area">
                {rotulado && <span className="barra-valor" style={{ bottom: `${altura}%` }}>{valorCurto(d.valor)}</span>}
                <span className="barra" style={{ height: `${Math.max(altura, Number(d.valor) > 0 ? 0.8 : 0)}%` }} />
                {foco === i && (
                  <span className="dica" role="tooltip"><strong>{d.rotulo}</strong><span>{formatar(d.valor)}</span>
                    {(d.dica || []).map((t, k) => <span key={k}>{t}</span>)}</span>
                )}
              </span>
              <span className="barra-mes">{i % passo === 0 || i === dados.length - 1 ? d.rotulo : ''}</span>
            </button>
          );
        })}
      </div>
    </Moldura>
  );
}

/** Duas séries lado a lado (ex.: entradas x saídas). dados: [{ rotulo, a, b }]; nomes: [nomeA, nomeB]. */
export function ColunasDuplas({ titulo, subtitulo, dados, nomes, formatar = moeda }) {
  const [foco, setFoco] = useState(null);
  if (!dados?.length) return <Moldura titulo={titulo}><p className="texto-fraco">Sem dados no período.</p></Moldura>;
  const max = Math.max(...dados.flatMap((d) => [Number(d.a), Number(d.b)]), 0) || 1;
  const passo = Math.ceil(dados.length / 12);
  const legenda = (
    <span className="legenda">
      <span><i className="leg leg-a" />{nomes[0]}</span><span><i className="leg leg-b" />{nomes[1]}</span>
    </span>
  );
  return (
    <Moldura titulo={titulo} subtitulo={subtitulo} legenda={legenda}
      tabela={<TabelaSimples colunas={['', nomes[0], nomes[1], 'Saldo']} linhas={dados.map((d) => [d.rotulo, formatar(d.a), formatar(d.b), formatar(Number(d.a) - Number(d.b))])} />}>
      <div className="barras" role="img" aria-label={titulo}>
        {dados.map((d, i) => (
          <button key={i} type="button" className={`barra-col${foco === i ? ' foco' : ''}`}
            onMouseEnter={() => setFoco(i)} onMouseLeave={() => setFoco(null)} onFocus={() => setFoco(i)} onBlur={() => setFoco(null)}
            aria-label={`${d.rotulo}: ${nomes[0]} ${formatar(d.a)}, ${nomes[1]} ${formatar(d.b)}`}>
            <span className="barra-area barra-dupla">
              <span className="barra barra-a" style={{ height: `${(Math.max(Number(d.a), 0) / max) * 100}%` }} />
              <span className="barra barra-b" style={{ height: `${(Math.max(Number(d.b), 0) / max) * 100}%` }} />
              {foco === i && (
                <span className="dica" role="tooltip"><strong>{d.rotulo}</strong>
                  <span>{nomes[0]}: {formatar(d.a)}</span><span>{nomes[1]}: {formatar(d.b)}</span>
                  <span>Saldo: {formatar(Number(d.a) - Number(d.b))}</span></span>
              )}
            </span>
            <span className="barra-mes">{i % passo === 0 || i === dados.length - 1 ? d.rotulo : ''}</span>
          </button>
        ))}
      </div>
    </Moldura>
  );
}

/**
 * Barras horizontais com rótulo, valor e % do total (formas de pagamento, grupos, faixas de atraso…).
 * dados: [{ rotulo, valor, detalhe?, tom?: 'erro'|'ok'|'info' }]. O valor e o % ficam escritos: a cor não carrega informação sozinha.
 */
export function BarrasH({ titulo, subtitulo, dados, formatar = moeda, mostrarPct = true, limite = 12 }) {
  if (!dados?.length) return <Moldura titulo={titulo}><p className="texto-fraco">Sem dados no período.</p></Moldura>;
  const lista = dados.slice(0, limite);
  const resto = dados.slice(limite);
  if (resto.length) lista.push({ rotulo: `Outros (${resto.length})`, valor: resto.reduce((s, d) => s + Number(d.valor), 0) });
  const total = dados.reduce((s, d) => s + Math.max(Number(d.valor), 0), 0) || 1;
  const max = Math.max(...lista.map((d) => Number(d.valor)), 0) || 1;
  return (
    <Moldura titulo={titulo} subtitulo={subtitulo}
      tabela={<TabelaSimples colunas={['', 'Valor', ...(mostrarPct ? ['%'] : [])]}
        linhas={dados.map((d) => [d.rotulo, formatar(d.valor), ...(mostrarPct ? [`${((Number(d.valor) / total) * 100).toFixed(1).replace('.', ',')}%`] : [])])} />}>
      <div className="barras-h">
        {lista.map((d, i) => (
          <div key={i} className="bh-linha" title={d.detalhe || undefined}>
            <span className="bh-rotulo">{d.rotulo}</span>
            <span className="bh-trilho"><span className={`bh-barra${d.tom ? ` tom-${d.tom}` : ''}`} style={{ width: `${(Math.max(Number(d.valor), 0) / max) * 100}%` }} /></span>
            <span className="bh-valor">{formatar(d.valor)}{mostrarPct && <small>{((Number(d.valor) / total) * 100).toFixed(1).replace('.', ',')}%</small>}</span>
            {d.detalhe && <span className="bh-detalhe">{d.detalhe}</span>}
          </div>
        ))}
      </div>
    </Moldura>
  );
}

/** Indicador grande com comparação ao período anterior (▲/▼ + %). inverter: queda é boa (ex.: atraso). */
export function Indicador({ rotulo, valor, anterior, formatar = moeda, detalhe, tom, inverter }) {
  let delta = null;
  if (anterior !== undefined && anterior !== null && Number(anterior) !== 0) {
    const pct = ((Number(valor) - Number(anterior)) / Math.abs(Number(anterior))) * 100;
    const bom = inverter ? pct < 0 : pct > 0;
    delta = <span className={`ind-delta ${Math.abs(pct) < 0.05 ? '' : bom ? 'bom' : 'ruim'}`}>{pct >= 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1).replace('.', ',')}% <small>vs. período anterior</small></span>;
  }
  return (
    <div className={`indicador${tom ? ` ind-${tom}` : ''}`}>
      <span className="ind-rotulo">{rotulo}</span>
      <strong className="ind-valor">{formatar(valor)}</strong>
      {delta}
      {detalhe && <span className="ind-detalhe">{detalhe}</span>}
    </div>
  );
}
