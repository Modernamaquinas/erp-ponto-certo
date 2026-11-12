# Pré-configuração das impressoras da loja Ponto Certo (Windows PowerShell 5.1). Chamado pelo instalar.cmd.
#   - Etiquetas: Elgin L42 Pro Full (PPLA). O ERP manda o arquivo cru para \\127.0.0.1\L42, então a
#     impressora precisa estar compartilhada com o nome "L42". Rolo: 3 colunas de 33 x 22 mm, 2 mm entre
#     etiquetas (modelo padrão do ERP: "3,3 CM X 2,2 CM (3 COL.) C/ DESCRIÇÃO").
#   - Cupom (NFC-e / comprovantes): Epson TM-T20II, papel 80 mm. Fica como impressora padrão do Windows e
#     o atalho "ERP Ponto Certo - Caixa" abre o Chrome com --kiosk-printing (imprime sem a janela de impressão).
#   - Folha A4 (DANFE da NF-e): HP Laser 107w. Como o Chrome do caixa manda tudo para a padrão (TM-T20II), o
#     DANFE vai pelo agente local: o SumatraPDF (baixado aqui, portátil) imprime o PDF direto na HP.
# Compartilhar impressora e trocar a padrão pode exigir rodar como administrador.
param([string]$Url = 'https://erp-ponto-certo.vercel.app', [string]$Pasta = (Join-Path $env:LOCALAPPDATA 'ERP Ponto Certo'))
$ErrorActionPreference = 'Continue'
$avisos = @()

function Achar([string]$padrao) { Get-Printer -ErrorAction SilentlyContinue | Where-Object { $_.Name -match $padrao -or $_.DriverName -match $padrao } | Select-Object -First 1 }

# --- Elgin L42 Pro Full (etiquetas) ---
$l42 = Achar 'L42'
if (-not $l42) {
  $avisos += 'Elgin L42 Pro Full nao encontrada. Instale o driver da Elgin (site elgin.com.br), ligue a impressora no USB e rode este instalador de novo.'
} elseif ($l42.Shared -and $l42.ShareName -eq 'L42') {
  Write-Host "OK  Etiquetas: '$($l42.Name)' ja compartilhada como L42."
} else {
  try {
    Set-Printer -Name $l42.Name -Shared $true -ShareName 'L42' -ErrorAction Stop
    Write-Host "OK  Etiquetas: '$($l42.Name)' compartilhada como L42."
  } catch {
    $avisos += "Nao consegui compartilhar '$($l42.Name)' como L42 ($($_.Exception.Message)). Rode o instalar.cmd como administrador, ou em Impressoras > Propriedades da impressora > Compartilhamento, marque 'Compartilhar' com o nome L42."
  }
}

# --- Epson TM-T20II (cupom) ---
$tm = Achar 'TM-T20II'
if (-not $tm) { $tm = Achar 'TM-T20' }
if (-not $tm) {
  $avisos += 'Epson TM-T20II nao encontrada. Instale o driver "Epson Advanced Printer Driver" (APD) da TM-T20II e rode este instalador de novo.'
} else {
  try {
    # Desliga o "deixar o Windows gerenciar a impressora padrão", que trocaria a padrão sozinho
    Set-ItemProperty 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Windows' -Name LegacyDefaultPrinterMode -Value 1 -ErrorAction SilentlyContinue
    $wmi = Get-CimInstance Win32_Printer -Filter "Name='$($tm.Name -replace "'", "''")'"
    Invoke-CimMethod -InputObject $wmi -MethodName SetDefaultPrinter | Out-Null
    Write-Host "OK  Cupom: '$($tm.Name)' definida como impressora padrao do Windows (papel 80 mm)."
  } catch {
    $avisos += "Nao consegui deixar '$($tm.Name)' como padrao. Em Configuracoes > Impressoras, escolha a TM-T20II e clique em 'Definir como padrao'."
  }
}

# --- HP Laser 107w (folha A4: DANFE da NF-e) ---
New-Item -ItemType Directory -Force $Pasta | Out-Null
$hps = Get-Printer -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'HP Laser 10[378]|107w' -or $_.DriverName -match 'HP Laser 10[378]' }
# prefere a fila com o driver da HP (USB/rede) à fila genérica IPP do Windows
$hp = ($hps | Where-Object { $_.DriverName -notmatch 'IPP' } | Select-Object -First 1); if (-not $hp) { $hp = $hps | Select-Object -First 1 }
if (-not $hp) {
  $avisos += 'HP Laser 107w nao encontrada. Instale o driver "HP Laser 103/107/108" (site da HP) e rode este instalador de novo.'
} else {
  [IO.File]::WriteAllText((Join-Path $Pasta 'impressora-a4.txt'), $hp.Name, (New-Object Text.UTF8Encoding $false))
  Write-Host "OK  Folha A4 (DANFE da NF-e): '$($hp.Name)'."
  $sumatra = Join-Path $Pasta 'SumatraPDF.exe'
  if (-not (Test-Path $sumatra)) {
    try {
      $zip = Join-Path $env:TEMP 'SumatraPDF-3.5.2-64.zip'
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest -UseBasicParsing 'https://www.sumatrapdfreader.org/dl/rel/3.5.2/SumatraPDF-3.5.2-64.zip' -OutFile $zip
      $tmp = Join-Path $env:TEMP 'SumatraPDF-erp'; Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
      Expand-Archive $zip -DestinationPath $tmp -Force
      Copy-Item (Get-ChildItem $tmp -Filter 'SumatraPDF*.exe' | Select-Object -First 1).FullName $sumatra -Force
      Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
      Write-Host 'OK  Leitor de PDF (SumatraPDF) instalado para imprimir o DANFE direto na HP.'
    } catch {
      $avisos += "Nao consegui baixar o SumatraPDF ($($_.Exception.Message)). Sem ele o DANFE abre a janela de impressao: escolha a HP Laser 107w."
    }
  }
}

# --- Atalho do caixa: Chrome com impressão direta ---
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) {
  $avisos += 'Google Chrome nao encontrado: instale o Chrome para ter o atalho com impressao direta.'
} else {
  $ws = New-Object -ComObject WScript.Shell
  $atalho = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'ERP Ponto Certo - Caixa.lnk'))
  $atalho.TargetPath = $chrome
  $atalho.Arguments = "--kiosk-printing --new-window $Url/pdv"
  $atalho.Description = 'ERP Ponto Certo com impressao direta do cupom na TM-T20II'
  $atalho.IconLocation = "$chrome,0"
  $atalho.Save()
  Write-Host 'OK  Atalho "ERP Ponto Certo - Caixa" criado na area de trabalho (feche todas as janelas do Chrome antes de abrir por ele).'
}

if ($avisos.Count) { Write-Host ''; Write-Host 'ATENCAO:'; $avisos | ForEach-Object { Write-Host " - $_" } }
