# CLAUDE.md

ERP web da Ponto Certo Ferragens (pt-BR), substituindo o DirectControl/Acertsoft em fases. Ver README.md.

## Arquitetura
- `src/` React (Vite), uma página por arquivo em `src/paginas/`, componentes em `src/componentes/ui.jsx`,
  rotas por hash em `src/lib/contexto.js`. Acesso a dados direto pelo supabase-js (RLS protege).
- `api/` funções Vercel: `cobrancas.js` (Asaas), `asaas-webhook.js`, `usuarios.js`; regras em `api/_lib/`.
- `supabase/migrations/`: `001_schema.sql` (tabelas, funções de baixa, views; roda também no PGlite) e
  `002_seguranca.sql` (perfis/papéis admin|financeiro|vendedor, RLS; depende do schema `auth` do Supabase);
  `003_cartoes.sql` (TEF/taxas/recebíveis, roda no PGlite) + `004_cartoes_seguranca.sql` (RLS dele).
  Aplicar em banco existente: `node scripts/aplicar-sql.mjs <arquivos>`.
- `scripts/migracao/`: leitura do Firebird 2.5 (WIN1252, `node-firebird` com conexão UTF8) e upsert no
  Postgres. Mesmo código faz a carga completa e a sincronização incremental (`--incremental`).

## Regras que não são óbvias
- Os ids do DirectControl são mantidos (cliente 2026 = `clientes.id` 2026). Registros criados no ERP usam
  identity a partir de 1.000.000. `id >= 1000000` = criado no ERP.
- Datas/horas do Firebird são convertidas para texto no SQL (`CAST(... AS VARCHAR)`), porque o driver desloca
  o fuso.
- Venda válida = `VENDA_FINALIZADA='T'`. Há vendas estornadas com valores absurdos (ex.: 999 máquinas), que não
  podem entrar nos totais.
- Conta a receber: `STATUS='P'` = paga; `'N'` com saldo 0 também está quitada.
- O DirectControl nunca baixou contas a pagar, por isso existe o campo `conferir_baixa_legado`.
- Na re-sincronização, baixas feitas no ERP/Asaas (`baixa_origem` erp|asaas) prevalecem sobre o legado
  (`set` em `tabelas.mjs`). As colunas de cobrança do cliente (`*_cobranca`, `asaas_customer_id`) são só do ERP.
- A API do Supabase devolve no máximo 1000 linhas: totais sempre com agregação no banco
  (`select('x:col.sum()')`, habilitada em 002), nunca somando linhas no navegador. Soma + filtro em tabela
  relacionada: embed com uma coluna (`clientes!inner(ativo)`) e somar as ≤2 linhas; `clientes!inner()` vazio
  com agregação dá erro "column clientes does not exist" no PostgREST do Supabase.
- TEF do caixa é PayGo Web (multi-adquirente: Cielo, PagSeguro, Stone, Vero, PIX Shipay), não uma integração direta
  com a Cielo. `TEF_TRANSACAO.DATA_HORA_LOCAL` não tem ano (`dataHoraTef`). O PDV da Fase 2 fala com um agente local
  no PC do caixa (`src/lib/tef.js`, contrato em `docs/tef-cielo.md`) e grava via `pdv_registrar_tef`.
- `npm test` usa PGlite (tests/pgteste.mjs). Com `FDB_TESTE` aponta para um .fdb restaurado e roda a migração real.
