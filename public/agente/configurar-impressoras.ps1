# Pré-configuração das impressoras da loja Ponto Certo (Windows PowerShell 5.1). Chamado pelo instalar.cmd.
#   - Etiquetas: Elgin L42 Pro Full (PPLA). O ERP manda o arquivo cru para \\127.0.0.1\L42, então a
#     impressora precisa estar compartilhada com o nome "L42". Rolo: 3 colunas de 33 x 22 mm, 2 mm entre
#     etiquetas (modelo padrão do ERP: "3,3 CM X 2,2 CM (3 COL.) C/ DESCRIÇÃO").
#   - Cupom (NFC-e / comprovantes): Epson TM-T20II, papel 80 mm. Fica como impressora padrão do Windows e
#     o atalho "ERP Ponto Certo - Caixa" abre o Chrome com --kiosk-printing (imprime sem a janela de impressão).
# Compartilhar impressora e trocar a padrão pode exigir rodar como administrador.
param([string]$Url = 'https://erp-ponto-certo.vercel.app')
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
