// Upsert em lotes no Postgres. `db` é qualquer objeto com `query(sql, params)` que devolve
// `{ rows }` — funciona com `pg` (Supabase) e com PGlite (testes).

const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;

/**
 * @param {object} db
 * @param {string} tabela
 * @param {object[]} linhas  todas com as mesmas chaves
 * @param {object} op
 * @param {string[]} [op.conflito=['id']]  colunas do ON CONFLICT
 * @param {Record<string,string>} [op.set]  expressões SQL que substituem `excluded.col` no UPDATE
 *        (podem citar colunas que não estão no INSERT)
 */
export async function upsert(db, tabela, linhas, { conflito = ['id'], set = {}, lote = 500 } = {}) {
  if (!linhas.length) return 0;

  // Chave repetida no mesmo INSERT ... ON CONFLICT dá erro: fica a última ocorrência.
  const porChave = new Map();
  for (const l of linhas) porChave.set(conflito.map((c) => l[c]).join('\u0001'), l);
  const unicas = [...porChave.values()];

  const colunas = Object.keys(unicas[0]);
  const atualizar = colunas.filter((c) => !conflito.includes(c));
  const sets = atualizar.map((c) => `${ident(c)} = ${set[c] ?? `excluded.${ident(c)}`}`);
  for (const [c, expr] of Object.entries(set)) if (!colunas.includes(c)) sets.push(`${ident(c)} = ${expr}`);
  const acao = sets.length ? `do update set ${sets.join(', ')}` : 'do nothing';

  let total = 0;
  for (let i = 0; i < unicas.length; i += lote) {
    const parte = unicas.slice(i, i + lote);
    const params = [];
    const valores = parte.map((l) => `(${colunas.map((c) => { params.push(l[c] ?? null); return `$${params.length}`; }).join(', ')})`);
    const sql = `insert into ${ident(tabela)} (${colunas.map(ident).join(', ')}) values ${valores.join(', ')}
      on conflict (${conflito.map(ident).join(', ')}) ${acao}`;
    await db.query(sql, params);
    total += parte.length;
  }
  return total;
}

export async function idsExistentes(db, tabela) {
  const { rows } = await db.query(`select id from ${ident(tabela)}`);
  return new Set(rows.map((r) => Number(r.id)));
}
