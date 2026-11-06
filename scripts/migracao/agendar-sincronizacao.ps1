# Agenda a sincronização DirectControl -> ERP a cada 15 minutos (Agendador de Tarefas do Windows).
# Rodar UMA vez, no PowerShell, num computador da loja que enxergue o servidor do DirectControl
# (DESKTOP-8LQ068N) e tenha Node.js + este projeto com o .env preenchido:
#
#   powershell -ExecutionPolicy Bypass -File scripts\migracao\agendar-sincronizacao.ps1
#
# Para remover: Unregister-ScheduledTask -TaskName "ERP Ponto Certo - Sincronizar" -Confirm:$false
param(
  [int]$Minutos = 15
)

$projeto = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$node = (Get-Command node -ErrorAction Stop).Source
$log = Join-Path $projeto 'sincronizacao.log'

# cmd /c para redirecionar a saída ao log (mantém só o último ciclo + erros visíveis no ERP em "sincronizacoes")
$argumentos = "/c cd /d `"$projeto`" && `"$node`" scripts\migracao\migrar.mjs --incremental > `"$log`" 2>&1"
$acao = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $argumentos -WorkingDirectory $projeto
$gatilho = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $Minutos)
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName 'ERP Ponto Certo - Sincronizar' -Action $acao -Trigger $gatilho -Settings $config `
  -Description 'Copia vendas, clientes, produtos e financeiro do DirectControl para o ERP Ponto Certo (somente leitura no DirectControl).' -Force | Out-Null

Write-Host "Tarefa agendada a cada $Minutos minutos. Log do último ciclo: $log"
