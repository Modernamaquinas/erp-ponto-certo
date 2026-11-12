// Leitura de código de barras pela câmera do celular. Usa o BarcodeDetector nativo (Chrome/Android) e, quando
// o aparelho não tem (iPhone/Safari), carrega sob demanda o "barcode-detector" (ZXing em WebAssembly).
const FORMATOS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar'];

async function criarDetector() {
  if ('BarcodeDetector' in window) {
    try {
      const aceitos = await window.BarcodeDetector.getSupportedFormats();
      const usar = FORMATOS.filter((f) => aceitos.includes(f));
      if (usar.length) return new window.BarcodeDetector({ formats: usar });
    } catch { /* cai no ponyfill */ }
  }
  const { BarcodeDetector } = await import('barcode-detector/ponyfill');
  return new BarcodeDetector({ formats: FORMATOS });
}

/**
 * Liga a câmera traseira no <video> e chama aoLer(codigo) a cada código lido (o mesmo código só repete
 * depois de `intervalo` ms, para não somar duas vezes o mesmo produto). Devolve uma função que desliga.
 */
export async function iniciarLeitor(video, aoLer, { intervalo = 1500 } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador não dá acesso à câmera (abra o ERP pelo endereço https).');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  }).catch((e) => {
    throw new Error(e.name === 'NotAllowedError' ? 'Permita o uso da câmera para este site nas configurações do navegador.' : `Câmera indisponível: ${e.message}`);
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play();
  const detector = await criarDetector();
  let ativo = true;
  let ultimo = { codigo: '', quando: 0 };
  const passo = async () => {
    if (!ativo) return;
    try {
      if (video.readyState >= 2) {
        const achados = await detector.detect(video);
        const codigo = achados.map((a) => String(a.rawValue || '').trim()).find(Boolean);
        const agora = Date.now();
        if (codigo && (codigo !== ultimo.codigo || agora - ultimo.quando > intervalo)) {
          ultimo = { codigo, quando: agora };
          navigator.vibrate?.(80);
          aoLer(codigo);
        }
      }
    } catch { /* quadro ruim: tenta o próximo */ }
    if (ativo) setTimeout(passo, 120);
  };
  passo();
  return () => { ativo = false; stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; };
}
