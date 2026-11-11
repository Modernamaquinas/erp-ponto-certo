// POST /api/fiscal  { acao, ... } — NFC-e/NF-e pela Focus NFe.
//   status                         qualquer usuário: token da Focus do ambiente atual é aceito?
//   emitir   { modelo, ... }       NFC-e: qualquer usuário (caixa); NF-e: admin/financeiro
//   consultar|danfe|xml { id }     qualquer usuário
//   cancelar { id, justificativa } admin/financeiro
import { supabaseServico, exigirUsuario, rota, ErroHttp } from './_lib/supabase.js';
import { emitirNota, consultarNota, cancelarNota, danfeNota, xmlNota, verificarFocus, configFiscal } from './_lib/fiscal/emitir.js';
import { focusConfigurada } from './_lib/fiscal/focus.js';

export const config = { maxDuration: 60 };
const TODOS = ['admin', 'financeiro', 'vendedor'];

export default rota(async (req, res) => {
  if (req.method !== 'POST') throw new ErroHttp(405, 'Use POST');
  const corpo = req.body || {};
  const fin = corpo.acao === 'cancelar' || (corpo.acao === 'emitir' && Number(corpo.modelo) === 55);
  const usuario = await exigirUsuario(req, fin ? ['admin', 'financeiro'] : TODOS);
  const sb = supabaseServico();
  const id = Number(corpo.id);

  switch (corpo.acao) {
    case 'status': {
      const { ambiente } = await configFiscal(sb);
      if (!focusConfigurada(ambiente)) return res.json({ configurada: false, ambiente });
      return res.json({ configurada: true, ambiente, ...(await verificarFocus(ambiente)) });
    }
    case 'emitir':
      return res.json({ nota: await emitirNota(sb, usuario, corpo) });
    case 'consultar':
      return res.json({ nota: await consultarNota(sb, id) });
    case 'cancelar':
      return res.json({ nota: await cancelarNota(sb, usuario, id, corpo.justificativa) });
    case 'danfe':
      return res.json(await danfeNota(sb, id));
    case 'xml':
      return res.json(await xmlNota(sb, id));
    default:
      throw new ErroHttp(400, 'Ação inválida');
  }
});
