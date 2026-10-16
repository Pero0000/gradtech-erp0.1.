$ErrorActionPreference = 'Stop'

$protocolPath = 'HKCU:\Software\Classes\tmcolor-folder'
if (Test-Path -LiteralPath $protocolPath) {
  Remove-Item -LiteralPath $protocolPath -Recurse -Force
}

Write-Host 'Pomocni program za otvaranje mapa je uklonjen.'
