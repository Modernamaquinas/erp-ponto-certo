# CLAUDE.md

ERP web da Ponto Certo Ferragens (pt-BR), substituindo o DirectControl/Acertsoft em fases. Ver README.md.

## Arquitetura
- `src/` React (Vite), uma página por arquivo em `src/paginas/`, componentes em `src/componentes/ui.jsx`,
  rotas por hash em `src/lib/contexto.js`. Acesso a dados direto pelo supabase-js (RLS protege).
- `api/` funções Vercel: `cobrancas.js` (Asaas), `asaas-webhook.js`, `usuarios.js`; regras em `api/_lib/`.
- `supabase/migrations/`: `001_schema.sql` (tabelas, funções de baixa, views; roda também no PGlite) e
  `002_seguranca.sql` (perfis/papéis admin|financeiro|vendedor, RLS; depende do schema `auth` do Supabase);
  `003_cartoes.sql` (TEF/taxas/recebíveis, roda no PGlite) + `004_cartoes_seguranca.sql` (RLS dele).
  `005_fiscal.sql` (notas_fiscais, numeração, campos fiscais de produtos) + `006_fiscal_seguranca.sql`.
  Aplicar em banco existente: `node scripts/aplicar-sql.mjs <arquivos>`.
- `api/fiscal.js` + `api/_lib/fiscal/`: NFC-e/NF-e pela Focus NFe (ver docs/fiscal.md). Certificado A1 e CSC só no
  `.env` local e na Focus NFe (`npm run fiscal:configurar`); `certificado/` e `*.pfx` nunca vão para o git.
  Séries do ERP (NFC-e 10, NF-e 2) diferentes das do DirectControl (NF-e 1, NFC-e 3 e 5).
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
- Pré-venda (`/prevenda`, `PreVenda.jsx`): o vendedor monta no celular (câmera: `src/lib/camera.js`, BarcodeDetector nativo ou
  ponyfill `barcode-detector` no iPhone) e grava um orçamento `tipo='prevenda'` com o nome do cliente (014). O caixa abre pelo
  botão "Pré-vendas" do PDV (`/pdv?orcamento=id`); a venda, o estoque e a NFC-e só acontecem lá. A câmera exige https.
- Etiquetas: modelos do DirectControl em `etiqueta_modelos/campos` (012/013); `src/lib/etiquetas.js` gera PPLA idêntico ao
  `C:\EASYCONTROL\ETIQUETA.TXT` (teste de referência). A sincronização só acrescenta modelos novos (`apenasNovos`).
- Impressão de etiquetas (`/etiquetas`, também `?produto=id` e `?compra=id`): o navegador manda o PPLA ao agente local
  `public/agente/agente-impressao.ps1` (PowerShell, TcpListener em 127.0.0.1:7172, aceita só a origem do ERP), que faz
  `copy /b` para `\127.0.0.1\L42` como o PRINTLBL.BAT. Instalação no PC: `instalar.cmd` (atalho na Inicializar). O .ps1 precisa
  de BOM UTF-8 (PowerShell 5.1 lê sem BOM como ANSI).
- Impressoras da loja (pré-configuradas): etiquetas na **Elgin L42 Pro Full** (PPLA, compartilhada como `L42`), rolo de
  3 colunas de 33 x 22 mm com 2 mm entre etiquetas = modelo padrão 2 "3,3 CM X 2,2 CM (3 COL.) C/ DESCRIÇÃO" (colunas a
  138 = 35 mm uma da outra, em 0,01"). Cupom/NFC-e na **Epson TM-T20II** (80 mm, padrão do Windows). O `instalar.cmd`
  chama `public/agente/configurar-impressoras.ps1` (compartilha a L42, define a TM-T20II como padrão, cria o atalho do
  Chrome com `--kiosk-printing` em `/pdv`); precisa de administrador para compartilhar/trocar a padrão. Com BOM UTF-8.
  Folha A4 (DANFE da NF-e, PDF): **HP Laser 107w**. O configurador grava o nome dela em `impressora-a4.txt` e baixa o
  SumatraPDF portátil para a pasta do agente; `POST /imprimir-pdf` do agente imprime com `-print-to`. `imprimirNota` usa
  `imprimirPdfNoAgente` e só cai na janela do navegador se o agente não tiver impressora A4 (no atalho kiosk iria para a térmica).
- Finalização do PDV (015): desconto em R$ (= desconto_geral), frete e endereço de entrega opcionais, e escolha NFC-e ou
  NF-e (DANFE A4). O frete soma no total e vai rateado nos itens da nota. **NFC-e com frete = entrega a domicílio
  (indPres 4) e a SEFAZ exige destinatário com CPF/CNPJ (787) e endereço (788)** — por isso venda com frete exige cliente
  cadastrado (testado em homologação). Endereço digitado sem frete vai só em infCpl ("ENTREGA: ..."). NF-e pelo PDV vale
  para qualquer operador (a emissão avulsa em Notas Fiscais continua só admin/financeiro).
- NF-e concluída no PDV: "Salvar PDF/XML" (`salvarArquivoNota`) e "Enviar por WhatsApp" (wa.me com links públicos assinados
  `GET /api/fiscal?arquivo=danfe|xml&id&exp&sig`, HMAC em `api/_lib/fiscal/link.js`, 60 dias). Segredo: `LINK_NOTA_SEGREDO` ou, sem ele,
  derivado de `SUPABASE_SERVICE_ROLE_KEY` — trocar essa chave invalida os links já enviados.
- Relatórios (`/relatorios?aba=vendas|estoque|receber|pagar|financeiro`, só admin/financeiro) e contagem cíclica (`/contagem`): 016/017.
  Cada aba chama uma função `rel_*` (security definer, checa `rel_permitido('fin')`) que devolve um jsonb já agregado. Formas de
  pagamento agrupadas por `grupo_forma(id)`; troco (pago acima do total) sai do dinheiro. Gráficos sem biblioteca em
  `src/componentes/graficos.jsx`. Contagem: lista por critério com foto do estoque; contagem cega para vendedor; fechar com ajuste
  aplica `contado − foto` (não perde vendas no meio). **A sincronização do DirectControl sobrescreve `produtos.estoque`**: até a troca
  de sistema, o acerto também precisa ser lançado lá.
- Orçamento com tipo (018/019): `orcamento` (não mexe no estoque; botão "Gerar venda" salva e abre no PDV), `reserva` (status
  `reservado`: o estoque sai do disponível) e `consignado` (status `consignado`: o cliente cadastrado leva; fica na ficha dele).
  O PDV abre os dois com `/pdv?orcamento=id` em modo acerto: só os itens separados, até a quantidade separada; `finalizar_venda`
  não baixa o estoque de novo e devolve a diferença (`orcamento_itens.quantidade_devolvida`). `consignado_devolver` = devolveu tudo
  / liberar reserva. Sem nota de remessa em consignação (CFOP 5917): a nota sai só na venda do acerto.
- Crediário: 1ª parcela sempre no dia 10 do mês seguinte (`vencimento_crediario`, aplicado no banco; o navegador só mostra).
- Entrega na finalização (018): `vendas.entrega`, `entrega_nome/telefone/data/horario` + `endereco_entrega`. Sem cadastro, nome e
  telefone são obrigatórios; o frete continua exigindo cliente cadastrado (SEFAZ 787/788). O comprovante sai com o quadro de entrega.
