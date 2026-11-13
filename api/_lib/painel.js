// Painel de fechamento de caixa da Ponto Certo (ponto-certo-ferragens-dashboard.vercel.app). A partir de dez/2026 o ERP manda as
// vendas dos dias encerrados (dinheiro, cartões, PIX) e o total a prazo do mês pela mesma ponte do ML (ação "caixa" da ml-estoque,
// mesmo ML_ESTOQUE_URL / ERP_ML_SECRET). Mês fechado no painel não é alterado.
import { chamarMl, mlConfigurado } from './marketplaces.js';

export const PAINEL_URL = 'https://ponto-certo-ferragens-dashboard.vercel.app';
export const PAINEL_DESDE = '2026-12';

const mesDe = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(d);

/** Envia o mês de ontem e, no começo do mês, também o anterior (para fechar o último dia). Devolve o resultado por mês. */
export async function enviarCaixaPainel(sb) {
  if (!mlConfigurado()) return { desligado: true };
  const ontem = new Date(Date.now() - 86400000);
  const meses = [...new Set([mesDe(new Date(ontem.getTime() - 3 * 86400000)), mesDe(ontem)])].filter((m) => m >= PAINEL_DESDE);
  const out = {};
  for (const mes of meses) {
    const { data, error } = await sb.rpc('painel_caixa_mes', { p_mes: mes });
    if (error) throw Object.assign(new Error(error.message), { status: 400 });
    out[mes] = await chamarMl('caixa', { mes, ate: data.ate, dias: data.dias, outros: Number(data.outros) }, { tempo: 20000 });
  }
  return out;
}
