// Funções puras de conversão DirectControl (Firebird) -> ERP (Postgres). Testadas em tests/migracao.

/** Texto: tira espaços de CHAR(n); vazio vira null. */
export function txt(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+$/u, '').replace(/^\s+/u, '');
  return s === '' ? null : s;
}

/** Só dígitos (CPF/CNPJ, CEP, telefone); vazio vira null. */
export function dig(v) {
  const s = txt(v);
  if (!s) return null;
  const d = s.replace(/\D/g, '');
  return d === '' ? null : d;
}

/** Campos lógicos do DirectControl: 'T' / 'F' (CHAR com espaços). */
export function bool(v, padrao = false) {
  const s = txt(v);
  if (s === 'T' || s === 'S') return true;
  if (s === 'F' || s === 'N') return false;
  return padrao;
}

export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Valor monetário com 2 casas (null vira 0). */
export function dinheiro(v) {
  const n = num(v);
  return n === null ? 0 : Math.round(n * 100) / 100;
}

/** Data vinda de CAST(campo AS VARCHAR(10)) -> 'AAAA-MM-DD' ou null se fora de faixa. */
export function data(v) {
  const s = txt(v);
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const ano = Number(m[1]);
  if (ano < 1900 || ano > 2100) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Hora vinda de CAST(campo AS VARCHAR(13)) ('08:01:19.0000') -> '08:01:19'. */
export function hora(v) {
  const s = txt(v);
  if (!s) return null;
  const m = /^(\d{2}):(\d{2}):(\d{2})/.exec(s);
  return m ? `${m[1]}:${m[2]}:${m[3]}` : null;
}

/** Mantém a FK só se o registro pai existe no destino. */
export function fk(id, conjunto) {
  const n = num(id);
  if (n === null) return null;
  return conjunto && conjunto.has(n) ? n : null;
}

export function tipoPessoa(tipo, cpfCnpj) {
  const t = txt(tipo);
  if (t === 'F' || t === 'J') return t;
  return cpfCnpj && cpfCnpj.length === 14 ? 'J' : 'F';
}

/** VENDAS.VENDA_FINALIZADA: T = finalizada; A/C com DATA_ESTORNO = estornada/cancelada. */
export function situacaoVenda(finalizada, dataEstorno) {
  const f = txt(finalizada);
  if (f === 'T') return 'finalizada';
  if (f === 'C') return 'cancelada';
  if (f === 'A' && data(dataEstorno)) return 'estornada';
  return 'aberta';
}

/** Conta a receber: STATUS 'P' = paga; 'N' com saldo > 0 = aberta (N com saldo zerado = quitada). */
export function statusReceber(status, saldo) {
  const s = txt(status);
  if (s === 'P') return 'pago';
  return dinheiro(saldo) > 0 ? 'aberto' : 'pago';
}

const TIPO_FORMA = { V: 'avista', P: 'prazo', A: 'credito' };
export function tipoForma(t) {
  return TIPO_FORMA[txt(t)] || 'avista';
}

export function tipoPlano(entradaSaida) {
  return /^SA/i.test(txt(entradaSaida) || '') ? 'saida' : 'entrada';
}

/** Data local (fuso da máquina) em 'AAAA-MM-DD'. */
export function hojeLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function somarDias(isoData, dias) {
  const [a, m, d] = isoData.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d + dias));
  return dt.toISOString().slice(0, 10);
}
