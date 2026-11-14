import { useState } from 'react';
import { supabase, ou } from '../lib/supabase.js';
import { moeda, dataHora } from '../lib/formato.js';
import { Pagina, Cartao, Aviso, useConsulta } from '../componentes/ui.jsx';
import { navegar, usePerfil, podeFinanceiro } from '../lib/contexto.js';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const rotuloMes = (iso) => `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;
const compacto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });

/** Barras de vendas por mês: série única (sem legenda), dica ao passar o mouse/foco e visão em tabela. */
function GraficoVendas({ meses }) {
  const [foco, setFoco] = useState(null);
  const [tabela, setTabela] = useState(false);
  const max = Math.max(...meses.map((m) => Number(m.total)), 1);
  const ultimo = meses.length - 1;
  const maior = meses.reduce((im, m, i) => (Number(m.total) > Number(meses[im].total) ? i : im), 0);

  return (
    <div className="grafico">
      <div className="grafico-topo">
        <h2>Vendas finalizadas por mês</h2>
        <button type="button" className="btn btn-sec btn-peq" onClick={() => setTabela((v) => !v)}>
          {tabela ? 'Ver gráfico' : 'Ver tabela'}
        </button>
      </div>
      {tabela ? (
        <table className="tabela tabela-compacta">
          <thead><tr><th>Mês</th><th className="al-dir">Vendas</th><th className="al-dir">Total</th></tr></thead>
          <tbody>{meses.map((m) => (
            <tr key={m.mes}><td>{rotuloMes(m.mes)}</td><td className="al-dir">{m.qtd}</td><td className="al-dir">{moeda(m.total)}</td></tr>
          ))}</tbody>
        </table>
      ) : (
        <div className="barras" role="img" aria-label={`Vendas por mês; maior mês ${rotuloMes(meses[maior].mes)} com ${moeda(meses[maior].total)}`}>
          {meses.map((m, i) => {
            const altura = (Number(m.total) / max) * 100;
            const rotulado = i === ultimo || i === maior;
            return (
              <button key={m.mes} type="button" className={`barra-col${foco === i ? ' foco' : ''}`}
                onMouseEnter={() => setFoco(i)} onMouseLeave={() => setFoco(null)}
                onFocus={() => setFoco(i)} onBlur={() => setFoco(null)}
                aria-label={`${rotuloMes(m.mes)}: ${moeda(m.total)} em ${m.qtd} vendas`}>
                <span className="barra-area">
                  {rotulado && <span className="barra-valor" style={{ bottom: `${altura}%` }}>{compacto.format(Number(m.total))}</span>}
                  <span className="barra" style={{ height: `${Math.max(altura, 0.5)}%` }} />
                  {foco === i && (
                    <span className="dica" role="tooltip">
                      <strong>{rotuloMes(m.mes)}</strong>
                      <span>{moeda(m.total)}</span>
                      <span>{m.qtd} vendas · ticket {moeda(Number(m.total) / Math.max(Number(m.qtd), 1))}</span>
                    </span>
                  )}
                </span>
                <span className="barra-mes">{rotuloMes(m.mes)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Atalho grande para a pré-venda: só aparece no celular (CSS .so-celular), já no carregamento do painel. */
const BotaoPreVenda = () => (
  <a className="btn btn-pri btn-prevenda so-celular" href="#/prevenda">📱 Pré-venda</a>
);

export default function Painel() {
  const perfil = usePerfil();
  const fin = podeFinanceiro(perfil);
  const { dados, erro } = useConsulta(async () => {
    const [{ data: resumo }, { data: meses }] = await Promise.all([
      supabase.rpc('resumo_painel').then(ou),
      supabase.rpc('vendas_por_mes', { p_meses: 12 }).then(ou),
    ]);
    return { dados: { r: resumo, meses } };
  }, []);

  if (erro) return <Pagina titulo="Painel"><BotaoPreVenda /><Aviso tipo="erro">{erro}</Aviso></Pagina>;
  if (!dados) return <Pagina titulo="Painel"><BotaoPreVenda /><p>Carregando…</p></Pagina>;
  const { r, meses } = dados;

  return (
    <Pagina titulo="Painel" subtitulo={r.ultima_sincronizacao
      ? `Dados do DirectControl sincronizados em ${dataHora(r.ultima_sincronizacao)}` : 'Nenhuma sincronização com o DirectControl registrada ainda'}>
      <BotaoPreVenda />
      {fin && Number(r.conflitos) > 0 && (
        <Aviso tipo="erro">
          <strong>{r.conflitos} cobrança(s) Asaas</strong> têm títulos que já foram pagos no balcão. Cancele para o cliente não pagar duas vezes.{' '}
          <a href="#/cobrancas?aba=conflitos">Resolver</a>
        </Aviso>
      )}
      {fin && Number(r.baixas_a_replicar) > 0 && (
        <Aviso tipo="alerta">
          <strong>{r.baixas_a_replicar} título(s)</strong> foram baixados aqui (Asaas ou manual) e ainda aparecem em aberto no DirectControl.{' '}
          <a href="#/cobrancas?aba=replicar">Ver lista</a>
        </Aviso>
      )}

      <div className="cartoes">
        <Cartao rotulo="Vendas hoje" valor={moeda(r.vendas_hoje)} onClick={() => navegar('/vendas')} />
        <Cartao rotulo="Vendas no mês" valor={moeda(r.vendas_mes)} detalhe={`${r.vendas_mes_qtd} vendas`} onClick={() => navegar('/vendas')} />
        {fin && <>
          <Cartao rotulo="Crediário em aberto" valor={moeda(r.receber_aberto)} detalhe={`${r.clientes_devendo} clientes`} onClick={() => navegar('/receber')} />
          <Cartao rotulo="Crediário atrasado" valor={moeda(r.receber_atrasado)} tipo={Number(r.receber_atrasado) > 0 ? 'alerta' : undefined}
            onClick={() => navegar('/receber?situacao=atrasado')} />
          <Cartao rotulo="Cobranças Asaas pendentes" valor={moeda(r.cobrancas_pendentes)} detalhe={`Recebido no mês: ${moeda(r.cobrancas_pagas_mes)}`}
            onClick={() => navegar('/cobrancas')} />
          <Cartao rotulo="A pagar (7 dias)" valor={moeda(r.pagar_7_dias)}
            detalhe={Number(r.pagar_atrasado) > 0 ? `Atrasado: ${moeda(r.pagar_atrasado)}` : null}
            tipo={Number(r.pagar_atrasado) > 0 ? 'alerta' : undefined} onClick={() => navegar('/pagar')} />
        </>}
      </div>

      {fin && Number(r.pagar_conferir) > 0 && (
        <Aviso>
          {r.pagar_conferir} conta(s) a pagar vieram do DirectControl vencidas e sem baixa (ele nunca registrou pagamentos).{' '}
          <a href="#/pagar?situacao=conferir">Conferir e baixar em lote</a>
        </Aviso>
      )}

      {meses?.length > 0 && <GraficoVendas meses={meses} />}
    </Pagina>
  );
}
