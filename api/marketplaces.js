// POST /api/marketplaces { acao } — Mercado Livre (Shopee no mesmo modelo, depois). admin/financeiro.
//   status                       -> { configurado, config }
//   ml_ler_anuncios              -> lê os anúncios da Ponto Certo no ML e vincula pelo GTIN
//   ml_sincronizar               -> importa pedidos novos e envia o estoque dos anúncios pendentes
//   ml_importar_pedidos { desde } -> reimporta pedidos desde a data (ISO)
// POST /api/marketplaces?cron=1 com x-cron-secret = MARKETPLACE_CRON_SECRET: rotina agendada (pg_cron), sem usuário.
import { timingSafeEqual } from 'node:crypto';
import { supabaseServico, exigirUsuario, rota, ErroHttp } from './_lib/supabase.js';
import { mlConfigurado, lerAnunciosMl, sincronizarMl, importarPedidosMl, enviarEstoqueMl } from './_lib/marketplaces.js';

export const config = { maxDuration: 60 };

function cronOk(req) {
  const esperado = process.env.MARKETPLACE_CRON_SECRET || '';
  const veio = String(req.headers['x-cron-secret'] || '');
  return esperado.length >= 24 && veio.length === esperado.length && timingSafeEqual(Buffer.from(veio), Buffer.from(esperado));
}

export default rota(async (req, res) => {
  if (req.method !== 'POST') throw new ErroHttp(405, 'Use POST');
  const sb = supabaseServico();
  if (req.query?.cron) {
    if (!cronOk(req)) throw new ErroHttp(401, 'Não autorizado');
    if (!mlConfigurado()) return res.json({ ok: true, desligado: true });
    return res.json({ ok: true, mercadolivre: await sincronizarMl(sb) });
  }
  await exigirUsuario(req, ['admin', 'financeiro']);
  const c = req.body || {};
  switch (c.acao) {
    case 'status': {
      const { data } = await sb.from('marketplace_config').select('*').order('canal');
      return res.json({ configurado: mlConfigurado(), config: data || [] });
    }
    case 'ml_ler_anuncios':
      return res.json(await lerAnunciosMl(sb));
    case 'ml_sincronizar': {
      const { data: cfg } = await sb.from('marketplace_config').select('importar_vendas').eq('canal', 'mercadolivre').single();
      const pedidos = cfg?.importar_vendas ? await importarPedidosMl(sb) : null;
      return res.json({ pedidos, estoque: await enviarEstoqueMl(sb) });
    }
    case 'ml_importar_pedidos': {
      if (!/^\d{4}-\d{2}-\d{2}/.test(String(c.desde || ''))) throw new ErroHttp(400, 'Informe a data inicial');
      return res.json(await importarPedidosMl(sb, { desde: new Date(`${String(c.desde).slice(0, 10)}T00:00:00-03:00`).toISOString() }));
    }
    default:
      throw new ErroHttp(400, 'Ação inválida');
  }
});
