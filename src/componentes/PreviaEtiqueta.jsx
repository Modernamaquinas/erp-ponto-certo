import { useMemo } from 'react';
import { textosDaColuna, valoresProduto, medidasModelo, alturaCampo } from '../lib/etiquetas.js';

// Prévia em SVG de uma fileira do rolo (todas as colunas com o mesmo produto). 1 unidade = 0,01".
export default function PreviaEtiqueta({ modelo, campos, produto, opcoes }) {
  const m = useMemo(() => medidasModelo(modelo, campos), [modelo, campos]);
  const valores = valoresProduto(produto, opcoes);
  const larguraTotal = m.passo * m.ncol;
  const alt = m.altura + 4;
  return (
    <svg className="etq-previa" viewBox={`0 0 ${larguraTotal} ${alt}`} role="img" aria-label={`Prévia da etiqueta ${modelo.descricao}`}>
      {Array.from({ length: m.ncol }, (_, k) => (
        <rect key={k} x={k * m.passo + 2} y={1} width={m.passo - 4} height={m.altura} rx={4} className="etq-papel" />
      ))}
      {Array.from({ length: m.ncol }, (_, k) => textosDaColuna(campos.filter((c) => (Number(c.coluna) || 1) === k + 1), valores).map(({ campo: c, texto }) => {
        if (!texto.trim()) return null;
        const x = c.esquerda; const yBase = alt - 3 - c.linha; const h = alturaCampo(c);
        const rot = { 2: 270, 3: 180, 4: 90 }[c.orientacao] || 0;
        if (/^[A-Za-z]$/.test(c.fonte)) {
          const digitos = texto.replace(/^[A-Z]/, '');
          const estreita = (Number(c.mult_v) || 2) / 2.03;
          const largura = (11 * (Math.ceil(digitos.length / 2) + 3) + 2) * estreita;
          const barras = Array.from(digitos + digitos).map((d, i) => ({ x: x + (i / (digitos.length * 2)) * largura, w: estreita * (1 + (Number(d) % 3)) }));
          return (
            <g key={c.id} transform={rot ? `rotate(${rot} ${x} ${yBase})` : undefined}>
              {barras.map((b, i) => <rect key={i} x={b.x} y={yBase - h} width={b.w} height={h - 7} className="etq-tinta" />)}
              {c.fonte === c.fonte.toUpperCase() && <text x={x + largura / 2} y={yBase} fontSize={6} textAnchor="middle" className="etq-texto">{digitos}</text>}
            </g>
          );
        }
        return <text key={c.id} x={x} y={yBase} fontSize={h} className="etq-texto" transform={rot ? `rotate(${rot} ${x} ${yBase})` : undefined}>{texto}</text>;
      }))}
    </svg>
  );
}
