// POST /api/fiscal  { acao, ... } — NFC-e/NF-e pela Nuvem Fiscal.
//   status                       qualquer usuário: SEFAZ no ar? (+ se a Nuvem Fiscal está configurada)
//   emitir   { modelo, ... }     NFC-e: qualquer usuário (caixa); NF-e: admin/financeiro
//   consultar|pdf|xml { id }     qualquer usuário
//   cancelar { id, justificativa } admin/financeiro
import { supabaseServico, exigirUsuario, rota, ErroHttp } from './_lib/supabase.js';
import { emitirNota, consultarNota, cancelarNota, pdfNota, xmlNota, statusSefaz, configFiscal } from './_lib/fiscal/emitir.js';
import { nuvemFiscalConfigurada } from './_lib/fiscal/nuvemfiscal.js';

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
      const cfg = await configFiscal(sb);
      if (!nuvemFiscalConfigurada()) return res.json({ configurada: false, ambiente: cfg.ambiente });
      const [nfce, nfe] = await Promise.allSettled([statusSefaz(65), statusSefaz(55)]);
      const ler = (r) => (r.status === 'fulfilled' ? r.value : { erro: r.reason.message });
      return res.json({ configurada: true, ambiente: cfg.ambiente, nfce: ler(nfce), nfe: ler(nfe) });
    }
    case 'emitir':
      return res.json({ nota: await emitirNota(sb, usuario, corpo) });
    case 'consultar':
      return res.json({ nota: await consultarNota(sb, id) });
    case 'cancelar':
      return res.json({ nota: await cancelarNota(sb, usuario, id, corpo.justificativa) });
    case 'pdf':
      return res.json(await pdfNota(sb, id));
    case 'xml':
      return res.json(await xmlNota(sb, id));
    default:
      throw new ErroHttp(400, 'Ação inválida');
  }
});
