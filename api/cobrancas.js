// POST /api/cobrancas  { acao: 'criar' | 'lote' | 'cancelar' | 'atualizar', ... }  — usuários admin/financeiro
import { supabaseServico, exigirUsuario, rota, ErroHttp } from './_lib/supabase.js';
import { criarCobranca, cobrarEmLote, cancelarCobranca, atualizarDoAsaas } from './_lib/cobrancas.js';

export const config = { maxDuration: 60 };

export default rota(async (req, res) => {
  if (req.method !== 'POST') throw new ErroHttp(405, 'Use POST');
  const usuario = await exigirUsuario(req);
  const sb = supabaseServico();
  const corpo = req.body || {};

  switch (corpo.acao) {
    case 'criar':
      return res.json({ cobranca: await criarCobranca(sb, usuario, corpo) });
    case 'lote':
      return res.json(await cobrarEmLote(sb, usuario, corpo));
    case 'cancelar':
      return res.json({ cobranca: await cancelarCobranca(sb, Number(corpo.id)) });
    case 'atualizar':
      return res.json({ cobranca: await atualizarDoAsaas(sb, Number(corpo.id)) });
    default:
      throw new ErroHttp(400, 'Ação inválida');
  }
});
