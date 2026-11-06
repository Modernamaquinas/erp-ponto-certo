import { useState } from 'react';
import { supabase, ou } from '../lib/supabase.js';
import { moeda, data, hoje } from '../lib/formato.js';
import { Pagina, Filtros, Campo, Tabela, Paginacao, useConsulta } from '../componentes/ui.jsx';

const POR_PAGINA = 100;

export default function Caixa() {
  const [f, setF] = useState({ de: hoje(), ate: hoje() });
  const [pagina, setPagina] = useState(1);
  const mudar = (k) => (e) => { setPagina(1); setF({ ...f, [k]: e.target.value }); };
  const periodo = (q) => q.gte('data', f.de).lte('data', f.ate);

  const lista = useConsulta(async () => {
    const de = (pagina - 1) * POR_PAGINA;
    const r = ou(await periodo(supabase.from('caixa_lancamentos').select('*, formas_pagamento(descricao)', { count: 'exact' }))
      .order('data').order('hora').order('id').range(de, de + POR_PAGINA - 1));
    return { dados: r.data, total: r.count };
  }, [f, pagina]);

  // Totais somados no banco (por forma de pagamento)
  const resumo = useConsulta(async () => {
    const r = ou(await periodo(supabase.from('caixa_lancamentos').select('formas_pagamento(descricao), entrada:entrada.sum(), saida:saida.sum()')));
    const formas = r.data.map((x) => ({ forma: x.formas_pagamento?.descricao || 'OUTROS', saldo: Number(x.entrada) - Number(x.saida) }));
    const entradas = r.data.reduce((s, x) => s + Number(x.entrada), 0);
    const saidas = r.data.reduce((s, x) => s + Number(x.saida), 0);
    return { dados: { formas: formas.sort((a, b) => b.saldo - a.saldo), entradas, saidas } };
  }, [f]);
  const t = resumo.dados;

  return (
    <Pagina titulo="Caixa" subtitulo="Lançamentos do caixa do DirectControl (sincronizados)">
      <Filtros>
        <Campo rotulo="De"><input type="date" value={f.de} onChange={mudar('de')} /></Campo>
        <Campo rotulo="Até"><input type="date" value={f.ate} onChange={mudar('ate')} /></Campo>
      </Filtros>
      {t && <>
        <div className="cartoes">
          <div className="cartao"><span className="cartao-rotulo">Entradas</span><strong className="cartao-valor">{moeda(t.entradas)}</strong></div>
          <div className="cartao"><span className="cartao-rotulo">Saídas</span><strong className="cartao-valor">{moeda(t.saidas)}</strong></div>
          <div className="cartao"><span className="cartao-rotulo">Saldo do período</span><strong className="cartao-valor">{moeda(t.entradas - t.saidas)}</strong></div>
        </div>
        {t.formas.length > 0 && (
          <div className="resumo-linha resumo-formas">
            {t.formas.map((x) => <span key={x.forma}>{x.forma}: <strong>{moeda(x.saldo)}</strong></span>)}
          </div>
        )}
      </>}
      <Tabela carregando={lista.carregando} erro={lista.erro} linhas={lista.dados} vazio="Nenhum lançamento no período."
        colunas={[
          { titulo: 'Data', render: (l) => `${data(l.data)} ${l.hora ? l.hora.slice(0, 5) : ''}` },
          { titulo: 'Histórico', campo: 'historico' },
          { titulo: 'Forma', render: (l) => l.formas_pagamento?.descricao },
          { titulo: 'Entrada', alinhar: 'dir', render: (l) => (Number(l.entrada) ? moeda(l.entrada) : '') },
          { titulo: 'Saída', alinhar: 'dir', render: (l) => (Number(l.saida) ? <span className="texto-erro">{moeda(l.saida)}</span> : '') },
          { titulo: 'Usuário', campo: 'usuario' },
        ]} />
      <Paginacao pagina={pagina} total={lista.total} porPagina={POR_PAGINA} aoMudar={setPagina} />
    </Pagina>
  );
}
