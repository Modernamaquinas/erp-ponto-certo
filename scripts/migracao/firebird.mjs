// Acesso somente-leitura ao banco Firebird do DirectControl.
import Firebird from 'node-firebird';

export function opcoesFirebird({ fdb } = {}) {
  if (fdb) {
    // backup restaurado localmente (gbak -c) — servidor Firebird desta máquina
    return { host: '127.0.0.1', port: 3050, database: fdb, user: process.env.FIREBIRD_USER || 'SYSDBA',
      password: process.env.FIREBIRD_PASSWORD || 'masterkey' };
  }
  return {
    host: process.env.FIREBIRD_HOST || 'DESKTOP-8LQ068N',
    port: Number(process.env.FIREBIRD_PORT || 3050),
    database: process.env.FIREBIRD_DATABASE || 'C:\\EASYCONTROL\\Dados\\Banco.fdb',
    user: process.env.FIREBIRD_USER || 'SYSDBA',
    password: process.env.FIREBIRD_PASSWORD || 'masterkey',
  };
}

export function conectarFirebird(opcoes) {
  return new Promise((ok, falha) => {
    // UTF8 na conexão: o servidor converte o WIN1252 do banco, e os acentos chegam certos.
    Firebird.attach({ ...opcoes, encoding: 'UTF8', lowercase_keys: true, pageSize: 4096 }, (erro, db) => {
      if (erro) return falha(erro);
      const consultar = (sql, params = []) => new Promise((ok2, falha2) =>
        db.query(sql, params, (e, linhas) => (e ? falha2(e) : ok2(linhas || []))));
      ok({
        consultar,
        // Lê em páginas para não puxar 90 mil linhas de uma vez.
        async consultarPaginado(sql, ordem, tamanho = 20000) {
          const todas = [];
          for (let pular = 0; ; pular += tamanho) {
            const pagina = await consultar(sql.replace(/^\s*SELECT/i, `SELECT FIRST ${tamanho} SKIP ${pular}`) + ` ORDER BY ${ordem}`);
            todas.push(...pagina);
            if (pagina.length < tamanho) return todas;
          }
        },
        fechar: () => new Promise((ok3) => db.detach(() => ok3())),
      });
    });
  });
}
