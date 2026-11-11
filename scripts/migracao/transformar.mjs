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

// ---- TEF (TEF_TRANSACAO do DirectControl: PayGo Web via ACBr) ----

const REDES_TEF = { PAGSEGUR: 'PAGSEGURO', VEROBANR: 'VERO' };
/** NOME_REDE vem cortado em 8 letras; 'dedicado' é o registro do gerenciador sem adquirente. */
export function redeTef(v) {
  const s = (txt(v) || '').toUpperCase();
  if (!s || s === 'DEDICADO') return null;
  return REDES_TEF[s] || s;
}

/** TIPO_TRANSACAO (padrão TEF dial): 10 crédito, 11 parcelado loja, 12 parcelado adm., 2x débito, 51 PIX. */
export function modalidadeTef(tipo, rede, bandeira) {
  const t = txt(tipo);
  if (t === '51' || rede === 'SHIPAY') return 'pix';
  if (/ALIMENTA|REFEI|VOUCHER|VERDECARD/i.test(bandeira || '')) return 'voucher';
  if (t === '10') return 'credito';
  if (t === '11') return 'credito_parcelado_loja';
  if (t === '12') return 'credito_parcelado_adm';
  if (/^2\d$/.test(t || '')) return 'debito';
  return rede ? 'outro' : null;
}

/** NOME_ADMINISTRADORA: nome da bandeira; descarta ids de carteira digital gravados no campo. */
export function bandeiraTef(v) {
  const s = (txt(v) || '').toUpperCase();
  return /^[A-Z][A-Z ]*$/.test(s) ? s : null;
}

/**
 * Aprovada = gerenciador devolveu adquirente + autorização e o DirectControl confirmou
 * (CNF/0 no formato antigo, CRT/2 no atual). O resto (77 = "operação cancelada", 3, vazio) não foi concluído.
 */
export function situacaoTef(header, status, rede, autorizacao) {
  const s = txt(status);
  return rede && txt(autorizacao) && (s === '0' || s === '2') && txt(header) !== 'CNC' ? 'aprovada' : 'nao_concluida';
}

/**
 * DATA_HORA_LOCAL é 'DDMMhhmmss' (sem ano). O ano vem do prefixo AAMMDD de FINALIZACAO quando bate, senão da
 * data da venda (voltando um ano se a transação ficaria depois dela, como numa venda de 02/01 com TEF de 31/12).
 */
export function dataHoraTef(dataHoraLocal, finalizacao, dataVenda) {
  const s = txt(dataHoraLocal);
  const dv = data(dataVenda);
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s || '');
  if (!m) return dv ? `${dv} 00:00:00` : null;
  const [, dd, mm, hh, mi, ss] = m;
  if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return dv ? `${dv} 00:00:00` : null;
  let ano = null;
  const f = /^(\d{2})(\d{2})(\d{2})/.exec(txt(finalizacao) || '');
  if (f && f[2] === mm && f[3] === dd) ano = 2000 + Number(f[1]);
  else if (dv) {
    ano = Number(dv.slice(0, 4));
    if (`${ano}-${mm}-${dd}` > somarDias(dv, 2)) ano -= 1;
  }
  if (!ano || Number(hh) > 23 || Number(mi) > 59 || Number(ss) > 59) return dv ? `${dv} 00:00:00` : null;
  const dia = `${ano}-${mm}-${dd}`;
  if (somarDias(dia, 0) !== dia) return dv ? `${dv} 00:00:00` : null; // 31/02 e afins
  return `${dia} ${hh}:${mi}:${ss}`;
}
