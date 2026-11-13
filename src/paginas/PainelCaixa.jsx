// Painel financeiro (/painel-financeiro): o painel de fechamento de caixa da Ponto Certo aberto dentro do ERP (mesma senha de sempre).
// A partir de dez/2026 o ERP preenche os dias encerrados (dinheiro, cartões, PIX) e o total a prazo do mês sozinho: rotina de 5 min
// (api/marketplaces.js?cron=1) ou o botão "Enviar agora". Banco: 024/025; ponte: ação "caixa" da ml-estoque (api/_lib/painel.js).
import { useState } from 'react';
import { api } from '../lib/supabase.js';
import { Pagina, Aviso, useAvisar } from '../componentes/ui.jsx';

const URL_PAINEL = 'https://ponto-certo-ferragens-dashboard.vercel.app';
const MOTIVOS = {
  mes_fechado: 'o mês já está fechado no painel (não foi alterado)',
  mes_inexistente_no_painel: 'o mês ainda não existe no painel',
  salvo_no_painel_agora_tenta_depois: 'o mês acabou de ser salvo no painel; o ERP tenta de novo em 5 minutos',
};

export default function PainelCaixa() {
  const avisar = useAvisar();
  const [enviando, setEnviando] = useState(false);
  const [chave, setChave] = useState(0);

  async function enviar() {
    setEnviando(true);
    try {
      const r = await api('marketplaces', { corpo: { acao: 'painel_enviar' } });
      if (r.desligado) avisar('A ligação com o painel não está configurada no servidor.', 'erro');
      else if (!Object.keys(r).length) avisar('Nada a enviar: o ERP preenche o painel a partir de dezembro/2026.', 'info');
      else {
        avisar(Object.entries(r).map(([mes, x]) => `${mes}: ${x.ok ? (x.alterado ? 'atualizado' : 'já estava em dia') : MOTIVOS[x.motivo] || x.motivo}`).join(' · '), 'ok');
        setChave((k) => k + 1);
      }
    } catch (e) { avisar(e.message, 'erro'); }
    setEnviando(false);
  }

  return (
    <Pagina titulo="Painel financeiro" subtitulo="Fechamento de caixa da Ponto Certo"
      acoes={<>
        <button className="btn btn-sec" disabled={enviando} onClick={enviar}>{enviando ? 'Enviando…' : 'Enviar vendas agora'}</button>
        <a className="btn btn-sec" href={URL_PAINEL} target="_blank" rel="noreferrer">Abrir em nova aba ↗</a>
      </>}>
      <Aviso tipo="info">
        A partir de dezembro/2026 o ERP lança sozinho, no dia seguinte, as vendas de cada dia em <b>Dinheiro</b>, <b>Cartões</b> e <b>PIX</b>
        (troco descontado) e soma o que foi a prazo (crediário, boleto, cheque) no item extra "Vendas a prazo e outras formas (ERP)".
        O Mercado Livre continua vindo pelo fechamento do próprio painel. Despesas e "Fechar mês" seguem sendo feitos no painel;
        mês fechado não é alterado. Não digite as vendas da loja nesses dias: o ERP grava por cima.
      </Aviso>
      <iframe key={chave} title="Painel financeiro" src={URL_PAINEL}
        style={{ width: '100%', height: 'calc(100vh - 260px)', minHeight: 600, border: '1px solid var(--borda, #ddd)', borderRadius: 8, background: '#fff' }} />
    </Pagina>
  );
}
