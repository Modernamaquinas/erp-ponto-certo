# Agente local de impressão do ERP Ponto Certo (Windows PowerShell 5.1, sem instalar nada).
# Recebe do navegador o arquivo da etiqueta (PPLA cru) e manda para a impressora compartilhada, igual ao
# C:\EASYCONTROL\PRINTLBL.BAT do DirectControl (TYPE ETIQUETA.TXT > \\127.0.0.1\L42).
#
#   GET  http://127.0.0.1:7172/status                 -> {"ok":true,"impressora":"\\127.0.0.1\L42",...}
#   POST http://127.0.0.1:7172/imprimir?impressora=…  (corpo = bytes do arquivo) -> {"ok":true,"bytes":N}
#
# Só aceita pedidos vindos do próprio PC (127.0.0.1) e das origens do ERP listadas em $Origens.
param(
  [int]$Porta = 7172,
  [string]$Impressora = '\\127.0.0.1\L42',
  [string[]]$Origens = @('https://erp-ponto-certo.vercel.app', 'http://localhost:5173', 'http://127.0.0.1:5173')
)
$ErrorActionPreference = 'Stop'
$pasta = Join-Path $env:TEMP 'erp-ponto-certo'
New-Item -ItemType Directory -Force $pasta | Out-Null
$log = Join-Path $pasta 'agente-impressao.log'
function Registrar([string]$m) { Add-Content -Path $log -Value ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $m) -Encoding UTF8 }

function Responder($stream, [int]$codigo, [string]$corpo, [string]$origem) {
  $textos = @{ 200 = 'OK'; 204 = 'No Content'; 400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found'; 413 = 'Payload Too Large'; 500 = 'Internal Server Error' }
  $b = [Text.Encoding]::UTF8.GetBytes($corpo)
  $h = "HTTP/1.1 $codigo $($textos[$codigo])`r`nContent-Type: application/json; charset=utf-8`r`nContent-Length: $($b.Length)`r`nConnection: close`r`n"
  if ($origem) {
    $h += "Access-Control-Allow-Origin: $origem`r`nVary: Origin`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`n"
    $h += "Access-Control-Allow-Headers: Content-Type`r`nAccess-Control-Allow-Private-Network: true`r`nAccess-Control-Max-Age: 600`r`n"
  }
  $cab = [Text.Encoding]::ASCII.GetBytes("$h`r`n")
  $stream.Write($cab, 0, $cab.Length)
  if ($b.Length) { $stream.Write($b, 0, $b.Length) }
}
function Json($obj) { $obj | ConvertTo-Json -Compress }

function Atender($cliente) {
  $stream = $cliente.GetStream()
  $stream.ReadTimeout = 10000
  # lê o cabeçalho HTTP até a linha em branco
  $buf = New-Object byte[] 65536; $lido = 0; $fim = -1
  while ($fim -lt 0) {
    $n = $stream.Read($buf, $lido, $buf.Length - $lido)
    if ($n -le 0) { return }
    $lido += $n
    $texto = [Text.Encoding]::ASCII.GetString($buf, 0, $lido)
    $fim = $texto.IndexOf("`r`n`r`n")
    if ($lido -ge $buf.Length -and $fim -lt 0) { Responder $stream 413 (Json @{ ok = $false; erro = 'cabeçalho grande demais' }) $null; return }
  }
  $linhas = $texto.Substring(0, $fim).Split("`n") | ForEach-Object { $_.TrimEnd("`r") }
  $metodo, $alvo = $linhas[0].Split(' ')[0, 1]
  $cab = @{}
  foreach ($l in $linhas[1..($linhas.Length - 1)]) { $i = $l.IndexOf(':'); if ($i -gt 0) { $cab[$l.Substring(0, $i).Trim().ToLower()] = $l.Substring($i + 1).Trim() } }
  $origem = $cab['origin']
  $origemOk = (-not $origem) -or ($Origens -contains $origem)
  $eco = if ($origem -and $origemOk) { $origem } else { $null }
  if (-not $origemOk) { Registrar "recusado: origem $origem"; Responder $stream 403 (Json @{ ok = $false; erro = 'origem não autorizada' }) $null; return }

  $caminho, $query = $alvo.Split('?', 2)
  $params = @{}
  if ($query) { foreach ($p in $query.Split('&')) { $k, $v = $p.Split('=', 2); $params[[Uri]::UnescapeDataString($k)] = [Uri]::UnescapeDataString(($v -replace '\+', ' ')) } }

  if ($metodo -eq 'OPTIONS') { Responder $stream 204 '' $eco; return }
  if ($metodo -eq 'GET' -and $caminho -eq '/status') {
    Responder $stream 200 (Json @{ ok = $true; agente = 'erp-ponto-certo-impressao'; versao = 1; impressora = $Impressora; computador = $env:COMPUTERNAME }) $eco; return
  }
  if ($metodo -eq 'POST' -and $caminho -eq '/imprimir') {
    $tamanho = [int]($cab['content-length'])
    if ($tamanho -le 0 -or $tamanho -gt 5MB) { Responder $stream 400 (Json @{ ok = $false; erro = 'arquivo vazio ou grande demais' }) $eco; return }
    $corpo = New-Object byte[] $tamanho
    $ja = $lido - ($fim + 4)
    if ($ja -gt 0) { [Array]::Copy($buf, $fim + 4, $corpo, 0, [Math]::Min($ja, $tamanho)) }
    while ($ja -lt $tamanho) { $n = $stream.Read($corpo, $ja, $tamanho - $ja); if ($n -le 0) { break }; $ja += $n }
    if ($ja -lt $tamanho) { Responder $stream 400 (Json @{ ok = $false; erro = 'arquivo incompleto' }) $eco; return }
    $destino = if ($params['impressora']) { $params['impressora'] } else { $Impressora }
    if ($destino -notmatch '^\\\\[\w.\-]+\\[\w .\-]+$') { Responder $stream 400 (Json @{ ok = $false; erro = "impressora inválida: $destino (use \\computador\compartilhamento)" }) $eco; return }
    $arquivo = Join-Path $pasta 'ETIQUETA.TXT'
    [IO.File]::WriteAllBytes($arquivo, $corpo)
    $saida = & cmd.exe /c "copy /b `"$arquivo`" `"$destino`" 2>&1"
    if ($LASTEXITCODE -ne 0) {
      Registrar "erro ao imprimir em ${destino}: $saida"
      Responder $stream 500 (Json @{ ok = $false; erro = "Não consegui enviar para $destino. Confira se a impressora está ligada e compartilhada. ($($saida -join ' '))" }) $eco; return
    }
    Registrar "impresso: $tamanho bytes em $destino"
    Responder $stream 200 (Json @{ ok = $true; bytes = $tamanho; impressora = $destino }) $eco; return
  }
  Responder $stream 404 (Json @{ ok = $false; erro = 'não encontrado' }) $eco
}

$ouvinte = New-Object Net.Sockets.TcpListener ([Net.IPAddress]::Loopback, $Porta)
try { $ouvinte.Start() } catch { Registrar "porta $Porta ocupada (agente já está rodando?)"; exit 1 }
Registrar "agente iniciado na porta $Porta, impressora $Impressora"
while ($true) {
  $cliente = $ouvinte.AcceptTcpClient()
  try { Atender $cliente } catch { Registrar "erro: $($_.Exception.Message)" } finally { $cliente.Close() }
}
