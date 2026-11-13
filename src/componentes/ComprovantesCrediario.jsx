// Botões de impressão do crediário: comprovante de quitação e contas pagas detalhado (src/lib/comprovanteReceber.js).
import { useState } from 'react';
import { dadosComprovante, imprimirQuitacao, imprimirContasPagas } from '../lib/comprovanteReceber.js';
import { useAvisar } from './ui.jsx';

const CHAVE = 'pc-comprovante-a4';
const lerA4 = () => { try { return localStorage.getItem(CHAVE) === '1'; } catch { return false; } };

export default function ComprovantesCrediario({ ids, acerto }) {
  const avisar = useAvisar();
  const [a4, setA4] = useState(lerA4);
  const [ocupado, setOcupado] = useState('');
  async function imprimir(tipo) {
    setOcupado(tipo);
    try {
      const d = await dadosComprovante(ids);
      const largura = a4 ? 'A4' : undefined;
      if (tipo === 'quitacao') await imprimirQuitacao(d, { acerto, largura });
      else await imprimirContasPagas(d, { largura });
    } catch (e) { avisar(e.message, 'erro'); }
    setOcupado('');
  }
  function mudarA4(v) { setA4(v); try { localStorage.setItem(CHAVE, v ? '1' : '0'); } catch { /* sem armazenamento */ } }
  return (
    <div className="form-linha">
      <button type="button" className="btn btn-pri" disabled={!!ocupado} onClick={() => imprimir('quitacao')}>
        {ocupado === 'quitacao' ? 'Preparando…' : '🖨 Comprovante de quitação'}</button>
      <button type="button" className="btn btn-sec" disabled={!!ocupado} onClick={() => imprimir('contas')}>
        {ocupado === 'contas' ? 'Preparando…' : '🖨 Contas pagas (itens, datas e valores)'}</button>
      <label className="check"><input type="checkbox" checked={a4} onChange={(e) => mudarA4(e.target.checked)} /> Imprimir em folha A4</label>
    </div>
  );
}
